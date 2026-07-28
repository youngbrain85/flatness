# P1b 엔진 확장(다중 구역·품질 검사·텍스트 파서·대좌표 정밀도) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** P1a 엔진에 다중 구역 분할(레벨·연결요소), 유령층/저밀도/가구 품질 마스크, XYZ/TXT/CSV/PTS 파서, 대좌표(georeferenced) 정밀도를 추가해 실제 다중 방·단차 스캔을 판정 가능하게 만든다.

**Architecture:** 리더를 float64 계약으로 전환하고 센터링을 서브셀 비닝에서 수행(대좌표 지터 해소) → 서브셀에 저밀도·쌍봉(유령층) 마스크 추가 → 높이 히스토그램 레벨 검출 → 연결요소 구역화 + 구역별 RANSAC 잔차 → 셀 평가를 구역 인지형으로 확장. 기존 모듈 시그니처는 기본값 추가로 하위 호환 유지.

**Tech Stack:** Python 3.11+, numpy, scipy(ndimage — 신규 의존성), laspy, matplotlib, pytest. 기존 `engine/` 패키지 확장.

**Spec:** `docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md` §5.1.1~5.1.4, §5.2 · **백로그:** `docs/superpowers/plans/2026-07-28-p1b-backlog-notes.md` 티켓 1~5

## Global Constraints

- **대좌표 정밀도(P1a 최종 리뷰 Important 계승):** 리더는 (k,3) **float64** 원좌표 청크를 반환하고, 센터링(bbox_min 차감)은 `build_subcell_grid`가 float64로 수행한 뒤 float32로 저장한다. P1a의 "즉시 float32 캐스트"는 UTM급 좌표에서 cm급 지터를 유발해 개정됨 — 스펙 §5.2의 float32는 "센터링 이후 저장" 기준
- `median_z`는 **bbox_min[2] 기준 상대 높이**로 저장된다 (판정·잔차에 무영향, 절대 z가 필요한 소비자 없음)
- 구역 파라미터: 레벨 밴드 ±5cm, 최소 구역 면적 1m², 가구 의심 = 주 레벨 +0.3m 초과 & ≤3m², 유령(쌍봉) = 서브셀 정렬 z의 최대 간극 > 8mm 이고 양측 점유 ≥ 30%. bimodal 서브셀·ghost/furniture 구역은 잔차 NaN(판정 제외)
- 저밀도 마스크: 서브셀 점 수 < 3 → NaN (신뢰도 마스크, 스펙 §5.1.4)
- **하위 호환:** `evaluate_cells(..., zone_labels=None)`, `build_stats(..., zones=None)` 기본값으로 기존 테스트가 무수정 통과해야 함. `CellResult.zone_id`는 dataclass 끝에 기본값 필드로 추가
- 텍스트 리더: 공백·쉼표 구분, 앞 3열 = x y z, 숫자 3개를 만들 수 없는 행(헤더·PTS 개수 행·빈 줄)은 건너뜀
- 부호 규약(+융기/−침하), 직선자=상부 볼록 포락선, 판정식 2차 개정(U_eff=U×s), 축소 스팬 L<1m 판정 불가(단, 이산화 여유 한 스텝 허용 — Task 7), 코드 주석 한국어, 커밋 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` — 전부 P1a와 동일
- 테스트 실행: `engine/` 디렉터리에서 `python -m pytest`. 기존 51개 테스트는 항상 통과 유지(회귀 금지)

---

### Task 1: 리더 float64 계약 + 서브셀 센터링 (대좌표 정밀도)

**Files:**
- Modify: `engine/flatness/io/ply_reader.py` (float32 캐스트 2곳 → float64)
- Modify: `engine/flatness/io/las_reader.py` (float32 → float64)
- Modify: `engine/flatness/core/subcell.py` (float64 센터링, z 상대화, P1a NEP50 픽스 대체)
- Test: `engine/tests/test_georef.py` (신규), `engine/tests/test_las_reader.py` (laz 추가)

**Interfaces:**
- Consumes: 기존 `read_ply_chunks`/`read_las_chunks`/`build_subcell_grid`/`CloudInfo`
- Produces: 리더 청크 dtype이 float64로 변경(값·shape 불변). `SubcellGrid.median_z`는 bbox_min[2] 기준 상대 높이. 시그니처 변경 없음 — 후속 태스크는 dtype 무관

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_georef.py
"""대좌표(georeferenced) 정밀도 — 즉시 float32 캐스트였다면 cm급 지터가 나는 시나리오."""
import numpy as np
from tests.fixtures.synthetic import flat_floor, write_las, write_ascii_ply
from flatness.io.reader import iter_chunks, read_info
from flatness.core.subcell import build_subcell_grid

def _utm(pts):
    out = pts.copy()
    out[:, 0] += 254_000.0   # UTM급 x
    out[:, 1] += 4_180_000.0  # UTM급 y
    out[:, 2] += 53.0         # 절대 표고
    return out

def test_utm_las_grid_flat(tmp_path):
    # LAS는 오프셋+정수 저장이라 파일 자체는 무손실 — 리더·비닝의 정밀도만 검증됨
    pts = _utm(flat_floor(size=(2.0, 2.0), spacing=0.02))
    write_las(pts, tmp_path / "utm.las")
    info = read_info(tmp_path / "utm.las")
    g = build_subcell_grid(iter_chunks(tmp_path / "utm.las"), info, 1.0)
    assert np.nanmax(np.abs(g.median_z)) < 5e-4  # 상대화 후 평탄 ≈ 0 (지터 없음)

def test_utm_ascii_ply_grid_flat(tmp_path):
    # ascii PLY는 십진 문자열이라 대좌표도 무손실
    pts = _utm(flat_floor(size=(2.0, 2.0), spacing=0.02))
    write_ascii_ply(pts, tmp_path / "utm.ply")
    info = read_info(tmp_path / "utm.ply")
    g = build_subcell_grid(iter_chunks(tmp_path / "utm.ply"), info, 1.0)
    assert np.nanmax(np.abs(g.median_z)) < 5e-4

def test_reader_returns_float64(tmp_path):
    pts = flat_floor(size=(1.0, 1.0), spacing=0.1)
    write_las(pts, tmp_path / "a.las")
    c = next(iter_chunks(tmp_path / "a.las"))
    assert c.dtype == np.float64
```

```python
# engine/tests/test_las_reader.py 에 추가
def test_laz_roundtrip(tmp_path):
    # lazrs 백엔드로 .laz 쓰기·읽기 (백로그 티켓 4)
    pts = flat_floor(size=(1.0, 1.0), spacing=0.1)
    write_las(pts, tmp_path / "a.laz")
    got = np.vstack(list(read_las_chunks(tmp_path / "a.laz")))
    assert np.allclose(got, pts, atol=1e-3)
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_georef.py tests/test_las_reader.py -v`
Expected: test_utm_* FAIL(지터로 5e-4 초과) 또는 dtype FAIL. test_laz는 이미 통과할 수 있음(무방)

- [ ] **Step 3: 리더 수정**

`ply_reader.py`: ascii 분기 `np.asarray(buf, dtype=np.float32)` 2곳 → `np.float64`, binary 분기 `.astype(np.float32)` → `.astype(np.float64)`. 모듈 docstring을 "float64 원좌표 청크 스트리밍(센터링은 서브셀 비닝 책임)"으로 갱신.
`las_reader.py`: `.astype(np.float32)` → `.astype(np.float64)`, docstring 동일 취지 갱신.

- [ ] **Step 4: 서브셀 센터링 수정**

```python
# engine/flatness/core/subcell.py 의 build_subcell_grid 루프 교체
    # 대좌표 정밀도: float64로 센터링(bbox_min 차감)한 뒤 float32 저장.
    # P1a의 즉시 float32 캐스트는 UTM급 좌표에서 ulp 3~50cm 지터를 유발해 개정됨.
    for c in chunks:
        p = c.astype(np.float64) * scale_to_m
        rel_x = p[:, 0] - lo[0]
        rel_y = p[:, 1] - lo[1]
        ix = np.clip((rel_x / subcell_m).astype(np.int32), 0, nx - 1)
        iy = np.clip((rel_y / subcell_m).astype(np.int32), 0, ny - 1)
        idx_parts.append(iy.astype(np.int64) * nx + ix)
        z_parts.append((p[:, 2] - lo[2]).astype(np.float32))  # 상대 높이 저장
```
(P1a에서 넣었던 `lo32`/`sub32` 변수는 제거하고, 모듈 docstring의 메모리 추정 문구는 유지)

- [ ] **Step 5: 통과 확인 + 전체 스위트**

Run: `python -m pytest tests/test_georef.py tests/test_las_reader.py -v && python -m pytest -q`
Expected: 신규 4개 PASS + 기존 51개 회귀 없음 (총 55)

- [ ] **Step 6: Commit**

```bash
git add engine/
git commit -m "feat(engine): 리더 float64 계약 + 서브셀 float64 센터링 (대좌표 정밀도)"
```

---

### Task 2: 텍스트 리더 (XYZ/TXT/CSV/PTS)

**Files:**
- Create: `engine/flatness/io/text_reader.py`
- Modify: `engine/flatness/io/reader.py` (_READERS 등록)
- Test: `engine/tests/test_text_reader.py`

**Interfaces:**
- Consumes: 없음
- Produces: `read_text_chunks(path, chunk_size=2_000_000) -> Iterator[np.ndarray (k,3) float64]`, `iter_chunks`가 `.xyz/.txt/.csv/.pts` 디스패치

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_text_reader.py
import numpy as np
from flatness.io.reader import iter_chunks

def _collect(path):
    return np.vstack(list(iter_chunks(path, chunk_size=7)))

def test_xyz_space_separated(tmp_path):
    (tmp_path / "a.xyz").write_text("0 0 0\n1 0 0.01\n0 1 -0.02\n", encoding="utf-8")
    got = _collect(tmp_path / "a.xyz")
    assert np.allclose(got, [[0, 0, 0], [1, 0, 0.01], [0, 1, -0.02]])

def test_csv_with_header(tmp_path):
    (tmp_path / "a.csv").write_text("x,y,z\n0,0,0\n1.5,2.5,0.003\n", encoding="utf-8")
    got = _collect(tmp_path / "a.csv")
    assert got.shape == (2, 3) and abs(got[1, 2] - 0.003) < 1e-12

def test_pts_count_line_skipped(tmp_path):
    # PTS: 첫 줄 점 개수, 이후 x y z [intensity r g b]
    (tmp_path / "a.pts").write_text("2\n0 0 0 100 255 0 0\n1 1 0.01 100 0 255 0\n", encoding="utf-8")
    got = _collect(tmp_path / "a.pts")
    assert got.shape == (2, 3) and abs(got[1, 2] - 0.01) < 1e-12

def test_blank_and_comment_lines_skipped(tmp_path):
    (tmp_path / "a.txt").write_text("# header\n\n0 0 0\nnot a number line\n1 1 1\n", encoding="utf-8")
    got = _collect(tmp_path / "a.txt")
    assert got.shape == (2, 3)
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_text_reader.py -v`
Expected: FAIL (지원하지 않는 확장자 ValueError)

- [ ] **Step 3: 구현**

```python
# engine/flatness/io/text_reader.py
"""XYZ/TXT/CSV/PTS 텍스트 리더 — 공백·쉼표 구분, 앞 3열을 x y z로 해석.

숫자 3개를 만들 수 없는 행(헤더, PTS 점 개수 행, 빈 줄, 주석)은 건너뛴다.
"""
import numpy as np


def read_text_chunks(path, chunk_size=2_000_000):
    buf = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = line.replace(",", " ").split()
            if len(parts) < 3:
                continue
            try:
                buf.append((float(parts[0]), float(parts[1]), float(parts[2])))
            except ValueError:
                continue  # 비수치 행(헤더 등)
            if len(buf) >= chunk_size:
                yield np.asarray(buf, dtype=np.float64)
                buf = []
    if buf:
        yield np.asarray(buf, dtype=np.float64)
```

`reader.py`의 `_READERS`에 추가:
```python
from flatness.io.text_reader import read_text_chunks

_READERS = {".ply": read_ply_chunks, ".las": read_las_chunks, ".laz": read_las_chunks,
            ".xyz": read_text_chunks, ".txt": read_text_chunks,
            ".csv": read_text_chunks, ".pts": read_text_chunks}
```

- [ ] **Step 4: 통과 확인 + 전체 스위트**

Run: `python -m pytest tests/test_text_reader.py -v && python -m pytest -q`
Expected: 4 PASS + 회귀 없음

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/io/text_reader.py engine/flatness/io/reader.py engine/tests/test_text_reader.py
git commit -m "feat(engine): XYZ/TXT/CSV/PTS 텍스트 리더"
```

---

### Task 3: 서브셀 품질 마스크 (저밀도 NaN + 쌍봉 유령층 플래그)

**Files:**
- Modify: `engine/flatness/core/subcell.py`
- Test: `engine/tests/test_subcell.py` (테스트 추가)

**Interfaces:**
- Consumes: Task 1의 build_subcell_grid
- Produces: `SubcellGrid`에 `bimodal: np.ndarray (ny,nx) bool` 필드 추가(마지막 필드). `build_subcell_grid(..., min_points=3, bimodal_gap_m=0.008, bimodal_min_frac=0.3)` 키워드 인자 추가. 점 수 < min_points 서브셀은 median NaN

- [ ] **Step 1: 실패하는 테스트 작성** (`engine/tests/test_subcell.py`에 추가)

```python
def test_sparse_subcell_is_nan():
    # 점 3개 미만 서브셀은 신뢰 불가 → NaN (스펙 §5.1.4 신뢰도 마스크)
    pts = np.array([[0.01, 0.01, 0.5], [0.07, 0.01, 0.0], [0.08, 0.02, 0.0], [0.07, 0.03, 0.0]])
    g = _grid(pts, subcell=0.05)
    assert np.isnan(g.median_z[0, 0])       # 1점 서브셀 → NaN
    assert not np.isnan(g.median_z[0, 1])   # 3점 서브셀 → 유효

def test_bimodal_ghost_layer_flagged():
    # 같은 자리에 두 층(0mm/15mm)이 겹치면 쌍봉 → 유령층 플래그
    base = flat_floor(size=(0.3, 0.3), spacing=0.01)
    ghost = base.copy(); ghost[:, 2] += 0.015
    g = _grid(np.vstack([base, ghost]))
    assert g.bimodal[1, 1]                  # 내부 서브셀은 쌍봉 감지

def test_flat_floor_not_bimodal():
    g = _grid(flat_floor(size=(0.3, 0.3), spacing=0.01))
    assert not g.bimodal.any()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_subcell.py -v`
Expected: 신규 3개 FAIL (bimodal 속성 없음 / NaN 아님)

- [ ] **Step 3: 구현** (`subcell.py`)

```python
@dataclass
class SubcellGrid:
    size_m: float
    origin: np.ndarray
    shape: tuple
    median_z: np.ndarray
    counts: np.ndarray
    bimodal: np.ndarray  # 쌍봉(유령층 의심) 서브셀 플래그


def build_subcell_grid(chunks, info, scale_to_m, subcell_m=0.05,
                       min_points=3, bimodal_gap_m=0.008, bimodal_min_frac=0.3):
    ...  # Task 1의 센터링 루프 그대로
    median_z = np.full(ny * nx, np.nan, dtype=np.float32)
    counts = np.zeros(ny * nx, dtype=np.int32)
    bimodal = np.zeros(ny * nx, dtype=bool)
    for s, e in zip(starts, ends):
        seg = np.sort(z[s:e])
        k = len(seg)
        counts[idx[s]] = k
        if k < min_points:
            continue  # 저밀도 서브셀: NaN 유지 (신뢰도 마스크)
        median_z[idx[s]] = seg[(k - 1) // 2] if k % 2 else 0.5 * (seg[k // 2 - 1] + seg[k // 2])
        if k >= 4:
            gaps = np.diff(seg)
            gi = int(np.argmax(gaps))
            lower, upper = gi + 1, k - (gi + 1)
            # 정렬 z의 최대 간극이 크고 양측 점유가 충분하면 이중 표면(유령층)
            if gaps[gi] > bimodal_gap_m and lower >= k * bimodal_min_frac and upper >= k * bimodal_min_frac:
                bimodal[idx[s]] = True
    return SubcellGrid(size_m=subcell_m, origin=lo[:2].copy(), shape=(ny, nx),
                       median_z=median_z.reshape(ny, nx), counts=counts.reshape(ny, nx),
                       bimodal=bimodal.reshape(ny, nx))
```

- [ ] **Step 4: 통과 확인 + 전체 스위트**

Run: `python -m pytest tests/test_subcell.py -v && python -m pytest -q`
Expected: 신규 3 PASS + 회귀 없음

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/core/subcell.py engine/tests/test_subcell.py
git commit -m "feat(engine): 서브셀 저밀도 NaN + 쌍봉 유령층 플래그"
```

---

### Task 4: 높이 히스토그램 레벨 검출

**Files:**
- Create: `engine/flatness/core/levels.py`
- Test: `engine/tests/test_levels.py`

**Interfaces:**
- Consumes: `SubcellGrid.median_z`
- Produces: `detect_levels(median_z, bin_m=0.01, min_frac=0.03, merge_m=0.05) -> list[float]` (오름차순 레벨 높이, 빈 그리드는 [])

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_levels.py
import numpy as np
from tests.fixtures.synthetic import flat_floor, add_step
from flatness.core.levels import detect_levels
from tests.test_subcell import _grid

def test_single_level():
    g = _grid(flat_floor(size=(2.0, 2.0), spacing=0.02))
    levels = detect_levels(g.median_z)
    assert len(levels) == 1 and abs(levels[0]) < 0.02

def test_two_levels_step():
    g = _grid(add_step(flat_floor(size=(4.0, 2.0), spacing=0.02), 2.0, 0.5))
    levels = detect_levels(g.median_z)
    assert len(levels) == 2
    assert abs(levels[0] - 0.0) < 0.02 and abs(levels[1] - 0.5) < 0.02

def test_empty_grid():
    assert detect_levels(np.full((4, 4), np.nan, dtype=np.float32)) == []

def test_small_cluster_below_min_frac_ignored():
    # 전체의 1%만 차지하는 높이 클러스터는 레벨이 아님(노이즈)
    g = _grid(flat_floor(size=(4.0, 4.0), spacing=0.02))
    mz = g.median_z.copy()
    mz[0, 0] = 1.0  # 서브셀 1개짜리 이상 높이
    levels = detect_levels(mz)
    assert len(levels) == 1
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_levels.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# engine/flatness/core/levels.py
"""높이 히스토그램 기반 바닥 레벨 검출 — 다중 레벨(단차·중층) 바닥 대응 (스펙 §5.1.3)."""
import numpy as np


def detect_levels(median_z, bin_m=0.01, min_frac=0.03, merge_m=0.05):
    vals = median_z[~np.isnan(median_z)].astype(np.float64)
    if vals.size == 0:
        return []
    lo = float(vals.min())
    nbins = max(1, int(np.ceil((float(vals.max()) - lo) / bin_m)) + 1)
    hist, edges = np.histogram(vals, bins=nbins, range=(lo, lo + nbins * bin_m))
    thresh = max(3, int(min_frac * vals.size))
    peaks = []
    for i in range(len(hist)):
        left = hist[i - 1] if i > 0 else 0
        right = hist[i + 1] if i < len(hist) - 1 else 0
        if hist[i] >= thresh and hist[i] >= left and hist[i] >= right:
            peaks.append(0.5 * (edges[i] + edges[i + 1]))
    merged = []  # merge_m 이내로 붙은 피크는 하나의 레벨로 병합
    for p in peaks:
        if merged and p - merged[-1] < merge_m:
            merged[-1] = 0.5 * (merged[-1] + p)
        else:
            merged.append(p)
    return merged
```

- [ ] **Step 4: 통과 확인 + 전체 스위트**

Run: `python -m pytest tests/test_levels.py -v && python -m pytest -q`
Expected: 4 PASS + 회귀 없음

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/core/levels.py engine/tests/test_levels.py
git commit -m "feat(engine): 높이 히스토그램 레벨 검출"
```

---

### Task 5: 구역화 + 구역별 평면 잔차 (scipy 의존성 추가)

**Files:**
- Create: `engine/flatness/core/zones.py`
- Modify: `engine/pyproject.toml` (dependencies에 `"scipy>=1.11"` 추가)
- Test: `engine/tests/test_zones.py`

**Interfaces:**
- Consumes: Task 3 `SubcellGrid`(bimodal 포함), Task 4 `detect_levels`, 기존 `fit_plane_ransac`
- Produces:
  - `ZoneInfo` dataclass: `zone_id:int, level_m:float, n_subcells:int, area_m2:float, status:str('ok'|'ghost'|'furniture'), plane_abc:tuple|None`
  - `ZoneMap` dataclass: `labels: np.ndarray (ny,nx) int32 (0=미할당)`, `zones: list[ZoneInfo]`
  - `build_zones(grid, levels, band_m=0.05, min_area_m2=1.0, furniture_gap_m=0.3, furniture_max_m2=3.0, ghost_frac=0.2) -> tuple[ZoneMap, np.ndarray]` — 두 번째 반환은 잔차 그리드(float32, ok 구역 외·bimodal 서브셀은 NaN)

- [ ] **Step 1: pyproject 수정 후 설치**

`engine/pyproject.toml` dependencies에 `"scipy>=1.11"` 추가 후 `pip install -e ".[dev]"`

- [ ] **Step 2: 실패하는 테스트 작성**

```python
# engine/tests/test_zones.py
import numpy as np
from tests.fixtures.synthetic import flat_floor, add_bump
from flatness.core.levels import detect_levels
from flatness.core.zones import build_zones
from tests.test_subcell import _grid

def _two_rooms():
    # 방 A(x 0~4, z=0) + 0.4m 빈 틈 + 방 B(x 4.4~8.4, z=0.5)
    a = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b[:, 0] += 4.4
    b[:, 2] += 0.5
    return np.vstack([a, b])

def test_two_rooms_two_ok_zones():
    g = _grid(_two_rooms())
    zmap, res = build_zones(g, detect_levels(g.median_z))
    ok = [z for z in zmap.zones if z.status == "ok"]
    assert len(ok) == 2
    assert abs(ok[0].level_m - 0.0) < 0.03 and abs(ok[1].level_m - 0.5) < 0.03
    # 각 구역의 잔차는 평면 제거 후 ≈ 0, 틈은 NaN
    assert np.nanmax(np.abs(res)) < 5e-4
    assert (zmap.labels > 0).sum() > 0.9 * np.isfinite(g.median_z).sum()

def test_furniture_zone_excluded():
    # 3×3m 바닥 위 1.4×1.4m 상판(+0.7m) → furniture, 잔차 NaN
    floor = flat_floor(size=(3.0, 3.0), spacing=0.02)
    top = flat_floor(size=(1.4, 1.4), spacing=0.02)
    top[:, 0] += 0.8; top[:, 1] += 0.8; top[:, 2] += 0.7
    g = _grid(np.vstack([floor, top]))
    zmap, res = build_zones(g, detect_levels(g.median_z))
    stats = {z.status for z in zmap.zones}
    assert "furniture" in stats and "ok" in stats
    fz = next(z for z in zmap.zones if z.status == "furniture")
    assert np.isnan(res[zmap.labels == fz.zone_id]).all()

def test_ghost_subcells_masked():
    # 바닥 일부(1×1m)에 15mm 오프셋 이중층 → 해당 서브셀 잔차 NaN
    base = flat_floor(size=(3.0, 3.0), spacing=0.02)
    patch = flat_floor(size=(1.0, 1.0), spacing=0.02)
    patch[:, 0] += 1.0; patch[:, 1] += 1.0; patch[:, 2] += 0.015
    g = _grid(np.vstack([base, patch]))
    zmap, res = build_zones(g, detect_levels(g.median_z))
    ys, xs = np.nonzero(g.bimodal)
    assert len(ys) > 0 and np.isnan(res[ys, xs]).all()

def test_min_area_filters_specks():
    g = _grid(flat_floor(size=(2.0, 2.0), spacing=0.02))
    mz = g.median_z
    mz[0, 0] = 2.0  # 고립 서브셀 — 면적 미달로 구역이 되면 안 됨
    zmap, _ = build_zones(g, detect_levels(mz))
    assert all(z.area_m2 >= 1.0 for z in zmap.zones)
```

- [ ] **Step 3: 실패 확인**

Run: `python -m pytest tests/test_zones.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 4: 구현**

```python
# engine/flatness/core/zones.py
"""구역화 — 레벨 밴드 → 연결요소 → 구역별 로버스트 평면 잔차 (스펙 §5.1.3~4).

구역(연결요소)이 바닥의 실체다: 결함 구역이 RANSAC 인라이어에서 빠져
측정에서 제외되는 선택 편향을 구역 단위 처리로 회피한다.
"""
from dataclasses import dataclass
import numpy as np
from scipy import ndimage
from flatness.core.plane import fit_plane_ransac


@dataclass
class ZoneInfo:
    zone_id: int
    level_m: float
    n_subcells: int
    area_m2: float
    status: str
    plane_abc: tuple | None


@dataclass
class ZoneMap:
    labels: np.ndarray
    zones: list


def build_zones(grid, levels, band_m=0.05, min_area_m2=1.0,
                furniture_gap_m=0.3, furniture_max_m2=3.0, ghost_frac=0.2):
    mz = grid.median_z
    labels = np.zeros(mz.shape, dtype=np.int32)
    zones = []
    next_id = 1
    sub_area = grid.size_m * grid.size_m
    for level in levels:
        mask = (np.abs(mz - level) <= band_m) & (labels == 0)
        lab, n = ndimage.label(mask)
        for comp in range(1, n + 1):
            m = lab == comp
            n_sub = int(m.sum())
            if n_sub * sub_area < min_area_m2:
                continue  # 최소 면적 미달 파편 배제
            labels[m] = next_id
            zones.append(ZoneInfo(next_id, float(level), n_sub, n_sub * sub_area, "ok", None))
            next_id += 1
    residuals = np.full(mz.shape, np.nan, dtype=np.float32)
    if not zones:
        return ZoneMap(labels, zones), residuals
    main = max(zones, key=lambda z: z.area_m2)  # 주 레벨 = 최대 면적 구역
    for z in zones:
        m = labels == z.zone_id
        if z.zone_id != main.zone_id and z.level_m > main.level_m + furniture_gap_m \
                and z.area_m2 <= furniture_max_m2:
            z.status = "furniture"  # 가구 상판 의심: 판정 제외 (스펙 §5.1.3)
            continue
        if float(grid.bimodal[m].mean()) > ghost_frac:
            z.status = "ghost"      # 구역 대부분이 이중층: 재스캔 필요
            continue
        ys, xs = np.nonzero(m)
        # 구역 로컬 좌표로 피팅(대좌표 조건수 문제 회피 — origin 무관)
        cx = (xs + 0.5) * grid.size_m
        cy = (ys + 0.5) * grid.size_m
        a, b, c = fit_plane_ransac(cx, cy, mz[ys, xs].astype(float))
        z.plane_abc = (a, b, c)
        residuals[ys, xs] = (mz[ys, xs] - (a * cx + b * cy + c)).astype(np.float32)
    residuals[grid.bimodal] = np.nan  # 쌍봉 서브셀은 어느 구역이든 판정 제외
    return ZoneMap(labels, zones), residuals
```

- [ ] **Step 5: 통과 확인 + 전체 스위트**

Run: `python -m pytest tests/test_zones.py -v && python -m pytest -q`
Expected: 5 PASS + 회귀 없음

- [ ] **Step 6: Commit**

```bash
git add engine/pyproject.toml engine/flatness/core/zones.py engine/tests/test_zones.py
git commit -m "feat(engine): 레벨 밴드 연결요소 구역화 + 구역별 평면 잔차"
```

---

### Task 6: 셀 평가 구역 인지형 확장

**Files:**
- Modify: `engine/flatness/core/cells.py`
- Test: `engine/tests/test_cells.py` (테스트 추가)

**Interfaces:**
- Consumes: Task 5 `ZoneMap.labels`
- Produces: `evaluate_cells(residuals, grid, span_m, cell_m=1.0, min_occupancy=0.7, min_span_m=1.0, zone_labels=None)`. `CellResult`에 `zone_id: int | None = None` 필드 추가(맨 끝, 기본값). zone_labels 지정 시 프로파일은 셀의 지배 구역 서브셀만 사용, 지배 구역 없으면 판정 불가

- [ ] **Step 1: 실패하는 테스트 작성** (`engine/tests/test_cells.py`에 추가)

```python
def test_zone_filter_blocks_cross_zone_leak():
    # 좌(구역1, 잔차 0)·우(구역2, 잔차 +50mm) 인접 — 필터 없으면 경계 셀이 50mm 오염
    res = np.zeros((60, 120), dtype=np.float32)
    res[:, 60:] = 0.05
    labels = np.ones((60, 120), dtype=np.int32)
    labels[:, 60:] = 2
    from flatness.core.subcell import SubcellGrid
    g = SubcellGrid(0.05, np.zeros(2), (60, 120),
                    res.copy(), np.full((60, 120), 9, np.int32), np.zeros((60, 120), bool))
    cells = evaluate_cells(res, g, span_m=3.0, zone_labels=labels)
    z1 = [c for c in cells if c.zone_id == 1 and c.value_mm is not None]
    assert len(z1) > 0
    assert all(c.value_mm < 0.5 for c in z1)  # 구역2의 +50mm가 새어들지 않음

def test_no_zone_cell_is_na():
    res = np.zeros((40, 40), dtype=np.float32)
    labels = np.zeros((40, 40), dtype=np.int32)  # 전부 미할당
    from flatness.core.subcell import SubcellGrid
    g = SubcellGrid(0.05, np.zeros(2), (40, 40),
                    res.copy(), np.full((40, 40), 9, np.int32), np.zeros((40, 40), bool))
    cells = evaluate_cells(res, g, span_m=3.0, zone_labels=labels)
    assert all(c.value_mm is None for c in cells)
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_cells.py -v`
Expected: 신규 2개 FAIL (zone_labels 인자 없음)

- [ ] **Step 3: 구현** (`cells.py` 수정 요점)

```python
@dataclass
class CellResult:
    ...  # 기존 9필드 그대로
    zone_id: int | None = None  # 소속 구역 (P1b, 기본값으로 하위 호환)


def _profile(residuals, ai, aj, di, dj, half_steps, step_m, labels=None, zid=None):
    ...
        if 0 <= i < nx and 0 <= j < ny and not np.isnan(residuals[j, i]):
            if labels is not None and labels[j, i] != zid:
                continue  # 다른 구역(벽 너머 등) 서브셀 유입 차단 (스펙 §5.1.6)
            ...


def _dominant_zone(zone_labels, y0, y1, x0, x1):
    """셀 블록의 지배(최빈) 구역 id, 할당 서브셀이 없으면 None."""
    block = zone_labels[y0:y1, x0:x1]
    ids, counts = np.unique(block[block > 0], return_counts=True)
    return int(ids[np.argmax(counts)]) if ids.size else None


def evaluate_cells(residuals, grid, span_m, cell_m=1.0, min_occupancy=0.7,
                   min_span_m=1.0, zone_labels=None):
    ...
            zid = None
            if zone_labels is not None:
                zid = _dominant_zone(zone_labels, y0, y1, x0, x1)
                if zid is None:
                    results.append(CellResult(cx, cy, center_x, center_y, None,
                                              0.0, occupancy, None, None, None))
                    continue
            ...
                        pos, height, idx = _profile(residuals, ai, aj, di, dj, half, step,
                                                    labels=zone_labels, zid=zid)
            ...  # CellResult 생성부 두 곳에 zone_id=zid 전달
```

- [ ] **Step 4: 통과 확인 + 전체 스위트**

Run: `python -m pytest tests/test_cells.py -v && python -m pytest -q`
Expected: 신규 2 + 기존 5 PASS, 전체 회귀 없음

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/core/cells.py engine/tests/test_cells.py
git commit -m "feat(engine): 셀 평가 구역 인지형 확장 (교차 구역 오염 차단)"
```

---

### Task 7: 대각 스팬 이산화 보정 (백로그 티켓 2)

**Files:**
- Modify: `engine/flatness/core/cells.py` (min_span 검사 1줄)
- Test: `engine/tests/test_cells.py` (테스트 추가)

**Interfaces:**
- Consumes/Produces: 시그니처 불변. 동작 변경: 풀 대각 라인이 이산화로 min_span에 한 스텝 못 미치는 경우(span=1m에서 L=0.99m) 허용

- [ ] **Step 1: 실패하는 테스트 작성**

```python
def test_span1_diagonals_participate():
    # span=1m: 대각 풀 라인 L=14*0.0707=0.99m — 이산화 여유 없이는 전멸 (백로그 티켓 2)
    res = np.zeros((60, 60), dtype=np.float32)
    from flatness.core.subcell import SubcellGrid
    g = SubcellGrid(0.05, np.zeros(2), (60, 60),
                    res.copy(), np.full((60, 60), 9, np.int32), np.zeros((60, 60), bool))
    cells = evaluate_cells(res, g, span_m=1.0)
    valid = [c for c in cells if c.value_mm is not None]
    assert len(valid) == len(cells)  # 모든 셀 판정 가능
    assert all(c.span_used_m >= 0.9 for c in valid)
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_cells.py::test_span1_diagonals_participate -v`
Expected: 통과할 수도 있음(축 방향이 살아있어 셀은 유효). FAIL이 아니면 아래 강화 단언을 추가해 대각 참여를 직접 확인:

```python
def test_span1_reduced_span_accepted_within_one_step():
    # 대각 스텝(0.0707) 한 칸 여유 규칙을 직접 검증
    from flatness.core.cells import _SQRT2
    step = 0.05 * _SQRT2
    L = 14 * step  # 0.9899...
    assert L < 1.0 and L + step >= 1.0  # 규칙: L + step >= min_span 이면 허용
```

- [ ] **Step 3: 구현** (`cells.py`의 min_span 검사)

```python
                        if L + step < min_span_m:  # 이산화 여유 한 스텝 (백로그 티켓 2)
                            continue
```

- [ ] **Step 4: 통과 확인 + 전체 스위트**

Run: `python -m pytest tests/test_cells.py -v && python -m pytest -q`
Expected: 전체 PASS (기존 축소 스팬 테스트 회귀 없음 — L≥1.0 케이스는 동작 불변)

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/core/cells.py engine/tests/test_cells.py
git commit -m "fix(engine): 대각 스팬 이산화 여유 한 스텝 허용"
```

---

### Task 8: 파이프라인 v2 (다중 구역) + stats 확장 + CLI

**Files:**
- Modify: `engine/flatness/core/pipeline.py`, `engine/flatness/outputs/stats.py`, `engine/flatness/cli.py`
- Test: `engine/tests/test_pipeline.py` (테스트 추가)

**Interfaces:**
- Consumes: Task 4~7 전부
- Produces:
  - `analyze_floor` 시그니처 불변, 내부가 다중 구역 흐름으로 교체
  - `build_stats(cells, grades, crit, u_mm, warnings, meta, zones=None)` — `stats["zones"] = zones or []` (각 항목: `{zone_id, level_m, area_m2, status, plane_abc}`), `stats["coverage_pct"]`는 **ok 구역 서브셀 / 유효 서브셀** 비율로 재정의(바닥 인식 비율, 스펙 §5.1.3)
  - 파이프라인 경고 추가: bimodal 서브셀 존재 → `"ghost_layer_rescan"`, furniture 구역 존재 → `"furniture_excluded"`, ghost 구역 존재 → `"ghost_zone_excluded"`
  - CLI 출력에 구역 수·경고 표시 (형식: `구역 N개 (제외: 유령 X, 가구 Y)`)

- [ ] **Step 1: 실패하는 테스트 작성** (`engine/tests/test_pipeline.py`에 추가)

```python
# (파일 상단에 `import numpy as np`가 없으면 추가할 것)
def test_two_rooms_independent_verdicts(tmp_path):
    # 방 A(z=0) + 방 B(z=0.5, 10mm 함몰) — 구역 독립 판정, 교차 오염 없음
    a = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b = add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02), (2.0, 1.5), 0.3, -0.010)
    b[:, 0] += 4.4
    b[:, 2] += 0.5
    write_binary_ply(np.vstack([a, b]), tmp_path / "rooms.ply")
    stats = analyze_floor(tmp_path / "rooms.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert len([z for z in stats["zones"] if z["status"] == "ok"]) == 2
    assert 9.0 <= stats["worst"]["value_mm"] <= 11.0
    assert abs(stats["worst"]["point_x"] - 6.4) < 1.0   # 함몰은 방 B(4.4+2.0)에
    assert stats["coverage_pct"] > 85.0
    # 방 A 셀은 전부 적합(구역 경계·레벨 차가 새어들지 않음)
    import json
    cells = json.loads((tmp_path / "out" / "cells.json").read_text("utf-8"))
    room_a = [c for c in cells if c["center_x"] < 4.0 and c["grade"] != "na"]
    assert len(room_a) >= 6 and all(c["grade"] == "pass" for c in room_a)

def test_ghost_patch_warns_and_masks(tmp_path):
    base = flat_floor(size=(6.0, 4.0), spacing=0.02)
    patch = flat_floor(size=(1.0, 1.0), spacing=0.02)
    patch[:, 0] += 2.0; patch[:, 1] += 1.5; patch[:, 2] += 0.015
    write_binary_ply(np.vstack([base, patch]), tmp_path / "ghost.ply")
    stats = analyze_floor(tmp_path / "ghost.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert "ghost_layer_rescan" in stats["warnings"]
    assert stats["grade_counts"]["na"] >= 1  # 이중층 지역은 판정 불가
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_pipeline.py -v`
Expected: 신규 2개 FAIL (stats에 zones 없음 / 단일 구역 파이프라인)

- [ ] **Step 3: 파이프라인 구현**

```python
# engine/flatness/core/pipeline.py — analyze_floor 본문 교체
"""바닥 분석 오케스트레이션 v2 — 다중 구역·품질 마스크 (스펙 §5.1.3~4, P1b)."""
import numpy as np
from flatness.io.reader import iter_chunks, read_info
from flatness.core.subcell import build_subcell_grid
from flatness.core.levels import detect_levels
from flatness.core.zones import build_zones
from flatness.core.cells import evaluate_cells
from flatness.criteria import grade_cells
from flatness.outputs.stats import build_stats, write_outputs
from flatness.outputs.heatmap import render_heatmap


def analyze_floor(path, scale_to_m, criterion, u_mm, out_dir,
                  subcell_m=0.05, cell_m=1.0, chunk_size=2_000_000):
    info = read_info(path, chunk_size=chunk_size)
    grid = build_subcell_grid(iter_chunks(path, chunk_size=chunk_size),
                              info, scale_to_m, subcell_m)
    n_valid_sub = int(np.isfinite(grid.median_z).sum())
    if n_valid_sub < 10:
        raise ValueError("유효 서브셀 부족 — 바닥 미검출")
    levels = detect_levels(grid.median_z)
    zmap, residuals = build_zones(grid, levels)
    ok_zones = [z for z in zmap.zones if z.status == "ok"]
    if not ok_zones:
        raise ValueError("판정 가능한 바닥 구역 없음 — 재스캔 또는 파라미터 확인 필요")
    span = criterion.span_m if criterion.span_m else 3.0
    cells = evaluate_cells(residuals, grid, span_m=span, cell_m=cell_m,
                           zone_labels=zmap.labels)
    grades, warns = grade_cells(cells, criterion, u_mm)
    warns = list(warns)
    if bool(grid.bimodal.any()):
        warns.append("ghost_layer_rescan")
    if any(z.status == "furniture" for z in zmap.zones):
        warns.append("furniture_excluded")
    if any(z.status == "ghost" for z in zmap.zones):
        warns.append("ghost_zone_excluded")
    ok_sub = sum(z.n_subcells for z in ok_zones)
    coverage = round(100.0 * ok_sub / n_valid_sub, 1)  # 바닥 인식 비율 (스펙 §5.1.3)
    zones_out = [{"zone_id": z.zone_id, "level_m": round(z.level_m, 3),
                  "area_m2": round(z.area_m2, 2), "status": z.status,
                  "plane_abc": None if z.plane_abc is None else [round(v, 6) for v in z.plane_abc]}
                 for z in zmap.zones]
    meta = {"file": str(path), "n_points": info.n_points, "scale_to_m": scale_to_m,
            "subcell_m": subcell_m, "cell_m": cell_m, "engine_version": "p1b-0.2.0"}
    stats = build_stats(cells, grades, criterion, u_mm, sorted(set(warns)), meta,
                        zones=zones_out)
    stats["coverage_pct"] = coverage  # 셀 기반 계산을 서브셀 기반 정의로 덮어씀
    write_outputs(out_dir, stats, cells, grades)
    render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
    return stats
```

- [ ] **Step 4: stats·CLI 수정**

`stats.py`: `def build_stats(cells, grades, crit, u_mm, warnings, meta, zones=None):` — 반환 dict에 `"zones": zones or []` 추가 (다른 키 불변).
`cli.py`: 성공 출력에 아래 줄 추가(판정 분포 줄 다음):
```python
    zs = stats.get("zones", [])
    n_ghost = sum(1 for z in zs if z["status"] == "ghost")
    n_furn = sum(1 for z in zs if z["status"] == "furniture")
    print(f"  구역 {len(zs)}개 (제외: 유령 {n_ghost}, 가구 {n_furn})  바닥 인식률 {stats['coverage_pct']}%")
    if "ghost_layer_rescan" in stats.get("warnings", []):
        # cp949 콘솔 호환을 위해 특수기호 대신 텍스트 사용
        print("  주의: 이중 표면(유령층) 감지 — 해당 지역 판정 불가, 재스캔 권장")
```

- [ ] **Step 5: 통과 확인 + 전체 스위트**

Run: `python -m pytest tests/test_pipeline.py tests/test_cli.py -v && python -m pytest -q`
Expected: 신규 2 + 기존 전부 PASS (기존 단일 바닥 E2E는 구역 1개로 동일 결과)

- [ ] **Step 6: Commit**

```bash
git add engine/flatness/core/pipeline.py engine/flatness/outputs/stats.py engine/flatness/cli.py engine/tests/test_pipeline.py
git commit -m "feat(engine): 다중 구역 파이프라인 v2 + zones/coverage stats + CLI"
```

---

### Task 9: 통합 검증 스모크 + 문서 갱신

**Files:**
- Modify: `docs/superpowers/plans/2026-07-28-p1b-backlog-notes.md` (해결 티켓 체크 표시)
- Test: 전체 스위트 + 수동 스모크

- [ ] **Step 1: 전체 스위트**

Run: `cd engine && python -m pytest -q`
Expected: 전체 PASS (P1a 51 + P1b 신규 ~20)

- [ ] **Step 2: 수동 스모크 — 2구역 데모** (산출물은 임시 폴더, 커밋 금지)

```bash
cd engine && python -c "
import numpy as np
from tests.fixtures.synthetic import flat_floor, add_bump, write_binary_ply
a = flat_floor(size=(4.0,3.0), spacing=0.02)
b = add_bump(flat_floor(size=(4.0,3.0), spacing=0.02), (2.0,1.5), 0.3, -0.012)
b[:,0] += 4.4; b[:,2] += 0.5
write_binary_ply(np.vstack([a,b]), 'demo2.ply')
" && python -m flatness.cli analyze demo2.ply --units m --out demo2_out && rm -f demo2.ply
```
Expected: exit 0, `구역 2개`, 함몰 12mm가 방 B 좌표(≈6.4, 1.5)에서 검출, heatmap.png에서 방 A 전체 초록·방 B에 결함 색상 확인(눈으로). 확인 후 `rm -rf demo2_out`

- [ ] **Step 3: 백로그 갱신**

`2026-07-28-p1b-backlog-notes.md`의 티켓 1(float64 센터링), 2(대각 보정), 4(.laz 테스트), 5(단위 경계 — P1b에서 다루지 않았으면 그대로 둠) 중 해결된 항목 앞에 `[해결: P1b]` 표기.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: P1b 해결 티켓 표기"
```

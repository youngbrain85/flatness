# P1a 분석 엔진 코어(최소 파이프라인) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PLY/LAS 점군 파일을 받아 단일 구역 바닥의 평활도를 직선자 시뮬레이션으로 판정하고 stats.json·cells.json·heatmap.png·results.csv를 출력하는 CLI 엔진.

**Architecture:** 2-pass 스트리밍(1차 bbox/개수, 2차 서브셀 비닝) → 5cm 서브셀 중앙값 그리드 → 높이형 RANSAC 평면 제거 → 셀(1m)별 4방향 상부 볼록 포락선 직선자 → §4.2 판정식 → 산출물. 순수 NumPy(이 슬라이스에서 Open3D 금지).

**Tech Stack:** Python 3.11+, numpy, laspy[lazrs], matplotlib, pytest. 패키지 루트 `engine/`, 패키지명 `flatness`.

**Spec:** `docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md` (§4.2 판정식, §5.1 파이프라인, §5.2 성능, §10 테스트)

## Global Constraints

- 단위 자동 확정 금지: `--units` 미지정 시 감지 결과·근거 출력 후 **exit code 2** (스펙 §5.1.1)
- 부호 규약: **+ = 융기, − = 침하** (스펙 §5.1.7)
- 판정식: s=span_used/span, pe=pass_mm×s, re=rework_mm×s, b1=pe−U, b2=min(pe+U, re) → 적합≤b1 < 경계≤b2 < 보수≤re < 재시공. pe+U≥re면 `uncertainty_swallows_repair` 경고 (스펙 §4.2)
- U 기본값: 바닥 5mm (스펙 §4.2, CLI `--uncertainty-mm`로 조정)
- 축소 스팬: L<span이면 선형 환산(위 s), **L<1m이면 판정 불가** (스펙 §4.2)
- 직선자 = 상부 볼록 포락선 아래 최대 틈새. LSQ 평면 편차 방식 금지 (스펙 §5.1.6)
- 서브셀 5cm 중앙값, 판정 셀 1m, 4방향 셀 내 전 라인 스윕(윈도우는 각 라인의 셀 중심 최근접점 정렬), 점유율 70% 미만 판정 불가 (스펙 §5.1.6 개정판)
- 좌표 연산은 float32, 청크 단위 처리 (스펙 §5.2. 단, 1a는 정렬 기반 중앙값 허용 — 1d에서 메모리 검증)
- 픽스처 허용 오차: 직선자 값 ±1mm, 결함 위치 셀 1칸 이내 (스펙 §10.1)
- 코드 주석은 한국어 (사용자 전역 지시)
- 커밋: `git commit`은 각 태스크 마지막 스텝에서, 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 포함
- 모든 테스트 실행은 `engine/` 디렉터리에서 `python -m pytest`

---

### Task 1: 엔진 스캐폴드 + 합성 점군 픽스처 생성기

**Files:**
- Create: `engine/pyproject.toml`
- Create: `engine/flatness/__init__.py` (빈 파일), `engine/flatness/io/__init__.py`, `engine/flatness/core/__init__.py`, `engine/flatness/outputs/__init__.py`, `engine/tests/__init__.py`, `engine/tests/fixtures/__init__.py`
- Create: `engine/tests/fixtures/synthetic.py`
- Test: `engine/tests/test_synthetic.py`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `flat_floor(size=(6.0,6.0), spacing=0.02, noise_sd=0.0, tilt=(0.0,0.0), seed=0) -> np.ndarray (n,3) float64[m]`, `add_bump(pts, center, radius, height) -> np.ndarray`, `add_step(pts, x_split, height) -> np.ndarray`, `write_ascii_ply(pts, path)`, `write_binary_ply(pts, path)`, `write_las(pts, path)`

- [ ] **Step 1: pyproject 작성**

```toml
# engine/pyproject.toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "flatness-engine"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["numpy>=1.26", "laspy[lazrs]>=2.5", "matplotlib>=3.8"]

[project.optional-dependencies]
dev = ["pytest>=8"]

[project.scripts]
flatness = "flatness.cli:main"

[tool.setuptools.packages.find]
include = ["flatness*"]

[tool.setuptools.package-data]
flatness = ["data/*.json"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: 패키지 골격 생성 후 설치**

빈 `__init__.py` 6개 생성 후 실행: `cd engine && pip install -e .[dev]`
Expected: 설치 성공

- [ ] **Step 3: 실패하는 테스트 작성**

```python
# engine/tests/test_synthetic.py
import numpy as np
from tests.fixtures.synthetic import flat_floor, add_bump, add_step

def test_flat_floor_shape_and_extent():
    pts = flat_floor(size=(2.0, 2.0), spacing=0.05)
    assert pts.shape[1] == 3
    assert abs(pts[:, 0].max() - 2.0) < 0.06 and pts[:, 0].min() >= -1e-9
    assert np.allclose(pts[:, 2], 0.0)  # 무노이즈·무경사면 z=0

def test_tilt_applied():
    pts = flat_floor(size=(2.0, 2.0), spacing=0.05, tilt=(0.02, 0.0))
    # x=2 끝에서 z ≈ 0.04m
    edge = pts[pts[:, 0] > 1.9]
    assert abs(edge[:, 2].mean() - 0.02 * edge[:, 0].mean()) < 1e-6

def test_bump_peak_height():
    pts = flat_floor(size=(2.0, 2.0), spacing=0.01)
    pts = add_bump(pts, center=(1.0, 1.0), radius=0.3, height=0.01)
    assert abs(pts[:, 2].max() - 0.01) < 1e-4  # 코사인 범프 정점 = height

def test_step_height():
    pts = flat_floor(size=(2.0, 2.0), spacing=0.05)
    pts = add_step(pts, x_split=1.0, height=0.015)
    assert np.allclose(pts[pts[:, 0] >= 1.0][:, 2], 0.015)
    assert np.allclose(pts[pts[:, 0] < 1.0][:, 2], 0.0)

def test_ply_roundtrip(tmp_path):
    from tests.fixtures.synthetic import write_ascii_ply, write_binary_ply
    pts = flat_floor(size=(1.0, 1.0), spacing=0.2)
    write_ascii_ply(pts, tmp_path / "a.ply")
    write_binary_ply(pts, tmp_path / "b.ply")
    assert (tmp_path / "a.ply").read_bytes().startswith(b"ply")
    assert (tmp_path / "b.ply").stat().st_size > 0

def test_las_written(tmp_path):
    from tests.fixtures.synthetic import write_las
    pts = flat_floor(size=(1.0, 1.0), spacing=0.2)
    write_las(pts, tmp_path / "a.las")
    assert (tmp_path / "a.las").stat().st_size > 0
```

- [ ] **Step 4: 실패 확인**

Run: `python -m pytest tests/test_synthetic.py -v`
Expected: FAIL (ModuleNotFoundError: tests.fixtures.synthetic)

- [ ] **Step 5: 픽스처 구현**

```python
# engine/tests/fixtures/synthetic.py
"""합성 점군 생성기 — 정답을 아는 결함을 주입해 엔진을 정량 검증한다."""
import numpy as np


def flat_floor(size=(6.0, 6.0), spacing=0.02, noise_sd=0.0, tilt=(0.0, 0.0), seed=0):
    """평탄 바닥 점군 (n,3) float64[m]. tilt=(sx,sy)는 기울기(무차원)."""
    rng = np.random.default_rng(seed)
    xs = np.arange(0.0, size[0] + spacing / 2, spacing)
    ys = np.arange(0.0, size[1] + spacing / 2, spacing)
    gx, gy = np.meshgrid(xs, ys)
    z = tilt[0] * gx + tilt[1] * gy
    if noise_sd > 0:
        z = z + rng.normal(0.0, noise_sd, z.shape)
    return np.column_stack([gx.ravel(), gy.ravel(), z.ravel()])


def add_bump(pts, center, radius, height):
    """코사인 범프 — 정점 높이가 정확히 height. + = 융기."""
    out = pts.copy()
    r = np.hypot(out[:, 0] - center[0], out[:, 1] - center[1])
    m = r < radius
    out[m, 2] += height * 0.5 * (1.0 + np.cos(np.pi * r[m] / radius))
    return out


def add_step(pts, x_split, height):
    """x >= x_split 영역을 height만큼 올린 단차."""
    out = pts.copy()
    out[out[:, 0] >= x_split, 2] += height
    return out


def _ply_header(n, fmt):
    return (f"ply\nformat {fmt} 1.0\nelement vertex {n}\n"
            "property float x\nproperty float y\nproperty float z\nend_header\n")


def write_ascii_ply(pts, path):
    with open(path, "w", newline="\n") as f:
        f.write(_ply_header(len(pts), "ascii"))
        for x, y, z in pts:
            f.write(f"{x} {y} {z}\n")


def write_binary_ply(pts, path):
    with open(path, "wb") as f:
        f.write(_ply_header(len(pts), "binary_little_endian").encode())
        f.write(pts.astype("<f4").tobytes())


def write_las(pts, path):
    import laspy
    header = laspy.LasHeader(point_format=0, version="1.2")
    header.scales = np.array([0.0001, 0.0001, 0.0001])
    header.offsets = pts.min(axis=0)
    las = laspy.LasData(header)
    las.x, las.y, las.z = pts[:, 0], pts[:, 1], pts[:, 2]
    las.write(str(path))
```

- [ ] **Step 6: 통과 확인**

Run: `python -m pytest tests/test_synthetic.py -v`
Expected: 6 PASS

- [ ] **Step 7: Commit**

```bash
git add engine/
git commit -m "feat(engine): 스캐폴드 + 합성 점군 픽스처 생성기"
```

---

### Task 2: PLY 리더 (ascii/binary, 청크 스트리밍)

**Files:**
- Create: `engine/flatness/io/ply_reader.py`
- Test: `engine/tests/test_ply_reader.py`

**Interfaces:**
- Consumes: Task 1 픽스처
- Produces: `read_ply_chunks(path, chunk_size=2_000_000) -> Iterator[np.ndarray (k,3) float32]` — x/y/z만 추출, 여타 property·element(면 포함)는 건너뜀

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_ply_reader.py
import numpy as np
from tests.fixtures.synthetic import flat_floor, write_ascii_ply, write_binary_ply
from flatness.io.ply_reader import read_ply_chunks

def _collect(path, chunk_size=1000):
    return np.vstack(list(read_ply_chunks(path, chunk_size=chunk_size)))

def test_ascii_ply_roundtrip(tmp_path):
    pts = flat_floor(size=(1.0, 1.0), spacing=0.1)
    write_ascii_ply(pts, tmp_path / "a.ply")
    got = _collect(tmp_path / "a.ply", chunk_size=7)  # 청크 경계 검증용 소수
    assert got.shape == (len(pts), 3)
    assert np.allclose(got, pts, atol=1e-4)

def test_binary_ply_roundtrip(tmp_path):
    pts = flat_floor(size=(1.0, 1.0), spacing=0.1)
    write_binary_ply(pts, tmp_path / "b.ply")
    got = _collect(tmp_path / "b.ply")
    assert np.allclose(got, pts, atol=1e-4)

def test_extra_properties_skipped(tmp_path):
    # x/y/z 외 property(색상)가 있어도 좌표만 추출
    header = ("ply\nformat binary_little_endian 1.0\nelement vertex 2\n"
              "property float x\nproperty float y\nproperty float z\n"
              "property uchar red\nproperty uchar green\nproperty uchar blue\n"
              "end_header\n")
    import struct
    body = b"".join(struct.pack("<fffBBB", i, i, i, 255, 0, 0) for i in range(2))
    (tmp_path / "c.ply").write_bytes(header.encode() + body)
    got = _collect(tmp_path / "c.ply")
    assert np.allclose(got, [[0, 0, 0], [1, 1, 1]])
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_ply_reader.py -v`
Expected: FAIL (ModuleNotFoundError: flatness.io.ply_reader)

- [ ] **Step 3: 구현**

```python
# engine/flatness/io/ply_reader.py
"""PLY 리더 — vertex의 x/y/z만 float32 청크로 스트리밍. 면·기타 속성은 무시."""
import numpy as np

_TYPES = {"char": "i1", "uchar": "u1", "int8": "i1", "uint8": "u1",
          "short": "i2", "ushort": "u2", "int16": "i2", "uint16": "u2",
          "int": "i4", "uint": "u4", "int32": "i4", "uint32": "u4",
          "float": "f4", "float32": "f4", "double": "f8", "float64": "f8"}


def _parse_header(f):
    if f.readline().strip() != b"ply":
        raise ValueError("PLY 매직 누락")
    fmt, n_vertex, props, in_vertex = None, None, [], False
    while True:
        line = f.readline()
        if not line:
            raise ValueError("end_header 누락")
        tok = line.decode("ascii", "replace").split()
        if not tok:
            continue
        if tok[0] == "format":
            fmt = tok[1]
        elif tok[0] == "element":
            in_vertex = tok[1] == "vertex"
            if in_vertex:
                n_vertex = int(tok[2])
        elif tok[0] == "property" and in_vertex:
            if tok[1] == "list":
                raise ValueError("vertex list property 미지원")
            props.append((tok[2], _TYPES[tok[1]]))
        elif tok[0] == "end_header":
            break
    if fmt not in ("ascii", "binary_little_endian"):
        raise ValueError(f"미지원 PLY 포맷: {fmt}")
    if n_vertex is None:
        raise ValueError("vertex element 없음")
    names = [p[0] for p in props]
    if not all(c in names for c in ("x", "y", "z")):
        raise ValueError("x/y/z property 없음")
    return fmt, n_vertex, props


def read_ply_chunks(path, chunk_size=2_000_000):
    with open(path, "rb") as f:
        fmt, n_vertex, props = _parse_header(f)
        if fmt == "ascii":
            cols = [i for i, p in enumerate(props) if p[0] in ("x", "y", "z")]
            order = [props[i][0] for i in cols]
            sel = [cols[order.index(c)] for c in ("x", "y", "z")]
            done, buf = 0, []
            for line in f:
                if done >= n_vertex:
                    break
                v = line.split()
                buf.append([float(v[sel[0]]), float(v[sel[1]]), float(v[sel[2]])])
                done += 1
                if len(buf) >= chunk_size:
                    yield np.asarray(buf, dtype=np.float32); buf = []
            if buf:
                yield np.asarray(buf, dtype=np.float32)
        else:
            dt = np.dtype([(p[0], "<" + p[1]) for p in props])  # 중복 property명은 유효 PLY가 아님
            done = 0
            while done < n_vertex:
                k = min(chunk_size, n_vertex - done)
                rec = np.fromfile(f, dtype=dt, count=k)
                if len(rec) < k:
                    raise ValueError("PLY 본문이 header 개수보다 짧음")
                yield np.column_stack([rec["x"], rec["y"], rec["z"]]).astype(np.float32)
                done += k
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_ply_reader.py -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/io/ply_reader.py engine/tests/test_ply_reader.py
git commit -m "feat(engine): PLY 청크 리더 (ascii/binary)"
```

---

### Task 3: LAS/LAZ 리더

**Files:**
- Create: `engine/flatness/io/las_reader.py`
- Test: `engine/tests/test_las_reader.py`

**Interfaces:**
- Consumes: Task 1 `write_las`
- Produces: `read_las_chunks(path, chunk_size=2_000_000) -> Iterator[np.ndarray (k,3) float32]` (스케일·오프셋 적용된 실좌표)

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_las_reader.py
import numpy as np
from tests.fixtures.synthetic import flat_floor, write_las
from flatness.io.las_reader import read_las_chunks

def test_las_roundtrip(tmp_path):
    pts = flat_floor(size=(1.0, 1.0), spacing=0.1)
    write_las(pts, tmp_path / "a.las")
    got = np.vstack(list(read_las_chunks(tmp_path / "a.las", chunk_size=13)))
    assert got.shape == (len(pts), 3)
    assert np.allclose(got, pts, atol=1e-3)  # 스케일 0.0001 양자화 허용
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_las_reader.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# engine/flatness/io/las_reader.py
"""LAS/LAZ 리더 — laspy 청크 이터레이터로 실좌표 float32 스트리밍."""
import laspy
import numpy as np


def read_las_chunks(path, chunk_size=2_000_000):
    with laspy.open(str(path)) as f:
        for pts in f.chunk_iterator(chunk_size):
            yield np.column_stack([np.asarray(pts.x), np.asarray(pts.y),
                                   np.asarray(pts.z)]).astype(np.float32)
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_las_reader.py -v`
Expected: 1 PASS

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/io/las_reader.py engine/tests/test_las_reader.py
git commit -m "feat(engine): LAS/LAZ 청크 리더"
```

---

### Task 4: 리더 디스패치 + 단위 감지

**Files:**
- Create: `engine/flatness/io/reader.py`, `engine/flatness/io/units.py`
- Test: `engine/tests/test_reader.py`, `engine/tests/test_units.py`

**Interfaces:**
- Consumes: Task 2 `read_ply_chunks`, Task 3 `read_las_chunks`
- Produces:
  - `CloudInfo` dataclass: `n_points: int`, `bbox_min: np.ndarray (3,)`, `bbox_max: np.ndarray (3,)` (파일 단위)
  - `iter_chunks(path, chunk_size=2_000_000) -> Iterator[np.ndarray]`, `read_info(path, chunk_size=2_000_000) -> CloudInfo`
  - `UnitGuess` dataclass: `unit: str('m'|'cm'|'mm')`, `scale_to_m: float`, `confidence: str('high'|'low')`, `evidence: str`
  - `detect_units(info: CloudInfo) -> list[UnitGuess]` (최선 후보 먼저)

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_reader.py
import numpy as np
import pytest
from tests.fixtures.synthetic import flat_floor, write_binary_ply, write_las
from flatness.io.reader import iter_chunks, read_info

def test_dispatch_ply_and_las(tmp_path):
    pts = flat_floor(size=(1.0, 1.0), spacing=0.1)
    write_binary_ply(pts, tmp_path / "a.ply")
    write_las(pts, tmp_path / "a.las")
    for name in ("a.ply", "a.las"):
        got = np.vstack(list(iter_chunks(tmp_path / name)))
        assert got.shape == (len(pts), 3)

def test_read_info(tmp_path):
    pts = flat_floor(size=(2.0, 1.0), spacing=0.1)
    write_binary_ply(pts, tmp_path / "a.ply")
    info = read_info(tmp_path / "a.ply")
    assert info.n_points == len(pts)
    assert np.allclose(info.bbox_max[:2], [2.0, 1.0], atol=0.11)

def test_unsupported_extension(tmp_path):
    (tmp_path / "a.e57").write_bytes(b"x")
    with pytest.raises(ValueError, match="지원하지 않는"):
        list(iter_chunks(tmp_path / "a.e57"))
```

```python
# engine/tests/test_units.py
import numpy as np
from flatness.io.reader import CloudInfo
from flatness.io.units import detect_units

def _info(extent):
    return CloudInfo(n_points=1000, bbox_min=np.zeros(3),
                     bbox_max=np.array([extent, extent, 3.0]))

def test_meters_high_confidence():
    g = detect_units(_info(6.0))
    assert g[0].unit == "m" and g[0].confidence == "high" and g[0].scale_to_m == 1.0

def test_millimeters_high_confidence():
    g = detect_units(_info(6000.0))
    assert g[0].unit == "mm" and g[0].confidence == "high" and g[0].scale_to_m == 0.001

def test_ambiguous_low_confidence():
    g = detect_units(_info(600.0))
    assert all(x.confidence == "low" for x in g)  # cm/m 모호 구간 — 자동 확정 금지
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_reader.py tests/test_units.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# engine/flatness/io/reader.py
"""포맷 디스패치 + 1차 패스(개수·bbox) 스캔."""
from dataclasses import dataclass
from pathlib import Path
import numpy as np
from flatness.io.ply_reader import read_ply_chunks
from flatness.io.las_reader import read_las_chunks

_READERS = {".ply": read_ply_chunks, ".las": read_las_chunks, ".laz": read_las_chunks}


@dataclass
class CloudInfo:
    n_points: int
    bbox_min: np.ndarray
    bbox_max: np.ndarray


def iter_chunks(path, chunk_size=2_000_000):
    ext = Path(path).suffix.lower()
    if ext not in _READERS:
        raise ValueError(f"지원하지 않는 확장자: {ext} (지원: {sorted(_READERS)})")
    yield from _READERS[ext](path, chunk_size=chunk_size)


def read_info(path, chunk_size=2_000_000):
    n, lo, hi = 0, None, None
    for c in iter_chunks(path, chunk_size=chunk_size):
        n += len(c)
        cmin, cmax = c.min(axis=0).astype(np.float64), c.max(axis=0).astype(np.float64)
        lo = cmin if lo is None else np.minimum(lo, cmin)
        hi = cmax if hi is None else np.maximum(hi, cmax)
    if n == 0:
        raise ValueError("점이 없는 파일")
    return CloudInfo(n_points=n, bbox_min=lo, bbox_max=hi)
```

```python
# engine/flatness/io/units.py
"""단위 추정 휴리스틱 — 후보만 제시하고 확정은 사용자가 한다(스펙 §5.1.1)."""
from dataclasses import dataclass
from flatness.io.reader import CloudInfo


@dataclass
class UnitGuess:
    unit: str
    scale_to_m: float
    confidence: str
    evidence: str


def detect_units(info: CloudInfo) -> list[UnitGuess]:
    d = info.bbox_max - info.bbox_min
    extent = float(max(d[0], d[1]))
    ev = f"수평 범위 {extent:.1f} (파일 단위)"
    if 1.0 <= extent <= 200.0:
        return [UnitGuess("m", 1.0, "high", ev + " → 실내외 현장 규모(m)와 부합"),
                UnitGuess("mm", 0.001, "low", ev)]
    if 1000.0 <= extent <= 200000.0:
        return [UnitGuess("mm", 0.001, "high", ev + " → mm 단위 좌표로 추정"),
                UnitGuess("m", 1.0, "low", ev)]
    # 모호 구간(200~1000: cm 또는 대형 현장 m 등) — 전부 low
    return [UnitGuess("cm", 0.01, "low", ev + " → cm/m 모호"),
            UnitGuess("m", 1.0, "low", ev),
            UnitGuess("mm", 0.001, "low", ev)]
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_reader.py tests/test_units.py -v`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/io/reader.py engine/flatness/io/units.py engine/tests/test_reader.py engine/tests/test_units.py
git commit -m "feat(engine): 리더 디스패치 + 단위 감지 휴리스틱"
```

---

### Task 5: 서브셀 그리드 (5cm 중앙값)

**Files:**
- Create: `engine/flatness/core/subcell.py`
- Test: `engine/tests/test_subcell.py`

**Interfaces:**
- Consumes: Task 4 `iter_chunks`, `CloudInfo`
- Produces:
  - `SubcellGrid` dataclass: `size_m: float`, `origin: np.ndarray (2,)[m]`, `shape: tuple[int,int] (ny,nx)`, `median_z: np.ndarray (ny,nx) float32[m] (빈 셀 NaN)`, `counts: np.ndarray (ny,nx) int32`
  - `build_subcell_grid(chunks, info, scale_to_m, subcell_m=0.05) -> SubcellGrid` — chunks는 파일 단위 (k,3) 이터레이터

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_subcell.py
import numpy as np
from tests.fixtures.synthetic import flat_floor, add_step
from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import CloudInfo

def _grid(pts, scale=1.0, subcell=0.05):
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    chunks = iter([pts[:len(pts)//2].astype(np.float32), pts[len(pts)//2:].astype(np.float32)])
    return build_subcell_grid(chunks, info, scale_to_m=scale, subcell_m=subcell)

def test_flat_floor_medians_zero():
    g = _grid(flat_floor(size=(1.0, 1.0), spacing=0.01))
    valid = ~np.isnan(g.median_z)
    assert valid.sum() >= 20 * 20
    assert np.nanmax(np.abs(g.median_z)) < 1e-6

def test_median_robust_to_outliers():
    pts = flat_floor(size=(0.3, 0.3), spacing=0.01)
    pts[::50, 2] = 5.0  # 2% 스파이크 — 중앙값이면 영향 없어야 함
    g = _grid(pts)
    assert np.nanmax(np.abs(g.median_z)) < 1e-6

def test_step_visible_in_grid():
    pts = add_step(flat_floor(size=(1.0, 0.2), spacing=0.01), x_split=0.5, height=0.02)
    g = _grid(pts)
    xs = g.origin[0] + (np.arange(g.shape[1]) + 0.5) * g.size_m
    right = g.median_z[:, xs > 0.55]
    assert abs(np.nanmedian(right) - 0.02) < 1e-6

def test_mm_scale_applied():
    pts = flat_floor(size=(1.0, 0.2), spacing=0.01) * 1000.0  # mm 좌표
    g = _grid(pts, scale=0.001)
    assert abs((g.origin[0] + g.shape[1] * g.size_m) - 1.0) < 0.1  # m로 환산됨
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_subcell.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# engine/flatness/core/subcell.py
"""서브셀 비닝 — 점 단위 노이즈 극값이 판정을 지배하지 않도록 셀 중앙값 사용(스펙 §5.1.5).

1a 구현 메모: 청크별 (셀번호, z)를 모아 정렬 후 그룹 중앙값을 구한다.
점당 8바이트(int32+float32)로 3천만 점 ≈ 240MB — 1d 메모리 검증에서 재평가.
"""
from dataclasses import dataclass
import numpy as np


@dataclass
class SubcellGrid:
    size_m: float
    origin: np.ndarray
    shape: tuple
    median_z: np.ndarray
    counts: np.ndarray


def build_subcell_grid(chunks, info, scale_to_m, subcell_m=0.05):
    lo = info.bbox_min * scale_to_m
    hi = info.bbox_max * scale_to_m
    nx = max(1, int(np.ceil((hi[0] - lo[0]) / subcell_m)))
    ny = max(1, int(np.ceil((hi[1] - lo[1]) / subcell_m)))
    idx_parts, z_parts = [], []
    for c in chunks:
        p = c.astype(np.float32) * np.float32(scale_to_m)
        ix = np.clip(((p[:, 0] - lo[0]) / subcell_m).astype(np.int32), 0, nx - 1)
        iy = np.clip(((p[:, 1] - lo[1]) / subcell_m).astype(np.int32), 0, ny - 1)
        idx_parts.append(iy.astype(np.int64) * nx + ix)
        z_parts.append(p[:, 2])
    idx = np.concatenate(idx_parts)
    z = np.concatenate(z_parts)
    order = np.argsort(idx, kind="stable")
    idx, z = idx[order], z[order]
    starts = np.flatnonzero(np.r_[True, np.diff(idx) > 0])
    ends = np.r_[starts[1:], len(idx)]
    median_z = np.full(ny * nx, np.nan, dtype=np.float32)
    counts = np.zeros(ny * nx, dtype=np.int32)
    for s, e in zip(starts, ends):
        seg = np.sort(z[s:e])
        k = len(seg)
        median_z[idx[s]] = seg[(k - 1) // 2] if k % 2 else 0.5 * (seg[k // 2 - 1] + seg[k // 2])
        counts[idx[s]] = k
    return SubcellGrid(size_m=subcell_m, origin=lo[:2].copy(), shape=(ny, nx),
                       median_z=median_z.reshape(ny, nx), counts=counts.reshape(ny, nx))
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_subcell.py -v`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/core/subcell.py engine/tests/test_subcell.py
git commit -m "feat(engine): 5cm 서브셀 중앙값 그리드"
```

---

### Task 6: RANSAC 평면 제거 (높이형, 그리드 보존)

**Files:**
- Create: `engine/flatness/core/plane.py`
- Test: `engine/tests/test_plane.py`

**Interfaces:**
- Consumes: Task 5 `SubcellGrid`
- Produces:
  - `fit_plane_ransac(x, y, z, n_iter=500, thresh_m=0.005, seed=0) -> tuple[float,float,float]` — 모델 z=ax+by+c의 (a,b,c). 1D float 배열 입력
  - `residual_grid(grid: SubcellGrid, abc) -> np.ndarray (ny,nx) float32[m]` — median_z − 평면. **+ = 융기, − = 침하**

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_plane.py
import numpy as np
from tests.fixtures.synthetic import flat_floor, add_bump
from flatness.core.plane import fit_plane_ransac, residual_grid
from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import CloudInfo

def _grid(pts):
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    return build_subcell_grid(iter([pts.astype(np.float32)]), info, 1.0)

def _fit(grid):
    ys, xs = np.nonzero(~np.isnan(grid.median_z))
    cx = grid.origin[0] + (xs + 0.5) * grid.size_m
    cy = grid.origin[1] + (ys + 0.5) * grid.size_m
    return fit_plane_ransac(cx, cy, grid.median_z[ys, xs].astype(float))

def test_tilt_recovered():
    g = _grid(flat_floor(size=(3.0, 3.0), spacing=0.02, tilt=(0.02, -0.01)))
    a, b, c = _fit(g)
    assert abs(a - 0.02) < 1e-4 and abs(b + 0.01) < 1e-4
    r = residual_grid(g, (a, b, c))
    assert np.nanmax(np.abs(r)) < 5e-4  # 평면 제거 후 잔차 ≈ 0

def test_bump_survives_as_positive_residual():
    pts = add_bump(flat_floor(size=(3.0, 3.0), spacing=0.02), (1.5, 1.5), 0.3, 0.01)
    g = _grid(pts)
    r = residual_grid(g, _fit(g))
    assert 0.008 < np.nanmax(r) < 0.012  # 융기가 +로 보존 (부호 규약)
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_plane.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# engine/flatness/core/plane.py
"""높이형 RANSAC 평면 — z=ax+by+c 모델이라 그리드가 보존된다.

결함(범프·침하)은 인라이어에서 자연히 제외되어 기준면을 오염시키지 않는다.
"""
import numpy as np


def fit_plane_ransac(x, y, z, n_iter=500, thresh_m=0.005, seed=0):
    rng = np.random.default_rng(seed)
    n = len(x)
    A_full = np.column_stack([x, y, np.ones(n)])
    best_mask, best_cnt = None, -1
    for _ in range(n_iter):
        i = rng.choice(n, 3, replace=False)
        A = A_full[i]
        try:
            abc = np.linalg.solve(A, np.asarray(z)[i])
        except np.linalg.LinAlgError:
            continue  # 일직선 3점이면 건너뜀
        res = np.abs(A_full @ abc - z)
        mask = res < thresh_m
        if mask.sum() > best_cnt:
            best_cnt, best_mask = int(mask.sum()), mask
    if best_mask is None or best_cnt < 3:
        raise ValueError("평면 피팅 실패 — 점이 부족하거나 퇴화 구성")
    abc, *_ = np.linalg.lstsq(A_full[best_mask], np.asarray(z)[best_mask], rcond=None)
    return float(abc[0]), float(abc[1]), float(abc[2])


def residual_grid(grid, abc):
    a, b, c = abc
    ny, nx = grid.shape
    cx = grid.origin[0] + (np.arange(nx) + 0.5) * grid.size_m
    cy = grid.origin[1] + (np.arange(ny) + 0.5) * grid.size_m
    plane = a * cx[None, :] + b * cy[:, None] + c
    return (grid.median_z - plane).astype(np.float32)
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_plane.py -v`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/core/plane.py engine/tests/test_plane.py
git commit -m "feat(engine): 높이형 RANSAC 평면 제거 (부호 규약 +융기/-침하)"
```

---

### Task 7: 직선자 포락선 코어

**Files:**
- Create: `engine/flatness/core/straightedge.py`
- Test: `engine/tests/test_straightedge.py`

**Interfaces:**
- Consumes: 없음 (순수 수치 함수)
- Produces: `max_gap_under_straightedge(x, z) -> tuple[float, int]` — x 오름차순 1D 위치[m], z 높이[m]. 상부 볼록 포락선(강체 직선자가 고점에 얹힌 지지선) 아래 최대 틈새[m]와 그 위치 인덱스. 점 2개 미만이면 (0.0, 0)

- [ ] **Step 1: 실패하는 테스트 작성 (해석적 정답)**

```python
# engine/tests/test_straightedge.py
import numpy as np
from flatness.core.straightedge import max_gap_under_straightedge

def test_flat_zero_gap():
    x = np.linspace(0, 3, 61)
    gap, _ = max_gap_under_straightedge(x, np.zeros_like(x))
    assert gap < 1e-9

def test_v_groove_exact():
    # (0,0)-(1,-d)-(2,0): 포락선은 양끝 직선 → 홈 깊이 d가 그대로 틈새
    x = np.array([0.0, 1.0, 2.0])
    z = np.array([0.0, -0.01, 0.0])
    gap, i = max_gap_under_straightedge(x, z)
    assert abs(gap - 0.01) < 1e-12 and i == 1

def test_single_spike_no_false_gap():
    # 돌기 하나: 직선자는 돌기에 얹혀 기울고, 틈새는 돌기 반대편에서 커진다
    x = np.linspace(0, 3, 61)
    z = np.zeros_like(x); z[30] = 0.01  # x=1.5에 10mm 돌기
    gap, _ = max_gap_under_straightedge(x, z)
    # 포락선: (0,0)→(1.5,0.01)→(3,0) — 최대 틈새는 돌기 바로 옆: 0.01*(1.45/1.5)=0.00967
    assert 0.0090 <= gap <= 0.0100

def test_sine_peak_to_peak():
    # 파장 1m·진폭 5mm 사인: 포락선은 마루에 얹힘 → 골에서 틈새 ≈ 2A
    x = np.linspace(0, 3, 61)
    z = 0.005 * np.sin(2 * np.pi * x / 1.0)
    gap, _ = max_gap_under_straightedge(x, z)
    assert abs(gap - 0.010) < 0.001

def test_lsq_would_underestimate_but_envelope_does_not():
    # LSQ 평면(평균 통과) 방식은 사인 결함을 절반(A)으로 축소한다 — 포락선은 2A를 잡는다
    x = np.linspace(0, 3, 121)
    z = 0.005 * np.sin(2 * np.pi * x / 0.75)
    gap, _ = max_gap_under_straightedge(x, z)
    lsq_style = np.max(np.abs(z - z.mean()))  # ≈ A = 5mm
    assert gap > 1.8 * lsq_style  # 포락선 ≈ 2A
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_straightedge.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# engine/flatness/core/straightedge.py
"""직선자 시뮬레이션 — 상부 볼록 포락선(모노톤 체인) 아래 최대 틈새.

실물 3m 직선자는 표면 고점에 '얹혀' 지지되므로 기준선은 상부 볼록 껍질이다.
LSQ 평면은 데이터 중앙을 관통해 파형 결함을 절반으로 축소한다(스펙 §5.1.6 금지).
"""
import numpy as np


def _upper_hull_indices(x, z):
    # 모노톤 체인 상부 껍질 — x 오름차순 전제
    hull = []
    for i in range(len(x)):
        while len(hull) >= 2:
            (x1, z1), (x2, z2) = (x[hull[-2]], z[hull[-2]]), (x[hull[-1]], z[hull[-1]])
            # (x2,z2)가 (x1,z1)-(x[i],z[i]) 선분 아래(외적 ≥ 0)면 제거
            if (x2 - x1) * (z[i] - z1) - (z2 - z1) * (x[i] - x1) >= 0:
                hull.pop()
            else:
                break
        hull.append(i)
    return hull


def max_gap_under_straightedge(x, z):
    x = np.asarray(x, dtype=np.float64)
    z = np.asarray(z, dtype=np.float64)
    if len(x) < 2:
        return 0.0, 0
    hi = _upper_hull_indices(x, z)
    envelope = np.interp(x, x[hi], z[hi])
    gaps = envelope - z
    i = int(np.argmax(gaps))
    return float(gaps[i]), i
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_straightedge.py -v`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/core/straightedge.py engine/tests/test_straightedge.py
git commit -m "feat(engine): 상부 볼록 포락선 직선자 시뮬레이션"
```

---

### Task 8: 셀 평가 (1m 셀 · 4방향 · 점유율 · 축소 스팬)

**Files:**
- Create: `engine/flatness/core/cells.py`
- Test: `engine/tests/test_cells.py`

**Interfaces:**
- Consumes: Task 5 `SubcellGrid`, Task 7 `max_gap_under_straightedge`
- Produces:
  - `CellResult` dataclass: `ix: int`, `iy: int`, `center_x: float`, `center_y: float`, `value_mm: float | None`(None=판정 불가), `span_used_m: float`, `occupancy: float`, `worst_x: float | None`, `worst_y: float | None`
  - `evaluate_cells(residuals, grid: SubcellGrid, span_m, cell_m=1.0, min_occupancy=0.7, min_span_m=1.0) -> list[CellResult]` — residuals는 Task 6 `residual_grid` 결과. 4방향의 **셀 블록을 지나는 모든 라인**을 스윕하고 라인별 틈새를 (환산 허용치 대비) 심각도로 비교해 최악 라인 채택 (2026-07-28 개정: 중심 라인만 검사하면 라인 밖 결함이 감쇠 측정되어 ±1mm 게이트 위반)

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_cells.py
import numpy as np
from tests.fixtures.synthetic import flat_floor, add_bump
from flatness.core.subcell import build_subcell_grid
from flatness.core.plane import fit_plane_ransac, residual_grid
from flatness.core.cells import evaluate_cells
from flatness.io.reader import CloudInfo

def _residuals(pts):
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    g = build_subcell_grid(iter([pts.astype(np.float32)]), info, 1.0)
    ys, xs = np.nonzero(~np.isnan(g.median_z))
    cx = g.origin[0] + (xs + 0.5) * g.size_m
    cy = g.origin[1] + (ys + 0.5) * g.size_m
    abc = fit_plane_ransac(cx, cy, g.median_z[ys, xs].astype(float))
    return residual_grid(g, abc), g

def test_flat_floor_all_cells_near_zero():
    r, g = _residuals(flat_floor(size=(6.0, 6.0), spacing=0.02))
    cells = [c for c in evaluate_cells(r, g, span_m=3.0) if c.value_mm is not None]
    assert len(cells) >= 25  # 6x6m → 최소 5x5개 유효 셀
    assert all(c.value_mm < 0.5 for c in cells)
    # 내부 셀은 온전한 스팬(그리드 경계 서브셀 1칸 손실 2.95m 허용), 모서리 셀은 축소 스팬
    assert sum(1 for c in cells if c.span_used_m >= 2.95) >= 16
    assert all(c.span_used_m >= 1.0 for c in cells)

def test_depression_detected_within_tolerance():
    # 함몰(음수 범프): 포락선 지지점이 주변 바닥 → 직선자 해석 정답 = 깊이 10mm 정확히
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.01)
    r, g = _residuals(pts)
    cells = [c for c in evaluate_cells(r, g, span_m=3.0) if c.value_mm is not None]
    worst = max(cells, key=lambda c: c.value_mm)
    assert 9.0 <= worst.value_mm <= 11.0        # 직선자 값 ±1mm (스펙 §10.1)
    assert abs(worst.worst_x - 2.0) < 1.0 and abs(worst.worst_y - 2.0) < 1.0  # 위치 1셀 이내

def test_bump_reads_hull_support_value():
    # 볼록(범프): 직선자가 정점에 얹히는 지지선 기하로 해석값 ≈ h×(1−r/S)×중앙값감쇠 ≈ 8.6mm
    # (결함 높이 10mm가 아님 — 실물 직선자도 동일하게 읽음. 2026-07-28 정정)
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, 0.01)
    r, g = _residuals(pts)
    cells = [c for c in evaluate_cells(r, g, span_m=3.0) if c.value_mm is not None]
    worst = max(cells, key=lambda c: c.value_mm)
    assert 7.6 <= worst.value_mm <= 9.6         # 해석값 8.6mm ± 1mm
    assert abs(worst.worst_x - 2.0) < 1.0 and abs(worst.worst_y - 2.0) < 1.0

def test_small_area_uses_reduced_span():
    # 2.4m 폭 — 3m 스팬 불가 → 축소 스팬(≥1m)으로 평가
    r, g = _residuals(flat_floor(size=(2.4, 2.4), spacing=0.02))
    cells = [c for c in evaluate_cells(r, g, span_m=3.0) if c.value_mm is not None]
    assert len(cells) >= 1
    assert all(1.0 <= c.span_used_m < 3.0 for c in cells)

def test_sparse_cell_is_na():
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    # (5,5) 부근 1m 셀의 점 대부분 제거 → 점유율 미달 → 판정 불가
    m = ~((pts[:, 0] > 4.55) & (pts[:, 1] > 4.55))
    r, g = _residuals(pts[m])
    cells = evaluate_cells(r, g, span_m=3.0)
    na = [c for c in cells if c.value_mm is None]
    assert any(c.center_x > 4.5 and c.center_y > 4.5 for c in na)
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_cells.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# engine/flatness/core/cells.py
"""판정 셀 평가 — 셀 내 모든 직선자 배치(라인) 스윕, 4방향(스펙 §5.1.6 개정판).

직선자를 셀 안 임의 위치·4방향으로 대는 실물 검사를 시뮬레이션한다: 각 방향에
대해 셀 블록을 지나는 모든 서브셀 라인을 평가하고, 각 라인의 윈도우는 셀 중심
최근접점 기준 span_m 길이로 잡는다. 중심 라인만 검사하면 라인 밖 결함이 감쇠
측정되므로(±1mm 게이트 위반) 전 라인을 스윕한다.
"""
from dataclasses import dataclass
import numpy as np
from flatness.core.straightedge import max_gap_under_straightedge

_SQRT2 = float(np.sqrt(2.0))


@dataclass
class CellResult:
    ix: int
    iy: int
    center_x: float
    center_y: float
    value_mm: float | None
    span_used_m: float
    occupancy: float
    worst_x: float | None
    worst_y: float | None


def _profile(residuals, ai, aj, di, dj, half_steps, step_m):
    """앵커 (aj,ai)에서 (dj,di) 방향 ±half_steps 프로파일. (위치, 높이, (iy,ix)) 반환."""
    ny, nx = residuals.shape
    pos, height, idx = [], [], []
    for k in range(-half_steps, half_steps + 1):
        i, j = ai + k * di, aj + k * dj
        if 0 <= i < nx and 0 <= j < ny and not np.isnan(residuals[j, i]):
            pos.append(k * step_m)
            height.append(float(residuals[j, i]))
            idx.append((j, i))
    return np.asarray(pos), np.asarray(height), idx


def _line_anchors(ci, cj, x0, x1, y0, y1, di, dj):
    """셀 블록 [x0,x1)×[y0,y1)을 지나는 (di,dj) 방향 라인들의 앵커 목록.

    앵커 = 각 라인 위에서 셀 중심 (ci,cj)에 가장 가까운 블록 내 서브셀.
    """
    anchors = []
    if (di, dj) == (1, 0):            # 행 라인: j 고정, 행마다 1개
        for j in range(y0, y1):
            anchors.append((ci, j))
    elif (di, dj) == (0, 1):          # 열 라인: i 고정
        for i in range(x0, x1):
            anchors.append((i, cj))
    elif (di, dj) == (1, 1):          # ↗ 대각: d = j - i 고정
        for d in range(y0 - (x1 - 1), (y1 - 1) - x0 + 1):
            i = max(x0, min(x1 - 1, int(round((ci + cj - d) / 2))))
            j = i + d
            if j < y0:
                j = y0; i = j - d
            elif j >= y1:
                j = y1 - 1; i = j - d
            if x0 <= i < x1:
                anchors.append((i, j))
    else:                              # ↘ 대각: s = j + i 고정
        for s in range(y0 + x0, (y1 - 1) + (x1 - 1) + 1):
            i = max(x0, min(x1 - 1, int(round((ci - cj + s) / 2))))
            j = s - i
            if j < y0:
                j = y0; i = s - j
            elif j >= y1:
                j = y1 - 1; i = s - j
            if x0 <= i < x1:
                anchors.append((i, j))
    return anchors


def evaluate_cells(residuals, grid, span_m, cell_m=1.0, min_occupancy=0.7, min_span_m=1.0):
    ny, nx = residuals.shape
    sub = grid.size_m
    ncx = max(1, int(np.ceil(nx * sub / cell_m)))
    ncy = max(1, int(np.ceil(ny * sub / cell_m)))
    per_cell = int(round(cell_m / sub))
    results = []
    dirs = [(1, 0, sub), (0, 1, sub), (1, 1, sub * _SQRT2), (1, -1, sub * _SQRT2)]
    for cy in range(ncy):
        for cx in range(ncx):
            x0, x1 = cx * per_cell, min(nx, (cx + 1) * per_cell)
            y0, y1 = cy * per_cell, min(ny, (cy + 1) * per_cell)
            ci = min(nx - 1, x0 + per_cell // 2)
            cj = min(ny - 1, y0 + per_cell // 2)
            center_x = grid.origin[0] + (ci + 0.5) * sub
            center_y = grid.origin[1] + (cj + 0.5) * sub
            # 셀 자체 점유율: 셀 영역 내 유효 서브셀 비율
            block = residuals[y0:y1, x0:x1]
            occupancy = float(np.count_nonzero(~np.isnan(block))) / max(1, block.size)
            best = None  # (심각도, gap_m, L_eff, (j,i))
            if occupancy >= min_occupancy:
                for di, dj, step in dirs:
                    half = int(round(span_m / 2 / step))
                    expected = 2 * half + 1
                    for ai, aj in _line_anchors(ci, cj, x0, x1, y0, y1, di, dj):
                        pos, height, idx = _profile(residuals, ai, aj, di, dj, half, step)
                        if len(pos) < 3:
                            continue
                        if len(pos) / expected < min_occupancy:
                            continue
                        L = float(pos.max() - pos.min())
                        if L < min_span_m:
                            continue
                        gap, wi = max_gap_under_straightedge(pos, height)
                        L_eff = min(L, span_m)
                        severity = gap / max(1e-9, L_eff / span_m)  # 환산 허용치 대비 비교용
                        if best is None or severity > best[0]:
                            best = (severity, gap, L_eff, idx[wi])
            if best is None:
                results.append(CellResult(cx, cy, center_x, center_y, None,
                                          0.0, occupancy, None, None))
            else:
                _, gap, L_eff, (wj, wi_) = best
                results.append(CellResult(
                    cx, cy, center_x, center_y, gap * 1000.0, L_eff, occupancy,
                    grid.origin[0] + (wi_ + 0.5) * sub, grid.origin[1] + (wj + 0.5) * sub))
    return results
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_cells.py -v`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/core/cells.py engine/tests/test_cells.py
git commit -m "feat(engine): 1m 셀 4방향 직선자 평가 (점유율·축소 스팬)"
```

---

### Task 9: 판정 기준 로드 + 판정식

**Files:**
- Create: `engine/flatness/criteria.py`, `engine/flatness/data/seed_criteria.json`
- Test: `engine/tests/test_criteria.py`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `Criterion` dataclass: `name, surface('floor'|'wall'), metric('flatness'|'plumbness'), span_m: float | None, pass_mm: float, rework_mm: float, source: str`
  - `load_criteria(path=None) -> dict[str, Criterion]` (기본: 패키지 내장 시드)
  - `grade_value(value_mm, crit, u_mm, span_used_m) -> tuple[str, list[str]]` — 등급('pass'|'borderline'|'repair'|'rework')과 경고 목록. `grade_cells(cells, crit, u_mm) -> tuple[list[str|None], list[str]]`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_criteria.py
from flatness.criteria import load_criteria, grade_value

def test_seed_loaded():
    crits = load_criteria()
    c = crits["floor-kcs-exposed"]
    assert c.span_m == 3 and c.pass_mm == 7 and c.rework_mm == 21 and c.surface == "floor"
    assert len(crits) >= 11

def test_grading_boundaries():
    c = load_criteria()["floor-kcs-exposed"]  # pass 7, rework 21, U=5 → b1=2, b2=12
    assert grade_value(1.9, c, 5.0, 3.0)[0] == "pass"
    assert grade_value(10.0, c, 5.0, 3.0)[0] == "borderline"
    assert grade_value(15.0, c, 5.0, 3.0)[0] == "repair"
    assert grade_value(22.0, c, 5.0, 3.0)[0] == "rework"

def test_reduced_span_scales_linearly():
    c = load_criteria()["floor-kcs-exposed"]  # L=1.5 → s=0.5: pe=3.5, re=10.5, b2=min(8.5,10.5)
    grade, _ = grade_value(9.0, c, 5.0, 1.5)
    assert grade == "repair"  # 8.5 < 9 ≤ 10.5

def test_uncertainty_swallows_repair_warning():
    c = load_criteria()["wall-plaster-surface"]  # pass 3, rework 9, U=8 → pe+U=11 ≥ 9
    grade, warns = grade_value(5.0, c, 8.0, 3.0)
    assert "uncertainty_swallows_repair" in warns
    assert grade == "borderline"  # b2=min(11,9)=9 → 5 ≤ 9
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_criteria.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 시드 데이터 작성** (스펙 §4.1의 11행, rework=pass×3)

파일 경로: `engine/flatness/data/seed_criteria.json` (JSON에는 주석 불가 — 아래 내용 그대로 저장)

```json
[
  {"name": "floor-kcs-finish7plus", "surface": "floor", "metric": "flatness", "span_m": 1, "pass_mm": 10, "rework_mm": 30, "source": "KCS 14 20 10 표 3.7-1 (마감두께 7mm 이상)"},
  {"name": "floor-kcs-finish7minus", "surface": "floor", "metric": "flatness", "span_m": 3, "pass_mm": 10, "rework_mm": 30, "source": "KCS 14 20 10 표 3.7-1 (마감두께 7mm 미만)"},
  {"name": "floor-kcs-exposed", "surface": "floor", "metric": "flatness", "span_m": 3, "pass_mm": 7, "rework_mm": 21, "source": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)"},
  {"name": "floor-molit-cushion", "surface": "floor", "metric": "flatness", "span_m": 3, "pass_mm": 7, "rework_mm": 21, "source": "국토부 바닥충격음 고시 (완충재 바탕)"},
  {"name": "floor-lh-exposed", "surface": "floor", "metric": "flatness", "span_m": 3, "pass_mm": 6, "rework_mm": 18, "source": "LHCS 14 20 10 05 표 3.11-7 (제물치장·도장·벽지)"},
  {"name": "floor-lh-thick", "surface": "floor", "metric": "flatness", "span_m": 3, "pass_mm": 10, "rework_mm": 30, "source": "LHCS 14 20 10 05 표 3.11-7 (마감 13mm 초과)"},
  {"name": "wall-kcs-tilt-exposed", "surface": "wall", "metric": "flatness", "span_m": 3, "pass_mm": 6, "rework_mm": 18, "source": "KCS 21 50 05 §3.2.6 (노출 모서리·줄눈)"},
  {"name": "wall-kcs-tilt-other", "surface": "wall", "metric": "flatness", "span_m": 3, "pass_mm": 9, "rework_mm": 27, "source": "KCS 21 50 05 §3.2.6 (기타)"},
  {"name": "wall-kcs-plumb", "surface": "wall", "metric": "plumbness", "span_m": null, "pass_mm": 25, "rework_mm": 75, "source": "KCS 21 50 05 §3.2.2 (H≤30m)"},
  {"name": "wall-plaster-surface", "surface": "wall", "metric": "flatness", "span_m": 3, "pass_mm": 3, "rework_mm": 9, "source": "주택건설 전문시방서 31310 (미장 바름면)"},
  {"name": "wall-plaster-base", "surface": "wall", "metric": "flatness", "span_m": 3, "pass_mm": 6, "rework_mm": 18, "source": "주택건설 전문시방서 31310 (미장 바탕면)"}
]
```

- [ ] **Step 4: 구현**

```python
# engine/flatness/criteria.py
"""판정 기준 로드 + §4.2 판정식."""
from dataclasses import dataclass
from importlib import resources
import json


@dataclass
class Criterion:
    name: str
    surface: str
    metric: str
    span_m: float | None
    pass_mm: float
    rework_mm: float
    source: str


def load_criteria(path=None):
    if path is None:
        raw = resources.files("flatness").joinpath("data/seed_criteria.json").read_text("utf-8")
    else:
        raw = open(path, encoding="utf-8").read()
    return {d["name"]: Criterion(**d) for d in json.loads(raw)}


def grade_value(value_mm, crit, u_mm, span_used_m):
    """§4.2: s=span_used/span, pe=pass×s, re=rework×s, b1=pe−U, b2=min(pe+U, re)."""
    warns = []
    s = 1.0 if crit.span_m is None else min(1.0, span_used_m / crit.span_m)
    if s < 1.0:
        warns.append("reduced_span")
    pe, re = crit.pass_mm * s, crit.rework_mm * s
    b1, b2 = pe - u_mm, min(pe + u_mm, re)
    if pe + u_mm >= re:
        warns.append("uncertainty_swallows_repair")
    if value_mm <= b1:
        return "pass", warns
    if value_mm <= b2:
        return "borderline", warns
    if value_mm <= re:
        return "repair", warns
    return "rework", warns


def grade_cells(cells, crit, u_mm):
    grades, all_warns = [], set()
    for c in cells:
        if c.value_mm is None:
            grades.append(None)
            continue
        g, w = grade_value(c.value_mm, crit, u_mm, c.span_used_m)
        grades.append(g)
        all_warns.update(w)
    return grades, sorted(all_warns)
```

- [ ] **Step 5: 통과 확인**

Run: `python -m pytest tests/test_criteria.py -v`
Expected: 4 PASS

- [ ] **Step 6: Commit**

```bash
git add engine/flatness/criteria.py engine/flatness/data/seed_criteria.json engine/tests/test_criteria.py
git commit -m "feat(engine): 시방서 시드 기준 + 4등급 판정식"
```

---

### Task 10: stats/cells/CSV 산출

**Files:**
- Create: `engine/flatness/outputs/stats.py`
- Test: `engine/tests/test_stats.py`

**Interfaces:**
- Consumes: Task 8 `CellResult`, Task 9 `Criterion`/`grade_cells`
- Produces:
  - `build_stats(cells, grades, crit, u_mm, warnings, meta: dict) -> dict` — 키: `n_cells, n_valid, grade_counts{pass,borderline,repair,rework,na}, grade_pct, value_max_mm, value_min_mm, value_mean_mm, value_p95_mm, worst{value_mm, cell_ix, cell_iy, point_x, point_y}, coverage_pct, reduced_span_cells, applied_criteria{name,source,span_m,pass_mm,rework_mm,u_mm}, warnings, meta` (최대·최소·평균은 과업지시서 결과표 요구 항목)
  - `write_outputs(out_dir, stats, cells, grades)` — `stats.json`, `cells.json`, `results.csv` 생성. CSV 컬럼: `ix,iy,center_x,center_y,value_mm,span_used_m,occupancy,grade,worst_x,worst_y`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_stats.py
import csv, json
from flatness.core.cells import CellResult
from flatness.criteria import load_criteria, grade_cells
from flatness.outputs.stats import build_stats, write_outputs

def _cells():
    return [
        CellResult(0, 0, 0.5, 0.5, 1.0, 3.0, 0.95, 0.5, 0.5),
        CellResult(1, 0, 1.5, 0.5, 10.0, 3.0, 0.9, 1.4, 0.5),
        CellResult(2, 0, 2.5, 0.5, None, 0.0, 0.1, None, None),
    ]

def test_build_stats_counts_and_worst():
    crit = load_criteria()["floor-kcs-exposed"]
    cells = _cells()
    grades, warns = grade_cells(cells, crit, 5.0)
    s = build_stats(cells, grades, crit, 5.0, warns, {"file": "t.ply"})
    assert s["n_cells"] == 3 and s["n_valid"] == 2
    assert s["grade_counts"] == {"pass": 1, "borderline": 1, "repair": 0, "rework": 0, "na": 1}
    assert s["worst"]["value_mm"] == 10.0 and s["worst"]["point_x"] == 1.4
    assert s["value_max_mm"] == 10.0 and s["value_min_mm"] == 1.0 and s["value_mean_mm"] == 5.5
    assert s["applied_criteria"]["u_mm"] == 5.0
    assert s["coverage_pct"] == round(100 * 2 / 3, 1)

def test_write_outputs(tmp_path):
    crit = load_criteria()["floor-kcs-exposed"]
    cells = _cells()
    grades, warns = grade_cells(cells, crit, 5.0)
    s = build_stats(cells, grades, crit, 5.0, warns, {})
    write_outputs(tmp_path, s, cells, grades)
    assert json.loads((tmp_path / "stats.json").read_text("utf-8"))["n_cells"] == 3
    rows = list(csv.DictReader(open(tmp_path / "results.csv", encoding="utf-8")))
    assert len(rows) == 3 and rows[1]["grade"] == "borderline" and rows[2]["grade"] == "na"
    assert json.loads((tmp_path / "cells.json").read_text("utf-8"))[0]["grade"] == "pass"
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_stats.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# engine/flatness/outputs/stats.py
"""stats.json / cells.json / results.csv 산출 (스펙 §5.1.7 필수 필드)."""
import csv
import json
import numpy as np


def build_stats(cells, grades, crit, u_mm, warnings, meta):
    valid = [c for c in cells if c.value_mm is not None]
    counts = {k: 0 for k in ("pass", "borderline", "repair", "rework", "na")}
    for g in grades:
        counts[g if g is not None else "na"] += 1
    vals = np.array([c.value_mm for c in valid]) if valid else np.array([0.0])
    worst = max(valid, key=lambda c: c.value_mm) if valid else None
    n = len(cells)
    return {
        "n_cells": n,
        "n_valid": len(valid),
        "grade_counts": counts,
        "grade_pct": {k: round(100 * v / n, 1) for k, v in counts.items()},
        "value_max_mm": round(float(vals.max()), 2),
        "value_min_mm": round(float(vals.min()), 2),
        "value_mean_mm": round(float(vals.mean()), 2),
        "value_p95_mm": round(float(np.percentile(vals, 95)), 2),
        "worst": None if worst is None else {
            "value_mm": round(worst.value_mm, 2), "cell_ix": worst.ix, "cell_iy": worst.iy,
            "point_x": worst.worst_x, "point_y": worst.worst_y},
        "coverage_pct": round(100 * len(valid) / n, 1) if n else 0.0,
        "reduced_span_cells": sum(1 for c in valid if c.span_used_m < (crit.span_m or 0)),
        "applied_criteria": {"name": crit.name, "source": crit.source, "span_m": crit.span_m,
                             "pass_mm": crit.pass_mm, "rework_mm": crit.rework_mm, "u_mm": u_mm},
        "warnings": list(warnings),
        "meta": meta,
    }


def _cell_row(c, g):
    return {"ix": c.ix, "iy": c.iy, "center_x": round(c.center_x, 3),
            "center_y": round(c.center_y, 3),
            "value_mm": None if c.value_mm is None else round(c.value_mm, 2),
            "span_used_m": round(c.span_used_m, 2), "occupancy": round(c.occupancy, 2),
            "grade": g if g is not None else "na",
            "worst_x": None if c.worst_x is None else round(c.worst_x, 3),
            "worst_y": None if c.worst_y is None else round(c.worst_y, 3)}


def write_outputs(out_dir, stats, cells, grades):
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = [_cell_row(c, g) for c, g in zip(cells, grades)]
    (out_dir / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "cells.json").write_text(
        json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    with open(out_dir / "results.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_stats.py -v`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/outputs/stats.py engine/tests/test_stats.py
git commit -m "feat(engine): stats/cells/CSV 산출"
```

---

### Task 11: 히트맵 PNG (판정 4색 + 판정 불가 회색)

**Files:**
- Create: `engine/flatness/outputs/heatmap.py`
- Test: `engine/tests/test_heatmap.py`

**Interfaces:**
- Consumes: Task 8 `CellResult`
- Produces: `GRADE_COLORS: dict[str, tuple]`, `render_heatmap(cells, grades, out_path, cell_m=1.0)` — PNG 저장 (축: m 단위)

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# engine/tests/test_heatmap.py
from flatness.core.cells import CellResult
from flatness.outputs.heatmap import render_heatmap, GRADE_COLORS

def test_five_grade_colors_defined():
    assert set(GRADE_COLORS) == {"pass", "borderline", "repair", "rework", "na"}

def test_heatmap_written(tmp_path):
    cells = [CellResult(x, y, x + 0.5, y + 0.5, 1.0, 3.0, 0.9, x + 0.5, y + 0.5)
             for x in range(3) for y in range(2)]
    grades = ["pass", "borderline", "repair", "rework", None, "pass"]
    out = tmp_path / "heatmap.png"
    render_heatmap(cells, grades, out)
    assert out.stat().st_size > 1000  # PNG 파일 생성 확인
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_heatmap.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 구현**

```python
# engine/flatness/outputs/heatmap.py
"""판정 히트맵 PNG — 4등급 색 + 판정 불가 회색 (스펙 §5.1.9, 색각 대비 고려 팔레트)."""
import matplotlib
matplotlib.use("Agg")  # 헤드리스 렌더
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch

GRADE_COLORS = {"pass": "#2e7d32", "borderline": "#f9ab00",
                "repair": "#e8710a", "rework": "#c5221f", "na": "#9e9e9e"}
_ORDER = ["pass", "borderline", "repair", "rework", "na"]
_LABELS = {"pass": "적합", "borderline": "경계", "repair": "보수",
           "rework": "재시공", "na": "판정 불가"}


def render_heatmap(cells, grades, out_path, cell_m=1.0):
    ncx = max(c.ix for c in cells) + 1
    ncy = max(c.iy for c in cells) + 1
    img = np.full((ncy, ncx), _ORDER.index("na"), dtype=int)
    for c, g in zip(cells, grades):
        img[c.iy, c.ix] = _ORDER.index(g if g is not None else "na")
    fig, ax = plt.subplots(figsize=(max(4, ncx * 0.6), max(3, ncy * 0.6)))
    ax.imshow(img, cmap=ListedColormap([GRADE_COLORS[k] for k in _ORDER]),
              vmin=0, vmax=len(_ORDER) - 1, origin="lower",
              extent=[0, ncx * cell_m, 0, ncy * cell_m])
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_title("평활도 판정 히트맵")
    ax.legend(handles=[Patch(color=GRADE_COLORS[k], label=_LABELS[k]) for k in _ORDER],
              loc="upper left", bbox_to_anchor=(1.01, 1.0), fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
```

한글 폰트 주의: 제목·범례가 □로 보이면 `matplotlib.rc("font", family="Malgun Gothic")`(Windows)을 모듈 상단에 추가하고 테스트 재실행.

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_heatmap.py -v`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add engine/flatness/outputs/heatmap.py engine/tests/test_heatmap.py
git commit -m "feat(engine): 5색 판정 히트맵 PNG"
```

---

### Task 12: 파이프라인 오케스트레이션 + CLI + 통합 테스트

**Files:**
- Create: `engine/flatness/core/pipeline.py`, `engine/flatness/cli.py`
- Test: `engine/tests/test_pipeline.py`, `engine/tests/test_cli.py`

**Interfaces:**
- Consumes: Task 4~11 전부 (`read_info`, `iter_chunks`, `detect_units`, `build_subcell_grid`, `fit_plane_ransac`, `residual_grid`, `evaluate_cells`, `load_criteria`, `grade_cells`, `build_stats`, `write_outputs`, `render_heatmap`)
- Produces:
  - `analyze_floor(path, scale_to_m, criterion, u_mm, out_dir, subcell_m=0.05, cell_m=1.0, chunk_size=2_000_000) -> dict` (stats 반환, out_dir에 stats.json/cells.json/results.csv/heatmap.png 생성)
  - CLI `flatness analyze FILE --out DIR [--units {m,cm,mm}] [--criteria NAME] [--uncertainty-mm F]`, `flatness list-criteria`. 종료 코드: 0 성공 / 2 단위 미확정 / 1 오류

- [ ] **Step 1: 실패하는 통합 테스트 작성**

```python
# engine/tests/test_pipeline.py
import numpy as np
from tests.fixtures.synthetic import flat_floor, add_bump, add_step, write_binary_ply
from flatness.core.pipeline import analyze_floor
from flatness.criteria import load_criteria

CRIT = load_criteria()["floor-kcs-exposed"]  # pass 7 / rework 21, U=5 → b1=2, b2=12

def test_depression_end_to_end(tmp_path):
    # 6x6m 바닥 + 2% 경사 + (2,2)에 10mm 함몰 → 경사 제거 후 함몰 검출
    # (함몰은 직선자 해석 정답이 정확히 깊이 — 2026-07-28 정정, 범프는 지지선 기하로 8.6mm가 정답)
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02, tilt=(0.02, 0.0)),
                   (2.0, 2.0), 0.3, -0.010)
    write_binary_ply(pts, tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert 9.0 <= stats["worst"]["value_mm"] <= 11.0          # ±1mm (스펙 §10.1)
    assert abs(stats["worst"]["point_x"] - 2.0) < 1.0         # 위치 1셀 이내
    assert abs(stats["worst"]["point_y"] - 2.0) < 1.0
    assert stats["grade_counts"]["borderline"] >= 1           # ≈10mm → 경계(2<10≤12)
    assert stats["grade_counts"]["pass"] >= 20                # 먼 셀은 적합(≈0mm)
    assert (tmp_path / "out" / "heatmap.png").exists()
    assert (tmp_path / "out" / "results.csv").exists()

def test_step_grades_repair(tmp_path):
    # x=3.0에 15mm 단차 → 12 < 15 ≤ 21 → 보수
    pts = add_step(flat_floor(size=(6.0, 6.0), spacing=0.02), 3.0, 0.015)
    write_binary_ply(pts, tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert abs(stats["worst"]["value_mm"] - 15.0) <= 1.0
    assert abs(stats["worst"]["point_x"] - 3.0) < 1.0         # 단차선 부근
    assert stats["grade_counts"]["repair"] >= 1
```

```python
# engine/tests/test_cli.py
import subprocess, sys, json
from tests.fixtures.synthetic import flat_floor, write_binary_ply

def _run(*args):
    return subprocess.run([sys.executable, "-m", "flatness.cli", *args],
                          capture_output=True, text=True)

def test_units_required_exit_2(tmp_path):
    write_binary_ply(flat_floor(size=(6.0, 6.0), spacing=0.05), tmp_path / "s.ply")
    r = _run("analyze", str(tmp_path / "s.ply"), "--out", str(tmp_path / "out"))
    assert r.returncode == 2
    assert "단위" in r.stdout  # 감지 결과·근거 출력 후 확정 요구

def test_analyze_success_exit_0(tmp_path):
    write_binary_ply(flat_floor(size=(6.0, 6.0), spacing=0.05), tmp_path / "s.ply")
    r = _run("analyze", str(tmp_path / "s.ply"), "--out", str(tmp_path / "out"),
             "--units", "m")
    assert r.returncode == 0, r.stderr
    stats = json.loads((tmp_path / "out" / "stats.json").read_text("utf-8"))
    assert stats["applied_criteria"]["name"] == "floor-kcs-exposed"  # 기본 기준

def test_list_criteria(tmp_path):
    r = _run("list-criteria")
    assert r.returncode == 0 and "floor-kcs-exposed" in r.stdout
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_pipeline.py tests/test_cli.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: 파이프라인 구현**

```python
# engine/flatness/core/pipeline.py
"""바닥 분석 오케스트레이션 — 1a: 단일 구역 가정(스펙 §11 P1 슬라이스)."""
import numpy as np
from flatness.io.reader import iter_chunks, read_info
from flatness.core.subcell import build_subcell_grid
from flatness.core.plane import fit_plane_ransac, residual_grid
from flatness.core.cells import evaluate_cells
from flatness.criteria import grade_cells
from flatness.outputs.stats import build_stats, write_outputs
from flatness.outputs.heatmap import render_heatmap


def analyze_floor(path, scale_to_m, criterion, u_mm, out_dir,
                  subcell_m=0.05, cell_m=1.0, chunk_size=2_000_000):
    info = read_info(path, chunk_size=chunk_size)          # 1차 패스: bbox·개수
    grid = build_subcell_grid(iter_chunks(path, chunk_size=chunk_size),
                              info, scale_to_m, subcell_m)  # 2차 패스: 비닝
    ys, xs = np.nonzero(~np.isnan(grid.median_z))
    if len(xs) < 10:
        raise ValueError("유효 서브셀 부족 — 바닥 미검출")
    cx = grid.origin[0] + (xs + 0.5) * grid.size_m
    cy = grid.origin[1] + (ys + 0.5) * grid.size_m
    abc = fit_plane_ransac(cx, cy, grid.median_z[ys, xs].astype(float))
    residuals = residual_grid(grid, abc)
    span = criterion.span_m if criterion.span_m else 3.0
    cells = evaluate_cells(residuals, grid, span_m=span, cell_m=cell_m)
    grades, warns = grade_cells(cells, criterion, u_mm)
    meta = {"file": str(path), "n_points": info.n_points, "scale_to_m": scale_to_m,
            "subcell_m": subcell_m, "cell_m": cell_m, "engine_version": "p1a-0.1.0"}
    stats = build_stats(cells, grades, criterion, u_mm, warns, meta)
    write_outputs(out_dir, stats, cells, grades)
    render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
    return stats
```

- [ ] **Step 4: CLI 구현**

```python
# engine/flatness/cli.py
"""CLI — 단위 자동 확정 금지: --units 없으면 감지 결과를 보여주고 exit 2 (스펙 §5.1.1)."""
import argparse
import sys
from pathlib import Path
from flatness.criteria import load_criteria
from flatness.io.reader import read_info
from flatness.io.units import detect_units

_SCALES = {"m": 1.0, "cm": 0.01, "mm": 0.001}


def main(argv=None):
    p = argparse.ArgumentParser(prog="flatness")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze", help="바닥 평활도 분석")
    a.add_argument("file", type=Path)
    a.add_argument("--out", type=Path, required=True)
    a.add_argument("--units", choices=sorted(_SCALES))
    a.add_argument("--criteria", default="floor-kcs-exposed")
    a.add_argument("--uncertainty-mm", type=float, default=5.0)
    sub.add_parser("list-criteria", help="탑재된 판정 기준 목록")
    args = p.parse_args(argv)

    crits = load_criteria()
    if args.cmd == "list-criteria":
        for c in crits.values():
            span = f"{c.span_m}m당" if c.span_m else "높이당"
            print(f"{c.name:26s} {c.surface:5s} {span} {c.pass_mm}mm  ({c.source})")
        return 0

    if args.criteria not in crits:
        print(f"오류: 알 수 없는 기준 '{args.criteria}' — flatness list-criteria 참고")
        return 1
    crit = crits[args.criteria]
    if crit.surface != "floor":
        print(f"오류: 1a 엔진은 바닥 기준만 지원 ('{args.criteria}'는 {crit.surface})")
        return 1

    if args.units is None:
        info = read_info(args.file)
        print("단위가 지정되지 않았습니다. 감지 결과(자동 확정하지 않음):")
        for g in detect_units(info):
            print(f"  --units {g.unit:2s} (scale={g.scale_to_m}) [{g.confidence}] {g.evidence}")
        print("위 후보 중 하나를 --units 로 명시해 다시 실행하세요.")
        return 2

    from flatness.core.pipeline import analyze_floor
    try:
        stats = analyze_floor(args.file, _SCALES[args.units], crit,
                              args.uncertainty_mm, args.out)
    except ValueError as e:
        print(f"분석 실패: {e}")
        return 1
    gc = stats["grade_counts"]
    print(f"분석 완료: 셀 {stats['n_cells']}개 (유효 {stats['n_valid']})")
    print(f"  적합 {gc['pass']} / 경계 {gc['borderline']} / 보수 {gc['repair']}"
          f" / 재시공 {gc['rework']} / 판정불가 {gc['na']}")
    if stats["worst"] is not None:
        print(f"  최대 {stats['value_max_mm']}mm @ ({stats['worst']['point_x']:.2f},"
              f" {stats['worst']['point_y']:.2f})  기준 {stats['applied_criteria']['name']}"
              f" (U={stats['applied_criteria']['u_mm']}mm)")
    print(f"  ※ 본 결과는 스크리닝이며 공식 검측(실물 직선자·레벨)을 대체하지 않습니다.")
    print(f"  산출물: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: 통과 확인**

Run: `python -m pytest tests/test_pipeline.py tests/test_cli.py -v`
Expected: 5 PASS

- [ ] **Step 6: 전체 테스트 실행**

Run: `python -m pytest -q`
Expected: 전체 PASS (약 33개)

- [ ] **Step 7: 수동 스모크 — 실행 결과를 눈으로 확인 (검증 지시)**

```bash
cd engine && python -c "
from tests.fixtures.synthetic import flat_floor, add_bump, write_binary_ply
write_binary_ply(add_bump(flat_floor(size=(8.0,6.0), spacing=0.02, tilt=(0.015,0)), (3.0,2.0), 0.4, 0.012), 'demo_scan.ply')
" && python -m flatness.cli analyze demo_scan.ply --out demo_out --units m
```

Expected: exit 0, 판정 분포 출력, `demo_out/heatmap.png`를 열어 (3,2) 부근 경계/보수 셀 색상 확인

- [ ] **Step 8: Commit**

```bash
git add engine/flatness/core/pipeline.py engine/flatness/cli.py engine/tests/test_pipeline.py engine/tests/test_cli.py
git commit -m "feat(engine): 파이프라인 + CLI + 결함 주입 통합 테스트"
```

---

## 후속 계획 (이 계획 범위 밖 — 1a 완료 후 별도 작성)

- **P1b**: XYZ/TXT/CSV/PTS 파서, 다중 구역 분할(법선·높이 히스토그램, Open3D 도입), 유령층·신뢰도 마스크
- **P1c**: 벽면 파이프라인(기울기·수직도)
- **P1d**: 기존 결과 임포트(§5.4), 3D 프리뷰 PNG, 3천만 점 메모리 스파이크 테스트, 종합의견 템플릿
- **P2~P5**: 스펙 §11 참조

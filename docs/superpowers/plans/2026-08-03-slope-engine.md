# 구배 산출 엔진 Implementation Plan (세부과업 4 단계 B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 점군에서 2m×2m 격자별 구배(크기·방향·불확도)를 산출하고, 설계기준과 대조해 등급을 매기고, 지도 PNG와 통계를 내는 것까지를 CLI로 확인 가능하게 만든다.

**Architecture:** 기존 서브셀 격자(5cm 중앙값)를 그대로 재사용하고 집계 단위만 2m로 바꾼다. 셀마다 유효 서브셀 중앙값에 `fit_plane_ransac`으로 평면을 피팅해 `z = a·x + b·y + c`의 계수를 얻고, 거기서 구배 크기·내리막 방향·잔차 RMSE·기울기 표준오차를 산출한다. DB와 화면은 건드리지 않는다.

**Tech Stack:** Python, NumPy, SciPy, matplotlib (전부 기존 의존성)

## Global Constraints

- 스펙 정본: `docs/superpowers/specs/2026-08-02-slope-analysis-design.md` §4.2·§4.3·§5
- **분석 단위는 2m×2m 격자**(과업지시서 11쪽 명시). 평활도 판정셀 1m와 다르다
- **과업지시서 분석 오차율 ±5% 이내**를 테스트 게이트로 건다
- 주석·문서·사용자 대면 문자열은 한국어. **사용자 대면 문자열에 U+2014(—) 금지**(주석은 허용). 문자를 셀 때는 **리터럴 글리프**로 검색하고, 검색 패턴이 실제로 매칭되는지 먼저 자기검증할 것
- 기존 함수 시그니처를 바꾸지 않는다. 특히 `fit_plane_ransac`은 `zones.py`·`pipeline.py`가 쓰므로 건드리지 않는다
- 기준선: engine 139 passed. 작업 전후로 확인
- 검증 명령: `cd engine && python -m pytest -q`

## 방향 규약 (반드시 이대로 구현할 것)

`fit_plane_ransac`이 반환하는 `(a, b, c)`는 `z = a·x + b·y + c`다. 벡터 `(a, b)`는
**z가 증가하는 방향, 즉 오르막**을 가리킨다.

**배수는 내리막 방향으로 흐른다.** 따라서 판정에 쓸 방향은 다음과 같다.

```
downhill_rad = atan2(-b, -a)
```

스펙 §4.2가 `atan2(b, a)`로 적어 둔 것은 오르막 방향이며 **그대로 쓰면 모든 방향
판정이 180° 뒤집힌다** - 정상 배수가 역구배로, 역구배가 정상으로 나온다. 이 계획이
정본이고, Task 1에서 스펙도 함께 고친다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `engine/flatness/core/slope.py` (신규) | 셀별 구배 산출 + 등급 판정 + 통계 |
| `engine/flatness/outputs/slope_map.py` (신규) | 구배 크기 히트맵 + 내리막 화살표 PNG |
| `engine/flatness/core/pipeline.py` (수정) | `analyze_slope()` 추가 |
| `engine/flatness/cli.py` (수정) | `analyze-slope` 서브커맨드 |
| `engine/tests/test_slope.py` (신규) | 산출·판정·통계 |
| `engine/tests/test_slope_map.py` (신규) | PNG 산출 |
| `engine/tests/test_cli.py` (수정) | CLI 스모크 |

---

### Task 1: 셀별 구배 산출

**Files:**
- Create: `engine/flatness/core/slope.py`
- Test: `engine/tests/test_slope.py`
- Modify: `docs/superpowers/specs/2026-08-02-slope-analysis-design.md` (§4.2 방향 규약 정정)

**Interfaces:**
- Consumes: `flatness.core.subcell.SubcellGrid`(필드 `size_m`, `origin`, `shape`, `median_z`, `counts`), `flatness.core.plane.fit_plane_ransac(x, y, z) -> (a, b, c)`
- Produces:
  - `@dataclass SlopeCell` — 필드는 아래 코드 그대로
  - `compute_slope_cells(grid, cell_m=2.0, min_subcells=10) -> list[SlopeCell]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`engine/tests/test_slope.py`를 새로 만든다.

```python
"""구배 산출 — 정답을 아는 합성 경사면으로 정량 검증한다."""
import math
import numpy as np

from flatness.core.slope import compute_slope_cells
from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import ReadInfo
from tests.fixtures.synthetic import flat_floor


def _grid(pts, subcell_m=0.05):
    info = ReadInfo(count=len(pts), bbox_min=pts.min(axis=0), bbox_max=pts.max(axis=0),
                    fmt="synthetic", has_faces=False)
    return build_subcell_grid([pts], info, 1.0, subcell_m=subcell_m)


def test_uniform_2pct_slope_in_x():
    # tilt=(0.02, 0) -> z = 0.02x. 구배 2.0%, 내리막은 -x 방향(각 pi)
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.0))
    cells = [c for c in compute_slope_cells(_grid(pts)) if c.ok]
    assert len(cells) >= 9
    for c in cells:
        assert abs(c.slope_pct - 2.0) < 0.1          # 과업지시서 오차율 +-5% 이내
        assert abs(abs(c.downhill_rad) - math.pi) < 0.05


def test_diagonal_slope_magnitude_and_direction():
    # tilt=(0.02, 0.02) -> 크기 sqrt(2)*2% = 2.83%, 오르막 45도이므로 내리막 -135도
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.02))
    cells = [c for c in compute_slope_cells(_grid(pts)) if c.ok]
    assert cells
    for c in cells:
        assert abs(c.slope_pct - 2.0 * math.sqrt(2) * 100 / 100) < 0.15
        assert abs(c.downhill_rad - (-3 * math.pi / 4)) < 0.05


def test_flat_floor_has_near_zero_slope():
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02)
    cells = [c for c in compute_slope_cells(_grid(pts)) if c.ok]
    assert cells
    assert all(c.slope_pct < 0.05 for c in cells)


def test_noise_does_not_break_gate():
    # 노이즈 2mm에서도 오차율 +-5%(즉 2.0% 기준 0.1%p) 안에 들어와야 한다
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.0), noise_sd=0.002)
    cells = [c for c in compute_slope_cells(_grid(pts)) if c.ok]
    assert cells
    errs = [abs(c.slope_pct - 2.0) for c in cells]
    assert max(errs) < 0.1
    # 불확도가 산출되고 양수여야 한다
    assert all(c.se_pct > 0 for c in cells)


def test_sparse_cell_is_not_ok():
    # 점이 거의 없는 셀은 수치적으로 평면이 결정되지 않으므로 ok=False
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.0))
    cells = compute_slope_cells(_grid(pts), min_subcells=10_000)
    assert cells
    assert all(not c.ok for c in cells)


def test_cell_size_controls_cell_count():
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02)
    four = [c for c in compute_slope_cells(_grid(pts), cell_m=4.0) if c.ok]
    two = [c for c in compute_slope_cells(_grid(pts), cell_m=2.0) if c.ok]
    assert len(two) > len(four)
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd engine && python -m pytest tests/test_slope.py -q`
Expected: FAIL. `flatness.core.slope` 모듈이 없다.

`ReadInfo`의 실제 필드가 위와 다르면 `engine/flatness/io/reader.py`를 열어 맞춰라. 테스트가 컬렉션 단계에서 깨지면 그것부터 해결한다.

- [ ] **Step 3: 구현한다**

`engine/flatness/core/slope.py`를 만든다.

```python
"""구배(경사) 산출 — 2m 격자별로 서브셀 중앙값에 평면을 피팅해 기울기를 얻는다.

과업지시서 세부과업 4의 분석 단위는 2m x 2m다(평활도 판정셀 1m와 다르다).

원점군이 아니라 서브셀 중앙값에 피팅하는 이유:
  1. 노이즈가 중앙값 단계에서 이미 걸러진다
  2. 점 밀도 불균일의 영향이 사라진다. 원점군에 그대로 피팅하면 스캐너에 가까워
     점이 빽빽한 구역이 평면을 끌어당긴다. 서브셀 중앙값은 면적당 균등하다
  3. 계산량이 수천분의 1이다
"""
from dataclasses import dataclass
import math

import numpy as np

from flatness.core.plane import fit_plane_ransac


@dataclass
class SlopeCell:
    cx: int
    cy: int
    center_x: float
    center_y: float
    n_subcells: int
    slope_pct: float
    downhill_rad: float
    rmse_m: float
    se_pct: float
    ok: bool


def compute_slope_cells(grid, cell_m=2.0, min_subcells=10):
    """서브셀 격자를 cell_m 격자로 묶어 셀마다 구배를 산출한다.

    min_subcells: 평면이 수치적으로 결정되려면 최소 이만큼의 유효 서브셀이 필요하다.
    3점이면 수학적으로는 평면이 정해지지만 잔차와 표준오차가 무의미해진다.
    """
    ny, nx = grid.shape
    sub = grid.size_m
    per_cell = max(1, int(round(cell_m / sub)))
    ncx = max(1, int(math.ceil(nx / per_cell)))
    ncy = max(1, int(math.ceil(ny / per_cell)))

    # 서브셀 중심 좌표(절대 m). origin은 bbox_min의 xy다.
    xs = grid.origin[0] + (np.arange(nx) + 0.5) * sub
    ys = grid.origin[1] + (np.arange(ny) + 0.5) * sub

    out = []
    for cy in range(ncy):
        for cx in range(ncx):
            x0, x1 = cx * per_cell, min(nx, (cx + 1) * per_cell)
            y0, y1 = cy * per_cell, min(ny, (cy + 1) * per_cell)
            block = grid.median_z[y0:y1, x0:x1]
            valid = ~np.isnan(block)
            n = int(np.count_nonzero(valid))
            center_x = float(xs[min(nx - 1, (x0 + x1 - 1) // 2)])
            center_y = float(ys[min(ny - 1, (y0 + y1 - 1) // 2)])
            if n < min_subcells:
                out.append(SlopeCell(cx, cy, center_x, center_y, n,
                                     float("nan"), float("nan"), float("nan"),
                                     float("nan"), False))
                continue
            jj, ii = np.nonzero(valid)
            px = xs[x0:x1][ii].astype(np.float64)
            py = ys[y0:y1][jj].astype(np.float64)
            pz = block[valid].astype(np.float64)
            # 좌표가 한 줄로 늘어서면(퇴화) 평면이 결정되지 않는다
            sx, sy = float(np.std(px)), float(np.std(py))
            if sx <= 0.0 or sy <= 0.0:
                out.append(SlopeCell(cx, cy, center_x, center_y, n,
                                     float("nan"), float("nan"), float("nan"),
                                     float("nan"), False))
                continue
            try:
                a, b, c = fit_plane_ransac(px, py, pz)
            except ValueError:
                out.append(SlopeCell(cx, cy, center_x, center_y, n,
                                     float("nan"), float("nan"), float("nan"),
                                     float("nan"), False))
                continue
            # 잔차는 인라이어가 아니라 셀 안의 모든 유효 서브셀에 대해 잰다.
            # 결함이 있으면 RMSE가 커지고 그만큼 불확도도 커져 보수적으로 판정된다.
            resid = pz - (a * px + b * py + c)
            rmse = float(np.sqrt(np.mean(resid ** 2)))
            # 최소제곱 기울기의 표준오차. 크기의 오차는 두 성분 오차의 벡터합으로
            # 보수적으로 잡는다.
            se_a = rmse / (math.sqrt(n) * sx)
            se_b = rmse / (math.sqrt(n) * sy)
            se_pct = 100.0 * math.hypot(se_a, se_b)
            slope_pct = 100.0 * math.hypot(a, b)
            # (a, b)는 오르막 방향이다. 물은 내리막으로 흐르므로 부호를 뒤집는다.
            downhill = math.atan2(-b, -a)
            out.append(SlopeCell(cx, cy, center_x, center_y, n,
                                 slope_pct, downhill, rmse, se_pct, True))
    return out
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd engine && python -m pytest tests/test_slope.py -q`
Expected: 6 passed

실패하면 값을 확인해 원인을 밝혀라. **테스트의 허용 오차를 늘려서 통과시키지 마라** - ±5%는 과업지시서가 요구하는 게이트다.

- [ ] **Step 5: 스펙의 방향 규약을 바로잡는다**

`docs/superpowers/specs/2026-08-02-slope-analysis-design.md` §4.2에서 다음 줄을 찾아라.

```
- 구배 방향(rad) = `atan2(b, a)`
```

아래로 바꾼다.

```
- 내리막 방향(rad) = `atan2(-b, -a)`. **`(a, b)`는 오르막 방향이므로 부호를 뒤집는다.**
  물은 내리막으로 흐르므로 배수 방향 판정은 내리막 기준이다. `atan2(b, a)`를 그대로
  쓰면 모든 방향 판정이 180도 뒤집혀 정상 배수가 역구배로 나온다
```

- [ ] **Step 6: 전체 스위트로 회귀를 확인한다**

Run: `cd engine && python -m pytest -q`
Expected: 145 passed (기준선 139 + 신규 6)

- [ ] **Step 7: 커밋**

```bash
git add engine/flatness/core/slope.py engine/tests/test_slope.py docs/superpowers/specs/2026-08-02-slope-analysis-design.md
git commit -m "feat(engine): 2m 격자 구배 산출 + 스펙의 방향 부호 오류 정정"
```

---

### Task 2: 등급 판정

**Files:**
- Modify: `engine/flatness/core/slope.py`
- Test: `engine/tests/test_slope.py` (추가)

**Interfaces:**
- Consumes: Task 1의 `SlopeCell`
- Produces: `grade_slope_cells(cells, threshold, drain_points=None) -> list[dict]`
  - `threshold`: `{"design_pct": float, "pass_pct": float, "re_pct": float, "dir_pass_deg": float}`
  - `drain_points`: `[(x, y), ...]` 또는 None
  - 반환 dict 키: `cell`(SlopeCell), `grade`(str), `reason`(str), `dev_pct`(float), `dir_err_deg`(float|None), `correction_mm`(float)

**등급 문자열은 평활도와 같은 4종을 쓴다:** `"적합"`, `"경계"`, `"보수"`, `"재시공"`. 판정 불가는 `"판정불가"`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`engine/tests/test_slope.py` 맨 아래에 추가한다. 상단 import에 `grade_slope_cells`를 더한다.

```python
TH = {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}


def _cell(slope_pct, downhill_rad, se_pct=0.01, ok=True, cx=0, cy=0):
    from flatness.core.slope import SlopeCell
    return SlopeCell(cx, cy, 1.0, 1.0, 1600, slope_pct, downhill_rad, 0.001, se_pct, ok)


def test_on_target_slope_is_pass():
    g = grade_slope_cells([_cell(2.0, math.pi)], TH)[0]
    assert g["grade"] == "적합"


def test_far_off_is_redo():
    g = grade_slope_cells([_cell(4.0, math.pi)], TH)[0]
    assert g["grade"] == "재시공"


def test_slightly_off_is_repair():
    g = grade_slope_cells([_cell(2.8, math.pi)], TH)[0]
    assert g["grade"] == "보수"


def test_wide_uncertainty_makes_it_borderline():
    # 편차 0.6%p로 pass(0.5)를 넘지만 불확도 0.3%p가 경계를 걸친다
    g = grade_slope_cells([_cell(2.6, math.pi, se_pct=0.3)], TH)[0]
    assert g["grade"] == "경계"


def test_uncertainty_larger_than_tolerance_is_undecidable():
    # 불확도가 허용치보다 크면 애초에 가릴 해상도가 없다
    g = grade_slope_cells([_cell(2.0, math.pi, se_pct=0.9)], TH)[0]
    assert g["grade"] == "판정불가"


def test_not_ok_cell_is_undecidable():
    g = grade_slope_cells([_cell(float("nan"), float("nan"), ok=False)], TH)[0]
    assert g["grade"] == "판정불가"


# 역구배: 크기는 설계와 같은데 물이 배수구 반대로 흐른다. 크기만 보는 판정으로는
# 절대 안 잡히고, 실무 배수 하자의 대부분이 이것이다.
def test_reverse_slope_is_redo_even_when_magnitude_is_perfect():
    # 배수구가 -x 쪽(원점)에 있는데 내리막이 +x 방향이면 역구배다
    cell = _cell(2.0, 0.0)          # 내리막이 +x
    g = grade_slope_cells([cell], TH, drain_points=[(-10.0, 1.0)])[0]
    assert g["grade"] == "재시공"
    assert "역구배" in g["reason"]


def test_direction_toward_drain_is_pass():
    cell = _cell(2.0, math.pi)      # 내리막이 -x
    g = grade_slope_cells([cell], TH, drain_points=[(-10.0, 1.0)])[0]
    assert g["grade"] == "적합"


def test_direction_is_skipped_without_drain_points():
    # 배수구를 모르면 방향은 판정하지 않는다(크기만 본다)
    g = grade_slope_cells([_cell(2.0, 0.0)], TH)[0]
    assert g["grade"] == "적합"
    assert g["dir_err_deg"] is None


def test_correction_is_reported_in_mm_over_the_cell():
    # 2m 셀에서 구배 0.5%p 차이는 양단 높이차 10mm다
    g = grade_slope_cells([_cell(2.5, math.pi)], TH, cell_m=2.0)[0]
    assert abs(g["correction_mm"] - 10.0) < 0.5
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd engine && python -m pytest tests/test_slope.py -q`
Expected: FAIL. `grade_slope_cells`가 없다.

- [ ] **Step 3: 구현한다**

`engine/flatness/core/slope.py` 맨 아래에 추가한다.

```python
GRADE_PASS = "적합"
GRADE_BORDER = "경계"
GRADE_REPAIR = "보수"
GRADE_REDO = "재시공"
GRADE_NA = "판정불가"


def _angle_diff(a, b):
    """두 각의 최소 차이(0~pi)."""
    d = abs(a - b) % (2 * math.pi)
    return d if d <= math.pi else 2 * math.pi - d


def grade_slope_cells(cells, threshold, drain_points=None, cell_m=2.0):
    """셀별 구배를 설계기준과 대조해 등급을 매긴다(스펙 5.2).

    불확도를 더하고 빼는 방향에 주의한다. 적합은 불확도를 감안해도 확실히 안쪽일
    때만 주고(d + u), 재시공은 확실히 바깥일 때만 준다(d - u). 그 사이는 경계로
    남긴다 - 데이터가 단정을 허락하지 않는데 단정하면 안 된다.
    """
    design = float(threshold["design_pct"])
    pass_pct = float(threshold["pass_pct"])
    re_pct = float(threshold["re_pct"])
    dir_pass = float(threshold["dir_pass_deg"])
    out = []
    for c in cells:
        if not c.ok:
            out.append({"cell": c, "grade": GRADE_NA, "reason": "유효 서브셀 부족",
                        "dev_pct": float("nan"), "dir_err_deg": None,
                        "correction_mm": float("nan")})
            continue
        u = c.se_pct
        if u > pass_pct:
            out.append({"cell": c, "grade": GRADE_NA,
                        "reason": "측정 불확도가 허용치보다 커서 가릴 해상도가 없음",
                        "dev_pct": abs(c.slope_pct - design), "dir_err_deg": None,
                        "correction_mm": float("nan")})
            continue
        d = abs(c.slope_pct - design)
        # 2m 셀 양단 높이차로 환산: 구배 1%p = 셀 길이의 1% = cell_m*10 mm
        correction_mm = d * cell_m * 10.0
        dir_err = None
        if drain_points:
            # 기대 방향: 셀 중심에서 가장 가까운 배수구를 향하는 방향
            best = min(drain_points,
                       key=lambda p: (p[0] - c.center_x) ** 2 + (p[1] - c.center_y) ** 2)
            expect = math.atan2(best[1] - c.center_y, best[0] - c.center_x)
            dir_err = math.degrees(_angle_diff(c.downhill_rad, expect))
            if dir_err > 90.0:
                out.append({"cell": c, "grade": GRADE_REDO,
                            "reason": "역구배(물이 배수구 반대로 흐름)",
                            "dev_pct": d, "dir_err_deg": dir_err,
                            "correction_mm": correction_mm})
                continue
        if d - u > re_pct:
            grade, reason = GRADE_REDO, "설계 구배와의 편차가 재시공 기준을 넘음"
        elif d + u <= pass_pct and (dir_err is None or dir_err <= dir_pass):
            grade, reason = GRADE_PASS, "크기·방향 모두 허용 안"
        elif d - u > pass_pct or (dir_err is not None and dir_err > dir_pass):
            grade, reason = GRADE_REPAIR, "허용을 벗어났으나 국소 보정 가능"
        else:
            grade, reason = GRADE_BORDER, "불확도 폭이 허용 경계를 걸쳐 단정 불가"
        out.append({"cell": c, "grade": grade, "reason": reason, "dev_pct": d,
                    "dir_err_deg": dir_err, "correction_mm": correction_mm})
    return out
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd engine && python -m pytest tests/test_slope.py -q`
Expected: 16 passed (Task 1의 6 + 신규 10)

- [ ] **Step 5: 커밋**

```bash
git add engine/flatness/core/slope.py engine/tests/test_slope.py
git commit -m "feat(engine): 구배 등급 판정(역구배 우선, 불확도 보수적 적용)"
```

---

### Task 3: 구역별 통계

**Files:**
- Modify: `engine/flatness/core/slope.py`
- Test: `engine/tests/test_slope.py` (추가)

**Interfaces:**
- Consumes: Task 2의 `grade_slope_cells` 반환값
- Produces: `slope_summary(graded) -> dict` — 키 `mean_dev_pct`, `std_dev_pct`, `max_dev_pct`, `counts`(등급별 개수 dict), `coverage_pct`

과업지시서 11쪽이 "구간별 구배 편차 통계값(평균, 표준편차, 최대편차) 자동 산출"을 요구한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```python
def test_summary_reports_required_statistics():
    cells = [_cell(2.0, math.pi), _cell(2.4, math.pi), _cell(3.0, math.pi)]
    s = slope_summary(grade_slope_cells(cells, TH))
    # 편차 0.0, 0.4, 1.0 -> 평균 0.4667
    assert abs(s["mean_dev_pct"] - (0.0 + 0.4 + 1.0) / 3) < 1e-6
    assert abs(s["max_dev_pct"] - 1.0) < 1e-6
    assert s["std_dev_pct"] > 0
    assert s["counts"]["적합"] >= 1
    assert abs(s["coverage_pct"] - 100.0) < 1e-6


def test_summary_excludes_undecidable_from_statistics():
    cells = [_cell(2.0, math.pi), _cell(float("nan"), float("nan"), ok=False)]
    s = slope_summary(grade_slope_cells(cells, TH))
    assert s["counts"]["판정불가"] == 1
    assert abs(s["coverage_pct"] - 50.0) < 1e-6
    # 판정불가 셀의 nan이 통계를 오염시키면 안 된다
    assert not math.isnan(s["mean_dev_pct"])


def test_summary_of_empty_input_is_safe():
    s = slope_summary([])
    assert s["coverage_pct"] == 0.0
    assert math.isnan(s["mean_dev_pct"])
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd engine && python -m pytest tests/test_slope.py -q`
Expected: FAIL. `slope_summary`가 없다.

- [ ] **Step 3: 구현한다**

```python
def slope_summary(graded):
    """구간별 편차 통계(과업지시서 11쪽: 평균·표준편차·최대편차).

    판정 불가 셀은 통계에서 제외한다. 편차가 nan이라 넣으면 전체가 nan이 되고,
    무엇보다 "잴 수 없었던 것"을 "편차 0"처럼 섞으면 결과가 왜곡된다.
    """
    counts = {GRADE_PASS: 0, GRADE_BORDER: 0, GRADE_REPAIR: 0,
              GRADE_REDO: 0, GRADE_NA: 0}
    devs = []
    for g in graded:
        counts[g["grade"]] = counts.get(g["grade"], 0) + 1
        if g["grade"] != GRADE_NA:
            devs.append(g["dev_pct"])
    total = len(graded)
    decided = total - counts[GRADE_NA]
    arr = np.asarray(devs, dtype=np.float64)
    return {
        "mean_dev_pct": float(arr.mean()) if arr.size else float("nan"),
        "std_dev_pct": float(arr.std(ddof=0)) if arr.size else float("nan"),
        "max_dev_pct": float(arr.max()) if arr.size else float("nan"),
        "counts": counts,
        "coverage_pct": (100.0 * decided / total) if total else 0.0,
    }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd engine && python -m pytest tests/test_slope.py -q`
Expected: 19 passed

- [ ] **Step 5: 커밋**

```bash
git add engine/flatness/core/slope.py engine/tests/test_slope.py
git commit -m "feat(engine): 구배 구간별 통계(평균·표준편차·최대편차)"
```

---

### Task 4: 구배 지도 PNG

**Files:**
- Create: `engine/flatness/outputs/slope_map.py`
- Test: `engine/tests/test_slope_map.py`

**Interfaces:**
- Consumes: Task 2의 `grade_slope_cells` 반환값
- Produces: `render_slope_map(graded, out_path, cell_m=2.0) -> str` (쓴 경로 반환)

**참고할 기존 파일:** `engine/flatness/outputs/heatmap.py`. matplotlib Agg 백엔드 설정과 플랫폼별 한글 폰트 설정이 그 파일 상단의 **import 부수효과**로 되어 있다. `slope_map.py`도 같은 방식으로 `heatmap`을 import해 폰트를 얻는다(`worker/flatworker/report/assets.py`가 쓰는 방식과 동일).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```python
"""구배 지도 PNG — 파일이 실제로 만들어지고 열리는지까지 확인한다."""
import math
import os

from flatness.core.slope import SlopeCell, grade_slope_cells
from flatness.outputs.slope_map import render_slope_map

TH = {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}


def _cells():
    out = []
    for cy in range(3):
        for cx in range(3):
            out.append(SlopeCell(cx, cy, cx * 2.0 + 1.0, cy * 2.0 + 1.0, 1600,
                                 2.0 + 0.3 * cx, math.pi, 0.001, 0.01, True))
    return out


def test_renders_png_file(tmp_path):
    p = tmp_path / "slope.png"
    got = render_slope_map(grade_slope_cells(_cells(), TH), str(p))
    assert got == str(p)
    assert os.path.getsize(p) > 1000


def test_undecidable_cells_do_not_crash_render(tmp_path):
    cells = _cells()
    cells.append(SlopeCell(9, 9, 20.0, 20.0, 0, float("nan"), float("nan"),
                           float("nan"), float("nan"), False))
    p = tmp_path / "slope2.png"
    render_slope_map(grade_slope_cells(cells, TH), str(p))
    assert os.path.getsize(p) > 1000


def test_empty_input_still_writes_a_file(tmp_path):
    p = tmp_path / "empty.png"
    render_slope_map([], str(p))
    assert os.path.exists(p)
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd engine && python -m pytest tests/test_slope_map.py -q`
Expected: FAIL. 모듈이 없다.

- [ ] **Step 3: 구현한다**

```python
"""구배 지도 — 등급 색 배경 + 내리막 방향 화살표.

heatmap을 import하는 것은 부수효과 목적이다: matplotlib Agg 백엔드와 플랫폼별
한글 폰트 설정이 그 모듈 상단에 있다(worker/flatworker/report/assets.py와 동일한
방식). 이 import를 지우면 한글이 네모 상자로 렌더된다.
"""
from flatness.outputs import heatmap as _engine_heatmap  # noqa: F401
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch

from flatness.core.slope import (GRADE_BORDER, GRADE_NA, GRADE_PASS,
                                 GRADE_REDO, GRADE_REPAIR)

# 평활도 히트맵과 같은 색 언어를 쓴다 - 같은 스캔의 두 결과가 나란히 뜨므로
# 색이 다르면 혼란스럽다.
_COLOR = {
    GRADE_PASS: "#3d8b3d",
    GRADE_BORDER: "#d6c11e",
    GRADE_REPAIR: "#e07b1a",
    GRADE_REDO: "#c0392b",
    GRADE_NA: "#9e9e9e",
}


def render_slope_map(graded, out_path, cell_m=2.0):
    fig, ax = plt.subplots(figsize=(8, 7))
    for g in graded:
        c = g["cell"]
        x0 = c.center_x - cell_m / 2
        y0 = c.center_y - cell_m / 2
        ax.add_patch(plt.Rectangle((x0, y0), cell_m, cell_m,
                                   facecolor=_COLOR.get(g["grade"], "#9e9e9e"),
                                   edgecolor="white", linewidth=0.5))
        if not c.ok:
            continue
        # 내리막 방향 화살표. 역구배 셀은 굵게 그린다 - 크기가 정상이면 색만으로는
        # 드러나지 않아서, 물이 반대로 흐르는 것을 놓치기 쉽다.
        reverse = g["dir_err_deg"] is not None and g["dir_err_deg"] > 90.0
        L = cell_m * 0.35
        ax.arrow(c.center_x, c.center_y,
                 L * np.cos(c.downhill_rad), L * np.sin(c.downhill_rad),
                 head_width=cell_m * 0.12, length_includes_head=True,
                 color="black", linewidth=2.2 if reverse else 0.9)
    if graded:
        xs = [g["cell"].center_x for g in graded]
        ys = [g["cell"].center_y for g in graded]
        ax.set_xlim(min(xs) - cell_m, max(xs) + cell_m)
        ax.set_ylim(min(ys) - cell_m, max(ys) + cell_m)
    ax.set_aspect("equal")
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_title("구배 판정 지도 (화살표는 내리막 방향)")
    ax.legend(handles=[Patch(facecolor=v, label=k) for k, v in _COLOR.items()],
              loc="upper left", bbox_to_anchor=(1.01, 1.0), fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    return out_path
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd engine && python -m pytest tests/test_slope_map.py -q`
Expected: 3 passed

- [ ] **Step 5: 렌더된 PNG를 눈으로 대조한다**

```bash
cd engine && python -c "
import math
from flatness.core.slope import SlopeCell, grade_slope_cells
from flatness.outputs.slope_map import render_slope_map
TH={'design_pct':2.0,'pass_pct':0.5,'re_pct':1.5,'dir_pass_deg':30.0}
cells=[SlopeCell(x,y,x*2.0+1,y*2.0+1,1600,2.0+0.4*x,math.pi if y else 0.0,0.001,0.01,True)
       for y in range(3) for x in range(4)]
render_slope_map(grade_slope_cells(cells,TH,drain_points=[(-5.0,3.0)]),'slope_check.png')
print('wrote slope_check.png')"
```

`engine/slope_check.png`를 열어 확인한다.
- 한글 제목·범례가 **네모 상자가 아니라 정상 글자**로 보이는가
- 아래 줄(y=0, 내리막이 +x)은 배수구가 -x 쪽이므로 **역구배**여서 빨간색이고 화살표가 굵은가
- 위 두 줄은 내리막이 -x라 정상이고 화살표가 가는가

**이 육안 확인 없이 통과를 주장하지 않는다.** 확인 후 `slope_check.png`는 지운다.

- [ ] **Step 6: 커밋**

```bash
git add engine/flatness/outputs/slope_map.py engine/tests/test_slope_map.py
git commit -m "feat(engine): 구배 판정 지도 PNG(등급 색 + 내리막 화살표)"
```

---

### Task 5: 파이프라인과 CLI

**Files:**
- Modify: `engine/flatness/core/pipeline.py`
- Modify: `engine/flatness/cli.py`
- Test: `engine/tests/test_cli.py` (추가)

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces:
  - `analyze_slope(path, scale_to_m, threshold, out_dir, subcell_m=0.05, cell_m=2.0, chunk_size=2_000_000, drain_points=None) -> dict`
    (인자 순서를 `analyze_floor(path, scale_to_m, criterion, u_mm, out_dir, ...)`와 맞춘다)
  - CLI `flatness analyze-slope <파일> --criteria <json> --out <디렉터리> [--units m|cm|mm] [--drain X,Y]`

**반드시 지킬 기존 관례 - 단위 자동 확정 금지.** `cli.py` 첫 줄이 이렇게 못 박고 있다.

```
CLI - 단위 자동 확정 금지: --units 없으면 감지 결과를 보여주고 exit 2 (스펙 5.1.1)
```

`analyze-slope`도 같은 규칙을 따른다. `--units`가 없으면 `detect_units(info)` 결과를
출력하고 **exit 2**로 끝낸다. 기존 `analyze` 분기(`cli.py:86-91`)를 그대로 본떠라.

**참고로 구배 크기 자체는 축척에 무관하다.** 모든 좌표가 k배되면 z도 x도 함께 k배라
기울기 `dz/dx`는 그대로다. 하지만 **2m 격자 크기와 보정 높이차(mm)는 축척에 직접
영향받는다** - 단위를 틀리면 격자가 2m가 아니게 되고 보정값도 틀린다. 그러므로
관례를 우회할 이유가 없다.

**기존 파일에서 먼저 읽을 것:** `pipeline.py:21-25`의 `analyze_floor` 앞부분. 리더와
격자 생성은 아래 두 줄이 전부다.

```python
info = read_info(path, chunk_size=chunk_size)
grid = build_subcell_grid(iter_chunks(path, chunk_size=chunk_size), info, scale_to_m, subcell_m)
```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`engine/tests/test_cli.py` 맨 아래에 추가한다.

```python
def test_analyze_slope_cli_end_to_end(tmp_path):
    """합성 2% 경사면을 CLI로 돌려 산출물과 요약이 나오는지 본다."""
    import json
    from tests.fixtures.synthetic import flat_floor, write_binary_ply
    from flatness.cli import main

    ply = tmp_path / "slope.ply"
    write_binary_ply(flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.0)), str(ply))
    crit = tmp_path / "crit.json"
    crit.write_text(json.dumps(
        {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}),
        encoding="utf-8")
    out = tmp_path / "out"

    rc = main(["analyze-slope", str(ply), "--units", "m",
               "--criteria", str(crit), "--out", str(out)])
    assert rc == 0

    stats = json.loads((out / "slope_stats.json").read_text(encoding="utf-8"))
    assert abs(stats["summary"]["max_dev_pct"]) < 0.1
    assert stats["summary"]["counts"]["적합"] > 0
    assert (out / "slope_map.png").exists()
    assert (out / "slope_cells.csv").exists()


def test_analyze_slope_refuses_to_guess_units(tmp_path, capsys):
    """단위 자동 확정 금지(스펙 5.1.1). --units 없으면 후보만 보여주고 exit 2."""
    import json
    from tests.fixtures.synthetic import flat_floor, write_binary_ply
    from flatness.cli import main

    ply = tmp_path / "s.ply"
    write_binary_ply(flat_floor(size=(8.0, 8.0), spacing=0.05, tilt=(0.02, 0.0)), str(ply))
    crit = tmp_path / "c.json"
    crit.write_text(json.dumps(
        {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}),
        encoding="utf-8")

    rc = main(["analyze-slope", str(ply), "--criteria", str(crit),
               "--out", str(tmp_path / "o")])
    assert rc == 2
    assert "--units" in capsys.readouterr().out
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd engine && python -m pytest tests/test_cli.py -q -k slope`
Expected: FAIL. `analyze-slope` 서브커맨드가 없다.

- [ ] **Step 3: 파이프라인을 구현한다**

`engine/flatness/core/pipeline.py`에 추가한다. `analyze_floor`의 앞부분(리더 디스패치, 단위 스케일, 서브셀 격자 생성)을 그대로 재사용하되, 그 코드를 복사하지 말고 **기존 함수가 이미 나눠 둔 헬퍼가 있으면 그것을 쓴다.** 없으면 아래처럼 최소로 쓴다.

```python
def analyze_slope(path, scale_to_m, threshold, out_dir, subcell_m=0.05,
                  cell_m=2.0, chunk_size=2_000_000, drain_points=None):
    """점군 -> 2m 격자 구배 -> 판정 -> 산출물(csv/png/json).

    평활도(analyze_floor)와 같은 스캔을 쓰지만 집계 단위와 판정 철학이 다르다.
    평활도는 "평면에서 얼마나 벗어났나", 구배는 "설계한 경사대로인가"다.
    """
    import csv
    import json
    import os

    from flatness.core.slope import (compute_slope_cells, grade_slope_cells,
                                     slope_summary)
    from flatness.outputs.slope_map import render_slope_map

    os.makedirs(out_dir, exist_ok=True)
    info = read_info(path, chunk_size=chunk_size)
    grid = build_subcell_grid(iter_chunks(path, chunk_size=chunk_size),
                              info, scale_to_m, subcell_m)
    cells = compute_slope_cells(grid, cell_m=cell_m)
    graded = grade_slope_cells(cells, threshold, drain_points=drain_points,
                               cell_m=cell_m)
    summary = slope_summary(graded)

    csv_path = os.path.join(out_dir, "slope_cells.csv")
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["cx", "cy", "center_x_m", "center_y_m", "n_subcells",
                    "slope_pct", "downhill_deg", "dev_pct", "dir_err_deg",
                    "correction_mm", "rmse_mm", "se_pct", "grade", "reason"])
        for g in graded:
            c = g["cell"]
            w.writerow([c.cx, c.cy, round(c.center_x, 3), round(c.center_y, 3),
                        c.n_subcells, _r(c.slope_pct), _deg(c.downhill_rad),
                        _r(g["dev_pct"]), _r(g["dir_err_deg"]),
                        _r(g["correction_mm"]), _r(c.rmse_m * 1000 if c.ok else float("nan")),
                        _r(c.se_pct), g["grade"], g["reason"]])

    png_path = render_slope_map(graded, os.path.join(out_dir, "slope_map.png"),
                                cell_m=cell_m)
    stats = {"format": "slope-stats-v1", "cell_m": cell_m, "subcell_m": subcell_m,
             "threshold": threshold, "summary": summary,
             "artifacts": {"cells_csv": csv_path, "map_png": png_path}}
    stats_path = os.path.join(out_dir, "slope_stats.json")
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    return stats
```

`_r`과 `_deg`는 nan을 빈 문자열로 바꾸고 반올림하는 작은 헬퍼다. `pipeline.py`에 이미
같은 역할의 헬퍼가 있으면 그것을 쓰고, 없으면 아래를 파일 안에 추가한다.

```python
def _r(v, nd=3):
    return "" if v is None or (isinstance(v, float) and math.isnan(v)) else round(v, nd)


def _deg(rad):
    return "" if rad is None or math.isnan(rad) else round(math.degrees(rad), 1)
```

- [ ] **Step 4: CLI 서브커맨드를 등록한다**

`engine/flatness/cli.py`에서 기존 서브파서 등록부(`sub.add_parser(...)` 나열)를 찾아
같은 자리에 추가한다.

```python
    sl = sub.add_parser("analyze-slope", help="2m 격자 구배 산출·판정 (세부과업 4)")
    sl.add_argument("path", help="점군 파일(ply/las/laz/xyz/txt/csv/pts)")
    sl.add_argument("--units", choices=sorted(_SCALES),
                    help="좌표 단위. 없으면 감지 결과만 보여주고 exit 2 (자동 확정 금지)")
    sl.add_argument("--criteria", required=True,
                    help="설계기준 JSON: design_pct·pass_pct·re_pct·dir_pass_deg")
    sl.add_argument("--out", required=True, help="산출물 디렉터리")
    sl.add_argument("--cell", type=float, default=2.0, help="분석 격자 크기(m, 기본 2.0)")
    sl.add_argument("--drain", action="append", default=None,
                    help="배수구 위치 X,Y (여러 번 지정 가능). 없으면 방향 판정을 건너뛴다")
```

그리고 디스패치부에 분기를 더한다.

```python
    if args.cmd == "analyze-slope":
        # 단위 자동 확정 금지 - 기존 analyze 분기(cli.py:86-91)와 같은 규칙.
        # 구배 크기 자체는 축척에 무관하지만 2m 격자와 보정 높이차(mm)는 직접
        # 영향받으므로 관례를 우회할 이유가 없다.
        if args.units is None:
            info = read_info(args.path)
            print("좌표 단위를 확정할 수 없습니다. 감지 후보:")
            for g in detect_units(info):
                print(f"  --units {g.unit:2s} (scale={g.scale_to_m}) [{g.confidence}] {g.evidence}")
            print("위 후보 중 하나를 --units 로 명시해 다시 실행하세요.")
            return 2
        with open(args.criteria, encoding="utf-8") as f:
            threshold = json.load(f)
        drains = None
        if args.drain:
            drains = []
            for s in args.drain:
                sx, _, sy = s.partition(",")
                drains.append((float(sx), float(sy)))
        stats = analyze_slope(args.path, _SCALES[args.units], threshold, args.out,
                              cell_m=args.cell, drain_points=drains)
        s = stats["summary"]
        print(f"구배 분석 완료: 셀 {sum(s['counts'].values())}개, "
              f"판정 가능 {s['coverage_pct']:.1f}%, "
              f"평균 편차 {s['mean_dev_pct']:.3f}%p, 최대 {s['max_dev_pct']:.3f}%p")
        for k, v in s["counts"].items():
            if v:
                print(f"  {k}: {v}")
        return 0
```

- [ ] **Step 5: 통과를 확인한다**

Run: `cd engine && python -m pytest tests/test_cli.py -q -k slope`
Expected: 2 passed

- [ ] **Step 6: 실제 CLI를 손으로 돌려 출력을 본다**

```bash
cd engine && python -c "
from tests.fixtures.synthetic import flat_floor, write_binary_ply
write_binary_ply(flat_floor(size=(10.0,8.0), spacing=0.02, tilt=(0.02,0.0)), 'demo_slope.ply')" \
&& echo '{"design_pct":2.0,"pass_pct":0.5,"re_pct":1.5,"dir_pass_deg":30.0}' > demo_crit.json \
&& python -m flatness.cli analyze-slope demo_slope.ply --units m --criteria demo_crit.json --out demo_slope_out --drain=-5,4
```

출력에 "구배 분석 완료"와 등급별 개수가 뜨는지, `demo_slope_out/`에 파일 3개가
생겼는지 확인한다. 확인 후 `demo_slope.ply`·`demo_crit.json`·`demo_slope_out/`을 지운다.

- [ ] **Step 7: 전체 스위트를 돌린다**

Run: `cd engine && python -m pytest -q`
Expected: 163 passed (기준선 139 + 슬로프 19 + 지도 3 + CLI 2)

- [ ] **Step 8: 커밋**

```bash
git add engine/flatness/core/pipeline.py engine/flatness/cli.py engine/tests/test_cli.py
git commit -m "feat(engine): analyze-slope 파이프라인·CLI (세부과업 4 단계 B 완료)"
```

---

## 이 단계에서 하지 않는 것

- **DB·워커·대시보드 연동**: 단계 C 이후다. 이 단계는 엔진과 CLI로 끝난다
- **정합**: 단계 F
- **용도별 설계 구배 수치 조사**: 단계 C에서 기준 시드와 함께 근거를 조사한다.
  이 단계의 테스트는 임의값(2.0%)을 쓰되 그것이 기준값이 아니라 **테스트 픽스처**임을
  분명히 한다
- **실물 드론·로봇 데이터**: 합성으로 정량 검증하고, 실물은 확보되면 추가한다
- **구역(zone)별 통계**: 스펙 5.4와 과업지시서가 "구간별" 통계를 요구하지만, 이 단계는
  전체 통계까지만 낸다. 구역 분할은 `core/zones.py`의 레벨 검출·구역화를 태워야 하고
  그것은 평활도 파이프라인과 얽혀 있어 별도 태스크로 다루는 편이 안전하다.
  `slope_summary(graded)`의 시그니처에 나중에 `zone_of` 인자를 더하면 되도록
  반환 형태를 dict로 열어 두었다. **이 이연을 용역 결과 보고서에 기록할 것**

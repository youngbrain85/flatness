"""구배 산출 — 정답을 아는 합성 경사면으로 정량 검증한다."""
import math
import numpy as np

from flatness.core.slope import compute_slope_cells, grade_slope_cells, slope_summary
from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import CloudInfo
from tests.fixtures.synthetic import flat_floor


def _grid(pts, subcell_m=0.05):
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
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

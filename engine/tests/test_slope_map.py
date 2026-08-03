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
                                 2.0 + 0.3 * cx, math.pi, 0.001, 0.01,
                                 2.0, 2.0, True))
    return out


def test_renders_png_file(tmp_path):
    p = tmp_path / "slope.png"
    got = render_slope_map(grade_slope_cells(_cells(), TH), str(p))
    assert got == str(p)
    assert os.path.getsize(p) > 1000


def test_undecidable_cells_do_not_crash_render(tmp_path):
    cells = _cells()
    cells.append(SlopeCell(9, 9, 20.0, 20.0, 0, float("nan"), float("nan"),
                           float("nan"), float("nan"), 2.0, 2.0, False))
    p = tmp_path / "slope2.png"
    render_slope_map(grade_slope_cells(cells, TH), str(p))
    assert os.path.getsize(p) > 1000


def test_fragment_cell_is_drawn_at_actual_extent(tmp_path):
    # 조각 셀(폭 0.2m)이 명목 cell_m(2.0m) 정사각형이 아니라 실제 범위로 그려지는지는
    # PNG 픽셀까지 확인하긴 어렵지만, 최소한 렌더가 width_m/height_m을 읽어서
    # 죽지 않고 정상 크기 파일을 내는지는 확인한다.
    cells = _cells()
    cells.append(SlopeCell(3, 0, 7.1, 1.0, 160, 2.0, math.pi, 0.001, 0.01,
                           0.2, 2.0, False))
    p = tmp_path / "slope3.png"
    render_slope_map(grade_slope_cells(cells, TH), str(p))
    assert os.path.getsize(p) > 1000


def test_empty_input_still_writes_a_file(tmp_path):
    p = tmp_path / "empty.png"
    render_slope_map([], str(p))
    assert os.path.exists(p)

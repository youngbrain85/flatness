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

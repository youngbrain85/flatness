import numpy as np
from tests.fixtures.synthetic import flat_floor, add_bump
from flatness.outputs.preview3d import render_preview3d
from tests.test_subcell import _grid

def test_preview_files_created(tmp_path):
    pts = add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02), (2.0, 1.5), 0.3, -0.01)
    g = _grid(pts)
    res = g.median_z - np.nanmedian(g.median_z)
    names = render_preview3d(res, g, tmp_path, worst_xy=(2.0, 1.5))
    assert names == ["preview3d.png", "preview3d_zoom.png"]
    assert (tmp_path / "preview3d.png").stat().st_size > 5000
    assert (tmp_path / "preview3d_zoom.png").stat().st_size > 5000

def test_preview_without_worst(tmp_path):
    g = _grid(flat_floor(size=(2.0, 2.0), spacing=0.02))
    res = g.median_z - np.nanmedian(g.median_z)
    names = render_preview3d(res, g, tmp_path)
    assert names == ["preview3d.png"]

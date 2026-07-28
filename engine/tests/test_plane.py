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

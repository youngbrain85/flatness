import numpy as np
from tests.fixtures.synthetic import flat_floor, flat_wall
from flatness.io.reader import CloudInfo
from flatness.core.walls import build_column_grid, detect_wall_lines

def _cols(pts, bin_m=0.05):
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    return build_column_grid(iter([pts]), info, 1.0, bin_m=bin_m) , info

def test_flat_wall_fixture_geometry():
    w = flat_wall(length=4.0, height=2.4, spacing=0.05)
    assert abs(w[:, 0].max() - 4.0) < 0.06 and abs(w[:, 2].max() - 2.4) < 0.06
    assert np.allclose(w[:, 1], 0.0)
    wy = flat_wall(length=3.0, height=2.4, spacing=0.05, axis='y', y0=1.5)
    assert np.allclose(wy[:, 0], 1.5) and abs(wy[:, 1].max() - 3.0) < 0.06

def test_floor_only_no_walls():
    (grids), info = _cols(flat_floor(size=(4.0, 4.0), spacing=0.02))
    zmin2d, zmax2d, cnt2d, origin, shape = grids
    walls = detect_wall_lines(zmin2d, zmax2d, cnt2d, origin, 0.05)
    assert walls == []

def test_one_wall_detected():
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0)])
    (zmin2d, zmax2d, cnt2d, origin, shape), info = _cols(pts)
    walls = detect_wall_lines(zmin2d, zmax2d, cnt2d, origin, 0.05)
    assert len(walls) == 1
    w = walls[0]
    assert abs(abs(w.direction[0]) - 1.0) < 0.05      # x축 방향 벽
    assert (w.u_max - w.u_min) > 3.5                   # 길이 ≈ 4m
    assert (w.z_max - w.z_min) > 2.0                   # 높이 ≈ 2.4m

def test_two_perpendicular_walls():
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0),
                     flat_wall(length=3.0, height=2.4, spacing=0.02, axis='y', y0=0.0)])
    (zmin2d, zmax2d, cnt2d, origin, shape), info = _cols(pts)
    walls = detect_wall_lines(zmin2d, zmax2d, cnt2d, origin, 0.05)
    assert len(walls) == 2

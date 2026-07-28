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

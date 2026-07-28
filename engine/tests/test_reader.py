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

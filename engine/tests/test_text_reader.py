import numpy as np
from flatness.io.reader import iter_chunks

def _collect(path):
    return np.vstack(list(iter_chunks(path, chunk_size=7)))

def test_xyz_space_separated(tmp_path):
    (tmp_path / "a.xyz").write_text("0 0 0\n1 0 0.01\n0 1 -0.02\n", encoding="utf-8")
    got = _collect(tmp_path / "a.xyz")
    assert np.allclose(got, [[0, 0, 0], [1, 0, 0.01], [0, 1, -0.02]])

def test_csv_with_header(tmp_path):
    (tmp_path / "a.csv").write_text("x,y,z\n0,0,0\n1.5,2.5,0.003\n", encoding="utf-8")
    got = _collect(tmp_path / "a.csv")
    assert got.shape == (2, 3) and abs(got[1, 2] - 0.003) < 1e-12

def test_pts_count_line_skipped(tmp_path):
    # PTS: 첫 줄 점 개수, 이후 x y z [intensity r g b]
    (tmp_path / "a.pts").write_text("2\n0 0 0 100 255 0 0\n1 1 0.01 100 0 255 0\n", encoding="utf-8")
    got = _collect(tmp_path / "a.pts")
    assert got.shape == (2, 3) and abs(got[1, 2] - 0.01) < 1e-12

def test_blank_and_comment_lines_skipped(tmp_path):
    (tmp_path / "a.txt").write_text("# header\n\n0 0 0\nnot a number line\n1 1 1\n", encoding="utf-8")
    got = _collect(tmp_path / "a.txt")
    assert got.shape == (2, 3)

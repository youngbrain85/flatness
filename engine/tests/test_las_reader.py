"""LAS/LAZ 리더 테스트."""
import numpy as np
from tests.fixtures.synthetic import flat_floor, write_las
from flatness.io.las_reader import read_las_chunks


def test_las_roundtrip(tmp_path):
    """LAS 파일 쓰기·읽기 라운드트립 — 스케일·오프셋 보존."""
    pts = flat_floor(size=(1.0, 1.0), spacing=0.1)
    write_las(pts, tmp_path / "a.las")
    got = np.vstack(list(read_las_chunks(tmp_path / "a.las", chunk_size=13)))
    assert got.shape == (len(pts), 3)
    assert np.allclose(got, pts, atol=1e-3)  # 스케일 0.0001 양자화 허용

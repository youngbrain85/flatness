"""PLY 쓰기 테스트 — 병합 산출물 저장(스펙 §6.3)."""
import numpy as np
import pytest

from flatness.io.ply_writer import write_ply


def test_write_ply_roundtrips_through_the_production_reader(tmp_path):
    """쓴 것을 기존 리더가 그대로 읽는가. 별도 파서를 만들지 않는다."""
    from flatness.io.reader import read_info, iter_chunks
    pts = np.array([[1.5, -2.25, 0.125], [1000.0, 2000.0, 3.5]], dtype=np.float64)
    p = tmp_path / "m.ply"
    write_ply(pts, p)
    info = read_info(p)
    assert info.n_points == 2
    got = np.concatenate(list(iter_chunks(p)))
    assert np.abs(got - pts.astype(np.float32)).max() == 0.0


def test_write_ply_rejects_empty(tmp_path):
    with pytest.raises(ValueError, match="점이 없"):
        write_ply(np.zeros((0, 3)), tmp_path / "e.ply")

"""대좌표(georeferenced) 정밀도 — 즉시 float32 캐스트였다면 cm급 지터가 나는 시나리오."""
import numpy as np
from tests.fixtures.synthetic import flat_floor, write_las, write_ascii_ply
from flatness.io.reader import iter_chunks, read_info
from flatness.core.subcell import build_subcell_grid

def _utm(pts):
    out = pts.copy()
    out[:, 0] += 254_000.0   # UTM급 x
    out[:, 1] += 4_180_000.0  # UTM급 y
    out[:, 2] += 53.0         # 절대 표고
    return out

def test_utm_las_grid_flat(tmp_path):
    # LAS는 오프셋+정수 저장이라 파일 자체는 무손실 — 리더·비닝의 정밀도만 검증됨
    pts = _utm(flat_floor(size=(2.0, 2.0), spacing=0.02))
    write_las(pts, tmp_path / "utm.las")
    info = read_info(tmp_path / "utm.las")
    g = build_subcell_grid(iter_chunks(tmp_path / "utm.las"), info, 1.0)
    assert np.nanmax(np.abs(g.median_z)) < 5e-4  # 상대화 후 평탄 ≈ 0 (지터 없음)

def test_utm_ascii_ply_grid_flat(tmp_path):
    # ascii PLY는 십진 문자열이라 대좌표도 무손실
    pts = _utm(flat_floor(size=(2.0, 2.0), spacing=0.02))
    write_ascii_ply(pts, tmp_path / "utm.ply")
    info = read_info(tmp_path / "utm.ply")
    g = build_subcell_grid(iter_chunks(tmp_path / "utm.ply"), info, 1.0)
    assert np.nanmax(np.abs(g.median_z)) < 5e-4

def test_reader_returns_float64(tmp_path):
    pts = flat_floor(size=(1.0, 1.0), spacing=0.1)
    write_las(pts, tmp_path / "a.las")
    c = next(iter_chunks(tmp_path / "a.las"))
    assert c.dtype == np.float64

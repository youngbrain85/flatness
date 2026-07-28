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

def test_utm_tilted_binning_precision(tmp_path):
    # 경사 + UTM: X/Y 비닝이 float32였다면 y=4.18e6의 ulp(0.25m)로 비닝이 붕괴되어
    # 서브셀 중앙값이 오염 → 평면 제거 후 잔차가 5e-4를 초과했을 시나리오.
    # 검증: tilt=(0.02, 0.01)(리뷰 원안)은 옛 코드(git HEAD~1) 실측 잔차 4.74e-4로
    # 임계값 5e-4를 넘지 못해 판별력이 없었음 — grid-center 근사 잡음(고정값 tilt에
    # 비례해 증가)과 float32 비닝 오염이 이 크기에서 서로 상쇄되는 지점이었기 때문.
    # tilt=(0.03, 0.02)로 보정: 옛 코드 8.89e-4(FAIL) vs 새 코드 3.58e-4(PASS)로
    # 뚜렷하게 갈라짐 — 근거는 task-1-report.md 스크래치 증거 참조.
    from flatness.core.plane import fit_plane_ransac
    pts = _utm(flat_floor(size=(2.0, 2.0), spacing=0.02, tilt=(0.03, 0.02)))
    write_las(pts, tmp_path / "utm_tilt.las")
    info = read_info(tmp_path / "utm_tilt.las")
    g = build_subcell_grid(iter_chunks(tmp_path / "utm_tilt.las"), info, 1.0)
    ys, xs = np.nonzero(~np.isnan(g.median_z))
    cx = (xs + 0.5) * g.size_m
    cy = (ys + 0.5) * g.size_m
    a, b, c = fit_plane_ransac(cx, cy, g.median_z[ys, xs].astype(float))
    res = g.median_z[ys, xs] - (a * cx + b * cy + c)
    assert np.max(np.abs(res)) < 5e-4

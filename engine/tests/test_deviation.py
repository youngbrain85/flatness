"""정밀 편차맵 렌더러 — 풀링 정확성과 PNG 산출 검증 (판정 무관 보조 시각화).

계획: docs/superpowers/plans/2026-07-29-precision-deviation-heatmap.md
"""
import numpy as np

from flatness.outputs.deviation import (DEVIATION_RES_M, pool_nanmean,
                                        render_deviation_map)
from tests.fixtures.synthetic import add_bump, flat_floor
from tests.test_subcell import _grid


def _residuals(pts):
    """평면 제거 잔차의 축소판 — 기울기 없는 합성 바닥은 중앙값 차감이 곧 잔차다."""
    g = _grid(pts)
    return (g.median_z - np.nanmedian(g.median_z)).astype(np.float32), g


def test_pool_nanmean_averages_valid_cells_only():
    a = np.array([[1.0, np.nan, 2.0, 2.0],
                  [3.0, np.nan, 2.0, 2.0],
                  [np.nan, np.nan, 4.0, np.nan],
                  [np.nan, np.nan, np.nan, np.nan]], dtype=np.float32)
    p = pool_nanmean(a, 2)
    assert p.shape == (2, 2)
    assert p[0, 0] == 2.0            # (1+3)/2 — NaN 2칸은 분모에서 빠진다
    assert p[0, 1] == 2.0
    assert np.isnan(p[1, 0])         # 블록 전체 NaN -> NaN 유지(0으로 채우지 않는다)
    assert p[1, 1] == 4.0            # 유효 1칸이면 그 값 그대로


def test_pool_nanmean_pads_odd_shape_with_nan():
    a = np.arange(15, dtype=np.float64).reshape(3, 5)
    p = pool_nanmean(a, 2)
    assert p.shape == (2, 3)         # 3x5 -> 패딩 후 4x6 -> 2x3
    assert p[0, 0] == 3.0            # (0+1+5+6)/4
    assert p[1, 2] == 14.0           # 마지막 블록은 유효 1칸(14)뿐


def test_pool_nanmean_factor_one_is_identity():
    a = np.array([[1.0, np.nan]], dtype=np.float32)
    p = pool_nanmean(a, 1)
    assert p.shape == (1, 2) and p[0, 0] == 1.0 and np.isnan(p[0, 1])


def test_render_marks_defect_positions(tmp_path):
    # 8x6m 바닥에 12mm 함몰(2,2)·9mm 융기(6,4) — 편차맵이 두 결함을 잡아야 한다
    pts = add_bump(add_bump(flat_floor(size=(8.0, 6.0), spacing=0.02, noise_sd=0.0005),
                            (2.0, 2.0), 0.35, -0.012),
                   (6.0, 4.0), 0.4, 0.009)
    res, g = _residuals(pts)

    name = render_deviation_map(res, g, tmp_path / "deviation.png")

    assert name == "deviation.png"
    assert (tmp_path / "deviation.png").stat().st_size > 5000
    factor = int(round(DEVIATION_RES_M / g.size_m))
    assert factor == 2
    pooled_mm = pool_nanmean(res, factor) * 1000.0
    cell = g.size_m * factor
    iy, ix = np.unravel_index(np.nanargmin(pooled_mm), pooled_mm.shape)
    assert abs(g.origin[0] + (ix + 0.5) * cell - 2.0) < 0.2   # 함몰 위치
    assert abs(g.origin[1] + (iy + 0.5) * cell - 2.0) < 0.2
    iy2, ix2 = np.unravel_index(np.nanargmax(pooled_mm), pooled_mm.shape)
    assert abs(g.origin[0] + (ix2 + 0.5) * cell - 6.0) < 0.2  # 융기 위치
    assert abs(g.origin[1] + (iy2 + 0.5) * cell - 4.0) < 0.2
    assert np.isfinite(pooled_mm).mean() > 0.95               # 10cm는 거의 전부 채워진다


def test_render_returns_none_when_all_nan(tmp_path):
    _, g = _residuals(flat_floor(size=(2.0, 2.0), spacing=0.02))
    empty = np.full(g.shape, np.nan, dtype=np.float32)

    assert render_deviation_map(empty, g, tmp_path / "deviation.png") is None
    assert not (tmp_path / "deviation.png").exists()


def test_render_survives_perfectly_flat_surface(tmp_path):
    # 편차가 정확히 0이면 vmin==vmax로 정규화가 퇴화한다 — 하한을 두어 방어
    res, g = _residuals(flat_floor(size=(2.0, 2.0), spacing=0.02))

    assert render_deviation_map(res, g, tmp_path / "flat.png") == "flat.png"
    assert (tmp_path / "flat.png").stat().st_size > 1000


def test_render_accepts_wall_frame_labels(tmp_path):
    # 벽은 (u, v) 프레임이라 축 라벨·부호 문구가 다르다 — 인자로 갈아끼울 수 있어야 한다
    res, g = _residuals(add_bump(flat_floor(size=(4.0, 2.4), spacing=0.02),
                                 (2.0, 1.2), 0.3, -0.010))

    name = render_deviation_map(res, g, tmp_path / "deviation_wall1.png",
                                title="벽 1 정밀 편차맵 (10cm 해상도)",
                                xlabel="벽 길이 u (m)", ylabel="높이 v (m)",
                                cbar_label="편차 (mm), + 돌출 / - 함몰")

    assert name == "deviation_wall1.png"
    assert (tmp_path / "deviation_wall1.png").stat().st_size > 5000

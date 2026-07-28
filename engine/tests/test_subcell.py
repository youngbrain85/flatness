import numpy as np
from tests.fixtures.synthetic import flat_floor, add_step
from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import CloudInfo

def _grid(pts, scale=1.0, subcell=0.05):
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    chunks = iter([pts[:len(pts)//2].astype(np.float32), pts[len(pts)//2:].astype(np.float32)])
    return build_subcell_grid(chunks, info, scale_to_m=scale, subcell_m=subcell)

def test_flat_floor_medians_zero():
    g = _grid(flat_floor(size=(1.0, 1.0), spacing=0.01))
    valid = ~np.isnan(g.median_z)
    assert valid.sum() >= 20 * 20
    assert np.nanmax(np.abs(g.median_z)) < 1e-6

def test_median_robust_to_outliers():
    pts = flat_floor(size=(0.3, 0.3), spacing=0.01)
    pts[::50, 2] = 5.0  # 2% 스파이크 — 중앙값이면 영향 없어야 함
    g = _grid(pts)
    assert np.nanmax(np.abs(g.median_z)) < 1e-6

def test_step_visible_in_grid():
    pts = add_step(flat_floor(size=(1.0, 0.2), spacing=0.01), x_split=0.5, height=0.02)
    g = _grid(pts)
    xs = g.origin[0] + (np.arange(g.shape[1]) + 0.5) * g.size_m
    right = g.median_z[:, xs > 0.55]
    assert abs(np.nanmedian(right) - 0.02) < 1e-6

def test_mm_scale_applied():
    pts = flat_floor(size=(1.0, 0.2), spacing=0.01) * 1000.0  # mm 좌표
    g = _grid(pts, scale=0.001)
    assert abs((g.origin[0] + g.shape[1] * g.size_m) - 1.0) < 0.1  # m로 환산됨

def test_sparse_subcell_is_nan():
    # 점 3개 미만 서브셀은 신뢰 불가 → NaN (스펙 §5.1.4 신뢰도 마스크)
    pts = np.array([[0.01, 0.01, 0.5], [0.07, 0.01, 0.0], [0.08, 0.02, 0.0], [0.07, 0.03, 0.0]])
    g = _grid(pts, subcell=0.05)
    assert np.isnan(g.median_z[0, 0])       # 1점 서브셀 → NaN
    assert not np.isnan(g.median_z[0, 1])   # 3점 서브셀 → 유효

def test_bimodal_ghost_layer_flagged():
    # 같은 자리에 두 층(0mm/15mm)이 겹치면 쌍봉 → 유령층 플래그
    base = flat_floor(size=(0.3, 0.3), spacing=0.01)
    ghost = base.copy(); ghost[:, 2] += 0.015
    g = _grid(np.vstack([base, ghost]))
    assert g.bimodal[1, 1]                  # 내부 서브셀은 쌍봉 감지

def test_flat_floor_not_bimodal():
    g = _grid(flat_floor(size=(0.3, 0.3), spacing=0.01))
    assert not g.bimodal.any()

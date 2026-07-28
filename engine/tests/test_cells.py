import numpy as np
from tests.fixtures.synthetic import flat_floor, add_bump
from flatness.core.subcell import build_subcell_grid
from flatness.core.plane import fit_plane_ransac, residual_grid
from flatness.core.cells import evaluate_cells
from flatness.io.reader import CloudInfo

def _residuals(pts):
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    g = build_subcell_grid(iter([pts.astype(np.float32)]), info, 1.0)
    ys, xs = np.nonzero(~np.isnan(g.median_z))
    cx = g.origin[0] + (xs + 0.5) * g.size_m
    cy = g.origin[1] + (ys + 0.5) * g.size_m
    abc = fit_plane_ransac(cx, cy, g.median_z[ys, xs].astype(float))
    return residual_grid(g, abc), g

def test_flat_floor_all_cells_near_zero():
    r, g = _residuals(flat_floor(size=(6.0, 6.0), spacing=0.02))
    cells = [c for c in evaluate_cells(r, g, span_m=3.0) if c.value_mm is not None]
    assert len(cells) >= 25  # 6x6m → 최소 5x5개 유효 셀
    assert all(c.value_mm < 0.5 for c in cells)
    # 내부 셀은 온전한 스팬(그리드 경계 서브셀 1칸 손실 2.95m 허용), 모서리 셀은 축소 스팬
    assert sum(1 for c in cells if c.span_used_m >= 2.95) >= 16
    assert all(c.span_used_m >= 1.0 for c in cells)

def test_depression_detected_within_tolerance():
    # 함몰(음수 범프): 포락선 지지점이 주변 바닥 → 직선자 해석 정답 = 깊이 10mm 정확히
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.01)
    r, g = _residuals(pts)
    cells = [c for c in evaluate_cells(r, g, span_m=3.0) if c.value_mm is not None]
    worst = max(cells, key=lambda c: c.value_mm)
    assert 9.0 <= worst.value_mm <= 11.0        # 직선자 값 ±1mm (스펙 §10.1)
    assert abs(worst.worst_x - 2.0) < 1.0 and abs(worst.worst_y - 2.0) < 1.0  # 위치 1셀 이내

def test_bump_reads_hull_support_value():
    # 볼록(범프): 직선자가 정점에 얹히는 지지선 기하로 해석값 ≈ h×(1−r/S)×중앙값감쇠 ≈ 8.6mm
    # (결함 높이 10mm가 아님 — 실물 직선자도 동일하게 읽음. 2026-07-28 정정)
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, 0.01)
    r, g = _residuals(pts)
    cells = [c for c in evaluate_cells(r, g, span_m=3.0) if c.value_mm is not None]
    worst = max(cells, key=lambda c: c.value_mm)
    assert 7.6 <= worst.value_mm <= 9.6         # 해석값 8.6mm ± 1mm
    assert abs(worst.worst_x - 2.0) < 1.0 and abs(worst.worst_y - 2.0) < 1.0

def test_small_area_uses_reduced_span():
    # 2.4m 폭 — 3m 스팬 불가 → 축소 스팬(≥1m)으로 평가
    r, g = _residuals(flat_floor(size=(2.4, 2.4), spacing=0.02))
    cells = [c for c in evaluate_cells(r, g, span_m=3.0) if c.value_mm is not None]
    assert len(cells) >= 1
    assert all(1.0 <= c.span_used_m < 3.0 for c in cells)

def test_sparse_cell_is_na():
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    # (5,5) 부근 1m 셀의 점 대부분 제거 → 점유율 미달 → 판정 불가
    m = ~((pts[:, 0] > 4.55) & (pts[:, 1] > 4.55))
    r, g = _residuals(pts[m])
    cells = evaluate_cells(r, g, span_m=3.0)
    na = [c for c in cells if c.value_mm is None]
    assert any(c.center_x > 4.5 and c.center_y > 4.5 for c in na)

def test_zone_filter_blocks_cross_zone_leak():
    # 좌(구역1, 잔차 0)·우(구역2, 잔차 +50mm) 인접 — 필터 없으면 경계 셀이 50mm 오염
    res = np.zeros((60, 120), dtype=np.float32)
    res[:, 60:] = 0.05
    labels = np.ones((60, 120), dtype=np.int32)
    labels[:, 60:] = 2
    from flatness.core.subcell import SubcellGrid
    g = SubcellGrid(0.05, np.zeros(2), (60, 120),
                    res.copy(), np.full((60, 120), 9, np.int32), np.zeros((60, 120), bool))
    cells = evaluate_cells(res, g, span_m=3.0, zone_labels=labels)
    z1 = [c for c in cells if c.zone_id == 1 and c.value_mm is not None]
    assert len(z1) > 0
    assert all(c.value_mm < 0.5 for c in z1)  # 구역2의 +50mm가 새어들지 않음

def test_no_zone_cell_is_na():
    res = np.zeros((40, 40), dtype=np.float32)
    labels = np.zeros((40, 40), dtype=np.int32)  # 전부 미할당
    from flatness.core.subcell import SubcellGrid
    g = SubcellGrid(0.05, np.zeros(2), (40, 40),
                    res.copy(), np.full((40, 40), 9, np.int32), np.zeros((40, 40), bool))
    cells = evaluate_cells(res, g, span_m=3.0, zone_labels=labels)
    assert all(c.value_mm is None for c in cells)

def test_span1_diagonals_participate():
    # span=1m: 대각 풀 라인 L=14*0.0707=0.99m — 이산화 여유 없이는 전멸 (백로그 티켓 2)
    res = np.zeros((60, 60), dtype=np.float32)
    from flatness.core.subcell import SubcellGrid
    g = SubcellGrid(0.05, np.zeros(2), (60, 60),
                    res.copy(), np.full((60, 60), 9, np.int32), np.zeros((60, 60), bool))
    cells = evaluate_cells(res, g, span_m=1.0)
    valid = [c for c in cells if c.value_mm is not None]
    assert len(valid) == len(cells)  # 모든 셀 판정 가능
    assert all(c.span_used_m >= 0.9 for c in valid)

def test_span1_reduced_span_accepted_within_one_step():
    # 대각 스텝(0.0707) 한 칸 여유 규칙을 직접 검증
    from flatness.core.cells import _SQRT2
    step = 0.05 * _SQRT2
    L = 14 * step  # 0.9899...
    assert L < 1.0 and L + step >= 1.0  # 규칙: L + step >= min_span 이면 허용

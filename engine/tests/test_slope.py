"""구배 산출 — 정답을 아는 합성 경사면으로 정량 검증한다."""
import math
import numpy as np

from flatness.core.slope import compute_slope_cells
from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import CloudInfo
from tests.fixtures.synthetic import flat_floor


def _grid(pts, subcell_m=0.05):
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    return build_subcell_grid([pts], info, 1.0, subcell_m=subcell_m)


def test_uniform_2pct_slope_in_x():
    # tilt=(0.02, 0) -> z = 0.02x. 구배 2.0%, 내리막은 -x 방향(각 pi)
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.0))
    cells = [c for c in compute_slope_cells(_grid(pts)) if c.ok]
    assert len(cells) >= 9
    for c in cells:
        assert abs(c.slope_pct - 2.0) < 0.1          # 과업지시서 오차율 +-5% 이내
        assert abs(abs(c.downhill_rad) - math.pi) < 0.05


def test_diagonal_slope_magnitude_and_direction():
    # tilt=(0.02, 0.02) -> 크기 sqrt(2)*2% = 2.83%, 오르막 45도이므로 내리막 -135도
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.02))
    cells = [c for c in compute_slope_cells(_grid(pts)) if c.ok]
    assert cells
    for c in cells:
        assert abs(c.slope_pct - 2.0 * math.sqrt(2) * 100 / 100) < 0.15
        assert abs(c.downhill_rad - (-3 * math.pi / 4)) < 0.05


def test_flat_floor_has_near_zero_slope():
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02)
    cells = [c for c in compute_slope_cells(_grid(pts)) if c.ok]
    assert cells
    assert all(c.slope_pct < 0.05 for c in cells)


def test_noise_does_not_break_gate():
    # 노이즈 2mm에서도 오차율 +-5%(즉 2.0% 기준 0.1%p) 안에 들어와야 한다
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.0), noise_sd=0.002)
    cells = [c for c in compute_slope_cells(_grid(pts)) if c.ok]
    assert cells
    errs = [abs(c.slope_pct - 2.0) for c in cells]
    assert max(errs) < 0.1
    # 불확도가 산출되고 양수여야 한다
    assert all(c.se_pct > 0 for c in cells)


def test_sparse_cell_is_not_ok():
    # 점이 거의 없는 셀은 수치적으로 평면이 결정되지 않으므로 ok=False
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.0))
    cells = compute_slope_cells(_grid(pts), min_subcells=10_000)
    assert cells
    assert all(not c.ok for c in cells)


def test_cell_size_controls_cell_count():
    pts = flat_floor(size=(8.0, 8.0), spacing=0.02)
    four = [c for c in compute_slope_cells(_grid(pts), cell_m=4.0) if c.ok]
    two = [c for c in compute_slope_cells(_grid(pts), cell_m=2.0) if c.ok]
    assert len(two) > len(four)

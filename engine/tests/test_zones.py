import numpy as np
from tests.fixtures.synthetic import flat_floor
from flatness.core.levels import detect_levels
from flatness.core.zones import build_zones
from tests.test_subcell import _grid

def _two_rooms():
    # 방 A(x 0~4, z=0) + 0.4m 빈 틈 + 방 B(x 4.4~8.4, z=0.5)
    a = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b[:, 0] += 4.4
    b[:, 2] += 0.5
    return np.vstack([a, b])

def test_two_rooms_two_ok_zones():
    g = _grid(_two_rooms())
    zmap, res = build_zones(g, detect_levels(g.median_z))
    ok = [z for z in zmap.zones if z.status == "ok"]
    assert len(ok) == 2
    assert abs(ok[0].level_m - 0.0) < 0.03 and abs(ok[1].level_m - 0.5) < 0.03
    # 각 구역의 잔차는 평면 제거 후 ≈ 0, 틈은 NaN
    assert np.nanmax(np.abs(res)) < 5e-4
    assert (zmap.labels > 0).sum() > 0.9 * np.isfinite(g.median_z).sum()

def test_furniture_zone_excluded():
    # 3×3m 바닥 위 1.4×1.4m 상판(+0.7m) → furniture, 잔차 NaN
    floor = flat_floor(size=(3.0, 3.0), spacing=0.02)
    top = flat_floor(size=(1.4, 1.4), spacing=0.02)
    top[:, 0] += 0.8; top[:, 1] += 0.8; top[:, 2] += 0.7
    g = _grid(np.vstack([floor, top]))
    zmap, res = build_zones(g, detect_levels(g.median_z))
    stats = {z.status for z in zmap.zones}
    assert "furniture" in stats and "ok" in stats
    fz = next(z for z in zmap.zones if z.status == "furniture")
    assert np.isnan(res[zmap.labels == fz.zone_id]).all()

def test_ghost_subcells_masked():
    # 바닥 일부(1×1m)에 15mm 오프셋 이중층 → 해당 서브셀 잔차 NaN
    base = flat_floor(size=(3.0, 3.0), spacing=0.02)
    patch = flat_floor(size=(1.0, 1.0), spacing=0.02)
    patch[:, 0] += 1.0; patch[:, 1] += 1.0; patch[:, 2] += 0.015
    g = _grid(np.vstack([base, patch]))
    zmap, res = build_zones(g, detect_levels(g.median_z))
    ys, xs = np.nonzero(g.bimodal)
    assert len(ys) > 0 and np.isnan(res[ys, xs]).all()

def test_min_area_filters_specks():
    g = _grid(flat_floor(size=(2.0, 2.0), spacing=0.02))
    mz = g.median_z
    mz[0, 0] = 2.0  # 고립 서브셀 — 면적 미달로 구역이 되면 안 됨
    zmap, _ = build_zones(g, detect_levels(mz))
    assert all(z.area_m2 >= 1.0 for z in zmap.zones)

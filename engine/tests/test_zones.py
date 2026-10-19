import numpy as np
from tests.fixtures.synthetic import flat_floor
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
    zmap, res = build_zones(g)
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
    zmap, res = build_zones(g)
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
    zmap, res = build_zones(g)
    ys, xs = np.nonzero(g.bimodal)
    assert len(ys) > 0 and np.isnan(res[ys, xs]).all()

def test_min_area_filters_specks():
    g = _grid(flat_floor(size=(2.0, 2.0), spacing=0.02))
    mz = g.median_z
    mz[0, 0] = 2.0  # 고립 서브셀 — 면적 미달로 구역이 되면 안 됨
    zmap, _ = build_zones(g)
    assert all(z.area_m2 >= 1.0 for z in zmap.zones)

def test_sloped_slab_full_coverage():
    # 티켓 13: 2.5% 경사에서 고정 높이 밴드는 커버리지 45.8%로 붕괴했음(P1b 최종 리뷰 실측)
    g = _grid(flat_floor(size=(6.0, 6.0), spacing=0.02, tilt=(0.025, 0.0)))
    zmap, res = build_zones(g)
    ok = [z for z in zmap.zones if z.status == "ok"]
    assert len(ok) == 1
    n_valid = int(np.isfinite(g.median_z).sum())
    assert (zmap.labels > 0).sum() >= 0.95 * n_valid   # 평면 추종 성장으로 회복
    assert np.nanmax(np.abs(res)) < 5e-4               # 경사 제거 후 잔차 ≈ 0


# 구역 나누기 교체(2026-10-20 스펙 §1): 높이 봉우리 대신 이웃 서브셀 높이 연속성(1.5cm 이하)으로 면을 잇는다.
# 옛 방식은 16m 2.5%·3% 경사에서 구역 0개(분석 실패), 8m 3% 에서 구역 3개로 쪼개졌다(실측).
def test_large_steep_slope_is_one_zone():
    for slope in (0.025, 0.03):
        g = _grid(flat_floor(size=(16.0, 16.0), spacing=0.025, noise_sd=0.0005, tilt=(slope, 0.0), seed=1))
        zmap, res = build_zones(g)
        ok = [z for z in zmap.zones if z.status == "ok"]
        assert len(ok) == 1, (slope, [z.area_m2 for z in ok])
        assert (zmap.labels > 0).sum() >= 0.95 * int(np.isfinite(g.median_z).sum())
        assert np.nanmax(np.abs(res)) < 0.003      # 한 장의 평면이라 구역 평면 잔차는 잡음 수준


def _stepped(dz):
    # 4x3m 바닥 두 장을 x=4m 에서 맞붙이고 오른쪽을 dz 만큼 낮춘다
    a = flat_floor(size=(3.98, 3.0), spacing=0.02)
    b = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b[:, 0] += 4.02
    b[:, 2] -= dz
    return np.vstack([a, b])


def test_15cm_step_splits_two_zones():
    zmap, _ = build_zones(_grid(_stepped(0.15)))
    ok = sorted((z for z in zmap.zones if z.status == "ok"), key=lambda z: -z.level_m)
    assert len(ok) == 2
    assert abs(ok[0].level_m - ok[1].level_m - 0.15) < 0.01


def test_1cm_lip_stays_one_zone():
    # 1cm 턱은 단차가 아니라 결함이다: 한 면으로 이어져 판정·편차에 드러나야 한다
    zmap, _ = build_zones(_grid(_stepped(0.01)))
    assert len([z for z in zmap.zones if z.status == "ok"]) == 1


def test_line_shaped_fragment_is_not_a_zone():
    # 실제 시험판(2026-10-20): 가장자리 한 줄(7칸)이 판보다 2.5cm 낮아 따로 떨어졌고, 작은 시편 재시도(min_area 0)에서
    # 그 한 줄이 구역이 되어 평면을 맞추다 "평면 피팅 실패" 로 분석이 죽었다. 폭이 없는(일직선·3칸 미만) 덩어리는 면이 아니다
    board = flat_floor(size=(0.4, 0.33), spacing=0.005) + np.array([0.0, 0.07, 0.0])
    strip = flat_floor(size=(0.4, 0.03), spacing=0.005) + np.array([0.0, 0.0, 0.03])
    g = _grid(np.vstack([board, strip]))
    zmap, _ = build_zones(g, min_area_m2=0.0)
    assert [z.status for z in zmap.zones] == ["ok"]
    assert (zmap.labels[0] == 0).all()          # 0번 줄(가장자리 띠)은 구역이 아니다

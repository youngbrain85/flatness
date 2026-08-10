# -*- coding: utf-8 -*-
"""Task 3: 커버리지 격자(CoverageGrid) + 점 밀도 모델 테스트.

계획 문서 docs/superpowers/plans/2026-08-10-scan-coverage.md Task 3 Step 1 +
해석 대조(스펙 §7-1):
(a) 빈 방 TLS 1거치점 — 사거리 원∩방 면적과 관측 면적 오차 ≤2%
(b) spacing 은 거리에 단조 증가
(c) 같은 셀 재관측 시 최소 spacing 유지
(d) 장애물 추가 시 관측 면적이 절대 늘지 않는다 (+ 그림자 셀 미관측)
(e) 점 간격 공식 — 모바일 max(r·Δθ, v/f), TLS r·Δθ/cos(atan(r/h)) + cos 하한
(f) 부채꼴 기하 — FOV·사거리·헤딩 랩어라운드·차폐
(g) coverage_pct / uncovered_cells 집계 + observe 반환 계약
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402
import pytest  # noqa: E402

from scansim.config import ScanConfig  # noqa: E402
from scansim.coverage import CoverageGrid  # noqa: E402
from scansim.grid import OccupancyGrid  # noqa: E402

CELL = 50.0
ROOM_W = 10000.0  # 10m
ROOM_H = 7000.0  # 7m

# 실 outline: [외곽링, 구멍링...] — 닫는 점 없음 (lh26_dump.json 계약과 동일)
ROOM_OUTLINE = [[[0, 0], [ROOM_W, 0], [ROOM_W, ROOM_H], [0, ROOM_H]]]
# 중앙 2m x 1m 장애물 (셀 경계 정렬) — test_grid.py 와 동일
OBSTACLE_OUTLINE = [[[4000, 3000], [6000, 3000], [6000, 4000], [4000, 4000]]]


def empty_room():
    return OccupancyGrid.from_rings([ROOM_OUTLINE], [], CELL)


def room_with_obstacle():
    return OccupancyGrid.from_rings([ROOM_OUTLINE], [OBSTACLE_OUTLINE], CELL)


def tls_spacing(r_mm, cfg):
    """테스트 쪽 독립 재계산 (해석 대조): r·Δθ / max(cos(atan(r/h)), 0.05)."""
    cos_inc = math.cos(math.atan2(r_mm, cfg.tls_height_mm))
    return r_mm * math.radians(cfg.tls_angres_deg) / max(cos_inc, 0.05)


def spacing_at(cov, occ, x, y):
    ix, iy = occ.world_to_cell(x, y)
    return cov.spacing_mm[iy, ix]


# ── ScanConfig 확장: TLS 센서 높이 ───────────────────────────


class TestConfigTlsHeight:
    def test_tls_height_default_assumed_value(self):
        # 입사각 모델용 센서 높이 — 가정값 (장비 공표치 아님)
        assert ScanConfig().tls_height_mm == 1500.0


# ── (a) 해석 대조: 관측 면적 ─────────────────────────────────


class TestObserveStationAnalytic:
    def test_full_circle_area_within_2pct(self):
        # 사거리 원이 방 안에 완전히 들어가는 경우: 관측 면적 ≈ πr²
        occ = empty_room()
        cfg = ScanConfig(tls_range_mm=3000.0)
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(5000.0, 3500.0, cfg)
        observed_area = float(np.isfinite(cov.spacing_mm).sum()) * CELL * CELL
        analytic = math.pi * 3000.0 ** 2
        assert abs(observed_area - analytic) <= 0.02 * analytic

    def test_quarter_circle_at_corner_within_2pct(self):
        # 모서리 거치: 사거리 원 ∩ 방 = 사분원
        occ = empty_room()
        cfg = ScanConfig(tls_range_mm=3000.0)
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(0.0, 0.0, cfg)
        observed_area = float(np.isfinite(cov.spacing_mm).sum()) * CELL * CELL
        analytic = math.pi * 3000.0 ** 2 / 4.0
        assert abs(observed_area - analytic) <= 0.02 * analytic

    def test_whole_room_observed_when_range_covers_it(self):
        # 사거리(기본 10m) ≥ 중심-모서리 최대거리(6.1m) → 자유 셀 전부 관측
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(5000.0, 3500.0, cfg)
        assert int(np.isfinite(cov.spacing_mm).sum()) == int(occ.free.sum())


# ── (e) 점 간격 공식 ─────────────────────────────────────────


class TestSpacingModel:
    def test_tls_spacing_matches_formula_3_4_5(self):
        # r=2000, h=1500 → 빗변 2500, cos(입사각)=1500/2500=0.6 (3-4-5 삼각형)
        occ = empty_room()
        cfg = ScanConfig(tls_height_mm=1500.0)
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(5025.0, 3525.0, cfg)  # 셀 중심에 거치
        got = spacing_at(cov, occ, 7025.0, 3525.0)  # 같은 행, r=2000
        expected = 2000.0 * math.radians(cfg.tls_angres_deg) / 0.6
        assert got == pytest.approx(expected, rel=1e-6)

    def test_tls_cos_floor_clamped_at_low_grazing_angle(self):
        # h=100, r=4000 → cos=0.0250 < 0.05 → 하한 0.05 로 클램프
        occ = empty_room()
        cfg = ScanConfig(tls_height_mm=100.0, tls_range_mm=5000.0)
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(1025.0, 3525.0, cfg)
        got = spacing_at(cov, occ, 5025.0, 3525.0)  # r=4000
        expected = 4000.0 * math.radians(cfg.tls_angres_deg) / 0.05
        assert got == pytest.approx(expected, rel=1e-6)

    def test_tls_spacing_monotonic_with_distance(self):
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(525.0, 3525.0, cfg)
        values = [
            spacing_at(cov, occ, x, 3525.0)
            for x in np.arange(1025.0, 9526.0, 500.0)
        ]
        assert all(np.isfinite(values))
        assert all(b >= a for a, b in zip(values, values[1:]))
        assert values[-1] > values[0]

    def test_mobile_spacing_floor_is_speed_over_hz(self):
        # 근거리: r·Δθ(8.7mm) < v/f(30mm) → 바닥값 v/f
        occ = empty_room()
        cfg = ScanConfig(mobile_speed_mms=300.0, mobile_scan_hz=10.0,
                         mobile_angres_deg=0.5)
        cov = CoverageGrid(occ, cfg)
        cov.observe_fan(2025.0, 3525.0, 0.0, cfg)
        got = spacing_at(cov, occ, 3025.0, 3525.0)  # r=1000
        assert got == pytest.approx(300.0 / 10.0, rel=1e-9)

    def test_mobile_spacing_angular_term_beyond_floor(self):
        # 원거리: r·Δθ(33.2mm) > v/f(30mm) → 각해상도 항이 지배
        occ = empty_room()
        cfg = ScanConfig(mobile_speed_mms=300.0, mobile_scan_hz=10.0,
                         mobile_angres_deg=0.5, mobile_range_mm=4000.0)
        cov = CoverageGrid(occ, cfg)
        cov.observe_fan(2025.0, 3525.0, 0.0, cfg)
        got = spacing_at(cov, occ, 5825.0, 3525.0)  # r=3800
        assert got == pytest.approx(3800.0 * math.radians(0.5), rel=1e-9)


# ── (c) 재관측 시 최소값 유지 ────────────────────────────────


class TestMinAccumulate:
    def test_nearer_reobservation_takes_minimum(self):
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(1025.0, 3525.0, cfg)  # 거치 A: 대상까지 r=8000
        far_val = spacing_at(cov, occ, 9025.0, 3525.0)
        assert far_val == pytest.approx(tls_spacing(8000.0, cfg), rel=1e-6)
        cov.observe_station(8525.0, 3525.0, cfg)  # 거치 B: 대상까지 r=500
        near_val = spacing_at(cov, occ, 9025.0, 3525.0)
        assert near_val == pytest.approx(tls_spacing(500.0, cfg), rel=1e-6)
        assert near_val < far_val

    def test_farther_reobservation_does_not_worsen(self):
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(8525.0, 3525.0, cfg)  # 가까운 거치 먼저
        before = spacing_at(cov, occ, 9025.0, 3525.0)
        cov.observe_station(1025.0, 3525.0, cfg)  # 먼 거치 재관측
        after = spacing_at(cov, occ, 9025.0, 3525.0)
        assert after == before  # 최소값 유지 — 나빠지지 않는다


# ── (d) 차폐: 장애물은 관측을 늘리지 않는다 ──────────────────


class TestOcclusion:
    def test_obstacle_never_increases_observed_area(self):
        cfg = ScanConfig()
        cov_empty = CoverageGrid(empty_room(), cfg)
        cov_empty.observe_station(2025.0, 3525.0, cfg)
        n_empty = int(np.isfinite(cov_empty.spacing_mm).sum())
        cov_obst = CoverageGrid(room_with_obstacle(), cfg)
        cov_obst.observe_station(2025.0, 3525.0, cfg)
        n_obst = int(np.isfinite(cov_obst.spacing_mm).sum())
        assert n_obst <= n_empty

    def test_shadow_cell_unobserved_station(self):
        # 장애물(x 4000~6000, y 3000~4000) 바로 뒤 셀은 그림자
        occ = room_with_obstacle()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(2025.0, 3525.0, cfg)
        assert not np.isfinite(spacing_at(cov, occ, 7025.0, 3525.0))
        # 같은 위치라도 빈 방이면 관측된다 (레이캐스트가 실제로 작동)
        occ2 = empty_room()
        cov2 = CoverageGrid(occ2, cfg)
        cov2.observe_station(2025.0, 3525.0, cfg)
        assert np.isfinite(spacing_at(cov2, occ2, 7025.0, 3525.0))

    def test_shadow_cell_unobserved_fan(self):
        cfg = ScanConfig(mobile_range_mm=6000.0)
        occ = room_with_obstacle()
        cov = CoverageGrid(occ, cfg)
        cov.observe_fan(2025.0, 3525.0, 0.0, cfg)
        assert not np.isfinite(spacing_at(cov, occ, 6225.0, 3525.0))
        occ2 = empty_room()
        cov2 = CoverageGrid(occ2, cfg)
        cov2.observe_fan(2025.0, 3525.0, 0.0, cfg)
        assert np.isfinite(spacing_at(cov2, occ2, 6225.0, 3525.0))

    def test_station_inside_obstacle_observes_nothing(self):
        occ = room_with_obstacle()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        obs = cov.observe_station(5000.0, 3500.0, cfg)  # 장애물 한가운데
        assert not np.isfinite(obs).any()
        assert not np.isfinite(cov.spacing_mm).any()


# ── (f) 부채꼴 기하 ─────────────────────────────────────────


class TestFanGeometry:
    def test_forward_cell_observed(self):
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_fan(2025.0, 3525.0, 0.0, cfg)  # +x 방향
        assert np.isfinite(spacing_at(cov, occ, 3025.0, 3525.0))

    def test_off_axis_30deg_observed(self):
        occ = empty_room()
        cfg = ScanConfig()  # FOV 90° → 반각 45°
        cov = CoverageGrid(occ, cfg)
        cov.observe_fan(2025.0, 3525.0, 0.0, cfg)
        # 헤딩에서 약 30° 벗어난 셀 — 반각 45° 안
        assert np.isfinite(spacing_at(cov, occ, 2875.0, 4025.0))

    def test_behind_cell_unobserved(self):
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_fan(2025.0, 3525.0, 0.0, cfg)
        assert not np.isfinite(spacing_at(cov, occ, 1025.0, 3525.0))

    def test_perpendicular_cell_outside_fov(self):
        occ = empty_room()
        cfg = ScanConfig()  # FOV 90° → 반각 45° < 90°
        cov = CoverageGrid(occ, cfg)
        cov.observe_fan(2025.0, 3525.0, 0.0, cfg)
        assert not np.isfinite(spacing_at(cov, occ, 2025.0, 5025.0))

    def test_beyond_range_unobserved(self):
        occ = empty_room()
        cfg = ScanConfig(mobile_range_mm=4000.0)
        cov = CoverageGrid(occ, cfg)
        cov.observe_fan(2025.0, 3525.0, 0.0, cfg)
        assert not np.isfinite(spacing_at(cov, occ, 6725.0, 3525.0))  # r=4700

    def test_heading_wraparound(self):
        # 헤딩 170°, 대상 방위 약 -171° → 랩어라운드 각차 ≈19° < 반각 45°
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_fan(5025.0, 3525.0, 170.0, cfg)
        assert np.isfinite(spacing_at(cov, occ, 4025.0, 3375.0))


# ── (g) 집계 + observe 반환 계약 ─────────────────────────────


class TestAggregation:
    def test_fresh_grid_zero_coverage_all_uncovered(self):
        occ = empty_room()
        cov = CoverageGrid(occ, ScanConfig())
        assert cov.spacing_mm.shape == occ.shape
        assert not np.isfinite(cov.spacing_mm).any()
        assert cov.coverage_pct(1e9) == 0.0
        assert len(cov.uncovered_cells(1e9)) == int(occ.free.sum())

    def test_full_observation_100pct_with_loose_target(self):
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(5000.0, 3500.0, cfg)  # 사거리가 방 전체를 덮는다
        assert cov.coverage_pct(1e9) == pytest.approx(100.0)
        assert cov.uncovered_cells(1e9) == []

    def test_partial_coverage_between_0_and_100(self):
        # 목표 5mm: 중심 근처만 달성 (r≈3.4m 밖은 spacing>5) → 0 < pct < 100
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(5000.0, 3500.0, cfg)
        pct = cov.coverage_pct(cfg.density_targets_mm["tls"])
        assert 0.0 < pct < 100.0

    def test_uncovered_cells_consistent_with_pct(self):
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        cov.observe_station(5000.0, 3500.0, cfg)
        target = cfg.density_targets_mm["tls"]
        unc = cov.uncovered_cells(target)
        n_free = int(occ.free.sum())
        assert cov.coverage_pct(target) == pytest.approx(
            100.0 * (n_free - len(unc)) / n_free
        )
        arr = np.asarray(unc)  # (n, 2) = (ix, iy)
        assert occ.free[arr[:, 1], arr[:, 0]].all()  # 전부 자유 셀
        assert (cov.spacing_mm[arr[:, 1], arr[:, 0]] > target).all()

    def test_observe_returns_this_call_spacing(self):
        # 반환값 = 이번 관측의 spacing 장 (inf=이번에 안 보임) — Task 5 set cover 용
        occ = empty_room()
        cfg = ScanConfig()
        cov = CoverageGrid(occ, cfg)
        obs1 = cov.observe_station(1025.0, 3525.0, cfg)
        assert obs1.shape == occ.shape
        assert np.array_equal(np.isfinite(obs1), np.isfinite(cov.spacing_mm))
        finite = np.isfinite(obs1)
        assert np.allclose(obs1[finite], cov.spacing_mm[finite])
        prev = cov.spacing_mm.copy()
        obs2 = cov.observe_station(8525.0, 3525.0, cfg)
        assert np.array_equal(cov.spacing_mm, np.minimum(prev, obs2))

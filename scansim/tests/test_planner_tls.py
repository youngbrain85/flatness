# -*- coding: utf-8 -*-
"""Task 5: TLS 플래너(plan_tls) 테스트.

계획 문서 docs/superpowers/plans/2026-08-10-scan-coverage.md Task 5 Step 1:
(a) 빈 정사각형 방(사거리 ≥ 대각): 탐욕 set cover 가 거치점 1개로 100%
(b) 거치점 추가 시 커버리지 단조 증가 — tradeoff 곡선 비감소
(c) 순회 경로(구간 A*)가 팽창 점유 셀을 피한다
(d) 2-opt 후 순회 길이 ≤ NN 길이 (교차 해소 단위 테스트 포함)
(e) L자 방(가려짐): 거치점 2개 이상
(f) 정직한 보고 — 잔여·상한 도달·탐욕 근사(ln n) 명시가 notes 에 드러난다
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
from scansim.planner_tls import (  # noqa: E402
    TlsPlan,
    nearest_neighbor_order,
    plan_tls,
    tour_length,
    two_opt,
)

CELL = 50.0

# 실 outline: [외곽링, 구멍링...] — 닫는 점 없음 (lh26_dump.json 계약과 동일)
#
# 빈 정사각형 방 4m×4m — 대각 5657mm ≤ 기본 사거리 10000mm.
# 기본 파라미터(Δθ=0.035°, h=1500)의 5mm 목표 유효 관측반경은 약 3.39m
# (r·Δθ·√(r²+h²)/h = 5 를 풀면 r ≈ 3390) — 방 중심부 후보에서 최원 셀
# (대각 반 + 후보 격자 오프셋 ≈ 3.11m)이 그 안이라 1거치점 100% 가 가능하다.
SQUARE_OUTLINE = [[[0, 0], [4000, 0], [4000, 4000], [0, 4000]]]

# 분단 방: 8m×4m + 중앙 칸막이(x 3500~4500, y 0~3000) — 위쪽 1m 통로만 연결.
# 한 거치점으로는 반대편이 차폐·사거리 밖이라 2개 이상이 필요하다.
WIDE_OUTLINE = [[[0, 0], [8000, 0], [8000, 4000], [0, 4000]]]
DIVIDER_OUTLINE = [[[3500, 0], [4500, 0], [4500, 3000], [3500, 3000]]]

# L자 방: 가로팔 8m×3m + 세로팔 3m×8m — 모서리 가려짐 + 팔 끝 거리 때문에
# 1거치점으로는 목표 커버가 불가능하다.
L_OUTLINE = [[[0, 0], [8000, 0], [8000, 3000], [3000, 3000],
              [3000, 8000], [0, 8000]]]


def fixture_cfg():
    """분단·L자 방 공용 설정 (가정값 조정).

    tls_range_mm=4000 — 기본 파라미터의 5mm 목표 유효 관측반경(≈3.39m)보다
    길어서 커버 집합은 기본 사거리(10m)와 동일하고, 관측 후보 bbox 만 줄여
    테스트 실행 시간을 줄인다.
    """
    return ScanConfig(tls_range_mm=4000.0)


def square_room():
    return OccupancyGrid.from_rings([SQUARE_OUTLINE], [], CELL)


def divided_room():
    return OccupancyGrid.from_rings([WIDE_OUTLINE], [DIVIDER_OUTLINE], CELL)


def l_room():
    return OccupancyGrid.from_rings([L_OUTLINE], [], CELL)


def polyline_len(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def replay_coverage(occ, cfg, stations):
    """거치점 목록을 독립 재관측해 커버리지를 재계산 (플래너 주장 검증)."""
    cov = CoverageGrid(occ, cfg)
    for (x, y) in stations:
        cov.observe_station(x, y, cfg)
    return cov


def assert_polyline_in_inflated_free(occ, cfg, pts):
    inf = occ.inflate(cfg.robot_radius_mm)
    for (x, y) in pts:
        ix, iy = inf.world_to_cell(x, y)
        assert inf.free[iy, ix], f"경유점 ({x},{y}) 가 팽창 점유 셀 위"
    for a, b in zip(pts, pts[1:]):
        assert inf.raycast(*a, *b), f"구간 {a}→{b} 가 팽창 점유 셀을 관통"


# 시나리오별 계획 캐시 — plan_tls 는 후보별 관측 계산 때문에 수 초 걸린다
_PLANS = {}


def get_plan(name):
    if name not in _PLANS:
        if name == "square":
            occ, cfg = square_room(), ScanConfig()  # 기본 사거리 10m ≥ 대각
            plan = plan_tls(occ, cfg)
        elif name == "divided":
            occ, cfg = divided_room(), fixture_cfg()
            plan = plan_tls(occ, cfg)
        elif name == "lshape":
            occ, cfg = l_room(), fixture_cfg()
            plan = plan_tls(occ, cfg)
        elif name == "divided_max1":
            occ, cfg = divided_room(), fixture_cfg()
            plan = plan_tls(occ, cfg, max_stations=1)
        else:
            raise KeyError(name)
        _PLANS[name] = (occ, cfg, plan)
    return _PLANS[name]


# ── (a) 빈 정사각형 방: 1거치점 100% ─────────────────────────


class TestEmptySquare:
    def test_single_station_full_coverage(self):
        occ, cfg, plan = get_plan("square")
        assert isinstance(plan, TlsPlan)
        assert len(plan.stations_mm) == 1
        assert plan.tradeoff == [(1, pytest.approx(100.0))]
        cov = replay_coverage(occ, cfg, plan.stations_mm)
        assert cov.coverage_pct(cfg.density_targets_mm["tls"]) == pytest.approx(100.0)

    def test_station_in_inflated_free(self):
        occ, cfg, plan = get_plan("square")
        inf = occ.inflate(cfg.robot_radius_mm)
        (x, y) = plan.stations_mm[0]
        ix, iy = inf.world_to_cell(x, y)
        assert inf.free[iy, ix]

    def test_single_station_trivial_tour(self):
        occ, cfg, plan = get_plan("square")
        assert plan.tour_order == [0]
        assert plan.tour_paths == []
        assert plan.travel_len_mm == 0.0
        # 이동 없음 → 총 시간 = 거치점 1개 dwell
        assert plan.est_time_s == pytest.approx(cfg.tls_dwell_s)

    def test_greedy_approximation_noted(self):
        # 스펙 §5: set cover 는 NP-hard, 탐욕 근사비 ln n — 산출물에 명시
        occ, cfg, plan = get_plan("square")
        assert any("ln n" in n for n in plan.notes)

    def test_coverage_note_present(self):
        occ, cfg, plan = get_plan("square")
        assert any("계획 커버리지" in n for n in plan.notes)

    def test_no_residual_note_when_full(self):
        occ, cfg, plan = get_plan("square")
        assert not any("잔여" in n for n in plan.notes)


# ── (b) tradeoff 곡선 비감소 ─────────────────────────────────


class TestTradeoff:
    @pytest.mark.parametrize("name", ["square", "divided", "lshape"])
    def test_monotone_nondecreasing(self, name):
        occ, cfg, plan = get_plan(name)
        ns = [t[0] for t in plan.tradeoff]
        pcts = [t[1] for t in plan.tradeoff]
        assert ns == list(range(1, len(plan.stations_mm) + 1))
        assert all(b >= a for a, b in zip(pcts, pcts[1:]))

    def test_final_pct_matches_replay(self):
        # 플래너가 주장하는 최종 커버리지 = 독립 재관측 결과 (주장 검증)
        occ, cfg, plan = get_plan("divided")
        cov = replay_coverage(occ, cfg, plan.stations_mm)
        pct = cov.coverage_pct(cfg.density_targets_mm["tls"])
        assert plan.tradeoff[-1][1] == pytest.approx(pct, abs=1e-9)


# ── (c) 순회 경로 장애물 회피 ────────────────────────────────


class TestTour:
    def test_needs_multiple_stations(self):
        occ, cfg, plan = get_plan("divided")
        assert len(plan.stations_mm) >= 2

    def test_tour_order_is_permutation(self):
        occ, cfg, plan = get_plan("divided")
        assert sorted(plan.tour_order) == list(range(len(plan.stations_mm)))

    def test_paths_connect_stations_in_order(self):
        occ, cfg, plan = get_plan("divided")
        assert len(plan.tour_paths) == len(plan.stations_mm) - 1
        for k, path in enumerate(plan.tour_paths):
            a = plan.stations_mm[plan.tour_order[k]]
            b = plan.stations_mm[plan.tour_order[k + 1]]
            assert path[0] == pytest.approx(a)
            assert path[-1] == pytest.approx(b)

    def test_paths_avoid_inflated_obstacles(self):
        occ, cfg, plan = get_plan("divided")
        for path in plan.tour_paths:
            assert_polyline_in_inflated_free(occ, cfg, path)

    def test_travel_len_and_time_consistent(self):
        occ, cfg, plan = get_plan("divided")
        total = sum(polyline_len(p) for p in plan.tour_paths)
        assert plan.travel_len_mm == pytest.approx(total, rel=1e-6)
        n = len(plan.stations_mm)
        assert plan.est_time_s == pytest.approx(
            plan.travel_len_mm / cfg.mobile_speed_mms + cfg.tls_dwell_s * n,
            rel=1e-6)

    def test_travel_not_worse_than_nn(self):
        # 계획의 순회(2-opt 개선 후)가 NN 순회보다 길지 않다 — 같은 A* 거리
        # 행렬을 독립 재계산해 대조한다
        occ, cfg, plan = get_plan("divided")
        inf = occ.inflate(cfg.robot_radius_mm)
        n = len(plan.stations_mm)
        dist = np.zeros((n, n))
        for i in range(n):
            for j in range(i + 1, n):
                route = inf.astar(plan.stations_mm[i], plan.stations_mm[j])
                assert route is not None
                dist[i, j] = dist[j, i] = polyline_len(route)
        nn = nearest_neighbor_order(dist)
        assert plan.travel_len_mm <= tour_length(nn, dist) + 1e-6


# ── (d) NN + 2-opt 단위 테스트 ───────────────────────────────


def euclid_matrix(pts):
    pts = np.asarray(pts, dtype=float)
    return np.hypot(pts[:, None, 0] - pts[None, :, 0],
                    pts[:, None, 1] - pts[None, :, 1])


class TestNnTwoOpt:
    def test_nn_order_is_permutation_from_start(self):
        dist = euclid_matrix([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
        order = nearest_neighbor_order(dist)
        assert order[0] == 0
        assert sorted(order) == [0, 1, 2, 3]

    def test_two_opt_uncrosses_square(self):
        # 정사각형 꼭짓점을 교차 순서로 방문 → 2-opt 가 교차를 풀어
        # 둘레 경로(개방, 3변 = 3000mm)로 줄인다 — 엄격 개선 케이스
        dist = euclid_matrix([(0, 0), (1000, 0), (1000, 1000), (0, 1000)])
        crossed = [0, 2, 1, 3]
        improved = two_opt(crossed, dist)
        assert tour_length(improved, dist) == pytest.approx(3000.0)
        assert tour_length(improved, dist) < tour_length(crossed, dist)

    @pytest.mark.parametrize("pts", [
        [(0, 0), (1000, 0), (1000, 1000), (0, 1000)],
        [(0, 0), (900, 100), (2000, 0), (2100, 1500), (300, 1400), (1200, 700)],
        [(0, 0), (500, 0), (1000, 0), (1500, 0), (250, 800)],
    ])
    def test_two_opt_never_worse_than_nn(self, pts):
        dist = euclid_matrix(pts)
        nn = nearest_neighbor_order(dist)
        improved = two_opt(nn, dist)
        assert sorted(improved) == sorted(nn)
        assert tour_length(improved, dist) <= tour_length(nn, dist) + 1e-9


# ── (e) L자 방: 가려짐 → 2개 이상 ────────────────────────────


class TestLShape:
    def test_occlusion_needs_multiple_stations(self):
        occ, cfg, plan = get_plan("lshape")
        assert len(plan.stations_mm) >= 2

    def test_stations_in_inflated_free(self):
        occ, cfg, plan = get_plan("lshape")
        inf = occ.inflate(cfg.robot_radius_mm)
        for (x, y) in plan.stations_mm:
            ix, iy = inf.world_to_cell(x, y)
            assert inf.free[iy, ix]

    def test_tour_paths_valid(self):
        occ, cfg, plan = get_plan("lshape")
        assert len(plan.tour_paths) == len(plan.stations_mm) - 1
        for path in plan.tour_paths:
            assert_polyline_in_inflated_free(occ, cfg, path)


# ── (f) 정직한 보고 ──────────────────────────────────────────


class TestHonestReporting:
    def test_max_stations_cap_reported(self):
        # 상한 1개로 강제 → 커버 미완이 잔여·상한 노트로 드러난다
        occ, cfg, plan = get_plan("divided_max1")
        assert len(plan.stations_mm) == 1
        assert len(plan.tradeoff) == 1
        assert plan.tradeoff[0][1] < 100.0
        assert any("잔여" in n for n in plan.notes)
        assert any("상한" in n for n in plan.notes)

    def test_residual_note_matches_replay(self):
        # 잔여 노트 유무 = 독립 재관측의 미커버 유무 (주장 검증)
        for name in ["square", "divided", "lshape"]:
            occ, cfg, plan = get_plan(name)
            cov = replay_coverage(occ, cfg, plan.stations_mm)
            n_unc = len(cov.uncovered_cells(cfg.density_targets_mm["tls"]))
            has_note = any("잔여" in n for n in plan.notes)
            assert has_note == (n_unc > 0), name

    def test_station_count_within_cap(self):
        for name in ["square", "divided", "lshape"]:
            occ, cfg, plan = get_plan(name)
            assert len(plan.stations_mm) <= 12

# -*- coding: utf-8 -*-
"""Task 6: 시간 스텝 시뮬레이터(simulate) + 상태 스트림 테스트.

계획 문서 docs/superpowers/plans/2026-08-10-scan-coverage.md Task 6 Step 1
불변식 (변이 실험 대상):
(a) 커버리지 곡선이 등급별로 시간에 단조 증가
(b) total_dist = 경유점 폴리라인 길이 ±1% (실제 단언은 rel 1e-6 — 더 강하게)
(c) total_time = 거리/속도 + 거치 dwell 합 ±1% (동일하게 rel 1e-6)
(d) CSV 행수 = 프레임 수 (+ 헤더 1행)
추가 검증:
(e) 모바일 스텝 관측이 simulate_polyline(Task 4) 모델과 일치 — 표본 위치가
    일치하는 단일 구간 조건에서 spacing 장 대조 (부동소수 경계 셀 여유 포함)
(f) TLS 스캔은 dwell 완료 프레임에 반영 — 완료 전 프레임 커버리지 0
    (미완 스캔을 커버로 접지 않는다)
(g) 플래너 주장(path_len·travel_len·est_time)과 시뮬레이션 결과 일치
(h) JSON 상태 스트림 필드: 위치·헤딩·이동 상태·모드·누적 거리·등급별 커버율
    (지시서 "로봇 위치·이동 상태·작업 수행 정보")
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402
import pytest  # noqa: E402

from scansim.config import ScanConfig  # noqa: E402
from scansim.coverage import CoverageGrid  # noqa: E402
from scansim.grid import OccupancyGrid  # noqa: E402
from scansim.planner_mobile import (  # noqa: E402
    MobilePlan,
    plan_mobile,
    simulate_polyline,
)
from scansim.planner_tls import TlsPlan, plan_tls  # noqa: E402
from scansim.simulate import SimResult, SimState, simulate  # noqa: E402

CELL = 50.0
# 실 outline: [외곽링, 구멍링...] — 닫는 점 없음 (lh26_dump.json 계약과 동일)
ROOM_10x7 = [[[0, 0], [10000, 0], [10000, 7000], [0, 7000]]]
ROOM_6x4 = [[[0, 0], [6000, 0], [6000, 4000], [0, 4000]]]
OBST_6x4 = [[[2000, 1500], [4000, 1500], [4000, 2500], [2000, 2500]]]
BIG_ROOM = [[[0, 0], [14000, 0], [14000, 10000], [0, 10000]]]
ROOM_4x3 = [[[0, 0], [4000, 0], [4000, 3000], [0, 3000]]]


def mobile_cfg():
    """v/f=15mm ≤ 목표 20mm, 사거리 축소로 실행 시간 절약 (test_planner_mobile 관례)."""
    return ScanConfig(mobile_speed_mms=150.0, mobile_range_mm=2500.0)


def tls_cfg():
    """dwell 을 스텝 10개(2s)로 줄여 프레임 수를 작게 유지. 사거리도 축소."""
    return ScanConfig(mobile_speed_mms=150.0, tls_range_mm=4000.0, tls_dwell_s=2.0)


def polyline_len(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


# 시나리오 캐시 — 플래너·시뮬레이션이 수 초 걸린다 (test_planner_* 관례)
_CACHE = {}


def get_sim(name):
    """시나리오별 (occ, cfg, plan, sim)."""
    if name not in _CACHE:
        if name == "mobile_obstacle":
            occ = OccupancyGrid.from_rings([ROOM_6x4], [OBST_6x4], CELL)
            cfg = mobile_cfg()
            plan = plan_mobile(occ, cfg)
        elif name == "tls_hand":
            # 손으로 만든 2거치점 계획 — TlsPlan 계약(tour_paths = n-1개)대로
            occ = OccupancyGrid.from_rings([ROOM_10x7], [], CELL)
            cfg = tls_cfg()
            plan = TlsPlan(
                stations_mm=[(1000.0, 1000.0), (5000.0, 1000.0)],
                tour_order=[0, 1],
                tour_paths=[[(1000.0, 1000.0), (5000.0, 1000.0)]],
                travel_len_mm=4000.0,
                est_time_s=4000.0 / 150.0 + 2 * 2.0,
            )
        elif name == "tls_planned":
            # 작은 방 — plan_tls 가 1거치점 100% 를 찾는 조건 (test_planner_tls 참조)
            occ = OccupancyGrid.from_rings([ROOM_4x3], [], CELL)
            cfg = tls_cfg()
            plan = plan_tls(occ, cfg)
        else:
            raise KeyError(name)
        mode = "mobile" if name.startswith("mobile") else "tls"
        _CACHE[name] = (occ, cfg, plan, simulate(occ, plan, cfg, mode))
    return _CACHE[name]


def assert_stream_invariants(sim):
    """모든 시뮬레이션이 지켜야 할 공통 불변식 (변이 대상)."""
    frames = sim.frames
    assert len(sim.curve) == len(frames)
    for f, (t, pct) in zip(frames, sim.curve):
        assert isinstance(f, SimState)
        assert f.t_s == t          # 곡선-프레임 동기: 같은 시각
        assert f.coverage == pct   # 같은 커버율
    for a, b in zip(frames, frames[1:]):
        assert b.t_s > a.t_s                      # 시간 강단조
        assert b.dist_mm >= a.dist_mm - 1e-9      # 거리 비감소
        # moving = 직전 스텝 이동 여부 — 거리 증가와 정확히 짝
        assert b.moving == (b.dist_mm > a.dist_mm + 1e-9)
    if frames:
        assert frames[0].t_s == 0.0
        assert frames[0].moving is False          # 첫 프레임은 아직 이동 전
        assert frames[-1].t_s == pytest.approx(sim.total_time_s, rel=1e-9)
        assert frames[-1].dist_mm == pytest.approx(
            sim.total_dist_mm, rel=1e-9, abs=1e-9)
        # 커버리지 곡선: 등급별 단조 증가 (불변식 a)
        for tier in frames[0].coverage:
            vals = [pct[tier] for _, pct in sim.curve]
            assert all(y >= x - 1e-9 for x, y in zip(vals, vals[1:])), \
                f"{tier} 곡선이 감소"


# ── 모바일: 불변식 + 플래너 일관성 ──────────────────────────


class TestMobileSim:
    def test_stream_invariants(self):
        occ, cfg, plan, sim = get_sim("mobile_obstacle")
        assert isinstance(sim, SimResult)
        assert sim.mode == "mobile"
        assert_stream_invariants(sim)

    def test_dist_matches_polyline(self):
        # 불변식 (b): total_dist = 경유점 폴리라인 길이
        occ, cfg, plan, sim = get_sim("mobile_obstacle")
        assert sim.total_dist_mm == pytest.approx(
            polyline_len(plan.waypoints_mm), rel=1e-6)

    def test_time_is_dist_over_speed(self):
        # 불변식 (c): 모바일은 dwell 이 없다 — 시간 = 거리/속도
        occ, cfg, plan, sim = get_sim("mobile_obstacle")
        assert sim.total_time_s == pytest.approx(
            sim.total_dist_mm / cfg.mobile_speed_mms, rel=1e-6)

    def test_matches_planner_claims(self):
        # (g) 플래너의 path_len·est_time 과 재주행 결과가 일치
        occ, cfg, plan, sim = get_sim("mobile_obstacle")
        assert sim.total_dist_mm == pytest.approx(plan.path_len_mm, rel=1e-6)
        assert sim.total_time_s == pytest.approx(plan.est_time_s, rel=1e-6)

    def test_coverage_tiers_present(self):
        occ, cfg, plan, sim = get_sim("mobile_obstacle")
        assert set(sim.frames[-1].coverage) == set(cfg.density_targets_mm)
        # 주행했으니 모바일 등급 커버리지가 0 을 넘는다
        assert sim.frames[-1].coverage["mobile"] > 0.0


class TestMobileMatchesPolylineModel:
    """(e) 시간 스텝 관측 = simulate_polyline 관측 (표본 위치 일치 조건).

    단일 구간 + 구간 길이가 스텝당 이동거리(150·0.2=30mm)의 정수배(200스텝)
    → 두 쪽의 표본 위치가 (부동소수 오차 이내로) 같다. 사거리·FOV 경계에
    정확히 걸린 셀은 1e-12mm 위치 차로 판정이 뒤집힐 수 있어 소수 셀의
    마스크 차이만 허용한다.
    """

    def test_single_segment_spacing_matches(self):
        occ = OccupancyGrid.from_rings([BIG_ROOM], [], CELL)
        cfg = ScanConfig(mobile_speed_mms=150.0, mobile_range_mm=3000.0)
        wps = [(2025.0, 5025.0), (8025.0, 5025.0)]
        plan = MobilePlan(waypoints_mm=list(wps), path_len_mm=6000.0,
                          est_time_s=6000.0 / 150.0)
        sim = simulate(occ, plan, cfg, "mobile")

        ref = CoverageGrid(occ, cfg)
        simulate_polyline(ref, wps, cfg)  # 기본 표본 간격 = 150·0.2 = 30mm

        sim_fin = np.isfinite(sim.cov.spacing_mm)
        ref_fin = np.isfinite(ref.spacing_mm)
        assert int((sim_fin ^ ref_fin).sum()) <= 8, "관측 마스크 불일치 과다"
        both = sim_fin & ref_fin
        assert np.allclose(sim.cov.spacing_mm[both], ref.spacing_mm[both],
                           rtol=1e-6)
        for tier, target in cfg.density_targets_mm.items():
            assert sim.frames[-1].coverage[tier] == pytest.approx(
                ref.coverage_pct(target), abs=0.05)


# ── TLS: 불변식 + dwell 모델 ────────────────────────────────


class TestTlsHandPlan:
    def test_stream_invariants(self):
        occ, cfg, plan, sim = get_sim("tls_hand")
        assert sim.mode == "tls"
        assert_stream_invariants(sim)

    def test_dist_and_time_invariants(self):
        # (b) total_dist = 순회 폴리라인 길이, (c) 시간 = 이동/속도 + dwell 합
        occ, cfg, plan, sim = get_sim("tls_hand")
        assert sim.total_dist_mm == pytest.approx(4000.0, rel=1e-6)
        expected_t = 4000.0 / cfg.mobile_speed_mms + 2 * cfg.tls_dwell_s
        assert sim.total_time_s == pytest.approx(expected_t, rel=1e-6)
        assert sim.total_time_s == pytest.approx(plan.est_time_s, rel=1e-6)

    def test_scan_lands_on_dwell_completion(self):
        # (f) 스캔 결과는 dwell 완료 프레임부터 — 완료 전에는 커버리지 0
        occ, cfg, plan, sim = get_sim("tls_hand")
        dwell = cfg.tls_dwell_s
        for f in sim.frames:
            if f.t_s < dwell - 1e-9:
                assert all(v == 0.0 for v in f.coverage.values()), \
                    f"t={f.t_s}: 스캔 완료 전인데 커버리지 > 0"
        at_dwell = next(f for f in sim.frames
                        if f.t_s == pytest.approx(dwell, rel=1e-9))
        assert at_dwell.coverage["mobile"] > 0.0
        assert at_dwell.coverage["tls"] > 0.0

    def test_final_coverage_matches_station_replay(self):
        # 최종 spacing 장 = 두 거치점 observe_station 재현과 완전 동일
        # (같은 좌표에서 같은 함수 호출 — 비트 단위 일치)
        occ, cfg, plan, sim = get_sim("tls_hand")
        ref = CoverageGrid(occ, cfg)
        for x, y in plan.stations_mm:
            ref.observe_station(x, y, cfg)
        assert np.array_equal(sim.cov.spacing_mm, ref.spacing_mm)
        for tier, target in cfg.density_targets_mm.items():
            assert sim.frames[-1].coverage[tier] == pytest.approx(
                ref.coverage_pct(target), abs=1e-9)

    def test_dwell_frames_are_stationary(self):
        occ, cfg, plan, sim = get_sim("tls_hand")
        station_xy = set()
        for f in sim.frames:
            if not f.moving and f.t_s > 0.0:
                station_xy.add((f.x, f.y))
        # 정지 프레임의 위치는 거치점 좌표뿐이다
        assert station_xy <= {tuple(p) for p in plan.stations_mm}


class TestTlsPlannedIntegration:
    def test_stream_invariants(self):
        occ, cfg, plan, sim = get_sim("tls_planned")
        assert_stream_invariants(sim)

    def test_matches_planner_claims(self):
        # (g) travel_len·est_time·tradeoff 최종 커버리지와 일치
        occ, cfg, plan, sim = get_sim("tls_planned")
        assert sim.total_dist_mm == pytest.approx(
            plan.travel_len_mm, rel=1e-6, abs=1e-6)
        assert sim.total_time_s == pytest.approx(plan.est_time_s, rel=1e-6)
        assert sim.frames[-1].coverage["tls"] == pytest.approx(
            plan.tradeoff[-1][1], abs=1e-6)


# ── 상태 스트림 산출물 (CSV·JSON) ───────────────────────────


class TestStateStreamFiles:
    def test_csv_rows_equal_frames(self, tmp_path):
        # 불변식 (d): CSV 행수 = 프레임 수 (+ 헤더 1행)
        occ, cfg, plan, sim = get_sim("tls_hand")
        out = tmp_path / "stream.csv"
        sim.to_csv(out)
        lines = out.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1 + len(sim.frames)
        header = lines[0].split(",")
        for col in ("t_s", "mode", "x_mm", "y_mm", "heading_deg",
                    "dist_mm", "moving", "cov_mobile_pct", "cov_tls_pct"):
            assert col in header, f"CSV 헤더에 {col} 없음"

    def test_json_state_stream_fields(self, tmp_path):
        # (h) 스텝별 위치·헤딩·이동 상태·누적 거리·커버율 + 모드
        occ, cfg, plan, sim = get_sim("tls_hand")
        out = tmp_path / "stream.json"
        sim.to_json(out)
        data = json.loads(out.read_text(encoding="utf-8"))
        assert data["mode"] == "tls"
        assert data["total_dist_mm"] == pytest.approx(sim.total_dist_mm)
        assert data["total_time_s"] == pytest.approx(sim.total_time_s)
        assert len(data["frames"]) == len(sim.frames)
        assert len(data["curve"]) == len(sim.curve)
        f0 = data["frames"][0]
        assert set(f0) == {"t_s", "x_mm", "y_mm", "heading_deg",
                           "dist_mm", "moving", "coverage_pct"}
        assert set(f0["coverage_pct"]) == set(cfg.density_targets_mm)
        # 마지막 프레임 커버율 = 곡선 마지막 값
        assert (data["frames"][-1]["coverage_pct"]
                == data["curve"][-1]["coverage_pct"])


# ── 경계 사례 ───────────────────────────────────────────────


class TestEdges:
    def test_unknown_mode_raises(self):
        occ = OccupancyGrid.from_rings([ROOM_4x3], [], CELL)
        cfg = tls_cfg()
        with pytest.raises(ValueError):
            simulate(occ, MobilePlan(), cfg, "walk")

    def test_empty_mobile_plan(self, tmp_path):
        occ = OccupancyGrid.from_rings([ROOM_4x3], [], CELL)
        cfg = mobile_cfg()
        sim = simulate(occ, MobilePlan(), cfg, "mobile")
        assert sim.frames == [] and sim.curve == []
        assert sim.total_dist_mm == 0.0 and sim.total_time_s == 0.0
        out = tmp_path / "empty.csv"
        sim.to_csv(out)  # 헤더만 — 행수 = 프레임 수(0) + 1
        lines = out.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1

    def test_empty_tls_plan(self):
        occ = OccupancyGrid.from_rings([ROOM_4x3], [], CELL)
        cfg = tls_cfg()
        sim = simulate(occ, TlsPlan(), cfg, "tls")
        assert sim.frames == []
        assert sim.total_dist_mm == 0.0 and sim.total_time_s == 0.0

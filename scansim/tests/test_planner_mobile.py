# -*- coding: utf-8 -*-
"""Task 4: 모바일 플래너(plan_mobile) 테스트.

계획 문서 docs/superpowers/plans/2026-08-10-scan-coverage.md Task 4 Step 1:
(a) 유효 스윕폭 공식 — 부채꼴 근거리 폭 기반 (각해상도·사거리·v/f 바닥·FOV 항)
(b) 빈 방 직선 1패스 스윕 면적 해석 대조: √2·R·L + (π/4)·R²
    (전방 부채꼴 반각 45° 를 선분 위로 쓸었을 때의 합집합 — 유도는 주석 참조)
(c) 경로가 팽창 점유 셀을 지나지 않는다 (빈 방·장애물 방·26형 전부)
(d) path_len ≥ 직선거리, path_len = 폴리라인 길이, est_time = 길이/속도
(e) 26형 연결 부분집합에서 목표(20mm) 커버리지 ≥90%
(f) 정직한 보고 — 달성 불가 목표(v/f 바닥)·도달 불가 분리 영역·잔여 미커버는
    notes 에 드러난다 (실패를 숨기는 쪽이 아니라 드러내는 쪽으로)
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
    effective_sweep_width,
    plan_mobile,
    simulate_polyline,
)

CELL = 50.0
FIXTURES = Path(__file__).resolve().parent / "fixtures"
DUMP_PATH = Path(__file__).resolve().parents[2] / "bim" / "tests" / "fixtures" / "lh26_dump.json"

# 실 outline: [외곽링, 구멍링...] — 닫는 점 없음 (lh26_dump.json 계약과 동일)
ROOM_OUTLINE = [[[0, 0], [10000, 0], [10000, 7000], [0, 7000]]]
BIG_ROOM_OUTLINE = [[[0, 0], [14000, 0], [14000, 10000], [0, 10000]]]
# 중앙 2m x 1m 장애물 (셀 경계 정렬) — test_grid/test_coverage 와 동일
OBSTACLE_OUTLINE = [[[4000, 3000], [6000, 3000], [6000, 4000], [4000, 4000]]]


def fixture_cfg():
    """26형·방 테스트 공용 설정 (가정값 조정).

    - mobile_speed_mms=150 → v/f = 15mm ≤ 목표 20mm (기본 300 이면 v/f=30 으로
      목표 자체가 달성 불가 — 그 경우는 정직 보고 테스트가 따로 다룬다)
    - mobile_range_mm=2500 → 목표 유효거리(20mm/Δθ ≈ 2292mm)를 그대로 두면서
      관측 bbox 를 줄여 테스트 실행 시간을 줄인다
    """
    return ScanConfig(mobile_speed_mms=150.0, mobile_range_mm=2500.0)


def empty_room():
    return OccupancyGrid.from_rings([ROOM_OUTLINE], [], CELL)


def room_with_obstacle():
    return OccupancyGrid.from_rings([ROOM_OUTLINE], [OBSTACLE_OUTLINE], CELL)


def load_lh26(room_names=None):
    """26형 픽스처 점유격자. room_names=None 이면 outline 있는 전 실.

    벽체공용은 벽 발자국(외곽-구멍 링)이라 주행·스캔 대상이 아니므로 제외.
    복도·실외기실은 덤프에 outline 이 없다(None) — 그대로 뺀다.
    """
    dump = json.loads(DUMP_PATH.read_text(encoding="utf-8"))
    spaces = {s["name"]: s for s in dump["spaces"] if s.get("outline")}
    if room_names is None:
        room_names = [n for n in spaces if n != "벽체공용"]
    furn = json.loads((FIXTURES / "furniture_lh26.json").read_text(encoding="utf-8"))
    return OccupancyGrid.from_rings(
        [spaces[n]["outline"] for n in room_names],
        [f["rings"] for f in furn["furniture"]],
        CELL,
    )


def polyline_len(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def replay_coverage(occ, cfg, waypoints):
    """계획 폴리라인을 재주행해 커버리지를 독립 재계산 (플래너 주장 검증)."""
    cov = CoverageGrid(occ, cfg)
    simulate_polyline(cov, waypoints, cfg)
    return cov


def assert_path_in_inflated_free(occ, cfg, waypoints):
    inf = occ.inflate(cfg.robot_radius_mm)
    for (x, y) in waypoints:
        ix, iy = inf.world_to_cell(x, y)
        assert inf.free[iy, ix], f"경유점 ({x},{y}) 가 팽창 점유 셀 위"
    for a, b in zip(waypoints, waypoints[1:]):
        assert inf.raycast(*a, *b), f"구간 {a}→{b} 가 팽창 점유 셀을 관통"


# 시나리오별 계획 캐시 — plan_mobile 은 내부 시뮬레이션 때문에 수 초 걸린다
_PLANS = {}


def get_plan(name):
    if name not in _PLANS:
        if name == "empty":
            occ, cfg = empty_room(), fixture_cfg()
        elif name == "empty_default_cfg":
            # hz 를 명시하는 이유: 이 픽스처가 고정하는 성질은 "목표 < v/f 바닥이면
            # 달성 불가를 보고한다"이지 기본값이 아니다. 기본 hz 는 자기일관(10mm ≤ 20mm)
            # 으로 바뀌었으므로, 달성 불가 조합(300/10 = 30mm > 20mm)을 직접 만든다.
            occ, cfg = empty_room(), ScanConfig(mobile_range_mm=2500.0, mobile_scan_hz=10.0)
        elif name == "obstacle":
            occ, cfg = room_with_obstacle(), fixture_cfg()
        elif name == "lh26_subset":
            # 팽창 후에도 하나의 주 성분으로 연결되는 실 묶음 (사전 확인됨)
            occ = load_lh26(["거실/침실", "주방/식당", "현관", "욕실"])
            cfg = fixture_cfg()
        elif name == "lh26_full":
            # 전 실 — 발코니·PD 는 팽창 자유공간에서 분리 성분 (문·단차 미모델)
            occ = load_lh26()
            cfg = fixture_cfg()
        else:
            raise KeyError(name)
        _PLANS[name] = (occ, cfg, plan_mobile(occ, cfg))
    return _PLANS[name]


# ── (a) 유효 스윕폭 공식 ─────────────────────────────────────


class TestEffectiveSweepWidth:
    def test_angular_resolution_limit(self):
        # r_eff = 목표/Δθ (사거리 여유) → 폭 = 2·r_eff·sin(FOV/2)
        cfg = ScanConfig(mobile_speed_mms=150.0, mobile_scan_hz=10.0,
                         mobile_angres_deg=0.5, mobile_range_mm=4000.0,
                         mobile_fov_deg=90.0)
        expected = 2.0 * (20.0 / math.radians(0.5)) * math.sin(math.radians(45.0))
        assert effective_sweep_width(cfg, 20.0) == pytest.approx(expected, rel=1e-9)

    def test_range_cap(self):
        # 사거리가 목표 유효거리보다 짧으면 사거리가 상한
        cfg = ScanConfig(mobile_speed_mms=150.0, mobile_range_mm=1000.0)
        expected = 2.0 * 1000.0 * math.sin(math.radians(45.0))
        assert effective_sweep_width(cfg, 20.0) == pytest.approx(expected, rel=1e-9)

    def test_vf_floor_raises_effective_target(self):
        # v/f = 30mm > 목표 20mm → 어떤 거리에서도 20mm 는 불가.
        # 실질 목표가 v/f 로 올라가 유효거리·폭이 그만큼 커진다.
        cfg = ScanConfig(mobile_speed_mms=300.0, mobile_scan_hz=10.0,
                         mobile_angres_deg=0.5, mobile_range_mm=4000.0)
        expected = 2.0 * (30.0 / math.radians(0.5)) * math.sin(math.radians(45.0))
        assert effective_sweep_width(cfg, 20.0) == pytest.approx(expected, rel=1e-9)

    def test_fov_term(self):
        # FOV 60° → 반각 30° — 측방 도달 폭이 sin(30°) 로 줄어든다
        cfg = ScanConfig(mobile_speed_mms=150.0, mobile_fov_deg=60.0,
                         mobile_range_mm=4000.0)
        expected = 2.0 * (20.0 / math.radians(0.5)) * math.sin(math.radians(30.0))
        assert effective_sweep_width(cfg, 20.0) == pytest.approx(expected, rel=1e-9)


# ── (b) 해석 대조: 직선 1패스 스윕 면적 ──────────────────────
#
# 전방 부채꼴(반각 45°, 사거리 R)을 x0→x1 (길이 L) 로 쓸었을 때 관측 합집합:
# 측거리 d 인 점이 보이려면 로봇 s 에서 전방거리 ≥ d (반각 45°) 이고
# 빗변 ≤ R, 즉 s ∈ [px−√(R²−d²), px−d]. 합집합의 x 구간은 [x0+d, x1+√(R²−d²)],
# 면적 = ∫_{−R/√2}^{R/√2} (L + √(R²−d²) − |d|) dd = √2·R·L + (π/4)·R².


class TestSweepAnalytic:
    def test_single_pass_swept_area_matches_analytic(self):
        R, L = 3000.0, 6000.0
        occ = OccupancyGrid.from_rings([BIG_ROOM_OUTLINE], [], CELL)
        cfg = ScanConfig(mobile_speed_mms=150.0, mobile_range_mm=R)
        cov = CoverageGrid(occ, cfg)
        # 경로 y=5025 (셀 중심 행), 표본 25mm — 스캘럽 오차 ≈ L·ds ≈ 0.5%
        simulate_polyline(cov, [(2025.0, 5025.0), (8025.0, 5025.0)], cfg,
                          sample_mm=25.0)
        observed_area = float(np.isfinite(cov.spacing_mm).sum()) * CELL * CELL
        analytic = math.sqrt(2.0) * R * L + math.pi * R * R / 4.0
        assert abs(observed_area - analytic) <= 0.02 * analytic

    def test_band_density_profile(self):
        # 측거리 d 인 점의 최소 관측거리 = d/sin(45°) = d·√2 (반각 45°)
        # → 최선 점간격 = max(d·√2·Δθ, v/f). 유효 반폭 1620mm 안은 목표 달성,
        #   밖(관측은 되는 R/√2 안)은 목표 초과 — 폭 공식의 기하를 그대로 검증.
        R = 3000.0
        occ = OccupancyGrid.from_rings([BIG_ROOM_OUTLINE], [], CELL)
        cfg = ScanConfig(mobile_speed_mms=150.0, mobile_range_mm=R)
        cov = CoverageGrid(occ, cfg)
        simulate_polyline(cov, [(2025.0, 5025.0), (8025.0, 5025.0)], cfg,
                          sample_mm=25.0)

        def spacing_at(x, y):
            ix, iy = occ.world_to_cell(x, y)
            return cov.spacing_mm[iy, ix]

        inside = spacing_at(5025.0, 6525.0)  # d=1500 < 1620 (유효 반폭)
        assert inside == pytest.approx(1500.0 * math.sqrt(2.0)
                                       * math.radians(0.5), rel=0.02)
        assert inside <= 20.0
        beyond = spacing_at(5025.0, 6775.0)  # 1620 < d=1750 < R/√2=2121
        assert np.isfinite(beyond)
        assert beyond > 20.0


# ── (c)(d) 빈 방 계획 ────────────────────────────────────────


class TestPlanEmptyRoom:
    def test_plan_shape_and_lengths(self):
        occ, cfg, plan = get_plan("empty")
        assert isinstance(plan, MobilePlan)
        assert len(plan.waypoints_mm) >= 2
        assert all(len(w) == 2 and all(np.isfinite(w)) for w in plan.waypoints_mm)
        assert plan.path_len_mm == pytest.approx(
            polyline_len(plan.waypoints_mm), rel=1e-6)
        straight = math.hypot(
            plan.waypoints_mm[-1][0] - plan.waypoints_mm[0][0],
            plan.waypoints_mm[-1][1] - plan.waypoints_mm[0][1])
        assert plan.path_len_mm >= straight
        assert plan.est_time_s == pytest.approx(
            plan.path_len_mm / cfg.mobile_speed_mms, rel=1e-6)

    def test_path_stays_in_inflated_free(self):
        occ, cfg, plan = get_plan("empty")
        assert_path_in_inflated_free(occ, cfg, plan.waypoints_mm)

    def test_full_coverage_at_target(self):
        # 빈 방은 전부 도달·관측 가능 — 보완 경유점까지 돌면 100% (실측).
        # 문턱 99.5: 보완 경유점 제거 변이(왕복 스윕만, 실측 98.8%)를 잡으면서
        # 미세한 이산화 변동만 허용한다.
        occ, cfg, plan = get_plan("empty")
        cov = replay_coverage(occ, cfg, plan.waypoints_mm)
        assert cov.coverage_pct(cfg.density_targets_mm["mobile"]) >= 99.5

    def test_infeasible_target_noted(self):
        # v/f = 300/10 = 30mm > 목표 20mm — 어떤 경로로도 달성 불가.
        # 조용히 접지 않고 notes 로 드러낸다. (픽스처가 hz=10 을 명시한다)
        occ, cfg, plan = get_plan("empty_default_cfg")
        assert any("달성 불가" in n for n in plan.notes)

    def test_feasible_target_not_flagged_infeasible(self):
        occ, cfg, plan = get_plan("empty")  # v/f = 15mm ≤ 20mm
        assert not any("달성 불가" in n for n in plan.notes)


# ── (c)(f) 장애물 방 계획 ────────────────────────────────────


class TestPlanObstacleRoom:
    def test_path_avoids_inflated_obstacle(self):
        occ, cfg, plan = get_plan("obstacle")
        assert_path_in_inflated_free(occ, cfg, plan.waypoints_mm)

    def test_shadow_repaired_or_reported(self):
        # 장애물 그림자는 보완 경유점으로 메꾸거나, 못 메꾸면 잔여로 보고
        occ, cfg, plan = get_plan("obstacle")
        cov = replay_coverage(occ, cfg, plan.waypoints_mm)
        pct = cov.coverage_pct(cfg.density_targets_mm["mobile"])
        has_residual_note = any("잔여" in n for n in plan.notes)
        assert pct >= 90.0 or has_residual_note

    def test_residual_note_matches_replay(self):
        # 플래너 내부 시뮬레이션과 독립 재주행은 같은 결정론적 계산 —
        # 잔여 노트 유무가 재계산 결과와 일치해야 한다 (주장 검증)
        occ, cfg, plan = get_plan("obstacle")
        cov = replay_coverage(occ, cfg, plan.waypoints_mm)
        n_unc = len(cov.uncovered_cells(cfg.density_targets_mm["mobile"]))
        has_residual_note = any("잔여" in n for n in plan.notes)
        assert has_residual_note == (n_unc > 0)


# ── (e)(f) 26형 픽스처 ───────────────────────────────────────


class TestPlanLh26:
    def test_connected_subset_coverage_ge_90(self):
        # 거실/침실·주방/식당·현관·욕실 = 팽창 후 단일 주 성분 →
        # 목표 20mm 커버리지 ≥90% 를 강하게 단언한다 (탈출구 없음)
        occ, cfg, plan = get_plan("lh26_subset")
        cov = replay_coverage(occ, cfg, plan.waypoints_mm)
        assert cov.coverage_pct(cfg.density_targets_mm["mobile"]) >= 90.0

    def test_connected_subset_path_valid(self):
        occ, cfg, plan = get_plan("lh26_subset")
        assert_path_in_inflated_free(occ, cfg, plan.waypoints_mm)

    def test_full_apartment_honest_reporting(self):
        # 전 실: 발코니·PD 는 분리 성분(문·단차 미모델) — 계획은 주 성분만 돌고,
        # 커버리지 ≥90% 이거나 잔여를 notes 에 정직하게 보고한다 (계획 문서 문구)
        occ, cfg, plan = get_plan("lh26_full")
        assert_path_in_inflated_free(occ, cfg, plan.waypoints_mm)
        cov = replay_coverage(occ, cfg, plan.waypoints_mm)
        pct = cov.coverage_pct(cfg.density_targets_mm["mobile"])
        assert pct >= 90.0 or any("잔여" in n for n in plan.notes)
        # 분리 영역은 도달 불가로 명시된다
        assert any("도달 불가" in n for n in plan.notes)


# ── 스윕 간격의 하중은 커버리지가 아니라 보완 개수다 ─────────────────────────
# 간격이 벌어져도 보완 루프가 구멍을 메워 최종 커버리지는 안 변한다 — 변이 실험에서
# SWEEP_SPACING_FACTOR 0.5→1.0 이 커버리지 단언을 전부 통과하며 실증됐다
# (보완 2개→22개, 경로 48.1m→64.3m). 그래서 커버리지가 아니라 보완 개수를 고정한다:
# 스윕이 일을 해야 하고, 보완은 장애물 그림자용이지 스윕 구멍 메우기용이 아니다.
def _repair_count(plan):
    import re
    for n in plan.notes:
        m = re.fullmatch(r"보완 경유점 (\d+)개", n)
        if m:
            return int(m.group(1))
    raise AssertionError(f"보완 경유점 노트가 없다: {plan.notes}")


def test_빈_방은_스윕만으로_거의_덮인다_보완은_소수():
    occ, cfg, plan = get_plan("empty")
    assert _repair_count(plan) <= 5, (
        f"빈 방인데 보완 경유점 {_repair_count(plan)}개 — 스윕 간격이 벌어졌다는 신호")


def test_보완_개수가_항상_보고된다():
    occ, cfg, plan = get_plan("obstacle")
    assert _repair_count(plan) >= 0  # 존재 자체를 고정 (없으면 _repair_count 가 raise)

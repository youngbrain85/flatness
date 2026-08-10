# -*- coding: utf-8 -*-
"""Task 7: 렌더러 (프레임 PNG · GIF · 커버리지 곡선 · 최종 지도) 테스트.

계획 문서 docs/superpowers/plans/2026-08-10-scan-coverage.md Task 7 Step 1:
(a) 프레임 수 = ceil(시뮬 프레임 총수 / every_n)
(b) GIF 파일 생성 + Pillow 재열기 시 프레임 수 일치
(c) PNG 각 파일 ≤ 2MB
(d) 곡선 마지막 값 = 시뮬레이션 최종 커버리지
추가 검증:
(e) 렌더 프레임의 커버리지 재현(replay) 최종 spacing 장이 시뮬레이션 누적과
    비트 단위 동일 — 그림이 그리는 상태가 곧 시뮬레이션 상태다 (모바일·TLS)
(f) 색 계약: 장애물=회색, 미커버=빨강 계열, 등급별 커버=초록 농도
    (목표가 촘촘한 등급일수록 진한 초록), GIF 프레임 크기 일정
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from PIL import Image  # noqa: E402

from scansim.config import ScanConfig  # noqa: E402
from scansim.grid import OccupancyGrid  # noqa: E402
from scansim.planner_mobile import MobilePlan  # noqa: E402
from scansim.planner_tls import TlsPlan  # noqa: E402
from scansim.render import (  # noqa: E402
    COL_OBSTACLE,
    COL_UNCOVERED,
    coverage_image,
    curve_series,
    render_curve,
    render_final_map,
    render_frames,
    render_gif,
    replay_coverage,
    tier_greens,
)
from scansim.simulate import simulate  # noqa: E402

CELL = 50.0
MAX_PNG_BYTES = 2 * 1024 * 1024  # 계획 Task 7: 각 PNG ≤ 2MB
# 실 outline: [외곽링, 구멍링...] — 닫는 점 없음 (lh26_dump.json 계약과 동일)
ROOM_4x3 = [[[0, 0], [4000, 0], [4000, 3000], [0, 3000]]]
OBST = [[[1500, 2000], [2500, 2000], [2500, 2500], [1500, 2500]]]

# 시나리오 캐시 — 시뮬레이션이 수 초 걸린다 (test_simulate 관례)
_CACHE = {}


def get_sim(name):
    """시나리오별 (occ, cfg, sim). 손으로 만든 짧은 계획 — 플래너 비용 회피."""
    if name not in _CACHE:
        occ = OccupancyGrid.from_rings([ROOM_4x3], [OBST], CELL)
        if name == "mobile":
            # v/f = 150/10 = 15mm ≤ 목표 20mm → mobile 등급 커버 존재.
            # 경로 1500mm / 스텝 30mm = 50스텝 + t=0 프레임 = 51 프레임.
            cfg = ScanConfig(mobile_speed_mms=150.0, mobile_range_mm=2000.0)
            plan = MobilePlan(
                waypoints_mm=[(1000.0, 1500.0), (2500.0, 1500.0)],
                path_len_mm=1500.0, est_time_s=1500.0 / 150.0)
            sim = simulate(occ, plan, cfg, "mobile")
        elif name == "tls":
            # 거치점 근방 spacing ≪ 5mm → tls 등급(진초록) 셀 존재
            cfg = ScanConfig(mobile_speed_mms=150.0, tls_range_mm=3000.0,
                             tls_dwell_s=2.0)
            plan = TlsPlan(
                stations_mm=[(1000.0, 1500.0), (3000.0, 1500.0)],
                tour_order=[0, 1],
                tour_paths=[[(1000.0, 1500.0), (3000.0, 1500.0)]],
                travel_len_mm=2000.0,
                est_time_s=2000.0 / 150.0 + 2 * 2.0)
            sim = simulate(occ, plan, cfg, "tls")
        else:
            raise KeyError(name)
        _CACHE[name] = (occ, cfg, sim)
    return _CACHE[name]


@pytest.fixture(scope="module")
def mobile_frames(tmp_path_factory):
    """모바일 시나리오 프레임 렌더 결과 — 여러 테스트가 공유 (렌더 비용 절약)."""
    occ, cfg, sim = get_sim("mobile")
    out_dir = tmp_path_factory.mktemp("frames_mobile")
    return render_frames(occ, sim, out_dir, every_n=5)


# ── (a) 프레임 수 = ceil(len/every_n) ───────────────────────


class TestRenderFrames:
    def test_frame_count_is_ceil(self, mobile_frames):
        occ, cfg, sim = get_sim("mobile")
        assert len(mobile_frames) == math.ceil(len(sim.frames) / 5)

    def test_frame_count_other_stride(self, tmp_path):
        # 짧은 경로(120mm → 4스텝 + 1 = 5프레임)로 나눗셈 법칙만 검증
        occ, cfg, _ = get_sim("mobile")
        plan = MobilePlan(waypoints_mm=[(1000.0, 1500.0), (1120.0, 1500.0)],
                          path_len_mm=120.0, est_time_s=120.0 / 150.0)
        sim = simulate(occ, plan, cfg, "mobile")
        assert len(sim.frames) == 5
        paths = render_frames(occ, sim, tmp_path, every_n=2)
        assert len(paths) == 3  # ceil(5/2)

    def test_tls_frames_render(self, tmp_path):
        occ, cfg, sim = get_sim("tls")
        paths = render_frames(occ, sim, tmp_path, every_n=40)
        assert len(paths) == math.ceil(len(sim.frames) / 40)
        for p in paths:
            assert p.exists() and p.stat().st_size > 0

    def test_files_are_png_same_size(self, mobile_frames):
        # GIF 조립 전제: 전 프레임 픽셀 크기 동일
        assert mobile_frames, "렌더된 프레임 없음"
        sizes = set()
        for p in mobile_frames:
            assert p.suffix == ".png" and p.exists()
            with Image.open(p) as im:
                assert im.format == "PNG"
                sizes.add(im.size)
        assert len(sizes) == 1, f"프레임 크기 불일치: {sizes}"

    def test_png_size_under_2mb(self, mobile_frames):
        for p in mobile_frames:
            assert p.stat().st_size <= MAX_PNG_BYTES, f"{p.name} > 2MB"

    def test_empty_sim_renders_nothing(self, tmp_path):
        occ, cfg, _ = get_sim("mobile")
        sim = simulate(occ, MobilePlan(), cfg, "mobile")
        assert render_frames(occ, sim, tmp_path) == []

    def test_bad_every_n_raises(self, tmp_path):
        occ, cfg, sim = get_sim("mobile")
        with pytest.raises(ValueError):
            render_frames(occ, sim, tmp_path, every_n=0)


# ── (e) 재현 커버리지 = 시뮬레이션 누적 ─────────────────────


class TestReplayCoverage:
    def test_mobile_replay_bitwise_equal(self):
        occ, cfg, sim = get_sim("mobile")
        cov = replay_coverage(occ, sim)
        assert np.array_equal(cov.spacing_mm, sim.cov.spacing_mm)

    def test_tls_replay_bitwise_equal(self):
        # 스캔 완료 프레임(정지 블록 끝)에서만 observe_station — simulate 와 동일
        occ, cfg, sim = get_sim("tls")
        cov = replay_coverage(occ, sim)
        assert np.array_equal(cov.spacing_mm, sim.cov.spacing_mm)


# ── (b) GIF ─────────────────────────────────────────────────


class TestRenderGif:
    def test_gif_frame_count_matches(self, mobile_frames, tmp_path):
        out = tmp_path / "scan.gif"
        result = render_gif(mobile_frames, out, fps=10)
        assert result == out and out.exists()
        with Image.open(out) as im:
            assert im.format == "GIF"
            assert im.n_frames == len(mobile_frames)
            assert int(im.info["duration"]) == 100  # 1000/fps

    def test_gif_empty_frames_raises(self, tmp_path):
        with pytest.raises(ValueError):
            render_gif([], tmp_path / "empty.gif")


# ── (d) 곡선 ────────────────────────────────────────────────


class TestRenderCurve:
    def test_last_value_matches_final_coverage(self):
        # 그림이 쓰는 데이터(curve_series)의 마지막 값 = 최종 프레임 커버율
        occ, cfg, sim = get_sim("mobile")
        series = curve_series(sim)
        assert set(series) == set(cfg.density_targets_mm)
        for tier, (ts, pcts) in series.items():
            assert len(ts) == len(sim.frames)
            assert ts[-1] == pytest.approx(sim.total_time_s, rel=1e-9)
            assert pcts[-1] == pytest.approx(sim.frames[-1].coverage[tier],
                                             abs=1e-12)

    def test_curve_png_created(self, tmp_path):
        occ, cfg, sim = get_sim("mobile")
        out = tmp_path / "curve.png"
        assert render_curve(sim, out) == out
        assert out.exists() and 0 < out.stat().st_size <= MAX_PNG_BYTES


# ── 최종 지도 + (f) 색 계약 ─────────────────────────────────


class TestFinalMap:
    def test_final_map_png_created(self, tmp_path):
        occ, cfg, sim = get_sim("mobile")
        out = tmp_path / "final_map.png"
        assert render_final_map(occ, sim.cov, out) == out
        assert out.exists() and 0 < out.stat().st_size <= MAX_PNG_BYTES

    def test_tier_greens_dark_for_tight_target(self):
        greens = tier_greens({"mobile": 20.0, "tls": 5.0})
        # 목표가 촘촘한 tls 가 더 진한 초록 (밝기 합이 작다)
        assert sum(greens["tls"]) < sum(greens["mobile"])

    def test_color_contract_mobile(self):
        occ, cfg, sim = get_sim("mobile")
        img = coverage_image(occ, sim.cov)
        assert img.shape == (*occ.shape, 3)
        sp = sim.cov.spacing_mm
        greens = tier_greens(cfg.density_targets_mm)
        # 장애물(비자유) 셀 = 회색
        iy, ix = np.nonzero(~occ.free)
        assert np.allclose(img[iy[0], ix[0]], COL_OBSTACLE)
        # 미관측 자유 셀 = 빨강 계열
        miss = occ.free & np.isinf(sp)
        assert miss.any(), "미커버 셀이 없어 색 검증 불가 — 시나리오 오류"
        iy, ix = np.nonzero(miss)
        assert np.allclose(img[iy[0], ix[0]], COL_UNCOVERED)
        # mobile 등급만 달성(5 < spacing ≤ 20) = mobile 초록
        mid = occ.free & (sp > 5.0) & (sp <= 20.0)
        assert mid.any()
        iy, ix = np.nonzero(mid)
        assert np.allclose(img[iy[0], ix[0]], greens["mobile"])

    def test_color_contract_tls_dark_green(self):
        occ, cfg, sim = get_sim("tls")
        img = coverage_image(occ, sim.cov)
        sp = sim.cov.spacing_mm
        greens = tier_greens(cfg.density_targets_mm)
        tight = occ.free & (sp <= 5.0)
        assert tight.any(), "tls 등급 달성 셀이 없어 색 검증 불가"
        iy, ix = np.nonzero(tight)
        assert np.allclose(img[iy[0], ix[0]], greens["tls"])

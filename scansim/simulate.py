# -*- coding: utf-8 -*-
"""시간 스텝 시뮬레이터 + 상태 스트림 (스펙 §6, 계획 Task 6).

계획된 경로(모바일 폴리라인 / TLS 거치 순회)를 시간 스텝(cfg.step_s)으로
재주행하며 커버리지를 누적하고, 스텝별 상태(위치·헤딩·이동 여부·누적
거리·등급별 커버율)를 기록한다. 이 상태 스트림(JSON)과 커버리지 시계열
(CSV)이 지시서의 모니터링 요구("로봇 위치·이동 상태·작업 수행 정보")를
채운다.

모델 (파라미터는 전부 ScanConfig 데이터 — 코드 매직넘버 금지):
- 등속 전진: 스텝당 이동 = mobile_speed_mms × step_s. 회전·가감속 미모형
  (플래너 est_time 과 같은 가정). 마지막 스텝은 잔여 거리만큼만 진행해
  총 시간 = 길이/속도 (+ dwell 합) 가 정확히 성립한다.
- 모바일: 매 스텝 위치에서 observe_fan, 헤딩 = 현재 구간 진행 방향.
  스텝당 이동거리 = simulate_polyline(Task 4)의 기본 표본 간격과 동일 —
  플래너 내부 시뮬과 재주행이 같은 관측 모델을 쓴다.
- TLS: 거치점 도착 시 dwell 동안 정지(moving=False). 스캔 결과는 dwell
  완료 프레임에 반영한다 — 스캔이 끝나야 데이터가 생기며, 미완 스캔을
  커버로 접지 않는다. 거치점 간 이동 속도는 별도 파라미터가 없어
  mobile_speed_mms 를 재사용한다 (가정 — Task 5 est_time 과 동일).
"""
from __future__ import annotations

import bisect
import csv
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

from scansim.config import ScanConfig
from scansim.coverage import CoverageGrid
from scansim.grid import OccupancyGrid

_EPS = 1e-9


@dataclass
class SimState:
    """스텝별 로봇 상태 한 장.

    moving = "직전 스텝에서 이동했는가" — 첫 프레임은 False, TLS dwell
    프레임도 False. coverage = 등급(tier)별 누적 커버율 % (등급 목록은
    cfg.density_targets_mm 의 키).
    """
    t_s: float
    x: float
    y: float
    heading_deg: float
    dist_mm: float
    moving: bool
    coverage: dict


@dataclass
class SimResult:
    """시뮬레이션 결과 + 상태 스트림 직렬화 (CSV·JSON)."""
    frames: list = field(default_factory=list)   # [SimState] 스텝당 1장
    curve: list = field(default_factory=list)    # [(t_s, {tier: pct})] 프레임당 1점
    total_dist_mm: float = 0.0
    total_time_s: float = 0.0
    mode: str = ""                               # "mobile" | "tls"
    cov: CoverageGrid | None = None              # 최종 누적 커버리지 (렌더러·검증용)

    def to_csv(self, path) -> Path:
        """커버리지 시계열 CSV — 헤더 1행 + 프레임당 1행."""
        path = Path(path)
        tiers = list(self.frames[0].coverage) if self.frames else []
        cols = (["t_s", "mode", "x_mm", "y_mm", "heading_deg", "dist_mm",
                 "moving"] + [f"cov_{t}_pct" for t in tiers])
        with path.open("w", encoding="utf-8", newline="") as fp:
            writer = csv.writer(fp)
            writer.writerow(cols)
            for f in self.frames:
                writer.writerow(
                    [f.t_s, self.mode, f.x, f.y, f.heading_deg, f.dist_mm,
                     int(f.moving)] + [f.coverage[t] for t in tiers])
        return path

    def to_json(self, path) -> Path:
        """상태 스트림 JSON — 스텝별 위치·헤딩·이동 상태·누적 거리·커버율."""
        data = {
            "mode": self.mode,
            "total_dist_mm": self.total_dist_mm,
            "total_time_s": self.total_time_s,
            "frames": [
                {"t_s": f.t_s, "x_mm": f.x, "y_mm": f.y,
                 "heading_deg": f.heading_deg, "dist_mm": f.dist_mm,
                 "moving": f.moving, "coverage_pct": dict(f.coverage)}
                for f in self.frames
            ],
            "curve": [{"t_s": t, "coverage_pct": dict(pct)}
                      for t, pct in self.curve],
        }
        path = Path(path)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1),
                        encoding="utf-8")
        return path


def simulate(occ: OccupancyGrid, plan, cfg: ScanConfig, mode: str) -> SimResult:
    """계획을 시간 스텝으로 재주행해 상태 스트림·커버리지 시계열을 만든다.

    mode="mobile": plan 은 MobilePlan — waypoints_mm 폴리라인을 등속 주행,
      스텝마다 observe_fan.
    mode="tls": plan 은 TlsPlan — 첫 거치점에서 시작해 dwell(정지+스캔) 후
      tour_paths 구간을 차례로 주행·거치 반복. 이동 중 관측 없음
      (TLS 는 정지 스캔 장비다).
    """
    if mode == "mobile":
        return _simulate_mobile(occ, plan, cfg)
    if mode == "tls":
        return _simulate_tls(occ, plan, cfg)
    raise ValueError(f"알 수 없는 모드: {mode!r} — 'mobile' 또는 'tls'")


# ── 내부 ────────────────────────────────────────────────────


class _Recorder:
    """프레임·곡선 기록기 — 프레임마다 등급별 커버율을 계산해 남긴다."""

    def __init__(self, occ: OccupancyGrid, cfg: ScanConfig):
        self.cov = CoverageGrid(occ, cfg)
        self.cfg = cfg
        self.frames: list = []
        self.curve: list = []

    def snap(self, t, x, y, heading, dist, moving):
        pct = {tier: self.cov.coverage_pct(target)
               for tier, target in self.cfg.density_targets_mm.items()}
        self.frames.append(SimState(t, x, y, heading, dist, moving, pct))
        self.curve.append((t, dict(pct)))


def _segments(pts):
    """0 길이 구간을 뺀 세그먼트 목록과 총 길이.

    세그먼트 = (cum0, cum1, x0, y0, ux, uy, heading_deg) —
    cum0/cum1 = 시작·끝 호길이, (ux, uy) = 단위 방향.
    """
    segs = []
    cum = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        seg_len = math.hypot(x1 - x0, y1 - y0)
        if seg_len <= _EPS:
            continue
        segs.append((cum, cum + seg_len, x0, y0,
                     (x1 - x0) / seg_len, (y1 - y0) / seg_len,
                     math.degrees(math.atan2(y1 - y0, x1 - x0))))
        cum += seg_len
    return segs, cum


def _walk(rec: _Recorder, cfg: ScanConfig, t0, dist0, pts, observe):
    """폴리라인을 등속 재주행하며 스텝마다 프레임을 남긴다.

    스텝당 이동 = mobile_speed_mms × step_s, 마지막 스텝은 잔여 거리만 —
    소요 시간이 정확히 길이/속도가 된다. observe=True 면 스텝 위치에서
    observe_fan (모바일 모드). 반환 (t_end, dist_end, 마지막 헤딩|None).
    """
    segs, total = _segments(pts)
    if not segs:
        return t0, dist0, None
    speed = cfg.mobile_speed_mms
    d_step = speed * cfg.step_s
    ends = [s[1] for s in segs]
    s = 0.0
    heading = segs[0][6]
    while s < total - _EPS:
        s = min(s + d_step, total)
        k = min(bisect.bisect_left(ends, s), len(segs) - 1)
        cum0, _cum1, x0, y0, ux, uy, heading = segs[k]
        ds = s - cum0
        x, y = x0 + ux * ds, y0 + uy * ds
        if observe:
            rec.cov.observe_fan(x, y, heading, cfg)
        rec.snap(t0 + s / speed, x, y, heading, dist0 + s, True)
    return t0 + total / speed, dist0 + total, heading


def _dwell(rec: _Recorder, cfg: ScanConfig, t0, x, y, heading, dist):
    """거치 체류: step_s 간격 정지 프레임, 스캔은 dwell 완료 프레임에 반영.

    dwell ≤ 0 (퇴화 설정)이면 즉시 스캔하고 같은 시각 프레임 1장을 남긴다.
    반환 = dwell 종료 시각.
    """
    dwell = float(cfg.tls_dwell_s)
    if dwell <= _EPS:
        rec.cov.observe_station(x, y, cfg)
        rec.snap(t0, x, y, heading, dist, False)
        return t0
    elapsed = 0.0
    while elapsed < dwell - _EPS:
        elapsed = min(elapsed + cfg.step_s, dwell)
        if elapsed >= dwell - _EPS:
            # 스캔 완료 — 이 프레임부터 관측 데이터가 존재한다
            rec.cov.observe_station(x, y, cfg)
        rec.snap(t0 + elapsed, x, y, heading, dist, False)
    return t0 + dwell


def _simulate_mobile(occ, plan, cfg) -> SimResult:
    rec = _Recorder(occ, cfg)
    pts = [(float(p[0]), float(p[1])) for p in plan.waypoints_mm]
    if not pts:
        return SimResult([], [], 0.0, 0.0, "mobile", rec.cov)
    segs, _total = _segments(pts)
    h0 = segs[0][6] if segs else 0.0
    # t=0 시작점 관측 — simulate_polyline 도 양 끝점을 포함한다 (Task 4)
    rec.cov.observe_fan(pts[0][0], pts[0][1], h0, cfg)
    rec.snap(0.0, pts[0][0], pts[0][1], h0, 0.0, False)
    t, dist, _ = _walk(rec, cfg, 0.0, 0.0, pts, observe=True)
    return SimResult(rec.frames, rec.curve, dist, t, "mobile", rec.cov)


def _simulate_tls(occ, plan, cfg) -> SimResult:
    rec = _Recorder(occ, cfg)
    stations = [(float(p[0]), float(p[1])) for p in plan.stations_mm]
    if not stations:
        return SimResult([], [], 0.0, 0.0, "tls", rec.cov)
    order = list(plan.tour_order) or [0]
    x, y = stations[order[0]]
    heading = 0.0  # 첫 거치점 도착 방향 정보 없음 — 0° (스캔은 전방위라 무관)
    rec.snap(0.0, x, y, heading, 0.0, False)
    t = _dwell(rec, cfg, 0.0, x, y, heading, 0.0)
    dist = 0.0
    for path in plan.tour_paths:
        pts = [(float(p[0]), float(p[1])) for p in path]
        t, dist, h = _walk(rec, cfg, t, dist, pts, observe=False)
        if h is not None:
            heading = h
        x, y = pts[-1]
        t = _dwell(rec, cfg, t, x, y, heading, dist)
    return SimResult(rec.frames, rec.curve, dist, t, "tls", rec.cov)

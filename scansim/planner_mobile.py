# -*- coding: utf-8 -*-
"""모바일 커버리지 플래너 (스펙 §4, 계획 Task 4).

팽창 자유공간 위에서 boustrophedon(왕복) 스윕 경로를 만들고, A* 로 구간을
잇고, 내부 시뮬레이션으로 커버리지를 누적한 뒤 잔여 미커버 군집에 보완
경유점을 greedy 방식으로 추가한다. 수렴하지 못한 잔여는 notes 로 정직하게
보고한다 — 미커버를 커버로 접지 않는다.

밀도 목표·장비 파라미터는 전부 ScanConfig 데이터다. 이 모듈의 상수는
알고리즘 모델 상수이며 각각 근거를 주석으로 남긴다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

from scansim.config import ScanConfig
from scansim.coverage import CoverageGrid
from scansim.grid import OccupancyGrid

# ── 모델 상수 (장비 파라미터 아님) ───────────────────────────

# 스윕 간격 = 유효 스윕폭 × 이 계수. 0.5 = 인접 패스 50% 중첩.
# 근거: 유효폭 경계에서는 점간격이 목표와 등호로 만나고, 전방 부채꼴이라
# 패스 시작부에 측방 쐐기(미관측 삼각형)가 남는다 — 반폭 간격이 셀 이산화와
# 시작 쐐기를 인접 패스로 흡수한다.
SWEEP_SPACING_FACTOR = 0.5

# 보완 경유점(시점) 탐색: 미커버 셀 주위 후보 방위 수와 거리 비율.
# 방위 16개 = 22.5° 간격 — 부채꼴 반각(기본 45°)보다 촘촘해 방향 누락이 없다.
_VIEW_DIRS = 16
# 후보 거리 = 유효 관측거리 × 비율 (먼 쪽부터 — 한 번에 더 넓게 보는 시점 선호)
_VIEW_OFFSET_FRACS = (0.7, 0.5, 0.3, 0.15)
# 유효 관측거리 여유율: 경계 r_eff 에서는 점간격이 목표와 등호로 만나므로
# 셀 이산화 오차를 흡수하도록 10% 안쪽을 노린다.
_VIEW_MARGIN = 0.9
# 미커버 군집당 시점 탐색을 시도할 표본 셀 수 — 전부 실패하면 군집을 관측
# 불가로 접고 잔여로 보고한다 (표본이라 과대 포기 가능성이 있음을 주석에 남김)
_CLUSTER_SAMPLES = 12

# 보완 경유점 추가 반복 상한 — 수렴하지 못하면 잔여를 정직하게 보고
DEFAULT_MAX_REPAIR = 60


@dataclass
class MobilePlan:
    """모바일 스캔 계획. notes 에 가정·잔여·도달 불가 영역을 정직하게 기록."""
    waypoints_mm: list = field(default_factory=list)  # [(x, y)] mm 폴리라인
    path_len_mm: float = 0.0
    est_time_s: float = 0.0
    notes: list = field(default_factory=list)


def effective_sweep_width(cfg: ScanConfig, target_mm: float) -> float:
    """한 직선 패스가 목표 점간격 이하로 커버하는 횡방향 폭(mm).

    근거 (부채꼴 근거리 폭):
    - 경로에서 횡거리 d 인 점이 전방 부채꼴(반각 α=FOV/2)에 들어오는 최소
      관측거리는 r_min = d/sin(α) — 방위각이 정확히 α 인 순간이다.
    - 점간격 모델 spacing = max(r·Δθ, v/f) 이 목표 이하이려면 r ≤ 실질목표/Δθ.
      v/f 바닥 밑으로는 어떤 거리에서도 못 내려가므로 실질목표 = max(목표, v/f).
    - 사거리 상한: r_eff ≤ mobile_range_mm.
    → 폭 = 2 · r_eff · sin(α)   (α 는 90° 클램프 — 후방은 보지 못한다)
    """
    vf = cfg.mobile_speed_mms / cfg.mobile_scan_hz
    target_eff = max(float(target_mm), vf)
    r_eff = min(cfg.mobile_range_mm,
                target_eff / math.radians(cfg.mobile_angres_deg))
    half_fov = math.radians(min(cfg.mobile_fov_deg / 2.0, 90.0))
    return 2.0 * r_eff * math.sin(half_fov)


def simulate_polyline(cov: CoverageGrid, waypoints, cfg: ScanConfig | None = None,
                      sample_mm: float | None = None) -> None:
    """폴리라인을 따라 표본 간격마다 observe_fan (헤딩 = 구간 진행 방향).

    sample_mm 기본값 = 주행속도 × 시간스텝 — Task 6 시뮬레이터의 스텝당
    이동거리와 같다. 각 구간의 양 끝점을 포함해 표본화한다 (구간 접점은
    두 헤딩으로 두 번 관측 — 최소 누적이라 무해).
    """
    cfg = cov.cfg if cfg is None else cfg
    if sample_mm is None:
        sample_mm = cfg.mobile_speed_mms * cfg.step_s
    sample_mm = max(float(sample_mm), 1e-6)
    for (x0, y0), (x1, y1) in zip(waypoints, waypoints[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg <= 0.0:
            continue
        heading = math.degrees(math.atan2(y1 - y0, x1 - x0))
        n = max(1, int(math.ceil(seg / sample_mm - 1e-9)))
        for i in range(n + 1):
            t = i / n
            cov.observe_fan(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, heading, cfg)


def plan_mobile(occ: OccupancyGrid, cfg: ScanConfig,
                max_repair: int = DEFAULT_MAX_REPAIR) -> MobilePlan:
    """모바일 커버리지 경로계획.

    1) 로봇 반경 팽창 자유공간의 최대 연결 성분 위에 왕복(boustrophedon)
       스윕 — 간격은 유효 스윕폭 × SWEEP_SPACING_FACTOR, 구간 연결은 A*.
    2) 내부 시뮬레이션(관측 표본 간격 = 시뮬레이터 스텝당 이동거리)으로
       커버리지 누적 후, 잔여 미커버 군집에 보완 경유점을 greedy 추가
       (최대 max_repair 회). 수렴하지 못한 잔여는 notes 로 보고.
    """
    notes: list = []
    target = float(cfg.density_targets_mm["mobile"])
    vf = cfg.mobile_speed_mms / cfg.mobile_scan_hz
    t_plan = max(target, vf)  # 계획용 실질 목표 — v/f 바닥 밑은 물리적으로 불가
    if vf > target:
        notes.append(
            f"목표 점간격 {target:g}mm 는 주행 점간격 하한 v/f={vf:g}mm 보다 "
            f"작아 달성 불가 — {t_plan:g}mm 기준으로 계획 (속도·스캔율 조정 필요)")

    width = effective_sweep_width(cfg, target)
    spacing = width * SWEEP_SPACING_FACTOR
    notes.append(f"유효 스윕폭 {width:.0f}mm · 스윕 간격 {spacing:.0f}mm "
                 f"(인접 패스 중첩 계수 {SWEEP_SPACING_FACTOR:g})")

    inf = occ.inflate(cfg.robot_radius_mm)
    labels, n_comp = ndimage.label(inf.free)
    if n_comp == 0:
        notes.append("팽창 자유공간이 없다 — 계획 불가")
        return MobilePlan([], 0.0, 0.0, notes)
    sizes = np.bincount(labels.ravel())[1:]
    main = int(np.argmax(sizes)) + 1
    if n_comp > 1:
        skipped_cells = int(sizes.sum() - sizes.max())
        notes.append(
            f"도달 불가 분리 영역 {n_comp - 1}개({skipped_cells}셀, 팽창 자유공간)"
            f" — 문·단차 미모델로 최대 성분만 계획")

    waypoints, skipped_runs = _serpentine(inf, labels, main, spacing)
    if skipped_runs:
        notes.append(f"연결 실패로 건너뛴 스윕 구간 {skipped_runs}개")

    cov = CoverageGrid(occ, cfg)
    simulate_polyline(cov, waypoints, cfg)
    n_before_repair = len(waypoints)
    _repair(occ, inf, labels, main, cov, cfg, t_plan, waypoints, max_repair)
    # 보완 개수를 항상 보고하는 이유: 스윕 간격이 벌어져도 보완 루프가 구멍을 메워
    # 최종 커버리지는 안 변한다 — 변이 실험에서 간격 2배가 커버리지 단언을 전부
    # 통과하며 실증됐다(보완 2개 → 22개, 경로 +33%). 즉 간격·겹침의 하중은
    # 커버리지가 아니라 이 숫자에 있고, 이것이 보이지 않으면 효율 회귀를 못 잡는다.
    notes.append(f"보완 경유점 {len(waypoints) - n_before_repair}개")

    pct = cov.coverage_pct(target)
    n_free = int(occ.free.sum())
    residual = cov.uncovered_cells(target)
    notes.append(f"계획 커버리지(목표 {target:g}mm): {pct:.1f}% "
                 f"(자유 {n_free}셀 중 {n_free - len(residual)}셀)")
    if residual:
        heads = ", ".join(
            "({:.0f},{:.0f})".format(*occ.cell_to_world(ix, iy))
            for ix, iy in residual[:5])
        notes.append(f"잔여 미커버 {len(residual)}셀 (목표 {target:g}mm) — "
                     f"대표 위치(mm): {heads}")

    path_len = sum(math.hypot(b[0] - a[0], b[1] - a[1])
                   for a, b in zip(waypoints, waypoints[1:]))
    # 등속 주행 가정 — 회전·가감속 미모형 (Task 6 시뮬레이터와 동일). 하한 추정.
    est_time = path_len / cfg.mobile_speed_mms
    return MobilePlan(waypoints, path_len, est_time, notes)


# ── 내부 ────────────────────────────────────────────────────


def _push(waypoints: list, p) -> None:
    """직전 경유점과 같은 점은 버리고 추가 (0 길이 구간 방지)."""
    q = (float(p[0]), float(p[1]))
    if not waypoints or math.hypot(q[0] - waypoints[-1][0],
                                   q[1] - waypoints[-1][1]) > 1e-9:
        waypoints.append(q)


def _runs(mask: np.ndarray):
    """1차원 bool 마스크의 연속 True 구간 [(시작, 끝)] (양 끝 포함)."""
    idx = np.nonzero(mask)[0]
    if idx.size == 0:
        return []
    breaks = np.nonzero(np.diff(idx) > 1)[0]
    starts = np.concatenate(([0], breaks + 1))
    ends = np.concatenate((breaks, [idx.size - 1]))
    return [(int(idx[s]), int(idx[e])) for s, e in zip(starts, ends)]


def _serpentine(inf: OccupancyGrid, labels: np.ndarray, main: int,
                spacing_mm: float):
    """최대 성분 위 왕복 스윕 경유점 생성. 반환 (waypoints, 건너뛴 구간 수)."""
    step = max(1, int(round(spacing_mm / inf.cell_mm)))
    comp_rows = np.nonzero((labels == main).any(axis=1))[0]
    iy0, iy1 = int(comp_rows.min()), int(comp_rows.max())
    row_range = list(range(iy0 + step // 2, iy1 + 1, step)) or [(iy0 + iy1) // 2]

    waypoints: list = []
    skipped = 0
    goright = True
    for iy in row_range:
        mask = labels[iy] == main
        if not mask.any():
            continue  # 오목한 성분 — 이 높이엔 셀이 없다
        runs = _runs(mask)
        if not goright:
            runs = [(b, a) for (a, b) in reversed(runs)]
        for a, b in runs:
            entry = inf.cell_to_world(a, iy)
            exit_ = inf.cell_to_world(b, iy)
            if waypoints:
                route = inf.astar(waypoints[-1], entry)
                if route is None:  # 같은 성분이라 없어야 정상 — 방어적 보고
                    skipped += 1
                    continue
                for p in route[1:]:
                    _push(waypoints, p)
            else:
                _push(waypoints, entry)
            _push(waypoints, exit_)
        goright = not goright
    return waypoints, skipped


def _find_viewpoint(occ: OccupancyGrid, inf: OccupancyGrid, labels: np.ndarray,
                    main: int, ix: int, iy: int, r_look: float,
                    look_len: float):
    """미커버 셀 (ix,iy) 를 목표 간격 이내로 관측할 시점 탐색.

    반환 (p, q) 또는 None. p = 접근점, q = p 에서 셀 방향으로 look_len 전진한
    점 — q 가 셀 중심을 잇는 시선 위에 있으므로 p→q 주행 표본이 셀을 정면
    (방위각 0°)으로 본다. 조건: p·q 가 주 성분 팽창 자유공간, p→셀 시선이
    원 격자에서 트여 있고, 거리 ≤ r_look (목표 점간격 보장).
    """
    cx, cy = occ.cell_to_world(ix, iy)
    ny, nx = inf.shape
    ox, oy = inf.origin_xy
    cell = inf.cell_mm
    min_off = look_len + cell  # q 가 셀 중심을 지나치지 않을 최소 접근 거리

    def comp_at(x, y):
        gx = (x - ox) / cell
        gy = (y - oy) / cell
        if not (0.0 <= gx < nx and 0.0 <= gy < ny):
            return 0  # 격자 밖 (world_to_cell 클램프에 기대지 않는다)
        return labels[int(gy), int(gx)]

    for frac in _VIEW_OFFSET_FRACS:
        off = r_look * frac
        if off < min_off:
            continue
        for k in range(_VIEW_DIRS):
            th = 2.0 * math.pi * k / _VIEW_DIRS
            px = cx + off * math.cos(th)
            py = cy + off * math.sin(th)
            if comp_at(px, py) != main:
                continue
            # q 는 p→셀 시선 위 (같은 직선) — 접근 헤딩이 셀을 정면으로 향한다
            qx = px - look_len * math.cos(th)
            qy = py - look_len * math.sin(th)
            if comp_at(qx, qy) != main:
                continue
            if not inf.raycast(px, py, qx, qy):
                continue
            if not occ.raycast(px, py, cx, cy):
                continue  # 원 격자 기준 시선 차폐 — 가구 뒤는 여기서 걸러진다
            return (px, py), (qx, qy)
    return None


def _repair(occ, inf, labels, main, cov, cfg, t_plan, waypoints, max_repair):
    """잔여 미커버 군집에 보완 경유점 greedy 추가 (waypoints·cov 에 누적).

    군집(연결 성분) 단위로 큰 것부터: 표본 셀 몇 개에서 시점을 찾고, 찾으면
    A* 로 이동해 셀을 정면으로 보는 접근 구간을 붙인 뒤 재시뮬레이션한다.
    표본 전부 실패한 군집은 관측 불가로 접는다 (표본이라 과대 포기 가능 —
    남은 잔여는 호출부가 notes 로 보고).
    """
    if not waypoints:
        return
    # 유효 관측거리: min(사거리, 실질목표/Δθ) × 여유율 — 이 안이면 spacing ≤ t_plan
    r_look = min(cfg.mobile_range_mm,
                 t_plan / math.radians(cfg.mobile_angres_deg)) * _VIEW_MARGIN
    look_len = 2.0 * occ.cell_mm  # 접근 구간 길이 — 헤딩 고정용 짧은 전진
    unrepairable = np.zeros(occ.shape, dtype=bool)

    for _ in range(int(max_repair)):
        miss = occ.free & ~(cov.spacing_mm <= t_plan) & ~unrepairable
        if not miss.any():
            return
        clusters, n_cl = ndimage.label(miss)
        order = np.argsort(np.bincount(clusters.ravel())[1:])[::-1]
        repaired = False
        for oi in order:
            cl = int(oi) + 1
            cells = np.argwhere(clusters == cl)  # (n, 2) = (iy, ix)
            picks = cells[np.linspace(0, len(cells) - 1,
                                      min(len(cells), _CLUSTER_SAMPLES)).astype(int)]
            found = None
            for ciy, cix in picks:
                found = _find_viewpoint(occ, inf, labels, main, int(cix),
                                        int(ciy), r_look, look_len)
                if found is not None:
                    break
            if found is None:
                unrepairable[clusters == cl] = True
                continue
            p, q = found
            route = inf.astar(waypoints[-1], p)
            if route is None:  # 주 성분끼리라 없어야 정상 — 방어적 포기
                unrepairable[clusters == cl] = True
                continue
            seg = [waypoints[-1]] + [tuple(map(float, r)) for r in route[1:]] + [q]
            simulate_polyline(cov, seg, cfg)
            for r in route[1:]:
                _push(waypoints, r)
            _push(waypoints, q)
            repaired = True
            break
        if not repaired:
            return  # 남은 군집 전부 관측 불가 — 잔여로 보고된다

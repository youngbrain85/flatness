# -*- coding: utf-8 -*-
"""TLS 거치점 플래너 (스펙 §5, 계획 Task 5).

두 단계 최적화:
1) 배치 — 팽창 자유공간 최대 성분의 격자 서브샘플 후보마다 관측 기여
   (목표 점간격 이하로 커버하는 셀 집합)를 계산하고, greedy set cover 로
   "목표 밀도 미달 셀"이 없어질 때까지 거치점을 추가한다. set cover 는
   NP-hard 이며 greedy 는 근사비 ln n 의 근사다 — 이 사실을 notes(산출물)에
   명시한다 (스펙 §5 요구).
2) 순회 — nearest neighbor(NN)으로 잇고 2-opt 로 개선한다. 거치점 간 거리와
   구간 경로는 팽창 격자 A* (모바일 플래너와 같은 격자·팽창 재사용).

커버 미완(잔여·상한 도달·관측 불가)은 notes 로 정직하게 보고한다 —
미커버를 커버로 접지 않는다. 밀도 목표·장비 파라미터는 전부 ScanConfig
데이터다. 이 모듈의 상수는 알고리즘 모델 상수이며 근거를 주석으로 남긴다.
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

# 거치 후보 서브샘플 간격 (계획 문서 Task 5: 0.5m).
# 근거: 기본 파라미터의 5mm 목표 유효 관측반경(≈3.4m)보다 훨씬 촘촘해
# 배치 해상도 손실이 작고, 후보 수를 자유 셀의 1/100 수준으로 줄인다.
CANDIDATE_SPACING_MM = 500.0

# 거치점 수 상한 기본값 (계획 문서 Task 5 시그니처) — 상한 도달로 커버가
# 미완이면 notes 로 정직하게 보고한다.
DEFAULT_MAX_STATIONS = 12


@dataclass
class TlsPlan:
    """TLS 스캔 계획. notes 에 근사·잔여·도달 불가 영역을 정직하게 기록."""
    stations_mm: list = field(default_factory=list)  # [(x, y)] greedy 선택 순서
    tour_order: list = field(default_factory=list)   # stations_mm 인덱스 방문 순서
    tour_paths: list = field(default_factory=list)   # 구간별 A* 폴리라인 (n-1개)
    travel_len_mm: float = 0.0
    est_time_s: float = 0.0
    tradeoff: list = field(default_factory=list)     # [(n_stations, coverage_pct)]
    notes: list = field(default_factory=list)


def nearest_neighbor_order(dist, start: int = 0) -> list:
    """nearest neighbor 순회 순서 (개방 경로). 동률은 낮은 인덱스 — 결정론."""
    n = len(dist)
    order = [start]
    remaining = set(range(n)) - {start}
    while remaining:
        cur = order[-1]
        nxt = min(remaining, key=lambda j: (dist[cur][j], j))
        order.append(nxt)
        remaining.remove(nxt)
    return order


def tour_length(order, dist) -> float:
    """방문 순서의 개방 경로 길이 (dist 행렬 기준)."""
    return float(sum(dist[a][b] for a, b in zip(order, order[1:])))


def two_opt(order, dist) -> list:
    """개방 경로 2-opt: 구간 반전이 길이를 줄이면 반복 적용, 수렴까지.

    구간 [i..j] 반전 시 제거·추가되는 변은 경계 (i-1,i)·(j,j+1) 뿐이다
    (개방 경로라 끝 경계가 없으면 해당 항 0). 개선이 있을 때만 반전하므로
    길이는 단조 감소 — 초기 순서(NN)보다 나빠질 수 없다.
    """
    order = list(order)
    n = len(order)
    improved = True
    while improved:
        improved = False
        for i in range(n - 1):
            for j in range(i + 1, n):
                if i == 0 and j == n - 1:
                    continue  # 전체 반전 — 개방 경로 길이 불변
                delta = 0.0
                if i > 0:
                    delta += (dist[order[i - 1]][order[j]]
                              - dist[order[i - 1]][order[i]])
                if j < n - 1:
                    delta += (dist[order[i]][order[j + 1]]
                              - dist[order[j]][order[j + 1]])
                if delta < -1e-9:
                    order[i:j + 1] = order[i:j + 1][::-1]
                    improved = True
    return order


def plan_tls(occ: OccupancyGrid, cfg: ScanConfig,
             max_stations: int = DEFAULT_MAX_STATIONS) -> TlsPlan:
    """TLS 거치점 배치(greedy set cover) + 순회(NN+2-opt, 구간 A*).

    tradeoff = greedy 선택 접두열의 (거치점 수, 커버리지%) — greedy 누적이므로
    비감소 곡선이다. est_time = 이동거리/주행속도 + 거치점 수 × dwell.
    """
    notes: list = [
        "배치는 greedy set cover — set cover 는 NP-hard, greedy 근사비 ln n (스펙 §5)"
    ]
    target = float(cfg.density_targets_mm["tls"])
    n_free = int(occ.free.sum())
    if n_free == 0:
        notes.append("자유 셀이 없다 — 배치 불가")
        return TlsPlan(notes=notes)

    inf = occ.inflate(cfg.robot_radius_mm)
    labels, n_comp = ndimage.label(inf.free)
    if n_comp == 0:
        notes.append("팽창 자유공간이 없다 — 배치 불가")
        notes.append(_coverage_note(target, 0, n_free))
        return TlsPlan(notes=notes)
    sizes = np.bincount(labels.ravel())[1:]
    main = int(np.argmax(sizes)) + 1
    if n_comp > 1:
        skipped_cells = int(sizes.sum() - sizes.max())
        notes.append(
            f"도달 불가 분리 영역 {n_comp - 1}개({skipped_cells}셀, 팽창 자유공간)"
            f" — 문·단차 미모델로 최대 성분에만 배치")

    candidates = _candidates(inf, labels, main)
    notes.append(f"거치 후보 {len(candidates)}개 "
                 f"(간격 {CANDIDATE_SPACING_MM:g}mm 서브샘플, 팽창 자유공간)")
    covers = _candidate_covers(occ, cfg, candidates, target)

    picked, tradeoff, uncovered, reason = _greedy_set_cover(
        occ, covers, n_free, max_stations)
    stations = [candidates[i] for i in picked]

    covered = n_free - int(uncovered.sum())
    notes.append(_coverage_note(target, covered, n_free))
    if reason == "max":
        notes.append(f"거치점 상한 {max_stations}개 도달 — 커버 미완")
    elif reason == "no_gain":
        notes.append("남은 미커버는 어떤 후보에서도 목표 간격 이하로 관측 불가 "
                     "(차폐·사거리·입사각 한계)")
    if covered < n_free:
        miss = uncovered.reshape(occ.shape)
        iy, ix = np.nonzero(miss)
        heads = ", ".join(
            "({:.0f},{:.0f})".format(*occ.cell_to_world(int(x), int(y)))
            for x, y in list(zip(ix, iy))[:5])
        notes.append(f"잔여 미커버 {n_free - covered}셀 (목표 {target:g}mm) — "
                     f"대표 위치(mm): {heads}")

    tour_order, tour_paths, travel_len = _tour(inf, stations)
    # 이동 속도: TLS 별도 주행 파라미터가 없어 로봇 주행 속도
    # (cfg.mobile_speed_mms)를 재사용한다 (가정). 등속 하한 추정 —
    # 회전·가감속 미모형 (모바일 플래너와 동일).
    est_time = travel_len / cfg.mobile_speed_mms + cfg.tls_dwell_s * len(stations)
    return TlsPlan(stations, tour_order, tour_paths, travel_len,
                   est_time, tradeoff, notes)


# ── 내부 ────────────────────────────────────────────────────


def _coverage_note(target: float, covered: int, n_free: int) -> str:
    pct = 100.0 * covered / n_free if n_free else 0.0
    return (f"계획 커버리지(목표 {target:g}mm): {pct:.1f}% "
            f"(자유 {n_free}셀 중 {covered}셀)")


def _candidates(inf: OccupancyGrid, labels: np.ndarray, main: int) -> list:
    """팽창 자유공간 최대 성분 위 격자 서브샘플 후보 (셀 중심 mm).

    격자 인덱스 절대 위상(step//2 시작)으로 샘플링 — 성분 모양과 무관하게
    결정론적이다. 서브샘플이 성분을 전부 비껴가면(아주 작은 성분) 성분 셀
    전체를 후보로 쓴다.
    """
    step = max(1, int(round(CANDIDATE_SPACING_MM / inf.cell_mm)))
    ny, nx = inf.shape
    out = []
    for iy in range(step // 2, ny, step):
        for ix in range(step // 2, nx, step):
            if labels[iy, ix] == main:
                out.append(inf.cell_to_world(ix, iy))
    if not out:
        yy, xx = np.nonzero(labels == main)
        out = [inf.cell_to_world(int(x), int(y)) for y, x in zip(yy, xx)]
    return out


def _candidate_covers(occ: OccupancyGrid, cfg: ScanConfig, candidates: list,
                      target: float) -> list:
    """후보별 커버 집합: spacing ≤ target 인 셀의 평탄 인덱스 배열.

    observe_station 반환값은 "이번 관측만"의 spacing 장이므로 스크래치
    CoverageGrid 하나를 재사용해도 후보 간 오염이 없다 (누적은 내부
    spacing_mm 에만 일어나고 반환값에는 영향이 없다).
    """
    scratch = CoverageGrid(occ, cfg)
    covers = []
    for (x, y) in candidates:
        obs = scratch.observe_station(x, y, cfg)
        covers.append(np.flatnonzero(obs.ravel() <= target))
    return covers


def _greedy_set_cover(occ: OccupancyGrid, covers: list, n_free: int,
                      max_stations: int):
    """greedy set cover. 반환 (선택 후보 인덱스, tradeoff, 잔여 마스크, 종료 사유).

    매 회 "아직 미달인 셀을 가장 많이 커버하는" 후보를 선택 (동률은 낮은
    인덱스 — 결정론). 종료: 전 셀 커버(done) / 상한 도달(max) /
    어떤 후보도 기여 없음(no_gain — 잔여는 관측 불가).
    """
    uncovered = occ.free.ravel().copy()
    picked: list = []
    chosen = set()
    tradeoff: list = []
    reason = "done"
    while uncovered.any():
        if len(picked) >= max_stations:
            reason = "max"
            break
        best, best_gain = -1, 0
        for ci, cov_idx in enumerate(covers):
            if ci in chosen:
                continue
            gain = int(uncovered[cov_idx].sum())
            if gain > best_gain:
                best, best_gain = ci, gain
        if best < 0:
            reason = "no_gain"
            break
        chosen.add(best)
        picked.append(best)
        uncovered[covers[best]] = False
        covered = n_free - int(uncovered.sum())
        tradeoff.append((len(picked), 100.0 * covered / n_free))
    return picked, tradeoff, uncovered, reason


def _tour(inf: OccupancyGrid, stations: list):
    """NN+2-opt 순회. 반환 (tour_order, tour_paths, travel_len_mm).

    거리 행렬·구간 경로는 팽창 격자 A* (i<j 만 계산, 역방향은 뒤집어
    재사용 — 행렬 대칭 보장). 후보가 같은 연결 성분이므로 A* 는 항상
    성공해야 한다 — 실패는 격자 불변식 위반이라 RuntimeError.
    """
    n = len(stations)
    if n == 0:
        return [], [], 0.0
    if n == 1:
        return [0], [], 0.0

    dist = np.zeros((n, n))
    paths: dict = {}
    for i in range(n):
        for j in range(i + 1, n):
            route = inf.astar(stations[i], stations[j])
            if route is None:
                raise RuntimeError(
                    f"같은 팽창 성분 거치점 {i}→{j} A* 실패 — 격자 불변식 위반")
            paths[(i, j)] = route
            dist[i, j] = dist[j, i] = _polyline_len(route)

    order = two_opt(nearest_neighbor_order(dist), dist)

    tour_paths = []
    travel = 0.0
    for a, b in zip(order, order[1:]):
        route = paths[(a, b)] if (a, b) in paths else paths[(b, a)][::-1]
        tour_paths.append(route)
        travel += _polyline_len(route)
    return order, tour_paths, travel


def _polyline_len(pts) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1])
               for a, b in zip(pts, pts[1:]))

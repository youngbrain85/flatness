"""구역화 — 높이 연속성 연결요소 → 구역별 로버스트 평면 잔차 (스펙 §5.1.3~4, 2026-10-20 개정).

구역(연결요소)이 바닥의 실체다: 결함 구역이 RANSAC 인라이어에서 빠져
측정에서 제외되는 선택 편향을 구역 단위 처리로 회피한다.

2026-10-20 개정(바닥 기준면 개선 스펙 §1): 바닥 레벨을 높이 히스토그램 봉우리로 찾던 방식은 경사면에서
봉우리가 없어 무너졌다(16m 2.5%·3% 구역 0개, 8m 3% 구역 3개). 이제 4방향 이웃 서브셀의 중간값 높이 차이가
step_m 이하이면 같은 면으로 잇는다. 경사·완만한 휨은 한 면, 단차·가구 상판처럼 높이가 끊기는 곳에서 나뉜다.
"""
from dataclasses import dataclass
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from flatness.core.plane import fit_plane_ransac


@dataclass
class ZoneInfo:
    zone_id: int
    level_m: float
    n_subcells: int
    area_m2: float
    status: str
    plane_abc: tuple | None


@dataclass
class ZoneMap:
    labels: np.ndarray
    zones: list


def _continuity_components(mz, step_m):
    """이웃(4방향) 높이 차이가 step_m 이하인 유효 서브셀끼리 이은 연결요소 번호. 값 없는 칸은 -1."""
    ny, nx = mz.shape
    finite = np.isfinite(mz)
    idx = np.arange(ny * nx).reshape(ny, nx)
    with np.errstate(invalid="ignore"):
        h = finite[:, :-1] & finite[:, 1:] & (np.abs(mz[:, :-1] - mz[:, 1:]) <= step_m)
        v = finite[:-1, :] & finite[1:, :] & (np.abs(mz[:-1, :] - mz[1:, :]) <= step_m)
    r = np.concatenate([idx[:, :-1][h], idx[:-1, :][v]])
    c = np.concatenate([idx[:, 1:][h], idx[1:, :][v]])
    graph = coo_matrix((np.ones(len(r), dtype=np.int8), (r, c)), shape=(ny * nx, ny * nx))
    _, comp = connected_components(graph, directed=False)
    comp = comp.reshape(ny, nx)
    comp[~finite] = -1
    return comp


def _has_width(m):
    """덩어리가 평면을 받칠 수 있는가: 3칸 이상이고 칸 중심들이 한 직선 위에 있지 않다.

    작은 시편 재시도(min_area 0)에서는 가장자리 한 줄 같은 폭 없는 덩어리가 남는데, 그런 덩어리에 평면을 맞추면
    실패하거나(실제 시험판, 2026-10-20) 엉뚱한 평면이 나온다.
    """
    ys, xs = np.nonzero(m)
    if len(xs) < 3:
        return False
    c = np.cov(np.vstack([xs, ys]).astype(np.float64))
    return bool(c[0, 0] * c[1, 1] - c[0, 1] ** 2 > 1e-9)


def build_zones(grid, min_area_m2=1.0, step_m=0.015,
                furniture_gap_m=0.3, furniture_max_m2=3.0, ghost_frac=0.2):
    mz = grid.median_z
    labels = np.zeros(mz.shape, dtype=np.int32)
    zones = []
    sub_area = grid.size_m * grid.size_m
    comp = _continuity_components(mz, step_m)
    valid = comp >= 0
    sizes = np.bincount(comp[valid])
    keep = [k for k in np.flatnonzero(sizes) if sizes[k] * sub_area >= min_area_m2]   # 최소 면적 미달 파편 배제
    keep = [k for k in keep if _has_width(comp == k)]   # 폭 없는(일직선·3칸 미만) 덩어리는 면이 아니다
    keep.sort(key=lambda k: (-sizes[k], k))   # 넓은 면부터 구역 번호(결정적)
    for zone_id, k in enumerate(keep, start=1):
        m = comp == k
        labels[m] = zone_id
        n_sub = int(sizes[k])
        zones.append(ZoneInfo(zone_id, float(np.median(mz[m])), n_sub, n_sub * sub_area, "ok", None))
    residuals = np.full(mz.shape, np.nan, dtype=np.float32)
    if not zones:
        return ZoneMap(labels, zones), residuals
    main = zones[0]  # 주 구역 = 가장 넓은 면
    for z in zones:
        m = labels == z.zone_id
        if z.zone_id != main.zone_id and z.level_m > main.level_m + furniture_gap_m \
                and z.area_m2 <= furniture_max_m2:
            z.status = "furniture"  # 가구 상판 의심: 판정 제외 (스펙 §5.1.3)
            continue
        if float(grid.bimodal[m].mean()) > ghost_frac:
            z.status = "ghost"      # 구역 대부분이 이중층: 재스캔 필요
            continue
        ys, xs = np.nonzero(m)
        # 구역 로컬 좌표로 피팅(대좌표 조건수 문제 회피 — origin 무관)
        cx = (xs + 0.5) * grid.size_m
        cy = (ys + 0.5) * grid.size_m
        a, b, c = fit_plane_ransac(cx, cy, mz[ys, xs].astype(float))
        z.plane_abc = (a, b, c)
        residuals[ys, xs] = (mz[ys, xs] - (a * cx + b * cy + c)).astype(np.float32)
    residuals[grid.bimodal] = np.nan  # 쌍봉 서브셀은 어느 구역이든 판정 제외
    return ZoneMap(labels, zones), residuals

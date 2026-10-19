"""구역화 — 높이 연속성 연결요소 → 구역별 로버스트 평면 잔차 (스펙 §5.1.3~4, 2026-10-20 개정).

구역(연결요소)이 바닥의 실체다: 결함 구역이 RANSAC 인라이어에서 빠져
측정에서 제외되는 선택 편향을 구역 단위 처리로 회피한다.

2026-10-20 개정(바닥 기준면 개선 스펙 §1): 바닥 레벨을 높이 히스토그램 봉우리로 찾던 방식은 경사면에서
봉우리가 없어 무너졌다(16m 2.5%·3% 구역 0개, 8m 3% 구역 3개). 이제 4방향 이웃 서브셀의 중간값 높이 차이가
step_m 이하이면 같은 면으로 잇는다. 경사·완만한 휨은 한 면, 단차·가구 상판처럼 높이가 끊기는 곳에서 나뉜다.
"""
from dataclasses import dataclass
import numpy as np
from scipy import ndimage
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


def _surfaces(mz, step_m, min_cells, max_count=None):
    """높이 연속성 연결요소 중 면이 되는 것(칸 수 min_cells 이상·폭 있음)을 넓은 것부터 (bbox, bbox 안 마스크, 칸 수)로.

    연결요소마다 bbox 안에서만 마스크를 만든다(잡음 많은 작은 시편은 덩어리가 수천 개라 전체 격자 비교는 느리다)."""
    comp = _continuity_components(mz, step_m)
    valid = comp >= 0
    if not valid.any():
        return []
    sizes = np.bincount(comp[valid])
    cand = sorted((k for k in np.flatnonzero(sizes) if sizes[k] >= min_cells), key=lambda k: (-sizes[k], k))
    boxes = ndimage.find_objects(comp + 1)   # 연결요소 k 의 bbox = boxes[k] (값 없는 칸 -1 -> 0 은 배경)
    out = []
    for k in cand:
        sl = boxes[k]
        m = comp[sl] == k
        if not _has_width(m):
            continue                          # 폭 없는(일직선·3칸 미만) 덩어리는 면이 아니다
        out.append((sl, m, int(sizes[k])))
        if max_count is not None and len(out) >= max_count:
            break
    return out


def _enclosed_depressions(out, below, labels, zid, finite):
    """out 중 평면 아래로 꺼지고(below) 사방이 같은 구역(zid)으로 둘러싸인 덩어리. 이런 덩어리는 바닥 결함(접시형 함몰)이라
    구역에서 빼지 않는다(빼면 제 구역이 되어 자기 평면 기준으로 매끈해 보이고 판정 최댓값이 5cm 에서 막힌다, 재검토 실측).
    격자 가장자리에 닿거나 둘레에 다른 구역·제외 칸이 있으면 둘러싸인 것이 아니다(경사로 옆 다른 레벨 등)."""
    keep = np.zeros(out.shape, dtype=bool)
    lab, n = ndimage.label(out & below)
    if n == 0:
        return keep
    ny, nx = out.shape
    for k, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == ny or sl[1].stop == nx:
            continue                                    # 격자 가장자리에 닿는다
        big = (slice(sl[0].start - 1, sl[0].stop + 1), slice(sl[1].start - 1, sl[1].stop + 1))
        cm = lab[big] == k
        ring = ndimage.binary_dilation(cm) & ~cm & finite[big]
        if ring.any() and bool(((labels[big] == zid) & ~out[big])[ring].all()):
            keep[big] |= cm
    return keep


def build_zones(grid, min_area_m2=1.0, step_m=0.015, band_m=0.05,
                furniture_gap_m=0.3, furniture_max_m2=3.0, ghost_frac=0.2, max_zones=None, max_rounds=3):
    """서브셀 격자 -> 구역(ZoneMap)과 구역 평면 잔차.

    1) 이웃 높이차 step_m 이하로 이은 연결요소 중 면적 min_area_m2 이상·폭 있는 것을 구역으로 삼는다(넓은 것부터,
       max_zones 개까지 - 작은 시편 재시도는 가장 큰 하나만 본다).
    2) ok 구역마다 RANSAC 평면을 맞추고, 평면에서 band_m(5cm) 넘게 벗어난 칸은 구역에서 뺀다(완만한 더미·경사로로
       이어진 다른 레벨. 옛 ±5cm 밴드의 제외 동작). 단 평면 아래로 꺼지고 사방이 같은 구역인 덩어리(접시형 함몰)는
       바닥 결함이라 남긴다. 뺀 칸끼리 다시 이어 면이 되면 제 구역이 된다(최대 max_rounds 번). 뺀 뒤 구역의 칸 수·
       면적·level_m(남은 칸 중앙값)을 다시 센다. 뺀 뒤 구역이 여러 조각이 되거나 1㎡ 아래로 줄 수 있다(판정은 라벨로 한다).
    3) 가구 상판(주 구역보다 furniture_gap_m 넘게 높고 furniture_max_m2 이하)·유령층(쌍봉 ghost_frac 초과)은 판정 제외.
    """
    mz = grid.median_z
    labels = np.zeros(mz.shape, dtype=np.int32)
    zones = []
    sub_area = grid.size_m * grid.size_m
    min_cells = max(1, int(np.ceil(min_area_m2 / sub_area - 1e-9)))
    residuals = np.full(mz.shape, np.nan, dtype=np.float32)
    main = None

    def fit(z):
        m = labels == z.zone_id
        ys, xs = np.nonzero(m)
        # 구역 로컬 좌표로 피팅(대좌표 조건수 문제 회피 — origin 무관)
        cx = (xs + 0.5) * grid.size_m
        cy = (ys + 0.5) * grid.size_m
        a, b, c = fit_plane_ransac(cx, cy, mz[ys, xs].astype(float))
        z.plane_abc = (a, b, c)
        residuals[ys, xs] = (mz[ys, xs] - (a * cx + b * cy + c)).astype(np.float32)

    source = mz
    for _ in range(max_rounds):
        found = _surfaces(source, step_m, min_cells, max_count=max_zones if not zones else None)
        if not found:
            break
        new = []
        for sl, m, n in found:
            zid = len(zones) + len(new) + 1
            labels[sl][m] = zid
            new.append(ZoneInfo(zid, float(np.median(mz[sl][m])), n, n * sub_area, "ok", None))
        if main is None:
            main = new[0]  # 주 구역 = 가장 넓은 면
        far = np.zeros(mz.shape, dtype=bool)
        for z in new:
            m = labels == z.zone_id
            if z.zone_id != main.zone_id and z.level_m > main.level_m + furniture_gap_m \
                    and z.area_m2 <= furniture_max_m2:
                z.status = "furniture"  # 가구 상판 의심: 판정 제외 (스펙 §5.1.3)
                continue
            if float(grid.bimodal[m].mean()) > ghost_frac:
                z.status = "ghost"      # 구역 대부분이 이중층: 재스캔 필요
                continue
            fit(z)
            with np.errstate(invalid="ignore"):
                out = m & (np.abs(residuals) > band_m)
                below = residuals < -band_m
            if out.any():
                out &= ~_enclosed_depressions(out, below, labels, z.zone_id, np.isfinite(mz))
            if out.any():               # 평면에서 5cm 넘게 벗어난 칸은 이 구역이 아니다
                labels[out] = 0
                residuals[out] = np.nan
                far |= out
                kept = labels == z.zone_id
                z.n_subcells = int(kept.sum())
                z.area_m2 = z.n_subcells * sub_area
                z.level_m = float(np.median(mz[kept]))
        zones.extend(new)
        if not far.any():
            break
        source = np.where(far, mz, np.nan)
    residuals[grid.bimodal] = np.nan  # 쌍봉 서브셀은 어느 구역이든 판정 제외
    return ZoneMap(labels, zones), residuals

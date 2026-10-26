"""다면 기준평면 — 사용자가 정한 개수(K)만큼의 평면을 바닥 전체 서브셀에 한 번에 맞춘다(구배 분석).

배수 구배 바닥은 보통 여러 면이다(용마루에서 배수구로 모이는 2·4면 등). 2m(지금은 1m) 셀마다 따로 맞춘 평면은
면 경계에 걸친 셀에서 한 면만 잡거나 두 면을 섞고, 전체 기준면(reference.global_plane)은 면이 하나뿐이다.
여기서는 바닥 전체를 한 번에 써서 K개 면을 찾는다.

1. 순차 MSAC: 남은 칸에 MSAC 평면 하나 -> 문턱 안 칸을 빼고 다음 평면, K번. 문턱 max(5mm, 3σ)(σ = 칸 높이 잡음).
   인라이어 수만 세면 두 면을 문턱 띠로 비스듬히 걸치는 평면을 고를 수 있어 절단 제곱 손실로 점수를 매긴다
   (reference.py 와 같은 이유).
2. 정제: 순차 방식은 먼저 찾은 평면이 경계 칸을 넘치게 가져간다. 모든 칸을 잔차가 가장 작은 평면에 다시 붙이고
   평면마다 문턱 안 칸으로 다시 맞추기를 배정이 바뀌지 않을 때까지 반복한다(k-평면).
3. 공간 정리: 평면 식은 무한히 뻗으므로 멀리 떨어진 칸이 우연히 다른 면 식에 가까울 수 있다. 같은 평면에 붙은
   칸끼리 이은 덩어리 가운데 min_area_m2 보다 작은 섬은 떼어 가장 가까운 이웃 덩어리의 평면에 붙인다.

원점군이 아니라 서브셀 중앙값을 쓴다(slope.py 와 같은 이유: 잡음·밀도 불균일·계산량).
"""
from dataclasses import dataclass
import math

import numpy as np
from scipy import ndimage

from flatness.core.reference import RANSAC_MAX_CELLS, _msac, cell_noise_sigma

MIN_THR_M = 0.005        # 평면 인라이어 최소 문턱(전체 기준면과 같은 5mm)
MIN_PLANE_AREA_M2 = 1.0   # 평면 하나·섬 하나의 최소 면적(구역 최소 면적과 같은 1㎡). 이보다 작으면 면이 아니라 결함으로 본다
MAX_REFINE_ITERS = 20


@dataclass
class FloorPlane:
    plane_id: int            # 1부터, 면적이 넓은 순
    abc: tuple               # z = a·x + b·y + c (절대 좌표 m, SlopeCell.center_x/y 와 같은 틀)
    n_subcells: int          # 이 평면에 배정된 칸 수
    area_m2: float
    centroid_x: float
    centroid_y: float
    slope_pct: float
    downhill_rad: float
    rmse_m: float            # 배정된 칸 전체(결함 포함)의 잔차
    inlier_pct: float        # 배정된 칸 중 문턱 안 칸 비율
    se_pct: float            # 기울기 표준오차(slope.py 와 같은 식)
    run_m: float             # 내리막 방향으로 잰 평면 길이(보정 높이차 환산용)


@dataclass
class MultiPlaneFit:
    planes: list             # [FloorPlane]
    labels: np.ndarray       # 서브셀 격자 모양, 칸마다 plane_id(평면 밖·제외 칸 0)
    thr_m: float
    sigma_m: float
    requested: int


def _lstsq(cx, cy, z):
    A = np.column_stack([cx, cy, np.ones(len(z))])
    abc, *_ = np.linalg.lstsq(A, z, rcond=None)
    return abc


def _has_width(cx, cy):
    """칸 중심들이 한 직선 위에 있지 않은가(평면을 받칠 수 있는가)."""
    if len(cx) < 3:
        return False
    c = np.cov(np.vstack([cx, cy]))
    return bool(c[0, 0] * c[1, 1] - c[0, 1] ** 2 > 1e-12)


def _sequential(cx, cy, z, k, thr, min_cells):
    """순차 MSAC 로 평면을 최대 k 개 찾는다. 남은 칸이 면이 될 만큼 없으면 일찍 멈춘다."""
    remaining = np.ones(len(z), dtype=bool)
    planes = []
    for _ in range(k):
        idx = np.flatnonzero(remaining)
        if len(idx) < min_cells:
            break
        step = max(1, int(np.ceil(len(idx) / RANSAC_MAX_CELLS)))
        sub = idx[::step]
        try:
            abc = _msac(cx[sub], cy[sub], z[sub], thr)
        except ValueError:
            break
        inl = remaining & (np.abs(z - (abc[0] * cx + abc[1] * cy + abc[2])) < thr)
        if inl.sum() < min_cells or not _has_width(cx[inl], cy[inl]):
            break
        abc = _lstsq(cx[inl], cy[inl], z[inl])
        inl = remaining & (np.abs(z - (abc[0] * cx + abc[1] * cy + abc[2])) < thr)
        planes.append(abc)
        remaining &= ~inl
    return planes


def _clean_islands(lab_img, mask, min_cells):
    """평면별 연결 덩어리 중 min_cells 미만인 섬을 가장 가까운 큰 덩어리의 평면으로 바꾼다. 큰 덩어리가 없으면 그대로."""
    out = lab_img.copy()
    small = np.zeros(mask.shape, dtype=bool)
    for j in np.unique(lab_img[mask]):
        comp, n = ndimage.label(lab_img == j)
        if n == 0:
            continue
        sizes = np.bincount(comp.ravel())
        sizes[0] = min_cells   # 배경은 섬이 아니다
        small |= (sizes < min_cells)[comp]
    small &= mask
    if not small.any() or not (mask & ~small).any():
        return out
    keep = mask & ~small
    _, (iy, ix) = ndimage.distance_transform_edt(~keep, return_indices=True)
    out[small] = lab_img[iy[small], ix[small]]
    return out


DUPLICATE_FRAC = 0.9     # 한 평면 칸의 이 비율 이상이 다른 평면 문턱 안이면 같은 면으로 보고 합친다


def _merge_duplicates(planes, cx, cy, z, thr, lab_of):
    """같은 면을 나눠 가진 평면 쌍을 합친다(K 를 실제 면 수보다 크게 줬을 때). 넓은 평면을 남기고 좁은 쪽을 없앤다."""
    if len(planes) < 2:
        return planes
    lab = lab_of(planes)
    sizes = [int((lab == j + 1).sum()) for j in range(len(planes))]
    order = sorted(range(len(planes)), key=lambda j: -sizes[j])
    kept = []
    for j in order:
        m = lab == j + 1
        if not m.any():
            continue
        dup = False
        for i in kept:
            a, b, c = planes[i]
            if float((np.abs(z[m] - (a * cx[m] + b * cy[m] + c)) < thr).mean()) >= DUPLICATE_FRAC:
                dup = True
                break
        if not dup:
            kept.append(j)
    return [planes[j] for j in sorted(kept)]


def fit_floor_planes(median_z, mask, size_m, k, origin=(0.0, 0.0), min_area_m2=MIN_PLANE_AREA_M2):
    """mask 칸(바닥) 전체에 평면 k 개를 맞춘다 -> MultiPlaneFit. 찾은 평면이 k 개보다 적을 수 있다(바닥이 그만큼 면이 없음).

    좌표는 서브셀 격자 원점 기준의 작은 값으로 맞추고, 결과 평면식은 origin(격자 원점의 절대 좌표 m)을 더한 틀로 바꿔 낸다.
    """
    if k < 1:
        raise ValueError("평면 개수는 1 이상이어야 합니다")
    mz = np.asarray(median_z, dtype=np.float64)
    mask = np.asarray(mask, dtype=bool) & np.isfinite(mz)
    ys, xs = np.nonzero(mask)
    if len(ys) < 3:
        raise ValueError("다면 기준평면 맞춤 실패: 바닥 칸이 부족합니다")
    cx = (xs + 0.5) * size_m
    cy = (ys + 0.5) * size_m
    z = mz[ys, xs]
    sigma = cell_noise_sigma(mz, mask)
    thr = max(MIN_THR_M, 3.0 * sigma)
    min_cells = max(3, int(np.ceil(min_area_m2 / (size_m * size_m) - 1e-9)))

    planes = _sequential(cx, cy, z, k, thr, min_cells)
    if not planes:
        raise ValueError("다면 기준평면 맞춤 실패: 면이 될 만한 칸 묶음이 없습니다")

    def assign(planes):
        P = np.array(planes)                                        # (m, 3)
        R = np.abs(z[:, None] - (cx[:, None] * P[:, 0] + cy[:, None] * P[:, 1] + P[:, 2]))
        img = np.zeros(mz.shape, dtype=np.int32)
        img[ys, xs] = np.argmin(R, axis=1) + 1
        return _clean_islands(img, mask, min_cells)[ys, xs]

    prev = None
    for _ in range(MAX_REFINE_ITERS):
        lab = assign(planes)
        if prev is not None and np.array_equal(lab, prev):
            break
        prev = lab
        new = []
        for j in range(1, len(planes) + 1):
            m = lab == j
            abc = planes[j - 1]
            inl = m & (np.abs(z - (abc[0] * cx + abc[1] * cy + abc[2])) < thr)
            if inl.sum() < min_cells or not _has_width(cx[inl], cy[inl]):
                continue                                            # 칸을 다 빼앗긴 평면은 없앤다
            new.append(_lstsq(cx[inl], cy[inl], z[inl]))
        if not new:
            break
        new = _merge_duplicates(new, cx, cy, z, thr, lab_of=assign)
        if len(new) != len(planes):
            prev = None                                             # 평면 번호가 바뀌어 배정 비교가 무의미하다
        planes = new
    lab = assign(planes)                                            # 최종 평면과 짝이 맞는 배정

    # 평면별 지표(면적 넓은 순으로 번호를 다시 매긴다)
    order = sorted(np.unique(lab), key=lambda j: -int((lab == j).sum()))
    ox, oy = float(origin[0]), float(origin[1])
    out_planes = []
    final = np.zeros(mz.shape, dtype=np.int32)
    for new_id, j in enumerate(order, start=1):
        m = lab == j
        px, py, pz = cx[m], cy[m], z[m]
        a, b, c = (float(v) for v in planes[j - 1])
        resid = pz - (a * px + b * py + c)
        n = int(m.sum())
        rmse = float(np.sqrt(np.mean(resid ** 2)))
        sx, sy = float(np.std(px)), float(np.std(py))
        se_pct = (100.0 * math.hypot(rmse / (math.sqrt(n) * sx), rmse / (math.sqrt(n) * sy))
                  if sx > 0 and sy > 0 else float("nan"))
        downhill = math.atan2(-b, -a)
        proj = px * math.cos(downhill) + py * math.sin(downhill)
        out_planes.append(FloorPlane(
            plane_id=new_id,
            abc=(a, b, c - a * ox - b * oy),
            n_subcells=n,
            area_m2=n * size_m * size_m,
            centroid_x=float(px.mean()) + ox,
            centroid_y=float(py.mean()) + oy,
            slope_pct=100.0 * math.hypot(a, b),
            downhill_rad=downhill,
            rmse_m=rmse,
            inlier_pct=100.0 * float((np.abs(resid) < thr).mean()),
            se_pct=se_pct,
            run_m=float(proj.max() - proj.min()) + size_m,
        ))
        final[ys[m], xs[m]] = new_id
    return MultiPlaneFit(out_planes, final, thr, sigma, k)

"""바닥 기준면 두 개 — 국부(1m 창, 스펙 §8) 기준면과 전체 기준면 (2026-10-20 바닥 기준면 개선 스펙 §2).

판정(직선자)과는 무관한 표시용 기준이다. 직선자 틈새는 직선 성분과 무관해 구역 평면 잔차로 그대로 계산한다.

- 국부 기준면: 각 바닥 서브셀마다 같은 구역의 서브셀만으로 중심 win_m x win_m 창에 최소제곱 평면을 맞춰 그 칸 중심
  높이를 기준으로 삼는다. 2회 맞춤: 1회차 잔차가 max(3mm, 3σ) 를 넘는 칸(결함)을 빼고 다시 맞춘다.
  창(1m)보다 긴 휨(처짐·드리프트·창보다 넓은 함몰)은 넓을수록 크게 약해진다(깊이 10mm 함몰 지름 1.2m −8.0mm,
  2.5m −2.9mm, 리뷰 실측). 넓은 것은 전체 기준면에서 본다. 창 합은 누적합 표(summed-area table)로 O(1)에 구한다.
- 전체 기준면: 바닥(ok 구역) 전체에 MSAC 평면 하나. 전체 기울기·방 사이 높이 차·단차가 드러난다.
  인라이어 수만 세는 RANSAC 은 1.5~2cm 단차의 두 면을 문턱 띠로 비스듬히 걸치는 평면을 고를 수 있어(리뷰 실측
  2026-10-20) 절단 제곱 손실(MSAC)로 점수를 매긴다. 한 면에 딱 붙는 평면이 이긴다.
"""
import numpy as np

MAD_TO_SIGMA = 1.4826
MIN_TRIM_M = 0.003          # 국부 2회차에서 결함으로 뺄 최소 편차
MIN_GLOBAL_THR_M = 0.005    # 전체 기준 RANSAC 인라이어 최소 문턱(옛 구역 평면과 같은 5mm)
MIN_WINDOW_CELLS = 30       # 창 안 유효 칸이 이보다 적으면 구역 평면 값을 쓴다
DEGENERATE_REL = 1e-3       # 창 안 칸들이 거의 일직선이면(det/(cxx·cyy) 미만) 구역 평면 값을 쓴다
# 절대 하한: 창 칸 중심 좌표 공분산의 최소 고유값이 (서브셀 변)² x 이 값보다 작으면 일직선으로 본다.
# 한 열은 0, 두 열은 0.25 다. 상대 판정만 쓰면 큰 좌표의 부동소수 잡음이 한 열 창을 통과시킨다(리뷰 실측 2026-10-20)
DEGENERATE_MIN_VAR = 0.05
RANSAC_MAX_CELLS = 200_000  # 전체 기준 가설 채점에 쓸 최대 칸 수(넘으면 고르게 솎는다)
MSAC_ITERS = 500
MSAC_SEED = 0


def noise_sigma(res):
    """잔차의 로버스트 표준편차 = MAD x 1.4826. 값이 없으면 0."""
    r = np.asarray(res, dtype=np.float64)
    r = r[np.isfinite(r)]
    if r.size == 0:
        return 0.0
    return float(MAD_TO_SIGMA * np.median(np.abs(r - np.median(r))))


def _box(a, r):
    """각 칸 중심 (2r+1) x (2r+1) 창의 합(가장자리는 창을 잘라 낸다)."""
    ny, nx = a.shape
    s = np.zeros((ny + 1, nx + 1))
    s[1:, 1:] = a.cumsum(0).cumsum(1)
    y0 = np.clip(np.arange(ny) - r, 0, ny)
    y1 = np.clip(np.arange(ny) + r + 1, 0, ny)
    x0 = np.clip(np.arange(nx) - r, 0, nx)
    x1 = np.clip(np.arange(nx) + r + 1, 0, nx)
    return s[y1][:, x1] - s[y0][:, x1] - s[y1][:, x0] + s[y0][:, x0]


def _window_planes(z, w, xx, yy, r, size_m):
    """가중(0/1) w 칸으로 각 칸 중심 창에 맞춘 평면의 그 칸 중심 높이. 칸 부족·퇴화는 NaN.

    xx·yy·z 는 crop 원점·crop 중앙값 기준의 작은 값이어야 한다(큰 좌표의 모멘트 상쇄 오차를 피한다)."""
    zw = np.where(w, z, 0.0)
    wf = w.astype(np.float64)
    n = _box(wf, r)
    with np.errstate(invalid="ignore", divide="ignore"):
        mx = _box(wf * xx, r) / n
        my = _box(wf * yy, r) / n
        mz = _box(zw, r) / n
        cxx = _box(wf * xx * xx, r) - n * mx * mx
        cxy = _box(wf * xx * yy, r) - n * mx * my
        cyy = _box(wf * yy * yy, r) - n * my * my
        cxz = _box(xx * zw, r) - n * mx * mz
        cyz = _box(yy * zw, r) - n * my * mz
        det = cxx * cyy - cxy * cxy
        a = (cxz * cyy - cyz * cxy) / det
        b = (cyz * cxx - cxz * cxy) / det
        ref = mz + a * (xx - mx) + b * (yy - my)
        vx, vy, vxy = cxx / n, cyy / n, cxy / n
        lam_min = (vx + vy) / 2 - np.sqrt(((vx - vy) / 2) ** 2 + vxy ** 2)   # 좌표 공분산의 최소 고유값
        bad = ((n < MIN_WINDOW_CELLS) | ~(det > DEGENERATE_REL * cxx * cyy)
               | ~(lam_min >= DEGENERATE_MIN_VAR * size_m * size_m))
    ref[bad] = np.nan
    return ref


BAND_ROWS = 192   # 창 평면을 이 행 수씩(위아래 창 반경만큼 덧대어) 나눠 계산한다. 결과는 같고 임시 배열 메모리만 준다


def _window_planes_banded(z, w, xx, yy, r, size_m):
    """_window_planes 를 행 띠로 나눠 계산한다. 띠마다 위아래 r 행을 덧대므로 각 칸의 창 합은 통째 계산과 같다."""
    h = z.shape[0]
    if h <= BAND_ROWS + 2 * r:
        return _window_planes(z, w, xx, yy, r, size_m)
    out = np.empty(z.shape)
    for y0 in range(0, h, BAND_ROWS):
        y1 = min(h, y0 + BAND_ROWS)
        a0, a1 = max(0, y0 - r), min(h, y1 + r)
        part = _window_planes(z[a0:a1], w[a0:a1], xx[a0:a1], yy[a0:a1], r, size_m)
        out[y0:y1] = part[y0 - a0:y1 - a0]
    return out


def local_reference(median_z, labels, zone_planes, size_m, win_m=1.0, fit_mask=None):
    """국부 기준면 높이(m)와 잡음 σ(m). zone_planes = {zone_id: (a, b, c)}(구역 평면, 서브셀 격자 원점 좌표).

    fit_mask 가 False 인 칸(쌍봉 등)은 맞춤에 쓰지 않지만 기준 높이는 받는다. 구역 밖은 NaN.
    구역마다 bbox 로 잘라 crop 원점·crop 중앙값 기준 좌표로 맞춘다(메모리는 구역 crop 하나씩만 든다).
    """
    mz = np.asarray(median_z, dtype=np.float64)
    ny, nx = mz.shape
    fit = np.isfinite(mz) if fit_mask is None else (np.isfinite(mz) & fit_mask)
    r = int(round(win_m / 2 / size_m))
    ref = np.full((ny, nx), np.nan)
    crops = []
    for zid, abc in zone_planes.items():
        ys, xs = np.nonzero(labels == zid)
        if ys.size:
            crops.append((zid, abc, (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))))

    def frame(zid, abc, sl):
        zc = labels[sl] == zid
        h, w = zc.shape
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
        xx = (xx + 0.5) * size_m          # crop 원점 기준(작은 값)
        yy = (yy + 0.5) * size_m
        a, b, c = abc
        gx = xx + sl[1].start * size_m    # 구역 평면은 서브셀 격자 원점 좌표다
        gy = yy + sl[0].start * size_m
        zplane = a * gx + b * gy + c
        z = mz[sl]
        z0 = float(np.nanmedian(z[zc])) if np.isfinite(z[zc]).any() else 0.0
        return zc, xx, yy, zplane, z - z0, z0

    # 1회차: 구역 안 맞춤 칸 전부
    for zid, abc, sl in crops:
        zc, xx, yy, zplane, zr, z0 = frame(zid, abc, sl)
        p1 = _window_planes_banded(zr, fit[sl] & zc, xx, yy, r, size_m) + z0
        ref[sl][zc] = np.where(np.isnan(p1), zplane, p1)[zc]
    sigma = noise_sigma((mz - ref)[fit & np.isfinite(ref)])
    thr = max(MIN_TRIM_M, 3.0 * sigma)
    # 2회차: 1회차에서 크게 벗어난 칸(결함)을 빼고 다시 맞춘다
    first = ref.copy()
    for zid, abc, sl in crops:
        zc, xx, yy, zplane, zr, z0 = frame(zid, abc, sl)
        with np.errstate(invalid="ignore"):
            keep = fit[sl] & zc & (np.abs(mz[sl] - first[sl]) <= thr)
        p2 = _window_planes_banded(zr, keep, xx, yy, r, size_m) + z0
        ref[sl][zc] = np.where(np.isnan(p2), zplane, p2)[zc]
    return ref, sigma


def _msac(cx, cy, z, thr):
    """MSAC 평면: 세 칸 가설마다 Σ min(r², thr²) 이 가장 작은 평면. 결정적(시드 고정)."""
    rng = np.random.default_rng(MSAC_SEED)
    n = len(z)
    A = np.column_stack([cx, cy, np.ones(n)])
    best, best_cost = None, np.inf
    cap = thr * thr
    for _ in range(MSAC_ITERS):
        i = rng.choice(n, 3, replace=False)
        try:
            abc = np.linalg.solve(A[i], z[i])
        except np.linalg.LinAlgError:
            continue   # 일직선 세 칸
        cost = np.minimum((A @ abc - z) ** 2, cap).sum()
        if cost < best_cost:
            best, best_cost = abc, cost
    if best is None:
        raise ValueError("전체 기준면 맞춤 실패: 칸이 부족하거나 일직선")
    return best


def global_plane(median_z, mask, size_m, sigma):
    """mask 칸 전체에 맞춘 평면 (a, b, c)(서브셀 격자 원점 좌표). MSAC(문턱 max(5mm, 3σ)) 뒤 인라이어 최소제곱."""
    ys, xs = np.nonzero(mask)
    cx = (xs + 0.5) * size_m
    cy = (ys + 0.5) * size_m
    z = np.asarray(median_z, dtype=np.float64)[ys, xs]
    thr = max(MIN_GLOBAL_THR_M, 3.0 * sigma)
    step = max(1, int(np.ceil(len(z) / RANSAC_MAX_CELLS)))   # 큰 바닥은 가설 채점만 고르게 솎은 칸으로
    a, b, c = _msac(cx[::step], cy[::step], z[::step], thr)
    inl = np.abs(z - (a * cx + b * cy + c)) < thr
    A = np.column_stack([cx[inl], cy[inl], np.ones(int(inl.sum()))])
    abc, *_ = np.linalg.lstsq(A, z[inl], rcond=None)
    return float(abc[0]), float(abc[1]), float(abc[2])

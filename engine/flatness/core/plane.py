"""높이형 RANSAC 평면 — z=ax+by+c 모델이라 그리드가 보존된다.

결함(범프·침하)은 인라이어에서 자연히 제외되어 기준면을 오염시키지 않는다.
"""
import numpy as np


def fit_plane_ransac(x, y, z, n_iter=500, thresh_m=0.005, seed=0):
    rng = np.random.default_rng(seed)
    n = len(x)
    A_full = np.column_stack([x, y, np.ones(n)])
    best_mask, best_cnt = None, -1
    for _ in range(n_iter):
        i = rng.choice(n, 3, replace=False)
        A = A_full[i]
        try:
            abc = np.linalg.solve(A, np.asarray(z)[i])
        except np.linalg.LinAlgError:
            continue  # 일직선 3점이면 건너뜀
        res = np.abs(A_full @ abc - z)
        mask = res < thresh_m
        if mask.sum() > best_cnt:
            best_cnt, best_mask = int(mask.sum()), mask
    if best_mask is None or best_cnt < 3:
        raise ValueError("평면 피팅 실패: 점이 부족하거나 퇴화 구성")
    abc, *_ = np.linalg.lstsq(A_full[best_mask], np.asarray(z)[best_mask], rcond=None)
    return float(abc[0]), float(abc[1]), float(abc[2])


def residual_grid(grid, abc):
    a, b, c = abc
    ny, nx = grid.shape
    cx = grid.origin[0] + (np.arange(nx) + 0.5) * grid.size_m
    cy = grid.origin[1] + (np.arange(ny) + 0.5) * grid.size_m
    plane = a * cx[None, :] + b * cy[:, None] + c
    return (grid.median_z - plane).astype(np.float32)

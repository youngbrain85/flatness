"""벽면 검출·투영 — xy 컬럼 점유에서 벽 후보를 찾고 2D 라인 RANSAC으로 벽 라인 추출.

z-up 가정(스펙 §5.1.8): 수직도는 z축 기준 상대 지표다.
"""
from dataclasses import dataclass
import numpy as np


@dataclass
class WallLine:
    p0: np.ndarray
    direction: np.ndarray
    normal: np.ndarray
    u_min: float
    u_max: float
    z_min: float
    z_max: float


def build_column_grid(chunks, info, scale_to_m, bin_m=0.05):
    """xy 컬럼별 z 최소/최대/점수 누적 (스트리밍, bbox 상대 좌표)."""
    lo = info.bbox_min * scale_to_m
    hi = info.bbox_max * scale_to_m
    nx = max(1, int(np.ceil((hi[0] - lo[0]) / bin_m)))
    ny = max(1, int(np.ceil((hi[1] - lo[1]) / bin_m)))
    zmin2d = np.full((ny, nx), np.inf, dtype=np.float64)
    zmax2d = np.full((ny, nx), -np.inf, dtype=np.float64)
    cnt2d = np.zeros((ny, nx), dtype=np.int32)
    for c in chunks:
        p = c.astype(np.float64) * scale_to_m
        ix = np.clip(((p[:, 0] - lo[0]) / bin_m).astype(np.int64), 0, nx - 1)
        iy = np.clip(((p[:, 1] - lo[1]) / bin_m).astype(np.int64), 0, ny - 1)
        z = p[:, 2] - lo[2]
        flat = iy * nx + ix
        np.minimum.at(zmin2d.ravel(), flat, z)
        np.maximum.at(zmax2d.ravel(), flat, z)
        np.add.at(cnt2d.ravel(), flat, 1)
    return zmin2d, zmax2d, cnt2d, np.zeros(2), (ny, nx)


def detect_wall_lines(zmin2d, zmax2d, cnt2d, origin, bin_m, min_height_m=0.8,
                      min_length_m=1.0, dist_thresh_m=0.05, min_cells=40,
                      max_walls=8, n_iter=800, seed=0):
    """벽 후보 컬럼 중심점들에 2D 라인 RANSAC 반복 추출 (최대 max_walls개)."""
    rng = np.random.default_rng(seed)
    extent = zmax2d - zmin2d
    mask = np.isfinite(extent) & (extent >= min_height_m) & (cnt2d >= 3)
    ys, xs = np.nonzero(mask)
    pts = np.column_stack([origin[0] + (xs + 0.5) * bin_m,
                           origin[1] + (ys + 0.5) * bin_m])
    zmins = zmin2d[ys, xs]
    zmaxs = zmax2d[ys, xs]
    walls = []
    active = np.ones(len(pts), dtype=bool)
    while len(walls) < max_walls:
        idx = np.nonzero(active)[0]
        if len(idx) < min_cells:
            break
        best = None  # (인라이어 수, 인라이어 인덱스 배열, p0, d, n)
        for _ in range(n_iter):
            i, j = rng.choice(idx, 2, replace=False)
            d = pts[j] - pts[i]
            L = np.hypot(d[0], d[1])
            if L < 1e-9:
                continue
            d = d / L
            n = np.array([-d[1], d[0]])
            dist = np.abs((pts[idx] - pts[i]) @ n)
            inl = idx[dist < dist_thresh_m]
            if best is None or len(inl) > len(best[1]):
                best = (len(inl), inl, pts[i].copy(), d.copy(), n.copy())
        if best is None or len(best[1]) < min_cells:
            break
        _, inl, p0, d, n = best
        u = (pts[inl] - p0) @ d
        if float(u.max() - u.min()) < min_length_m:
            active[inl] = False  # 짧은 파편 라인: 소진시키고 계속
            continue
        walls.append(WallLine(p0=p0, direction=d, normal=n,
                              u_min=float(u.min()), u_max=float(u.max()),
                              z_min=float(zmins[inl].min()), z_max=float(zmaxs[inl].max())))
        active[inl] = False
    return walls

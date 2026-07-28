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


from flatness.io.reader import CloudInfo
from flatness.core.subcell import build_subcell_grid


def project_wall_points(chunks, info, scale_to_m, wall, band_m=0.1, edge_margin_m=0.1):
    """벽 평면 ±band 내 점을 (u, v, w) float64 청크로 변환. +w = 법선 방향 돌출.

    바닥 접합부(v < z_min+edge_margin)는 제외 — 밴드 안에 들어오는 바닥 점 띠가
    하단 행을 오염시키는 것을 막는다(실물 벽 검측도 접합부 제외).

    detect_wall_lines의 2점 RANSAC은 normal 부호를 정하지 않는다(어느 두 점이
    표본으로 뽑히는지에 따라 임의). "+w = 돌출"이 성립하려면 normal이 실내
    쪽(점군 대다수가 있는 쪽)을 향해야 하므로, 전체 점군 bbox 중심을 대리 기준으로
    삼아 normal 부호를 정규화한다(스트리밍 재순회 없이 info만으로 계산 가능).
    """
    lo = info.bbox_min * scale_to_m
    hi = info.bbox_max * scale_to_m
    center_rel = (hi[:2] - lo[:2]) / 2.0
    sign = 1.0 if float((center_rel - wall.p0) @ wall.normal) >= 0.0 else -1.0
    out = []
    for c in chunks:
        p = c.astype(np.float64) * scale_to_m
        xy = p[:, :2] - lo[:2]
        rel = xy - wall.p0
        w = sign * (rel @ wall.normal)
        u = rel @ wall.direction
        v = p[:, 2] - lo[2]
        m = (np.abs(w) <= band_m) & (u >= wall.u_min) & (u <= wall.u_max) \
            & (v >= wall.z_min + edge_margin_m) & (v <= wall.z_max)
        if m.any():
            out.append(np.column_stack([u[m], v[m], w[m]]))
    return out


def wall_grid(uvw_chunks, subcell_m=0.05):
    """(u,v,w) 점으로 서브셀 그리드 구성 — 기존 비닝·품질 마스크 전부 재사용."""
    allp = np.vstack(uvw_chunks) if uvw_chunks else np.zeros((0, 3))
    if len(allp) == 0:
        raise ValueError("벽 투영 점 없음")
    info = CloudInfo(len(allp), allp.min(axis=0), allp.max(axis=0))
    return build_subcell_grid(iter([allp]), info, 1.0, subcell_m=subcell_m)

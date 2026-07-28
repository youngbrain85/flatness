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


def build_column_grid(chunks, info, scale_to_m, bin_m=0.05, mid_margin_m=0.3):
    """xy 컬럼별 z 최소/최대/점수·중간 대역 점유 누적 (스트리밍, bbox 상대 좌표).

    cnt_mid2d: 전역 z 범위의 [mid_margin_m, H-mid_margin_m] 중간 대역 점유 카운트.
    바닥+천장만 있는 컬럼은 상하 2클러스터라 중간 대역이 비고, 진짜 벽 컬럼은
    중간 높이가 연속 점유된다 — 천장 포함 스캔에서 벽 후보를 가려내는 근거(티켓18 후속).
    """
    lo = info.bbox_min * scale_to_m
    hi = info.bbox_max * scale_to_m
    nx = max(1, int(np.ceil((hi[0] - lo[0]) / bin_m)))
    ny = max(1, int(np.ceil((hi[1] - lo[1]) / bin_m)))
    zmin2d = np.full((ny, nx), np.inf, dtype=np.float64)
    zmax2d = np.full((ny, nx), -np.inf, dtype=np.float64)
    cnt2d = np.zeros((ny, nx), dtype=np.int32)
    cnt_mid2d = np.zeros((ny, nx), dtype=np.int32)
    H = float(hi[2] - lo[2])
    lo_mid, hi_mid = mid_margin_m, H - mid_margin_m  # 전역 z 기준 중간 대역
    for c in chunks:
        p = c.astype(np.float64) * scale_to_m
        ix = np.clip(((p[:, 0] - lo[0]) / bin_m).astype(np.int64), 0, nx - 1)
        iy = np.clip(((p[:, 1] - lo[1]) / bin_m).astype(np.int64), 0, ny - 1)
        z = p[:, 2] - lo[2]
        flat = iy * nx + ix
        np.minimum.at(zmin2d.ravel(), flat, z)
        np.maximum.at(zmax2d.ravel(), flat, z)
        np.add.at(cnt2d.ravel(), flat, 1)
        if hi_mid > lo_mid:
            mmid = (z > lo_mid) & (z < hi_mid)
            np.add.at(cnt_mid2d.ravel(), flat[mmid], 1)
    return zmin2d, zmax2d, cnt2d, cnt_mid2d, np.zeros(2), (ny, nx)


def detect_wall_lines(zmin2d, zmax2d, cnt2d, cnt_mid2d, origin, bin_m, min_height_m=0.8,
                      min_length_m=1.0, dist_thresh_m=0.05, min_cells=40,
                      max_walls=8, n_iter=800, seed=0):
    """벽 후보 컬럼 중심점들에 2D 라인 RANSAC 반복 추출 (최대 max_walls개).

    cnt_mid2d >= 3 조건으로 중간 높이가 비어있는(바닥+천장 샌드위치) 컬럼을
    후보에서 제외 — 천장 포함 스캔의 팬텀 벽 검출 차단.
    """
    rng = np.random.default_rng(seed)
    extent = zmax2d - zmin2d
    mask = np.isfinite(extent) & (extent >= min_height_m) & (cnt2d >= 3) & (cnt_mid2d >= 3)
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


def project_wall_points(chunks, info, scale_to_m, wall, band_m=0.1,
                        edge_margin_m=0.1, interior_window_m=1.0):
    """벽 평면 ±band 내 점을 (u, v, w) float64 청크로 변환. +w = 법선 방향 돌출.

    바닥 접합부(v < z_min+edge_margin)는 제외 — 밴드 안에 들어오는 바닥 점 띠가
    하단 행을 오염시키는 것을 막는다(실물 벽 검측도 접합부 제외). 천장 접합부도 동일 마진.

    부호 규약: +w = 실내(벽 주변 점 질량이 많은 쪽) 방향 돌출.
    실내 판별은 밴드 밖 ±interior_window 구간의 점 수 비교로 결정 —
    bbox 중심 휴리스틱은 중심 통과 벽에서 결정적으로 실패해 폐기(리뷰 재현).
    """
    lo = info.bbox_min * scale_to_m
    out = []
    n_pos = n_neg = 0
    for c in chunks:
        p = c.astype(np.float64) * scale_to_m
        xy = p[:, :2] - lo[:2]
        rel = xy - wall.p0
        w = rel @ wall.normal
        u = rel @ wall.direction
        v = p[:, 2] - lo[2]
        # 실내 판별용: 밴드 밖 ± interior_window 구간(u 범위 내)의 점 질량
        sel = (u >= wall.u_min) & (u <= wall.u_max) \
            & (np.abs(w) > band_m) & (np.abs(w) <= interior_window_m)
        n_pos += int((w[sel] > 0).sum())
        n_neg += int((w[sel] < 0).sum())
        m = (np.abs(w) <= band_m) & (u >= wall.u_min) & (u <= wall.u_max) \
            & (v >= wall.z_min + edge_margin_m) & (v <= wall.z_max - edge_margin_m)
        if m.any():
            out.append(np.column_stack([u[m], v[m], w[m]]))
    if n_neg > n_pos:
        for a in out:  # 실내가 -w 쪽이면 법선 반전과 동치로 w 부호 반전
            a[:, 2] = -a[:, 2]
    return out


def wall_grid(uvw_chunks, subcell_m=0.05):
    """(u,v,w) 점으로 서브셀 그리드 구성 — 기존 비닝·품질 마스크 전부 재사용."""
    allp = np.vstack(uvw_chunks) if uvw_chunks else np.zeros((0, 3))
    if len(allp) == 0:
        raise ValueError("벽 투영 점 없음")
    info = CloudInfo(len(allp), allp.min(axis=0), allp.max(axis=0))
    return build_subcell_grid(iter([allp]), info, 1.0, subcell_m=subcell_m)


from flatness.core.plane import fit_plane_ransac, residual_grid
from flatness.core.cells import evaluate_cells
from flatness.criteria import grade_cells, grade_value, load_criteria


def evaluate_wall(grid, criterion, u_mm, cell_m=1.0):
    """벽 평면 재피팅 잔차의 셀 직선자 판정 + 수직도(b=dw/dv) 산출.

    셀 판정 = 국부 요철(평면 제거 후), 수직도 = 전역 기울기 — 바닥의 레벨 분리와 동일 원칙.
    """
    ys, xs = np.nonzero(np.isfinite(grid.median_z))
    if len(xs) < 10:
        raise ValueError("벽 유효 서브셀 부족")
    cu = grid.origin[0] + (xs + 0.5) * grid.size_m
    cv = grid.origin[1] + (ys + 0.5) * grid.size_m
    a, b, c = fit_plane_ransac(cu, cv, grid.median_z[ys, xs].astype(float))
    residuals = residual_grid(grid, (a, b, c))
    span = criterion.span_m if criterion.span_m else 3.0
    cells = evaluate_cells(residuals, grid, span_m=span, cell_m=cell_m)
    grades, warns = grade_cells(cells, criterion, u_mm)
    height = float(cv.max() - cv.min())
    length = float(cu.max() - cu.min())
    plumb_mm = abs(b) * height * 1000.0  # b = 높이당 법선 편차(z-up 기준 상대 수직도)
    pc = load_criteria()["wall-kcs-plumb"]
    plumb_grade, _ = grade_value(plumb_mm, pc, u_mm, span_used_m=1.0)
    metrics = {"height_m": round(height, 2), "length_m": round(length, 2),
               "plumbness_mm": round(plumb_mm, 2), "plumb_grade": plumb_grade,
               "plane_abc": [round(v, 6) for v in (a, b, c)]}
    return cells, grades, list(warns), metrics

"""판정 셀 평가 — 셀 내 모든 직선자 배치(라인) 스윕, 4방향(스펙 §5.1.6 개정판).

직선자를 셀 안 임의 위치·4방향으로 대는 실물 검사를 시뮬레이션한다: 각 방향에
대해 셀 블록을 지나는 모든 서브셀 라인을 평가하고, 각 라인의 윈도우는 셀 중심
최근접점 기준 span_m 길이로 잡는다. 중심 라인만 검사하면 라인 밖 결함이 감쇠
측정되므로(±1mm 게이트 위반) 전 라인을 스윕한다.
"""
from dataclasses import dataclass
import numpy as np
from flatness.core.straightedge import max_gap_under_straightedge

_SQRT2 = float(np.sqrt(2.0))


@dataclass
class CellResult:
    ix: int
    iy: int
    center_x: float
    center_y: float
    value_mm: float | None
    span_used_m: float
    occupancy: float
    worst_x: float | None
    worst_y: float | None


def _profile(residuals, ai, aj, di, dj, half_steps, step_m):
    """앵커 (aj,ai)에서 (dj,di) 방향 ±half_steps 프로파일. (위치, 높이, (iy,ix)) 반환."""
    ny, nx = residuals.shape
    pos, height, idx = [], [], []
    for k in range(-half_steps, half_steps + 1):
        i, j = ai + k * di, aj + k * dj
        if 0 <= i < nx and 0 <= j < ny and not np.isnan(residuals[j, i]):
            pos.append(k * step_m)
            height.append(float(residuals[j, i]))
            idx.append((j, i))
    return np.asarray(pos), np.asarray(height), idx


def _line_anchors(ci, cj, x0, x1, y0, y1, di, dj):
    """셀 블록 [x0,x1)×[y0,y1)을 지나는 (di,dj) 방향 라인들의 앵커 목록.

    앵커 = 각 라인 위에서 셀 중심 (ci,cj)에 가장 가까운 블록 내 서브셀.
    """
    anchors = []
    if (di, dj) == (1, 0):            # 행 라인: j 고정, 행마다 1개
        for j in range(y0, y1):
            anchors.append((ci, j))
    elif (di, dj) == (0, 1):          # 열 라인: i 고정
        for i in range(x0, x1):
            anchors.append((i, cj))
    elif (di, dj) == (1, 1):          # ↗ 대각: d = j - i 고정
        for d in range(y0 - (x1 - 1), (y1 - 1) - x0 + 1):
            i = max(x0, min(x1 - 1, int(round((ci + cj - d) / 2))))
            j = i + d
            if j < y0:
                j = y0; i = j - d
            elif j >= y1:
                j = y1 - 1; i = j - d
            if x0 <= i < x1:
                anchors.append((i, j))
    else:                              # ↘ 대각: s = j + i 고정
        for s in range(y0 + x0, (y1 - 1) + (x1 - 1) + 1):
            i = max(x0, min(x1 - 1, int(round((ci - cj + s) / 2))))
            j = s - i
            if j < y0:
                j = y0; i = s - j
            elif j >= y1:
                j = y1 - 1; i = s - j
            if x0 <= i < x1:
                anchors.append((i, j))
    return anchors


def evaluate_cells(residuals, grid, span_m, cell_m=1.0, min_occupancy=0.7, min_span_m=1.0):
    ny, nx = residuals.shape
    sub = grid.size_m
    ncx = max(1, int(np.ceil(nx * sub / cell_m)))
    ncy = max(1, int(np.ceil(ny * sub / cell_m)))
    per_cell = int(round(cell_m / sub))
    results = []
    dirs = [(1, 0, sub), (0, 1, sub), (1, 1, sub * _SQRT2), (1, -1, sub * _SQRT2)]
    for cy in range(ncy):
        for cx in range(ncx):
            x0, x1 = cx * per_cell, min(nx, (cx + 1) * per_cell)
            y0, y1 = cy * per_cell, min(ny, (cy + 1) * per_cell)
            ci = min(nx - 1, x0 + per_cell // 2)
            cj = min(ny - 1, y0 + per_cell // 2)
            center_x = grid.origin[0] + (ci + 0.5) * sub
            center_y = grid.origin[1] + (cj + 0.5) * sub
            # 셀 자체 점유율: 셀 영역 내 유효 서브셀 비율
            block = residuals[y0:y1, x0:x1]
            occupancy = float(np.count_nonzero(~np.isnan(block))) / max(1, block.size)
            best = None  # (심각도, gap_m, L_eff, (j,i))
            if occupancy >= min_occupancy:
                for di, dj, step in dirs:
                    half = int(round(span_m / 2 / step))
                    expected = 2 * half + 1
                    for ai, aj in _line_anchors(ci, cj, x0, x1, y0, y1, di, dj):
                        pos, height, idx = _profile(residuals, ai, aj, di, dj, half, step)
                        if len(pos) < 3:
                            continue
                        if len(pos) / expected < min_occupancy:
                            continue
                        L = float(pos.max() - pos.min())
                        if L < min_span_m:
                            continue
                        gap, wi = max_gap_under_straightedge(pos, height)
                        L_eff = min(L, span_m)
                        severity = gap / max(1e-9, L_eff / span_m)  # 환산 허용치 대비 비교용
                        if best is None or severity > best[0]:
                            best = (severity, gap, L_eff, idx[wi])
            if best is None:
                results.append(CellResult(cx, cy, center_x, center_y, None,
                                          0.0, occupancy, None, None))
            else:
                _, gap, L_eff, (wj, wi_) = best
                results.append(CellResult(
                    cx, cy, center_x, center_y, gap * 1000.0, L_eff, occupancy,
                    grid.origin[0] + (wi_ + 0.5) * sub, grid.origin[1] + (wj + 0.5) * sub))
    return results

"""구배(경사) 산출 — 2m 격자별로 서브셀 중앙값에 평면을 피팅해 기울기를 얻는다.

과업지시서 세부과업 4의 분석 단위는 2m x 2m다(평활도 판정셀 1m와 다르다).

원점군이 아니라 서브셀 중앙값에 피팅하는 이유:
  1. 노이즈가 중앙값 단계에서 이미 걸러진다
  2. 점 밀도 불균일의 영향이 사라진다. 원점군에 그대로 피팅하면 스캐너에 가까워
     점이 빽빽한 구역이 평면을 끌어당긴다. 서브셀 중앙값은 면적당 균등하다
  3. 계산량이 수천분의 1이다
"""
from dataclasses import dataclass
import math

import numpy as np

from flatness.core.plane import fit_plane_ransac


@dataclass
class SlopeCell:
    cx: int
    cy: int
    center_x: float
    center_y: float
    n_subcells: int
    slope_pct: float
    downhill_rad: float
    rmse_m: float
    se_pct: float
    ok: bool


def compute_slope_cells(grid, cell_m=2.0, min_subcells=10):
    """서브셀 격자를 cell_m 격자로 묶어 셀마다 구배를 산출한다.

    min_subcells: 평면이 수치적으로 결정되려면 최소 이만큼의 유효 서브셀이 필요하다.
    3점이면 수학적으로는 평면이 정해지지만 잔차와 표준오차가 무의미해진다.
    """
    ny, nx = grid.shape
    sub = grid.size_m
    per_cell = max(1, int(round(cell_m / sub)))
    ncx = max(1, int(math.ceil(nx / per_cell)))
    ncy = max(1, int(math.ceil(ny / per_cell)))

    # 서브셀 중심 좌표(절대 m). origin은 bbox_min의 xy다.
    xs = grid.origin[0] + (np.arange(nx) + 0.5) * sub
    ys = grid.origin[1] + (np.arange(ny) + 0.5) * sub

    out = []
    for cy in range(ncy):
        for cx in range(ncx):
            x0, x1 = cx * per_cell, min(nx, (cx + 1) * per_cell)
            y0, y1 = cy * per_cell, min(ny, (cy + 1) * per_cell)
            block = grid.median_z[y0:y1, x0:x1]
            valid = ~np.isnan(block)
            n = int(np.count_nonzero(valid))
            center_x = float(xs[min(nx - 1, (x0 + x1 - 1) // 2)])
            center_y = float(ys[min(ny - 1, (y0 + y1 - 1) // 2)])
            if n < min_subcells:
                out.append(SlopeCell(cx, cy, center_x, center_y, n,
                                     float("nan"), float("nan"), float("nan"),
                                     float("nan"), False))
                continue
            jj, ii = np.nonzero(valid)
            px = xs[x0:x1][ii].astype(np.float64)
            py = ys[y0:y1][jj].astype(np.float64)
            pz = block[valid].astype(np.float64)
            # 좌표가 한 줄로 늘어서면(퇴화) 평면이 결정되지 않는다
            sx, sy = float(np.std(px)), float(np.std(py))
            if sx <= 0.0 or sy <= 0.0:
                out.append(SlopeCell(cx, cy, center_x, center_y, n,
                                     float("nan"), float("nan"), float("nan"),
                                     float("nan"), False))
                continue
            try:
                a, b, c = fit_plane_ransac(px, py, pz)
            except ValueError:
                out.append(SlopeCell(cx, cy, center_x, center_y, n,
                                     float("nan"), float("nan"), float("nan"),
                                     float("nan"), False))
                continue
            # 잔차는 인라이어가 아니라 셀 안의 모든 유효 서브셀에 대해 잰다.
            # 결함이 있으면 RMSE가 커지고 그만큼 불확도도 커져 보수적으로 판정된다.
            resid = pz - (a * px + b * py + c)
            rmse = float(np.sqrt(np.mean(resid ** 2)))
            # 최소제곱 기울기의 표준오차. 크기의 오차는 두 성분 오차의 벡터합으로
            # 보수적으로 잡는다.
            se_a = rmse / (math.sqrt(n) * sx)
            se_b = rmse / (math.sqrt(n) * sy)
            se_pct = 100.0 * math.hypot(se_a, se_b)
            slope_pct = 100.0 * math.hypot(a, b)
            # (a, b)는 오르막 방향이다. 물은 내리막으로 흐르므로 부호를 뒤집는다.
            downhill = math.atan2(-b, -a)
            out.append(SlopeCell(cx, cy, center_x, center_y, n,
                                 slope_pct, downhill, rmse, se_pct, True))
    return out

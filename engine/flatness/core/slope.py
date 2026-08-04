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
    width_m: float
    height_m: float
    ok: bool
    zone_id: int | None = None   # 구역별 통계는 후속 단계. 스키마만 미리 뚫어 둔다


def compute_slope_cells(grid, cell_m=2.0, min_subcells=10):
    """서브셀 격자를 cell_m 격자로 묶어 셀마다 구배를 산출한다.

    min_subcells: 평면이 수치적으로 결정되려면 최소 이만큼의 유효 서브셀이 필요하다.
    3점이면 수학적으로는 평면이 정해지지만 잔차와 표준오차가 무의미해진다.

    바닥 폭이 cell_m의 배수가 아니면 가장자리에 폭이 좁은 조각 셀이 생긴다.
    개수(min_subcells)만으로는 이걸 못 걸러낸다 - 서브셀은 충분해도 실제 baseline이
    짧으면 서브셀 중앙값의 실제 위치와 가정한 중심의 불일치가 평균되지 않고 편향으로
    남는다(짧은 baseline일수록 이 편향이 커진다). 그래서 폭 하한을 개수 검사와 함께
    건다: 폭이든 높이든 cell_m/2 미만이면 판정할 만큼의 baseline이 없다고 보고
    ok=False로 뺀다.
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
            width_m = (x1 - x0) * sub
            height_m = (y1 - y0) * sub
            block = grid.median_z[y0:y1, x0:x1]
            valid = ~np.isnan(block)
            n = int(np.count_nonzero(valid))
            center_x = float(xs[min(nx - 1, (x0 + x1 - 1) // 2)])
            center_y = float(ys[min(ny - 1, (y0 + y1 - 1) // 2)])
            geom_ok = width_m >= cell_m / 2 and height_m >= cell_m / 2
            if n < min_subcells or not geom_ok:
                out.append(SlopeCell(cx, cy, center_x, center_y, n,
                                     float("nan"), float("nan"), float("nan"),
                                     float("nan"), width_m, height_m, False))
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
                                     float("nan"), width_m, height_m, False))
                continue
            try:
                a, b, c = fit_plane_ransac(px, py, pz)
            except ValueError:
                out.append(SlopeCell(cx, cy, center_x, center_y, n,
                                     float("nan"), float("nan"), float("nan"),
                                     float("nan"), width_m, height_m, False))
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
                                 slope_pct, downhill, rmse, se_pct,
                                 width_m, height_m, True))
    return out


GRADE_PASS = "적합"
GRADE_BORDER = "경계"
GRADE_REPAIR = "보수"
GRADE_REDO = "재시공"
GRADE_NA = "판정불가"


def _angle_diff(a, b):
    """두 각의 최소 차이(0~pi)."""
    d = abs(a - b) % (2 * math.pi)
    return d if d <= math.pi else 2 * math.pi - d


def grade_slope_cells(cells, threshold, drain_points=None, cell_m=2.0):
    """셀별 구배를 설계기준과 대조해 등급을 매긴다(스펙 5.2).

    불확도를 더하고 빼는 방향에 주의한다. 적합은 불확도를 감안해도 확실히 안쪽일
    때만 주고(d + u), 재시공은 확실히 바깥일 때만 준다(d - u). 그 사이는 경계로
    남긴다 - 데이터가 단정을 허락하지 않는데 단정하면 안 된다.
    """
    design = float(threshold["design_pct"])
    pass_pct = float(threshold["pass_pct"])
    re_pct = float(threshold["re_pct"])
    dir_pass = float(threshold["dir_pass_deg"])
    out = []
    for c in cells:
        if not c.ok:
            # 격자 가장자리 조각 셀(폭·높이가 cell_m/2 미만)인지, 아니면 유효 서브셀
            # 자체가 부족한지 구분해 사유를 정확히 남긴다.
            if c.width_m < cell_m / 2 or c.height_m < cell_m / 2:
                reason = "격자 가장자리 조각 셀(폭 또는 높이가 부족해 baseline 짧음)"
            else:
                reason = "유효 서브셀 부족"
            out.append({"cell": c, "grade": GRADE_NA, "reason": reason,
                        "dev_pct": float("nan"), "dir_err_deg": None,
                        "correction_mm": float("nan")})
            continue
        u = c.se_pct
        if u > pass_pct:
            out.append({"cell": c, "grade": GRADE_NA,
                        "reason": "측정 불확도가 허용치보다 커서 가릴 해상도가 없음",
                        "dev_pct": abs(c.slope_pct - design), "dir_err_deg": None,
                        "correction_mm": float("nan")})
            continue
        d = abs(c.slope_pct - design)
        # 양단 높이차로 환산: 구배 1%p = 셀 길이의 1% = 길이(m)*10 mm.
        # 셀의 실제 폭·높이(width_m/height_m)로 환산해야 한다 - 명목 cell_m을 쓰면
        # 가장자리에서 다소 잘린 셀(문턱은 넘었지만 나온 cell_m보다 작은 셀)의
        # 보정량이 과대 보고된다.
        correction_mm = d * min(c.width_m, c.height_m) * 10.0
        dir_err = None
        if drain_points:
            # 기대 방향: 셀 중심에서 가장 가까운 배수구를 향하는 방향
            best = min(drain_points,
                       key=lambda p: (p[0] - c.center_x) ** 2 + (p[1] - c.center_y) ** 2)
            expect = math.atan2(best[1] - c.center_y, best[0] - c.center_x)
            dir_err = math.degrees(_angle_diff(c.downhill_rad, expect))
            if dir_err > 90.0:
                out.append({"cell": c, "grade": GRADE_REDO,
                            "reason": "역구배(물이 배수구 반대로 흐름)",
                            "dev_pct": d, "dir_err_deg": dir_err,
                            "correction_mm": correction_mm})
                continue
        if d - u > re_pct:
            grade, reason = GRADE_REDO, "설계 구배와의 편차가 재시공 기준을 넘음"
        elif d + u <= pass_pct and (dir_err is None or dir_err <= dir_pass):
            grade, reason = GRADE_PASS, "크기·방향 모두 허용 안"
        elif d - u > pass_pct or (dir_err is not None and dir_err > dir_pass):
            grade, reason = GRADE_REPAIR, "허용을 벗어났으나 국소 보정 가능"
        else:
            grade, reason = GRADE_BORDER, "불확도 폭이 허용 경계를 걸쳐 단정 불가"
        out.append({"cell": c, "grade": grade, "reason": reason, "dev_pct": d,
                    "dir_err_deg": dir_err, "correction_mm": correction_mm})
    return out


def slope_summary(graded):
    """구간별 편차 통계(과업지시서 11쪽: 평균·표준편차·최대편차).

    판정 불가 셀은 통계에서 제외한다. 편차가 nan이라 넣으면 전체가 nan이 되고,
    무엇보다 "잴 수 없었던 것"을 "편차 0"처럼 섞으면 결과가 왜곡된다.

    valid가 비면(전 셀 판정불가) nan 대신 None을 반환한다 - stats.py의 build_stats와
    같은 관례다. float("nan")은 RFC 8259 표준 JSON 토큰이 아니라서 json.dump가
    기본값으로 내보내면 브라우저 JSON.parse·Postgres jsonb가 거부한다.
    """
    counts = {GRADE_PASS: 0, GRADE_BORDER: 0, GRADE_REPAIR: 0,
              GRADE_REDO: 0, GRADE_NA: 0}
    devs = []
    for g in graded:
        counts[g["grade"]] = counts.get(g["grade"], 0) + 1
        if g["grade"] != GRADE_NA:
            devs.append(g["dev_pct"])
    total = len(graded)
    decided = total - counts[GRADE_NA]
    arr = np.asarray(devs, dtype=np.float64)
    return {
        "mean_dev_pct": float(arr.mean()) if arr.size else None,
        "std_dev_pct": float(arr.std(ddof=0)) if arr.size else None,
        "max_dev_pct": float(arr.max()) if arr.size else None,
        "counts": counts,
        "coverage_pct": (100.0 * decided / total) if total else 0.0,
    }

"""임포트 경로(CSV/JSON) 공용 파이프라인.

두 경로(colab_csv.py, json_import.py) 모두 "이미 평면 제거가 끝난 편차값"을
입력받아 서브셀 중앙값 -> 직선자 셀 판정 기계에 그대로 태운다는 점이 동일하다
(docs/contracts/stats-schema.md §7 "두 임포트 경로 모두 최종적으로 동일한
파이프라인에 합류"). 이 모듈은 그 공용 부분을 한 곳에 모아, 포맷별 파서
(colab_csv._load / json_import._load)만 갈라지고 판정 로직은 절대 갈라지지
않도록 한다 — 같은 데이터를 CSV/JSON 두 경로로 각각 임포트하면 (meta의
포맷별 표기 차이를 제외하고) 동등한 stats가 나와야 한다는 계약을 코드
구조로 보장한다.
"""
import numpy as np

from flatness.io.reader import CloudInfo
from flatness.core.subcell import build_subcell_grid
from flatness.core.cells import evaluate_cells
from flatness.criteria import grade_cells
from flatness.outputs.stats import build_stats, write_outputs
from flatness.outputs.heatmap import render_heatmap
from flatness.outputs.summary import generate_summary


def run_import_pipeline(pts, criterion, u_mm, out_dir, meta, subcell_m=0.05, cell_m=1.0):
    """공용 임포트 파이프라인.

    `pts`: (N, 3) ndarray — [x_m, y_m, deviation_m](이미 평면 제거 완료, m 단위).
    `meta`: 호출자가 채운 stats.meta 딕셔너리(포맷별 file/engine_version/source 등).
    `n_points`/`surface`/`subcell_m`/`cell_m`은 이 함수가 채워 넣는다(호출자가
    중복 지정할 필요 없음).
    """
    info = CloudInfo(len(pts), pts.min(axis=0), pts.max(axis=0))
    grid = build_subcell_grid(iter([pts]), info, 1.0, subcell_m=subcell_m)
    if int(np.isfinite(grid.median_z).sum()) < 10:
        raise ValueError("유효 서브셀 부족: 임포트 데이터 확인 필요")
    residuals = (grid.median_z - np.nanmedian(grid.median_z)).astype(np.float32)
    span = criterion.span_m if criterion.span_m else 3.0
    cells = evaluate_cells(residuals, grid, span_m=span, cell_m=cell_m)
    grades, warns = grade_cells(cells, criterion, u_mm)
    full_meta = {"n_points": len(pts), "surface": "floor",
                 "subcell_m": subcell_m, "cell_m": cell_m, **meta}
    stats = build_stats(cells, grades, criterion, u_mm, sorted(set(warns)), full_meta)
    stats["auto_summary"] = generate_summary(stats)
    write_outputs(out_dir, stats, cells, grades)
    render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
    return stats

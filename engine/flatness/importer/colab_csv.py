"""기존 Colab 노트북 결과 CSV 임포트 (스펙 §5.4 — 과업지시서 '분석 결과 자동 불러오기').

Signed_Distance_mm는 기존 프로그램이 이미 평면 제거한 편차이므로 재분석 없이
서브셀 중앙값 → 직선자 셀 판정 기계에 직접 태운다.
"""
import csv as _csv
import numpy as np
from flatness import ENGINE_VERSION  # noqa: F401  (버전 대비 참조용)
from flatness.io.reader import CloudInfo
from flatness.core.subcell import build_subcell_grid
from flatness.core.cells import evaluate_cells
from flatness.criteria import grade_cells
from flatness.outputs.stats import build_stats, write_outputs
from flatness.outputs.heatmap import render_heatmap
from flatness.outputs.summary import generate_summary


def _load(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = _csv.DictReader(f)
        cols = reader.fieldnames or []
        need = {"X", "Y", "Signed_Distance_mm"}
        if not need.issubset(set(cols)):
            raise ValueError("Colab CSV 형식 아님: X,Y,Signed_Distance_mm 컬럼 필요")
        xs, ys, ss = [], [], []
        for row in reader:
            try:
                x, y, s = float(row["X"]), float(row["Y"]), float(row["Signed_Distance_mm"])
            except (ValueError, TypeError):
                continue
            if not (np.isfinite(x) and np.isfinite(y) and np.isfinite(s)):
                continue
            xs.append(x); ys.append(y); ss.append(s)
    if not xs:
        raise ValueError("Colab CSV에 유효 행 없음")
    return np.column_stack([xs, ys, np.asarray(ss) / 1000.0])  # 편차를 m로


def import_colab_csv(path, criterion, u_mm, out_dir, subcell_m=0.05, cell_m=1.0):
    pts = _load(path)
    info = CloudInfo(len(pts), pts.min(axis=0), pts.max(axis=0))
    grid = build_subcell_grid(iter([pts]), info, 1.0, subcell_m=subcell_m)
    if int(np.isfinite(grid.median_z).sum()) < 10:
        raise ValueError("유효 서브셀 부족: 임포트 데이터 확인 필요")
    residuals = (grid.median_z - np.nanmedian(grid.median_z)).astype(np.float32)
    span = criterion.span_m if criterion.span_m else 3.0
    cells = evaluate_cells(residuals, grid, span_m=span, cell_m=cell_m)
    grades, warns = grade_cells(cells, criterion, u_mm)
    meta = {"file": str(path), "n_points": len(pts), "engine_version": "external-colab-v1",
            "surface": "floor", "source": "colab-import", "subcell_m": subcell_m, "cell_m": cell_m}
    stats = build_stats(cells, grades, criterion, u_mm, sorted(set(warns)), meta)
    out_dir.mkdir(parents=True, exist_ok=True)
    stats["auto_summary"] = generate_summary(stats)
    write_outputs(out_dir, stats, cells, grades)
    render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
    return stats

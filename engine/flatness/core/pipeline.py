"""바닥 분석 오케스트레이션 — 1a: 단일 구역 가정(스펙 §11 P1 슬라이스)."""
import numpy as np
from flatness.io.reader import iter_chunks, read_info
from flatness.core.subcell import build_subcell_grid
from flatness.core.plane import fit_plane_ransac, residual_grid
from flatness.core.cells import evaluate_cells
from flatness.criteria import grade_cells
from flatness.outputs.stats import build_stats, write_outputs
from flatness.outputs.heatmap import render_heatmap


def analyze_floor(path, scale_to_m, criterion, u_mm, out_dir,
                  subcell_m=0.05, cell_m=1.0, chunk_size=2_000_000):
    info = read_info(path, chunk_size=chunk_size)          # 1차 패스: bbox·개수
    grid = build_subcell_grid(iter_chunks(path, chunk_size=chunk_size),
                              info, scale_to_m, subcell_m)  # 2차 패스: 비닝
    ys, xs = np.nonzero(~np.isnan(grid.median_z))
    if len(xs) < 10:
        raise ValueError("유효 서브셀 부족 — 바닥 미검출")
    cx = grid.origin[0] + (xs + 0.5) * grid.size_m
    cy = grid.origin[1] + (ys + 0.5) * grid.size_m
    abc = fit_plane_ransac(cx, cy, grid.median_z[ys, xs].astype(float))
    residuals = residual_grid(grid, abc)
    span = criterion.span_m if criterion.span_m else 3.0
    cells = evaluate_cells(residuals, grid, span_m=span, cell_m=cell_m)
    grades, warns = grade_cells(cells, criterion, u_mm)
    meta = {"file": str(path), "n_points": info.n_points, "scale_to_m": scale_to_m,
            "subcell_m": subcell_m, "cell_m": cell_m, "engine_version": "p1a-0.1.0"}
    stats = build_stats(cells, grades, criterion, u_mm, warns, meta)
    write_outputs(out_dir, stats, cells, grades)
    render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
    return stats

"""바닥 분석 오케스트레이션 v2 — 다중 구역·품질 마스크 (스펙 §5.1.3~4, P1b)."""
import numpy as np
from flatness.io.reader import iter_chunks, read_info
from flatness.core.subcell import build_subcell_grid
from flatness.core.levels import detect_levels
from flatness.core.zones import build_zones
from flatness.core.cells import evaluate_cells
from flatness.criteria import grade_cells
from flatness.outputs.stats import build_stats, write_outputs
from flatness.outputs.heatmap import render_heatmap


def analyze_floor(path, scale_to_m, criterion, u_mm, out_dir,
                  subcell_m=0.05, cell_m=1.0, chunk_size=2_000_000):
    info = read_info(path, chunk_size=chunk_size)
    grid = build_subcell_grid(iter_chunks(path, chunk_size=chunk_size),
                              info, scale_to_m, subcell_m)
    n_valid_sub = int(np.isfinite(grid.median_z).sum())
    if n_valid_sub < 10:
        raise ValueError("유효 서브셀 부족: 바닥 미검출")
    levels = detect_levels(grid.median_z)
    zmap, residuals = build_zones(grid, levels)
    ok_zones = [z for z in zmap.zones if z.status == "ok"]
    if not ok_zones:
        raise ValueError("판정 가능한 바닥 구역 없음: 재스캔 또는 파라미터 확인 필요")
    span = criterion.span_m if criterion.span_m else 3.0
    cells = evaluate_cells(residuals, grid, span_m=span, cell_m=cell_m,
                           zone_labels=zmap.labels)
    grades, warns = grade_cells(cells, criterion, u_mm)
    warns = list(warns)
    if bool(grid.bimodal.any()):
        warns.append("ghost_layer_rescan")
    if any(z.status == "furniture" for z in zmap.zones):
        warns.append("furniture_excluded")
    if any(z.status == "ghost" for z in zmap.zones):
        warns.append("ghost_zone_excluded")
    ok_sub = sum(z.n_subcells for z in ok_zones)
    coverage = round(100.0 * ok_sub / n_valid_sub, 1)  # 바닥 인식 비율 (스펙 §5.1.3)
    zones_out = [{"zone_id": z.zone_id, "level_m": round(z.level_m, 3),
                  "area_m2": round(z.area_m2, 2), "status": z.status,
                  "plane_abc": None if z.plane_abc is None else [round(v, 6) for v in z.plane_abc]}
                 for z in zmap.zones]
    meta = {"file": str(path), "n_points": info.n_points, "scale_to_m": scale_to_m,
            "subcell_m": subcell_m, "cell_m": cell_m, "engine_version": "p1b-0.2.0"}
    stats = build_stats(cells, grades, criterion, u_mm, sorted(set(warns)), meta,
                        zones=zones_out, coverage_pct=coverage)
    write_outputs(out_dir, stats, cells, grades)
    render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
    return stats

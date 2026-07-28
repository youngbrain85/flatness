"""stats.json / cells.json / results.csv 산출 (스펙 §5.1.7 필수 필드)."""
import csv
import json
import numpy as np

_CSV_FIELDS = ["ix", "iy", "center_x", "center_y", "value_mm", "span_used_m", "occupancy", "grade", "worst_x", "worst_y"]


def build_stats(cells, grades, crit, u_mm, warnings, meta, zones=None):
    valid = [c for c in cells if c.value_mm is not None]
    counts = {k: 0 for k in ("pass", "borderline", "repair", "rework", "na")}
    for g in grades:
        counts[g if g is not None else "na"] += 1
    worst = max(valid, key=lambda c: c.value_mm) if valid else None
    n = len(cells)
    # 통계: valid가 비면 None (worst와 일관)
    if valid:
        vals = np.array([c.value_mm for c in valid])
        value_max = round(float(vals.max()), 2)
        value_min = round(float(vals.min()), 2)
        value_mean = round(float(vals.mean()), 2)
        value_p95 = round(float(np.percentile(vals, 95)), 2)
    else:
        value_max = None
        value_min = None
        value_mean = None
        value_p95 = None
    return {
        "n_cells": n,
        "n_valid": len(valid),
        "grade_counts": counts,
        "grade_pct": {k: round(100 * v / n, 1) for k, v in counts.items()} if n else {k: 0.0 for k in counts},
        "value_max_mm": value_max,
        "value_min_mm": value_min,
        "value_mean_mm": value_mean,
        "value_p95_mm": value_p95,
        "worst": None if worst is None else {
            "value_mm": round(worst.value_mm, 2), "cell_ix": worst.ix, "cell_iy": worst.iy,
            "point_x": worst.worst_x, "point_y": worst.worst_y},
        "coverage_pct": round(100 * len(valid) / n, 1) if n else 0.0,
        "reduced_span_cells": sum(1 for c in valid if c.span_used_m < (crit.span_m or 0)),
        "applied_criteria": {"name": crit.name, "source": crit.source, "span_m": crit.span_m,
                             "pass_mm": crit.pass_mm, "rework_mm": crit.rework_mm, "u_mm": u_mm},
        "warnings": list(warnings),
        "meta": meta,
        "zones": zones or [],
    }


def _cell_row(c, g):
    return {"ix": c.ix, "iy": c.iy, "center_x": round(c.center_x, 3),
            "center_y": round(c.center_y, 3),
            "value_mm": None if c.value_mm is None else round(c.value_mm, 2),
            "span_used_m": round(c.span_used_m, 2), "occupancy": round(c.occupancy, 2),
            "grade": g if g is not None else "na",
            "worst_x": None if c.worst_x is None else round(c.worst_x, 3),
            "worst_y": None if c.worst_y is None else round(c.worst_y, 3)}


def write_outputs(out_dir, stats, cells, grades):
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = [_cell_row(c, g) for c, g in zip(cells, grades)]
    (out_dir / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "cells.json").write_text(
        json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    with open(out_dir / "results.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=_CSV_FIELDS)
        w.writeheader()
        w.writerows(rows)

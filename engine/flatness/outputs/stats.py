"""stats.json / cells.json / results.csv 산출 (스펙 §5.1.7 필수 필드)."""
import csv
import json
import numpy as np

_CSV_FIELDS = ["ix", "iy", "center_x", "center_y", "value_mm", "span_used_m", "occupancy", "grade", "worst_x", "worst_y", "zone_id"]


def build_stats(cells, grades, crit, u_mm, warnings, meta, zones=None, coverage_pct=None):
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
            "point_x": worst.worst_x, "point_y": worst.worst_y, "zone_id": worst.zone_id},
        "coverage_pct": (round(float(coverage_pct), 1) if coverage_pct is not None
                         else (round(100 * len(valid) / n, 1) if n else 0.0)),
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
            "worst_y": None if c.worst_y is None else round(c.worst_y, 3),
            "zone_id": c.zone_id}


# 판정 셀 비교 크기(스펙 2·3 §1): 공식 판정은 0.5m, 1·2m 는 화면 비교용
ALT_CELL_SIZES = (1.0, 2.0)
CELLS_ALT_FILE = "cells_alt.json"
RESIDUAL_GRID_FILE = "residual_grid.json"
REFERENCE_SURFACES_FILE = "reference_surfaces.json"
REFERENCE_NODE_CELLS = 5    # 기준면 마디 = 서브셀 5x5 묶음(5cm 서브셀이면 25cm)


def _q01(arr):
    """m 단위 배열 -> 0.1mm 정수 목록(값 없음 null). 원소별 isfinite 호출 없이 파이썬 int 객체로 바꾼다."""
    q = np.round(np.asarray(arr, dtype=np.float64) * 10000.0).ravel()
    finite = np.isfinite(q)
    vals = np.where(finite, q, 0.0).astype(np.int64).astype(object)
    vals[~finite] = None
    return vals.tolist()


def write_cells_alt(out_dir, by_size):
    """{셀 크기(m): (cells, grades)} -> cells_alt.json. 셀 행 모양은 cells.json 과 같다."""
    doc = {"by_size": {str(float(size)): [_cell_row(c, g) for c, g in zip(cells, grades)]
                       for size, (cells, grades) in by_size.items()}}
    (out_dir / CELLS_ALT_FILE).write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    return CELLS_ALT_FILE


def write_residual_grid(out_dir, local, global_, subcell_m):
    """서브셀 편차(m) -> residual_grid.json schema_version 2 (바닥 기준면 개선 스펙 §3).

    values = 국부(3m) 기준 편차, values_global = 전체 기준면 편차. 0.1mm 정수, 값 없는 칸은 null,
    행 우선이며 행 0 이 y 가 가장 작은 쪽이다(엔진 격자 그대로). values_global 이 없는 옛 파일은 구역 평면 기준이다.
    """
    doc = {"schema_version": 2, "subcell_m": subcell_m, "cols": int(local.shape[1]), "rows": int(local.shape[0]),
           "values": _q01(local), "values_global": _q01(global_)}
    (out_dir / RESIDUAL_GRID_FILE).write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    return RESIDUAL_GRID_FILE


def _reference_nodes(ref, labels, k):
    """서브셀 기준 높이를 k x k 묶음 마디로 줄인다. 마디 값 = 묶음 가운데 칸 값, 가운데 칸이 비면(가장자리)
    묶음 안에서 가장 많은 구역의 칸 평균(단차를 사이에 둔 두 면을 섞지 않는다). 바닥이 없는 묶음은 NaN."""
    ny, nx = ref.shape
    rows, cols = -(-ny // k), -(-nx // k)
    cy = np.minimum(np.arange(rows) * k + k // 2, ny - 1)
    cx = np.minimum(np.arange(cols) * k + k // 2, nx - 1)
    out = ref[np.ix_(cy, cx)].astype(np.float64)
    pad = np.full((rows * k, cols * k), np.nan)
    pad[:ny, :nx] = ref
    has = np.isfinite(pad).reshape(rows, k, cols, k).any(axis=(1, 3))
    for j, i in zip(*np.nonzero(np.isnan(out) & has)):
        blk = ref[j * k:(j + 1) * k, i * k:(i + 1) * k]
        lab = labels[j * k:(j + 1) * k, i * k:(i + 1) * k]
        ok = np.isfinite(blk)
        ids, cnt = np.unique(lab[ok], return_counts=True)
        out[j, i] = blk[ok & (lab == ids[np.argmax(cnt)])].mean()
    return out


def write_reference_surfaces(out_dir, ref_local, ref_global, labels, subcell_m, origin_m):
    """두 기준면 높이(m, 서브셀 격자) -> reference_surfaces.json (바닥 기준면 개선 스펙 §3).

    마디 간격 step_m = 서브셀 x 5. 마디 (i, j) 위치 = ((i + 0.5) x step, (j + 0.5) x step), 좌표틀은 points3d 와 같은
    파일-로컬(x·y 원점 = 서브셀 격자 원점, z 원점 = bbox 최저 z). 높이는 0.1mm 정수, 바닥이 아닌 마디는 null.
    origin_m = 그 원점의 절대 좌표(m, bbox 최소 x scale). 3D 뷰어는 points3d 의 origin_m 을 빼서 점 좌표틀에 놓는다.
    """
    k = REFERENCE_NODE_CELLS
    local = _reference_nodes(ref_local, labels, k)
    glob = _reference_nodes(ref_global, labels, k)
    doc = {"step_m": round(subcell_m * k, 6), "cols": int(local.shape[1]), "rows": int(local.shape[0]),
           "origin_m": [float(v) for v in origin_m], "local": _q01(local), "global": _q01(glob)}
    (out_dir / REFERENCE_SURFACES_FILE).write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    return REFERENCE_SURFACES_FILE


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

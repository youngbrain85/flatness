"""바닥 분석 오케스트레이션 v2 — 다중 구역·품질 마스크 (스펙 §5.1.3~4, P1b)."""
from dataclasses import replace as _dc_replace
import math
import numpy as np
from flatness import ENGINE_VERSION
from flatness.io.reader import iter_chunks, read_info
from flatness.core.subcell import build_subcell_grid
from flatness.core.levels import detect_levels
from flatness.core.zones import build_zones
from flatness.core.cells import evaluate_cells
from flatness.core.walls import (build_column_grid, detect_wall_lines,
                                 project_wall_points, wall_grid, evaluate_wall)
from flatness.core.plane import residual_grid
from flatness.criteria import grade_cells
from flatness.outputs.stats import build_stats, write_outputs
from flatness.outputs.heatmap import render_heatmap
from flatness.outputs.deviation import render_deviation_map
from flatness.outputs.preview3d import render_preview3d
from flatness.outputs.summary import generate_summary


def _r(v, nd=3):
    """nan은 빈 문자열로, 그 외는 반올림해 CSV 셀 값으로 쓴다."""
    return "" if v is None or (isinstance(v, float) and math.isnan(v)) else round(v, nd)


def _deg(rad):
    """라디안을 도(반올림)로 바꾼다. nan은 빈 문자열."""
    return "" if rad is None or math.isnan(rad) else round(math.degrees(rad), 1)


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
    if coverage < 70.0:
        warns.append("low_coverage")  # 바닥 인식률 저하(티켓 14, 스펙 §5.3)
    zones_out = [{"zone_id": z.zone_id, "level_m": round(z.level_m, 3),
                  "area_m2": round(z.area_m2, 2), "status": z.status,
                  "plane_abc": None if z.plane_abc is None else [round(v, 6) for v in z.plane_abc]}
                 for z in zmap.zones]
    meta = {"file": str(path), "n_points": info.n_points, "scale_to_m": scale_to_m,
            "subcell_m": subcell_m, "cell_m": cell_m, "engine_version": ENGINE_VERSION,
            "surface": "floor",
            "bbox_min": [round(float(v), 4) for v in (info.bbox_min * scale_to_m)]}
    stats = build_stats(cells, grades, criterion, u_mm, sorted(set(warns)), meta,
                        zones=zones_out, coverage_pct=coverage)
    stats["auto_summary"] = generate_summary(stats)
    out_dir.mkdir(parents=True, exist_ok=True)
    worst = stats.get("worst")
    # 렌더 산출물(프리뷰/편차맵/히트맵)은 판정 결과와 무관한 보조 시각화다. 렌더가
    # 디스크·폰트 등 인프라 사유로 실패해도 이미 완성된 판정(stats)은 반드시 저장돼야
    # 하므로, 렌더 호출을 예외로부터 격리하고 실패는 warnings로만 남긴다.
    render_warns = set()
    try:
        stats["preview3d_paths"] = render_preview3d(
            residuals, grid, out_dir,
            worst_xy=None if worst is None else (worst["point_x"], worst["point_y"]))
    except Exception:
        stats["preview3d_paths"] = []
        render_warns.add("preview3d_render_failed")
    try:
        # 정밀 편차맵(판정 무관 보조 시각화): 판정에 쓴 잔차를 10cm로 접어 다시 그린다
        dev = render_deviation_map(residuals, grid, out_dir / "deviation.png")
        stats["deviation_paths"] = [dev] if dev else []
    except Exception:
        stats["deviation_paths"] = []
        render_warns.add("deviation_render_failed")
    try:
        render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
    except Exception:
        render_warns.add("heatmap_render_failed")
    if render_warns:
        stats["warnings"] = sorted(set(stats["warnings"]) | render_warns)
    write_outputs(out_dir, stats, cells, grades)
    return stats


def analyze_wall(path, scale_to_m, criterion, u_mm, out_dir,
                 subcell_m=0.05, cell_m=1.0, chunk_size=2_000_000):
    """벽면 분석 오케스트레이션 — 벽 검출 → 벽별 투영·판정 → 통합 stats (스펙 §5.1.8)."""
    info = read_info(path, chunk_size=chunk_size)
    cols = build_column_grid(iter_chunks(path, chunk_size=chunk_size), info, scale_to_m)
    zmin2d, zmax2d, cnt2d, cnt_mid2d, origin, _ = cols
    walls = detect_wall_lines(zmin2d, zmax2d, cnt2d, cnt_mid2d, origin, 0.05)
    if not walls:
        raise ValueError("벽면 미검출: 스캔 범위 또는 파라미터 확인")
    out_dir.mkdir(parents=True, exist_ok=True)
    all_cells, all_grades, walls_out, deviation_names = [], [], [], []
    warns = {"plumbness_relative_to_z"}  # z-up 기준 상대 수직도 고지(스펙 §5.1.8)
    for i, wall in enumerate(walls, 1):
        try:
            uvw = project_wall_points(iter_chunks(path, chunk_size=chunk_size),
                                      info, scale_to_m, wall)
            grid = wall_grid(uvw, subcell_m=subcell_m)
            if int(np.isfinite(grid.median_z).sum()) < 10:
                warns.add(f"wall_{i}_skipped")  # 점이 희박한 파편 벽은 건너뜀
                continue
            cells, grades, w, wm = evaluate_wall(grid, criterion, u_mm, cell_m=cell_m)
        except ValueError:
            warns.add(f"wall_{i}_skipped")  # 벽별 실패 격리(티켓 17): 성한 벽 결과는 보존
            continue
        cells = [_dc_replace(c, zone_id=i) for c in cells]
        # 렌더 호출은 벽별 격리 블록(위 try/except ValueError) 밖으로 옮기고 별도로
        # 감싼다: 렌더 실패는 인프라 사유(디스크·폰트 등)이지 이 벽의 판정과 무관하므로
        # 이미 산출된 이 벽의 cells/grades까지 날려서는 안 되고(티켓 17 원칙), 다음
        # 벽 처리에도 전파돼선 안 된다.
        try:
            render_heatmap(cells, grades, out_dir / f"heatmap_wall{i}.png", cell_m=cell_m)
        except Exception:
            warns.add("heatmap_render_failed")
        try:
            # 판정에 쓴 벽 평면 계수(stats에 실리는 6자리 반올림값)로 잔차를 다시 만들어 그린다.
            # evaluate_wall의 반환 시그니처를 바꾸지 않기 위한 선택 — 반올림 오차는 0.01mm 미만이다.
            dev = render_deviation_map(
                residual_grid(grid, tuple(wm["plane_abc"])), grid,
                out_dir / f"deviation_wall{i}.png",
                title=f"벽 {i} 정밀 편차맵 (10cm 해상도)",
                xlabel="벽 길이 u (m)", ylabel="높이 v (m)",
                cbar_label="편차 (mm), + 돌출 / - 함몰")
            if dev:
                deviation_names.append(dev)
        except Exception:
            warns.add("deviation_render_failed")
        all_cells.extend(cells)
        all_grades.extend(grades)
        warns.update(w)
        walls_out.append({"wall_id": i, "n_cells": len(cells),
                          "frame": {"p0": [round(float(v), 4) for v in wall.p0],
                                    "direction": [round(float(v), 4) for v in wall.direction],
                                    "normal": [round(float(v), 4) for v in wall.normal],
                                    "u_min": round(wall.u_min, 4), "u_max": round(wall.u_max, 4),
                                    "z_min": round(wall.z_min, 4), "z_max": round(wall.z_max, 4)},
                          **wm})
    if not walls_out:
        raise ValueError("벽면 미검출: 유효 점이 있는 벽 없음")
    meta = {"file": str(path), "n_points": info.n_points, "scale_to_m": scale_to_m,
            "subcell_m": subcell_m, "cell_m": cell_m, "engine_version": ENGINE_VERSION,
            "surface": "wall",
            "bbox_min": [round(float(v), 4) for v in (info.bbox_min * scale_to_m)]}
    stats = build_stats(all_cells, all_grades, criterion, u_mm, sorted(warns), meta)
    stats["walls"] = walls_out
    stats["deviation_paths"] = deviation_names
    stats["auto_summary"] = generate_summary(stats)
    write_outputs(out_dir, stats, all_cells, all_grades)
    return stats


def judge_slope_cells(cells, threshold, out_dir, cell_m, drain_points=None,
                      subcell_m=0.05, cells_json_path=None):
    """이미 산출된 셀 벡터 + 배수구 좌표로 판정만 다시 한다(점군 미열람, 스펙 §7.3).

    analyze_slope의 판정~산출물 단계(grade -> summary -> csv -> png -> stats.json)를
    그대로 옮긴 것이다 - 재판정 잡(slope_judge)이 slope_cells.json에서 복원한
    cells를 이 함수에 바로 넘기면 점군을 다시 읽지 않고 몇 초 안에 끝난다.

    cell_m은 기본값 없는 필수 인자다(Task 1 리뷰 I1). grade_slope_cells의 조각
    셀 판정불가 사유 분기(`width_m < cell_m/2`)와 render_slope_map의 화살표
    길이가 전부 cell_m에 의존하는데, 기본값이 있으면 재판정 호출부가 원 분석과
    다른 cell_m(예: --cell 4.0으로 분석한 것을 fallback 2.0으로 재판정)을 조용히
    쓸 수 있다 - CSV 근사 복원을 배제한 바로 그 결함(D1)이 JSON 경로에서
    재현되는 것이다. 필수 인자로 만들면 잊었을 때 즉시 TypeError로 드러난다.
    호출부는 `load_slope_cells`가 돌려주는 meta["cell_m"]을 그대로 넘기면 된다.

    slope_cells.json은 이 함수가 새로 쓰지 않는다. 호출자(analyze_slope 또는
    재판정 잡)가 이미 그 파일에서 cells를 얻었거나 직접 만들었으므로 여기서 다시
    쓸 이유가 없다 - 재판정마다 무손실 원본을 덮어쓰면 입력 자체가 흔들릴 위험만
    생긴다. cells_json_path를 주면 artifacts.cells_json에 그 경로를 그대로
    싣는다(analyze_slope가 dump_slope_cells에 쓴 경로와 동일한 값을 넘긴다).
    안 주면 out_dir 관례(slope_cells.json)로 추정하지만, 이 함수 자신은 그
    파일을 로컬에서 열어 보지 않으므로 실제로 거기 있다는 보장은 호출자 책임이다
    (Task 1 리뷰 M4 - 재판정의 out_dir에는 로컬에 csv/png/stats만 새로 생기고
    slope_cells.json은 스토리지에서 온 것일 수 있어, 경로를 호출자가 알면
    그대로 넘기는 편이 관례 추정보다 안전하다).
    """
    import csv
    import json
    import os
    from collections import Counter

    from flatness.core.slope import GRADE_NA, grade_slope_cells, slope_summary
    from flatness.outputs.slope_map import render_slope_map

    os.makedirs(out_dir, exist_ok=True)
    if cells_json_path is None:
        cells_json_path = os.path.join(out_dir, "slope_cells.json")
    graded = grade_slope_cells(cells, threshold, drain_points=drain_points,
                               cell_m=cell_m)
    summary = slope_summary(graded)

    csv_path = os.path.join(out_dir, "slope_cells.csv")
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        # width_m/height_m은 열 끝에만 추가한다(D1 CSV 보강) - 기존 사용자가
        # 엑셀로 열었을 때 앞쪽 열 위치가 바뀌면 안 된다.
        w.writerow(["cx", "cy", "center_x_m", "center_y_m", "n_subcells",
                    "slope_pct", "downhill_deg", "dev_pct", "dir_err_deg",
                    "correction_mm", "rmse_mm", "se_pct", "grade", "reason",
                    "width_m", "height_m"])
        for g in graded:
            c = g["cell"]
            w.writerow([c.cx, c.cy, round(c.center_x, 3), round(c.center_y, 3),
                        c.n_subcells, _r(c.slope_pct), _deg(c.downhill_rad),
                        _r(g["dev_pct"]), _r(g["dir_err_deg"]),
                        _r(g["correction_mm"]), _r(c.rmse_m * 1000 if c.ok else float("nan")),
                        _r(c.se_pct), g["grade"], g["reason"],
                        round(c.width_m, 3), round(c.height_m, 3)])

    png_path = render_slope_map(graded, os.path.join(out_dir, "slope_map.png"),
                                cell_m=cell_m)

    # 배수구를 지정하지 않으면 방향(역구배) 판정이 조용히 꺼진다(같은 스캔이 --drain
    # 유무에 따라 적합<->재시공으로 뒤집힐 수 있다). stats에 명시적으로 남겨야 보고서
    # 받는 사람이 "coverage_pct 100%"를 "방향까지 다 봤다"로 오해하지 않는다.
    direction_judged = bool(drain_points)
    warnings = []
    if not direction_judged:
        warnings.append("배수구 위치를 지정하지 않아 방향(역구배)을 판정하지 않았습니다. "
                        "크기만 판정한 결과입니다.")
    na_reasons = Counter(g["reason"] for g in graded if g["grade"] == GRADE_NA)
    if na_reasons:
        detail = ", ".join(f"{reason} {cnt}건" for reason, cnt in na_reasons.items())
        warnings.append(f"판정불가 셀 {sum(na_reasons.values())}개: {detail}")

    stats = {"format": "slope-stats-v1", "cell_m": cell_m, "subcell_m": subcell_m,
             "threshold": threshold, "summary": summary,
             "direction_judged": direction_judged,
             "drain_points": ([[round(float(x), 3), round(float(y), 3)]
                               for x, y in drain_points] if drain_points else None),
             "warnings": warnings,
             "artifacts": {"cells_json": cells_json_path,
                           "cells_csv": csv_path, "map_png": png_path}}
    stats_path = os.path.join(out_dir, "slope_stats.json")
    with open(stats_path, "w", encoding="utf-8") as f:
        # allow_nan=False: 위 summary가 nan을 흘리면(회귀) 여기서 즉시 터진다.
        # RFC 8259 표준 JSON에는 NaN 토큰이 없어 브라우저 JSON.parse·Postgres jsonb가
        # 조용히 거부하므로, 조용히 통과시키느니 여기서 바로 예외로 잡는 편이 낫다.
        json.dump(stats, f, ensure_ascii=False, indent=2, allow_nan=False)
    return stats


def analyze_slope(path, scale_to_m, threshold, out_dir, subcell_m=0.05,
                  cell_m=2.0, chunk_size=2_000_000, drain_points=None):
    """점군 -> 2m 격자 구배 산출 -> slope_cells.json 저장 -> 판정 -> 산출물(csv/png/json).

    평활도(analyze_floor)와 같은 스캔을 쓰지만 집계 단위와 판정 철학이 다르다.
    평활도는 "평면에서 얼마나 벗어났나", 구배는 "설계한 경사대로인가"다.

    공개 시그니처는 유지한다 - CLI·워커·테스트 4곳이 이 함수를 그대로 호출하므로
    바뀌면 전부 영향을 받는다. 판정 단계만 judge_slope_cells로 분리해 재판정
    잡이 점군을 다시 읽지 않고도 재사용할 수 있게 한다(스펙 §7.3).
    """
    import os

    from flatness.core.slope import compute_slope_cells
    from flatness.outputs.slope_cells import dump_slope_cells

    os.makedirs(out_dir, exist_ok=True)
    info = read_info(path, chunk_size=chunk_size)
    grid = build_subcell_grid(iter_chunks(path, chunk_size=chunk_size),
                              info, scale_to_m, subcell_m)
    cells = compute_slope_cells(grid, cell_m=cell_m)

    # 재판정(§7.3) 입력. 점군을 다시 읽지 않고 이 파일만 읽어 판정하려면
    # 반올림 없는 원본 셀 벡터가 그대로 남아 있어야 한다(브리프 D1). cell_m·
    # subcell_m도 함께 싣는다 - 재판정이 이 값을 다시 몰라서 기본값으로
    # 조용히 어긋나는 것을 막기 위해서다(Task 1 리뷰 I1).
    cells_json_path = os.path.join(out_dir, "slope_cells.json")
    dump_slope_cells(cells, cells_json_path, engine_version=ENGINE_VERSION,
                     cell_m=cell_m, subcell_m=subcell_m)

    return judge_slope_cells(cells, threshold, out_dir, cell_m,
                             drain_points=drain_points, subcell_m=subcell_m,
                             cells_json_path=cells_json_path)

"""reports.snapshot(jsonb) 빌더 — 발행 후 재현성의 핵심 계약.

계약 정본: docs/superpowers/plans/2026-07-29-p4-report.md "reports.snapshot 계약".
스키마 문자열은 SNAPSHOT_SCHEMA("report-snapshot-v1")이며, 키를 바꾸면 버전을 올리고
계약 문서를 함께 갱신한다.

렌더러(flatworker.report.html.render_html)는 이 dict와 reports/{id}/assets/ 파일만
읽는다 — DB·analyses.stats·artifacts/ 원본을 다시 조회하지 않는다. 라벨·색상까지 여기서
박제하므로, 이후 labels가 바뀌어도 이미 발행된 보고서의 표기는 그대로 재현된다.
"""
import math
from datetime import datetime, timezone

from flatworker.report.labels import (GRADE_COLOR, GRADE_LABEL, GRADE_ORDER, LINEAGE_LABEL,
                                      SURFACE_LABEL, ZONE_STATUS_LABEL, warning_label)

SNAPSHOT_SCHEMA = "report-snapshot-v1"

# 스펙 §1.3·§8 ⑤: 모든 보고서에 필수 표기. 엔진 auto_summary 마지막 줄과 동일 문구.
DISCLAIMER = ("본 결과는 모바일 LiDAR 기반 스크리닝이며 공식 검측(실물 직선자·레벨 측량)을 "
              "대체하지 않습니다.")

# 스펙 §8 ②: 분석 개요에 측정 불확도 고지
UNCERTAINTY_NOTE = ("판정에는 표면 유형별 측정 불확도 U가 반영되어 있습니다. 축소 스팬 셀은 "
                    "허용치와 U를 같은 비율로 환산해 적용하며, 지표가 허용치±U 구간에 들면 "
                    "'경계(현장 재확인 필요)'로 분류합니다.")


def _js_round(value, digits):
    """JS `Math.round(v*10^d)/10^d`와 동일한 half-up(양의 무한대 방향) 반올림.

    파이썬 내장 round()는 은행가 반올림이라 대시보드(dashboard/lib/domain/cells.ts의
    round2/round1)와 마지막 자리가 갈릴 수 있다 — 같은 셀 데이터로 만든 화면 표와 PDF
    표가 어긋나면 안 되므로 JS 규칙을 그대로 옮긴다.
    """
    factor = 10 ** digits
    return math.floor(value * factor + 0.5) / factor


def coverage_label(stats):
    """coverage_pct의 3중 의미(stats-schema.md §3)를 라벨로 분기.

    dashboard/lib/domain/stats.ts의 coverageLabel과 동일 규칙.
    """
    meta = stats.get("meta", {})
    if "source" not in meta and meta.get("surface") == "floor":
        return "바닥 인식률"
    return "셀 유효율"


def is_external(analysis, stats):
    """외부(Colab 임포트) 결과 판별 — dashboard/lib/domain/stats.ts와 동일 규칙."""
    if analysis.get("engine_version") == "external-colab-v1":
        return True
    return "source" in stats.get("meta", {})


def build_sections(cells, stats):
    """cells.json -> 구간별 결과표 행 목록.

    집계 규칙은 dashboard/lib/domain/cells.ts의 computeZoneStats와 1:1이다:
    zone_id(=바닥 구역/벽 wall_id)로 묶고, max/min/mean은 유효 셀만, '기준 초과'는
    보수+재시공(경계는 재확인 대상이지 초과 확정이 아님), 비율 분모는 전체 셀.
    """
    is_wall = stats.get("meta", {}).get("surface") == "wall"
    zones = {z["zone_id"]: z for z in (stats.get("zones") or [])}
    walls = {w["wall_id"]: w for w in (stats.get("walls") or [])}

    grouped = {}
    for cell in cells:
        grouped.setdefault(cell.get("zone_id"), []).append(cell)

    sections = []
    for zone_id, group in grouped.items():
        values = [c["value_mm"] for c in group if c.get("value_mm") is not None]
        counts = dict.fromkeys(GRADE_ORDER, 0)
        for cell in group:
            counts[cell["grade"]] = counts.get(cell["grade"], 0) + 1
        over = counts["repair"] + counts["rework"]
        zone = zones.get(zone_id)
        wall = walls.get(zone_id)
        if zone_id is None:
            kind, label = "all", "전체"      # 임포트 결과는 구역/벽 개념이 없다
        elif is_wall:
            kind, label = "wall", f"벽 {zone_id}"
        else:
            kind, label = "zone", f"구역 {zone_id}"
        sections.append({
            "section_id": zone_id,
            "kind": kind,
            "label": label,
            "status_label": ZONE_STATUS_LABEL[zone["status"]] if zone else None,
            "level_m": zone["level_m"] if zone else None,
            "area_m2": zone["area_m2"] if zone else None,
            "length_m": wall["length_m"] if wall else None,
            "height_m": wall["height_m"] if wall else None,
            "plumbness_mm": wall["plumbness_mm"] if wall else None,
            "plumb_grade": wall["plumb_grade"] if wall else None,
            "plumb_grade_label": GRADE_LABEL[wall["plumb_grade"]] if wall else None,
            "n_cells": len(group),
            "n_valid": len(values),
            "max_mm": _js_round(max(values), 2) if values else None,
            "min_mm": _js_round(min(values), 2) if values else None,
            "mean_mm": _js_round(sum(values) / len(values), 2) if values else None,
            "over_cells": over,
            "over_pct": _js_round(over / len(group) * 100, 1) if group else 0.0,
        })
    # zone_id 오름차순, null(임포트)은 맨 뒤 — 대시보드 정렬과 동일
    sections.sort(key=lambda s: (s["section_id"] is None, s["section_id"] or 0))
    return sections


def build_opinion(report, bundles):
    """종합의견: 보고서 작성자 입력이 있으면 그것, 없으면 분석별 의견 결합.

    분석 단위 의견은 user_summary가 있으면 그것, 없으면 auto_summary (스펙 §8 ⑤).
    """
    text = (report.get("opinion_text") or "").strip()
    if text:
        return {"text": text, "source": "user"}
    parts = []
    for bundle in bundles:
        body = (bundle.analysis.get("user_summary")
                or bundle.analysis.get("auto_summary")
                or bundle.stats.get("auto_summary") or "").strip()
        if body:
            parts.append(f"[{SURFACE_LABEL[bundle.scan['surface']]}] {body}")
    return {"text": "\n\n".join(parts), "source": "auto"}


def _analysis_entry(bundle, assets):
    analysis, scan, stats = bundle.analysis, bundle.scan, bundle.stats
    meta = stats.get("meta", {})
    crit = stats.get("applied_criteria", {})
    worst = stats.get("worst")
    verdict = analysis.get("overall_verdict")
    lineage = scan.get("lineage") or "unknown"
    return {
        "analysis_id": str(analysis["id"]),
        "sort_order": bundle.sort_order,
        "surface": scan["surface"],
        "surface_label": SURFACE_LABEL[scan["surface"]],
        "engine_version": analysis.get("engine_version") or meta.get("engine_version"),
        "is_external": is_external(analysis, stats),
        "scan": {
            "id": str(scan["id"]),
            "scanned_at": scan.get("scanned_at"),
            "device": scan.get("device"),
            "operator_name": bundle.operator_name,
            "original_filename": scan.get("original_filename"),
            "file_format": scan.get("file_format"),
            "point_count": scan.get("point_count"),
            "unit_scale": scan.get("unit_scale"),
            "lineage": lineage,
            "lineage_label": LINEAGE_LABEL.get(lineage, lineage),
        },
        "criteria": {k: crit.get(k) for k in
                     ("name", "source", "span_m", "pass_mm", "rework_mm", "u_mm")},
        "overview": {
            "file": meta.get("file"),
            "n_points": meta.get("n_points"),
            "scale_to_m": meta.get("scale_to_m"),
            "subcell_m": meta.get("subcell_m"),
            "cell_m": meta.get("cell_m"),
            "coverage_pct": stats.get("coverage_pct"),
            "coverage_label": coverage_label(stats),
            "reduced_span_cells": stats.get("reduced_span_cells", 0),
        },
        "summary": {
            "n_cells": stats.get("n_cells", 0),
            "n_valid": stats.get("n_valid", 0),
            "grade_counts": {g: stats.get("grade_counts", {}).get(g, 0) for g in GRADE_ORDER},
            "grade_pct": {g: stats.get("grade_pct", {}).get(g, 0.0) for g in GRADE_ORDER},
            "value_max_mm": stats.get("value_max_mm"),
            "value_min_mm": stats.get("value_min_mm"),
            "value_mean_mm": stats.get("value_mean_mm"),
            "value_p95_mm": stats.get("value_p95_mm"),
            "worst": dict(worst) if worst else None,
            "overall_verdict": verdict,
            "overall_verdict_label": GRADE_LABEL[verdict] if verdict else GRADE_LABEL["na"],
        },
        "sections": build_sections(bundle.cells, stats),
        "warnings": [{"code": c, "text": warning_label(c)} for c in stats.get("warnings", [])],
        "assets": assets,
        "auto_summary": analysis.get("auto_summary") or stats.get("auto_summary"),
        "user_summary": analysis.get("user_summary"),
    }


_EMPTY_ANALYSIS_ASSETS = {"heatmaps": [], "deviation": [], "preview3d": [], "histogram": None}


def build_snapshot(ctx, assets, generated_at=None):
    """ReportContext + 자산 목록 -> snapshot dict (report-snapshot-v1)."""
    moment = (generated_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    report, site, location = ctx.report, ctx.site, ctx.location
    per_analysis = assets.get("analyses", {})
    return {
        "schema": SNAPSHOT_SCHEMA,
        "generated_at": moment.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "report": {
            "id": str(report["id"]),
            "title": report.get("title"),
            "created_at": report.get("created_at"),
        },
        "site": {k: site.get(k) for k in ("id", "name", "address", "memo")},
        "location": {k: location.get(k) for k in
                     ("id", "building", "floor", "room", "name", "memo")},
        "analyses": [
            _analysis_entry(b, per_analysis.get(str(b.analysis["id"]),
                                                dict(_EMPTY_ANALYSIS_ASSETS)))
            for b in ctx.bundles
        ],
        "photos": assets.get("photos", []),
        "opinion": build_opinion(report, ctx.bundles),
        "disclaimer": DISCLAIMER,
        "uncertainty_note": UNCERTAINTY_NOTE,
        "palette": {
            "grade_order": list(GRADE_ORDER),
            "grade_labels": dict(GRADE_LABEL),
            "grade_colors": dict(GRADE_COLOR),
        },
        "notes": assets.get("notes", []),
    }

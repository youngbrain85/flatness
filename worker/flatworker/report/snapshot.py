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

from flatworker.report.context import analysis_kind
from flatworker.report.labels import (ANALYSIS_KIND_LABEL, GRADE_COLOR, GRADE_LABEL, GRADE_ORDER,
                                      LINEAGE_LABEL, SURFACE_LABEL, ZONE_STATUS_LABEL,
                                      warning_label)

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


def opinion_label(bundle):
    """종합의견 앞머리 표기. 구배는 종류까지 밝힌다.

    구배 분석은 같은 바닥 스캔에서 나오므로 표면 라벨만 쓰면 평활도 의견과
    '[바닥]'으로 겹쳐 어느 분석의 의견인지 알 수 없다(색이 아니라 문구로
    구별해야 한다는 스펙 §7.2의 취지와 같다).
    """
    label = SURFACE_LABEL[bundle.scan["surface"]]
    if analysis_kind(bundle.analysis) == "slope":
        return f"{label} {ANALYSIS_KIND_LABEL['slope']}"
    return label


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
            parts.append(f"[{opinion_label(bundle)}] {body}")
    return {"text": "\n\n".join(parts), "source": "auto"}


# ------------------------------------------------------------------ 구배(단계 H)
#
# 구배 등급 어휘는 평활도(GRADE_ORDER의 영문 키)와 다르다 - 엔진
# engine/flatness/core/slope.py가 한국어 문자열을 그대로 낸다. 화면(대시보드
# slope-result.tsx의 COUNT_ORDER)과 같은 순서로 둔다.
SLOPE_GRADE_ORDER = ("적합", "경계", "보수", "재시공", "판정불가")

# 보고서 표에 싣는 등급. 2m 격자면 셀이 수백 개라 적합까지 실으면 표가 PDF를
# 채우고 정작 조치할 셀이 묻힌다 - 조치가 필요한 셀만 싣는다(역구배는 등급이
# 재시공이라 따로 나열하지 않아도 포함된다). 뺀 셀은 slope.counts에 남는다.
SLOPE_ACTION_GRADES = ("보수", "재시공", "판정불가")

# 8방위 이름. dashboard/lib/domain/slope-direction.ts의 COMPASS와 같은 순서다.
_COMPASS = ("동", "북동", "북", "북서", "서", "남서", "남", "남동")

# ★ 역구배 셀의 보정 문구. 정본은 slope-direction.ts:62이며 한 글자도 다르면 안 된다.
SLOPE_REVERSE_CORRECTION = "역구배 - 방향 전면 재시공 필요(크기 보정으로 해결 안 됨)"


def _round2(value):
    return None if value is None else _js_round(float(value), 2)


def compass_label(rad):
    """라디안(수학 각도, 0=+x=동, 반시계 증가) -> 8방위 한국어 이름.

    dashboard/lib/domain/slope-direction.ts의 compassLabel과 동일 규칙이다.
    JS Math.round는 half-up이라 파이썬 내장 round(은행가 반올림)를 쓰면 경계
    각도에서 화면과 PDF의 방위가 갈린다 - _js_round와 같은 이유로 floor(x+0.5)다.
    """
    two_pi = 2 * math.pi
    norm = math.fmod(math.fmod(rad, two_pi) + two_pi, two_pi)
    return _COMPASS[int(math.floor(norm / (math.pi / 4) + 0.5)) % 8]


def slope_correction_text(cell, design_pct):
    """셀 하나의 보정 문구. 정본은 slope-direction.ts의 correctionDirectionLabel이다.

    ★ 역구배 셀에는 크기 기준 문구를 절대 내지 않는다(스펙 §7.2). 역구배는 물이
    배수구 반대로 흐르는 방향 결함이라 크기 편차(correction_mm)와 무관하고, 크기가
    설계와 비슷하면 correction_mm이 0에 가까워 "서쪽 끝을 0.0mm 높임"처럼 "고칠 것
    없음"으로 읽히는 문구가 나온다 - 하필 스펙이 "색만으로 안 드러난다"고 경계한
    바로 그 셀에서 보정란이 결함을 가리는 셈이다(단계 D 실측 결함).

    계산에 필요한 값이 하나라도 없으면(측정 불가·판정불가 셀, 또는 설계 구배
    결측) 방향을 추측하지 않고 '-'를 낸다. 화면 결과표(slope-result-table.tsx)가
    `correction ?? '-'`로 내는 것과 같은 표기다.
    """
    slope_pct = cell.get("slope_pct")
    downhill = cell.get("downhill_rad")
    correction_mm = cell.get("correction_mm")
    if (not cell.get("ok") or slope_pct is None or downhill is None
            or correction_mm is None or design_pct is None):
        return "-"
    if cell.get("reverse"):
        return SLOPE_REVERSE_CORRECTION
    action = "높임" if slope_pct >= design_pct else "낮춤"
    return f"{compass_label(downhill)}쪽 끝을 {correction_mm:.1f}mm {action}"


def slope_direction_text(cell, dir_pass_deg):
    """방향 편차 문구. slope-result-table.tsx의 directionDeviationLabel과 같은 규칙.

    허용 각도를 넘었지만 90도는 안 넘어 역구배로는 분류되지 않은 셀은, 보정란이
    크기 기준 문구만 내므로 편차가 작으면 방향 결함이 전혀 드러나지 않는다(화면
    코드리뷰 2차 I2). 역구배 셀은 이미 전용 문구가 있어 중복 강조를 피한다.
    """
    dir_err = cell.get("dir_err_deg")
    if cell.get("reverse") or dir_err is None or dir_pass_deg is None:
        return "-"
    if dir_err <= dir_pass_deg:
        return "-"
    return f"{dir_err:.1f}도(허용 {dir_pass_deg:g}도 초과)"


def build_slope_cells(cells, design_pct, dir_pass_deg):
    """조인된 구배 셀 -> 보고서 표 행. 조치가 필요한 셀만 (cy, cx) 순으로 낸다."""
    rows = []
    for cell in cells:
        if cell.get("grade") not in SLOPE_ACTION_GRADES:
            continue
        rows.append({
            "cx": cell["cx"],
            "cy": cell["cy"],
            "grade": cell["grade"],
            "reason": cell["reason"],
            "slope_pct": _round2(cell.get("slope_pct")),
            "dev_pct": _round2(cell.get("dev_pct")),
            "dir_err_deg": cell.get("dir_err_deg"),
            "reverse": bool(cell.get("reverse")),
            "correction_text": slope_correction_text(cell, design_pct),
            "direction_text": slope_direction_text(cell, dir_pass_deg),
        })
    rows.sort(key=lambda r: (r["cy"], r["cx"]))
    return rows


def build_slope(stats, cells, assets):
    """구배 stats(slope_stats.json 형태) + 조인된 셀 -> 스냅샷의 slope 항목.

    과업지시서 11·12쪽의 산출 항목(구배값·설계기준 대비 편차·평균편차·표준편차·
    최대편차)이 전부 여기서 나온다. 설계 구배는 stats.threshold를 읽는다 -
    analyses.applied_criteria 컬럼에도 같은 값이 있지만 재판정(§7.3)은 stats만
    갱신하므로 언제나 현재 판정과 일치하는 쪽은 stats다.
    """
    threshold = stats.get("threshold") or {}
    summary = stats.get("summary") or {}
    counts = summary.get("counts") or {}
    design_pct = _round2(threshold.get("design_pct"))
    dir_pass_deg = threshold.get("dir_pass_deg")
    return {
        "design_pct": design_pct,
        "pass_pct": _round2(threshold.get("pass_pct")),
        "re_pct": _round2(threshold.get("re_pct")),
        "dir_pass_deg": dir_pass_deg,
        "dev_mean_pct": _round2(summary.get("mean_dev_pct")),
        "dev_sd_pct": _round2(summary.get("std_dev_pct")),
        "dev_max_pct": _round2(summary.get("max_dev_pct")),
        # 배수구를 지정하지 않으면 방향(역구배) 판정이 통째로 꺼진다 - "적합"이
        # 크기만 본 결과라는 사실을 보고서가 밝히지 않으면 오독을 부른다.
        "direction_judged": bool(stats.get("direction_judged")),
        "cell_m": stats.get("cell_m"),
        "n_cells": len(cells),
        "counts": {g: counts.get(g, 0) for g in SLOPE_GRADE_ORDER},
        "drain_points": [{"x": p[0], "y": p[1]} for p in (stats.get("drain_points") or [])],
        "map_png": assets.get("slope_map"),
        "cells": build_slope_cells(cells, design_pct, dir_pass_deg),
    }


def _slope_analysis_entry(bundle, assets):
    """구배 분석 항목. 평활도 항목과 식별 정보는 공유하되 등급 어휘·통계 스키마가
    전부 달라 별도로 만든다.

    ★ `kind`는 구배 항목에만 싣는다. 평활도 항목에 `kind: 'flatness'`를 더하면
    이미 발행된 보고서의 스냅샷(설계 결정 D8로 박제된 것)과 새 보고서가 서로 다른
    내용을 담게 되는데, 발행본은 어떤 경우에도 다시 만들지 않으므로 옛 스냅샷에는
    그 키가 영원히 없다. 따라서 템플릿은 반드시 `a.kind == 'slope'`(긍정형)로
    분기해야 한다 - `a.kind == 'flatness'`는 옛 스냅샷에서도 새 평활도 항목에서도
    거짓이다.

    평활도 전용 키(overview.reduced_span_cells·summary의 mm 통계·sections)는 넣지
    않는다. 0이나 null로 채우면 "축소 스팬 0개", "최대 0.00mm"처럼 측정한 적 없는
    수치가 진짜 결과처럼 인쇄된다. summary는 표지(§1) 측정 개요가 읽는 종합 판정
    두 키만 남긴다.
    """
    analysis, scan, stats = bundle.analysis, bundle.scan, bundle.stats
    crit = analysis.get("applied_criteria") or {}
    summary = stats.get("summary") or {}
    verdict = analysis.get("overall_verdict")
    return {
        "analysis_id": str(analysis["id"]),
        "sort_order": bundle.sort_order,
        "kind": "slope",
        "kind_label": ANALYSIS_KIND_LABEL["slope"],
        "surface": scan["surface"],
        "surface_label": SURFACE_LABEL[scan["surface"]],
        "engine_version": analysis.get("engine_version"),
        "is_external": is_external(analysis, stats),
        "scan": _scan_entry(bundle),
        # 구배 기준 행에는 span_m·pass_mm·rework_mm·u_mm이 없다(평활도 전용 열).
        # 표지의 '적용 기준' 칸이 읽는 name·source만 채운다.
        "criteria": {"name": crit.get("name"), "source": crit.get("source")},
        "overview": {
            "file": scan.get("original_filename"),
            "n_points": scan.get("point_count"),
            "scale_to_m": scan.get("unit_scale"),
            "subcell_m": stats.get("subcell_m"),
            "cell_m": stats.get("cell_m"),
            "coverage_pct": summary.get("coverage_pct"),
            # 구배의 coverage_pct는 "판정된 셀 / 전체 셀"이다(평활도의 바닥 인식률·
            # 셀 유효율과 뜻이 다르다). 화면 slope-result.tsx와 같은 문구를 쓴다.
            "coverage_label": "판정 가능 비율",
        },
        "summary": {
            "overall_verdict": verdict,
            "overall_verdict_label": GRADE_LABEL[verdict] if verdict else GRADE_LABEL["na"],
        },
        # 엔진이 낸 구배 경고는 완성된 한국어 문장이다(평활도의 ASCII 슬러그가
        # 아니다). warning_label은 미지 코드를 원문 그대로 돌려주므로 그대로 실린다.
        "warnings": [{"code": c, "text": warning_label(c)} for c in stats.get("warnings", [])],
        "assets": assets,
        "auto_summary": analysis.get("auto_summary"),
        "user_summary": analysis.get("user_summary"),
        "slope": build_slope(stats, bundle.cells, assets),
    }


def _scan_entry(bundle):
    scan = bundle.scan
    lineage = scan.get("lineage") or "unknown"
    return {
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
    }


def _analysis_entry(bundle, assets):
    if analysis_kind(bundle.analysis) == "slope":
        return _slope_analysis_entry(bundle, assets)
    analysis, scan, stats = bundle.analysis, bundle.scan, bundle.stats
    meta = stats.get("meta", {})
    crit = stats.get("applied_criteria", {})
    worst = stats.get("worst")
    verdict = analysis.get("overall_verdict")
    return {
        "analysis_id": str(analysis["id"]),
        "sort_order": bundle.sort_order,
        "surface": scan["surface"],
        "surface_label": SURFACE_LABEL[scan["surface"]],
        "engine_version": analysis.get("engine_version") or meta.get("engine_version"),
        "is_external": is_external(analysis, stats),
        "scan": _scan_entry(bundle),
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

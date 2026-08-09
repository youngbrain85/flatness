"""보고서 컨텍스트 로드 — DB와 분석 산출물에서 스냅샷 재료를 모으고 사전 검증한다.

여기서 던지는 ValueError는 그대로 잡 실패 사유가 되어 reports.gen_error를 거쳐
대시보드에 노출되므로(스펙 §9), 반드시 사용자가 조치할 수 있는 한국어 문장이어야 한다.
"""
import json
from dataclasses import dataclass


@dataclass
class AnalysisBundle:
    """보고서 1개 분석분의 재료 묶음."""
    analysis: dict          # analyses 행
    scan: dict              # scans 행
    stats: dict             # analyses.stats (DB 저장본이 정본)
    cells: list             # artifacts/{analysis_id}/cells.json
    sort_order: int
    operator_name: str


@dataclass
class ReportContext:
    report: dict
    site: dict
    location: dict
    bundles: list
    photos: list


def analysis_kind(analysis):
    """analyses.kind. NULL·누락은 평활도로 본다(jobs.handle_analyze와 같은 규칙)."""
    return analysis.get("kind") or "flatness"


def _slope_artifact_key(analysis, stats, key, name):
    """구배 산출물의 버킷-상대 키.

    stats.artifacts 값은 이미 버킷-상대 전체 경로다(워커 flatworker/slope.py의
    normalize_slope_stats가 그렇게 정규화한다) - artifacts_dir와 다시 합치면
    artifacts/{id}/artifacts/{id}/...로 중복된다. 대시보드 slope-cells.ts도 같은
    함정을 주석으로 남겼다. 단계 C 이전에 만들어진 분석은 이 키가 없을 수 있어
    관례 경로로 폴백한다.
    """
    path = (stats.get("artifacts") or {}).get(key)
    return path or f"{analysis['artifacts_dir']}/{name}"


def _download_json(storage, key, analysis_id, what):
    blob = storage.download(key)
    if blob is None:
        raise ValueError(
            f"분석 {analysis_id}의 {what}을(를) 저장소에서 찾을 수 없습니다: {key}. "
            "분석을 다시 실행하세요.")
    return json.loads(blob.decode("utf-8"))


def _load_slope_cells(storage, analysis):
    """구배 셀: slope_cells.json(기하) + slope_judged.json(판정)을 (cx, cy)로 조인.

    구배 분석의 산출물에는 cells.json이 없다. 판정 결과(grade·dev_pct·
    correction_mm·dir_err_deg·reason)는 slope_cells.json에 담기지 않는데(브리프
    D1: 재판정 때마다 다시 계산되는 파생값이라 입력 파일에 같이 담으면 이중
    진실이 된다), 셀 기하(slope_pct·downhill_rad)는 반대로 slope_judged.json에
    없다 - 보고서 표는 둘 다 필요하므로 여기서 합친다.

    조인 규칙은 대시보드 joinSlopeCells(lib/domain/slope-judged.ts)와 같다:
    배열 순서가 같다는 가정에 기대지 않고 (cx, cy) 키로 짝짓고, 한쪽에만 있는
    키는 조용히 뺀다. 화면과 PDF가 서로 다른 셀 집합을 보이면 안 된다.
    """
    stats = analysis.get("stats") or {}
    analysis_id = analysis["id"]
    geom = _download_json(
        storage, _slope_artifact_key(analysis, stats, "cells_json", "slope_cells.json"),
        analysis_id, "구배 셀 데이터(slope_cells.json)")
    judged = _download_json(
        storage, _slope_artifact_key(analysis, stats, "judged_json", "slope_judged.json"),
        analysis_id, "구배 판정 결과(slope_judged.json)")
    # 방향(역구배) 판정 여부. 배수구를 지정하지 않은 분석에서 '역구배'로 시작하는
    # 사유가 나올 수는 없지만, jsonb·산출물 모두 무결성을 보장하지 않으므로
    # 대시보드와 같이 방어를 한 번 더 겹친다.
    direction_judged = bool(judged.get("direction_judged"))
    by_key = {(row["cx"], row["cy"]): row for row in (judged.get("cells") or [])}

    joined = []
    for cell in (geom.get("cells") or []):
        row = by_key.get((cell["cx"], cell["cy"]))
        if row is None:
            continue
        merged = dict(cell)
        merged.update({
            "grade": row["grade"],
            "reason": row["reason"],
            "dev_pct": row.get("dev_pct"),
            "dir_err_deg": row.get("dir_err_deg"),
            "correction_mm": row.get("correction_mm"),
            "reverse": direction_judged and str(row["reason"]).startswith("역구배"),
        })
        joined.append(merged)
    return joined


def _load_cells(storage, analysis):
    artifacts_dir = analysis.get("artifacts_dir")
    if not artifacts_dir:
        raise ValueError(f"분석 {analysis['id']}의 산출물 경로가 없습니다. 분석을 다시 실행하세요.")
    if analysis_kind(analysis) == "slope":
        return _load_slope_cells(storage, analysis)
    blob = storage.download(f"{artifacts_dir}/cells.json")
    if blob is None:
        raise ValueError(
            f"분석 {analysis['id']}의 셀 데이터(cells.json)를 저장소에서 찾을 수 없습니다: "
            f"{artifacts_dir}. 분석을 다시 실행하세요.")
    return json.loads(blob.decode("utf-8"))


# 재판정 잡이 아직 끝나지 않은 상태들. 대시보드가 배수구 클릭 시점에 'queued'를
# 쓰고(components/analysis/slope-result.tsx), 잡 큐 함수가 'processing'으로 올린다.
_JUDGE_IN_FLIGHT = ("queued", "processing")


def _reject_if_rejudging(analysis):
    """재판정이 진행 중인 구배 분석은 보고서에 넣지 않는다.

    `handle_slope_judge`는 산출물을 먼저 올리고(`storage.upload_dir`) 그 다음에
    `analyses.stats`를 갱신한다. 그 사이에 보고서를 만들면 **DB의 옛 통계 +
    저장소의 새 판정 셀·새 slope_map.png**가 한 스냅샷에 섞여 박제된다 - 요약은
    "재시공 2셀"인데 표와 그림은 다른 판정의 것이 되는, 형식만 멀쩡한 발행본이다.

    기존 "완료되지 않은 분석" 가드로는 못 잡는다. 재판정은 analyses.status를
    일부러 건드리지 않기 때문이다(설계 결정 D5 - 진행 상태는 params.judge로만
    옮긴다). 화면도 재판정 중인 분석을 선택 불가로 막지만 후보 목록이 페이지
    로드 시점 스냅샷이라 최선노력이므로, 워커에서도 같은 조건을 확인한다.

    한계: 재판정이 업로드 뒤에 실패하면(judge.state='failed') 저장소만 새 것인
    상태가 남는다. 이때까지 막으면 재판정이 한 번 실패한 분석은 영영 보고서를
    못 만들게 되므로 진행 중(queued/processing)만 거부한다. 실패한 잡은 러너가
    재시도해 스스로 정합을 되찾는다.
    """
    judge = ((analysis.get("params") or {}).get("judge") or {})
    if judge.get("state") in _JUDGE_IN_FLIGHT:
        raise ValueError(
            f"재판정이 진행 중인 구배 분석이 포함되어 있습니다: {analysis['id']}. "
            "재판정이 끝난 뒤 다시 생성하세요.")


def _operator_name(db, scan):
    """담당자 표시명: 수기 입력 우선, 없으면 profiles.display_name."""
    manual = (scan.get("operator_name_manual") or "").strip()
    if manual:
        return manual
    operator_id = scan.get("operator_id")
    if not operator_id:
        return None
    profile = db.get_profile(operator_id)
    return (profile or {}).get("display_name")


def load_report_context(db, storage, report_id):
    report = db.get_report(report_id)
    if report.get("status") == "finalized":
        # 004의 불변 트리거와 2중 방어: 발행본은 재생성 대상이 아니다
        raise ValueError("발행된 보고서는 다시 생성할 수 없습니다. 새 보고서를 만드세요.")
    links = db.get_report_analyses(report_id)
    if not links:
        raise ValueError("보고서에 포함된 분석이 없습니다. 분석을 1개 이상 선택해 다시 생성하세요.")
    links = sorted(links, key=lambda r: r.get("sort_order", 0))
    rows = db.get_analyses_by_ids([link["analysis_id"] for link in links])
    analyses = {str(a["id"]): a for a in rows}
    location = db.get_location(report["location_id"])
    site = db.get_site(location["site_id"])

    bundles = []
    for link in links:
        aid = str(link["analysis_id"])
        analysis = analyses.get(aid)
        if analysis is None:
            raise ValueError(f"보고서에 포함된 분석을 찾을 수 없습니다: {aid}")
        if analysis.get("status") != "done" or not analysis.get("stats"):
            raise ValueError(
                f"완료되지 않은 분석이 포함되어 있습니다: {aid}. 분석 완료 후 다시 생성하세요.")
        if analysis_kind(analysis) == "slope":
            _reject_if_rejudging(analysis)
        scan = db.get_scan(analysis["scan_id"])
        if str(scan["location_id"]) != str(report["location_id"]):
            # 스펙 §7.6: 보고서는 "같은 측정위치"의 분석만 묶는다
            raise ValueError(
                f"다른 측정위치의 분석이 포함되어 있습니다: {aid}. "
                "보고서는 같은 측정위치의 분석만 묶을 수 있습니다.")
        bundles.append(AnalysisBundle(
            analysis=analysis, scan=scan, stats=analysis["stats"],
            cells=_load_cells(storage, analysis), sort_order=link.get("sort_order", 0),
            operator_name=_operator_name(db, scan)))

    photos = db.get_photos_by_scan_ids([b.scan["id"] for b in bundles])
    return ReportContext(report=report, site=site, location=location,
                         bundles=bundles, photos=photos)

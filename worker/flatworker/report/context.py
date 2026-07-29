"""보고서 컨텍스트 로드 — DB와 분석 산출물에서 스냅샷 재료를 모으고 사전 검증한다.

여기서 던지는 ValueError는 그대로 잡 실패 사유가 되어 reports.gen_error를 거쳐
대시보드에 노출되므로(스펙 §9), 반드시 사용자가 조치할 수 있는 한국어 문장이어야 한다.
"""
import json
from dataclasses import dataclass
from pathlib import Path


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


def _load_cells(cfg, analysis):
    artifacts_dir = analysis.get("artifacts_dir")
    if not artifacts_dir:
        raise ValueError(f"분석 {analysis['id']}의 산출물 경로가 없습니다. 분석을 다시 실행하세요.")
    # 경로 계약: DB에는 버킷-상대 문자열만 있으므로 소비자가 자신의 DATA_DIR에 결합한다
    path = Path(cfg.data_dir) / artifacts_dir / "cells.json"
    if not path.exists():
        raise ValueError(
            f"분석 {analysis['id']}의 셀 데이터(cells.json)를 찾을 수 없습니다: {artifacts_dir}. "
            "워커 PC의 data/ 디렉터리와 DATA_DIR 설정을 확인하세요.")
    return json.loads(path.read_text(encoding="utf-8"))


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


def load_report_context(db, cfg, report_id):
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
        scan = db.get_scan(analysis["scan_id"])
        if str(scan["location_id"]) != str(report["location_id"]):
            # 스펙 §7.6: 보고서는 "같은 측정위치"의 분석만 묶는다
            raise ValueError(
                f"다른 측정위치의 분석이 포함되어 있습니다: {aid}. "
                "보고서는 같은 측정위치의 분석만 묶을 수 있습니다.")
        bundles.append(AnalysisBundle(
            analysis=analysis, scan=scan, stats=analysis["stats"],
            cells=_load_cells(cfg, analysis), sort_order=link.get("sort_order", 0),
            operator_name=_operator_name(db, scan)))

    photos = db.get_photos_by_scan_ids([b.scan["id"] for b in bundles])
    return ReportContext(report=report, site=site, location=location,
                         bundles=bundles, photos=photos)

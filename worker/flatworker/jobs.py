"""잡 핸들러 4종 (precheck/analyze/import/report) — 스펙 §5.1.7, §5.4, §8.

analyze/import/report는 실패 시 예외를 그대로 전파한다: 잡 상태 전이(재시도/최종
실패)는 runner가 `fail_job`으로 처리하는 책임이라 이 모듈에서 잡지 않는다.
"""
from pathlib import Path

from flatness.criteria import Criterion
from flatness.core.pipeline import analyze_floor, analyze_wall
from flatness.importer.colab_csv import import_colab_csv

from flatworker.artifacts import artifacts_dir
from flatworker.report.assets import build_assets, report_dir
from flatworker.report.context import load_report_context
from flatworker.report.html import render_html
from flatworker.report.snapshot import build_snapshot


def _to_criterion(row):
    """criteria 테이블 행(dict) -> 엔진 Criterion. thresholds[0]에서 span/pass/rework 추출.

    criteria.thresholds는 §4.2 규약상 배열이지만(추후 다중 스팬 구간 확장 여지),
    현재 시드 데이터·엔진 모두 원소 1개만 사용한다.
    """
    t = row["thresholds"][0]
    return Criterion(name=row["name"], surface=row["surface"], metric=t["metric"],
                      span_m=t.get("span_m"), pass_mm=t["pass_mm"], rework_mm=t["rework_mm"],
                      source=row["source_text"])


def overall_verdict(stats):
    """stats -> 종합 판정. rework>0 -> repair>0 -> borderline>0 -> pass, n_valid=0 -> None."""
    if stats.get("n_valid", 0) == 0:
        return None
    gc = stats.get("grade_counts", {})
    for grade in ("rework", "repair", "borderline"):
        if gc.get(grade, 0) > 0:
            return grade
    return "pass"


def handle_precheck(db, cfg, payload):
    """scan_id의 단위 확정 여부만 확인해 상태를 승격/대기시킨다.

    원래 스펙(§5.1.1)은 read_info→detect_units로 단위 후보를 산출해 사용자에게
    보여주는 흐름이지만, 데모 스키마의 scans 테이블에는 후보를 저장할 컬럼
    (unit_candidates 등)이 없다 — 계산해도 어디에도 남길 곳이 없다. 따라서
    scans.unit_scale이 이미 확정되어 있으면(P3 UI가 업로드 단계에서 직접 설정)
    'ready'로 승격하고, 아니면 'awaiting_unit_confirm'으로 둔다.
    """
    scan_id = payload["scan_id"]
    scan = db.get_scan(scan_id)
    if scan.get("unit_scale") is not None:
        db.update_scan(scan_id, {"status": "ready"})
    else:
        db.update_scan(scan_id, {"status": "awaiting_unit_confirm"})


def _load_context(db, analysis_id):
    """analysis -> scan -> criteria 순으로 로드하고 엔진 입력을 만들어 반환."""
    analysis = db.get_analysis(analysis_id)
    scan = db.get_scan(analysis["scan_id"])
    criteria_row = db.get_criteria(analysis["criteria_id"])
    crit = _to_criterion(criteria_row)
    uncertainty = db.get_app_setting("uncertainty_mm")
    u_mm = uncertainty[scan["surface"]]
    return analysis, scan, crit, u_mm


def _resolve_raw_path(cfg, scan):
    """scan.raw_file_path를 실제 파일 경로로 해석한다.

    코드리뷰 Important(I1): DB(scans.raw_file_path)에는 스펙 §6.3 규약대로
    **버킷-상대 경로 문자열만** 저장된다(예: `raw-scans/{site_id}/{scan_id}/raw.ply`)
    — `data/` 접두나 OS 절대경로가 아니다. 이 값을 실제로 열 수 있는 경로로 바꾸는
    책임은 소비자(이 워커)에게 있고, 소비자는 자신의 `DATA_DIR`에 결합한다. 이미
    절대경로로 들어온 값(과거 데이터 등)은 그대로 존중해 이중 결합을 피한다.
    """
    p = Path(scan["raw_file_path"])
    return cfg.data_dir / p if not p.is_absolute() else p


def _finalize(db, analysis_id, scan_id, stats, out_dir):
    """엔진 stats를 analyses 행에 반영하고 해당 스캔의 현재 분석으로 지정."""
    db.update_analysis(analysis_id, {
        "status": "done",
        "stats": stats,
        "coverage_pct": stats.get("coverage_pct"),
        "overall_verdict": overall_verdict(stats),
        "warnings": stats.get("warnings", []),
        # 코드리뷰 Important(I1): out_dir(워커 CWD 상대·OS 종속 절대경로)이 아니라
        # 스펙 §6.3 규약의 버킷-상대 문자열만 저장한다 — 실제 파일 위치는 소비자가
        # 자신의 data 루트(DATA_DIR)에 이 문자열을 결합해 얻는다.
        "artifacts_dir": f"artifacts/{analysis_id}",
        "engine_version": stats.get("meta", {}).get("engine_version"),
        "applied_criteria": stats.get("applied_criteria"),
        "auto_summary": stats.get("auto_summary"),
    })
    db.set_current_analysis(scan_id, analysis_id)


def handle_analyze(db, cfg, payload):
    analysis_id = payload["analysis_id"]
    analysis, scan, crit, u_mm = _load_context(db, analysis_id)
    out_dir = artifacts_dir(cfg.data_dir, analysis_id)
    path = _resolve_raw_path(cfg, scan)
    scale_to_m = scan["unit_scale"]
    if scan["surface"] == "wall":
        stats = analyze_wall(path, scale_to_m, crit, u_mm, out_dir)
    else:
        stats = analyze_floor(path, scale_to_m, crit, u_mm, out_dir)
    _finalize(db, analysis_id, analysis["scan_id"], stats, out_dir)


def handle_import(db, cfg, payload):
    analysis_id = payload["analysis_id"]
    analysis, scan, crit, u_mm = _load_context(db, analysis_id)
    if scan["surface"] != "floor":
        # 코드리뷰 Minor(M2): 임포트 계약(스펙 §5.4, docs/contracts/stats-schema.md
        # §7)은 바닥 전용이다 — 엔진 import_colab_csv 자체도 meta.surface를 항상
        # "floor"로 고정해 찍어내므로, 벽 스캔을 이 경로로 흘려보내면 scan.surface와
        # 모순되는 stats(surface=floor로 찍힌 벽 데이터)가 만들어진다. CLI(cli.py의
        # "바닥(flatness) 기준을 지정하세요" 안내)와 동일한 취지로 여기서 조기 차단한다.
        raise ValueError(
            f"임포트는 바닥(floor) 스캔만 지원합니다: scan.surface='{scan['surface']}'")
    out_dir = artifacts_dir(cfg.data_dir, analysis_id)
    path = _resolve_raw_path(cfg, scan)
    stats = import_colab_csv(path, crit, u_mm, out_dir)
    _finalize(db, analysis_id, analysis["scan_id"], stats, out_dir)


def handle_report(db, cfg, payload, renderer=None):
    """보고서 잡 (스펙 §8): 컨텍스트 로드 -> 자산 복사 -> snapshot -> HTML -> PDF -> 갱신.

    `renderer`는 테스트가 FakeRenderer를 넣기 위한 이음매다. 기본값은 Playwright
    렌더러이며, playwright 패키지가 없는 환경에서도 이 모듈을 import할 수 있도록
    함수 안에서 지연 import한다.

    실패는 예외를 그대로 올린다 — 잡 상태 전이(재시도/최종 실패)와 reports.gen_status
    반영은 runner의 fail_job(=fn_job_fail) 책임이다(analyze/import와 동일 규약).
    """
    report_id = payload["report_id"]
    ctx = load_report_context(db, cfg, report_id)
    out_dir = report_dir(cfg.data_dir, report_id)
    assets = build_assets(db, cfg, report_id, ctx)
    snapshot = build_snapshot(ctx, assets)
    html = render_html(snapshot)
    if renderer is None:
        from flatworker.report.renderer import PlaywrightRenderer
        renderer = PlaywrightRenderer()
    renderer.render_pdf(html, out_dir, out_dir / "report.pdf")
    db.update_report(report_id, {
        "snapshot": snapshot,
        # 경로 계약: DB에는 버킷-상대 문자열만 (스펙 §6.3)
        "pdf_path": f"reports/{report_id}/report.pdf",
        "gen_status": "done",
        "gen_error": None,
    })

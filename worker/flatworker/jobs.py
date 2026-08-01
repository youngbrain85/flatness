"""잡 핸들러 4종 (precheck/analyze/import/report) — 스펙 §5.1.7, §5.4, §8.

analyze/import/report는 실패 시 예외를 그대로 전파한다: 잡 상태 전이(재시도/최종
실패)는 runner가 `fail_job`으로 처리하는 책임이라 이 모듈에서 잡지 않는다.
"""
import os
from pathlib import Path

from flatness.criteria import Criterion
from flatness.core.pipeline import analyze_floor, analyze_wall
from flatness.importer.colab_csv import import_colab_csv
from flatness.importer.json_import import import_json

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


# 확장자 -> 임포터 함수. 두 임포터 모두 (path, criterion, u_mm, out_dir) 시그니처와
# stats dict 반환 계약을 공유한다(flatness.importer.common.run_import_pipeline로 내부
# 통합돼 있어 결과가 일관됨 — docs/contracts/stats-schema.md §7).
_IMPORT_HANDLERS = {".csv": import_colab_csv, ".json": import_json}


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
    importer = _IMPORT_HANDLERS.get(path.suffix.lower())
    if importer is None:
        raise ValueError(
            f"지원하지 않는 임포트 파일 형식입니다: '{path.suffix}' (지원 형식: .csv, .json)")
    stats = importer(path, crit, u_mm, out_dir)
    _finalize(db, analysis_id, analysis["scan_id"], stats, out_dir)


def handle_report(db, cfg, payload, renderer=None):
    """보고서 잡 (스펙 §8): 컨텍스트 로드 -> 자산 복사 -> snapshot -> HTML -> PDF -> 갱신.

    `renderer`는 테스트가 FakeRenderer를 넣기 위한 이음매다. 기본값은 Playwright
    렌더러이며, playwright 패키지가 없는 환경에서도 이 모듈을 import할 수 있도록
    함수 안에서 지연 import한다.

    실패는 예외를 그대로 올린다 — 잡 상태 전이(재시도/최종 실패)와 reports.gen_status
    반영은 runner의 fail_job(=fn_job_fail) 책임이다(analyze/import와 동일 규약).

    코드리뷰 Important(I1) — 발행본 보호(2중 방어, 완전한 원자성은 DB 트랜잭션 없이는
    불가능하므로 아래 두 방어로 경합 창을 최대한 좁힌다):
    1. `load_report_context`가 컨텍스트 로드 시점에 finalized를 1회 거부하지만, 그
       뒤 `build_assets`(assets 디렉터리를 rmtree 후 재생성)까지 가는 사이에 발행이
       확정될 수 있다. rmtree 직전에 `db.get_report`로 상태를 다시 확인해 그 경합을
       막는다(자산이 지워지기 "전"에 막는 것이 핵심 — 지운 뒤 되돌릴 방법은 없다).
    2. PDF는 `report.pdf.tmp`로 렌더한 뒤 `db.update_report`가 성공한 "뒤"에만
       `os.replace`로 `report.pdf`를 교체한다. 렌더링 도중(자산 복사~PDF 생성 사이,
       수 초가 걸리는 Playwright 렌더 구간) 발행이 확정되면 004의
       `fn_reports_finalized_guard` 트리거가 `db.update_report`를 42501로 거부하고,
       이 함수는 tmp만 정리한 뒤 예외를 그대로 올린다 — 디스크의 report.pdf(발행본)는
       손대지 않은 채 보존된다.
       잔여 위험: `db.update_report` 성공 "직후" `os.replace` 자체가 실패하면(디스크
       풀·권한 등) DB는 gen_status='done'인데 디스크 파일은 이전 버전으로 남는 아주
       좁은 창이 남는다 — 은폐하지 않고 여기 명시한다. 이 창을 완전히 없애려면
       파일시스템 갱신과 DB 갱신을 하나의 트랜잭션으로 묶어야 하는데, 이 둘은 서로
       다른 시스템(로컬 파일시스템 vs PostgREST)이라 데모 아키텍처로는 달성 불가하다.
    """
    report_id = payload["report_id"]
    ctx = load_report_context(db, cfg, report_id)

    # 방어 1: rmtree(자산 디렉터리) 직전 재확인 — load_report_context의 검사 이후
    # 발행이 확정됐다면 자산을 지우기 전에 여기서 멈춘다.
    report_now = db.get_report(report_id)
    if report_now.get("status") == "finalized":
        raise ValueError("발행된 보고서는 다시 생성할 수 없습니다. 새 보고서를 만드세요.")

    out_dir = report_dir(cfg.data_dir, report_id)
    assets = build_assets(db, cfg, report_id, ctx)
    snapshot = build_snapshot(ctx, assets)
    html = render_html(snapshot)
    if renderer is None:
        from flatworker.report.renderer import PlaywrightRenderer
        renderer = PlaywrightRenderer()

    # 방어 2: tmp에 렌더 후 DB 갱신 성공 시에만 원자적으로 교체(os.replace)한다.
    final_path = out_dir / "report.pdf"
    tmp_path = out_dir / "report.pdf.tmp"
    renderer.render_pdf(html, out_dir, tmp_path)
    try:
        db.update_report(report_id, {
            "snapshot": snapshot,
            # 경로 계약: DB에는 버킷-상대 문자열만 (스펙 §6.3)
            "pdf_path": f"reports/{report_id}/report.pdf",
            "gen_status": "done",
            "gen_error": None,
        })
    except Exception:
        # DB 갱신이 거부되면(예: 렌더링 도중 발행 확정 -> 004 트리거 42501) tmp만
        # 정리하고 기존 발행본 report.pdf는 그대로 둔다 — 원자적 교체의 핵심.
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    os.replace(tmp_path, final_path)

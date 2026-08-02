"""잡 핸들러 4종 (precheck/analyze/import/report) — 스펙 §5.1.7, §5.4, §8.

analyze/import/report는 실패 시 예외를 그대로 전파한다: 잡 상태 전이(재시도/최종
실패)는 runner가 `fail_job`으로 처리하는 책임이라 이 모듈에서 잡지 않는다.
"""
from pathlib import Path

from flatness.criteria import Criterion
from flatness.core.pipeline import analyze_floor, analyze_wall
from flatness.importer.colab_csv import import_colab_csv
from flatness.importer.json_import import import_json

from flatworker.artifacts import staging_dir
from flatworker.report.assets import build_assets
from flatworker.report.context import load_report_context
from flatworker.report.html import render_html
from flatworker.report.snapshot import build_snapshot
from flatworker.storage import get_storage


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


def _fetch_raw(storage, scan, work):
    """scans.raw_file_path(버킷-상대 규약 문자열)를 스테이징에 내려받아 경로를 준다.

    코드리뷰 Important(I1) 계승: DB(scans.raw_file_path)에는 스펙 §6.3 규약대로
    **버킷-상대 경로 문자열만** 저장된다(예: `raw-scans/{site_id}/{scan_id}/raw.ply`)
    — `data/` 접두나 OS 절대경로가 아니다. 엔진은 로컬 `Path`만 읽을 수 있으므로
    Storage에서 스테이징으로 내려받아 그 경로를 돌려준다. 이미 절대경로로 들어온
    값(과거 데이터 등)은 그대로 존중해 이중 결합을 피한다.
    """
    key = scan["raw_file_path"]
    p = Path(key)
    if p.is_absolute():           # 과거 데이터 호환: 절대경로가 저장돼 있으면 그대로 연다
        return p
    dst = work / p.name
    if not storage.download_to(key, dst):
        raise ValueError(
            f"원본 파일을 저장소에서 찾을 수 없습니다: {key}. 파일을 다시 업로드하세요.")
    return dst


def _finalize(db, analysis_id, scan_id, stats):
    """엔진 stats를 analyses 행에 반영하고 해당 스캔의 현재 분석으로 지정."""
    db.update_analysis(analysis_id, {
        "status": "done",
        "stats": stats,
        "coverage_pct": stats.get("coverage_pct"),
        "overall_verdict": overall_verdict(stats),
        "warnings": stats.get("warnings", []),
        # 코드리뷰 Important(I1) 계승: 워커 CWD 상대·OS 종속 절대경로가 아니라
        # 스펙 §6.3 규약의 버킷-상대 문자열만 저장한다 — 실제 파일은 storage.upload_dir
        # 로 이미 이 접두 아래 올라가 있다.
        "artifacts_dir": f"artifacts/{analysis_id}",
        "engine_version": stats.get("meta", {}).get("engine_version"),
        "applied_criteria": stats.get("applied_criteria"),
        "auto_summary": stats.get("auto_summary"),
    })
    db.set_current_analysis(scan_id, analysis_id)


def handle_analyze(db, cfg, payload):
    analysis_id = payload["analysis_id"]
    analysis, scan, crit, u_mm = _load_context(db, analysis_id)
    storage = get_storage(cfg, db)
    with staging_dir() as work:
        path = _fetch_raw(storage, scan, work)
        out_dir = work / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        scale_to_m = scan["unit_scale"]
        if scan["surface"] == "wall":
            stats = analyze_wall(path, scale_to_m, crit, u_mm, out_dir)
        else:
            stats = analyze_floor(path, scale_to_m, crit, u_mm, out_dir)
        storage.upload_dir(f"artifacts/{analysis_id}", out_dir)
    _finalize(db, analysis_id, analysis["scan_id"], stats)


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
    # 코드리뷰 Important(I-5): 확장자 검사를 다운로드보다 앞으로 옮긴다 - 지원하지
    # 않는 형식이면 _fetch_raw로 원본을 받아오기 전에 즉시 거부한다(클라우드에서는
    # 불필요한 다운로드가 대역폭 낭비로 이어짐). raw_file_path의 확장자는 스테이징
    # 경로의 확장자와 항상 같다(_fetch_raw가 원래 파일명을 그대로 보존해서 받음).
    suffix = Path(scan["raw_file_path"]).suffix.lower()
    importer = _IMPORT_HANDLERS.get(suffix)
    if importer is None:
        raise ValueError(
            f"지원하지 않는 임포트 파일 형식입니다: '{suffix}' (지원 형식: .csv, .json)")
    storage = get_storage(cfg, db)
    with staging_dir() as work:
        path = _fetch_raw(storage, scan, work)
        out_dir = work / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        stats = importer(path, crit, u_mm, out_dir)
        storage.upload_dir(f"artifacts/{analysis_id}", out_dir)
    _finalize(db, analysis_id, analysis["scan_id"], stats)


def handle_report(db, cfg, payload, renderer=None):
    """보고서 잡 (스펙 §8): 컨텍스트 로드 -> 자산 복사 -> snapshot -> HTML -> PDF -> 갱신.

    `renderer`는 테스트가 FakeRenderer를 넣기 위한 이음매다. 기본값은 Playwright
    렌더러이며, playwright 패키지가 없는 환경에서도 이 모듈을 import할 수 있도록
    함수 안에서 지연 import한다.

    실패는 예외를 그대로 올린다 — 잡 상태 전이(재시도/최종 실패)와 reports.gen_status
    반영은 runner의 fail_job(=fn_job_fail) 책임이다(analyze/import와 동일 규약).

    발행본 보호(2중 방어, 완전한 원자성은 DB 트랜잭션 없이는 불가능하므로 아래 두
    방어로 경합 창을 최대한 좁힌다):
    1. `load_report_context`가 컨텍스트 로드 시점에 finalized를 1회 거부하지만, 그
       뒤 `build_assets`(원격 assets 접두를 지우고 재생성)까지 가는 사이에 발행이
       확정될 수 있다. 스테이징 진입 직전에 `db.get_report`로 상태를 다시 확인해 그
       경합을 막는다(자산이 지워지기 "전"에 막는 것이 핵심 — 지운 뒤 되돌릴 방법은
       없다).
    2. 원격 객체는 `db.update_report`가 성공한 **뒤에만** 건드린다. 렌더링 도중
       (자산 복사~PDF 생성 사이, 수 초가 걸리는 Playwright 렌더 구간) 발행이
       확정되면 004의 `fn_reports_finalized_guard` 트리거가 `db.update_report`를
       42501로 거부하고, 이 함수는 스테이징만 버린 채 예외를 그대로 올린다 —
       저장소의 발행본 report.pdf·assets는 한 바이트도 바뀌지 않는다(로컬
       os.replace 방어보다 강하다: 실패해도 애초에 원격에 아무것도 쓰지 않았다).
       남는 창: `db.update_report` 성공 직후 업로드가 실패하면 DB는 done인데
       저장소 파일이 이전 버전으로 남는다. 파일시스템(Storage)과 DB를 한
       트랜잭션으로 묶을 수 없어 생기는 구조적 한계이며 은폐하지 않고 여기 명시한다.
    """
    report_id = payload["report_id"]
    storage = get_storage(cfg, db)
    ctx = load_report_context(db, storage, report_id)

    # 방어 1: 스테이징(자산 재생성) 진입 직전 재확인 — load_report_context의 검사
    # 이후 발행이 확정됐다면 원격 자산을 지우기 전에 여기서 멈춘다.
    report_now = db.get_report(report_id)
    if report_now.get("status") == "finalized":
        raise ValueError("발행된 보고서는 다시 생성할 수 없습니다. 새 보고서를 만드세요.")

    with staging_dir() as work:
        assets = build_assets(db, storage, report_id, ctx, work_dir=work)
        snapshot = build_snapshot(ctx, assets)
        html = render_html(snapshot)
        if renderer is None:
            from flatworker.report.renderer import PlaywrightRenderer
            renderer = PlaywrightRenderer()
        pdf_path = work / "report.pdf"
        renderer.render_pdf(html, work, pdf_path)

        # 방어 2: DB 갱신 성공 시에만 원격 report.pdf를 업로드한다 — 실패하면
        # 스테이징(work)이 with 블록 종료 시 통째로 지워질 뿐, 발행본은 그대로다.
        db.update_report(report_id, {
            "snapshot": snapshot,
            # 경로 계약: DB에는 버킷-상대 문자열만 (스펙 §6.3)
            "pdf_path": f"reports/{report_id}/report.pdf",
            "gen_status": "done",
            "gen_error": None,
        })
        storage.upload(f"reports/{report_id}/report.pdf", pdf_path.read_bytes(),
                       "application/pdf")

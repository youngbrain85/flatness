"""잡 핸들러 4종 (precheck/analyze/import/report) — 스펙 §5.1.7, §5.4, §8.

analyze/import/report는 실패 시 예외를 그대로 전파한다: 잡 상태 전이(재시도/최종
실패)는 runner가 `fail_job`으로 처리하는 책임이라 이 모듈에서 잡지 않는다.
"""
from pathlib import Path

from flatness.criteria import Criterion
from flatness.core.pipeline import analyze_floor, analyze_wall, judge_slope_cells
from flatness.importer.colab_csv import import_colab_csv
from flatness.importer.json_import import import_json
from flatness.outputs.slope_cells import load_slope_cells

from flatworker import slope
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


def _finalize(db, analysis_id, scan_id, stats, kind="flatness"):
    """엔진 stats를 analyses 행에 반영하고 해당 스캔·종류의 현재 분석으로 지정.

    handle_analyze(평활도 경로)와 handle_import가 공유하므로 kind 기본값을
    'flatness'로 둬 기존 호출부를 그대로 둔다. 구배는 이 함수를 재사용하지
    않는다 - 아래 파생 컬럼이 전부 stats.get() 기본값이라, 스키마가 다른 구배
    stats를 태우면 coverage_pct·overall_verdict·engine_version·applied_criteria·
    auto_summary가 조용히 NULL이 되고 잡은 '성공'으로 끝난다(태스크 노트 참고).
    구배 경로는 slope.run_slope_analysis가 만든 필드 dict를 직접 저장한다.
    """
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
    db.set_current_analysis(scan_id, analysis_id, kind=kind)


def _handle_analyze_slope(db, cfg, analysis_id):
    """analyses.kind='slope' 전용 analyze 처리 (스펙 §6.4).

    _load_context를 쓰지 않는다 - 구배 기준 행은 thresholds[0]에
    metric/pass_mm/rework_mm이 없어 그 안의 _to_criterion에서 KeyError: 'metric'
    으로 죽는다. 대신 slope.slope_context가 _to_criterion을 타지 않고 criteria
    행·threshold·drain_points를 직접 읽는다.
    """
    analysis, scan, criteria_row, threshold, drain_points = slope.slope_context(
        db, analysis_id)
    storage = get_storage(cfg, db)
    with staging_dir() as work:
        path = _fetch_raw(storage, scan, work)
        out_dir = work / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        scale_to_m = scan["unit_scale"]
        _, fields = slope.run_slope_analysis(
            path, scale_to_m, threshold, out_dir, drain_points,
            analysis_id, criteria_row)
        storage.upload_dir(f"artifacts/{analysis_id}", out_dir)
    db.update_analysis(analysis_id, fields)
    db.set_current_analysis(analysis["scan_id"], analysis_id, kind="slope")


def handle_analyze(db, cfg, payload):
    analysis_id = payload["analysis_id"]
    analysis = db.get_analysis(analysis_id)
    kind = analysis.get("kind") or "flatness"
    if kind == "slope":
        return _handle_analyze_slope(db, cfg, analysis_id)
    # 이하 기존 평활도 경로 그대로
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
    # 코드리뷰 재검토(M1): 위에서 이미 읽은 kind를 명시적으로 넘긴다. enum이
    # flatness/slope 2값뿐인 지금은 무해하지만(slope는 위에서 이미 분기해
    # 걸러짐), 세 번째 kind가 추가되면 이 자리에서 _finalize의 기본값
    # 'flatness'로 조용히 떨어져 kind 불일치 0행 매칭을 일으킬 수 있다.
    _finalize(db, analysis_id, analysis["scan_id"], stats, kind=kind)


def handle_slope_judge(db, cfg, payload):
    """재판정 잡 처리 (스펙 §7.3, §6.4) - 이미 산출된 slope_cells.json만 읽어
    판정을 다시 한다. 점군을 열지 않으므로 가볍다(수 초).

    브리프 함정 1: 배수구 좌표는 `analyses.params`가 아니라 이 payload에서 읽는다.
    잡 처리 시점에 params를 읽으면, 이 잡이 클레임된 뒤 사용자가 다른 배수구를
    다시 클릭해 params가 갱신된 경합 상황에서 "방금 클릭한 좌표"가 아니라 "그
    사이에 바뀐 좌표"로 판정해 버릴 수 있다(태스크 브리프 D4 실측 시나리오).

    브리프 함정 2: `_finalize`를 쓰지 않는다(위 주석 참고) - set_current_analysis를
    부르면 과거(is_current=false) 구배 분석을 재판정했을 때 현재 분석이 바뀐다.
    analyses.status도 건드리지 않는다 - 009가 이미 잡 큐 함수 3종(fn_job_claim/
    fn_job_fail/fn_reap_stuck_jobs)에서 진행 상태를 params.judge로만 옮기는
    규약을 세웠다(설계 결정 D5) - 워커도 같은 규약을 따라야 진행 상태 표시가
    어긋나지 않는다.

    브리프 함정 3: 단계 C까지 만들어진 구배 분석에는 slope_cells.json이 없다
    (재판정 입력이 이번 단계에 새로 생긴 산출물이므로). 화면이 이 경우를 미리
    막지만(설계 결정 D7) 워커도 명확한 한국어 예외로 방어한다.

    Task 3 리뷰 Important-1: slope_judge 잡은 정의상 배수구 클릭으로만 생긴다 -
    좌표 없는 payload는 호출자(대시보드) 버그이지 정상적인 "방향 미판정" 경로가
    아니다. 조용히 통과시키면 판정은 "성공"으로 끝나면서 방향 판정만 빠지고,
    거기다 params.drain_points까지 빈 배열로 덮여 화면의 배수구 마커가 사라진다
    (조용한 실패 - 이 저장소가 가장 경계하는 실패 양식). 그래서 여기서 시끄럽게
    거부한다.
    """
    analysis_id = payload["analysis_id"]
    drain_points_raw = payload.get("drain_points")
    if not drain_points_raw:
        raise ValueError(
            "배수구 좌표가 없는 재판정 요청입니다. 지도에서 배수구 위치를 다시 클릭한 뒤 시도하세요.")

    analysis, criteria_row, threshold = slope.slope_judge_context(db, analysis_id)

    stats_prev = analysis.get("stats") or {}
    cells_json_key = (stats_prev.get("artifacts") or {}).get("cells_json")
    if not cells_json_key:
        raise ValueError("이 분석에는 셀 데이터 파일이 없습니다. 구배 분석을 다시 실행하세요.")

    drain_points = slope.slope_drain_points({"drain_points": drain_points_raw})

    storage = get_storage(cfg, db)
    with staging_dir() as work:
        out_dir = work / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        # slope_cells.json을 out_dir 안에 내려받는다 - judge_slope_cells가 이
        # 파일을 새로 쓰지 않고 참조만 하므로(artifacts.cells_json), 여기서 미리
        # 자리를 잡아둬야 뒤이은 upload_dir로 함께 올라가 다음 재판정도 이어진다.
        cells_path = out_dir / "slope_cells.json"
        if not storage.download_to(cells_json_key, cells_path):
            raise ValueError(f"셀 데이터 파일을 저장소에서 찾을 수 없습니다: {cells_json_key}")
        cells, meta = load_slope_cells(cells_path)
        # Task 3 리뷰 Critical-2: cell_m/subcell_m의 정본은 이 셀 파일의 meta뿐이다.
        # cells의 width_m/height_m이 바로 이 cell_m으로 산출됐으므로
        # grade_slope_cells의 조각 셀 분기(width_m < cell_m/2)가 같은 값을 써야
        # 한다. analyses.stats로 조용히 물러서면(폴백) judge_slope_cells가 이제
        # cell_m을 필수 인자로 요구하게 만든 Task 1 리뷰의 강제를 워커가 키워드
        # 인자로 몰래 우회하는 셈이다.
        #
        # 2차 리뷰 M3 정정: 필수 키 결측(schema v1 등)·schema_version 불일치는
        # 이제 load_slope_cells 자신이 한국어 ValueError로 먼저 거부한다(엔진
        # 커밋 c064055) - 그런 파일은 위 load_slope_cells(cells_path) 호출에서
        # 이미 죽으므로 이 줄에 도달하지 못한다. 그래서 아래 가드가 실제로 잡는
        # 것은 "cell_m"/"subcell_m" 키는 있지만 값이 명시적으로 null인 경우
        # 뿐이다(dump_slope_cells는 이런 파일을 만들지 않으므로 정상 경로에서는
        # 도달하지 않는다). 그래도 남겨 둔다 - 실측 결과(가드를 지우고 재현),
        # 이 가드가 없으면 cell_m=None이 그대로 judge_slope_cells 안쪽까지
        # 흘러가 render_slope_map의 `L = cell_m * 0.35`에서 `TypeError:
        # unsupported operand type(s) for *: 'NoneType' and 'float'`처럼 원인을
        # 짐작하기 어려운 예외로 죽는다(`test_slope_judge_rejects_cell_file_
        # with_explicit_null_cell_m`가 이 가드 자체를 고정한다). 이 가드가
        # 있으면 대신 명확한 한국어 예외로 즉시 막힌다(SlopeCell 스키마 계약
        # 위반이므로 재시도해도 소용없다).
        if meta.get("cell_m") is None or meta.get("subcell_m") is None:
            raise ValueError(
                f"셀 데이터 파일에 cell_m/subcell_m 정보가 없습니다: {cells_json_key}. "
                "구배 분석을 다시 실행하세요.")
        cell_m = meta["cell_m"]
        subcell_m = meta["subcell_m"]
        judged_stats = judge_slope_cells(cells, threshold, out_dir,
                                         drain_points=drain_points,
                                         cell_m=cell_m, subcell_m=subcell_m)
        storage.upload_dir(f"artifacts/{analysis_id}", out_dir)

    # Task 3 리뷰 Important-3: previous_drain_points의 출처는 params가 아니라
    # stats_prev(직전 판정이 워커 자신의 update_analysis로 쓴 값)여야 한다.
    # D4가 "엔큐 먼저, 성공하면 params 쓰기" 순서를 못 박았으므로, 이 핸들러가
    # analyses 행을 읽는 시점에 params.drain_points는 이미 이번 클릭(payload와
    # 동일)의 좌표일 수 있다(대시보드 폴링이 3초 간격이라 사실상 거의 항상 이
    # 순서다) - 그 값을 previous로 쓰면 "직전"이 "방금"이 되어 D8이 만들려던
    # 되돌리기 안전장치가 무력화된다. stats_prev는 이 잡이 시작되기 전 워커
    # 자신이 마지막으로 성공시킨 판정의 결과이므로 이 경합에 영향받지 않는다.
    previous_drain_points = slope.drain_points_from_stats(stats_prev)
    fields = slope.build_slope_judge_fields(
        judged_stats, analysis_id, analysis.get("params"),
        previous_drain_points, drain_points_raw)
    db.update_analysis(analysis_id, fields)


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

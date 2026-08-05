"""잡 핸들러 (precheck/analyze/import/report/slope_judge/register) — 스펙 §5.1.7,
§5.4, §8, 세부과업 4 단계 F.

analyze/import/report는 실패 시 예외를 그대로 전파한다: 잡 상태 전이(재시도/최종
실패)는 runner가 `fail_job`으로 처리하는 책임이라 이 모듈에서 잡지 않는다.
"""
import math
from pathlib import Path

from flatness.criteria import Criterion
from flatness.core.pipeline import analyze_floor, analyze_wall, judge_slope_cells
from flatness.core.subcell import build_subcell_grid
from flatness.importer.colab_csv import import_colab_csv
from flatness.importer.json_import import import_json
from flatness.io.ply_writer import write_ply
from flatness.io.reader import iter_chunks, read_info
from flatness.outputs.height_view import (dump_height_view_meta, render_height_view,
                                          render_height_view_plain, subcell_m_for_bbox)
from flatness.outputs.slope_cells import load_slope_cells

from flatworker import registration, slope
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
    """scan_id의 단위 확정 여부를 확인해 상태를 승격/대기시키고, 곁들여 높이 뷰
    (평면도 PNG + 장식 없는 PNG + 좌표 사이드카)를 만든다(세부과업 4 단계 E,
    설계 결정 E1·E2).

    원래 스펙(§5.1.1)은 read_info→detect_units로 단위 후보를 산출해 사용자에게
    보여주는 흐름이지만, 데모 스키마의 scans 테이블에는 후보를 저장할 컬럼
    (unit_candidates 등)이 없다 — 계산해도 어디에도 남길 곳이 없다. 따라서
    scans.unit_scale이 이미 확정되어 있으면(P3 UI가 업로드 단계에서 직접 설정)
    'ready'로 승격하고, 아니면 'awaiting_unit_confirm'으로 둔다.

    높이 뷰는 그 판단을 돕는 보조 그림일 뿐이다 - 사용자가 이 그림으로 "이
    방이 8m인가 80cm인가"를 눈으로 가늠하고, 다음 단계(정합)가 사이드카의
    좌표계를 그대로 쓴다(설계 결정 E2). 렌더·업로드 실패가 위 상태 승격을
    막으면 안 된다: precheck 잡이 실패로 끝나면 fn_job_fail이
    scans.status='failed'로 만들고 사용자는 아무것도 못 한다
    (003_dashboard_support.sql) - 렌더는 편의 기능이지 필수 경로가 아니다.
    core/pipeline.py의 렌더 격리 패턴(try/except + warnings)을 그대로 따른다.

    다만 "삼킨다"와 "아무데도 안 남긴다"는 다른 문제다(1차 리뷰 지적). scans
    테이블에 warnings에 해당하는 컬럼이 없어 실패 사유를 **DB에 영속화**할 수는
    없지만, 관측 가능성은 DB 영속화와 별개다 - runner.py의 `print(f"[flatworker]
    ...")` 관례대로 표준출력에 한 줄 남긴다. 로그마저 없으면 높이 뷰가 전량
    실패해도 잡은 done, 스캔은 ready, 로그는 완전히 깨끗해서 운영자가 알아낼
    방법이 아예 없다 - docs/DEPLOY.md가 "증상 - 로그를 믿지 마라 ... Railway
    로그에는 아무것도 남지 않고 워커도 죽지 않는다(실측 확인)"고 적어 둔 바로
    그 함정이며, 이 저장소는 이미 한 번 데였다(이연 티켓 45 "보고서 생성 실패
    사유 가시성"도 같은 계열).
    """
    scan_id = payload["scan_id"]
    scan = db.get_scan(scan_id)

    fields = {"status": "ready" if scan.get("unit_scale") is not None
              else "awaiting_unit_confirm"}

    try:
        storage = get_storage(cfg, db)
        with staging_dir() as work:
            path = _fetch_raw(storage, scan, work)
            info = read_info(path)
            # 공짜 부수효과(브리프 "덤"): read_info가 이미 세어 둔 값이다.
            # point_count는 001_schema.sql에 선언만 되고 지금까지 아무도 채우지
            # 않았다. 렌더 성공 여부와 무관하게 여기서 바로 채운다 - 아래 렌더
            # 단계가 실패해도 이 값은 이미 확보됐으므로 잃지 않는다.
            fields["point_count"] = info.n_points

            # 서브셀 크기는 반드시 bbox에서 유도한다 - 고정 상수(예: 0.05)를
            # 쓰면 안 된다(설계 결정 E3). precheck는 정의상 단위 미확정 상태에서
            # 도는 잡이라 mm 단위 파일이 정상 입력인데, 8000 x 6000(mm) 파일에
            # 0.05를 그대로 주면 nx=160,000 x ny=120,000 격자가 되어 median_z
            # 배열 하나만 71GB다. 컨테이너에서는 OOM Kill(SIGKILL)이라 아래
            # except로도 못 잡고 워커 프로세스가 통째로 죽는다 - 잡은
            # processing에 고착됐다가 30분 뒤 reap -> 재시도 -> 재사망을
            # 반복한다.
            subcell_m = subcell_m_for_bbox(info)
            # scale_to_m=1.0 고정(설계 결정 E3): 이 시점엔 scans.unit_scale이
            # 아직 확정되지 않았을 수 있다(애초에 이 잡의 목적이 그 확정을 돕는
            # 것이다) - 파일이 담은 좌표를 원 단위 그대로 격자화한다. 더 강한
            # 이유가 하나 더 있다(1차 리뷰): 사이드카는 bbox_min을 info(원 파일
            # 단위)에서, subcell_m_file을 grid.size_m(scale_to_m이 이미 곱해진
            # 값)에서 가져온다 - scale_to_m != 1.0이면 좌표 환산식
            # (world = bbox_min + (i+0.5) * subcell_m_file)이 "스케일 안 된
            # bbox + 스케일 된 서브셀"을 섞어 조용히 깨진다.
            grid = build_subcell_grid(iter_chunks(path), info, 1.0, subcell_m)

            out_dir = work / "out"
            out_dir.mkdir(parents=True, exist_ok=True)
            # 유효 서브셀이 하나도 없어도(점이 너무 성기거나 손상) 렌더·업로드
            # 한다. 이전 구현은 여기서 건너뛰었고 "형체 없는 회색 한 장을 근거로
            # 사용자가 단위를 잘못 확정할 위험이 그림이 아예 없음보다 크다"고
            # 정당화했는데, **그 전제가 더 이상 사실이 아니다**(결정 번복).
            # Task 1이 1차 리뷰 반영(엔진 커밋 032980a)으로 전부-NaN일 때
            # 거짓 컬러바를 아예 만들지 않고 "유효 데이터 없음 - 점 밀도 부족"
            # 이라고 한국어로 못 박게 바꿨다. 그러고도 X·Y 축 눈금은 진짜 bbox
            # 값을 "파일 단위" 라벨과 함께 찍는다 - mm 단위 파일이면 그 축이
            # 8000 x 6000으로 읽힌다. **축 눈금이 곧 단위의 답이라 높이 색깔은
            # 단위 판단에 필요조차 없다.** 건너뛰면 그 유일한 단서를 지우고 그
            # 자리에 아무 표시도 남기지 않는다 - 게다가 예외가 아니라 의도적
            # 분기라 로그조차 남지 않았다.
            render_height_view(grid, out_dir / "height_view.png")
            # 장식 없는 PNG를 하나 더 낸다: 격자 1칸 = 이미지 1픽셀이라 브라우저
            # 클릭 좌표를 월드 좌표로 되돌릴 수 있다(render_height_view_plain
            # 독스트링의 좌표 계약). 장식 PNG(제목·여백·컬러바)로는 그 역산이
            # 불가능해 다음 단계(정합, 단계 F)가 막힌다. DB 컬럼을 새로 만들지
            # 않는다 - 사이드카 JSON과 같은 관례로, 다음 단계가
            # scans.height_view_path에서 파일명만 바꿔 유도한다
            # (height_view.png -> height_view_plain.png).
            render_height_view_plain(grid, out_dir / "height_view_plain.png")
            # 사이드카 파일명은 PNG와 같은 basename·같은 디렉터리 규약을
            # 따른다(height_view.png -> height_view.json) - 다음 단계
            # (정합)가 scans.height_view_path 하나에서 확장자만 바꿔
            # 사이드카 키를 유도할 수 있게 하기 위함이다.
            dump_height_view_meta(grid, info, out_dir / "height_view.json")
            # artifacts/scans/{scan_id}/ — raw-scans/가 아니다(설계 결정
            # E2). raw-scans는 authenticated가 전면 쓰기 가능이라
            # (005_storage_buckets.sql) 워커 산출물이 브라우저 업로드에
            # 덮일 수 있다. artifacts는 authenticated 읽기 전용·
            # service_role 쓰기라 "워커가 쓰고 대시보드가 읽는다"에 맞는다.
            storage.upload_dir(f"artifacts/scans/{scan_id}", out_dir)
            # DB에는 버킷-상대 문자열만 저장한다(slope.py의
            # normalize_slope_stats와 동일한 관례) - 스테이징 절대경로가
            # 아니다.
            fields["height_view_path"] = f"artifacts/scans/{scan_id}/height_view.png"
    except Exception as e:
        # 렌더·업로드는 편의 기능 - 실패해도 위에서 정한 상태 승격은 그대로
        # 진행한다. 다만 조용히 삼키지는 않는다(독스트링 참고): runner.py의
        # `[flatworker]` 접두 관례로 한 줄 남겨, 높이 뷰가 전량 실패하는
        # 상황을 운영자가 Railway 로그에서 알아챌 수 있게 한다.
        print(f"[flatworker] 높이 뷰 생성 실패 (scan_id={scan_id}) - 스캔 상태 승격은 "
              f"그대로 진행합니다: {type(e).__name__}: {e}")

    # 남는 위험(은폐하지 않고 명시한다, handle_report의 발행본 보호 주석과 같은
    # 태도): status·point_count·height_view_path를 한 PATCH로 묶어 보내므로,
    # 010_scan_height_view.sql(height_view_path 컬럼)을 아직 적용하지 않은 DB에
    # 이 코드를 먼저 배포하면 fields에 height_view_path가 담긴 이번 PATCH
    # 전체가 42703(undefined_column)으로 실패해 상태 승격까지 함께 막힐 수
    # 있다 - 007/kind 배포 순서 사고(docs/DEPLOY.md 1절)와 같은 종류의 위험이다.
    # 해법은 런타임 방어가 아니라 배포 순서다: 010은 반드시 이 코드보다 먼저
    # 적용한다(docs/DEPLOY.md·docs/SUPABASE_SETUP.md에 명시).
    db.update_scan(scan_id, fields)


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


def _merged_scan_fields(source_scan, registration_id, merged):
    """병합 점군 -> 새 scans 행 필드 (설계 결정 F9).

    현장·위치·표면·측정자 등 맥락은 첫 번째 원본(A)에서 그대로 물려받는다 - 정합은
    "같은 위치를 두 번 나눠 찍은 것"을 하나로 되돌리는 작업이라 A와 B의 맥락이
    같다는 것이 전제다(다른 위치라면 애초에 겹치지 않는다).

    - `lineage='registered'`: `fused_mesh`를 재사용하면 업로드 화면이 그 값에 붙인
      "앱이 스무딩한 데이터라 실제보다 양호하게 나올 수 있습니다" 경고가 거짓이
      된다 - 정합 병합은 스캐너 앱의 스무딩이 아니라 원시 점군 두 개의 서브셀
      중앙값이다(설계 결정 F9).
    - `unit_scale=1.0`: 병합 점군은 이미 미터로 환산돼 있다.
    - `status='ready'`: precheck를 다시 돌릴 이유가 없다(단위가 확정돼 있고
      point_count도 여기서 채운다).
    """
    return {
        "location_id": source_scan["location_id"],
        "surface": source_scan["surface"],
        "scanned_at": source_scan["scanned_at"],
        "device": source_scan.get("device"),
        "operator_id": source_scan.get("operator_id"),
        "operator_name_manual": source_scan.get("operator_name_manual"),
        "selected_criteria_id": source_scan.get("selected_criteria_id"),
        # 경로 계약: DB에는 버킷-상대 문자열만 (스펙 §6.3). raw-scans/가 아니라
        # artifacts/다 - raw-scans는 authenticated가 전면 쓰기 가능이라
        # (005_storage_buckets.sql) 워커 산출물이 브라우저 업로드에 덮일 수 있다
        # (설계 결정 E2와 같은 이유). 이 파일은 사용자가 올린 원본이 아니라
        # 워커가 만든 산출물이다.
        "raw_file_path": f"artifacts/registrations/{registration_id}/merged.ply",
        "original_filename": "merged.ply",
        "file_format": "ply",
        "point_count": len(merged),
        "unit_scale": 1.0,
        "lineage": "registered",
        "status": "ready",
    }


def handle_register(db, cfg, payload):
    """정합 잡 (세부과업 4 단계 F) — 두 스캔을 대응점으로 정합해 병합 스캔 하나를
    만든다. payload는 `{"registration_id": "<uuid>"}`.

    흐름: registrations 읽기 -> processing -> **소스 A를 끝까지 처리 -> 그 다음
    소스 B**(설계 결정 F3의 순차 처리) -> 정합 -> 병합 -> 업로드 -> 새 scans 행
    -> registrations 확정.

    **실패를 두 갈래로 나눈다.**

    (1) 정합 자체의 실패(중첩 부족·RMSE 초과처럼 `RegistrationResult.converged`가
        거짓인 경우)는 `registrations.status='failed'` + `error_text`로 끝내고
        **예외를 올리지 않는다.** 두 가지 이유다 -
        - `jobs` 테이블은 RLS 정책이 0개라 대시보드가 못 읽는다(설계 결정 F10).
          사유는 반드시 registrations에 있어야 화면이 보여줄 수 있다.
        - 같은 입력으로 다시 돌려도 결과가 같다. 예외로 올리면 fn_job_fail이
          10초·20초 뒤 **무거운 잡을 두 번 더** 돌리고, 그동안 화면은
          '정합 중'으로 되돌아갔다가 실패한다(사용자가 사유를 못 본다).
    (2) 그 밖의 오류(원본 파일 없음, 단위 미확정, 대응점 형식 오류, 업로드 실패
        등)는 예외를 그대로 올린다 - analyze/import/report와 같은 규약이며,
        012의 fn_job_fail register 분기가 재시도·최종 실패를 registrations에
        반영한다(재시도로 회복될 여지가 있는 종류다).

    병합 스캔은 정합이 성공했을 때만 만든다 - 쓰레기 스캔이 목록에 남으면 안 된다.
    원본 두 스캔은 읽기만 하고 건드리지 않는다(스펙 §6.3).
    """
    registration_id = payload["registration_id"]
    reg = db.get_registration(registration_id)

    scan_ids = list(reg.get("source_scan_ids") or [])
    if len(scan_ids) != 2:
        # 3개 이상 다중 정합은 단계 F 범위 밖이다(계획서 "범위 밖").
        raise ValueError(f"정합은 스캔 2개만 지원합니다(현재 {len(scan_ids)}개).")
    corr_a, corr_b = registration.correspondence_arrays(reg.get("correspondences"))

    scan_a = db.get_scan(scan_ids[0])
    scan_b = db.get_scan(scan_ids[1])
    db.update_registration(registration_id, {"status": "processing", "error_text": None})

    storage = get_storage(cfg, db)
    with staging_dir() as work:
        # ★ 설계 결정 F3: 소스를 **하나씩** 끝낸다. A의 격자를 버린 뒤에 B를
        #   시작해야 한다 - build_subcell_grid의 정렬 버퍼가 점당 12B라 두 개를
        #   동시에 들면 실측 피크 1.31GiB 위에 겹쳐 쌓여 2GiB 게이트를 넘긴다.
        #   내려받는 디렉터리도 나눈다: 두 원본의 파일명이 보통 똑같아서
        #   (raw.ply) 같은 스테이징에 받으면 뒤엣것이 앞엣것을 덮어쓴다.
        pts_a = registration.load_source_points(
            _fetch_raw(storage, scan_a, work / "a"), scan_a.get("unit_scale"))
        pts_b = registration.load_source_points(
            _fetch_raw(storage, scan_b, work / "b"), scan_b.get("unit_scale"))

        # B를 A에 맞춘다(A가 기준). 대응점의 단위 환산은 align_sources가 한다.
        result = registration.align_sources(
            pts_b, pts_a, corr_b, corr_a,
            scan_b.get("unit_scale"), scan_a.get("unit_scale"))
        if not result.converged:
            db.update_registration(registration_id, {
                "status": "failed",
                "error_text": result.failure_reason or "정합에 실패했습니다.",
                # 실패해도 관측치는 남긴다 - 화면이 "왜 실패했나"를 수치로 보여줄 수
                # 있어야 사용자가 대응점을 다시 찍을지 스캔을 다시 뜰지 판단한다.
                # 대응이 3쌍 미만이면 엔진이 NaN을 내므로 그때는 비워 둔다.
                "rmse_mm": (result.rmse_m * 1000.0
                            if math.isfinite(result.rmse_m) else None),
                "overlap_ratio": result.overlap_ratio,
                "iterations": result.iterations,
            })
            return

        merged = registration.merge_clouds(
            pts_a, registration.apply_transform(pts_b, result.transform))

        out_dir = work / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        write_ply(merged, out_dir / "merged.ply")
        storage.upload_dir(f"artifacts/registrations/{registration_id}", out_dir)
        scan_id = db.insert_scan(_merged_scan_fields(scan_a, registration_id, merged))

    db.update_registration(registration_id, {
        "transform": registration.transform_to_json(result.transform),
        # 엔진은 미터(rmse_m), DB 컬럼은 mm다. 이 환산을 빠뜨리면 화면이
        # 0.0018mm 같은 값을 보여주며 **항상 합격으로 읽힌다**(조용한 실패).
        "rmse_mm": float(result.rmse_m) * 1000.0,
        "iterations": result.iterations,
        "overlap_ratio": float(result.overlap_ratio),
        "result_scan_id": scan_id,
        "status": "done",
        "error_text": None,
    })

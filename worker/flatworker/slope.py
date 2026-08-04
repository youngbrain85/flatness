"""구배 분석(세부과업 4) 워커 로직 — 스펙 §6.4.

평활도와 잡 타입을 공유한다(analyze). 워커가 analysis_id로 행을 읽으므로 종류가
그 안에 들어 있고, 잡 타입을 새로 만들 이유가 없다. 다만 엔진 입력·stats 스키마·
판정 어휘가 전부 달라서 경로를 분리한다.

재판정(slope_judge, 스펙 §7.3)도 이 모듈이 함께 다룬다 - analyze와 조회/변환
로직(criteria kind 검사·drain_points 변환·stats 정규화·overall_verdict 매핑)을
그대로 공유하기 때문이다.
"""
from datetime import datetime, timezone

from flatness import ENGINE_VERSION
from flatness.core.pipeline import analyze_slope

# 구배 등급(한국어) -> analyses.overall_verdict enum. '판정불가'는 대응하는 enum
# 멤버가 없어 의도적으로 빠져 있다 - 판정을 만들어내지 않고 NULL로 둔다.
_VERDICT = {"재시공": "rework", "보수": "repair", "경계": "borderline", "적합": "pass"}
_WORST_FIRST = ("재시공", "보수", "경계")


def slope_overall_verdict(stats):
    """구배 stats -> 종합 판정. 평활도 overall_verdict와 같은 우선순위 규칙."""
    counts = (stats.get("summary") or {}).get("counts") or {}
    if not any(counts.get(g, 0) for g in _VERDICT):
        return None
    for grade in _WORST_FIRST:
        if counts.get(grade, 0) > 0:
            return _VERDICT[grade]
    return "pass"


def slope_drain_points(params):
    """analyses.params -> 엔진이 받는 (x, y) 리스트.

    스펙 §3.5는 params에 [{"x":3.2,"y":5.1}] 형태를 규정했는데 엔진은 p[0]/p[1]
    인덱싱과 `for x, y in ...` 언패킹을 한다. 변환 없이 넘기면 KeyError: 0이다.
    """
    pts = (params or {}).get("drain_points") or []
    return [(float(p["x"]), float(p["y"])) for p in pts] or None


def drain_points_from_stats(stats):
    """judge_slope_cells가 낸 stats["drain_points"](예: [[3.2, 5.1], ...] - 정렬된
    좌표쌍) -> 스펙 §3.5 표준 형태([{"x":3.2,"y":5.1}, ...])로 되돌린다.

    Task 3 리뷰 Important-3: 재판정의 previous_drain_points는 params가 아니라
    이 stats에서 가져와야 한다 - params.drain_points는 D4의 "엔큐 먼저, 성공하면
    params 쓰기" 순서 때문에 워커가 analyses 행을 읽는 시점에 이미 "이번 클릭"
    좌표로 덮여 있을 수 있다. stats는 직전 판정이 워커 자신의 update_analysis로
    쓴 값이라 이 경합에 영향받지 않는 유일하게 신뢰할 수 있는 출처다.

    slope_drain_points의 역함수이지만 입력 스키마가 다르다(dict가 아니라
    [x, y] 좌표쌍 리스트) - stats는 judge_slope_cells가 이미 그 형태로 낸다.
    params.drain_points와 동일한 §3.5 형태로 되돌려야 화면(대시보드)이
    previous_drain_points를 drain_points와 같은 스키마로 읽을 수 있다.
    """
    pairs = (stats or {}).get("drain_points") or []
    return [{"x": p[0], "y": p[1]} for p in pairs] or None


def normalize_slope_stats(stats, analysis_id):
    """DB 저장 전 정규화. 원본을 건드리지 않고 사본을 돌려준다.

    엔진은 artifacts에 스테이징 **절대경로**를 넣는데 그 디렉터리는 잡이 끝나면
    지워진다(artifacts.staging_dir). 스펙 §6.3 규약대로 버킷-상대 문자열로 바꾼다.
    호스트 파일시스템 경로가 클라이언트에 노출되는 문제도 함께 사라진다.
    """
    out = dict(stats)
    # 코드리뷰 재검토(M3): stats["summary"]["coverage_pct"]처럼 대괄호로 읽는다.
    # .get() 기본값을 쓰면 엔진 키가 바뀌었을 때 조용히 빈 dict가 되고, 이는
    # 이 태스크가 없애려던 바로 그 실패 양식(조용한 결측)을 재도입하는 것이다.
    art = stats["artifacts"]
    out["artifacts"] = {
        k: f"artifacts/{analysis_id}/{str(v).replace(chr(92), '/').rsplit('/', 1)[-1]}"
        for k, v in art.items()
    }
    return out


def _require_slope_criteria(criteria_row, analysis_id, criteria_id):
    """criteria_row.kind가 'slope'가 아니면 명시적으로 거부한다(공유 검사).

    코드리뷰 재검토(M4): 여기서 막지 않으면 평활도 기준 행이 잘못 연결됐을 때
    grade_slope_cells 안쪽 깊은 곳에서 KeyError: 'design_pct'로 죽어 원인
    파악이 어렵다. 여기서 명시적으로 거부하면 진단이 쉬워진다. slope_context
    (analyze)와 slope_judge_context(재판정) 양쪽이 공유한다.
    """
    if criteria_row.get("kind") != "slope":
        raise ValueError(
            f"구배 분석(analysis_id={analysis_id})에 kind='slope'가 아닌 기준이 "
            f"연결되어 있습니다: criteria_id={criteria_id}, "
            f"criteria.kind={criteria_row.get('kind')!r}"
        )


def slope_context(db, analysis_id):
    """analysis -> scan -> criteria 순으로 로드해 구배 엔진 입력을 만들어 반환.

    jobs.py의 `_load_context`와 짝을 이루되 `_to_criterion`을 타지 않는다 - 구배
    기준 행은 thresholds[0]에 metric/pass_mm/rework_mm이 없어 `_to_criterion`을
    통과시키면 KeyError: 'metric'으로 죽는다. criteria_id는 버튼 클릭 시점에
    fn_resolve_criteria(site_id, 'floor', 'slope')로 이미 해석돼
    analyses.criteria_id에 들어 있으므로 그대로 읽기만 한다(설계 결정 표 참고).
    """
    analysis = db.get_analysis(analysis_id)
    scan = db.get_scan(analysis["scan_id"])
    criteria_row = db.get_criteria(analysis["criteria_id"])
    _require_slope_criteria(criteria_row, analysis_id, analysis["criteria_id"])
    threshold = criteria_row["thresholds"][0]
    drain_points = slope_drain_points(analysis.get("params"))
    return analysis, scan, criteria_row, threshold, drain_points


def slope_judge_context(db, analysis_id):
    """재판정(slope_judge) 잡의 analysis -> criteria -> threshold 로딩.

    slope_context와 달리 scan을 읽지 않는다 - 재판정은 점군을 다시 열지 않으므로
    (스펙 §7.3) scan 행이 필요 없다. drain_points도 여기서 읽지 않는다 - 브리프
    함정 1: 잡 처리 시점에 analyses.params를 읽으면, 이 잡이 클레임된 뒤 사용자가
    다른 배수구를 다시 클릭해 params가 갱신된 경우 그 새 좌표로 판정해 버리는
    경합이 생긴다. 좌표는 반드시 호출자가 payload에서 읽어 넘겨야 한다.
    """
    analysis = db.get_analysis(analysis_id)
    criteria_row = db.get_criteria(analysis["criteria_id"])
    _require_slope_criteria(criteria_row, analysis_id, analysis["criteria_id"])
    threshold = criteria_row["thresholds"][0]
    return analysis, criteria_row, threshold


def _iso_now():
    """UTC 현재 시각을 초 단위 ISO-8601('...Z')로. report/snapshot.py와 같은 관례."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_slope_judge_fields(stats, analysis_id, old_params, previous_drain_points,
                             drain_points_raw):
    """재판정 결과(judge_slope_cells의 stats) -> analyses 갱신 필드 dict.

    브리프 함정 2: `_finalize`를 쓰지 않는다 - 그 함수는 set_current_analysis를
    불러 과거(is_current=false) 구배 분석을 재판정해도 현재 분석 포인터를
    바꿔버린다. 갱신 대상은 stats·coverage_pct·overall_verdict·warnings·params
    뿐이다 - status는 여기서도 절대 건드리지 않는다(009가 잡 큐 함수 3종에서
    이미 그 규약을 세웠다 - 설계 결정 D5).

    params는 PATCH가 전체 컬럼을 통째로 대체하므로(부분 병합이 아님) 기존
    params를 복사해 drain_points·judge 두 키만 갱신한 새 dict를 만들어 돌려준다.

    previous_drain_points는 호출자가 이미 계산해 넘긴다(Task 3 리뷰 Important-3) -
    `old_params.get("drain_points")`를 여기서 다시 읽지 않는다. old_params는 D4의
    경합 때문에 이미 "이번 클릭" 좌표로 덮여 있을 수 있어(대시보드가 엔큐 성공
    직후 params를 쓰므로, 이 핸들러가 analyses 행을 읽는 시점엔 대개 이미 반영돼
    있다) previous의 출처로 못 쓴다 - 호출자가 stats_prev(직전 판정이 워커
    자신이 쓴 값)에서 뽑아 넘긴 것을 그대로 신뢰한다. judge.previous_drain_points
    에 남기는 이유는 설계 결정 D8 - 산출물이 x-upsert:true로 무조건 덮이므로
    이전 판정을 되돌릴 유일한 단서다.
    """
    old_params = dict(old_params or {})
    new_params = dict(old_params)
    new_params["drain_points"] = drain_points_raw
    new_params["judge"] = {
        "state": "done",
        "at": _iso_now(),
        "previous_drain_points": previous_drain_points,
    }
    return {
        "stats": normalize_slope_stats(stats, analysis_id),
        "coverage_pct": stats["summary"]["coverage_pct"],
        "overall_verdict": slope_overall_verdict(stats),
        "warnings": stats["warnings"],
        "params": new_params,
    }


def run_slope_analysis(path, scale_to_m, threshold, out_dir, drain_points,
                       analysis_id, criteria_row):
    """엔진(analyze_slope) 호출 + analyses 행에 반영할 필드 dict 계산.

    analyze_floor/analyze_wall의 `_finalize`를 재사용하지 않는다 - 그 함수의
    파생 컬럼은 전부 stats.get() 기본값이라, 형태가 다른 구배 stats를 태우면
    coverage_pct·overall_verdict·engine_version·applied_criteria·auto_summary가
    조용히 NULL이 되고 잡은 '성공'으로 끝난다(태스크 노트 참고). 여기서 구배
    stats 스키마에 맞춰 직접 매핑한다.

    auto_summary는 구배용 종합의견 문안이 아직 없어 None으로 둔다(단계 D에서
    화면과 함께 정한다 - 억지로 문장을 지어내지 않는다).
    """
    stats = analyze_slope(path, scale_to_m, threshold, out_dir,
                          drain_points=drain_points)
    fields = {
        "status": "done",
        "stats": normalize_slope_stats(stats, analysis_id),
        "coverage_pct": stats["summary"]["coverage_pct"],
        "overall_verdict": slope_overall_verdict(stats),
        # 엔진이 낸 한국어 문장을 그대로 저장한다(평활도는 ASCII 슬러그 +
        # WARNING_LABEL 번역이지만 구배는 완성 문장이다 - 설계 결정 표 참고).
        # 코드리뷰 재검토(M3): 대괄호로 읽는다 - .get() 기본값은 엔진 키가
        # 바뀌었을 때 조용히 빈 리스트가 되어 버린다.
        "warnings": stats["warnings"],
        "artifacts_dir": f"artifacts/{analysis_id}",
        "engine_version": ENGINE_VERSION,
        "applied_criteria": {"name": criteria_row["name"],
                             "source": criteria_row["source_text"], **threshold},
        "auto_summary": None,
    }
    return stats, fields

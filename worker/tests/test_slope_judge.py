"""재판정(slope_judge) 잡 핸들러 — 스펙 §7.3, §6.4.

세부과업 4 단계 D 태스크 3 브리프의 네 함정을 각각 변이로 잡는다:
1) 좌표는 payload에서 읽어야 한다(params를 읽으면 경합이 생긴다)
2) `_finalize`(set_current_analysis)를 쓰면 안 된다
3) slope_cells.json이 없는 분석은 명확한 한국어 예외로 막는다
4) 직전 배수구 좌표를 params.judge.previous_drain_points에 남긴다
"""
import json

import pytest

from flatness import ENGINE_VERSION
from flatness.core.slope import SlopeCell
from flatness.outputs.slope_cells import dump_slope_cells

from flatworker.config import Config
from flatworker.jobs import handle_slope_judge
from flatworker.runner import run_loop, _DEFAULT_HANDLERS
from flatworker.storage import get_storage
from tests.fake_db import FakeDB


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _threshold():
    return {"design_pct": 2.0, "pass_pct": 1.0, "re_pct": 3.0, "dir_pass_deg": 30.0}


def _cell():
    """크기 편차 0(slope_pct == design_pct) 셀 하나 - 등급이 오직 방향에만
    좌우되게 만들어 "어느 배수구 좌표로 판정했는가"를 등급으로 바로 드러낸다.
    downhill_rad=0.0은 중심(1,1)에서 +x 방향으로 물이 흐른다는 뜻이다.
    """
    return SlopeCell(0, 0, 1.0, 1.0, 1600, 2.0, 0.0, 0.001, 0.01, 2.0, 2.0, True)


def _seed_judgeable_analysis(db, cfg, tmp_path, *, analysis_id="a1", scan_id="scan1",
                             params_drain_points=None, stats_drain_points=None,
                             status="done", warnings=None, coverage_pct=None,
                             file_cell_m=2.0, file_subcell_m=0.05,
                             db_cell_m=None, db_subcell_m=None):
    """slope_judge 잡이 소비할 analyses 행 + slope_cells.json 산출물을 미리 심는다.

    재판정은 점군을 열지 않으므로(스펙 §7.3) raw 스캔 파일이 필요 없다 - 셀을
    직접 만들어 slope_cells.json에 담는다(engine/tests/test_slope_cells.py와
    동일한 접근 - SlopeCell을 직접 구성해 판정 경계를 결정론적으로 통제한다).

    file_cell_m/file_subcell_m: slope_cells.json의 meta에 실제로 실리는 값
    (정본 - 핸들러가 유일하게 읽어야 하는 값, Task 3 리뷰 Critical-2). db_cell_m/
    db_subcell_m: analyses.stats에 심는 값(더 이상 핸들러가 읽지 않는다 - 오직
    "핸들러가 이 값을 무시하는지" 검증용) - 지정하지 않으면 file_* 값과 같게
    맞춘다.

    params_drain_points: analyses.params.drain_points에 심는 값 - "현재 표시된
    배수구"다. stats_drain_points([x,y] 좌표쌍 리스트, judge_slope_cells의 stats
    형식)는 analyses.stats.drain_points에 심는 값 - "직전 판정이 실제로 쓴
    배수구"다(Task 3 리뷰 Important-3: previous_drain_points의 정본). D4의 경합
    때문에 이 둘은 보통 값이 같지 않다 - 재판정 핸들러가 잡을 처리할 시점엔
    대시보드가 이미 params를 이번 클릭 좌표로 덮어써 놓았을 때가 많다.
    """
    if db_cell_m is None:
        db_cell_m = file_cell_m
    if db_subcell_m is None:
        db_subcell_m = file_subcell_m

    storage = get_storage(cfg, db)
    seed_path = tmp_path / "seed" / analysis_id / "slope_cells.json"
    seed_path.parent.mkdir(parents=True, exist_ok=True)
    dump_slope_cells([_cell()], str(seed_path), engine_version=ENGINE_VERSION,
                     cell_m=file_cell_m, subcell_m=file_subcell_m)
    storage.upload(f"artifacts/{analysis_id}/slope_cells.json",
                   seed_path.read_bytes(), "application/json")

    db.criteria["c-slope"] = {"id": "c-slope", "surface": "floor", "kind": "slope",
                              "name": "test-slope-judge",
                              "source_text": "테스트 전용 구배 기준 - 재판정 검증용",
                              "thresholds": [_threshold()]}
    params = {}
    if params_drain_points is not None:
        params["drain_points"] = params_drain_points
    db.analyses[analysis_id] = {
        "id": analysis_id, "scan_id": scan_id, "kind": "slope",
        "criteria_id": "c-slope", "status": status, "params": params,
        "warnings": warnings if warnings is not None else ["옛 판정의 낡은 경고"],
        "coverage_pct": coverage_pct if coverage_pct is not None else 13.0,
        "stats": {"format": "slope-stats-v1", "cell_m": db_cell_m, "subcell_m": db_subcell_m,
                  "drain_points": stats_drain_points,
                  "artifacts": {"cells_json": f"artifacts/{analysis_id}/slope_cells.json",
                                "cells_csv": f"artifacts/{analysis_id}/slope_cells.csv",
                                "map_png": f"artifacts/{analysis_id}/slope_map.png"}},
    }
    return analysis_id


def test_slope_judge_reads_coordinates_from_payload_not_params(tmp_path):
    """경합 방지의 핵심(브리프 함정 1). params에는 반대 방향(A, -x)을, payload에는
    downhill과 일치하는 방향(B, +x)을 둔다. params를 읽으면 역구배(재시공)로,
    payload를 읽으면 적합으로 나온다 - 등급 자체가 증거다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path,
                                   params_drain_points=[{"x": -10.0, "y": 1.0}])

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    row = db.analyses[aid]
    assert row["overall_verdict"] == "pass"                    # payload(B) 기준 -> 적합
    assert row["stats"]["summary"]["counts"]["재시공"] == 0     # params(A) 기준이면 1이었을 것
    assert row["stats"]["drain_points"] == [[10.0, 1.0]]        # 저장된 것도 B


def test_slope_judge_does_not_call_set_current_analysis(tmp_path, monkeypatch):
    """브리프 함정 2 - `_finalize`를 쓰면 set_current_analysis가 불려 과거
    (is_current=false) 구배 분석을 재판정해도 현재 분석 포인터가 바뀐다.
    set_current_analysis가 호출되는 즉시 테스트를 실패시켜 잡는다(기존
    test_slope_job.py의 동일 패턴).
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path, analysis_id="past-1")
    db.current_analysis[("scan1", "slope")] = "current-1"  # 다른 분석이 현재로 세워져 있음
    monkeypatch.setattr(
        db, "set_current_analysis",
        lambda *a, **k: pytest.fail("재판정이 set_current_analysis를 부르면 안 된다(_finalize 오용)"))

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    assert db.current_analysis[("scan1", "slope")] == "current-1"  # 그대로 유지


def test_slope_judge_does_not_touch_analyses_status(tmp_path):
    """설계 결정 D5 - analyses.status는 재판정과 무관하게 시종 유지돼야 한다
    (재판정 실패가 반복돼도 이미 성공한 구배 결과 화면이 사라지면 안 된다)."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path, status="done")

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    assert db.analyses[aid]["status"] == "done"


def test_slope_judge_raises_korean_error_when_cells_json_missing(tmp_path):
    """브리프 함정 3 - 단계 C까지 만들어진 구배 분석에는 slope_cells.json이 없다
    (D1에서 새로 생긴 산출물이므로). 화면이 미리 막지만(설계 결정 D7) 워커도
    명확한 한국어 예외로 방어해야 한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    db.criteria["c-slope"] = {"id": "c-slope", "surface": "floor", "kind": "slope",
                              "name": "x", "source_text": "x",
                              "thresholds": [_threshold()]}
    db.analyses["old-1"] = {
        "id": "old-1", "scan_id": "scan1", "kind": "slope", "criteria_id": "c-slope",
        "status": "done", "params": {},
        # 단계 C 산출물 - cells_json 키 자체가 없다.
        "stats": {"artifacts": {"cells_csv": "artifacts/old-1/slope_cells.csv",
                                "map_png": "artifacts/old-1/slope_map.png"}},
    }

    with pytest.raises(ValueError, match="셀 데이터 파일이 없습니다"):
        handle_slope_judge(db, cfg, {"analysis_id": "old-1",
                                     "drain_points": [{"x": 1.0, "y": 1.0}]})


def test_slope_judge_raises_korean_error_when_storage_object_missing(tmp_path):
    """stats에는 cells_json 키가 있지만 실제 Storage 객체가 없는 경우(예: 수동
    삭제·경로 오기) - "셀 데이터 파일이 없습니다"(stats 키 부재) 경로와 구분되는
    다른 한국어 메시지("찾을 수 없습니다" - Storage 404)로 거부해야 한다. 두
    실패 원인을 뭉뚱그리면 사용자가 "구배 분석을 다시 실행하세요"만 보고 실제
    원인(파일 유실)을 파악하지 못한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    db.criteria["c-slope"] = {"id": "c-slope", "surface": "floor", "kind": "slope",
                              "name": "x", "source_text": "x", "thresholds": [_threshold()]}
    db.analyses["a1"] = {
        "id": "a1", "scan_id": "scan1", "kind": "slope", "criteria_id": "c-slope",
        "status": "done", "params": {},
        # cells_json 키는 있지만 실제로 storage.upload를 한 적이 없다.
        "stats": {"artifacts": {"cells_json": "artifacts/a1/slope_cells.json"}},
    }

    with pytest.raises(ValueError, match="찾을 수 없습니다"):
        handle_slope_judge(db, cfg, {"analysis_id": "a1",
                                     "drain_points": [{"x": 1.0, "y": 1.0}]})


def test_slope_judge_rejects_non_slope_criteria(tmp_path):
    """slope_judge_context도 slope_context와 같은 kind 검사를 공유한다(_require_
    slope_criteria) - 구배 기준이 아닌 criteria가 잘못 연결됐을 때 grade_slope_cells
    안쪽 깊은 곳에서 KeyError: 'design_pct'로 죽지 않고 여기서 명시적으로
    거부해야 진단이 쉽다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    db.criteria["c-flat"] = {"id": "c-flat", "surface": "floor", "kind": "flatness",
                             "name": "x", "source_text": "x",
                             "thresholds": [{"span_m": 3, "metric": "flatness",
                                             "pass_mm": 7, "rework_mm": 21}]}
    db.analyses["a1"] = {"id": "a1", "scan_id": "scan1", "kind": "slope",
                         "criteria_id": "c-flat", "status": "done", "params": {}}

    with pytest.raises(ValueError, match="연결되어"):
        handle_slope_judge(db, cfg, {"analysis_id": "a1",
                                     "drain_points": [{"x": 1.0, "y": 1.0}]})


def test_slope_judge_rejects_payload_missing_drain_points(tmp_path):
    """Task 3 리뷰 Important-1 - slope_judge 잡은 정의상 배수구 클릭으로만
    생긴다. payload에 drain_points 자체가 없는 것은 정상적인 "방향 미판정"
    입력이 아니라 호출자(대시보드) 버그다. 조용히 통과시키면 방향 판정 없이
    "성공"으로 끝나면서 params.drain_points까지 빈 배열로 덮여 배수구 마커가
    사라진다 - 시끄럽게 거부해야 한다. 거부 전에 DB를 건드리지 않았는지(배수구
    마커가 그대로인지)도 함께 확인한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path,
                                   params_drain_points=[{"x": 3.0, "y": 4.0}])

    with pytest.raises(ValueError, match="배수구 좌표가 없는"):
        handle_slope_judge(db, cfg, {"analysis_id": aid})  # drain_points 키 자체가 없음

    assert db.analyses[aid]["params"]["drain_points"] == [{"x": 3.0, "y": 4.0}]  # 안 지워짐


def test_slope_judge_rejects_payload_with_empty_drain_points_list(tmp_path):
    """빈 리스트([])도 "좌표 없음"과 동일하게 거부한다 - `payload.get(...) or []`
    관용구가 None과 빈 리스트를 같은 폴백으로 뭉뚱그리는 것을 이용해 실수로
    빈 리스트를 보내는 호출자 버그도 놓치지 않는다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path,
                                   params_drain_points=[{"x": 3.0, "y": 4.0}])

    with pytest.raises(ValueError, match="배수구 좌표가 없는"):
        handle_slope_judge(db, cfg, {"analysis_id": aid, "drain_points": []})

    assert db.analyses[aid]["params"]["drain_points"] == [{"x": 3.0, "y": 4.0}]


def test_slope_judge_previous_drain_points_comes_from_stats_when_dashboard_already_wrote_params(tmp_path):
    """Task 3 리뷰 Important-3(가장 흔한 경합 순서) - D4는 "엔큐 먼저, 성공하면
    params 쓰기" 순서를 못 박았다. 대시보드 폴링이 3초 간격이라 이 핸들러가
    analyses 행을 읽는 시점엔 대개 이미 params.drain_points가 "이번 클릭"(payload와
    동일) 좌표로 덮여 있다. 이 상황을 그대로 재현한다: params는 새 좌표(payload와
    동일), stats(직전 판정이 워커 자신이 쓴 값)는 실제 이전 좌표. params에서
    읽으면 previous가 "방금"이 되어버려 D8의 되돌리기 안전장치가 무력화된다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    old_pts_pairs = [[-10.0, 1.0]]           # 직전 판정이 실제로 쓴 좌표(stats)
    new_pts = [{"x": 10.0, "y": 1.0}]        # 이번 클릭(payload) - 대시보드가 이미 params에 반영
    aid = _seed_judgeable_analysis(db, cfg, tmp_path,
                                   params_drain_points=new_pts,       # 대시보드가 먼저 씀(경합에서 이김)
                                   stats_drain_points=old_pts_pairs)  # 직전 판정의 실제 좌표

    handle_slope_judge(db, cfg, {"analysis_id": aid, "drain_points": new_pts})

    params = db.analyses[aid]["params"]
    assert params["drain_points"] == new_pts
    assert params["judge"]["state"] == "done"
    # params(이미 new_pts로 덮여 있음)가 아니라 stats(진짜 직전 좌표)에서 와야 한다.
    assert params["judge"]["previous_drain_points"] == [{"x": -10.0, "y": 1.0}]
    assert params["judge"]["at"]  # D5 스키마 {state,at,error} - at도 비어 있으면 안 된다


def test_slope_judge_previous_drain_points_correct_when_worker_reads_before_dashboard_writes(tmp_path):
    """반대 순서(드물지만 가능한 경합)도 같은 정답을 내야 한다 - 워커가 analyses
    행을 읽는 시점에 아직 대시보드가 params를 덮어쓰기 전이라 params.drain_points가
    여전히 옛 좌표다. stats에서 읽는 한 어느 순서든 결과가 달라지지 않아야
    한다(출처를 stats로 고정했으므로 params의 타이밍과 무관해진 것이 핵심).
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    old_pts = [{"x": -10.0, "y": 1.0}]
    aid = _seed_judgeable_analysis(db, cfg, tmp_path,
                                   params_drain_points=old_pts,        # 대시보드가 아직 안 씀
                                   stats_drain_points=[[-10.0, 1.0]])  # 직전 판정의 실제 좌표(동일)

    new_pts = [{"x": 10.0, "y": 1.0}]
    handle_slope_judge(db, cfg, {"analysis_id": aid, "drain_points": new_pts})

    params = db.analyses[aid]["params"]
    assert params["drain_points"] == new_pts
    assert params["judge"]["previous_drain_points"] == old_pts


def test_slope_judge_previous_drain_points_is_none_on_first_judge(tmp_path):
    """분석은 배수구 없이 한 번만 돈다(스펙 §7.3) - 최초 재판정 시점에는 직전
    판정(analyze_slope) 자체가 배수구 없이 끝났을 수 있어 stats.drain_points가
    None이다. 이 경우 previous_drain_points는 조용히 None이어야지, 예외로
    죽거나 이전 값을 지어내면 안 된다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path)  # stats_drain_points 없음(None)

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    assert db.analyses[aid]["params"]["judge"]["previous_drain_points"] is None


def test_slope_judge_reuses_original_cell_m_and_subcell_m(tmp_path):
    """원본 analyze_slope가 쓴 격자 크기를 재판정도 그대로 물려받아야 한다 -
    이미 산출된 셀(고정된 width_m/height_m)과 렌더·stats 단위가 어긋나면 안 된다.
    정상 경로(파일 meta와 DB stats가 같은 값)를 재현한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path, file_cell_m=3.5, file_subcell_m=0.1)

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    row = db.analyses[aid]
    assert row["stats"]["cell_m"] == 3.5
    assert row["stats"]["subcell_m"] == 0.1


def test_slope_judge_prefers_cell_file_meta_over_stale_db_stats(tmp_path):
    """cell_m/subcell_m의 정본은 slope_cells.json의 meta다 - DB(analyses.stats)는
    폴백일 뿐이다(코디네이터 판단, Task 1 리뷰 I1 이후). 이 셀 파일의
    width_m/height_m이 바로 이 cell_m으로 산출됐으므로, grade_slope_cells의
    조각 셀 분기(width_m < cell_m/2)가 DB의 다른 값을 쓰면 판정이 어긋난다.
    두 값을 일부러 다르게 줘서 파일 meta가 이겼는지 직접 확인한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path,
                                   file_cell_m=3.5, file_subcell_m=0.1,
                                   db_cell_m=9.9, db_subcell_m=9.9)  # DB는 낡은/틀린 값

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    row = db.analyses[aid]
    assert row["stats"]["cell_m"] == 3.5      # 파일 meta가 이겼다(DB의 9.9가 아님)
    assert row["stats"]["subcell_m"] == 0.1


def test_slope_judge_rejects_cell_file_with_explicit_null_cell_m(tmp_path):
    """2차 리뷰 M3 - `load_slope_cells` 자신의 검증(엔진 커밋 `c064055`)은 필수
    키의 "존재 여부"만 본다(`"cell_m" not in payload`) - 키는 있지만 값이
    명시적으로 null인 파일은 그 검증을 통과시킨다. `dump_slope_cells`는 이런
    파일을 만들지 않으므로(필수 인자라 None을 넘기면 그 시점에 이미 잘못된
    호출이다) 정상 API로는 재현할 수 없다 - 저장소를 직접 조작해 시뮬레이션한다.
    이 좁은 틈을 워커의 가드(jobs.py)가 여전히 막는다는 것을 증명해, "이제
    도달 불가능하니 지워도 된다"는 오판을 막는다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path)
    storage = get_storage(cfg, db)

    raw = json.loads(storage.download(f"artifacts/{aid}/slope_cells.json"))
    raw["cell_m"] = None  # 키는 유지하되 값만 오염 - load_slope_cells의 키-존재
    # 검사는 통과하지만(모든 필수 키가 있다) 워커의 None 검사는 걸려야 한다.
    storage.upload(f"artifacts/{aid}/slope_cells.json",
                   json.dumps(raw).encode("utf-8"), "application/json")

    with pytest.raises(ValueError, match="cell_m/subcell_m 정보가 없습니다"):
        handle_slope_judge(db, cfg, {"analysis_id": aid,
                                     "drain_points": [{"x": 10.0, "y": 1.0}]})


def test_slope_judge_registered_in_default_handlers():
    """러너 등록(Step 5) - runner._DEFAULT_HANDLERS에 slope_judge가 이 모듈의
    handle_slope_judge로 정확히 배선돼 있어야 한다."""
    assert _DEFAULT_HANDLERS["slope_judge"] is handle_slope_judge


def test_slope_judge_job_runs_through_runner_end_to_end(tmp_path):
    """enqueue_job("slope_judge", ...) -> run_loop -> handle_slope_judge까지
    실제로 이어지는지, 그리고 009의 fn_job_claim이 processing으로 표시한 뒤
    핸들러가 done으로 덮어쓰는 전체 흐름이 FakeDB로도 재현되는지 확인한다
    (fake_db.py가 009의 새 분기를 실제 SQL만큼 엄격하게 흉내내야 한다).
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path)
    jid = db.enqueue_job("slope_judge", {"analysis_id": aid,
                                         "drain_points": [{"x": 10.0, "y": 1.0}]})

    run_loop(db, cfg, max_iterations=1)

    assert db.jobs[jid]["status"] == "done"
    assert db.analyses[aid]["params"]["judge"]["state"] == "done"
    assert db.analyses[aid]["status"] == "done"  # slope_judge가 status를 건드리지 않았음


def test_slope_judge_normalizes_judged_json_artifact_path(tmp_path):
    """엔진이 새로 내는 slope_judged.json(셀별 판정 결과 - 화면이 읽을 산출물)이
    stats["artifacts"]에 "judged_json" 키로 얹혀 나온다. 이 핸들러는 artifacts
    딕셔너리를 특정 키 이름으로 분기하지 않고 통째로 normalize_slope_stats에
    넘기므로, 새 키가 생겨도 코드 변경 없이 버킷-상대 경로로 정규화돼야 한다
    (스테이징 절대경로가 DB에 그대로 새면 안 된다 - I1 계승).
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path)

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    artifacts = db.analyses[aid]["stats"]["artifacts"]
    assert artifacts["judged_json"] == f"artifacts/{aid}/slope_judged.json"
    assert not str(artifacts["judged_json"]).startswith("/")  # 절대경로 유출 없음
    # 다른 산출물도 여전히 정상 정규화되는지 함께 확인(회귀 방지)
    assert artifacts["cells_json"] == f"artifacts/{aid}/slope_cells.json"
    assert artifacts["cells_csv"] == f"artifacts/{aid}/slope_cells.csv"
    assert artifacts["map_png"] == f"artifacts/{aid}/slope_map.png"


def test_slope_judge_reversed_drain_point_yields_rework_verdict(tmp_path):
    """Task 3 리뷰 Important-4(A17) 방어 - 다른 테스트는 전부 "적합" 케이스만
    단언하므로 overall_verdict를 상수 "pass"로 하드코딩해도 그 테스트들을
    통과해 버린다(유일한 단언이 `== "pass"`). 역구배가 나오는 시나리오에서
    overall_verdict가 실제로 "rework"인지 직접 확인해 grade -> enum 배선을
    양쪽 방향 모두 검증한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path)

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": -10.0, "y": 1.0}]})  # downhill과 반대

    assert db.analyses[aid]["overall_verdict"] == "rework"


def test_slope_judge_overwrites_stale_warnings(tmp_path):
    """Task 3 리뷰 Important-4 필수 항목 - 옛 판정의 낡은 경고가 DB에 남아 있어도,
    재판정은 이번 judge_slope_cells가 새로 계산한 warnings로 완전히 덮어써야
    한다. 배수구를 지정했고(Important-1 이후 항상 그렇다) 판정불가 셀도 없는
    이 픽스처에서는 새 warnings가 빈 리스트이므로, 남아 있다면 곧 갱신 누락이다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path, warnings=["옛 판정의 낡은 경고"])

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    assert db.analyses[aid]["warnings"] == []


def test_slope_judge_overwrites_stale_coverage_pct(tmp_path):
    """Task 3 리뷰 Important-4 필수 항목 - DB에 남아 있던 낡은 coverage_pct(13.0)가
    이번 판정이 새로 계산한 값(단일 유효 셀 -> 100.0)으로 갱신되는지 확인한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path, coverage_pct=13.0)

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    assert db.analyses[aid]["coverage_pct"] == 100.0


def test_slope_judge_uploads_fresh_artifacts_after_each_judge(tmp_path):
    """Task 3 리뷰 Important-4(A3) 방어 - upload_dir을 건너뛰면 DB(stats)는 최신
    판정을 가리키는데 저장소의 CSV/PNG/judged.json은 이전 판정 그대로 남아,
    다운로드한 사용자만 다른(더 옛날) 결과를 본다. 같은 분석을 방향이 다른
    배수구로 두 번 재판정하고, 매번 저장소에서 slope_judged.json을 직접 내려받아
    등급이 실제로 최신 판정을 반영하는지 확인한다(DB 필드가 아니라 저장소
    원본을 읽어야 이 결함을 잡을 수 있다).
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path)
    storage = get_storage(cfg, db)

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": -10.0, "y": 1.0}]})  # 1차: 역구배
    first = json.loads(storage.download(f"artifacts/{aid}/slope_judged.json"))
    assert first["cells"][0]["grade"] == "재시공"

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})   # 2차: 정방향
    second = json.loads(storage.download(f"artifacts/{aid}/slope_judged.json"))
    assert second["cells"][0]["grade"] == "적합"  # 저장소도 최신 판정으로 갱신됐다

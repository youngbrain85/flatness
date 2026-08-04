"""재판정(slope_judge) 잡 핸들러 — 스펙 §7.3, §6.4.

세부과업 4 단계 D 태스크 3 브리프의 네 함정을 각각 변이로 잡는다:
1) 좌표는 payload에서 읽어야 한다(params를 읽으면 경합이 생긴다)
2) `_finalize`(set_current_analysis)를 쓰면 안 된다
3) slope_cells.json이 없는 분석은 명확한 한국어 예외로 막는다
4) 직전 배수구 좌표를 params.judge.previous_drain_points에 남긴다
"""
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
                             old_drain_points=None, status="done"):
    """slope_judge 잡이 소비할 analyses 행 + slope_cells.json 산출물을 미리 심는다.

    재판정은 점군을 열지 않으므로(스펙 §7.3) raw 스캔 파일이 필요 없다 - 셀을
    직접 만들어 slope_cells.json에 담는다(engine/tests/test_slope_cells.py와
    동일한 접근 - SlopeCell을 직접 구성해 판정 경계를 결정론적으로 통제한다).
    """
    storage = get_storage(cfg, db)
    seed_path = tmp_path / "seed" / analysis_id / "slope_cells.json"
    seed_path.parent.mkdir(parents=True, exist_ok=True)
    dump_slope_cells([_cell()], str(seed_path), engine_version=ENGINE_VERSION)
    storage.upload(f"artifacts/{analysis_id}/slope_cells.json",
                   seed_path.read_bytes(), "application/json")

    db.criteria["c-slope"] = {"id": "c-slope", "surface": "floor", "kind": "slope",
                              "name": "test-slope-judge",
                              "source_text": "테스트 전용 구배 기준 - 재판정 검증용",
                              "thresholds": [_threshold()]}
    params = {}
    if old_drain_points is not None:
        params["drain_points"] = old_drain_points
    db.analyses[analysis_id] = {
        "id": analysis_id, "scan_id": scan_id, "kind": "slope",
        "criteria_id": "c-slope", "status": status, "params": params,
        "stats": {"format": "slope-stats-v1", "cell_m": 2.0, "subcell_m": 0.05,
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
                                   old_drain_points=[{"x": -10.0, "y": 1.0}])

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


def test_slope_judge_records_previous_drain_points(tmp_path):
    """설계 결정 D8 - 산출물이 x-upsert:true로 무조건 덮이므로 직전 배수구
    좌표를 params.judge.previous_drain_points에 남겨야 사용자가 되돌릴 단서가
    생긴다. 동시에 params.drain_points·judge.state='done'도 함께 확인한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    old_pts = [{"x": -10.0, "y": 1.0}]
    aid = _seed_judgeable_analysis(db, cfg, tmp_path, old_drain_points=old_pts)

    new_pts = [{"x": 10.0, "y": 1.0}]
    handle_slope_judge(db, cfg, {"analysis_id": aid, "drain_points": new_pts})

    params = db.analyses[aid]["params"]
    assert params["drain_points"] == new_pts
    assert params["judge"]["state"] == "done"
    assert params["judge"]["previous_drain_points"] == old_pts


def test_slope_judge_previous_drain_points_is_none_on_first_judge(tmp_path):
    """분석은 배수구 없이 한 번만 돈다(스펙 §7.3) - 최초 재판정 시점에는 params에
    drain_points 자체가 없을 수 있다. 이 경우 previous_drain_points는 조용히
    None이어야지, 예외로 죽거나 이전 값을 지어내면 안 된다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path)  # old_drain_points 없음

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    assert db.analyses[aid]["params"]["judge"]["previous_drain_points"] is None


def test_slope_judge_reuses_original_cell_m_and_subcell_m(tmp_path):
    """원본 analyze_slope가 쓴 격자 크기를 재판정도 그대로 물려받아야 한다 -
    이미 산출된 셀(고정된 width_m/height_m)과 렌더·stats 단위가 어긋나면 안 된다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_judgeable_analysis(db, cfg, tmp_path)
    db.analyses[aid]["stats"]["cell_m"] = 3.5
    db.analyses[aid]["stats"]["subcell_m"] = 0.1

    handle_slope_judge(db, cfg, {"analysis_id": aid,
                                 "drain_points": [{"x": 10.0, "y": 1.0}]})

    row = db.analyses[aid]
    assert row["stats"]["cell_m"] == 3.5
    assert row["stats"]["subcell_m"] == 0.1


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

"""FakeDB E2E 스모크 — 러너(run_loop) 경유 전체 흐름을 한 번에 검증한다:
엔큐 -> claim -> 핸들러 실행 -> complete -> analyses 완료 -> 산출물 파일 존재.

test_jobs.py(handle_analyze를 직접 호출해 핸들러 로직만 검증)·test_runner.py(스텁
핸들러로 디스패치/재시도 로직만 검증)와 겹치지 않는 지점: 여기서는 run_loop이 실제
프로덕션 핸들러(flatworker.jobs.handle_analyze)를 호출해 실제 엔진 산출물을 만들어
내는 것까지 하나의 흐름으로 확인한다. 아울러 FakeDB의 analyses.status 부수효과
(claim -> processing; supabase/migrations/002_functions_seed.sql의 fn_job_claim
시맨틱 모사, worker/tests/fake_db.py 참고)가 러너 경유로도 그대로 관측되는지 함께
확인한다.
"""
from tests.synthetic_helpers import synthetic
flat_floor, add_bump, write_binary_ply = synthetic.flat_floor, synthetic.add_bump, synthetic.write_binary_ply
from flatworker.config import Config
from flatworker.jobs import handle_analyze
from flatworker.runner import run_loop
from flatworker.artifacts import raw_scan_dir, artifacts_dir
from tests.fake_db import FakeDB


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _seed_floor_scan(db, cfg):
    # test_jobs.py의 시드와 동일 구성(함몰 10mm 바닥) — 산출물이 실제로 나오는지만
    # 확인하면 되므로 판정 등급 자체는 이 테스트의 관심사가 아니다.
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_binary_ply(pts, sd / "raw.ply")
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "floor",
                         # 스펙 §6.3 규약대로 버킷-상대 문자열만 저장(data_dir 접두 없음)
                         "raw_file_path": "raw-scans/site1/scan1/raw.ply", "unit_scale": 1.0,
                         "status": "ready", "selected_criteria_id": "c1"}
    db.criteria["c1"] = {"id": "c1", "surface": "floor", "name": "floor-kcs-exposed",
                         "source_text": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)",
                         "thresholds": [{"span_m": 3, "metric": "flatness", "pass_mm": 7, "rework_mm": 21}]}
    db.app_settings["uncertainty_mm"] = {"floor": 5.0, "wall": 8.0}
    db.analyses["a1"] = {"id": "a1", "scan_id": "scan1", "surface": "floor",
                         "criteria_id": "c1", "status": "queued"}
    return "a1"


def test_e2e_enqueue_to_artifacts_via_runner(tmp_path):
    """엔큐 -> run_loop -> analyses done -> artifacts 파일 존재까지 러너 경유 확인 +
    claim 직후(핸들러 실행 전) analyses.status가 이미 'processing'인지 관측한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_floor_scan(db, cfg)
    jid = db.enqueue_job("analyze", {"analysis_id": aid})

    assert db.analyses[aid]["status"] == "queued"  # 실행 전

    observed_mid_status = {}

    def _analyze_and_observe(d, c, payload):
        # run_loop이 claim을 마친 뒤(잡 status=processing, analyses도 부수효과로
        # processing) 이 핸들러를 호출하므로, 여기서 관측한 값이 곧 claim 직후
        # 상태다. 이후 실제 프로덕션 핸들러를 그대로 실행해 진짜 산출물을 만든다.
        observed_mid_status["status"] = d.get_analysis(payload["analysis_id"])["status"]
        handle_analyze(d, c, payload)

    run_loop(db, cfg, handlers={"analyze": _analyze_and_observe}, max_iterations=1)

    assert observed_mid_status["status"] == "processing"  # claim -> processing 전이 확인
    assert db.jobs[jid]["status"] == "done"
    assert db.analyses[aid]["status"] == "done"  # 핸들러가 update_analysis로 직접 갱신
    out_dir = artifacts_dir(cfg.data_dir, aid)
    assert (out_dir / "stats.json").exists()
    assert (out_dir / "cells.json").exists()
    assert (out_dir / "heatmap.png").exists()
    assert db.current_analysis.get("scan1") == aid  # set_current_analysis 반영


def test_e2e_unknown_job_type_fails_without_touching_analyses(tmp_path):
    """대조군: 핸들러가 등록되지 않은 잡 타입에도 run_loop이 죽지 않고 fail_job으로
    정상 종결하는지 확인한다(P4 완료 후에는 'report'도 등록된 타입이므로 가상의
    타입명을 쓴다). 또한 payload에 analysis_id가 들어있어도(이 타입이 analyses를
    참조할 일은 실제로는 없지만, 게이트 자체를 시험하기 위해 일부러 넣는다) analyze
    타입이 아니면 FakeDB의 analyses.status 부수효과(fake_db.py
    `_sync_linked_analysis_status`의 `job["type"] != "analyze"` 게이트)가 발동하지
    않아야 한다 — test_runner.py::test_runner_unknown_type_fails_terminally는
    analyses를 아예 시드하지 않으므로(부수효과 유무를 검증할 대상 자체가 없음) 이
    테스트가 실질적으로 다른 커버리지를 갖는다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    db.analyses["a1"] = {"id": "a1", "status": "queued"}
    jid = db.enqueue_job("future-job-type", {"report_id": "r1", "analysis_id": "a1"})
    run_loop(db, cfg, max_iterations=1)
    assert "핸들러 없음" in db.jobs[jid]["error"]
    assert db.analyses["a1"]["status"] == "queued"  # type != 'analyze' -> 부수효과 미발동

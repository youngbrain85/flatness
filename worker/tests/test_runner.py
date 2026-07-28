from flatworker.runner import run_loop
from tests.fake_db import FakeDB


def _cfg(tmp_path):
    from flatworker.config import Config
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def test_runner_dispatch_and_complete(tmp_path):
    db = FakeDB()
    calls = []
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    run_loop(db, _cfg(tmp_path), handlers={"analyze": lambda d, c, p: calls.append(p)},
             max_iterations=3)
    assert calls == [{"analysis_id": "a1"}]
    assert db.jobs[jid]["status"] == "done"


def test_runner_handler_exception_fails_job(tmp_path):
    db = FakeDB()
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    def boom(d, c, p):
        raise ValueError("분석 실패 사유")
    run_loop(db, _cfg(tmp_path), handlers={"analyze": boom}, max_iterations=1)
    assert db.jobs[jid]["status"] == "queued"   # 1회 실패 → 재시도 대기
    assert "분석 실패 사유" in db.jobs[jid]["error"]


def test_runner_unknown_type_fails_terminally(tmp_path):
    db = FakeDB()
    jid = db.enqueue_job("report", {"report_id": "r1"})  # P4 전이라 핸들러 없음
    run_loop(db, _cfg(tmp_path), handlers={}, max_iterations=1)
    assert "핸들러 없음" in db.jobs[jid]["error"]

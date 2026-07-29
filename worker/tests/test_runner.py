from datetime import datetime, timedelta, timezone

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
    # handlers={}로 기본 핸들러 맵을 우회하므로 실제 등록 여부와 무관하게 "핸들러
    # 없음" 경로를 시험한다('report'는 P4 완료 후 _DEFAULT_HANDLERS에 있지만 여기선
    # 빈 맵을 넘겨 무관하게 만든다).
    jid = db.enqueue_job("report", {"report_id": "r1"})
    run_loop(db, _cfg(tmp_path), handlers={}, max_iterations=1)
    assert "핸들러 없음" in db.jobs[jid]["error"]


class _NullRowStubDB:
    """코드리뷰 Critical(C1) 재현용 최소 스텁 — SupabaseRest의 null-id 가드를 거치지
    않고 곧장 이 형태를 반환한다. `fn_job_claim`은 `returns jobs`(setof가 아닌
    컴포지트)라, 대기 잡이 없으면 PostgREST가 0행이 아니라 **전 컬럼이 null인 1행**을
    내놓는다(docs/SUPABASE_SETUP.md §3(2) 참고) — SupabaseRest.claim_job에 가드가
    없던 시절엔 이 dict가 그대로 runner까지 흘러들어가 `job is None` 검사를 통과한
    뒤 `fail_job(None, ...)`이 uuid 캐스트 400으로 죽었다. FakeDB.claim_job은 애초에
    None을 반환해 이 경로를 재현할 수 없으므로 별도 스텁으로 직접 주입한다.
    """

    def __init__(self):
        self.reap_called = False

    def reap_stuck_jobs(self, timeout_minutes=30):
        self.reap_called = True
        return 0

    def claim_job(self):
        return {"id": None, "type": None, "payload": None, "status": None,
                "attempts": None, "max_attempts": None, "run_after": None,
                "locked_at": None, "locked_by": None, "error": None,
                "created_at": None, "started_at": None, "finished_at": None}

    def fail_job(self, job_id, error):
        # 실 SupabaseRest라면 str(None)="None"이 uuid 캐스트에 실패해 DBError를
        # 던졌을 지점 — 이 스텁도 호출되면 즉시 실패시켜, runner가 애초에 이
        # 경로를 타지 않고(유휴로 취급하고) 넘어가야 함을 증명한다.
        raise AssertionError("전-null 잡에 대해 fail_job이 호출되면 안 됨(유휴로 처리돼야 함)")

    def complete_job(self, job_id):
        raise AssertionError("전-null 잡에 대해 complete_job이 호출되면 안 됨")


def test_runner_idles_on_all_null_claim_row_without_crash(tmp_path):
    db = _NullRowStubDB()
    # 크래시 없이(스텁의 fail_job/complete_job 둘 다 호출되지 않고) 유휴로 넘어가야 함.
    run_loop(db, _cfg(tmp_path), handlers={"analyze": lambda d, c, p: None}, max_iterations=1)
    assert db.reap_called is True


def test_runner_reaps_stuck_jobs_at_start(tmp_path):
    """run_loop 시작 시 reap_stuck_jobs()가 1회 호출되어 고착 잡을 되돌리는지 확인한다.

    max_iterations=0으로 반복 본문 자체를 건너뛰어(클레임/디스패치 개입 없이) reap
    단독 효과만 관측한다.
    """
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "processing"}
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    db.claim_job()  # status=processing, locked_at=지금
    db.jobs[jid]["locked_at"] = datetime.now(timezone.utc) - timedelta(minutes=31)  # 고착 상황 재현

    run_loop(db, _cfg(tmp_path), handlers={}, max_iterations=0)

    assert db.jobs[jid]["status"] == "queued"
    assert db.jobs[jid]["locked_at"] is None
    assert db.analyses["a1"]["status"] == "queued"

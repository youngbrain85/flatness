from datetime import datetime, timedelta, timezone

from tests.fake_db import FakeDB


def test_claim_and_complete_lifecycle():
    db = FakeDB()
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    job = db.claim_job()
    assert job["id"] == jid and job["status"] == "processing" and job["attempts"] == 1
    assert db.claim_job() is None  # 동시 클레임 차단(단일 워커 시맨틱)
    db.complete_job(jid)
    assert db.jobs[jid]["status"] == "done"


def test_fail_retries_then_dead():
    db = FakeDB()
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    for i in range(3):
        job = db.claim_job(ignore_backoff=True)
        assert job is not None, f"{i+1}번째 클레임 실패"
        db.fail_job(jid, f"err{i}")
    assert db.jobs[jid]["status"] == "failed"  # max_attempts=3 소진
    assert db.claim_job(ignore_backoff=True) is None


def test_analyze_job_status_propagates_to_linked_analysis():
    """fn_job_claim/fn_job_fail(002_functions_seed.sql)이 type='analyze'이고
    payload.analysis_id가 있으면 연결된 analyses.status를 함께 갱신하는 부수효과를
    FakeDB도 그대로 모사해야 한다: 클레임 -> processing, 재시도 여지 있는 실패 ->
    queued, max_attempts 소진 실패 -> failed.
    """
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "queued"}
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})

    # 1·2번째 클레임+실패: 재시도 여지가 남아 잡도 analyses도 queued로 복귀
    for i in range(2):
        job = db.claim_job(ignore_backoff=True)
        assert job is not None, f"{i+1}번째 클레임 실패"
        assert db.analyses["a1"]["status"] == "processing"
        db.fail_job(jid, f"err{i}")
        assert db.jobs[jid]["status"] == "queued"
        assert db.analyses["a1"]["status"] == "queued"

    # 3번째(마지막) 클레임+실패: max_attempts(3) 소진 -> 잡·analyses 모두 영구 실패
    job = db.claim_job(ignore_backoff=True)
    assert job is not None
    assert db.analyses["a1"]["status"] == "processing"
    db.fail_job(jid, "err2")
    assert db.jobs[jid]["status"] == "failed"
    assert db.analyses["a1"]["status"] == "failed"


def test_complete_job_does_not_touch_linked_analysis_status():
    """fn_job_complete(002_functions_seed.sql)는 analyses를 건드리지 않는다
    (주석: "analyses.status는 워커가 결과 저장 시 함께 갱신하므로 여기선 잡만 종결") —
    handle_analyze가 이미 update_analysis(status=done, ...)로 직접 갱신하기 때문.
    """
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "processing"}
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    db.claim_job()
    db.complete_job(jid)
    assert db.jobs[jid]["status"] == "done"
    assert db.analyses["a1"]["status"] == "processing"  # complete_job은 손대지 않음(그대로)


def test_reap_stuck_jobs_requeues_timed_out_processing_job_and_syncs_analysis():
    """fn_reap_stuck_jobs(002_functions_seed.sql 119-135행대) 시맨틱 확인:
    locked_at이 timeout(기본 30분)을 넘긴 processing 잡은 queued로 되돌리고,
    연결된 analyses가 processing이면 함께 queued로 되돌린다.
    """
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "processing"}
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    db.claim_job()  # status=processing, locked_at=지금, analyses도 processing으로 전이
    db.jobs[jid]["locked_at"] = datetime.now(timezone.utc) - timedelta(minutes=31)  # 고착 재현

    n = db.reap_stuck_jobs()  # 기본 timeout_minutes=30

    assert n == 1
    assert db.jobs[jid]["status"] == "queued"
    assert db.jobs[jid]["locked_at"] is None
    assert db.jobs[jid]["locked_by"] is None
    assert db.analyses["a1"]["status"] == "queued"


def test_reap_stuck_jobs_leaves_recent_processing_job_untouched():
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "processing"}
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    db.claim_job()  # locked_at = 방금 -> 타임아웃 미도달

    n = db.reap_stuck_jobs()

    assert n == 0
    assert db.jobs[jid]["status"] == "processing"
    assert db.analyses["a1"]["status"] == "processing"

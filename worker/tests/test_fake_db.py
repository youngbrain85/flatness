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

"""FakeDB — 실 Supabase 없이 워커 로직을 검증하기 위한 인메모리 DBClient 구현.

`fn_job_claim`/`fn_job_complete`/`fn_job_fail`(supabase/migrations/002_functions_seed.sql)의
시맨틱을 그대로 모사한다: 클레임은 queued & run_after 통과 잡 중 가장 오래된 것,
실패 시 attempts가 max_attempts에 도달하면 'failed'로 종결, 그렇지 않으면
`run_after = now() + 10s * attempts`로 재큐잉한다.
"""
from datetime import datetime, timedelta, timezone
from itertools import count
from uuid import uuid4

from flatworker.db import DBClient

_seq_counter = count()


def _now():
    return datetime.now(timezone.utc)


class FakeDB(DBClient):
    def __init__(self):
        self.jobs = {}

    # -- 잡 큐 -----------------------------------------------------------
    def enqueue_job(self, type_, payload):
        job_id = str(uuid4())
        self.jobs[job_id] = {
            "id": job_id,
            "type": type_,
            "payload": payload,
            "status": "queued",
            "attempts": 0,
            "max_attempts": 3,
            "run_after": _now(),
            "locked_at": None,
            "locked_by": None,
            "error": None,
            "created_at": _now(),
            "started_at": None,
            "finished_at": None,
            "_seq": next(_seq_counter),  # created_at 시각 분해능 한계 회피용 생성 순서
        }
        return job_id

    def claim_job(self, ignore_backoff=False):
        now = _now()
        candidates = [
            j for j in self.jobs.values()
            if j["status"] == "queued" and (ignore_backoff or j["run_after"] <= now)
        ]
        if not candidates:
            return None
        job = min(candidates, key=lambda j: j["_seq"])
        job["status"] = "processing"
        job["locked_at"] = now
        job["locked_by"] = "fake-worker"
        job["attempts"] += 1
        job["started_at"] = job["started_at"] or now
        return dict(job)

    def complete_job(self, job_id):
        job = self.jobs[job_id]
        job["status"] = "done"
        job["finished_at"] = _now()
        job["locked_at"] = None
        job["locked_by"] = None

    def fail_job(self, job_id, error):
        job = self.jobs[job_id]
        job["error"] = error
        if job["attempts"] >= job["max_attempts"]:
            job["status"] = "failed"
            job["finished_at"] = _now()
        else:
            job["status"] = "queued"
            job["run_after"] = _now() + timedelta(seconds=10 * job["attempts"])
        job["locked_at"] = None
        job["locked_by"] = None

"""FakeDB — 실 Supabase 없이 워커 로직을 검증하기 위한 인메모리 DBClient 구현.

`fn_job_claim`/`fn_job_complete`/`fn_job_fail`(supabase/migrations/002_functions_seed.sql을
003_dashboard_support.sql이 확장 재정의한 최종 버전)의 시맨틱을 그대로 모사한다:
클레임은 queued & run_after 통과 잡 중 가장 오래된 것, 실패 시 attempts가
max_attempts에 도달하면 'failed'로 종결, 그렇지 않으면
`run_after = now() + 10s * attempts`로 재큐잉한다.

부수효과(SQL 원문 그대로 대조, P3 최종 픽스 웨이브 Important 1 반영):
- type이 'analyze' 또는 'import'이고 payload.analysis_id가 있으면 연결된
  analyses.status도 함께 전이한다 — fn_job_claim은 'processing', fn_job_fail은
  재시도 여지가 있으면 'queued'/max_attempts 소진이면 'failed'로. fn_job_complete는
  analyses를 건드리지 않는다(주석: "analyses.status는 워커가 결과 저장 시 함께
  갱신하므로 여기선 잡만 종결" — handle_analyze/handle_import가 이미
  update_analysis(status=done, ...)로 직접 갱신하기 때문).
- type이 'precheck'이고 payload.scan_id가 있으면 연결된 scans.status를 전이한다
  (003_dashboard_support.sql 신규) — fn_job_claim은 scans를 건드리지 않는다
  (scan_status enum에 'processing' 상당 값이 없음). fn_job_fail은 최종 실패 시
  'failed', 재큐(재시도) 시 'uploaded'로 되돌린다.
대상 행이 self.analyses/self.scans에 없으면(실 Postgres의 UPDATE가 매칭 행 0건이어도
에러 없이 지나가는 것과 동일하게) 조용히 건너뛴다.
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
        self.scans = {}
        self.criteria = {}
        self.app_settings = {}
        self.analyses = {}
        self.current_analysis = {}  # scan_id -> analysis_id (is_current 대체)

    # -- 내부 헬퍼 -----------------------------------------------------------
    def _sync_linked_analysis_status(self, job, status):
        """type in ('analyze', 'import') + payload.analysis_id 잡의 analyses.status
        부수효과.

        fn_job_claim/fn_job_fail SQL의 `if v_job.type in ('analyze', 'import') and
        (v_job.payload ? 'analysis_id') then update analyses set status = ...`를
        그대로 옮긴 것(003_dashboard_support.sql 확장) — fn_job_complete는 이 헬퍼를
        호출하지 않는다(SQL이 analyses를 건드리지 않으므로).
        """
        if job["type"] not in ("analyze", "import") or "analysis_id" not in job["payload"]:
            return
        analysis_id = job["payload"]["analysis_id"]
        if analysis_id in self.analyses:
            self.analyses[analysis_id]["status"] = status

    def _sync_linked_scan_status_on_fail(self, job, status):
        """type='precheck' + payload.scan_id 잡의 scans.status 부수효과(fail_job 전용).

        fn_job_fail SQL의 `elsif v_job.type = 'precheck' and (v_job.payload ?
        'scan_id') then update scans set status = ...`를 그대로 옮긴 것
        (003_dashboard_support.sql 신규) — fn_job_claim/fn_job_complete는 precheck의
        scans.status를 건드리지 않는다.
        """
        if job["type"] != "precheck" or "scan_id" not in job["payload"]:
            return
        scan_id = job["payload"]["scan_id"]
        if scan_id in self.scans:
            self.scans[scan_id]["status"] = status

    # -- 잡 큐 -----------------------------------------------------------
    def reap_stuck_jobs(self, timeout_minutes=30):
        """fn_reap_stuck_jobs(002_functions_seed.sql 119-135행대) 시맨틱을 그대로
        옮긴 것 — SQL 2단계 UPDATE를 순서대로 재현한다:

        1) status='processing'이고 locked_at이 timeout_minutes 이전인 잡을 전부
           'queued'로 되돌리고(locked_at/locked_by 해제, run_after=now) 개수를 센다.
           attempts는 건드리지 않는다(SQL도 attempts를 갱신하지 않음).
        2) (1과 무관하게 그 시점 전체 잡 기준으로) status='queued'·type='analyze'인
           잡 중 연결된 analyses.status가 'processing'인 것만 'queued'로 되돌린다
           (SQL의 `update analyses ... from jobs j where j.status='queued' and
           j.type='analyze' and ... and a.status='processing'` 조인 조건 그대로 —
           1단계에서 막 재큐잉된 잡뿐 아니라 이미 queued였던 analyze 잡도 대상이 될
           수 있다는 점까지 SQL과 동일하게 재현).
        """
        now = _now()
        threshold = now - timedelta(minutes=timeout_minutes)
        reaped_count = 0
        for job in self.jobs.values():
            if (job["status"] == "processing" and job["locked_at"] is not None
                    and job["locked_at"] < threshold):
                job["status"] = "queued"
                job["locked_at"] = None
                job["locked_by"] = None
                job["run_after"] = now
                reaped_count += 1
        for job in self.jobs.values():
            if job["status"] != "queued" or job["type"] != "analyze":
                continue
            if "analysis_id" not in job["payload"]:
                continue
            analysis_id = job["payload"]["analysis_id"]
            analysis = self.analyses.get(analysis_id)
            if analysis is not None and analysis["status"] == "processing":
                analysis["status"] = "queued"
        return reaped_count

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
        self._sync_linked_analysis_status(job, "processing")
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
            self._sync_linked_analysis_status(job, "failed")
            self._sync_linked_scan_status_on_fail(job, "failed")
        else:
            job["status"] = "queued"
            job["run_after"] = _now() + timedelta(seconds=10 * job["attempts"])
            self._sync_linked_analysis_status(job, "queued")
            self._sync_linked_scan_status_on_fail(job, "uploaded")
        job["locked_at"] = None
        job["locked_by"] = None

    # -- 조회 -----------------------------------------------------------
    def get_scan(self, scan_id):
        return self.scans[scan_id]

    def get_criteria(self, criteria_id):
        return self.criteria[criteria_id]

    def get_analysis(self, analysis_id):
        return self.analyses[analysis_id]

    def get_app_setting(self, key):
        return self.app_settings[key]

    # -- 갱신 -----------------------------------------------------------
    def update_scan(self, scan_id, fields):
        self.scans[scan_id].update(fields)

    def insert_analysis(self, fields):
        analysis_id = str(uuid4())
        self.analyses[analysis_id] = {**fields, "id": analysis_id}
        return analysis_id

    def update_analysis(self, analysis_id, fields):
        self.analyses[analysis_id].update(fields)

    def set_current_analysis(self, scan_id, analysis_id):
        self.current_analysis[scan_id] = analysis_id

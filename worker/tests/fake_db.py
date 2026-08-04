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
- type이 'report'이고 payload.report_id가 있으면 연결된 reports.gen_status를 전이한다
  (004_report_support.sql 신규) - fn_job_claim은 'processing'(+gen_error 초기화),
  fn_job_fail은 재시도 여지가 있으면 'queued'/소진이면 'failed'로 하고 양쪽 모두
  gen_error에 오류 메시지를 남긴다. fn_job_complete는 reports를 건드리지 않는다
  (gen_status='done'은 워커가 update_report로 직접 쓴다).
- type이 'slope_judge'이고 payload.analysis_id가 있으면 연결된 analyses.params.judge
  (jsonb)를 전이한다(009_slope_judge_functions.sql, 세부과업 4 단계 D, Task 2
  리뷰 대응 이후 최신본) - fn_job_claim은 'processing'(+기존 error 제거),
  fn_job_fail은 재시도 여지가 있으면 'queued'(+error)/소진이면 'failed'(+error),
  fn_reap_stuck_jobs는 judge.state가 'processing'인 행만 골라 'queued'로
  되돌린다. **analyses.status는 slope_judge 때문에 절대 건드리지 않는다** -
  이미 done인 구배 결과 화면을 감추면 안 된다(설계 결정 D5). fn_job_complete는
  params를 건드리지 않는다 - judge.state='done'은 워커 핸들러(handle_slope_judge)가
  stats 등 다른 파생 컬럼과 함께 직접 쓴다.
  **judge는 전면 교체가 아니라 병합이다**(`coalesce(params->'judge','{}') ||
  jsonb_build_object(...)`) - Task 3(D8)이 남기는 judge.previous_drain_points를
  네 분기 모두 보존해야 한다. 클레임만 예외적으로 기존 'error' 키를 먼저
  지운다(004의 gen_error=null 클레임 관례와 동일).
"""
from datetime import datetime, timedelta, timezone
from itertools import count
from uuid import uuid4

from flatworker.db import DBClient, DBError

_seq_counter = count()

# fn_reports_finalized_guard(004_report_support.sql)가 잠그는 컬럼 - 발행본(finalized)의
# 내용 전부. gen_status/gen_error는 잡 기계장치 소유라 잠그지 않는다(주석 원문 그대로).
_REPORT_LOCKED_FIELDS = ("status", "title", "location_id", "opinion_text", "snapshot", "pdf_path")


def _now():
    return datetime.now(timezone.utc)


class FakeDB(DBClient):
    def __init__(self):
        self.jobs = {}
        self.scans = {}
        self.criteria = {}
        self.app_settings = {}
        self.analyses = {}
        self.current_analysis = {}  # (scan_id, kind) -> analysis_id (is_current 대체)
        self.reports = {}
        self.report_analyses = []   # {"report_id","analysis_id","sort_order"} 행 목록
        self.locations = {}
        self.sites = {}
        self.profiles = {}
        self.photos = {}            # photo_id -> photos 행
        self.photo_blobs = {}       # photos.file_path -> bytes (Storage 대체)

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

    def _sync_linked_report_status(self, job, status, error=None):
        """type='report' + payload.report_id 잡의 reports.gen_status 부수효과.

        fn_job_claim/fn_job_fail SQL의 `elsif v_job.type = 'report' and
        (v_job.payload ? 'report_id') then update reports set gen_status = ...`를
        그대로 옮긴 것(004_report_support.sql) - fn_job_complete는 호출하지 않는다.
        """
        if job["type"] != "report" or "report_id" not in job["payload"]:
            return
        report = self.reports.get(job["payload"]["report_id"])
        if report is None:
            return
        report["gen_status"] = status
        report["gen_error"] = error

    def _sync_slope_judge_state(self, job, overlay, strip_error=False):
        """type='slope_judge' + payload.analysis_id 잡의 analyses.params.judge
        부수효과.

        009_slope_judge_functions.sql(Task 2 리뷰 대응 이후 최신본)의
        `jsonb_set(params, '{judge}', (coalesce(params->'judge','{}'::jsonb)
        [- 'error']) || jsonb_build_object(...), true)`를 그대로 옮긴 것 -
        **전면 교체가 아니라 병합**이다. 기존 judge 객체(특히 Task 3(D8)가 남기는
        previous_drain_points) 위에 overlay만 덮어쓰고, overlay에 없는 기존 키는
        그대로 보존한다. 형제 키인 'drain_points'는 여전히 건드리지 않는다
        (jsonb_set이 'judge' 키만 갈아끼움). analyses.status도 여기서 절대
        건드리지 않는다.

        strip_error=True는 fn_job_claim 전용 - 병합 전에 기존 'error' 키를 먼저
        지운다(004의 gen_error=null 클레임 관례와 동일한 의도). fn_job_fail·
        fn_reap_stuck_jobs는 지우지 않는다(SQL 원문에 `- 'error'`가 없다) - 다만
        reap의 가드(judge.state=='processing')는 claim이 이미 error를 지운
        상태에서만 성립하므로 실질적으로는 항상 비어 있다.
        """
        if job["type"] != "slope_judge" or "analysis_id" not in job["payload"]:
            return
        analysis = self.analyses.get(job["payload"]["analysis_id"])
        if analysis is None:
            return
        params = dict(analysis.get("params") or {})
        judge = dict(params.get("judge") or {})
        if strip_error:
            judge.pop("error", None)
        judge.update(overlay)
        params["judge"] = judge
        analysis["params"] = params

    # -- 잡 큐 -----------------------------------------------------------
    def reap_stuck_jobs(self, timeout_minutes=30):
        """fn_reap_stuck_jobs(004_report_support.sql, 002_functions_seed.sql을 티켓
        30으로 확장한 최종본) 시맨틱을 그대로 옮긴 것 — SQL 3단계 UPDATE를 순서대로
        재현한다:

        1) status='processing'이고 locked_at이 timeout_minutes 이전인 잡을 전부
           'queued'로 되돌리고(locked_at/locked_by 해제, run_after=now) 개수를 센다.
           attempts는 건드리지 않는다(SQL도 attempts를 갱신하지 않음).
        2) (1과 무관하게 그 시점 전체 잡 기준으로) status='queued'·type in ('analyze',
           'import')인 잡 중 연결된 analyses.status가 'processing'인 것만 'queued'로
           되돌린다(SQL의 `update analyses ... from jobs j where j.status='queued' and
           j.type in ('analyze','import') and ... and a.status='processing'` 조인
           조건 그대로 — 1단계에서 막 재큐잉된 잡뿐 아니라 이미 queued였던 analyze·
           import 잡도 대상이 될 수 있다는 점까지 SQL과 동일하게 재현).
        3) 동일한 방식으로 status='queued'·type='report'인 잡 중 연결된
           reports.gen_status가 'processing'인 것만 'queued'로 되돌린다(티켓 30 해소).
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
            if job["status"] != "queued" or job["type"] not in ("analyze", "import"):
                continue
            if "analysis_id" not in job["payload"]:
                continue
            analysis = self.analyses.get(job["payload"]["analysis_id"])
            if analysis is not None and analysis["status"] == "processing":
                analysis["status"] = "queued"
        for job in self.jobs.values():
            if job["status"] != "queued" or job["type"] != "report":
                continue
            if "report_id" not in job["payload"]:
                continue
            report = self.reports.get(job["payload"]["report_id"])
            if report is not None and report["gen_status"] == "processing":
                report["gen_status"] = "queued"
        # slope_judge: analyses.status는 항상 'done'이라 위 analyze/import 조건
        # (a.status == 'processing')으로는 걸리지 않는다(009_slope_judge_functions.sql).
        # 대신 judge 채널이 'processing'이던 행만 골라 되돌린다 - analyses.status는
        # 여기서도 건드리지 않는다. 병합(||)이므로 previous_drain_points 등 judge의
        # 다른 키는 그대로 보존한다(_sync_slope_judge_state에 위임).
        for job in self.jobs.values():
            if job["status"] != "queued" or job["type"] != "slope_judge":
                continue
            if "analysis_id" not in job["payload"]:
                continue
            analysis = self.analyses.get(job["payload"]["analysis_id"])
            if analysis is None:
                continue
            judge = (analysis.get("params") or {}).get("judge") or {}
            if judge.get("state") == "processing":
                self._sync_slope_judge_state(job, {"state": "queued", "at": _now().isoformat()})
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
        self._sync_linked_report_status(job, "processing", None)
        self._sync_slope_judge_state(job, {"state": "processing", "at": now.isoformat()},
                                     strip_error=True)
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
            self._sync_linked_report_status(job, "failed", error)
            self._sync_slope_judge_state(
                job, {"state": "failed", "at": _now().isoformat(), "error": error})
        else:
            job["status"] = "queued"
            job["run_after"] = _now() + timedelta(seconds=10 * job["attempts"])
            self._sync_linked_analysis_status(job, "queued")
            self._sync_linked_scan_status_on_fail(job, "uploaded")
            self._sync_linked_report_status(job, "queued", error)
            self._sync_slope_judge_state(
                job, {"state": "queued", "at": _now().isoformat(), "error": error})
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

    def set_current_analysis(self, scan_id, analysis_id, kind="flatness"):
        """007의 analyses_current 부분 유니크 인덱스((scan_id, kind)당 is_current
        1개)와 SupabaseRest.set_current_analysis의 실제 PATCH② 시맨틱
        (`id=eq.<analysis_id>&kind=eq.<kind>&deleted_at=is.null`)을 그대로 옮긴다.

        코드리뷰 재검토(I1/I2): 예전 구현은 인자를 무조건 신뢰해 대상 행을 보지
        않고 성공시켰다 - 실제 PostgREST PATCH는 대상 analyses 행의 kind가
        인자와 다르거나 deleted_at이 있으면 0행 매칭으로 **조용히 아무 것도
        갱신하지 않는다**. 이 대체 표현이 그 결과를 반영하지 않으면, jobs.py가
        kind 인자를 빠뜨리거나(기본값 'flatness'로 조용히 떨어짐) 잘못된 kind를
        넘겨도 테스트가 계속 통과해 버려 이 태스크가 막으려던 회귀를 못 잡는다.
        """
        row = self.analyses.get(analysis_id)
        if row is None:
            return  # 실제 PATCH도 대상 행이 없으면 0행 매칭 -> no-op
        row_kind = row.get("kind") or "flatness"
        if row_kind != kind or row.get("deleted_at") is not None:
            return  # PATCH②가 0행 매칭되는 경우와 동일한 no-op
        self.current_analysis[(scan_id, kind)] = analysis_id

    # -- 보고서 (P4) -----------------------------------------------------
    def get_report(self, report_id):
        return self.reports[report_id]

    def update_report(self, report_id, fields):
        """P4 최종 픽스웨이브 Important(I1) 회귀 대비: fn_reports_finalized_guard
        (004_report_support.sql) 트리거 시맨틱을 그대로 옮긴 것 —

        - old.status가 'finalized'면 status·title·location_id·opinion_text·snapshot·
          pdf_path 중 하나라도 새 값이 기존값과 다르면 42501로 거부한다(Postgres
          에러코드 그대로 재현 — worker/flatworker/db.py의 DBError(status, body)를
          PostgREST가 403으로 매핑하는 형태로 흉내낸다). 트리거는 UPDATE 문 전체를
          거부하므로(단일 컬럼만이 아니라) 이 메서드도 거부 시 필드를 하나도
          반영하지 않는다.
        - new.status가 'finalized'로 바뀌는 전이(발행 확정)는 pdf_path·snapshot이
          모두 있어야 허용한다.
        """
        report = self.reports[report_id]
        if report.get("status") == "finalized":
            for key in _REPORT_LOCKED_FIELDS:
                if key in fields and fields[key] != report.get(key):
                    raise DBError(403, f"발행된 보고서는 수정할 수 없습니다 (report_id={report_id})")
        elif fields.get("status") == "finalized":
            pdf_path = fields.get("pdf_path", report.get("pdf_path"))
            snapshot = fields.get("snapshot", report.get("snapshot"))
            if pdf_path is None or snapshot is None:
                raise DBError(403, f"PDF가 생성되지 않은 보고서는 발행할 수 없습니다 (report_id={report_id})")
        report.update(fields)

    def get_report_analyses(self, report_id):
        rows = [r for r in self.report_analyses if r["report_id"] == report_id]
        return sorted(rows, key=lambda r: r.get("sort_order", 0))

    def get_analyses_by_ids(self, analysis_ids):
        return [self.analyses[a] for a in analysis_ids if a in self.analyses]

    def get_location(self, location_id):
        return self.locations[location_id]

    def get_site(self, site_id):
        return self.sites[site_id]

    def get_profile(self, profile_id):
        return self.profiles.get(profile_id)

    def get_photos_by_scan_ids(self, scan_ids):
        rows = [p for p in self.photos.values() if p.get("scan_id") in set(scan_ids)]
        return sorted(rows, key=lambda p: p.get("created_at") or "")

    def download_photo(self, file_path):
        if file_path not in self.photo_blobs:
            raise KeyError(f"사진 객체가 없습니다: {file_path}")
        return self.photo_blobs[file_path]

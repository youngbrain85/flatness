"""DB 접근 인터페이스 — PostgREST/RPC 네트워크 코드는 이 파일에만 격리한다.

`DBClient`는 워커가 필요로 하는 DB 연산의 추상 인터페이스다. `abc.abstractmethod`로
강제하지 않는다: FakeDB(tests/fake_db.py)가 태스크 진행에 따라 메서드를 순차적으로
구현하므로(Task 4는 잡 큐 4종, Task 5에서 나머지 조회/갱신 메서드 추가) 강제하면
이전 태스크에서 만든 FakeDB 인스턴스화가 깨진다. 대신 각 메서드는 기본적으로
NotImplementedError를 던진다.

RPC 함수 시그니처는 `supabase/migrations/002_functions_seed.sql`(실제 배포되는
정본 SQL)을 그대로 따른다: `fn_job_claim(p_worker text)`,
`fn_resolve_criteria(p_site_id uuid, p_surface surface_type)`.
"""
import time
from abc import ABC
from datetime import datetime, timezone

import httpx

_TIMEOUT_S = 30.0

# 코드리뷰 Important(I2): 짧은 재시도 파라미터 — 총 대기시간은 0.5+1.0=1.5초 정도로,
# 유휴 keep-alive 연결이 끊긴 직후의 순간적 재연결 실패를 흡수하는 정도를 노린다
# (러너의 claim_job 백오프처럼 분 단위로 길게 기다리지 않는다 — 그 백오프는
# "빈 큐라서 다음 폴링까지 기다리는" 성격이라 여기와 목적이 다르다).
_JOB_QUEUE_RETRY_ATTEMPTS = 3
_JOB_QUEUE_RETRY_BASE_BACKOFF_S = 0.5


def _with_transport_retry(fn, sleep_fn, attempts=_JOB_QUEUE_RETRY_ATTEMPTS,
                           base_backoff_s=_JOB_QUEUE_RETRY_BASE_BACKOFF_S):
    """`fn()`을 호출하고, httpx.TransportError(연결 끊김·타임아웃 등 전송 계층
    오류)만 한정해 지수 백오프로 최대 `attempts`회 재시도한다.

    코드리뷰 Important(I2): runner.py의 폴링 루프는 3초 간격 claim_job 호출로
    연결을 자주 덥혀 전송 오류를 스스로 드물게 만들지만, 수 분씩 걸리는
    analyze/import 처리 동안에는 그 사이 요청이 전혀 없어 오히려 연결이 유휴
    상태로 끊길 여지가 크다. 그 시점에 실행되는 `complete_job`이 전송 오류로
    실패하면 "성공한 분석이 실패로 기록"되고, 뒤이어 호출되는 `fail_job`마저
    전송 오류를 내면 그건 runner.py가 claim 실패만 감싸고 있어 잡지 못해
    프로세스가 그대로 죽는다 — 이 브랜치가 원래 고치려던 크래시와 같은 종류다.
    이 헬퍼를 claim_job/complete_job/fail_job/reap_stuck_jobs(잡 큐 4종)에 공통
    적용해 그 노출 구간을 좁힌다.

    `DBError`(HTTP 4xx/5xx, 예: 인증 실패)는 재시도해도 의미가 없는 영구 오류이므로
    여기서 잡지 않고 즉시 그대로 전파한다 — 호출자(runner.py)가 지금처럼 종료
    처리한다.

    `sleep_fn`은 테스트가 실제 sleep 없이 백오프를 결정론적으로 검증하기 위한
    이음매다(runner.py의 동일 패턴 참고).
    """
    for attempt in range(attempts):
        try:
            return fn()
        except httpx.TransportError:
            if attempt == attempts - 1:
                raise
            sleep_fn(base_backoff_s * (2 ** attempt))


class DBError(Exception):
    """PostgREST/RPC 호출이 4xx/5xx를 반환했을 때."""

    def __init__(self, status, body):
        self.status = status
        self.body = body
        super().__init__(f"DB 오류 (status={status}): {body}")


class DBClient(ABC):
    """워커가 소비하는 DB 연산 추상 인터페이스 (FakeDB·SupabaseRest가 구현)."""

    def claim_job(self):
        """대기 중인 잡 1개를 클레임해 dict로 반환. 없으면 None."""
        raise NotImplementedError

    def complete_job(self, job_id):
        raise NotImplementedError

    def fail_job(self, job_id, error):
        raise NotImplementedError

    def enqueue_job(self, type_, payload):
        """새 잡을 등록하고 생성된 잡 id(str)를 반환."""
        raise NotImplementedError

    def reap_stuck_jobs(self, timeout_minutes=30):
        """고착(processing으로 timeout_minutes 이상 방치된) 잡을 queued로 되돌리고
        재큐잉된 개수를 반환한다. 연결된 analyze 잡의 analyses.status가 'processing'
        이면 'queued'로 함께 되돌린다 (`fn_reap_stuck_jobs`,
        supabase/migrations/002_functions_seed.sql). 워커 비정상 종료로 잡이
        processing에 영구 고착되면 jobs_dedup 부분 유니크가 재enqueue를 막아버리므로
        run_loop 시작 시 1회 호출한다.
        """
        raise NotImplementedError

    def get_scan(self, scan_id):
        raise NotImplementedError

    def get_criteria(self, criteria_id):
        raise NotImplementedError

    def get_app_setting(self, key):
        """app_settings.value(jsonb)를 그대로 반환 (row 전체가 아님)."""
        raise NotImplementedError

    def get_analysis(self, analysis_id):
        """analyses 행 1개. Task 4 브리프의 원 인터페이스 목록에는 없었으나,
        Task 5의 handle_analyze/handle_import가 analysis→scan→criteria 순으로
        로드하려면 analysis 행 자체를 읽는 메서드가 반드시 필요해 추가했다
        (task-4-5-6-report.md Task 5 절 "브리프와 달리한 결정" 참고).
        """
        raise NotImplementedError

    def update_scan(self, scan_id, fields):
        raise NotImplementedError

    def upsert_scan(self, fields):
        """`fields['id']`를 기본키로 scans 행을 **upsert** 하고 그 id(str)를 반환.

        정합 병합 스캔(단계 F)이 유일한 호출부다 - 평소 scans 행은 대시보드가
        업로드 시 만든다. 삽입이 아니라 upsert인 이유는 잡 재시도 멱등성이다
        (`registration.merged_scan_id` 독스트링 참고): 결과 PATCH가 실패해 핸들러가
        재실행되면 같은 id로 다시 들어와 **같은 행 하나**를 갱신해야 하고, 새 행이
        생기면 고아 병합 스캔이 쌓인다.
        """
        raise NotImplementedError

    def insert_analysis(self, fields):
        """새 analyses 행을 만들고 생성된 id(str)를 반환."""
        raise NotImplementedError

    # -- 정합 (단계 F) ---------------------------------------------------
    def get_registration(self, registration_id):
        """registrations 행 1개 (012_register_support.sql)."""
        raise NotImplementedError

    def update_registration(self, registration_id, fields):
        raise NotImplementedError

    def update_analysis(self, analysis_id, fields):
        raise NotImplementedError

    def set_current_analysis(self, scan_id, analysis_id, kind="flatness"):
        """scan_id·kind의 is_current 분석을 analysis_id로 전환(기존 현재 분석은 해제).

        kind 기본값은 기존 평활도 전용 호출부(handle_analyze/handle_import의
        `_finalize`)가 인자 없이 그대로 호출해도 동작하도록 한다.
        """
        raise NotImplementedError

    # -- 보고서 (P4) -----------------------------------------------------
    def get_report(self, report_id):
        raise NotImplementedError

    def update_report(self, report_id, fields):
        raise NotImplementedError

    def get_report_analyses(self, report_id):
        """report_analyses 행 목록(sort_order 오름차순)."""
        raise NotImplementedError

    def get_analyses_by_ids(self, analysis_ids):
        """analyses 행 목록. 반환 순서는 보장하지 않는다(호출자가 id로 매핑)."""
        raise NotImplementedError

    def get_location(self, location_id):
        raise NotImplementedError

    def get_site(self, site_id):
        raise NotImplementedError

    def get_profile(self, profile_id):
        """profiles 행 1개(담당자 표시명 해석용). 없으면 None."""
        raise NotImplementedError

    def get_photos_by_scan_ids(self, scan_ids):
        """scan_id가 목록에 속한 photos 행(created_at 오름차순).

        보고서 사진 스코프(설계 결정 4): report_analyses에 포함된 분석들의 스캔에
        달린 사진의 합집합을 쓴다.
        """
        raise NotImplementedError

    def download_photo(self, file_path):
        """photos 버킷 객체를 bytes로 내려받는다.

        file_path는 스펙 §6.3 규약 문자열('photos/{photo_id}.{ext}')이며 버킷 접두를
        떼어낸 나머지가 Storage 객체 키다(대시보드 lib/photos/paths.ts와 동일 규칙).
        """
        raise NotImplementedError


class SupabaseRest(DBClient):
    """PostgREST(`/rest/v1/...`)·RPC(`/rest/v1/rpc/<fn>`) 호출 구현.

    service_role 키로 인증하며(잡 큐 함수 4종은 002 마이그레이션에서 service_role
    전용으로 하드닝됨), 이 클래스의 단위 테스트는 존재하지 않는다 — 실 Supabase
    프로젝트가 준비된 뒤 사용자 셋업 스모크(docs/SUPABASE_SETUP.md, Task 7)로만
    검증한다. 각 메서드는 정확히 PostgREST/RPC 엔드포인트 1개만 호출한다.
    """

    def __init__(self, config, sleep_fn=None, transport=None):
        """`sleep_fn`/`transport`는 테스트 이음매다(기본값은 각각 `time.sleep`과 httpx의
        실제 전송 계층). `transport`에 `httpx.MockTransport`를 주입하면 실 네트워크
        없이 재시도 배선(I2)까지 결정론적으로 검증할 수 있다(worker/tests/test_db.py)."""
        self._base_url = config.supabase_url.rstrip("/")
        self._worker_id = config.worker_id
        self._sleep_fn = sleep_fn or time.sleep
        headers = {
            "apikey": config.service_role_key,
            "Authorization": f"Bearer {config.service_role_key}",
            "Content-Type": "application/json",
        }
        self._client = httpx.Client(base_url=self._base_url, headers=headers, timeout=_TIMEOUT_S,
                                     transport=transport)

    def close(self):
        self._client.close()

    # -- 내부 헬퍼 -----------------------------------------------------------
    def _raise_for_status(self, resp):
        if resp.status_code >= 400:
            raise DBError(resp.status_code, resp.text)

    def _rpc(self, fn_name, params):
        resp = self._client.post(f"/rest/v1/rpc/{fn_name}", json=params)
        self._raise_for_status(resp)
        if not resp.content:
            return None
        return resp.json()

    def _select_one(self, table, id_value, id_column="id"):
        resp = self._client.get(
            f"/rest/v1/{table}",
            params={id_column: f"eq.{id_value}", "select": "*"},
            headers={"Accept": "application/vnd.pgrst.object+json"},
        )
        self._raise_for_status(resp)
        return resp.json()

    def _patch(self, table, id_value, fields, id_column="id"):
        resp = self._client.patch(
            f"/rest/v1/{table}",
            params={id_column: f"eq.{id_value}"},
            json=fields,
        )
        self._raise_for_status(resp)

    # -- 잡 큐 -----------------------------------------------------------
    # 코드리뷰 Important(I2): claim_job/complete_job/fail_job/reap_stuck_jobs
    # 4종에만 _with_transport_retry를 적용한다. enqueue_job은 대시보드가 아니라
    # 이 워커 자신이 호출하는 경로가 실제로 없어(대시보드는 supabase-js로 직접
    # fn_enqueue_job을 호출) 재시도 대상에서 제외했다(리뷰 지시 범위와 일치).
    def claim_job(self):
        def _do():
            job = self._rpc("fn_job_claim", {"p_worker": self._worker_id})
            # 코드리뷰 Critical(C1): fn_job_claim은 `returns jobs`(setof가 아닌 단일
            # 컴포지트)라, 대기 중인 잡이 없으면 SQL이 `return null;`을 실행해도
            # PostgREST는 0행이 아니라 **id 등 전 컬럼이 null인 1행**을 내려준다
            # (docs/SUPABASE_SETUP.md §3(2)에서 실측 확인). 이 가드가 없으면 그 dict가
            # 그대로 runner까지 흘러가 `job is None` 검사를 통과해버리고, 이후
            # `fail_job(None, ...)`이 uuid 캐스트 400으로 워커 프로세스를 죽인다.
            if not job or job.get("id") is None:
                return None
            return job
        return _with_transport_retry(_do, self._sleep_fn)

    def complete_job(self, job_id):
        _with_transport_retry(
            lambda: self._rpc("fn_job_complete", {"p_job_id": str(job_id)}), self._sleep_fn)

    def fail_job(self, job_id, error):
        _with_transport_retry(
            lambda: self._rpc("fn_job_fail", {"p_job_id": str(job_id), "p_error": error}), self._sleep_fn)

    def enqueue_job(self, type_, payload):
        return self._rpc("fn_enqueue_job", {"p_type": type_, "p_payload": payload})

    def reap_stuck_jobs(self, timeout_minutes=30):
        return _with_transport_retry(
            lambda: self._rpc("fn_reap_stuck_jobs", {"p_timeout_minutes": timeout_minutes}), self._sleep_fn)

    # -- 조회 -----------------------------------------------------------
    def get_scan(self, scan_id):
        return self._select_one("scans", scan_id)

    def get_criteria(self, criteria_id):
        return self._select_one("criteria", criteria_id)

    def get_analysis(self, analysis_id):
        return self._select_one("analyses", analysis_id)

    def get_app_setting(self, key):
        resp = self._client.get(
            "/rest/v1/app_settings",
            params={"key": f"eq.{key}", "select": "value"},
            headers={"Accept": "application/vnd.pgrst.object+json"},
        )
        self._raise_for_status(resp)
        return resp.json()["value"]

    # -- 갱신 -----------------------------------------------------------
    def update_scan(self, scan_id, fields):
        self._patch("scans", scan_id, fields)

    def upsert_scan(self, fields):
        # `resolution=merge-duplicates`가 PostgREST의 upsert다 - 기본키(id)가 이미
        # 있으면 INSERT 대신 UPDATE 한다. 이것이 없으면 재시도 두 번째부터
        # 23505(duplicate key)로 죽어, 고아 스캔을 막는 대신 잡을 못 끝내게 된다.
        resp = self._client.post(
            "/rest/v1/scans",
            json=fields,
            headers={"Prefer": "resolution=merge-duplicates,return=representation"},
        )
        self._raise_for_status(resp)
        return resp.json()[0]["id"]

    # -- 정합 (단계 F) ---------------------------------------------------
    def get_registration(self, registration_id):
        return self._select_one("registrations", registration_id)

    def update_registration(self, registration_id, fields):
        # updated_at은 트리거가 없으므로 쓰는 쪽이 채운다(012의 잡 큐 함수 3종과
        # 같은 관례). 워커가 상태를 바꿔 놓고 시각을 안 남기면 화면의 "마지막
        # 갱신"이 잡 큐가 건드린 시점에서 멈춘다. 문자열 'now()'는 timestamptz
        # 리터럴이 아니므로(22007) ISO-8601 값을 직접 넣는다.
        self._patch("registrations", registration_id,
                    {**fields, "updated_at": datetime.now(timezone.utc).isoformat()})

    def insert_analysis(self, fields):
        resp = self._client.post(
            "/rest/v1/analyses",
            json=fields,
            headers={"Prefer": "return=representation"},
        )
        self._raise_for_status(resp)
        rows = resp.json()
        return rows[0]["id"]

    def update_analysis(self, analysis_id, fields):
        self._patch("analyses", analysis_id, fields)

    def set_current_analysis(self, scan_id, analysis_id, kind="flatness"):
        # analyses_current 부분 유니크 인덱스(007: (scan_id, kind)당 is_current 1개)를
        # 지키려면 먼저 같은 scan·kind의 기존 현재 분석을 해제한 뒤에 새 분석을
        # 현재로 세워야 한다. kind 필터가 없으면 구배 분석을 현재로 세울 때마다
        # 같은 스캔의 평활도 현재 분석이 함께 내려간다(007이 인덱스를 넓혀도 이쪽은
        # 코드 문제라 그대로 재현된다). deleted_at 필터도 함께 건다 - 삭제된 행까지
        # 다시 쓸 이유가 없다. 두 PATCH 쿼리 모두에 동일하게 건다.
        resp = self._client.patch(
            "/rest/v1/analyses",
            params={"scan_id": f"eq.{scan_id}", "id": f"neq.{analysis_id}",
                    "kind": f"eq.{kind}", "deleted_at": "is.null"},
            json={"is_current": False},
        )
        self._raise_for_status(resp)
        resp2 = self._client.patch(
            "/rest/v1/analyses",
            params={"id": f"eq.{analysis_id}", "kind": f"eq.{kind}",
                    "deleted_at": "is.null"},
            json={"is_current": True},
        )
        self._raise_for_status(resp2)

    # -- 보고서 (P4) -----------------------------------------------------
    def get_report(self, report_id):
        return self._select_one("reports", report_id)

    def update_report(self, report_id, fields):
        self._patch("reports", report_id, fields)

    def get_report_analyses(self, report_id):
        resp = self._client.get(
            "/rest/v1/report_analyses",
            params={"report_id": f"eq.{report_id}", "select": "*", "order": "sort_order.asc"},
        )
        self._raise_for_status(resp)
        return resp.json()

    def get_analyses_by_ids(self, analysis_ids):
        ids = [str(a) for a in analysis_ids]
        if not ids:
            return []
        resp = self._client.get(
            "/rest/v1/analyses",
            params={"id": f"in.({','.join(ids)})", "select": "*"},
        )
        self._raise_for_status(resp)
        return resp.json()

    def get_location(self, location_id):
        return self._select_one("locations", location_id)

    def get_site(self, site_id):
        return self._select_one("sites", site_id)

    def get_profile(self, profile_id):
        resp = self._client.get(
            "/rest/v1/profiles",
            params={"id": f"eq.{profile_id}", "select": "*"},
        )
        self._raise_for_status(resp)
        rows = resp.json()
        return rows[0] if rows else None

    def get_photos_by_scan_ids(self, scan_ids):
        ids = [str(s) for s in scan_ids]
        if not ids:
            return []
        resp = self._client.get(
            "/rest/v1/photos",
            params={"scan_id": f"in.({','.join(ids)})", "select": "*",
                    "order": "created_at.asc"},
        )
        self._raise_for_status(resp)
        return resp.json()

    def download_photo(self, file_path):
        key = file_path[len("photos/"):] if file_path.startswith("photos/") else file_path
        resp = self._client.get(f"/storage/v1/object/photos/{key}")
        self._raise_for_status(resp)
        return resp.content

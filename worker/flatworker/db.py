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
from abc import ABC

import httpx

_TIMEOUT_S = 30.0


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

    def insert_analysis(self, fields):
        """새 analyses 행을 만들고 생성된 id(str)를 반환."""
        raise NotImplementedError

    def update_analysis(self, analysis_id, fields):
        raise NotImplementedError

    def set_current_analysis(self, scan_id, analysis_id):
        """scan_id의 is_current 분석을 analysis_id로 전환(기존 현재 분석은 해제)."""
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

    def __init__(self, config):
        self._base_url = config.supabase_url.rstrip("/")
        self._worker_id = config.worker_id
        headers = {
            "apikey": config.service_role_key,
            "Authorization": f"Bearer {config.service_role_key}",
            "Content-Type": "application/json",
        }
        self._client = httpx.Client(base_url=self._base_url, headers=headers, timeout=_TIMEOUT_S)

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
    def claim_job(self):
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

    def complete_job(self, job_id):
        self._rpc("fn_job_complete", {"p_job_id": str(job_id)})

    def fail_job(self, job_id, error):
        self._rpc("fn_job_fail", {"p_job_id": str(job_id), "p_error": error})

    def enqueue_job(self, type_, payload):
        return self._rpc("fn_enqueue_job", {"p_type": type_, "p_payload": payload})

    def reap_stuck_jobs(self, timeout_minutes=30):
        return self._rpc("fn_reap_stuck_jobs", {"p_timeout_minutes": timeout_minutes})

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

    def set_current_analysis(self, scan_id, analysis_id):
        # analyses_current 부분 유니크 인덱스(scan_id당 is_current 1개)를 지키려면
        # 먼저 같은 scan의 기존 현재 분석을 해제한 뒤에 새 분석을 현재로 세워야 한다.
        resp = self._client.patch(
            "/rest/v1/analyses",
            params={"scan_id": f"eq.{scan_id}", "id": f"neq.{analysis_id}"},
            json={"is_current": False},
        )
        self._raise_for_status(resp)
        self._patch("analyses", analysis_id, {"is_current": True})

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

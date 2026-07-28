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
        return self._rpc("fn_job_claim", {"p_worker": self._worker_id})

    def complete_job(self, job_id):
        self._rpc("fn_job_complete", {"p_job_id": str(job_id)})

    def fail_job(self, job_id, error):
        self._rpc("fn_job_fail", {"p_job_id": str(job_id), "p_error": error})

    def enqueue_job(self, type_, payload):
        return self._rpc("fn_enqueue_job", {"p_type": type_, "p_payload": payload})

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

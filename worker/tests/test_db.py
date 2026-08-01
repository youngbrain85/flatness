"""db.py 전송 계층 재시도 배선 테스트 (코드리뷰 Important I2 / M7).

`SupabaseRest`는 실 Supabase 프로젝트 없이는 단위 테스트하지 않는다는 것이 기존
방침이었다(db.py의 SupabaseRest 클래스 docstring 참고) — 그래서 백오프 타이밍
같은 순수 로직은 `_with_transport_retry`를 직접 호출해 결정론적으로 검증하고
(실제 sleep 없음, sleep_fn 주입), SupabaseRest의 잡 큐 메서드 배선이 실제로 그
헬퍼를 거치는지는 `httpx.MockTransport`로 진짜 HTTP 스택(요청 직렬화·상태코드
처리 포함)까지 태워 확인한다 — 네트워크 호출 없이 결정론적이므로 기존 방침을
어기지 않는다.
"""
from pathlib import Path

import httpx
import pytest

from flatworker.config import Config
from flatworker.db import DBError, SupabaseRest, _with_transport_retry


# ---- _with_transport_retry 순수 단위 테스트 ------------------------------

def test_with_transport_retry_succeeds_after_transient_failures():
    calls = []
    sleeps = []

    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise httpx.ConnectError("연결 끊김")
        return "ok"

    result = _with_transport_retry(flaky, sleep_fn=sleeps.append)
    assert result == "ok"
    assert len(calls) == 3
    assert sleeps == pytest.approx([0.5, 1.0])  # 지수 백오프(0.5 -> 1.0)


def test_with_transport_retry_raises_after_exhausting_attempts():
    calls = []

    def always_fails():
        calls.append(1)
        raise httpx.ReadTimeout("타임아웃")

    sleeps = []
    with pytest.raises(httpx.ReadTimeout):
        _with_transport_retry(always_fails, sleep_fn=sleeps.append)
    assert len(calls) == 3          # 총 3회 시도(기본 attempts)
    assert len(sleeps) == 2         # 마지막 실패는 즉시 전파 - 재시도 대기 없음


def test_with_transport_retry_does_not_retry_dberror():
    calls = []

    def fails_permanently():
        calls.append(1)
        raise DBError(401, "invalid api key")

    with pytest.raises(DBError):
        _with_transport_retry(fails_permanently, sleep_fn=lambda s: (_ for _ in ()).throw(
            AssertionError("DBError는 재시도 대상이 아니므로 sleep_fn이 호출되면 안 됨")))
    assert len(calls) == 1  # 재시도 없이 1회만 호출하고 즉시 전파


# ---- SupabaseRest 배선 테스트 (httpx.MockTransport, 실 네트워크 없음) -----

def _cfg():
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=Path("/tmp"), poll_interval_s=3.0, worker_id="w1")


def _flaky_then_transport(fail_times, ok_response):
    """처음 fail_times회는 연결 오류를, 그 뒤로는 ok_response(request)를 돌려준다."""
    state = {"n": 0}

    def handler(request):
        state["n"] += 1
        if state["n"] <= fail_times:
            raise httpx.ConnectError("연결 끊김", request=request)
        return ok_response(request)

    return httpx.MockTransport(handler)


def test_claim_job_retries_transport_errors_then_succeeds():
    sleeps = []

    def ok_response(request):
        return httpx.Response(200, json={"id": "j1", "type": "analyze", "payload": {"analysis_id": "a1"}})

    db = SupabaseRest(_cfg(), sleep_fn=sleeps.append, transport=_flaky_then_transport(2, ok_response))
    job = db.claim_job()
    assert job == {"id": "j1", "type": "analyze", "payload": {"analysis_id": "a1"}}
    assert len(sleeps) == 2


def test_complete_job_gives_up_after_repeated_transport_errors():
    sleeps = []
    transport = _flaky_then_transport(99, lambda request: httpx.Response(204))
    db = SupabaseRest(_cfg(), sleep_fn=sleeps.append, transport=transport)
    with pytest.raises(httpx.ConnectError):
        db.complete_job("j1")
    assert len(sleeps) == 2  # 3회 시도, 마지막 실패는 즉시 전파(재시도 소진)


def test_reap_stuck_jobs_retries_transport_errors_then_succeeds():
    sleeps = []

    def ok_response(request):
        return httpx.Response(200, json=3)

    db = SupabaseRest(_cfg(), sleep_fn=sleeps.append, transport=_flaky_then_transport(1, ok_response))
    assert db.reap_stuck_jobs() == 3
    assert len(sleeps) == 1


def test_fail_job_and_reap_stuck_jobs_do_not_retry_permanent_dberror():
    """4xx/5xx(DBError)는 전송 오류가 아니므로 재시도 없이 즉시 전파해야 한다."""
    def handler(request):
        return httpx.Response(401, json={"message": "invalid api key"})

    def _no_sleep(_s):
        raise AssertionError("DBError는 재시도 대상이 아니므로 sleep_fn이 호출되면 안 됨")

    db = SupabaseRest(_cfg(), sleep_fn=_no_sleep, transport=httpx.MockTransport(handler))
    with pytest.raises(DBError):
        db.fail_job("j1", "오류")
    with pytest.raises(DBError):
        db.reap_stuck_jobs()


def test_enqueue_job_not_wrapped_in_retry():
    """enqueue_job은 워커 자신이 실제로 호출하지 않는 경로라 재시도 대상에서
    제외한다(리뷰 지시 범위) — 전송 오류가 나면 재시도 없이 즉시 전파해야 한다."""
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        raise httpx.ConnectError("연결 끊김", request=request)

    db = SupabaseRest(_cfg(), sleep_fn=lambda s: (_ for _ in ()).throw(
        AssertionError("enqueue_job은 재시도하지 않아야 함")), transport=httpx.MockTransport(handler))
    with pytest.raises(httpx.ConnectError):
        db.enqueue_job("analyze", {"analysis_id": "a1"})
    assert calls["n"] == 1

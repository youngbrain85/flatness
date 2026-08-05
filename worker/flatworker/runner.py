"""폴링 러너 — claim -> dispatch(타입별 핸들러) -> complete/fail, poll_interval 슬립.

SIGINT는 플래그 방식으로 처리한다: 신호가 와도 즉시 멈추지 않고 처리 중인 잡을
끝까지(완료/실패 반영까지) 마친 뒤, 다음 클레임을 시도하기 직전에 루프를
빠져나간다 — 처리 도중 잡을 반쯤 걸친 상태로 죽이지 않기 위함이다.

연결 복원력: `db.claim_job()`은 3초 간격으로 반복 호출되는데, Supabase가 유휴
keep-alive 연결을 끊은 뒤 워커가 그 연결을 재사용하면
`httpx.RemoteProtocolError: Server disconnected without sending a response`가
발생한다(실제 시연 중 관측). 이런 전송 계층 오류(httpx.TransportError 계열 —
RemoteProtocolError/ConnectError/ReadTimeout/WriteTimeout/PoolTimeout 등을 모두
포괄)는 일시적이므로 프로세스를 죽이지 않고 지수 백오프로 재시도한다. 반면
`DBError`(HTTP 4xx/5xx 응답, 예: 인증 실패)는 재시도해도 의미가 없는 영구
오류이므로 원인을 한국어로 안내한 뒤 그대로 전파해 종료한다(기존 동작 유지).
"""
import signal
import time

import httpx

from flatworker.db import DBError
from flatworker.jobs import (handle_precheck, handle_analyze, handle_import,
                             handle_register, handle_report, handle_slope_judge)

_DEFAULT_HANDLERS = {
    "precheck": handle_precheck,
    "analyze": handle_analyze,
    "import": handle_import,
    "report": handle_report,
    "slope_judge": handle_slope_judge,
    "register": handle_register,
}

_MAX_BACKOFF_S = 60.0


def run_loop(db, cfg, handlers=None, max_iterations=None, sleep_fn=None):
    """claim -> dispatch -> complete/fail 반복.

    `max_iterations`는 테스트 편의용 — None이면 SIGINT(또는 프로세스 종료)까지
    무한 반복한다. 알 수 없는 잡 타입은 재시도해도 의미가 없지만, 즉시 최종 실패로
    강제 전이시키지 않고 `fail_job`을 그대로 호출한다 (attempts가 max_attempts에
    이르면 fn_job_fail 시맨틱상 자연스럽게 종결되므로 재시도가 되어도 무해하다 —
    error 메시지에 원인만 명시).

    `sleep_fn`은 테스트가 실제 sleep 없이 백오프를 검증하기 위한 이음매다
    (기본값은 `time.sleep`).
    """
    if handlers is None:
        handlers = _DEFAULT_HANDLERS
    if sleep_fn is None:
        sleep_fn = time.sleep

    stop = {"flag": False}

    def _on_sigint(signum, frame):
        stop["flag"] = True

    prev_handler = signal.signal(signal.SIGINT, _on_sigint)
    try:
        # 시작 시 1회: 이전 워커가 비정상 종료해 processing에 고착된 잡을 재큐잉
        # (fn_reap_stuck_jobs, 002_functions_seed.sql) — 방치하면 jobs_dedup 부분
        # 유니크(queued/processing 포함)가 동일 analysis_id 재enqueue를 영구 차단한다.
        #
        # 코드리뷰 Important(I2)/M7: db.reap_stuck_jobs()는 이제 내부적으로 전송
        # 오류(httpx.TransportError)를 짧게 재시도한다(db.py의 _with_transport_retry).
        # 그래도 재시도를 다 소진할 만큼 연결이 끊겨 있다면, 워커가 폴링 루프를
        # 시작해보기도 전에 이 1회성 하우스키핑 때문에 프로세스 전체가 죽는 것은
        # 과하다 — 곧바로 이어지는 폴링 루프의 claim_job이 자체 백오프로 연결
        # 복구를 계속 시도하고, 고착 잡 회수는 다음 재기동이나 재클레임 시
        # 자가치유(processing -> 재클레임으로 자연 회복)로 미뤄도 무방하다. 반면
        # DBError(인증 실패 등 영구 오류)는 지금처럼 그대로 전파해 종료한다.
        try:
            db.reap_stuck_jobs()
        except httpx.TransportError as e:
            print(f"[flatworker] 기동 시 고착 잡 회수가 연결 오류로 실패했습니다"
                  f"(재시도 소진) - 계속 진행합니다: {e}")
        i = 0
        backoff_s = cfg.poll_interval_s
        consecutive_failures = 0
        while max_iterations is None or i < max_iterations:
            if stop["flag"]:
                break
            try:
                job = db.claim_job()
            except httpx.TransportError as e:
                # 전송 계층 오류(연결 끊김·타임아웃 등) — 일시적이므로 죽지 않고
                # 지수 백오프 후 재시도한다. 성공하면 아래에서 간격을 원복한다.
                consecutive_failures += 1
                print(f"[flatworker] 연결 오류로 재시도합니다 "
                      f"({consecutive_failures}회째, {backoff_s:.0f}초 후): {e}")
                sleep_fn(backoff_s)
                backoff_s = min(backoff_s * 2, _MAX_BACKOFF_S)
                i += 1
                continue
            except DBError as e:
                # 인증 실패 등 재시도가 무의미한 영구 오류 — 지금까지와 동일하게
                # 종료하되, 원인을 한국어로 남긴 뒤 그대로 전파한다.
                print(f"[flatworker] 복구 불가능한 DB 오류로 종료합니다 "
                      f"(status={e.status}): {e.body}")
                raise
            if consecutive_failures > 0:
                print("[flatworker] 연결 복구됨")
                consecutive_failures = 0
                backoff_s = cfg.poll_interval_s
            # 코드리뷰 Critical(C1) 방어 2중화: SupabaseRest.claim_job은 이제 빈
            # 큐에서 None을 반환하도록 가드됐지만(db.py), 다른 DBClient 구현체가
            # 같은 가드를 빠뜨릴 가능성에 대비해 여기서도 id가 없는 잡은 "클레임
            # 없음"과 동일하게 유휴 처리한다 — 어떤 백엔드든 크래시 없이 안전.
            if not job or job.get("id") is None:
                sleep_fn(cfg.poll_interval_s)
                i += 1
                continue
            try:
                handler = handlers.get(job["type"])
                if handler is None:
                    db.fail_job(job["id"], f"핸들러 없음: 알 수 없는 잡 타입 '{job['type']}'")
                else:
                    handler(db, cfg, job["payload"])
                    db.complete_job(job["id"])
            except Exception as e:
                db.fail_job(job["id"], str(e)[:500])
            i += 1
    finally:
        signal.signal(signal.SIGINT, prev_handler)

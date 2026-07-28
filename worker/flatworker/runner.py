"""폴링 러너 — claim -> dispatch(타입별 핸들러) -> complete/fail, poll_interval 슬립.

SIGINT는 플래그 방식으로 처리한다: 신호가 와도 즉시 멈추지 않고 처리 중인 잡을
끝까지(완료/실패 반영까지) 마친 뒤, 다음 클레임을 시도하기 직전에 루프를
빠져나간다 — 처리 도중 잡을 반쯤 걸친 상태로 죽이지 않기 위함이다.
"""
import signal
import time

from flatworker.jobs import handle_precheck, handle_analyze, handle_import

_DEFAULT_HANDLERS = {
    "precheck": handle_precheck,
    "analyze": handle_analyze,
    "import": handle_import,
}


def run_loop(db, cfg, handlers=None, max_iterations=None):
    """claim -> dispatch -> complete/fail 반복.

    `max_iterations`는 테스트 편의용 — None이면 SIGINT(또는 프로세스 종료)까지
    무한 반복한다. 알 수 없는 잡 타입(예: P4 전 'report')은 재시도해도 의미가
    없지만, 즉시 최종 실패로 강제 전이시키지 않고 `fail_job`을 그대로 호출한다
    (attempts가 max_attempts에 이르면 fn_job_fail 시맨틱상 자연스럽게 종결되므로
    재시도가 되어도 무해하다 — error 메시지에 원인만 명시).
    """
    if handlers is None:
        handlers = _DEFAULT_HANDLERS

    stop = {"flag": False}

    def _on_sigint(signum, frame):
        stop["flag"] = True

    prev_handler = signal.signal(signal.SIGINT, _on_sigint)
    try:
        i = 0
        while max_iterations is None or i < max_iterations:
            if stop["flag"]:
                break
            job = db.claim_job()
            if job is None:
                time.sleep(cfg.poll_interval_s)
                i += 1
                continue
            handler = handlers.get(job["type"])
            if handler is None:
                db.fail_job(job["id"], f"핸들러 없음: 알 수 없는 잡 타입 '{job['type']}'")
            else:
                try:
                    handler(db, cfg, job["payload"])
                    db.complete_job(job["id"])
                except Exception as e:
                    db.fail_job(job["id"], str(e)[:500])
            i += 1
    finally:
        signal.signal(signal.SIGINT, prev_handler)

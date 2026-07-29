"""폴링 러너 — claim -> dispatch(타입별 핸들러) -> complete/fail, poll_interval 슬립.

SIGINT는 플래그 방식으로 처리한다: 신호가 와도 즉시 멈추지 않고 처리 중인 잡을
끝까지(완료/실패 반영까지) 마친 뒤, 다음 클레임을 시도하기 직전에 루프를
빠져나간다 — 처리 도중 잡을 반쯤 걸친 상태로 죽이지 않기 위함이다.
"""
import signal
import time

from flatworker.jobs import handle_precheck, handle_analyze, handle_import, handle_report

_DEFAULT_HANDLERS = {
    "precheck": handle_precheck,
    "analyze": handle_analyze,
    "import": handle_import,
    "report": handle_report,
}


def run_loop(db, cfg, handlers=None, max_iterations=None):
    """claim -> dispatch -> complete/fail 반복.

    `max_iterations`는 테스트 편의용 — None이면 SIGINT(또는 프로세스 종료)까지
    무한 반복한다. 알 수 없는 잡 타입은 재시도해도 의미가 없지만, 즉시 최종 실패로
    강제 전이시키지 않고 `fail_job`을 그대로 호출한다 (attempts가 max_attempts에
    이르면 fn_job_fail 시맨틱상 자연스럽게 종결되므로 재시도가 되어도 무해하다 —
    error 메시지에 원인만 명시).
    """
    if handlers is None:
        handlers = _DEFAULT_HANDLERS

    stop = {"flag": False}

    def _on_sigint(signum, frame):
        stop["flag"] = True

    prev_handler = signal.signal(signal.SIGINT, _on_sigint)
    try:
        # 시작 시 1회: 이전 워커가 비정상 종료해 processing에 고착된 잡을 재큐잉
        # (fn_reap_stuck_jobs, 002_functions_seed.sql) — 방치하면 jobs_dedup 부분
        # 유니크(queued/processing 포함)가 동일 analysis_id 재enqueue를 영구 차단한다.
        db.reap_stuck_jobs()
        i = 0
        while max_iterations is None or i < max_iterations:
            if stop["flag"]:
                break
            job = db.claim_job()
            # 코드리뷰 Critical(C1) 방어 2중화: SupabaseRest.claim_job은 이제 빈
            # 큐에서 None을 반환하도록 가드됐지만(db.py), 다른 DBClient 구현체가
            # 같은 가드를 빠뜨릴 가능성에 대비해 여기서도 id가 없는 잡은 "클레임
            # 없음"과 동일하게 유휴 처리한다 — 어떤 백엔드든 크래시 없이 안전.
            if not job or job.get("id") is None:
                time.sleep(cfg.poll_interval_s)
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

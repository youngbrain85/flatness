from datetime import datetime, timedelta, timezone

from tests.fake_db import FakeDB


def test_claim_and_complete_lifecycle():
    db = FakeDB()
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    job = db.claim_job()
    assert job["id"] == jid and job["status"] == "processing" and job["attempts"] == 1
    assert db.claim_job() is None  # 동시 클레임 차단(단일 워커 시맨틱)
    db.complete_job(jid)
    assert db.jobs[jid]["status"] == "done"


def test_fail_retries_then_dead():
    db = FakeDB()
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    for i in range(3):
        job = db.claim_job(ignore_backoff=True)
        assert job is not None, f"{i+1}번째 클레임 실패"
        db.fail_job(jid, f"err{i}")
    assert db.jobs[jid]["status"] == "failed"  # max_attempts=3 소진
    assert db.claim_job(ignore_backoff=True) is None


def test_analyze_job_status_propagates_to_linked_analysis():
    """fn_job_claim/fn_job_fail(002_functions_seed.sql)이 type='analyze'이고
    payload.analysis_id가 있으면 연결된 analyses.status를 함께 갱신하는 부수효과를
    FakeDB도 그대로 모사해야 한다: 클레임 -> processing, 재시도 여지 있는 실패 ->
    queued, max_attempts 소진 실패 -> failed.
    """
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "queued"}
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})

    # 1·2번째 클레임+실패: 재시도 여지가 남아 잡도 analyses도 queued로 복귀
    for i in range(2):
        job = db.claim_job(ignore_backoff=True)
        assert job is not None, f"{i+1}번째 클레임 실패"
        assert db.analyses["a1"]["status"] == "processing"
        db.fail_job(jid, f"err{i}")
        assert db.jobs[jid]["status"] == "queued"
        assert db.analyses["a1"]["status"] == "queued"

    # 3번째(마지막) 클레임+실패: max_attempts(3) 소진 -> 잡·analyses 모두 영구 실패
    job = db.claim_job(ignore_backoff=True)
    assert job is not None
    assert db.analyses["a1"]["status"] == "processing"
    db.fail_job(jid, "err2")
    assert db.jobs[jid]["status"] == "failed"
    assert db.analyses["a1"]["status"] == "failed"


def test_import_job_status_propagates_to_linked_analysis():
    """003_dashboard_support.sql 확장(최종 전체 브랜치 리뷰 Important 1): fn_job_claim/
    fn_job_fail이 type='analyze'뿐 아니라 type='import'도 동일하게 analyses.status를
    전이시켜야 한다 — 이전에는 CSV 임포트 잡이 3회 재시도 후 최종 실패해도
    analyses.status가 'queued' 그대로 남아 화면이 "분석 대기 중"에 영구 고착됐다.
    """
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "queued"}
    jid = db.enqueue_job("import", {"analysis_id": "a1"})

    # 1·2번째 클레임+실패: 재시도 여지가 남아 analyses가 queued로 복귀
    for i in range(2):
        job = db.claim_job(ignore_backoff=True)
        assert job is not None, f"{i+1}번째 클레임 실패"
        assert db.analyses["a1"]["status"] == "processing"
        db.fail_job(jid, f"err{i}")
        assert db.analyses["a1"]["status"] == "queued"

    # 3번째(마지막) 클레임+실패: max_attempts(3) 소진 -> analyses 영구 실패
    job = db.claim_job(ignore_backoff=True)
    assert job is not None
    assert db.analyses["a1"]["status"] == "processing"
    db.fail_job(jid, "err2")
    assert db.jobs[jid]["status"] == "failed"
    assert db.analyses["a1"]["status"] == "failed"


def test_precheck_job_final_failure_sets_scan_status_failed():
    """003_dashboard_support.sql 신규(최종 전체 브랜치 리뷰 Important 1): precheck
    잡이 3회 재시도 후 최종 실패하면 scans.status='failed'로 전이해야 한다 — 가장
    흔한 실패 원인(CSV 필수 컬럼 누락 등)이 화면에 "사전 검사 대기 중"으로 영구
    고착되던 결함의 회귀 테스트. 재시도 구간(최종 실패 전)에는 scans.status가
    'uploaded'로 유지된다(fn_job_claim이 precheck의 scans.status를 건드리지 않으므로
    애초에 바뀌지 않았던 값을 재확인).
    """
    db = FakeDB()
    db.scans["s1"] = {"id": "s1", "status": "uploaded"}
    jid = db.enqueue_job("precheck", {"scan_id": "s1"})

    for i in range(2):
        job = db.claim_job(ignore_backoff=True)
        assert job is not None, f"{i+1}번째 클레임 실패"
        assert db.scans["s1"]["status"] == "uploaded"  # 클레임은 scans를 건드리지 않음
        db.fail_job(jid, f"err{i}")
        assert db.jobs[jid]["status"] == "queued"
        assert db.scans["s1"]["status"] == "uploaded"  # 재큐 시에도 uploaded 유지

    job = db.claim_job(ignore_backoff=True)
    assert job is not None
    db.fail_job(jid, "err2")
    assert db.jobs[jid]["status"] == "failed"
    assert db.scans["s1"]["status"] == "failed"


def test_complete_job_does_not_touch_linked_analysis_status():
    """fn_job_complete(002_functions_seed.sql)는 analyses를 건드리지 않는다
    (주석: "analyses.status는 워커가 결과 저장 시 함께 갱신하므로 여기선 잡만 종결") —
    handle_analyze가 이미 update_analysis(status=done, ...)로 직접 갱신하기 때문.
    """
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "processing"}
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    db.claim_job()
    db.complete_job(jid)
    assert db.jobs[jid]["status"] == "done"
    assert db.analyses["a1"]["status"] == "processing"  # complete_job은 손대지 않음(그대로)


def test_reap_stuck_jobs_requeues_timed_out_processing_job_and_syncs_analysis():
    """fn_reap_stuck_jobs(002_functions_seed.sql 119-135행대) 시맨틱 확인:
    locked_at이 timeout(기본 30분)을 넘긴 processing 잡은 queued로 되돌리고,
    연결된 analyses가 processing이면 함께 queued로 되돌린다.
    """
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "processing"}
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    db.claim_job()  # status=processing, locked_at=지금, analyses도 processing으로 전이
    db.jobs[jid]["locked_at"] = datetime.now(timezone.utc) - timedelta(minutes=31)  # 고착 재현

    n = db.reap_stuck_jobs()  # 기본 timeout_minutes=30

    assert n == 1
    assert db.jobs[jid]["status"] == "queued"
    assert db.jobs[jid]["locked_at"] is None
    assert db.jobs[jid]["locked_by"] is None
    assert db.analyses["a1"]["status"] == "queued"


def test_reap_stuck_jobs_leaves_recent_processing_job_untouched():
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "processing"}
    jid = db.enqueue_job("analyze", {"analysis_id": "a1"})
    db.claim_job()  # locked_at = 방금 -> 타임아웃 미도달

    n = db.reap_stuck_jobs()

    assert n == 0
    assert db.jobs[jid]["status"] == "processing"
    assert db.analyses["a1"]["status"] == "processing"


def test_report_job_status_propagates_to_linked_report():
    """004_report_support.sql의 fn_job_claim/fn_job_fail은 type='report'이고
    payload.report_id가 있으면 reports.gen_status를 전이시킨다: 클레임 -> processing
    (gen_error 초기화), 재시도 여지 있는 실패 -> queued, max_attempts 소진 -> failed.
    FakeDB도 같은 시맨틱이어야 워커 테스트가 실 DB 동작을 대변한다.
    """
    db = FakeDB()
    db.reports["r1"] = {"id": "r1", "gen_status": "queued", "gen_error": "이전 오류"}
    jid = db.enqueue_job("report", {"report_id": "r1"})

    job = db.claim_job(ignore_backoff=True)
    assert job is not None
    assert db.reports["r1"]["gen_status"] == "processing"
    assert db.reports["r1"]["gen_error"] is None

    db.fail_job(jid, "렌더 실패")
    assert db.reports["r1"]["gen_status"] == "queued"
    assert db.reports["r1"]["gen_error"] == "렌더 실패"

    for _ in range(2):
        assert db.claim_job(ignore_backoff=True) is not None
        db.fail_job(jid, "렌더 실패")
    assert db.jobs[jid]["status"] == "failed"
    assert db.reports["r1"]["gen_status"] == "failed"
    assert db.reports["r1"]["gen_error"] == "렌더 실패"


def test_report_job_complete_does_not_touch_report_status():
    """fn_job_complete는 jobs만 종결한다 — reports.gen_status='done'은 워커가
    결과 저장(update_report) 시 직접 쓴다(analyses와 동일한 책임 분담)."""
    db = FakeDB()
    db.reports["r1"] = {"id": "r1", "gen_status": "queued", "gen_error": None}
    jid = db.enqueue_job("report", {"report_id": "r1"})
    db.claim_job(ignore_backoff=True)
    db.complete_job(jid)
    assert db.reports["r1"]["gen_status"] == "processing"


def test_reap_stuck_jobs_covers_import_and_report():
    """백로그 티켓 30: fn_reap_stuck_jobs 2단계가 analyze만 검사해 import 잡의
    analyses.status가 'processing'에 고착됐다. 004에서 analyze·import로 넓히고
    report용 단계를 추가한다."""
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "processing"}
    db.reports["r1"] = {"id": "r1", "gen_status": "processing", "gen_error": None}
    import_job = db.enqueue_job("import", {"analysis_id": "a1"})
    report_job = db.enqueue_job("report", {"report_id": "r1"})
    for jid in (import_job, report_job):
        db.claim_job(ignore_backoff=True)
        # 워커 크래시 모사: locked_at을 타임아웃 이전으로 되돌린다
        db.jobs[jid]["locked_at"] = datetime.now(timezone.utc) - timedelta(minutes=60)

    assert db.reap_stuck_jobs(timeout_minutes=30) == 2
    assert db.analyses["a1"]["status"] == "queued"
    assert db.reports["r1"]["gen_status"] == "queued"


def test_slope_judge_job_status_propagates_to_params_judge_without_touching_status():
    """009_slope_judge_functions.sql의 fn_job_claim/fn_job_fail이 type='slope_judge'
    이고 payload.analysis_id가 있으면 analyses.params.judge(jsonb)만 전이하는
    부수효과를 FakeDB도 그대로 모사해야 한다: 클레임 -> processing, 재시도 여지
    있는 실패 -> queued(+error), max_attempts 소진 실패 -> failed(+error).

    **analyses.status는 이 잡 타입 때문에 절대 바뀌면 안 된다**(설계 결정 D5) -
    analyze/import와 달리 이미 done인 구배 결과 화면을 감춰선 안 되기 때문이다.
    매 단계마다 status가 'done' 그대로인지 함께 확인한다.
    """
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "done",
                         "params": {"drain_points": [{"x": 1.0, "y": 2.0}]}}
    jid = db.enqueue_job("slope_judge", {"analysis_id": "a1"})

    # 1·2번째 클레임+실패: 재시도 여지가 있어 queued(+error)로 복귀
    for i in range(2):
        job = db.claim_job(ignore_backoff=True)
        assert job is not None, f"{i+1}번째 클레임 실패"
        assert db.analyses["a1"]["params"]["judge"]["state"] == "processing"
        assert "error" not in db.analyses["a1"]["params"]["judge"]  # 클레임엔 error가 없다
        assert db.analyses["a1"]["status"] == "done"  # 절대 안 바뀜
        db.fail_job(jid, f"판정 실패{i}")
        assert db.analyses["a1"]["params"]["judge"]["state"] == "queued"
        assert db.analyses["a1"]["params"]["judge"]["error"] == f"판정 실패{i}"
        assert db.analyses["a1"]["status"] == "done"

    # drain_points(형제 키)는 judge 전이와 무관하게 유지돼야 한다(jsonb_set이
    # 'judge' 키만 갈아끼운다 - 009 SQL 주석 원문 그대로).
    assert db.analyses["a1"]["params"]["drain_points"] == [{"x": 1.0, "y": 2.0}]

    # 3번째(마지막) 클레임+실패: max_attempts(3) 소진 -> judge만 failed, status는 그대로
    job = db.claim_job(ignore_backoff=True)
    assert job is not None
    assert db.analyses["a1"]["params"]["judge"]["state"] == "processing"
    db.fail_job(jid, "판정 실패2")
    assert db.jobs[jid]["status"] == "failed"
    assert db.analyses["a1"]["params"]["judge"]["state"] == "failed"
    assert db.analyses["a1"]["params"]["judge"]["error"] == "판정 실패2"
    assert db.analyses["a1"]["status"] == "done"


def test_slope_judge_judge_merge_preserves_previous_drain_points_through_all_transitions():
    """009가 전면 교체(jsonb_build_object만)에서 병합(coalesce(...) || ...)으로
    바뀐 이유(Task 2 리뷰 대응) - Task 3(D8)이 재판정 성공 시 남기는
    judge.previous_drain_points가 그 다음 claim에서 사라지면 "재판정 3회 실패
    시 되돌릴 수단"이라는 D8의 유일한 안전장치가 무력화된다. claim -> fail(재큐)
    -> claim -> [고착 재현] reap -> claim -> fail(소진) 순서로 다섯 번 전이하는
    동안 이 키가 끝까지 살아남는지 추적한다. 클레임이 이전 'error'만 지우고
    'previous_drain_points'는 그대로 두는지도 함께 확인한다.
    """
    db = FakeDB()
    db.analyses["a1"] = {
        "id": "a1", "status": "done",
        "params": {"drain_points": [{"x": 9.0, "y": 9.0}],
                  "judge": {"state": "done", "at": "2026-01-01T00:00:00Z",
                            "previous_drain_points": [{"x": 1.0, "y": 1.0}]}},
    }
    jid = db.enqueue_job("slope_judge", {"analysis_id": "a1"})

    db.claim_job(ignore_backoff=True)  # attempts=1
    judge = db.analyses["a1"]["params"]["judge"]
    assert judge["state"] == "processing"
    assert judge["previous_drain_points"] == [{"x": 1.0, "y": 1.0}]
    assert "error" not in judge  # 클레임은 병합 전 기존 error를 지운다(이번엔 애초에 없었음)

    db.fail_job(jid, "err0")  # attempts(1) < max_attempts(3) -> 재큐
    judge = db.analyses["a1"]["params"]["judge"]
    assert judge["state"] == "queued"
    assert judge["error"] == "err0"
    assert judge["previous_drain_points"] == [{"x": 1.0, "y": 1.0}]  # 살아남음

    db.claim_job(ignore_backoff=True)  # attempts=2
    judge = db.analyses["a1"]["params"]["judge"]
    assert judge["state"] == "processing"
    assert "error" not in judge  # 클레임이 직전 err0를 지웠다
    assert judge["previous_drain_points"] == [{"x": 1.0, "y": 1.0}]  # 여전히 살아남음

    # 워커 크래시 모사 -> 회수
    db.jobs[jid]["locked_at"] = datetime.now(timezone.utc) - timedelta(minutes=31)
    db.reap_stuck_jobs()
    judge = db.analyses["a1"]["params"]["judge"]
    assert judge["state"] == "queued"
    assert judge["previous_drain_points"] == [{"x": 1.0, "y": 1.0}]  # 회수를 거쳐도 살아남음

    db.claim_job(ignore_backoff=True)  # attempts=3
    db.fail_job(jid, "err-final")  # attempts(3) >= max_attempts(3) -> 최종 실패
    assert db.jobs[jid]["status"] == "failed"
    judge = db.analyses["a1"]["params"]["judge"]
    assert judge["state"] == "failed"
    assert judge["error"] == "err-final"
    assert judge["previous_drain_points"] == [{"x": 1.0, "y": 1.0}]  # 끝까지 살아남음

    # 형제 키(drain_points)도 판정 전이 내내 무관하게 보존돼야 한다.
    assert db.analyses["a1"]["params"]["drain_points"] == [{"x": 9.0, "y": 9.0}]


def test_slope_judge_complete_job_does_not_touch_params_judge():
    """fn_job_complete는 params를 건드리지 않는다 - judge.state='done'은 워커
    핸들러(handle_slope_judge)가 stats 등 다른 파생 컬럼과 함께 직접 쓴다
    (analyses/reports와 동일한 책임 분담 관례)."""
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "done", "params": {}}
    jid = db.enqueue_job("slope_judge", {"analysis_id": "a1"})
    db.claim_job(ignore_backoff=True)
    db.complete_job(jid)
    assert db.jobs[jid]["status"] == "done"
    assert db.analyses["a1"]["params"]["judge"]["state"] == "processing"  # complete_job은 손대지 않음


def test_reap_stuck_jobs_requeues_slope_judge_only_when_judge_processing():
    """fn_reap_stuck_jobs(009_slope_judge_functions.sql)의 slope_judge 3단계
    시맨틱: analyses.status는 항상 'done'이라 analyze/import 조건(a.status==
    'processing')으로는 걸리지 않는다 - 대신 judge.state가 'processing'인 행만
    골라 'queued'로 되돌린다. analyses.status는 여기서도 절대 건드리지 않는다.
    """
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "done", "params": {}}
    jid = db.enqueue_job("slope_judge", {"analysis_id": "a1"})
    db.claim_job()  # judge.state -> processing
    db.jobs[jid]["locked_at"] = datetime.now(timezone.utc) - timedelta(minutes=31)  # 고착 재현

    n = db.reap_stuck_jobs()  # 기본 timeout_minutes=30

    assert n == 1
    assert db.jobs[jid]["status"] == "queued"
    assert db.analyses["a1"]["params"]["judge"]["state"] == "queued"
    assert db.analyses["a1"]["status"] == "done"  # 절대 안 바뀜


def test_reap_stuck_jobs_does_not_strip_error_from_slope_judge_judge():
    """2차 리뷰 M4 - 009의 fn_reap_stuck_jobs는 병합 시 error를 지우지 않는다
    (claim만 `coalesce(...) - 'error'`를 쓴다 - 004의 gen_error=null 클레임
    관례를 따르는 것은 claim뿐이다). reap이 만드는 jsonb_build_object에는
    error 키 자체가 없으므로, 병합(||) 결과에 기존 error가 있었다면 그대로
    남는다. FakeDB의 reap 3단계가 실수로 strip_error=True를 넘기면 이 테스트가
    잡는다 - job.status를 직접 'queued'로 세팅해(claim_job을 거치지 않고)
    reap 3단계만 단독으로 트리거한다.
    """
    db = FakeDB()
    db.analyses["a1"] = {
        "id": "a1", "status": "done",
        "params": {"judge": {"state": "processing", "at": "2026-01-01T00:00:00Z",
                             "error": "직전 소진 실패 사유"}},
    }
    jid = db.enqueue_job("slope_judge", {"analysis_id": "a1"})
    db.jobs[jid]["status"] = "queued"  # reap 3단계 조건(job.status=='queued')만 재현

    db.reap_stuck_jobs()

    judge = db.analyses["a1"]["params"]["judge"]
    assert judge["state"] == "queued"
    assert judge["error"] == "직전 소진 실패 사유"  # 지워지지 않아야 한다


def test_reap_stuck_jobs_leaves_slope_judge_untouched_when_judge_not_processing():
    """이미 done/failed로 종결된 judge 채널은 reap이 건드리면 안 된다 - 성공한
    재판정 결과를 이유 없이 'queued'로 되돌리는 조용한 회귀를 막는다."""
    db = FakeDB()
    db.analyses["a1"] = {"id": "a1", "status": "done",
                         "params": {"judge": {"state": "done", "at": "2026-01-01T00:00:00Z"}}}
    # queued 잡 하나를 남겨 reap의 3단계(quued·slope_judge 잡 순회) 대상에 놓는다.
    db.enqueue_job("slope_judge", {"analysis_id": "a1"})

    n = db.reap_stuck_jobs()

    assert n == 0
    assert db.analyses["a1"]["params"]["judge"]["state"] == "done"  # 그대로 유지


def test_register_job_status_propagates_to_linked_registration():
    """012_register_support.sql의 fn_job_claim/fn_job_fail은 type='register'이고
    payload.registration_id가 있으면 registrations.status를 전이시킨다: 클레임 ->
    processing(error_text 초기화), 재시도 여지 있는 실패 -> queued(+error_text),
    max_attempts 소진 -> failed(+error_text). report 분기와 같은 모양이다
    (설계 결정 F10: 정합은 자기 테이블에 자기 상태 컬럼이 있다).

    FakeDB가 이 분기를 빠뜨리면 워커 테스트가 **실제 DB와 다른 세계**를 검증한다.
    """
    db = FakeDB()
    db.registrations["g1"] = {"id": "g1", "status": "queued", "error_text": "이전 오류"}
    jid = db.enqueue_job("register", {"registration_id": "g1"})

    job = db.claim_job(ignore_backoff=True)
    assert job is not None
    assert db.registrations["g1"]["status"] == "processing"
    assert db.registrations["g1"]["error_text"] is None

    db.fail_job(jid, "정합 실패")
    assert db.registrations["g1"]["status"] == "queued"
    assert db.registrations["g1"]["error_text"] == "정합 실패"

    for _ in range(2):
        assert db.claim_job(ignore_backoff=True) is not None
        db.fail_job(jid, "정합 실패")
    assert db.jobs[jid]["status"] == "failed"
    assert db.registrations["g1"]["status"] == "failed"
    assert db.registrations["g1"]["error_text"] == "정합 실패"


def test_register_job_complete_does_not_touch_registration_status():
    """fn_job_complete는 jobs만 종결한다 - registrations.status='done'은 워커가
    결과 컬럼(transform·rmse_mm·result_scan_id)과 함께 직접 쓴다."""
    db = FakeDB()
    db.registrations["g1"] = {"id": "g1", "status": "queued", "error_text": None}
    jid = db.enqueue_job("register", {"registration_id": "g1"})
    db.claim_job(ignore_backoff=True)
    db.complete_job(jid)
    assert db.registrations["g1"]["status"] == "processing"


def test_reap_stuck_jobs_requeues_register_only_when_processing():
    """고착 잡이 회수되면 정합 화면도 '대기 중'으로 되돌린다 - 이 줄이 없으면 잡은
    다시 큐에 들어갔는데 화면만 '정합 중...'에 영구히 남는다. 반대로 이미 done인
    정합은 건드리면 안 된다(성공 결과를 이유 없이 되돌리는 조용한 회귀)."""
    db = FakeDB()
    db.registrations["g1"] = {"id": "g1", "status": "queued", "error_text": None}
    db.registrations["g2"] = {"id": "g2", "status": "done", "error_text": None}
    stuck = db.enqueue_job("register", {"registration_id": "g1"})
    db.enqueue_job("register", {"registration_id": "g2"})   # queued인 채로 남겨 순회 대상에 둔다
    db.claim_job(ignore_backoff=True)
    db.jobs[stuck]["locked_at"] = datetime.now(timezone.utc) - timedelta(minutes=60)

    assert db.reap_stuck_jobs(timeout_minutes=30) == 1
    assert db.registrations["g1"]["status"] == "queued"
    assert db.registrations["g2"]["status"] == "done"

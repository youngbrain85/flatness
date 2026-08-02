"""보고서 잡 E2E(FakeDB + FakeRenderer) — 실제 엔진 분석 산출물을 재료로 쓴다.

네트워크·브라우저 없이 잡 큐 -> 자산 -> snapshot -> HTML -> PDF -> reports 갱신까지
한 번에 검증한다.
"""
import json

import pytest

from flatworker.config import Config
from flatworker.db import DBError
from flatworker.jobs import handle_analyze, handle_report
from flatworker.runner import run_loop
from flatworker.storage import LocalStorage
from tests.fake_db import FakeDB
from tests.fake_renderer import FakeRenderer
from tests.synthetic_helpers import synthetic
from flatworker.artifacts import raw_scan_dir

flat_floor, add_bump, write_binary_ply = (synthetic.flat_floor, synthetic.add_bump,
                                          synthetic.write_binary_ply)


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _storage(tmp_path):
    return LocalStorage(tmp_path / "data")


def _seed_analyzed_floor(db, cfg):
    """합성 바닥 스캔을 실제 엔진으로 분석해 artifacts를 만든다."""
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010)
    scan_dir = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_binary_ply(pts, scan_dir / "raw.ply")
    db.sites["site1"] = {"id": "site1", "name": "테스트 현장", "address": None, "memo": None}
    db.locations["loc1"] = {"id": "loc1", "site_id": "site1", "building": "101동",
                            "floor": "3층", "room": "거실", "name": "P1", "memo": None}
    db.scans["scan1"] = {"id": "scan1", "location_id": "loc1", "surface": "floor",
                         "scanned_at": "2026-07-20", "device": "iPhone 15 Pro",
                         "operator_id": None, "operator_name_manual": "홍길동",
                         "raw_file_path": "raw-scans/site1/scan1/raw.ply",
                         "original_filename": "raw.ply", "file_format": "ply",
                         "point_count": len(pts), "unit_scale": 1.0, "lineage": "raw",
                         "status": "ready", "selected_criteria_id": "c1"}
    db.criteria["c1"] = {"id": "c1", "surface": "floor", "name": "floor-kcs-exposed",
                         "source_text": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)",
                         "thresholds": [{"span_m": 3, "metric": "flatness",
                                         "pass_mm": 7, "rework_mm": 21}]}
    db.app_settings["uncertainty_mm"] = {"floor": 5.0, "wall": 8.0}
    db.analyses["an1"] = {"id": "an1", "scan_id": "scan1", "surface": "floor",
                          "criteria_id": "c1", "status": "queued"}
    handle_analyze(db, cfg, {"analysis_id": "an1"})
    return "an1"


def _seed_report(db, opinion_text=None):
    db.reports["r1"] = {"id": "r1", "location_id": "loc1", "title": "3층 거실 평활도 보고서",
                        "status": "draft", "snapshot": None, "opinion_text": opinion_text,
                        "pdf_path": None, "gen_status": "queued", "gen_error": None,
                        "created_by": None, "created_at": "2026-07-29T00:00:00+00:00"}
    db.report_analyses.append({"report_id": "r1", "analysis_id": "an1", "sort_order": 0})


def test_report_job_produces_pdf_and_updates_row(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_analyzed_floor(db, cfg)
    _seed_report(db)
    renderer = FakeRenderer()

    handle_report(db, cfg, {"report_id": "r1"}, renderer=renderer)

    report = db.reports["r1"]
    assert report["gen_status"] == "done" and report["gen_error"] is None
    assert report["pdf_path"] == "reports/r1/report.pdf"
    assert (cfg.data_dir / report["pdf_path"]).exists()
    snap = report["snapshot"]
    assert snap["schema"] == "report-snapshot-v1"
    assert snap["analyses"][0]["assets"]["heatmaps"][0]["path"].startswith("reports/r1/assets/")
    assert (cfg.data_dir / snap["analyses"][0]["assets"]["histogram"]).exists()
    # 렌더러에는 snapshot만으로 만든 HTML이 전달된다
    assert "3층 거실 평활도 보고서" in renderer.calls[0]["html"]
    # base_dir는 이제 cfg.data_dir 아래 고정 경로가 아니라 잡 처리 동안만 쓰는
    # 스테이징 임시 디렉터리다(artifacts.staging_dir, prefix="flatworker-").
    assert renderer.calls[0]["base_dir"].name.startswith("flatworker-")


def test_report_job_runs_through_runner_and_completes_job(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_analyzed_floor(db, cfg)
    _seed_report(db)
    renderer = FakeRenderer()
    handlers = {"report": lambda d, c, p: handle_report(d, c, p, renderer=renderer)}
    job_id = db.enqueue_job("report", {"report_id": "r1"})

    run_loop(db, cfg, handlers=handlers, max_iterations=1)

    assert db.jobs[job_id]["status"] == "done"
    assert db.reports["r1"]["gen_status"] == "done"


def test_report_job_failure_marks_gen_status_failed(tmp_path):
    """스펙 §9: 실패는 잡 상태 전이로 UI에 드러나야 한다. 포함 분석이 없으면
    handle_report가 ValueError를 올리고 러너가 fail_job으로 전이시킨다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_analyzed_floor(db, cfg)
    _seed_report(db)
    db.report_analyses.clear()
    handlers = {"report": lambda d, c, p: handle_report(d, c, p, renderer=FakeRenderer())}
    job_id = db.enqueue_job("report", {"report_id": "r1"})

    run_loop(db, cfg, handlers=handlers, max_iterations=3)

    assert db.reports["r1"]["gen_status"] == "queued"   # 재시도 여지 있음
    assert "포함된 분석이 없습니다" in db.reports["r1"]["gen_error"]
    assert db.jobs[job_id]["status"] == "queued"


def test_handle_report_rejects_finalized_report(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_analyzed_floor(db, cfg)
    _seed_report(db)
    db.reports["r1"]["status"] = "finalized"
    with pytest.raises(ValueError, match="발행된 보고서"):
        handle_report(db, cfg, {"report_id": "r1"}, renderer=FakeRenderer())


def test_report_html_written_next_to_pdf_for_debugging(tmp_path):
    """PlaywrightRenderer는 렌더링을 위해 base_dir(스테이징)에 report.html을 쓴다 -
    스테이징은 handle_report 종료 시 통째로 지워지므로, 여기서는 렌더러가 실제로
    받은 HTML 문자열(FakeRenderer.calls)로 같은 사실을 검증한다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_analyzed_floor(db, cfg)
    _seed_report(db, opinion_text="작성자 종합의견")
    renderer = FakeRenderer()
    handle_report(db, cfg, {"report_id": "r1"}, renderer=renderer)
    assert "작성자 종합의견" in renderer.calls[0]["html"]
    assert json.loads(json.dumps(db.reports["r1"]["snapshot"]))["opinion"]["source"] == "user"


class _FinalizeDuringRenderRenderer(FakeRenderer):
    """render_pdf 호출 시점에 발행이 확정되는 경합을 재현하는 테스트 전용 렌더러.

    실제로는 Playwright 렌더링이 수 초 걸리는 동안 사용자가 발행 버튼을 눌러
    reports.status가 draft -> finalized로 바뀌는 상황과 같다. render_pdf 자체는
    FakeRenderer와 동일하게 tmp 파일을 정상적으로 다 쓴 "뒤"에 상태를 바꾼다."""

    def __init__(self, db, report_id):
        super().__init__()
        self._db = db
        self._report_id = report_id

    def render_pdf(self, html, base_dir, out_path):
        super().render_pdf(html, base_dir, out_path)
        self._db.reports[self._report_id]["status"] = "finalized"


def test_report_job_preserves_published_pdf_when_finalized_mid_render(tmp_path):
    """코드리뷰 Important(I1) 회귀 - 리뷰어가 FakeDB에 004 트리거를 모사해 재현한
    시나리오: 렌더 도중(자산 복사~PDF 생성 사이) 발행이 확정되면, DB 갱신은 004
    트리거(FakeDB.update_report의 재현)가 42501로 거부해야 하고, 이때 저장소의
    발행본 report.pdf는 재생성분으로 덮어써지지 않고 그대로 보존돼야 한다
    (storage.upload를 db.update_report 성공 이후에만 실행해 원격을 건드리는 시점을
    최대한 늦춘다).
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    storage = _storage(tmp_path)
    _seed_analyzed_floor(db, cfg)
    _seed_report(db)

    # 1) 정상 생성 -> 발행 확정(004 트리거 통과 조건: pdf_path·snapshot 존재)
    handle_report(db, cfg, {"report_id": "r1"}, renderer=FakeRenderer())
    published_bytes = storage.download("reports/r1/report.pdf")
    db.reports["r1"]["status"] = "finalized"

    # 2) 재생성 잡이 발행 확정 이전에 이미 클레임돼 진행 중이었다고 가정하고
    #    (load_report_context와 rmtree 직전 재확인 두 관문을 통과시키기 위해)
    #    잠시 draft로 되돌린 뒤, 렌더링 도중(=Playwright가 오래 걸리는 사이) 발행이
    #    확정되는 경합을 재현한다. opinion_text를 바꿔 두 번째 snapshot이 첫 번째와
    #    (generated_at의 초 단위 타임스탬프가 우연히 같은 초에 찍히더라도) 반드시
    #    달라지도록 한다 - 그래야 FakeDB의 트리거 재현이 "snapshot 필드 변경"을
    #    타이밍에 기대지 않고 결정적으로 감지한다.
    db.reports["r1"]["status"] = "draft"
    db.reports["r1"]["opinion_text"] = "재생성 시도 중 다른 의견으로 덮어씀"
    renderer = _FinalizeDuringRenderRenderer(db, "r1")

    with pytest.raises(DBError, match="발행된 보고서는 수정할 수 없습니다"):
        handle_report(db, cfg, {"report_id": "r1"}, renderer=renderer)

    # 발행본 PDF는 재생성분으로 덮어써지지 않고 그대로 보존된다(원격 미변경 -
    # db.update_report가 거부되면 storage.upload 자체가 실행되지 않는다).
    # 스테이징(work)은 handle_report 종료 시 통째로 지워지므로 tmp 잔재 걱정도 없다.
    assert storage.download("reports/r1/report.pdf") == published_bytes


class _FinalizeOnSecondGetReportDB:
    """load_report_context 통과 직후 발행이 확정되는 경합(자산 rmtree 직전 재확인
    관문)을 재현하기 위한 래퍼 - get_report를 2번째 호출부터 finalized로 바꿔
    돌려준다(1번째 호출은 load_report_context 안, 2번째는 handle_report의 재확인)."""

    def __init__(self, db):
        self._db = db
        self._get_report_calls = 0

    def get_report(self, report_id):
        report = dict(self._db.get_report(report_id))
        self._get_report_calls += 1
        if self._get_report_calls >= 2:
            report["status"] = "finalized"
        return report

    def __getattr__(self, name):
        return getattr(self._db, name)


def test_handle_report_aborts_before_asset_rmtree_when_finalized_race_detected(tmp_path):
    """코드리뷰 Important(I1) 수정 2 회귀 - load_report_context의 1회 검사와
    build_assets(자산 디렉터리 rmtree) 사이의 경합은 rmtree 직전 재확인으로 막아야
    한다. rmtree가 실행되면 기존 발행본 자산이 지워진 뒤라 되돌릴 수 없으므로,
    "지우기 전에 막는다"는 사실 자체를 assert한다(재확인 없이는 sentinel 파일이
    사라진다).
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    storage = _storage(tmp_path)
    _seed_analyzed_floor(db, cfg)
    _seed_report(db)
    storage.upload("reports/r1/assets/sentinel.txt", "이전 발행본 자산".encode("utf-8"))

    wrapped = _FinalizeOnSecondGetReportDB(db)
    with pytest.raises(ValueError, match="발행된 보고서는 다시 생성할 수 없습니다"):
        handle_report(wrapped, cfg, {"report_id": "r1"}, renderer=FakeRenderer())

    # delete_prefix(rmtree 상당)가 실행되지 않아 기존 발행본 자산이 보존됨
    assert storage.download("reports/r1/assets/sentinel.txt") is not None


def test_run_loop_default_handlers_wire_report_job_through_playwright_renderer_seam(tmp_path, monkeypatch):
    """코드리뷰 Important(I5) 회귀 - 이 파일의 다른 report E2E 테스트는 모두
    handlers={"report": ...FakeRenderer...}를 주입해 runner._DEFAULT_HANDLERS의
    'report' 키를 실제로 거치지 않는다. 그 키를 지워도 전 스위트가 green이었다.
    PlaywrightRenderer 클래스 자체를 FakeRenderer로 몽키패치하고(handle_report의
    지연 import가 호출 시점에 이 속성을 다시 조회하므로 유효하다) handlers 인자
    없이 run_loop을 돌려 report 잡이 기본 배선(_DEFAULT_HANDLERS)으로 처리되는지
    검증한다.
    """
    import flatworker.report.renderer as renderer_module

    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_analyzed_floor(db, cfg)
    _seed_report(db)
    monkeypatch.setattr(renderer_module, "PlaywrightRenderer", FakeRenderer)
    job_id = db.enqueue_job("report", {"report_id": "r1"})

    run_loop(db, cfg, max_iterations=1)  # handlers= 생략 -> _DEFAULT_HANDLERS 사용

    assert db.jobs[job_id]["status"] == "done"
    assert db.reports["r1"]["gen_status"] == "done"

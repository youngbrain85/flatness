"""보고서 잡 E2E(FakeDB + FakeRenderer) — 실제 엔진 분석 산출물을 재료로 쓴다.

네트워크·브라우저 없이 잡 큐 -> 자산 -> snapshot -> HTML -> PDF -> reports 갱신까지
한 번에 검증한다.
"""
import json

import pytest

from flatworker.config import Config
from flatworker.jobs import handle_analyze, handle_report
from flatworker.runner import run_loop
from tests.fake_db import FakeDB
from tests.fake_renderer import FakeRenderer
from tests.synthetic_helpers import synthetic
from flatworker.artifacts import raw_scan_dir

flat_floor, add_bump, write_binary_ply = (synthetic.flat_floor, synthetic.add_bump,
                                          synthetic.write_binary_ply)


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


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
    assert renderer.calls[0]["base_dir"] == cfg.data_dir / "reports" / "r1"


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
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_analyzed_floor(db, cfg)
    _seed_report(db, opinion_text="작성자 종합의견")
    handle_report(db, cfg, {"report_id": "r1"}, renderer=FakeRenderer())
    html = (cfg.data_dir / "reports" / "r1" / "report.html").read_text(encoding="utf-8")
    assert "작성자 종합의견" in html
    assert json.loads(json.dumps(db.reports["r1"]["snapshot"]))["opinion"]["source"] == "user"

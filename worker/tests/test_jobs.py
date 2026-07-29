import pytest

from tests.synthetic_helpers import synthetic
flat_floor, add_bump, write_binary_ply = synthetic.flat_floor, synthetic.add_bump, synthetic.write_binary_ply
from flatworker.config import Config
from flatworker.jobs import handle_analyze, handle_import, overall_verdict
from flatworker.artifacts import raw_scan_dir, artifacts_dir
from tests.fake_db import FakeDB


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _seed_floor_scan(db, cfg):
    # 함몰 10mm 바닥 스캔 + 분석 행 시드
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_binary_ply(pts, sd / "raw.ply")
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "floor",
                         # 스펙 §6.3 규약대로 버킷-상대 문자열만 저장(data_dir 접두 없음)
                         # — handle_analyze/handle_import가 cfg.data_dir에 결합해 연다.
                         "raw_file_path": "raw-scans/site1/scan1/raw.ply", "unit_scale": 1.0,
                         "status": "ready", "selected_criteria_id": "c1"}
    db.criteria["c1"] = {"id": "c1", "surface": "floor", "name": "floor-kcs-exposed",
                         "source_text": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)",
                         "thresholds": [{"span_m": 3, "metric": "flatness", "pass_mm": 7, "rework_mm": 21}]}
    db.app_settings["uncertainty_mm"] = {"floor": 5.0, "wall": 8.0}
    db.analyses["a1"] = {"id": "a1", "scan_id": "scan1", "surface": "floor",
                         "criteria_id": "c1", "status": "queued"}
    return "a1"


def test_handle_analyze_floor(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_floor_scan(db, cfg)
    handle_analyze(db, cfg, {"analysis_id": aid})
    a = db.analyses[aid]
    assert a["status"] == "done"
    assert 9.0 <= a["stats"]["worst"]["value_mm"] <= 11.0
    assert a["overall_verdict"] in ("borderline", "repair")
    assert (artifacts_dir(cfg.data_dir, aid) / "heatmap.png").exists()
    assert a["auto_summary"] and "대체하지 않습니다" in a["auto_summary"]
    assert db.current_analysis.get("scan1") == aid
    # 코드리뷰 Important(I1): DB에는 버킷-상대 규약 문자열만 저장(워커 CWD 상대·OS
    # 종속 절대경로가 아님) — 실제 파일 위치는 소비자가 DATA_DIR에 결합해 얻는다.
    assert a["artifacts_dir"] == f"artifacts/{aid}"


def test_overall_verdict_priority():
    assert overall_verdict({"n_valid": 5, "grade_counts": {"pass": 1, "borderline": 0, "repair": 2, "rework": 1, "na": 1}}) == "rework"
    assert overall_verdict({"n_valid": 5, "grade_counts": {"pass": 5, "borderline": 0, "repair": 0, "rework": 0, "na": 0}}) == "pass"
    assert overall_verdict({"n_valid": 0, "grade_counts": {"pass": 0, "borderline": 0, "repair": 0, "rework": 0, "na": 3}}) is None


def test_handle_import_rejects_wall_scan(tmp_path):
    """코드리뷰 Minor(M2): 임포트는 바닥 전용 계약(스펙 §5.4) — 벽 스캔이면 명확한
    한국어 메시지로 조기 실패해야 한다(엔진 import_colab_csv 자체가 meta.surface를
    "floor"로 고정 출력하므로, 막지 않으면 scan.surface와 모순되는 stats가 만들어짐).
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "wall",
                         "raw_file_path": "raw-scans/site1/scan1/raw.csv", "unit_scale": 1.0,
                         "status": "ready", "selected_criteria_id": "c1"}
    db.criteria["c1"] = {"id": "c1", "surface": "wall", "name": "wall-kcs-tilt-other",
                         "source_text": "KCS 21 50 05 §3.2.6 (기타)",
                         "thresholds": [{"span_m": 3, "metric": "flatness", "pass_mm": 9, "rework_mm": 27}]}
    db.app_settings["uncertainty_mm"] = {"floor": 5.0, "wall": 8.0}
    db.analyses["a1"] = {"id": "a1", "scan_id": "scan1", "surface": "wall",
                         "criteria_id": "c1", "status": "queued"}

    with pytest.raises(ValueError, match="바닥"):
        handle_import(db, cfg, {"analysis_id": "a1"})

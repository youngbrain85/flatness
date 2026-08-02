import json
import tempfile
from pathlib import Path

import numpy as np
import pytest

from tests.synthetic_helpers import synthetic
flat_floor, add_bump, write_binary_ply = synthetic.flat_floor, synthetic.add_bump, synthetic.write_binary_ply
from flatworker.config import Config
from flatworker.jobs import handle_analyze, handle_import, overall_verdict
from flatworker.artifacts import raw_scan_dir, artifacts_dir
from flatworker.storage import get_storage
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


def _seed_scan_via_storage(db, storage):
    """원본이 로컬 data_dir가 아니라 Storage에만 있는 상황을 시드한다.

    스캔 파일을 별도 임시 디렉터리(cfg.data_dir가 아닌 곳)에 써서 bytes로 읽은 뒤
    storage.upload로만 올린다 - cfg.data_dir 아래에는 이 원본이 전혀 존재하지 않아,
    handle_analyze가 Storage를 거치지 않고 cfg.data_dir에 직접 결합해 열면(과거
    _resolve_raw_path 방식) 반드시 실패한다.
    """
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010)
    with tempfile.TemporaryDirectory() as d:
        tmp_ply = Path(d) / "raw.ply"
        write_binary_ply(pts, tmp_ply)
        storage.upload("raw-scans/site1/scan1/raw.ply", tmp_ply.read_bytes())
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "floor",
                         "raw_file_path": "raw-scans/site1/scan1/raw.ply", "unit_scale": 1.0,
                         "status": "ready", "selected_criteria_id": "c1"}
    db.criteria["c1"] = {"id": "c1", "surface": "floor", "name": "floor-kcs-exposed",
                         "source_text": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)",
                         "thresholds": [{"span_m": 3, "metric": "flatness", "pass_mm": 7, "rework_mm": 21}]}
    db.app_settings["uncertainty_mm"] = {"floor": 5.0, "wall": 8.0}


def _seed_analysis(db):
    db.analyses["a1"] = {"id": "a1", "scan_id": "scan1", "surface": "floor",
                         "criteria_id": "c1", "status": "queued"}
    return "a1"


def test_handle_analyze_reads_and_writes_through_storage(tmp_path):
    """원본이 data_dir에 파일로 없고 Storage에만 있어도 분석이 되고,
    산출물이 Storage 키(artifacts/{id}/...)로 올라간다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    storage = get_storage(cfg, db)
    _seed_scan_via_storage(db, storage)
    aid = _seed_analysis(db)
    handle_analyze(db, cfg, {"analysis_id": aid})
    assert storage.download(f"artifacts/{aid}/stats.json") is not None
    assert storage.download(f"artifacts/{aid}/heatmap.png") is not None
    assert db.analyses[aid]["artifacts_dir"] == f"artifacts/{aid}"


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


def _depression_deviation_mm(pts):
    r = np.hypot(pts[:, 0] - 2.0, pts[:, 1] - 2.0)
    return np.where(r < 0.3, -10.0 * 0.5 * (1.0 + np.cos(np.pi * r / 0.3)), 0.0)


def _seed_import_scan(db, cfg, ext, write_fn):
    """csv/json 임포트용 스캔·분석 행을 시드한다(과업 B4: 확장자 분기 검증).

    _seed_floor_scan(원본 스캔 분석)과 달리 임포트 경로는 이미 평면 제거된
    편차값(deviation_mm)을 입력으로 받으므로 test_import_colab.py와 동일하게
    함몰 형상을 직접 계산해 파일에 쓴다.
    """
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    deviation_mm = _depression_deviation_mm(pts)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_fn(sd / f"raw.{ext}", pts, deviation_mm)
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "floor",
                         "raw_file_path": f"raw-scans/site1/scan1/raw.{ext}", "unit_scale": 1.0,
                         "status": "ready", "selected_criteria_id": "c1"}
    db.criteria["c1"] = {"id": "c1", "surface": "floor", "name": "floor-kcs-exposed",
                         "source_text": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)",
                         "thresholds": [{"span_m": 3, "metric": "flatness", "pass_mm": 7, "rework_mm": 21}]}
    db.app_settings["uncertainty_mm"] = {"floor": 5.0, "wall": 8.0}
    db.analyses["a1"] = {"id": "a1", "scan_id": "scan1", "surface": "floor",
                         "criteria_id": "c1", "status": "queued"}
    return "a1"


def _write_import_csv(path, pts, deviation_mm):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("X,Y,Z,Distance_mm,Signed_Distance_mm,R,G,B,Is_Uneven\n")
        for (x, y, z), s in zip(pts, deviation_mm):
            f.write(f"{x},{y},{z},{abs(s)},{s},0,128,0,False\n")


def _write_import_json(path, pts, deviation_mm):
    doc = {"format": "flatness-import-v1", "surface": "floor",
           "points": [{"x": float(x), "y": float(y), "deviation_mm": float(d)}
                       for (x, y, _z), d in zip(pts, deviation_mm)]}
    path.write_text(json.dumps(doc), encoding="utf-8")


def test_handle_import_dispatches_by_extension_csv(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_import_scan(db, cfg, "csv", _write_import_csv)
    handle_import(db, cfg, {"analysis_id": aid})
    a = db.analyses[aid]
    assert a["status"] == "done"
    assert a["stats"]["meta"]["source"] == "colab-import"
    assert 9.0 <= a["stats"]["worst"]["value_mm"] <= 11.0


def test_handle_import_dispatches_by_extension_json(tmp_path):
    """B4: raw_file_path 확장자가 .json이면 JSON 임포터로 분기해야 한다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_import_scan(db, cfg, "json", _write_import_json)
    handle_import(db, cfg, {"analysis_id": aid})
    a = db.analyses[aid]
    assert a["status"] == "done"
    assert a["stats"]["meta"]["source"] == "json-import"
    assert 9.0 <= a["stats"]["worst"]["value_mm"] <= 11.0


def test_handle_import_csv_json_consistency(tmp_path):
    """같은 함몰 데이터를 CSV/JSON 두 경로로 각각 임포트하면 동등한 판정이 나와야
    한다(계약 일관성, docs/contracts/stats-schema.md §7)."""
    db_csv, cfg = FakeDB(), _cfg(tmp_path / "csv")
    aid_csv = _seed_import_scan(db_csv, cfg, "csv", _write_import_csv)
    handle_import(db_csv, cfg, {"analysis_id": aid_csv})

    db_json, cfg2 = FakeDB(), _cfg(tmp_path / "json")
    aid_json = _seed_import_scan(db_json, cfg2, "json", _write_import_json)
    handle_import(db_json, cfg2, {"analysis_id": aid_json})

    s_csv, s_json = db_csv.analyses[aid_csv]["stats"], db_json.analyses[aid_json]["stats"]
    assert s_csv["grade_counts"] == s_json["grade_counts"]
    assert s_csv["value_max_mm"] == s_json["value_max_mm"]


def test_handle_import_rejects_unsupported_extension(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    (sd / "raw.txt").write_text("x", encoding="utf-8")
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "floor",
                         "raw_file_path": "raw-scans/site1/scan1/raw.txt", "unit_scale": 1.0,
                         "status": "ready", "selected_criteria_id": "c1"}
    db.criteria["c1"] = {"id": "c1", "surface": "floor", "name": "floor-kcs-exposed",
                         "source_text": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)",
                         "thresholds": [{"span_m": 3, "metric": "flatness", "pass_mm": 7, "rework_mm": 21}]}
    db.app_settings["uncertainty_mm"] = {"floor": 5.0, "wall": 8.0}
    db.analyses["a1"] = {"id": "a1", "scan_id": "scan1", "surface": "floor",
                         "criteria_id": "c1", "status": "queued"}

    with pytest.raises(ValueError, match="지원하지 않는"):
        handle_import(db, cfg, {"analysis_id": "a1"})

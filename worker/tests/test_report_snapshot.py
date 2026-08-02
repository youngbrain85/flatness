"""snapshot 계약(report-snapshot-v1) 단위 테스트.

계약 정본: docs/superpowers/plans/2026-07-29-p4-report.md "reports.snapshot 계약".
"""
import json

import pytest

from flatworker.config import Config
from flatworker.report.context import load_report_context
from flatworker.report.snapshot import (SNAPSHOT_SCHEMA, build_sections, build_snapshot,
                                        coverage_label)
from flatworker.storage import LocalStorage
from tests.fake_db import FakeDB


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _storage(tmp_path):
    return LocalStorage(tmp_path / "data")


def _floor_stats():
    """engine analyze_floor 산출 stats의 실제 키 구성(축소판)."""
    return {
        "n_cells": 4, "n_valid": 3,
        "grade_counts": {"pass": 2, "borderline": 1, "repair": 0, "rework": 0, "na": 1},
        "grade_pct": {"pass": 50.0, "borderline": 25.0, "repair": 0.0, "rework": 0.0, "na": 25.0},
        "value_max_mm": 8.2, "value_min_mm": 1.1, "value_mean_mm": 4.2, "value_p95_mm": 8.0,
        "worst": {"value_mm": 8.2, "cell_ix": 1, "cell_iy": 0,
                  "point_x": 1.25, "point_y": 0.5, "zone_id": 1},
        "coverage_pct": 91.5, "reduced_span_cells": 1,
        "applied_criteria": {"name": "floor-kcs-exposed",
                             "source": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)",
                             "span_m": 3, "pass_mm": 7, "rework_mm": 21, "u_mm": 5.0},
        "warnings": ["reduced_span"],
        "zones": [{"zone_id": 1, "level_m": 0.02, "area_m2": 12.5, "status": "ok",
                   "plane_abc": [0.0, 0.0, 0.0]}],
        "meta": {"file": "raw.ply", "n_points": 120000, "engine_version": "p1d-0.4.0",
                 "surface": "floor", "scale_to_m": 1.0, "subcell_m": 0.05, "cell_m": 1.0,
                 "bbox_min": [0.0, 0.0, 0.0]},
        "auto_summary": "바닥면 평활도 분석 결과...",
        "preview3d_paths": ["preview3d.png"],
    }


def _cells():
    return [
        {"ix": 0, "iy": 0, "center_x": 0.5, "center_y": 0.5, "value_mm": 1.1,
         "span_used_m": 3.0, "occupancy": 0.9, "grade": "pass", "worst_x": 0.4,
         "worst_y": 0.5, "zone_id": 1},
        {"ix": 1, "iy": 0, "center_x": 1.5, "center_y": 0.5, "value_mm": 8.2,
         "span_used_m": 3.0, "occupancy": 0.9, "grade": "borderline", "worst_x": 1.25,
         "worst_y": 0.5, "zone_id": 1},
        {"ix": 0, "iy": 1, "center_x": 0.5, "center_y": 1.5, "value_mm": 3.3,
         "span_used_m": 2.5, "occupancy": 0.8, "grade": "pass", "worst_x": 0.5,
         "worst_y": 1.4, "zone_id": 1},
        {"ix": 1, "iy": 1, "center_x": 1.5, "center_y": 1.5, "value_mm": None,
         "span_used_m": 0.0, "occupancy": 0.3, "grade": "na", "worst_x": None,
         "worst_y": None, "zone_id": 1},
    ]


def _seed(db, cfg, *, status="done"):
    stats = _floor_stats()
    artifacts = cfg.data_dir / "artifacts" / "an1"
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / "cells.json").write_text(json.dumps(_cells()), encoding="utf-8")
    db.sites["site1"] = {"id": "site1", "name": "테스트 현장", "address": "서울시", "memo": None}
    db.locations["loc1"] = {"id": "loc1", "site_id": "site1", "building": "101동",
                            "floor": "3층", "room": "거실", "name": "P1", "memo": None}
    db.profiles["u1"] = {"id": "u1", "display_name": "홍길동"}
    db.scans["scan1"] = {"id": "scan1", "location_id": "loc1", "surface": "floor",
                         "scanned_at": "2026-07-20", "device": "iPhone 15 Pro",
                         "operator_id": "u1", "operator_name_manual": None,
                         "original_filename": "room.ply", "file_format": "ply",
                         "point_count": 120000, "unit_scale": 1.0, "lineage": "raw",
                         "status": "ready"}
    db.analyses["an1"] = {"id": "an1", "scan_id": "scan1", "surface": "floor",
                          "criteria_id": "c1", "status": status, "stats": stats,
                          "coverage_pct": 91.5, "overall_verdict": "borderline",
                          "warnings": ["reduced_span"], "artifacts_dir": "artifacts/an1",
                          "engine_version": "p1d-0.4.0",
                          "auto_summary": "바닥면 평활도 분석 결과...", "user_summary": None}
    db.reports["r1"] = {"id": "r1", "location_id": "loc1", "title": "3층 거실 평활도 보고서",
                        "status": "draft", "snapshot": None, "opinion_text": None,
                        "pdf_path": None, "gen_status": "processing", "gen_error": None,
                        "created_by": "u1", "created_at": "2026-07-29T00:00:00+00:00"}
    db.report_analyses.append({"report_id": "r1", "analysis_id": "an1", "sort_order": 0})
    db.photos["p1"] = {"id": "p1", "scan_id": "scan1", "location_id": None, "site_id": None,
                       "file_path": "photos/p1.jpg", "caption": "측정 지점",
                       "taken_at": "2026-07-20", "created_at": "2026-07-20T01:00:00+00:00"}
    db.photo_blobs["photos/p1.jpg"] = b"\xff\xd8\xff\xd9"


_EMPTY_ASSETS = {"analyses": {}, "photos": [], "notes": []}


def test_build_sections_matches_dashboard_aggregation():
    """대시보드 computeZoneStats(dashboard/lib/domain/cells.ts)와 같은 규칙:
    기준 초과 = 보수+재시공, max/min/mean은 유효 셀만, 비율은 전체 셀 대비."""
    sections = build_sections(_cells(), _floor_stats())
    assert len(sections) == 1
    s = sections[0]
    assert s["section_id"] == 1 and s["kind"] == "zone" and s["label"] == "구역 1"
    assert s["n_cells"] == 4 and s["n_valid"] == 3
    assert s["max_mm"] == 8.2 and s["min_mm"] == 1.1 and s["mean_mm"] == 4.2
    assert s["over_cells"] == 0 and s["over_pct"] == 0.0
    assert s["status_label"] == "정상" and s["area_m2"] == 12.5


def test_build_sections_wall_uses_wall_labels_and_plumbness():
    stats = _floor_stats()
    stats["meta"]["surface"] = "wall"
    stats["zones"] = []
    stats["walls"] = [{"wall_id": 1, "n_cells": 4, "height_m": 2.4, "length_m": 5.0,
                       "plumbness_mm": 12.0, "plumb_grade": "pass",
                       "plane_abc": [0.0, 0.0, 0.0], "frame": {}}]
    s = build_sections(_cells(), stats)[0]
    assert s["kind"] == "wall" and s["label"] == "벽 1"
    assert s["plumbness_mm"] == 12.0 and s["plumb_grade_label"] == "적합"
    assert s["length_m"] == 5.0 and s["height_m"] == 2.4


def test_coverage_label_follows_stats_contract():
    assert coverage_label(_floor_stats()) == "바닥 인식률"
    wall = _floor_stats()
    wall["meta"]["surface"] = "wall"
    assert coverage_label(wall) == "셀 유효율"
    imported = _floor_stats()
    imported["meta"]["source"] = "colab-import"
    assert coverage_label(imported) == "셀 유효율"


def test_build_snapshot_contract_keys(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    ctx = load_report_context(db, _storage(tmp_path), "r1")
    snap = build_snapshot(ctx, _EMPTY_ASSETS)

    assert snap["schema"] == SNAPSHOT_SCHEMA
    assert snap["generated_at"].endswith("Z")
    assert snap["site"]["name"] == "테스트 현장"
    assert snap["location"]["building"] == "101동"
    assert snap["report"]["title"] == "3층 거실 평활도 보고서"
    assert "대체하지 않습니다" in snap["disclaimer"]
    assert snap["palette"]["grade_colors"]["rework"] == "#c5221f"

    a = snap["analyses"][0]
    assert a["surface_label"] == "바닥" and a["is_external"] is False
    assert a["scan"]["operator_name"] == "홍길동"       # profiles.display_name 폴백
    assert a["scan"]["lineage_label"] == "원시 점군"
    assert a["criteria"]["u_mm"] == 5.0
    assert a["overview"]["coverage_label"] == "바닥 인식률"
    assert a["summary"]["overall_verdict_label"] == "경계"
    assert a["summary"]["worst"]["value_mm"] == 8.2
    assert [w["code"] for w in a["warnings"]] == ["reduced_span"]
    assert a["warnings"][0]["text"].startswith("공간 제약")
    assert a["sections"][0]["label"] == "구역 1"
    # 렌더러가 읽는 유일한 자산 통로: Task 3이 채우기 전에는 비어 있다
    assert a["assets"] == {"heatmaps": [], "deviation": [], "preview3d": [], "histogram": None}


def test_build_opinion_prefers_report_text_then_analysis_summaries(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")
    auto = build_snapshot(ctx, _EMPTY_ASSETS)["opinion"]
    assert auto["source"] == "auto" and auto["text"].startswith("[바닥] ")

    db.analyses["an1"]["user_summary"] = "현장 재확인 결과 이상 없음"
    ctx = load_report_context(db, storage, "r1")
    assert build_snapshot(ctx, _EMPTY_ASSETS)["opinion"]["text"] == "[바닥] 현장 재확인 결과 이상 없음"

    db.reports["r1"]["opinion_text"] = "작성자 종합의견"
    ctx = load_report_context(db, storage, "r1")
    user = build_snapshot(ctx, _EMPTY_ASSETS)["opinion"]
    assert user == {"text": "작성자 종합의견", "source": "user"}


def test_load_report_context_rejects_invalid_inputs(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    storage = _storage(tmp_path)
    _seed(db, cfg, status="processing")
    with pytest.raises(ValueError, match="완료되지 않은 분석"):
        load_report_context(db, storage, "r1")

    db.analyses["an1"]["status"] = "done"
    db.locations["loc2"] = {"id": "loc2", "site_id": "site1", "building": "", "floor": "",
                            "room": "", "name": "P2", "memo": None}
    db.scans["scan1"]["location_id"] = "loc2"
    with pytest.raises(ValueError, match="다른 측정위치"):
        load_report_context(db, storage, "r1")

    db.scans["scan1"]["location_id"] = "loc1"
    db.reports["r1"]["status"] = "finalized"
    with pytest.raises(ValueError, match="발행된 보고서"):
        load_report_context(db, storage, "r1")

    db.reports["r1"]["status"] = "draft"
    db.report_analyses.clear()
    with pytest.raises(ValueError, match="포함된 분석이 없습니다"):
        load_report_context(db, storage, "r1")


def test_load_report_context_reports_missing_cells_file(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    (cfg.data_dir / "artifacts" / "an1" / "cells.json").unlink()
    with pytest.raises(ValueError, match="cells.json"):
        load_report_context(db, _storage(tmp_path), "r1")

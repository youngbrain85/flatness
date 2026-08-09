"""snapshot 계약(report-snapshot-v1) 단위 테스트.

계약 정본: docs/superpowers/plans/2026-07-29-p4-report.md "reports.snapshot 계약".
"""
import json
from datetime import datetime, timezone

import pytest

from flatworker.config import Config
from flatworker.report.context import load_report_context
from flatworker.report.snapshot import (DISCLAIMER, SNAPSHOT_SCHEMA, UNCERTAINTY_NOTE,
                                        build_sections, build_snapshot, coverage_label)
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


def _slope_stats():
    """judge_slope_cells 산출 slope_stats.json의 실제 키 구성(축소판).

    artifacts 값은 워커(flatworker/slope.py normalize_slope_stats)가 이미 버킷-상대
    전체 경로로 바꿔 DB에 넣은 형태다 - artifacts_dir와 다시 합치면 안 된다.
    """
    return {
        "format": "slope-stats-v1", "cell_m": 2.0, "subcell_m": 0.05,
        "threshold": {"design_pct": 1.5, "pass_pct": 0.5, "re_pct": 1.0,
                      "dir_pass_deg": 30.0},
        "summary": {
            "mean_dev_pct": 0.458, "std_dev_pct": 0.6455, "max_dev_pct": 1.7,
            "counts": {"적합": 1, "경계": 1, "보수": 1, "재시공": 2, "판정불가": 1},
            "coverage_pct": 83.3,
        },
        "direction_judged": True,
        "drain_points": [[3.2, 5.1]],
        "warnings": ["판정불가 셀 1개: 격자 가장자리 조각 셀"
                     "(폭 또는 높이가 부족해 baseline 짧음) 1건"],
        "artifacts": {"cells_json": "artifacts/an2/slope_cells.json",
                      "judged_json": "artifacts/an2/slope_judged.json",
                      "cells_csv": "artifacts/an2/slope_cells.csv",
                      "map_png": "artifacts/an2/slope_map.png"},
    }


def _slope_cells_file():
    """slope_cells.json(기하, 무손실) - engine/flatness/outputs/slope_cells.py 형태.

    등급 네 종류와 역구배를 모두 만들려면 셀이 섞여 있어야 한다: 적합만 있거나
    역구배가 없는 픽스처로는 함정 1(역구배 문구)·2(적합 제외)를 검증할 수 없다.
    """
    def cell(cx, cy, slope_pct, downhill_rad, ok=True):
        return {"cx": cx, "cy": cy, "center_x": 1.0 + 2 * cx, "center_y": 1.0 + 2 * cy,
                "n_subcells": 1600 if ok else 4, "slope_pct": slope_pct,
                "downhill_rad": downhill_rad, "rmse_m": 0.0012 if ok else None,
                "se_pct": 0.05 if ok else None, "width_m": 2.0 if ok else 0.4,
                "height_m": 2.0, "ok": ok, "zone_id": None}

    half_pi, pi = 1.5707963267948966, 3.141592653589793
    return {
        "schema_version": 2, "engine_version": "p1d-0.4.0",
        "cell_m": 2.0, "subcell_m": 0.05,
        "cells": [
            cell(0, 0, 1.52, 0.0),         # 적합
            cell(1, 0, 1.9, 0.0),          # 경계
            cell(2, 0, 1.35, half_pi),     # 보수(방향 편차 있음, 역구배는 아님)
            cell(0, 1, 1.52, pi),          # 재시공 - 역구배
            cell(1, 1, 3.2, 0.0),          # 재시공(크기)
            cell(2, 1, None, None, ok=False),   # 판정불가(조각 셀)
        ],
    }


def _slope_judged_file():
    """slope_judged.json(판정 결과) - engine/flatness/outputs/slope_judged.py 형태."""
    def row(cx, cy, grade, reason, dev_pct, dir_err_deg, correction_mm):
        return {"cx": cx, "cy": cy, "grade": grade, "reason": reason,
                "dev_pct": dev_pct, "dir_err_deg": dir_err_deg,
                "correction_mm": correction_mm}

    return {
        "schema_version": 1, "direction_judged": True,
        "cells": [
            row(0, 0, "적합", "크기·방향 모두 허용 안", 0.02, 3.0, 0.4),
            row(1, 0, "경계", "불확도 폭이 허용 경계를 걸쳐 단정 불가", 0.4, 4.0, 8.0),
            row(2, 0, "보수", "허용을 벗어났으나 국소 보정 가능", 0.15, 45.0, 3.0),
            # ★ correction_mm이 0.04라 크기 문구를 내면 "0.0mm"가 되어 "고칠 것
            # 없음"으로 읽힌다 - 함정 1이 실제로 재현되는 값이다.
            row(0, 1, "재시공", "역구배(물이 배수구 반대로 흐름)", 0.02, 172.0, 0.04),
            row(1, 1, "재시공", "설계 구배와의 편차가 재시공 기준을 넘음", 1.7, 5.0, 34.0),
            row(2, 1, "판정불가",
                "격자 가장자리 조각 셀(폭 또는 높이가 부족해 baseline 짧음)",
                None, None, None),
        ],
    }


def _seed_slope(db, cfg, *, sort_order=1):
    """같은 스캔·측정위치에 구배 분석(analyses.kind='slope')을 하나 더 붙인다.

    구배 분석은 평활도와 잡 타입·스캔을 공유하고 종류만 kind로 갈린다
    (worker/flatworker/jobs.py handle_analyze). artifacts에는 cells.json이 없고
    slope_cells.json·slope_judged.json·slope_map.png가 있다.
    """
    artifacts = cfg.data_dir / "artifacts" / "an2"
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / "slope_cells.json").write_text(
        json.dumps(_slope_cells_file(), ensure_ascii=False), encoding="utf-8")
    (artifacts / "slope_judged.json").write_text(
        json.dumps(_slope_judged_file(), ensure_ascii=False), encoding="utf-8")
    (artifacts / "slope_map.png").write_bytes(b"\x89PNG-slope")
    stats = _slope_stats()
    db.analyses["an2"] = {
        "id": "an2", "scan_id": "scan1", "kind": "slope", "surface": "floor",
        "criteria_id": "c-slope", "status": "done", "stats": stats,
        "coverage_pct": 83.3, "overall_verdict": "rework",
        "warnings": stats["warnings"], "artifacts_dir": "artifacts/an2",
        "engine_version": "p1d-0.4.0",
        "applied_criteria": {"name": "slope-parking-ramp",
                             "source": "KDS 47 10 70 (주차장 경사로)",
                             **stats["threshold"]},
        "auto_summary": None, "user_summary": None}
    db.report_analyses.append({"report_id": "r1", "analysis_id": "an2",
                               "sort_order": sort_order})


def _slope_entry(tmp_path, db=None, cfg=None):
    """평활도 + 구배가 함께 담긴 보고서 스냅샷의 구배 항목."""
    db = db or FakeDB()
    cfg = cfg or _cfg(tmp_path)
    _seed(db, cfg)
    _seed_slope(db, cfg)
    ctx = load_report_context(db, _storage(tmp_path), "r1")
    snap = build_snapshot(ctx, _EMPTY_ASSETS)
    return snap, snap["analyses"][1]


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


def test_snapshot_carries_lineage_warning_with_label(tmp_path):
    """계보 경고가 화면뿐 아니라 보고서(PDF)까지 간다 — 설계 정본 §5.1.1의
    "융합 메시면 ... 경고를 결과·**보고서**에 표기" 요구.

    보고서는 저장소의 stats.json이 아니라 `analyses.stats`(DB 저장본이 정본,
    `report/context.py:15`)를 읽으므로, 워커가 DB에 넣은 계보 경고가 그대로
    실린다. 라벨 사전(`report/labels.py`)에 코드가 빠지면 PDF에 한국어 문장
    대신 `fused_mesh_smoothed`라는 슬러그가 그대로 인쇄된다 - 그 회귀를 잡는다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    db.scans["scan1"]["lineage"] = "fused_mesh"
    db.analyses["an1"]["stats"]["warnings"] = ["reduced_span", "fused_mesh_smoothed"]

    ctx = load_report_context(db, _storage(tmp_path), "r1")
    a = build_snapshot(ctx, _EMPTY_ASSETS)["analyses"][0]

    assert a["scan"]["lineage_label"] == "융합 메시"
    text = {w["code"]: w["text"] for w in a["warnings"]}["fused_mesh_smoothed"]
    assert "융합 메시" in text and "양호한 결과" in text
    assert text != "fused_mesh_smoothed", "라벨 사전에 없어 슬러그가 그대로 인쇄된다"


# ---------------------------------------------------------------- 구배(단계 H)

def test_slope_analysis_carries_design_and_deviation_stats(tmp_path):
    """과업지시서 11·12쪽 산출 항목: 구배값(%)·설계기준 대비 편차·평균편차·
    표준편차·최대편차. 하나라도 빠지면 PDF가 과업지시서를 못 채운다."""
    _, a = _slope_entry(tmp_path)

    assert a["kind"] == "slope" and a["kind_label"] == "구배"
    s = a["slope"]
    assert s["design_pct"] == 1.5                       # 설계 구배
    assert s["dev_mean_pct"] == 0.46                    # 평균편차
    assert s["dev_sd_pct"] == 0.65                      # 표준편차
    assert s["dev_max_pct"] == 1.7                      # 최대편차
    # 셀별 구배값(%)과 설계 대비 편차도 함께 실린다
    assert [c["slope_pct"] for c in s["cells"]] == [1.35, 1.52, 3.2, None]
    assert [c["dev_pct"] for c in s["cells"]] == [0.15, 0.02, 1.7, None]
    # 방향 판정 맥락(배수구·허용 각도)이 없으면 편차 수치만으로는 읽을 수 없다
    assert s["drain_points"] == [{"x": 3.2, "y": 5.1}]
    assert s["direction_judged"] is True and s["dir_pass_deg"] == 30.0
    assert s["pass_pct"] == 0.5 and s["re_pct"] == 1.0
    # 적용 기준은 analyses.applied_criteria 컬럼에 있다(구배 stats에는 없다)
    assert a["criteria"]["name"] == "slope-parking-ramp"
    assert a["criteria"]["source"].startswith("KDS 47 10 70")
    # 엔진이 낸 한국어 경고 문장이 그대로 실린다(구배 경고는 슬러그가 아니다)
    assert a["warnings"][0]["text"].startswith("판정불가 셀 1개")


def test_slope_snapshot_lists_only_cells_needing_action(tmp_path):
    """적합 셀까지 표에 넣으면 2m 격자 수백 개가 PDF를 채운다.
    보수·재시공·역구배·판정불가만 싣는다(역구배는 등급이 재시공이다)."""
    _, a = _slope_entry(tmp_path)
    s = a["slope"]

    grades = [c["grade"] for c in s["cells"]]
    assert grades == ["보수", "재시공", "재시공", "판정불가"]   # (cy, cx) 오름차순
    assert "적합" not in grades and "경계" not in grades
    # 뺀 셀이 없던 일이 되면 안 된다 - 요약 집계에는 전부 남아 있다
    assert s["counts"] == {"적합": 1, "경계": 1, "보수": 1, "재시공": 2, "판정불가": 1}
    assert s["n_cells"] == 6 and len(s["cells"]) == 4


def test_reverse_slope_cell_gets_direction_text_not_size_text(tmp_path):
    """★ 역구배 셀에 크기 문구를 내면 '0.0mm 높임' 같은 '고칠 것 없음'이 나온다.
    dashboard/lib/domain/slope-direction.ts:62가 정본이다."""
    _, a = _slope_entry(tmp_path)
    cells = {(c["cx"], c["cy"]): c for c in a["slope"]["cells"]}

    reverse = cells[(0, 1)]
    assert reverse["reverse"] is True
    assert reverse["correction_text"] == "역구배 - 방향 전면 재시공 필요(크기 보정으로 해결 안 됨)"
    # 크기 문구를 냈다면 이 셀은 correction_mm=0.04라 "서쪽 끝을 0.0mm 높임"이 된다
    assert "mm" not in reverse["correction_text"]
    assert "높임" not in reverse["correction_text"] and "낮춤" not in reverse["correction_text"]

    # 역구배가 아닌 셀은 여전히 크기 문구를 낸다 - 보정란을 통째로 비워
    # 통과하는 변이를 막는다
    assert cells[(2, 0)]["correction_text"] == "북쪽 끝을 3.0mm 낮춤"
    assert cells[(1, 1)]["correction_text"] == "동쪽 끝을 34.0mm 높임"
    assert cells[(2, 1)]["correction_text"] == "-"      # 판정불가는 낼 문구가 없다

    # 방향 편차는 있는데 역구배는 아닌 셀(dir_err > dir_pass, 90도 이하)도
    # 크기 문구만 내면 결함이 안 드러난다(화면 결과표의 코드리뷰 I2와 같은 이유)
    assert cells[(2, 0)]["direction_text"] == "45.0도(허용 30도 초과)"
    assert cells[(1, 1)]["direction_text"] == "-"
    assert reverse["direction_text"] == "-"             # 역구배는 전용 문구로 이미 드러난다


def test_flatness_snapshot_is_unchanged_by_slope_support(tmp_path):
    """★ 회귀 방지. 발행본은 스냅샷으로 박제되므로(설계 결정 D8) 평활도 항목이
    한 필드라도 달라지면 이미 발행된 보고서와 새 보고서가 다른 정보를 담는다.

    기대값을 이 파일에 동결한다 - "구배를 넣기 전/후를 비교"하는 식으로 쓰면
    양쪽이 함께 바뀌어 회귀를 못 잡는다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _seed_slope(db, cfg)          # 구배를 함께 넣어도 평활도 항목은 그대로여야 한다
    ctx = load_report_context(db, _storage(tmp_path), "r1")
    snap = build_snapshot(ctx, _EMPTY_ASSETS,
                          generated_at=datetime(2026, 8, 9, 3, 4, 5, tzinfo=timezone.utc))

    assert snap["analyses"][0] == {
        "analysis_id": "an1",
        "sort_order": 0,
        "surface": "floor",
        "surface_label": "바닥",
        "engine_version": "p1d-0.4.0",
        "is_external": False,
        "scan": {
            "id": "scan1", "scanned_at": "2026-07-20", "device": "iPhone 15 Pro",
            "operator_name": "홍길동", "original_filename": "room.ply",
            "file_format": "ply", "point_count": 120000, "unit_scale": 1.0,
            "lineage": "raw", "lineage_label": "원시 점군",
        },
        "criteria": {"name": "floor-kcs-exposed",
                     "source": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)",
                     "span_m": 3, "pass_mm": 7, "rework_mm": 21, "u_mm": 5.0},
        "overview": {"file": "raw.ply", "n_points": 120000, "scale_to_m": 1.0,
                     "subcell_m": 0.05, "cell_m": 1.0, "coverage_pct": 91.5,
                     "coverage_label": "바닥 인식률", "reduced_span_cells": 1},
        "summary": {
            "n_cells": 4, "n_valid": 3,
            "grade_counts": {"pass": 2, "borderline": 1, "repair": 0,
                             "rework": 0, "na": 1},
            "grade_pct": {"pass": 50.0, "borderline": 25.0, "repair": 0.0,
                          "rework": 0.0, "na": 25.0},
            "value_max_mm": 8.2, "value_min_mm": 1.1, "value_mean_mm": 4.2,
            "value_p95_mm": 8.0,
            "worst": {"value_mm": 8.2, "cell_ix": 1, "cell_iy": 0,
                      "point_x": 1.25, "point_y": 0.5, "zone_id": 1},
            "overall_verdict": "borderline", "overall_verdict_label": "경계",
        },
        "sections": [{
            "section_id": 1, "kind": "zone", "label": "구역 1", "status_label": "정상",
            "level_m": 0.02, "area_m2": 12.5, "length_m": None, "height_m": None,
            "plumbness_mm": None, "plumb_grade": None, "plumb_grade_label": None,
            "n_cells": 4, "n_valid": 3, "max_mm": 8.2, "min_mm": 1.1, "mean_mm": 4.2,
            "over_cells": 0, "over_pct": 0.0,
        }],
        "warnings": [{"code": "reduced_span",
                      "text": "공간 제약으로 기준 스팬보다 짧은 직선자 길이를 사용해 "
                              "허용치와 불확도를 선형 환산했습니다."}],
        "assets": {"heatmaps": [], "deviation": [], "preview3d": [], "histogram": None},
        "auto_summary": "바닥면 평활도 분석 결과...",
        "user_summary": None,
    }
    # ★ 평활도 항목에는 kind 키가 없다. 이미 발행된 스냅샷에도 영원히 없으므로
    # 템플릿은 반드시 `kind == 'slope'`(긍정형)로 분기해야 한다.
    assert "kind" not in snap["analyses"][0]
    assert "slope" not in snap["analyses"][0]

    # 스냅샷 몸통(라벨·색·고지 문구)도 함께 동결한다
    assert snap["schema"] == "report-snapshot-v1"
    assert snap["generated_at"] == "2026-08-09T03:04:05Z"
    assert snap["report"] == {"id": "r1", "title": "3층 거실 평활도 보고서",
                              "created_at": "2026-07-29T00:00:00+00:00"}
    assert snap["site"] == {"id": "site1", "name": "테스트 현장",
                            "address": "서울시", "memo": None}
    assert snap["location"] == {"id": "loc1", "building": "101동", "floor": "3층",
                                "room": "거실", "name": "P1", "memo": None}
    assert snap["palette"] == {
        "grade_order": ["pass", "borderline", "repair", "rework", "na"],
        "grade_labels": {"pass": "적합", "borderline": "경계", "repair": "보수",
                         "rework": "재시공", "na": "판정 불가"},
        "grade_colors": {"pass": "#2e7d32", "borderline": "#f9ab00",
                         "repair": "#e8710a", "rework": "#c5221f", "na": "#9e9e9e"},
    }
    assert snap["disclaimer"] == DISCLAIMER
    assert snap["uncertainty_note"] == UNCERTAINTY_NOTE
    assert snap["photos"] == [] and snap["notes"] == []
    # 종합의견에서 평활도와 구배가 문구로 구별된다(둘 다 같은 바닥 스캔이다)
    assert snap["opinion"] == {"text": "[바닥] 바닥면 평활도 분석 결과...",
                               "source": "auto"}


def test_load_report_context_rejects_slope_analysis_being_rejudged(tmp_path):
    """재판정 중인 구배 분석을 보고서에 넣으면 DB의 옛 통계와 저장소의 새 판정·
    새 slope_map.png가 한 스냅샷에 섞여 박제된다 - handle_slope_judge가
    upload_dir 뒤에 update_analysis를 하므로 실제로 존재하는 창이다.

    재판정은 analyses.status를 건드리지 않으므로(설계 결정 D5) 기존
    '완료되지 않은 분석' 가드로는 이 상태를 잡지 못한다.
    """
    for state in ("queued", "processing"):
        root = tmp_path / state
        db, cfg = FakeDB(), _cfg(root)
        _seed(db, cfg)
        _seed_slope(db, cfg)
        db.analyses["an2"]["params"] = {"drain_points": [{"x": 3.2, "y": 5.1}],
                                        "judge": {"state": state, "at": "2026-08-09T00:00:00Z"}}
        with pytest.raises(ValueError, match="재판정이 진행 중"):
            load_report_context(db, _storage(root), "r1")

    # 끝난 재판정(done)은 막지 않는다 - 저장소와 DB가 이미 같은 판정을 가리킨다
    root = tmp_path / "done"
    db, cfg = FakeDB(), _cfg(root)
    _seed(db, cfg)
    _seed_slope(db, cfg)
    db.analyses["an2"]["params"] = {"drain_points": [{"x": 3.2, "y": 5.1}],
                                    "judge": {"state": "done", "at": "2026-08-09T00:00:00Z"}}
    ctx = load_report_context(db, _storage(root), "r1")
    assert [str(b.analysis["id"]) for b in ctx.bundles] == ["an1", "an2"]


def test_slope_opinion_is_labelled_apart_from_flatness(tmp_path):
    """같은 바닥 스캔의 평활도와 구배가 종합의견에서 '[바닥]'으로 겹치면
    어느 분석의 의견인지 알 수 없다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _seed_slope(db, cfg)
    db.analyses["an2"]["user_summary"] = "램프 하단 역구배 확인 필요"
    ctx = load_report_context(db, _storage(tmp_path), "r1")

    text = build_snapshot(ctx, _EMPTY_ASSETS)["opinion"]["text"]

    assert "[바닥] 바닥면 평활도 분석 결과..." in text
    assert "[바닥 구배] 램프 하단 역구배 확인 필요" in text

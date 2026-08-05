"""데이터 계보 경고(scans.lineage='fused_mesh') — 업로드 화면의 약속과 실제 결과의 정합.

`dashboard/components/upload-form.tsx`는 계보로 '융합 메시'를 고른 사용자에게
**"결과에 경고가 표시됩니다"** 라고 안내하고, 설계 정본 §5.1.1도 "융합 메시면 ...
경고를 결과·보고서에 표기"를 요구한다. 그런데 엔진은 계보를 아예 모르고
(`grep -rn lineage engine/` 0건) 워커도 보고서 라벨(`report/snapshot.py`)로만 읽었다 —
**약속한 경고를 만드는 코드가 어디에도 없었다.** 화면이 사실이 아닌 것을 주장하는
실패 양식이며, 이 저장소가 가장 경계하는 것이다(`handle_slope_judge`의 "조용한 실패"
주석과 같은 계열).

여기서 그 약속을 계약으로 고정한다. 계보는 DB(scans) 개념이고 엔진은 DB를 모르므로
주입 지점은 워커다 — 대신 **분석 결과를 만드는 네 경로 전부**를 덮어야 한다. 하나라도
빠지면 "그 화면에서만 경고가 사라지는" 같은 거짓이 재발한다(재판정 경로는
`test_slope_judge.py`가 맡는다 — 그쪽 시더를 공유해야 해서).
"""
import numpy as np
import pytest

from tests.synthetic_helpers import synthetic
flat_floor, add_bump, write_binary_ply = (synthetic.flat_floor, synthetic.add_bump,
                                          synthetic.write_binary_ply)
from flatworker.artifacts import raw_scan_dir
from flatworker.config import Config
from flatworker.jobs import handle_analyze, handle_import
from flatworker.lineage import (FUSED_MESH_WARNING, fields_with_lineage_warning,
                                with_lineage_warning)
from tests.fake_db import FakeDB

# 코드 상수를 import해 쓰지 않고 문자열을 그대로 적는다 - 상수 이름만 바꾸고
# 값을 바꿔 버리는 변경(라벨 사전·기존 DB 행과 어긋남)을 이 테스트가 잡아야 한다.
FUSED = "fused_mesh_smoothed"


def test_warning_code_constant_matches_contract():
    """모듈 상수와 계약 문서·라벨 사전이 쓰는 문자열이 같아야 한다."""
    assert FUSED_MESH_WARNING == FUSED


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _seed_floor_scan(db, cfg, lineage, *, pass_mm=7):
    """test_jobs.py의 `_seed_floor_scan`과 같은 형상 + 계보만 인자로 뺀 시더.

    `lineage`에 `...`(Ellipsis)를 주면 scans 행에 lineage 키 자체를 넣지 않는다 —
    컬럼이 없는 과거 행/부분 select를 흉내낸다.
    """
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_binary_ply(pts, sd / "raw.ply")
    scan = {"id": "scan1", "site_id": "site1", "surface": "floor",
            "raw_file_path": "raw-scans/site1/scan1/raw.ply", "unit_scale": 1.0,
            "status": "ready", "selected_criteria_id": "c1"}
    if lineage is not ...:
        scan["lineage"] = lineage
    db.scans["scan1"] = scan
    db.criteria["c1"] = {"id": "c1", "surface": "floor", "name": "floor-kcs-exposed",
                         "source_text": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)",
                         "thresholds": [{"span_m": 3, "metric": "flatness",
                                         "pass_mm": pass_mm, "rework_mm": 21}]}
    db.app_settings["uncertainty_mm"] = {"floor": 5.0, "wall": 8.0}
    db.analyses["a1"] = {"id": "a1", "scan_id": "scan1", "surface": "floor",
                         "criteria_id": "c1", "status": "queued"}
    return "a1"


def test_fused_mesh_flatness_analysis_carries_warning(tmp_path):
    """업로드 화면의 약속 그 자체: 융합 메시 스캔의 평활도 결과에 경고가 있다.

    화면(verdict-panel.tsx)은 `stats.warnings`를, 목록·필터는 `analyses.warnings`
    컬럼을 읽는다 — 한쪽만 채우면 절반의 화면에서만 사실이 된다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_floor_scan(db, cfg, "fused_mesh")

    handle_analyze(db, cfg, {"analysis_id": aid})

    a = db.analyses[aid]
    assert FUSED in a["stats"]["warnings"], "화면(stats.warnings)에 경고가 없다"
    assert FUSED in a["warnings"], "analyses.warnings 컬럼에 경고가 없다"


@pytest.mark.parametrize("lineage", ["raw", "unknown", None, ...])
def test_non_fused_mesh_lineage_gets_no_warning(tmp_path, lineage):
    """계보가 융합 메시가 아니면 붙지 않는다 — "전부에 붙이면 통과"하는 변이를 막는다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_floor_scan(db, cfg, lineage)

    handle_analyze(db, cfg, {"analysis_id": aid})

    a = db.analyses[aid]
    assert FUSED not in a["stats"]["warnings"]
    assert FUSED not in a["warnings"]


def test_fused_mesh_warning_adds_to_engine_warnings_instead_of_replacing(tmp_path):
    """엔진이 낸 경고를 덮어쓰지 않는다.

    pass_mm=3 + U=5mm면 b1(=pe-U_eff) <= 0이라 엔진이
    `uncertainty_swallows_pass`를 낸다(criteria.py:47-48). 계보 경고를 넣느라
    이 경고가 사라지면 "적합이 원리적으로 불가능한 기준"이라는 더 중요한 사실이
    화면에서 지워진다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    aid = _seed_floor_scan(db, cfg, "fused_mesh", pass_mm=3)

    handle_analyze(db, cfg, {"analysis_id": aid})

    warns = db.analyses[aid]["stats"]["warnings"]
    assert "uncertainty_swallows_pass" in warns, "엔진 경고가 사라졌다"
    assert FUSED in warns


def _depression_deviation_mm(pts):
    r = np.hypot(pts[:, 0] - 2.0, pts[:, 1] - 2.0)
    return np.where(r < 0.3, -10.0 * 0.5 * (1.0 + np.cos(np.pi * r / 0.3)), 0.0)


def _write_import_csv(path, pts, deviation_mm):
    """test_jobs.py의 동명 헬퍼와 같은 Colab CSV 헤더(엔진이 요구하는 컬럼 그대로)."""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("X,Y,Z,Distance_mm,Signed_Distance_mm,R,G,B,Is_Uneven\n")
        for (x, y, z), s in zip(pts, deviation_mm):
            f.write(f"{x},{y},{z},{abs(s)},{s},0,128,0,False\n")


def test_fused_mesh_import_analysis_carries_warning(tmp_path):
    """임포트 경로도 덮는다.

    업로드 화면은 지금 import 모드에서 계보를 'unknown'으로 고정하지만
    (upload-form.tsx:91), scans.lineage는 다른 경로(수동 수정·향후 UI 변경)로도
    'fused_mesh'가 될 수 있다. 그때 임포트 결과만 조용히 경고 없이 나오면 안 된다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    _write_import_csv(sd / "raw.csv", pts, _depression_deviation_mm(pts))
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "floor",
                         "raw_file_path": "raw-scans/site1/scan1/raw.csv",
                         "unit_scale": 1.0, "lineage": "fused_mesh",
                         "status": "ready", "selected_criteria_id": "c1"}
    db.criteria["c1"] = {"id": "c1", "surface": "floor", "name": "floor-kcs-exposed",
                         "source_text": "KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)",
                         "thresholds": [{"span_m": 3, "metric": "flatness",
                                         "pass_mm": 7, "rework_mm": 21}]}
    db.app_settings["uncertainty_mm"] = {"floor": 5.0, "wall": 8.0}
    db.analyses["a1"] = {"id": "a1", "scan_id": "scan1", "surface": "floor",
                         "criteria_id": "c1", "status": "queued"}

    handle_import(db, cfg, {"analysis_id": "a1"})

    a = db.analyses["a1"]
    assert FUSED in a["stats"]["warnings"]
    assert FUSED in a["warnings"]


def _slope_stats():
    """엔진 구배 stats의 최소 형태(test_slope_job.py `_stats`와 같은 스키마).

    구배 엔진 호출을 몽키패치로 가로챈다 — 검증 대상은 "워커가 계보 경고를
    구배 경로에도 붙이는가"이지 엔진의 판정값이 아니다(기존
    test_handle_analyze_routes_slope_kind_to_slope_pipeline과 같은 접근).
    구배 warnings는 슬러그가 아니라 **한국어 완성 문장** 리스트라
    (slope.py:196-197) 순서·형식을 깨뜨리지 않는지도 함께 본다.
    """
    return {"format": "slope-stats-v1", "cell_m": 2.0, "subcell_m": 0.05,
            "threshold": {"design_pct": 2.0, "pass_pct": 1.0, "re_pct": 3.0,
                          "dir_pass_deg": 30},
            "summary": {"mean_dev_pct": 0.1, "std_dev_pct": 0.05, "max_dev_pct": 0.3,
                        "counts": {"적합": 4, "경계": 0, "보수": 0, "재시공": 0,
                                   "판정불가": 0},
                        "coverage_pct": 100.0},
            "direction_judged": True, "drain_points": [[1.0, 2.0]],
            "warnings": ["배수구 위치를 지정하지 않아 방향(역구배)을 판정하지 않았습니다."],
            "artifacts": {"cells_csv": "/tmp/x/slope_cells.csv",
                          "map_png": "/tmp/x/slope_map.png"}}


def test_fused_mesh_slope_analysis_carries_warning(tmp_path, monkeypatch):
    """구배 경로도 덮는다 — 계보는 스캔의 성질이지 분석 종류의 성질이 아니다.

    구배 결과는 `_finalize`를 거치지 않고 `slope.run_slope_analysis`가 만든 필드
    dict를 그대로 저장한다(slope.py:191-206) — 평활도만 고치면 여기서 샌다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_binary_ply(pts, sd / "raw.ply")
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "floor",
                         "raw_file_path": "raw-scans/site1/scan1/raw.ply",
                         "unit_scale": 1.0, "lineage": "fused_mesh", "status": "ready"}
    db.criteria["c-slope"] = {"id": "c-slope", "surface": "floor", "kind": "slope",
                              "name": "test-slope-lineage-only",
                              "source_text": "테스트 전용 구배 기준(007 시드 아님) - 계보 경고 검증용",
                              "thresholds": [{"use": "계보 테스트", "design_pct": 2.0,
                                              "pass_pct": 1.0, "re_pct": 3.0,
                                              "dir_pass_deg": 30}]}
    aid = db.insert_analysis({"scan_id": "scan1", "kind": "slope",
                              "criteria_id": "c-slope", "status": "queued", "params": {}})
    monkeypatch.setattr("flatworker.slope.analyze_slope",
                        lambda *a, **k: _slope_stats())

    handle_analyze(db, cfg, {"analysis_id": aid})

    a = db.analyses[aid]
    assert FUSED in a["stats"]["warnings"]
    assert FUSED in a["warnings"]
    # 엔진이 낸 한국어 문장은 그대로 남아 있어야 한다(정렬로 뒤섞지 않는다).
    assert a["warnings"][0].startswith("배수구 위치를")


# -- 주입 헬퍼 자체의 불변식 (flatworker/lineage.py) --------------------------

def test_lineage_warning_does_not_mutate_engine_stats():
    """엔진이 돌려준 dict를 건드리지 않는다(`normalize_slope_stats`와 같은 관례).

    같은 stats 객체를 산출물 직렬화·로깅 등에서 다시 쓰는 호출자가 생겼을 때,
    워커가 몰래 끼워 넣은 경고가 "엔진이 낸 것"으로 둔갑하는 것을 막는다.
    """
    engine_stats = {"warnings": ["low_coverage"], "n_valid": 3}

    out = with_lineage_warning(engine_stats, {"lineage": "fused_mesh"})

    assert engine_stats["warnings"] == ["low_coverage"], "원본이 변형됐다"
    assert out["warnings"] == ["low_coverage", FUSED]
    assert out is not engine_stats


def test_lineage_warning_is_not_duplicated_when_applied_twice():
    """두 번 적용해도 한 번만 실린다 - 화면에 같은 경고가 두 줄로 뜨지 않는다."""
    once = with_lineage_warning({"warnings": []}, {"lineage": "fused_mesh"})
    twice = with_lineage_warning(once, {"lineage": "fused_mesh"})

    assert twice["warnings"].count(FUSED) == 1


def test_lineage_warning_appends_instead_of_sorting():
    """정렬하지 않는다 - 구배 warnings는 슬러그가 아니라 발생 순서가 의미를 갖는
    한국어 완성 문장 리스트다(slope.py:196-197). 여기서 정렬하면 읽는 순서가 뒤집힌다.
    """
    korean = ["판정불가 셀 3개: 점 부족", "배수구 위치를 지정하지 않아 ..."]

    out = with_lineage_warning({"warnings": list(korean)}, {"lineage": "fused_mesh"})

    assert out["warnings"] == korean + [FUSED]


def test_fields_helper_keeps_stats_and_column_in_sync():
    """구배 경로용 헬퍼는 stats.warnings와 warnings 컬럼을 함께 채운다 -
    한쪽만 채우면 결과 화면과 목록이 서로 다른 사실을 말한다."""
    fields = {"warnings": ["기존 경고"], "stats": {"warnings": ["기존 경고"]},
              "coverage_pct": 100.0}

    out = fields_with_lineage_warning(fields, {"lineage": "fused_mesh"})

    assert out["warnings"] == ["기존 경고", FUSED]
    assert out["stats"]["warnings"] == ["기존 경고", FUSED]
    assert out["coverage_pct"] == 100.0
    assert fields["warnings"] == ["기존 경고"], "원본이 변형됐다"


def test_fields_helper_tolerates_missing_stats_key():
    """stats 키가 없거나 dict가 아니어도 경고 컬럼은 채운다(방어)."""
    out = fields_with_lineage_warning({"warnings": []}, {"lineage": "fused_mesh"})
    assert out["warnings"] == [FUSED] and "stats" not in out

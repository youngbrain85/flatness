"""구배 잡 처리 — 판정 매핑·stats 정규화·drain_points 변환."""
from types import SimpleNamespace

import pytest

from flatworker.artifacts import raw_scan_dir
from flatworker.config import Config
from flatworker.jobs import handle_analyze
from flatworker.slope import (normalize_slope_stats, slope_drain_points,
                             slope_overall_verdict)
from tests.fake_db import FakeDB
from tests.synthetic_helpers import synthetic

flat_floor, write_binary_ply = synthetic.flat_floor, synthetic.write_binary_ply


def _stats(counts, coverage=100.0):
    return {"format": "slope-stats-v1", "cell_m": 2.0, "subcell_m": 0.05,
            "threshold": {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5,
                          "dir_pass_deg": 30},
            "summary": {"mean_dev_pct": 0.1, "std_dev_pct": 0.05,
                        "max_dev_pct": 0.3, "counts": counts,
                        "coverage_pct": coverage},
            "direction_judged": True, "drain_points": [[1.0, 2.0]],
            "warnings": [], "artifacts": {"cells_csv": "/tmp/x/slope_cells.csv",
                                          "map_png": "/tmp/x/slope_map.png"}}


def _counts(**kw):
    base = {"적합": 0, "경계": 0, "보수": 0, "재시공": 0, "판정불가": 0}
    base.update(kw)
    return base


def test_verdict_takes_worst_grade():
    # 평활도 overall_verdict와 같은 우선순위: 재시공 > 보수 > 경계 > 적합
    assert slope_overall_verdict(_stats(_counts(적합=10, 재시공=1))) == "rework"
    assert slope_overall_verdict(_stats(_counts(적합=10, 보수=1))) == "repair"
    assert slope_overall_verdict(_stats(_counts(적합=10, 경계=1))) == "borderline"
    assert slope_overall_verdict(_stats(_counts(적합=10))) == "pass"


def test_verdict_is_none_when_nothing_decidable():
    # 판정불가만 있으면 판정을 만들어내지 않는다. analyses.overall_verdict enum에는
    # 판정불가에 해당하는 값이 없으므로 NULL로 두는 것이 유일하게 정직하다.
    assert slope_overall_verdict(_stats(_counts(판정불가=25), coverage=0.0)) is None


def test_verdict_ignores_na_when_others_exist():
    assert slope_overall_verdict(_stats(_counts(적합=5, 판정불가=20))) == "pass"


def test_normalize_replaces_absolute_artifact_paths():
    # 엔진은 스테이징 절대경로를 넣는데 그 디렉터리는 잡이 끝나면 지워진다.
    # DB에는 스펙 §6.3 규약의 버킷-상대 문자열만 저장해야 한다.
    s = normalize_slope_stats(_stats(_counts(적합=4)), "abc-123")
    assert s["artifacts"] == {"cells_csv": "artifacts/abc-123/slope_cells.csv",
                              "map_png": "artifacts/abc-123/slope_map.png"}


def test_normalize_does_not_mutate_input():
    original = _stats(_counts(적합=4))
    normalize_slope_stats(original, "abc-123")
    assert original["artifacts"]["cells_csv"] == "/tmp/x/slope_cells.csv"


def test_drain_points_converts_params_shape():
    # 스펙 §3.5는 params에 {"x":..,"y":..}를 넣는데 엔진은 (x, y) 언패킹을 한다.
    assert slope_drain_points({"drain_points": [{"x": 3.2, "y": 5.1}]}) == [(3.2, 5.1)]


def test_drain_points_absent_is_none():
    assert slope_drain_points({}) is None
    assert slope_drain_points(None) is None
    assert slope_drain_points({"drain_points": []}) is None


@pytest.fixture
def fake_db_with_two_kinds():
    """FakeDB에 같은 스캔의 평활도 현재 분석을 미리 세워 둔다.

    구배 분석을 현재로 세우는 동작이 이 평활도 현재 분석을 밀어내지 않아야
    한다는 것이 아래 테스트의 핵심 단언이다.
    """
    db = FakeDB()
    db.current_analysis[("scan-1", "flatness")] = "flat-analysis"
    return db


def test_slope_finalize_does_not_unset_flatness_current(fake_db_with_two_kinds):
    """구배 분석을 현재로 세워도 같은 스캔의 평활도 현재 분석이 유지돼야 한다.

    007이 analyses_current를 (scan_id, kind)로 넓혀도 워커의 PATCH가 kind를
    빠뜨리면 같은 증상이 그대로 재현된다. DB는 이제 두 행을 허용하는데 워커가
    스스로 하나를 내려버리므로 오류도 안 난다 - 조용한 회귀다.
    """
    db = fake_db_with_two_kinds
    db.set_current_analysis("scan-1", "slope-analysis", kind="slope")
    assert db.current_analysis[("scan-1", "flatness")] == "flat-analysis"
    assert db.current_analysis[("scan-1", "slope")] == "slope-analysis"


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


@pytest.fixture
def slope_job_env(tmp_path):
    """구배 analyze 잡 시드 - 실내 평바닥 스캔 + 구배 기준 + drain_points 파라미터.

    criteria_id는 버튼 클릭 시점에 fn_resolve_criteria(site_id, 'floor', 'slope')로
    이미 해석돼 analyses.criteria_id에 들어 있다고 가정한다(설계 결정 표) - 여기서도
    해석된 결과인 criteria_id만 analyses 행에 직접 심는다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_binary_ply(pts, sd / "raw.ply")
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "floor",
                         "raw_file_path": "raw-scans/site1/scan1/raw.ply",
                         "unit_scale": 1.0, "status": "ready"}
    db.criteria["c-slope"] = {"id": "c-slope", "surface": "floor", "kind": "slope",
                              "name": "slope-indoor-level",
                              "source_text": "설계 구배 0%(의도적 구배 없음)",
                              "thresholds": [{"use": "실내 평바닥", "design_pct": 2.0,
                                              "pass_pct": 1.0, "re_pct": 3.0,
                                              "dir_pass_deg": 30}]}
    aid = db.insert_analysis({"scan_id": "scan1", "kind": "slope",
                              "criteria_id": "c-slope", "status": "queued",
                              "params": {"drain_points": [{"x": 3.2, "y": 5.1}]}})
    return SimpleNamespace(db=db, cfg=cfg, slope_analysis_id=aid)


def test_handle_analyze_routes_slope_kind_to_slope_pipeline(monkeypatch, slope_job_env):
    """analyses.kind='slope'면 analyze_floor가 아니라 analyze_slope로 간다."""
    called = {}

    def fake_analyze_slope(path, scale_to_m, threshold, out_dir, **kw):
        called["threshold"] = threshold
        called["drain_points"] = kw.get("drain_points")
        return _stats(_counts(적합=4))

    monkeypatch.setattr("flatworker.slope.analyze_slope", fake_analyze_slope)
    monkeypatch.setattr("flatworker.jobs.analyze_floor",
                        lambda *a, **k: pytest.fail("평활도 경로로 새면 안 된다"))
    handle_analyze(slope_job_env.db, slope_job_env.cfg,
                   {"analysis_id": slope_job_env.slope_analysis_id})
    # 구배 기준 행의 thresholds[0]이 dict 그대로 엔진에 가야 한다.
    # _to_criterion으로 감싸면 KeyError: 'metric'으로 죽는다.
    assert called["threshold"]["design_pct"] == 2.0
    assert called["drain_points"] == [(3.2, 5.1)]


def test_handle_analyze_slope_saves_mapped_verdict_and_relative_paths(slope_job_env):
    handle_analyze(slope_job_env.db, slope_job_env.cfg,
                   {"analysis_id": slope_job_env.slope_analysis_id})
    row = slope_job_env.db.analyses[slope_job_env.slope_analysis_id]
    assert row["overall_verdict"] in {"pass", "borderline", "repair", "rework", None}
    assert row["coverage_pct"] == 100.0
    assert not str(row["stats"]["artifacts"]["cells_csv"]).startswith("/")

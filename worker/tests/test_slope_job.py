"""구배 잡 처리 — 판정 매핑·stats 정규화·drain_points 변환."""
from types import SimpleNamespace

import pytest

from flatness import ENGINE_VERSION

from flatworker.artifacts import raw_scan_dir
from flatworker.config import Config
from flatworker.jobs import handle_analyze
from flatworker.slope import (normalize_slope_stats, slope_context, slope_drain_points,
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


def test_slope_context_rejects_non_slope_criteria():
    """M4: criteria_row.kind가 'slope'가 아니면 명시적으로 거부한다.

    이 검사가 없으면 평활도 기준 행이 잘못 연결됐을 때 엔진 안쪽 깊은 곳
    (grade_slope_cells)에서 KeyError: 'design_pct'로 죽어 원인 파악이 어렵다.
    """
    db = FakeDB()
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "floor",
                         "raw_file_path": "raw-scans/site1/scan1/raw.ply", "unit_scale": 1.0}
    db.criteria["c1"] = {"id": "c1", "surface": "floor", "kind": "flatness",
                         "name": "floor-kcs-exposed", "source_text": "x",
                         "thresholds": [{"span_m": 3, "metric": "flatness",
                                         "pass_mm": 7, "rework_mm": 21}]}
    db.analyses["a1"] = {"id": "a1", "scan_id": "scan1", "kind": "slope",
                         "criteria_id": "c1", "status": "queued"}
    with pytest.raises(ValueError, match="연결되어"):
        slope_context(db, "a1")


@pytest.fixture
def fake_db_with_two_kinds():
    """FakeDB에 같은 스캔의 평활도·구배 분석 행과 평활도 현재 분석을 미리 세운다.

    분석 행 자체를 심어 두는 이유: FakeDB.set_current_analysis는 실제 PostgREST
    PATCH와 같은 시맨틱으로 대상 행의 kind가 인자와 다르면(또는 deleted_at이
    있으면) 조용히 no-op한다 - 대상 행이 아예 없으면 항상 no-op이라 이 테스트의
    취지(kind 격리) 자체가 성립하지 않는다.
    """
    db = FakeDB()
    db.analyses["flat-analysis"] = {"id": "flat-analysis", "scan_id": "scan-1",
                                    "kind": "flatness"}
    db.analyses["slope-analysis"] = {"id": "slope-analysis", "scan_id": "scan-1",
                                     "kind": "slope"}
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
    """구배 analyze 잡 라우팅 검증 전용 시드 - 엔진 호출을 몽키패치로 가로채므로
    (test_handle_analyze_routes_slope_kind_to_slope_pipeline) 기준 수치가 실제
    판정 결과에 영향을 주지 않는다. 그래도 코드리뷰(I4) 지적대로 실제 007 시드
    기준 이름·출처 문구는 쓰지 않는다 - 임의 수치(design_pct=2.0)를 실제
    'slope-indoor-level'(design_pct=0.0) 이름으로 포장하면 그 자체로 오해를
    부른다. 결정론적 판정값 검증은 slope_env_real_criteria(007 시드값 그대로)가
    맡는다.

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
                              "name": "test-slope-routing-only",
                              "source_text": "테스트 전용 구배 기준(007 시드 아님) - 라우팅 검증용",
                              "thresholds": [{"use": "라우팅 테스트", "design_pct": 2.0,
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


@pytest.fixture
def slope_env_real_criteria(tmp_path):
    """실제 007 시드 기준(slope-indoor-level) 값을 그대로 써서 실제 엔진 결과를
    결정론적으로 만든다(코드리뷰 I4).

    - `supabase/migrations/007_slope_analysis.sql`의 'slope-indoor-level' 행을
      name/source_text/thresholds 전부 그대로 옮겼다(design_pct=0.0,
      dir_pass_deg=180 등). 임의 수치를 실제 기준 이름에 붙이면 그 자체가
      회귀다 - 그 실수를 이 태스크의 리뷰가 잡아냈다.
    - 완전 평탄(무노이즈) 바닥(flat_floor, tilt 없음)을 써서 실측 구배가
      0%에 극히 가깝게 나오도록 한다 - design_pct=0.0과 정확히 맞아떨어져
      전 셀이 결정론적으로 '적합'이 된다(engine/tests/test_slope.py의
      test_flat_floor_has_near_zero_slope와 동일 전제).
    - drain_points를 넣지 않는다 - 007 시드의 source_text가 명시적으로
      "방향 판정 대상이 아니므로 배수구를 지정하지 말 것"이라고 적어 뒀고,
      완전 평탄한 바닥에서는 내리막 방향 자체가 수치 노이즈에 좌우돼
      방향 판정을 결정론적으로 만들 수 없다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_binary_ply(pts, sd / "raw.ply")
    db.scans["scan1"] = {"id": "scan1", "site_id": "site1", "surface": "floor",
                         "raw_file_path": "raw-scans/site1/scan1/raw.ply",
                         "unit_scale": 1.0, "status": "ready"}
    source_text = ("설계 구배 0%(의도적 구배 없음). 허용폭은 기준 문서 근거가 없는 "
                   "용역 설정값. 방향 판정 대상이 아니므로 배수구를 지정하지 말 것")
    db.criteria["c-slope-indoor"] = {
        "id": "c-slope-indoor", "surface": "floor", "kind": "slope",
        "name": "slope-indoor-level", "source_text": source_text,
        "thresholds": [{"use": "실내 평바닥", "design_pct": 0.0, "pass_pct": 1.0,
                        "re_pct": 3.0, "dir_pass_deg": 180}],
    }
    aid = db.insert_analysis({"scan_id": "scan1", "kind": "slope",
                              "criteria_id": "c-slope-indoor", "status": "queued",
                              "params": {}})
    return SimpleNamespace(db=db, cfg=cfg, slope_analysis_id=aid)


def test_handle_analyze_slope_saves_mapped_verdict_and_relative_paths(slope_env_real_criteria):
    """I3: 파생 컬럼 7종을 전부 정확한 값으로 단언한다(가능한 모든 값을 허용하는
    공집합 단언은 조용한 NULL 회귀를 못 잡는다 - 코드리뷰에서 실측으로 확인됨).
    """
    env = slope_env_real_criteria
    handle_analyze(env.db, env.cfg, {"analysis_id": env.slope_analysis_id})
    row = env.db.analyses[env.slope_analysis_id]

    assert row["status"] == "done"
    assert row["overall_verdict"] == "pass"       # 완전 평탄 + design_pct=0.0 -> 전 셀 적합
    assert row["coverage_pct"] == 100.0
    assert row["engine_version"] == ENGINE_VERSION
    assert row["artifacts_dir"] == f"artifacts/{env.slope_analysis_id}"
    assert row["applied_criteria"]["name"] == "slope-indoor-level"
    assert row["applied_criteria"]["source"].startswith("설계 구배 0%")
    assert row["applied_criteria"]["design_pct"] == 0.0
    assert row["applied_criteria"]["dir_pass_deg"] == 180
    assert row["auto_summary"] is None            # 구배용 문안 없음(단계 D에서 정함)
    # drain_points를 안 줬으므로 direction_judged=False -> 엔진이 고지 문장을 낸다.
    assert row["warnings"] == [
        "배수구 위치를 지정하지 않아 방향(역구배)을 판정하지 않았습니다. "
        "크기만 판정한 결과입니다."]
    assert not str(row["stats"]["artifacts"]["cells_csv"]).startswith("/")
    assert row["stats"]["artifacts"]["cells_csv"] == \
        f"artifacts/{env.slope_analysis_id}/slope_cells.csv"


def test_handle_analyze_slope_keeps_flatness_current_analysis(slope_env_real_criteria):
    """I1: FakeDB 단위 테스트만으로는 jobs.py 배선까지 지키지 못한다 -
    _handle_analyze_slope가 실제로 kind='slope'를 db.set_current_analysis에
    넘기는지 handle_analyze 전체 경로로 확인한다. jobs.py에서 kind 인자를
    빠뜨리면(기본값 'flatness'로 조용히 떨어지면) 이 스캔의 구배 분석 행은
    kind='slope'이므로 새 FakeDB.set_current_analysis가 no-op해 버려 두 단언
    중 최소 하나가 반드시 깨진다.
    """
    env = slope_env_real_criteria
    env.db.analyses["flat-analysis"] = {"id": "flat-analysis", "scan_id": "scan1",
                                        "kind": "flatness"}
    env.db.current_analysis[("scan1", "flatness")] = "flat-analysis"

    handle_analyze(env.db, env.cfg, {"analysis_id": env.slope_analysis_id})

    assert env.db.current_analysis[("scan1", "flatness")] == "flat-analysis"
    assert env.db.current_analysis[("scan1", "slope")] == env.slope_analysis_id

"""JSON 임포터(flatness-import-v1, docs/contracts/stats-schema.md §7) 테스트.

test_import_colab.py와 동일 구조 + CSV/JSON 경로 결과 일관성 검증.
"""
import json
import numpy as np
import pytest
from flatness.importer.colab_csv import import_colab_csv
from flatness.importer.json_import import import_json
from flatness.criteria import load_criteria

CRIT = load_criteria()["floor-kcs-exposed"]


def _write_json(path, pts, deviation_mm, **meta):
    doc = {
        "format": "flatness-import-v1",
        "surface": "floor",
        "points": [{"x": float(x), "y": float(y), "deviation_mm": float(d)}
                    for (x, y, _z), d in zip(pts, deviation_mm)],
    }
    if meta:
        doc["meta"] = meta
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")


def _write_csv(path, pts, signed_mm):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("X,Y,Z,Distance_mm,Signed_Distance_mm,R,G,B,Is_Uneven\n")
        for (x, y, z), s in zip(pts, signed_mm):
            f.write(f"{x},{y},{z},{abs(s)},{s},0,128,0,False\n")


def _depression_deviation(pts):
    r = np.hypot(pts[:, 0] - 2.0, pts[:, 1] - 2.0)
    return np.where(r < 0.3, -10.0 * 0.5 * (1.0 + np.cos(np.pi * r / 0.3)), 0.0)


def test_import_json_detects_depression(tmp_path):
    from tests.fixtures.synthetic import flat_floor
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    signed = _depression_deviation(pts)
    _write_json(tmp_path / "result.json", pts, signed,
                source_program="ExtScan Pro", measured_at="2026-07-30")
    stats = import_json(tmp_path / "result.json", CRIT, 5.0, tmp_path / "out")
    assert 9.0 <= stats["worst"]["value_mm"] <= 11.0
    assert abs(stats["worst"]["point_x"] - 2.0) < 1.0
    assert stats["meta"]["engine_version"] == "external-json-v1"
    assert stats["meta"]["source"] == "json-import"
    assert stats["meta"]["source_program"] == "ExtScan Pro"
    assert stats["meta"]["measured_at"] == "2026-07-30"
    assert (tmp_path / "out" / "heatmap.png").exists()
    assert "auto_summary" in stats


def test_import_json_missing_top_level_key(tmp_path):
    # points 누락 -> 스키마 불일치 + 기대 스키마 안내(스펙 §9)
    (tmp_path / "bad.json").write_text(
        json.dumps({"format": "flatness-import-v1", "surface": "floor"}), encoding="utf-8")
    with pytest.raises(ValueError, match="스키마 불일치"):
        import_json(tmp_path / "bad.json", CRIT, 5.0, tmp_path / "out")


def test_import_json_wrong_format_tag(tmp_path):
    (tmp_path / "bad.json").write_text(
        json.dumps({"format": "some-other-v2", "surface": "floor",
                    "points": [{"x": 0, "y": 0, "deviation_mm": 0}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="format"):
        import_json(tmp_path / "bad.json", CRIT, 5.0, tmp_path / "out")


def test_import_json_unsupported_surface(tmp_path):
    (tmp_path / "bad.json").write_text(
        json.dumps({"format": "flatness-import-v1", "surface": "wall",
                    "points": [{"x": 0, "y": 0, "deviation_mm": 0}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="surface"):
        import_json(tmp_path / "bad.json", CRIT, 5.0, tmp_path / "out")


def test_import_json_empty_points(tmp_path):
    (tmp_path / "bad.json").write_text(
        json.dumps({"format": "flatness-import-v1", "surface": "floor", "points": []}),
        encoding="utf-8")
    with pytest.raises(ValueError, match="스키마 불일치"):
        import_json(tmp_path / "bad.json", CRIT, 5.0, tmp_path / "out")


def test_import_json_malformed_json(tmp_path):
    (tmp_path / "bad.json").write_text("{not valid json", encoding="utf-8")
    with pytest.raises(ValueError, match="스키마 불일치"):
        import_json(tmp_path / "bad.json", CRIT, 5.0, tmp_path / "out")


def test_import_json_skips_malformed_points_but_keeps_valid(tmp_path):
    from tests.fixtures.synthetic import flat_floor
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    valid_points = [{"x": float(x), "y": float(y), "deviation_mm": 0.5} for x, y, _z in pts]
    malformed = [
        {"x": 1.0, "deviation_mm": 2.0},              # y 누락 -> 건너뜀
        {"x": "abc", "y": 1.0, "deviation_mm": 1.0},  # 숫자 아님 -> 건너뜀
    ]
    doc = {"format": "flatness-import-v1", "surface": "floor",
           "points": malformed + valid_points}
    (tmp_path / "mixed.json").write_text(json.dumps(doc), encoding="utf-8")
    stats = import_json(tmp_path / "mixed.json", CRIT, 5.0, tmp_path / "out")
    # 유효 포인트(flat_floor 전체)만으로 정상 처리되어야 함 -- 결함이 없는 평탄
    # 바닥이므로 전 셀이 적합 판정이어야 한다(malformed 2건이 조용히 걸러졌다는 방증).
    assert stats["n_valid"] > 0
    assert stats["grade_counts"]["rework"] == 0


def test_import_json_cli(tmp_path):
    from tests.fixtures.synthetic import flat_floor
    from tests.test_cli import _run
    pts = flat_floor(size=(3.0, 3.0), spacing=0.02)
    _write_json(tmp_path / "result.json", pts, np.zeros(len(pts)))
    r = _run("import-json", str(tmp_path / "result.json"), "--out", str(tmp_path / "out"))
    assert r.returncode == 0, r.stderr
    assert "외부 결과" in r.stdout


def test_import_json_rejects_wall_criteria_cli(tmp_path):
    from tests.fixtures.synthetic import flat_floor
    from tests.test_cli import _run
    pts = flat_floor(size=(2.0, 2.0), spacing=0.02)
    _write_json(tmp_path / "result.json", pts, np.zeros(len(pts)))
    r = _run("import-json", str(tmp_path / "result.json"), "--out", str(tmp_path / "out"),
             "--criteria", "wall-kcs-tilt-other")
    assert r.returncode == 1
    assert "바닥" in r.stdout


def test_import_csv_json_consistency(tmp_path):
    """동일 데이터를 CSV/JSON 두 경로로 각각 임포트하면 동등한 stats가 나와야 한다
    (docs/contracts/stats-schema.md §7 "두 임포트 경로 모두 최종적으로 동일한
    파이프라인에 합류"). meta의 포맷별 표기(engine_version/source/file)만 다르다.
    """
    from tests.fixtures.synthetic import flat_floor
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    signed = _depression_deviation(pts)
    _write_csv(tmp_path / "colab.csv", pts, signed)
    _write_json(tmp_path / "result.json", pts, signed)

    csv_stats = import_colab_csv(tmp_path / "colab.csv", CRIT, 5.0, tmp_path / "out_csv")
    json_stats = import_json(tmp_path / "result.json", CRIT, 5.0, tmp_path / "out_json")

    assert csv_stats["n_cells"] == json_stats["n_cells"]
    assert csv_stats["n_valid"] == json_stats["n_valid"]
    assert csv_stats["grade_counts"] == json_stats["grade_counts"]
    assert csv_stats["value_max_mm"] == json_stats["value_max_mm"]
    assert csv_stats["worst"] == json_stats["worst"]
    assert csv_stats["applied_criteria"] == json_stats["applied_criteria"]

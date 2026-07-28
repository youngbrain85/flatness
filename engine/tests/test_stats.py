import csv, json
from flatness.core.cells import CellResult
from flatness.criteria import load_criteria, grade_cells
from flatness.outputs.stats import build_stats, write_outputs

def _cells():
    return [
        CellResult(0, 0, 0.5, 0.5, 1.0, 3.0, 0.95, 0.5, 0.5),
        CellResult(1, 0, 1.5, 0.5, 10.0, 3.0, 0.9, 1.4, 0.5),
        CellResult(2, 0, 2.5, 0.5, None, 0.0, 0.1, None, None),
    ]

def test_build_stats_counts_and_worst():
    crit = load_criteria()["floor-kcs-exposed"]
    cells = _cells()
    grades, warns = grade_cells(cells, crit, 5.0)
    s = build_stats(cells, grades, crit, 5.0, warns, {"file": "t.ply"})
    assert s["n_cells"] == 3 and s["n_valid"] == 2
    assert s["grade_counts"] == {"pass": 1, "borderline": 1, "repair": 0, "rework": 0, "na": 1}
    assert s["worst"]["value_mm"] == 10.0 and s["worst"]["point_x"] == 1.4
    assert s["value_max_mm"] == 10.0 and s["value_min_mm"] == 1.0 and s["value_mean_mm"] == 5.5
    assert s["applied_criteria"]["u_mm"] == 5.0
    assert s["coverage_pct"] == round(100 * 2 / 3, 1)

def test_write_outputs(tmp_path):
    crit = load_criteria()["floor-kcs-exposed"]
    cells = _cells()
    grades, warns = grade_cells(cells, crit, 5.0)
    s = build_stats(cells, grades, crit, 5.0, warns, {})
    write_outputs(tmp_path, s, cells, grades)
    assert json.loads((tmp_path / "stats.json").read_text("utf-8"))["n_cells"] == 3
    rows = list(csv.DictReader(open(tmp_path / "results.csv", encoding="utf-8")))
    assert len(rows) == 3 and rows[1]["grade"] == "borderline" and rows[2]["grade"] == "na"
    assert json.loads((tmp_path / "cells.json").read_text("utf-8"))[0]["grade"] == "pass"

def test_build_stats_all_invalid():
    # 전체 판정불가: 통계는 None, 크래시 없음
    crit = load_criteria()["floor-kcs-exposed"]
    cells = [CellResult(0, 0, 0.5, 0.5, None, 0.0, 0.1, None, None)]
    grades, warns = grade_cells(cells, crit, 5.0)
    s = build_stats(cells, grades, crit, 5.0, warns, {})
    assert s["value_max_mm"] is None and s["value_min_mm"] is None
    assert s["value_mean_mm"] is None and s["value_p95_mm"] is None
    assert s["worst"] is None and s["n_valid"] == 0

def test_write_outputs_empty_cells(tmp_path):
    # 빈 셀 리스트: 파일은 생성되고 CSV는 헤더만
    crit = load_criteria()["floor-kcs-exposed"]
    s = build_stats([], [], crit, 5.0, [], {})
    write_outputs(tmp_path, s, [], [])
    assert (tmp_path / "stats.json").exists()
    lines = (tmp_path / "results.csv").read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1 and lines[0].startswith("ix,iy")

def test_coverage_pct_param_overrides_cell_based():
    # 티켓 16: 파이프라인 덮어쓰기 대신 파라미터로 편입 — 호출자별 의미 분화 방지
    crit = load_criteria()["floor-kcs-exposed"]
    cells = _cells()
    grades, warns = grade_cells(cells, crit, 5.0)
    s = build_stats(cells, grades, crit, 5.0, warns, {}, coverage_pct=87.34)
    assert s["coverage_pct"] == 87.3
    s2 = build_stats(cells, grades, crit, 5.0, warns, {})
    assert s2["coverage_pct"] == round(100 * 2 / 3, 1)  # 기존 셀 기반 유지

def test_cell_rows_include_zone_id(tmp_path):
    # 다중 벽/구역에서 (ix,iy)만으로는 행이 충돌 — zone_id로 판별 (P1c 최종 리뷰)
    crit = load_criteria()["floor-kcs-exposed"]
    cells = [CellResult(0, 0, 0.5, 0.5, 1.0, 3.0, 0.9, 0.5, 0.5, 1),
             CellResult(0, 0, 0.5, 0.5, 2.0, 3.0, 0.9, 0.5, 0.5, 2)]
    grades, warns = grade_cells(cells, crit, 5.0)
    s = build_stats(cells, grades, crit, 5.0, warns, {})
    write_outputs(tmp_path, s, cells, grades)
    rows = json.loads((tmp_path / "cells.json").read_text("utf-8"))
    assert rows[0]["zone_id"] == 1 and rows[1]["zone_id"] == 2
    csv_rows = list(csv.DictReader(open(tmp_path / "results.csv", encoding="utf-8")))
    assert csv_rows[0]["zone_id"] == "1" and csv_rows[1]["zone_id"] == "2"

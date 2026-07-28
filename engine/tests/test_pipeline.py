import numpy as np
from tests.fixtures.synthetic import flat_floor, add_bump, add_step, write_binary_ply
from flatness.core.pipeline import analyze_floor
from flatness.criteria import load_criteria

CRIT = load_criteria()["floor-kcs-exposed"]  # pass 7 / rework 21, U=5 → b1=2, b2=12

def test_depression_end_to_end(tmp_path):
    # 6x6m 바닥 + 2% 경사 + (2,2)에 10mm 함몰 → 경사 제거 후 함몰 검출
    # (함몰은 직선자 해석 정답이 정확히 깊이 — 2026-07-28 정정, 범프는 지지선 기하로 8.6mm가 정답)
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02, tilt=(0.02, 0.0)),
                   (2.0, 2.0), 0.3, -0.010)
    write_binary_ply(pts, tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert 9.0 <= stats["worst"]["value_mm"] <= 11.0          # ±1mm (스펙 §10.1)
    assert abs(stats["worst"]["point_x"] - 2.0) < 1.0         # 위치 1셀 이내
    assert abs(stats["worst"]["point_y"] - 2.0) < 1.0
    assert stats["grade_counts"]["borderline"] >= 1           # ≈10mm → 경계(2<10≤12)
    assert stats["grade_counts"]["pass"] >= 20                # 먼 셀은 적합(≈0mm)
    assert (tmp_path / "out" / "heatmap.png").exists()
    assert (tmp_path / "out" / "results.csv").exists()

def test_step_grades_repair(tmp_path):
    # x=3.0에 15mm 단차 → 12 < 15 ≤ 21 → 보수
    pts = add_step(flat_floor(size=(6.0, 6.0), spacing=0.02), 3.0, 0.015)
    write_binary_ply(pts, tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert abs(stats["worst"]["value_mm"] - 15.0) <= 1.0
    assert abs(stats["worst"]["point_x"] - 3.0) < 1.0         # 단차선 부근
    assert stats["grade_counts"]["repair"] >= 1

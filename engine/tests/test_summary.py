from flatness.outputs.summary import generate_summary

def _base_stats(**over):
    s = {"n_cells": 30, "n_valid": 28,
         "grade_counts": {"pass": 20, "borderline": 5, "repair": 3, "rework": 0, "na": 2},
         "worst": {"value_mm": 12.3, "point_x": 2.1, "point_y": 1.4, "cell_ix": 2, "cell_iy": 1},
         "coverage_pct": 93.5, "warnings": [],
         "applied_criteria": {"name": "floor-kcs-exposed", "pass_mm": 7, "rework_mm": 21, "u_mm": 5.0},
         "meta": {"surface": "floor"}, "zones": [], "value_max_mm": 12.3}
    s.update(over)
    return s

def test_summary_core_sections():
    t = generate_summary(_base_stats())
    assert "적합 20" in t and "보수 3" in t
    assert "12.3" in t and "(2.1, 1.4)" in t
    assert "대체하지 않습니다" in t          # 스크리닝 고지 필수
    assert "보수" in t                        # 최악 등급 문구

def test_summary_warning_mapping():
    t = generate_summary(_base_stats(warnings=["ghost_layer_rescan", "low_coverage"]))
    assert "이중 표면" in t and "재스캔" in t
    assert "인식률" in t

def test_summary_all_pass():
    t = generate_summary(_base_stats(
        grade_counts={"pass": 28, "borderline": 0, "repair": 0, "rework": 0, "na": 2}))
    assert "기준을 만족" in t

def test_summary_cp949_safe():
    t = generate_summary(_base_stats(warnings=["ghost_layer_rescan", "furniture_excluded",
                                               "plumbness_relative_to_z", "low_coverage",
                                               "uncertainty_swallows_repair", "reduced_span",
                                               "wall_2_skipped", "ghost_zone_excluded"]))
    t.encode("cp949")  # 예외 없이 인코딩되어야 함

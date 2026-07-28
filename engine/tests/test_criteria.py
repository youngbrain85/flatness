from flatness.criteria import load_criteria, grade_value

def test_seed_loaded():
    crits = load_criteria()
    c = crits["floor-kcs-exposed"]
    assert c.span_m == 3 and c.pass_mm == 7 and c.rework_mm == 21 and c.surface == "floor"
    assert len(crits) >= 11

def test_grading_boundaries():
    c = load_criteria()["floor-kcs-exposed"]  # pass 7, rework 21, U=5 → b1=2, b2=12
    assert grade_value(1.9, c, 5.0, 3.0)[0] == "pass"
    assert grade_value(10.0, c, 5.0, 3.0)[0] == "borderline"
    assert grade_value(15.0, c, 5.0, 3.0)[0] == "repair"
    assert grade_value(22.0, c, 5.0, 3.0)[0] == "rework"

def test_reduced_span_scales_linearly():
    c = load_criteria()["floor-kcs-exposed"]  # L=1.5 → s=0.5: pe=3.5, re=10.5, b2=min(8.5,10.5)
    grade, _ = grade_value(9.0, c, 5.0, 1.5)
    assert grade == "repair"  # 8.5 < 9 ≤ 10.5

def test_uncertainty_swallows_repair_warning():
    c = load_criteria()["wall-plaster-surface"]  # pass 3, rework 9, U=8 → pe+U=11 ≥ 9
    grade, warns = grade_value(5.0, c, 8.0, 3.0)
    assert "uncertainty_swallows_repair" in warns
    assert grade == "borderline"  # b2=min(11,9)=9 → 5 ≤ 9

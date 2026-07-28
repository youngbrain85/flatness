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
    c = load_criteria()["floor-kcs-exposed"]  # L=1.5 → s=0.5: pe=3.5, re=10.5, U_eff=2.5, b2=min(6.0,10.5)
    grade, _ = grade_value(9.0, c, 5.0, 1.5)
    assert grade == "repair"  # 6.0 < 9 ≤ 10.5

def test_uncertainty_swallows_repair_warning():
    c = load_criteria()["wall-plaster-surface"]  # pass 3, rework 9, U=8 → pe+U=11 ≥ 9
    grade, warns = grade_value(5.0, c, 8.0, 3.0)
    assert "uncertainty_swallows_repair" in warns
    assert grade == "borderline"  # b2=min(11,9)=9 → 5 ≤ 9

def test_reduced_span_flat_cell_still_passes():
    # 2차 개정 근거: U를 고정하면 pe(4.95) < U(5)로 b1<0 — 평탄한 가장자리 셀이 적합 불가.
    # U_eff=U×s 환산으로 b1=(7−5)×0.707=1.41 > 0 → 평탄 셀 적합 유지
    c = load_criteria()["floor-kcs-exposed"]
    grade, warns = grade_value(0.1, c, 5.0, 2.12)
    assert grade == "pass" and "reduced_span" in warns

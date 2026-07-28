import numpy as np
from flatness.core.straightedge import max_gap_under_straightedge

def test_flat_zero_gap():
    x = np.linspace(0, 3, 61)
    gap, _ = max_gap_under_straightedge(x, np.zeros_like(x))
    assert gap < 1e-9

def test_v_groove_exact():
    # (0,0)-(1,-d)-(2,0): 포락선은 양끝 직선 → 홈 깊이 d가 그대로 틈새
    x = np.array([0.0, 1.0, 2.0])
    z = np.array([0.0, -0.01, 0.0])
    gap, i = max_gap_under_straightedge(x, z)
    assert abs(gap - 0.01) < 1e-12 and i == 1

def test_single_spike_no_false_gap():
    # 돌기 하나: 직선자는 돌기에 얹혀 기울고, 틈새는 돌기 반대편에서 커진다
    x = np.linspace(0, 3, 61)
    z = np.zeros_like(x); z[30] = 0.01  # x=1.5에 10mm 돌기
    gap, _ = max_gap_under_straightedge(x, z)
    # 포락선: (0,0)→(1.5,0.01)→(3,0) — 최대 틈새는 돌기 바로 옆: 0.01*(1.45/1.5)=0.00967
    assert 0.0090 <= gap <= 0.0100

def test_sine_peak_to_peak():
    # 파장 1m·진폭 5mm 사인: 포락선은 마루에 얹힘 → 골에서 틈새 ≈ 2A
    x = np.linspace(0, 3, 61)
    z = 0.005 * np.sin(2 * np.pi * x / 1.0)
    gap, _ = max_gap_under_straightedge(x, z)
    assert abs(gap - 0.010) < 0.001

def test_lsq_would_underestimate_but_envelope_does_not():
    # LSQ 평면(평균 통과) 방식은 사인 결함을 절반(A)으로 축소한다 — 포락선은 2A를 잡는다
    x = np.linspace(0, 3, 121)
    z = 0.005 * np.sin(2 * np.pi * x / 0.75)
    gap, _ = max_gap_under_straightedge(x, z)
    lsq_style = np.max(np.abs(z - z.mean()))  # ≈ A = 5mm
    assert gap > 1.8 * lsq_style  # 포락선 ≈ 2A

import numpy as np
from flatness.io.reader import CloudInfo
from flatness.io.units import detect_units

def _info(extent):
    return CloudInfo(n_points=1000, bbox_min=np.zeros(3),
                     bbox_max=np.array([extent, extent, 3.0]))

def test_meters_high_confidence():
    g = detect_units(_info(6.0))
    assert g[0].unit == "m" and g[0].confidence == "high" and g[0].scale_to_m == 1.0

def test_millimeters_high_confidence():
    g = detect_units(_info(6000.0))
    assert g[0].unit == "mm" and g[0].confidence == "high" and g[0].scale_to_m == 0.001

def test_ambiguous_low_confidence():
    g = detect_units(_info(600.0))
    assert all(x.confidence == "low" for x in g)  # cm/m 모호 구간 — 자동 확정 금지

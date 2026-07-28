import numpy as np
from tests.fixtures.synthetic import flat_floor, add_step
from flatness.core.levels import detect_levels
from tests.test_subcell import _grid

def test_single_level():
    g = _grid(flat_floor(size=(2.0, 2.0), spacing=0.02))
    levels = detect_levels(g.median_z)
    assert len(levels) == 1 and abs(levels[0]) < 0.02

def test_two_levels_step():
    g = _grid(add_step(flat_floor(size=(4.0, 2.0), spacing=0.02), 2.0, 0.5))
    levels = detect_levels(g.median_z)
    assert len(levels) == 2
    assert abs(levels[0] - 0.0) < 0.02 and abs(levels[1] - 0.5) < 0.02

def test_empty_grid():
    assert detect_levels(np.full((4, 4), np.nan, dtype=np.float32)) == []

def test_small_cluster_below_min_frac_ignored():
    # 전체의 1%만 차지하는 높이 클러스터는 레벨이 아님(노이즈)
    g = _grid(flat_floor(size=(4.0, 4.0), spacing=0.02))
    mz = g.median_z.copy()
    mz[0, 0] = 1.0  # 서브셀 1개짜리 이상 높이
    levels = detect_levels(mz)
    assert len(levels) == 1

def test_close_peaks_merged():
    # merge_m(5cm) 이내로 붙은 두 피크는 하나의 레벨로 병합
    g = _grid(flat_floor(size=(4.0, 2.0), spacing=0.02))
    mz = g.median_z.copy()
    mz[:, mz.shape[1] // 2:] += 0.03  # 3cm 차이 두 클러스터 — 병합 대상
    levels = detect_levels(mz)
    assert len(levels) == 1
    assert 0.0 <= levels[0] <= 0.03  # 병합 결과는 두 피크 사이
    assert isinstance(levels[0], float) and not hasattr(levels[0], "dtype")  # 네이티브 float

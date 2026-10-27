"""다면 기준평면 — 정답을 아는 합성 바닥(배수 4면·용마루 2면·단차)으로 검증한다."""
import math

import numpy as np
import pytest

from flatness.core.multiplane import fit_floor_planes
from flatness.core.slope import GRADE_PASS, GRADE_REDO, grade_planes

S = 0.05


def _grid(fn, size=8.0, noise=0.0015, seed=1):
    n = int(size / S)
    c = (np.arange(n) + 0.5) * S
    X, Y = np.meshgrid(c, c)
    z = fn(X, Y) + np.random.default_rng(seed).normal(0, noise, X.shape)
    return X, Y, z


def _drain4(X, Y):
    return 0.015 * np.maximum(np.abs(X - 4), np.abs(Y - 4))


def test_four_faces_to_center_drain():
    _, _, z = _grid(_drain4)
    z[100:110, 30:40] += 0.02                      # 0.5x0.5m 범프 결함은 평면을 오염시키지 않는다
    fit = fit_floor_planes(z, np.isfinite(z), S, 4)
    assert len(fit.planes) == 4
    dirs = sorted(round(math.degrees(p.downhill_rad)) % 360 for p in fit.planes)
    assert dirs == [0, 90, 180, 270]
    for p in fit.planes:
        assert abs(p.slope_pct - 1.5) < 0.02
        assert abs(p.area_m2 - 16.0) < 0.5
    assert set(np.unique(fit.labels)) == {1, 2, 3, 4}


def test_too_many_planes_requested_finds_only_real_faces():
    # K 를 실제 면 수보다 크게 줘도 결함(1㎡ 미만)이나 같은 면 조각을 평면으로 세지 않는다
    _, _, z = _grid(_drain4)
    z[100:110, 30:40] += 0.02
    fit = fit_floor_planes(z, np.isfinite(z), S, 6)
    assert len(fit.planes) == 4
    assert fit.requested == 6


def test_ridge_two_faces_and_step():
    _, _, z = _grid(lambda X, Y: np.where(X < 5, 0.01 * X, 0.05 - 0.02 * (X - 5)), noise=0.001)
    fit = fit_floor_planes(z, np.isfinite(z), S, 2)
    slopes = sorted(round(p.slope_pct, 2) for p in fit.planes)
    assert slopes == [1.0, 2.0]
    _, _, z = _grid(lambda X, Y: np.where(Y < 3, 0.0, 0.02), noise=0.001)
    fit = fit_floor_planes(z, np.isfinite(z), S, 2)
    assert sorted(round(p.area_m2) for p in fit.planes) == [24, 40]


def test_plane_abc_is_in_absolute_frame():
    X, Y, z = _grid(lambda X, Y: 0.02 * X + 0.1, noise=0.0)
    fit = fit_floor_planes(z, np.isfinite(z), S, 1, origin=(1000.0, 2000.0))
    a, b, c = fit.planes[0].abc
    # 절대 좌표 x = 1000 + 로컬 x 에서 같은 높이가 나와야 한다
    assert abs((a * (1000.0 + 2.0) + b * (2000.0 + 3.0) + c) - (0.02 * 2.0 + 0.1)) < 1e-6
    assert abs(fit.planes[0].centroid_x - 1004.0) < 0.05


def test_mask_excludes_cells():
    _, _, z = _grid(_drain4)
    mask = np.isfinite(z)
    mask[:, :40] = False                           # 왼쪽 2m 를 바닥에서 뺀다
    fit = fit_floor_planes(z, mask, S, 4)
    assert not (fit.labels[:, :40] > 0).any()


def test_invalid_k():
    _, _, z = _grid(_drain4)
    with pytest.raises(ValueError):
        fit_floor_planes(z, np.isfinite(z), S, 0)


def test_grade_planes_uses_centroid_drain_direction():
    _, _, z = _grid(_drain4)
    fit = fit_floor_planes(z, np.isfinite(z), S, 4)
    th = {"design_pct": 1.5, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}
    graded = grade_planes(fit.planes, th, drain_points=[(4.0, 4.0)])
    assert all(g["grade"] == GRADE_PASS for g in graded)
    # 배수구를 바닥 밖 오른쪽에 두면 +x 로 흐르는 면 말고는 방향이 틀린다(반대쪽 면은 역구배)
    graded = grade_planes(fit.planes, th, drain_points=[(20.0, 4.0)])
    by_dir = {round(math.degrees(g["plane"].downhill_rad)) % 360: g for g in graded}
    assert by_dir[0]["grade"] == GRADE_PASS
    assert by_dir[180]["grade"] == GRADE_REDO
    # 보정 높이차는 평면 길이(run_m)로 환산한다
    th2 = dict(th, design_pct=2.0)
    g = grade_planes(fit.planes[:1], th2)[0]
    assert abs(g["correction_mm"] - g["dev_pct"] * fit.planes[0].run_m * 10.0) < 1e-9

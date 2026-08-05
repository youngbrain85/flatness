"""정합 엔진 테스트 — 스펙 §4.4 / §9.3 (교체 게이트는 설계 결정 F1).

게이트 설계 메모: 스펙 §9.3 원문의 "평행이동 오차 <=1mm"는 노이즈가 있는 수평
바닥에서 **구조적으로 달성 불가능**하다(면내 2자유도·yaw 퇴화). 실측 근거와 교체
게이트는 스펙 §9.3에 기록했다. 여기서는 교체 게이트를 테스트한다:
  (1) 비퇴화 경로(대응점 오차 0)에서는 원 게이트를 그대로 요구한다
  (2) 노이즈+클릭오차에서는 z 평행이동만 <=1mm를 요구한다(z는 퇴화하지 않는다)
  (3) 진짜 계약인 "중첩 서브셀 중앙값 z 불일치"를 직접 잰다
  (4) 중첩 10% 미만은 성공을 가장하지 않는다
"""
import numpy as np
import pytest

from flatness.core.registration import (
    MAX_RMSE_M, umeyama_rigid, register_clouds, grid_to_points,
)
from flatness.core.subcell import SubcellGrid
from tests.fixtures.synthetic import bumpy_floor, bumpy_surface_z

_NOISE_SD_M = 0.001          # 노이즈 1mm (스펙 §9.3)
_KNOWN_YAW_DEG = 7.0
_KNOWN_SHIFT_M = np.array([0.35, -0.22, 0.011])


def _matrix(yaw_deg, shift):
    c, s = np.cos(np.radians(yaw_deg)), np.sin(np.radians(yaw_deg))
    T = np.eye(4)
    T[:3, :3] = np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])
    T[:3, 3] = shift
    return T


def _apply(pts, yaw_deg, shift):
    c, s = np.cos(np.radians(yaw_deg)), np.sin(np.radians(yaw_deg))
    R = np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])
    return pts @ R.T + shift


def _corr_idx(n):
    return [0, n // 3, 2 * n // 3, n - 1]


def _median_z_map(pts, origin, subcell_m, shape):
    """(ny,nx) 서브셀 중앙값 z. 점이 없는 셀은 NaN."""
    ny, nx = shape
    ix = np.floor((pts[:, 0] - origin[0]) / subcell_m).astype(np.int64)
    iy = np.floor((pts[:, 1] - origin[1]) / subcell_m).astype(np.int64)
    ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
    flat = iy[ok] * nx + ix[ok]
    z = pts[ok, 2]
    order = np.argsort(flat, kind="stable")
    flat, z = flat[order], z[order]
    out = np.full(ny * nx, np.nan)
    starts = np.flatnonzero(np.r_[True, np.diff(flat) > 0])
    for s, e in zip(starts, np.r_[starts[1:], len(flat)]):
        out[flat[s]] = np.median(z[s:e])
    return out.reshape(ny, nx)


def _overlap_median_z_discrepancy(a, b, subcell_m):
    """두 점군을 같은 격자에 넣고, 양쪽 모두 유효한 셀에서 |중앙값 차|의 중앙값."""
    origin = np.minimum(a.min(axis=0)[:2], b.min(axis=0)[:2]) - subcell_m
    hi = np.maximum(a.max(axis=0)[:2], b.max(axis=0)[:2]) + subcell_m
    shape = (int(np.ceil((hi[1] - origin[1]) / subcell_m)) + 1,
             int(np.ceil((hi[0] - origin[0]) / subcell_m)) + 1)
    ma = _median_z_map(a, origin, subcell_m, shape)
    mb = _median_z_map(b, origin, subcell_m, shape)
    both = np.isfinite(ma) & np.isfinite(mb)
    assert both.sum() > 100, "중첩 셀이 너무 적어 지표가 무의미하다"
    return float(np.median(np.abs(ma[both] - mb[both])))


def _grid_with_one_nan():
    """3x4 비정사각 격자, NaN 한 칸은 비대칭 위치(1,1) — 기하 중심·대칭점 회피."""
    z = np.array([[0.0110, 0.0132, 0.0091, 0.0147],
                  [0.0123, np.nan, 0.0104, 0.0158],
                  [0.0087, 0.0166, 0.0129, 0.0113]], dtype=np.float32)
    counts = np.full(z.shape, 7, dtype=np.int32)
    counts[1, 1] = 1
    return SubcellGrid(size_m=0.05, origin=np.array([12.3, -4.7]), shape=z.shape,
                       median_z=z, counts=counts, bimodal=np.zeros(z.shape, dtype=bool))


def _split_pair(overlap_m, seed, total_x=24.0, split_x=8.0, size_y=6.0, gap_m=0.0):
    """한 장의 바닥을 두 구획으로 잘라 **진짜** 부분 중첩을 만든다.

    같은 표면을 자르므로 중첩 영역에서만 두 점군이 실제로 일치한다. 원 브리프의
    "b = 강체변환(a)" 방식은 정합이 끝나면 100% 겹쳐버려서 저중첩을 전혀 만들지
    못한다 — 이 단계에서 반복해 겪은 퇴화 픽스처와 같은 종류의 함정이다.

    `gap_m`>0이면 중첩 구간 뒤에 빈 띠를 둔다(폐색·별개 구획). 그러면 b의
    비중첩 점이 전부 max_pair_dist_m 밖으로 나가서, 남는 대응은 깨끗한 중첩분
    뿐이 된다 — RMSE 게이트를 0으로 만들어 **중첩 가드만 단독으로** 시험할 수 있다.
    """
    full = bumpy_floor(size=(total_x, size_y), spacing=0.05, seed=seed)
    a = full[full[:, 0] <= split_x + 1e-9]
    in_b = full[:, 0] >= split_x - overlap_m - 1e-9
    if gap_m > 0:
        in_b &= (full[:, 0] <= split_x + 1e-9) | (full[:, 0] >= split_x + gap_m - 1e-9)
    b_world = full[in_b]
    strip = a[a[:, 0] >= split_x - overlap_m - 1e-9]
    picks = strip[[0, len(strip) // 3, 2 * len(strip) // 3, len(strip) - 1]]
    return a, b_world, picks


# --- Umeyama 닫힌 해 ---------------------------------------------------------

def test_umeyama_recovers_known_transform_exactly():
    """대응점에 오차가 없으면 닫힌 해가 변환을 정확히 복원한다."""
    src = np.array([[0.0, 0.0, 0.0], [4.0, 0.0, 0.02], [0.0, 3.0, -0.01], [4.0, 3.0, 0.03]])
    dst = _apply(src, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    T = umeyama_rigid(src, dst)
    got = (np.c_[src, np.ones(len(src))] @ T.T)[:, :3]
    assert np.abs(got - dst).max() < 1e-9
    # 축척이 고정인가: 회전 블록이 정규직교여야 한다
    R = T[:3, :3]
    assert np.abs(R @ R.T - np.eye(3)).max() < 1e-9
    assert abs(np.linalg.det(R) - 1.0) < 1e-9


def test_umeyama_never_returns_a_reflection():
    """dst가 거울상이어도 반사(det=-1)를 내면 안 된다.

    위의 '정확 복원' 테스트만으로는 반사 보정(d=sign(det))을 검증하지 못한다.
    정상 회전 데이터에서는 d가 자연히 +1이라 보정을 지워도 결과가 같기 때문이다.
    거울상 dst를 줘야 보정이 실제로 발동한다.
    """
    src = np.array([[0.0, 0.0, 0.0], [4.0, 0.0, 0.02], [0.0, 3.0, -0.01],
                    [4.0, 3.0, 0.03], [1.7, 2.1, -0.04]])
    dst = src * np.array([1.0, 1.0, -1.0])          # z 거울상
    R = umeyama_rigid(src, dst)[:3, :3]
    assert np.linalg.det(R) > 0.0, "반사를 강체 변환으로 반환했다"
    assert abs(np.linalg.det(R) - 1.0) < 1e-9
    assert np.abs(R @ R.T - np.eye(3)).max() < 1e-9


def test_umeyama_keeps_scale_fixed_when_target_is_scaled():
    """dst가 1.05배 확대돼 있어도 축척을 흡수하지 않는다 (스펙 §4.4 축척 고정).

    비확대 데이터에서는 최적 축척이 1.0이라 축척을 곱해도 티가 안 난다.
    확대된 dst를 줘야 축척 고정 여부가 드러난다.
    """
    src = np.array([[0.0, 0.0, 0.0], [4.0, 0.0, 0.02], [0.0, 3.0, -0.01],
                    [4.0, 3.0, 0.03], [1.7, 2.1, -0.04]])
    dst = _apply(1.05 * src, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    R = umeyama_rigid(src, dst)[:3, :3]
    assert abs(np.linalg.det(R) - 1.0) < 1e-9, f"축척을 흡수했다(det={np.linalg.det(R):.4f})"
    assert np.abs(R @ R.T - np.eye(3)).max() < 1e-9


# --- 복원 게이트 -------------------------------------------------------------

def test_zero_jitter_recovers_gate_rotation_and_translation():
    """비퇴화 경로: 지터가 없으면 회전 <=0.1도, 평행이동 <=1mm (설계 결정 F1).

    수평 평면은 면내 2자유도와 yaw에 대해 구조적으로 퇴화하지만, 대응점에
    오차가 없으면 그 퇴화가 발동하지 않는다. 이 테스트가 알고리즘 자체의
    정확성을 증명한다 - 아래 z 게이트가 통과해도 이것이 깨지면 구현이 틀렸다.

    기대값은 `_apply`의 **역변환**이다. register_clouds(b, a, ...)는 b->a 변환을
    내므로 평행이동 성분은 -shift가 아니라 -R^T·shift다(회전이 7도이므로 둘은
    41mm 차이 난다). 브리프 초안은 -shift와 비교해 정답조차 통과할 수 없었다.
    """
    a = bumpy_floor(size=(8.0, 6.0), seed=1)
    b = _apply(a, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    corr_idx = _corr_idx(len(a))
    res = register_clouds(b, a, b[corr_idx], a[corr_idx])
    assert res.converged, res.failure_reason
    yaw_err = abs(np.degrees(np.arctan2(res.transform[1, 0], res.transform[0, 0])) + _KNOWN_YAW_DEG)
    assert yaw_err <= 0.1, f"회전 오차 {yaw_err:.4f}도"
    expect = np.linalg.inv(_matrix(_KNOWN_YAW_DEG, _KNOWN_SHIFT_M))
    shift_err = np.abs(res.transform[:3, 3] - expect[:3, 3])
    assert shift_err.max() <= 0.001, f"평행이동 오차 {shift_err.max() * 1000:.3f}mm"


def test_z_translation_gate_survives_noise_and_click_error():
    """노이즈 1mm + 대응점 ±5cm 오차에서도 z 평행이동 오차 <=1mm.

    면내는 퇴화라 게이트를 걸지 않는다(설계 결정 F1의 실측 표 참고).
    z는 수평면에서도 퇴화하지 않으므로 원 스펙 값을 그대로 유지한다.
    """
    rng = np.random.default_rng(7)
    a = bumpy_floor(size=(8.0, 6.0), seed=2)
    b = _apply(a, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, _NOISE_SD_M, (len(a), 3))
    corr_idx = _corr_idx(len(a))
    jitter = rng.normal(0, 0.05, (4, 3))              # 화면 클릭 정확도 ±5cm
    res = register_clouds(b, a, b[corr_idx] + jitter, a[corr_idx])
    assert res.converged, res.failure_reason
    expect_z = np.linalg.inv(_matrix(_KNOWN_YAW_DEG, _KNOWN_SHIFT_M))[2, 3]
    z_err = abs(res.transform[2, 3] - expect_z)
    assert z_err <= 0.001, f"z 오차 {z_err * 1000:.3f}mm"


def test_purpose_fitness_overlap_median_z_discrepancy():
    """목적 적합성 게이트: 중첩 영역의 서브셀 중앙값 z 불일치 <= 노이즈 + 1mm.

    면내 오차가 실제로 해치는 것은 "병합된 서브셀 중앙값 z"뿐이다. 그 양을
    직접 잰다 - 면내 mm를 재는 대리 지표보다 이것이 진짜 계약이다.
    """
    a = bumpy_floor(size=(8.0, 6.0), seed=3)
    b_true = _apply(a, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    rng = np.random.default_rng(11)
    b = b_true + rng.normal(0, _NOISE_SD_M, (len(a), 3))
    corr_idx = _corr_idx(len(a))
    res = register_clouds(b, a, b[corr_idx], a[corr_idx])
    aligned = (np.c_[b, np.ones(len(b))] @ res.transform.T)[:, :3]
    disc = _overlap_median_z_discrepancy(a, aligned, subcell_m=0.05)
    assert disc <= _NOISE_SD_M + 0.001, f"중첩 z 불일치 {disc * 1000:.3f}mm"


def test_independent_sampling_of_one_surface_keeps_z_and_purpose_gates():
    """같은 바닥을 **서로 다른 점으로** 스캔한 현실 조건.

    브리프의 나머지 정합 테스트는 전부 `b = 강체변환(a)`이라 두 점군의 점이 1:1로
    같다. 그러면 최근접점 탐색이 늘 '같은 점'을 찾아버려, 바닥을 **완전 평면으로
    바꿔도 자릿수까지 똑같이 통과한다**(면내 0.02mm / z 0.007mm / 목적지표
    0.669mm — 스펙 §9.3 대조 표 D행). 즉 그 테스트들은 표면 형상을 전혀 검증하지
    못한다. 여기서는 표면(seed)만 공유하고 표본 위치를 독립으로 흩뿌려 그 교락을
    제거한다.

    이 조건에서 면내 오차는 실제로 남지만(약 45mm, 설계 결정 F1의 퇴화) **z와
    목적 지표는 게이트를 지킨다** — 그것이 게이트 교체의 논거다.
    `converged`는 요구하지 않는다: 표본이 다르면 point-to-point 잔차의 하한이
    표본 간격(5cm)의 절반 수준이라 스펙 §4.4의 RMSE<=2mm를 구조적으로 못 넘는다
    (실측 19.5mm). 이 위험도 스펙 §9.3에 기록했다.
    """
    size = (8.0, 6.0)
    rng = np.random.default_rng(7)
    a = bumpy_floor(size=size, seed=21, sample_jitter=0.025, sample_seed=101)
    b_local = bumpy_floor(size=size, seed=21, sample_jitter=0.025, sample_seed=202)
    b = _apply(b_local, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, _NOISE_SD_M, b_local.shape)
    corr_xy = np.array([[0.9, 0.7], [6.8, 1.3], [1.6, 5.1], [7.1, 4.6]])
    corr_dst = np.column_stack([corr_xy, bumpy_surface_z(corr_xy[:, 0], corr_xy[:, 1], size=size, seed=21)])
    corr_src = _apply(corr_dst, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, 0.05, corr_dst.shape)

    res = register_clouds(b, a, corr_src, corr_dst)
    assert res.overlap_ratio >= 0.1, f"중첩 비율 {res.overlap_ratio:.3f}"
    expect_z = np.linalg.inv(_matrix(_KNOWN_YAW_DEG, _KNOWN_SHIFT_M))[2, 3]
    z_err = abs(res.transform[2, 3] - expect_z)
    assert z_err <= 0.001, f"z 오차 {z_err * 1000:.3f}mm"
    aligned = (np.c_[b, np.ones(len(b))] @ res.transform.T)[:, :3]
    disc = _overlap_median_z_discrepancy(a, aligned, subcell_m=0.05)
    assert disc <= _NOISE_SD_M + 0.001, f"중첩 z 불일치 {disc * 1000:.3f}mm"


def test_half_overlap_meets_z_gate_and_reports_partial_overlap():
    """스펙 §9.3이 명시한 조건 그대로: 노이즈 1mm + 중첩 50%.

    브리프의 나머지 테스트는 전부 100% 중첩이라 이 조건을 아무도 안 밟는다.
    부분 중첩에서 비중첩 구간이 해를 끌고 가지 않는지(트리밍의 존재 이유)를 본다.
    """
    rng = np.random.default_rng(23)
    a, b_world, picks = _split_pair(overlap_m=4.0, seed=6, total_x=16.0)
    b = _apply(b_world, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, _NOISE_SD_M, (len(b_world), 3))
    res = register_clouds(b, a, _apply(picks, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M), picks)
    assert res.converged, res.failure_reason
    assert 0.1 <= res.overlap_ratio < 1.0, f"부분 중첩 비율 {res.overlap_ratio:.3f}"
    expect_z = np.linalg.inv(_matrix(_KNOWN_YAW_DEG, _KNOWN_SHIFT_M))[2, 3]
    assert abs(res.transform[2, 3] - expect_z) <= 0.001


def test_trimming_rejects_ghost_layer_outliers():
    """유령층(이동 물체) 15%가 섞여도 z 평행이동이 끌려가지 않는다.

    유령층은 max_pair_dist_m(0.5m) 안이라 거리 필터로는 안 걸러진다.
    trimmed ICP가 거리 상위 20%를 버리는 것이 유일한 방어선이다.
    """
    a = bumpy_floor(size=(8.0, 6.0), seed=8)
    b = _apply(a, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    rng = np.random.default_rng(31)
    ghost = rng.random(len(b)) < 0.15
    b = b.copy()
    b[ghost, 2] += 0.25                                # 25cm 위에 뜬 유령층
    clean = np.flatnonzero(~ghost)
    corr = clean[_corr_idx(len(clean))]
    res = register_clouds(b, a, b[corr], a[corr])
    # z를 먼저 본다: 트리밍이 죽으면 z가 유령층 쪽으로 끌려가는 것이 핵심 증상이고,
    # converged를 먼저 단언하면 RMSE 게이트가 그 증상을 가려버린다.
    expect_z = np.linalg.inv(_matrix(_KNOWN_YAW_DEG, _KNOWN_SHIFT_M))[2, 3]
    z_err = abs(res.transform[2, 3] - expect_z)
    assert z_err <= 0.001, f"유령층에 끌려간 z 오차 {z_err * 1000:.3f}mm"
    assert res.converged, res.failure_reason


def test_low_overlap_fails_instead_of_pretending_success():
    """중첩 10% 미만이면 성공을 가장하지 않고 실패로 끝난다 (스펙 §9.3 유지).

    실제로 겹치지 않는 두 구획을 쓴다. 같은 점군을 강체 변환만 해서는 정합 후
    100% 겹쳐버려 저중첩 상황 자체가 만들어지지 않는다.

    중첩 뒤에 빈 띠(gap)를 둬서 **RMSE는 깨끗하게 만든다**. 그래야 중첩 가드를
    없앴을 때 `converged`가 실제로 True로 뒤집히고, 가드가 유일한 방어선임을
    증명할 수 있다. gap이 없으면 경계 근처의 엉터리 대응이 RMSE를 키워서
    RMSE 게이트가 대신 실패시켜버리고, 가드 제거가 사유 문구로만 드러난다.
    """
    a, b_world, picks = _split_pair(overlap_m=0.5, seed=4, total_x=24.0, gap_m=1.0)
    b = _apply(b_world, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    res = register_clouds(b, a, _apply(picks, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M), picks)
    assert res.overlap_ratio < 0.1, f"중첩 비율 {res.overlap_ratio:.3f}"
    assert res.rmse_m <= MAX_RMSE_M, f"이 픽스처는 RMSE가 깨끗해야 한다: {res.rmse_m * 1000:.3f}mm"
    assert not res.converged
    assert res.failure_reason is not None
    assert "중첩" in res.failure_reason


def test_fewer_than_three_correspondences_is_rejected():
    a = bumpy_floor(size=(4.0, 3.0), seed=5)
    with pytest.raises(ValueError, match="대응점"):
        register_clouds(a, a, a[:2], a[:2])


# --- 서브셀 격자 -> 점군 ------------------------------------------------------

def test_grid_to_points_drops_nan_subcells_and_uses_cell_centers():
    grid = _grid_with_one_nan()
    pts = grid_to_points(grid)
    assert np.isfinite(pts).all()
    assert len(pts) == int(np.isfinite(grid.median_z).sum())
    # 셀 중심인가: origin + (i+0.5)*size_m
    assert np.isclose(pts[:, 0].min(), grid.origin[0] + 0.5 * grid.size_m)
    assert np.isclose(pts[:, 1].min(), grid.origin[1] + 0.5 * grid.size_m)

"""정합 엔진 테스트 — 스펙 §4.4 / §9.3 (교체 게이트는 설계 결정 F1, 스펙 §9.3.1).

게이트 설계 메모: 스펙 §9.3 원문의 "평행이동 오차 <=1mm"는 **대응점에 클릭 오차가
있으면** 수평 바닥에서 구조적으로 달성 불가능하다(면내 2자유도·yaw 퇴화).
실측 근거와 교체 게이트는 스펙 §9.3.1에 기록했다.

픽스처 원칙 — 두 스캔은 **같은 표면을 서로 다른 점으로** 표본한다(`_scan_pair`).
두 점군의 점이 1:1로 동일하면 최근접점 탐색이 늘 '같은 점'을 찾아버려, 바닥을
완전 평면으로 바꿔도 결과가 자릿수까지 같아진다 — 그런 픽스처는 표면 관련 결함을
전혀 잡지 못한다. 그 퇴화 자체는 아래 두 회귀 가드로 고정해 뒀다.
"""
import numpy as np
import pytest
from scipy.spatial import cKDTree

from flatness.core import registration as reg
from flatness.core.registration import (
    umeyama_rigid, register_clouds, icp_refine, grid_to_points,
)
from flatness.core.subcell import SubcellGrid
from tests.fixtures.synthetic import bumpy_floor, bumpy_surface_z

# 스펙 §4.4의 임계를 **리터럴로** 고정한다. 구현 상수(reg.MAX_RMSE_M)를 그대로 쓰면
# 상수를 바꾸는 변이가 게이트를 무력화해도 단언이 함께 움직여 잡히지 않는다.
_SPEC_MAX_RMSE_M = 0.002

_NOISE_SD_M = 0.001          # 노이즈 1mm (스펙 §9.3)
_KNOWN_YAW_DEG = 7.0
_KNOWN_SHIFT_M = np.array([0.35, -0.22, 0.011])
_CLICK_SD_M = 0.05           # 화면 클릭 정확도 ±5cm
_SURF_SEED = 21
_SIZE = (8.0, 6.0)
# 대응점 (x,y) — 비대칭 배치. 정사각 격자·bbox 기하 중심·대칭 위치를 피한다.
_CORR_XY = np.array([[0.9, 0.7], [6.8, 1.3], [1.6, 5.1], [7.1, 4.6]])


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


def _expected():
    """register_clouds(b, a, ...)가 내야 하는 참값 = `_apply`의 역변환.

    평행이동 성분은 `-t`가 아니라 `-R^T·t`다. yaw 7도에서 둘은 41mm 차이 나므로
    `-t`와 비교하면 완벽한 해조차 통과하지 못한다.
    """
    return np.linalg.inv(_matrix(_KNOWN_YAW_DEG, _KNOWN_SHIFT_M))


def _surface(xy, size=_SIZE, seed=_SURF_SEED, flat=False):
    z = np.zeros(len(xy)) if flat else bumpy_surface_z(xy[:, 0], xy[:, 1], size=size, seed=seed)
    return np.column_stack([xy, z])


def _scan_pair(*, noise_sd=_NOISE_SD_M, click_sd=0.0, rng_seed=7, seed=_SURF_SEED,
               size=_SIZE, identical_points=False, flat=False):
    """같은 바닥을 두 번 스캔한 `(a, b, corr_src, corr_dst)`.

    기본은 **표본 독립**: 표면(`seed`)만 공유하고 표본 위치를 서로 다르게 흩뿌린다.
    대응점은 배열 인덱스가 아니라 표면 함수에서 직접 뽑으므로 표본이 달라도 정확하다.

    `identical_points=True`는 b를 a의 강체 변환으로 만든다 — **퇴화 대조군 전용**이며
    실사용 테스트에 쓰면 안 된다(모듈 독스트링 참고).
    """
    rng = np.random.default_rng(rng_seed)
    a = bumpy_floor(size=size, seed=seed, sample_jitter=0.025, sample_seed=101)
    if identical_points:
        b_local = a
    else:
        b_local = bumpy_floor(size=size, seed=seed, sample_jitter=0.025, sample_seed=202)
    if flat:
        a, b_local = a.copy(), b_local.copy()
        a[:, 2] = 0.0
        b_local[:, 2] = 0.0
    b = _apply(b_local, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, noise_sd, b_local.shape)
    corr_dst = _surface(_CORR_XY, size=size, seed=seed, flat=flat)
    corr_src = _apply(corr_dst, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    if click_sd:
        corr_src = corr_src + rng.normal(0, click_sd, corr_dst.shape)
    return a, b, corr_src, corr_dst


def _split_pair(overlap_m, seed, total_x=24.0, split_x=8.0, size_y=6.0, gap_m=0.0):
    """한 장의 바닥을 두 구획으로 잘라 **진짜** 부분 중첩을 만든다. 표본은 독립이다.

    같은 표면을 공유하므로 중첩 영역에서만 두 점군이 실제로 일치한다. "b = 강체변환(a)"
    방식은 정합이 끝나면 100% 겹쳐버려 저중첩을 전혀 만들지 못한다.

    `gap_m`>0이면 중첩 구간 뒤에 빈 띠를 둔다(폐색·별개 구획). 그러면 b의 비중첩 점이
    전부 `max_pair_dist_m` 밖으로 나가서 남는 대응이 깨끗한 중첩분뿐이 된다 —
    RMSE를 게이트 안으로 낮춰 **중첩 가드만 단독으로** 시험할 수 있다.
    """
    size = (total_x, size_y)
    full_a = bumpy_floor(size=size, spacing=0.05, seed=seed, sample_jitter=0.025, sample_seed=1000 + seed)
    full_b = bumpy_floor(size=size, spacing=0.05, seed=seed, sample_jitter=0.025, sample_seed=2000 + seed)
    a = full_a[full_a[:, 0] <= split_x + 1e-9]
    in_b = full_b[:, 0] >= split_x - overlap_m - 1e-9
    if gap_m > 0:
        in_b &= (full_b[:, 0] <= split_x + 1e-9) | (full_b[:, 0] >= split_x + gap_m - 1e-9)
    b_world = full_b[in_b]
    fx = np.array([0.13, 0.71, 0.34, 0.92])          # 비대칭·비공선
    fy = np.array([0.07, 0.38, 0.69, 0.94])
    pxy = np.column_stack([split_x - overlap_m + fx * overlap_m, fy * size_y])
    return a, b_world, _surface(pxy, size=size, seed=seed)


def _wall_scan(sample_seed, length=8.0, height=2.4, spacing=0.05, y0=0.0, jitter=0.025):
    """수직 벽 표본 — 법선이 ±y다. 표본 위치는 흩뿌린다."""
    rng = np.random.default_rng(sample_seed)
    gu, gv = np.meshgrid(np.arange(0.0, length + spacing / 2, spacing),
                         np.arange(0.0, height + spacing / 2, spacing))
    gu = gu + rng.uniform(-jitter, jitter, gu.shape)
    gv = gv + rng.uniform(-jitter, jitter, gv.shape)
    return np.column_stack([gu.ravel(), np.full(gu.size, y0), gv.ravel()])


def _floor_and_wall(sample_seed, seed=_SURF_SEED, size=_SIZE):
    """바닥 + 수직 벽 장면. 법선이 두 방향으로 갈리므로 상수 법선 가정이 드러난다."""
    floor = bumpy_floor(size=size, seed=seed, sample_jitter=0.025, sample_seed=sample_seed)
    return np.vstack([floor, _wall_scan(sample_seed + 7, length=size[0])])


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


def _aligned(b, res):
    return (np.c_[b, np.ones(len(b))] @ res.transform.T)[:, :3]


def _trimmed_point_rmse(a, aligned, trim_ratio=0.8):
    """같은 트리밍을 적용한 point-to-point 잔차 — point-to-plane과 대비용."""
    d, _ = cKDTree(a).query(aligned)
    d = np.sort(d)[:int(round(trim_ratio * len(d)))]
    return float(np.sqrt(np.mean(d ** 2)))


def _errors(res):
    """(yaw 오차[도], 면내 오차[m], z 오차[m])."""
    d = res.transform[:3, 3] - _expected()[:3, 3]
    yaw = abs(np.degrees(np.arctan2(res.transform[1, 0], res.transform[0, 0])) + _KNOWN_YAW_DEG)
    return yaw, float(np.hypot(d[0], d[1])), float(d[2])


def _grid_with_one_nan():
    """3x4 비정사각 격자, NaN 한 칸은 비대칭 위치(1,1) — 기하 중심·대칭점 회피."""
    z = np.array([[0.0110, 0.0132, 0.0091, 0.0147],
                  [0.0123, np.nan, 0.0104, 0.0158],
                  [0.0087, 0.0166, 0.0129, 0.0113]], dtype=np.float32)
    counts = np.full(z.shape, 7, dtype=np.int32)
    counts[1, 1] = 1
    return SubcellGrid(size_m=0.05, origin=np.array([12.3, -4.7]), shape=z.shape,
                       median_z=z, counts=counts, bimodal=np.zeros(z.shape, dtype=bool))


# --- Umeyama 닫힌 해 ---------------------------------------------------------

def test_umeyama_recovers_known_transform_exactly():
    """대응점에 오차가 없으면 닫힌 해가 변환을 정확히 복원한다."""
    src = np.array([[0.0, 0.0, 0.0], [4.0, 0.0, 0.02], [0.0, 3.0, -0.01], [4.0, 3.0, 0.03]])
    dst = _apply(src, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    T = umeyama_rigid(src, dst)
    got = (np.c_[src, np.ones(len(src))] @ T.T)[:, :3]
    assert np.abs(got - dst).max() < 1e-9
    R = T[:3, :3]
    assert np.abs(R @ R.T - np.eye(3)).max() < 1e-9
    assert abs(np.linalg.det(R) - 1.0) < 1e-9


def test_umeyama_never_returns_a_reflection():
    """dst가 거울상이어도 반사(det=-1)를 내면 안 된다.

    위의 '정확 복원' 테스트만으로는 반사 보정(d=sign(det))을 검증하지 못한다.
    정상 회전 데이터에서는 d가 자연히 +1이라 보정을 지워도 결과가 같기 때문이다.
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
    """
    src = np.array([[0.0, 0.0, 0.0], [4.0, 0.0, 0.02], [0.0, 3.0, -0.01],
                    [4.0, 3.0, 0.03], [1.7, 2.1, -0.04]])
    dst = _apply(1.05 * src, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    R = umeyama_rigid(src, dst)[:3, :3]
    assert abs(np.linalg.det(R) - 1.0) < 1e-9, f"축척을 흡수했다(det={np.linalg.det(R):.4f})"
    assert np.abs(R @ R.T - np.eye(3)).max() < 1e-9


# --- 복원 게이트 (전부 표본 독립 픽스처에서 측정한다) -------------------------

def test_zero_click_error_recovers_original_spec_gate():
    """대응점 클릭 오차가 없으면 **원 스펙 게이트**를 그대로 만족한다.

    회전 <=0.1도, 평행이동 <=1mm (스펙 §9.3 원문). 표본이 독립이고 노이즈 1mm가
    있어도 성립한다 — 즉 알고리즘 자체는 원 게이트를 낼 수 있다. 게이트를 교체한
    이유는 알고리즘이 나빠서가 아니라, 여기에 ±5cm 클릭 오차가 더해지면 면내
    2자유도와 yaw가 구조적으로 퇴화하기 때문이다(아래 테스트).
    """
    a, b, cs, cd = _scan_pair(click_sd=0.0)
    res = register_clouds(b, a, cs, cd)
    assert res.converged, res.failure_reason
    yaw_err, _inplane, _z = _errors(res)
    assert yaw_err <= 0.1, f"회전 오차 {yaw_err:.4f}도"
    shift_err = np.abs(res.transform[:3, 3] - _expected()[:3, 3]).max()
    assert shift_err <= 0.001, f"평행이동 오차 {shift_err * 1000:.3f}mm"


def test_z_translation_gate_survives_noise_and_click_error():
    """노이즈 1mm + 대응점 ±5cm 오차에서도 z 평행이동 오차 <=1mm.

    면내는 퇴화라 게이트를 걸지 않는다(스펙 §9.3.1의 실측 표). z는 수평면에서도
    퇴화하지 않으므로 원 스펙 값을 그대로 유지한다.
    """
    a, b, cs, cd = _scan_pair(click_sd=_CLICK_SD_M)
    res = register_clouds(b, a, cs, cd)
    assert res.converged, res.failure_reason
    _yaw, _inplane, z_err = _errors(res)
    assert abs(z_err) <= 0.001, f"z 오차 {z_err * 1000:.3f}mm"


def test_purpose_fitness_overlap_median_z_discrepancy():
    """목적 적합성 게이트: 중첩 영역의 서브셀 중앙값 z 불일치 <= 노이즈 + 1mm.

    면내 오차가 실제로 해치는 것은 "병합된 서브셀 중앙값 z"뿐이다. 그 양을 직접
    잰다 - 면내 mm를 재는 대리 지표보다 이것이 진짜 계약이다.
    """
    a, b, cs, cd = _scan_pair(click_sd=_CLICK_SD_M)
    res = register_clouds(b, a, cs, cd)
    disc = _overlap_median_z_discrepancy(a, _aligned(b, res), subcell_m=0.05)
    assert disc <= _NOISE_SD_M + 0.001, f"중첩 z 불일치 {disc * 1000:.3f}mm"


def test_point_to_plane_rmse_meets_spec_gate_where_point_to_point_cannot():
    """스펙 §4.4 `RMSE <= 2mm`는 **point-to-plane 잔차** 기준이라야 성립한다.

    두 스캔이 같은 표면을 서로 다른 점으로 표본하면 point-to-point 잔차에는
    표본 간격의 절반 수준 **하한**이 생긴다 — 정합이 아무리 정확해도 못 내려간다.
    그건 정합 품질이 아니라 격자 해상도의 그림자다. point-to-plane 잔차는 법선
    방향 성분만 세므로 접선 방향 이산화가 섞이지 않고 노이즈 수준으로 수렴한다.

    이 테스트가 두 값을 같은 정합·같은 트리밍에서 나란히 재서 그 차이를 고정한다.
    """
    a, b, cs, cd = _scan_pair(click_sd=_CLICK_SD_M)
    res = register_clouds(b, a, cs, cd)
    assert res.converged, res.failure_reason
    assert res.rmse_m <= _SPEC_MAX_RMSE_M, f"point-to-plane RMSE {res.rmse_m * 1000:.3f}mm"
    point_rmse = _trimmed_point_rmse(a, _aligned(b, res))
    assert point_rmse > 5 * _SPEC_MAX_RMSE_M, (
        f"point-to-point 잔차가 {point_rmse * 1000:.2f}mm뿐이다 — 두 스캔이 점을 "
        "공유하고 있다는 뜻이고, 그러면 이 테스트가 아무것도 증명하지 못한다")


def test_point_to_plane_rmse_uses_measured_normals_not_a_vertical_assumption():
    """법선을 상수 [0,0,1]로 가정하면 안 된다 — 벽에서 90도 틀린다.

    바닥만 있는 장면에서는 [0,0,1]이 참 법선과 거의 같아서 이 가정이 티가 나지
    않는다(바닥 전용 테스트는 상수 법선으로 바꿔도 전부 통과한다 — 변이 실험으로
    확인했다). 벽은 법선이 ±y라, 상수 법선을 쓰면 잔차가 벽면 **접선** 방향 표본
    이산화를 통째로 집어삼켜 RMSE가 게이트를 넘는다.

    바닥+벽은 실물 스캔에서 흔한 장면이고(스펙 §4.2 벽 처리), 면내 퇴화도 없다.
    """
    rng = np.random.default_rng(5)
    a = _floor_and_wall(301)
    b_local = _floor_and_wall(402)
    b = _apply(b_local, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, _NOISE_SD_M, b_local.shape)
    corr_dst = np.vstack([_surface(_CORR_XY[:3]),
                          np.array([[1.4, 0.0, 0.6], [6.3, 0.0, 1.9]])])   # 바닥 3 + 벽 2
    corr_src = _apply(corr_dst, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    res = register_clouds(b, a, corr_src, corr_dst)
    assert res.converged, res.failure_reason
    assert res.rmse_m <= _SPEC_MAX_RMSE_M, f"point-to-plane RMSE {res.rmse_m * 1000:.3f}mm"


def test_half_overlap_meets_z_gate_and_reports_partial_overlap():
    """스펙 §9.3이 명시한 조건 그대로: 노이즈 1mm + 중첩 50%.

    비중첩 구간이 해를 끌고 가지 않는지(트리밍의 존재 이유)를 본다.
    """
    rng = np.random.default_rng(23)
    a, b_world, picks = _split_pair(overlap_m=4.0, seed=6, total_x=16.0)
    b = _apply(b_world, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, _NOISE_SD_M, b_world.shape)
    res = register_clouds(b, a, _apply(picks, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M), picks)
    assert res.converged, res.failure_reason
    assert 0.1 <= res.overlap_ratio < 1.0, f"부분 중첩 비율 {res.overlap_ratio:.3f}"
    _yaw, _inplane, z_err = _errors(res)
    assert abs(z_err) <= 0.001, f"z 오차 {z_err * 1000:.3f}mm"


def test_trimming_rejects_ghost_layer_outliers():
    """유령층(이동 물체) 15%가 섞여도 z 평행이동이 끌려가지 않는다.

    유령층은 max_pair_dist_m(0.5m) 안이라 거리 필터로는 안 걸러진다.
    trimmed ICP가 거리 상위 20%를 버리는 것이 유일한 방어선이다.
    """
    a, b, cs, cd = _scan_pair(click_sd=0.0)
    rng = np.random.default_rng(31)
    b = b.copy()
    b[rng.random(len(b)) < 0.15, 2] += 0.25            # 25cm 위에 뜬 유령층
    res = register_clouds(b, a, cs, cd)
    # z를 먼저 본다: 트리밍이 죽으면 z가 유령층 쪽으로 끌려가는 것이 핵심 증상이고,
    # converged를 먼저 단언하면 RMSE 게이트가 그 증상을 가려버린다.
    _yaw, _inplane, z_err = _errors(res)
    assert abs(z_err) <= 0.001, f"유령층에 끌려간 z 오차 {z_err * 1000:.3f}mm"
    assert res.converged, res.failure_reason


def test_low_overlap_fails_instead_of_pretending_success():
    """중첩 10% 미만이면 성공을 가장하지 않고 실패로 끝난다 (스펙 §9.3 유지).

    중첩 뒤에 빈 띠(gap)를 둬서 **RMSE는 게이트 안에 둔다**. 그래야 중첩 가드를
    없앴을 때 `converged`가 실제로 True로 뒤집히고, 가드가 유일한 방어선임을
    증명할 수 있다. gap이 없으면 경계 근처의 엉터리 대응이 RMSE를 키워서
    RMSE 게이트가 대신 실패시켜버리고, 가드 제거가 사유 문구로만 드러난다.
    """
    a, b_world, picks = _split_pair(overlap_m=0.5, seed=4, total_x=24.0, gap_m=1.0)
    b = _apply(b_world, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    res = register_clouds(b, a, _apply(picks, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M), picks)
    assert res.overlap_ratio < 0.1, f"중첩 비율 {res.overlap_ratio:.3f}"
    assert res.rmse_m <= _SPEC_MAX_RMSE_M, f"이 픽스처는 RMSE가 게이트 안이어야 한다: {res.rmse_m * 1000:.3f}mm"
    assert not res.converged
    assert res.failure_reason is not None
    assert "중첩" in res.failure_reason


def test_fewer_than_three_correspondences_is_rejected():
    a = bumpy_floor(size=(4.0, 3.0), seed=5)
    with pytest.raises(ValueError, match="대응점"):
        register_clouds(a, a, a[:2], a[:2])


# --- 실패 방향 테스트 (게이트를 통과 방향으로만 단언하면 무력화를 못 잡는다) -----

def test_spec_rmse_threshold_is_two_millimetres():
    """스펙 §4.4의 임계값 자체를 고정한다.

    게이트 테스트가 구현 상수를 참조하면 상수를 키우는 변이에 단언이 함께 끌려가
    게이트가 사실상 사라져도 초록불이 된다.
    """
    assert reg.MAX_RMSE_M == _SPEC_MAX_RMSE_M
    assert reg.MIN_OVERLAP_RATIO == 0.1


def test_one_metre_horizontal_misalignment_is_reported_as_failure():
    """수평 1m 어긋난 자세는 성공으로 나가면 안 된다 — **RMSE 게이트가 잡아야 한다**.

    사유가 RMSE임을 함께 단언한다. 통과 방향만 보면 `rmse_m`을 0으로 만드는 변이가
    모든 실패를 성공으로 뒤집어도 아무 테스트가 울지 않는다(실제로 그런 변이가
    17건을 전부 통과했다).

    **한계 기록:** 이 테스트가 성립하는 것은 바닥에 범프가 있기 때문이다. 완전
    평면에서는 3m를 밀어도 point-to-plane 잔차가 1.006mm로 그대로다 — 수평
    어긋남을 원리적으로 볼 수 없다(스펙 §9.3.1). 아래 발산 가드가 그 사각의
    일부(대상 표면 밖으로 벗어나는 경우)를 덮는다.
    """
    a, b, _cs, _cd = _scan_pair(click_sd=0.0)
    off = np.eye(4)
    off[0, 3] = 1.0                                   # 참값 위에 수평 1m를 얹는다
    res = icp_refine(b, a, off @ _expected())
    assert not res.converged
    assert res.failure_reason is not None
    assert "RMSE" in res.failure_reason, res.failure_reason
    assert res.rmse_m > _SPEC_MAX_RMSE_M


def test_divergence_guard_catches_a_cloud_beyond_the_target_edge():
    """대상 표면 **밖**에 떠 있는 점군을 잡는다 — point-to-plane이 못 보는 사각.

    수평면 가장자리 밖으로 밀린 점들은 변위가 접선 방향이라 법선 성분이 0이다.
    실측: point-to-plane **0.000mm**, 중첩 **0.800** — RMSE 게이트도 중첩 가드도
    통과한다. point-to-point 잔차만 표본 간격의 1.6배로 튄다. 발산 가드가 유일한
    방어선이므로, 다른 두 게이트가 **울지 않았다는 것까지** 함께 단언한다.
    그러지 않으면 `max_iterations=1`이 만드는 "수렴 못 함" 사유에 가려 가드를
    없애도 `converged=False`가 유지된다.

    `max_iterations=1`은 의도적이다 — **주어진 자세를 평가**하는 가드를 보는
    테스트이기 때문이다. 그대로 두면 ICP가 점군을 표면 위로 끌어와 자세 자체가
    사라진다(실측: 45회 만에 p2p 0.63배로 수렴). 이 가드가 수렴한 결과에서 실제로
    울린 경우는 아직 관측하지 못했다(보고서 §9 참고).
    """
    def plane(x0, x1, sample_seed, spacing=0.05):
        rng = np.random.default_rng(sample_seed)
        gx, gy = np.meshgrid(np.arange(x0, x1 + spacing / 2, spacing),
                             np.arange(0.0, 6.0 + spacing / 2, spacing))
        gx = gx + rng.uniform(-spacing / 2, spacing / 2, gx.shape)
        gy = gy + rng.uniform(-spacing / 2, spacing / 2, gy.shape)
        return np.column_stack([gx.ravel(), gy.ravel(), np.zeros(gx.size)])

    dst = plane(0.0, 8.0, 1)
    src = plane(8.2, 8.4, 3)                          # dst 가장자리 밖 0.2~0.4m
    res = icp_refine(src, dst, np.eye(4), max_iterations=1)
    assert res.rmse_m <= _SPEC_MAX_RMSE_M, f"이 픽스처는 point-to-plane이 깨끗해야 한다: {res.rmse_m}"
    assert res.overlap_ratio >= 0.1, f"중첩 가드도 통과해야 한다: {res.overlap_ratio}"
    assert res.point_rmse_m > 1.5 * res.sample_spacing_m
    assert not res.converged
    reason = res.failure_reason or ""
    assert "발산" in reason, reason
    assert "RMSE" not in reason, f"이 픽스처에서 RMSE 게이트는 울면 안 된다: {reason}"
    assert "중첩" not in reason, f"이 픽스처에서 중첩 가드는 울면 안 된다: {reason}"


def test_collinear_correspondences_are_rejected():
    """스펙 §8: 공선 대응점은 거부하고 한국어 사유를 준다."""
    a, b, _cs, _cd = _scan_pair(click_sd=0.0)
    line = np.array([[1.0, 1.0, 0.0], [2.5, 1.0, 0.0], [4.0, 1.0, 0.0]])
    with pytest.raises(ValueError, match="공선"):
        register_clouds(b, a, _apply(line, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M), line)


def test_correspondences_clustered_in_a_small_patch_are_rejected():
    """근접 3점(2cm 안)은 거부한다 — ICP로는 못 고치는 오정합의 실제 트리거.

    실측: 이 배치로 초기 Umeyama가 이미 yaw 89도·면내 5.3m로 틀어진다. 판별식이
    없으면 7m 어긋난 정합이 성공으로 나갈 수 있다. 공선성만 봐서는 못 잡는다 —
    이 배치의 sv1/sv0은 0.98로 오히려 정상 4점(0.67)보다 크다. 퍼짐을 따로 본다.
    """
    a, b, _cs, _cd = _scan_pair(click_sd=0.0)
    near = _surface(np.array([[3.00, 2.00], [3.02, 2.00], [3.01, 2.017]]))
    with pytest.raises(ValueError, match="몰려 있"):
        register_clouds(b, a, _apply(near, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M), near)


def _plane_gradient(pts):
    """점군의 전역 평면 기울기 (dz/dx, dz/dy). 픽스처에 구배가 실제로 들어갔는지 잰다."""
    coef, *_ = np.linalg.lstsq(np.c_[pts[:, 0], pts[:, 1], np.ones(len(pts))], pts[:, 2], rcond=None)
    return float(coef[0]), float(coef[1])


def _ramp_scan_pair(slope):
    """구배 램프를 얹은 표본 독립 스캔 쌍 + 표면에서 뽑은 대응점."""
    rng = np.random.default_rng(7)
    a = bumpy_floor(size=_SIZE, seed=_SURF_SEED, sample_jitter=0.025, sample_seed=101, slope=(slope, 0.0))
    b_local = bumpy_floor(size=_SIZE, seed=_SURF_SEED, sample_jitter=0.025, sample_seed=202, slope=(slope, 0.0))
    b = _apply(b_local, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, _NOISE_SD_M, b_local.shape)
    corr_dst = np.column_stack([_CORR_XY, bumpy_surface_z(_CORR_XY[:, 0], _CORR_XY[:, 1],
                                                          size=_SIZE, seed=_SURF_SEED)
                                + slope * _CORR_XY[:, 0]])
    corr_src = _apply(corr_dst, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, _CLICK_SD_M, corr_dst.shape)
    return a, b, corr_src, corr_dst


def test_z_gate_holds_across_the_documented_slope_range():
    """구배 2% 램프에서도 z 게이트(<=1mm)가 성립한다 — 적용 범위의 상한 근처.

    ★ **구배가 실제로 걸렸다는 것을 먼저 단언한다.** 게이트만 보면 안 된다:
    구배 2%의 z 오차는 0.611mm, 0%는 0.008mm로 **둘 다 <=1mm에 들어가서** 픽스처에서
    구배를 조용히 떨어뜨려도 통과해 버린다. 이 프로젝트가 일곱 번 겪은 형태이고,
    하필 "게이트가 실질 평탄 바닥에서만 검증됐다"를 닫으려고 만든 테스트다.
    그래서 (1) 픽스처 기울기를 직접 재고 (2) 0% 대비 z 오차가 자릿수로 커지는지도 본다.
    """
    slope = 0.02
    a, b, cs, cd = _ramp_scan_pair(slope)

    gx, gy = _plane_gradient(a)
    assert abs(gx - slope) <= 0.002, f"픽스처 x 기울기가 {gx * 100:.3f}% (기대 {slope * 100:.1f}%)"
    assert abs(gy) <= 0.005, f"y 기울기가 의도치 않게 {gy * 100:.3f}%"

    res = register_clouds(b, a, cs, cd)
    assert res.converged, res.failure_reason
    _yaw, _inplane, z_err = _errors(res)
    assert abs(z_err) <= 0.001, f"구배 {slope * 100:.0f}%에서 z 오차 {z_err * 1000:.3f}mm"

    fa, fb, fcs, fcd = _ramp_scan_pair(0.0)
    _y0, _ip0, z0 = _errors(register_clouds(fb, fa, fcs, fcd))
    assert abs(z_err) >= 10 * abs(z0), (
        f"구배 2%의 z 오차({z_err * 1000:.4f}mm)가 0%({z0 * 1000:.4f}mm)와 자릿수가 같다 "
        "— 픽스처에 구배가 실제로 반영되지 않았을 수 있다")


def test_long_corridor_correspondences_are_accepted():
    """150m x 2.5m 복도처럼 **가늘고 긴** 현장을 거부하면 안 된다.

    무차원 비(sv1/sv0)로 판별하면 이 배치가 0.016으로 걸려 거부된다. 그런데 실제로
    정합하면 면내 오차가 37.5mm로 정상 4점 배치(44.7mm)보다 **오히려 좋다** —
    측방 퍼짐이 1.0m로 클릭 오차(5cm)의 20배이기 때문이다. 스케일 의존 판별식이
    물리적으로 더 나쁜 배치를 통과시키고 더 좋은 배치를 거부한 셈이다.
    """
    size = (150.0, 2.5)
    rng = np.random.default_rng(7)
    a = bumpy_floor(size=size, spacing=0.05, seed=_SURF_SEED, sample_jitter=0.025, sample_seed=101)
    b_local = bumpy_floor(size=size, spacing=0.05, seed=_SURF_SEED, sample_jitter=0.025, sample_seed=202)
    b = _apply(b_local, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, _NOISE_SD_M, b_local.shape)
    cxy = np.array([[4.5, 0.20], [139.5, 0.30], [19.5, 2.30], [130.5, 2.20]])
    corr_dst = np.column_stack([cxy, bumpy_surface_z(cxy[:, 0], cxy[:, 1], size=size, seed=_SURF_SEED)])
    corr_src = _apply(corr_dst, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, _CLICK_SD_M, corr_dst.shape)

    lateral, sv = reg.correspondence_lateral_spread(corr_dst)
    assert lateral > 0.5, f"측방 퍼짐 {lateral:.3f}m"
    assert sv[1] / sv[0] < 0.02, (
        f"이 픽스처는 무차원 비가 작아야 회귀 가드로 쓸모가 있다: {sv[1] / sv[0]:.4f}")

    res = register_clouds(b, a, corr_src, corr_dst)
    assert res.converged, res.failure_reason
    _yaw, inplane, z_err = _errors(res)
    assert abs(z_err) <= 0.001, f"z 오차 {z_err * 1000:.3f}mm"
    assert inplane <= 0.050, f"면내 오차 {inplane * 1000:.1f}mm"


def test_horizontal_sensitivity_flags_a_featureless_plane():
    """수평 방향으로 **검증 불가**한 장면을 신호로 알린다 (스펙 §9.3.2).

    완전 평면은 몇 미터가 어긋나도 point-to-plane 잔차가 그대로다. 사각을 막지는
    못하지만 사각임을 보고할 수는 있다 — 지금까지는 아무 신호 없이 성공으로 나갔다.
    범프가 있으면 감도가 올라간다는 대비까지 함께 고정한다.
    """
    fa, fb, fcs, fcd = _scan_pair(click_sd=0.0, flat=True)
    flat = register_clouds(fb, fa, fcs, fcd)
    ba, bb, bcs, bcd = _scan_pair(click_sd=0.0)
    bumpy = register_clouds(bb, ba, bcs, bcd)

    assert flat.horizontal_sensitivity < reg.HORIZONTAL_SENSITIVITY_MIN, (
        f"완전 평면 감도 {flat.horizontal_sensitivity:.3f} — 검증 불가로 표시돼야 한다")
    assert bumpy.horizontal_sensitivity >= reg.HORIZONTAL_SENSITIVITY_MIN, (
        f"범프 바닥 감도 {bumpy.horizontal_sensitivity:.3f} — 정상으로 표시돼야 한다")
    # 사각은 rmse_m으로는 전혀 드러나지 않는다: 두 장면의 RMSE가 사실상 같다
    assert abs(flat.rmse_m - bumpy.rmse_m) < 0.0002, "RMSE만으로는 두 장면이 구분되지 않는다"


def test_iteration_budget_exhaustion_is_reported_as_failure():
    """반복을 다 못 쓰면 실패로 보고한다 — 수렴 게이트가 유일한 방어선인 구간.

    반복 3회에서 RMSE·중첩·발산 게이트는 전부 통과하므로, 수렴 사유를 지우면
    `converged`가 조용히 True로 뒤집힌다. 다른 사유가 없다는 것까지 단언한다.
    """
    a, b, cs, cd = _scan_pair(click_sd=_CLICK_SD_M)
    res = register_clouds(b, a, cs, cd, max_iterations=3)
    assert not res.converged
    reason = res.failure_reason or ""
    assert "수렴" in reason, reason
    assert "RMSE" not in reason, reason
    assert "중첩" not in reason, reason
    assert "발산" not in reason, reason


def test_result_reports_point_rmse_and_sample_spacing():
    """발산 가드의 근거값이 결과에 실려 나온다(Task 4가 저장·표시할 수 있게)."""
    a, b, cs, cd = _scan_pair(click_sd=0.0)
    res = register_clouds(b, a, cs, cd)
    assert 0.02 < res.sample_spacing_m < 0.06, res.sample_spacing_m
    assert res.point_rmse_m > res.rmse_m, "표본이 독립이면 point-to-point가 더 커야 한다"
    assert res.point_rmse_m < 1.5 * res.sample_spacing_m


# --- 퇴화 픽스처 회귀 가드 (스펙 §9.3.1 부수 발견 1) --------------------------

def test_scan_pair_fixture_does_not_share_sample_points():
    """정합 픽스처의 두 스캔이 **같은 점을 공유하면 안 된다**.

    공유하면 최근접점 탐색이 늘 '같은 점'을 찾아 정합이 실제보다 훨씬 쉬워지고,
    바닥을 완전 평면으로 바꿔도 결과가 자릿수까지 같아진다(아래 테스트).
    `_scan_pair`를 1:1 동일점으로 되돌리면 이 가드가 먼저 깨진다.
    """
    a, b, _cs, _cd = _scan_pair(click_sd=0.0)
    truth_aligned = (np.c_[b, np.ones(len(b))] @ _expected().T)[:, :3]
    d, _ = cKDTree(a).query(truth_aligned)
    assert np.median(d) > 0.005, (
        f"참값으로 정렬했는데 최근접점 거리 중앙값이 {np.median(d) * 1000:.3f}mm뿐이다 "
        "— 두 스캔이 같은 점을 쓰고 있다")


def test_identical_point_fixture_recovers_in_plane_even_on_a_featureless_plane():
    """완전 평면인데도 면내가 '회복'되면, 그 정확도는 표면이 아니라 점 동일성에서 온다.

    수평 평면은 면내 2자유도에 대한 정보를 원리적으로 갖고 있지 않다. 그런데 점이
    1:1로 동일한 픽스처에서는 면내 오차가 mm 아래로 떨어진다 — 최근접점이 늘 '같은
    점'을 찾기 때문이다. 표본을 독립으로 바꾸면 같은 평면에서 수십 mm가 남는다.

    이 대비를 고정해 둬서, 정합 테스트를 1:1 픽스처로 되돌리면 무엇을 잃는지가
    코드로 남게 한다(스펙 §9.3.1 부수 발견 1).
    """
    ia, ib, ics, icd = _scan_pair(click_sd=_CLICK_SD_M, identical_points=True, flat=True)
    _y, ident_inplane, _z = _errors(register_clouds(ib, ia, ics, icd))
    da, db, dcs, dcd = _scan_pair(click_sd=_CLICK_SD_M, flat=True)
    _y2, indep_inplane, _z2 = _errors(register_clouds(db, da, dcs, dcd))
    assert ident_inplane <= 0.001, (
        f"1:1 픽스처 면내 {ident_inplane * 1000:.3f}mm — 이 퇴화가 사라졌으면 §9.3.1을 갱신해야 한다")
    assert indep_inplane >= 0.010, (
        f"표본 독립 면내 {indep_inplane * 1000:.3f}mm — 평면의 면내 퇴화가 "
        "사라졌으면 §9.3.1을 갱신해야 한다")


# --- 서브셀 격자 -> 점군 ------------------------------------------------------

def test_grid_to_points_drops_nan_subcells_and_uses_cell_centers():
    """좌표 **집합 전체**를 기대값과 대조한다.

    min/개수만 보면 ix/iy를 뒤바꾼 구현이 정사각 격자에서 통과해 버린다.
    (비정사각 격자의 IndexError로만 잡히는 것은 우연에 기댄 것이다.)
    아래 정사각 격자 테스트가 그 우연을 제거한다.
    """
    grid = _grid_with_one_nan()
    ny, nx = grid.shape
    expect = {(round(grid.origin[0] + (ix + 0.5) * grid.size_m, 9),
               round(grid.origin[1] + (iy + 0.5) * grid.size_m, 9),
               round(float(grid.median_z[iy, ix]), 9))
              for iy in range(ny) for ix in range(nx) if np.isfinite(grid.median_z[iy, ix])}
    got = {(round(x, 9), round(y, 9), round(z, 9)) for x, y, z in grid_to_points(grid)}
    assert got == expect


def test_grid_to_points_keeps_x_and_y_distinct_on_a_square_grid():
    """정사각 격자에서도 ix/iy 전치를 잡는다 — z를 좌표에 묶어 대조한다."""
    z = np.array([[0.011, 0.013, 0.009],
                  [0.012, 0.017, 0.010],
                  [0.008, 0.016, 0.014]], dtype=np.float32)
    grid = SubcellGrid(size_m=0.05, origin=np.array([12.3, -4.7]), shape=z.shape,
                       median_z=z, counts=np.full(z.shape, 7, dtype=np.int32),
                       bimodal=np.zeros(z.shape, dtype=bool))
    expect = {(round(12.3 + (ix + 0.5) * 0.05, 9), round(-4.7 + (iy + 0.5) * 0.05, 9),
               round(float(z[iy, ix]), 9))
              for iy in range(3) for ix in range(3)}
    got = {(round(x, 9), round(y, 9), round(zz, 9)) for x, y, zz in grid_to_points(grid)}
    assert got == expect

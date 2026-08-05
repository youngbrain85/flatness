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

from flatness.core.registration import (
    MAX_RMSE_M, umeyama_rigid, register_clouds, grid_to_points,
)
from flatness.core.subcell import SubcellGrid
from tests.fixtures.synthetic import bumpy_floor, bumpy_surface_z

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
    assert res.rmse_m <= MAX_RMSE_M, f"point-to-plane RMSE {res.rmse_m * 1000:.3f}mm"
    point_rmse = _trimmed_point_rmse(a, _aligned(b, res))
    assert point_rmse > 5 * MAX_RMSE_M, (
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
    assert res.rmse_m <= MAX_RMSE_M, f"point-to-plane RMSE {res.rmse_m * 1000:.3f}mm"


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
    assert res.rmse_m <= MAX_RMSE_M, f"이 픽스처는 RMSE가 게이트 안이어야 한다: {res.rmse_m * 1000:.3f}mm"
    assert not res.converged
    assert res.failure_reason is not None
    assert "중첩" in res.failure_reason


def test_fewer_than_three_correspondences_is_rejected():
    a = bumpy_floor(size=(4.0, 3.0), seed=5)
    with pytest.raises(ValueError, match="대응점"):
        register_clouds(a, a, a[:2], a[:2])


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
    grid = _grid_with_one_nan()
    pts = grid_to_points(grid)
    assert np.isfinite(pts).all()
    assert len(pts) == int(np.isfinite(grid.median_z).sum())
    # 셀 중심인가: origin + (i+0.5)*size_m
    assert np.isclose(pts[:, 0].min(), grid.origin[0] + 0.5 * grid.size_m)
    assert np.isclose(pts[:, 1].min(), grid.origin[1] + 0.5 * grid.size_m)

"""국부(1m, 스펙 §8)·전체 기준면(2026-10-20 바닥 기준면 개선 스펙 §2)."""
import numpy as np

from tests.fixtures.synthetic import add_bump, flat_floor
from tests.test_subcell import _grid
from flatness.core.zones import build_zones
from flatness.core.reference import global_plane, local_reference, noise_sigma


def _ok(zmap):
    return {z.zone_id: z.plane_abc for z in zmap.zones if z.status == "ok"}


def _sag(depth=0.010, size=8.0, seed=2):
    p = flat_floor(size=(size, size), spacing=0.025, noise_sd=0.0005, seed=seed)
    x, y = p[:, 0], p[:, 1]
    h = size / 2
    p[:, 2] -= depth * (1 - ((x - h) / h) ** 2) * (1 - ((y - h) / h) ** 2)
    return p


def _local_res(p, **kw):
    g = _grid(p)
    zmap, zone_res = build_zones(g, **kw)
    ref, sigma = local_reference(g.median_z, zmap.labels, _ok(zmap), g.size_m, fit_mask=~g.bimodal)
    return g, zmap, zone_res, (g.median_z - ref) * 1000.0, sigma


def test_local_reference_removes_10mm_sag():
    # 구역 평면 하나로는 처짐이 그릇 모양 편차(−6.8 ~ +4.6mm, 실측)로 남는다. 국부 기준면은 이를 지운다
    _, _, zone_res, local_mm, _ = _local_res(_sag())
    assert np.nanmax(np.abs(zone_res)) * 1000 > 4.0
    assert np.nanmax(np.abs(local_mm)) < 2.5


def test_local_window_is_1m_so_a_2_4m_wave_is_absorbed():
    # 국부 창은 1m(스펙 §8 사용자 결정). 파장 2.4m·진폭 3mm 물결은 1m 창 평면이 따라가 안쪽 칸 편차가 진폭의 약 26%
    # (0.8mm)만 남는다. 3m 창이면 창 평균이 물결 반대 부호가 되어 진폭보다 큰 약 3.5mm 가 남는다(이론값, 실측 3.76mm)
    p = flat_floor(size=(6.0, 3.0), spacing=0.02, noise_sd=0.0002, seed=5)
    p[:, 2] += 0.003 * np.sin(2 * np.pi * p[:, 0] / 2.4)
    g, _, _, local_mm, _ = _local_res(p)
    k = int(round(0.75 / g.size_m))
    inner = local_mm[k:-k, k:-k]
    assert np.isfinite(inner).mean() > 0.9
    assert np.nanmax(np.abs(inner)) < 1.2


def test_local_reference_keeps_a_10mm_depression():
    # 결함(반경 0.3m, 깊이 10mm)은 그대로 보인다
    _, _, _, local_mm, _ = _local_res(add_bump(_sag(), (2.0, 5.5), 0.3, -0.010))
    assert np.nanmin(local_mm) <= -9.0


def test_defect_does_not_drag_the_local_reference():
    # 함몰(반경 0.3m, 깊이 10mm. 1m 창 안에 드는 크기)이 있어도 그 자리 기준면은 결함 없는 바닥과 0.5mm 이내다(실측 0.23mm).
    # 2회차(결함 칸 빼고 다시 맞춤)가 없으면 함몰이 창 평균을 끌어내려 0.79mm 내려간다(실측). 창보다 넓은 함몰(반경 0.9m)은
    # 창이 통째로 함몰 안이라 기준면이 따라 내려간다(실측 4.8mm, 스펙 §8: 1m보다 넓은 결함은 전체 기준에서 본다)
    # 함몰이 bbox 최저 z 를 바꿔 격자 높이 전체가 밀리므로, 떨어진 바닥 칸의 차이(같은 점·같은 잡음)로 그 밀림을 뺀다
    def run(p):
        g = _grid(p)
        zmap, _ = build_zones(g)
        ref, _ = local_reference(g.median_z, zmap.labels, _ok(zmap), g.size_m, fit_mask=~g.bimodal)
        return g, ref
    base = flat_floor(size=(8.0, 8.0), spacing=0.025, noise_sd=0.0005, seed=4)
    gb, rb = run(base)
    gp, rp = run(add_bump(base, (4.0, 4.0), 0.3, -0.010))
    shift = np.nanmedian(gp.median_z[:20, :20] - gb.median_z[:20, :20])
    i = int(4.0 / gb.size_m)
    assert abs(rp[i, i] - rb[i, i] - shift) * 1000 < 0.5


def test_local_reference_falls_back_to_zone_plane_when_window_is_too_small():
    # 0.2x0.2m 판(서브셀 16칸): 1m 창 안 유효 칸이 30 미만이라 구역 평면 값을 쓴다
    p = flat_floor(size=(0.2, 0.2), spacing=0.005, tilt=(0.01, 0.02))
    g = _grid(p)
    zmap, _ = build_zones(g, min_area_m2=0.0)
    planes = _ok(zmap)
    ref, _ = local_reference(g.median_z, zmap.labels, planes, g.size_m, fit_mask=~g.bimodal)
    (zid, (a, b, c)), = planes.items()
    ys, xs = np.nonzero(zmap.labels == zid)
    expect = a * (xs + 0.5) * g.size_m + b * (ys + 0.5) * g.size_m + c
    assert np.allclose(ref[ys, xs], expect, atol=1e-9)
    assert np.isnan(ref[zmap.labels == 0]).all()


def test_local_reference_does_not_mix_zones():
    # 4x4m 바닥(z=0)을 두 변에서 감싸는 폭 0.6m 의 L자 낮은 띠(15cm 아래, 4cm 틈). 띠 칸의 창(1m)에 바닥 칸이 섞인다.
    # 창이 다른 구역 칸을 섞으면 1회차가 바닥 높이에 맞고 2회차가 띠 칸을 결함으로 빼 버려 띠 편차가 −150mm 가 된다
    floor = flat_floor(size=(4.0, 4.0), spacing=0.02)
    side = flat_floor(size=(0.6, 4.64), spacing=0.02) + np.array([4.04, 0.0, -0.15])
    top = flat_floor(size=(4.0, 0.6), spacing=0.02) + np.array([0.0, 4.04, -0.15])
    _, zmap, _, local_mm, _ = _local_res(np.vstack([floor, side, top]))
    assert len([z for z in zmap.zones if z.status == "ok"]) == 2
    assert np.nanmax(np.abs(local_mm)) < 1.0


def test_global_plane_reveals_a_step_between_zones():
    # 넓은 면(6x3m, z=0)과 좁은 면(2x3m, 15cm 아래): 전체 기준면은 넓은 면에 맞고 좁은 면은 −150mm 로 드러난다
    a = flat_floor(size=(5.98, 3.0), spacing=0.02)
    b = flat_floor(size=(2.0, 3.0), spacing=0.02)
    b[:, 0] += 6.02
    b[:, 2] -= 0.15
    g = _grid(np.vstack([a, b]))
    zmap, _ = build_zones(g)
    ok = (zmap.labels > 0) & ~g.bimodal
    ga, gb, gc = global_plane(g.median_z, ok, g.size_m, sigma=0.0005)
    ys, xs = np.nonzero(ok)
    res = (g.median_z[ys, xs] - (ga * (xs + 0.5) * g.size_m + gb * (ys + 0.5) * g.size_m + gc)) * 1000
    wide = xs * g.size_m < 5.5
    narrow = xs * g.size_m > 6.5
    assert np.abs(res[wide]).max() < 1.0
    assert abs(np.median(res[narrow]) + 150) < 2.0


def test_noise_sigma_is_robust_scale():
    rng = np.random.default_rng(0)
    r = rng.normal(0, 0.002, 20000)
    r[:500] = 0.05                       # 결함 2.5% 는 잡음 추정을 흔들지 못한다
    assert abs(noise_sigma(r) - 0.002) < 0.0002
    assert noise_sigma(np.array([np.nan, np.nan])) == 0.0


def test_global_plane_does_not_tilt_across_a_2cm_step():
    # 리뷰 실측(2026-10-20): 64% 가 z=0, 36% 가 −20mm 인 두 면. 인라이어 수만 세는 RANSAC 은 ±5mm 띠로 두 면을
    # 비스듬히 걸치는 평면(인라이어 8296 > 평탄면 8240)을 골라 평탄한 넓은 면이 −4.6~+13.9mm 로 기울어 보였다.
    # MSAC(절단 제곱 손실)는 한 면에 딱 붙는 평면을 고른다
    from flatness.core.subcell import SubcellGrid
    ny, nx = 80, 160
    yy, xx = np.mgrid[0:ny, 0:nx]
    mz = (np.where(xx < 103, 0.0, -0.02) + 0.0005 * np.sin(xx * 0.3)).astype(np.float32)
    g = SubcellGrid(0.05, np.zeros(2), (ny, nx), mz, np.full((ny, nx), 10, np.int32), np.zeros((ny, nx), bool))
    zmap, res = build_zones(g)
    ok = np.isfinite(res)
    a, b, c = global_plane(g.median_z, ok, g.size_m, sigma=0.0005)
    ys, xs = np.nonzero(ok)
    r = (g.median_z[ys, xs] - (a * (xs + 0.5) * 0.05 + b * (ys + 0.5) * 0.05 + c)) * 1000
    assert np.abs(r[xs < 103]).max() < 1.0
    assert abs(np.median(r[xs >= 103]) + 20) < 1.0


def test_degenerate_window_far_from_origin_falls_back_to_zone_plane():
    # 리뷰 실측: 폭 2칸 띠에서 한 열이 맞춤에서 빠지면(쌍봉 등) 창의 맞춤 칸이 한 열(일직선)이다. 절대 격자 좌표
    # (수십~수백 m)로 모멘트를 세면 cxx 가 0 이 아니라 부동소수 잡음이 되어 퇴화 판정을 빠져나가고, 기울기가 잡음/잡음이 된다.
    # 열 3000 근처(150m)·z 2.5m 에서도 퇴화로 보고 구역 평면 값을 써야 한다
    ny, nx = 61, 3010
    mz = np.full((ny, nx), np.nan)
    labels = np.zeros((ny, nx), dtype=np.int32)
    cols = [3000, 3001]
    yy = np.arange(ny)[:, None]
    for c in cols:
        mz[:, c] = 2.5 + 0.001 * (c + 0.5) * 0.05 + 0.002 * (yy[:, 0] + 0.5) * 0.05
        labels[:, c] = 1
    fit = np.ones((ny, nx), dtype=bool)
    fit[:, 3001] = False                         # 바깥 열은 맞춤에서 뺀다
    plane = (0.001, 0.002, 2.5)
    ref, _ = local_reference(mz, labels, {1: plane}, 0.05, fit_mask=fit)
    y = (np.arange(ny) + 0.5) * 0.05
    expect = plane[0] * (3001 + 0.5) * 0.05 + plane[1] * y + plane[2]
    assert np.allclose(ref[:, 3001], expect, atol=1e-6)


def test_banded_window_equals_whole(monkeypatch):
    # 큰 바닥은 행 띠로 나눠 계산한다(메모리). 띠 경계에서도 결과가 통째 계산과 같아야 한다
    from flatness.core import reference as R
    rng = np.random.default_rng(3)
    ny, nx = 150, 90
    yy, xx = np.mgrid[0:ny, 0:nx]
    mz = 0.001 * xx * 0.05 + 0.0005 * np.sin(yy * 0.2) + rng.normal(0, 0.0005, (ny, nx))
    labels = np.ones((ny, nx), dtype=np.int32)
    whole, _ = R.local_reference(mz, labels, {1: (0.001, 0.0, 0.0)}, 0.05)
    monkeypatch.setattr(R, "BAND_ROWS", 10)
    banded, _ = R.local_reference(mz, labels, {1: (0.001, 0.0, 0.0)}, 0.05)
    assert np.allclose(banded, whole, atol=1e-9)

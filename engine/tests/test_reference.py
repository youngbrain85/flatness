"""국부(1m, 스펙 §8)·전체 기준면(2026-10-20 바닥 기준면 개선 스펙 §2)."""
import numpy as np

from tests.fixtures.synthetic import add_bump, flat_floor
from tests.test_subcell import _grid
from flatness.core.zones import build_zones
from flatness.core.reference import cell_noise_sigma, global_plane, local_reference


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


def _recess_depth(x, y, depth=0.020, box=(0.2, 1.0, 0.2, 0.8), wall=0.1):
    """평평한 바닥의 오목부 깊이. box = 바깥 경계(x0, x1, y0, y1), 벽은 wall 폭 경사(이웃 칸 높이차 1.5cm 이하라
    한 구역), 그 안은 depth 만큼 평평하게 낮다. 기본값은 1.2x1.0m 판 가운데 0.8x0.6m(면적 40%) 오목부(운영 시험판
    FF-TestBoard Case 3 의 가운데 오목부 모양)."""
    x0, x1, y0, y1 = box
    d = np.minimum(np.minimum(x - x0, x1 - x), np.minimum(y - y0, y1 - y))
    return depth * np.clip(d / wall, 0.0, 1.0)


def test_large_recess_does_not_pull_the_reference_off_the_flat_surface():
    # 운영 시험판 실측(2026-10-20): 가운데 오목부가 면적 42% 라 1회차 평면 잔차 MAD 로 잰 σ 가 9.1mm 로 부풀어
    # 결함 문턱(3σ)이 27mm 가 되었다. 2회차 맞춤도 전체 MSAC 도 아무것도 거르지 못해 기준면이 테두리(+5~+10)와
    # 오목부(−7~−14) 사이 평균 평면이 되었다. 구역 RANSAC 평면(5mm)은 테두리에 맞았다.
    # 기준면은 평평한 테두리에 붙고 오목부는 −20mm 로 드러나야 한다. 실측: 테두리 최대 0.82mm·바닥 −19.98mm.
    # 결함 칸을 빼고 맞추기를 1회만 하면 덜 붙는다
    p = flat_floor(size=(1.2, 1.0), spacing=0.02, noise_sd=0.0005, seed=6)
    p[:, 2] -= _recess_depth(p[:, 0], p[:, 1])
    g, zmap, _, local_mm, sigma = _local_res(p)
    assert sigma < 0.002
    ny, nx = g.median_z.shape
    cy, cx = (np.mgrid[0:ny, 0:nx] + 0.5) * g.size_m
    rim = ((cx < 0.15) | (cx > 1.05) | (cy < 0.15) | (cy > 0.85)) & np.isfinite(local_mm)
    bottom = (cx > 0.35) & (cx < 0.85) & (cy > 0.35) & (cy < 0.65) & np.isfinite(local_mm)
    assert np.abs(local_mm[rim]).max() < 1.0
    assert abs(np.median(local_mm[bottom]) + 20.0) < 0.4
    floor = np.isfinite(local_mm)
    a, b, c = global_plane(g.median_z, floor, g.size_m, sigma)
    glob_mm = (g.median_z - (a * cx + b * cy + c)) * 1000
    assert np.abs(glob_mm[rim]).max() < 1.5
    assert abs(np.median(glob_mm[bottom]) + 20.0) < 1.5


def test_recess_wider_than_half_the_window_is_not_followed_from_an_average_start():
    # 3x3m 바닥 가운데 1.0x1.0m 오목부(벽 20cm, 깊이 20mm): 1m 창이 오목부 가장자리에 걸치면 창의 평균 평면에서 출발한
    # 결함 빼기는 벽 칸을 남겨 기준면이 오목부로 끌려 내려간다(실측 바닥 −18.12mm, 오목부 둘레 테두리 오차 1.70mm).
    # 창 안에서 더 많은 칸과 맞는 출발 후보(여기서는 구역 평면)를 고르면 −19.07mm·1.38mm
    p = flat_floor(size=(3.0, 3.0), spacing=0.02, noise_sd=0.0005, seed=8)
    box = (1.0, 2.0, 1.0, 2.0)
    p[:, 2] -= _recess_depth(p[:, 0], p[:, 1], box=box, wall=0.2)
    g, _, _, local_mm, _ = _local_res(p)
    ny, nx = g.median_z.shape
    cy, cx = (np.mgrid[0:ny, 0:nx] + 0.5) * g.size_m
    out = np.maximum(np.maximum(box[0] - cx, cx - box[1]), np.maximum(box[2] - cy, cy - box[3]))
    inside = np.minimum(np.minimum(cx - box[0], box[1] - cx), np.minimum(cy - box[2], box[3] - cy))
    rim = (out > 0.05) & (out < 0.4) & np.isfinite(local_mm)
    assert np.nanmedian(local_mm[inside > 0.25]) <= -18.6
    assert np.abs(local_mm[rim]).max() < 1.6


def test_small_board_off_center_recess_stays_on_the_rim():
    # 43cm 판(9x9칸) 아래쪽 오목부(면적 35%, 벽 6cm, 깊이 20mm). 출발점이 테두리와 오목부 사이에 놓이면 벽 칸이 남아
    # 국부 기준면이 기울었다(리뷰 실측: 25cm 블록 중앙값 출발 테두리 최대 4.78mm·바닥 −17.5mm, 창 평균 출발 5.66mm).
    # 창 안 문턱 이내 칸이 더 많은 출발 후보(여기서는 구역 평면)를 고르면 테두리에 붙는다
    p = flat_floor(size=(0.43, 0.43), spacing=0.01, noise_sd=0.0005, seed=6)
    box = (0.035, 0.395, 0.03, 0.24)
    p[:, 2] -= _recess_depth(p[:, 0], p[:, 1], box=box, wall=0.06)
    g = _grid(p)
    zmap, _ = build_zones(g, min_area_m2=0.0, max_zones=1, max_rounds=1)
    main = max((z for z in zmap.zones if z.status == "ok"), key=lambda z: z.n_subcells)
    labels = np.where(zmap.labels == main.zone_id, zmap.labels, 0)
    ref, _ = local_reference(g.median_z, labels, {main.zone_id: main.plane_abc}, g.size_m, fit_mask=~g.bimodal)
    ny, nx = g.median_z.shape
    cy, cx = (np.mgrid[0:ny, 0:nx] + 0.5) * g.size_m
    truth = -_recess_depth(cx, cy, box=box, wall=0.06) * 1000
    local_mm = (g.median_z - ref) * 1000
    fl = labels > 0
    assert np.abs(local_mm[fl & (truth > -0.01)]).max() < 1.0
    assert abs(np.median(local_mm[fl & (truth < -19.99)]) + 20.0) < 1.0


def test_steep_ramp_end_left_in_the_zone_does_not_drop_to_the_zone_plane():
    # 6x4m 평탄 바닥 + x=4m 부터 10% 램프: 밴드(5cm) 안 램프 끝이 주 구역에 남는다. 출발점이 램프 끝을 따라가지 못하면
    # (구역 평면, 안쪽으로 치우친 25cm 블록 중앙값) 1회차 칸이 모자라 구역 평면으로 떨어졌다(실측 최대 47mm,
    # 창 평균 출발은 13~19mm)
    p = flat_floor(size=(6.0, 4.0), spacing=0.02, noise_sd=0.0005, seed=11)
    p[:, 2] += 0.10 * np.clip(p[:, 0] - 4.0, 0, None)
    _, _, _, local_mm, _ = _local_res(p)
    assert np.nanmax(np.abs(local_mm)) < 20.0


def test_cell_noise_sigma_ignores_tilt_sag_and_a_large_defect():
    # 칸 높이 잡음은 이웃 칸 2차 차분으로 잰다: 기울기는 0, 완만한 휨은 거의 0, 넓은 결함은 벽 칸에만 걸린다
    rng = np.random.default_rng(0)
    ny, nx = 60, 80
    cy, cx = (np.mgrid[0:ny, 0:nx] + 0.5) * 0.05
    z = 0.01 * cx - 0.010 * np.sin(np.pi * cx / 4.0) * np.sin(np.pi * cy / 3.0)
    z = z - _recess_depth(cx / 4.0 * 1.2, cy / 3.0 * 1.0, 0.03) + rng.normal(0, 0.002, (ny, nx))
    mask = np.ones((ny, nx), dtype=bool)
    mask[10:15, 20:30] = False                  # 가린 칸(쌍봉·구역 밖)은 세지 않는다: 큰 값을 넣어도 흔들리지 않는다
    z[10:15, 20:30] = rng.normal(0, 0.05, (5, 10))
    assert abs(cell_noise_sigma(z, mask) - 0.002) < 0.0002
    assert cell_noise_sigma(z, np.zeros((ny, nx), dtype=bool)) == 0.0
    # 세 칸이 모두 유효해야 센다: 가운데가 가려진 세 칸, 한 줄 두 칸뿐이면 2차 차분이 없다
    line = np.array([[0.0, 9.0, 0.0]])
    assert cell_noise_sigma(line, np.array([[True, False, True]])) == 0.0
    assert cell_noise_sigma(line[:, :2], np.ones((1, 2), dtype=bool)) == 0.0


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

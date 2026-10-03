"""3D 점군 뷰어용 점 표본(core/pointsample.py) 테스트.

손으로 만든 grid·zmap·residuals 위에서 함수를 하나씩 본다. 픽스처 격자는 비정방(3행 x 5열)이고
서브셀마다 값이 달라서 x·y 를 바꿔 쓰는 실수가 IndexError 나 값 불일치로 드러난다.
"""
import numpy as np
from flatness.core import pointsample as ps
from flatness.core.subcell import SubcellGrid, build_subcell_grid
from flatness.core.zones import ZoneInfo, ZoneMap
from flatness.io.reader import CloudInfo
import math
import struct

import pytest
from flatness.core.levels import detect_levels
from flatness.core.zones import build_zones
from tests.fixtures.synthetic import flat_floor, add_bump

NY, NX = 3, 5      # 비정방 격자(행 = y, 열 = x)
SIZE_M = 0.05      # 서브셀 변(m)


def _hand_fixture():
    """전부 ok 구역(1번)·중앙값 유한·잔차 유한인 기준 픽스처. 각 테스트가 필요한 칸만 바꿔 쓴다.

    잔차[iy, ix]   = (10 * iy + ix + 1) * 0.1mm  -> 기대 dev_q = 10 * iy + ix + 1 (칸마다 다르다)
    중앙값[iy, ix] = 0.20 + 0.01 * iy + 0.001 * ix (m)
    """
    iy, ix = np.mgrid[0:NY, 0:NX]
    residuals = ((10 * iy + ix + 1) * 1e-4).astype(np.float32)
    median_z = (0.20 + 0.01 * iy + 0.001 * ix).astype(np.float32)
    grid = SubcellGrid(size_m=SIZE_M, origin=np.zeros(2), shape=(NY, NX), median_z=median_z,
                       counts=np.full((NY, NX), 5, dtype=np.int32),
                       bimodal=np.zeros((NY, NX), dtype=bool))
    zmap = ZoneMap(labels=np.ones((NY, NX), dtype=np.int32),
                   zones=[ZoneInfo(1, 0.2, NY * NX, NY * NX * SIZE_M * SIZE_M, "ok", (0.0, 0.0, 0.2))])
    return grid, zmap, residuals


# ---- 상수 ----

def test_constants_match_file_format_contract():
    # 죽이는 변이: 두 센티널 값 교환, 유효 범위가 센티널을 침범(DEV_MIN = -32767), 단위·상한 오타
    assert ps.MAX_POINTS == 500_000
    assert ps.OFF_SURFACE_M == 0.05
    assert ps.DEV_UNIT_M == 1e-4
    assert 1.0 / ps.DEV_UNIT_M == 10000.0       # _deviation_q 가 잔차(m)에 곱하는 수
    assert ps.DEV_NOT_FLOOR == -32768
    assert ps.DEV_NO_DEVIATION == -32767
    assert (ps.DEV_MIN, ps.DEV_MAX) == (-32766, 32767)


# ---- _subcell_index ----

def test_subcell_index_truncates_and_clips_on_non_square_grid():
    # 죽이는 변이: (ix, iy) 반환 순서 뒤바꿈, nx·ny 뒤바꿈(ix 3·4 가 2 로 잘린다), clip 제거, 반올림(0.18 -> 4)
    # 값은 서브셀 경계(0.05 의 배수)를 피해 골랐다. 0.15 / 0.05 는 float 로 2.9999999999999996 이다
    grid, _, _ = _hand_fixture()
    # x / 0.05:       0.2   1.4   2.4   3.6   4.8   5.2(clip 4)  18(clip 4)  -1.2(clip 0)
    rel_x = np.array([0.01, 0.07, 0.12, 0.18, 0.24, 0.26, 0.90, -0.06])
    # y / 0.05:       0.2   1.4   2.4   3.2(clip 2)  10(clip 2)  -1.2(clip 0)  0.6   2.8
    rel_y = np.array([0.01, 0.07, 0.12, 0.16, 0.50, -0.06, 0.03, 0.14])
    ix, iy = ps._subcell_index(rel_x, rel_y, grid)
    assert ix.tolist() == [0, 1, 2, 3, 4, 4, 4, 0]
    assert iy.tolist() == [0, 1, 2, 2, 2, 0, 0, 2]
    assert ix.dtype == np.int32 and iy.dtype == np.int32


def test_subcell_index_agrees_with_build_subcell_grid():
    # 인덱스 식이 subcell.py:33-34 와 pointsample.py 두 곳에 있다. 한쪽만 바뀌면 점이 이웃 서브셀의 편차로 칠해진다.
    # 죽이는 변이: x·y 전치(counts[iy, ix] 가 IndexError), clip 제거(가장자리 점이 격자 밖), 내림 방식 변경
    # 점 간격 1/64 m 는 float 로 정확하다. x 폭 0.5m(10칸), y 폭 0.25m(5칸) -> ny != nx
    gx, gy = np.meshgrid(10.0 + np.arange(33) / 64.0, 20.0 + np.arange(17) / 64.0)
    pts = np.column_stack([gx.ravel(), gy.ravel(), np.full(gx.size, 3.0)])
    info = CloudInfo(len(pts), pts.min(axis=0), pts.max(axis=0))
    scale_to_m = 1.0
    grid = build_subcell_grid(iter([pts[:200], pts[200:]]), info, scale_to_m)
    ny, nx = grid.shape
    assert (ny, nx) == (5, 10)

    lo = info.bbox_min * scale_to_m
    p = pts.astype(np.float64) * scale_to_m
    rel_x, rel_y = p[:, 0] - lo[0], p[:, 1] - lo[1]
    # 픽스처 가드: 오른쪽·위 가장자리 점은 clip 이 없으면 격자 밖(nx, ny)으로 나간다
    assert int((rel_x / grid.size_m).max()) == nx and int((rel_y / grid.size_m).max()) == ny

    ix, iy = ps._subcell_index(rel_x, rel_y, grid)
    assert (grid.counts[iy, ix] > 0).all()                  # 점이 떨어진 서브셀은 전부 점이 든 서브셀
    counts = np.zeros(grid.shape, dtype=np.int64)
    np.add.at(counts, (iy, ix), 1)
    assert np.array_equal(counts, grid.counts)              # 서브셀별 점 수까지 같다


# ---- _ok_zone_lut ----

def test_ok_zone_lut_marks_only_ok_zones():
    # 죽이는 변이: status 검사 제거(구역이면 전부 True), 0번을 True 로
    labels = np.array([[0, 1, 2], [3, 3, 1]], dtype=np.int32)
    zones = [ZoneInfo(1, 0.0, 2, 0.005, "ok", (0.0, 0.0, 0.0)),
             ZoneInfo(2, 0.7, 1, 0.0025, "furniture", None),
             ZoneInfo(3, 0.0, 2, 0.005, "ghost", None)]
    lut = ps._ok_zone_lut(ZoneMap(labels, zones))
    assert lut.dtype == np.bool_
    assert lut.tolist() == [False, True, False, False]


def test_ok_zone_lut_length_covers_labels_and_zone_ids():
    # 라벨에만 있는 번호(5)와 구역 목록에만 있는 번호(7) 둘 다 조회할 수 있어야 한다(IndexError 방지)
    labels = np.array([[0, 5]], dtype=np.int32)
    lut = ps._ok_zone_lut(ZoneMap(labels, [ZoneInfo(2, 0.0, 0, 0.0, "ok", None)]))
    assert lut.tolist() == [False, False, True, False, False, False]    # 길이 6 = 라벨 최댓값 5 + 1
    lut = ps._ok_zone_lut(ZoneMap(labels, [ZoneInfo(7, 0.0, 0, 0.0, "ok", None)]))
    assert lut.tolist() == [False] * 7 + [True]                         # 길이 8 = zone_id 최댓값 7 + 1


def test_ok_zone_lut_without_zones_is_single_false():
    lut = ps._ok_zone_lut(ZoneMap(np.zeros((2, 3), dtype=np.int32), []))
    assert lut.tolist() == [False]


def test_ok_zone_lut_label_zero_is_never_ok():
    # 라벨 0 은 '구역 없음'이다. zone_id 0 인 ok 구역이 목록에 섞여 와도 0번은 False 로 남는다
    zmap = ZoneMap(np.zeros((1, 1), dtype=np.int32), [ZoneInfo(0, 0.0, 1, 0.0025, "ok", None)])
    assert ps._ok_zone_lut(zmap).tolist() == [False]


# ---- _deviation_q ----

def _dev_at(grid, zmap, residuals, ix, iy, dz=0.0):
    """서브셀 (iy, ix) 의 중앙값에서 dz(m) 만큼 떨어진 높이에 놓인 점들의 dev_q."""
    ix = np.asarray(ix, dtype=np.int32)
    iy = np.asarray(iy, dtype=np.int32)
    rel_z = grid.median_z[iy, ix].astype(np.float64) + dz
    return ps._deviation_q(ix, iy, rel_z, grid, zmap, residuals, ps._ok_zone_lut(zmap))


def test_deviation_reads_the_subcell_of_each_point():
    # 15칸 전부에 점 하나씩. 칸마다 잔차가 달라서 [iy, ix] 를 [ix, iy] 로 바꾸면 죽는다(IndexError 또는 값 불일치)
    grid, zmap, residuals = _hand_fixture()
    iy, ix = [a.ravel() for a in np.mgrid[0:NY, 0:NX]]
    q = _dev_at(grid, zmap, residuals, ix, iy)
    assert q.tolist() == [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25]


def test_deviation_sign_and_unit():
    # + 융기 / - 침하, 1단위 = 0.1mm. +3.2mm -> 32, -10.5mm -> -105. 죽이는 변이: 부호 반전, 단위(x1000), 버림
    grid, zmap, residuals = _hand_fixture()
    residuals[1, 3] = 0.0032
    residuals[2, 0] = -0.0105
    residuals[0, 4] = 0.0
    q = _dev_at(grid, zmap, residuals, ix=[3, 0, 4], iy=[1, 2, 0])
    assert q.tolist() == [32, -105, 0]


def test_deviation_rounds_half_to_even():
    # 1/32 m = 312.5 단위, 3/32 m = 937.5 단위(둘 다 float32 로 정확하다). numpy.rint 는 짝수 쪽으로 간다.
    # 죽이는 변이: 반올림을 버림으로(937), 0.5 올림으로(313, -313)
    grid, zmap, residuals = _hand_fixture()
    residuals[0, 0], residuals[0, 1], residuals[0, 2] = 0.03125, 0.09375, -0.03125
    q = _dev_at(grid, zmap, residuals, ix=[0, 1, 2], iy=[0, 0, 0])
    assert q.tolist() == [312, 938, -312]


def test_label_zero_is_not_floor():
    # 구역 없음(벽·기둥·저밀도). 옆 칸([1, 3], 잔차 1.4mm)은 그대로 유효하다
    grid, zmap, residuals = _hand_fixture()
    zmap.labels[1, 2] = 0
    q = _dev_at(grid, zmap, residuals, ix=[2, 3], iy=[1, 1])
    assert q.tolist() == [ps.DEV_NOT_FLOOR, 14]


def test_non_ok_zone_is_not_floor():
    # 라벨은 0 이 아닌데 status 가 ok 가 아닌 구역. '라벨 != 0' 만 보는 변이(ok_lut 조회 제거)가 죽는다
    grid, zmap, residuals = _hand_fixture()
    zmap.zones += [ZoneInfo(2, 0.9, 1, 0.0025, "furniture", None),
                   ZoneInfo(3, 0.2, 2, 0.005, "ghost", None)]
    zmap.labels[0, 1] = 2           # furniture, 잔차 유한(0.2mm)
    zmap.labels[2, 3] = 3           # ghost, 잔차 유한(2.4mm)
    zmap.labels[2, 4] = 3           # ghost, 잔차 NaN(build_zones 가 실제로 내는 모양)
    residuals[2, 4] = np.nan
    q = _dev_at(grid, zmap, residuals, ix=[1, 3, 4, 0], iy=[0, 2, 2, 0])
    assert q.tolist() == [ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR, 1]


def test_off_surface_boundary_is_5cm_on_both_sides():
    # 같은 서브셀(잔차 1.3mm)의 점 다섯 개. 중앙값에서 4.9cm 는 표면, 5.1cm 는 이탈, 0.7m 위(가구·천장)도 이탈.
    # 죽이는 변이: 표면 이탈 가드 제거, abs 제거(아래쪽 이탈을 놓친다), 거리 상수 변경
    grid, zmap, residuals = _hand_fixture()
    dz = np.array([0.049, -0.049, 0.051, -0.051, 0.70])
    q = _dev_at(grid, zmap, residuals, ix=[2] * 5, iy=[1] * 5, dz=dz)
    assert q.tolist() == [13, 13, ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR]


def test_nan_median_is_not_floor():
    # 3점 미만 서브셀은 중앙값이 NaN 이다(subcell.py:50-51).
    # [0, 3]: 구역·잔차가 멀쩡해도 표면 판정이 False 라 바닥 아님(build_zones 가 바뀌어도 유지되는 방어)
    # [0, 4]: 현재 코드가 실제로 내는 모양(라벨 0, 중앙값 NaN, 잔차 NaN). DEV_NO_DEVIATION 이 아니다(스펙 부록 B 1)
    grid, zmap, residuals = _hand_fixture()
    grid.median_z[0, 3] = np.nan
    grid.median_z[0, 4] = np.nan
    zmap.labels[0, 4] = 0
    residuals[0, 4] = np.nan
    ix = np.array([3, 4, 2], dtype=np.int32)
    iy = np.array([0, 0, 0], dtype=np.int32)
    rel_z = np.array([0.203, 0.204, 0.202])     # [0, 2] 의 중앙값은 0.202
    with np.errstate(all="raise"):              # NaN 으로 부동소수 경고를 내는 구현이면 FloatingPointError
        q = ps._deviation_q(ix, iy, rel_z, grid, zmap, residuals, ps._ok_zone_lut(zmap))
    assert q.tolist() == [ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR, 3]


def test_non_finite_residual_on_surface_is_no_deviation():
    # bimodal 서브셀: ok 구역·표면 안인데 잔차만 NaN. 죽이는 변이: 두 센티널 뒤바꿈, isfinite -> isnan(inf 가 32767 이 된다),
    # 캐스트 앞 마스킹 제거(NaN 을 int16 으로 캐스트하면 errstate 가 FloatingPointError 를 낸다)
    grid, zmap, residuals = _hand_fixture()
    residuals[1, 0] = np.nan
    residuals[1, 1] = np.inf
    residuals[1, 2] = -np.inf
    with np.errstate(all="raise"):
        q = _dev_at(grid, zmap, residuals, ix=[0, 1, 2, 3], iy=[1, 1, 1, 1])
    assert q.tolist() == [ps.DEV_NO_DEVIATION, ps.DEV_NO_DEVIATION, ps.DEV_NO_DEVIATION, 14]


def test_not_floor_takes_precedence_over_no_deviation():
    # 잔차가 NaN 이어도 표면 이탈·구역 없음이면 DEV_NOT_FLOOR 다(센티널을 덮어쓰는 순서)
    grid, zmap, residuals = _hand_fixture()
    residuals[0, 0] = np.nan
    residuals[0, 1] = np.nan
    zmap.labels[0, 1] = 0
    q = _dev_at(grid, zmap, residuals, ix=[0, 1], iy=[0, 0], dz=np.array([0.70, 0.0]))
    assert q.tolist() == [ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR]


def test_clip_keeps_valid_values_apart_from_sentinels():
    # 잔차 +-5m = +-50000 단위 -> DEV_MAX / DEV_MIN. -3.2767m 와 -3.2768m 는 반올림하면 센티널 값(-32767, -32768)이라
    # clip 하한이 -32766 이어야 한다. 죽이는 변이: clip 제거(50000 이 int16 에서 -15536 으로 감긴다), 하한을 -32768 로
    grid, zmap, residuals = _hand_fixture()
    residuals[0, :] = [5.0, -5.0, -3.2767, -3.2768, 3.2766]
    q = _dev_at(grid, zmap, residuals, ix=[0, 1, 2, 3, 4], iy=[0] * 5)
    assert q.tolist() == [32767, -32766, -32766, -32766, 32766]
    assert ps.DEV_NOT_FLOOR not in q.tolist() and ps.DEV_NO_DEVIATION not in q.tolist()


def test_deviation_dtype_and_shape():
    grid, zmap, residuals = _hand_fixture()
    q = _dev_at(grid, zmap, residuals, ix=[0, 1, 2], iy=[0, 1, 2])
    assert q.dtype == np.int16 and q.shape == (3,)
    empty = _dev_at(grid, zmap, residuals, ix=[], iy=[])
    assert empty.dtype == np.int16 and empty.shape == (0,)


# ---- Task 2: _hash63 (스펙 §4.2 해시) ----
# Task 2 의 헬퍼와 상수는 전부 _sp_ / _SP_ 로 시작한다(Task 1 의 것과 이름이 겹치지 않게).

_SP_MASK = (1 << 64) - 1


def _sp_mix_ref(v):
    """스펙 §4.2 의 mix 를 Python 정수로 옮긴 참조 구현(uint64 wrap 은 & 로 낸다)."""
    v ^= v >> 30
    v = (v * 0xBF58476D1CE4E5B9) & _SP_MASK
    v ^= v >> 27
    v = (v * 0x94D049BB133111EB) & _SP_MASK
    return v ^ (v >> 31)


def _sp_hash63_ref(x, y, z):
    bx, by, bz = (struct.unpack("<Q", struct.pack("<d", v))[0] for v in (x, y, z))
    h = _sp_mix_ref((bx + 0x9E3779B97F4A7C15) & _SP_MASK)
    h = _sp_mix_ref(((h ^ by) + 0xC2B2AE3D27D4EB4F) & _SP_MASK)
    h = _sp_mix_ref(((h ^ bz) + 0x165667B19E3779F9) & _SP_MASK)
    return h >> 1


def test_hash63_matches_pure_python_reference():
    # 참조 구현 자체의 닻: SplitMix64 를 시드 0 으로 돌린 첫 출력(공개된 값)
    assert _sp_mix_ref(0x9E3779B97F4A7C15) == 0xE220A8397B1DCDAF
    pts = np.array([[0.0, 0.0, 0.0],
                    [1.5, -2.25, 3.125],
                    [254012.3371, 4180044.9126, 31.4802],
                    [-0.0, 1e-300, 1e300],
                    [0.02, 0.04, 0.0]], dtype=np.float64)
    got = ps._hash63(pts)
    assert got.dtype == np.uint64 and got.shape == (5,)
    assert [int(v) for v in got] == [_sp_hash63_ref(*row) for row in pts.tolist()]
    assert int(got.max()) < (1 << 63)            # 63비트. 최상위 비트 자리는 벌점용


def test_hash63_noncontiguous_float32_and_axis_order():
    base = np.array([[1.0, 2.0, 3.0], [9.0, 9.0, 9.0], [2.0, 1.0, 3.0],
                     [9.0, 9.0, 9.0], [1.0, 2.0, 3.0]], dtype=np.float64)
    before = base.copy()
    full = ps._hash63(base)
    assert np.array_equal(base, before)                              # 입력을 바꾸지 않는다
    assert ps._hash63(base[::2]).tolist() == full[::2].tolist()      # 비연속 뷰도 같은 값
    assert ps._hash63(np.asfortranarray(base)).tolist() == full.tolist()
    assert int(full[0]) == int(full[4])                              # 같은 좌표는 위치와 무관하게 같은 해시
    assert int(full[0]) != int(full[2])                              # x 와 y 를 바꾸면 다른 해시
    f32 = np.array([[0.1, 0.2, 0.3]], dtype=np.float32)              # float32 청크는 값 그대로 float64 로 본다
    assert ps._hash63(f32).tolist() == ps._hash63(f32.astype(np.float64)).tolist()


# ---- Task 2: sample_points (스펙 §4.2, §10.1 test_pointsample 표) ----

def _sp_chunks(pts, size):
    """리더(iter_chunks) 대역: (k, 3) float64 청크를 size 점씩 낸다."""
    for i in range(0, len(pts), size):
        yield pts[i:i + size]


def _sp_scene(pts, scale=1.0):
    """합성 점 → (info, grid, zmap, residuals). analyze_floor 의 1·2번째 패스와 같은 순서."""
    info = CloudInfo(len(pts), pts.min(axis=0).astype(np.float64), pts.max(axis=0).astype(np.float64))
    grid = build_subcell_grid(_sp_chunks(pts, 200_000), info, scale_to_m=scale)
    zmap, residuals = build_zones(grid, detect_levels(grid.median_z))
    return info, grid, zmap, residuals


def _sp_run(pts, scene, chunk=200_000, scale=1.0, **kw):
    info, grid, zmap, residuals = scene
    return ps.sample_points(_sp_chunks(pts, chunk), info, scale, grid, zmap, residuals, **kw)


def _sp_same(a, b):
    """두 표본이 바이트 단위로 같은가(스펙 §4.2 결정성의 범위)."""
    return (a.xyz_local.tobytes() == b.xyz_local.tobytes()
            and a.dev_q.tobytes() == b.dev_q.tobytes())


def _sp_subcell_index(xyz_local, grid):
    """subcell.py:33-34 의 식을 테스트가 따로 다시 계산한다(pointsample 의 식을 쓰지 않는다)."""
    ny, nx = grid.shape
    ix = np.clip((xyz_local[:, 0] / 0.05).astype(np.int32), 0, nx - 1)
    iy = np.clip((xyz_local[:, 1] / 0.05).astype(np.int32), 0, ny - 1)
    return ix, iy


def _sp_small_bumpy():
    """2.0 x 1.5 m 바닥(점 간격 2cm, 101 * 76 = 7,676 점) + 깊이 8mm 함몰. 청크 7 로도 빨리 돈다."""
    return add_bump(flat_floor(size=(2.0, 1.5), spacing=0.02), (1.2, 0.5), 0.4, -0.008)


def _sp_two_rooms(offset=(0.0, 0.0, 0.0)):
    """방 A(x 0~4, y 0~3, z=0. 중심 (2.0, 1.5) 에 깊이 10mm·반경 0.4m 함몰)
    + 0.4m 빈 틈 + 방 B(x 4.4~8.4, z=+0.5). 201 * 151 * 2 = 60,702 점."""
    a = add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02), (2.0, 1.5), 0.4, -0.010)
    b = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b[:, 0] += 4.4
    b[:, 2] += 0.5
    return np.vstack([a, b]) + np.asarray(offset, dtype=np.float64)


def _sp_check_two_rooms(pts, s):
    # 기본 상한(50만)에서 칸 변은 sqrt(약 24 m2 / 500000) = 약 7mm 로 점 간격 20mm 보다 작다.
    # 모든 점이 제 칸의 유일한 점이라 전 점이 남는다.
    assert len(s.xyz_local) == len(pts) == 60702
    assert s.source_points == 60702
    x, y, z = s.xyz_local.T
    r = np.hypot(x - 2.0, y - 1.5)
    valid = s.dev_q > ps.DEV_NO_DEVIATION
    flat = r > 0.5                      # 함몰(반경 0.4m) 밖. 방 B 전체가 여기에 든다
    room_b = x > 4.2
    # 편차 없는 점은 방 A 의 x = 4.0 가장자리 한 줄(서브셀당 3점 미만)뿐이다: 151 / 60702 = 0.25%
    assert valid[flat].mean() > 0.99
    assert valid[room_b].mean() > 0.99          # 방 B 가 통째로 '바닥 아님'이 되면 죽는다
    assert int(np.abs(s.dev_q[flat & valid]).max()) <= 1      # 평탄부 ±0.1mm
    # bbox 최저 z 는 함몰 바닥(-10mm)이므로 방 B(+0.5m)의 로컬 z 는 0.51
    assert float(np.abs(z[room_b] - 0.51).max()) < 1e-6
    # 함몰 핵: 중심에서 3cm 안의 점 9개(r = 0, 0.02 x4, 0.0283 x4).
    # 이 점들이 든 5cm 서브셀의 점은 전부 r < 0.03 + 0.0707 = 0.10 안이고, 코사인 범프 깊이는
    # r = 0 에서 10.0mm, r = 0.10 에서 10 * 0.5 * (1 + cos(pi * 0.1 / 0.4)) = 8.54mm 다.
    # 서브셀 중앙값은 그 사이이므로 dev_q 는 [-100, -85], RANSAC 평면 오차 ±1 을 더해 [-101, -84]
    core = r < 0.03
    assert int(core.sum()) == 9 and bool(valid[core].all())
    assert -101 <= int(s.dev_q[core].min()) and int(s.dev_q[core].max()) <= -84
    # origin_abs + xyz_local 이 원본 좌표와 0.001mm(1e-6 m) 이내. 전 점이 남았으므로 정렬해 1:1 대조한다
    back = s.origin_abs + s.xyz_local
    back = back[np.lexsort((back[:, 2], back[:, 1], back[:, 0]))]
    orig = pts[np.lexsort((pts[:, 2], pts[:, 1], pts[:, 0]))]
    assert float(np.abs(back - orig).max()) < 1e-6


def test_sample_fields_and_unit_scale():
    # mm 좌표 파일(scale_to_m = 0.001). 원점에서 떨어진 2.0 x 1.5 m 바닥
    pts_m = flat_floor(size=(2.0, 1.5), spacing=0.02)                # 101 * 76 = 7,676 점
    pts_m += np.array([10.0, 20.0, 3.0])
    pts = pts_m * 1000.0
    scene = _sp_scene(pts, scale=0.001)
    info, grid = scene[0], scene[1]
    s = _sp_run(pts, scene, scale=0.001)
    assert isinstance(s, ps.PointSample)
    # 기본 상한: 칸 변 sqrt(약 3 m2 / 500000) = 약 2.4mm < 점 간격 20mm → 전 점이 남는다
    assert s.xyz_local.dtype == np.float64 and s.xyz_local.shape == (7676, 3)
    assert s.dev_q.dtype == np.int16 and s.dev_q.shape == (7676,)
    assert s.source_points == 7676 and s.cap == ps.MAX_POINTS == 500_000
    assert s.origin_abs.dtype == np.float64
    assert np.array_equal(s.origin_abs, info.bbox_min * 0.001)       # (10, 20, 3) m
    assert np.allclose(s.origin_abs, [10.0, 20.0, 3.0], atol=1e-9)
    assert s.xyz_local.min(axis=0).tolist() == [0.0, 0.0, 0.0]       # 로컬 좌표는 0 에서 시작(m)
    assert np.allclose(s.xyz_local.max(axis=0), [2.0, 1.5, 0.0], atol=1e-9)
    n_occ = int((grid.counts > 0).sum())
    assert isinstance(s.sample_cell_m, float)
    assert s.sample_cell_m == pytest.approx(math.sqrt(n_occ * 0.05 * 0.05 / 500_000), rel=1e-12)
    # 전 점이 남으므로 출력은 원본 점 전체를 (해시, 로컬 x, y, z) 순으로 놓은 것과 바이트 단위로 같다.
    # 해시 입력은 scale_to_m 을 곱하기 전의 리더 좌표(mm)다
    rel = pts * 0.001 - info.bbox_min * 0.001
    order = np.lexsort((rel[:, 2], rel[:, 1], rel[:, 0], ps._hash63(pts)))
    assert s.xyz_local.tobytes() == rel[order].tobytes()


def test_sample_cap_truncates_to_max_points():
    pts = flat_floor(size=(2.0, 3.0), spacing=0.02)                  # 101 * 151 = 15,251 점. 세로로 긴 바닥
    scene = _sp_scene(pts)
    assert int((scene[1].counts > 0).sum()) == 2400                  # 점유 서브셀 40 * 60 → 면적 6.0 m2
    s = _sp_run(pts, scene, max_points=2000)
    # 칸 변 sqrt(6.0 / 2000) = 0.05477 m. 표본 칸 격자는
    # (floor(2 / 0.05477) + 1) * (floor(3 / 0.05477) + 1) = 37 * 55 = 2,035 칸이고 전부 점이 든다(점 간격 2cm).
    # 마지막 잘라내기가 없으면 2,035 점, 있으면 정확히 2,000 점이다
    assert s.sample_cell_m == pytest.approx(math.sqrt(6.0 / 2000), rel=1e-12)
    assert len(s.xyz_local) == 2000 and len(s.dev_q) == 2000
    assert s.cap == 2000 and s.source_points == 15251
    # 원본이 상한보다 적으면 자르지 않는다(기본 상한 50만, 칸 변 약 3.5mm < 점 간격)
    full = _sp_run(pts, scene)
    assert len(full.xyz_local) == 15251 and full.cap == ps.MAX_POINTS


def test_sample_chunk_size_invariance():
    pts = _sp_small_bumpy()
    scene = _sp_scene(pts)
    # 상한 1,500: 칸 변 sqrt(3.0 / 1500) = 0.0447 m → 45 * 34 = 1,530 칸. 칸마다 점 4~9개가 겨루고 잘라내기도 일어난다
    ref = _sp_run(pts, scene, chunk=2_000_000, max_points=1500)
    assert len(ref.xyz_local) == 1500
    assert int((ref.dev_q < -20).sum()) > 0                          # 함몰 점이 표본에 있다(편차 배열이 전부 0 이 아니다)
    for chunk in (7, 1000):
        assert _sp_same(_sp_run(pts, scene, chunk=chunk, max_points=1500), ref), chunk
    # 빈 청크가 섞여 와도 같다(리더가 0점 청크를 내도 죽지 않는다)
    info, grid, zmap, residuals = scene
    parts = iter([pts[:3000], pts[:0], pts[3000:]])
    assert _sp_same(ps.sample_points(parts, info, 1.0, grid, zmap, residuals, max_points=1500), ref)


def test_sample_point_order_invariance():
    pts = _sp_small_bumpy()
    scene = _sp_scene(pts)                                           # 같은 grid·zmap·residuals 를 준다
    ref = _sp_run(pts, scene, chunk=1000, max_points=1500)
    perm = np.random.default_rng(7).permutation(len(pts))
    assert not np.array_equal(perm, np.arange(len(pts)))
    assert _sp_same(_sp_run(pts[perm], scene, chunk=1000, max_points=1500), ref)


def test_sample_tie_break_by_local_coordinates(monkeypatch):
    # 모든 점의 해시를 0 으로 만든다. 칸별 승자와 출력 순서를 정하는 것은 로컬 좌표 사전순뿐이다
    monkeypatch.setattr(ps, "_hash63", lambda chunk: np.zeros(len(chunk), dtype=np.uint64))
    base = flat_floor(size=(2.0, 1.5), spacing=0.02)                 # 101 * 76 = 7,676 점
    base[:, 0] += 0.37 * base[:, 1]      # 전단. 한 칸 안에서 x 가 최소인 점과 y 가 최소인 점이 달라진다
    twin = base[::3].copy()
    twin[:, 2] += 0.001                  # x, y 가 같고 z 만 1mm 높은 쌍둥이 점(2,559개). z 까지 가야 동률이 깨진다
    pts = np.vstack([twin, base])        # 쌍둥이를 앞에 둔다('먼저 본 점이 이김' 구현이면 높은 z 가 남는다)
    assert pts.min(axis=0).tolist() == [0.0, 0.0, 0.0]               # bbox_min 이 0 이라 로컬 좌표 = 원본 좌표
    info = CloudInfo(len(pts), pts.min(axis=0), pts.max(axis=0))
    # grid·zmap·residuals 는 손으로 만든다: 전 서브셀이 ok 구역·중앙값 0·잔차 0 → 모든 점이 유효 편차(벌점 0).
    # 점유 서브셀은 평행사변형 넓이 3.0 m2 에 해당하는 1,200개로 둔다(칸 변을 정하는 데만 쓰인다)
    shape = (30, 52)                     # x 범위 2.0 + 0.37 * 1.5 = 2.555 m → 52열, y 1.5 m → 30행
    counts = np.zeros(shape, dtype=np.int32)
    counts[:, :40] = 6
    grid = SubcellGrid(size_m=0.05, origin=np.zeros(2), shape=shape,
                       median_z=np.zeros(shape, dtype=np.float32), counts=counts,
                       bimodal=np.zeros(shape, dtype=bool))
    zmap = ZoneMap(labels=np.ones(shape, dtype=np.int32),
                   zones=[ZoneInfo(1, 0.0, 1560, 3.9, "ok", (0.0, 0.0, 0.0))])
    scene = (info, grid, zmap, np.zeros(shape, dtype=np.float32))

    ref = _sp_run(pts, scene, chunk=2_000_000, max_points=1500)
    assert bool((ref.dev_q == 0).all())
    for chunk in (7, 1000):
        assert _sp_same(_sp_run(pts, scene, chunk=chunk, max_points=1500), ref), chunk
    perm = np.random.default_rng(11).permutation(len(pts))
    assert _sp_same(_sp_run(pts[perm], scene, chunk=1000, max_points=1500), ref)

    # 정답을 순수 Python 으로 따로 만든다: 칸마다 (x, y, z) 사전순 최소 점, 그것을 (x, y, z) 순으로 놓고 앞 1,500개
    s = ref.sample_cell_m
    assert s == pytest.approx(math.sqrt(3.0 / 1500), rel=1e-12)      # 0.0447 m
    n_x = math.floor(float(pts[:, 0].max()) / s) + 1
    n_y = math.floor(float(pts[:, 1].max()) / s) + 1
    best = {}
    for x, y, z in pts.tolist():
        cell = (min(int(x / s), n_x - 1), min(int(y / s), n_y - 1))
        if cell not in best or (x, y, z) < best[cell]:
            best[cell] = (x, y, z)
    assert len(best) > 1500                                          # 잘라내기도 일어난다
    assert ref.xyz_local.tolist() == [list(t) for t in sorted(best.values())[:1500]]


def test_sample_uneven_density_covers_every_tile():
    sparse = flat_floor(size=(1.975, 2.0), spacing=0.025)            # x 0~1.975: 80 * 81 = 6,480 점 (1,620 점/m2)
    dense = flat_floor(size=(2.0, 2.0), spacing=0.005)               # x 2~4: 401 * 401 = 160,801 점 (40,200 점/m2, 약 25배)
    dense[:, 0] += 2.0
    pts = np.vstack([sparse, dense])
    s = _sp_run(pts, _sp_scene(pts), max_points=3000)

    def tiles(xyz):                                                  # 25cm 타일 16 * 8
        tx = np.minimum((xyz[:, 0] / 0.25).astype(np.int64), 15)
        ty = np.minimum((xyz[:, 1] / 0.25).astype(np.int64), 7)
        return np.unique(ty * 16 + tx)

    assert len(tiles(pts)) == 128                                    # 원본은 타일 128개 전부에 점이 있다
    assert np.array_equal(tiles(s.xyz_local), tiles(pts))            # 표본이 0점인 타일 0개
    # 층화 추출이면 표본은 면적에 비례한다(성긴 절반이 약 50%). 밀도 비례 추출이면 6480 / 167281 = 3.9% 가 된다
    share = float((s.xyz_local[:, 0] < 1.9875).mean())
    assert 0.40 <= share <= 0.60


def test_sample_dev_matches_recomputed_subcell_index():
    # x·y 범위가 다르고(3.0 x 2.0 m, 격자 60 x 40) 대각선에서 벗어난 자리에 10mm 융기가 있어 잔차가 자리마다 다르다
    pts = add_bump(flat_floor(size=(3.0, 2.0), spacing=0.02), (2.2, 0.6), 0.5, 0.010)
    scene = _sp_scene(pts)
    grid, residuals = scene[1], scene[3]
    assert grid.shape == (40, 60)
    s = _sp_run(pts, scene)
    ix, iy = _sp_subcell_index(s.xyz_local, grid)
    valid = s.dev_q > ps.DEV_NO_DEVIATION
    assert bool(valid.all())                                         # 이 바닥에는 편차 없는 점이 없다
    expect = np.rint(residuals[iy, ix].astype(np.float64) * 10000.0).astype(np.int16)
    assert np.array_equal(s.dev_q, expect)
    # 공허하지 않다: 융기 높이 2mm 이상인 반경 0.352m 원(0.39 m2, 전체의 6.5%)의 점이 +20 이상이다. 15251 * 0.065 = 약 990
    assert int((s.dev_q >= 20).sum()) >= 500


def test_sample_points_never_fall_in_empty_subcells():
    # 좁은 방(x 0~1) + 0.4m 빈 틈 + 넓은 방(x 1.4~5.4), y 는 둘 다 0~3
    a = flat_floor(size=(1.0, 3.0), spacing=0.02)
    b = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b[:, 0] += 1.4
    pts = np.vstack([a, b])
    scene = _sp_scene(pts)
    grid = scene[1]
    # 틈의 서브셀 6열(21~26번, x 1.05~1.35) * 60행 = 360개가 비어 있다.
    # x = 1.0 열은 20번, x = 1.4 열은 27번 서브셀에 든다(1.4 / 0.05 는 float 로 27.999…)
    assert int((grid.counts == 0).sum()) == 360
    s = _sp_run(pts, scene)
    assert len(s.xyz_local) == len(pts)                              # 기본 상한에서는 전 점이 남는다
    ix, iy = _sp_subcell_index(s.xyz_local, grid)
    assert bool((grid.counts[iy, ix] > 0).all())
    # x·y 열을 바꿔 저장하면 y 1.05~1.35 의 점이 틈의 빈 서브셀로 떨어진다


def test_sample_two_zones():
    pts = _sp_two_rooms()
    s = _sp_run(pts, _sp_scene(pts))
    _sp_check_two_rooms(pts, s)
    assert np.allclose(s.origin_abs, [0.0, 0.0, -0.010], atol=1e-12)


def test_sample_utm_offset():
    pts = _sp_two_rooms(offset=(254000.0, 4180000.0, 35.0))
    s = _sp_run(pts, _sp_scene(pts))
    _sp_check_two_rooms(pts, s)
    assert np.array_equal(s.origin_abs, pts.min(axis=0))
    assert float(s.origin_abs[1]) == 4180000.0


def test_sample_sign_bump_positive_dip_negative():
    pts = flat_floor(size=(3.0, 3.0), spacing=0.02)
    pts = add_bump(pts, (0.8, 0.8), 0.4, 0.008)                      # 융기 +8mm
    pts = add_bump(pts, (2.2, 2.0), 0.4, -0.008)                     # 침하 -8mm
    s = _sp_run(pts, _sp_scene(pts))
    x, y = s.xyz_local[:, 0], s.xyz_local[:, 1]
    up = np.hypot(x - 0.8, y - 0.8) < 0.03
    down = np.hypot(x - 2.2, y - 2.0) < 0.03
    assert int(up.sum()) >= 5 and int(down.sum()) >= 5
    # 정점 서브셀의 중앙값은 8.0mm 와 8 * 0.5 * (1 + cos(pi * 0.1 / 0.4)) = 6.83mm 사이 → 68~80, 평면 오차 ±1
    assert 67 <= int(s.dev_q[up].min()) and int(s.dev_q[up].max()) <= 81
    assert -81 <= int(s.dev_q[down].min()) and int(s.dev_q[down].max()) <= -67


def test_sample_off_surface_points_lose_to_floor_points():
    floor = flat_floor(size=(3.0, 3.0), spacing=0.02)                # 151 * 151 = 22,801 점, z = 0
    # 바닥 위 0.7m 의 성긴 상판(점 간격 6cm > 서브셀 5cm → 서브셀당 상판 점 최대 1개).
    # x 1.6~3.58, y 0.8~2.18. x <= 2.98 인 24열은 바닥 위에, x >= 3.04 인 10열은 바닥 밖에 있다
    tx, ty = np.meshgrid(1.6 + 0.06 * np.arange(34), 0.8 + 0.06 * np.arange(24))
    top = np.column_stack([tx.ravel(), ty.ravel(), np.full(tx.size, 0.7)])
    over_floor = top[:, 0] < 2.99
    assert int(over_floor.sum()) == 24 * 24 and int((~over_floor).sum()) == 10 * 24
    pts = np.vstack([floor, top])
    # 상한 2,500: 칸 변 약 6cm. 바닥 위의 칸에는 바닥 점 약 9개와 상판 점 약 1개가 함께 든다
    s = _sp_run(pts, _sp_scene(pts), max_points=2500)
    assert 0.055 < s.sample_cell_m < 0.065
    x, z = s.xyz_local[:, 0], s.xyz_local[:, 2]
    high = z > 0.5
    # (1) 표본에 든 상판 점은 전부 '바닥 아님'. 바닥 밖 상판 점(240개, 제 칸에 혼자)이 표본에 실제로 들어 있다
    assert int(high.sum()) >= 100
    assert bool((s.dev_q[high] == ps.DEV_NOT_FLOOR).all())
    # (2) 바닥 위에서는 상판 점이 한 개도 뽑히지 않는다. x <= 2.98 인 상판 점의 칸에는 항상 유효 편차를 가진
    #     바닥 점이 있고(바닥 점 간격 2cm < 칸 변), 벌점 때문에 바닥 점이 이긴다.
    #     벌점이 없으면 576개 칸의 약 1/10 에서 상판 점의 해시가 이긴다
    assert int((high & (x < 2.99)).sum()) == 0
    # (3) 바닥 점은 유효 편차로 남는다(상판 아래 포함)
    low_inside = (~high) & (x < 2.95)
    assert bool((s.dev_q[low_inside] > ps.DEV_NO_DEVIATION).all())
    assert int(np.abs(s.dev_q[low_inside]).max()) <= 1
    # (4) 출력 순서에는 벌점이 끼지 않는다: '바닥 아님' 점이 뒤에 몰리지 않고 해시 순으로 섞여 있다.
    #     bbox_min = (0, 0, 0), scale 1.0 이라 xyz_local 에서 해시를 다시 계산할 수 있다
    h = ps._hash63(s.xyz_local)
    assert bool((h[1:] >= h[:-1]).all())
    assert int(np.flatnonzero(high)[0]) < len(h) // 4


def test_sample_sentinels_are_distinguished():
    base = flat_floor(size=(3.0, 3.0), spacing=0.02)
    ghost = flat_floor(size=(1.0, 1.0), spacing=0.02)                # x, y 1~2 에 15mm 뜬 이중층 → bimodal 서브셀
    ghost[:, 0] += 1.0
    ghost[:, 1] += 1.0
    ghost[:, 2] += 0.015
    speck = flat_floor(size=(0.3, 0.3), spacing=0.02)                # 0.5m 떨어진 0.09 m2 조각(최소 면적 1 m2 미달) → 라벨 0
    speck[:, 0] += 3.5
    speck[:, 1] += 1.0
    speck[:, 2] += 0.3
    pts = np.vstack([base, ghost, speck])
    scene = _sp_scene(pts)
    grid, zmap = scene[1], scene[2]
    s = _sp_run(pts, scene)
    x, y = s.xyz_local[:, 0], s.xyz_local[:, 1]
    ix, iy = _sp_subcell_index(s.xyz_local, grid)
    in_ghost = (x > 1.1) & (x < 1.9) & (y > 1.1) & (y < 1.9)
    in_speck = x > 3.4
    # 픽스처 확인: 이중층 안쪽은 bimodal 이면서 ok 구역(라벨 != 0), 조각은 중앙값이 유한한데 라벨 0
    assert int(in_ghost.sum()) >= 500 and int(in_speck.sum()) >= 100
    assert bool(grid.bimodal[iy[in_ghost], ix[in_ghost]].all())
    assert bool((zmap.labels[iy[in_ghost], ix[in_ghost]] != 0).all())
    assert bool((zmap.labels[iy[in_speck], ix[in_speck]] == 0).all())
    assert bool(np.isfinite(grid.median_z[iy[in_speck], ix[in_speck]]).any())
    # 단언(값을 숫자로 적는다. 상수 두 개를 맞바꾸는 변이가 여기서 죽는다)
    assert set(s.dev_q[in_ghost].tolist()) == {-32767} == {ps.DEV_NO_DEVIATION}
    assert set(s.dev_q[in_speck].tolist()) == {-32768} == {ps.DEV_NOT_FLOOR}
    plain = (x < 0.9) & (y < 2.9)
    assert bool((s.dev_q[plain] > ps.DEV_NO_DEVIATION).all())
    assert int(np.abs(s.dev_q[plain]).max()) <= 1


def test_sample_stray_points_do_not_collapse_sample():
    floor = flat_floor(size=(4.0, 3.0), spacing=0.02)                # 201 * 151 = 30,351 점, 점유 면적 12.0 m2
    i = np.arange(30, dtype=np.float64)
    stray = np.column_stack([54.0 + 0.13 * i, 53.0 + 0.11 * i, np.zeros(30)])   # 바닥에서 50m 밖의 잡점 30개
    both = np.vstack([floor, stray])
    clean = _sp_run(floor, _sp_scene(floor), max_points=5000)
    dirty = _sp_run(both, _sp_scene(both), max_points=5000)
    # 잡점 없음: 칸 변 sqrt(12 / 5000) = 0.04899 m → 82 * 62 = 5,084 칸 → 5,000 으로 잘린다
    assert len(clean.xyz_local) == 5000
    # 잡점 있음: 점유 서브셀은 4,800 → 4,971 (잡점 30 + bbox 가 커져 x = 4.0 열과 y = 3.0 행이 제 서브셀을 얻은 141).
    # 칸 변은 sqrt(4971 / 4800) = 1.018 배일 뿐이다.
    # bbox 면적(약 58 x 56 m)에서 유도하면 칸 변이 0.8m(16배)가 되어 바닥에 30칸 남짓만 남는다
    assert dirty.sample_cell_m / clean.sample_cell_m < 1.05
    assert len(dirty.xyz_local) >= 0.95 * len(clean.xyz_local)
    on_floor = dirty.xyz_local[:, 0] < 5.0
    assert int(on_floor.sum()) >= 0.95 * len(clean.xyz_local)        # 남은 점이 잡점이 아니라 바닥 점이다


def test_sample_output_is_hash_ordered_and_prefix_is_uniform():
    # 30 x 20 m, 점 간격 2cm(1501 * 1001 = 1,502,501 점). scale_to_m = 1.0, bbox_min = (0, 0, 0) 이라
    # rel = chunk * 1.0 - 0.0 이 리더 좌표와 비트 단위로 같고, xyz_local 에서 해시를 그대로 다시 계산할 수 있다
    pts = flat_floor(size=(30.0, 20.0), spacing=0.02)
    info = CloudInfo(len(pts), np.zeros(3), pts.max(axis=0).astype(np.float64))
    # grid·zmap·residuals 는 손으로 만든다(평탄 바닥: 전 서브셀 점유, ok 구역 하나, 잔차 0)
    shape = (400, 600)
    grid = SubcellGrid(size_m=0.05, origin=np.zeros(2), shape=shape,
                       median_z=np.zeros(shape, dtype=np.float32),
                       counts=np.full(shape, 6, dtype=np.int32),
                       bimodal=np.zeros(shape, dtype=bool))
    zmap = ZoneMap(labels=np.ones(shape, dtype=np.int32),
                   zones=[ZoneInfo(1, 0.0, 240_000, 600.0, "ok", (0.0, 0.0, 0.0))])
    residuals = np.zeros(shape, dtype=np.float32)
    s = ps.sample_points(_sp_chunks(pts, 400_000), info, 1.0, grid, zmap, residuals, max_points=240_000)
    # 점유 면적 600 m2 / 240,000 → 칸 변 5cm → 601 * 401 = 241,001 칸 → 240,000 으로 잘린다
    assert len(s.xyz_local) == 240_000
    h = ps._hash63(s.xyz_local)
    assert bool((h[1:] >= h[:-1]).all())                             # 해시 값 비내림차순
    assert int(h[0]) < int(h[-1])

    def tiles(xyz):                                                  # 1m 타일 30 * 20
        tx = np.minimum(xyz[:, 0].astype(np.int64), 29)
        ty = np.minimum(xyz[:, 1].astype(np.int64), 19)
        return np.unique(ty * 30 + tx)

    # 앞 10%(24,000 점, 타일당 평균 40 점)만으로 600개 타일을 전부 덮는다.
    # 칸 번호순 출력이면 앞 10% 는 y 0~2m 의 띠라서 60개 타일만 덮는다
    assert len(tiles(s.xyz_local[:24_000])) == 600


def test_sample_clips_extreme_residuals():
    pts = flat_floor(size=(3.0, 2.0), spacing=0.02)
    info, grid, zmap, residuals = _sp_scene(pts)
    injected = residuals.copy()
    injected[:, :30] = 5.0                                           # x < 1.5: 잔차 +5m
    injected[:, 30:] = -5.0                                          # x >= 1.5: 잔차 -5m
    s = _sp_run(pts, (info, grid, zmap, injected))
    x = s.xyz_local[:, 0]
    left, right = x < 1.45, x > 1.55
    assert int(left.sum()) > 1000 and int(right.sum()) > 1000
    # clip 이 없으면 rint(50000) 이 int16 에서 -15536 으로 감긴다
    assert set(s.dev_q[left].tolist()) == {ps.DEV_MAX} == {32767}
    assert set(s.dev_q[right].tolist()) == {ps.DEV_MIN} == {-32766}
    assert ps.DEV_NOT_FLOOR not in s.dev_q.tolist() and ps.DEV_NO_DEVIATION not in s.dev_q.tolist()


def test_sample_raises_when_no_occupied_subcell():
    pts = flat_floor(size=(1.0, 1.0), spacing=0.02)
    info, grid, zmap, residuals = _sp_scene(pts)
    empty = SubcellGrid(size_m=grid.size_m, origin=grid.origin, shape=grid.shape,
                        median_z=grid.median_z, counts=np.zeros_like(grid.counts), bimodal=grid.bimodal)
    with pytest.raises(ValueError):
        ps.sample_points(_sp_chunks(pts, 1000), info, 1.0, empty, zmap, residuals)

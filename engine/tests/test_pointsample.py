"""3D 점군 뷰어용 점 표본(core/pointsample.py) 테스트.

손으로 만든 grid·zmap·residuals 위에서 함수를 하나씩 본다. 픽스처 격자는 비정방(3행 x 5열)이고
서브셀마다 값이 달라서 x·y 를 바꿔 쓰는 실수가 IndexError 나 값 불일치로 드러난다.
"""
import numpy as np
from flatness.core import pointsample as ps
from flatness.core.subcell import SubcellGrid, build_subcell_grid
from flatness.core.zones import ZoneInfo, ZoneMap
from flatness.io.reader import CloudInfo

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

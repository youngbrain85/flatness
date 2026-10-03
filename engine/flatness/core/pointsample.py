"""3D 점군 뷰어용 점 표본 - 원본 스캔 점에 서브셀 편차를 붙인다(3D 점군 뷰어 스펙 §4).

편차는 점 자체의 높이가 아니라 그 점이 속한 5cm 서브셀의 잔차다(정밀 편차맵과 같은 값).
0.1mm 단위 int16 으로 기록하고, 편차가 없는 점은 센티널 두 종류로 구분한다.
센티널·단위 상수는 이 모듈이 정의하고 outputs/points3d.py 가 가져다 쓴다(core 가 outputs 를 import 하지 않는다).
판정 경로(subcell.py, zones.py, cells.py)는 이 모듈을 쓰지 않는다.
"""
import numpy as np

MAX_POINTS = 500_000          # 점 수 상한(엔진 상수)
OFF_SURFACE_M = 0.05          # 표면 이탈 판정 거리. zones.py:28 band_m 기본값과 같은 값
DEV_UNIT_M = 1e-4             # 편차 정수 1단위 = 0.1mm
DEV_NOT_FLOOR = -32768        # 센티널: 바닥 아님
DEV_NO_DEVIATION = -32767     # 센티널: 바닥 구역 안이지만 잔차 없음
DEV_MIN, DEV_MAX = -32766, 32767   # 유효 편차 범위


def _subcell_index(rel_x, rel_y, grid):
    """로컬 좌표(m, bbox_min 을 뺀 값) -> 서브셀 인덱스 (ix, iy), 둘 다 int32.

    subcell.py:33-34 와 글자 그대로 같은 식이어야 한다. 한쪽만 바뀌면 점이 이웃 서브셀의 편차로 칠해진다
    (tests/test_pointsample.py 의 test_subcell_index_agrees_with_build_subcell_grid 가 묶는다).
    """
    ny, nx = grid.shape
    ix = np.clip((rel_x / grid.size_m).astype(np.int32), 0, nx - 1)
    iy = np.clip((rel_y / grid.size_m).astype(np.int32), 0, ny - 1)
    return ix, iy


def _ok_zone_lut(zmap):
    """라벨 번호 -> '판정에 쓰인 바닥 구역(status == "ok")인가' 조회 표, (L,) bool.

    L 은 라벨 최댓값과 zone_id 최댓값을 둘 다 덮는다(어느 라벨로 조회해도 IndexError 가 없다).
    라벨 0 은 구역 없음이라 항상 False 다.
    """
    max_id = max((z.zone_id for z in zmap.zones), default=0)
    lut = np.zeros(max(int(zmap.labels.max()), max_id, 0) + 1, dtype=bool)
    for z in zmap.zones:
        lut[z.zone_id] = z.status == "ok"
    lut[0] = False
    return lut


def _deviation_q(ix, iy, rel_z, grid, zmap, residuals, ok_lut):
    """점별 편차 (k,) int16: 0.1mm 정수 또는 센티널(스펙 §4.3).

    ix, iy 는 _subcell_index 가 낸 서브셀 인덱스, rel_z 는 bbox 최저 z 기준 상대 높이(m, float64),
    ok_lut 는 _ok_zone_lut(zmap) 이다. 부호는 residuals 그대로(+ 융기 / - 침하).

    DEV_NOT_FLOOR    : 구역 없음(라벨 0), furniture·ghost 구역, 서브셀 중앙값에서 OFF_SURFACE_M 넘게 벗어난 점
    DEV_NO_DEVIATION : ok 구역·표면 안인데 서브셀 잔차가 유한하지 않음(bimodal 서브셀)
    """
    label = zmap.labels[iy, ix]
    med = grid.median_z[iy, ix].astype(np.float64)
    # 중앙값이 NaN(3점 미만 서브셀)이면 비교가 False 라 따로 처리하지 않아도 바닥 아님이 된다
    on_surface = ok_lut[label] & (np.abs(rel_z - med) <= OFF_SURFACE_M)
    r = residuals[iy, ix].astype(np.float64)
    finite = np.isfinite(r)
    # NaN·범위 초과 값을 그대로 int16 으로 캐스트하면 조용히 틀린 값이 된다. 마스킹과 clip 을 캐스트 앞에 둔다
    q = np.clip(np.rint(np.where(finite, r, 0.0) * 10000.0), DEV_MIN, DEV_MAX).astype(np.int16)
    q[~finite] = DEV_NO_DEVIATION
    q[~on_surface] = DEV_NOT_FLOOR      # 바닥 아님이 먼저다(잔차가 NaN 이어도)
    return q

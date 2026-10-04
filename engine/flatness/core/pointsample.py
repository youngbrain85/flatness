"""3D 점군 뷰어용 점 표본 - 원본 스캔 점에 서브셀 편차를 붙인다(3D 점군 뷰어 스펙 §4).

편차는 점 자체의 높이가 아니라 그 점이 속한 5cm 서브셀의 잔차다. 정밀 편차맵이 쓰는 것과 같은 5cm 서브셀
잔차 배열에서 나온 값이다(편차맵은 2x2 평균해 10cm로 그린다).
0.1mm 단위 int16 으로 기록하고, 편차가 없는 점은 센티널 두 종류로 구분한다.
센티널·단위 상수는 이 모듈이 정의하고 outputs/points3d.py 가 가져다 쓴다(core 가 outputs 를 import 하지 않는다).
판정 경로(subcell.py, zones.py, cells.py)는 이 모듈을 쓰지 않는다.
"""
from dataclasses import dataclass
from typing import Iterable

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


# 해시 상수(스펙 §4.2). 전부 uint64 이고 덧셈·곱셈은 2^64 에서 감긴다(wrap)
_MIX_MUL_1 = np.uint64(0xBF58476D1CE4E5B9)
_MIX_MUL_2 = np.uint64(0x94D049BB133111EB)
_ADD_X = np.uint64(0x9E3779B97F4A7C15)
_ADD_Y = np.uint64(0xC2B2AE3D27D4EB4F)
_ADD_Z = np.uint64(0x165667B19E3779F9)


def _mix(v):
    """SplitMix64 finalizer. v 는 uint64 배열이고 새 배열을 돌려준다(입력을 바꾸지 않는다)."""
    v = v ^ (v >> np.uint64(30))
    v = v * _MIX_MUL_1
    v = v ^ (v >> np.uint64(27))
    v = v * _MIX_MUL_2
    return v ^ (v >> np.uint64(31))


def _hash63(chunk: np.ndarray) -> np.ndarray:
    """리더 좌표 (k, 3) 의 float64 비트로 만든 63비트 해시, (k,) uint64.

    입력은 scale_to_m 을 곱하기 전의 청크다. 좌표마다 mix 를 한 번씩 거치므로 float32 유래 좌표
    (하위 29비트가 0)에서도 64비트 상태가 유지된다. 점 순서·청크 경계와 무관하고 난수·시드를 쓰지 않는다.
    sample_points 는 호출할 때마다 이 이름을 모듈 전역에서 찾는다(테스트가 바꿔 끼운다).
    """
    # float64 로 맞춘 뒤 비트 그대로 uint64 로 본다(float32 청크와 비연속 뷰는 여기서 복사된다).
    # 아래 연산은 전부 새 배열을 만들므로 입력 청크는 바뀌지 않는다
    bits = np.ascontiguousarray(chunk, dtype=np.float64).view(np.uint64)
    # 배열 연산이라 넘침은 조용히 감긴다. errstate 는 넘침 경고를 켜 둔 환경에 대한 방어다
    with np.errstate(over="ignore"):
        h = _mix(bits[:, 0] + _ADD_X)
        h = _mix((h ^ bits[:, 1]) + _ADD_Y)
        h = _mix((h ^ bits[:, 2]) + _ADD_Z)
    return h >> np.uint64(1)                  # 최상위 비트 자리는 벌점에 쓴다


@dataclass
class PointSample:
    """sample_points 의 결과. xyz_local 과 dev_q 는 같은 순서(해시 값 오름차순)다."""
    xyz_local: np.ndarray     # (n, 3) float64. info.bbox_min * scale_to_m 를 뺀 로컬 좌표(m). 해시 순
    dev_q: np.ndarray         # (n,) int16. 0.1mm 단위 편차 또는 센티널
    origin_abs: np.ndarray    # (3,) float64. info.bbox_min * scale_to_m
    sample_cell_m: float      # 표본 칸 변 s
    source_points: int        # 3번째 패스가 읽은 원본 점 수
    cap: int                  # 적용한 상한


# 칸별 승자를 고르는 정렬 키(uint64 하나) = 벌점 << 63 | hash63
_PENALTY_SHIFT = np.uint64(63)                # 정렬 키의 최상위 비트 = 벌점
_HASH_MASK = np.uint64(0x7FFFFFFFFFFFFFFF)    # 정렬 키의 아래 63비트 = hash63


def _cell_winners(cell, key, rel):
    """표본 칸마다 (key, rel.x, rel.y, rel.z) 사전순 최소인 행의 인덱스. 칸 번호 오름차순으로 돌려준다.

    key = 벌점 << 63 | hash63 이므로 key 의 대소는 (penalty, hash63) 사전순과 같다.
    5개 키 전체 정렬(np.lexsort)은 200만 점 청크에 4초쯤 든다. 그래서 칸 번호로만 정렬해 칸별 최소 키를
    구하고, 최소 키를 가진 행이 한 칸에 둘 이상일 때(동률)만 그 행들끼리 좌표를 비교한다.
    빈 배열로는 부르지 않는다(sample_points 가 빈 청크를 건너뛴다).
    """
    order = np.argsort(cell, kind="stable")
    sorted_cell = cell[order]
    sorted_key = key[order]
    start = np.flatnonzero(np.r_[True, sorted_cell[1:] != sorted_cell[:-1]])   # 칸이 바뀌는 자리
    counts = np.diff(np.r_[start, len(order)])                                 # 칸별 행 수
    key_min = np.minimum.reduceat(sorted_key, start)                           # 칸별 최소 키
    cand = order[sorted_key == np.repeat(key_min, counts)]                     # 최소 키를 가진 행(칸 번호 오름차순)
    if len(cand) == len(start):
        return cand                                                            # 칸마다 정확히 한 행. 동률 없음
    # 동률: 로컬 좌표 사전순으로 깬다. np.lexsort 는 마지막 키가 1순위다
    sub = np.lexsort((rel[cand, 2], rel[cand, 1], rel[cand, 0], cell[cand]))
    cand = cand[sub]
    cand_cell = cell[cand]
    return cand[np.r_[True, cand_cell[1:] != cand_cell[:-1]]]


def sample_points(chunks: Iterable[np.ndarray], info, scale_to_m: float, grid, zmap,
                  residuals: np.ndarray, max_points: int = MAX_POINTS) -> PointSample:
    """칸별 min-hash 층화 추출(cell min-hash stratified). 스펙 §4.2.

    chunks 는 iter_chunks 가 내는 (k, 3) float64 반복자, info 는 CloudInfo, grid 는 SubcellGrid,
    zmap·residuals 는 build_zones 의 결과다(build_subcell_grid 와 같은 인자 형태).
    xy 표본 칸마다 (penalty, hash63, rel.x, rel.y, rel.z) 사전순 최소인 원본 점 하나를 남긴다.
    같은 점 집합이면 청크 크기·점 순서와 무관하게 출력 두 배열이 바이트 단위로 같다.
    점이 든 서브셀이 하나도 없으면 ValueError.
    """
    lo = info.bbox_min * scale_to_m
    hi = info.bbox_max * scale_to_m
    # 표본 칸 변은 점유 면적에서 유도한다. bbox 면적에서 유도하면 잡점 몇 개로 표본이 붕괴한다
    n_occ = int(np.count_nonzero(grid.counts > 0))
    if n_occ == 0:
        raise ValueError("점이 든 서브셀이 없어 표본 칸 크기를 정할 수 없습니다")
    s = float(np.sqrt(n_occ * grid.size_m * grid.size_m / max_points))
    n_cx = int(np.floor((hi[0] - lo[0]) / s)) + 1
    n_cy = int(np.floor((hi[1] - lo[1]) / s)) + 1
    ok_lut = _ok_zone_lut(zmap)

    # state: 점이 든 표본 칸마다 승자 한 행만 담는 희소 표. n_cx * n_cy 길이의 배열은 만들지 않는다
    # (잡점으로 bbox 가 커지면 그 길이가 bbox 면적 / s^2 으로 폭증한다)
    st_cell = np.empty(0, dtype=np.int64)
    st_key = np.empty(0, dtype=np.uint64)
    st_rel = np.empty((0, 3), dtype=np.float64)
    st_dev = np.empty(0, dtype=np.int16)
    n_seen = 0
    for chunk in chunks:
        if len(chunk) == 0:
            continue
        # 대좌표(UTM급)에서 지터가 생기지 않게 float64 로 원점을 뺀다(subcell.py:26-27 관례)
        p = chunk.astype(np.float64) * scale_to_m
        rel = p - lo
        n_seen += len(chunk)
        # (1) 서브셀 인덱스 (2) 점별 편차·센티널
        ix, iy = _subcell_index(rel[:, 0], rel[:, 1], grid)
        dev = _deviation_q(ix, iy, rel[:, 2], grid, zmap, residuals, ok_lut)
        penalty = (dev <= DEV_NO_DEVIATION).astype(np.uint64)      # 센티널이면 1. 편차를 가진 점이 항상 이긴다
        # (3) 표본 칸 번호
        cx = np.minimum((rel[:, 0] / s).astype(np.int64), n_cx - 1)
        cy = np.minimum((rel[:, 1] / s).astype(np.int64), n_cy - 1)
        cell = cy * n_cx + cx
        # (4) 해시. 입력은 scale_to_m 을 곱하기 전의 청크다
        key = (penalty << _PENALTY_SHIFT) | _hash63(chunk)
        # (5) 청크 안에서 칸별 승자만 남긴 뒤 state 와 합쳐 다시 칸별 승자만 남긴다
        w = _cell_winners(cell, key, rel)
        all_cell = np.concatenate([st_cell, cell[w]])
        all_key = np.concatenate([st_key, key[w]])
        all_rel = np.concatenate([st_rel, rel[w]])
        all_dev = np.concatenate([st_dev, dev[w]])
        w = _cell_winners(all_cell, all_key, all_rel)
        st_cell, st_key, st_rel, st_dev = all_cell[w], all_key[w], all_rel[w], all_dev[w]

    # 출력: 승자를 (hash63, rel.x, rel.y, rel.z) 오름차순으로 놓고 앞 max_points 개만 남긴다.
    # 정렬 키에 벌점을 넣지 않는다. 해시 값만으로 정렬해야 앞쪽 일부만 취해도 바닥 점과 바닥 아닌 점이
    # 고르게 섞인 표본이 되고, 상한에서 자를 때도 한쪽만 잘리지 않는다
    hash63 = st_key & _HASH_MASK
    order = np.lexsort((st_rel[:, 2], st_rel[:, 1], st_rel[:, 0], hash63))[:max_points]
    return PointSample(xyz_local=np.ascontiguousarray(st_rel[order]),
                       dev_q=np.ascontiguousarray(st_dev[order]),
                       origin_abs=np.array(lo, dtype=np.float64),
                       sample_cell_m=s, source_points=int(n_seen), cap=int(max_points))

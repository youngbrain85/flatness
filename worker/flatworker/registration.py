"""정합(register) 잡의 점군 처리 — 스캔 두 개 -> 서브셀 중앙값 점군 -> 병합
(세부과업 4 단계 F, 설계 결정 F3·F7·F8).

`jobs.py` 비대화를 막기 위해 분리했다(`slope.py`와 같은 관례). 이 모듈은 DB를
모른다 — 로컬 파일 경로와 numpy 배열만 다룬다. DB·Storage 왕복과 상태 전이는
`jobs.handle_register`가 맡는다.

이 모듈이 지키는 계약 셋(각 함수 독스트링에 근거를 적었다):

1. **`grid_to_points`의 z는 절대 높이가 아니다.** `build_subcell_grid`가 median_z를
   `bbox_min[2]` 상대 높이로 저장하므로, 두 스캔의 bbox가 다르면 오프셋도 서로
   다르다. `load_source_points`가 각 격자의 오프셋을 되돌려 공통 기준으로 맞춘다.
2. **대응점은 파일 단위 월드 좌표다**(설계 결정 F7). `align_sources`가 각 소스의
   `scans.unit_scale`을 곱해 미터로 맞춘다. 두 소스의 배율이 서로 다를 수 있으므로
   각각 자기 배율을 쓴다.
3. **두 소스를 순차로 처리한다**(설계 결정 F3). `build_subcell_grid`의 정렬 버퍼가
   점당 12B라, 두 개를 동시에 들면 실측 피크 1.31GiB 위에 겹쳐 쌓여 2GiB 게이트를
   넘긴다. `load_source_points`는 격자를 만들어 점을 뽑은 뒤 **격자를 즉시 버린다**.
"""
import numpy as np

from flatness.core.registration import grid_to_points, register_clouds
from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import CloudInfo, iter_chunks, read_info

# 병합·정합에 쓰는 서브셀 크기(설계 결정 F3·F8). handle_precheck의 높이 뷰와 달리
# bbox에서 유도하지 않는다 - 이 경로의 입력은 이미 unit_scale로 미터 환산된
# 좌표라서 격자가 폭발할 수 없고(설계 결정 E3이 막으려던 사고는 단위 미확정
# 상태에서만 일어난다), 5cm는 분석 파이프라인이 쓰는 값과 같아야 병합 결과가
# 분석 결과를 바꾸지 않는다.
SUBCELL_M = 0.05


def correspondence_arrays(rows):
    """`registrations.correspondences`(jsonb) -> (A쪽 (N,3), B쪽 (N,3)) 배열.

    ★ 계약(대시보드 Task 5가 맞춰야 하는 정본): 배열의 각 원소는
    `{"a": {"x":.., "y":.., "z":..}, "b": {"x":.., "y":.., "z":..}}`이고
    `a`가 `source_scan_ids[0]`, `b`가 `source_scan_ids[1]`에 대응한다. 값은
    **각 스캔 파일의 단위 그대로인 월드 좌표**다(설계 결정 F7).

    z가 null인 대응점(사이드카 median_z가 NaN인 셀)은 여기서 거부한다 - 0으로
    대체하거나 이웃에서 끌어오면 대응점이 조용히 틀린다(설계 결정 F6). 화면이
    먼저 막지만 워커도 같은 규칙을 들고 있어야 한다.
    """
    if not rows:
        raise ValueError("대응점이 없습니다. 두 스캔에서 같은 지점을 3쌍 이상 찍으세요.")
    a, b = [], []
    for i, row in enumerate(rows):
        try:
            pa, pb = row["a"], row["b"]
            a.append([float(pa["x"]), float(pa["y"]), float(pa["z"])])
            b.append([float(pb["x"]), float(pb["y"]), float(pb["z"])])
        except (TypeError, KeyError, ValueError, IndexError) as e:
            raise ValueError(
                f"{i + 1}번째 대응점의 형식이 올바르지 않습니다(높이를 읽을 수 없는 지점일 수 "
                f"있습니다). 그 지점을 지우고 다시 찍으세요: {row!r}") from e
    return np.array(a, dtype=np.float64), np.array(b, dtype=np.float64)


def load_source_points(path, unit_scale, subcell_m=SUBCELL_M):
    """원본 스캔 파일 하나 -> **미터·절대 z**의 서브셀 중앙값 점군 (M,3).

    ★ 설계 결정 F3(순차 처리): 이 함수는 격자를 만들어 점을 뽑은 **직후 격자를
    버린다.** 호출자는 한 소스를 여기서 끝낸 뒤 다음 소스를 시작해야 한다 -
    `build_subcell_grid`의 정렬 버퍼가 점당 12B라 두 개를 동시에 들면 실측 피크
    1.31GiB 위에 겹쳐 쌓여 2GiB 게이트를 넘긴다.

    ★ z 오프셋 되돌리기: `grid_to_points`의 z는 `bbox_min[2]` **상대값**이다
    (엔진 독스트링의 계약). 두 스캔의 bbox가 다르면 오프셋이 서로 달라, 그대로
    합치면 두 소스의 z가 통째로 어긋난다. 여기서 `bbox_min[2] * unit_scale`을
    더해 파일이 담은 절대 높이(미터)로 되돌린다 - 그래야 화면이 저장한 대응점
    (역시 절대 좌표)과 같은 기준이 된다.
    """
    if unit_scale is None:
        raise ValueError(
            "스캔의 단위가 확정되지 않아 정합할 수 없습니다. 업로드 화면에서 단위를 먼저 확인하세요.")
    scale = float(unit_scale)
    info = read_info(path)
    grid = build_subcell_grid(iter_chunks(path), info, scale, subcell_m)
    pts = grid_to_points(grid)
    del grid            # 다음 소스의 정렬 버퍼가 이 위에 겹쳐 쌓이지 않게 한다
    if len(pts) == 0:
        raise ValueError(
            "유효한 서브셀이 없어 정합할 수 없습니다. 점 밀도가 너무 낮거나 파일이 손상됐습니다.")
    pts[:, 2] += float(info.bbox_min[2]) * scale
    return pts


def align_sources(pts_src, pts_dst, corr_src, corr_dst, scale_src, scale_dst):
    """대응점을 각 소스의 `unit_scale`로 미터 환산한 뒤 정합한다.

    ★ 화면이 저장한 대응점은 **파일 단위 월드 좌표**다(설계 결정 F7). 점군은
    `load_source_points`가 이미 미터로 환산했으므로, 대응점만 그대로 넘기면
    mm 파일에서 1000배 틀린다. 두 소스의 `unit_scale`이 서로 다를 수도 있으므로
    각각 자기 배율을 쓴다.
    """
    return register_clouds(pts_src, pts_dst,
                           np.asarray(corr_src, dtype=np.float64) * float(scale_src),
                           np.asarray(corr_dst, dtype=np.float64) * float(scale_dst))


def apply_transform(pts, transform):
    """4x4 동차 변환을 (N,3) 점군에 적용한다."""
    t = np.asarray(transform, dtype=np.float64)
    return np.asarray(pts, dtype=np.float64) @ t[:3, :3].T + t[:3, 3]


def transform_to_json(transform):
    """4x4 변환 -> `registrations.transform`(jsonb)에 넣을 순수 파이썬 중첩 리스트.

    ndarray나 numpy 스칼라를 그대로 넘기면 `SupabaseRest`가 쓰는 httpx의
    `json=` 직렬화가 `TypeError: Object of type float64 is not JSON
    serializable`로 죽는다 - PostgREST에 요청을 보내기도 전에, 정합을 다 끝낸
    뒤에. FakeDB는 파이썬 객체를 그대로 담아 두므로 이 회귀를 구조적으로 잡지
    못한다(테스트는 저장된 값이 실제로 json 직렬화되는지를 따로 단언한다).
    """
    return np.asarray(transform, dtype=np.float64).tolist()


def merge_clouds(pts_dst, pts_src_aligned, subcell_m=SUBCELL_M):
    """정합된 두 점군을 **같은 격자에 다시 넣어 서브셀 중앙값**을 뽑는다(설계 결정 F8).

    중첩 서브셀에는 두 소스의 점이 함께 들어가므로 가중치 없이 이상치에 강하다.
    분석은 어차피 서브셀 중앙값만 쓰므로 결과가 달라지지 않는다.

    두 가지를 기본값에서 벗어나게 준다. 둘 다 "입력이 이미 서브셀 중앙값"이라는
    이 호출부의 특수 사정에서 온다:

    - `min_points=1`: 입력은 셀당 1점(각 소스의 중앙값)이라 중첩 셀이라야 2점이다.
      기본값 3을 그대로 쓰면 **병합 점군이 통째로 비어버린다**(전부 NaN).
      각 점은 이미 원본 3점 이상의 중앙값이므로 신뢰도 마스크는 앞 단계에서
      이미 적용됐다.
    - 격자 원점을 **반 셀 앞으로** 당긴다: 입력 점이 전부 셀 중심 좌표라, 두
      소스의 격자 원점이 우연히 서브셀 배수만큼 떨어져 있으면(같은 방위로 스캔한
      흔한 경우) 점이 격자 경계선에 정확히 얹힌다. 그러면 `int(rel/subcell)`이
      부동소수 반올림에 따라 같은 줄의 점을 이웃 셀로 흩뿌린다. 반 셀 당기면
      모든 입력 점이 셀 한가운데에 놓여 그 경계 사례가 사라진다.
    """
    pts = np.vstack([np.asarray(pts_dst, dtype=np.float64),
                     np.asarray(pts_src_aligned, dtype=np.float64)])
    pad = np.array([subcell_m / 2.0, subcell_m / 2.0, 0.0])
    lo = pts.min(axis=0) - pad
    hi = pts.max(axis=0) + pad
    info = CloudInfo(n_points=len(pts), bbox_min=lo, bbox_max=hi)
    grid = build_subcell_grid([pts], info, 1.0, subcell_m, min_points=1)
    merged = grid_to_points(grid)
    del grid
    if len(merged) == 0:
        raise ValueError("병합 결과가 비었습니다. 정합된 두 점군이 실제로 겹치는지 확인하세요.")
    merged[:, 2] += float(lo[2])     # grid_to_points의 z는 bbox_min[2] 상대값이다
    return merged

"""높이 뷰 PNG + 사이드카 — 단위 확정 전 "이 방이 8m인가 80cm인가"를 사용자가
눈으로 가늠하게 돕는 평면도 시각화 (세부과업 4 단계 E, 설계 결정 E2~E4).

정밀 편차맵(outputs/deviation.py)과 목적이 다르다: 편차맵은 판정 이후 원시 편차의
분포를 보여주지만, 이 모듈은 판정 이전 - 심지어 파일이 m·cm·mm 중 무엇인지도
모르는 시점에 - 위에서 내려다본 상대 높이 자체를 보여준다. 그래서 구조는
deviation.py를 그대로 본뜨되(Agg·한글 폰트 부수효과 import, pool_nanmean·_figsize
재사용) 두 가지를 바꾼다:

  - 컬러맵: 편차는 부호가 있어(+ 융기 / - 침하) RdYlGn_r을 0 중심 대칭 정규화
    (vmin=-vmax)로 썼다. 그런데 build_subcell_grid의 median_z는 이미 bbox 최저
    z 기준 상대 높이라 값이 전부 0 이상이다. 대칭 정규화를 그대로 쓰면 컬러맵
    절반이 낭비되고 바닥 전체가 한 색으로 뭉개진다(설계 결정 E4) - 그래서
    순차형(viridis)을 쓴다.
  - 단위: 이 단계는 파일 단위를 모르는 채로 호출된다. 그래서 축·컬러바 라벨은
    "m"이 아니라 "파일 단위"라고 명시한다 - 값에 임의의 단위를 붙이면 사용자가
    그 라벨을 실제 단위로 오인할 위험이 있다.

격자 폭발 방지(설계 결정 E3): 단위 확정 전이라 파일 단위를 모른다. mm 단위
파일(폭 8000)에 subcell_m=0.05를 그대로 주면 nx=160,000이 되어 median_z 배열이
테라바이트급으로 폭발한다. subcell_m_for_bbox가 bbox 범위에서 서브셀 크기를
유도하므로(긴 변 / target_long_side) 파일 단위와 무관하게 격자가 항상
target_long_side 이하로 묶인다.
"""
import json
import math

import matplotlib
import numpy as np

from flatness.outputs import heatmap as _engine_heatmap  # noqa: F401  Agg·한글 폰트 설정 재사용(부수효과 import) - 반드시 필요, 없으면 리눅스에서 한글 제목이 네모 박스가 된다
from flatness.outputs.deviation import _figsize, pool_nanmean
import matplotlib.pyplot as plt

# 파일 구조가 바뀔 때만 올린다. slope_cells.py의 SCHEMA_VERSION 관례를 따른다.
SCHEMA_VERSION = 1

_TARGET_LONG_SIDE = 512          # PNG 해상도 = Z 조회 격자 해상도 (격자 폭발 방지, E3)
HEIGHT_VIEW_CMAP = "viridis"     # 순차형 - 값이 전부 0 이상인 상대 높이용(E4)
_NA_COLOR = "#e8e8e8"            # 데이터 없는 서브셀(NaN, 저밀도 마스크)
_MIN_RANGE = 1e-6                # 완전 평탄면에서 vmin==vmax 정규화 퇴화 방지

_REQUIRED_META_KEYS = ("schema_version", "bbox_min", "bbox_max",
                       "subcell_m_file", "shape", "median_z")


def subcell_m_for_bbox(info, target_long_side=_TARGET_LONG_SIDE):
    """bbox 긴 변을 target_long_side 칸으로 나눈 서브셀 크기(파일 단위)를 반환한다.

    단위 확정 전이라 파일이 m·cm·mm 중 무엇인지 모른다. build_subcell_grid의
    subcell_m을 고정 상수(예: 0.05)로 주면 mm 단위 파일(폭 8000)에서
    nx=8000/0.05=160,000이 되어 median_z 배열이 테라바이트급으로 폭발한다
    (설계 결정 E3). bbox 범위에서 서브셀 크기를 역산하면 파일 단위와 무관하게
    격자가 항상 target_long_side 이하로 묶인다.

    긴 변(max(dx, dy)) 기준이어야 한다 - 짧은 변 기준이면 긴 변 쪽 칸 수가
    target_long_side를 넘어 격자 폭발 방지가 무력화된다.
    """
    dx = float(info.bbox_max[0] - info.bbox_min[0])
    dy = float(info.bbox_max[1] - info.bbox_min[1])
    long_side = max(dx, dy)
    if long_side <= 0:
        return 1.0  # 퇴화 bbox(점 하나·모든 점이 같은 XY) 방어 - 0 나눗셈 회피
    return long_side / target_long_side


def render_height_view(grid, out_path, title="높이 뷰 (평면도)",
                       xlabel="X (파일 단위)", ylabel="Y (파일 단위)",
                       cbar_label="상대 높이 (파일 단위, bbox 최저 Z 기준)"):
    """서브셀 격자의 median_z를 위에서 내려다본 PNG로 저장하고 파일명을 반환한다.

    subcell_m_for_bbox로 만든 grid는 이미 긴 변 기준 target_long_side 이하이므로
    추가 다운샘플링이 필요 없다 - factor=1로 pool_nanmean을 호출해 deviation.py와
    같은 NaN 처리 경로(전부 NaN인 블록은 NaN 유지)를 그대로 따르게 하되, 실제
    값 자체는 바꾸지 않는다.

    편차맵(render_deviation_map)과 달리 유효값이 하나도 없어도 None을 반환하지
    않고 항상 파일을 만든다 - 이 그림은 판정 보조가 아니라 단위 확정의 유일한
    단서라 "산출물이 아예 없음"보다 "빈 회색 이미지"가 낫다.
    """
    img = pool_nanmean(grid.median_z, 1)
    finite = np.isfinite(img)
    if finite.any():
        vmin = float(np.nanmin(img))
        vmax = float(np.nanmax(img))
        if vmax - vmin < _MIN_RANGE:
            vmax = vmin + _MIN_RANGE
    else:
        vmin, vmax = 0.0, 1.0  # 전부 NaN이어도 정규화가 죽지 않도록 임의 범위
    ny, nx = img.shape
    size_m = grid.size_m
    ox, oy = float(grid.origin[0]), float(grid.origin[1])
    cmap = matplotlib.colormaps[HEIGHT_VIEW_CMAP].with_extremes(bad=_NA_COLOR)
    fig, ax = plt.subplots(figsize=_figsize(nx * size_m, ny * size_m))
    im = ax.imshow(np.ma.masked_invalid(img), cmap=cmap, vmin=vmin, vmax=vmax,
                   origin="lower", interpolation="nearest",
                   extent=[ox, ox + nx * size_m, oy, oy + ny * size_m])
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.set_aspect("equal")
    fig.colorbar(im, ax=ax, shrink=0.85, label=cbar_label)
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
    return out_path.name


def _median_z_to_json_rows(median_z):
    """median_z(np.ndarray, NaN 포함) -> JSON 직렬화 가능한 중첩 리스트(NaN -> None).

    RFC 8259 표준 JSON에는 NaN 토큰이 없어 브라우저 JSON.parse·Postgres jsonb가
    조용히 거부한다(core/pipeline.py·slope_cells.py와 동일한 관례) - 그래서 여기서
    미리 None으로 치환한다. dump 쪽에서 allow_nan=False를 같이 걸어 두면, 만에
    하나 이 치환이 빠지거나 새 NaN 경로가 생겨도 조용히 NaN 토큰을 내보내는 대신
    바로 예외로 터진다.
    """
    return [[None if math.isnan(v) else v for v in row] for row in median_z.tolist()]


def _median_z_from_json_rows(rows, shape):
    ny, nx = shape
    flat = [np.nan if v is None else v for row in rows for v in row]
    return np.array(flat, dtype=np.float32).reshape(ny, nx)


def dump_height_view_meta(grid, info, path):
    """높이 뷰 사이드카(height_view.json)를 쓴다.

    slope_cells.dump_slope_cells의 계약 패턴을 복제한다: SCHEMA_VERSION 상수,
    ensure_ascii=False, allow_nan=False, 필수 키 결측/미지원 버전은 load 쪽에서
    한국어 ValueError로 거부(§ load_height_view_meta 참고).

    담는 값: schema_version, bbox_min/bbox_max(정보 스캔이 읽은 원본 bbox, 파일
    단위 그대로), subcell_m_file(이 grid를 만들 때 쓴 서브셀 크기, 파일 단위),
    shape[ny,nx], median_z(bbox 최저 z 기준 상대 높이, NaN -> null).

    PNG 해상도와 이 median_z 격자 해상도를 같게 맞춘다 - 호출부가
    subcell_m_for_bbox로 만든 grid를 render_height_view와 이 함수 양쪽에
    그대로 넘긴다는 전제다. 정합 단계(§6.2)가 "클릭한 XY의 서브셀 중앙값에서
    Z를 읽는다"고 요구했는데, 화면이 보는 그림과 좌표를 읽어올 격자가 다르면
    클릭 위치와 실제 조회되는 셀이 어긋난다.
    """
    ny, nx = grid.shape
    payload = {
        "schema_version": SCHEMA_VERSION,
        "bbox_min": [float(v) for v in info.bbox_min],
        "bbox_max": [float(v) for v in info.bbox_max],
        "subcell_m_file": float(grid.size_m),
        "shape": [ny, nx],
        "median_z": _median_z_to_json_rows(grid.median_z),
    }
    with open(path, "w", encoding="utf-8") as f:
        # allow_nan=False: _median_z_to_json_rows가 이미 nan -> null로 치환했다.
        # 그런데도 nan이 남아 있다면(치환 누락 등 버그) 조용히 NaN 토큰을 내보내느니
        # 여기서 바로 예외로 터뜨리는 편이 낫다(core/pipeline.py·slope_cells.py와
        # 동일한 관례).
        json.dump(payload, f, ensure_ascii=False, allow_nan=False)
    return str(path)


def load_height_view_meta(path):
    """height_view.json -> dict. dump_height_view_meta의 역함수다.

    반환 dict: schema_version, bbox_min/bbox_max(np.ndarray, float64),
    subcell_m_file(float), shape(tuple), median_z(np.ndarray, float32, NaN 복원).

    필수 키 결측·미지원 스키마 버전은 raw KeyError가 아니라 한국어 ValueError로
    거부한다 - slope_cells.load_slope_cells의 계약 패턴을 복제한다. 검증 없이
    payload["bbox_min"] 등을 대괄호로 바로 읽으면 옛/손상 파일에서 raw
    KeyError가 나는데, 그 메시지는 운영자에게 아무것도 알려주지 않는다(단계 D의
    실제 전례: load_slope_cells가 KeyError: 'cell_m'으로 죽어 아무것도 못
    알려준 사건).
    """
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)

    missing = [k for k in _REQUIRED_META_KEYS if k not in payload]
    if missing:
        raise ValueError(
            f"높이 뷰 메타 파일 형식이 올바르지 않습니다({path}): "
            f"필수 항목 누락 {missing}. schema_version {SCHEMA_VERSION} 형식의 "
            "height_view.json이어야 합니다."
        )
    if payload["schema_version"] != SCHEMA_VERSION:
        raise ValueError(
            f"지원하지 않는 높이 뷰 메타 파일 버전입니다({path}): "
            f"schema_version={payload['schema_version']!r} "
            f"(이 엔진이 지원하는 버전은 {SCHEMA_VERSION}입니다)."
        )

    ny, nx = payload["shape"]
    return {
        "schema_version": payload["schema_version"],
        "bbox_min": np.array(payload["bbox_min"], dtype=np.float64),
        "bbox_max": np.array(payload["bbox_max"], dtype=np.float64),
        "subcell_m_file": float(payload["subcell_m_file"]),
        "shape": (ny, nx),
        "median_z": _median_z_from_json_rows(payload["median_z"], (ny, nx)),
    }

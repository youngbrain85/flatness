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

기본 target_long_side는 512가 아니라 256이다(1차 리뷰 실측 반영). 8m x 6m
바닥을 다양한 점 수로 합성해 512 vs 256의 NaN 비율(저밀도라 신뢰 불가로
표시되는 서브셀 비율)을 실측하면:

    점 수         512 NaN 비율   256 NaN 비율   256 점유 셀당 평균 점수
    200,000       91.7%          22.9%          4.1
    500,000       53.2%          0.3%           10.2
    1,000,000     11.7%          0.0%           20.3

실사용 규모(수십만 점)에서 512는 화면 대부분이 회색 얼룩이 되어 "이 방이
8m인가 80cm인가를 눈으로 판단하라"는 이 기능의 목적 자체가 무너진다. 256은
셀당 점 수가 4배로 늘어 median의 표준오차도 줄어든다(부수 효과) - 클릭
해상도는 굵어지지만(31mm급) 배수구·대응점 지정(단계 F)에는 충분하다. 사이드카
용량도 셀 수가 1/4로 줄어 함께 작아진다.
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

_TARGET_LONG_SIDE = 256          # PNG 해상도 = Z 조회 격자 해상도 (격자 폭발 방지, E3).
                                  # 512였다가 1차 리뷰 실측(모듈 docstring 표)으로 256으로
                                  # 낮췄다 - 512는 실사용 점 수에서 대부분 회색(NaN)이었다.
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
    단서라 "산출물이 아예 없음"보다 "빈 이미지"가 낫다(축 눈금은 진짜 bbox
    값이라 그것만으로도 단위 확정에 도움이 된다).

    다만 전부 NaN이면 컬러바는 만들지 않는다(1차 리뷰 실측: 폴백 vmin=0,vmax=1
    범위를 "상대 높이" 라벨과 함께 컬러바로 보여주면, 축 눈금은 진짜인데
    컬러바만 가짜 값을 당당히 표시하는 꼴이 된다). 대신 한국어 주석으로 데이터
    없음을 명시한다.
    """
    img = pool_nanmean(grid.median_z, 1)
    finite = np.isfinite(img)
    if finite.any():
        vmin = float(np.nanmin(img))
        vmax = float(np.nanmax(img))
        if vmax - vmin < _MIN_RANGE:
            vmax = vmin + _MIN_RANGE
    else:
        vmin, vmax = 0.0, 1.0  # 전부 NaN이어도 정규화가 죽지 않도록 임의 범위(컬러바는 안 만든다)
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
    if finite.any():
        fig.colorbar(im, ax=ax, shrink=0.85, label=cbar_label)
    else:
        # 데이터가 하나도 없는데 컬러바를 그리면 폴백 범위(0~1)를 실제 값처럼
        # 보여주는 거짓 표시가 된다(1차 리뷰 지적) - 컬러바 대신 주석으로 명시한다.
        ax.text(0.5, 0.5, "유효 데이터 없음 - 점 밀도 부족", transform=ax.transAxes,
               ha="center", va="center", fontsize=11, color="#c5221f",
               bbox=dict(facecolor="white", alpha=0.85, edgecolor="none"))
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
    return out_path.name


def render_height_view_plain(grid, out_path):
    """장식 없는 높이 뷰 PNG - 격자 1칸 = 이미지 1픽셀, 축·제목·컬러바·여백이 없다.

    render_height_view가 만드는 PNG는 matplotlib 장식(제목·여백·컬러바)이 붙어
    있어 브라우저에서 클릭한 픽셀 좌표만으로는 월드 좌표를 역산할 수 없다(1차
    리뷰 지적 - 정합 단계 F가 여기서 막힌다). matplotlib의 axes 픽셀 bbox를
    fig.canvas 렌더 후 역산하는 방법(axes_rect_px)도 가능하지만, dpi·
    tight_layout·matplotlib 버전에 따라 결과가 달라질 수 있어 더 무겁고
    깨지기 쉽다고 판단해 채택하지 않았다. 대신 장식이 아예 없는 이미지를
    하나 더 낸다 - 좌표 환산이 항상 결정적이다(plt.imsave는 입력 배열의
    shape과 정확히 같은 픽셀 크기로 저장한다).

    좌표 계약(사이드카의 shape[ny,nx]와 함께 쓴다):
      - 이미지 크기: 가로 nx픽셀 x 세로 ny픽셀 - 사이드카의 shape과 정확히
        같다. 별도 image_size_px 필드가 필요 없다.
      - 픽셀 (px, py)(좌상단 원점, 이미지 표준 관례, 0-index) -> 격자 인덱스:
            ix = px
            iy = ny - 1 - py
        (이미지는 위가 화면상 처음 행이고, 격자는 origin이 최저 좌표(아래)
        기준이라 세로가 뒤집힌다 - render_height_view의 origin="lower"와
        같은 관례다)
      - 격자 인덱스 -> 월드 좌표(파일 단위, bbox_min/bbox_max와 같은 단위):
            world_x = bbox_min[0] + (ix + 0.5) * subcell_m_file
            world_y = bbox_min[1] + (iy + 0.5) * subcell_m_file
        (grid.origin이 곧 bbox_min[:2]이므로 - 설계 결정 E3 - bbox_min을
        그대로 써도 된다. 별도 센터링이 필요 없다는 원칙이 여기서도 성립한다)

    NaN 서브셀은 render_height_view와 동일하게 _NA_COLOR로 마스킹된다. 전부
    NaN이어도(색상 없이) 파일은 만든다 - 이 이미지는 표시용이 아니라 좌표
    환산용이라 render_height_view 같은 "거짓 컬러바" 문제가 없다(컬러바
    자체가 없다).
    """
    img = grid.median_z
    finite = np.isfinite(img)
    if finite.any():
        vmin = float(np.nanmin(img))
        vmax = float(np.nanmax(img))
        if vmax - vmin < _MIN_RANGE:
            vmax = vmin + _MIN_RANGE
    else:
        vmin, vmax = 0.0, 1.0
    cmap = matplotlib.colormaps[HEIGHT_VIEW_CMAP].with_extremes(bad=_NA_COLOR)
    plt.imsave(out_path, np.ma.masked_invalid(img), cmap=cmap, vmin=vmin, vmax=vmax,
              origin="lower")
    return out_path.name


def _median_z_to_json_array_text(median_z):
    """median_z(np.ndarray, float32, NaN 포함) -> JSON 배열 텍스트(NaN -> null).

    RFC 8259 표준 JSON에는 NaN 토큰이 없어 브라우저 JSON.parse·Postgres jsonb가
    조용히 거부한다(core/pipeline.py·slope_cells.py와 동일한 관례) - 그래서 여기서
    미리 null로 치환한다.

    숫자를 json 표준 인코더에 맡기지 않고 직접 ".9g"로 포맷한다(1차 리뷰 실측
    반영). median_z는 float32인데 float(np.float32(v))로 그냥 float64로
    확대해 json에 넘기면, json이 float64 기준 최단 왕복 repr을 쓰느라
    "18.6158504486084"처럼 15~17자리가 나온다 - float32 유효자리는 7~9자리뿐이라
    9자리를 넘는 나머지는 float32에 없던 정보(float64 확대 과정의 이진 오차가
    십진수로 드러난 것)라 전부 쓰레기다. 반대로 ".9g"(9 유효자리)로 직접
    포맷하면 다시 float32로 캐스팅했을 때 원본과 비트 단위로 완전히 같은 값이
    복원된다(리뷰 실측 196,141개 전수 tobytes() 일치, 이 저장소 자체 재검증
    20만개 표본도 불일치 0건) - 반올림이 아니라 float32가 이미 정본이므로
    무손실이면서 파일 크기만 약 40% 줄어든다.
    """
    rows = []
    for row in median_z:
        cells = ["null" if math.isnan(v) else format(float(v), ".9g") for v in row]
        rows.append("[" + ",".join(cells) + "]")
    return "[" + ",".join(rows) + "]"


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
    header = {
        "schema_version": SCHEMA_VERSION,
        "bbox_min": [float(v) for v in info.bbox_min],
        "bbox_max": [float(v) for v in info.bbox_max],
        "subcell_m_file": float(grid.size_m),
        "shape": [ny, nx],
    }
    # allow_nan=False: header 필드(bbox 등)에 혹시라도 nan/inf가 섞여 있으면
    # 조용히 통과시키느니 여기서 바로 예외로 터뜨리는 편이 낫다(core/pipeline.py·
    # slope_cells.py와 동일한 관례). median_z는 표준 json 인코더를 거치지 않고
    # _median_z_to_json_array_text가 직접 ".9g" 텍스트로 만들어 뒤에 이어붙인다
    # (1차 리뷰 반영 - float64 최단 왕복 repr을 쓰면 float32 유효자리를 넘는
    # 쓰레기 자리가 그대로 파일에 남는다).
    header_json = json.dumps(header, ensure_ascii=False, allow_nan=False)
    median_json = _median_z_to_json_array_text(grid.median_z)
    assert header_json.endswith("}")
    text = header_json[:-1] + f', "median_z": {median_json}}}'
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
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

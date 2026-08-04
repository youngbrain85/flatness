"""높이 뷰(height_view.py) - 격자 폭발 방지, PNG 렌더, 사이드카 왕복 검증.

계획: .superpowers/sdd/2026-08-04-slope-phase-e/task-1-brief.md (설계 결정 E2~E4)
1차 리뷰 반영: 격자 기본값 512->256, .9g 압축, 기본값 자체 검증, subcell_m_file
항등식 회피, 정규화 방식 검증, 전부 NaN일 때 거짓 컬러바 방지, 플레인 PNG.
"""
import json
import math
import re

import matplotlib.axes
import matplotlib.figure
import numpy as np
import PIL.Image
import pytest

from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import CloudInfo
from flatness.outputs import heatmap
from flatness.outputs.height_view import (SCHEMA_VERSION, dump_height_view_meta,
                                          load_height_view_meta, render_height_view,
                                          render_height_view_plain, subcell_m_for_bbox)
from tests.fixtures.synthetic import add_bump, flat_floor


def _info(bbox_min, bbox_max, n_points=1000):
    return CloudInfo(n_points=n_points,
                     bbox_min=np.array(bbox_min, dtype=np.float64),
                     bbox_max=np.array(bbox_max, dtype=np.float64))


def _sparse_grid():
    """NaN 서브셀(1점)과 유효 서브셀(3점 이상)이 함께 있는 작은 격자(subcell_m=0.05 고정).

    test_subcell.py의 test_sparse_subcell_is_nan과 같은 픽스처 패턴. subcell_m을
    고정값으로 직접 지정하므로, subcell_m_file 값 자체를 검증하는 테스트에는
    쓰지 않는다(아래 _sparse_grid_distinct_subcell_m 참고 - 1차 리뷰 M8).
    """
    pts = np.array([[0.01, 0.01, 0.5], [0.07, 0.01, 0.0],
                    [0.08, 0.02, 0.0], [0.07, 0.03, 0.0]])
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    grid = build_subcell_grid([pts], info, scale_to_m=1.0, subcell_m=0.05)
    return grid, info


def _sparse_grid_distinct_subcell_m():
    """_sparse_grid와 같은 점 배치를 subcell_m_for_bbox가 유도한(0.05가 아닌)
    서브셀 크기로 다시 만든다.

    1차 리뷰 M8: _sparse_grid()의 subcell_m이 우연히 0.05라, dump_height_view_meta가
    subcell_m_file을 실수로 0.05 하드코딩해도 두 사이드카 테스트가 구분하지
    못했다(항등식). target_long_side=2로 도출한 0.035는 0.05와 다르므로 하드코딩
    여부가 실제로 갈린다. 클러스터링(1점 셀 vs 3점 셀)은 _sparse_grid와 동일하게
    유지된다(engine 콘솔로 사전 확인).
    """
    pts = np.array([[0.01, 0.01, 0.5], [0.07, 0.01, 0.0],
                    [0.08, 0.02, 0.0], [0.07, 0.03, 0.0]])
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    s = subcell_m_for_bbox(info, target_long_side=2)
    assert s != 0.05, "픽스처가 우연히 0.05와 같아지면 이 테스트의 목적이 사라진다"
    grid = build_subcell_grid([pts], info, scale_to_m=1.0, subcell_m=s)
    return grid, info


def _png_dimensions_px(path):
    """PNG IHDR 청크에서 (width, height)를 직접 읽는다(디코드 없이 헤더만)."""
    with PIL.Image.open(path) as im:
        return im.size


# ---------------------------------------------------------------------------
# Step 1: 격자 폭발 방지
# ---------------------------------------------------------------------------

def test_subcell_size_caps_grid_regardless_of_file_unit():
    """단위 확정 전이라 파일 단위를 모른다. mm 파일에 0.05를 주면 nx=160,000이다."""
    for scale in (1.0, 100.0, 1000.0):   # m, cm, mm 단위 파일
        info = _info(bbox_min=(0, 0, 0), bbox_max=(8 * scale, 6 * scale, 0.1 * scale))
        s = subcell_m_for_bbox(info, target_long_side=512)
        nx = int(np.ceil(8 * scale / s))
        assert nx <= 512


def test_subcell_size_uses_long_side_not_short_side():
    """긴 변(x=8) 기준이어야 한다 - 짧은 변(y=2) 기준이면 x쪽 칸 수가 512를 넘는다."""
    info = _info(bbox_min=(0, 0, 0), bbox_max=(8.0, 2.0, 0.1))
    s = subcell_m_for_bbox(info, target_long_side=512)
    nx = int(np.ceil(8.0 / s))
    ny = int(np.ceil(2.0 / s))
    assert nx <= 512 and ny <= 512
    assert nx == 512  # 긴 변이 정확히 target_long_side 칸에 맞아떨어져야 한다


def test_subcell_size_for_degenerate_bbox_does_not_divide_by_zero():
    """모든 점이 같은 XY(폭 0)여도 ZeroDivisionError 없이 값을 반환해야 한다."""
    info = _info(bbox_min=(1.0, 1.0, 0.0), bbox_max=(1.0, 1.0, 0.5))
    s = subcell_m_for_bbox(info)
    assert s > 0 and np.isfinite(s)


def test_subcell_m_for_bbox_default_matches_production_target():
    """인자 없이 부른 결과(Task 2가 실제로 이렇게 부른다)의 격자 크기를 직접
    단언한다.

    1차 리뷰 M6: 다른 격자 테스트는 전부 target_long_side를 명시적으로 넘겨서
    부르므로 기본값 자체를 검증하지 못했다(_TARGET_LONG_SIDE를 2048로 바꿔도
    기존 13개가 전부 통과했다 - 사이드카 61MB, 격자 폭발 방지가 무력화된 상태).
    """
    info = _info(bbox_min=(0, 0, 0), bbox_max=(8.0, 6.0, 0.1))
    s = subcell_m_for_bbox(info)  # target_long_side 인자 없음
    nx = int(np.ceil(8.0 / s))
    ny = int(np.ceil(6.0 / s))
    assert nx == 256   # 512였다가 1차 리뷰로 256으로 낮춘 그 기본값
    assert ny <= 256


# ---------------------------------------------------------------------------
# Step 3: 사이드카 왕복
# ---------------------------------------------------------------------------

def test_height_view_meta_roundtrip_is_lossless(tmp_path):
    grid, info = _sparse_grid_distinct_subcell_m()
    assert np.isnan(grid.median_z).any()          # NaN 셀이 실제로 있어야 의미 있다
    assert np.isfinite(grid.median_z).any()        # 유효 셀도 있어야 한다

    path = tmp_path / "height_view.json"
    dump_height_view_meta(grid, info, path)
    meta = load_height_view_meta(str(path))

    assert meta["schema_version"] == SCHEMA_VERSION
    np.testing.assert_allclose(meta["bbox_min"], info.bbox_min)
    np.testing.assert_allclose(meta["bbox_max"], info.bbox_max)
    assert meta["subcell_m_file"] == grid.size_m   # grid.size_m이 0.05가 아니므로 항등식이 아니다
    assert tuple(meta["shape"]) == tuple(grid.shape)

    # nan != nan 함정: isnan 마스크를 먼저 비교하고, 유효값만 따로 비교한다
    orig_nan = np.isnan(grid.median_z)
    restored_nan = np.isnan(meta["median_z"])
    np.testing.assert_array_equal(orig_nan, restored_nan)
    np.testing.assert_array_equal(grid.median_z[~orig_nan], meta["median_z"][~orig_nan])

    raw = path.read_text(encoding="utf-8")
    assert "NaN" not in raw   # RFC 8259 위반 토큰이 없어야 한다(allow_nan=False)
    assert "null" in raw      # NaN이 null로 치환됐는지 직접 확인


def test_height_view_meta_stores_required_fields(tmp_path):
    grid, info = _sparse_grid_distinct_subcell_m()
    path = tmp_path / "height_view.json"
    dump_height_view_meta(grid, info, path)

    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["schema_version"] == SCHEMA_VERSION
    assert raw["bbox_min"] == [float(v) for v in info.bbox_min]
    assert raw["bbox_max"] == [float(v) for v in info.bbox_max]
    assert raw["subcell_m_file"] == grid.size_m
    assert raw["shape"] == list(grid.shape)
    assert len(raw["median_z"]) == grid.shape[0]
    assert len(raw["median_z"][0]) == grid.shape[1]


def test_height_view_meta_median_z_is_bit_exact_and_compact(tmp_path):
    """.9g 포맷이 float32 정밀도를 정확히 보존하면서(tobytes 비트 단위 일치)
    float64 최단 왕복 repr보다 훨씬 짧은 자릿수로 저장되는지 확인한다.

    1차 리뷰 실측(196,141개 전수 tobytes 일치)의 저장소 자체 재현이다. 값만
    비교하면(허용오차 비교) .9g를 빼고 float64 repr로 되돌려도 통과해 버리므로,
    자릿수(글자 수) 단언을 반드시 같이 걸어야 그 회귀를 잡는다.
    """
    pts = add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02, tilt=(0.013, -0.021),
                              noise_sd=0.0007), (2.0, 1.5), 0.4, 0.5)
    info = _info(pts.min(axis=0), pts.max(axis=0), n_points=len(pts))
    s = subcell_m_for_bbox(info, target_long_side=80)
    grid = build_subcell_grid([pts.astype(np.float32)], info, scale_to_m=1.0, subcell_m=s)
    assert np.isfinite(grid.median_z).sum() > 100  # 표본이 충분해야 의미 있다

    path = tmp_path / "height_view.json"
    dump_height_view_meta(grid, info, path)
    meta = load_height_view_meta(str(path))

    orig_nan = np.isnan(grid.median_z)
    # allclose가 아니라 tobytes 완전 일치 - 반올림이 아니라 무손실이어야 한다
    assert grid.median_z[~orig_nan].tobytes() == meta["median_z"][~orig_nan].tobytes()

    raw = path.read_text(encoding="utf-8")
    # bbox_min/bbox_max는 원래 float64라 자릿수 제한 대상이 아니다(정밀도가
    # 실제로 그만큼 있다) - median_z 부분만 잘라서 검사해야 한다.
    median_text = raw[raw.index('"median_z":'):]

    # 절대 자릿수 상한(예: "12자")은 값의 크기(선행 0 개수)에 따라 흔들려서
    # 깨지기 쉽다(0에 가까운 값은 유효자리는 9개뿐이어도 선행 0 때문에 길어진다).
    # 대신 "이 값들을 float64 repr(json 기본 인코더)로 썼다면 얼마나 길었을까"와
    # 직접 비교한다 - .9g를 빼는 변이가 있으면 이 비율이 거의 1.0이 되어 잡힌다.
    finite_vals = grid.median_z[~orig_nan].tolist()
    naive_text = ",".join(repr(float(v)) for v in finite_vals)
    compact_text = ",".join(format(float(v), ".9g") for v in finite_vals)
    assert len(compact_text) < len(naive_text) * 0.85, (
        f"압축이 충분하지 않다(.9g가 실제로 적용됐는지 의심): "
        f"naive={len(naive_text)}자, compact={len(compact_text)}자"
    )
    # 실제 파일에 쓰인 텍스트가 naive(float64 repr)가 아니라 compact(.9g) 쪽과
    # 같은 길이대인지도 확인한다 - naive_text 길이만큼 median_text가 길면 반영이
    # 안 된 것이다.
    assert len(median_text) < len(naive_text)


def test_load_height_view_meta_rejects_missing_keys_with_korean_message(tmp_path):
    """필수 키(bbox_min 등)가 없으면 raw KeyError가 아니라 한국어 ValueError로
    거부해야 한다 - 단계 D에서 load_slope_cells가 KeyError: 'cell_m'으로 죽어
    운영자에게 아무것도 못 알려준 전례를 반복하지 않는다."""
    path = tmp_path / "height_view_broken.json"
    path.write_text(json.dumps({
        "schema_version": SCHEMA_VERSION,
        "bbox_max": [1.0, 1.0, 0.1],
        "subcell_m_file": 0.05,
        "shape": [1, 1],
        "median_z": [[0.0]],
        # bbox_min 누락
    }), encoding="utf-8")

    with pytest.raises(ValueError) as exc_info:
        load_height_view_meta(str(path))
    msg = str(exc_info.value)
    assert "bbox_min" in msg
    assert not isinstance(exc_info.value, KeyError)


def test_load_height_view_meta_rejects_unsupported_schema_version(tmp_path):
    path = tmp_path / "height_view_future.json"
    path.write_text(json.dumps({
        "schema_version": 99,
        "bbox_min": [0.0, 0.0, 0.0], "bbox_max": [1.0, 1.0, 0.1],
        "subcell_m_file": 0.05, "shape": [1, 1], "median_z": [[0.0]],
    }), encoding="utf-8")

    with pytest.raises(ValueError) as exc_info:
        load_height_view_meta(str(path))
    assert "schema_version" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Step 4: 렌더가 실제로 그림을 만드는가
# ---------------------------------------------------------------------------

def test_render_height_view_writes_nonempty_png(tmp_path):
    # target_long_side=80 -> subcell_m=0.05(4.0/80), 기존 관례(spacing 0.02에 subcell
    # 0.05)와 맞춘다. 렌더 테스트의 목적은 격자 폭발 방지(Step 1에서 이미 검증)가
    # 아니라 PNG 산출 자체이므로, 기본 target_long_side를 그대로 쓰면 점 간격보다
    # 서브셀이 작아져 대부분의 셀이 저밀도(3점 미만)로 NaN이 될 수 있다 - 렌더
    # 테스트의 의도(유효 데이터가 있는 그림)와 맞지 않는다.
    pts = flat_floor(size=(4.0, 3.0), spacing=0.02, tilt=(0.01, -0.02), noise_sd=0.0005)
    info = _info(pts.min(axis=0), pts.max(axis=0), n_points=len(pts))
    s = subcell_m_for_bbox(info, target_long_side=80)
    grid = build_subcell_grid([pts.astype(np.float32)], info, scale_to_m=1.0, subcell_m=s)

    out = tmp_path / "height_view.png"
    name = render_height_view(grid, out, title="높이 뷰 테스트")

    assert name == "height_view.png"
    assert out.exists()
    assert out.stat().st_size > 1000


def test_render_height_view_marks_high_area():
    """융기 하나를 주입하면 렌더 입력 격자에서 가장 높은 셀이 그 위치여야 한다
    (PNG 픽셀 판독은 불가능하니 렌더에 실제로 들어가는 격자값으로 위치를 검증)."""
    pts = add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02, noise_sd=0.0002),
                   (2.0, 1.5), 0.4, 0.5)
    info = _info(pts.min(axis=0), pts.max(axis=0), n_points=len(pts))
    s = subcell_m_for_bbox(info, target_long_side=80)
    grid = build_subcell_grid([pts.astype(np.float32)], info, scale_to_m=1.0, subcell_m=s)

    iy, ix = np.unravel_index(np.nanargmax(grid.median_z), grid.median_z.shape)
    x = grid.origin[0] + (ix + 0.5) * grid.size_m
    y = grid.origin[1] + (iy + 0.5) * grid.size_m
    assert abs(x - 2.0) < 0.3
    assert abs(y - 1.5) < 0.3


def test_render_height_view_uses_data_range_not_symmetric_normalization(tmp_path, monkeypatch):
    """설계 결정 E4의 핵심 검증: vmin/vmax는 데이터의 실제 최솟값·최댓값이어야
    한다.

    1차 리뷰 M13: HEIGHT_VIEW_CMAP 이름만 보고 대칭 정규화(vmin=-vmax)로
    되돌려도 기존 테스트가 통과했다(리뷰 실측: 데이터가 컬러맵의 47.6%만
    차지, 대비 2.10배 뭉개짐) - E4가 deviation.py를 재사용하지 않은 이유의
    절반이 무방비였다. imshow에 실제로 전달된 clim을 Axes.imshow를 스파이해
    직접 확인한다.
    """
    captured = {}
    original_imshow = matplotlib.axes.Axes.imshow

    def _spy_imshow(self, *a, **k):
        im = original_imshow(self, *a, **k)
        captured["im"] = im
        return im

    monkeypatch.setattr(matplotlib.axes.Axes, "imshow", _spy_imshow)

    pts = add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02, tilt=(0.01, -0.02),
                              noise_sd=0.0005), (2.0, 1.5), 0.4, 0.5)
    info = _info(pts.min(axis=0), pts.max(axis=0), n_points=len(pts))
    s = subcell_m_for_bbox(info, target_long_side=80)
    grid = build_subcell_grid([pts.astype(np.float32)], info, scale_to_m=1.0, subcell_m=s)

    render_height_view(grid, tmp_path / "norm.png")

    vmin, vmax = captured["im"].get_clim()
    expected_vmin = float(np.nanmin(grid.median_z))
    expected_vmax = float(np.nanmax(grid.median_z))
    assert vmin == pytest.approx(expected_vmin, abs=1e-4)
    assert vmax == pytest.approx(expected_vmax, abs=1e-4)
    assert vmin != pytest.approx(-vmax)   # 대칭 정규화(vmin=-vmax)가 아님을 직접 확인


def test_render_height_view_shows_colorbar_when_data_present(tmp_path, monkeypatch):
    """유효 데이터가 있으면 컬러바가 실제로 그려진다(아래 all-NaN 테스트의
    대조군 - 스파이 메커니즘 자체가 정상 작동함을 함께 확인한다)."""
    calls = {"colorbar": 0}
    original_colorbar = matplotlib.figure.Figure.colorbar

    def _spy_colorbar(self, *a, **k):
        calls["colorbar"] += 1
        return original_colorbar(self, *a, **k)

    monkeypatch.setattr(matplotlib.figure.Figure, "colorbar", _spy_colorbar)

    pts = flat_floor(size=(2.0, 2.0), spacing=0.02)
    info = _info(pts.min(axis=0), pts.max(axis=0), n_points=len(pts))
    s = subcell_m_for_bbox(info, target_long_side=40)
    grid = build_subcell_grid([pts.astype(np.float32)], info, scale_to_m=1.0, subcell_m=s)

    render_height_view(grid, tmp_path / "flat.png")
    assert calls["colorbar"] == 1


def test_render_height_view_survives_all_nan_grid(tmp_path):
    """유효 셀이 하나도 없어도(예: 극단적 저밀도 스캔) 예외 없이 파일을 만든다.

    render_deviation_map은 이 경우 None을 반환하지만(판정 보조라 목록에서 빼면
    그만), 높이 뷰는 단위 확정의 유일한 단서라 "산출물 없음"보다 "빈 이미지"가
    낫다 - 그래서 항상 파일을 만든다(축 눈금은 진짜 bbox 값이다).
    """
    grid, _info_obj = _sparse_grid()
    grid.median_z = np.full(grid.shape, np.nan, dtype=np.float32)

    out = tmp_path / "empty.png"
    name = render_height_view(grid, out)

    assert name == "empty.png"
    assert out.exists() and out.stat().st_size > 0


def test_render_height_view_omits_colorbar_and_annotates_when_all_nan(tmp_path, monkeypatch):
    """전부 NaN이면 거짓 컬러바(가짜 0~1 폴백 범위)를 보여주지 않고, 대신
    '유효 데이터 없음' 한국어 주석을 남긴다.

    1차 리뷰 실측: 축 눈금 1~7은 진짜 bbox 값인데 컬러바는 폴백이 만든 0.0~1.0을
    '상대 높이 (파일 단위)' 라벨과 함께 당당히 표시하고 있었다 - 데이터가
    없다는 표시가 어디에도 없었다. "항상 파일을 만든다"는 설계는 유지하되
    (축 눈금이 진짜라 단위 확정에 도움이 된다), 거짓 컬러바만 없앤다.
    """
    calls = {"colorbar": 0, "texts": []}
    original_colorbar = matplotlib.figure.Figure.colorbar
    original_text = matplotlib.axes.Axes.text

    def _spy_colorbar(self, *a, **k):
        calls["colorbar"] += 1
        return original_colorbar(self, *a, **k)

    def _spy_text(self, *a, **k):
        t = original_text(self, *a, **k)
        calls["texts"].append(t.get_text())
        return t

    monkeypatch.setattr(matplotlib.figure.Figure, "colorbar", _spy_colorbar)
    monkeypatch.setattr(matplotlib.axes.Axes, "text", _spy_text)

    grid, _info_obj = _sparse_grid()
    grid.median_z = np.full(grid.shape, np.nan, dtype=np.float32)

    render_height_view(grid, tmp_path / "empty.png")

    assert calls["colorbar"] == 0
    assert any("유효 데이터 없음" in t for t in calls["texts"])


def test_render_height_view_survives_perfectly_flat_surface(tmp_path):
    """모든 셀이 같은 값이면 vmin==vmax로 정규화가 퇴화한다 - 하한을 두어 방어."""
    pts = flat_floor(size=(2.0, 2.0), spacing=0.02)
    info = _info(pts.min(axis=0), pts.max(axis=0), n_points=len(pts))
    s = subcell_m_for_bbox(info, target_long_side=40)  # subcell_m=0.05(2.0/40)
    grid = build_subcell_grid([pts.astype(np.float32)], info, scale_to_m=1.0, subcell_m=s)

    out = tmp_path / "flat.png"
    assert render_height_view(grid, out) == "flat.png"
    assert out.stat().st_size > 500


def test_height_view_uses_sequential_not_diverging_colormap():
    """설계 결정 E4: 값이 전부 0 이상인 높이장에는 순차형 컬러맵을 쓴다.
    0 중심 대칭(RdYlGn_r 류)을 쓰면 컬러맵 절반이 낭비된다."""
    from flatness.outputs.height_view import HEIGHT_VIEW_CMAP
    assert HEIGHT_VIEW_CMAP not in ("RdYlGn_r", "RdYlGn", "coolwarm", "bwr", "seismic")


def test_height_view_module_imports_heatmap_for_font_side_effect():
    """폰트 설정 부수효과 import 문 자체가 모듈에 있는지 확인한다.

    이 import가 빠지면 리눅스에서 한글 제목이 네모 박스가 된다(단계 B 전례).
    그 결함 자체(렌더 결과물의 픽셀)는 유닛 테스트로 볼 수 없다 - 이 테스트는
    "브리프가 반드시 넣으라고 지시한 그 import 문이 실제로 존재하는가"라는
    계약만 확인한다. 실제 렌더 확인(한글이 정상적으로 나오는가)은 PNG를 직접
    읽어 사람이 확인했다(별도 검증 절차, 이 테스트로 대체되지 않는다).
    """
    import flatness.outputs.height_view as hv
    assert hv._engine_heatmap is heatmap


# ---------------------------------------------------------------------------
# 플레인(무장식) PNG - 1차 리뷰: 정합 단계 F가 브라우저 클릭 좌표를 월드로
# 되돌릴 수단이 필요하다. matplotlib 장식(제목·여백·컬러바)이 붙은
# render_height_view의 PNG만으로는 불가능해서 장식 없는 이미지를 추가한다.
# ---------------------------------------------------------------------------

def test_render_height_view_plain_pixel_dimensions_match_grid_shape(tmp_path):
    """플레인 PNG는 격자 1칸 = 픽셀 1개여야 사이드카의 shape[ny,nx]만으로
    좌표 환산이 가능하다(별도 image_size_px 필드가 필요 없다)."""
    pts = flat_floor(size=(4.0, 3.0), spacing=0.02, tilt=(0.01, -0.02), noise_sd=0.0005)
    info = _info(pts.min(axis=0), pts.max(axis=0), n_points=len(pts))
    s = subcell_m_for_bbox(info, target_long_side=80)
    grid = build_subcell_grid([pts.astype(np.float32)], info, scale_to_m=1.0, subcell_m=s)

    out = tmp_path / "plain.png"
    name = render_height_view_plain(grid, out)
    assert name == "plain.png"

    width, height = _png_dimensions_px(out)
    ny, nx = grid.shape
    assert (width, height) == (nx, ny)


def test_render_height_view_plain_pixel_to_world_formula_matches_bump_location(tmp_path):
    """플레인 PNG를 실제로 디코드해, 가장 밝은(=가장 높은) 픽셀을 독스트링의
    변환 공식으로 월드 좌표로 되돌리면 융기 위치와 일치하는지 확인한다.

    격자 배열값을 그대로 되읽는 자기참조 검증이 아니라 실제 PNG 바이트를
    디코드하는 블랙박스 검증이다 - render_height_view_plain의 좌표 계약
    독스트링이 실제 렌더 결과와 어긋나면(예: 세로 뒤집기를 빠뜨리면) 이
    테스트가 잡는다.
    """
    pts = add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02, noise_sd=0.0002),
                   (2.0, 1.5), 0.4, 0.5)
    info = _info(pts.min(axis=0), pts.max(axis=0), n_points=len(pts))
    s = subcell_m_for_bbox(info, target_long_side=80)
    grid = build_subcell_grid([pts.astype(np.float32)], info, scale_to_m=1.0, subcell_m=s)

    out = tmp_path / "plain.png"
    render_height_view_plain(grid, out)

    with PIL.Image.open(out) as im:
        arr = np.asarray(im.convert("RGB"), dtype=np.int32)

    ny, nx = grid.shape
    assert arr.shape[:2] == (ny, nx)

    # viridis: 낮은 값=어두운 보라, 높은 값=밝은 노랑 -> R+G 합이 값의 대리 지표
    brightness = arr[:, :, 0] + arr[:, :, 1]
    py, px = np.unravel_index(np.argmax(brightness), brightness.shape)

    # render_height_view_plain 독스트링의 변환 공식
    ix, iy = px, ny - 1 - py
    world_x = grid.origin[0] + (ix + 0.5) * grid.size_m
    world_y = grid.origin[1] + (iy + 0.5) * grid.size_m
    assert abs(world_x - 2.0) < 0.3
    assert abs(world_y - 1.5) < 0.3


def test_render_height_view_plain_has_no_colorbar_or_text_chrome(tmp_path, monkeypatch):
    """플레인 PNG는 애초에 Figure/Axes를 안 쓴다(plt.imsave) - 장식이 원천적으로
    없다는 것을 컬러바·텍스트 스파이로 재확인한다."""
    calls = {"colorbar": 0, "text": 0}
    monkeypatch.setattr(matplotlib.figure.Figure, "colorbar",
                        lambda self, *a, **k: calls.__setitem__("colorbar", calls["colorbar"] + 1))
    monkeypatch.setattr(matplotlib.axes.Axes, "text",
                        lambda self, *a, **k: calls.__setitem__("text", calls["text"] + 1))

    grid, _info_obj = _sparse_grid()
    render_height_view_plain(grid, tmp_path / "plain.png")

    assert calls == {"colorbar": 0, "text": 0}

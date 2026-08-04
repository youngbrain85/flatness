"""높이 뷰(height_view.py) - 격자 폭발 방지, PNG 렌더, 사이드카 왕복 검증.

계획: .superpowers/sdd/2026-08-04-slope-phase-e/task-1-brief.md (설계 결정 E2~E4)
"""
import json
import math

import numpy as np
import pytest

from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import CloudInfo
from flatness.outputs import heatmap
from flatness.outputs.height_view import (SCHEMA_VERSION, dump_height_view_meta,
                                          load_height_view_meta, render_height_view,
                                          subcell_m_for_bbox)
from tests.fixtures.synthetic import add_bump, flat_floor


def _info(bbox_min, bbox_max, n_points=1000):
    return CloudInfo(n_points=n_points,
                     bbox_min=np.array(bbox_min, dtype=np.float64),
                     bbox_max=np.array(bbox_max, dtype=np.float64))


def _sparse_grid():
    """NaN 서브셀(1점)과 유효 서브셀(3점 이상)이 함께 있는 작은 격자.

    test_subcell.py의 test_sparse_subcell_is_nan과 같은 픽스처 패턴 - 왕복
    테스트가 NaN 왕복과 유효값 왕복을 한 번에 검증하려면 둘 다 있어야 한다.
    """
    pts = np.array([[0.01, 0.01, 0.5], [0.07, 0.01, 0.0],
                    [0.08, 0.02, 0.0], [0.07, 0.03, 0.0]])
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    grid = build_subcell_grid([pts], info, scale_to_m=1.0, subcell_m=0.05)
    return grid, info


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


# ---------------------------------------------------------------------------
# Step 3: 사이드카 왕복
# ---------------------------------------------------------------------------

def test_height_view_meta_roundtrip_is_lossless(tmp_path):
    grid, info = _sparse_grid()
    assert np.isnan(grid.median_z).any()          # NaN 셀이 실제로 있어야 의미 있다
    assert np.isfinite(grid.median_z).any()        # 유효 셀도 있어야 한다

    path = tmp_path / "height_view.json"
    dump_height_view_meta(grid, info, path)
    meta = load_height_view_meta(str(path))

    assert meta["schema_version"] == SCHEMA_VERSION
    np.testing.assert_allclose(meta["bbox_min"], info.bbox_min)
    np.testing.assert_allclose(meta["bbox_max"], info.bbox_max)
    assert meta["subcell_m_file"] == grid.size_m
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
    grid, info = _sparse_grid()
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
    # 아니라 PNG 산출 자체이므로, 기본 512칸을 그대로 쓰면 점 간격(0.02m)보다
    # 서브셀이 더 작아져(4.0/512≈0.008m) 대부분의 셀이 저밀도(3점 미만)로 NaN이
    # 된다 - 렌더 테스트의 의도(유효 데이터가 있는 그림)와 맞지 않는다.
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


def test_render_height_view_survives_all_nan_grid(tmp_path):
    """유효 셀이 하나도 없어도(예: 극단적 저밀도 스캔) 예외 없이 파일을 만든다.

    render_deviation_map은 이 경우 None을 반환하지만(판정 보조라 목록에서 빼면
    그만), 높이 뷰는 단위 확정의 유일한 단서라 "산출물 없음"보다 "빈 회색
    이미지"가 낫다 - 그래서 항상 파일을 만든다.
    """
    grid, _info_obj = _sparse_grid()
    grid.median_z = np.full(grid.shape, np.nan, dtype=np.float32)

    out = tmp_path / "empty.png"
    name = render_height_view(grid, out)

    assert name == "empty.png"
    assert out.exists() and out.stat().st_size > 0


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
    """폰트 설정 부수효과 import가 빠지면 리눅스에서 한글 제목이 네모 박스가
    된다(단계 B 전례). 이 회귀는 렌더 결과물의 픽셀을 봐야 알 수 있어 유닛
    테스트로 시각적으로 잡을 수 없다 - 최소한 그 import 문 자체가 존재하는지
    모듈 네임스페이스로 확인해 둔다. 실제 렌더 확인은 PNG를 직접 읽어 사람이
    한다(검증 절차, 이 테스트만으로 충분하다고 간주하지 않는다).
    """
    import flatness.outputs.height_view as hv
    assert hv._engine_heatmap is heatmap

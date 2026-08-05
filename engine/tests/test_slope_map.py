"""구배 지도 PNG — 파일이 실제로 만들어지고 열리는지까지 확인한다."""
import math
import os

import numpy as np

from flatness.core.slope import SlopeCell, grade_slope_cells
from flatness.outputs.slope_map import render_slope_map

TH = {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}


def _cells():
    out = []
    for cy in range(3):
        for cx in range(3):
            out.append(SlopeCell(cx, cy, cx * 2.0 + 1.0, cy * 2.0 + 1.0, 1600,
                                 2.0 + 0.3 * cx, math.pi, 0.001, 0.01,
                                 2.0, 2.0, True))
    return out


def test_renders_png_file(tmp_path):
    p = tmp_path / "slope.png"
    got = render_slope_map(grade_slope_cells(_cells(), TH), str(p))
    assert got == str(p)
    assert os.path.getsize(p) > 1000


def test_undecidable_cells_do_not_crash_render(tmp_path):
    cells = _cells()
    cells.append(SlopeCell(9, 9, 20.0, 20.0, 0, float("nan"), float("nan"),
                           float("nan"), float("nan"), 2.0, 2.0, False))
    p = tmp_path / "slope2.png"
    render_slope_map(grade_slope_cells(cells, TH), str(p))
    assert os.path.getsize(p) > 1000


def test_fragment_cell_is_drawn_at_actual_extent(tmp_path):
    # 조각 셀(폭 0.2m)이 명목 cell_m(2.0m) 정사각형이 아니라 실제 범위로 그려지는지는
    # PNG 픽셀까지 확인하긴 어렵지만, 최소한 렌더가 width_m/height_m을 읽어서
    # 죽지 않고 정상 크기 파일을 내는지는 확인한다.
    cells = _cells()
    cells.append(SlopeCell(3, 0, 7.1, 1.0, 160, 2.0, math.pi, 0.001, 0.01,
                           0.2, 2.0, False))
    p = tmp_path / "slope3.png"
    render_slope_map(grade_slope_cells(cells, TH), str(p))
    assert os.path.getsize(p) > 1000


def test_empty_input_still_writes_a_file(tmp_path):
    p = tmp_path / "empty.png"
    render_slope_map([], str(p))
    assert os.path.exists(p)


def _graded_fixture(nx, ny, cell_m):
    """render_slope_map을 직접 부르는 테스트용 표준 격자(백로그 81).

    slope_pct를 design_pct(TH)와 정확히 맞춰 모든 셀을 적합(초록)으로 고정한다 -
    이 테스트들의 관심사는 등급 색이 아니라 배수구 마커 유무이므로 배경을
    단순하게 둔다. nx=4/ny=3처럼 가로세로가 다른 격자를 쓰고, 배수구 좌표도
    격자 전체의 기하 중심(여기서는 대략 (4, 3))이 아닌 한쪽으로 치우친 위치를
    써야 한다 - 정확히 중심에 두면 상하·좌우 반전 변이에 이미지가 불변이라
    "마커가 실제로 그려졌는가"를 검증하는 픽셀 비교가 무력화된다.
    """
    cells = []
    for cy in range(ny):
        for cx in range(nx):
            cells.append(SlopeCell(cx, cy,
                                   cx * cell_m + cell_m / 2, cy * cell_m + cell_m / 2,
                                   1600, 2.0, math.pi, 0.001, 0.01,
                                   cell_m, cell_m, True))
    return grade_slope_cells(cells, TH, cell_m=cell_m)


def _run_judge_slope_cells(tmp_path, drain_points=None):
    """judge_slope_cells가 render_slope_map까지 drain_points를 실제로 전달하는지만
    확인하는 최소 픽스처(백로그 81 - "render_slope_map만 고치고 호출부를 안
    고쳐도 통과하는" 회귀를 막기 위한 테스트 전용 헬퍼).

    judge_slope_cells 내부(grade_slope_cells의 거리 비교, stats["drain_points"]
    빌드)는 drain_points를 (x, y) 튜플로 기대한다 - CLI --drain 파싱과 공유하는
    표현이라 이 헬퍼가 마음대로 바꿀 수 없다. render_slope_map 쪽 계약만
    {"x":, "y":} dict이므로, judge_slope_cells가 호출 시점에 형태를 바꿔
    넘긴다(core/pipeline.py 참고) - 여기서 dict로 넣으면 스파이가 그대로
    dict를 돌려받아야, 그 왕복이 실제로 지켜지는지를 검증하게 된다.
    """
    from flatness.core.pipeline import judge_slope_cells

    cells = [SlopeCell(0, 0, 1.0, 1.0, 1600, 2.0, math.pi, 0.001, 0.01,
                       2.0, 2.0, True)]
    tuple_points = [(p["x"], p["y"]) for p in drain_points] if drain_points else None
    out_dir = tmp_path / "judge_out"
    judge_slope_cells(cells, TH, str(out_dir), 2.0, drain_points=tuple_points)


def test_render_slope_map_draws_drain_markers(tmp_path):
    """배수구 마커가 실제 픽셀로 찍히는지 PNG를 디코드해 확인한다.

    스파이(plot 호출 인자 단언)가 아니라 실제 픽셀을 읽는다 - 이 저장소는
    "인자는 맞는데 결과가 다르다"로 반복해서 데였다.
    """
    graded = _graded_fixture(nx=4, ny=3, cell_m=2.0)   # 아래 Step 3에서 정의
    a = tmp_path / "no_drain.png"
    b = tmp_path / "with_drain.png"
    render_slope_map(graded, a, cell_m=2.0)
    render_slope_map(graded, b, cell_m=2.0, drain_points=[{"x": 1.0, "y": 1.0}])

    import matplotlib.image as mpimg
    ia, ib = mpimg.imread(str(a)), mpimg.imread(str(b))
    assert ia.shape == ib.shape, "마커 유무가 이미지 크기를 바꾸면 안 된다"
    # 마커가 실제로 픽셀을 바꿨는가
    assert not np.allclose(ia, ib), "drain_points를 넘겼는데 그림이 동일하다"


def test_render_slope_map_without_drain_points_is_unchanged(tmp_path):
    """기존 호출부(인자 미전달)가 그대로 동작한다 - 평활도 경로 회귀 방지."""
    graded = _graded_fixture(nx=4, ny=3, cell_m=2.0)
    out = tmp_path / "m.png"
    assert render_slope_map(graded, out, cell_m=2.0) == out.name
    assert out.stat().st_size > 0


def test_judge_slope_cells_passes_drain_points_to_map(tmp_path, monkeypatch):
    """파이프라인이 배수구를 지도 렌더러까지 실제로 전달한다.

    이 단언이 없으면 render_slope_map만 고치고 호출부를 안 고쳐도 통과한다
    (이 저장소가 반복해 겪은 "테스트가 회귀를 못 잡는" 양식).
    """
    seen = {}
    import flatness.core.pipeline as pipeline

    def _spy(graded, out_path, cell_m=2.0, drain_points=None):
        seen["drain_points"] = drain_points
        out_path.write_bytes(b"\x89PNG\r\n\x1a\n")
        return out_path.name

    monkeypatch.setattr(pipeline, "render_slope_map", _spy)
    _run_judge_slope_cells(tmp_path, drain_points=[{"x": 3.0, "y": 5.0}])
    assert seen["drain_points"] == [{"x": 3.0, "y": 5.0}]

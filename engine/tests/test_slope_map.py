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


def test_render_slope_map_draws_drain_markers_on_na_cell_without_arrow(tmp_path):
    """화살표가 없는 판정불가(ok=False) 셀 위에서도 배수구 마커가 픽셀로 보여야 한다.

    실측(2차 변이 실험): test_render_slope_map_draws_drain_markers는 ok=True
    셀(내리막 화살표가 함께 그려짐) 위에 배수구를 두는데, 마커 fill·edge 색을
    셀 배경색과 똑같이 맞춰도 그 테스트는 여전히 통과했다 - 원인은 마커가
    화살표의 검은 픽셀 일부를 덮어써서 이미지가 달라 보였을 뿐, 마커 색 자체가
    배경과 구별되는지는 검증하지 못했던 것이다("테스트는 통과하는데 막으려던
    회귀는 못 잡는다"는 이 저장소의 반복된 실패 양식). 화살표가 없는 ok=False
    셀에는 이 우연한 보호가 없으므로, 여기서 마커 자체의 가시성을 진짜로
    검증한다. 이후 누군가 "화살표 있는 셀로도 충분한데?"라며 이 테스트를
    지우거나 ok=True 셀로 바꾸면 안 된다 - 바로 그 우연한 보호로 되돌아가는
    것이기 때문이다.

    두 셀을 x축으로만 벌려 놓고(y는 동일) 배수구를 격자 전체의 기하 중심
    (x=2.0, y=1.0)이 아니라 한쪽 셀에 치우친 위치에 둔다 - 이 단계에서
    항등식·대칭 픽스처(상하·좌우 반전 변이에 불변)에 세 번 데었다.

    화살표 confound를 없앴더니 두 번째 confound가 바로 나왔다: 범례
    (drain_points가 있으면 "배수구" 항목이 하나 더 붙는다, render_slope_map의
    legend_handles 분기)가 이미지 오른쪽 여백(실측: 960px 폭 중 x=840~941,
    dpi=120·figsize=(8,7) 기준)에서 마커 색과 무관하게 항상 픽셀을 바꾼다.
    마커 fill/edge를 배경과 똑같이 맞춘 변이를 실제로 돌려보면, 전체 이미지
    비교(np.allclose)는 여전히 다르다고 나오지만(범례만 바뀌었으므로) 지도
    영역(왼쪽 80%, x<0.8*width)만 잘라 비교하면 완전히 같아진다 - 즉 마커
    자체는 정말로 안 보이는데 범례 때문에 테스트가 우연히 또 통과할 뻔했다.
    그래서 비교를 지도 영역으로 한정한다(오른쪽 20%는 범례가 앉는 여백이라
    마커가 배경에 묻혔는지와 무관하게 항상 달라진다 - 비교에 넣으면 안 된다).
    """
    cells = [
        SlopeCell(0, 0, 1.0, 1.0, 5, float("nan"), float("nan"),
                 float("nan"), float("nan"), 2.0, 2.0, False),
        SlopeCell(1, 0, 3.0, 1.0, 5, float("nan"), float("nan"),
                 float("nan"), float("nan"), 2.0, 2.0, False),
    ]
    graded = grade_slope_cells(cells, TH, cell_m=2.0)
    # 자기검증: 이 테스트가 의미가 있으려면 두 셀 모두 화살표가 그려지지 않는
    # ok=False여야 한다.
    assert all(not g["cell"].ok for g in graded)

    a = tmp_path / "na_no_drain.png"
    b = tmp_path / "na_with_drain.png"
    render_slope_map(graded, a, cell_m=2.0)
    # (0.5, 1.6): 격자 기하 중심(2.0, 1.0)도 아니고, 상하(y->2-y) ·
    # 좌우(x->4-x) 어느 반전에도 자기 자신으로 돌아오지 않는 비대칭 위치.
    render_slope_map(graded, b, cell_m=2.0, drain_points=[{"x": 0.5, "y": 1.6}])

    import matplotlib.image as mpimg
    ia, ib = mpimg.imread(str(a)), mpimg.imread(str(b))
    assert ia.shape == ib.shape, "마커 유무가 이미지 크기를 바꾸면 안 된다"
    map_w = int(ia.shape[1] * 0.8)   # 오른쪽 20%(범례 여백) 제외 - 위 독스트링 참고
    ia_map, ib_map = ia[:, :map_w], ib[:, :map_w]
    assert not np.allclose(ia_map, ib_map), \
        "화살표 없는 셀 위에서도 마커가 지도 영역 픽셀을 바꿔야 한다(범례가 아니라)"

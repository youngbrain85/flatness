from flatness.core.cells import CellResult
from flatness.outputs.heatmap import render_heatmap, GRADE_COLORS

def test_five_grade_colors_defined():
    assert set(GRADE_COLORS) == {"pass", "borderline", "repair", "rework", "na"}

def test_heatmap_written(tmp_path):
    cells = [CellResult(x, y, x + 0.5, y + 0.5, 1.0, 3.0, 0.9, x + 0.5, y + 0.5)
             for x in range(3) for y in range(2)]
    grades = ["pass", "borderline", "repair", "rework", None, "pass"]
    out = tmp_path / "heatmap.png"
    render_heatmap(cells, grades, out)
    assert out.stat().st_size > 1000  # PNG 파일 생성 확인

def test_heatmap_empty_cells(tmp_path):
    # 빈 셀 리스트: 크래시 없이 파일 생성
    out = tmp_path / "empty.png"
    render_heatmap([], [], out)
    assert out.stat().st_size > 0


def test_heatmap_png_size_follows_floor_size_not_cell_count(tmp_path):
    # 판정 셀 0.5m(2026-10-19): 그림 크기를 칸 수에 비례시키면 같은 바닥이 픽셀 4배·메모리 4배가 된다
    # (50x40m 바닥 렌더 피크 +1.4GB, 리뷰 실측). 바닥 물리 크기에 비례해야 셀 크기와 무관하다
    from PIL import Image

    def run(cell_m, name):
        n = int(round(20 / cell_m))
        cells = [CellResult(ix, iy, 0.0, 0.0, 1.0, 3.0, 1.0, None, None, 1) for iy in range(n) for ix in range(n)]
        render_heatmap(cells, ["pass"] * len(cells), tmp_path / name, cell_m=cell_m)
        return Image.open(tmp_path / name).size

    assert run(0.5, "half.png") == run(1.0, "one.png")

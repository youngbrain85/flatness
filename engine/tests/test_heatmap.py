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

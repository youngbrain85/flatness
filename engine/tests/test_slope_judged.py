"""slope_judged.json — 셀별 판정 결과 산출물의 정합성 검증(Task 1 2차 리뷰).

slope_cells.json(입력, 무손실 셀 벡터)과 slope_judged.json(출력, 판정 결과)의
역할이 분리돼 있으므로, 여기서 확인할 것은 "왕복 무손실"이 아니라 "정합" -
두 파일이 같은 셀 집합을 (cx, cy) 키로 정확히 짝지을 수 있는가다.
"""
import json
import math

from flatness.core.pipeline import judge_slope_cells
from flatness.core.slope import GRADE_NA, SlopeCell, grade_slope_cells
from flatness.outputs.slope_judged import dump_slope_judged

TH = {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}


def _cells():
    """등급 4종 + 판정불가 2종(사유가 다른)을 모두 포함하는 5개 셀.

    cx=0: 적합 / cx=1: 보수(편차가 pass_pct는 넘고 re_pct는 안 넘음) /
    cx=2: 재시공(역구배 - drain_points=[(-10,1)]과 함께 써야 성립) /
    cx=3: 판정불가(불확도 se_pct가 pass_pct보다 큼, dev_pct는 값이 있음) /
    cx=4: 판정불가(ok=False 조각 셀, dev_pct도 nan)
    """
    return [
        SlopeCell(0, 0, 1.0, 1.0, 1600, 2.0, math.pi, 0.001, 0.01, 2.0, 2.0, True),
        SlopeCell(1, 0, 3.0, 1.0, 1600, 2.8, math.pi, 0.001, 0.01, 2.0, 2.0, True),
        SlopeCell(2, 0, 5.0, 1.0, 1600, 2.0, 0.0, 0.001, 0.01, 2.0, 2.0, True),
        SlopeCell(3, 0, 7.0, 1.0, 1600, 2.0, math.pi, 0.001, 0.9, 2.0, 2.0, True),
        SlopeCell(4, 0, 9.0, 1.0, 5, float("nan"), float("nan"),
                 float("nan"), float("nan"), 0.2, 2.0, False),
    ]


def _null_if_nan(v):
    return None if isinstance(v, float) and math.isnan(v) else v


def test_judged_json_ids_and_grades_match_grade_slope_cells(tmp_path):
    """analyze_slope 없이도 judge_slope_cells 수준에서 정합을 확인한다:
    slope_judged.json의 셀 수·(cx,cy) 식별자·등급이 방금 grade_slope_cells를
    직접 돌린 결과와 정확히 일치해야 한다."""
    cells = _cells()
    drain_points = [(-10.0, 1.0)]
    out_dir = tmp_path / "out"
    judge_slope_cells(cells, TH, str(out_dir), 2.0, drain_points=drain_points)

    judged = json.loads((out_dir / "slope_judged.json").read_text(encoding="utf-8"))
    assert len(judged["cells"]) == len(cells)

    cell_ids = {(c.cx, c.cy) for c in cells}
    judged_ids = {(row["cx"], row["cy"]) for row in judged["cells"]}
    assert judged_ids == cell_ids

    fresh_by_id = {(g["cell"].cx, g["cell"].cy): g
                   for g in grade_slope_cells(cells, TH, drain_points=drain_points, cell_m=2.0)}
    for row in judged["cells"]:
        g = fresh_by_id[(row["cx"], row["cy"])]
        assert row["grade"] == g["grade"]
        assert row["reason"] == g["reason"]
        assert row["dev_pct"] == _null_if_nan(g["dev_pct"])
        assert row["dir_err_deg"] == _null_if_nan(g["dir_err_deg"])
        assert row["correction_mm"] == _null_if_nan(g["correction_mm"])

    # 자기검증: 이 픽스처가 4개 등급 분기를 실제로 모두 태우는지 확인해 둔다
    grades = {row["grade"] for row in judged["cells"]}
    assert grades == {"적합", "보수", "재시공", "판정불가"}
    assert judged["direction_judged"] is True


def test_rejudge_with_different_drain_points_keeps_judged_json_consistent(tmp_path):
    """재판정(다른 배수구로 judge_slope_cells를 다시 호출)해도 slope_judged.json이
    여전히 같은 셀 집합과 정확히 짝지어지고, 등급도 새 배수구 기준으로 갱신된다."""
    cells = _cells()
    out_dir = tmp_path / "out"

    judge_slope_cells(cells, TH, str(out_dir), 2.0, drain_points=[(-10.0, 1.0)])
    judged_before = json.loads((out_dir / "slope_judged.json").read_text(encoding="utf-8"))
    grade_cx2_before = next(r["grade"] for r in judged_before["cells"] if r["cx"] == 2)
    assert grade_cx2_before == "재시공"   # -x 쪽 배수구와 반대(cx=2의 내리막은 +x)

    # 배수구를 반대쪽(+x)으로 바꿔 재판정 - cx=2는 이제 순구배가 돼야 한다
    judge_slope_cells(cells, TH, str(out_dir), 2.0, drain_points=[(20.0, 1.0)])
    judged_after = json.loads((out_dir / "slope_judged.json").read_text(encoding="utf-8"))

    ids_after = {(row["cx"], row["cy"]) for row in judged_after["cells"]}
    assert ids_after == {(c.cx, c.cy) for c in cells}   # 정합이 재판정 후에도 유지된다

    grade_cx2_after = next(r["grade"] for r in judged_after["cells"] if r["cx"] == 2)
    assert grade_cx2_after != grade_cx2_before   # 재판정이 실제로 등급을 바꿨다(의미 있는 재판정)

    fresh_by_id = {(g["cell"].cx, g["cell"].cy): g
                   for g in grade_slope_cells(cells, TH, drain_points=[(20.0, 1.0)], cell_m=2.0)}
    for row in judged_after["cells"]:
        assert row["grade"] == fresh_by_id[(row["cx"], row["cy"])]["grade"]


def test_na_cells_serialize_nan_fields_as_null(tmp_path):
    """판정불가 셀의 nan 필드가 null로 나가고(RFC 8259 위반 토큰 없음), 화면이
    받을 수 있는 형태인지 확인한다. 두 판정불가 사유(불확도 큼 vs 조각 셀)가
    dev_pct의 유무를 다르게 만드는 것까지 구분해서 본다."""
    cells = _cells()
    graded = grade_slope_cells(cells, TH, drain_points=[(-10.0, 1.0)], cell_m=2.0)
    path = tmp_path / "slope_judged.json"
    dump_slope_judged(graded, str(path), direction_judged=True)

    raw = path.read_text(encoding="utf-8")
    assert "NaN" not in raw
    payload = json.loads(raw)   # 표준 json 파서로 파싱 가능해야 한다

    row3 = next(r for r in payload["cells"] if r["cx"] == 3)   # 불확도 큼: dev_pct는 값 있음
    assert row3["grade"] == GRADE_NA
    assert row3["dev_pct"] == 0.0
    assert row3["correction_mm"] is None
    assert row3["dir_err_deg"] is None

    row4 = next(r for r in payload["cells"] if r["cx"] == 4)   # 조각 셀: dev_pct도 nan
    assert row4["grade"] == GRADE_NA
    assert row4["dev_pct"] is None
    assert row4["correction_mm"] is None
    assert row4["dir_err_deg"] is None


def test_judged_rows_are_keyed_so_reordering_cannot_silently_mismatch(tmp_path):
    """셀 식별자로 (cx, cy)를 택한 이유를 직접 증명한다.

    slope_judged.json의 행 순서가 slope_cells.json(또는 원본 cells 리스트)의
    순서와 다르더라도(정렬·재판정 등으로 실제 순서가 바뀔 수 있다) (cx, cy) 키로
    조인하면 여전히 올바른 판정과 짝지어진다. 배열 인덱스로 순진하게 짝지었다면
    (zip) 바로 이 순서 뒤바뀜에서 다른 셀의 판정이 섞였을 것이다 - 그 사실도
    함께 확인해 이 변이가 실제로 위험했다는 것을 못박는다.
    """
    cells = _cells()
    drain_points = [(-10.0, 1.0)]
    graded = grade_slope_cells(cells, TH, drain_points=drain_points, cell_m=2.0)

    judged_path = tmp_path / "slope_judged.json"
    dump_slope_judged(list(reversed(graded)), str(judged_path), direction_judged=True)
    judged_rows = json.loads(judged_path.read_text(encoding="utf-8"))["cells"]

    # 자기검증: 인덱스 기준으로는 실제로 어긋나 있어야 이 테스트가 의미가 있다
    naive_mismatches = [(c.cx, c.cy, row["cx"], row["cy"])
                        for c, row in zip(cells, judged_rows) if c.cx != row["cx"]]
    assert naive_mismatches, "순서가 우연히 같으면 이 변이가 재현되지 않은 것이다"

    # (cx, cy) 키로 조인하면 순서와 무관하게 여전히 올바른 판정을 찾는다
    fresh_by_id = {(g["cell"].cx, g["cell"].cy): g for g in graded}
    for row in judged_rows:
        g = fresh_by_id[(row["cx"], row["cy"])]
        assert row["grade"] == g["grade"]
        assert row["reason"] == g["reason"]

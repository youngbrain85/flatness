"""slope_cells.json 왕복 직렬화 — 재판정(§7.3) 입력 계약이 무손실인지 검증한다.

CSV 경로가 배제된 이유(브리프 D1 실측)를 이 테스트가 지킨다:
  - CSV에 width_m/height_m 열이 없어 명목 cell_m으로 복원하면 correction_mm이
    가장자리 셀에서 정확히 2배로 나온다
  - 반올림(_r(v,3)·_deg 1자리)이 판정 경계에 걸터앉은 바닥의 등급을 뒤집는다
    (20개 중 11개, 실측)

Task 1 리뷰(I1) 대응: cell_m을 잘못 알면(예: 원 분석 4.0 -> 재판정 기본값 2.0)
CSV와 같은 결함이 JSON 경로에서도 재현된다는 것이 실측됐다. slope_cells.json에
cell_m/subcell_m을 함께 실어 load_slope_cells가 (cells, meta) 튜플로 돌려주게
했으므로, 여기서도 cell_m을 원 분석 값과 다르게 잘못 넘기면 무엇이 깨지는지
직접 검증한다(test_wrong_cell_m_flips_fragment_reason_but_meta_prevents_it).
"""
import math
from dataclasses import fields

from flatness.core.slope import (SlopeCell, compute_slope_cells,
                                 grade_slope_cells)
from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import CloudInfo
from flatness.outputs.slope_cells import dump_slope_cells, load_slope_cells
from tests.fixtures.synthetic import flat_floor


def _grid(pts, subcell_m=0.05):
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    return build_subcell_grid([pts], info, 1.0, subcell_m=subcell_m)


def _assert_cells_equal(a, b):
    """SlopeCell 두 개를 dataclasses.fields로 필드 전부 일반적으로 비교한다.

    Task 1 리뷰 M3: 필드 이름을 하드코딩해 나열하면 SlopeCell에 필드가 늘어도
    이 비교가 자동으로 안 늘어나 회귀를 놓친다(리뷰 실측: 14번째 필드 누락
    변이가 통과). fields(SlopeCell)로 순회하면 스키마가 커져도 그대로 잡는다.

    Task 1 리뷰 M2: 값만 ==으로 비교하면 타입 손실(n_subcells가 float로,
    ok가 0/1로 저장돼도 통과)을 놓친다. cells.json은 브라우저가 소비하므로
    ok가 1로 나가면 JS의 `cell.ok === true`가 깨진다 - 값과 타입을 함께 본다.
    """
    for f in fields(SlopeCell):
        av, bv = getattr(a, f.name), getattr(b, f.name)
        if isinstance(av, float) and math.isnan(av):
            assert isinstance(bv, float) and math.isnan(bv), \
                f"{f.name}: nan이 왕복 후 nan이 아님 ({bv!r})"
            continue
        assert av == bv, f"{f.name}: 값 불일치 {av!r} != {bv!r}"
        assert type(av) is type(bv), \
            f"{f.name}: 타입 불일치 {type(av)} != {type(bv)} ({av!r} vs {bv!r})"


def test_slope_cells_json_roundtrip_is_lossless(tmp_path):
    """재판정이 원본과 같은 판정을 내려면 왕복이 무손실이어야 한다.

    8.2m 바닥(2m 비배수, test_slope.py의 조각 셀 픽스처와 동일)이라 오른쪽
    가장자리에 폭 0.2m 조각 셀이 생긴다 - ok=False 셀의 nan 왕복
    (slope_pct/downhill_rad/rmse_m/se_pct)까지 이 한 픽스처로 같이 잡는다.

    Task 1 리뷰 M1: tilt가 축 하나뿐(0.02, 0.0)이고 noise_sd=0이면 정상 셀의
    downhill_rad가 전부 정확히 +-pi로 퇴화해, "라디안 -> 도 -> 라디안" 변환
    손실 같은 미세한 정밀도 결함을 못 잡는다(리뷰 실측: 현실적 바닥이면 16셀
    중 5셀이 깨지는 변이가 이 픽스처에서는 통과). 두 축 모두 기울이고 미세한
    노이즈를 섞어 downhill_rad가 셀마다 달라지게 한다.
    """
    pts = flat_floor(size=(8.2, 8.0), spacing=0.02, tilt=(0.021, 0.007), noise_sd=0.0005)
    grid = _grid(pts)
    cells = compute_slope_cells(grid, cell_m=2.0)
    assert any(not c.ok for c in cells)   # 조각 셀(nan 경로)이 실제로 있어야 의미가 있다
    assert any(c.ok for c in cells)       # 정상 셀(수치 경로)도 있어야 한다
    # downhill_rad가 실제로 퇴화하지 않았는지 자기검증(위 리뷰 대응이 유효한지 확인)
    downhills = {round(c.downhill_rad, 6) for c in cells if c.ok}
    assert len(downhills) > 1, "downhill_rad가 여전히 한 값으로 퇴화했다"

    path = tmp_path / "slope_cells.json"
    dump_slope_cells(cells, str(path), engine_version="test-1.0", cell_m=2.0, subcell_m=0.05)
    restored, meta = load_slope_cells(str(path))

    assert len(restored) == len(cells)
    for a, b in zip(cells, restored):
        _assert_cells_equal(a, b)

    assert meta == {"schema_version": 2, "engine_version": "test-1.0",
                    "cell_m": 2.0, "subcell_m": 0.05}


def test_nonzero_zone_id_survives_roundtrip(tmp_path):
    """zone_id는 이번 단계에서 compute_slope_cells가 항상 None만 채우지만(D2),
    필드 자체는 스키마에 이미 뚫려 있으므로 값이 있을 때 사라지면 안 된다.

    모든 실제 셀의 zone_id가 None인 상태로만 검증하면 dump에서 zone_id를
    빠뜨려도 로드 시 dataclass 기본값(None)이 우연히 원본과 일치해 회귀를
    못 잡는다 - 그래서 비-None 값을 직접 넣어 확인한다.
    """
    cell = SlopeCell(0, 0, 1.0, 1.0, 1600, 2.0, math.pi, 0.001, 0.01, 2.0, 2.0, True,
                     zone_id=7)
    path = tmp_path / "slope_cells.json"
    dump_slope_cells([cell], str(path), engine_version="test-1.0", cell_m=2.0, subcell_m=0.05)
    restored, _meta = load_slope_cells(str(path))
    assert restored[0].zone_id == 7


TH = {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}


def test_restored_cells_produce_identical_grades(tmp_path):
    """같은 배수구로 두 번 판정하면 등급이 한 셀도 달라지지 않는다.

    판정 경계에 걸터앉은 값(편차가 정확히 pass_pct/re_pct)을 골라야 의미가 있다 -
    무손실이 아니라 근사(반올림·필드 누락 등)였다면 바로 이 경계에서 등급이
    뒤집힌다(브리프 D1 실측: 판정 경계에 걸터앉은 바닥 20개 중 11개).
    """
    design, pass_pct, re_pct = TH["design_pct"], TH["pass_pct"], TH["re_pct"]
    u = 1e-9  # 사실상 0에 가까운 불확도 - 경계값 자체가 등급을 가르게 한다
    cells = [
        # dev_pct == pass_pct 정확히: d+u가 pass_pct를 근소하게 넘어 "경계"로 갈린다.
        # (d+u<=pass_pct일 때만 적합이므로 아무리 작아도 +u가 경계를 밀어낸다 -
        # 왕복에서 이 근소한 초과분이 사라지면(정밀도 손실) "적합"으로 뒤집힌다)
        SlopeCell(0, 0, 1.0, 1.0, 1600, design + pass_pct, math.pi, 0.001, u, 2.0, 2.0, True),
        # dev_pct == re_pct 정확히: 경계에 걸터앉은 "보수" 쪽
        SlopeCell(1, 0, 3.0, 1.0, 1600, design + re_pct, math.pi, 0.001, u, 2.0, 2.0, True),
        # pass_pct를 살짝 넘어 "보수"
        SlopeCell(2, 0, 5.0, 1.0, 1600, design + pass_pct + 1e-6, math.pi, 0.001, u, 2.0, 2.0, True),
        # 크기는 완벽한데 방향이 반대(역구배)
        SlopeCell(3, 0, 7.0, 1.0, 1600, design, 0.0, 0.001, u, 2.0, 2.0, True),
        # 판정불가(조각 셀) - nan 필드가 등급 판정 경로에도 영향 없어야 한다
        SlopeCell(4, 0, 9.0, 1.0, 5, float("nan"), float("nan"),
                 float("nan"), float("nan"), 0.2, 2.0, False),
    ]
    path = tmp_path / "slope_cells.json"
    dump_slope_cells(cells, str(path), engine_version="test-1.0", cell_m=2.0, subcell_m=0.05)
    restored, _meta = load_slope_cells(str(path))

    drain_points = [(-10.0, 1.0)]  # cx=3 셀(내리막 +x)이 역구배가 되도록 -x 쪽에 배치
    graded_orig = grade_slope_cells(cells, TH, drain_points=drain_points, cell_m=2.0)
    graded_restored = grade_slope_cells(restored, TH, drain_points=drain_points, cell_m=2.0)

    grades_orig = [g["grade"] for g in graded_orig]
    grades_restored = [g["grade"] for g in graded_restored]
    assert grades_orig == grades_restored
    assert [g["reason"] for g in graded_orig] == [g["reason"] for g in graded_restored]
    # 경계 케이스가 실제로 의도한 등급으로 갈렸는지도 확인해 둔다(테스트 자체의 자기검증)
    assert grades_orig[0] == "경계"     # d+u가 pass_pct를 근소하게 초과
    assert grades_orig[1] == "보수"     # d-u가 pass_pct는 넘지만 re_pct는 안 넘음
    assert grades_orig[3] == "재시공"   # 역구배
    assert grades_orig[4] == "판정불가"


def test_schema_and_engine_version_are_recorded(tmp_path):
    """slope_cells.json에 schema_version·engine_version·cell_m·subcell_m이 함께
    담긴다(재판정 시 엔진 버전 호환 여부·격자 파라미터를 판단할 근거, 리뷰 I1)."""
    cells = [SlopeCell(0, 0, 1.0, 1.0, 1600, 2.0, math.pi, 0.001, 0.01, 2.0, 2.0, True)]
    path = tmp_path / "slope_cells.json"
    dump_slope_cells(cells, str(path), engine_version="p4-0.5.0", cell_m=4.0, subcell_m=0.05)

    import json
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["engine_version"] == "p4-0.5.0"
    assert raw["schema_version"] == 2
    assert raw["cell_m"] == 4.0
    assert raw["subcell_m"] == 0.05
    assert "NaN" not in path.read_text(encoding="utf-8")   # RFC 8259 위반 토큰이 없어야 한다


def test_wrong_cell_m_flips_fragment_reason_but_meta_prevents_it(tmp_path):
    """Task 1 리뷰 I1이 실측한 결함(원 분석 cell_m=4.0을 재판정이 기본값 2.0으로
    잊으면 조각 셀 사유가 "격자 가장자리 조각 셀" -> "유효 서브셀 부족"으로
    뒤바뀜)을 재현하고, meta["cell_m"]을 그대로 쓰면 사라진다는 것을 확인한다.

    5.8m 바닥을 cell_m=4.0으로 분석하면 오른쪽에 폭 1.8m 조각 열이 남는다.
    1.8m은 cell_m=4.0 기준 문턱(4.0/2=2.0m)보다 좁아 "조각 셀"로 잡히지만,
    (n_subcells는 min_subcells를 훌쩍 넘으므로 개수 부족이 원인이 아니다)
    cell_m=2.0 문턱(2.0/2=1.0m)보다는 넓어서 그 cell_m으로 grade_slope_cells를
    돌리면 폭 검사를 통과해 "유효 서브셀 부족"으로 사유가 바뀐다 - 사실과 다른
    설명이 사용자에게 나가는 것이다.
    """
    pts = flat_floor(size=(5.8, 8.0), spacing=0.02, tilt=(0.02, 0.0))
    grid = _grid(pts)
    cells = compute_slope_cells(grid, cell_m=4.0)
    frags = [c for c in cells if not c.ok]
    assert frags, "픽스처에 조각 셀이 없으면 이 테스트는 무의미하다"
    assert all(1.0 <= c.width_m < 2.0 for c in frags), \
        f"조각 폭이 의도한 구간(1.0~2.0m)을 벗어났다: {[c.width_m for c in frags]}"

    path = tmp_path / "slope_cells.json"
    dump_slope_cells(cells, str(path), engine_version="test-1.0", cell_m=4.0, subcell_m=0.05)
    restored, meta = load_slope_cells(str(path))
    assert meta["cell_m"] == 4.0   # 원 분석 cell_m이 그대로 보존된다

    graded_correct = grade_slope_cells(restored, TH, cell_m=meta["cell_m"])
    graded_wrong = grade_slope_cells(restored, TH, cell_m=2.0)  # 옛 하드코딩 기본값을 흉내

    reasons_correct = [g["reason"] for g in graded_correct if g["grade"] == "판정불가"]
    reasons_wrong = [g["reason"] for g in graded_wrong if g["grade"] == "판정불가"]
    assert reasons_correct != reasons_wrong, \
        "cell_m을 잘못 넘겨도 사유가 안 바뀌면 이 회귀 자체가 재현이 안 된 것이다"
    assert all("격자 가장자리 조각 셀" in r for r in reasons_correct)
    assert all("유효 서브셀 부족" in r for r in reasons_wrong)

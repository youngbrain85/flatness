"""도면 복원 회귀 — 발주처가 인쇄한 면적표를 정답으로 삼는다.

이 테스트가 지키는 것은 "코드가 돈다"가 아니라 **"복원한 기하가 도면과 같다"**이다.
그래서 기대값은 합성 픽스처가 아니라 도면 3쪽 면적산출표에 인쇄된 값 그대로다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

pymupdf = pytest.importorskip("pymupdf")
pytest.importorskip("shapely")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extract_plan import (  # noqa: E402
    PlanSheet, level_labels, ring_area_m2, rings_of, room_polygons,
)

PDF = Path(__file__).resolve().parents[2] / "data" / "BIM" / "(도면)_01_LH공동주택주력평면_26형.pdf"

# 3쪽 면적산출근거표에 인쇄된 값 (발주처 정본)
DRAWN_AREA_M2 = {
    "거실/침실": 16.2528, "주방/식당": 5.3426, "욕실": 3.3597, "현관": 1.9988,
    "PD": 1.2096, "발코니": 6.7500, "벽체공용": 3.3236,
}
LABEL_PT_MM = {
    "거실/침실": (2027, 3501), "주방/식당": (3170, 6329), "욕실": (974, 6615),
    "현관": (2179, 8202), "PD": (634, 8483), "발코니": (2151, 764), "벽체공용": (2179, 1600),
}
# 1쪽 부분상세도의 FL/SL 라벨과 4쪽 마감표의 THK — 서로 독립된 출처다
LEVELS = {"거실/침실": (110, 0, 110), "주방/식당": (110, 0, 110), "현관": (80, 0, 80),
          "욕실": (30, -150, 180), "발코니": (35, 0, 35)}

pytestmark = pytest.mark.skipif(not PDF.exists(), reason="도면 PDF가 없다(저장소 미포함)")


@pytest.fixture(scope="module")
def doc():
    d = pymupdf.open(PDF)
    yield d
    d.close()


@pytest.fixture(scope="module")
def rooms(doc):
    sheet = PlanSheet(page=doc[2], scale_denominator=40, origin_pt=(463.92, 907.60))
    return room_polygons(sheet, LABEL_PT_MM)


def test_모든_실이_복원된다(rooms):
    assert set(rooms) == set(DRAWN_AREA_M2)


@pytest.mark.parametrize("name", sorted(DRAWN_AREA_M2))
def test_복원_면적이_도면_면적표와_일치한다(rooms, name):
    """정수 mm로 반올림해 DB에 저장되는 링 자체로 검산한다 — 중간 부동소수가 아니라."""
    area = ring_area_m2(rings_of(rooms[name]))
    drawn = DRAWN_AREA_M2[name]
    assert abs(area - drawn) / drawn < 5e-5, f"{name}: {area:.4f} vs 도면 {drawn:.4f}"


def test_벽체공용은_구멍을_갖는다(rooms):
    """벽체공용은 실들을 두른 띠다. 외곽링만 쓰면 세대 전체 면적이 되어 3.3236이 안 나온다."""
    rings = rings_of(rooms["벽체공용"])
    assert len(rings) >= 2, "구멍이 없으면 면적이 도면표와 맞을 수 없다"


def test_링에_닫는_점이_없다(rooms):
    for name, poly in rooms.items():
        for ring in rings_of(poly):
            assert ring[0] != ring[-1], f"{name}: 계약은 닫는 점 없는 링이다"
            assert len(ring) >= 3, f"{name}: 링은 3점 이상이어야 면이다"


def test_FL과_SL이_마감표_THK와_교차검증된다(doc):
    """THK를 레벨로 읽으면 욕실이 가장 높다고 오판한다 — 실제로는 슬래브가 150mm 내려가 가장 낮다.

    두 도면(1쪽 상세도 FL/SL, 4쪽 마감표 THK)이 독립적으로 `FL - SL == THK`를 만족한다.
    """
    labels = level_labels(doc[0], ["거실", "침실", "주방", "식당", "욕실", "현관", "발코니", "실외기", "복도"])
    by_room: dict[str, dict[str, float]] = {}
    for lab in labels:
        if lab.nearest_room:
            by_room.setdefault(lab.nearest_room, {})[lab.kind] = lab.value_mm

    checked = 0
    for room, (fl, sl, thk) in LEVELS.items():
        found = next((v for k, v in by_room.items() if room.split("/")[0] in k), None)
        if not found or "FL" not in found or "SL" not in found:
            continue
        assert found["FL"] == fl, f"{room} FL"
        assert found["SL"] == sl, f"{room} SL"
        assert found["FL"] - found["SL"] == thk, f"{room}: FL-SL != 마감표 THK"
        checked += 1
    assert checked >= 4, f"레벨 라벨을 {checked}개만 확인했다 — 추출이 깨졌을 수 있다"


def test_욕실이_가장_낮다(doc):
    """방향까지 맞는지 본다. 값만 맞고 부호가 뒤집히면 로봇이 '올라간다'는 틀린 결론이 난다."""
    labels = level_labels(doc[0], ["거실", "침실", "주방", "식당", "욕실", "현관", "발코니", "실외기", "복도"])
    fl = {lab.nearest_room: lab.value_mm for lab in labels if lab.kind == "FL" and lab.nearest_room}
    bath = next((v for k, v in fl.items() if "욕실" in k), None)
    living = next((v for k, v in fl.items() if "거실" in k or "침실" in k), None)
    assert bath is not None and living is not None
    assert bath < living, "욕실 마감면은 거실보다 낮다(배수 구배 때문)"


# ─── 순수 기하 로직 — 도면 없이 직접 시험한다 ────────────────────────────────
# 위 테스트들은 26형 도면 한 장으로만 검증한다. 그 도면이 지나지 않는 코드 경로
# (사선 배제, 중첩 면 선택, 스냅 허용치)는 변이 실험에서 전부 살아남았다.
# 아래는 그 세 경로를 합성 입력으로 직접 친다.
from extract_plan import pick_face, snap_axis_aligned  # noqa: E402
from shapely.geometry import Polygon as _Poly  # noqa: E402


def test_사선은_실_경계로_받지_않는다():
    """사선을 통과시키면 폴리곤화가 실 경계가 아닌 면을 만들어 면적이 어긋난다."""
    assert snap_axis_aligned((0, 0), (1000, 1000)) is None
    assert snap_axis_aligned((0, 0), (1000, 400)) is None


def test_축_정렬_선분은_정수_격자에_붙는다():
    assert snap_axis_aligned((0.4, 10.2), (1000.6, 12.1)) == ((0, 11), (1001, 11))
    assert snap_axis_aligned((10.2, 0.4), (12.1, 1000.6)) == ((11, 0), (11, 1001))


def test_스냅_허용치를_넘으면_사선이다():
    """허용치가 커지면 완만한 사선이 직선으로 왜곡된다 — 경계가 그만큼 틀어진다."""
    almost = ((0, 0), (1000, 20))
    assert snap_axis_aligned(*almost, tol_mm=3.0) is None
    assert snap_axis_aligned(*almost, tol_mm=30.0) == ((0, 10), (1000, 10))


def test_기본_허용치가_동작으로_고정된다():
    """`tol_mm`을 명시로만 시험하면 기본값이 바뀌어도 아무 테스트가 안 깨진다.

    26형 도면은 경계선이 정확히 축 정렬이라 허용치를 키워도 결과가 같다 — 그래서 도면
    테스트로는 이 상수를 잡을 수 없다. 인자 없이 호출해 기본값 자체를 지나가게 한다.
    """
    assert snap_axis_aligned((0, 0), (1000, 20)) is None, "기본 허용치가 20mm 사선을 받아들였다"
    assert snap_axis_aligned((0, 0), (1000, 2)) == ((0, 1), (1000, 1)), "기본 허용치가 2mm 오차를 버렸다"


def test_점에_가까운_선분은_버린다():
    assert snap_axis_aligned((5, 5), (6, 6)) is None


def test_중첩된_면에서는_가장_작은_것을_고른다():
    """큰 면은 그 실을 감싸는 외곽이다. 큰 쪽을 고르면 모든 라벨이 같은 면을 가리킨다."""
    outer = _Poly([(0, 0), (100, 0), (100, 100), (0, 100)])
    inner = _Poly([(10, 10), (40, 10), (40, 40), (10, 40)])
    other = _Poly([(60, 60), (90, 60), (90, 90), (60, 90)])
    assert pick_face([outer, inner, other], (20, 20)) is inner
    assert pick_face([outer, inner, other], (70, 70)) is other
    assert pick_face([outer, inner, other], (50, 50)) is outer


def test_어느_면에도_안_들어가면_None():
    assert pick_face([_Poly([(0, 0), (10, 0), (10, 10), (0, 10)])], (99, 99)) is None

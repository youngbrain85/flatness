# -*- coding: utf-8 -*-
"""Task 2: 도면 8쪽 가구 장애물 추출 테스트.

정답 부재를 정직하게 (계획 Task 2): 도면에 가구 면적표가 없어 실 경계(0.003%)만큼
검증할 정답이 없다. 그래서 이 테스트가 지키는 것은
  (a) 원점·축척 역산이 맞다 — 8쪽 실 라벨이 세부과업 2 실 폴리곤 안에 떨어진다
  (b) 모든 가구가 자기 실 안에 있고 다른 실을 침범하지 않는다
  (c) 문 스윙 영역(통행로)이 가구로 막히지 않는다
  (d) 추출 실패는 지어내지 않고 KNOWN_MISSING 으로 문서화된다
  (e) 스냅샷 고정 — 추출이 조용히 바뀌면 FAIL
  (f) 시각 대조 PNG 존재 — 육안 검증 근거를 저장소에 남긴다
"""
import json
import sys
from pathlib import Path

import pytest

pymupdf = pytest.importorskip("pymupdf")
pytest.importorskip("shapely")

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shapely.geometry import Point, Polygon  # noqa: E402

from scansim.furniture import (  # noqa: E402
    KNOWN_MISSING, extract_furniture, page8_sheet,
)

REPO = Path(__file__).resolve().parents[2]
PDF = REPO / "data" / "BIM" / "(도면)_01_LH공동주택주력평면_26형.pdf"
DUMP = REPO / "bim" / "tests" / "fixtures" / "lh26_dump.json"
SNAPSHOT = Path(__file__).parent / "fixtures" / "furniture_lh26.json"
OVERLAY = Path(__file__).parent / "fixtures" / "furniture_lh26_overlay.png"

pytestmark = pytest.mark.skipif(not PDF.exists(), reason="도면 PDF가 없다(저장소 미포함)")

# 통행로가 막히면 이후 태스크(주행 계획)가 전부 틀어지는 구역들.
# 좌표는 8쪽 도면에서 읽은 문 스윙 범위(mm) — 여유를 두고 안쪽만 잡았다.
BATH_DOOR_SWING = Polygon([(1050, 5750), (1750, 5750), (1750, 6400), (1050, 6400)])
ENTRY_DOOR_SWING = Polygon([(1500, 8050), (2800, 8050), (2800, 8700), (1500, 8700)])
# 신발장(현관 서측) — c=0.50 회색으로 그려져 이 방법으로는 못 뽑는 구역
SHOE_CABINET_ZONE = Polygon([(1330, 7100), (1730, 7100), (1730, 8800), (1330, 8800)])


@pytest.fixture(scope="module")
def rooms():
    data = json.loads(DUMP.read_text(encoding="utf-8"))
    out = {}
    for sp in data["spaces"]:
        o = sp.get("outline")
        if o and sp["name"] != "벽체공용":
            out[sp["name"]] = Polygon(o[0], o[1:])
    return out


@pytest.fixture(scope="module")
def doc():
    d = pymupdf.open(PDF)
    yield d
    d.close()


@pytest.fixture(scope="module")
def furniture():
    return extract_furniture(PDF)


# ── (a) 원점·축척 ──────────────────────────────────────────────


def test_역산_축척은_3쪽과_같은_1대40(doc):
    sheet = page8_sheet(doc[7])
    assert sheet.scale_denominator == 40


def test_역산_원점은_3쪽과_다르다(doc):
    """3쪽 원점 (463.92, 907.60) 을 그대로 쓰면 안 된다 — 8쪽은 평면이 딴 자리에 있다."""
    sheet = page8_sheet(doc[7])
    ox, oy = sheet.origin_pt
    assert abs(ox - 463.92) > 5 or abs(oy - 907.60) > 5


def test_실_라벨이_자기_실_안에_떨어진다(doc, rooms):
    """원점·축척이 틀리면 라벨 좌표가 실 밖으로 나간다 — end-to-end 검증."""
    sheet = page8_sheet(doc[7])
    expected = {"거실/침실", "주방/식당", "욕실", "현관", "발코니", "PD"}
    found = set()
    for w in doc[7].get_text("words"):
        name = w[4]
        if name in expected:
            mx, my = sheet.to_mm((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)
            assert rooms[name].contains(Point(mx, my)), (
                f"{name} 라벨 ({mx:.0f},{my:.0f})mm 가 실 폴리곤 밖 — 원점·축척 역산 오류"
            )
            found.add(name)
    assert found == expected, f"라벨 누락: {expected - found}"


# ── (b) 내부성 ────────────────────────────────────────────────


def test_가구가_3개_이상_추출된다(furniture):
    assert len(furniture) >= 3, f"{len(furniture)}개 — 침대·주방가구·의자만 해도 3개는 나와야 한다"


def test_모든_가구가_자기_실_안에_있다(furniture, rooms):
    for f in furniture:
        hull = Polygon(f["rings"][0])
        room = rooms[f["room"]]
        # 25mm 여유: 정수 반올림 + 볼록 껍질이 오목 실 모서리에 닿는 것 허용
        assert room.buffer(25).contains(hull), (
            f"{f['name']}: hull bounds={hull.bounds} 가 {f['room']} 밖"
        )


def test_가구는_다른_실을_침범하지_않는다(furniture, rooms):
    for f in furniture:
        hull = Polygon(f["rings"][0])
        for name, poly in rooms.items():
            if name == f["room"]:
                continue
            inter = hull.intersection(poly).area
            assert inter < 1000, f"{f['name']}({f['room']}) 가 {name} 을 {inter:.0f}mm² 침범"


def test_링_계약_준수(furniture):
    """rings 는 dump 계약과 동일: [외곽링, ...], 정수 mm, 닫는 점 없음, 3점 이상."""
    for f in furniture:
        assert f["rings"], f"{f['name']}: rings 비어 있음"
        for ring in f["rings"]:
            assert len(ring) >= 3
            assert ring[0] != ring[-1], f"{f['name']}: 닫는 점 금지"
            for x, y in ring:
                assert isinstance(x, int) and isinstance(y, int)


# ── (c) 통행로 ────────────────────────────────────────────────


def test_문_스윙_영역은_가구로_막히지_않는다(furniture):
    """문 호를 가구로 오인하면 욕실·현관 진입이 막혀 이후 주행 계획이 전부 틀어진다."""
    for f in furniture:
        hull = Polygon(f["rings"][0])
        assert not hull.intersects(BATH_DOOR_SWING), f"{f['name']} 가 욕실 문 스윙을 막는다"
        assert not hull.intersects(ENTRY_DOOR_SWING), f"{f['name']} 가 현관 문 스윙을 막는다"


def test_가구를_다_넣어도_각_실이_도달_가능하다(furniture):
    """점유격자에 가구를 전부 넣고 로봇 반경(ScanConfig 기본 250mm)만큼 부풀려도
    거실 → 욕실·현관·주방 경로가 존재한다. 문 스윙·표기 선작업을 가구로 오인해
    통로를 막으면 여기서 죽는다 — 좌표 검사가 아니라 기능 검사다.

    발코니·PD 는 벽체공용 띠로 단절되어 있어(덤프 기하 그대로) 대상에서 뺀다.
    """
    from scansim.config import ScanConfig
    from scansim.grid import OccupancyGrid

    data = json.loads(DUMP.read_text(encoding="utf-8"))
    free_rings = [sp["outline"] for sp in data["spaces"]
                  if sp.get("outline") and sp["name"] in
                  ("거실/침실", "주방/식당", "욕실", "현관")]
    obstacles = [f["rings"] for f in furniture]
    grid = OccupancyGrid.from_rings(free_rings, obstacles, 50.0).inflate(
        ScanConfig().robot_radius_mm)

    start = (3100, 3000)  # 거실 동측 개활지 (도면에서 읽은 빈 바닥)
    targets = {"욕실": (900, 7300), "현관": (2100, 8300), "주방/식당": (2400, 6500)}
    for name, goal in targets.items():
        assert grid.astar(start, goal) is not None, (
            f"거실→{name} 경로 없음 — 가구/표기 오인이 통로를 막았다"
        )


# ── (d) 누락 문서화 ───────────────────────────────────────────


def test_신발장_누락이_문서화된다(furniture):
    """신발장은 c=0.50 회색으로 그려져 가구 필터(2/3 회색) 밖 — 지어내지 말고 문서화."""
    assert any("신발장" in m["name"] for m in KNOWN_MISSING)
    for m in KNOWN_MISSING:
        assert m.get("reason"), f"{m['name']}: 누락 사유가 없다"
    # 일관성: 신발장 구역에서 가구를 '발명'하지 않았는지
    for f in furniture:
        hull = Polygon(f["rings"][0])
        assert not hull.intersects(SHOE_CABINET_ZONE), (
            f"{f['name']} 이 신발장 구역에 있다 — 누락 문서와 모순"
        )


# ── (e) 스냅샷 ────────────────────────────────────────────────


def test_스냅샷_고정(furniture):
    """추출이 조용히 바뀌면 FAIL. 의도한 변경이면 `python -m scansim.furniture` 로 재생성."""
    assert SNAPSHOT.exists(), "스냅샷 없음 — `python -m scansim.furniture` 로 생성하라"
    snap = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert furniture == snap["furniture"]
    assert KNOWN_MISSING == snap["missing"]


# ── (f) 시각 대조 ─────────────────────────────────────────────


def test_시각_대조_PNG가_있다():
    """육안 검증 근거 — `python -m scansim.furniture` 가 생성한다."""
    assert OVERLAY.exists(), "시각 대조 PNG 없음 — `python -m scansim.furniture` 로 생성하라"
    assert OVERLAY.stat().st_size > 10_000, "PNG 가 비정상적으로 작다"

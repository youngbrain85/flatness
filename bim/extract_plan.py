"""도면 PDF에서 실 폴리곤과 레벨을 복원한다 (세부과업 2 · 0단계).

원리: LH 도면의 **면적산출근거도**는 실 경계를 굵은 선으로 그린다. 그 선 굵기(1.42pt)로
거르면 가구·설비·해치 선이 전부 떨어져 나가고 실 경계만 남는다. 남은 선분을 축 정렬로
스냅해 폴리곤화하면 실 면적이 나오고, 그 값을 도면에 인쇄된 면적산출표와 대조해 검증한다.

검증 결과(LH 26형): 7면 전부 도면 표기와 0.003% 이내. 정수 mm로 반올림한 뒤에도 0.0025% 이내.

한계: 이 방법은 "면적산출근거도가 존재하고 실 경계가 굵은 선으로 구분된다"는 LH 도면
관례에 의존한다. 다른 발주처 도면에서는 BOUNDARY_WIDTH_PT를 다시 잡아야 한다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

BOUNDARY_WIDTH_PT = 1.42     # 실 경계 선 굵기. 다른 도면에서는 재측정이 필요하다.
SNAP_TOL_MM = 3.0            # 축 정렬 판정 허용치
PT_PER_MM_AT_1_1 = 72.0 / 25.4


@dataclass
class PlanSheet:
    """축척과 원점이 확정된 도면 한 장."""

    page: pymupdf.Page
    scale_denominator: float          # 1:40 이면 40
    origin_pt: tuple[float, float]    # 평면 원점의 PDF 좌표(pt)

    @property
    def pt_per_mm(self) -> float:
        return PT_PER_MM_AT_1_1 / self.scale_denominator

    def to_mm(self, x_pt: float, y_pt: float) -> tuple[float, float]:
        """PDF pt → 도면 로컬 mm. PDF는 y가 아래로 증가하므로 뒤집는다."""
        ox, oy = self.origin_pt
        return ((x_pt - ox) / self.pt_per_mm, (oy - y_pt) / self.pt_per_mm)


def snap_axis_aligned(a: tuple[float, float], b: tuple[float, float],
                      tol_mm: float = SNAP_TOL_MM) -> tuple[tuple[int, int], tuple[int, int]] | None:
    """축에 거의 나란한 선분을 정수 mm 격자에 붙인다. 사선이면 None.

    사선을 버리는 이유: 실 경계는 축 정렬이고, 사선은 가구·지시선·해치다. 이것을 통과시키면
    폴리곤화가 실 경계가 아닌 면을 만들어 면적이 어긋난다.
    허용치를 키우면 완만한 사선까지 직선으로 왜곡되므로 도면 축척에 맞게 잡아야 한다.
    """
    if abs(a[1] - b[1]) < tol_mm and abs(a[0] - b[0]) >= tol_mm:        # 수평
        y = round((a[1] + b[1]) / 2)
        return (round(a[0]), y), (round(b[0]), y)
    if abs(a[0] - b[0]) < tol_mm and abs(a[1] - b[1]) >= tol_mm:        # 수직
        x = round((a[0] + b[0]) / 2)
        return (x, round(a[1])), (x, round(b[1]))
    if abs(a[0] - b[0]) < tol_mm and abs(a[1] - b[1]) < tol_mm:         # 점에 가깝다
        return None
    return None                                                         # 사선


def pick_face(faces: list[Polygon], point: tuple[float, float]) -> Polygon | None:
    """라벨 점을 포함하는 면 중 **가장 작은** 것.

    큰 면은 그 실을 감싸는 외곽(예: 세대 전체, 벽체 띠의 외곽링)이다. 가장 큰 것을 고르면
    모든 라벨이 같은 외곽 면을 가리켜 실이 구분되지 않는다.
    """
    hits = [f for f in faces if f.contains(Point(*point))]
    return min(hits, key=lambda g: g.area) if hits else None


def _segments(sheet: PlanSheet, width_pt: float) -> list[LineString]:
    """지정한 선 굵기의 축 정렬 선분만 mm 정수 좌표로 돌려준다."""
    out: list[LineString] = []
    for path in sheet.page.get_drawings():
        if round(path.get("width") or 0.0, 2) != round(width_pt, 2):
            continue
        for item in path["items"]:
            if item[0] == "l":
                raw = [(item[1].x, item[1].y, item[2].x, item[2].y)]
            elif item[0] == "re":
                r = item[1]
                raw = [(r.x0, r.y0, r.x1, r.y0), (r.x1, r.y0, r.x1, r.y1),
                       (r.x1, r.y1, r.x0, r.y1), (r.x0, r.y1, r.x0, r.y0)]
            else:
                continue
            for x0, y0, x1, y1 in raw:
                snapped = snap_axis_aligned(sheet.to_mm(x0, y0), sheet.to_mm(x1, y1))
                if snapped and snapped[0] != snapped[1]:
                    out.append(LineString(snapped))
    return out


def room_polygons(sheet: PlanSheet, labels: dict[str, tuple[float, float]]) -> dict[str, Polygon]:
    """라벨 좌표(mm)로 실을 지목해 폴리곤을 돌려준다."""
    faces = list(polygonize(unary_union(_segments(sheet, BOUNDARY_WIDTH_PT))))
    rooms: dict[str, Polygon] = {}
    for name, point in labels.items():
        face = pick_face(faces, point)
        if face is not None:
            rooms[name] = face
    return rooms


def rings_of(poly: Polygon) -> list[list[list[int]]]:
    """폴리곤 → DB `spaces.outline` 계약 형태: [외곽링, 구멍링...], 닫는 점 없음."""
    out = [[[int(round(x)), int(round(y))] for x, y in poly.exterior.coords[:-1]]]
    out += [[[int(round(x)), int(round(y))] for x, y in r.coords[:-1]] for r in poly.interiors]
    return out


def ring_area_m2(rings: list[list[list[int]]]) -> float:
    """저장되는 정수 좌표 자체로 면적을 재계산한다(셰이스 공식). 검산용."""
    def shoelace(ring: list[list[int]]) -> float:
        s = 0.0
        for i, (x1, y1) in enumerate(ring):
            x2, y2 = ring[(i + 1) % len(ring)]
            s += x1 * y2 - x2 * y1
        return abs(s) / 2

    return (shoelace(rings[0]) - sum(shoelace(r) for r in rings[1:])) / 1e6


# ─── 레벨 ──────────────────────────────────────────────────────────────────────
LEVEL_RE = re.compile(r"^(FL|SL|F\.L|S\.L)\.?\s*([+-]?\d+|±0)$")


@dataclass
class LevelLabel:
    kind: str          # 'FL' | 'SL'
    value_mm: float
    at_pt: tuple[float, float]
    nearest_room: str = ""


def level_labels(page: pymupdf.Page, room_words: list[str]) -> list[LevelLabel]:
    """부분상세도의 FL/SL 라벨을 뽑고 가장 가까운 실 이름을 붙인다.

    ⚠ 마감표의 THK(두께)를 레벨로 읽으면 안 된다. 슬래브가 다운된 실(욕실)에서
      두께 차와 레벨 차가 달라져 높낮이 방향이 뒤집힌다. 정본은 이 FL 라벨이고,
      `FL - SL == 마감표 THK` 로 두 도면을 교차검증할 수 있다.
    """
    words = page.get_text("words")
    rooms = [(w[0], w[1], w[4]) for w in words if any(k in w[4] for k in room_words)]
    out: list[LevelLabel] = []
    for w in words:
        m = LEVEL_RE.match(w[4].replace(" ", ""))
        if not m:
            continue
        raw = m.group(2)
        value = 0.0 if raw == "±0" else float(raw)
        near = min(((abs(rx - w[0]) + abs(ry - w[1]), t) for rx, ry, t in rooms), default=(None, ""))
        out.append(LevelLabel(kind=m.group(1)[:2], value_mm=value, at_pt=(w[0], w[1]),
                              nearest_room=near[1] if near[0] is not None and near[0] < 160 else ""))
    return out

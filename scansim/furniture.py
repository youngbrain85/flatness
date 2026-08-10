# -*- coding: utf-8 -*-
"""도면 8쪽(page_index=7)에서 가구 장애물을 추출한다 (세부과업 3 · Task 2).

8쪽은 "26형 걸레받이 및 반자돌림 시공한계도"(AA-008, A1 1:40)로, 유일하게 가구
(침대·의자·주방가구·수납장·양변기·세탁기 등)가 배치된 평면이다.

원점·축척 (계획 Task 2 지시 — 3쪽과 같은지 치수선으로 확인):
  * 축척: 3쪽과 같은 1:40. 근거 ① 표제란 "A1 : 1/40" ② 전체 치수선 실측 —
    4500mm 치수선 335.89pt = 4500×(72/25.4/40) + 양끝 오버슛 2×8.50pt,
    8970mm 치수선 652.65pt = 8970×s + 2×8.50pt. 오버슛까지 서로 일치한다.
  * 원점: 3쪽(463.92, 907.60)과 **다르다** — 평면이 딴 자리에 있다. 그래서
    8쪽 자체의 치수 "사슬"(1430|3070 가로, …|4090|1500 세로)의 **접점**에서
    역산한다. 접점은 오버슛이 없어 전체 치수선보다 신뢰할 수 있다.
    `page8_sheet()` 가 매 호출 역산하므로 도면이 바뀌면 조용히 틀리지 않고 죽는다.

추출 방법 (탐색 기록: 대상 영역별 굵기·색 전수 조사):
  * 가구는 전부 폭 0.24pt · 회색 2/3 (침대 166·의자 96·주방가구 811·양변기 430 …).
  * 같은 색의 노이즈와 이렇게 분리한다:
      - 문 스윙 호·문짝 틀: 검정(c=0) → 색 필터에서 탈락
      - 욕실 타일 격자: 벽-벽 스팬 → 실 경계 인접(BORDER_MM) 필터에서 탈락
      - 걸레받이·반자돌림 한계선(이 도면의 주제)·커텐박스: 실 둘레 인접 → 동일 탈락
  * 남은 선분을 실별로 연결 성분 클러스터 → 볼록 껍질 → 면적 하한.

정답 부재를 정직하게 (스펙 §9-2): 도면에 가구 면적표가 없어 실 경계처럼 수치로
검증할 정답이 없다. 검증은 내부성·스냅샷·시각 대조 PNG(tests/fixtures/)와
"가구를 다 넣어도 각 실이 도달 가능하다"는 기능 불변식으로 하고, 이 방법이
못 뽑는 것은 지어내지 않고 KNOWN_MISSING 으로 남긴다.

알려진 과대(보수적 방향 — 거짓 자유공간보다 안전):
  * ㄱ자 주방가구의 볼록 껍질이 안쪽 모서리 빈 바닥(~0.8m²)을 포함한다.
  * 거실 동측 수납장은 여닫이문 개폐 표기(가구에 붙은 실선)까지 껍질에 들어간다.
  * 발코니 세탁기 자리는 겹치는 클러스터 2개로 나온다(외곽+내부 상세) — 무해.

스냅샷·시각 대조 PNG 재생성: 저장소 루트에서 `python -m scansim.furniture`
"""
from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import pymupdf
from shapely.geometry import MultiPoint, Point, Polygon
from shapely.prepared import prep

from bim.extract_plan import PT_PER_MM_AT_1_1, PlanSheet

REPO = Path(__file__).resolve().parents[1]
DEFAULT_PDF = REPO / "data" / "BIM" / "(도면)_01_LH공동주택주력평면_26형.pdf"
DEFAULT_DUMP = REPO / "bim" / "tests" / "fixtures" / "lh26_dump.json"
FIXTURES = REPO / "scansim" / "tests" / "fixtures"

PAGE_INDEX = 7                # 8쪽 — 가구가 그려진 유일한 평면
SCALE_DENOMINATOR = 40.0      # 표제란 "A1 : 1/40" — page8_sheet() 가 치수선으로 재검증

# ── 추출 상수 (도면 관례 상수 — extract_plan.BOUNDARY_WIDTH_PT 와 같은 성격.
#    장비·밀도 파라미터가 아니므로 ScanConfig 대상이 아니다. 다른 도면이면 재측정.) ──
FURNITURE_GRAY = 2.0 / 3.0    # 가구 선 색(그레이스케일). 신발장만 0.50 이라 못 뽑는다(KNOWN_MISSING)
GRAY_TOL = 0.02
MAX_WIDTH_PT = 0.3            # 가구 선 폭 0.24~0.26pt. 굵은 선은 걸레받이 한계선(1.98/2.83 검정)
BORDER_MM = 180.0             # 실 경계 인접 판정 — 타일 격자·한계선·커텐박스 제거.
                              # 반자돌림 한계선의 실측 최대 인셋 155mm(거실 북측) + 여유.
CLUSTER_TOL_MM = 60.0         # 끝점 근접 클러스터 허용치 (파선 대시 간격 ~40mm 이상)
MIN_AREA_M2 = 0.03            # 볼록 껍질 하한 — 수건걸이·배수구 등 소품 제거
LABEL_NEAR_MM = 400.0         # 텍스트 라벨(TV 등) → 가구 이름 부여 최대 거리

# 1D 선작업(일점쇄선 한계선의 실내 구간 등) 판정: 대시(≤350mm — 일점쇄선의 긴
# 대시가 ~300mm)들이 이어진 연결 성분의 최소회전사각형이 "가늘고 길면" 선이지
# 가구가 아니다. 식탁·스툴·침대의 파선 외곽은 닫힌 도형이라 minrect 짧은 변이
# 도형 폭만큼 두껍게 나와 안전하다.
DASH_MAX_MM = 350.0           # 대시 한 조각의 최대 길이
DASH_LINK_MM = 80.0           # 대시 사이 간격 허용치
LINEWORK_THIN_MM = 100.0      # minrect 짧은 변이 이보다 가늘고
LINEWORK_LONG_MM = 400.0      #   긴 변이 이보다 길면 선작업으로 버린다

# 문 스윙 구역 (도면 판독 좌표 — extract_plan.BOUNDARY_WIDTH_PT 같은 도면 관례 상수).
# 스윙 호·문턱 표기가 가구 색(회색 2/3)과 같아서 기하만으로는 못 가른다.
# 문이 지나는 자리는 통행 가능 구역이므로 장애물 후보에서 제외한다.
# 시각 대조 PNG(tests/fixtures/furniture_lh26_overlay.png)로 육안 검증한다.
DOOR_ZONES_MM = {
    "욕실문": (1000.0, 5560.0, 1820.0, 6550.0),
    "세대현관문": (1480.0, 7950.0, 2870.0, 8800.0),
}

# 가구가 아닌 표기 선작업 제외 구역 (도면 판독 좌표 — DOOR_ZONES_MM 과 같은 성격).
# 거실 중앙의 파선 ㄷ자(수평 y4920 x1225..2885 + 수직 x1925·x2925 y4920..5380)는
# 주기 19의 '점선표기 시설물(미설치)' 계열 구역 표기다. 이걸 남겨두면 의자·소파가
# 한 껍질로 병합되어 거실 폭을 가로막고, 로봇 반경 250mm 기준으로 욕실·현관이
# 도달 불가능해진다 — 표기가 장애물이 되면 안 된다.
NOTATION_ZONES_MM = {
    "미설치표기_거실중앙": (1300.0, 4890.0, 2970.0, 5420.0),
}

# 이 방법이 구조적으로 못 뽑는 것 — 지어내지 않고 문서화한다 (계획 Task 2)
KNOWN_MISSING = [
    {
        "name": "신발장(현관)",
        "reason": "본체가 회색 0.50 으로 그려져 가구 색 필터(회색 2/3) 밖. "
                  "현관 서측 벽면 수납장 — 시각 대조 PNG 에 구역 표시.",
        "approx_bbox_mm": [1330, 7100, 1730, 8800],
    },
    {
        "name": "점선표기 시설물(실외기 등)",
        "reason": "1쪽 주기 19 '점선표기 시설물은 미설치 대상' — 검정 파선(0.71pt)으로 "
                  "구분되어 있어 의도적으로 제외. 가구 유/무 2시나리오는 보고서에서 다룬다.",
        "approx_bbox_mm": None,
    },
]


# ── 원점·축척 역산 ──────────────────────────────────────────────


def _axis_segments(page):
    """페이지의 수평/수직 선분 (pt). 반환: (horizontal, vertical)
    horizontal: (y, x0, x1) with x0<x1 / vertical: (x, y0, y1) with y0<y1."""
    horiz, vert = [], []
    for path in page.get_drawings():
        for item in path["items"]:
            if item[0] != "l":
                continue
            a, b = item[1], item[2]
            if abs(a.y - b.y) < 0.05 and abs(a.x - b.x) > 1:
                horiz.append((a.y, min(a.x, b.x), max(a.x, b.x)))
            elif abs(a.x - b.x) < 0.05 and abs(a.y - b.y) > 1:
                vert.append((a.x, min(a.y, b.y), max(a.y, b.y)))
    return horiz, vert


def _chain_junction(segments, len_a_pt, len_b_pt, tol=1.5, overshoot_max=15.0):
    """치수 사슬에서 두 구간(a|b)이 만나는 접점 좌표를 찾는다.

    segments: (c, t0, t1) — 같은 축의 선분들 (c=고정 좌표, t0<t1).
    a 구간은 접점의 음(-) 방향, b 구간은 양(+) 방향. 바깥 끝은 오버슛이 있을 수
    있으므로 [목표, 목표+overshoot_max] 를 허용하고, 접점 자체는 tol 로 잡는다.
    """
    hits = []
    for c1, s0, s1 in segments:
        for c2, t0, t1 in segments:
            if abs(c1 - c2) > 0.05 or abs(s1 - t0) > tol / 2:
                continue  # 같은 줄이 아니거나 끝점을 공유하지 않는다
            j = (s1 + t0) / 2
            la, lb = j - s0, t1 - j
            if -tol <= la - len_a_pt <= overshoot_max and -tol <= lb - len_b_pt <= overshoot_max:
                hits.append(j)
    return hits


def page8_sheet(page) -> PlanSheet:
    """8쪽의 원점·축척이 확정된 PlanSheet.

    축척은 1:40 (모듈 docstring 근거)이고 치수 사슬 접점으로 재검증한다.
    원점 역산:
      * x0: 하단 가로 사슬 1430|3070 접점 j → x0 = j − 1430·s
      * y0: 좌측 세로 사슬 (위)…4090|1500(아래) 접점 j → y0 = j + 1500·s
        (PDF 는 y 가 아래로 증가, 평면 mm y=0 은 사슬 맨 아래)
    접점이 없거나 서로 모순이면 ValueError — 조용히 틀리지 않는다.
    """
    s = PT_PER_MM_AT_1_1 / SCALE_DENOMINATOR
    horiz, vert = _axis_segments(page)

    xs = _chain_junction(horiz, 1430 * s, 3070 * s)
    if not xs:
        raise ValueError("8쪽 가로 치수 사슬(1430|3070)을 찾지 못했다 — 축척 1:40 가정이 깨졌다")
    x_j = xs[0]
    if any(abs(x - x_j) > 0.5 for x in xs):
        raise ValueError(f"가로 사슬 접점이 모순된다: {xs}")

    # 세로 사슬: 접점 위쪽이 4090 구간(양끝 접점 — 오버슛 없음), 아래쪽이 1500 구간
    ys = _chain_junction(vert, 4090 * s, 1500 * s)
    if not ys:
        raise ValueError("8쪽 세로 치수 사슬(4090|1500)을 찾지 못했다 — 축척 1:40 가정이 깨졌다")
    y_j = ys[0]
    if any(abs(y - y_j) > 0.5 for y in ys):
        raise ValueError(f"세로 사슬 접점이 모순된다: {ys}")

    origin = (x_j - 1430 * s, y_j + 1500 * s)

    # 교차 검증: 전체 4500 치수선이 [x0, x0+4500s] 를 덮는 한 줄로 존재해야 한다
    lo, hi = origin[0], origin[0] + 4500 * s
    if not any(x0 <= lo + 1 and x1 >= hi - 1 and (x1 - x0) - 4500 * s < 30
               for _, x0, x1 in horiz):
        raise ValueError("전체 4500 치수선이 원점과 안 맞는다 — 역산 모순")

    return PlanSheet(page=page, scale_denominator=SCALE_DENOMINATOR, origin_pt=origin)


# ── 가구 추출 ──────────────────────────────────────────────────


def _load_rooms(dump_path) -> dict[str, Polygon]:
    """세부과업 2 덤프의 실 폴리곤 (벽체공용 제외 — 가구는 실 안에만 있다)."""
    data = json.loads(Path(dump_path).read_text(encoding="utf-8"))
    rooms = {}
    for sp in data["spaces"]:
        o = sp.get("outline")
        if o and sp["name"] != "벽체공용":
            rooms[sp["name"]] = Polygon(o[0], o[1:])
    return rooms


def _candidate_items(page, sheet):
    """가구 색(회색 2/3)·폭(≤0.3pt) 경로의 아이템별 꼭짓점 목록 (mm).

    곡선('c')은 제어점 4개를 그대로 쓴다 — 껍질용으로 충분하고, 제어점이 실 밖으로
    나가면 그 아이템이 통째로 버려지는 보수적 방향이라 안전하다.
    """
    out = []
    for path in page.get_drawings():
        c = path.get("color")
        if c is None or abs(c[0] - FURNITURE_GRAY) > GRAY_TOL:
            continue
        if (path.get("width") or 0.0) > MAX_WIDTH_PT:
            continue
        for item in path["items"]:
            if item[0] == "l":
                pts = [item[1], item[2]]
            elif item[0] == "re":
                r = item[1]
                pts = [pymupdf.Point(r.x0, r.y0), pymupdf.Point(r.x1, r.y0),
                       pymupdf.Point(r.x1, r.y1), pymupdf.Point(r.x0, r.y1)]
            elif item[0] == "c":
                pts = [item[1], item[2], item[3], item[4]]
            elif item[0] == "qu":
                q = item[1]
                pts = [q.ul, q.ur, q.lr, q.ll]
            else:
                continue
            out.append([sheet.to_mm(p.x, p.y) for p in pts])
    return out


def _cluster(items_pts):
    """끝점 거리 ≤ CLUSTER_TOL_MM 인 아이템들을 연결 성분으로 묶는다."""
    return _cluster_with_tol(items_pts, CLUSTER_TOL_MM)


def _cluster_with_tol(items_pts, tol_mm):
    """꼭짓점 거리 ≤ tol_mm 인 아이템들의 연결 성분 (union-find)."""
    n = len(items_pts)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        parent[find(i)] = find(j)

    cell = tol_mm
    buckets = defaultdict(list)
    for i, pts in enumerate(items_pts):
        for x, y in pts:
            buckets[(int(x // cell), int(y // cell))].append((i, x, y))
    for (gx, gy), members in buckets.items():
        neigh = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                neigh.extend(buckets.get((gx + dx, gy + dy), ()))
        for i, x, y in members:
            for j, x2, y2 in neigh:
                if i < j and (x - x2) ** 2 + (y - y2) ** 2 <= cell ** 2:
                    union(i, j)

    comps = defaultdict(list)
    for i in range(n):
        comps[find(i)].append(i)
    return list(comps.values())


def _drop_linework(items):
    """짧은 대시들이 이어져 '가늘고 긴' 성분을 이루면 선작업으로 버린다.

    이 도면(시공한계도)의 일점쇄선 한계선은 실내를 가로질러 가구 클러스터를
    잘못 잇는 1D 다리가 된다. 닫힌 파선 도형(식탁·스툴·침대 외곽)은 minrect
    짧은 변이 도형 폭만큼 나와 살아남는다.
    """
    short_idx = [i for i, pts in enumerate(items)
                 if math.hypot(pts[-1][0] - pts[0][0], pts[-1][1] - pts[0][1]) < DASH_MAX_MM
                 and sum(math.hypot(b[0] - a[0], b[1] - a[1])
                         for a, b in zip(pts, pts[1:])) < DASH_MAX_MM]
    if not short_idx:
        return items
    sub = [items[i] for i in short_idx]
    comps = _cluster_with_tol(sub, DASH_LINK_MM)
    drop: set[int] = set()
    for comp in comps:
        pts = [p for k in comp for p in sub[k]]
        rect = MultiPoint(pts).minimum_rotated_rectangle
        if rect.geom_type != "Polygon":
            long_side = MultiPoint(pts).convex_hull.length / 2
            short_side = 0.0
        else:
            xs, ys = rect.exterior.coords.xy
            e1 = math.hypot(xs[1] - xs[0], ys[1] - ys[0])
            e2 = math.hypot(xs[2] - xs[1], ys[2] - ys[1])
            short_side, long_side = min(e1, e2), max(e1, e2)
        if short_side < LINEWORK_THIN_MM and long_side >= LINEWORK_LONG_MM:
            drop.update(short_idx[k] for k in comp)
    return [pts for i, pts in enumerate(items) if i not in drop]


def _furniture_labels(page, sheet, rooms):
    """실 안의 가구 라벨 후보 텍스트 (실 이름 제외). [(text, (x,y)mm)]"""
    skip = set(rooms) | {"실외기실", "복도"}
    out = []
    for w in page.get_text("words"):
        text = w[4]
        if text in skip:
            continue
        mx, my = sheet.to_mm((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)
        if any(poly.contains(Point(mx, my)) for poly in rooms.values()):
            out.append((text, (mx, my)))
    return out


def extract_furniture(pdf_path, page_index: int = PAGE_INDEX,
                      sheet: PlanSheet | None = None,
                      dump_path=DEFAULT_DUMP) -> list[dict]:
    """가구 장애물 목록. 각 dict: {name, room, rings, source}.

    rings 는 dump `spaces.outline` 계약과 같다: [외곽링] · 정수 mm · 닫는 점 없음.
    OccupancyGrid.from_rings 의 obstacle_rings 로 그대로 넣을 수 있다.
    """
    doc = pymupdf.open(pdf_path)
    try:
        page = doc[page_index]
        if sheet is None:
            sheet = page8_sheet(page)
        rooms = _load_rooms(dump_path)
        prepared = {name: prep(poly) for name, poly in rooms.items()}
        boundaries = {name: poly.boundary for name, poly in rooms.items()}

        # 1) 색·폭 필터 → 2) 실 내부(전 꼭짓점이 같은 실 안)
        #  → 3) 경계 인접 제거 → 4) 문 스윙 구역 제거
        kept: list[tuple[str, list]] = []
        for pts in _candidate_items(page, sheet):
            room = None
            for name, pp in prepared.items():
                if all(pp.contains(Point(x, y)) for x, y in pts):
                    room = name
                    break
            if room is None:
                continue  # 실 밖·경계 걸침(타일 벽-벽 선, 문짝 등)
            mx = (pts[0][0] + pts[-1][0]) / 2
            my = (pts[0][1] + pts[-1][1]) / 2
            zones = list(DOOR_ZONES_MM.values()) + list(NOTATION_ZONES_MM.values())
            if any(zx0 <= mx <= zx1 and zy0 <= my <= zy1
                   for zx0, zy0, zx1, zy1 in zones):
                continue  # 문 스윙 호·문턱·표기 선작업 — 장애물이 아니다
            boundary = boundaries[room]
            d = [boundary.distance(Point(x, y)) for x, y in (pts[0], pts[-1])]
            if boundary.distance(Point(mx, my)) < BORDER_MM or max(d) < BORDER_MM:
                continue  # 둘레 한계선·커텐박스·타일 격자·벽붙이 잔재
            kept.append((room, pts))

        # 5) 1D 선작업 제거 → 6) 실별 클러스터 → 7) 볼록 껍질 + 면적 하한
        raw = []
        by_room = defaultdict(list)
        for room, pts in kept:
            by_room[room].append(pts)
        for room in sorted(by_room):
            items = _drop_linework(by_room[room])
            for comp in _cluster(items):
                pts = [p for i in comp for p in items[i]]
                hull = MultiPoint(pts).convex_hull
                if hull.geom_type != "Polygon" or hull.area < MIN_AREA_M2 * 1e6:
                    continue
                raw.append((room, hull, len(comp)))

        # 8) 이름: 라벨은 가장 가깝고 작은 클러스터 하나에만, 나머지는 실별 서수
        raw.sort(key=lambda t: (t[0], -t[1].area, t[1].bounds))
        label_of: dict[int, str] = {}
        for text, xy in _furniture_labels(page, sheet, rooms):
            best = min(
                ((hull.distance(Point(*xy)), hull.area, i)
                 for i, (_, hull, _) in enumerate(raw)),
                default=None)
            if best is not None and best[0] <= LABEL_NEAR_MM and best[2] not in label_of:
                label_of[best[2]] = text
        counters: Counter = Counter()
        out = []
        for i, (room, hull, n_items) in enumerate(raw):
            if i in label_of:
                name = f"{room} {label_of[i]}"
            else:
                counters[room] += 1
                name = f"{room} 가구{counters[room]}"
            ring = [[int(round(x)), int(round(y))] for x, y in hull.exterior.coords[:-1]]
            out.append({
                "name": name,
                "room": room,
                "rings": [ring],
                "source": (f"pdf p{page_index + 1} 회색(2/3)·≤{MAX_WIDTH_PT}pt "
                           f"클러스터({n_items}개 아이템) 볼록 껍질"),
            })
        return out
    finally:
        doc.close()


# ── 시각 대조 PNG ──────────────────────────────────────────────


def render_overlay(pdf_path, furniture, out_path,
                   page_index: int = PAGE_INDEX, sheet: PlanSheet | None = None,
                   dump_path=DEFAULT_DUMP) -> Path:
    """도면 위에 추출 결과를 겹친 시각 대조 PNG.

    도면 렌더(회색조)를 mm 좌표로 깔고, 실 경계(파랑)·가구 껍질(빨강 반투명)·
    KNOWN_MISSING 구역(주황 파선)을 겹친다. 축 한계는 데이터에서 잡는다
    (bim/report/assets.py 의 MemoryError 교훈 — 축을 데이터 범위로 고정).
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.patches as mpatches
    import matplotlib.pyplot as plt
    from matplotlib import font_manager, rcParams

    for cand in ("Malgun Gothic", "NanumGothic", "AppleGothic"):
        if any(f.name == cand for f in font_manager.fontManager.ttflist):
            rcParams["font.family"] = cand
            break
    rcParams["axes.unicode_minus"] = False

    doc = pymupdf.open(pdf_path)
    try:
        page = doc[page_index]
        if sheet is None:
            sheet = page8_sheet(page)
        rooms = _load_rooms(dump_path)

        pad = 200.0
        x0mm, y0mm, x1mm, y1mm = -pad, -pad, 4500 + pad, 8970 + pad
        p_tl = (sheet.origin_pt[0] + x0mm * sheet.pt_per_mm,
                sheet.origin_pt[1] - y1mm * sheet.pt_per_mm)
        p_br = (sheet.origin_pt[0] + x1mm * sheet.pt_per_mm,
                sheet.origin_pt[1] - y0mm * sheet.pt_per_mm)
        clip = pymupdf.Rect(*p_tl, *p_br)
        pix = page.get_pixmap(dpi=150, clip=clip, colorspace="gray")
        import numpy as np
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)

        fig, ax = plt.subplots(figsize=(7, 12))
        ax.imshow(img, cmap="gray", extent=(x0mm, x1mm, y0mm, y1mm),
                  origin="upper", vmin=0, vmax=255)
        for name, poly in rooms.items():
            ax.plot(*poly.exterior.xy, color="tab:blue", lw=1.2, alpha=0.8)
        for f in furniture:
            ring = f["rings"][0]
            xs = [p[0] for p in ring] + [ring[0][0]]
            ys = [p[1] for p in ring] + [ring[0][1]]
            ax.fill(xs, ys, color="tab:red", alpha=0.25)
            ax.plot(xs, ys, color="tab:red", lw=1.2)
            cx = sum(p[0] for p in ring) / len(ring)
            cy = sum(p[1] for p in ring) / len(ring)
            ax.text(cx, cy, f["name"], fontsize=6, ha="center", va="center",
                    color="darkred")
        for m in KNOWN_MISSING:
            bb = m.get("approx_bbox_mm")
            if bb:
                ax.add_patch(mpatches.Rectangle(
                    (bb[0], bb[1]), bb[2] - bb[0], bb[3] - bb[1],
                    fill=False, edgecolor="tab:orange", ls="--", lw=1.5))
                ax.text(bb[0], bb[3] + 60, f"누락: {m['name']}", fontsize=6,
                        color="tab:orange")
        ax.set_xlim(x0mm, x1mm)
        ax.set_ylim(y0mm, y1mm)
        ax.set_aspect("equal")
        ax.set_title(f"8쪽 가구 추출 시각 대조 — {len(furniture)}개 "
                     f"(누락 {len(KNOWN_MISSING)}건 문서화)", fontsize=9)
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(out_path, dpi=110, bbox_inches="tight")
        plt.close(fig)
        return out_path
    finally:
        doc.close()


def _main():
    """스냅샷 + 시각 대조 PNG 재생성 (수동 검증 후 커밋)."""
    furniture = extract_furniture(DEFAULT_PDF)
    FIXTURES.mkdir(parents=True, exist_ok=True)
    snap = FIXTURES / "furniture_lh26.json"
    snap.write_text(
        json.dumps({"page_index": PAGE_INDEX, "furniture": furniture,
                    "missing": KNOWN_MISSING}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    png = render_overlay(DEFAULT_PDF, furniture, FIXTURES / "furniture_lh26_overlay.png")
    print(f"가구 {len(furniture)}개 추출:")
    for f in furniture:
        ring = f["rings"][0]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        print(f"  {f['name']}: bbox=({min(xs)},{min(ys)})-({max(xs)},{max(ys)})")
    print(f"스냅샷: {snap}")
    print(f"시각 대조: {png}")


if __name__ == "__main__":
    _main()

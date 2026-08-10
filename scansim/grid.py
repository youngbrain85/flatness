# -*- coding: utf-8 -*-
"""점유격자(OccupancyGrid): 링 래스터화 · 팽창 · 레이캐스트 · A*.

좌표계: 도면 로컬 mm (세부과업 2 덤프 spaces[].outline 과 동일).
셀 인덱스는 (ix, iy) — x·y 축 순서. 배열 저장은 free[iy, ix], shape (ny, nx).
셀 중심 = origin + (i + 0.5) * cell.
"""
from __future__ import annotations

import heapq
import math

import numpy as np
from scipy import ndimage

_SQRT2 = math.sqrt(2.0)

# 8방향 이웃: (dx, dy, 이동 비용[셀])
_NEIGHBORS = [
    (1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
    (1, 1, _SQRT2), (1, -1, _SQRT2), (-1, 1, _SQRT2), (-1, -1, _SQRT2),
]


def _normalize_outline(outline):
    """링 하나([[x,y]...])든 링 배열([[...링1], [...링2]])이든 링 목록으로 통일."""
    first = outline[0]
    if len(first) == 2 and isinstance(first[0], (int, float)):
        return [outline]  # 단일 링
    return list(outline)


def _point_in_rings(xs, ys, rings):
    """짝홀 규칙(even-odd) 점-다각형 포함 판정, 격자 전체 벡터화.

    rings: 링 목록 — 첫 링이 외곽, 나머지는 구멍 (닫는 점 없음, 짝홀이라
    구멍은 자동으로 빠진다). xs (nx,), ys (ny,) 셀 중심. 반환 (ny, nx) bool.
    """
    X = xs[np.newaxis, :]
    Y = ys[:, np.newaxis]
    inside = np.zeros((ys.size, xs.size), dtype=bool)
    for ring in rings:
        pts = np.asarray(ring, dtype=float)
        x1, y1 = pts[:, 0], pts[:, 1]
        x2, y2 = np.roll(x1, -1), np.roll(y1, -1)
        for i in range(len(pts)):
            if y1[i] == y2[i]:
                continue  # 수평 변은 교차 계수에 기여하지 않는다
            crosses = (y1[i] > Y) != (y2[i] > Y)
            xint = x1[i] + (Y - y1[i]) * (x2[i] - x1[i]) / (y2[i] - y1[i])
            inside ^= crosses & (X < xint)
    return inside


def _bresenham(ix0, iy0, ix1, iy1):
    """정수 셀 브레젠험 선분 — 양 끝 셀 포함."""
    dx = abs(ix1 - ix0)
    dy = abs(iy1 - iy0)
    sx = 1 if ix0 < ix1 else -1
    sy = 1 if iy0 < iy1 else -1
    err = dx - dy
    ix, iy = ix0, iy0
    while True:
        yield ix, iy
        if ix == ix1 and iy == iy1:
            return
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            ix += sx
        if e2 < dx:
            err += dx
            iy += sy


class OccupancyGrid:
    """자유/점유 셀 격자. free[iy, ix] == True 면 자유."""

    def __init__(self, free: np.ndarray, cell_mm: float, origin_xy):
        self.free = free
        self.cell_mm = float(cell_mm)
        self.origin_xy = (float(origin_xy[0]), float(origin_xy[1]))

    # ── 생성 ────────────────────────────────────────────────

    @classmethod
    def from_rings(cls, free_rings, obstacle_rings, cell_mm) -> "OccupancyGrid":
        """free_rings: 실 outline 들(각각 [외곽링, 구멍링...]).
        obstacle_rings: 가구 등 장애물(같은 구조 — 단일 링도 허용).
        셀 중심이 free 폴리곤 안 & obstacle 밖이면 free.
        """
        cell = float(cell_mm)
        outlines = [_normalize_outline(o) for o in free_rings]
        obstacles = [_normalize_outline(o) for o in obstacle_rings]
        pts = np.asarray(
            [p for o in outlines for ring in o for p in ring], dtype=float
        )
        if pts.size == 0:
            raise ValueError("free_rings 가 비어 있다 — 격자 범위를 잡을 수 없다")
        minx, miny = pts.min(axis=0)
        maxx, maxy = pts.max(axis=0)
        nx = max(1, int(math.ceil((maxx - minx) / cell - 1e-9)))
        ny = max(1, int(math.ceil((maxy - miny) / cell - 1e-9)))
        xs = minx + (np.arange(nx) + 0.5) * cell
        ys = miny + (np.arange(ny) + 0.5) * cell

        free = np.zeros((ny, nx), dtype=bool)
        for o in outlines:
            free |= _point_in_rings(xs, ys, o)
        for o in obstacles:
            free &= ~_point_in_rings(xs, ys, o)
        return cls(free, cell, (minx, miny))

    # ── 속성 ────────────────────────────────────────────────

    @property
    def shape(self):
        return self.free.shape  # (ny, nx)

    @property
    def free_ratio(self) -> float:
        return float(self.free.mean()) if self.free.size else 0.0

    # ── 좌표 변환 ───────────────────────────────────────────

    def world_to_cell(self, x, y):
        """mm 좌표 → 셀 인덱스 (ix, iy). 범위 밖은 가장자리 셀로 클램프."""
        ny, nx = self.free.shape
        ix = int(math.floor((x - self.origin_xy[0]) / self.cell_mm))
        iy = int(math.floor((y - self.origin_xy[1]) / self.cell_mm))
        return min(max(ix, 0), nx - 1), min(max(iy, 0), ny - 1)

    def cell_to_world(self, ix, iy):
        """셀 인덱스 → 셀 중심 mm 좌표."""
        return (
            self.origin_xy[0] + (ix + 0.5) * self.cell_mm,
            self.origin_xy[1] + (iy + 0.5) * self.cell_mm,
        )

    # ── 팽창 ────────────────────────────────────────────────

    def inflate(self, radius_mm) -> "OccupancyGrid":
        """장애물·벽을 반경만큼 부풀린 새 격자 (원본 불변).

        격자 밖(벽 너머)은 점유로 간주 — True 패딩 후 팽창해야 벽도 부푼다.
        """
        r = int(math.ceil(radius_mm / self.cell_mm - 1e-9))
        if r <= 0:
            return OccupancyGrid(self.free.copy(), self.cell_mm, self.origin_xy)
        occupied = ~self.free
        padded = np.pad(occupied, r, constant_values=True)
        yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
        # 셀 중심 간 거리(mm)가 반경 이하인 원판 구조 요소
        disk = (xx * xx + yy * yy) * self.cell_mm ** 2 <= radius_mm ** 2 + 1e-6
        dilated = ndimage.binary_dilation(padded, structure=disk)
        core = dilated[r:-r, r:-r]
        return OccupancyGrid(~core, self.cell_mm, self.origin_xy)

    # ── 레이캐스트 ──────────────────────────────────────────

    def raycast(self, x0, y0, x1, y1) -> bool:
        """(x0,y0)→(x1,y1) 시선이 자유 셀만 지나면 True, 막히면 False (Bresenham)."""
        ix0, iy0 = self.world_to_cell(x0, y0)
        ix1, iy1 = self.world_to_cell(x1, y1)
        for ix, iy in _bresenham(ix0, iy0, ix1, iy1):
            if not self.free[iy, ix]:
                return False
        return True

    # ── A* ─────────────────────────────────────────────────

    def astar(self, start_xy, goal_xy):
        """A* 경로 (mm 좌표 경유점 목록) 또는 None.

        8방향 + 대각 비용 √2. 대각 이동은 양 옆 직교 셀이 모두 자유일 때만
        허용(모서리 끼임 금지). 격자 경로는 레이캐스트 문자열-당기기로 平滑化
        — 빈 방 대각 경로가 유클리드 직선으로 수렴한다(대각보정).
        """
        start = self.world_to_cell(*start_xy)
        goal = self.world_to_cell(*goal_xy)
        if not self.free[start[1], start[0]] or not self.free[goal[1], goal[0]]:
            return None
        if start == goal:
            return [tuple(map(float, start_xy)), tuple(map(float, goal_xy))]

        cells = self._astar_cells(start, goal)
        if cells is None:
            return None

        # 셀 경로 → mm 경유점 (양 끝은 요청 좌표 그대로)
        pts = [tuple(map(float, start_xy))]
        pts += [self.cell_to_world(ix, iy) for ix, iy in cells[1:-1]]
        pts.append(tuple(map(float, goal_xy)))
        return self._string_pull(pts)

    def _astar_cells(self, start, goal):
        """셀 단위 A*. start·goal 은 (ix, iy)."""
        ny, nx = self.free.shape
        free = self.free

        def heuristic(c):
            dx = abs(c[0] - goal[0])
            dy = abs(c[1] - goal[1])
            return _SQRT2 * min(dx, dy) + abs(dx - dy)  # octile

        g_score = {start: 0.0}
        came_from = {}
        heap = [(heuristic(start), 0.0, start)]
        closed = set()
        while heap:
            _, g, cur = heapq.heappop(heap)
            if cur == goal:
                path = [cur]
                while cur in came_from:
                    cur = came_from[cur]
                    path.append(cur)
                return path[::-1]
            if cur in closed:
                continue
            closed.add(cur)
            cx, cy = cur
            for dx, dy, cost in _NEIGHBORS:
                mx, my = cx + dx, cy + dy
                if not (0 <= mx < nx and 0 <= my < ny) or not free[my, mx]:
                    continue
                if dx and dy and not (free[cy, mx] and free[my, cx]):
                    continue  # 모서리 끼임 금지
                nxt = (mx, my)
                ng = g + cost
                if ng < g_score.get(nxt, math.inf):
                    g_score[nxt] = ng
                    came_from[nxt] = cur
                    heapq.heappush(heap, (ng + heuristic(nxt), ng, nxt))
        return None

    def _string_pull(self, pts):
        """레이캐스트로 시야가 트인 최원거리 점까지 건너뛰며 경로 단축."""
        out = [pts[0]]
        i = 0
        while i < len(pts) - 1:
            j = len(pts) - 1
            while j > i + 1 and not self.raycast(*pts[i], *pts[j]):
                j -= 1
            out.append(pts[j])
            i = j
        return out

# -*- coding: utf-8 -*-
"""Task 1: 점유격자(OccupancyGrid) + A* 테스트.

계획 문서 docs/superpowers/plans/2026-08-10-scan-coverage.md Task 1 Step 1:
(a) 빈 방 free_ratio / 장애물 감소량
(b) raycast 관통 False, 옆으로 True
(c) astar 빈 방 대각 = 유클리드 ±5% / 우회 시 그 이상 / 목표 장애물 안이면 None
(d) inflate(250) 후 장애물·벽 인접 250mm 내 셀 점유
(e) 좌표 왕복 오차 ≤ cell/2
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scansim.config import ScanConfig  # noqa: E402
from scansim.grid import OccupancyGrid  # noqa: E402

CELL = 50.0
ROOM_W = 10000.0  # 10m
ROOM_H = 7000.0  # 7m

# 실 outline: [외곽링, 구멍링...] — 닫는 점 없음 (lh26_dump.json 계약과 동일)
ROOM_OUTLINE = [[[0, 0], [ROOM_W, 0], [ROOM_W, ROOM_H], [0, ROOM_H]]]
# 중앙 2m x 1m 장애물 (셀 경계 정렬)
OBSTACLE_OUTLINE = [[[4000, 3000], [6000, 3000], [6000, 4000], [4000, 4000]]]


def empty_room():
    return OccupancyGrid.from_rings([ROOM_OUTLINE], [], CELL)


def room_with_obstacle():
    return OccupancyGrid.from_rings([ROOM_OUTLINE], [OBSTACLE_OUTLINE], CELL)


def path_length(path):
    return sum(
        math.hypot(x1 - x0, y1 - y0)
        for (x0, y0), (x1, y1) in zip(path, path[1:])
    )


# ── (a) 래스터화 ─────────────────────────────────────────────


class TestFromRings:
    def test_empty_room_free_ratio_near_one(self):
        g = empty_room()
        assert g.free_ratio > 0.99

    def test_shape_cell_origin(self):
        g = empty_room()
        assert g.shape == (int(ROOM_H / CELL), int(ROOM_W / CELL))  # (ny, nx)
        assert g.cell_mm == CELL
        assert g.origin_xy == (0.0, 0.0)

    def test_obstacle_reduces_free_by_its_area(self):
        n_free_empty = int(empty_room().free.sum())
        n_free_obst = int(room_with_obstacle().free.sum())
        expected_cells = int((2000 / CELL) * (1000 / CELL))  # 800
        assert abs((n_free_empty - n_free_obst) - expected_cells) <= 2  # ±2셀

    def test_hole_ring_is_not_free(self):
        # 외곽 + 구멍(중앙 1x1m)이 한 outline 에 담긴 경우 — 구멍 안은 비자유
        outline = [
            ROOM_OUTLINE[0],
            [[4500, 3000], [5500, 3000], [5500, 4000], [4500, 4000]],
        ]
        g = OccupancyGrid.from_rings([outline], [], CELL)
        ix, iy = g.world_to_cell(5000, 3500)
        assert not g.free[iy, ix]
        ix, iy = g.world_to_cell(1000, 1000)
        assert g.free[iy, ix]


# ── (b) 레이캐스트 ───────────────────────────────────────────


class TestRaycast:
    def test_blocked_through_obstacle(self):
        g = room_with_obstacle()
        assert g.raycast(500, 3500, 9500, 3500) is False

    def test_clear_beside_obstacle(self):
        g = room_with_obstacle()
        assert g.raycast(500, 1000, 9500, 1000) is True


# ── (c) A* ──────────────────────────────────────────────────


class TestAstar:
    def test_empty_room_diagonal_within_5pct_of_euclid(self):
        g = empty_room()
        start, goal = (500, 500), (9500, 6500)
        path = g.astar(start, goal)
        assert path is not None
        euclid = math.hypot(goal[0] - start[0], goal[1] - start[1])
        assert abs(path_length(path) - euclid) <= 0.05 * euclid
        # 끝점이 요청 좌표와 일치 (셀 이내)
        assert math.hypot(path[0][0] - start[0], path[0][1] - start[1]) <= CELL
        assert math.hypot(path[-1][0] - goal[0], path[-1][1] - goal[1]) <= CELL

    def test_detour_longer_than_euclid(self):
        g = room_with_obstacle()
        start, goal = (500, 3500), (9500, 3500)
        path = g.astar(start, goal)
        assert path is not None
        euclid = math.hypot(goal[0] - start[0], goal[1] - start[1])
        assert path_length(path) > euclid * 1.005  # 우회이므로 직선보다 길다
        assert path_length(path) < euclid * 1.15  # 그래도 과도한 우회는 아님
        # 경로의 각 구간은 시야가 트여 있다 (점유 셀 통과 금지)
        for (x0, y0), (x1, y1) in zip(path, path[1:]):
            assert g.raycast(x0, y0, x1, y1) is True

    def test_goal_inside_obstacle_returns_none(self):
        g = room_with_obstacle()
        assert g.astar((500, 500), (5000, 3500)) is None


# ── (d) 팽창 ─────────────────────────────────────────────────


class TestInflate:
    def test_cells_within_radius_of_obstacle_become_occupied(self):
        g = room_with_obstacle().inflate(250)
        ix, iy = g.world_to_cell(6200, 3500)  # 장애물 우변에서 200mm
        assert not g.free[iy, ix]

    def test_cells_beyond_radius_stay_free(self):
        g = room_with_obstacle().inflate(250)
        ix, iy = g.world_to_cell(6600, 3500)  # 장애물에서 550mm, 벽에서 멀다
        assert g.free[iy, ix]

    def test_walls_inflate_too(self):
        g = empty_room().inflate(250)
        ix, iy = g.world_to_cell(100, 3500)  # 좌측 벽에서 100mm
        assert not g.free[iy, ix]

    def test_original_grid_unchanged(self):
        g0 = room_with_obstacle()
        g0.inflate(250)
        ix, iy = g0.world_to_cell(6200, 3500)
        assert g0.free[iy, ix]  # 원본은 그대로


# ── (e) 좌표 왕복 ────────────────────────────────────────────


class TestCoordRoundtrip:
    def test_roundtrip_error_at_most_half_cell(self):
        g = empty_room()
        for x, y in [(12, 34), (5432, 1234), (9999, 6999), (25, 25), (10000, 7000)]:
            ix, iy = g.world_to_cell(x, y)
            wx, wy = g.cell_to_world(ix, iy)
            assert abs(wx - x) <= CELL / 2 + 1e-9
            assert abs(wy - y) <= CELL / 2 + 1e-9


# ── ScanConfig ───────────────────────────────────────────────


class TestScanConfig:
    def test_defaults(self):
        cfg = ScanConfig()
        assert cfg.cell_mm == 50.0
        assert cfg.step_s == 0.2
        assert cfg.density_targets_mm == {"mobile": 20.0, "tls": 5.0}

    def test_kwargs_override(self):
        cfg = ScanConfig(cell_mm=25.0, tls_range_mm=15000.0)
        assert cfg.cell_mm == 25.0
        assert cfg.tls_range_mm == 15000.0
        assert cfg.mobile_fov_deg == 90.0  # 나머지는 기본값 유지

    def test_from_json(self, tmp_path):
        p = tmp_path / "cfg.json"
        p.write_text(
            '{"cell_mm": 25.0, "density_targets_mm": {"mobile": 10.0, "tls": 2.0}}',
            encoding="utf-8",
        )
        cfg = ScanConfig.from_json(p)
        assert cfg.cell_mm == 25.0
        assert cfg.density_targets_mm == {"mobile": 10.0, "tls": 2.0}
        assert cfg.step_s == 0.2  # 파일에 없는 필드는 기본값

    def test_from_json_unknown_key_raises(self, tmp_path):
        p = tmp_path / "cfg.json"
        p.write_text('{"cel_mm": 25.0}', encoding="utf-8")  # 오타
        try:
            ScanConfig.from_json(p)
        except ValueError:
            pass
        else:
            raise AssertionError("알 수 없는 키가 조용히 무시됐다")

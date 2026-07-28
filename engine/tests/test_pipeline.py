import numpy as np
from tests.fixtures.synthetic import flat_floor, flat_wall, add_bump, add_step, write_binary_ply
from flatness.core.pipeline import analyze_floor, analyze_wall
from flatness.criteria import load_criteria

CRIT = load_criteria()["floor-kcs-exposed"]  # pass 7 / rework 21, U=5 → b1=2, b2=12

def test_depression_end_to_end(tmp_path):
    # 6x6m 바닥 + 2% 경사 + (2,2)에 10mm 함몰 → 경사 제거 후 함몰 검출
    # (함몰은 직선자 해석 정답이 정확히 깊이 — 2026-07-28 정정, 범프는 지지선 기하로 8.6mm가 정답)
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02, tilt=(0.02, 0.0)),
                   (2.0, 2.0), 0.3, -0.010)
    write_binary_ply(pts, tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert 9.0 <= stats["worst"]["value_mm"] <= 11.0          # ±1mm (스펙 §10.1)
    assert abs(stats["worst"]["point_x"] - 2.0) < 1.0         # 위치 1셀 이내
    assert abs(stats["worst"]["point_y"] - 2.0) < 1.0
    assert stats["grade_counts"]["borderline"] >= 1           # ≈10mm → 경계(2<10≤12)
    assert stats["grade_counts"]["pass"] >= 20                # 먼 셀은 적합(≈0mm)
    assert (tmp_path / "out" / "heatmap.png").exists()
    assert (tmp_path / "out" / "results.csv").exists()

def test_step_grades_repair(tmp_path):
    # x=3.0에 15mm 단차 → 12 < 15 ≤ 21 → 보수
    pts = add_step(flat_floor(size=(6.0, 6.0), spacing=0.02), 3.0, 0.015)
    write_binary_ply(pts, tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert abs(stats["worst"]["value_mm"] - 15.0) <= 1.0
    assert abs(stats["worst"]["point_x"] - 3.0) < 1.0         # 단차선 부근
    assert stats["grade_counts"]["repair"] >= 1

def test_two_rooms_independent_verdicts(tmp_path):
    # 방 A(z=0) + 방 B(z=0.5, 10mm 함몰) — 구역 독립 판정, 교차 오염 없음
    a = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b = add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02), (2.0, 1.5), 0.3, -0.010)
    b[:, 0] += 4.4
    b[:, 2] += 0.5
    write_binary_ply(np.vstack([a, b]), tmp_path / "rooms.ply")
    stats = analyze_floor(tmp_path / "rooms.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert len([z for z in stats["zones"] if z["status"] == "ok"]) == 2
    assert 9.0 <= stats["worst"]["value_mm"] <= 11.0
    assert abs(stats["worst"]["point_x"] - 6.4) < 1.0   # 함몰은 방 B(4.4+2.0)에
    assert stats["coverage_pct"] > 85.0
    # 방 A 셀은 전부 적합(구역 경계·레벨 차가 새어들지 않음)
    import json
    cells = json.loads((tmp_path / "out" / "cells.json").read_text("utf-8"))
    room_a = [c for c in cells if c["center_x"] < 4.0 and c["grade"] != "na"]
    assert len(room_a) >= 6 and all(c["grade"] == "pass" for c in room_a)

def test_ghost_patch_warns_and_masks(tmp_path):
    base = flat_floor(size=(6.0, 4.0), spacing=0.02)
    patch = flat_floor(size=(1.0, 1.0), spacing=0.02)
    patch[:, 0] += 2.0; patch[:, 1] += 1.5; patch[:, 2] += 0.015
    write_binary_ply(np.vstack([base, patch]), tmp_path / "ghost.ply")
    stats = analyze_floor(tmp_path / "ghost.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert "ghost_layer_rescan" in stats["warnings"]
    assert stats["grade_counts"]["na"] >= 1  # 이중층 지역은 판정 불가

def test_low_coverage_warning(tmp_path):
    # 티켓 14: 바닥 절반이 판정 불가 수준이면 low_coverage 경고
    a = flat_floor(size=(3.0, 3.0), spacing=0.02)
    junk = flat_floor(size=(3.0, 3.0), spacing=0.02, tilt=(0.4, 0.0))  # 40% 급경사(비바닥)
    junk[:, 0] += 3.2
    write_binary_ply(np.vstack([a, junk]), tmp_path / "s.ply")
    stats = analyze_floor(tmp_path / "s.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert stats["coverage_pct"] < 70.0
    assert "low_coverage" in stats["warnings"]

def test_wall_end_to_end(tmp_path):
    from flatness.core.pipeline import analyze_wall
    from tests.fixtures.synthetic import flat_wall
    w = flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0)
    r = np.hypot(w[:, 0] - 2.0, w[:, 2] - 1.2)
    m = r < 0.3
    w[m, 1] -= 0.012 * 0.5 * (1.0 + np.cos(np.pi * r[m] / 0.3))
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02), w,
                     flat_wall(length=3.0, height=2.4, spacing=0.02, axis='y', y0=0.0)])
    write_binary_ply(pts, tmp_path / "room.ply")
    crit = load_criteria()["wall-kcs-tilt-other"]
    stats = analyze_wall(tmp_path / "room.ply", 1.0, crit, 8.0, tmp_path / "out")
    assert len(stats["walls"]) == 2
    assert "plumbness_relative_to_z" in stats["warnings"]
    assert 11.0 <= stats["worst"]["value_mm"] <= 13.0
    assert (tmp_path / "out" / "heatmap_wall1.png").exists()
    assert (tmp_path / "out" / "heatmap_wall2.png").exists()

def test_wall_error_isolated(tmp_path, monkeypatch):
    # 티켓 17: 한 벽의 평가 실패가 전체 분석을 죽이지 않는다
    from flatness.core import pipeline as pl
    from tests.fixtures.synthetic import flat_wall
    calls = {"n": 0}
    real = pl.evaluate_wall
    def flaky(grid, criterion, u_mm, cell_m=1.0):
        calls["n"] += 1
        if calls["n"] == 2:
            raise ValueError("주입된 벽 평가 실패")
        return real(grid, criterion, u_mm, cell_m=cell_m)
    monkeypatch.setattr(pl, "evaluate_wall", flaky)
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0),
                     flat_wall(length=3.0, height=2.4, spacing=0.02, axis='y', y0=0.0)])
    write_binary_ply(pts, tmp_path / "room.ply")
    crit = load_criteria()["wall-kcs-tilt-other"]
    stats = pl.analyze_wall(tmp_path / "room.ply", 1.0, crit, 8.0, tmp_path / "out")
    assert len(stats["walls"]) == 1                      # 성한 벽만
    assert any(w.startswith("wall_") and w.endswith("_skipped") for w in stats["warnings"])

def test_wall_frame_serialized(tmp_path):
    # 티켓 19: stats만으로 벽 로컬 (u,v)를 월드로 역매핑 가능해야 함
    from tests.fixtures.synthetic import flat_wall
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0)])
    write_binary_ply(pts, tmp_path / "room.ply")
    crit = load_criteria()["wall-kcs-tilt-other"]
    stats = analyze_wall(tmp_path / "room.ply", 1.0, crit, 8.0, tmp_path / "out")
    fr = stats["walls"][0]["frame"]
    assert set(fr) == {"p0", "direction", "normal", "u_min", "u_max", "z_min", "z_max"}
    assert len(fr["p0"]) == 2 and len(fr["direction"]) == 2 and len(fr["normal"]) == 2

def test_meta_version_and_surface(tmp_path):
    from flatness import ENGINE_VERSION
    write_binary_ply(flat_floor(size=(3.0, 3.0), spacing=0.02), tmp_path / "f.ply")
    stats = analyze_floor(tmp_path / "f.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert stats["meta"]["engine_version"] == ENGINE_VERSION
    assert stats["meta"]["surface"] == "floor"
    assert len(stats["meta"]["bbox_min"]) == 3  # 좌표 프레임 앵커 (P2 계약)

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


def test_floor_deviation_map_generated(tmp_path):
    # 정밀 편차맵은 판정과 무관한 추가 산출물이다 — 파일과 stats 목록이 함께 나와야 한다
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010)
    write_binary_ply(pts, tmp_path / "scan.ply")

    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")

    assert stats["deviation_paths"] == ["deviation.png"]
    assert (tmp_path / "out" / "deviation.png").stat().st_size > 5000
    # 판정 결과는 편차맵과 무관하게 종전 그대로다
    assert 9.0 <= stats["worst"]["value_mm"] <= 11.0
    import json
    saved = json.loads((tmp_path / "out" / "stats.json").read_text("utf-8"))
    assert saved["deviation_paths"] == ["deviation.png"]   # write_outputs 이전에 기록돼야 함


def test_wall_deviation_maps_generated_per_wall(tmp_path):
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0),
                     flat_wall(length=3.0, height=2.4, spacing=0.02, axis='y', y0=0.0)])
    write_binary_ply(pts, tmp_path / "room.ply")
    crit = load_criteria()["wall-kcs-tilt-other"]

    stats = analyze_wall(tmp_path / "room.ply", 1.0, crit, 8.0, tmp_path / "out")

    assert stats["deviation_paths"] == ["deviation_wall1.png", "deviation_wall2.png"]
    for name in stats["deviation_paths"]:
        assert (tmp_path / "out" / name).stat().st_size > 5000


def test_wall_deviation_keeps_gap_numbering(tmp_path, monkeypatch):
    # 스킵된 벽은 히트맵과 마찬가지로 편차맵도 결번이다(파일 존재를 가정하면 안 된다)
    from flatness.core import pipeline as pl
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

    assert stats["deviation_paths"] == ["deviation_wall1.png"]
    assert not (tmp_path / "out" / "deviation_wall2.png").exists()


def test_floor_render_failure_does_not_lose_judged_result(tmp_path, monkeypatch):
    # 하드닝(Task 1·2 리뷰 Important): 렌더(히트맵/프리뷰/편차맵) 호출이 예외를 던져도
    # 이미 완성된 판정 결과(stats)는 반드시 저장돼야 하고, 실패는 warnings로만 남는다.
    import json
    from flatness.core import pipeline as pl

    def boom(*a, **kw):
        raise RuntimeError("주입된 렌더 실패(디스크/폰트 등 인프라 사유 모사)")

    monkeypatch.setattr(pl, "render_heatmap", boom)
    monkeypatch.setattr(pl, "render_preview3d", boom)
    monkeypatch.setattr(pl, "render_deviation_map", boom)
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010)
    write_binary_ply(pts, tmp_path / "scan.ply")

    stats = pl.analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")

    # 판정 수치는 렌더 실패와 무관하게 종전 그대로(기존 e2e 테스트와 동일 허용치)
    assert 9.0 <= stats["worst"]["value_mm"] <= 11.0
    assert stats["preview3d_paths"] == []
    assert stats["deviation_paths"] == []
    for code in ("heatmap_render_failed", "preview3d_render_failed", "deviation_render_failed"):
        assert code in stats["warnings"]
    # stats.json이 실제로 디스크에 저장됐고 경고가 그대로 기록됨(write_outputs가 렌더
    # 실패에 막히지 않음 — 렌더 실패로 판정 "가용성"이 사라지지 않는지 검증)
    assert (tmp_path / "out" / "stats.json").exists()
    saved = json.loads((tmp_path / "out" / "stats.json").read_text("utf-8"))
    assert saved["warnings"] == stats["warnings"]
    assert not (tmp_path / "out" / "heatmap.png").exists()  # 렌더가 실패해 파일 자체가 없음


def test_wall_render_failure_isolated_per_wall(tmp_path, monkeypatch):
    # 하드닝: 벽 1의 렌더 실패가 (1) 벽 1의 이미 성공한 판정과 (2) 벽 2 처리 모두에
    # 전파돼선 안 된다 — 티켓 17("벽별 실패 격리")의 의도를 렌더 호출에도 재정합.
    from flatness.core import pipeline as pl
    calls = {"n": 0}
    real = pl.render_heatmap

    def flaky(cells, grades, out_path, cell_m=1.0):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("주입된 렌더 실패(벽 1)")
        return real(cells, grades, out_path, cell_m=cell_m)

    monkeypatch.setattr(pl, "render_heatmap", flaky)
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0),
                     flat_wall(length=3.0, height=2.4, spacing=0.02, axis='y', y0=0.0)])
    write_binary_ply(pts, tmp_path / "room.ply")
    crit = load_criteria()["wall-kcs-tilt-other"]

    stats = pl.analyze_wall(tmp_path / "room.ply", 1.0, crit, 8.0, tmp_path / "out")

    # 벽 1은 렌더만 실패했을 뿐 판정 자체는 성공했으므로 두 벽 모두 결과에 남는다
    assert len(stats["walls"]) == 2
    assert not any(w.startswith("wall_") and w.endswith("_skipped") for w in stats["warnings"])
    assert "heatmap_render_failed" in stats["warnings"]
    assert not (tmp_path / "out" / "heatmap_wall1.png").exists()  # 벽 1 렌더 실패 → 결번
    assert (tmp_path / "out" / "heatmap_wall2.png").exists()      # 벽 2는 정상 렌더

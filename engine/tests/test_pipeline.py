import json
from pathlib import Path
import numpy as np
import pytest
from tests.fixtures.synthetic import flat_floor, flat_wall, add_bump, add_step, write_binary_ply
from flatness.core import pipeline as pl
from flatness.core.pipeline import analyze_floor, analyze_wall
from flatness.criteria import load_criteria
from flatness.outputs.points3d import read_points3d

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


# ---- 3D 점군 뷰어용 점 파일 points3d.bin (스펙 2026-10-02 §4.4, §4.5, §6.1) ----

# 점 파일 생성이 실패해도 그대로여야 하는 판정 수치(스펙 §4.5 목록)
POINTS3D_JUDGED_KEYS = ("grade_counts", "worst", "value_max_mm", "value_min_mm",
                        "value_mean_mm", "value_p95_mm", "coverage_pct",
                        "applied_criteria", "zones")


def _dent_scan(dirpath):
    """6x6m 평탄 바닥(2cm 간격, 301 x 301 = 90,601점) + (2, 2)에 반경 0.3m, 깊이 10mm 함몰."""
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010)
    path = dirpath / "scan.ply"
    write_binary_ply(pts, path)
    return path


def test_floor_points3d_generated(tmp_path):
    scan = _dent_scan(tmp_path)
    out = tmp_path / "out"

    stats = pl.analyze_floor(scan, 1.0, CRIT, 5.0, out)

    assert stats["points3d_paths"] == ["points3d.bin"]
    assert (out / "points3d.bin").is_file()
    # 표시 임계값 = pass_mm 7 x 10 = 70 (0.1mm 정수). rework_mm(21)에서 유도하면 210 이 된다
    assert stats["points3d_threshold_q"] == 70
    assert type(stats["points3d_threshold_q"]) is int
    # 보고서가 preview3d_paths 의 파일을 3D 프리뷰 그림으로 복사하므로 점 파일이 섞이면 안 된다
    assert stats["preview3d_paths"] != []
    assert "points3d.bin" not in stats["preview3d_paths"]
    assert "points3d_render_failed" not in stats["warnings"]
    saved = json.loads((out / "stats.json").read_text("utf-8"))
    assert saved["points3d_paths"] == ["points3d.bin"]     # write_outputs 이전에 기록돼야 한다
    assert saved["points3d_threshold_q"] == 70
    # 파일 내용이 이 스캔의 것인지 본다: 3번째 패스가 읽은 점 수, 함몰의 깊이와 위치
    meta, xyz_q, dev_q = read_points3d((out / "points3d.bin").read_bytes())
    assert meta["sampling"]["source_points"] == 301 * 301
    assert 1 <= meta["n_points"] == len(dev_q) <= 500_000
    i = int(np.argmin(np.where(dev_q > -32767, dev_q, 32767)))   # 센티널을 뺀 최솟값의 위치
    assert -110 <= int(dev_q[i]) <= -90      # 10mm 함몰 = -100 (0.1mm 단위). 기존 e2e 와 같은 +-1mm 허용
    x = meta["origin_m"][0] + float(xyz_q[i, 0]) * meta["extent_m"][0] / 65535
    y = meta["origin_m"][1] + float(xyz_q[i, 1]) * meta["extent_m"][1] / 65535
    assert abs(x - 2.0) < 0.1 and abs(y - 2.0) < 0.1


def _points3d_sample_boom(*args, **kwargs):
    raise RuntimeError("주입된 표본 추출 실패")


def _points3d_write_partial_then_boom(sample, out_path):
    # 머리 4바이트만 쓰고 죽는 작성기. out_dir 에 부분 파일이 남는 상황을 만든다
    Path(out_path).write_bytes(b"FP3D")
    raise OSError("주입된 쓰기 실패(디스크 가득 참 모사)")


@pytest.mark.parametrize("target, fake", [
    ("sample_points", _points3d_sample_boom),
    ("write_points3d", _points3d_write_partial_then_boom),
])
def test_floor_points3d_failure_isolated(tmp_path, monkeypatch, target, fake):
    # 점 파일 생성만 실패한 실행을 정상 실행과 비교한다(같은 스캔, 서로 다른 출력 폴더)
    scan = _dent_scan(tmp_path)
    ok_out, bad_out = tmp_path / "ok", tmp_path / "bad"
    ok = pl.analyze_floor(scan, 1.0, CRIT, 5.0, ok_out)
    monkeypatch.setattr(pl, target, fake)

    bad = pl.analyze_floor(scan, 1.0, CRIT, 5.0, bad_out)

    # 대조군: 정상 실행은 실제로 점 파일을 만들었다
    assert ok["points3d_paths"] == ["points3d.bin"] and (ok_out / "points3d.bin").is_file()
    for key in POINTS3D_JUDGED_KEYS:
        assert bad[key] == ok[key], key
    # 점 파일과 무관한 나머지 stats(종합의견, meta, 다른 산출물 목록)도 그대로다
    drop = ("points3d_paths", "points3d_threshold_q", "warnings")
    assert ({k: v for k, v in bad.items() if k not in drop}
            == {k: v for k, v in ok.items() if k not in drop})
    # 늘어난 경고는 정확히 하나다(다른 렌더 블록이 함께 실패하지 않았다)
    assert set(bad["warnings"]) - set(ok["warnings"]) == {"points3d_render_failed"}
    assert set(ok["warnings"]) <= set(bad["warnings"])
    assert bad["points3d_paths"] == []
    assert "points3d_threshold_q" not in bad
    assert not (bad_out / "points3d.bin").exists()       # 워커가 out_dir 의 모든 파일을 올린다
    for name in ("cells.json", "results.csv"):
        assert (bad_out / name).read_bytes() == (ok_out / name).read_bytes(), name
    for name in ("heatmap.png", "preview3d.png", "deviation.png"):
        assert (bad_out / name).stat().st_size > 0, name
    assert bad["preview3d_paths"] == ok["preview3d_paths"] != []
    assert bad["deviation_paths"] == ["deviation.png"]
    saved = json.loads((bad_out / "stats.json").read_text("utf-8"))
    assert saved["points3d_paths"] == []
    assert "points3d_threshold_q" not in saved
    assert "points3d_render_failed" in saved["warnings"]


def test_floor_points3d_block_independent_of_other_renders(tmp_path, monkeypatch):
    # 기존 렌더 3종이 전부 실패해도 점 파일은 만들어진다(새 블록은 독립 try/except)
    def boom(*args, **kwargs):
        raise RuntimeError("주입된 렌더 실패")

    monkeypatch.setattr(pl, "render_heatmap", boom)
    monkeypatch.setattr(pl, "render_preview3d", boom)
    monkeypatch.setattr(pl, "render_deviation_map", boom)
    scan = _dent_scan(tmp_path)
    out = tmp_path / "out"

    stats = pl.analyze_floor(scan, 1.0, CRIT, 5.0, out)

    assert stats["points3d_paths"] == ["points3d.bin"]
    assert (out / "points3d.bin").is_file()
    assert stats["points3d_threshold_q"] == 70
    assert "points3d_render_failed" not in stats["warnings"]
    # 주입이 실제로 걸렸다(세 렌더는 실패했다)
    assert stats["preview3d_paths"] == [] and stats["deviation_paths"] == []
    assert not (out / "heatmap.png").exists()
    for code in ("heatmap_render_failed", "preview3d_render_failed", "deviation_render_failed"):
        assert code in stats["warnings"]


def test_floor_points3d_bytes_do_not_depend_on_criterion(tmp_path):
    scan = _dent_scan(tmp_path)
    lh = load_criteria()["floor-lh-exposed"]       # pass 6 / rework 18

    a = pl.analyze_floor(scan, 1.0, CRIT, 5.0, tmp_path / "kcs")
    b = pl.analyze_floor(scan, 1.0, lh, 5.0, tmp_path / "lh")

    # 대조군: 두 실행의 기준이 실제로 달랐다
    assert a["applied_criteria"]["pass_mm"] == 7 and b["applied_criteria"]["pass_mm"] == 6
    assert a["points3d_threshold_q"] == 70         # 7mm x 10
    assert b["points3d_threshold_q"] == 60         # 6mm x 10
    blob_a = (tmp_path / "kcs" / "points3d.bin").read_bytes()
    blob_b = (tmp_path / "lh" / "points3d.bin").read_bytes()
    assert len(blob_a) > 8 + 8 * 1000              # 빈 파일끼리의 일치가 아니다
    assert blob_a == blob_b


def test_floor_points3d_chunk_size_invariant(tmp_path, monkeypatch):
    scan = _dent_scan(tmp_path)
    pl.analyze_floor(scan, 1.0, CRIT, 5.0, tmp_path / "default")
    seen = []
    real = pl.sample_points

    def spy(chunks, *args, **kwargs):
        # 3번째 패스가 받는 청크 크기를 기록하고 실제 함수로 넘긴다
        def tap():
            for c in chunks:
                seen.append(len(c))
                yield c
        return real(tap(), *args, **kwargs)

    monkeypatch.setattr(pl, "sample_points", spy)

    pl.analyze_floor(scan, 1.0, CRIT, 5.0, tmp_path / "small", chunk_size=50_000)

    # 90,601점이 5만 점 청크 둘로 왔다. chunk_size 를 넘기지 않으면 [90601] 이 된다
    assert seen == [50_000, 40_601]
    assert ((tmp_path / "small" / "points3d.bin").read_bytes()
            == (tmp_path / "default" / "points3d.bin").read_bytes())


def test_wall_has_no_points3d(tmp_path):
    # 범위 가드: 점 파일은 바닥 분석만 만든다(벽면은 키도 파일도 없다)
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0)])
    write_binary_ply(pts, tmp_path / "room.ply")
    crit = load_criteria()["wall-kcs-tilt-other"]

    stats = pl.analyze_wall(tmp_path / "room.ply", 1.0, crit, 8.0, tmp_path / "out")

    saved = json.loads((tmp_path / "out" / "stats.json").read_text("utf-8"))
    for key in ("points3d_paths", "points3d_threshold_q"):
        assert key not in stats
        assert key not in saved
    assert not (tmp_path / "out" / "points3d.bin").exists()

import dataclasses
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
    # 소수 허용치. 워커는 DB 기준 행의 pass_mm 을 변환 없이 넘기므로(worker/flatworker/jobs.py 의
    # _to_criterion) 운영에서는 정수가 아닐 수 있다. 위 두 시드 기준(7, 6)은 정수라 임계값 계산식
    # (반올림·절삭·변환 누락)을 가르지 못한다
    frac = dataclasses.replace(CRIT, pass_mm=6.66)

    a = pl.analyze_floor(scan, 1.0, CRIT, 5.0, tmp_path / "kcs")
    b = pl.analyze_floor(scan, 1.0, lh, 5.0, tmp_path / "lh")
    c = pl.analyze_floor(scan, 1.0, frac, 5.0, tmp_path / "frac")

    # 대조군: 세 실행의 기준이 실제로 달랐다
    assert a["applied_criteria"]["pass_mm"] == 7 and b["applied_criteria"]["pass_mm"] == 6
    assert c["applied_criteria"]["pass_mm"] == 6.66
    assert a["points3d_threshold_q"] == 70         # 7mm x 10
    assert b["points3d_threshold_q"] == 60         # 6mm x 10
    # 6.66mm x 10 = 66.6: 반올림 67, 절삭 66, 변환 누락 66.6, 먼저 반올림(7 x 10) 70 이 서로 갈린다
    assert c["points3d_threshold_q"] == 67
    # round(66.6, 0) 은 67.0(float)이라 위 값 비교만으로는 안 잡힌다. 정수 허용치에서는 7 x 10 이 이미 int 다
    assert type(c["points3d_threshold_q"]) is int
    blob_a = (tmp_path / "kcs" / "points3d.bin").read_bytes()
    blob_b = (tmp_path / "lh" / "points3d.bin").read_bytes()
    blob_c = (tmp_path / "frac" / "points3d.bin").read_bytes()
    assert len(blob_a) > 8 + 8 * 1000              # 빈 파일끼리의 일치가 아니다
    assert blob_a == blob_b == blob_c


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


# 사용자 시험판(2026-10-19, 스펙 2·3 §4): 43cm 판처럼 1㎡ 구역이 하나도 없어도 한 덩어리가 유효 서브셀
# 대부분(80%↑)이면 그 덩어리를 판정 구역으로 인정하고 small_specimen 경고를 단다.
def test_small_specimen_is_analyzed_with_warning(tmp_path):
    pts = flat_floor(size=(0.4, 0.35), spacing=0.005)
    write_binary_ply(pts, tmp_path / "board.ply")
    stats = analyze_floor(tmp_path / "board.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert "small_specimen" in stats["warnings"]
    assert (tmp_path / "out" / "cells.json").exists()


def test_scattered_fragments_still_fail(tmp_path):
    # 서로 떨어진 같은 크기 판 두 장: 가장 큰 덩어리가 유효 서브셀의 50% 라 시편으로 보지 않는다
    a = flat_floor(size=(0.4, 0.4), spacing=0.005)
    b = a + np.array([2.0, 0.0, 0.0])
    write_binary_ply(np.vstack([a, b]), tmp_path / "frag.ply")
    with pytest.raises(ValueError, match="판정 가능한 바닥 구역 없음"):
        analyze_floor(tmp_path / "frag.ply", 1.0, CRIT, 5.0, tmp_path / "out")


def test_small_specimen_ignores_stray_fragment(tmp_path):
    # 판 옆 떨어진 작은 파편(점군 잡음)은 판정 구역이 아니다: 가장 큰 덩어리 하나만 구역으로 남는다
    board = flat_floor(size=(0.4, 0.4), spacing=0.005)
    stray = flat_floor(size=(0.05, 0.05), spacing=0.005) + np.array([0.8, 0.0, 0.0])
    write_binary_ply(np.vstack([board, stray]), tmp_path / "board.ply")
    stats = analyze_floor(tmp_path / "board.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert "small_specimen" in stats["warnings"]
    assert [z["status"] for z in stats["zones"]] == ["ok"]


# 판정 셀 0.5/1/2m(스펙 2·3 §1): 공식 판정은 0.5m, 1·2m 는 cells_alt.json 에 비교용으로 싣는다
def test_official_cell_is_half_metre(tmp_path):
    write_binary_ply(flat_floor(size=(3.0, 2.0), spacing=0.02), tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert stats["meta"]["cell_m"] == 0.5
    rows = json.loads((tmp_path / "out" / "cells.json").read_text(encoding="utf-8"))
    assert max(r["ix"] for r in rows) >= 5 and max(r["iy"] for r in rows) >= 3  # 3m/0.5=6열, 2m/0.5=4행


def test_cells_alt_holds_one_and_two_metre_results(tmp_path):
    pts = add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02), (1.0, 1.0), 0.3, -0.010)
    write_binary_ply(pts, tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert stats["cells_alt_path"] == "cells_alt.json"
    alt = json.loads((tmp_path / "out" / "cells_alt.json").read_text(encoding="utf-8"))
    assert sorted(alt["by_size"]) == ["1.0", "2.0"]
    for size in (1.0, 2.0):  # 각 크기 결과는 그 크기로 따로 돌린 공식 cells.json 과 같다
        analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / f"o{size}", cell_m=size)
        solo = json.loads((tmp_path / f"o{size}" / "cells.json").read_text(encoding="utf-8"))
        assert alt["by_size"][str(size)] == solo


# 정밀 편차맵 화면 렌더용 5cm 잔차 격자(스펙 2·3 §2)
def test_residual_grid_shape_units_and_row_direction(tmp_path):
    # 3x2m 바닥, (0.5, 1.5)에 10mm 함몰: 행 0 이 y 최소이므로 최솟값은 행 ~30, 열 ~10 에 있다
    pts = add_bump(flat_floor(size=(3.0, 2.0), spacing=0.02), (0.5, 1.5), 0.3, -0.010)
    write_binary_ply(pts, tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert stats["residual_grid_path"] == "residual_grid.json"
    g = json.loads((tmp_path / "out" / "residual_grid.json").read_text(encoding="utf-8"))
    assert g["subcell_m"] == 0.05
    assert g["cols"] > g["rows"] and len(g["values"]) == g["cols"] * g["rows"]
    vals = [v for v in g["values"] if v is not None]
    assert all(isinstance(v, int) for v in vals)          # 0.1mm 정수
    k = min(range(len(g["values"])), key=lambda i: g["values"][i] if g["values"][i] is not None else 0)
    assert -110 <= g["values"][k] <= -80                    # 함몰 약 10mm = -100 (0.1mm 단위)
    assert abs(k // g["cols"] - 30) <= 1 and abs(k % g["cols"] - 10) <= 1


def test_residual_grid_marks_missing_as_null(tmp_path):
    # 가운데가 빈 바닥: 빈 칸은 null 로 남는다
    pts = flat_floor(size=(3.0, 2.0), spacing=0.02)
    hole = (np.abs(pts[:, 0] - 1.5) < 0.3) & (np.abs(pts[:, 1] - 1.0) < 0.3)
    write_binary_ply(pts[~hole], tmp_path / "scan.ply")
    analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    g = json.loads((tmp_path / "out" / "residual_grid.json").read_text(encoding="utf-8"))
    assert g["values"][20 * g["cols"] + 30] is None


def _board_with_stray(stray_size):
    # 0.6x0.6m 판(PLY 로 읽으면 5cm 서브셀 168칸) + x 1.5m 부터 떨어진 작은 파편. 같은 높이라 레벨은 하나다
    board = flat_floor(size=(0.6, 0.6), spacing=0.005)
    stray = flat_floor(size=stray_size, spacing=0.005) + np.array([1.5, 0.0, 0.0])
    return np.vstack([board, stray])


def test_small_specimen_threshold_sits_between_70_and_85_percent(tmp_path):
    # 가장 큰 덩어리 비율(PLY float32 경로 실측): 파편 0.4x0.4 -> 168/240 = 70%(실패),
    # 0.2x0.25 -> 168/197 = 85.3%(성공). 기준 80% 가 이 사이에 있어야 한다
    write_binary_ply(_board_with_stray((0.4, 0.4)), tmp_path / "a.ply")
    with pytest.raises(ValueError, match="판정 가능한 바닥 구역 없음"):
        analyze_floor(tmp_path / "a.ply", 1.0, CRIT, 5.0, tmp_path / "oa")
    write_binary_ply(_board_with_stray((0.2, 0.25)), tmp_path / "b.ply")
    stats = analyze_floor(tmp_path / "b.ply", 1.0, CRIT, 5.0, tmp_path / "ob")
    assert "small_specimen" in stats["warnings"]


def test_small_specimen_prunes_stray_fragment_from_outputs(tmp_path):
    # 파편(x 1.5~1.7, y 0~0.25)은 구역이 아니다: 잔차 격자에 값이 없고, 그 자리 셀은 구역 없음(zone_id None)
    write_binary_ply(_board_with_stray((0.2, 0.25)), tmp_path / "b.ply")
    analyze_floor(tmp_path / "b.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    g = json.loads((tmp_path / "out" / "residual_grid.json").read_text(encoding="utf-8"))
    stray_vals = [g["values"][r * g["cols"] + c] for r in range(0, 5) for c in range(30, 34)]
    assert stray_vals == [None] * len(stray_vals)
    board_vals = [g["values"][r * g["cols"] + c] for r in range(0, 12) for c in range(0, 12)]
    assert all(v is not None for v in board_vals)            # 판 자체는 값이 있다(파편만 지웠다)
    rows = json.loads((tmp_path / "out" / "cells.json").read_text(encoding="utf-8"))
    stray_cell = next(r for r in rows if r["ix"] == 3 and r["iy"] == 0)   # x 1.5~2.0m 칸
    assert stray_cell["zone_id"] is None and stray_cell["value_mm"] is None


# 바닥 기준면 개선(2026-10-20 스펙 §3): 편차 표시는 국부(1m, 스펙 §8) 기준이 기본, 전체 기준을 함께 낸다. 판정은 그대로
def _sag_floor(depth=0.010, size=8.0):
    p = flat_floor(size=(size, size), spacing=0.025, noise_sd=0.0005, seed=2)
    h = size / 2
    p[:, 2] -= depth * (1 - ((p[:, 0] - h) / h) ** 2) * (1 - ((p[:, 1] - h) / h) ** 2)
    return p


def test_residual_grid_v2_has_local_and_global_values(tmp_path):
    write_binary_ply(_sag_floor(), tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    g = json.loads((tmp_path / "out" / stats["residual_grid_path"]).read_text(encoding="utf-8"))
    assert g["schema_version"] == 2
    local = np.array([v for v in g["values"] if v is not None])
    glob = np.array([v for v in g["values_global"] if v is not None])
    assert len(g["values_global"]) == len(g["values"]) == g["cols"] * g["rows"]
    assert np.abs(local).max() <= 25            # 국부: 처짐이 빠져 ±2.5mm 안(0.1mm 단위)
    assert glob.max() - glob.min() >= 60         # 전체: 10mm 처짐이 그대로 보인다


def test_points3d_and_deviation_png_use_local_reference(tmp_path, monkeypatch):
    seen = {}
    real = pl.render_deviation_map
    monkeypatch.setattr(pl, "render_deviation_map",
                        lambda res, grid, path: (seen.setdefault("dev", res), real(res, grid, path))[1])
    write_binary_ply(_sag_floor(), tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert np.nanmax(np.abs(seen["dev"])) < 0.0025   # 국부 기준 잔차가 편차맵 PNG 로 간다
    _, _, dev_q = read_points3d((tmp_path / "out" / stats["points3d_paths"][0]).read_bytes())
    has = dev_q > -32767
    assert np.abs(dev_q[has]).max() <= 25            # 3D 점 편차도 국부 기준(구역 평면이면 ±60 안팎)


def test_reference_surfaces_file_shape_and_frame(tmp_path):
    # 4x3m 바닥, x 방향 1% 경사: 전체 기준면 마디 높이 = 0.01 x 마디 x (bbox 최저 z 기준, 0.1mm 정수)
    write_binary_ply(flat_floor(size=(4.0, 3.0), spacing=0.02, tilt=(0.01, 0.0)), tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert stats["reference_surfaces_path"] == "reference_surfaces.json"
    s = json.loads((tmp_path / "out" / "reference_surfaces.json").read_text(encoding="utf-8"))
    assert s["step_m"] == 0.25
    assert len(s["local"]) == len(s["global"]) == s["cols"] * s["rows"]
    assert s["cols"] >= 16 and s["rows"] >= 12
    for j in (1, 6, 10):
        for i in (1, 8, 14):
            x = (i + 0.5) * 0.25
            for key in ("local", "global"):
                v = s[key][j * s["cols"] + i]
                assert v is not None and abs(v - 0.01 * x * 10000) <= 5, (key, i, j, v)


def test_reference_surfaces_null_off_floor(tmp_path):
    # 가운데가 빈 바닥: 빈 자리 마디는 null
    pts = flat_floor(size=(4.0, 3.0), spacing=0.02)
    hole = (np.abs(pts[:, 0] - 2.0) < 0.6) & (np.abs(pts[:, 1] - 1.5) < 0.6)
    write_binary_ply(pts[~hole], tmp_path / "scan.ply")
    analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    s = json.loads((tmp_path / "out" / "reference_surfaces.json").read_text(encoding="utf-8"))
    j, i = int(1.5 / 0.25), int(2.0 / 0.25)
    assert s["local"][j * s["cols"] + i] is None and s["global"][j * s["cols"] + i] is None


def test_reference_node_at_hole_edge_uses_floor_cells_of_its_block(tmp_path):
    # 구멍 가장자리 마디: 묶음 가운데 칸은 구멍 안이지만 묶음에 바닥 칸이 있으면 그 칸들의 평균으로 채운다(구멍 둘레가 비지 않게).
    # 구멍 |x−2| < 0.64: 마디 i=5 의 묶음(x 1.25~1.5)은 가운데 칸(x 1.375)이 구멍 안, 앞 두 칸(x 1.275·1.325)은 바닥
    pts = flat_floor(size=(4.0, 3.0), spacing=0.02, tilt=(0.01, 0.0))
    hole = (np.abs(pts[:, 0] - 2.0) < 0.64) & (np.abs(pts[:, 1] - 1.5) < 0.6)
    write_binary_ply(pts[~hole], tmp_path / "scan.ply")
    analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    s = json.loads((tmp_path / "out" / "reference_surfaces.json").read_text(encoding="utf-8"))
    v = s["global"][6 * s["cols"] + 5]
    assert v is not None and abs(v - 0.01 * 1.3 * 10000) <= 10


def test_reference_surfaces_carry_absolute_origin(tmp_path):
    # 3D 뷰어가 기준면을 점 좌표틀에 놓으려면 기준면 원점의 절대 좌표가 필요하다(points3d 의 origin_m 과 빼서 맞춘다)
    pts = flat_floor(size=(2.0, 1.5), spacing=0.02) + np.array([100.0, 200.0, 3.0])
    write_binary_ply(pts, tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    s = json.loads((tmp_path / "out" / "reference_surfaces.json").read_text(encoding="utf-8"))
    assert np.allclose(s["origin_m"], stats["meta"]["bbox_min"], atol=1e-3)


def test_reference_failure_does_not_block_judgment(tmp_path, monkeypatch):
    # 리뷰(2026-10-20): 표시 전용 기준면 계산이 판정보다 앞에서 보호 없이 돌았다. 실패(메모리·맞춤 실패)해도 판정은 저장되고,
    # 편차 표시는 구역 평면 기준(옛 형식 v1 격자)으로 내리며, 기준면 파일은 내지 않고 경고를 남긴다
    def boom(*a, **k):
        raise MemoryError("test")
    monkeypatch.setattr(pl, "local_reference", boom)
    write_binary_ply(add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02), (2.0, 1.5), 0.3, -0.010), tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert "reference_surfaces_failed" in stats["warnings"]
    assert stats["n_valid"] > 0 and "reference_surfaces_path" not in stats
    assert not (tmp_path / "out" / "reference_surfaces.json").exists()
    g = json.loads((tmp_path / "out" / stats["residual_grid_path"]).read_text(encoding="utf-8"))
    assert "values_global" not in g and "schema_version" not in g
    assert min(v for v in g["values"] if v is not None) <= -80       # 구역 평면 기준 편차(함몰 10mm)
    assert stats["points3d_paths"] == ["points3d.bin"]


def test_reference_nodes_carry_zone_ids(tmp_path):
    # 3D 기준면 그물이 단차를 잇는 벽처럼 그려지지 않게 마디마다 구역 번호를 싣는다(서로 다른 구역 마디 사이 칸은 건너뛴다)
    a = flat_floor(size=(3.98, 3.0), spacing=0.02)
    b = flat_floor(size=(4.0, 3.0), spacing=0.02) + np.array([4.02, 0.0, -0.15])
    write_binary_ply(np.vstack([a, b]), tmp_path / "scan.ply")
    analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    s = json.loads((tmp_path / "out" / "reference_surfaces.json").read_text(encoding="utf-8"))
    assert len(s["zones"]) == s["cols"] * s["rows"]
    j = 6
    left, right = s["zones"][j * s["cols"] + 2], s["zones"][j * s["cols"] + 25]
    assert left is not None and right is not None and left != right


def test_deep_gentle_depression_worst_is_not_capped_at_5cm(tmp_path):
    # 재검토 실측: 깊이 80mm·반경 0.9m 접시형 함몰이 제 구역으로 떨어져 worst 가 80.4 -> 49.9mm 로 잘렸다
    p = add_bump(flat_floor(size=(8.0, 8.0), spacing=0.025, seed=1), (4.0, 4.0), 0.9, -0.08)
    write_binary_ply(p, tmp_path / "scan.ply")
    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")
    assert stats["worst"]["value_mm"] >= 70.0

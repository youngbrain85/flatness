"""자산 복사·히스토그램 생성 — 발행본이 원본과 무관하게 재현되려면 참조 이미지가
reports/{id}/assets/ 아래로 복사돼야 한다(스펙 §6.1 reports)."""
import json

from flatworker.config import Config
from flatworker.report.assets import build_assets, deviation_label, render_histogram
from flatworker.report.context import load_report_context
from flatworker.report.snapshot import build_snapshot
from flatworker.storage import LocalStorage
from tests.fake_db import FakeDB
from tests.test_report_snapshot import _cells, _seed, _seed_slope


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _storage(tmp_path):
    return LocalStorage(tmp_path / "data")


def _write_artifacts(cfg, names):
    d = cfg.data_dir / "artifacts" / "an1"
    d.mkdir(parents=True, exist_ok=True)
    for name in names:
        (d / name).write_bytes(b"\x89PNG-fake")


def test_build_assets_copies_floor_heatmap_preview_and_photo(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _write_artifacts(cfg, ["heatmap.png", "preview3d.png"])
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")

    assets = build_assets(db, storage, "r1", ctx)

    a = assets["analyses"]["an1"]
    assert a["heatmaps"] == [{"label": "판정 히트맵",
                              "path": "reports/r1/assets/an1/heatmap.png"}]
    assert a["preview3d"][0]["path"] == "reports/r1/assets/an1/preview3d.png"
    assert a["histogram"] == "reports/r1/assets/an1/histogram.png"
    assert assets["photos"][0]["path"] == "reports/r1/assets/photos/p1.jpg"
    # 실제 파일이 존재해야 한다(경로 문자열만 만들고 끝나면 PDF가 깨진다)
    for rel in [a["heatmaps"][0]["path"], a["preview3d"][0]["path"], a["histogram"],
                assets["photos"][0]["path"]]:
        assert (cfg.data_dir / rel).exists(), rel
    assert assets["notes"] == []


def test_build_assets_skips_missing_wall_heatmap_with_note(tmp_path):
    """벽 히트맵은 결번이 존재한다(stats-schema.md §6) — 파일 존재를 가정하지 않고
    없으면 건너뛰되 notes에 남겨 보고서에서 누락 사실을 알 수 있게 한다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    stats = db.analyses["an1"]["stats"]
    stats["meta"]["surface"] = "wall"
    stats["zones"] = []
    stats["preview3d_paths"] = []
    stats["walls"] = [
        {"wall_id": 1, "n_cells": 2, "height_m": 2.4, "length_m": 5.0,
         "plumbness_mm": 12.0, "plumb_grade": "pass", "plane_abc": [0, 0, 0], "frame": {}},
        {"wall_id": 3, "n_cells": 2, "height_m": 2.4, "length_m": 4.0,
         "plumbness_mm": 9.0, "plumb_grade": "pass", "plane_abc": [0, 0, 0], "frame": {}},
    ]
    db.scans["scan1"]["surface"] = "wall"
    _write_artifacts(cfg, ["heatmap_wall1.png"])   # wall 3 히트맵은 없음
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")

    assets = build_assets(db, storage, "r1", ctx)

    labels = [h["label"] for h in assets["analyses"]["an1"]["heatmaps"]]
    assert labels == ["벽 1 판정 히트맵"]
    assert any("벽 3" in n for n in assets["notes"])


def test_build_assets_records_note_when_photo_download_fails(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _write_artifacts(cfg, ["heatmap.png", "preview3d.png"])
    del db.photo_blobs["photos/p1.jpg"]     # Storage에서 사라진 상황 모사
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")

    assets = build_assets(db, storage, "r1", ctx)

    assert assets["photos"] == []
    assert any("사진" in n for n in assets["notes"])


def test_build_assets_clears_stale_files_on_regeneration(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _write_artifacts(cfg, ["heatmap.png", "preview3d.png"])
    stale = cfg.data_dir / "reports" / "r1" / "assets" / "an1" / "heatmap_wall9.png"
    stale.parent.mkdir(parents=True, exist_ok=True)
    stale.write_bytes(b"stale")
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")

    build_assets(db, storage, "r1", ctx)

    assert not stale.exists()


def test_render_histogram_creates_png(tmp_path):
    out = tmp_path / "histogram.png"
    render_histogram([1.0, 2.5, 3.0, 7.5, -2.0],
                     {"pass_mm": 7, "rework_mm": 21}, out)
    assert out.exists() and out.stat().st_size > 0


def test_build_assets_notes_when_no_valid_cells(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _write_artifacts(cfg, ["heatmap.png", "preview3d.png"])
    na_cells = [dict(c, value_mm=None, grade="na") for c in _cells()]
    (cfg.data_dir / "artifacts" / "an1" / "cells.json").write_text(
        json.dumps(na_cells), encoding="utf-8")
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")

    assets = build_assets(db, storage, "r1", ctx)

    assert assets["analyses"]["an1"]["histogram"] is None
    assert any("히스토그램" in n for n in assets["notes"])


def test_deviation_label_distinguishes_floor_and_wall():
    assert deviation_label("deviation.png") == "정밀 편차맵(10cm)"
    assert deviation_label("deviation_wall3.png") == "벽 3 정밀 편차맵(10cm)"


def test_build_assets_copies_deviation_maps(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    db.analyses["an1"]["stats"]["deviation_paths"] = ["deviation.png"]
    _write_artifacts(cfg, ["heatmap.png", "preview3d.png", "deviation.png"])
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")

    assets = build_assets(db, storage, "r1", ctx)

    assert assets["analyses"]["an1"]["deviation"] == [
        {"label": "정밀 편차맵(10cm)", "path": "reports/r1/assets/an1/deviation.png"}]
    assert (cfg.data_dir / "reports/r1/assets/an1/deviation.png").exists()
    assert assets["notes"] == []


def test_slope_map_png_is_copied_into_report_assets(tmp_path):
    """과업지시서 11·12쪽이 PNG(시각자료)를 요구한다. 발행본에 박제돼야 원본
    분석이 지워져도 PDF가 재현된다(스펙 §6.1)."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _seed_slope(db, cfg)
    _write_artifacts(cfg, ["heatmap.png", "preview3d.png"])
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")

    assets = build_assets(db, storage, "r1", ctx)

    slope_assets = assets["analyses"]["an2"]
    assert slope_assets["slope_map"] == "reports/r1/assets/an2/slope_map.png"
    # 경로 문자열만 만들고 실제 파일이 없으면 PDF가 깨진다
    copied = cfg.data_dir / "reports/r1/assets/an2/slope_map.png"
    assert copied.exists() and copied.read_bytes() == b"\x89PNG-slope"
    # 스냅샷이 그 복사본 경로를 그대로 싣는다(렌더러가 읽는 유일한 통로)
    snap = build_snapshot(ctx, assets)
    assert snap["analyses"][1]["slope"]["map_png"] == "reports/r1/assets/an2/slope_map.png"
    # 구배에 없는 평활도 전용 자산을 "없어서 제외했다"고 안내하면 거짓 경보다
    assert assets["notes"] == []
    assert slope_assets["heatmaps"] == [] and slope_assets["histogram"] is None


def test_build_assets_notes_missing_slope_map(tmp_path):
    """구배 지도 파일이 없으면 조용히 빠뜨리지 않고 notes에 남긴다
    (평활도 히트맵 결번 처리와 같은 관례)."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _seed_slope(db, cfg)
    _write_artifacts(cfg, ["heatmap.png", "preview3d.png"])
    (cfg.data_dir / "artifacts" / "an2" / "slope_map.png").unlink()
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")

    assets = build_assets(db, storage, "r1", ctx)

    assert assets["analyses"]["an2"]["slope_map"] is None
    assert any("slope_map.png" in n for n in assets["notes"])
    snap = build_snapshot(ctx, assets)
    assert snap["analyses"][1]["slope"]["map_png"] is None


def test_build_assets_skips_missing_deviation_with_note(tmp_path):
    """벽 편차맵은 히트맵과 같은 결번 규약이다 - 파일 존재를 가정하지 않는다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    stats = db.analyses["an1"]["stats"]
    stats["meta"]["surface"] = "wall"
    stats["zones"] = []
    stats["preview3d_paths"] = []
    stats["walls"] = [{"wall_id": 1, "n_cells": 2, "height_m": 2.4, "length_m": 5.0,
                       "plumbness_mm": 12.0, "plumb_grade": "pass",
                       "plane_abc": [0, 0, 0], "frame": {}}]
    stats["deviation_paths"] = ["deviation_wall1.png", "deviation_wall3.png"]
    db.scans["scan1"]["surface"] = "wall"
    _write_artifacts(cfg, ["heatmap_wall1.png", "deviation_wall1.png"])  # wall3 편차맵 없음
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")

    assets = build_assets(db, storage, "r1", ctx)

    labels = [d["label"] for d in assets["analyses"]["an1"]["deviation"]]
    assert labels == ["벽 1 정밀 편차맵(10cm)"]
    assert any("deviation_wall3.png" in n for n in assets["notes"])

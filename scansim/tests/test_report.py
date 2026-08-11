# -*- coding: utf-8 -*-
"""Task 8: CLI + 평가 PDF 테스트.

계획 문서 docs/superpowers/plans/2026-08-10-scan-coverage.md Task 8:
(a) FakeRenderer 로 build 전체 파이프라인 (CLI 경유 — CLI 인자 파싱까지 덮는다)
(b) HTML 에 두 모드·트레이드오프·한계가 실린다
(c) 산출 파일 전 형식(CSV·JSON·PNG·GIF·PDF) 존재
(d) 가구 유/무 2시나리오 수치가 서로 다르고 둘 다 실린다
추가:
(e) HTML 이 참조하는 자산 파일이 실제로 존재한다 (bim/tests/test_report.py 관례
    — 깨진 참조는 PDF 에서 빈칸이 된다)
(f) --mode 필터: mobile 만 요청하면 tls 산출물이 없다

렌더러는 주입한다 — Chromium 은 무거운 외부 의존이라 여기 묶이면 안 된다
(bim/tests/test_report.py 와 같은 방침).
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest  # noqa: E402

pytest.importorskip("jinja2")
pytest.importorskip("matplotlib")

from scansim import cli  # noqa: E402

# ── 합성 세대 — 실제 플래너·시뮬·렌더 전 파이프라인이 수 초 안에 돌게 작게 ──
# 실 outline: [외곽링, 구멍링...] — 닫는 점 없음 (lh26_dump.json 계약과 동일)
ROOM = [[[0, 0], [4000, 0], [4000, 3000], [0, 3000]]]
DUMP = {
    "drawing": {"title": "합성 시험 세대", "doc_no": "T-8", "issuer": "test",
                "system": "synthetic", "doc_key": "synthetic-4x3"},
    "spaces": [
        {"name": "방", "outline": ROOM, "area_m2": 12.0},
        # 통행 대상이 아닌 실 — 자유공간에서 빠져야 한다 (bim NON_TRAVERSABLE 기준)
        {"name": "PD", "outline": [[[4000, 0], [4400, 0], [4400, 600], [4000, 600]]],
         "area_m2": 0.24},
    ],
}
# 방 중앙을 막는 가구 1개 — 유/무 시나리오의 경로·커버리지가 달라진다
FURNITURE = {
    "page_index": 0,
    "furniture": [
        {"name": "시험 박스", "room": "방", "source": "synthetic",
         "rings": [[[1600, 1200], [2400, 1200], [2400, 1800], [1600, 1800]]]},
    ],
    "missing": [
        {"name": "신발장", "reason": "선 색이 달라 이 방법으로 못 뽑는다",
         "approx_bbox_mm": [0, 0, 100, 100]},
    ],
}
# 프레임 수를 줄이는 시험 설정 — 기본값 검증이 아니라 파이프라인 검증이 목적
FAST_CFG = {"mobile_speed_mms": 500.0, "mobile_range_mm": 2000.0,
            "tls_range_mm": 3000.0, "tls_dwell_s": 1.0}

MODE_KEYS_BOTH = ["mobile_furn", "tls_furn", "mobile_nofurn", "tls_nofurn"]


class FakeRenderer:
    """HTML 을 받아 두기만 한다. PDF 바이트를 만들지 않으므로 브라우저가 필요 없다."""

    def __init__(self):
        self.html = None
        self.out_path = None

    def render_pdf(self, html, base_dir, out_path):
        self.html = html
        self.out_path = Path(out_path)
        self.out_path.write_bytes(b"%PDF-1.4 fake")


def _write_inputs(root: Path):
    dump = root / "dump.json"
    dump.write_text(json.dumps(DUMP, ensure_ascii=False), encoding="utf-8")
    furn = root / "furniture.json"
    furn.write_text(json.dumps(FURNITURE, ensure_ascii=False), encoding="utf-8")
    cfg = root / "config.json"
    cfg.write_text(json.dumps(FAST_CFG), encoding="utf-8")
    return dump, furn, cfg


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    """CLI 경유 전체 파이프라인 1회 실행 (모듈 캐시 — 시뮬레이션이 수 초 걸린다)."""
    root = tmp_path_factory.mktemp("scan_report")
    dump, furn, cfg = _write_inputs(root)
    out = root / "rpt"
    fake = FakeRenderer()
    rc = cli.main(["--dump", str(dump), "--out", str(out), "--mode", "both",
                   "--furniture", str(furn), "--config", str(cfg)],
                  renderer=fake)
    return {"rc": rc, "out": out, "html": fake.html}


# ── (a) 전체 파이프라인 + (c) 전 형식 산출물 ────────────────


def test_CLI_가_성공하고_PDF_를_만든다(built):
    assert built["rc"] == 0
    assert (built["out"] / "scan_report.pdf").exists()


def test_전_형식_산출물이_생성된다(built):
    out = built["out"]
    for key in MODE_KEYS_BOTH:
        assert (out / f"{key}_coverage.csv").exists(), f"{key} CSV 없음"
        assert (out / f"{key}_state.json").exists(), f"{key} 상태 스트림 없음"
        assert (out / f"{key}_plan.json").exists(), f"{key} 계획 JSON 없음"
        assert (out / "assets" / f"{key}_final.png").exists(), f"{key} 최종 지도 없음"
        assert (out / "assets" / f"{key}_plan.png").exists(), f"{key} 계획 지도 없음"
    # GIF·프레임 PNG 는 주 시나리오(가구 배치)에서 나온다
    for key in ("mobile_furn", "tls_furn"):
        assert (out / "assets" / f"{key}.gif").exists(), f"{key} GIF 없음"
        frames = list((out / "assets" / f"{key}_frames").glob("frame_*.png"))
        assert frames, f"{key} 프레임 PNG 없음"


# ── (b) HTML 내용 ───────────────────────────────────────────


def test_HTML_에_두_모드와_트레이드오프와_한계가_실린다(built):
    html = built["html"]
    assert "모바일" in html and "TLS" in html
    assert "트레이드오프" in html
    assert "한계" in html
    assert "가정" in html, "장비 파라미터가 가정값임을 명시해야 한다 (스펙 §9-1)"
    assert "ln n" in html, "greedy set cover 근사비 명시가 없다 (스펙 §9-3)"
    assert "계획 커버리지" in html, "플래너 notes(정직 보고)가 실리지 않았다"


def test_HTML_이_참조하는_자산이_실제로_존재한다(built):
    refs = set(re.findall(r'assets/[\w.\-]+', built["html"]))
    assert refs, "HTML 이 자산을 하나도 참조하지 않는다"
    for ref in refs:
        assert (built["out"] / ref).exists(), f"{ref} 를 참조하지만 파일이 없다"


# ── (d) 가구 유/무 2시나리오 ────────────────────────────────


def test_가구_유무_시나리오_수치가_다르고_둘다_실린다(built):
    out = built["out"]
    furn = json.loads((out / "mobile_furn_plan.json").read_text(encoding="utf-8"))
    nofurn = json.loads((out / "mobile_nofurn_plan.json").read_text(encoding="utf-8"))
    assert furn["path_len_mm"] != nofurn["path_len_mm"], (
        "가구 장애물을 넣었는데 모바일 경로 길이가 그대로다")
    # 두 시나리오 수치가 모두 보고서에 실린다 (병기 — 스펙 §9-5)
    for plan in (furn, nofurn):
        assert f"{plan['path_len_mm'] / 1000:.2f}" in built["html"]
    assert "가구 배치" in built["html"] and "가구 미배치" in built["html"]


def test_미추출_가구가_한계에_실린다(built):
    """추출 실패 가구는 지어내지 않고 누락으로 보고한다 (스펙 §9-2)."""
    assert "신발장" in built["html"]


# ── (f) --mode 필터 ─────────────────────────────────────────


def test_mode_필터가_tls_산출물을_만들지_않는다(tmp_path):
    dump, furn, cfg = _write_inputs(tmp_path)
    out = tmp_path / "rpt_mobile"
    fake = FakeRenderer()
    rc = cli.main(["--dump", str(dump), "--out", str(out), "--mode", "mobile",
                   "--furniture", str(furn), "--config", str(cfg)],
                  renderer=fake)
    assert rc == 0
    assert (out / "mobile_furn_coverage.csv").exists()
    assert not list(out.glob("tls_*")), "mobile 모드인데 tls 산출물이 있다"
    assert (out / "scan_report.pdf").exists()

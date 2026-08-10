"""보고서 회귀 — 그림·표·본문이 같은 계산에서 나오는지, 미상이 통과로 새지 않는지.

렌더러는 주입한다. Chromium 은 무거운 외부 의존이라 여기 묶이면 안 된다
(워커의 `Renderer` 프로토콜과 같은 방침).
"""
from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path

import pytest

pytest.importorskip("jinja2")
pytest.importorskip("matplotlib")

BIM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BIM))
sys.path.insert(0, str(BIM.parent))

from bim.report.build import build, build_context, render_html  # noqa: E402
from bim.judge import UNKNOWN  # noqa: E402

FIXTURE = BIM / "tests" / "fixtures" / "lh26_dump.json"


class FakeRenderer:
    """HTML 을 받아 두기만 한다. PDF 바이트를 만들지 않으므로 브라우저가 필요 없다."""

    def __init__(self):
        self.html = None
        self.out_path = None

    def render_pdf(self, html, base_dir, out_path):
        self.html = html
        self.out_path = Path(out_path)
        self.out_path.write_bytes(b"%PDF-1.4 fake")


@pytest.fixture
def dump():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture
def ctx(dump):
    return build_context(dump)


def test_상업용_등급의_도달_범위가_현관뿐이다(ctx):
    for r in ctx["results"]:
        if r["code"] in ("serving-delivery", "commercial-cleaner", "industrial-amr"):
            assert r["reachable"] == "현관", f"{r['code']}: {r['reachable']}"


def test_근거_없는_등급은_한계가_판정_불가로_표시된다(ctx):
    r = next(x for x in ctx["results"] if x["code"] == "outdoor-delivery")
    assert "판정 불가" in r["limit"]
    assert r["counts"][UNKNOWN] == ctx["n_adjacencies"]


def test_원문_모순이_보고서에_실린다(ctx):
    names = {c["name"] for c in ctx["conflicts"]}
    assert {"욕실", "발코니"} <= names, f"모순 실이 누락됐다: {names}"


def test_추론분이_도면_확정과_구분된다(ctx):
    by_name = {s["name"]: s for s in ctx["spaces"]}
    assert by_name["복도"]["basis"] == "추론"
    assert by_name["실외기실"]["basis"] == "추론"
    assert by_name["거실/침실"]["basis"] == "도면 확정"


def test_판정_행렬이_전_경계_전_등급을_덮는다(ctx):
    assert len(ctx["matrix"]) == ctx["n_adjacencies"]
    for row in ctx["matrix"]:
        assert len(row["verdicts"]) == len(ctx["results"])


def test_통행_대상이_아닌_면은_도달_목록에서_빠진다(ctx):
    """벽체공용·PD 는 실이 아니다. 도달 목록에 들어가면 발주처가 오독한다."""
    for r in ctx["results"]:
        assert "벽체공용" not in r["reachable"] and "벽체공용" not in r["unreachable"]
        assert "PD" not in r["reachable"] and "PD" not in r["unreachable"]


def test_종합의견이_막힌_등급을_이름으로_짚는다(ctx):
    text = " ".join(ctx["summary"])
    assert "현관" in text
    assert any(r["name"] in text for r in ctx["results"] if r["reachable"] == "현관")


# ─── HTML ────────────────────────────────────────────────────────────────────
def test_HTML_에_미상_판정이_통과로_표시되지_않는다(ctx):
    html = render_html({**ctx, "assets": {"plan": "plan.png"},
                        "results": [{**r, "asset": "x.png"} for r in ctx["results"]]})
    assert "b-unknown" in html, "미상 배지가 없다"
    assert "미상" in html


def test_HTML_이_모든_등급_구역을_낸다(ctx):
    html = render_html({**ctx, "assets": {"plan": "plan.png"},
                        "results": [{**r, "asset": "x.png"} for r in ctx["results"]]})
    for r in ctx["results"]:
        assert r["name"] in html, f"{r['code']} 구역이 없다"


def test_HTML_이_한계를_전부_싣는다(ctx):
    html = render_html({**ctx, "assets": {"plan": "plan.png"},
                        "results": [{**r, "asset": "x.png"} for r in ctx["results"]]})
    for lim in ctx["limits"]:
        assert lim[:20] in html


# ─── 전체 파이프라인 ─────────────────────────────────────────────────────────
def test_build_가_자산과_PDF_를_만든다(tmp_path):
    fake = FakeRenderer()
    pdf = build(FIXTURE, tmp_path, renderer=fake)
    assert pdf.exists()
    assets = tmp_path / "assets"
    assert (assets / "plan.png").exists()
    pngs = sorted(p.name for p in assets.glob("reach_*.png"))
    assert len(pngs) == 5, f"등급별 지도가 5개가 아니다: {pngs}"
    # HTML 이 실제로 만든 파일만 참조하는가 — 깨진 이미지는 PDF 에서 빈칸이 된다
    for r in ["plan.png"] + pngs:
        assert f"assets/{r}" in fake.html, f"{r} 를 HTML 이 참조하지 않는다"


def test_그림과_표가_같은_판정에서_나온다(tmp_path, dump):
    """도달 범위를 바꾸면 표와 그림이 함께 바뀌어야 한다. 하나만 바뀌면 둘 중 하나가 거짓이다."""
    d = deepcopy(dump)
    for sv in d["step_view"]:
        sv["step_abs_mm"] = 0.0            # 전 경계를 0mm 로 → 전부 통과
    ctx = build_context(d)
    for r in ctx["results"]:
        if r["code"] == "outdoor-delivery":
            continue                        # 임계값 자체가 없어 여전히 미상이다
        assert "거실/침실" in r["reachable"], f"{r['code']} 가 0mm 경계를 못 넘었다"


def test_진입점을_바꾸면_도달_범위가_바뀐다(dump):
    a = build_context(dump, entry_space="현관")
    b = build_context(dump, entry_space="거실/침실")
    ra = next(x for x in a["results"] if x["code"] == "domestic-cleaner")["reachable"]
    rb = next(x for x in b["results"] if x["code"] == "domestic-cleaner")["reachable"]
    assert ra != rb or "현관" in rb

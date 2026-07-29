"""snapshot -> HTML 렌더 — 스펙 §8의 5부 구성과 필수 문구를 검증한다."""
from flatworker.config import Config
from flatworker.report.assets import build_assets
from flatworker.report.context import load_report_context
from flatworker.report.html import asset_src, fmt_mm, render_html
from flatworker.report.snapshot import build_snapshot
from tests.fake_db import FakeDB
from tests.test_report_snapshot import _seed


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _snapshot(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    artifacts = cfg.data_dir / "artifacts" / "an1"
    for name in ("heatmap.png", "preview3d.png"):
        (artifacts / name).write_bytes(b"\x89PNG-fake")
    ctx = load_report_context(db, cfg, "r1")
    return build_snapshot(ctx, build_assets(db, cfg, "r1", ctx))


def test_fmt_mm_matches_dashboard_fmt():
    assert fmt_mm(None) == "-"
    assert fmt_mm(8.2) == "8.20"


def test_asset_src_strips_report_prefix():
    assert asset_src("reports/r1/assets/an1/heatmap.png", "r1") == "assets/an1/heatmap.png"
    assert asset_src("assets/an1/heatmap.png", "r1") == "assets/an1/heatmap.png"


def test_render_html_contains_five_parts(tmp_path):
    html = render_html(_snapshot(tmp_path))
    for heading in ("1. 기본 정보", "2. 분석 개요", "3. 구간별 결과",
                    "4. 시각자료", "5. 종합의견"):
        assert heading in html, heading


def test_render_html_includes_required_content(tmp_path):
    html = render_html(_snapshot(tmp_path))
    assert "대체하지 않습니다" in html                 # 스크리닝 한계 문구(필수)
    assert "측정 불확도" in html                       # 분석 개요 고지
    assert "3층 거실 평활도 보고서" in html            # 표지 제목
    assert "홍길동" in html and "iPhone 15 Pro" in html  # 담당자·장비
    assert "floor-kcs-exposed" in html                 # 적용 기준 명시
    assert "구역 1" in html                            # 구간별 결과표
    assert "8.20" in html                              # mm 필터 적용 수치
    assert "src=\"assets/an1/heatmap.png\"" in html     # 상대 경로 자산 참조
    assert "src=\"assets/an1/histogram.png\"" in html
    assert "src=\"assets/photos/p1.jpg\"" in html
    assert "#c5221f" in html                           # palette 색상 사용


def test_render_html_has_no_em_dash_and_escapes_title(tmp_path):
    snap = _snapshot(tmp_path)
    snap["report"]["title"] = "<script>alert(1)</script>"
    html = render_html(snap)
    assert "—" not in html            # 사용자 대면 문자열 U+2014 금지
    assert "<script>alert(1)</script>" not in html   # autoescape 동작 확인
    assert "&lt;script&gt;" in html

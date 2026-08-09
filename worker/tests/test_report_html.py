"""snapshot -> HTML 렌더 — 스펙 §8의 5부 구성과 필수 문구를 검증한다."""
from flatworker.config import Config
from flatworker.report.assets import build_assets
from flatworker.report.context import load_report_context
from flatworker.report.html import asset_src, fmt_mm, render_html, section_analyses
from flatworker.report.snapshot import build_snapshot
from flatworker.storage import LocalStorage
from tests.fake_db import FakeDB
from tests.test_report_snapshot import _seed, _seed_slope


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _storage(tmp_path):
    return LocalStorage(tmp_path / "data")


def _snapshot(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    artifacts = cfg.data_dir / "artifacts" / "an1"
    for name in ("heatmap.png", "preview3d.png"):
        (artifacts / name).write_bytes(b"\x89PNG-fake")
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")
    return build_snapshot(ctx, build_assets(db, storage, "r1", ctx))


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


def _snapshot_with_deviation(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    db.analyses["an1"]["stats"]["deviation_paths"] = ["deviation.png"]
    artifacts = cfg.data_dir / "artifacts" / "an1"
    for name in ("heatmap.png", "preview3d.png", "deviation.png"):
        (artifacts / name).write_bytes(b"\x89PNG-fake")
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")
    return build_snapshot(ctx, build_assets(db, storage, "r1", ctx))


def test_render_html_includes_deviation_figure(tmp_path):
    html = render_html(_snapshot_with_deviation(tmp_path))
    assert "src=\"assets/an1/deviation.png\"" in html
    assert "정밀 편차맵(10cm)" in html
    # 판정 무관 고지: 스펙이 요구한 문구 두 절을 모두 담아야 한다(대시보드 탭과 동일 취지).
    # 편차맵의 초록은 "침하", 판정 히트맵의 초록은 "적합"이라 색 의미가 반대다 - 등급 기준이
    # 1m 판정 셀임을 함께 알려야 오독을 막는다.
    assert "판정 등급 산출에는 사용되지 않으며" in html
    assert "1m 판정 셀" in html
    assert "—" not in html                                  # 사용자 대면 문자열 U+2014 금지


def test_slope_analysis_is_not_rendered_as_a_flatness_section(tmp_path):
    """구배 분석은 scans.surface가 'floor'라 걸러내지 않으면 '3.1 수평면(바닥)'에
    섞인다 - 구간·레벨·mm 편차가 전부 없어 머리글만 있는 빈 표가 박힌다.

    구배 장(Task 2)이 들어올 자리는 여기가 아니므로 이 목록에서 뺀다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    _seed_slope(db, cfg)
    artifacts = cfg.data_dir / "artifacts" / "an1"
    for name in ("heatmap.png", "preview3d.png"):
        (artifacts / name).write_bytes(b"\x89PNG-fake")
    storage = _storage(tmp_path)
    ctx = load_report_context(db, storage, "r1")
    snap = build_snapshot(ctx, build_assets(db, storage, "r1", ctx))

    assert len(snap["analyses"]) == 2, "픽스처 확인: 평활도 + 구배 두 건이어야 한다"
    assert [a["analysis_id"] for a in section_analyses(snap["analyses"], "floor")] == ["an1"]
    assert section_analyses(snap["analyses"], "wall") == []

    html = render_html(snap)
    body = html[html.index("3. 구간별 결과"):html.index("4. 시각자료")]
    assert "slope-parking-ramp" not in body     # 구배 기준이 평활도 구간표에 새면 안 된다
    assert "구역 1" in body                      # 평활도 구간표는 그대로다
    # 표지 측정 개요에는 실리되 평활도와 문구로 구별된다(둘 다 같은 바닥 스캔이다)
    assert "slope-parking-ramp" in html and "바닥 구배" in html


def test_render_html_tolerates_snapshot_without_deviation_key(tmp_path):
    """이미 발행된 보고서의 snapshot에는 assets.deviation 키가 없다 - 템플릿이 견뎌야 한다."""
    snap = _snapshot(tmp_path)
    for a in snap["analyses"]:
        a["assets"].pop("deviation", None)

    html = render_html(snap)

    assert "4. 시각자료" in html
    assert "src=\"assets/an1/heatmap.png\"" in html

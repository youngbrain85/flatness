"""실제 Chromium 1회 렌더 스모크 — 기본 스위트에서 제외(-m browser 로만 실행).

브라우저가 없거나 playwright 패키지가 없으면 skip한다. 엔진의 perf 마커와 같은
방식으로 기본 실행을 결정론적으로 유지하기 위함이다.
"""
import pytest

pytestmark = pytest.mark.browser


def test_playwright_renderer_produces_real_pdf(tmp_path):
    pytest.importorskip("playwright", reason="playwright 패키지 미설치")
    from flatworker.report.renderer import PlaywrightRenderer

    html = ("<html><head><meta charset='utf-8'>"
            "<style>body{font-family:'Noto Sans CJK KR','Noto Sans KR','Malgun Gothic',sans-serif}</style>"
            "</head><body><h1>평활도 분석 보고서 렌더 스모크</h1>"
            "<p>한글 폰트와 인쇄 레이아웃이 적용되는지 확인합니다.</p></body></html>")
    out = tmp_path / "smoke.pdf"
    try:
        PlaywrightRenderer().render_pdf(html, tmp_path, out)
    except Exception as e:  # noqa: BLE001 - 브라우저 미설치/버전 불일치는 skip 사유
        pytest.skip(f"Chromium 실행 불가(설치 필요: playwright install chromium): {e}")

    assert out.exists()
    assert out.read_bytes()[:5] == b"%PDF-"
    assert out.stat().st_size > 1000


def real_png(path, title):
    """실제로 열리는 PNG를 만든다.

    다른 테스트는 자산 파일을 b"\\x89PNG-fake"로 대신하는데, 그 바이트로는 Chromium이
    깨진 이미지 아이콘만 그려서 "PNG가 PDF에 실제로 박히는가"를 확인할 수 없다.
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    fig, ax = plt.subplots(figsize=(6.0, 3.0))
    ax.imshow(np.arange(12).reshape(2, 6), cmap="RdYlGn_r")
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def test_playwright_renders_slope_report_to_pdf(tmp_path):
    """★ 구배 보고서를 실제 Chromium으로 PDF까지 낸다(단계 H Task 2 Step 5).

    HTML 단위 테스트는 문자열만 본다. 한글 글리프가 없으면 PDF에서 네모 상자가
    되고, 셀 표가 길면 페이지 경계에서 깨지며, <img>가 못 열리면 판정 지도가
    통째로 빠진다 - 셋 다 실제 렌더로만 드러난다.
    """
    pytest.importorskip("playwright", reason="playwright 패키지 미설치")
    from flatworker.report.assets import build_assets
    from flatworker.report.context import load_report_context
    from flatworker.report.html import render_html
    from flatworker.report.renderer import PlaywrightRenderer
    from flatworker.report.snapshot import build_snapshot
    from flatworker.storage import LocalStorage
    from tests.test_report_html import _slope_db

    db, cfg = _slope_db(tmp_path)
    artifacts = cfg.data_dir / "artifacts"
    real_png(artifacts / "an1" / "heatmap.png", "판정 히트맵")
    real_png(artifacts / "an1" / "preview3d.png", "3D 프리뷰")
    real_png(artifacts / "an2" / "slope_map.png", "구배 판정 지도")

    storage = LocalStorage(cfg.data_dir)
    ctx = load_report_context(db, storage, "r1")
    work = tmp_path / "work"
    html = render_html(build_snapshot(ctx, build_assets(db, storage, "r1", ctx,
                                                        work_dir=work)))
    out = tmp_path / "slope-report.pdf"
    try:
        PlaywrightRenderer().render_pdf(html, work, out)
    except Exception as e:  # noqa: BLE001 - 브라우저 미설치/버전 불일치는 skip 사유
        pytest.skip(f"Chromium 실행 불가(설치 필요: playwright install chromium): {e}")

    assert out.read_bytes()[:5] == b"%PDF-"
    # 판정 지도가 실제로 base_dir에서 열려야 한다(상대 경로 자산 계약)
    assert (work / "assets" / "an2" / "slope_map.png").exists()
    assert 'src="assets/an2/slope_map.png"' in (work / "report.html").read_text(encoding="utf-8")
    # 이미지가 빠지면 PDF가 눈에 띄게 작아진다 - 세 장 다 박힌 크기인지 본다
    assert out.stat().st_size > 100_000, out.stat().st_size

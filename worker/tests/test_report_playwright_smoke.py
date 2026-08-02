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

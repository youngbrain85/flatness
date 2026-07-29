"""PDF 렌더러 — 주입 가능한 인터페이스(테스트는 FakeRenderer, 운영은 Chromium).

Playwright는 브라우저 바이너리라는 무거운 외부 의존이라, 워커 로직 테스트가 여기에
묶이지 않도록 메서드 하나짜리 프로토콜로 분리한다(스펙 §8: Jinja2 HTML ->
Playwright Chromium -> PDF).
"""
from pathlib import Path
from typing import Protocol


class Renderer(Protocol):
    def render_pdf(self, html, base_dir, out_path):
        """html을 base_dir 기준으로 렌더해 out_path에 PDF를 쓴다.

        base_dir 기준인 이유: HTML이 자산을 'assets/...' 상대 경로로 참조하므로
        문서를 base_dir 안에 두고 file:// 로 열어야 이미지가 로드된다(외부 네트워크
        요청 없음).
        """


class PlaywrightRenderer:
    """헤드리스 Chromium 렌더러.

    playwright 패키지는 이 클래스의 메서드 안에서 지연 import한다 — 패키지가 없는
    환경에서도 flatworker 전체 import가 깨지지 않게 하기 위함이다.
    """

    def __init__(self, html_filename="report.html"):
        self._html_filename = html_filename

    def render_pdf(self, html, base_dir, out_path):
        from playwright.sync_api import sync_playwright

        base_dir = Path(base_dir)
        base_dir.mkdir(parents=True, exist_ok=True)
        html_path = base_dir / self._html_filename
        html_path.write_text(html, encoding="utf-8")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page()
                page.goto(html_path.resolve().as_uri(), wait_until="load")
                page.emulate_media(media="print")
                page.pdf(
                    path=str(out_path),
                    format="A4",
                    print_background=True,
                    margin={"top": "14mm", "bottom": "16mm",
                            "left": "12mm", "right": "12mm"},
                    display_header_footer=True,
                    header_template="<div></div>",
                    # 머리말·꼬리말은 Chromium이 본문과 분리된 문서로 렌더해 본문
                    # 폰트 설정이 적용되지 않는다 - 한글 대신 숫자만 써서 글리프
                    # 누락(네모 상자)을 피한다
                    footer_template=(
                        "<div style=\"width:100%;font-size:8px;color:#666;"
                        "text-align:center\"><span class=\"pageNumber\"></span>"
                        " / <span class=\"totalPages\"></span></div>"),
                )
            finally:
                browser.close()

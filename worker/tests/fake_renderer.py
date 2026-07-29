"""Playwright 없이 렌더 계약만 만족하는 테스트용 렌더러."""
from pathlib import Path


class FakeRenderer:
    def __init__(self):
        self.calls = []

    def render_pdf(self, html, base_dir, out_path):
        base_dir = Path(base_dir)
        base_dir.mkdir(parents=True, exist_ok=True)
        (base_dir / "report.html").write_text(html, encoding="utf-8")
        Path(out_path).write_bytes(b"%PDF-1.4 fake\n")
        self.calls.append({"html": html, "base_dir": base_dir, "out_path": Path(out_path)})

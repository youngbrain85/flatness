"""snapshot -> 보고서 HTML (Jinja2). 렌더러는 이 HTML만 PDF로 만든다.

입력은 snapshot dict 하나뿐이다(계약: 계획 문서 "reports.snapshot 계약"). DB·엔진
산출물을 다시 읽지 않으므로, 발행된 snapshot만 있으면 언제든 동일 HTML이 나온다.
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

_TEMPLATE_DIR = Path(__file__).parent / "templates"

_ENV = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(default_for_string=True, default=True),
    trim_blocks=True,
    lstrip_blocks=True,
)


def fmt_mm(value):
    """mm 수치 표기 — dashboard lib/domain/labels.ts의 fmtMm과 동일(None은 '-')."""
    if value is None:
        return "-"
    return f"{float(value):.2f}"


def fmt_num(value):
    """정수·실수 일반 표기(None은 '-'). 점 수처럼 큰 정수는 천 단위 구분."""
    if value is None:
        return "-"
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return f"{value:,}"
    return str(value)


def asset_src(path, report_id):
    """버킷-상대 자산 경로 -> HTML 파일 기준 상대 경로.

    report.html은 data/reports/{report_id}/report.html에 쓰이므로 'assets/...'로
    참조하면 Chromium이 file:// 상대 경로로 그대로 읽는다(외부 네트워크 접근 없음).
    """
    prefix = f"reports/{report_id}/"
    return path[len(prefix):] if path.startswith(prefix) else path


_ENV.filters["mm"] = fmt_mm
_ENV.filters["num"] = fmt_num
_ENV.filters["asset"] = asset_src


def section_analyses(analyses, surface):
    """'구간별 결과'(평활도 §3)에 실을 분석 목록.

    구배 분석은 scans.surface가 'floor'라 걸러내지 않으면 수평면 표에 섞이는데,
    구역·레벨·mm 편차가 하나도 없어 머리글만 있는 빈 표가 발행본에 박제된다.
    구배 셀 결과는 별도 장이 맡는다(스냅샷의 analyses[].slope).

    ★ 긍정형(`== 'slope'`)으로 판별한다 - 이미 발행된 스냅샷의 평활도 항목에는
    kind 키 자체가 없다(snapshot._slope_analysis_entry 주석 참고).
    """
    return [a for a in analyses
            if a["surface"] == surface and a.get("kind") != "slope"]


def render_html(snap):
    location = snap["location"]
    location_path = " / ".join(
        v for v in (location.get("building"), location.get("floor"),
                    location.get("room"), location.get("name")) if v)
    analyses = snap.get("analyses", [])
    return _ENV.get_template("report.html.j2").render(
        snap=snap,
        report_id=snap["report"]["id"],
        location_path=location_path,
        floor_analyses=section_analyses(analyses, "floor"),
        wall_analyses=section_analyses(analyses, "wall"),
    )

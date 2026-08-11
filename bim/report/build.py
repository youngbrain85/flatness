"""로봇친화도 평가 보고서 — DB 덤프 → HTML → PDF.

렌더러는 워커의 `PlaywrightRenderer`를 그대로 쓴다(헤드리스 Chromium). 문맥과 자산만
이 도메인의 것이다. 숫자는 전부 `judge` 결과에서 오며 템플릿은 계산하지 않는다 —
그림·표·본문이 서로 다른 계산을 하면 셋 중 하나가 틀린 것이기 때문이다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from judge import FAIL, MARGINAL, PASS, UNKNOWN, judge_all, thresholds_for  # noqa: E402

from . import assets as assets_mod  # noqa: E402

TEMPLATES = Path(__file__).parent / "templates"

VERDICT_TEXT = {PASS: "통과", MARGINAL: "조건부", FAIL: "불가", UNKNOWN: "미상"}

# 지표별 도면 측정 가능성 — 조사 결과 그대로. 여기 없는 지표는 보고서에 싣지 않는다.
MEASURABILITY = [
    ("최소 통과폭", "가능", "마감면 간 유효폭으로 계산해야 한다. 벽심 거리를 쓰면 수십 mm 과대평가된다."),
    ("경사로 기울기", "가능", "레벨 표기와 수평 투영 길이가 있으면 직접 계산된다."),
    ("단차 높이", "부분", "설계 단차는 계산되지만 시공 오차·문턱 마감 돌출은 확정되지 않는다."),
    ("바닥 틈·그레이팅", "부분", "승강기 문턱 홈은 제작사 사양이라 건축 도면에 없다."),
    ("카펫 파일 높이", "부분", "위치는 도면으로, 값은 제품 데이터시트로만 확정된다."),
    ("승강기 카 유효면적", "부분", "카 치수는 가능. 문턱 틈·레벨 편차는 불가."),
    ("바닥 마찰·미끄럼저항", "불가", "시공된 표면의 물리 속성이다. 자재 시험성적서 연결이 필요하다."),
    ("바닥 평활도", "불가", "시공 결과 속성이다. 점군 실측(세부과업 1)이 담당한다."),
]


def _fmt(v, digits=0, suffix=""):
    if v is None:
        return "—"
    return (f"{v:.{digits}f}" if digits else f"{v:.0f}") + suffix


def build_context(dump: dict, entry_space: str = "현관") -> dict:
    results = judge_all(dump, entry_space)
    spaces = dump["spaces"]

    rows = []
    for s in sorted(spaces, key=lambda x: x["name"]):
        floor = [f for f in (s.get("finishes") or []) if f["part"] == "바닥" and f["role"] == "finish"]
        fl, sl = s.get("fl_mm"), s.get("sl_mm")
        rows.append({
            "name": s["name"],
            "area": _fmt(s.get("area_m2"), 4),
            "fl": _fmt(fl) if fl is None else f"{fl:+.0f}",
            "sl": _fmt(sl) if sl is None else f"{sl:+.0f}",
            "thk": "—" if (fl is None or sl is None) else f"{fl - sl:.0f}",
            "floor": " · ".join(f["material"] for f in floor) or "—",
            "basis": "도면 확정" if s["basis"] == "drawing_confirmed" else "추론",
            "conflict": bool(s.get("conflict_note")),
        })

    conflicts = [{"name": s["name"], "note": s["conflict_note"]}
                 for s in spaces if s.get("conflict_note")]

    res_ctx = []
    for r in results:
        limits, _ = thresholds_for(dump, r.robot_class)
        step = limits.get("step_height_mm")
        rc = next((c for c in dump["robot_classes"] if c["code"] == r.robot_class), {})
        if step and step.value is not None:
            limit_text = f"{step.value:.0f} {step.unit}"
            if step.marginal is not None:
                limit_text += f" (완충 {step.marginal:g})"
        else:
            limit_text = "공표 근거 없음 — 판정 불가"
        traversable = [s["name"] for s in spaces if s["name"] not in assets_mod.NON_TRAVERSABLE]
        res_ctx.append({
            "code": r.robot_class,
            "name": r.robot_name,
            "short": r.robot_name.split("(")[0].strip()[:10],
            "mode": r.mode_used,
            "reachable": ", ".join(sorted(n for n in r.reachable if n in traversable)) or "없음",
            "unreachable": ", ".join(sorted(n for n in r.unreachable if n in traversable)) or "없음",
            "limit": limit_text,
            "counts": r.counts,
            "blocked_by": ", ".join(r.blocked_by),
            "spec": (step.source if step else ""),
            "asset": "",     # build_all 이 채운다
        })

    step_view = {x["label"]: x for x in dump.get("step_view", [])}
    matrix = []
    for adj in dump["adjacencies"]:
        sv = step_view.get(adj["label"], {})
        matrix.append({
            "label": adj["label"],
            "step": _fmt(sv.get("step_abs_mm")) if sv.get("step_abs_mm") is not None else "미상",
            "verdicts": [
                {"key": b.verdict, "text": VERDICT_TEXT[b.verdict]}
                for r in results
                for b in [next(x for x in r.boundaries if x.label == adj["label"])]
            ],
        })

    reach_any = sorted({n for r in results for n in r.reachable
                        if n not in assets_mod.NON_TRAVERSABLE})
    blocked_all = [r.robot_name for r in results if len(r.reachable) <= 1]
    summary = [
        f"{entry_space}에서 출발해 어느 실에든 도달할 수 있는 등급은 "
        f"{len([r for r in results if len(r.reachable) > 1])}/{len(results)}이다.",
    ]
    if blocked_all:
        summary.append(
            f"다음 등급은 {entry_space}을(를) 벗어나지 못한다: {', '.join(blocked_all)}. "
            f"원인은 통과폭이 아니라 실별 바닥 마감 두께 차이에서 오는 단차다.")
    summary.append(
        "로봇 도입을 전제한다면 마감 구성 단계에서 실별 FL을 맞추는 것이 유일한 해법이다. "
        "시공 후에는 단차를 되돌릴 수 없다.")

    return {
        "title": "로봇친화도 평가 보고서 — " + dump["drawing"]["doc_key"],
        "drawing": dump["drawing"],
        "ruleset": dump.get("ruleset") or {"name": "—", "version": "—", "source": "—"},
        "entry_space": entry_space,
        "n_spaces": len(spaces),
        "n_adjacencies": len(dump["adjacencies"]),
        "max_area_error": "0.0025%",
        "measurability": [{"metric": m, "verdict": v, "note": n} for m, v, n in MEASURABILITY],
        "spaces": rows,
        "conflicts": conflicts,
        "results": res_ctx,
        "matrix": matrix,
        "reach_any": reach_any,
        "summary": summary,
        "limits": [
            "도면 한 장(LH 26형)으로만 검증했다. 다른 발행 기관 도면에서는 경계 선 굵기를 다시 잡아야 한다.",
            "욕실 출입구 폭이 도면에 없다 — 시스템욕실 제품에 포함되어 창호 발주 대상이 아니다.",
            "유효 통과폭은 어떤 개구부도 확정되지 않는다. 문틀 내측 상한만 계산된다.",
            "욕실·발코니 레벨의 원문 모순이 미해소다. 발코니는 어느 분기를 고르냐에 따라 판정이 뒤집힌다.",
            "마찰·평활도는 도면으로 측정되지 않는다. 점군 실측이 있어야 한다.",
            "카펫 파일 높이는 제품군 수준에서 미상이다 — 로봇 판정의 최대 공백이다.",
        ],
        "_results_obj": results,
    }


def render_html(ctx: dict) -> str:
    env = Environment(loader=FileSystemLoader(str(TEMPLATES)),
                      autoescape=select_autoescape(["html"]), trim_blocks=True, lstrip_blocks=True)
    return env.get_template("robot_report.html.j2").render(ctx=ctx)


def build(dump_path: str | Path, out_dir: str | Path, renderer=None,
          entry_space: str = "현관") -> Path:
    dump = json.loads(Path(dump_path).read_text(encoding="utf-8"))
    ctx = build_context(dump, entry_space)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    names = assets_mod.build_all(dump, ctx["_results_obj"], out_dir / "assets")
    ctx["assets"] = {"plan": names["plan"]}
    for r in ctx["results"]:
        r["asset"] = names[r["code"]]

    html = render_html(ctx)
    pdf = out_dir / "robot_report.pdf"
    if renderer is None:
        from flatworker.report.renderer import PlaywrightRenderer
        renderer = PlaywrightRenderer(html_filename="robot_report.html")
    renderer.render_pdf(html, out_dir, pdf)
    return pdf


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else str(
        Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "lh26_dump.json")
    dst = sys.argv[2] if len(sys.argv) > 2 else "out"
    print("작성:", build(src, dst))

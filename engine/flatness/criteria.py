"""판정 기준 로드 + §4.2 판정식."""
from dataclasses import dataclass
from importlib import resources
import json


@dataclass
class Criterion:
    name: str
    surface: str
    metric: str
    span_m: float | None
    pass_mm: float
    rework_mm: float
    source: str


def load_criteria(path=None):
    if path is None:
        raw = resources.files("flatness").joinpath("data/seed_criteria.json").read_text("utf-8")
    else:
        raw = open(path, encoding="utf-8").read()
    return {d["name"]: Criterion(**d) for d in json.loads(raw)}


def grade_value(value_mm, crit, u_mm, span_used_m):
    """§4.2: s=span_used/span, pe=pass×s, re=rework×s, b1=pe−U, b2=min(pe+U, re)."""
    warns = []
    s = 1.0 if crit.span_m is None else min(1.0, span_used_m / crit.span_m)
    if s < 1.0:
        warns.append("reduced_span")
    pe, re = crit.pass_mm * s, crit.rework_mm * s
    b1, b2 = pe - u_mm, min(pe + u_mm, re)
    if pe + u_mm >= re:
        warns.append("uncertainty_swallows_repair")
    if value_mm <= b1:
        return "pass", warns
    if value_mm <= b2:
        return "borderline", warns
    if value_mm <= re:
        return "repair", warns
    return "rework", warns


def grade_cells(cells, crit, u_mm):
    grades, all_warns = [], set()
    for c in cells:
        if c.value_mm is None:
            grades.append(None)
            continue
        g, w = grade_value(c.value_mm, crit, u_mm, c.span_used_m)
        grades.append(g)
        all_warns.update(w)
    return grades, sorted(all_warns)

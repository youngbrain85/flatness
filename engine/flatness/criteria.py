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
    """§4.2 2차 개정: s=span_used/span, pe=pass×s, re=rework×s, U_eff=U×s.

    U를 고정하면 축소 스팬에서 pe < U가 되어 평탄 셀조차 적합 불가 —
    드리프트 지배 불확도는 기저선 길이에 비례하므로 U도 같은 비율로 환산한다.

    b1(=pe-U_eff) <= 0이면 편차 0.0mm인 완벽한 표면조차 "적합"이 원리적으로
    나올 수 없다(전부 경계 이상) — uncertainty_swallows_repair(보수 구간 소멸)와
    별개 현상이므로 uncertainty_swallows_pass로 따로 경고한다. 축소 스팬에서도
    pe·U_eff가 같은 비율로 줄어 부호는 유지되지만, 실제 판정에 쓰이는 b1 값
    기준으로 검사한다.
    """
    warns = []
    s = 1.0 if crit.span_m is None else min(1.0, span_used_m / crit.span_m)
    if s < 1.0:
        warns.append("reduced_span")
    pe, re = crit.pass_mm * s, crit.rework_mm * s
    u_eff = u_mm * s
    b1, b2 = pe - u_eff, min(pe + u_eff, re)
    if crit.pass_mm + u_mm >= crit.rework_mm:
        warns.append("uncertainty_swallows_repair")
    if b1 <= 0:
        warns.append("uncertainty_swallows_pass")
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

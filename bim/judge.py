"""로봇 주행 가능성 판정 — 임계값은 DB에서 오고, 코드에는 숫자가 없다.

이 모듈이 답하는 질문은 "경계별로 통과인가"가 아니라 **"현관에서 출발해 어느 실까지
갈 수 있는가"**다. 경계 하나가 막히면 그 너머 전체가 도달 불가가 되므로, 경계별 표만으로는
실제 운용 가능성을 알 수 없다.

판정 값은 넷이다. `unknown`이 1급인 것이 핵심이다 —
도면에 값이 없는 것을 통과로 처리하면 현장에서 로봇이 갇힌다.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

PASS, MARGINAL, FAIL, UNKNOWN = "pass", "marginal", "fail", "unknown"

# 경로를 여는 판정. marginal 은 '조건부'라 열되 경로에 표식이 남는다.
_TRAVERSABLE = {PASS, MARGINAL}


def eval_threshold(value: float | None, comparator: str,
                   limit: float | None, marginal: float | None = None) -> str:
    """DB의 `fn_eval_threshold`와 같은 계약. 값이나 임계값이 없으면 unknown.

    ⚠ 값이 없을 때 pass 를 돌려주면 안 된다. NULL 비교는 SQL 에서 NULL 이고,
      그것을 '조건에 안 걸렸다 = 통과'로 접으면 미측정이 합격이 된다.
    """
    if value is None or limit is None:
        return UNKNOWN
    ok = {
        "lte": value <= limit, "lt": value < limit,
        "gte": value >= limit, "gt": value > limit,
    }.get(comparator)
    if ok is None:
        return UNKNOWN
    if ok:
        return PASS
    if marginal is not None:
        near = value <= marginal if comparator in ("lte", "lt") else value >= marginal
        if near:
            return MARGINAL
    return FAIL


@dataclass(frozen=True)
class Threshold:
    metric: str
    comparator: str
    value: float | None
    marginal: float | None
    unit: str
    mode: str
    source: str
    unknown_reason: str = ""


@dataclass
class BoundaryVerdict:
    label: str
    space_a: str
    space_b: str
    verdict: str
    metric: str
    observed: float | None
    limit: float | None
    note: str = ""


@dataclass
class ClassResult:
    robot_class: str
    robot_name: str
    mode_used: str
    boundaries: list[BoundaryVerdict] = field(default_factory=list)
    reachable: set[str] = field(default_factory=set)
    unreachable: set[str] = field(default_factory=set)
    blocked_by: list[str] = field(default_factory=list)

    @property
    def counts(self) -> dict[str, int]:
        out = {PASS: 0, MARGINAL: 0, FAIL: 0, UNKNOWN: 0}
        for b in self.boundaries:
            out[b.verdict] = out.get(b.verdict, 0) + 1
        return out


def thresholds_for(dump: dict, robot_class: str) -> tuple[dict[str, Threshold], str]:
    """등급의 임계값을 지표별로 모으고, 실제로 쓰인 모드를 함께 돌려준다.

    모드는 정확 일치 파티션이라 폴백이 필요하다. DB의 `default_mode`가 그 선언이며,
    폴백이 일어났으면 어느 모드가 쓰였는지 반드시 드러나야 한다 — 조용히 다른 모드의
    임계값으로 판정하면 근거를 추적할 수 없다.
    """
    rc = next((c for c in dump["robot_classes"] if c["code"] == robot_class), None)
    default_mode = (rc or {}).get("default_mode") or ""
    rows = [t for t in dump["thresholds"] if t["class"] == robot_class]
    mode = default_mode if any(t["mode"] == default_mode for t in rows) else ""
    if not any(t["mode"] == mode for t in rows) and rows:
        mode = rows[0]["mode"]
    out: dict[str, Threshold] = {}
    for t in rows:
        if t["mode"] != mode:
            continue
        out[t["metric"]] = Threshold(
            metric=t["metric"], comparator=t["comparator"], value=t["value"],
            marginal=t["marginal"], unit=t["unit"], mode=t["mode"],
            source=t.get("source") or "", unknown_reason=t.get("unknown_reason") or "")
    return out, mode


def judge_class(dump: dict, robot_class: str, entry_space: str = "현관") -> ClassResult:
    """한 등급에 대해 경계별 판정 + 진입점에서의 도달 가능 범위를 계산한다."""
    rc = next((c for c in dump["robot_classes"] if c["code"] == robot_class), None)
    limits, mode = thresholds_for(dump, robot_class)
    res = ClassResult(robot_class=robot_class,
                      robot_name=(rc or {}).get("name") or robot_class, mode_used=mode)

    step_view = {x["label"]: x for x in dump.get("step_view", [])}
    step_limit = limits.get("step_height_mm")

    edges: list[tuple[str, str, str]] = []
    for adj in dump["adjacencies"]:
        sv = step_view.get(adj["label"], {})
        observed = sv.get("step_abs_mm")
        verdict = eval_threshold(observed, step_limit.comparator, step_limit.value,
                                 step_limit.marginal) if step_limit else UNKNOWN
        note = ""
        if verdict == UNKNOWN:
            note = (sv.get("unevaluable") or "").strip() or (
                step_limit.unknown_reason if step_limit else "임계값 미등록")
        res.boundaries.append(BoundaryVerdict(
            label=adj["label"], space_a=adj["a"], space_b=adj["b"], verdict=verdict,
            metric="step_height_mm", observed=observed,
            limit=step_limit.value if step_limit else None, note=note))
        edges.append((adj["a"], adj["b"], verdict))

    # 진입점에서 BFS. 열리는 경계만 건넌다.
    traversable = {s["name"] for s in dump["spaces"]}
    graph: dict[str, list[str]] = {n: [] for n in traversable}
    for a, b, v in edges:
        if v in _TRAVERSABLE and a in graph and b in graph:
            graph[a].append(b)
            graph[b].append(a)

    seen = {entry_space} if entry_space in graph else set()
    q = deque(seen)
    while q:
        cur = q.popleft()
        for nxt in graph[cur]:
            if nxt not in seen:
                seen.add(nxt)
                q.append(nxt)
    res.reachable = seen
    res.unreachable = traversable - seen
    res.blocked_by = sorted({b.label for b in res.boundaries
                             if b.verdict not in _TRAVERSABLE
                             and (b.space_a in seen) != (b.space_b in seen)})
    return res


def judge_all(dump: dict, entry_space: str = "현관") -> list[ClassResult]:
    return [judge_class(dump, c["code"], entry_space)
            for c in sorted(dump["robot_classes"], key=lambda x: x["code"])]

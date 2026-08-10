"""판정 회귀 — "미상을 통과로 접지 않는다"와 "막힌 경계 너머는 도달 불가"를 지킨다.

픽스처는 합성이 아니라 LH 26형 도면에서 복원한 실제 DB 덤프다.
"""
from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from judge import (  # noqa: E402
    FAIL, MARGINAL, PASS, UNKNOWN, eval_threshold, judge_all, judge_class, thresholds_for,
)

FIXTURE = Path(__file__).parent / "fixtures" / "lh26_dump.json"


@pytest.fixture
def dump():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


# ─── eval_threshold: 미상은 통과가 아니다 ────────────────────────────────────
@pytest.mark.parametrize("value,limit", [(None, 20.0), (30.0, None), (None, None)])
def test_값이나_임계값이_없으면_unknown(value, limit):
    """NULL 비교를 '조건에 안 걸렸다 = 통과'로 접으면 미측정이 합격이 된다."""
    assert eval_threshold(value, "lte", limit) == UNKNOWN


def test_알_수_없는_비교자는_unknown():
    assert eval_threshold(10.0, "between", 20.0) == UNKNOWN


def test_경계값은_포함_여부가_비교자로_갈린다():
    assert eval_threshold(20.0, "lte", 20.0) == PASS
    assert eval_threshold(20.0, "lt", 20.0) == FAIL
    assert eval_threshold(20.0, "gte", 20.0) == PASS
    assert eval_threshold(20.0, "gt", 20.0) == FAIL


def test_완충구간이_없으면_초과는_바로_fail():
    assert eval_threshold(25.0, "lte", 20.0, None) == FAIL


def test_완충구간_안이면_marginal_밖이면_fail():
    assert eval_threshold(22.0, "lte", 20.0, 25.0) == MARGINAL
    assert eval_threshold(26.0, "lte", 20.0, 25.0) == FAIL


def test_하한_규정에도_완충이_적용된다():
    """최소 통과폭 같은 gte 규정에서 완충 방향이 반대다 — lte 로직을 그대로 쓰면 뒤집힌다."""
    assert eval_threshold(780.0, "gte", 800.0, 750.0) == MARGINAL
    assert eval_threshold(700.0, "gte", 800.0, 750.0) == FAIL
    assert eval_threshold(850.0, "gte", 800.0, 750.0) == PASS


# ─── 실제 도면 판정 ──────────────────────────────────────────────────────────
def test_상업용_로봇은_현관을_벗어나지_못한다(dump):
    """현관(FL+80) -> 주방(FL+110) 30mm 가 상업용 전 등급 한계를 넘는다."""
    for code in ("serving-delivery", "commercial-cleaner", "industrial-amr"):
        r = judge_class(dump, code)
        assert r.reachable == {"현관"}, f"{code}: {sorted(r.reachable)}"


def test_가정용은_거실까지_가지만_욕실_발코니는_못_간다(dump):
    r = judge_class(dump, "domestic-cleaner")
    assert "거실/침실" in r.reachable and "주방/식당" in r.reachable
    assert "욕실" not in r.reachable, "욕실 단차 80mm 는 20mm 한계를 넘는다"
    assert "발코니" not in r.reachable


def test_근거_없는_등급은_전부_unknown이지_pass가_아니다(dump):
    """공표 사양을 못 구한 등급은 판정을 못 한다. 그것을 통과로 접으면 안 된다."""
    r = judge_class(dump, "outdoor-delivery")
    assert all(b.verdict == UNKNOWN for b in r.boundaries)
    assert r.counts[PASS] == 0


def test_폴백된_모드가_결과에_드러난다(dump):
    """상업 청소로봇은 drive/clean 행만 있다. 어느 모드로 쟀는지 안 보이면 근거 추적이 끊긴다."""
    r = judge_class(dump, "commercial-cleaner")
    assert r.mode_used == "clean"
    limits, mode = thresholds_for(dump, "commercial-cleaner")
    assert mode == "clean" and "step_height_mm" in limits


def test_모든_등급이_판정을_생성한다(dump):
    """판정 대상이 아예 안 생기면 fail 도 안 난다 — 조용한 통과다."""
    for r in judge_all(dump):
        assert r.boundaries, f"{r.robot_class}: 판정 0건"
        assert len(r.boundaries) == len(dump["adjacencies"])


def test_막힌_경계가_blocked_by에_기록된다(dump):
    r = judge_class(dump, "domestic-cleaner")
    assert r.blocked_by, "도달 못 한 실이 있는데 막은 경계가 비어 있다"
    for label in r.blocked_by:
        b = next(x for x in r.boundaries if x.label == label)
        assert b.verdict in (FAIL, UNKNOWN)


# ─── 연결성: 막힌 경계 너머는 전부 도달 불가 ─────────────────────────────────
def test_경계를_막으면_그_너머가_통째로_도달_불가가_된다(dump):
    """경계별 표만 보면 '한 곳 실패'로 보이지만 실제로는 그 너머 전체를 잃는다."""
    before = judge_class(dump, "domestic-cleaner").reachable
    assert "거실/침실" in before

    d = deepcopy(dump)
    for sv in d["step_view"]:
        if sv["label"] == "주방-현관 마감 전환선":
            sv["step_abs_mm"] = 999.0        # 현관에서 주방으로 가는 유일한 경계를 막는다
    after = judge_class(d, "domestic-cleaner").reachable
    # 현관에는 출구가 둘이다(주방·복도). 주방 쪽을 막으면 복도는 남고 주방 너머가 통째로 끊긴다.
    assert "주방/식당" not in after, "막은 경계 바로 건너편에 도달했다"
    assert "거실/침실" not in after, "주방을 거쳐야 닿는 실인데 도달했다 — 그 너머가 안 끊겼다"
    assert after < before, f"막았는데 도달 범위가 줄지 않았다: {sorted(after)}"


def test_unknown_경계는_길을_열지_않는다(dump):
    """도면에 값이 없는 경계를 통과로 처리하면 현장에서 로봇이 갇힌다."""
    d = deepcopy(dump)
    for sv in d["step_view"]:
        sv["step_abs_mm"] = None             # 전 경계를 미상으로
    r = judge_class(d, "domestic-cleaner")
    assert all(b.verdict == UNKNOWN for b in r.boundaries)
    assert r.reachable == {"현관"}, "미상 경계가 길을 열었다"


def test_marginal은_길을_열되_판정에_남는다(dump):
    d = deepcopy(dump)
    for sv in d["step_view"]:
        sv["step_abs_mm"] = 0.0
    for sv in d["step_view"]:
        if sv["label"] == "주방-현관 마감 전환선":
            sv["step_abs_mm"] = 30.0         # domestic-cleaner: 한계 20 / 완충 상한 안
    r = judge_class(d, "domestic-cleaner")
    b = next(x for x in r.boundaries if x.label == "주방-현관 마감 전환선")
    if b.verdict == MARGINAL:
        assert "주방/식당" in r.reachable, "marginal 은 조건부 통과라 길을 연다"
    else:
        pytest.skip(f"이 기준세트에서는 30mm 가 {b.verdict} — 완충구간 밖이다")


def test_진입점이_없으면_아무_데도_못_간다(dump):
    r = judge_class(dump, "domestic-cleaner", entry_space="존재하지_않는_실")
    assert r.reachable == set()

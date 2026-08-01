import re
from pathlib import Path

from flatness.outputs.summary import _WARN_TEXT, generate_summary

_STATS_SCHEMA_MD = Path(__file__).resolve().parents[2] / "docs" / "contracts" / "stats-schema.md"

def _base_stats(**over):
    s = {"n_cells": 30, "n_valid": 28,
         "grade_counts": {"pass": 20, "borderline": 5, "repair": 3, "rework": 0, "na": 2},
         "worst": {"value_mm": 12.3, "point_x": 2.1, "point_y": 1.4, "cell_ix": 2, "cell_iy": 1, "zone_id": None},
         "coverage_pct": 93.5, "warnings": [],
         "applied_criteria": {"name": "floor-kcs-exposed", "pass_mm": 7, "rework_mm": 21, "u_mm": 5.0},
         "meta": {"surface": "floor"}, "zones": [], "value_max_mm": 12.3}
    s.update(over)
    return s

def test_summary_core_sections():
    t = generate_summary(_base_stats())
    assert "적합 20" in t and "보수 3" in t
    assert "12.3" in t and "(2.1, 1.4)" in t
    assert "대체하지 않습니다" in t          # 스크리닝 고지 필수
    assert "보수" in t                        # 최악 등급 문구

def test_summary_warning_mapping():
    t = generate_summary(_base_stats(warnings=["ghost_layer_rescan", "low_coverage"]))
    assert "이중 표면" in t and "재스캔" in t
    assert "인식률" in t

def test_summary_all_pass():
    t = generate_summary(_base_stats(
        grade_counts={"pass": 28, "borderline": 0, "repair": 0, "rework": 0, "na": 2}))
    assert "기준을 만족" in t

def test_summary_cp949_safe():
    t = generate_summary(_base_stats(warnings=["ghost_layer_rescan", "furniture_excluded",
                                               "plumbness_relative_to_z", "low_coverage",
                                               "uncertainty_swallows_repair", "reduced_span",
                                               "wall_2_skipped", "ghost_zone_excluded"]))
    t.encode("cp949")  # 예외 없이 인코딩되어야 함

def test_summary_all_na_no_false_pass():
    # 전체 판정불가는 "기준 만족"이 아니라 재스캔 권고여야 한다 (Critical 회귀 방지)
    t = generate_summary(_base_stats(
        n_valid=0, worst=None,
        grade_counts={"pass": 0, "borderline": 0, "repair": 0, "rework": 0, "na": 30}))
    assert "기준을 만족" not in t
    assert "재스캔" in t

def test_summary_worst_zone_shown():
    s = _base_stats()
    s["worst"]["zone_id"] = 2
    t = generate_summary(s)
    assert "(구역 2)" in t
    s["meta"]["surface"] = "wall"
    assert "(벽 2)" in generate_summary(s)


def _documented_warning_codes():
    """stats-schema.md §5 "warnings 코드 사전" 표에서 리터럴 코드 열만 추출한다.

    `wall_{i}_skipped`처럼 중괄호가 섞인 개방 패턴 행은 리터럴 코드가 아니므로
    정규식(`[a-z0-9_]+`, 중괄호 불허 — `preview3d_render_failed`처럼 숫자가 섞인
    코드는 허용해야 해서 숫자도 포함한다)이 자동으로 제외한다 — summary.py도 이
    코드는 `_WARN_TEXT` 사전이 아니라 `code.startswith("wall_")·endswith("_skipped")`
    개방 패턴으로 별도 처리한다(위 `generate_summary` 참고).
    """
    text = _STATS_SCHEMA_MD.read_text(encoding="utf-8")
    m = re.search(r"## 5\. warnings 코드 사전(.*?)\n## 6\.", text, re.S)
    assert m, "stats-schema.md에서 §5 warnings 코드 사전 절을 찾지 못했습니다"
    codes = re.findall(r"^\|\s*`([a-z0-9_]+)`\s*\|", m.group(1), re.M)
    assert len(codes) == 11, "파싱 실패 의심(§5 리터럴 코드는 11개여야 함 - wall_{i}_skipped 패턴 행 제외)"
    return set(codes)


def test_warn_text_is_subset_of_documented_warning_codes():
    """코드리뷰 Minor(M1): summary.py의 _WARN_TEXT는 stats-schema.md §5 사전의
    부분집합이어야 한다(렌더 실패 3종 heatmap/preview3d/deviation_render_failed을
    종합의견 문구에서 의도적으로 뺀 부분집합 — 판정과 무관한 렌더 인프라 실패까지
    종합의견 본문에 싣지 않기 위함, generate_summary의 warnings 순회 로직 참고).

    이 대조는 그동안 존재하지 않았다: 대시보드 쪽은 이미
    worker/tests/test_report_labels.py가 워커의 labels.py <-> dashboard의
    labels.ts를 대조하지만, 엔진 summary.py의 _WARN_TEXT는 아무 것과도 대조되지
    않아 코드가 문서·라벨 사전에서 빠지거나 오타가 나도 감지되지 않았다.
    stats-schema.md는 엔진 스스로가 "정본"으로 선언한 문서이므로(파일 헤더 참고)
    이 문서 §5를 직접 파싱해 대조한다 — 워커의 labels.py를 엔진 테스트가
    import하면 엔진 -> 워커 방향의 패키지 경계를 넘는 의존이 새로 생기고
    (`cd engine && python -m pytest`만으로는 worker가 sys.path에 없어 깨진다),
    dashboard의 labels.ts는 TypeScript라 엔진 쪽에서 파싱하기에는 워커가 이미
    갖춘 정규식 파서를 다시 만들어야 해 비용 대비 이득이 낮다.
    """
    documented = _documented_warning_codes()
    assert set(_WARN_TEXT) <= documented

"""표시 매핑 정합 — 정본은 dashboard/lib/domain/labels.ts다.

워커 템플릿이 자체 매핑을 들고 있으면 같은 분석이 화면과 PDF에서 다른 라벨·색으로
보인다. 여기서 정본 TS 파일을 실제로 파싱해 표 전체를 대조한다. 파서가 형식 변화로
0건을 읽고 조용히 통과하는 사고를 막기 위해 표별 엔트리 개수까지 단언한다.
"""
import re
from pathlib import Path

from flatworker.report.labels import (GRADE_COLOR, GRADE_LABEL, LINEAGE_LABEL, SURFACE_LABEL,
                                      WARNING_LABEL, ZONE_STATUS_LABEL, warning_label)

_LABELS_TS = Path(__file__).resolve().parents[2] / "dashboard" / "lib" / "domain" / "labels.ts"


def _extract_object(source, name):
    """`(export) const NAME...= { ... };` 블록을 중괄호 균형으로 잘라 dict로 파싱한다."""
    m = re.search(rf"const\s+{name}\b[^=]*=\s*\{{", source)
    assert m, f"labels.ts에서 {name} 선언을 찾지 못했습니다"
    start = m.end() - 1
    depth = 0
    body = None
    for i in range(start, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                body = source[start + 1:i]
                break
    assert body is not None, f"{name} 블록의 닫는 중괄호를 찾지 못했습니다"
    pairs = re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'((?:[^'\\]|\\.)*)'", body, re.S)
    return dict(pairs)


def _ts():
    return _LABELS_TS.read_text(encoding="utf-8")


def test_grade_label_and_color_match_dashboard():
    source = _ts()
    labels = _extract_object(source, "GRADE_LABEL")
    colors = _extract_object(source, "GRADE_COLOR")
    assert len(labels) == 5 and len(colors) == 5, "파싱 실패 의심(등급 표는 5개여야 함)"
    assert labels == GRADE_LABEL
    assert colors == GRADE_COLOR


def test_surface_lineage_zone_labels_match_dashboard():
    source = _ts()
    surface = _extract_object(source, "SURFACE_LABEL")
    lineage = _extract_object(source, "LINEAGE_LABEL")
    zone = _extract_object(source, "ZONE_STATUS_LABEL")
    # lineage는 011_register_enums.sql이 data_lineage에 'registered'를 더해 4개다
    # (설계 결정 F9). 이 숫자가 세 곳(워커 report/labels.py · 대시보드
    # lib/domain/labels.ts · types.ts)의 일관성을 강제하는 장치다.
    assert (len(surface), len(lineage), len(zone)) == (2, 4, 3), "파싱 실패 의심"
    assert surface == SURFACE_LABEL
    assert lineage == LINEAGE_LABEL
    assert zone == ZONE_STATUS_LABEL


def test_warning_dictionary_matches_dashboard():
    warnings = _extract_object(_ts(), "WARNING_LABEL")
    assert len(warnings) == 11, "파싱 실패 의심(warnings 사전은 11개 코드)"
    assert warnings == WARNING_LABEL


def test_warning_label_open_pattern_and_fallback():
    """labels.ts warningLabel과 동일: 사전 -> wall_{i}_skipped 개방 패턴 -> 원문 노출."""
    assert warning_label("low_coverage") == WARNING_LABEL["low_coverage"]
    assert warning_label("wall_3_skipped").startswith("3번 벽")
    assert warning_label("미지_코드") == "미지_코드"

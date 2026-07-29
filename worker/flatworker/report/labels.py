"""보고서 표시 매핑 — 정본은 dashboard/lib/domain/labels.ts다.

워커와 대시보드가 각자 표를 들고 있으면 같은 분석이 화면과 PDF에서 다른 라벨·색으로
보이게 된다. 이 모듈은 정본의 사본이며, tests/test_report_labels.py가 labels.ts를
실제로 파싱해 표를 대조하므로 어느 한쪽만 바뀌면 즉시 실패한다.
"""
import re

GRADE_ORDER = ["pass", "borderline", "repair", "rework", "na"]

GRADE_LABEL = {
    "pass": "적합", "borderline": "경계", "repair": "보수",
    "rework": "재시공", "na": "판정 불가",
}

GRADE_COLOR = {
    "pass": "#2e7d32", "borderline": "#f9ab00", "repair": "#e8710a",
    "rework": "#c5221f", "na": "#9e9e9e",
}

SURFACE_LABEL = {"floor": "바닥", "wall": "벽면"}

LINEAGE_LABEL = {"raw": "원시 점군", "fused_mesh": "융합 메시", "unknown": "모름"}

ZONE_STATUS_LABEL = {"ok": "정상", "ghost": "유령층(제외)", "furniture": "가구 추정(제외)"}

WARNING_LABEL = {
    "ghost_layer_rescan":
        "이중 표면(유령층) 서브셀이 감지되어 일부가 판정에서 제외되었습니다. 재스캔을 권장합니다.",
    "ghost_zone_excluded": "이중 표면 비율이 높은 구역 전체가 판정에서 제외되었습니다.",
    "furniture_excluded": "가구 상판으로 추정되는 구역이 판정에서 제외되었습니다.",
    "low_coverage": "바닥 인식률이 70% 미만입니다. 스캔 범위·가림을 확인하세요.",
    "reduced_span":
        "공간 제약으로 기준 스팬보다 짧은 직선자 길이를 사용해 허용치와 불확도를 선형 환산했습니다.",
    "uncertainty_swallows_repair":
        "측정 불확도가 보수 구간을 잠식합니다(경계 구간이 보수 구간을 흡수). 보수 판정이 나오지 않을 수 있습니다.",
    "plumbness_relative_to_z": "수직도는 스캔 좌표계 z축 기준 상대 지표입니다(중력 보정 아님).",
}

_WALL_SKIPPED = re.compile(r"^wall_(\d+)_skipped$")


def warning_label(code):
    """labels.ts의 warningLabel과 동일 규칙: 사전 -> 개방 패턴 -> 원문 노출."""
    if code in WARNING_LABEL:
        return WARNING_LABEL[code]
    m = _WALL_SKIPPED.match(code)
    if m:
        return f"{m.group(1)}번 벽 후보가 유효 데이터 부족 또는 처리 오류로 판정에서 제외되었습니다."
    return code  # 미지 코드는 원문 노출(숨기는 것보다 안전)

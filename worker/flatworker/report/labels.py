"""보고서 표시 매핑 — 정본은 dashboard/lib/domain/labels.ts다.

워커와 대시보드가 각자 표를 들고 있으면 같은 분석이 화면과 PDF에서 다른 라벨·색으로
보이게 된다. 이 모듈은 정본의 사본이며, tests/test_report_labels.py가 labels.ts를
실제로 파싱해 표를 대조하므로 어느 한쪽만 바뀌면 즉시 실패한다.
"""
import re

# analyses.kind. 보고서가 평활도와 구배를 **문구로** 구별하는 데 쓴다 - 같은 바닥
# 스캔에서 두 분석이 나오므로 surface_label('바닥')만으로는 갈리지 않는다.
ANALYSIS_KIND_LABEL = {"flatness": "평활도", "slope": "구배"}

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

LINEAGE_LABEL = {"raw": "원시 점군", "fused_mesh": "융합 메시", "unknown": "모름",
                 # 011이 data_lineage에 더한 값(설계 결정 F9). 'fused_mesh'를
                 # 재사용하지 않는 이유가 라벨에도 그대로 있다 - "융합 메시"는
                 # 스캐너 앱이 스무딩한 데이터를 가리키는 말이고, 정합 병합은
                 # 원시 점군 두 개의 서브셀 중앙값이라 그 서술이 거짓이 된다.
                 "registered": "정합 병합"}

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
    "uncertainty_swallows_pass":
        "측정 불확도가 허용치보다 커서 적합 판정이 나올 수 없습니다(기준 또는 불확도 재검토 필요).",
    "plumbness_relative_to_z": "수직도는 스캔 좌표계 z축 기준 상대 지표입니다(중력 보정 아님).",
    "fused_mesh_smoothed":
        "융합 메시는 스캐너 앱이 표면을 매끄럽게 다듬은 데이터라 실제 요철보다 양호한 결과가 나올 수 있습니다. "
        "가능하면 원시 점군으로 다시 내보내 분석하세요.",
    "heatmap_render_failed":
        "판정 히트맵 이미지 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.",
    "preview3d_render_failed":
        "3D 프리뷰 이미지 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.",
    "deviation_render_failed":
        "정밀 편차맵 이미지 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.",
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

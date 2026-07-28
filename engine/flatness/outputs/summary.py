"""자동 종합의견 — stats 기반 규칙 템플릿 (스펙 §5.3, LLM 미사용·재현성)."""

_WARN_TEXT = {
    "ghost_layer_rescan": "일부 구역에서 이중 표면(유령층)이 감지되어 해당 지역은 판정에서 제외되었습니다. 재스캔을 권장합니다.",
    "ghost_zone_excluded": "이중 표면 비율이 높은 구역이 통째로 제외되었습니다. 재스캔을 권장합니다.",
    "furniture_excluded": "가구 상판으로 의심되는 면이 판정에서 제외되었습니다.",
    "low_coverage": "바닥 인식률이 낮습니다. 스캔 범위와 장애물을 확인하세요.",
    "plumbness_relative_to_z": "수직도는 스캔 좌표계의 z축 기준 상대 지표입니다(중력 보정 아님).",
    "uncertainty_swallows_repair": "측정 불확도가 보수 구간을 잠식하여 경계 판정이 확대되었습니다.",
    "reduced_span": "일부 구간은 공간 제약으로 축소 스팬(허용치 선형 환산)으로 판정되었습니다.",
}


def _worst_grade(gc):
    for g in ("rework", "repair", "borderline"):
        if gc.get(g, 0) > 0:
            return g
    return "pass"


def generate_summary(stats):
    gc = stats["grade_counts"]
    crit = stats["applied_criteria"]
    lines = []
    surface = "벽면" if stats.get("meta", {}).get("surface") == "wall" else "바닥면"
    lines.append(f"{surface} 평활도 분석 결과, 판정 셀 {stats['n_cells']}개(유효 {stats['n_valid']}개) 중 "
                 f"적합 {gc['pass']}개, 경계 {gc['borderline']}개, 보수 {gc['repair']}개, "
                 f"재시공 {gc['rework']}개, 판정 불가 {gc['na']}개로 나타났습니다. "
                 f"적용 기준은 {crit['name']}(허용 {crit['pass_mm']}mm, 불확도 U={crit['u_mm']}mm)입니다.")
    w = stats.get("worst")
    if w:
        loc = f" (구역 {w['zone_id']})" if w.get("zone_id") not in (None,) else ""
        if stats.get("meta", {}).get("surface") == "wall" and w.get("zone_id") is not None:
            loc = f" (벽 {w['zone_id']})"
        lines.append(f"최대 편차는 {w['value_mm']}mm로 좌표 ({w['point_x']:.1f}, {w['point_y']:.1f}){loc} 부근에서 "
                     f"관측되었습니다.")
    wg = _worst_grade(gc)
    if stats["n_valid"] == 0:
        lines.append("유효 판정 셀이 없어 평활도 판정을 내릴 수 없습니다. 스캔 품질(점 밀도·범위)을 확인하고 재스캔을 권장합니다.")
    elif wg == "pass":
        lines.append("전 구간이 적용 기준을 만족합니다.")
    elif wg == "borderline":
        lines.append("일부 구간이 경계 판정입니다. 현장 재확인(실물 직선자 검측)을 권장합니다.")
    elif wg == "repair":
        lines.append("보수 검토 대상 구간이 존재합니다. 해당 위치의 보수 계획 수립을 권장합니다.")
    else:
        lines.append("재시공 검토 대상 구간이 존재합니다. 정밀 검측 및 시공 검토가 필요합니다.")
    for code in stats.get("warnings", []):
        if code in _WARN_TEXT:
            lines.append(_WARN_TEXT[code])
        elif code.startswith("wall_") and code.endswith("_skipped"):
            lines.append(f"벽 {code.split('_')[1]}번은 평가 불가로 제외되었습니다.")
    lines.append("본 결과는 모바일 LiDAR 기반 스크리닝이며 공식 검측(실물 직선자·레벨 측량)을 대체하지 않습니다.")
    return "\n".join(lines)

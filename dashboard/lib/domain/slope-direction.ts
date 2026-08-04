// 보정 방향 문구 (스펙 §5.3): "북동쪽 끝을 10mm 낮춤" 형태.
//
// ★ 판정 이중화가 아니다(리트머스, 브리프 D3): 이 파일 어디에도 pass_pct·re_pct·
// dir_pass_deg 같은 판정 임계값이 등장하지 않는다. 하는 일은 두 가지뿐이다.
//   1) 각도 하나(downhill_rad)를 8구간으로 나누는 표시 로직(compassLabel)
//   2) 이미 grade_slope_cells(engine/flatness/core/slope.py)가 계산해 낸 두 값
//      (slope_pct·design_pct)의 부호를 그대로 읽는 것(correctionDirectionLabel).
//      그 함수는 d = |slope_pct - design_pct|로 절댓값만 남기고 부호를 버리는데,
//      여기서는 절댓값을 취하기 전 부호만 해석에 쓸 뿐 새 임계값 비교를 하지
//      않는다 - 이미 난 값을 다시 읽는 것이지 새로 판정하는 것이 아니다.
//
// 부호 해석: 실측 구배(slope_pct)가 설계(design_pct)보다 가파르면(양수) 내리막
// 끝이 설계보다 이미 낮으므로 그만큼 "높여야" 하고, 실측이 설계보다 완만하면
// (음수) 내리막 끝이 설계보다 높으므로(배수가 부족하므로) 그만큼 "낮춰야" 한다.
// correction_mm(엔진이 이미 계산한 양단 높이차, mm)을 그대로 크기로 쓴다.
import type { SlopeCellRow } from './types';

const COMPASS: readonly string[] = ['동', '북동', '북', '북서', '서', '남서', '남', '남동'];

/** 라디안(수학 각도, 0=+x=동, 반시계 증가) -> 8방위 한국어 이름.
 * matplotlib/엔진과 동일한 좌표계(y 위로 증가)를 그대로 쓴다 - Canvas 픽셀로
 * 변환하기 전 원본 각도이므로 slope-cells.ts의 y축 반전과 무관하다. */
export function compassLabel(rad: number): string {
  const twoPi = 2 * Math.PI;
  const norm = ((rad % twoPi) + twoPi) % twoPi;
  const idx = Math.round(norm / (Math.PI / 4)) % 8;
  return COMPASS[idx];
}

/** 보정 방향 문구. 계산에 필요한 값(slope_pct·downhill_rad·correction_mm) 중
 * 하나라도 없으면(측정 불가 셀 - ok=false 또는 판정불가) null이다. 호출부가
 * '-'로 대체한다. */
export function correctionDirectionLabel(
  cell: SlopeCellRow,
  correctionMm: number | null,
  designPct: number,
): string | null {
  if (!cell.ok || cell.slope_pct === null || cell.downhill_rad === null || correctionMm === null) {
    return null;
  }
  const dir = compassLabel(cell.downhill_rad);
  const action = cell.slope_pct >= designPct ? '높임' : '낮춤';
  return `${dir}쪽 끝을 ${correctionMm.toFixed(1)}mm ${action}`;
}

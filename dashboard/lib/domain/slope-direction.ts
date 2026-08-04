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
import type { SlopeCellRow, SlopeThreshold } from './types';

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
 * '-'로 대체한다.
 *
 * ★ 코드리뷰 Important-1: reverse(역구배) 셀은 크기 기준 문구를 내지 않는다.
 * 역구배는 물이 배수구 반대로 흐르는 방향 결함이라 크기 편차(correction_mm)와
 * 무관하다 - 크기가 설계와 거의 같으면 correction_mm이 0에 가까워 "동쪽 끝을
 * 0.0mm 높임"처럼 "고칠 것 없음"으로 읽히는 문구가 나온다. 스펙 §7.2가 "역구배는
 * 색만으로 안 드러난다"고 경계한 바로 그 셀에서 이번엔 보정란이 결함을 가리는
 * 셈이므로, reverse면 방향 자체가 틀렸다는 별도 문구로 완전히 대체한다.
 *
 * ★ 코드리뷰 Minor: designPct가 null이면(threshold 결측) 아무 문구도 내지
 * 않는다 - 예전에는 호출부가 `?? 0`으로 기본값을 채워 넘겼는데, 0은 "설계
 * 구배 없음"이 아니라 진짜 값처럼 작동해 slope_pct(항상 0 이상)가 사실상
 * 언제나 0 이상이 되어 버려야 할 셀까지 전부 "높임"으로 뒤집었다. 모르면
 * 틀린 방향을 내느니 아무 말도 안 하는 편이 안전하다. */
export function correctionDirectionLabel(
  cell: SlopeCellRow,
  correctionMm: number | null,
  designPct: number | null,
  reverse: boolean,
): string | null {
  if (!cell.ok || cell.slope_pct === null || cell.downhill_rad === null
      || correctionMm === null || designPct === null) {
    return null;
  }
  if (reverse) return '역구배 - 방향 전면 재시공 필요(크기 보정으로 해결 안 됨)';
  const dir = compassLabel(cell.downhill_rad);
  const action = cell.slope_pct >= designPct ? '높임' : '낮춤';
  return `${dir}쪽 끝을 ${correctionMm.toFixed(1)}mm ${action}`;
}

/** 코드리뷰 I1: 이 기준이 배수 방향을 판정 대상으로 삼는가.
 *
 * ★ 리트머스 대상이 아니다 - 등급(grade)을 계산하지 않는다. "이 기준이 방향을
 * 보는가"라는 UI 가용성 질문에만 쓰인다(클릭 가능 여부 결정). dir_pass_deg가
 * 180 이상(모든 방향 오차를 허용)이거나 design_pct가 0(의도적으로 구배가 없는
 * 바닥, 예: 007_slope_analysis.sql의 slope-indoor-level)이면 배수구를 클릭해도
 * 방향 판정 자체가 무의미하다.
 *
 * 이걸 막지 않으면: 엔진의 역구배 판별(dir_err_deg > 90, engine/flatness/core/
 * slope.py grade_slope_cells)은 dir_pass_deg 설정과 무관하게 하드코딩돼 있어,
 * 방향을 안 보기로 한 기준에서도 배수구를 클릭하면 그대로 발동한다 - 리뷰
 * 실측: 완전히 평탄한 8x8m 바닥(설계 구배 0%)에 배수구를 아무 데나 클릭하니
 * 노이즈만으로 "재시공 5셀"이 나왔다. 결함 없는 바닥이 결함 있는 것처럼
 * 보고되는 조용한 오탐이므로, 애초에 그런 기준에서는 클릭을 막는다. */
export function isDirectionAwareCriteria(threshold: SlopeThreshold | null | undefined): boolean {
  if (!threshold) return true; // 결측 시 기존 동작(클릭 가능) 유지 - 안전한 기본값
  return threshold.dir_pass_deg < 180 && threshold.design_pct !== 0;
}

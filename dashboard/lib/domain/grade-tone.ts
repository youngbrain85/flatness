// 구배 등급 -> 평활도 등급 키 표. 등급을 계산하는 표가 아니다 - 엔진이 낸 등급 문자열의 이름만 바꾼다
// (리트머스: 브라우저 등급 계산 금지).
import type { Grade, SlopeGrade } from './types';

// 다크 C안(스펙 §3): 화면은 3묶음 톤이 아니라 등급 색 다섯을 그대로 쓴다. 구배 등급(엔진 한글 문자열)을
// 평활도 등급 키로 이어 화면 등급 색(GRADE_CLASS·SCREEN_GRADE_COLOR)을 같이 쓰게 하는 표다.
export const SLOPE_GRADE_TO_GRADE: Record<SlopeGrade, Grade> = {
  적합: 'pass',
  경계: 'borderline',
  보수: 'repair',
  재시공: 'rework',
  판정불가: 'na',
};

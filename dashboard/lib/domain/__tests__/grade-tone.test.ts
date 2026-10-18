import { describe, expect, it } from 'vitest';
import { SLOPE_GRADE_TO_GRADE } from '../grade-tone';

// 다크 C안(스펙 §3): 화면은 등급 색 다섯을 그대로 쓴다. 구배 등급(엔진 한글 문자열)을 평활도 등급 키로
// 이어 같은 등급 색(GRADE_CLASS·SCREEN_GRADE_COLOR)을 쓰게 하는 표다.
describe('SLOPE_GRADE_TO_GRADE (다크 C안: 구배 등급 -> 평활도 등급 키)', () => {
  it('구배 5등급을 같은 이름의 평활도 등급 키로 1:1 로 잇는다(3묶음으로 접지 않는다)', () => {
    expect(SLOPE_GRADE_TO_GRADE).toEqual({
      적합: 'pass', 경계: 'borderline', 보수: 'repair', 재시공: 'rework', 판정불가: 'na',
    });
  });
});

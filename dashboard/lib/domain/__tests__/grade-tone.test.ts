import { describe, expect, it } from 'vitest';
import { GRADE_TONE, SLOPE_GRADE_TONE } from '../grade-tone';

// D8 브리프 Step 1: GRADE_COLOR <-> Badge tone 매핑표. app/page.tsx의 toBarCounts와
// 같은 3버킷 규칙(경계=warn, 보수·재시공=fail) 위에 na=unknown을 얹었다(D3에서 확립).
describe('GRADE_TONE (D8: GRADE_COLOR <-> Badge tone 매핑)', () => {
  it('5등급을 4개 Badge tone으로 접는다', () => {
    expect(GRADE_TONE).toEqual({
      pass: 'pass', borderline: 'warn', repair: 'fail', rework: 'fail', na: 'unknown',
    });
  });
});

// T7(Cloudscape): 구배 5등급(한글 문자열)도 같은 3버킷 규칙으로 접는다. SLOPE_GRADE_COLOR(hex)는
// 캔버스·범례 전용이고 화면 배지·StatusIndicator는 이 표로 시스템 색을 얻는다(스펙 §7-4).
describe('SLOPE_GRADE_TONE (T7: 구배 등급 -> tone)', () => {
  it('구배 5등급을 GRADE_TONE과 같은 규칙으로 접는다', () => {
    expect(SLOPE_GRADE_TONE).toEqual({
      적합: 'pass', 경계: 'warn', 보수: 'fail', 재시공: 'fail', 판정불가: 'unknown',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { GRADE_TONE } from '../grade-tone';

// D8 브리프 Step 1: GRADE_COLOR <-> Badge tone 매핑표. app/page.tsx의 toBarCounts와
// 같은 3버킷 규칙(경계=warn, 보수·재시공=fail) 위에 na=unknown을 얹었다(D3에서 확립).
describe('GRADE_TONE (D8: GRADE_COLOR <-> Badge tone 매핑)', () => {
  it('5등급을 4개 Badge tone으로 접는다', () => {
    expect(GRADE_TONE).toEqual({
      pass: 'pass', borderline: 'warn', repair: 'fail', rework: 'fail', na: 'unknown',
    });
  });
});

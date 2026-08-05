import { describe, expect, it } from 'vitest';
import { ANALYSIS_KIND_LABEL, GRADE_COLOR, GRADE_LABEL, fmtMm, warningLabel } from '../labels';

describe('등급 라벨·색상 (stats-schema.md 부록 A와 1:1)', () => {
  it('5등급 한국어 라벨', () => {
    expect(GRADE_LABEL).toEqual({
      pass: '적합', borderline: '경계', repair: '보수', rework: '재시공', na: '판정 불가',
    });
  });
  it('히트맵 5색 hex', () => {
    expect(GRADE_COLOR).toEqual({
      pass: '#2e7d32', borderline: '#f9ab00', repair: '#e8710a', rework: '#c5221f', na: '#9e9e9e',
    });
  });
});

describe('warningLabel', () => {
  it('고정 코드는 한국어 문구로 변환한다', () => {
    expect(warningLabel('low_coverage')).toContain('70%');
    expect(warningLabel('uncertainty_swallows_repair')).toContain('보수 구간');
    expect(warningLabel('uncertainty_swallows_pass')).toContain('적합 판정');
    expect(warningLabel('plumbness_relative_to_z')).toContain('z축');
    // 계보 경고 - 업로드 화면(upload-form.tsx)이 융합 메시 선택자에게 약속한 문구와
    // 같은 사실을 말해야 한다(스캐너 앱 스무딩 -> 실제보다 양호).
    expect(warningLabel('fused_mesh_smoothed')).toContain('융합 메시');
    expect(warningLabel('fused_mesh_smoothed')).toContain('양호한 결과');
  });
  it('wall_{i}_skipped 개방 패턴을 매칭한다', () => {
    expect(warningLabel('wall_3_skipped')).toContain('3번 벽');
  });
  it('모르는 코드는 원문 그대로 반환한다(누락보다 노출이 안전)', () => {
    expect(warningLabel('future_code')).toBe('future_code');
  });
});

describe('ANALYSIS_KIND_LABEL', () => {
  it('구배·평활도 라벨', () => {
    expect(ANALYSIS_KIND_LABEL).toEqual({ flatness: '평활도', slope: '구배' });
  });
});

describe('fmtMm', () => {
  it('null은 하이픈, 수치는 소수 2자리', () => {
    expect(fmtMm(null)).toBe('-');
    expect(fmtMm(7.125)).toBe('7.13');
  });
});

import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_KIND_LABEL, GRADE_COLOR, GRADE_LABEL, LINEAGE_LABEL, REGISTRATION_STATUS_LABEL,
  fmtMm, warningLabel,
} from '../labels';

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

// 설계 결정 F9: 011_register_enums.sql이 data_lineage에 'registered'를 더했다.
// worker/tests/test_report_labels.py가 이 표를 파싱해 워커 사본과 등가 비교하며
// 엔트리 개수(4)까지 단언하므로, 세 곳(워커 report/labels.py · 이 파일 · types.ts)이
// 함께 움직여야 한다.
describe('LINEAGE_LABEL (단계 F: 정합 병합)', () => {
  it('registered = 정합 병합', () => {
    expect(LINEAGE_LABEL).toEqual({
      raw: '원시 점군', fused_mesh: '융합 메시', unknown: '모름', registered: '정합 병합',
    });
  });
});

describe('REGISTRATION_STATUS_LABEL (registration_status enum 5종)', () => {
  it('007이 만든 enum 라벨 다섯 개를 전부 한국어로 옮긴다', () => {
    expect(Object.keys(REGISTRATION_STATUS_LABEL).sort()).toEqual(
      ['awaiting_points', 'done', 'failed', 'processing', 'queued'],
    );
    expect(REGISTRATION_STATUS_LABEL.awaiting_points).toContain('대응점');
  });
});

describe('fmtMm', () => {
  it('null은 하이픈, 수치는 소수 2자리', () => {
    expect(fmtMm(null)).toBe('-');
    expect(fmtMm(7.125)).toBe('7.13');
  });
});

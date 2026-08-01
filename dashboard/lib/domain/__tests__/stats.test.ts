import { describe, expect, it } from 'vitest';
import { coverageLabel, isExternalImport } from '../stats';
import type { Stats } from '../types';

function minimalStats(meta: Record<string, unknown>): Stats {
  return {
    n_cells: 0, n_valid: 0,
    grade_counts: { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 },
    grade_pct: { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 },
    value_max_mm: null, value_min_mm: null, value_mean_mm: null, value_p95_mm: null,
    worst: null, coverage_pct: 0, reduced_span_cells: 0,
    applied_criteria: { name: 'x', source: 'y', span_m: 3, pass_mm: 7, rework_mm: 21, u_mm: 5 },
    warnings: [], zones: [], auto_summary: '',
    meta: { file: 'f', n_points: 0, ...meta } as Stats['meta'],
  };
}

describe('coverage_pct 3중 의미 분기 (stats-schema.md §3)', () => {
  it('floor(LiDAR)는 바닥 인식률', () => {
    expect(coverageLabel(minimalStats({ surface: 'floor' }))).toBe('바닥 인식률');
  });
  it('wall은 셀 유효율', () => {
    expect(coverageLabel(minimalStats({ surface: 'wall' }))).toBe('셀 유효율');
  });
  it('임포트(meta.source 존재)는 surface가 floor여도 셀 유효율', () => {
    expect(coverageLabel(minimalStats({ surface: 'floor', source: 'colab-import' }))).toBe('셀 유효율');
  });
});

describe('isExternalImport', () => {
  it('engine_version external-colab-v1 이면 외부 결과', () => {
    expect(isExternalImport('external-colab-v1')).toBe(true);
  });
  it('engine_version external-json-v1 이면 외부 결과(M2: JSON 임포트도 인식)', () => {
    expect(isExternalImport('external-json-v1')).toBe(true);
  });
  it('meta.source가 있으면 외부 결과', () => {
    expect(isExternalImport('p1d-0.4.0', { file: 'f', n_points: 1, source: 'colab-import' })).toBe(true);
  });
  it('meta가 비어도 engine_version external-json-v1이면 외부 결과로 판별(meta 미채움 방어)', () => {
    expect(isExternalImport('external-json-v1', undefined)).toBe(true);
  });
  it('LiDAR 원본은 외부 결과 아님', () => {
    expect(isExternalImport('p1d-0.4.0', { file: 'f', n_points: 1 })).toBe(false);
  });
});

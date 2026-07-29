import { describe, expect, it } from 'vitest';
import { groupCriteria, thresholdSummary } from '../criteria';
import type { CriteriaRow } from '../types';

const crit = (over: Partial<CriteriaRow>): CriteriaRow => ({
  id: 'c', site_id: null, surface: 'floor', name: 'n', source_text: 's',
  thresholds: [{ span_m: 3, metric: 'flatness', pass_mm: 7, rework_mm: 21 }],
  is_default: false, is_active: true, version: 1, supersedes_id: null, created_at: '', ...over,
});

describe('thresholdSummary', () => {
  it('flatness: 스팬당 허용/재시공', () => {
    expect(thresholdSummary({ span_m: 3, metric: 'flatness', pass_mm: 7, rework_mm: 21 }))
      .toBe('3m당 허용 7mm / 재시공 21mm');
  });
  it('plumbness(span null): 수직도 표기', () => {
    expect(thresholdSummary({ span_m: null, metric: 'plumbness', pass_mm: 25, rework_mm: 75 }))
      .toBe('수직도 허용 25mm / 재시공 75mm');
  });
});

describe('groupCriteria (전역/현장 분리)', () => {
  it('site_id null은 global, 나머지는 site별 Map', () => {
    const rows = [crit({ id: 'g1' }), crit({ id: 's1a', site_id: 's1' }), crit({ id: 's1b', site_id: 's1' })];
    const g = groupCriteria(rows);
    expect(g.global.map((c) => c.id)).toEqual(['g1']);
    expect(g.bySite.get('s1')!.map((c) => c.id)).toEqual(['s1a', 's1b']);
  });
});

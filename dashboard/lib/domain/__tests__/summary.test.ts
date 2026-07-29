import { describe, expect, it } from 'vitest';
import { buildSiteSummaries } from '../summary';
import type { SiteRow } from '../types';

const site = (id: string, name: string): SiteRow =>
  ({ id, name, address: null, memo: null, created_at: '', updated_at: '' });

describe('buildSiteSummaries (홈 카드: 최근 측정일·측정위치 수·판정 분포)', () => {
  it('현장별로 위치 수·최근 측정일·현재 분석 판정 분포를 집계한다', () => {
    const sites = [site('s1', '현장A'), site('s2', '현장B')];
    const locations = [
      { id: 'l1', site_id: 's1' }, { id: 'l2', site_id: 's1' }, { id: 'l3', site_id: 's2' },
    ];
    const scans = [
      { id: 'c1', scanned_at: '2026-07-01', location_id: 'l1' },
      { id: 'c2', scanned_at: '2026-07-20', location_id: 'l2' },
      { id: 'c3', scanned_at: '2026-06-15', location_id: 'l3' },
    ];
    const analyses = [
      { scan_id: 'c1', overall_verdict: 'pass' as const },
      { scan_id: 'c2', overall_verdict: 'repair' as const },
      { scan_id: 'c3', overall_verdict: null },
    ];
    const [a, b] = buildSiteSummaries(sites, locations, scans, analyses);
    expect(a.locationCount).toBe(2);
    expect(a.lastScannedAt).toBe('2026-07-20');
    expect(a.verdictCounts).toEqual({ pass: 1, borderline: 0, repair: 1, rework: 0 });
    expect(b.lastScannedAt).toBe('2026-06-15');
    expect(b.verdictCounts).toEqual({ pass: 0, borderline: 0, repair: 0, rework: 0 });
  });
  it('스캔이 없는 현장은 lastScannedAt null', () => {
    const [a] = buildSiteSummaries([site('s1', 'A')], [], [], []);
    expect(a.lastScannedAt).toBeNull();
    expect(a.locationCount).toBe(0);
  });
});

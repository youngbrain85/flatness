import { describe, expect, it } from 'vitest';
import { buildSiteSummaries, countInProgress } from '../summary';
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
      { scan_id: 'c1', status: 'done' as const, overall_verdict: 'pass' as const },
      { scan_id: 'c2', status: 'done' as const, overall_verdict: 'repair' as const },
      { scan_id: 'c3', status: 'done' as const, overall_verdict: null },
    ];
    const [a, b] = buildSiteSummaries(sites, locations, scans, analyses);
    expect(a.locationCount).toBe(2);
    expect(a.lastScannedAt).toBe('2026-07-20');
    expect(a.verdictCounts).toEqual({ pass: 1, borderline: 0, repair: 1, rework: 0 });
    expect(a.naCount).toBe(0);
    expect(b.lastScannedAt).toBe('2026-06-15');
    expect(b.verdictCounts).toEqual({ pass: 0, borderline: 0, repair: 0, rework: 0 });
    expect(b.naCount).toBe(1); // c3: status=done인데 overall_verdict null -> 판정 불가
  });
  it('스캔이 없는 현장은 lastScannedAt null', () => {
    const [a] = buildSiteSummaries([site('s1', 'A')], [], [], []);
    expect(a.lastScannedAt).toBeNull();
    expect(a.locationCount).toBe(0);
    expect(a.naCount).toBe(0);
  });
  it('status=done이 아닌(queued/processing/failed) overall_verdict null 분석은 naCount에 잡히지 않는다', () => {
    const sites = [site('s1', '현장A')];
    const locations = [{ id: 'l1', site_id: 's1' }];
    const scans = [
      { id: 'c1', scanned_at: '2026-07-01', location_id: 'l1' },
      { id: 'c2', scanned_at: '2026-07-02', location_id: 'l1' },
    ];
    const analyses = [
      { scan_id: 'c1', status: 'queued' as const, overall_verdict: null },
      { scan_id: 'c2', status: 'failed' as const, overall_verdict: null },
    ];
    const [a] = buildSiteSummaries(sites, locations, scans, analyses);
    expect(a.naCount).toBe(0); // "판정 불가"는 done인데 verdict가 null인 경우만 - 미분석·실패는 별개
  });
  it('현장별 스캔 건수를 scanCount로 집계한다', () => {
    const sites = [site('s1', '현장A'), site('s2', '현장B')];
    const locations = [
      { id: 'l1', site_id: 's1' }, { id: 'l2', site_id: 's1' }, { id: 'l3', site_id: 's2' },
    ];
    const scans = [
      { id: 'c1', scanned_at: '2026-07-01', location_id: 'l1' },
      { id: 'c2', scanned_at: '2026-07-20', location_id: 'l2' },
      { id: 'c3', scanned_at: '2026-06-15', location_id: 'l3' },
    ];
    const [a, b] = buildSiteSummaries(sites, locations, scans, []);
    expect(a.scanCount).toBe(2);
    expect(b.scanCount).toBe(1);
  });
});

describe('countInProgress (홈 지표 스트립: 처리 중 건수)', () => {
  it('queued·processing만 센다', () => {
    expect(countInProgress([
      { status: 'queued' }, { status: 'processing' }, { status: 'done' }, { status: 'failed' },
    ])).toBe(2);
  });
  it('빈 배열은 0', () => { expect(countInProgress([])).toBe(0); });
});

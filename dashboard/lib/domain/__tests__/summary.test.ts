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
    // currentAnalyses의 queued는 inProgressCount와 무관하다 - 처리 중은 다섯 번째 인자만 본다
    expect(a.inProgressCount).toBe(0);
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
  it('처리 중 분석(다섯 번째 인자)을 scan_id -> 현장 맵으로 현장별 inProgressCount에 집계한다', () => {
    const sites = [site('s1', '현장A'), site('s2', '현장B')];
    const locations = [{ id: 'l1', site_id: 's1' }, { id: 'l2', site_id: 's2' }];
    const scans = [
      { id: 'c1', scanned_at: '2026-07-01', location_id: 'l1' },
      { id: 'c2', scanned_at: '2026-07-02', location_id: 'l1' },
      { id: 'c3', scanned_at: '2026-07-03', location_id: 'l2' },
    ];
    // c2는 평활도·구배 두 건이 동시에 처리 중일 수 있다(kind 무필터 - 두 번 센다).
    // 'ghost'는 어느 현장의 스캔도 아니다(삭제된 스캔의 잔여 분석 등) - 어디에도 잡히지 않아야 한다.
    const inProgress = [{ scan_id: 'c1' }, { scan_id: 'c2' }, { scan_id: 'c2' }, { scan_id: 'c3' }, { scan_id: 'ghost' }];
    const [a, b] = buildSiteSummaries(sites, locations, scans, [], inProgress);
    expect(a.inProgressCount).toBe(3);
    expect(b.inProgressCount).toBe(1);
  });
  it('inProgress 인자를 생략하면 inProgressCount는 0이고 나머지 집계는 그대로다(무변이 대조군)', () => {
    const sites = [site('s1', '현장A')];
    const locations = [{ id: 'l1', site_id: 's1' }, { id: 'l2', site_id: 's1' }];
    const scans = [
      { id: 'c1', scanned_at: '2026-07-01', location_id: 'l1' },
      { id: 'c2', scanned_at: '2026-07-20', location_id: 'l2' },
    ];
    const analyses = [
      { scan_id: 'c1', status: 'done' as const, overall_verdict: 'pass' as const },
      { scan_id: 'c2', status: 'done' as const, overall_verdict: null },
    ];
    const omitted = buildSiteSummaries(sites, locations, scans, analyses);
    // 기존 4인자 호출 == 빈 배열을 준 5인자 호출. 결과 전체를 대조해 다른 필드가 흔들리지 않았음을 본다.
    expect(omitted).toEqual(buildSiteSummaries(sites, locations, scans, analyses, []));
    expect(omitted[0]).toEqual({
      site: sites[0], locationCount: 2, scanCount: 2, lastScannedAt: '2026-07-20',
      verdictCounts: { pass: 1, borderline: 0, repair: 0, rework: 0 }, naCount: 1,
      inProgressCount: 0,
    });
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

// buildSiteDashboard(현장 대시보드 집계, 스펙 §5 03): KPI 정의, 판정 현황 격자(동 → 층 → 타일),
// 할 일 순서, 최근 보고서. 등급은 계산하지 않고 엔진의 overall_verdict만 센다.
import { describe, expect, it } from 'vitest';
import { SCAN_STATUS_TYPE } from '@/components/ui/status-indicator';
import { SCAN_STATUS_LABEL } from '../labels';
import {
  buildSiteDashboard, GRID_TILE_LIMIT, RECENT_REPORT_LIMIT,
  type DashAnalysis, type DashCurrentAnalysis, type DashReport, type DashScan, type SiteDashboard,
  type SiteDashboardInput,
} from '../site-dashboard';
import type { AnalysisKind, AnalysisStatus, LocationRow, ScanStatus, Verdict } from '../types';

const loc = (id: string, over: Partial<LocationRow> = {}): LocationRow => ({
  id, site_id: 's1', building: '101동', floor: '5층', floor_order: 5, room: '', name: id,
  memo: null, created_at: '2026-08-01T00:00:00+00:00', updated_at: '', ...over,
});
const scan = (id: string, locationId: string, scannedAt: string, over: Partial<DashScan> = {}): DashScan => ({
  id, location_id: locationId, surface: 'floor', scanned_at: scannedAt, status: 'ready',
  created_at: `${scannedAt}T09:00:00+00:00`, ...over,
});
const current = (scanId: string, verdict: Verdict | null, over: Partial<DashCurrentAnalysis> = {}): DashCurrentAnalysis => ({
  scan_id: scanId, status: 'done', overall_verdict: verdict, kind: 'flatness', ...over,
});
const attempt = (scanId: string, status: AnalysisStatus, createdAt: string, kind: AnalysisKind = 'flatness'): DashAnalysis => ({
  scan_id: scanId, kind, status, created_at: createdAt,
});
const report = (id: string, locationId: string, createdAt: string, over: Partial<DashReport> = {}): DashReport => ({
  id, location_id: locationId, title: `${id} 평활도 보고서`, status: 'draft', gen_status: 'done', created_at: createdAt, ...over,
});

function build(over: Partial<SiteDashboardInput> = {}): SiteDashboard {
  return buildSiteDashboard({
    siteId: 's1', locations: [], scans: [], currentAnalyses: [], analyses: [], reports: [], ...over,
  });
}
const tiles = (d: SiteDashboard) => d.grid.flatMap((b) => b.floors.flatMap((f) => f.tiles));
const tileOf = (d: SiteDashboard, locationId: string) => tiles(d).find((t) => t.locationId === locationId)!;

describe('buildSiteDashboard: 빈 현장', () => {
  it('측정위치가 없으면 KPI는 0, 최근 활동은 null, 격자·할 일·최근 보고서는 비고 할 일 안내 문구를 보인다', () => {
    expect(build()).toEqual({
      kpi: {
        locationCount: 0, scanCount: 0, doneCount: 0, bar: { pass: 0, warn: 0, fail: 0 }, naCount: 0,
        inProgressCount: 0, reportCount: 0, lastScannedAt: null,
      },
      grid: [], hiddenTileCount: 0, todos: [], noScanAttention: true, recentReports: [],
    });
  });

  it('스캔이 없는 측정위치 타일은 미분석 · "스캔 없음"이고 측정위치 탭의 그 줄(#loc-<id>)로 간다', () => {
    const d = build({ locations: [loc('l1', { room: '501호', name: '거실' })] });
    expect(tileOf(d, 'l1')).toEqual({
      locationId: 'l1', label: '501호 · 거실', href: '/sites/s1/locations#loc-l1', scanCount: 0,
      grade: null, gradeScanDate: null, latestScanDate: null, state: { type: 'pending', label: '스캔 없음' },
    });
    expect(d.kpi.locationCount).toBe(1);
  });
});

describe('buildSiteDashboard: KPI 정의(스펙 §5 03)', () => {
  it('측정위치 · 스캔 · 분석 완료(판정 불가 포함) · 분포 3묶음 · 판정 불가 · 처리 중(종류 무관) · 보고서(상태 무관) · 최근 활동', () => {
    const d = build({
      locations: [loc('l1'), loc('l2')],
      scans: [
        scan('c1', 'l1', '2026-08-28'), scan('c2', 'l1', '2026-09-03'), scan('c3', 'l2', '2026-09-01'),
        scan('c4', 'l2', '2026-09-02'), scan('c5', 'l2', '2026-08-01'),
      ],
      currentAnalyses: [
        current('c1', 'pass'), current('c2', 'borderline'), current('c3', 'repair'), current('c4', 'rework'),
        current('c5', null),
      ],
      analyses: [
        attempt('c2', 'queued', '2026-09-03T10:00:00+00:00', 'slope'),
        attempt('c3', 'processing', '2026-09-03T11:00:00+00:00'),
        attempt('c4', 'done', '2026-09-02T10:00:00+00:00'),
        attempt('c5', 'failed', '2026-08-01T10:00:00+00:00', 'slope'),
      ],
      reports: [
        report('r1', 'l1', '2026-09-01T00:00:00+00:00'),
        report('r2', 'l1', '2026-09-02T00:00:00+00:00', { status: 'finalized' }),
        report('r3', 'l2', '2026-09-03T00:00:00+00:00', { gen_status: 'failed' }),
      ],
    });
    expect(d.kpi).toEqual({
      locationCount: 2,
      scanCount: 5,
      doneCount: 5,
      // 적합 1 · 경계 1 · 보수·재시공 2(보수 1 + 재시공 1). 판정 불가 1은 분포 바에 들지 않는다
      bar: { pass: 1, warn: 1, fail: 2 },
      naCount: 1,
      // queued(구배) + processing(평활도). done·failed는 처리 중이 아니다
      inProgressCount: 2,
      reportCount: 3,
      lastScannedAt: '2026-09-03',
    });
  });

  it('구배(kind=slope) 현재 분석이 섞여 들어와도 판정 집계에 넣지 않는다(단계 C 2배 계상 사고)', () => {
    const d = build({
      locations: [loc('l1')],
      scans: [scan('c1', 'l1', '2026-09-03')],
      currentAnalyses: [current('c1', 'pass'), current('c1', 'rework', { kind: 'slope' })],
    });
    expect(d.kpi.doneCount).toBe(1);
    expect(d.kpi.bar).toEqual({ pass: 1, warn: 0, fail: 0 });
    expect(tileOf(d, 'l1').grade).toBe('pass');
  });

  it('현재 분석이 done이 아니면 분석 완료·분포·판정 불가 어디에도 넣지 않는다', () => {
    const d = build({
      locations: [loc('l1')],
      scans: [scan('c1', 'l1', '2026-09-03')],
      currentAnalyses: [current('c1', null, { status: 'processing' })],
    });
    expect(d.kpi.doneCount).toBe(0);
    expect(d.kpi.naCount).toBe(0);
    expect(tileOf(d, 'l1').grade).toBeNull();
  });

  it('이 현장 측정위치의 것이 아닌 스캔·분석·보고서는 세지 않는다', () => {
    const d = build({
      locations: [loc('l1')],
      scans: [scan('c1', 'l1', '2026-09-01'), scan('x1', 'other', '2026-09-05')],
      currentAnalyses: [current('x1', 'rework')],
      analyses: [attempt('x1', 'queued', '2026-09-05T10:00:00+00:00')],
      reports: [report('rx', 'other', '2026-09-05T00:00:00+00:00', { gen_status: 'failed' })],
    });
    expect(d.kpi).toMatchObject({
      scanCount: 1, doneCount: 0, inProgressCount: 0, reportCount: 0, lastScannedAt: '2026-09-01',
    });
    expect(d.todos).toEqual([]);
  });
});

describe('buildSiteDashboard: 판정 현황 타일', () => {
  it('최근 스캔의 현재 평활도 판정을 쓰고, 타일 전체가 그 최근 스캔으로 간다', () => {
    const d = build({
      locations: [loc('l1', { room: '501호', name: '거실' })],
      scans: [scan('c1', 'l1', '2026-08-28'), scan('c2', 'l1', '2026-09-03')],
      currentAnalyses: [current('c1', 'pass'), current('c2', 'rework')],
    });
    expect(tileOf(d, 'l1')).toEqual({
      locationId: 'l1', label: '501호 · 거실', href: '/scans/c2', scanCount: 2, grade: 'rework',
      gradeScanDate: null, latestScanDate: '2026-09-03', state: { type: 'success', label: '분석 완료' },
    });
  });

  it('최근 스캔이 아직 분석 전이면 앞선 스캔의 판정을 쓰고 그 스캔 날짜를 남긴다(아트보드 "2026-08-29 스캔")', () => {
    const d = build({
      locations: [loc('l1')],
      scans: [scan('c1', 'l1', '2026-08-29'), scan('c2', 'l1', '2026-09-03')],
      currentAnalyses: [current('c1', 'pass')],
      analyses: [attempt('c2', 'queued', '2026-09-03T10:00:00+00:00')],
    });
    const t = tileOf(d, 'l1');
    expect(t.grade).toBe('pass');
    expect(t.gradeScanDate).toBe('2026-08-29');
    expect(t.href).toBe('/scans/c2');
    expect(t.latestScanDate).toBe('2026-09-03');
    expect(t.state).toEqual({ type: 'in-progress', label: '분석 대기 중' });
  });

  it('done인데 overall_verdict가 null이면 판정 불가(na)다', () => {
    const d = build({
      locations: [loc('l1')], scans: [scan('c1', 'l1', '2026-09-03')], currentAnalyses: [current('c1', null)],
    });
    expect(tileOf(d, 'l1').grade).toBe('na');
    expect(d.kpi.naCount).toBe(1);
  });

  it('처리 중이면 고리(in-progress): 종류를 가리지 않고, processing이 queued보다 앞선다', () => {
    const d = build({
      locations: [loc('l1')],
      scans: [scan('c1', 'l1', '2026-09-03')],
      currentAnalyses: [current('c1', 'pass')],
      // processing이 먼저 와도 뒤의 queued가 덮어쓰지 않아야 한다(행 순서와 무관)
      analyses: [
        attempt('c1', 'processing', '2026-09-03T10:05:00+00:00', 'slope'),
        attempt('c1', 'queued', '2026-09-03T10:00:00+00:00'),
      ],
    });
    expect(tileOf(d, 'l1').state).toEqual({ type: 'in-progress', label: '분석 중' });
    // 판정은 그대로 현재 평활도 분석의 것이다
    expect(tileOf(d, 'l1').grade).toBe('pass');
  });

  it('사전 검사를 기다리는 업로드 스캔은 미분석 · 업로드됨(in-progress)이다', () => {
    const d = build({ locations: [loc('l1')], scans: [scan('c1', 'l1', '2026-09-03', { status: 'uploaded' })] });
    expect(tileOf(d, 'l1').grade).toBeNull();
    expect(tileOf(d, 'l1').state).toEqual({ type: 'in-progress', label: '업로드됨' });
  });

  it('스캔 실패와 평활도 최근 시도 실패는 error다. 다시 돌려 성공했거나 구배만 실패했으면 분석 완료다', () => {
    const d = build({
      locations: [loc('l1'), loc('l2'), loc('l3'), loc('l4')],
      scans: [
        scan('c1', 'l1', '2026-09-01', { status: 'failed' }), scan('c2', 'l2', '2026-09-01'),
        scan('c3', 'l3', '2026-09-01'), scan('c4', 'l4', '2026-09-01'),
      ],
      currentAnalyses: [current('c3', 'pass'), current('c4', 'borderline')],
      analyses: [
        attempt('c2', 'failed', '2026-09-01T10:00:00+00:00'),
        attempt('c3', 'failed', '2026-09-01T10:00:00+00:00'),
        attempt('c3', 'done', '2026-09-01T11:00:00+00:00'),
        attempt('c4', 'done', '2026-09-01T10:00:00+00:00'),
        attempt('c4', 'failed', '2026-09-01T11:00:00+00:00', 'slope'),
      ],
    });
    expect(tileOf(d, 'l1').state).toEqual({ type: 'error', label: '스캔 실패' });
    expect(tileOf(d, 'l2').state).toEqual({ type: 'error', label: '분석 실패' });
    expect(tileOf(d, 'l3').state).toEqual({ type: 'success', label: '분석 완료' });
    expect(tileOf(d, 'l4').state).toEqual({ type: 'success', label: '분석 완료' });
  });

  it.each<ScanStatus>(['uploaded', 'awaiting_unit_confirm', 'archived'])(
    '분석이 없는 %s 스캔의 표시는 SCAN_STATUS_TYPE·SCAN_STATUS_LABEL과 같다(같은 스캔, 같은 점)',
    (status) => {
      const d = build({ locations: [loc('l1')], scans: [scan('c1', 'l1', '2026-09-03', { status })] });
      expect(tileOf(d, 'l1').state).toEqual({ type: SCAN_STATUS_TYPE[status], label: SCAN_STATUS_LABEL[status] });
    },
  );

  // 아트보드가 이긴다(스펙 §2): DashStatus.dc.html 136~146행의 "분석 준비됨" 타일은 속 빈 고리이고(94~96행 범례
  // "새 스캔 ○ 처리 중"), 측정위치 트리(location-tree.tsx treeScanStatusType)와 SiteDetail.dc.html 93행도 고리다.
  // 그래서 ready 는 위 표(SCAN_STATUS_TYPE, 초록 점)와 다르다. 스캔 화면의 '상태' 칸만 초록 점 그대로다.
  it("분석 없는 ready 스캔은 트리와 같이 고리(in-progress) '분석 준비됨'", () => {
    const d = build({ locations: [loc('l1')], scans: [scan('c1', 'l1', '2026-09-03', { status: 'ready' })] });
    expect(tileOf(d, 'l1').state).toEqual({ type: 'in-progress', label: '분석 준비됨' });
  });

  it('실패한 스캔의 점 종류도 SCAN_STATUS_TYPE과 같다(문구만 "스캔 실패"로 풀어 쓴다)', () => {
    const d = build({ locations: [loc('l1')], scans: [scan('c1', 'l1', '2026-09-03', { status: 'failed' })] });
    expect(tileOf(d, 'l1').state.type).toBe(SCAN_STATUS_TYPE.failed);
  });

  it('같은 날 스캔이 둘이면 나중에 올린(created_at) 스캔이 최근이다', () => {
    const d = build({
      locations: [loc('l1')],
      scans: [
        scan('c2', 'l1', '2026-09-03', { created_at: '2026-09-03T15:00:00+00:00' }),
        scan('c1', 'l1', '2026-09-03', { created_at: '2026-09-03T09:00:00+00:00' }),
      ],
    });
    expect(tileOf(d, 'l1').href).toBe('/scans/c2');
  });

  // 위 테스트는 입력이 이미 "나중에 올린 순"이라 동률 규칙이 없어도 통과한다(정렬이 안정적이라 입력 순서가
  // 그대로 남는다). 입력을 반대로 줘도 같은 결과여야 created_at 동률 규칙을 실제로 쓰는 것이다.
  it('같은 날 동률은 입력 순서와 무관하다(먼저 올린 스캔이 앞에 와도 나중에 올린 스캔이 최근이다)', () => {
    const d = build({
      locations: [loc('l1')],
      scans: [
        scan('c1', 'l1', '2026-09-03', { created_at: '2026-09-03T09:00:00+00:00' }),
        scan('c2', 'l1', '2026-09-03', { created_at: '2026-09-03T15:00:00+00:00' }),
      ],
    });
    expect(tileOf(d, 'l1').href).toBe('/scans/c2');
  });

  it('촬영일(scanned_at)이 기준이다: 늦게 올라온 옛 스캔이 최근 스캔을 밀어내지 못하고, 날짜도 올린 날이 아니라 촬영일이다', () => {
    const d = build({
      locations: [loc('l1', { room: '501호', name: '거실' })],
      scans: [
        // 9/3에 찍어 9/5에 올린 스캔(단위 확인 대기) / 8/20에 찍어 9/10에 늦게 올린 옛 스캔
        scan('a', 'l1', '2026-09-03', { status: 'awaiting_unit_confirm', created_at: '2026-09-05T09:00:00+00:00' }),
        scan('b', 'l1', '2026-08-20', { created_at: '2026-09-10T09:00:00+00:00' }),
      ],
    });
    const t = tileOf(d, 'l1');
    expect(t.href).toBe('/scans/a');
    expect(t.latestScanDate).toBe('2026-09-03');
    expect(d.kpi.lastScannedAt).toBe('2026-09-03');
    expect(d.todos.map((x) => [x.key, x.date])).toEqual([['awaiting_unit:a', '2026-09-03']]);
  });

  it('바닥 줄 우선순위: 처리 중 > 스캔 실패 > 평활도 최근 시도 실패 > 분석 완료(재분석이 실패하면 이전 판정은 남고 줄은 분석 실패다)', () => {
    const d = build({
      locations: [loc('l1'), loc('l2'), loc('l3')],
      scans: [
        scan('c1', 'l1', '2026-09-01', { status: 'failed' }),
        scan('c2', 'l2', '2026-09-01', { status: 'failed' }),
        scan('c3', 'l3', '2026-09-01'),
      ],
      currentAnalyses: [current('c3', 'pass')],
      analyses: [
        attempt('c1', 'queued', '2026-09-01T10:00:00+00:00'),
        attempt('c2', 'failed', '2026-09-01T10:00:00+00:00'),
        attempt('c3', 'done', '2026-09-01T09:00:00+00:00'),
        attempt('c3', 'failed', '2026-09-01T10:00:00+00:00'),
      ],
    });
    // 스캔이 실패로 찍혀 있어도 분석이 돌고 있으면 처리 중이 먼저다
    expect(tileOf(d, 'l1').state).toEqual({ type: 'in-progress', label: '분석 대기 중' });
    // 스캔 실패와 분석 실패가 겹치면 스캔 실패가 먼저다
    expect(tileOf(d, 'l2').state).toEqual({ type: 'error', label: '스캔 실패' });
    // 현재 분석이 done이어도 가장 최근 시도가 실패면 분석 실패다(판정은 현재 분석의 것이 남는다)
    expect(tileOf(d, 'l3').state).toEqual({ type: 'error', label: '분석 실패' });
    expect(tileOf(d, 'l3').grade).toBe('pass');
  });

  it('타일의 스캔 수는 그 측정위치의 스캔 수다(현장 전체 스캔 수가 아니다)', () => {
    const d = build({
      locations: [loc('l1'), loc('l2')],
      scans: [
        scan('c1', 'l1', '2026-09-01'), scan('c2', 'l1', '2026-09-02'), scan('c3', 'l1', '2026-09-03'),
        scan('c4', 'l2', '2026-09-03'),
      ],
    });
    expect(tileOf(d, 'l1').scanCount).toBe(3);
    expect(tileOf(d, 'l2').scanCount).toBe(1);
  });
});

describe('buildSiteDashboard: 격자 배치(동 → 층 floor_order → 공간 · 이름)', () => {
  it('동은 이름 순, 층은 floor_order 내림차순(높은 층 먼저), 타일은 공간 · 이름 순이고 공간이 없으면 이름만 쓴다', () => {
    const d = build({
      locations: [
        loc('a', { building: '102동', floor: '3층', floor_order: 3, room: '301호', name: '거실' }),
        loc('b', { building: '101동', floor: '3층', floor_order: 3, room: '302호', name: '거실' }),
        loc('c', { building: '101동', floor: '5층', floor_order: 5, room: '501호', name: '거실' }),
        loc('d', { building: '101동', floor: '5층', floor_order: 5, room: '', name: '복도' }),
        loc('e', { building: '101동', floor: '3층', floor_order: 3, room: '301호', name: '거실' }),
      ],
    });
    expect(d.grid.map((b) => ({
      building: b.building,
      floors: b.floors.map((f) => ({ floor: f.floor, tiles: f.tiles.map((t) => t.label) })),
    }))).toEqual([
      {
        building: '101동',
        floors: [
          { floor: '5층', tiles: ['복도', '501호 · 거실'] },
          { floor: '3층', tiles: ['301호 · 거실', '302호 · 거실'] },
        ],
      },
      { building: '102동', floors: [{ floor: '3층', tiles: ['301호 · 거실'] }] },
    ]);
    expect(d.hiddenTileCount).toBe(0);
  });

  it(`상한(${GRID_TILE_LIMIT}곳)을 넘으면 최근에 스캔한 측정위치부터 올리고 나머지 수를 hiddenTileCount로 낸다`, () => {
    const day = (i: number) => `2026-08-${String(i + 1).padStart(2, '0')}`;
    const ids = Array.from({ length: GRID_TILE_LIMIT + 2 }, (_, i) => `L${String(i).padStart(2, '0')}`);
    const d = build({
      locations: ids.map((id) => loc(id)),
      // L00이 가장 오래, 마지막이 가장 최근에 스캔했다
      scans: ids.map((id, i) => scan(`c-${id}`, id, day(i))),
    });
    expect(d.hiddenTileCount).toBe(2);
    const shown = tiles(d).map((t) => t.locationId);
    expect(shown).toHaveLength(GRID_TILE_LIMIT);
    expect(shown).not.toContain('L00');
    expect(shown).not.toContain('L01');
  });

  it('스캔한 곳을 먼저 올리고, 스캔이 없는 곳끼리는 최근 등록 순으로 남은 자리를 채운다', () => {
    const scanned = Array.from({ length: GRID_TILE_LIMIT - 2 }, (_, i) => `S${String(i).padStart(2, '0')}`);
    const unscanned = ['U1', 'U2', 'U3', 'U4'];
    const d = build({
      locations: [
        ...scanned.map((id) => loc(id)),
        ...unscanned.map((id, i) => loc(id, { created_at: `2026-08-0${i + 1}T00:00:00+00:00` })),
      ],
      scans: scanned.map((id) => scan(`c-${id}`, id, '2026-09-01')),
    });
    const shown = tiles(d).map((t) => t.locationId);
    expect(d.hiddenTileCount).toBe(2);
    expect(shown).toEqual(expect.arrayContaining([...scanned, 'U3', 'U4']));
    expect(shown).not.toContain('U1');
    expect(shown).not.toContain('U2');
  });

  // 위 테스트들은 상수로 개수를 만들어 상수 값이 바뀌어도 통과한다 - 집계 규칙이 정한 값을 여기서 못 박는다
  it('격자에 올리는 상한은 24곳, 최근 보고서는 5건이다', () => {
    expect(GRID_TILE_LIMIT).toBe(24);
    expect(RECENT_REPORT_LIMIT).toBe(5);
  });
});

describe('buildSiteDashboard: 할 일(단위 확인 대기 → 실패 → 보고서 생성 실패 → 처리 중)', () => {
  const l502 = loc('l1', { building: '101동', floor: '5층', room: '502호', name: '거실' });
  const l301 = loc('l2', { building: '101동', floor: '3층', floor_order: 3, room: '301호', name: '거실' });

  it('종류 순서를 지키고, 줄마다 상태 문구 · 측정위치 · 표면 · 날짜 · 열기 링크 · 읽을 이름을 준다', () => {
    const d = build({
      locations: [l502, l301],
      scans: [
        scan('p1', 'l1', '2026-09-03', { status: 'uploaded' }),
        scan('a1', 'l1', '2026-09-02', { status: 'awaiting_unit_confirm' }),
        scan('f1', 'l2', '2026-09-01', { status: 'failed' }),
        scan('g1', 'l2', '2026-08-30'),
        scan('q1', 'l2', '2026-08-29', { surface: 'wall' }),
      ],
      analyses: [
        attempt('g1', 'failed', '2026-08-30T10:00:00+00:00'),
        attempt('q1', 'processing', '2026-08-29T10:00:00+00:00'),
      ],
      reports: [
        report('rf', 'l2', '2026-08-30T12:00:00+00:00', { title: '101동 301호 평활도 보고서', gen_status: 'failed' }),
        // 발행본의 gen_status=failed는 잔재 정보라 할 일이 아니다
        report('rd', 'l2', '2026-08-31T12:00:00+00:00', { status: 'finalized', gen_status: 'failed' }),
      ],
    });
    expect(d.todos.map((t) => t.kind)).toEqual([
      'awaiting_unit', 'scan_failed', 'analysis_failed', 'report_failed', 'scan_processing', 'analysis_processing',
    ]);
    expect(d.todos[0]).toEqual({
      kind: 'awaiting_unit', key: 'awaiting_unit:a1', type: 'pending', label: '단위 확인 대기',
      title: '101동 · 5층 · 502호 · 거실', detail: '바닥', date: '2026-09-02', href: '/scans/a1',
      ariaLabel: '101동 5층 502호 거실 스캔 열기',
    });
    expect(d.todos.map((t) => [t.label, t.type, t.href])).toEqual([
      ['단위 확인 대기', 'pending', '/scans/a1'],
      ['스캔 실패', 'error', '/scans/f1'],
      ['분석 실패', 'error', '/scans/g1'],
      ['생성 실패', 'error', '/reports/rf'],
      ['업로드됨', 'in-progress', '/scans/p1'],
      ['분석 중', 'in-progress', '/scans/q1'],
    ]);
    expect(d.todos[3]).toMatchObject({
      title: '101동 301호 평활도 보고서', detail: '101동 · 3층 · 301호 · 거실', date: '2026-08-30',
      ariaLabel: '101동 301호 평활도 보고서 열기',
    });
    expect(d.todos[5].detail).toBe('벽면');
    expect(d.noScanAttention).toBe(false);
  });

  it('같은 종류 안에서는 최근 스캔이 먼저다', () => {
    const d = build({
      locations: [l502],
      scans: [
        scan('old', 'l1', '2026-09-01', { status: 'awaiting_unit_confirm' }),
        scan('new', 'l1', '2026-09-03', { status: 'awaiting_unit_confirm' }),
      ],
    });
    expect(d.todos.map((t) => t.key)).toEqual(['awaiting_unit:new', 'awaiting_unit:old']);
  });

  it('평활도·구배가 함께 실패하면 두 줄이고, 함께 처리 중이면 한 줄이다(KPI 처리 중은 분석 건수라 2)', () => {
    const d = build({
      locations: [l502],
      scans: [scan('s1', 'l1', '2026-09-02'), scan('s2', 'l1', '2026-09-01')],
      analyses: [
        attempt('s1', 'failed', '2026-09-02T10:00:00+00:00'),
        attempt('s1', 'failed', '2026-09-02T11:00:00+00:00', 'slope'),
        attempt('s2', 'processing', '2026-09-01T10:01:00+00:00', 'slope'),
        attempt('s2', 'queued', '2026-09-01T10:00:00+00:00'),
      ],
    });
    expect(d.todos.map((t) => [t.key, t.label])).toEqual([
      ['analysis_failed:s1:flatness', '분석 실패'],
      ['analysis_failed:s1:slope', '구배 분석 실패'],
      ['analysis_processing:s2', '분석 중'],
    ]);
    expect(d.kpi.inProgressCount).toBe(2);
  });

  it('실패한 시도를 다시 돌려 성공했으면(최근 시도 done) 할 일에서 빠진다', () => {
    const d = build({
      locations: [l502],
      scans: [scan('s1', 'l1', '2026-09-02')],
      currentAnalyses: [current('s1', 'pass')],
      analyses: [
        attempt('s1', 'failed', '2026-09-02T10:00:00+00:00'),
        attempt('s1', 'done', '2026-09-02T11:00:00+00:00'),
      ],
    });
    expect(d.todos).toEqual([]);
    expect(d.noScanAttention).toBe(true);
  });

  it('처리 중과 보고서 생성 실패만 있으면 noScanAttention은 true다(아트보드: 처리 중 줄 아래 안내 문구)', () => {
    const d = build({
      locations: [l502],
      scans: [scan('p1', 'l1', '2026-09-03', { status: 'uploaded' })],
      reports: [report('rf', 'l1', '2026-09-01T00:00:00+00:00', { gen_status: 'failed' })],
    });
    expect(d.todos.map((t) => t.kind)).toEqual(['report_failed', 'scan_processing']);
    expect(d.noScanAttention).toBe(true);
  });

  // 안내 문구를 끄는 종류가 하나씩 따로 효력이 있는지 본다(위 테스트들은 여러 종류가 함께 있어 하나가 빠져도 통과한다)
  it.each<[string, Partial<DashScan>, DashAnalysis[]]>([
    ['단위 확인 대기', { status: 'awaiting_unit_confirm' }, []],
    ['스캔 실패', { status: 'failed' }, []],
    ['분석 실패', {}, [attempt('s1', 'failed', '2026-09-02T10:00:00+00:00')]],
  ])('%s 줄 하나만 있어도 안내 문구를 보이지 않는다(noScanAttention=false)', (_name, scanOver, analyses) => {
    const d = build({ locations: [l502], scans: [scan('s1', 'l1', '2026-09-02', scanOver)], analyses });
    expect(d.todos).toHaveLength(1);
    expect(d.noScanAttention).toBe(false);
  });

  it('분석 처리 중 줄만 있으면 noScanAttention은 true다(처리 중은 조치가 필요한 실패가 아니다)', () => {
    const d = build({
      locations: [l502],
      scans: [scan('s1', 'l1', '2026-09-02')],
      analyses: [attempt('s1', 'processing', '2026-09-02T10:00:00+00:00')],
    });
    expect(d.todos.map((t) => t.kind)).toEqual(['analysis_processing']);
    expect(d.noScanAttention).toBe(true);
  });

  it('초안이어도 생성 실패가 아니면(작성 중 · PDF 생성 대기 중/중) 할 일이 아니다', () => {
    const d = build({
      locations: [l502],
      reports: [
        report('rd1', 'l1', '2026-09-01T00:00:00+00:00'),
        report('rd2', 'l1', '2026-09-02T00:00:00+00:00', { gen_status: 'queued' }),
        report('rd3', 'l1', '2026-09-03T00:00:00+00:00', { gen_status: 'processing' }),
      ],
    });
    expect(d.todos).toEqual([]);
  });

  it('분석이 도는 업로드 스캔도 처리 중 한 줄이다(스캔당 한 줄)', () => {
    const d = build({
      locations: [l502],
      scans: [scan('s1', 'l1', '2026-09-02', { status: 'uploaded' })],
      analyses: [attempt('s1', 'processing', '2026-09-02T10:00:00+00:00')],
    });
    expect(d.todos.map((t) => [t.kind, t.label])).toEqual([['analysis_processing', '분석 중']]);
  });
});

describe('buildSiteDashboard: 최근 보고서', () => {
  it(`생성 최근 순으로 ${RECENT_REPORT_LIMIT}건만 고르고, 상태 표시는 reportIndicator, 날짜는 YYYY-MM-DD다`, () => {
    const d = build({
      locations: [loc('l1')],
      reports: [
        report('r1', 'l1', '2026-09-01T08:00:00+00:00'),
        report('r2', 'l1', '2026-09-02T08:00:00+00:00', { status: 'finalized' }),
        report('r3', 'l1', '2026-09-03T08:00:00+00:00', { gen_status: 'failed' }),
        report('r4', 'l1', '2026-09-04T08:00:00+00:00', { gen_status: 'processing' }),
        report('r5', 'l1', '2026-09-05T08:00:00+00:00', { gen_status: 'queued' }),
        report('r6', 'l1', '2026-09-06T08:00:00+00:00'),
        report('r7', 'l1', '2026-09-07T08:00:00+00:00', { status: 'finalized' }),
      ],
    });
    expect(d.recentReports).toEqual([
      { id: 'r7', title: 'r7 평활도 보고서', href: '/reports/r7', type: 'success', label: '발행됨', date: '2026-09-07' },
      { id: 'r6', title: 'r6 평활도 보고서', href: '/reports/r6', type: 'pending', label: '작성 중', date: '2026-09-06' },
      { id: 'r5', title: 'r5 평활도 보고서', href: '/reports/r5', type: 'pending', label: 'PDF 생성 대기 중', date: '2026-09-05' },
      { id: 'r4', title: 'r4 평활도 보고서', href: '/reports/r4', type: 'in-progress', label: 'PDF 생성 중', date: '2026-09-04' },
      { id: 'r3', title: 'r3 평활도 보고서', href: '/reports/r3', type: 'error', label: '생성 실패', date: '2026-09-03' },
    ]);
    // KPI 보고서 수는 상한과 무관하게 전부 센다
    expect(d.kpi.reportCount).toBe(7);
  });
});

// 현장 대시보드(/sites/[id], 스펙 §5 03): 서버 컴포넌트 함수를 직접 호출해 쿼리 배선(현장 범위·삭제 제외·
// kind/is_current 필터)과, 그 결과를 buildSiteDashboard로 집계해 각 카드에 넘기는지 본다.
// Vitest는 async 서버 컴포넌트 render()를 지원하지 않는다(node_modules/next/dist/docs/01-app/02-guides/
// testing/vitest.md) - await로 얻은 엘리먼트 트리를 재귀 탐색한다. 카드의 DOM은 components/dashboard/__tests__가 본다.
//
// 스텁은 .eq/.in/.is 필터를 실제로 적용한다: 페이지가 필터를 빠뜨리면(회귀) 걸러졌어야 할 행이 집계에
// 섞여 KPI 단언이 깨진다. 호출 기록(calls)으로 어떤 필터를 걸었는지도 직접 본다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));

import { createClient } from '@/lib/supabase/server';
import SiteDashboardPage, { metadata } from '../page';
import { DashboardKpis } from '@/components/dashboard/dashboard-kpis';
import { RecentReportsCard } from '@/components/dashboard/recent-reports-card';
import { StatusGrid } from '@/components/dashboard/status-grid';
import { TodoCard } from '@/components/dashboard/todo-card';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import type { DashBuilding, DashKpi, DashReportItem, DashTodo } from '@/lib/domain/site-dashboard';

type Found = { type?: unknown; props: Record<string, unknown> };
function findAll(node: unknown, type: unknown, acc: Found[] = []): Found[] {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.type === type) acc.push(el as Found);
  const bag = (el.props ?? el) as Record<string, unknown>;
  for (const v of Object.values(bag)) findAll(v, type, acc);
  return acc;
}
// 문자열 children을 모은다(제목 아래 메타 줄 문구용)
function collectText(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') { acc.push(String(node)); return acc; }
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, acc)); return acc; }
  collectText((node as { props?: { children?: unknown } }).props?.children, acc);
  return acc;
}

type Row = Record<string, unknown>;
type Call = { table: string; select?: string; eq: [string, unknown][]; in: [string, unknown][]; is: [string, unknown][] };

// Supabase 쿼리 빌더 흉내: 필터를 실제로 적용하고 호출을 기록한다. failTable의 조회는 오류를 돌려준다.
// failSelect: 같은 테이블의 조회 가운데 select 문이 같은 것만 실패시킨다(analyses 조회 둘을 따로 보려고).
function stubSupabase(data: Record<string, Row[]>, opts: { failTable?: string; failSelect?: string } = {}) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      const call: Call = { table, eq: [], in: [], is: [] };
      calls.push(call);
      let rows = data[table] ?? [];
      // Supabase(PostgREST)처럼 한 번에 최대 1000행만 돌려준다. range(from, to)를 걸면 그 구간(양 끝 포함)
      let window: [number, number] | null = null;
      const result = () => (table === opts.failTable || (opts.failSelect !== undefined && call.select === opts.failSelect)
        ? { data: null, error: { message: 'connection refused' } }
        : { data: window ? rows.slice(window[0], window[1] + 1).slice(0, 1000) : rows.slice(0, 1000), error: null });
      const q: Record<string, unknown> = {
        select: (cols: string) => { call.select = cols; return q; },
        eq: (col: string, val: unknown) => { call.eq.push([col, val]); rows = rows.filter((r) => r[col] === val); return q; },
        in: (col: string, vals: unknown[]) => { call.in.push([col, vals]); rows = rows.filter((r) => vals.includes(r[col])); return q; },
        is: (col: string, val: unknown) => { call.is.push([col, val]); rows = rows.filter((r) => (r[col] ?? null) === val); return q; },
        order: () => q,
        range: (from: number, to: number) => { window = [from, to]; return q; },
        maybeSingle: async () => {
          const r = result();
          return r.error ? r : { data: rows[0] ?? null, error: null };
        },
        then: (resolve: (v: unknown) => void) => resolve(result()),
      };
      return q;
    },
  };
  return { client, calls };
}

const SITE = { id: 's1', name: '세종 M2블록 아파트', address: null, memo: null, created_at: '', updated_at: '' };
const location = (id: string, siteId: string, over: Row = {}): Row => ({
  id, site_id: siteId, building: '101동', floor: '5층', floor_order: 5, room: '501호', name: '거실',
  memo: null, created_at: '2026-08-01T00:00:00+00:00', updated_at: '', ...over,
});
const scan = (id: string, locationId: string, scannedAt: string, over: Row = {}): Row => ({
  id, location_id: locationId, surface: 'floor', scanned_at: scannedAt, status: 'ready',
  created_at: `${scannedAt}T09:00:00+00:00`, deleted_at: null, ...over,
});
const analysis = (id: string, scanId: string, over: Row = {}): Row => ({
  id, scan_id: scanId, kind: 'flatness', status: 'done', overall_verdict: null, is_current: false,
  created_at: '2026-09-01T10:00:00+00:00', deleted_at: null, ...over,
});
const report = (id: string, locationId: string, over: Row = {}): Row => ({
  id, location_id: locationId, title: `${id} 평활도 보고서`, status: 'draft', gen_status: 'done',
  created_at: '2026-09-02T00:00:00+00:00', deleted_at: null, ...over,
});

// 현장 s1(측정위치 2곳) + 다른 현장 s2의 행과 삭제된 행이 섞인 데이터
const DATA: Record<string, Row[]> = {
  sites: [SITE, { ...SITE, id: 's2', name: '다른 현장' }],
  locations: [
    location('l1', 's1'),
    location('l2', 's1', { floor: '3층', floor_order: 3, room: '301호' }),
    location('lx', 's2'),
  ],
  scans: [
    scan('c1', 'l1', '2026-08-28'),
    scan('c2', 'l1', '2026-09-03', { status: 'uploaded' }),
    scan('c3', 'l2', '2026-09-01'),
    // 삭제된 스캔과 다른 현장의 스캔은 세지 않는다
    scan('cdel', 'l2', '2026-09-05', { deleted_at: '2026-09-06T00:00:00+00:00' }),
    scan('cx', 'lx', '2026-09-04'),
  ],
  analyses: [
    analysis('a1', 'c1', { overall_verdict: 'pass', is_current: true, created_at: '2026-08-28T10:00:00+00:00' }),
    // 옛 분석(현재 아님) - 현재 분석 조회에 is_current 필터가 없으면 c1 판정이 재시공으로 뒤집힌다
    analysis('a0', 'c1', { overall_verdict: 'rework', is_current: false, created_at: '2026-08-28T09:00:00+00:00' }),
    // done인데 판정 없음(판정 불가)
    analysis('a3', 'c3', { is_current: true }),
    // 구배 현재 분석 - kind 필터가 없으면 판정 집계에 재시공 1이 섞인다(단계 C 사고)
    analysis('a3s', 'c3', { kind: 'slope', overall_verdict: 'rework', is_current: true }),
    // 처리 중인 구배 재분석(종류 무관 처리 중 1건)
    analysis('a3q', 'c3', { kind: 'slope', status: 'processing', created_at: '2026-09-02T10:00:00+00:00' }),
    // 삭제된 대기 분석은 처리 중이 아니다
    analysis('adel', 'c1', { status: 'queued', deleted_at: '2026-09-01T00:00:00+00:00' }),
  ],
  reports: [
    report('r1', 'l1'),
    report('r2', 'l2', { gen_status: 'failed', created_at: '2026-09-04T00:00:00+00:00' }),
    report('rdel', 'l1', { deleted_at: '2026-09-05T00:00:00+00:00' }),
    report('rx', 'lx'),
  ],
};

async function renderPage(data: Record<string, Row[]> = DATA, opts: { failTable?: string; failSelect?: string } = {}) {
  const stub = stubSupabase(data, opts);
  vi.mocked(createClient).mockResolvedValue(stub.client as never);
  const el = await SiteDashboardPage({ params: Promise.resolve({ id: 's1' }) });
  return { el, calls: stub.calls };
}

describe('SiteDashboardPage 쿼리 배선', () => {
  it('현재 분석 조회는 is_current·kind=flatness·삭제 제외, 활동 조회는 종류·현재 여부를 가리지 않는다', async () => {
    const { calls } = await renderPage();
    const analyses = calls.filter((c) => c.table === 'analyses');
    expect(analyses).toHaveLength(2);
    const currentCall = analyses.find((c) => c.select === 'scan_id, status, overall_verdict, kind')!;
    expect(currentCall.eq).toEqual([['is_current', true], ['kind', 'flatness']]);
    expect(currentCall.is).toEqual([['deleted_at', null]]);
    expect(currentCall.in).toEqual([['scan_id', ['c1', 'c2', 'c3']]]);
    const activityCall = analyses.find((c) => c.select === 'scan_id, kind, status, created_at')!;
    // 새 분석은 완료돼야 현재가 된다 - 처리 중·실패 시도를 보려면 is_current·kind를 걸면 안 된다
    expect(activityCall.eq).toEqual([]);
    expect(activityCall.is).toEqual([['deleted_at', null]]);
    expect(activityCall.in).toEqual([['scan_id', ['c1', 'c2', 'c3']]]);
  });

  it('스캔·보고서는 이 현장 측정위치로 거르고 삭제를 뺀다(보고서는 상태 무관)', async () => {
    const { calls } = await renderPage();
    const byTable = (t: string) => calls.find((c) => c.table === t)!;
    expect(byTable('locations').eq).toEqual([['site_id', 's1']]);
    for (const t of ['scans', 'reports']) {
      expect(byTable(t).in).toEqual([['location_id', ['l1', 'l2']]]);
      expect(byTable(t).is).toEqual([['deleted_at', null]]);
      expect(byTable(t).eq).toEqual([]);
    }
  });

  it('측정위치가 없으면 스캔·보고서·분석 조회를 보내지 않는다(빈 .in() 금지)', async () => {
    const { el, calls } = await renderPage({ sites: [SITE], locations: [] });
    expect(calls.map((c) => c.table)).toEqual(['sites', 'locations']);
    expect((findAll(el, DashboardKpis)[0].props.kpi as DashKpi).locationCount).toBe(0);
  });

  it('스캔이 없으면 분석 조회를 보내지 않는다', async () => {
    const { calls } = await renderPage({ sites: [SITE], locations: [location('l1', 's1')], scans: [], reports: [] });
    expect(calls.map((c) => c.table)).toEqual(['sites', 'locations', 'scans', 'reports']);
  });
});

// 후속(2026-10-18): Supabase 는 한 번에 최대 1000행만 돌려주고 넘치는 행은 오류 없이 잘라 낸다.
// 분석 시도가 1000건을 넘는 현장에서 처리 중 KPI 가 조용히 줄면 안 된다(쪽을 넘겨 끝까지 받는다).
describe('SiteDashboardPage 행 상한', () => {
  it('분석 시도가 1000건을 넘어도 처리 중을 끝까지 센다', async () => {
    const queued = Array.from({ length: 1200 }, (_, i) =>
      analysis(`q${i}`, 'c1', { status: 'queued', created_at: '2026-09-02T10:00:00+00:00' }));
    const { el } = await renderPage({
      sites: [SITE], locations: [location('l1', 's1')], scans: [scan('c1', 'l1', '2026-09-01')], analyses: queued, reports: [],
    });
    expect((findAll(el, DashboardKpis)[0].props.kpi as DashKpi).inProgressCount).toBe(1200);
  });
});

describe('SiteDashboardPage 화면 구성', () => {
  it('본문은 PAGE_MAIN div 한 겹이다(현장 헤더와 <main>은 레이아웃 몫)', async () => {
    const { el } = await renderPage();
    expect(el.type).toBe('div');
    expect(el.props.className).toBe(PAGE_MAIN);
    expect(findAll(el, 'main')).toHaveLength(0);
  });

  it('PageHeader: 제목은 현장 이름, 설명은 측정위치 · 스캔 · 최근 활동, 브레드크럼은 없다(탭 첫 화면)', async () => {
    const { el } = await renderPage();
    const headers = findAll(el, PageHeader);
    expect(headers).toHaveLength(1);
    expect(headers[0].props.title).toBe('세종 M2블록 아파트');
    expect(headers[0].props.crumbs).toBeUndefined();
    expect(collectText(headers[0].props.description).join('')).toBe('측정위치 2 · 스캔 3 · 최근 활동 2026-09-03');
  });

  it('스캔이 없으면 설명에 최근 활동이 없다', async () => {
    const { el } = await renderPage({ sites: [SITE], locations: [location('l1', 's1')] });
    expect(collectText(findAll(el, PageHeader)[0].props.description).join('')).toBe('측정위치 1 · 스캔 0');
  });

  it('KPI: 삭제·다른 현장·옛 분석·구배 현재 분석을 걸러 센다', async () => {
    const { el } = await renderPage();
    expect(findAll(el, DashboardKpis)[0].props.kpi as DashKpi).toEqual({
      locationCount: 2, scanCount: 3, doneCount: 2, bar: { pass: 1, warn: 0, fail: 0 }, naCount: 1,
      inProgressCount: 1, reportCount: 2, lastScannedAt: '2026-09-03',
    });
  });

  it('격자·할 일·최근 보고서를 집계 결과 그대로 각 카드에 넘긴다', async () => {
    const { el } = await renderPage();
    const [grid] = findAll(el, StatusGrid);
    expect(grid.props.siteId).toBe('s1');
    expect(grid.props.locationCount).toBe(2);
    expect(grid.props.hiddenCount).toBe(0);
    expect((grid.props.buildings as DashBuilding[]).map((b) => [b.building, b.floors.map((f) => f.floor)]))
      .toEqual([['101동', ['5층', '3층']]]);
    const [todo] = findAll(el, TodoCard);
    expect((todo.props.todos as DashTodo[]).map((t) => t.key))
      .toEqual(['report_failed:r2', 'scan_processing:c2', 'analysis_processing:c3']);
    expect(todo.props.noScanAttention).toBe(true);
    const [recent] = findAll(el, RecentReportsCard);
    expect(recent.props.siteId).toBe('s1');
    expect((recent.props.reports as DashReportItem[]).map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  // 위 테스트의 픽스처는 숨긴 곳이 0이고 단위 확인 대기 스캔이 없어, 두 값을 고정값으로 넘겨도 통과한다
  it('숨긴 곳 수와 안내 문구 여부도 집계 그대로 넘긴다(상한 초과 + 단위 확인 대기 스캔)', async () => {
    const many = Array.from({ length: 26 }, (_, i) => location(`m${i}`, 's1', { room: `${i}호` }));
    const { el } = await renderPage({
      sites: [SITE], locations: many, reports: [], analyses: [],
      scans: [scan('u1', 'm0', '2026-09-01', { status: 'awaiting_unit_confirm' })],
    });
    expect(findAll(el, StatusGrid)[0].props.hiddenCount).toBe(2);
    expect(findAll(el, TodoCard)[0].props.noScanAttention).toBe(false);
  });

  it('문서 제목은 화면 이름 "현장 대시보드"만 준다(루트 레이아웃 템플릿이 "Flatness · "를 붙인다, 스펙 §9)', () => {
    expect(metadata.title).toBe('현장 대시보드');
  });
});

describe('SiteDashboardPage 오류·없는 현장', () => {
  it('현장이 없으면 notFound()', async () => {
    await expect(renderPage({ sites: [] })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each(['sites', 'locations', 'scans', 'reports', 'analyses'])(
    '%s 조회가 실패하면 PAGE_MAIN 본문에 SupabaseErrorNotice만 그린다',
    async (failTable) => {
      const { el } = await renderPage(DATA, { failTable });
      expect(el.props.className).toBe(PAGE_MAIN);
      expect(findAll(el, SupabaseErrorNotice).map((n) => n.props.message)).toEqual(['connection refused']);
      expect(findAll(el, DashboardKpis)).toHaveLength(0);
    },
  );

  // analyses 조회 둘(현재 평활도 분석 / 처리 중·실패 활동)은 같은 테이블이라 위 failTable 로는 따로 가를 수 없다
  it.each(['scan_id, status, overall_verdict, kind', 'scan_id, kind, status, created_at'])(
    '분석 조회 둘 중 하나만 실패해도(%s) SupabaseErrorNotice만 그린다',
    async (failSelect) => {
      const { el } = await renderPage(DATA, { failSelect });
      expect(el.props.className).toBe(PAGE_MAIN);
      expect(findAll(el, SupabaseErrorNotice).map((n) => n.props.message)).toEqual(['connection refused']);
      expect(findAll(el, DashboardKpis)).toHaveLength(0);
    },
  );
});

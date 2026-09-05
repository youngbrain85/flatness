// 코드리뷰(I1): 이 파일이 없으면 app/page.tsx의 .eq('kind', 'flatness')를 지워도
// 테스트가 전부 통과한다 - 홈 카드 판정 집계가 구배 분석까지 섞여 2배로 계상되는
// 회귀를 아무것도 못 잡는다는 뜻이다. 실제 서버 컴포넌트 함수를 직접 호출해 Supabase
// 쿼리 체인에 걸린 .eq()/.in() 인자를 스파이로 기록함으로써 배선 자체를 검증한다.
//
// 참고: Next.js 공식 문서(node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md)는
// "Vitest는 async 서버 컴포넌트 렌더링을 지원하지 않는다"고 명시한다. 이 테스트는
// render()로 DOM에 그리지 않고, await로 얻은 React 엘리먼트 트리를 재귀 탐색한다
// (app/scans/[id]/__tests__/page.test.tsx, app/sites/[id]/__tests__/page.test.tsx와 동일 패턴).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import HomePage from '../page';
import { SiteTable, type SiteTableRow } from '@/components/site-table';
import { PageHeader } from '@/components/ui/page-header';
import { Container } from '@/components/ui/container';
import { LinkButton } from '@/components/ui/button';
import { KeyValuePairs, StatValue } from '@/components/ui/key-value';
import { VerdictLegend } from '@/components/ui/verdict-bar';
import { EmptyState } from '@/components/ui/empty-state';

// 엘리먼트 트리를 재귀 탐색해 특정 컴포넌트/태그 타입이 쓰인 곳을 모두 모은다.
// Cloudscape 프리미티브는 슬롯을 children이 아니라 prop으로 받는다(PageHeader·Container의
// actions, KeyValuePairs의 items[].value) - children만 따라가면 그 안의 엘리먼트를 놓치므로
// 엘리먼트면 props 전부를, 평범한 객체(items 항목)면 그 값 전부를 따라간다.
// 함수(onChange 등)·문자열은 typeof 'object'가 아니라 자연히 건너뛴다.
type Found = { props: Record<string, unknown> };
function findAll(node: unknown, type: unknown, acc: Found[] = []): Found[] {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.type === type) acc.push(el as Found);
  const bag = (el.props ?? el) as Record<string, unknown>;
  for (const v of Object.values(bag)) findAll(v, type, acc);
  return acc;
}

// KeyValuePairs는 값을 items prop으로 받는다 - 라벨로 항목을 찾아 그 value 노드를 돌려준다.
function kvValue(el: unknown, label: string): unknown {
  for (const kv of findAll(el, KeyValuePairs)) {
    const hit = (kv.props.items as { label: unknown; value: unknown }[]).find((i) => i.label === label);
    if (hit) return hit.value;
  }
  return undefined;
}

// 문자열 children을 모아 안내 문구·라벨 회귀를 잡는다.
function collectText(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') { acc.push(String(node)); return acc; }
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, acc)); return acc; }
  collectText((node as { props?: { children?: unknown } }).props?.children, acc);
  return acc;
}

// Supabase 쿼리 빌더 흉내: 체이닝 메서드는 자기 자신을 반환하고, await 대상이 되면
// (thenable) 미리 정해 둔 결과로 resolve한다. eq()/in()만 호출 인자를 스파이에 기록한다.
function chain(
  result: { data: unknown; error: null },
  spies?: {
    select?: (cols: string) => void;
    eq?: (col: string, val: unknown) => void; in?: (col: string, val: unknown) => void;
  },
) {
  const obj: Record<string, unknown> = {
    select: (cols: string) => { spies?.select?.(cols); return obj; }, order: () => obj, is: () => obj,
    eq: (col: string, val: unknown) => { spies?.eq?.(col, val); return obj; },
    in: (col: string, val: unknown) => { spies?.in?.(col, val); return obj; },
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

// sites/locations/scans/analyses(현재분석)/analyses(처리중) 순서로 5개 쿼리가 나간다.
// analyses 테이블은 두 번 조회되므로 호출 순서로 두 쿼리를 구분한다.
function stubSupabase(opts: {
  sites?: unknown[]; locations?: unknown[]; scans?: unknown[];
  currentAnalyses?: unknown[]; inProgressAnalyses?: unknown[];
  eqSpy?: (col: string, val: unknown) => void; inSpy?: (col: string, val: unknown) => void;
  // 처리 중(analyses 두 번째) 조회의 select 컬럼을 기록한다 - 'status, scan_id' 확장 배선용
  selectSpy?: (cols: string) => void;
}) {
  let analysesCall = 0;
  return {
    from: (table: string) => {
      if (table === 'sites') return chain({ data: opts.sites ?? [], error: null });
      if (table === 'locations') return chain({ data: opts.locations ?? [], error: null });
      if (table === 'scans') return chain({ data: opts.scans ?? [], error: null });
      if (table === 'analyses') {
        analysesCall += 1;
        if (analysesCall === 1) {
          return chain({ data: opts.currentAnalyses ?? [], error: null }, { eq: opts.eqSpy });
        }
        return chain({ data: opts.inProgressAnalyses ?? [], error: null }, { in: opts.inSpy, select: opts.selectSpy });
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

describe('HomePage 쿼리 배선 (단계 C 회귀 차단: I1)', () => {
  it('판정 집계(analyses 첫 조회)에 kind=flatness 필터를 건다', async () => {
    const eqSpy = vi.fn();
    vi.mocked(createClient).mockResolvedValue(stubSupabase({ eqSpy }) as never);

    await HomePage();

    // 이 두 단언 중 kind 쪽을 지우면(회귀 재현) 이 테스트만 실패해야 한다.
    expect(eqSpy).toHaveBeenCalledWith('kind', 'flatness');
    expect(eqSpy).toHaveBeenCalledWith('is_current', true);
  });

  it('처리 중 집계(analyses 두 번째 조회)는 kind 무필터 상태 전용 쿼리다(브리프 Step 3)', async () => {
    const inSpy = vi.fn();
    vi.mocked(createClient).mockResolvedValue(stubSupabase({ inSpy }) as never);

    await HomePage();

    expect(inSpy).toHaveBeenCalledWith('status', ['queued', 'processing']);
  });

  it('처리 중 조회는 status와 scan_id를 함께 읽는다(테이블 상태 열의 현장별 건수 - 표시용 조회 확장)', async () => {
    const selectSpy = vi.fn();
    vi.mocked(createClient).mockResolvedValue(stubSupabase({ selectSpy }) as never);

    await HomePage();

    // 'status'만 남기면(회귀 재현) 행의 inProgress가 전부 0이 돼 상태 열이 조용히 틀린다.
    expect(selectSpy).toHaveBeenCalledWith('status, scan_id');
  });
});

describe('HomePage 렌더 (PageHeader + 개요 KeyValuePairs + 현장 테이블)', () => {
  const sites = [{ id: 's1', name: '현장A', address: null, memo: null, created_at: '', updated_at: '' }];
  const locations = [{ id: 'l1', site_id: 's1' }];
  const scans = [{ id: 'c1', scanned_at: '2026-07-20', location_id: 'l1' }];

  it('현장 행이 SiteTable rows로 실리고, 개요 "처리 중"과 행의 inProgress는 queued+processing만 센다', async () => {
    const currentAnalyses = [{ scan_id: 'c1', status: 'done', overall_verdict: 'pass', kind: 'flatness' }];
    // 실제 처리 중 조회는 .in('status', [...])가 done을 돌려주지 않는다 - 스텁의 done 행은
    // countInProgress 자체의 가드를 보는 용도라 scan_id를 붙이지 않는다(현장별 집계는 상태를
    // 다시 거르지 않고 쿼리의 필터를 믿는다 - 배선 describe의 .in 스파이가 그 필터를 지킨다).
    const inProgressAnalyses = [
      { status: 'queued', scan_id: 'c1' }, { status: 'processing', scan_id: 'c1' }, { status: 'done' },
    ];
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ sites, locations, scans, currentAnalyses, inProgressAnalyses }) as never,
    );

    const el = await HomePage();

    // 현장 링크는 클라이언트 컴포넌트(SiteTable) 안에서 그려져 트리 탐색으로 닿지 않는다 -
    // SiteTable에 전달된 rows로 검증한다(링크 렌더 자체는 components/__tests__/site-table.test.tsx가 본다).
    const tables = findAll(el, SiteTable);
    expect(tables).toHaveLength(1);
    expect(tables[0].props.rows as SiteTableRow[]).toEqual([{
      id: 's1', name: '현장A', locationCount: 1, scanCount: 1, lastScannedAt: '2026-07-20',
      counts: { pass: 1, warn: 0, fail: 0 }, na: 0, inProgress: 2,
    }]);

    const [kv] = findAll(el, KeyValuePairs);
    expect(kv.props.columns).toBe(4);
    expect((kv.props.items as { label: string }[]).map((i) => i.label)).toEqual(['현장', '스캔', '처리 중', '판정 분포']);
    expect(findAll(kvValue(el, '현장'), StatValue)[0]?.props.value).toBe(1);
    expect(findAll(kvValue(el, '스캔'), StatValue)[0]?.props.value).toBe(1);
    expect(findAll(kvValue(el, '처리 중'), StatValue)[0]?.props.value).toBe(2); // queued+processing만(done 제외)
    expect(findAll(kvValue(el, '판정 분포'), StatValue)[0]?.props.value).toBe(1);
  });

  it('헤더·컨테이너 배선: normal "스캔 업로드"(/upload), primary "새 현장"(/sites/new) - primary는 하나, 브레드크럼 없음', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ sites, locations, scans, currentAnalyses: [] }) as never,
    );

    const el = await HomePage();

    const [header] = findAll(el, PageHeader);
    expect(header.props.title).toBe('현장');
    expect(header.props.crumbs).toBeUndefined(); // 홈에는 브레드크럼 없음(스펙 §7-2)

    const buttons = findAll(el, LinkButton);
    const variantByHref = Object.fromEntries(buttons.map((b) => [b.props.href, b.props.variant]));
    expect(variantByHref).toEqual({ '/upload': undefined, '/sites/new': 'primary' }); // undefined = normal(기본)
    expect(buttons.filter((b) => b.props.variant === 'primary')).toHaveLength(1);
    expect(collectText(buttons.find((b) => b.props.href === '/upload'))).toContain('스캔 업로드');
    expect(collectText(buttons.find((b) => b.props.href === '/sites/new'))).toContain('새 현장');

    expect(findAll(el, Container).map((c) => c.props.title)).toEqual(['개요', '현장']);
    const table = findAll(el, Container).find((c) => c.props.title === '현장');
    expect(table?.props.counter).toBe(1);
    expect(table?.props.padded).toBe(false);
  });

  it('판정 불가(na) 건수를 개요 범례(불가 n)와 테이블 행(na)으로 넘긴다(리뷰 픽스 유지)', async () => {
    // status=done인데 overall_verdict null -> "엔진은 돌았는데 판정이 안 나온" 케이스(naCount).
    const currentAnalyses = [{ scan_id: 'c1', status: 'done', overall_verdict: null, kind: 'flatness' }];
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ sites, locations, scans, currentAnalyses }) as never,
    );

    const el = await HomePage();

    const legend = findAll(kvValue(el, '판정 분포'), VerdictLegend);
    expect(legend).toHaveLength(1);
    expect(legend[0].props.na).toBe(1);
    expect(legend[0].props.counts).toEqual({ pass: 0, warn: 0, fail: 0 });
    expect(findAll(kvValue(el, '판정 분포'), StatValue)[0]?.props.value).toBe(0); // na는 총계에 들지 않는다(기존 동작)

    const rows = findAll(el, SiteTable)[0].props.rows as SiteTableRow[];
    expect(rows[0].na).toBe(1);
    expect(rows[0].counts).toEqual({ pass: 0, warn: 0, fail: 0 });
  });

  it('naCount가 0이면 범례에 불가 항목을 넘기지 않고 행의 na도 0이다(판정 불가 표시 없음)', async () => {
    const currentAnalyses = [{ scan_id: 'c1', status: 'done', overall_verdict: 'pass', kind: 'flatness' }];
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ sites, locations, scans, currentAnalyses }) as never,
    );

    const el = await HomePage();

    const legend = findAll(kvValue(el, '판정 분포'), VerdictLegend);
    expect(legend).toHaveLength(1);
    expect(legend[0].props.na).toBeUndefined();
    expect(legend[0].props.counts).toEqual({ pass: 1, warn: 0, fail: 0 });
    expect((findAll(el, SiteTable)[0].props.rows as SiteTableRow[])[0].na).toBe(0);
  });

  it('현장이 없으면 개요는 그대로 두고 테이블 컨테이너 대신 업로드 안내 빈 상태를 렌더한다', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase({}) as never);

    const el = await HomePage();

    // EmptyState는 컴포넌트 참조로만 트리에 실리고(실행되지 않는다), 내부에서 렌더하는
    // LinkButton은 findAll로 닿지 않는다 - EmptyState 자신에게 전달된 props로 문구·이동 대상을 검증한다.
    const emptyStates = findAll(el, EmptyState);
    expect(emptyStates).toHaveLength(1);
    expect(emptyStates[0].props.actionHref).toBe('/upload');
    expect(emptyStates[0].props.message).toContain('아직 등록된 현장이 없습니다');
    expect(findAll(el, SiteTable)).toHaveLength(0);
    expect(findAll(el, Container).map((c) => c.props.title)).toEqual(['개요']);
    expect(findAll(kvValue(el, '현장'), StatValue)[0]?.props.value).toBe(0);
    // 이 분기의 primary는 EmptyState 안(트리 밖) 하나뿐 - 헤더의 '스캔 업로드'는 normal
    expect(findAll(el, LinkButton).filter((b) => b.props.variant === 'primary')).toHaveLength(0);
  });
});

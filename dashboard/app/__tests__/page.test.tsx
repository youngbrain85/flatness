// 코드리뷰(I1): 이 파일이 없으면 app/page.tsx의 .eq('kind', 'flatness')를 지워도
// 테스트가 전부 통과한다 - 홈 카드 판정 집계가 구배 분석까지 섞여 2배로 계상되는
// 회귀를 아무것도 못 잡는다는 뜻이다. 실제 서버 컴포넌트 함수를 직접 호출해 Supabase
// 쿼리 체인에 걸린 .eq()/.in() 인자를 스파이로 기록함으로써 배선 자체를 검증한다.
//
// 참고: Next.js 공식 문서(node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md)는
// "Vitest는 async 서버 컴포넌트 렌더링을 지원하지 않는다"고 명시한다. 이 테스트는
// render()로 DOM에 그리지 않고, await로 얻은 React 엘리먼트 트리를 재귀 탐색한다
// (app/scans/[id]/__tests__/page.test.tsx와 동일 패턴). 진입 페이지(T3)는 진입 헤더와
// 클라이언트 섬(SiteFinder)에 넘기는 props까지 본다 - 목록·검색·새 현장 카드의 DOM은
// components/entry/__tests__/가 본다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
// proxy가 실은 사용자 헤더를 읽는 헬퍼 - 요청 스코프 밖(테스트)에서는 흉내낸다
vi.mock('@/lib/auth/request-user', () => ({ getRequestUser: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getRequestUser } from '@/lib/auth/request-user';
import HomePage, { metadata } from '../page';
import { SiteFinder, type EntryTotals } from '@/components/entry/site-finder';
import type { EntrySiteRow } from '@/components/entry/site-list';
import { EntryHeader } from '@/components/shell/entry-header';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';

// 엘리먼트 트리를 재귀 탐색해 특정 컴포넌트/태그 타입이 쓰인 곳을 모두 모은다.
// 슬롯을 children이 아니라 prop으로 받는 컴포넌트도 있으므로 엘리먼트면 props 전부를,
// 평범한 객체면 그 값 전부를 따라간다. 함수·문자열은 typeof 'object'가 아니라 자연히 건너뛴다.
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

// Supabase 쿼리 빌더 흉내: 체이닝 메서드는 자기 자신을 반환하고, await 대상이 되면
// (thenable) 미리 정해 둔 결과로 resolve한다. eq()/in()/select()만 호출 인자를 스파이에 기록한다.
function chain(
  result: { data: unknown; error: { message: string } | null },
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
  // 이 테이블 조회가 오류를 돌려준다(Supabase 연결 실패 분기)
  failTable?: string;
}) {
  let analysesCall = 0;
  const ok = (data: unknown[] | undefined) => ({ data: data ?? [], error: null });
  return {
    from: (table: string) => {
      if (table === opts.failTable) return chain({ data: null, error: { message: 'connection refused' } });
      if (table === 'sites') return chain(ok(opts.sites));
      if (table === 'locations') return chain(ok(opts.locations));
      if (table === 'scans') return chain(ok(opts.scans));
      if (table === 'analyses') {
        analysesCall += 1;
        if (analysesCall === 1) {
          return chain(ok(opts.currentAnalyses), { eq: opts.eqSpy });
        }
        return chain(ok(opts.inProgressAnalyses), { in: opts.inSpy, select: opts.selectSpy });
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

describe('HomePage 렌더 (진입 헤더 + SiteFinder, 아트보드 EntrySearch)', () => {
  const site = (id: string, name: string) => ({ id, name, address: null, memo: null, created_at: '', updated_at: '' });

  it('진입 헤더에 요청 사용자의 이메일을 넘기고, 본문은 MAIN_BG <main> 안의 PAGE_MAIN 한 겹이다', async () => {
    vi.mocked(getRequestUser).mockResolvedValue({ id: 'u1', email: 'qa@example.com' });
    vi.mocked(createClient).mockResolvedValue(stubSupabase({ sites: [site('s1', '현장A')] }) as never);

    const el = await HomePage();

    expect(findAll(el, EntryHeader).map((h) => h.props.email)).toEqual(['qa@example.com']);
    const mains = findAll(el, 'main');
    expect(mains).toHaveLength(1);
    expect(mains[0].props.className).toBe(MAIN_BG);
    const inner = mains[0].props.children as { type: unknown; props: { className: string } };
    expect(inner.type).toBe('div');
    expect(inner.props.className).toBe(PAGE_MAIN);
    expect(findAll(inner, SiteFinder)).toHaveLength(1);
  });

  it('사용자 헤더가 없으면 진입 헤더의 email은 null이다', async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    vi.mocked(createClient).mockResolvedValue(stubSupabase({}) as never);

    const el = await HomePage();

    expect(findAll(el, EntryHeader)[0].props.email).toBeNull();
  });

  it('현장 줄은 SiteSummary를 접은 평면 객체(3묶음·판정 불가·처리 중)이고 총계는 현장·측정위치·스캔·처리 중이다', async () => {
    const sites = [site('s1', '현장A'), site('s2', '현장B')];
    const locations = [{ id: 'l1', site_id: 's1' }, { id: 'l2', site_id: 's1' }, { id: 'l3', site_id: 's2' }];
    const scans = [
      { id: 'c1', scanned_at: '2026-07-20', location_id: 'l1' },
      { id: 'c2', scanned_at: '2026-07-21', location_id: 'l2' },
      { id: 'c3', scanned_at: '2026-07-01', location_id: 'l3' },
    ];
    const currentAnalyses = [
      { scan_id: 'c1', status: 'done', overall_verdict: 'pass', kind: 'flatness' },
      { scan_id: 'c2', status: 'done', overall_verdict: 'repair', kind: 'flatness' },
      // done인데 판정이 없다(판정 불가) - 분포에 들지 않고 na로 간다(리뷰 픽스 유지)
      { scan_id: 'c3', status: 'done', overall_verdict: null, kind: 'flatness' },
    ];
    // 실제 처리 중 조회는 .in('status', [...])가 done을 돌려주지 않는다 - 스텁의 done 행은
    // countInProgress 자체의 가드를 보는 용도라 scan_id를 붙이지 않는다.
    const inProgressAnalyses = [
      { status: 'queued', scan_id: 'c1' }, { status: 'processing', scan_id: 'c1' }, { status: 'done' },
    ];
    vi.mocked(getRequestUser).mockResolvedValue(null);
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ sites, locations, scans, currentAnalyses, inProgressAnalyses }) as never,
    );

    const el = await HomePage();

    const [finder] = findAll(el, SiteFinder);
    expect(finder.props.rows as EntrySiteRow[]).toEqual([
      {
        id: 's1', name: '현장A', locationCount: 2, scanCount: 2, lastScannedAt: '2026-07-21',
        counts: { pass: 1, warn: 0, fail: 1 }, na: 0, inProgress: 2,
      },
      {
        id: 's2', name: '현장B', locationCount: 1, scanCount: 1, lastScannedAt: '2026-07-01',
        counts: { pass: 0, warn: 0, fail: 0 }, na: 1, inProgress: 0,
      },
    ]);
    expect(finder.props.totals as EntryTotals).toEqual({ sites: 2, locations: 3, scans: 3, inProgress: 2 });
  });

  it('줄은 최근 측정일 내림차순이고, 측정일이 없는 현장은 뒤로, 같은 날이면 이름 순이다', async () => {
    // 조회는 이름 순(.order('name'))으로 온다 - 정렬은 페이지가 다시 한다
    const sites = [site('c', '다현장'), site('b', '나현장'), site('d', '라현장'), site('a', '가현장')];
    const locations = [{ id: 'lb', site_id: 'b' }, { id: 'lc', site_id: 'c' }, { id: 'ld', site_id: 'd' }];
    const scans = [
      { id: 'x1', scanned_at: '2026-07-10', location_id: 'lc' },
      { id: 'x2', scanned_at: '2026-07-10', location_id: 'lb' },
      { id: 'x3', scanned_at: '2026-07-20', location_id: 'ld' },
    ];
    vi.mocked(getRequestUser).mockResolvedValue(null);
    vi.mocked(createClient).mockResolvedValue(stubSupabase({ sites, locations, scans }) as never);

    const el = await HomePage();

    const rows = findAll(el, SiteFinder)[0].props.rows as EntrySiteRow[];
    expect(rows.map((r) => r.name)).toEqual(['라현장', '나현장', '다현장', '가현장']);
  });

  it('현장이 없으면 SiteFinder에 빈 줄과 0 총계를 넘긴다(빈 안내와 "새 현장"은 SiteFinder 몫)', async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    vi.mocked(createClient).mockResolvedValue(stubSupabase({}) as never);

    const el = await HomePage();

    const [finder] = findAll(el, SiteFinder);
    expect(finder.props.rows).toEqual([]);
    expect(finder.props.totals).toEqual({ sites: 0, locations: 0, scans: 0, inProgress: 0 });
  });

  it('조회가 실패하면 진입 헤더는 그대로 두고 본문에 SupabaseErrorNotice만 그린다', async () => {
    vi.mocked(getRequestUser).mockResolvedValue({ id: 'u1', email: 'qa@example.com' });
    vi.mocked(createClient).mockResolvedValue(stubSupabase({ failTable: 'scans' }) as never);

    const el = await HomePage();

    expect(findAll(el, EntryHeader)).toHaveLength(1);
    expect(findAll(el, SupabaseErrorNotice).map((n) => n.props.message)).toEqual(['connection refused']);
    expect(findAll(el, SiteFinder)).toHaveLength(0);
    expect(findAll(el, 'main')[0].props.className).toBe(MAIN_BG);
  });

  it('문서 제목은 전체 "Flatness · 현장 목록"이다(루트 레이아웃과 같은 세그먼트라 템플릿이 붙지 않는다, 스펙 §9)', () => {
    expect(metadata.title).toBe('Flatness · 현장 목록');
  });
});

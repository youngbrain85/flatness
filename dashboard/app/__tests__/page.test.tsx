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

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import HomePage from '../page';
import { MetricCard } from '@/components/ui/metric-card';
import { EmptyState } from '@/components/ui/empty-state';

// 엘리먼트 트리를 재귀 탐색해 특정 컴포넌트/태그 타입이 쓰인 곳을 모두 모은다.
function findAll(node: unknown, type: unknown, acc: { props: Record<string, unknown> }[] = []) {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) acc.push(el as { props: Record<string, unknown> });
  findAll(el.props?.children, type, acc);
  return acc;
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
  spies?: { eq?: (col: string, val: unknown) => void; in?: (col: string, val: unknown) => void },
) {
  const obj: Record<string, unknown> = {
    select: () => obj, order: () => obj, is: () => obj,
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
        return chain({ data: opts.inProgressAnalyses ?? [], error: null }, { in: opts.inSpy });
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
});

describe('HomePage 렌더 (홈 지표 스트립 + 현장 밀도 테이블)', () => {
  it('현장명이 링크로 렌더되고 처리 중 카드가 존재한다', async () => {
    const sites = [{ id: 's1', name: '현장A', address: null, memo: null, created_at: '', updated_at: '' }];
    const locations = [{ id: 'l1', site_id: 's1' }];
    const scans = [{ id: 'c1', scanned_at: '2026-07-20', location_id: 'l1' }];
    const currentAnalyses = [{ scan_id: 'c1', status: 'done', overall_verdict: 'pass', kind: 'flatness' }];
    const inProgressAnalyses = [{ status: 'queued' }, { status: 'processing' }, { status: 'done' }];

    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ sites, locations, scans, currentAnalyses, inProgressAnalyses }) as never,
    );

    const el = await HomePage();

    const links = findAll(el, Link);
    const siteLink = links.find((l) => l.props.href === '/sites/s1');
    expect(siteLink).toBeDefined();
    expect(collectText(siteLink)).toContain('현장A');

    const metricCards = findAll(el, MetricCard);
    const labels = metricCards.map((c) => c.props.label);
    expect(labels).toContain('처리 중');
    const inProgressCard = metricCards.find((c) => c.props.label === '처리 중');
    expect(inProgressCard?.props.value).toBe(2); // queued+processing만(done 제외)
  });

  it('현장이 없으면 업로드 화면으로 안내하는 빈 상태를 렌더한다', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase({}) as never);

    const el = await HomePage();

    // EmptyState는 컴포넌트 참조로만 트리에 실리고(실행되지 않는다), 내부에서
    // 렌더하는 <Link>는 findAll의 children 재귀로는 닿지 않는다 - EmptyState
    // 자신에게 전달된 props로 안내 문구·이동 대상을 검증한다.
    const emptyStates = findAll(el, EmptyState);
    expect(emptyStates).toHaveLength(1);
    expect(emptyStates[0].props.actionHref).toBe('/upload');
    expect(emptyStates[0].props.message).toContain('아직 등록된 현장이 없습니다');
  });
});

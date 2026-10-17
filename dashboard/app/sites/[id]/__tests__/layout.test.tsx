// 현장 작업 공간 레이아웃(스펙 §4.2·§4.3): 현장을 읽어 현장 헤더 + 도면 격자 본문(main 하나)으로 감싼다.
// 없는 현장은 404, 조회 실패는 "현장 없음"으로 오인하지 않고 연결 안내(옛 현장 상세의 가드를 옮김).
// async 서버 컴포넌트라 render() 대신 await 로 얻은 엘리먼트 트리를 탐색한다(다른 page 테스트와 같은 방식).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
// proxy 가 실어 주는 사용자 헤더(이메일은 인코딩해 싣는다 - lib/supabase/middleware.ts)
vi.mock('next/headers', () => ({
  headers: async () => new Headers({
    'x-flatness-user-id': 'u1', 'x-flatness-user-email': encodeURIComponent('u1@example.com'),
  }),
}));
// 셸 헤더 내부는 components/shell 테스트가 맡는다 - 여기서는 레이아웃이 넘긴 props 만 본다.
vi.mock('@/components/shell/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/shell/entry-header', () => ({ EntryHeader: () => null }));

import { createClient } from '@/lib/supabase/server';
import SiteLayout from '../layout';
import { SiteHeader } from '@/components/shell/site-header';
import { EntryHeader } from '@/components/shell/entry-header';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { MAIN_BG } from '@/components/ui/page';

type El = { type?: unknown; props: Record<string, unknown> };

function findAll(node: unknown, type: unknown, acc: El[] = []): El[] {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as El;
  if (el.type === type) acc.push(el);
  findAll(el.props?.children, type, acc);
  return acc;
}

function stubSites(result: { data: unknown; error: { message: string } | null }, calls: unknown[][] = []) {
  vi.mocked(createClient).mockResolvedValue({
    from: (table: string) => {
      calls.push(['from', table]);
      const chain = {
        select: (cols: string) => { calls.push(['select', cols]); return chain; },
        eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return chain; },
        maybeSingle: async () => result,
      };
      return chain;
    },
  } as never);
}

const child = <p>본문</p>;
const mount = () => SiteLayout({ children: child, params: Promise.resolve({ id: 's1' }) });

describe('SiteLayout', () => {
  it('sites 에서 id 로 한 행(id, name)만 읽는다', async () => {
    const calls: unknown[][] = [];
    stubSites({ data: { id: 's1', name: '현장1' }, error: null }, calls);
    await mount();
    expect(calls).toEqual([['from', 'sites'], ['select', 'id, name'], ['eq', 'id', 's1']]);
  });

  it('현장 헤더에 현장(id·name)과 요청 사용자 이메일을 넘기고, 화면은 main(MAIN_BG) 하나 안에 그린다', async () => {
    stubSites({ data: { id: 's1', name: '현장1' }, error: null });
    const el = await mount();
    expect(findAll(el, SiteHeader).map((h) => h.props))
      .toEqual([{ site: { id: 's1', name: '현장1' }, email: 'u1@example.com' }]);
    const mains = findAll(el, 'main');
    expect(mains).toHaveLength(1);
    expect(mains[0].props.className).toBe(MAIN_BG);
    expect(mains[0].props.children).toBe(child);
    expect(findAll(el, EntryHeader)).toHaveLength(0);
  });

  it('없는 현장은 404(notFound)다', async () => {
    stubSites({ data: null, error: null });
    await expect(mount()).rejects.toThrow('NOT_FOUND');
  });

  it('조회 실패는 404 로 오인하지 않고 진입 헤더 + 연결 안내를 그리며 아래 화면은 그리지 않는다', async () => {
    stubSites({ data: null, error: { message: 'paused' } });
    const el = await mount();
    expect(findAll(el, EntryHeader).map((h) => h.props.email)).toEqual(['u1@example.com']);
    expect(findAll(el, SiteHeader)).toHaveLength(0);
    expect(findAll(el, SupabaseErrorNotice).map((n) => n.props.message)).toEqual(['paused']);
    expect(findAll(el, 'p').some((p) => p.props.children === '본문')).toBe(false);
  });
});

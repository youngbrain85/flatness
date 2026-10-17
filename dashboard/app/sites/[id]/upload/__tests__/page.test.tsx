// 현장 안 스캔 업로드(T6) 서버 배선: 본문 클래스(PAGE_MAIN)·브레드크럼·폼 props(현장 고정)·
// ?location= 확인·미로그인 리다이렉트·조회 실패. Vitest는 async 서버 컴포넌트의 render()를
// 지원하지 않으므로(node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md) await로 얻은
// React 엘리먼트 트리를 재귀 탐색한다(옛 app/upload/__tests__/page.test.tsx와 같은 패턴).
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// 헤더 스텁을 테스트마다 바꿀 수 있게 hoisted 저장소로 둔다(미로그인 케이스).
const { headerStore } = vi.hoisted(() => ({ headerStore: { id: 'u1' as string | null } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
// perf-auth-roundtrips: getRequestUser는 proxy가 실은 x-flatness-user-* 요청 헤더를
// 읽는다 - 헤더만 흉내내고 실제 코드가 그대로 돈다.
vi.mock('next/headers', () => ({
  headers: async () => new Headers(headerStore.id ? { 'x-flatness-user-id': headerStore.id } : {}),
}));

import { createClient } from '@/lib/supabase/server';
import SiteUploadPage, { metadata } from '../page';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { UploadForm } from '@/components/upload-form';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_MAIN } from '@/components/ui/page';

// 측정위치 탭 트리 순서를 확인하려고 일부러 뒤섞어 넘긴다: 102동이 101동보다 먼저, 같은 동에서는
// 낮은 층이 먼저 온다. 기대 순서는 101동 5층 → 101동 3층 → 102동 1층이다.
const L_102_1F = {
  id: 'l3', site_id: 's1', building: '102동', floor: '1층', floor_order: 1, room: '101호', name: '거실',
  memo: null, created_at: '', updated_at: '',
};
const L_101_3F = { ...L_102_1F, id: 'l1', building: '101동', floor: '3층', floor_order: 3, room: '301호' };
const L_101_5F = { ...L_102_1F, id: 'l2', building: '101동', floor: '5층', floor_order: 5, room: '501호' };

// Supabase 쿼리 빌더 흉내: 체이닝은 자기 자신, await 되면(thenable) 정해 둔 결과로 resolve.
function chain(
  result: { data: unknown; error: { message: string } | null },
  eqSpy?: (col: string, val: unknown) => void,
  selectSpy?: (cols: unknown) => void,
) {
  const obj: Record<string, unknown> = {
    select: (cols?: unknown) => { selectSpy?.(cols); return obj; }, order: () => obj,
    eq: (col: string, val: unknown) => { eqSpy?.(col, val); return obj; },
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

function findByType(node: unknown, type: unknown): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const c of node) { const f = findByType(c, type); if (f) return f; }
    return null;
  }
  const el = node as ReactElement & { props?: { children?: unknown } };
  if (el.type === type) return el;
  return findByType(el.props?.children, type);
}

function mount(location?: string, opts: {
  error?: { message: string }; eqSpy?: (col: string, val: unknown) => void;
  selectSpy?: (cols: unknown) => void; id?: string;
} = {}) {
  headerStore.id = 'u1';
  vi.mocked(createClient).mockResolvedValue({
    from: (table: string) => {
      if (table === 'locations') {
        return chain({ data: opts.error ? null : [L_102_1F, L_101_3F, L_101_5F], error: opts.error ?? null }, opts.eqSpy, opts.selectSpy);
      }
      // 현장은 경로가 정하고 레이아웃이 확인한다 - 이 페이지가 현장 목록을 읽으면 안 된다.
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  } as never);
  return SiteUploadPage({ params: Promise.resolve({ id: opts.id ?? 's1' }), searchParams: Promise.resolve({ location }) });
}

describe('SiteUploadPage (T6: 현장 고정)', () => {
  it('<title>은 화면 이름 "스캔 업로드"다(앞의 "Flatness · "는 루트 title.template 이 붙인다)', () => {
    expect(metadata.title).toBe('스캔 업로드');
  });

  it('뿌리는 PAGE_MAIN div, 브레드크럼은 측정위치 / 스캔 업로드(마지막은 비링크)', async () => {
    const el = (await mount()) as ReactElement<{ className: string }>;
    // 레이아웃이 <main>을 그리므로 페이지는 div 다(loading.tsx와 같은 PAGE_MAIN 문자열).
    expect(el.type).toBe('div');
    expect(el.props.className).toBe(PAGE_MAIN);

    const header = findByType(el, PageHeader);
    const props = header!.props as { crumbs: { href?: string; label: string }[]; title: string };
    expect(props.crumbs).toEqual([{ href: '/sites/s1/locations', label: '측정위치' }, { label: '스캔 업로드' }]);
    expect(props.title).toBe('스캔 업로드');
  });

  it('폼에 경로의 현장·이 현장 측정위치(트리 순서)·사용자를 넘긴다', async () => {
    const eqSpy = vi.fn();
    const el = await mount(undefined, { eqSpy });
    const form = findByType(el, UploadForm);
    const props = form!.props as { siteId: string; locations: { id: string }[]; userId: string; initialLocationId?: string };

    expect(eqSpy).toHaveBeenCalledWith('site_id', 's1');
    expect(props.siteId).toBe('s1');
    expect(props.locations.map((l) => l.id)).toEqual(['l2', 'l1', 'l3']);
    expect(props.userId).toBe('u1');
    expect(props.initialLocationId).toBeUndefined();
  });

  it('?location= 이 이 현장의 측정위치면 미리 고른다', async () => {
    const el = await mount('l1');
    expect((findByType(el, UploadForm)!.props as { initialLocationId?: string }).initialLocationId).toBe('l1');
  });

  it('?location= 이 다른 현장의 측정위치면 미리 고르지 않는다', async () => {
    const el = await mount('other-site-location');
    expect((findByType(el, UploadForm)!.props as { initialLocationId?: string }).initialLocationId).toBeUndefined();
  });

  it('측정위치 조회가 실패하면 폼 대신 Supabase 오류 안내를 그린다', async () => {
    const el = await mount(undefined, { error: { message: '연결 실패' } });
    expect(findByType(el, UploadForm)).toBeNull();
    expect((findByType(el, SupabaseErrorNotice)!.props as { message: string }).message).toBe('연결 실패');
  });

  it('사용자 헤더가 없으면 /login으로 보낸다(방어 심층 가드 유지)', async () => {
    headerStore.id = null;
    vi.mocked(createClient).mockResolvedValue({
      from: () => { throw new Error('리다이렉트 전에 조회하면 안 된다'); },
    } as never);
    await expect(SiteUploadPage({ params: Promise.resolve({ id: 's1' }), searchParams: Promise.resolve({}) }))
      .rejects.toThrow('REDIRECT:/login');
  });

  // --- T6 변이 실험 보강: 브리프 테스트의 픽스처(경로 id 가 늘 s1, 조회 인자 무시)로는 못 가르던 것 ---
  it('경로의 현장 id 를 조회 필터·폼·브레드크럼에 그대로 쓴다', async () => {
    const eqSpy = vi.fn();
    const el = await mount(undefined, { eqSpy, id: 's9' });

    expect(eqSpy).toHaveBeenCalledWith('site_id', 's9');
    expect((findByType(el, UploadForm)!.props as { siteId: string }).siteId).toBe('s9');
    const crumbs = (findByType(el, PageHeader)!.props as { crumbs: { href?: string }[] }).crumbs;
    expect(crumbs[0].href).toBe('/sites/s9/locations');
  });

  it('측정위치는 모든 컬럼(select("*"))으로 읽는다 - 폼이 동·층·공간·이름을 쓴다', async () => {
    const selectSpy = vi.fn();
    await mount(undefined, { selectSpy });

    expect(selectSpy).toHaveBeenCalledWith('*');
  });

  it('조회 실패 화면도 본문 틀(PAGE_MAIN div) 안에 그린다', async () => {
    const el = (await mount(undefined, { error: { message: '연결 실패' } })) as ReactElement<{ className: string }>;

    expect(el.type).toBe('div');
    expect(el.props.className).toBe(PAGE_MAIN);
  });
});

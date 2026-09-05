// 업로드 화면 서버 배선(T5): 본문 컨테이너 클래스(PAGE_MAIN)·브레드크럼·폼 props·
// 미로그인 리다이렉트. Vitest는 async 서버 컴포넌트의 render()를 지원하지 않으므로
// (node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md) await로 얻은
// React 엘리먼트 트리를 재귀 탐색한다(app/__tests__/page.test.tsx,
// app/registrations/new/__tests__/page.test.tsx와 같은 패턴).
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
import UploadPage from '../page';
import { UploadForm } from '@/components/upload-form';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_MAIN } from '@/components/ui/page';

const SITE = { id: 's1', name: '현장1', address: null, memo: null, created_at: '', updated_at: '' };
const LOCATION = {
  id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
  memo: null, created_at: '', updated_at: '',
};

// Supabase 쿼리 빌더 흉내: 체이닝은 자기 자신, await 되면(thenable) 정해 둔 결과로 resolve.
function chain(result: { data: unknown; error: null }) {
  const obj: Record<string, unknown> = {
    select: () => obj, order: () => obj,
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

function mount(location?: string) {
  headerStore.id = 'u1';
  vi.mocked(createClient).mockResolvedValue({
    from: (table: string) => {
      if (table === 'sites') return chain({ data: [SITE], error: null });
      if (table === 'locations') return chain({ data: [LOCATION], error: null });
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  } as never);
  return UploadPage({ searchParams: Promise.resolve({ location }) });
}

describe('UploadPage (Cloudscape T5)', () => {
  it('본문은 PAGE_MAIN 컨테이너, 브레드크럼은 현장 › 스캔 업로드(마지막은 비링크)', async () => {
    const el = (await mount()) as ReactElement<{ className: string }>;
    // loading.tsx와 같은 문자열이어야 전환 점프가 없다(스펙 §5).
    expect(el.type).toBe('main');
    expect(el.props.className).toBe(PAGE_MAIN);

    const header = findByType(el, PageHeader);
    expect(header).not.toBeNull();
    const props = header!.props as { crumbs: { href?: string; label: string }[]; title: string };
    expect(props.crumbs).toEqual([{ href: '/', label: '현장' }, { label: '스캔 업로드' }]);
    expect(props.title).toBe('스캔 업로드');
  });

  it('폼에 현장·측정위치·사용자·프리필 위치를 그대로 넘긴다(D4 배선 유지)', async () => {
    const el = await mount('l1');
    const form = findByType(el, UploadForm);
    expect(form).not.toBeNull();
    const props = form!.props as {
      sites: unknown[]; locations: unknown[]; userId: string; initialLocationId?: string;
    };
    expect(props.sites).toEqual([SITE]);
    expect(props.locations).toEqual([LOCATION]);
    expect(props.userId).toBe('u1');
    expect(props.initialLocationId).toBe('l1');
  });

  it('사용자 헤더가 없으면 /login으로 보낸다(방어 심층 가드 유지)', async () => {
    headerStore.id = null;
    vi.mocked(createClient).mockResolvedValue({
      from: () => { throw new Error('리다이렉트 전에 조회하면 안 된다'); },
    } as never);
    await expect(UploadPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/login');
  });
});

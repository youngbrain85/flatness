// 정합 시작 화면 서버 배선 (단계 F Task 5, 스펙 §6.2 2단계) + 현장 작업 공간(Task 9):
// 현장 밖 경로라 페이지가 현장 헤더를 직접 그리고, 브레드크럼은 탭 이름(측정위치)부터 시작한다(스펙 §4.3).
// Next.js 16 + Vitest는 async 서버 컴포넌트 render()를 지원하지 않는다 - 페이지 함수를 await 해 반환 트리를 본다.
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND'); },
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
// perf-auth-roundtrips: 페이지는 proxy가 검증해 실은 x-flatness-user-* 헤더를 읽는다(getRequestUser).
// 이메일은 proxy가 encodeURIComponent로 싣는다 - getRequestUser의 실제 코드가 그대로 돈다.
vi.mock('next/headers', () => ({
  headers: async () => new Headers({
    'x-flatness-user-id': 'u1',
    'x-flatness-user-email': encodeURIComponent('u1@example.com'),
  }),
}));
// 헤더 내부(현장 바꾸기·계정 메뉴)는 Task 2 몫이다. 여기서는 무엇을 넘기는지만 본다.
vi.mock('@/components/shell/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/shell/entry-header', () => ({ EntryHeader: () => null }));

import { createClient } from '@/lib/supabase/server';
import NewRegistrationPage from '../page';
import { RegistrationCreateForm } from '@/components/registration/registration-create-form';
import { EntryHeader } from '@/components/shell/entry-header';
import { SiteHeader } from '@/components/shell/site-header';
import { Alert } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import type { ScanRow } from '@/lib/domain/types';

function scan(id: string, over: Partial<ScanRow> = {}): ScanRow {
  return {
    id, location_id: 'l1', surface: 'floor', scanned_at: '2026-08-01', device: null,
    operator_id: null, operator_name_manual: null, selected_criteria_id: null,
    raw_file_path: null, original_filename: `${id}.ply`, file_format: 'ply', point_count: 1,
    unit_scale: 1, lineage: 'raw', status: 'ready',
    height_view_path: `artifacts/scans/OTHER-${id}/hv.png`,
    deleted_at: null, created_at: '', updated_at: '', ...over,
  } as ScanRow;
}

const LOCATION = {
  id: 'l1', site_id: 's1', building: '본관', floor: '1층', floor_order: 1, room: '로비',
  name: '로비', memo: null, created_at: '', updated_at: '',
};
const SITE = { id: 's1', name: '본관 현장', address: null, memo: null, created_at: '', updated_at: '' };

function chain(result: { data: unknown; error: null }, spy?: (m: string, ...a: unknown[]) => void) {
  const obj: Record<string, unknown> = {
    select: (...a: unknown[]) => { spy?.('select', ...a); return obj; },
    eq: (...a: unknown[]) => { spy?.('eq', ...a); return obj; },
    is: (...a: unknown[]) => { spy?.('is', ...a); return obj; },
    order: (...a: unknown[]) => { spy?.('order', ...a); return obj; },
    maybeSingle: async () => result,
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

/** 트리의 문자열 자식을 모은다(JSON.stringify는 컴포넌트 참조가 순환이라 못 쓴다). */
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!node || typeof node !== 'object') return '';
  // 프리미티브(Alert·PageHeader)는 문구를 title/description prop으로 받는다 - children만 걷으면 놓친다.
  const props = (node as ReactElement<{ title?: unknown; description?: unknown; children?: unknown }>).props;
  return [props?.title, props?.description, props?.children].map(textOf).join('');
}

function mount(scans: ScanRow[], o: { spy?: (m: string, ...a: unknown[]) => void; site?: unknown } = {}) {
  vi.mocked(createClient).mockResolvedValue({
    from: (table: string) => {
      if (table === 'locations') return chain({ data: LOCATION, error: null });
      if (table === 'sites') return chain({ data: o.site === undefined ? SITE : o.site, error: null });
      if (table === 'scans') return chain({ data: scans, error: null }, o.spy);
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  } as never);
  return NewRegistrationPage({ searchParams: Promise.resolve({ location: 'l1' }) });
}

describe('NewRegistrationPage 후보 스캔', () => {
  it('삭제된 스캔을 제외하고 바닥 스캔만 조회한다', async () => {
    const spy = vi.fn();
    await mount([scan('a'), scan('b')], { spy });

    expect(spy).toHaveBeenCalledWith('is', 'deleted_at', null);
    // 벽 스캔은 범위 밖이다 - 높이 뷰가 256x1 픽셀 띠라 클릭이 성립하지 않는다.
    expect(spy).toHaveBeenCalledWith('eq', 'surface', 'floor');
  });

  it('높이 뷰·단위가 없는 스캔은 후보에서 뺀다', async () => {
    const el = await mount([
      scan('ok1'), scan('ok2'),
      scan('noview', { height_view_path: null }),
      scan('nounit', { unit_scale: null }),
      scan('notready', { status: 'awaiting_unit_confirm' }),
    ]);
    const form = findByType(el, RegistrationCreateForm);

    const ids = (form!.props as { scans: ScanRow[] }).scans.map((s) => s.id);
    expect(ids).toEqual(['ok1', 'ok2']);
  });

  it('후보가 2개 미만이면 폼 대신 이유를 안내하고 이 현장의 업로드로 보낸다', async () => {
    const el = await mount([scan('ok1')]);

    expect(findByType(el, RegistrationCreateForm)).toBeNull();
    expect(textOf(el)).toContain('두 개 이상');
    expect(textOf(el)).toContain('후보는 1개');
    // 안내는 warning Alert + 막다른 화면 금지(업로드로 가는 주 LinkButton)
    const alert = findByType(el, Alert);
    expect((alert!.props as { type: string }).type).toBe('warning');
    expect((alert!.props as { title: string }).title).toBe('정합할 수 있는 스캔이 두 개 이상 필요합니다.');
    const upload = findByType(el, LinkButton);
    // 현장 작업 공간(Task 9): 옛 /upload?site=&location= 은 리다이렉트 경로다 - 새 주소로 바로 보낸다
    expect((upload!.props as { href: string }).href).toBe('/sites/s1/upload?location=l1');
    expect((upload!.props as { variant: string }).variant).toBe('primary');
  });

  it('location 파라미터가 없거나 측정위치가 없으면 notFound로 보낸다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (table: string) => {
        if (table === 'locations') return chain({ data: null, error: null });
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
    } as never);
    await expect(NewRegistrationPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND');
    await expect(NewRegistrationPage({ searchParams: Promise.resolve({ location: 'nope' }) })).rejects.toThrow('NOT_FOUND');
  });
});

describe('NewRegistrationPage 현장 헤더·브레드크럼·본문 (Task 9, 스펙 §4.3)', () => {
  it('측정위치의 현장으로 현장 헤더를 그리고 계정 이메일을 넘긴다', async () => {
    const el = await mount([scan('a'), scan('b')]);
    expect(findByType(el, SiteHeader)!.props).toEqual({ site: { id: 's1', name: '본관 현장' }, email: 'u1@example.com' });
    expect(findByType(el, EntryHeader)).toBeNull();
  });

  it('현장 행을 읽지 못하면 진입 헤더로 대신한다(막다른 화면 금지)', async () => {
    const el = await mount([scan('a'), scan('b')], { site: null });
    expect(findByType(el, SiteHeader)).toBeNull();
    expect(findByType(el, EntryHeader)!.props).toEqual({ email: 'u1@example.com' });
  });

  it('브레드크럼은 측정위치 / 측정위치 표기(" · ") / 스캔 정합 시작', async () => {
    const el = await mount([scan('a'), scan('b')]);
    const props = findByType(el, PageHeader)!.props as { crumbs: { href?: string; label: string }[]; title: string };
    expect(props.crumbs).toEqual([
      { href: '/sites/s1/locations', label: '측정위치' },
      { href: '/sites/s1/locations#loc-l1', label: '본관 · 1층 · 로비 · 로비' },
      { label: '스캔 정합 시작' },
    ]);
    expect(props.title).toBe('스캔 정합 시작');
  });

  // 아트보드 RegistrationNew: 본문은 MAIN_BG <main> > PAGE_MAIN > 760px 열. 안내문은 h1 아래 설명(측정위치는 ' / ').
  it('본문은 MAIN_BG <main> 안 PAGE_MAIN, 그 안 760px 열에 머리와 폼이 있다', async () => {
    const el = await mount([scan('a'), scan('b')]);
    const main = findByType(el, 'main')!;
    expect((main.props as { className: string }).className).toBe(MAIN_BG);
    const body = (main.props as { children: ReactElement }).children;
    expect((body.props as { className: string }).className).toBe(PAGE_MAIN);
    const column = (body.props as { children: ReactElement }).children;
    expect((column.props as { className: string }).className).toContain('max-w-[760px]');
    expect(findByType(column, PageHeader)).not.toBeNull();
    expect(findByType(column, RegistrationCreateForm)).not.toBeNull();

    const props = findByType(el, PageHeader)!.props as { description: string };
    expect(props.description).toContain('본관 / 1층 / 로비 / 로비 측정위치의 바닥 스캔 두 개를 하나로 합칩니다');
    expect(props.description).toContain('서브셀 중앙값 점군 하나로 병합합니다.');
  });
});

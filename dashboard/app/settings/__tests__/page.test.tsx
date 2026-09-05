// 설정 페이지 배선: PAGE_MAIN 본문 + PageHeader(현장 › 설정) + Container 3개(프로필 / 측정 불확도 U /
// 판정 기준), app_settings 미설정 시 U 기본값 {floor: 5, wall: 8}, 사용자 없으면 /login 리다이렉트.
// Vitest는 async 서버 컴포넌트 render()를 지원하지 않으므로(node_modules/next/dist/docs/
// 01-app/02-guides/testing/vitest.md) app/__tests__/page.test.tsx와 같이 엘리먼트 트리를 재귀 탐색한다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/auth/request-user', () => ({ getRequestUser: vi.fn() }));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfile: vi.fn() }));
vi.mock('next/navigation', () => ({
  // 실제 redirect()는 throw로 렌더를 끊는다 - 같은 계약으로 흉내낸다.
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getRequestUser } from '@/lib/auth/request-user';
import { ensureProfile } from '@/lib/auth/ensure-profile';
import SettingsPage from '../page';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { Container } from '@/components/ui/container';
import { ProfileForm } from '@/components/settings/profile-form';
import { UncertaintyForm } from '@/components/settings/uncertainty-form';
import { CriteriaList } from '@/components/settings/criteria-list';

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

// Supabase 쿼리 빌더 흉내: 체이닝은 자기 자신, await 대상이 되면(thenable) 정해 둔 결과로 resolve.
// app_settings는 .maybeSingle()로 끝나므로 그 메서드만 진짜 Promise를 돌려준다.
function chain(result: { data: unknown; error: null }) {
  const obj: Record<string, unknown> = {
    select: () => obj, order: () => obj, eq: () => obj,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

// criteria / app_settings / sites 세 쿼리가 Promise.all로 나간다(profiles는 ensureProfile 목이 받는다).
function stubSupabase(opts: { criteria?: unknown[]; setting?: { value: unknown } | null; sites?: unknown[] }) {
  return {
    from: (table: string) => {
      if (table === 'criteria') return chain({ data: opts.criteria ?? [], error: null });
      if (table === 'app_settings') return chain({ data: opts.setting ?? null, error: null });
      if (table === 'sites') return chain({ data: opts.sites ?? [], error: null });
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

function loggedIn(opts: Parameters<typeof stubSupabase>[0] = {}) {
  vi.mocked(createClient).mockResolvedValue(stubSupabase(opts) as never);
  vi.mocked(getRequestUser).mockResolvedValue({ id: 'u1', email: 'u1@example.com' });
  vi.mocked(ensureProfile).mockResolvedValue({ id: 'u1', display_name: '홍길동' });
}

const criteriaRow = {
  id: 'g1', site_id: null, surface: 'floor', name: 'floor-kcs-exposed',
  source_text: 'KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)',
  thresholds: [{ span_m: 3, metric: 'flatness', pass_mm: 7, rework_mm: 21 }],
  is_default: true, is_active: true, version: 1, supersedes_id: null, created_at: '', kind: 'flatness',
};

describe('SettingsPage 가드', () => {
  it('사용자 헤더가 없으면 /login으로 리다이렉트한다(방어 심층 가드 유지)', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase({}) as never);
    vi.mocked(getRequestUser).mockResolvedValue(null);
    await expect(SettingsPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});

describe('SettingsPage 렌더 (Cloudscape 아트보드 Settings)', () => {
  it('PAGE_MAIN 본문 + 브레드크럼 현장 › 설정 + Container 3개를 순서대로 그린다', async () => {
    loggedIn();
    const el = (await SettingsPage()) as { type: unknown; props: Record<string, unknown> };

    expect(el.type).toBe('main');
    expect(el.props.className).toBe(PAGE_MAIN);

    const [header] = findAll(el, PageHeader);
    expect(header.props.title).toBe('설정');
    expect(header.props.crumbs).toEqual([{ href: '/', label: '현장' }, { label: '설정' }]);

    const containers = findAll(el, Container);
    expect(containers.map((c) => c.props.title)).toEqual(['프로필', '측정 불확도 U', '판정 기준']);
    expect(containers[2].props.padded).toBe(false); // 테이블 컨테이너는 본문 padding 없음

    // U 설명문은 컨테이너 본문(폼 위)에 그대로 남는다(문구 무변경)
    expect(collectText(containers[1]).join('')).toContain('판정식의 경계 구간 폭을 결정합니다');

    const [profile] = findAll(el, ProfileForm);
    expect(profile.props).toMatchObject({ userId: 'u1', initialName: '홍길동' });
  });

  it('app_settings에 값이 없으면 U 기본값 {floor: 5, wall: 8}을, 있으면 그 값을 폼에 넘긴다', async () => {
    loggedIn({ setting: null });
    let [form] = findAll(await SettingsPage(), UncertaintyForm);
    expect(form.props.initial).toEqual({ floor: 5, wall: 8 });

    loggedIn({ setting: { value: { floor: 3, wall: 6 } } });
    [form] = findAll(await SettingsPage(), UncertaintyForm);
    expect(form.props.initial).toEqual({ floor: 3, wall: 6 });
  });

  it('criteria 행 전체와 현장명 맵을 CriteriaList에 넘긴다', async () => {
    loggedIn({ criteria: [criteriaRow], sites: [{ id: 's1', name: '현장A' }] });
    const [list] = findAll(await SettingsPage(), CriteriaList);
    expect(list.props.criteria).toEqual([criteriaRow]);
    expect((list.props.siteNames as Map<string, string>).get('s1')).toBe('현장A');
  });
});

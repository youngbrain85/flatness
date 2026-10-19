// 설정 페이지 배선(스펙 §5 17행): 진입 헤더 + MAIN_BG <main> > PAGE_MAIN + PageHeader(현장 목록 / 설정)
// + 카드 둘(프로필 / 측정 불확도 U, 각 flex 1 1 420px) + 판정 기준 구획(카드 아님), app_settings 미설정 시
// U 기본값 {floor: 5, wall: 8}, 사용자 없으면 /login 리다이렉트. Vitest는 async 서버 컴포넌트 render()를
// 지원하지 않으므로 엘리먼트 트리를 재귀 탐색한다.
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
vi.mock('@/components/shell/entry-header', () => ({ EntryHeader: () => null }));

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getRequestUser } from '@/lib/auth/request-user';
import { ensureProfile } from '@/lib/auth/ensure-profile';
import SettingsPage, { metadata } from '../page';
import { EntryHeader } from '@/components/shell/entry-header';
import { Container } from '@/components/ui/container';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { CriteriaList } from '@/components/settings/criteria-list';
import { ProfileForm } from '@/components/settings/profile-form';
import { UncertaintyForm } from '@/components/settings/uncertainty-form';
import { SupabaseErrorNotice } from '@/components/supabase-error';

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
function chain(result: { data: unknown; error: { message: string } | null }) {
  const obj: Record<string, unknown> = {
    select: () => obj, order: () => obj, eq: () => obj,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

// criteria / app_settings / sites 세 쿼리가 Promise.all로 나간다(profiles는 ensureProfile 목이 받는다).
function stubSupabase(opts: {
  criteria?: unknown[]; setting?: { value: unknown } | null; sites?: unknown[];
  /** 그 테이블 조회만 실패시킨다(데이터 null + error) */
  errors?: Partial<Record<'criteria' | 'app_settings' | 'sites', string>>;
}) {
  const err = (t: 'criteria' | 'app_settings' | 'sites') => (opts.errors?.[t] ? { message: opts.errors[t] as string } : null);
  return {
    from: (table: string) => {
      if (table === 'criteria') return chain(err('criteria') ? { data: null, error: err('criteria') } : { data: opts.criteria ?? [], error: null });
      if (table === 'app_settings') return chain(err('app_settings') ? { data: null, error: err('app_settings') } : { data: opts.setting ?? null, error: null });
      if (table === 'sites') return chain(err('sites') ? { data: null, error: err('sites') } : { data: opts.sites ?? [], error: null });
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

// 후속(2026-10-18): 저장된 U 를 읽지 못했는데 기본값(5/8)을 저장값처럼 보여 주면, 한 칸만 고쳐
// 저장할 때 다른 칸이 기본값으로 덮인다. 판정 기준을 못 읽으면 '(0)' 빈 표가 사실처럼 보인다.
// 다른 화면처럼 조회 오류 안내로 끊고 폼·표를 그리지 않는다.
describe('SettingsPage 조회 실패', () => {
  it.each(['app_settings', 'criteria', 'sites'] as const)('%s 조회가 실패하면 폼·표 대신 오류 안내만 그린다', async (table) => {
    loggedIn({ errors: { [table]: `${table} 읽기 실패` } });
    const el = await SettingsPage();

    const [notice] = findAll(el, SupabaseErrorNotice);
    expect(notice.props.message).toBe(`${table} 읽기 실패`);
    expect(findAll(el, UncertaintyForm)).toHaveLength(0);
    expect(findAll(el, ProfileForm)).toHaveLength(0);
    expect(findAll(el, CriteriaList)).toHaveLength(0);
    expect(findAll(el, EntryHeader)).toHaveLength(1);
    expect((findAll(el, PageHeader)[0].props.crumbs as { label: string }[]).map((c) => c.label)).toEqual(['현장 목록', '설정']);
  });
});

describe('SettingsPage 렌더 (아트보드 Settings)', () => {
  it('진입 헤더(계정 이메일) + MAIN_BG <main> > PAGE_MAIN + 브레드크럼 현장 목록 / 설정', async () => {
    loggedIn();
    const el = await SettingsPage();

    const [header] = findAll(el, EntryHeader);
    expect(header.props).toEqual({ email: 'u1@example.com' });
    const [main] = findAll(el, 'main');
    expect(main.props.className).toBe(MAIN_BG);
    const body = main.props.children as { props: Record<string, unknown> };
    expect(body.props.className).toBe(PAGE_MAIN);

    const [pageHeader] = findAll(el, PageHeader);
    expect(pageHeader.props.title).toBe('설정');
    expect(pageHeader.props.crumbs).toEqual([{ href: '/', label: '현장 목록' }, { label: '설정' }]);
  });

  it('카드 둘(프로필 / 측정 불확도 U)이 나란히(flex 1 1 420px), 판정 기준은 카드가 아닌 구획이다', async () => {
    loggedIn();
    const el = await SettingsPage();

    const containers = findAll(el, Container);
    expect(containers.map((c) => c.props.title)).toEqual(['프로필', '측정 불확도 U']);
    for (const c of containers) expect(c.props.className).toContain('flex-[1_1_420px]');
    // U 설명문은 카드 본문(폼 위)에 그대로 남는다(문구 무변경)
    expect(collectText(containers[1]).join('')).toContain('판정식의 경계 구간 폭을 결정합니다');

    const [section] = findAll(el, 'section');
    expect(collectText(section).join('')).toContain('판정 기준');
    expect(findAll(section, CriteriaList)).toHaveLength(1);

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

// 변이 실험(Task 11 보강): 위 단언만으로는 <title>, ensureProfile 호출 인자, 조회 인자(테이블·select·정렬·조건),
// 세 조회가 한꺼번에 나가는지(Promise.all), U 설명문 전문이 조용히 틀어져도 통과했다.
// 위 stubSupabase 는 select·order·eq 의 인자를 무시하고 응답이 즉시 온다 - 아래 흉내는 인자를 적고,
// 실제 Supabase 빌더처럼 await 될 때 요청이 나가며 응답은 한 박자 늦게 온다.
function recordingSupabase() {
  const calls: Record<string, string[]> = { criteria: [], app_settings: [], sites: [] };
  const requested: string[] = []; // 요청이 나간 순서(테이블)
  const requestedWhenAnswered: Record<string, string[]> = {}; // 응답이 도착한 시점에 이미 요청이 나간 테이블
  function query(table: string) {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'eq']) {
      q[method] = (...args: unknown[]) => {
        calls[table].push(`${method}(${args.map((a) => JSON.stringify(a)).join(', ')})`);
        return q;
      };
    }
    const lazy = {
      then: (resolve: (v: unknown) => void) => {
        requested.push(table);
        setTimeout(() => {
          requestedWhenAnswered[table] = [...requested];
          resolve({ data: table === 'app_settings' ? null : [], error: null });
        }, 0);
      },
    };
    q.maybeSingle = () => { calls[table].push('maybeSingle()'); return lazy; };
    q.then = lazy.then;
    return q;
  }
  const client = {
    from: (table: string) => {
      if (!(table in calls)) throw new Error(`예상치 못한 테이블: ${table}`);
      return query(table);
    },
  };
  return { client, calls, requestedWhenAnswered };
}

function loggedInRecording() {
  const recording = recordingSupabase();
  vi.mocked(createClient).mockResolvedValue(recording.client as never);
  vi.mocked(getRequestUser).mockResolvedValue({ id: 'u1', email: 'u1@example.com' });
  vi.mocked(ensureProfile).mockClear();
  vi.mocked(ensureProfile).mockResolvedValue({ id: 'u1', display_name: '홍길동' });
  return recording;
}

describe('SettingsPage 보강 (변이 실험으로 드러난 빈틈)', () => {
  it('<title>은 화면 이름 "설정"이다(앞의 "Flatness · "는 루트 title.template 이 붙인다)', () => {
    expect(metadata.title).toBe('설정');
  });

  it('로그인한 사용자와 같은 클라이언트로 프로필을 보장한다(로그인 직후 실패했어도 여기서 복구)', async () => {
    const { client } = loggedInRecording();
    await SettingsPage();
    expect(ensureProfile).toHaveBeenCalledTimes(1);
    expect(ensureProfile).toHaveBeenCalledWith(client, { id: 'u1', email: 'u1@example.com' });
  });

  it('조회는 criteria(전역 먼저 · 표면 · 이름 순) · app_settings(uncertainty_mm) · sites 세 건이다', async () => {
    const { calls } = loggedInRecording();
    await SettingsPage();
    expect(calls.criteria).toEqual([
      'select("*")',
      'order("site_id", {"ascending":true,"nullsFirst":true})',
      'order("surface")',
      'order("name")',
    ]);
    expect(calls.app_settings).toEqual(['select("value")', 'eq("key", "uncertainty_mm")', 'maybeSingle()']);
    expect(calls.sites).toEqual(['select("id, name")']);
  });

  it('세 조회는 한꺼번에 나간다 - 하나가 끝나길 기다렸다가 다음을 부르지 않는다(Promise.all)', async () => {
    const { requestedWhenAnswered } = loggedInRecording();
    await SettingsPage();
    for (const table of ['criteria', 'app_settings', 'sites']) {
      expect([...requestedWhenAnswered[table]].sort()).toEqual(['app_settings', 'criteria', 'sites']);
    }
  });

  it('U 설명문은 문장 그대로 카드 본문(폼 위)에 남는다', async () => {
    loggedIn();
    const containers = findAll(await SettingsPage(), Container);
    expect(collectText(containers[1]).join('')).toContain(
      '판정식의 경계 구간 폭을 결정합니다. 분석 시점 값이 결과에 스냅샷되므로 수정해도 과거 분석·보고서는 바뀌지 않습니다. '
      + 'P5 반복 스캔 재현성 시험 후 갱신 예정.',
    );
  });
});

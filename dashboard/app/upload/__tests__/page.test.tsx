// 옛 업로드 경로(스펙 §4.2): ?location=X 는 X 가 속한 현장의 업로드로 영구 이동(308), 위치가 없거나
// 찾지 못하면 진입 페이지로(307). redirect 계열은 throw 로 렌더를 끊으므로 mock 이 그 throw 를 재현한다.
// 옮긴 업로드 본문의 테스트는 app/sites/[id]/upload/__tests__/page.test.tsx 가 그대로 지킨다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({
  lookup: { row: null as { id: string; site_id: string } | null, eqCalls: [] as unknown[][] },
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
  permanentRedirect: (to: string) => { throw new Error(`PERMANENT_REDIRECT:${to}`); },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== 'locations') throw new Error(`예상치 못한 테이블: ${table}`);
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => { lookup.eqCalls.push([col, val]); return chain; },
        maybeSingle: async () => ({ data: lookup.row, error: null }),
      };
      return chain;
    },
  }),
}));

import LegacyUploadPage from '../page';

const run = (search: { location?: string | string[]; site?: string | string[] }) =>
  LegacyUploadPage({ searchParams: Promise.resolve(search) });

beforeEach(() => {
  lookup.row = null;
  lookup.eqCalls = [];
});

describe('옛 /upload', () => {
  it('?location=X 이면 X 가 속한 현장의 업로드로 영구 이동하고 위치 프리필을 잇는다', async () => {
    lookup.row = { id: 'l1', site_id: 's1' };
    await expect(run({ location: 'l1' })).rejects.toThrow(/^PERMANENT_REDIRECT:\/sites\/s1\/upload\?location=l1$/);
    expect(lookup.eqCalls).toEqual([['id', 'l1']]);
  });

  it('옛 링크의 site 값은 믿지 않고 위치의 site_id 로 간다', async () => {
    lookup.row = { id: 'l1', site_id: 's1' };
    await expect(run({ location: 'l1', site: 'WRONG' }))
      .rejects.toThrow(/^PERMANENT_REDIRECT:\/sites\/s1\/upload\?location=l1$/);
  });

  it('위치를 찾지 못하면 진입 페이지로 보낸다(영구 이동이 아니다)', async () => {
    await expect(run({ location: 'nope' })).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it('위치가 없거나 여러 개면 조회하지 않고 진입 페이지로 보낸다', async () => {
    await expect(run({})).rejects.toThrow(/^REDIRECT:\/$/);
    await expect(run({ location: ['l1', 'l2'] })).rejects.toThrow(/^REDIRECT:\/$/);
    expect(lookup.eqCalls).toEqual([]);
  });
});

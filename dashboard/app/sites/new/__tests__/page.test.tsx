// 옛 새 현장 화면(스펙 §4.2): 새 현장은 진입 페이지 안에서 만든다 - /sites/new 는 진입 페이지로 보낸다.
// 옛 NewSiteForm 과 그 검증 테스트는 Task 3 이 인라인 새 현장 카드(components/entry/new-site-card.tsx)로 옮기며 지웠다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));

import LegacyNewSitePage from '../page';

describe('옛 /sites/new', () => {
  it('진입 페이지(/)로 보낸다', () => {
    expect(() => LegacyNewSitePage()).toThrow(/^REDIRECT:\/$/);
  });
});

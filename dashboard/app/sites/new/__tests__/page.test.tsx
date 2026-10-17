// 옛 새 현장 화면(스펙 §4.2): 새 현장은 진입 페이지 안에서 만든다 - /sites/new 는 진입 페이지로 보낸다.
// NewSiteForm 의 검증 테스트(components/__tests__/new-site-form.test.tsx)는 Task 3 이 인라인 입력 카드로 옮길 때까지 남는다.
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

// 옛 전체 보고서 목록(스펙 §4.2): 보고서 목록은 현장 안(/sites/[id]/reports)으로 옮겼다 - /reports 는 진입 페이지로.
// 옮긴 목록 본문의 테스트는 app/sites/[id]/reports/__tests__/page.test.tsx 가 그대로 지킨다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));

import LegacyReportsPage from '../page';

describe('옛 /reports', () => {
  it('진입 페이지(/)로 보낸다', () => {
    expect(() => LegacyReportsPage()).toThrow(/^REDIRECT:\/$/);
  });
});

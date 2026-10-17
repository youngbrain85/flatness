// 임시(Task 2): 현장 첫 화면은 측정위치 탭으로 보낸다. Task 4 가 대시보드로 바꾸며 이 테스트도 바꾼다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));

import SiteIndexPage from '../page';

describe('/sites/[id] (임시)', () => {
  it('측정위치 탭(/sites/[id]/locations)으로 보낸다', async () => {
    await expect(SiteIndexPage({ params: Promise.resolve({ id: 's1' }) }))
      .rejects.toThrow(/^REDIRECT:\/sites\/s1\/locations$/);
  });
});

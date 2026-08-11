// D6: 구 URL(/analyses/[id], /scans/[id]/confirm-unit)이 T5(D5)로 이관된 스캔
// 작업대(/scans/[id]?analysis=[id])로 리다이렉트되는지 확인한다. next/navigation의
// redirect()는 내부적으로 throw하므로 mock으로 그 throw를 재현해 잡는다.
import { describe, expect, it, vi } from 'vitest';

const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
vi.mock('next/navigation', () => ({ redirect: redirectMock, notFound: vi.fn(() => { throw new Error('NOTFOUND'); }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'a1', scan_id: 's1' } }) }) }) }),
  }),
}));

describe('구 URL 리다이렉트', () => {
  it('/analyses/[id] -> /scans/[scanId]?analysis=[id]', async () => {
    // brief 원문은 '../../analyses/[id]/page'(2단계 상위)였으나, 이 테스트 파일의
    // 실제 위치(app/__tests__/redirects.test.tsx) 기준으로는 app/analyses/[id]/page.tsx까지
    // 1단계(app/__tests__ -> app)만 올라가면 된다 - app/__tests__/page.test.tsx가 이미
    // app/page.tsx를 '../page'(1단계)로 임포트하는 것과 같은 규약이다.
    const Page = (await import('../analyses/[id]/page')).default;
    await expect(Page({ params: Promise.resolve({ id: 'a1' }) })).rejects.toThrow('REDIRECT:/scans/s1?analysis=a1');
  });
  it('/scans/[id]/confirm-unit -> /scans/[id]', async () => {
    const Page = (await import('../scans/[id]/confirm-unit/page')).default;
    await expect(Page({ params: Promise.resolve({ id: 's1' }) })).rejects.toThrow('REDIRECT:/scans/s1');
  });
});

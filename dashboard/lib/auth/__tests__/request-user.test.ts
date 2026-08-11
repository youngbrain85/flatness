// getRequestUser: proxy가 검증해 실어 준 x-flatness-user-* 요청 헤더를 읽는 헬퍼.
// 네트워크 왕복 없이 헤더만 파싱하며, 헤더가 없으면 null을 돌려줘 호출부의
// `if (!user) redirect('/login')` 가드가 기존처럼 동작하게 한다(방어 심층).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestUser } from '../request-user';

// next/headers의 headers()는 요청 스코프 밖(테스트)에서 던지므로 흉내낸다
const mockHeaders = vi.fn();
vi.mock('next/headers', () => ({ headers: () => mockHeaders() }));

function withHeaders(entries: Record<string, string>) {
  mockHeaders.mockResolvedValue(new Headers(entries));
}

beforeEach(() => { mockHeaders.mockReset(); });

describe('getRequestUser', () => {
  it('id·email 헤더가 있으면 { id, email }을 반환한다(email은 디코딩)', async () => {
    withHeaders({
      'x-flatness-user-id': 'u1',
      'x-flatness-user-email': encodeURIComponent('young+qa@x.com'),
    });
    expect(await getRequestUser()).toEqual({ id: 'u1', email: 'young+qa@x.com' });
  });

  it('id 헤더가 없으면 null을 반환한다(폴백 - 호출부 가드가 처리)', async () => {
    withHeaders({});
    expect(await getRequestUser()).toBeNull();
  });

  it('email 헤더만 없으면 { id, email: null }을 반환한다', async () => {
    withHeaders({ 'x-flatness-user-id': 'u2' });
    expect(await getRequestUser()).toEqual({ id: 'u2', email: null });
  });
});

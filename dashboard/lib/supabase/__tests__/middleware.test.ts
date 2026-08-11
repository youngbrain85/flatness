// updateSession(proxy 경유)의 인증 헤더 계약 테스트.
//
// 핵심 보안 속성: x-flatness-user-* 헤더는 외부에서 위조해 실어 보낼 수 있으므로,
// proxy는 들어온 값을 반드시 버리고 자신이 Supabase Auth 서버로 검증한 값만
// 다운스트림에 실어야 한다. 다운스트림 요청 헤더는 NextResponse.next({ request })가
// 응답의 x-middleware-request-<이름> + x-middleware-override-headers로 인코딩한다
// (node_modules/next/dist/server/web/spec-extension/response.js) - 그 실제 메커니즘을
// 그대로 검증한다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { updateSession } from '../middleware';

// Supabase Auth 서버 왕복(auth.getUser)만 흉내낸다. 쿠키 핸들러는 실제 코드가
// 넘긴 것을 붙잡아 두었다가 테스트가 직접 발화시킨다(토큰 갱신 시나리오).
const mockGetUser = vi.fn();
let capturedCookieHandlers: {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void;
} | null = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: {
    cookies: {
      getAll(): { name: string; value: string }[];
      setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void;
    };
  }) => {
    capturedCookieHandlers = opts.cookies;
    return { auth: { getUser: mockGetUser } };
  },
}));

// 위조 요청: 공격자가 인증 헤더를 미리 실어 보낸 상황
function spoofedRequest(path: string) {
  return new NextRequest(`http://localhost:3902${path}`, {
    headers: {
      'x-flatness-user-id': 'attacker-id',
      'x-flatness-user-email': encodeURIComponent('attacker@evil.example'),
    },
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  capturedCookieHandlers = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
});

describe('updateSession - 인증 헤더 위조 차단', () => {
  it('위조된 x-flatness-user-* 헤더를 버리고 검증된 값으로 교체한다', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'real-id', email: 'real@site.example' } } });
    const res = await updateSession(spoofedRequest('/settings'));
    expect(res.headers.get('x-middleware-request-x-flatness-user-id')).toBe('real-id');
    expect(res.headers.get('x-middleware-request-x-flatness-user-email'))
      .toBe(encodeURIComponent('real@site.example'));
  });

  it('미로그인 + /login 경로면 위조 헤더가 다운스트림에서 완전히 제거된다', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(spoofedRequest('/login'));
    expect(res.headers.get('x-middleware-request-x-flatness-user-id')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-flatness-user-email')).toBeNull();
    // override 목록에도 남으면 안 된다 - 목록에 있으면 Next가 그 이름을 요청 헤더로 되살린다
    const override = res.headers.get('x-middleware-override-headers') ?? '';
    expect(override).not.toContain('x-flatness-user-id');
    expect(override).not.toContain('x-flatness-user-email');
  });

  it('email이 없는 계정이면 email 헤더를 세팅하지 않는다(id만 실린다)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'real-id' } } });
    const res = await updateSession(spoofedRequest('/settings'));
    expect(res.headers.get('x-middleware-request-x-flatness-user-id')).toBe('real-id');
    expect(res.headers.get('x-middleware-request-x-flatness-user-email')).toBeNull();
  });
});

describe('updateSession - 기존 동작 회귀 차단', () => {
  it('미로그인 + 보호 경로면 /login으로 리다이렉트한다', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(spoofedRequest('/settings'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('getUser 중 토큰 갱신(setAll)이 일어나도 Set-Cookie가 최종 응답에 보존된다', async () => {
    // 헤더를 실은 최종 응답을 새로 만들며 setAll이 실어 둔 갱신 쿠키를 떨어뜨리면
    // 세션 갱신이 조용히 무효화된다 - 재구성 리팩터링의 회귀 위험 지점.
    mockGetUser.mockImplementation(async () => {
      capturedCookieHandlers!.setAll([
        { name: 'sb-token', value: 'refreshed', options: { path: '/' } },
      ]);
      return { data: { user: { id: 'real-id', email: 'real@site.example' } } };
    });
    const res = await updateSession(spoofedRequest('/settings'));
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith('sb-token=refreshed'))).toBe(true);
    // 갱신 쿠키를 보존하면서도 검증 헤더는 실려 있어야 한다(둘 다 성립해야 한다)
    expect(res.headers.get('x-middleware-request-x-flatness-user-id')).toBe('real-id');
  });
});

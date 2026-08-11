// 세션 갱신 + 미로그인 리다이렉트. dashboard/proxy.ts(Next.js 16 proxy 컨벤션)에서 호출한다.
// 추가 역할(perf-auth-roundtrips): 여기서 1회 검증한 user의 id·email을 다운스트림
// 요청 헤더로 실어, 서버 컴포넌트가 Auth 서버 왕복 없이 읽게 한다(lib/auth/request-user.ts).
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { USER_EMAIL_HEADER, USER_ID_HEADER } from '@/lib/auth/user-headers';

export async function updateSession(request: NextRequest) {
  // ★ 위조 차단: x-flatness-user-*는 외부에서 임의로 실어 보낼 수 있으므로 검증 전에
  // 무조건 제거한다. NextResponse.next({ request })는 생성 시점의 request.headers를
  // 다운스트림 요청 헤더로 인코딩하므로(proxy.md "Setting Headers" - request 필드로
  // 넘겨야 앱으로 간다), 제거는 반드시 응답 생성보다 먼저여야 한다.
  request.headers.delete(USER_ID_HEADER);
  request.headers.delete(USER_EMAIL_HEADER);
  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (user) {
    // 요청당 Auth 네트워크 왕복은 위 getUser 1회뿐이다 - 검증된 값만 헤더로 싣는다.
    request.headers.set(USER_ID_HEADER, user.id);
    // 헤더 값은 ISO-8859-1만 안전하므로 이메일은 인코딩해 싣는다(읽는 쪽에서 디코딩)
    if (user.email) request.headers.set(USER_EMAIL_HEADER, encodeURIComponent(user.email));
    // next()는 생성 시점의 request.headers만 인코딩하므로 헤더를 실은 응답을 새로
    // 만든다. getUser 중 토큰 갱신(setAll)이 supabaseResponse에 실어 둔 세션 쿠키는
    // cookies API로 옮겨 싣는다 - set-cookie 원문 복사가 아니라 cookies.set을 쓰는
    // 이유는 Next가 x-middleware-set-cookie 동기화까지 이 API에서 처리하기 때문.
    const headeredResponse = NextResponse.next({ request });
    for (const cookie of supabaseResponse.cookies.getAll()) {
      headeredResponse.cookies.set(cookie);
    }
    return headeredResponse;
  }
  return supabaseResponse;
}

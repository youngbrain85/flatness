// Next.js 16: 파일 컨벤션이 middleware -> proxy로 개명되었다(구 middleware.ts는 deprecated).
// 역할은 브리프의 middleware.ts와 동일 - 세션 갱신 + 미로그인 리다이렉트.
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// /api/*는 제외 - route handler가 각자 401 JSON으로 인증을 처리한다(리다이렉트는 fetch를 깨뜨림)
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};

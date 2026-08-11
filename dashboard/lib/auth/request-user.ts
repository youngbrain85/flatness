// proxy가 검증해 실어 준 사용자 헤더를 읽는 헬퍼 - 요청당 Auth 네트워크 왕복 0회.
// supabase.auth.getUser()는 쿠키 파싱이 아니라 Supabase Auth 서버 네트워크 검증
// (실측 1회 200~640ms)이라, 진짜 검증은 proxy(lib/supabase/middleware.ts) 1회로
// 끝내고 서버 컴포넌트는 이 헬퍼로 그 결과만 읽는다.
// 헤더가 없으면 null - 호출부의 `if (!user) redirect('/login')` 가드가 기존처럼
// 받는다(방어 심층: proxy matcher를 비껴가는 경로가 생겨도 여전히 안전하다).
import { headers } from 'next/headers';
import { USER_EMAIL_HEADER, USER_ID_HEADER } from './user-headers';

export interface RequestUser {
  id: string;
  email: string | null;
}

export async function getRequestUser(): Promise<RequestUser | null> {
  const h = await headers();
  const id = h.get(USER_ID_HEADER);
  if (!id) return null;
  // 이메일은 proxy가 encodeURIComponent로 실었다(헤더 값은 ISO-8859-1만 안전) - 되돌린다
  const rawEmail = h.get(USER_EMAIL_HEADER);
  return { id, email: rawEmail === null ? null : decodeURIComponent(rawEmail) };
}

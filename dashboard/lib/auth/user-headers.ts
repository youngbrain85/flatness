// proxy(lib/supabase/middleware.ts)가 Auth 검증 후 다운스트림에 실어 주는 헤더 이름.
// request-user.ts(next/headers 의존)와 분리해 둔 이유: proxy 번들은 요청 스코프
// 밖에서 돌므로 next/headers를 끌어들이지 않고 이름 상수만 공유해야 안전하다.
export const USER_ID_HEADER = 'x-flatness-user-id';
export const USER_EMAIL_HEADER = 'x-flatness-user-email';

// 상단 바(서버 컴포넌트): 로고 + 사용자 이메일. 검색·알림은 앱에 없어 넣지 않는다(스펙 §7-1).
// proxy가 검증해 실어 준 헤더만 읽는다(Auth 서버 왕복 0회 - perf-auth-roundtrips 유지).
import Link from 'next/link';
import { getRequestUser } from '@/lib/auth/request-user';
import { Icon } from '@/components/ui/icons';

export async function TopNav() {
  const user = await getRequestUser();
  return (
    <header className="flex h-11 shrink-0 items-center gap-6 bg-cs-topnav px-5 text-white">
      <Link href="/" className="flex items-center gap-2.5 text-base font-bold tracking-wide">
        <Icon name="trend" size={20} />
        FLATNESS
      </Link>
      {user?.email && (
        <span className="ml-auto inline-flex items-center gap-2 text-sm text-cs-topnav-text">
          <Icon name="user" size={18} />
          <span className="font-mono">{user.email}</span>
        </span>
      )}
    </header>
  );
}

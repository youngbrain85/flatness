'use client';
// 데스크톱 사이드 메뉴 + 모바일 상단 바 메뉴. 활성 판정은 pathname prefix.
// variant='mobile'은 최소 구현(햄버거 없이 가로 나열)이라 레이아웃만 다르고
// 메뉴 목록·활성 판정 로직은 desktop과 동일하게 공유한다.
import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';

const MENU = [
  { href: '/', label: '현장', match: (p: string) => p === '/' || p.startsWith('/sites') || p.startsWith('/scans') || p.startsWith('/registrations') },
  { href: '/reports', label: '보고서', match: (p: string) => p.startsWith('/reports') },
  { href: '/upload', label: '업로드', match: (p: string) => p.startsWith('/upload') },
  { href: '/settings', label: '설정', match: (p: string) => p.startsWith('/settings') },
];

// useLinkStatus는 Link의 자식 컴포넌트여야만 쓸 수 있다(next/link 문서 규약).
// 클릭 직후 서버 응답 전까지만 pending=true가 되어 해당 메뉴 항목에만 스피너가
// 뜬다 - 별도 state로 pending을 직접 흉내내지 않는다(라우터 상태 오추적 방지).
function NavPendingHint() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <Spinner size="sm" />;
}

export function SidebarNav({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' }) {
  const pathname = usePathname();

  if (variant === 'mobile') {
    return (
      <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-sm">
        {MENU.map((m) => {
          const active = m.match(pathname);
          return (
            <Link key={m.href} href={m.href}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 ${active
                ? 'bg-zinc-100 font-medium text-zinc-900'
                : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'}`}>
              {m.label}
              <NavPendingHint />
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-0.5 p-2 text-sm">
      {MENU.map((m) => {
        const active = m.match(pathname);
        return (
          <Link key={m.href} href={m.href}
            className={`inline-flex items-center gap-1.5 rounded-md border-l-2 px-3 py-1.5 ${active
              ? 'border-zinc-900 bg-zinc-100 font-medium text-zinc-900'
              : 'border-transparent text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'}`}>
            {m.label}
            <NavPendingHint />
          </Link>
        );
      })}
    </nav>
  );
}

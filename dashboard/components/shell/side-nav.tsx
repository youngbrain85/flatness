'use client';
// 사이드 내비(데스크톱 280px aside) + 모바일 가로 스트립. 활성 판정은 pathname prefix,
// 활성 항목은 aria-current="page"(테스트·접근성 모두 이 속성을 본다).
// 클릭 즉시 피드백: useLinkStatus는 Link의 자식에서만 쓸 수 있다(next/link 규약) -
// 별도 state로 pending을 흉내내지 않는다(라우터 상태 오추적 방지).
import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { LogoutButton } from '@/components/logout-button';

type MenuItem = { href: string; label: string; match: (p: string) => boolean };

export const MENU: MenuItem[] = [
  { href: '/', label: '현장', match: (p) => p === '/' || p.startsWith('/sites') || p.startsWith('/scans') || p.startsWith('/registrations') },
  { href: '/reports', label: '보고서', match: (p) => p.startsWith('/reports') },
  { href: '/upload', label: '업로드', match: (p) => p.startsWith('/upload') },
];
export const SETTINGS: MenuItem = { href: '/settings', label: '설정', match: (p) => p.startsWith('/settings') };

function NavPendingHint() {
  const { pending } = useLinkStatus();
  return pending ? <Spinner size="sm" /> : null;
}

const ITEM = 'flex items-center gap-2 py-2 text-sm';
const ACTIVE = 'text-cs-link font-bold';
const INACTIVE = 'text-cs-nav-text hover:text-cs-text';

function NavLink({ item, active, className }: { item: MenuItem; active: boolean; className: string }) {
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined}
      className={`${ITEM} ${className} ${active ? ACTIVE : INACTIVE}`}>
      {item.label}
      <NavPendingHint />
    </Link>
  );
}

export function SideNav() {
  const pathname = usePathname();
  const all = [...MENU, SETTINGS];
  return (
    <>
      {/* 모바일(<md): 캔버스에 설계가 없다 - 최소 동작(가로 스트립)만 보장. 세로 스택 안에서
          풀폭으로 놓이므로 2026-08-11 T1의 "세로 기둥" 사고가 재발하지 않는다. */}
      <nav aria-label="주 메뉴(모바일)"
        className="flex w-full items-center gap-4 overflow-x-auto border-b border-cs-divider bg-white px-4 md:hidden">
        {all.map((m) => <NavLink key={m.href} item={m} active={m.match(pathname)} className="shrink-0" />)}
      </nav>
      <aside className="hidden w-[280px] shrink-0 flex-col border-r border-cs-divider bg-white md:flex">
        <div className="border-b border-cs-divider px-7 pb-3 pt-5 text-base font-bold leading-5">평활도 분석 콘솔</div>
        <nav aria-label="주 메뉴" className="flex flex-col py-3">
          {MENU.map((m) => <NavLink key={m.href} item={m} active={m.match(pathname)} className="px-7" />)}
        </nav>
        <div className="mx-7 h-px bg-cs-divider" />
        <nav aria-label="관리 메뉴" className="flex flex-col py-3">
          <NavLink item={SETTINGS} active={SETTINGS.match(pathname)} className="px-7" />
          <LogoutButton className={`${ITEM} px-7 ${INACTIVE}`} />
        </nav>
      </aside>
    </>
  );
}

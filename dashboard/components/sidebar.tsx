// 사이드바 (서버 컴포넌트) - 활성 표시는 클라이언트 섬 SidebarNav가 담당
// 데스크톱은 좌측 고정 aside, 모바일(<md)은 상단 바 최소 구현(로고 + 4개 메뉴
// 가로 나열, 햄버거 드로어 없음)으로 스펙 §4를 만족한다.
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from './logout-button';
import { SidebarNav } from './sidebar-nav';

export async function Sidebar() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <>
      <header className="flex w-full items-center gap-3 border-b border-zinc-200 bg-white px-3 py-2 md:hidden">
        <Link href="/" className="shrink-0 font-mono text-sm font-semibold tracking-tight">
          FLATNESS
        </Link>
        <SidebarNav variant="mobile" />
      </header>
      {/* 리뷰 Minor 1: 설계 스펙 220px에 맞춘다(Tailwind 프리셋 w-56=224px는 폐기). */}
      <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
        <Link href="/" className="border-b border-zinc-200 px-4 py-4 font-mono text-sm font-semibold tracking-tight">
          FLATNESS<span className="text-zinc-400"> console</span>
        </Link>
        <SidebarNav />
        <div className="mt-auto border-t border-zinc-200 px-4 py-3 text-xs text-zinc-500">
          {user && <p className="mb-2 truncate font-mono">{user.email}</p>}
          <LogoutButton />
        </div>
      </aside>
    </>
  );
}

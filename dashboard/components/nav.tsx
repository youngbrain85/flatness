// 서버 컴포넌트
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from './logout-button';

export async function Nav() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="font-bold">평활도 대시보드</Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:underline">현장</Link>
          <Link href="/reports" className="hover:underline">보고서</Link>
          <Link href="/settings" className="hover:underline">설정</Link>
        </nav>
        {/* C1: 가장 자주 쓰는 동작(업로드)을 나머지 메뉴와 시각적으로 구분되는
            버튼으로 승격 — 처음 온 사용자가 "스캔파일 업로드 하는곳"을 바로
            찾을 수 있도록 한다. */}
        <Link href="/upload"
          className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
          업로드
        </Link>
        <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
          {user && <span>{user.email}</span>}
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

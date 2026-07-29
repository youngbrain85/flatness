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
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="hover:underline">현장</Link>
          <Link href="/upload" className="hover:underline">업로드</Link>
          <Link href="/reports" className="hover:underline">보고서</Link>
          <Link href="/settings" className="hover:underline">설정</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
          {user && <span>{user.email}</span>}
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

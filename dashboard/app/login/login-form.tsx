'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ensureProfile } from '@/lib/auth/ensure-profile';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError || !data.user) {
      setError('로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.');
      setBusy(false);
      return;
    }
    try {
      await ensureProfile(supabase, data.user);
    } catch {
      // 프로필 생성 실패가 로그인 자체를 막지는 않는다(설정 화면 저장 시 재시도 가능)
    }
    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">이메일</label>
        <input id="email" type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">비밀번호</label>
        <input id="password" type="password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full rounded bg-slate-800 py-2 text-white disabled:opacity-50">
        로그인
      </button>
      <p className="text-xs text-slate-500">
        계정은 관리자가 Supabase 대시보드(Authentication)에서 생성합니다.
      </p>
    </form>
  );
}

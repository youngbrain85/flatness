'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function NewSiteForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const { data, error: err } = await supabase.from('sites')
      .insert({ name: name.trim(), address: address.trim() || null, memo: memo.trim() || null })
      .select('id').single();
    if (err || !data) { setError(err?.message ?? '저장 실패'); return; }
    // push만 한다. 뒤에 router.refresh()를 붙이면 refresh가 "현재 라우트"를 다시
    // 렌더하면서 진행 중이던 이동을 취소한다(로그인 화면에서 실제로 재현된 결함).
    // sites/[id]는 force-dynamic이고 동적 페이지의 클라이언트 캐시 staleTime
    // 기본값은 0초(캐시 안 함)라, push만으로도 항상 서버에서 새로 받아온다.
    router.push(`/sites/${data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-3">
      <div>
        <label htmlFor="name" className="block text-sm font-medium">현장명 (필수)</label>
        <input id="name" required value={name} onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="address" className="block text-sm font-medium">주소</label>
        <input id="address" value={address} onChange={(e) => setAddress(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="memo" className="block text-sm font-medium">메모</label>
        <textarea id="memo" value={memo} onChange={(e) => setMemo(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" rows={3} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="rounded bg-slate-800 px-4 py-2 text-white">현장 등록</button>
    </form>
  );
}

'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function ProfileForm({ userId, initialName }: { userId: string; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // grant: authenticated는 display_name 컬럼만 update 가능 (001)
    const { error } = await createClient().from('profiles')
      .update({ display_name: name.trim() }).eq('id', userId);
    setMsg(error ? `저장 실패: ${error.message}` : '저장되었습니다');
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <div>
        <label htmlFor="display-name" className="block text-sm font-medium">표시 이름</label>
        <input id="display-name" required value={name} onChange={(e) => setName(e.target.value)}
          className="mt-1 rounded border px-3 py-2" />
      </div>
      <button type="submit" className="rounded bg-slate-800 px-3 py-2 text-sm text-white">저장</button>
      {msg && <span className="pb-2 text-xs text-slate-500">{msg}</span>}
    </form>
  );
}

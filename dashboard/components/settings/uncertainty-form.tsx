// U 값 (스펙 §4.2: app_settings, 분석 시점에 스냅샷되므로 수정해도 과거 분석은 불변. 수정 권한은 admin RLS)
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function UncertaintyForm({ initial }: { initial: { floor: number; wall: number } }) {
  const [floor, setFloor] = useState(String(initial.floor));
  const [wall, setWall] = useState(String(initial.wall));
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = { floor: parseFloat(floor), wall: parseFloat(wall) };
    if (!Number.isFinite(value.floor) || !Number.isFinite(value.wall) || value.floor <= 0 || value.wall <= 0) {
      setMsg('U는 0보다 큰 수치여야 합니다'); return;
    }
    // RLS 무음 거부 주의(criteria와 동일): 0행 갱신을 실패로 판정
    const { data, error } = await createClient().from('app_settings')
      .update({ value }).eq('key', 'uncertainty_mm').select('key');
    setMsg(error || !data || data.length === 0
      ? '수정에 실패했습니다. 측정 불확도는 관리자만 수정할 수 있습니다.'
      : '저장되었습니다 (이후 분석부터 적용)');
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2 text-sm">
      <div>
        <label htmlFor="u-floor" className="block font-medium">바닥 U(mm)</label>
        <input id="u-floor" value={floor} onChange={(e) => setFloor(e.target.value)}
          className="mt-1 w-24 rounded border px-2 py-1" />
      </div>
      <div>
        <label htmlFor="u-wall" className="block font-medium">벽면 U(mm)</label>
        <input id="u-wall" value={wall} onChange={(e) => setWall(e.target.value)}
          className="mt-1 w-24 rounded border px-2 py-1" />
      </div>
      <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-white">저장</button>
      {msg && <span className="pb-1.5 text-xs text-slate-500">{msg}</span>}
    </form>
  );
}

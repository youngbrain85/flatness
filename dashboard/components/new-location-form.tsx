// 입력 trim 정규화는 앱 레벨 책임(001 주석)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function NewLocationForm({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ building: '', floor: '', floorOrder: '0', room: '', name: '' });
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const { error: err } = await supabase.from('locations').insert({
      site_id: siteId,
      building: form.building.trim(),
      floor: form.floor.trim(),
      floor_order: parseInt(form.floorOrder, 10) || 0,
      room: form.room.trim(),
      name: form.name.trim(),
    });
    if (err) {
      setError(err.code === '23505' ? '같은 동/층/공간에 동일한 측정위치가 이미 있습니다.' : err.message);
      return;
    }
    setForm({ building: '', floor: '', floorOrder: '0', room: '', name: '' });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2 text-sm">
      {([
        ['building', '동', false], ['floor', '층', false], ['floorOrder', '층 순서(정수)', false],
        ['room', '공간', false], ['name', '측정위치', true],
      ] as const).map(([key, label, required]) => (
        <div key={key}>
          <label htmlFor={`loc-${key}`} className="block text-xs text-zinc-500">{label}</label>
          <input id={`loc-${key}`} required={required} value={form[key]} onChange={set(key)}
            className="w-28 rounded-md border border-zinc-300 px-2 py-1" />
        </div>
      ))}
      <button type="submit"
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">
        위치 추가
      </button>
      {error && <p className="w-full text-red-600">{error}</p>}
    </form>
  );
}

// 입력 trim 정규화는 앱 레벨 책임(001 주석)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormField, inputClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

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

  // 아트보드(SiteDetail '새 측정위치'): 필드 폭 동 120 · 층 120 · 층 순서 140 · 공간 140 · 측정위치 200,
  // 하단 정렬 + gap 16px. '위치 추가'는 현장 상세 뷰의 유일한 primary(스펙 §6).
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4 text-sm">
      {([
        ['building', '동', false, 'w-[120px]'], ['floor', '층', false, 'w-[120px]'],
        ['floorOrder', '층 순서(정수)', false, 'w-[140px]'],
        ['room', '공간', false, 'w-[140px]'], ['name', '측정위치', true, 'w-[200px]'],
      ] as const).map(([key, label, required, width]) => (
        <div key={key} className={width}>
          <FormField label={label} htmlFor={`loc-${key}`}>
            <input id={`loc-${key}`} required={required} value={form[key]} onChange={set(key)}
              className={key === 'floorOrder' ? `${inputClass} tabular-nums` : inputClass} />
          </FormField>
        </div>
      ))}
      <Button type="submit" variant="primary">
        <Icon name="plus" />
        위치 추가
      </Button>
      {error && <p className="w-full text-cs-error">{error}</p>}
    </form>
  );
}

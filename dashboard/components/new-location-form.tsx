// 입력 trim 정규화는 앱 레벨 책임(001 주석)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormField, inputClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

// 아트보드(SiteDetail '새 측정위치'): 동·층·층 순서·공간은 flex 1 1 170px, 측정위치는 2 1 240px로
// 한 줄에 놓이고 좁으면 접힌다. 아래 정렬(items-end) + 16px 간격.
// 층 순서 입력에는 inputMode="numeric"을 달지 않는다: iPhone(WebKit)이 빼기 키가 없는 숫자 키패드를 띄워
// 지하 같은 음수 층을 못 넣게 된다(floor_order는 제약 없는 정수고, 아트보드·옛 입력에도 inputmode가 없다).
const FIELDS = [
  ['building', '동', false, 'flex-[1_1_170px]'],
  ['floor', '층', false, 'flex-[1_1_170px]'],
  ['floorOrder', '층 순서(정수)', false, 'flex-[1_1_170px]'],
  ['room', '공간', false, 'flex-[1_1_170px]'],
  ['name', '측정위치', true, 'flex-[2_1_240px]'],
] as const;

export function NewLocationForm({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ building: '', floor: '', floorOrder: '0', room: '', name: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // 저장 중에 다시 제출하면 같은 위치를 한 번 더 insert 하고, 두 번째 insert 가 23505 로 돌아와 성공 직후에 "중복" 안내가 뜬다
    if (saving) return;
    setSaving(true);
    // 앞 제출의 안내는 이번 제출이 시작될 때 지운다 - 안 지우면 다음 제출이 성공해도 옛 안내가 그대로 남는다
    setError(null);
    try {
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
    } finally {
      // 새 현장 카드(entry/new-site-card.tsx)는 성공하면 다른 화면으로 이동해서 잠금을 풀 일이 없지만,
      // 이 폼은 성공해도 화면에 남아 다음 위치를 이어서 받는다 - 성공·실패 모두 잠금을 푼다
      setSaving(false);
    }
  }

  // '위치 추가'는 측정위치 탭 본문의 유일한 주 버튼이다(현장 헤더의 '스캔 업로드'는 셸 소속).
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
      {FIELDS.map(([key, label, required, basis]) => (
        <div key={key} className={`min-w-0 ${basis}`}>
          <FormField label={label} htmlFor={`new-loc-${key}`}>
            {key === 'floorOrder' ? (
              <input id={`new-loc-${key}`} type="number" step={1} value={form[key]}
                onChange={set(key)} className={`${inputClass} font-mono tabular-nums [color-scheme:dark]`} />
            ) : (
              <input id={`new-loc-${key}`} type="text" required={required} value={form[key]}
                onChange={set(key)} className={inputClass} />
            )}
          </FormField>
        </div>
      ))}
      <Button type="submit" variant="primary" className="shrink-0" disabled={saving}>
        <Icon name="plus" />
        위치 추가
      </Button>
      {error && <p role="alert" className="w-full text-sm text-err">{error}</p>}
    </form>
  );
}

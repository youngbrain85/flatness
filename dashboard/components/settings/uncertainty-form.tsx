// U 값 (스펙 §4.2: app_settings, 분석 시점에 스냅샷되므로 수정해도 과거 분석은 불변. 수정 권한은 admin RLS)
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormField, inputClass } from '@/components/ui/form';

// 수치 입력은 mono + tabular(스펙 §3). 아트보드 폭 96px = w-24.
const numberInputClass = `${inputClass} font-mono tabular-nums`;

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
    if (value.floor > 100 || value.wall > 100) {
      setMsg('U는 100mm 이하여야 합니다'); return;
    }
    // RLS 무음 거부 주의(criteria와 동일): 0행 갱신을 실패로 판정
    const { data, error } = await createClient().from('app_settings')
      .update({ value }).eq('key', 'uncertainty_mm').select('key');
    setMsg(error || !data || data.length === 0
      ? '수정에 실패했습니다. 측정 불확도는 관리자만 수정할 수 있습니다.'
      : '저장되었습니다 (이후 분석부터 적용)');
  }

  // 저장은 이 뷰의 primary(스펙 §6 Settings: "바닥/벽면 입력 + primary 저장" - 뷰당 primary 1개).
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="w-24">
        <FormField label="바닥 U(mm)" htmlFor="u-floor">
          <input id="u-floor" value={floor} onChange={(e) => setFloor(e.target.value)} className={numberInputClass} />
        </FormField>
      </div>
      <div className="w-24">
        <FormField label="벽면 U(mm)" htmlFor="u-wall">
          <input id="u-wall" value={wall} onChange={(e) => setWall(e.target.value)} className={numberInputClass} />
        </FormField>
      </div>
      <Button type="submit" variant="primary">저장</Button>
      {msg && <span className="pb-1.5 text-xs text-cs-text-secondary">{msg}</span>}
    </form>
  );
}

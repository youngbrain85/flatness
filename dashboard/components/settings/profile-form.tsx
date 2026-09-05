'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormField, inputClass } from '@/components/ui/form';

export function ProfileForm({ userId, initialName }: { userId: string; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    // HTML5 required는 공백만 입력해도 통과시키므로 별도로 막는다(빈 표시 이름 저장 방지)
    if (!trimmed) { setMsg('표시 이름을 입력하세요'); return; }
    // grant: authenticated는 display_name 컬럼만 update 가능 (001)
    const { error } = await createClient().from('profiles')
      .update({ display_name: trimmed }).eq('id', userId);
    if (!error) setName(trimmed); // 입력창도 저장된 값(trim됨)과 동기화
    setMsg(error ? `저장 실패: ${error.message}` : '저장되었습니다');
  }

  // 아트보드 Settings: 필드 320px + 저장 버튼, 하단 정렬, gap 12px.
  // 이 뷰의 primary는 U 저장 하나(스펙 §6 Settings)이므로 프로필 저장은 normal(뷰당 primary 1개 규칙).
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="w-80">
        <FormField label="표시 이름" htmlFor="display-name">
          <input id="display-name" required value={name} onChange={(e) => setName(e.target.value)}
            className={inputClass} />
        </FormField>
      </div>
      <Button type="submit">저장</Button>
      {msg && <span className="pb-1.5 text-xs text-cs-text-secondary">{msg}</span>}
    </form>
  );
}

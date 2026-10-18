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

  // 아트보드 Settings 프로필: 필드(`flex: 1 1 240px; max-width: 320px`) + 저장, 아래 정렬, 12px 간격.
  // 이 화면의 주 버튼은 U 저장 하나라 프로필 저장은 보조. 결과 문구는 버튼 옆 role=status 13px muted.
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 max-w-[320px] flex-[1_1_240px]">
        <FormField label="표시 이름" htmlFor="display-name">
          <input id="display-name" required value={name} onChange={(e) => setName(e.target.value)}
            className={inputClass} />
        </FormField>
      </div>
      <Button type="submit">저장</Button>
      {msg && <span role="status" className="inline-flex min-h-11 items-center text-[13px] text-muted">{msg}</span>}
    </form>
  );
}

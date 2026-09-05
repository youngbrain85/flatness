'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { FormField, inputClass, textareaClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

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

  // 아트보드(SiteNew): 필드 3개(폭 448px)는 헤더 없는 컨테이너 안, 제출 버튼은 컨테이너 밖 우측 하단.
  // 제출 버튼이 <form> 안에 있어야 하므로 form이 컨테이너와 버튼 줄을 함께 감싼다.
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Container>
        <div className="flex w-full max-w-[448px] flex-col gap-4">
          <FormField label="현장명 (필수)" htmlFor="name">
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="주소" htmlFor="address">
            <input id="address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="메모" htmlFor="memo">
            <textarea id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} className={textareaClass} rows={3} />
          </FormField>
          {error && <p className="text-sm text-cs-error">{error}</p>}
        </div>
      </Container>
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" variant="primary">
          <Icon name="plus" />
          현장 등록
        </Button>
      </div>
    </form>
  );
}

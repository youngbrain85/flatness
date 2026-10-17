'use client';
// 진입 페이지의 새 현장 입력 카드(아트보드 docs/design/dark/EntrySearch.dc.html "새 현장 등록").
// 필드·insert·이동은 지난 새 현장 폼(components/new-site-form.tsx - 이 파일로 옮기고 지웠다)과 같다:
// 현장명 필수 · 주소 · 메모, trim 후 빈 칸은 null, 성공하면 새 현장의 대시보드로 push만 한다.
import { useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormField, inputClass, textareaClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

export function NewSiteCard({ initialName, nameRef, onCancel }: {
  // 카드를 열 때 현장명 칸에 미리 넣을 값(검색 결과 0건 안내에서 열면 그 검색어)
  initialName: string;
  // 부모(site-finder.tsx)가 카드를 열 때 이 칸으로 초점을 옮긴다
  nameRef?: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // 저장 중에 다시 제출하면 같은 이름의 현장이 두 번 생긴다
    if (saving) return;
    const trimmed = name.trim();
    // 공백만 넣은 이름은 required를 통과한다 - 이름 없는 현장이 생기지 않게 막는다(업로드 폼의 새 현장 검증과 같은 결)
    if (!trimmed) {
      setError('현장명을 입력하세요.');
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase.from('sites')
      .insert({ name: trimmed, address: address.trim() || null, memo: memo.trim() || null })
      .select('id').single();
    if (err || !data) {
      setError(err?.message ?? '저장 실패');
      setSaving(false);
      return;
    }
    // push만 한다. 뒤에 router.refresh()를 붙이면 refresh가 "현재 라우트"를 다시
    // 렌더하면서 진행 중이던 이동을 취소한다(로그인 화면에서 실제로 재현된 결함).
    // sites/[id]는 force-dynamic이고 동적 페이지의 클라이언트 캐시 staleTime
    // 기본값은 0초(캐시 안 함)라, push만으로도 항상 서버에서 새로 받아온다.
    router.push(`/sites/${data.id}`);
  }

  return (
    <section id="newSiteCard" aria-labelledby="newSiteTitle" className="rounded-card border border-line-2 bg-surface px-[22px] py-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-[18px]">
        <h2 id="newSiteTitle" className="font-heading text-[19px] font-semibold">새 현장 등록</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-[18px]">
          <div className="min-w-0 flex-[1_1_280px]">
            <FormField label={<>현장명 <span className="font-medium text-muted">(필수)</span></>} htmlFor="newSiteName">
              <input id="newSiteName" ref={nameRef} required value={name}
                onChange={(e) => setName(e.target.value)} className={inputClass} />
            </FormField>
          </div>
          <div className="min-w-0 flex-[1_1_280px]">
            <FormField label="주소" htmlFor="newSiteAddress">
              <input id="newSiteAddress" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
            </FormField>
          </div>
        </div>
        <FormField label="메모" htmlFor="newSiteMemo">
          <textarea id="newSiteMemo" rows={4} value={memo} onChange={(e) => setMemo(e.target.value)} className={textareaClass} />
        </FormField>
        {error && <p role="alert" className="text-sm text-err">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button onClick={onCancel}>취소</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            <Icon name="plus" />
            현장 등록
          </Button>
        </div>
      </form>
    </section>
  );
}

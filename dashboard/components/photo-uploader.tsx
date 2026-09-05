'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto, type PhotoRef } from '@/lib/photos/upload';
import { buttonClass } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

export function PhotoUploader({ target, onUploaded }: { target: PhotoRef; onUploaded: () => void }) {
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadPhoto(createClient(), file, target, caption || undefined);
      setCaption('');
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진 업로드에 실패했습니다');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  // 아트보드(SiteDetail '현장 사진'): 설명 입력 360px + '사진 추가' normal 알약(upload 아이콘).
  // 파일 선택은 label이 감싼 숨은 input이 연다 - 겉모습만 버튼이다(뷰의 primary는 '위치 추가').
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <input type="text" placeholder="사진 설명(선택)" value={caption}
        onChange={(e) => setCaption(e.target.value)}
        className={`${inputClass} max-w-[360px]`} />
      <label className={busy ? buttonClass('normal', { disabled: true }) : `${buttonClass('normal')} cursor-pointer`}>
        <Icon name="upload" />
        {busy ? '업로드 중...' : '사진 추가'}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={onChange} disabled={busy} />
      </label>
      {error && <span className="text-cs-error">{error}</span>}
    </div>
  );
}

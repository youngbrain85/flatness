'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto, type PhotoRef } from '@/lib/photos/upload';

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

  return (
    <div className="flex items-center gap-2 text-sm">
      <input type="text" placeholder="사진 설명(선택)" value={caption}
        onChange={(e) => setCaption(e.target.value)} className="rounded border px-2 py-1" />
      <label className="cursor-pointer rounded border bg-white px-3 py-1 hover:bg-slate-50">
        {busy ? '업로드 중...' : '사진 추가'}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={onChange} disabled={busy} />
      </label>
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}

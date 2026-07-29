'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { photoUrl } from '@/lib/photos/upload';
import type { PhotoRow } from '@/lib/domain/types';

export function PhotoGallery({ photos }: { photos: PhotoRow[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const entries = await Promise.all(
        photos.map(async (p) => [p.id, await photoUrl(supabase, p.file_path)] as const),
      );
      if (!cancelled) {
        setUrls(Object.fromEntries(entries.filter(([, u]) => u !== null) as [string, string][]));
      }
    })();
    return () => { cancelled = true; };
  }, [photos]);

  if (photos.length === 0) return <p className="text-sm text-slate-500">등록된 사진이 없습니다.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {photos.map((p) => (
        <figure key={p.id} className="rounded border bg-white p-1">
          {urls[p.id] ? (
            // signed URL은 외부 호스트라 next/image 대신 img 사용(데모)
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls[p.id]} alt={p.caption ?? '현장 사진'} className="h-32 w-full rounded object-cover" />
          ) : (
            <div className="h-32 w-full animate-pulse rounded bg-slate-100" />
          )}
          {p.caption && <figcaption className="p-1 text-xs text-slate-600">{p.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

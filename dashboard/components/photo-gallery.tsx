'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { photoUrl } from '@/lib/photos/upload';
import type { PhotoRow } from '@/lib/domain/types';
import { Icon } from '@/components/ui/icons';

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

  if (photos.length === 0) return <p className="text-sm text-muted">등록된 사진이 없습니다.</p>;
  // 아트보드(SiteDetail '현장 사진'): 260px 이상 칸 자동 채움(gap 12px), figure 카드(ground 바탕 · line-2 ·
  // 12px · overflow hidden), 사진 칸 128px 검정 바탕(사진을 아직 못 받았으면 사진 아이콘), 캡션 13px ink-2.
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3">
      {photos.map((p) => (
        <figure key={p.id} className="m-0 flex min-w-0 flex-col overflow-hidden rounded-card border border-line-2 bg-ground">
          <div className="flex h-32 items-center justify-center bg-stage">
            {urls[p.id] ? (
              // signed URL은 외부 호스트라 next/image 대신 img 사용(데모)
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[p.id]} alt={p.caption ?? '현장 사진'} className="h-full w-full object-cover" />
            ) : (
              <Icon name="photo" size={28} className="text-dim" />
            )}
          </div>
          {p.caption && (
            <figcaption className="border-t border-line-2 px-3 py-2.5 text-[13px] text-ink-2">{p.caption}</figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

// 옛 업로드 경로(스펙 §4.2 "옛 경로 처리"): 업로드는 이제 현장 안(/sites/[id]/upload)에서 한다.
// ?location=X 가 있으면 X 가 속한 현장의 업로드로 영구 이동(308)하고 위치 프리필을 잇는다.
// 위치가 없거나 찾지 못하면 진입 페이지로 보낸다(임시 이동 307 - 실패 결과를 브라우저가 기억하지 않게).
// 옛 링크(/upload?site=...&location=...)의 site 값은 믿지 않는다: 위치가 속한 현장은 DB 의 site_id 가 정한다.
import { permanentRedirect, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LegacyUploadPage({ searchParams }: {
  searchParams: Promise<{ location?: string | string[]; site?: string | string[] }>;
}) {
  const { location } = await searchParams;
  if (typeof location === 'string' && location) {
    const supabase = await createClient();
    const { data } = await supabase.from('locations').select('id, site_id').eq('id', location).maybeSingle();
    if (data) {
      // 두 id 모두 방금 DB 에서 확인한 값이다
      permanentRedirect(`/sites/${(data as { site_id: string }).site_id}/upload?location=${location}`);
    }
  }
  redirect('/');
}

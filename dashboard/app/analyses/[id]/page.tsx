// D6: 구 URL 보존 — 이 화면의 렌더는 D5(스캔 작업대 통합)가 app/scans/[id]/page.tsx로
// 완전히 이관했다(?analysis= 선택 렌더). 이 파일은 이제 옛 링크(북마크·외부 링크)를
// 새 위치로 보내는 얇은 리다이렉트 계층으로만 남는다. scan_id만 조회하면 되므로
// select('*') 대신 select('scan_id')로 좁혀 불필요한 조회를 줄인다.
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: analysis } = await supabase.from('analyses').select('scan_id').eq('id', id).maybeSingle();
  if (!analysis) notFound();
  redirect(`/scans/${(analysis as { scan_id: string }).scan_id}?analysis=${id}`);
}

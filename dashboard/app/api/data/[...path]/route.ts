// Supabase Storage 서빙 - 인증 확인 후 단기 서명 URL로 302 리다이렉트한다.
// 프록시하지 않는 이유: Vercel 서버리스 응답 본문 상한(약 4.5MB)에 보고서 PDF·원본
// 점군이 걸린다. 리다이렉트는 대역폭도 Supabase에서 브라우저로 직접 흐른다.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveStorageObject } from '@/lib/server/storage-objects';

const SIGNED_URL_TTL_S = 300;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const { path: segments } = await params;
  const target = resolveStorageObject(segments);
  if (!target) return NextResponse.json({ error: '잘못된 경로입니다' }, { status: 400 });

  const { data, error } = await supabase.storage
    .from(target.bucket)
    .createSignedUrl(target.key, SIGNED_URL_TTL_S);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: '파일을 찾을 수 없습니다' }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: { 'cache-control': 'private, no-store' },
  });
}

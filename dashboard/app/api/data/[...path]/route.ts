// 로컬 data/ 서빙 (데모: 스펙 §6.3 "raw-scans/artifacts/reports는 로컬 data/ 디렉터리
// ... 로컬 대시보드가 서빙")
import { promises as fs } from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { contentTypeFor, resolveDataPath } from '@/lib/server/data-files';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const { path: segments } = await params;
  const abs = resolveDataPath(process.env.DATA_DIR ?? '../data', segments);
  if (!abs) return NextResponse.json({ error: '잘못된 경로입니다' }, { status: 400 });
  try {
    const buf = await fs.readFile(abs);
    return new NextResponse(buf, {
      headers: { 'content-type': contentTypeFor(abs), 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: '파일을 찾을 수 없습니다' }, { status: 404 });
  }
}

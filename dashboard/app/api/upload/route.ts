// 스캔 원본을 로컬 data/에 규약대로 저장
// (스펙 §3.2.①: 데모에서 TUS 없이 로컬 대시보드 서버가 raw-scans/에 저장)
import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rawScanRelPath } from '@/lib/domain/paths';
import { MAX_UPLOAD_BYTES, isUploadSizeAllowed, validateScanFile } from '@/lib/upload/validate';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  const siteId = form.get('site_id');
  const scanId = form.get('scan_id');
  if (!(file instanceof File) || typeof siteId !== 'string' || typeof scanId !== 'string') {
    return NextResponse.json({ error: '필수 항목 누락(file, site_id, scan_id)' }, { status: 400 });
  }
  // 리뷰 Important #3: 버퍼 적재(Buffer.from) 전에 크기부터 차단한다 - 전체를
  // 메모리에 올리는 현재 구조에서 상한 없는 대용량 파일은 서버를 메모리 부족으로 몰 수 있다.
  if (!isUploadSizeAllowed(file.size)) {
    const maxGiB = MAX_UPLOAD_BYTES / (1024 * 1024 * 1024);
    return NextResponse.json(
      { error: `파일이 너무 큽니다(최대 ${maxGiB}GiB). 더 작은 파일로 나눠서 시도하세요.` },
      { status: 413 },
    );
  }
  // 경로 성분은 UUID만 허용 - 사용자 입력 경로를 파일 시스템에 쓰지 않는다
  if (!UUID_RE.test(siteId) || !UUID_RE.test(scanId)) {
    return NextResponse.json({ error: 'site_id/scan_id는 UUID여야 합니다' }, { status: 400 });
  }
  const v = validateScanFile(file.name);
  if (!v) {
    return NextResponse.json({ error: '지원 포맷: ply, las, laz, xyz, txt, csv, pts' }, { status: 400 });
  }
  const rel = rawScanRelPath(siteId, scanId, v.ext);
  const abs = path.join(path.resolve(process.env.DATA_DIR ?? '../data'), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(abs, buf);
  return NextResponse.json({ rel_path: rel, size: buf.length });
}

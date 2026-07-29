import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnalysisResult } from '@/components/analysis/analysis-result';
import { ANALYSIS_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import type { AnalysisRow, LocationRow, PhotoRow, ScanRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: analysis } = await supabase.from('analyses').select('*').eq('id', id).maybeSingle();
  if (!analysis) notFound();
  const a = analysis as AnalysisRow;
  const { data: scan } = await supabase.from('scans').select('*').eq('id', a.scan_id).maybeSingle();
  if (!scan) notFound();
  const s = scan as ScanRow;
  const [locRes, photosRes] = await Promise.all([
    supabase.from('locations').select('*').eq('id', s.location_id).maybeSingle(),
    supabase.from('photos').select('*').eq('scan_id', s.id).order('created_at', { ascending: false }),
  ]);
  const loc = locRes.data as LocationRow | null;

  if (a.status !== 'done' || !a.stats) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <p className="text-sm text-slate-600">
          이 분석은 아직 완료되지 않았습니다 (상태: {ANALYSIS_STATUS_LABEL[a.status]}).{' '}
          <Link href={`/scans/${s.id}`} className="text-blue-700 hover:underline">스캔 상세에서 진행 상태 보기</Link>
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-bold">
          분석 결과 · {SURFACE_LABEL[a.surface]} · {s.scanned_at}
        </h1>
        <p className="text-sm text-slate-500">
          {loc ? [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ') : ''}
          {' · '}엔진 {a.engine_version ?? '-'}
          {' · '}<Link href={`/scans/${s.id}`} className="text-blue-700 hover:underline">스캔 상세</Link>
        </p>
      </div>
      <AnalysisResult analysis={a} scan={s} photos={(photosRes.data ?? []) as PhotoRow[]} />
    </main>
  );
}

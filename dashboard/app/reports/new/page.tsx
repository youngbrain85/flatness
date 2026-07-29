// 보고서 생성 화면 (스펙 §7.6 전반부)
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportCreateForm, type ReportCandidate } from '@/components/report/report-create-form';
import { GRADE_LABEL } from '@/lib/domain/labels';
import type { LocationRow, ScanRow, Surface, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function NewReportPage({ searchParams }: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location: locationId } = await searchParams;
  if (!locationId) notFound();
  const supabase = await createClient();
  const { data: location, error } = await supabase
    .from('locations').select('*').eq('id', locationId).maybeSingle();
  if (error) {
    return <main className="mx-auto max-w-4xl p-6"><SupabaseErrorNotice message={error.message} /></main>;
  }
  if (!location) notFound();
  const loc = location as LocationRow;
  const locationLabel = [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ');

  const { data: scans } = await supabase
    .from('scans').select('*').eq('location_id', locationId).is('deleted_at', null);
  const scanRows = (scans ?? []) as ScanRow[];
  const scanById = new Map(scanRows.map((s) => [s.id, s]));
  const analysesRes = scanRows.length
    ? await supabase.from('analyses')
        .select('id, scan_id, surface, overall_verdict, auto_summary, user_summary')
        .in('scan_id', scanRows.map((s) => s.id))
        .eq('is_current', true).eq('status', 'done').is('deleted_at', null)
    : { data: [], error: null };
  if (analysesRes.error) {
    return <main className="mx-auto max-w-4xl p-6"><SupabaseErrorNotice message={analysesRes.error.message} /></main>;
  }

  const candidates: ReportCandidate[] = (analysesRes.data ?? []).map((a) => {
    const scan = scanById.get(a.scan_id as string);
    const verdict = a.overall_verdict as Verdict | null;
    return {
      analysis_id: a.id as string,
      surface: a.surface as Surface,
      scanned_at: scan?.scanned_at ?? '-',
      verdict_label: verdict ? GRADE_LABEL[verdict] : GRADE_LABEL.na,
      summary: (a.user_summary as string | null) ?? (a.auto_summary as string | null),
    };
  }).sort((a, b) => a.surface.localeCompare(b.surface));

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-bold">보고서 생성</h1>
        <p className="text-sm text-slate-500">{locationLabel}</p>
      </div>
      {candidates.length === 0 ? (
        <p className="rounded border bg-white p-4 text-sm text-slate-600">
          이 측정위치에는 완료된 분석이 없습니다. 스캔을 업로드하고 분석이 끝난 뒤 다시 시도하세요.{' '}
          <Link href={`/upload?location=${locationId}`} className="text-blue-700 hover:underline">스캔 업로드</Link>
        </p>
      ) : (
        <ReportCreateForm locationId={locationId} locationLabel={locationLabel} candidates={candidates} />
      )}
    </main>
  );
}

// 보고서 목록 (전체 또는 ?location= 필터)
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { REPORT_GEN_STATUS_LABEL, REPORT_STATUS_LABEL } from '@/lib/domain/labels';
import type { LocationRow, ReportRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location: locationId } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from('reports')
    .select('id, location_id, title, status, pdf_path, gen_status, gen_error, created_at')
    .order('created_at', { ascending: false }).limit(50);
  if (locationId) query = query.eq('location_id', locationId);
  const { data, error } = await query;
  if (error) {
    return <main className="mx-auto max-w-4xl p-6"><SupabaseErrorNotice message={error.message} /></main>;
  }
  const reports = (data ?? []) as Omit<ReportRow, 'snapshot' | 'opinion_text' | 'created_by'>[];
  const locationIds = [...new Set(reports.map((r) => r.location_id))];
  const { data: locations } = locationIds.length
    ? await supabase.from('locations').select('*').in('id', locationIds)
    : { data: [] };
  const labelOf = new Map((locations ?? []).map((l) => {
    const loc = l as LocationRow;
    return [loc.id, [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ')];
  }));

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">보고서</h1>
        {locationId && (
          <Link href={`/reports/new?location=${locationId}`}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white">새 보고서</Link>
        )}
      </div>
      {reports.length === 0 ? (
        <p className="rounded border bg-white p-4 text-sm text-slate-600">
          아직 보고서가 없습니다. 현장 상세의 측정위치에서 보고서를 생성하세요.
        </p>
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="rounded border bg-white p-3 text-sm">
              <Link href={`/reports/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
              <p className="text-xs text-slate-500">
                {labelOf.get(r.location_id) ?? ''} · {REPORT_STATUS_LABEL[r.status]}
                {' · '}{REPORT_GEN_STATUS_LABEL[r.gen_status]} · {r.created_at.slice(0, 10)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

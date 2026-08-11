// 보고서 목록 (전체 또는 ?location= 필터)
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { tableClass } from '@/components/ui/data-table';
import { reportStatusBadge } from '@/lib/domain/reports';
import type { LocationRow, ReportRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location: locationId } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from('reports')
    .select('id, location_id, title, status, pdf_path, gen_status, gen_error, created_at')
    .is('deleted_at', null)
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

  // D7 Step 2: 파라미터 유무와 무관하게 항상 노출한다 - location이 있으면 그 위치를
  // 프리필해 한 클릭 흐름(6.3)을 잇고, 없으면 /reports/new가 먼저 측정위치 선택
  // UI를 보여준다(D7 Step 1).
  const newReportHref = locationId ? `/reports/new?location=${locationId}` : '/reports/new';

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <PageHeader title="보고서" actions={
        <Link href={newReportHref}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">
          새 보고서
        </Link>
      } />
      {reports.length === 0 ? (
        <EmptyState message="보고서가 없습니다." actionHref="/reports/new" actionLabel="새 보고서 만들기" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white">
          <table className={tableClass.table}>
            <thead className={tableClass.thead}>
              <tr>
                <th className={tableClass.th}>제목</th>
                <th className={tableClass.th}>측정위치</th>
                <th className={tableClass.th}>상태</th>
                <th className={tableClass.th}>생성일</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const badge = reportStatusBadge(r);
                return (
                  <tr key={r.id} className={tableClass.row}>
                    <td className={tableClass.td}>
                      <Link href={`/reports/${r.id}`} className="font-medium text-zinc-900 hover:underline">
                        {r.title}
                      </Link>
                    </td>
                    <td className={tableClass.td}>{labelOf.get(r.location_id) ?? '-'}</td>
                    <td className={tableClass.td}><Badge tone={badge.tone}>{badge.label}</Badge></td>
                    <td className={`${tableClass.td} font-mono tabular-nums`}>{r.created_at.slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

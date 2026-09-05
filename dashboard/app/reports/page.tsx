// 보고서 목록 (전체 또는 ?location= 필터). 아트보드: docs/design/cloudscape/Reports.dc.html
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportTable, type ReportTableRow } from '@/components/report-table';
import { LinkButton } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icons';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
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
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={error.message} /></main>;
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
  // UI를 보여준다(D7 Step 1). 빈 목록은 EmptyState의 primary('새 보고서 만들기')가
  // 같은 다음 행동을 맡는다(뷰당 primary 1개 - 컨테이너 헤더 버튼은 목록이 있을 때만).
  const newReportHref = locationId ? `/reports/new?location=${locationId}` : '/reports/new';

  // 상태 판단(reportStatusBadge)은 서버에서 끝내고, 테이블은 표시용 값만 받는다.
  const rows: ReportTableRow[] = reports.map((r) => {
    const badge = reportStatusBadge(r);
    return {
      id: r.id,
      title: r.title,
      locationLabel: labelOf.get(r.location_id) ?? '-',
      tone: badge.tone,
      statusLabel: badge.label,
      createdAt: r.created_at.slice(0, 10),
    };
  });

  return (
    <main className={PAGE_MAIN}>
      <PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '보고서' }]} title="보고서" />
      {reports.length === 0 ? (
        <EmptyState message="보고서가 없습니다." actionHref="/reports/new" actionLabel="새 보고서 만들기" />
      ) : (
        <Container title="보고서" counter={reports.length} padded={false}
          actions={
            <LinkButton href={newReportHref} variant="primary">
              <Icon name="plus" />새 보고서
            </LinkButton>
          }>
          <ReportTable rows={rows} locationFilter={locationId ? (labelOf.get(locationId) ?? '-') : null} />
        </Container>
      )}
    </main>
  );
}

// 현장 보고서 목록(스펙 §5 14행). 아트보드: docs/design/dark/Reports.dc.html
// 현장 헤더와 <main>은 app/sites/[id]/layout.tsx가 그린다(현장 행 확인·notFound도 레이아웃 몫) -
// 이 페이지는 본문(PAGE_MAIN)만 그린다. 옛 전체 목록(/reports, 지금은 진입 페이지로 리다이렉트)의 조회·행
// 만들기 규칙을 그대로 가져오되 범위를 이 현장의 측정위치로 좁힌다.
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportTable, type ReportTableRow } from '@/components/report-table';
import { LinkButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { reportIndicator } from '@/lib/domain/reports';
import type { LocationRow, ReportRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '보고서' };

type ReportListItem = Pick<ReportRow,
  'id' | 'location_id' | 'title' | 'status' | 'pdf_path' | 'gen_status' | 'gen_error' | 'created_at'>;

export default async function SiteReportsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ location?: string }>;
}) {
  const [{ id: siteId }, { location: locationParam }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  // 현장 범위(스펙 §5 14행): reports에는 site_id가 없다 - 이 현장의 측정위치 id를 먼저 읽고 보고서는 그 id
  // 안에서만 고른다. 측정위치 표기도 같은 행으로 만든다(목록 열은 아트보드대로 ' / ').
  const { data: locData, error: locError } = await supabase.from('locations').select('*').eq('site_id', siteId);
  if (locError) {
    return <div className={PAGE_MAIN}><SupabaseErrorNotice message={locError.message} /></div>;
  }
  const locations = (locData ?? []) as LocationRow[];
  const labelOf = new Map<string, string>(locations.map((l): [string, string] => [
    l.id, [l.building, l.floor, l.room, l.name].filter(Boolean).join(' / '),
  ]));

  // ?location=은 측정위치 줄의 '보고서' 같은 진입에서 온다. 이 현장의 측정위치일 때만 건다 - 다른 현장 id를
  // 넣어 그 현장 보고서를 섞어 보지 못하게 하고, 맞지 않으면 이 현장 전체를 보여 준다.
  const locationId = locationParam && labelOf.has(locationParam) ? locationParam : null;
  const scopeIds = locationId ? [locationId] : locations.map((l) => l.id);

  let reports: ReportListItem[] = [];
  if (scopeIds.length > 0) {
    // 삭제(deleted_at) 제외·최신순은 옛 전체 목록과 같다. 현장 범위로 좁혀졌으므로 50건 상한은 두지 않는다 -
    // 대시보드 KPI '보고서 수'(삭제 제외, 상태 무관)와 이 화면의 (n)이 같은 수여야 한다.
    const { data, error } = await supabase.from('reports')
      .select('id, location_id, title, status, pdf_path, gen_status, gen_error, created_at')
      .in('location_id', scopeIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) {
      return <div className={PAGE_MAIN}><SupabaseErrorNotice message={error.message} /></div>;
    }
    reports = (data ?? []) as ReportListItem[];
  }

  // 상태 판단은 서버에서 끝내고 표는 표시용 값만 받는다. reportIndicator(Task 4)는 대시보드 최근 보고서·
  // 보고서 상세와 같은 규칙이다: 'PDF 생성 중'만 속 빈 고리(in-progress), 작성 중·PDF 생성 대기 중은 pending.
  const rows: ReportTableRow[] = reports.map((r) => {
    const status = reportIndicator(r);
    return {
      id: r.id,
      title: r.title,
      locationLabel: labelOf.get(r.location_id) ?? '-',
      statusType: status.type,
      statusLabel: status.label,
      genStatus: r.gen_status,
      createdAt: r.created_at.slice(0, 10),
    };
  });

  // '새 보고서': 측정위치가 걸려 있으면 그 위치를 미리 골라 한 클릭 흐름을 잇고(D7 Step 2), 아니면 이 현장의
  // 측정위치 고르기(/reports/new?site=)로 간다. 화면 안에서 현장을 고르지 않는다(스펙 §5 15행).
  const newReportHref = locationId ? `/reports/new?location=${locationId}` : `/reports/new?site=${siteId}`;

  return (
    <div className={PAGE_MAIN}>
      {/* 탭 첫 화면이라 브레드크럼이 없다(스펙 §4.3). h1 옆 (n)은 PageHeader counter(mono 13px muted, 아트보드) */}
      <PageHeader
        title="보고서"
        counter={reports.length}
        actions={
          <LinkButton href={newReportHref} variant="primary">
            <Icon name="plus" />새 보고서
          </LinkButton>
        } />
      {reports.length === 0 && !locationId ? (
        // 빈 현장: 다음 행동은 머리의 '새 보고서'(주 버튼)가 맡는다 - 주 버튼을 하나 더 두지 않는다
        <p className="rounded-card border border-line-2 bg-surface px-5 py-10 text-center text-sm text-muted">
          이 현장에는 아직 보고서가 없습니다. 새 보고서 버튼으로 만드세요.
        </p>
      ) : (
        <ReportTable rows={rows}
          locationFilter={locationId
            ? { label: labelOf.get(locationId) ?? '-', clearHref: `/sites/${siteId}/reports` }
            : null} />
      )}
    </div>
  );
}

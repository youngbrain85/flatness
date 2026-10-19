// 현장 대시보드(스펙 §5 03, 아트보드 docs/design/dark/DashStatus.dc.html). 현장 헤더와 <main>은
// app/sites/[id]/layout.tsx가 그린다 - 이 페이지는 PAGE_MAIN 본문만 둔다. 탭 첫 화면이라 브레드크럼이 없다.
// 조회 규칙은 지난 현장 상세·홈과 같다: 스캔은 deleted_at null, 판정은 현재(is_current) 평활도(kind)만,
// 처리 중은 종류 무관 queued·processing. 집계는 buildSiteDashboard(등급 계산 없이 overall_verdict만 센다).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { selectAll, selectIn } from '@/lib/supabase/select-all';
import {
  buildSiteDashboard, type DashAnalysis, type DashCurrentAnalysis, type DashReport, type DashScan,
} from '@/lib/domain/site-dashboard';
import type { LocationRow, SiteRow } from '@/lib/domain/types';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { DashboardKpis } from '@/components/dashboard/dashboard-kpis';
import { RecentReportsCard } from '@/components/dashboard/recent-reports-card';
import { StatusGrid } from '@/components/dashboard/status-grid';
import { TodoCard } from '@/components/dashboard/todo-card';

export const dynamic = 'force-dynamic';

// 스펙 §9: <title>은 "Flatness · 화면 이름". 화면 이름만 주면 루트 레이아웃의 title.template('Flatness · %s')이 붙는다.
export const metadata: Metadata = { title: '현장 대시보드' };

// 측정위치·스캔이 없을 때 건너뛴 조회의 자리(빈 .in() 조회를 보내지 않는다)
const NO_ROWS = { data: [] as never[], error: null };

function errorView(message: string) {
  return <div className={PAGE_MAIN}><SupabaseErrorNotice message={message} /></div>;
}

export default async function SiteDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: site, error: siteError } = await supabase.from('sites').select('*').eq('id', id).maybeSingle();
  // 연결 실패를 "현장 없음"(notFound)으로 오인하지 않게 에러부터 본다(지난 현장 상세의 가드 그대로)
  if (siteError) return errorView(siteError.message);
  if (!site) notFound();

  const locationsRes = await selectAll((from, to) => supabase.from('locations').select('*')
    .eq('site_id', id).order('id').range(from, to));
  if (locationsRes.error) return errorView(locationsRes.error.message);
  const locations = (locationsRes.data ?? []) as LocationRow[];
  const locationIds = locations.map((l) => l.id);

  // 목록 조회는 selectIn 으로 id 를 조각내고 1000행 상한을 넘겨 끝까지 받는다(lib/supabase/select-all.ts)
  const [scansRes, reportsRes] = locationIds.length
    ? await Promise.all([
        selectIn(locationIds, (ids, from, to) => supabase.from('scans')
          .select('id, location_id, surface, scanned_at, status, created_at')
          .in('location_id', ids).is('deleted_at', null).order('id').range(from, to)),
        // 보고서 수는 상태 무관(삭제 제외). 최근 5건과 생성 실패도 이 목록에서 고른다.
        selectIn(locationIds, (ids, from, to) => supabase.from('reports')
          .select('id, location_id, title, status, gen_status, created_at')
          .in('location_id', ids).is('deleted_at', null).order('id').range(from, to)),
      ])
    : [NO_ROWS, NO_ROWS];
  const listError = scansRes.error ?? reportsRes.error;
  if (listError) return errorView(listError.message);
  const scans = (scansRes.data ?? []) as DashScan[];
  const scanIds = scans.map((s) => s.id);

  const [currentRes, analysesRes] = scanIds.length
    ? await Promise.all([
        // 단계 C 회귀 차단: kind 필터가 없으면 같은 스캔의 구배 현재 분석이 판정 집계에 섞여 2배로 계상된다.
        selectIn(scanIds, (ids, from, to) => supabase.from('analyses')
          .select('scan_id, status, overall_verdict, kind')
          .in('scan_id', ids).eq('is_current', true).eq('kind', 'flatness').is('deleted_at', null)
          .order('id').range(from, to)),
        // 처리 중(종류 무관 queued·processing)과 최근 시도 실패를 본다. 새 분석은 is_current=false로 들어가
        // 완료돼야 현재가 되므로(components/reanalyze-button.tsx) 이 조회에는 is_current·kind를 걸지 않는다.
        selectIn(scanIds, (ids, from, to) => supabase.from('analyses')
          .select('scan_id, kind, status, created_at')
          .in('scan_id', ids).is('deleted_at', null).order('id').range(from, to)),
      ])
    : [NO_ROWS, NO_ROWS];
  const analysisError = currentRes.error ?? analysesRes.error;
  if (analysisError) return errorView(analysisError.message);

  const dash = buildSiteDashboard({
    siteId: id,
    locations,
    scans,
    currentAnalyses: (currentRes.data ?? []) as DashCurrentAnalysis[],
    analyses: (analysesRes.data ?? []) as DashAnalysis[],
    reports: (reportsRes.data ?? []) as DashReport[],
  });
  const { kpi } = dash;

  return (
    <div className={PAGE_MAIN}>
      {/* 아트보드 제목 줄: h1 현장 이름 + 메타(숫자·날짜만 mono). 탭 첫 화면이라 crumbs를 넘기지 않는다 */}
      <PageHeader
        title={(site as SiteRow).name}
        description={
          <>
            측정위치 <span className="font-mono text-ink-2">{kpi.locationCount}</span>
            {' · '}스캔 <span className="font-mono text-ink-2">{kpi.scanCount}</span>
            {kpi.lastScannedAt && (
              <>{' · '}최근 활동 <span className="font-mono text-ink-2">{kpi.lastScannedAt}</span></>
            )}
          </>
        }
      />
      <DashboardKpis kpi={kpi} />
      <div className="flex flex-wrap items-start gap-5">
        <StatusGrid siteId={id} buildings={dash.grid} locationCount={kpi.locationCount} hiddenCount={dash.hiddenTileCount} />
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
          <TodoCard todos={dash.todos} noScanAttention={dash.noScanAttention} />
          <RecentReportsCard siteId={id} reports={dash.recentReports} />
        </div>
      </div>
    </div>
  );
}

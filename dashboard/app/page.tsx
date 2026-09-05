// 홈(현장 목록) - PageHeader + 개요 KeyValuePairs + 현장 테이블(클라이언트 도구 줄).
// 아트보드: docs/design/cloudscape/Main.dc.html (브레드크럼 없음 - 스펙 §7-2).
// 조회·집계 로직은 무변경 - 처리 중 조회에 scan_id를 더한 표시용 확장(스펙 §2)만.
import { createClient } from '@/lib/supabase/server';
import { buildSiteSummaries, countInProgress } from '@/lib/domain/summary';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { SiteTable, type SiteTableRow } from '@/components/site-table';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { LinkButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { Container } from '@/components/ui/container';
import { KeyValuePairs, StatValue } from '@/components/ui/key-value';
import { VerdictBar, VerdictLegend } from '@/components/ui/verdict-bar';
import { EmptyState } from '@/components/ui/empty-state';
import type { AnalysisStatus, SiteRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

// 4단계 판정(pass/borderline/repair/rework)을 VerdictBar의 3버킷(pass/warn/fail)으로
// 접는다 - 경계는 아직 적합 범위라 warn, 보수·재시공은 조치가 필요해 fail로 묶는다.
function toBarCounts(v: Record<Verdict, number>): { pass: number; warn: number; fail: number } {
  return { pass: v.pass, warn: v.borderline, fail: v.repair + v.rework };
}

export default async function HomePage() {
  const supabase = await createClient();
  const [sitesRes, locationsRes, scansRes, analysesRes, inProgressRes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    supabase.from('locations').select('id, site_id'),
    supabase.from('scans').select('id, scanned_at, location_id').is('deleted_at', null),
    // 리뷰 Important 3: "판정 불가"(done인데 overall_verdict null) 집계를 위해 status도 함께 조회
    // 단계 C 회귀 차단: kind 필터가 없으면 구배 분석이 섞여 판정 집계가 2배로 계상된다.
    // 홈·현장 트리에 두 종류를 함께 보이는 화면 설계는 아직 없다(단계 D 몫).
    supabase.from('analyses').select('scan_id, status, overall_verdict, kind')
      .eq('is_current', true).eq('kind', 'flatness').is('deleted_at', null),
    // 처리 중 지표는 kind 무필터 - 평활도·구배 분석 모두 "처리 중"에 잡혀야 한다.
    // 위 판정 집계 쿼리(kind='flatness')와는 목적이 다른 별도 쿼리다.
    // scan_id는 테이블 상태 열의 현장별 "처리 중 n건"용(표시용 조회 확장 - 스펙 §2).
    supabase.from('analyses').select('status, scan_id').in('status', ['queued', 'processing']).is('deleted_at', null),
  ]);
  const firstError = sitesRes.error ?? locationsRes.error ?? scansRes.error ?? analysesRes.error ?? inProgressRes.error;
  if (firstError) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={firstError.message} /></main>;
  }
  // 처리 중 행 하나로 개요 지표(countInProgress)와 현장별 건수(buildSiteSummaries)를 모두 만든다.
  const inProgressRows = (inProgressRes.data ?? []) as { status: AnalysisStatus; scan_id: string }[];
  const summaries = buildSiteSummaries(
    (sitesRes.data ?? []) as SiteRow[],
    locationsRes.data ?? [],
    scansRes.data ?? [],
    (analysesRes.data ?? []) as { scan_id: string; status: AnalysisStatus; overall_verdict: Verdict | null }[],
    inProgressRows,
  );
  const totalScans = (scansRes.data ?? []).length;
  const inProgress = countInProgress(inProgressRows);
  const verdictCounts = summaries.reduce(
    (acc, s) => ({
      pass: acc.pass + s.verdictCounts.pass,
      borderline: acc.borderline + s.verdictCounts.borderline,
      repair: acc.repair + s.verdictCounts.repair,
      rework: acc.rework + s.verdictCounts.rework,
    }),
    { pass: 0, borderline: 0, repair: 0, rework: 0 } as Record<Verdict, number>,
  );
  const verdictBar = toBarCounts(verdictCounts);
  const verdictTotal = verdictBar.pass + verdictBar.warn + verdictBar.fail;
  // 리뷰 Important: "엔진은 돌았는데 판정이 안 나온"(done인데 overall_verdict null) 현장이
  // "분석을 안 한 현장"과 구분되지 않으면 안 된다 - VerdictBar는 pass/warn/fail 3버킷만
  // 지원해 na를 표시할 수 없으므로 개요 범례('불가 n' - 0이면 생략)와 테이블 상태 열
  // ('판정 불가 n건')로 별도 노출한다.
  const totalNaCount = summaries.reduce((n, s) => n + s.naCount, 0);
  // SiteSummary를 클라이언트 테이블 행(직렬화 가능한 평면 객체)으로 접는다
  const rows: SiteTableRow[] = summaries.map((s) => ({
    id: s.site.id, name: s.site.name, locationCount: s.locationCount, scanCount: s.scanCount,
    lastScannedAt: s.lastScannedAt, counts: toBarCounts(s.verdictCounts), na: s.naCount, inProgress: s.inProgressCount,
  }));

  return (
    <main className={PAGE_MAIN}>
      {/* 홈에는 브레드크럼 없음(스펙 §7-2). 이 뷰의 primary는 '새 현장' 하나 - 여기는 normal(기본) */}
      <PageHeader title="현장" actions={
        <LinkButton href="/upload"><Icon name="upload" />스캔 업로드</LinkButton>
      } />
      <Container title="개요">
        <KeyValuePairs columns={4} items={[
          { label: '현장', value: <StatValue value={summaries.length} unit="곳" /> },
          { label: '스캔', value: <StatValue value={totalScans} unit="건" /> },
          { label: '처리 중', value: <StatValue value={inProgress} unit="건" /> },
          {
            label: '판정 분포',
            value: (
              // 아트보드: 이 열만 세로 gap 8px(수치 → 8px 바 → 범례)
              <div className="flex flex-col gap-2">
                <StatValue value={verdictTotal} unit="건" />
                <VerdictBar counts={verdictBar} />
                <VerdictLegend counts={verdictBar} na={totalNaCount > 0 ? totalNaCount : undefined} />
              </div>
            ),
          },
        ]} />
      </Container>
      {summaries.length === 0 ? (
        // 이전 3단계 안내(현장 등록 -> 측정위치 -> 업로드)의 취지는 유지하되, 버튼은
        // 업로드 셀프서비스 흐름(단계 D4)에 맞춰 업로드 화면으로 바로 보낸다(브리프 Step 4).
        // 이 분기에서는 EmptyState의 primary가 이 뷰의 유일한 primary다('새 현장' 컨테이너는 없다).
        <EmptyState
          message="아직 등록된 현장이 없습니다. 업로드 화면에서 현장 생성까지 한 번에 할 수 있습니다."
          actionHref="/upload"
          actionLabel="스캔 업로드로 시작"
        />
      ) : (
        <Container title="현장" counter={summaries.length} padded={false}
          actions={<LinkButton href="/sites/new" variant="primary"><Icon name="plus" />새 현장</LinkButton>}>
          <SiteTable rows={rows} />
        </Container>
      )}
    </main>
  );
}

// 진입 페이지(/): 현장 찾기 · 새 현장(스펙 §5 02, 아트보드 docs/design/dark/EntrySearch.dc.html).
// 진입 헤더(상표 + 계정 메뉴)는 이 페이지가 그린다 - 루트 레이아웃은 글꼴과 <body>만 둔다.
// 조회·집계는 지난 홈 그대로다: 쿼리 5개·순서·필터 체인과 buildSiteSummaries·countInProgress.
import type { Metadata } from 'next';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { selectAll } from '@/lib/supabase/select-all';
import { buildSiteSummaries, countInProgress, toBarCounts } from '@/lib/domain/summary';
import type { AnalysisStatus, SiteRow, Verdict } from '@/lib/domain/types';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { EntryHeader } from '@/components/shell/entry-header';
import { SiteFinder, type EntryTotals } from '@/components/entry/site-finder';
import type { EntrySiteRow } from '@/components/entry/site-list';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';

export const dynamic = 'force-dynamic';

// 스펙 §9: <title>은 "Flatness · 화면 이름". 이 페이지는 루트 레이아웃과 같은 세그먼트라 레이아웃의
// title.template('Flatness · %s')이 붙지 않는다(템플릿은 하위 세그먼트에만 적용) - 전체 제목을 준다.
export const metadata: Metadata = { title: 'Flatness · 현장 목록' };

// 아트보드 "최근 측정일 순": 최근 측정일 내림차순, 측정일이 없는 현장은 뒤로, 같으면 이름 순
function byRecent(a: EntrySiteRow, b: EntrySiteRow): number {
  if (a.lastScannedAt !== b.lastScannedAt) {
    if (a.lastScannedAt === null) return 1;
    if (b.lastScannedAt === null) return -1;
    return a.lastScannedAt < b.lastScannedAt ? 1 : -1;
  }
  return a.name.localeCompare(b.name, 'ko');
}

export default async function HomePage() {
  // proxy가 검증해 실어 준 헤더만 읽는다(Auth 서버 왕복 0회 - perf-auth-roundtrips 유지)
  const [user, supabase] = await Promise.all([getRequestUser(), createClient()]);
  const header = <EntryHeader email={user?.email ?? null} />;
  const [sitesRes, locationsRes, scansRes, analysesRes, inProgressRes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    // 전 현장 행을 읽는 조회는 selectAll 로 1000행 상한을 넘겨 끝까지 받는다(lib/supabase/select-all.ts)
    selectAll((from, to) => supabase.from('locations').select('id, site_id').order('id').range(from, to)),
    selectAll((from, to) => supabase.from('scans').select('id, scanned_at, location_id')
      .is('deleted_at', null).order('id').range(from, to)),
    // 리뷰 Important 3: "판정 불가"(done인데 overall_verdict null) 집계를 위해 status도 함께 조회
    // 단계 C 회귀 차단: kind 필터가 없으면 구배 분석이 섞여 판정 집계가 2배로 계상된다.
    // 홈·현장 트리에 두 종류를 함께 보이는 화면 설계는 아직 없다(단계 D 몫).
    selectAll((from, to) => supabase.from('analyses').select('scan_id, status, overall_verdict, kind')
      .eq('is_current', true).eq('kind', 'flatness').is('deleted_at', null).order('id').range(from, to)),
    // 처리 중 지표는 kind 무필터 - 평활도·구배 분석 모두 "처리 중"에 잡혀야 한다.
    // 위 판정 집계 쿼리(kind='flatness')와는 목적이 다른 별도 쿼리다.
    // scan_id는 현장 줄 상태("처리 중 n건")의 현장별 건수용(표시용 조회 확장).
    selectAll((from, to) => supabase.from('analyses').select('status, scan_id')
      .in('status', ['queued', 'processing']).is('deleted_at', null).order('id').range(from, to)),
  ]);
  const firstError = sitesRes.error ?? locationsRes.error ?? scansRes.error ?? analysesRes.error ?? inProgressRes.error;
  if (firstError) {
    return (
      <>
        {header}
        <main className={MAIN_BG}>
          <div className={PAGE_MAIN}><SupabaseErrorNotice message={firstError.message} /></div>
        </main>
      </>
    );
  }
  // 처리 중 행 하나로 총계(countInProgress)와 현장별 건수(buildSiteSummaries)를 모두 만든다.
  const inProgressRows = (inProgressRes.data ?? []) as { status: AnalysisStatus; scan_id: string }[];
  const summaries = buildSiteSummaries(
    (sitesRes.data ?? []) as SiteRow[],
    locationsRes.data ?? [],
    scansRes.data ?? [],
    (analysesRes.data ?? []) as { scan_id: string; status: AnalysisStatus; overall_verdict: Verdict | null }[],
    inProgressRows,
  );
  // SiteSummary를 클라이언트 목록 줄(직렬화 가능한 평면 객체)로 접는다
  const rows: EntrySiteRow[] = summaries.map((s) => ({
    id: s.site.id, name: s.site.name, locationCount: s.locationCount, scanCount: s.scanCount,
    lastScannedAt: s.lastScannedAt, counts: toBarCounts(s.verdictCounts), na: s.naCount, inProgress: s.inProgressCount,
  })).sort(byRecent);
  const totals: EntryTotals = {
    sites: summaries.length,
    locations: (locationsRes.data ?? []).length,
    scans: (scansRes.data ?? []).length,
    inProgress: countInProgress(inProgressRows),
  };

  return (
    <>
      {header}
      <main className={MAIN_BG}>
        <div className={PAGE_MAIN}>
          <SiteFinder rows={rows} totals={totals} />
        </div>
      </main>
    </>
  );
}

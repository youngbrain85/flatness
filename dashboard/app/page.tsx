// 홈(계측 콘솔) - 지표 스트립 + 현장 밀도 테이블
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { buildSiteSummaries, countInProgress } from '@/lib/domain/summary';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { PageHeader } from '@/components/ui/page-header';
import { MetricCard, VerdictBar } from '@/components/ui/metric-card';
import { tableClass } from '@/components/ui/data-table';
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
    supabase.from('analyses').select('status').in('status', ['queued', 'processing']).is('deleted_at', null),
  ]);
  const firstError = sitesRes.error ?? locationsRes.error ?? scansRes.error ?? analysesRes.error ?? inProgressRes.error;
  if (firstError) {
    return <main className="p-6"><SupabaseErrorNotice message={firstError.message} /></main>;
  }
  const summaries = buildSiteSummaries(
    (sitesRes.data ?? []) as SiteRow[],
    locationsRes.data ?? [],
    scansRes.data ?? [],
    (analysesRes.data ?? []) as { scan_id: string; status: AnalysisStatus; overall_verdict: Verdict | null }[],
  );
  const totalScans = (scansRes.data ?? []).length;
  const inProgress = countInProgress((inProgressRes.data ?? []) as { status: AnalysisStatus }[]);
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

  return (
    <main className="p-6">
      <PageHeader title="현장" actions={
        <Link href="/sites/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">
          새 현장
        </Link>
      } />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="현장" value={summaries.length} unit="곳" />
        <MetricCard label="스캔" value={totalScans} unit="건" />
        <MetricCard label="처리 중" value={inProgress} unit="건" />
        <MetricCard label="판정 분포" value={verdictTotal} unit="건">
          <VerdictBar counts={verdictBar} />
        </MetricCard>
      </div>
      {summaries.length === 0 ? (
        // 이전 3단계 안내(현장 등록 -> 측정위치 -> 업로드)의 취지는 유지하되, 버튼은
        // 업로드 셀프서비스 흐름(단계 D4)에 맞춰 업로드 화면으로 바로 보낸다(브리프 Step 4).
        <EmptyState
          message="아직 등록된 현장이 없습니다. 업로드 화면에서 현장 생성까지 한 번에 할 수 있습니다."
          actionHref="/upload"
          actionLabel="스캔 업로드로 시작"
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white">
          <table className={tableClass.table}>
            <thead className={tableClass.thead}>
              <tr>
                <th className={tableClass.th}>이름</th>
                <th className={tableClass.thNum}>측정위치</th>
                <th className={tableClass.thNum}>스캔</th>
                <th className={tableClass.th}>최근 측정일</th>
                <th className={tableClass.th}>판정 분포</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.site.id} className={tableClass.row}>
                  <td className={tableClass.td}>
                    <Link href={`/sites/${s.site.id}`} className="font-medium text-zinc-900 hover:underline">
                      {s.site.name}
                    </Link>
                  </td>
                  <td className={tableClass.tdNum}>{s.locationCount}</td>
                  <td className={tableClass.tdNum}>{s.scanCount}</td>
                  <td className={`${tableClass.td} font-mono tabular-nums`}>{s.lastScannedAt ?? '-'}</td>
                  <td className={tableClass.td}>
                    <VerdictBar counts={toBarCounts(s.verdictCounts)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

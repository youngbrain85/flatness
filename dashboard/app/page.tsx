// 홈(현장 목록)
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { buildSiteSummaries } from '@/lib/domain/summary';
import { SiteCard } from '@/components/site-card';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import type { AnalysisStatus, SiteRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createClient();
  const [sitesRes, locationsRes, scansRes, analysesRes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    supabase.from('locations').select('id, site_id'),
    supabase.from('scans').select('id, scanned_at, location_id').is('deleted_at', null),
    // 리뷰 Important 3: "판정 불가"(done인데 overall_verdict null) 집계를 위해 status도 함께 조회
    supabase.from('analyses').select('scan_id, status, overall_verdict')
      .eq('is_current', true).is('deleted_at', null),
  ]);
  const firstError = sitesRes.error ?? locationsRes.error ?? scansRes.error ?? analysesRes.error;
  if (firstError) {
    return <main className="mx-auto max-w-6xl p-6"><SupabaseErrorNotice message={firstError.message} /></main>;
  }
  const summaries = buildSiteSummaries(
    (sitesRes.data ?? []) as SiteRow[],
    locationsRes.data ?? [],
    scansRes.data ?? [],
    (analysesRes.data ?? []) as { scan_id: string; status: AnalysisStatus; overall_verdict: Verdict | null }[],
  );
  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">현장 목록</h1>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <Link href="/sites/new" className="rounded bg-slate-800 px-3 py-1.5 text-white">새 현장</Link>
        </div>
      </div>
      {summaries.length === 0 ? (
        // C2: "현장이 없습니다"만으로는 처음 온 사용자가 다음에 뭘 해야 할지 알 수
        // 없다 — 전체 흐름 3단계와 시작 버튼을 함께 보여준다.
        <div className="rounded border border-dashed bg-slate-50 p-8 text-center">
          <p className="text-slate-600">아직 등록된 현장이 없습니다. 아래 순서로 시작하세요.</p>
          <ol className="mx-auto mt-4 flex max-w-2xl flex-col gap-2 text-left text-sm sm:flex-row sm:gap-4">
            <li className="flex-1 rounded border bg-white p-3">
              <span className="font-semibold text-blue-700">1. 현장 등록</span>
              <p className="mt-1 text-slate-500">공사 현장(건물)을 하나 만듭니다.</p>
            </li>
            <li className="flex-1 rounded border bg-white p-3">
              <span className="font-semibold text-blue-700">2. 측정위치 추가</span>
              <p className="mt-1 text-slate-500">동/층/공간 등 스캔할 위치를 등록합니다.</p>
            </li>
            <li className="flex-1 rounded border bg-white p-3">
              <span className="font-semibold text-blue-700">3. 스캔 업로드</span>
              <p className="mt-1 text-slate-500">현장에서 촬영한 스캔 파일을 올려 분석을 시작합니다.</p>
            </li>
          </ol>
          <Link href="/sites/new"
            className="mt-5 inline-block rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
            첫 현장 등록하기
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {summaries.map((s) => <SiteCard key={s.site.id} summary={s} />)}
        </div>
      )}
    </main>
  );
}

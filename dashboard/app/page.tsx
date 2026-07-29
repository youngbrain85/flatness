// 홈(현장 목록)
import Link from 'next/link';
import path from 'path';
import { createClient } from '@/lib/supabase/server';
import { buildSiteSummaries } from '@/lib/domain/summary';
import { dirSizeBytes, fmtBytes } from '@/lib/server/disk-usage';
import { SiteCard } from '@/components/site-card';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import type { SiteRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createClient();
  const [sitesRes, locationsRes, scansRes, analysesRes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    supabase.from('locations').select('id, site_id'),
    supabase.from('scans').select('id, scanned_at, location_id').is('deleted_at', null),
    supabase.from('analyses').select('scan_id, overall_verdict')
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
    (analysesRes.data ?? []) as { scan_id: string; overall_verdict: Verdict | null }[],
  );
  const dataDir = path.resolve(process.env.DATA_DIR ?? '../data');
  const usage = await dirSizeBytes(dataDir);
  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">현장 목록</h1>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <span>로컬 저장 용량: {fmtBytes(usage)}</span>
          <Link href="/sites/new" className="rounded bg-slate-800 px-3 py-1.5 text-white">새 현장</Link>
        </div>
      </div>
      {summaries.length === 0 ? (
        <p className="text-slate-500">현장이 없습니다. 새 현장을 등록하세요.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {summaries.map((s) => <SiteCard key={s.site.id} summary={s} />)}
        </div>
      )}
    </main>
  );
}

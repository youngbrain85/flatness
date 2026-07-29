// 보고서 상세: 진행 상태 · PDF 미리보기 · 다운로드 · 발행 (스펙 §7.6 후반부)
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportActions } from '@/components/report/report-actions';
import { ReportProgress } from '@/components/report/report-progress';
import { GRADE_LABEL, REPORT_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import { dataUrl } from '@/lib/domain/paths';
import type { LocationRow, ReportRow, ScanRow, SiteRow, Surface, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // snapshot은 용량이 커서 화면에서 쓰지 않는다(렌더러 전용) - 선택 목록에서 제외
  const { data: report, error } = await supabase.from('reports')
    .select('id, location_id, title, status, opinion_text, pdf_path, gen_status, gen_error, created_at')
    .eq('id', id).maybeSingle();
  if (error) {
    return <main className="mx-auto max-w-5xl p-6"><SupabaseErrorNotice message={error.message} /></main>;
  }
  if (!report) notFound();
  const r = report as Omit<ReportRow, 'snapshot' | 'created_by'>;

  const { data: location } = await supabase.from('locations').select('*').eq('id', r.location_id).maybeSingle();
  const loc = location as LocationRow | null;
  const { data: site } = loc
    ? await supabase.from('sites').select('*').eq('id', loc.site_id).maybeSingle()
    : { data: null };
  const { data: links } = await supabase.from('report_analyses')
    .select('analysis_id, sort_order').eq('report_id', id).order('sort_order', { ascending: true });
  const analysisIds = (links ?? []).map((l) => l.analysis_id as string);
  const { data: analyses } = analysisIds.length
    ? await supabase.from('analyses').select('id, scan_id, surface, overall_verdict').in('id', analysisIds)
    : { data: [] };
  const scanIds = (analyses ?? []).map((a) => a.scan_id as string);
  const { data: scans } = scanIds.length
    ? await supabase.from('scans').select('id, scanned_at').in('id', scanIds)
    : { data: [] };
  const scannedAt = new Map((scans ?? []).map((s) => [s.id as string, (s as ScanRow).scanned_at]));

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-bold">{r.title}</h1>
        <p className="text-sm text-slate-500">
          {site ? (site as SiteRow).name : ''}
          {loc ? ` / ${[loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ')}` : ''}
          {' · '}{REPORT_STATUS_LABEL[r.status]}
          {loc && <> · <Link href={`/sites/${loc.site_id}`} className="text-blue-700 hover:underline">현장 상세</Link></>}
        </p>
      </div>

      <ReportProgress reportId={r.id} initialStatus={r.gen_status} genError={r.gen_error} reportStatus={r.status} />
      <ReportActions report={{ id: r.id, status: r.status, gen_status: r.gen_status, pdf_path: r.pdf_path }} />

      <section>
        <h2 className="mb-2 font-semibold">포함 분석</h2>
        <ul className="space-y-1 text-sm">
          {(analyses ?? []).map((a) => (
            <li key={a.id as string} className="rounded border bg-white p-2">
              <Link href={`/analyses/${a.id}`} className="hover:underline">
                {SURFACE_LABEL[a.surface as Surface]} · {scannedAt.get(a.scan_id as string) ?? '-'} · 판정{' '}
                {a.overall_verdict ? GRADE_LABEL[a.overall_verdict as Verdict] : GRADE_LABEL.na}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">PDF 미리보기</h2>
        {r.pdf_path && r.gen_status === 'done' ? (
          <iframe title="보고서 PDF 미리보기" src={dataUrl(r.pdf_path)}
            className="h-[70vh] w-full rounded border bg-white" />
        ) : (
          <p className="text-sm text-slate-500">PDF가 아직 생성되지 않았습니다.</p>
        )}
      </section>
    </main>
  );
}

// 보고서 상세: 진행 상태 · PDF 미리보기 · 다운로드 · 발행 (스펙 §7.6 후반부)
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportActions } from '@/components/report/report-actions';
import { ReportDeleteButton } from '@/components/report/report-delete-button';
import { ReportProgress } from '@/components/report/report-progress';
import { PageHeader } from '@/components/ui/page-header';
import { StatusDot } from '@/components/ui/status-dot';
import { GRADE_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import { dataUrl } from '@/lib/domain/paths';
import { reportStatusBadge } from '@/lib/domain/reports';
import type { LocationRow, ReportRow, ScanRow, SiteRow, Surface, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // snapshot은 용량이 커서 화면에서 쓰지 않는다(렌더러 전용) - 선택 목록에서 제외
  const { data: report, error } = await supabase.from('reports')
    .select('id, location_id, title, status, opinion_text, pdf_path, gen_status, gen_error, created_at')
    .eq('id', id).is('deleted_at', null).maybeSingle();
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

  // D7 Step 3: scans/[id]와 같은 브레드크럼 규약(현장 홈 › 현장명 › 측정위치 라벨).
  // loc이 없는(측정위치가 지워진 레거시) 경우에도 막다른 화면을 만들지 않고
  // 현장 홈으로는 돌아갈 수 있게 둔다.
  const locLabel = loc ? [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ') : null;
  const crumbs = loc
    ? [
        { href: '/', label: '현장' },
        { href: `/sites/${loc.site_id}`, label: site ? (site as SiteRow).name : '현장 상세' },
        { label: locLabel! },
      ]
    : [{ href: '/', label: '현장' }];
  const badge = reportStatusBadge(r);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <PageHeader crumbs={crumbs} title={r.title} />
      <StatusDot tone={badge.tone} label={badge.label} />

      <ReportProgress reportId={r.id} initialStatus={r.gen_status} genError={r.gen_error} reportStatus={r.status} />
      <ReportActions report={{ id: r.id, status: r.status, gen_status: r.gen_status, pdf_path: r.pdf_path }} />
      <ReportDeleteButton report={{ id: r.id, status: r.status }} redirectTo="/reports" />

      <section>
        <h2 className="mb-2 font-semibold">포함 분석</h2>
        <ul className="space-y-1 text-sm">
          {(analyses ?? []).map((a) => (
            <li key={a.id as string} className="rounded border bg-white p-2">
              {/* D7: /analyses/[id]는 D6 리다이렉트가 여전히 받아주지만, analyses 행에
                  scan_id가 이미 있으니 여기서는 그 리다이렉트 홉을 만들지 않고 스캔
                  작업대로 바로 링크한다(?analysis=로 이 분석을 인라인 선택). */}
              <Link href={`/scans/${a.scan_id}?analysis=${a.id}`} className="hover:underline">
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

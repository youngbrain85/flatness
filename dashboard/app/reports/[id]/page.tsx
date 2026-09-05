// 보고서 상세: 진행 상태 · PDF 미리보기 · 다운로드 · 발행 (스펙 §7.6 후반부)
// 아트보드: docs/design/cloudscape/ReportDetail.dc.html
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportActions } from '@/components/report/report-actions';
import { ReportDeleteButton } from '@/components/report/report-delete-button';
import { ReportProgress } from '@/components/report/report-progress';
import { Container } from '@/components/ui/container';
import { tableClass } from '@/components/ui/data-table';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
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
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={error.message} /></main>;
  }
  if (!report) notFound();
  const r = report as Omit<ReportRow, 'snapshot' | 'created_by'>;

  // perf-auth-roundtrips: location과 links는 서로 독립이라 병렬로 돈다.
  // site(loc 의존)와 analyses(links 의존)도 서로 독립이라 2차로 병렬.
  const [{ data: location }, { data: links }] = await Promise.all([
    supabase.from('locations').select('*').eq('id', r.location_id).maybeSingle(),
    supabase.from('report_analyses')
      .select('analysis_id, sort_order').eq('report_id', id).order('sort_order', { ascending: true }),
  ]);
  const loc = location as LocationRow | null;
  const analysisIds = (links ?? []).map((l) => l.analysis_id as string);
  const [{ data: site }, { data: analyses }] = await Promise.all([
    loc
      ? supabase.from('sites').select('*').eq('id', loc.site_id).maybeSingle()
      : Promise.resolve({ data: null }),
    analysisIds.length
      ? supabase.from('analyses').select('id, scan_id, surface, overall_verdict').in('id', analysisIds)
      : Promise.resolve({ data: [] }),
  ]);
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
  const included = analyses ?? [];

  // 헤더 액션(아트보드 순서): 삭제 · PDF 다운로드 · PDF 다시 생성 · 발행(primary). 삭제 확인 패널과
  // 발행/재생성 메시지는 각 컴포넌트가 버튼 아래로 펼치므로 위쪽 정렬(items-start)로 감싼다.
  return (
    <main className={PAGE_MAIN}>
      <PageHeader crumbs={crumbs} title={r.title}
        description={<StatusIndicator type={TONE_STATUS[badge.tone]}>{badge.label}</StatusIndicator>}
        actions={
          <div className="flex flex-wrap items-start justify-end gap-2">
            <ReportDeleteButton report={{ id: r.id, status: r.status }} redirectTo="/reports" />
            <ReportActions report={{ id: r.id, status: r.status, gen_status: r.gen_status, pdf_path: r.pdf_path }} />
          </div>
        } />

      <ReportProgress reportId={r.id} initialStatus={r.gen_status} genError={r.gen_error} reportStatus={r.status} />

      <Container title="포함 분석" counter={included.length} padded={false}>
        <ul>
          {included.map((a) => (
            <li key={a.id as string} className="flex h-11 items-center border-b border-cs-divider px-5 last:border-b-0">
              {/* D7: /analyses/[id]는 D6 리다이렉트가 여전히 받아주지만, analyses 행에
                  scan_id가 이미 있으니 여기서는 그 리다이렉트 홉을 만들지 않고 스캔
                  작업대로 바로 링크한다(?analysis=로 이 분석을 인라인 선택). */}
              <Link href={`/scans/${a.scan_id}?analysis=${a.id}`} className={tableClass.link}>
                {SURFACE_LABEL[a.surface as Surface]} · {scannedAt.get(a.scan_id as string) ?? '-'} · 판정{' '}
                {a.overall_verdict ? GRADE_LABEL[a.overall_verdict as Verdict] : GRADE_LABEL.na}
              </Link>
            </li>
          ))}
        </ul>
      </Container>

      {/* 아트보드 ReportDetail: 본문에 20px 여백을 두고 미리보기를 라운드 8로 그 안쪽에 놓는다
          (컨테이너에 꽉 채우지 않는다) - Container의 padded 기본값이 그 여백이다. */}
      <Container title="PDF 미리보기">
        {r.pdf_path && r.gen_status === 'done' ? (
          <iframe title="보고서 PDF 미리보기" src={dataUrl(r.pdf_path)}
            className="block h-[70vh] w-full rounded-lg bg-white" />
        ) : (
          <p className="text-sm text-cs-text-secondary">PDF가 아직 생성되지 않았습니다.</p>
        )}
      </Container>
    </main>
  );
}

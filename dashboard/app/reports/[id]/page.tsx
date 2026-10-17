// 보고서 상세: 진행 상태 · PDF 미리보기 · 다운로드 · 발행 (스펙 §7.6 후반부, §5 16행)
// 아트보드: docs/design/dark/ReportDetail.dc.html
// 현장 밖 경로라 현장 헤더를 이 페이지가 직접 그린다 - 현장은 보고서 → 측정위치 → 현장으로 찾는다.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportActions } from '@/components/report/report-actions';
import { ReportDeleteButton } from '@/components/report/report-delete-button';
import { ReportProgress } from '@/components/report/report-progress';
import { EntryHeader } from '@/components/shell/entry-header';
import { SiteHeader } from '@/components/shell/site-header';
import { Container } from '@/components/ui/container';
import { GradeBadge } from '@/components/ui/grade';
import { Icon } from '@/components/ui/icons';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { Stage } from '@/components/ui/stage';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { SURFACE_LABEL } from '@/lib/domain/labels';
import { dataUrl } from '@/lib/domain/paths';
import { reportIndicator } from '@/lib/domain/reports';
import type { LocationRow, ReportRow, ScanRow, SiteRow, Surface, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '보고서 상세' };

/** PDF 뷰어 열기 옵션: 도구 막대·옆 패널을 숨기고 폭에 맞춘다 - 종이 한 장처럼 보이게(Chrome PDF 뷰어 기준). */
const PDF_VIEW = '#toolbar=0&navpanes=0&view=FitH';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // 헤더 계정 메뉴의 이메일. 인증 가드는 proxy가 맡는다(이 화면은 원래 가드 없이 쓰던 그대로).
  const email = (await getRequestUser())?.email ?? null;
  // snapshot은 용량이 커서 화면에서 쓰지 않는다(렌더러 전용) - 선택 목록에서 제외
  const { data: report, error } = await supabase.from('reports')
    .select('id, location_id, title, status, opinion_text, pdf_path, gen_status, gen_error, created_at')
    .eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) {
    return (
      <>
        <EntryHeader email={email} />
        <main className={MAIN_BG}>
          <div className={PAGE_MAIN}><SupabaseErrorNotice message={error.message} /></div>
        </main>
      </>
    );
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

  // 브레드크럼(스펙 §4.3): 보고서 탭부터 - 보고서 / 제목(아트보드 ReportDetail). 측정위치가 지워진 레거시
  // 보고서는 현장을 알 수 없다 - 막다른 화면 대신 진입 헤더 + '현장 목록 / 제목'으로 돌아갈 길을 남긴다.
  const s = site as SiteRow | null;
  const listHref = s ? `/sites/${s.id}/reports` : '/';
  const crumbs = s
    ? [{ href: listHref, label: '보고서' }, { label: r.title }]
    : [{ href: '/', label: '현장 목록' }, { label: r.title }];
  // 목록(app/sites/[id]/reports/page.tsx)·대시보드와 같은 reportIndicator: 'PDF 생성 중'만 속 빈 고리(in-progress)
  const status = reportIndicator(r);
  const included = analyses ?? [];

  return (
    <>
      {s ? <SiteHeader site={{ id: s.id, name: s.name }} email={email} /> : <EntryHeader email={email} />}
      <main className={MAIN_BG}>
        <div className={PAGE_MAIN}>
          {/* 머리 액션(아트보드 순서): 삭제(위험) · PDF 다운로드 · PDF 다시 생성 · 발행(주). 삭제 확인 상자와
              발행/재생성 메시지는 각 컴포넌트가 이 flex-wrap 줄 아래 한 줄(basis-full)로 펼친다. */}
          <PageHeader crumbs={crumbs} title={r.title}
            description={<StatusIndicator type={status.type}>{status.label}</StatusIndicator>}
            actions={
              <div className="flex flex-wrap items-start justify-end gap-3">
                <ReportDeleteButton report={{ id: r.id, status: r.status }} redirectTo={listHref} />
                <ReportActions report={{ id: r.id, status: r.status, gen_status: r.gen_status, pdf_path: r.pdf_path }} />
              </div>
            } />

          <ReportProgress reportId={r.id} initialStatus={r.gen_status} genError={r.gen_error} reportStatus={r.status} />

          <Container title="포함 분석" counter={included.length}>
            <ul className="flex flex-col">
              {included.map((a) => (
                <li key={a.id as string} className="border-t border-line">
                  {/* D7: /analyses/[id]는 D6 리다이렉트가 여전히 받아주지만, analyses 행에
                      scan_id가 이미 있으니 여기서는 그 리다이렉트 홉을 만들지 않고 스캔
                      작업대로 바로 링크한다(?analysis=로 이 분석을 인라인 선택). */}
                  <Link href={`/scans/${a.scan_id}?analysis=${a.id}`}
                    className="flex min-h-12 items-center justify-between gap-3 text-sm font-semibold text-ink">
                    <span className="min-w-0">
                      {SURFACE_LABEL[a.surface as Surface]} ·{' '}
                      <span className="font-mono text-[13px] font-normal text-ink-2">
                        {scannedAt.get(a.scan_id as string) ?? '-'}
                      </span>
                      {' '}· 판정{' '}
                      <GradeBadge grade={(a.overall_verdict as Verdict | null) ?? 'na'} />
                    </span>
                    <Icon name="chevron-right" className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Container>

          <section aria-labelledby="report-pdf-title" className="flex flex-col gap-3.5">
            <h2 id="report-pdf-title" className="font-heading text-[19px] font-semibold">PDF 미리보기</h2>
            {r.pdf_path && r.gen_status === 'done' ? (
              <>
                {/* 인쇄물이라 밝은 그대로: 검정 스테이지 위 흰 A4 종이(스펙 §5 16행, 아트보드 최대 420px, 210:297) */}
                <Stage className="p-[clamp(16px,3vw,40px)]">
                  <div className="mx-auto aspect-[210/297] w-full max-w-[420px] bg-paper">
                    <iframe title="보고서 PDF 미리보기" src={`${dataUrl(r.pdf_path)}${PDF_VIEW}`}
                      className="block h-full w-full border-0" />
                  </div>
                </Stage>
                <p className="text-xs text-muted">
                  보고서 PDF · <span className="font-mono text-ink-2">{r.pdf_path}</span>
                </p>
              </>
            ) : (
              <Stage className="flex items-center justify-center p-10">
                <p className="text-sm text-muted">PDF가 아직 생성되지 않았습니다.</p>
              </Stage>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

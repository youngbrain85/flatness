// 보고서 생성 화면 (스펙 §7.6 전반부, §5 15행). 아트보드: docs/design/dark/ReportNew.dc.html
// 현장 밖 경로라 현장 헤더를 이 페이지가 직접 그린다. 현장은 경로가 정한다 - ?location=이면 그 측정위치의
// 현장, ?site=면 그 현장이다. 화면 안에서 현장을 고르지 않는다.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportCreateForm, type ReportCandidate } from '@/components/report/report-create-form';
import { ReportLocationPicker } from '@/components/report/report-location-picker';
import { EntryHeader } from '@/components/shell/entry-header';
import { SiteHeader } from '@/components/shell/site-header';
import { Alert } from '@/components/ui/alert';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import type {
  AnalysisKind, JudgeState, LocationRow, ScanRow, SiteRow, SlopeParams, Surface, Verdict,
} from '@/lib/domain/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '보고서 생성' };

// 재판정(slope_judge)이 진행 중인 구배 분석은 후보 목록에 **남기되 선택은 막는다**.
//
// 왜 막는가: 재판정은 analyses.status를 건드리지 않으므로(마이그레이션 009) 진행
// 중에도 status='done'이다. 그 사이 워커는 저장소의 구배 산출물(slope_map.png·
// slope_judged.json)을 x-upsert로 제자리에서 덮어쓰고, 끝나면 analyses.stats·
// overall_verdict도 갱신한다. 이 순간에 보고서를 만들면 DB의 옛 통계와 저장소의
// 새 그림이 섞인 스냅샷이 만들어질 수 있는데, 보고서는 생성 시점에 자산을 복사해
// 굳히고(설계 결정 D8) 발행본은 되돌릴 수 없다(004 fn_reports_finalized_guard).
// 게다가 덮어쓰인 이전 판정은 복원할 수단이 없다(D8) - 발행본만 남고 대조할
// 원본이 사라진다. 막는 쪽의 비용은 재판정이 끝날 때까지의 대기뿐이다.
//
// 왜 목록에서 빼지는 않는가: 완료된 분석이 아무 설명 없이 사라지면 사용자는
// 원인을 알 수 없다. 화면이 사유를 말하고, 끝나면 다시 선택할 수 있게 한다.
//
// 왜 'failed'는 막지 않는가: 재판정이 반영되지 않았을 뿐, 이전 판정이 그대로
// 남아 DB·저장소·화면이 서로 일치하는 종결 상태다(009 대시보드 계약, 분석
// 상세의 JudgeBanner도 이전 판정을 그대로 보여준다).
function judgeBlockReason(state: JudgeState | null): string | null {
  if (state !== 'queued' && state !== 'processing') return null;
  const phase = state === 'processing' ? '재판정 중' : '재판정 대기 중';
  return `${phase}이라 지금은 보고서에 넣을 수 없습니다. 지금 넣으면 곧 덮어쓰일 `
    + '이전 판정이 발행본에 그대로 박제됩니다. 재판정이 끝난 뒤 이 화면을 새로고침하세요.';
}

/** 조회 오류 화면: 현장을 아직 모르므로 진입 헤더 + 오류 안내(본문 클래스는 다른 화면과 같다). */
function errorScreen(email: string | null, message: string) {
  return (
    <>
      <EntryHeader email={email} />
      <main className={MAIN_BG}>
        <div className={PAGE_MAIN}><SupabaseErrorNotice message={message} /></div>
      </main>
    </>
  );
}

export default async function NewReportPage({ searchParams }: {
  searchParams: Promise<{ location?: string; site?: string }>;
}) {
  const { location: locationId, site: siteParam } = await searchParams;
  const supabase = await createClient();
  // 헤더 계정 메뉴의 이메일. 인증 가드는 proxy가 맡는다(이 화면은 원래 가드 없이 쓰던 그대로).
  const email = (await getRequestUser())?.email ?? null;

  if (!locationId) {
    // 현장도 측정위치도 없는 맨 주소(옛 링크·북마크)는 고를 현장이 없다 - 진입 페이지로 보낸다.
    // 화면 안에서 현장을 고르지 않는다(스펙 §5 15행: 현장은 측정위치에서 정해진다).
    if (!siteParam) redirect('/');
    // D7 Step 1: notFound() 대신 측정위치 고르기를 먼저 보여준다. 고르면 ReportLocationPicker가
    // '/reports/new?location=...'로 다시 요청하고, 그 재요청이 이 함수를 처음부터 다시 실행해 아래
    // 후보 쿼리를 그 location으로 새로 돈다 - 후보는 location마다 다르므로 여기서 미리 긁어
    // 클라이언트에 들려 보낼 수 없다. 측정위치는 이 현장 것만 읽는다.
    const [siteRes, locationsRes] = await Promise.all([
      supabase.from('sites').select('*').eq('id', siteParam).maybeSingle(),
      supabase.from('locations').select('*').eq('site_id', siteParam)
        .order('building').order('floor_order').order('room').order('name'),
    ]);
    const listError = siteRes.error ?? locationsRes.error;
    if (listError) return errorScreen(email, listError.message);
    if (!siteRes.data) notFound();
    const site = siteRes.data as SiteRow;
    const locations = (locationsRes.data ?? []) as LocationRow[];
    return (
      <>
        <SiteHeader site={{ id: site.id, name: site.name }} email={email} />
        <main className={MAIN_BG}>
          <div className={PAGE_MAIN}>
            <div className="flex w-full max-w-[760px] flex-col gap-5">
              <PageHeader crumbs={[{ href: `/sites/${site.id}/reports`, label: '보고서' }, { label: '보고서 생성' }]}
                title="보고서 생성" />
              {locations.length === 0 ? (
                // 리뷰 F1(→ Task 10): 측정위치가 없으면 셀렉트가 "선택..."뿐인 막다른 화면이 된다 - 그 자리에서
                // 측정위치를 만들 수 있는 이 현장의 업로드 화면으로 보낸다.
                <EmptyState
                  message="이 현장에는 아직 측정위치가 없습니다. 스캔 업로드 화면에서 측정위치를 만들고 바로 업로드할 수 있습니다."
                  actionHref={`/sites/${site.id}/upload`}
                  actionLabel="스캔 업로드로 시작" />
              ) : (
                // 안내 문구는 '측정위치 선택' 카드의 설명이다
                <Container title="측정위치 선택" description="보고서를 만들 측정위치를 먼저 선택하세요.">
                  <ReportLocationPicker locations={locations} />
                </Container>
              )}
            </div>
          </div>
        </main>
      </>
    );
  }

  const { data: location, error } = await supabase
    .from('locations').select('*').eq('id', locationId).maybeSingle();
  if (error) return errorScreen(email, error.message);
  if (!location) notFound();
  const loc = location as LocationRow;
  const locationLabel = [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ');
  // perf-auth-roundtrips: site와 scans는 서로 독립이라 병렬로 돈다.
  const [{ data: site }, { data: scans }] = await Promise.all([
    supabase.from('sites').select('*').eq('id', loc.site_id).maybeSingle(),
    supabase.from('scans').select('*').eq('location_id', locationId).is('deleted_at', null),
  ]);
  const scanRows = (scans ?? []) as ScanRow[];
  const scanById = new Map(scanRows.map((s) => [s.id, s]));
  // kind 필터는 **지우지 않고 넓힌다**(단계 H). 단계 C가 이 필터를 넣은 이유는 둘이었다:
  // (1) 구배를 보고서에 렌더할 경로가 아예 없었고, (2) 후보 목록에서 평활도와 육안
  // 구별이 안 됐다. 단계 H가 (1)을 워커에 만들었고(과업지시서 11·12쪽이 산출 형식으로
  // CSV·PNG·PDF 3종을 명시했는데 PDF만 빠져 있었다), (2)는 아래에서 kind를 후보에 실어
  // 화면이 **문구로** 구별하는 것으로 해소한다(ANALYSIS_KIND_LABEL). 색만으로 구별하지
  // 않는다 - 스펙 §7.2가 역구배에 세운 원칙과 같다.
  //
  // 필터 자체를 없애지는 않는다. 없애면 앞으로 kind가 늘어날 때 보고서 렌더 경로가
  // 없는 종류가 검증 없이 후보로 흘러들어, 형식만 멀쩡한 빈 섹션이 발행본에 박제된다
  // (그것이 단계 C 주석이 실제로 막고 있던 실패다). 종류를 하나씩 명시적으로 들인다.
  //
  // params를 함께 읽는 이유는 재판정 진행 상태다(위 judgeBlockReason 주석 참고).
  // 여기서 SQL로 걸러내지 않는 것은 의도적이다 - PostgREST에서 params->judge->>state는
  // 평활도 행에서 NULL이라 not-in 계열 필터를 쓰면 평활도 후보가 통째로 사라진다.
  const analysesRes = scanRows.length
    ? await supabase.from('analyses')
        .select('id, scan_id, surface, overall_verdict, auto_summary, user_summary, kind, params')
        .in('scan_id', scanRows.map((s) => s.id))
        .eq('is_current', true).eq('status', 'done')
        .in('kind', ['flatness', 'slope']).is('deleted_at', null)
    : { data: [], error: null };
  if (analysesRes.error) return errorScreen(email, analysesRes.error.message);

  const candidates: ReportCandidate[] = (analysesRes.data ?? []).map((a): ReportCandidate => {
    const scan = scanById.get(a.scan_id as string);
    // judge는 구배 분석에만 있다(SlopeParams). 평활도 행에는 params.judge가 없으므로
    // 아래 차단 조건이 평활도 후보를 잡아채는 일은 없다.
    const judgeState = (a.params as SlopeParams | null)?.judge?.state ?? null;
    return {
      analysis_id: a.id as string,
      kind: a.kind as AnalysisKind,
      surface: a.surface as Surface,
      scanned_at: scan?.scanned_at ?? '-',
      // 엔진이 낸 판정(overall_verdict)을 그대로 싣는다 - 화면은 등급 배지 색을 고를 뿐 판정하지 않는다
      grade: (a.overall_verdict as Verdict | null) ?? 'na',
      summary: (a.user_summary as string | null) ?? (a.auto_summary as string | null),
      blocked_reason: judgeBlockReason(judgeState),
    };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.surface.localeCompare(b.surface));

  const s = site as SiteRow | null;
  // 브레드크럼(스펙 §4.3): 보고서 탭부터 - 보고서 / 보고서 생성(아트보드 ReportNew). 측정위치는 h1 아래 설명.
  const crumbs = [{ href: `/sites/${loc.site_id}/reports`, label: '보고서' }, { label: '보고서 생성' }];

  return (
    <>
      {/* 현장 행을 못 읽으면(RLS 등) 현장 헤더를 그릴 수 없다 - 진입 헤더로 대신한다(막다른 화면 금지) */}
      {s ? <SiteHeader site={{ id: s.id, name: s.name }} email={email} /> : <EntryHeader email={email} />}
      <main className={MAIN_BG}>
        <div className={PAGE_MAIN}>
          {/* 아트보드: 브레드크럼·머리·카드·버튼 줄이 760px 한 열 */}
          <div className="flex w-full max-w-[760px] flex-col gap-5">
            <PageHeader crumbs={crumbs} title="보고서 생성" description={locationLabel} />
            {candidates.length === 0 ? (
              // 막다른 화면 금지 - 이 측정위치를 미리 고른 업로드 화면으로 잇는다
              <Alert type="info">
                이 측정위치에는 완료된 분석이 없습니다. 스캔을 업로드하고 분석이 끝난 뒤 다시 시도하세요.{' '}
                <Link href={`/sites/${loc.site_id}/upload?location=${locationId}`}
                  className="font-semibold text-ink underline decoration-line-3 underline-offset-4">스캔 업로드</Link>
              </Alert>
            ) : (
              <ReportCreateForm locationId={locationId} locationLabel={locationLabel} candidates={candidates} />
            )}
          </div>
        </div>
      </main>
    </>
  );
}

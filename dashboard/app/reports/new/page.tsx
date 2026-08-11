// 보고서 생성 화면 (스펙 §7.6 전반부)
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportCreateForm, type ReportCandidate } from '@/components/report/report-create-form';
import { ReportLocationPicker } from '@/components/report/report-location-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { GRADE_LABEL } from '@/lib/domain/labels';
import type {
  AnalysisKind, JudgeState, LocationRow, ScanRow, SiteRow, SlopeParams, Surface, Verdict,
} from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

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

export default async function NewReportPage({ searchParams }: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location: locationId } = await searchParams;
  const supabase = await createClient();

  // D7 Step 1: notFound() 대신 측정위치 선택 UI를 먼저 보여준다. 선택하면
  // ReportLocationPicker가 '/reports/new?location=...'로 다시 요청하고, 그 재요청이
  // 이 함수를 처음부터 다시 실행해 아래 후보 쿼리를 그 location으로 새로 돈다 -
  // 후보는 location마다 다르므로 여기서 미리 긁어 클라이언트에 들려 보낼 수 없다.
  if (!locationId) {
    const [sitesRes, locationsRes] = await Promise.all([
      supabase.from('sites').select('*').order('name'),
      supabase.from('locations').select('*'),
    ]);
    const listError = sitesRes.error ?? locationsRes.error;
    if (listError) {
      return <main className="mx-auto max-w-4xl p-6"><SupabaseErrorNotice message={listError.message} /></main>;
    }
    const allLocations = (locationsRes.data ?? []) as LocationRow[];
    // 리뷰 F1: 측정위치가 하나도 없으면(모든 현장이 빈 현장인 경우도 포함 - 시·현장
    // 유무와 무관하게 locations 자체가 0건인지로 판단한다) 셀렉트가 "선택..."뿐인 빈
    // 상태로 남아 막다른 화면이 된다. 같은 파일의 "후보 0건" 분기(/upload?location=
    // 유도)·목록 EmptyState와 같은 원칙으로, 현장·측정위치를 인라인 생성할 수 있는
    // 업로드 화면으로 보낸다.
    if (allLocations.length === 0) {
      return (
        <main className="mx-auto max-w-4xl space-y-4 p-6">
          <PageHeader crumbs={[{ href: '/', label: '현장' }]} title="보고서 생성" />
          <EmptyState
            message="아직 측정위치가 없습니다. 업로드 화면에서 현장·측정위치 생성부터 스캔 업로드까지 한 번에 할 수 있습니다."
            actionHref="/upload"
            actionLabel="업로드로 시작"
          />
        </main>
      );
    }
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <PageHeader crumbs={[{ href: '/', label: '현장' }]} title="보고서 생성" />
        <p className="text-sm text-zinc-500">보고서를 만들 측정위치를 먼저 선택하세요.</p>
        <ReportLocationPicker sites={(sitesRes.data ?? []) as SiteRow[]} locations={allLocations} />
      </main>
    );
  }

  const { data: location, error } = await supabase
    .from('locations').select('*').eq('id', locationId).maybeSingle();
  if (error) {
    return <main className="mx-auto max-w-4xl p-6"><SupabaseErrorNotice message={error.message} /></main>;
  }
  if (!location) notFound();
  const loc = location as LocationRow;
  const locationLabel = [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ');

  const { data: scans } = await supabase
    .from('scans').select('*').eq('location_id', locationId).is('deleted_at', null);
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
  if (analysesRes.error) {
    return <main className="mx-auto max-w-4xl p-6"><SupabaseErrorNotice message={analysesRes.error.message} /></main>;
  }

  const candidates: ReportCandidate[] = (analysesRes.data ?? []).map((a) => {
    const scan = scanById.get(a.scan_id as string);
    const verdict = a.overall_verdict as Verdict | null;
    // judge는 구배 분석에만 있다(SlopeParams). 평활도 행에는 params.judge가 없으므로
    // 아래 차단 조건이 평활도 후보를 잡아채는 일은 없다.
    const judgeState = (a.params as SlopeParams | null)?.judge?.state ?? null;
    return {
      analysis_id: a.id as string,
      kind: a.kind as AnalysisKind,
      surface: a.surface as Surface,
      scanned_at: scan?.scanned_at ?? '-',
      verdict_label: verdict ? GRADE_LABEL[verdict] : GRADE_LABEL.na,
      summary: (a.user_summary as string | null) ?? (a.auto_summary as string | null),
      blocked_reason: judgeBlockReason(judgeState),
    };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.surface.localeCompare(b.surface));

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <PageHeader crumbs={[{ href: '/', label: '현장' }]} title="보고서 생성" />
      <p className="text-sm text-zinc-500">{locationLabel}</p>
      {candidates.length === 0 ? (
        <p className="rounded border bg-white p-4 text-sm text-slate-600">
          이 측정위치에는 완료된 분석이 없습니다. 스캔을 업로드하고 분석이 끝난 뒤 다시 시도하세요.{' '}
          <Link href={`/upload?location=${locationId}`} className="text-blue-700 hover:underline">스캔 업로드</Link>
        </p>
      ) : (
        <ReportCreateForm locationId={locationId} locationLabel={locationLabel} candidates={candidates} />
      )}
    </main>
  );
}

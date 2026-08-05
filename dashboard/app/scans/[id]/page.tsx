// 스캔 상세: 메타데이터 + 상태별 다음 행동
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnalysisProgress } from '@/components/analysis-progress';
import { ReanalyzeButton } from '@/components/reanalyze-button';
import { ScanStatusWatcher } from '@/components/scan-status-watcher';
import {
  ANALYSIS_KIND_LABEL, GRADE_COLOR, GRADE_LABEL, LINEAGE_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL,
} from '@/lib/domain/labels';
import { isExternalImport } from '@/lib/domain/stats';
import type { AnalysisRow, LocationRow, ScanRow } from '@/lib/domain/types';

// Realtime 감시가 필요한 진행 중 상태(리뷰 Important 2) — ready/archived/failed는
// 이미 종결됐거나(ready는 이 화면 자체에서 동기적으로 전이시킨 값) 더 이상 워커가
// 바꾸지 않는 상태라 구독 대상에서 제외한다.
const WATCHED_SCAN_STATUSES = new Set(['uploaded', 'awaiting_unit_confirm']);

export const dynamic = 'force-dynamic';

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: scan } = await supabase.from('scans').select('*').eq('id', id).maybeSingle();
  if (!scan) notFound();
  const s = scan as ScanRow;
  const [locRes, analysesRes] = await Promise.all([
    supabase.from('locations').select('*').eq('id', s.location_id).maybeSingle(),
    supabase.from('analyses').select('*').eq('scan_id', id).is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ]);
  const loc = locRes.data as LocationRow | null;
  const analyses = (analysesRes.data ?? []) as AnalysisRow[];

  // ★ 리뷰 I1(단계 F): 병합 스캔은 정합 성공 즉시 status='ready'로 만들어져 측정위치
  // 트리와 이 화면에 바로 나타난다. 그런데 여기서 정합 화면으로 돌아가는 길이 없으면,
  // 이 경로로 들어온 사용자는 겹쳐보기(RMSE가 원리적으로 못 보는 수평 어긋남을
  // 확인하는 유일한 수단)를 **찾을 방법이 없다.** lineage로 좁혀 질의하므로 일반
  // 스캔은 이 쿼리를 타지 않는다.
  const registrationRes = s.lineage === 'registered'
    ? await supabase.from('registrations').select('id').eq('result_scan_id', id).maybeSingle()
    : null;
  const registrationId = (registrationRes?.data as { id: string } | null | undefined)?.id ?? null;

  // 종류별로 완전히 갈라서 다룬다(컨트롤러 보강 확정 3·5). analyses[0] 하나로 화면
  // 전체를 지배하면 구배 분석을 한 번이라도 돌리는 순간 평활도의 진행 상태·결과
  // 링크·이전 이력이 화면에서 사라진다. 쿼리가 이미 created_at desc이므로 kind로
  // 필터링해도 각 배열 안의 최신순 정렬은 그대로 유지된다.
  const flatnessAnalyses = analyses.filter((a) => (a.kind ?? 'flatness') === 'flatness');
  const slopeAnalyses = analyses.filter((a) => a.kind === 'slope');
  const latestFlatness = flatnessAnalyses[0];
  const latestSlope = slopeAnalyses[0];

  // 임포트 결과(외부 프로그램 CSV/JSON)는 점 단위 편차 목록이지 점군이 아니라 구배
  // 분석을 걸 수 없다(컨트롤러 보강 확정 4). 평활도 재분석 버튼(kind='flatness')이
  // 참고할 isImport는 latestFlatness 기준을 유지한다 - 재분석 대상이 바로
  // latestFlatness이므로 "그 분석 자체가 임포트 결과인가"를 물어야 옳다(C1: 임포트
  // 결과를 'analyze' 잡으로 다시 돌리면 Colab 편차값이 무시된다).
  const isImport = latestFlatness
    ? isExternalImport(latestFlatness.engine_version, latestFlatness.stats?.meta)
    : false;
  // 리뷰 Important(재리뷰 I-new): 구배 "버튼 노출" 판별은 latestFlatness 하나만 보면
  // 안 된다. isExternalImport는 engine_version/stats.meta.source로 판별하는데 워커는
  // 이 값들을 잡이 성공 완료했을 때만 채운다(worker/flatworker/jobs.py) - 그래서
  // latestFlatness가 queued/processing/failed면 임포트 여부 자체를 알 수 없다.
  // 1차 수정(status==='done' 요구)은 이 오판은 막았지만, 그 대가로 "평활도를
  // 재분석하는 동안 이미 완료된 구배 결과·이력까지 화면에서 통째로 사라지는" 새
  // 회귀를 만들었다(확정 5 "두 분석은 서로 독립" 위반) - latestFlatness가 아직 done이
  // 아니라는 이유만으로 구배 섹션 전체를 가려버렸기 때문이다.
  //
  // 근본 수정: "임포트 여부 판별"과 "구배 섹션을 그릴지"를 분리한다.
  // - 임포트 판별은 flatnessAnalyses 전체에서 완료(done)된 분석을 아무거나 찾아 쓴다.
  //   완료된 평활도 분석이 하나라도 있으면 그 스캔이 LiDAR인지 임포트인지 이미 알 수
  //   있다(이후 재분석이 진행 중이어도 그 사실은 변하지 않는다). scans 테이블에는
  //   임포트 여부를 나타내는 영속 필드가 없다 - file_format은 'csv'가 스캔/임포트
  //   양쪽 확장자 목록에 걸쳐 있어 판별 불가(upload-form.tsx), lineage는 DB
  //   기본값이자 사용자가 스캔 모드에서도 고를 수 있는 값이라 마찬가지다. 완료된
  //   평활도 분석이 하나도 없으면(첫 분석이 아직 안 끝났거나 실패) 판별 불가로 보고
  //   구배 "버튼"만 숨긴다(받아들인 트레이드오프 - 첫 분석이 끝나면 곧바로 풀린다).
  const doneFlatness = flatnessAnalyses.find((a) => a.status === 'done');
  const isImportUnknownOrTrue = doneFlatness
    ? isExternalImport(doneFlatness.engine_version, doneFlatness.stats?.meta)
    : true;
  // - "섹션을 그릴지"는 버튼 노출과 별개다. 이미 완료된(또는 진행 중인) 구배 분석이
  //   있으면 그 결과는 무조건 보여준다 - latestFlatness가 무슨 상태이든 상관없다.
  const showSlopeButton = s.surface === 'floor' && !isImportUnknownOrTrue && !!loc;
  const showSlopeSection = !!latestSlope || showSlopeButton;

  // ★ 리뷰 Critical(단계 F 최종): status='ready'인데 평활도 analyses 행이 없는 스캔은
  // 지금까지 **분석을 시작할 방법이 아예 없었다.** 이 화면의 분석 진입점 셋이 전부
  // 이 상태를 비껴간다: 단위 확인 링크는 awaiting_unit_confirm 전용이고, 평활도
  // ReanalyzeButton은 latestFlatness(=기존 analyses 행)를 요구하며, 구배 버튼은 완료된
  // 평활도 분석(doneFlatness)을 요구한다. 그런데 측정위치 트리와 이 화면의 상태 칸은
  // SCAN_STATUS_LABEL.ready("분석 준비됨")를 달아 할 수 있다고 말한다 - 막다른 골목이다.
  //
  // 범위를 lineage==='registered'(병합 스캔)로 좁히지 않는다. 결함의 본질은 계보가
  // 아니라 **"ready인데 분석 행이 없다"는 상태 자체**이고, 이 저장소에는 그 상태에
  // 도달하는 경로가 둘 있다:
  //   (1) 정합 성공이 만드는 병합 스캔(worker의 _merged_scan_fields - ready·행 없음),
  //   (2) unit-confirm-form.tsx의 되돌리기까지 실패한 경우. 그 파일 주석(52-56행)이
  //       이미 이 막다른 골목을 그대로 적어 놓고 "관리자에게 알리세요"로 끝난다.
  // 계보로 좁히면 (1)만 고치고 (2)는 죽은 채로 남는다.
  //
  // 단위 확인 화면으로 보내지 않는 이유: 이 상태의 스캔은 unit_scale이 이미 확정돼
  // 있다(병합 점군은 1.0 = 미터, (2)는 확정 직후 실패한 것이다). confirm-unit은
  // "파일 좌표가 m·cm·mm 중 무엇인지 확정하는 단계"라 이미 미터인 점군에는 틀린
  // 안내이고, 거기서 mm를 고르면 멀쩡한 좌표가 1/1000로 망가진다.
  //
  // isImport=false로 고정해도 안전하다(C1 사고 계열 재확인): 임포트 스캔은 이 상태에
  // 존재할 수 없다. upload-form.tsx가 mode='import'에서 status='ready' 승격과 analyses
  // 행 생성을 같은 제출 안에서 하고, 그 행 생성·엔큐가 실패하면 discardScan이 스캔
  // 자체를 soft delete 한다(125-136행). 즉 "ready + 평활도 행 0개"인 임포트 스캔은
  // 어느 경로로도 만들어지지 않는다.
  const showFirstFlatness = s.status === 'ready' && !latestFlatness;

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <h1 className="text-xl font-bold">
        스캔 상세 · {SURFACE_LABEL[s.surface]} · {s.scanned_at}
      </h1>
      <dl className="grid max-w-xl grid-cols-2 gap-x-4 gap-y-1 rounded border bg-white p-4 text-sm">
        <dt className="text-slate-500">측정위치</dt>
        <dd>{loc ? [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ') : '-'}</dd>
        <dt className="text-slate-500">원본 파일</dt><dd>{s.original_filename ?? '-'}</dd>
        <dt className="text-slate-500">장비</dt><dd>{s.device ?? '-'}</dd>
        <dt className="text-slate-500">데이터 계보</dt><dd>{LINEAGE_LABEL[s.lineage]}</dd>
        {/* point_count는 001_schema.sql에 선언만 되고 비어 있다가 단계 E의
            precheck 잡부터 채워진다(worker/flatworker/jobs.py). 그 전에 올라온
            스캔은 계속 null이므로 '-'로 둔다. 단위 확정의 근거는 아니다
            (점 개수는 파일 단위가 m이든 mm이든 같다) - 스캔 규모를 가늠하는
            메타데이터로만 쓴다. */}
        <dt className="text-slate-500">점 개수</dt>
        <dd>{s.point_count === null ? '-' : s.point_count.toLocaleString('ko-KR')}</dd>
        <dt className="text-slate-500">상태</dt><dd>{SCAN_STATUS_LABEL[s.status]}</dd>
        <dt className="text-slate-500">단위 배율</dt><dd>{s.unit_scale ?? '미확정'}</dd>
      </dl>
      {s.lineage === 'registered' && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">두 스캔을 정합해 만든 병합 스캔입니다.</p>
          <p className="mt-1 text-xs text-slate-700">
            분석하기 전에 정합이 실제로 맞았는지 확인하세요. 정합 RMSE는 수직 방향만
            보증하므로, 두 스캔이 수평으로 어긋나 있어도 수치는 정상으로 나옵니다.
            정합 화면의 겹쳐보기가 그 방향을 확인하는 유일한 수단입니다.
          </p>
          {registrationId ? (
            <Link href={`/registrations/${registrationId}`}
              className="mt-2 inline-block rounded bg-blue-700 px-3 py-1.5 text-xs text-white">
              정합 결과·겹쳐보기 확인
            </Link>
          ) : (
            <p className="mt-1 text-xs text-slate-600">
              이 스캔을 만든 정합 이력을 찾지 못했습니다(이력이 삭제됐거나 아직 반영되지
              않았습니다). 겹쳐보기를 볼 수 없으므로 이 스캔의 분석 결과를 판단 근거로
              쓸 때 주의하세요.
            </p>
          )}
        </div>
      )}
      {WATCHED_SCAN_STATUSES.has(s.status) && (
        <ScanStatusWatcher scanId={id} initialStatus={s.status} />
      )}
      {s.status === 'awaiting_unit_confirm' && (
        <Link href={`/scans/${id}/confirm-unit`}
          className="inline-block rounded bg-blue-700 px-3 py-1.5 text-sm text-white">
          단위 확인하고 분석 시작
        </Link>
      )}
      {s.status === 'uploaded' && (
        // E1: 옛 문구는 "워커가 실행 중인지 확인하세요(python -m flatworker)"였다.
        // 운영자 지시문이지 사용자 안내가 아니다 - 대시보드만 쓰는 사용자는 워커를
        // 실행할 수도 확인할 수도 없어서, 정상적인 대기를 장애로 오인한다. 단계 E부터
        // precheck가 높이 뷰까지 렌더하므로 대기 시간 자체도 눈에 띄게 길어졌다.
        <p className="text-sm text-slate-600">
          사전 검사 대기 중입니다. 파일 크기에 따라 수십 초 걸릴 수 있습니다.
          이 화면을 새로고침하면 상태가 갱신됩니다.
        </p>
      )}
      {s.status === 'failed' && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-700">사전 검사에 실패했습니다.</p>
          <p className="mt-1 text-xs text-slate-600">
            가장 흔한 원인은 지원하지 않는 파일 포맷이나 손상·불완전한 파일입니다.
            파일을 확인한 뒤 업로드 화면에서 새 스캔으로 다시 시도하세요. 상세 원인은
            워커 실행 창의 로그에 남습니다(3회 자동 재시도 후에도 실패한 상태입니다).
          </p>
        </div>
      )}
      {showFirstFlatness && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{ANALYSIS_KIND_LABEL.flatness} 분석</h2>
            {user && (
              // latestStatus를 넘기지 않는다 - 이 종류의 분석이 한 번도 없었다는 뜻이므로
              // ReanalyzeButton은 이를 "진행 중 아님"으로 보고 버튼을 활성 상태로 둔다
              // (구배 첫 분석과 같은 취급). criteriaId는 스캔에 현재 적용된 기준이다;
              // 병합 스캔은 이 값을 원본 A에서 물려받는다(worker의 _merged_scan_fields).
              <ReanalyzeButton scanId={id} userId={user.id} surface={s.surface} kind="flatness"
                criteriaId={s.selected_criteria_id ?? undefined}
                isImport={false} />
            )}
          </div>
          <p className="text-sm text-slate-600">
            {s.lineage === 'registered'
              ? '병합 점군은 이미 미터로 환산돼 있어 단위 확인 없이 바로 분석할 수 있습니다. 다만 정합이 실제로 맞았는지는 위 겹쳐보기로 먼저 확인하세요 - 분석은 어긋난 정합도 그대로 받아 수치를 냅니다.'
              : '단위가 확정된 스캔인데 아직 분석이 없습니다. 위 버튼으로 첫 분석을 시작하세요.'}
          </p>
        </section>
      )}
      {latestFlatness && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{ANALYSIS_KIND_LABEL.flatness} 분석</h2>
            {user && (
              // 코드리뷰 Critical(C1): latestFlatness.engine_version/meta로 임포트 결과
              // 여부를 판별해 재분석 잡 타입 분기 근거로 전달한다(isExternalImport, 정의는
              // lib/domain/stats.ts - 배지 표시와 동일 기준 재사용).
              //
              // 코드리뷰 Minor(M3): 판정 기준은 스캔에 현재 적용된
              // scan.selected_criteria_id를 우선한다. latestFlatness.criteria_id(직전
              // 분석이 만들어질 때 스냅샷된 기준)로만 쓰면 사용자가 이후에 스캔의
              // 적용 기준을 바꿔도 재분석이 옛 기준을 그대로 따라가 버려, 버튼이
              // 내건 "판정 기준 변경 후 다시 돌리기" 취지와 어긋난다.
              // selected_criteria_id가 비어 있는 드문 레거시 데이터에서만
              // latestFlatness.criteria_id로 폴백한다.
              <ReanalyzeButton scanId={id} userId={user.id} surface={s.surface} kind="flatness"
                criteriaId={s.selected_criteria_id ?? latestFlatness.criteria_id}
                latestStatus={latestFlatness.status}
                isImport={isImport} />
            )}
          </div>
          <AnalysisProgress analysisId={latestFlatness.id} initialStatus={latestFlatness.status} />
          {flatnessAnalyses.length > 1 && (
            <ul className="text-sm text-slate-600">
              {flatnessAnalyses.slice(1).map((a) => (
                <li key={a.id}>
                  <Link href={`/analyses/${a.id}`} className="hover:underline">
                    이전 분석 {a.created_at.slice(0, 16).replace('T', ' ')}
                    {a.overall_verdict && (
                      <span className="ml-1 rounded px-1.5 text-xs text-white"
                        style={{ backgroundColor: GRADE_COLOR[a.overall_verdict] }}>
                        {GRADE_LABEL[a.overall_verdict]}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {showSlopeSection && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{ANALYSIS_KIND_LABEL.slope} 분석</h2>
            {user && showSlopeButton && (
              // 구배는 항상 클릭 시점에 fn_resolve_criteria(site, 'floor', 'slope')로
              // 기준을 새로 해석하므로 criteriaId를 넘기지 않는다(컨트롤러 보강 확정 1).
              // showSlopeButton이 이미 !isImportUnknownOrTrue로 걸렀으므로 이 버튼은
              // 항상 'analyze' 잡만 건다. 재리뷰 수정: 섹션 자체는 showSlopeSection이
              // 따로 관리하므로(latestSlope 존재만으로도 그려진다) 버튼만 이 조건으로
              // 별도 게이트한다 - 이미 있는 구배 결과를 숨기지 않으면서도 새 구배
              // 분석은 임포트 여부가 확실할 때만 시작하게 한다.
              <ReanalyzeButton scanId={id} userId={user.id} surface="floor" kind="slope"
                siteId={loc?.site_id}
                latestStatus={latestSlope?.status}
                isImport={false} />
            )}
          </div>
          {latestSlope && (
            <>
              <AnalysisProgress analysisId={latestSlope.id} initialStatus={latestSlope.status} />
              {slopeAnalyses.length > 1 && (
                <ul className="text-sm text-slate-600">
                  {slopeAnalyses.slice(1).map((a) => (
                    <li key={a.id}>
                      <Link href={`/analyses/${a.id}`} className="hover:underline">
                        이전 분석 {a.created_at.slice(0, 16).replace('T', ' ')}
                        {a.overall_verdict && (
                          <span className="ml-1 rounded px-1.5 text-xs text-white"
                            style={{ backgroundColor: GRADE_COLOR[a.overall_verdict] }}>
                            {GRADE_LABEL[a.overall_verdict]}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}

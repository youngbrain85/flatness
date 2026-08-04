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

  // 종류별로 완전히 갈라서 다룬다(컨트롤러 보강 확정 3·5). analyses[0] 하나로 화면
  // 전체를 지배하면 구배 분석을 한 번이라도 돌리는 순간 평활도의 진행 상태·결과
  // 링크·이전 이력이 화면에서 사라진다. 쿼리가 이미 created_at desc이므로 kind로
  // 필터링해도 각 배열 안의 최신순 정렬은 그대로 유지된다.
  const flatnessAnalyses = analyses.filter((a) => (a.kind ?? 'flatness') === 'flatness');
  const slopeAnalyses = analyses.filter((a) => a.kind === 'slope');
  const latestFlatness = flatnessAnalyses[0];
  const latestSlope = slopeAnalyses[0];

  // 임포트 결과(외부 프로그램 CSV/JSON)는 점 단위 편차 목록이지 점군이 아니라 구배
  // 분석을 걸 수 없다(컨트롤러 보강 확정 4). 평활도 latest 기준으로 판별한다 - 구배
  // stats에는 meta 키가 아예 없어 latestSlope로 판별하면 항상 false가 나오는
  // 우연에 기대게 된다.
  const isImport = latestFlatness
    ? isExternalImport(latestFlatness.engine_version, latestFlatness.stats?.meta)
    : false;
  // 구배 버튼은 (1) 시드한 구배 기준 5종이 전부 surface='floor'라 벽 스캔에는 의미가
  // 없고(컨트롤러 보강 확정 2) (2) 임포트 스캔에는 걸 수 없으며(확정 4) (3) 스캔이
  // 아직 준비되지 않았으면(단위 미확정 등) 애초에 첫 분석조차 없어 raw_file_path/
  // unit_scale이 갖춰지지 않았을 수 있으므로, 평활도 첫 분석이 이미 존재할 때만
  // 보여준다(latestFlatness가 이 화면에서 "분석 가능 상태"의 유일한 신호다).
  //
  // 리뷰 Important(I1): latestFlatness.status === 'done'도 반드시 함께 확인해야 한다.
  // isExternalImport는 engine_version/stats.meta.source로 판별하는데, 워커는 이 값들을
  // 잡이 성공적으로 끝났을 때만 채운다(worker/flatworker/jobs.py). 그래서 queued·
  // processing·failed 상태의 임포트 분석에서는 isImport가 항상 false로 오판된다.
  // 게다가 import 잡이 재시도 끝에 실패해도 fn_enqueue_job이 건 잡 타입이 'analyze'가
  // 아니면 fn_job_fail이 analyses.status를 건드리지 않으므로(002_functions_seed.sql)
  // 그 임포트 분석 행은 queued에 영구히 머문다 - status==='done' 체크 없이는 구배
  // 버튼이 영구히 노출된 채 눌리면, 엔진이 편차 목록 CSV를 점군 리더로 잘못 읽어
  // 형식만 멀쩡한 구배 결과를 만든다(C1과 같은 사고 계열).
  const showSlopeSection = !!latestFlatness && latestFlatness.status === 'done'
    && s.surface === 'floor' && !isImport && !!loc;

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
        <dt className="text-slate-500">상태</dt><dd>{SCAN_STATUS_LABEL[s.status]}</dd>
        <dt className="text-slate-500">단위 배율</dt><dd>{s.unit_scale ?? '미확정'}</dd>
      </dl>
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
        <p className="text-sm text-slate-600">
          사전 검사 대기 중입니다. 워커가 실행 중인지 확인하세요(python -m flatworker).
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
            {user && (
              // 구배는 항상 클릭 시점에 fn_resolve_criteria(site, 'floor', 'slope')로
              // 기준을 새로 해석하므로 criteriaId를 넘기지 않는다(컨트롤러 보강 확정 1).
              // showSlopeSection이 이미 !isImport로 걸렀으므로 이 버튼은 항상 'analyze'
              // 잡만 건다.
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

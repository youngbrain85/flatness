// 구배 결과 화면 (단계 D 전체 골격) - slope-placeholder.tsx를 대체한다.
//
// stats는 jsonb 컬럼에서 그대로 온다 - SlopeStats 타입은 컴파일 타임 계약일 뿐
// 런타임 무결성을 보장하지 않는다(slope-placeholder.tsx가 세운 방어를 그대로
// 계승한다: artifacts·warnings·summary.counts 키 부재, 편차 3종 null·키 부재,
// coverage_pct 0, stats가 {} 하나뿐인 경우도 TypeError 없이 렌더해야 한다).
//
// analysis.status는 페이지(app/analyses/[id]/page.tsx)에서 이미 'done'을
// 보장한다(AnalysisResult의 "status done 전제" 주석과 같은 계약).
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { ANALYSIS_KIND_LABEL, warningLabel } from '@/lib/domain/labels';
import { dataUrl } from '@/lib/domain/paths';
import { isSlopeCellsFile, slopeCellsJsonUrl } from '@/lib/domain/slope-cells';
import { isSlopeJudgedFile, joinSlopeCells, slopeJudgedJsonUrl } from '@/lib/domain/slope-judged';
import type { SlopeCellResult } from '@/lib/domain/slope-judged';
import { useJudgeStatus } from '@/lib/hooks/use-judge-status';
import { SlopeHeatmapView } from './slope-heatmap-view';
import { SlopeResultTable } from './slope-result-table';
import { SlopeVerdictPanel } from './slope-verdict-panel';
import type { AnalysisRow, DrainPoint, SlopeParams, SlopeStats } from '@/lib/domain/types';

const COUNT_ORDER = ['적합', '경계', '보수', '재시공', '판정불가'] as const;

// 전 셀 판정불가면 편차 통계 3개가 전부 null이다. 키 자체가 없는 레코드(undefined)도
// 같이 받아내도록 == null로 비교한다(slope-placeholder.tsx 방어를 그대로 옮김).
function fmtDevPct(v: number | null | undefined): string {
  return v == null ? '판정 가능한 셀 없음' : `${v.toFixed(2)}%`;
}

export function SlopeResult({ analysis }: { analysis: AnalysisRow }) {
  const router = useRouter();
  // analysis.stats는 공용 컬럼이라 컴파일 타임 타입은 Stats(평활도)다 - 이 컴포넌트는
  // 호출부(app/analyses/[id]/page.tsx)의 isSlopeStats 가드가 이미 format으로
  // 런타임 확인을 마친 뒤에만 렌더되므로 unknown을 거쳐 다시 캐스팅한다.
  const stats = analysis.stats as unknown as SlopeStats;
  const summary = stats.summary ?? ({} as SlopeStats['summary']);
  const counts = summary.counts ?? ({} as SlopeStats['summary']['counts']);
  const warnings = stats.warnings ?? [];
  const artifacts = stats.artifacts;
  const mapPng = artifacts?.map_png;

  // 브리프 D7: cells_json/judged_json 중 하나라도 없으면 재판정할 수 없다(단계
  // C까지 만들어진 분석). 히트맵/결과표/클릭 전부를 접고 안내 화면으로 대체한다.
  const cellsJsonUrl = artifacts ? slopeCellsJsonUrl(artifacts) : null;
  const judgedJsonUrl = artifacts ? slopeJudgedJsonUrl(artifacts) : null;
  const canRejudge = cellsJsonUrl !== null && judgedJsonUrl !== null;

  const initialParams = (analysis.params ?? {}) as SlopeParams;
  const [busy, setBusy] = useState(false);
  const [clickError, setClickError] = useState<string | null>(null);
  const [cells, setCells] = useState<SlopeCellResult[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 배수구는 낙관적 갱신 대상이다(클릭 즉시 지도에 반영) - 폴링이 아니라 클릭
  // 핸들러가 직접 쓰는 값이므로 judge와 분리된 별도 state로 둔다.
  const [drainPoints, setDrainPoints] = useState<DrainPoint[]>(initialParams.drain_points ?? []);

  // 재판정 진행 상태 폴링(브리프 D5). useJudgeStatus 내부 state를 그대로 표시값으로
  // 쓴다 - 별도 effect로 params에 옮겨 담지 않는다(effect 안에서 setState를 동기
  // 호출하면 불필요한 연쇄 렌더가 생긴다 - react-hooks/set-state-in-effect).
  const judge = useJudgeStatus(analysis.id, initialParams.judge ?? null);
  const judgeBusy = judge?.state === 'processing' || judge?.state === 'queued';

  // 재판정이 끝나면(done/failed) 서버 데이터(stats·coverage_pct·overall_verdict 등)를
  // 다시 받아온다 - report-progress.tsx/analysis-progress.tsx와 같은 패턴. 비교
  // 기준을 analysis.params(현재 prop)에서 매번 새로 읽어야 router.refresh() 이후
  // 이 값도 함께 갱신되어 반복 refresh를 멈춘다(ref에 고정하면 무한 반복한다).
  // (setState가 아니라 router.refresh() 호출이므로 위 규칙과 무관하다.)
  const initialJudgeState = initialParams.judge?.state ?? null;
  useEffect(() => {
    if (judge && judge.state !== initialJudgeState
        && (judge.state === 'done' || judge.state === 'failed')) {
      router.refresh();
    }
  }, [judge, initialJudgeState, router]);

  // slope_cells.json + slope_judged.json fetch. judge?.at을 의존성에 넣는 이유:
  // 재판정은 같은 경로를 제자리에서 덮어쓴다(x-upsert:true, 브리프 D8) - URL
  // 문자열 자체는 재판정 전후로 동일하므로, URL만 의존성에 두면 재판정 완료 후
  // 새로 덮어써진 내용을 다시 받아오지 못한다.
  useEffect(() => {
    if (!canRejudge || !cellsJsonUrl || !judgedJsonUrl) return;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      const [cellsRes, judgedRes] = await Promise.all([fetch(cellsJsonUrl), fetch(judgedJsonUrl)]);
      if (!cellsRes.ok || !judgedRes.ok) {
        if (!cancelled) {
          setLoadError('셀 데이터를 저장소에서 찾을 수 없습니다. 파일이 삭제되었거나 아직 업로드되지 않았을 수 있습니다. 스캔 상세에서 재분석을 시도하세요.');
        }
        return;
      }
      const cellsData: unknown = await cellsRes.json();
      const judgedData: unknown = await judgedRes.json();
      if (!isSlopeCellsFile(cellsData) || !isSlopeJudgedFile(judgedData)) {
        if (!cancelled) setLoadError('셀 데이터 형식이 올바르지 않습니다.');
        return;
      }
      const joined = joinSlopeCells(cellsData.cells, judgedData.cells, judgedData.direction_judged);
      if (!cancelled) setCells(joined);
    })();
    return () => { cancelled = true; };
  }, [canRejudge, cellsJsonUrl, judgedJsonUrl, judge?.at]);

  // 배수구 클릭 순서(브리프 D4) ★: 엔큐가 먼저다. 성공해야만 params를 쓴다.
  // 23505(중복)면 params를 절대 건드리지 않는다 - 순서를 뒤집으면 이미 처리 중인
  // 잡이 나중 클릭의 좌표로 판정하는 경합이 생긴다(브리프 실측 시나리오).
  async function handleDrainClick(pt: DrainPoint) {
    if (busy || judgeBusy) return;
    setBusy(true);
    setClickError(null);
    const supabase = createClient();
    const r = await enqueueJob(supabase, 'slope_judge', { analysis_id: analysis.id, drain_points: [pt] });
    if (!r.ok) {
      setBusy(false);
      setClickError(r.message);
      return; // params 건드리지 않음
    }
    const nextParams: SlopeParams = {
      ...initialParams, drain_points: [pt], judge: { state: 'queued', at: new Date().toISOString() },
    };
    const { error } = await supabase.from('analyses').update({ params: nextParams }).eq('id', analysis.id);
    setBusy(false);
    if (error) { setClickError(`상태 갱신에 실패했습니다: ${error.message}`); return; }
    setDrainPoints([pt]); // 낙관적 갱신 - judge는 useJudgeStatus의 Realtime/폴링이 뒤따라 반영한다
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-800 px-3 py-1 text-sm font-bold text-white">
          {ANALYSIS_KIND_LABEL.slope}
        </span>
      </div>

      {!canRejudge ? (
        <div className="space-y-4 rounded-lg border bg-white p-4">
          <div>
            <h3 className="text-sm font-semibold">판정 요약</h3>
            <p className="mt-1 text-sm text-slate-700">
              {COUNT_ORDER.map((k) => `${k} ${counts[k] ?? 0}`).join(' · ')}
            </p>
            <p className="mt-1 text-xs text-slate-500">판정 가능 비율 {(summary.coverage_pct ?? 0).toFixed(1)}%</p>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">평균 편차</dt><dd>{fmtDevPct(summary.mean_dev_pct)}</dd>
            <dt className="text-slate-500">편차 표준편차</dt><dd>{fmtDevPct(summary.std_dev_pct)}</dd>
            <dt className="text-slate-500">최대 편차</dt><dd>{fmtDevPct(summary.max_dev_pct)}</dd>
          </dl>

          {warnings.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">경고</h3>
              <ul className="mt-1 space-y-1">
                {warnings.map((w) => (
                  <li key={w} className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">
                    {warningLabel(w)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mapPng && (
            <div>
              <h3 className="text-sm font-semibold">구배 판정 지도</h3>
              {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUrl(mapPng)} alt="구배 판정 지도"
                className="mt-1 max-w-full rounded border bg-white" />
            </div>
          )}

          <p className="rounded border border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
            이 분석은 재판정할 수 없습니다. 구배 분석을 다시 실행하면 배수구를 지정할 수 있습니다.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-700">
            배수구 위치를 클릭하세요. 클릭하면 그 지점을 기준으로 재판정 작업이 시작되고, 완료되면
            화면이 자동으로 갱신됩니다.
          </p>
          {clickError && <p className="text-xs text-red-600">{clickError}</p>}

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="lg:col-span-2">
              {cells ? (
                <SlopeHeatmapView
                  results={cells}
                  cellM={stats.cell_m}
                  drainPoints={drainPoints}
                  clickable={!busy && !judgeBusy}
                  onDrainClick={handleDrainClick}
                />
              ) : (
                <p className="text-sm text-slate-500">{loadError ?? '셀 데이터 로딩 중...'}</p>
              )}
            </section>
            <div className="lg:sticky lg:top-4 lg:self-start">
              <SlopeVerdictPanel stats={stats} judge={judge} drainPoints={drainPoints} />
            </div>
          </div>

          <section>
            <h2 className="mb-2 font-semibold">셀별 결과표</h2>
            {cells ? (
              <SlopeResultTable results={cells} designPct={stats.threshold?.design_pct ?? 0} />
            ) : (
              <p className="text-sm text-slate-500">{loadError ?? '셀 데이터 로딩 중...'}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

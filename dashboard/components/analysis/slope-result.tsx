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
import { isDirectionAwareCriteria } from '@/lib/domain/slope-direction';
import type { SlopeCellResult } from '@/lib/domain/slope-judged';
import { useJudgeStatus } from '@/lib/hooks/use-judge-status';
import { SlopeHeatmapView } from './slope-heatmap-view';
import { SlopeResultTable } from './slope-result-table';
import { SlopeVerdictPanel } from './slope-verdict-panel';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { KeyValuePairs } from '@/components/ui/key-value';
import type { AnalysisRow, DrainPoint, SlopeParams, SlopeStats } from '@/lib/domain/types';

const COUNT_ORDER = ['적합', '경계', '보수', '재시공', '판정불가'] as const;
// Cloudscape 리스킨(T7) 토큰 - 평활도 AnalysisResult/VerdictPanel과 같은 어휘.
// RESULT_GRID는 analysis-result.tsx와 같은 문자열(평활도 모듈 전체를 import하지 않으려고 복제).
const RESULT_GRID = 'grid items-start gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]';
const LABEL = 'text-sm font-bold';
const NOTE = 'text-xs leading-4 text-cs-text-secondary';
const MUTED = 'text-sm text-cs-text-secondary';
const LINK = 'text-cs-link hover:text-cs-link-hover hover:underline';

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
  // 코드리뷰 M3: slope_cells.json/slope_judged.json 중 한쪽에만 있어 조인에서
  // 빠진 셀 수. 0이면 배너를 그리지 않는다.
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  // 코드리뷰(2차) Minor: drainPoints를 마운트 시점 props로만 초기화(useState 초기값)
  // 하면 이후 서버 데이터가 갱신돼도(다른 탭의 변경, router.refresh() 등) 옛
  // 좌표를 계속 보여준다. 클릭 전까지는 매 렌더 최신 prop(initialParams.drain_points)
  // 을 그대로 따르고, 클릭한 뒤에만 낙관적 값으로 화면에 즉시 반영한다 - 두 값을
  // 하나의 state로 합치지 않고 "언제 덮어쓸지"만 별도로 추적한다.
  const [clickedDrainPoints, setClickedDrainPoints] = useState<DrainPoint[] | null>(null);
  const drainPoints = clickedDrainPoints ?? initialParams.drain_points ?? [];

  // 재판정 진행 상태 폴링(브리프 D5). useJudgeStatus 내부 state를 그대로 표시값으로
  // 쓴다 - 별도 effect로 params에 옮겨 담지 않는다(effect 안에서 setState를 동기
  // 호출하면 불필요한 연쇄 렌더가 생긴다 - react-hooks/set-state-in-effect).
  const judge = useJudgeStatus(analysis.id, initialParams.judge ?? null);
  // 코드리뷰(2차) C2: 'queued'는 judgeBusy에서 뺀다. 워커가 잠깐 내려가면
  // 'queued'에서 오래 머물 수 있는데, 여기 포함시키면 사용자가 스스로 빠져나올
  // 방법이 없는 화면(배너 무한, 클릭 영구 차단)이 된다. 이 저장소가 보고서에서
  // 이미 낸 결론과 같다(lib/domain/reports.ts의 canRegenerate - draft이고
  // gen_status가 processing이 아니면 된다, queued는 막지 않음). 재큐 중 다시
  // 클릭해도 잡이 실제로 대기 중이면 jobs_dedup(23505)이 막아 안내 문구로
  // 바뀌므로 중복 엔큐 걱정은 없다.
  const judgeBusy = judge?.state === 'processing';

  // 코드리뷰(2차) I1: 방향 판정 대상이 아닌 기준(기본 기준 slope-indoor-level 등,
  // 007_slope_analysis.sql:131-133)에서는 배수구 클릭을 비활성화한다. 등급 계산이
  // 아니라 "이 기준이 방향을 보는가"라는 UI 가용성 질문이다(slope-direction.ts
  // isDirectionAwareCriteria 참고, 리트머스 대상 아님).
  const directionAware = isDirectionAwareCriteria(stats.threshold);

  // 재판정이 끝나면(done/failed) 서버 데이터(stats·coverage_pct·overall_verdict 등)를
  // 다시 받아온다 - report-progress.tsx/analysis-progress.tsx와 같은 패턴.
  //
  // ★ 코드리뷰(2차) C1: 비교 기준을 judge.state가 아니라 judge.at으로 삼는다.
  // state로 비교하면(예전 코드) 2회차 이후 재판정에서 refresh가 영구히 멎는다 -
  // 1회차 완료 후 router.refresh()가 initialParams.judge.state를 'done'으로
  // 갱신시키는데, 2회차가 다시 'done'으로 끝나면 'done' !== 'done'이 false라
  // 조건을 아예 타지 않는다(페이지를 새로고침해 최초 prop이 이미 'done'인
  // 경우도 마찬가지 - 그 세션 1회차부터 막힌다). at은 전이마다 반드시 바뀌고,
  // refresh 후에는 prop의 at도 갱신되어 같아지므로 무한 refresh도 생기지 않는다.
  const initialJudgeAt = initialParams.judge?.at ?? null;
  useEffect(() => {
    if (judge && (judge.state === 'done' || judge.state === 'failed') && judge.at !== initialJudgeAt) {
      router.refresh();
    }
  }, [judge, initialJudgeAt, router]);

  // slope_cells.json + slope_judged.json fetch. judge?.at을 의존성에 넣는 이유:
  // 재판정은 같은 경로를 제자리에서 덮어쓴다(x-upsert:true, 브리프 D8) - URL
  // 문자열 자체는 재판정 전후로 동일하므로, URL만 의존성에 두면 재판정 완료 후
  // 새로 덮어써진 내용을 다시 받아오지 못한다(코드리뷰 R-11 회귀 방지 대상).
  useEffect(() => {
    if (!canRejudge || !cellsJsonUrl || !judgedJsonUrl) return;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      // 코드리뷰 Important-3: fetch/json() 모두 reject할 수 있다(네트워크 오류,
      // 또는 200인데 본문이 HTML 오류 페이지라 json 파싱이 실패하는 경우). try/catch
      // 없이 두면 unhandled rejection으로 조용히 죽고 화면은 "로딩 중..."에 영구히
      // 멈춘다 - 이 저장소가 가장 경계하는 실패 양식이므로 반드시 잡아 사용자에게
      // 보여준다.
      try {
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
        // 코드리뷰 M3: 두 파일 중 한쪽에만 있는 셀은 joinSlopeCells가 조용히
        // 빼므로(브리프 D1 관례), 여기서 손실 개수를 세어 사용자에게 알린다 -
        // "조용한 실패를 만들지 마라"는 이 저장소의 가장 강한 경계다.
        const lost = Math.max(cellsData.cells.length, judgedData.cells.length) - joined.length;
        if (!cancelled) { setCells(joined); setUnmatchedCount(lost); }
      } catch (e) {
        if (!cancelled) {
          const detail = e instanceof Error ? e.message : String(e);
          setLoadError(`셀 데이터를 불러오는 중 오류가 발생했습니다: ${detail}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [canRejudge, cellsJsonUrl, judgedJsonUrl, judge?.at]);

  // 배수구 클릭 순서(브리프 D4) ★: 엔큐가 먼저다. 성공해야만 params를 쓴다.
  // 23505(중복)면 params를 절대 건드리지 않는다 - 순서를 뒤집으면 이미 처리 중인
  // 잡이 나중 클릭의 좌표로 판정하는 경합이 생긴다(브리프 실측 시나리오).
  async function handleDrainClick(pt: DrainPoint) {
    if (busy || judgeBusy || !directionAware) return;
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
    setClickedDrainPoints([pt]); // 낙관적 갱신 - judge는 useJudgeStatus의 Realtime/폴링이 뒤따라 반영한다
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Badge tone="neutral">{ANALYSIS_KIND_LABEL.slope}</Badge>
      </div>

      {!canRejudge ? (
        <div className="flex flex-col gap-4 rounded-cs-container border border-cs-divider bg-white p-5">
          <div className="flex flex-col gap-1">
            <h3 className={LABEL}>판정 요약</h3>
            <p className="text-sm">
              {COUNT_ORDER.map((k) => `${k} ${counts[k] ?? 0}`).join(' · ')}
            </p>
            <p className={NOTE}>판정 가능 비율 {(summary.coverage_pct ?? 0).toFixed(1)}%</p>
          </div>

          <KeyValuePairs columns={2} items={[
            { label: '평균 편차', value: fmtDevPct(summary.mean_dev_pct) },
            { label: '편차 표준편차', value: fmtDevPct(summary.std_dev_pct) },
            { label: '최대 편차', value: fmtDevPct(summary.max_dev_pct) },
          ]} />

          {warnings.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className={LABEL}>경고</h3>
              <Alert type="warning">
                <ul className="flex flex-col gap-1 text-xs leading-4">
                  {warnings.map((w) => <li key={w}>{warningLabel(w)}</li>)}
                </ul>
              </Alert>
            </div>
          )}

          {mapPng && (
            <div className="flex flex-col gap-1">
              <h3 className={LABEL}>구배 판정 지도</h3>
              {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUrl(mapPng)} alt="구배 판정 지도"
                className="max-w-full rounded-lg border border-cs-divider bg-white" />
            </div>
          )}

          <Alert type="info">
            이 분석은 재판정할 수 없습니다. 구배 분석을 다시 실행하면 배수구를 지정할 수 있습니다.
          </Alert>
        </div>
      ) : (
        <>
          {/* 코드리뷰(2차) I1: 방향 판정 대상이 아닌 기준에서는 클릭을 권하지 않고
              이유를 알린다. */}
          {directionAware ? (
            <p className="text-sm">
              배수구 위치를 클릭하세요. 클릭하면 그 지점을 기준으로 재판정 작업이 시작되고, 완료되면
              화면이 자동으로 갱신됩니다.
              {/* 코드리뷰 M5: 브리프 D3 - 엔진 PNG는 화면에 다시 그리지 않되(Canvas와
                  색표가 다를 수 있음) 다운로드 링크로는 둔다. */}
              {mapPng && (
                <>
                  {' '}
                  <a href={dataUrl(mapPng)} download className={LINK}>
                    구배 판정 지도(PNG) 다운로드
                  </a>
                </>
              )}
            </p>
          ) : (
            <Alert type="info">
              이 기준({stats.threshold?.use ?? '적용 기준'})은 방향(역구배)을 판정하지 않습니다.
              배수구를 지정해도 방향 결과를 신뢰할 수 없어 클릭을 비활성화했습니다.
              {mapPng && (
                <>
                  {' '}
                  <a href={dataUrl(mapPng)} download className={LINK}>
                    구배 판정 지도(PNG) 다운로드
                  </a>
                </>
              )}
            </Alert>
          )}
          {clickError && <Alert type="error">{clickError}</Alert>}
          {/* 코드리뷰 Important-2: cells가 채워진 뒤(성공적으로 로드된 뒤) 재판정으로
              재fetch가 실패하면, 아래 히트맵/결과표는 옛 cells를 계속 보여주므로
              loadError가 else 분기에 묻혀 전혀 안 보였다 - "화면은 최신, 데이터는
              구식"이라는 조용한 실패를 막기 위해 cells 유무와 무관하게 여기서도
              띄운다. */}
          {loadError && cells && (
            <Alert type="warning">
              최신 판정을 불러오지 못해 이전 판정 결과가 표시되고 있습니다. {loadError}
            </Alert>
          )}
          {/* 코드리뷰 M3: 조용한 셀 누락 방지. */}
          {unmatchedCount > 0 && (
            <Alert type="warning">
              셀 데이터 파일과 판정 결과 파일이 어긋나 {unmatchedCount}개 셀이 화면에서 빠졌습니다.
              구배 분석을 다시 실행하는 것을 권장합니다.
            </Alert>
          )}

          <div className={RESULT_GRID}>
            <section className="min-w-0">
              {cells ? (
                <SlopeHeatmapView
                  results={cells}
                  cellM={stats.cell_m}
                  drainPoints={drainPoints}
                  clickable={!busy && !judgeBusy && directionAware}
                  onDrainClick={handleDrainClick}
                />
              ) : (
                <p className={MUTED}>{loadError ?? '셀 데이터 로딩 중...'}</p>
              )}
            </section>
            <div className="min-w-0 md:sticky md:top-5 md:self-start">
              <SlopeVerdictPanel stats={stats} judge={judge} drainPoints={drainPoints} directionAware={directionAware} />
            </div>
          </div>

          <section className="flex flex-col gap-2">
            {/* 컨테이너 제목이 h2이므로 본문 소제목은 h3 */}
            <h3 className="text-base font-bold leading-5">셀별 결과표</h3>
            {cells ? (
              <SlopeResultTable
                results={cells}
                designPct={stats.threshold?.design_pct ?? null}
                dirPassDeg={stats.threshold?.dir_pass_deg ?? 180}
              />
            ) : (
              <p className={MUTED}>{loadError ?? '셀 데이터 로딩 중...'}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

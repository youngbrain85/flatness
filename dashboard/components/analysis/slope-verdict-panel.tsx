// 구배 판정 패널(아트보드 docs/design/dark/ScanSlope.dc.html 78~126행): KPI 4장 → [판정 요약·적용 기준 |
// 재판정 진행·현재 배수구·경고] 카드 줄. 재판정할 수 없는 옛 분석(브리프 D7)은 SlopeResult 가
// KPI(SlopeKpiGrid)·요약 카드(SlopeSummaryCard)·경고(SlopeWarnings)만 골라 쓴다.
//
// 여기 나오는 pass_pct·re_pct·dir_pass_deg는 판정에 쓰이지 않는다 - 이미 엔진이
// 적용한 기준을 사용자에게 그대로 보여주는 텍스트일 뿐이다(평활도 VerdictPanel이
// 적용 기준의 허용·재시공 값을 그대로 찍는 것과 같은 관례). 이 파일 어디에서도 그 값들과
// 실측치를 비교하지 않는다(리트머스 통과).
import { warningLabel } from '@/lib/domain/labels';
import { SLOPE_GRADE_TO_GRADE } from '@/lib/domain/grade-tone';
import { Alert } from '@/components/ui/alert';
import { GRADE_CLASS } from '@/components/ui/grade';
import { KpiCard, KpiGrid } from '@/components/ui/kpi';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { CARD, CARD_HALF, CARD_ROW, EYEBROW, NOTE } from './result-parts';
import type { DrainPoint, JudgeInfo, SlopeGrade, SlopeStats } from '@/lib/domain/types';

const COUNT_ORDER: SlopeGrade[] = ['적합', '경계', '보수', '재시공', '판정불가'];
const HINT = 'text-[13px] leading-relaxed text-warn';

function fmtDrainPoints(pts: DrainPoint[] | null | undefined): string {
  if (!pts || pts.length === 0) return '없음';
  return pts.map((p) => `(${p.x}, ${p.y})`).join(', ');
}

// stats.drain_points는 slope_judge_cells가 판정에 실제로 쓴 좌표를 [x,y] 쌍
// 배열로 echo한 것이다({x,y} 객체가 아니다 - engine/flatness/core/pipeline.py
// judge_slope_cells 참고). DrainPoint[]([{x,y}]) 형태의 drainPoints(현재 지정,
// 낙관적)와 별개다.
function fmtDrainPointPairs(pts: [number, number][] | null | undefined): string {
  if (!pts || pts.length === 0) return '없음';
  return pts.map(([x, y]) => `(${x}, ${y})`).join(', ');
}

function JudgeBanner({ judge }: { judge: JudgeInfo | null }) {
  if (!judge) return null;
  if (judge.state === 'processing' || judge.state === 'queued') {
    return (
      <StatusIndicator type="in-progress">
        재판정 {judge.state === 'processing' ? '진행 중' : '대기 중'}... 완료되면 화면이 자동으로 갱신됩니다.
      </StatusIndicator>
    );
  }
  if (judge.state === 'failed') {
    // 대시보드 계약(009): error는 state==='failed'일 때만 노출한다. 이전 판정
    // 결과(아래 요약·히트맵)는 analyses.status가 계속 'done'이므로 그대로 보인다.
    return (
      <Alert type="error" title="재판정에 실패했습니다. 이전 판정 결과가 표시되고 있습니다.">
        {judge.error && <p>사유: {judge.error}</p>}
      </Alert>
    );
  }
  return null;
}

/** 편차 KPI 한 장. 전 셀 판정불가면 값이 null 이다(키가 없는 레코드도 == null 로 함께 받는다). */
function DevKpi({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) {
    // 숫자 자리에 안내 문구를 둔다. 안쪽 span 이 KpiCard 의 숫자 글꼴(Anton 40px)을 덮는다
    return (
      <KpiCard label={label}
        value={<span className="font-sans text-base font-normal leading-normal text-muted">판정 가능한 셀 없음</span>} />
    );
  }
  return <KpiCard label={label} value={value.toFixed(2)} unit="%" />;
}

/** KPI 4장(아트보드 ScanSlope 78~95행). summary 는 jsonb 라 키가 비어 있어도 그린다. */
export function SlopeKpiGrid({ summary }: { summary: SlopeStats['summary'] }) {
  return (
    <KpiGrid>
      <KpiCard label="판정 가능 비율" value={(summary.coverage_pct ?? 0).toFixed(1)} unit="%" />
      <DevKpi label="평균 편차" value={summary.mean_dev_pct} />
      <DevKpi label="편차 표준편차" value={summary.std_dev_pct} />
      <DevKpi label="최대 편차" value={summary.max_dev_pct} />
    </KpiGrid>
  );
}

/** 판정 요약(등급별 개수 막대 + 문장)과 적용 기준 카드(아트보드 ScanSlope 97~109행). */
export function SlopeSummaryCard({ stats }: { stats: SlopeStats }) {
  const summary = stats.summary ?? ({} as SlopeStats['summary']);
  const counts = summary.counts ?? ({} as SlopeStats['summary']['counts']);
  const total = COUNT_ORDER.reduce((sum, g) => sum + (counts[g] ?? 0), 0);
  const parts = COUNT_ORDER.map((g) => `${g} ${counts[g] ?? 0}`);
  const threshold = stats.threshold;
  return (
    <div className={`${CARD} ${CARD_HALF} flex flex-col gap-[18px]`}>
      <div className="flex flex-col gap-2.5">
        <p className={EYEBROW}>판정 요약</p>
        {/* 색은 같은 이름의 평활도 등급 토큰(SLOPE_GRADE_TO_GRADE, data-grade 도 그 키). 폭 = 그 등급 셀 수 / 전체 셀 */}
        <div role="img" aria-label={parts.join(', ')} className="flex h-2.5 overflow-hidden rounded-full bg-line">
          {COUNT_ORDER.map((g) => (
            <span key={g} data-grade={SLOPE_GRADE_TO_GRADE[g]} className={GRADE_CLASS[SLOPE_GRADE_TO_GRADE[g]].bg}
              style={{ width: `${total ? ((counts[g] ?? 0) / total) * 100 : 0}%` }} />
          ))}
        </div>
        <p className="font-mono text-xs tabular-nums text-muted">{parts.join(' · ')}</p>
      </div>
      {threshold && (
        <div className="flex flex-col gap-1.5">
          <p className={EYEBROW}>적용 기준</p>
          <p className="text-sm text-ink">
            {`${threshold.use} · 설계 구배 ${threshold.design_pct}% · 허용 ${threshold.pass_pct}% · 재시공 ${threshold.re_pct}% · 방향 허용 ${threshold.dir_pass_deg}도`}
          </p>
        </div>
      )}
    </div>
  );
}

/** 경고(눈썹 라벨 + warning Alert). 경고가 없으면 아무것도 그리지 않는다. */
export function SlopeWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <p className={EYEBROW}>경고</p>
      {/* Alert 가 본문을 13px ink-2 로 감싼다 */}
      <Alert type="warning">
        <ul className="flex flex-col gap-1">
          {warnings.map((w) => <li key={w}>{warningLabel(w)}</li>)}
        </ul>
      </Alert>
    </div>
  );
}

export function SlopeVerdictPanel({ stats, judge, drainPoints, directionAware }: {
  stats: SlopeStats;
  judge: JudgeInfo | null;
  drainPoints: DrainPoint[];
  /** 코드리뷰(2차) I1: 방향 판정 대상이 아닌 기준이면 클릭 자체가 비활성화되므로
   * "지도에서 배수구 위치를 클릭하세요" 안내가 모순된다 - 문구를 갈라 낸다. */
  directionAware: boolean;
}) {
  const summary = stats.summary ?? ({} as SlopeStats['summary']);
  const warnings = stats.warnings ?? [];

  return (
    <div className="flex flex-col gap-3.5">
      <SlopeKpiGrid summary={summary} />
      <div className={CARD_ROW}>
        <SlopeSummaryCard stats={stats} />
        <div className={`${CARD} ${CARD_HALF} flex flex-col gap-[18px]`}>
          <JudgeBanner judge={judge} />
          <div className="flex flex-col gap-1.5">
            <p className={EYEBROW}>현재 배수구</p>
            <p className="font-mono text-sm tabular-nums text-ink">{fmtDrainPoints(drainPoints)}</p>
            {/* 코드리뷰(2차) Minor: 재판정 실패 시 지도에는 거부된 새 배수구가 찍히는데
                히트맵·결과표는 옛 배수구 기준 판정을 보여준다 - "지금 보이는 판정이
                쓴 배수구"가 어디에도 없어 혼란스러웠다. stats.drain_points는 현재
                화면의 grade·히트맵을 낸 그 판정이 실제로 쓴 좌표다. */}
            <p className={NOTE}>이 판정에 사용됨: {fmtDrainPointPairs(stats.drain_points)}</p>
            {judge?.previous_drain_points && judge.previous_drain_points.length > 0 && (
              <p className={NOTE}>직전 배수구: {fmtDrainPoints(judge.previous_drain_points)}</p>
            )}
            {/* 코드리뷰(4차) N3: 조건을 !stats.direction_judged가 아니라
                !directionAware로 옮긴다. 예전 조건은 direction_judged가 이미 true인
                "오염된" 분석(방향 비대상 기준인데도 과거에 배수구를 클릭해 역구배·
                재시공이 노이즈로 찍혀버린 경우)에서는 아예 안 떴다 - I1이 신규
                클릭만 막을 뿐 기존 오탐을 알리지도 되돌리지도 못했다. directionAware
                기준으로 갈면 오염된 분석에서도 경고가 뜬다. */}
            {!directionAware ? (
              <p className={HINT}>
                이 기준은 방향(역구배)을 판정 대상으로 삼지 않습니다.
                {stats.direction_judged && (
                  ' 그런데도 이 판정에는 방향 결과가 포함돼 있어 역구배·재시공 표시가 노이즈일 수 있습니다. '
                  + '구배 분석을 다시 실행해(배수구 지정 없이) 재판정하는 것을 권장합니다.'
                )}
              </p>
            ) : !stats.direction_judged && (
              <p className={HINT}>
                배수구가 지정되지 않아 방향(역구배)은 판정하지 않았습니다. 지도에서 배수구 위치를 클릭하세요.
              </p>
            )}
          </div>
          <SlopeWarnings warnings={warnings} />
          <p className={NOTE}>
            구역별 통계는 후속 단계에서 제공됩니다. 위 통계는 전역(바닥 전체) 기준입니다.
          </p>
        </div>
      </div>
    </div>
  );
}

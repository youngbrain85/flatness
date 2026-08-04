// 구배 판정 요약 + 재판정 진행 상태 (브리프 D5/D7/D8, 스펙 §5.4)
//
// 여기 나오는 pass_pct·re_pct·dir_pass_deg는 판정에 쓰이지 않는다 - 이미 엔진이
// 적용한 기준을 사용자에게 그대로 보여주는 텍스트일 뿐이다(평활도 VerdictPanel이
// applied_criteria.pass_mm/rework_mm을 그대로 찍는 것과 같은 관례). 이 파일
// 어디에서도 그 값들과 실측치를 비교하지 않는다(리트머스 통과).
import { warningLabel } from '@/lib/domain/labels';
import type { DrainPoint, JudgeInfo, SlopeStats } from '@/lib/domain/types';

const COUNT_ORDER = ['적합', '경계', '보수', '재시공', '판정불가'] as const;

function fmtDevPct(v: number | null | undefined): string {
  return v == null ? '판정 가능한 셀 없음' : `${v.toFixed(2)}%`;
}

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
      <p className="flex items-center gap-2 rounded border border-blue-200 bg-blue-50 p-2 text-sm text-blue-800">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600" />
        재판정 {judge.state === 'processing' ? '진행 중' : '대기 중'}... 완료되면 화면이 자동으로 갱신됩니다.
      </p>
    );
  }
  if (judge.state === 'failed') {
    // 대시보드 계약(009): error는 state==='failed'일 때만 노출한다. 이전 판정
    // 결과(아래 요약·히트맵)는 analyses.status가 계속 'done'이므로 그대로 보인다.
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
        <p className="font-medium text-red-700">재판정에 실패했습니다. 이전 판정 결과가 표시되고 있습니다.</p>
        {judge.error && <p className="mt-1 text-xs text-slate-700">사유: {judge.error}</p>}
      </div>
    );
  }
  return null;
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
  const counts = summary.counts ?? ({} as SlopeStats['summary']['counts']);
  const warnings = stats.warnings ?? [];
  const threshold = stats.threshold;

  return (
    <aside className="space-y-4 rounded-lg border bg-white p-4">
      <JudgeBanner judge={judge} />

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

      <div>
        <h3 className="text-sm font-semibold">현재 배수구</h3>
        <p className="mt-1 text-sm text-slate-700">{fmtDrainPoints(drainPoints)}</p>
        {/* 코드리뷰(2차) Minor: 재판정 실패 시 지도에는 거부된 새 배수구가 찍히는데
            히트맵·결과표는 옛 배수구 기준 판정을 보여준다 - "지금 보이는 판정이
            쓴 배수구"가 어디에도 없어 혼란스러웠다. stats.drain_points는 현재
            화면의 grade·히트맵을 낸 그 판정이 실제로 쓴 좌표다. */}
        <p className="mt-1 text-xs text-slate-500">
          이 판정에 사용됨: {fmtDrainPointPairs(stats.drain_points)}
        </p>
        {judge?.previous_drain_points && judge.previous_drain_points.length > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            직전 배수구: {fmtDrainPoints(judge.previous_drain_points)}
          </p>
        )}
        {!stats.direction_judged && (
          <p className="mt-1 text-xs text-amber-700">
            {directionAware
              ? '배수구가 지정되지 않아 방향(역구배)은 판정하지 않았습니다. 지도에서 배수구 위치를 클릭하세요.'
              : '이 기준은 방향(역구배)을 판정 대상으로 삼지 않습니다.'}
          </p>
        )}
      </div>

      {threshold && (
        <div>
          <h3 className="text-sm font-semibold">적용 기준</h3>
          <p className="text-xs text-slate-600">
            {threshold.use} · 설계 구배 {threshold.design_pct}% · 허용 {threshold.pass_pct}% ·
            {' '}재시공 {threshold.re_pct}% · 방향 허용 {threshold.dir_pass_deg}도
          </p>
        </div>
      )}

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

      <p className="text-xs text-slate-500">
        구역별 통계는 후속 단계에서 제공됩니다. 위 통계는 전역(바닥 전체) 기준입니다.
      </p>
    </aside>
  );
}

// 판정 패널(아트보드 docs/design/dark/ScanDone.dc.html 90~159행): KPI 5장 → [등급 분포·적용 기준 | 경고·고지]
// 카드 줄 → 종합의견 카드. 결과 구획의 탭과 상관없이 늘 보인다.
// - 판정 KPI 는 엔진이 낸 analysis.overall_verdict 그대로다. 셀 등급 중 가장 나쁜 것을 고르는 계산을
//   브라우저가 하지 않는다(아트보드 시안 코드는 셀에서 셌지만 시안용 자료 처리일 뿐이다).
// - KPI 는 아트보드의 5장이다. 최소·평균(mm)은 구간별 결과표의 구역별 값으로 남는다.
// - 저장 로직·문구는 그대로다. 저장은 보조 버튼이다(주 버튼은 한 화면에 하나이고 페이지가 정한다).
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { GRADE_LABEL, fmtMm, warningLabel } from '@/lib/domain/labels';
import { coverageLabel } from '@/lib/domain/stats';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { textareaClass } from '@/components/ui/form';
import { GRADE_CLASS } from '@/components/ui/grade';
import { KpiCard, KpiGrid } from '@/components/ui/kpi';
import { CARD, CARD_HALF, CARD_ROW, EYEBROW, NOTE } from './result-parts';
import type { AnalysisRow, Grade, Stats } from '@/lib/domain/types';

const BAR_ORDER: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];
// 아트보드 ScanDone 137행의 고지 문단. 자동 종합의견의 끝 문장(엔진 outputs/summary.py)과 같은 문장이다
const SCREENING_NOTICE = '본 결과는 모바일 LiDAR 기반 스크리닝이며 공식 검측(실물 직선자·레벨 측량)을 대체하지 않습니다.';

export function VerdictPanel({ analysis, stats }: { analysis: AnalysisRow; stats: Stats }) {
  const [summary, setSummary] = useState(analysis.user_summary ?? '');
  const [saved, setSaved] = useState<string | null>(null);

  async function saveSummary() {
    const { error } = await createClient().from('analyses')
      .update({ user_summary: summary || null }).eq('id', analysis.id);
    setSaved(error ? `저장 실패: ${error.message}` : '저장되었습니다');
  }

  const c = stats.applied_criteria;
  const verdict = analysis.overall_verdict;
  const dist = BAR_ORDER.map((g) => `${GRADE_LABEL[g]} ${stats.grade_counts[g]}`);
  const limits = c.span_m !== null
    ? `${c.span_m}m당 허용 ${c.pass_mm}mm · 재시공 ${c.rework_mm}mm`
    : `수직도 허용 ${c.pass_mm}mm · 재시공 ${c.rework_mm}mm`;

  return (
    <div className="flex flex-col gap-3.5">
      <KpiGrid>
        {/* 판정 KPI: KpiCard tone = 등급 점 + 등급 색 이름(제목 글꼴 30px 700, 아트보드 93행). 판정이 없으면
            같은 글꼴의 muted 문구다(안쪽 span 이 KpiCard 의 숫자 글꼴을 덮는다) */}
        {verdict ? (
          <KpiCard label="판정" tone={verdict} value={GRADE_LABEL[verdict]} />
        ) : (
          <KpiCard label="판정" value={
            <span className="font-heading text-[30px] font-bold leading-[1.2] text-muted">판정 없음</span>
          } />
        )}
        <KpiCard label="최대 편차" value={fmtMm(stats.value_max_mm)}
          unit={stats.value_max_mm === null ? undefined : 'mm'} />
        <KpiCard label="95퍼센타일" value={fmtMm(stats.value_p95_mm)}
          unit={stats.value_p95_mm === null ? undefined : 'mm'} />
        <KpiCard label="판정 셀(유효/전체)" value={String(stats.n_valid)} unit={`/ ${stats.n_cells}`} />
        <KpiCard label={coverageLabel(stats)} value={String(stats.coverage_pct)} unit="%" />
      </KpiGrid>

      <div className={CARD_ROW}>
        <div className={`${CARD} ${CARD_HALF} flex flex-col gap-[18px]`}>
          <div className="flex flex-col gap-2.5">
            <p className={EYEBROW}>등급 분포</p>
            {/* 폭 = 등급 셀 수 / 전체 셀(표시 로직은 기존 그대로). 색은 등급 토큰(캔버스·범례와 같은 화면 등급 색) */}
            <div role="img" aria-label={dist.join(', ')} className="flex h-2.5 overflow-hidden rounded-full bg-line">
              {BAR_ORDER.map((g) => (
                <span key={g} data-grade={g} className={GRADE_CLASS[g].bg}
                  style={{ width: `${stats.n_cells ? (stats.grade_counts[g] / stats.n_cells) * 100 : 0}%` }} />
              ))}
            </div>
            <p className="font-mono text-xs tabular-nums text-muted">{dist.join(' · ')}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className={EYEBROW}>적용 기준</p>
            <p className="font-mono text-sm text-ink">{c.name}</p>
            <p className={NOTE}>{c.source} · {limits} · 불확도 U={c.u_mm}mm</p>
            {stats.reduced_span_cells > 0 && (
              <p className={NOTE}>축소 스팬 적용 셀 {stats.reduced_span_cells}개 (허용치 선형 환산)</p>
            )}
          </div>
        </div>
        <div className={`${CARD} ${CARD_HALF} flex flex-col gap-4`}>
          {stats.warnings.length > 0 && (
            // Alert 가 본문을 13px ink-2 로 감싼다
            <Alert type="warning">
              <ul className="flex flex-col gap-1">
                {stats.warnings.map((w) => <li key={w}>{warningLabel(w)}</li>)}
              </ul>
            </Alert>
          )}
          <p className={NOTE}>{SCREENING_NOTICE}</p>
        </div>
      </div>

      <div className={`${CARD} flex flex-wrap gap-x-7 gap-y-5`}>
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
          <p className={EYEBROW}>종합의견</p>
          {/* 자동 의견은 줄바꿈이 든 한 문자열 - 문단으로 쪼개는 로직을 더하지 않고 pre-wrap으로 그대로 */}
          <p className="whitespace-pre-wrap rounded-control border border-line-2 bg-ground px-4 py-3.5 text-[13px] leading-relaxed text-ink-2">
            {analysis.auto_summary ?? stats.auto_summary}
          </p>
        </div>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1.5">
          <label htmlFor="user-summary" className="text-sm font-semibold text-ink">종합의견(사용자 수정)</label>
          <textarea id="user-summary" rows={5} value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={textareaClass}
            placeholder="자동 의견에 덧붙일 해석·조치 계획을 적습니다. 보고서(P4)에 함께 실립니다." />
          <div className="flex flex-wrap items-center gap-3 pt-1.5">
            <Button onClick={saveSummary}>저장</Button>
            {saved && <span role="status" className="text-[13px] text-muted">{saved}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

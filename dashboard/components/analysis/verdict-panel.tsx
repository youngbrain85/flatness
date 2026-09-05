// C안 우측 판정 패널 - Cloudscape 리스킨(T7). 저장 로직·문구·판별(isExternalImport)은 그대로.
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { GRADE_COLOR, GRADE_LABEL, fmtMm, warningLabel } from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { coverageLabel, isExternalImport } from '@/lib/domain/stats';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { textareaClass } from '@/components/ui/form';
import { KeyValuePairs } from '@/components/ui/key-value';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
import type { AnalysisRow, Grade, Stats } from '@/lib/domain/types';

const BAR_ORDER: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];
const LABEL = 'text-sm font-bold';
const NOTE = 'text-xs leading-4 text-cs-text-secondary';
const NUM = 'font-mono tabular-nums';
// 판정 헤드라인 18px/22px 700(아트보드). ★ text-lg를 쓰면 안 된다 - Tailwind v4는 .text-lg를
// .text-sm보다 앞에 내보내므로(속성 수 같으면 이름순) StatusIndicator 자체의 text-sm이 이긴다
// (v4.3.3에서 확인). 임의값 text-[18px]는 속성이 하나라 그 뒤에 나와 font-size를 확실히 덮고,
// leading-[22px]가 --tw-leading으로 line-height를 덮는다.
const HEADLINE = 'text-[18px] font-bold leading-[22px]';

export function VerdictPanel({ analysis, stats }: { analysis: AnalysisRow; stats: Stats }) {
  const [summary, setSummary] = useState(analysis.user_summary ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const external = isExternalImport(analysis.engine_version, stats.meta);

  async function saveSummary() {
    const { error } = await createClient().from('analyses')
      .update({ user_summary: summary || null }).eq('id', analysis.id);
    setSaved(error ? `저장 실패: ${error.message}` : '저장되었습니다');
  }

  const c = stats.applied_criteria;

  return (
    <aside className="flex flex-col gap-4 rounded-cs-container border border-cs-divider bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        {analysis.overall_verdict ? (
          // D8 픽스 계승: 색은 GRADE_TONE -> TONE_STATUS(시스템 색)로만 얻는다(인라인 hex 금지).
          <StatusIndicator type={TONE_STATUS[GRADE_TONE[analysis.overall_verdict]]} className={HEADLINE}>
            {GRADE_LABEL[analysis.overall_verdict]}
          </StatusIndicator>
        ) : (
          <StatusIndicator type="pending" className={HEADLINE}>판정 없음</StatusIndicator>
        )}
        {external && <Badge tone="external">외부 결과</Badge>}
      </div>

      <KeyValuePairs columns={2} items={[
        { label: '최대 편차(mm)', value: <span className={`${NUM} font-bold`}>{fmtMm(stats.value_max_mm)}</span> },
        { label: '최소(mm)', value: <span className={NUM}>{fmtMm(stats.value_min_mm)}</span> },
        { label: '평균(mm)', value: <span className={NUM}>{fmtMm(stats.value_mean_mm)}</span> },
        { label: '95퍼센타일(mm)', value: <span className={NUM}>{fmtMm(stats.value_p95_mm)}</span> },
        { label: '판정 셀(유효/전체)', value: <span className={NUM}>{stats.n_valid} / {stats.n_cells}</span> },
        { label: coverageLabel(stats), value: <span className={NUM}>{stats.coverage_pct}%</span> },
      ]} />
      {stats.reduced_span_cells > 0 && (
        <p className={NOTE}>축소 스팬 적용 셀 {stats.reduced_span_cells}개 (허용치 선형 환산)</p>
      )}

      <div className="flex flex-col gap-1">
        <h3 className={LABEL}>등급 분포</h3>
        {/* 5등급 분포 바 - 표시 로직(폭 = 등급 수/전체 셀)은 기존 그대로. 색은 바로 옆 범례·캔버스와
            같은 GRADE_COLOR(태스크 결정 - 같은 등급이 패널과 범례에서 다른 색으로 보이지 않게). */}
        <div className="flex h-2 overflow-hidden rounded bg-cs-divider">
          {BAR_ORDER.map((g) => (
            <div key={g} data-grade={g} style={{
              backgroundColor: GRADE_COLOR[g],
              width: `${stats.n_cells ? (stats.grade_counts[g] / stats.n_cells) * 100 : 0}%`,
            }} />
          ))}
        </div>
        <p className={`${NOTE} tabular-nums`}>
          {BAR_ORDER.map((g) => `${GRADE_LABEL[g]} ${stats.grade_counts[g]}`).join(' · ')}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className={LABEL}>적용 기준</h3>
        <p className="font-mono text-sm">{c.name}</p>
        <p className={NOTE}>{c.source}</p>
        <p className={NOTE}>
          {c.span_m !== null
            ? `${c.span_m}m당 허용 ${c.pass_mm}mm / 재시공 ${c.rework_mm}mm`
            : `수직도 허용 ${c.pass_mm}mm / 재시공 ${c.rework_mm}mm`}
          {' · '}불확도 U={c.u_mm}mm
        </p>
      </div>

      {stats.warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>경고</h3>
          <Alert type="warning">
            <ul className="flex flex-col gap-1 text-xs leading-4">
              {stats.warnings.map((w) => <li key={w}>{warningLabel(w)}</li>)}
            </ul>
          </Alert>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className={LABEL}>종합의견</h3>
        {/* 자동 의견은 줄바꿈이 든 한 문자열 - 문단으로 쪼개는 로직을 더하지 않고 pre-wrap으로 그대로 */}
        <p className="whitespace-pre-wrap rounded-lg border border-cs-divider p-3 text-xs leading-4 text-cs-nav-text">
          {analysis.auto_summary ?? stats.auto_summary}
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="user-summary" className={LABEL}>종합의견(사용자 수정)</label>
          <textarea id="user-summary" rows={4} value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={textareaClass}
            placeholder="자동 의견에 덧붙일 해석·조치 계획을 적습니다. 보고서(P4)에 함께 실립니다." />
        </div>
        <div className="flex items-center gap-2">
          {/* 뷰당 primary 1개(스펙 §4): 이 뷰(ScanDone)의 primary는 페이지 헤더의 '이 위치의 보고서 생성'이므로
              저장은 normal(기본 variant). 아트보드는 primary로 그렸지만 §4 규칙이 우선한다. */}
          <Button onClick={saveSummary}>저장</Button>
          {saved && <span className={NOTE}>{saved}</span>}
        </div>
      </div>
    </aside>
  );
}

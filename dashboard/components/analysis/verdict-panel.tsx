// C안 우측 고정 판정 패널
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { GRADE_COLOR, GRADE_LABEL, fmtMm, warningLabel } from '@/lib/domain/labels';
import { coverageLabel, isExternalImport } from '@/lib/domain/stats';
import type { AnalysisRow, Grade, Stats } from '@/lib/domain/types';

const BAR_ORDER: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];

export function VerdictPanel({ analysis, stats }: { analysis: AnalysisRow; stats: Stats }) {
  const [summary, setSummary] = useState(analysis.user_summary ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const external = isExternalImport(analysis.engine_version, stats.meta);

  async function saveSummary() {
    const { error } = await createClient().from('analyses')
      .update({ user_summary: summary || null }).eq('id', analysis.id);
    setSaved(error ? `저장 실패: ${error.message}` : '저장되었습니다');
  }

  return (
    <aside className="space-y-4 rounded-lg border bg-white p-4">
      <div className="flex items-center gap-2">
        {analysis.overall_verdict ? (
          <span className="rounded px-3 py-1 text-lg font-bold text-white"
            style={{ backgroundColor: GRADE_COLOR[analysis.overall_verdict] }}>
            {GRADE_LABEL[analysis.overall_verdict]}
          </span>
        ) : (
          <span className="rounded bg-slate-400 px-3 py-1 text-lg font-bold text-white">판정 없음</span>
        )}
        {external && (
          <span className="rounded border border-purple-400 px-2 py-0.5 text-xs text-purple-700">외부 결과</span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">최대 편차(mm)</dt><dd className="font-medium">{fmtMm(stats.value_max_mm)}</dd>
        <dt className="text-slate-500">최소(mm)</dt><dd>{fmtMm(stats.value_min_mm)}</dd>
        <dt className="text-slate-500">평균(mm)</dt><dd>{fmtMm(stats.value_mean_mm)}</dd>
        <dt className="text-slate-500">95퍼센타일(mm)</dt><dd>{fmtMm(stats.value_p95_mm)}</dd>
        <dt className="text-slate-500">판정 셀(유효/전체)</dt><dd>{stats.n_valid} / {stats.n_cells}</dd>
        <dt className="text-slate-500">{coverageLabel(stats)}</dt><dd>{stats.coverage_pct}%</dd>
      </dl>
      {stats.reduced_span_cells > 0 && (
        <p className="text-xs text-slate-600">축소 스팬 적용 셀 {stats.reduced_span_cells}개 (허용치 선형 환산)</p>
      )}

      <div>
        <h3 className="text-sm font-semibold">등급 분포</h3>
        <div className="mt-1 flex h-3 overflow-hidden rounded">
          {BAR_ORDER.map((g) => (
            <div key={g} style={{
              backgroundColor: GRADE_COLOR[g],
              width: `${stats.n_cells ? (stats.grade_counts[g] / stats.n_cells) * 100 : 0}%`,
            }} />
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-600">
          {BAR_ORDER.map((g) => `${GRADE_LABEL[g]} ${stats.grade_counts[g]}`).join(' · ')}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold">적용 기준</h3>
        <p className="text-sm">{stats.applied_criteria.name}</p>
        <p className="text-xs text-slate-500">{stats.applied_criteria.source}</p>
        <p className="text-xs text-slate-600">
          {stats.applied_criteria.span_m !== null
            ? `${stats.applied_criteria.span_m}m당 허용 ${stats.applied_criteria.pass_mm}mm / 재시공 ${stats.applied_criteria.rework_mm}mm`
            : `수직도 허용 ${stats.applied_criteria.pass_mm}mm / 재시공 ${stats.applied_criteria.rework_mm}mm`}
          {' · '}불확도 U={stats.applied_criteria.u_mm}mm
        </p>
      </div>

      {stats.warnings.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">경고</h3>
          <ul className="mt-1 space-y-1">
            {stats.warnings.map((w) => (
              <li key={w} className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">
                {warningLabel(w)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">종합의견</h3>
        <p className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700">
          {analysis.auto_summary ?? stats.auto_summary}
        </p>
        <label htmlFor="user-summary" className="mt-2 block text-xs font-medium">종합의견(사용자 수정)</label>
        <textarea id="user-summary" rows={4} value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          placeholder="자동 의견에 덧붙일 해석·조치 계획을 적습니다. 보고서(P4)에 함께 실립니다." />
        <div className="mt-1 flex items-center gap-2">
          <button onClick={saveSummary} className="rounded bg-slate-800 px-3 py-1 text-sm text-white">저장</button>
          {saved && <span className="text-xs text-slate-500">{saved}</span>}
        </div>
      </div>
    </aside>
  );
}

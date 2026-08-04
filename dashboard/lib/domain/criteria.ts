// 판정 기준 표시/그룹핑 유틸 (스펙 §7.7, task-7-brief §Produces)
import type { CriteriaRow, SlopeThreshold, Threshold } from './types';

// 구배 threshold({use, design_pct, pass_pct, re_pct, dir_pass_deg})에는 span_m 키가 아예
// 없어 `t.span_m === null`이 `undefined !== null`로 평가돼 평활도 분기로 새 나간다.
// 구배 분기를 맨 앞에 둬서 이 오분류를 막는다(기존 두 분기 조건은 그대로 둔다).
export function thresholdSummary(t: Threshold | SlopeThreshold): string {
  if ('design_pct' in t) {
    return `설계 ${t.design_pct}% · 적합 ±${t.pass_pct}%p · 재시공 ${t.re_pct}%p 초과`;
  }
  if (t.metric === 'plumbness' || t.span_m === null) {
    return `수직도 허용 ${t.pass_mm}mm / 재시공 ${t.rework_mm}mm`;
  }
  return `${t.span_m}m당 허용 ${t.pass_mm}mm / 재시공 ${t.rework_mm}mm`;
}

export function groupCriteria(rows: CriteriaRow[]): {
  global: CriteriaRow[];
  bySite: Map<string, CriteriaRow[]>;
} {
  const global: CriteriaRow[] = [];
  const bySite = new Map<string, CriteriaRow[]>();
  for (const r of rows) {
    if (r.site_id === null) { global.push(r); continue; }
    const arr = bySite.get(r.site_id) ?? [];
    arr.push(r);
    bySite.set(r.site_id, arr);
  }
  return { global, bySite };
}

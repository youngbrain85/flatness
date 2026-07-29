// 판정 기준 표시/그룹핑 유틸 (스펙 §7.7, task-7-brief §Produces)
import type { CriteriaRow, Threshold } from './types';

export function thresholdSummary(t: Threshold): string {
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

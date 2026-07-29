// cells.json -> 구역별 결과표 집계 (스펙 §5.1.7·§7.5 결과표)
// stats.json의 수치는 전체 합산뿐이므로 구역(벽)별 max/min/mean은 셀에서 재집계한다.
// '기준 초과'는 보수 이상(repair+rework)으로 정의한다(경계는 재확인 대상이지 초과 확정이 아님).
import type { CellRow, Grade } from './types';

export interface ZoneStats {
  zone_id: number | null;
  n_cells: number; n_valid: number;
  max_mm: number | null; min_mm: number | null; mean_mm: number | null;
  over_cells: number; over_pct: number;
  grade_counts: Record<Grade, number>;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round1 = (v: number) => Math.round(v * 10) / 10;

export function computeZoneStats(cells: CellRow[]): ZoneStats[] {
  const byZone = new Map<number | null, CellRow[]>();
  for (const c of cells) {
    const arr = byZone.get(c.zone_id) ?? [];
    arr.push(c);
    byZone.set(c.zone_id, arr);
  }
  const result: ZoneStats[] = [];
  for (const [zoneId, zc] of byZone) {
    const vals = zc.map((c) => c.value_mm).filter((v): v is number => v !== null);
    const gc: Record<Grade, number> = { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 };
    for (const c of zc) gc[c.grade] += 1;
    const over = gc.repair + gc.rework;
    result.push({
      zone_id: zoneId,
      n_cells: zc.length,
      n_valid: vals.length,
      max_mm: vals.length ? round2(Math.max(...vals)) : null,
      min_mm: vals.length ? round2(Math.min(...vals)) : null,
      mean_mm: vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
      over_cells: over,
      over_pct: zc.length ? round1((over / zc.length) * 100) : 0,
      grade_counts: gc,
    });
  }
  // zone_id 오름차순, null(임포트)은 맨 뒤
  return result.sort((a, b) => (a.zone_id ?? Number.MAX_SAFE_INTEGER) - (b.zone_id ?? Number.MAX_SAFE_INTEGER));
}

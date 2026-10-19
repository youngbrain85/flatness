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

// 판정 셀 0.5/1/2m(스펙 2·3 §1). 공식 판정은 meta.cell_m(cells.json)이고 cells_alt.json 은 같은 잔차를
// 1·2m 로 다시 나눈 비교용 셀이다. 화면은 히트맵에만 쓴다(등급은 엔진이 적은 값 그대로).
export type CellsBySize = Record<string, CellRow[]>;

/** cells_alt.json {"by_size": {"1.0": CellRow[], ...}} 을 읽는다. 모양이 다르면 null(화면은 전환을 숨긴다). */
export function parseCellsAlt(json: unknown): CellsBySize | null {
  if (!json || typeof json !== 'object') return null;
  const bySize = (json as { by_size?: unknown }).by_size;
  if (!bySize || typeof bySize !== 'object' || Array.isArray(bySize)) return null;
  const out: CellsBySize = {};
  for (const [key, rows] of Object.entries(bySize)) {
    const m = Number(key);
    if (!Number.isFinite(m) || m <= 0 || !Array.isArray(rows)) return null;
    out[key] = rows as CellRow[];
  }
  return out;
}

export interface CellSizeOption {
  id: string;        // 크기 숫자 문자열("0.5", "1", "2")
  label: string;     // 버튼 이름("0.5 m", 아트보드 ScanDone)
  cellM: number;
  official: boolean; // 공식 판정 크기(meta.cell_m)
  key: string | null; // cells_alt 의 키(공식이면 null)
}

/** 판정 셀 선택지: 공식 크기 + 비교 크기, 작은 순. 비교 크기가 공식과 같으면 공식 하나만 둔다. */
export function cellSizeOptions(officialM: number, alt: CellsBySize): CellSizeOption[] {
  const opt = (cellM: number, key: string | null): CellSizeOption =>
    ({ id: String(cellM), label: `${cellM} m`, cellM, official: key === null, key });
  const opts = [opt(officialM, null)];
  for (const key of Object.keys(alt)) {
    const m = Number(key);
    if (m !== officialM) opts.push(opt(m, key));
  }
  return opts.sort((a, b) => a.cellM - b.cellM);
}

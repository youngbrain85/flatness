import { describe, expect, it } from 'vitest';
import { cellSizeOptions, computeZoneStats, parseCellsAlt } from '../cells';
import type { CellRow } from '../types';

function cell(over: Partial<CellRow>): CellRow {
  return {
    ix: 0, iy: 0, center_x: 0, center_y: 0, value_mm: null, span_used_m: 0,
    occupancy: 1, grade: 'na', worst_x: null, worst_y: null, zone_id: null, ...over,
  };
}

describe('computeZoneStats (구역별 결과표 집계 - 스펙 §5.1.7 구역별 max/min/mean·초과 셀)', () => {
  it('zone_id별로 max/min/mean/보수 이상 셀을 집계한다', () => {
    const cells = [
      cell({ zone_id: 1, value_mm: 4.0, grade: 'pass' }),
      cell({ zone_id: 1, value_mm: 10.0, grade: 'repair' }),
      cell({ zone_id: 1, value_mm: 25.0, grade: 'rework' }),
      cell({ zone_id: 1, value_mm: null, grade: 'na' }),
      cell({ zone_id: 2, value_mm: 1.0, grade: 'pass' }),
    ];
    const zs = computeZoneStats(cells);
    expect(zs).toHaveLength(2);
    const z1 = zs[0];
    expect(z1.zone_id).toBe(1);
    expect(z1.n_cells).toBe(4);
    expect(z1.n_valid).toBe(3);
    expect(z1.max_mm).toBe(25);
    expect(z1.min_mm).toBe(4);
    expect(z1.mean_mm).toBe(13);
    expect(z1.over_cells).toBe(2); // 보수 이상(repair+rework)
    expect(z1.over_pct).toBe(50);
    expect(z1.grade_counts.na).toBe(1);
  });
  it('zone_id null(임포트)은 단일 그룹으로 맨 뒤에 온다', () => {
    const zs = computeZoneStats([
      cell({ zone_id: null, value_mm: 2, grade: 'pass' }),
      cell({ zone_id: 1, value_mm: 3, grade: 'pass' }),
    ]);
    expect(zs.map((z) => z.zone_id)).toEqual([1, null]);
  });
  it('빈 배열은 빈 결과', () => {
    expect(computeZoneStats([])).toEqual([]);
  });
});

// 판정 셀 0.5/1/2m(스펙 2·3 §1): cells_alt.json 은 비교용 1·2m 셀이다. 모양이 다르면 null 이라 화면은 전환을 숨긴다
describe('parseCellsAlt', () => {
  it('by_size 의 크기별 셀 배열을 그대로 돌려준다', () => {
    const one = [cell({ ix: 0, grade: 'pass', value_mm: 3 })];
    expect(parseCellsAlt({ by_size: { '1.0': one, '2.0': [] } })).toEqual({ '1.0': one, '2.0': [] });
  });
  it('by_size 가 없거나 배열이 아닌 값이 있으면 null', () => {
    expect(parseCellsAlt(null)).toBeNull();
    expect(parseCellsAlt({})).toBeNull();
    expect(parseCellsAlt({ by_size: [] })).toBeNull();
    expect(parseCellsAlt({ by_size: { '1.0': 'x' } })).toBeNull();
    expect(parseCellsAlt({ by_size: { abc: [] } })).toBeNull();
  });
});

describe('cellSizeOptions', () => {
  it('공식 크기 + 비교 크기를 작은 순으로, 이름은 "0.5 m" 꼴로', () => {
    const opts = cellSizeOptions(0.5, { '2.0': [], '1.0': [] });
    expect(opts.map((o) => [o.id, o.label, o.cellM, o.official])).toEqual([
      ['0.5', '0.5 m', 0.5, true], ['1', '1 m', 1, false], ['2', '2 m', 2, false],
    ]);
  });
  it('비교 크기가 공식 크기와 같으면 한 번만 둔다(공식 쪽)', () => {
    expect(cellSizeOptions(1, { '1.0': [], '2.0': [] }).map((o) => [o.id, o.official]))
      .toEqual([['1', true], ['2', false]]);
  });
});

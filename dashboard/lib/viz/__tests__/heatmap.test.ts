import { describe, expect, it } from 'vitest';
import { cellAt, cellPxFor, cellRect, gridGeometry } from '../heatmap';
import type { CellRow } from '@/lib/domain/types';

const cell = (ix: number, iy: number, over: Partial<CellRow> = {}): CellRow => ({
  ix, iy, center_x: ix + 0.5, center_y: iy + 0.5, value_mm: 1, span_used_m: 3,
  occupancy: 1, grade: 'pass', worst_x: null, worst_y: null, zone_id: 1, ...over,
});

describe('gridGeometry', () => {
  it('셀 인덱스 범위에서 격자 크기를 구한다(음수 인덱스 허용)', () => {
    const g = gridGeometry([cell(-1, 2), cell(3, 5)]);
    expect(g).toEqual({ minIx: -1, minIy: 2, cols: 5, rows: 4 });
  });
  it('빈 배열은 null', () => {
    expect(gridGeometry([])).toBeNull();
  });
});

describe('cellRect (iy는 위로 증가 -> 캔버스 y축 반전)', () => {
  it('최소 iy 셀이 캔버스 맨 아래 행에 온다', () => {
    const g = gridGeometry([cell(0, 0), cell(1, 2)])!; // rows=3
    expect(cellRect(g, cell(0, 0), 10)).toEqual({ x: 0, y: 20, w: 10, h: 10 });
    expect(cellRect(g, cell(1, 2), 10)).toEqual({ x: 10, y: 0, w: 10, h: 10 });
  });
});

describe('cellAt (클릭 좌표 -> 셀 역매핑, cellRect와 왕복 일치)', () => {
  it('셀 중앙 픽셀을 클릭하면 그 셀을 돌려준다', () => {
    const cells = [cell(0, 0), cell(1, 2)];
    const g = gridGeometry(cells)!;
    const r = cellRect(g, cells[1], 10);
    expect(cellAt(g, cells, 10, r.x + 5, r.y + 5)).toBe(cells[1]);
  });
  it('셀이 없는 자리(구멍)는 null', () => {
    const cells = [cell(0, 0), cell(1, 2)];
    const g = gridGeometry(cells)!;
    expect(cellAt(g, cells, 10, 15, 15)).toBeNull(); // (1,1) 자리는 비어 있음
  });
});

describe('cellPxFor', () => {
  it('격자가 최대 크기 안에 들어가는 정수 픽셀, 최소 4px', () => {
    const g = { minIx: 0, minIy: 0, cols: 10, rows: 5 };
    expect(cellPxFor(g, 600, 400)).toBe(60);
    expect(cellPxFor(g, 20, 400)).toBe(4); // 너무 작아도 최소 4
  });
});

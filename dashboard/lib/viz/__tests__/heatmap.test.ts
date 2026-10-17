import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CELL_TEXT_MIN_PX, MIN_CELL_PX, STAGE_MARGIN, canvasMonoFamily, cellAtPoint, cellSquare, drawStageHeatmap,
  gridGeometry, heatmapAriaLabel, heatmapHud, heatmapLayout, maxValueCell,
} from '../heatmap';
import type { HeatmapLayout, StageHeatmapInput } from '../heatmap';
import { GRADE_COLOR } from '@/lib/domain/labels';
import { CELL_GAP_COLOR, CELL_INK, SCREEN_GRADE_COLOR, STAGE_BG, STAGE_INK } from '@/lib/domain/palette';
import type { CellRow } from '@/lib/domain/types';
import { recording2d } from './ctx2d-stub';

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

// 아트보드 ScanDone paint 의 배치: 넓으면 범례를 칸 묶음 오른쪽에, 좁으면(휴대폰) 위에 둔다
describe('heatmapLayout', () => {
  const g86 = { minIx: 0, minIy: 0, cols: 8, rows: 6 };

  it('넓은 스테이지(1278x638): 범례 오른쪽, 칸 92px, 가운데 정렬', () => {
    expect(heatmapLayout(g86, 1278, 638)).toEqual({ c: 92, x0: 271, y0: 25, gw: 736, gh: 552, side: true });
  });

  it('휴대폰 스테이지(356x438): 범례 위, 칸 36px, 왼쪽 여백 44px', () => {
    expect(heatmapLayout(g86, 356, 438)).toEqual({ c: 36, x0: 44, y0: 156, gw: 288, gh: 216, side: false });
  });

  it('칸 묶음은 오른쪽 범례 자리를 넘지 않는다', () => {
    const l = heatmapLayout(g86, 1278, 638)!;
    expect(l.x0 + l.gw).toBeLessThanOrEqual(1278 - STAGE_MARGIN.right - STAGE_MARGIN.legendW);
  });

  it('칸이 8px 보다 작아지거나 크기가 0 이면 null(바탕만 그린다)', () => {
    expect(MIN_CELL_PX).toBe(8);
    expect(heatmapLayout({ minIx: 0, minIy: 0, cols: 200, rows: 100 }, 800, 400)).toBeNull();
    expect(heatmapLayout(g86, 0, 0)).toBeNull();
  });
});

describe('cellSquare / cellAtPoint (iy 는 위로 증가 -> 행 뒤집기, 왕복 일치)', () => {
  const cells = [cell(0, 0), cell(1, 2)];
  const g = gridGeometry(cells)!; // cols 2, rows 3
  const layout: HeatmapLayout = { c: 40, x0: 100, y0: 50, gw: 80, gh: 120, side: true };

  it('최소 iy 셀이 맨 아래 행에 온다', () => {
    expect(cellSquare(layout, g, cells[0])).toEqual({ x: 100, y: 130 });
    expect(cellSquare(layout, g, cells[1])).toEqual({ x: 140, y: 50 });
  });

  it('칸 안을 누르면 그 셀, 빈 자리와 칸 묶음 밖은 null', () => {
    expect(cellAtPoint(layout, g, cells, 160, 70)).toBe(cells[1]);
    expect(cellAtPoint(layout, g, cells, 120, 150)).toBe(cells[0]);
    expect(cellAtPoint(layout, g, cells, 160, 110)).toBeNull(); // (1,1) 은 비어 있다
    expect(cellAtPoint(layout, g, cells, 99, 70)).toBeNull();   // 묶음 왼쪽 밖
    expect(cellAtPoint(layout, g, cells, 120, 171)).toBeNull(); // 묶음 아래 밖
  });
});

describe('maxValueCell (엔진 build_stats 의 worst 와 같은 규칙)', () => {
  it('값이 가장 큰 칸. 값 없는 칸은 건너뛰고 같은 값이면 앞의 칸', () => {
    const a = cell(0, 0, { value_mm: 3 });
    const b = cell(1, 0, { value_mm: 9 });
    const c = cell(2, 0, { value_mm: 9 });
    const d = cell(3, 0, { value_mm: null, grade: 'na' });
    expect(maxValueCell([a, b, c, d])).toBe(b);
    expect(maxValueCell([d])).toBeNull();
    expect(maxValueCell([])).toBeNull();
  });
});

describe('heatmapHud / heatmapAriaLabel', () => {
  const cells = [
    cell(0, 0, { value_mm: 3.2 }),
    cell(1, 0, { value_mm: 14.86, grade: 'repair' }),
    cell(2, 0, { value_mm: null, grade: 'na' }),
  ];

  it('HUD: 셀 크기 · 칸 수(유효) · 최댓값. 셀 크기를 모르면 "판정 셀"', () => {
    expect(heatmapHud(cells, 1)).toBe('1m 셀 · 3칸(유효 2) · 최댓값 14.86 mm');
    expect(heatmapHud(cells, 0.5)).toBe('0.5m 셀 · 3칸(유효 2) · 최댓값 14.86 mm');
    expect(heatmapHud(cells, null)).toBe('판정 셀 · 3칸(유효 2) · 최댓값 14.86 mm');
    expect(heatmapHud([cell(0, 0, { value_mm: null, grade: 'na' })], 1)).toBe('1m 셀 · 1칸(유효 0) · 최댓값 -');
  });

  it('캔버스 이름: 열·행·칸 수, 칸이 있는 등급만 센 개수, 최댓값', () => {
    expect(heatmapAriaLabel(cells, gridGeometry(cells)!, 1))
      .toBe('판정 히트맵 평면도. 1m 셀 3열 1행 3칸, 적합 1칸, 보수 1칸, 판정 불가 1칸, 최댓값 14.86 mm');
  });
});

describe('canvasMonoFamily (캔버스 글꼴)', () => {
  it('next/font 변수(--font-plex-mono)를 못 읽으면 시스템 고정폭으로 떨어진다(jsdom 에는 변수가 없다)', () => {
    expect(canvasMonoFamily()).toBe('ui-monospace, monospace');
  });
});

describe('drawStageHeatmap (화면 등급 색, 2px 검정 틈, 최댓값 테두리, 축 숫자)', () => {
  const cells = [
    cell(0, 0, { value_mm: 3.2, grade: 'pass' }),
    cell(1, 0, { value_mm: 14.86, grade: 'repair' }),
    cell(0, 1, { value_mm: null, grade: 'na' }),
  ];
  const g = gridGeometry(cells)!; // cols 2, rows 2
  const layout: HeatmapLayout = { c: 40, x0: 100, y0: 50, gw: 80, gh: 80, side: true };

  function paint(over: Partial<StageHeatmapInput> = {}) {
    const { ctx, ops } = recording2d();
    drawStageHeatmap(ctx, { w: 400, h: 200, cells, geom: g, layout, cellM: 1, fontFamily: 'mono', ...over });
    return ops;
  }
  const fills = (ops: ReturnType<typeof paint>) => ops.filter((o) => o.op === 'fillRect');

  it('바탕은 STAGE_BG, 칸 묶음 자리는 CELL_GAP_COLOR 로 다시 덮는다', () => {
    const f = fills(paint());
    expect(f[0]).toMatchObject({ style: STAGE_BG, args: [0, 0, 400, 200] });
    expect(f[1]).toMatchObject({ style: CELL_GAP_COLOR, args: [99, 49, 82, 82] });
  });

  it('칸은 SCREEN_GRADE_COLOR 로 사방 1px 줄여 칠한다(이웃 칸 사이 2px 틈)', () => {
    expect(fills(paint()).slice(2)).toEqual([
      expect.objectContaining({ style: SCREEN_GRADE_COLOR.pass, args: [101, 91, 38, 38] }),
      expect.objectContaining({ style: SCREEN_GRADE_COLOR.repair, args: [141, 91, 38, 38] }),
      expect.objectContaining({ style: SCREEN_GRADE_COLOR.na, args: [101, 51, 38, 38] }),
    ]);
  });

  it('엔진 hex(PDF 색)는 한 번도 쓰지 않는다', () => {
    const styles = new Set(paint().map((o) => o.style.toLowerCase()));
    for (const hex of Object.values(GRADE_COLOR)) expect(styles.has(hex.toLowerCase())).toBe(false);
  });

  it('최댓값 칸에 STAGE_INK 2px 테두리를 칸 안쪽 2px 에 그린다', () => {
    expect(paint().filter((o) => o.op === 'strokeRect'))
      .toEqual([expect.objectContaining({ style: STAGE_INK, lineWidth: 2, args: [142, 92, 36, 36] })]);
  });

  it('칸이 30px 이상이면 값 있는 칸 가운데에 mm 값을 CELL_INK 로 쓰고 값 없는 칸에는 쓰지 않는다', () => {
    const texts = paint().filter((o) => o.op === 'fillText' && o.font.startsWith('500 '));
    expect(texts.map((o) => o.args)).toEqual([['3.20', 120, 110], ['14.86', 160, 110]]);
    expect(texts[0]).toMatchObject({ style: CELL_INK, font: '500 9px mono' });
  });

  it('칸이 30px 보다 작으면 칸 숫자를 생략한다', () => {
    expect(CELL_TEXT_MIN_PX).toBe(30);
    const small: HeatmapLayout = { c: 29, x0: 100, y0: 50, gw: 58, gh: 58, side: true };
    expect(paint({ layout: small }).filter((o) => o.op === 'fillText' && o.font.startsWith('500 '))).toEqual([]);
  });

  it('축 숫자: 셀 크기를 알면 1m 간격 x·y 숫자, 마지막 x 에만 m. 모르면 쓰지 않는다', () => {
    const axis = (ops: ReturnType<typeof paint>) => ops.filter((o) => o.op === 'fillText' && o.font === '11px mono');
    expect(axis(paint()).map((o) => o.args[0])).toEqual(['0', '1', '2 m', '0', '1', '2']);
    expect(axis(paint({ cellM: null }))).toEqual([]);
  });

  it('layout 이 null 이면 바탕만 칠한다', () => {
    expect(paint({ layout: null })).toEqual([expect.objectContaining({ op: 'fillRect', style: STAGE_BG })]);
  });
});

// 판정 이중화 금지 리트머스(points3d-litmus 와 같은 방식). 히트맵은 엔진 grade 를 칠할 뿐이다
describe('히트맵 리트머스', () => {
  it('히트맵 그리기·화면 코드에 판정 기준 필드 이름이 없다', () => {
    const root = join(__dirname, '../../..'); // dashboard/
    for (const rel of ['lib/viz/heatmap.ts', 'components/analysis/heatmap-view.tsx']) {
      const src = readFileSync(join(root, rel), 'utf8');
      for (const field of ['pass_mm', 'rework_mm', 'u_mm', 'applied_criteria']) {
        expect(src.includes(field), `${rel}: ${field}`).toBe(false);
      }
    }
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CELL_TEXT_MIN_PX, MIN_CELL_PX, STAGE_MARGIN, canvasMonoFamily, cellAtPoint, cellSquare, drawStageHeatmap,
  gridGeometry, heatmapAriaLabel, heatmapHud, heatmapLayout, maxValueCell,
} from '../heatmap';
import type { HeatmapLayout, StageHeatmapInput } from '../heatmap';
import { GRADE_COLOR } from '@/lib/domain/labels';
import {
  CELL_GAP_COLOR, CELL_INK, SCREEN_GRADE_COLOR, STAGE_AXIS_TEXT, STAGE_BG, STAGE_GRID, STAGE_INK,
} from '@/lib/domain/palette';
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

  // ---- 변이 실험이 드러낸 빈틈(아래 테스트는 값을 손으로 구했다) ----
  it('폭이 칸 크기를 정하는 스테이지(800x400, 2x1): 오른쪽 여백 22px 와 범례 자리 112px 가 모두 폭에서 빠진다', () => {
    // c = floor(min((800-44-22-112)/2, (400-24-60)/1)) = floor(min(311, 316)) = 311 (범례 아래 배치는 (400-150-60)=190 이라 진다)
    // x0 = max(44, min((800-622)/2, 800-22-112-622)) = max(44, min(89, 44)) = 44, y0 = round(24 + (400-60-24-311)/2) = round(26.5) = 27
    expect(heatmapLayout({ minIx: 0, minIy: 0, cols: 2, rows: 1 }, 800, 400))
      .toEqual({ c: 311, x0: 44, y0: 27, gw: 622, gh: 311, side: true });
  });

  it('칸 한 변이 정확히 8px 이면 그리고 7px 이면 그리지 않는다', () => {
    const one = { minIx: 0, minIy: 0, cols: 1, rows: 1 };
    // 높이가 칸 크기를 정한다: c = floor(h - 24 - 60). h=92 -> 8, h=91 -> 7
    expect(heatmapLayout(one, 500, 92)).toEqual({ c: 8, x0: 246, y0: 24, gw: 8, gh: 8, side: true });
    expect(heatmapLayout(one, 500, 91)).toBeNull();
  });

  it('크기가 숫자가 아니면(NaN) 폭이든 높이든 null 이다', () => {
    expect(heatmapLayout(g86, NaN, 400)).toBeNull();
    expect(heatmapLayout(g86, 400, NaN)).toBeNull();
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

  // ---- 변이 실험이 드러낸 빈틈 ----
  it('칸 가장자리: 왼쪽·위 가장자리 픽셀은 그 칸이고 다음 칸은 x0+c·y0+c 부터다', () => {
    // 칸 (0,0) 은 x 100~140, y 130~170. 칸 (1,2) 는 x 140~180, y 50~90
    expect(cellAtPoint(layout, g, cells, 100, 130)).toBe(cells[0]);       // 왼쪽 위 모서리 픽셀
    expect(cellAtPoint(layout, g, cells, 139.5, 169.5)).toBe(cells[0]);   // 오른쪽 아래 끝(아직 칸 안)
    expect(cellAtPoint(layout, g, cells, 140, 130)).toBeNull();           // 오른쪽 이웃 (1,0) 은 비어 있다
    expect(cellAtPoint(layout, g, cells, 100, 170)).toBeNull();           // 묶음 아래 밖
    expect(cellAtPoint(layout, g, cells, 179.5, 50)).toBe(cells[1]);      // 칸 (1,2) 의 오른쪽 위 끝
    expect(cellAtPoint(layout, g, cells, 180, 50)).toBeNull();            // 묶음 오른쪽 밖
  });

  it('최소 인덱스가 0 이 아니어도(음수 포함) 칸 묶음 왼쪽 위가 기준이다', () => {
    const cs = [cell(-1, 2), cell(3, 5)];
    const gg = gridGeometry(cs)!; // minIx -1, minIy 2, cols 5, rows 4
    const lay: HeatmapLayout = { c: 10, x0: 20, y0: 30, gw: 50, gh: 40, side: true };
    expect(cellSquare(lay, gg, cs[0])).toEqual({ x: 20, y: 60 });
    expect(cellSquare(lay, gg, cs[1])).toEqual({ x: 60, y: 30 });
    expect(cellAtPoint(lay, gg, cs, 25, 65)).toBe(cs[0]);
    expect(cellAtPoint(lay, gg, cs, 65, 35)).toBe(cs[1]);
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

  it('값이 0 인 칸도 최댓값 칸이다(완전히 평평한 바닥). 모두 0 이면 앞의 칸', () => {
    const z0 = cell(0, 0, { value_mm: 0 });
    const z1 = cell(1, 0, { value_mm: 0 });
    expect(maxValueCell([z0])).toBe(z0);
    expect(maxValueCell([z0, z1])).toBe(z0);
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

  // ---- 변이 실험이 드러낸 빈틈 ----
  it('HUD 최댓값은 소수 둘째 자리까지 쓴다(3.2 -> 3.20)', () => {
    expect(heatmapHud([cell(0, 0, { value_mm: 3.2 })], 1)).toBe('1m 셀 · 1칸(유효 1) · 최댓값 3.20 mm');
  });

  it('캔버스 이름: 다섯 등급을 적합 -> 판정 불가 순으로 세고, 빈 칸이 있는 격자는 열 x 행이 아니라 실제 칸 수를 쓴다', () => {
    const five = [
      cell(0, 0, { value_mm: 1, grade: 'pass' }),
      cell(1, 0, { value_mm: 2, grade: 'borderline' }),
      cell(2, 0, { value_mm: 3, grade: 'repair' }),
      cell(0, 1, { value_mm: 4, grade: 'rework' }),
      cell(1, 1, { value_mm: null, grade: 'na' }),   // (2,1) 은 비어 있다: 3열 2행이지만 칸은 5개
    ];
    expect(heatmapAriaLabel(five, gridGeometry(five)!, 1)).toBe(
      '판정 히트맵 평면도. 1m 셀 3열 2행 5칸, 적합 1칸, 경계 1칸, 보수 1칸, 재시공 1칸, 판정 불가 1칸, 최댓값 4.00 mm',
    );
  });
});

describe('canvasMonoFamily (캔버스 글꼴)', () => {
  it('next/font 변수(--font-plex-mono)를 못 읽으면 시스템 고정폭으로 떨어진다(jsdom 에는 변수가 없다)', () => {
    expect(canvasMonoFamily()).toBe('ui-monospace, monospace');
  });

  it('변수를 읽으면 그 글꼴(앞뒤 공백 제거)을 앞세우고 시스템 고정폭을 뒤에 붙인다', () => {
    const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => (name === '--font-plex-mono' ? ' "IBM Plex Mono" ' : ''),
    } as unknown as CSSStyleDeclaration);
    try {
      expect(canvasMonoFamily()).toBe('"IBM Plex Mono", ui-monospace, monospace');
    } finally {
      spy.mockRestore();
    }
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

  // ---- 변이 실험이 드러낸 빈틈(아래 기대값은 아트보드 paint 규칙으로 손수 구했다) ----
  const axisOps = (ops: ReturnType<typeof paint>) => ops.filter((o) => o.op === 'fillText' && o.font === '11px mono');

  it('모르는 grade 문자열의 칸은 판정 불가 색으로 칠한다(칸이 검정 틈 색으로 사라지지 않게)', () => {
    const odd = [cell(0, 0, { value_mm: 1, grade: 'weird' as never })];
    const oddLayout: HeatmapLayout = { c: 40, x0: 100, y0: 50, gw: 40, gh: 40, side: true };
    const f = fills(paint({ cells: odd, geom: gridGeometry(odd)!, layout: oddLayout }));
    expect(f[2]).toMatchObject({ style: SCREEN_GRADE_COLOR.na, args: [101, 51, 38, 38] });
  });

  it('칸 숫자 글자 크기는 칸 한 변의 17% 를 반올림해 9~15px 로 제한한다(30px 칸부터 쓴다)', () => {
    const font = (c: number) => paint({ layout: { c, x0: 100, y0: 50, gw: c * 2, gh: c * 2, side: true } })
      .find((o) => o.op === 'fillText' && o.font.startsWith('500 '))!.font;
    expect(font(30)).toBe('500 9px mono');    // round(5.1) = 5 -> 최소 9
    expect(font(60)).toBe('500 10px mono');   // round(10.2) = 10
    expect(font(80)).toBe('500 14px mono');   // round(13.6) = 14
    expect(font(92)).toBe('500 15px mono');   // round(15.64) = 16 -> 최대 15
  });

  it('격자선: 칸 경계에 맞춘 1m 간격 가는 선(STAGE_GRID 1px)을 한 번에 긋고, 칸 묶음 검정 덮개보다 먼저 그린다', () => {
    const { ctx, ops } = recording2d();
    const moves: [number, number][] = [];
    ctx.moveTo = (x: number, y: number) => { moves.push([x, y]); };
    drawStageHeatmap(ctx, { w: 400, h: 200, cells, geom: g, layout, cellM: 1, fontFamily: 'mono' });
    // 세로선: x0=100 이 칸 경계라 100 - floor(100/40)*40 = 20 에서 40px 간격으로 400 까지(10개)
    // 가로선: y0=50 이라 50 - floor(50/40)*40 = 10 에서 40px 간격으로 200 까지(5개). 선은 반 픽셀 안쪽에 긋는다
    expect(moves).toEqual([
      ...[20.5, 60.5, 100.5, 140.5, 180.5, 220.5, 260.5, 300.5, 340.5, 380.5].map((x): [number, number] => [x, 0]),
      ...[10.5, 50.5, 90.5, 130.5, 170.5].map((y): [number, number] => [0, y]),
    ]);
    expect(ops.filter((o) => o.op === 'stroke'))
      .toEqual([expect.objectContaining({ style: STAGE_GRID, lineWidth: 1 })]);
    expect(ops.filter((o) => o.op === 'fillRect' || o.op === 'stroke').slice(0, 3).map((o) => o.op))
      .toEqual(['fillRect', 'stroke', 'fillRect']);   // 바탕 -> 격자선 -> 칸 묶음 덮개
  });

  it('축 숫자의 자리와 색: x 는 칸 묶음 아래 14px, 마지막 x 는 단위까지 선 가운데, y 는 칸 묶음 왼쪽 10px', () => {
    const axis = axisOps(paint());
    // 마지막 x: x0 + 2칸 - measureText('2').width/2 = 100 + 80 - 3 (스텁은 글자당 6px)
    expect(axis.map((o) => o.args)).toEqual([
      ['0', 100, 144], ['1', 140, 144], ['2 m', 177, 144],
      ['0', 90, 130], ['1', 90, 90], ['2', 90, 50],
    ]);
    for (const o of axis) expect(o.style).toBe(STAGE_AXIS_TEXT);
  });

  it('셀이 1m 가 아니면 축 숫자 간격이 따라간다: 0.5m 셀은 1m 마다, 2m 셀은 셀마다', () => {
    const labels = (cellM: number) => axisOps(paint({ cellM })).map((o) => o.args);
    // 0.5m 셀: 칸 두 개가 1m 라 간격이 80px. 마지막 x 는 100 + 80 - 3, y 의 둘째 숫자는 130 - 80
    expect(labels(0.5)).toEqual([['0', 100, 144], ['1 m', 177, 144], ['0', 90, 130], ['1', 90, 50]]);
    // 2m 셀: 칸 하나가 2m 라 간격이 40px(한 칸)
    expect(labels(2)).toEqual([
      ['0', 100, 144], ['2', 140, 144], ['4 m', 177, 144],
      ['0', 90, 130], ['2', 90, 90], ['4', 90, 50],
    ]);
  });

  it('0.5m 셀의 격자선은 두 칸(80px)마다 그어 1m 간격을 지킨다', () => {
    const { ctx } = recording2d();
    const moves: [number, number][] = [];
    ctx.moveTo = (x: number, y: number) => { moves.push([x, y]); };
    drawStageHeatmap(ctx, { w: 400, h: 200, cells, geom: g, layout, cellM: 0.5, fontFamily: 'mono' });
    // x0=100, 간격 80: 100 - floor(100/80)*80 = 20 에서 20·100·180·260·340. y0=50: 50 에서 50·130
    expect(moves).toEqual([
      ...[20.5, 100.5, 180.5, 260.5, 340.5].map((x): [number, number] => [x, 0]),
      ...[50.5, 130.5].map((y): [number, number] => [0, y]),
    ]);
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

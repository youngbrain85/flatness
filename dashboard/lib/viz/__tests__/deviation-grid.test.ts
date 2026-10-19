import { describe, expect, it } from 'vitest';
import { recording2d } from './ctx2d-stub';
import {
  colorRangeMm, deviationHud, drawDeviation, deviationLayout, deviationRgb, foldGrid, parseResidualGrid, rasterize, resolutionLabel,
} from '../deviation-grid';
import type { ResidualGrid } from '../deviation-grid';
import { DEVIATION_RAMP } from '@/lib/domain/palette';

// residual_grid.json(스펙 2·3 §2): 0.1mm 정수, 값 없음 null, 행 우선, 행 0 = y 최소
const grid = (cols: number, rows: number, values: (number | null)[]): ResidualGrid =>
  ({ subcell_m: 0.05, cols, rows, values });

describe('parseResidualGrid', () => {
  it('모양이 맞으면 그대로 돌려준다', () => {
    const g = { subcell_m: 0.05, cols: 2, rows: 1, values: [10, null] };
    expect(parseResidualGrid(g)).toEqual(g);
  });
  it('길이가 cols*rows 와 다르거나 값이 숫자·null 이 아니면 null', () => {
    expect(parseResidualGrid(null)).toBeNull();
    expect(parseResidualGrid({ subcell_m: 0.05, cols: 2, rows: 2, values: [1, 2, 3] })).toBeNull();
    expect(parseResidualGrid({ subcell_m: 0.05, cols: 1, rows: 1, values: ['1'] })).toBeNull();
    expect(parseResidualGrid({ subcell_m: 0, cols: 1, rows: 1, values: [1] })).toBeNull();
    expect(parseResidualGrid({ subcell_m: 0.05, cols: 0, rows: 1, values: [] })).toBeNull();
  });
});

describe('foldGrid (표시 해상도 5·10·20cm)', () => {
  it('factor 1 은 0.1mm 정수를 mm 로 바꾸고 값 없음은 NaN', () => {
    const f = foldGrid(grid(2, 1, [-25, null]), 1);
    expect([f.cols, f.rows, f.sizeM]).toEqual([2, 1, 0.05]);
    expect(f.mm[0]).toBeCloseTo(-2.5);
    expect(Number.isNaN(f.mm[1])).toBe(true);
    expect([f.n, f.lo, f.hi]).toEqual([1, -2.5, -2.5]);
  });
  it('factor 2 는 2x2 묶음 안 값 있는 칸만 평균하고, 가장자리 묶음은 남은 칸으로 만든다', () => {
    // 3열 x 2행: 행 0 = [10, 30, 50], 행 1 = [null, 20, null]
    const f = foldGrid(grid(3, 2, [10, 30, 50, null, 20, null]), 2);
    expect([f.cols, f.rows, f.sizeM]).toEqual([2, 1, 0.1]);
    expect(f.mm[0]).toBeCloseTo(2.0);    // (10 + 30 + 20) / 3 = 20 -> 2.0mm
    expect(f.mm[1]).toBeCloseTo(5.0);    // 50 하나
  });
  it('값이 하나도 없는 묶음은 NaN 이고 n 에 세지 않는다', () => {
    const f = foldGrid(grid(4, 1, [null, null, 8, 8]), 2);
    expect(Number.isNaN(f.mm[0])).toBe(true);
    expect(f.n).toBe(1);
  });
});

describe('colorRangeMm (색 범위 ±R)', () => {
  it('R 은 원 격자 |값|의 98번째 백분위(nearest-rank, mm)다', () => {
    // |값| 1..99 + 튀는 값 1000 (0.1mm): 정렬 100개의 98번째(index 97) = 98 -> 9.8mm.
    // 튀는 값 하나는 범위를 끌어올리지 못한다(최댓값 기준이면 100mm)
    const vals: (number | null)[] = Array.from({ length: 99 }, (_, i) => (i % 2 ? -(i + 1) : i + 1));
    vals.push(1000);
    expect(colorRangeMm(grid(100, 1, vals))).toBeCloseTo(9.8);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(colorRangeMm(grid(100, 1, hundred))).toBeCloseTo(9.8);
  });
  it('최소 1mm, 값이 없어도 1mm', () => {
    expect(colorRangeMm(grid(2, 1, [1, -2]))).toBe(1);
    expect(colorRangeMm(grid(1, 1, [null]))).toBe(1);
  });
});

describe('deviationRgb (침하 파랑 · 0 짙은 남색 · 융기 주황→빨강)', () => {
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  it('-R, 0, +R 은 램프 양 끝과 가운데 색이고 범위 밖은 끝 색에 멈춘다', () => {
    expect(deviationRgb(-4, 4)).toEqual(hex(DEVIATION_RAMP[0]));
    expect(deviationRgb(0, 4)).toEqual(hex(DEVIATION_RAMP[2]));
    expect(deviationRgb(4, 4)).toEqual(hex(DEVIATION_RAMP[4]));
    expect(deviationRgb(40, 4)).toEqual(hex(DEVIATION_RAMP[4]));
    expect(deviationRgb(-40, 4)).toEqual(hex(DEVIATION_RAMP[0]));
  });
  it('R/4 넘게 꺼지면 파랑이, 솟으면 빨강이 더 세고, 초록이 가장 센 색은 어디에도 없다', () => {
    // 0 근처는 남색(파랑 성분)이 섞여 있으므로 부호 우세는 |값| >= R/4 에서 본다
    for (let k = -20; k <= 20; k++) {
      const [r, g, b] = deviationRgb(k / 5, 4);
      if (k <= -5) expect(b).toBeGreaterThan(r);
      if (k >= 5) expect(r).toBeGreaterThan(b);
      expect(g > r && g > b).toBe(false);
    }
  });
});

describe('rasterize (한 칸 = 1px RGBA)', () => {
  it('행 0(y 최소)이 그림 맨 아래 줄이고, 값 없는 칸은 투명이다', () => {
    // 2열 x 2행: 행 0 = [+R, null], 행 1 = [-R, 0]
    const f = foldGrid(grid(2, 2, [40, null, -40, 0]), 1);
    const px = rasterize(f, 4);
    expect(px.length).toBe(2 * 2 * 4);
    const at = (x: number, y: number) => Array.from(px.slice((y * 2 + x) * 4, (y * 2 + x) * 4 + 4));
    expect(at(0, 1)).toEqual([...deviationRgb(4, 4), 255]);    // 행 0 의 첫 칸 -> 그림 아래 줄
    expect(at(1, 1)[3]).toBe(0);                              // 값 없음 -> 투명
    expect(at(0, 0)).toEqual([...deviationRgb(-4, 4), 255]);   // 행 1 -> 그림 위 줄
  });
});

describe('deviationLayout · deviationHud · resolutionLabel', () => {
  it('정사각 칸으로 스테이지에 맞추고 너무 좁으면 null', () => {
    const f = foldGrid(grid(20, 10, Array(200).fill(1)), 1);
    const L = deviationLayout(f, 1000, 500)!;
    expect(L.gw / f.cols).toBeCloseTo(L.gh / f.rows, 0);
    expect(L.x0 + L.gw).toBeLessThanOrEqual(1000);
    expect(L.y0 + L.gh).toBeLessThanOrEqual(500);
    expect(deviationLayout(f, 60, 40)).toBeNull();
  });
  it('HUD: 해상도 · 칸 수 · 부호 붙인 최소~최대(mm)', () => {
    const f = foldGrid(grid(3, 2, [-25, 0, 31, null, null, null]), 1);
    expect(deviationHud(f, '5cm')).toBe('5cm 격자 · 3 × 2칸 · −2.5 ~ +3.1 mm');
    expect(deviationHud(foldGrid(grid(1, 1, [null]), 1), '5cm')).toBe('표시할 편차 값이 없습니다');
  });
  it('해상도 이름은 서브셀 x 배수(cm)', () => {
    expect([1, 2, 4].map((k) => resolutionLabel(0.05, k))).toEqual(['5cm', '10cm', '20cm']);
  });
});

describe('drawDeviation', () => {
  it('검정 바탕을 깔고 칸 그림을 확대해 붙이며, 작은 판(45cm)은 10cm 간격 축 숫자를 쓴다', () => {
    const f = foldGrid(grid(9, 7, Array(63).fill(5)), 1);    // 0.45 x 0.35 m
    const { ctx, ops } = recording2d();
    drawDeviation(ctx, { w: 800, h: 440, f, raster: {} as CanvasImageSource, fontFamily: 'mono' });
    expect(ops[0]).toMatchObject({ op: 'fillRect', style: '#000000', args: [0, 0, 800, 440] });
    expect(ops.some((o) => o.op === 'drawImage')).toBe(true);
    const texts = ops.filter((o) => o.op === 'fillText').map((o) => o.args[0]);
    expect(texts).toEqual(expect.arrayContaining(['0', '0.1', '0.2', '0.3', '0.4 m']));
  });
  it('값이 없으면 바탕만 칠한다', () => {
    const { ctx, ops } = recording2d();
    drawDeviation(ctx, { w: 800, h: 440, f: foldGrid(grid(2, 2, [null, null, null, null]), 1), raster: null, fontFamily: 'm' });
    expect(ops).toHaveLength(1);
  });
});

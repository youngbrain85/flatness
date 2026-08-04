import { describe, expect, it } from 'vitest';
import {
  SLOPE_GRADE_COLOR, downhillArrowPx, drawSlopeHeatmap, slopeCellFillColor, slopeCellRectPx,
} from '../slope-heatmap';
import type { GradedSlopeCell } from '../slope-heatmap';
import type { SlopeTransform } from '../slope-cells';
import type { SlopeCellRow } from '../types';

// 실제 analyze-slope CLI(합성 2%/1% 대각 경사, 8.2m x 8.0m)로 만든 slope_cells.json의
// 셀 형태를 그대로 옮긴 픽스처. width_m/height_m이 있고 zone_id는 항상 null이다.
function cell(over: Partial<SlopeCellRow> = {}): SlopeCellRow {
  return {
    cx: 0, cy: 0, center_x: 0.975, center_y: 0.975, n_subcells: 1600,
    slope_pct: 2.2427803815883034, downhill_rad: -2.6779450469426633,
    rmse_m: 9.486337553753076e-05, se_pct: 0.0005810987851156088,
    width_m: 2.0, height_m: 2.0, ok: true, zone_id: null, ...over,
  };
}

describe('downhillArrowPx (Canvas y축 반전 - 브리프 D3 핵심 함정) ★', () => {
  it('downhill_rad=-pi/2(matplotlib 좌표계 남쪽, y 감소)는 Canvas에서 dy > 0(아래쪽)이어야 한다', () => {
    // 엔진의 downhill_rad는 matplotlib 좌표계(y 위로 증가) 기준이다.
    // Canvas는 y가 아래로 증가하므로 sin의 부호를 뒤집어야 한다.
    // 뒤집지 않으면 모든 화살표가 위아래로 뒤집히는데 색은 정상이라
    // 화면상 아무 경고가 없다 - 스펙이 경계한 "역구배는 색으로 안 드러난다"가
    // 렌더러 버그로 재현된다.
    const { dx, dy } = downhillArrowPx(-Math.PI / 2, 10);
    expect(dy).toBeGreaterThan(0);
    expect(dx).toBeCloseTo(0, 5);
  });

  it('downhill_rad=pi/2(matplotlib 좌표계 북쪽, y 증가)는 Canvas에서 dy < 0(위쪽)이어야 한다', () => {
    const { dx, dy } = downhillArrowPx(Math.PI / 2, 10);
    expect(dy).toBeLessThan(0);
    expect(dx).toBeCloseTo(0, 5);
  });

  it('downhill_rad=0(matplotlib 좌표계 동쪽, +x)은 Canvas에서도 dx > 0, dy = 0', () => {
    const { dx, dy } = downhillArrowPx(0, 10);
    expect(dx).toBeCloseTo(10, 5);
    expect(dy).toBeCloseTo(0, 5);
  });

  it('길이는 요청한 lengthPx와 일치한다(방향에 무관하게 크기 보존)', () => {
    const { dx, dy } = downhillArrowPx(-2.6779450469426633, 7);
    expect(Math.hypot(dx, dy)).toBeCloseTo(7, 5);
  });
});

describe('SLOPE_GRADE_COLOR (엔진 slope_map.py의 _COLOR와 일치해야 함)', () => {
  it('5등급 색이 엔진 값과 정확히 일치한다', () => {
    expect(SLOPE_GRADE_COLOR).toEqual({
      적합: '#3d8b3d', 경계: '#d6c11e', 보수: '#e07b1a', 재시공: '#c0392b', 판정불가: '#9e9e9e',
    });
  });
});

describe('slopeCellFillColor (ok=false는 등급 무관하게 판정불가 색)', () => {
  it('ok=true 셀은 넘겨준 grade의 색을 그대로 쓴다', () => {
    expect(slopeCellFillColor(cell({ ok: true }), '적합')).toBe('#3d8b3d');
    expect(slopeCellFillColor(cell({ ok: true }), '재시공')).toBe('#c0392b');
  });

  it('ok=false 셀은 grade로 무엇을 넘겨도 판정불가 회색을 강제한다', () => {
    // ok=false는 slope_pct·downhill_rad가 없는(측정 불가) 셀이다. 엔진
    // grade_slope_cells도 !ok 셀은 무조건 GRADE_NA를 매긴다(slope.py) - 이건
    // 임계값 비교가 아니라 유효성 플래그를 그대로 따르는 것이므로 판정 이중화가
    // 아니다. 호출부가 실수로(또는 판정 전 기본값으로) 다른 등급을 넘기더라도
        // 여기서 안전하게 덮어써야 "측정 안 된 셀이 초록으로 뜨는" 조용한 실패를 막는다.
    const invalid = cell({ ok: false, slope_pct: null, downhill_rad: null, rmse_m: null, se_pct: null });
    expect(slopeCellFillColor(invalid, '적합')).toBe('#9e9e9e');
  });
});

describe('slopeCellRectPx (셀 사각형 픽셀 좌표, y축 반전 포함)', () => {
  const t: SlopeTransform = { scale: 10, xMin: 0, yMax: 8 }; // 10px/m, 월드 y 최댓값 8m

  it('중심(1,1) 폭2 높이2 셀은 좌상단이 (0px, 60px), 크기 20x20px', () => {
    // 셀 상단(월드 y=2m)이 캔버스 y=(8-2)*10=60px, 좌측(월드 x=0m)이 캔버스 x=0px
    const r = slopeCellRectPx(t, cell({ center_x: 1, center_y: 1, width_m: 2, height_m: 2 }));
    expect(r).toEqual({ x: 0, y: 60, w: 20, h: 20 });
  });

  it('월드 y가 클수록(북쪽) Canvas y는 작다(위쪽)', () => {
    const low = slopeCellRectPx(t, cell({ center_x: 1, center_y: 1, width_m: 2, height_m: 2 }));
    const high = slopeCellRectPx(t, cell({ center_x: 1, center_y: 5, width_m: 2, height_m: 2 }));
    expect(high.y).toBeLessThan(low.y);
  });
});

// Canvas 2D 컨텍스트 최소 스텁 - jsdom은 실제 getContext('2d')를 지원하지 않으므로
// (lib/viz/heatmap.test.ts와 동일한 이유) fillRect/strokeRect/beginPath/moveTo/
// lineTo/stroke 호출을 기록하는 가짜 객체로 대체한다.
function fakeCtx() {
  const calls: { fn: string; args: number[] }[] = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    fillRect: (...a: number[]) => calls.push({ fn: 'fillRect', args: a }),
    strokeRect: (...a: number[]) => calls.push({ fn: 'strokeRect', args: a }),
    beginPath: () => calls.push({ fn: 'beginPath', args: [] }),
    moveTo: (...a: number[]) => calls.push({ fn: 'moveTo', args: a }),
    lineTo: (...a: number[]) => calls.push({ fn: 'lineTo', args: a }),
    stroke: () => calls.push({ fn: 'stroke', args: [] }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('drawSlopeHeatmap (배경색 + 화살표 오버레이)', () => {
  it('ok=true 셀은 등급 색으로 채우고 내리막 화살표를 그린다(방향은 y 반전 규칙을 따름)', () => {
    const t: SlopeTransform = { scale: 10, xMin: 0, yMax: 8 };
    const g: GradedSlopeCell = {
      cell: cell({ center_x: 1, center_y: 1, downhill_rad: -Math.PI / 2 }), // 남쪽(y 감소)
      grade: '적합',
    };
    const { ctx, calls } = fakeCtx();
    drawSlopeHeatmap(ctx, [g], t, 2.0);

    const fillCall = calls.find((c) => c.fn === 'fillRect');
    expect(fillCall).toBeDefined();
    // ctx.fillStyle이 등급 색으로 설정됐는지는 fillRect 호출 시점의 상태를 별도로
    // 기록하지 않으므로, 실제 색 로직 자체는 slopeCellFillColor 유닛 테스트가 고정한다.

    const lineTo = calls.find((c) => c.fn === 'lineTo')!;
    const moveTo = calls.find((c) => c.fn === 'moveTo')!;
    const dy = lineTo.args[1] - moveTo.args[1];
    // 남쪽(matplotlib y 감소) 내리막이므로 Canvas에서는 아래(dy>0)로 그려져야 한다.
    expect(dy).toBeGreaterThan(0);
  });

  it('ok=false 셀은 화살표를 그리지 않는다(측정값이 없어 방향을 알 수 없음)', () => {
    const t: SlopeTransform = { scale: 10, xMin: 0, yMax: 8 };
    const g: GradedSlopeCell = {
      cell: cell({ ok: false, slope_pct: null, downhill_rad: null, rmse_m: null, se_pct: null }),
      grade: '판정불가',
    };
    const { ctx, calls } = fakeCtx();
    drawSlopeHeatmap(ctx, [g], t, 2.0);
    expect(calls.find((c) => c.fn === 'lineTo')).toBeUndefined();
    expect(calls.find((c) => c.fn === 'fillRect')).toBeDefined(); // 배경은 여전히 그린다(회색)
  });

  it('reverse=true면 화살표 선 굵기를 굵게(2.2) 그린다 - 역구배는 색이 아니라 굵기로 드러남(§7.2)', () => {
    const t: SlopeTransform = { scale: 10, xMin: 0, yMax: 8 };
    const g: GradedSlopeCell = { cell: cell(), grade: '재시공', reverse: true };
    const { ctx } = fakeCtx();
    let sawBold = false;
    const origStroke = ctx.stroke;
    ctx.stroke = () => { if (ctx.lineWidth === 2.2) sawBold = true; origStroke(); };
    drawSlopeHeatmap(ctx, [g], t, 2.0);
    expect(sawBold).toBe(true);
  });
});

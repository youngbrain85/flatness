import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';
import { SlopeHeatmapView } from '../slope-heatmap-view';
import { GRADE_CLASS } from '@/components/ui/grade';
import { DRAIN_COLOR, STAGE_INK } from '@/lib/domain/palette';
import type { SlopeCellResult } from '@/lib/domain/slope-judged';
import type { SlopeCellRow } from '@/lib/domain/types';
import { recording2d } from '@/lib/viz/__tests__/ctx2d-stub';

function cell(over: Partial<SlopeCellRow> = {}): SlopeCellRow {
  return {
    cx: 0, cy: 0, center_x: 1, center_y: 1, n_subcells: 1600,
    slope_pct: 2.24, downhill_rad: -2.68, rmse_m: 0.0001, se_pct: 0.0006,
    width_m: 2.0, height_m: 2.0, ok: true, zone_id: null, ...over,
  };
}

function result(over: Partial<SlopeCellResult> = {}): SlopeCellResult {
  return {
    cell: cell(), grade: '적합', reason: '크기·방향 모두 허용 안',
    dev_pct: 0.24, dir_err_deg: 5, correction_mm: 4.8, reverse: false, ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SlopeHeatmapView 클릭 -> 월드 좌표 변환 (브리프 D4: 배수구 클릭)', () => {
  it('클릭 지점을 pxToWorld로 환산해 onDrainClick에 넘긴다', () => {
    const onDrainClick = vi.fn();
    const { container } = render(
      <SlopeHeatmapView results={[result()]} cellM={2.0} drainPoints={[]} clickable
        onDrainClick={onDrainClick} />,
    );
    const canvas = container.querySelector('canvas')!;
    // bounds: center(1,1) w=2,h=2 -> xMin=0,xMax=2,yMin=0,yMax=2. maxW=640,maxH=480 ->
    // scale=min(640/2,480/2)=240 -> canvas 480x480. CSS 축소 없음(rect == 실 픽셀).
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 480, bottom: 480, width: 480, height: 480, x: 0, y: 0, toJSON() {} }),
    });

    fireEvent.click(canvas, { clientX: 240, clientY: 240 }); // 캔버스 정중앙 -> 월드(1,1)

    expect(onDrainClick).toHaveBeenCalledTimes(1);
    const pt = onDrainClick.mock.calls[0][0];
    expect(pt.x).toBeCloseTo(1, 2);
    expect(pt.y).toBeCloseTo(1, 2);
  });

  it('clickable=false면 클릭을 무시한다(브리프 D5: 재판정 진행 중 클릭 비활성)', () => {
    const onDrainClick = vi.fn();
    const { container } = render(
      <SlopeHeatmapView results={[result()]} cellM={2.0} drainPoints={[]} clickable={false}
        onDrainClick={onDrainClick} />,
    );
    const canvas = container.querySelector('canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 480, bottom: 480, width: 480, height: 480, x: 0, y: 0, toJSON() {} }),
    });

    fireEvent.click(canvas, { clientX: 240, clientY: 240 });

    expect(onDrainClick).not.toHaveBeenCalled();
  });

  it('셀 데이터가 없으면 안내 문구를 보여주고 캔버스를 렌더하지 않는다', () => {
    const { container, getByText } = render(
      <SlopeHeatmapView results={[]} cellM={2.0} drainPoints={[]} clickable onDrainClick={vi.fn()} />,
    );
    expect(container.querySelector('canvas')).toBeNull();
    expect(getByText('표시할 셀 데이터가 없습니다.')).toBeInTheDocument();
  });

  it('범례에 5등급 색과 배수구·역구배 안내를 보여준다', () => {
    const { getByText } = render(
      <SlopeHeatmapView results={[result()]} cellM={2.0} drainPoints={[]} clickable onDrainClick={vi.fn()} />,
    );
    for (const g of ['적합', '경계', '보수', '재시공', '판정불가']) expect(getByText(g)).toBeInTheDocument();
    expect(getByText('배수구')).toBeInTheDocument();
    expect(getByText(/역구배/)).toBeInTheDocument();
  });
});

// jsdom은 getContext('2d')를 지원하지 않는다(slope-heatmap.test.ts와 같은 사정) -
// 여기서는 진짜 CanvasRenderingContext2D 대신 호출을 기록하는 가짜로 스텁해
// drawSlopeHeatmap이 "실제로" 이 컴포넌트에서 호출되고, results[].reverse가
// 끊기지 않고 그대로 전달되는지(코드리뷰 R-19) 확인한다. slope-heatmap.test.ts는
// drawSlopeHeatmap 함수 자체의 단위 동작만 보고, 이 뷰가 그 함수에 무엇을
// 넘기는지는 검증하지 않는다 - 배선 자체가 이 테스트의 목적이다.
function fakeCtx() {
  const strokeWidths: number[] = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    fillRect: () => {}, strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    stroke() { strokeWidths.push(this.lineWidth); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokeWidths };
}

describe('SlopeHeatmapView -> drawSlopeHeatmap 배선 (코드리뷰 R-19: reverse 미전달 회귀 방지)', () => {
  it('results[].reverse=true가 실제 렌더 경로에서 굵은 화살표(lineWidth 2.2)로 이어진다', () => {
    const { ctx, strokeWidths } = fakeCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);

    render(
      <SlopeHeatmapView results={[result({ reverse: true })]} cellM={2.0} drainPoints={[]} clickable
        onDrainClick={vi.fn()} />,
    );

    // 셀 배경(strokeRect, 여기서 기록 안 함) + 화살표(stroke) - 화살표 stroke만
    // lineWidth를 기록하므로, 2.2(굵게)가 실제로 찍혔는지 본다.
    expect(strokeWidths).toContain(2.2);
    expect(strokeWidths).not.toContain(0.9); // 이 픽스처는 셀이 하나뿐이라 얇은 화살표는 없어야 함
  });

  it('results[].reverse=false는 얇은 화살표(lineWidth 0.9)로 이어진다', () => {
    const { ctx, strokeWidths } = fakeCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);

    render(
      <SlopeHeatmapView results={[result({ reverse: false })]} cellM={2.0} drainPoints={[]} clickable
        onDrainClick={vi.fn()} />,
    );

    expect(strokeWidths).toContain(0.9);
    expect(strokeWidths).not.toContain(2.2);
  });
});

// 다크 T8: 캔버스는 검정 스테이지 안 여백, 범례는 스테이지에 붙은 줄(Stage toolbar, 아트보드 ScanSlope 63~77행).
// 범례 사각은 같은 이름의 평활도 등급 토큰(캔버스 화면 색과 같은 값, Task 1 palette.test.ts 가 잇는다).
// data-grade 는 SLOPE_GRADE_TO_GRADE 로 바꾼 평활도 등급 키, 글자는 엔진 문자열 그대로. 배수구는 DRAIN_COLOR.
describe('SlopeHeatmapView C안 해부', () => {
  it('캔버스는 검정 스테이지(Stage) 안, 범례 줄은 스테이지 다음 형제: 등급 사각(GRADE_CLASS)·배수구(bg-drain)·화살표 안내(muted)', () => {
    const { container } = render(
      <SlopeHeatmapView results={[result()]} cellM={2.0} drainPoints={[]} clickable onDrainClick={vi.fn()} />,
    );
    const canvas = container.querySelector('canvas')!;
    expect(canvas.className).toContain('cursor-crosshair');
    expect(canvas).toHaveAttribute('role', 'img');
    const stage = canvas.closest('[data-stage]')!;
    for (const cls of ['rounded-t-card', 'p-4']) expect(stage.className.split(/\s+/)).toContain(cls);
    const legend = stage.nextElementSibling as HTMLElement;
    const swatches = legend.querySelectorAll('[data-grade]');
    expect(Array.from(swatches).map((s) => s.getAttribute('data-grade'))).toEqual(['pass', 'borderline', 'repair', 'rework', 'na']);
    expect(swatches[0].className).toContain(GRADE_CLASS.pass.bg);
    expect(swatches[4].className).toContain(GRADE_CLASS.na.bg);
    expect(within(legend).getByText('판정불가')).toBeInTheDocument();
    expect(legend.querySelector('[data-legend="drain"]')!.className).toContain('bg-drain');
    expect(within(legend).getByText(/얇은 화살표/).className).toContain('text-muted');
    expect(container.innerHTML).not.toMatch(/\bcs-/);
  });

  // ---- 변이 실험이 드러낸 빈틈 ----
  it('캔버스 접근성 이름은 "구배 판정 지도"다', () => {
    const { container } = render(
      <SlopeHeatmapView results={[result()]} cellM={2.0} drainPoints={[]} clickable onDrainClick={vi.fn()} />,
    );
    expect(container.querySelector('canvas')).toHaveAttribute('aria-label', '구배 판정 지도');
  });

  it('클릭한 월드 좌표는 소수 셋째 자리로 반올림해 넘긴다', () => {
    const onDrainClick = vi.fn();
    const { container } = render(
      <SlopeHeatmapView results={[result()]} cellM={2.0} drainPoints={[]} clickable onDrainClick={onDrainClick} />,
    );
    const canvas = container.querySelector('canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 480, bottom: 480, width: 480, height: 480, x: 0, y: 0, toJSON() {} }),
    });
    // 위 첫 테스트와 같은 배치: scale 240, xMin 0, yMax 2. x = 100/240 = 0.41666.., y = 2 - 331/240 = 0.62083..
    fireEvent.click(canvas, { clientX: 100, clientY: 331 });
    expect(onDrainClick).toHaveBeenCalledWith({ x: 0.417, y: 0.621 });
  });

  it('clickable=false 면 not-allowed 커서를 쓴다', () => {
    const { container } = render(
      <SlopeHeatmapView results={[result()]} cellM={2.0} drainPoints={[]} clickable={false} onDrainClick={vi.fn()} />,
    );
    expect(container.querySelector('canvas')?.className).toContain('cursor-not-allowed');
  });

  it('배수구 표식은 DRAIN_COLOR 로 채우고 STAGE_INK 1.5px 테두리를 두른다', () => {
    const { ctx, ops } = recording2d();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
    render(
      <SlopeHeatmapView results={[result()]} cellM={2.0} drainPoints={[{ x: 1, y: 1 }]} clickable onDrainClick={vi.fn()} />,
    );
    expect(ops.filter((o) => o.op === 'fill').map((o) => o.style)).toEqual([DRAIN_COLOR]);
    const strokes = ops.filter((o) => o.op === 'stroke');
    expect(strokes[strokes.length - 1]).toMatchObject({ style: STAGE_INK, lineWidth: 1.5 });
  });
});

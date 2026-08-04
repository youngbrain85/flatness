import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SlopeHeatmapView } from '../slope-heatmap-view';
import type { SlopeCellResult } from '@/lib/domain/slope-judged';
import type { SlopeCellRow } from '@/lib/domain/types';

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
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as RenderingContext);

    render(
      <SlopeHeatmapView results={[result({ reverse: true })]} cellM={2.0} drainPoints={[]} clickable
        onDrainClick={vi.fn()} />,
    );

    // 셀 배경(strokeRect, 여기서 기록 안 함) + 화살표(stroke) - 화살표 stroke만
    // lineWidth를 기록하므로, 2.2(굵게)가 실제로 찍혔는지 본다.
    expect(strokeWidths).toContain(2.2);
    expect(strokeWidths).not.toContain(0.9); // 이 픽스처는 셀이 하나뿐이라 얇은 화살표는 없어야 함

    getContextSpy.mockRestore();
  });

  it('results[].reverse=false는 얇은 화살표(lineWidth 0.9)로 이어진다', () => {
    const { ctx, strokeWidths } = fakeCtx();
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as RenderingContext);

    render(
      <SlopeHeatmapView results={[result({ reverse: false })]} cellM={2.0} drainPoints={[]} clickable
        onDrainClick={vi.fn()} />,
    );

    expect(strokeWidths).toContain(0.9);
    expect(strokeWidths).not.toContain(2.2);

    getContextSpy.mockRestore();
  });
});

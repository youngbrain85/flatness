import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HeatmapView } from '../heatmap-view';
import type { CellRow } from '@/lib/domain/types';

const cell = (ix: number, iy: number, value: number): CellRow => ({
  ix, iy, center_x: ix + 0.5, center_y: iy + 0.5, value_mm: value, span_used_m: 3,
  occupancy: 1, grade: 'pass', worst_x: null, worst_y: null, zone_id: 1,
});

describe('HeatmapView 클릭 좌표 보정 (리뷰 Important #2: className="max-w-full" CSS 축소 대응)', () => {
  it('캔버스가 CSS로 절반 축소돼도 스케일 보정을 거쳐 올바른 셀을 선택한다', () => {
    // cells = [ix0,iy0], [ix1,iy0] -> gridGeometry: cols=2, rows=1
    // cellPxFor(geom, 640, 480) = min(640/2, 480/1) = 320 -> canvas.width=640, height=320
    const cells = [cell(0, 0, 1), cell(1, 0, 99)];
    const { container } = render(<HeatmapView surface="floor" cells={cells} zones={[]} />);
    const canvas = container.querySelector('canvas')!;

    // getBoundingClientRect가 실제 캔버스 픽셀(640x320)의 절반(320x160)을 보고하도록 스텁
    // (jsdom은 레이아웃을 계산하지 않으므로 CSS 축소 상황을 직접 흉내낸다)
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 320, bottom: 160, width: 320, height: 160, x: 0, y: 0, toJSON() {} }),
    });

    // 화면 좌표 200은 CSS 폭(320)의 62.5% 지점 - 스케일 보정 없이 그대로 쓰면 실 픽셀
    // 200(<320)이라 왼쪽 셀(ix=0)로 오판된다. 보정하면 200*2=400(>=320)이라 ix=1(오른쪽 셀)이 맞다.
    fireEvent.click(canvas, { clientX: 200, clientY: 80 });

    expect(screen.getByText(/99\.00/)).toBeInTheDocument(); // ix=1 셀(value_mm=99)이 선택돼야 함
    expect(screen.queryByText(/^1\.00 mm$/)).not.toBeInTheDocument();
  });
});

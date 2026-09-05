import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HeatmapView } from '../heatmap-view';
import type { CellRow, WallInfo } from '@/lib/domain/types';

const cell = (ix: number, iy: number, value: number): CellRow => ({
  ix, iy, center_x: ix + 0.5, center_y: iy + 0.5, value_mm: value, span_used_m: 3,
  occupancy: 1, grade: 'pass', worst_x: null, worst_y: null, zone_id: 1,
});

const wall = (id: number): WallInfo => ({
  wall_id: id, n_cells: 1, height_m: 2.4, length_m: 5.1, plumbness_mm: 3, plumb_grade: 'pass',
  plane_abc: [0, 0, 0],
  frame: { p0: [0, 0], direction: [1, 0], normal: [0, 1], u_min: 0, u_max: 5.1, z_min: 0, z_max: 2.4 },
});

// jsdom은 레이아웃을 계산하지 않으므로 캔버스 rect를 직접 스텁한다(CSS 축소 없음 = 실 픽셀과 동일)
function stubRect(canvas: HTMLCanvasElement, width: number, height: number) {
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON() {} }),
  });
}

describe('HeatmapView 클릭 좌표 보정 (리뷰 Important #2: className="max-w-full" CSS 축소 대응)', () => {
  it('캔버스가 CSS로 절반 축소돼도 스케일 보정을 거쳐 올바른 셀을 선택한다', () => {
    // cells = [ix0,iy0], [ix1,iy0] -> gridGeometry: cols=2, rows=1
    // cellPxFor(geom, 640, 480) = min(640/2, 480/1) = 320 -> canvas.width=640, height=320
    const cells = [cell(0, 0, 1), cell(1, 0, 99)];
    const { container } = render(<HeatmapView surface="floor" cells={cells} zones={[]} />);
    const canvas = container.querySelector('canvas')!;

    // getBoundingClientRect가 실제 캔버스 픽셀(640x320)의 절반(320x160)을 보고하도록 스텁
    // (jsdom은 레이아웃을 계산하지 않으므로 CSS 축소 상황을 직접 흉내낸다)
    stubRect(canvas, 320, 160);

    // 화면 좌표 200은 CSS 폭(320)의 62.5% 지점 - 스케일 보정 없이 그대로 쓰면 실 픽셀
    // 200(<320)이라 왼쪽 셀(ix=0)로 오판된다. 보정하면 200*2=400(>=320)이라 ix=1(오른쪽 셀)이 맞다.
    fireEvent.click(canvas, { clientX: 200, clientY: 80 });

    expect(screen.getByText(/99\.00/)).toBeInTheDocument(); // ix=1 셀(value_mm=99)이 선택돼야 함
    expect(screen.queryByText(/^1\.00 mm$/)).not.toBeInTheDocument();
  });
});

// Cloudscape 리스킨(T7): 캔버스·범례 색은 산출물 팔레트(GRADE_COLOR) 그대로(스펙 §7-4),
// 크롬(보더·라벨·벽 선택)만 토큰과 TabBar로.
describe('HeatmapView Cloudscape 해부 (T7)', () => {
  it('범례는 GRADE_COLOR 5색 12px 사각 스와치이고 캔버스 보더는 cs-divider다', () => {
    const { container } = render(<HeatmapView surface="floor" cells={[cell(0, 0, 1)]} zones={[]} />);
    expect(container.querySelector('canvas')?.className).toContain('border-cs-divider');
    const swatches = container.querySelectorAll('[data-grade]');
    expect(Array.from(swatches).map((s) => s.getAttribute('data-grade'))).toEqual(['pass', 'borderline', 'repair', 'rework', 'na']);
    expect(swatches[0]).toHaveStyle({ backgroundColor: 'rgb(46, 125, 50)' });  // #2e7d32
    expect(swatches[3]).toHaveStyle({ backgroundColor: 'rgb(197, 34, 31)' });  // #c5221f
    expect(swatches[0].className).toContain('h-3 w-3');
    for (const label of ['적합', '경계', '보수', '재시공', '판정 불가']) expect(screen.getByText(label)).toBeInTheDocument();
    // getByText는 자기 텍스트 노드를 가진 범례 항목 span을 돌려준다 - 12px/16px 클래스는 그 span에 있어야 한다
    expect(screen.getByText('적합').className).toContain('text-xs');
    expect(screen.getByText('적합').className).toContain('leading-4');
  });

  it('벽면: 벽 선택은 TabBar(role=tab)이고 클릭하면 활성 탭이 바뀐다', () => {
    const cells = [cell(0, 0, 1), { ...cell(0, 0, 2), zone_id: 2 }];
    render(<HeatmapView surface="wall" cells={cells} walls={[wall(1), wall(2)]} zones={[]} />);
    const tab1 = screen.getByRole('tab', { name: '벽 1 (5.1m x 2.4m)' });
    const tab2 = screen.getByRole('tab', { name: '벽 2 (5.1m x 2.4m)' });
    expect(tab1).toHaveAttribute('aria-selected', 'true');
    expect(tab2).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(tab2);
    expect(tab2).toHaveAttribute('aria-selected', 'true');
    expect(tab1).toHaveAttribute('aria-selected', 'false');
  });

  it('셀 클릭 상세의 라벨은 보조색이고 판정은 Badge, 구 팔레트 클래스가 없다', () => {
    const { container } = render(<HeatmapView surface="floor" cells={[cell(0, 0, 1)]} zones={[]} />);
    const canvas = container.querySelector('canvas')!;
    stubRect(canvas, 480, 480); // cols=1, rows=1 -> cellPx=min(640,480)=480
    fireEvent.click(canvas, { clientX: 240, clientY: 240 });
    expect(screen.getByText('직선자 값').className).toContain('text-cs-text-secondary');
    expect(screen.getByText('직선자 값').closest('dl')?.className).toContain('border-cs-divider');
    expect(screen.getAllByText('적합').some((el) => el.className.includes('bg-cs-success-bg'))).toBe(true);
    expect(container.innerHTML).not.toMatch(/zinc-/);
  });
});

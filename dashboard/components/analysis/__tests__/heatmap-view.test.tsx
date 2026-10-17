import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { HeatmapView } from '../heatmap-view';
import { GRADE_CLASS } from '@/components/ui/grade';
import { SCREEN_GRADE_COLOR, STAGE_BG } from '@/lib/domain/palette';
import { recording2d } from '@/lib/viz/__tests__/ctx2d-stub';
import type { CellRow, WallInfo, ZoneInfo } from '@/lib/domain/types';

const cell = (ix: number, iy: number, value: number | null, over: Partial<CellRow> = {}): CellRow => ({
  ix, iy, center_x: ix + 0.5, center_y: iy + 0.5, value_mm: value, span_used_m: 3,
  occupancy: 1, grade: 'pass', worst_x: null, worst_y: null, zone_id: 1, ...over,
});

const wall = (id: number): WallInfo => ({
  wall_id: id, n_cells: 1, height_m: 2.4, length_m: 5.1, plumbness_mm: 3, plumb_grade: 'pass',
  plane_abc: [0, 0, 0],
  frame: { p0: [0, 0], direction: [1, 0], normal: [0, 1], u_min: 0, u_max: 5.1, z_min: 0, z_max: 2.4 },
});

// jsdom 은 레이아웃이 없다(clientWidth·clientHeight 0). 캔버스 CSS 크기를 스텁해 스테이지 배치를 정한다
function stubStage(w: number, h: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(w);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(h);
}
// 캔버스의 화면 위치(왼쪽 위 0,0). 클릭 좌표를 캔버스 기준 CSS px 로 쓴다
function stubRect(canvas: HTMLCanvasElement, w: number, h: number) {
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON() {} }),
  });
}

beforeEach(() => {
  // 기본은 2D 캔버스 없음(jsdom 그대로). 그리기를 보는 테스트만 기록 스텁으로 바꾼다
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HeatmapView 칸 선택(그린 배치와 같은 함수로 누른 칸을 찾는다)', () => {
  it('2칸 중 오른쪽 칸을 누르면 그 칸의 상세를 아래 줄에 보인다', () => {
    stubStage(800, 400);
    const { container } = render(
      <HeatmapView surface="floor" cells={[cell(0, 0, 1), cell(1, 0, 99)]} zones={[]} cellM={1} />,
    );
    const canvas = container.querySelector('canvas')!;
    stubRect(canvas, 800, 400);
    // 2열 1행 in 800x400: 칸 311px, x0 44, y0 27 -> 오른쪽 칸은 x 355~666, y 27~338
    fireEvent.click(canvas, { clientX: 510, clientY: 182 });
    const detail = screen.getByTestId('heatmap-cell-detail');
    expect(within(detail).getByText('99.00 mm')).toBeInTheDocument();
    expect(within(detail).queryByText('1.00 mm')).toBeNull();
  });

  it('칸 묶음 밖(범례 자리)을 누르면 상세가 없다', () => {
    stubStage(800, 400);
    const { container } = render(
      <HeatmapView surface="floor" cells={[cell(0, 0, 1), cell(1, 0, 99)]} zones={[]} cellM={1} />,
    );
    const canvas = container.querySelector('canvas')!;
    stubRect(canvas, 800, 400);
    fireEvent.click(canvas, { clientX: 760, clientY: 30 });
    expect(screen.queryByTestId('heatmap-cell-detail')).toBeNull();
  });

  it('상세: 설명 줄 안, 판정은 GradeBadge(data-grade), 수치는 mono, 최악 지점, 구역 상태', () => {
    stubStage(800, 400);
    const zones: ZoneInfo[] = [{ zone_id: 1, level_m: 0, area_m2: 1, status: 'ok', plane_abc: null }];
    const { container } = render(
      <HeatmapView surface="floor" zones={zones} cellM={1}
        cells={[cell(0, 0, 4.5, { grade: 'borderline', worst_x: 0.4, worst_y: 0.6 })]} />,
    );
    const canvas = container.querySelector('canvas')!;
    stubRect(canvas, 800, 400);
    // 1x1 in 800x400: 칸 316px, x0 242, y0 24
    fireEvent.click(canvas, { clientX: 400, clientY: 180 });
    const detail = screen.getByTestId('heatmap-cell-detail');
    expect(detail.parentElement).toBe(container.querySelector('[data-stage]')!.nextElementSibling);
    expect(within(detail).getByText('경계').closest('[data-grade]')).toHaveAttribute('data-grade', 'borderline');
    expect(within(detail).getByText('4.50 mm').className).toContain('font-mono');
    expect(within(detail).getByText('(0.4, 0.6)')).toBeInTheDocument();
    expect(within(detail).getByText('1 (정상)')).toBeInTheDocument();
  });
});

describe('HeatmapView 스테이지(아트보드 ScanDone 74~89행)', () => {
  it('그리기: 버퍼는 CSS 크기 x 화면 배율, 바탕 STAGE_BG, 칸은 SCREEN_GRADE_COLOR', () => {
    stubStage(800, 400);
    vi.stubGlobal('devicePixelRatio', 2);
    const { ctx, ops } = recording2d();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
    const { container } = render(
      <HeatmapView surface="floor" zones={[]} cellM={1}
        cells={[cell(0, 0, 1), cell(1, 0, 14.86, { grade: 'repair' })]} />,
    );
    const canvas = container.querySelector('canvas')!;
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(800);
    const fills = ops.filter((o) => o.op === 'fillRect').map((o) => o.style);
    expect(fills[0]).toBe(STAGE_BG);
    expect(fills).toContain(SCREEN_GRADE_COLOR.pass);
    expect(fills).toContain(SCREEN_GRADE_COLOR.repair);
  });

  it('캔버스는 role=img, 이름에 열·행·칸 수·등급별 개수·최댓값. HUD 는 셀 크기·칸 수·최댓값', () => {
    render(
      <HeatmapView surface="floor" zones={[]} cellM={1}
        cells={[cell(0, 0, 1), cell(1, 0, 14.86, { grade: 'repair' })]} />,
    );
    const canvas = screen.getByRole('img', { name: /^판정 히트맵 평면도/ });
    expect(canvas.getAttribute('aria-label'))
      .toBe('판정 히트맵 평면도. 1m 셀 2열 1행 2칸, 적합 1칸, 보수 1칸, 최댓값 14.86 mm');
    expect(screen.getByTestId('heatmap-hud').textContent).toBe('1m 셀 · 2칸(유효 2) · 최댓값 14.86 mm');
  });

  it('범례 5항목(GradeDot 10px + 이름), 2:1·최소 440px 스테이지(Stage), 스테이지에 붙은 설명 줄(toolbar)', () => {
    const { container } = render(<HeatmapView surface="floor" cells={[cell(0, 0, 1)]} zones={[]} cellM={1} />);
    const dots = container.querySelectorAll('[data-grade]');
    expect(Array.from(dots).map((d) => d.getAttribute('data-grade'))).toEqual(['pass', 'borderline', 'repair', 'rework', 'na']);
    expect(dots[0].className.split(/\s+/)).toEqual(expect.arrayContaining([GRADE_CLASS.pass.bg, 'h-2.5', 'w-2.5']));
    expect(dots[3].className).toContain(GRADE_CLASS.rework.bg);
    for (const label of ['적합', '경계', '보수', '재시공', '판정 불가']) expect(screen.getByText(label)).toBeInTheDocument();
    const stage = container.querySelector('[data-stage]')!;
    expect(stage).toContainElement(container.querySelector('canvas'));
    for (const cls of ['aspect-[2/1]', 'min-h-[440px]', 'rounded-t-card']) expect(stage.className.split(/\s+/)).toContain(cls);
    const foot = screen.getByText(/흰 테두리 칸이 최댓값입니다/).parentElement!;
    expect(stage.nextElementSibling).toBe(foot);
    // 판정 셀 크기 선택 줄은 3번 스펙 몫이라 없다
    expect(screen.queryByRole('group', { name: '판정 셀' })).toBeNull();
    expect(container.innerHTML).not.toMatch(/\bcs-/);
  });

  it('벽면: 벽 선택은 TabBar(role=tab, 묶음 이름 "벽 선택")이고 누르면 활성 탭이 바뀐다', () => {
    const cells = [cell(0, 0, 1), { ...cell(0, 0, 2), zone_id: 2 }];
    render(<HeatmapView surface="wall" cells={cells} walls={[wall(1), wall(2)]} zones={[]} cellM={1} />);
    expect(screen.getByRole('tablist', { name: '벽 선택' })).toBeInTheDocument();
    const tab1 = screen.getByRole('tab', { name: '벽 1 (5.1m x 2.4m)' });
    const tab2 = screen.getByRole('tab', { name: '벽 2 (5.1m x 2.4m)' });
    expect(tab1).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tab2);
    expect(tab2).toHaveAttribute('aria-selected', 'true');
    expect(tab1).toHaveAttribute('aria-selected', 'false');
  });

  it('셀이 없으면 안내 문구만 있고 캔버스가 없다', () => {
    const { container } = render(<HeatmapView surface="floor" cells={[]} zones={[]} />);
    expect(screen.getByText('표시할 셀 데이터가 없습니다.')).toBeInTheDocument();
    expect(container.querySelector('canvas')).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
// 캔버스의 화면 위치(기본은 왼쪽 위 0,0). 클릭 좌표를 캔버스 기준 CSS px 로 쓴다.
// left·top 은 캔버스가 화면 한가운데 있는 경우를 보는 테스트가 준다(기본 0 이면 처음 그대로다)
function stubRect(canvas: HTMLCanvasElement, w: number, h: number, left = 0, top = 0) {
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} }),
  });
}

beforeEach(() => {
  // 기본은 2D 캔버스 없음(jsdom 그대로). 그리기를 보는 테스트만 기록 스텁으로 바꾼다
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (document as unknown as { fonts?: unknown }).fonts;   // 글꼴 테스트가 단 스텁(jsdom 에는 document.fonts 가 없다)
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

// ---- 변이 실험이 드러낸 빈틈. 아래 클릭 좌표·기대값은 800x400 스테이지의 배치(칸 311px, x0 44, y0 27 등)에서 손으로 구했다 ----
describe('HeatmapView 보강: 좌표·배율·상세·벽·겹침·다시 그리기', () => {
  const twoCells = () => [cell(0, 0, 1), cell(1, 0, 99)];

  it('캔버스가 화면 한가운데 있어도(왼쪽 위가 0,0 이 아니어도) 누른 자리를 캔버스 기준으로 환산한다', () => {
    stubStage(800, 400);
    const { container } = render(<HeatmapView surface="floor" cells={twoCells()} zones={[]} cellM={1} />);
    const canvas = container.querySelector('canvas')!;
    stubRect(canvas, 800, 400, 200, 100);   // 화면에서 (200,100) 에 놓인 캔버스
    fireEvent.click(canvas, { clientX: 200 + 510, clientY: 100 + 182 });
    expect(within(screen.getByTestId('heatmap-cell-detail')).getByText('99.00 mm')).toBeInTheDocument();
  });

  it('화면 배율이 3 이어도 버퍼는 2 배까지만 키우고, 좌표계는 그 배율로 맞추며, 누른 자리는 버퍼가 아닌 CSS 크기 배치로 찾는다', () => {
    stubStage(800, 400);
    vi.stubGlobal('devicePixelRatio', 3);
    const { ctx } = recording2d();
    const setTransform = vi.fn();
    (ctx as unknown as { setTransform: typeof setTransform }).setTransform = setTransform;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
    const { container } = render(<HeatmapView surface="floor" cells={twoCells()} zones={[]} cellM={1} />);
    const canvas = container.querySelector('canvas')!;
    expect([canvas.width, canvas.height]).toEqual([1600, 800]);
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    // 버퍼 크기(1600x800)로 배치를 구하면 왼쪽 칸(x 44~755)이 잡힌다. CSS 크기(800x400)면 오른쪽 칸(x 355~666)이다
    stubRect(canvas, 800, 400);
    fireEvent.click(canvas, { clientX: 510, clientY: 182 });
    expect(within(screen.getByTestId('heatmap-cell-detail')).getByText('99.00 mm')).toBeInTheDocument();
  });

  it('상세의 나머지 칸: 사용 스팬(m)·점유율(%, 반올림), 최악 지점이 없으면 -, 구역 번호', () => {
    stubStage(800, 400);
    const { container } = render(
      <HeatmapView surface="floor" zones={[]} cellM={1}
        cells={[cell(0, 0, 4.5, { occupancy: 0.874, span_used_m: 2.5 })]} />,
    );
    const canvas = container.querySelector('canvas')!;
    stubRect(canvas, 800, 400);
    fireEvent.click(canvas, { clientX: 400, clientY: 180 });
    const detail = screen.getByTestId('heatmap-cell-detail');
    const field = (label: string) => within(detail).getByText(label).parentElement!.textContent;
    expect(field('사용 스팬')).toBe('사용 스팬2.5 m');
    expect(field('셀 점유율')).toBe('셀 점유율87%');
    expect(field('최악 지점')).toBe('최악 지점-');
    expect(field('구역')).toBe('구역1');
  });

  it('벽면: 벽마다 그 벽의 칸만 그리고(HUD·캔버스 이름), 벽을 바꾸면 열린 상세가 닫힌다. 상세 이름은 "벽"', () => {
    stubStage(800, 400);
    const cells = [cell(0, 0, 1, { zone_id: 1 }), cell(0, 0, 7, { zone_id: 2 }), cell(1, 0, 2, { zone_id: 2 })];
    const { container } = render(
      <HeatmapView surface="wall" cells={cells} walls={[wall(1), wall(2)]} zones={[]} cellM={1} />,
    );
    // 처음 벽 1: 칸 하나 (1열 1행)
    expect(screen.getByTestId('heatmap-hud').textContent).toBe('1m 셀 · 1칸(유효 1) · 최댓값 1.00 mm');
    expect(screen.getByRole('img', { name: /^판정 히트맵 평면도/ }).getAttribute('aria-label'))
      .toBe('판정 히트맵 평면도. 1m 셀 1열 1행 1칸, 적합 1칸, 최댓값 1.00 mm');
    const canvas = container.querySelector('canvas')!;
    stubRect(canvas, 800, 400);
    fireEvent.click(canvas, { clientX: 400, clientY: 180 });   // 1x1 in 800x400: 칸 316px, x0 242, y0 24
    expect(within(screen.getByTestId('heatmap-cell-detail')).getByText('벽')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '벽 2 (5.1m x 2.4m)' }));
    expect(screen.queryByTestId('heatmap-cell-detail')).toBeNull();
    expect(screen.getByTestId('heatmap-hud').textContent).toBe('1m 셀 · 2칸(유효 2) · 최댓값 7.00 mm');
    expect(screen.getByRole('img', { name: /^판정 히트맵 평면도/ }).getAttribute('aria-label'))
      .toBe('판정 히트맵 평면도. 1m 셀 2열 1행 2칸, 적합 2칸, 최댓값 7.00 mm');
  });

  it('벽 선택 탭은 벽면에 벽 정보가 있을 때만 나온다(벽 정보가 없거나 바닥이면 없다)', () => {
    const one = [cell(0, 0, 1)];
    const first = render(<HeatmapView surface="wall" cells={one} zones={[]} cellM={1} />);
    expect(screen.queryByRole('tablist')).toBeNull();   // 벽면인데 벽 정보가 없다: 칸을 전부 그린다
    expect(screen.getByTestId('heatmap-hud').textContent).toBe('1m 셀 · 1칸(유효 1) · 최댓값 1.00 mm');
    first.unmount();
    const second = render(<HeatmapView surface="wall" cells={one} walls={[]} zones={[]} cellM={1} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    second.unmount();
    render(<HeatmapView surface="floor" cells={one} walls={[wall(1)]} zones={[]} cellM={1} />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('캔버스는 십자 커서이고, 범례와 HUD 는 캔버스 클릭을 가로채지 않는다(pointer-events-none)', () => {
    const { container } = render(<HeatmapView surface="floor" cells={[cell(0, 0, 1)]} zones={[]} cellM={1} />);
    expect(container.querySelector('canvas')!.className.split(/\s+/)).toContain('cursor-crosshair');
    expect(container.querySelector('[data-stage] ul')!.className.split(/\s+/)).toContain('pointer-events-none');
    expect(screen.getByTestId('heatmap-hud').className.split(/\s+/)).toContain('pointer-events-none');
  });

  // 배경 칠하기(전체 크기 fillRect)가 곧 "한 번 그렸다"는 표시다. CELL_GAP_COLOR 가 STAGE_BG 와 같은 검정이라 좌표로 가린다
  const backgroundPaints = (ops: ReturnType<typeof recording2d>['ops']) =>
    ops.filter((o) => o.op === 'fillRect' && o.args.join() === '0,0,800,400').length;

  it('글꼴이 늦게 도착하면(document.fonts.ready) 칸 숫자를 한 번 더 그린다', async () => {
    stubStage(800, 400);
    let ready!: () => void;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: new Promise<void>((resolve) => { ready = resolve; }) },
    });
    const { ctx, ops } = recording2d();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
    render(<HeatmapView surface="floor" zones={[]} cellM={1} cells={[cell(0, 0, 1)]} />);
    expect(backgroundPaints(ops)).toBe(1);
    await act(async () => { ready(); });
    expect(backgroundPaints(ops)).toBe(2);
  });

  it('스테이지 크기가 바뀌면(ResizeObserver) 다시 그린다', () => {
    stubStage(800, 400);
    let notify: () => void = () => {};
    let observed: Element | null = null;
    class FakeResizeObserver {
      constructor(callback: () => void) { notify = callback; }
      observe(el: Element) { observed = el; }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { ctx, ops } = recording2d();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
    const { container } = render(<HeatmapView surface="floor" zones={[]} cellM={1} cells={[cell(0, 0, 1)]} />);
    expect(observed).toBe(container.querySelector('canvas'));
    expect(backgroundPaints(ops)).toBe(1);
    notify();
    expect(backgroundPaints(ops)).toBe(2);
  });

  it('캔버스 크기를 아직 모르면(0x0, 숨은 탭 등) 아무것도 그리지 않는다', () => {
    // stubStage 를 부르지 않는다: jsdom 의 clientWidth·clientHeight 는 0 이다
    const { ctx, ops } = recording2d();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
    render(<HeatmapView surface="floor" zones={[]} cellM={1} cells={[cell(0, 0, 1)]} />);
    expect(ops).toEqual([]);
  });
});

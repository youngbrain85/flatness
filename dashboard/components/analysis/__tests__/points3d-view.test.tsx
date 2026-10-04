// Points3dView 컴포넌트 테스트(스펙 2026-10-02-pointcloud-viewer-design §10.4).
//
// jsdom 에는 WebGL 이 없다. HTMLCanvasElement.prototype.getContext 에 gl 호출 기록 스텁을 끼워
// "어떤 uniform 을 · 몇 개의 점으로 · 어떤 크기의 버퍼에" 그리는지를 실제 렌더 경로에서 관찰한다.
// requestAnimationFrame 은 수동 큐로 바꿔 테스트가 타임스탬프를 준다(LOD 의 frameMs 를 결정적으로 만든다).
// setTimeout 만 가짜 타이머다(휠·키의 조작 종료 200ms, 컨텍스트 복구 대기 3,000ms).
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Points3dLoadingFrame, Points3dView } from '../points3d-view';
import type { Points3dData } from '@/lib/domain/points3d';
import { fitToBounds, pan, rotate, viewProj } from '@/lib/viz/points3d/orbit';
import type { Bounds } from '@/lib/viz/points3d/orbit';
import { project } from '@/lib/viz/points3d/mat4';
import { recordingGl } from '@/lib/viz/points3d/__tests__/gl-stub';
import type { RecordingGl } from '@/lib/viz/points3d/__tests__/gl-stub';

// ---- 데이터 ----
const ORIGIN: [number, number, number] = [254012.5, 4180045.25, 31.5];
const EXTENT: [number, number, number] = [4, 3, 0.5];
const FIT: Bounds = { min: [0, 0, 0], max: [4, 3, 0.25] };
const FULL: Bounds = { min: [0, 0, 0], max: EXTENT };

type Row = [qx: number, qy: number, qz: number, dev: number];

function dataOf(rows: Row[], fit: Bounds = FIT): Points3dData {
  const n = rows.length;
  const xyz = new Uint16Array(3 * n);
  const dev = new Int16Array(n);
  rows.forEach(([qx, qy, qz, d], i) => { xyz.set([qx, qy, qz], 3 * i); dev[i] = d; });
  return {
    meta: {
      schema_version: 1, n_points: n, units: 'm', origin_m: ORIGIN, extent_m: EXTENT,
      deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
      sample_cell_m: 0.0125, fit_bounds: fit,
      sampling: { method: 'cell-minhash-stratified', source_points: n, cap: 500000 }, order: 'hash',
    },
    xyz, dev,
  };
}

// 난수 없이 고르게 흩은 n 점(화면 테스트와 LOD 테스트용). 내용은 단언하지 않는다
function scatter(n: number): Points3dData {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) rows.push([(i * 7919) % 65536, (i * 104729) % 65536, 0, (i % 201) - 100]);
  return dataOf(rows);
}
const SMALL = scatter(1234);

// 읽기 창용 3점. local = q * extent / 65535
//   P0 q(13107, 21845, 0) -> local (0.8, 1.0, 0), dev 32 (+3.2mm)
//   P1 q(52428, 43690, 0) -> local (3.2, 2.0, 0), dev -32768 (바닥이 아닌 점)
//   P2 q(32768, 13107, 0) -> local (2.0, 0.6, 0), dev -105 (-10.5mm)
// fit 을 가운데 2m x 1m 로 좁혀 카메라가 다가가게 한다. 그러면 P1·P2 가 화면 가장자리 쪽에 놓인다(뒤집기 테스트)
const READOUT_FIT: Bounds = { min: [1, 1, 0], max: [3, 2, 0.25] };
const READOUT_DATA = dataOf([[13107, 21845, 0, 32], [52428, 43690, 0, -32768], [32768, 13107, 0, -105]], READOUT_FIT);
const P0: [number, number, number] = [0.8, 1.0, 0];
const P1: [number, number, number] = [3.2, 2.0, 0];
const P2: [number, number, number] = [(32768 * 4) / 65535, 0.6, 0];

// ---- 수동 rAF 큐 ----
let rafQueue: { id: number; cb: FrameRequestCallback }[] = [];
let rafSeq = 0;

/** 지금 예약된 rAF 콜백만 타임스탬프 ts 로 실행한다. 실행 중에 새로 예약된 콜백은 다음 호출 몫이다. */
function frame(ts: number) {
  const batch = rafQueue;
  rafQueue = [];
  act(() => { for (const r of batch) r.cb(ts); });
}

/** 캔버스의 CSS 크기와 화면 배율을 스텁한다. jsdom 의 clientWidth·clientHeight 는 항상 0 이다. */
function stubSize(cssW: number, cssH: number, dpr: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(cssW);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(cssH);
  vi.stubGlobal('devicePixelRatio', dpr);
}

type Props = Parameters<typeof Points3dView>[0];

function mount(over: Partial<Props> = {}) {
  const rec = recordingGl();
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(rec.gl as unknown as RenderingContext);
  const onError = vi.fn();
  const utils = render(
    <Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={onError} {...over} />,
  );
  const canvas = screen.getByRole('img', { name: '3D 점군 뷰어' }) as HTMLCanvasElement;
  return { rec, getContext, onError, canvas, ...utils };
}

/** 마지막 uniform 호출의 값(위치 인자 뒤)을 숫자 목록으로 편다. uniform1f / 3f / 3fv / Matrix4fv 를 가리지 않는다. */
function lastUniform(rec: RecordingGl, name: string): number[] {
  const calls = rec.uniformCalls(name);
  expect(calls.length, `${name} uniform 호출`).toBeGreaterThan(0);
  return calls[calls.length - 1].args.slice(1).flatMap((a) => (
    typeof a === 'number' ? [a] : typeof a === 'boolean' ? [] : Array.from(a as ArrayLike<number>)
  ));
}

function lastPointDraw(rec: RecordingGl): number {
  const draws = rec.pointDraws();
  expect(draws.length).toBeGreaterThan(0);
  return draws[draws.length - 1];
}

function expectMatrix(actual: number[], expected: Float32Array) {
  expect(actual).toHaveLength(16);
  for (let i = 0; i < 16; i++) expect(actual[i]).toBeCloseTo(expected[i], 5);
}

function ctrlWheel(canvas: HTMLCanvasElement, init: WheelEventInit = {}) {
  const e = new WheelEvent('wheel', { ctrlKey: true, cancelable: true, bubbles: true, deltaY: -120, ...init });
  act(() => { canvas.dispatchEvent(e); });
  return e;
}

const mouse = (x: number, y: number, more: object = {}) => (
  { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...more }
);

beforeEach(() => {
  rafQueue = [];
  rafSeq = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafSeq += 1;
    rafQueue.push({ id: rafSeq, cb });
    return rafSeq;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafQueue = rafQueue.filter((r) => r.id !== id); });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Points3dLoadingFrame', () => {
  // 변이: 배경을 색 유틸리티 클래스로 / 테마 인자 무시 / Spinner 칩 제거(검정 위에서 회전 호가 보이지 않는다)
  it('뷰어 영역과 같은 틀에 테마 배경색, 흰 칩 안의 Spinner, 로딩 문구를 그린다', () => {
    const { rerender } = render(<Points3dLoadingFrame theme="dark" />);
    const box = screen.getByTestId('points3d-loading');
    expect(box).toHaveStyle({ backgroundColor: '#000000', color: '#f2f4f7' });
    for (const cls of ['aspect-[4/3]', 'w-full', 'rounded-lg', 'border', 'border-cs-divider']) {
      expect(box.className.split(/\s+/)).toContain(cls);
    }
    const spinner = within(box).getByRole('status');
    expect(spinner.parentElement!.className).toBe('inline-flex rounded-full bg-white p-2');
    expect(within(box).getByText('3D 점군 데이터를 불러오는 중입니다.')).toBeInTheDocument();

    rerender(<Points3dLoadingFrame theme="light" />);
    expect(screen.getByTestId('points3d-loading')).toHaveStyle({ backgroundColor: '#ffffff', color: '#000716' });
  });
});

// 고지 문구 전문(스펙 §7.12). 임계값 7mm 일 때. 음수 부호는 U+2212 다
const NOTICE_7 = '점 색은 참고용 표시입니다. FLAT(평탄)은 점이 속한 5cm 칸이 구역 기준 평면에서 ±7mm 이내, '
  + 'DEPRESSION(침하)은 −7mm 미만, PROTRUSION(융기)은 +7mm 초과임을 뜻합니다. '
  + '판정 등급은 히트맵 탭의 직선자 틈새 기준이며 측정 방식이 다릅니다. '
  + '초록 점이 대부분인 칸이 경계·보수일 수 있고, 노랑·빨강 점이 많은 칸이 적합일 수 있습니다. '
  + '임계값을 바꿔도 판정과 보고서는 달라지지 않습니다.';

describe('Points3dView 화면', () => {
  // 변이: 범례 항목 누락·순서 변경, 표식 색을 클래스로
  it('범례 4항목을 테마 색 둥근 표식과 함께 그린다', () => {
    mount();
    const legend = screen.getByTestId('points3d-legend');
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['FLAT', 'DEPRESSION', 'PROTRUSION', '편차 없음']);
    expect(legend).toHaveStyle({ color: '#f2f4f7' });
    const swatch = (cls: string) => legend.querySelector(`[data-class="${cls}"]`) as HTMLElement;
    expect(swatch('flat')).toHaveStyle({ backgroundColor: '#4cc96f' });
    expect(swatch('depression')).toHaveStyle({ backgroundColor: '#f5c33b' });
    expect(swatch('protrusion')).toHaveStyle({ backgroundColor: '#f06464' });
    expect(swatch('none')).toHaveStyle({ backgroundColor: '#4a4f57' });
    expect(swatch('flat').className).toContain('rounded-full');
  });

  // 1,234 -> toLocaleString('ko-KR') = "1,234". 변이: 점 수를 그대로 찍음(1234점), 가운뎃점 대신 다른 구분자
  it('HUD: k = 1 이면 축 비율 1:1, 임계값, 점 수(천 단위 구분). 조작 안내는 보조 글자색', () => {
    mount();
    const hud = screen.getByTestId('points3d-hud');
    const hint = screen.getByTestId('points3d-hint');
    expect(hud.textContent).toBe('축 비율 1:1 · 임계값 ±7 mm · 1,234점');
    expect(hud).toHaveStyle({ color: '#f2f4f7' });
    expect(hint.textContent).toBe('드래그 회전 · Ctrl+휠 확대');
    expect(hint).toHaveStyle({ color: '#9aa3ad' });
    // 둘은 뷰어 아래쪽 한 줄에 있고 폭이 좁으면 접힌다
    expect(hint.parentElement).toBe(hud.parentElement);
    expect(hud.parentElement!.className.split(/\s+/)).toEqual(expect.arrayContaining(['absolute', 'bottom-3', 'flex-wrap']));
  });

  // 좁은 폭(375px)에서는 축 눈금 라벨이 아래 줄과 겹친다. 글자가 읽히도록 뷰어 배경색을 알파 0.6 으로 깐다.
  // 바탕색은 색 표의 배경에서 만든다: dark #000000 -> rgba(0, 0, 0, 0.6), light #ffffff -> rgba(255, 255, 255, 0.6)
  // 변이: 바탕 누락, 밝은 배경 전환이 바탕에 닿지 않음(테마 고정), HUD 나 조작 안내 한쪽에만 깖
  it('HUD 와 조작 안내는 테마 배경색 알파 0.6 의 바탕을 깔고 밝은 배경 전환을 따른다', () => {
    mount();
    expect(screen.getByTestId('points3d-hud')).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0.6)' });
    expect(screen.getByTestId('points3d-hint')).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0.6)' });
    fireEvent.click(screen.getByRole('button', { name: '밝은 배경' }));
    expect(screen.getByTestId('points3d-hud')).toHaveStyle({ backgroundColor: 'rgba(255, 255, 255, 0.6)' });
    expect(screen.getByTestId('points3d-hint')).toHaveStyle({ backgroundColor: 'rgba(255, 255, 255, 0.6)' });
  });

  // 변이: k > 1 에서도 "축 비율 1:1" 을 남김
  it('과장 버튼을 누르면 HUD 가 "편차 ×{k} 과장" 이 된다', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '×50' }));
    expect(screen.getByTestId('points3d-hud').textContent).toBe('편차 ×50 과장 · 임계값 ±7 mm · 1,234점');
    fireEvent.click(screen.getByRole('button', { name: '×1' }));
    expect(screen.getByTestId('points3d-hud').textContent).toBe('축 비율 1:1 · 임계값 ±7 mm · 1,234점');
  });

  // 변이: 선택 배경을 bg-cs-info-bg 덧붙이기로(normal 의 bg-transparent 에 가려 보이지 않는다)
  it('과장 버튼 4개는 aria-pressed 를 갖고 선택 배경은 aria-pressed variant 로 준다', () => {
    mount();
    const names = ['×1', '×10', '×50', '×100'];
    const pressed = () => names.map((n) => screen.getByRole('button', { name: n }).getAttribute('aria-pressed'));
    expect(pressed()).toEqual(['true', 'false', 'false', 'false']);
    fireEvent.click(screen.getByRole('button', { name: '×10' }));
    expect(pressed()).toEqual(['false', 'true', 'false', 'false']);
    for (const n of [...names, '밝은 배경']) {
      const tokens = screen.getByRole('button', { name: n }).className.split(/\s+/);
      expect(tokens).toContain('aria-pressed:bg-cs-info-bg');
      expect(tokens).not.toContain('bg-cs-info-bg');
    }
  });

  // 변이: 시점 버튼에 선택 상태를 둠(회전하면 어느 프리셋도 아니다)
  it('시점 버튼에는 선택 상태가 없다', () => {
    mount();
    for (const n of ['등각', '평면', '정면']) {
      expect(screen.getByRole('button', { name: n })).not.toHaveAttribute('aria-pressed');
    }
  });

  // 변이: primary 버튼을 둠(뷰당 primary 1개 규칙 위반)
  it('버튼 8개가 전부 normal 변형이고 묶음 이름 3개가 있다', () => {
    mount();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['등각', '평면', '정면', '×1', '×10', '×50', '×100', '밝은 배경']);
    for (const b of buttons) {
      const tokens = b.className.split(/\s+/);
      expect(tokens).toContain('bg-transparent');
      expect(tokens).not.toContain('bg-cs-link');
      expect(b).toHaveAttribute('type', 'button');
    }
    for (const name of ['시점', '편차 과장', '임계값']) {
      expect(screen.getByText(name).className).toBe('text-sm font-bold');
    }
  });

  // 변이: 슬라이더 범위·단계 오타, aria-valuetext 누락(보조 기술이 7mm 를 "70" 으로 읽는다)
  it('임계값 슬라이더: 10~300, 5 단계, aria-valuetext 는 mm 표기', () => {
    mount();
    const slider = screen.getByRole('slider', { name: '표시 임계값(mm)' }) as HTMLInputElement;
    expect(slider).toHaveAttribute('min', '10');
    expect(slider).toHaveAttribute('max', '300');
    expect(slider).toHaveAttribute('step', '5');
    expect(slider.value).toBe('70');
    expect(slider).toHaveAttribute('aria-valuetext', '±7 mm');
    expect(slider.className).toContain('accent-cs-link');
  });

  // 20 -> "2", 75 -> "7.5". 변이: HUD·고지 문구가 기본값에 고정됨
  it('슬라이더를 움직이면 HUD·고지 문구·aria-valuetext 의 숫자가 함께 바뀐다', () => {
    mount();
    const slider = screen.getByRole('slider', { name: '표시 임계값(mm)' });
    fireEvent.change(slider, { target: { value: '20' } });
    expect(screen.getByTestId('points3d-hud').textContent).toBe('축 비율 1:1 · 임계값 ±2 mm · 1,234점');
    const notice = screen.getByTestId('points3d-notice').textContent!;
    expect(notice).toContain('±2mm 이내');
    expect(notice).toContain('−2mm 미만');
    expect(notice).toContain('+2mm 초과');
    expect(notice).not.toContain('7mm');
    expect(slider).toHaveAttribute('aria-valuetext', '±2 mm');

    fireEvent.change(slider, { target: { value: '75' } });
    expect(screen.getByTestId('points3d-hud').textContent).toContain('임계값 ±7.5 mm');
    expect(slider).toHaveAttribute('aria-valuetext', '±7.5 mm');
  });

  // 63 은 5 의 배수가 아니다. 변이: 기본 임계값을 5 의 배수로 반올림(65 -> "6.5")
  it('격자 밖 기본값 63 은 그대로 쓴다: HUD·고지 문구·aria-valuetext 가 6.3', () => {
    mount({ defaultThresholdQ: 63 });
    expect(screen.getByTestId('points3d-hud').textContent).toBe('축 비율 1:1 · 임계값 ±6.3 mm · 1,234점');
    expect(screen.getByTestId('points3d-notice').textContent).toContain('±6.3mm 이내');
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '±6.3 mm');
  });

  // 변이: 문구 변경, U+2212 대신 ASCII 하이픈, 스팬 숫자·분류 비율 삽입
  it('고지 문구 전문(임계값만 동적)', () => {
    mount();
    const notice = screen.getByTestId('points3d-notice');
    expect(notice.textContent).toBe(NOTICE_7);
    expect(notice.className).toBe('text-xs leading-4 text-cs-text-secondary');
    expect(NOTICE_7).toContain(String.fromCharCode(0x2212) + '7mm');   // 음수 부호는 U+2212
    expect(NOTICE_7).not.toContain(String.fromCharCode(0x2014));      // U+2014 금지
  });

  // 변이: 병합 안내를 항상 그림 / 그리지 않음
  it('정합 병합 스캔일 때만 병합 안내 한 줄을 고지 문구 아래에 둔다', () => {
    const { rerender, onError } = mount();
    expect(screen.queryByTestId('points3d-merged-note')).toBeNull();
    rerender(<Points3dView data={SMALL} defaultThresholdQ={70} isRegistered onError={onError} />);
    const note = screen.getByTestId('points3d-merged-note');
    expect(note.textContent).toBe('정합 병합 스캔의 점은 원본 점이 아니라 5cm 격자 대표점입니다.');
    expect(screen.getByTestId('points3d-notice').compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  // 변이: 배경을 클래스로 줌, 밝은 배경 전환이 오버레이 색에 닿지 않음
  it('밝은 배경 버튼: 뷰어 영역 인라인 배경과 오버레이 색이 light 표로 바뀌고 다시 누르면 돌아온다', () => {
    mount();
    const viewport = screen.getByTestId('points3d-viewport');
    const button = screen.getByRole('button', { name: '밝은 배경' });
    expect(viewport).toHaveStyle({ backgroundColor: '#000000' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);
    expect(viewport).toHaveStyle({ backgroundColor: '#ffffff' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('points3d-legend')).toHaveStyle({ color: '#000716' });
    expect(screen.getByTestId('points3d-hud')).toHaveStyle({ color: '#000716' });
    expect(screen.getByTestId('points3d-hint')).toHaveStyle({ color: '#5f6b7a' });
    expect(screen.getByTestId('points3d-labels')).toHaveStyle({ color: '#5f6b7a' });
    expect(screen.getByTestId('points3d-legend').querySelector('[data-class="flat"]'))
      .toHaveStyle({ backgroundColor: '#1e9e50' });

    fireEvent.click(button);
    expect(viewport).toHaveStyle({ backgroundColor: '#000000' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  // 변이: 뷰어 영역 비율·틀 클래스 누락, 오버레이가 포인터를 가로챔(캔버스 드래그가 끊긴다)
  it('뷰어 영역은 4:3 틀이고 오버레이는 pointer-events-none 이다', () => {
    mount();
    const tokens = screen.getByTestId('points3d-viewport').className.split(/\s+/);
    for (const cls of ['relative', 'aspect-[4/3]', 'w-full', 'overflow-hidden', 'rounded-lg', 'border', 'border-cs-divider']) {
      expect(tokens).toContain(cls);
    }
    const overlays = [
      screen.getByTestId('points3d-legend'),
      screen.getByTestId('points3d-labels'),
      screen.getByTestId('points3d-hud').parentElement!,
    ];
    for (const el of overlays) expect(el.className.split(/\s+/)).toContain('pointer-events-none');
  });

  // 변이: tabIndex 누락(키 조작 불가), touch-action 누락(터치 드래그가 페이지를 스크롤)
  it('캔버스: role img, 이름, tabIndex 0, touch-action none, cs-link 포커스 외곽선', () => {
    const { canvas } = mount();
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas).toHaveAttribute('tabindex', '0');
    const tokens = canvas.className.split(/\s+/);
    expect(tokens).toContain('touch-none');
    expect(tokens).toContain('focus-visible:outline-2');
    expect(tokens).toContain('focus-visible:outline-cs-link');
  });

  // 변이: 뷰어 옆에 preview3d.png 를 함께 그림, 옛 팔레트 클래스·색 이름이 든 속성 사용
  it('PNG 를 함께 그리지 않고, DOM 에 옛 팔레트 부분 문자열이 없다', () => {
    const { container } = mount({ isRegistered: true });
    fireEvent.click(screen.getByRole('button', { name: '밝은 배경' }));
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-|green-|purple-/);
  });
});

describe('Points3dView 렌더러 연결', () => {
  // 변이: getContext 를 렌더 중에 부름(SSR 에서 터진다) / 마운트마다 여러 번 부름 / 연속 루프
  it('마운트에 getContext("webgl2") 를 한 번 부르고 첫 프레임에 n 개 전부를 그린다', () => {
    const { rec, getContext } = mount();
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext.mock.calls[0][0]).toBe('webgl2');
    expect(rec.pointDraws()).toEqual([]);   // 그리기는 rAF 에서
    expect(rafQueue).toHaveLength(1);
    frame(0);
    expect(rec.pointDraws()).toEqual([1234]);
    expect(rafQueue).toHaveLength(0);       // 연속 루프가 아니다
  });

  // 0.55 x 0.0125 = 0.006875. ALIASED_POINT_SIZE_RANGE 스텁 [1, 1024]
  it('점 크기 uniform: uPointWorldM = 0.55 x sample_cell_m, uMaxPx = 상한', () => {
    const { rec } = mount();
    frame(0);
    expect(lastUniform(rec, 'uPointWorldM')[0]).toBeCloseTo(0.006875, 9);
    expect(lastUniform(rec, 'uMaxPx')).toEqual([1024]);
  });

  // 점 크기 clamp 의 상한은 기기의 ALIASED_POINT_SIZE_RANGE 다(renderer.pointSizeLimit()). 이 uniform 이 그 상한이
  // GPU 에 닿는 유일한 경로다. 상한이 2 인 기기에서는 배율 2 의 최소 크기 1.5 x 2 = 3 도 2 로 묶인다(pointSizeRange).
  // 변이: 상한을 상수(1024)로 둠, pointSizeRange 에 기기 범위 대신 고정 범위를 넘김
  it('uMaxPx·uMinPx 는 기기의 점 크기 상한을 따른다: 상한 2 이면 둘 다 2', () => {
    stubSize(640, 480, 2);
    const rec = recordingGl({ pointSizeRange: [1, 2] });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(rec.gl as unknown as RenderingContext);
    render(<Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={vi.fn()} />);
    frame(0);
    expect(lastUniform(rec, 'uMaxPx')).toEqual([2]);
    expect(lastUniform(rec, 'uMinPx')).toEqual([2]);
  });

  // 변이: 초기 시점이 등각이 아님, 종횡비를 CSS 크기에서 구하지 않음
  it('초기 카메라는 fit_bounds 에 맞춘 등각 시점이다', () => {
    stubSize(640, 480, 1);
    const { rec } = mount();
    frame(0);
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(fitToBounds(FIT, 'iso'), 640 / 480, FULL));
  });

  // 변이: 과장 배율을 넘기지 않음, 상태가 바뀌어도 다시 그리지 않음
  it('과장 버튼을 누르면 uExag 만 바꿔 n 개 전부로 한 번 다시 그린다', () => {
    const { rec } = mount();
    frame(0);
    expect(lastUniform(rec, 'uExag')).toEqual([1]);
    fireEvent.click(screen.getByRole('button', { name: '×50' }));
    expect(rafQueue).toHaveLength(1);
    frame(16);
    expect(lastUniform(rec, 'uExag')).toEqual([50]);
    expect(rec.pointDraws()).toEqual([1234, 1234]);
    expect(rafQueue).toHaveLength(0);
  });

  // 변이: 임계값을 mm 로 바꿔 넘김(7), 기본값을 5 의 배수로 반올림(65)
  it('uThresholdQ 는 0.1mm 정수 그대로다: 기본값 63, 슬라이더 20', () => {
    const { rec } = mount({ defaultThresholdQ: 63 });
    frame(0);
    expect(lastUniform(rec, 'uThresholdQ')).toEqual([63]);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '20' } });
    frame(16);
    expect(lastUniform(rec, 'uThresholdQ')).toEqual([20]);
  });

  // #4cc96f = (76, 201, 111) / 255, #1e9e50 = (30, 158, 80) / 255
  // 변이: 밝은 배경 전환이 캔버스 색(clearColor·uniform)에 닿지 않음
  it('밝은 배경 버튼을 누르면 clearColor 와 점 색 uniform 이 light 표로 바뀐다', () => {
    const { rec } = mount();
    frame(0);
    expect(rec.callsOf('clearColor').at(-1)!.args).toEqual([0, 0, 0, 1]);
    const dark = lastUniform(rec, 'uColFlat');
    expect(dark[0]).toBeCloseTo(76 / 255, 6);
    expect(dark[1]).toBeCloseTo(201 / 255, 6);
    expect(dark[2]).toBeCloseTo(111 / 255, 6);

    fireEvent.click(screen.getByRole('button', { name: '밝은 배경' }));
    frame(16);
    expect(rec.callsOf('clearColor').at(-1)!.args).toEqual([1, 1, 1, 1]);
    const light = lastUniform(rec, 'uColFlat');
    expect(light[0]).toBeCloseTo(30 / 255, 6);
    expect(light[1]).toBeCloseTo(158 / 255, 6);
    expect(light[2]).toBeCloseTo(80 / 255, 6);
  });

  // fit 4m x 3m -> 눈금 간격 0.2m (20 + 15 + 2 = 37 <= 40). 눈금 "0.0" 이 두 축에 하나씩 있다
  // 변이: 축 라벨 층을 그리지 않음, 라벨 색을 글자색으로
  it('첫 프레임 뒤 축 라벨 층에 눈금 숫자와 축 이름을 보조 글자색으로 그린다', () => {
    stubSize(640, 480, 1);
    mount();
    expect(screen.getByTestId('points3d-labels').textContent).toBe('');
    frame(0);
    const layer = screen.getByTestId('points3d-labels');
    expect(layer).toHaveStyle({ color: '#9aa3ad' });
    expect(within(layer).getByText('x (m)')).toBeInTheDocument();
    expect(within(layer).getByText('y (m)')).toBeInTheDocument();
    expect(within(layer).getAllByText('0.0')).toHaveLength(2);
    // 두 "0.0" 은 같은 모서리(fit.min)에 놓인다. x 눈금은 아래로, y 눈금은 왼쪽으로 띄워야 한 글자로 겹치지 않는다
    // (띄우는 px 는 화면 캡처 대조에서 조정할 수 있어 값은 고정하지 않는다)
    const [xZero, yZero] = within(layer).getAllByText('0.0');
    expect(xZero.style.transform).not.toBe(yZero.style.transform);
  });

  // 변이: cleanup 누락(버퍼·프로그램 누수), dispose 가 loseContext 를 부름, 예약된 rAF 를 남김
  it('언마운트하면 렌더러를 dispose 하고 예약된 rAF 를 취소한다', () => {
    const { rec, unmount } = mount();
    expect(rafQueue).toHaveLength(1);
    unmount();
    expect(rec.callsOf('deleteProgram').length).toBeGreaterThan(0);
    expect(rec.callsOf('deleteBuffer').length).toBeGreaterThan(0);
    expect(rec.loseContextCalls()).toBe(0);
    expect(rafQueue).toHaveLength(0);
  });

  // React 개발 모드의 StrictMode 는 effect 를 실행 -> cleanup -> 다시 실행한다(같은 canvas 노드를 재사용).
  // 변이: cleanup 에서 rAF 를 취소하지 않음(두 번 그린다)
  it('StrictMode 의 effect 이중 실행에서도 한 번만 그린다', () => {
    const rec = recordingGl();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(rec.gl as unknown as RenderingContext);
    render(
      <StrictMode>
        <Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={vi.fn()} />
      </StrictMode>,
    );
    expect(getContext).toHaveBeenCalledTimes(2);
    expect(rafQueue).toHaveLength(1);
    frame(0);
    expect(rec.pointDraws()).toEqual([1234]);
    expect(rec.loseContextCalls()).toBe(0);
  });

  // 변이: onError 를 effect 의존성에 넣음(상위가 다시 그릴 때마다 렌더러를 다시 만든다)
  it('상위가 새 onError 함수로 다시 그려도 렌더러를 다시 만들지 않는다', () => {
    const { getContext, rerender } = mount();
    rerender(<Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={vi.fn()} />);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  // 변이: createRenderer 가 null 일 때 조용히 빈 캔버스를 둠, onError 중복 호출
  it('WebGL2 컨텍스트를 얻지 못하면 onError("webgl") 를 한 번 부르고 그리기를 예약하지 않는다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onError = vi.fn();
    const { rerender } = render(
      <Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={onError} />,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('webgl');
    expect(rafQueue).toHaveLength(0);
    rerender(<Points3dView data={SMALL} defaultThresholdQ={70} isRegistered onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: '×10' }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(rafQueue).toHaveLength(0);
  });

  // 변이: 마운트 수명에 한 번만 알리는 가드 제거(effect 이중 실행에서 두 번 알린다)
  it('StrictMode 의 effect 이중 실행에서도 onError("webgl") 는 한 번이다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onError = vi.fn();
    render(
      <StrictMode>
        <Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={onError} />
      </StrictMode>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('webgl');
  });
});

describe('Points3dView 픽셀 단위', () => {
  // 960 / (2 x tan(20도)) = 960 / 0.7279404685 = 1318.789. 최소 점 크기 1.5 x 2 = 3
  // 변이: pxPerUnit 에 CSS 높이(480 -> 659.394), 최소 크기에 배율 미적용(1.5)
  it('배율 2: 드로잉 버퍼 1280x960, uPxPerUnit 은 버퍼 높이 기준, uMinPx = 3', () => {
    stubSize(640, 480, 2);
    const { rec, canvas } = mount();
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(960);
    expect(rec.callsOf('viewport').at(-1)!.args).toEqual([0, 0, 1280, 960]);
    frame(0);
    expect(lastUniform(rec, 'uPxPerUnit')[0]).toBeCloseTo(1318.789, 2);
    expect(lastUniform(rec, 'uMinPx')).toEqual([3]);
    // 종횡비는 CSS 크기 기준 4:3 그대로다
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(fitToBounds(FIT, 'iso'), 640 / 480, FULL));
  });

  // 480 / 0.7279404685 = 659.394
  it('배율 1: 드로잉 버퍼 640x480, uPxPerUnit = 659.394, uMinPx = 1.5', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    expect([canvas.width, canvas.height]).toEqual([640, 480]);
    frame(0);
    expect(lastUniform(rec, 'uPxPerUnit')[0]).toBeCloseTo(659.394, 2);
    expect(lastUniform(rec, 'uMinPx')).toEqual([1.5]);
  });

  // 변이: min(devicePixelRatio, 2) 의 상한 제거(1920x1440)
  it('배율 3 은 2 로 묶는다', () => {
    stubSize(640, 480, 3);
    const { rec, canvas } = mount();
    expect([canvas.width, canvas.height]).toEqual([1280, 960]);
    frame(0);
    expect(lastUniform(rec, 'uMinPx')).toEqual([3]);
  });

  // jsdom 의 clientWidth·clientHeight 는 0 이다. 변이: 1 이상으로 묶지 않음(종횡비가 NaN)
  it('크기가 0 인 환경에서도 버퍼 1x1 로 그리고 행렬에 NaN 이 없다', () => {
    const { rec, canvas } = mount();
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
    frame(0);
    expect(lastUniform(rec, 'uViewProj').every(Number.isFinite)).toBe(true);
    expect(rec.pointDraws()).toEqual([1234]);
  });

  // 버퍼 크기를 바꾸면 캔버스가 지워진다. 변이: 다시 그리기를 다음 프레임으로 미룸(밝은 배경에서 검정이 번쩍인다),
  //       크기가 그대로인데도 버퍼를 다시 맞춤, ResizeObserver 를 방어 없이 씀(jsdom 에 없어 다른 테스트가 전부 던진다)
  it('ResizeObserver 가 있으면 크기 변화를 따라 버퍼를 다시 맞추고 그 자리에서 다시 그린다', () => {
    let notify: () => void = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify = cb; }
      observe = observe;
      disconnect = disconnect;
    });
    stubSize(640, 480, 1);
    const { rec, canvas, unmount } = mount();
    frame(0);
    expect(observe).toHaveBeenCalledWith(canvas);
    const viewports = rec.callsOf('viewport').length;
    act(() => { notify(); });                 // 관찰을 시작하면 브라우저가 한 번 알린다. 크기는 그대로다
    expect(rec.callsOf('viewport')).toHaveLength(viewports);
    expect(rec.pointDraws()).toEqual([1234]);

    stubSize(800, 600, 1);
    act(() => { notify(); });
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
    expect(rec.pointDraws()).toEqual([1234, 1234]);   // rAF 를 기다리지 않는다
    expect(rafQueue).toHaveLength(0);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('Points3dView 휠·포인터·키', () => {
  // 변이: 휠을 JSX onWheel 로 옮김(React 는 wheel 을 passive 로 등록해 preventDefault 가 무시된다)
  it('wheel 리스너를 캔버스에 { passive: false } 로 직접 붙이고 언마운트 때 뗀다', () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const { canvas, unmount } = mount();
    const wheelAdds = add.mock.calls.filter((c, i) => c[0] === 'wheel' && add.mock.contexts[i] === canvas);
    expect(wheelAdds).toHaveLength(1);
    expect(wheelAdds[0][2]).toEqual({ passive: false });
    const handler = wheelAdds[0][1];

    unmount();
    const wheelRemoves = remove.mock.calls.filter((c, i) => c[0] === 'wheel' && remove.mock.contexts[i] === canvas);
    expect(wheelRemoves).toHaveLength(1);
    expect(wheelRemoves[0][1]).toBe(handler);
  });

  // 변이: handler 가 handled 를 보지 않고 항상 preventDefault(일반 휠로 페이지가 스크롤되지 않는다)
  it('Ctrl+휠·Cmd+휠은 기본 동작을 막고, 일반 휠은 막지 않으며 다시 그리지도 않는다', () => {
    const { canvas } = mount();
    frame(0);
    expect(ctrlWheel(canvas).defaultPrevented).toBe(true);
    expect(ctrlWheel(canvas, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
    frame(16);
    frame(32);
    expect(rafQueue).toHaveLength(0);
    expect(ctrlWheel(canvas, { ctrlKey: false }).defaultPrevented).toBe(false);
    expect(rafQueue).toHaveLength(0);
  });

  // exp(-120 x 0.001) 배로 다가간다(controls 의 휠 줌 식). 변이: 휠 이벤트를 reducer 에 넘기지 않음
  it('Ctrl+휠이 카메라 줌으로 이어진다', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    frame(0);
    ctrlWheel(canvas, { deltaY: -120 });
    frame(16);
    const base = fitToBounds(FIT, 'iso');
    expectMatrix(lastUniform(rec, 'uViewProj'),
      viewProj({ ...base, distance: base.distance * Math.exp(-0.12) }, 640 / 480, FULL));
  });

  // 오른쪽으로 40px 끌면 방위가 0.2rad 줄어든다(orbit.rotate)
  // 변이: 포인터 좌표의 x·y 전치, down 을 reducer 에 넘기지 않음
  it('드래그가 카메라 회전으로 이어진다', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    frame(0);
    fireEvent.pointerDown(canvas, mouse(100, 100));
    fireEvent.pointerMove(canvas, mouse(140, 100));
    frame(16);
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(rotate(fitToBounds(FIT, 'iso'), 40, 0), 640 / 480, FULL));
  });

  // 팬의 m / px 환산은 CSS 높이(480) 기준이다. 변이: 버퍼 높이(960)를 넘김(절반만 움직인다), shiftKey 를 넘기지 않음(회전한다)
  it('Shift+드래그가 팬으로 이어지고 환산은 CSS 높이 기준이다', () => {
    stubSize(640, 480, 2);
    const { rec, canvas } = mount();
    frame(0);
    fireEvent.pointerDown(canvas, mouse(100, 100, { shiftKey: true }));
    fireEvent.pointerMove(canvas, mouse(140, 130, { shiftKey: true }));
    frame(16);
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(pan(fitToBounds(FIT, 'iso'), 40, 30, 480), 640 / 480, FULL));
  });

  // 변이: 시점 버튼이 각도만 바꾸고 맞춤을 다시 하지 않음(팬·줌이 남는다), 버튼과 프리셋 짝이 어긋남
  it('시점 버튼은 그 프리셋으로 맞춤을 다시 한다(회전·줌 초기화)', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    frame(0);
    fireEvent.pointerDown(canvas, mouse(100, 100));
    fireEvent.pointerMove(canvas, mouse(160, 130));
    fireEvent.pointerUp(canvas, mouse(160, 130));
    ctrlWheel(canvas, { deltaY: 300 });
    frame(16);
    for (const [name, preset] of [['평면', 'top'], ['정면', 'front'], ['등각', 'iso']] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      frame(32);
      expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(fitToBounds(FIT, preset), 640 / 480, FULL));
    }
  });

  // 변이: 화살표 키에서 preventDefault 누락(페이지가 스크롤된다), 수식키가 눌린 키도 가로챔(브라우저 단축키가 죽는다)
  it('화살표 키는 기본 동작을 막고, Ctrl·Cmd·Alt 가 눌린 키와 그 밖의 키는 건드리지 않는다', () => {
    const { canvas } = mount();
    frame(0);
    // fireEvent 는 preventDefault 가 불리면 false 를 돌려준다
    expect(fireEvent.keyDown(canvas, { key: 'ArrowLeft' })).toBe(false);
    expect(rafQueue).toHaveLength(1);
    frame(16);
    frame(32);
    act(() => { vi.advanceTimersByTime(200); });
    frame(48);
    expect(rafQueue).toHaveLength(0);

    expect(fireEvent.keyDown(canvas, { key: 'ArrowLeft', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: '+', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: 'ArrowUp', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: 'ArrowDown', altKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: 'a' })).toBe(true);
    expect(rafQueue).toHaveLength(0);        // 카메라가 변하지 않았다
    expect(vi.getTimerCount()).toBe(0);

    expect(fireEvent.keyDown(canvas, { key: '+' })).toBe(true);   // 줌은 하지만 기본 동작은 막지 않는다
    expect(rafQueue).toHaveLength(1);
  });

  // 왼쪽 화살표 = 왼쪽으로 20px 끈 것(방위 +0.1rad). 변이: 키 이벤트를 reducer 에 넘기지 않음
  it('화살표 키가 카메라 회전으로 이어진다', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    frame(0);
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    frame(16);
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(rotate(fitToBounds(FIT, 'iso'), -20, 0), 640 / 480, FULL));
  });

  // 변이: contextmenu 를 막지 않음(오른쪽 버튼 드래그 팬에서 메뉴가 뜬다)
  it('contextmenu 를 막는다', () => {
    const { canvas } = mount();
    expect(fireEvent.contextMenu(canvas)).toBe(false);
  });

  // 변이: setPointerCapture 를 방어 없이 부름(jsdom 에 없어 던진다) / 부르지 않음(캔버스 밖에서 놓으면 드래그가 끝나지 않는다)
  it('pointerdown 에서 setPointerCapture 가 있으면 부른다', () => {
    const { canvas } = mount();
    expect(() => fireEvent.pointerDown(canvas, mouse(10, 10))).not.toThrow();
    fireEvent.pointerUp(canvas, mouse(10, 10));
    const capture = vi.fn();
    (canvas as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = capture;
    fireEvent.pointerDown(canvas, mouse(10, 10, { pointerId: 7 }));
    expect(capture).toHaveBeenCalledWith(7);
  });
});

describe('Points3dView LOD', () => {
  const BIG = scatter(200_000);   // 조작 중 시작 점 수 = min(200,000, 150,000) = 150,000

  function mountBig() {
    stubSize(640, 480, 1);
    const m = mount({ data: BIG });
    frame(0);                     // 첫 그리기: 조작 중이 아니므로 n 개 전부
    expect(m.rec.pointDraws()).toEqual([200_000]);
    return m;
  }
  let moveX = 100;
  const drag = (canvas: HTMLCanvasElement) => { moveX += 10; fireEvent.pointerMove(canvas, mouse(moveX, 100)); };
  beforeEach(() => { moveX = 100; });

  // 변이: 조작 중에도 n 개 전부 그림, HUD 의 점 수를 그리는 점 수로 바꿈
  it('드래그 중에는 앞 150,000 점만 그리고 HUD 의 점 수는 n 그대로다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    expect(lastPointDraw(rec)).toBe(150_000);
    expect(screen.getByTestId('points3d-hud').textContent).toBe('축 비율 1:1 · 임계값 ±7 mm · 200,000점');
  });

  // 변이: 조작 종료 뒤의 전체 그리기 제거(LOD 표본만 화면에 남는다)
  it('pointerup 뒤 마지막 그리기는 n 개 전부이고 그 뒤 rAF 가 끊긴다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    fireEvent.pointerUp(canvas, mouse(110, 100));
    frame(1016);
    expect(rec.pointDraws()).toEqual([200_000, 150_000, 200_000]);
    expect(rafQueue).toHaveLength(0);         // 전체 그리기 뒤에는 측정용 콜백을 예약하지 않는다
  });

  // 변이: pointercancel 을 조작 종료로 보지 않음
  it('pointercancel 도 조작 종료다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    fireEvent.pointerCancel(canvas, mouse(110, 100));
    frame(1016);
    expect(lastPointDraw(rec)).toBe(200_000);
  });

  // 변이: 휠 뒤 전체 그리기를 하지 않음, 200ms 를 기다리지 않음, 입력이 이어져도 타이머를 다시 세지 않음
  it('Ctrl+휠: 조작 중 LOD 로 그리고, 마지막 입력 뒤 200ms 가 지나면 n 개 전부를 그린다', () => {
    const { rec, canvas } = mountBig();
    ctrlWheel(canvas);
    frame(1000);
    expect(lastPointDraw(rec)).toBe(150_000);
    frame(1025);                              // 측정용 콜백(25ms: 그대로). 그릴 것이 없어 그리지 않는다
    expect(rec.pointDraws()).toEqual([200_000, 150_000]);
    expect(rafQueue).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(150); });
    ctrlWheel(canvas);                        // 입력이 이어지면 200ms 를 다시 센다
    frame(1200);
    frame(1225);
    act(() => { vi.advanceTimersByTime(199); });
    expect(rafQueue).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(rafQueue).toHaveLength(1);
    frame(1500);
    expect(rec.pointDraws()).toEqual([200_000, 150_000, 150_000, 200_000]);
    expect(rafQueue).toHaveLength(0);
  });

  it('키 조작(+)도 200ms 뒤 n 개 전부를 그린다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.keyDown(canvas, { key: '+' });
    frame(1000);
    expect(lastPointDraw(rec)).toBe(150_000);
    frame(1025);
    act(() => { vi.advanceTimersByTime(200); });
    frame(1300);
    expect(lastPointDraw(rec)).toBe(200_000);
  });

  // 150,000 x 0.7 = 105,000. 변이: 측정 결과를 적용하지 않음, 측정용 콜백이 요청 없이도 다시 그림(연속 루프)
  it('그린 콜백과 다음 rAF 사이가 40ms 면 다음 조작 그리기의 점 수가 x0.7 로 준다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);                              // 150,000 점을 그리고 측정용 콜백을 예약한다
    expect(rafQueue).toHaveLength(1);
    frame(1040);                              // frameMs = 40 > 33
    expect(rec.pointDraws()).toEqual([200_000, 150_000]);   // 측정용 콜백은 그리지 않는다
    expect(rafQueue).toHaveLength(0);         // 조작이 멈추면 한 프레임 뒤에 rAF 가 끊긴다
    drag(canvas);
    frame(1100);
    expect(lastPointDraw(rec)).toBe(105_000);
  });

  // 150,000 x 1.25 = 187,500
  it('사이가 10ms 면 x1.25 로 는다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    frame(1010);
    drag(canvas);
    frame(1100);
    expect(lastPointDraw(rec)).toBe(187_500);
  });

  // 변이: frameMs 를 입력 이벤트(또는 그리기) 사이의 간격으로 잼. 천천히 끌기만 해도 점 수가 준다
  it('입력 사이를 500ms 띄우는 것만으로는 점 수가 줄지 않는다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    let t = 1000;
    for (let i = 0; i < 3; i++) {
      drag(canvas);
      frame(t);                               // 그린다
      frame(t + 25);                          // 측정용 콜백: 25ms 는 20~33 사이라 그대로
      t += 500;                               // 다음 입력까지 500ms
    }
    expect(rec.pointDraws()).toEqual([200_000, 150_000, 150_000, 150_000]);
  });

  // 변이: 조작이 새로 시작될 때 점 수를 시작 값으로 되돌림(느린 기기에서 조작마다 처음 몇 프레임이 다시 버벅인다)
  it('새 조작은 직전 조작의 마지막 점 수를 잇는다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    frame(1040);                              // 105,000 으로 준다
    fireEvent.pointerUp(canvas, mouse(110, 100));
    frame(1100);
    expect(lastPointDraw(rec)).toBe(200_000);

    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(2000);
    expect(lastPointDraw(rec)).toBe(105_000);
  });

  // 측정용 콜백 때 그리기 요청이 있으면 그 콜백이 그리고 다시 측정용 콜백을 예약한다
  // 150,000 -> x0.7 = 105,000 -> x0.7 = 73,500
  it('연속 드래그: 측정용 콜백이 조정한 점 수로 곧바로 그린다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    drag(canvas);
    frame(1040);
    drag(canvas);
    frame(1080);
    expect(rec.pointDraws()).toEqual([200_000, 150_000, 105_000, 73_500]);
    expect(rafQueue).toHaveLength(1);
  });

  // 변이: 임계값·과장 변경을 조작으로 취급해 LOD 로 그림
  it('슬라이더·과장 변경은 n 개 전부로 한 번 그린다', () => {
    const { rec } = mountBig();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '20' } });
    frame(1000);
    fireEvent.click(screen.getByRole('button', { name: '×100' }));
    frame(1016);
    expect(rec.pointDraws()).toEqual([200_000, 200_000, 200_000]);
    expect(rafQueue).toHaveLength(0);
  });

  // 변이: cleanup 에서 조작 종료 타이머를 지우지 않음(언마운트 뒤에 그리기를 예약한다)
  it('언마운트하면 조작 종료 타이머와 예약된 rAF 를 지운다', () => {
    const { canvas, unmount } = mountBig();
    ctrlWheel(canvas);
    expect(rafQueue).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(rafQueue).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Points3dView 읽기 창', () => {
  // 캔버스가 뷰포트의 (100, 50) 에 있다고 스텁한다. 커서 좌표에서 이 원점을 빼야 캔버스 안 좌표가 된다
  const RECT = { left: 100, top: 50, width: 640, height: 480, right: 740, bottom: 530, x: 100, y: 50, toJSON: () => ({}) };

  function mountReadout(over: Partial<Props> = {}) {
    stubSize(640, 480, 1);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(RECT as DOMRect);
    const m = mount({ data: READOUT_DATA, ...over });
    frame(0);
    return m;
  }
  /** 등각 시점에서 월드 점의 화면 위치(캔버스 왼쪽 위 기준 CSS px) */
  const isoAt = (p: [number, number, number]) => project(
    viewProj(fitToBounds(READOUT_FIT, 'iso'), 640 / 480, FULL), p, 640, 480)!;
  /** 캔버스 안 좌표 -> 포인터 이벤트 좌표(clientX·clientY 는 뷰포트 기준이라 캔버스 원점을 더한다) */
  const at = (p: { x: number; y: number }, more: object = {}) => mouse(RECT.left + p.x, RECT.top + p.y, more);
  const lines = () => Array.from(screen.getByTestId('points3d-readout').children).map((c) => c.textContent);

  // P0: 절대 좌표 = origin + local = (254012.5 + 0.8, 4180045.25 + 1.0, 31.5 + 0), dev 32 -> +3.2mm, |32| <= 70 -> FLAT
  // 변이: 커서 좌표에서 캔버스 원점을 빼지 않음(100px·50px 어긋나 점을 못 찾는다), 프레임을 기다리지 않고 곧바로 찾음
  it('마우스가 점 위에 오면 다음 프레임에 readoutLines 의 줄을 그린다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at(p));
    expect(screen.queryByTestId('points3d-readout')).toBeNull();   // 한 프레임에 한 번: rAF 에서 찾는다
    frame(16);
    expect(lines()).toEqual(['X 254013.300 m', 'Y 4180046.250 m', 'Z 31.500 m', '편차 +3.2 mm', 'FLAT']);
    const box = screen.getByTestId('points3d-readout');
    for (const cls of ['font-mono', 'tabular-nums', 'pointer-events-none']) expect(box.className).toContain(cls);
    // 커서 오른쪽 아래 12px
    expect(parseFloat(box.style.left)).toBeCloseTo(p.x + 12, 3);
    expect(parseFloat(box.style.top)).toBeCloseTo(p.y + 12, 3);
    // 배경 #000000 알파 0.8, 테두리는 축선과 같은 #ffffff 알파 0.28, 글자 #f2f4f7
    expect(box).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.8)', borderColor: 'rgba(255, 255, 255, 0.28)', color: '#f2f4f7',
    });
    expect(rafQueue).toHaveLength(0);
  });

  // P1: (254012.5 + 3.2, 4180045.25 + 2.0, 31.5), 센티널 -> 4줄
  it('편차 없는 점은 4줄이고 마지막 줄이 "편차 없음" 이다', () => {
    const { canvas } = mountReadout();
    fireEvent.pointerMove(canvas, at(isoAt(P1)));
    frame(16);
    expect(lines()).toEqual(['X 254015.700 m', 'Y 4180047.250 m', 'Z 31.500 m', '편차 없음']);
  });

  // 변이: 읽기 창 반경 밖에서도 가장 가까운 점을 띄움
  it('12px 보다 먼 곳에서는 띄우지 않는다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at({ x: p.x + 20, y: p.y }));
    frame(16);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
  });

  // 변이: 터치 입력에서도 읽기 창 표시
  it('터치 입력에서는 띄우지 않고, 펜 입력에서는 띄운다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at(p, { pointerType: 'touch' }));
    frame(16);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
    fireEvent.pointerMove(canvas, at(p, { pointerType: 'pen' }));
    frame(32);
    expect(screen.getByTestId('points3d-readout')).toBeInTheDocument();
  });

  // 변이: 드래그 중에도 점을 찾음, pointerdown 에서 숨기지 않음
  it('드래그 중에는 띄우지 않고, 보이던 읽기 창은 pointerdown 에서 숨긴다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at(p));
    frame(16);
    expect(screen.getByTestId('points3d-readout')).toBeInTheDocument();
    fireEvent.pointerDown(canvas, at(p));
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
    fireEvent.pointerMove(canvas, at(p));     // 이동량 0: 카메라는 그대로, 커서는 점 위
    frame(32);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
  });

  // 변이: 커서가 영역을 벗어나도 읽기 창이 남음
  it('pointerleave 에서 숨기고, 예약된 탐색도 취소한다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at(p));
    frame(16);
    fireEvent.pointerLeave(canvas);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
    fireEvent.pointerMove(canvas, at(p));
    fireEvent.pointerLeave(canvas);
    frame(32);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
  });

  // dev 32: 임계값 70 에서는 FLAT, 30 에서는 32 > 30 이라 PROTRUSION
  // 변이: 읽기 창 분류를 기본 임계값으로 고정
  it('분류 이름은 현재 임계값 기준이다', () => {
    const { canvas } = mountReadout();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } });
    frame(8);
    fireEvent.pointerMove(canvas, at(isoAt(P0)));
    frame(16);
    expect(lines()).toEqual(['X 254013.300 m', 'Y 4180046.250 m', 'Z 31.500 m', '편차 +3.2 mm', 'PROTRUSION']);
  });

  // 평면 시점: 화면 오른쪽이 +x, 위가 +y. fit 중심 (2, 1.5) 가 화면 중앙 (320, 240) 이다.
  //   P1 (3.2, 2.0): 중앙에서 오른쪽 위 -> x 가 640 - 12 - 160 = 468 을 넘는다 -> 가로만 뒤집는다
  //   P2 (2.0, 0.6): 중앙 아래 -> y 가 480 - 12 - 100 = 368 을 넘는다 -> 세로만 뒤집는다
  // 변이: 뒤집기 제거(읽기 창이 영역 밖으로 잘린다), 가로·세로 판정 전치
  it('영역을 넘으면 넘는 축만 반대쪽으로 뒤집는다', () => {
    const { canvas } = mountReadout();
    fireEvent.click(screen.getByRole('button', { name: '평면' }));
    frame(8);
    const vp = viewProj(fitToBounds(READOUT_FIT, 'top'), 640 / 480, FULL);

    const p1 = project(vp, P1, 640, 480)!;
    expect(p1.x).toBeGreaterThan(468);
    expect(p1.y).toBeLessThan(368);
    fireEvent.pointerMove(canvas, at(p1));
    frame(16);
    let box = screen.getByTestId('points3d-readout');
    expect(box.style.left).toBe('');
    expect(parseFloat(box.style.right)).toBeCloseTo(640 - p1.x + 12, 3);
    expect(parseFloat(box.style.top)).toBeCloseTo(p1.y + 12, 3);
    expect(box.style.bottom).toBe('');

    const p2 = project(vp, P2, 640, 480)!;
    expect(p2.x).toBeLessThan(468);
    expect(p2.y).toBeGreaterThan(368);
    fireEvent.pointerMove(canvas, at(p2));
    frame(32);
    box = screen.getByTestId('points3d-readout');
    expect(lines()[3]).toBe('편차 −10.5 mm');
    expect(parseFloat(box.style.left)).toBeCloseTo(p2.x + 12, 3);
    expect(box.style.right).toBe('');
    expect(box.style.top).toBe('');
    expect(parseFloat(box.style.bottom)).toBeCloseTo(480 - p2.y + 12, 3);
  });

  // 변이: 휠 줌 뒤 옛 점의 읽기 창이 남음(커서 아래의 점이 바뀌었는데 내용이 그대로다)
  it('휠 줌이 시작되면 숨기고, 조작이 끝난 뒤의 그리기에서 같은 커서로 다시 찾는다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at(p));
    frame(16);
    expect(screen.getByTestId('points3d-readout')).toBeInTheDocument();
    ctrlWheel(canvas, { deltaY: -400 });      // 다가간다: P0 이 커서에서 멀어진다
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
    frame(32);
    frame(57);
    act(() => { vi.advanceTimersByTime(200); });
    frame(300);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();   // 커서 아래에 이제 점이 없다

    // 시점을 되돌리면(등각 버튼) 같은 커서 위치에 P0 이 다시 온다
    fireEvent.click(screen.getByRole('button', { name: '등각' }));
    frame(316);
    expect(lines()[3]).toBe('편차 +3.2 mm');
  });

  // 밝은 배경: 읽기 창 배경 #ffffff 알파 0.9, 테두리 #000716 알파 0.28, 글자 #000716
  it('밝은 배경에서는 읽기 창 색도 light 표를 쓴다', () => {
    const { canvas } = mountReadout();
    fireEvent.click(screen.getByRole('button', { name: '밝은 배경' }));
    frame(8);
    fireEvent.pointerMove(canvas, at(isoAt(P0)));
    frame(16);
    expect(screen.getByTestId('points3d-readout')).toHaveStyle({
      backgroundColor: 'rgba(255, 255, 255, 0.9)', borderColor: 'rgba(0, 7, 22, 0.28)', color: '#000716',
    });
  });
});

describe('Points3dView 컨텍스트 처리', () => {
  const lose = (canvas: HTMLCanvasElement) => act(() => {
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });

  // 변이: 손실 때 캔버스를 언마운트함(복구 이벤트를 못 받는다), 복구 뒤 로딩 틀이 남음, 복구 뒤 다시 그리지 않음
  it('손실 뒤 로딩 틀이 캔버스 위에 겹치고(캔버스 유지), 복구되면 걷히고 다시 그린다', () => {
    const { rec, canvas, onError } = mount();
    frame(0);
    expect(screen.queryByTestId('points3d-loading')).toBeNull();

    lose(canvas);
    const viewport = screen.getByTestId('points3d-viewport');
    const loading = within(viewport).getByTestId('points3d-loading');
    expect(loading).toHaveStyle({ backgroundColor: '#000000' });
    expect(loading.parentElement!.className).toBe('absolute inset-0');
    expect(screen.getByRole('img', { name: '3D 점군 뷰어' })).toBe(canvas);   // 같은 노드가 마운트된 채다
    expect(canvas.compareDocumentPosition(loading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { canvas.dispatchEvent(new Event('webglcontextrestored')); });
    expect(screen.queryByTestId('points3d-loading')).toBeNull();
    frame(16);
    expect(rec.pointDraws()).toEqual([1234, 1234]);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onError).not.toHaveBeenCalled();
  });

  // 변이: 손실 중 로딩 틀이 항상 검정
  it('밝은 배경에서 손실되면 로딩 틀도 밝은 배경이다', () => {
    const { canvas } = mount();
    fireEvent.click(screen.getByRole('button', { name: '밝은 배경' }));
    lose(canvas);
    expect(screen.getByTestId('points3d-loading')).toHaveStyle({ backgroundColor: '#ffffff' });
  });

  // 변이: 3,000ms 미복구를 알리지 않음(로딩 틀이 영원히 남는다), 'webgl' 로 알림, onError 중복 호출
  it('3,000ms 안에 복구되지 않으면 onError("context") 를 한 번 부른다', () => {
    const { canvas, onError } = mount();
    frame(0);
    lose(canvas);
    act(() => { vi.advanceTimersByTime(2999); });
    expect(onError).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('context');
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  // 읽기 창과 로딩 틀까지 뜬 상태의 DOM 전체를 본다(스펙 §7.13 의 6번)
  // 변이: 색 이름이 든 클래스·속성 이름 사용
  it('읽기 창과 로딩 틀이 떠 있어도 DOM 에 옛 팔레트 부분 문자열이 없다', () => {
    stubSize(640, 480, 1);
    const { container, canvas } = mount({ data: READOUT_DATA, isRegistered: true });
    frame(0);
    const p0 = project(viewProj(fitToBounds(READOUT_FIT, 'iso'), 640 / 480, FULL), P0, 640, 480)!;
    fireEvent.pointerMove(canvas, mouse(p0.x, p0.y));
    frame(16);
    expect(screen.getByTestId('points3d-readout')).toBeInTheDocument();
    lose(canvas);
    expect(screen.getByTestId('points3d-loading')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-|green-|purple-/);
  });
});

describe('Points3dView 입력 정규화', () => {
  // 브라우저는 pointerup 없이 포인터 캡처만 거두기도 한다(lostpointercapture). 그 포인터가 reducer 에 눌린 채 남으면
  // 다음 한 손가락 드래그가 두 포인터 제스처(중점 팬)로 읽힌다. lostpointercapture 는 그 포인터의 cancel 로 넘긴다.
  // 변이: lostpointercapture 를 reducer 에 넘기지 않음(다음 드래그가 회전이 아니라 팬이 된다)
  it('lostpointercapture 는 그 포인터의 cancel 이다: 다음 한 손가락 드래그가 회전으로 이어진다', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    frame(0);
    const touch = (id: number, x: number) => mouse(x, 100, { pointerId: id, pointerType: 'touch' });
    fireEvent.pointerDown(canvas, touch(3, 100));
    fireEvent.lostPointerCapture(canvas, touch(3, 100));
    fireEvent.pointerDown(canvas, touch(4, 100));
    fireEvent.pointerMove(canvas, touch(4, 140));
    frame(16);
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(rotate(fitToBounds(FIT, 'iso'), 40, 0), 640 / 480, FULL));
  });

  // deltaY 의 단위는 deltaMode 가 정한다(0 px, 1 줄, 2 쪽). 줄은 16px, 쪽은 캔버스 CSS 높이(480px)로 바꿔 넘긴다.
  //   줄 -3 = -48px -> distance x exp(-0.048). 이어서 쪽 -1 = -480px -> x exp(-0.48)
  // 변이: deltaMode 를 무시함(줄 단위로 알리는 마우스에서 Ctrl+휠 줌이 16배 느리다), 쪽에 버퍼 높이(960)를 씀
  it('휠 deltaY 는 deltaMode 에 따라 px 로 바꿔 넘긴다: 줄은 16px, 쪽은 캔버스 CSS 높이', () => {
    stubSize(640, 480, 2);
    const { rec, canvas } = mount();
    frame(0);
    const base = fitToBounds(FIT, 'iso');
    ctrlWheel(canvas, { deltaY: -3, deltaMode: WheelEvent.DOM_DELTA_LINE });
    frame(16);
    const lineZoomed = { ...base, distance: base.distance * Math.exp(-0.048) };
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(lineZoomed, 640 / 480, FULL));
    ctrlWheel(canvas, { deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
    frame(32);
    expectMatrix(lastUniform(rec, 'uViewProj'),
      viewProj({ ...lineZoomed, distance: lineZoomed.distance * Math.exp(-0.48) }, 640 / 480, FULL));
  });

  // 좌표가 비유한이면(합성 이벤트, 크기를 잃은 getBoundingClientRect 등) down·move 를 reducer 에 넘기지 않고 커서로도
  // 받지 않는다. NaN 이 카메라에 들어가면 행렬이 NaN 이 돼 화면이 비고, pickNearest 는 NaN 커서에도 점 하나를 돌려준다.
  // up 은 좌표를 쓰지 않으므로 좌표와 무관하게 넘긴다(무시하면 버튼을 뗀 뒤의 마우스 이동이 회전으로 읽힌다).
  // 변이: 좌표 검사 없음(읽기 창이 뜨고 행렬이 NaN), down 만 검사 없음(행렬이 NaN), up 까지 무시함(뗀 뒤 이동이 회전)
  it('비유한 좌표의 down·move 는 무시하고, up 은 좌표와 무관하게 포인터를 놓는다', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount({ data: READOUT_DATA });
    frame(0);
    const iso = viewProj(fitToBounds(READOUT_FIT, 'iso'), 640 / 480, FULL);
    const finite = { left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480, x: 0, y: 0, toJSON: () => ({}) };
    const broken = { ...finite, left: NaN, top: NaN, x: NaN, y: NaN };
    const rect = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect');

    rect.mockReturnValue(broken as DOMRect);
    fireEvent.pointerMove(canvas, mouse(100, 100));     // 지나가는 마우스: 커서로 받지 않아 읽기 창을 찾지 않는다
    frame(8);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
    fireEvent.pointerDown(canvas, mouse(100, 100));     // 눌린 포인터로 올리지 않는다
    rect.mockReturnValue(finite as DOMRect);
    fireEvent.pointerMove(canvas, mouse(140, 100));
    frame(16);
    expectMatrix(lastUniform(rec, 'uViewProj'), iso);  // NaN 위치에서 끈 회전이 없다

    fireEvent.pointerDown(canvas, mouse(100, 100));
    rect.mockReturnValue(broken as DOMRect);
    fireEvent.pointerUp(canvas, mouse(100, 100));
    rect.mockReturnValue(finite as DOMRect);
    fireEvent.pointerMove(canvas, mouse(140, 100));     // 버튼을 뗀 뒤의 이동은 회전이 아니다
    frame(32);
    expectMatrix(lastUniform(rec, 'uViewProj'), iso);
  });
});

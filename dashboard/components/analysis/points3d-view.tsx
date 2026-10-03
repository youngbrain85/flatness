// 3D 점군 1:1 뷰어(스펙 2026-10-02-pointcloud-viewer-design §7). 캔버스 + 오버레이(범례·HUD·조작 안내·축 라벨·읽기 창),
// 컨트롤 줄, 고지 문구를 그리고 DOM 입력을 순수 모듈(lib/viz/points3d)에 연결한다.
// - WebGL 은 gl-renderer.ts 만 만진다. 이 파일은 createRenderer 를 effect 안에서 부르고 cleanup 에서 dispose 한다.
// - 뷰어 색은 POINTS3D_THEME 의 hex 를 인라인 style 로만 쓴다(색 유틸리티 클래스 금지). 바깥 크롬은 cs 토큰 클래스.
// - 임계값은 점을 어느 색으로 칠할지만 정하는 표시용 값이다. 판정 등급을 만들지 않는다.
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { flushSync } from 'react-dom';
import {
  DEV_NO_DEVIATION, DEV_UNIT_MM, EXAGGERATIONS, POINTS3D_THEME, POINT_CLASS_LABEL, THRESHOLD_Q_MAX, THRESHOLD_Q_MIN,
  THRESHOLD_Q_STEP, fmtThresholdMm, hexToRgb01, readoutLines,
} from '@/lib/domain/points3d';
import type { PointClass, Points3dData, ThemeName } from '@/lib/domain/points3d';
import { FOVY, fitToBounds, viewProj } from '@/lib/viz/points3d/orbit';
import type { Bounds, OrbitState, ViewPreset } from '@/lib/viz/points3d/orbit';
import { buildScaffold, layoutLabels } from '@/lib/viz/points3d/scaffold';
import type { PlacedLabel } from '@/lib/viz/points3d/scaffold';
import {
  initialDragCount, nextDragCount, pointSizeRange, pointWorldSizeM, pxPerUnit,
} from '@/lib/viz/points3d/budget';
import { pickNearest } from '@/lib/viz/points3d/pick';
import { initialControlState, isGesturing, reduceControl } from '@/lib/viz/points3d/controls';
import type { ControlEvent } from '@/lib/viz/points3d/controls';
import { createRenderer } from '@/lib/viz/points3d/gl-renderer';
import type { Renderer } from '@/lib/viz/points3d/gl-renderer';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

const BUFFER_SCALE_MAX = 2;      // 드로잉 버퍼 배율 = min(devicePixelRatio, 2)
const INPUT_IDLE_MS = 200;       // 휠·키는 마지막 입력 뒤 이 시간이 지나면 조작이 끝난 것으로 본다
const WHEEL_LINE_PX = 16;        // 휠이 줄 단위(deltaMode 1)로 알릴 때 한 줄의 px
const READOUT_OFFSET_PX = 12;    // 읽기 창을 커서에서 띄우는 거리(CSS px)
const READOUT_BOX_W_PX = 160;    // 읽기 창의 어림 크기. 영역을 넘는지 판정해 반대쪽으로 뒤집는 데만 쓴다
const READOUT_BOX_H_PX = 100;

const LEGEND: PointClass[] = ['flat', 'depression', 'protrusion', 'none'];
const VIEW_PRESETS: { id: ViewPreset; label: string }[] = [
  { id: 'iso', label: '등각' },
  { id: 'top', label: '평면' },
  { id: 'front', label: '정면' },
];
// 선택 배경. Button 의 normal 변형이 가진 투명 배경 클래스와 특이도가 같은 클래스를 덧붙이면 가려진다.
// aria-pressed variant 는 속성 선택자가 붙어 특이도가 높다. 공용 Button 은 고치지 않는다.
const PRESSED = 'aria-pressed:bg-cs-info-bg';
const GROUP = 'flex flex-wrap items-center gap-2';
const GROUP_NAME = 'text-sm font-bold';
const NOTE = 'text-xs leading-4 text-cs-text-secondary';

// 축 라벨을 눈금 위치에서 축 바깥쪽으로 띄운다. 두 축의 0 눈금이 같은 모서리에 있어 축마다 방향을 달리한다.
// x 눈금은 아래로, y 눈금은 왼쪽으로. 축 이름은 눈금 숫자 한 줄만큼 더 바깥에 둔다.
const LABEL_TRANSFORM: Record<'x' | 'y', Record<'tick' | 'name', string>> = {
  x: { tick: 'translate(-50%, 4px)', name: 'translate(-50%, 22px)' },
  y: { tick: 'translate(calc(-100% - 6px), -50%)', name: 'translate(calc(-100% - 34px), -50%)' },
};

interface ViewSize { cssW: number; cssH: number; scale: number; bufW: number; bufH: number }
interface Cursor { x: number; y: number }
interface Readout { index: number; x: number; y: number; cssW: number; cssH: number }
interface ViewParams { thresholdQ: number; exaggeration: number; themeName: ThemeName }

// effect 안에서 만든 조작·그리기 루프를 JSX 핸들러가 부르는 창구
interface Engine {
  input(ev: ControlEvent): boolean;       // reducer 에 넘기고, 기본 동작을 막아야 하면 true
  hover(cursor: Cursor | null): void;     // 읽기 창용 커서 위치(null = 숨김)
  setPreset(preset: ViewPreset): void;    // 시점 버튼: 각도를 바꾸고 맞춤을 다시 한다
  requestDraw(): void;
}

// 캔버스의 CSS 크기와 드로잉 버퍼 크기. jsdom 처럼 크기가 0 인 환경에서도 0 나눗셈이 없도록 1 이상으로 둔다.
function measure(canvas: HTMLCanvasElement): ViewSize {
  const scale = Math.min(window.devicePixelRatio || 1, BUFFER_SCALE_MAX);
  const cssW = Math.max(1, canvas.clientWidth);
  const cssH = Math.max(1, canvas.clientHeight);
  return {
    cssW, cssH, scale,
    bufW: Math.max(1, Math.round(cssW * scale)),
    bufH: Math.max(1, Math.round(cssH * scale)),
  };
}

function sameCamera(a: OrbitState, b: OrbitState): boolean {
  return a === b || (a.distance === b.distance && a.azimuth === b.azimuth && a.elevation === b.elevation
    && a.target[0] === b.target[0] && a.target[1] === b.target[1] && a.target[2] === b.target[2]);
}

// 편차 있는 점의 |dev| 최댓값(m). 두 센티널(편차 없는 점)은 과장하지 않으므로 뺀다. 편차 있는 점이 없으면 0
function maxAbsDevMeters(dev: Int16Array): number {
  let q = 0;
  for (let i = 0; i < dev.length; i++) {
    const d = dev[i];
    if (d > DEV_NO_DEVIATION && Math.abs(d) > q) q = Math.abs(d);
  }
  return (q * DEV_UNIT_MM) / 1000;   // 0.1mm 정수 -> mm -> m
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb01(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

// 읽기 창 위치: 커서 오른쪽 아래. 영역을 넘으면 그 축만 반대쪽에 붙인다.
function readoutPosition(r: Readout): { left?: number; right?: number; top?: number; bottom?: number } {
  const flipX = r.x + READOUT_OFFSET_PX + READOUT_BOX_W_PX > r.cssW;
  const flipY = r.y + READOUT_OFFSET_PX + READOUT_BOX_H_PX > r.cssH;
  return {
    ...(flipX ? { right: r.cssW - r.x + READOUT_OFFSET_PX } : { left: r.x + READOUT_OFFSET_PX }),
    ...(flipY ? { bottom: r.cssH - r.y + READOUT_OFFSET_PX } : { top: r.y + READOUT_OFFSET_PX }),
  };
}

// 캔버스 왼쪽 위 기준 CSS px. 비유한 값(합성 이벤트, 크기를 잃은 rect 등)이면 null 이다. NaN 을 reducer 에 넘기지 않는다
function pointerXY(e: PointerEvent<HTMLCanvasElement>): Cursor | null {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// 로딩 틀. 뷰어 영역과 같은 크기·같은 배경이라 탭에 들어올 때 틀 색이 바뀌는 번쩍임이 없다.
// 공용 Spinner 의 회전 호가 검정 위에서 보이지 않아 흰 칩 안에 넣는다(칩의 흰색은 그림의 색이 아니라 Spinner 의 바탕).
export function Points3dLoadingFrame({ theme }: { theme: ThemeName }) {
  const t = POINTS3D_THEME[theme];
  return (
    <div data-testid="points3d-loading"
      className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-lg border border-cs-divider"
      style={{ backgroundColor: t.background, color: t.text }}>
      <span className="inline-flex rounded-full bg-white p-2"><Spinner /></span>
      <p className="text-sm">3D 점군 데이터를 불러오는 중입니다.</p>
    </div>
  );
}

export function Points3dView({ data, defaultThresholdQ, isRegistered, onError }: {
  data: Points3dData;
  defaultThresholdQ: number;          // 엔진이 준 표시 임계값(0.1mm 정수, 10~300). 5의 배수로 맞추지 않는다
  isRegistered: boolean;              // 정합 병합 스캔인가
  onError(kind: 'webgl' | 'context'): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const onErrorRef = useRef(onError);
  const reportedRef = useRef(false);   // onError 는 마운트 수명에 한 번만 알린다
  const dragCountRef = useRef(0);      // 조작 중 그릴 점 수(LOD). 조작이 새로 시작돼도 되돌리지 않는다
  const [thresholdQ, setThresholdQ] = useState(defaultThresholdQ);
  const [exaggeration, setExaggeration] = useState<number>(EXAGGERATIONS[0]);
  const [themeName, setThemeName] = useState<ThemeName>('dark');
  const [labels, setLabels] = useState<PlacedLabel[]>([]);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [restoring, setRestoring] = useState(false);   // 컨텍스트 손실 뒤 복구를 기다리는 중
  const viewRef = useRef<ViewParams>({ thresholdQ: defaultThresholdQ, exaggeration: EXAGGERATIONS[0], themeName: 'dark' });

  const scaffold = useMemo(() => buildScaffold(data.meta.fit_bounds), [data]);

  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // 렌더러와 조작·그리기 루프. getContext 는 이 effect 안(createRenderer)에서만 불린다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const report = (kind: 'webgl' | 'context') => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      onErrorRef.current(kind);
    };
    const created = createRenderer(canvas, {
      lost: () => setRestoring(true),
      restored: () => { setRestoring(false); requestDraw(); },
      unrecoverable: () => report('context'),
    });
    if (!created) { report('webgl'); return; }
    const renderer: Renderer = created;

    const n = data.meta.n_points;
    const fit = data.meta.fit_bounds;
    const extent = data.meta.extent_m;
    const maxAbsDevM = maxAbsDevMeters(data.dev);   // 데이터를 받을 때 한 번 잰다
    const pointWorldM = pointWorldSizeM(data.meta.sample_cell_m);
    let control = initialControlState(fitToBounds(fit, 'iso'));
    let size = measure(canvas);
    renderer.resize(size.bufW, size.bufH);
    let lastViewProj: Float32Array | null = null;
    let cursor: Cursor | null = null;
    let rafId: number | null = null;
    let drawWanted = false;
    let pickWanted = false;
    let measureFrom: number | null = null;   // 조작 중에 그린 콜백의 타임스탬프. 바로 다음 콜백이 frameMs 를 잰다
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    dragCountRef.current = initialDragCount(n);

    function interacting(): boolean {
      return isGesturing(control) || idleTimer !== null;
    }
    function ensureFrame() {
      if (rafId === null) rafId = requestAnimationFrame(frame);
    }
    function requestDraw() {
      drawWanted = true;
      ensureFrame();
    }
    function draw(count: number) {
      const v = viewRef.current;
      // 표시 높이는 z + dev x (k - 1) 이다. 과장한 점이 near/far 밖으로 잘리지 않도록 near/far 를 정하는 범위의 z 를
      // max|dev| x (k - 1) 만큼 위아래로 넓힌다. k = 1 이면 [0, 0, 0] ~ extent 그대로다
      const pad = maxAbsDevM * (v.exaggeration - 1);
      const full: Bounds = { min: [0, 0, -pad], max: [extent[0], extent[1], extent[2] + pad] };
      const vp = viewProj(control.camera, size.cssW / size.cssH, full);
      // gl_PointSize 는 드로잉 버퍼 px 이다. 환산 계수에 CSS 높이가 아니라 버퍼 높이를 넘긴다
      const [minPx, maxPx] = pointSizeRange(renderer.pointSizeLimit(), size.scale);
      renderer.draw({
        viewProj: vp, exaggeration: v.exaggeration, thresholdQ: v.thresholdQ,
        pointWorldM, pxPerUnit: pxPerUnit(size.bufH, FOVY), minPx, maxPx,
        drawCount: count, theme: POINTS3D_THEME[v.themeName],
      });
      lastViewProj = vp;
      // 라벨은 DOM 이다. 같은 프레임에 캔버스와 함께 바뀌도록 곧바로 반영한다(미루면 회전 중에 격자보다 한 프레임 늦는다)
      flushSync(() => setLabels(layoutLabels(scaffold.ticks, vp, size.cssW, size.cssH)));
    }
    function pick() {
      if (cursor === null || lastViewProj === null) return;
      const i = pickNearest(data, lastViewProj, viewRef.current.exaggeration,
        size.cssW, size.cssH, cursor.x, cursor.y);
      setReadout(i === null ? null : { index: i, x: cursor.x, y: cursor.y, cssW: size.cssW, cssH: size.cssH });
    }
    // 연속 루프가 아니다. 그리기·읽기 창 요청이 있을 때만 한 번 돌고,
    // 조작 중에 그렸을 때만 다음 프레임 간격을 재려고 콜백을 하나 더 예약한다(측정용 콜백).
    function frame(ts: number) {
      rafId = null;
      if (measureFrom !== null) {
        // frameMs = 조작 중에 그린 콜백과 바로 다음 콜백의 타임스탬프 차. 입력 이벤트 사이의 간격이 아니다
        dragCountRef.current = nextDragCount(dragCountRef.current, n, ts - measureFrom);
        measureFrom = null;
      }
      const busy = interacting();
      let drew = false;
      if (drawWanted) {
        drawWanted = false;
        draw(busy ? dragCountRef.current : n);   // 조작이 끝났으면 n 개 전부
        drew = true;
        if (busy) { measureFrom = ts; ensureFrame(); }
      }
      // 읽기 창: 한 프레임에 한 번, 조작 중에는 찾지 않는다. 카메라가 바뀐 뒤의 그리기에서는 같은 커서로 다시 찾는다
      if (!busy && cursor !== null && (pickWanted || drew)) pick();
      pickWanted = false;
    }
    function armIdle() {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { idleTimer = null; requestDraw(); }, INPUT_IDLE_MS);
    }
    function input(ev: ControlEvent): boolean {
      const before = control.camera;
      const { state, handled } = reduceControl(control, ev, size.cssH);
      control = state;
      if (!sameCamera(before, state.camera)) {
        if (ev.type === 'wheel' || ev.type === 'key') armIdle();
        setReadout(null);
        requestDraw();
      }
      if (ev.type === 'down') setReadout(null);
      // pointerup / pointercancel: 조작이 끝났으면 다음 프레임이 전체 점을 그린다
      if (ev.type === 'up' || ev.type === 'cancel') requestDraw();
      return handled;
    }
    function hover(c: Cursor | null) {
      cursor = c;
      if (c === null || isGesturing(control)) {
        pickWanted = false;
        setReadout(null);
        return;
      }
      pickWanted = true;
      ensureFrame();
    }
    function setPreset(preset: ViewPreset) {
      control = { ...control, camera: fitToBounds(fit, preset) };
      setReadout(null);
      requestDraw();
    }

    // 휠은 네이티브 리스너로 붙인다. React 는 wheel 을 루트에 passive 로 등록해서 JSX 핸들러의 preventDefault 가 무시된다.
    // reducer 가 handled 를 돌려준 경우(Ctrl/Cmd+휠)에만 기본 동작을 막는다. 일반 휠은 페이지 스크롤에 맡긴다.
    // deltaY 의 단위는 deltaMode 가 정한다. 줄·쪽 단위면 px 로 바꿔 넘긴다(줄 16px, 쪽은 캔버스 CSS 높이)
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === e.DOM_DELTA_LINE ? WHEEL_LINE_PX : e.deltaMode === e.DOM_DELTA_PAGE ? size.cssH : 1;
      if (input({ type: 'wheel', deltaY: e.deltaY * unit, ctrlKey: e.ctrlKey, metaKey: e.metaKey })) e.preventDefault();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    renderer.setData(data, scaffold);
    requestDraw();
    // 크기 변화는 ResizeObserver 로 따른다(jsdom 에는 없다). 버퍼 크기를 바꾸면 캔버스가 지워지므로
    // 다음 프레임을 기다리지 않고 그 자리에서 다시 그린다. 크기가 그대로면 아무것도 하지 않는다
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        const next = measure(canvas);
        if (next.bufW === size.bufW && next.bufH === size.bufH && next.cssW === size.cssW && next.cssH === size.cssH) return;
        size = next;
        renderer.resize(size.bufW, size.bufH);
        draw(interacting() ? dragCountRef.current : n);
      });
      observer.observe(canvas);
    }
    engineRef.current = { input, hover, setPreset, requestDraw };

    return () => {
      engineRef.current = null;
      observer?.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (idleTimer !== null) clearTimeout(idleTimer);
      renderer.dispose();
    };
  }, [data, scaffold]);

  // 임계값·과장 배율·배경은 uniform 만 바꾸고 한 번 다시 그린다
  useEffect(() => {
    viewRef.current = { thresholdQ, exaggeration, themeName };
    engineRef.current?.requestDraw();
  }, [thresholdQ, exaggeration, themeName]);

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId);   // jsdom 에는 없다
    const p = pointerXY(e);
    if (!p) return;
    engineRef.current?.input({ type: 'down', pointerId: e.pointerId, x: p.x, y: p.y, button: e.button, shiftKey: e.shiftKey });
  }
  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const p = pointerXY(e);
    if (!p) return;
    engineRef.current?.input({ type: 'move', pointerId: e.pointerId, x: p.x, y: p.y, button: e.button, shiftKey: e.shiftKey });
    // 터치 입력에서는 읽기 창을 띄우지 않는다
    engineRef.current?.hover(e.pointerType === 'touch' ? null : p);
  }
  // pointerup, pointercancel, lostpointercapture. 놓기는 좌표를 쓰지 않으므로 좌표가 비유한이어도 넘긴다
  // (무시하면 포인터가 눌린 채 남아 다음 이동이 드래그로, 다음 터치가 두·세 포인터 제스처로 읽힌다)
  function onPointerEnd(e: PointerEvent<HTMLCanvasElement>, type: 'up' | 'cancel') {
    const p = pointerXY(e) ?? { x: 0, y: 0 };
    engineRef.current?.input({ type, pointerId: e.pointerId, x: p.x, y: p.y, button: e.button, shiftKey: e.shiftKey });
  }
  function onKeyDown(e: KeyboardEvent<HTMLCanvasElement>) {
    // 브라우저 단축키(예: Ctrl 과 + 의 페이지 확대)를 가로채지 않는다
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (engineRef.current?.input({ type: 'key', key: e.key })) e.preventDefault();
  }

  const theme = POINTS3D_THEME[themeName];
  const thresholdText = fmtThresholdMm(thresholdQ);
  const hud = [
    exaggeration === 1 ? '축 비율 1:1' : `편차 ×${exaggeration} 과장`,
    `임계값 ±${thresholdText} mm`,
    `${data.meta.n_points.toLocaleString('ko-KR')}점`,
  ].join(' · ');

  return (
    <div className="flex flex-col gap-3">
      <div data-testid="points3d-viewport"
        className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-cs-divider"
        style={{ backgroundColor: theme.background }}>
        <canvas ref={canvasRef} role="img" aria-label="3D 점군 뷰어" tabIndex={0}
          className="absolute inset-0 h-full w-full touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cs-link"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => onPointerEnd(e, 'up')}
          onPointerCancel={(e) => onPointerEnd(e, 'cancel')}
          onLostPointerCapture={(e) => onPointerEnd(e, 'cancel')}
          onPointerLeave={() => engineRef.current?.hover(null)}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => e.preventDefault()} />
        <div data-testid="points3d-labels" className="pointer-events-none absolute inset-0 text-xs leading-4"
          style={{ color: theme.textSecondary }}>
          {labels.map((l) => (
            <span key={`${l.axis}:${l.kind}:${l.text}`} className="absolute whitespace-nowrap font-mono tabular-nums"
              style={{ left: l.x, top: l.y, transform: LABEL_TRANSFORM[l.axis][l.kind] }}>
              {l.text}
            </span>
          ))}
        </div>
        <ul data-testid="points3d-legend"
          className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1 text-xs leading-4"
          style={{ color: theme.text }}>
          {LEGEND.map((cls) => (
            <li key={cls} className="flex items-center gap-2">
              <span aria-hidden data-class={cls} className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: theme[cls] }} />
              {POINT_CLASS_LABEL[cls]}
            </li>
          ))}
        </ul>
        {/* 아래 줄: 왼쪽 HUD, 오른쪽 조작 안내. 폭이 좁으면 두 줄로 접힌다 */}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 text-xs leading-4">
          <p data-testid="points3d-hud" style={{ color: theme.text }}>{hud}</p>
          <p data-testid="points3d-hint" style={{ color: theme.textSecondary }}>드래그 회전 · Ctrl+휠 확대</p>
        </div>
        {readout && (
          <div data-testid="points3d-readout"
            className="pointer-events-none absolute rounded border px-2 py-1.5 font-mono text-xs leading-4 tabular-nums"
            style={{
              ...readoutPosition(readout),
              color: theme.text,
              backgroundColor: rgba(theme.readoutBackground, theme.readoutAlpha),
              borderColor: rgba(theme.line, theme.axisAlpha),
            }}>
            {readoutLines(data, readout.index, thresholdQ).map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
        {restoring && (
          // 컨텍스트 복구를 기다리는 동안 뷰어 영역을 덮는다. 캔버스는 복구 이벤트를 받아야 하므로 그대로 둔다
          <div className="absolute inset-0"><Points3dLoadingFrame theme={themeName} /></div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className={GROUP}>
          <span className={GROUP_NAME}>시점</span>
          {VIEW_PRESETS.map((p) => (
            <Button key={p.id} onClick={() => engineRef.current?.setPreset(p.id)}>{p.label}</Button>
          ))}
        </div>
        <div className={GROUP}>
          <span className={GROUP_NAME}>편차 과장</span>
          {EXAGGERATIONS.map((k) => (
            <Button key={k} aria-pressed={exaggeration === k} className={PRESSED} onClick={() => setExaggeration(k)}>
              {`×${k}`}
            </Button>
          ))}
        </div>
        <div className={GROUP}>
          <span className={GROUP_NAME}>임계값</span>
          <input type="range" min={THRESHOLD_Q_MIN} max={THRESHOLD_Q_MAX} step={THRESHOLD_Q_STEP}
            value={thresholdQ} onChange={(e) => setThresholdQ(Number(e.target.value))}
            aria-label="표시 임계값(mm)" aria-valuetext={`±${thresholdText} mm`}
            className="w-40 accent-cs-link" />
          <span className="font-mono text-sm tabular-nums">{`±${thresholdText} mm`}</span>
        </div>
        <Button aria-pressed={themeName === 'light'} className={PRESSED}
          onClick={() => setThemeName((t) => (t === 'dark' ? 'light' : 'dark'))}>
          밝은 배경
        </Button>
      </div>

      <p data-testid="points3d-notice" className={NOTE}>
        {`점 색은 참고용 표시입니다. FLAT(평탄)은 점이 속한 5cm 칸이 구역 기준 평면에서 ±${thresholdText}mm 이내, DEPRESSION(침하)은 −${thresholdText}mm 미만, PROTRUSION(융기)은 +${thresholdText}mm 초과임을 뜻합니다. 판정 등급은 히트맵 탭의 직선자 틈새 기준이며 측정 방식이 다릅니다. 초록 점이 대부분인 칸이 경계·보수일 수 있고, 노랑·빨강 점이 많은 칸이 적합일 수 있습니다. 임계값을 바꿔도 판정과 보고서는 달라지지 않습니다.`}
      </p>
      {isRegistered && (
        <p data-testid="points3d-merged-note" className={NOTE}>
          정합 병합 스캔의 점은 원본 점이 아니라 5cm 격자 대표점입니다.
        </p>
      )}
    </div>
  );
}

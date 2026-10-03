// 3D 점군 뷰어의 격자·축선 정점과 눈금 라벨(스펙 §7.8). DOM·WebGL 을 건드리지 않는 순수 함수만 둔다.
// 좌표는 전부 파일-로컬 m 다. 눈금 숫자는 fit 범위 최솟값 모서리를 0 으로 한 값이다.
import { project } from './mat4';
import type { Bounds } from './orbit';

export const MAX_GRID_LINES = 40;          // x선 수 + y선 수의 상한
export const LABEL_MIN_GAP_PX = 28;        // 같은 축 눈금 라벨 사이의 최소 화면 거리(CSS px)
export const MIN_AXIS_RANGE_M = 0.1;       // 이보다 좁은 축은 fit.min 을 고정한 채 이 길이로 본다
export const AXIS_NAME_OFFSET_FRAC = 0.08; // 축 이름을 변에서 바깥으로 띄우는 거리 = 이 값 x max(rangeX, rangeY)

export interface AxisTick { axis: 'x' | 'y'; pos: [number, number, number]; text: string; kind: 'tick' | 'name'; }
export interface PlacedLabel { axis: 'x' | 'y'; kind: 'tick' | 'name'; text: string; x: number; y: number; }

const NICE_MANTISSAS = [1, 2, 5];
const NICE_MIN_EXP = -2;   // 최소 간격 0.01m
const NICE_MAX_EXP = 9;    // 탐색 상한. 비유한 범위가 들어와도 루프가 끝난다
const FLOOR_EPS = 1e-9;    // 0.3 / 0.1 = 2.9999999999999996 같은 나눗셈 오차를 흡수한다

// range 안에 step 이 몇 번 들어가는가. niceStep 과 격자 생성이 같은 식을 써야 선 수가 어긋나지 않는다.
function stepsIn(range: number, step: number): number {
  return Math.floor(range / step + FLOOR_EPS);
}

// {1, 2, 5} x 10^p 수열에서 x선 수 + y선 수가 maxLines 이하가 되는 가장 작은 간격(m).
export function niceStep(rangeX: number, rangeY: number, maxLines: number = MAX_GRID_LINES): number {
  let step = 0;
  for (let p = NICE_MIN_EXP; p <= NICE_MAX_EXP; p++) {
    for (const m of NICE_MANTISSAS) {
      // 정수끼리 나누거나 곱해야 0.05 같은 값이 리터럴과 같은 배정도 값이 된다
      step = p < 0 ? m / 10 ** -p : m * 10 ** p;
      if (stepsIn(rangeX, step) + stepsIn(rangeY, step) + 2 <= maxLines) return step;
    }
  }
  return step;
}

// 눈금 숫자의 소수 자릿수. step >= 1 이면 정수, 아니면 step 의 유효 소수 자릿수(0.5 -> 1, 0.05 -> 2).
function stepDecimals(step: number): number {
  return step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step) + FLOOR_EPS));
}

// 격자선·축선 정점과 눈금 목록. verts 는 xyz 3개씩이며 앞 gridVertCount 정점이 격자 LINES,
// 이어지는 axisVertCount 정점이 축선 LINES 다. ticks 는 x 눈금, y 눈금, x 이름, y 이름 순이다.
export function buildScaffold(fit: Bounds): {
  verts: Float32Array; gridVertCount: number; axisVertCount: number; ticks: AxisTick[]; step: number;
} {
  const x0 = fit.min[0];
  const y0 = fit.min[1];
  const z = fit.min[2]; // 바닥 높이. 편차 과장과 무관하게 움직이지 않는다
  // 0.1m 미만 축은 fit.min 을 고정하고 max 쪽을 늘린다. 간격·격자·축선·눈금이 전부 이 보정 범위를 쓴다
  const rawX = fit.max[0] - x0;
  const rawY = fit.max[1] - y0;
  const shortX = rawX < MIN_AXIS_RANGE_M;
  const shortY = rawY < MIN_AXIS_RANGE_M;
  const rangeX = shortX ? MIN_AXIS_RANGE_M : rawX;
  const rangeY = shortY ? MIN_AXIS_RANGE_M : rawY;
  const x1 = shortX ? x0 + MIN_AXIS_RANGE_M : fit.max[0];
  const y1 = shortY ? y0 + MIN_AXIS_RANGE_M : fit.max[1];

  const step = niceStep(rangeX, rangeY);
  const nx = stepsIn(rangeX, step);
  const ny = stepsIn(rangeY, step);
  const decimals = stepDecimals(step);

  const v: number[] = [];
  const ticks: AxisTick[] = [];
  // x 가 일정한 선. 범위가 step 의 배수가 아니면 먼 쪽 가장자리(x1)에는 선이 없다
  for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step;
    v.push(x, y0, z, x, y1, z);
    // 눈금 숫자는 누적 덧셈이 아니라 i x step 에서 바로 만든다
    ticks.push({ axis: 'x', pos: [x, y0, z], text: (i * step).toFixed(decimals), kind: 'tick' });
  }
  // y 가 일정한 선
  for (let j = 0; j <= ny; j++) {
    const y = y0 + j * step;
    v.push(x0, y, z, x1, y, z);
    ticks.push({ axis: 'y', pos: [x0, y, z], text: (j * step).toFixed(decimals), kind: 'tick' });
  }
  const gridVertCount = v.length / 3;
  // 축선 두 변: x축 변(y = y0), y축 변(x = x0)
  v.push(x0, y0, z, x1, y0, z);
  v.push(x0, y0, z, x0, y1, z);
  const axisVertCount = v.length / 3 - gridVertCount;

  // 축 이름은 변의 중점에서 바깥쪽으로 띄운다
  const off = AXIS_NAME_OFFSET_FRAC * Math.max(rangeX, rangeY);
  ticks.push({ axis: 'x', pos: [(x0 + x1) / 2, y0 - off, z], text: 'x (m)', kind: 'name' });
  ticks.push({ axis: 'y', pos: [x0 - off, (y0 + y1) / 2, z], text: 'y (m)', kind: 'name' });

  return { verts: new Float32Array(v), gridVertCount, axisVertCount, ticks, step };
}

// 눈금·축 이름의 월드 위치를 화면(CSS px)으로 옮긴다. 카메라 뒤이거나 영역 밖이면 숨기고,
// 같은 축에서 직전에 남긴 눈금과 LABEL_MIN_GAP_PX 미만으로 붙은 눈금은 건너뛴다. 축 이름은 솎지 않는다.
export function layoutLabels(ticks: AxisTick[], viewProj: Float32Array, cssW: number, cssH: number): PlacedLabel[] {
  const out: PlacedLabel[] = [];
  const lastKept: { x?: { x: number; y: number }; y?: { x: number; y: number } } = {};
  for (const t of ticks) {
    const p = project(viewProj, t.pos, cssW, cssH);
    if (p === null) continue; // 카메라 뒤(w <= 0)
    if (p.x < 0 || p.x > cssW || p.y < 0 || p.y > cssH) continue; // 영역 밖
    if (t.kind === 'tick') {
      const last = lastKept[t.axis];
      if (last !== undefined && Math.hypot(p.x - last.x, p.y - last.y) < LABEL_MIN_GAP_PX) continue;
      lastKept[t.axis] = { x: p.x, y: p.y };
    }
    out.push({ axis: t.axis, kind: t.kind, text: t.text, x: p.x, y: p.y });
  }
  return out;
}

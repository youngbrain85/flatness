// 3D 점군 뷰어의 점 크기 식과 조작 중 그릴 점 수(LOD) 조정(스펙 §2.4, §7.4). 순수 함수만 둔다.
// 이름에 buffer 가 붙은 값과 [minPx, maxPx] 는 드로잉 버퍼 px(canvas.height, gl_PointSize 와 같은 단위)다.

export const POINT_SIZE_FACTOR = 0.55;  // 점의 실제 크기 = 이 값 x sample_cell_m
export const MIN_POINT_CSS_PX = 1.5;    // 점의 최소 크기(CSS px). 드로잉 버퍼로는 x 배율
export const LOD_START = 150_000;       // 조작 중 그릴 점 수의 시작값
export const LOD_FLOOR = 20_000;        // 조작 중 그릴 점 수의 하한
export const LOD_SLOW_MS = 33;          // frameMs 가 이보다 크면 줄인다
export const LOD_FAST_MS = 20;          // frameMs 가 이보다 작으면 늘린다

// 점 크기 메뉴의 배율 단계(2026-10-20 스펙). 1 = 지금 크기(기본). CloudCompare 의 Default point size -/+ 처럼 한 단계씩
export const POINT_SCALES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
const MIN_BUFFER_PX = 1;                // 배율을 줄여도 점은 드로잉 버퍼 1px 아래로 작아지지 않는다

const LOD_SHRINK = 0.7;
const LOD_GROW = 1.25;

// 점의 실제 크기(m).
export function pointWorldSizeM(sampleCellM: number): number {
  return POINT_SIZE_FACTOR * sampleCellM;
}

// 카메라 앞 1m 거리에서 1m 가 차지하는 드로잉 버퍼 px. bufferHPx 는 canvas.height 다(CSS 높이가 아니다).
export function pxPerUnit(bufferHPx: number, fovy: number): number {
  return bufferHPx / (2 * Math.tan(fovy / 2));
}

// gl_PointSize 를 clamp 할 [minPx, maxPx](드로잉 버퍼 px). aliasedRange 는 ALIASED_POINT_SIZE_RANGE,
// bufferScale 은 드로잉 버퍼 배율(min(devicePixelRatio, 2))이다. pointScale 은 점 크기 메뉴 배율로, 최소 크기에도 곱해야
// 작게 할 때 최소 크기에 막히지 않고 실제로 작아진다(1 버퍼 px 아래로는 내려가지 않는다).
export function pointSizeRange(aliasedRange: [number, number], bufferScale: number, pointScale = 1): [number, number] {
  const maxPx = aliasedRange[1];
  return [Math.min(Math.max(MIN_BUFFER_PX, MIN_POINT_CSS_PX * bufferScale * pointScale), maxPx), maxPx];
}

// 점 크기 배율을 한 단계 움직인다. 끝 단계에서는 그대로 돌려준다.
export function stepPointScale(scale: number, dir: -1 | 1): number {
  const i = POINT_SCALES.indexOf(scale as (typeof POINT_SCALES)[number]);
  const j = Math.min(POINT_SCALES.length - 1, Math.max(0, (i < 0 ? POINT_SCALES.indexOf(1) : i) + dir));
  return POINT_SCALES[j];
}

// 조작 중 그릴 점 수의 초기값.
export function initialDragCount(n: number): number {
  return Math.min(n, LOD_START);
}

// 직전 프레임 간격(frameMs)에 따라 조작 중 그릴 점 수를 조정한다.
// 반올림한 뒤 [min(n, LOD_FLOOR), n] 으로 clamp 한다.
export function nextDragCount(prev: number, n: number, frameMs: number): number {
  const scaled = frameMs > LOD_SLOW_MS ? prev * LOD_SHRINK : frameMs < LOD_FAST_MS ? prev * LOD_GROW : prev;
  return Math.min(n, Math.max(Math.min(n, LOD_FLOOR), Math.round(scaled)));
}

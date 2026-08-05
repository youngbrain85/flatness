// 정합 도메인 (단계 F Task 5) - 대응점 직렬화 / 참 중첩 환산 / 겹쳐보기 기하
//
// 판정 이중화 아님(리트머스): 이 파일에는 성공 임계(RMSE 2mm)도 중첩 하한(10%)도
// 들어 있지 않다. 그 판단은 엔진(core/registration.py)이 하고 화면은 결과와
// error_text를 그대로 옮긴다. 여기 있는 것은 **표시 환산**과 **좌표 기하**뿐이다.
import type { HeightViewMeta, PickedPoint } from './height-view';
import type { Correspondence } from './types';

/** 스펙 §8 / engine register_clouds: 3쌍 미만이면 정합을 시작할 수 없다. */
export const MIN_CORRESPONDENCES = 3;

/** engine icp_refine의 trim_ratio 기본값. overlap_ratio의 상한이기도 하다. */
export const ICP_TRIM_RATIO = 0.8;

/** ★ engine/flatness/core/registration.py의 `HORIZONTAL_SENSITIVITY_MIN`과 **같은 값이어야
 *  한다.** 엔진이 이 임계로 실패시키지는 않는다 - 대신 화면이 알릴 책임을 진다고 엔진
 *  독스트링이 명시한다. 그래서 임계가 화면 쪽에도 한 벌 있다.
 *
 *  판정 이중화가 아닌 이유: 이 값은 합격·불합격을 가르지 않는다. 엔진이 이미
 *  `converged`로 합격을 판정했고, 이 상수는 "그 합격을 수평 방향으로 데이터가 뒷받침하는가"
 *  라는 **표시 조건**만 정한다. 엔진 상수가 바뀌면 여기도 함께 바꿔야 한다. */
export const HORIZONTAL_SENSITIVITY_MIN = 1.1;

/** 수평 검증 가능성.
 *
 *  - `'ok'`   : 수평으로 밀면 잔차가 유의하게 오른다(장면에 수평 위치를 구속하는 특징이 있다)
 *  - `'weak'` : 밀어도 잔차가 거의 그대로다. 데이터만으로는 수평 위치를 판별할 수 없다
 *  - `'unknown'`: 값이 없다(구 데이터·컬럼 미적용 DB) - **아무것도 표시하지 않는다**
 */
export type HorizontalCheck = 'ok' | 'weak' | 'unknown';

/** 감도 값 -> 수평 검증 가능성.
 *
 * ★ `'weak'`는 **이상 상황이 아니다.** 바닥이 평탄할수록 이 값이 낮게 나온다 - 평탄한
 * 면은 자기 위로 밀어도 모양이 같아 수평 위치를 구속할 정보가 원래 없기 때문이다.
 * 재리뷰 실측(같은 장면을 바닥 평탄도만 바꿔 잰 값):
 *
 *     ±12mm(이 용역 기준으론 불합격 바닥) 1.710 / ±6mm 1.218 /
 *     ±3.5mm 1.084 / ±2.5mm 1.038  -> 교차점 약 ±4.5mm
 *
 * 스펙이 정의한 이 용역의 대상이 **±5mm 평탄 바닥**이므로, **스펙을 만족하는 좋은
 * 바닥일수록 'weak'가 나온다.** 즉 이 상태는 흔하고 정상이다. 화면이 이것을 "오류·이상"
 * 으로 표시하면 늑대소년이 되어 사용자가 곧 무시하게 된다 - 정보로 제시해야 한다.
 *
 * ★ null·undefined·비유한값은 `'unknown'`이다. 감도 프로브 이전에 만들어진 정합 이력과
 * 012의 컬럼을 아직 적용하지 않은 DB(select('*')에 컬럼 자체가 없어 undefined)가 정상적으로
 * 그 상태다. "알 수 없음"을 "낮음"으로 바꾸면 멀쩡한 옛 정합 전부에 안내가 붙는다.
 */
export function horizontalCheck(sensitivity: number | null | undefined): HorizontalCheck {
  if (sensitivity === null || sensitivity === undefined) return 'unknown';
  if (!Number.isFinite(sensitivity)) return 'unknown';
  return sensitivity < HORIZONTAL_SENSITIVITY_MIN ? 'weak' : 'ok';
}

export interface PointPair { a: PickedPoint; b: PickedPoint }

/** 화면이 모은 쌍 -> registrations.correspondences(jsonb).
 *
 * ★ Task 4 계약(worker/flatworker/registration.py correspondence_arrays):
 *   [{"a": {x,y,z}, "b": {x,y,z}}, ...] / a는 source_scan_ids[0], b는 [1].
 *   값은 **각 스캔 파일 단위의 월드 좌표** 그대로다 - 워커가 unit_scale을 곱한다.
 *   여기서 미터로 바꿔 보내면 두 번 곱해진다.
 *
 * z가 null인 점(사이드카 median_z가 NaN인 셀)은 거부한다(설계 결정 F6). 화면이
 * 이미 클릭 단계에서 막지만, 저장 직전에 한 번 더 막아 조용한 통과를 없앤다.
 */
export function toCorrespondences(pairs: PointPair[]): Correspondence[] {
  return pairs.map((p, i) => {
    if (p.a.z === null || p.b.z === null) {
      throw new Error(`${i + 1}번째 대응점에 높이 값이 없는 지점이 섞여 있습니다. 그 쌍을 지우고 다시 찍으세요.`);
    }
    return {
      a: { x: p.a.x, y: p.a.y, z: p.a.z },
      b: { x: p.b.x, y: p.b.y, z: p.b.z },
    };
  });
}

/** registrations.overlap_ratio -> 사용자에게 보여줄 **참 중첩** 백분율.
 *
 * ★ 스펙 §9.3.4: `overlap_ratio = 쓴 쌍 / len(src)`인데 trimmed ICP가 항상 하위
 *   trim_ratio만 쓰므로 **100% 겹쳐도 최댓값이 0.8**이다. 원값을 그대로 "중첩률
 *   80%"로 보여주면 사용자가 "80%밖에 안 겹쳤네"로 오해한다. trim_ratio로 나눠야
 *   참 중첩이 된다(엔진의 거부 임계 0.1은 참 중첩 12.5%에 해당한다).
 *
 * 계약이 깨져 상한을 넘는 값이 와도 100%를 넘겨 표시하지 않는다 - "112% 겹쳤다"는
 * 표시는 사용자에게 아무 의미가 없다.
 */
export function trueOverlapPct(
  overlapRatio: number | null | undefined, trimRatio: number = ICP_TRIM_RATIO,
): number | null {
  if (overlapRatio === null || overlapRatio === undefined || !Number.isFinite(overlapRatio)) return null;
  if (!Number.isFinite(trimRatio) || trimRatio <= 0) return null;
  return Math.min(100, (overlapRatio / trimRatio) * 100);
}

// ---------------------------------------------------------------------------
// 겹쳐보기 기하
//
// ★ 왜 필요한가(스펙 §9.3.2, 남는 위험): point-to-plane RMSE는 변위의 법선 방향
//   성분만 세므로 **수평 오정합에 원리적으로 무감각하다**. 실측 - 완전 평면에서
//   3m 어긋난 정합도 RMSE 1.006mm로 성공 보고된다. 스펙이 §7.4 화면에 "RMSE만
//   보여주지 말고 정합 후 두 점군을 겹쳐 그린 그림을 함께 제시"하라고 못 박은
//   이유다. 두 무장식 PNG를 변환행렬로 겹쳐 그리면 그 어긋남이 눈에 보인다.
// ---------------------------------------------------------------------------

/** canvas setTransform(a,b,c,d,e,f) 인자. (u,v) -> (a*u + c*v + e, b*u + d*v + f) */
export type Affine = [number, number, number, number, number, number];

export interface OverlayView {
  /** 화면 좌표계 원점(미터, A 기준 좌표계) */
  xMinM: number;
  yMaxM: number;
  /** 미터당 캔버스 픽셀 */
  scale: number;
  width: number;
  height: number;
}

/** 무장식 PNG 픽셀 (u,v) -> A 기준 미터 좌표.
 *
 * 세 단계다:
 *   1. 픽셀 -> 파일 단위 월드. 이미지 v=0이 격자 iy=ny-1(월드 y 최댓값) 행이다.
 *   2. x unit_scale -> 미터. 두 스캔의 배율이 서로 다를 수 있다(워커 align_sources와
 *      같은 이유) - mm 파일에서 이 곱을 빼면 1000배 틀린다.
 *   3. 정합 변환(4x4, 미터) 적용. transform이 null이면 A(기준 스캔)이라 그대로 둔다.
 */
function pixelToMeterA(
  meta: HeightViewMeta, unitScale: number, transform: number[][] | null, u: number, v: number,
): [number, number] {
  const [ny] = meta.shape;
  const sub = meta.subcell_m_file;
  const xf = meta.bbox_min[0] + u * sub;
  const yf = meta.bbox_min[1] + ny * sub - v * sub;
  const xm = xf * unitScale;
  const ym = yf * unitScale;
  if (!transform) return [xm, ym];
  // z는 화면 투영에서 쓰지 않는다(위에서 내려다본 그림이라 xy 성분만 필요하다).
  return [
    transform[0][0] * xm + transform[0][1] * ym + transform[0][3],
    transform[1][0] * xm + transform[1][1] * ym + transform[1][3],
  ];
}

/** 이미지 네 모서리를 A 기준 미터 좌표로 옮긴다. 순서: 좌상 · 우상 · 좌하 · 우하. */
export function imageCornersM(
  meta: HeightViewMeta, unitScale: number, transform: number[][] | null,
): [number, number][] {
  const [ny, nx] = meta.shape;
  return [
    pixelToMeterA(meta, unitScale, transform, 0, 0),
    pixelToMeterA(meta, unitScale, transform, nx, 0),
    pixelToMeterA(meta, unitScale, transform, 0, ny),
    pixelToMeterA(meta, unitScale, transform, nx, ny),
  ];
}

/** 모서리 집합 전부를 maxW x maxH 안에 담는 화면 좌표계(가로세로 비율 유지). */
export function overlayView(
  cornerSets: [number, number][][], maxW: number, maxH: number,
): OverlayView {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const set of cornerSets) {
    for (const [x, y] of set) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  const w = Math.max(xMax - xMin, 1e-9);
  const h = Math.max(yMax - yMin, 1e-9);
  const scale = Math.max(Math.min(maxW / w, maxH / h), 1e-9);
  return {
    xMinM: xMin, yMaxM: yMax, scale,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** 무장식 PNG를 그대로 drawImage(img, 0, 0) 하기 위한 canvas 변환.
 *
 * 세 점의 상을 잡아 아핀 계수를 뽑는다 - 회전·평행이동·축척·y 뒤집기가 전부
 * 하나의 아핀이므로, 합성 순서를 손으로 전개하다 틀리는 것보다 안전하다.
 */
export function overlayAffine(
  meta: HeightViewMeta, unitScale: number, transform: number[][] | null, view: OverlayView,
): Affine {
  const toCanvas = (u: number, v: number): [number, number] => {
    const [xm, ym] = pixelToMeterA(meta, unitScale, transform, u, v);
    return [(xm - view.xMinM) * view.scale, (view.yMaxM - ym) * view.scale];
  };
  const o = toCanvas(0, 0);
  const du = toCanvas(1, 0);
  const dv = toCanvas(0, 1);
  return [du[0] - o[0], du[1] - o[1], dv[0] - o[0], dv[1] - o[1], o[0], o[1]];
}

// PickedPoint를 types.ts에도 두지 않고 height-view.ts의 것을 재수출한다 -
// 좌표 환산 정본이 그 파일이므로 타입도 거기서 온다.
export type { PickedPoint };

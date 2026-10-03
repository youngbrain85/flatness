// 궤도 카메라(Z-up, 원근 투영). 순수 함수이고 상태는 불변이다(항상 새 객체를 돌려준다).
// eye = target + distance * (cos e * cos a, cos e * sin a, sin e)  (a = 방위, e = 고도)
import { lookAt, multiply, perspective } from './mat4';
import type { Vec3 } from './mat4';

export interface Bounds { min: [number, number, number]; max: [number, number, number]; }
// radius = fit 반경(줌 제한의 기준). 줌과 팬으로는 변하지 않는다
export interface OrbitState {
  target: [number, number, number]; distance: number; azimuth: number; elevation: number;
  fovy: number; radius: number;
}
export type ViewPreset = 'iso' | 'top' | 'front';

const DEG = Math.PI / 180;

export const FOVY = 40 * DEG; // 세로 시야각
export const ELEVATION_LIMIT = 89.9 * DEG; // 고도 제한(+-). 90도면 시선이 up 과 나란해져 퇴화한다
export const ROTATE_RAD_PER_PX = 0.005; // 드래그 1 CSS px 당 회전량
export const ZOOM_MIN_FACTOR = 0.02; // 줌 거리 하한 = 0.02 x radius
export const ZOOM_MAX_FACTOR = 20; // 줌 거리 상한 = 20 x radius
export const MIN_FIT_RADIUS_M = 0.5; // fit 반경 하한(m)
// 평면 시점의 고도가 90도가 아니라 89.9도인 이유: up = [0, 0, 1] 과 시선이 나란하면 lookAt 이 퇴화한다
export const PRESET_ANGLES: Record<ViewPreset, { azimuth: number; elevation: number }> = {
  iso: { azimuth: -55 * DEG, elevation: 20 * DEG },
  top: { azimuth: -90 * DEG, elevation: 89.9 * DEG },
  front: { azimuth: -90 * DEG, elevation: 5 * DEG },
};

const FIT_MARGIN = 1.05; // fit 구가 화면 가장자리에 닿지 않게 두는 여유
const NEAR_MIN_FRACTION = 0.001; // near 하한 = distance x 0.001
const UP: Vec3 = [0, 0, 1];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// fit 범위에 맞춘 초기 상태. 시점 버튼도 이 함수를 다시 부른다(팬과 줌 초기화)
export function fitToBounds(fit: Bounds, preset: ViewPreset): OrbitState {
  const target: [number, number, number] = [
    (fit.min[0] + fit.max[0]) / 2,
    (fit.min[1] + fit.max[1]) / 2,
    (fit.min[2] + fit.max[2]) / 2,
  ];
  const diagonal = Math.hypot(fit.max[0] - fit.min[0], fit.max[1] - fit.min[1], fit.max[2] - fit.min[2]);
  const radius = Math.max(diagonal / 2, MIN_FIT_RADIUS_M);
  const { azimuth, elevation } = PRESET_ANGLES[preset];
  return { target, distance: (radius / Math.sin(FOVY / 2)) * FIT_MARGIN, azimuth, elevation, fovy: FOVY, radius };
}

// dxPx, dyPx 는 CSS px. 오른쪽으로 끌면 방위가 줄고 아래로 끌면 고도가 는다
export function rotate(s: OrbitState, dxPx: number, dyPx: number): OrbitState {
  return {
    ...s,
    azimuth: s.azimuth - dxPx * ROTATE_RAD_PER_PX,
    elevation: clamp(s.elevation + dyPx * ROTATE_RAD_PER_PX, -ELEVATION_LIMIT, ELEVATION_LIMIT),
  };
}

// distance 에 factor 를 곱한다(1 보다 작으면 다가간다)
export function zoom(s: OrbitState, factor: number): OrbitState {
  return {
    ...s,
    distance: clamp(s.distance * factor, s.radius * ZOOM_MIN_FACTOR, s.radius * ZOOM_MAX_FACTOR),
  };
}

// 화면 평면 팬. 잡은 지점이 포인터를 따라오도록 target 거리 기준 m / px 로 환산한다.
// 전부 CSS px. cssHPx = canvas.clientHeight
export function pan(s: OrbitState, dxPx: number, dyPx: number, cssHPx: number): OrbitState {
  const metersPerPx = (2 * s.distance * Math.tan(s.fovy / 2)) / cssHPx;
  const sinA = Math.sin(s.azimuth);
  const cosA = Math.cos(s.azimuth);
  const sinE = Math.sin(s.elevation);
  const cosE = Math.cos(s.elevation);
  const right: Vec3 = [-sinA, cosA, 0]; // 화면 오른쪽
  const up: Vec3 = [-sinE * cosA, -sinE * sinA, cosE]; // 화면 위
  return {
    ...s,
    target: [
      s.target[0] + (-dxPx * right[0] + dyPx * up[0]) * metersPerPx,
      s.target[1] + (-dxPx * right[1] + dyPx * up[1]) * metersPerPx,
      s.target[2] + (-dxPx * right[2] + dyPx * up[2]) * metersPerPx,
    ],
  };
}

export function eyeOf(s: OrbitState): [number, number, number] {
  const cosE = Math.cos(s.elevation);
  return [
    s.target[0] + s.distance * cosE * Math.cos(s.azimuth),
    s.target[1] + s.distance * cosE * Math.sin(s.azimuth),
    s.target[2] + s.distance * Math.sin(s.elevation),
  ];
}

// 파일-로컬 좌표 -> 클립 좌표. full = [0, 0, 0] ~ extent_m (표본 전체 범위).
// near / far 는 호출할 때마다 full 에서 다시 계산한다: 팬으로 target 이 움직여도 표본 전체가 잘리지 않는다
export function viewProj(s: OrbitState, aspect: number, full: Bounds): Float32Array {
  let farRadius = 0; // target 에서 전체 범위 상자의 가장 먼 꼭짓점까지
  for (let i = 0; i < 8; i++) {
    const dx = (i & 1 ? full.max[0] : full.min[0]) - s.target[0];
    const dy = (i & 2 ? full.max[1] : full.min[1]) - s.target[1];
    const dz = (i & 4 ? full.max[2] : full.min[2]) - s.target[2];
    farRadius = Math.max(farRadius, Math.hypot(dx, dy, dz));
  }
  // 전체 범위가 target 한 점이면 near = far 가 돼 투영 행렬이 NaN 이 된다. 그때만 fit 반경을 쓴다
  if (farRadius === 0) farRadius = s.radius;
  const far = s.distance + farRadius;
  const near = Math.max(s.distance - farRadius, s.distance * NEAR_MIN_FRACTION);
  return multiply(perspective(s.fovy, aspect, near, far), lookAt(eyeOf(s), s.target, UP));
}

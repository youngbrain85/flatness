// orbit: Z-up 궤도 카메라. 상수와 기지 값은 손으로 계산했고(주석에 근거),
// 나머지는 화면 투영 성질(project 결과)로 확인한다.
import { describe, expect, it } from 'vitest';
import { project, transformPoint } from '../mat4';
import type { Vec3 } from '../mat4';
import {
  ELEVATION_LIMIT, FOVY, MIN_FIT_RADIUS_M, PRESET_ANGLES, ROTATE_RAD_PER_PX, ZOOM_MAX_FACTOR, ZOOM_MIN_FACTOR,
  eyeOf, fitToBounds, pan, rotate, viewProj, zoom,
} from '../orbit';
import type { Bounds, OrbitState, ViewPreset } from '../orbit';

// 뷰어 영역 비율 4 : 3 (CSS px)
const W = 640;
const H = 480;
const ASPECT = W / H;
const PRESETS: ViewPreset[] = ['iso', 'top', 'front'];

// 손으로 계산한 라디안 값
const RAD_40 = 0.698131700798;
const RAD_89_9 = 1.569050997543; // 90도(1.570796326795) - 0.1도(0.001745329252)
const RAD_55 = 0.959931088597;
const RAD_20 = 0.349065850399;
const RAD_90 = 1.570796326795;
const RAD_5 = 0.0872664626;

const FLOOR: Bounds = { min: [0, 0, 0], max: [6, 8, 0] }; // 대각선 10 -> 반경 5
const ROOM: Bounds = { min: [10, 20, 1], max: [13, 24, 13] }; // 대각선 sqrt(9 + 16 + 144) = 13 -> 반경 6.5

function corners(b: Bounds): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
  }
  return out;
}
function frozen(s: OrbitState): OrbitState {
  Object.freeze(s.target);
  return Object.freeze(s);
}
function at(m: Float32Array, p: Vec3) {
  const r = project(m, p, W, H);
  if (r === null) throw new Error(`카메라 뒤: ${p.join(', ')}`);
  return r;
}

describe('상수 (스펙 2.4)', () => {
  it('FOVY 40도, 고도 제한 89.9도, 회전 1px 당 0.005rad, 줌 제한 0.02R ~ 20R, 반경 하한 0.5m', () => {
    expect(FOVY).toBeCloseTo(RAD_40, 9);
    expect(ELEVATION_LIMIT).toBeCloseTo(RAD_89_9, 9);
    expect(ROTATE_RAD_PER_PX).toBe(0.005);
    expect(ZOOM_MIN_FACTOR).toBe(0.02);
    expect(ZOOM_MAX_FACTOR).toBe(20);
    expect(MIN_FIT_RADIUS_M).toBe(0.5);
  });

  it('프리셋 각도: 등각 -55도 / 20도, 평면 -90도 / 89.9도, 정면 -90도 / 5도', () => {
    expect(PRESET_ANGLES.iso.azimuth).toBeCloseTo(-RAD_55, 9);
    expect(PRESET_ANGLES.iso.elevation).toBeCloseTo(RAD_20, 9);
    expect(PRESET_ANGLES.top.azimuth).toBeCloseTo(-RAD_90, 9);
    expect(PRESET_ANGLES.top.elevation).toBeCloseTo(RAD_89_9, 9); // 90도가 아니다(up 과 퇴화 방지)
    expect(PRESET_ANGLES.front.azimuth).toBeCloseTo(-RAD_90, 9);
    expect(PRESET_ANGLES.front.elevation).toBeCloseTo(RAD_5, 9);
  });
});

describe('eyeOf: eye = target + distance * (cos e cos a, cos e sin a, sin e)', () => {
  const base = { target: [1, 2, 3] as Vec3, distance: 2, fovy: FOVY, radius: 1 };
  const eye = (azimuth: number, elevation: number) => eyeOf({ ...base, azimuth, elevation });
  const expectEye = (got: Vec3, want: Vec3) => want.forEach((v, i) => expect(got[i], `eye[${i}]`).toBeCloseTo(v, 9));

  it('방위 0, 고도 0 이면 +x 쪽', () => expectEye(eye(0, 0), [3, 2, 3]));
  it('방위 90도면 +y 쪽', () => expectEye(eye(Math.PI / 2, 0), [1, 4, 3]));
  it('방위 -90도면 -y 쪽', () => expectEye(eye(-Math.PI / 2, 0), [1, 0, 3]));
  it('고도 90도면 +z 쪽(Z-up)', () => expectEye(eye(0, Math.PI / 2), [1, 2, 5]));
  it('방위 60도, 고도 30도', () => {
    // cos 30 = 0.8660254, sin 30 = 0.5, cos 60 = 0.5, sin 60 = 0.8660254
    // 2 * (0.8660254 * 0.5, 0.8660254 * 0.8660254, 0.5) = (0.8660254, 1.5, 1)
    expectEye(eye(Math.PI / 3, Math.PI / 6), [1.8660254038, 3.5, 4]);
  });
});

describe('fitToBounds', () => {
  it('target = 중심, radius = 대각선 / 2, distance = radius / sin(FOVY / 2) * 1.05', () => {
    // sin(20도) = 0.3420201433. 5 / 0.3420201433 = 14.6190220, * 1.05 = 15.3499731
    const s = fitToBounds(FLOOR, 'iso');
    expect(s.target).toEqual([3, 4, 0]);
    expect(s.radius).toBeCloseTo(5, 9);
    expect(s.distance).toBeCloseTo(15.3499731, 6);
    expect(s.fovy).toBe(FOVY);
    // 6.5 / 0.3420201433 * 1.05 = 19.9549650
    const r = fitToBounds(ROOM, 'top');
    expect(r.target).toEqual([11.5, 22, 7]);
    expect(r.radius).toBeCloseTo(6.5, 9);
    expect(r.distance).toBeCloseTo(19.954965, 6);
  });

  it.each(PRESETS)('프리셋 %s 의 각도를 쓴다', (preset) => {
    const s = fitToBounds(FLOOR, preset);
    expect(s.azimuth).toBe(PRESET_ANGLES[preset].azimuth);
    expect(s.elevation).toBe(PRESET_ANGLES[preset].elevation);
  });

  it('반경 하한 0.5m: 작은 범위와 한 점 범위', () => {
    // 대각선 sqrt(0.04 + 0.01) = 0.2236 -> 반 0.1118 < 0.5. distance = 0.5 / 0.3420201433 * 1.05 = 1.5349973
    const s = fitToBounds({ min: [1, 1, 1], max: [1.2, 1.1, 1] }, 'iso');
    expect(s.radius).toBe(0.5);
    expect(s.distance).toBeCloseTo(1.5349973, 6);
    expect(s.target[0]).toBeCloseTo(1.1, 9);
    expect(s.target[1]).toBeCloseTo(1.05, 9);
    expect(s.target[2]).toBeCloseTo(1, 9);
    const p = fitToBounds({ min: [2, 3, 4], max: [2, 3, 4] }, 'top');
    expect(p.radius).toBe(0.5);
    expect(p.distance).toBeCloseTo(1.5349973, 6);
  });

});

describe('fit 뒤 화면 투영', () => {
  it.each(PRESETS)('%s: fit 범위 8꼭짓점이 전부 화면 안이고 target 은 화면 중앙이다', (preset) => {
    for (const fit of [FLOOR, ROOM, { min: [0, 0, 0], max: [30, 20, 0.05] } as Bounds]) {
      const s = fitToBounds(fit, preset);
      const m = viewProj(s, ASPECT, fit);
      for (const c of corners(fit)) {
        const p = project(m, c, W, H);
        expect(p, `꼭짓점 ${c.join(', ')}`).not.toBeNull();
        expect(p!.x).toBeGreaterThanOrEqual(0);
        expect(p!.x).toBeLessThanOrEqual(W);
        expect(p!.y).toBeGreaterThanOrEqual(0);
        expect(p!.y).toBeLessThanOrEqual(H);
      }
      const t = at(m, s.target);
      expect(t.x).toBeCloseTo(W / 2, 1);
      expect(t.y).toBeCloseTo(H / 2, 1);
      expect(t.w / s.distance).toBeCloseTo(1, 4); // w = 카메라 전방 거리
    }
  });

  it('평면 시점: +x 가 화면 오른쪽, +y 가 화면 위', () => {
    const s = fitToBounds(FLOOR, 'top');
    const m = viewProj(s, ASPECT, FLOOR);
    const c = at(m, [3, 4, 0]);
    const px = at(m, [4, 4, 0]);
    const py = at(m, [3, 5, 0]);
    expect(px.x - c.x).toBeGreaterThan(10);
    expect(Math.abs(px.y - c.y)).toBeLessThan(1);
    expect(c.y - py.y).toBeGreaterThan(10); // 화면 위 = y 감소
    expect(Math.abs(py.x - c.x)).toBeLessThan(1);
  });

  it('정면 시점: +x 가 화면 오른쪽, +z 가 화면 위', () => {
    const s = fitToBounds(FLOOR, 'front');
    const m = viewProj(s, ASPECT, FLOOR);
    const c = at(m, [3, 4, 0]);
    const px = at(m, [4, 4, 0]);
    const pz = at(m, [3, 4, 1]);
    expect(px.x - c.x).toBeGreaterThan(10);
    expect(Math.abs(px.y - c.y)).toBeLessThan(1);
    expect(c.y - pz.y).toBeGreaterThan(10);
    expect(Math.abs(pz.x - c.x)).toBeLessThan(1);
  });

  it('등각 시점: 카메라는 남동쪽 위에 있다. +x 와 +y 가 화면 오른쪽, +z 가 화면 위', () => {
    const s = fitToBounds(FLOOR, 'iso');
    const m = viewProj(s, ASPECT, FLOOR);
    const c = at(m, [3, 4, 0]);
    expect(at(m, [4, 4, 0]).x - c.x).toBeGreaterThan(10);
    expect(at(m, [3, 5, 0]).x - c.x).toBeGreaterThan(10);
    expect(c.y - at(m, [3, 4, 1]).y).toBeGreaterThan(10);
    const eye = eyeOf(s);
    expect(eye[0]).toBeGreaterThan(3); // 동쪽
    expect(eye[1]).toBeLessThan(4); // 남쪽
    expect(eye[2]).toBeGreaterThan(0); // 위
  });
});

describe('rotate', () => {
  const s0 = fitToBounds(FLOOR, 'iso');

  it('오른쪽으로 끌면 방위가 줄고 아래로 끌면 고도가 는다(1px 당 0.005rad)', () => {
    const r = rotate(s0, 10, 0);
    expect(r.azimuth).toBeCloseTo(s0.azimuth - 0.05, 12);
    expect(r.elevation).toBe(s0.elevation);
    const d = rotate(s0, 0, 10);
    expect(d.elevation).toBeCloseTo(s0.elevation + 0.05, 12);
    expect(d.azimuth).toBe(s0.azimuth);
    const both = rotate(s0, -4, -6);
    expect(both.azimuth).toBeCloseTo(s0.azimuth + 0.02, 12);
    expect(both.elevation).toBeCloseTo(s0.elevation - 0.03, 12);
  });

  it('target, distance, radius, fovy 는 그대로다', () => {
    const r = rotate(s0, 33, -12);
    expect(r.target).toEqual(s0.target);
    expect(r.distance).toBe(s0.distance);
    expect(r.radius).toBe(s0.radius);
    expect(r.fovy).toBe(s0.fovy);
  });

  it('화면에서: 카메라 쪽(앞쪽) 점이 끈 방향으로 따라온다', () => {
    // 정면 시점의 카메라는 -y 쪽에 있다. target 보다 카메라에 가까운 점 (3, 2, 0)
    const s = fitToBounds(FLOOR, 'front');
    const near: Vec3 = [3, 2, 0];
    const before = at(viewProj(s, ASPECT, FLOOR), near);
    const right = at(viewProj(rotate(s, 40, 0), ASPECT, FLOOR), near);
    expect(right.x - before.x).toBeGreaterThan(5);
    const down = at(viewProj(rotate(s, 0, 40), ASPECT, FLOOR), near);
    expect(down.y - before.y).toBeGreaterThan(5);
  });

  it('고도는 +-89.9도로 제한된다', () => {
    const flat = { ...s0, elevation: 0 };
    expect(rotate(flat, 0, 300).elevation).toBeCloseTo(1.5, 12); // 300 * 0.005 = 1.5 < 1.56905, 제한 안쪽
    expect(rotate(flat, 0, 314).elevation).toBeCloseTo(RAD_89_9, 9); // 1.57 > 1.56905
    expect(rotate(flat, 0, 1e6).elevation).toBeCloseTo(RAD_89_9, 9);
    expect(rotate(flat, 0, -300).elevation).toBeCloseTo(-1.5, 12);
    expect(rotate(flat, 0, -1e6).elevation).toBeCloseTo(-RAD_89_9, 9);
  });

  it('제한에 걸린 뒤에도 화면이 퇴화하지 않는다(행렬이 유한하고 target 이 중앙)', () => {
    const m = viewProj(rotate(s0, 0, 1e6), ASPECT, FLOOR);
    expect(Array.from(m).every(Number.isFinite)).toBe(true);
    const t = at(m, s0.target);
    expect(t.x).toBeCloseTo(W / 2, 1);
    expect(t.y).toBeCloseTo(H / 2, 1);
    // 꼭대기에서도 오른쪽 축이 살아 있다: 방위 -55도에서 +x 는 화면 오른쪽
    expect(at(m, [4, 4, 0]).x - t.x).toBeGreaterThan(10);
  });
});

describe('zoom', () => {
  const s0 = fitToBounds(FLOOR, 'iso'); // radius 5, distance 15.3499731

  it('distance 에 factor 를 곱한다', () => {
    expect(zoom(s0, 0.5).distance).toBeCloseTo(7.67498655, 6);
    expect(zoom(s0, 2).distance).toBeCloseTo(30.6999462, 6);
  });

  it('[0.02R, 20R] 로 제한된다', () => {
    // R = 5 -> [0.1, 100]
    expect(zoom(s0, 1e-6).distance).toBeCloseTo(0.1, 12);
    expect(zoom(zoom(s0, 1e-6), 0.5).distance).toBeCloseTo(0.1, 12);
    expect(zoom(s0, 1e6).distance).toBeCloseTo(100, 12);
    expect(zoom(zoom(s0, 1e6), 2).distance).toBeCloseTo(100, 12);
  });

  it('radius, target, 각도는 그대로다(줌 제한의 기준이 변하지 않는다)', () => {
    const z = zoom(s0, 0.25);
    expect(z.radius).toBe(5);
    expect(z.target).toEqual(s0.target);
    expect(z.azimuth).toBe(s0.azimuth);
    expect(z.elevation).toBe(s0.elevation);
  });
});

describe('pan', () => {
  it.each(PRESETS)('%s: 잡은 지점이 포인터를 따라온다(옛 target 이 화면에서 (dx, dy) 만큼 움직인다)', (preset) => {
    const s = fitToBounds(FLOOR, preset);
    const p = pan(s, 30, -20, H);
    const moved = at(viewProj(p, ASPECT, FLOOR), s.target);
    expect(moved.x).toBeCloseTo(W / 2 + 30, 1);
    expect(moved.y).toBeCloseTo(H / 2 - 20, 1);
    expect(p.azimuth).toBe(s.azimuth);
    expect(p.elevation).toBe(s.elevation);
    expect(p.distance).toBe(s.distance);
    expect(p.radius).toBe(s.radius);
  });

  it('m / px 환산은 2 * distance * tan(fovy / 2) / cssHPx 다', () => {
    // 평면 시점의 화면 오른쪽은 +x. 2 * 15.3499731 * 0.3639702343 / 480 = 0.0232788888 m/px
    // 오른쪽으로 100px 끌면 target 은 -x 로 2.32788888 m
    const s = fitToBounds(FLOOR, 'top');
    const p = pan(s, 100, 0, H);
    expect(p.target[0]).toBeCloseTo(3 - 2.32788888, 6);
    expect(p.target[1]).toBeCloseTo(4, 9);
    expect(p.target[2]).toBeCloseTo(0, 9);
    // 높이가 절반인 캔버스에서는 같은 px 이 두 배 거리다
    expect(pan(s, 100, 0, H / 2).target[0]).toBeCloseTo(3 - 4.65577776, 6);
  });
});

describe('viewProj 의 클립 평면', () => {
  // eye = (13, 4, 0) 에서 -x 를 본다. target 까지 10
  const s: OrbitState = { target: [3, 4, 0], distance: 10, azimuth: 0, elevation: 0, fovy: FOVY, radius: 5 };
  const zOverW = (m: Float32Array, p: Vec3) => {
    const c = transformPoint(m, p);
    return c[2] / c[3];
  };

  it('near = distance - farRadius, far = distance + farRadius (farRadius = target 에서 가장 먼 전체 범위 꼭짓점)', () => {
    // 전체 범위 [0, 0, 0] ~ [6, 8, 0]: target 에서 네 꼭짓점까지 전부 5 -> near 5, far 15
    const m = viewProj(s, ASPECT, FLOOR);
    expect(zOverW(m, [8, 4, 0])).toBeCloseTo(-1, 4); // 전방 5 = near
    expect(zOverW(m, [-2, 4, 0])).toBeCloseTo(1, 4); // 전방 15 = far
    // 전방 10: (far + near) / (far - near) - 2 * far * near / ((far - near) * 10) = 2 - 1.5 = 0.5
    const t = transformPoint(m, [3, 4, 0]);
    expect(t[3]).toBeCloseTo(10, 4);
    expect(t[2] / t[3]).toBeCloseTo(0.5, 4);
  });

  it('호출할 때마다 full 로 다시 계산한다. near 의 하한은 distance * 0.001', () => {
    // 전체 범위 [0, 0, 0] ~ [60, 80, 0]: 가장 먼 꼭짓점 (60, 80, 0) 까지 sqrt(57^2 + 76^2) = 95
    // far = 105, near = max(10 - 95, 0.01) = 0.01
    const m = viewProj(s, ASPECT, { min: [0, 0, 0], max: [60, 80, 0] });
    expect(Array.from(m).every(Number.isFinite)).toBe(true);
    expect(zOverW(m, [12.99, 4, 0])).toBeCloseTo(-1, 2); // 전방 0.01
    expect(zOverW(m, [-92, 4, 0])).toBeCloseTo(1, 4); // 전방 105
    const t = transformPoint(m, [3, 4, 0]);
    expect(t[3]).toBeCloseTo(10, 4);
    // 전방 10: 105.01 / 104.99 - 2 * 105 * 0.01 / (104.99 * 10) = 1.000190 - 0.002000 = 0.998190
    expect(t[2] / t[3]).toBeCloseTo(0.99819, 4);
  });

  it('팬과 회전 뒤에도 전체 범위 상자 8꼭짓점의 클립 z 가 [-1, 1] 안이다', () => {
    // 팬은 화면 평면 안에서 움직여 깊이를 바꾸지 않는다. 팬으로 target 이 상자 밖으로 나간 뒤
    // 회전하면 상자가 깊이 방향으로 놓인다. 그때도 잘리지 않아야 한다.
    const full: Bounds = { min: [0, 0, 0], max: [6, 6, 0.02] };
    const s1 = pan(fitToBounds(full, 'iso'), 300, 0, H); // target 이 약 5.9m 옮겨 간다
    expect(Math.hypot(s1.target[0] - 3, s1.target[1] - 3)).toBeGreaterThan(5.5);
    for (let k = 0; k < 12; k++) {
      for (const dy of [-200, 0, 200]) {
        const m = viewProj(rotate(s1, (k * Math.PI) / 6 / ROTATE_RAD_PER_PX, dy), ASPECT, full);
        for (const c of corners(full)) {
          const clip = transformPoint(m, c);
          expect(clip[3], `k=${k} dy=${dy} w`).toBeGreaterThan(0);
          const z = clip[2] / clip[3];
          expect(z, `k=${k} dy=${dy} z`).toBeGreaterThanOrEqual(-1.0001);
          expect(z, `k=${k} dy=${dy} z`).toBeLessThanOrEqual(1.0001);
        }
      }
    }
  });

  // 세 축 범위가 모두 0 이 아닌 상자 [0, 0, 0] ~ [6, 8, 20]. 대각선 = sqrt(36 + 64 + 400) = sqrt(500) = 22.3606797750.
  // target 이 꼭짓점에 있으면 가장 먼 꼭짓점은 반대편 꼭짓점이라 farRadius = 대각선이다. distance 40 에서
  // near = 40 - 22.3606797750 = 17.6393202250, far = 40 + 22.3606797750 = 62.3606797750
  // 죽이는 변이: farRadius 에서 dz 무시, 꼭짓점 열거의 x·y·z 비트를 서로 바꿔 씀(일부 꼭짓점을 보지 않는다)
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('8꼭짓점을 전부 본다: target 이 꼭짓점 %i 에 있으면 near = 40 - 대각선, far = 40 + 대각선', (i) => {
    const box: Bounds = { min: [0, 0, 0], max: [6, 8, 20] };
    const target: Vec3 = [i & 1 ? 6 : 0, i & 2 ? 8 : 0, i & 4 ? 20 : 0];
    const cam: OrbitState = { target, distance: 40, azimuth: 0, elevation: 0, fovy: FOVY, radius: 5 };
    const m = viewProj(cam, ASPECT, box);
    // eye = target + (40, 0, 0) 에서 -x 를 본다. 전방 거리 f 인 점은 (target.x + 40 - f, target.y, target.z)
    const ahead = (f: number): Vec3 => [target[0] + 40 - f, target[1], target[2]];
    expect(zOverW(m, ahead(17.6393202250))).toBeCloseTo(-1, 4);
    expect(zOverW(m, ahead(62.3606797750))).toBeCloseTo(1, 4);
  });

  it('전체 범위가 한 점이어도 행렬이 유한하다(near = far 로 나누지 않는다)', () => {
    const one: Bounds = { min: [3, 4, 0], max: [3, 4, 0] };
    const m = viewProj(s, ASPECT, one);
    expect(Array.from(m).every(Number.isFinite)).toBe(true);
    const t = at(m, [3, 4, 0]);
    expect(t.x).toBeCloseTo(W / 2, 1);
    expect(t.y).toBeCloseTo(H / 2, 1);
  });
});

describe('fit 은 fit_bounds 기준이다(전체 범위가 수십 m 여도)', () => {
  const fit: Bounds = { min: [20, 15, 0], max: [26, 21, 0.02] };
  const full: Bounds = { min: [0, 0, 0], max: [60, 45, 3] };

  it('radius 와 distance 는 fit 에서만 나온다', () => {
    // 대각선 sqrt(36 + 36 + 0.0004) = 8.4853049 -> 반경 4.2426525, distance = 4.2426525 / 0.3420201433 * 1.05 = 13.0249203
    const s = fitToBounds(fit, 'iso');
    expect(s.target[0]).toBeCloseTo(23, 9);
    expect(s.target[1]).toBeCloseTo(18, 9);
    expect(s.target[2]).toBeCloseTo(0.01, 9);
    expect(s.radius).toBeCloseTo(4.2426525, 6);
    expect(s.distance).toBeCloseTo(13.0249203, 6);
  });

  it.each(PRESETS)('%s: full 은 화면 위치를 바꾸지 않는다(near / far 에만 쓰인다)', (preset) => {
    const s = fitToBounds(fit, preset);
    const withFull = viewProj(s, ASPECT, full);
    const withFit = viewProj(s, ASPECT, fit);
    for (const c of corners(fit)) {
      const a = at(withFull, c);
      const b = at(withFit, c);
      expect(a.x).toBeCloseTo(b.x, 2);
      expect(a.y).toBeCloseTo(b.y, 2);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThanOrEqual(W);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeLessThanOrEqual(H);
    }
  });

  it('평면 시점에서 fit 범위(6m)가 화면 폭의 40% 이상을 차지한다(바닥이 점이 되지 않는다)', () => {
    // 보이는 폭 = 2 * 13.0249 * tan(20도) * (4 / 3) = 12.64m -> 6m 는 47%
    const s = fitToBounds(fit, 'top');
    const m = viewProj(s, ASPECT, full);
    const left = at(m, [20, 18, 0]);
    const right = at(m, [26, 18, 0]);
    expect(right.x - left.x).toBeGreaterThan(0.4 * W);
  });
});

describe('상태 불변', () => {
  it('rotate, zoom, pan, eyeOf, viewProj 는 입력 상태를 바꾸지 않고 새 객체를 돌려준다', () => {
    const s = frozen(fitToBounds(FLOOR, 'iso'));
    const snapshot = JSON.parse(JSON.stringify(s));
    const r = rotate(s, 15, -7);
    const z = zoom(s, 1.3);
    const p = pan(s, 12, 34, H);
    eyeOf(s);
    viewProj(s, ASPECT, FLOOR);
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshot);
    expect(r).not.toBe(s);
    expect(z).not.toBe(s);
    expect(p).not.toBe(s);
    expect(p.target).not.toBe(s.target);
  });

  it('fitToBounds, viewProj 는 Bounds 를 바꾸지 않고 target 이 Bounds 배열을 가리키지 않는다', () => {
    const b: Bounds = { min: [0, 0, 0], max: [6, 8, 0] };
    Object.freeze(b.min);
    Object.freeze(b.max);
    Object.freeze(b);
    const s = fitToBounds(b, 'front');
    viewProj(s, ASPECT, b);
    expect(b).toEqual({ min: [0, 0, 0], max: [6, 8, 0] });
    expect(s.target).not.toBe(b.min);
    expect(s.target).not.toBe(b.max);
  });
});

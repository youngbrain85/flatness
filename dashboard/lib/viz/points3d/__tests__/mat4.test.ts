// mat4: 열 우선 4x4 행렬 유틸의 기지 값.
// 기대값은 전부 손으로 계산했다(각 it 의 주석에 근거). 구현 출력을 베낀 값이 없다.
import { describe, expect, it } from 'vitest';
import { lookAt, multiply, perspective, project, transformPoint } from '../mat4';

// Float32Array 라서 정확히 같지 않을 수 있다. 소수 5자리까지 본다.
function expectMat(m: Float32Array, want: number[]) {
  expect(m).toBeInstanceOf(Float32Array);
  expect(m.length).toBe(16);
  want.forEach((v, i) => expect(m[i], `m[${i}]`).toBeCloseTo(v, 5));
}
function expectVec(got: number[], want: number[], digits = 4) {
  expect(got.length).toBe(want.length);
  want.forEach((v, i) => expect(got[i], `v[${i}]`).toBeCloseTo(v, digits));
}

// 열 우선 배치: m[c * 4 + r]
const SCALE_234 = new Float32Array([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]);
const TRANSLATE_123 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);

describe('perspective', () => {
  it('fovy 90도, aspect 2, near 1, far 3 의 기지 값(열 우선)', () => {
    // f = 1 / tan(45도) = 1. m[0] = f / aspect = 0.5, m[5] = f = 1,
    // m[10] = (far + near) / (near - far) = 4 / -2 = -2, m[11] = -1,
    // m[14] = 2 * far * near / (near - far) = 6 / -2 = -3, m[15] = 0
    expectMat(perspective(Math.PI / 2, 2, 1, 3), [0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, -2, -1, 0, 0, -3, 0]);
  });

  it('near 평면의 점은 클립 z / w = -1, far 평면의 점은 +1 이고 w 는 전방 거리다', () => {
    const p = perspective(Math.PI / 2, 2, 1, 3);
    // 카메라는 -z 를 본다. (0, 0, -1): z = -2 * -1 - 3 = -1, w = 1
    expectVec(transformPoint(p, [0, 0, -1]), [0, 0, -1, 1]);
    // (0, 0, -3): z = -2 * -3 - 3 = 3, w = 3 -> z / w = 1
    expectVec(transformPoint(p, [0, 0, -3]), [0, 0, 3, 3]);
  });

  it('fovy 40도, aspect 4/3 이면 m[5] = 1 / tan(20도), m[0] = m[5] / aspect', () => {
    // tan(20도) = 0.3639702343 -> 1 / tan = 2.7474774, / (4 / 3) = 2.0606081
    const p = perspective((40 * Math.PI) / 180, 4 / 3, 1, 10);
    expect(p[5]).toBeCloseTo(2.7474774, 5);
    expect(p[0]).toBeCloseTo(2.0606081, 5);
  });
});

describe('lookAt', () => {
  it('+z 위에서 원점을 보는 카메라(up = +y)는 평행 이동만 한다', () => {
    // 전방 f = (0, 0, -1), 오른쪽 s = (1, 0, 0), 위 u = (0, 1, 0). 이동 = (0, 0, -5)
    expectMat(lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1]);
  });

  it('Z-up: -y 쪽에서 원점을 보면 월드 x 가 카메라 x, 월드 z 가 카메라 y 가 된다', () => {
    // f = (0, 1, 0), s = f x up = (1, 0, 0), u = s x f = (0, 0, 1)
    // 열 0 = (s.x, u.x, -f.x) = (1, 0, 0), 열 1 = (s.y, u.y, -f.y) = (0, 0, -1),
    // 열 2 = (s.z, u.z, -f.z) = (0, 1, 0), 열 3 = (-s.eye, -u.eye, f.eye) = (0, 0, -10)
    const v = lookAt([0, -10, 0], [0, 0, 0], [0, 0, 1]);
    expectMat(v, [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, -10, 1]);
    // 점 (1, 2, 3): 카메라 x = 1, 카메라 y = 월드 z = 3, 카메라 z = -(2 - (-10)) = -12
    expectVec(transformPoint(v, [1, 2, 3]), [1, 3, -12, 1]);
  });

  it('eye 는 카메라 원점으로, center 는 -z 축 위 |eye - center| 거리로 간다', () => {
    // |(3, 4, 12)| = 13
    const v = lookAt([3, 4, 12], [0, 0, 0], [0, 0, 1]);
    expectVec(transformPoint(v, [3, 4, 12]), [0, 0, 0, 1]);
    expectVec(transformPoint(v, [0, 0, 0]), [0, 0, -13, 1]);
  });
});

describe('multiply', () => {
  it('a x b 는 b 를 먼저 적용한다(열 우선)', () => {
    // S x T: 열 3 = S * (1, 2, 3, 1) = (2, 6, 12, 1)
    expectMat(multiply(SCALE_234, TRANSLATE_123), [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 2, 6, 12, 1]);
    // T x S: 열 3 = T * (0, 0, 0, 1) = (1, 2, 3, 1)
    expectMat(multiply(TRANSLATE_123, SCALE_234), [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1]);
  });

  it('S x T 로 점 (1, 1, 1) 을 옮기면 이동 뒤 배율: (4, 9, 16)', () => {
    // (1 + 1) * 2 = 4, (1 + 2) * 3 = 9, (1 + 3) * 4 = 16
    expectVec(transformPoint(multiply(SCALE_234, TRANSLATE_123), [1, 1, 1]), [4, 9, 16, 1]);
  });

  it('새 Float32Array 를 돌려주고 입력을 바꾸지 않는다', () => {
    const a = new Float32Array(SCALE_234);
    const b = new Float32Array(TRANSLATE_123);
    const out = multiply(a, b);
    expect(out).not.toBe(a);
    expect(out).not.toBe(b);
    expect(Array.from(a)).toEqual(Array.from(SCALE_234));
    expect(Array.from(b)).toEqual(Array.from(TRANSLATE_123));
  });
});

describe('transformPoint', () => {
  it('열 우선 행렬과 (x, y, z, 1) 의 곱이다', () => {
    // m[c * 4 + r] = c * 4 + r + 1. 점 (1, 2, 3):
    // r0 = 1 * 1 + 5 * 2 + 9 * 3 + 13 = 51, r1 = 2 + 12 + 30 + 14 = 58,
    // r2 = 3 + 14 + 33 + 15 = 65, r3 = 4 + 16 + 36 + 16 = 72
    const m = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(transformPoint(m, [1, 2, 3])).toEqual([51, 58, 65, 72]);
  });
});

describe('project', () => {
  // 카메라: (0, 0, 5) 에서 원점을 본다. fovy 90도(f = 1), aspect 2. 화면 200 x 100 CSS px
  const m = multiply(perspective(Math.PI / 2, 2, 1, 100), lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]));
  const W = 200;
  const H = 100;

  it('카메라가 보는 중심점은 화면 중앙이고 w 는 카메라 전방 거리다', () => {
    const p = project(m, [0, 0, 0], W, H);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(100, 4);
    expect(p!.y).toBeCloseTo(50, 4);
    expect(p!.w).toBeCloseTo(5, 4);
  });

  it('카메라 오른쪽 점은 x 가 커진다', () => {
    // 클립 x = (f / aspect) * 1 = 0.5, w = 5 -> NDC 0.1 -> (0.1 * 0.5 + 0.5) * 200 = 110
    const p = project(m, [1, 0, 0], W, H);
    expect(p!.x).toBeCloseTo(110, 4);
    expect(p!.y).toBeCloseTo(50, 4);
  });

  it('y 축은 화면 아래로 증가한다: 카메라 위쪽 점의 y 가 작다', () => {
    // 클립 y = f * 1 = 1, w = 5 -> NDC 0.2 -> (1 - (0.2 * 0.5 + 0.5)) * 100 = 40
    const p = project(m, [0, 1, 0], W, H);
    expect(p!.x).toBeCloseTo(100, 4);
    expect(p!.y).toBeCloseTo(40, 4);
  });

  it('가까운 점은 w 가 작다', () => {
    // (0, 0, 4) 는 카메라 앞 1
    expect(project(m, [0, 0, 4], W, H)!.w).toBeCloseTo(1, 4);
  });

  it('w <= 0 이면 null: 카메라 위치(w = 0)와 카메라 뒤(w < 0)', () => {
    expect(project(m, [0, 0, 5], W, H)).toBeNull();
    expect(project(m, [0, 0, 6], W, H)).toBeNull();
  });
});

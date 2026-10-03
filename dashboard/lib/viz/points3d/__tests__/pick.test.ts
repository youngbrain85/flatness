// pickNearest: 읽기 창이 띄울 점 하나를 찾는다(스펙 §7.9).
// 대부분의 테스트는 손으로 만든 행렬을 써서 화면 위치를 암산으로 적는다.
// 마지막 한 건만 실제 궤도 카메라(orbit.ts)로 행렬 원소 배치를 확인한다.
import { describe, expect, it } from 'vitest';
import { DEV_NOT_FLOOR, DEV_NO_DEVIATION, type Points3dData } from '@/lib/domain/points3d';
import { project } from '../mat4';
import { fitToBounds, viewProj, type Bounds } from '../orbit';
import { PICK_RADIUS_PX, pickNearest } from '../pick';

// 축 범위를 65535 / 1024 m 로 두면 로컬 좌표가 정확히 q / 1024 m 가 된다(2진 소수라 오차가 없다).
// 아래 좌표는 전부 1/1024 의 배수로 적는다.
const EXTENT = 65535 / 1024;
type Pt = [x: number, y: number, z: number, dev: number]; // m, m, m, 0.1mm 정수(또는 센티널)

function makeData(points: Pt[], extent: [number, number, number] = [EXTENT, EXTENT, EXTENT]): Points3dData {
  const n = points.length;
  const xyz = new Uint16Array(3 * n);
  const dev = new Int16Array(n);
  points.forEach(([x, y, z, d], i) => {
    xyz[3 * i] = Math.round((x / extent[0]) * 65535);
    xyz[3 * i + 1] = Math.round((y / extent[1]) * 65535);
    xyz[3 * i + 2] = Math.round((z / extent[2]) * 65535);
    dev[i] = d;
  });
  return {
    meta: {
      schema_version: 1, n_points: n, units: 'm',
      origin_m: [254012.3371, 4180044.9126, 31.4802], extent_m: extent,
      deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
      sample_cell_m: 0.0125,
      fit_bounds: { min: [0, 0, 0], max: extent },
      sampling: { method: 'cell min-hash stratified', source_points: n, cap: 500000 },
      order: 'hash',
    },
    xyz, dev,
  };
}

// 손으로 만든 카메라: 로컬 (5, 2, 1) 에서 +y 방향을 본다(열 우선 배치).
//   clip.x = x - 5,  clip.y = z - 1,  clip.w = y - 2
//   화면 x = ((x - 5) / (y - 2) + 1) * W / 2
//   화면 y = (1 - (z - 1) / (y - 2)) * H / 2      (z 가 클수록 화면 위쪽)
const CAM = new Float32Array([
  1, 0, 0, 0, //   열 0: x 의 계수 (clip.x, clip.y, clip.z, clip.w)
  0, 0, 1, 1, //   열 1: y 의 계수
  0, 1, 0, 0, //   열 2: z 의 계수
  -5, -1, 0, -2, // 열 3: 상수항
]);
const W = 400;
const H = 300; // 화면 중심은 (200, 150)

const pick = (data: Points3dData, k: number, cx: number, cy: number, r?: number) =>
  pickNearest(data, CAM, k, W, H, cx, cy, r);

describe('pickNearest: 반경', () => {
  // (5, 3, 1): w = 1, clip = (0, 0) -> 화면 (200, 150)
  const one = makeData([[5, 3, 1, 0]]);

  it('기본 반경은 12px 이다', () => {
    expect(PICK_RADIUS_PX).toBe(12);
  });

  it('12px 이내의 점을 찾는다', () => {
    expect(pick(one, 1, 210, 150)).toBe(0); // 가로 10px
    expect(pick(one, 1, 200, 141)).toBe(0); // 세로 9px
    expect(pick(one, 1, 208, 158)).toBe(0); // 대각선 sqrt(64 + 64) = 11.3px
    expect(pick(one, 1, 212, 150)).toBe(0); // 정확히 12px 은 "이내"다(좌표가 정확해 제곱 거리가 딱 144)
  });

  it('12px 밖이면 null 이다', () => {
    expect(pick(one, 1, 213, 150)).toBeNull(); // 가로 13px
    expect(pick(one, 1, 200, 163)).toBeNull(); // 세로 13px
    // 대각선 sqrt(81 + 81) = 12.7px. 축별로 따로 비교하면(9 <= 12) 잘못 찾는다
    expect(pick(one, 1, 209, 159)).toBeNull();
  });

  it('radiusPx 인자가 기본 반경을 바꾼다', () => {
    expect(pick(one, 1, 213, 150, 20)).toBe(0); // 13px, 반경 20
    expect(pick(one, 1, 210, 150, 5)).toBeNull(); // 10px, 반경 5
  });

  it('점이 없으면 null 이다', () => {
    expect(pick(makeData([]), 1, 200, 150)).toBeNull();
  });
});

describe('pickNearest: 화면상 최근접', () => {
  // 0: (5, 3, 1)             -> (200, 150)
  // 1: (5 + 32/1024, 3, 1)   -> clip.x = 0.03125 -> 화면 x = 1.03125 * 200 = 206.25 -> (206.25, 150)
  // 2: (5, 3, 1 + 32/1024)   -> clip.y = 0.03125 -> 화면 y = 0.96875 * 150 = 145.3125 -> (200, 145.3125)
  const three = makeData([[5, 3, 1, 0], [5.03125, 3, 1, 0], [5, 3, 1.03125, 0]]);

  it('반경 안의 여러 점 중 화면 거리가 가장 짧은 점을 고른다(먼저 나온 점이 아니다)', () => {
    expect(pick(three, 1, 204, 150)).toBe(1); // 거리 4 / 2.25 / 6.2
    expect(pick(three, 1, 201, 147)).toBe(2); // 제곱 거리 10 / 36.6 / 3.8
    expect(pick(three, 1, 199, 152)).toBe(0); // 제곱 거리 5 / 56.6 / 45.7
  });

  it('z 가 큰 점이 화면 위쪽(y 가 작은 쪽)에 있다', () => {
    expect(pick(three, 1, 200, 140)).toBe(2); // 점 2 까지 5.3px, 점 0 까지 10px
    expect(pick(three, 1, 200, 160)).toBe(0); // 점 0 까지 10px, 점 2 는 14.7px 로 반경 밖
  });

  it('화면 거리가 같으면 카메라에 가까운 점(클립 w 가 작은 점)을 고른다', () => {
    // 같은 시선 위의 두 점: near (5.5, 3, 1.25) 는 w = 1, clip = (0.5, 0.25)
    //                      far  (6, 4, 1.5)    는 w = 2, clip = (1, 0.5) -> 나누면 같은 (0.5, 0.25)
    // 둘 다 화면 (300, 112.5). 커서 (303, 116.5) 에서 제곱 거리가 정확히 25 로 같다
    const near: Pt = [5.5, 3, 1.25, 0];
    const far: Pt = [6, 4, 1.5, 0];
    expect(pick(makeData([far, near]), 1, 303, 116.5)).toBe(1); // 먼저 나온 점이 이기면 0 이 된다
    expect(pick(makeData([near, far]), 1, 303, 116.5)).toBe(0); // 나중 점이 이기면 1 이 된다
  });

  it('카메라 뒤(w <= 0)의 점은 찾지 않는다', () => {
    // (5, 1, 1): w = -1, clip = (0, 0) -> 나누면 화면 중심에 겹쳐 보이지만 카메라 뒤다
    expect(pick(makeData([[5, 1, 1, 0]]), 1, 200, 150)).toBeNull();
    // (5, 2, 1): w = 0
    expect(pick(makeData([[5, 2, 1, 0]]), 1, 200, 150)).toBeNull();
    // 뒤의 점은 건너뛰고 앞의 점을 찾는다
    expect(pick(makeData([[5, 1, 1, 0], [5, 3, 1, 0]]), 1, 200, 150)).toBe(1);
  });
});

describe('pickNearest: 편차 과장(표시 높이 z + dev * (k - 1))', () => {
  // dev = +1000 은 +100.0mm = 0.1m. 실제 위치 (5, 3, 1) -> 화면 (200, 150)
  const up = makeData([[5, 3, 1, 1000]]);
  const down = makeData([[5, 3, 1, -1000]]);

  it('k = 1 이면 실제 위치에서 찾는다', () => {
    // dev * k 로 잘못 올리면 z = 1.1 -> 화면 y = 135 가 되어 15px 밖으로 나간다
    expect(pick(up, 1, 200, 150)).toBe(0);
    expect(pick(down, 1, 200, 150)).toBe(0);
  });

  it('양의 편차는 k 가 커지면 화면 위로 옮겨 간 자리에서 찾는다', () => {
    // k = 10: z' = 1 + 0.1 * 9 = 1.9 -> clip.y = 0.9 -> 화면 y = 0.1 * 150 = 15
    expect(pick(up, 10, 200, 15)).toBe(0);
    expect(pick(up, 10, 200, 150)).toBeNull(); // 실제 위치에는 이제 없다
    // k = 50: z' = 1 + 0.1 * 49 = 5.9 -> clip.y = 4.9 -> 화면 y = -3.9 * 150 = -585 (영역 밖)
    expect(pick(up, 50, 200, 15)).toBeNull();
    expect(pick(up, 50, 200, -585)).toBe(0);
  });

  it('음의 편차는 화면 아래로 옮겨 간다', () => {
    // k = 10: z' = 1 - 0.9 = 0.1 -> clip.y = -0.9 -> 화면 y = 1.9 * 150 = 285
    expect(pick(down, 10, 200, 285)).toBe(0);
    expect(pick(down, 10, 200, 15)).toBeNull(); // 부호를 뒤집으면 여기서 찾힌다
  });

  it('편차 없는 점(두 센티널)은 과장에도 제자리다', () => {
    // 센티널을 편차로 읽으면 -32768 * 1e-4 * 99 = -324m 만큼 내려가 반경 밖으로 사라진다
    for (const sentinel of [DEV_NOT_FLOOR, DEV_NO_DEVIATION]) {
      const d = makeData([[5, 3, 1, sentinel]]);
      for (const k of [1, 10, 50, 100]) expect(pick(d, k, 200, 150)).toBe(0);
    }
  });

  it('같은 자리의 편차 있는 점과 편차 없는 점이 과장에서 갈라진다', () => {
    const mixed = makeData([[5, 3, 1, DEV_NOT_FLOOR], [5, 3, 1, 1000], [5, 3, 1, DEV_NO_DEVIATION]]);
    expect(pick(mixed, 10, 200, 15)).toBe(1); // 편차 있는 점만 올라갔다
    expect(pick(mixed, 10, 200, 150)).toBe(0); // 제자리에 남은 것은 센티널 점(동률이면 앞 인덱스)
  });
});

describe('pickNearest: 실제 궤도 카메라', () => {
  it('project 가 준 표시 위치에서 그 점 자신을 찾는다(세 프리셋, k = 1 과 50)', () => {
    const extent: [number, number, number] = [8, 6, 0.5];
    const pts: Pt[] = [
      [1, 1, 0.1, 30], [7, 1, 0.2, -80], [1, 5, 0.3, 0],
      [7, 5, 0.4, DEV_NOT_FLOOR], [4, 3, 0.25, 120], [2.5, 4, 0.05, DEV_NO_DEVIATION],
    ];
    const data = makeData(pts, extent);
    const full: Bounds = { min: [0, 0, 0], max: extent };
    for (const preset of ['iso', 'top', 'front'] as const) {
      const vp = viewProj(fitToBounds(full, preset), 640 / 480, full);
      for (const k of [1, 50]) {
        pts.forEach(([, , , d], i) => {
          // 양자화된 좌표에서 표시 위치를 따로 계산해 project 로 화면에 옮긴다
          const x = (data.xyz[3 * i] * extent[0]) / 65535;
          const y = (data.xyz[3 * i + 1] * extent[1]) / 65535;
          const z = (data.xyz[3 * i + 2] * extent[2]) / 65535;
          const shownZ = d > DEV_NO_DEVIATION ? z + d * 1e-4 * (k - 1) : z;
          const s = project(vp, [x, y, shownZ], 640, 480);
          expect(s).not.toBeNull();
          expect(pickNearest(data, vp, k, 640, 480, s!.x, s!.y)).toBe(i);
        });
      }
    }
  });
});

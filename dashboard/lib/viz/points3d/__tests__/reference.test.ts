// 3D 뷰어 기준면(2026-10-20 바닥 기준면 개선): reference_surfaces.json 읽기, 쌍선형 보간, 점 편차 기준 전환, 반투명 면 그물
import { describe, expect, it } from 'vitest';
import {
  buildSurfaceMesh, devForBasis, parseReferenceSurfaces, surfaceOffset,
} from '../reference';
import type { RefSurfaces } from '../reference';
import type { Points3dData } from '@/lib/domain/points3d';
import type { ResidualGrid } from '@/lib/viz/deviation-grid';

const doc = (over: Record<string, unknown> = {}) => ({
  step_m: 0.25, cols: 2, rows: 2, origin_m: [100, 200, 3],
  local: [10, 20, 30, 40], global: [0, 0, 0, null], zones: [1, 1, 2, null], ...over,
});

describe('parseReferenceSurfaces', () => {
  it('높이를 m 단위 Float32Array 로 바꾸고 null 은 NaN', () => {
    const s = parseReferenceSurfaces(doc())!;
    expect([s.stepM, s.cols, s.rows]).toEqual([0.25, 2, 2]);
    expect(s.originM).toEqual([100, 200, 3]);
    expect(Array.from(s.local)).toEqual([0.001, 0.002, 0.003, 0.004].map((v) => Math.fround(v)));
    expect(Number.isNaN(s.global[3])).toBe(true);
    expect(Array.from(s.zones)).toEqual([1, 1, 2, 0]);   // null = 0(바닥 아님)
  });
  it('길이·원점·간격이 맞지 않으면 null', () => {
    expect(parseReferenceSurfaces(doc({ local: [1, 2, 3] }))).toBeNull();
    expect(parseReferenceSurfaces(doc({ origin_m: [1, 2] }))).toBeNull();
    expect(parseReferenceSurfaces(doc({ step_m: 0 }))).toBeNull();
    expect(parseReferenceSurfaces(doc({ global: ['x', 0, 0, 0] }))).toBeNull();
    expect(parseReferenceSurfaces(doc({ zones: [1, 1, 1] }))).toBeNull();
    expect(parseReferenceSurfaces(null)).toBeNull();
  });
});

// 4x3 마디, 높이 = 0.01 x (마디 x). 마디 (i, j) 위치 = ((i + 0.5) x 0.25, (j + 0.5) x 0.25)
function planeSurf(): RefSurfaces {
  const cols = 4, rows = 3, step = 0.25;
  const local = new Float32Array(cols * rows);
  const glob = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    local[j * cols + i] = 0.01 * (i + 0.5) * step;
    glob[j * cols + i] = 0.002;
  }
  return { stepM: step, cols, rows, originM: [0, 0, 0], local, global: glob, zones: new Int32Array(cols * rows).fill(1) };
}

describe('surfaceOffset', () => {
  it('기준면 원점 − 점 파일 원점(= 기준면 좌표를 점 좌표로 옮기는 양)', () => {
    const s = { ...planeSurf(), originM: [100, 200, 3] as [number, number, number] };
    expect(surfaceOffset(s, [100.5, 199, 2.9])).toEqual([-0.5, 1, 0.10000000000000009]);
  });
});

function pointsData(xs: number[], dev: number[], extent: [number, number, number] = [1, 1, 1]): Points3dData {
  const xyz = new Uint16Array(xs.length * 3);
  xs.forEach((x, i) => { xyz[3 * i] = Math.round((x / extent[0]) * 65535); xyz[3 * i + 1] = Math.round((0.25 / extent[1]) * 65535); });
  return {
    meta: { extent_m: extent, origin_m: [0, 0, 0] } as unknown as Points3dData['meta'],
    xyz, dev: Int16Array.from(dev),
  };
}

// 전체 기준 점 편차 = 그 점 서브셀의 values_global(엔진 값 그대로). 기준면 보간은 단차 근처에서 두 면을 섞어
// 2D 편차맵과 cm 단위로 어긋났다(리뷰 실측 2026-10-20)
function grid(valuesGlobal: (number | null)[], cols = 4, rows = 3): ResidualGrid {
  return { subcell_m: 0.25, cols, rows, values: valuesGlobal.map(() => 0), values_global: valuesGlobal };
}

describe('devForBasis', () => {
  it('국부는 받은 편차 그대로(같은 배열)', () => {
    const d = pointsData([0.3], [12]);
    expect(devForBasis(d, planeSurf(), grid(Array(12).fill(5)), 'local')).toBe(d.dev);
  });
  it('전체는 점이 든 서브셀의 values_global, 센티널은 그대로', () => {
    // 점 x 0.3, y 0.25 -> 서브셀 (1, 1) = 4 x 1 + 1 = 5 번째
    const vg = Array.from({ length: 12 }, (_, i) => i * 10);
    const d = pointsData([0.3, 0.3, 0.3], [12, -32768, -32767]);
    expect(Array.from(devForBasis(d, planeSurf(), grid(vg), 'global'))).toEqual([50, -32768, -32767]);
  });
  it('기준면 원점과 점 파일 원점이 다르면 그만큼 옮겨 서브셀을 찾는다', () => {
    const s = { ...planeSurf(), originM: [-0.25, 0, 0] as [number, number, number] };   // 격자 원점이 점보다 0.25m 앞
    const vg = Array.from({ length: 12 }, (_, i) => i * 10);
    expect(Array.from(devForBasis(pointsData([0.3], [12]), s, grid(vg), 'global'))).toEqual([60]);   // (2, 1)
  });
  it('값 없는 서브셀(null)의 점은 편차 없음(-32767)', () => {
    expect(Array.from(devForBasis(pointsData([0.3], [12]), planeSurf(), grid(Array(12).fill(null)), 'global')))
      .toEqual([-32767]);
  });
});

describe('buildSurfaceMesh', () => {
  const two = (): RefSurfaces => ({
    stepM: 0.25, cols: 2, rows: 2, originM: [0, 0, 0],
    local: Float32Array.from([0.001, 0.001, 0.001, 0.001]),
    global: Float32Array.from([0.004, 0.004, 0.004, 0.004]),
    zones: Int32Array.from([1, 1, 1, 1]),
  });
  it('네 마디가 다 있는 칸마다 삼각형 둘(정점 6개, 정점당 x·y·기준 높이·과장할 차이)', () => {
    const v = buildSurfaceMesh(two(), 'global', 'local', [1, 2, 0.5]);
    expect(v.length).toBe(6 * 4);
    // 첫 정점 = 마디 (0,0): x = 0.125 + 1, y = 0.125 + 2, 기준(국부) 0.001 + 0.5, 차이(전체 − 국부) 0.003
    expect(Array.from(v.slice(0, 4)).map((n) => Number(n.toFixed(6)))).toEqual([1.125, 2.125, 0.501, 0.003]);
  });
  it('고른 기준면 자신은 차이가 0', () => {
    const v = buildSurfaceMesh(two(), 'local', 'local', [0, 0, 0]);
    for (let k = 3; k < v.length; k += 4) expect(v[k]).toBe(0);
  });
  it('빈 마디가 있거나 네 마디의 구역이 다르면(단차) 그 칸을 그리지 않는다', () => {
    const a = two();
    a.local[3] = NaN;
    expect(buildSurfaceMesh(a, 'local', 'local', [0, 0, 0]).length).toBe(0);
    const b = two();
    b.zones[3] = 2;
    expect(buildSurfaceMesh(b, 'local', 'local', [0, 0, 0]).length).toBe(0);
  });
  it('같은 구역이면 가파른 경사(칸 안 높이차 6cm)도 이어 그린다', () => {
    const c = two();
    c.local.set([0, 0.06, 0, 0.06]);
    expect(buildSurfaceMesh(c, 'local', 'local', [0, 0, 0]).length).toBe(6 * 4);
  });
});

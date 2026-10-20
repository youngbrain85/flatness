// 3D 뷰어 기준면(2026-10-20 바닥 기준면 개선 스펙 §4). 순수 함수만 둔다(WebGL·DOM 무관).
// - reference_surfaces.json: 25cm 마디 위 국부(1m 창)·전체(바닥 전체 평면) 기준면 높이(0.1mm 정수|null).
//   마디 (i, j) 위치 = ((i + 0.5) x step, (j + 0.5) x step), 좌표틀 원점의 절대 좌표 = origin_m.
// - 점 파일(points3d.bin)의 편차는 국부 기준이다. 전체 기준으로 볼 때는 그 점이 든 5cm 서브셀의 values_global
//   (residual_grid.json, 엔진 값 그대로)을 쓴다. 기준면 보간은 단차 근처에서 두 면을 섞어 2D 편차맵과 어긋났다.
// - 반투명 면은 고른 기준면 R 위에 그린다: 정점 높이 = R + 과장 x (S − R). 점의 표시 높이(R + 과장 x 편차)와 맞물린다.
import { DEV_NO_DEVIATION } from '@/lib/domain/points3d';
import type { Points3dData } from '@/lib/domain/points3d';
import type { ResidualGrid } from '@/lib/viz/deviation-grid';

export type RefBasis = 'local' | 'global';

export interface RefSurfaces {
  stepM: number;
  cols: number;
  rows: number;
  originM: [number, number, number];   // 기준면 좌표틀 원점의 절대 좌표(m)
  local: Float32Array;                 // 마디 높이(m), 바닥이 아니면 NaN
  global: Float32Array;
  zones: Int32Array;                   // 마디의 구역 번호(0 = 바닥 아님). 구역이 다른 마디 사이 칸은 그리지 않는다
}

const DEV_MAX = 32767;
const DEV_MIN_VALID = -32766;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function heights(v: unknown, n: number): Float32Array | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = v[i];
    if (x === null) out[i] = NaN;
    else if (isNum(x)) out[i] = x * 1e-4;
    else return null;
  }
  return out;
}

/** reference_surfaces.json 을 읽는다. 모양이 다르면 null(뷰어는 기준면 줄을 숨긴다). */
export function parseReferenceSurfaces(json: unknown): RefSurfaces | null {
  if (!json || typeof json !== 'object') return null;
  const d = json as Record<string, unknown>;
  const { step_m: step, cols, rows, origin_m: origin } = d;
  if (!isNum(step) || !(step > 0)) return null;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || (cols as number) <= 0 || (rows as number) <= 0) return null;
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(isNum)) return null;
  const n = (cols as number) * (rows as number);
  const local = heights(d.local, n);
  const glob = heights(d.global, n);
  if (!local || !glob) return null;
  if (!Array.isArray(d.zones) || d.zones.length !== n) return null;
  const zones = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const z = d.zones[i];
    if (z === null) zones[i] = 0;
    else if (Number.isInteger(z) && z > 0) zones[i] = z;
    else return null;
  }
  return {
    stepM: step, cols: cols as number, rows: rows as number,
    originM: [origin[0], origin[1], origin[2]], local, global: glob, zones,
  };
}

/** 기준면 좌표를 점 파일 좌표로 옮기는 양 = 기준면 원점 − 점 파일 원점(절대 좌표, m). */
export function surfaceOffset(s: RefSurfaces, pointsOriginM: [number, number, number]): [number, number, number] {
  return [s.originM[0] - pointsOriginM[0], s.originM[1] - pointsOriginM[1], s.originM[2] - pointsOriginM[2]];
}

/** 고른 기준의 점 편차(0.1mm 정수). 국부는 받은 배열 그대로, 전체는 그 점이 든 서브셀의 values_global.
 *  서브셀은 기준면 좌표틀(= 서브셀 격자 원점)에서 엔진과 같이 자름·끝 맞춤으로 찾는다. 값 없는 칸은 편차 없음. */
export function devForBasis(data: Points3dData, s: RefSurfaces, grid: ResidualGrid, basis: RefBasis): Int16Array {
  if (basis === 'local' || !grid.values_global) return data.dev;
  const vg = grid.values_global;
  const [dx, dy] = surfaceOffset(s, data.meta.origin_m);
  const [ex, ey] = data.meta.extent_m;
  const out = new Int16Array(data.dev.length);
  for (let i = 0; i < data.dev.length; i++) {
    const d = data.dev[i];
    if (d <= DEV_NO_DEVIATION) { out[i] = d; continue; }   // 센티널(바닥 아님·편차 없음)은 그대로
    const x = (data.xyz[3 * i] / 65535) * ex - dx;
    const y = (data.xyz[3 * i + 1] / 65535) * ey - dy;
    const ix = Math.min(grid.cols - 1, Math.max(0, Math.trunc(x / grid.subcell_m)));
    const iy = Math.min(grid.rows - 1, Math.max(0, Math.trunc(y / grid.subcell_m)));
    const v = vg[iy * grid.cols + ix];
    out[i] = v === null ? DEV_NO_DEVIATION : Math.min(DEV_MAX, Math.max(DEV_MIN_VALID, v));
  }
  return out;
}

/** 기준면 which 를 고른 기준 basis 위에 그릴 삼각형 정점(정점당 x, y, 기준 높이, 과장할 차이). 점 파일 좌표(m).
 *  네 마디가 다 있고 같은 구역인 칸만 그린다(구역이 다른 마디 사이 = 단차를 잇는 벽처럼 보이지 않게). */
export function buildSurfaceMesh(
  s: RefSurfaces, which: RefBasis, basis: RefBasis, offset: [number, number, number],
): Float32Array {
  const top = s[which], base = s[basis];
  const out: number[] = [];
  const at = (i: number, j: number) => j * s.cols + i;
  for (let j = 0; j + 1 < s.rows; j++) {
    for (let i = 0; i + 1 < s.cols; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      const quad = [a, b, c, d];
      if (quad.some((k) => Number.isNaN(top[k]) || Number.isNaN(base[k]))) continue;
      if (quad.some((k) => s.zones[k] === 0 || s.zones[k] !== s.zones[a])) continue;
      for (const k of [a, b, d, a, d, c]) {
        const ki = k % s.cols, kj = Math.floor(k / s.cols);
        out.push((ki + 0.5) * s.stepM + offset[0], (kj + 0.5) * s.stepM + offset[1],
          base[k] + offset[2], top[k] - base[k]);
      }
    }
  }
  return Float32Array.from(out);
}

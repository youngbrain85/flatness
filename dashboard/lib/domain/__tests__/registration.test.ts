// 정합 도메인 (단계 F Task 5) - 대응점 직렬화 / 참 중첩 환산 / 겹쳐보기 기하
import { describe, expect, it } from 'vitest';
import {
  ICP_TRIM_RATIO, MIN_CORRESPONDENCES, imageCornersM, overlayAffine, overlayView,
  toCorrespondences, trueOverlapPct,
} from '../registration';
import type { HeightViewMeta } from '../height-view';

// A: shape [ny=3, nx=5], 5단위 격자, 원점 (10, 20) -> 월드 x 10..35, y 20..35
const META_A: HeightViewMeta = {
  schema_version: 1, bbox_min: [10, 20, 0], bbox_max: [35, 35, 1],
  subcell_m_file: 5, shape: [3, 5],
  median_z: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
};
// B: shape [ny=2, nx=4], 2단위 격자, 원점 (0, 0) -> 월드 x 0..8, y 0..4
const META_B: HeightViewMeta = {
  schema_version: 1, bbox_min: [0, 0, 0], bbox_max: [8, 4, 1],
  subcell_m_file: 2, shape: [2, 4],
  median_z: [[0, 0, 0, 0], [0, 0, 0, 0]],
};

/** 4x4 동차 변환. r은 2x2 회전(상단 좌측), t는 평행이동. */
function transform4(r: number[][], t: [number, number]): number[][] {
  return [
    [r[0][0], r[0][1], 0, t[0]],
    [r[1][0], r[1][1], 0, t[1]],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}
const IDENTITY_R = [[1, 0], [0, 1]];
const ROT90 = [[0, -1], [1, 0]];

describe('대응점 직렬화 (Task 4 워커 계약)', () => {
  // worker/flatworker/registration.py correspondence_arrays:
  // [{"a": {x,y,z}, "b": {x,y,z}}, ...] / a = source_scan_ids[0], b = [1]
  it('a는 첫 번째 소스, b는 두 번째 소스이며 값은 파일 단위 월드 좌표 그대로다', () => {
    const rows = toCorrespondences([
      { a: { x: 1.5, y: -2.5, z: 0.25 }, b: { x: 100, y: 200, z: 300 } },
      { a: { x: 4, y: 5, z: 6 }, b: { x: 7, y: 8, z: 9 } },
    ]);
    expect(rows).toEqual([
      { a: { x: 1.5, y: -2.5, z: 0.25 }, b: { x: 100, y: 200, z: 300 } },
      { a: { x: 4, y: 5, z: 6 }, b: { x: 7, y: 8, z: 9 } },
    ]);
  });

  // 설계 결정 F6: z가 없는(NaN 셀) 대응점은 애초에 만들어지면 안 된다. 워커도 같은
  // 규칙을 들고 있지만(correspondence_arrays), 화면이 먼저 막는다.
  it('z가 null인 점이 섞이면 한국어 사유로 거부한다', () => {
    expect(() => toCorrespondences([
      { a: { x: 1, y: 2, z: null }, b: { x: 3, y: 4, z: 5 } },
    ])).toThrow(/높이/);
  });

  it('최소 대응점 수는 3쌍이다(스펙 §8)', () => {
    expect(MIN_CORRESPONDENCES).toBe(3);
  });
});

describe('참 중첩 환산 (스펙 §9.3.4)', () => {
  // overlap_ratio = 쓴 쌍 / len(src)인데 trimmed ICP가 항상 하위 trim_ratio만 쓴다.
  // 100% 겹쳐도 상한이 0.8이라, 그대로 "중첩률 80%"로 보여주면 사용자가
  // "80%밖에 안 겹쳤네"로 오해한다.
  it('trim_ratio 기본값은 엔진 icp_refine과 같은 0.8이다', () => {
    expect(ICP_TRIM_RATIO).toBe(0.8);
  });

  it('상한값 0.8은 참 중첩 100%다', () => {
    expect(trueOverlapPct(0.8)).toBeCloseTo(100, 6);
  });

  it('엔진 거부 임계 0.1은 참 중첩 12.5%다(스펙 §9.3.4 실측 서술과 일치)', () => {
    expect(trueOverlapPct(0.1)).toBeCloseTo(12.5, 6);
  });

  it('원값을 그대로 백분율로 쓰지 않는다', () => {
    expect(trueOverlapPct(0.4)).not.toBeCloseTo(40, 6);
    expect(trueOverlapPct(0.4)).toBeCloseTo(50, 6);
  });

  it('값이 없으면 null이다(실패로 끝나 관측치가 없는 경우)', () => {
    expect(trueOverlapPct(null)).toBeNull();
    expect(trueOverlapPct(undefined)).toBeNull();
  });

  it('계약이 깨져 상한을 넘어도 100%를 넘겨 표시하지 않는다', () => {
    expect(trueOverlapPct(0.95)).toBe(100);
  });
});

describe('겹쳐보기 기하 (RMSE만으로는 못 보는 수평 오정합을 눈으로 잡는다)', () => {
  it('무장식 PNG 네 모서리를 A 기준 미터 좌표로 옮긴다', () => {
    // 이미지 픽셀 (0,0)은 격자 iy=ny-1 행 - 즉 월드 y 최댓값 쪽이다.
    expect(imageCornersM(META_A, 1, null)).toEqual([
      [10, 35], [35, 35], [10, 20], [35, 20],
    ]);
  });

  it('두 이미지를 함께 담는 화면 좌표계를 만든다', () => {
    const b = imageCornersM(META_B, 1, transform4(IDENTITY_R, [10, 20]));
    const view = overlayView([imageCornersM(META_A, 1, null), b], 250, 250);
    // A: x 10..35, y 20..35 / B(평행이동 후): x 10..18, y 20..24 -> 합집합은 A와 같다
    expect(view.xMinM).toBeCloseTo(10, 9);
    expect(view.yMaxM).toBeCloseTo(35, 9);
    expect(view.scale).toBeCloseTo(10, 9); // min(250/25, 250/15)
    expect(view.width).toBe(250);
    expect(view.height).toBe(150);
  });

  it('A(기준 스캔)는 변환 없이 화면 좌표로 간다', () => {
    const view = { xMinM: 10, yMaxM: 35, scale: 10, width: 250, height: 150 };
    // setTransform(a,b,c,d,e,f): (u,v) -> (a*u + c*v + e, b*u + d*v + f)
    expect(overlayAffine(META_A, 1, null, view)).toEqual([50, 0, 0, 50, 0, 0]);
  });

  it('B는 정합 변환을 통과한 뒤 화면 좌표로 간다(평행이동)', () => {
    const view = { xMinM: 10, yMaxM: 35, scale: 10, width: 250, height: 150 };
    expect(overlayAffine(META_B, 1, transform4(IDENTITY_R, [10, 20]), view))
      .toEqual([20, 0, 0, 20, 0, 110]);
  });

  // 회전을 무시하는 구현(평행이동만 반영)은 b·c가 0으로 남아 여기서 잡힌다.
  it('회전 성분을 반영한다(90도)', () => {
    const view = { xMinM: -10, yMaxM: 10, scale: 1, width: 20, height: 20 };
    const [a, b, c, d, e, f] = overlayAffine(META_B, 1, transform4(ROT90, [0, 0]), view);
    expect(a).toBeCloseTo(0, 9);
    expect(b).toBeCloseTo(-2, 9);
    expect(c).toBeCloseTo(2, 9);
    expect(d).toBeCloseTo(0, 9);
    expect(e).toBeCloseTo(6, 9);
    expect(f).toBeCloseTo(10, 9);
  });

  // 사이드카 좌표는 파일 단위이고 변환은 미터다. unit_scale을 빼먹으면 mm 파일에서
  // 1000배 틀린다(워커 align_sources가 대응점에 unit_scale을 곱하는 것과 같은 이유).
  it('unit_scale로 파일 단위를 미터로 맞춘다', () => {
    const view = { xMinM: 0, yMaxM: 0.01, scale: 1000, width: 10, height: 10 };
    const [, , , , e, f] = overlayAffine(META_B, 0.001, transform4(IDENTITY_R, [0, 0]), view);
    expect(e).toBeCloseTo(0, 6);
    expect(f).toBeCloseTo(6, 6); // (0.01 - 0.004) * 1000
  });
});

// 격자·축·라벨(스펙 §7.8). 기대값은 전부 손으로 계산해 주석에 근거를 적었다.
import { describe, expect, it } from 'vitest';
import {
  AXIS_NAME_OFFSET_FRAC, LABEL_MIN_GAP_PX, MAX_GRID_LINES, MIN_AXIS_RANGE_M,
  buildScaffold, layoutLabels, niceStep,
} from '../scaffold';
import type { AxisTick } from '../scaffold';
import { fitToBounds, viewProj } from '../orbit';
import type { Bounds } from '../orbit';

// {1, 2, 5} x 10^p 수열(p = -2 .. 2). 리터럴로 적는다.
const SEQ = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

// 스펙의 선 수 식. 0.3 / 0.1 = 2.9999999999999996 같은 나눗셈 오차를 1e-9 로 흡수한다.
const lineCount = (rx: number, ry: number, step: number) =>
  Math.floor(rx / step + 1e-9) + Math.floor(ry / step + 1e-9) + 2;

// verts 의 k번째 선분(정점 2개 = 숫자 6개)
const seg = (verts: Float32Array, k: number) => Array.from(verts.subarray(k * 6, k * 6 + 6));
// 기대값을 float32 로 맞춘다(verts 가 Float32Array 라서)
const f32 = (a: number[]) => Array.from(new Float32Array(a));

const texts = (ticks: { axis: string; kind: string; text: string }[], axis: 'x' | 'y', kind: 'tick' | 'name' = 'tick') =>
  ticks.filter((t) => t.axis === axis && t.kind === kind).map((t) => t.text);

// 손 계산용 변환(열 우선). 월드 (x, y) = (0..8, 0..8) 을 800 x 800 CSS px 화면에 1m = 100px 로 놓는다.
// clipX = 0.25x - 1, clipY = 0.25y - 1, w = 1  ->  화면 x = 100x, 화면 y = 800 - 100y
function flatMatrix(): Float32Array {
  const m = new Float32Array(16);
  m[0] = 0.25; m[5] = 0.25; m[12] = -1; m[13] = -1; m[15] = 1;
  return m;
}
const xTick = (x: number, text: string): AxisTick => ({ axis: 'x', pos: [x, 4, 0], text, kind: 'tick' });

describe('상수', () => {
  // 변이: 상수 값 변경(Task 11·12 가 이 이름으로 읽는다)
  it('스펙 §2.4 의 값', () => {
    expect(MAX_GRID_LINES).toBe(40);
    expect(LABEL_MIN_GAP_PX).toBe(28);
    expect(MIN_AXIS_RANGE_M).toBe(0.1);
    expect(AXIS_NAME_OFFSET_FRAC).toBe(0.08);
  });
});

describe('niceStep', () => {
  // 변이: 선 수 상한 무시(검사 제거 -> 항상 0.01), 다음 값으로 넘어가지 않음
  it('6 x 6 m 는 0.5 (0.2 면 30+30+2 = 62 > 40, 0.5 면 12+12+2 = 26)', () => {
    expect(niceStep(6, 6)).toBe(0.5);
  });
  it('30 x 20 m 는 2 (1 이면 30+20+2 = 52 > 40, 2 면 15+10+2 = 27)', () => {
    expect(niceStep(30, 20)).toBe(2);
  });
  it('0.1 x 0.1 m 는 0.01 (10+10+2 = 22)', () => {
    expect(niceStep(0.1, 0.1)).toBe(0.01);
  });
  // 변이: 수열을 0.01 아래(0.001, 0.002, 0.005)에서 시작. 0.01 x 0.01 m 는 0.001 에서도 10+10+2 = 22 라
  // 하한이 없으면 0.001 이 나온다. 상한 100 의 0.1 x 0.1 m 도 0.005 (20+20+2 = 42) 가 나온다.
  it('0.01 아래로 내려가지 않는다', () => {
    expect(niceStep(0.01, 0.01)).toBe(0.01);
    expect(niceStep(0, 0)).toBe(0.01);
    expect(niceStep(0.1, 0.1, 100)).toBe(0.01);
  });
  // 변이: 상한이 정확히 40 일 때 거절(<= 를 < 로)
  it('선 수가 정확히 40 이면 받아들인다 (19 x 19 m, step 1: 19+19+2 = 40)', () => {
    expect(niceStep(19, 19)).toBe(1);
  });
  it('선 수가 41 이면 다음 값으로 넘어간다 (20 x 19 m, step 1: 41 -> step 2: 10+9+2 = 21)', () => {
    expect(niceStep(20, 19)).toBe(2);
  });
  // 변이: maxLines 인자 무시(상수 40 고정)
  it('maxLines 를 주면 그 상한을 쓴다 (6 x 6 m, 100: 0.1 은 122, 0.2 는 62)', () => {
    expect(niceStep(6, 6, 100)).toBe(0.2);
  });
  // 변이: floor 의 1e-9 보정 제거. 0.3 / 0.1 = 2.9999999999999996 을 그대로 floor 하면 2 가 되어
  // 0.1 에서 2+1+2 = 5 <= 5 로 받아들인다. 보정하면 3+1+2 = 6 > 5 라 0.2 (1+0+2 = 3) 로 넘어간다.
  it('나눗셈 오차를 흡수한다 (0.3 x 0.1 m, 상한 5 -> 0.2)', () => {
    expect(niceStep(0.3, 0.1, 5)).toBe(0.2);
  });
  // 성질: 수열 값이고, 선 수 40 이하이며, 그보다 작은 수열 값은 40 을 넘는다(가장 작은 값)
  // 변이: 상한을 넘는 값을 돌려줌, 조건을 만족하는 더 큰 수열 값을 돌려줌(가장 작은 값이 아님), 수열 밖의 값(예: 3 x 10^p)
  it('여러 범위에서 수열 값 · 선 수 40 이하 · 조건을 만족하는 가장 작은 값', () => {
    const ranges = [0.1, 0.37, 1, 2.5, 6, 12.3, 30, 47, 120, 999];
    for (const rx of ranges) {
      for (const ry of ranges) {
        const step = niceStep(rx, ry);
        const at = SEQ.indexOf(step);
        expect(at, `${rx} x ${ry} -> ${step}`).toBeGreaterThanOrEqual(0);
        expect(lineCount(rx, ry, step), `${rx} x ${ry} -> ${step}`).toBeLessThanOrEqual(40);
        if (at > 0) expect(lineCount(rx, ry, SEQ[at - 1]), `${rx} x ${ry} -> ${step}`).toBeGreaterThan(40);
      }
    }
  });
  // 변이: 탐색 상한(NICE_MAX_EXP) 제거 -> 조건을 만족하는 값이 없어 루프가 끝나지 않고 타임아웃으로 실패
  it('비유한 범위에서도 끝난다', () => {
    expect(Number.isFinite(niceStep(Infinity, 1))).toBe(true);
    expect(Number.isFinite(niceStep(NaN, 1))).toBe(true);
  });
});

describe('buildScaffold: 6 x 4 m (fit.min 이 원점이 아님)', () => {
  // rangeX = 6, rangeY = 4. step: 0.2 면 30+20+2 = 52 > 40, 0.5 면 12+8+2 = 22 -> 0.5
  // x 가 일정한 선 13개(i = 0..12), y 가 일정한 선 9개(j = 0..8)
  const fit: Bounds = { min: [1, 2, 0.5], max: [7, 6, 0.6] };
  const sc = buildScaffold(fit);

  // 변이: 선 수 상한 무시(step 0.01 로 정점 수 폭증), 축선을 네 변으로(axisVertCount 8), 선당 정점 1개
  it('step 과 정점 수', () => {
    expect(sc.step).toBe(0.5);
    expect(sc.gridVertCount).toBe(2 * (13 + 9));
    expect(sc.axisVertCount).toBe(4);
    expect(sc.verts).toBeInstanceOf(Float32Array);
    expect(sc.verts.length).toBe((44 + 4) * 3);
  });
  // 변이: x·y 축 바꾸기(x 선이 x 방향으로 뻗음), 선 범위를 0..range 로(fit.min 누락)
  it('x 가 일정한 선은 y = fit.min.y 에서 fit.max.y 까지', () => {
    expect(seg(sc.verts, 0)).toEqual([1, 2, 0.5, 1, 6, 0.5]);
    expect(seg(sc.verts, 1)).toEqual([1.5, 2, 0.5, 1.5, 6, 0.5]);
    expect(seg(sc.verts, 12)).toEqual([7, 2, 0.5, 7, 6, 0.5]);
  });
  // 변이: y 선을 y 방향으로 뻗게 함(축 바꾸기), 선 시작을 0 으로(fit.min.x 누락), y 선 구간을 x 선 앞에 둠
  it('y 가 일정한 선은 x = fit.min.x 에서 fit.max.x 까지', () => {
    expect(seg(sc.verts, 13)).toEqual([1, 2, 0.5, 7, 2, 0.5]);
    expect(seg(sc.verts, 14)).toEqual([1, 2.5, 0.5, 7, 2.5, 0.5]);
    expect(seg(sc.verts, 21)).toEqual([1, 6, 0.5, 7, 6, 0.5]);
  });
  // 변이: 높이를 fit.max.z·중간·0 으로
  it('모든 정점의 높이가 fit.min.z', () => {
    for (let v = 0; v < sc.verts.length / 3; v++) expect(sc.verts[v * 3 + 2]).toBe(0.5);
  });
  // 변이: 축 구간을 격자 앞에 둠, 축선을 먼 쪽 변에 그림
  it('격자 구간 뒤에 축선 두 변(x축 변, y축 변)이 온다', () => {
    const first = sc.gridVertCount / 2;
    expect(seg(sc.verts, first)).toEqual([1, 2, 0.5, 7, 2, 0.5]);
    expect(seg(sc.verts, first + 1)).toEqual([1, 2, 0.5, 1, 6, 0.5]);
  });
  // 변이: 눈금을 절대(파일-로컬) 좌표로 표기 -> 첫 눈금이 '1.0' / '2.0' 이 된다
  it('눈금 숫자는 fit 최솟값 모서리에서 0 이고 step 0.5 는 소수 1자리', () => {
    expect(texts(sc.ticks, 'x')).toEqual(
      ['0.0', '0.5', '1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0']);
    expect(texts(sc.ticks, 'y')).toEqual(['0.0', '0.5', '1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0']);
  });
  // 변이: 눈금 위치를 먼 쪽 변에, x·y 눈금 위치 바꾸기
  it('눈금 위치는 x축 변(y = fit.min.y)과 y축 변(x = fit.min.x) 위', () => {
    const xs = sc.ticks.filter((t) => t.axis === 'x' && t.kind === 'tick');
    const ys = sc.ticks.filter((t) => t.axis === 'y' && t.kind === 'tick');
    expect(xs[0].pos).toEqual([1, 2, 0.5]);
    expect(xs[3].pos).toEqual([2.5, 2, 0.5]);
    expect(xs[12].pos).toEqual([7, 2, 0.5]);
    expect(ys[0].pos).toEqual([1, 2, 0.5]);
    expect(ys[8].pos).toEqual([1, 6, 0.5]);
  });
  // 축 이름: 변의 중점에서 바깥쪽으로 0.08 x max(6, 4) = 0.48 m
  // 변이: 바깥이 아니라 안쪽으로(부호 뒤집기), 중점이 아닌 곳
  it('축 이름은 변의 중점 바깥쪽', () => {
    const names = sc.ticks.filter((t) => t.kind === 'name');
    expect(names.map((t) => `${t.axis}:${t.text}`)).toEqual(['x:x (m)', 'y:y (m)']);
    expect(names[0].pos[0]).toBeCloseTo(4, 9);
    expect(names[0].pos[1]).toBeCloseTo(2 - 0.48, 9);
    expect(names[0].pos[2]).toBe(0.5);
    expect(names[1].pos[0]).toBeCloseTo(1 - 0.48, 9);
    expect(names[1].pos[1]).toBeCloseTo(4, 9);
    expect(names[1].pos[2]).toBe(0.5);
  });
  // 변이: z축 눈금 추가(ticks 가 는다), 축 이름 누락(ticks 가 준다)
  it('z축 눈금은 만들지 않는다 (눈금 13 + 9, 이름 2)', () => {
    expect(sc.ticks.length).toBe(13 + 9 + 2);
  });
});

describe('buildScaffold: 범위가 step 의 배수가 아닐 때', () => {
  // rangeX = 6.3, rangeY = 4.2. step: 0.2 면 31+21+2 = 54 > 40, 0.5 면 12+8+2 = 22 -> 0.5
  // floor(6.3 / 0.5) = 12, floor(4.2 / 0.5) = 8. 마지막 선은 x = 6.0, y = 4.0 (fit.max 보다 안쪽)
  const sc = buildScaffold({ min: [0, 0, 0], max: [6.3, 4.2, 0] });
  // 변이: 마지막 선을 fit.max 에 강제 추가(선이 14 / 10 개가 되고 x = 6.3 선이 생긴다)
  it('먼 쪽 가장자리에는 선이 없다', () => {
    expect(sc.step).toBe(0.5);
    expect(sc.gridVertCount).toBe(2 * (13 + 9));
    expect(seg(sc.verts, 12)).toEqual(f32([6, 0, 0, 6, 4.2, 0]));
    expect(seg(sc.verts, 21)).toEqual(f32([0, 4, 0, 6.3, 4, 0]));
    expect(texts(sc.ticks, 'x').at(-1)).toBe('6.0');
    expect(texts(sc.ticks, 'y').at(-1)).toBe('4.0');
  });
  // 변이: 선 끝을 마지막 눈금(6.0 / 4.0)에서 자름
  it('선은 fit.max 까지 뻗는다', () => {
    expect(seg(sc.verts, 0)).toEqual(f32([0, 0, 0, 0, 4.2, 0]));
    expect(seg(sc.verts, 13)).toEqual(f32([0, 0, 0, 6.3, 0, 0]));
    const first = sc.gridVertCount / 2;
    expect(seg(sc.verts, first)).toEqual(f32([0, 0, 0, 6.3, 0, 0]));
    expect(seg(sc.verts, first + 1)).toEqual(f32([0, 0, 0, 0, 4.2, 0]));
  });
});

describe('buildScaffold: 나눗셈 오차', () => {
  // rangeX = 0.3, rangeY = 2. step: 0.05 면 6+40+2 = 48 > 40, 0.1 이면 3+20+2 = 25 -> 0.1
  // 0.3 / 0.1 = 2.9999999999999996. 그대로 floor 하면 x 선이 3개뿐이고 눈금 '0.3' 이 빠진다.
  // 변이: 격자 생성 쪽 floor 의 1e-9 보정 제거
  it('range 0.3, step 0.1 에서 선이 4개다', () => {
    const sc = buildScaffold({ min: [0, 0, 0], max: [0.3, 2, 0] });
    expect(sc.step).toBe(0.1);
    expect(texts(sc.ticks, 'x')).toEqual(['0.0', '0.1', '0.2', '0.3']);
    expect(sc.gridVertCount).toBe(2 * (4 + 21));
    expect(sc.verts[3 * 6]).toBeCloseTo(0.3, 6);
  });
});

describe('buildScaffold: 눈금 자릿수', () => {
  // 30 x 20 m -> step 2 (niceStep 테스트 참고). step >= 1 은 정수
  // 변이: 자릿수를 1 로 고정('0.0', '2.0', ...), step 2 대신 1 을 고름(선 수 상한 무시)
  it('step >= 1 이면 정수', () => {
    const sc = buildScaffold({ min: [0, 0, 0], max: [30, 20, 0] });
    expect(sc.step).toBe(2);
    expect(texts(sc.ticks, 'x')).toEqual(
      ['0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24', '26', '28', '30']);
    expect(texts(sc.ticks, 'y').at(-1)).toBe('20');
  });
  // 1 x 0.6 m. step: 0.02 면 50+30+2 = 82 > 40, 0.05 면 20+12+2 = 34 -> 0.05. 소수 2자리
  // 0.6 / 0.05 = 11.999999999999998 이라 y 쪽은 floor 보정도 함께 본다(보정이 없으면 '0.60' 이 빠진다)
  // 변이: 자릿수를 1로 고정('0.1' 이 두 번 나온다), 격자 생성 쪽 floor 의 1e-9 보정 제거
  it('step 0.05 는 소수 2자리', () => {
    const sc = buildScaffold({ min: [0, 0, 0], max: [1, 0.6, 0] });
    expect(sc.step).toBe(0.05);
    expect(texts(sc.ticks, 'x').slice(0, 4)).toEqual(['0.00', '0.05', '0.10', '0.15']);
    expect(texts(sc.ticks, 'x').at(-1)).toBe('1.00');
    expect(texts(sc.ticks, 'x').length).toBe(21);
    expect(texts(sc.ticks, 'y').at(-1)).toBe('0.60');
    expect(texts(sc.ticks, 'y').length).toBe(13);
  });
});

describe('buildScaffold: 0.1m 미만 축', () => {
  // x 범위 0.04 < 0.1 -> fit.min.x = 2 를 고정하고 max 를 2.1 로 본다. rangeY = 2.
  // step: 0.05 면 2+40+2 = 44 > 40, 0.1 이면 1+20+2 = 23 -> 0.1
  const sc = buildScaffold({ min: [2, 3, 1], max: [2.04, 5, 1] });
  // 변이: 보정 제거(x 선 1개, 선 끝 2.04), 가운데를 기준으로 늘림(min 이 1.97 로 움직임)
  it('fit.min 을 고정한 채 0.1m 로 본다', () => {
    expect(sc.step).toBe(0.1);
    expect(texts(sc.ticks, 'x')).toEqual(['0.0', '0.1']);
    expect(sc.gridVertCount).toBe(2 * (2 + 21));
    expect(seg(sc.verts, 0)).toEqual(f32([2, 3, 1, 2, 5, 1]));
    expect(seg(sc.verts, 1)).toEqual(f32([2.1, 3, 1, 2.1, 5, 1]));
    // y 가 일정한 첫 선과 x축 변도 보정한 max(2.1)까지
    expect(seg(sc.verts, 2)).toEqual(f32([2, 3, 1, 2.1, 3, 1]));
    expect(seg(sc.verts, sc.gridVertCount / 2)).toEqual(f32([2, 3, 1, 2.1, 3, 1]));
  });
  // 변이: 축 이름 중점에 보정 전 max 를 씀(x 중점 2.02), 안쪽으로 띄움(부호 뒤집기)
  it('축 이름 위치도 보정한 범위를 쓴다 (중점 2.05, 바깥 0.08 x 2 = 0.16)', () => {
    const [xName, yName] = sc.ticks.filter((t) => t.kind === 'name');
    expect(xName.pos[0]).toBeCloseTo(2.05, 9);
    expect(xName.pos[1]).toBeCloseTo(3 - 0.16, 9);
    expect(yName.pos[0]).toBeCloseTo(2 - 0.16, 9);
    expect(yName.pos[1]).toBeCloseTo(4, 9);
  });
  // 두 축 다 0 이어도 0.1 x 0.1 m 로 보고 step 0.01, 선 11 + 11
  // 변이: y 쪽 0.1m 보정 제거(y 선이 1개뿐이라 정점 수가 2 x (11 + 1)), 범위 0 을 그대로 나눔
  it('한 점뿐인 fit 에서도 유한한 격자를 낸다', () => {
    const one = buildScaffold({ min: [5, 5, 2], max: [5, 5, 2] });
    expect(one.step).toBe(0.01);
    expect(one.gridVertCount).toBe(2 * (11 + 11));
    expect(Array.from(one.verts).every(Number.isFinite)).toBe(true);
    expect(seg(one.verts, 10)).toEqual(f32([5.1, 5, 2, 5.1, 5.1, 2]));
  });
});

describe('layoutLabels: 손 계산 변환 (1m = 100px, 800 x 800)', () => {
  const m = flatMatrix();

  // 변이: y 를 뒤집지 않음(y = 300 이 나온다), x·y 를 바꿔 씀(x = 500)
  it('월드 위치를 CSS px 로 옮긴다 (y 는 아래로 증가)', () => {
    const out = layoutLabels([{ axis: 'x', pos: [2, 3, 0], text: 'a', kind: 'tick' }], m, 800, 800);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ axis: 'x', kind: 'tick', text: 'a' });
    expect(out[0].x).toBeCloseTo(200, 6);
    expect(out[0].y).toBeCloseTo(500, 6);
  });
  // 변이: 솎기 제거(4개 다 남음), 직전에 '남긴' 라벨이 아니라 직전 눈금과 비교(첫 것만 남음)
  it('같은 축에서 직전에 남긴 라벨과 28px 미만이면 건너뛴다 (20px 간격 -> 0, 40 만 남는다)', () => {
    const ticks = [xTick(1, 'a'), xTick(1.2, 'b'), xTick(1.4, 'c'), xTick(1.6, 'd')];
    expect(layoutLabels(ticks, m, 800, 800).map((l) => l.text)).toEqual(['a', 'c']);
  });
  // 변이: 최소 간격 상수 바꾸기
  it('27px 는 건너뛰고 29px 는 남긴다', () => {
    expect(layoutLabels([xTick(1, 'a'), xTick(1.27, 'b')], m, 800, 800).map((l) => l.text)).toEqual(['a']);
    expect(layoutLabels([xTick(1, 'a'), xTick(1.29, 'b')], m, 800, 800).map((l) => l.text)).toEqual(['a', 'b']);
  });
  // 변이: 축 구분 없이 솎기(같은 모서리의 y축 0 이 사라진다)
  it('다른 축의 라벨과는 겹쳐도 솎지 않는다', () => {
    const ticks: AxisTick[] = [
      { axis: 'x', pos: [1, 1, 0], text: 'x0', kind: 'tick' },
      { axis: 'y', pos: [1, 1, 0], text: 'y0', kind: 'tick' },
    ];
    expect(layoutLabels(ticks, m, 800, 800).map((l) => l.text)).toEqual(['x0', 'y0']);
  });
  // 변이: 축 이름도 솎음, 축 이름이 '직전에 남긴 라벨'을 갱신함(뒤따르는 눈금 c 가 사라진다)
  it('축 이름은 솎지 않고, 솎기 기준에도 들어가지 않는다', () => {
    const ticks: AxisTick[] = [
      xTick(1, 'a'),
      { axis: 'x', pos: [1.05, 4, 0], text: 'x (m)', kind: 'name' },
      { axis: 'x', pos: [1.3, 4, 0], text: 'x (m) 2', kind: 'name' },
      xTick(1.4, 'c'),
    ];
    expect(layoutLabels(ticks, m, 800, 800).map((l) => l.text)).toEqual(['a', 'x (m)', 'x (m) 2', 'c']);
  });
  // 변이: 영역 검사 제거. 화면 x = -50, 850 / 화면 y = -50(월드 y 8.5), 850(월드 y -0.5)
  it('영역 밖 라벨은 숨긴다', () => {
    const ticks: AxisTick[] = [
      xTick(-0.5, 'left'), xTick(8.5, 'right'),
      { axis: 'y', pos: [4, 8.5, 0], text: 'above', kind: 'tick' },
      { axis: 'y', pos: [4, -0.5, 0], text: 'below', kind: 'tick' },
      { axis: 'x', pos: [-0.5, 4, 0], text: 'x (m)', kind: 'name' },
      xTick(4, 'in'),
    ];
    expect(layoutLabels(ticks, m, 800, 800).map((l) => l.text)).toEqual(['in']);
  });
  // 변이: 숨긴 라벨이 솎기 기준이 됨(영역 밖 -0.1 에서 10px 떨어진 0.0 이 사라진다)
  it('숨긴 라벨은 솎기 기준이 되지 않는다', () => {
    const ticks = [xTick(-0.1, 'out'), xTick(0, 'edge'), xTick(0.5, 'next')];
    expect(layoutLabels(ticks, m, 800, 800).map((l) => l.text)).toEqual(['edge', 'next']);
  });
  // w = x 인 변환: x <= 0 인 점은 카메라 뒤(w <= 0), x > 0 인 점은 화면 한가운데
  // 변이: 카메라 뒤 라벨 표시(null 검사 제거)
  it('카메라 뒤(w <= 0) 라벨은 숨긴다', () => {
    const behind = new Float32Array(16);
    behind[3] = 1;
    const ticks = [xTick(-1, 'behind'), xTick(0, 'on-plane'), xTick(2, 'front')];
    const out = layoutLabels(ticks, behind, 800, 600);
    expect(out.map((l) => l.text)).toEqual(['front']);
    expect(out[0].x).toBeCloseTo(400, 6);
    expect(out[0].y).toBeCloseTo(300, 6);
  });
});

describe('layoutLabels: 실제 카메라(평면 시점)', () => {
  // 6 x 4 m, step 0.5. 평면 시점에서 화면의 m 당 px = cssH / (2 x distance x tan(FOVY / 2)).
  // radius = sqrt(36 + 16 + 0.01) / 2 = 3.606, distance = 3.606 / sin(20도) x 1.05 = 11.07,
  // 화면 세로가 담는 높이 = 2 x 11.07 x tan(20도) = 8.06 m.
  const fit: Bounds = { min: [1, 2, 0.5], max: [7, 6, 0.6] };
  const sc = buildScaffold(fit);
  const cam = fitToBounds(fit, 'top');
  const vp = viewProj(cam, 4 / 3, fit);

  // 600px / 8.06m = 74 px/m -> 눈금 간격 37px >= 28px 라 전부 남는다
  // 변이: 최소 간격을 37px 보다 크게(눈금이 솎인다), 영역 검사의 부등호 뒤집기(전부 숨김), 축 이름 누락
  it('800 x 600 에서는 눈금이 전부 보인다', () => {
    const out = layoutLabels(sc.ticks, vp, 800, 600);
    expect(texts(out, 'x').length).toBe(13);
    expect(texts(out, 'y').length).toBe(9);
    expect(texts(out, 'x', 'name')).toEqual(['x (m)']);
    expect(texts(out, 'y', 'name')).toEqual(['y (m)']);
  });
  // 300px / 8.06m = 37 px/m -> 눈금 간격 18.6px < 28px, 두 칸 37px >= 28px 라 하나 걸러 남는다
  it('400 x 300 에서는 하나 걸러 남는다', () => {
    const out = layoutLabels(sc.ticks, vp, 400, 300);
    expect(texts(out, 'x')).toEqual(['0.0', '1.0', '2.0', '3.0', '4.0', '5.0', '6.0']);
    expect(texts(out, 'y')).toEqual(['0.0', '1.0', '2.0', '3.0', '4.0']);
    expect(out.filter((l) => l.kind === 'name').length).toBe(2);
  });
  // 평면 시점은 화면 오른쪽이 +x, 위가 +y. 축 이름은 변의 바깥(x 이름은 x축 변 아래, y 이름은 y축 변 왼쪽)
  // 변이: 축 이름을 안쪽에 둠, x·y 눈금 위치 바꾸기
  it('x 눈금은 오른쪽으로, y 눈금은 위로 가고 축 이름은 바깥에 있다', () => {
    const out = layoutLabels(sc.ticks, vp, 800, 600);
    const xs = out.filter((l) => l.axis === 'x' && l.kind === 'tick');
    const ys = out.filter((l) => l.axis === 'y' && l.kind === 'tick');
    for (let i = 1; i < xs.length; i++) expect(xs[i].x).toBeGreaterThan(xs[i - 1].x);
    for (let j = 1; j < ys.length; j++) expect(ys[j].y).toBeLessThan(ys[j - 1].y);
    const xName = out.find((l) => l.axis === 'x' && l.kind === 'name')!;
    const yName = out.find((l) => l.axis === 'y' && l.kind === 'name')!;
    expect(xName.y).toBeGreaterThan(xs[0].y);
    expect(yName.x).toBeLessThan(ys[0].x);
  });
  // 평면 시점의 카메라는 target 위 distance 높이에 있다. 그보다 더 위의 점은 카메라 뒤다.
  // 변이: project 의 null 검사 제거(w 가 음수인 점을 w 로 나누면 화면 안 좌표가 나올 수 있다)
  it('카메라보다 위에 있는 라벨은 숨긴다', () => {
    const above: AxisTick = {
      axis: 'x', pos: [cam.target[0], cam.target[1], cam.target[2] + 2 * cam.distance], text: 'behind', kind: 'tick',
    };
    expect(layoutLabels([above], vp, 800, 600)).toEqual([]);
  });
});

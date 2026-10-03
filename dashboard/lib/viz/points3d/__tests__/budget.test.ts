// 점 크기 식과 드래그 중 점 수(LOD) 조정(스펙 §2.4, §7.2, §7.4). 기대값은 손으로 계산했다.
import { describe, expect, it } from 'vitest';
import {
  LOD_FAST_MS, LOD_FLOOR, LOD_SLOW_MS, LOD_START, MIN_POINT_CSS_PX, POINT_SIZE_FACTOR,
  initialDragCount, nextDragCount, pointSizeRange, pointWorldSizeM, pxPerUnit,
} from '../budget';

describe('상수', () => {
  // 변이: 상수 값 변경(Task 11·12 가 이 이름으로 읽는다. 아래 테스트는 리터럴로 단언하므로 그쪽도 함께 죽는다)
  it('스펙 §2.4 의 값', () => {
    expect(POINT_SIZE_FACTOR).toBe(0.55);
    expect(MIN_POINT_CSS_PX).toBe(1.5);
    expect(LOD_START).toBe(150_000);
    expect(LOD_FLOOR).toBe(20_000);
    expect(LOD_SLOW_MS).toBe(33);
    expect(LOD_FAST_MS).toBe(20);
  });
});

describe('점 크기', () => {
  // 0.55 x 0.0125 = 0.006875, 0.55 x 0.02 = 0.011. 변이: 계수를 0.5 로, sample_cell_m 을 곱하지 않음
  it('pointWorldSizeM 은 0.55 x sample_cell_m', () => {
    expect(pointWorldSizeM(0.0125)).toBeCloseTo(0.006875, 12);
    expect(pointWorldSizeM(0.02)).toBeCloseTo(0.011, 12);
  });
  // fovy 90도: tan(45도) = 1 이라 960 / 2 = 480
  // 변이: tan(fovy / 2) 를 tan(fovy) 로(90도에서 발산), 분모의 2 누락(960)
  it('pxPerUnit(960, 90도) = 480', () => {
    expect(pxPerUnit(960, Math.PI / 2)).toBeCloseTo(480, 9);
  });
  // fovy 40도: tan(20도) = 0.3639702343 -> 960 / (2 x 0.3639702343) = 1318.789
  // 변이: tan 을 sin 으로(960 / (2 x sin 20도) = 1403.5), 분모의 2 누락(2637.6)
  it('pxPerUnit(960, 40도) = 1318.789', () => {
    expect(pxPerUnit(960, (40 * Math.PI) / 180)).toBeCloseTo(1318.789, 3);
  });
  // 버퍼 높이에 비례한다: 480px 은 960px 의 절반. 변이: bufferHPx 를 쓰지 않고 고정 높이를 씀
  it('버퍼 높이에 비례한다', () => {
    expect(pxPerUnit(480, Math.PI / 2)).toBeCloseTo(240, 9);
  });
  // 변이: minPx 에 배율 미적용(배율 2 에서 1.5 가 나온다)
  it('pointSizeRange 의 최소는 1.5 x 배율, 최대는 ALIASED_POINT_SIZE_RANGE 의 상한', () => {
    expect(pointSizeRange([1, 1024], 1)).toEqual([1.5, 1024]);
    expect(pointSizeRange([1, 1024], 2)).toEqual([3, 1024]);
    expect(pointSizeRange([1, 1024], 1.25)).toEqual([1.875, 1024]);
  });
  // 변이: min(…, maxPx) 제거(최소가 최대보다 커진다)
  it('최소가 최대보다 크면 최대에 맞춘다', () => {
    expect(pointSizeRange([1, 2], 2)).toEqual([2, 2]);
    expect(pointSizeRange([1, 1], 1)).toEqual([1, 1]);
  });
});

describe('LOD', () => {
  // 변이: min(n, 150_000) 을 n 으로(상한 없음), 또는 150_000 고정(n = 12 에서 150_000)
  it('initialDragCount 는 min(n, 150_000)', () => {
    expect(initialDragCount(200_000)).toBe(150_000);
    expect(initialDragCount(150_000)).toBe(150_000);
    expect(initialDragCount(12)).toBe(12);
  });
  // 변이: 증감 계수 교환(34ms 에서 125_000, 19ms 에서 70_000 이 나온다)
  it('34ms 면 x0.7, 19ms 면 x1.25, 25ms 면 그대로', () => {
    expect(nextDragCount(100_000, 200_000, 34)).toBe(70_000);
    expect(nextDragCount(100_000, 200_000, 19)).toBe(125_000);
    expect(nextDragCount(100_000, 200_000, 25)).toBe(100_000);
  });
  // 변이: > 33 을 >= 33 으로, < 20 을 <= 20 으로
  it('경계값 33ms 와 20ms 에서는 그대로', () => {
    expect(nextDragCount(100_000, 200_000, 33)).toBe(100_000);
    expect(nextDragCount(100_000, 200_000, 20)).toBe(100_000);
  });
  // 30_001 x 0.7 = 21_000.7 -> 21_001. 변이: 반올림 대신 버림(21_000)
  it('반올림한다', () => {
    expect(nextDragCount(30_001, 200_000, 34)).toBe(21_001);
  });
  // 25_000 x 0.7 = 17_500 -> 하한 20_000. 변이: 하한 clamp 제거
  it('하한은 min(n, 20_000)', () => {
    expect(nextDragCount(25_000, 200_000, 34)).toBe(20_000);
    expect(nextDragCount(20_000, 200_000, 100)).toBe(20_000);
  });
  // 180_000 x 1.25 = 225_000 -> 상한 n = 200_000. 변이: 상한 clamp 제거
  it('상한은 n', () => {
    expect(nextDragCount(180_000, 200_000, 19)).toBe(200_000);
    expect(nextDragCount(200_000, 200_000, 5)).toBe(200_000);
  });
  // n = 12_000 < 20_000: 하한도 상한도 12_000 이라 항상 n.
  // 변이: clamp 순서를 바꿔 하한 20_000 을 나중에 적용(12_000 x 0.7 = 8_400 -> 20_000 이 나와 n 을 넘는다)
  it('n < 20_000 이면 항상 n', () => {
    expect(nextDragCount(12_000, 12_000, 34)).toBe(12_000);
    expect(nextDragCount(12_000, 12_000, 19)).toBe(12_000);
    expect(nextDragCount(12_000, 12_000, 25)).toBe(12_000);
  });
  // 100_000 -> 70_000 -> 49_000 -> 34_300 -> 24_010 -> 16_807 은 하한 20_000 -> 그 뒤로 20_000
  // 변이: 하한 clamp 제거(5번째가 16_807), prev 가 아니라 n 에서 매번 다시 계산(2번째도 70_000)
  it('느린 프레임이 이어지면 하한까지 내려가 멈춘다', () => {
    const seen: number[] = [];
    let c = initialDragCount(100_000);
    for (let i = 0; i < 7; i++) {
      c = nextDragCount(c, 100_000, 40);
      seen.push(c);
    }
    expect(seen).toEqual([70_000, 49_000, 34_300, 24_010, 20_000, 20_000, 20_000]);
  });
  // 20_000 -> 25_000 -> 31_250 -> 39_063(39_062.5 반올림) -> 48_829(48_828.75) -> 61_036(61_036.25)
  // -> 76_295 -> 95_369(95_368.75) -> 119_211 은 상한 100_000
  // 변이: 반올림 대신 버림(3번째가 39_062), 상한 clamp 제거(8번째가 119_211)
  it('빠른 프레임이 이어지면 n 까지 올라가 멈춘다', () => {
    const seen: number[] = [];
    let c = 20_000;
    for (let i = 0; i < 9; i++) {
      c = nextDragCount(c, 100_000, 10);
      seen.push(c);
    }
    expect(seen).toEqual([25_000, 31_250, 39_063, 48_829, 61_036, 76_295, 95_369, 100_000, 100_000]);
  });
});

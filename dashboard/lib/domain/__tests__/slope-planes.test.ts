import { describe, expect, it } from 'vitest';
import { hasPlanes, MAX_PLANES, parsePlaneCount } from '../slope-planes';

describe('parsePlaneCount', () => {
  it('빈칸은 null(다면 분석 안 함)', () => {
    expect(parsePlaneCount('')).toBeNull();
    expect(parsePlaneCount('  ')).toBeNull();
  });
  it('1~MAX_PLANES 정수만 받는다', () => {
    expect(parsePlaneCount('1')).toBe(1);
    expect(parsePlaneCount(' 4 ')).toBe(4);
    expect(parsePlaneCount(String(MAX_PLANES))).toBe(MAX_PLANES);
    for (const bad of ['0', String(MAX_PLANES + 1), '2.5', '-1', 'abc', '1e1']) {
      expect(parsePlaneCount(bad)).toBe('invalid');
    }
  });
});

describe('hasPlanes', () => {
  it('엔진 stats.planes 형태만 통과시킨다', () => {
    expect(hasPlanes({ requested: 4, found: 4, thr_mm: 5, items: [{ plane_id: 1, grade: '적합' }] })).toBe(true);
    expect(hasPlanes(undefined)).toBe(false);
    expect(hasPlanes({ requested: 4, found: 4 })).toBe(false);
    expect(hasPlanes({ requested: 4, found: 1, items: [{ grade: '적합' }] })).toBe(false);
  });
});

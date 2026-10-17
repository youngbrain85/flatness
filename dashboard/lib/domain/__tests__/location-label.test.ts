// 측정위치 표기(스펙 §4.3): 빈 부분을 빼고 ' · '로 잇는다. '/'는 브레드크럼 단계 구분자라 쓰지 않는다.
import { describe, expect, it } from 'vitest';
import { locationCrumb } from '../location-label';

describe('locationCrumb', () => {
  it('동·층·호·위치를 순서대로 " · "로 잇는다', () => {
    expect(locationCrumb({ building: '101동', floor: '3층', room: '301호', name: '거실' }))
      .toBe('101동 · 3층 · 301호 · 거실');
  });

  it('빈 부분은 빼서 구분자가 겹치지 않는다', () => {
    expect(locationCrumb({ building: '', floor: '1층', room: '', name: '로비' })).toBe('1층 · 로비');
  });

  it('공백뿐인 부분도 비었다고 보고, 부분 앞뒤 공백은 지운다', () => {
    expect(locationCrumb({ building: ' 101동 ', floor: '  ', room: ' ', name: '거실 ' })).toBe('101동 · 거실');
  });

  it('위치 이름만 있으면 이름만 돌려준다', () => {
    expect(locationCrumb({ building: '', floor: '', room: '', name: '1층' })).toBe('1층');
  });
});

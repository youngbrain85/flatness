// 측정위치 표기(스펙 §4.3 브레드크럼): 동·층·호·위치 중 빈 부분을 빼고 ' · '로 잇는다.
// 구분자로 '/'를 쓰지 않는 이유: 브레드크럼 단계 구분자 '/'와 헷갈린다(예: 측정위치 / 101동 · 3층 · 301호 · 거실).
import type { LocationRow } from './types';

export function locationCrumb(loc: Pick<LocationRow, 'building' | 'floor' | 'room' | 'name'>): string {
  return [loc.building, loc.floor, loc.room, loc.name]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' · ');
}

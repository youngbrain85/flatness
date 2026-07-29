import { describe, expect, it } from 'vitest';
import { buildLocationTree } from '../tree';
import type { LocationRow } from '../types';

const loc = (over: Partial<LocationRow>): LocationRow => ({
  id: 'x', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '',
  memo: null, created_at: '', updated_at: '', ...over,
});

describe('buildLocationTree (동 > 층(floor_order 내림차순) > 공간 > 측정위치)', () => {
  it('동/층/공간으로 그룹핑하고 층은 floor_order 내림차순 정렬한다', () => {
    const tree = buildLocationTree([
      loc({ id: 'a', building: '101동', floor: '1F', floor_order: 1, room: '거실', name: 'P1' }),
      loc({ id: 'b', building: '101동', floor: '2F', floor_order: 2, room: '침실', name: 'P1' }),
      loc({ id: 'c', building: '101동', floor: '1F', floor_order: 1, room: '거실', name: 'P2' }),
      loc({ id: 'd', building: '102동', floor: '1F', floor_order: 1, room: '주방', name: 'P1' }),
    ]);
    expect(tree.map((b) => b.building)).toEqual(['101동', '102동']);
    expect(tree[0].floors.map((f) => f.floor)).toEqual(['2F', '1F']); // 높은 층 먼저
    const f1 = tree[0].floors[1];
    expect(f1.rooms[0].room).toBe('거실');
    expect(f1.rooms[0].locations.map((l) => l.name)).toEqual(['P1', 'P2']);
  });
  it('빈 입력은 빈 트리', () => {
    expect(buildLocationTree([])).toEqual([]);
  });
});

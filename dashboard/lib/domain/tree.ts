import type { LocationRow } from './types';

export interface RoomNode { room: string; locations: LocationRow[]; }
export interface FloorNode { floor: string; floor_order: number; rooms: RoomNode[]; }
export interface BuildingNode { building: string; floors: FloorNode[]; }

export function buildLocationTree(locations: LocationRow[]): BuildingNode[] {
  const buildings = new Map<string, Map<string, { floor_order: number; rooms: Map<string, LocationRow[]> }>>();
  for (const l of locations) {
    const b = buildings.get(l.building) ?? new Map();
    buildings.set(l.building, b);
    const f = b.get(l.floor) ?? { floor_order: l.floor_order, rooms: new Map<string, LocationRow[]>() };
    b.set(l.floor, f);
    const r = f.rooms.get(l.room) ?? [];
    r.push(l);
    f.rooms.set(l.room, r);
  }
  return [...buildings.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .map(([building, floors]) => ({
      building,
      floors: [...floors.entries()]
        .sort(([, a], [, b]) => b.floor_order - a.floor_order) // 높은 층 먼저
        .map(([floor, f]) => ({
          floor,
          floor_order: f.floor_order,
          rooms: [...f.rooms.entries()]
            .sort(([a], [b]) => a.localeCompare(b, 'ko'))
            .map(([room, locs]) => ({
              room,
              locations: locs.sort((a, b) => a.name.localeCompare(b.name, 'ko')),
            })),
        })),
    }));
}

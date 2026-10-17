// 측정위치 탭(T5). 옛 현장 상세(app/sites/[id]/page.tsx)의 쿼리 배선 가드를 그대로 옮기고,
// 다크 C안 구조(아트보드 SiteDetail)를 엘리먼트 트리로 확인한다. async 서버 컴포넌트는
// render()로 그릴 수 없으므로(node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md)
// await로 얻은 트리를 prop까지 따라가며 탐색한다(app/scans/[id]/__tests__/page.test.tsx와 같은 방식).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import LocationsPage, { metadata } from '../page';
import { LocationTree } from '@/components/location-tree';
import { NewLocationForm } from '@/components/new-location-form';
import { PhotoGallery } from '@/components/photo-gallery';
import { RefreshOnUpload } from '@/components/refresh-on-upload';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { Container } from '@/components/ui/container';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';

type El = { type?: unknown; props: Record<string, unknown> };

// 엘리먼트 트리 전역 순회: children뿐 아니라 title 같은 슬롯 prop도 따라간다.
function walk(node: unknown, onNode: (n: unknown) => void, seen = new WeakSet<object>()) {
  if (typeof node === 'string' || typeof node === 'number') { onNode(node); return; }
  if (node == null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  onNode(node);
  if (Array.isArray(node)) { node.forEach((n) => walk(n, onNode, seen)); return; }
  Object.values(node as Record<string, unknown>).forEach((v) => walk(v, onNode, seen));
}

function findAll(node: unknown, type: unknown): El[] {
  const acc: El[] = [];
  walk(node, (n) => {
    const el = n as El;
    if (n && typeof n === 'object' && !Array.isArray(n) && el.type === type && el.props) acc.push(el);
  });
  return acc;
}


// Supabase 쿼리 빌더 흉내: 체이닝은 자기 자신, await 되면(thenable) 정해 둔 결과로 resolve.
function chain(
  result: { data: unknown; error: { message: string } | null },
  spy?: (method: string, col: string, val: unknown) => void,
) {
  const obj: Record<string, unknown> = {
    select: () => obj, order: () => obj,
    eq: (col: string, val: unknown) => { spy?.('eq', col, val); return obj; },
    in: (col: string, val: unknown) => { spy?.('in', col, val); return obj; },
    is: (col: string, val: unknown) => { spy?.('is', col, val); return obj; },
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

const LOCATION = {
  id: 'l1', site_id: 's1', building: '101동', floor: '3층', floor_order: 3, room: '301호', name: '거실',
  memo: null, created_at: '', updated_at: '',
};
const SCAN = {
  id: 'sc1', location_id: 'l1', surface: 'floor', scanned_at: '2026-09-03', device: null,
  operator_id: null, operator_name_manual: null, selected_criteria_id: null, raw_file_path: null,
  original_filename: null, file_format: null, point_count: null, unit_scale: null,
  lineage: 'raw', status: 'ready', height_view_path: null, deleted_at: null, created_at: '', updated_at: '',
};
const PHOTO = {
  id: 'p1', scan_id: null, location_id: null, site_id: 's1', file_path: 'a.jpg', caption: null, taken_at: null, created_at: '',
};

function stub(opts: {
  locations?: unknown[]; photos?: unknown[]; scans?: unknown[]; analyses?: unknown[];
  locationsError?: { message: string };
  spies?: Partial<Record<string, (method: string, col: string, val: unknown) => void>>;
} = {}) {
  const { locations = [LOCATION], photos = [], scans = [SCAN], analyses = [], locationsError, spies = {} } = opts;
  return {
    from: (table: string) => {
      if (table === 'locations') return chain({ data: locationsError ? null : locations, error: locationsError ?? null }, spies.locations);
      if (table === 'photos') return chain({ data: photos, error: null }, spies.photos);
      if (table === 'scans') return chain({ data: scans, error: null }, spies.scans);
      if (table === 'analyses') return chain({ data: analyses, error: null }, spies.analyses);
      // 현장 존재 확인은 레이아웃 몫이다 - 이 페이지가 sites 를 다시 읽으면 여기서 잡힌다.
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

const props = () => ({ params: Promise.resolve({ id: 's1' }) });

// 코드리뷰(I1) 회귀 차단(옛 현장 상세에서 이관): .eq('kind', 'flatness')가 사라지면 같은 scan_id의
// 구배 현재분석이 Map을 덮어써 트리 판정이 조회 순서에 따라 비결정적으로 바뀐다.
describe('LocationsPage 쿼리 배선 (단계 C 회귀 차단: I1)', () => {
  it('현재분석 조회에 kind=flatness·is_current=true·deleted_at null 필터를 건다', async () => {
    const analysesSpy = vi.fn();
    vi.mocked(createClient).mockResolvedValue(stub({ spies: { analyses: analysesSpy } }) as never);

    await LocationsPage(props());

    expect(analysesSpy).toHaveBeenCalledWith('eq', 'kind', 'flatness');
    expect(analysesSpy).toHaveBeenCalledWith('eq', 'is_current', true);
    expect(analysesSpy).toHaveBeenCalledWith('is', 'deleted_at', null);
    expect(analysesSpy).toHaveBeenCalledWith('in', 'scan_id', ['sc1']);
  });

  it('측정위치·사진은 이 현장으로, 스캔은 지워지지 않은 것만 읽는다', async () => {
    const locationsSpy = vi.fn();
    const photosSpy = vi.fn();
    const scansSpy = vi.fn();
    vi.mocked(createClient).mockResolvedValue(
      stub({ spies: { locations: locationsSpy, photos: photosSpy, scans: scansSpy } }) as never);

    await LocationsPage(props());

    expect(locationsSpy).toHaveBeenCalledWith('eq', 'site_id', 's1');
    expect(photosSpy).toHaveBeenCalledWith('eq', 'site_id', 's1');
    expect(scansSpy).toHaveBeenCalledWith('in', 'location_id', ['l1']);
    expect(scansSpy).toHaveBeenCalledWith('is', 'deleted_at', null);
  });

  it('측정위치가 없으면 스캔·분석을 조회하지 않는다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (table: string) => {
        if (table === 'locations') return chain({ data: [], error: null });
        if (table === 'photos') return chain({ data: [], error: null });
        throw new Error(`조회하면 안 되는 테이블: ${table}`);
      },
    } as never);

    const el = await LocationsPage(props());

    expect(findAll(el, LocationTree)[0].props.tree).toEqual([]);
  });

  it('측정위치 조회가 실패하면 빈 트리 대신 Supabase 오류 안내를 PAGE_MAIN 안에 그린다', async () => {
    vi.mocked(createClient).mockResolvedValue(stub({ locationsError: { message: '연결 실패' } }) as never);

    const el = (await LocationsPage(props())) as unknown as El;

    expect(el.props.className).toBe(PAGE_MAIN);
    expect(findAll(el, SupabaseErrorNotice)[0].props.message).toBe('연결 실패');
    expect(findAll(el, LocationTree)).toHaveLength(0);
  });
});

// 다크 C안(아트보드 SiteDetail): 레이아웃이 <main>을 그리므로 페이지 뿌리는 PAGE_MAIN div 다.
// h1 '측정위치 (n)'(브레드크럼 없음) → 제목 없는 트리 카드 → '새 측정위치' → '현장 사진 (n)'.
describe('LocationsPage 화면 구조 (다크 C안)', () => {
  it('<title>은 화면 이름 "측정위치"다(앞의 "Flatness · "는 루트 title.template 이 붙인다)', () => {
    expect(metadata.title).toBe('측정위치');
  });

  it('뿌리는 PAGE_MAIN div, 제목은 "측정위치" + 개수(counter)이고 브레드크럼이 없다', async () => {
    vi.mocked(createClient).mockResolvedValue(stub({ locations: [LOCATION, { ...LOCATION, id: 'l2', name: '안방' }] }) as never);

    const el = (await LocationsPage(props())) as unknown as El;

    expect(el.type).toBe('div');
    expect(el.props.className).toBe(PAGE_MAIN);
    const [header] = findAll(el, PageHeader);
    expect(header.props.crumbs).toBeUndefined();
    expect(header.props.title).toBe('측정위치');
    expect(header.props.counter).toBe(2);
  });

  it('카드 3개: 제목 없는 트리 카드 · 새 측정위치 · 현장 사진(사진 수)', async () => {
    vi.mocked(createClient).mockResolvedValue(stub({ photos: [PHOTO, { ...PHOTO, id: 'p2' }] }) as never);

    const el = await LocationsPage(props());

    expect(findAll(el, Container).map((c) => [c.props.title, c.props.counter]))
      .toEqual([[undefined, undefined], ['새 측정위치', undefined], ['현장 사진', 2]]);
  });

  it('트리·폼·사진에 현장 id와 조회 결과를 그대로 넘긴다', async () => {
    const current = { id: 'a1', scan_id: 'sc1', status: 'done', overall_verdict: 'pass', kind: 'flatness' };
    vi.mocked(createClient).mockResolvedValue(stub({ photos: [PHOTO], analyses: [current] }) as never);

    const el = await LocationsPage(props());

    const [tree] = findAll(el, LocationTree);
    expect(tree.props.siteId).toBe('s1');
    const scansByLocation = tree.props.scansByLocation as Map<string, { id: string; current?: unknown }[]>;
    expect(scansByLocation.get('l1')?.[0].current).toEqual({ id: 'a1', status: 'done', overall_verdict: 'pass' });
    expect(findAll(el, NewLocationForm)[0].props.siteId).toBe('s1');
    expect(findAll(el, RefreshOnUpload)[0].props.target).toEqual({ site_id: 's1' });
    expect(findAll(el, PhotoGallery)[0].props.photos).toEqual([PHOTO]);
  });
});

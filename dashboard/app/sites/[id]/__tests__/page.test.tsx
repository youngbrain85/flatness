// 코드리뷰(I1): app/page.test.tsx와 같은 이유 - .eq('kind', 'flatness')가 사라지면
// 같은 scan_id의 구배 현재분석이 Map을 덮어써 트리 배지가 조회 순서에 따라 비결정적으로
// 바뀐다. 서버 컴포넌트 함수를 직접 호출해 실제 쿼리 배선을 확인한다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import SitePage from '../page';
import { Container } from '@/components/ui/container';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_MAIN } from '@/components/ui/page';

// 엘리먼트 트리를 재귀 탐색해 특정 컴포넌트 타입이 쓰인 곳을 모두 모은다
// (app/__tests__/page.test.tsx와 동일 패턴 - async 서버 컴포넌트는 render()할 수 없다).
function findAll(node: unknown, type: unknown, acc: { props: Record<string, unknown> }[] = []) {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) acc.push(el as { props: Record<string, unknown> });
  findAll(el.props?.children, type, acc);
  return acc;
}

function chain(result: { data: unknown; error: null }, eqSpy?: (col: string, val: unknown) => void) {
  const obj: Record<string, unknown> = {
    select: () => obj, order: () => obj, is: () => obj, in: () => obj,
    eq: (col: string, val: unknown) => { eqSpy?.(col, val); return obj; },
    maybeSingle: async () => result,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

describe('SitePage 쿼리 배선 (단계 C 회귀 차단: I1)', () => {
  it('현재분석(currentsRes) 조회에 kind=flatness 필터를 건다', async () => {
    const eqSpy = vi.fn();
    const site = { id: 's1', name: '현장1', address: null, memo: null, created_at: '', updated_at: '' };
    const location = {
      id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
      memo: null, created_at: '', updated_at: '',
    };
    // 현재분석(analyses) 쿼리까지 도달하려면 locations·scans가 최소 1건씩 있어야 한다
    // (scanIds.length가 0이면 analyses 쿼리 자체를 건너뛰어 이 회귀가 재현되지 않는다).
    const scan = {
      id: 'sc1', location_id: 'l1', surface: 'floor', scanned_at: '2026-07-20', device: null,
      operator_id: null, operator_name_manual: null, selected_criteria_id: null, raw_file_path: null,
      original_filename: null, file_format: null, point_count: null, unit_scale: null,
      lineage: 'raw', status: 'ready', deleted_at: null, created_at: '', updated_at: '',
    };

    vi.mocked(createClient).mockResolvedValue({
      from: (table: string) => {
        if (table === 'sites') return chain({ data: site, error: null });
        if (table === 'locations') return chain({ data: [location], error: null });
        if (table === 'photos') return chain({ data: [], error: null });
        if (table === 'scans') return chain({ data: [scan], error: null });
        if (table === 'analyses') return chain({ data: [], error: null }, eqSpy);
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
    } as never);

    await SitePage({ params: Promise.resolve({ id: 's1' }) });

    expect(eqSpy).toHaveBeenCalledWith('kind', 'flatness');
    expect(eqSpy).toHaveBeenCalledWith('is_current', true);
  });
});

// Cloudscape 재스킨(T4): PAGE_MAIN 본문, PageHeader(브레드크럼 현장 › 현장명, 설명=주소),
// Container 3개(측정위치 (n) / 새 측정위치 / 현장 사진 (n)). 쿼리 배선은 위 describe가 지킨다.
describe('SitePage 화면 구조 (Cloudscape)', () => {
  function stub(site: unknown, locations: unknown[], photos: unknown[]) {
    return {
      from: (table: string) => {
        if (table === 'sites') return chain({ data: site, error: null });
        if (table === 'locations') return chain({ data: locations, error: null });
        if (table === 'photos') return chain({ data: photos, error: null });
        if (table === 'scans') return chain({ data: [], error: null });
        if (table === 'analyses') return chain({ data: [], error: null });
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
    };
  }

  it('PAGE_MAIN + PageHeader(현장 › 현장명, 주소 설명) + Container 3개(카운터)', async () => {
    const site = { id: 's1', name: '세종 M2블록 아파트', address: '세종시 다정동', memo: null, created_at: '', updated_at: '' };
    const location = {
      id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
      memo: null, created_at: '', updated_at: '',
    };
    const photo = { id: 'p1', scan_id: null, location_id: null, site_id: 's1', file_path: 'a.jpg', caption: null, taken_at: null, created_at: '' };
    vi.mocked(createClient).mockResolvedValue(stub(site, [location], [photo, { ...photo, id: 'p2' }]) as never);

    const el = await SitePage({ params: Promise.resolve({ id: 's1' }) });

    expect(el.props.className).toBe(PAGE_MAIN);
    const [header] = findAll(el, PageHeader);
    expect(header.props.title).toBe('세종 M2블록 아파트');
    expect(header.props.description).toBe('세종시 다정동');
    expect(header.props.crumbs).toEqual([{ href: '/', label: '현장' }, { label: '세종 M2블록 아파트' }]);
    const containers = findAll(el, Container).map((c) => [c.props.title, c.props.counter]);
    expect(containers).toEqual([['측정위치', 1], ['새 측정위치', undefined], ['현장 사진', 2]]);
  });
});

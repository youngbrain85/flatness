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

// 코드리뷰(Important) 회귀 차단: 렌더되지 않은 엘리먼트 트리에서 className들을 전부 모은다
// (render()로 그릴 수 없는 async 서버 컴포넌트라 DOM querySelector를 쓸 수 없다).
function collectClassNames(node: unknown, acc: string[] = []): string[] {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => collectClassNames(n, acc)); return acc; }
  const el = node as { props?: { className?: string; children?: unknown } };
  if (typeof el.props?.className === 'string') acc.push(el.props.className);
  collectClassNames(el.props?.children, acc);
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
    // 코드리뷰(Important): '현장 사진' Container는 더 이상 title/counter를 받지 않는다(아래
    // 전용 테스트가 검증하듯, 헤더를 직접 그려 아트보드대로 구분선을 하나만 둔다).
    const containers = findAll(el, Container).map((c) => [c.props.title, c.props.counter]);
    expect(containers).toEqual([['측정위치', 1], ['새 측정위치', undefined], [undefined, undefined]]);
  });

  // 코드리뷰(Important): SiteDetail.dc.html:333-349는 '현장 사진' 컨테이너에 구분선을 하나만
  // 두고(업로더 줄과 그리드 사이), 헤더 아래에는 두지 않는다('측정위치'/'새 측정위치'와 다름).
  // title을 Container에 넘기면 공용 프리미티브가 헤더 아래 border-b를 무조건 그려 구분선이
  // 두 개가 되므로, 페이지가 title 없이 padded={false}로 헤더·업로더 줄·구분선을 직접 그리는지 검증한다.
  it('현장 사진 컨테이너: 헤더 구분선 없음 + 구분선은 업로더 줄과 그리드 사이 하나뿐', async () => {
    const site = { id: 's1', name: '현장1', address: null, memo: null, created_at: '', updated_at: '' };
    const photo = { id: 'p1', scan_id: null, location_id: null, site_id: 's1', file_path: 'a.jpg', caption: null, taken_at: null, created_at: '' };
    vi.mocked(createClient).mockResolvedValue(stub(site, [], [photo, { ...photo, id: 'p2' }]) as never);

    const el = await SitePage({ params: Promise.resolve({ id: 's1' }) });

    const containers = findAll(el, Container);
    const photoContainer = containers[2];
    expect(photoContainer.props.title).toBeUndefined();
    expect(photoContainer.props.padded).toBe(false);

    const classNames = collectClassNames(photoContainer.props.children);
    // border-b(헤더 밑 구분선)는 없어야 하고, border-t(그리드 위 구분선)는 정확히 하나여야 한다.
    expect(classNames.some((c) => c.includes('border-b'))).toBe(false);
    const topDividers = classNames.filter((c) => c.includes('border-t') && c.includes('border-cs-divider'));
    expect(topDividers).toHaveLength(1);

    // 헤더는 container.tsx의 h2/카운터 클래스를 그대로 복사해 시각적으로 동일해야 한다.
    const [heading] = findAll(photoContainer.props.children, 'h2');
    const headingEl = heading as unknown as { props: { className: string; children: unknown[] } };
    expect(headingEl.props.className).toContain('text-lg');
    expect(headingEl.props.className).toContain('font-bold');
    const [text, counterSpan] = headingEl.props.children as [string, { props: { className: string } }];
    expect(text).toBe('현장 사진');
    expect(counterSpan.props.className).toContain('font-normal');
    expect(counterSpan.props.className).toContain('text-cs-text-secondary');
  });
});

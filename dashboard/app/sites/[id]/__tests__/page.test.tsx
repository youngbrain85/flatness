// 코드리뷰(I1): app/page.test.tsx와 같은 이유 - .eq('kind', 'flatness')가 사라지면
// 같은 scan_id의 구배 현재분석이 Map을 덮어써 트리 배지가 조회 순서에 따라 비결정적으로
// 바뀐다. 서버 컴포넌트 함수를 직접 호출해 실제 쿼리 배선을 확인한다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import SitePage from '../page';

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

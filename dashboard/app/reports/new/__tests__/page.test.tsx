// 코드리뷰(I1): app/page.test.tsx와 같은 이유 - .eq('kind', 'flatness')가 사라지면
// 구배 분석이 보고서 후보로 섞여 평활도와 육안 구별이 안 된다. 서버 컴포넌트 함수를
// 직접 호출해 실제 쿼리 배선을 확인한다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import NewReportPage from '../page';

function chain(result: { data: unknown; error: null }, eqSpy?: (col: string, val: unknown) => void) {
  const obj: Record<string, unknown> = {
    select: () => obj, is: () => obj, in: () => obj,
    eq: (col: string, val: unknown) => { eqSpy?.(col, val); return obj; },
    maybeSingle: async () => result,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

describe('NewReportPage 쿼리 배선 (단계 C 회귀 차단: I1)', () => {
  it('보고서 후보(analysesRes) 조회에 kind=flatness 필터를 건다', async () => {
    const eqSpy = vi.fn();
    const location = {
      id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
      memo: null, created_at: '', updated_at: '',
    };
    // analyses 쿼리까지 도달하려면 scans가 최소 1건 있어야 한다
    // (scanRows.length가 0이면 analyses 쿼리 자체를 건너뛰어 이 회귀가 재현되지 않는다).
    const scan = {
      id: 'sc1', location_id: 'l1', surface: 'floor', scanned_at: '2026-07-20', device: null,
      operator_id: null, operator_name_manual: null, selected_criteria_id: null, raw_file_path: null,
      original_filename: null, file_format: null, point_count: null, unit_scale: null,
      lineage: 'raw', status: 'ready', deleted_at: null, created_at: '', updated_at: '',
    };

    vi.mocked(createClient).mockResolvedValue({
      from: (table: string) => {
        if (table === 'locations') return chain({ data: location, error: null });
        if (table === 'scans') return chain({ data: [scan], error: null });
        if (table === 'analyses') return chain({ data: [], error: null }, eqSpy);
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
    } as never);

    await NewReportPage({ searchParams: Promise.resolve({ location: 'l1' }) });

    expect(eqSpy).toHaveBeenCalledWith('kind', 'flatness');
    expect(eqSpy).toHaveBeenCalledWith('status', 'done');
  });
});

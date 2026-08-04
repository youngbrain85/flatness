// 코드리뷰(I1): 이 파일이 없으면 app/page.tsx의 .eq('kind', 'flatness')를 지워도
// 테스트가 전부 통과한다 - 홈 카드 판정 집계가 구배 분석까지 섞여 2배로 계상되는
// 회귀를 아무것도 못 잡는다는 뜻이다. 실제 서버 컴포넌트 함수를 직접 호출해 Supabase
// 쿼리 체인에 걸린 .eq() 인자를 스파이로 기록함으로써 배선 자체를 검증한다.
//
// 참고: Next.js 공식 문서(node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md)는
// "Vitest는 async 서버 컴포넌트 렌더링을 지원하지 않는다"고 명시한다. 이 테스트는
// render()로 DOM에 그리지 않고, 페이지 함수를 일반 async 함수로 직접 호출해 부수효과
// (쿼리 인자)만 관찰한다 - RTL의 비동기 렌더 제약을 아예 우회한다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import HomePage from '../page';

// Supabase 쿼리 빌더 흉내: 체이닝 메서드는 자기 자신을 반환하고, await 대상이 되면
// (thenable) 미리 정해 둔 결과로 resolve한다. eq()만 호출 인자를 spy에 기록한다.
function chain(result: { data: unknown; error: null }, eqSpy?: (col: string, val: unknown) => void) {
  const obj: Record<string, unknown> = {
    select: () => obj, order: () => obj, is: () => obj,
    eq: (col: string, val: unknown) => { eqSpy?.(col, val); return obj; },
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

describe('HomePage 쿼리 배선 (단계 C 회귀 차단: I1)', () => {
  it('analyses 조회에 kind=flatness 필터를 건다', async () => {
    const eqSpy = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      from: (table: string) => {
        if (table === 'sites') return chain({ data: [], error: null });
        if (table === 'locations') return chain({ data: [], error: null });
        if (table === 'scans') return chain({ data: [], error: null });
        if (table === 'analyses') return chain({ data: [], error: null }, eqSpy);
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
    } as never);

    await HomePage();

    // 이 두 단언 중 kind 쪽을 지우면(회귀 재현) 이 테스트만 실패해야 한다.
    expect(eqSpy).toHaveBeenCalledWith('kind', 'flatness');
    expect(eqSpy).toHaveBeenCalledWith('is_current', true);
  });
});

// D7 Step 2: 목록의 "새 보고서" 버튼 상시 노출 + 빈 목록 EmptyState + tableClass
// 전환을 검증한다. 서버 컴포넌트 함수를 직접 호출해 렌더된 트리를 확인한다
// (app/reports/new/__tests__/page.test.tsx와 같은 방식).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import ReportsPage from '../page';

type Row = Record<string, unknown>;

function table(rows: Row[]) {
  let current = rows;
  const obj: Record<string, unknown> = {
    select: () => obj,
    is: (col: string, val: unknown) => {
      current = current.filter((r) => (r[col] ?? null) === val);
      return obj;
    },
    eq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] === val);
      return obj;
    },
    in: (col: string, vals: unknown[]) => {
      current = current.filter((r) => vals.includes(r[col]));
      return obj;
    },
    // 정렬·개수 제한은 이 스텁의 관심사가 아니다 - 체인만 통과시킨다.
    order: () => obj,
    limit: () => obj,
    then: (resolve: (v: unknown) => void) => resolve({ data: current, error: null }),
  };
  return obj;
}

function reportRow(over: Partial<Row> = {}): Row {
  return {
    id: 'r1', location_id: 'l1', title: '보고서1', status: 'draft',
    pdf_path: null, gen_status: 'done', gen_error: null, created_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

const locationRow: Row = {
  id: 'l1', site_id: 's1', building: '101동', floor: '3층', floor_order: 0, room: '', name: '거실',
  memo: null, created_at: '', updated_at: '',
};

function mockSupabase(reports: Row[], locations: Row[] = []) {
  vi.mocked(createClient).mockResolvedValue({
    from: (t: string) => {
      if (t === 'reports') return table(reports);
      if (t === 'locations') return table(locations);
      throw new Error(`예상치 못한 테이블: ${t}`);
    },
  } as never);
}

async function renderPage(searchParams: { location?: string } = {}) {
  const el = await ReportsPage({ searchParams: Promise.resolve(searchParams) });
  return render(el as ReactElement);
}

describe('ReportsPage 빈 목록 (D7 Step 2)', () => {
  it('보고서가 없으면 EmptyState로 새 보고서 만들기를 안내한다', async () => {
    mockSupabase([]);
    await renderPage();
    expect(screen.getByText('보고서가 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '새 보고서 만들기' })).toHaveAttribute('href', '/reports/new');
  });
});

describe('ReportsPage 새 보고서 버튼 (D7 Step 2: 파라미터 유무와 무관하게 상시 노출)', () => {
  it('location 파라미터가 없어도 새 보고서 버튼이 있다', async () => {
    mockSupabase([reportRow()], [locationRow]);
    await renderPage();
    expect(screen.getByRole('link', { name: '새 보고서' })).toHaveAttribute('href', '/reports/new');
  });

  it('location 파라미터가 있으면 새 보고서 링크가 그 위치를 프리필한다', async () => {
    mockSupabase([reportRow()], [locationRow]);
    await renderPage({ location: 'l1' });
    expect(screen.getByRole('link', { name: '새 보고서' })).toHaveAttribute('href', '/reports/new?location=l1');
  });
});

describe('ReportsPage 목록 테이블 (D7 Step 2: 제목 | 측정위치 | 상태 Badge | 생성일)', () => {
  it('제목·측정위치·생성일을 보여주고 제목이 상세로 링크한다', async () => {
    mockSupabase([reportRow()], [locationRow]);
    await renderPage();
    expect(screen.getByRole('link', { name: '보고서1' })).toHaveAttribute('href', '/reports/r1');
    expect(screen.getByText('101동 / 3층 / 거실')).toBeInTheDocument();
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
  });

  it('발행된 보고서는 발행됨 배지를 보여준다', async () => {
    mockSupabase([reportRow({ status: 'finalized' })], [locationRow]);
    await renderPage();
    expect(screen.getByText('발행됨')).toBeInTheDocument();
  });

  it('PDF 생성에 실패한 초안은 생성 실패 배지를 보여준다', async () => {
    mockSupabase([reportRow({ gen_status: 'failed' })], [locationRow]);
    await renderPage();
    expect(screen.getByText('생성 실패')).toBeInTheDocument();
  });
});

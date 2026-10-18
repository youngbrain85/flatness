// 현장 보고서 목록(Task 10, 스펙 §5 14행·§11 "보고서 목록의 현장 범위 조회"): 이 현장 측정위치의 보고서만,
// 삭제 제외, 최신순. 페이지 함수를 불러 반환 트리를 render()한다(ReportTable은 클라이언트 컴포넌트지만
// render()가 그대로 실행한다). 상태 칸은 within(table)로 찾는다 - 상태 필터 <option> 문구가 같은 글자다.
// 현장 헤더와 <main>은 app/sites/[id]/layout.tsx(Task 2) 몫이라 여기서는 본문만 본다.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import SiteReportsPage, { metadata } from '../page';
import { PAGE_MAIN } from '@/components/ui/page';

type Row = Record<string, unknown>;
type Call = [table: string, op: string, ...args: unknown[]];

// eq/in/is를 실제로 적용하는 쿼리 빌더 흉내. 호출은 [테이블, 연산, 인자...]로 기록한다.
// error를 주면 조회가 그 오류로 끝난다(오류 안내 경로 확인용).
function table(name: string, rows: Row[], calls: Call[], error: { message: string } | null = null) {
  let current = rows;
  const obj: Record<string, unknown> = {
    select: (...a: unknown[]) => { calls.push([name, 'select', ...a]); return obj; },
    eq: (col: string, val: unknown) => {
      calls.push([name, 'eq', col, val]);
      current = current.filter((r) => r[col] === val);
      return obj;
    },
    in: (col: string, vals: unknown[]) => {
      calls.push([name, 'in', col, vals]);
      current = current.filter((r) => vals.includes(r[col]));
      return obj;
    },
    is: (col: string, val: unknown) => {
      calls.push([name, 'is', col, val]);
      current = current.filter((r) => (r[col] ?? null) === val);
      return obj;
    },
    order: (...a: unknown[]) => { calls.push([name, 'order', ...a]); return obj; },
    limit: (...a: unknown[]) => { calls.push([name, 'limit', ...a]); return obj; },
    then: (resolve: (v: unknown) => void) => resolve({ data: error ? null : current, error }),
  };
  return obj;
}

function locationRow(id: string, siteId: string, building: string, floor: string, room: string, name: string): Row {
  return { id, site_id: siteId, building, floor, floor_order: 0, room, name, memo: null, created_at: '', updated_at: '' };
}

const LOCATIONS: Row[] = [
  locationRow('l1', 's1', '101동', '3층', '301호', '거실'),
  locationRow('l2', 's1', '101동', '5층', '501호', '거실'),
  locationRow('l9', 's2', '201동', '1층', '', '로비'),
];

function report(over: Row): Row {
  return {
    id: 'r?', location_id: 'l1', title: '보고서', status: 'draft', pdf_path: null,
    gen_status: 'done', gen_error: null, deleted_at: null, created_at: '2026-09-03T10:00:00Z', ...over,
  };
}

const REPORTS: Row[] = [
  report({ id: 'r1', location_id: 'l1', title: '301호 거실 평활도 보고서', created_at: '2026-09-03T10:00:00Z' }),
  report({ id: 'r2', location_id: 'l2', title: '501호 거실 평활도 보고서', gen_status: 'processing', created_at: '2026-09-02T10:00:00Z' }),
  report({ id: 'r3', location_id: 'l9', title: '다른 현장 보고서' }),
  report({ id: 'r4', location_id: 'l1', title: '지운 보고서', deleted_at: '2026-09-05T00:00:00Z' }),
];

async function renderPage(o: {
  reports?: Row[]; locations?: Row[]; search?: { location?: string };
  errors?: { locations?: { message: string }; reports?: { message: string } };
} = {}) {
  const calls: Call[] = [];
  vi.mocked(createClient).mockResolvedValue({
    from: (t: string) => {
      if (t === 'locations') return table(t, o.locations ?? LOCATIONS, calls, o.errors?.locations ?? null);
      if (t === 'reports') return table(t, o.reports ?? REPORTS, calls, o.errors?.reports ?? null);
      throw new Error(`예상치 못한 테이블: ${t}`);
    },
  } as never);
  const el = (await SiteReportsPage({
    params: Promise.resolve({ id: 's1' }),
    searchParams: Promise.resolve(o.search ?? {}),
  })) as ReactElement;
  const utils = render(el);
  return { calls, el, ...utils };
}

function titles(): string[] {
  return within(screen.getByRole('table')).queryAllByRole('link').map((a) => a.textContent ?? '');
}

describe('SiteReportsPage 현장 범위 조회 (스펙 §11)', () => {
  it('이 현장의 측정위치를 먼저 읽고 그 id 안에서만, 삭제를 빼고, 최신순으로 보고서를 고른다', async () => {
    const { calls } = await renderPage();
    expect(calls).toContainEqual(['locations', 'eq', 'site_id', 's1']);
    expect(calls).toContainEqual(['reports', 'in', 'location_id', ['l1', 'l2']]);
    expect(calls).toContainEqual(['reports', 'is', 'deleted_at', null]);
    expect(calls).toContainEqual(['reports', 'order', 'created_at', { ascending: false }]);
    // 다른 현장(l9) 보고서와 지운 보고서(r4)는 없다
    expect(titles()).toEqual(['301호 거실 평활도 보고서', '501호 거실 평활도 보고서']);
  });

  it('현장 범위로 좁혔으므로 50건 상한을 두지 않는다(대시보드 보고서 수와 같은 수)', async () => {
    const { calls } = await renderPage();
    expect(calls.filter((c) => c[1] === 'limit')).toEqual([]);
  });

  it('측정위치가 없는 현장은 보고서 쿼리를 보내지 않고 빈 안내를 보여 준다', async () => {
    const { calls } = await renderPage({ locations: [] });
    expect(calls.some((c) => c[0] === 'reports')).toBe(false);
    expect(screen.getByText('이 현장에는 아직 보고서가 없습니다. 새 보고서 버튼으로 만드세요.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('SiteReportsPage 화면 (아트보드 Reports)', () => {
  it('본문은 PAGE_MAIN이고(현장 헤더·main은 레이아웃 몫) 탭 첫 화면이라 브레드크럼이 없다', async () => {
    const { el } = await renderPage();
    expect((el.props as { className: string }).className).toBe(PAGE_MAIN);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('h1은 "보고서", 옆 카운터는 (n) mono, 오른쪽 주 버튼 "새 보고서"는 이 현장의 측정위치 고르기로 간다', async () => {
    await renderPage();
    // PageHeader counter(Task 1): 카운터는 h1 밖 형제 span이다 - h1 이름은 "보고서"뿐
    expect(screen.getByRole('heading', { level: 1, name: '보고서' })).toBeInTheDocument();
    expect(screen.getByText('(2)').className).toContain('font-mono');
    const add = screen.getByRole('link', { name: '새 보고서' });
    expect(add).toHaveAttribute('href', '/reports/new?site=s1');
    expect(add.className).toContain('bg-ink');
  });

  it('측정위치 열은 " / "로 잇고, PDF 생성 중은 속 빈 고리(in-progress), 작성 중은 대기(pending)다', async () => {
    await renderPage();
    const tableEl = screen.getByRole('table');
    expect(within(tableEl).getByText('101동 / 3층 / 301호 / 거실')).toBeInTheDocument();
    expect(within(tableEl).getByText('PDF 생성 중').closest('[data-status]')).toHaveAttribute('data-status', 'in-progress');
    expect(within(tableEl).getByText('작성 중').closest('[data-status]')).toHaveAttribute('data-status', 'pending');
  });

  it('?location=이 이 현장 측정위치면 그 위치만 보이고, 새 보고서는 그 위치를 미리 고르며, 전체 보기로 풀 수 있다', async () => {
    const { calls } = await renderPage({ search: { location: 'l2' } });
    expect(calls).toContainEqual(['reports', 'in', 'location_id', ['l2']]);
    expect(titles()).toEqual(['501호 거실 평활도 보고서']);
    expect(screen.getByRole('link', { name: '새 보고서' })).toHaveAttribute('href', '/reports/new?location=l2');
    expect(screen.getByText('측정위치: 101동 / 5층 / 501호 / 거실')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '전체 보기' })).toHaveAttribute('href', '/sites/s1/reports');
  });

  it('?location=이 다른 현장 측정위치면 무시하고 이 현장 전체를 보여 준다', async () => {
    const { calls } = await renderPage({ search: { location: 'l9' } });
    expect(calls).toContainEqual(['reports', 'in', 'location_id', ['l1', 'l2']]);
    expect(titles()).not.toContain('다른 현장 보고서');
    expect(screen.queryByRole('link', { name: '전체 보기' })).toBeNull();
    expect(screen.getByRole('link', { name: '새 보고서' })).toHaveAttribute('href', '/reports/new?site=s1');
  });

  it('위치 필터가 걸린 채 0건이어도 표(안내 줄)와 전체 보기를 남긴다(막다른 화면 금지)', async () => {
    await renderPage({ search: { location: 'l2' }, reports: [] });
    expect(screen.getByText('조건에 맞는 보고서가 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '전체 보기' })).toHaveAttribute('href', '/sites/s1/reports');
  });
});

// 변이 실험(Task 10 보강): 위 단언만으로는 서버가 표에 넘기는 값의 배선(상세 링크·생성일·필터용 gen_status)과
// 조회 오류 경로, <title>이 조용히 틀어져도 통과했다. 아래가 그 틈을 막는다.
describe('SiteReportsPage 보강 (변이 실험으로 드러난 빈틈)', () => {
  it('<title>은 화면 이름 "보고서"다(앞의 "Flatness · "는 루트 title.template 이 붙인다)', () => {
    expect(metadata.title).toBe('보고서');
  });

  it('제목 링크는 보고서 상세(/reports/{id})로 가고, 생성일은 YYYY-MM-DD로 표에 넘어간다', async () => {
    await renderPage();
    const tableEl = screen.getByRole('table');
    expect(within(tableEl).getAllByRole('link').map((a) => a.getAttribute('href')))
      .toEqual(['/reports/r1', '/reports/r2']);
    expect(within(tableEl).getByText('2026-09-03')).toBeInTheDocument();
    expect(within(tableEl).getByText('2026-09-02')).toBeInTheDocument();
  });

  it('상태 필터는 서버가 넘긴 gen_status로 거른다(작성 중 = 생성이 끝난 초안, PDF 생성 중·대기 = 그 밖)', async () => {
    await renderPage();
    const filter = screen.getByRole('combobox', { name: '상태 필터' });
    // 옵션 라벨(화면 문구)로 고른다 - 값 문자열이 아니라 사용자가 보는 글자가 계약이다
    const valueOf = (label: string) => (screen.getByRole('option', { name: label }) as HTMLOptionElement).value;
    fireEvent.change(filter, { target: { value: valueOf('작성 중') } });
    expect(titles()).toEqual(['301호 거실 평활도 보고서']);
    fireEvent.change(filter, { target: { value: valueOf('PDF 생성 중·대기') } });
    expect(titles()).toEqual(['501호 거실 평활도 보고서']);
  });

  it('측정위치 조회가 실패하면 오류 안내만 그리고 보고서는 조회하지 않는다', async () => {
    const { calls } = await renderPage({ errors: { locations: { message: '연결 끊김' } } });
    expect(screen.getByText('상세: 연결 끊김')).toBeInTheDocument();
    expect(calls.some((c) => c[0] === 'reports')).toBe(false);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('보고서 조회가 실패하면 오류 안내를 그리고 표는 그리지 않는다', async () => {
    await renderPage({ errors: { reports: { message: '권한 없음' } } });
    expect(screen.getByText('상세: 권한 없음')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

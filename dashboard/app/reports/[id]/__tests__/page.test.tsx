// D7 Step 3: PageHeader 브레드크럼(현장 › 측정위치) + StatusDot 상태 + "포함 분석"
// 링크의 /scans/[scanId]?analysis=[id] 단축(analyses 행의 scan_id로 한 홉 줄인다 -
// D6 리다이렉트가 /analyses/[id]도 여전히 받아주지만 여기서는 애초에 그 홉을
// 만들지 않는다)을 검증한다. 기능(다운로드·재생성·발행·삭제·진행 상태)은 이 태스크의
// 범위가 아니다 - 각각 report-actions.test.tsx·report-delete-button.test.tsx·
// report-progress.test.tsx가 이미 덮는다.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

// 하위 클라이언트 컴포넌트(ReportProgress·ReportActions·ReportDeleteButton)는 각자
// useRouter/Realtime 구독을 쓴다 - 이 페이지 테스트의 관심사(브레드크럼·상태 배지·
// 포함 분석 링크)가 아니므로 스텁으로 대체해 잡음을 없앤다.
vi.mock('@/components/report/report-progress', () => ({ ReportProgress: () => null }));
vi.mock('@/components/report/report-actions', () => ({ ReportActions: () => null }));
vi.mock('@/components/report/report-delete-button', () => ({ ReportDeleteButton: () => null }));

import { createClient } from '@/lib/supabase/server';
import ReportPage from '../page';

type Row = Record<string, unknown>;

function table(rows: Row[]) {
  let current = rows;
  let projection: string[] | null = null;
  const project = (r: Row): Row => (projection
    ? Object.fromEntries(projection.map((k) => [k, r[k]]))
    : r);
  const obj: Record<string, unknown> = {
    select: (cols = '*') => {
      projection = cols === '*' ? null : cols.split(',').map((c) => c.trim());
      return obj;
    },
    eq: (col: string, val: unknown) => { current = current.filter((r) => r[col] === val); return obj; },
    is: (col: string, val: unknown) => { current = current.filter((r) => (r[col] ?? null) === val); return obj; },
    in: (col: string, vals: unknown[]) => { current = current.filter((r) => vals.includes(r[col])); return obj; },
    order: () => obj,
    maybeSingle: async () => ({ data: current.length ? project(current[0]) : null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: current.map(project), error: null }),
  };
  return obj;
}

function reportRow(over: Partial<Row> = {}): Row {
  return {
    id: 'r1', location_id: 'l1', title: '거실 평활도 분석 보고서', status: 'draft',
    opinion_text: null, pdf_path: 'reports/r1/report.pdf', gen_status: 'done', gen_error: null,
    created_at: '2026-08-01T00:00:00Z', ...over,
  };
}

const location: Row = {
  id: 'l1', site_id: 's1', building: '101동', floor: '3층', floor_order: 0, room: '', name: '거실',
  memo: null, created_at: '', updated_at: '',
};
const site: Row = { id: 's1', name: '현장A', address: null, memo: null, created_at: '', updated_at: '' };
const link: Row = { report_id: 'r1', analysis_id: 'a1', sort_order: 0 };
const analysis: Row = { id: 'a1', scan_id: 'sc1', surface: 'floor', overall_verdict: 'pass' };
const scan: Row = { id: 'sc1', scanned_at: '2026-07-20' };

function mockSupabase(report: Row) {
  vi.mocked(createClient).mockResolvedValue({
    from: (t: string) => {
      if (t === 'reports') return table([report]);
      if (t === 'locations') return table([location]);
      if (t === 'sites') return table([site]);
      if (t === 'report_analyses') return table([link]);
      if (t === 'analyses') return table([analysis]);
      if (t === 'scans') return table([scan]);
      throw new Error(`예상치 못한 테이블: ${t}`);
    },
  } as never);
}

async function renderPage(report: Row = reportRow()) {
  mockSupabase(report);
  const el = await ReportPage({ params: Promise.resolve({ id: 'r1' }) });
  return render(el as ReactElement);
}

describe('ReportPage 브레드크럼 (D7 Step 3: 현장 › 측정위치)', () => {
  it('현장 홈·현장명·측정위치 라벨을 순서대로 보여준다', async () => {
    await renderPage();
    expect(screen.getByRole('link', { name: '현장' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '현장A' })).toHaveAttribute('href', '/sites/s1');
    expect(screen.getByText('101동 / 3층 / 거실')).toBeInTheDocument();
  });

  it('보고서 제목을 헤딩으로 보여준다', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: '거실 평활도 분석 보고서' })).toBeInTheDocument();
  });
});

describe('ReportPage 상태 배지 (D7 Step 3: reportStatusBadge 재사용)', () => {
  it('초안 + 생성 완료는 작성 중으로 표시한다', async () => {
    await renderPage(reportRow({ status: 'draft', gen_status: 'done' }));
    expect(screen.getByText('작성 중')).toBeInTheDocument();
  });

  it('발행본은 발행됨으로 표시한다', async () => {
    await renderPage(reportRow({ status: 'finalized' }));
    expect(screen.getByText('발행됨')).toBeInTheDocument();
  });
});

describe('ReportPage 포함 분석 링크 (D7 참고: /scans/[scanId]?analysis=[id]로 단축)', () => {
  it('/analyses/[id]가 아니라 스캔 작업대로 바로 링크한다', async () => {
    await renderPage();
    const a = screen.getByRole('link', { name: /바닥.*2026-07-20.*판정/ });
    expect(a).toHaveAttribute('href', '/scans/sc1?analysis=a1');
  });
});

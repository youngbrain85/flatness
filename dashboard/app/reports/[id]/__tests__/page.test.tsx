// 보고서 상세(스펙 §7.6 후반부, §5 16행) + 현장 작업 공간(Task 10): 현장 헤더, 브레드크럼 보고서 / 제목,
// 상태 점, 포함 분석(등급 배지), PDF 미리보기(검정 스테이지 위 흰 A4 종이). 포함 분석 링크는
// /scans/[scanId]?analysis=[id]로 바로 간다(D6 리다이렉트 홉을 만들지 않는다). 기능(다운로드·재생성·발행·
// 삭제·진행 상태)은 각 컴포넌트 테스트가 덮는다 - 여기서는 무엇을 넘기는지만 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({
    'x-flatness-user-id': 'u1',
    'x-flatness-user-email': encodeURIComponent('u1@example.com'),
  }),
}));

const { captured } = vi.hoisted(() => ({
  captured: {
    site: [] as unknown[], entry: [] as unknown[], del: [] as unknown[],
    progress: [] as unknown[], actions: [] as unknown[],
  },
}));
vi.mock('@/components/shell/site-header', () => ({
  SiteHeader: (p: unknown) => { captured.site.push(p); return null; },
}));
vi.mock('@/components/shell/entry-header', () => ({
  EntryHeader: (p: unknown) => { captured.entry.push(p); return null; },
}));
// 하위 클라이언트 컴포넌트(ReportProgress·ReportActions·ReportDeleteButton)는 각자 useRouter/Realtime
// 구독을 쓴다 - 이 페이지 테스트의 관심사가 아니므로 스텁으로 대체한다(삭제 버튼은 넘기는 값만 본다).
vi.mock('@/components/report/report-progress', () => ({
  ReportProgress: (p: unknown) => { captured.progress.push(p); return null; },
}));
vi.mock('@/components/report/report-actions', () => ({
  ReportActions: (p: unknown) => { captured.actions.push(p); return null; },
}));
vi.mock('@/components/report/report-delete-button', () => ({
  ReportDeleteButton: (p: unknown) => { captured.del.push(p); return null; },
}));

import { createClient } from '@/lib/supabase/server';
import ReportPage, { metadata } from '../page';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';

type Row = Record<string, unknown>;

function table(rows: Row[], error: { message: string } | null = null) {
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
    maybeSingle: async () => ({ data: !error && current.length ? project(current[0]) : null, error }),
    then: (resolve: (v: unknown) => void) => resolve({ data: error ? null : current.map(project), error }),
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

// o: 포함 분석·측정 시각을 바꾸거나 보고서 조회를 실패시킨다(기본은 위 link·analysis·scan 한 건씩)
type MockOptions = { links?: Row[]; analyses?: Row[]; scans?: Row[]; reportError?: { message: string } };

function mockSupabase(report: Row, locations: Row[] = [location], o: MockOptions = {}) {
  vi.mocked(createClient).mockResolvedValue({
    from: (t: string) => {
      if (t === 'reports') return table([report], o.reportError ?? null);
      if (t === 'locations') return table(locations);
      if (t === 'sites') return table([site]);
      if (t === 'report_analyses') return table(o.links ?? [link]);
      if (t === 'analyses') return table(o.analyses ?? [analysis]);
      if (t === 'scans') return table(o.scans ?? [scan]);
      throw new Error(`예상치 못한 테이블: ${t}`);
    },
  } as never);
}

async function renderPage(report: Row = reportRow(), locations: Row[] = [location], o: MockOptions = {}) {
  mockSupabase(report, locations, o);
  const el = await ReportPage({ params: Promise.resolve({ id: 'r1' }) });
  return render(el as ReactElement);
}

beforeEach(() => {
  captured.site.length = 0;
  captured.entry.length = 0;
  captured.del.length = 0;
  captured.progress.length = 0;
  captured.actions.length = 0;
});

describe('ReportPage 현장 헤더·브레드크럼·본문 (Task 10, 스펙 §4.3)', () => {
  it('측정위치의 현장으로 현장 헤더를 그리고 계정 이메일을 넘긴다', async () => {
    await renderPage();
    expect(captured.site).toEqual([{ site: { id: 's1', name: '현장A' }, email: 'u1@example.com' }]);
    expect(captured.entry).toEqual([]);
  });

  it('브레드크럼은 보고서(현장 보고서 목록) / 제목(현재 화면)', async () => {
    await renderPage();
    const nav = screen.getByRole('navigation', { name: '위치' });
    expect(within(nav).getByRole('link', { name: '보고서' })).toHaveAttribute('href', '/sites/s1/reports');
    expect(within(nav).getByText('거실 평활도 분석 보고서').closest('[aria-current]'))
      .toHaveAttribute('aria-current', 'page');
  });

  it('보고서 제목을 h1으로, 본문은 MAIN_BG <main> > PAGE_MAIN으로 그린다', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '거실 평활도 분석 보고서' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main.className).toBe(MAIN_BG);
    expect((main.firstElementChild as HTMLElement).className).toBe(PAGE_MAIN);
  });

  it('삭제하면 이 현장의 보고서 목록으로 간다', async () => {
    await renderPage();
    expect(captured.del).toEqual([{ report: { id: 'r1', status: 'draft' }, redirectTo: '/sites/s1/reports' }]);
  });

  // 측정위치가 지워진 레거시 보고서: 현장을 알 수 없다 - 막다른 화면 대신 진입 헤더 + 현장 목록으로 돌아갈 길
  it('측정위치가 없으면 진입 헤더와 "현장 목록 / 제목" 크럼, 삭제 후에는 진입 페이지로', async () => {
    await renderPage(reportRow(), []);
    expect(captured.site).toEqual([]);
    expect(captured.entry).toEqual([{ email: 'u1@example.com' }]);
    const nav = screen.getByRole('navigation', { name: '위치' });
    expect(within(nav).getByRole('link', { name: '현장 목록' })).toHaveAttribute('href', '/');
    expect(captured.del).toEqual([{ report: { id: 'r1', status: 'draft' }, redirectTo: '/' }]);
  });
});

describe('ReportPage 상태 표시 (reportIndicator 재사용 → StatusIndicator)', () => {
  it('초안 + 생성 완료는 작성 중(pending)으로 표시한다', async () => {
    await renderPage(reportRow({ status: 'draft', gen_status: 'done' }));
    expect(screen.getByText('작성 중').closest('[data-status]')).toHaveAttribute('data-status', 'pending');
  });

  it('발행본은 발행됨(success)으로 표시한다', async () => {
    await renderPage(reportRow({ status: 'finalized' }));
    expect(screen.getByText('발행됨').closest('[data-status]')).toHaveAttribute('data-status', 'success');
  });

  it('PDF 생성 중은 목록과 같게 속 빈 고리(in-progress)다', async () => {
    await renderPage(reportRow({ gen_status: 'processing', pdf_path: null }));
    expect(screen.getByText('PDF 생성 중').closest('[data-status]')).toHaveAttribute('data-status', 'in-progress');
  });
});

describe('ReportPage 포함 분석 (D7: /scans/[scanId]?analysis=[id]로 단축)', () => {
  it('/analyses/[id]가 아니라 스캔 작업대로 바로 링크하고, 판정은 등급 배지(data-grade)다', async () => {
    await renderPage();
    const a = screen.getByRole('link', { name: /바닥.*2026-07-20.*판정/ });
    expect(a).toHaveAttribute('href', '/scans/sc1?analysis=a1');
    expect(a.querySelector('[data-grade="pass"]')).toHaveTextContent('적합');
    expect(within(a).getByText('2026-07-20').className).toContain('font-mono');
  });

  it("'포함 분석' 카드가 건수를 보여준다", async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 2, name: /포함 분석\s*\(1\)/ })).toBeInTheDocument();
  });
});

describe('ReportPage PDF 미리보기 (스펙 §5 16행: 검정 스테이지 위 흰 A4 종이)', () => {
  it('PDF가 있고 생성 완료면 도구 막대 없는 뷰어를 A4 종이(420px, 210:297) 안에 그린다', async () => {
    await renderPage();
    const frame = screen.getByTitle('보고서 PDF 미리보기');
    expect(frame).toHaveAttribute('src', '/api/data/reports/r1/report.pdf#toolbar=0&navpanes=0&view=FitH');
    const paper = frame.parentElement as HTMLElement;
    for (const c of ['bg-paper', 'aspect-[210/297]', 'max-w-[420px]']) expect(paper.className).toContain(c);
    expect(paper.closest('[data-stage]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'PDF 미리보기' })).toBeInTheDocument();
    expect(screen.getByText('reports/r1/report.pdf').className).toContain('font-mono');
  });

  it('PDF가 없으면 스테이지 안에 안내 문구를 보여준다', async () => {
    await renderPage(reportRow({ pdf_path: null, gen_status: 'processing' }));
    const notice = screen.getByText('PDF가 아직 생성되지 않았습니다.');
    expect(notice.closest('[data-stage]')).not.toBeNull();
    expect(screen.queryByTitle('보고서 PDF 미리보기')).toBeNull();
  });
});

// 변이 실험(Task 10 보강): 아래는 위 단언만으로는 조용히 바뀌어도 통과했던 규칙을 지킨다 - PDF 미리보기의 두 조건,
// 포함 분석 줄의 등급·표면·chevron, 하위 컴포넌트에 넘기는 값, 지운/없는 보고서, 조회 오류 화면, <title>.
describe('ReportPage 보강 - PDF 미리보기 조건 (변이 실험으로 드러난 빈틈)', () => {
  it('pdf_path가 있어도 생성이 끝나지(done) 않았으면(재생성 중) 미리보기를 그리지 않는다', async () => {
    await renderPage(reportRow({ gen_status: 'processing' }));
    expect(screen.queryByTitle('보고서 PDF 미리보기')).toBeNull();
    expect(screen.getByText('PDF가 아직 생성되지 않았습니다.')).toBeInTheDocument();
  });

  it('생성이 끝나(done)도 pdf_path가 없으면 미리보기를 그리지 않는다', async () => {
    await renderPage(reportRow({ pdf_path: null, gen_status: 'done' }));
    expect(screen.queryByTitle('보고서 PDF 미리보기')).toBeNull();
    expect(screen.getByText('PDF가 아직 생성되지 않았습니다.')).toBeInTheDocument();
  });
});

describe('ReportPage 보강 - 포함 분석 줄 (변이 실험으로 드러난 빈틈)', () => {
  it('줄마다 표면 이름·측정 시각·엔진 판정 등급을 그리고, 판정이 없으면 판정 불가(na)이며, 끝에 chevron이 있다', async () => {
    await renderPage(reportRow(), [location], {
      links: [
        { report_id: 'r1', analysis_id: 'a1', sort_order: 0 },
        { report_id: 'r1', analysis_id: 'a2', sort_order: 1 },
      ],
      analyses: [
        { id: 'a1', scan_id: 'sc1', surface: 'floor', overall_verdict: 'rework' },
        { id: 'a2', scan_id: 'sc2', surface: 'wall', overall_verdict: null },
      ],
      scans: [scan, { id: 'sc2', scanned_at: '2026-07-21' }],
    });
    const floor = screen.getByRole('link', { name: /바닥.*2026-07-20.*판정/ });
    expect(floor.querySelector('[data-grade="rework"]')).not.toBeNull();
    const wall = screen.getByRole('link', { name: /벽면.*2026-07-21.*판정/ });
    expect(wall.querySelector('[data-grade="na"]')).not.toBeNull();
    for (const row of [floor, wall]) expect(row.querySelector('[data-icon="chevron-right"]')).not.toBeNull();
  });
});

describe('ReportPage 보강 - 하위 컴포넌트에 넘기는 값 (변이 실험으로 드러난 빈틈)', () => {
  it('발행본·생성 실패 보고서의 상태 값을 ReportActions·ReportProgress·ReportDeleteButton에 그대로 넘긴다', async () => {
    await renderPage(reportRow({ status: 'finalized', gen_status: 'failed', gen_error: '워커 오류' }));
    expect(captured.actions).toEqual([{
      report: { id: 'r1', status: 'finalized', gen_status: 'failed', pdf_path: 'reports/r1/report.pdf' },
    }]);
    expect(captured.progress).toEqual([{
      reportId: 'r1', initialStatus: 'failed', genError: '워커 오류', reportStatus: 'finalized',
    }]);
    expect(captured.del).toEqual([{ report: { id: 'r1', status: 'finalized' }, redirectTo: '/sites/s1/reports' }]);
  });
});

describe('ReportPage 보강 - 없는 보고서와 조회 오류 (변이 실험으로 드러난 빈틈)', () => {
  it('<title>은 화면 이름 "보고서 상세"다(앞의 "Flatness · "는 루트 title.template 이 붙인다)', () => {
    expect(metadata.title).toBe('보고서 상세');
  });

  it('지운 보고서(deleted_at)는 상세에서도 notFound다', async () => {
    mockSupabase(reportRow({ deleted_at: '2026-09-05T00:00:00Z' }));
    await expect(ReportPage({ params: Promise.resolve({ id: 'r1' }) }))
      .rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('없는 보고서 id는 notFound다', async () => {
    mockSupabase(reportRow({ id: 'other' }));
    await expect(ReportPage({ params: Promise.resolve({ id: 'r1' }) }))
      .rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('보고서 조회가 실패하면 진입 헤더와 오류 안내를 그린다', async () => {
    await renderPage(reportRow(), [location], { reportError: { message: '연결 끊김' } });
    expect(screen.getByText('상세: 연결 끊김')).toBeInTheDocument();
    expect(captured.entry).toEqual([{ email: 'u1@example.com' }]);
    expect(captured.site).toEqual([]);
  });
});

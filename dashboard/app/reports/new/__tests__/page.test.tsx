// 보고서 생성 화면(스펙 §7.6, §5 15행). 단계 C 회귀 차단(I1) + 단계 H 확장 + 현장 작업 공간(Task 10).
// 보고서 후보 쿼리의 kind 필터는 **지우지 않고** ['flatness','slope']로 넓힌다 - 필터가 통째로 사라지면
// 앞으로 늘어날 kind가 검증 없이 후보로 흘러든다. 서버 컴포넌트 함수를 직접 호출해 쿼리 배선과 후보 산출을
// 함께 확인한다.
//
// 이 스텁은 eq/in/is를 **실제로 적용**하고 select 투영도 PostgREST 순서대로 흉내낸다(필터는 테이블 전체에,
// 투영은 마지막). 스파이 호출만 확인하면 "필터를 걸긴 하는데 결과가 틀린" 회귀를 못 잡고, select 목록에서
// params를 빠뜨려 재판정 차단이 조용히 무력화되는 것도 못 잡는다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

// notFound는 실제 구현을 그대로 쓴다 - "위치를 찾지 못하면 404" 경로를 흉내내지 않고 진짜로 던지게 둬야
// 이 목이 그 경로를 조용히 무력화하는 회귀를 만들지 않는다. redirect만 어디로 보내는지 보이게 바꾼다.
// 측정위치 고르기(클라이언트)는 useRouter가 필요하다.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn() }),
    redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
  };
});
vi.mock('next/headers', () => ({
  headers: async () => new Headers({
    'x-flatness-user-id': 'u1',
    'x-flatness-user-email': encodeURIComponent('u1@example.com'),
  }),
}));

// 헤더는 무엇을 넘기는지만 본다(내부는 Task 2 몫). 후보가 폼까지 도달하는지 보려면 반환된 트리를
// 렌더해야 한다(서버 컴포넌트 함수는 JSX를 돌려줄 뿐 자식을 실행하지 않는다).
const { formProps, headerProps } = vi.hoisted(() => ({
  formProps: {
    current: null as { locationId: string; locationLabel: string; candidates: Record<string, unknown>[] } | null,
  },
  headerProps: { site: [] as unknown[], entry: [] as unknown[] },
}));
vi.mock('@/components/shell/site-header', () => ({
  SiteHeader: (p: unknown) => { headerProps.site.push(p); return null; },
}));
vi.mock('@/components/shell/entry-header', () => ({
  EntryHeader: (p: unknown) => { headerProps.entry.push(p); return null; },
}));
vi.mock('@/components/report/report-create-form', () => ({
  ReportCreateForm: (props: { locationId: string; locationLabel: string; candidates: Record<string, unknown>[] }) => {
    formProps.current = props;
    return null;
  },
}));

import { createClient } from '@/lib/supabase/server';
import NewReportPage, { metadata } from '../page';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';

type Row = Record<string, unknown>;
type Call = [op: string, col: string, val: unknown];

function table(rows: Row[], calls?: Call[], error: { message: string } | null = null) {
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
    eq: (col: string, val: unknown) => {
      calls?.push(['eq', col, val]);
      current = current.filter((r) => r[col] === val);
      return obj;
    },
    in: (col: string, vals: unknown[]) => {
      calls?.push(['in', col, vals]);
      current = current.filter((r) => vals.includes(r[col]));
      return obj;
    },
    is: (col: string, val: unknown) => {
      calls?.push(['is', col, val]);
      current = current.filter((r) => (r[col] ?? null) === val);
      return obj;
    },
    // 정렬 자체는 이 스텁의 관심사가 아니다 - 체인이 끊기지 않게 그대로 통과시킨다.
    order: () => obj,
    maybeSingle: async () => ({ data: !error && current.length ? project(current[0]) : null, error }),
    then: (resolve: (v: unknown) => void) => resolve({ data: error ? null : current.map(project), error }),
  };
  return obj;
}

const location = {
  id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
  memo: null, created_at: '', updated_at: '',
};
const SITE = { id: 's1', name: '현장1', address: null, memo: null, created_at: '', updated_at: '' };

// analyses 쿼리까지 도달하려면 scans가 최소 1건 있어야 한다(scanRows.length가 0이면
// 쿼리 자체를 건너뛰어 이 회귀가 재현되지 않는다).
function scanRow(id: string, surface: string, scannedAt: string): Row {
  return {
    id, location_id: 'l1', surface, scanned_at: scannedAt, device: null, operator_id: null,
    operator_name_manual: null, selected_criteria_id: null, raw_file_path: null,
    original_filename: null, file_format: null, point_count: null, unit_scale: null,
    lineage: 'raw', status: 'ready', deleted_at: null, created_at: '', updated_at: '',
  };
}

function analysisRow(over: Row): Row {
  return {
    id: 'an-flat', scan_id: 'sc1', surface: 'floor', overall_verdict: 'pass',
    auto_summary: '자동 의견', user_summary: null, kind: 'flatness', params: {},
    is_current: true, status: 'done', deleted_at: null, ...over,
  };
}

const FLATNESS = analysisRow({});

async function renderPage(analyses: Row[], calls?: Call[], sites: Row[] = [SITE], o: {
  scans?: Row[]; location?: Row; analysesError?: { message: string };
} = {}) {
  vi.mocked(createClient).mockResolvedValue({
    from: (t: string) => {
      if (t === 'locations') return table([o.location ?? location]);
      if (t === 'sites') return table(sites);
      if (t === 'scans') return table(o.scans ?? [scanRow('sc1', 'floor', '2026-07-20'), scanRow('sc2', 'wall', '2026-07-21')]);
      if (t === 'analyses') return table(analyses, calls, o.analysesError ?? null);
      throw new Error(`예상치 못한 테이블: ${t}`);
    },
  } as never);
  const el = await NewReportPage({ searchParams: Promise.resolve({ location: 'l1' }) });
  render(el as ReactElement);
  return formProps.current;
}

function candidateOf(props: { candidates: Record<string, unknown>[] } | null, id: string) {
  return props?.candidates.find((c) => c.analysis_id === id);
}

function reset() {
  formProps.current = null;
  headerProps.site.length = 0;
  headerProps.entry.length = 0;
}

describe('NewReportPage 진입 경로 (Task 10: 현장은 경로가 정한다, 화면 안 현장 고르기 없음)', () => {
  beforeEach(reset);

  it('현장도 측정위치도 없는 맨 주소는 고를 현장이 없다 - 진입 페이지로 보낸다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: () => { throw new Error('조회하면 안 된다'); },
    } as never);
    await expect(NewReportPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/');
  });

  it('?site=면 그 현장의 측정위치만 고르는 화면을 현장 헤더 안에 보여 준다', async () => {
    const calls: Call[] = [];
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => {
        if (t === 'sites') return table([SITE, { ...SITE, id: 's2', name: '다른 현장' }]);
        if (t === 'locations') return table([location, { ...location, id: 'l9', site_id: 's2', name: '남의 위치' }], calls);
        throw new Error(`예상치 못한 테이블: ${t}`);
      },
    } as never);
    const el = await NewReportPage({ searchParams: Promise.resolve({ site: 's1' }) });
    render(el as ReactElement);
    expect(calls).toContainEqual(['eq', 'site_id', 's1']);
    const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['선택...', '1층']);
    expect(sel.querySelectorAll('optgroup')).toHaveLength(0);
    // 안내 문구는 '측정위치 선택' 카드의 설명이다
    expect(screen.getByRole('heading', { level: 2, name: '측정위치 선택' })).toBeInTheDocument();
    expect(screen.getByText('보고서를 만들 측정위치를 먼저 선택하세요.')).toBeInTheDocument();
    expect(headerProps.site).toEqual([{ site: { id: 's1', name: '현장1' }, email: 'u1@example.com' }]);
    const nav = screen.getByRole('navigation', { name: '위치' });
    expect(within(nav).getByRole('link', { name: '보고서' })).toHaveAttribute('href', '/sites/s1/reports');
    // 후보 로드 폼은 아직 그려지지 않는다 - location을 고르기 전이라 후보를 알 수 없다
    expect(formProps.current).toBeNull();
  });

  // 리뷰 F1(→ Task 10): 측정위치가 하나도 없으면 셀렉트가 "선택..."뿐인 막다른 화면이 된다 - 그 자리에서
  // 측정위치를 만들 수 있는 이 현장의 업로드 화면으로 보낸다.
  it('?site=의 현장에 측정위치가 없으면 고르기 대신 이 현장의 업로드로 안내한다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => {
        if (t === 'sites') return table([SITE]);
        if (t === 'locations') return table([]);
        throw new Error(`예상치 못한 테이블: ${t}`);
      },
    } as never);
    const el = await NewReportPage({ searchParams: Promise.resolve({ site: 's1' }) });
    render(el as ReactElement);
    expect(screen.getByText('이 현장에는 아직 측정위치가 없습니다. 스캔 업로드 화면에서 측정위치를 만들고 '
      + '바로 업로드할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '스캔 업로드로 시작' })).toHaveAttribute('href', '/sites/s1/upload');
    expect(screen.queryByLabelText('측정위치')).toBeNull();
  });

  it('없는 현장 id는 notFound로 보낸다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => {
        if (t === 'sites' || t === 'locations') return table([]);
        throw new Error(`예상치 못한 테이블: ${t}`);
      },
    } as never);
    await expect(NewReportPage({ searchParams: Promise.resolve({ site: 'nope' }) }))
      .rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});

describe('NewReportPage ?location= 경로 (현장 헤더 · 브레드크럼 · 본문)', () => {
  beforeEach(reset);

  it('측정위치의 현장으로 현장 헤더를 그리고, 브레드크럼은 보고서 / 보고서 생성, h1 아래 설명은 측정위치', async () => {
    await renderPage([]);
    expect(headerProps.site).toEqual([{ site: { id: 's1', name: '현장1' }, email: 'u1@example.com' }]);
    expect(headerProps.entry).toEqual([]);
    const nav = screen.getByRole('navigation', { name: '위치' });
    expect(within(nav).getByRole('link', { name: '보고서' })).toHaveAttribute('href', '/sites/s1/reports');
    expect(within(nav).getByText('보고서 생성').closest('[aria-current]')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('보고서 생성');
    expect(screen.getByText('1층')).toBeInTheDocument();
  });

  it('본문은 MAIN_BG <main> > PAGE_MAIN > 760px 열이다', async () => {
    await renderPage([]);
    const main = screen.getByRole('main');
    expect(main.className).toBe(MAIN_BG);
    const body = main.firstElementChild as HTMLElement;
    expect(body.className).toBe(PAGE_MAIN);
    expect((body.firstElementChild as HTMLElement).className).toContain('max-w-[760px]');
  });

  it('현장 행을 읽지 못하면 진입 헤더로 대신한다(막다른 화면 금지)', async () => {
    await renderPage([], undefined, []);
    expect(headerProps.site).toEqual([]);
    expect(headerProps.entry).toEqual([{ email: 'u1@example.com' }]);
  });

  it('완료된 분석이 0건이면 폼 대신 안내(info)와 이 측정위치를 고른 업로드 링크를 둔다', async () => {
    await renderPage([]);
    const notice = screen.getByText(/이 측정위치에는 완료된 분석이 없습니다/);
    expect(notice.closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
    expect(screen.getByRole('link', { name: '스캔 업로드' })).toHaveAttribute('href', '/sites/s1/upload?location=l1');
    expect(formProps.current).toBeNull();
  });
});

describe('NewReportPage 후보 쿼리 (단계 C 회귀 차단 + 단계 H 구배 편입)', () => {
  beforeEach(reset);

  it('kind 필터를 지우지 않고 flatness·slope로 넓혀 건다', async () => {
    const calls: Call[] = [];
    await renderPage([FLATNESS], calls);
    expect(calls).toContainEqual(['in', 'kind', ['flatness', 'slope']]);
    // 단계 C의 좁은 필터로 되돌아가면 구배가 다시 사라진다
    expect(calls).not.toContainEqual(['eq', 'kind', 'flatness']);
  });

  it('구배 분석이 보고서 후보에 나타난다', async () => {
    const props = await renderPage([
      FLATNESS,
      analysisRow({ id: 'an-slope', scan_id: 'sc1', kind: 'slope' }),
    ]);
    expect(props?.candidates.map((c) => c.analysis_id)).toEqual(['an-flat', 'an-slope']);
    expect(candidateOf(props, 'an-slope')).toMatchObject({ kind: 'slope' });
  });

  it('평활도 후보도 그대로 남는다 (구배 편입이 기존 경로를 밀어내지 않는다)', async () => {
    const props = await renderPage([
      FLATNESS,
      analysisRow({ id: 'an-slope', scan_id: 'sc1', kind: 'slope' }),
    ]);
    expect(candidateOf(props, 'an-flat')).toMatchObject({ kind: 'flatness', surface: 'floor' });
  });

  it('후보에 엔진 판정(overall_verdict)을 등급으로 싣고, 판정이 없으면 na', async () => {
    const props = await renderPage([
      FLATNESS,
      analysisRow({ id: 'an-none', scan_id: 'sc1', overall_verdict: null }),
    ]);
    expect(candidateOf(props, 'an-flat')).toMatchObject({ grade: 'pass' });
    expect(candidateOf(props, 'an-none')).toMatchObject({ grade: 'na' });
  });

  it('완료되지 않은 구배 분석은 후보에 없다', async () => {
    const calls: Call[] = [];
    const props = await renderPage([
      FLATNESS,
      analysisRow({ id: 'an-slope-queued', scan_id: 'sc1', kind: 'slope', status: 'queued' }),
    ], calls);
    expect(calls).toContainEqual(['eq', 'status', 'done']);
    expect(props?.candidates.map((c) => c.analysis_id)).toEqual(['an-flat']);
  });

  it('완료되지 않은 평활도 분석도 후보에 없다', async () => {
    const props = await renderPage([
      FLATNESS,
      analysisRow({ id: 'an-flat-proc', scan_id: 'sc1', status: 'processing' }),
    ]);
    expect(props?.candidates.map((c) => c.analysis_id)).toEqual(['an-flat']);
  });
});

// 판단 근거는 page.tsx의 judgeBlockReason 주석에 적혀 있다. 요지: 재판정 중에는
// 워커가 구배 산출물을 제자리에서 덮어쓰는 중이라(설계 결정 D8) 지금 만든 보고서가
// 옛 통계와 새 그림을 섞어 발행본에 박제할 수 있고, 발행본은 되돌릴 수 없다.
describe('NewReportPage 재판정 중 구배 분석 처리 (마이그레이션 009 계약)', () => {
  beforeEach(reset);

  const judging = (state: string) => analysisRow({
    id: 'an-slope', scan_id: 'sc1', kind: 'slope',
    params: { drain_points: [{ x: 1, y: 2 }], judge: { state, at: '2026-08-09T00:00:00Z' } },
  });

  it('재판정 중(processing)인 구배 분석은 후보 목록에서 사라지지 않는다', async () => {
    const props = await renderPage([FLATNESS, judging('processing')]);
    // 완료된 분석이 아무 설명 없이 사라지면 사용자는 원인을 알 수 없다
    expect(props?.candidates.map((c) => c.analysis_id)).toEqual(['an-flat', 'an-slope']);
  });

  it('재판정 중(processing)인 구배 분석은 선택 불가 사유가 붙는다', async () => {
    const props = await renderPage([FLATNESS, judging('processing')]);
    expect(candidateOf(props, 'an-slope')?.blocked_reason).toMatch(/재판정/);
  });

  it('재판정 대기 중(queued)인 구배 분석도 같게 막는다', async () => {
    const props = await renderPage([FLATNESS, judging('queued')]);
    expect(candidateOf(props, 'an-slope')?.blocked_reason).toMatch(/재판정/);
  });

  it('재판정이 끝난(done) 구배 분석은 선택할 수 있다', async () => {
    const props = await renderPage([FLATNESS, judging('done')]);
    expect(candidateOf(props, 'an-slope')?.blocked_reason).toBeNull();
  });

  it('재판정 실패(failed)는 막지 않는다 - 이전 판정이 그대로 남은 종결 상태다', async () => {
    const props = await renderPage([FLATNESS, judging('failed')]);
    expect(candidateOf(props, 'an-slope')?.blocked_reason).toBeNull();
  });

  it('재판정을 돈 적 없는 구배 분석은 막지 않는다', async () => {
    const props = await renderPage([
      FLATNESS,
      analysisRow({ id: 'an-slope', scan_id: 'sc1', kind: 'slope', params: { drain_points: [] } }),
    ]);
    expect(candidateOf(props, 'an-slope')?.blocked_reason).toBeNull();
  });

  it('평활도 분석은 재판정 차단에 걸리지 않는다', async () => {
    // 새 조건이 옛 경로를 잡아채면 평활도 보고서가 통째로 막힌다
    const props = await renderPage([FLATNESS, judging('processing')]);
    expect(candidateOf(props, 'an-flat')?.blocked_reason).toBeNull();
  });
});

// 변이 실험(Task 10 보강): 아래는 위 단언만으로는 조용히 바뀌어도 통과했던 규칙을 지킨다 - 진입 규칙의 정확한 목적지와
// 현장 id 조회, 후보 조회의 범위(현재 분석·지운 분석·다른 측정위치 스캔), 후보 정렬·의견 우선순위·필드 배선,
// 재판정 차단 문구, 폼으로 넘기는 값, 조회 오류 화면, notFound, <title>.
describe('NewReportPage 보강 - 진입 규칙 (변이 실험으로 드러난 빈틈)', () => {
  beforeEach(reset);

  it('<title>은 화면 이름 "보고서 생성"이다(앞의 "Flatness · "는 루트 title.template 이 붙인다)', () => {
    expect(metadata.title).toBe('보고서 생성');
  });

  it('맨 주소의 목적지는 정확히 "/"다(toThrow 부분 문자열 일치가 "/sites" 같은 접두어를 통과시키지 않게)', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: () => { throw new Error('조회하면 안 된다'); },
    } as never);
    await expect(NewReportPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it('?site=은 그 id의 현장 행을 읽는다(다른 현장이 앞에 있어도 섞이지 않는다)', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => {
        if (t === 'sites') return table([SITE, { ...SITE, id: 's2', name: '다른 현장' }]);
        if (t === 'locations') {
          return table([location, { ...location, id: 'l9', site_id: 's2', name: '남의 위치' }]);
        }
        throw new Error(`예상치 못한 테이블: ${t}`);
      },
    } as never);
    const el = await NewReportPage({ searchParams: Promise.resolve({ site: 's2' }) });
    render(el as ReactElement);
    expect(headerProps.site).toEqual([{ site: { id: 's2', name: '다른 현장' }, email: 'u1@example.com' }]);
    const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['선택...', '남의 위치']);
  });

  it('?site= 화면도 MAIN_BG <main> > PAGE_MAIN > 760px 열이다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => {
        if (t === 'sites') return table([SITE]);
        if (t === 'locations') return table([location]);
        throw new Error(`예상치 못한 테이블: ${t}`);
      },
    } as never);
    const el = await NewReportPage({ searchParams: Promise.resolve({ site: 's1' }) });
    render(el as ReactElement);
    const main = screen.getByRole('main');
    expect(main.className).toBe(MAIN_BG);
    const body = main.firstElementChild as HTMLElement;
    expect(body.className).toBe(PAGE_MAIN);
    expect((body.firstElementChild as HTMLElement).className).toContain('max-w-[760px]');
  });
});

describe('NewReportPage 보강 - 조회 오류와 없는 측정위치 (변이 실험으로 드러난 빈틈)', () => {
  beforeEach(reset);

  it('없는 측정위치 id는 notFound로 보낸다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => {
        if (t === 'locations') return table([]);
        throw new Error(`예상치 못한 테이블: ${t}`);
      },
    } as never);
    await expect(NewReportPage({ searchParams: Promise.resolve({ location: 'nope' }) }))
      .rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('측정위치 조회가 실패하면 현장을 모르므로 진입 헤더와 오류 안내를 그린다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => {
        if (t === 'locations') return table([], undefined, { message: '연결 끊김' });
        throw new Error(`예상치 못한 테이블: ${t}`);
      },
    } as never);
    const el = await NewReportPage({ searchParams: Promise.resolve({ location: 'l1' }) });
    render(el as ReactElement);
    expect(screen.getByText('상세: 연결 끊김')).toBeInTheDocument();
    expect(headerProps.entry).toEqual([{ email: 'u1@example.com' }]);
    expect(formProps.current).toBeNull();
  });

  it('?site= 측정위치 목록 조회가 실패하면 고르기 대신 오류 안내를 그린다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => {
        if (t === 'sites') return table([SITE]);
        if (t === 'locations') return table([], undefined, { message: '권한 없음' });
        throw new Error(`예상치 못한 테이블: ${t}`);
      },
    } as never);
    const el = await NewReportPage({ searchParams: Promise.resolve({ site: 's1' }) });
    render(el as ReactElement);
    expect(screen.getByText('상세: 권한 없음')).toBeInTheDocument();
    expect(screen.queryByLabelText('측정위치')).toBeNull();
  });

  it('후보 조회가 실패하면 폼 대신 오류 안내를 그린다', async () => {
    await renderPage([], undefined, [SITE], { analysesError: { message: '시간 초과' } });
    expect(screen.getByText('상세: 시간 초과')).toBeInTheDocument();
    expect(formProps.current).toBeNull();
  });
});

describe('NewReportPage 보강 - 후보 범위·정렬·필드 (변이 실험으로 드러난 빈틈)', () => {
  beforeEach(reset);

  it('후보는 현재(is_current) 분석만이고 지운 분석은 빠진다', async () => {
    const props = await renderPage([
      FLATNESS,
      analysisRow({ id: 'an-old', is_current: false }),
      analysisRow({ id: 'an-del', deleted_at: '2026-09-05T00:00:00Z' }),
    ]);
    expect(props?.candidates.map((c) => c.analysis_id)).toEqual(['an-flat']);
  });

  it('후보는 이 측정위치의 지워지지 않은 스캔에서 나온 분석만이다', async () => {
    const props = await renderPage([
      FLATNESS,
      analysisRow({ id: 'an-other-loc', scan_id: 'sc-other' }),
      analysisRow({ id: 'an-gone-scan', scan_id: 'sc-gone' }),
    ], undefined, [SITE], {
      scans: [
        scanRow('sc1', 'floor', '2026-07-20'),
        { ...scanRow('sc-other', 'floor', '2026-07-22'), location_id: 'l-other' },
        { ...scanRow('sc-gone', 'floor', '2026-07-23'), deleted_at: '2026-09-05T00:00:00Z' },
      ],
    });
    expect(props?.candidates.map((c) => c.analysis_id)).toEqual(['an-flat']);
  });

  it('후보는 종류 → 표면 순으로 정렬한다(입력 순서와 무관)', async () => {
    const props = await renderPage([
      analysisRow({ id: 'an-slope-floor', kind: 'slope', surface: 'floor', scan_id: 'sc1' }),
      analysisRow({ id: 'an-flat-wall', kind: 'flatness', surface: 'wall', scan_id: 'sc2' }),
      analysisRow({ id: 'an-flat-floor', kind: 'flatness', surface: 'floor', scan_id: 'sc1' }),
    ]);
    expect(props?.candidates.map((c) => c.analysis_id))
      .toEqual(['an-flat-floor', 'an-flat-wall', 'an-slope-floor']);
  });

  it('후보에 표면과 측정 시각(스캔의 scanned_at)을 싣는다', async () => {
    const props = await renderPage([
      FLATNESS,
      analysisRow({ id: 'an-wall', surface: 'wall', scan_id: 'sc2' }),
    ]);
    expect(candidateOf(props, 'an-flat')).toMatchObject({ surface: 'floor', scanned_at: '2026-07-20' });
    expect(candidateOf(props, 'an-wall')).toMatchObject({ surface: 'wall', scanned_at: '2026-07-21' });
  });

  it('후보 의견은 사용자가 고친 의견(user_summary)이 자동 의견(auto_summary)보다 앞선다', async () => {
    const props = await renderPage([
      analysisRow({ id: 'an-edited', user_summary: '사용자 의견', auto_summary: '자동 의견' }),
      analysisRow({ id: 'an-auto', kind: 'slope', auto_summary: '자동만' }),
    ]);
    expect(candidateOf(props, 'an-edited')).toMatchObject({ summary: '사용자 의견' });
    expect(candidateOf(props, 'an-auto')).toMatchObject({ summary: '자동만' });
  });

  it.each([
    { state: 'processing', phase: '재판정 중' },
    { state: 'queued', phase: '재판정 대기 중' },
  ])('차단 사유는 진행 단계($phase)를 말한다', async ({ state, phase }) => {
    const props = await renderPage([
      FLATNESS,
      analysisRow({
        id: 'an-slope', kind: 'slope',
        params: { drain_points: [{ x: 1, y: 2 }], judge: { state, at: '2026-08-09T00:00:00Z' } },
      }),
    ]);
    expect(candidateOf(props, 'an-slope')?.blocked_reason)
      .toMatch(new RegExp(`^${phase}이라 지금은 보고서에 넣을 수 없습니다`));
  });
});

describe('NewReportPage 보강 - 폼과 설명에 넘기는 값 (변이 실험으로 드러난 빈틈)', () => {
  beforeEach(reset);

  const full = { ...location, building: '101동', floor: '3층', room: '301호', name: '거실' };

  it('측정위치 표기는 건물 / 층 / 호 / 이름을 " / "로 이어 h1 아래 설명에 보인다', async () => {
    await renderPage([], undefined, [SITE], { location: full });
    expect(screen.getByText('101동 / 3층 / 301호 / 거실')).toBeInTheDocument();
  });

  it('폼에는 이 측정위치의 id와 같은 표기를 넘긴다', async () => {
    await renderPage([FLATNESS], undefined, [SITE], { location: full });
    expect(formProps.current).toMatchObject({ locationId: 'l1', locationLabel: '101동 / 3층 / 301호 / 거실' });
  });
});

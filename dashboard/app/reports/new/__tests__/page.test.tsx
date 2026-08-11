// 단계 C 회귀 차단(I1) + 단계 H 확장. 보고서 후보 쿼리의 kind 필터는 **지우지 않고**
// ['flatness','slope']로 넓힌다 - 필터가 통째로 사라지면 앞으로 늘어날 kind가 검증
// 없이 후보로 흘러든다. 서버 컴포넌트 함수를 직접 호출해 쿼리 배선과 후보 산출을
// 함께 확인한다.
//
// 이 스텁은 eq/in/is를 **실제로 적용**하고 select 투영도 PostgREST 순서대로
// 흉내낸다(필터는 테이블 전체에, 투영은 마지막). 스파이 호출만 확인하면 "필터를
// 걸긴 하는데 결과가 틀린" 회귀를 못 잡고, select 목록에서 params를 빠뜨려 재판정
// 차단이 조용히 무력화되는 것도 못 잡는다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

// D7 Step 1: location 없는 진입 경로가 렌더하는 ReportLocationPicker는 클라이언트
// 컴포넌트라 useRouter가 필요하다. notFound는 실제 구현을 그대로 쓴다 - 기존
// "위치를 찾지 못하면 404" 경로를 흉내내지 않고 실제로 던지게 둬야, 이 목이 그
// 경로를 조용히 무력화하는 회귀를 만들지 않는다.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, useRouter: () => ({ push: vi.fn() }) };
});

// 후보가 실제로 폼까지 도달하는지 보려면 반환된 트리를 렌더해야 한다(서버 컴포넌트
// 함수는 JSX를 돌려줄 뿐 자식을 실행하지 않는다).
const { formProps } = vi.hoisted(() => ({
  formProps: { current: null as { candidates: Record<string, unknown>[] } | null },
}));
vi.mock('@/components/report/report-create-form', () => ({
  ReportCreateForm: (props: { candidates: Record<string, unknown>[] }) => {
    formProps.current = props;
    return null;
  },
}));

import { createClient } from '@/lib/supabase/server';
import NewReportPage from '../page';

type Row = Record<string, unknown>;
type Call = [op: string, col: string, val: unknown];

function table(rows: Row[], calls?: Call[]) {
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
    // 정렬 자체는 이 스텁의 관심사가 아니다(측정위치 선택 UI 테스트는 존재 여부만 본다) -
    // 체인이 끊기지 않게 그대로 통과시킨다.
    order: () => obj,
    maybeSingle: async () => ({ data: current.length ? project(current[0]) : null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: current.map(project), error: null }),
  };
  return obj;
}

const location = {
  id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
  memo: null, created_at: '', updated_at: '',
};

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

// D8 이월(T7 우려사항): location-있는 경로에 3단계 브레드크럼(현장 › 현장명 ›
// 측정위치)을 붙이면서 sites 쿼리가 하나 늘었다 - 스텁이 없는 테이블 접근은
// throw로 즉시 드러나므로 여기서도 채워 둔다(기존 후보 산출 로직은 무변경).
const SITE = { id: 's1', name: '현장1', address: null, memo: null, created_at: '', updated_at: '' };

async function renderPage(analyses: Row[], calls?: Call[]) {
  vi.mocked(createClient).mockResolvedValue({
    from: (t: string) => {
      if (t === 'locations') return table([location]);
      if (t === 'sites') return table([SITE]);
      if (t === 'scans') return table([scanRow('sc1', 'floor', '2026-07-20'), scanRow('sc2', 'wall', '2026-07-21')]);
      if (t === 'analyses') return table(analyses, calls);
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

// D7 Step 1: notFound() 대신 측정위치 선택 UI를 먼저 보여준다. 선택 후에는 서버
// 재조회(?location= 붙은 재요청)로 후보를 로드하므로, 이 화면 자체는 후보 쿼리를
// 전혀 건드리지 않는다 - 그래서 'analyses' 테이블 접근이 없어야 한다(스텁이 없는
// 테이블 접근은 throw로 즉시 드러난다).
describe('NewReportPage location 없는 진입 지원 (D7 Step 1)', () => {
  beforeEach(() => { formProps.current = null; });

  it('location 파라미터가 없으면 측정위치 선택 UI를 먼저 보여준다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => {
        if (t === 'sites') return table([{ id: 's1', name: '현장1', address: null, memo: null, created_at: '', updated_at: '' }]);
        if (t === 'locations') return table([location]);
        throw new Error(`예상치 못한 테이블: ${t}`);
      },
    } as never);
    const el = await NewReportPage({ searchParams: Promise.resolve({}) });
    render(el as ReactElement);
    expect(screen.getByLabelText('측정위치')).toBeInTheDocument();
    // 후보 로드 폼은 아직 그려지지 않는다 - location을 고르기 전이라 후보를 알 수 없다
    expect(formProps.current).toBeNull();
  });

  // 리뷰 F1: 측정위치가 하나도 없으면(모든 현장이 빈 현장인 경우 포함) 셀렉트가
  // "선택..."뿐인 빈 셀렉트로 남아 막다른 화면이 된다 - EmptyState로 업로드 화면
  // (현장·측정위치 인라인 생성이 있는 곳)으로 유도한다.
  it('측정위치가 하나도 없으면 셀렉트 대신 EmptyState로 업로드를 안내한다', async () => {
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => {
        // 현장은 있어도(빈 현장) locations가 0건이면 동일하게 막다른 화면이다.
        if (t === 'sites') return table([{ id: 's1', name: '현장1', address: null, memo: null, created_at: '', updated_at: '' }]);
        if (t === 'locations') return table([]);
        throw new Error(`예상치 못한 테이블: ${t}`);
      },
    } as never);
    const el = await NewReportPage({ searchParams: Promise.resolve({}) });
    render(el as ReactElement);
    expect(screen.getByText('아직 측정위치가 없습니다. 업로드 화면에서 현장·측정위치 생성부터 '
      + '스캔 업로드까지 한 번에 할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '업로드로 시작' })).toHaveAttribute('href', '/upload');
    expect(screen.queryByLabelText('측정위치')).toBeNull();
  });
});

// D8 이월(T7 우려사항): scans/[id]·reports/[id]와 같은 3단계 브레드크럼 규약을
// location-있는 경로에도 맞춘다.
describe('NewReportPage location-있는 경로 브레드크럼 (D8 이월)', () => {
  beforeEach(() => { formProps.current = null; });

  it('현장 홈 › 현장명 › 측정위치 라벨 3단계를 렌더한다', async () => {
    await renderPage([]);
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: '현장' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: '현장1' })).toHaveAttribute('href', '/sites/s1');
    // 크럼 마지막 단계(측정위치 라벨)는 링크가 아니다 - 현재 화면 자신이라 href가 없다.
    expect(within(nav).getByText('1층')).toBeInTheDocument();
  });
});

describe('NewReportPage 후보 쿼리 (단계 C 회귀 차단 + 단계 H 구배 편입)', () => {
  beforeEach(() => { formProps.current = null; });

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

// 판단 근거는 page.tsx의 blockedReason 주석에 적혀 있다. 요지: 재판정 중에는
// 워커가 구배 산출물을 제자리에서 덮어쓰는 중이라(설계 결정 D8) 지금 만든 보고서가
// 옛 통계와 새 그림을 섞어 발행본에 박제할 수 있고, 발행본은 되돌릴 수 없다.
describe('NewReportPage 재판정 중 구배 분석 처리 (마이그레이션 009 계약)', () => {
  beforeEach(() => { formProps.current = null; });

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

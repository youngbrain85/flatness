import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JudgeInfo } from '@/lib/domain/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { useJudgeStatusMock } = vi.hoisted(() => ({
  useJudgeStatusMock: vi.fn((): JudgeInfo | null => null),
}));
vi.mock('@/lib/hooks/use-judge-status', () => ({ useJudgeStatus: useJudgeStatusMock }));

const { supabaseStub, rpcMock, updateMock, eqMock } = vi.hoisted(() => {
  const rpcMock = vi.fn(
    async (_fn: string, _args: unknown): Promise<{ error: { code?: string; message?: string } | null }> => (
      { error: null }
    ),
  );
  const eqMock = vi.fn(async () => ({ error: null as { message: string } | null }));
  const updateMock = vi.fn((_params: unknown) => ({ eq: eqMock }));
  const supabaseStub = { rpc: rpcMock, from: vi.fn(() => ({ update: updateMock })) };
  return { supabaseStub, rpcMock, updateMock, eqMock };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabaseStub }));

import { SlopeResult } from '../slope-result';
import type { AnalysisRow, SlopeCellRow, SlopeStats } from '@/lib/domain/types';

// slope-placeholder.test.tsx에서 계승한 기본 픽스처 - cells_json이 없어(D7)
// "재판정할 수 없습니다" 분기로 떨어진다.
const stats: SlopeStats = {
  format: 'slope-stats-v1', cell_m: 2.0, subcell_m: 0.05,
  threshold: { use: '옥상', design_pct: 2, pass_pct: 0.5, re_pct: 1.5, dir_pass_deg: 30 },
  summary: {
    mean_dev_pct: 0.12, std_dev_pct: 0.05, max_dev_pct: 0.3,
    counts: { 적합: 10, 경계: 2, 보수: 1, 재시공: 0, 판정불가: 3 },
    coverage_pct: 81.2,
  },
  direction_judged: true, drain_points: [[1.2, 3.4]],
  warnings: ['배수구 위치를 지정하지 않아 방향(역구배)을 판정하지 않았습니다. 크기만 판정한 결과입니다.'],
  artifacts: { cells_csv: 'artifacts/a1/slope_cells.csv', map_png: 'artifacts/a1/slope_map.png' },
};

function analysisWith(overStats: unknown, overParams: Record<string, unknown> = {}): AnalysisRow {
  return {
    id: 'a1', scan_id: 'sc1', surface: 'floor', criteria_id: 'c1', applied_criteria: null,
    params: overParams, engine_version: 'p4-0.5.0', status: 'done', stats: overStats as never,
    coverage_pct: 90, overall_verdict: null, warnings: [], artifacts_dir: 'artifacts/a1',
    auto_summary: null, user_summary: null, is_current: true, deleted_at: null,
    created_at: '', created_by: null, kind: 'slope',
  };
}

describe('SlopeResult - cells_json 없는 분석(D7): slope-placeholder.tsx 방어 계승', () => {
  it('종류 배지·판정 요약·편차 통계·경고·판정 지도·재판정 불가 안내를 렌더한다', () => {
    render(<SlopeResult analysis={analysisWith(stats)} />);
    expect(screen.getByText('구배')).toBeInTheDocument();
    expect(screen.getByText('적합 10 · 경계 2 · 보수 1 · 재시공 0 · 판정불가 3')).toBeInTheDocument();
    expect(screen.getByText(/81.2%/)).toBeInTheDocument();
    expect(screen.getByText('0.12%')).toBeInTheDocument();
    expect(screen.getByText('0.05%')).toBeInTheDocument();
    expect(screen.getByText('0.30%')).toBeInTheDocument();
    expect(screen.getByText(/방향\(역구배\)을 판정하지 않았습니다/)).toBeInTheDocument();
    const img = screen.getByAltText('구배 판정 지도') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/data/artifacts/a1/slope_map.png');
    expect(screen.getByText('이 분석은 재판정할 수 없습니다. 구배 분석을 다시 실행하면 배수구를 지정할 수 있습니다.')).toBeInTheDocument();
    // 클릭 안내(배수구 클릭 상단 안내)는 재판정 불가 분기에서는 보이지 않아야 한다.
    expect(screen.queryByText(/배수구 위치를 클릭하세요/)).not.toBeInTheDocument();
  });

  it('전 셀 판정불가(편차 통계 3종 전부 null)면 숫자 대신 안내 문구를 보여준다', () => {
    const allNa: SlopeStats = {
      ...stats,
      summary: {
        mean_dev_pct: null, std_dev_pct: null, max_dev_pct: null,
        counts: { 적합: 0, 경계: 0, 보수: 0, 재시공: 0, 판정불가: 16 },
        coverage_pct: 0,
      },
    };
    render(<SlopeResult analysis={analysisWith(allNa)} />);
    expect(screen.getAllByText('판정 가능한 셀 없음')).toHaveLength(3);
  });

  it('경고가 없으면 경고 섹션을 렌더하지 않는다', () => {
    render(<SlopeResult analysis={analysisWith({ ...stats, warnings: [] })} />);
    expect(screen.queryByText('경고')).not.toBeInTheDocument();
  });

  it('artifacts 키 자체가 없어도 TypeError 없이 렌더한다(판정 지도만 생략)', () => {
    const { artifacts, ...withoutArtifacts } = stats;
    void artifacts;
    render(<SlopeResult analysis={analysisWith(withoutArtifacts)} />);
    expect(screen.getByText('구배')).toBeInTheDocument();
    expect(screen.queryByAltText('구배 판정 지도')).not.toBeInTheDocument();
    expect(screen.getByText(/재판정할 수 없습니다/)).toBeInTheDocument();
  });

  it('warnings 키 자체가 없어도 TypeError 없이 렌더한다(경고 섹션만 생략)', () => {
    const { warnings, ...withoutWarnings } = stats;
    void warnings;
    render(<SlopeResult analysis={analysisWith(withoutWarnings)} />);
    expect(screen.getByText('구배')).toBeInTheDocument();
    expect(screen.queryByText('경고')).not.toBeInTheDocument();
  });

  it('summary.counts 키 자체가 없어도 TypeError 없이 렌더하고 0으로 채운다', () => {
    const withoutCounts = {
      ...stats,
      summary: { mean_dev_pct: 0.1, std_dev_pct: 0.1, max_dev_pct: 0.1, coverage_pct: 50 },
    };
    render(<SlopeResult analysis={analysisWith(withoutCounts)} />);
    expect(screen.getByText('적합 0 · 경계 0 · 보수 0 · 재시공 0 · 판정불가 0')).toBeInTheDocument();
  });

  it('편차 값이 undefined(키 누락)여도 null과 동일하게 안내 문구로 처리한다', () => {
    const { mean_dev_pct, ...restSummary } = stats.summary;
    void mean_dev_pct;
    render(<SlopeResult analysis={analysisWith({ ...stats, summary: restSummary })} />);
    expect(screen.getAllByText('판정 가능한 셀 없음').length).toBeGreaterThanOrEqual(1);
  });

  it('stats가 {} 하나뿐이어도 TypeError 없이 렌더한다', () => {
    render(<SlopeResult analysis={analysisWith({})} />);
    expect(screen.getByText('구배')).toBeInTheDocument();
    expect(screen.getByText(/재판정할 수 없습니다/)).toBeInTheDocument();
  });
});

function slopeCell(over: Partial<SlopeCellRow> = {}): SlopeCellRow {
  return {
    cx: 0, cy: 0, center_x: 1, center_y: 1, n_subcells: 1600,
    slope_pct: 1.5, downhill_rad: 0, rmse_m: 0.0001, se_pct: 0.0006,
    width_m: 2.0, height_m: 2.0, ok: true, zone_id: null, ...over,
  };
}

const rejudgeableStats: SlopeStats = {
  ...stats,
  direction_judged: false,
  warnings: [],
  artifacts: {
    cells_json: 'artifacts/a1/slope_cells.json', judged_json: 'artifacts/a1/slope_judged.json',
    cells_csv: 'artifacts/a1/slope_cells.csv', map_png: 'artifacts/a1/slope_map.png',
  },
};

const cellsFilePayload = {
  schema_version: 2, engine_version: 'p4-0.5.0', cell_m: 2.0, subcell_m: 0.05,
  cells: [slopeCell()],
};

const judgedFilePayload = {
  schema_version: 1, direction_judged: false,
  cells: [{
    cx: 0, cy: 0, grade: '적합', reason: '크기·방향 모두 허용 안',
    dev_pct: 0.5, dir_err_deg: null, correction_mm: 10.0,
  }],
};

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('slope_cells.json')) return { ok: true, json: async () => cellsFilePayload } as Response;
    if (url.includes('slope_judged.json')) return { ok: true, json: async () => judgedFilePayload } as Response;
    return { ok: false } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SlopeResult - cells_json/judged_json 있는 분석: 히트맵/결과표/클릭', () => {
  it('두 파일을 조인해 히트맵·결과표를 렌더하고 배수구 클릭 안내를 보여준다', async () => {
    stubFetch();
    render(<SlopeResult analysis={analysisWith(rejudgeableStats)} />);

    // 상단 안내(§7.2) + (direction_judged=false이므로) 패널의 배수구 지정 안내,
    // 두 곳 모두 "배수구 위치를 클릭하세요"를 담고 있어 getAllByText로 확인한다.
    expect(screen.getAllByText(/배수구 위치를 클릭하세요/).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(document.querySelector('canvas')).not.toBeNull());
    await waitFor(() => expect(screen.getByText('(0, 0)')).toBeInTheDocument());
    expect(screen.getByText('1.50%')).toBeInTheDocument();
  });

  // ★ 브리프 변이 3: cells_json 부재 분기를 제거하면 이 테스트가 실패해야 한다
  // (재판정 불가 분기가 아니라 히트맵 분기로 렌더되는지 확인).
  it('cells_json이 없으면 히트맵을 렌더하지 않는다(D7 분기 유지 확인)', () => {
    render(<SlopeResult analysis={analysisWith(stats)} />);
    expect(document.querySelector('canvas')).toBeNull();
    expect(screen.getByText(/재판정할 수 없습니다/)).toBeInTheDocument();
  });

  // ★ 브리프 변이 1: 클릭 순서(엔큐 먼저, 성공 시 params)를 확인한다.
  it('배수구 클릭: 엔큐 성공 -> params PATCH(drain_points + judge.state=queued) 순서로 호출한다', async () => {
    stubFetch();
    rpcMock.mockClear(); eqMock.mockClear();
    render(<SlopeResult analysis={analysisWith(rejudgeableStats)} />);
    await waitFor(() => expect(document.querySelector('canvas')).not.toBeNull());

    const canvas = document.querySelector('canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({
        left: 0, top: 0, right: canvas.width, bottom: canvas.height,
        width: canvas.width, height: canvas.height, x: 0, y: 0, toJSON() {},
      }),
    });
    fireEvent.click(canvas, { clientX: canvas.width / 2, clientY: canvas.height / 2 });

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock.mock.calls[0][0]).toBe('fn_enqueue_job');
    // 코드리뷰가 지적한 미탐지 변이 2종을 함께 막는다: (R-8) payload에서
    // drain_points가 빠지면 워커가 매번 ValueError를 낸다 - 키 존재를 확인한다.
    // (R-9) 좌표를 [[x,y]] 배열로 실으면 워커의 float(p["x"]) 인덱싱이
    // TypeError를 낸다(§3.5 표준 형태는 {x,y} 객체) - 정확한 형태까지 확인한다.
    const enqueueArg = rpcMock.mock.calls[0][1] as {
      p_type: string; p_payload: { analysis_id: string; drain_points: unknown };
    };
    expect(enqueueArg.p_type).toBe('slope_judge');
    expect(enqueueArg.p_payload.analysis_id).toBe('a1');
    expect(enqueueArg.p_payload.drain_points).toEqual([{ x: expect.any(Number), y: expect.any(Number) }]);
    await waitFor(() => expect(eqMock).toHaveBeenCalledTimes(1));
    // rpc(엔큐)가 update(params PATCH)보다 먼저 호출됐어야 한다(호출 순서).
    expect(rpcMock.mock.invocationCallOrder[0]).toBeLessThan(updateMock.mock.invocationCallOrder[0]);
    const patchArg = updateMock.mock.calls[0][0] as { params: { judge: { state: string } } };
    expect(patchArg.params.judge.state).toBe('queued');
  });

  // ★ 코드리뷰가 지적한 미탐지 변이(R-13): judgeBusy를 무시하면 재판정 진행
  // 중에도 클릭이 새 엔큐를 만들어 D5(진행 중 클릭 비활성)를 위반하고 중복
  // 엔큐로 이어진다.
  it('재판정 진행 중(processing)에는 클릭해도 엔큐하지 않는다(judgeBusy 가드)', async () => {
    stubFetch();
    rpcMock.mockClear();
    // mockReturnValueOnce가 아니라 mockReturnValue다 - 훅은 리렌더마다 새로
    // 호출되므로(fetch 완료 후 setCells가 최소 한 번 더 리렌더를 일으킨다),
    // 첫 호출에만 processing을 주면 클릭 시점엔 이미 기본값(null)으로 돌아가
    // 가드가 시험되지 않는다.
    useJudgeStatusMock.mockReturnValue({ state: 'processing', at: 't0' });
    render(<SlopeResult analysis={analysisWith(rejudgeableStats)} />);
    await waitFor(() => expect(document.querySelector('canvas')).not.toBeNull());

    const canvas = document.querySelector('canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({
        left: 0, top: 0, right: canvas.width, bottom: canvas.height,
        width: canvas.width, height: canvas.height, x: 0, y: 0, toJSON() {},
      }),
    });
    fireEvent.click(canvas, { clientX: canvas.width / 2, clientY: canvas.height / 2 });

    // 비동기 엔큐가 있었다면 뜰 시간을 준 뒤에도 호출되지 않았음을 확인한다.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rpcMock).not.toHaveBeenCalled();

    useJudgeStatusMock.mockReturnValue(null); // 다음 테스트를 위해 기본값으로 복원
  });

  it('배수구 클릭: 엔큐가 23505로 실패하면 params를 건드리지 않고 안내 메시지를 보여준다', async () => {
    stubFetch();
    rpcMock.mockClear(); eqMock.mockClear(); updateMock.mockClear();
    rpcMock.mockImplementationOnce(async (): Promise<{ error: { code: string; message: string } }> => (
      { error: { code: '23505', message: 'dup' } }
    ));
    render(<SlopeResult analysis={analysisWith(rejudgeableStats)} />);
    await waitFor(() => expect(document.querySelector('canvas')).not.toBeNull());

    const canvas = document.querySelector('canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({
        left: 0, top: 0, right: canvas.width, bottom: canvas.height,
        width: canvas.width, height: canvas.height, x: 0, y: 0, toJSON() {},
      }),
    });
    fireEvent.click(canvas, { clientX: canvas.width / 2, clientY: canvas.height / 2 });

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(updateMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/이미 같은 대상의 작업이 대기 중이거나 실행 중입니다/)).toBeInTheDocument();
    });
  });

  // ★ 코드리뷰가 지적한 미탐지 변이(R-11): judge?.at을 fetch effect 의존성에서
  // 빼면, 재판정이 같은 경로를 제자리에서 덮어써도(D8) URL 문자열이 그대로라
  // 재fetch가 안 일어나 히트맵·결과표가 옛 판정 그대로 남는다.
  it('judge.at이 바뀌면(재판정 완료) 셀 데이터를 다시 fetch한다', async () => {
    const fetchMock = stubFetch();
    useJudgeStatusMock.mockReturnValue({ state: 'processing', at: 't0' });
    const { rerender } = render(<SlopeResult analysis={analysisWith(rejudgeableStats)} />);
    await waitFor(() => expect(document.querySelector('canvas')).not.toBeNull());
    const callsBefore = fetchMock.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    // 재판정 완료: judge.at이 바뀐다(analysis.params/URL 문자열 자체는 안 바뀜).
    useJudgeStatusMock.mockReturnValue({ state: 'done', at: 't1' });
    rerender(<SlopeResult analysis={analysisWith(rejudgeableStats)} />);

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));

    useJudgeStatusMock.mockReturnValue(null); // 다음 테스트를 위해 기본값으로 복원
  });

  // ★ 코드리뷰가 지적한 미탐지 변이(R-20): designPct 배선이 stats.threshold.
  // design_pct 대신 항상 0을 쓰면, slope_pct(항상 >=0)가 사실상 언제나 design_pct
  // 이상이 되어 전 셀이 "낮춤"이어야 할 것까지 "높임"으로 뒤집힌다.
  it('결과표의 보정 문구가 stats.threshold.design_pct를 실제로 사용한다(설계 구배 2%, 실측 1.5% -> 낮춤)', async () => {
    stubFetch();
    render(<SlopeResult analysis={analysisWith(rejudgeableStats)} />);
    await waitFor(() => expect(document.querySelector('canvas')).not.toBeNull());
    // rejudgeableStats.threshold.design_pct=2, cellsFilePayload의 셀 slope_pct=1.5
    // -> 1.5 < 2이므로 "낮춤"이어야 한다. designPct가 0으로 배선됐다면
    // 1.5>=0이라 "높임"으로 뒤집힌다.
    await waitFor(() => expect(screen.getByText(/낮춤/)).toBeInTheDocument());
    expect(screen.queryByText(/높임/)).not.toBeInTheDocument();
  });
});

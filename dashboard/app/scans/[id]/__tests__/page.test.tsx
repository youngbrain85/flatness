// 단계 C 회귀 차단: analyses[0] 하나로 화면 전체를 지배하던 옛 로직을
// latestFlatness/latestSlope 종류별 분리로 바꿨다. 이 분리가 되돌아가면
// (1) 구배 분석을 한 번이라도 돌린 순간 평활도의 진행 상태·이전 이력이 사라지고
// (2) 두 종류의 "진행 중" 판정이 서로에게 전염된다. 컴포넌트 단위 테스트
// (analyze-buttons.test.tsx)는 ReanalyzeButton 자체의 동작만 보므로, 이 배선
// 자체가 깨지는 회귀는 페이지 레벨에서만 잡힌다.
//
// Next.js 공식 문서(node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md)가
// "Vitest는 async 서버 컴포넌트 렌더링을 지원하지 않는다"고 명시하므로, render()로
// DOM까지 그리지 않고 await로 얻은 React 엘리먼트 트리를 재귀 탐색한다
// (app/analyses/[id]/__tests__/page.test.tsx, app/sites/[id]/__tests__/page.test.tsx와 동일 패턴).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ScanPage from '../page';
import { AnalysisProgress } from '@/components/analysis-progress';
import { ReanalyzeButton } from '@/components/reanalyze-button';
import type { AnalysisKind, AnalysisRow, LocationRow, ScanRow } from '@/lib/domain/types';

// 엘리먼트 트리를 재귀 탐색해 특정 컴포넌트 타입이 쓰인 곳을 모두 모은다.
// app/analyses/[id]/__tests__/page.test.tsx의 containsType과 같은 이유로 children만
// 따라간다 - ScanPage 자신이 실행한 JSX만 대상이므로(중첩 헬퍼 컴포넌트를 페이지에
// 두지 않았다) children 경로만으로 버튼·링크까지 전부 닿는다.
function findAll(node: unknown, type: unknown, acc: { props: Record<string, unknown> }[] = []) {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) acc.push(el as { props: Record<string, unknown> });
  findAll(el.props?.children, type, acc);
  return acc;
}

function chain(result: { data: unknown; error: null }) {
  const obj: Record<string, unknown> = {
    select: () => obj, eq: () => obj, is: () => obj, order: () => obj,
    maybeSingle: async () => result,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

const location: LocationRow = {
  id: 'l1', site_id: 'site1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
  memo: null, created_at: '', updated_at: '',
};

function mkScan(overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    id: 'sc1', location_id: 'l1', surface: 'floor', scanned_at: '2026-07-20', device: null,
    operator_id: null, operator_name_manual: null, selected_criteria_id: 'cr1', raw_file_path: 'raw-scans/x',
    original_filename: 'a.ply', file_format: 'ply', point_count: null, unit_scale: 1,
    lineage: 'raw', status: 'ready', deleted_at: null, created_at: '', updated_at: '',
    ...overrides,
  };
}

function mkAnalysis(overrides: Partial<AnalysisRow> & { id: string; kind: AnalysisKind }): AnalysisRow {
  return {
    scan_id: 'sc1', surface: 'floor', criteria_id: 'cr1', applied_criteria: null, params: {},
    engine_version: null, status: 'done', stats: null, coverage_pct: null, overall_verdict: null,
    warnings: [], artifacts_dir: null, auto_summary: null, user_summary: null, is_current: true,
    deleted_at: null, created_at: '2026-07-01T00:00:00Z', created_by: null,
    ...overrides,
  };
}

function stubSupabase(scan: ScanRow, analyses: AnalysisRow[], loc: LocationRow | null = location) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'scans') return chain({ data: scan, error: null });
      if (table === 'locations') return chain({ data: loc, error: null });
      if (table === 'analyses') return chain({ data: analyses, error: null });
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

describe('ScanPage 종류별 분석 섹션 배선 (단계 C 회귀 차단)', () => {
  it('벽 스캔이면 구배 버튼을 렌더하지 않는다(평활도 버튼만 남는다)', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness' });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ surface: 'wall' }), [flatness]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const buttons = findAll(el, ReanalyzeButton);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.kind).toBe('flatness');
  });

  it('임포트 결과 스캔이면 구배 버튼을 렌더하지 않는다', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness', engine_version: 'external-colab-v1' });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [flatness]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const buttons = findAll(el, ReanalyzeButton);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.kind).toBe('flatness');
    // 리뷰 Important(I2): 버튼 개수만 세면 isImport 배선 자체는 검증되지 않는다.
    // 이 값이 틀어지면 임포트 스캔 재분석이 'analyze' 잡으로 나가 Colab 편차값이
    // 통째로 무시되고 전 셀이 조용히 "적합"이 된다(C1 사고 계열).
    expect(buttons[0].props.isImport).toBe(true);
  });

  // 리뷰 Important(I1): isExternalImport는 engine_version/stats.meta.source로만
  // 판별하는데, 워커는 이 값들을 잡이 '성공 완료'했을 때만 채운다
  // (worker/flatworker/jobs.py). done이 아닌 임포트 분석에서는 isImport가 항상
  // false로 오판되므로, showSlopeSection이 status==='done'까지 함께 보지 않으면
  // 구배 버튼이 새고 게다가 재시도 소진 후에는 영구히 새는 상태가 된다
  // (fn_job_fail은 잡 타입이 'analyze'일 때만 analyses.status를 건드린다 -
  // 002_functions_seed.sql:88-90 - 이므로 import 잡이 실패해도 분석 행은 queued에
  // 영구히 머문다).
  it('I1 실험군 A: 임포트 분석이 queued(엔진 미착수)면 구배 버튼을 숨긴다', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness', status: 'queued', engine_version: null });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [flatness]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const buttons = findAll(el, ReanalyzeButton);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.kind).toBe('flatness');
  });

  it('I1 실험군 B: 임포트 분석이 failed면 구배 버튼을 숨긴다', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness', status: 'failed', engine_version: null });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [flatness]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const buttons = findAll(el, ReanalyzeButton);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.kind).toBe('flatness');
  });

  it('I1 실험군 C: 완료된 임포트 분석을 재분석해 새 행이 queued로 latest가 되면 구배 버튼을 숨긴다', async () => {
    // 재분석(ReanalyzeButton)이 만드는 새 analyses 행은 status='queued'·
    // engine_version=null로 시작한다(워커가 잡을 집어야 채워진다). 옛 완료 행이
    // engine_version='external-colab-v1'을 갖고 있어도, latestFlatness는 created_at이
    // 더 최근인 이 queued 행이 된다.
    const requeued = mkAnalysis({
      id: 'f2', kind: 'flatness', status: 'queued', engine_version: null,
      created_at: '2026-07-25T00:00:00Z',
    });
    const doneImport = mkAnalysis({
      id: 'f1', kind: 'flatness', status: 'done', engine_version: 'external-colab-v1',
      created_at: '2026-07-20T00:00:00Z',
    });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [requeued, doneImport]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const buttons = findAll(el, ReanalyzeButton);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.kind).toBe('flatness');
  });

  // 재리뷰 I-new: 1차 수정(latestFlatness.status==='done' 요구)이 임포트 오판은
  // 막았지만, 그 대가로 "평활도를 재분석하는 동안 이미 완료된 구배 결과·이력까지
  // 통째로 사라지는" 새 회귀를 만들었다(확정 5 "두 분석은 서로 독립" 위반). 아래
  // E·E2·F·H가 이 트레이드오프의 경계를 각각 확인한다.
  it('E(재리뷰): 정상 스캔의 첫 평활도 분석이 queued면(완료된 분석 없음) 구배 버튼을 숨긴다(받아들인 트레이드오프)', async () => {
    // I1 실험군 A와 구조는 같다 - 완료된 분석이 하나도 없으면 코드는 이 스캔이
    // 임포트인지 정상 LiDAR인지 구별할 방법이 없다(engine_version이 아직 null).
    // 정상 스캔이라도 첫 분석이 끝나기 전까지는 구배 버튼을 숨기는 쪽이 안전하다.
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness', status: 'queued', engine_version: null });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [flatness]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const buttons = findAll(el, ReanalyzeButton);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.kind).toBe('flatness');
  });

  it('F(재리뷰): 정상 스캔의 첫 평활도 분석이 failed면(완료된 분석 없음) 구배 버튼을 숨긴다', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness', status: 'failed', engine_version: null });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [flatness]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const buttons = findAll(el, ReanalyzeButton);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.kind).toBe('flatness');
  });

  it('E2(재리뷰): 평활도 재분석이 queued여도 옛 완료 분석이 LiDAR임을 증명하면 구배 버튼이 살아 있다', async () => {
    // 재분석 큐잉으로 latestFlatness는 status='queued'·engine_version=null이 됐지만,
    // flatnessAnalyses 전체를 훑으면 옛 done 행(f1, 정상 엔진 버전)이 남아 있다 -
    // "완료된 평활도 분석이 하나라도 있으면 그 스캔의 정체를 알 수 있다"는 원칙의
    // 핵심 사례. latestFlatness.status==='done'만 보던 1차 수정이라면 이 버튼이 죽는다.
    const requeued = mkAnalysis({
      id: 'f2', kind: 'flatness', status: 'queued', engine_version: null,
      created_at: '2026-07-25T00:00:00Z',
    });
    const doneLidar = mkAnalysis({
      id: 'f1', kind: 'flatness', status: 'done', engine_version: 'p1d-0.4.0',
      created_at: '2026-07-20T00:00:00Z',
    });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [requeued, doneLidar]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const buttons = findAll(el, ReanalyzeButton);
    const slopeBtn = buttons.find((b) => b.props.kind === 'slope');

    expect(slopeBtn).toBeDefined();
  });

  it('H(재리뷰): 평활도가 processing이어도 이미 완료된 구배 결과·이력은 계속 보인다(확정 5)', async () => {
    // 섹션 렌더 여부(showSlopeSection)와 버튼 노출 여부(showSlopeButton)를 분리한
    // 핵심 사례. latestFlatness가 done이 아니라는 이유만으로 이미 완료된 구배
    // 섹션 전체를 가리면 안 된다 - "두 분석은 서로 독립"(확정 5) 위반이기 때문이다.
    const processingFlatness = mkAnalysis({ id: 'f1', kind: 'flatness', status: 'processing' });
    const doneSlope = mkAnalysis({ id: 's1', kind: 'slope', status: 'done' });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [processingFlatness, doneSlope]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const sections = findAll(el, 'section');
    const progresses = findAll(el, AnalysisProgress);

    // 평활도 섹션(진행 중) + 구배 섹션(완료된 결과 표시) 둘 다 그려진다.
    expect(sections).toHaveLength(2);
    expect(progresses.map((p) => p.props.analysisId)).toEqual(['f1', 's1']);
  });

  it('평활도 첫 분석이 아직 없으면(analyses 없음) 구배 버튼도 함께 숨긴다', async () => {
    // 단위 미확정 등으로 raw_file_path/unit_scale이 아직 없을 수 있는 상태에서는
    // 구배 분석도 걸 수 없다(showSlopeSection 가드).
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ status: 'awaiting_unit_confirm' }), []) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });

    expect(findAll(el, ReanalyzeButton)).toHaveLength(0);
  });

  it('평활도·구배가 공존하면 두 섹션의 진행 상태가 서로 독립이다(analyses[0] 회귀 차단)', async () => {
    // desc 정렬(created_at)을 흉내낸다 - 구배가 더 최근에 등록됐다.
    const slope = mkAnalysis({
      id: 's1', kind: 'slope', status: 'processing', created_at: '2026-07-25T10:00:00Z',
    });
    const flatness = mkAnalysis({
      id: 'f1', kind: 'flatness', status: 'done', created_at: '2026-07-20T09:00:00Z',
    });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [slope, flatness]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const buttons = findAll(el, ReanalyzeButton);
    const flatnessBtn = buttons.find((b) => b.props.kind === 'flatness');
    const slopeBtn = buttons.find((b) => b.props.kind === 'slope');

    expect(buttons).toHaveLength(2);
    // 구배가 더 최근이라도(analyses[0]) 평활도 섹션은 여전히 자기 종류의 latest(done)만 본다.
    expect(flatnessBtn?.props.latestStatus).toBe('done');
    expect(slopeBtn?.props.latestStatus).toBe('processing');
    expect(slopeBtn?.props.siteId).toBe('site1');
  });

  // 리뷰 Important(I4): 코드리뷰 M3("판정 기준 변경 후 다시 돌리기" 취지)의 핵심이다.
  // 회귀하면 사용자가 스캔의 적용 기준을 바꿔도 재분석이 옛(분석 시점에 스냅샷된)
  // 기준을 그대로 따라간다.
  it('I4: 평활도 버튼의 criteriaId는 latestFlatness.criteria_id가 아니라 scan.selected_criteria_id를 우선한다', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness', criteria_id: 'old-snapshot-cr' });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ selected_criteria_id: 'current-cr' }), [flatness]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const buttons = findAll(el, ReanalyzeButton);
    const flatnessBtn = buttons.find((b) => b.props.kind === 'flatness');

    expect(flatnessBtn?.props.criteriaId).toBe('current-cr');
  });

  // 리뷰 Important(M1): 링크 href의 평평한 집합만 보면 "평활도 섹션에 구배 이전
  // 이력이, 구배 섹션에 평활도 이전 이력이 뜨는" 상태(확정 3이 막으려던 바로 그
  // 상태)를 구별하지 못한다. <section> 요소별로 스코프를 나눠 검사한다 - 코드가
  // 항상 평활도 섹션을 먼저, 구배 섹션을 나중에 그린다(app/scans/[id]/page.tsx).
  it('이전 분석 목록이 종류별로 나뉜다(섞이지 않는다, 섹션별 귀속까지 확인)', async () => {
    const flatness2 = mkAnalysis({ id: 'flatness2', kind: 'flatness', created_at: '2026-07-28T00:00:00Z' });
    const slope2 = mkAnalysis({ id: 'slope2', kind: 'slope', created_at: '2026-07-27T00:00:00Z' });
    const flatness1 = mkAnalysis({ id: 'flatness1', kind: 'flatness', created_at: '2026-07-10T00:00:00Z' });
    const slope1 = mkAnalysis({ id: 'slope1', kind: 'slope', created_at: '2026-07-09T00:00:00Z' });
    vi.mocked(createClient).mockResolvedValue(
      // 쿼리가 이미 created_at desc이므로 그 순서대로 넘긴다.
      stubSupabase(mkScan(), [flatness2, slope2, flatness1, slope1]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const sections = findAll(el, 'section');
    expect(sections).toHaveLength(2); // [0] 평활도, [1] 구배 (렌더 순서 고정)
    const flatnessLinks = findAll(sections[0], Link).map((l) => l.props.href);
    const slopeLinks = findAll(sections[1], Link).map((l) => l.props.href);

    // latest(가장 최근 1건)는 "이전 분석" 목록이 아니라 AnalysisProgress로만 표시된다.
    expect(flatnessLinks).toEqual(['/analyses/flatness1']);
    expect(slopeLinks).toEqual(['/analyses/slope1']);
  });
});

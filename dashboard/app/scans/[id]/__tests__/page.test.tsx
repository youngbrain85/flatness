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
import { ScanStepStrip } from '@/components/scan-step-strip';
import { UnitConfirmForm } from '@/components/unit-confirm-form';
import { AnalysisResult } from '@/components/analysis/analysis-result';
import { SlopeResult } from '@/components/analysis/slope-result';
import { PageHeader } from '@/components/ui/page-header';
import type { AnalysisKind, AnalysisRow, LocationRow, ScanRow, SiteRow, Stats } from '@/lib/domain/types';

// D5: searchParams(?analysis=)가 페이지 시그니처에 들어왔다. 모든 호출이 이 헬퍼를
// 거쳐 같은 형태의 props를 만든다.
function pageProps(search: { analysis?: string } = {}) {
  return { params: Promise.resolve({ id: 'sc1' }), searchParams: Promise.resolve(search) };
}

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

// 안내 문구 회귀를 잡으려면 엘리먼트 트리에서 문자열 children을 모아야 한다.
// findAll은 타입(컴포넌트/태그)만 보므로 문구 자체는 잡지 못한다.
function collectText(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') { acc.push(String(node)); return acc; }
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, acc)); return acc; }
  collectText((node as { props?: { children?: unknown } }).props?.children, acc);
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

// D5: 브레드크럼의 현장명은 sites 조회에서 온다.
const site: SiteRow = {
  id: 'site1', name: '테스트 현장', address: null, memo: null, created_at: '', updated_at: '',
};

function mkScan(overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    id: 'sc1', location_id: 'l1', surface: 'floor', scanned_at: '2026-07-20', device: null,
    operator_id: null, operator_name_manual: null, selected_criteria_id: 'cr1', raw_file_path: 'raw-scans/x',
    original_filename: 'a.ply', file_format: 'ply', point_count: null, unit_scale: 1,
    lineage: 'raw', status: 'ready', height_view_path: null,
    deleted_at: null, created_at: '', updated_at: '',
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

function stubSupabase(
  scan: ScanRow, analyses: AnalysisRow[], loc: LocationRow | null = location,
  registration: { id: string } | null = null,
) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'scans') return chain({ data: scan, error: null });
      if (table === 'locations') return chain({ data: loc, error: null });
      if (table === 'analyses') return chain({ data: analyses, error: null });
      // ★ 단계 F: 정합 이력 조회는 lineage === 'registered'일 때만 나가야 한다.
      // 일반 스캔에서 이 테이블에 손대면 여기서 예외로 잡힌다(쿼리 1회 추가는
      // 모든 스캔 상세에 붙는 비용이다).
      if (table === 'registrations') return chain({ data: registration, error: null });
      // D5: 브레드크럼 현장명(sites)과 인라인 결과의 현장 사진(photos).
      if (table === 'sites') return chain({ data: loc ? site : null, error: null });
      if (table === 'photos') return chain({ data: [], error: null });
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

describe('ScanPage 종류별 분석 섹션 배선 (단계 C 회귀 차단)', () => {
  it('벽 스캔이면 구배 버튼을 렌더하지 않는다(평활도 버튼만 남는다)', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness' });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ surface: 'wall' }), [flatness]) as never);

    const el = await ScanPage(pageProps());
    const buttons = findAll(el, ReanalyzeButton);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.kind).toBe('flatness');
  });

  it('임포트 결과 스캔이면 구배 버튼을 렌더하지 않는다', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness', engine_version: 'external-colab-v1' });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [flatness]) as never);

    const el = await ScanPage(pageProps());
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

    const el = await ScanPage(pageProps());
    const buttons = findAll(el, ReanalyzeButton);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.kind).toBe('flatness');
  });

  it('I1 실험군 B: 임포트 분석이 failed면 구배 버튼을 숨긴다', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness', status: 'failed', engine_version: null });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [flatness]) as never);

    const el = await ScanPage(pageProps());
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

    const el = await ScanPage(pageProps());
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

    const el = await ScanPage(pageProps());
    const buttons = findAll(el, ReanalyzeButton);

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.kind).toBe('flatness');
  });

  it('F(재리뷰): 정상 스캔의 첫 평활도 분석이 failed면(완료된 분석 없음) 구배 버튼을 숨긴다', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness', status: 'failed', engine_version: null });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [flatness]) as never);

    const el = await ScanPage(pageProps());
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

    const el = await ScanPage(pageProps());
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

    const el = await ScanPage(pageProps());
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

    const el = await ScanPage(pageProps());

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

    const el = await ScanPage(pageProps());
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

    const el = await ScanPage(pageProps());
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

    const el = await ScanPage(pageProps());
    const sections = findAll(el, 'section');
    expect(sections).toHaveLength(2); // [0] 평활도, [1] 구배 (렌더 순서 고정)
    const flatnessLinks = findAll(sections[0], Link).map((l) => l.props.href);
    const slopeLinks = findAll(sections[1], Link).map((l) => l.props.href);

    // latest(가장 최근 1건)는 "이전 분석" 목록이 아니라 AnalysisProgress로만 표시된다.
    // D5: 이력 링크는 별도 화면(/analyses/[id])이 아니라 같은 작업대의
    // ?analysis= 선택 렌더로 간다(T6 리다이렉트가 이 규약을 쓴다).
    expect(flatnessLinks).toEqual(['/scans/sc1?analysis=flatness1']);
    expect(slopeLinks).toEqual(['/scans/sc1?analysis=slope1']);
  });
});

describe('ScanPage 메타·안내 문구 (단계 E)', () => {
  // E1: uploaded 안내가 "워커가 실행 중인지 확인하세요(python -m flatworker)"였다.
  // 이건 운영자 지시문이지 사용자 안내가 아니다 - 대시보드만 쓰는 사용자는 워커를
  // 실행할 수도, 확인할 수도 없어서 정상적인 대기 상태를 장애로 오인한다.
  it('E1: uploaded 안내는 워커 실행 여부가 아니라 소요 시간을 알린다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ status: 'uploaded' }), []) as never);

    const el = await ScanPage(pageProps());
    const text = collectText(el).join('');

    expect(text).toContain('파일 크기에 따라 수십 초 걸릴 수 있습니다');
    expect(text).not.toContain('워커가 실행 중인지 확인하세요');
  });

  // point_count는 001_schema.sql에 선언만 되고 비어 있다가 이번 단계에서
  // precheck가 채우기 시작했다(worker/flatworker/jobs.py). 어디에도 안 보이면
  // 채우는 의미가 없다.
  it('precheck가 채운 점 개수를 스캔 메타에 보여준다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ point_count: 1234567 }), []) as never);

    const el = await ScanPage(pageProps());
    const text = collectText(el).join('');

    expect(text).toContain('점 개수');
    expect(text).toContain('1,234,567');
  });

  // ★ 리뷰 I1(단계 F): 병합 스캔은 정합 성공 즉시 status='ready'로 목록에 뜬다.
  // 정합 화면으로 돌아가는 길이 없으면 이 경로로 들어온 사용자는 겹쳐보기(RMSE가
  // 원리적으로 못 보는 수평 어긋남을 확인하는 유일한 수단)를 찾을 방법이 없다.
  //
  // ★★ 정정(단계 F 최종 리뷰 Critical): 이 주석은 원래 "여기서 바로 분석할 수 있다"고
  // 적혀 있었는데 **거짓이었다.** 병합 스캔은 analyses 행 없이 ready로 만들어지므로
  // (worker의 _merged_scan_fields) 당시 이 화면의 분석 진입점 셋이 전부 비껴갔고,
  // 바로 아래 테스트가 `analyses: []`인 병합 스캔을 실제로 렌더하면서도 정합 링크만
  // 확인하고 넘어가 반증을 놓쳤다. 분석 진입점은 아래 별도 describe가 단언한다 -
  // 주석이 사실을 대신하지 못한다.
  it('정합 병합 스캔이면 정합 화면으로 돌아가는 링크를 단다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ lineage: 'registered' }), [], location, { id: 'reg-9' }) as never);

    const el = await ScanPage(pageProps());
    const hrefs = findAll(el, Link).map((l) => l.props.href);
    const text = collectText(el).join('');

    expect(hrefs).toContain('/registrations/reg-9');
    expect(text).toContain('정합해 만든 병합 스캔');
    expect(text).toContain('수직 방향만');
  });

  it('정합 이력을 못 찾으면 링크 대신 주의를 알린다(이력 삭제 등)', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ lineage: 'registered' }), [], location, null) as never);

    const el = await ScanPage(pageProps());
    const hrefs = findAll(el, Link).map((l) => l.props.href);
    const text = collectText(el).join('');

    expect(hrefs.some((h) => String(h).startsWith('/registrations/'))).toBe(false);
    expect(text).toContain('정합 이력을 찾지 못했습니다');
  });

  // 일반 스캔에서 registrations를 조회하면 stubSupabase가 예외를 던진다 - 즉 이 테스트가
  // "쿼리 1회가 모든 스캔 상세에 무조건 붙는" 회귀를 잡는다.
  it('일반 스캔에서는 정합 이력을 조회하지도, 안내를 띄우지도 않는다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ lineage: 'raw' }), []) as never);

    const el = await ScanPage(pageProps());

    expect(collectText(el).join('')).not.toContain('정합해 만든 병합 스캔');
  });

  it('점 개수가 없는 기존 스캔에서도 메타가 죽지 않는다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ point_count: null }), []) as never);

    const el = await ScanPage(pageProps());
    const text = collectText(el).join('');

    expect(text).toContain('점 개수');
  });
});

// ★ 단계 F 최종 리뷰 Critical: status='ready'인데 평활도 analyses 행이 없는 스캔은
// **분석을 시작할 방법이 아예 없었다.** 이 화면의 진입점 셋이 전부 이 상태를 비껴간다:
// 단위 확인 링크는 awaiting_unit_confirm 전용, 평활도 ReanalyzeButton은 기존 analyses
// 행을 요구, 구배 버튼은 완료된 평활도 분석을 요구. 그런데 상태 칸과 측정위치 트리는
// SCAN_STATUS_LABEL.ready("분석 준비됨")를 달아 할 수 있다고 말한다 - 막다른 골목이다.
//
// 이 상태에 도달하는 경로가 둘이라 진입점을 계보로 좁히지 않았다:
//   (1) 정합 성공이 만드는 병합 스캔(worker의 _merged_scan_fields - ready·행 없음),
//   (2) unit-confirm-form.tsx의 되돌리기까지 실패해 남은 고아 스캔(그 파일 52-56행
//       주석이 이 골목을 그대로 적어 놓고 "관리자에게 알리세요"로 끝난다).
describe('ScanPage 분석 시작 진입점 (단계 F 최종 리뷰 Critical)', () => {
  // ★★ 재리뷰 Critical(C1-c): 1차 수정은 "임포트 스캔은 ready+분석0행 상태에 존재할 수
  // 없다"고 단정하고 isImport=false를 고정했는데 **틀렸다.** upload-form.tsx는 3)에서
  // status='ready'로 먼저 승격하고 4)에서야 analyses 행을 만든다 - 그 사이에 탭이
  // 닫히면 정리 코드가 아예 안 돈다. 그러면 Colab 결과 CSV에 'analyze' 잡이 걸려
  // Signed_Distance_mm이 무시되고 전 셀이 조용히 "적합"이 된다(C1 사고 계열).
  //
  // 아래 세 테스트가 그 세 경로를 각각 못 박는다. 특히 임포트 건은 **실패 방향
  // 단언**이다 - 1차 수정에서 이 자리를 주석 5줄이 대신했고, 같은 파일이 스스로
  // 적어 둔 "주석이 사실을 대신하지 못한다"에 정확히 걸렸다.
  it('경로3(실패 방향): 임포트 고아 스캔(ready·분석 0행)에는 분석 버튼을 띄우지 않는다', async () => {
    // upload-form.tsx의 mode='import'가 만드는 그대로: lineage='unknown'(DB 기본값이자
    // 임포트가 쓰는 값), unit_scale=1.0, status='ready', 그리고 precheck를 돌지 않아
    // height_view_path=null. 여기서 버튼이 뜨면 isImport=false로 'analyze' 잡이 걸린다.
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        lineage: 'unknown', status: 'ready', unit_scale: 1.0,
        original_filename: 'colab_result.csv', file_format: 'csv', height_view_path: null,
      }), []) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, ReanalyzeButton)).toHaveLength(0);
    // 안내 문구도 새면 안 된다 - "바로 분석할 수 있다"고 말해 놓고 버튼이 없으면
    // 그 자체가 1차 수정이 고치려던 거짓말의 재발이다.
    expect(collectText(el).join('')).not.toContain('첫 분석을 시작하세요');
  });

  it('경로3 변형: JSON 임포트 고아 스캔도 마찬가지로 막는다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        lineage: 'unknown', status: 'ready', unit_scale: 1.0,
        original_filename: 'result.json', file_format: 'json', height_view_path: null,
      }), []) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, ReanalyzeButton)).toHaveLength(0);
  });

  // 받아들인 트레이드오프의 경계. precheck는 돌았지만 높이 뷰 렌더가 실패해
  // height_view_path가 비었고(worker의 handle_precheck가 except로 삼킨다) 단위 확정까지
  // 실패한 스캔은 임포트와 구별할 수 없다 - 고치기 전과 같은 막다른 골목으로 남는다.
  // 조용한 오답보다 조용한 막다른 골목이 낫다는 판단을 여기 못 박는다.
  it('판별 불가(높이 뷰 없는 raw 고아 스캔)면 버튼을 띄우지 않는다(받아들인 트레이드오프)', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        lineage: 'raw', status: 'ready', height_view_path: null,
      }), []) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, ReanalyzeButton)).toHaveLength(0);
  });

  it('경로1: 병합 스캔(ready·분석 행 없음)에 평활도 분석 시작 버튼이 있다', async () => {
    // ★ height_view_path를 명시적으로 null로 둔다. 병합 스캔은 precheck를 돌지 않아
    // 이 값이 없다(worker의 handle_register는 이 필드를 건드리지 않는다) - 임포트
    // 판별을 height_view_path 하나로만 하면 병합 스캔이 통째로 막힌다.
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(
        mkScan({
          lineage: 'registered', selected_criteria_id: 'cr-merged', height_view_path: null,
        }), [],
        location, { id: 'reg-9' },
      ) as never);

    const el = await ScanPage(pageProps());
    const flatnessBtn = findAll(el, ReanalyzeButton).find((b) => b.props.kind === 'flatness');

    expect(flatnessBtn).toBeDefined();
    // 기준은 스캔이 원본 A에서 물려받은 selected_criteria_id다.
    expect(flatnessBtn?.props.criteriaId).toBe('cr-merged');
    // 병합 점군은 워커가 만든 ply다 - 'import' 잡을 걸면 안 된다(C1 사고 계열).
    expect(flatnessBtn?.props.isImport).toBe(false);
    // 직전 상태가 없어야 버튼이 활성이다. 값이 새면 첫 분석 버튼이 비활성으로 굳는다.
    expect(flatnessBtn?.props.latestStatus).toBeUndefined();
  });

  // 병합 점군은 unit_scale이 이미 1.0(미터)이다. confirm-unit은 "파일 좌표가 m·cm·mm 중
  // 무엇인지 확정하는 단계"라 틀린 안내이고, 거기서 mm를 고르면 멀쩡한 좌표가 1/1000이
  // 된다. 우회로였던 그 화면으로 되돌리는 것은 해법이 아니다.
  it('병합 스캔을 단위 확인 화면으로 되돌리지 않고 그 이유를 밝힌다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ lineage: 'registered', height_view_path: null }), [],
        location, { id: 'reg-9' }) as never);

    const el = await ScanPage(pageProps());
    const hrefs = findAll(el, Link).map((l) => String(l.props.href));

    expect(hrefs.some((h) => h.includes('confirm-unit'))).toBe(false);
    expect(collectText(el).join('')).toContain('이미 미터로 환산돼 있어');
  });

  it('경로2: 단위 확정 직후 실패로 남은 고아 스캔(raw·ready·분석 없음)도 같은 진입점을 얻는다', async () => {
    // 이 스캔은 uploaded -> precheck -> awaiting_unit_confirm을 거쳐 왔으므로
    // height_view_path가 채워져 있다(worker의 handle_precheck:155). 그 값이 이 스캔이
    // 임포트가 아님을 증명한다 - 임포트는 precheck를 아예 돌지 않기 때문이다.
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        lineage: 'raw', status: 'ready',
        height_view_path: 'artifacts/scans/sc1/height_view.png',
      }), []) as never);

    const el = await ScanPage(pageProps());
    const flatnessBtn = findAll(el, ReanalyzeButton).find((b) => b.props.kind === 'flatness');

    expect(flatnessBtn).toBeDefined();
    expect(flatnessBtn?.props.criteriaId).toBe('cr1');
    expect(flatnessBtn?.props.isImport).toBe(false);
  });

  // ★ 기존 흐름(awaiting_unit_confirm -> ready) 회귀 방지. 새 진입점이 단위 미확정
  // 스캔까지 삼키면 단위를 확정하지 않은 채 분석이 돌아 결과 전체가 왜곡된다.
  //
  // ★★ 재재리뷰: 이 픽스처는 height_view_path를 **반드시** 채워야 한다. 비워 두면
  // provenNotImport가 먼저 막아 버려서, 이 테스트가 상태 게이트가 아니라 임포트
  // 판별자 덕분에 통과한다 - 그러면 상태 조건을 'ready || awaiting_unit_confirm'으로
  // 넓히는 회귀를 아무도 못 잡고, 이 테스트가 스스로 내건 근거(위 문단)를 지키지
  // 못한다. 실제로도 이 상태의 스캔은 precheck를 끝낸 뒤이므로 값이 채워져 있는
  // 쪽이 사실에 맞다(worker의 handle_precheck가 status와 함께 한 PATCH로 넣는다).
  it('단위 미확정 스캔은 단위 확정 폼을 인라인으로 띄우고 직행 버튼은 띄우지 않는다', async () => {
    // D5: 별도 confirm-unit 화면으로 보내는 대신 그 화면이 렌더하던 것(높이 뷰 +
    // UnitConfirmForm)을 이 화면 안에 섹션으로 렌더한다. confirm-unit으로 가는
    // 링크가 남아 있으면 안 된다 - T6가 그 URL을 다시 이 화면으로 리다이렉트하므로
    // 링크가 있으면 제자리 순환이 된다.
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        status: 'awaiting_unit_confirm', unit_scale: null,
        height_view_path: 'artifacts/scans/sc1/height_view.png',
      }), []) as never);

    const el = await ScanPage(pageProps());
    const hrefs = findAll(el, Link).map((l) => String(l.props.href));
    const forms = findAll(el, UnitConfirmForm);

    expect(hrefs.some((h) => h.includes('confirm-unit'))).toBe(false);
    expect(forms).toHaveLength(1);
    // 폼이 조회해 온 스캔 행(높이 뷰 경로 포함)을 그대로 받아야 한다.
    expect((forms[0].props.scan as ScanRow).id).toBe('sc1');
    expect((forms[0].props.scan as ScanRow).height_view_path)
      .toBe('artifacts/scans/sc1/height_view.png');
    expect(forms[0].props.userId).toBe('u1');
    expect(findAll(el, ReanalyzeButton)).toHaveLength(0);
  });

  it('단위 확정이 끝난 스캔(ready)에는 단위 확정 폼이 뜨지 않는다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        status: 'ready', height_view_path: 'artifacts/scans/sc1/height_view.png',
      }), []) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, UnitConfirmForm)).toHaveLength(0);
  });

  // 사전 검사 대기 중인 스캔에는 아직 raw 좌표도 단위도 없다.
  //
  // ★★ 재재리뷰: 위와 같은 이유로 height_view_path를 채운다. uploaded 상태에서 이
  // 값이 자연히 나오지는 않지만(handle_precheck가 status와 함께 채운다), 여기서는
  // provenNotImport를 참으로 만들어 **상태 게이트만** 시험대에 올리려는 의도적
  // 픽스처다. 비워 두면 임포트 판별자가 대신 막아 상태 조건 회귀가 통째로 샌다.
  it('사전 검사 대기(uploaded) 스캔에는 분석 시작 버튼을 띄우지 않는다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        status: 'uploaded', unit_scale: null,
        height_view_path: 'artifacts/scans/sc1/height_view.png',
      }), []) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, ReanalyzeButton)).toHaveLength(0);
  });

  // ★★ 재재리뷰: provenNotImport의 `!!` truthy 검사가 하중을 지게 한다. 근거를
  // 주석으로만 적어 두면 `!!x` -> `x !== null` 변이가 조용히 살아남는다.
  // 010_scan_height_view.sql을 아직 적용하지 않은 DB에서는 select('*')에 이 컬럼이
  // 아예 없어 undefined로 온다 - `!== null`로 좁히면 **그 DB의 모든 스캔이 "임포트가
  // 아님"으로 잘못 증명되어** Colab CSV에 'analyze' 잡이 걸린다. 형제 화면의 같은
  // 가드(components/__tests__/unit-confirm-form.test.tsx)와 같은 패턴이지만, 저쪽의
  // 실패 모드가 죽은 화면인 데 비해 여기는 조용한 오답이라 더 나쁘다.
  it.each([
    ['undefined(010 미적용 DB의 select(*))', undefined],
    ['빈 문자열', ''],
  ])('height_view_path가 %s면 임포트 판별 불가로 보고 버튼을 띄우지 않는다', async (_label, value) => {
    const oddScan = {
      ...mkScan({ status: 'ready', lineage: 'raw' }), height_view_path: value,
    } as unknown as ScanRow;
    vi.mocked(createClient).mockResolvedValue(stubSupabase(oddScan, []) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, ReanalyzeButton)).toHaveLength(0);
  });

  // ★ 재리뷰 D6: 상태 조건의 경계를 못 박는다. 이전에는 'ready'를 'archived'까지
  // 넓혀도 아무 테스트가 잡지 않았다. 보관된 스캔에 새 분석을 걸 수 있으면 안 된다.
  it('D6 경계: 보관된(archived) 스캔에는 분석 시작 버튼을 띄우지 않는다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        status: 'archived', height_view_path: 'artifacts/scans/sc1/height_view.png',
      }), []) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, ReanalyzeButton)).toHaveLength(0);
  });

  it('평활도 분석이 이미 있으면 진입점이 겹쳐 뜨지 않는다(재분석 버튼 하나뿐)', async () => {
    // height_view_path를 채워 provenNotImport를 참으로 만든다 - 그러지 않으면 이
    // 테스트가 "임포트 판별에 막혀서" 통과해 정작 막으려던 중복 렌더를 못 본다.
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness' });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        status: 'ready', height_view_path: 'artifacts/scans/sc1/height_view.png',
      }), [flatness]) as never);

    const el = await ScanPage(pageProps());
    const flatnessBtns = findAll(el, ReanalyzeButton).filter((b) => b.props.kind === 'flatness');

    expect(flatnessBtns).toHaveLength(1);
    expect(flatnessBtns[0].props.latestStatus).toBe('done');
  });
});

// 리뷰 Important(F2): D6가 app/scans/[id]/confirm-unit/page.tsx를 순수 리다이렉트로
// 바꾸면서 그 파일의 테스트(app/scans/[id]/confirm-unit/__tests__/page.test.tsx)를
// 지웠다. 그 테스트가 지키던 회귀 가드 2건(페이지 폭, 안내 문단)은 실제 렌더가 이미
// D5 때 이 파일로 이관돼 있었는데도 이관되지 않은 채 빠져 있었다 - 여기서 복원한다.
describe('ScanPage 단위 확인 인라인 (D6 이월: confirm-unit 삭제로 유실된 회귀 가드 복원)', () => {
  // 원본 주석(단계 E 리뷰 7): "이 페이지에는 테스트가 아예 없어서, 높이 뷰가 실제로
  // 쓰는 페이지 폭(max-w-6xl)과 안내 문단이 무방비였다. max-w-md로 되돌리면 그림이
  // 폼 폭으로 쪼그라들어 축 눈금을 못 읽는데(이 화면의 존재 이유가 무너진다) 아무도
  // 못 잡는다."
  it('단계 E 리뷰 7: 페이지 폭을 max-w-6xl로 유지한다(높이 뷰 2열 배치가 쓰는 폭이다)', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        status: 'awaiting_unit_confirm', unit_scale: null,
        height_view_path: 'artifacts/scans/sc1/height_view.png',
      }), []) as never);

    const el = await ScanPage(pageProps());
    const main = el as { type: string; props: { className: string } };

    expect(main.type).toBe('main');
    expect(main.props.className).toContain('max-w-6xl');
    expect(main.props.className).not.toContain('max-w-md');
  });

  it.each([
    ['높이 뷰 있음', 'artifacts/scans/sc1/height_view.png'],
    ['높이 뷰 없음(파일명·내보내기 설정으로만 판단)', null],
  ] as const)('%s이어도 그림 유무 양쪽을 포괄하는 안내 문단을 보여준다', async (_label, heightViewPath) => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        status: 'awaiting_unit_confirm', unit_scale: null, height_view_path: heightViewPath,
      }), []) as never);

    const el = await ScanPage(pageProps());
    const text = collectText(el).join('');

    // 그림이 있을 때: 축 눈금으로 판단 / 없을 때: 파일명·내보내기 설정으로 판단
    expect(text).toContain('축 눈금');
    expect(text).toContain('내보내기 설정');
  });
});

// ---- D5 스캔 작업대 통합 ----
// 헤더(브레드크럼·보고서 원클릭) + 단계 스트립 배선 + 결과 인라인(?analysis= 선택).
// 결과 분기 자체(isSlopeStats -> SlopeResult)는 app/analyses/[id]에서 이관해 온
// 가드다 - 그 파일의 테스트가 지키던 것을 이 화면에서 다시 못 박는다.

// 인라인 결과 렌더 조건(done + stats 존재)을 시험할 최소 stats. 컴포넌트 자체는
// 실행되지 않으므로(클라이언트 컴포넌트 - 엘리먼트 트리에 타입으로만 남는다)
// 형태 판별에 쓰이는 필드만 있으면 된다.
const FLAT_STATS = { n_cells: 1 } as unknown as Stats;
const SLOPE_STATS = { format: 'slope-stats-v1' } as unknown as Stats;

describe('ScanPage 헤더·단계 스트립 (D5)', () => {
  it('브레드크럼이 현장 › 현장명 › 측정위치로 이어지고 제목에 스캔 메타가 실린다', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), []) as never);

    const el = await ScanPage(pageProps());
    const headers = findAll(el, PageHeader);

    expect(headers).toHaveLength(1);
    expect(headers[0].props.crumbs).toEqual([
      { href: '/', label: '현장' },
      { href: '/sites/site1', label: '테스트 현장' },
      { label: '1층' },
    ]);
    const title = collectText(headers[0].props.title).join('');
    expect(title).toContain('스캔');
    expect(title).toContain('바닥');
    expect(title).toContain('2026-07-20');
  });

  it('완료된 분석이 있으면 헤더 액션에 "이 위치의 보고서 생성" 링크가 뜬다', async () => {
    const flatness = mkAnalysis({ id: 'f1', kind: 'flatness' }); // status 기본 done
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [flatness]) as never);

    const el = await ScanPage(pageProps());
    const header = findAll(el, PageHeader)[0];
    const actionHrefs = findAll(header.props.actions, Link).map((l) => String(l.props.href));

    expect(actionHrefs).toContain('/reports/new?location=l1');
  });

  it('완료된 분석이 하나도 없으면 보고서 생성 액션이 없다(빈 보고서 유도 방지)', async () => {
    const queued = mkAnalysis({ id: 'f1', kind: 'flatness', status: 'queued' });
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [queued]) as never);

    const el = await ScanPage(pageProps());
    const header = findAll(el, PageHeader)[0];

    expect(findAll(header.props.actions, Link)).toHaveLength(0);
  });

  it('단계 스트립에 스캔 상태가 배선된다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ status: 'awaiting_unit_confirm', unit_scale: null }), []) as never);

    const el = await ScanPage(pageProps());
    const strips = findAll(el, ScanStepStrip);

    expect(strips).toHaveLength(1);
    expect(strips[0].props.status).toBe('awaiting_unit_confirm');
    expect(strips[0].props.hasDoneAnalysis).toBe(false);
  });

  it.each([
    ['평활도 done', [mkAnalysis({ id: 'f1', kind: 'flatness' as AnalysisKind })]],
    ['구배 done', [mkAnalysis({ id: 's1', kind: 'slope' as AnalysisKind })]],
  ])('%s 분석이 있으면 hasDoneAnalysis가 참이다(두 종류 모두 집계)', async (_l, analyses) => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), analyses) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, ScanStepStrip)[0].props.hasDoneAnalysis).toBe(true);
  });

  it('진행 중(queued) 분석만 있으면 hasDoneAnalysis가 거짓이다', async () => {
    const queued = mkAnalysis({ id: 'f1', kind: 'flatness', status: 'queued' });
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [queued]) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, ScanStepStrip)[0].props.hasDoneAnalysis).toBe(false);
  });

  it('failed 스캔에는 업로드 화면으로 가는 재시도 링크가 뜬다(현장·위치 프리필)', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ status: 'failed' }), []) as never);

    const el = await ScanPage(pageProps());
    const hrefs = findAll(el, Link).map((l) => String(l.props.href));

    expect(hrefs).toContain('/upload?site=site1&location=l1');
    expect(collectText(el).join('')).toContain('다시 업로드');
  });
});

describe('ScanPage 결과 인라인 (D5: analyses/[id] 렌더 이관)', () => {
  it('기본 선택은 최신 완료 분석이다(AnalysisResult에 scan·photos까지 배선)', async () => {
    const done = mkAnalysis({ id: 'f1', kind: 'flatness', stats: FLAT_STATS });
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [done]) as never);

    const el = await ScanPage(pageProps());
    const results = findAll(el, AnalysisResult);

    expect(results).toHaveLength(1);
    expect((results[0].props.analysis as AnalysisRow).id).toBe('f1');
    expect((results[0].props.scan as ScanRow).id).toBe('sc1');
    expect(Array.isArray(results[0].props.photos)).toBe(true);
    expect(findAll(el, SlopeResult)).toHaveLength(0);
  });

  it('최신 done의 stats가 비었으면(레거시) stats가 있는 이전 done으로 내려간다', async () => {
    const doneNoStats = mkAnalysis({
      id: 'f2', kind: 'flatness', stats: null, created_at: '2026-07-25T00:00:00Z',
    });
    const doneWithStats = mkAnalysis({
      id: 'f1', kind: 'flatness', stats: FLAT_STATS, created_at: '2026-07-20T00:00:00Z',
    });
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan(), [doneNoStats, doneWithStats]) as never);

    const el = await ScanPage(pageProps());
    const results = findAll(el, AnalysisResult);

    expect(results).toHaveLength(1);
    expect((results[0].props.analysis as AnalysisRow).id).toBe('f1');
  });

  it('구배 stats(format: slope-stats-v1)면 SlopeResult로 분기한다(이관된 가드)', async () => {
    const doneSlope = mkAnalysis({ id: 's1', kind: 'slope', stats: SLOPE_STATS });
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [doneSlope]) as never);

    const el = await ScanPage(pageProps());
    const results = findAll(el, SlopeResult);

    expect(results).toHaveLength(1);
    expect((results[0].props.analysis as AnalysisRow).id).toBe('s1');
    expect(findAll(el, AnalysisResult)).toHaveLength(0);
  });

  it('?analysis=로 과거 분석을 고르면 그 분석을 렌더한다', async () => {
    const newer = mkAnalysis({
      id: 'f2', kind: 'flatness', stats: FLAT_STATS, created_at: '2026-07-25T00:00:00Z',
    });
    const older = mkAnalysis({
      id: 'f1', kind: 'flatness', stats: FLAT_STATS, created_at: '2026-07-20T00:00:00Z',
    });
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [newer, older]) as never);

    const el = await ScanPage(pageProps({ analysis: 'f1' }));
    const results = findAll(el, AnalysisResult);

    expect(results).toHaveLength(1);
    expect((results[0].props.analysis as AnalysisRow).id).toBe('f1');
  });

  it('?analysis=가 미완료 분석을 가리키면 결과를 그리지 않는다(진행 상태만 - 최신 done으로 대체하지 않는다)', async () => {
    const done = mkAnalysis({
      id: 'f1', kind: 'flatness', stats: FLAT_STATS, created_at: '2026-07-20T00:00:00Z',
    });
    const queued = mkAnalysis({
      id: 'f2', kind: 'flatness', status: 'queued', stats: null, created_at: '2026-07-25T00:00:00Z',
    });
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [queued, done]) as never);

    const el = await ScanPage(pageProps({ analysis: 'f2' }));

    // 사용자가 고른 것은 f2(진행 중)다 - 최신 done(f1)을 대신 그려 주면 "이게 f2의
    // 결과"라는 오해를 만든다. 진행 상태는 섹션의 AnalysisProgress가 이미 보여준다.
    expect(findAll(el, AnalysisResult)).toHaveLength(0);
    expect(findAll(el, SlopeResult)).toHaveLength(0);
    expect(findAll(el, AnalysisProgress).map((p) => p.props.analysisId)).toContain('f2');
  });

  // 리뷰 Important(F1): 구 /analyses/[id] URL이 "이미 새 분석에 밀려난 과거
  // 실패/미완료 분석"을 가리키던 경우, 옛 페이지는 항상 "이 분석은 아직 완료되지
  // 않았습니다 (상태: …)" 안내를 보여줬다. D5 이관 때는 AnalysisProgress가 latest만
  // 반영하므로 이 과거 분석 선택에 대해서는 화면에 아무것도 뜨지 않는 회귀가 있었다.
  it('F1: ?analysis=로 최신이 아닌 과거 실패 분석을 고르면 안내 문구를 복원해 보여준다', async () => {
    const latestDone = mkAnalysis({
      id: 'f2', kind: 'flatness', status: 'done', stats: FLAT_STATS, created_at: '2026-07-25T00:00:00Z',
    });
    const oldFailed = mkAnalysis({
      id: 'f1', kind: 'flatness', status: 'failed', stats: null, created_at: '2026-07-20T00:00:00Z',
    });
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [latestDone, oldFailed]) as never);

    const el = await ScanPage(pageProps({ analysis: 'f1' }));
    const text = collectText(el).join('');

    expect(findAll(el, AnalysisResult)).toHaveLength(0);
    expect(findAll(el, SlopeResult)).toHaveLength(0);
    expect(text).toContain('이 분석은 아직 완료되지 않았습니다');
    expect(text).toContain('실패');
    // AnalysisProgress는 여전히 이 종류의 최신(f2, done)만 반영한다 - 과거 실패
    // 분석(f1)의 자리를 대신 차지하면 안 된다(latest 진행 상태와 혼동 방지).
    expect(findAll(el, AnalysisProgress).map((p) => p.props.analysisId)).toEqual(['f2']);
  });

  // 선택한 분석이 그 종류의 최신이면 AnalysisProgress가 이미 같은 정보를 실시간으로
  // 보여주므로, F1 안내 문구가 중복으로 뜨면 안 된다(위 미완료 분석 테스트와 대칭).
  it('F1 대조: ?analysis=가 그 종류의 최신(미완료)을 가리키면 안내 문구를 중복 렌더하지 않는다', async () => {
    const done = mkAnalysis({
      id: 'f1', kind: 'flatness', stats: FLAT_STATS, created_at: '2026-07-20T00:00:00Z',
    });
    const queued = mkAnalysis({
      id: 'f2', kind: 'flatness', status: 'queued', stats: null, created_at: '2026-07-25T00:00:00Z',
    });
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [queued, done]) as never);

    const el = await ScanPage(pageProps({ analysis: 'f2' }));
    const text = collectText(el).join('');

    expect(text).not.toContain('이 분석은 아직 완료되지 않았습니다');
  });

  it('완료 분석이 하나도 없으면 결과 인라인이 없다', async () => {
    const queued = mkAnalysis({ id: 'f1', kind: 'flatness', status: 'queued', stats: null });
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [queued]) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, AnalysisResult)).toHaveLength(0);
    expect(findAll(el, SlopeResult)).toHaveLength(0);
  });
});

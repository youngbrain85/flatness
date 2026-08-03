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

  it('이전 분석 목록이 종류별로 나뉜다(섞이지 않는다)', async () => {
    const flatness2 = mkAnalysis({ id: 'flatness2', kind: 'flatness', created_at: '2026-07-28T00:00:00Z' });
    const slope2 = mkAnalysis({ id: 'slope2', kind: 'slope', created_at: '2026-07-27T00:00:00Z' });
    const flatness1 = mkAnalysis({ id: 'flatness1', kind: 'flatness', created_at: '2026-07-10T00:00:00Z' });
    const slope1 = mkAnalysis({ id: 'slope1', kind: 'slope', created_at: '2026-07-09T00:00:00Z' });
    vi.mocked(createClient).mockResolvedValue(
      // 쿼리가 이미 created_at desc이므로 그 순서대로 넘긴다.
      stubSupabase(mkScan(), [flatness2, slope2, flatness1, slope1]) as never);

    const el = await ScanPage({ params: Promise.resolve({ id: 'sc1' }) });
    const links = findAll(el, Link).map((l) => l.props.href);

    // 이전 분석 목록(각 종류의 latest를 제외한 나머지)에만 등장해야 한다.
    expect(links).toContain('/analyses/flatness1');
    expect(links).toContain('/analyses/slope1');
    // latest(가장 최근 1건)는 "이전 분석" 목록이 아니라 AnalysisProgress로만 표시된다.
    expect(links).not.toContain('/analyses/flatness2');
    expect(links).not.toContain('/analyses/slope2');
  });
});

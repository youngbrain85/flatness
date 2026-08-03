// 코드리뷰(I1): isSlopeStats 분기가 사라지면(항상 AnalysisResult로 흘려보내면)
// 구배 stats를 받은 AnalysisResult가 stats.meta 옵셔널 체이닝 없이 접근해 TypeError로
// 페이지가 죽는다. 서버 컴포넌트 함수를 직접 호출해 반환된 엘리먼트 트리에 어떤
// 컴포넌트가 쓰였는지 확인한다.
//
// Next.js 공식 문서(node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md)는
// "Vitest는 async 서버 컴포넌트 렌더링을 지원하지 않는다"고 명시한다. 그래서 render()로
// DOM까지 그리지 않고, await로 얻은 이미 resolve된 React 엘리먼트 트리(그냥 일반
// JS 객체 그래프다)를 재귀 탐색해 SlopePlaceholder/AnalysisResult 중 어느 컴포넌트
// 타입이 쓰였는지만 확인한다 - AnalysisResult 분기는 클라이언트 훅(useEffect fetch)을
// 갖고 있어 DOM 렌더까지 하려면 fetch 스텁이 별도로 더 필요해진다(이미
// analysis-result.test.tsx가 그 렌더 자체는 별도로 덮고 있다 - 여기서는 "분기 배선"만
// 확인하면 충분하다).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import AnalysisPage from '../page';
import { AnalysisResult } from '@/components/analysis/analysis-result';
import { SlopePlaceholder } from '@/components/analysis/slope-placeholder';

function chain(result: { data: unknown; error: null }) {
  const obj: Record<string, unknown> = {
    select: () => obj, eq: () => obj, order: () => obj,
    maybeSingle: async () => result,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

// React 엘리먼트 트리(과 그 children)를 재귀 탐색해 특정 컴포넌트 타입이 쓰였는지 본다.
function containsType(node: unknown, type: unknown): boolean {
  if (node == null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => containsType(n, type));
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) return true;
  return containsType(el.props?.children, type);
}

const scan = {
  id: 'sc1', location_id: 'l1', surface: 'floor', scanned_at: '2026-07-20', device: null,
  operator_id: null, operator_name_manual: null, selected_criteria_id: null, raw_file_path: null,
  original_filename: null, file_format: null, point_count: null, unit_scale: null,
  lineage: 'raw', status: 'ready', deleted_at: null, created_at: '', updated_at: '',
};
const location = {
  id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
  memo: null, created_at: '', updated_at: '',
};

function stubSupabase(stats: unknown) {
  const analysis = {
    id: 'a1', scan_id: 'sc1', surface: 'floor', criteria_id: 'c1', applied_criteria: null,
    params: {}, engine_version: 'p1d-0.4.0', status: 'done', stats, coverage_pct: 90,
    overall_verdict: 'pass', warnings: [], artifacts_dir: 'artifacts/a1',
    auto_summary: null, user_summary: null, is_current: true, deleted_at: null,
    created_at: '', created_by: null, kind: 'flatness',
  };
  return {
    from: (table: string) => {
      if (table === 'analyses') return chain({ data: analysis, error: null });
      if (table === 'scans') return chain({ data: scan, error: null });
      if (table === 'locations') return chain({ data: location, error: null });
      if (table === 'photos') return chain({ data: [], error: null });
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

const slopeStats = {
  format: 'slope-stats-v1', cell_m: 2, subcell_m: 0.05,
  threshold: { use: '옥상', design_pct: 2, pass_pct: 0.5, re_pct: 1.5, dir_pass_deg: 30 },
  summary: {
    mean_dev_pct: 0.1, std_dev_pct: 0.02, max_dev_pct: 0.2,
    counts: { 적합: 1, 경계: 0, 보수: 0, 재시공: 0, 판정불가: 0 }, coverage_pct: 100,
  },
  direction_judged: true, drain_points: null, warnings: [],
  artifacts: { cells_csv: 'artifacts/a1/slope_cells.csv', map_png: 'artifacts/a1/slope_map.png' },
};

const flatnessStats = {
  n_cells: 1, n_valid: 1,
  grade_counts: { pass: 1, borderline: 0, repair: 0, rework: 0, na: 0 },
  grade_pct: { pass: 100, borderline: 0, repair: 0, rework: 0, na: 0 },
  value_max_mm: 1, value_min_mm: 1, value_mean_mm: 1, value_p95_mm: 1,
  worst: null, coverage_pct: 100, reduced_span_cells: 0,
  applied_criteria: { name: 'n', source: 's', span_m: 3, pass_mm: 7, rework_mm: 21, u_mm: 5 },
  warnings: [], zones: [], meta: { file: 'f', n_points: 1 }, auto_summary: '',
};

describe('AnalysisPage isSlopeStats 가드 배선 (단계 C 회귀 차단: I1)', () => {
  it('구배 stats(format: slope-stats-v1)면 SlopePlaceholder로 분기한다', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase(slopeStats) as never);

    const el = await AnalysisPage({ params: Promise.resolve({ id: 'a1' }) });

    expect(containsType(el, SlopePlaceholder)).toBe(true);
    expect(containsType(el, AnalysisResult)).toBe(false);
  });

  it('평활도 stats면 AnalysisResult로 분기한다(SlopePlaceholder 아님)', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase(flatnessStats) as never);

    const el = await AnalysisPage({ params: Promise.resolve({ id: 'a1' }) });

    expect(containsType(el, AnalysisResult)).toBe(true);
    expect(containsType(el, SlopePlaceholder)).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

import { VerdictPanel } from '../verdict-panel';
import type { AnalysisRow, Stats } from '@/lib/domain/types';

const stats: Stats = {
  n_cells: 40, n_valid: 36,
  grade_counts: { pass: 30, borderline: 4, repair: 2, rework: 0, na: 4 },
  grade_pct: { pass: 75, borderline: 10, repair: 5, rework: 0, na: 10 },
  value_max_mm: 12.34, value_min_mm: 0.5, value_mean_mm: 3.21, value_p95_mm: 9.87,
  worst: { value_mm: 12.34, cell_ix: 3, cell_iy: 4, point_x: 3.5, point_y: 4.5, zone_id: 1 },
  coverage_pct: 88.5, reduced_span_cells: 6,
  applied_criteria: { name: 'floor-kcs-exposed', source: 'KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)', span_m: 3, pass_mm: 7, rework_mm: 21, u_mm: 5 },
  warnings: ['low_coverage'],
  zones: [{ zone_id: 1, level_m: 0.001, area_m2: 35.2, status: 'ok', plane_abc: [0, 0, 0] }],
  meta: { file: 'raw.ply', n_points: 100000, surface: 'floor', engine_version: 'p1d-0.4.0' },
  auto_summary: '자동 종합의견 본문입니다. 본 결과는 스크리닝이며 공식 검측을 대체하지 않습니다.',
};

const analysis = {
  id: 'a1', scan_id: 'c1', surface: 'floor', criteria_id: 'cr1',
  applied_criteria: stats.applied_criteria, params: {}, engine_version: 'p1d-0.4.0',
  status: 'done', stats, coverage_pct: 88.5, overall_verdict: 'repair',
  warnings: ['low_coverage'], artifacts_dir: 'artifacts/a1',
  auto_summary: stats.auto_summary, user_summary: null, is_current: true,
  deleted_at: null, created_at: '2026-07-28T00:00:00Z', created_by: null,
} as AnalysisRow;

describe('VerdictPanel (C안 우측 고정 패널)', () => {
  it('종합 판정 배지·핵심 수치·기준·경고·종합의견을 렌더한다', () => {
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    expect(screen.getByText('보수')).toBeInTheDocument();          // 종합 판정
    expect(screen.getByText('12.34')).toBeInTheDocument();          // 최대 편차
    // coverage 라벨 분기 - low_coverage 경고 문구도 '바닥 인식률'을 포함하므로 정확 일치로 dt만 매칭
    expect(screen.getByText('바닥 인식률')).toBeInTheDocument();
    expect(screen.getByText(/88.5/)).toBeInTheDocument();
    expect(screen.getByText('floor-kcs-exposed')).toBeInTheDocument();
    expect(screen.getByText(/70% 미만/)).toBeInTheDocument();       // warning 한국어
    expect(screen.getByText(/축소 스팬 적용 셀 6/)).toBeInTheDocument();
    expect(screen.getByText(/스크리닝/)).toBeInTheDocument();       // auto_summary
    expect(screen.getByLabelText('종합의견(사용자 수정)')).toBeInTheDocument();
  });
  it('임포트 결과면 외부 결과 배지를 보여준다', () => {
    const imp = {
      ...analysis, engine_version: 'external-colab-v1',
      stats: { ...stats, meta: { ...stats.meta, source: 'colab-import' } },
    } as AnalysisRow;
    render(<VerdictPanel analysis={imp} stats={imp.stats!} />);
    expect(screen.getByText('외부 결과')).toBeInTheDocument();
  });
});

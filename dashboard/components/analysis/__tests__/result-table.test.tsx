import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultTable } from '../result-table';
import type { CellRow, Stats } from '@/lib/domain/types';

const base: Omit<Stats, 'zones' | 'walls' | 'meta'> = {
  n_cells: 3, n_valid: 3,
  grade_counts: { pass: 2, borderline: 0, repair: 1, rework: 0, na: 0 },
  grade_pct: { pass: 66.7, borderline: 0, repair: 33.3, rework: 0, na: 0 },
  value_max_mm: 10, value_min_mm: 1, value_mean_mm: 5, value_p95_mm: 9,
  worst: null, coverage_pct: 100, reduced_span_cells: 0,
  applied_criteria: { name: 'x', source: 'y', span_m: 3, pass_mm: 7, rework_mm: 21, u_mm: 5 },
  warnings: [], auto_summary: '',
};

const cell = (zone: number | null, v: number, grade: CellRow['grade']): CellRow => ({
  ix: 0, iy: 0, center_x: 0, center_y: 0, value_mm: v, span_used_m: 3,
  occupancy: 1, grade, worst_x: null, worst_y: null, zone_id: zone,
});

describe('ResultTable (하단 구간별 결과표 - 스펙 §5.1.7 필드와 동일 컬럼)', () => {
  it('floor: 구역별 행에 레벨·면적·상태·집계를 렌더한다', () => {
    const stats: Stats = {
      ...base,
      zones: [{ zone_id: 1, level_m: 0.002, area_m2: 12.5, status: 'ok', plane_abc: [0, 0, 0] }],
      meta: { file: 'f', n_points: 1, surface: 'floor' },
    };
    render(<ResultTable stats={stats} cells={[cell(1, 10, 'repair'), cell(1, 1, 'pass')]} />);
    expect(screen.getByText('구역 1')).toBeInTheDocument();
    expect(screen.getByText('정상')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();  // 면적
    expect(screen.getByText('10.00')).toBeInTheDocument(); // 최대
    expect(screen.getByText(/1 \(50%\)/)).toBeInTheDocument(); // 보수 이상 셀(비율)
  });
  it('wall: 벽별 행에 수직도·수직도 등급을 렌더한다', () => {
    const stats: Stats = {
      ...base, zones: [],
      walls: [{
        wall_id: 1, n_cells: 2, height_m: 2.4, length_m: 5.1, plumbness_mm: 8.5,
        plumb_grade: 'pass',
        plane_abc: [0, 0, 0],
        frame: { p0: [0, 0], direction: [1, 0], normal: [0, 1], u_min: 0, u_max: 5.1, z_min: 0, z_max: 2.4 },
      }],
      meta: { file: 'f', n_points: 1, surface: 'wall' },
    };
    render(<ResultTable stats={stats} cells={[cell(1, 3, 'pass'), cell(1, 5, 'pass')]} />);
    expect(screen.getByText('벽 1')).toBeInTheDocument();
    expect(screen.getByText('8.50')).toBeInTheDocument(); // 수직도 mm
    expect(screen.getAllByText('적합').length).toBeGreaterThan(0); // plumb_grade
  });
});

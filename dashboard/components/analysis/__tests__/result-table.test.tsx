import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultTable } from '../result-table';
import { tableClass } from '@/components/ui/data-table';
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

const floorStats: Stats = {
  ...base,
  zones: [{ zone_id: 1, level_m: 0.002, area_m2: 12.5, status: 'ok', plane_abc: [0, 0, 0] }],
  meta: { file: 'f', n_points: 1, surface: 'floor' },
};

const wallStats: Stats = {
  ...base, zones: [],
  walls: [{
    wall_id: 1, n_cells: 2, height_m: 2.4, length_m: 5.1, plumbness_mm: 8.5,
    plumb_grade: 'pass',
    plane_abc: [0, 0, 0],
    frame: { p0: [0, 0], direction: [1, 0], normal: [0, 1], u_min: 0, u_max: 5.1, z_min: 0, z_max: 2.4 },
  }],
  meta: { file: 'f', n_points: 1, surface: 'wall' },
};

describe('ResultTable (하단 구간별 결과표 - 스펙 §5.1.7 필드와 동일 컬럼)', () => {
  it('floor: 구역별 행에 레벨·면적·상태·집계를 렌더한다', () => {
    render(<ResultTable stats={floorStats} cells={[cell(1, 10, 'repair'), cell(1, 1, 'pass')]} />);
    expect(screen.getByText('구역 1')).toBeInTheDocument();
    expect(screen.getByText('정상')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();  // 면적
    expect(screen.getByText('10.00')).toBeInTheDocument(); // 최대
    expect(screen.getByText(/1 \(50%\)/)).toBeInTheDocument(); // 보수 이상 셀(비율)
  });
  it('wall: 벽별 행에 크기·수직도·수직도 판정(엔진 plumb_grade, 등급 색 점 + 이름)', () => {
    render(<ResultTable stats={wallStats} cells={[cell(1, 3, 'pass'), cell(1, 5, 'pass')]} />);
    expect(screen.getByText('벽 1')).toBeInTheDocument();
    expect(screen.getByText('5.1 x 2.4')).toBeInTheDocument();
    expect(screen.getByText('8.50')).toBeInTheDocument(); // 수직도 mm
    expect(screen.getByText('적합').querySelector('[data-grade]')).toHaveAttribute('data-grade', 'pass');
  });
});

// ---- 변이 실험이 드러낸 빈틈 ----
describe('ResultTable 보강', () => {
  it('벽 수직도 판정은 엔진 plumb_grade 를 따른다: 보수면 보수 색 점 + 이름 (적합으로 고정하지 않는다)', () => {
    const stats: Stats = { ...wallStats, walls: [{ ...wallStats.walls![0], plumb_grade: 'repair' }] };
    render(<ResultTable stats={stats} cells={[cell(1, 3, 'pass')]} />);
    expect(screen.queryByText('적합')).toBeNull();
    expect(screen.getByText('보수').querySelector('[data-grade]')).toHaveAttribute('data-grade', 'repair');
  });

  it('구역이 없는 셀(zone_id null)의 행 이름은 "전체"다', () => {
    render(<ResultTable stats={floorStats} cells={[cell(null, 2, 'pass')]} />);
    expect(screen.getByText('전체')).toBeInTheDocument();
  });

  it('구역 상태는 엔진 status 의 한글 이름이다(정상 고정이 아니다)', () => {
    const stats: Stats = {
      ...floorStats,
      zones: [{ zone_id: 1, level_m: 0.002, area_m2: 12.5, status: 'ghost', plane_abc: [0, 0, 0] }],
    };
    render(<ResultTable stats={stats} cells={[cell(1, 4, 'pass')]} />);
    expect(screen.getByText('유령층(제외)')).toBeInTheDocument();
    expect(screen.queryByText('정상')).toBeNull();
  });
});

// 다크 T8: TableBox(표 상자 안에서만 가로 스크롤) + tableClass + scope=col
describe('ResultTable C안 해부 (아트보드 ScanDone 160~192행)', () => {
  it('TableBox 안의 표: 열 머리 scope=col, 수치 열은 thNum/tdNum, 첫 열은 600', () => {
    const { container } = render(<ResultTable stats={floorStats} cells={[cell(1, 10, 'repair')]} />);
    expect(container.querySelector('table')!.parentElement!.className).toContain('overflow-x-auto');
    for (const th of screen.getAllByRole('columnheader')) expect(th).toHaveAttribute('scope', 'col');
    expect(screen.getByRole('columnheader', { name: '최대(mm)' }).className).toBe(tableClass.thNum);
    expect(screen.getByRole('columnheader', { name: '상태' }).className).toBe(tableClass.th);
    // 셀이 하나뿐인 픽스처라 최대·최소·평균이 모두 10.00이다 - 첫 수치 td(최대)로 해부를 본다
    expect(screen.getAllByText('10.00')[0].className).toBe(tableClass.tdNum);
    expect(screen.getByText('구역 1').className).toBe(`${tableClass.td} font-semibold`);
    expect(container.innerHTML).not.toMatch(/\bcs-/);
  });
});

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlopePlaceholder } from '../slope-placeholder';
import type { SlopeStats } from '@/lib/domain/types';

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

describe('SlopePlaceholder (단계 C 임시 안내 화면)', () => {
  it('종류 배지·판정 요약·편차 통계·경고·판정 지도를 렌더한다', () => {
    render(<SlopePlaceholder stats={stats} />);
    expect(screen.getByText('구배')).toBeInTheDocument();
    expect(screen.getByText('적합 10 · 경계 2 · 보수 1 · 재시공 0 · 판정불가 3')).toBeInTheDocument();
    expect(screen.getByText(/81.2%/)).toBeInTheDocument();
    expect(screen.getByText('0.12%')).toBeInTheDocument();
    expect(screen.getByText('0.05%')).toBeInTheDocument();
    expect(screen.getByText('0.30%')).toBeInTheDocument();
    expect(screen.getByText(/방향\(역구배\)을 판정하지 않았습니다/)).toBeInTheDocument();
    const img = screen.getByAltText('구배 판정 지도') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/data/artifacts/a1/slope_map.png');
    expect(screen.getByText(/준비 중입니다/)).toBeInTheDocument();
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
    render(<SlopePlaceholder stats={allNa} />);
    expect(screen.getAllByText('판정 가능한 셀 없음')).toHaveLength(3);
  });

  it('경고가 없으면 경고 섹션을 렌더하지 않는다', () => {
    render(<SlopePlaceholder stats={{ ...stats, warnings: [] }} />);
    expect(screen.queryByText('경고')).not.toBeInTheDocument();
  });

  // M1/M2 (코드리뷰): stats는 jsonb 컬럼에서 온다 - 타입이 무결성을 보장하지 않는다.
  // artifacts·warnings·summary.counts 키가 통째로 없는 레코드에서 TypeError로 죽지
  // 않고, 각 파트가 빠진 채로 나머지가 정상 렌더되는지 확인한다.
  it('artifacts 키 자체가 없어도 TypeError 없이 렌더한다(판정 지도만 생략)', () => {
    const { artifacts, ...withoutArtifacts } = stats;
    void artifacts;
    render(<SlopePlaceholder stats={withoutArtifacts as SlopeStats} />);
    expect(screen.getByText('구배')).toBeInTheDocument();
    expect(screen.queryByAltText('구배 판정 지도')).not.toBeInTheDocument();
  });

  it('warnings 키 자체가 없어도 TypeError 없이 렌더한다(경고 섹션만 생략)', () => {
    const { warnings, ...withoutWarnings } = stats;
    void warnings;
    render(<SlopePlaceholder stats={withoutWarnings as SlopeStats} />);
    expect(screen.getByText('구배')).toBeInTheDocument();
    expect(screen.queryByText('경고')).not.toBeInTheDocument();
  });

  it('summary.counts 키 자체가 없어도 TypeError 없이 렌더하고 0으로 채운다', () => {
    const withoutCounts = {
      ...stats,
      summary: { mean_dev_pct: 0.1, std_dev_pct: 0.1, max_dev_pct: 0.1, coverage_pct: 50 },
    };
    render(<SlopePlaceholder stats={withoutCounts as unknown as SlopeStats} />);
    expect(screen.getByText('적합 0 · 경계 0 · 보수 0 · 재시공 0 · 판정불가 0')).toBeInTheDocument();
  });

  it('편차 값이 undefined(키 누락)여도 null과 동일하게 안내 문구로 처리한다', () => {
    const { mean_dev_pct, ...restSummary } = stats.summary;
    void mean_dev_pct;
    render(<SlopePlaceholder stats={{ ...stats, summary: restSummary as SlopeStats['summary'] }} />);
    expect(screen.getAllByText('판정 가능한 셀 없음').length).toBeGreaterThanOrEqual(1);
  });
});

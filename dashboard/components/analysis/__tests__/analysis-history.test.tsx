import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AnalysisHistoryList } from '../analysis-history';
import type { AnalysisRow } from '@/lib/domain/types';

function row(over: Partial<AnalysisRow>): AnalysisRow {
  return {
    id: 'x', scan_id: 'sc1', surface: 'floor', criteria_id: 'c1', applied_criteria: null, params: {},
    engine_version: 'p4-0.5.0', status: 'done', stats: null, coverage_pct: null, overall_verdict: null,
    warnings: [], artifacts_dir: null, auto_summary: null, user_summary: null, is_current: false,
    deleted_at: null, created_at: '2026-07-20T09:00:00Z', created_by: null, kind: 'flatness', ...over,
  };
}

describe('AnalysisHistoryList (이전 분석 목록, 아트보드 ScanDone 201~203행)', () => {
  it('항목마다 같은 작업대의 ?analysis= 링크, 일시 · 엔진, 판정 태그(엔진 overall_verdict)', () => {
    render(<AnalysisHistoryList scanId="sc1" analyses={[
      row({ id: 'f1', created_at: '2026-07-30T22:33:10Z', engine_version: 'p1d-0.4.0', overall_verdict: 'repair' }),
      row({ id: 'f0', created_at: '2026-07-20T09:00:00Z', engine_version: null, overall_verdict: null }),
    ]} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/scans/sc1?analysis=f1', '/scans/sc1?analysis=f0']);
    expect(within(links[0]).getByText('이전 분석')).toBeInTheDocument();
    expect(within(links[0]).getByText('2026-07-30 22:33 · 엔진 p1d-0.4.0')).toBeInTheDocument();
    expect(within(links[0]).getByText('보수').closest('[data-grade]')).toHaveAttribute('data-grade', 'repair');
    expect(within(links[1]).getByText('2026-07-20 09:00 · 엔진 -')).toBeInTheDocument();
    expect(links[1].querySelector('[data-grade]')).toBeNull();
    expect(links[0].className.split(/\s+/)).toContain('min-h-11');   // 터치 대상 44px
  });

  it('목록이 비면 아무것도 그리지 않는다', () => {
    const { container } = render(<AnalysisHistoryList scanId="sc1" analyses={[]} />);
    expect(container.innerHTML).toBe('');
  });
});

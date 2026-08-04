import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlopeResultTable } from '../slope-result-table';
import type { SlopeCellResult } from '@/lib/domain/slope-judged';
import type { SlopeCellRow } from '@/lib/domain/types';

function cell(over: Partial<SlopeCellRow> = {}): SlopeCellRow {
  return {
    cx: 0, cy: 0, center_x: 0.975, center_y: 0.975, n_subcells: 1600,
    slope_pct: 1.5, downhill_rad: 0, rmse_m: 0.0001, se_pct: 0.0006,
    width_m: 2.0, height_m: 2.0, ok: true, zone_id: null, ...over,
  };
}

function result(over: Partial<SlopeCellResult> = {}): SlopeCellResult {
  return {
    cell: cell(), grade: '적합', reason: '크기·방향 모두 허용 안',
    dev_pct: 0.5, dir_err_deg: 5, correction_mm: 10.0, reverse: false, ...over,
  };
}

describe('SlopeResultTable (스펙 §7.2·§5.3: 구배 %, 설계 대비 편차, 보정 높이차, 등급, 역구배)', () => {
  it('셀별 구배·편차·보정 방향·등급을 렌더한다', () => {
    render(<SlopeResultTable results={[result()]} designPct={2.0} />);
    expect(screen.getByText('(0, 0)')).toBeInTheDocument();
    expect(screen.getByText('1.50%')).toBeInTheDocument(); // 구배
    expect(screen.getByText('0.50%')).toBeInTheDocument(); // 편차
    expect(screen.getByText('동쪽 끝을 10.0mm 낮춤')).toBeInTheDocument(); // 보정(1.5<2.0 -> 낮춤)
    expect(screen.getByText('적합')).toBeInTheDocument();
  });

  // ★ 브리프 리트머스: 색만으로 안 드러나므로 역구배는 별도 배지로 표시해야 한다.
  it('reverse=true인 셀에 "역구배" 배지를 보여준다', () => {
    const rows = [result({ grade: '재시공', reason: '역구배(물이 배수구 반대로 흐름)', reverse: true })];
    render(<SlopeResultTable results={rows} designPct={2.0} />);
    expect(screen.getByText('역구배')).toBeInTheDocument();
  });

  it('reverse=false인 셀은 "역구배" 배지가 없다', () => {
    render(<SlopeResultTable results={[result({ reverse: false })]} designPct={2.0} />);
    expect(screen.queryByText('역구배')).not.toBeInTheDocument();
  });

  it('측정 불가(ok=false) 셀은 구배·보정에 "-"를 보여준다', () => {
    const rows = [result({
      cell: cell({ ok: false, slope_pct: null, downhill_rad: null }),
      grade: '판정불가', reason: '유효 서브셀 부족', dev_pct: null, dir_err_deg: null, correction_mm: null,
    })];
    render(<SlopeResultTable results={rows} designPct={2.0} />);
    const dashes = screen.getAllByText('-');
    expect(dashes.length).toBeGreaterThanOrEqual(3); // 구배·편차·보정
    expect(screen.getByText('판정불가')).toBeInTheDocument();
    expect(screen.getByText('유효 서브셀 부족')).toBeInTheDocument();
  });

  it('행은 (cy, cx) 오름차순으로 정렬된다', () => {
    const rows = [
      result({ cell: cell({ cx: 1, cy: 0 }) }),
      result({ cell: cell({ cx: 0, cy: 0 }) }),
      result({ cell: cell({ cx: 0, cy: 1 }) }),
    ];
    render(<SlopeResultTable results={rows} designPct={2.0} />);
    const cellsText = screen.getAllByText(/^\(\d, \d\)$/).map((el) => el.textContent);
    expect(cellsText).toEqual(['(0, 0)', '(1, 0)', '(0, 1)']);
  });
});

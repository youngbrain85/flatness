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
    render(<SlopeResultTable results={[result()]} designPct={2.0} dirPassDeg={30} />);
    expect(screen.getByText('(0, 0)')).toBeInTheDocument();
    expect(screen.getByText('1.50%')).toBeInTheDocument(); // 구배
    expect(screen.getByText('0.50%')).toBeInTheDocument(); // 편차
    expect(screen.getByText('동쪽 끝을 10.0mm 낮춤')).toBeInTheDocument(); // 보정(1.5<2.0 -> 낮춤)
    expect(screen.getByText('적합')).toBeInTheDocument();
  });

  // ★ 브리프 리트머스: 색만으로 안 드러나므로 역구배는 별도 배지로 표시해야 한다.
  it('reverse=true인 셀에 "역구배" 배지를 보여준다', () => {
    const rows = [result({ grade: '재시공', reason: '역구배(물이 배수구 반대로 흐름)', reverse: true })];
    render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
    expect(screen.getByText('역구배')).toBeInTheDocument();
  });

  it('reverse=false인 셀은 "역구배" 배지가 없다', () => {
    render(<SlopeResultTable results={[result({ reverse: false })]} designPct={2.0} dirPassDeg={30} />);
    expect(screen.queryByText('역구배')).not.toBeInTheDocument();
  });

  // ★ 코드리뷰 Important-1: 역구배 셀은 크기 기준 보정 문구("0.0mm 높임" 등)를
  // 내면 안 된다 - 크기가 설계와 거의 같아 correction_mm이 0에 가까우면
  // "고칠 것 없음"으로 오독된다(스펙 §7.2가 경계한 실패가 보정란에서 재현).
  it('reverse=true면 correction_mm이 0에 가까워도 방향 재시공 문구를 낸다(크기 문구 아님)', () => {
    const rows = [result({
      grade: '재시공', reason: '역구배(물이 배수구 반대로 흐름)', reverse: true, correction_mm: 0.0,
    })];
    render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
    expect(screen.queryByText(/0\.0mm/)).not.toBeInTheDocument();
    expect(screen.getByText(/방향 전면 재시공 필요/)).toBeInTheDocument();
  });

  // ★ 코드리뷰 M1: jsonb 무결성 미보장 - grade가 SLOPE_GRADE_COLOR에 없는
  // 문자열이어도 배지가 안 보이는 조용한 오표시 대신 판정불가 회색으로 강제한다.
  it('SLOPE_GRADE_COLOR에 없는 미지 등급 문자열도 판정불가 색으로 폴백해 배지를 보여준다', () => {
    const rows = [result({ grade: '알수없음' as unknown as SlopeCellResult['grade'] })];
    render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
    const badge = screen.getByText('알수없음');
    expect(badge).toHaveStyle({ backgroundColor: 'rgb(158, 158, 158)' }); // #9e9e9e = 판정불가
  });

  it('측정 불가(ok=false) 셀은 구배·보정에 "-"를 보여준다', () => {
    const rows = [result({
      cell: cell({ ok: false, slope_pct: null, downhill_rad: null }),
      grade: '판정불가', reason: '유효 서브셀 부족', dev_pct: null, dir_err_deg: null, correction_mm: null,
    })];
    render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
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
    render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
    const cellsText = screen.getAllByText(/^\(\d, \d\)$/).map((el) => el.textContent);
    expect(cellsText).toEqual(['(0, 0)', '(1, 0)', '(0, 1)']);
  });

  // ★ 코드리뷰(2차) Minor: designPct가 null(threshold 결측)이면 보정 문구를
  // 추측해서 내지 않는다('-').
  it('designPct가 null이면 보정란에 "-"를 보여준다(방향 추측 안 함)', () => {
    render(<SlopeResultTable results={[result()]} designPct={null} dirPassDeg={30} />);
    expect(screen.queryByText(/낮춤|높임/)).not.toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(1);
  });

  // ★ 코드리뷰(2차) I2: dir_err_deg가 dir_pass_deg를 넘는(90도는 안 넘는) 셀은
  // 방향 편차를 별도로 명시해야 한다 - 안 그러면 방향 결함이 보정란(크기 기준)에
  // "0.0mm"에 가깝게 나와 안 드러난다.
  describe('방향 편차 표시 (I2 - I1과 함께 활성화됨)', () => {
    it('dir_err_deg가 dir_pass_deg를 넘으면 방향 편차를 명시한다', () => {
      const rows = [result({ dir_err_deg: 45.3, reverse: false })];
      render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
      expect(screen.getByText('45.3도(허용 30도 초과)')).toBeInTheDocument();
    });

    it('dir_err_deg가 dir_pass_deg 이하면 방향 편차를 표시하지 않는다', () => {
      const rows = [result({ dir_err_deg: 20, reverse: false })];
      render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
      expect(screen.queryByText(/허용 30도 초과/)).not.toBeInTheDocument();
    });

    it('reverse=true(역구배, 90도 초과)면 방향 편차 배지를 중복 표시하지 않는다(역구배 배지로 충분)', () => {
      const rows = [result({
        dir_err_deg: 150, reverse: true, grade: '재시공', reason: '역구배(물이 배수구 반대로 흐름)',
      })];
      render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
      expect(screen.queryByText(/허용 30도 초과/)).not.toBeInTheDocument();
      expect(screen.getByText('역구배')).toBeInTheDocument();
    });

    it('dir_err_deg가 null(방향 미판정 등)이면 방향 편차를 표시하지 않는다', () => {
      const rows = [result({ dir_err_deg: null, reverse: false })];
      render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
      expect(screen.queryByText(/초과/)).not.toBeInTheDocument();
    });
  });
});

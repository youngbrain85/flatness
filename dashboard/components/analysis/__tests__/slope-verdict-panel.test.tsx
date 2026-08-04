import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlopeVerdictPanel } from '../slope-verdict-panel';
import type { JudgeInfo, SlopeStats } from '@/lib/domain/types';

const stats: SlopeStats = {
  format: 'slope-stats-v1', cell_m: 2.0, subcell_m: 0.05,
  threshold: { use: '옥상', design_pct: 2, pass_pct: 0.5, re_pct: 1.5, dir_pass_deg: 30 },
  summary: {
    mean_dev_pct: 0.12, std_dev_pct: 0.05, max_dev_pct: 0.3,
    counts: { 적합: 10, 경계: 2, 보수: 1, 재시공: 0, 판정불가: 3 },
    coverage_pct: 81.2,
  },
  direction_judged: true, drain_points: [[1.2, 3.4]],
  warnings: [],
  artifacts: {
    cells_json: 'artifacts/a1/slope_cells.json', judged_json: 'artifacts/a1/slope_judged.json',
    cells_csv: 'artifacts/a1/slope_cells.csv', map_png: 'artifacts/a1/slope_map.png',
  },
};

describe('SlopeVerdictPanel 재판정 진행 배너 (브리프 D5 상태표)', () => {
  it('judge=null이면 배너를 렌더하지 않는다', () => {
    render(<SlopeVerdictPanel stats={stats} judge={null} drainPoints={[]} />);
    expect(screen.queryByText(/재판정/)).not.toBeInTheDocument();
  });

  it('processing이면 진행 중 배너를 보여준다', () => {
    const judge: JudgeInfo = { state: 'processing', at: 't0' };
    render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[]} />);
    expect(screen.getByText(/재판정 진행 중/)).toBeInTheDocument();
  });

  it('queued면 대기 중 배너를 보여준다', () => {
    const judge: JudgeInfo = { state: 'queued', at: 't0' };
    render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[]} />);
    expect(screen.getByText(/재판정 대기 중/)).toBeInTheDocument();
  });

  // ★ 브리프 변이 5: state='queued'일 때도 error가 남아 있을 수 있으나(009의 재큐
  // 관례) 최종 실패가 아니므로 노출하면 안 된다(대시보드 계약).
  it('queued이고 error가 남아 있어도 화면에 노출하지 않는다', () => {
    const judge: JudgeInfo = { state: 'queued', at: 't0', error: '이전 시도 실패 사유' };
    const { container } = render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[]} />);
    // queryByText 정확 일치는 "사유: 이전 시도 실패 사유"처럼 다른 문자열과 한
    // 요소 안에 섞이면 놓친다 - 컨테이너 전체 텍스트로 부분 문자열 포함 여부를 본다.
    expect(container.textContent).not.toContain('이전 시도 실패 사유');
  });

  it('failed면 error를 노출한다(대시보드 계약: state===failed일 때만)', () => {
    const judge: JudgeInfo = { state: 'failed', at: 't0', error: '셀 데이터 파일을 찾을 수 없습니다' };
    render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[]} />);
    expect(screen.getByText(/재판정에 실패했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/셀 데이터 파일을 찾을 수 없습니다/)).toBeInTheDocument();
  });

  it('done이면 배너를 렌더하지 않는다', () => {
    const judge: JudgeInfo = { state: 'done', at: 't0' };
    render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[]} />);
    expect(screen.queryByText(/재판정/)).not.toBeInTheDocument();
  });

  it('direction_judged=false면 배수구 지정 안내를 보여준다', () => {
    render(<SlopeVerdictPanel stats={{ ...stats, direction_judged: false }} judge={null} drainPoints={[]} />);
    expect(screen.getByText(/방향\(역구배\)은 판정하지 않았습니다/)).toBeInTheDocument();
  });

  it('현재 배수구·직전 배수구를 보여준다', () => {
    const judge: JudgeInfo = {
      state: 'done', at: 't0', previous_drain_points: [{ x: 1, y: 2 }],
    };
    render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[{ x: 3.2, y: 5.1 }]} />);
    expect(screen.getByText('(3.2, 5.1)')).toBeInTheDocument();
    expect(screen.getByText(/직전 배수구: \(1, 2\)/)).toBeInTheDocument();
  });

  it('구역별 통계는 후속 단계임을 명시한다(브리프 D2)', () => {
    render(<SlopeVerdictPanel stats={stats} judge={null} drainPoints={[]} />);
    expect(screen.getByText(/구역별 통계는 후속 단계/)).toBeInTheDocument();
  });
});

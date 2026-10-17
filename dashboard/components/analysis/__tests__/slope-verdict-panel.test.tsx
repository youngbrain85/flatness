import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlopeVerdictPanel } from '../slope-verdict-panel';
import { EYEBROW } from '../result-parts';
import { GRADE_CLASS } from '@/components/ui/grade';
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

/** KPI 카드의 글자(라벨 + 값 + 단위, 공백 제거). KpiCard 의 라벨 <p> 는 카드 루트의 직계 자식이다(Task 1 계약) */
const kpi = (label: string) => (screen.getByText(label).parentElement!.textContent ?? '').replace(/\s+/g, '');

describe('SlopeVerdictPanel 재판정 진행 배너 (브리프 D5 상태표)', () => {
  it('judge=null이면 배너를 렌더하지 않는다', () => {
    render(<SlopeVerdictPanel stats={stats} judge={null} drainPoints={[]} directionAware />);
    expect(screen.queryByText(/재판정/)).not.toBeInTheDocument();
  });

  it('processing이면 진행 중 배너를 보여준다', () => {
    const judge: JudgeInfo = { state: 'processing', at: 't0' };
    render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[]} directionAware />);
    expect(screen.getByText(/재판정 진행 중/)).toBeInTheDocument();
  });

  it('queued면 대기 중 배너를 보여준다', () => {
    const judge: JudgeInfo = { state: 'queued', at: 't0' };
    render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[]} directionAware />);
    expect(screen.getByText(/재판정 대기 중/)).toBeInTheDocument();
  });

  // ★ 브리프 변이 5: state='queued'일 때도 error가 남아 있을 수 있으나(009의 재큐
  // 관례) 최종 실패가 아니므로 노출하면 안 된다(대시보드 계약).
  it('queued이고 error가 남아 있어도 화면에 노출하지 않는다', () => {
    const judge: JudgeInfo = { state: 'queued', at: 't0', error: '이전 시도 실패 사유' };
    const { container } = render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[]} directionAware />);
    // queryByText 정확 일치는 "사유: 이전 시도 실패 사유"처럼 다른 문자열과 한
    // 요소 안에 섞이면 놓친다 - 컨테이너 전체 텍스트로 부분 문자열 포함 여부를 본다.
    expect(container.textContent).not.toContain('이전 시도 실패 사유');
  });

  it('failed면 error를 노출한다(대시보드 계약: state===failed일 때만)', () => {
    const judge: JudgeInfo = { state: 'failed', at: 't0', error: '셀 데이터 파일을 찾을 수 없습니다' };
    render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[]} directionAware />);
    expect(screen.getByText(/재판정에 실패했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/셀 데이터 파일을 찾을 수 없습니다/)).toBeInTheDocument();
  });

  it('done이면 배너를 렌더하지 않는다', () => {
    const judge: JudgeInfo = { state: 'done', at: 't0' };
    render(<SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[]} directionAware />);
    expect(screen.queryByText(/재판정/)).not.toBeInTheDocument();
  });

  it('direction_judged=false·directionAware=true면 배수구 클릭 안내를 보여준다', () => {
    render(
      <SlopeVerdictPanel stats={{ ...stats, direction_judged: false }} judge={null} drainPoints={[]}
        directionAware />,
    );
    expect(screen.getByText(/방향\(역구배\)은 판정하지 않았습니다/)).toBeInTheDocument();
    expect(screen.getByText(/지도에서 배수구 위치를 클릭하세요/)).toBeInTheDocument();
  });

  // ★ 코드리뷰(2차) I1: 방향 판정 대상이 아닌 기준에서는 클릭이 비활성화되므로
  // "지도에서 배수구 위치를 클릭하세요"라는 모순된 안내를 하면 안 된다.
  it('direction_judged=false·directionAware=false면 클릭을 권하지 않는다', () => {
    render(
      <SlopeVerdictPanel stats={{ ...stats, direction_judged: false }} judge={null} drainPoints={[]}
        directionAware={false} />,
    );
    expect(screen.getByText(/방향\(역구배\)을 판정 대상으로 삼지 않습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/지도에서 배수구 위치를 클릭하세요/)).not.toBeInTheDocument();
  });

  // ★ 코드리뷰(4차) N3: "오염된" 분석 - 방향 비대상 기준인데 과거에(이 기능
  // 배포 전) 배수구를 클릭해 direction_judged=true로 역구배·재시공이 노이즈로
  // 찍혀 있는 상태. 예전 조건(!direction_judged)이었다면 이 경우 경고가 전혀
  // 안 떴다 - directionAware 기준으로 바뀌었으니 여기서도 떠야 한다.
  it('direction_judged=true인데 directionAware=false면(오염된 분석) 노이즈 경고까지 보여준다', () => {
    render(
      <SlopeVerdictPanel stats={{ ...stats, direction_judged: true }} judge={null} drainPoints={[]}
        directionAware={false} />,
    );
    expect(screen.getByText(/방향\(역구배\)을 판정 대상으로 삼지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/역구배·재시공 표시가 노이즈일 수 있습니다/)).toBeInTheDocument();
  });

  it('direction_judged=false·directionAware=false면(정상 - 아직 클릭 안 함) 노이즈 경고는 없다', () => {
    render(
      <SlopeVerdictPanel stats={{ ...stats, direction_judged: false }} judge={null} drainPoints={[]}
        directionAware={false} />,
    );
    expect(screen.getByText(/방향\(역구배\)을 판정 대상으로 삼지 않습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/노이즈일 수 있습니다/)).not.toBeInTheDocument();
  });

  it('현재 배수구·직전 배수구를 보여준다', () => {
    const judge: JudgeInfo = {
      state: 'done', at: 't0', previous_drain_points: [{ x: 1, y: 2 }],
    };
    render(
      <SlopeVerdictPanel stats={stats} judge={judge} drainPoints={[{ x: 3.2, y: 5.1 }]} directionAware />,
    );
    expect(screen.getByText('(3.2, 5.1)')).toBeInTheDocument();
    expect(screen.getByText(/직전 배수구: \(1, 2\)/)).toBeInTheDocument();
  });

  // ★ 코드리뷰(2차) Minor: "현재 지정된" 배수구(낙관적, 거부됐을 수도 있음)와
  // "이 판정이 실제로 쓴" 배수구(stats.drain_points)는 다른 값일 수 있다 -
  // 둘 다 화면에 보여야 재판정 실패 시 혼란이 없다.
  it('이 판정에 사용된 배수구(stats.drain_points)를 별도로 보여준다', () => {
    render(
      <SlopeVerdictPanel stats={{ ...stats, drain_points: [[9, 9]] }} judge={null}
        drainPoints={[{ x: 1, y: 1 }]} directionAware />,
    );
    expect(screen.getByText('(1, 1)')).toBeInTheDocument(); // 현재 지정(낙관적)
    expect(screen.getByText(/이 판정에 사용됨: \(9, 9\)/)).toBeInTheDocument(); // 실제 판정에 쓰인 값
  });

  it('구역별 통계는 후속 단계임을 명시한다(브리프 D2)', () => {
    render(<SlopeVerdictPanel stats={stats} judge={null} drainPoints={[]} directionAware />);
    expect(screen.getByText(/구역별 통계는 후속 단계/)).toBeInTheDocument();
  });
});

// 다크 T8(아트보드 ScanSlope 78~126행): KPI 4장 -> [판정 요약·적용 기준 | 재판정·현재 배수구·경고] 카드 줄
describe('SlopeVerdictPanel C안 해부', () => {
  it('KPI 4장: 판정 가능 비율·평균 편차·편차 표준편차·최대 편차(% 단위)', () => {
    render(<SlopeVerdictPanel stats={stats} judge={null} drainPoints={[]} directionAware />);
    expect(kpi('판정 가능 비율')).toContain('81.2%');
    expect(kpi('평균 편차')).toContain('0.12%');
    expect(kpi('편차 표준편차')).toContain('0.05%');
    expect(kpi('최대 편차')).toContain('0.30%');
  });

  it('편차 통계가 없으면(전 셀 판정불가) KPI 값 자리에 "판정 가능한 셀 없음"', () => {
    const none = { ...stats, summary: { ...stats.summary, mean_dev_pct: null, std_dev_pct: null, max_dev_pct: null } };
    render(<SlopeVerdictPanel stats={none} judge={null} drainPoints={[]} directionAware />);
    expect(screen.getAllByText('판정 가능한 셀 없음')).toHaveLength(3);
  });

  it('판정 요약: role=img 막대 안 5등급(개수 비율 폭, GRADE_CLASS 바탕)과 개수 문장, 적용 기준 한 줄', () => {
    render(<SlopeVerdictPanel stats={stats} judge={null} drainPoints={[]} directionAware />);
    expect(screen.getByText('판정 요약').className).toBe(EYEBROW);
    const bar = screen.getByRole('img', { name: '적합 10, 경계 2, 보수 1, 재시공 0, 판정불가 3' });
    const segs = bar.querySelectorAll('[data-grade]');
    expect(Array.from(segs).map((s) => s.getAttribute('data-grade'))).toEqual(['pass', 'borderline', 'repair', 'rework', 'na']);
    expect(segs[0].className).toContain(GRADE_CLASS.pass.bg);
    expect((segs[0] as HTMLElement).style.width).toBe('62.5%');   // 10/16
    expect(screen.getByText('적합 10 · 경계 2 · 보수 1 · 재시공 0 · 판정불가 3')).toBeInTheDocument();
    expect(screen.getByText('옥상 · 설계 구배 2% · 허용 0.5% · 재시공 1.5% · 방향 허용 30도')).toBeInTheDocument();
  });

  it('진행 배너는 StatusIndicator in-progress, 실패 배너는 error Alert다', () => {
    const { rerender } = render(
      <SlopeVerdictPanel stats={stats} judge={{ state: 'processing', at: 't0' }} drainPoints={[]} directionAware />,
    );
    expect(screen.getByText(/재판정 진행 중/)).toHaveAttribute('data-status', 'in-progress');
    rerender(
      <SlopeVerdictPanel stats={stats} judge={{ state: 'failed', at: 't0', error: '사유X' }} drainPoints={[]} directionAware />,
    );
    expect(screen.getByText(/재판정에 실패했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.getByText(/사유: 사유X/)).toBeInTheDocument();
  });

  it('배수구는 mono, 미지정 안내는 warn 글자, 경고는 눈썹 라벨 + warning Alert, 후속 안내는 muted', () => {
    const { container } = render(
      <SlopeVerdictPanel stats={{ ...stats, direction_judged: false, warnings: ['w1'] }} judge={null}
        drainPoints={[{ x: 3.2, y: 5.1 }]} directionAware />,
    );
    expect(screen.getByText('현재 배수구').className).toBe(EYEBROW);
    expect(screen.getByText('(3.2, 5.1)').className).toContain('font-mono');
    expect(screen.getByText(/지도에서 배수구 위치를 클릭하세요/).className).toContain('text-warn');
    expect(screen.getByText('경고').className).toBe(EYEBROW);
    expect(screen.getByText('w1').closest('[data-alert]')).toHaveAttribute('data-alert', 'warning'); // 미지 코드는 원문(warningLabel)
    expect(screen.getByText(/구역별 통계는 후속 단계/).className).toContain('text-muted');
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-/);
    expect(container.innerHTML).not.toMatch(/\bcs-/);
  });
});

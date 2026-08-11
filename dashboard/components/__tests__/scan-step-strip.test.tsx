// D5 스캔 작업대: 단계 스트립(업로드 → 사전 검사 → 단위 확정 → 분석 → 완료).
// 상태별 "현재 단계" 매핑이 이 컴포넌트의 전부다 - 매핑이 한 칸 밀리면 사용자는
// 이미 끝난 단계를 기다리거나, 아직 못 하는 단계를 하려고 든다.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScanStepStrip } from '../scan-step-strip';

describe('ScanStepStrip', () => {
  it.each([
    ['uploaded', '사전 검사'],
    ['awaiting_unit_confirm', '단위 확정'],
    ['ready', '분석'],
  ] as const)('상태 %s에서 현재 단계 %s가 강조된다', (status, label) => {
    render(<ScanStepStrip status={status} hasDoneAnalysis={false} />);
    expect(screen.getByText(label).className).toContain('text-zinc-900');
  });
  it('완료 분석이 있으면 마지막 단계가 완료 표시된다', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis />);
    expect(screen.getByText('완료')).toBeInTheDocument();
  });
  it('failed는 실패 톤으로 표시된다', () => {
    render(<ScanStepStrip status="failed" hasDoneAnalysis={false} />);
    expect(screen.getByText('사전 검사').className).toContain('text-red-700');
  });

  // '완료'는 스트립에 항상 있는 라벨이라 존재 확인만으로는 아무 회귀도 못 잡는다
  // (위 브리프 테스트는 그대로 두되, 여기서 강조까지 못 박는다). hasDoneAnalysis면
  // 현재 단계가 '분석'이 아니라 '완료'로 넘어가야 한다.
  it('완료 분석이 있으면 완료 단계가 현재로 강조되고 분석 단계는 지난 톤이 된다', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis />);
    expect(screen.getByText('완료').className).toContain('text-zinc-900');
    expect(screen.getByText('분석').className).toContain('text-zinc-400');
  });

  it('지난 단계는 text-zinc-400, 미래 단계는 text-zinc-300으로 구분된다', () => {
    render(<ScanStepStrip status="awaiting_unit_confirm" hasDoneAnalysis={false} />);
    expect(screen.getByText('업로드').className).toContain('text-zinc-400');
    expect(screen.getByText('사전 검사').className).toContain('text-zinc-400');
    expect(screen.getByText('분석').className).toContain('text-zinc-300');
    expect(screen.getByText('완료').className).toContain('text-zinc-300');
  });

  it('전체가 font-mono text-xs 스트립이고 구분자 ›를 쓴다', () => {
    const { container } = render(<ScanStepStrip status="ready" hasDoneAnalysis={false} />);
    const strip = container.firstElementChild!;
    expect(strip.className).toContain('font-mono');
    expect(strip.className).toContain('text-xs');
    // 단계 5개 사이 구분자 4개
    expect(screen.getAllByText('›')).toHaveLength(4);
  });

  it('failed여도 hasDoneAnalysis가 완료로 건너뛰지 않는다(실패 표시가 우선)', () => {
    // 재분석 실패 등으로 상태·분석 이력이 어긋난 조합에서도 실패를 숨기면 안 된다.
    render(<ScanStepStrip status="failed" hasDoneAnalysis />);
    expect(screen.getByText('사전 검사').className).toContain('text-red-700');
  });
});

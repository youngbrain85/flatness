// D5 스캔 작업대: 단계 스트립(업로드 → 사전 검사 → 단위 확정 → 분석 → 완료).
// 상태별 "현재 단계" 매핑이 이 컴포넌트의 전부다 - 매핑이 한 칸 밀리면 사용자는
// 이미 끝난 단계를 기다리거나, 아직 못 하는 단계를 하려고 든다.
// Cloudscape 재스킨: 현재 단계는 스타일이 아니라 aria-current="step"으로 읽는다(스펙 §8).
// 톤(완료 success / 현재 link 700 / 이후 disabled / 실패 error)과 아이콘은 그 다음이다.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScanStepStrip } from '../scan-step-strip';

// 라벨의 단계 항목(li) - aria-current·톤 클래스·아이콘이 모두 여기 달린다.
function step(label: string): HTMLElement {
  const li = screen.getByText(label).closest('li');
  if (!li) throw new Error(`단계 li 없음: ${label}`);
  return li;
}
function iconOf(label: string) {
  return step(label).querySelector('[data-icon]')?.getAttribute('data-icon');
}

describe('ScanStepStrip', () => {
  it.each([
    ['uploaded', '사전 검사'],
    ['awaiting_unit_confirm', '단위 확정'],
    ['ready', '분석'],
  ] as const)('상태 %s에서 현재 단계 %s가 aria-current="step"이다(현재는 하나뿐)', (status, label) => {
    const { container } = render(<ScanStepStrip status={status} hasDoneAnalysis={false} />);
    expect(step(label)).toHaveAttribute('aria-current', 'step');
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('현재 단계는 cs-link 700 + clock 아이콘이다', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis={false} />);
    expect(step('분석').className).toContain('text-cs-link');
    expect(step('분석').className).toContain('font-bold');
    expect(iconOf('분석')).toBe('clock');
  });

  it('완료 분석이 있으면 마지막 단계가 완료 표시된다', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis />);
    expect(screen.getByText('완료')).toBeInTheDocument();
  });

  it('failed는 실패 톤(cs-error + x-circle)으로, 현재 단계로 표시된다', () => {
    render(<ScanStepStrip status="failed" hasDoneAnalysis={false} />);
    expect(step('사전 검사')).toHaveAttribute('aria-current', 'step');
    expect(step('사전 검사').className).toContain('text-cs-error');
    expect(iconOf('사전 검사')).toBe('x-circle');
  });

  // '완료'는 스트립에 항상 있는 라벨이라 존재 확인만으로는 아무 회귀도 못 잡는다
  // (위 브리프 테스트는 그대로 두되, 여기서 강조까지 못 박는다). hasDoneAnalysis면
  // 현재 단계가 '분석'이 아니라 '완료'로 넘어가야 한다.
  it('완료 분석이 있으면 완료 단계가 현재로 강조되고 분석 단계는 지난 톤이 된다', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis />);
    expect(step('완료')).toHaveAttribute('aria-current', 'step');
    expect(step('분석')).not.toHaveAttribute('aria-current');
    expect(step('분석').className).toContain('text-cs-success');
    expect(iconOf('분석')).toBe('check-circle');
  });

  // 아트보드(ScanDone): 종결 단계 '완료'가 현재이면 시계가 아니라 check-circle이다 -
  // 시계는 "완료를 기다리는 중"으로 읽힌다.
  it('완료 단계가 현재이면 아이콘은 clock이 아니라 check-circle이다(종결 상태)', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis />);
    expect(iconOf('완료')).toBe('check-circle');
    expect(step('완료').className).toContain('text-cs-link');
  });

  it('지난 단계는 cs-success + check-circle, 미래 단계는 cs-disabled + minus-circle로 구분된다', () => {
    render(<ScanStepStrip status="awaiting_unit_confirm" hasDoneAnalysis={false} />);
    for (const l of ['업로드', '사전 검사']) {
      expect(step(l).className).toContain('text-cs-success');
      expect(iconOf(l)).toBe('check-circle');
    }
    for (const l of ['분석', '완료']) {
      expect(step(l).className).toContain('text-cs-disabled');
      expect(iconOf(l)).toBe('minus-circle');
    }
  });

  it('ol/li 5단계에 사이 연결선 4개(cs-divider)이고 딩뱃 구분자·모노 폰트는 없다', () => {
    const { container } = render(<ScanStepStrip status="ready" hasDoneAnalysis={false} />);
    expect(container.querySelectorAll('ol > li')).toHaveLength(5);
    const connectors = container.querySelectorAll('[data-connector]');
    expect(connectors).toHaveLength(4);
    expect(connectors[0].className).toContain('bg-cs-divider');
    expect(screen.queryByText('›')).toBeNull();
    expect(container.querySelector('ol')?.className).not.toContain('font-mono');
  });

  it('failed여도 hasDoneAnalysis가 완료로 건너뛰지 않는다(실패 표시가 우선)', () => {
    // 재분석 실패 등으로 상태·분석 이력이 어긋난 조합에서도 실패를 숨기면 안 된다.
    render(<ScanStepStrip status="failed" hasDoneAnalysis />);
    expect(step('사전 검사')).toHaveAttribute('aria-current', 'step');
    expect(step('사전 검사').className).toContain('text-cs-error');
  });
});

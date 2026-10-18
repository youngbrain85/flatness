import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const { useRowStatusMock } = vi.hoisted(() => ({ useRowStatusMock: vi.fn() }));
vi.mock('@/lib/hooks/use-row-status', () => ({ useRowStatus: useRowStatusMock }));

import { ReportProgress } from '../report-progress';

describe('ReportProgress (코드리뷰 Important I2: 발행본의 gen_status 잔재 표시 방지)', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    useRowStatusMock.mockClear();
  });

  it('reportStatus가 finalized면 gen_status가 failed여도 아무것도 렌더하지 않는다', () => {
    useRowStatusMock.mockReturnValue('failed');
    const { container } = render(
      <ReportProgress reportId="r1" initialStatus="failed" genError="워커 오류"
        reportStatus="finalized" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/PDF 생성에 실패했습니다/)).toBeNull();
  });

  it('reportStatus가 draft면 기존과 동일하게 실패 상자(error)를 보여준다', () => {
    useRowStatusMock.mockReturnValue('failed');
    render(
      <ReportProgress reportId="r1" initialStatus="failed" genError="워커 오류"
        reportStatus="draft" />,
    );
    expect(screen.getByText(/PDF 생성에 실패했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.getByText('사유: 워커 오류')).toBeInTheDocument();
    // 재시도 안내는 muted 작은 글자
    expect(screen.getByText(/워커가 실행 중인지 확인한 뒤 다시 생성하세요/).className).toContain('text-muted');
  });

  it('reportStatus가 draft이고 생성 중이면 진행 안내(in-progress)를 보여준다', () => {
    useRowStatusMock.mockReturnValue('processing');
    render(
      <ReportProgress reportId="r1" initialStatus="processing" genError={null}
        reportStatus="draft" />,
    );
    expect(screen.getByText(/워커가 처리 중입니다/).closest('[data-status]')).toHaveAttribute('data-status', 'in-progress');
  });
});

// 변이 실험(Task 10 보강): 구독 대상(테이블·id·열), 끝난 상태에서 아무것도 안 그리는 규칙, 끝났을 때만 서버 데이터를
// 다시 받는 규칙은 위 단언만으로는 조용히 바뀌어도 통과했다.
describe('ReportProgress 보강 (변이 실험으로 드러난 빈틈)', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    useRowStatusMock.mockClear();
  });

  it('행 상태는 이 보고서(reports.id)의 gen_status 열을 구독한다', () => {
    useRowStatusMock.mockReturnValue('processing');
    render(<ReportProgress reportId="r1" initialStatus="processing" genError={null} reportStatus="draft" />);
    expect(useRowStatusMock).toHaveBeenCalledWith('reports', 'r1', 'processing', 'gen_status');
  });

  it('draft이고 생성이 끝났으면(done) 아무것도 그리지 않는다', () => {
    useRowStatusMock.mockReturnValue('done');
    const { container } = render(
      <ReportProgress reportId="r1" initialStatus="processing" genError={null} reportStatus="draft" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['done', 'failed'] as const)('생성이 %s로 끝나 상태가 바뀌면 서버 데이터를 다시 받는다', (end) => {
    useRowStatusMock.mockReturnValue(end);
    render(<ReportProgress reportId="r1" initialStatus="processing" genError="사유" reportStatus="draft" />);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { initial: 'done', now: 'done' },
    { initial: 'failed', now: 'failed' },
    { initial: 'processing', now: 'processing' },
    { initial: 'queued', now: 'processing' },
  ] as const)('상태가 $initial에서 $now라 끝으로 바뀐 것이 아니면 새로고침하지 않는다', ({ initial, now }) => {
    useRowStatusMock.mockReturnValue(now);
    render(<ReportProgress reportId="r1" initialStatus={initial} genError={null} reportStatus="draft" />);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

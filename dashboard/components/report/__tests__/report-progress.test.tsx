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

  it('reportStatus가 draft면 기존과 동일하게 실패 박스를 보여준다', () => {
    useRowStatusMock.mockReturnValue('failed');
    render(
      <ReportProgress reportId="r1" initialStatus="failed" genError="워커 오류"
        reportStatus="draft" />,
    );
    expect(screen.getByText(/PDF 생성에 실패했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
  });

  it('reportStatus가 draft이고 생성 중이면 진행 안내를 보여준다', () => {
    useRowStatusMock.mockReturnValue('processing');
    render(
      <ReportProgress reportId="r1" initialStatus="processing" genError={null}
        reportStatus="draft" />,
    );
    expect(screen.getByText(/워커가 처리 중입니다/)).toHaveAttribute('data-status', 'in-progress');
  });
});

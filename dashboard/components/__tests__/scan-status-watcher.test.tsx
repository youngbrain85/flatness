import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const { useRowStatusMock } = vi.hoisted(() => ({ useRowStatusMock: vi.fn() }));
vi.mock('@/lib/hooks/use-row-status', () => ({ useRowStatus: useRowStatusMock }));

import { ScanStatusWatcher } from '../scan-status-watcher';

describe('ScanStatusWatcher (리뷰 Important 2: scans Realtime 구독을 프로덕션 코드에 연결)', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    useRowStatusMock.mockClear();
  });

  it('구독 상태가 초기 상태와 같으면 router.refresh를 호출하지 않는다', () => {
    useRowStatusMock.mockReturnValue('uploaded');
    render(<ScanStatusWatcher scanId="s1" initialStatus="uploaded" />);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('구독 상태가 초기 상태와 달라지면 router.refresh를 호출한다', () => {
    useRowStatusMock.mockReturnValue('awaiting_unit_confirm');
    render(<ScanStatusWatcher scanId="s1" initialStatus="uploaded" />);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('useRowStatus를 scans 테이블·scanId·초기 상태로 호출한다', () => {
    useRowStatusMock.mockReturnValue('uploaded');
    render(<ScanStatusWatcher scanId="s1" initialStatus="uploaded" />);
    expect(useRowStatusMock).toHaveBeenCalledWith('scans', 's1', 'uploaded');
  });
});

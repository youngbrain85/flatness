import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { ReportDeleteButton } from '../report-delete-button';

function stubSupabase(
  updateError: { message: string } | null,
  spy: (f: unknown) => void = () => {},
  eqSpy: (col: string, val: unknown) => void = () => {},
) {
  return {
    from: (table: string) => {
      if (table !== 'reports') throw new Error(`예상치 못한 테이블: ${table}`);
      return {
        update: (fields: unknown) => {
          spy(fields);
          // eq의 인자를 기록한다. 이걸 안 하면 .eq('id', report.id)가 사라져도 테스트가
          // 통과하고, 그 코드는 WHERE 없는 UPDATE가 되어 전체 보고서를 지운다.
          return { eq: async (col: string, val: unknown) => { eqSpy(col, val); return { error: updateError }; } };
        },
      };
    },
  };
}

afterEach(() => { vi.clearAllMocks(); });

describe('ReportDeleteButton', () => {
  it('첫 클릭에는 지우지 않고 확인 단계를 보여준다', () => {
    const spy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(screen.getByText(/삭제할까요/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  // 상세 화면: 보고 있던 보고서가 사라지므로 목록으로 이동한다
  it('redirectTo가 있으면 deleted_at을 채우고 그리로 이동한다', async () => {
    const spy = vi.fn();
    const eqSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy, eqSpy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} redirectTo="/reports" />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reports'));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
    // 이 보고서 1건에만 적용되는지 확인한다. .eq('id', report.id)가 없으면 WHERE
    // 없는 UPDATE가 되어 전체 보고서가 지워진다
    expect(eqSpy).toHaveBeenCalledWith('id', 'r1');
    // push 직후 refresh는 진행 중이던 이동을 취소한다(커밋 112bed2)
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // 목록 화면: 이동할 곳이 없으므로 그 자리에서 다시 그린다
  it('redirectTo가 없으면 이동하지 않고 새로고침만 한다', async () => {
    const spy = vi.fn();
    const eqSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy, eqSpy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
    // 이 보고서 1건에만 적용되는지 확인한다
    expect(eqSpy).toHaveBeenCalledWith('id', 'r1');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('취소하면 지우지 않고 첫 상태로 돌아간다', () => {
    const spy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
  });

  it('발행본은 발행된 기록임을 경고한다', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'finalized' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(screen.getByText(/발행/)).toBeInTheDocument();
  });

  it('삭제에 실패하면 사유를 남기고 이동하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ message: '권한이 없습니다' }) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));

    expect(await screen.findByText(/권한이 없습니다/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

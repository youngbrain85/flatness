import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { pushMock, refreshMock } = vi.hoisted(() => ({ pushMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { ReanalyzeButton } from '../reanalyze-button';
import { DUPLICATE_JOB_MESSAGE } from '@/lib/domain/jobs';

// unit-confirm-form과 동일한 형태의 로컬 스텁(insert().select().single() 체인 +
// fn_enqueue_job rpc)
function stubSupabase(enqueueError: { code?: string; message: string } | null) {
  return {
    from: (table: string) => {
      if (table === 'analyses') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'a2' }, error: null }) }) }),
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    rpc: async (fn: string) => {
      if (fn === 'fn_enqueue_job') return { error: enqueueError };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReanalyzeButton (C5: 스캔 상세 다시 분석)', () => {
  it('직전 분석이 done이면 버튼이 활성 상태다', () => {
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1" latestStatus="done" />);
    expect(screen.getByRole('button', { name: '다시 분석' })).toBeEnabled();
  });

  it('직전 분석이 진행 중(queued/processing)이면 버튼이 비활성화되고 안내가 보인다', () => {
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1" latestStatus="processing" />);
    expect(screen.getByRole('button', { name: '다시 분석' })).toBeDisabled();
    expect(screen.getByText(/진행 중인 분석이 끝난 뒤/)).toBeInTheDocument();
  });

  it('클릭 시 새 분석 행 생성 + analyze 잡 등록 후 새로고침한다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1" latestStatus="done" />);
    fireEvent.click(screen.getByRole('button', { name: '다시 분석' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('중복 엔큐(409)면 안내 메시지를 남기고 새로고침하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ code: '23505', message: 'dup' }) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1" latestStatus="done" />);
    fireEvent.click(screen.getByRole('button', { name: '다시 분석' }));
    expect(await screen.findByText(DUPLICATE_JOB_MESSAGE)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

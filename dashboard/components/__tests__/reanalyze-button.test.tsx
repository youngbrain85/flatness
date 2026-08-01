import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { pushMock, refreshMock } = vi.hoisted(() => ({ pushMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { ReanalyzeButton } from '../reanalyze-button';
import { DUPLICATE_JOB_MESSAGE } from '@/lib/domain/jobs';

// unit-confirm-form과 동일한 형태의 로컬 스텁(insert().select().single() 체인 +
// fn_enqueue_job rpc). rpcSpy/updateSpy로 실제 호출 인자를 검증한다
// (C1: 잡 타입 분기, I1: 엔큐 실패 시 고아 행 롤백).
function stubSupabase(
  enqueueError: { code?: string; message: string } | null,
  rpcSpy: (fn: string, params: unknown) => void = () => {},
  updateSpy: (fields: unknown) => void = () => {},
) {
  return {
    from: (table: string) => {
      if (table === 'analyses') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'a2' }, error: null }) }) }),
          update: (fields: unknown) => {
            updateSpy(fields);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    rpc: async (fn: string, params: unknown) => {
      rpcSpy(fn, params);
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
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1"
      latestStatus="done" isImport={false} />);
    expect(screen.getByRole('button', { name: '다시 분석' })).toBeEnabled();
  });

  it('직전 분석이 진행 중(queued/processing)이면 버튼이 비활성화되고 안내가 보인다', () => {
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1"
      latestStatus="processing" isImport={false} />);
    expect(screen.getByRole('button', { name: '다시 분석' })).toBeDisabled();
    expect(screen.getByText(/진행 중인 분석이 끝난 뒤/)).toBeInTheDocument();
  });

  it('클릭 시 새 분석 행 생성 + analyze 잡 등록 후 새로고침한다', async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, rpcSpy) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1"
      latestStatus="done" isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: '다시 분석' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(rpcSpy).toHaveBeenCalledWith('fn_enqueue_job', { p_type: 'analyze', p_payload: { analysis_id: 'a2' } });
  });

  it('중복 엔큐(409)면 안내 메시지를 남기고 새로고침하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ code: '23505', message: 'dup' }) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1"
      latestStatus="done" isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: '다시 분석' }));
    expect(await screen.findByText(DUPLICATE_JOB_MESSAGE)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('C1(회귀): 임포트 결과 스캔(isImport=true)은 analyze가 아니라 import 잡을 건다', async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, rpcSpy) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1"
      latestStatus="done" isImport={true} />);
    fireEvent.click(screen.getByRole('button', { name: '다시 분석' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(rpcSpy).toHaveBeenCalledWith('fn_enqueue_job', { p_type: 'import', p_payload: { analysis_id: 'a2' } });
  });

  it('C1(회귀): 일반(LiDAR) 스캔(isImport=false)은 analyze 잡을 건다', async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, rpcSpy) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1"
      latestStatus="done" isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: '다시 분석' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(rpcSpy).toHaveBeenCalledWith('fn_enqueue_job', { p_type: 'analyze', p_payload: { analysis_id: 'a2' } });
  });

  it('I1: 엔큐 실패 시 방금 만든 analyses 행을 soft delete로 되돌린다(고아 행 방지)', async () => {
    const updateSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ message: '전송 오류로 등록 실패' }, undefined, updateSpy) as never,
    );
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" criteriaId="cr1"
      latestStatus="done" isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: '다시 분석' }));
    await screen.findByText(/전송 오류로 등록 실패/);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

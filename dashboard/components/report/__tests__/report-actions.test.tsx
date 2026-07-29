import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { supabaseStub, state } = vi.hoisted(() => {
  const state = {
    updated: null as Record<string, unknown> | null,
    updateError: null as { message: string } | null,
    rpcCalls: [] as { fn: string; params: unknown }[],
  };
  const supabaseStub = {
    from() {
      return {
        update(fields: Record<string, unknown>) {
          state.updated = fields;
          return { eq: async () => ({ error: state.updateError }) };
        },
      };
    },
    async rpc(fn: string, params: unknown) {
      state.rpcCalls.push({ fn, params });
      return { error: null };
    },
  };
  return { supabaseStub, state };
});

vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabaseStub }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ReportActions } from '../report-actions';

const doneDraft = {
  id: 'r1', status: 'draft' as const, gen_status: 'done' as const,
  pdf_path: 'reports/r1/report.pdf',
};

describe('ReportActions', () => {
  beforeEach(() => {
    state.updated = null;
    state.updateError = null;
    state.rpcCalls = [];
  });

  it('생성 완료된 draft는 발행 버튼을 노출하고 status만 갱신한다', async () => {
    render(<ReportActions report={doneDraft} />);
    fireEvent.click(screen.getByRole('button', { name: '발행' }));
    await waitFor(() => expect(state.updated).toEqual({ status: 'finalized' }));
  });

  it('생성 중에는 발행 버튼을 노출하지 않는다', () => {
    render(<ReportActions report={{ ...doneDraft, gen_status: 'processing', pdf_path: null }} />);
    expect(screen.queryByRole('button', { name: '발행' })).toBeNull();
  });

  it('발행본은 발행·재생성 버튼 없이 발행 상태만 보여준다', () => {
    render(<ReportActions report={{ ...doneDraft, status: 'finalized' }} />);
    expect(screen.queryByRole('button', { name: '발행' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'PDF 다시 생성' })).toBeNull();
    expect(screen.getByText(/발행된 보고서는 수정할 수 없습니다/)).toBeInTheDocument();
  });

  it('발행 실패(트리거 거부)는 사유를 그대로 보여준다', async () => {
    state.updateError = { message: 'PDF가 생성되지 않은 보고서는 발행할 수 없습니다 (report_id=r1)' };
    render(<ReportActions report={doneDraft} />);
    fireEvent.click(screen.getByRole('button', { name: '발행' }));
    expect(await screen.findByText(/발행할 수 없습니다/)).toBeInTheDocument();
  });

  it('재생성은 fn_enqueue_job RPC만 호출한다(gen_status는 잡 기계장치 소유)', async () => {
    render(<ReportActions report={{ ...doneDraft, gen_status: 'failed' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF 다시 생성' }));
    await waitFor(() => expect(state.rpcCalls).toEqual([
      { fn: 'fn_enqueue_job', params: { p_type: 'report', p_payload: { report_id: 'r1' } } },
    ]));
    expect(state.updated).toBeNull();
  });
});

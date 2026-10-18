import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { supabaseStub, state } = vi.hoisted(() => {
  const state = {
    updated: null as Record<string, unknown> | null,
    updateError: null as { message: string } | null,
    eqCalls: [] as [string, unknown][],
    rpcCalls: [] as { fn: string; params: unknown }[],
    rpcError: null as { message: string } | null,
    // 값이 있으면 update/rpc가 이 프라미스가 풀릴 때까지 끝나지 않는다(진행 중 상태 확인용)
    hold: null as Promise<void> | null,
  };
  const supabaseStub = {
    from() {
      return {
        update(fields: Record<string, unknown>) {
          state.updated = fields;
          return {
            eq: async (col: string, val: unknown) => {
              state.eqCalls.push([col, val]);
              if (state.hold) await state.hold;
              return { error: state.updateError };
            },
          };
        },
      };
    },
    async rpc(fn: string, params: unknown) {
      state.rpcCalls.push({ fn, params });
      if (state.hold) await state.hold;
      return { error: state.rpcError };
    },
  };
  return { supabaseStub, state };
});

vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabaseStub }));
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { ReportActions } from '../report-actions';
import { buttonClass } from '@/components/ui/button';

const doneDraft = {
  id: 'r1', status: 'draft' as const, gen_status: 'done' as const,
  pdf_path: 'reports/r1/report.pdf',
};

function resetState() {
  state.updated = null;
  state.updateError = null;
  state.eqCalls = [];
  state.rpcCalls = [];
  state.rpcError = null;
  state.hold = null;
  refreshMock.mockClear();
}

describe('ReportActions', () => {
  beforeEach(resetState);

  it('생성 완료된 draft는 발행 버튼을 노출하고 status만 갱신한다', async () => {
    render(<ReportActions report={doneDraft} />);
    fireEvent.click(screen.getByRole('button', { name: '발행' }));
    await waitFor(() => expect(state.updated).toEqual({ status: 'finalized' }));
  });

  it('생성 중에는 발행 버튼을 노출하지 않는다', () => {
    render(<ReportActions report={{ ...doneDraft, gen_status: 'processing', pdf_path: null }} />);
    expect(screen.queryByRole('button', { name: '발행' })).toBeNull();
  });

  it('발행본은 발행·재생성 버튼 없이 발행 안내(muted 12px)만 보여준다', () => {
    render(<ReportActions report={{ ...doneDraft, status: 'finalized' }} />);
    expect(screen.queryByRole('button', { name: '발행' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'PDF 다시 생성' })).toBeNull();
    const note = screen.getByText(/발행된 보고서는 수정할 수 없습니다/);
    expect(note.className).toContain('text-muted');
    expect(note.className).toContain('text-xs');
  });

  it('발행 실패(트리거 거부)는 사유를 그대로 보여준다', async () => {
    state.updateError = { message: 'PDF가 생성되지 않은 보고서는 발행할 수 없습니다 (report_id=r1)' };
    render(<ReportActions report={doneDraft} />);
    fireEvent.click(screen.getByRole('button', { name: '발행' }));
    const msg = await screen.findByText(/발행할 수 없습니다/);
    expect(msg.closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
  });

  it('재생성은 fn_enqueue_job RPC만 호출한다(gen_status는 잡 기계장치 소유)', async () => {
    render(<ReportActions report={{ ...doneDraft, gen_status: 'failed' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF 다시 생성' }));
    await waitFor(() => expect(state.rpcCalls).toEqual([
      { fn: 'fn_enqueue_job', params: { p_type: 'report', p_payload: { report_id: 'r1' } } },
    ]));
    expect(state.updated).toBeNull();
  });

  it('다운로드·재생성은 보조 버튼이고 아이콘을 단다(주 버튼은 발행 하나)', () => {
    // gen_status failed + pdf_path 있음: 다운로드·재생성은 있고 발행은 없다
    render(<ReportActions report={{ ...doneDraft, gen_status: 'failed' }} />);
    const download = screen.getByRole('link', { name: 'PDF 다운로드' });
    expect(download).toHaveAttribute('download');
    expect(download).toHaveAttribute('href', '/api/data/reports/r1/report.pdf');
    expect(download.className).toBe(buttonClass('normal'));
    expect(download.querySelector('[data-icon="download"]')).not.toBeNull();
    const regen = screen.getByRole('button', { name: 'PDF 다시 생성' });
    expect(regen.className).not.toContain('bg-ink');
    expect(regen.querySelector('[data-icon="refresh"]')).not.toBeNull();
  });

  it('발행 버튼은 주 버튼(ink 채움)이다', () => {
    render(<ReportActions report={doneDraft} />);
    expect(screen.getByRole('button', { name: '발행' }).className).toContain('bg-ink');
  });
});

// 변이 실험(Task 10 보강): 발행은 되돌릴 수 없는 동작인데 위 단언은 UPDATE의 대상(WHERE id)·성공 뒤 동작·실패 분기·
// 진행 중 중복 클릭 잠금을 확인하지 못했다. 아래가 그 틈을 막는다.
describe('ReportActions 보강 (변이 실험으로 드러난 빈틈)', () => {
  beforeEach(resetState);

  it('발행은 이 보고서 1건에만 적용한다(WHERE id = report.id)', async () => {
    render(<ReportActions report={doneDraft} />);
    fireEvent.click(screen.getByRole('button', { name: '발행' }));
    await waitFor(() => expect(state.updated).toEqual({ status: 'finalized' }));
    expect(state.eqCalls).toEqual([['id', 'r1']]);
  });

  it('발행에 성공하면 안내 메시지를 보이고 서버 데이터를 다시 받는다', async () => {
    render(<ReportActions report={doneDraft} />);
    fireEvent.click(screen.getByRole('button', { name: '발행' }));
    expect(await screen.findByText('보고서를 발행했습니다.')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('발행 실패면 성공 안내도 새로고침도 하지 않는다', async () => {
    state.updateError = { message: '발행할 수 없습니다' };
    render(<ReportActions report={doneDraft} />);
    fireEvent.click(screen.getByRole('button', { name: '발행' }));
    await screen.findByText('발행할 수 없습니다');
    expect(screen.queryByText('보고서를 발행했습니다.')).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('재생성을 요청하면 안내 메시지를 보이고 서버 데이터를 다시 받는다', async () => {
    render(<ReportActions report={{ ...doneDraft, gen_status: 'failed' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF 다시 생성' }));
    expect(await screen.findByText('PDF 재생성을 요청했습니다. 진행 상태는 자동으로 갱신됩니다.'))
      .toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('재생성 요청(잡 등록)이 실패하면 사유를 error 알림으로 보이고 성공 안내·새로고침을 하지 않는다', async () => {
    state.rpcError = { message: '큐 오류' };
    render(<ReportActions report={{ ...doneDraft, gen_status: 'failed' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'PDF 다시 생성' }));
    const msg = await screen.findByText('작업 등록에 실패했습니다: 큐 오류');
    expect(msg.closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.queryByText(/재생성을 요청했습니다/)).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('PDF가 없으면(pdf_path 없음) 다운로드 링크를 그리지 않는다', () => {
    render(<ReportActions report={{ ...doneDraft, gen_status: 'processing', pdf_path: null }} />);
    expect(screen.queryByRole('link', { name: 'PDF 다운로드' })).toBeNull();
  });

  it('발행하는 동안 버튼이 잠기고 끝나면 다시 풀린다(중복 발행 방지)', async () => {
    let release: () => void = () => {};
    state.hold = new Promise<void>((resolve) => { release = resolve; });
    render(<ReportActions report={doneDraft} />);
    const finalize = screen.getByRole('button', { name: '발행' });
    fireEvent.click(finalize);
    expect(finalize).toBeDisabled();
    release();
    await screen.findByText('보고서를 발행했습니다.');
    expect(finalize).toBeEnabled();
  });

  it('PDF 다시 생성을 요청하는 동안 버튼이 잠기고 끝나면 다시 풀린다', async () => {
    let release: () => void = () => {};
    state.hold = new Promise<void>((resolve) => { release = resolve; });
    render(<ReportActions report={{ ...doneDraft, gen_status: 'failed' }} />);
    const regen = screen.getByRole('button', { name: 'PDF 다시 생성' });
    fireEvent.click(regen);
    expect(regen).toBeDisabled();
    release();
    await screen.findByText(/재생성을 요청했습니다/);
    expect(regen).toBeEnabled();
  });
});

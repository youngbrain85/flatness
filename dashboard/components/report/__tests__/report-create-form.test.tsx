import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { supabaseStub, state } = vi.hoisted(() => {
  const state = {
    inserted: null as Record<string, unknown> | null,
    links: [] as Record<string, unknown>[],
    linkError: null as { message: string } | null,
    rpcCalls: [] as { fn: string; params: unknown }[],
    rpcError: null as { code?: string; message: string } | null,
  };
  const supabaseStub = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from(table: string) {
      if (table === 'reports') {
        return {
          insert(row: Record<string, unknown>) {
            state.inserted = row;
            return { select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) };
          },
        };
      }
      return {
        async insert(rows: Record<string, unknown>[]) {
          state.links = rows;
          return { error: state.linkError };
        },
      };
    },
    async rpc(fn: string, params: unknown) {
      state.rpcCalls.push({ fn, params });
      return { error: state.rpcError };
    },
  };
  return { supabaseStub, state };
});

vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabaseStub }));

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

import { ReportCreateForm } from '../report-create-form';

const candidates = [
  { analysis_id: 'an1', surface: 'floor' as const, scanned_at: '2026-07-20',
    verdict_label: '경계', summary: '바닥 의견' },
  { analysis_id: 'an2', surface: 'wall' as const, scanned_at: '2026-07-21',
    verdict_label: '적합', summary: '벽면 의견' },
];

function renderForm() {
  return render(
    <ReportCreateForm locationId="loc1" locationLabel="101동 / 3층 / 거실 / P1" candidates={candidates} />,
  );
}

describe('ReportCreateForm', () => {
  beforeEach(() => {
    state.inserted = null;
    state.links = [];
    state.linkError = null;
    state.rpcCalls = [];
    state.rpcError = null;
    pushMock.mockClear();
  });

  it('후보 분석을 모두 선택한 상태로 시작하고 종합의견 초안을 채운다', () => {
    renderForm();
    for (const box of screen.getAllByRole('checkbox')) {
      expect((box as HTMLInputElement).checked).toBe(true);
    }
    expect((screen.getByLabelText('종합의견') as HTMLTextAreaElement).value)
      .toBe('[바닥] 바닥 의견\n\n[벽면] 벽면 의견');
  });

  it('제출하면 reports·report_analyses 삽입 후 report 잡을 등록하고 상세로 이동한다', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reports/r1'));
    expect(state.inserted).toMatchObject({ location_id: 'loc1', created_by: 'u1' });
    expect(state.links).toEqual([
      { report_id: 'r1', analysis_id: 'an1', sort_order: 0 },
      { report_id: 'r1', analysis_id: 'an2', sort_order: 1 },
    ]);
    expect(state.rpcCalls).toEqual([
      { fn: 'fn_enqueue_job', params: { p_type: 'report', p_payload: { report_id: 'r1' } } },
    ]);
  });

  it('선택한 분석이 없으면 안내만 하고 삽입하지 않는다', async () => {
    renderForm();
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    expect(await screen.findByText(/1개 이상 선택/)).toBeInTheDocument();
    expect(state.inserted).toBeNull();
  });

  it('중복 엔큐(23505)는 안내 문구로 바꾸되, 보고서 상세로 이동해 재시도 경로를 찾게 한다(I3)', async () => {
    state.rpcError = { code: '23505', message: 'duplicate key' };
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    expect(await screen.findByText(/이미 같은 대상의 작업이/)).toBeInTheDocument();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reports/r1'));
  });

  it('포함 분석 링크 저장에 실패해도 이미 생성된 보고서 상세로 이동한다(I3)', async () => {
    state.linkError = { message: '링크 저장 실패' };
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    expect(await screen.findByText(/포함 분석 저장에 실패했습니다/)).toBeInTheDocument();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reports/r1'));
  });
});

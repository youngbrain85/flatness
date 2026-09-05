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

import type { ReportCandidate } from '../report-create-form';

const candidates: ReportCandidate[] = [
  { analysis_id: 'an1', kind: 'flatness', surface: 'floor', scanned_at: '2026-07-20',
    verdict_label: '경계', summary: '바닥 의견', blocked_reason: null },
  { analysis_id: 'an2', kind: 'flatness', surface: 'wall', scanned_at: '2026-07-21',
    verdict_label: '적합', summary: '벽면 의견', blocked_reason: null },
];

function renderForm(list: ReportCandidate[] = candidates) {
  return render(
    <ReportCreateForm locationId="loc1" locationLabel="101동 / 3층 / 거실 / P1" candidates={list} />,
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
    // 단계 H: 같은 바닥에 평활도와 구배가 함께 실릴 수 있으므로 표면만으로는
    // 어느 분석의 의견인지 구별되지 않는다. 종류를 함께 적는다.
    expect((screen.getByLabelText('종합의견') as HTMLTextAreaElement).value)
      .toBe('[평활도 바닥] 바닥 의견\n\n[평활도 벽면] 벽면 의견');
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

  it('선택한 분석이 없으면 error Alert로 안내만 하고 삽입하지 않는다', async () => {
    renderForm();
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    const msg = await screen.findByText(/1개 이상 선택/);
    expect(msg.closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(state.inserted).toBeNull();
  });

  it('보고서 생성 버튼은 이 화면의 유일한 primary이고, 체크박스는 accent 색을 쓴다(T8)', () => {
    renderForm();
    expect(screen.getByRole('button', { name: '보고서 생성' }).className).toContain('bg-cs-link');
    for (const box of screen.getAllByRole('checkbox')) expect(box.className).toContain('accent-cs-link');
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

// 단계 C 주석이 경고한 "평활도와 육안 구별이 안 된다"를 실제로 해소한다. 색이
// 아니라 문구로 구별한다 - 스펙 §7.2가 역구배에 세운 원칙과 같다.
describe('ReportCreateForm 구배 편입 (단계 H)', () => {
  beforeEach(() => {
    state.inserted = null;
    state.links = [];
    state.linkError = null;
    state.rpcCalls = [];
    state.rpcError = null;
    pushMock.mockClear();
  });

  const slope = (over: Partial<ReportCandidate> = {}): ReportCandidate => ({
    analysis_id: 'an-slope', kind: 'slope', surface: 'floor', scanned_at: '2026-07-22',
    verdict_label: '보수', summary: '구배 의견', blocked_reason: null, ...over,
  });

  it('후보 목록이 평활도와 구배를 문구로 구별한다', () => {
    renderForm([candidates[0], slope()]);
    expect(screen.getByText(/^평활도 · 바닥/, { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/^구배 · 바닥/, { selector: 'span' })).toBeInTheDocument();
  });

  it('종합의견 초안도 평활도와 구배를 구별한다', () => {
    renderForm([candidates[0], slope()]);
    expect((screen.getByLabelText('종합의견') as HTMLTextAreaElement).value)
      .toBe('[평활도 바닥] 바닥 의견\n\n[구배 바닥] 구배 의견');
  });

  it('구배만 있는 측정위치의 기본 제목은 평활도라고 하지 않는다', () => {
    renderForm([slope()]);
    const title = (screen.getByLabelText('보고서 제목') as HTMLInputElement).value;
    expect(title).toContain('구배');
    expect(title).not.toContain('평활도');
  });

  it('평활도와 구배가 함께 있으면 기본 제목이 둘 다 밝힌다', () => {
    renderForm([candidates[0], slope()]);
    const title = (screen.getByLabelText('보고서 제목') as HTMLInputElement).value;
    expect(title).toContain('평활도');
    expect(title).toContain('구배');
  });

  it('평활도만 있으면 기본 제목이 그대로다', () => {
    renderForm();
    expect((screen.getByLabelText('보고서 제목') as HTMLInputElement).value)
      .toBe('101동 / 3층 / 거실 / P1 평활도 분석 보고서');
  });

  it('선택 불가 사유가 있는 후보는 체크박스가 비활성이고 사유를 보여준다', () => {
    const reason = '재판정이 끝나지 않았습니다.';
    renderForm([candidates[0], slope({ blocked_reason: reason })]);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[0].disabled).toBe(false);
    expect(boxes[1].disabled).toBe(true);
    // T8: 사유는 그 행 아래 warning Alert로 보인다(ReportNew 아트보드)
    expect(screen.getByText(reason).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
  });

  it('선택 불가 후보는 초기 선택에서 빠지고 제출해도 포함되지 않는다', async () => {
    renderForm([candidates[0], slope({ blocked_reason: '재판정 중' })]);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reports/r1'));
    expect(state.links).toEqual([{ report_id: 'r1', analysis_id: 'an1', sort_order: 0 }]);
  });

  it('선택 불가 후보는 클릭해도 선택되지 않는다', () => {
    renderForm([candidates[0], slope({ blocked_reason: '재판정 중' })]);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(boxes[1]);
    expect(boxes[1].checked).toBe(false);
  });

  it('선택 불가 후보의 의견은 종합의견 초안에도 실리지 않는다', () => {
    renderForm([candidates[0], slope({ blocked_reason: '재판정 중' })]);
    expect((screen.getByLabelText('종합의견') as HTMLTextAreaElement).value)
      .toBe('[평활도 바닥] 바닥 의견');
  });

  it('구배가 선택 불가면 기본 제목도 구배를 약속하지 않는다', () => {
    // 실제로 실릴 것은 평활도뿐인데 제목이 구배를 적으면 표지가 거짓이 된다
    renderForm([candidates[0], slope({ blocked_reason: '재판정 중' })]);
    expect((screen.getByLabelText('보고서 제목') as HTMLInputElement).value)
      .toBe('101동 / 3층 / 거실 / P1 평활도 분석 보고서');
  });

  it('선택 가능한 후보가 하나도 없으면 남은 후보의 종류를 따른다', () => {
    // 평활도로 되돌리면 화면에 없는 종류를 제목이 단언하게 된다
    renderForm([slope({ blocked_reason: '재판정 중' })]);
    expect((screen.getByLabelText('보고서 제목') as HTMLInputElement).value)
      .toBe('101동 / 3층 / 거실 / P1 구배 분석 보고서');
  });
});

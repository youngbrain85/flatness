// 보고서 생성 폼(스펙 §7.6). 다크 리스킨(Task 10, 아트보드 ReportNew): 카드 하나(제목 · 포함할 분석 · 종합의견)
// + 카드 밖 오른쪽 주 버튼. 후보 줄은 "종류 · 표면 · 측정 시각(mono) · 판정 등급 배지(data-grade)".
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { supabaseStub, state } = vi.hoisted(() => {
  const state = {
    inserted: null as Record<string, unknown> | null,
    links: [] as Record<string, unknown>[],
    linkError: null as { message: string } | null,
    rpcCalls: [] as { fn: string; params: unknown }[],
    rpcError: null as { code?: string; message: string } | null,
    insertError: null as { message: string } | null,
  };
  const supabaseStub = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from(table: string) {
      if (table === 'reports') {
        return {
          insert(row: Record<string, unknown>) {
            state.inserted = row;
            return {
              select: () => ({
                single: async () => (state.insertError
                  ? { data: null, error: state.insertError }
                  : { data: { id: 'r1' }, error: null }),
              }),
            };
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
import { checkLgClass } from '@/components/ui/form';

const candidates: ReportCandidate[] = [
  { analysis_id: 'an1', kind: 'flatness', surface: 'floor', scanned_at: '2026-07-20',
    grade: 'borderline', summary: '바닥 의견', blocked_reason: null },
  { analysis_id: 'an2', kind: 'flatness', surface: 'wall', scanned_at: '2026-07-21',
    grade: 'pass', summary: '벽면 의견', blocked_reason: null },
];

function renderForm(list: ReportCandidate[] = candidates) {
  return render(
    <ReportCreateForm locationId="loc1" locationLabel="101동 / 3층 / 거실 / P1" candidates={list} />,
  );
}

function resetState() {
  state.inserted = null;
  state.links = [];
  state.linkError = null;
  state.rpcCalls = [];
  state.rpcError = null;
  state.insertError = null;
  pushMock.mockClear();
}

describe('ReportCreateForm', () => {
  beforeEach(resetState);

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

describe('ReportCreateForm 화면 (아트보드 ReportNew)', () => {
  beforeEach(resetState);

  it('보고서 생성 버튼은 이 화면의 유일한 주 버튼이고 카드 밖에 있으며, 체크박스는 checkLgClass(18px, 아트보드 ReportNew)다', () => {
    const { container } = renderForm();
    const submit = screen.getByRole('button', { name: '보고서 생성' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.className).toContain('bg-ink');
    expect(screen.getAllByRole('button').filter((b) => b.className.includes('bg-ink'))).toHaveLength(1);
    const card = container.querySelector('[class*="rounded-card"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.contains(submit)).toBe(false);
    for (const box of screen.getAllByRole('checkbox')) expect(box.className).toBe(checkLgClass);
  });

  it('후보 목록은 "포함할 분석" 그룹(도움말 연결)이고 줄마다 측정 시각(mono)과 판정 등급 배지를 단다', () => {
    const { container } = renderForm();
    const group = screen.getByRole('group', { name: '포함할 분석' });
    expect(group).toHaveAccessibleDescription(/같은 측정위치의 완료된 최신 분석만 후보로 표시됩니다/);
    expect(screen.getByText('2026-07-20').className).toContain('font-mono');
    expect(container.querySelector('[data-grade="borderline"]')).toHaveTextContent('경계');
    expect(container.querySelector('[data-grade="pass"]')).toHaveTextContent('적합');
  });

  it('종합의견 칸은 초안 줄 수 + 2줄 높이이되 최소 8줄이다', () => {
    renderForm();
    expect(screen.getByLabelText('종합의견')).toHaveAttribute('rows', '8');
  });

  it('종합의견 칸은 최대 34줄(아트보드 rows=34: 초안이 스크롤 없이 보이는 높이)', () => {
    const long = Array.from({ length: 40 }, (_, i) => `${i + 1}번째 줄`).join('\n');
    renderForm([{ ...candidates[0], summary: long }]);
    expect(screen.getByLabelText('종합의견')).toHaveAttribute('rows', '34');
  });
});

// 단계 C 주석이 경고한 "평활도와 육안 구별이 안 된다"를 실제로 해소한다. 색이
// 아니라 문구로 구별한다 - 스펙 §7.2가 역구배에 세운 원칙과 같다.
describe('ReportCreateForm 구배 편입 (단계 H)', () => {
  beforeEach(resetState);

  const slope = (over: Partial<ReportCandidate> = {}): ReportCandidate => ({
    analysis_id: 'an-slope', kind: 'slope', surface: 'floor', scanned_at: '2026-07-22',
    grade: 'repair', summary: '구배 의견', blocked_reason: null, ...over,
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

  it('선택 불가 사유가 있는 후보는 체크박스가 비활성이고 사유(warning)를 설명으로 단다', () => {
    const reason = '재판정이 끝나지 않았습니다';
    const { container } = renderForm([candidates[0], slope({ blocked_reason: reason })]);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[0].disabled).toBe(false);
    expect(boxes[1].disabled).toBe(true);
    expect(screen.getByText(reason).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
    expect(boxes[1]).toHaveAccessibleDescription(/재판정이 끝나지 않았습니다/);
    // 막힌 줄의 판정은 등급 색 대신 중립 배지(글자는 그대로)
    expect(container.querySelector('[data-grade="repair"]')).toBeNull();
    expect(screen.getByText('보수')).toBeInTheDocument();
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

// 변이 실험(Task 10 보강): 제출이 reports 행에 싣는 제목·종합의견, 삽입 실패 경로, 제출 중 잠금, 종합의견 칸 높이,
// 종류가 둘일 때의 기본 제목은 위 단언만으로는 조용히 바뀌어도 통과했다.
describe('ReportCreateForm 보강 (변이 실험으로 드러난 빈틈)', () => {
  beforeEach(resetState);

  async function submitAndWait() {
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reports/r1'));
  }

  it('제출하면 기본 제목과 종합의견 초안이 그대로 reports 행에 실린다', async () => {
    renderForm();
    await submitAndWait();
    expect(state.inserted).toEqual({
      location_id: 'loc1',
      title: '101동 / 3층 / 거실 / P1 평활도 분석 보고서',
      opinion_text: '[평활도 바닥] 바닥 의견\n\n[평활도 벽면] 벽면 의견',
      created_by: 'u1',
    });
  });

  it('고친 제목과 종합의견은 앞뒤 공백을 지우고 보낸다', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('보고서 제목'), { target: { value: '  직접 정한 제목  ' } });
    fireEvent.change(screen.getByLabelText('종합의견'), { target: { value: '  직접 쓴 의견  ' } });
    await submitAndWait();
    expect(state.inserted).toMatchObject({ title: '직접 정한 제목', opinion_text: '직접 쓴 의견' });
  });

  it('종합의견을 비우면 opinion_text는 null이다(분석별 자동 의견이 그대로 실린다)', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('종합의견'), { target: { value: '   ' } });
    await submitAndWait();
    expect(state.inserted).toMatchObject({ opinion_text: null });
  });

  it('제목을 비우면 종류를 밝힌 기본 제목으로 보낸다', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('보고서 제목'), { target: { value: '   ' } });
    await submitAndWait();
    expect(state.inserted).toMatchObject({ title: '평활도 분석 보고서' });
  });

  it('보고서 삽입이 실패하면 사유를 보이고 포함 분석 저장·잡 등록·이동을 하지 않으며 버튼이 다시 풀린다', async () => {
    state.insertError = { message: '권한 없음' };
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    const msg = await screen.findByText('보고서 생성에 실패했습니다: 권한 없음');
    expect(msg.closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(state.links).toEqual([]);
    expect(state.rpcCalls).toEqual([]);
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '보고서 생성' })).toBeEnabled();
  });

  it('제출하는 동안 버튼이 "생성 요청 중..."으로 바뀌고 잠긴다(중복 제출 방지)', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    expect(screen.getByRole('button', { name: '생성 요청 중...' })).toBeDisabled();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reports/r1'));
  });

  it('종합의견 칸 아래에 도움말(비우면 자동 의견, 스크리닝 한계 문구 자동 포함)을 둔다', () => {
    renderForm();
    const field = screen.getByLabelText('종합의견').parentElement as HTMLElement;
    expect(within(field).getByText(/비워 두면 분석별 자동 의견이 그대로 보고서에 실립니다/)).toBeInTheDocument();
    expect(within(field).getByText(/스크리닝 한계 문구는 항상 자동 포함됩니다/)).toBeInTheDocument();
  });

  it('종합의견 칸은 초안이 8줄을 넘으면 초안 줄 수 + 2줄이다', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `${i + 1}번째 줄`).join('\n');
    renderForm([{ ...candidates[0], summary: ten }]);
    expect(screen.getByLabelText('종합의견')).toHaveAttribute('rows', '12');
  });

  it('종류가 둘이면 기본 제목은 종류 이름순으로 "·"로 잇는다(입력 순서와 무관)', () => {
    const slope: ReportCandidate = {
      analysis_id: 'an-slope', kind: 'slope', surface: 'floor', scanned_at: '2026-07-22',
      grade: 'repair', summary: '구배 의견', blocked_reason: null,
    };
    renderForm([slope, candidates[0]]);
    expect((screen.getByLabelText('보고서 제목') as HTMLInputElement).value)
      .toBe('101동 / 3층 / 거실 / P1 평활도·구배 분석 보고서');
  });
});

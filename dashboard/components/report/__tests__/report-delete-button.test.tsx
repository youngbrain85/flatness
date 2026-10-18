// 보고서 삭제(소프트). 다크 리스킨(Task 10, 아트보드 ReportDetail): 삭제는 위험 버튼(aria-expanded로 확인 상자
// 열림을 알린다), 확인 상자는 호출부 버튼 줄 아래 한 줄을 통째로 차지하는 오른쪽 정렬 error 상자(최대 520px).
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
  // 주면 삭제 요청이 이 프라미스가 풀릴 때까지 끝나지 않는다(진행 중 상태 확인용)
  gate: Promise<void> | null = null,
) {
  return {
    from: (table: string) => {
      if (table !== 'reports') throw new Error(`예상치 못한 테이블: ${table}`);
      return {
        update: (fields: unknown) => {
          spy(fields);
          // eq의 인자를 기록한다. 이걸 안 하면 .eq('id', report.id)가 사라져도 테스트가
          // 통과하고, 그 코드는 WHERE 없는 UPDATE가 되어 전체 보고서를 지운다.
          return {
            eq: async (col: string, val: unknown) => {
              eqSpy(col, val);
              if (gate) await gate;
              return { error: updateError };
            },
          };
        },
      };
    },
  };
}

afterEach(() => { vi.clearAllMocks(); });

describe('ReportDeleteButton', () => {
  it('첫 클릭에는 지우지 않고 확인 상자(error)를 펼친다 - 삭제·삭제 확인은 위험 버튼이다', () => {
    const spy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    const del = screen.getByRole('button', { name: '삭제' });
    expect(del.className).toContain('text-err');
    expect(del.className).not.toContain('bg-ink');
    expect(del).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(del);
    expect(del).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/삭제할까요/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    const confirm = screen.getByRole('button', { name: '삭제 확인' });
    expect(confirm.className).toContain('text-err');
    expect(confirm.className).not.toContain('bg-ink');
    expect(screen.getByRole('button', { name: '취소' }).className).not.toContain('bg-ink');
    expect(spy).not.toHaveBeenCalled();
  });

  it('확인 상자는 버튼 줄 아래 한 줄을 통째로 차지한다(order-last · basis-full · 오른쪽 정렬, 최대 520px)', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    const alert = screen.getByText(/삭제할까요/).closest('[data-alert]') as HTMLElement;
    const row = alert.parentElement as HTMLElement;
    for (const c of ['order-last', 'basis-full', 'justify-end']) expect(row.className).toContain(c);
    expect(alert.className).toContain('max-w-[520px]');
  });

  it('삭제를 한 번 더 누르면 확인 상자를 닫는다(아트보드 토글)', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(screen.queryByText(/삭제할까요/)).toBeNull();
    expect(screen.getByRole('button', { name: '삭제' })).toHaveAttribute('aria-expanded', 'false');
  });

  // 상세 화면: 보고 있던 보고서가 사라지므로 목록으로 이동한다
  it('redirectTo가 있으면 deleted_at을 채우고 그리로 이동한다', async () => {
    const spy = vi.fn();
    const eqSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy, eqSpy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} redirectTo="/sites/s1/reports" />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sites/s1/reports'));
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
    expect(screen.queryByText(/삭제할까요/)).toBeNull();
    expect(screen.getByRole('button', { name: '삭제' })).toHaveAttribute('aria-expanded', 'false');
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

// 변이 실험(Task 10 보강): 실패한 삭제가 이동·새로고침으로 새지 않는 것(redirectTo가 있을 때), 실패 뒤 버튼이 다시 풀리는 것,
// 진행 중 중복 클릭 잠금, 확인 문장·사유의 글자색은 위 단언만으로는 조용히 바뀌어도 통과했다.
describe('ReportDeleteButton 보강 (변이 실험으로 드러난 빈틈)', () => {
  it('삭제에 실패하면 redirectTo가 있어도 이동도 새로고침도 하지 않고 사유를 err 글자로 보이며 버튼을 다시 푼다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ message: '권한이 없습니다' }) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} redirectTo="/sites/s1/reports" />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));

    const reason = await screen.findByText('권한이 없습니다');
    expect(reason.className).toContain('text-err');
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '삭제 확인' })).toBeEnabled();
  });

  it('삭제하는 동안 삭제 확인·취소 버튼이 잠긴다(중복 삭제 방지)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, () => {}, () => {}, gate) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    expect(screen.getByRole('button', { name: '삭제 확인' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();

    release();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('확인 문장은 ink 글자로 읽힌다', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(screen.getByText(/삭제할까요/).className).toContain('text-ink');
  });

  // 리뷰 Important 3: 삭제 요청이 도는 동안 '삭제' 토글이 잠기지 않아, 그 사이 다시 누르면 확인 상자가 닫히고 곧 나올
  // 실패 사유가 닫힌 상자 안에 갇혀 보이지 않았다.
  it('삭제하는 동안 삭제 토글도 잠겨, 다시 눌러도 확인 상자가 닫히지 않는다', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, () => {}, () => {}, gate) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    const toggle = screen.getByRole('button', { name: '삭제' });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/삭제할까요/)).toBeInTheDocument();

    release();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('삭제 요청 중에 토글을 눌러도 실패 사유는 사라지지 않고, 실패하면 토글이 다시 풀린다', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ message: '권한이 없습니다' }, () => {}, () => {}, gate) as never,
    );
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} redirectTo="/sites/s1/reports" />);

    const toggle = screen.getByRole('button', { name: '삭제' });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));
    fireEvent.click(toggle); // 요청이 도는 중에 다시 누른 경우
    release();

    expect(await screen.findByText('권한이 없습니다')).toBeVisible();
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(pushMock).not.toHaveBeenCalled();
  });
});

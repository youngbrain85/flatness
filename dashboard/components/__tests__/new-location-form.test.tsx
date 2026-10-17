// 새 측정위치 폼: FormField 5개 + 주 버튼 '위치 추가'. insert 컬럼·trim·23505 안내는 기존 로직.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({})) }));

import { createClient } from '@/lib/supabase/client';
import { NewLocationForm } from '../new-location-form';
import { buttonClass } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';

function stubSupabase(
  result: { error: { code?: string; message: string } | null },
  insertSpy?: (row: unknown) => void,
) {
  return {
    from: (table: string) => {
      if (table === 'locations') return { insert: async (row: unknown) => { insertSpy?.(row); return result; } };
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('NewLocationForm', () => {
  it('폼 해부(아트보드 SiteDetail): 라벨 5개 + 입력칸(inputClass), 측정위치만 필수, 층 순서는 정수 입력', () => {
    render(<NewLocationForm siteId="s1" />);
    for (const label of ['동', '층', '층 순서(정수)', '공간', '측정위치']) {
      expect(screen.getByLabelText(label).className).toContain(inputClass);
    }
    expect(screen.getByLabelText('측정위치')).toBeRequired();
    expect(screen.getByLabelText('동')).not.toBeRequired();
    const order = screen.getByLabelText('층 순서(정수)');
    expect(order).toHaveAttribute('type', 'number');
    expect(order).toHaveAttribute('step', '1');
    expect(order.className).toContain('font-mono');
  });

  it('줄 배치: 네 칸은 flex 1 1 170px, 측정위치는 2 1 240px(좁으면 접힌다)', () => {
    render(<NewLocationForm siteId="s1" />);
    expect(screen.getByLabelText('동').closest('[class*="flex-[1_1_170px]"]')).not.toBeNull();
    expect(screen.getByLabelText('측정위치').closest('[class*="flex-[2_1_240px]"]')).not.toBeNull();
  });

  it('"위치 추가"는 주 버튼이고 plus 아이콘을 단다', () => {
    render(<NewLocationForm siteId="s1" />);
    const submit = screen.getByRole('button', { name: '위치 추가' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.className).toContain(buttonClass('primary'));
    expect(submit.querySelector('[data-icon="plus"]')).not.toBeNull();
  });

  it('등록에 성공하면 trim한 값으로 insert하고 router.refresh를 부른다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: null }, insertSpy) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('동'), { target: { value: ' 101동 ' } });
    fireEvent.change(screen.getByLabelText('층 순서(정수)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(insertSpy).toHaveBeenCalledWith({
      site_id: 's1', building: '101동', floor: '', floor_order: 3, room: '', name: '거실',
    });
  });

  it('동·층·공간·측정위치 네 칸을 모두 trim해서 insert한다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: null }, insertSpy) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('동'), { target: { value: ' 101동 ' } });
    fireEvent.change(screen.getByLabelText('층'), { target: { value: ' 3층 ' } });
    fireEvent.change(screen.getByLabelText('공간'), { target: { value: ' 301호 ' } });
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: ' 거실 ' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(insertSpy).toHaveBeenCalledWith({
      site_id: 's1', building: '101동', floor: '3층', floor_order: 0, room: '301호', name: '거실',
    });
  });

  it('층 순서를 비워 두면 0으로 넣는다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: null }, insertSpy) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('층 순서(정수)'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ floor_order: 0 }));
  });

  it('등록에 성공하면 입력칸을 처음 값으로 비운다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: null }) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('동'), { target: { value: '101동' } });
    fireEvent.change(screen.getByLabelText('층 순서(정수)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.getByLabelText('동')).toHaveValue('');
    expect(screen.getByLabelText('측정위치')).toHaveValue('');
    expect(screen.getByLabelText('층 순서(정수)')).toHaveValue(0);
  });

  it('제출은 브라우저 기본 동작(페이지 새로고침)을 막는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: null }) as never);
    render(<NewLocationForm siteId="s1" />);
    const form = screen.getByRole('button', { name: '위치 추가' }).closest('form') as HTMLFormElement;

    // fireEvent 는 이벤트가 preventDefault 되지 않았을 때만 true 를 돌려준다
    expect(fireEvent.submit(form)).toBe(false);
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('중복(23505)이면 안내 문구를 경고(role=alert)로 띄우고 refresh하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: { code: '23505', message: 'dup' } }) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    const notice = await screen.findByText('같은 동/층/공간에 동일한 측정위치가 이미 있습니다.');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice.className).toContain('text-err');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // insert 가 끝나는 때를 테스트가 정하는 스텁: 저장 중 상태(잠금·옛 안내)를 본다. finish 는 가장 최근 insert 를 끝낸다.
  function pendingSupabase(insertSpy?: (row: unknown) => void) {
    type Result = { error: { code?: string; message: string } | null };
    let finish: (r: Result) => void = () => {};
    const client = {
      from: () => ({
        insert: (row: unknown) => {
          insertSpy?.(row);
          return new Promise<Result>((resolve) => { finish = resolve; });
        },
      }),
    };
    return { client, finish: (r: Result) => finish(r) };
  }

  // 리뷰 Important 1: 오류 안내는 실패 분기에서만 설정돼서, 한 번 뜨면 다음 제출이 성공해도 남았다.
  it('중복(23505) 안내 뒤에 다음 제출이 성공하면 옛 안내를 지운다', async () => {
    vi.mocked(createClient)
      .mockReturnValueOnce(stubSupabase({ error: { code: '23505', message: 'dup' } }) as never)
      .mockReturnValueOnce(stubSupabase({ error: null }) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '안방' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('다음 제출이 시작되면 저장 결과를 기다리는 동안에도 옛 안내는 보이지 않는다', async () => {
    const pending = pendingSupabase();
    vi.mocked(createClient)
      .mockReturnValueOnce(stubSupabase({ error: { code: '23505', message: 'dup' } }) as never)
      .mockReturnValueOnce(pending.client as never);
    render(<NewLocationForm siteId="s1" />);
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    expect(screen.queryByRole('alert')).toBeNull();
    pending.finish({ error: null });
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  // 리뷰 Important 1(옛 동작): 제출 중 잠금이 없어 두 번 누르면 두 번째 insert 가 23505 로 돌아와
  // 성공 직후에 "중복" 안내가 떴다. 저장하는 동안 버튼을 잠그고 실패하면 다시 푼다(entry/new-site-card.tsx 와 같은 결).
  it('저장하는 동안 "위치 추가"를 잠그고, 실패하면 다시 푼다', async () => {
    const pending = pendingSupabase();
    vi.mocked(createClient).mockReturnValueOnce(pending.client as never);
    render(<NewLocationForm siteId="s1" />);
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    const submit = screen.getByRole('button', { name: '위치 추가' });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    expect(submit).toBeDisabled();

    pending.finish({ error: { message: '연결 실패' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('연결 실패');
    expect(submit).toBeEnabled();
  });

  it('저장이 성공해도 잠금은 풀려, 이 폼에서 다음 위치를 이어서 넣을 수 있다', async () => {
    const pending = pendingSupabase();
    vi.mocked(createClient).mockReturnValueOnce(pending.client as never);
    render(<NewLocationForm siteId="s1" />);
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    const submit = screen.getByRole('button', { name: '위치 추가' });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();

    pending.finish({ error: null });

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(submit).toBeEnabled());
  });

  it('저장 중에 다시 제출해도(버튼을 거치지 않는 제출 포함) insert는 한 번만 보낸다', async () => {
    const insertSpy = vi.fn();
    const pending = pendingSupabase(insertSpy);
    vi.mocked(createClient).mockReturnValue(pending.client as never);
    render(<NewLocationForm siteId="s1" />);
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    const form = screen.getByRole('button', { name: '위치 추가' }).closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(insertSpy).toHaveBeenCalledTimes(1);
    pending.finish({ error: null });
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  // 리뷰 Important 2: WebKit 은 inputmode="numeric"이면 빼기 키가 없는 숫자 키패드를 띄워 iPhone 에서
  // 음수 층 순서(지하)를 칠 수 없다. floor_order 는 제약 없는 정수고, 아트보드·옛 입력에도 inputmode 가 없다.
  it('층 순서 입력에는 inputmode를 달지 않는다(음수 층을 칠 수 있어야 한다)', () => {
    render(<NewLocationForm siteId="s1" />);
    expect(screen.getByLabelText('층 순서(정수)')).not.toHaveAttribute('inputmode');
  });

  it('음수 층 순서(지하)도 그대로 insert한다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: null }, insertSpy) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('층 순서(정수)'), { target: { value: '-1' } });
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '주차장' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ floor_order: -1 }));
  });
});

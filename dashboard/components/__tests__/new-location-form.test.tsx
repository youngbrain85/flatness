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
});

// 새 측정위치 폼: FormField 5개 + primary '위치 추가'. insert 컬럼·trim·23505 안내는 기존 로직.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({})) }));

import { createClient } from '@/lib/supabase/client';
import { NewLocationForm } from '../new-location-form';

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
  it('폼 해부: 라벨 5개(700) + inputClass + primary "위치 추가"(plus 아이콘)', () => {
    const { container } = render(<NewLocationForm siteId="s1" />);
    for (const label of ['동', '층', '층 순서(정수)', '공간', '측정위치']) {
      expect(screen.getByText(label).className).toContain('font-bold');
      expect(screen.getByLabelText(label).className).toContain('border-cs-input-border');
    }
    const submit = screen.getByRole('button', { name: '위치 추가' });
    expect(submit.className).toContain('bg-cs-link');
    expect(container.querySelector('[data-icon="plus"]')).toBeInTheDocument();
  });

  it('등록에 성공하면 trim한 값으로 insert하고 router.refresh를 부른다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: null }, insertSpy) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('동'), { target: { value: ' 101동 ' } });
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(insertSpy).toHaveBeenCalledWith({
      site_id: 's1', building: '101동', floor: '', floor_order: 0, room: '', name: '거실',
    });
  });

  it('중복(23505)이면 안내 문구를 cs-error로 띄우고 refresh하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: { code: '23505', message: 'dup' } }) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    const notice = await screen.findByText('같은 동/층/공간에 동일한 측정위치가 이미 있습니다.');
    expect(notice.className).toContain('text-cs-error');
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

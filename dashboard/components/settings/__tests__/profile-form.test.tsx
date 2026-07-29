import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const fromMock = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: fromMock }) }));

import { ProfileForm } from '../profile-form';

describe('ProfileForm', () => {
  it('공백만 입력하면 저장 요청 없이 안내 메시지를 보여준다', async () => {
    fromMock.mockClear();
    render(<ProfileForm userId="u1" initialName="홍길동" />);
    fireEvent.change(screen.getByLabelText('표시 이름'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('표시 이름을 입력하세요')).toBeInTheDocument();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('앞뒤 공백이 있는 이름을 저장하면 trim된 값으로 입력창도 동기화된다', async () => {
    fromMock.mockClear();
    const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
    fromMock.mockReturnValue({ update });
    render(<ProfileForm userId="u1" initialName="홍길동" />);
    const input = screen.getByLabelText('표시 이름') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  새이름  ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장되었습니다')).toBeInTheDocument();
    expect(update).toHaveBeenCalledWith({ display_name: '새이름' });
    expect(input.value).toBe('새이름');
  });
});

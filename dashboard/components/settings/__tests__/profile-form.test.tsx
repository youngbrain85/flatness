import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const fromMock = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: fromMock }) }));

import { ProfileForm } from '../profile-form';
import { inputClass } from '@/components/ui/form';

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

  // 아트보드 Settings: 이 화면의 주 버튼은 U 저장 하나 - 프로필 저장은 보조. 결과 문구는 role=status 13px muted.
  it('저장은 보조 버튼(ink 채움 없음)이고 입력은 inputClass, 결과 문구는 role=status 13px muted다', async () => {
    fromMock.mockClear();
    render(<ProfileForm userId="u1" initialName="홍길동" />);
    const btn = screen.getByRole('button', { name: '저장' });
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn.className).not.toContain('bg-ink');
    expect(screen.getByLabelText('표시 이름').className).toBe(inputClass);
    fireEvent.change(screen.getByLabelText('표시 이름'), { target: { value: ' ' } });
    fireEvent.click(btn);
    const msg = await screen.findByText('표시 이름을 입력하세요');
    expect(msg).toHaveAttribute('role', 'status');
    expect(msg.className).toContain('text-muted');
    expect(msg.className).toContain('text-[13px]');
  });
});

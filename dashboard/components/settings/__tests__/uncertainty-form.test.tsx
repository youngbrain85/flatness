import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const fromMock = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: fromMock }) }));

import { UncertaintyForm } from '../uncertainty-form';

describe('UncertaintyForm', () => {
  it('상한(100mm)을 초과하면 저장 요청 없이 안내 메시지를 보여준다', async () => {
    fromMock.mockClear();
    render(<UncertaintyForm initial={{ floor: 5, wall: 8 }} />);
    fireEvent.change(screen.getByLabelText('바닥 U(mm)'), { target: { value: '999999' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('U는 100mm 이하여야 합니다')).toBeInTheDocument();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('초기값을 문자열 그대로 그리고(5 -> "5"), 입력은 mono·cs 보더, 저장은 primary 버튼(파랑 채움)이다', () => {
    fromMock.mockClear();
    render(<UncertaintyForm initial={{ floor: 5, wall: 8 }} />);
    const floor = screen.getByLabelText('바닥 U(mm)') as HTMLInputElement;
    const wall = screen.getByLabelText('벽면 U(mm)') as HTMLInputElement;
    expect(floor.value).toBe('5'); // String(initial.floor) - 소수점 보정 없음(무변경)
    expect(wall.value).toBe('8');
    expect(floor.className).toContain('border-cs-input-border');
    expect(floor.className).toContain('font-mono');
    const btn = screen.getByRole('button', { name: '저장' });
    expect(btn).toHaveAttribute('type', 'submit');
    // 스펙 §6 Settings: U 저장이 이 뷰의 유일한 primary
    expect(btn.className).toContain('bg-cs-link');
  });
});

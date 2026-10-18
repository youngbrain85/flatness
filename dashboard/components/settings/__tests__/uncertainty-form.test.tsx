import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const fromMock = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: fromMock }) }));

import { UncertaintyForm } from '../uncertainty-form';
import { inputClass } from '@/components/ui/form';

describe('UncertaintyForm', () => {
  it('상한(100mm)을 초과하면 저장 요청 없이 안내 메시지를 보여준다', async () => {
    fromMock.mockClear();
    render(<UncertaintyForm initial={{ floor: 5, wall: 8 }} />);
    fireEvent.change(screen.getByLabelText('바닥 U(mm)'), { target: { value: '999999' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('U는 100mm 이하여야 합니다')).toBeInTheDocument();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('초기값을 문자열 그대로 그리고(5 -> "5"), 입력은 inputClass + mono, 저장은 이 화면의 주 버튼이다', () => {
    fromMock.mockClear();
    render(<UncertaintyForm initial={{ floor: 5, wall: 8 }} />);
    const floor = screen.getByLabelText('바닥 U(mm)') as HTMLInputElement;
    const wall = screen.getByLabelText('벽면 U(mm)') as HTMLInputElement;
    expect(floor.value).toBe('5'); // String(initial.floor) - 소수점 보정 없음(무변경)
    expect(wall.value).toBe('8');
    for (const input of [floor, wall]) {
      expect(input.className).toContain(inputClass);
      expect(input.className).toContain('font-mono');
      expect(input.className).toContain('tabular-nums');
    }
    const btn = screen.getByRole('button', { name: '저장' });
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn.className).toContain('bg-ink');
  });

  it('결과 문구는 role=status 13px muted로 버튼 옆에 뜬다', async () => {
    fromMock.mockClear();
    render(<UncertaintyForm initial={{ floor: 5, wall: 8 }} />);
    fireEvent.change(screen.getByLabelText('벽면 U(mm)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const msg = await screen.findByText('U는 0보다 큰 수치여야 합니다');
    expect(msg).toHaveAttribute('role', 'status');
    expect(msg.className).toContain('text-muted');
    expect(fromMock).not.toHaveBeenCalled();
  });
});

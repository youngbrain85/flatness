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
});

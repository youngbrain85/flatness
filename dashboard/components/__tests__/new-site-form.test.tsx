import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({})) }));

import { createClient } from '@/lib/supabase/client';
import { NewSiteForm } from '../new-site-form';

function stubSupabase(result: { data: { id: string } | null; error: { message: string } | null }) {
  return {
    from: (table: string) => {
      if (table === 'sites') {
        return { insert: () => ({ select: () => ({ single: async () => result }) }) };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('NewSiteForm', () => {
  // 회귀 방지: push 직후 refresh는 진행 중이던 이동을 취소한다(로그인 화면에서 실제로
  // 재현된 결함). 이동 대상인 sites/[id]는 force-dynamic이고 동적 페이지의 클라이언트
  // 캐시 staleTime 기본값은 0초라 push만으로 항상 서버에서 새로 받아온다.
  it('현장 등록에 성공하면 상세로 push만 하고 refresh는 부르지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ data: { id: 's9' }, error: null }) as never);
    render(<NewSiteForm />);

    fireEvent.change(screen.getByLabelText('현장명 (필수)'), { target: { value: '한밭대 본관' } });
    fireEvent.click(screen.getByRole('button', { name: '현장 등록' }));

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sites/s9'));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('저장에 실패하면 이동하지 않고 안내를 띄운다', async () => {
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ data: null, error: { message: '중복된 현장명입니다' } }) as never,
    );
    render(<NewSiteForm />);

    fireEvent.change(screen.getByLabelText('현장명 (필수)'), { target: { value: '중복' } });
    fireEvent.click(screen.getByRole('button', { name: '현장 등록' }));

    expect(await screen.findByText(/중복된 현장명입니다/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

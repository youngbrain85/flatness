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

    const notice = await screen.findByText(/중복된 현장명입니다/);
    expect(notice).toBeInTheDocument();
    expect(notice.className).toContain('text-cs-error');
    expect(pushMock).not.toHaveBeenCalled();
  });

  // Cloudscape 재스킨(T4), 아트보드 SiteNew: 필드 3개는 컨테이너(<section>) 안 FormField,
  // 제출 버튼은 컨테이너 **밖** 우측 하단의 primary. 동작 단언(위 두 it)은 그대로다.
  it('폼 해부: 컨테이너 안 FormField 3개 + 컨테이너 밖 primary "현장 등록"', () => {
    const { container } = render(<NewSiteForm />);
    const section = container.querySelector('section');
    expect(section?.className).toContain('shadow-cs-container');
    expect(screen.getByText('현장명 (필수)').className).toContain('font-bold');
    expect(screen.getByLabelText('현장명 (필수)').className).toContain('border-cs-input-border');
    expect(screen.getByLabelText('주소').className).toContain('border-cs-input-border');
    expect(screen.getByLabelText('메모').className).toContain('min-h-24');
    const submit = screen.getByRole('button', { name: '현장 등록' });
    expect(submit.className).toContain('bg-cs-link');
    expect(section?.contains(submit)).toBe(false);
  });
});

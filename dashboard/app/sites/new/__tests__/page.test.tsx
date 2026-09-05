// 새 현장 페이지: PAGE_MAIN 본문 + 브레드크럼(현장 › 새 현장 등록, 마지막은 비링크) + h1 + 폼.
// 동기 서버 컴포넌트라 render()로 그릴 수 있다(폼은 클라이언트 컴포넌트 - 라우터만 mock).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({})) }));

import NewSitePage from '../page';
import { PAGE_MAIN } from '@/components/ui/page';

describe('NewSitePage (Cloudscape)', () => {
  it('PAGE_MAIN 본문 + 브레드크럼(현장 › 새 현장 등록) + h1 + 폼', () => {
    render(<NewSitePage />);
    expect(screen.getByRole('main').className).toBe(PAGE_MAIN);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('새 현장 등록');
    expect(screen.getByRole('link', { name: '현장' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: '새 현장 등록' })).toBeNull();
    expect(screen.getByRole('button', { name: '현장 등록' })).toBeInTheDocument();
  });
});

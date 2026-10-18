// 로그인 화면 구조(스펙 §5 01행, 아트보드 Login.dc.html): 상표만 있는 헤더(LoginHeader) 아래 도면 격자 본문이
// 남은 높이를 채우고, 그 가운데 400px 카드(surface + line-2 + 12px). 카드 머리 = 페이지 h1 + 아래 1px line,
// 본문에 LoginForm. LoginPage는 데이터가 없는 동기 서버 컴포넌트라 render()로 그린다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword: vi.fn() } }),
}));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfile: vi.fn() }));
// 헤더 내부는 Task 2 몫이다 - 그렸는지만 본다
const { loginHeader } = vi.hoisted(() => ({ loginHeader: vi.fn(() => null) }));
vi.mock('@/components/shell/login-header', () => ({ LoginHeader: loginHeader }));

import LoginPage from '../page';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';

beforeEach(() => { loginHeader.mockClear(); });

describe('LoginPage', () => {
  it('상표만 있는 로그인 헤더를 한 번 그린다(계정 메뉴 없음)', () => {
    render(<LoginPage />);
    expect(loginHeader).toHaveBeenCalledTimes(1);
  });

  it('본문은 도면 격자(MAIN_BG) <main>이 헤더(64px)를 뺀 높이를 채우고, 그 안 PAGE_MAIN이 카드를 가운데 둔다', () => {
    render(<LoginPage />);
    const main = screen.getByRole('main');
    expect(main.className).toContain(MAIN_BG);
    expect(main.className).toContain('min-h-[calc(100vh-64px)]');
    const body = main.firstElementChild as HTMLElement;
    expect(body.className).toContain(PAGE_MAIN);
    for (const c of ['flex-1', 'items-center', 'justify-center']) expect(body.className).toContain(c);
  });

  it('카드: 400px surface 카드(line-2 테두리, 12px), 머리 h1 + 아래 1px line, 본문에 이메일·비밀번호·로그인', () => {
    render(<LoginPage />);
    const card = screen.getByRole('region', { name: '평활도 분석 대시보드' });
    for (const c of ['max-w-[400px]', 'bg-surface', 'border-line-2', 'rounded-card']) {
      expect(card.className).toContain(c);
    }
    const h1 = screen.getByRole('heading', { level: 1, name: '평활도 분석 대시보드' });
    expect(h1.className).toContain('font-heading');
    expect(h1.parentElement?.className).toContain('border-b');
    expect(h1.parentElement?.className).toContain('border-line');
    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument();
  });
});

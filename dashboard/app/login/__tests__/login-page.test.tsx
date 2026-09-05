// 로그인 화면 구조(스펙 §5·§6 Login, 아트보드 Login.dc.html): 상단 바(44px) 아래 남은 높이의
// 중앙에 400px 흰 카드(그림자·16px 라운드), 카드 헤더 = 페이지 h1(24px/30px 700) + 1px 구분선,
// 본문 padding 20px 안에 LoginForm. LoginPage는 데이터가 없는 동기 서버 컴포넌트라 render()로
// 그릴 수 있다(async 페이지의 엘리먼트 트리 탐색 패턴은 필요 없다). 사이드 내비 생략은
// ConsoleShell(T1) 테스트가 맡는다.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword: vi.fn() } }),
}));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfile: vi.fn() }));

import LoginPage from '../page';

describe('LoginPage', () => {
  it('main은 상단 바 44px을 뺀 높이의 중앙에 카드를 놓는다', () => {
    render(<LoginPage />);
    const main = screen.getByRole('main');
    for (const c of ['min-h-[calc(100vh-44px)]', 'items-center', 'justify-center', 'px-4']) {
      expect(main.className).toContain(c);
    }
    expect(main.className).not.toMatch(/zinc-/);
  });

  it('카드: 400px 컨테이너(그림자·16px 라운드), 헤더 h1 24px 700 + cs-divider 구분선, 본문 p-5', () => {
    const { container } = render(<LoginPage />);
    const card = container.querySelector('section') as HTMLElement;
    expect(card).not.toBeNull();
    for (const c of ['shadow-cs-container', 'rounded-cs-container', 'max-w-[400px]']) {
      expect(card.className).toContain(c);
    }
    const h1 = screen.getByRole('heading', { level: 1, name: '평활도 분석 대시보드' });
    expect(h1.className).toContain('text-2xl');
    expect(h1.className).toContain('font-bold');
    expect(h1.parentElement?.className).toContain('border-b');
    expect(h1.parentElement?.className).toContain('border-cs-divider');
    const form = screen.getByRole('button', { name: '로그인' }).closest('form');
    expect(form?.parentElement?.className).toContain('p-5');
  });

  it('카드 안에 이메일·비밀번호 입력과 로그인 버튼이 있다', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument();
  });
});

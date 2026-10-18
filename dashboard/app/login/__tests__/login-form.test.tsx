import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
const refresh = vi.fn();
const signInWithPassword = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfile: vi.fn().mockResolvedValue(undefined) }));

import { LoginForm } from '../login-form';
import { inputClass } from '@/components/ui/form';

// jsdom의 window.location은 교체 불가 프로퍼티라 defineProperty로 통째로 갈아끼운다.
const realLocation = window.location;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  signInWithPassword.mockReset();
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...realLocation, assign },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: realLocation,
    writable: true,
    configurable: true,
  });
});

describe('LoginForm', () => {
  it('이메일·비밀번호 입력과 로그인 버튼을 렌더한다', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument();
  });

  // 회귀 방지: 예전 구현은 router.push('/') 직후 router.refresh()를 불렀는데,
  // refresh는 "현재 라우트"를 다시 렌더하므로 진행 중이던 이동을 취소해 버렸다.
  // 그 결과 레이아웃만 새 세션으로 갱신되고 URL은 /login에 머물러, 사용자에게는
  // 로그인 버튼이 비활성 상태로 멈춘 것처럼 보였다(배포 환경에서 홈 렌더가
  // 느려지자 재현). 로그인은 세션 쿠키가 바뀌는 경계이므로 전체 페이지 이동으로
  // 서버 컴포넌트를 확실히 다시 렌더시킨다.
  it('로그인에 성공하면 전체 페이지 이동으로 홈에 간다(라우터 push/refresh 경합 회피)', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('로그인에 실패하면 이동하지 않고 안내를 띄운다', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } });
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByText(/로그인에 실패했습니다/)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    // 재시도할 수 있어야 하므로 버튼이 다시 활성화된다
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled();
  });
});

// 다크 리스킨(Task 11, 아트보드 Login): 진짜 type=email/password 입력(스펙 §5 01행), 전폭 주 버튼,
// 13px muted 안내. 동작 단언은 위 블록이 그대로 지킨다.
describe('LoginForm 화면 (아트보드 Login)', () => {
  it('이메일·비밀번호는 진짜 type=email/password 입력(inputClass)이고 자동 완성 힌트를 단다', () => {
    render(<LoginForm />);
    const email = screen.getByLabelText('이메일');
    const password = screen.getByLabelText('비밀번호');
    expect(email).toHaveAttribute('type', 'email');
    expect(password).toHaveAttribute('type', 'password');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(email.className).toBe(inputClass);
    expect(password.className).toBe(inputClass);
  });

  it('로그인 버튼은 이 화면의 유일한 주 버튼이고 전폭이다', () => {
    render(<LoginForm />);
    const button = screen.getByRole('button', { name: '로그인' });
    expect(button.className).toContain('bg-ink');
    expect(button.className).toContain('w-full');
    expect(button).toHaveAttribute('type', 'submit');
    expect(screen.getAllByRole('button').filter((b) => b.className.includes('bg-ink'))).toHaveLength(1);
  });

  it('제출 중에는 버튼이 비활성(주 채움 없음)으로 바뀐다', async () => {
    // 끝나지 않는 로그인 요청으로 busy 상태를 고정한다
    signInWithPassword.mockReturnValue(new Promise(() => {}));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    const button = screen.getByRole('button', { name: '로그인' });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button.className).not.toContain('bg-ink');
  });

  it('실패 안내는 error Alert(role="alert", data-alert="error")로 뜬다', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-alert', 'error');
    expect(alert.textContent).toContain('로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.');
  });

  it('안내 문구는 13px muted이고 문장은 그대로다', () => {
    render(<LoginForm />);
    const hint = screen.getByText('계정은 관리자가 Supabase 대시보드(Authentication)에서 생성합니다.');
    expect(hint.className).toContain('text-[13px]');
    expect(hint.className).toContain('text-muted');
  });
});

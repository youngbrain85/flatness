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
import { ensureProfile } from '@/lib/auth/ensure-profile';

// jsdom의 window.location은 교체 불가 프로퍼티라 defineProperty로 통째로 갈아끼운다.
const realLocation = window.location;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  signInWithPassword.mockReset();
  // 보강(아래 describe)이 ensureProfile 호출을 단언하므로 매 테스트 처음 상태(성공)로 되돌린다
  vi.mocked(ensureProfile).mockReset();
  vi.mocked(ensureProfile).mockResolvedValue(undefined as never);
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

// 변이 실험(Task 11 보강): 위 단언만으로는 로그인 흐름의 인자·순서·실패 판정·제출 기본 동작이 조용히 틀어져도
// 통과했다. signInWithPassword 인자, ensureProfile 호출·인자·대기·실패 삼킴, 오류 없는 "사용자 없음" 응답,
// 제출 기본 동작 차단, 이전 실패 안내 지우기, 필수 입력을 아래가 막는다.
describe('LoginForm 보강 (변이 실험으로 드러난 빈틈)', () => {
  function fillAndSubmit(email = 'a@b.com', password = 'pw') {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: email } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));
  }

  it('입력한 이메일·비밀번호 그대로 signInWithPassword를 한 번 부른다', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    fillAndSubmit('a@b.com', 'pw');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw' });
  });

  it('로그인한 사용자로 프로필을 보장(ensureProfile)하고, 그 일이 끝난 다음에야 홈으로 이동한다', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    // 전체 이동은 진행 중인 요청을 끊는다 - 끝나지 않는 약속으로 이동이 프로필 작업을 기다리는지 고정한다
    let finish: () => void = () => {};
    vi.mocked(ensureProfile).mockReturnValue(
      new Promise<never>((resolve) => { finish = () => resolve(undefined as never); }),
    );
    fillAndSubmit();
    await waitFor(() => expect(ensureProfile).toHaveBeenCalledTimes(1));
    expect(ensureProfile).toHaveBeenCalledWith(expect.objectContaining({ auth: { signInWithPassword } }), { id: 'u1' });
    expect(assign).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });

  it('프로필 생성이 실패해도 로그인은 막지 않고 홈으로 간다(설정 화면 저장 때 다시 시도)', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    vi.mocked(ensureProfile).mockRejectedValue(new Error('profiles insert 실패'));
    fillAndSubmit();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each<[string, unknown]>([
    ['오류도 사용자도 없을 때', { data: { user: null }, error: null }],
    ['오류가 있고 사용자는 없을 때', { data: { user: null }, error: { message: 'bad' } }],
    ['오류가 있으면 사용자가 함께 와도', { data: { user: { id: 'u1' } }, error: { message: 'bad' } }],
  ])('로그인 응답이 %s 실패로 보고, 프로필 생성도 이동도 하지 않는다', async (_label, result) => {
    signInWithPassword.mockResolvedValue(result);
    fillAndSubmit('a@b.com', 'wrong');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-alert', 'error');
    expect(ensureProfile).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled();
  });

  it('제출은 브라우저 기본 전송(GET)을 막는다 - 막지 않으면 비밀번호가 주소창에 실린다', () => {
    signInWithPassword.mockReturnValue(new Promise(() => {})); // 끝나지 않는 요청
    render(<LoginForm />);
    const form = screen.getByRole('button', { name: '로그인' }).closest('form') as HTMLFormElement;
    // fireEvent는 기본 동작이 막혔을 때 false 를 돌려준다
    expect(fireEvent.submit(form)).toBe(false);
  });

  it('다시 시도하면 지난 실패 안내를 지우고 시작한다', async () => {
    signInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad' } });
    fillAndSubmit('a@b.com', 'wrong');
    await screen.findByRole('alert');
    signInWithPassword.mockReturnValueOnce(new Promise(() => {})); // 두 번째 시도는 끝나지 않는다
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('이메일·비밀번호는 비워 두고 제출할 수 없다(required)', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText('이메일')).toBeRequired();
    expect(screen.getByLabelText('비밀번호')).toBeRequired();
  });
});

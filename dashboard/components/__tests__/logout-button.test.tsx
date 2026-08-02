import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const signOut = vi.fn().mockResolvedValue({ error: null });
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut } }) }));

import { LogoutButton } from '../logout-button';

// jsdom의 window.location은 교체 불가 프로퍼티라 defineProperty로 통째로 갈아끼운다.
const realLocation = window.location;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...realLocation, assign }, writable: true, configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: realLocation, writable: true, configurable: true,
  });
});

describe('LogoutButton', () => {
  // 로그아웃은 로그인과 같은 인증 경계다. router.push + router.refresh 조합은 refresh가
  // 진행 중이던 이동을 취소해 화면이 멈출 수 있고(로그인에서 실제로 재현됨), 소프트
  // 이동은 클라이언트 컴포넌트의 React 상태에 남은 인증 후 데이터도 그대로 둔다.
  // 전체 페이지 이동이면 두 문제가 함께 사라진다.
  it('로그아웃하면 전체 페이지 이동으로 로그인 화면에 간다', async () => {
    render(<LogoutButton />);
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('세션 정리가 끝난 뒤에 이동한다', async () => {
    let signOutDone = false;
    signOut.mockImplementation(async () => { signOutDone = true; return { error: null }; });
    render(<LogoutButton />);
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    expect(signOutDone).toBe(true);
  });
});

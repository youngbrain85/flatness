'use client';
import type { ComponentProps } from 'react';
import { createClient } from '@/lib/supabase/client';

// 계정 메뉴의 항목(role="menuitem")으로 쓰인다(Task 2). role·tabIndex·data-* 같은 단추 속성과 모양은
// 호출자가 넘기고, 동작(세션 정리 후 전체 페이지 이동)과 글자는 이 컴포넌트가 고정한다
// (onClick·children·type 은 받지 않는다).
export function LogoutButton({ className = 'text-sm text-ink-2 hover:text-ink', ...rest }:
  Omit<ComponentProps<'button'>, 'onClick' | 'children' | 'type'>) {
  async function onClick() {
    await createClient().auth.signOut();
    // 로그인과 같은 인증 경계이므로 전체 페이지 이동을 쓴다. router.push('/login')
    // 다음에 router.refresh()를 부르면 refresh가 "현재 라우트"를 다시 렌더하면서
    // 진행 중이던 이동을 취소한다(로그인 화면에서 실제로 재현된 결함). 게다가 소프트
    // 이동은 클라이언트 컴포넌트의 React 상태에 남은 인증 후 데이터를 그대로 두므로,
    // 로그아웃에는 전체 이동이 맞다.
    window.location.assign('/login');
  }
  return <button type="button" {...rest} onClick={onClick} className={className}>로그아웃</button>;
}

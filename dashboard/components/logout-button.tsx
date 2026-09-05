'use client';
import { createClient } from '@/lib/supabase/client';

// 사이드 내비 항목으로도, 단독 버튼으로도 쓰이므로 스타일은 호출자가 준다.
export function LogoutButton({ className = 'text-sm text-cs-nav-text hover:text-cs-text' }: { className?: string }) {
  async function onClick() {
    await createClient().auth.signOut();
    // 로그인과 같은 인증 경계이므로 전체 페이지 이동을 쓴다. router.push('/login')
    // 다음에 router.refresh()를 부르면 refresh가 "현재 라우트"를 다시 렌더하면서
    // 진행 중이던 이동을 취소한다(로그인 화면에서 실제로 재현된 결함). 게다가 소프트
    // 이동은 클라이언트 컴포넌트의 React 상태에 남은 인증 후 데이터를 그대로 두므로,
    // 로그아웃에는 전체 이동이 맞다.
    window.location.assign('/login');
  }
  return <button type="button" onClick={onClick} className={className}>로그아웃</button>;
}

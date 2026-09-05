'use client';
// 셸 분기: /login만 사이드 내비 없이 상단 바 + 본문(스펙 §5). 라우트 그룹 이동 대신
// pathname으로 가르므로 서버 컴포넌트(TopNav)는 슬롯으로 받는다.
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function ConsoleShell({ topNav, sideNav, children }: {
  topNav: ReactNode; sideNav: ReactNode; children: ReactNode;
}) {
  const bare = usePathname() === '/login';
  return (
    <div className="flex min-h-screen flex-col">
      {topNav}
      {bare ? (
        <div className="min-w-0 flex-1">{children}</div>
      ) : (
        // 모바일은 세로 스택(스트립 위 / 본문 아래), md 이상만 가로(aside + 본문).
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {sideNav}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      )}
    </div>
  );
}

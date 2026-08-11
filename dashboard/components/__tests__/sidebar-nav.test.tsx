// SidebarNav 활성 판정(스모크): pathname prefix 매칭이 4개 메뉴에 올바르게
// 배선되는지만 확인한다. usePathname을 mock해 라우팅 없이 순수 렌더 결과를 본다.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const usePathnameMock = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => usePathnameMock() }));

import { SidebarNav } from '../sidebar-nav';

// 활성 메뉴는 border-zinc-900(데스크톱) / bg-zinc-100(공통)로 표시된다.
// 비활성 메뉴는 border-transparent다. 클래스 문자열로 활성 여부를 판별한다.
function isActive(link: HTMLElement) {
  return link.className.includes('border-zinc-900');
}

describe('SidebarNav 활성 판정 (pathname prefix)', () => {
  const cases: Array<[string, string]> = [
    ['/', '현장'],
    ['/sites/abc-123', '현장'],
    ['/scans/1', '현장'],
    ['/registrations/new', '현장'],
    ['/reports', '보고서'],
    ['/reports/xyz', '보고서'],
    ['/upload', '업로드'],
    ['/settings', '설정'],
  ];

  it.each(cases)('pathname=%s 이면 "%s" 메뉴만 활성이다', (pathname, expectedLabel) => {
    usePathnameMock.mockReturnValue(pathname);
    render(<SidebarNav />);

    const links = screen.getAllByRole('link');
    const activeLabels = links.filter(isActive).map((l) => l.textContent);

    expect(activeLabels).toEqual([expectedLabel]);
  });

  it('무관한 경로(/login)는 어떤 메뉴도 활성화하지 않는다', () => {
    usePathnameMock.mockReturnValue('/login');
    render(<SidebarNav />);

    const links = screen.getAllByRole('link');
    expect(links.filter(isActive)).toHaveLength(0);
  });

  it('variant="mobile"도 동일한 prefix 판정을 공유한다(가로 나열 스모크)', () => {
    usePathnameMock.mockReturnValue('/reports/1');
    render(<SidebarNav variant="mobile" />);

    const active = screen.getByRole('link', { name: '보고서' });
    expect(active.className).toContain('bg-zinc-100');
    const inactive = screen.getByRole('link', { name: '현장' });
    expect(inactive.className).not.toContain('bg-zinc-100');
  });
});

// SideNav 활성 판정: pathname prefix 매칭이 aria-current="page"로 드러나는지 본다.
// 데스크톱 aside와 모바일 스트립이 같은 링크를 두 번 그리므로 라벨 집합으로 비교한다.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const usePathnameMock = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => usePathnameMock() }));
vi.mock('@/components/logout-button', () => ({ LogoutButton: () => <button>로그아웃</button> }));

import { SideNav } from '../side-nav';

function activeLabels() {
  return new Set(
    screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page').map((l) => l.textContent?.trim()),
  );
}

describe('SideNav 활성 판정 (pathname prefix)', () => {
  it.each<[string, string]>([
    ['/', '현장'],
    ['/sites/abc-123', '현장'],
    ['/scans/1', '현장'],
    ['/registrations/new', '현장'],
    ['/reports', '보고서'],
    ['/reports/xyz', '보고서'],
    ['/upload', '업로드'],
    ['/settings', '설정'],
  ])('pathname=%s 이면 "%s"만 활성이다', (pathname, expected) => {
    usePathnameMock.mockReturnValue(pathname);
    render(<SideNav />);
    expect(activeLabels()).toEqual(new Set([expected]));
  });

  it('무관한 경로(/login)는 어떤 메뉴도 활성화하지 않는다', () => {
    usePathnameMock.mockReturnValue('/login');
    render(<SideNav />);
    expect(activeLabels().size).toBe(0);
  });

  it('활성 항목은 cs-link 700, 비활성은 cs-nav-text로 그린다', () => {
    usePathnameMock.mockReturnValue('/reports');
    render(<SideNav />);
    const [active] = screen.getAllByRole('link', { name: '보고서' });
    const [inactive] = screen.getAllByRole('link', { name: '현장' });
    expect(active.className).toContain('text-cs-link');
    expect(active.className).toContain('font-bold');
    expect(inactive.className).toContain('text-cs-nav-text');
  });

  it('두 그룹(현장·보고서·업로드 / 설정·로그아웃)과 헤더 문구를 그린다', () => {
    usePathnameMock.mockReturnValue('/');
    render(<SideNav />);
    expect(screen.getByText('평활도 분석 콘솔')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '설정' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
  });
});

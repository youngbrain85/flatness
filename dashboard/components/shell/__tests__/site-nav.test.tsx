// 현장 메뉴 활성 판정(스펙 §4.2 셸 열, §4.3): 순수 함수 siteNavActive 와, 그 결과가 링크 하나의
// aria-current="page" 로만 드러나는지 본다(스타일이 아니라 의미 속성으로 단언한다).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const usePathnameMock = vi.fn<() => string>();
vi.mock('next/navigation', () => ({ usePathname: () => usePathnameMock() }));

import { SiteNav, siteNavActive, type SiteNavKey } from '../site-nav';

describe('siteNavActive', () => {
  it.each<[string, SiteNavKey]>([
    ['/sites/s1', 'dashboard'],
    ['/sites/s1/locations', 'locations'],
    ['/sites/s1/upload', 'locations'],
    ['/scans/sc1', 'locations'],
    ['/registrations/new', 'locations'],
    ['/registrations/r1', 'locations'],
    ['/sites/s1/reports', 'reports'],
    ['/reports/new', 'reports'],
    ['/reports/r1', 'reports'],
  ])('%s → %s', (pathname, expected) => {
    expect(siteNavActive(pathname, 's1')).toBe(expected);
  });

  it.each([
    ['/', '진입 페이지'],
    ['/settings', '설정'],
    ['/login', '로그인'],
    ['/sites/s2', '다른 현장의 대시보드'],
    ['/sites/s2/locations', '다른 현장의 측정위치'],
    ['/sites/s10', 'id 앞부분만 같은 다른 현장'],
    ['/sites/s1/locationsx', '탭 이름 뒤에 글자가 붙은 경로'],
    ['/reports', '옛 전체 보고서 목록(리다이렉트)'],
  ])('%s(%s)는 어느 탭도 아니다', (pathname) => {
    expect(siteNavActive(pathname, 's1')).toBeNull();
  });
});

describe('SiteNav', () => {
  const current = () => screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');

  it('세 링크가 그 현장의 대시보드·측정위치·보고서를 가리킨다', () => {
    usePathnameMock.mockReturnValue('/sites/s1');
    render(<SiteNav siteId="s1" />);
    const nav = screen.getByRole('navigation', { name: '현장 메뉴' });
    expect(nav).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['대시보드', '/sites/s1'],
      ['측정위치', '/sites/s1/locations'],
      ['보고서', '/sites/s1/reports'],
    ]);
  });

  it.each<[string, string]>([
    ['/sites/s1', '대시보드'],
    ['/sites/s1/upload', '측정위치'],
    ['/scans/sc1', '측정위치'],
    ['/reports/new', '보고서'],
  ])('pathname=%s 이면 "%s" 하나만 aria-current="page"', (pathname, label) => {
    usePathnameMock.mockReturnValue(pathname);
    render(<SiteNav siteId="s1" />);
    expect(current().map((a) => a.textContent)).toEqual([label]);
  });

  it('현장 밖 화면(/settings)에서는 활성 탭이 없다', () => {
    usePathnameMock.mockReturnValue('/settings');
    render(<SiteNav siteId="s1" />);
    expect(current()).toEqual([]);
  });
});

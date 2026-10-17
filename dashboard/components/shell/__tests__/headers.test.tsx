// 셸 헤더 세 가지(스펙 §4.2·§4.3, 아트보드 Login·EntrySearch·DashStatus 머리).
// 현장 바꾸기·계정 메뉴의 펼침과 키보드는 site-switcher.test.tsx·account-menu.test.tsx 가 본다.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const usePathnameMock = vi.fn<() => string>();
vi.mock('next/navigation', () => ({ usePathname: () => usePathnameMock() }));
// 헤더를 그리기만 해서는 Supabase 를 부르면 안 된다(현장 목록은 펼칠 때 읽는다) - 부르면 여기서 던진다.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => { throw new Error('헤더를 그리기만 했는데 Supabase 를 불렀다'); },
}));

import { EntryHeader } from '../entry-header';
import { LoginHeader } from '../login-header';
import { SiteHeader } from '../site-header';

describe('LoginHeader', () => {
  it('상표(/) 하나뿐이다 - 계정 메뉴도 현장 메뉴도 없다', () => {
    render(<LoginHeader />);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'FLATNESS' })).toHaveAttribute('href', '/');
    expect(within(banner).getAllByRole('link')).toHaveLength(1);
    expect(within(banner).queryByRole('button')).toBeNull();
  });
});

describe('EntryHeader', () => {
  it('상표(/)와 이메일을 라벨로 한 계정 메뉴 단추만 있다', () => {
    render(<EntryHeader email="u1@example.com" />);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'FLATNESS' })).toHaveAttribute('href', '/');
    expect(within(banner).getAllByRole('link')).toHaveLength(1);
    const account = within(banner).getByRole('button', { name: 'u1@example.com' });
    expect(account).toHaveAttribute('aria-haspopup', 'menu');
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(within(banner).queryByRole('navigation')).toBeNull();
  });
});

describe('SiteHeader', () => {
  function renderSite(pathname = '/sites/s1') {
    usePathnameMock.mockReturnValue(pathname);
    render(<SiteHeader site={{ id: 's1', name: '세종 M2블록 아파트' }} email="u1@example.com" />);
    return screen.getByRole('banner');
  }

  it('상표는 "FLATNESS, 현장 목록으로"라는 이름으로 / 를 가리킨다', () => {
    const banner = renderSite();
    expect(within(banner).getByRole('link', { name: 'FLATNESS, 현장 목록으로' })).toHaveAttribute('href', '/');
  });

  it('현장 이름 단추가 현장 바꾸기 목록(listbox)을 연다고 알린다(처음엔 닫힘)', () => {
    const banner = renderSite();
    const switcher = within(banner).getByRole('button', { name: '세종 M2블록 아파트' });
    expect(switcher).toHaveAttribute('aria-haspopup', 'listbox');
    expect(switcher).toHaveAttribute('aria-expanded', 'false');
  });

  it('현장 메뉴 세 링크는 이 현장의 대시보드·측정위치·보고서를 가리킨다', () => {
    const banner = renderSite();
    const nav = within(banner).getByRole('navigation', { name: '현장 메뉴' });
    expect(within(nav).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['대시보드', '/sites/s1'],
      ['측정위치', '/sites/s1/locations'],
      ['보고서', '/sites/s1/reports'],
    ]);
  });

  it('"스캔 업로드"는 이 현장의 업로드로 가고, 계정 메뉴 단추의 라벨은 이메일이다', () => {
    const banner = renderSite();
    expect(within(banner).getByRole('link', { name: '스캔 업로드' })).toHaveAttribute('href', '/sites/s1/upload');
    expect(within(banner).getByRole('button', { name: 'u1@example.com' })).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('현장 밖 URL 의 현장 화면(/reports/r1)에서는 보고서 탭이 활성이다', () => {
    const banner = renderSite('/reports/r1');
    expect(within(banner).getByRole('link', { name: '보고서' })).toHaveAttribute('aria-current', 'page');
    expect(within(banner).getByRole('link', { name: '대시보드' })).not.toHaveAttribute('aria-current');
  });
});

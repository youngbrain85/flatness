// 계정 메뉴(스펙 §4.3·§8): 이메일 라벨 단추 → "설정"(/settings)·"로그아웃"(LogoutButton 동작).
// 현장 바꾸기와 같은 키보드 규칙(Enter/Space 열기, 화살표 이동, Esc 닫고 복귀)과 바깥 누름 닫기.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

const signOut = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut } }) }));
// jsdom 에는 앱 라우터가 없어 진짜 Link 를 누르면 이동 디스패치가 던진다. 평범한 a 로 바꾸되
// 넘겨받은 onClick 은 그대로 부르고 문서 이동만 막는다.
vi.mock('next/link', () => ({
  default: ({ href, onClick, children, ...rest }: ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest} onClick={(e) => { e.preventDefault(); onClick?.(e); }}>{children}</a>
  ),
}));

import { AccountMenu } from '../account-menu';

function renderMenu(email: string | null = 'u1@example.com') {
  render(
    <div>
      <AccountMenu email={email} />
      <button type="button">바깥</button>
    </div>,
  );
  return screen.getByRole('button', { name: email ?? '계정' });
}
const items = () => screen.getAllByRole('menuitem');

describe('AccountMenu', () => {
  it('이메일을 라벨로 한 단추가 메뉴를 연다고 알린다(처음엔 닫힘)', () => {
    const trigger = renderMenu();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('이메일이 없으면 단추 라벨은 "계정"이다', () => {
    expect(renderMenu(null)).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('누르면 "설정"(/settings)·"로그아웃"이 열리고 첫 항목에 포커스가 가며, 다시 누르면 닫힌다', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: '계정 메뉴' })).toBeInTheDocument();
    expect(items().map((i) => i.textContent)).toEqual(['설정', '로그아웃']);
    expect(items()[0]).toHaveAttribute('href', '/settings');
    expect(items()[0]).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each([['Enter'], [' ']])('단추에서 %j 키로 열고 첫 항목에 포커스가 간다', (key) => {
    const trigger = renderMenu();
    fireEvent.keyDown(trigger, { key });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(items()[0]).toHaveFocus();
  });

  it('단추에서 위 화살표는 열고 끝 항목(로그아웃)에 포커스가 간다', () => {
    fireEvent.keyDown(renderMenu(), { key: 'ArrowUp' });
    expect(items()[1]).toHaveFocus();
  });

  it('화살표는 항목 사이를 돈다(끝 다음은 처음, 처음 앞은 끝)', () => {
    fireEvent.click(renderMenu());
    fireEvent.keyDown(items()[0], { key: 'ArrowDown' });
    expect(items()[1]).toHaveFocus();
    fireEvent.keyDown(items()[1], { key: 'ArrowDown' });
    expect(items()[0]).toHaveFocus();
    fireEvent.keyDown(items()[0], { key: 'ArrowUp' });
    expect(items()[1]).toHaveFocus();
  });

  it('Esc 는 메뉴를 닫고 포커스를 단추로 돌려준다', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    fireEvent.keyDown(items()[0], { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('메뉴 안을 누르면 닫지 않고, 바깥을 누르면 닫는다', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    fireEvent.mouseDown(items()[1]);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: '바깥' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('"설정"을 고르면 메뉴를 닫는다(설정 화면에서 설정을 눌러도 메뉴가 남지 않게)', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    fireEvent.click(items()[0]);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  describe('로그아웃', () => {
    // jsdom 의 window.location 은 교체 불가 프로퍼티라 defineProperty 로 통째로 갈아끼운다
    // (components/__tests__/logout-button.test.tsx 와 같은 방식).
    const realLocation = window.location;
    let assign: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      signOut.mockClear();
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

    it('세션을 정리한 뒤 /login 으로 전체 페이지 이동한다(LogoutButton 동작 그대로)', async () => {
      fireEvent.click(renderMenu());
      fireEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }));
      await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
      expect(signOut).toHaveBeenCalledTimes(1);
    });
  });
});

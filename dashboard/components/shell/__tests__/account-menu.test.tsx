// 계정 메뉴(스펙 §4.3·§8): 이메일 라벨 단추 → "설정"(/settings)·"로그아웃"(LogoutButton 동작).
// 현장 바꾸기와 같은 키보드 규칙(Enter/Space 열기, 화살표 이동, Esc 닫고 복귀), 바깥 누름(pointerdown)과
// 포커스가 바깥으로 나가는 것(Tab 포함)으로 닫기.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
// 브라우저가 Tab 으로 하는 일(포커스가 다른 요소로 가며 focusout 이 relatedTarget 과 함께 온다)을 jsdom 의
// 실제 focus() 로 흉내 낸다. 그 focusout 이 일으키는 상태 변경이 바로 반영되도록 act 로 감싼다.
const moveFocusTo = (el: HTMLElement) => act(() => { el.focus(); });

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

  // pointerdown 은 마우스·터치·펜을 한꺼번에 덮는다(iOS Safari 는 클릭할 수 없는 요소를 탭하면 mousedown 같은
  // 마우스 호환 이벤트를 보내지 않을 수 있다).
  it('메뉴 안을 누르면 닫지 않고, 바깥을 누르면(pointerdown) 닫는다', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    fireEvent.pointerDown(items()[1]);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '바깥' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  // 포커스가 메뉴 바깥의 다른 요소로 가면 닫는다(APG 메뉴 버튼: Tab 으로 닫힘). 항목은 tabIndex=-1 이라 Tab 은
  // 메뉴를 지나 다음 탭 대상으로 가고, 닫지 않으면 메뉴가 본문을 덮은 채 남는다.
  describe('포커스가 바깥으로 나가면', () => {
    const outside = () => screen.getByRole('button', { name: '바깥' });

    it('Tab 으로 바깥 요소에 가면 닫고, Tab 을 막지 않는다(포커스를 가두지 않는다)', () => {
      const trigger = renderMenu();
      fireEvent.click(trigger);
      // fireEvent 는 기본 동작이 막히지 않았을 때 true 를 돌려준다 - Tab 의 포커스 이동을 우리가 막지 않는다
      expect(fireEvent.keyDown(items()[0], { key: 'Tab' })).toBe(true);
      moveFocusTo(outside());
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(outside()).toHaveFocus(); // 포커스는 가야 할 곳(바깥)에 그대로 있다
    });

    it.each<[string, (trigger: HTMLElement) => void]>([
      ['첫 항목(설정)', () => {}],
      ['끝 항목(로그아웃)', () => { fireEvent.keyDown(items()[0], { key: 'ArrowDown' }); }],
      ['이메일 단추', (trigger) => { moveFocusTo(trigger); }],
    ])('포커스가 %s 에서 바깥의 다른 요소로 옮겨 가면 닫는다', (_where, setup) => {
      const trigger = renderMenu();
      fireEvent.click(trigger);
      setup(trigger);
      expect(screen.getByRole('menu')).toBeInTheDocument();
      moveFocusTo(outside());
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('포커스가 메뉴 안(항목 → 단추)에서만 움직이면 닫지 않는다', () => {
      const trigger = renderMenu();
      fireEvent.click(trigger);
      fireEvent.keyDown(items()[0], { key: 'ArrowDown' });
      expect(items()[1]).toHaveFocus();
      moveFocusTo(trigger);
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    // relatedTarget 이 없는 blur: 단추를 눌러도 포커스를 주지 않는 브라우저(macOS Safari), 창 전환, 메뉴의 빈 곳
    // 누름(포커스가 body 로 감). 여기서 닫으면 Safari 에서 "닫혔다가 곧바로 다시 열리는" 결함이 생긴다.
    it('relatedTarget 이 없는 blur 는 닫지 않고, 그 뒤 단추를 누르면 한 번 닫힌 채로 끝난다', () => {
      const trigger = renderMenu();
      fireEvent.click(trigger);
      fireEvent.blur(items()[0], { relatedTarget: null });
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.click(trigger);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
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

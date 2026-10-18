// 현장 바꾸기(스펙 §4.3·§8): 펼칠 때 sites 를 name 순으로 한 번 읽고, 검색칸이 이름으로 거르고,
// 키보드(Enter/Space 로 열기, 화살표로 이동, Esc 로 닫고 단추로 복귀), 바깥 누름(pointerdown)과 포커스가
// 바깥으로 나가는 것(Tab 포함)으로 닫기를 지킨다. 패널은 이름 있는 dialog 이고 단추는 aria-haspopup="dialog"
// 다(ARIA 1.2: aria-haspopup 값은 팝업 컨테이너의 role 과 맞아야 한다).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';

const { db } = vi.hoisted(() => ({
  db: {
    result: { data: null, error: null } as {
      data: { id: string; name: string }[] | null; error: { message: string } | null;
    },
    calls: [] as unknown[][],
  },
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      db.calls.push(['from', table]);
      const chain = {
        select: (cols: string) => { db.calls.push(['select', cols]); return chain; },
        order: (col: string) => { db.calls.push(['order', col]); return Promise.resolve(db.result); },
      };
      return chain;
    },
  }),
}));
// jsdom 에는 앱 라우터가 없어 진짜 Link 를 누르면 이동 디스패치가 던진다. 평범한 a 로 바꾸되
// 넘겨받은 onClick 은 그대로 부르고 문서 이동만 막는다.
vi.mock('next/link', () => ({
  default: ({ href, onClick, children, ...rest }: ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest} onClick={(e) => { e.preventDefault(); onClick?.(e); }}>{children}</a>
  ),
}));

import { SiteSwitcher } from '../site-switcher';
import { AccountMenu } from '../account-menu';

const SITES = [
  { id: 's1', name: '세종 M2블록 아파트' },
  { id: 's2', name: '세종 M3블록 오피스텔' },
  { id: 's3', name: 'Test' },
];

beforeEach(() => {
  db.result = { data: SITES, error: null };
  db.calls = [];
});

function renderSwitcher() {
  render(
    <div>
      <SiteSwitcher current={{ id: 's1', name: '세종 M2블록 아파트' }} />
      <button type="button">바깥</button>
    </div>,
  );
  return screen.getByRole('button', { name: '세종 M2블록 아파트' });
}

async function openAndLoad() {
  const trigger = renderSwitcher();
  fireEvent.click(trigger);
  await screen.findByRole('listbox');
  return trigger;
}

const search = () => screen.getByRole('searchbox', { name: '현장 이름으로 찾기' });
const options = () => within(screen.getByRole('listbox')).getAllByRole('option');
const allSites = () => screen.getByRole('link', { name: '모든 현장 보기' });
const fromCalls = () => db.calls.filter(([op]) => op === 'from').length;
// 브라우저가 Tab 으로 하는 일(포커스가 다른 요소로 가며 focusout 이 relatedTarget 과 함께 온다)을 jsdom 의
// 실제 focus() 로 흉내 낸다. 그 focusout 이 일으키는 상태 변경이 바로 반영되도록 act 로 감싼다.
const moveFocusTo = (el: HTMLElement) => act(() => { el.focus(); });

describe('SiteSwitcher 목록', () => {
  it('처음에는 닫혀 있고 Supabase 를 부르지 않는다', () => {
    const trigger = renderSwitcher();
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(db.calls).toEqual([]);
  });

  it('펼치면 읽는 동안 "불러오는 중…"을 보이고, sites 를 name 순으로 읽어 현장 링크를 보여 준다', async () => {
    const trigger = renderSwitcher();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument();
    await screen.findByRole('listbox');
    expect(db.calls).toEqual([['from', 'sites'], ['select', 'id, name'], ['order', 'name']]);
    expect(options().map((o) => o.getAttribute('href'))).toEqual(['/sites/s1', '/sites/s2', '/sites/s3']);
    // 지금 현장은 선택 상태(aria-selected)와 글자로 함께 알린다 - 색만으로 말하지 않는다(스펙 §8)
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(options()[0]).toHaveTextContent('지금 현장');
    expect(allSites()).toHaveAttribute('href', '/');
  });

  it('검색칸에 쓴 글자로 이름을 거르고(영문 대소문자 무시), 다시 펼치면 검색어가 비어 있다', async () => {
    const trigger = await openAndLoad();
    fireEvent.change(search(), { target: { value: 'test' } });
    expect(options().map((o) => o.textContent)).toEqual(['Test']);
    fireEvent.change(search(), { target: { value: '세종' } });
    expect(options()).toHaveLength(2);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(search()).toHaveValue('');
    expect(options()).toHaveLength(3);
  });

  it('걸러서 0건이면 "찾는 현장이 없습니다."를 보이고 "모든 현장 보기"는 남는다', async () => {
    await openAndLoad();
    fireEvent.change(search(), { target: { value: '없는 현장' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('찾는 현장이 없습니다.')).toBeInTheDocument();
    expect(allSites()).toBeInTheDocument();
  });

  it('한 번 읽은 목록은 닫았다 다시 펼쳐도 다시 읽지 않는다', async () => {
    const trigger = await openAndLoad();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    await screen.findByRole('listbox');
    expect(fromCalls()).toBe(1);
  });

  it('목록을 읽지 못하면 알리고, 다시 펼치면 다시 읽는다', async () => {
    db.result = { data: null, error: { message: 'timeout' } };
    const trigger = renderSwitcher();
    fireEvent.click(trigger);
    expect(await screen.findByRole('alert')).toHaveTextContent('현장 목록을 불러오지 못했습니다');
    fireEvent.click(trigger);
    db.result = { data: SITES, error: null };
    fireEvent.click(trigger);
    await screen.findByRole('listbox');
    expect(fromCalls()).toBe(2);
  });

  it('현장을 고르면 목록을 닫는다(같은 현장으로 가면 레이아웃이 남아 목록이 열린 채로 남지 않게)', async () => {
    const trigger = await openAndLoad();
    fireEvent.click(options()[0]);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('SiteSwitcher 키보드·바깥 누름', () => {
  it.each([['Enter'], [' ']])('단추에서 %j 키를 누르면 열리고 검색칸에 포커스가 간다', async (key) => {
    const trigger = renderSwitcher();
    trigger.focus();
    fireEvent.keyDown(trigger, { key });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(search()).toHaveFocus();
    await screen.findByRole('listbox');
  });

  it('검색칸에서 아래 화살표로 첫 현장, 이어서 다음 항목으로 가고 끝에서 처음으로 돈다', async () => {
    await openAndLoad();
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(options()[0]).toHaveFocus();
    fireEvent.keyDown(options()[0], { key: 'ArrowDown' });
    expect(options()[1]).toHaveFocus();
    fireEvent.keyDown(options()[1], { key: 'ArrowDown' });
    fireEvent.keyDown(options()[2], { key: 'ArrowDown' });
    expect(allSites()).toHaveFocus();
    fireEvent.keyDown(allSites(), { key: 'ArrowDown' });
    expect(options()[0]).toHaveFocus();
    fireEvent.keyDown(options()[0], { key: 'ArrowUp' });
    expect(allSites()).toHaveFocus();
  });

  it('검색칸에서 위 화살표는 끝 항목("모든 현장 보기")으로 간다', async () => {
    await openAndLoad();
    fireEvent.keyDown(search(), { key: 'ArrowUp' });
    expect(allSites()).toHaveFocus();
  });

  it('한글 조합 중의 화살표는 검색칸을 떠나지 않는다', async () => {
    await openAndLoad();
    fireEvent.keyDown(search(), { key: 'ArrowDown', isComposing: true });
    expect(search()).toHaveFocus();
  });

  it('Esc 는 목록을 닫고 포커스를 현장 이름 단추로 돌려준다', async () => {
    const trigger = await openAndLoad();
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    fireEvent.keyDown(options()[0], { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  // pointerdown 은 마우스·터치·펜을 한꺼번에 덮는다(iOS Safari 는 클릭할 수 없는 요소를 탭하면 mousedown 같은
  // 마우스 호환 이벤트를 보내지 않을 수 있다).
  it('목록 안을 누르면 닫지 않고, 바깥을 누르면(pointerdown) 닫는다', async () => {
    const trigger = await openAndLoad();
    fireEvent.pointerDown(search());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '바깥' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('SiteSwitcher ARIA(스펙 §8, ARIA 1.2)', () => {
  it('단추는 dialog 를 연다고 알리고, aria-controls 가 가리키는 패널은 이름 있는 dialog 다', async () => {
    const trigger = await openAndLoad();
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    const dialog = screen.getByRole('dialog', { name: '현장 바꾸기' });
    expect(trigger).toHaveAttribute('aria-controls', dialog.id);
    // 안의 구성은 그대로다: 검색칸 + 항목 listbox + 바깥 링크
    expect(within(dialog).getByRole('searchbox', { name: '현장 이름으로 찾기' })).toBeInTheDocument();
    expect(within(dialog).getByRole('listbox', { name: '현장 목록' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: '모든 현장 보기' })).toBeInTheDocument();
  });
});

// 포커스가 팝업 바깥의 다른 요소로 가면 닫는다(APG 메뉴 버튼: Tab 으로 닫힘). 닫지 않으면 z-30 패널이
// 본문을 덮은 채 남고 Esc 도 더 듣지 않으며, 키보드로 두 목록이 동시에 열리기도 한다.
describe('SiteSwitcher 포커스가 바깥으로 나가면', () => {
  const outside = () => screen.getByRole('button', { name: '바깥' });

  it('Tab 으로 바깥 요소에 가면 닫고, Tab 을 막지 않는다(포커스를 가두지 않는다)', async () => {
    const trigger = await openAndLoad();
    // fireEvent 는 기본 동작이 막히지 않았을 때 true 를 돌려준다 - Tab 의 포커스 이동을 우리가 막지 않는다
    expect(fireEvent.keyDown(search(), { key: 'Tab' })).toBe(true);
    // 브라우저가 Tab 으로 하는 일: 항목은 tabIndex=-1 이라 다음 탭 대상(바깥 단추)으로 포커스가 간다
    moveFocusTo(outside());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(outside()).toHaveFocus(); // 포커스는 가야 할 곳(바깥)에 그대로 있다
  });

  it.each<[string, () => Promise<HTMLElement>]>([
    ['검색칸', () => openAndLoad()],
    ['목록 항목', async () => { const t = await openAndLoad(); fireEvent.keyDown(search(), { key: 'ArrowDown' }); return t; }],
    ['현장 이름 단추', async () => { const t = await openAndLoad(); moveFocusTo(t); return t; }],
  ])('포커스가 %s 에서 바깥의 다른 요소로 옮겨 가면 닫는다', async (_where, setup) => {
    const trigger = await setup();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    moveFocusTo(outside());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('포커스가 팝업 안(검색칸 → 항목 → 단추)에서만 움직이면 닫지 않는다', async () => {
    const trigger = await openAndLoad();
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(options()[0]).toHaveFocus();
    moveFocusTo(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  // relatedTarget 이 없는 blur: 단추를 눌러도 포커스를 주지 않는 브라우저(macOS Safari), 창 전환, 패널의 빈 곳
  // 누름(포커스가 body 로 감). 여기서 닫으면 Safari 에서 "닫혔다가 곧바로 다시 열리는" 결함이 생긴다.
  it('relatedTarget 이 없는 blur 는 닫지 않고, 그 뒤 단추를 누르면 한 번 닫힌 채로 끝난다', async () => {
    const trigger = await openAndLoad();
    fireEvent.blur(search(), { relatedTarget: null });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('키보드로 계정 메뉴 단추로 옮겨 열면 현장 바꾸기 목록은 닫힌다(두 목록이 동시에 열리지 않는다)', async () => {
    render(
      <div>
        <SiteSwitcher current={{ id: 's1', name: '세종 M2블록 아파트' }} />
        <AccountMenu email="u1@example.com" />
      </div>,
    );
    const switcher = screen.getByRole('button', { name: '세종 M2블록 아파트' });
    fireEvent.click(switcher);
    await screen.findByRole('listbox');
    const account = screen.getByRole('button', { name: 'u1@example.com' });
    moveFocusTo(account); // Tab 으로 계정 단추에 간다
    fireEvent.keyDown(account, { key: 'Enter' }); // Enter 로 연다
    expect(switcher).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('menu', { name: '계정 메뉴' })).toBeInTheDocument();
  });
});

// Task 12 휴대폰 점검: 띄어쓰기 없는 긴 현장 이름이 390 헤더에서 단추를 화면 밖으로 밀었다(가로 스크롤 434/390)
describe('SiteSwitcher 긴 현장 이름', () => {
  it('단추는 줄어들 수 있고(min-w-0) 이름은 아무 곳에서나 줄바꿈한다(overflow-wrap:anywhere)', () => {
    render(<SiteSwitcher current={{ id: 'sl', name: 'GwangmyeongStationAreaRedevelopmentBlockC7' }} />);
    const trigger = screen.getByRole('button', { name: 'GwangmyeongStationAreaRedevelopmentBlockC7' });
    expect(trigger.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'max-w-full', '[overflow-wrap:anywhere]']));
  });
});

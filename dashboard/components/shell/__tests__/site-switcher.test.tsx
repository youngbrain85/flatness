// 현장 바꾸기(스펙 §4.3·§8): 펼칠 때 sites 를 name 순으로 한 번 읽고, 검색칸이 이름으로 거르고,
// 키보드(Enter/Space 로 열기, 화살표로 이동, Esc 로 닫고 단추로 복귀)와 바깥 누름 닫기를 지킨다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

describe('SiteSwitcher 목록', () => {
  it('처음에는 닫혀 있고 Supabase 를 부르지 않는다', () => {
    const trigger = renderSwitcher();
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
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

  it('목록 안을 누르면 닫지 않고, 바깥을 누르면 닫는다', async () => {
    const trigger = await openAndLoad();
    fireEvent.mouseDown(search());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: '바깥' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

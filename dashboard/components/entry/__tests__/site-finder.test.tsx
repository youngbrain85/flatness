// SiteFinder(진입 페이지 클라이언트 섬, 아트보드 EntrySearch): 현장 이름 검색(클라이언트), "새 현장" 카드
// 펼치기·접기와 초점 이동, 검색 결과 0건 안내에서 검색어를 현장명에 넣어 카드 열기를 본다.
// 카드 안의 저장 동작은 new-site-card.test.tsx가 본다(여기서는 라우터·Supabase를 막아만 둔다).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({})) }));

import { SiteFinder, filterSites, type EntryTotals } from '../site-finder';
import type { EntrySiteRow } from '../site-list';
import { buttonClass } from '@/components/ui/button';

const row = (id: string, name: string): EntrySiteRow => ({
  id, name, locationCount: 0, scanCount: 0, lastScannedAt: null,
  counts: { pass: 0, warn: 0, fail: 0 }, na: 0, inProgress: 0,
});
const ROWS = [row('s1', '세종 M2블록 아파트'), row('s2', '대전 도안 A1블록'), row('s3', '한밭대 시험동')];
const TOTALS: EntryTotals = { sites: 3, locations: 42, scans: 130, inProgress: 3 };

function search(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '현장 이름으로 찾기' }), { target: { value: text } });
}
// 지금 보이는 현장 줄(링크)의 현장명 - 줄 링크의 첫 글자 덩어리가 현장명이다
function shownSites(): string[] {
  return screen.queryAllByRole('link').map((l) => l.querySelector('span')?.textContent ?? '');
}
// 위쪽 "새 현장"(카드 토글)은 aria-expanded를 단 유일한 "새 현장" 버튼이다
function toggleButton(): HTMLElement {
  return screen.getAllByRole('button', { name: '새 현장' }).find((b) => b.hasAttribute('aria-expanded'))!;
}
// 0건 안내 안의 "새 현장"은 aria-expanded가 없다
function emptyStateButton(): HTMLElement {
  return screen.getAllByRole('button', { name: '새 현장' }).find((b) => !b.hasAttribute('aria-expanded'))!;
}
const nameInput = () => screen.getByLabelText('현장명 (필수)') as HTMLInputElement;

describe('SiteFinder 머리 (h1 · 총계 · 검색칸)', () => {
  it('h1 "현장"과 총계 한 줄("n곳 · 측정위치 n · 스캔 n · 처리 중 n건")을 그린다', () => {
    render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('현장');
    expect(screen.getByText('3곳 · 측정위치 42 · 스캔 130 · 처리 중 3건')).toBeInTheDocument();
  });

  it('검색칸은 숨은 라벨 "현장 이름으로 찾기"를 단 진짜 input이고 search 영역 안에 search 아이콘과 함께 있다', () => {
    const { container } = render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    const input = screen.getByRole('textbox', { name: '현장 이름으로 찾기' });
    expect(input).toHaveAttribute('placeholder', '현장 이름으로 찾기');
    expect(screen.getByRole('search').contains(input)).toBe(true);
    expect(container.querySelector('[role="search"] [data-icon="search"]')).toBeInTheDocument();
  });

  it('목록 머리의 판정 분포 범례는 3묶음 이름(적합 · 경계 · 보수·재시공)이고 점은 분포 바의 세 묶음 색이다', () => {
    render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    const legend = screen.getByText('판정 분포').parentElement!;
    expect(legend.textContent).toBe('판정 분포적합경계보수·재시공');
    // VerdictBar의 묶음 색: 적합 pass · 경계 borderline · 보수·재시공 rework
    expect([...legend.querySelectorAll('[data-grade]')].map((d) => d.getAttribute('data-grade')))
      .toEqual(['pass', 'borderline', 'rework']);
  });
});

describe('SiteFinder 검색 (현장명 포함, 클라이언트)', () => {
  it('앞뒤 공백을 지우고 대소문자를 무시해 현장명으로 거르고, "n곳 · 최근 측정일 순"이 따라간다', () => {
    render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    expect(screen.getByText('3곳 · 최근 측정일 순')).toBeInTheDocument();
    search('블록');
    expect(shownSites()).toEqual(['세종 M2블록 아파트', '대전 도안 A1블록']);
    expect(screen.getByText('2곳 · 최근 측정일 순')).toBeInTheDocument();
    search('  a1 ');
    expect(shownSites()).toEqual(['대전 도안 A1블록']);
    search('');
    expect(shownSites()).toHaveLength(3);
  });

  it('filterSites: 빈 검색어는 그대로, 아니면 포함 검색', () => {
    expect(filterSites(ROWS, '   ')).toBe(ROWS);
    expect(filterSites(ROWS, '시험').map((r) => r.id)).toEqual(['s3']);
    expect(filterSites(ROWS, 'm2').map((r) => r.id)).toEqual(['s1']);
  });
});

describe('SiteFinder 새 현장 카드 (펼치기 · 접기 · 초점)', () => {
  it('"새 현장"은 카드를 펼치고(aria-expanded) 현장명 칸으로 초점을 옮긴다 - 현장명은 비어 있다', () => {
    render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: '새 현장 등록' })).toBeNull();
    search('세종');
    fireEvent.click(toggleButton());
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'true');
    expect(toggleButton()).toHaveAttribute('aria-controls', 'newSiteCard');
    expect(screen.getByRole('region', { name: '새 현장 등록' })).toHaveAttribute('id', 'newSiteCard');
    expect(nameInput()).toHaveFocus();
    // 결과가 있는 검색에서 연 카드는 검색어를 넣지 않는다(0건 안내에서 열 때만 넣는다)
    expect(nameInput().value).toBe('');
  });

  // 최종 리뷰: 닫힌 카드는 DOM 에 없으므로 aria-controls 가 없는 id 를 가리키면 안 된다(계정 메뉴·현장 바꾸기와 같은 규칙).
  it('"새 현장" 토글은 카드가 닫혀 있으면 aria-controls 를 달지 않고, 열면 DOM 에 있는 카드 id(newSiteCard)를 가리킨다', () => {
    render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    expect(toggleButton()).not.toHaveAttribute('aria-controls');
    expect(document.getElementById('newSiteCard')).toBeNull();
    fireEvent.click(toggleButton());
    expect(toggleButton()).toHaveAttribute('aria-controls', 'newSiteCard');
    expect(document.getElementById('newSiteCard')).not.toBeNull();
    fireEvent.click(toggleButton());
    expect(toggleButton()).not.toHaveAttribute('aria-controls');
    expect(document.getElementById('newSiteCard')).toBeNull();
  });

  it('다시 누르면 카드를 접는다', () => {
    render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    fireEvent.click(toggleButton());
    fireEvent.click(toggleButton());
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: '새 현장 등록' })).toBeNull();
  });

  it('카드의 "취소"는 카드를 접고 초점을 "새 현장" 버튼으로 돌려준다', () => {
    render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    fireEvent.click(toggleButton());
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('region', { name: '새 현장 등록' })).toBeNull();
    expect(toggleButton()).toHaveFocus();
  });
});

describe('SiteFinder 검색 결과 0건 (아트보드 빈 상태)', () => {
  it('안내 · 검색어 · 주 버튼 "새 현장"을 그리고, 현장 줄 링크는 없다', () => {
    render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    search('  없는현장 ');
    expect(screen.getByText('찾는 현장이 없습니다')).toBeInTheDocument();
    expect(screen.getByText('검색어 · 없는현장')).toBeInTheDocument();
    expect(screen.getByText('0곳 · 최근 측정일 순')).toBeInTheDocument();
    expect(shownSites()).toEqual([]);
    expect(emptyStateButton().className).toContain(buttonClass('primary'));
  });

  it('안내의 "새 현장"은 검색어(앞뒤 공백 제거)를 현장명에 넣은 카드를 열고 그 칸으로 초점을 옮긴다', () => {
    render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    search('  한밭대 본관 ');
    fireEvent.click(emptyStateButton());
    expect(screen.getByRole('region', { name: '새 현장 등록' })).toBeInTheDocument();
    expect(nameInput().value).toBe('한밭대 본관');
    expect(nameInput()).toHaveFocus();
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'true');
  });

  it('카드가 이미 열려 있으면 안내의 "새 현장"은 보조 버튼이고, 입력한 현장명을 두고 초점만 옮긴다', () => {
    render(<SiteFinder rows={ROWS} totals={TOTALS} />);
    fireEvent.click(toggleButton());
    fireEvent.change(nameInput(), { target: { value: '직접 입력' } });
    search('없는현장');
    // 주 버튼은 한 화면에 하나 - 열린 카드의 "현장 등록"이 주 버튼이다
    expect(emptyStateButton().className).toContain(buttonClass('normal'));
    expect(emptyStateButton().className).not.toContain(buttonClass('primary'));
    emptyStateButton().focus();
    fireEvent.click(emptyStateButton());
    expect(nameInput().value).toBe('직접 입력');
    expect(nameInput()).toHaveFocus();
  });

  it('현장이 하나도 없으면 "아직 등록된 현장이 없습니다"와 "새 현장"을 그린다(검색어 줄 없음)', () => {
    render(<SiteFinder rows={[]} totals={{ sites: 0, locations: 0, scans: 0, inProgress: 0 }} />);
    expect(screen.getByText('아직 등록된 현장이 없습니다')).toBeInTheDocument();
    expect(screen.queryByText(/^검색어 ·/)).toBeNull();
    fireEvent.click(emptyStateButton());
    expect(nameInput().value).toBe('');
  });
});

// SiteTable(홈 현장 테이블, 클라이언트 섬 - 스펙 §7-3): 서버가 넘긴 rows를 검색·판정 필터로
// 거르고, 상태 열이 처리 중 > 판정 불가 > 완료 > 분석 없음 순으로 하나만 보이는지 본다.
// 서버 조회·URL은 관여하지 않으므로 next/navigation 모킹이 필요 없다.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SiteTable, siteStatus, type SiteTableRow } from '../site-table';

const row = (over: Partial<SiteTableRow> & Pick<SiteTableRow, 'id' | 'name'>): SiteTableRow => ({
  locationCount: 0, scanCount: 0, lastScannedAt: null,
  counts: { pass: 0, warn: 0, fail: 0 }, na: 0, inProgress: 0, ...over,
});

// 아트보드(Main.dc.html)의 행을 옮긴 픽스처 - 상태 4종(처리 중·완료·판정 불가·분석 없음)이 한 번씩 나온다.
const ROWS: SiteTableRow[] = [
  row({ id: 's1', name: '세종 M2블록 아파트', locationCount: 14, scanCount: 42, lastScannedAt: '2026-09-03',
    counts: { pass: 31, warn: 6, fail: 2 }, inProgress: 3 }),
  row({ id: 's2', name: '대전 도안 A1블록', locationCount: 9, scanCount: 27, lastScannedAt: '2026-09-01',
    counts: { pass: 20, warn: 5, fail: 1 } }),
  row({ id: 's3', name: '공주 월송 1블록', locationCount: 4, scanCount: 10, lastScannedAt: '2026-08-14',
    counts: { pass: 6, warn: 1, fail: 0 }, na: 3 }),
  row({ id: 's4', name: '한밭대 시험동', locationCount: 1 }),
];

// 지금 보이는 행의 현장명(첫 열 링크) 목록 - 테이블 안의 링크는 현장명뿐이다
function siteNames(): string[] {
  return screen.queryAllByRole('link').map((l) => l.textContent ?? '');
}
function search(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '현장 검색' }), { target: { value: text } });
}
// 옵션 라벨(화면 문구)로 고른다 - 값 문자열이 아니라 사용자가 보는 텍스트가 계약이다
function pickFilter(label: string) {
  const value = (screen.getByRole('option', { name: label }) as HTMLOptionElement).value;
  fireEvent.change(screen.getByRole('combobox', { name: '판정 필터' }), { target: { value } });
}

describe('SiteTable 열 (아트보드 Main: 현장명·측정위치·스캔·최근 측정일·판정 분포·상태)', () => {
  it('머리글 6열을 이 순서로 그린다', () => {
    render(<SiteTable rows={ROWS} />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '현장명', '측정위치', '스캔', '최근 측정일', '판정 분포 적합 · 주의 · 재시공', '상태',
    ]);
  });

  it('현장명은 /sites/[id] 링크(cs-link 700), 수치는 우측 mono, 최근 측정일은 mono, 분포는 120px 바 + 보조 텍스트', () => {
    render(<SiteTable rows={ROWS} />);
    const link = screen.getByRole('link', { name: '세종 M2블록 아파트' });
    expect(link).toHaveAttribute('href', '/sites/s1');
    expect(link.className).toContain('text-cs-link');
    expect(link.className).toContain('font-bold');

    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell'); // [0]은 머리글 행
    expect(cells[1].textContent).toBe('14');
    expect(cells[1].className).toContain('text-right');
    expect(cells[1].className).toContain('font-mono');
    expect(cells[2].textContent).toBe('42');
    expect(cells[3].textContent).toBe('2026-09-03');
    expect(cells[3].className).toContain('font-mono');
    const sub = within(cells[4]).getByText('31 · 6 · 2');
    expect(sub.className).toContain('text-cs-text-secondary');
    expect(sub.previousElementSibling?.className).toContain('w-[120px]');
    expect(cells[4].querySelectorAll('[data-seg]').length).toBe(3);
  });

  it('스캔이 없는 현장은 최근 측정일 "-", 판정 분포는 "판정 없음"만(보조 텍스트 0 · 0 · 0 없음)', () => {
    render(<SiteTable rows={[ROWS[3]]} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[3].textContent).toBe('-');
    expect(cells[4].textContent).toBe('판정 없음');
  });

  it('아이콘은 Icon 컴포넌트로 그린다(검색·셀렉트 chevron - 이모지 금지)', () => {
    const { container } = render(<SiteTable rows={ROWS} />);
    expect(container.querySelector('[data-icon="search"]')).toBeInTheDocument();
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
  });
});

describe('상태 열 (처리 중 > 판정 불가 > 완료 > 분석 없음)', () => {
  it.each([
    { name: '처리 중이 있으면 판정 불가·완료보다 앞선다',
      r: { counts: { pass: 1, warn: 0, fail: 0 }, na: 2, inProgress: 3 }, type: 'in-progress', label: '처리 중 3건' },
    { name: '처리 중이 없고 판정 불가가 있으면 pending(cs-na)',
      r: { counts: { pass: 6, warn: 1, fail: 0 }, na: 3, inProgress: 0 }, type: 'pending', label: '판정 불가 3건' },
    { name: '판정이 하나라도 있으면 완료',
      r: { counts: { pass: 0, warn: 0, fail: 1 }, na: 0, inProgress: 0 }, type: 'success', label: '완료' },
    { name: '아무 분석도 없으면 분석 없음',
      r: { counts: { pass: 0, warn: 0, fail: 0 }, na: 0, inProgress: 0 }, type: 'pending', label: '분석 없음' },
  ])('$name', ({ r, type, label }) => {
    expect(siteStatus(r)).toEqual({ type, label });
    render(<SiteTable rows={[row({ id: 'x', name: 'X', ...r })]} />);
    const el = screen.getByText(label);
    expect(el.getAttribute('data-status')).toBe(type);
    expect(el.closest('td')).not.toBeNull();
  });

  it('픽스처 4행의 상태가 각각 하나씩 나온다', () => {
    render(<SiteTable rows={ROWS} />);
    expect(screen.getByText('처리 중 3건').getAttribute('data-status')).toBe('in-progress');
    expect(screen.getByText('완료').getAttribute('data-status')).toBe('success');
    expect(screen.getByText('판정 불가 3건').getAttribute('data-status')).toBe('pending');
    expect(screen.getByText('분석 없음').getAttribute('data-status')).toBe('pending');
  });
});

describe('도구 줄 (클라이언트 필터 - 스펙 §7-3, 페이지네이션 없음)', () => {
  it('검색 입력(placeholder 현장 검색, 2px cs-input-border)·판정 필터 5종·"총 n곳", 페이지네이션 아이콘 없음', () => {
    const { container } = render(<SiteTable rows={ROWS} />);
    const input = screen.getByRole('textbox', { name: '현장 검색' });
    expect(input).toHaveAttribute('placeholder', '현장 검색');
    expect(input.className).toContain('border-cs-input-border');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '전체', '재시공 있음', '주의 있음', '판정 불가 있음', '처리 중',
    ]);
    expect(screen.getByText('총 4곳')).toBeInTheDocument();
    expect(container.querySelector('[data-icon="chevron-left"]')).toBeNull();
    expect(container.querySelector('[data-icon="chevron-right"]')).toBeNull();
  });

  it('검색은 현장명 includes(앞뒤 공백 제거·대소문자 무시)로 거르고 "총 n곳"이 따라간다', () => {
    render(<SiteTable rows={ROWS} />);
    search('블록');
    expect(siteNames()).toEqual(['세종 M2블록 아파트', '대전 도안 A1블록', '공주 월송 1블록']);
    expect(screen.getByText('총 3곳')).toBeInTheDocument();
    search('  a1 ');
    expect(siteNames()).toEqual(['대전 도안 A1블록']);
    search('');
    expect(siteNames()).toHaveLength(4);
  });

  it.each([
    { label: '재시공 있음', expected: ['세종 M2블록 아파트', '대전 도안 A1블록'] },
    { label: '주의 있음', expected: ['세종 M2블록 아파트', '대전 도안 A1블록', '공주 월송 1블록'] },
    { label: '판정 불가 있음', expected: ['공주 월송 1블록'] },
    { label: '처리 중', expected: ['세종 M2블록 아파트'] },
  ])('판정 필터 "$label"', ({ label, expected }) => {
    render(<SiteTable rows={ROWS} />);
    pickFilter(label);
    expect(siteNames()).toEqual(expected);
  });

  it('검색과 필터는 AND로 겹치고, "전체"로 되돌리면 검색만 남는다', () => {
    render(<SiteTable rows={ROWS} />);
    search('블록');
    pickFilter('재시공 있음');
    expect(siteNames()).toEqual(['세종 M2블록 아파트', '대전 도안 A1블록']);
    pickFilter('전체');
    expect(siteNames()).toEqual(['세종 M2블록 아파트', '대전 도안 A1블록', '공주 월송 1블록']);
  });

  it('조건에 맞는 행이 없으면 안내 한 줄만 그리고 링크는 없다', () => {
    render(<SiteTable rows={ROWS} />);
    search('없는현장');
    expect(screen.getByText('조건에 맞는 현장이 없습니다')).toBeInTheDocument();
    expect(siteNames()).toEqual([]);
    expect(screen.getByText('총 0곳')).toBeInTheDocument();
  });
});

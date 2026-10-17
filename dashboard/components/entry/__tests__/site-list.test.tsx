// SiteList(진입 페이지 현장 목록, 아트보드 EntrySearch): 줄 하나가 통째로 /sites/[id] 링크이고,
// 판정 분포 3묶음 바 · "n · n · n" · 최근 측정일 · 상태(처리 중 > 판정 불가 > 완료 > 분석 없음)를 그린다.
// 지난 홈 테이블(components/site-table.tsx)의 상태 규칙·빈 판정 표시 단언을 옮겨 왔다.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SiteList, siteStatus, type EntrySiteRow } from '../site-list';

const row = (over: Partial<EntrySiteRow> & Pick<EntrySiteRow, 'id' | 'name'>): EntrySiteRow => ({
  locationCount: 0, scanCount: 0, lastScannedAt: null,
  counts: { pass: 0, warn: 0, fail: 0 }, na: 0, inProgress: 0, ...over,
});

// 아트보드(EntrySearch.dc.html)의 줄을 옮긴 픽스처 - 상태 넷(처리 중·완료·판정 불가·분석 없음)이 한 번씩 나온다.
const ROWS: EntrySiteRow[] = [
  row({ id: 's1', name: '세종 M2블록 아파트', locationCount: 14, scanCount: 42, lastScannedAt: '2026-09-03',
    counts: { pass: 31, warn: 6, fail: 2 }, inProgress: 3 }),
  row({ id: 's2', name: '대전 도안 A1블록', locationCount: 9, scanCount: 27, lastScannedAt: '2026-09-01',
    counts: { pass: 20, warn: 5, fail: 1 } }),
  row({ id: 's3', name: '공주 월송 1블록', locationCount: 4, scanCount: 10, lastScannedAt: '2026-08-14',
    counts: { pass: 6, warn: 1, fail: 0 }, na: 3 }),
  row({ id: 's4', name: '한밭대 시험동', locationCount: 1 }),
];

describe('SiteList 줄 (아트보드 EntrySearch: 줄 전체가 링크)', () => {
  it('현장마다 목록 항목 하나, 줄 전체가 그 현장의 /sites/[id] 링크다', () => {
    render(<SiteList rows={ROWS} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href')))
      .toEqual(['/sites/s1', '/sites/s2', '/sites/s3', '/sites/s4']);
  });

  it('현장명 · 측정위치·스캔 수 · 분포 바(3묶음 이름) · "n · n · n" · 최근 측정일 · 상태를 한 줄에 그린다', () => {
    render(<SiteList rows={ROWS} />);
    const link = screen.getByRole('link', { name: /세종 M2블록 아파트/ });
    expect(within(link).getByText('세종 M2블록 아파트')).toBeInTheDocument();
    expect(link.textContent).toContain('측정위치 14 · 스캔 42');
    // 바의 읽을 이름은 새 묶음 이름(스펙 §9) - 옛 "주의 · 재시공"이 아니다
    expect(within(link).getByRole('img', { name: '적합 31, 경계 6, 보수·재시공 2' })).toBeInTheDocument();
    expect(link.querySelectorAll('[data-seg]')).toHaveLength(3);
    // 숫자 줄은 바와 같은 정보라 스크린 리더에는 숨긴다
    expect(within(link).getByText('31 · 6 · 2')).toHaveAttribute('aria-hidden', 'true');
    expect(link.textContent).toContain('최근 2026-09-03');
    expect(within(link).getByText('처리 중 3건')).toHaveAttribute('data-status', 'in-progress');
  });

  it('판정이 없는 현장은 최근 측정일 "-"와 "판정 없음"만 쓰고 분포 그림·"0 · 0 · 0"은 없다', () => {
    render(<SiteList rows={[ROWS[3]]} />);
    const link = screen.getByRole('link', { name: /한밭대 시험동/ });
    expect(link.textContent).toContain('최근 -');
    expect(within(link).getByText('판정 없음')).toBeInTheDocument();
    expect(within(link).queryByRole('img')).toBeNull();
    expect(link.textContent).not.toContain('0 · 0 · 0');
  });

  it('줄 끝 화살표는 Icon 컴포넌트(chevron-right)다(이모지·딩뱃 금지)', () => {
    const { container } = render(<SiteList rows={[ROWS[0]]} />);
    expect(container.querySelector('[data-icon="chevron-right"]')).toBeInTheDocument();
  });
});

describe('siteStatus (처리 중 > 판정 불가 > 완료 > 분석 없음)', () => {
  it.each([
    { name: '처리 중이 있으면 판정 불가·완료보다 앞선다',
      r: { counts: { pass: 1, warn: 0, fail: 0 }, na: 2, inProgress: 3 }, type: 'in-progress', label: '처리 중 3건' },
    { name: '처리 중이 없고 판정 불가가 있으면 pending',
      r: { counts: { pass: 6, warn: 1, fail: 0 }, na: 3, inProgress: 0 }, type: 'pending', label: '판정 불가 3건' },
    { name: '판정이 하나라도 있으면 완료',
      r: { counts: { pass: 0, warn: 0, fail: 1 }, na: 0, inProgress: 0 }, type: 'success', label: '완료' },
    { name: '아무 분석도 없으면 분석 없음',
      r: { counts: { pass: 0, warn: 0, fail: 0 }, na: 0, inProgress: 0 }, type: 'pending', label: '분석 없음' },
  ])('$name', ({ r, type, label }) => {
    expect(siteStatus(r)).toEqual({ type, label });
    render(<SiteList rows={[row({ id: 'x', name: 'X', ...r })]} />);
    expect(screen.getByText(label)).toHaveAttribute('data-status', type);
  });

  it('픽스처 넷의 상태가 각각 하나씩 나온다', () => {
    render(<SiteList rows={ROWS} />);
    expect(screen.getByText('처리 중 3건')).toHaveAttribute('data-status', 'in-progress');
    expect(screen.getByText('완료')).toHaveAttribute('data-status', 'success');
    expect(screen.getByText('판정 불가 3건')).toHaveAttribute('data-status', 'pending');
    expect(screen.getByText('분석 없음')).toHaveAttribute('data-status', 'pending');
  });
});

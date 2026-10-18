// RecentReportsCard(최근 보고서 카드, 아트보드 DashStatus): 제목 링크 · 상태 점과 글자 · 생성일,
// "보고서 전체 보기"(현장 보고서 탭), 보고서가 없을 때.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RecentReportsCard } from '../recent-reports-card';
import type { DashReportItem } from '@/lib/domain/site-dashboard';

const REPORTS: DashReportItem[] = [
  { id: 'r4', title: '101동 301호 거실 평활도 보고서', href: '/reports/r4', type: 'pending', label: '작성 중', date: '2026-09-03' },
  { id: 'r3', title: '101동 302호 거실 평활도·구배 분석 보고서', href: '/reports/r3', type: 'in-progress', label: 'PDF 생성 중', date: '2026-09-03' },
  { id: 'r1', title: '102동 301호 거실 평활도 분석 보고서', href: '/reports/r1', type: 'error', label: '생성 실패', date: '2026-08-30' },
];

describe('RecentReportsCard', () => {
  it('제목 "최근 보고서"에 보이는 건수를 붙이고, 줄마다 제목 링크 · 상태 · 생성일을 그린다', () => {
    render(<RecentReportsCard siteId="s1" reports={REPORTS} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/최근 보고서\s*\(3\)/);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    const first = items[0];
    expect(within(first).getByRole('link', { name: '101동 301호 거실 평활도 보고서' })).toHaveAttribute('href', '/reports/r4');
    expect(within(first).getByText('작성 중')).toHaveAttribute('data-status', 'pending');
    expect(within(first).getByText('2026-09-03')).toBeInTheDocument();
    expect(within(items[1]).getByText('PDF 생성 중')).toHaveAttribute('data-status', 'in-progress');
    expect(within(items[2]).getByText('생성 실패')).toHaveAttribute('data-status', 'error');
  });

  it('"보고서 전체 보기"는 이 현장의 보고서 탭으로 간다', () => {
    render(<RecentReportsCard siteId="s1" reports={REPORTS} />);
    expect(screen.getByRole('link', { name: '보고서 전체 보기' })).toHaveAttribute('href', '/sites/s1/reports');
  });

  it('보고서가 없으면 안내 문구와 "보고서 전체 보기"만 둔다', () => {
    render(<RecentReportsCard siteId="s1" reports={[]} />);
    expect(screen.getByText('아직 보고서가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('link', { name: '보고서 전체 보기' })).toHaveAttribute('href', '/sites/s1/reports');
  });
});

// Task 12 휴대폰 점검: 띄어쓰기 없는 긴 보고서 제목이 카드와 화면 밖으로 나갔다(1440 가로 스크롤 1561/1440)
describe('RecentReportsCard 긴 제목', () => {
  it('제목 링크는 overflow-wrap:anywhere 다', () => {
    const title = 'NorthEastWingBuilding101Extension/Floor03Mezzanine/Penthouse3301SouthTerrace 평활도 보고서';
    render(<RecentReportsCard siteId="s1" reports={[{ ...REPORTS[0], title }]} />);
    expect(screen.getByRole('link', { name: title }).className.split(' ')).toContain('[overflow-wrap:anywhere]');
  });
});

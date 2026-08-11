import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusDot } from '../status-dot';
import { Badge } from '../badge';
import { MetricCard, VerdictBar } from '../metric-card';
import { PageHeader } from '../page-header';
import { EmptyState } from '../empty-state';

describe('ui primitives', () => {
  it('StatusDot: 의미색 4종 + busy가 라벨과 함께 렌더된다', () => {
    render(<StatusDot tone="pass" label="적합" />);
    expect(screen.getByText('적합')).toBeInTheDocument();
  });
  it('Badge: tone별 클래스가 배경 -50 / 텍스트 -700 규칙을 따른다', () => {
    render(<Badge tone="fail">재시공</Badge>);
    const el = screen.getByText('재시공');
    expect(el.className).toContain('bg-red-50');
    expect(el.className).toContain('text-red-700');
  });
  it('MetricCard: 수치가 모노스페이스로, 단위가 분리 렌더된다', () => {
    render(<MetricCard label="스캔" value={12} unit="건" />);
    expect(screen.getByText('12').className).toContain('font-mono');
    expect(screen.getByText('건')).toBeInTheDocument();
  });
  it('VerdictBar: 합계 0이면 비어 있음 표시, 아니면 세그먼트 3개', () => {
    const { container, rerender } = render(<VerdictBar counts={{ pass: 0, warn: 0, fail: 0 }} />);
    expect(container.textContent).toContain('판정 없음');
    rerender(<VerdictBar counts={{ pass: 2, warn: 1, fail: 1 }} />);
    expect(container.querySelectorAll('[data-seg]').length).toBe(3);
  });
  it('PageHeader: 브레드크럼 링크와 제목이 렌더된다', () => {
    render(<PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '101동' }]} title="스캔 상세" />);
    expect(screen.getByRole('link', { name: '현장' })).toHaveAttribute('href', '/');
    expect(screen.getByText('스캔 상세')).toBeInTheDocument();
  });
  it('EmptyState: 행동 버튼이 항상 있다', () => {
    render(<EmptyState message="보고서가 없습니다" actionHref="/reports/new" actionLabel="새 보고서" />);
    expect(screen.getByRole('link', { name: '새 보고서' })).toHaveAttribute('href', '/reports/new');
  });
});

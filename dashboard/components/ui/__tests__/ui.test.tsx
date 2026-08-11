import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusDot } from '../status-dot';
import { Badge } from '../badge';
import { MetricCard, VerdictBar } from '../metric-card';
import { PageHeader } from '../page-header';
import { EmptyState } from '../empty-state';

describe('ui primitives', () => {
  it.each([
    { tone: 'pass' as const, dotClass: 'bg-green-600' },
    { tone: 'warn' as const, dotClass: 'bg-amber-500' },
    { tone: 'fail' as const, dotClass: 'bg-red-600' },
    { tone: 'unknown' as const, dotClass: 'bg-zinc-400' },
    { tone: 'busy' as const, dotClass: 'bg-zinc-500' },
  ])('StatusDot: $tone이 라벨과 dot 클래스와 함께 렌더된다', ({ tone, dotClass }) => {
    const { container } = render(<StatusDot tone={tone} label={tone} />);
    expect(screen.getByText(tone)).toBeInTheDocument();
    const dot = container.querySelector(`span.${dotClass}`);
    expect(dot).toBeInTheDocument();
  });
  it.each([
    { tone: 'pass' as const, bg: 'bg-green-50', text: 'text-green-700' },
    { tone: 'warn' as const, bg: 'bg-amber-50', text: 'text-amber-700' },
    { tone: 'fail' as const, bg: 'bg-red-50', text: 'text-red-700' },
    { tone: 'unknown' as const, bg: 'bg-zinc-100', text: 'text-zinc-600' },
    { tone: 'neutral' as const, bg: 'bg-zinc-100', text: 'text-zinc-600' },
  ])('Badge: $tone이 배경·텍스트 클래스 규칙을 따른다', ({ tone, bg, text }) => {
    render(<Badge tone={tone}>{tone}</Badge>);
    const el = screen.getByText(tone);
    expect(el.className).toContain(bg);
    expect(el.className).toContain(text);
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

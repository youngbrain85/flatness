import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, LinkButton, buttonClass } from '../button';
import { Container } from '../container';
import { FormField, SelectWrap, inputClass, selectClass } from '../form';
import { StatusIndicator, TONE_STATUS } from '../status-indicator';
import { Badge, TONE } from '../badge';
import { Breadcrumbs } from '../breadcrumbs';
import { PageHeader } from '../page-header';
import { KeyValuePairs, StatValue } from '../key-value';
import { tableClass } from '../data-table';
import { Alert } from '../alert';
import { ProgressBar } from '../progress-bar';
import { TabBar } from '../tab-bar';
import { VerdictBar, VerdictLegend } from '../verdict-bar';
import { EmptyState } from '../empty-state';
import { Spinner } from '../spinner';
import { PAGE_MAIN } from '../page';

describe('ui primitives (Cloudscape 해부)', () => {
  it('PAGE_MAIN은 본문 padding 20px 40px 40px + gap 20px 이다', () => {
    expect(PAGE_MAIN).toBe('flex flex-col gap-5 px-10 pb-10 pt-5');
  });

  it.each([
    { variant: 'primary' as const, has: ['bg-cs-link', 'text-white'] },
    { variant: 'normal' as const, has: ['border-cs-link', 'text-cs-link'] },
  ])('Button $variant: 알약(32px, radius 20px, 700) + 변형 클래스', ({ variant, has }) => {
    render(<Button variant={variant}>실행</Button>);
    const b = screen.getByRole('button', { name: '실행' });
    for (const c of ['h-8', 'rounded-full', 'border-2', 'font-bold', ...has]) expect(b.className).toContain(c);
  });
  it('disabled 버튼은 cs-disabled 보더·글자, primary 채움을 잃는다', () => {
    render(<Button variant="primary" disabled>실행</Button>);
    const b = screen.getByRole('button', { name: '실행' });
    expect(b).toBeDisabled();
    expect(b.className).toContain('border-cs-disabled');
    expect(b.className).not.toContain('bg-cs-link');
    expect(buttonClass('primary', { full: true })).toContain('w-full');
  });
  it('LinkButton은 href를 가진 링크로 렌더된다', () => {
    render(<LinkButton href="/upload" variant="primary">스캔 업로드</LinkButton>);
    expect(screen.getByRole('link', { name: '스캔 업로드' })).toHaveAttribute('href', '/upload');
  });

  it('Container: 제목·카운터·액션·본문, 그림자·16px 라운드', () => {
    const { container } = render(
      <Container title="현장" counter={6} actions={<button>새 현장</button>}><p>본문</p></Container>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('shadow-cs-container');
    expect(root.className).toContain('rounded-cs-container');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('현장(6)');
    expect(screen.getByRole('button', { name: '새 현장' })).toBeInTheDocument();
    expect(screen.getByText('본문').parentElement?.className).toContain('p-5');
  });
  it('Container padded={false}는 본문 padding이 없고, 헤더 없이도 렌더된다', () => {
    const { container } = render(<Container padded={false}><table /></Container>);
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('table')?.parentElement?.className).not.toContain('p-5');
  });

  it('FormField: 라벨(700)·설명·오류를 그린다', () => {
    render(
      <FormField label="현장명" htmlFor="name" description="필수" error="입력하세요">
        <input id="name" className={inputClass} />
      </FormField>,
    );
    expect(screen.getByLabelText('현장명').className).toContain('border-cs-input-border');
    expect(screen.getByText('현장명').className).toContain('font-bold');
    expect(screen.getByText('필수').className).toContain('text-cs-text-secondary');
    expect(screen.getByText('입력하세요').className).toContain('text-cs-error');
  });
  it('SelectWrap은 셀렉트 뒤에 chevron 아이콘을 얹는다', () => {
    const { container } = render(<SelectWrap><select className={selectClass}><option>a</option></select></SelectWrap>);
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
    expect(selectClass).toContain('appearance-none');
  });

  it.each([
    { type: 'success' as const, icon: 'check-circle', color: 'text-cs-success' },
    { type: 'warning' as const, icon: 'alert-triangle', color: 'text-cs-warning' },
    { type: 'error' as const, icon: 'x-circle', color: 'text-cs-error' },
    { type: 'in-progress' as const, icon: 'clock', color: 'text-cs-text-secondary' },
    { type: 'pending' as const, icon: 'minus-circle', color: 'text-cs-na' },
    { type: 'info' as const, icon: 'info-circle', color: 'text-cs-link' },
  ])('StatusIndicator $type: 아이콘 $icon + 색', ({ type, icon, color }) => {
    const { container } = render(<StatusIndicator type={type}>상태</StatusIndicator>);
    const el = screen.getByText('상태');
    expect(el.getAttribute('data-status')).toBe(type);
    expect(el.className).toContain(color);
    expect(container.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
  });
  it('TONE_STATUS는 Badge 톤 5종을 StatusIndicator 타입으로 잇는다', () => {
    expect(TONE_STATUS).toEqual({ pass: 'success', warn: 'warning', fail: 'error', unknown: 'pending', busy: 'in-progress' });
  });

  it.each([
    { tone: 'pass' as const, bg: 'bg-cs-success-bg', text: 'text-cs-success' },
    { tone: 'warn' as const, bg: 'bg-cs-warning-bg', text: 'text-cs-warning' },
    { tone: 'fail' as const, bg: 'bg-cs-error-bg', text: 'text-cs-error' },
    { tone: 'unknown' as const, bg: 'bg-cs-divider', text: 'text-cs-text-secondary' },
    { tone: 'neutral' as const, bg: 'bg-cs-divider', text: 'text-cs-text-secondary' },
    { tone: 'external' as const, bg: 'bg-cs-external-bg', text: 'text-cs-external' },
  ])('Badge $tone: cs 토큰 배경·글자', ({ tone, bg, text }) => {
    render(<Badge tone={tone}>{tone}</Badge>);
    const el = screen.getByText(tone);
    expect(el.className).toContain(bg);
    expect(el.className).toContain(text);
  });
  it('TONE.busy 점은 보조색이다(StatusDot 호환 필드)', () => {
    expect(TONE.busy.dot).toBe('bg-cs-text-secondary');
  });

  it('Breadcrumbs: 마지막 항목은 링크가 아니고 보조색, 구분은 chevron', () => {
    const { container } = render(<Breadcrumbs items={[{ href: '/', label: '현장' }, { label: '설정' }]} />);
    expect(screen.getByRole('link', { name: '현장' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: '설정' })).toBeNull();
    expect(screen.getByText('설정').className).toContain('text-cs-text-secondary');
    expect(container.querySelectorAll('[data-icon="chevron-right"]').length).toBe(1);
  });
  it('PageHeader: 브레드크럼 + h1 24px + 설명 + 액션', () => {
    render(<PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '설정' }]} title="설정" description="계정과 기준" actions={<button>저장</button>} />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('설정');
    expect(h1.className).toContain('text-2xl');
    expect(screen.getByText('계정과 기준').className).toContain('text-cs-text-secondary');
    expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument();
  });

  it('KeyValuePairs: 두 번째 열부터 세로 구분선, 라벨 700', () => {
    const { container } = render(<KeyValuePairs columns={2} items={[{ label: '현장', value: '6' }, { label: '스캔', value: '130' }]} />);
    const cells = container.querySelectorAll('dl > div');
    expect(cells[0].className).not.toContain('border-l');
    expect(cells[1].className).toContain('border-l');
    expect(screen.getByText('현장').className).toContain('font-bold');
  });
  it('StatValue: 28px 700 tabular 수치 + 보조색 단위', () => {
    render(<StatValue value={130} unit="건" />);
    expect(screen.getByText('130').className).toContain('tabular-nums');
    expect(screen.getByText('건').className).toContain('text-cs-text-secondary');
  });

  it('tableClass: 헤더 40px 700, 행 44px, 셀 padding 20px, 수치 열 mono 우측', () => {
    expect(tableClass.th).toContain('h-10');
    expect(tableClass.th).toContain('font-bold');
    expect(tableClass.td).toContain('h-11');
    expect(tableClass.td).toContain('px-5');
    expect(tableClass.tdNum).toContain('font-mono');
    expect(tableClass.tdNum).toContain('text-right');
    expect(tableClass.row).toContain('border-cs-divider');
    expect(tableClass.link).toContain('text-cs-link');
  });

  it.each([
    { type: 'info' as const, cls: 'border-cs-link', icon: 'info-circle' },
    { type: 'success' as const, cls: 'border-cs-success', icon: 'check-circle' },
    { type: 'warning' as const, cls: 'border-cs-warning', icon: 'alert-triangle' },
    { type: 'error' as const, cls: 'border-cs-error', icon: 'x-circle' },
  ])('Alert $type: 2px 보더·배경·아이콘', ({ type, cls, icon }) => {
    const { container } = render(<Alert type={type} title="제목">내용</Alert>);
    const root = container.querySelector(`[data-alert="${type}"]`) as HTMLElement;
    expect(root.className).toContain(cls);
    expect(root.className).toContain('rounded-xl');
    expect(container.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
    expect(screen.getByText('제목').className).toContain('font-bold');
  });

  it('ProgressBar: 0~100으로 자르고 %를 표시한다', () => {
    render(<ProgressBar value={162} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('TabBar: 활성 탭은 aria-selected, 클릭하면 onChange', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={[{ id: 'a', label: '히트맵' }, { id: 'b', label: '편차맵' }]} active="a" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: '히트맵' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '히트맵' }).className).toContain('border-cs-link');
    fireEvent.click(screen.getByRole('tab', { name: '편차맵' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('VerdictBar: 합계 0이면 비어 있음 표시, 아니면 세그먼트 3개(cs 색)', () => {
    const { container, rerender } = render(<VerdictBar counts={{ pass: 0, warn: 0, fail: 0 }} />);
    expect(container.textContent).toContain('판정 없음');
    rerender(<VerdictBar counts={{ pass: 2, warn: 1, fail: 1 }} />);
    const segs = container.querySelectorAll('[data-seg]');
    expect(segs.length).toBe(3);
    expect(segs[0].className).toContain('bg-cs-success');
  });
  it('VerdictLegend: 적합·주의·재시공(+불가) 건수를 점과 함께 나열한다', () => {
    render(<VerdictLegend counts={{ pass: 93, warn: 21, fail: 9 }} na={3} />);
    expect(screen.getByText('적합 93')).toBeInTheDocument();
    expect(screen.getByText('주의 21')).toBeInTheDocument();
    expect(screen.getByText('재시공 9')).toBeInTheDocument();
    expect(screen.getByText('불가 3')).toBeInTheDocument();
  });

  it('EmptyState: 행동 버튼(primary)이 항상 있다', () => {
    render(<EmptyState message="보고서가 없습니다" actionHref="/reports/new" actionLabel="새 보고서" />);
    const link = screen.getByRole('link', { name: '새 보고서' });
    expect(link).toHaveAttribute('href', '/reports/new');
    expect(link.className).toContain('bg-cs-link');
  });

  it.each([
    { size: undefined, sizeClass: 'h-8 w-8' },
    { size: 'sm' as const, sizeClass: 'h-4 w-4' },
  ])('Spinner: role="status"와 sr-only 안내 텍스트(size=$size)', ({ size, sizeClass }) => {
    render(size === undefined ? <Spinner /> : <Spinner size={size} />);
    const status = screen.getByRole('status');
    expect(status.className).toContain('animate-spin');
    for (const cls of sizeClass.split(' ')) expect(status.className).toContain(cls);
    expect(screen.getByText('불러오는 중')).toHaveClass('sr-only');
  });
});

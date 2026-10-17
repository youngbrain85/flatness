import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, LinkButton, buttonClass } from '../button';
import { Container } from '../container';
import { FormField, SelectWrap, checkClass, inputClass, selectClass, textareaClass } from '../form';
import { SCAN_STATUS_TYPE, StatusIndicator, TONE_STATUS } from '../status-indicator';
import { Badge, TONE } from '../badge';
import { Breadcrumbs } from '../breadcrumbs';
import { PageHeader } from '../page-header';
import { KeyValuePairs, StatValue } from '../key-value';
import { TableBox, tableClass } from '../data-table';
import { Alert } from '../alert';
import { ProgressBar } from '../progress-bar';
import { TabBar } from '../tab-bar';
import { VerdictBar, VerdictLegend } from '../verdict-bar';
import { EmptyState } from '../empty-state';
import { Spinner } from '../spinner';
import { Icon } from '../icons';
import { MAIN_BG, PAGE_MAIN } from '../page';

// 클래스는 토큰으로 쪼개 본다. 'hover:bg-ink-2'도 문자열로는 'bg-ink'를 포함하므로 toContain 으로는
// 접두사 붙은 클래스와 맨 클래스를 구별하지 못한다(옛 KeyValuePairs 'md:border-l' 사고와 같은 함정).
// SVG 의 className 은 문자열이 아니라서 getAttribute('class') 로 읽는다.
const cls = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('ui primitives (다크 C안)', () => {
  it('PAGE_MAIN은 아트보드 본문 틀(최대 1360px, 위 clamp(18,2.6vw,28) · 옆 clamp(16,3vw,40) · 아래 56px, 간격 20px)이다', () => {
    expect(PAGE_MAIN).toBe('mx-auto flex w-full max-w-[1360px] flex-col gap-5 px-[clamp(16px,3vw,40px)] pb-14 pt-[clamp(18px,2.6vw,28px)]');
  });
  it('MAIN_BG는 ground 바탕 + 도면 격자 유틸리티(globals.css drafting-grid)다', () => {
    expect(MAIN_BG).toBe('bg-ground drafting-grid');
  });

  it.each([
    { variant: 'primary' as const, has: ['bg-ink', 'text-ground', 'border-ink', 'font-semibold'] },
    { variant: 'normal' as const, has: ['bg-transparent', 'text-ink', 'border-line-3', 'font-medium'] },
    { variant: 'danger' as const, has: ['bg-transparent', 'text-err', 'border-err', 'font-semibold'] },
  ])('Button $variant: 높이 44px · 반지름 6px · 1px 테두리 · 15px + 변형 색', ({ variant, has }) => {
    render(<Button variant={variant}>실행</Button>);
    const c = cls(screen.getByRole('button', { name: '실행' }));
    for (const k of ['min-h-11', 'rounded-control', 'border', 'text-[15px]', ...has]) expect(c).toContain(k);
  });
  it('Button 기본 변형은 normal이고 type=button이다', () => {
    render(<Button>보조</Button>);
    const b = screen.getByRole('button', { name: '보조' });
    expect(b).toHaveAttribute('type', 'button');
    expect(cls(b)).toContain('border-line-3');
  });
  it('disabled 버튼은 변형 색을 버리고 line-3 테두리 + dim 글자 + not-allowed다(primary 채움 없음)', () => {
    render(<Button variant="primary" disabled>실행</Button>);
    const b = screen.getByRole('button', { name: '실행' });
    expect(b).toBeDisabled();
    const c = cls(b);
    for (const k of ['cursor-not-allowed', 'border-line-3', 'bg-transparent', 'text-dim']) expect(c).toContain(k);
    expect(c).not.toContain('bg-ink');
    expect(c).toContain('font-semibold'); // 굵기는 변형 그대로(아트보드 ScanProcessing 의 잠긴 버튼)
  });
  it('buttonClass: full이면 w-full, danger 비활성도 err 색을 버린다', () => {
    expect(buttonClass('primary', { full: true }).split(' ')).toContain('w-full');
    const dangerOff = buttonClass('danger', { disabled: true }).split(' ');
    expect(dangerOff).toContain('text-dim');
    expect(dangerOff).not.toContain('text-err');
  });
  it('LinkButton은 href를 가진 링크로 렌더되고 같은 모양을 쓴다', () => {
    render(<LinkButton href="/sites/s1/upload" variant="primary">스캔 업로드</LinkButton>);
    const a = screen.getByRole('link', { name: '스캔 업로드' });
    expect(a).toHaveAttribute('href', '/sites/s1/upload');
    expect(cls(a)).toEqual(expect.arrayContaining(['min-h-11', 'bg-ink']));
  });

  it('Container: surface 카드(line-2 · 12px), 제목 h2 19px 600 + 카운터(mono muted) + 액션, 본문 여백 20px 22px', () => {
    const { container } = render(
      <Container title="현장" counter={6} actions={<button>새 현장</button>}><p>본문</p></Container>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('SECTION');
    expect(cls(root)).toEqual(expect.arrayContaining(['bg-surface', 'border', 'border-line-2', 'rounded-card']));
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.textContent).toBe('현장(6)');
    expect(cls(h2)).toEqual(expect.arrayContaining(['font-heading', 'text-[19px]', 'font-semibold']));
    expect(cls(screen.getByText('(6)'))).toEqual(expect.arrayContaining(['font-mono', 'text-muted']));
    expect(screen.getByRole('button', { name: '새 현장' })).toBeInTheDocument();
    expect(cls(screen.getByText('본문').parentElement)).toEqual(expect.arrayContaining(['px-[22px]', 'pb-5']));
    expect(root.className).not.toMatch(/shadow|cs-/);
  });
  it('Container padded={false}는 본문 여백이 없고 모서리를 자르며, 헤더 없이도 렌더된다', () => {
    const { container } = render(<Container padded={false}><table /></Container>);
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('table')?.parentElement?.className).toBe('');
    expect(cls(container.firstElementChild)).toContain('overflow-hidden');
  });

  it('FormField: 라벨(14px 600) 위 · 입력 · 도움말(13px muted) · 오류(err) 순서로 그린다', () => {
    render(
      <FormField label="현장명" htmlFor="name" description="필수" error="입력하세요">
        <input id="name" className={inputClass} />
      </FormField>,
    );
    const input = screen.getByLabelText('현장명');
    expect(cls(input)).toEqual(expect.arrayContaining(['min-h-11', 'border', 'border-line-3', 'bg-ground', 'rounded-control', 'text-[15px]']));
    expect(cls(screen.getByText('현장명'))).toEqual(expect.arrayContaining(['text-sm', 'font-semibold']));
    expect(cls(screen.getByText('필수'))).toContain('text-muted');
    expect(cls(screen.getByText('입력하세요'))).toContain('text-err');
    // 도움말은 입력칸 아래(아트보드 입력 필드)
    expect(input.compareDocumentPosition(screen.getByText('필수')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('입력 프리셋: select는 appearance-none + 화살표 자리, textarea는 112px, 체크·라디오는 accent ink', () => {
    expect(selectClass.split(' ')).toEqual(expect.arrayContaining(['appearance-none', 'pr-10', 'border-line-3']));
    expect(textareaClass.split(' ')).toEqual(expect.arrayContaining(['min-h-28', 'border-line-3', 'bg-ground']));
    expect(checkClass.split(' ')).toContain('accent-ink');
    // 포커스 외곽선은 globals.css :focus-visible 이 그린다 - 프리셋이 외곽선을 끄면 안 된다
    for (const c of [inputClass, selectClass, textareaClass]) expect(c).not.toContain('outline-none');
  });
  it('SelectWrap은 셀렉트 뒤에 chevron 아이콘을 얹는다', () => {
    const { container } = render(<SelectWrap><select className={selectClass}><option>a</option></select></SelectWrap>);
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
  });

  it.each([
    { type: 'success' as const, dot: 'bg-ok' },
    { type: 'warning' as const, dot: 'bg-warn' },
    { type: 'error' as const, dot: 'bg-err' },
    { type: 'pending' as const, dot: 'bg-muted' },
    { type: 'info' as const, dot: 'bg-ink-2' },
  ])('StatusIndicator $type: 8px 점($dot) + ink 글자', ({ type, dot }) => {
    render(<StatusIndicator type={type}>상태</StatusIndicator>);
    const el = screen.getByText('상태');
    expect(el).toHaveAttribute('data-status', type);
    expect(cls(el)).toEqual(expect.arrayContaining(['text-sm', 'text-ink']));
    const d = el.querySelector('[data-dot]');
    expect(d).toHaveAttribute('aria-hidden', 'true');
    expect(cls(d)).toEqual(expect.arrayContaining(['h-2', 'w-2', 'rounded-full', dot]));
  });
  it('StatusIndicator in-progress는 속 빈 ink 고리다(채움 없음)', () => {
    render(<StatusIndicator type="in-progress">분석 중</StatusIndicator>);
    const d = screen.getByText('분석 중').querySelector('[data-dot]');
    expect(cls(d)).toEqual(expect.arrayContaining(['border-2', 'border-ink', 'bg-transparent']));
  });
  it('StatusIndicator는 아이콘을 그리지 않는다(점으로 바뀌었다)', () => {
    const { container } = render(<StatusIndicator type="success">완료</StatusIndicator>);
    expect(container.querySelector('[data-icon]')).toBeNull();
  });
  it('TONE_STATUS·SCAN_STATUS_TYPE 매핑은 그대로다', () => {
    expect(TONE_STATUS).toEqual({ pass: 'success', warn: 'warning', fail: 'error', unknown: 'pending', busy: 'in-progress' });
    expect(SCAN_STATUS_TYPE).toEqual({
      uploaded: 'in-progress', awaiting_unit_confirm: 'pending', ready: 'success', archived: 'pending', failed: 'error',
    });
  });

  it.each([
    { tone: 'pass' as const, border: 'border-ok', text: 'text-ok' },
    { tone: 'warn' as const, border: 'border-warn', text: 'text-warn' },
    { tone: 'fail' as const, border: 'border-err', text: 'text-err' },
    { tone: 'unknown' as const, border: 'border-dim', text: 'text-dim' },
    { tone: 'neutral' as const, border: 'border-line-3', text: 'text-ink-2' },
    { tone: 'external' as const, border: 'border-ink-2', text: 'text-ink-2' },
  ])('Badge $tone: 1px 테두리 태그($border) + 같은 색 글자, mono 11px, data-tone', ({ tone, border, text }) => {
    render(<Badge tone={tone}>{tone}</Badge>);
    const el = screen.getByText(tone);
    expect(el).toHaveAttribute('data-tone', tone);
    expect(cls(el)).toEqual(expect.arrayContaining(['border', border, text, 'font-mono', 'text-[11px]', 'rounded-control', 'min-h-[22px]']));
    expect(el.className).not.toMatch(/\bbg-/);
  });
  it('외부 결과 배지는 점선 테두리다', () => {
    render(<Badge tone="external">외부 결과</Badge>);
    expect(cls(screen.getByText('외부 결과'))).toContain('border-dashed');
  });
  it('TONE은 채움(bg) 없이 { border, text, dot } 이다', () => {
    for (const t of Object.values(TONE)) expect(Object.keys(t).sort()).toEqual(['border', 'dot', 'text']);
    expect(TONE.busy.dot).toBe('bg-ink');
  });

  it('Breadcrumbs: nav "위치", 구분자 "/"(장식), 링크 ink-2, 마지막은 비링크 + aria-current=page', () => {
    render(<Breadcrumbs items={[
      { href: '/sites/s1/locations', label: '측정위치' },
      { href: '/sites/s1/locations#loc-l1', label: '101동 · 3층 · 301호 · 거실' },
      { label: '스캔 · 바닥 · 2026-09-03' },
    ]} />);
    const nav = screen.getByRole('navigation', { name: '위치' });
    expect(cls(nav)).toEqual(expect.arrayContaining(['font-mono', 'text-xs', 'text-dim']));
    const first = screen.getByRole('link', { name: '측정위치' });
    expect(first).toHaveAttribute('href', '/sites/s1/locations');
    expect(cls(first)).toContain('text-ink-2');
    const last = screen.getByText('스캔 · 바닥 · 2026-09-03');
    expect(last.tagName).toBe('SPAN');
    expect(last).toHaveAttribute('aria-current', 'page');
    expect(cls(last)).toContain('text-ink');
    expect(Array.from(nav.querySelectorAll('[aria-hidden="true"]')).map((s) => s.textContent)).toEqual(['/', '/']);
    expect(nav.querySelector('[data-icon]')).toBeNull();
  });
  it('Breadcrumbs: 마지막 항목은 href가 있어도 링크로 그리지 않는다', () => {
    render(<Breadcrumbs items={[{ href: '/', label: '현장 목록' }, { href: '/settings', label: '설정' }]} />);
    expect(screen.queryByRole('link', { name: '설정' })).toBeNull();
    expect(screen.getByText('설정')).toHaveAttribute('aria-current', 'page');
  });
  it('PageHeader: 브레드크럼 + h1(Noto Sans KR 우선, clamp 24~30px, 700) + 카운터 + 설명(muted) + 액션', () => {
    render(<PageHeader crumbs={[{ href: '/', label: '현장 목록' }, { label: '설정' }]} title="측정위치" counter={14}
      description="계정과 기준" actions={<button>저장</button>} />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('측정위치');
    expect(cls(h1)).toEqual(expect.arrayContaining(['font-heading', 'text-[clamp(24px,2.6vw,30px)]', 'font-bold']));
    expect(cls(screen.getByText('(14)'))).toEqual(expect.arrayContaining(['font-mono', 'text-muted']));
    expect(cls(screen.getByText('계정과 기준'))).toContain('text-muted');
    expect(screen.getByRole('navigation', { name: '위치' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument();
  });
  it('PageHeader: crumbs·counter가 없으면 그리지 않는다', () => {
    render(<PageHeader title="보고서" />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).parentElement?.textContent).toBe('보고서');
  });

  it.each([
    { columns: 2 as const, min: '240px' },
    { columns: 3 as const, min: '180px' },
    { columns: 4 as const, min: '140px' },
  ])('KeyValuePairs(columns=$columns): auto-fit 칸(최소 $min, 부모보다 넓어지지 않음)', ({ columns, min }) => {
    const { container } = render(<KeyValuePairs columns={columns} items={[{ label: '장비', value: 'iPhone' }]} />);
    expect(cls(container.querySelector('dl'))).toContain(`grid-cols-[repeat(auto-fit,minmax(min(100%,${min}),1fr))]`);
  });
  it('KeyValuePairs: 라벨은 눈썹(mono 11px 0.08em dim), 값은 15px ink, 열 사이 세로 구분선이 없다', () => {
    const { container } = render(<KeyValuePairs items={[{ label: '장비', value: 'iPhone' }, { label: '점 개수', value: '120,701' }]} />);
    expect(cls(screen.getByText('장비'))).toEqual(expect.arrayContaining(['font-mono', 'text-[11px]', 'tracking-[0.08em]', 'text-dim']));
    expect(cls(screen.getByText('iPhone'))).toEqual(expect.arrayContaining(['text-[15px]', 'text-ink']));
    expect(container.innerHTML).not.toMatch(/border-l/);
  });
  it('StatValue: Anton 40px 수치 + mono 13px muted 단위', () => {
    render(<StatValue value={130} unit="건" />);
    expect(cls(screen.getByText('130'))).toEqual(expect.arrayContaining(['font-display', 'text-[40px]', 'tabular-nums']));
    expect(cls(screen.getByText('건'))).toEqual(expect.arrayContaining(['font-mono', 'text-[13px]', 'text-muted']));
  });

  it('tableClass: 머리 mono 11px dim(줄바꿈 없음), 칸 padding 14px 16px, 행 구분 line, 수치 열 우측 mono, 링크 ink 600 밑줄', () => {
    expect(tableClass.table.split(' ')).toEqual(expect.arrayContaining(['w-full', 'border-collapse', 'text-sm']));
    for (const th of [tableClass.th, tableClass.thNum]) {
      expect(th.split(' ')).toEqual(expect.arrayContaining([
        'whitespace-nowrap', 'font-mono', 'text-[11px]', 'tracking-[0.08em]', 'text-dim', 'border-b', 'border-line-2',
      ]));
    }
    expect(tableClass.thNum.split(' ')).toContain('text-right');
    // 칸에는 글자 색·크기를 넣지 않는다(소비자가 덧붙이는 클래스와 같은 속성끼리 부딪히지 않게)
    expect(tableClass.td.split(' ')).toEqual(['px-4', 'py-3.5']);
    expect(tableClass.tdNum.split(' ')).toEqual(expect.arrayContaining(['text-right', 'font-mono', 'tabular-nums']));
    expect(tableClass.row.split(' ')).toEqual(expect.arrayContaining(['border-b', 'border-line', 'last:border-b-0']));
    expect(tableClass.link.split(' ')).toEqual(expect.arrayContaining(['font-semibold', 'text-ink', 'underline', 'decoration-line-3']));
  });
  it('TableBox: surface 상자(line-2 · 12px) 안에서만 가로 스크롤하고 안쪽 표 최소 폭은 720px이다', () => {
    const { container } = render(<TableBox><tbody><tr><td>값</td></tr></tbody></TableBox>);
    const box = container.firstElementChild as HTMLElement;
    expect(cls(box)).toEqual(expect.arrayContaining(['overflow-x-auto', 'bg-surface', 'border', 'border-line-2', 'rounded-card']));
    expect(cls(box.querySelector('table'))).toEqual(expect.arrayContaining(['w-full', 'min-w-[720px]']));
  });
  it('TableBox minWidth={960}·toolbar: 도구 줄 상자가 위에 붙고 표 상자는 아래 모서리만 둥글다', () => {
    const { container } = render(
      <TableBox minWidth={960} toolbar={<input aria-label="보고서 검색" />}><tbody><tr><td>값</td></tr></tbody></TableBox>,
    );
    const [bar, box] = Array.from(container.firstElementChild!.children);
    expect(bar.querySelector('input[aria-label="보고서 검색"]')).not.toBeNull();
    expect(cls(bar)).toEqual(expect.arrayContaining(['rounded-t-card', 'border-line-2', 'bg-surface']));
    expect(cls(box)).toEqual(expect.arrayContaining(['rounded-b-card', 'border-t-0', 'overflow-x-auto']));
    expect(cls(box.querySelector('table'))).toContain('min-w-[960px]');
  });

  it.each([
    { type: 'info' as const, border: 'border-line-3', icon: 'info-circle', role: null },
    { type: 'success' as const, border: 'border-ok', icon: 'check-circle', role: 'status' },
    { type: 'warning' as const, border: 'border-warn', icon: 'alert-triangle', role: 'status' },
    { type: 'error' as const, border: 'border-err', icon: 'alert-circle', role: 'alert' },
  ])('Alert $type: ground 바탕 + 1px $border + 6px 반지름 + $icon 아이콘, role=$role', ({ type, border, icon, role }) => {
    const { container } = render(<Alert type={type} title="제목">내용</Alert>);
    const root = container.querySelector(`[data-alert="${type}"]`) as HTMLElement;
    expect(cls(root)).toEqual(expect.arrayContaining(['bg-ground', 'border', border, 'rounded-control']));
    expect(root.getAttribute('role')).toBe(role);
    expect(root.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
    expect(cls(screen.getByText('제목'))).toEqual(expect.arrayContaining(['text-sm', 'font-semibold', 'text-ink']));
    expect(cls(screen.getByText('내용'))).toEqual(expect.arrayContaining(['text-[13px]', 'text-ink-2']));
  });

  it('ProgressBar: 0~100으로 자르고, 바탕 line · 채움 ink · 높이 6px, %는 mono', () => {
    render(<ProgressBar value={162} label="업로드" />);
    const bar = screen.getByRole('progressbar', { name: '업로드' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(cls(bar)).toEqual(expect.arrayContaining(['h-1.5', 'rounded-full', 'bg-line']));
    expect(cls(bar.firstElementChild)).toContain('bg-ink');
    expect(cls(screen.getByText('100%'))).toContain('font-mono');
  });

  it('TabBar: 44px 알약 탭, 활성 = ink 테두리 + surface-2 + 600, aria-selected, 클릭하면 onChange', () => {
    const onChange = vi.fn();
    render(<TabBar label="결과 보기" tabs={[{ id: 'a', label: '히트맵' }, { id: 'b', label: '정밀 편차맵' }]} active="a" onChange={onChange} />);
    expect(screen.getByRole('tablist', { name: '결과 보기' })).toBeInTheDocument();
    const on = screen.getByRole('tab', { name: '히트맵' });
    const off = screen.getByRole('tab', { name: '정밀 편차맵' });
    expect(on).toHaveAttribute('aria-selected', 'true');
    expect(off).toHaveAttribute('aria-selected', 'false');
    expect(cls(on)).toEqual(expect.arrayContaining(['min-h-11', 'rounded-full', 'border-ink', 'bg-surface-2', 'font-semibold']));
    expect(cls(off)).toEqual(expect.arrayContaining(['border-line-3', 'text-ink-2']));
    fireEvent.click(off);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('VerdictBar: 합계 0이면 "판정 없음", 아니면 등급 색 세그먼트 + 새 3묶음 이름의 그림 설명', () => {
    const { container, rerender } = render(<VerdictBar counts={{ pass: 0, warn: 0, fail: 0 }} />);
    expect(container.textContent).toContain('판정 없음');
    rerender(<VerdictBar counts={{ pass: 31, warn: 6, fail: 2 }} />);
    const bar = screen.getByRole('img', { name: '적합 31, 경계 6, 보수·재시공 2' });
    expect(cls(bar)).toEqual(expect.arrayContaining(['h-2', 'rounded-full', 'bg-line']));
    const segs = Array.from(container.querySelectorAll('[data-seg]'));
    expect(segs.map((s) => s.getAttribute('data-seg'))).toEqual(['pass', 'warn', 'fail']);
    expect(segs.map((s) => s.className)).toEqual(['bg-grade-pass', 'bg-grade-borderline', 'bg-grade-rework']);
  });
  it('VerdictBar: 0건 묶음은 세그먼트를 그리지 않는다', () => {
    const { container } = render(<VerdictBar counts={{ pass: 2, warn: 0, fail: 1 }} />);
    expect(Array.from(container.querySelectorAll('[data-seg]')).map((s) => s.getAttribute('data-seg'))).toEqual(['pass', 'fail']);
  });
  it('VerdictLegend: "적합 n · 경계 n · 보수·재시공 n"(+ "불가 n")을 등급 색 점과 함께 나열한다', () => {
    const { container } = render(<VerdictLegend counts={{ pass: 93, warn: 21, fail: 9 }} na={3} />);
    for (const t of ['적합 93', '경계 21', '보수·재시공 9', '불가 3']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(container.textContent).not.toContain('주의');
    expect(cls(screen.getByText('불가 3').firstElementChild)).toContain('bg-grade-na');
  });

  it('EmptyState: 카드(surface · line-2 · 12px) + muted 안내 + primary 행동 버튼', () => {
    const { container } = render(<EmptyState message="보고서가 없습니다" actionHref="/reports/new" actionLabel="새 보고서" />);
    expect(cls(container.firstElementChild)).toEqual(expect.arrayContaining(['bg-surface', 'border-line-2', 'rounded-card']));
    expect(cls(screen.getByText('보고서가 없습니다'))).toContain('text-muted');
    const link = screen.getByRole('link', { name: '새 보고서' });
    expect(link).toHaveAttribute('href', '/reports/new');
    expect(cls(link)).toContain('bg-ink');
  });

  it.each([
    { size: undefined, sizeClass: ['h-8', 'w-8'] },
    { size: 'sm' as const, sizeClass: ['h-4', 'w-4'] },
  ])('Spinner: role="status", 트랙 line + 회전 호 ink, sr-only 안내(size=$size)', ({ size, sizeClass }) => {
    render(size === undefined ? <Spinner /> : <Spinner size={size} />);
    const status = screen.getByRole('status');
    expect(cls(status)).toEqual(expect.arrayContaining([
      'animate-spin', 'border-line', 'border-t-ink', 'motion-reduce:animate-none', ...sizeClass,
    ]));
    expect(screen.getByText('불러오는 중')).toHaveClass('sr-only');
  });

  it('Icon: 아트보드와 같은 1.8 선 굵기, 장식용(aria-hidden), 오류 아이콘 alert-circle 이 있다', () => {
    const { container } = render(<Icon name="alert-circle" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('stroke-width', '1.8');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-icon', 'alert-circle');
    expect(svg.querySelector('circle')).not.toBeNull();
  });
});

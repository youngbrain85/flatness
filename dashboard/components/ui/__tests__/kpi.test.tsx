// KPI 카드: 눈썹 라벨 + Anton 40px 숫자 + 단위, 판정 KPI 는 등급 점 + 등급 색 글자
// (아트보드 Stage·ScanDone 의 KPI 5장, DashStatus 의 현장 요약).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiCard, KpiGrid } from '../kpi';

const cls = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('KpiGrid', () => {
  it('auto-fit 150px 칸 + 12px 간격(휴대폰 390px 에서 2열)', () => {
    const { container } = render(<KpiGrid><div>a</div></KpiGrid>);
    expect(cls(container.firstElementChild)).toEqual(expect.arrayContaining([
      'grid', 'grid-cols-[repeat(auto-fit,minmax(150px,1fr))]', 'gap-3',
    ]));
  });
});

describe('KpiCard', () => {
  it('카드(surface · line-2 · 12px) + 눈썹 라벨 + Anton 40px 숫자 + mono 단위', () => {
    const { container } = render(<KpiCard label="최대 편차" value="15.53" unit="mm" />);
    // 여백 18px 20px(아트보드 padding: 18px 20px). 클래스가 Tailwind 에 보이는지는 __tests__/tailwind-scan.test.ts 가 지킨다
    expect(cls(container.firstElementChild)).toEqual(expect.arrayContaining(['bg-surface', 'border-line-2', 'rounded-card', 'min-w-0', 'px-5', 'py-[18px]']));
    expect(cls(screen.getByText('최대 편차'))).toEqual(expect.arrayContaining(['font-mono', 'text-[11px]', 'tracking-[0.08em]', 'text-dim']));
    expect(cls(screen.getByText('15.53'))).toEqual(expect.arrayContaining(['font-display', 'text-[40px]']));
    expect(cls(screen.getByText('mm'))).toEqual(expect.arrayContaining(['font-mono', 'text-[13px]', 'text-muted']));
  });
  it('단위가 없으면 단위 칸을 그리지 않는다', () => {
    render(<KpiCard label="측정위치" value={14} />);
    expect(screen.getByText('14').parentElement?.children).toHaveLength(1);
  });
  it('판정 KPI(tone): Anton 숫자가 아니라 등급 점 + 등급 이름을 등급 색(Noto Sans KR 30px 700)으로', () => {
    const { container } = render(<KpiCard label="판정" value="보수" tone="repair" />);
    const v = screen.getByText('보수');
    expect(v).toHaveAttribute('data-grade', 'repair');
    expect(cls(v)).toEqual(expect.arrayContaining(['font-heading', 'text-[30px]', 'font-bold', 'text-grade-repair']));
    expect(v.querySelector('[aria-hidden="true"]')).toHaveAttribute('data-grade', 'repair');
    expect(container.querySelector('.font-display')).toBeNull();
  });
  it('className 은 묶음 안 배치를, children 은 숫자 옆에 흐르는 내용을 받는다(DashStatus 분석 완료 카드)', () => {
    const { container } = render(
      <KpiCard label="분석 완료" value={39} unit="건" className="sm:col-span-2"><p>판정 분포</p></KpiCard>,
    );
    expect(cls(container.firstElementChild)).toContain('sm:col-span-2');
    const row = screen.getByText('판정 분포').parentElement!;
    expect(cls(row)).toEqual(expect.arrayContaining(['flex', 'flex-wrap']));
    expect(row.contains(screen.getByText('39'))).toBe(true);
  });
});

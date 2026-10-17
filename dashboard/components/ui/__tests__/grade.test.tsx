// 판정 등급 표시: 등급 색 다섯(스펙 §3)을 data-grade 와 함께 그린다. 3묶음 톤(Badge)으로 접지 않는다.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Grade, SlopeGrade } from '@/lib/domain/types';
import { GRADE_CLASS, GradeBadge, GradeDot, SlopeGradeBadge } from '../grade';

const cls = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('GRADE_CLASS', () => {
  it('등급마다 같은 등급 색 토큰의 글자·채움·테두리 클래스다', () => {
    const grades: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];
    for (const g of grades) {
      expect(GRADE_CLASS[g]).toEqual({ text: `text-grade-${g}`, bg: `bg-grade-${g}`, border: `border-grade-${g}` });
    }
  });
});

describe('GradeBadge', () => {
  it.each([
    ['pass', '적합'], ['borderline', '경계'], ['repair', '보수'], ['rework', '재시공'], ['na', '판정 불가'],
  ] as [Grade, string][])('%s → "%s" 테두리 태그(등급 색 테두리·글자, mono 11px)', (grade, label) => {
    render(<GradeBadge grade={grade} />);
    const el = screen.getByText(label);
    expect(el).toHaveAttribute('data-grade', grade);
    expect(cls(el)).toEqual(expect.arrayContaining([
      'border', `border-grade-${grade}`, `text-grade-${grade}`, 'font-mono', 'text-[11px]', 'rounded-control',
    ]));
  });
  it('보수와 재시공은 다른 색이다(3묶음 톤처럼 접지 않는다)', () => {
    render(<><GradeBadge grade="repair" /><GradeBadge grade="rework" /></>);
    expect(cls(screen.getByText('보수'))).not.toEqual(cls(screen.getByText('재시공')));
  });
});

describe('GradeDot', () => {
  it('기본 8px 등급 색 점이고 장식이다', () => {
    const { container } = render(<GradeDot grade="borderline" />);
    const dot = container.firstElementChild;
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveAttribute('data-grade', 'borderline');
    expect(cls(dot)).toEqual(expect.arrayContaining(['h-2', 'w-2', 'rounded-full', 'bg-grade-borderline']));
  });
  it.each([
    [10, ['h-2.5', 'w-2.5']],
    [12, ['h-3', 'w-3']],
  ] as [10 | 12, string[]][])('size=%s', (size, classes) => {
    const { container } = render(<GradeDot grade="pass" size={size} />);
    expect(cls(container.firstElementChild)).toEqual(expect.arrayContaining(classes));
  });
});

describe('SlopeGradeBadge', () => {
  it.each([
    ['적합', 'pass'], ['경계', 'borderline'], ['보수', 'repair'], ['재시공', 'rework'], ['판정불가', 'na'],
  ] as [SlopeGrade, Grade][])('구배 "%s"는 엔진 문자열 그대로 + %s 등급 색', (slope, grade) => {
    render(<SlopeGradeBadge grade={slope} />);
    const el = screen.getByText(slope);
    expect(el).toHaveAttribute('data-grade', grade);
    expect(cls(el)).toContain(`text-grade-${grade}`);
  });
  it('모르는 문자열(jsonb 무결성 미보장)은 사라지지 않고 판정 불가 색으로 그린다', () => {
    render(<SlopeGradeBadge grade={'알수없음' as SlopeGrade} />);
    const el = screen.getByText('알수없음');
    expect(el).toHaveAttribute('data-grade', 'na');
    expect(cls(el)).toContain('text-grade-na');
  });
});

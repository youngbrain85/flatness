// 판정 등급 표시: 등급 색 다섯(스펙 §3)을 data-grade 와 함께 그린다. 3묶음 톤(Badge)으로 접지 않는다.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Grade } from '@/lib/domain/types';
import { GRADE_CLASS, GradeBadge, GradeDot } from '../grade';

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

// 최종 리뷰: jsonb(cells.json 의 grade, 벽 plumb_grade)는 무결성을 보장하지 않는다. 모르는 문자열이 와도 결과 구획이
// 죽지 않게 판정 불가(na) 색으로 그리고, 배지 글자는 그 문자열 그대로 둔다(색만으로 말하지 않는다).
// 'toString'·'constructor'·'__proto__'는 Object.prototype 에서 값을 집어 오는 키다 - 자기 속성만 봐야 na 로 떨어진다.
const UNKNOWN_GRADES = ['알수없음', 'toString', 'constructor', '__proto__'];

describe('모르는 등급 문자열(jsonb 무결성 미보장)', () => {
  it.each(UNKNOWN_GRADES)('GradeBadge "%s": 던지지 않고 판정 불가 색 테두리·글자 + 그 문자열 그대로', (raw) => {
    render(<GradeBadge grade={raw as Grade} />);
    const el = screen.getByText(raw);
    expect(el).toHaveAttribute('data-grade', 'na');
    expect(cls(el)).toEqual(expect.arrayContaining(['border-grade-na', 'text-grade-na']));
    expect(cls(el)).not.toContain('undefined');
  });

  it.each(UNKNOWN_GRADES)('GradeDot "%s": 던지지 않고 판정 불가 색 점', (raw) => {
    const { container } = render(<GradeDot grade={raw as Grade} />);
    const dot = container.firstElementChild;
    expect(dot).toHaveAttribute('data-grade', 'na');
    expect(cls(dot)).toContain('bg-grade-na');
    expect(cls(dot)).not.toContain('undefined');
  });
});

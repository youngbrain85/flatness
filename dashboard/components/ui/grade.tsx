// 판정 등급 표시(스펙 §3 등급 색). 화면은 3묶음 톤(Badge)이 아니라 등급 색 넷 + 판정 불가를 그대로 쓴다.
// 요소마다 data-grade 를 달아 테스트가 클래스가 아니라 의미로 읽게 한다.
// 등급을 계산하지 않는다 - 엔진이 낸 등급 값을 색과 이름으로 바꿀 뿐이다(리트머스: 브라우저 등급 계산 금지).
import { SLOPE_GRADE_TO_GRADE } from '@/lib/domain/grade-tone';
import { GRADE_LABEL } from '@/lib/domain/labels';
import type { Grade, SlopeGrade } from '@/lib/domain/types';
import { BADGE_BASE } from './badge';

// 등급 색 클래스의 유일한 정의처. 캔버스는 같은 값을 lib/domain/palette.ts 의 SCREEN_GRADE_COLOR 로 쓴다.
export const GRADE_CLASS: Record<Grade, { text: string; bg: string; border: string }> = {
  pass: { text: 'text-grade-pass', bg: 'bg-grade-pass', border: 'border-grade-pass' },
  borderline: { text: 'text-grade-borderline', bg: 'bg-grade-borderline', border: 'border-grade-borderline' },
  repair: { text: 'text-grade-repair', bg: 'bg-grade-repair', border: 'border-grade-repair' },
  rework: { text: 'text-grade-rework', bg: 'bg-grade-rework', border: 'border-grade-rework' },
  na: { text: 'text-grade-na', bg: 'bg-grade-na', border: 'border-grade-na' },
};

export function GradeBadge({ grade }: { grade: Grade }) {
  const c = GRADE_CLASS[grade];
  return <span data-grade={grade} className={`${BADGE_BASE} ${c.border} ${c.text}`}>{GRADE_LABEL[grade]}</span>;
}

// 점 크기: 8px(표·목록의 상태 점) · 10px(히트맵 범례) · 12px(판정 KPI) - 아트보드 값
const DOT_SIZE = { 8: 'h-2 w-2', 10: 'h-2.5 w-2.5', 12: 'h-3 w-3' } as const;

export function GradeDot({ grade, size = 8 }: { grade: Grade; size?: keyof typeof DOT_SIZE }) {
  return (
    <span aria-hidden="true" data-grade={grade}
      className={`inline-block shrink-0 rounded-full ${DOT_SIZE[size]} ${GRADE_CLASS[grade].bg}`} />
  );
}

// 구배 등급은 엔진이 한글 문자열로 낸다. 글자는 엔진 문자열 그대로('판정불가' 포함) 보여 주고 색만 등급 색으로 바꾼다.
// 코드리뷰 M1 계승: jsonb 는 무결성을 보장하지 않는다 - 모르는 문자열은 조용히 사라지지 않게 판정 불가 색으로 그린다.
export function SlopeGradeBadge({ grade }: { grade: SlopeGrade }) {
  const g: Grade = SLOPE_GRADE_TO_GRADE[grade] ?? 'na';
  const c = GRADE_CLASS[g];
  return <span data-grade={g} className={`${BADGE_BASE} ${c.border} ${c.text}`}>{grade}</span>;
}

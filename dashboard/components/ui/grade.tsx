// 판정 등급 표시(스펙 §3 등급 색). 화면은 3묶음 톤(Badge)이 아니라 등급 색 넷 + 판정 불가를 그대로 쓴다.
// 요소마다 data-grade 를 달아 테스트가 클래스가 아니라 의미로 읽게 한다.
// 등급을 계산하지 않는다 - 엔진이 낸 등급 값을 색과 이름으로 바꿀 뿐이다(리트머스: 브라우저 등급 계산 금지).
import { GRADE_LABEL } from '@/lib/domain/labels';
import type { Grade } from '@/lib/domain/types';
import { BADGE_BASE } from './badge';

// 등급 색 클래스의 유일한 정의처. 캔버스는 같은 값을 lib/domain/palette.ts 의 SCREEN_GRADE_COLOR 로 쓴다.
export const GRADE_CLASS: Record<Grade, { text: string; bg: string; border: string }> = {
  pass: { text: 'text-grade-pass', bg: 'bg-grade-pass', border: 'border-grade-pass' },
  borderline: { text: 'text-grade-borderline', bg: 'bg-grade-borderline', border: 'border-grade-borderline' },
  repair: { text: 'text-grade-repair', bg: 'bg-grade-repair', border: 'border-grade-repair' },
  rework: { text: 'text-grade-rework', bg: 'bg-grade-rework', border: 'border-grade-rework' },
  na: { text: 'text-grade-na', bg: 'bg-grade-na', border: 'border-grade-na' },
};

// jsonb(cells.json 의 grade, 벽 plumb_grade)는 무결성을 보장하지 않는다. 모르는 문자열이 와도 결과 구획이 죽지 않게
// 판정 불가(na) 색으로 그린다(캔버스 lib/viz/heatmap.ts 의 `?? SCREEN_GRADE_COLOR.na` 와 같은 규칙).
// 자기 속성만 본다 - 'toString' 같은 문자열이 Object.prototype 의 값을 집어 오지 않게.
function styleGrade(grade: string): Grade {
  return Object.prototype.hasOwnProperty.call(GRADE_CLASS, grade) ? (grade as Grade) : 'na';
}

export function GradeBadge({ grade }: { grade: Grade }) {
  const g = styleGrade(grade);
  const c = GRADE_CLASS[g];
  // 글자: 아는 등급은 등급 이름, 모르는 문자열은 그 문자열 그대로(판정 불가 색만으로 말하지 않는다)
  return <span data-grade={g} className={`${BADGE_BASE} ${c.border} ${c.text}`}>{g === grade ? GRADE_LABEL[g] : grade}</span>;
}

// 점 크기: 8px(표·목록의 상태 점) · 10px(히트맵 범례) · 12px(판정 KPI) - 아트보드 값
const DOT_SIZE = { 8: 'h-2 w-2', 10: 'h-2.5 w-2.5', 12: 'h-3 w-3' } as const;

export function GradeDot({ grade, size = 8 }: { grade: Grade; size?: keyof typeof DOT_SIZE }) {
  const g = styleGrade(grade);
  return (
    <span aria-hidden="true" data-grade={g}
      className={`inline-block shrink-0 rounded-full ${DOT_SIZE[size]} ${GRADE_CLASS[g].bg}`} />
  );
}

// KPI 카드(스펙 §6, 아트보드 Stage·ScanDone·DashStatus): 눈썹 라벨(IBM Plex Mono 11px dim) +
// Anton 40px 숫자 + 단위(IBM Plex Mono 13px muted). 묶음은 repeat(auto-fit, minmax(150px, 1fr)) 라
// 휴대폰 390px 에서 2열, 넓으면 한 줄로 흐른다.
// 판정 KPI(tone)는 Anton 숫자가 아니라 등급 점 + 등급 이름(Noto Sans KR 30px 700)을 등급 색으로 그린다.
import type { ReactNode } from 'react';
import type { Grade } from '@/lib/domain/types';
import { GRADE_CLASS, GradeDot } from './grade';

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">{children}</div>;
}

/**
 * label: 눈썹 라벨. value: 숫자(또는 판정 KPI 의 등급 이름). unit: 숫자 뒤 단위(판정 KPI 에는 쓰지 않는다).
 * tone: 판정 KPI 의 등급 - 주면 등급 점 + 등급 색 글자로 그린다.
 * className: 묶음 안 배치(예: DashStatus '분석 완료' 카드의 col-span-2).
 * children: 숫자 오른쪽에 함께 흐르는 내용(예: 판정 분포 바·범례). 좁으면 숫자 아래로 내려간다.
 */
export function KpiCard({ label, value, unit, tone, className, children }: {
  label: string; value: ReactNode; unit?: string; tone?: Grade; className?: string; children?: ReactNode;
}) {
  const figure = tone ? (
    <p data-grade={tone}
      className={`flex items-center gap-2.5 font-heading text-[30px] font-bold leading-[1.2] ${GRADE_CLASS[tone].text}`}>
      <GradeDot grade={tone} size={12} />
      {value}
    </p>
  ) : (
    <p className="flex items-baseline gap-1.5">
      <span className="font-display text-[40px] leading-none tabular-nums">{value}</span>
      {unit && <span className="font-mono text-[13px] text-muted">{unit}</span>}
    </p>
  );
  return (
    // 정적 클래스는 따옴표로 끝낸다 - 템플릿 보간 바로 앞에 붙은 py-[18px] 는 Tailwind 가 못 봐 CSS 가 생성되지 않았다
    // (KPI 카드 위아래 여백 0, Task 12 화면 대조). __tests__/tailwind-scan.test.ts 가 다시 붙지 않게 지킨다.
    <div className={'flex min-w-0 flex-col gap-1.5 rounded-card border border-line-2 bg-surface px-5 py-[18px]' + (className ? ` ${className}` : '')}>
      <p className="font-mono text-[11px] tracking-[0.08em] text-dim">{label}</p>
      {children ? <div className="flex flex-wrap items-end gap-x-5 gap-y-2.5">{figure}{children}</div> : figure}
    </div>
  );
}

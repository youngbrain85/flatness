// 키-값 목록(아트보드 ScanDone·ScanProcessing·ScanUnitConfirm 의 '스캔 정보' dl):
// 라벨은 눈썹(IBM Plex Mono 11px · 0.08em · dim), 값은 15px ink. 열은 auto-fit 으로 폭에 따라 흐른다.
// columns 는 "넓을 때 몇 열 정도"를 뜻하는 최소 칸 폭으로 바꾼다(2 → 240px, 3 → 180px, 4 → 140px).
// min(100%, …) 라서 칸 하나보다 좁은 부모에서도 넘치지 않는다(최종 리뷰 Important 1: 375px 겹침 사고).
import type { ReactNode } from 'react';

const MIN_COL = {
  2: 'grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))]',
  3: 'grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))]',
  4: 'grid-cols-[repeat(auto-fit,minmax(min(100%,140px),1fr))]',
} as const;

export function KeyValuePairs({ items, columns = 4 }: {
  items: { label: ReactNode; value: ReactNode }[]; columns?: 2 | 3 | 4;
}) {
  return (
    <dl className={`grid gap-x-6 gap-y-4 ${MIN_COL[columns]}`}>
      {items.map((it, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-1">
          <dt className="font-mono text-[11px] tracking-[0.08em] text-dim">{it.label}</dt>
          <dd className="text-[15px] text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// 큰 수치: Anton 40px(스펙 §3 큰 KPI 숫자) + 단위(IBM Plex Mono 13px muted). KpiCard 의 숫자와 같은 모양이다.
export function StatValue({ value, unit }: { value: string | number; unit?: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-display text-[40px] leading-none tabular-nums">{value}</span>
      {unit && <span className="font-mono text-[13px] text-muted">{unit}</span>}
    </span>
  );
}

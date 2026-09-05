// Cloudscape key-value: 라벨 700 위·값 아래, 열 사이 1px 세로 구분 + padding-left 20px.
import type { ReactNode } from 'react';

const COLS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' } as const;

export function KeyValuePairs({ items, columns = 4 }: {
  items: { label: ReactNode; value: ReactNode }[]; columns?: 2 | 3 | 4;
}) {
  return (
    <dl className={`grid ${COLS[columns]} gap-5`}>
      {items.map((it, i) => (
        <div key={i} className={`flex min-w-0 flex-col gap-1${i % columns ? ' border-l border-cs-divider pl-5' : ''}`}>
          <dt className="text-sm font-bold">{it.label}</dt>
          <dd className="text-sm">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// 개요 지표용 큰 수치(28px/32px 700 tabular) + 보조색 단위
export function StatValue({ value, unit }: { value: string | number; unit?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[28px] font-bold leading-8 tabular-nums">{value}</span>
      {unit && <span className="text-sm text-cs-text-secondary">{unit}</span>}
    </span>
  );
}

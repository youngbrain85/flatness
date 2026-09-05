// Cloudscape key-value: 라벨 700 위·값 아래, 열 사이 1px 세로 구분 + padding-left 20px.
import type { ReactNode } from 'react';

// 최종 리뷰 Important 1: 고정 grid-cols-N은 375px에서 열당 콘텐츠 폭이 ~29px까지
// 줄어 StatValue 28px 숫자와 범례가 서로 겹쳤다(스펙 §5 모바일 규칙). 좁은 폭에서는
// 열을 접고, 열이 실제로 갈라지는 브레이크포인트부터 구분선을 준다.
const COLS = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
} as const;

// 구분선이 붙기 시작하는 브레이크포인트. Tailwind가 스캔할 수 있게 접두사를 문자열
// 조합으로 만들지 않고 전체 클래스를 그대로 적는다.
const DIVIDER = {
  2: 'sm:border-l sm:border-cs-divider sm:pl-5',
  3: 'sm:border-l sm:border-cs-divider sm:pl-5',
  4: 'md:border-l md:border-cs-divider md:pl-5',
} as const;

// 4열은 md 미만에서 2열로 접히므로 그 폭에서는 홀수 인덱스(각 줄의 두 번째 칸)에만
// 구분선을 준다. 2·3열은 md 미만에서 1열이라 이 폭에서는 구분선이 없다.
const NARROW_DIVIDER = 'border-l border-cs-divider pl-5';

export function KeyValuePairs({ items, columns = 4 }: {
  items: { label: ReactNode; value: ReactNode }[]; columns?: 2 | 3 | 4;
}) {
  return (
    <dl className={`grid ${COLS[columns]} gap-5`}>
      {items.map((it, i) => (
        <div key={i} className={[
          'flex min-w-0 flex-col gap-1',
          i % columns ? DIVIDER[columns] : '',
          columns === 4 && i % 2 ? NARROW_DIVIDER : '',
        ].filter(Boolean).join(' ')}>
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

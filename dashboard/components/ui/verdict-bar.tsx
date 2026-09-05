// 판정 분포 바(적합·주의·재시공 3버킷) + 범례. 색은 TONE(badge.tsx)이 유일한 정의처.
import { TONE } from './badge';

export type VerdictCounts = { pass: number; warn: number; fail: number };

export function VerdictBar({ counts }: { counts: VerdictCounts }) {
  const total = counts.pass + counts.warn + counts.fail;
  if (total === 0) return <p className="text-xs text-cs-text-secondary">판정 없음</p>;
  const seg = [
    { n: counts.pass, cls: TONE.pass.dot },
    { n: counts.warn, cls: TONE.warn.dot },
    { n: counts.fail, cls: TONE.fail.dot },
  ];
  return (
    <div className="flex h-2 overflow-hidden rounded bg-cs-divider">
      {seg.filter((s) => s.n > 0).map((s, i) => (
        <div key={i} data-seg className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function VerdictLegend({ counts, na }: { counts: VerdictCounts; na?: number }) {
  const items = [
    { label: `적합 ${counts.pass}`, cls: TONE.pass.dot },
    { label: `주의 ${counts.warn}`, cls: TONE.warn.dot },
    { label: `재시공 ${counts.fail}`, cls: TONE.fail.dot },
    ...(na !== undefined ? [{ label: `불가 ${na}`, cls: TONE.unknown.dot }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-xs leading-4 text-cs-text-secondary tabular-nums">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span aria-hidden className={`h-2 w-2 rounded-full ${it.cls}`} />{it.label}
        </span>
      ))}
    </div>
  );
}

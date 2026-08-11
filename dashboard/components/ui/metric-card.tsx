import { TONE } from './badge';

export function MetricCard({ label, value, unit, children }: {
  label: string; value: string | number; unit?: string; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-xl tabular-nums">{value}</span>
        {unit && <span className="text-xs text-zinc-500">{unit}</span>}
      </p>
      {children}
    </div>
  );
}

export function VerdictBar({ counts }: { counts: { pass: number; warn: number; fail: number } }) {
  const total = counts.pass + counts.warn + counts.fail;
  if (total === 0) return <p className="mt-2 text-xs text-zinc-400">판정 없음</p>;
  // 색은 TONE(badge.tsx)이 유일한 정의처다
  const seg = [
    { n: counts.pass, cls: TONE.pass.dot },
    { n: counts.warn, cls: TONE.warn.dot },
    { n: counts.fail, cls: TONE.fail.dot },
  ];
  return (
    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-zinc-100">
      {seg.filter((s) => s.n > 0).map((s, i) => (
        <div key={i} data-seg className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  );
}

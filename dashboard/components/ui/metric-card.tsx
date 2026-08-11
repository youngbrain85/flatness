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
  const seg = [
    { n: counts.pass, cls: 'bg-green-600' },
    { n: counts.warn, cls: 'bg-amber-500' },
    { n: counts.fail, cls: 'bg-red-600' },
  ];
  return (
    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-zinc-100">
      {seg.filter((s) => s.n > 0).map((s, i) => (
        <div key={i} data-seg className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  );
}

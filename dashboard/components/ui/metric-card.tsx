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

export { VerdictBar } from './verdict-bar';

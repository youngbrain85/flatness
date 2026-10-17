// 진행 막대(스펙 §6): 바탕 line · 높이 6px · 알약, 채움 ink, 오른쪽 % (IBM Plex Mono).
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <div className="flex items-center gap-3">
      {label && <span className="text-sm text-ink">{label}</span>}
      <div role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-ink" style={{ width: `${v}%` }} />
      </div>
      <span className="font-mono text-[13px] tabular-nums text-ink-2">{v}%</span>
    </div>
  );
}

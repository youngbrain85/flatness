// 진행바: 트랙 4px cs-divider, 채움 cs-link, 우측 % 텍스트.
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <div className="flex items-center gap-3">
      {label && <span className="text-sm">{label}</span>}
      <div role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}
        className="h-1 flex-1 overflow-hidden rounded-sm bg-cs-divider">
        <div className="h-full bg-cs-link" style={{ width: `${v}%` }} />
      </div>
      <span className="text-sm tabular-nums">{v}%</span>
    </div>
  );
}

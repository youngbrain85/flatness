export const TONE = {
  pass:    { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-600' },
  warn:    { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  fail:    { bg: 'bg-red-50',   text: 'text-red-700',   dot: 'bg-red-600' },
  unknown: { bg: 'bg-zinc-100', text: 'text-zinc-600',  dot: 'bg-zinc-400' },
  neutral: { bg: 'bg-zinc-100', text: 'text-zinc-600',  dot: 'bg-zinc-400' },
  busy:    { bg: 'bg-zinc-100', text: 'text-zinc-600',  dot: 'bg-zinc-500' },
} as const;

// Badge는 5종 tone만 허용 (busy는 StatusDot 전용)
export type BadgeTone = Exclude<keyof typeof TONE, 'busy'>;

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  const t = TONE[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${t.bg} ${t.text}`}>{children}</span>;
}

import { TONE } from './badge';

export function StatusDot({ tone, label }: { tone: 'pass'|'warn'|'fail'|'unknown'|'busy'; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className={`h-2 w-2 rounded-full ${TONE[tone].dot}`} />
      {label}
    </span>
  );
}

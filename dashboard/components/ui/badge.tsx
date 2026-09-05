// 판정·상태 배지. TONE은 색의 유일한 정의처(VerdictBar·StatusIndicator 호환 dot 필드 포함).
export const TONE = {
  pass:     { bg: 'bg-cs-success-bg',  text: 'text-cs-success',        dot: 'bg-cs-success' },
  warn:     { bg: 'bg-cs-warning-bg',  text: 'text-cs-warning',        dot: 'bg-cs-warning' },
  fail:     { bg: 'bg-cs-error-bg',    text: 'text-cs-error',          dot: 'bg-cs-error' },
  unknown:  { bg: 'bg-cs-divider',     text: 'text-cs-text-secondary', dot: 'bg-cs-na' },
  neutral:  { bg: 'bg-cs-divider',     text: 'text-cs-text-secondary', dot: 'bg-cs-na' },
  busy:     { bg: 'bg-cs-divider',     text: 'text-cs-text-secondary', dot: 'bg-cs-text-secondary' },
  // '외부 결과'(임포트 출처 경고): 판정 4색과 오독되지 않게 purple(스펙 §3)
  external: { bg: 'bg-cs-external-bg', text: 'text-cs-external',       dot: 'bg-cs-external' },
} as const;

// Badge는 busy를 제외한 톤만 허용(busy는 StatusIndicator(TONE_STATUS) 전용)
export type BadgeTone = Exclude<keyof typeof TONE, 'busy'>;

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  const t = TONE[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold ${t.bg} ${t.text}`}>{children}</span>;
}

// 상태·분류 배지(스펙 §6): 테두리 태그 - 1px 색 테두리 + 같은 색 글자, IBM Plex Mono 11px, 반지름 6px, 높이 22px.
// 판정 등급은 이 3묶음 톤이 아니라 grade.tsx 의 GradeBadge(등급 색 다섯)로 그린다.
// TONE 은 톤 색의 유일한 정의처다. dot 필드는 점으로 상태를 그리는 곳이 같은 색을 얻게 남긴다.
export const TONE = {
  pass:     { border: 'border-ok',                  text: 'text-ok',    dot: 'bg-ok' },
  warn:     { border: 'border-warn',                text: 'text-warn',  dot: 'bg-warn' },
  fail:     { border: 'border-err',                 text: 'text-err',   dot: 'bg-err' },
  unknown:  { border: 'border-dim',                 text: 'text-dim',   dot: 'bg-dim' },
  neutral:  { border: 'border-line-3',              text: 'text-ink-2', dot: 'bg-muted' },
  busy:     { border: 'border-line-3',              text: 'text-ink-2', dot: 'bg-ink' },
  // '외부 결과'(임포트 출처 경고): 점선 ink-2 - 등급 색과 오독되지 않는다(스펙 §6)
  external: { border: 'border-dashed border-ink-2', text: 'text-ink-2', dot: 'bg-ink-2' },
} as const;

// Badge는 busy를 제외한 톤만 허용(busy는 StatusIndicator(TONE_STATUS) 전용)
export type BadgeTone = Exclude<keyof typeof TONE, 'busy'>;

// 배지 모양(색 제외). GradeBadge 가 같은 모양을 쓰도록 내보낸다.
export const BADGE_BASE = 'inline-flex min-h-[22px] items-center whitespace-nowrap rounded-control border px-2 font-mono text-[11px]';

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  const t = TONE[tone];
  return <span data-tone={tone} className={`${BADGE_BASE} ${t.border} ${t.text}`}>{children}</span>;
}

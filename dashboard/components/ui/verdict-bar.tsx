// 판정 분포 바 + 범례: 3묶음 "적합 · 경계 · 보수·재시공"(스펙 §9). 묶음 규칙(toBarCounts)은 그대로이고
// 이름만 바꿨다 - 셋째 묶음에는 보수가 들어 있고, 둘째 묶음은 등급 이름(경계)과 같아야 한다.
// 색은 등급 색(GRADE_CLASS): 적합 = pass, 경계 = borderline, 보수·재시공 = rework (아트보드 DashStatus).
import { GRADE_CLASS } from './grade';

export type VerdictCounts = { pass: number; warn: number; fail: number };

const BUCKETS = [
  { key: 'pass', label: '적합', cls: GRADE_CLASS.pass.bg },
  { key: 'warn', label: '경계', cls: GRADE_CLASS.borderline.bg },
  { key: 'fail', label: '보수·재시공', cls: GRADE_CLASS.rework.bg },
] as const;

export function VerdictBar({ counts }: { counts: VerdictCounts }) {
  const total = counts.pass + counts.warn + counts.fail;
  if (total === 0) return <p className="text-xs text-muted">판정 없음</p>;
  return (
    <div role="img" aria-label={BUCKETS.map((b) => `${b.label} ${counts[b.key]}`).join(', ')}
      className="flex h-2 overflow-hidden rounded-full bg-line">
      {BUCKETS.filter((b) => counts[b.key] > 0).map((b) => (
        <div key={b.key} data-seg={b.key} className={b.cls} style={{ width: `${(counts[b.key] / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function VerdictLegend({ counts, na }: { counts: VerdictCounts; na?: number }) {
  const items = [
    ...BUCKETS.map((b) => ({ label: `${b.label} ${counts[b.key]}`, cls: b.cls })),
    ...(na !== undefined ? [{ label: `불가 ${na}`, cls: GRADE_CLASS.na.bg }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums text-ink-2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${it.cls}`} />{it.label}
        </span>
      ))}
    </div>
  );
}

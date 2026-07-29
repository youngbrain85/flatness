import Link from 'next/link';
import { GRADE_COLOR, GRADE_LABEL } from '@/lib/domain/labels';
import type { SiteSummary } from '@/lib/domain/summary';
import type { Verdict } from '@/lib/domain/types';

const VERDICTS: Verdict[] = ['pass', 'borderline', 'repair', 'rework'];

export function SiteCard({ summary }: { summary: SiteSummary }) {
  const { site, locationCount, lastScannedAt, verdictCounts, naCount } = summary;
  return (
    <Link href={`/sites/${site.id}`}
      className="block rounded-lg border bg-white p-4 shadow-sm hover:border-slate-400">
      <h2 className="font-semibold">{site.name}</h2>
      {site.address && <p className="text-sm text-slate-500">{site.address}</p>}
      <p className="mt-2 text-sm text-slate-600">
        측정위치 {locationCount} · 최근 측정 {lastScannedAt ?? '없음'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {VERDICTS.map((v) => (
          <span key={v} className="rounded px-2 py-0.5 text-white"
            style={{ backgroundColor: GRADE_COLOR[v], opacity: verdictCounts[v] ? 1 : 0.3 }}>
            {GRADE_LABEL[v]} {verdictCounts[v]}
          </span>
        ))}
        {/* 리뷰 Important 3: 판정 불가(분석은 done이나 overall_verdict null) 건이
            총계에서 누락되지 않도록 별도 배지로 표시 */}
        <span className="rounded px-2 py-0.5 text-white"
          style={{ backgroundColor: GRADE_COLOR.na, opacity: naCount ? 1 : 0.3 }}>
          {GRADE_LABEL.na} {naCount}
        </span>
      </div>
    </Link>
  );
}

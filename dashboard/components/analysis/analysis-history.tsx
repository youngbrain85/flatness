// 이전 분석 목록(아트보드 docs/design/dark/ScanDone.dc.html 201~203행): "이전 분석" + 일시 · 엔진 + 판정 태그 + 화살표.
// 같은 작업대의 ?analysis= 선택 렌더로 간다(D5). 판정 태그는 엔진이 낸 overall_verdict 그대로다(계산하지 않는다).
// 서버 컴포넌트다(app/scans/[id]/page.tsx 가 평활도·구배 섹션에서 각각 그린다).
import Link from 'next/link';
import { GradeBadge } from '@/components/ui/grade';
import { Icon } from '@/components/ui/icons';
import { resultMeta } from './result-parts';
import type { AnalysisRow } from '@/lib/domain/types';

export function AnalysisHistoryList({ scanId, analyses }: { scanId: string; analyses: AnalysisRow[] }) {
  if (analyses.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {analyses.map((a) => (
        <li key={a.id}>
          {/* 포커스 외곽선은 전역 :focus-visible(2px ink)이 그린다 */}
          <Link href={`/scans/${scanId}?analysis=${a.id}`}
            className="inline-flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-ink-2 hover:text-ink">
            <span>이전 분석</span>
            <span className="font-mono text-[13px] tabular-nums text-ink">{resultMeta(a.created_at, a.engine_version)}</span>
            {a.overall_verdict && <GradeBadge grade={a.overall_verdict} />}
            <Icon name="chevron-right" className="text-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

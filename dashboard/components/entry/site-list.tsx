// 진입 페이지의 현장 목록(아트보드 docs/design/dark/EntrySearch.dc.html). 줄 하나가 통째로 /sites/[id] 링크다.
// 판정 분포는 3묶음 바(적합 · 경계 · 보수·재시공, 스펙 §9) + "n · n · n", 상태는 하나만 보인다.
// 'use client'를 달지 않는다: 훅이 없고, 클라이언트 섬(site-finder.tsx)이 import하면 그쪽 번들에 들어간다.
import Link from 'next/link';
import { Icon } from '@/components/ui/icons';
import { StatusIndicator, type StatusType } from '@/components/ui/status-indicator';
import { VerdictBar, type VerdictCounts } from '@/components/ui/verdict-bar';

// 서버(app/page.tsx)가 SiteSummary를 접어 넘기는 줄. 클라이언트 경계를 넘으므로 직렬화 가능한 평면 객체만
// 둔다(Next 가이드 server-and-client-components "serializable").
export type EntrySiteRow = {
  id: string;
  name: string;
  locationCount: number;
  scanCount: number;
  lastScannedAt: string | null;
  // 4단계 판정을 3묶음으로 접은 값(lib/domain/summary.ts toBarCounts)
  counts: VerdictCounts;
  // 판정 불가(done인데 overall_verdict null) 건수 - 분포 바에는 들지 않는다
  na: number;
  // 처리 중(queued·processing, 종류 무관) 분석 건수
  inProgress: number;
};

// 상태: 처리 중 > 판정 불가 > 완료 > 분석 없음 순으로 하나만(지난 홈 테이블의 상태 열 규칙 그대로).
// 판정 불가 건수는 분포 바에 들지 않으므로 여기서 드러난다(리뷰 픽스: 분석을 안 한 현장과 구분돼야 한다).
export function siteStatus(row: Pick<EntrySiteRow, 'counts' | 'na' | 'inProgress'>): { type: StatusType; label: string } {
  if (row.inProgress > 0) return { type: 'in-progress', label: `처리 중 ${row.inProgress}건` };
  if (row.na > 0) return { type: 'pending', label: `판정 불가 ${row.na}건` };
  if (row.counts.pass + row.counts.warn + row.counts.fail > 0) return { type: 'success', label: '완료' };
  return { type: 'pending', label: '분석 없음' };
}

export function SiteList({ rows }: { rows: EntrySiteRow[] }) {
  // 줄 사이 1px 선은 목록 바탕(line)이 gap-px 틈으로 비쳐 보이는 것이다(아트보드 그대로).
  // role="list": Tailwind preflight 의 list-style: none 때문에 Safari VoiceOver 가 목록 의미를 버리지 않게 직접 단다.
  return (
    <ul role="list" className="flex flex-col gap-px overflow-hidden rounded-card border border-line-2 bg-line">
      {rows.map((row) => (
        <li key={row.id} className="flex">
          <SiteRowLink row={row} />
        </li>
      ))}
    </ul>
  );
}

function SiteRowLink({ row }: { row: EntrySiteRow }) {
  const status = siteStatus(row);
  const { pass, warn, fail } = row.counts;
  // 포커스 외곽선은 전역 :focus-visible(globals.css)이 그린다. 목록이 overflow-hidden이라 바깥으로 그리면
  // 잘리므로 오프셋만 안쪽 3px로 돌린다(아트보드 outline-offset: -3px).
  return (
    <Link
      href={`/sites/${row.id}`}
      className="relative flex min-h-[76px] min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2.5 bg-surface py-3.5 pl-[clamp(16px,2vw,22px)] pr-[52px] text-ink hover:bg-surface-2 focus-visible:-outline-offset-3"
    >
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
        <span className="font-heading text-[17px] font-bold leading-[1.45] [overflow-wrap:anywhere]">{row.name}</span>
        <span className="font-mono text-xs text-muted">
          측정위치 <span className="text-ink">{row.locationCount}</span> · 스캔 <span className="text-ink">{row.scanCount}</span>
        </span>
      </div>
      <div className="flex min-w-0 flex-[0_1_492px] flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex min-w-0 flex-[0_1_200px] items-center gap-3">
          {/* 바의 읽을 이름("적합 n, 경계 n, 보수·재시공 n")은 VerdictBar가 단다. 합계 0이면 '판정 없음' 글자다 */}
          <div className="min-w-16 flex-auto">
            <VerdictBar counts={row.counts} />
          </div>
          {/* 숫자 줄은 바와 같은 정보라 읽지 않는다. 합계 0이면 "0 · 0 · 0"을 겹쳐 쓰지 않는다 */}
          {pass + warn + fail > 0 && (
            <span aria-hidden="true" className="whitespace-nowrap font-mono text-xs text-muted">{`${pass} · ${warn} · ${fail}`}</span>
          )}
        </div>
        <span className="flex-[0_0_124px] whitespace-nowrap font-mono text-[13px] text-ink-2">
          <span className="text-dim">최근</span> {row.lastScannedAt ?? '-'}
        </span>
        <span className="flex-[0_0_120px]">
          <StatusIndicator type={status.type}>{status.label}</StatusIndicator>
        </span>
      </div>
      <Icon name="chevron-right" className="absolute right-5 top-1/2 -translate-y-1/2 text-muted" />
    </Link>
  );
}

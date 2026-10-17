// 최근 보고서 카드(아트보드 DashStatus "최근 보고서"): 제목(상세 링크) · 상태(점 + 글자) · 생성일,
// 끝에 현장 보고서 탭으로 가는 "보고서 전체 보기".
import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { StatusIndicator } from '@/components/ui/status-indicator';
import type { DashReportItem } from '@/lib/domain/site-dashboard';
import { ArrowLink } from './arrow-link';

export function RecentReportsCard({ siteId, reports }: { siteId: string; reports: DashReportItem[] }) {
  return (
    <Container title="최근 보고서" counter={reports.length}>
      <div className="flex flex-col gap-3.5">
        {reports.length === 0 ? (
          <p className="text-sm text-muted">아직 보고서가 없습니다.</p>
        ) : (
          <ul className="flex flex-col">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 border-t border-line pb-2.5 pt-1.5">
                <Link href={r.href}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-ink underline decoration-line-3 underline-offset-4">
                  {r.title}
                </Link>
                <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                  <StatusIndicator type={r.type}>{r.label}</StatusIndicator>
                  <span className="font-mono text-xs text-muted">{r.date}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <ArrowLink href={`/sites/${siteId}/reports`} className="self-start">보고서 전체 보기</ArrowLink>
      </div>
    </Container>
  );
}

// 현장 대시보드 KPI 줄(아트보드 DashStatus "현장 요약"): 측정위치 · 스캔 · 분석 완료(2칸, 판정 분포 바와
// 범례) · 처리 중 · 보고서. 숫자의 정의는 lib/domain/site-dashboard.ts DashKpi(스펙 §5 03)에 있다.
import { KpiCard, KpiGrid } from '@/components/ui/kpi';
import { VerdictBar, VerdictLegend } from '@/components/ui/verdict-bar';
import type { DashKpi } from '@/lib/domain/site-dashboard';

export function DashboardKpis({ kpi }: { kpi: DashKpi }) {
  return (
    <section aria-label="현장 요약">
      <KpiGrid>
        <KpiCard label="측정위치" value={kpi.locationCount} unit="곳" />
        <KpiCard label="스캔" value={kpi.scanCount} unit="건" />
        {/* 아트보드: 이 카드만 두 칸(grid-column: span 2) - 숫자 옆에 분포 바와 범례가 붙는다 */}
        <KpiCard label="분석 완료" value={kpi.doneCount} unit="건" className="col-span-2">
          <div className="flex min-w-0 flex-[1_1_160px] flex-col gap-2">
            {/* 바의 읽을 이름("적합 n, 경계 n, 보수·재시공 n")은 VerdictBar가 단다. 합계 0이면 '판정 없음' 글자다 */}
            <VerdictBar counts={kpi.bar} />
            {/* 판정 불가는 분포 바에 들지 않는다 - 있을 때만 범례에 "불가 n"으로 드러낸다(지난 홈의 리뷰 픽스와 같다) */}
            <VerdictLegend counts={kpi.bar} na={kpi.naCount > 0 ? kpi.naCount : undefined} />
          </div>
        </KpiCard>
        <KpiCard label="처리 중" value={kpi.inProgressCount} unit="건" />
        <KpiCard label="보고서" value={kpi.reportCount} unit="건" />
      </KpiGrid>
    </section>
  );
}

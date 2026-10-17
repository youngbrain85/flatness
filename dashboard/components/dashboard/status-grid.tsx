// 측정위치별 판정 격자(아트보드 docs/design/dark/DashStatus.dc.html "측정위치별 판정"):
// 동 카드 → 층 줄(floor_order 내림차순) → 측정위치 타일. 타일 색은 엔진이 낸 판정(overall_verdict)만 쓴다 -
// 화면은 등급을 계산하지 않는다. 판정은 글자(적합·경계·…)를 늘 함께 쓴다(색만으로 말하지 않는다).
import Link from 'next/link';
import { GRADE_CLASS } from '@/components/ui/grade';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { GRADE_LABEL } from '@/lib/domain/labels';
import type { DashBuilding, DashFloor, DashTile } from '@/lib/domain/site-dashboard';
import type { Grade } from '@/lib/domain/types';
import { ArrowLink } from './arrow-link';

const LEGEND_GRADES: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];

export function StatusGrid({ siteId, buildings, locationCount, hiddenCount }: {
  siteId: string;
  buildings: DashBuilding[];
  // 제목 옆 (n): 격자에 올린 수가 아니라 현장의 측정위치 전체 수
  locationCount: number;
  // 상한을 넘어 격자에 못 올린 측정위치 수("…외 n곳")
  hiddenCount: number;
}) {
  return (
    <section aria-labelledby="gridTitle" className="flex min-w-0 flex-[2_1_640px] flex-col gap-3.5">
      <h2 id="gridTitle" className="font-heading text-[19px] font-semibold">
        측정위치별 판정 <span className="font-mono text-[15px] font-normal text-muted">({locationCount})</span>
      </h2>
      <GridLegend />
      {buildings.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-card border border-line-2 bg-surface px-[22px] py-5">
          <p className="text-sm text-muted">등록된 측정위치가 없습니다.</p>
          <ArrowLink href={`/sites/${siteId}/locations`}>측정위치 등록</ArrowLink>
        </div>
      ) : (
        <>
          {buildings.map((b, i) => <BuildingCard key={b.building} id={`grid-building-${i}`} building={b} />)}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            {hiddenCount > 0 && <p className="text-sm text-muted">{`…외 ${hiddenCount}곳`}</p>}
            <ArrowLink href={`/sites/${siteId}/locations`} className="ml-auto">측정위치 전체 보기</ArrowLink>
          </div>
        </>
      )}
    </section>
  );
}

// 범례: "최근 판정"(등급 색 막대 + 미분석 빈 막대)과 "새 스캔"(처리 중 고리)
function GridLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <span className="font-mono text-[11px] tracking-[0.08em] text-dim">최근 판정</span>
        <ul aria-label="최근 판정 범례" className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 font-mono text-xs text-ink-2">
          {LEGEND_GRADES.map((g) => (
            <li key={g} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span aria-hidden="true" className={`h-1.5 w-4 flex-none rounded-full ${GRADE_CLASS[g].bg}`} />
              {GRADE_LABEL[g]}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden="true" className="h-1.5 w-4 flex-none rounded-full border border-dim" />
            미분석
          </li>
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <span className="font-mono text-[11px] tracking-[0.08em] text-dim">새 스캔</span>
        <ul aria-label="스캔 상태 범례" className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 font-mono text-xs text-ink-2">
          <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full border-2 border-ink" />
            처리 중
          </li>
        </ul>
      </div>
    </div>
  );
}

function BuildingCard({ id, building }: { id: string; building: DashBuilding }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3.5 rounded-card border border-line-2 bg-surface px-[22px] py-5">
      <h3 id={id} className="font-heading text-[17px] font-bold leading-[1.3]">{building.building || '(동 미지정)'}</h3>
      <div className="flex flex-col">
        {building.floors.map((f) => <FloorRow key={f.floor} floor={f} />)}
      </div>
    </section>
  );
}

function FloorRow({ floor }: { floor: DashFloor }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5 border-t border-line py-3.5 last:pb-0">
      <h4 className="flex-[0_0_48px] pt-0.5 font-mono text-[13px] font-medium text-ink-2">{floor.floor || '(층 미지정)'}</h4>
      <ul className="grid min-w-0 flex-[1_1_280px] grid-cols-[repeat(auto-fill,minmax(min(100%,200px),1fr))] gap-2.5">
        {floor.tiles.map((t) => (
          <li key={t.locationId} className="flex min-w-0">
            <TileLink tile={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// 타일 전체가 링크: 최근 스캔(/scans/[id]), 스캔이 없으면 측정위치 탭의 그 줄
function TileLink({ tile }: { tile: DashTile }) {
  const g = tile.grade;
  return (
    <Link href={tile.href} data-grade={g ?? 'none'}
      className="flex min-w-0 flex-auto flex-col gap-2 rounded-card border border-line-2 bg-ground px-3.5 py-3 text-ink hover:border-line-3">
      <span aria-hidden="true" className={`block h-1.5 rounded-full ${g ? GRADE_CLASS[g].bg : 'border border-dim'}`} />
      <span className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-0.5">
        <span className="text-[15px] font-semibold">{tile.label}</span>
        <span className="font-mono text-xs text-muted">{`스캔 ${tile.scanCount}`}</span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        {g ? (
          <span className={`font-heading text-lg font-bold leading-[1.3] ${GRADE_CLASS[g].text}`}>{GRADE_LABEL[g]}</span>
        ) : (
          <span className="font-heading text-lg font-medium leading-[1.3] text-muted">미분석</span>
        )}
        {tile.gradeScanDate && <span className="font-mono text-xs text-muted">{`${tile.gradeScanDate} 스캔`}</span>}
      </span>
      <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2">
        <StatusIndicator type={tile.state.type}>{tile.state.label}</StatusIndicator>
        {tile.latestScanDate && <span className="font-mono text-xs text-muted">{tile.latestScanDate}</span>}
      </span>
    </Link>
  );
}

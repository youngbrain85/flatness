// 하단 구간별 결과표 - Cloudscape 리스킨(T7): tableClass 프리셋(헤더 40px 700, 행 44px, 수치 열 우측 mono)
// 구역(벽)별 max/min/mean·보수 이상 셀은 cells.json에서 재집계(computeZoneStats)
import { computeZoneStats } from '@/lib/domain/cells';
import { GRADE_LABEL, ZONE_STATUS_LABEL, fmtMm } from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { tableClass } from '@/components/ui/data-table';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
import type { CellRow, Stats } from '@/lib/domain/types';

export function ResultTable({ stats, cells }: { stats: Stats; cells: CellRow[] }) {
  const zoneStats = computeZoneStats(cells);
  const isWall = stats.meta.surface === 'wall';
  return (
    <div className="overflow-x-auto rounded-lg border border-cs-divider bg-white">
      <table className={tableClass.table}>
        <thead className={tableClass.thead}>
          <tr>
            <th className={tableClass.th}>{isWall ? '벽' : '구역'}</th>
            {!isWall && <th className={tableClass.th}>상태</th>}
            {!isWall && <th className={tableClass.thNum}>레벨(m)</th>}
            {!isWall && <th className={tableClass.thNum}>면적(m²)</th>}
            {isWall && <th className={tableClass.thNum}>크기(m)</th>}
            {isWall && <th className={tableClass.thNum}>수직도(mm)</th>}
            {isWall && <th className={tableClass.th}>수직도 판정</th>}
            <th className={tableClass.thNum}>셀(유효/전체)</th>
            <th className={tableClass.thNum}>최대(mm)</th>
            <th className={tableClass.thNum}>최소(mm)</th>
            <th className={tableClass.thNum}>평균(mm)</th>
            <th className={tableClass.thNum}>보수 이상 셀(비율)</th>
          </tr>
        </thead>
        <tbody>
          {zoneStats.map((z) => {
            const zone = stats.zones.find((zi) => zi.zone_id === z.zone_id);
            const wall = stats.walls?.find((w) => w.wall_id === z.zone_id);
            return (
              <tr key={String(z.zone_id)} className={tableClass.row}>
                <td className={`${tableClass.td} font-bold`}>
                  {z.zone_id === null ? '전체' : isWall ? `벽 ${z.zone_id}` : `구역 ${z.zone_id}`}
                </td>
                {!isWall && <td className={tableClass.td}>{zone ? ZONE_STATUS_LABEL[zone.status] : '-'}</td>}
                {!isWall && <td className={tableClass.tdNum}>{zone ? zone.level_m : '-'}</td>}
                {!isWall && <td className={tableClass.tdNum}>{zone ? zone.area_m2 : '-'}</td>}
                {isWall && <td className={tableClass.tdNum}>{wall ? `${wall.length_m} x ${wall.height_m}` : '-'}</td>}
                {isWall && <td className={tableClass.tdNum}>{wall ? fmtMm(wall.plumbness_mm) : '-'}</td>}
                {isWall && (
                  <td className={tableClass.td}>
                    {wall && (
                      <StatusIndicator type={TONE_STATUS[GRADE_TONE[wall.plumb_grade]]}>
                        {GRADE_LABEL[wall.plumb_grade]}
                      </StatusIndicator>
                    )}
                  </td>
                )}
                <td className={tableClass.tdNum}>{z.n_valid} / {z.n_cells}</td>
                <td className={tableClass.tdNum}>{fmtMm(z.max_mm)}</td>
                <td className={tableClass.tdNum}>{fmtMm(z.min_mm)}</td>
                <td className={tableClass.tdNum}>{fmtMm(z.mean_mm)}</td>
                <td className={tableClass.tdNum}>{z.over_cells} ({z.over_pct}%)</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

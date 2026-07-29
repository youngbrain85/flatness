// 하단 구간별 결과표
// 구역(벽)별 max/min/mean·보수 이상 셀은 cells.json에서 재집계(computeZoneStats)
import { computeZoneStats } from '@/lib/domain/cells';
import { GRADE_COLOR, GRADE_LABEL, ZONE_STATUS_LABEL, fmtMm } from '@/lib/domain/labels';
import type { CellRow, Stats } from '@/lib/domain/types';

export function ResultTable({ stats, cells }: { stats: Stats; cells: CellRow[] }) {
  const zoneStats = computeZoneStats(cells);
  const isWall = stats.meta.surface === 'wall';
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left text-xs text-slate-600">
          <tr>
            <th className="p-2">{isWall ? '벽' : '구역'}</th>
            {!isWall && <th className="p-2">상태</th>}
            {!isWall && <th className="p-2">레벨(m)</th>}
            {!isWall && <th className="p-2">면적(m²)</th>}
            {isWall && <th className="p-2">크기(m)</th>}
            {isWall && <th className="p-2">수직도(mm)</th>}
            {isWall && <th className="p-2">수직도 판정</th>}
            <th className="p-2">셀(유효/전체)</th>
            <th className="p-2">최대(mm)</th>
            <th className="p-2">최소(mm)</th>
            <th className="p-2">평균(mm)</th>
            <th className="p-2">보수 이상 셀(비율)</th>
          </tr>
        </thead>
        <tbody>
          {zoneStats.map((z) => {
            const zone = stats.zones.find((zi) => zi.zone_id === z.zone_id);
            const wall = stats.walls?.find((w) => w.wall_id === z.zone_id);
            return (
              <tr key={String(z.zone_id)} className="border-t">
                <td className="p-2 font-medium">
                  {z.zone_id === null ? '전체' : isWall ? `벽 ${z.zone_id}` : `구역 ${z.zone_id}`}
                </td>
                {!isWall && <td className="p-2">{zone ? ZONE_STATUS_LABEL[zone.status] : '-'}</td>}
                {!isWall && <td className="p-2">{zone ? zone.level_m : '-'}</td>}
                {!isWall && <td className="p-2">{zone ? zone.area_m2 : '-'}</td>}
                {isWall && <td className="p-2">{wall ? `${wall.length_m} x ${wall.height_m}` : '-'}</td>}
                {isWall && <td className="p-2">{wall ? fmtMm(wall.plumbness_mm) : '-'}</td>}
                {isWall && (
                  <td className="p-2">
                    {wall && (
                      <span className="rounded px-1.5 text-xs text-white"
                        style={{ backgroundColor: GRADE_COLOR[wall.plumb_grade] }}>
                        {GRADE_LABEL[wall.plumb_grade]}
                      </span>
                    )}
                  </td>
                )}
                <td className="p-2">{z.n_valid} / {z.n_cells}</td>
                <td className="p-2">{fmtMm(z.max_mm)}</td>
                <td className="p-2">{fmtMm(z.min_mm)}</td>
                <td className="p-2">{fmtMm(z.mean_mm)}</td>
                <td className="p-2">{z.over_cells} ({z.over_pct}%)</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

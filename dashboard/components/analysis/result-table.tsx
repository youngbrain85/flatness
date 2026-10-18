// 구간별 결과표(아트보드 docs/design/dark/ScanDone.dc.html 160~192행). 구역(벽)별 max/min/mean·보수 이상 셀은
// cells.json 에서 다시 센다(computeZoneStats). 표는 TableBox 안에서만 가로로 스크롤한다(휴대폰).
// 벽의 수직도 판정은 엔진 plumb_grade 를 등급 색 점 + 이름으로 보인다(계산하지 않는다).
import { computeZoneStats } from '@/lib/domain/cells';
import { GRADE_LABEL, ZONE_STATUS_LABEL, fmtMm } from '@/lib/domain/labels';
import { TableBox, tableClass } from '@/components/ui/data-table';
import { GradeDot } from '@/components/ui/grade';
import type { CellRow, Stats } from '@/lib/domain/types';

export function ResultTable({ stats, cells }: { stats: Stats; cells: CellRow[] }) {
  const zoneStats = computeZoneStats(cells);
  const isWall = stats.meta.surface === 'wall';
  return (
    <TableBox>
      <thead className={tableClass.thead}>
        <tr>
          <th scope="col" className={tableClass.th}>{isWall ? '벽' : '구역'}</th>
          {!isWall && <th scope="col" className={tableClass.th}>상태</th>}
          {!isWall && <th scope="col" className={tableClass.thNum}>레벨(m)</th>}
          {!isWall && <th scope="col" className={tableClass.thNum}>면적(m²)</th>}
          {isWall && <th scope="col" className={tableClass.thNum}>크기(m)</th>}
          {isWall && <th scope="col" className={tableClass.thNum}>수직도(mm)</th>}
          {isWall && <th scope="col" className={tableClass.th}>수직도 판정</th>}
          <th scope="col" className={tableClass.thNum}>셀(유효/전체)</th>
          <th scope="col" className={tableClass.thNum}>최대(mm)</th>
          <th scope="col" className={tableClass.thNum}>최소(mm)</th>
          <th scope="col" className={tableClass.thNum}>평균(mm)</th>
          <th scope="col" className={tableClass.thNum}>보수 이상 셀(비율)</th>
        </tr>
      </thead>
      <tbody>
        {zoneStats.map((z) => {
          const zone = stats.zones.find((zi) => zi.zone_id === z.zone_id);
          const wall = stats.walls?.find((w) => w.wall_id === z.zone_id);
          return (
            <tr key={String(z.zone_id)} className={tableClass.row}>
              {/* 아트보드 ScanDone 표는 모든 칸이 nowrap - 390 에서 '구역 1'·'정상'이 글자마다 꺾이지 않게(넘치면 상자 안 스크롤) */}
              <td className={`${tableClass.td} whitespace-nowrap font-semibold`}>
                {z.zone_id === null ? '전체' : isWall ? `벽 ${z.zone_id}` : `구역 ${z.zone_id}`}
              </td>
              {!isWall && <td className={`${tableClass.td} whitespace-nowrap`}>{zone ? ZONE_STATUS_LABEL[zone.status] : '-'}</td>}
              {!isWall && <td className={tableClass.tdNum}>{zone ? zone.level_m : '-'}</td>}
              {!isWall && <td className={tableClass.tdNum}>{zone ? zone.area_m2 : '-'}</td>}
              {isWall && <td className={tableClass.tdNum}>{wall ? `${wall.length_m} x ${wall.height_m}` : '-'}</td>}
              {isWall && <td className={tableClass.tdNum}>{wall ? fmtMm(wall.plumbness_mm) : '-'}</td>}
              {isWall && (
                <td className={tableClass.td}>
                  {wall && (
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <GradeDot grade={wall.plumb_grade} />
                      {GRADE_LABEL[wall.plumb_grade]}
                    </span>
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
    </TableBox>
  );
}

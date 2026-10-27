// 다면 기준평면별 결과(구배 분석을 기준평면 개수와 함께 돌렸을 때만).
// 엔진 judge_slope_cells 의 stats.planes 를 그대로 표로 옮긴다 - 등급은 엔진이 셀과 같은 규칙으로 이미 매겼고
// 여기서 다시 계산하지 않는다(slope-result-table.tsx 와 같은 원칙). 평면 지도는 엔진 PNG(slope_planes.png)다.
import { SLOPE_GRADE_TO_GRADE } from '@/lib/domain/grade-tone';
import { dataUrl } from '@/lib/domain/paths';
import { hasPlanes } from '@/lib/domain/slope-planes';
import { TableBox, tableClass } from '@/components/ui/data-table';
import { GradeDot } from '@/components/ui/grade';
import { Stage } from '@/components/ui/stage';
import { Alert } from '@/components/ui/alert';
import type { Grade, SlopeGrade, SlopeStats } from '@/lib/domain/types';

function fmt(v: number | null | undefined, digits: number, unit = ''): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : '-';
}

function dotGrade(grade: string): Grade {
  return Object.prototype.hasOwnProperty.call(SLOPE_GRADE_TO_GRADE, grade) ? SLOPE_GRADE_TO_GRADE[grade as SlopeGrade] : 'na';
}

export function SlopePlanesPanel({ stats }: { stats: SlopeStats }) {
  const planes = stats.planes;
  if (planes === undefined) return null;
  const png = stats.artifacts?.planes_png;
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="font-heading text-base font-semibold">기준평면별 결과</h3>
      {!hasPlanes(planes) ? (
        <Alert type="warning">기준평면 결과 형식이 올바르지 않아 표시할 수 없습니다. 구배 분석을 다시 실행하세요.</Alert>
      ) : (
        <>
          <p className="text-sm text-muted">
            요청 {planes.requested}개 · 찾은 평면 {planes.found}개
            {planes.thr_mm !== null && ` · 평면 문턱 ${fmt(planes.thr_mm, 1, 'mm')}`}
            {' '}- 바닥 전체에 맞춘 면마다 설계 구배와 비교했습니다. 종합 판정은 평면과 셀 판정 중 가장 나쁜 등급입니다(셀별 결과는 아래 표).
          </p>
          {png && (
            <Stage className="flex items-center justify-center p-4">
              {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUrl(png)} alt="다면 기준평면 지도" className="block h-auto w-full max-w-[760px]" />
            </Stage>
          )}
          <TableBox minWidth={960}>
            <thead className={tableClass.thead}>
              <tr>
                <th scope="col" className={tableClass.th}>평면</th>
                <th scope="col" className={tableClass.thNum}>면적(㎡)</th>
                <th scope="col" className={tableClass.thNum}>구배(%)</th>
                <th scope="col" className={tableClass.thNum}>내리막(도)</th>
                <th scope="col" className={tableClass.thNum}>설계 대비 편차(%)</th>
                <th scope="col" className={tableClass.thNum}>보정 높이차(mm)</th>
                <th scope="col" className={tableClass.thNum}>잔차 RMSE(mm)</th>
                <th scope="col" className={tableClass.th}>등급</th>
                <th scope="col" className={tableClass.th}>사유</th>
              </tr>
            </thead>
            <tbody>
              {planes.items.map((p) => (
                <tr key={p.plane_id} className={tableClass.row}>
                  <td className={`${tableClass.td} font-mono font-medium`}>P{p.plane_id}</td>
                  <td className={tableClass.tdNum}>{fmt(p.area_m2, 1)}</td>
                  <td className={tableClass.tdNum}>{fmt(p.slope_pct, 2)}</td>
                  <td className={tableClass.tdNum}>{fmt(p.downhill_deg, 0)}</td>
                  <td className={tableClass.tdNum}>{fmt(p.dev_pct, 2)}</td>
                  <td className={tableClass.tdNum}>{fmt(p.correction_mm, 1)}</td>
                  <td className={tableClass.tdNum}>{fmt(p.rmse_mm, 1)}</td>
                  <td className={tableClass.td}>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <GradeDot grade={dotGrade(p.grade)} />
                      {p.grade}
                    </span>
                  </td>
                  <td className={`${tableClass.td} whitespace-nowrap text-xs text-muted`}>{p.reason}</td>
                </tr>
              ))}
            </tbody>
          </TableBox>
        </>
      )}
    </div>
  );
}

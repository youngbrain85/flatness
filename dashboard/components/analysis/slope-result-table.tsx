// 셀별 결과표 (스펙 §7.2·§5.3): 구배 %, 설계 대비 편차, 보정 높이차(mm), 등급,
// 역구배 표시. 판정 로직은 없다 - joinSlopeCells가 이미 조인해 낸 grade·dev_pct·
// correction_mm을 그대로 표로 옮기고, 보정 방향 문구만 slope-direction.ts로
// 계산한다(임계값 비교 없음 - 리트머스 통과).
import { correctionDirectionLabel } from '@/lib/domain/slope-direction';
import { SLOPE_GRADE_COLOR } from '@/lib/domain/slope-heatmap';
import type { SlopeCellResult } from '@/lib/domain/slope-judged';

function fmtPct(v: number | null): string {
  return v === null ? '-' : `${v.toFixed(2)}%`;
}

export function SlopeResultTable({ results, designPct }: {
  results: SlopeCellResult[];
  designPct: number;
}) {
  const rows = [...results].sort((a, b) => (
    a.cell.cy - b.cell.cy || a.cell.cx - b.cell.cx
  ));

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left text-xs text-slate-600">
          <tr>
            <th className="p-2">위치(cx,cy)</th>
            <th className="p-2">구배(%)</th>
            <th className="p-2">설계 대비 편차(%)</th>
            <th className="p-2">보정</th>
            <th className="p-2">등급</th>
            <th className="p-2">역구배 여부</th>
            <th className="p-2">사유</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const correction = correctionDirectionLabel(r.cell, r.correction_mm, designPct, r.reverse);
            return (
              <tr key={`${r.cell.cx},${r.cell.cy}`} className="border-t">
                <td className="p-2 font-medium">({r.cell.cx}, {r.cell.cy})</td>
                <td className="p-2">{fmtPct(r.cell.slope_pct)}</td>
                <td className="p-2">{fmtPct(r.dev_pct)}</td>
                <td className="p-2">{correction ?? '-'}</td>
                <td className="p-2">
                  {/* 코드리뷰 M1: jsonb는 무결성을 보장하지 않는다 - grade가 알 수 없는
                      문자열이어도 배지가 안 보이는 조용한 오표시 대신 판정불가 회색으로
                      강제한다(slopeCellFillColor의 ok=false 강제와 같은 관례). */}
                  <span className="rounded px-1.5 text-xs text-white"
                    style={{ backgroundColor: SLOPE_GRADE_COLOR[r.grade] ?? SLOPE_GRADE_COLOR.판정불가 }}>
                    {r.grade}
                  </span>
                </td>
                <td className="p-2">
                  {/* 색만으로는 안 드러나므로(스펙 §7.2) 별도 배지로 표시한다 */}
                  {r.reverse && (
                    <span className="rounded border border-red-400 bg-red-50 px-1.5 text-xs font-semibold text-red-700">
                      역구배
                    </span>
                  )}
                </td>
                <td className="p-2 text-xs text-slate-500">{r.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

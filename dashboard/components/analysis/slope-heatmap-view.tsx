// 구배 히트맵 + 배수구 클릭 (브리프 D3/D4, 스펙 §7.2)
//
// ★ 판정 이중화 아님(리트머스): 이 파일은 등급 문자열(GradedSlopeCell.grade)을
// 색으로 칠하고 클릭 픽셀을 월드 좌표로 되돌릴 뿐이다. pass_pct·re_pct·
// dir_pass_deg 같은 판정 임계값은 등장하지 않는다 - Task 4가 만든 slope-cells.ts/
// slope-heatmap.ts의 좌표 변환·렌더 함수를 그대로 쓴다(다시 만들지 않는다).
//
// 배수구 클릭 자체(엔큐 -> PATCH)는 이 컴포넌트가 하지 않는다 - analyses.params
// 전체를 알고 judge 진행 상태를 함께 표시해야 하는 상위 컴포넌트(slope-result.tsx)
// 가 유일한 진실 소스를 갖도록, 여기서는 월드 좌표만 콜백으로 올린다
// (analysis-result.tsx가 HeatmapView에 원시 데이터만 주고 뮤테이션은 상위/다른
// 컴포넌트가 하는 것과 같은 분리다).
'use client';
import { useEffect, useMemo, useRef } from 'react';
import {
  pxToWorld, slopeTransformFor, slopeWorldBounds, worldToPx,
} from '@/lib/domain/slope-cells';
import { SLOPE_GRADE_COLOR, drawSlopeHeatmap } from '@/lib/domain/slope-heatmap';
import type { GradedSlopeCell } from '@/lib/domain/slope-heatmap';
import type { SlopeCellResult } from '@/lib/domain/slope-judged';
import type { DrainPoint, SlopeGrade } from '@/lib/domain/types';

const LEGEND: SlopeGrade[] = ['적합', '경계', '보수', '재시공', '판정불가'];
const MAX_W = 640;
const MAX_H = 480;
const DRAIN_COLOR = '#1a73e8';

export function SlopeHeatmapView({
  results, cellM, drainPoints, clickable, onDrainClick,
}: {
  results: SlopeCellResult[];
  cellM: number;
  drainPoints: DrainPoint[];
  /** false면 클릭을 무시한다(브리프 D7: cells_json 없음, D5: 재판정 진행 중). */
  clickable: boolean;
  onDrainClick: (pt: DrainPoint) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bounds = useMemo(() => slopeWorldBounds(results.map((r) => r.cell)), [results]);
  const transform = useMemo(() => (bounds ? slopeTransformFor(bounds, MAX_W, MAX_H) : null), [bounds]);
  const graded: GradedSlopeCell[] = useMemo(
    () => results.map((r) => ({ cell: r.cell, grade: r.grade, reverse: r.reverse })),
    [results],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds || !transform) return;
    canvas.width = Math.max(1, Math.round((bounds.xMax - bounds.xMin) * transform.scale));
    canvas.height = Math.max(1, Math.round((bounds.yMax - bounds.yMin) * transform.scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom 등 캔버스 미지원 환경 방어(lib/viz/heatmap.test.ts와 동일한 이유)
    drawSlopeHeatmap(ctx, graded, transform, cellM);
    for (const dp of drainPoints) {
      const { px, py } = worldToPx(transform, dp.x, dp.y);
      ctx.fillStyle = DRAIN_COLOR;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [graded, bounds, transform, cellM, drainPoints]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!clickable || !transform) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    // HeatmapView(평활도)의 리뷰 Important #2와 같은 보정 - className="max-w-full"로
    // 캔버스가 CSS상 축소되면 canvas.width(실 픽셀)와 rect.width(화면 픽셀)가 달라진다.
    const sx = rect.width ? canvas.width / rect.width : 1;
    const sy = rect.height ? canvas.height / rect.height : 1;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;
    const { x, y } = pxToWorld(transform, px, py);
    onDrainClick({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  }

  return (
    <div className="space-y-3">
      {bounds ? (
        <canvas ref={canvasRef} onClick={onClick}
          className={`max-w-full rounded border bg-white ${clickable ? 'cursor-crosshair' : 'cursor-not-allowed opacity-90'}`} />
      ) : (
        <p className="text-sm text-slate-500">표시할 셀 데이터가 없습니다.</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {LEGEND.map((g) => (
          <span key={g} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: SLOPE_GRADE_COLOR[g] }} />
            {g}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: DRAIN_COLOR }} />
          배수구
        </span>
        <span className="text-slate-400">굵은 화살표 = 역구배(물이 배수구 반대로 흐름)</span>
      </div>
    </div>
  );
}

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
//
// C안(아트보드 docs/design/dark/ScanSlope.dc.html 63~77행): 캔버스는 검정 스테이지 안 여백에 두고 범례는
// 스테이지에 붙은 줄(Stage toolbar)에 둔다. 칸 색은 화면 등급 색(캔버스 palette.ts, 범례 사각은 같은 이름의
// 평활도 등급 토큰 GRADE_CLASS - SLOPE_GRADE_TO_GRADE 로 잇는다), 배수구는 DRAIN_COLOR(데이터 색 예외, 스펙 §3).
// 캔버스 버퍼 크기·클릭 환산은 그대로다.
'use client';
import { useEffect, useMemo, useRef } from 'react';
import type { MouseEvent } from 'react';
import {
  pxToWorld, slopeTransformFor, slopeWorldBounds, worldToPx,
} from '@/lib/domain/slope-cells';
import { drawSlopeHeatmap } from '@/lib/domain/slope-heatmap';
import type { GradedSlopeCell } from '@/lib/domain/slope-heatmap';
import type { SlopeCellResult } from '@/lib/domain/slope-judged';
import { SLOPE_GRADE_TO_GRADE } from '@/lib/domain/grade-tone';
import { DRAIN_COLOR, STAGE_INK } from '@/lib/domain/palette';
import { GRADE_CLASS } from '@/components/ui/grade';
import { Stage } from '@/components/ui/stage';
import type { DrainPoint, SlopeGrade } from '@/lib/domain/types';

const LEGEND: SlopeGrade[] = ['적합', '경계', '보수', '재시공', '판정불가'];
const MAX_W = 640;
const MAX_H = 480;

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
      ctx.strokeStyle = STAGE_INK;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [graded, bounds, transform, cellM, drainPoints]);

  function onClick(e: MouseEvent<HTMLCanvasElement>) {
    if (!clickable || !transform) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    // 캔버스가 CSS상 축소되면(max-w-full) canvas.width(실 픽셀)와 rect.width(화면 픽셀)가 달라진다.
    const sx = rect.width ? canvas.width / rect.width : 1;
    const sy = rect.height ? canvas.height / rect.height : 1;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;
    const { x, y } = pxToWorld(transform, px, py);
    onDrainClick({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  }

  if (!bounds) return <p className="text-sm text-muted">표시할 셀 데이터가 없습니다.</p>;

  // 범례 줄(아트보드 ScanSlope 69~76행): 12px 사각(칸과 같은 모양) + 엔진 등급 문자열, 배수구 원, 화살표 뜻.
  // 글꼴은 줄이 아니라 항목에 둔다(Stage 의 도구 줄은 배치만 맡는다)
  const ITEM = 'inline-flex items-center gap-1.5 font-mono text-xs text-ink-2';
  const legend = (
    <>
      {LEGEND.map((g) => (
        <span key={g} className={ITEM}>
          <span aria-hidden data-grade={SLOPE_GRADE_TO_GRADE[g]}
            className={`h-3 w-3 rounded-[2px] ${GRADE_CLASS[SLOPE_GRADE_TO_GRADE[g]].bg}`} />
          {g}
        </span>
      ))}
      <span className={ITEM}>
        <span aria-hidden data-legend="drain" className="h-3 w-3 rounded-full bg-drain" />
        배수구
      </span>
      {/* 코드리뷰(2차) Minor: 엔진 PNG 제목에는 화살표 의미가 적혀 있는데
          Canvas 범례에는 없었다 - 화살표를 오르막으로 오독하면 판정 근거를
          정반대로 이해하게 된다. */}
      <span className="text-xs text-muted">얇은 화살표 = 내리막(물이 흐르는) 방향</span>
      <span className="text-xs text-muted">굵은 화살표 = 역구배(물이 배수구 반대로 흐름)</span>
    </>
  );

  return (
    // 캔버스 고유 크기(최대 640x480)를 스테이지 가운데에. 휴대폰에서는 캔버스가 폭에 맞게 줄어든다(max-w-full)
    <Stage className="flex items-center justify-center p-4" toolbar={legend}>
      <canvas ref={canvasRef} onClick={onClick} role="img" aria-label="구배 판정 지도"
        className={`block h-auto max-w-full ${clickable ? 'cursor-crosshair' : 'cursor-not-allowed'}`} />
    </Stage>
  );
}

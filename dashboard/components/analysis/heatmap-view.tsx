// 히트맵 탭(셀 클릭 상세 포함)
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cellAt, cellPxFor, drawHeatmap, gridGeometry } from '@/lib/viz/heatmap';
import { GRADE_COLOR, GRADE_LABEL, ZONE_STATUS_LABEL, fmtMm } from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { Badge } from '@/components/ui/badge';
import type { CellRow, Grade, Stats, Surface, WallInfo } from '@/lib/domain/types';

const LEGEND: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];

export function HeatmapView({ surface, cells, walls, zones }: {
  surface: Surface;
  cells: CellRow[];
  walls?: WallInfo[];
  zones: Stats['zones'];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wallId, setWallId] = useState<number | null>(walls?.[0]?.wall_id ?? null);
  const [selected, setSelected] = useState<CellRow | null>(null);

  // 벽면은 zone_id가 wall_id - 선택한 벽의 셀만 표시
  const shown = useMemo(
    () => (surface === 'wall' && wallId !== null ? cells.filter((c) => c.zone_id === wallId) : cells),
    [surface, wallId, cells],
  );
  const geom = useMemo(() => gridGeometry(shown), [shown]);
  const cellPx = geom ? cellPxFor(geom, 640, 480) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !geom) return;
    canvas.width = geom.cols * cellPx;
    canvas.height = geom.rows * cellPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom 등 캔버스 미지원 환경 방어
    drawHeatmap(ctx, shown, geom, cellPx);
  }, [shown, geom, cellPx]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!geom) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    // 리뷰 Important #2: className="max-w-full"로 캔버스가 CSS상 축소되면
    // canvas.width(실 픽셀)와 rect.width(화면 픽셀)가 달라져 클릭 좌표가 어긋난다.
    // 화면 좌표를 실 픽셀 좌표로 환산해 히트테스트한다(rect가 0이면 보정하지 않는다).
    const sx = rect.width ? canvas.width / rect.width : 1;
    const sy = rect.height ? canvas.height / rect.height : 1;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;
    setSelected(cellAt(geom, shown, cellPx, px, py));
  }

  const zoneOf = (zoneId: number | null) => zones.find((z) => z.zone_id === zoneId);

  return (
    <div className="space-y-3">
      {surface === 'wall' && (walls?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {walls!.map((w) => (
            <button key={w.wall_id} onClick={() => { setWallId(w.wall_id); setSelected(null); }}
              className={`rounded-md border px-3 py-1 ${wallId === w.wall_id ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'}`}>
              벽 {w.wall_id} ({w.length_m}m x {w.height_m}m)
            </button>
          ))}
        </div>
      )}
      {geom ? (
        <canvas ref={canvasRef} onClick={onClick} className="max-w-full cursor-crosshair rounded border bg-white" />
      ) : (
        <p className="text-sm text-zinc-500">표시할 셀 데이터가 없습니다.</p>
      )}
      <div className="flex flex-wrap gap-3 text-xs">
        {LEGEND.map((g) => (
          <span key={g} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: GRADE_COLOR[g] }} />
            {GRADE_LABEL[g]}
          </span>
        ))}
      </div>
      {selected && (
        <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 rounded border bg-white p-3 text-sm">
          <dt className="text-zinc-500">판정</dt>
          <dd>
            <Badge tone={GRADE_TONE[selected.grade]}>{GRADE_LABEL[selected.grade]}</Badge>
          </dd>
          <dt className="text-zinc-500">직선자 값</dt><dd>{fmtMm(selected.value_mm)} mm</dd>
          <dt className="text-zinc-500">사용 스팬</dt><dd>{selected.span_used_m} m</dd>
          <dt className="text-zinc-500">셀 점유율</dt><dd>{Math.round(selected.occupancy * 100)}%</dd>
          <dt className="text-zinc-500">최악 지점</dt>
          <dd>{selected.worst_x !== null ? `(${selected.worst_x}, ${selected.worst_y})` : '-'}</dd>
          <dt className="text-zinc-500">{surface === 'wall' ? '벽' : '구역'}</dt>
          <dd>
            {selected.zone_id ?? '-'}
            {surface === 'floor' && zoneOf(selected.zone_id) &&
              ` (${ZONE_STATUS_LABEL[zoneOf(selected.zone_id)!.status]})`}
          </dd>
        </dl>
      )}
    </div>
  );
}

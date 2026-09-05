// 히트맵 탭(셀 클릭 상세 포함) - Cloudscape 리스킨(T7).
// 캔버스·범례 색은 산출물 팔레트 GRADE_COLOR 그대로(스펙 §3 예외·§7-4: PDF와 같은 색), 크롬만 토큰.
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cellAt, cellPxFor, drawHeatmap, gridGeometry } from '@/lib/viz/heatmap';
import { GRADE_COLOR, GRADE_LABEL, ZONE_STATUS_LABEL, fmtMm } from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { Badge } from '@/components/ui/badge';
import { TabBar } from '@/components/ui/tab-bar';
import type { CellRow, Grade, Stats, Surface, WallInfo } from '@/lib/domain/types';

const LEGEND: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];
const DT = 'text-cs-text-secondary';

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
    <div className="flex flex-col gap-3">
      {surface === 'wall' && (walls?.length ?? 0) > 0 && (
        // 벽 선택: 기존 토글 버튼을 TabBar(role=tab)로. TabBar의 id는 string이라 wall_id(number)는
        // String()/Number()로 오간다(정수 id라 왕복 손실 없음). 선택 로직(setWallId + 상세 초기화)은 그대로.
        <TabBar
          tabs={walls!.map((w) => ({ id: String(w.wall_id), label: `벽 ${w.wall_id} (${w.length_m}m x ${w.height_m}m)` }))}
          active={String(wallId)}
          onChange={(id) => { setWallId(Number(id)); setSelected(null); }}
        />
      )}
      {geom ? (
        <canvas ref={canvasRef} onClick={onClick}
          className="max-w-full cursor-crosshair rounded-lg border border-cs-divider bg-white" />
      ) : (
        <p className="text-sm text-cs-text-secondary">표시할 셀 데이터가 없습니다.</p>
      )}
      {/* 범례: 12px 사각 스와치 5종 = GRADE_COLOR hex(캔버스·PDF와 같은 색).
          text-xs leading-4는 항목 span 자체에 둔다 - 테스트의 getByText('적합')는 자기 텍스트 노드를 가진
          이 span을 돌려주므로 부모 div에만 두면 클래스 단언이 잡지 못한다. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {LEGEND.map((g) => (
          <span key={g} className="inline-flex items-center gap-1 text-xs leading-4">
            <span aria-hidden data-grade={g} className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: GRADE_COLOR[g] }} />
            {GRADE_LABEL[g]}
          </span>
        ))}
      </div>
      {selected && (
        <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-cs-divider bg-white p-3 text-sm">
          <dt className={DT}>판정</dt>
          <dd>
            <Badge tone={GRADE_TONE[selected.grade]}>{GRADE_LABEL[selected.grade]}</Badge>
          </dd>
          <dt className={DT}>직선자 값</dt><dd className="font-mono tabular-nums">{fmtMm(selected.value_mm)} mm</dd>
          <dt className={DT}>사용 스팬</dt><dd className="font-mono tabular-nums">{selected.span_used_m} m</dd>
          <dt className={DT}>셀 점유율</dt><dd className="font-mono tabular-nums">{Math.round(selected.occupancy * 100)}%</dd>
          <dt className={DT}>최악 지점</dt>
          <dd className="font-mono tabular-nums">{selected.worst_x !== null ? `(${selected.worst_x}, ${selected.worst_y})` : '-'}</dd>
          <dt className={DT}>{surface === 'wall' ? '벽' : '구역'}</dt>
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

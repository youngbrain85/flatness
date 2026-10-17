// 히트맵 탭(아트보드 docs/design/dark/ScanDone.dc.html 74~89행): 검정 스테이지 위 판정 셀 캔버스,
// 오른쪽 위 범례·왼쪽 아래 HUD, 스테이지에 붙은 설명 줄(Stage toolbar). 칸을 누르면 그 칸의 상세를 설명 줄에 보인다.
// - 판정 셀 크기 선택 줄(0.5·1·2m)과 크기별 수치는 3번 스펙 몫이라 그리지 않는다. 엔진의 셀(meta.cell_m)을 그린다.
// - 칸 색은 엔진이 cells.json 에 적은 grade 를 화면 등급 색으로 칠할 뿐이다(브라우저는 등급을 계산하지 않는다).
// - 캔버스 색은 lib/domain/palette.ts, DOM(범례 점·태그) 색은 같은 값의 등급 토큰(GradeDot·GradeBadge)이다.
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import {
  canvasMonoFamily, cellAtPoint, drawStageHeatmap, gridGeometry, heatmapAriaLabel, heatmapHud, heatmapLayout,
} from '@/lib/viz/heatmap';
import { GRADE_LABEL, ZONE_STATUS_LABEL, fmtMm } from '@/lib/domain/labels';
import { GradeBadge, GradeDot } from '@/components/ui/grade';
import { Stage } from '@/components/ui/stage';
import { TabBar } from '@/components/ui/tab-bar';
import { EYEBROW } from './result-parts';
import type { CellRow, Grade, Stats, Surface, WallInfo } from '@/lib/domain/types';

const LEGEND: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];
const BUFFER_SCALE_MAX = 2;   // 드로잉 버퍼 배율 = min(devicePixelRatio, 2)(3D 뷰어와 같은 상한)

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className={EYEBROW}>{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

export function HeatmapView({ surface, cells, walls, zones, cellM = null }: {
  surface: Surface;
  cells: CellRow[];
  walls?: WallInfo[];
  zones: Stats['zones'];
  /** 판정 셀 한 변(m). stats.meta.cell_m 그대로. 없으면(옛 분석) 축 숫자를 쓰지 않고 HUD 를 '판정 셀'로 쓴다 */
  cellM?: number | null;
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

  // 스테이지 크기를 따라 다시 그린다(ResizeObserver, jsdom 에는 없다). 버퍼는 CSS 크기 x 화면 배율이다
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !geom) return;
    const el = canvas;
    const g = geom;
    let alive = true;
    function draw() {
      if (!alive) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const scale = Math.min(window.devicePixelRatio || 1, BUFFER_SCALE_MAX);
      const bw = Math.round(w * scale);
      const bh = Math.round(h * scale);
      if (el.width !== bw || el.height !== bh) { el.width = bw; el.height = bh; }
      const ctx = el.getContext('2d');
      if (!ctx) return; // jsdom 등 2D 캔버스 미지원 환경 방어
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawStageHeatmap(ctx, {
        w, h, cells: shown, geom: g, layout: heatmapLayout(g, w, h), cellM, fontFamily: canvasMonoFamily(),
      });
    }
    draw();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(draw);
      observer.observe(el);
    }
    // 글꼴이 늦게 오면 칸 숫자·축 숫자를 IBM Plex Mono 로 다시 그린다
    void document.fonts?.ready.then(draw);
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [shown, geom, cellM]);

  // 그린 배치와 같은 함수로 누른 자리의 칸을 찾는다(CSS px, 캔버스 왼쪽 위 기준).
  // 캔버스가 스테이지를 채우므로 버퍼 대 CSS 크기 보정이 따로 필요 없다
  function onClick(e: MouseEvent<HTMLCanvasElement>) {
    if (!geom) return;
    const canvas = e.currentTarget;
    const layout = heatmapLayout(geom, canvas.clientWidth, canvas.clientHeight);
    if (!layout) return;
    const rect = canvas.getBoundingClientRect();
    setSelected(cellAtPoint(layout, geom, shown, e.clientX - rect.left, e.clientY - rect.top));
  }

  const zoneOf = (zoneId: number | null) => zones.find((z) => z.zone_id === zoneId);

  // 스테이지에 붙은 설명 줄(아트보드 ScanDone 86행). 칸을 누르면 그 칸의 상세가 줄 아래쪽 전체 폭에 붙는다
  const caption = (
    <>
      <p className="text-[13px] leading-[1.55] text-ink-2">
        위에서 내려다본 평면입니다. 칸 색은 판정 등급, 칸 숫자는 직선자 틈새 값(mm)이며 흰 테두리 칸이 최댓값입니다.
      </p>
      {selected && (
        <dl data-testid="heatmap-cell-detail"
          className="grid basis-full grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-3 lg:grid-cols-6">
          <Detail label="판정"><GradeBadge grade={selected.grade} /></Detail>
          <Detail label="직선자 값">
            <span className="font-mono tabular-nums">{fmtMm(selected.value_mm)} mm</span>
          </Detail>
          <Detail label="사용 스팬">
            <span className="font-mono tabular-nums">{selected.span_used_m} m</span>
          </Detail>
          <Detail label="셀 점유율">
            <span className="font-mono tabular-nums">{Math.round(selected.occupancy * 100)}%</span>
          </Detail>
          <Detail label="최악 지점">
            <span className="font-mono tabular-nums">
              {selected.worst_x !== null ? `(${selected.worst_x}, ${selected.worst_y})` : '-'}
            </span>
          </Detail>
          <Detail label={surface === 'wall' ? '벽' : '구역'}>
            {selected.zone_id ?? '-'}
            {surface === 'floor' && zoneOf(selected.zone_id) &&
              ` (${ZONE_STATUS_LABEL[zoneOf(selected.zone_id)!.status]})`}
          </Detail>
        </dl>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {surface === 'wall' && (walls?.length ?? 0) > 0 && (
        // 벽 선택: 알약 탭(TabBar). TabBar의 id는 string이라 wall_id(number)는
        // String()/Number()로 오간다(정수 id라 왕복 손실 없음). 선택 로직(setWallId + 상세 초기화)은 그대로.
        <TabBar
          label="벽 선택"
          tabs={walls!.map((w) => ({ id: String(w.wall_id), label: `벽 ${w.wall_id} (${w.length_m}m x ${w.height_m}m)` }))}
          active={String(wallId)}
          onChange={(id) => { setWallId(Number(id)); setSelected(null); }}
        />
      )}
      {geom ? (
        // 2:1, 최소 440px(아트보드 ScanDone). 캔버스가 스테이지를 채우고 범례·HUD 는 그 위에 겹친다
        <Stage aspect="2/1" minHeight={440} toolbar={caption}>
          <canvas ref={canvasRef} onClick={onClick} role="img" aria-label={heatmapAriaLabel(shown, geom, cellM)}
            className="absolute inset-0 block h-full w-full cursor-crosshair" />
          <ul className="pointer-events-none absolute right-[18px] top-4 flex flex-col gap-1.5 font-mono text-xs text-ink">
            {LEGEND.map((g) => (
              <li key={g} className="flex items-center gap-2">
                <GradeDot grade={g} size={10} />
                {GRADE_LABEL[g]}
              </li>
            ))}
          </ul>
          <p data-testid="heatmap-hud"
            className="pointer-events-none absolute bottom-3.5 left-[18px] pr-2 font-mono text-xs text-ink">
            {heatmapHud(shown, cellM)}
          </p>
        </Stage>
      ) : (
        <p className="text-sm text-muted">표시할 셀 데이터가 없습니다.</p>
      )}
    </div>
  );
}

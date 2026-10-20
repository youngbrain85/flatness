// 정밀 편차맵 탭 - 판정에 쓴 서브셀 잔차의 원시 편차(판정과 무관한 보조 시각화).
// residual_grid.json 이 있으면(2026-10-19~ 바닥 분석) 검정 스테이지 캔버스로 그린다(스펙 2·3 §2, 아트보드
// docs/design/dark/ScanDeviation.dc.html 74~95행): 표시 해상도 5·10·20cm 전환, 색 막대 범례(±R), HUD.
// 격자가 없거나(옛 분석·벽면) 못 받으면 엔진이 그린 밝은 PNG(deviation_paths)를 스테이지 안 여백에 둔다.
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { artifactUrl } from '@/lib/domain/paths';
import { DEVIATION_RAMP } from '@/lib/domain/palette';
import { canvasMonoFamily } from '@/lib/viz/heatmap';
import {
  RESOLUTION_FACTORS, basisGrid, colorRangeMm, deviationHud, drawDeviation, foldGrid, parseResidualGrid, rasterize,
  resolutionLabel,
} from '@/lib/viz/deviation-grid';
import type { DeviationBasis, ResidualGrid } from '@/lib/viz/deviation-grid';
import { Button } from '@/components/ui/button';
import { Stage } from '@/components/ui/stage';
import { EYEBROW, PRESSED } from './result-parts';

const WALL_FILE = /^deviation_wall(\d+)\.png$/;
const MUTED = 'text-sm text-muted';

// 워커 flatworker/report/assets.deviation_label과 같은 문구를 만든다
// (화면 캡션과 PDF 캡션이 갈리면 같은 그림이 다른 이름으로 불린다)
export function deviationLabel(name: string): string {
  const m = WALL_FILE.exec(name);
  return m ? `벽 ${m[1]} 정밀 편차맵(10cm)` : '정밀 편차맵(10cm)';
}

const BUFFER_SCALE_MAX = 2;   // 드로잉 버퍼 배율 = min(devicePixelRatio, 2)(히트맵·3D 뷰어와 같은 상한)
// 색 막대: 램프 다섯 색을 0·25·50·75·100% 에 둔다(캔버스 칸 색과 같은 상수)
const LEGEND_BAR = `linear-gradient(to right, ${DEVIATION_RAMP.map((c, i) => `${c} ${i * 25}%`).join(', ')})`;
// 기준면 전환(2026-10-20 바닥 기준면 개선): 국부(1m 창)가 기본, 전체(바닥 전체 평면)로 바꿔 볼 수 있다.
// hint: 국부 창이 1m 라 넓은 처짐은 얕게 보여 직선자 등급과 어긋나 보인다(스펙 §9) - 국부일 때만 '전체' 를 알린다
const BASES: { id: DeviationBasis; label: string; note: string; hint?: string }[] = [
  { id: 'local', label: '국부', note: '1m 국부 기준면 대비',
    hint: "1m보다 넓은 처짐·함몰은 국부 기준에서 얕게 보이므로 '전체' 기준으로 확인하세요." },
  { id: 'global', label: '전체', note: '바닥 전체 기준면 대비' },
];

// 받은 잔차 격자. key 는 이 결과를 받은 URL(분석이 바뀌면 옛 결과를 쓰지 않는다), grid 가 null 이면 못 받음
type GridLoad = { key: string; grid: ResidualGrid | null };

export function DeviationView({ artifactsDir, paths, isImport, residualGridPath = null }: {
  artifactsDir: string | null;
  paths: string[];
  // 외부(Colab) 임포트 결과 여부 - 스펙 §8/계약 §2: 임포트 경로는 편차맵을 아예 생성하지
  // 않으므로 재분석을 권해선 안 된다(무한 재시도 유도 방지). 판별은 호출부(analysis-result.tsx)가
  // lib/domain/stats.ts의 isExternalImport로 넘긴다. 3D 프리뷰 탭도 같은 값을 받아 임포트를
  // 가른다(preview3d-tab.tsx의 import 모드: 임포트 결과에는 재분석을 권하지 않는다)
  isImport: boolean;
  /** stats.residual_grid_path(바닥, 2026-10-19~). 없으면 엔진 PNG 를 보인다 */
  residualGridPath?: string | null;
}) {
  const gridKey = artifactsDir && residualGridPath ? artifactUrl(artifactsDir, residualGridPath) : null;
  const [load, setLoad] = useState<GridLoad | null>(null);
  useEffect(() => {
    if (!gridKey) return;
    let cancelled = false;
    (async () => {
      let grid: ResidualGrid | null = null;
      try {
        const res = await fetch(gridKey);
        grid = res.ok ? parseResidualGrid(await res.json()) : null;
      } catch {
        grid = null;   // 받기 실패는 PNG 대체로 드러낸다
      }
      if (!cancelled) setLoad({ key: gridKey, grid });
    })();
    return () => { cancelled = true; };
  }, [gridKey]);

  if (gridKey) {
    const mine = load?.key === gridKey ? load : null;
    if (!mine) return <p className={MUTED}>정밀 편차맵 로딩 중...</p>;
    if (mine.grid) return <ResidualCanvas key={mine.key} grid={mine.grid} />;   // 분석이 바뀌면 기준·해상도를 처음으로
    // 못 받았거나 모양이 다르면 아래 엔진 PNG 로 대체한다
  }
  if (!artifactsDir || paths.length === 0) {
    if (isImport) {
      return (
        <p className={MUTED}>
          외부(Colab) 임포트 결과에는 정밀 편차맵을 생성하지 않습니다.
        </p>
      );
    }
    return (
      <p className={MUTED}>
        정밀 편차맵이 없습니다. 이 기능이 추가되기 전 엔진으로 분석한 결과이거나,
        유효 편차 데이터가 없는 경우이거나, 이미지 생성에 실패한 경우입니다(경고 목록 확인).
        재분석하면 생성됩니다.
      </p>
    );
  }
  return (
    // 그림 고유 비율이라 aspect 는 기본('auto'), 최소 높이는 히트맵과 같은 440px(아트보드 ScanDeviation)
    <Stage minHeight={440} className="flex flex-col items-center justify-center gap-5 p-4" toolbar={
      <p className="text-[13px] leading-[1.65] text-muted">
        10cm 격자의 원시 편차 분포입니다. 0mm가 중앙(연노랑)이고 붉을수록 융기(벽은 돌출),
        초록일수록 침하(벽은 함몰)이며 회색은 데이터가 없는 구간입니다.
        판정 등급 산출에는 사용되지 않으며, 등급은 히트맵 탭의 판정 셀 기준입니다.
      </p>
    }>
      {paths.map((name) => (
        <figure key={name} className="flex w-full max-w-[960px] flex-col items-center gap-2">
          {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifactUrl(artifactsDir, name)} alt={deviationLabel(name)} className="block h-auto w-full" />
          <figcaption className="font-mono text-xs text-ink-2">{deviationLabel(name)}</figcaption>
        </figure>
      ))}
    </Stage>
  );
}

/** 잔차 격자 캔버스: 표시 해상도(5·10·20cm)로 접어 칠한다. 색 범위 R 은 원 격자 기준이라 해상도를 바꿔도 같다. */
function ResidualCanvas({ grid }: { grid: ResidualGrid }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [factor, setFactor] = useState<number>(RESOLUTION_FACTORS[0]);
  const [basis, setBasis] = useState<DeviationBasis>('local');
  const hasGlobal = Array.isArray(grid.values_global);   // 없으면 옛 파일(구역 평면 기준)
  const active = useMemo(() => basisGrid(grid, basis), [grid, basis]);
  const folded = useMemo(() => foldGrid(active, factor), [active, factor]);
  const range = useMemo(() => colorRangeMm(active), [active]);
  const base = hasGlobal ? BASES.find((b) => b.id === basis)! : null;   // 옛 파일은 전환이 없다
  const basisNote = base ? base.note : '구역 평면 대비';
  const resLabel = resolutionLabel(grid.subcell_m, factor);
  const hud = deviationHud(folded, resLabel);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const el = canvas;
    // 한 칸 = 1px 인 작은 그림(화면에 붙이지 않는 캔버스). 그릴 때 확대해 옮긴다
    let raster: HTMLCanvasElement | null = null;
    if (folded.n) {
      const oc = document.createElement('canvas');
      oc.width = folded.cols;
      oc.height = folded.rows;
      const octx = oc.getContext('2d');
      if (octx) {
        const img = octx.createImageData(folded.cols, folded.rows);
        img.data.set(rasterize(folded, range));
        octx.putImageData(img, 0, 0);
        raster = oc;
      }
    }
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
      drawDeviation(ctx, { w, h, f: folded, raster, fontFamily: canvasMonoFamily() });
    }
    draw();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(draw);
      observer.observe(el);
    }
    void document.fonts?.ready.then(draw);
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [folded, range]);

  const toolbar = (
    <>
      {hasGlobal && (
        <div role="group" aria-label="기준면" className="flex flex-wrap items-center gap-2">
          <span className={EYEBROW}>기준면</span>
          {BASES.map((b) => (
            <Button key={b.id} aria-pressed={b.id === basis} className={PRESSED} onClick={() => setBasis(b.id)}>
              {b.label}
            </Button>
          ))}
        </div>
      )}
      <div role="group" aria-label="표시 해상도" className="flex flex-wrap items-center gap-2">
        <span className={EYEBROW}>표시 해상도</span>
        {RESOLUTION_FACTORS.map((k) => (
          <Button key={k} aria-pressed={k === factor} className={`${PRESSED} font-mono tabular-nums`}
            onClick={() => setFactor(k)}>
            {resolutionLabel(grid.subcell_m, k).replace('cm', ' cm')}
          </Button>
        ))}
      </div>
      <p className="basis-full text-[13px] leading-[1.65] text-muted">
        {`${basisNote} ${resLabel} 격자의 원시 편차 분포입니다. 0mm가 중앙(짙은 남색)이고 붉을수록 융기, 파랄수록 침하이며 `
          + '검게 비어 있는 곳은 데이터가 없는 구간입니다. 판정 등급 산출에는 사용되지 않으며, 등급은 히트맵 탭의 판정 셀 기준입니다.'
          + (base?.hint ? ` ${base.hint}` : '')}
      </p>
    </>
  );

  return (
    // 2:1, 최소 440px(아트보드 ScanDeviation). 캔버스가 스테이지를 채우고 범례·HUD 는 그 위에 겹친다
    <Stage aspect="2/1" minHeight={440} toolbar={toolbar}>
      <canvas ref={canvasRef} role="img"
        aria-label={`정밀 편차맵 평면도. ${hud}${folded.n ? '. 0mm 짙은 남색, 융기 빨강, 침하 파랑' : ''}`}
        className="absolute inset-0 block h-full w-full" />
      <div data-testid="deviation-legend"
        className="pointer-events-none absolute right-[18px] top-4 flex w-44 max-w-[calc(100%-36px)] flex-col gap-1.5 font-mono text-xs text-ink">
        <p className="text-[11px] text-ink-2">편차 (mm), + 융기 / − 침하</p>
        <div aria-hidden="true" className="h-2.5 rounded-full" style={{ background: LEGEND_BAR }} />
        {folded.n > 0 && (
          <div className="flex justify-between gap-2 tabular-nums">
            <span>{`−${range.toFixed(1)}`}</span><span>0</span><span>{`+${range.toFixed(1)}`}</span>
          </div>
        )}
      </div>
      <p data-testid="deviation-hud"
        className="pointer-events-none absolute bottom-3.5 left-[18px] pr-2 font-mono text-xs text-ink">
        {hud}
      </p>
    </Stage>
  );
}

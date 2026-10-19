// 평활도 결과 구획(아트보드 docs/design/dark/ScanDone.dc.html 53~196행). 페이지는 감싸지 않고 이 컴포넌트가
// <section> 을 통째로 그린다: h2 '평활도 결과' + 일시 · 엔진(+외부 결과) + 알약 탭 → 탭 본문(검정 스테이지)
// → 판정 패널(KPI·등급 분포·적용 기준·경고·종합의견) → 구간별 결과표.
// 판정 셀 크기 선택 줄(0.5·1·2m, 아트보드 60~64행)은 히트맵 탭에서만 보인다. 바꾸면 히트맵·HUD 만 바뀌고 KPI·결과표·
// 보고서는 공식 판정 셀(meta.cell_m) 그대로다(스펙 2·3 §1). 비교 셀(cells_alt.json)이 없는 분석은 줄을 숨긴다.
'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ANALYSIS_KIND_LABEL } from '@/lib/domain/labels';
import { artifactUrl } from '@/lib/domain/paths';
import { loadFor, parsePoints3d, points3dFile } from '@/lib/domain/points3d';
import type { Points3dLoad, Webgl2Support } from '@/lib/domain/points3d';
import { cellSizeOptions, parseCellsAlt } from '@/lib/domain/cells';
import type { CellsBySize } from '@/lib/domain/cells';
import { isExternalImport } from '@/lib/domain/stats';
import type { AnalysisRow, CellRow, PhotoRow, ScanRow, Stats } from '@/lib/domain/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TabBar } from '@/components/ui/tab-bar';
import { HeatmapView } from './heatmap-view';
import { DeviationView } from './deviation-view';
import { Preview3dTab } from './preview3d-tab';
import { VerdictPanel } from './verdict-panel';
import { ResultTable } from './result-table';
import { CARD, EYEBROW, NOTE, PRESSED, resultMeta } from './result-parts';
import { PhotoGallery } from '@/components/photo-gallery';
import { RefreshOnUpload } from '@/components/refresh-on-upload';

type Tab = 'heatmap' | 'deviation' | 'preview3d' | 'photos';

// 탭 순서·문구는 기존 그대로(아트보드 ScanDone의 4탭과 같다)
const TABS: { id: Tab; label: string }[] = [
  { id: 'heatmap', label: '히트맵' },
  { id: 'deviation', label: '정밀 편차맵' },
  { id: 'preview3d', label: '3D 프리뷰' },
  { id: 'photos', label: '현장 사진' },
];

const MUTED = 'text-sm text-muted';

export function AnalysisResult({ analysis, scan, photos }: {
  analysis: AnalysisRow;
  scan: ScanRow;
  photos: PhotoRow[];
}) {
  const headingId = useId();
  const stats = analysis.stats as Stats; // status done 전제(페이지에서 보장)
  const [tab, setTab] = useState<Tab>('heatmap');
  const [cells, setCells] = useState<CellRow[] | null>(null);
  const [cellsError, setCellsError] = useState<string | null>(null);
  // 비교용 1·2m 셀(cells_alt.json)과 고른 크기(null = 공식 판정 셀). 못 받으면 null 로 두고 전환을 숨긴다
  const [cellsAlt, setCellsAlt] = useState<CellsBySize | null>(null);
  const [cellSize, setCellSize] = useState<string | null>(null);
  // 3D 점군 뷰어(2026-10-02 스펙 §7.3). 탭 본문은 조건부 렌더라 탭을 벗어나면 언마운트된다.
  // 탭 왕복 뒤에도 남아야 하는 세 가지(점 데이터, WebGL2 탐지 결과, 소프트웨어 렌더 선택)를 여기에 둔다.
  const [load, setLoad] = useState<Points3dLoad>({ status: 'idle' });
  const [support, setSupport] = useState<Webgl2Support | null>(null);
  const [optedIn, setOptedIn] = useState(false);
  // 진행 중인 점 파일 요청의 dir. 개발 모드의 effect 이중 실행은 같은 렌더의 load(아직 idle)를 두 번 보므로,
  // state 만으로는 fetch 가 두 번 나간다. ref 는 첫 호출이 남긴 값을 둘째 호출이 곧바로 본다.
  const pendingDir = useRef<string | null>(null);
  // 진행 중인 점 파일 요청의 중단기. 새 요청을 시작하거나(?analysis= 전환) 언마운트하면 끊어 다운로드를 멈춘다
  const pendingAbort = useRef<AbortController | null>(null);

  useEffect(() => () => pendingAbort.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 이펙트 본문 최상단 동기 setState는 린트 경고 대상이라 IIFE 내부로 통일한다
      if (!analysis.artifacts_dir) { setCellsError('산출물 경로가 없습니다'); return; }
      const res = await fetch(artifactUrl(analysis.artifacts_dir, 'cells.json'));
      if (!res.ok) {
        if (!cancelled) setCellsError('셀 데이터를 저장소에서 찾을 수 없습니다. 파일이 삭제되었거나 아직 업로드되지 않았을 수 있습니다. 스캔 상세에서 재분석을 시도하세요.');
        return;
      }
      const data = (await res.json()) as CellRow[];
      if (!cancelled) setCells(data);
    })();
    return () => { cancelled = true; };
  }, [analysis.artifacts_dir]);

  const cellsAltPath = stats.cells_alt_path ?? null;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCellsAlt(null);
      setCellSize(null);
      if (!analysis.artifacts_dir || !cellsAltPath) return;
      try {
        const res = await fetch(artifactUrl(analysis.artifacts_dir, cellsAltPath));
        const parsed = res.ok ? parseCellsAlt(await res.json()) : null;
        if (!cancelled) setCellsAlt(parsed);
      } catch {
        // 비교 셀은 보조 표시다. 못 받으면 전환 없이 공식 셀만 보인다
      }
    })();
    return () => { cancelled = true; };
  }, [analysis.artifacts_dir, cellsAltPath]);

  const officialM = stats.meta.cell_m ?? null;
  const sizeOptions = officialM !== null && cellsAlt ? cellSizeOptions(officialM, cellsAlt) : [];
  const picked = sizeOptions.find((o) => o.id === cellSize && !o.official) ?? null;
  const heatmapCells = picked && cellsAlt ? cellsAlt[picked.key!] : cells;
  const heatmapCellM = picked ? picked.cellM : officialM;

  const deviation = (stats.deviation_paths ?? []).filter(Boolean);
  const isImport = isExternalImport(analysis.engine_version, stats.meta);
  const points3dDir = analysis.artifacts_dir;
  // 받을 파일 이름은 엔진이 stats 에 적은 값이다. 대시보드에 파일명 상수를 두지 않는다(다른 *_paths 와 같은 규약).
  const points3dName = points3dFile(stats);

  // 점 파일을 받는다. 마운트 때가 아니라 Preview3dTab 의 요청 effect(또는 다시 시도 버튼)가 부를 때만 시작한다.
  // 서명 URL 을 보관하지 않는다. 다시 받을 때도 /api/data 를 다시 거친다.
  function startPoints3dLoad(dir: string, file: string) {
    pendingAbort.current?.abort();   // 앞 요청이 아직 받는 중이면 끊는다(끝난 요청이면 null 이다)
    const controller = new AbortController();
    pendingAbort.current = controller;
    pendingDir.current = dir;
    setLoad({ status: 'loading', dir });
    void (async () => {
      let next: Points3dLoad;
      // fetch 와 arrayBuffer() 는 둘 다 reject 할 수 있다(slope-result.tsx 와 같은 양식).
      // 잡지 않으면 화면이 로딩 틀에 영구히 멈춘다(조용한 실패 금지).
      try {
        const res = await fetch(artifactUrl(dir, file), { signal: controller.signal });
        if (!res.ok) {
          next = { status: 'error', dir, reason: 'fetch' };
        } else {
          const parsed = parsePoints3d(await res.arrayBuffer());
          next = parsed.ok
            ? { status: 'ready', dir, data: parsed.data }
            : { status: 'error', dir, reason: 'format' };
        }
      } catch {
        next = { status: 'error', dir, reason: 'fetch' };
      }
      // 끊긴 요청은 결과를 버린다. AbortError 를 받기 실패(M5)로 드러내지 않고, 뒤에 시작한 요청의 몫도 건드리지 않는다
      if (controller.signal.aborted) return;
      if (pendingAbort.current === controller) pendingAbort.current = null;
      if (pendingDir.current === dir) pendingDir.current = null;
      // 늦게 온 응답을 버린다: 지금도 이 dir 의 응답을 기다리는 중일 때만 반영한다.
      // 그 사이 다른 분석의 요청이 시작됐으면(?analysis= 전환) 상태를 건드리지 않는다.
      setLoad((cur) => (cur.status === 'loading' && cur.dir === dir ? next : cur));
    })();
  }

  // 멱등: 이 분석의 요청이 이미 시작됐거나 끝났으면 아무것도 하지 않는다.
  // 다른 분석의 옛 상태는 loadFor 가 idle 로 보므로 새 요청이 그것을 교체한다(load 를 되돌리는 effect 는 두지 않는다).
  function requestPoints3dLoad() {
    if (points3dDir === null || points3dName === null) return;
    if (loadFor(load, points3dDir).status !== 'idle' || pendingDir.current === points3dDir) return;
    startPoints3dLoad(points3dDir, points3dName);
  }

  // 다시 시도: 멱등 검사 없이 상태를 버리고 곧바로 다시 받는다.
  function retryPoints3dLoad() {
    if (points3dDir === null || points3dName === null) return;
    startPoints3dLoad(points3dDir, points3dName);
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3.5">
      {/* 머리: 제목·메타(왼쪽) + 알약 탭(오른쪽, 좁으면 아래로). 아트보드 ScanDone 54~73행 */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2.5">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <h2 id={headingId} className="font-heading text-[19px] font-semibold">{ANALYSIS_KIND_LABEL.flatness} 결과</h2>
            <span className="font-mono text-xs tabular-nums text-muted">
              {resultMeta(analysis.created_at, analysis.engine_version)}
            </span>
            {isImport && <Badge tone="external">외부 결과</Badge>}
          </div>
          {tab === 'heatmap' && sizeOptions.length > 1 && (
            <div role="group" aria-label="판정 셀" className="flex flex-wrap items-center gap-2">
              <span className={EYEBROW}>판정 셀</span>
              {sizeOptions.map((o) => (
                <Button key={o.id} aria-pressed={o.id === (picked?.id ?? String(officialM))}
                  className={`${PRESSED} font-mono tabular-nums`} onClick={() => setCellSize(o.id)}>
                  {o.label}
                </Button>
              ))}
              <span className={NOTE}>{`판정·보고서는 ${officialM} m 셀 기준이며, 다른 크기는 히트맵 비교용입니다.`}</span>
            </div>
          )}
        </div>
        <TabBar label="결과 보기" tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === 'heatmap' && (
        heatmapCells ? (
          // key: 크기를 바꾸면 칸 선택(상세 줄)을 새로 시작한다
          <HeatmapView key={heatmapCellM ?? 'na'} surface={analysis.surface} cells={heatmapCells} walls={stats.walls}
            zones={stats.zones} cellM={heatmapCellM} />
        ) : (
          <p className={MUTED}>{cellsError ?? '셀 데이터 로딩 중...'}</p>
        )
      )}
      {tab === 'deviation' && (
        <DeviationView artifactsDir={analysis.artifacts_dir} paths={deviation} isImport={isImport} />
      )}
      {tab === 'preview3d' && (
        // key: 이 컴포넌트는 ?analysis= 로 분석을 바꿔도 같은 인스턴스가 재사용된다(page.tsx 에 key 가 없다).
        // 분석이 바뀌면 탭 본문을 새로 마운트해 오류 플래그와 뷰어의 시점·과장·임계값·배경을 초기값으로 되돌린다.
        <Preview3dTab key={analysis.id} analysis={analysis} stats={stats} scan={scan} isImport={isImport}
          load={load} support={support} optedIn={optedIn}
          onSupport={setSupport} onOptIn={() => setOptedIn(true)}
          onRequestLoad={requestPoints3dLoad} onRetryLoad={retryPoints3dLoad} />
      )}
      {tab === 'photos' && (
        <div className={`${CARD} flex flex-col gap-3`}>
          <RefreshOnUpload target={{ scan_id: scan.id }} />
          <PhotoGallery photos={photos} />
        </div>
      )}

      <VerdictPanel analysis={analysis} stats={stats} />

      <div className="flex flex-col gap-2.5">
        {/* 결과 구획 제목이 h2이므로 표 제목은 h3 */}
        <h3 className="font-heading text-base font-semibold">구간별 결과표</h3>
        {cells ? <ResultTable stats={stats} cells={cells} /> :
          <p className={MUTED}>{cellsError ?? '셀 데이터 로딩 중...'}</p>}
      </div>
    </section>
  );
}

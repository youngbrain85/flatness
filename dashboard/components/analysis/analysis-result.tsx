// C안 전체 골격 - Cloudscape 리스킨(T7). 컨테이너('평활도 결과' 헤더)는 페이지가 그리고(T6),
// 이 컴포넌트는 그 본문(TabBar → 3:2 그리드[히트맵 | 판정 패널] → 구간별 결과표)만 그린다.
'use client';
import { useEffect, useRef, useState } from 'react';
import { artifactUrl } from '@/lib/domain/paths';
import { loadFor, parsePoints3d, points3dFile } from '@/lib/domain/points3d';
import type { Points3dLoad, Webgl2Support } from '@/lib/domain/points3d';
import { isExternalImport } from '@/lib/domain/stats';
import type { AnalysisRow, CellRow, PhotoRow, ScanRow, Stats } from '@/lib/domain/types';
import { TabBar } from '@/components/ui/tab-bar';
import { HeatmapView } from './heatmap-view';
import { DeviationView } from './deviation-view';
import { Preview3dTab } from './preview3d-tab';
import { VerdictPanel } from './verdict-panel';
import { ResultTable } from './result-table';
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

// 3:2 그리드(아트보드 minmax(0,3fr) minmax(0,2fr), gap 20px). md 미만은 세로 스택(스펙 §5).
// slope-result.tsx가 같은 문자열을 갖는다(구배 화면이 평활도 모듈 전체를 끌어오지 않도록 import 대신 복제).
const RESULT_GRID = 'grid items-start gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]';
const MUTED = 'text-sm text-cs-text-secondary';

export function AnalysisResult({ analysis, scan, photos }: {
  analysis: AnalysisRow;
  scan: ScanRow;
  photos: PhotoRow[];
}) {
  const stats = analysis.stats as Stats; // status done 전제(페이지에서 보장)
  const [tab, setTab] = useState<Tab>('heatmap');
  const [cells, setCells] = useState<CellRow[] | null>(null);
  const [cellsError, setCellsError] = useState<string | null>(null);
  // 3D 점군 뷰어(2026-10-02 스펙 §7.3). 탭 본문은 조건부 렌더라 탭을 벗어나면 언마운트된다.
  // 탭 왕복 뒤에도 남아야 하는 세 가지(점 데이터, WebGL2 탐지 결과, 소프트웨어 렌더 선택)를 여기에 둔다.
  const [load, setLoad] = useState<Points3dLoad>({ status: 'idle' });
  const [support, setSupport] = useState<Webgl2Support | null>(null);
  const [optedIn, setOptedIn] = useState(false);
  // 진행 중인 점 파일 요청의 dir. 개발 모드의 effect 이중 실행은 같은 렌더의 load(아직 idle)를 두 번 보므로,
  // state 만으로는 fetch 가 두 번 나간다. ref 는 첫 호출이 남긴 값을 둘째 호출이 곧바로 본다.
  const pendingDir = useRef<string | null>(null);

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

  const deviation = (stats.deviation_paths ?? []).filter(Boolean);
  const isImport = isExternalImport(analysis.engine_version, stats.meta);
  const points3dDir = analysis.artifacts_dir;
  // 받을 파일 이름은 엔진이 stats 에 적은 값이다. 대시보드에 파일명 상수를 두지 않는다(다른 *_paths 와 같은 규약).
  const points3dName = points3dFile(stats);

  // 점 파일을 받는다. 마운트 때가 아니라 Preview3dTab 의 요청 effect(또는 다시 시도 버튼)가 부를 때만 시작한다.
  // 서명 URL 을 보관하지 않는다. 다시 받을 때도 /api/data 를 다시 거친다.
  function startPoints3dLoad(dir: string, file: string) {
    pendingDir.current = dir;
    setLoad({ status: 'loading', dir });
    void (async () => {
      let next: Points3dLoad;
      // fetch 와 arrayBuffer() 는 둘 다 reject 할 수 있다(slope-result.tsx 와 같은 양식).
      // 잡지 않으면 화면이 로딩 틀에 영구히 멈춘다(조용한 실패 금지).
      try {
        const res = await fetch(artifactUrl(dir, file));
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
    <div className="flex flex-col gap-5">
      <div className={RESULT_GRID}>
        <section className="flex min-w-0 flex-col gap-4">
          <TabBar tabs={TABS} active={tab} onChange={setTab} />
          {tab === 'heatmap' && (
            cells ? (
              <HeatmapView surface={analysis.surface} cells={cells} walls={stats.walls} zones={stats.zones} />
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
            <div className="flex flex-col gap-2">
              <RefreshOnUpload target={{ scan_id: scan.id }} />
              <PhotoGallery photos={photos} />
            </div>
          )}
        </section>
        <div className="min-w-0 md:sticky md:top-5 md:self-start">
          <VerdictPanel analysis={analysis} stats={stats} />
        </div>
      </div>
      <section className="flex flex-col gap-2">
        {/* 컨테이너 제목이 h2이므로 본문 소제목은 h3 */}
        <h3 className="text-base font-bold leading-5">구간별 결과표</h3>
        {cells ? <ResultTable stats={stats} cells={cells} /> :
          <p className={MUTED}>{cellsError ?? '셀 데이터 로딩 중...'}</p>}
      </section>
    </div>
  );
}

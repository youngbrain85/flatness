// C안 전체 골격 - Cloudscape 리스킨(T7). 컨테이너('평활도 결과' 헤더)는 페이지가 그리고(T6),
// 이 컴포넌트는 그 본문(TabBar → 3:2 그리드[히트맵 | 판정 패널] → 구간별 결과표)만 그린다.
'use client';
import { useEffect, useState } from 'react';
import { artifactUrl } from '@/lib/domain/paths';
import { isExternalImport } from '@/lib/domain/stats';
import type { AnalysisRow, CellRow, PhotoRow, ScanRow, Stats } from '@/lib/domain/types';
import { TabBar } from '@/components/ui/tab-bar';
import { HeatmapView } from './heatmap-view';
import { DeviationView } from './deviation-view';
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

  const preview3d = (stats.preview3d_paths ?? []).filter(Boolean);
  const deviation = (stats.deviation_paths ?? []).filter(Boolean);
  const isImport = isExternalImport(analysis.engine_version, stats.meta);

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
            preview3d.length > 0 ? (
              <div className="flex flex-col gap-3">
                {preview3d.map((name) => (
                  // 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={name} src={artifactUrl(analysis.artifacts_dir!, name)} alt={`3D 프리뷰 ${name}`}
                    className="max-w-full rounded-lg border border-cs-divider bg-white" />
                ))}
                <p className="text-xs leading-4 text-cs-text-secondary">
                  워커가 생성한 정적 3D 프리뷰입니다(회전·줌 가능한 뷰어는 정식 단계 백로그).
                </p>
              </div>
            ) : (
              <p className={MUTED}>
                3D 프리뷰가 없습니다{analysis.surface === 'wall' ? ' (벽면 분석은 3D 프리뷰를 생성하지 않습니다)' : ''}.
              </p>
            )
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

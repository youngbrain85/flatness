// C안 전체 골격
'use client';
import { useEffect, useState } from 'react';
import { artifactUrl } from '@/lib/domain/paths';
import type { AnalysisRow, CellRow, PhotoRow, ScanRow, Stats } from '@/lib/domain/types';
import { HeatmapView } from './heatmap-view';
import { VerdictPanel } from './verdict-panel';
import { ResultTable } from './result-table';
import { PhotoGallery } from '@/components/photo-gallery';
import { RefreshOnUpload } from '@/components/refresh-on-upload';

type Tab = 'heatmap' | 'preview3d' | 'photos';

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
        if (!cancelled) setCellsError('셀 데이터를 불러오지 못했습니다. 워커 PC의 data/ 디렉터리와 DATA_DIR 설정을 확인하세요.');
        return;
      }
      const data = (await res.json()) as CellRow[];
      if (!cancelled) setCells(data);
    })();
    return () => { cancelled = true; };
  }, [analysis.artifacts_dir]);

  const preview3d = (stats.preview3d_paths ?? []).filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-2 flex gap-2 text-sm">
            {([['heatmap', '히트맵'], ['preview3d', '3D 프리뷰'], ['photos', '현장 사진']] as const)
              .map(([key, label]) => (
                <button key={key} onClick={() => setTab(key)}
                  className={`rounded border px-3 py-1 ${tab === key ? 'bg-slate-800 text-white' : 'bg-white'}`}>
                  {label}
                </button>
              ))}
          </div>
          {tab === 'heatmap' && (
            cells ? (
              <HeatmapView surface={analysis.surface} cells={cells} walls={stats.walls} zones={stats.zones} />
            ) : (
              <p className="text-sm text-slate-500">{cellsError ?? '셀 데이터 로딩 중...'}</p>
            )
          )}
          {tab === 'preview3d' && (
            preview3d.length > 0 ? (
              <div className="space-y-3">
                {preview3d.map((name) => (
                  // 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={name} src={artifactUrl(analysis.artifacts_dir!, name)} alt={`3D 프리뷰 ${name}`}
                    className="max-w-full rounded border bg-white" />
                ))}
                <p className="text-xs text-slate-500">
                  워커가 생성한 정적 3D 프리뷰입니다(회전·줌 가능한 뷰어는 정식 단계 백로그).
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                3D 프리뷰가 없습니다{analysis.surface === 'wall' ? ' (벽면 분석은 3D 프리뷰를 생성하지 않습니다)' : ''}.
              </p>
            )
          )}
          {tab === 'photos' && (
            <div className="space-y-2">
              <RefreshOnUpload target={{ scan_id: scan.id }} />
              <PhotoGallery photos={photos} />
            </div>
          )}
        </section>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <VerdictPanel analysis={analysis} stats={stats} />
        </div>
      </div>
      <section>
        <h2 className="mb-2 font-semibold">구간별 결과표</h2>
        {cells ? <ResultTable stats={stats} cells={cells} /> :
          <p className="text-sm text-slate-500">{cellsError ?? '셀 데이터 로딩 중...'}</p>}
      </section>
    </div>
  );
}

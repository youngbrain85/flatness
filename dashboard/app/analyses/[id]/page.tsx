import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnalysisResult } from '@/components/analysis/analysis-result';
import { SlopePlaceholder } from '@/components/analysis/slope-placeholder';
import { ANALYSIS_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import { isSlopeStats } from '@/lib/domain/stats';
import type { AnalysisRow, LocationRow, PhotoRow, ScanRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: analysis } = await supabase.from('analyses').select('*').eq('id', id).maybeSingle();
  if (!analysis) notFound();
  const a = analysis as AnalysisRow;
  const { data: scan } = await supabase.from('scans').select('*').eq('id', a.scan_id).maybeSingle();
  if (!scan) notFound();
  const s = scan as ScanRow;
  const [locRes, photosRes] = await Promise.all([
    supabase.from('locations').select('*').eq('id', s.location_id).maybeSingle(),
    supabase.from('photos').select('*').eq('scan_id', s.id).order('created_at', { ascending: false }),
  ]);
  const loc = locRes.data as LocationRow | null;

  if (a.status !== 'done' || !a.stats) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <p className="text-sm text-slate-600">
          이 분석은 아직 완료되지 않았습니다 (상태: {ANALYSIS_STATUS_LABEL[a.status]}).{' '}
          <Link href={`/scans/${s.id}`} className="text-blue-700 hover:underline">스캔 상세에서 진행 상태 보기</Link>
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-bold">
          분석 결과 · {SURFACE_LABEL[a.surface]} · {s.scanned_at}
        </h1>
        <p className="text-sm text-slate-500">
          {loc ? [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ') : ''}
          {' · '}엔진 {a.engine_version ?? '-'}
          {' · '}<Link href={`/scans/${s.id}`} className="text-blue-700 hover:underline">스캔 상세</Link>
        </p>
      </div>
      {isSlopeStats(a.stats) ? (
        // 단계 C 회귀 차단: analyses/[id]는 .eq('id', id)뿐이라 어떤 쿼리 필터로도
        // URL 직접 접근을 막을 수 없다. stats.format 내용 기반으로 갈라 AnalysisResult로
        // 흘려보내면 lib/domain/stats.ts의 coverageLabel이 stats.meta를 옵셔널 체이닝
        // 없이 읽어 TypeError로 페이지가 죽는다 - 구배 결과는 안내 화면(단계 D까지)으로.
        <SlopePlaceholder stats={a.stats} />
      ) : (
        <AnalysisResult analysis={a} scan={s} photos={(photosRes.data ?? []) as PhotoRow[]} />
      )}
    </main>
  );
}

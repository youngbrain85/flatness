// 스캔 상세: 메타데이터 + 상태별 다음 행동
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnalysisProgress } from '@/components/analysis-progress';
import { GRADE_COLOR, GRADE_LABEL, LINEAGE_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import type { AnalysisRow, LocationRow, ScanRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: scan } = await supabase.from('scans').select('*').eq('id', id).maybeSingle();
  if (!scan) notFound();
  const s = scan as ScanRow;
  const [locRes, analysesRes] = await Promise.all([
    supabase.from('locations').select('*').eq('id', s.location_id).maybeSingle(),
    supabase.from('analyses').select('*').eq('scan_id', id).is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ]);
  const loc = locRes.data as LocationRow | null;
  const analyses = (analysesRes.data ?? []) as AnalysisRow[];
  const latest = analyses[0];
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <h1 className="text-xl font-bold">
        스캔 상세 · {SURFACE_LABEL[s.surface]} · {s.scanned_at}
      </h1>
      <dl className="grid max-w-xl grid-cols-2 gap-x-4 gap-y-1 rounded border bg-white p-4 text-sm">
        <dt className="text-slate-500">측정위치</dt>
        <dd>{loc ? [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ') : '-'}</dd>
        <dt className="text-slate-500">원본 파일</dt><dd>{s.original_filename ?? '-'}</dd>
        <dt className="text-slate-500">장비</dt><dd>{s.device ?? '-'}</dd>
        <dt className="text-slate-500">데이터 계보</dt><dd>{LINEAGE_LABEL[s.lineage]}</dd>
        <dt className="text-slate-500">상태</dt><dd>{SCAN_STATUS_LABEL[s.status]}</dd>
        <dt className="text-slate-500">단위 배율</dt><dd>{s.unit_scale ?? '미확정'}</dd>
      </dl>
      {s.status === 'awaiting_unit_confirm' && (
        <Link href={`/scans/${id}/confirm-unit`}
          className="inline-block rounded bg-blue-700 px-3 py-1.5 text-sm text-white">
          단위 확인하고 분석 시작
        </Link>
      )}
      {s.status === 'uploaded' && (
        <p className="text-sm text-slate-600">
          사전 검사 대기 중입니다. 워커가 실행 중인지 확인하세요(python -m flatworker).
          이 화면을 새로고침하면 상태가 갱신됩니다.
        </p>
      )}
      {latest && (
        <section className="space-y-2">
          <h2 className="font-semibold">분석</h2>
          <AnalysisProgress analysisId={latest.id} initialStatus={latest.status} />
          {analyses.length > 1 && (
            <ul className="text-sm text-slate-600">
              {analyses.slice(1).map((a) => (
                <li key={a.id}>
                  <Link href={`/analyses/${a.id}`} className="hover:underline">
                    이전 분석 {a.created_at.slice(0, 16).replace('T', ' ')}
                    {a.overall_verdict && (
                      <span className="ml-1 rounded px-1.5 text-xs text-white"
                        style={{ backgroundColor: GRADE_COLOR[a.overall_verdict] }}>
                        {GRADE_LABEL[a.overall_verdict]}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

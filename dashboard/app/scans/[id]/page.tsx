// 스캔 상세: 메타데이터 + 상태별 다음 행동
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnalysisProgress } from '@/components/analysis-progress';
import { ReanalyzeButton } from '@/components/reanalyze-button';
import { ScanStatusWatcher } from '@/components/scan-status-watcher';
import { GRADE_COLOR, GRADE_LABEL, LINEAGE_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import type { AnalysisRow, LocationRow, ScanRow } from '@/lib/domain/types';

// Realtime 감시가 필요한 진행 중 상태(리뷰 Important 2) — ready/archived/failed는
// 이미 종결됐거나(ready는 이 화면 자체에서 동기적으로 전이시킨 값) 더 이상 워커가
// 바꾸지 않는 상태라 구독 대상에서 제외한다.
const WATCHED_SCAN_STATUSES = new Set(['uploaded', 'awaiting_unit_confirm']);

export const dynamic = 'force-dynamic';

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
      {WATCHED_SCAN_STATUSES.has(s.status) && (
        <ScanStatusWatcher scanId={id} initialStatus={s.status} />
      )}
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
      {s.status === 'failed' && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-700">사전 검사에 실패했습니다.</p>
          <p className="mt-1 text-xs text-slate-600">
            가장 흔한 원인은 지원하지 않는 파일 포맷이나 손상·불완전한 파일입니다.
            파일을 확인한 뒤 업로드 화면에서 새 스캔으로 다시 시도하세요. 상세 원인은
            워커 실행 창의 로그에 남습니다(3회 자동 재시도 후에도 실패한 상태입니다).
          </p>
        </div>
      )}
      {latest && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">분석</h2>
            {user && (
              <ReanalyzeButton scanId={id} userId={user.id} surface={s.surface}
                criteriaId={latest.criteria_id} latestStatus={latest.status} />
            )}
          </div>
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

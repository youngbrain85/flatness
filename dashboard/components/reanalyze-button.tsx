// 스캔 상세: 기존 스캔을 다시 분석하는 버튼(요구사항 C5).
//
// 엔진 개선·판정 기준 변경 후 이미 분석이 끝난 스캔을 다시 돌릴 방법이 없었다
// (기존에는 업로드 시에만 analyses 행이 생겼다). unit-confirm-form.tsx와 동일한
// 패턴(새 analyses 행 생성 -> fn_enqueue_job('analyze', ...))을 재사용한다.
//
// is_current 전환은 여기서 손대지 않는다: 새 행은 기본값 is_current=false로
// 들어가 analyses_current 부분 유니크(scan_id당 is_current=true 1개,
// 001_schema.sql:177)와 충돌하지 않고, 분석이 완료되면 워커의
// handle_analyze -> _finalize -> db.set_current_analysis가 기존 현재 분석을
// 해제하고 새 분석을 현재로 세운다(worker/flatworker/jobs.py) — 대시보드가
// 중복으로 처리할 필요가 없다.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import type { AnalysisStatus, Surface } from '@/lib/domain/types';

interface Props {
  scanId: string;
  userId: string;
  surface: Surface;
  criteriaId: string;
  /** 가장 최근 분석의 상태 — queued/processing이면 중복 실행을 막는다. */
  latestStatus: AnalysisStatus;
}

export function ReanalyzeButton({ scanId, userId, surface, criteriaId, latestStatus }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inProgress = latestStatus === 'queued' || latestStatus === 'processing';

  async function onClick() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // 1) 새 분석 행 생성(직전 분석과 동일 표면·기준 재사용)
    const { data: analysis, error: insErr } = await supabase.from('analyses').insert({
      scan_id: scanId, surface, criteria_id: criteriaId, status: 'queued', created_by: userId,
    }).select('id').single();
    if (insErr || !analysis) {
      setBusy(false);
      setError(insErr?.message ?? '분석 등록 실패');
      return;
    }
    // 2) 분석 잡 등록(중복 엔큐 409는 기존 isDuplicateJobError 안내 재사용)
    const r = await enqueueJob(supabase, 'analyze', { analysis_id: analysis.id });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={onClick} disabled={busy || inProgress}
        title={inProgress ? '이미 진행 중인 분석이 끝난 뒤 다시 시도하세요.' : undefined}
        className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
        {busy ? '요청 중...' : '다시 분석'}
      </button>
      {inProgress && (
        <p className="text-xs text-slate-500">진행 중인 분석이 끝난 뒤 다시 시도하세요.</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

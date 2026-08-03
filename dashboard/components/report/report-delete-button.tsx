// 보고서 삭제(소프트). 스펙 2026-08-02-slope-analysis-design.md §7.6
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { deleteConfirmText } from '@/lib/domain/reports';
import type { ReportStatus } from '@/lib/domain/types';

export function ReportDeleteButton({ report, redirectTo }: {
  report: { id: string; status: ReportStatus };
  // 상세 화면처럼 삭제 후 그 자리에 머물 수 없을 때 이동할 곳. 목록 화면은
  // 이동할 곳이 없으므로 넘기지 않는다(그 자리에서 다시 그린다).
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    // 하드 삭제가 아니라 deleted_at을 채운다. 발행본도 지울 수 있다 - 004의
    // finalized 트리거는 내용 컬럼만 잠그고 deleted_at은 열어 뒀다(006 주석 참고).
    const { error: updateError } = await createClient()
      .from('reports').update({ deleted_at: new Date().toISOString() }).eq('id', report.id);
    if (updateError) {
      setBusy(false);
      setError(updateError.message);
      return;
    }
    if (redirectTo) {
      // push만 한다. 뒤에 router.refresh()를 붙이면 refresh가 "현재 라우트"를 다시
      // 렌더하면서 진행 중이던 이동을 취소한다(커밋 112bed2에서 실제로 재현된 결함).
      router.push(redirectTo);
      return;
    }
    router.refresh();
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
        삭제
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded border border-red-300 bg-red-50 p-3">
      <p className="text-sm text-red-800">{deleteConfirmText(report)}</p>
      <div className="flex gap-2">
        <button type="button" onClick={remove} disabled={busy}
          className="rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          삭제 확인
        </button>
        <button type="button" onClick={() => { setConfirming(false); setError(null); }} disabled={busy}
          className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">
          취소
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

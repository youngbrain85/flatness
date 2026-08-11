// 발행(finalize)·재생성·다운로드 (스펙 §7.6)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { dataUrl } from '@/lib/domain/paths';
import { canFinalize, canRegenerate } from '@/lib/domain/reports';
import type { ReportGenStatus, ReportStatus } from '@/lib/domain/types';

export function ReportActions({ report }: {
  report: {
    id: string; status: ReportStatus; gen_status: ReportGenStatus; pdf_path: string | null;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function finalize() {
    setBusy(true);
    setError(null);
    const { error: updateError } = await createClient()
      .from('reports').update({ status: 'finalized' }).eq('id', report.id);
    setBusy(false);
    if (updateError) {
      // 004 트리거 거부(errcode 42501)는 PostgREST가 403 + 한국어 사유로 내려준다
      setError(updateError.message);
      return;
    }
    setMessage('보고서를 발행했습니다.');
    router.refresh();
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    // gen_status는 잡 기계장치(fn_job_claim/fn_job_fail)가 소유한다 - 클라이언트는
    // 잡만 등록하고 상태는 Realtime 구독으로 따라간다
    const enqueued = await enqueueJob(createClient(), 'report', { report_id: report.id });
    setBusy(false);
    if (!enqueued.ok) {
      setError(enqueued.message);
      return;
    }
    setMessage('PDF 재생성을 요청했습니다. 진행 상태는 자동으로 갱신됩니다.');
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {report.pdf_path && (
          <a href={dataUrl(report.pdf_path)} download
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
            PDF 다운로드
          </a>
        )}
        {canRegenerate(report) && (
          <button type="button" onClick={regenerate} disabled={busy}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            PDF 다시 생성
          </button>
        )}
        {canFinalize(report) && (
          // T2 팔레트(§3)는 주 버튼 색을 zinc-900 하나로 정한다 - 별도의 "성공"
          // 액센트(구 emerald-700)를 두지 않는다. 발행은 이 화면의 핵심 행동이라
          // 주 버튼 토큰을 그대로 쓴다.
          <button type="button" onClick={finalize} disabled={busy}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
            발행
          </button>
        )}
      </div>
      {report.status === 'finalized' && (
        <p className="text-xs text-zinc-600">
          발행된 보고서는 수정할 수 없습니다(내용 변경은 DB에서 차단됩니다). 내용을 바꾸려면 새 보고서를 만드세요.
        </p>
      )}
      {message && <p className="text-sm text-emerald-700">{message}</p>}
      {error && <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

// 발행(finalize)·재생성·다운로드 (스펙 §7.6)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button, buttonClass } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
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

  // 페이지 헤더의 액션 슬롯(우측)에 놓인다 - 버튼 줄 아래로 발행 안내·메시지·오류가 펼쳐지므로
  // 세로 컬럼을 우측 정렬한다. 아트보드 ReportDetail: PDF 다운로드 · PDF 다시 생성 · 발행(primary).
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {report.pdf_path && (
          <a href={dataUrl(report.pdf_path)} download className={buttonClass('normal')}>
            <Icon name="download" />PDF 다운로드
          </a>
        )}
        {canRegenerate(report) && (
          <Button onClick={regenerate} disabled={busy}>
            <Icon name="refresh" />PDF 다시 생성
          </Button>
        )}
        {canFinalize(report) && (
          // 뷰당 primary 1개(스펙 §4) - 발행은 이 화면의 핵심 행동이라 primary는 발행뿐이다.
          // 삭제·다운로드·재생성은 normal.
          <Button variant="primary" onClick={finalize} disabled={busy}>발행</Button>
        )}
      </div>
      {report.status === 'finalized' && (
        <p className="text-xs leading-4 text-cs-text-secondary">
          발행된 보고서는 수정할 수 없습니다(내용 변경은 DB에서 차단됩니다). 내용을 바꾸려면 새 보고서를 만드세요.
        </p>
      )}
      {/* 최종 리뷰 M3: 발행 성공은 판정이 아니라 시스템 메시지이므로 판정색을 쓰지 않는다 - 보조색 텍스트. */}
      {message && <p className="text-sm text-cs-text-secondary">{message}</p>}
      {error && <Alert type="error" className="max-w-lg">{error}</Alert>}
    </div>
  );
}

// PDF 생성 진행 상태 (Realtime + 5초 보조 폴링, 스펙 §3.2.⑤)
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRowStatus } from '@/lib/hooks/use-row-status';
import { REPORT_GEN_STATUS_LABEL } from '@/lib/domain/labels';
import type { ReportGenStatus } from '@/lib/domain/types';

export function ReportProgress({ reportId, initialStatus, genError }: {
  reportId: string;
  initialStatus: ReportGenStatus;
  genError: string | null;
}) {
  const router = useRouter();
  const status = useRowStatus<ReportGenStatus>('reports', reportId, initialStatus, 'gen_status');

  useEffect(() => {
    // 생성이 끝나면 서버 데이터(pdf_path·발행 버튼)를 다시 받아온다
    if (status !== initialStatus && (status === 'done' || status === 'failed')) router.refresh();
  }, [status, initialStatus, router]);

  if (status === 'done') return null;
  if (status === 'failed') {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
        <p className="font-medium text-red-700">PDF 생성에 실패했습니다.</p>
        {genError && <p className="mt-1 text-xs text-slate-700">사유: {genError}</p>}
        <p className="mt-1 text-xs text-slate-600">
          포함한 분석이 완료 상태인지, 워커가 실행 중인지 확인한 뒤 다시 생성하세요.
          3회 자동 재시도 후에도 실패한 상태입니다.
        </p>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-slate-600">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600" />
      {REPORT_GEN_STATUS_LABEL[status]}... (워커가 처리 중입니다. 이 화면은 자동 갱신됩니다)
    </p>
  );
}

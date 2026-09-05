// PDF 생성 진행 상태 (Realtime + 5초 보조 폴링, 스펙 §3.2.⑤)
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { useRowStatus } from '@/lib/hooks/use-row-status';
import { REPORT_GEN_STATUS_LABEL } from '@/lib/domain/labels';
import type { ReportGenStatus, ReportStatus } from '@/lib/domain/types';

export function ReportProgress({ reportId, initialStatus, genError, reportStatus }: {
  reportId: string;
  initialStatus: ReportGenStatus;
  genError: string | null;
  // 코드리뷰 Important(I2): 발행본(finalized)은 재생성이 불가능해 gen_status가
  // 갱신될 일이 없다 - 재생성 요청 후 워커 클레임 전에 발행하면 워커가 조기
  // 거부(handle_report의 finalized 재확인)로 gen_status='failed'가 남는데, 이
  // 잔여 정보를 발행본 화면에 그대로 보여주면 실패 박스가 영구 표시된다.
  reportStatus: ReportStatus;
}) {
  const router = useRouter();
  const status = useRowStatus<ReportGenStatus>('reports', reportId, initialStatus, 'gen_status');

  useEffect(() => {
    // 생성이 끝나면 서버 데이터(pdf_path·발행 버튼)를 다시 받아온다
    if (status !== initialStatus && (status === 'done' || status === 'failed')) router.refresh();
  }, [status, initialStatus, router]);

  // 발행본은 gen_status가 의미 없는 잔재 정보다 - 재생성 불가라 지울 방법도 없다
  if (reportStatus === 'finalized') return null;

  if (status === 'done') return null;
  if (status === 'failed') {
    return (
      <Alert type="error" title="PDF 생성에 실패했습니다.">
        {genError && <p>사유: {genError}</p>}
        <p className="text-xs leading-4 text-cs-text-secondary">
          포함한 분석이 완료 상태인지, 워커가 실행 중인지 확인한 뒤 다시 생성하세요.
          3회 자동 재시도 후에도 실패한 상태입니다.
        </p>
      </Alert>
    );
  }
  return (
    <StatusIndicator type="in-progress">
      {REPORT_GEN_STATUS_LABEL[status]}... (워커가 처리 중입니다. 이 화면은 자동 갱신됩니다)
    </StatusIndicator>
  );
}

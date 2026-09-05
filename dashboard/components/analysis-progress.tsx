// Realtime 진행 상태 (스펙 §3.2.⑤)
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useRowStatus } from '@/lib/hooks/use-row-status';
import { ANALYSIS_STATUS_LABEL } from '@/lib/domain/labels';
import type { AnalysisStatus } from '@/lib/domain/types';
import { LinkButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { StatusIndicator } from '@/components/ui/status-indicator';

export function AnalysisProgress({ analysisId, initialStatus, scanId }: {
  analysisId: string;
  initialStatus: AnalysisStatus;
  // D6: 결과 보기 링크가 이 스캔의 작업대(?analysis= 선택 렌더)로 바로 가도록 부모가
  // 이미 알고 있는 scanId를 받는다 - /analyses/[id]로 보내면 D6 리다이렉트가 한 홉
  // 더 거쳐 같은 곳으로 보내지만, 이 화면 자체를 그리는 부모(app/scans/[id]/page.tsx)가
  // scanId를 이미 갖고 있으니 그 홉을 건너뛴다.
  scanId: string;
}) {
  const router = useRouter();
  const status = useRowStatus('analyses', analysisId, initialStatus);

  useEffect(() => {
    if (status === 'done') router.refresh(); // 완료되면 서버 데이터(판정 배지 등) 갱신
  }, [status, router]);

  if (status === 'done') {
    // 아트보드(ScanDone): normal 알약 링크 + check-circle. 텍스트는 <a>의 직접 자식으로 둔다 -
    // analysis-progress.test.tsx가 getByText로 잡은 요소의 href를 본다.
    return (
      <div className="flex">
        <LinkButton href={`/scans/${scanId}?analysis=${analysisId}`} variant="normal">
          <Icon name="check-circle" />
          분석 완료 - 결과 보기
        </LinkButton>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="flex flex-col gap-1">
        <StatusIndicator type="error">분석에 실패했습니다.</StatusIndicator>
        <p className="text-xs leading-4 text-cs-text-secondary">
          지원 포맷(ply/las/laz/xyz/txt/csv/pts)·인코딩·단위 설정을 확인하세요. 상세 원인은
          워커 실행 창의 로그에 남습니다. 3회 자동 재시도 후에도 실패한 상태입니다.
        </p>
      </div>
    );
  }
  return (
    <StatusIndicator type="in-progress">
      {ANALYSIS_STATUS_LABEL[status]}... (워커가 처리 중입니다. 이 화면은 자동 갱신됩니다)
    </StatusIndicator>
  );
}

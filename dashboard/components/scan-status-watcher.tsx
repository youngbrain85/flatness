// 스캔 상태 Realtime 감시(리뷰 Important 2): useRowStatus('scans', ...)는 이미
// 구현돼 있었으나 어떤 화면도 실제로 연결하지 않아, 업로드 후 워커가 사전 검사를
// 끝내도 사용자가 수동 새로고침 전까지 "단위 확인" 버튼을 보지 못했다.
// analysis-progress.tsx와 동일 패턴 - 화면은 그리지 않고, 상태가 처음 상태와
// 달라지면 router.refresh()로 서버 데이터를 다시 읽어온다.
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRowStatus } from '@/lib/hooks/use-row-status';
import type { ScanStatus } from '@/lib/domain/types';

export function ScanStatusWatcher({ scanId, initialStatus }: {
  scanId: string;
  initialStatus: ScanStatus;
}) {
  const router = useRouter();
  const status = useRowStatus('scans', scanId, initialStatus);

  useEffect(() => {
    if (status !== initialStatus) router.refresh();
  }, [status, initialStatus, router]);

  return null;
}

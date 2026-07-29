// Realtime 진행 상태 (스펙 §3.2.⑤)
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useRowStatus } from '@/lib/hooks/use-row-status';
import { ANALYSIS_STATUS_LABEL } from '@/lib/domain/labels';
import type { AnalysisStatus } from '@/lib/domain/types';

export function AnalysisProgress({ analysisId, initialStatus }: {
  analysisId: string;
  initialStatus: AnalysisStatus;
}) {
  const router = useRouter();
  const status = useRowStatus('analyses', analysisId, initialStatus);

  useEffect(() => {
    if (status === 'done') router.refresh(); // 완료되면 서버 데이터(판정 배지 등) 갱신
  }, [status, router]);

  if (status === 'done') {
    return (
      <Link href={`/analyses/${analysisId}`}
        className="inline-block rounded bg-emerald-700 px-3 py-1.5 text-sm text-white">
        분석 완료 - 결과 보기
      </Link>
    );
  }
  if (status === 'failed') {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
        <p className="font-medium text-red-700">분석에 실패했습니다.</p>
        <p className="mt-1 text-xs text-slate-600">
          지원 포맷(ply/las/laz/xyz/txt/csv/pts)·인코딩·단위 설정을 확인하세요. 상세 원인은
          워커 실행 창의 로그에 남습니다. 3회 자동 재시도 후에도 실패한 상태입니다.
        </p>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-slate-600">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600" />
      {ANALYSIS_STATUS_LABEL[status]}... (워커가 처리 중입니다. 이 화면은 자동 갱신됩니다)
    </p>
  );
}

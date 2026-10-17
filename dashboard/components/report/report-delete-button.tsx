// 보고서 삭제(소프트). 스펙 2026-08-02-slope-analysis-design.md §7.6
// 다크 리스킨(Task 10, 아트보드 ReportDetail): '삭제'는 위험 버튼이고 누를 때마다 확인 상자를 여닫는다
// (aria-expanded). 확인 상자는 프래그먼트의 둘째 형제로 돌려준다 - 호출부의 flex-wrap 줄 안에서
// order-last + basis-full로 버튼 줄 아래 한 줄을 통째로 차지하고 오른쪽에 붙는다(최대 520px).
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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

  return (
    <>
      <Button variant="danger" aria-expanded={confirming}
        onClick={() => { setConfirming((open) => !open); setError(null); }}>
        삭제
      </Button>
      {confirming && (
        // 확인 단계: error 상자 안에 문구 + 삭제 확인(위험)/취소(보조). 화면의 주 버튼은 발행 하나뿐이다.
        <div className="order-last flex basis-full justify-end">
          <Alert type="error" className="w-full max-w-[520px]">
            <p className="text-ink">{deleteConfirmText(report)}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button variant="danger" onClick={remove} disabled={busy}>삭제 확인</Button>
              <Button onClick={() => { setConfirming(false); setError(null); }} disabled={busy}>취소</Button>
            </div>
            {error && <p className="mt-2 text-err">{error}</p>}
          </Alert>
        </div>
      )}
    </>
  );
}

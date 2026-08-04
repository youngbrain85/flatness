// 재판정 진행 상태 폴링 (브리프 D5, 스펙 §7.3)
//
// useRowStatus를 재사용하지 않는 이유: 그 훅(:42)은 종결 상태(done/failed)를
// 감지하면 그 자리에서 clearInterval해 폴링을 영구히 멈춘다. scans·analyses의
// status 컬럼은 한 번 종결되면 되돌아가지 않으므로 맞는 동작이지만, 여기서 읽는
// analyses.params.judge.state는 사용자가 배수구를 다시 클릭할 때마다
// done/failed -> queued로 되돌아가는 순환 상태다(reports.gen_status와 같은
// 사정 - use-row-status.ts:36-43 주석이 reports를 정지 대상에서 제외한 이유와
// 동일하다). 게다가 analyses.status 자체는 재판정으로 절대 바뀌지 않으므로
// (설계 결정 D5) useRowStatus로는 애초에 진행 상태를 읽을 컬럼이 없다 - judge는
// 별도 컬럼이 아니라 params(jsonb)의 하위 키라 같은 훅 시그니처에 끼워 넣기도
// 어렵다. 그래서 이 전용 훅이 매 틱마다 params를 읽고, 종결 상태에서도 절대
// 멈추지 않는다.
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { JudgeInfo } from '@/lib/domain/types';

export function useJudgeStatus(analysisId: string, initial: JudgeInfo | null): JudgeInfo | null {
  const [judge, setJudge] = useState<JudgeInfo | null>(initial);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`analyses-judge-${analysisId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'analyses', filter: `id=eq.${analysisId}` },
        (payload) => {
          const params = (payload.new as { params?: { judge?: JudgeInfo } } | null)?.params;
          if (params?.judge) setJudge(params.judge);
        },
      )
      .subscribe();
    const timer = setInterval(async () => {
      const { data } = await supabase.from('analyses').select('params').eq('id', analysisId).maybeSingle();
      const params = (data as { params?: { judge?: JudgeInfo } } | null)?.params;
      if (params?.judge) setJudge(params.judge);
      // 여기서 clearInterval하지 않는다 - judge.state는 순환 상태이므로 done/failed에
      // 도달해도 폴링을 계속해야 다음 재판정의 진행 상태를 볼 수 있다.
    }, 5000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [analysisId]);

  return judge;
}

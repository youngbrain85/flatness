// 진행 상태 추적 (P2 확정: jobs 불가시,
// analyses.status/scans.status/reports.gen_status를 Realtime 구독. 구독 유실 대비 5초 보조 폴링 병행)
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// 저비용 개선 m2: 종결 상태에 도달한 뒤에도 5초 폴링이 계속되면 Supabase Free
// 요청 한도를 무의미하게 소진한다 - scans(ready/archived/failed)·analyses(done/failed)·
// reports(done/failed) 종결 상태를 합쳐 감지되는 즉시 폴링 타이머를 멈춘다.
const TERMINAL_STATUSES = new Set(['ready', 'archived', 'failed', 'done']);

// 종결 상태가 되돌아갈 수 있는 테이블 - 여기서는 폴링을 멈추면 안 된다.
// - reports: 재생성이 done/failed -> queued로 되돌린다(저비용 개선 m1).
// - registrations: 사용자가 대응점을 다시 찍으면 done/failed -> awaiting_points로
//   되돌아간다(단계 F). useEffect 의존성이 [table,id,column]이라 컴포넌트가
//   재마운트되지 않는 한 타이머는 재무장되지 않는다 - 한번 멈추면 그 뒤의 정합
//   진행 상태를 영영 못 본다.
const CYCLIC_TABLES = new Set(['reports', 'registrations']);

export function useRowStatus<T extends string>(
  table: 'scans' | 'analyses' | 'reports' | 'registrations',
  id: string,
  initial: T,
  // reports는 업무 상태(status)와 생성 상태(gen_status)가 분리돼 있어 컬럼을 지정받는다
  column: 'status' | 'gen_status' = 'status',
): T {
  const [status, setStatus] = useState<T>(initial);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`${table}-${column}-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${id}` },
        (payload) => setStatus((payload.new as Record<string, T>)[column]),
      )
      .subscribe();
    const timer = setInterval(async () => {
      const { data } = await supabase.from(table).select(column).eq('id', id).maybeSingle();
      if (data) {
        const next = (data as Record<string, string>)[column];
        setStatus(next as T);
        // scans·analyses는 종결 상태에서 되돌아가지 않으므로 정지하고,
        // 되돌아갈 수 있는 테이블(CYCLIC_TABLES)만 정지 대상에서 제외한다.
        if (!CYCLIC_TABLES.has(table) && TERMINAL_STATUSES.has(next)) clearInterval(timer);
      }
    }, 5000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [table, id, column]);

  return status;
}

// 진행 상태 추적 (P2 확정: jobs 불가시,
// analyses.status/scans.status/reports.gen_status를 Realtime 구독. 구독 유실 대비 5초 보조 폴링 병행)
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// 저비용 개선 m2: 종결 상태에 도달한 뒤에도 5초 폴링이 계속되면 Supabase Free
// 요청 한도를 무의미하게 소진한다 - scans(ready/archived/failed)·analyses(done/failed)·
// reports(done/failed) 종결 상태를 합쳐 감지되는 즉시 폴링 타이머를 멈춘다.
const TERMINAL_STATUSES = new Set(['ready', 'archived', 'failed', 'done']);

export function useRowStatus<T extends string>(
  table: 'scans' | 'analyses' | 'reports',
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
        // 저비용 개선 m1: reports는 재생성이 종결 상태(done/failed)를 다시
        // 비종결(queued/processing)로 되돌릴 수 있는데, useEffect 의존성이
        // [table,id,column]이라 컴포넌트가 재마운트되지 않는 한 이 타이머는
        // 재무장되지 않는다 - 한번 멈추면 보조 폴링이 영구 정지한다. scans·
        // analyses는 종결 상태에서 되돌아가지 않으므로 기존처럼 정지하고,
        // reports만 정지 대상에서 제외한다.
        if (table !== 'reports' && TERMINAL_STATUSES.has(next)) clearInterval(timer);
      }
    }, 5000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [table, id, column]);

  return status;
}

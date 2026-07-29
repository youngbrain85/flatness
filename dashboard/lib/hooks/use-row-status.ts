// 진행 상태 추적 (P2 확정: jobs 불가시,
// analyses.status/scans.status를 Realtime 구독. 구독 유실 대비 5초 보조 폴링 병행)
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useRowStatus<T extends string>(
  table: 'scans' | 'analyses',
  id: string,
  initial: T,
): T {
  const [status, setStatus] = useState<T>(initial);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`${table}-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${id}` },
        (payload) => setStatus((payload.new as { status: T }).status),
      )
      .subscribe();
    const timer = setInterval(async () => {
      const { data } = await supabase.from(table).select('status').eq('id', id).maybeSingle();
      if (data) setStatus(data.status as T);
    }, 5000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [table, id]);

  return status;
}

// 잡 등록은 fn_enqueue_job RPC로만 (jobs 테이블 직접 접근 금지)
import type { SupabaseClient } from '@supabase/supabase-js';

export type JobType = 'precheck' | 'analyze' | 'import' | 'report';

// jobs_dedup 부분 유니크 위반은 PostgREST가 409 + Postgres 코드 23505로 돌려준다
export function isDuplicateJobError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

export const DUPLICATE_JOB_MESSAGE =
  '이미 같은 대상의 작업이 대기 중이거나 실행 중입니다. 잠시 후 상태를 확인하세요.';

export async function enqueueJob(
  supabase: SupabaseClient,
  type: JobType,
  payload: Record<string, string>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('fn_enqueue_job', { p_type: type, p_payload: payload });
  if (!error) return { ok: true };
  if (isDuplicateJobError(error)) return { ok: false, message: DUPLICATE_JOB_MESSAGE };
  return { ok: false, message: `작업 등록에 실패했습니다: ${error.message}` };
}

// 잡 등록은 fn_enqueue_job RPC로만 (jobs 테이블 직접 접근 금지)
import type { SupabaseClient } from '@supabase/supabase-js';

// slope_judge(브리프 D4): 배수구 재판정. payload에 좌표를 실어야 하므로(경합
// 방지 - 잡 처리 시점에 params를 읽으면 그 사이 다른 클릭으로 값이 바뀔 수 있다)
// 아래 payload 타입을 문자열 전용에서 넓혔다.
// register(단계 F): 두 스캔 정합. payload는 {registration_id}이며, 012가 jobs_dedup을
// 재정의해 이 키까지 coalesce에 넣었으므로 중복 엔큐가 23505로 막힌다(설계 결정 F5).
// 011/012를 적용하지 않은 DB에서는 fn_enqueue_job이 enum 오류로 실패한다 - 그 실패는
// enqueueJob이 한국어 메시지로 화면에 올린다.
export type JobType = 'precheck' | 'analyze' | 'import' | 'report' | 'slope_judge' | 'register';

// jobs_dedup 부분 유니크 위반은 PostgREST가 409 + Postgres 코드 23505로 돌려준다
export function isDuplicateJobError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

export const DUPLICATE_JOB_MESSAGE =
  '이미 같은 대상의 작업이 대기 중이거나 실행 중입니다. 잠시 후 상태를 확인하세요.';

export async function enqueueJob(
  supabase: SupabaseClient,
  type: JobType,
  // p_payload는 jsonb(002_functions_seed.sql:101) - slope_judge는 drain_points
  // 같은 배열/객체 값을 실어야 해서 문자열 전용 Record보다 넓게 받는다.
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('fn_enqueue_job', { p_type: type, p_payload: payload });
  if (!error) return { ok: true };
  if (isDuplicateJobError(error)) return { ok: false, message: DUPLICATE_JOB_MESSAGE };
  return { ok: false, message: `작업 등록에 실패했습니다: ${error.message}` };
}

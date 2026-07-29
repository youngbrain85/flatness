import { describe, expect, it } from 'vitest';
import { DUPLICATE_JOB_MESSAGE, enqueueJob, isDuplicateJobError } from '../jobs';

describe('중복 엔큐 409 처리 (jobs_dedup 부분 유니크 -> PostgREST 23505)', () => {
  it('code 23505만 중복으로 판정한다', () => {
    expect(isDuplicateJobError({ code: '23505' })).toBe(true);
    expect(isDuplicateJobError({ code: '42501' })).toBe(false);
    expect(isDuplicateJobError(null)).toBe(false);
  });
  it('enqueueJob은 중복이면 안내 메시지를 돌려준다', async () => {
    const supabase = { rpc: async () => ({ error: { code: '23505', message: 'dup' } }) };
    const r = await enqueueJob(supabase as never, 'analyze', { analysis_id: 'a1' });
    expect(r).toEqual({ ok: false, message: DUPLICATE_JOB_MESSAGE });
  });
  it('성공이면 ok', async () => {
    const calls: unknown[] = [];
    const supabase = {
      rpc: async (fn: string, args: unknown) => { calls.push([fn, args]); return { error: null }; },
    };
    const r = await enqueueJob(supabase as never, 'precheck', { scan_id: 's1' });
    expect(r).toEqual({ ok: true });
    expect(calls[0]).toEqual(['fn_enqueue_job', { p_type: 'precheck', p_payload: { scan_id: 's1' } }]);
  });
});

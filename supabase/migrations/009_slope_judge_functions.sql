-- =============================================================================
-- 마이그레이션 009 - slope_judge 잡 큐 함수 확장 (세부과업 4 단계 D)
-- 선행: 008_slope_judge_enum.sql (job_type에 'slope_judge' 추가)
--
-- ⚠ 008을 먼저 Run 하지 않으면 이 파일이 'slope_judge' enum 라벨을 못 찾아
--    실패한다. 008과 009는 반드시 두 번 나눠 Run 한다 - 같은 트랜잭션에 넣으면
--    PostgreSQL이 새 enum 값의 사용을 "unsafe use of new value"로 막는다
--    (Supabase SQL Editor는 파일 전체를 한 트랜잭션으로 실행한다).
--
-- 재판정(slope_judge)은 설계안 §7.3의 잡이다: 이미 status='done'인 구배
-- 분석에 배수구 위치만 바꿔 판정만 다시 건다(점군 미열람, 가벼움). analyze·
-- import와 시맨틱이 근본적으로 다르므로 같은 분기에 합치지 않는다.
--
-- **analyses.status는 slope_judge 때문에 절대 건드리지 않는다.** 건드리면:
--   - fn_job_claim이 processing으로 바꿔 이미 성공해 있던 결과 화면이 사라지고
--   - fn_job_fail이 재시도 소진 시 failed로 바꿔 멀쩡한 구배 판정이 파괴된다
--     (복구하려면 무거운 analyze를 처음부터 다시 돌려야 한다)
-- 대신 재판정 진행 상태는 analyses.params.judge(jsonb)에 둔다(analyses는 RLS
-- all_auth라 대시보드가 읽을 수 있다 - jobs 테이블은 RLS 정책이 0개라 못 읽는다):
--   { "state": "queued|processing|done|failed", "at": "<iso>", "error": "<사유>" }
-- jsonb_set으로 'judge' 키만 갱신하고, 형제 키인 'drain_points'(배수구 좌표,
-- §3.5)는 절대 건드리지 않는다. 'done' 전이는 판정 성공 시 워커 핸들러가 직접
-- 쓴다(이 세 함수의 책임 밖 - 워커는 stats·coverage_pct·overall_verdict·
-- warnings와 함께 params.judge.state='done'을 한 번에 갱신한다).
--
-- ⚠ 004_report_support.sql:55-128(002·003이 아니라 004가 잡 큐 함수 3종의
-- 정본)의 본문을 그대로 복사한 뒤 slope_judge 분기만 추가했다. 002를 기준으로
-- 재정의하면 003·004가 넓힌 import·report 분기가 되돌아간다. 파라미터명
-- (p_worker/p_job_id/p_error/p_timeout_minutes)·반환 타입·security definer·
-- set search_path는 원본과 100% 동일하게 유지한다(파라미터명이 바뀌면 PostgREST
-- RPC 호출이 깨진다). create or replace는 기존 ACL을 보존하므로 grant 재발급과
-- notify pgrst도 불필요하다(007과 다르게 시그니처가 바뀌지 않는다).
--
-- 재실행 안전(멱등) - create or replace라 몇 번 다시 실행해도 동일한 정의로
-- 수렴한다.
-- =============================================================================

create or replace function fn_job_claim(p_worker text)
returns jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job jobs;
begin
  select * into v_job from jobs
   where status = 'queued' and run_after <= now()
   order by created_at
   for update skip locked
   limit 1;
  if v_job.id is null then return null; end if;
  update jobs set status = 'processing', locked_at = now(), locked_by = p_worker,
                  attempts = attempts + 1, started_at = coalesce(started_at, now())
   where id = v_job.id;
  if v_job.type in ('analyze', 'import') and (v_job.payload ? 'analysis_id') then
    update analyses set status = 'processing' where id = (v_job.payload->>'analysis_id')::uuid;
  elsif v_job.type = 'report' and (v_job.payload ? 'report_id') then
    update reports set gen_status = 'processing', gen_error = null
     where id = (v_job.payload->>'report_id')::uuid;
  elsif v_job.type = 'slope_judge' and (v_job.payload ? 'analysis_id') then
    -- analyses.status는 건드리지 않는다 - 이미 done인 결과 화면을 감추면 안 된다.
    update analyses set params = jsonb_set(params, '{judge}',
             jsonb_build_object('state', 'processing', 'at', to_jsonb(now())), true)
     where id = (v_job.payload->>'analysis_id')::uuid;
  end if;
  select * into v_job from jobs where id = v_job.id;
  return v_job;
end $$;

create or replace function fn_job_fail(p_job_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job jobs;
begin
  select * into v_job from jobs where id = p_job_id;
  if v_job.attempts >= v_job.max_attempts then
    update jobs set status = 'failed', error = p_error, finished_at = now(),
                    locked_at = null, locked_by = null where id = p_job_id;
    if v_job.type in ('analyze', 'import') and (v_job.payload ? 'analysis_id') then
      update analyses set status = 'failed' where id = (v_job.payload->>'analysis_id')::uuid;
    elsif v_job.type = 'precheck' and (v_job.payload ? 'scan_id') then
      update scans set status = 'failed' where id = (v_job.payload->>'scan_id')::uuid;
    elsif v_job.type = 'report' and (v_job.payload ? 'report_id') then
      update reports set gen_status = 'failed', gen_error = p_error
       where id = (v_job.payload->>'report_id')::uuid;
    elsif v_job.type = 'slope_judge' and (v_job.payload ? 'analysis_id') then
      -- 재시도 소진: analyses.status='done'은 그대로 두고 judge 채널만 failed로.
      update analyses set params = jsonb_set(params, '{judge}',
               jsonb_build_object('state', 'failed', 'at', to_jsonb(now()), 'error', p_error), true)
       where id = (v_job.payload->>'analysis_id')::uuid;
    end if;
  else
    update jobs set status = 'queued', error = p_error,
                    run_after = now() + (interval '10 seconds' * v_job.attempts),
                    locked_at = null, locked_by = null where id = p_job_id;
    if v_job.type in ('analyze', 'import') and (v_job.payload ? 'analysis_id') then
      update analyses set status = 'queued' where id = (v_job.payload->>'analysis_id')::uuid;
    elsif v_job.type = 'precheck' and (v_job.payload ? 'scan_id') then
      update scans set status = 'uploaded' where id = (v_job.payload->>'scan_id')::uuid;
    elsif v_job.type = 'report' and (v_job.payload ? 'report_id') then
      update reports set gen_status = 'queued', gen_error = p_error
       where id = (v_job.payload->>'report_id')::uuid;
    elsif v_job.type = 'slope_judge' and (v_job.payload ? 'analysis_id') then
      -- 재큐(재시도): judge.state만 queued로 되돌린다. analyses.status는 무관.
      update analyses set params = jsonb_set(params, '{judge}',
               jsonb_build_object('state', 'queued', 'at', to_jsonb(now()), 'error', p_error), true)
       where id = (v_job.payload->>'analysis_id')::uuid;
    end if;
  end if;
end $$;

create or replace function fn_reap_stuck_jobs(p_timeout_minutes int default 30)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  with reaped as (
    update jobs set status = 'queued', locked_at = null, locked_by = null,
                    run_after = now()
     where status = 'processing' and locked_at < now() - make_interval(mins => p_timeout_minutes)
     returning id, type, payload)
  select count(*) into v_count from reaped;
  update analyses a set status = 'queued'
   from jobs j
   where j.status = 'queued' and j.type in ('analyze', 'import')
     and (j.payload->>'analysis_id')::uuid = a.id and a.status = 'processing';
  update reports r set gen_status = 'queued'
   from jobs j
   where j.status = 'queued' and j.type = 'report'
     and (j.payload->>'report_id')::uuid = r.id and r.gen_status = 'processing';
  -- slope_judge: analyses.status는 항상 'done'이라 위 analyze/import 조건(a.status=
  -- 'processing')으로는 걸리지 않는다. 대신 judge 채널이 'processing'이던 행만
  -- 골라 queued로 되돌린다. analyses.status는 여기서도 건드리지 않는다.
  update analyses a set params = jsonb_set(a.params, '{judge}',
           jsonb_build_object('state', 'queued', 'at', to_jsonb(now())), true)
   from jobs j
   where j.status = 'queued' and j.type = 'slope_judge'
     and (j.payload->>'analysis_id')::uuid = a.id
     and (a.params->'judge'->>'state') = 'processing';
  return v_count;
end $$;

-- =============================================================================
-- 마이그레이션 009 - slope_judge 잡 큐 함수 확장 (세부과업 4 단계 D)
-- 선행: 008_slope_judge_enum.sql (job_type에 'slope_judge' 추가)
--
-- ⚠ 008과 009는 반드시 두 번 나눠 Run 한다 - 같은 트랜잭션에 넣으면 PostgreSQL이
--    새 enum 값의 사용을 "unsafe use of new value"로 막는다(Supabase SQL Editor는
--    파일 전체를 한 트랜잭션으로 실행한다).
--
-- **008 없이 이 파일만 Run 하면 "Success"가 뜬다 - 이것이 함정이다.** plpgsql
-- 함수 본문 안의 SQL은 CREATE 시점에는 파싱만 되고 *계획*은 첫 실행 시점에야
-- 이뤄지므로(`v_job.type = 'slope_judge'` 비교도 마찬가지), 파일 실행 자체는
-- 막히지 않는다. 문제는 나중이다 - 워커가 slope_judge 잡을 claim/reap 하려는
-- 순간(또는 fn_reap_stuck_jobs가 주기 실행될 때) "invalid input value for enum
-- job_type: slope_judge"로 **잡 큐 전체가 조용히 멎는다.** 이 저장소가 가장
-- 경계하는 실패 양식(조용한 실패)이므로, 아래 카탈로그 가드가 Run 시점에 즉시
-- 명확한 한국어 오류로 막는다(008이 이미 적용돼 있으면 이 가드는 아무 일도
-- 하지 않는다 - 재실행 안전).
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
-- **judge 자체도 전면 교체가 아니라 병합(||)이다.** Task 3(워커, D8)이
-- params.judge.previous_drain_points에 직전 배수구 좌표를 남겨 되돌리기용으로
-- 쓴다 - jsonb_build_object로 judge를 통째로 갈아치우면 다음 클레임 순간 이
-- 키가 사라져 D8이 만들려던 안전장치가 정확히 필요한 순간에 무력화된다. 그래서
-- 아래 네 분기 모두 `coalesce(params->'judge', '{}'::jsonb) || jsonb_build_object
-- (...)` 형태로 기존 judge 위에 이번 전이분만 덮어쓴다(클레임만 예외적으로
-- `- 'error'`로 이전 실패 메시지를 먼저 지운다 - 004의 gen_error=null 클레임
-- 관례와 동일한 의도).
--
-- 대시보드 계약(Task 5가 읽는다): error 키는 state='failed'일 때만 사용자에게
-- 노출한다. state='queued'일 때도 error가 함께 저장돼 있을 수 있으나(재큐 중인
-- 재시도의 직전 실패 사유 - 004의 gen_status='queued'+gen_error 관례와 동일),
-- 이는 최종 실패가 아니라 진행 중 상태이므로 화면에 실패로 보여주면 안 된다.
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

-- 카탈로그 가드: 008이 먼저 적용됐는지 확인한다. job_type 값을 *사용*(캐스팅·
-- 비교)하는 게 아니라 pg_enum 카탈로그에서 라벨 문자열(text)의 존재만 확인하는
-- 것이므로 "unsafe use of new value" 제약에 걸리지 않는다 - 그래도 이 파일은
-- 여전히 008과 별도로 Run 하는 것이 정본이다(D6, 위 경고 참고).
do $$ begin
  if not exists (select 1 from pg_enum
                  where enumtypid = 'job_type'::regtype and enumlabel = 'slope_judge') then
    raise exception '008_slope_judge_enum.sql을 먼저 실행하세요 (job_type enum에 slope_judge 값이 없습니다).';
  end if;
end $$;

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
    -- 병합(||)으로 previous_drain_points(Task 3, D8) 등 judge의 다른 키를
    -- 보존한다. 이전 실패 메시지(error)만 지운다.
    update analyses set params = jsonb_set(params, '{judge}',
             (coalesce(params->'judge', '{}'::jsonb) - 'error')
               || jsonb_build_object('state', 'processing', 'at', to_jsonb(now())), true)
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
      -- 병합(||)으로 previous_drain_points 등 judge의 다른 키를 보존한다.
      update analyses set params = jsonb_set(params, '{judge}',
               coalesce(params->'judge', '{}'::jsonb)
                 || jsonb_build_object('state', 'failed', 'at', to_jsonb(now()), 'error', p_error), true)
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
      -- error는 004의 gen_status='queued'+gen_error 관례를 따라 함께 남긴다(대시보드
      -- 계약: error는 state='failed'일 때만 사용자에게 노출한다). 병합(||)으로
      -- previous_drain_points 등 judge의 다른 키를 보존한다.
      update analyses set params = jsonb_set(params, '{judge}',
               coalesce(params->'judge', '{}'::jsonb)
                 || jsonb_build_object('state', 'queued', 'at', to_jsonb(now()), 'error', p_error), true)
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
  -- 골라 queued로 되돌린다. analyses.status는 여기서도 건드리지 않는다. 병합(||)
  -- 으로 previous_drain_points 등 judge의 다른 키를 보존한다.
  update analyses a set params = jsonb_set(a.params, '{judge}',
           coalesce(a.params->'judge', '{}'::jsonb)
             || jsonb_build_object('state', 'queued', 'at', to_jsonb(now())), true)
   from jobs j
   where j.status = 'queued' and j.type = 'slope_judge'
     and (j.payload->>'analysis_id')::uuid = a.id
     and (a.params->'judge'->>'state') = 'processing';
  return v_count;
end $$;

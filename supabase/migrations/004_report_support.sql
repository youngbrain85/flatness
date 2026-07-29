-- =============================================================================
-- 마이그레이션 004 - P4 보고서 지원
-- 선행: 001_schema.sql, 002_functions_seed.sql, 003_dashboard_support.sql
-- 내용:
--   (1) reports 생성 상태 채널: gen_status(report_gen_status) + gen_error
--       업무 상태인 reports.status(draft|finalized)와 잡 진행 상태를 분리한다
--       (한 컬럼에 두 의미를 섞으면 "생성 실패한 발행본" 같은 모순 상태가 생긴다).
--   (2) Realtime publication에 reports 추가 - 대시보드가 analyses·scans와 동일한
--       방식(useRowStatus)으로 PDF 생성 진행 상태를 구독한다 (스펙 §3.2.⑤).
--   (3) 잡 큐 함수 확장 재정의(003과 동일한 방식: 원본 복사 + 최소 수정)
--       - fn_job_claim/fn_job_fail: report 잡이 reports.gen_status를 전이
--       - fn_reap_stuck_jobs: 2단계 잡 타입을 analyze -> analyze·import로 넓히고
--         report 전용 단계를 추가 (P3 백로그 티켓 30 해소)
--   (4) finalized 보고서 불변 트리거 - 001_schema.sql이 "P4 마이그레이션으로
--       이연"이라고 명시한 항목 (스펙 §6.1 reports).
--
-- 멱등성: 003(m12)과 동일 원칙 - 재실행해도 실패하지 않도록 create type은 예외
-- 가드, add column은 if not exists, 트리거는 drop if exists 후 생성한다.
-- =============================================================================

-- (1) 생성 상태 채널 -----------------------------------------------------------
do $$ begin
  create type report_gen_status as enum ('queued', 'processing', 'done', 'failed');
exception when duplicate_object then null; end $$;

alter table reports add column if not exists gen_status report_gen_status not null default 'queued';
alter table reports add column if not exists gen_error text;

-- (2) Realtime publication (이미 추가된 경우 무시)
do $$ begin
  alter publication supabase_realtime add table public.reports;
exception when duplicate_object then null; end $$;

-- =============================================================================
-- (3) 잡 큐 함수 확장 재정의
--
-- 아래 세 함수는 각각 최신 정의(fn_job_claim·fn_job_fail은 003, fn_reap_stuck_jobs는
-- 002)의 본문을 그대로 복사한 뒤 다음만 최소 수정했다:
--   - fn_job_claim: report 잡(payload.report_id) 분기 추가 - 클레임 시
--     reports.gen_status='processing'으로 올리고 이전 실패 메시지(gen_error)를 지운다.
--   - fn_job_fail: 최종 실패 분기는 gen_status='failed'+gen_error 기록, 재큐(재시도)
--     분기는 gen_status='queued'+gen_error 기록(jobs.error와 동일 취급 - UI는
--     gen_status='failed'일 때만 사용자에게 노출한다).
--   - fn_reap_stuck_jobs: 2단계 조인 조건을 j.type='analyze'에서 in ('analyze',
--     'import')로 넓히고(티켓 30), report 잡용 3단계를 추가한다.
--
-- security definer·set search_path·반환 타입·파라미터명(p_worker/p_job_id/p_error/
-- p_timeout_minutes)은 원본과 100% 동일하게 유지한다(파라미터명이 바뀌면 PostgREST
-- RPC 호출이 깨진다). create or replace는 002에서 부여한 ACL을 보존하므로 grant를
-- 다시 실행할 필요가 없다.
--
-- 워커 tests/fake_db.py의 FakeDB도 이 시맨틱과 정확히 일치하도록 동기화했다.
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
  return v_count;
end $$;

-- =============================================================================
-- (4) finalized 보고서 불변 트리거
--
-- 잠그는 컬럼: status·title·location_id·opinion_text·snapshot·pdf_path (발행본의
-- 내용 전부). 잠그지 않는 컬럼: gen_status·gen_error.
-- gen_status를 잠그면, 발행된 보고서에 대해 실수로 등록된 report 잡을
-- fn_job_claim이 클레임하는 순간 이 트리거가 예외를 던져 클레임 트랜잭션 전체가
-- 롤백되고 워커가 어떤 잡도 클레임하지 못하는 상태가 된다. 잡 기계장치가 만지는
-- 컬럼은 열어 두고, 내용 컬럼만 잠근다 - 재생성 잡이 돌더라도 결과 저장(snapshot·
-- pdf_path update)에서 막혀 실패로 끝나며, 워커 handle_report도 finalized 보고서를
-- 조기 거부한다(2중 방어).
--
-- 발행 조건 검증도 함께 둔다: PDF·snapshot이 없는 보고서는 발행할 수 없다.
-- errcode 42501(insufficient_privilege)은 PostgREST가 403으로 매핑하고 message를
-- 그대로 내려주므로 대시보드가 사용자에게 사유를 보여줄 수 있다.
-- =============================================================================

create or replace function fn_reports_finalized_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if old.status = 'finalized' then
    if new.status is distinct from old.status
       or new.title is distinct from old.title
       or new.location_id is distinct from old.location_id
       or new.opinion_text is distinct from old.opinion_text
       or new.snapshot is distinct from old.snapshot
       or new.pdf_path is distinct from old.pdf_path then
      raise exception '발행된 보고서는 수정할 수 없습니다 (report_id=%)', old.id
        using errcode = '42501';
    end if;
  elsif new.status = 'finalized' then
    if new.pdf_path is null or new.snapshot is null then
      raise exception 'PDF가 생성되지 않은 보고서는 발행할 수 없습니다 (report_id=%)', old.id
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_reports_finalized_guard on reports;
create trigger trg_reports_finalized_guard before update on reports
  for each row execute function fn_reports_finalized_guard();

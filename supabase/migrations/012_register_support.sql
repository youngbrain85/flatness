-- =============================================================================
-- 마이그레이션 012 - register 잡 지원 (세부과업 4 단계 F: 두 스캔 정합·병합)
-- 선행: 007_slope_analysis.sql(registrations 테이블), 008_slope_judge_enum.sql
--       (job_type에 'slope_judge' - 아래 (1) 세 번째 가드 참고),
--       011_register_enums.sql(job_type에 'register', data_lineage에 'registered')
--       009는 건너뛰어도 된다 - 012가 009의 함수 정의를 상위집합으로 포함한다.
--
-- ⚠ 011과 012는 반드시 두 번 나눠 Run 한다 - 같은 트랜잭션에 넣으면 PostgreSQL이
--    새 enum 값의 사용을 "unsafe use of new value"로 막는다(Supabase SQL Editor는
--    파일 전체를 한 트랜잭션으로 실행한다). 008/009 선례와 같은 이유다.
--
-- **011 없이 이 파일만 Run 하면 "Success"가 뜬다 - 이것이 함정이다.** plpgsql
-- 함수 본문 안의 SQL은 CREATE 시점에는 파싱만 되고 *계획*은 첫 실행 시점에야
-- 이뤄지므로(`v_job.type = 'register'` 비교도 마찬가지), 파일 실행 자체는 막히지
-- 않는다. 문제는 나중이다 - 워커가 register 잡을 claim/reap 하려는 순간
-- "invalid input value for enum job_type: register"로 **잡 큐 전체가 조용히
-- 멎는다**(register뿐 아니라 precheck·analyze·import·report·slope_judge까지 전부
-- 멈춘다 - fn_job_claim은 타입을 가리지 않고 한 함수로 모든 잡을 클레임한다).
-- 이 저장소가 가장 경계하는 실패 양식(조용한 실패)이므로, 아래 카탈로그 가드가
-- Run 시점에 즉시 명확한 한국어 오류로 막는다(011이 이미 적용돼 있으면 이 가드는
-- 아무 일도 하지 않는다 - 재실행 안전).
--
-- 내용:
--   (1) 카탈로그 가드 4종 - 011의 enum 값 두 개 + 008의 slope_judge + 007의
--       registrations 테이블
--   (2) registrations 테이블 보완 - 007이 만든 테이블에 단계 F가 쓰는 컬럼 추가
--   (3) Realtime publication에 registrations 추가
--   (4) jobs_dedup 재정의 - register 중복 엔큐 차단 (설계 결정 F5)
--   (5) 잡 큐 함수 3종 확장 재정의 - register 분기 추가
--
-- 재실행 안전(멱등) - 가드는 존재 확인만 하고, 컬럼 추가는 if not exists,
-- 인덱스는 drop 후 재생성, 함수는 create or replace다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) 카탈로그 가드
--
-- job_type/data_lineage 값을 *사용*(캐스팅·비교)하는 게 아니라 pg_enum 카탈로그에서
-- 라벨 문자열(text)의 존재만 확인하는 것이므로 "unsafe use of new value" 제약에
-- 걸리지 않는다 - 그래도 이 파일은 여전히 011과 별도로 Run 하는 것이 정본이다.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'job_type' and e.enumlabel = 'register') then
    raise exception '011_register_enums.sql을 먼저 실행하세요 (job_type에 register 값이 없습니다).';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'data_lineage' and e.enumlabel = 'registered') then
    raise exception '011_register_enums.sql을 먼저 실행하세요 (data_lineage에 registered 값이 없습니다).';
  end if;
  -- ★ 008도 전제한다. 아래 (5)의 함수 3종은 009의 본문을 그대로 물려받으므로
  --    `v_job.type = 'slope_judge'` 비교를 계속 포함한다. 그런데 docs/DEPLOY.md·
  --    docs/SUPABASE_SETUP.md는 008·009를 **선택 단계**로 안내한다 - 재판정을 쓰지
  --    않는 프로젝트가 008을 건너뛴 채 011·012만 적용하는 경로가 실제로 열려 있다.
  --    그 상태로 두면 이 파일은 "Success"로 끝나고, 나중에 워커가 **아무 잡이나**
  --    claim 하는 순간 "invalid input value for enum job_type: slope_judge"로 잡 큐
  --    전체가 멎는다(register 잡뿐 아니라 precheck·analyze·import·report까지 전부).
  --    008은 `add value if not exists` 한 줄이라 재판정을 안 쓰더라도 적용 비용이
  --    사실상 없다. 009는 012가 상위집합이므로 건너뛰어도 된다.
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'job_type' and e.enumlabel = 'slope_judge') then
    raise exception '008_slope_judge_enum.sql을 먼저 실행하세요 (job_type에 slope_judge 값이 없습니다 - 012의 잡 큐 함수는 009의 slope_judge 분기를 그대로 포함합니다).';
  end if;
end $$;

-- registrations 테이블은 **007이 이미 만들었다**(007_slope_analysis.sql:81-93,
-- "정합 이력 - 단계 F에서 사용, 스키마만 먼저 세운다"). 아래 (2)가 alter로 컬럼만
-- 더하므로, 007을 건너뛴 DB에서는 alter가 "relation does not exist"라는 영문
-- 오류로 죽는다 - 무엇을 해야 하는지 알려주지 않는 오류다. 위 두 가드와 같은
-- 이유로 여기서도 한국어로 먼저 막는다.
do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'registrations') then
    raise exception '007_slope_analysis.sql을 먼저 실행하세요 (registrations 테이블이 없습니다).';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- (2) registrations 테이블 보완
--
-- ★ **create table if not exists로 쓰지 않은 이유** - 007이 이 테이블을 이미
--    만들어 두었기 때문이다. 007의 정의에는 단계 F가 쓰는 overlap_ratio·
--    updated_at이 없는데, `create table if not exists`는 테이블이 있으면
--    **본문을 통째로 무시하고 성공한다**. 즉 두 컬럼이 조용히 빠진 채
--    "Success"가 뜨고, 나중에 워커가 정합 결과를 PATCH하는 순간
--    42703(undefined_column)으로 register 잡이 전부 실패한다(010을 워커보다
--    늦게 적용했을 때와 같은 실패 양식 - docs/DEPLOY.md §1 참고). 그래서
--    add column if not exists로 **차이만** 메운다.
--
-- ★ status는 007의 registration_status enum을 그대로 쓴다(text로 바꾸지 않는다).
--    007이 만든 값 집합이 단계 F가 쓰는 다섯 상태와 정확히 일치한다:
--    awaiting_points(화면이 대응점을 받는 중) / queued / processing / done / failed.
--    text로 내리면 오타 상태값을 DB가 더 이상 막아 주지 않는다 - 잡 큐 함수가
--    쓰는 'processing'·'failed'·'queued'가 전부 이 enum 라벨이므로, enum을
--    유지하는 편이 조용한 실패를 하나 더 막는다.
--
-- source_scan_ids는 007 주석대로 배열이라 FK를 걸 수 없다(원본 스캔이 지워지면
-- 죽은 id가 남는 것을 이력 테이블로서 의도적으로 허용한다).
-- -----------------------------------------------------------------------------

-- 중첩 비율(0~1). 설계 결정 F: 중첩 10% 미만이면 정합을 실패로 끝낸다 - 그 판단
-- 근거를 화면이 보여줄 수 있어야 하므로 rmse_mm과 함께 남긴다.
alter table registrations add column if not exists overlap_ratio double precision;

-- 마지막 상태 전이 시각. 001의 다른 테이블들과 같은 관례로 트리거는 두지 않고
-- 쓰는 쪽이 채운다 - 아래 (5)의 잡 큐 함수 3종이 status를 바꿀 때마다 함께 갱신한다.
alter table registrations add column if not exists updated_at timestamptz not null default now();

-- 대응점 기본값. 007은 not null + jsonb_typeof='array' 체크만 두어 화면이 행을
-- 만들 때(status='awaiting_points', 아직 찍은 점이 없다) 매번 '[]'를 명시해야
-- 했다. 기본값을 두면 빠뜨려도 체크 제약에 걸려 죽지 않는다. 기존 행의 값은
-- 바뀌지 않는다(set default는 이후 INSERT에만 적용된다).
alter table registrations alter column correspondences set default '[]'::jsonb;

-- RLS는 007이 이미 세웠다(007:98-100, enable row level security + `all_auth` 정책).
-- 여기서 다시 만들지 않는다 - 위 (1)의 registrations 테이블 존재 가드가 007 적용을
-- 이미 보증하므로, 중복 정책을 하나 더 만들면 이름만 다른 같은 규칙이 두 벌
-- 남는다(RLS 정책은 OR로 합쳐지므로 동작은 같고 혼란만 는다).

-- -----------------------------------------------------------------------------
-- (3) Realtime publication (이미 추가된 경우 무시 - 003·004와 같은 관례)
--
-- 진행 상태를 담는 테이블은 scans·analyses·reports 3종이 모두 publication에
-- 들어가 있다(003:31·35, 004:31). registrations도 같은 성격이다 - jobs 테이블은
-- RLS 정책이 0개라 대시보드가 못 읽으므로(설계 결정 F10) 정합 진행 상태를 볼 수
-- 있는 곳은 이 테이블뿐이다. 빠뜨려도 useRowStatus의 5초 보조 폴링이 덮어 주지만
-- (lib/hooks/use-row-status.ts), 형제 3종과 다르게 두면 나중에 "왜 정합만 갱신이
-- 느린가"를 다시 조사하게 된다.
-- -----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.registrations;
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- (4) jobs_dedup 재정의 (설계 결정 F5) ★ 조용한 실패
--
-- 001_schema.sql:247의 현재 정의는 analysis_id·scan_id·report_id 세 키만 본다.
-- register 잡 payload에는 registration_id만 있어 세 키가 전부 없으므로 coalesce가
-- NULL을 낸다. **유니크 인덱스에서 NULL은 서로 구별되므로 중복 엔큐가 전부
-- 통과한다** - 사용자가 "정합 실행"을 두 번 누르면 무거운 잡이 두 개 돈다.
-- 오류도 경고도 없다(조용한 실패). 그래서 registration_id를 coalesce에 더한다.
--
-- **기존 네 타입(precheck·analyze·import·report)의 동작은 바뀌지 않는다.**
-- coalesce는 인자를 왼쪽부터 훑어 첫 non-null을 돌려주는데, 새 인자를 **맨 뒤에**
-- 붙였으므로 앞 세 키 중 하나라도 있는 행은 예전과 같은 값을 낸다. 앞 세 키가
-- 전부 없는 행은 register 잡뿐이고(precheck는 scan_id, analyze·import는
-- analysis_id, report는 report_id, slope_judge는 analysis_id를 반드시 싣는다),
-- registration_id를 싣는 다른 타입은 존재하지 않는다. 즉 register가 아닌 모든
-- 행에서 인덱스 표현식의 값이 문자 그대로 동일하다 - 그래서 재생성이 기존
-- queued/processing 행 때문에 유니크 위반으로 실패하는 일도 없다.
--
-- 인덱스 이름을 그대로 유지하는 것도 계약이다: 대시보드가 23505 충돌을 "이미 같은
-- 대상의 작업이 대기 중이거나 실행 중입니다"로 번역하고(lib/domain/jobs.ts),
-- 워커 db.py:90·runner.py:61 주석이 이 이름을 참조한다.
-- -----------------------------------------------------------------------------
drop index if exists jobs_dedup;
create unique index jobs_dedup on jobs(type, (coalesce(
  payload->>'analysis_id', payload->>'scan_id', payload->>'report_id', payload->>'registration_id')))
  where status in ('queued', 'processing');

-- -----------------------------------------------------------------------------
-- (5) 잡 큐 함수 3종 확장 재정의
--
-- ⚠ 009_slope_judge_functions.sql(004가 아니라 **009**가 이 세 함수의 최신 정본이다)
-- 의 본문을 그대로 복사한 뒤 register 분기만 더했다. 002/003/004를 기준으로
-- 재정의하면 003·004가 넓힌 import·precheck·report 분기와 009가 더한 slope_judge
-- 분기가 조용히 사라진다. 009가 `judge`를 통째로 갈아치워 previous_drain_points를
-- 지웠던 사고도 같은 계열이다 - **전면 교체가 아니라 최소 확장이다.**
-- 파라미터명(p_worker/p_job_id/p_error/p_timeout_minutes)·반환 타입·security
-- definer·set search_path는 원본과 100% 동일하게 유지한다(파라미터명이 바뀌면
-- PostgREST RPC 호출이 깨진다). create or replace는 기존 ACL을 보존하므로 grant
-- 재발급도 불필요하다(시그니처가 바뀌지 않는다).
--
-- register 분기가 하는 일은 report 분기와 같은 모양이다 - 자기 테이블에 자기
-- 상태 컬럼(registrations.status)과 오류 컬럼(error_text)이 있으므로
-- analyses.params.judge 같은 우회 채널이 필요 없다(설계 결정 F10).
-- 클레임 시 이전 실패 메시지(error_text)를 지우는 것도 004의 gen_error=null
-- 관례와 같다. 재큐(재시도) 시에는 error_text를 남긴다 - 대시보드 계약은
-- **status='failed'일 때만** 사용자에게 사유를 노출하는 것이다(004·009와 동일).
--
-- 워커도 자기 핸들러 안에서 status를 갱신하지만(단계 F Task 4), 그건 정상 경로
-- 뿐이다. 워커가 예외로 죽거나 컨테이너가 통째로 사라지면 화면은 이 세 함수가
-- 쓰는 값만 보게 된다 - 이 분기가 없으면 정합이 'processing'에 영구 고착돼
-- 사용자가 재시도할 방법이 없어진다(잡은 이미 failed인데 화면은 진행 중).
-- -----------------------------------------------------------------------------

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
             (coalesce(nullif(params->'judge', 'null'::jsonb), '{}'::jsonb) - 'error')
               || jsonb_build_object('state', 'processing', 'at', to_jsonb(now())), true)
     where id = (v_job.payload->>'analysis_id')::uuid;
  elsif v_job.type = 'register' and (v_job.payload ? 'registration_id') then
    -- 정합은 자기 테이블에 상태가 있다(설계 결정 F10). report 분기와 같은 모양.
    update registrations set status = 'processing', error_text = null, updated_at = now()
     where id = (v_job.payload->>'registration_id')::uuid;
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
               coalesce(nullif(params->'judge', 'null'::jsonb), '{}'::jsonb)
                 || jsonb_build_object('state', 'failed', 'at', to_jsonb(now()), 'error', p_error), true)
       where id = (v_job.payload->>'analysis_id')::uuid;
    elsif v_job.type = 'register' and (v_job.payload ? 'registration_id') then
      -- 재시도 소진: 화면이 사유를 보여줄 수 있도록 error_text에 남긴다.
      -- 병합 스캔(result_scan_id)은 성공했을 때만 워커가 채우므로 여기서 건드릴
      -- 것이 없다 - 실패한 정합은 원본 두 스캔을 그대로 둔다.
      update registrations set status = 'failed', error_text = p_error, updated_at = now()
       where id = (v_job.payload->>'registration_id')::uuid;
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
               coalesce(nullif(params->'judge', 'null'::jsonb), '{}'::jsonb)
                 || jsonb_build_object('state', 'queued', 'at', to_jsonb(now()), 'error', p_error), true)
       where id = (v_job.payload->>'analysis_id')::uuid;
    elsif v_job.type = 'register' and (v_job.payload ? 'registration_id') then
      -- 재큐(재시도): 004의 gen_status='queued'+gen_error 관례와 동일하게
      -- error_text를 함께 남긴다(화면은 status='failed'일 때만 노출한다).
      update registrations set status = 'queued', error_text = p_error, updated_at = now()
       where id = (v_job.payload->>'registration_id')::uuid;
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
           coalesce(nullif(a.params->'judge', 'null'::jsonb), '{}'::jsonb)
             || jsonb_build_object('state', 'queued', 'at', to_jsonb(now())), true)
   from jobs j
   where j.status = 'queued' and j.type = 'slope_judge'
     and (j.payload->>'analysis_id')::uuid = a.id
     and (a.params->'judge'->>'state') = 'processing';
  -- register: 고착된 잡이 회수되면 정합 화면도 '대기 중'으로 되돌린다. 이 줄이
  -- 없으면 잡은 다시 큐에 들어갔는데 화면만 '정합 중...'에 영구히 남는다.
  update registrations r set status = 'queued', updated_at = now()
   from jobs j
   where j.status = 'queued' and j.type = 'register'
     and (j.payload->>'registration_id')::uuid = r.id and r.status = 'processing';
  return v_count;
end $$;

-- PostgREST 스키마 캐시 갱신(007:144와 같은 관례). 위 (2)가 추가한 컬럼을 워커·
-- 대시보드가 곧바로 PATCH/select 하므로, 캐시가 갱신되기 전이면 42703처럼 보이는
-- 오류가 잠깐 난다. Supabase의 DDL 이벤트 트리거가 보통 알아서 처리하지만
-- 명시해 두는 편이 싸다.
notify pgrst, 'reload schema';

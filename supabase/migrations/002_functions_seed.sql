-- =============================================================================
-- 평활도 분석 대시보드 — 마이그레이션 002 (잡 큐 함수 · 기준/설정 시드)
-- 정본: docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md §6.1, §4.2
-- 선행: 001_schema.sql (jobs/analyses/criteria/app_settings 테이블·enum·RLS)
--
-- 함수 목록(워커가 RPC로 호출):
--   fn_job_claim(p_worker text) -> jobs
--   fn_job_complete(p_job_id uuid) -> void
--   fn_job_fail(p_job_id uuid, p_error text) -> void
--   fn_enqueue_job(p_type job_type, p_payload jsonb) -> uuid
--   fn_resolve_criteria(p_site_id uuid, p_surface surface_type) -> setof criteria
--   fn_reap_stuck_jobs(p_timeout_minutes int default 30) -> int
--
-- plpgsql 정독 메모(로컬 Postgres 없이 문법·시맨틱을 오프라인 파서로 검증):
--  1) fn_job_claim의 `select ... into v_job ... order by created_at for update
--     skip locked limit 1` 구성(브리프 원문 그대로)을 실제 검증했다. 로컬
--     Postgres가 없어 libpg_query(실제 Postgres gram.y를 그대로 추출한 C
--     파서) 바인딩인 pglast로 오프라인 파싱했다: `ORDER BY ... FOR UPDATE
--     SKIP LOCKED LIMIT n`과 `ORDER BY ... LIMIT n FOR UPDATE SKIP LOCKED`
--     두 절 순서를 각각 파스해 AST(위치 정보 제외)를 비교한 결과 완전히
--     동일했다 — PostgreSQL 문법이 select_no_parens에 대해 "opt_sort_clause
--     for_locking_clause opt_select_limit"와 "opt_sort_clause select_limit
--     opt_for_locking_clause" 두 생산 규칙을 모두 두고 있어 FOR UPDATE와
--     LIMIT의 선후 순서를 둘 다 허용하기 때문이다(공식 SELECT 구문 다이어그램은
--     하나의 정규 순서만 보여주지만 실제 문법은 더 관대함). 즉 브리프 원문 그대로
--     유효한 SQL이며 CTE/서브쿼리 재구성은 불필요하다고 확인했다 — 아래 SQL은
--     브리프 문구를 그대로 유지한다. (plpgsql SELECT INTO의 INTO 절도 대상
--     목록 직후·FROM 앞이라는 올바른 위치에 있어 별도 문제 없음.)
--  2) 전 SECURITY DEFINER 함수에 `set search_path = public`을 고정한다
--     (Supabase 보안 권고: search_path가 고정되지 않은 SECURITY DEFINER
--     함수는 호출자가 세션 search_path를 조작해 의도치 않은 스키마의
--     동명 객체를 끌어들이는 권한 상승 경로가 될 수 있다). fn_resolve_criteria는
--     SECURITY DEFINER가 아니라 SECURITY INVOKER(기본값)의 `language sql
--     stable` 함수이므로 이 권고의 대상이 아니다 — 정의자 권한으로 실행되지
--     않으므로 search_path 조작으로 얻을 수 있는 권한 상승이 없다(criteria
--     테이블 자체 RLS가 호출자 권한으로 그대로 적용됨).
--  3) 잡 큐 클레임/완료/실패/리퍼 4종은 워커(service_role 키) 전용이며 클라이언트
--     노출을 의도하지 않는다(001 §RLS 주석: "jobs는 service_role 전용"). 그런데
--     Supabase는 스키마 생성 시 ALTER DEFAULT PRIVILEGES로 새 함수에 대해
--     anon·authenticated에도 기본 EXECUTE를 자동 부여한다(001에서 profiles
--     컬럼 권한을 별도로 축소해야 했던 것과 동일한 이유) — 그대로 두면 이
--     함수들이 SECURITY DEFINER로 실행되어 jobs 테이블의 "정책 없음"(RLS
--     전면 차단) 방어를 우회해 클라이언트가 잡 큐를 직접 조작할 수 있다.
--     따라서 아래에서 anon·authenticated의 EXECUTE를 명시적으로 회수한다.
-- =============================================================================

-- 잡 큐 함수 (스펙 §6.1): 클레임은 SKIP LOCKED 원자, 전이는 analyses와 동일 트랜잭션
create or replace function fn_job_claim(p_worker text)
returns jobs language plpgsql security definer set search_path = public as $$
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
  if v_job.type = 'analyze' and (v_job.payload ? 'analysis_id') then
    update analyses set status = 'processing' where id = (v_job.payload->>'analysis_id')::uuid;
  end if;
  select * into v_job from jobs where id = v_job.id;
  return v_job;
end $$;

create or replace function fn_job_complete(p_job_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_job jobs;
begin
  select * into v_job from jobs where id = p_job_id;
  update jobs set status = 'done', finished_at = now(), locked_at = null, locked_by = null
   where id = p_job_id;
  -- analyses.status는 워커가 결과 저장 시 함께 갱신(update)하므로 여기선 잡만 종결
end $$;

create or replace function fn_job_fail(p_job_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v_job jobs;
begin
  select * into v_job from jobs where id = p_job_id;
  if v_job.attempts >= v_job.max_attempts then
    update jobs set status = 'failed', error = p_error, finished_at = now(),
                    locked_at = null, locked_by = null where id = p_job_id;
    if v_job.type = 'analyze' and (v_job.payload ? 'analysis_id') then
      update analyses set status = 'failed' where id = (v_job.payload->>'analysis_id')::uuid;
    end if;
  else
    update jobs set status = 'queued', error = p_error,
                    run_after = now() + (interval '10 seconds' * v_job.attempts),
                    locked_at = null, locked_by = null where id = p_job_id;
    if v_job.type = 'analyze' and (v_job.payload ? 'analysis_id') then
      update analyses set status = 'queued' where id = (v_job.payload->>'analysis_id')::uuid;
    end if;
  end if;
end $$;

create or replace function fn_enqueue_job(p_type job_type, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into jobs(type, payload) values (p_type, p_payload) returning id into v_id;
  return v_id;
end $$;

create or replace function fn_resolve_criteria(p_site_id uuid, p_surface surface_type)
returns setof criteria language sql stable as $$
  select * from criteria
   where is_active and surface = p_surface
     and (site_id = p_site_id or (site_id is null
          and not exists (select 1 from criteria c2 where c2.is_active
                           and c2.surface = p_surface and c2.site_id = p_site_id)))
   order by is_default desc, name;
$$;

create or replace function fn_reap_stuck_jobs(p_timeout_minutes int default 30)
returns int language plpgsql security definer set search_path = public as $$
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
   where j.status = 'queued' and j.type = 'analyze'
     and (j.payload->>'analysis_id')::uuid = a.id and a.status = 'processing';
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- 함수 실행 권한 (Supabase 보안 권고 — 위 헤더 메모 3번 참조): 클레임/완료/실패/
-- 리퍼는 워커(service_role)만 호출해야 하므로 anon·authenticated의 기본 EXECUTE를
-- 회수한다. 잡 등록·기준 조회는 로그인된 대시보드 사용자가 직접 RPC로 호출하므로
-- authenticated에는 유지하되, 비로그인(anon)에는 부여하지 않는다(§2.2: 로그인
-- 사용자 전원 동일 권한 — anon 접근은 이 시스템에서 전혀 상정하지 않음).
-- -----------------------------------------------------------------------------
revoke execute on function fn_job_claim(text) from anon, authenticated;
revoke execute on function fn_job_complete(uuid) from anon, authenticated;
revoke execute on function fn_job_fail(uuid, text) from anon, authenticated;
revoke execute on function fn_reap_stuck_jobs(int) from anon, authenticated;
revoke execute on function fn_enqueue_job(job_type, jsonb) from anon;
revoke execute on function fn_resolve_criteria(uuid, surface_type) from anon;
grant execute on function fn_enqueue_job(job_type, jsonb) to authenticated;

-- =============================================================================
-- 시드 데이터
-- =============================================================================

-- app_settings 시드: 측정 불확도 U (스펙 §4.2, docs/superpowers/plans/2026-07-28-p2-infra.md:374와 동일)
insert into app_settings(key, value) values
  ('uncertainty_mm', '{"floor": 5.0, "wall": 8.0}')
on conflict (key) do nothing;

-- criteria 시드 11종: engine/flatness/data/seed_criteria.json 11행과 name/surface/
-- span_m/metric/pass_mm/rework_mm/source 전 항목 수치 완전 일치 확인(대조표는
-- task-3-report.md 참조, 불일치 0). 전역 기준(site_id 미지정 -> NULL)이며
-- (surface, name) 부분 유니크(criteria_global_name) 및 표면별 기본값 1개
-- (criteria_global_default: floor-kcs-exposed, wall-kcs-tilt-other) 제약을 만족한다.
insert into criteria (surface, name, source_text, thresholds, is_default) values
  ('floor', 'floor-kcs-finish7plus', 'KCS 14 20 10 표 3.7-1 (마감두께 7mm 이상)', '[{"span_m":1,"metric":"flatness","pass_mm":10,"rework_mm":30}]', false),
  ('floor', 'floor-kcs-finish7minus', 'KCS 14 20 10 표 3.7-1 (마감두께 7mm 미만)', '[{"span_m":3,"metric":"flatness","pass_mm":10,"rework_mm":30}]', false),
  ('floor', 'floor-kcs-exposed', 'KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)', '[{"span_m":3,"metric":"flatness","pass_mm":7,"rework_mm":21}]', true),
  ('floor', 'floor-molit-cushion', '국토부 바닥충격음 고시 (완충재 바탕)', '[{"span_m":3,"metric":"flatness","pass_mm":7,"rework_mm":21}]', false),
  ('floor', 'floor-lh-exposed', 'LHCS 14 20 10 05 표 3.11-7 (제물치장·도장·벽지)', '[{"span_m":3,"metric":"flatness","pass_mm":6,"rework_mm":18}]', false),
  ('floor', 'floor-lh-thick', 'LHCS 14 20 10 05 표 3.11-7 (마감 13mm 초과)', '[{"span_m":3,"metric":"flatness","pass_mm":10,"rework_mm":30}]', false),
  ('wall', 'wall-kcs-tilt-exposed', 'KCS 21 50 05 §3.2.6 (노출 모서리·줄눈)', '[{"span_m":3,"metric":"flatness","pass_mm":6,"rework_mm":18}]', false),
  ('wall', 'wall-kcs-tilt-other', 'KCS 21 50 05 §3.2.6 (기타)', '[{"span_m":3,"metric":"flatness","pass_mm":9,"rework_mm":27}]', true),
  ('wall', 'wall-kcs-plumb', 'KCS 21 50 05 §3.2.2 (H≤30m)', '[{"span_m":null,"metric":"plumbness","pass_mm":25,"rework_mm":75}]', false),
  ('wall', 'wall-plaster-surface', '주택건설 전문시방서 31310 (미장 바름면)', '[{"span_m":3,"metric":"flatness","pass_mm":3,"rework_mm":9}]', false),
  ('wall', 'wall-plaster-base', '주택건설 전문시방서 31310 (미장 바탕면)', '[{"span_m":3,"metric":"flatness","pass_mm":6,"rework_mm":18}]', false);

-- =============================================================================
-- 마이그레이션 003 - P3 대시보드 지원
-- 선행: 001_schema.sql, 002_functions_seed.sql
-- 내용: (1) photos 전용 private Storage 버킷 + RLS (스펙 §6.3: 데모에서 사진만
--        Supabase Storage, signed URL로 접근)
--       (2) Realtime publication에 scans·analyses 추가 (스펙 §3.2.⑤: 진행 상태를
--        Realtime으로 반영 - P2 확정: jobs는 클라이언트 완전 불가시이므로
--        analyses.status·scans.status 변화를 구독한다)
--       (3) 잡 큐 함수(fn_job_claim·fn_job_fail) 확장 재정의 — 002의 함수를 그대로
--        복사해 import/precheck 잡 타입도 analyses.status·scans.status 전이에
--        반영되도록 최소 수정한다(적용 순서: 001 → 002 → 003이므로 이 파일의 정의가
--        최종 배포 상태로 남는다). 최종 전체 브랜치 리뷰 Important 1 반영: 002는
--        type='analyze'일 때만 전이시켜, 대시보드가 등록하는 import·precheck 잡의
--        실패가 화면에 전혀 반영되지 않던 결함을 고친다.
-- =============================================================================

-- (1) photos 버킷(private) - 파일당 10MB 제한(사진 용도, Free 한도 보호)
insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', false, 10485760)
on conflict (id) do nothing;

-- storage.objects RLS: 로그인 사용자는 photos 버킷만 읽기/쓰기 가능
-- (머지 전 필수 m12: 위 buckets insert의 on conflict do nothing과 멱등성을 맞추기
-- 위해 재실행 시 충돌하지 않도록 먼저 drop)
drop policy if exists photos_all_auth on storage.objects;
create policy photos_all_auth on storage.objects for all to authenticated
  using (bucket_id = 'photos') with check (bucket_id = 'photos');

-- (2) Realtime publication (이미 추가된 경우 무시)
do $$ begin
  alter publication supabase_realtime add table public.scans;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.analyses;
exception when duplicate_object then null; end $$;

-- =============================================================================
-- (3) 잡 큐 함수 확장 재정의 (최종 전체 브랜치 리뷰 Important 1)
--
-- 아래 두 함수는 002_functions_seed.sql의 본문을 그대로 복사한 뒤 다음만 최소
-- 수정했다:
--   - fn_job_claim: analyses 전이 조건을 type='analyze'에서 type in ('analyze',
--     'import')로 확장 — import 잡도 클레임 시 analyses.status가 'processing'으로
--     바뀌어야 대시보드가 "분석 중" 표시를 할 수 있다.
--   - fn_job_fail: 최종 실패 분기·재큐(재시도) 분기 양쪽 모두 analyses 전이 조건을
--     동일하게 in ('analyze', 'import')로 확장하고, precheck 잡
--     (payload.scan_id 존재) 분기를 추가한다 — 최종 실패는 scans.status='failed'로
--     (001_schema.sql scan_status enum에 'failed' 존재 확인 완료), 재큐(재시도)는
--     scans.status='uploaded'로 되돌린다. fn_job_claim은 precheck 잡의 scans.status를
--     건드리지 않는다(scan_status enum에 'processing' 상당 값이 없음 — 원본 002도
--     클레임 단계에서는 analyze만 다루고 별도 "처리 중" 상태를 두지 않는다).
--
-- security definer·set search_path·반환 타입·파라미터명(p_worker/p_job_id/p_error)은
-- 원본과 100% 동일하게 유지한다(파라미터명이 바뀌면 PostgREST RPC 호출이 깨진다).
-- create or replace는 기존 ACL(002에서 부여한 service_role 전용 grant)을 보존하므로
-- grant를 다시 실행할 필요가 없다.
--
-- 워커 tests/fake_db.py의 FakeDB.claim_job/fail_job도 이 시맨틱과 정확히 일치하도록
-- 동기화했다(worker/tests/fake_db.py 참고).
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
    end if;
  else
    update jobs set status = 'queued', error = p_error,
                    run_after = now() + (interval '10 seconds' * v_job.attempts),
                    locked_at = null, locked_by = null where id = p_job_id;
    if v_job.type in ('analyze', 'import') and (v_job.payload ? 'analysis_id') then
      update analyses set status = 'queued' where id = (v_job.payload->>'analysis_id')::uuid;
    elsif v_job.type = 'precheck' and (v_job.payload ? 'scan_id') then
      update scans set status = 'uploaded' where id = (v_job.payload->>'scan_id')::uuid;
    end if;
  end if;
end $$;

-- 007: 구배 분석(세부과업 4) — analysis_kind 차원 추가 · 기준 조회 확장 · 정합 이력 · 구배 기준 시드
--
-- 설계 정본: docs/superpowers/specs/2026-08-02-slope-analysis-design.md §3
-- 기준 수치 근거: docs/slope-criteria-sources.md (원문 대조표)
--
-- 재실행 안전(멱등). 003~006과 같은 관례.
--
-- ⚠ 실행 순서 주의: criteria.kind 추가 -> 기본값 인덱스 재정의 -> 시드.
--   순서를 바꾸면 기존 floor 기본 기준(floor-kcs-exposed)이 (surface='floor') 키를
--   점유하고 있어 구배 기본 기준 INSERT가 유니크 위반으로 실패한다.

-- 1) 분석 종류 차원 ---------------------------------------------------------
-- 표면 유형(floor/wall)은 그대로 두고 분석 종류를 분리한다. 구배는 표면의 종류가
-- 아니라 "같은 바닥을 보는 다른 방식"이므로 surface에 'slope'를 넣으면 의미가
-- 어긋나고, (criteria_id, surface) 복합 FK와도 충돌한다.
do $$ begin
  create type analysis_kind as enum ('flatness', 'slope');
exception when duplicate_object then null;
end $$;

alter table analyses add column if not exists kind analysis_kind not null default 'flatness';
alter table criteria add column if not exists kind analysis_kind not null default 'flatness';

-- 2) 유니크 인덱스 재정의 ---------------------------------------------------
-- (a) 현재 분석: (scan_id) -> (scan_id, kind). 이렇게 하지 않으면 구배 분석이
--     평활도 분석을 밀어낸다. 기존 데이터는 전부 kind='flatness'라 재생성이
--     실패할 수 없다.
drop index if exists analyses_current;
create unique index analyses_current on analyses(scan_id, kind)
  where is_current and deleted_at is null;

-- (b) 기본 기준: (surface) -> (surface, kind). 평활도와 구배가 각각 기본값을
--     하나씩 가질 수 있어야 한다.
drop index if exists criteria_global_default;
drop index if exists criteria_site_default;
create unique index criteria_global_default on criteria(surface, kind)
  where site_id is null and is_default and is_active;
create unique index criteria_site_default on criteria(site_id, surface, kind)
  where site_id is not null and is_default and is_active;

-- criteria_global_name(surface, name)은 넓히지 않는다. 구배 기준 이름이 전부
-- 'slope-' 접두라 기존 11종과 겹치지 않는다.

-- 3) 기준 조회 함수 확장 -----------------------------------------------------
-- ⚠ create or replace로는 인자를 추가할 수 없다(시그니처가 달라 오버로드가 둘이
--   된다). drop 후 create해야 하고, drop이 ACL을 가져가므로 아래에서 002의
--   revoke/grant 3줄을 새 시그니처로 재발급한다.
--   003_dashboard_support.sql:57-59의 "grant 재실행 불필요" 관례는 create or
--   replace를 쓴 경우에 한한 것이라 여기엔 적용되지 않는다.
drop function if exists fn_resolve_criteria(uuid, surface_type);
drop function if exists fn_resolve_criteria(uuid, surface_type, analysis_kind);

create function fn_resolve_criteria(p_site_id uuid, p_surface surface_type,
                                    p_kind analysis_kind default 'flatness')
returns setof criteria language sql stable as $$
  select * from criteria
   where is_active and surface = p_surface and kind = p_kind
     and (site_id = p_site_id or (site_id is null
          and not exists (select 1 from criteria c2 where c2.is_active
                           and c2.surface = p_surface and c2.kind = p_kind
                           and c2.site_id = p_site_id)))
   order by is_default desc, name;
$$;

-- ⚠ 내부 서브쿼리 c2에도 kind 필터가 있어야 한다. 빠뜨리면 오버라이드 시맨틱이
--   조용히 깨진다 - 현장에 평활도 현장기준이 하나라도 있으면 그 현장에서 전역
--   구배 기준이 후보 목록에서 통째로 사라지고, UI는 오류 없이 빈 목록을 보인다.

revoke execute on function fn_resolve_criteria(uuid, surface_type, analysis_kind) from public, anon;
grant execute on function fn_resolve_criteria(uuid, surface_type, analysis_kind) to authenticated;
grant execute on function fn_resolve_criteria(uuid, surface_type, analysis_kind) to service_role;

-- 4) 정합 이력 (단계 F에서 사용, 스키마만 먼저 세운다) ------------------------
-- 정합 RMSE는 과업지시서 12쪽의 "평면 피팅 오차 검증 데이터"에 대응한다.
do $$ begin
  create type registration_status as enum
    ('awaiting_points', 'queued', 'processing', 'done', 'failed');
exception when duplicate_object then null;
end $$;

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  source_scan_ids uuid[] not null,
  correspondences jsonb not null check (jsonb_typeof(correspondences) = 'array'),
  transform jsonb,
  rmse_mm double precision,
  iterations int,
  status registration_status not null default 'awaiting_points',
  error_text text,
  result_scan_id uuid references scans(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- source_scan_ids는 배열이라 FK를 걸 수 없다. 원본 스캔이 삭제되면 배열에 죽은
-- id가 남는데, 이력 테이블이므로 의도적으로 허용한다(단계 F에서 화면이 견딘다).

alter table registrations enable row level security;
drop policy if exists all_auth on registrations;
create policy all_auth on registrations for all to authenticated using (true) with check (true);

-- RLS는 001의 전 테이블 관례를 따른다. enable만 하고 정책을 빠뜨리면 authenticated
-- 전면 거부가 되어 대시보드가 아무것도 못 읽는다.

-- 5) 구배 기준 시드 ---------------------------------------------------------
-- 근거·검증 등급·인용 제약은 docs/slope-criteria-sources.md 참조.
--
-- design_pct와 pass_pct는 기준 문서가 준 "범위"를 중앙값±반폭으로 옮긴 것이다
-- (예: 1/100~1/50 = 1~2% -> 1.5% ± 0.5%). 적합 구간이 원문 범위와 정확히
-- 일치하므로 창작이 아니라 표기 변환이다.
--
-- re_pct는 어느 기준 문서에도 없다. 본 저장소의 평활도 기준 11종이 예외 없이
-- 쓰는 관례(재시공 = 허용치 x 3, KCS 14 20 10 유래)를 그대로 적용했다.
-- dir_pass_deg도 근거가 없는 용역 자체 설정값이다.
--
-- surface는 반드시 'floor'다. analyses의 복합 FK (criteria_id, surface) ->
-- criteria(id, surface) 때문에 다른 값을 넣으면 분석 insert가 FK 위반으로 막힌다.
insert into criteria (surface, kind, name, source_text, thresholds, is_default) values
  ('floor', 'slope', 'slope-roof-exposed',
   'KCS 41 40 01 방수공사일반 §3.1.3(1) 노출방수(top coat 마감 또는 무마감) 1/50~1/20 [원문대조]. 재시공 임계는 저장소 관례(적합폭 3배), 방향 허용각은 용역 설정값',
   '[{"use":"옥상 슬래브(노출방수)","design_pct":3.5,"pass_pct":1.5,"re_pct":4.5,"dir_pass_deg":30}]', false),
  ('floor', 'slope', 'slope-roof-protected',
   'KCS 41 40 01 방수공사일반 §3.1.3(1) 비노출(보호층) 1/100~1/50 [원문대조]. KCS 41 56 01 §1.5.2(3)의 1/50 이상과 상충하므로 지붕 전체 판정에는 노출방수 기준 검토 필요',
   '[{"use":"옥상 슬래브(비노출·보호층)","design_pct":1.5,"pass_pct":0.5,"re_pct":1.5,"dir_pass_deg":30}]', false),
  ('floor', 'slope', 'slope-bathroom',
   'KCS 41 48 01 타일공사 §3.1(11)① 마. "바닥면은 물고임이 없도록 구배를 유지하되, 1/100을 넘지 않도록 한다" [원문대조]. 하한은 정성 규정이라 수치 근거 없음',
   '[{"use":"욕실·화장실 바닥","design_pct":0.5,"pass_pct":0.5,"re_pct":1.5,"dir_pass_deg":30}]', false),
  ('floor', 'slope', 'slope-parking',
   'KDS 44 70 05 주차장 §4.1.3(3)① 가로방향 3% 이하 [원문대조, 상한만]. 배수를 위한 최소 구배 규정은 존재하지 않는다. 도로법상 도로의 주차장 기준이므로 건축물 부설주차장에는 준용',
   '[{"use":"주차장 바닥","design_pct":1.5,"pass_pct":1.5,"re_pct":4.5,"dir_pass_deg":30}]', false),
  ('floor', 'slope', 'slope-indoor-level',
   '설계 구배 0%(의도적 구배 없음). 허용폭은 기준 문서 근거가 없는 용역 설정값. 방향 판정 대상이 아니므로 배수구를 지정하지 말 것',
   '[{"use":"실내 평바닥","design_pct":0.0,"pass_pct":1.0,"re_pct":3.0,"dir_pass_deg":180}]', true)
on conflict do nothing;

-- slope-indoor-level을 기본값으로 둔 이유: 배수구를 지정하지 않아도 의미가
-- 성립하는 유일한 기준이라, 사용자가 아무것도 고르지 않고 돌렸을 때 가장 덜
-- 틀린다.

-- 6) PostgREST 스키마 캐시 갱신 ----------------------------------------------
-- 이 저장소에서 함수 시그니처를 바꾸는 첫 마이그레이션이다. Supabase가 DDL 이벤트
-- 트리거로 자동 갱신하지만, 반영이 늦으면 대시보드의 RPC 호출이 "함수를 찾을 수
-- 없음"으로 실패하므로 명시적으로 알린다.
notify pgrst, 'reload schema';

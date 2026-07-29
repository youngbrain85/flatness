-- =============================================================================
-- 평활도 분석 대시보드 스키마 v1 — 마이그레이션 001 (테이블 · 제약 · RLS)
-- 정본: docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md §6.1~6.3
-- 데모(P2): 대용량 파일 경로는 Storage가 아닌 로컬 data/ 상대 규약 문자열(§6.3),
--           service_role 전용 함수는 002_functions_seed.sql에서 정의
--
-- 정의 순서: extension → 독립 테이블 → enum → 참조 테이블(FK 대상 선행) → 인덱스 → RLS
-- RLS policy 이름 주의: Postgres는 policy 이름을 (schema, table, name) 단위로 유일성 검사한다
--   (pg_policies는 테이블마다 독립 네임스페이스) — 따라서 서로 다른 테이블에 동일한
--   policy 이름(all_auth, read_auth 등)을 재사용해도 충돌하지 않는다.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- profiles (§6.1: "id(uuid, FK auth.users), display_name")
-- 데모 조정: is_admin·created_at은 스펙 §6.1 profiles 항목에 명시적으로 나열되지
-- 않았으나, §6.3("criteria 전역 행·app_settings 수정은 admin 클레임")의 RLS 정책이
-- 참조할 admin 판별 컬럼이 필요하므로 필수 보완으로 추가.
-- -----------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- app_settings (§6.1: "key, value jsonb — 측정 불확도 U(표면 유형별), 기타 전역 설정")
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- sites (§6.1: "id, name, address, memo, created_at, updated_at") — 스펙과 완전 일치
create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- locations (§6.1: "id, site_id FK, building(동), floor(층 표기), floor_order(int),
-- room(공간), name(측정위치), memo, UNIQUE(site_id, building, floor, room, name),
-- 입력 trim 정규화, created_at, updated_at")
-- 데모 조정: "입력 trim 정규화"는 DB 제약이 아닌 애플리케이션(P3 폼) 레벨에서 수행 —
-- 스펙이 DB 트리거/CHECK로 강제하라는 지시가 없어 이 마이그레이션 범위 밖으로 둔다.
create table locations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  building text not null default '',
  floor text not null default '',
  floor_order int not null default 0,
  room text not null default '',
  name text not null,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, building, floor, room, name)
);

-- 표면 유형 등 enum들: 컬럼명은 "surface"(짧은 실사용명), 타입명은 "surface_type"
-- (스펙 산문에서는 속성을 "surface_type"으로 서술 — 타입명과 컬럼명을 분리하는
-- 관례로, 의미상 차이는 없음. 이하 scans/analyses/criteria에서 동일 관례 사용)
create type surface_type as enum ('floor', 'wall');
create type scan_status as enum ('uploaded', 'awaiting_unit_confirm', 'ready', 'archived', 'failed');
create type data_lineage as enum ('raw', 'fused_mesh', 'unknown');

-- criteria (§6.1: "id, site_id nullable FK, surface_type, name, source_text,
-- thresholds jsonb(§4.2 규약), is_default bool, is_active, version, supersedes_id,
-- created_at" + 부분 유니크 3종 + is_default 부분 유니크)
-- unique(id, surface)는 스펙 명시 항목은 아니나, analyses의 복합 FK
-- (criteria_id, surface) → criteria(id, surface)가 참조 대상 유니크 제약을
-- 요구하므로(Postgres 규칙) 필수 보완.
create table criteria (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,
  surface surface_type not null,
  name text not null,
  source_text text not null,
  thresholds jsonb not null check (jsonb_typeof(thresholds) = 'array'),
  is_default boolean not null default false,
  is_active boolean not null default true,
  version int not null default 1,
  supersedes_id uuid references criteria(id),
  created_at timestamptz not null default now(),
  unique (id, surface)
);
-- 부분 유니크: 전역/현장 각각 (surface, name) 유일 — is_active 조건으로 비활성화 후
-- 동일 이름 재시딩(버전 개정) 허용 (§6.1)
create unique index criteria_global_name on criteria(surface, name) where site_id is null and is_active;
create unique index criteria_site_name on criteria(site_id, surface, name) where site_id is not null and is_active;
-- is_default 강제: (site_id, surface) 당 활성 기본값 1개 — 전역은 site_id NULL 별도 인덱스 (§4.2)
-- 데모 조정: 스펙 §6.1 원문은 "WHERE is_default"뿐이나, 여기서는 "and is_active"를
-- 추가했다 — 버전 개정으로 비활성화된 구 기본값 행이 is_default=true를 그대로 들고
-- 있어도(이력 보존) 새 활성 기본값 행과 유니크 충돌을 일으키지 않게 하기 위함.
-- fn_resolve_criteria(002)가 조회 시 is_active로 별도 필터링하므로 조회 의미는 그대로다.
create unique index criteria_global_default on criteria(surface) where site_id is null and is_default and is_active;
create unique index criteria_site_default on criteria(site_id, surface) where site_id is not null and is_default and is_active;

-- scans (§6.1: "id, location_id FK, surface_type enum(floor|wall), scanned_at, device,
-- operator_id FK profiles(+ operator_name_manual nullable), selected_criteria_id FK
-- (업로드 시 선택, 분석 잡 payload로 전달), raw_file_path, original_filename,
-- file_format, point_count, unit_scale, data_lineage enum(raw|fused_mesh|unknown),
-- status enum(uploaded|awaiting_unit_confirm|ready|archived|failed), deleted_at,
-- created_at, updated_at, UNIQUE(id, surface_type)") — 스펙과 완전 일치
create table scans (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  surface surface_type not null,
  scanned_at date not null,
  device text,
  operator_id uuid references profiles(id),
  operator_name_manual text,
  selected_criteria_id uuid references criteria(id) on delete restrict,
  raw_file_path text,            -- 버킷-상대 경로: raw-scans/{site_id}/{scan_id}/raw.{ext} (§6.3)
  original_filename text,
  file_format text,
  point_count bigint,
  unit_scale double precision,
  lineage data_lineage not null default 'unknown',
  status scan_status not null default 'uploaded',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, surface)
);

create type analysis_status as enum ('queued', 'processing', 'done', 'failed');
create type verdict as enum ('pass', 'borderline', 'repair', 'rework');

-- analyses (§6.1: "id, scan_id FK, surface_type(복합 FK 2개: (scan_id, surface_type)
-- →scans, (criteria_id, surface_type)→criteria — 바닥 스캔에 벽 기준 적용 선언적
-- 차단), criteria_id FK(ON DELETE RESTRICT), applied_criteria jsonb(U 포함 스냅샷),
-- params jsonb, engine_version, status enum(...), stats jsonb(§5.1.7 필수 필드),
-- coverage_pct, overall_verdict enum(...), warnings jsonb, cell_data_path,
-- heatmap_path, viewer_data_path, histogram_path, preview3d_paths jsonb, csv_path,
-- auto_summary, user_summary, is_current bool, deleted_at, created_at, created_by FK")
--
-- ★ 데모 조정(스펙과의 유일한 실질적 컬럼 차이): 스펙은 산출물 경로를
-- cell_data_path / heatmap_path / viewer_data_path / histogram_path /
-- preview3d_paths / csv_path 6개 컬럼으로 나열하지만, 이 마이그레이션은
-- artifacts_dir 단일 컬럼(디렉터리)만 둔다. 근거: docs/contracts/stats-schema.md
-- §6(산출물 파일 규약)이 정본으로 확정한 대로 모든 산출물 파일명이
-- artifacts/{analysis_id}/ 아래 고정 규약(stats.json, cells.json, results.csv,
-- heatmap.png|heatmap_wall{n}.png, preview3d.png[,_zoom.png])이므로 개별 경로를
-- 컬럼화하는 대신 디렉터리 하나만 저장해도 정보 손실이 없다. 이 이름은
-- docs/superpowers/plans/2026-07-28-p2-infra.md Task 5(워커 핸들러)가
-- update_analysis(..., artifacts_dir=...) 및 artifacts.artifacts_dir()로 직접
-- 소비하므로 변경 금지.
create table analyses (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null,
  surface surface_type not null,
  criteria_id uuid not null,
  applied_criteria jsonb,
  params jsonb not null default '{}',
  engine_version text,
  status analysis_status not null default 'queued',
  stats jsonb,
  coverage_pct double precision,
  overall_verdict verdict,
  warnings jsonb not null default '[]',
  artifacts_dir text,            -- 버킷-상대 경로: artifacts/{analysis_id}/ (§6.3, 위 조정 사유 참조)
  auto_summary text,
  user_summary text,
  is_current boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  foreign key (scan_id, surface) references scans(id, surface) on delete cascade,
  foreign key (criteria_id, surface) references criteria(id, surface) on delete restrict
);
-- 스캔당 "현재" 분석 1개만 — 삭제(soft delete) 시 is_current 동반 해제 필요 (§6.1)
create unique index analyses_current on analyses(scan_id) where is_current and deleted_at is null;

-- photos (§6.1: "id, scan_id/location_id/site_id 중 정확히 하나(CHECK), file_path,
-- caption, taken_at, created_at") — 스펙과 완전 일치
create table photos (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid references scans(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  file_path text not null,
  caption text,
  taken_at date,
  created_at timestamptz not null default now(),
  check (num_nonnulls(scan_id, location_id, site_id) = 1)
);

create type report_status as enum ('draft', 'finalized');

-- reports (§6.1: "id, location_id FK(스코프), title, status enum(draft|finalized),
-- snapshot jsonb, opinion_text, pdf_path, created_by FK, created_at")
-- 데모 조정: 스펙은 "finalized 후 snapshot·pdf_path 수정 트리거 차단"을 요구하나,
-- 보고서 기능(발행 흐름) 자체가 P4에서 구현되므로 이 트리거는 P4 마이그레이션으로
-- 이연한다(P2 Task 2/3 브리프 어느 쪽에도 트리거 함수가 없음을 확인). 테이블·컬럼은
-- 스펙과 완전 일치.
create table reports (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete restrict,
  title text not null,
  status report_status not null default 'draft',
  snapshot jsonb,
  opinion_text text,
  pdf_path text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- report_analyses (§6.1: "report_id FK, analysis_id FK, sort_order,
-- PK(report_id, analysis_id)") — 스펙과 완전 일치. analysis_id는 RESTRICT
-- (§6.2 "reports(발행본): 상위 삭제 시 RESTRICT"와 정합)
create table report_analyses (
  report_id uuid not null references reports(id) on delete cascade,
  analysis_id uuid not null references analyses(id) on delete restrict,
  sort_order int not null default 0,
  primary key (report_id, analysis_id)
);

create type job_type as enum ('precheck', 'analyze', 'import', 'report');
create type job_status as enum ('queued', 'processing', 'done', 'failed');

-- jobs (§6.1: "id, type enum(...), payload jsonb, status enum(...), attempts,
-- max_attempts(3), run_after, locked_at, locked_by, error, created_at, started_at,
-- finished_at" + 클레임 FOR UPDATE SKIP LOCKED + 중복 방지 부분 유니크) —
-- 스펙과 완전 일치. 클레임/전이 함수는 002_functions_seed.sql
create table jobs (
  id uuid primary key default gen_random_uuid(),
  type job_type not null,
  payload jsonb not null default '{}',
  status job_status not null default 'queued',
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
-- 중복 방지: analysis_id/scan_id/report_id 중 존재하는 첫 값 기준, 타입별로 분리해
-- queued/processing 상태에서만 유일 — precheck·analyze·import·report 전 타입 커버 (§6.1)
create unique index jobs_dedup on jobs(type, (coalesce(payload->>'analysis_id', payload->>'scan_id', payload->>'report_id')))
  where status in ('queued', 'processing');

-- =============================================================================
-- RLS (§6.3): 전 테이블 활성화. authenticated 전체 허용(내부용 — 연구실 로그인
-- 사용자 전원 동일 권한, §2.2), jobs는 service_role 전용(클라이언트 정책 없음),
-- criteria 전역 행(site_id IS NULL)·app_settings 수정은 admin 클레임만 (§6.3)
-- =============================================================================
alter table profiles enable row level security;
alter table app_settings enable row level security;
alter table sites enable row level security;
alter table locations enable row level security;
alter table criteria enable row level security;
alter table scans enable row level security;
alter table analyses enable row level security;
alter table photos enable row level security;
alter table reports enable row level security;
alter table report_analyses enable row level security;
alter table jobs enable row level security;

create policy all_auth on sites for all to authenticated using (true) with check (true);
create policy all_auth on locations for all to authenticated using (true) with check (true);
create policy all_auth on scans for all to authenticated using (true) with check (true);
create policy all_auth on analyses for all to authenticated using (true) with check (true);
create policy all_auth on photos for all to authenticated using (true) with check (true);
create policy all_auth on reports for all to authenticated using (true) with check (true);
create policy all_auth on report_analyses for all to authenticated using (true) with check (true);

-- profiles: 전원 조회 가능, 본인 행만 생성/수정(다른 사용자의 is_admin을 앱에서
-- 임의로 바꿀 수 없음 — admin 플래그는 service_role/대시보드로 수동 설정 전제)
create policy read_auth on profiles for select to authenticated using (true);
create policy self_upsert on profiles for insert to authenticated with check (id = auth.uid());
create policy self_update on profiles for update to authenticated using (id = auth.uid());

-- app_settings: 조회 전원, 수정은 admin만
create policy read_auth on app_settings for select to authenticated using (true);
create policy admin_write on app_settings for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- criteria: 조회 전원, 쓰기는 현장 스코프(site_id 지정) 행은 전원, 전역 행(site_id
-- NULL)은 admin만 — §6.3 "criteria 전역 행 수정은 admin 클레임" 문구를 그대로 구현
-- (§2.2의 "전역 기본값만"보다 넓은 §6.3 표현을 이 RLS 태스크의 정본으로 채택)
create policy read_auth on criteria for select to authenticated using (true);
create policy site_write on criteria for all to authenticated
  using (site_id is not null or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (site_id is not null or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- jobs: 클라이언트 정책 없음(RLS는 활성화되어 있으나 policy가 0개이므로 authenticated/
-- anon은 기본 거부, service_role은 RLS를 우회) — enqueue는 SECURITY DEFINER 함수로만(002)

-- =============================================================================
-- 컬럼 단위 권한 축소 (코드리뷰 Critical 반영): RLS는 행 단위 필터라 self_update
-- 정책(id = auth.uid())만으로는 "어떤 컬럼을" 바꿀 수 있는지 제한하지 못한다.
-- 즉 authenticated에게 테이블 단위 UPDATE 권한이 있는 한, 누구나 자기 행의
-- is_admin을 true로 세팅해 app_settings·전역 criteria 쓰기 제한(admin_write,
-- site_write 정책)을 스스로 우회할 수 있다. 이를 막기 위해 authenticated의
-- profiles insert/update 권한을 컬럼 화이트리스트로 축소한다 — is_admin은
-- 화이트리스트에서 제외되므로 authenticated는 절대 손댈 수 없고, 오직
-- service_role(RLS 우회 + 컬럼 권한도 우회)의 SQL Editor 조작으로만 부여 가능하다.
-- =============================================================================
revoke insert, update on table profiles from authenticated;
grant insert (id, display_name) on table profiles to authenticated;
grant update (display_name) on table profiles to authenticated;

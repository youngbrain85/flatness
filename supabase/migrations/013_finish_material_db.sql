-- =============================================================================
-- 013_finish_material_db.sql — 로봇친화형 마감재 DB (세부과업 2)
-- 선행: 001_schema.sql 뿐. 002~012의 테이블·함수·enum을 하나도 바꾸지 않는다.
--
-- ★ enum 2파일 분리(008/009·011/012)를 하지 않은 근거: 그 절차는 `alter type ... add
--   value`로 **기존** enum에 값을 더할 때의 "unsafe use of new value"를 막는 것이다.
--   013은 create type으로 새 타입만 만든다(010:11-14과 같은 성질).
--   ⚠ 이 파일에 alter type add value가 한 줄이라도 들어오면 이 근거는 무효가 되고
--     014_*_enum.sql / 015_*_support.sql 로 쪼개야 한다.
--   ★ threshold_profile의 'stair'와 comparator_op의 'eq'/'neq'는 alter가 아니라
--     **create type의 값 목록 자체**를 고쳐서 넣었다. 013은 아직 배포되지 않은 파일이라
--     (supabase/migrations에 없다) 값 목록 수정이 정본이고, alter type이 없으므로 위
--     분리 근거는 그대로 유효하다. ⚠ 013이 한 번이라도 배포된 뒤에 값을 더하려면
--     그때는 do-block이 duplicate_object로 조용히 넘어가므로 반드시 별도 _enum 파일이다.
-- ★ surface_type에 'ceiling'을 더하지 않는다: analyses의 복합 FK가 surface_type을
--   "스캔 대상 면"으로 못박고 있다(007이 analysis_kind를 새로 만든 판단과 동일).
-- ★ 001의 verdict를 재사용하지 않는다: 시공 처분 어휘이고 '판정 불가'가 없다.
-- ★ 잡 큐를 건드리지 않는다 → C2(jobs_dedup)·C3(잡 큐 함수 3종) 해당 없음.
-- ★ 관례 이탈 1건(의도적): (10)절의 FK 인덱스 6개. 근거는 그 절 주석.
-- 멱등: create type=do-block+duplicate_object / table=if not exists /
--       index=drop 후 create / view·function=or replace / 시드는 014에서 on conflict.
-- =============================================================================

-- (0) 선행 가드 — to_regclass는 없으면 NULL을 돌려주므로 한국어 예외를 낼 수 있다.
--     ('public.X'::regtype 형태는 타입이 없을 때 캐스팅 자체가 영문 오류로 죽는다)
do $$
begin
  if to_regclass('public.sites') is null then
    raise exception '001_schema.sql을 먼저 실행하세요 (sites 테이블이 없습니다).';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception '001_schema.sql을 먼저 실행하세요 (profiles 테이블이 없습니다 - RLS admin 게이트가 참조합니다).';
  end if;
  if to_regclass('public.locations') is null then
    raise exception '001_schema.sql을 먼저 실행하세요 (locations 테이블이 없습니다).';
  end if;
end $$;

create extension if not exists pgcrypto;

-- =============================================================================
-- (1) enum — 전부 신규. 컬럼명은 타입명보다 짧게(001:64-66).
-- 경계 규칙: 값 집합이 닫혀 있고 판정이 값마다 분기하면 enum, 업무가 커지며 늘어나면
-- 테이블 행. 그래서 부위·재료계열·제품군·로봇등급·지표는 전부 테이블이다.
-- =============================================================================
do $$ begin create type layer_role as enum ('base','finish');
exception when duplicate_object then null; end $$;
do $$ begin create type standard_basis as enum ('national_standard','industry_common','self_defined');
exception when duplicate_object then null; end $$;
do $$ begin create type property_value_type as enum ('numeric','text','boolean');
exception when duplicate_object then null; end $$;
do $$ begin create type metric_subject as enum ('space','adjacency','finish');
exception when duplicate_object then null; end $$;
-- ★ eq/neq는 boolean 물성 판정용이다(is_low_reflect 같은 축). 수치 지표에는 쓸 수 없게
--   robot_thresholds의 CHECK가 value_type별로 연산자 집합을 가른다.
do $$ begin create type comparator_op as enum ('lte','lt','gte','gt','eq','neq');
exception when duplicate_object then null; end $$;
do $$ begin create type drawing_measurability as enum ('yes','partial','no');
exception when duplicate_object then null; end $$;
do $$ begin create type project_code_kind as enum ('finish_set','opening','insulation','waterproof','other');
exception when duplicate_object then null; end $$;
do $$ begin create type mapping_confidence as enum ('exact','approximate','unmapped');
exception when duplicate_object then null; end $$;
do $$ begin create type adjacency_kind as enum ('door','opening','open_boundary','level_change');
exception when duplicate_object then null; end $$;
-- ★ 'stair' = 계단형 경계. 계단은 라이저·트레드·단수의 **조합**이라 값 하나로 판정되지
--   않는다 → threshold_groups(logic='all')로 묶고 이 profile로 그 그룹을 지목한다.
do $$ begin create type threshold_profile as enum ('none','vertical','beveled','ramped','rounded','stair');
exception when duplicate_object then null; end $$;
-- 조합 규칙의 결합 방식. 'all'=전부 만족해야 pass, 'any'=하나만 만족해도 pass.
do $$ begin create type rule_logic as enum ('all','any');
exception when duplicate_object then null; end $$;
-- ★ 서로 직교하는 두 축을 같은 이름·같은 타입(text)으로 쓰던 것을 여기서 가른다.
--   robot_mode    = 로봇 운용 모드 (기계가 무엇을 하는 중인가)
--   test_condition= 물성 시험 조건 (값이 어떤 조건에서 측정됐나)
--   text였을 때는 'cleaning' 오타 한 글자가 임계값 0행 → 전 판정 unknown을 조용히 만들었다.
--   ''(빈 라벨)이 1급 값인 이유: "모드 구분이 없는 지표"가 실제 다수이고, text 시절의
--   default ''를 그대로 승계해야 기존 유니크 키 의미가 보존된다.
do $$ begin create type robot_mode as enum ('','drive','clean');
exception when duplicate_object then null; end $$;
do $$ begin create type test_condition as enum ('','wet','dry','barefoot');
exception when duplicate_object then null; end $$;
-- ★ 'unknown'이 1급 값인 것이 핵심. 도면에 값이 없거나 임계값에 공표 근거가 없으면
--   통과도 불통과도 아니다. "근거 없으면 통과"로 흘리지 않는다.
do $$ begin create type passability_verdict as enum ('pass','marginal','fail','unknown');
exception when duplicate_object then null; end $$;
-- ★ C6: "도면으로 확정된 것"과 "추론한 것"을 질의로 가르는 축.
--   drawing_confirmed = 도면 원문(면적표·치수체인·창호일람표·면적도 폴리곤)에서 직접 확정.
--   inferred          = 라벨 하나·유추·시드 판단으로 채운 것. basis_note에 근거를 강제한다.
--   기본값을 'inferred'로 두는 것이 핵심이다 — 침묵하면 "확정"이 아니라 "추론"이 된다.
do $$ begin create type evidence_basis as enum ('drawing_confirmed','inferred');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- (2) 분류 골격 — 부위 × 재료계열(트리) × 제품군
-- ★ 3단 중첩이 아니다. 시멘트 모르타르는 바닥·벽·천장에, 실크벽지는 벽·천장에 모두
--   나온다. 중첩이면 같은 재료가 3벌 복제되고 물성 수정이 3곳으로 흩어진다.
--   → 재료계열은 부위와 독립(자기참조 트리), 제품군은 계열에만 매달리고,
--     부위 관계는 material_parts 다대다, "트리"는 (8)의 뷰가 조립한다.
-- =============================================================================
create table if not exists finish_parts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ko text not null,
  sort_order int not null default 0,
  source_text text not null check (source_text <> ''),
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 자기참조 트리 → 'floor-resilient' 아래 세분이 DDL 없이 가능하다.
-- basis NOT NULL: 국가기준에 재료계열 절이 없는 자체 제작 계열(도자기질계·미장계·
--   도장계)이 침묵할 수 없게 하는 장치. pumsem_year CHECK: 품셈 절 번호는 매년 이동한다.
create table if not exists material_families (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references material_families(id) on delete restrict,
  code text not null unique,
  name_ko text not null,
  kcs_code text, pumsem_code text, pumsem_year int, g2b_class text,
  basis standard_basis not null,
  source_text text not null check (source_text <> ''),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pumsem_code is null or pumsem_year is not null)
);

-- 제품군(마스터). 전 제품군에 보편적이고 계산식이 직접 쓰는 물성만 컬럼이고,
-- 희소 물성(카펫 파일 높이, DCOF, 줄눈 폭)은 material_properties로 내린다.
-- 두께 NULL = 확인 실패. 0이나 임의값을 넣지 않는다.
-- ★ variant_of: "같은 제품군인데 두께(또는 등급)가 다른 변종"을 형제 행으로 흩어지지 않게
--   묶는다. 정본 절차 = 물성이 두께에 따라 갈리면(석고보드 9.5=준불연 / 12.5=불연,
--   기능성 륨 2.7 vs 6.0의 층간소음 성능) 두께 범위를 넓히지 말고 변종 행을 만든다.
--   material_properties의 unique(material_id, property_id, test_cond)를 mode 오용으로
--   우회하던 유일한 이유가 이것이었다.
create table if not exists finish_materials (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references material_families(id) on delete restrict,
  variant_of uuid references finish_materials(id) on delete restrict,
  code text not null unique,
  name_ko text not null,
  aliases text[] not null default '{}',
  role layer_role not null,
  hardness text check (hardness is null or hardness in ('soft','semi_rigid','rigid')),
  install_method text,
  is_wet_process boolean,
  thickness_min_mm double precision,
  thickness_max_mm double precision,
  typical_thickness_mm double precision,
  thickness_options_mm double precision[] not null default '{}',
  ks_codes text[] not null default '{}',
  g2b_class text,
  common_use text,
  source_text text not null check (source_text <> ''),
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (variant_of is distinct from id),
  check (thickness_min_mm is null or thickness_max_mm is null or thickness_min_mm <= thickness_max_mm),
  check (typical_thickness_mm is null
         or ((thickness_min_mm is null or typical_thickness_mm >= thickness_min_mm)
         and (thickness_max_mm is null or typical_thickness_mm <= thickness_max_mm)))
);

-- typical_thickness_mm에는 범위 CHECK가 있는데 thickness_options_mm 배열에는 없었다
-- (min 9.5/max 12.5인 행에 50.0이 아무 제약 없이 들어갔다). CHECK는 집합 함수·unnest를
-- 쓸 수 없으므로 트리거로 강제한다(fn_material_property_guard와 같은 이유·같은 errcode).
create or replace function fn_finish_material_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_bad double precision;
begin
  select x into v_bad from unnest(new.thickness_options_mm) as x
   where (new.thickness_min_mm is not null and x < new.thickness_min_mm)
      or (new.thickness_max_mm is not null and x > new.thickness_max_mm)
   limit 1;
  if v_bad is not null then
    raise exception '두께 옵션 %는 이 제품군의 두께 범위(% ~ %) 밖입니다.',
      v_bad, new.thickness_min_mm, new.thickness_max_mm using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_finish_material_guard on finish_materials;
create trigger trg_finish_material_guard before insert or update on finish_materials
  for each row execute function fn_finish_material_guard();

-- ★ space_finishes의 복합 FK 대상 → "바닥에 벽 전용 마감재"를 선언적으로 차단한다.
create table if not exists material_parts (
  material_id uuid not null references finish_materials(id) on delete cascade,
  part_id uuid not null references finish_parts(id) on delete restrict,
  is_typical boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  primary key (material_id, part_id)
);

-- =============================================================================
-- (3) 물성 등록부 + 값 — 새 물성 추가 = INSERT. 단 타입은 복합 FK로 잠근다.
-- 승격 규칙(정본): robot_metrics가 그 물성을 subject='finish'로 참조하고 값이 스칼라
--   1개+단위 1개로 고정될 때만 컬럼으로 올린다. 절차 = add column → backfill →
--   material_properties 행 삭제 → promoted_column 기입 → 읽는 쪽 같은 배포(C7).
--   promoted_column이 채워지면 트리거가 EAV 쪽 저장을 거부한다(값의 이중 거처 차단).
-- =============================================================================
create table if not exists finish_properties (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ko text not null,
  value_type property_value_type not null,
  unit text, min_value double precision, max_value double precision,
  promoted_column text,
  source_text text not null check (source_text <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, value_type),   -- ↓ material_properties / robot_metrics 복합 FK 대상
  check (value_type = 'numeric' or (unit is null and min_value is null and max_value is null)),
  check (min_value is null or max_value is null or min_value <= max_value)
);

-- ★ "값이 없다"를 세 가지로 구분한다.
--   행 없음 = 미조사 / unknown_reason = 조사했으나 공표 근거 없음 / test_cond = 조건이 갈림
-- ⚠ 컬럼명이 mode가 아니라 test_cond인 이유: robot_thresholds.mode(로봇 운용 모드)와
--   물리적으로 다른 축인데 이름·타입이 같아 "한 축을 기록하면 다른 축이 사라지는" 결함이
--   있었다. 타입도 test_condition enum으로 잠근다.
create table if not exists material_properties (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references finish_materials(id) on delete cascade,
  property_id uuid not null,
  value_type property_value_type not null,
  test_cond test_condition not null default '',
  -- ★ C5: 관측값 쪽 단위. 임계값 축(robot_thresholds.unit / robot_metrics.unit)에만
  --   단위 대조가 있고 관측값 축에는 단위 컬럼 자체가 없어, inch로 기록한 0.4가
  --   mm 임계값 10과 그대로 비교되어 pass가 났다. 이제 트리거가 물성 등록부의 unit과
  --   문자 그대로 대조한다 — 단위 변환은 하지 않는다(단위마다 별도 물성).
  unit text not null default '',
  num_value double precision, text_value text, bool_value boolean,
  unknown_reason text,
  source_text text not null check (source_text <> ''),
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array'),
  created_at timestamptz not null default now(),
  unique (material_id, property_id, test_cond),
  foreign key (property_id, value_type)
    references finish_properties(id, value_type) on delete restrict,
  -- ★ else false 가 핵심이다. CASE가 매치되지 않으면 NULL을 돌려주고 CHECK는 NULL을
  --   통과로 취급한다 → property_value_type에 값을 더하고 이 CHECK를 안 고치면 그 타입이
  --   무검증 통과한다. else false면 그 순간 하드 실패한다. 조용한 통과보다 시끄러운 실패.
  check (
    case
      when unknown_reason is not null then num_nonnulls(num_value, text_value, bool_value) = 0
      else case value_type
        when 'numeric' then num_value  is not null and text_value is null and bool_value is null
        when 'text'    then text_value is not null and num_value  is null and bool_value is null
        when 'boolean' then bool_value is not null and num_value  is null and text_value is null
        else false
      end
    end
  )
);

-- 멱등 보강: 이미 배포된 DB에도 unit 컬럼이 생기게 한다(신규 DB는 위 create가 이미 만든다).
alter table material_properties add column if not exists unit text not null default '';

-- CHECK는 다른 테이블을 못 읽어 트리거로 강제한다(004:148이 같은 이유로 택한 선례).
-- errcode 23514는 PostgREST가 400으로 매핑한다(42501은 권한 거부용이라 부적합).
-- ★ C5: 승격 검사 + 단위 대조 두 가지를 한 트리거에서 한다.
create or replace function fn_material_property_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_col text; v_unit text; v_code text;
begin
  select promoted_column, coalesce(unit, ''), code
    into v_col, v_unit, v_code
    from finish_properties where id = new.property_id;
  if v_col is not null then
    raise exception '물성이 컬럼 %(으)로 승격됐습니다. material_properties에 중복 저장할 수 없습니다.', v_col
      using errcode = '23514';
  end if;
  -- v_unit이 NULL이면 물성 행 자체가 없다 → 복합 FK가 23503으로 잡는다(여기서는 침묵).
  if v_unit is not null and coalesce(new.unit, '') <> v_unit then
    raise exception '관측값 단위 "%"가 물성 %의 단위 "%"와 다릅니다. 단위 변환은 하지 않습니다 - 단위마다 별도 물성을 만드세요.',
      new.unit, v_code, v_unit using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_material_property_guard on material_properties;
create trigger trg_material_property_guard before insert or update on material_properties
  for each row execute function fn_material_property_guard();

-- =============================================================================
-- (4) 로봇 등급 · 지표 · 기준세트 · 임계값
-- 임계값은 (기준세트 × 등급 × 지표 × 운용모드) 4중 키의 행이고 비교 연산자까지
-- 컬럼이라 판정 규칙 자체가 데이터다. criteria처럼 jsonb 배열로 두지 않은 이유:
--   (a) 등급 추가 때마다 배열 전체 재작성, (b) FK 없이는 오타 지표명이 조용히 통과,
--   (c) "어느 등급이 어느 지표에서 탈락했나"가 핵심 출력이라 조인 가능해야 한다.
-- 단 버저닝·전역/현장 오버라이드·스냅샷 관례는 criteria를 그대로 복제한다.
-- =============================================================================
-- ★ 운용 모드(CC1 주행 20mm / 청소 8mm)로 등급을 쪼개지 않는다. 쪼개면 등급 수가
--   모드 수만큼 곱해지고 "같은 기계인가"를 DB가 모른다 → robot_thresholds.mode.
-- ★★ F2 — default_mode: "이 등급의 임계값이 어느 운용 모드로 선언돼 있는가"를 등급 쪽에
--   선언한다. robot_thresholds.mode 는 정확 일치 파티션이라 폴백이 없었다:
--     - commercial-cleaner 는 drive/clean 행만 있어 기본 모드('')로 물으면 규칙 0건 →
--       인접 8건에 판정이 **한 건도 생성되지 않았다**. fail 도 안 나는 조용한 통과다.
--     - 거꾸로 domestic-cleaner('' 행만 있다)에 'clean' 을 물어도 0건이었다.
--   → fn_resolve_thresholds 가 "요청 모드에 그 등급 계보의 행이 하나도 없으면
--     이 컬럼이 선언한 모드로 되돌린다". 폴백은 조용하지 않다 — 어느 모드가 쓰였는지가
--     반환 행의 mode 컬럼에 그대로 드러난다.
create table if not exists robot_classes (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references robot_classes(id) on delete restrict,
  code text not null unique,
  name_ko text not null,
  description text,
  ref_width_mm double precision, ref_length_mm double precision, ref_height_mm double precision,
  specs jsonb not null default '{}' check (jsonb_typeof(specs) = 'object'),
  default_mode robot_mode not null default '',
  source_text text not null check (source_text <> ''),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 멱등 보강(이미 배포된 DB용). 신규 DB는 위 create가 이미 만든다.
alter table robot_classes add column if not exists default_mode robot_mode not null default '';

-- subject가 "관측값이 어디서 오는가"를 못박는다.
-- ★ subject='finish' 지표는 반드시 finish_properties의 numeric 항목에서 값을 길어온다.
--   복합 FK + CHECK로 강제 → "물성"과 "지표"가 두 벌로 갈라지지 않는다.
create table if not exists robot_metrics (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ko text not null,
  unit text not null default '',
  subject metric_subject not null,
  property_id uuid,
  property_type property_value_type,
  measurability drawing_measurability not null,
  source_text text not null check (source_text <> ''),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, subject),   -- ↓ assessment_findings 복합 FK 대상
  foreign key (property_id, property_type)
    references finish_properties(id, value_type) on delete restrict,
  check ((property_id is null) = (property_type is null)),
  -- ★ numeric 강제를 numeric|boolean으로 넓힌다. is_low_reflect(검정 카펫에 추락방지
  --   센서 오작동)는 근거 있는 로봇 제약인데 numeric이 아니라는 이유만으로 어떤 판정에도
  --   못 쓰이는 죽은 데이터였다. 'text'는 여전히 판정 축이 아니다 — module_size처럼
  --   대조용 표기 문자열이라 pass/fail이 정의되지 않는다(시드가 스스로 그렇게 선언했다).
  check (subject <> 'finish' or (property_id is not null and property_type in ('numeric','boolean'))),
  check (subject = 'finish' or property_id is null)
);

-- ★ 단위 대조 1/2: subject='finish' 지표의 unit은 참조 물성의 unit과 같아야 한다.
--   선언만 있고 대조가 없으면 unit 'in'인 지표가 unit 'mm'인 물성을 읽어 0.5와 10을
--   비교한다 — 어떤 제약도 위반하지 않고 거짓 pass가 난다. CHECK는 다른 테이블을 못
--   읽으므로 트리거다(fn_material_property_guard와 같은 선례·같은 errcode).
create or replace function fn_robot_metric_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_unit text; v_code text;
begin
  if new.subject = 'finish' then
    select coalesce(fp.unit, ''), fp.code into v_unit, v_code
      from finish_properties fp where fp.id = new.property_id;
    if coalesce(new.unit, '') <> v_unit then
      raise exception '지표 단위 "%"가 참조 물성 %의 단위 "%"와 다릅니다. 단위가 다르면 별도 지표로 만드세요.',
        new.unit, v_code, v_unit using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_robot_metric_guard on robot_metrics;
create trigger trg_robot_metric_guard before insert or update on robot_metrics
  for each row execute function fn_robot_metric_guard();

-- criteria(001:77-101) 관례 복제: site_id NULL=전역/NOT NULL=현장, is_default,
-- is_active, version, supersedes_id, `where ... and is_active` 부분 유니크 4종.
create table if not exists robot_rulesets (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,
  code text not null,
  name_ko text not null,
  source_text text not null check (source_text <> ''),
  is_default boolean not null default false,
  is_active boolean not null default true,
  version int not null default 1,
  supersedes_id uuid references robot_rulesets(id),
  created_at timestamptz not null default now()
);
drop index if exists robot_rulesets_global_code;
drop index if exists robot_rulesets_site_code;
drop index if exists robot_rulesets_global_default;
drop index if exists robot_rulesets_site_default;
create unique index robot_rulesets_global_code on robot_rulesets(code)
  where site_id is null and is_active;
create unique index robot_rulesets_site_code on robot_rulesets(site_id, code)
  where site_id is not null and is_active;
create unique index robot_rulesets_global_default on robot_rulesets(is_default)
  where site_id is null and is_default and is_active;
create unique index robot_rulesets_site_default on robot_rulesets(site_id)
  where site_id is not null and is_default and is_active;

-- ★ 조합 규칙 — 지표 하나로 판정되지 않는 규칙의 묶음.
--   계단이 대표 사례다: "라이저<=200 AND 트레드>=250 AND 연속단수<=N"은 임계값 한 행에
--   쓸 수 없고, 단차 하나로 뭉개면 3,060mm 층간 계단이 fail로만 나온다(계단등반형
--   로봇의 실제 사양은 라이저 기준이다). 조사자료의 삼성 "45+15(폭 90) 계단형 문턱"도
--   같은 형태다. logic='all'/'any'가 결합 방식이고, 멤버는 robot_thresholds.group_id다.
-- ★ (id, ruleset_id, class_id, mode) 보조 유니크는 아래 복합 FK 대상이다 —
--   "다른 등급·다른 모드의 임계값이 이 그룹에 섞이는" 상태를 선언적으로 막는다.
create table if not exists threshold_groups (
  id uuid primary key default gen_random_uuid(),
  ruleset_id uuid not null references robot_rulesets(id) on delete cascade,
  class_id uuid not null references robot_classes(id) on delete restrict,
  mode robot_mode not null default '',
  code text not null,
  name_ko text not null,
  logic rule_logic not null default 'all',
  applies_profile threshold_profile[] not null default '{}',
  source_text text not null check (source_text <> ''),
  created_at timestamptz not null default now(),
  unique (ruleset_id, class_id, mode, code),
  unique (id, ruleset_id, class_id, mode)
);

-- ★ value NULL 허용: "조사했으나 제조사도 규격도 공표하지 않았다"가 실제로 다수다
--   (바닥 마찰, 실내 평탄도, 실외이동로봇 전반). 0이나 업계 문헌 수치로 채우면
--   판정이 조용히 틀린다. NULL+unknown_reason이 강제되고 판정은 'unknown'이 된다.
-- ★ marginal_value는 근거가 있을 때만(예: 등급 내 최대 공표치, ADA 베벨 상한).
-- ★ applies_profile = 조건부 술어. '{}'는 "형상 무관", 비어 있지 않으면 "관측 대상의
--   문턱 형상이 이 목록에 있을 때만 이 행이 적용된다".
--   이것이 없을 때의 실제 오판: ADA §303의 원 규정은 "6.4mm 초과~12.7mm 이하는 1:2 이하
--   **베벨일 때만** 허용"인데, 근거를 잃은 12.7이 marginal_value로 형상과 무관하게
--   적용돼 **수직 문턱 10mm에도 marginal**(=일부 기종 통과)이라는 거짓 완충 판정이 났다.
--   이제 완충 구간을 profile '{beveled,ramped,rounded}' 행으로 분리할 수 있고,
--   형상 미상(profile NULL)이면 그 행이 적용되지 않아 fail로 떨어진다.
--   → 유니크 키에 applies_profile이 들어간 이유도 이것이다(형상별 행 분리).
-- ★ unit NOT NULL: "선언만 되고 대조되지 않는 단위"를 닫는다. 쓰는 쪽이 단위를 반드시
--   명시해야 하고 트리거가 지표 단위와 대조한다(등판능력 30%를 unit 'deg' 지표에
--   집어넣던 경로가 여기서 막힌다).
create table if not exists robot_thresholds (
  id uuid primary key default gen_random_uuid(),
  ruleset_id uuid not null references robot_rulesets(id) on delete cascade,
  class_id uuid not null references robot_classes(id) on delete restrict,
  metric_id uuid not null references robot_metrics(id) on delete restrict,
  group_id uuid,                     -- NULL = 단독 규칙 / NOT NULL = 조합 규칙의 멤버
  mode robot_mode not null default '',
  applies_profile threshold_profile[] not null default '{}',
  comparator comparator_op not null, -- 관측값 <comparator> value 이면 pass
  value_type property_value_type not null default 'numeric',
  unit text not null,
  value double precision,
  bool_value boolean,
  marginal_value double precision,
  unknown_reason text,
  source_text text not null check (source_text <> ''),
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array'),
  created_at timestamptz not null default now(),
  unique (ruleset_id, class_id, metric_id, mode, applies_profile),
  -- MATCH SIMPLE: group_id가 NULL이면 검사를 건너뛴다(space_finishes와 같은 기법).
  foreign key (group_id, ruleset_id, class_id, mode)
    references threshold_groups(id, ruleset_id, class_id, mode) on delete cascade,
  -- ★ else false. property_value_type에 값을 더하고 이 CHECK를 안 고치면 그 타입이
  --   무검증 통과하는 것을 막는다(material_properties와 같은 이유).
  check (
    case value_type
      when 'numeric' then comparator in ('lte','lt','gte','gt') and bool_value is null
      when 'boolean' then comparator in ('eq','neq')
                          and value is null and marginal_value is null
      else false      -- 'text'는 판정 축이 아니다
    end
  ),
  check (
    case when unknown_reason is not null then num_nonnulls(value, bool_value) = 0
         else num_nonnulls(value, bool_value) = 1 end
  ),
  check (marginal_value is null or value is not null)
);

-- ★ 단위 대조 2/2: 임계값의 unit은 지표의 unit과 문자 그대로 같아야 한다.
--   "단위 변환"을 허용하지 않는다 — 단위가 다르면 별도 지표를 만드는 것이 정본이다.
create or replace function fn_robot_threshold_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_unit text; v_code text;
begin
  select rm.unit, rm.code into v_unit, v_code from robot_metrics rm where rm.id = new.metric_id;
  if new.unit <> v_unit then
    raise exception '임계값 단위 "%"가 지표 %의 단위 "%"와 다릅니다. 단위 변환은 하지 않습니다 - 단위마다 별도 지표를 만드세요.',
      new.unit, v_code, v_unit using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_robot_threshold_guard on robot_thresholds;
create trigger trg_robot_threshold_guard before insert or update on robot_thresholds
  for each row execute function fn_robot_threshold_guard();

-- =============================================================================
-- (5) 발주처 코드 매핑
-- F-10B는 재료가 아니라 "마감 사양 세트 ID"이고 LH 내부 일련번호다(F-14 하나가
-- 발코니·실외기실 두 실에 공유). 조회 키로 쓰면 다른 발주처에서 즉시 깨지므로
-- 표준 분류와 분리된 별도 층에 두고 project_code_layers 한 지점으로만 연결한다.
-- ★ layers를 jsonb가 아니라 테이블로 둔 이유: jsonb 안 material_id에는 FK를 못 걸고,
--   트리거 존재검사는 쓰기 시점 한 방향만 막는다(마감재를 지운 뒤엔 죽은 uuid가 남는다).
-- =============================================================================
create table if not exists code_systems (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,  -- NULL=발주처 표준 코드집(전역)
  code text not null, issuer text not null, name_ko text not null,
  revision text not null default '',
  source_text text not null check (source_text <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop index if exists code_systems_global_code;
drop index if exists code_systems_site_code;
create unique index code_systems_global_code on code_systems(code) where site_id is null and is_active;
create unique index code_systems_site_code on code_systems(site_id, code) where site_id is not null and is_active;

-- site_id nullable: 발주처 표준 평면 라이브러리는 실제 시공 현장이 아니므로
-- 가짜 sites 행을 만들게 하지 않는다.
create table if not exists drawings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,
  system_id uuid references code_systems(id) on delete restrict,
  doc_key text not null default '',   -- 도면 세트 키(한 현장에 세트가 둘 이상일 때)
  doc_no text not null, title text not null,
  revision text not null default '',
  drawn_on date,
  file_path text,                     -- 버킷-상대 경로만(001:118). 'data/' 접두·절대경로 금지
  source_text text not null check (source_text <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- ★ 도면 번호는 전역 네임스페이스가 아니다. 'A-101'·'AA-004'는 발주처를 가리지 않는
--   흔한 번호라 unique(doc_key, doc_no, revision) 하나로는 두 번째 발주처를 적재하는
--   순간 23505가 난다(project_codes는 unique(system_id, code_set, code)로 이미 격리돼
--   LH의 'C-8'과 SH의 'C-8'이 공존하는데 도면 층만 그 격리가 빠져 있었다).
--   → code_systems·robot_rulesets가 쓰는 "전역/현장 부분 유니크 2종" 관례를 복제하고,
--     발주처 축(system_id)을 키에 넣는다. system_id는 nullable이라 NULL끼리 서로 다르게
--     취급되는 것을 막으려고 coalesce로 고정 uuid에 접는다.
drop index if exists drawings_global_doc;
drop index if exists drawings_site_doc;
create unique index drawings_global_doc on drawings(
    coalesce(system_id, '00000000-0000-0000-0000-000000000000'::uuid), doc_key, doc_no, revision)
  where site_id is null;
create unique index drawings_site_doc on drawings(
    site_id, coalesce(system_id, '00000000-0000-0000-0000-000000000000'::uuid), doc_key, doc_no, revision)
  where site_id is not null;

create table if not exists project_codes (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references code_systems(id) on delete cascade,
  drawing_id uuid references drawings(id) on delete set null,
  code_set text not null default '',  -- ★ 한 도면 안에서도 코드 네임스페이스가 갈린다
                                      --   (4쪽 F-10B / 7쪽 기호 A~R / 9쪽 2·6 / 6쪽 AG·D-2)
  code text not null,
  kind project_code_kind not null,
  part_id uuid references finish_parts(id) on delete restrict,  -- 도면이 부위를 안 주면 NULL
  description text not null,          -- 도면 원문 그대로
  thickness_mm double precision, height_mm double precision, source_page int,
  raw jsonb not null default '{}' check (jsonb_typeof(raw) = 'object'),
  source_text text not null check (source_text <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (system_id, code_set, code)
);

-- confidence='unmapped' ⇔ material_id IS NULL 을 CHECK로 양방향 묶는다.
-- '패널히팅'처럼 마감재가 아닌 것이 BASE 칸에 오는 경우가 실재하므로 매핑 실패를
-- 정상 상태로 저장한다 — 적재 실패로 만들지 않는다.
create table if not exists project_code_layers (
  id uuid primary key default gen_random_uuid(),
  project_code_id uuid not null references project_codes(id) on delete cascade,
  role layer_role not null,
  layer_no int not null default 1,    -- 하부→상부. 도면 '/' 순서가 상하를 보장하지 않으면 note에
  material_id uuid references finish_materials(id) on delete restrict,
  confidence mapping_confidence not null,
  raw_text text not null,
  thickness_mm double precision,
  note text,
  created_at timestamptz not null default now(),
  unique (project_code_id, role, layer_no),
  check ((confidence = 'unmapped') = (material_id is null))
);

-- =============================================================================
-- (6) 공간 · 마감 · 인접
-- =============================================================================
-- ★ outline은 PostGIS가 아니라 jsonb다(어느 마이그레이션도 postgis를 켜지 않는다).
--   **링의 배열**이다: [ 외곽링, 구멍링, ... ] 이고 각 링은 [[x,y],...] (mm 정수, 도면 로컬 좌표계,
--   닫는 점 없음 — 마지막 점은 첫 점과 이어진다고 본다).
--   구멍이 필요한 이유: '벽체공용'은 실들을 둘러싼 띠라서 외곽링 하나로는 면적이 표현되지 않는다
--   (외곽만 쓰면 3.3236 m2 가 아니라 세대 전체 면적이 된다).
-- ⚠ area_m2는 outline에서 계산하지 않는다 — 도면 면적표가 발주처 정본이다.
--   다만 둘이 어긋나면 둘 중 하나가 틀린 것이므로 015 가 셰이스 공식으로 대조한다.
-- ⚠ fl_mm/sl_mm nullable: 대상 도면이 이미 모순을 담고 있다(평면 라벨 vs 주기13).
create table if not exists spaces (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references drawings(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,  -- 실측 위치와 입도가 달라 선택 연결
  name text not null,
  outline jsonb check (outline is null or jsonb_typeof(outline) = 'array'),
  area_m2 double precision,
  fl_mm double precision, sl_mm double precision, ceiling_height_mm double precision,
  conflict_note text,                 -- 원문 모순을 해소하지 않고 남기는 자리
  -- ★ C6: 이 실이 도면으로 확정된 것인지 추론된 것인지. 기본값이 'inferred'인 것이 핵심.
  basis evidence_basis not null default 'inferred',
  basis_note text,                    -- inferred면 "어느 도면의 무엇에서 왔는가"를 강제
  raw jsonb not null default '{}' check (jsonb_typeof(raw) = 'object'),
  source_text text not null check (source_text <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (drawing_id, name),
  constraint spaces_basis_note_check
    check (basis <> 'inferred' or (basis_note is not null and basis_note <> ''))
);
-- 멱등 보강(이미 배포된 DB용). 신규 DB는 위 create가 이미 만든다.
alter table spaces add column if not exists basis evidence_basis not null default 'inferred';
alter table spaces add column if not exists basis_note text;
do $$ begin
  alter table spaces add constraint spaces_basis_note_check
    check (basis <> 'inferred' or (basis_note is not null and basis_note <> ''));
exception when duplicate_object then null; when duplicate_table then null; end $$;

-- (material_id, part_id) 복합 FK가 material_parts를 참조해 부위 불일치를 막는다.
-- material_id NULL이면 MATCH SIMPLE로 검사를 건너뛰고, CHECK가 unmapped를 강제한다.
create table if not exists space_finishes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  part_id uuid not null references finish_parts(id) on delete restrict,
  role layer_role not null,
  layer_no int not null default 1,
  material_id uuid,
  project_code_id uuid references project_codes(id) on delete restrict,
  thickness_mm double precision,
  raw_text text not null default '',
  confidence mapping_confidence not null,
  source_text text not null check (source_text <> ''),
  created_at timestamptz not null default now(),
  unique (space_id, part_id, role, layer_no),
  -- ★ on update cascade: 부위 재편(예: 걸레받이를 벽 하위로 접기)은 material_parts의
  --   part_id를 옮기는 일인데, ON UPDATE 절이 없으면 NO ACTION이라 도면이 한 건이라도
  --   적재된 뒤에는 23503으로 막혔다. delete는 계속 restrict다 — 참조되는 조합을
  --   지우는 것은 여전히 사고다. ⚠ cascade가 FK는 풀어주지만
  --   unique(space_id, part_id, role, layer_no) 충돌까지 없애 주지는 않는다
  --   (같은 실에 이미 wall 층이 있으면 layer_no 재배치가 필요하다).
  foreign key (material_id, part_id) references material_parts(material_id, part_id)
    on update cascade on delete restrict,
  check ((confidence = 'unmapped') = (material_id is null))
);

-- ★★ C1 — 쌍 정규화 기준을 **랜덤 UUID에서 실 이름으로** 바꿨다.
--   이전 판은 check (space_a_id < space_b_id) + 시드의 least/greatest(a.id,b.id)였다.
--   id가 gen_random_uuid()라 a/b 배치가 적재마다 뒤집히고 step_mm(=b.FL−a.FL)의 부호가
--   따라 뒤집혔다. 실제 재현: 1회차 "거실/침실→발코니 −75", 2회차 "발코니→거실/침실 +75".
--   음수 단차는 lte 비교를 무조건 통과하므로 같은 도면·같은 파일이 적재 운에 따라
--   pass와 fail을 오갔다.
--   → 세 가지를 동시에 둔다:
--     (1) fn_space_adjacency_normalize 트리거가 (name, id) 순서로 a/b를 정렬하고
--         뒤집을 때 step_mm의 부호도 같이 뒤집는다. 이름은 적재마다 같으므로 결정적이다.
--         (uuid CHECK은 이 트리거로 대체된다 — 두 규칙은 양립할 수 없다.)
--     (2) step_abs_raw_mm 생성 컬럼 = abs(step_mm). 부호 있는 step_mm을 lte에 직접 넣으면
--         내려가는 단차가 전부 pass가 된다.
--         ⚠ **이 컬럼은 판정 입력이 아니다.** 판정 입력은 v_space_step.step_abs_mm 하나뿐이며,
--         그쪽은 믿을 수 없는 단차(원문 모순·추론분·FL 불일치)에서 NULL이 되어 'unknown'을 낸다.
--         기저 컬럼은 원값 보존용이라 그 걸러냄이 없다 — 이름을 _raw_로 달리해 혼동을 막는다.
--     (3) lower_space_id = 어느 실이 낮은가. 트리거가 부호에서 파생시킨다.
--         로봇은 올라갈 때와 내려갈 때가 다르므로 이 정보를 절대값에 흡수시키지 않는다.
create table if not exists space_adjacencies (
  id uuid primary key default gen_random_uuid(),
  space_a_id uuid not null references spaces(id) on delete cascade,
  space_b_id uuid not null references spaces(id) on delete cascade,
  kind adjacency_kind not null,
  label text not null default '',
  project_code_id uuid references project_codes(id) on delete restrict,  -- 창호일람표 코드
  clear_width_mm double precision,    -- ★ 도면에 없으면 NULL(개구부 치수를 대입하지 않는다)
  -- ★★ F5 — 유효 통과폭의 **상한** 칸. 도면에서 읽히는 수치(개구부 치수·제작치수·
  --   문틀 내측)는 전부 여기에만 들어간다. GROUND_TRUTH: 유효 통과폭은 이 도면의 어떤
  --   개구부도 확정 불가이고 제작치수는 상한일 뿐이다. 컬럼도 CHECK도 없던 동안
  --   6쪽 창호일람표의 제작치수(DPW 1,990 / D-2 1,090 / SD 690)를 유효폭 칸에 그대로
  --   넣는 것을 아무것도 막지 못했고, 넣는 순간 상업용 청소로봇(gte 1400)이 pass 였다.
  --   → 아래 CHECK가 "상한을 먼저 적지 않으면 유효폭을 적을 수 없고, 적더라도 상한보다
  --     반드시 작아야 한다"를 선언적으로 강제한다. 제작치수 자신을 유효폭 칸에 넣는
  --     경로가 구조적으로 닫힌다(1990 < 959 가 거짓이므로 23514).
  clear_width_max_mm double precision,
  -- ⚠ step_mm은 부호 있는 값이다(b − a). 판정에 직접 넣지 마라.
  --   판정 입력은 v_space_step.step_abs_mm 이지 이 테이블의 어떤 컬럼도 아니다.
  step_mm double precision,           -- b - a. NULL = 도면으로 확정 불가
  step_abs_raw_mm double precision generated always as (abs(step_mm)) stored,
  lower_space_id uuid references spaces(id) on delete cascade,  -- 트리거가 채운다
  gap_width_mm double precision,
  profile threshold_profile,
  -- ★ C6: 이 인접이 도면으로 확정된 것인지 추론된 것인지 + 그 근거
  basis evidence_basis not null default 'inferred',
  basis_note text,
  raw jsonb not null default '{}' check (jsonb_typeof(raw) = 'object'),
  source_text text not null check (source_text <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_a_id, space_b_id, kind, label),
  check (space_a_id <> space_b_id),
  check (lower_space_id is null or lower_space_id in (space_a_id, space_b_id)),
  constraint space_adjacencies_basis_note_check
    check (basis <> 'inferred' or (basis_note is not null and basis_note <> '')),
  -- ★★ F5 — 유효폭은 상한 아래에서만 존재할 수 있다(위 clear_width_max_mm 주석 참조).
  constraint space_adjacencies_clear_width_bound_check
    check (clear_width_mm is null
           or (clear_width_max_mm is not null and clear_width_mm < clear_width_max_mm)),
  -- ★★ F6 — 판정 입력 3종의 값 범위. 제약이 하나도 없어 Infinity·음수가 그대로 저장되고
  --   gte 비교에서 pass 를 냈다(clear 'Infinity' → 전 등급 pass / gap −5 → 전 등급 pass).
  --   NaN 도 여기서 걸린다(PG 정렬에서 NaN 은 최대값이라 `< 'Infinity'` 가 거짓이다).
  constraint space_adjacencies_clear_width_range_check
    check (clear_width_mm is null
           or (clear_width_mm > 0 and clear_width_mm < 'Infinity'::double precision)),
  constraint space_adjacencies_clear_width_max_range_check
    check (clear_width_max_mm is null
           or (clear_width_max_mm > 0 and clear_width_max_mm < 'Infinity'::double precision)),
  constraint space_adjacencies_gap_width_range_check
    check (gap_width_mm is null
           or (gap_width_mm >= 0 and gap_width_mm < 'Infinity'::double precision)),
  constraint space_adjacencies_step_range_check
    check (step_mm is null
           or (step_mm > '-Infinity'::double precision and step_mm < 'Infinity'::double precision))
);
-- 멱등 보강(이미 배포된 DB용) + 낡은 uuid 순서 CHECK 제거.
alter table space_adjacencies add column if not exists lower_space_id uuid references spaces(id) on delete cascade;
alter table space_adjacencies add column if not exists basis evidence_basis not null default 'inferred';
alter table space_adjacencies add column if not exists basis_note text;
-- 이미 배포된 DB가 옛 이름(step_abs_mm)을 갖고 있으면 이름부터 바꾼다. 판정 입력으로 오인되는
-- 것이 이 컬럼의 유일한 위험이므로, 새로 만들기 전에 기존 것을 반드시 개명한다.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='space_adjacencies'
                and column_name='step_abs_mm') then
    alter table space_adjacencies rename column step_abs_mm to step_abs_raw_mm;
  end if;
end $$;
alter table space_adjacencies add column if not exists step_abs_raw_mm double precision
  generated always as (abs(step_mm)) stored;
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.space_adjacencies'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%space_a_id < space_b_id%'
  loop
    execute format('alter table space_adjacencies drop constraint %I', r.conname);
  end loop;
end $$;
do $$ begin
  alter table space_adjacencies add constraint space_adjacencies_basis_note_check
    check (basis <> 'inferred' or (basis_note is not null and basis_note <> ''));
exception when duplicate_object then null; end $$;
-- ★★ F5·F6 멱등 보강(이미 배포된 DB용). 신규 DB는 위 create가 이미 만든다.
alter table space_adjacencies add column if not exists clear_width_max_mm double precision;
do $$ begin
  alter table space_adjacencies add constraint space_adjacencies_clear_width_bound_check
    check (clear_width_mm is null
           or (clear_width_max_mm is not null and clear_width_mm < clear_width_max_mm));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table space_adjacencies add constraint space_adjacencies_clear_width_range_check
    check (clear_width_mm is null
           or (clear_width_mm > 0 and clear_width_mm < 'Infinity'::double precision));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table space_adjacencies add constraint space_adjacencies_clear_width_max_range_check
    check (clear_width_max_mm is null
           or (clear_width_max_mm > 0 and clear_width_max_mm < 'Infinity'::double precision));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table space_adjacencies add constraint space_adjacencies_gap_width_range_check
    check (gap_width_mm is null
           or (gap_width_mm >= 0 and gap_width_mm < 'Infinity'::double precision));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table space_adjacencies add constraint space_adjacencies_step_range_check
    check (step_mm is null
           or (step_mm > '-Infinity'::double precision and step_mm < 'Infinity'::double precision));
exception when duplicate_object then null; end $$;

-- ★ C1 정규화 트리거. CHECK은 다른 테이블(spaces.name)을 못 읽으므로 트리거다.
--   (name, id) 복합 순서를 쓰는 이유: 같은 도면 안에서 name은 유니크하므로 name만으로
--   결정되고, 도면이 다른 두 실이 섞이는 병리적 경우에만 id가 tie-break로 쓰인다.
create or replace function fn_space_adjacency_normalize()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_a_name text; v_b_name text; v_tmp uuid;
begin
  if new.space_a_id = new.space_b_id then
    raise exception '인접은 서로 다른 두 실이어야 합니다.' using errcode = '23514';
  end if;
  select s.name into v_a_name from spaces s where s.id = new.space_a_id;
  select s.name into v_b_name from spaces s where s.id = new.space_b_id;
  if v_a_name is null or v_b_name is null then
    raise exception '인접이 참조하는 실을 찾을 수 없습니다.' using errcode = '23503';
  end if;
  -- (name, id) 가 큰 쪽이 b가 되도록 뒤집는다. step_mm은 b−a 이므로 부호도 함께 뒤집는다.
  -- collate "C": DB 로케일이 달라도 같은 순서가 나오도록 바이트 순서로 못박는다.
  if (v_a_name collate "C", new.space_a_id) > (v_b_name collate "C", new.space_b_id) then
    v_tmp := new.space_a_id;
    new.space_a_id := new.space_b_id;
    new.space_b_id := v_tmp;
    new.step_mm := - new.step_mm;   -- NULL이면 NULL 그대로
  end if;
  -- 낮은 쪽은 저장된 부호에서 파생시킨다(입력값을 신뢰하지 않는다).
  new.lower_space_id := case
    when new.step_mm is null or new.step_mm = 0 then null
    when new.step_mm > 0 then new.space_a_id     -- b가 높다 → a가 낮다
    else new.space_b_id end;
  return new;
end $$;
drop trigger if exists trg_space_adjacency_normalize on space_adjacencies;
create trigger trg_space_adjacency_normalize before insert or update on space_adjacencies
  for each row execute function fn_space_adjacency_normalize();

-- ★★ C4 — subject='space' 지표의 관측값 저장소.
--   이전 판에는 이 자리가 아예 없었다: spaces에 대응 컬럼이 하나도 없고 EAV도 없어
--   subject='space' 지표 6종(평탄도·경사·회전폭·권장경로폭·승강기 카 폭/깊이)에 걸린
--   임계값 12행이 **영구히 관측 불가능한 규칙**이었다. 그 결과 "새 지표 추가 = INSERT"라는
--   이 설계의 핵심 주장이 subject='finish' 축에서만 참이었다.
--   구조는 material_properties를 그대로 복제한다:
--     - (metric_id, subject) 복합 FK로 robot_metrics(id, subject)에 잠가 space 지표만 받는다
--     - unknown_reason으로 "조사했으나 값이 없다"를 1급으로 남긴다
--     - unit을 지표 단위와 대조한다(C5와 같은 이유·같은 errcode)
--   ※ subject='adjacency' 지표 3종(clear_width_mm·gap_width_mm·step_height_mm)은
--     space_adjacencies에 이미 대응 컬럼이 있으므로 대칭 테이블을 만들지 않는다(YAGNI).
create table if not exists space_observations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  metric_id uuid not null,
  subject metric_subject not null default 'space',
  test_cond test_condition not null default '',
  value_type property_value_type not null default 'numeric',
  unit text not null default '',
  num_value double precision,
  bool_value boolean,
  unknown_reason text,
  basis evidence_basis not null default 'inferred',
  basis_note text,
  source_text text not null check (source_text <> ''),
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array'),
  created_at timestamptz not null default now(),
  unique (space_id, metric_id, test_cond),
  foreign key (metric_id, subject) references robot_metrics(id, subject) on delete restrict,
  check (subject = 'space'),
  -- else false. property_value_type에 값을 더하고 이 CHECK를 안 고치면 하드 실패한다.
  check (
    case when unknown_reason is not null then num_nonnulls(num_value, bool_value) = 0
         else case value_type
                when 'numeric' then num_value  is not null and bool_value is null
                when 'boolean' then bool_value is not null and num_value  is null
                else false
              end
    end
  ),
  constraint space_observations_basis_note_check
    check (basis <> 'inferred' or (basis_note is not null and basis_note <> ''))
);

-- 단위 대조 3/3 — 관측값(space) 축. robot_metrics.unit과 문자 그대로 같아야 한다.
create or replace function fn_space_observation_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_unit text; v_code text;
begin
  select rm.unit, rm.code into v_unit, v_code from robot_metrics rm where rm.id = new.metric_id;
  if v_unit is not null and coalesce(new.unit, '') <> v_unit then
    raise exception '관측값 단위 "%"가 지표 %의 단위 "%"와 다릅니다. 단위 변환은 하지 않습니다 - 단위마다 별도 지표를 만드세요.',
      new.unit, v_code, v_unit using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_space_observation_guard on space_observations;
create trigger trg_space_observation_guard before insert or update on space_observations
  for each row execute function fn_space_observation_guard();

-- =============================================================================
-- (7) 평가 결과 — 재현성의 실질은 version이 아니라 applied_* jsonb 스냅샷이다
--   (001:158이 저장소에서 실제로 작동 검증된 방식. criteria 버저닝은 2년간 미행사 — C9).
-- ★ applied_materials까지 스냅샷: 판정은 기준값뿐 아니라 마감재 물성에도 의존한다.
-- =============================================================================
create table if not exists passability_assessments (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references drawings(id) on delete cascade,
  ruleset_id uuid not null references robot_rulesets(id) on delete restrict,
  class_id uuid not null references robot_classes(id) on delete restrict,
  mode robot_mode not null default '',
  applied_ruleset jsonb not null,
  applied_materials jsonb not null default '{}' check (jsonb_typeof(applied_materials) = 'object'),
  engine_version text,
  overall_verdict passability_verdict not null default 'unknown',
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  artifacts_dir text,                 -- 산출물은 디렉터리 하나만(001:142-152)
  auto_summary text, user_summary text,
  is_current boolean not null default false,
  deleted_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
-- ★ ruleset_id가 키에 있어야 한다. 없으면 같은 도면·등급·모드에 대해 전역 baseline
--   결과와 현장 특별기준 결과를 동시에 is_current로 둘 수 없다(23505).
--   fn_resolve_ruleset은 현장에 여러 기준세트를 반환할 수 있는데 그중 하나만 current가
--   되던 상태였다 — "어느 기준으로 본 현재 결과인가"가 결과의 정체성의 일부다.
drop index if exists passability_assessments_current;
create unique index passability_assessments_current
  on passability_assessments(drawing_id, ruleset_id, class_id, mode)
  where is_current and deleted_at is null;

-- (metric_id, subject) 복합 FK + CHECK로 "space 지표인데 adjacency에 붙은 판정"을 차단.
-- ★ mode를 유니크 키에 넣어 같은 지표를 주행/청소 두 번 기록할 수 있게 한다
--   (탈락안 3은 이 자리가 빠져 자기 스키마 안에서 모순이었다).
create table if not exists assessment_findings (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references passability_assessments(id) on delete cascade,
  metric_id uuid not null,
  subject metric_subject not null,
  mode robot_mode not null default '',        -- 로봇 운용 모드
  observed_cond test_condition not null default '',  -- 관측값의 시험 조건(wet/dry/barefoot)
  space_id uuid references spaces(id) on delete cascade,
  adjacency_id uuid references space_adjacencies(id) on delete cascade,
  space_finish_id uuid references space_finishes(id) on delete cascade,
  threshold_id uuid references robot_thresholds(id) on delete restrict,
  observed_value double precision, threshold_value double precision,
  observed_bool boolean, threshold_bool boolean,
  comparator comparator_op,
  verdict passability_verdict not null default 'unknown',
  reason_text text not null default '',
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (metric_id, subject) references robot_metrics(id, subject) on delete restrict,
  check ((subject = 'space'     and space_id        is not null and adjacency_id is null and space_finish_id is null)
      or (subject = 'adjacency' and adjacency_id    is not null and space_id     is null and space_finish_id is null)
      or (subject = 'finish'    and space_finish_id is not null and space_id     is null and adjacency_id    is null)),
  -- ★ 수치 판정 한 쌍 또는 boolean 판정 한 쌍. 'unknown'이면 둘 다 비어 있어도 된다.
  check (verdict = 'unknown'
         or (comparator is not null
             and ((observed_value is not null and threshold_value is not null)
               or (observed_bool  is not null and threshold_bool  is not null))))
  -- ★★ F7 의 정합 CHECK는 fn_eval_threshold 가 정의된 (8)절 끝에서 alter 로 붙인다
  --   (이 자리에서는 함수가 아직 없다).
);
drop index if exists findings_space;
drop index if exists findings_adjacency;
drop index if exists findings_finish;
create unique index findings_space
  on assessment_findings(assessment_id, metric_id, mode, space_id) where space_id is not null;
create unique index findings_adjacency
  on assessment_findings(assessment_id, metric_id, mode, adjacency_id) where adjacency_id is not null;
-- ★ observed_cond가 키에 있어야 같은 마감의 wet/dry 두 판정을 동시에 남길 수 있다
--   (mode는 이미 로봇 운용 모드가 점유했다. 이것이 두 축을 가른 실익이다).
create unique index findings_finish
  on assessment_findings(assessment_id, metric_id, mode, observed_cond, space_finish_id)
  where space_finish_id is not null;

-- =============================================================================
-- (8) 뷰 · 함수
-- ⚠ 이 저장소의 첫 뷰다(010_scan_height_view.sql은 이름과 달리 컬럼 추가뿐 — grep 확인).
--   security_invoker=true를 반드시 붙인다. 없으면 뷰가 소유자 권한으로 하위 테이블을
--   읽어 RLS를 우회한다(PG15+ 옵션. Supabase 관리형은 15 이상. 15 미만이면 이 절이 실패).
-- =============================================================================
create or replace view v_finish_taxonomy with (security_invoker = true) as
with recursive fam as (
  select f.id, f.parent_id, f.code, f.name_ko, f.basis, f.kcs_code, f.sort_order,
         1 as depth, f.name_ko::text as path_ko, f.code::text as path_code
    from material_families f where f.parent_id is null and f.is_active
  union all
  select c.id, c.parent_id, c.code, c.name_ko, c.basis, c.kcs_code, c.sort_order,
         p.depth + 1, p.path_ko || ' > ' || c.name_ko, p.path_code || '.' || c.code
    from material_families c join fam p on p.id = c.parent_id where c.is_active
)
select p.code as part_code, p.name_ko as part_name, p.sort_order as part_order,
       fam.code as family_code, fam.name_ko as family_name, fam.depth as family_depth,
       fam.path_ko as family_path, fam.basis, fam.kcs_code,
       m.code as material_code, m.name_ko as material_name, m.role,
       m.typical_thickness_mm, m.thickness_min_mm, m.thickness_max_mm, m.ks_codes, mp.is_typical,
       -- ★ id 3종을 끝에 덧붙인다(or replace는 컬럼 추가를 맨 뒤에서만 허용한다).
       --   없을 때는 뷰를 붙이는 순간 코드 문자열 조인이 강요됐다.
       p.id as part_id, m.id as material_id, fam.id as family_id, m.variant_of
  from material_parts mp
  join finish_parts p     on p.id = mp.part_id
  join finish_materials m on m.id = mp.material_id
  join fam                on fam.id = m.family_id
 where p.is_active and m.is_active;

-- ★ 적재된 도면의 답이 마스터 토글로 바뀌면 안 된다.
--   v_finish_taxonomy는 is_active로 걸러 "지금 쓸 수 있는 카탈로그"를 답하는데,
--   걸레받이를 벽 하위로 접으려고 finish_parts.is_active=false로 내리는 순간
--   이미 적재된 26형 도면의 걸레받이 마감이 트리에서 통째로 증발했다
--   (space_finishes에는 행이 그대로 남아 있으므로 "DB 트리"와 "실 마감"이 다른 답을 낸다).
--   → 과거 도면 조회는 이 뷰를 쓴다. 활성 여부는 컬럼으로 그대로 드러낸다.
create or replace view v_finish_taxonomy_all with (security_invoker = true) as
with recursive fam as (
  select f.id, f.parent_id, f.code, f.name_ko, f.basis, f.kcs_code, f.sort_order,
         1 as depth, f.name_ko::text as path_ko, f.code::text as path_code
    from material_families f where f.parent_id is null
  union all
  select c.id, c.parent_id, c.code, c.name_ko, c.basis, c.kcs_code, c.sort_order,
         p.depth + 1, p.path_ko || ' > ' || c.name_ko, p.path_code || '.' || c.code
    from material_families c join fam p on p.id = c.parent_id
)
select p.code as part_code, p.name_ko as part_name, p.sort_order as part_order,
       fam.code as family_code, fam.name_ko as family_name, fam.depth as family_depth,
       fam.path_ko as family_path, fam.basis, fam.kcs_code,
       m.code as material_code, m.name_ko as material_name, m.role,
       m.typical_thickness_mm, m.thickness_min_mm, m.thickness_max_mm, m.ks_codes, mp.is_typical,
       p.id as part_id, m.id as material_id, fam.id as family_id, m.variant_of,
       p.is_active as part_is_active, m.is_active as material_is_active
  from material_parts mp
  join finish_parts p     on p.id = mp.part_id
  join finish_materials m on m.id = mp.material_id
  join fam                on fam.id = m.family_id;

-- ★★ F1·F3 — step_abs_mm 는 **판정 입력**이다. 그래서 이 뷰는 "믿을 수 없는 단차"를
--   숫자로 내보내지 않는다(NULL → fn_eval_threshold 계약상 'unknown').
--   원값은 잃지 않는다: 맨 뒤 step_abs_raw_mm 에 그대로 있고, 왜 판정에서 빠졌는지는
--   step_unevaluable_reason 에 문장으로 남는다.
--
--   [F1] 모순 위에 얹힌 단차는 pass 를 내면 안 된다. '발코니-실외기실 철제여닫이문'은
--     basis='inferred' · fl_disputed=true · touches_inferred_space=true 인데 단차 0 으로
--     저장돼 serving-delivery(≤5) / industrial-amr(≤20) / domestic-cleaner(≤15) /
--     commercial-cleaner(clean ≤8, drive ≤10) 에서 전부 pass 가 나왔다.
--     그 0 은 발코니 FL 원문 모순(주기13 높은턱 80 / 낮은턱 35) 중 낮은턱을 임의로 고른
--     결과이고, 높은턱 분기면 45mm 라 pass 가 fail 로 뒤집힌다.
--   ★ 두 분기를 다 계산해 나쁜 쪽을 채택하는 길을 택하지 않은 이유:
--     그러려면 실외기실이 어느 분기를 따라가는지를 DB가 알아야 하는데, 실외기실 FL 자체가
--     1쪽 평면 라벨 하나에 얹힌 추론분(basis='inferred')이라 "높은턱이면 45" 역시 또 하나의
--     추론이다. 근거 없는 수치를 새로 지어내는 대신 판정을 'unknown'으로 둔다 —
--     이 설계가 unknown 을 1급 값으로 둔 이유가 바로 이것이다("근거 없으면 통과"도,
--     "근거 없으면 지어낸 값으로 불통과"도 아니다).
--   ★ 조건을 fl_disputed 단독으로 넓히지 않은 이유: 욕실문(80)·주방-욕실(80)·욕실-현관(50)·
--     거실-발코니(75)도 fl_disputed 지만 전부 도면 확정 인접이고 어느 분기를 골라도 fail 이다.
--     그 fail 들을 unknown 으로 지우는 것은 옳은 답을 없애는 것이다. 판정에서 빼는 것은
--     "모순 FL 위에 있으면서 인접 자체도 도면으로 확정되지 않은" 단차뿐이다.
--
--   [F3] step_mm 과 두 실의 fl_mm 을 정합시키는 제약이 없고, 옛 뷰는
--     coalesce(a.step_mm, sb.fl_mm - sa.fl_mm) 로 **낡은 저장값을 우선**했다.
--     원문 모순을 해소해 spaces.fl_mm 을 정정하면(예: 욕실을 주기13 FL+20 으로) 단차는
--     80 그대로 남고 뷰가 그 80 을 답했다(FL 차이는 90 인데). 저장값과 FL 차이가
--     둘 다 있으면서 어긋나면 그 단차는 판정 입력이 아니다.
create or replace view v_space_step with (security_invoker = true) as
with base as (
  select a.id, a.kind, a.label, sa.drawing_id, a.space_a_id, a.space_b_id,
         sa.name as a_name, sb.name as b_name,
         a.clear_width_mm, a.gap_width_mm, a.profile, a.lower_space_id, a.basis, a.basis_note,
         a.step_mm as stored_step, (sb.fl_mm - sa.fl_mm) as fl_step,
         (sa.conflict_note is not null or sb.conflict_note is not null) as fl_disputed,
         (sa.basis = 'inferred' or sb.basis = 'inferred')               as touches_inferred
    from space_adjacencies a
    join spaces sa on sa.id = a.space_a_id
    join spaces sb on sb.id = a.space_b_id
), calc as (
  select b.*, coalesce(b.stored_step, b.fl_step) as raw_step,
         case
           when b.fl_disputed and (b.basis = 'inferred' or b.touches_inferred)
             then '원문 모순 FL 위에 있고 인접(또는 접한 실) 자체도 도면 확정이 아니다 - 어느 분기를 고르느냐로 판정이 뒤집히므로 판정 입력이 아니다'
           when b.stored_step is not null and b.fl_step is not null
                and b.stored_step <> b.fl_step
             then '저장된 단차가 두 실의 FL 차이와 어긋난다 - FL 정정 뒤 갱신되지 않은 낡은 값이다'
         end as unevaluable_reason
    from base b
)
select c.id as adjacency_id, c.kind, c.label, c.drawing_id,
       c.space_a_id, c.space_b_id, c.a_name as space_a_name, c.b_name as space_b_name,
       c.clear_width_mm, c.gap_width_mm, c.profile,
       case when c.unevaluable_reason is null then c.raw_step end       as step_mm,
       case when c.unevaluable_reason is null then abs(c.raw_step) end  as step_abs_mm,
       (c.stored_step is null)                                          as step_is_derived,
       (c.raw_step is null or c.unevaluable_reason is not null)         as step_unknown,
       -- ↓ or replace는 컬럼 추가를 맨 뒤에서만 허용한다.
       -- ★ C1: 어느 실이 낮은가. step_abs_mm로 판정하되 방향은 여기서 읽는다.
       --   방향 정보는 판정에서 빠진 행에서도 잃지 않는다(원값 기준으로 답한다).
       c.lower_space_id,
       case c.raw_step when 0 then null
            else case when c.raw_step > 0 then c.a_name else c.b_name end
       end                                                              as lower_space_name,
       -- ★ C6: 이 단차가 **원문 모순 중 한 분기를 임의로 고른 FL**에서 파생됐는가.
       --   발코니(주기13 높은턱 80 / 낮은턱 35)·욕실(주기13 SL-60)이 여기 걸린다.
       --   '단차 0 → pass'가 '단차 0(분쟁 중인 FL에서 파생) → 그대로 믿지 말 것'이 된다.
       c.fl_disputed,
       c.basis, c.basis_note,
       c.touches_inferred                                               as touches_inferred_space,
       -- ↓ F1·F3 로 덧붙인 두 축. 원값과 그 사유는 판정에서 빠져도 보존된다.
       abs(c.raw_step)                                                  as step_abs_raw_mm,
       c.unevaluable_reason                                             as step_unevaluable_reason
  from calc c;

-- fn_resolve_criteria(007:53-63)와 같은 오버라이드 시맨틱.
-- ⚠ 내부 서브쿼리 r2에도 스코프 조건이 정확히 대응해야 한다(007:65-67의 실제 함정).
create or replace function fn_resolve_ruleset(p_site_id uuid)
returns setof robot_rulesets language sql stable as $$
  select * from robot_rulesets
   where is_active
     and (site_id = p_site_id
          or (site_id is null
              and not exists (select 1 from robot_rulesets r2
                               where r2.is_active and r2.site_id = p_site_id)))
   order by is_default desc, code;
$$;

create or replace function fn_ruleset_snapshot(p_ruleset_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'ruleset_id', rs.id, 'ruleset', to_jsonb(rs) - 'id', 'captured_at', now(),
    'thresholds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'class', rc.code, 'metric', rm.code, 'unit', rm.unit, 'subject', rm.subject,
               'measurability', rm.measurability, 'mode', rt.mode, 'comparator', rt.comparator,
               'value', rt.value, 'marginal_value', rt.marginal_value,
               'unknown_reason', rt.unknown_reason, 'source_text', rt.source_text)
             order by rc.code, rm.code, rt.mode)
        from robot_thresholds rt
        join robot_classes rc on rc.id = rt.class_id
        join robot_metrics rm on rm.id = rt.metric_id
       where rt.ruleset_id = rs.id), '[]'::jsonb))
    from robot_rulesets rs where rs.id = p_ruleset_id;
$$;

-- ★ 관측값이나 임계값이 NULL이면 'unknown'. "근거 없으면 통과"로 흘리지 않는다.
create or replace function fn_eval_threshold(
  p_value double precision, p_op comparator_op,
  p_limit double precision, p_marginal double precision default null)
returns passability_verdict language sql immutable as $$
  select case
    when p_value is null or p_limit is null then 'unknown'
    when p_op = 'lte' then case when p_value <= p_limit then 'pass'
      when p_marginal is not null and p_value <= p_marginal then 'marginal' else 'fail' end
    when p_op = 'lt'  then case when p_value <  p_limit then 'pass'
      when p_marginal is not null and p_value <  p_marginal then 'marginal' else 'fail' end
    when p_op = 'gte' then case when p_value >= p_limit then 'pass'
      when p_marginal is not null and p_value >= p_marginal then 'marginal' else 'fail' end
    when p_op = 'gt'  then case when p_value >  p_limit then 'pass'
      when p_marginal is not null and p_value >  p_marginal then 'marginal' else 'fail' end
    else 'unknown'
  end::passability_verdict;
$$;

-- ★ boolean 물성 판정. 수치 비교로 환원되지 않는 축(저반사 표면 등)이 실재하므로
--   같은 이름의 오버로드로 둔다. eq/neq 외의 연산자는 boolean에 의미가 없어 'unknown'
--   (robot_thresholds의 CHECK가 애초에 그런 행의 저장을 막는다).
create or replace function fn_eval_threshold(
  p_value boolean, p_op comparator_op, p_limit boolean)
returns passability_verdict language sql immutable as $$
  select case
    when p_value is null or p_limit is null then 'unknown'
    when p_op = 'eq'  then case when p_value =  p_limit then 'pass' else 'fail' end
    when p_op = 'neq' then case when p_value <> p_limit then 'pass' else 'fail' end
    else 'unknown'
  end::passability_verdict;
$$;

-- ★★ F7 — assessment_findings.verdict 와 저장된 값의 정합 가드.
--   (7)절의 옛 CHECK 는 "값 한 쌍이 있는가"만 봤고 값과 판정이 서로 맞는지는 보지 않았다.
--   그래서 80mm 단차를 lte 5mm 로 재고 verdict='pass' 로 저장하는 것이 그대로 통과했고,
--   그 거짓 pass 가 보고서 테이블에 남았다 — 계산(fn_eval_threshold)은 옳은데 결과를
--   기록하는 자리에 문지기가 없었다.
-- ⚠ CHECK 가 아니라 트리거인 이유 2가지:
--   (1) 이 파일의 관례다(fn_material_property_guard·fn_robot_metric_guard·
--       fn_robot_threshold_guard 전부 트리거 + errcode 23514).
--   (2) 사용자 정의 함수를 부르는 CHECK 는 pg_dump 가 CREATE TABLE 안에 인라인으로 뱉는데
--       함수는 그보다 뒤에 복원돼 restore 가 깨진다. 판정 로직을 CHECK 에 넣지 않는다.
-- ⚠ marginal_value 는 findings 컬럼에 없다. 그러나 marginal 은 정의상 **엄격 비교가 fail 인
--   구간**에서만 나오므로, 완충폭을 몰라도 "marginal 인데 엄격 비교가 pass" 는 거짓임을 안다.
--   → verdict='pass'/'fail' 은 정확 일치, 'marginal' 은 엄격 비교가 fail 일 것만 요구한다.
create or replace function fn_assessment_finding_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_strict passability_verdict;
begin
  if new.verdict = 'unknown' then
    return new;   -- 판정 불가는 값이 비어 있어도 된다((7)절 CHECK 가 이미 형태를 본다)
  end if;
  if new.observed_value is not null and new.threshold_value is not null then
    v_strict := fn_eval_threshold(new.observed_value, new.comparator, new.threshold_value);
  elsif new.observed_bool is not null and new.threshold_bool is not null then
    v_strict := fn_eval_threshold(new.observed_bool, new.comparator, new.threshold_bool);
  else
    return new;   -- 값 한 쌍이 없는 경우는 (7)절 CHECK 가 이미 막는다
  end if;

  if new.verdict = v_strict then
    return new;
  end if;
  -- 완충 구간: 엄격 비교가 fail 일 때만 marginal 일 수 있다(완충폭은 여기 저장되지 않는다).
  if new.verdict = 'marginal' and v_strict = 'fail' then
    return new;
  end if;

  raise exception '판정 %(가) 저장된 값과 어긋납니다. 관측 % % 임계 % 이면 판정은 % 입니다.',
    new.verdict, coalesce(new.observed_value::text, new.observed_bool::text),
    new.comparator, coalesce(new.threshold_value::text, new.threshold_bool::text), v_strict
    using errcode = '23514';
end $$;
drop trigger if exists trg_assessment_finding_guard on assessment_findings;
create trigger trg_assessment_finding_guard before insert or update on assessment_findings
  for each row execute function fn_assessment_finding_guard();

-- ★ 등급 상속 + 형상별 규칙 선택. robot_classes.parent_id가 선언만 되고 아무 데서도
--   읽히지 않던 것을 여기서 쓴다(계단등반형처럼 기존 등급의 자식으로 두고 다른 지표만
--   덮어쓰는 등급이 실제로 필요하다).
--   선택 규칙: 같은 지표에 후보가 여럿이면 (1) 가장 가까운 조상이 이기고
--             (2) 그 등급 안에서 형상 특정 행이 형상 무관 행을 이긴다.
--   p_profile이 NULL(=문턱 형상 미상)이면 형상 특정 행은 **적용되지 않는다** —
--   "베벨일 때만 허용"인 완충 구간이 형상 미상에까지 번지지 않게 하는 것이 핵심이다.
-- ★★ F4 — 정렬을 (형상 특정성 → 깊이) 에서 (깊이 → 형상 특정성) 으로 바꿨다.
--   옛 정렬은 형상 특정성을 등급 상속 깊이보다 앞에 세워서, 자식 등급이 자기 지표를
--   더 엄격하게 선언해도(step_height lte 5, 형상 무관) 부모에 그 지표의 형상 조건부 행이
--   하나라도 있으면(serving-delivery 의 '{beveled,ramped,rounded}' marginal 12.7)
--   **부모의 관대한 값이 이겼다**: 자식 등급에 profile='beveled' 로 물으면 10mm 문턱이
--   fail 이 아니라 marginal 로 나왔다. 등급 상속의 요점은 "자식이 덮어쓴다"이므로
--   깊이가 먼저다. 형상 특정성은 같은 등급 안에서의 타이브레이커로 남는다
--   (그래서 부모만 규칙을 가진 지표는 여전히 형상별로 갈린다 — A11 이 그 축이다).
-- ★★ F2 — 모드 폴백. rt.mode = p_mode 는 정확 일치라 폴백이 없었고, 요청 모드에 행이
--   0건이면 판정 대상 자체가 생성되지 않아 fail 도 안 나는 조용한 통과였다
--   (commercial-cleaner 는 drive/clean 만, domestic-cleaner 는 '' 만 가진다).
--   → 요청 모드에 그 등급 계보의 행이 하나도 없으면 robot_classes.default_mode 로 되돌린다.
--     어느 모드가 실제로 쓰였는지는 반환 행의 mode 컬럼에 그대로 드러난다(조용하지 않다).
create or replace function fn_resolve_thresholds(
  p_ruleset_id uuid, p_class_id uuid,
  p_mode robot_mode default '', p_profile threshold_profile default null)
returns setof robot_thresholds language sql stable as $$
  with recursive chain as (
    select rc.id, rc.parent_id, 0 as depth from robot_classes rc where rc.id = p_class_id
    union all
    select p.id, p.parent_id, c.depth + 1
      from robot_classes p join chain c on p.id = c.parent_id
  ), eff as (
    select case
             when exists (select 1 from robot_thresholds rt join chain ch on ch.id = rt.class_id
                           where rt.ruleset_id = p_ruleset_id and rt.mode = p_mode)
               then p_mode
             else (select rc.default_mode from robot_classes rc where rc.id = p_class_id)
           end as mode
  ), cand as (
    select rt.id, row_number() over (
             partition by rt.metric_id
             order by ch.depth, (rt.applies_profile = '{}')::int, rt.created_at) as rn
      from robot_thresholds rt
      join chain ch on ch.id = rt.class_id
      left join threshold_groups tg on tg.id = rt.group_id
     where rt.ruleset_id = p_ruleset_id
       and rt.mode = (select mode from eff)
       and (rt.applies_profile = '{}'
            or (p_profile is not null and p_profile = any (rt.applies_profile)))
       -- ★ C3: 그룹 멤버는 **그룹의** 형상 게이트도 통과해야 한다. 이 조건이 없을 때
       --   applies_profile='{stair}'로 선언한 계단 조합 규칙의 라이저 임계값(lte 200)이
       --   형상 미상(profile NULL)인 현관 문턱 25mm에 그대로 적용돼 pass가 났다.
       and (tg.id is null
            or tg.applies_profile = '{}'
            or (p_profile is not null and p_profile = any (tg.applies_profile)))
  )
  select rt.* from robot_thresholds rt join cand on cand.id = rt.id where cand.rn = 1;
$$;

-- ★ 조합 규칙 판정. p_observed는 {"지표코드": 값, ...} 형태의 관측 묶음이다.
--   계단: {"stair_riser_mm":180,"stair_tread_mm":260,"stair_run_count":16} 처럼 한 번에 준다.
--   집계 규칙 — all: fail>unknown>marginal>pass / any: pass>marginal>unknown>fail.
--   멤버가 0건이면 'unknown'이다("기준이 없다"를 "통과"로 흘리지 않는다).
--   ★★ C2 — 이전 판은 멤버 전부를 무조건 ::double precision 으로 캐스트했다. 앞 담당자는
--     "boolean 멤버가 섞인 그룹은 지금 unknown이 된다"고 적었으나 사실이 아니었다:
--     logic='all'이면 22P02(invalid input syntax for type double precision: "true")로
--     하드 실패하고, logic='any'면 exists 단축평가로 boolean 조건이 조용히 사라져 pass가
--     났다(결과가 실행계획에 의존했다). robot_thresholds의 CHECK는 boolean 멤버가 그룹에
--     들어가는 것을 전혀 막지 않으므로 저장은 성공하고 판정 시점에 터졌다.
--     → rt.value_type으로 분기해 boolean은 fn_eval_threshold(boolean,...) 오버로드로 보낸다.
--       관측 묶음의 JSON 타입이 지표 타입과 다르면 캐스트하지 않고 NULL→'unknown'이다.
--   ★★ C3 — p_profile(관측 형상)을 받는다. 그룹의 applies_profile과 멤버의 applies_profile
--     둘 다 게이트로 쓴다. 그룹 형상이 관측 형상과 맞지 않으면 판정하지 않고 'unknown'이다
--     (계단 전용 그룹이 평지 관측에 pass를 내던 경로를 여기서 닫는다).
-- ⚠ 인자가 늘었으므로 옛 2인자 함수를 반드시 지운다. 남겨 두면 2인자 호출이
--   default를 타지 않고 **옛 버그 있는 함수**로 정확히 매칭돼 버린다.
drop function if exists fn_eval_group(uuid, jsonb);
create or replace function fn_eval_group(p_group_id uuid, p_observed jsonb,
                                         p_profile threshold_profile default null)
returns passability_verdict language sql stable as $$
  with g as (
    select logic, applies_profile from threshold_groups where id = p_group_id
  ), gate as (
    select exists (select 1 from g
                    where g.applies_profile = '{}'
                       or (p_profile is not null and p_profile = any (g.applies_profile))) as ok
  ), v as (
    select case rt.value_type
             when 'numeric' then fn_eval_threshold(
                    case when jsonb_typeof(p_observed -> rm.code) = 'number'
                         then (p_observed ->> rm.code)::double precision end,
                    rt.comparator, rt.value, rt.marginal_value)
             when 'boolean' then fn_eval_threshold(
                    case when jsonb_typeof(p_observed -> rm.code) = 'boolean'
                         then (p_observed ->> rm.code)::boolean end,
                    rt.comparator, rt.bool_value)
             else 'unknown'::passability_verdict
           end as verdict
      from robot_thresholds rt
      join robot_metrics rm on rm.id = rt.metric_id
     where rt.group_id = p_group_id
       and (rt.applies_profile = '{}'
            or (p_profile is not null and p_profile = any (rt.applies_profile)))
  )
  select case
    when not (select ok from gate) then 'unknown'
    when not exists (select 1 from v) then 'unknown'
    when (select logic from g) = 'all' then
      case when exists (select 1 from v where verdict = 'fail')     then 'fail'
           when exists (select 1 from v where verdict = 'unknown')  then 'unknown'
           when exists (select 1 from v where verdict = 'marginal') then 'marginal'
           else 'pass' end
    else
      case when exists (select 1 from v where verdict = 'pass')     then 'pass'
           when exists (select 1 from v where verdict = 'marginal') then 'marginal'
           when exists (select 1 from v where verdict = 'unknown')  then 'unknown'
           else 'fail' end
  end::passability_verdict;
$$;

-- 002:136-160: PUBLIC을 먼저 회수하지 않으면 개별 role revoke가 무의미하다.
revoke execute on function fn_resolve_ruleset(uuid) from public, anon;
revoke execute on function fn_ruleset_snapshot(uuid) from public, anon;
revoke execute on function fn_eval_threshold(double precision, comparator_op, double precision, double precision) from public, anon;
revoke execute on function fn_eval_threshold(boolean, comparator_op, boolean) from public, anon;
revoke execute on function fn_resolve_thresholds(uuid, uuid, robot_mode, threshold_profile) from public, anon;
revoke execute on function fn_eval_group(uuid, jsonb, threshold_profile) from public, anon;
grant execute on function fn_resolve_ruleset(uuid) to authenticated, service_role;
grant execute on function fn_ruleset_snapshot(uuid) to authenticated, service_role;
grant execute on function fn_eval_threshold(double precision, comparator_op, double precision, double precision) to authenticated, service_role;
grant execute on function fn_eval_threshold(boolean, comparator_op, boolean) to authenticated, service_role;
grant execute on function fn_resolve_thresholds(uuid, uuid, robot_mode, threshold_profile) to authenticated, service_role;
grant execute on function fn_eval_group(uuid, jsonb, threshold_profile) to authenticated, service_role;

-- =============================================================================
-- (9) RLS — 테이블을 만든 같은 파일에서 정책까지(C5). enable만 하고 정책을 빠뜨리면
--   authenticated 전면 거부가 된다(007:102-103).
--   (a) 전역 마스터 = read_auth + admin_write (app_settings 001:282-285 형태)
--   (b) 스코프 기준 = read_auth + site_write  (criteria 001:290-293 형태)
--   (c) 프로젝트 데이터 = all_auth            (001:267-273 형태)
-- ★ 탈락안 2의 반쪽 구멍(전역 코드체계는 admin, 자식 코드·층은 all_auth)을 여기서 닫는다.
-- ★ 정책은 동적 SQL 루프로 줄이지 않고 펴 쓴다 — grep으로 "이 테이블에 어떤 정책이
--   있나"를 즉답할 수 있어야 하기 때문(001:8-10이 같은 전제 위에 있다).
-- =============================================================================
alter table finish_parts            enable row level security;
alter table material_families       enable row level security;
alter table finish_materials        enable row level security;
alter table material_parts          enable row level security;
alter table finish_properties       enable row level security;
alter table material_properties     enable row level security;
alter table robot_classes           enable row level security;
alter table robot_metrics           enable row level security;
alter table robot_rulesets          enable row level security;
alter table threshold_groups        enable row level security;
alter table robot_thresholds        enable row level security;
alter table code_systems            enable row level security;
alter table drawings                enable row level security;
alter table project_codes           enable row level security;
alter table project_code_layers     enable row level security;
alter table spaces                  enable row level security;
alter table space_finishes          enable row level security;
alter table space_adjacencies       enable row level security;
alter table space_observations      enable row level security;
alter table passability_assessments enable row level security;
alter table assessment_findings     enable row level security;

drop policy if exists read_auth on finish_parts;
drop policy if exists admin_write on finish_parts;
create policy read_auth on finish_parts for select to authenticated using (true);
create policy admin_write on finish_parts for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists read_auth on material_families;
drop policy if exists admin_write on material_families;
create policy read_auth on material_families for select to authenticated using (true);
create policy admin_write on material_families for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists read_auth on finish_materials;
drop policy if exists admin_write on finish_materials;
create policy read_auth on finish_materials for select to authenticated using (true);
create policy admin_write on finish_materials for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists read_auth on material_parts;
drop policy if exists admin_write on material_parts;
create policy read_auth on material_parts for select to authenticated using (true);
create policy admin_write on material_parts for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists read_auth on finish_properties;
drop policy if exists admin_write on finish_properties;
create policy read_auth on finish_properties for select to authenticated using (true);
create policy admin_write on finish_properties for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists read_auth on material_properties;
drop policy if exists admin_write on material_properties;
create policy read_auth on material_properties for select to authenticated using (true);
create policy admin_write on material_properties for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists read_auth on robot_classes;
drop policy if exists admin_write on robot_classes;
create policy read_auth on robot_classes for select to authenticated using (true);
create policy admin_write on robot_classes for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists read_auth on robot_metrics;
drop policy if exists admin_write on robot_metrics;
create policy read_auth on robot_metrics for select to authenticated using (true);
create policy admin_write on robot_metrics for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists read_auth on robot_rulesets;
drop policy if exists site_write on robot_rulesets;
create policy read_auth on robot_rulesets for select to authenticated using (true);
create policy site_write on robot_rulesets for all to authenticated
  using (site_id is not null or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (site_id is not null or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- threshold_groups는 robot_thresholds와 같은 게이트(소속 기준세트의 스코프)를 쓴다.
drop policy if exists read_auth on threshold_groups;
drop policy if exists site_write on threshold_groups;
create policy read_auth on threshold_groups for select to authenticated using (true);
create policy site_write on threshold_groups for all to authenticated
  using (exists (select 1 from robot_rulesets rs where rs.id = ruleset_id
                  and (rs.site_id is not null
                       or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))))
  with check (exists (select 1 from robot_rulesets rs where rs.id = ruleset_id
                  and (rs.site_id is not null
                       or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))));

drop policy if exists read_auth on robot_thresholds;
drop policy if exists site_write on robot_thresholds;
create policy read_auth on robot_thresholds for select to authenticated using (true);
create policy site_write on robot_thresholds for all to authenticated
  using (exists (select 1 from robot_rulesets rs where rs.id = ruleset_id
                  and (rs.site_id is not null
                       or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))))
  with check (exists (select 1 from robot_rulesets rs where rs.id = ruleset_id
                  and (rs.site_id is not null
                       or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))));

drop policy if exists read_auth on code_systems;
drop policy if exists site_write on code_systems;
create policy read_auth on code_systems for select to authenticated using (true);
create policy site_write on code_systems for all to authenticated
  using (site_id is not null or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (site_id is not null or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists read_auth on project_codes;
drop policy if exists scoped_write on project_codes;
create policy read_auth on project_codes for select to authenticated using (true);
create policy scoped_write on project_codes for all to authenticated
  using (exists (select 1 from code_systems cs where cs.id = system_id
                  and (cs.site_id is not null
                       or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))))
  with check (exists (select 1 from code_systems cs where cs.id = system_id
                  and (cs.site_id is not null
                       or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))));

drop policy if exists read_auth on project_code_layers;
drop policy if exists scoped_write on project_code_layers;
create policy read_auth on project_code_layers for select to authenticated using (true);
create policy scoped_write on project_code_layers for all to authenticated
  using (exists (select 1 from project_codes pc join code_systems cs on cs.id = pc.system_id
                  where pc.id = project_code_id
                    and (cs.site_id is not null
                         or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))))
  with check (exists (select 1 from project_codes pc join code_systems cs on cs.id = pc.system_id
                  where pc.id = project_code_id
                    and (cs.site_id is not null
                         or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))));

drop policy if exists all_auth on drawings;
create policy all_auth on drawings for all to authenticated using (true) with check (true);
drop policy if exists all_auth on spaces;
create policy all_auth on spaces for all to authenticated using (true) with check (true);
drop policy if exists all_auth on space_finishes;
create policy all_auth on space_finishes for all to authenticated using (true) with check (true);
drop policy if exists all_auth on space_adjacencies;
create policy all_auth on space_adjacencies for all to authenticated using (true) with check (true);
drop policy if exists all_auth on space_observations;
create policy all_auth on space_observations for all to authenticated using (true) with check (true);
drop policy if exists all_auth on passability_assessments;
create policy all_auth on passability_assessments for all to authenticated using (true) with check (true);
drop policy if exists all_auth on assessment_findings;
create policy all_auth on assessment_findings for all to authenticated using (true) with check (true);

-- Realtime publication에는 넣지 않는다: 003·004·012가 넣은 세 테이블은 전부 비동기
-- 잡의 진행 상태를 담는데 013에는 잡이 없다. 도면 임포트를 잡으로 돌릴 때 함께 편입.

-- =============================================================================
-- (10) 인덱스 — ★ 저장소 관례에서 의도적으로 벗어나는 유일한 지점
-- 001~012에는 일반 조회 인덱스가 0건이고 존재하는 6종 전부가 제약 강제용 부분
-- 유니크다(grep 확인). 그 관례의 전제는 "테이블 11개, 접근이 대부분 PK/FK 단건"이었다.
-- 013의 읽기 경로는 다르다 — 트리 조립이 재귀 조인, 판정 한 건이 6테이블 조인이다.
-- 따라서 조인 경로에 실제로 쓰이는 FK 7개에만 인덱스를 둔다(이탈 범위 최소화).
-- (7번째 = robot_thresholds.group_id. fn_eval_group이 이 컬럼으로만 멤버를 모은다.)
-- =============================================================================
drop index if exists idx_material_parts_part;
drop index if exists idx_finish_materials_family;
drop index if exists idx_space_finishes_material;
drop index if exists idx_space_finishes_space;
drop index if exists idx_robot_thresholds_lookup;
drop index if exists idx_robot_thresholds_group;
drop index if exists idx_findings_assessment;
drop index if exists idx_space_observations_space;
create index idx_material_parts_part     on material_parts(part_id);
create index idx_finish_materials_family on finish_materials(family_id);
create index idx_space_finishes_material on space_finishes(material_id);
create index idx_space_finishes_space    on space_finishes(space_id);
create index idx_robot_thresholds_lookup on robot_thresholds(class_id, metric_id);
create index idx_robot_thresholds_group  on robot_thresholds(group_id) where group_id is not null;
create index idx_findings_assessment     on assessment_findings(assessment_id);
create index idx_space_observations_space on space_observations(space_id);

-- (11) PostgREST 스키마 캐시 갱신 (007:144·012:371)
notify pgrst, 'reload schema';
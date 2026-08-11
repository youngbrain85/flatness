-- 015_supabase_editor.sql — 검증 게이트의 Supabase SQL Editor 판. (생성물 — 직접 고치지
-- 말 것. 원본 015_finish_material_regression.sql 을 고친 뒤 make_editor_version.py 로 재생성.)
--
-- 원본은 psql 전용 메타명령(\set·\echo·\pset)을 쓰는데 SQL Editor 는 psql 이 아니라
-- 서버에 SQL 을 그대로 보내므로 42601 이 난다. 이 파일은 그 줄들을 걷어낸 순수 SQL 이며
-- 단언 내용은 원본과 동일하다.
--
-- 사용법: 전체를 붙여넣고 Run.
--   성공 → 마지막 결과 그리드에 verdict='PASS 38/38' 한 행
--   실패 → '★회귀 실패: ...' 예외로 중단 (어느 단언인지 메시지에 나온다)
-- 임시 테이블만 만들며 데이터를 바꾸지 않는다. 재실행 안전.

-- =============================================================================
-- 015_finish_material_regression.sql   (전면 재작성 · 변이 기반)
--
-- ★★ 마이그레이션이 아니다. 013(DDL)+014(시드)가 적재된 DB에 대고 돌리는 회귀 게이트다.
--    어떤 DDL 도 하지 않고 어떤 행도 영구히 쓰지 않는다. 쓰기 검사는 전부
--    plpgsql 서브트랜잭션(BEGIN … EXCEPTION) 안에서 하고 즉시 되돌린다.
--    supabase/migrations 에 넣지 마라.
--
-- 설계 원칙 (앞 판이 무력했던 이유를 그대로 뒤집은 것)
--   1) 개수 단언 금지. 전부 **집합 동등성**이다. 기대 행 집합과 DB 행 집합의
--      대칭차(symmetric difference)가 0행이어야 PASS. 개수가 같아도 내용이 바뀌면 잡힌다.
--   2) 기대값은 주석이 아니라 **식(VALUES 절) 안에** 있다.
--   3) 단언이 하나라도 FAIL 이거나 **누락**되면 마지막 게이트가 예외를 던진다
--      → psql 종료코드 3 (ON_ERROR_STOP). CI 게이트로 쓸 수 있다.
--      본문은 ON_ERROR_STOP off 로 돈다. 컬럼·테이블·함수가 사라지면 그 단언의
--      INSERT 가 죽고 seq 가 비어서 "누락"으로 FAIL 된다(뒤 단언은 계속 돈다).
--   4) 스코프는 **도면·코드체계·기준세트**로 못박는다. 두 번째 발행 기관 도면이
--      정상 적재돼도 이 스크립트는 그대로 통과해야 한다.
--
-- 기준(GROUND_TRUTH): 컨트롤러가 LH 26형 도면에서 직접 확인한 사실.
--   실 면적 7건 / 바닥레벨 / 인접 6쌍(도면 확정) + 2쌍(추론) / 유효통과폭 전 개구부 미상 /
--   욕실 구배 1/100 / 레벨 원문 모순 2건 보존.
--
-- 사용:  pgsetup.sh psql -f 015_finish_material_regression.sql   (실패 시 exit 3)
--   또는 run015.sh                                               (실패 시 exit 1)
-- =============================================================================

drop table if exists _reg;
create temporary table _reg(
  seq int primary key, name text, expected text, actual text, verdict text);

-- 이 스크립트가 반드시 채워야 하는 단언 번호. 하나라도 비면 게이트가 막는다.
drop table if exists _reg_expected_seq;
create temporary table _reg_expected_seq(seq int primary key);
insert into _reg_expected_seq select generate_series(1, 38);

-- -----------------------------------------------------------------------------
-- 스코프: 이 도면 / 이 발행 기관 코드체계 / 이 기준세트 만 본다.
-- -----------------------------------------------------------------------------
drop view if exists _scope;
create temporary view _scope as
select d.id as drawing_id, cs.id as system_id, rs.id as ruleset_id
  from drawings d
  join code_systems cs on cs.id = d.system_id
  cross join robot_rulesets rs
 where cs.code = 'lh-apt-unit-2025'
   and d.doc_no = 'AA-004'
   and d.doc_key = 'lh-26형-2025.10.22'
   and rs.code = 'robot-baseline-2026';


-- =============================================================================
-- =============================================================================
select d.doc_no, d.doc_key, d.title, d.revision, d.drawn_on,
       cs.code as system_code, cs.issuer, rs.code as ruleset_code, rs.is_default
  from drawings d join code_systems cs on cs.id = d.system_id
  cross join robot_rulesets rs
 where cs.code = 'lh-apt-unit-2025' and d.doc_no = 'AA-004'
   and rs.code = 'robot-baseline-2026';

insert into _reg
with expect(doc_no, doc_key, title, system_code, issuer, ruleset_code, is_default) as (values
  ('AA-004','lh-26형-2025.10.22','실내재료마감표','lh-apt-unit-2025','LH','robot-baseline-2026',true)
), actual as (
  select d.doc_no, d.doc_key, d.title, cs.code, cs.issuer, rs.code, rs.is_default
    from drawings d join code_systems cs on cs.id = d.system_id
    cross join robot_rulesets rs
   where cs.code = 'lh-apt-unit-2025' and d.doc_no = 'AA-004'
     and d.doc_key = 'lh-26형-2025.10.22' and rs.code = 'robot-baseline-2026'
), diff as (
  select 'DB에만: ' || format('%s|%s|%s|%s|%s|%s|%s',
           doc_no, doc_key, title, system_code, issuer, ruleset_code, is_default) as d
    from (select * from actual except select * from expect) q(doc_no,doc_key,title,system_code,issuer,ruleset_code,is_default)
  union all
  select '기대에만: ' || format('%s|%s|%s|%s|%s|%s|%s',
           doc_no, doc_key, title, system_code, issuer, ruleset_code, is_default)
    from (select * from expect except select * from actual) q(doc_no,doc_key,title,system_code,issuer,ruleset_code,is_default)
)
select 1, 'A01 스코프 식별자 값 일치',
  '(AA-004, lh-26형-2025.10.22, 실내재료마감표, lh-apt-unit-2025, LH, robot-baseline-2026, default) 1행',
  coalesce(left(string_agg(d, ' ‖ '), 500), '대칭차 없음 · 스코프 1행 확정'),
  case when count(*) = 0 and (select count(*) from _scope) = 1 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select s.name, round(s.area_m2::numeric,4) area_m2, s.fl_mm, s.sl_mm, s.basis,
       left(coalesce(s.basis_note,''), 40) as basis_note
  from spaces s where s.drawing_id = (select drawing_id from _scope) order by s.name;

insert into _reg
with expect(nm, area, fl, sl, bs) as (values
  ('PD',        1.2096::numeric, null::double precision, null::double precision, 'drawing_confirmed'),
  ('거실/침실', 16.2528,  110.0,   0.0, 'drawing_confirmed'),
  ('발코니',     6.7500,   35.0,   0.0, 'drawing_confirmed'),
  ('벽체공용',   3.3236,   null,  null, 'drawing_confirmed'),
  ('복도',        null,     55.0,   0.0, 'inferred'),
  ('실외기실',    null,     35.0,   0.0, 'inferred'),
  ('욕실',       3.3597,   30.0,-150.0, 'drawing_confirmed'),
  ('주방/식당',  5.3426,  110.0,   0.0, 'drawing_confirmed'),
  ('현관',       1.9988,   80.0,   0.0, 'drawing_confirmed')
), actual(nm, area, fl, sl, bs) as (
  select s.name, round(s.area_m2::numeric,4), s.fl_mm, s.sl_mm, s.basis::text
    from spaces s where s.drawing_id = (select drawing_id from _scope)
), diff as (
  select 'DB에만: ' || format('%s|%s|%s|%s|%s', nm, area, fl, sl, bs) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s|%s|%s|%s|%s', nm, area, fl, sl, bs)
    from (select * from expect except select * from actual) q
)
select 2, 'A02 실 집합·면적·레벨·근거',
  '기대 9행(면적 소수4자리·FL/SL·basis) ≡ DB, 대칭차 0',
  coalesce(left(string_agg(d, ' ‖ '), 600), '대칭차 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select s.basis, s.name, (s.area_m2 is not null) as 면적있음,
       (coalesce(s.basis_note,'') <> '') as 사유있음
  from spaces s where s.drawing_id = (select drawing_id from _scope)
 order by s.basis, s.name;

insert into _reg
with sc as (select drawing_id from _scope),
     gt(nm) as (values ('거실/침실'),('주방/식당'),('욕실'),('현관'),('PD'),('발코니'),('벽체공용')),
     conf as (select name from spaces where drawing_id=(select drawing_id from sc) and basis='drawing_confirmed'),
     ar   as (select name from spaces where drawing_id=(select drawing_id from sc) and area_m2 is not null),
     bad_note as (select name from spaces where drawing_id=(select drawing_id from sc)
                    and basis='inferred' and coalesce(basis_note,'') = ''),
     diff as (
       select 'confirmed≠GROUND_TRUTH: ' || name as d from (select * from conf except select * from gt) q(name)
       union all select 'GROUND_TRUTH≠confirmed: ' || nm from (select * from gt except select * from conf) q(nm)
       union all select '면적보유≠confirmed: ' || name from (select * from ar except select * from conf) q(name)
       union all select 'confirmed≠면적보유: ' || name from (select * from conf except select * from ar) q(name)
       union all select 'inferred 인데 사유없음: ' || name from bad_note
     )
select 3, 'A03 근거 축 ≡ 면적 축 · 추론분 사유 강제',
  '{drawing_confirmed 실} = {면적 보유 실} = GROUND_TRUTH 7실, inferred 행 전부 basis_note 있음',
  coalesce(left(string_agg(d, ' ‖ '), 500), '세 집합 일치 · 추론분 사유 전부 있음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select s.name, s.fl_mm, s.sl_mm, s.raw->>'fl_label' as 그래픽라벨,
       s.raw->>'note13' as 주기13, (s.conflict_note is not null) as 모순기록
  from spaces s
 where s.drawing_id = (select drawing_id from _scope) and s.name in ('욕실','발코니')
 order by s.name;

insert into _reg
with expect(nm, fl, sl, note13, has_conflict, label_head) as (values
  ('욕실',    30.0::double precision, -150.0::double precision, '욕실:SL-60(FL+20/+10)',              true, 'FL.+30'),
  ('발코니',  35.0,                   0.0,                      '발코니:FL+80(높은턱),+35(낮은턱)',   true, 'FL.+35')
), actual(nm, fl, sl, note13, has_conflict, label_head) as (
  select s.name, s.fl_mm, s.sl_mm, s.raw->>'note13', (s.conflict_note is not null),
         left(s.raw->>'fl_label', 6)
    from spaces s
   where s.drawing_id = (select drawing_id from _scope) and s.name in ('욕실','발코니')
), diff as (
  select 'DB에만: ' || format('%s|%s|%s|%s|%s|%s', nm, fl, sl, note13, has_conflict, label_head) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s|%s|%s|%s|%s|%s', nm, fl, sl, note13, has_conflict, label_head)
    from (select * from expect except select * from actual) q
  -- 두 분기가 실제로 서로 다른 값을 주장해야 "모순 보존"이다. 한쪽을 지우거나
  -- 한쪽으로 통일해 버리면 여기서 걸린다.
  union all
  select '주기13 이 그래픽라벨과 같은 값을 주장한다(모순이 해소돼 버렸다): ' || s.name
    from spaces s
   where s.drawing_id = (select drawing_id from _scope)
     and ((s.name='욕실'   and coalesce(s.raw->>'note13','') not like '%SL-60%')
       or (s.name='발코니' and coalesce(s.raw->>'note13','') not like '%높은턱%'))
)
select 4, 'A04 레벨 원문 모순 양쪽 보존',
  '욕실 FL30/SL-150 + 주기13 "욕실:SL-60(FL+20/+10)" / 발코니 FL35 + 주기13 "발코니:FL+80(높은턱),+35(낮은턱)" / conflict_note 양쪽',
  coalesce(left(string_agg(d, ' ‖ '), 600), '두 실 모두 그래픽 라벨과 주기13 이 함께 보존됨'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select s.name, s.raw->>'slope' as 구배원문 from spaces s
 where s.drawing_id = (select drawing_id from _scope) and s.name='욕실';

insert into _reg
with a as (
  select coalesce(s.raw->>'slope','(없음)') as slope
    from spaces s where s.drawing_id=(select drawing_id from _scope) and s.name='욕실'
)
select 5, 'A05 욕실 구배 1/100',
  'spaces(욕실).raw->>''slope'' 에 "1/100" 과 "구배" 가 함께 있다',
  coalesce((select slope from a), '(욕실 행 없음)'),
  case when (select count(*) from a where slope like '%1/100%' and slope like '%구배%') = 1
       then 'PASS' else 'FAIL' end;


-- =============================================================================
-- =============================================================================
select sa.name a, sb.name b, x.kind, x.label, x.step_mm, x.step_abs_raw_mm,
       coalesce(sl.name,'(동일레벨)') as 낮은쪽, x.basis
  from space_adjacencies x
  join spaces sa on sa.id = x.space_a_id
  join spaces sb on sb.id = x.space_b_id
  left join spaces sl on sl.id = x.lower_space_id
 where sa.drawing_id = (select drawing_id from _scope)
 order by sa.name, sb.name;

insert into _reg
with expect(a, b, kd, lb, st, sabs, lo, bs) as (values
  ('거실/침실','발코니',   'door',         '거실-발코니 미서기문',        -75.0::double precision, 75.0::double precision,'발코니','drawing_confirmed'),
  ('거실/침실','욕실',     'door',         '욕실문',                      -80.0,  80.0, '욕실',   'drawing_confirmed'),
  ('거실/침실','주방/식당','open_boundary','거실-주방 개방 경계',           0.0,   0.0, null,     'drawing_confirmed'),
  ('발코니',  '실외기실',  'door',         '발코니-실외기실 철제여닫이문',  0.0,   0.0, null,     'inferred'),
  ('복도',    '현관',      'door',         '현관 진입 철재여닫이문',       25.0,  25.0, '복도',   'inferred'),
  ('욕실',    '주방/식당', 'level_change', '주방-욕실 벽체 경계(단차)',    80.0,  80.0, '욕실',   'drawing_confirmed'),
  ('욕실',    '현관',      'level_change', '욕실-현관 벽체 경계(단차)',    50.0,  50.0, '욕실',   'drawing_confirmed'),
  ('주방/식당','현관',     'open_boundary','주방-현관 마감 전환선',       -30.0,  30.0, '현관',   'drawing_confirmed')
), actual(a, b, kd, lb, st, sabs, lo, bs) as (
  select sa.name, sb.name, x.kind::text, x.label, x.step_mm, x.step_abs_raw_mm, sl.name, x.basis::text
    from space_adjacencies x
    join spaces sa on sa.id = x.space_a_id
    join spaces sb on sb.id = x.space_b_id
    left join spaces sl on sl.id = x.lower_space_id
   where sa.drawing_id = (select drawing_id from _scope)
), diff as (
  select 'DB에만: ' || format('%s~%s|%s|%s|%s|%s|%s|%s', a,b,kd,lb,st,sabs,lo,bs) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s~%s|%s|%s|%s|%s|%s|%s', a,b,kd,lb,st,sabs,lo,bs)
    from (select * from expect except select * from actual) q
  -- 불변식 3종: (1) a<b 정렬, (2) 절대값 = |부호값|, (3) 낮은쪽은 부호에서 파생
  union all
  select '정렬 위반(a>b): ' || sa.name || '>' || sb.name
    from space_adjacencies x join spaces sa on sa.id=x.space_a_id join spaces sb on sb.id=x.space_b_id
   where sa.drawing_id=(select drawing_id from _scope)
     and (sa.name collate "C") > (sb.name collate "C")
  union all
  select '절대값 불일치: ' || x.label
    from space_adjacencies x join spaces sa on sa.id=x.space_a_id
   where sa.drawing_id=(select drawing_id from _scope)
     and x.step_abs_raw_mm is distinct from abs(x.step_mm)
  union all
  select '낮은쪽 파생 위반: ' || x.label
    from space_adjacencies x join spaces sa on sa.id=x.space_a_id
   where sa.drawing_id=(select drawing_id from _scope)
     and x.lower_space_id is distinct from
         (case when x.step_mm is null or x.step_mm = 0 then null
               when x.step_mm > 0 then x.space_a_id else x.space_b_id end)
)
select 6, 'A06 인접 집합·부호·절대값·낮은쪽',
  '기대 8행 ≡ DB, a<b 정렬 / step_abs_raw=|step| / lower 는 부호 파생 (위반 0)',
  coalesce(left(string_agg(d, ' ‖ '), 700), '대칭차 없음 · 불변식 3종 위반 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- 적재 순서(랜덤 UUID)에 따라 a/b 와 step_mm 부호가 뒤집히던 결함(C1-a)의 회귀.
-- 같은 인접을 두 방향으로 삽입해 저장 결과가 서로 같고, 기존 '욕실문' 행과도 같은지 본다.
-- 전부 서브트랜잭션 안에서 하고 되돌린다.
do $$
declare
  v_dwg uuid; v_liv uuid; v_bath uuid;
  v_fwd text := '(미실행)'; v_rev text := '(미실행)'; v_stored text := '(미실행)';
  v_err text := '';
begin
  select drawing_id into v_dwg from _scope;
  select id into v_liv  from spaces where drawing_id=v_dwg and name='거실/침실';
  select id into v_bath from spaces where drawing_id=v_dwg and name='욕실';

  select format('%s|%s|%s|%s', sa.name, sb.name, x.step_mm, coalesce(sl.name,'-'))
    into v_stored
    from space_adjacencies x join spaces sa on sa.id=x.space_a_id join spaces sb on sb.id=x.space_b_id
    left join spaces sl on sl.id=x.lower_space_id
   where sa.drawing_id=v_dwg and x.label='욕실문';

  begin
    -- 방향 1: (욕실 → 거실/침실), step = FL(b)-FL(a) = 110-30 = +80
    insert into space_adjacencies(space_a_id, space_b_id, kind, label, step_mm,
                                  basis, basis_note, source_text)
    values (v_bath, v_liv, 'door', '_regtest_norm_fwd', 80,
            'inferred', '회귀 테스트용 임시 행', '회귀 테스트');
    -- 방향 2: (거실/침실 → 욕실), step = FL(b)-FL(a) = 30-110 = -80
    insert into space_adjacencies(space_a_id, space_b_id, kind, label, step_mm,
                                  basis, basis_note, source_text)
    values (v_liv, v_bath, 'door', '_regtest_norm_rev', -80,
            'inferred', '회귀 테스트용 임시 행', '회귀 테스트');

    select format('%s|%s|%s|%s', sa.name, sb.name, x.step_mm, coalesce(sl.name,'-'))
      into v_fwd from space_adjacencies x
      join spaces sa on sa.id=x.space_a_id join spaces sb on sb.id=x.space_b_id
      left join spaces sl on sl.id=x.lower_space_id where x.label='_regtest_norm_fwd';
    select format('%s|%s|%s|%s', sa.name, sb.name, x.step_mm, coalesce(sl.name,'-'))
      into v_rev from space_adjacencies x
      join spaces sa on sa.id=x.space_a_id join spaces sb on sb.id=x.space_b_id
      left join spaces sl on sl.id=x.lower_space_id where x.label='_regtest_norm_rev';

    raise exception '__REG_ROLLBACK__';
  exception when others then
    if sqlerrm <> '__REG_ROLLBACK__' then v_err := sqlstate || ' ' || sqlerrm; end if;
  end;

  insert into _reg values (7, 'A07 쌍 정규화 결정성(양방향 수렴)',
    '두 방향 삽입 결과 = ''거실/침실|욕실|-80|욕실'' 로 동일, 기존 욕실문 행과도 동일',
    format('정방향=%s / 역방향=%s / 저장된 욕실문=%s%s', v_fwd, v_rev, v_stored,
           case when v_err='' then '' else ' / 예외=' || v_err end),
    case when v_err = ''
          and v_fwd = '거실/침실|욕실|-80|욕실'
          and v_rev = '거실/침실|욕실|-80|욕실'
          and v_stored = '거실/침실|욕실|-80|욕실'
         then 'PASS' else 'FAIL' end);
end $$;


-- =============================================================================
-- =============================================================================
select v.label, v.step_abs_mm, v.lower_space_name, v.fl_disputed,
       v.touches_inferred_space, v.basis
  from v_space_step v where v.drawing_id = (select drawing_id from _scope)
 order by v.label;

insert into _reg
with expect(lb, disp, inf, bs) as (values
  ('거실-발코니 미서기문',        true,  false, 'drawing_confirmed'),
  ('거실-주방 개방 경계',         false, false, 'drawing_confirmed'),
  ('발코니-실외기실 철제여닫이문',true,  true,  'inferred'),
  ('욕실-현관 벽체 경계(단차)',   true,  false, 'drawing_confirmed'),
  ('욕실문',                      true,  false, 'drawing_confirmed'),
  ('주방-욕실 벽체 경계(단차)',   true,  false, 'drawing_confirmed'),
  ('주방-현관 마감 전환선',       false, false, 'drawing_confirmed'),
  ('현관 진입 철재여닫이문',      false, true,  'inferred')
), actual(lb, disp, inf, bs) as (
  select v.label, v.fl_disputed, v.touches_inferred_space, v.basis::text
    from v_space_step v where v.drawing_id = (select drawing_id from _scope)
), diff as (
  select 'DB에만: ' || format('%s|%s|%s|%s', lb, disp, inf, bs) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s|%s|%s|%s', lb, disp, inf, bs)
    from (select * from expect except select * from actual) q
  -- 단차 0 인 두 행 중 '발코니-실외기실' 만 (원문모순 위 + 추론실 접촉) 이어야 한다.
  -- ★ 기준 컬럼을 step_abs_mm → step_abs_raw_mm 으로 바꿨다(F1). 판정 입력인 step_abs_mm 은
  --   이제 '발코니-실외기실' 에서 NULL(판정 불가)이라 그 행이 이 필터에서 빠져 검사 하중을
  --   잃는다. step_abs_raw_mm 은 판정에서 빠진 행에서도 원값(0)을 그대로 들고 있으므로
  --   "단차0 두 행" 이라는 검사 축이 그대로 유지된다. 검사 축을 지운 것이 아니다.
  union all
  select '단차0 행의 표식이 어긋남: ' || v.label ||
         format(' (disputed=%s, inferred=%s)', v.fl_disputed, v.touches_inferred_space)
    from v_space_step v
   where v.drawing_id = (select drawing_id from _scope) and v.step_abs_raw_mm = 0
     and (v.fl_disputed, v.touches_inferred_space)
         is distinct from (v.label = '발코니-실외기실 철제여닫이문',
                           v.label = '발코니-실외기실 철제여닫이문')
  -- ★ F1 추가 축: 판정에서 빠진 행은 정확히 그 한 행이어야 하고 사유가 있어야 한다.
  union all
  select '판정 불가 표식이 어긋남: ' || v.label ||
         format(' (사유=%s)', coalesce(v.step_unevaluable_reason, '(없음)'))
    from v_space_step v
   where v.drawing_id = (select drawing_id from _scope)
     and (v.step_unevaluable_reason is not null)
         is distinct from (v.label = '발코니-실외기실 철제여닫이문')
)
select 8, 'A08 v_space_step 파생축(모순·추론 접촉)',
  '기대 8행 ≡ DB, 단차0(원값) 두 행 중 발코니-실외기실만 disputed·inferred 둘 다 true / 판정 불가 행은 그 한 행뿐이고 사유가 있다',
  coalesce(left(string_agg(d, ' ‖ '), 600), '대칭차 없음 · 단차0 표식 정상 · 판정불가 1행'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select rc.code cls, rm.code metric, rt.mode, rt.comparator, rt.unit,
       rt.value, rt.marginal_value, rt.applies_profile::text prof,
       (rt.unknown_reason is not null) as 근거없음
  from robot_thresholds rt
  join robot_classes rc on rc.id = rt.class_id
  join robot_metrics rm on rm.id = rt.metric_id
 where rt.ruleset_id = (select ruleset_id from _scope)
 order by rc.sort_order, rm.sort_order, rt.mode, rt.applies_profile;

insert into _reg
with expect(cls, met, md, op, un, val, mrg, prof, unk) as (values
  ('serving-delivery','step_height_mm',       '', 'lte','mm',    5.0::double precision, null::double precision,'{}',                      false),
  ('serving-delivery','step_height_mm',       '', 'lte','mm',    5.0,   12.7,'{beveled,ramped,rounded}', false),
  ('serving-delivery','gap_width_mm',         '', 'lte','mm',   15.0,   35.0,'{}',                       false),
  ('serving-delivery','clear_width_mm',       '', 'gte','mm',  800.0,  450.0,'{}',                       false),
  ('serving-delivery','turn_width_mm',        '', 'gte','mm',   null,   null,'{}',                       true),
  ('serving-delivery','rec_path_width_mm',    '', 'gte','mm', 1200.0,  800.0,'{}',                       false),
  ('serving-delivery','slope_deg',            '', 'lte','deg',   5.0,    7.0,'{}',                       false),
  ('serving-delivery','carpet_pile_mm',       '', 'lte','mm',   null,   null,'{}',                       true),
  ('serving-delivery','floor_csr_b',          '', 'gte','',     null,   null,'{}',                       true),
  ('serving-delivery','floor_flatness_mm_3m', '', 'lte','mm',   null,   null,'{}',                       true),
  ('serving-delivery','elevator_car_width_mm','', 'gte','mm',   null,   null,'{}',                       true),
  ('industrial-amr',  'step_height_mm',       '', 'lte','mm',   20.0,   null,'{}',                       false),
  ('industrial-amr',  'gap_width_mm',         '', 'lte','mm',   35.0,   null,'{}',                       false),
  ('industrial-amr',  'clear_width_mm',       '', 'gte','mm',  600.0,   null,'{}',                       false),
  ('industrial-amr',  'slope_deg',            '', 'lte','deg',  null,   null,'{}',                       true),
  ('commercial-cleaner','step_height_mm','drive','lte','mm',    10.0,   20.0,'{}',                       false),
  ('commercial-cleaner','step_height_mm','clean','lte','mm',     8.0,   10.0,'{}',                       false),
  ('commercial-cleaner','gap_width_mm',  'drive','lte','mm',    null,   null,'{}',                       true),
  ('commercial-cleaner','clear_width_mm','drive','gte','mm',  1400.0,  650.0,'{}',                       false),
  ('commercial-cleaner','clear_width_mm','clean','gte','mm',  1400.0,  650.0,'{}',                       false),
  ('commercial-cleaner','turn_width_mm', 'drive','gte','mm',  2000.0, 1100.0,'{}',                       false),
  ('commercial-cleaner','turn_width_mm', 'clean','gte','mm',  2000.0, 1100.0,'{}',                       false),
  ('commercial-cleaner','slope_deg',     'drive','lte','deg',    4.6,    8.0,'{}',                       false),
  ('commercial-cleaner','slope_deg',     'clean','lte','deg',    3.0,   null,'{}',                       false),
  ('domestic-cleaner','step_height_mm',    '', 'lte','mm',      15.0,   45.0,'{}',                       false),
  ('domestic-cleaner','slope_deg',         '', 'lte','deg',     null,   null,'{}',                       true),
  ('domestic-cleaner','carpet_pile_mm',    '', 'lte','mm',      10.0,   null,'{}',                       false),
  ('outdoor-delivery','step_height_mm',    '', 'lte','mm',      null,   null,'{}',                       true),
  ('outdoor-delivery','slope_deg',         '', 'lte','deg',     null,   null,'{}',                       true)
), actual(cls, met, md, op, un, val, mrg, prof, unk) as (
  select rc.code, rm.code, rt.mode::text, rt.comparator::text, rt.unit,
         rt.value, rt.marginal_value, rt.applies_profile::text, (rt.unknown_reason is not null)
    from robot_thresholds rt
    join robot_classes rc on rc.id = rt.class_id
    join robot_metrics rm on rm.id = rt.metric_id
   where rt.ruleset_id = (select ruleset_id from _scope)
), diff as (
  select 'DB에만: ' || format('%s/%s/%s %s %s val=%s mrg=%s prof=%s unk=%s',
           cls,met,md,op,un,val,mrg,prof,unk) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s/%s/%s %s %s val=%s mrg=%s prof=%s unk=%s',
           cls,met,md,op,un,val,mrg,prof,unk)
    from (select * from expect except select * from actual) q
  -- 단위는 지표 등록부와 문자 그대로 같아야 한다(단위 변환 금지 규약)
  union all
  select '임계값 단위가 지표 단위와 다름: ' || rm.code || ' ' || rt.unit || '≠' || rm.unit
    from robot_thresholds rt join robot_metrics rm on rm.id = rt.metric_id
   where rt.ruleset_id = (select ruleset_id from _scope) and rt.unit <> rm.unit
)
select 9, 'A09 ★임계값 29행 전량 값 일치',
  '기대 29행(등급·지표·모드·비교자·단위·value·marginal·형상·근거유무) ≡ DB, 대칭차 0',
  coalesce(left(string_agg(d, ' ‖ '), 900), '대칭차 없음 · 단위 일치'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select rc.code cls, rm.code metric, rt.mode,
       jsonb_array_length(rt.evidence) as 근거건수,
       (rt.evidence -> 0 ->> 'grade') as 첫근거등급,
       (rt.value is null) as value_null, (rt.unknown_reason is not null) as unk
  from robot_thresholds rt
  join robot_classes rc on rc.id = rt.class_id
  join robot_metrics rm on rm.id = rt.metric_id
 where rt.ruleset_id = (select ruleset_id from _scope)
 order by rc.sort_order, rm.sort_order, rt.mode;

insert into _reg
with rt as (
  select rt.*, rc.code cls, rm.code met from robot_thresholds rt
   join robot_classes rc on rc.id=rt.class_id join robot_metrics rm on rm.id=rt.metric_id
  where rt.ruleset_id = (select ruleset_id from _scope)
), bad as (
  select format('%s/%s/%s 근거 %s건', cls, met, mode, jsonb_array_length(evidence)) as d
    from rt where jsonb_array_length(evidence) < 1
  union all
  select format('%s/%s/%s 근거 원소에 url/quote/grade 누락', cls, met, mode)
    from rt where exists (
      select 1 from jsonb_array_elements(evidence) e
       where coalesce(e->>'url','') = '' or coalesce(e->>'quote','') = ''
          or coalesce(e->>'grade','') = '')
  union all
  select format('%s/%s/%s value NULL 과 unknown_reason 이 어긋남', cls, met, mode)
    from rt where (value is null and bool_value is null) <> (unknown_reason is not null)
  union all
  select format('%s/%s/%s 근거없음인데 근거 사유가 빈 문자열', cls, met, mode)
    from rt where unknown_reason is not null and btrim(unknown_reason) = ''
)
select 10, 'A10 임계값 근거(evidence) 무결성',
  '29행 전부 evidence 배열 1건 이상 · 각 원소에 url/quote/grade · (value NULL) ⇔ (unknown_reason 있음)',
  coalesce(left(string_agg(d, ' ‖ '), 600), '위반 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from bad;


-- =============================================================================
-- =============================================================================
-- fn_resolve_thresholds 가 형상별로 다른 행을 고르는지 값으로 본다.
-- marginal 12.7 을 형상 무관 행으로 되돌리면 수직 10mm 가 marginal 이 되어 여기서 죽는다.
with sc as (select ruleset_id from _scope),
     cls as (select id from robot_classes where code='serving-delivery'),
     m as (select id from robot_metrics where code='step_height_mm'),
     p(prof) as (values (null::threshold_profile), ('vertical'), ('beveled'), ('ramped'), ('stair'))
select coalesce(p.prof::text,'(형상 미상)') as 형상,
       t.value as limit_mm, t.marginal_value as marginal_mm,
       t.applies_profile::text as 규칙형상,
       fn_eval_threshold(10.0, t.comparator, t.value, t.marginal_value) as 문턱10mm판정
  from p left join lateral (
    select * from fn_resolve_thresholds((select ruleset_id from sc), (select id from cls), '', p.prof)
     where metric_id = (select id from m)) t on true
 order by 1;

insert into _reg
with sc as (select ruleset_id from _scope),
     cls as (select id from robot_classes where code='serving-delivery'),
     m as (select id from robot_metrics where code='step_height_mm'),
     expect(prof, mrg, v10) as (values
       (null::threshold_profile, null::double precision, 'fail'),
       ('vertical',              null,                   'fail'),
       ('beveled',               12.7,                   'marginal'),
       ('ramped',                12.7,                   'marginal'),
       ('stair',                 null,                   'fail')
     ),
     actual(prof, mrg, v10) as (
       select e.prof, t.marginal_value,
              fn_eval_threshold(10.0, t.comparator, t.value, t.marginal_value)::text
         from expect e left join lateral (
           select * from fn_resolve_thresholds((select ruleset_id from sc), (select id from cls), '', e.prof)
            where metric_id = (select id from m)) t on true
     ),
     diff as (
       select 'DB에만: ' || format('%s marginal=%s 10mm→%s', coalesce(prof::text,'null'), mrg, v10) as d
         from (select * from actual except select * from expect) q
       union all
       select '기대에만: ' || format('%s marginal=%s 10mm→%s', coalesce(prof::text,'null'), mrg, v10)
         from (select * from expect except select * from actual) q
     )
select 11, 'A11 ★형상 조건부 임계값 해소',
  '수직/미상/계단 = marginal 없음 → 10mm fail, 모따기·경사 = marginal 12.7 → 10mm marginal',
  coalesce(left(string_agg(d, ' ‖ '), 600), '5개 형상 전부 기대와 일치'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- 시드에 threshold_groups 행이 0건이므로 임시로 만들어 평가하고 서브트랜잭션에서 되돌린다.
--  - 옛 fn_eval_group 은 boolean 멤버에서 22P02 로 죽는다(C2).
--  - 형상 게이트가 없으면 형상 미상 관측에 pass 가 나고, fn_resolve_thresholds 가
--    그룹 멤버를 단독 규칙처럼 반환한다(C3).
do $$
declare
  v_rs uuid; v_cls uuid; v_grp uuid;
  v_m_num uuid; v_m_bool uuid; v_prop uuid;
  r_fail text := '(미실행)'; r_pass text := '(미실행)'; r_miss text := '(미실행)';
  r_gate text := '(미실행)'; r_str  text := '(미실행)';
  n_null int := -1; n_stair int := -1;
  v_err text := '';
begin
  select ruleset_id into v_rs from _scope;
  select id into v_cls from robot_classes where code='commercial-cleaner';
  select id into v_prop from finish_properties where code='is_low_reflect';

  begin
    insert into robot_metrics(code, name_ko, unit, subject, measurability, source_text, sort_order)
    values ('_regtest_riser_mm','회귀-계단 라이저','mm','adjacency','partial','회귀 테스트',900)
    returning id into v_m_num;

    insert into robot_metrics(code, name_ko, unit, subject, property_id, property_type,
                              measurability, source_text, sort_order)
    values ('_regtest_low_reflect','회귀-저반사','', 'finish', v_prop, 'boolean',
            'no','회귀 테스트',901)
    returning id into v_m_bool;

    insert into threshold_groups(ruleset_id, class_id, mode, code, name_ko, logic,
                                 applies_profile, source_text)
    values (v_rs, v_cls, 'drive', '_regtest_stair', '회귀-계단 조합규칙', 'all',
            '{stair}'::threshold_profile[], '회귀 테스트')
    returning id into v_grp;

    -- ★ 멤버의 applies_profile 은 일부러 비워 둔다('{}').
    --   형상 제약을 **그룹만** 선언한 상태 — C3 가 실제로 났던 형태다.
    --   멤버에도 '{stair}' 를 달면 멤버 필터가 대신 막아 버려서 그룹 게이트가
    --   있는지 없는지 구분이 안 된다(그 상태로는 게이트를 지워도 통과한다).
    insert into robot_thresholds(ruleset_id, class_id, metric_id, group_id, mode,
                                 applies_profile, comparator, value_type, unit, value, source_text, evidence)
    values (v_rs, v_cls, v_m_num, v_grp, 'drive', '{}'::threshold_profile[],
            'lte','numeric','mm', 200, '회귀 테스트',
            '[{"url":"regtest","quote":"regtest","grade":"A"}]'::jsonb);

    insert into robot_thresholds(ruleset_id, class_id, metric_id, group_id, mode,
                                 applies_profile, comparator, value_type, unit, bool_value, source_text, evidence)
    values (v_rs, v_cls, v_m_bool, v_grp, 'drive', '{}'::threshold_profile[],
            'eq','boolean','', false, '회귀 테스트',
            '[{"url":"regtest","quote":"regtest","grade":"A"}]'::jsonb);

    -- (1) 수치통과 + boolean위반  → fail   (옛 함수는 22P02 로 죽는다)
    begin
      r_fail := fn_eval_group(v_grp,
        '{"_regtest_riser_mm":180,"_regtest_low_reflect":true}'::jsonb, 'stair')::text;
    exception when others then r_fail := 'ERROR ' || sqlstate; end;
    -- (2) 둘 다 통과 → pass
    begin
      r_pass := fn_eval_group(v_grp,
        '{"_regtest_riser_mm":180,"_regtest_low_reflect":false}'::jsonb, 'stair')::text;
    exception when others then r_pass := 'ERROR ' || sqlstate; end;
    -- (3) boolean 관측 누락 → unknown
    begin
      r_miss := fn_eval_group(v_grp, '{"_regtest_riser_mm":180}'::jsonb, 'stair')::text;
    exception when others then r_miss := 'ERROR ' || sqlstate; end;
    -- (4) ★형상 게이트: 형상 미상(profile NULL) 이면 멤버를 보지도 않고 unknown.
    --   게이트가 없으면 멤버(둘 다 통과 관측)를 그대로 평가해 'pass' 가 나온다 —
    --   계단 전용 규칙이 형상 미상 문턱에 합격 도장을 찍는 바로 그 결함이다.
    begin
      r_gate := fn_eval_group(v_grp,
        '{"_regtest_riser_mm":150,"_regtest_low_reflect":false}'::jsonb, null)::text;
    exception when others then r_gate := 'ERROR ' || sqlstate; end;
    -- (5) boolean 자리에 문자열이 오면 캐스트하지 않고 unknown (22P02 로 죽지 않는다)
    begin
      r_str := fn_eval_group(v_grp,
        '{"_regtest_riser_mm":180,"_regtest_low_reflect":"true"}'::jsonb, 'stair')::text;
    exception when others then r_str := 'ERROR ' || sqlstate; end;

    -- (6)(7) fn_resolve_thresholds 가 그룹 멤버를 형상 미상 경계에 흘리면 안 된다
    select count(*) into n_null
      from fn_resolve_thresholds(v_rs, v_cls, 'drive', null) t where t.group_id = v_grp;
    select count(*) into n_stair
      from fn_resolve_thresholds(v_rs, v_cls, 'drive', 'stair') t where t.group_id = v_grp;

    raise exception '__REG_ROLLBACK__';
  exception when others then
    if sqlerrm <> '__REG_ROLLBACK__' then v_err := sqlstate || ' ' || sqlerrm; end if;
  end;

  insert into _reg values (12, 'A12 ★조합규칙: boolean 혼합 + 형상 게이트',
    'stair(수치pass·bool위반)=fail / stair(둘다pass)=pass / bool누락=unknown / 형상미상=unknown / bool자리 문자열=unknown / resolve(형상미상) 그룹멤버 0행 · resolve(stair) 2행',
    format('fail=%s pass=%s miss=%s gate=%s str=%s resolve(null)=%s resolve(stair)=%s%s',
           r_fail, r_pass, r_miss, r_gate, r_str, n_null, n_stair,
           case when v_err='' then '' else ' / 설치예외=' || v_err end),
    case when v_err = '' and r_fail='fail' and r_pass='pass' and r_miss='unknown'
              and r_gate='unknown' and r_str='unknown' and n_null=0 and n_stair=2
         then 'PASS' else 'FAIL' end);
end $$;


-- =============================================================================
-- =============================================================================
select v.label, v.step_abs_mm, rt.mode, rt.value as limit_mm, rt.marginal_value,
       fn_eval_threshold(v.step_abs_mm, rt.comparator, rt.value, rt.marginal_value) as verdict
  from v_space_step v
  join robot_classes rc on rc.code='commercial-cleaner'
  join robot_metrics rm on rm.code='step_height_mm'
  join robot_thresholds rt on rt.class_id=rc.id and rt.metric_id=rm.id
                          and rt.ruleset_id=(select ruleset_id from _scope)
 where v.drawing_id = (select drawing_id from _scope)
 order by rt.mode, v.step_abs_mm desc, v.label;

-- ★ F1 로 '발코니-실외기실 철제여닫이문' 의 기대값이 pass → unknown 으로 갱신됐다.
--   그 0mm 는 발코니 FL 원문 모순(주기13 높은턱 80 / 낮은턱 35) 중 낮은턱을 임의로 고른
--   결과이고, 인접 자체도 basis='inferred' 다. 높은턱 분기면 45mm 라 pass 가 fail 로 뒤집힌다.
--   → 판정 입력(v_space_step.step_abs_mm)이 NULL 이 되어 fn_eval_threshold 가 'unknown' 을 낸다.
--   검사 축은 그대로다: 16행 전량을 모드×라벨로 대조하고, 관대화 변이는 여전히 여기서 죽는다.
insert into _reg
with expect(md, lb, verdict) as (values
  ('clean','거실-주방 개방 경계','pass'),
  ('clean','발코니-실외기실 철제여닫이문','unknown'),
  ('clean','현관 진입 철재여닫이문','fail'),
  ('clean','주방-현관 마감 전환선','fail'),
  ('clean','욕실-현관 벽체 경계(단차)','fail'),
  ('clean','거실-발코니 미서기문','fail'),
  ('clean','욕실문','fail'),
  ('clean','주방-욕실 벽체 경계(단차)','fail'),
  ('drive','거실-주방 개방 경계','pass'),
  ('drive','발코니-실외기실 철제여닫이문','unknown'),
  ('drive','현관 진입 철재여닫이문','fail'),
  ('drive','주방-현관 마감 전환선','fail'),
  ('drive','욕실-현관 벽체 경계(단차)','fail'),
  ('drive','거실-발코니 미서기문','fail'),
  ('drive','욕실문','fail'),
  ('drive','주방-욕실 벽체 경계(단차)','fail')
), actual(md, lb, verdict) as (
  select rt.mode::text, v.label,
         fn_eval_threshold(v.step_abs_mm, rt.comparator, rt.value, rt.marginal_value)::text
    from v_space_step v
    join robot_classes rc on rc.code='commercial-cleaner'
    join robot_metrics rm on rm.code='step_height_mm'
    join robot_thresholds rt on rt.class_id=rc.id and rt.metric_id=rm.id
                            and rt.ruleset_id=(select ruleset_id from _scope)
   where v.drawing_id = (select drawing_id from _scope)
), diff as (
  select 'DB에만: ' || format('%s|%s|%s', md, lb, verdict) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s|%s|%s', md, lb, verdict)
    from (select * from expect except select * from actual) q
)
select 13, 'A13 청소로봇 단차 판정 16행',
  'clean(≤8/marginal10)·drive(≤10/marginal20) 각 8행: 거실-주방 단차0 만 pass, 발코니-실외기실은 모순·추론 위라 unknown, 25/30/50/75/80/80 은 전부 fail',
  coalesce(left(string_agg(d, ' ‖ '), 700), '16행 전부 기대와 일치 (pass 2 / unknown 2 / fail 12)'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select x.label, x.clear_width_mm,
       coalesce(pc.code,'(창호코드 없음)') as 창호코드,
       left(coalesce(x.raw->>'clear_width_unknown_reason',''), 45) as 미상사유
  from space_adjacencies x
  join spaces sa on sa.id = x.space_a_id
  left join project_codes pc on pc.id = x.project_code_id
 where sa.drawing_id = (select drawing_id from _scope)
 order by x.label;

insert into _reg
with expect(lb, cw_null, has_reason, code) as (values
  ('거실-발코니 미서기문',         true, true, 'DPW'),
  ('거실-주방 개방 경계',          true, true, null),
  ('발코니-실외기실 철제여닫이문', true, true, 'SD'),
  ('욕실-현관 벽체 경계(단차)',    true, true, null),
  ('욕실문',                       true, true, null),
  ('주방-욕실 벽체 경계(단차)',    true, true, null),
  ('주방-현관 마감 전환선',        true, true, null),
  ('현관 진입 철재여닫이문',       true, true, 'D-2')
), actual(lb, cw_null, has_reason, code) as (
  select x.label, (x.clear_width_mm is null),
         (coalesce(x.raw->>'clear_width_unknown_reason','') <> ''), pc.code
    from space_adjacencies x
    join spaces sa on sa.id = x.space_a_id
    left join project_codes pc on pc.id = x.project_code_id
   where sa.drawing_id = (select drawing_id from _scope)
), verdicts as (
  -- 유효폭 임계값 4행 × 인접 8행: 전부 unknown 이어야 한다. 하나라도 pass/fail 이 나오면
  -- 어딘가에 제작치수·모듈호칭이 유효폭으로 들어간 것이다.
  select distinct fn_eval_threshold(x.clear_width_mm, rt.comparator, rt.value, rt.marginal_value)::text as v
    from space_adjacencies x join spaces sa on sa.id = x.space_a_id
    join robot_metrics rm on rm.code='clear_width_mm'
    join robot_thresholds rt on rt.metric_id=rm.id and rt.ruleset_id=(select ruleset_id from _scope)
   where sa.drawing_id = (select drawing_id from _scope)
), diff as (
  select 'DB에만: ' || format('%s|null=%s|사유=%s|코드=%s', lb, cw_null, has_reason, coalesce(code,'-')) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s|null=%s|사유=%s|코드=%s', lb, cw_null, has_reason, coalesce(code,'-'))
    from (select * from expect except select * from actual) q
  union all
  select 'unknown 이 아닌 유효폭 판정이 나왔다: ' || v from verdicts where v <> 'unknown'
  union all
  select '유효폭 판정이 한 건도 생성되지 않았다(임계값·인접이 사라졌다)'
    where not exists (select 1 from verdicts)
  -- 욕실 출입구는 도면 어디에도 없다 → 창호코드가 붙으면 안 된다
  union all
  select '욕실문에 창호코드가 붙었다: ' || pc.code
    from space_adjacencies x join spaces sa on sa.id=x.space_a_id
    join project_codes pc on pc.id = x.project_code_id
   where sa.drawing_id=(select drawing_id from _scope) and x.label='욕실문'
)
select 14, 'A14 ★유효 통과폭 전 개구부 미상',
  '8행 전부 clear_width_mm NULL + 미상사유 기록 / 창호코드는 DPW·SD·D-2 3행만 / 유효폭 판정은 전부 unknown / 욕실문 창호코드 없음',
  coalesce(left(string_agg(d, ' ‖ '), 700), '8행 전부 미상 · 판정 전부 unknown'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select m.code as material, fp.code as property, mp.value_type, mp.unit,
       mp.num_value, mp.bool_value, mp.text_value,
       left(coalesce(mp.unknown_reason,'(없음)'), 40) as unknown_reason
  from material_properties mp
  join finish_materials m on m.id = mp.material_id
  join finish_properties fp on fp.id = mp.property_id
 order by m.code, fp.code;

insert into _reg
with expect(mat, prop, vt, un, nv, tv, bv, unk) as (values
  ('block-braille',      'bpn',           'numeric','',  null::double precision, null::text, null::boolean, true),
  ('carpet-tile',        'carpet_pile_mm','numeric','mm',null, null, null, true),
  ('deck-wpc',           'csr',           'numeric','',  null, null, null, true),
  ('sheet-vinyl-cushion','csr_b',         'numeric','',  null, null, null, true),
  ('tile-polished',      'dcof',          'numeric','',  null, null, null, true),
  ('tile-porcelain',     'dcof',          'numeric','',  null, null, null, true),
  ('tile-vitreous',      'csr_b',         'numeric','',  null, null, null, true),
  ('tile-vitreous',      'dcof',          'numeric','',  null, null, null, true)
), actual(mat, prop, vt, un, nv, tv, bv, unk) as (
  select m.code, fp.code, mp.value_type::text, mp.unit, mp.num_value, mp.text_value,
         mp.bool_value, (mp.unknown_reason is not null)
    from material_properties mp
    join finish_materials m on m.id = mp.material_id
    join finish_properties fp on fp.id = mp.property_id
), diff as (
  select 'DB에만: ' || format('%s.%s %s unit=%s num=%s txt=%s bool=%s unk=%s',
           mat,prop,vt,un,nv,tv,bv,unk) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s.%s %s unit=%s num=%s txt=%s bool=%s unk=%s',
           mat,prop,vt,un,nv,tv,bv,unk)
    from (select * from expect except select * from actual) q
  -- 관측값 단위는 물성 등록부와 문자 그대로 같아야 한다
  union all
  select '관측 단위 ≠ 물성 단위: ' || m.code || '.' || fp.code || ' ' || mp.unit || '≠' || coalesce(fp.unit,'')
    from material_properties mp join finish_materials m on m.id=mp.material_id
    join finish_properties fp on fp.id=mp.property_id
   where mp.unit is distinct from coalesce(fp.unit,'')
  -- 요구값이 실측 자리에 들어오면 사유가 남아 있어도 값이 생긴다 → 위 대칭차가 잡는다.
  -- 추가로 "사유만 있고 값이 없다"는 관계 자체를 못박는다.
  union all
  select '값과 사유가 동시에 있다: ' || m.code || '.' || fp.code
    from material_properties mp join finish_materials m on m.id=mp.material_id
    join finish_properties fp on fp.id=mp.property_id
   where mp.unknown_reason is not null
     and num_nonnulls(mp.num_value, mp.text_value, mp.bool_value) > 0
)
select 15, 'A15 ★물성 관측값 8행 전량 (요구값 혼입 금지)',
  '8행 전부 값 NULL + unknown_reason 있음, unit = finish_properties.unit',
  coalesce(left(string_agg(d, ' ‖ '), 700), '8행 전부 "조사했으나 실측 공표값 없음" 상태 유지'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
do $$
declare
  v_mat uuid; v_prop uuid;
  s_in text := '(미실행)'; s_mm text := '(미실행)'; s_col text := '(미실행)';
  v_err text := '';
begin
  select id into v_mat from finish_materials where code='carpet-roll';
  select id into v_prop from finish_properties where code='carpet_pile_mm';

  select case when exists (select 1 from information_schema.columns
                            where table_schema='public' and table_name='material_properties'
                              and column_name='unit') then '있음' else '없음' end
    into s_col;

  begin
    begin
      insert into material_properties(material_id, property_id, value_type, test_cond,
                                      unit, num_value, source_text)
      values (v_mat, v_prop, 'numeric', '', 'in', 0.4, '회귀 테스트 0.4 in');
      s_in := '삽입됨(막히지 않았다)';
    exception when others then s_in := sqlstate; end;

    begin
      insert into material_properties(material_id, property_id, value_type, test_cond,
                                      unit, num_value, source_text)
      values (v_mat, v_prop, 'numeric', '', 'mm', 10.16, '회귀 테스트 10.16 mm');
      s_mm := '삽입됨';
    exception when others then s_mm := sqlstate; end;

    raise exception '__REG_ROLLBACK__';
  exception when others then
    if sqlerrm <> '__REG_ROLLBACK__' then v_err := sqlstate || ' ' || sqlerrm; end if;
  end;

  insert into _reg values (16, 'A16 관측값 단위 가드(23514)',
    'material_properties.unit 컬럼 있음 / unit=''in'' 삽입 → 23514 / unit=''mm'' 삽입 → 성공',
    format('unit컬럼=%s / in→%s / mm→%s%s', s_col, s_in, s_mm,
           case when v_err='' then '' else ' / 예외=' || v_err end),
    case when v_err='' and s_col='있음' and s_in='23514' and s_mm='삽입됨'
         then 'PASS' else 'FAIL' end);
end $$;


-- =============================================================================
-- =============================================================================
do $$
declare
  v_sp uuid; r record;
  accepted text[] := '{}'; rejected text[] := '{}';
  s_adj text := '(미실행)'; s_unit text := '(미실행)';
  v_err text := ''; v_tbl text;
begin
  select drawing_id into v_sp from _scope;
  select id into v_sp from spaces where drawing_id=v_sp and name='거실/침실';
  v_tbl := coalesce(to_regclass('public.space_observations')::text, '(없음)');

  begin
    for r in select rm.id, rm.code, rm.unit from robot_metrics rm
              where rm.subject='space' order by rm.sort_order loop
      begin
        insert into space_observations(space_id, metric_id, subject, value_type, unit,
                                       num_value, basis, basis_note, source_text)
        values (v_sp, r.id, 'space', 'numeric', r.unit, 1234,
                'inferred', '회귀 테스트용 임시 관측', '회귀 테스트');
        accepted := accepted || r.code;
      exception when others then rejected := rejected || (r.code || ':' || sqlstate); end;
    end loop;

    -- subject='adjacency' 지표는 복합 FK 로 거부돼야 한다
    begin
      insert into space_observations(space_id, metric_id, subject, value_type, unit,
                                     num_value, basis, basis_note, source_text)
      select v_sp, rm.id, 'space', 'numeric', rm.unit, 10,
             'inferred', '회귀 테스트', '회귀 테스트'
        from robot_metrics rm where rm.code='step_height_mm';
      s_adj := '삽입됨(막히지 않았다)';
    exception when others then s_adj := sqlstate; end;

    -- 단위 불일치는 23514
    begin
      insert into space_observations(space_id, metric_id, subject, value_type, unit,
                                     num_value, basis, basis_note, source_text)
      select v_sp, rm.id, 'space', 'numeric', 'm', 2.0,
             'inferred', '회귀 테스트', '회귀 테스트'
        from robot_metrics rm where rm.code='turn_width_mm';
      s_unit := '삽입됨(막히지 않았다)';
    exception when others then s_unit := sqlstate; end;

    raise exception '__REG_ROLLBACK__';
  exception when others then
    if sqlerrm <> '__REG_ROLLBACK__' then v_err := sqlstate || ' ' || sqlerrm; end if;
  end;

  insert into _reg values (17, 'A17 space 관측 저장소 (C4)',
    'space_observations 실재 / subject=space 지표 6종 전부 수용(turn_width_mm, rec_path_width_mm, slope_deg, floor_flatness_mm_3m, elevator_car_width_mm, elevator_car_depth_mm) / adjacency 지표 23503 / 단위불일치 23514',
    format('테이블=%s / 수용=%s / 거부=%s / adjacency지표→%s / 단위불일치→%s%s',
           v_tbl, array_to_string(accepted,','), coalesce(array_to_string(rejected,','),'-'),
           s_adj, s_unit, case when v_err='' then '' else ' / 예외=' || v_err end),
    case when v_err='' and v_tbl <> '(없음)'
          and accepted @> array['turn_width_mm','rec_path_width_mm','slope_deg',
                                'floor_flatness_mm_3m','elevator_car_width_mm','elevator_car_depth_mm']
          and array['turn_width_mm','rec_path_width_mm','slope_deg',
                    'floor_flatness_mm_3m','elevator_car_width_mm','elevator_car_depth_mm'] @> accepted
          and s_adj='23503' and s_unit='23514'
         then 'PASS' else 'FAIL' end);
end $$;


-- =============================================================================
-- =============================================================================
do $$
declare
  v_dwg uuid; v_a uuid; v_b uuid;
  s_default text := '(미실행)'; s_sp text := '(미실행)';
  s_conf text := '(미실행)'; s_adj text := '(미실행)';
  v_err text := '';
begin
  select drawing_id into v_dwg from _scope;
  select id into v_a from spaces where drawing_id=v_dwg and name='거실/침실';
  select id into v_b from spaces where drawing_id=v_dwg and name='현관';

  begin
    -- basis 를 지정하지 않으면 'inferred' 여야 한다 (침묵 = 추론)
    begin
      insert into spaces(drawing_id, name, basis_note, source_text)
      values (v_dwg, '_regtest_default', '회귀 테스트용 임시 실', '회귀 테스트');
      select basis::text into s_default from spaces
       where drawing_id=v_dwg and name='_regtest_default';
    exception when others then s_default := 'ERROR ' || sqlstate; end;

    -- inferred + 사유 없음 → 23514
    begin
      insert into spaces(drawing_id, name, basis, source_text)
      values (v_dwg, '_regtest_noNote', 'inferred', '회귀 테스트');
      s_sp := '삽입됨(막히지 않았다)';
    exception when others then s_sp := sqlstate; end;

    -- drawing_confirmed + 사유 없음 → 통과
    begin
      insert into spaces(drawing_id, name, basis, source_text)
      values (v_dwg, '_regtest_conf', 'drawing_confirmed', '회귀 테스트');
      s_conf := '삽입됨';
    exception when others then s_conf := sqlstate; end;

    -- 인접도 같은 규칙
    begin
      insert into space_adjacencies(space_a_id, space_b_id, kind, label, step_mm,
                                    basis, source_text)
      values (v_a, v_b, 'door', '_regtest_noNote', 30, 'inferred', '회귀 테스트');
      s_adj := '삽입됨(막히지 않았다)';
    exception when others then s_adj := sqlstate; end;

    raise exception '__REG_ROLLBACK__';
  exception when others then
    if sqlerrm <> '__REG_ROLLBACK__' then v_err := sqlstate || ' ' || sqlerrm; end if;
  end;

  insert into _reg values (18, 'A18 침묵=추론 · 사유 없는 추론 거부',
    'basis 미지정 → inferred / inferred+사유없음 → 23514(실·인접 양쪽) / drawing_confirmed+사유없음 → 성공',
    format('기본값=%s / 실(사유없음)→%s / 실(확정)→%s / 인접(사유없음)→%s%s',
           s_default, s_sp, s_conf, s_adj,
           case when v_err='' then '' else ' / 예외=' || v_err end),
    case when v_err='' and s_default='inferred' and s_sp='23514'
              and s_conf='삽입됨' and s_adj='23514'
         then 'PASS' else 'FAIL' end);
end $$;


-- =============================================================================
-- =============================================================================
select sp.name as 실, fp.code as 부위, sf.role, sf.layer_no,
       coalesce(m.code,'(미매핑)') as material
  from space_finishes sf
  join spaces sp on sp.id = sf.space_id
  join finish_parts fp on fp.id = sf.part_id
  left join finish_materials m on m.id = sf.material_id
 where sp.drawing_id = (select drawing_id from _scope)
 order by sp.name, fp.code, sf.role, sf.layer_no;

insert into _reg
with expect(sp, pt, rl, ln, mt) as (values
  ('거실/침실','baseboard','base',   1, 'board-gypsum'),
  ('거실/침실','baseboard','finish', 1, 'base-readymade'),
  ('거실/침실','ceiling',  'base',   1, 'frame-light-steel'),
  ('거실/침실','ceiling',  'base',   2, 'board-gypsum'),
  ('거실/침실','ceiling',  'finish', 1, 'wp-silk'),
  ('거실/침실','floor',    'base',   1, null),
  ('거실/침실','floor',    'finish', 1, 'sheet-vinyl-cushion'),
  ('거실/침실','wall',     'base',   1, 'board-gypsum'),
  ('거실/침실','wall',     'finish', 1, 'wp-silk'),
  ('발코니',  'baseboard','base',   1, 'mortar-cement'),
  ('발코니',  'baseboard','finish', 1, 'paint-water-based'),
  ('발코니',  'ceiling',  'finish', 1, 'paint-water-based'),
  ('발코니',  'floor',    'base',   1, 'mortar-waterproof'),
  ('발코니',  'floor',    'base',   2, 'mortar-cement'),
  ('발코니',  'floor',    'finish', 1, 'tile-vitreous'),
  ('발코니',  'wall',     'finish', 1, 'paint-water-based'),
  ('실외기실','baseboard','base',   1, 'mortar-cement'),
  ('실외기실','baseboard','finish', 1, 'paint-water-based'),
  ('실외기실','ceiling',  'finish', 1, 'paint-water-based'),
  ('실외기실','floor',    'base',   1, 'mortar-waterproof'),
  ('실외기실','floor',    'base',   2, 'mortar-cement'),
  ('실외기실','floor',    'finish', 1, 'tile-vitreous'),
  ('실외기실','wall',     'finish', 1, 'paint-water-based'),
  ('욕실',    'ceiling',  'base',   1, 'frame-light-steel'),
  ('욕실',    'ceiling',  'finish', 1, 'panel-abs-bath'),
  ('욕실',    'floor',    'base',   1, 'mortar-self-leveling'),
  ('욕실',    'floor',    'finish', 1, 'tile-vitreous'),
  ('욕실',    'wall',     'base',   1, 'mortar-cement'),
  ('욕실',    'wall',     'finish', 1, 'tile-earthenware'),
  ('주방/식당','baseboard','base',  1, 'board-gypsum'),
  ('주방/식당','baseboard','finish',1, 'base-readymade'),
  ('주방/식당','ceiling',  'base',  1, 'frame-light-steel'),
  ('주방/식당','ceiling',  'base',  2, 'board-gypsum'),
  ('주방/식당','ceiling',  'finish',1, 'wp-silk'),
  ('주방/식당','floor',    'base',  1, null),
  ('주방/식당','floor',    'finish',1, 'sheet-vinyl-cushion'),
  ('주방/식당','wall',     'base',  1, 'board-gypsum-wr'),
  ('주방/식당','wall',     'finish',1, 'wp-silk'),
  ('주방/식당','wall',     'finish',2, 'tile-earthenware'),
  ('현관',    'baseboard','base',   1, 'board-gypsum'),
  ('현관',    'baseboard','finish', 1, 'base-bmc'),
  ('현관',    'ceiling',  'base',   1, 'frame-light-steel'),
  ('현관',    'ceiling',  'base',   2, 'board-gypsum'),
  ('현관',    'ceiling',  'finish', 1, 'wp-silk'),
  ('현관',    'floor',    'base',   1, 'mortar-cement'),
  ('현관',    'floor',    'finish', 1, 'tile-porcelain'),
  ('현관',    'wall',     'base',   1, 'board-gypsum'),
  ('현관',    'wall',     'finish', 1, 'wp-silk')
), actual(sp, pt, rl, ln, mt) as (
  select sp.name, fp.code, sf.role::text, sf.layer_no, m.code
    from space_finishes sf
    join spaces sp on sp.id = sf.space_id
    join finish_parts fp on fp.id = sf.part_id
    left join finish_materials m on m.id = sf.material_id
   where sp.drawing_id = (select drawing_id from _scope)
), diff as (
  select 'DB에만: ' || format('%s/%s/%s#%s=%s', sp,pt,rl,ln,coalesce(mt,'-')) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s/%s/%s#%s=%s', sp,pt,rl,ln,coalesce(mt,'-'))
    from (select * from expect except select * from actual) q
)
select 19, 'A19 space_finishes 48행 전량',
  '기대 48행(실/부위/역할/층번호/마감재) ≡ DB, 대칭차 0 (미매핑 2행 = 패널히팅 포함)',
  coalesce(left(string_agg(d, ' ‖ '), 900), '대칭차 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select pc.code_set, pc.code, pc.kind, coalesce(fp.code,'(부위없음)') as part,
       pc.thickness_mm, pc.height_mm
  from project_codes pc left join finish_parts fp on fp.id = pc.part_id
 where pc.system_id = (select system_id from _scope)
 order by pc.code_set, pc.code;

insert into _reg
with expect(cs, cd, kd, pt, th, ht) as (values
  ('caulking-schedule','코킹-골조조적','other','other', 10.0::double precision, null::double precision),
  ('caulking-schedule','코킹-문틀','other','other', 10.0, null),
  ('caulking-schedule','코킹-외부창호','other','other', 10.0, null),
  ('finish-schedule','B-14','finish_set','baseboard', null, 80.0),
  ('finish-schedule','B-18','finish_set','baseboard', null, 80.0),
  ('finish-schedule','B-7B','finish_set','baseboard', null, 40.0),
  ('finish-schedule','B-9,10','finish_set','baseboard', null, 80.0),
  ('finish-schedule','C-10','finish_set','ceiling', null, null),
  ('finish-schedule','C-6A','finish_set','ceiling', null, 2340.0),
  ('finish-schedule','C-6B','finish_set','ceiling', null, 2300.0),
  ('finish-schedule','C-8','finish_set','ceiling', null, 2200.0),
  ('finish-schedule','F-10B','finish_set','floor', 80.0, null),
  ('finish-schedule','F-11','finish_set','floor', 110.0, null),
  ('finish-schedule','F-12','finish_set','floor', 180.0, null),
  ('finish-schedule','F-14','finish_set','floor', 35.0, null),
  ('finish-schedule','W-12','finish_set','wall', null, null),
  ('finish-schedule','W-14','finish_set','wall', null, null),
  ('finish-schedule','W-15','finish_set','wall', null, null),
  ('finish-schedule','W-7,8,9','finish_set','wall', null, null),
  ('insulation-schedule','2','insulation','other', 100.0, null),
  ('insulation-schedule','6','insulation','other', null, null),
  ('wall-limit','A','finish_set','wall', 9.5, null),
  ('wall-limit','B','finish_set','wall', null, null),
  ('wall-limit','C','finish_set','wall', 15.0, null),
  ('wall-limit','D','finish_set','wall', 9.5, null),
  ('wall-limit','F','finish_set','wall', 9.5, null),
  ('wall-limit','G','finish_set','wall', null, null),
  ('wall-limit','R','finish_set','wall', 4.5, null),
  ('waterproof-schedule','시멘트 액체방수(복도)','waterproof','other', 4.0, null),
  ('waterproof-schedule','시멘트 액체방수(욕실)','waterproof','other', 4.0, null),
  ('waterproof-schedule','폴리머모르타르','waterproof','other', 10.0, null),
  ('window-schedule','AG','opening','other', null, null),
  ('window-schedule','BP','opening','other', null, null),
  ('window-schedule','D-2','opening','other', null, null),
  ('window-schedule','DPW','opening','other', null, null),
  ('window-schedule','SD','opening','other', null, null)
), actual(cs, cd, kd, pt, th, ht) as (
  select pc.code_set, pc.code, pc.kind::text, fp.code, pc.thickness_mm, pc.height_mm
    from project_codes pc left join finish_parts fp on fp.id = pc.part_id
   where pc.system_id = (select system_id from _scope)
), diff as (
  select 'DB에만: ' || format('%s/%s %s %s t=%s h=%s', cs,cd,kd,coalesce(pt,'-'),th,ht) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s/%s %s %s t=%s h=%s', cs,cd,kd,coalesce(pt,'-'),th,ht)
    from (select * from expect except select * from actual) q
  union all
  select '부위 미배정 코드: ' || pc.code from project_codes pc
   where pc.system_id = (select system_id from _scope) and pc.part_id is null
  union all
  select '도면 미연결 코드: ' || pc.code from project_codes pc
   where pc.system_id = (select system_id from _scope)
     and pc.drawing_id is distinct from (select drawing_id from _scope)
)
select 20, 'A20 project_codes 36행 전량',
  '기대 36행(코드셋/코드/종류/부위/두께/높이) ≡ DB, part_id NULL 0, 전 행이 이 도면에 연결',
  coalesce(left(string_agg(d, ' ‖ '), 800), '대칭차 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select pc.code, pcl.role, pcl.layer_no, coalesce(m.code,'(미매핑)') as material,
       pcl.thickness_mm, pcl.confidence
  from project_code_layers pcl
  join project_codes pc on pc.id = pcl.project_code_id
  left join finish_materials m on m.id = pcl.material_id
 where pc.system_id = (select system_id from _scope)
 order by pc.code, pcl.role, pcl.layer_no;

insert into _reg
with expect(cd, rl, ln, mt, th) as (values
  ('B-14','base',   1,'mortar-cement',        null::double precision),
  ('B-14','finish', 1,'paint-water-based',    null),
  ('B-18','base',   1,'mortar-cement',        null),
  ('B-18','finish', 1,'paint-water-based',    null),
  ('B-7B','base',   1,'board-gypsum',         9.5),
  ('B-7B','finish', 1,'base-bmc',             null),
  ('B-9,10','base', 1,'board-gypsum',         9.5),
  ('B-9,10','finish',1,'base-readymade',      null),
  ('C-10','finish', 1,'paint-water-based',    null),
  ('C-6A','base',   1,'frame-light-steel',    null),
  ('C-6A','base',   2,'board-gypsum',         9.5),
  ('C-6A','finish', 1,'wp-silk',              null),
  ('C-6B','base',   1,'frame-light-steel',    null),
  ('C-6B','base',   2,'board-gypsum',         9.5),
  ('C-6B','finish', 1,'wp-silk',              null),
  ('C-8','base',    1,'frame-light-steel',    null),
  ('C-8','finish',  1,'panel-abs-bath',       null),
  ('F-10B','base',  1,'mortar-cement',        null),
  ('F-10B','finish',1,'tile-porcelain',       null),
  ('F-11','base',   1, null,                  null),
  ('F-11','finish', 1,'sheet-vinyl-cushion',  6.0),
  ('F-12','base',   1,'mortar-self-leveling', 60.0),
  ('F-12','finish', 1,'tile-vitreous',        null),
  ('F-14','base',   1,'mortar-waterproof',    10.0),
  ('F-14','base',   2,'mortar-cement',        null),
  ('F-14','finish', 1,'tile-vitreous',        null),
  ('W-12','base',   1,'mortar-cement',        null),
  ('W-12','finish', 1,'tile-earthenware',     null),
  ('W-14','base',   1,'board-gypsum-wr',      9.5),
  ('W-14','finish', 1,'wp-silk',              null),
  ('W-14','finish', 2,'tile-earthenware',     null),
  ('W-15','finish', 1,'paint-water-based',    null),
  ('W-7,8,9','base',1,'board-gypsum',         9.5),
  ('W-7,8,9','finish',1,'wp-silk',            null)
), actual(cd, rl, ln, mt, th) as (
  select pc.code, pcl.role::text, pcl.layer_no, m.code, pcl.thickness_mm
    from project_code_layers pcl
    join project_codes pc on pc.id = pcl.project_code_id
    left join finish_materials m on m.id = pcl.material_id
   where pc.system_id = (select system_id from _scope)
), diff as (
  select 'DB에만: ' || format('%s/%s#%s=%s t=%s', cd,rl,ln,coalesce(mt,'-'),th) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s/%s#%s=%s t=%s', cd,rl,ln,coalesce(mt,'-'),th)
    from (select * from expect except select * from actual) q
  -- 미매핑 층은 confidence='unmapped' 여야 한다(013 CHECK 의 회귀)
  union all
  select '미매핑인데 confidence≠unmapped: ' || pc.code
    from project_code_layers pcl join project_codes pc on pc.id=pcl.project_code_id
   where pc.system_id=(select system_id from _scope)
     and (pcl.material_id is null) <> (pcl.confidence = 'unmapped')
)
select 21, 'A21 project_code_layers 34행 전량',
  '기대 34행(코드/역할/층번호/마감재/두께) ≡ DB, 미매핑 ⇔ confidence=unmapped',
  coalesce(left(string_agg(d, ' ‖ '), 800), '대칭차 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select f.code, coalesce(pf.code,'(root)') as parent, f.name_ko, f.basis
  from material_families f left join material_families pf on pf.id = f.parent_id
 order by coalesce(pf.code,''), f.sort_order;

insert into _reg
with expect_fam(cd, pr, nm) as (values
  ('carpet-raised',      null,           '카펫·이중바닥'),
  ('ceramic-tile',       null,           '도자기질계(타일)'),
  ('coating',            null,           '도장계'),
  ('metal-frame',        null,           '금속판·바탕틀계'),
  ('mineral-board',      null,           '무기질계 보드'),
  ('molded-panel',       null,           '성형 판넬계'),
  ('polymer-sheet',      null,           '합성고분자계'),
  ('polymer-sheet-roll','polymer-sheet','합성고분자 시트류'),
  ('polymer-sheet-tile','polymer-sheet','합성고분자 타일류'),
  ('stone',              null,           '석재계'),
  ('wallpaper',          null,           '도배계'),
  ('waterproof',         null,           '방수계'),
  ('wet-plaster',        null,           '미장·현장타설계'),
  ('wood-based',         null,           '목질계')
), actual_fam(cd, pr, nm) as (
  select f.code, pf.code, f.name_ko
    from material_families f left join material_families pf on pf.id = f.parent_id
), expect_mat(mt, fm) as (values
  ('base-bmc','molded-panel'),('base-readymade','molded-panel'),
  ('block-braille','ceramic-tile'),('board-crc','mineral-board'),
  ('board-fiber-cement','mineral-board'),('board-gypsum','mineral-board'),
  ('board-gypsum-wr','mineral-board'),('carpet-roll','carpet-raised'),
  ('carpet-tile','carpet-raised'),('coat-concrete-hardener','coating'),
  ('coat-elastic','coating'),('coat-epoxy-lining','coating'),
  ('coat-epoxy-mortar','coating'),('coat-urethane','coating'),
  ('concrete-exposed','wet-plaster'),('deck-wpc','wood-based'),
  ('frame-light-steel','metal-frame'),('mar-fiber-gangmaru','wood-based'),
  ('mar-laminate','wood-based'),('mar-ply-gangmaru','wood-based'),
  ('mar-plywood','wood-based'),('mar-solid','wood-based'),
  ('mar-spc','polymer-sheet-tile'),('mortar-cement','wet-plaster'),
  ('mortar-self-leveling','wet-plaster'),('mortar-waterproof','wet-plaster'),
  ('paint-water-based','coating'),('panel-abs-bath','molded-panel'),
  ('raised-floor','carpet-raised'),('sheet-edu-cushion','polymer-sheet-roll'),
  ('sheet-homogeneous','polymer-sheet-roll'),('sheet-vinyl-cushion','polymer-sheet-roll'),
  ('sheet-vinyl-standard','polymer-sheet-roll'),('stone-granite','stone'),
  ('tile-artificial-marble','stone'),('tile-conductive','polymer-sheet-tile'),
  ('tile-deco','polymer-sheet-tile'),('tile-deluxe','polymer-sheet-tile'),
  ('tile-earthenware','ceramic-tile'),('tile-lvt','polymer-sheet-tile'),
  ('tile-natural-stone','stone'),('tile-polished','ceramic-tile'),
  ('tile-porcelain','ceramic-tile'),('tile-rubber','polymer-sheet-tile'),
  ('tile-stoneware','ceramic-tile'),('tile-terrazzo','stone'),
  ('tile-vct','polymer-sheet-tile'),('tile-vitreous','ceramic-tile'),
  ('wp-cement-liquid','waterproof'),('wp-paper','wallpaper'),
  ('wp-polymer-mortar','waterproof'),('wp-silk','wallpaper')
), actual_mat(mt, fm) as (
  select m.code, f.code from finish_materials m join material_families f on f.id = m.family_id
), diff as (
  select '계열 DB에만: ' || format('%s←%s(%s)', cd, coalesce(pr,'root'), nm) as d
    from (select * from actual_fam except select * from expect_fam) q
  union all
  select '계열 기대에만: ' || format('%s←%s(%s)', cd, coalesce(pr,'root'), nm)
    from (select * from expect_fam except select * from actual_fam) q
  union all
  select '배정 DB에만: ' || mt || '→' || fm
    from (select * from actual_mat except select * from expect_mat) q
  union all
  select '배정 기대에만: ' || mt || '→' || fm
    from (select * from expect_mat except select * from actual_mat) q
)
select 22, 'A22 계열 트리 14행 + 제품군 배정 52행',
  '기대 계열 14행(코드/부모/이름) ≡ DB, 기대 배정 52행(제품군→계열) ≡ DB, 대칭차 0',
  coalesce(left(string_agg(d, ' ‖ '), 900), '계열·배정 모두 대칭차 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select part_code, family_depth, family_path, material_code, role
  from v_finish_taxonomy order by part_order, family_path, material_code limit 12;

insert into _reg
with expect_path(fm, dep, pth) as (values
  ('carpet-raised',      1,'카펫·이중바닥'),
  ('ceramic-tile',       1,'도자기질계(타일)'),
  ('coating',            1,'도장계'),
  ('metal-frame',        1,'금속판·바탕틀계'),
  ('mineral-board',      1,'무기질계 보드'),
  ('molded-panel',       1,'성형 판넬계'),
  ('polymer-sheet-roll', 2,'합성고분자계 > 합성고분자 시트류'),
  ('polymer-sheet-tile', 2,'합성고분자계 > 합성고분자 타일류'),
  ('stone',              1,'석재계'),
  ('wallpaper',          1,'도배계'),
  ('waterproof',         1,'방수계'),
  ('wet-plaster',        1,'미장·현장타설계'),
  ('wood-based',         1,'목질계')
), mp_expect(mt, pt) as (
  select m.code, p.code from material_parts mp
   join finish_materials m on m.id=mp.material_id join finish_parts p on p.id=mp.part_id
), v_pairs(mt, pt) as (select material_code, part_code from v_finish_taxonomy),
   v_paths(fm, dep, pth) as (select distinct family_code, family_depth, family_path from v_finish_taxonomy),
   diff as (
  -- 뷰가 material_parts 를 정확히 반영해야 한다(행 하나도 더도 덜도 아니게)
  select '뷰에만: ' || mt || '@' || pt as d from (select * from v_pairs except select * from mp_expect) q
  union all
  select 'material_parts 에만: ' || mt || '@' || pt from (select * from mp_expect except select * from v_pairs) q
  -- 계열 경로가 트리에서 조립된 문자열과 같아야 한다
  union all
  select '경로 뷰에만: ' || format('%s(%s) %s', fm, dep, pth)
    from (select * from v_paths except select * from expect_path) q
  union all
  select '경로 기대에만: ' || format('%s(%s) %s', fm, dep, pth)
    from (select * from expect_path except select * from v_paths) q
  union all
  select 'NULL 포함 행: ' || coalesce(material_code,'?') from v_finish_taxonomy
   where part_code is null or family_path is null or material_code is null
)
select 23, 'A23 v_finish_taxonomy 조립 무결성',
  '뷰의 (제품군,부위) ≡ material_parts, 뷰의 (계열,깊이,경로) ≡ 트리에서 조립한 13개 경로, NULL 행 0',
  coalesce(left(string_agg(d, ' ‖ '), 800), '뷰 조립 정상'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select sp.name as 실, m.code as material_code, m.name_ko as 마감재,
       sf.raw_text as 도면원문, sf.confidence
  from spaces sp
  join drawings d         on d.id = sp.drawing_id
  join space_finishes sf  on sf.space_id = sp.id
  join finish_parts fp    on fp.id = sf.part_id and fp.code = 'floor'
  join finish_materials m on m.id = sf.material_id
 where d.id = (select drawing_id from _scope) and sf.role = 'finish'
 order by sp.name;

insert into _reg
with expect(sp, mt) as (values
  ('거실/침실','sheet-vinyl-cushion'),
  ('발코니',  'tile-vitreous'),
  ('실외기실','tile-vitreous'),
  ('욕실',    'tile-vitreous'),
  ('주방/식당','sheet-vinyl-cushion'),
  ('현관',    'tile-porcelain')
), actual(sp, mt) as (
  select sp.name, m.code
    from spaces sp
    join drawings d         on d.id = sp.drawing_id
    join space_finishes sf  on sf.space_id = sp.id
    join finish_parts fp    on fp.id = sf.part_id and fp.code = 'floor'
    join finish_materials m on m.id = sf.material_id
   where d.id = (select drawing_id from _scope) and sf.role = 'finish'
), diff as (
  select 'DB에만: ' || sp || '→' || mt as d from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || sp || '→' || mt from (select * from expect except select * from actual) q
  union all
  select '한 실에 바닥 마감이 둘 이상: ' || sp from (
    select sp from actual group by sp having count(*) > 1) q
)
select 24, 'A24 실별 바닥 마감재 (조인 4개)',
  '기대 6행(거실/침실·주방/식당=sheet-vinyl-cushion, 발코니·실외기실·욕실=tile-vitreous, 현관=tile-porcelain) ≡ DB',
  coalesce(left(string_agg(d, ' ‖ '), 500), '6행 전부 일치 · 실당 1행'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- ★★ 4라운드 추가분 (A25~A37) — 3라운드 검증자가 실측한 회귀 공백 G1~G11 을 메운다.
--    각 단언은 "변이를 심고 게이트를 돌려 exit 1 이 나오는 것"을 확인한 뒤 남겼다.
--    기존 24건은 손대지 않았다(A08·A13 의 F1 갱신은 앞 담당자 것).
-- =============================================================================


-- =============================================================================
-- =============================================================================
-- G1: 29개 임계값 중 10개가 gte(하한)인데 **gte 분기의 부등호를 통째로 뒤집어도**
--   24건이 전부 통과했다. 시드 관측값이 전부 NULL 이라 gte 가 한 번도 평가되지
--   않았기 때문이다. 여기서는 데이터가 아니라 **함수 자체**를 진리표로 못박는다.
--   경계값(=limit), 완충 경계(=marginal), 완충 없음, NULL 전파, boolean 오버로드,
--   그리고 boolean 에 무의미한 연산자가 'unknown' 인지까지 본다.
select 'lte' op, fn_eval_threshold(5.0,'lte',5.0)   v_경계,
       fn_eval_threshold(5.0001,'lte',5.0) v_초과,
       fn_eval_threshold(10.0,'lte',5.0,12.7) v_완충
union all
select 'gte', fn_eval_threshold(800.0,'gte',800.0),
       fn_eval_threshold(799.0,'gte',800.0),
       fn_eval_threshold(600.0,'gte',800.0,450.0);

insert into _reg
with num_cases(id, val, op, lim, mrg, expect) as (values
  -- lte (상한) — 시드 19행이 쓰는 분기
  ('lte 경계값=한계',        5.0::double precision,'lte'::comparator_op,   5.0::double precision,  null::double precision,'pass'),
  ('lte 한계 바로 위',       5.0001,               'lte',                  5.0,                    null,                  'fail'),
  ('lte 완충 안',            10.0,                 'lte',                  5.0,                    12.7,                  'marginal'),
  ('lte 완충 경계',          12.7,                 'lte',                  5.0,                    12.7,                  'marginal'),
  ('lte 완충 밖',            12.71,                'lte',                  5.0,                    12.7,                  'fail'),
  ('lte 완충 있어도 통과',   5.0,                  'lte',                  5.0,                    12.7,                  'pass'),
  -- lt (미만)
  ('lt 경계값은 불통',       5.0,                  'lt',                   5.0,                    null,                  'fail'),
  ('lt 미만은 통과',         4.9999,               'lt',                   5.0,                    null,                  'pass'),
  ('lt 완충 안',             6.0,                  'lt',                   5.0,                    7.0,                   'marginal'),
  ('lt 완충 경계는 불통',    7.0,                  'lt',                   5.0,                    7.0,                   'fail'),
  -- ★ gte (하한) — 시드 10행이 선언만 하고 한 번도 평가되지 않던 분기
  ('gte 경계값=한계',        800.0,                'gte',                  800.0,                  null,                  'pass'),
  ('gte 한계 바로 아래',     799.0,                'gte',                  800.0,                  null,                  'fail'),
  ('gte 넉넉히 초과',        1500.0,               'gte',                  800.0,                  null,                  'pass'),
  ('gte 완충 안',            600.0,                'gte',                  800.0,                  450.0,                 'marginal'),
  ('gte 완충 경계',          450.0,                'gte',                  800.0,                  450.0,                 'marginal'),
  ('gte 완충 밖',            449.9,                'gte',                  800.0,                  450.0,                 'fail'),
  ('gte 완충 있어도 통과',   800.0,                'gte',                  800.0,                  450.0,                 'pass'),
  -- gt (초과)
  ('gt 경계값은 불통',       800.0,                'gt',                   800.0,                  null,                  'fail'),
  ('gt 초과는 통과',         800.0001,             'gt',                   800.0,                  null,                  'pass'),
  ('gt 완충 안',             600.0,                'gt',                   800.0,                  450.0,                 'marginal'),
  ('gt 완충 경계는 불통',    450.0,                'gt',                   800.0,                  450.0,                 'fail'),
  -- eq/neq 는 수치에 의미가 없다 → 'unknown' (통과로 흘리지 않는다)
  ('수치 eq 는 unknown',     5.0,                  'eq',                   5.0,                    null,                  'unknown'),
  ('수치 neq 는 unknown',    5.0,                  'neq',                  9.0,                    null,                  'unknown'),
  -- NULL 전파: "근거 없으면 통과" 로 흘리지 않는다
  ('관측 NULL',              null,                 'lte',                  5.0,                    null,                  'unknown'),
  ('임계 NULL',              5.0,                  'lte',                  null,                   null,                  'unknown'),
  ('관측 NULL(gte)',         null,                 'gte',                  800.0,                  450.0,                 'unknown'),
  ('임계 NULL(gte)',         600.0,                'gte',                  null,                   450.0,                 'unknown')
), bool_cases(id, val, op, lim, expect) as (values
  ('bool eq 일치',           true,  'eq'::comparator_op,  true,  'pass'),
  ('bool eq 불일치',         true,  'eq',                 false, 'fail'),
  ('bool eq 불일치(역)',     false, 'eq',                 true,  'fail'),
  ('bool neq 다름',          true,  'neq',                false, 'pass'),
  ('bool neq 같음',          true,  'neq',                true,  'fail'),
  ('bool 관측 NULL',         null,  'eq',                 true,  'unknown'),
  ('bool 임계 NULL',         true,  'eq',                 null,  'unknown'),
  ('bool lte 는 무의미',     true,  'lte',                false, 'unknown'),
  ('bool gte 는 무의미',     true,  'gte',                true,  'unknown')
), diff as (
  select format('수치 [%s]: 기대 %s ≠ 실제 %s', id, expect,
                fn_eval_threshold(val, op, lim, mrg)::text) as d
    from num_cases where fn_eval_threshold(val, op, lim, mrg)::text <> expect
  union all
  select format('불린 [%s]: 기대 %s ≠ 실제 %s', id, expect,
                fn_eval_threshold(val, op, lim)::text)
    from bool_cases where fn_eval_threshold(val, op, lim)::text <> expect
)
select 25, 'A25 ★fn_eval_threshold 진리표 36건',
  '수치 27건(lte6·lt4·gte7·gt4·eq/neq2·NULL4) + 불린 9건 전부 기대 판정과 일치',
  coalesce(left(string_agg(d, ' ‖ '), 800), '36건 전부 일치 · 6개 비교자 전 분기 평가됨'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- G2: 013 의 복합 FK·CHECK 를 지워도 데이터가 그대로면 24건이 통과했다.
--   → pg_constraint / pg_trigger 에 **가드가 실재하는가**를 직접 묻는다.
--   ⚠ 부분집합(⊆) 검사다. 새 제약이 추가되는 것은 막지 않는다(스코프 원칙 4).
-- ⚠ 교차 변이: F7 가드를 트리거→CHECK 로 되돌리면 판정 동작은 같아 게이트가 초록이지만
--   pg_dump 가 함수 호출 CHECK 를 CREATE TABLE 안에 인라인으로 뱉어 restore 가 깨진다.
--   → assessment_findings 의 CHECK 정의에 사용자 정의 함수 호출이 없음을 단언한다.
select conrelid::regclass::text as tbl, conname, contype::text
  from pg_constraint
 where connamespace = 'public'::regnamespace
   and conname in ('space_finishes_material_id_part_id_fkey',
                   'space_adjacencies_clear_width_bound_check',
                   'space_adjacencies_step_range_check')
 order by 1, 2;

insert into _reg
with need_con(tbl, con) as (values
  -- G2 가 명시한 것: 바닥타일을 천장 마감으로 넣는 것을 막는 복합 FK
  ('space_finishes','space_finishes_material_id_part_id_fkey'),
  ('space_finishes','space_finishes_check'),
  -- F5: 제작치수를 유효 통과폭 칸에 넣는 경로를 구조로 닫은 상한 제약
  ('space_adjacencies','space_adjacencies_clear_width_bound_check'),
  -- F6: 판정 입력 컬럼의 값 범위 (Infinity·음수·NaN)
  ('space_adjacencies','space_adjacencies_clear_width_range_check'),
  ('space_adjacencies','space_adjacencies_clear_width_max_range_check'),
  ('space_adjacencies','space_adjacencies_gap_width_range_check'),
  ('space_adjacencies','space_adjacencies_step_range_check'),
  -- 침묵=추론 (A18 의 구조적 뒷받침)
  ('space_adjacencies','space_adjacencies_basis_note_check'),
  ('spaces','spaces_basis_note_check'),
  ('space_adjacencies','space_adjacencies_check'),
  ('space_adjacencies','space_adjacencies_check1'),
  -- 물성·관측의 타입/주체 복합 FK
  ('material_properties','material_properties_property_id_value_type_fkey'),
  ('space_observations','space_observations_metric_id_subject_fkey'),
  ('space_observations','space_observations_subject_check'),
  ('robot_metrics','robot_metrics_property_id_property_type_fkey'),
  ('assessment_findings','assessment_findings_metric_id_subject_fkey'),
  ('assessment_findings','assessment_findings_check'),
  ('assessment_findings','assessment_findings_check1'),
  -- 그룹 멤버가 그룹의 (기준세트·등급·모드) 를 벗어나지 못하게 하는 복합 FK
  ('robot_thresholds','robot_thresholds_group_id_ruleset_id_class_id_mode_fkey'),
  ('project_code_layers','project_code_layers_check')
), need_trg(tbl, trg) as (values
  ('assessment_findings','trg_assessment_finding_guard'),   -- F7
  ('space_adjacencies','trg_space_adjacency_normalize'),     -- C1 / G3
  ('material_properties','trg_material_property_guard'),
  ('robot_metrics','trg_robot_metric_guard'),
  ('robot_thresholds','trg_robot_threshold_guard'),
  ('space_observations','trg_space_observation_guard'),
  ('finish_materials','trg_finish_material_guard')
), have_con(tbl, con) as (
  select conrelid::regclass::text, conname from pg_constraint
   where connamespace = 'public'::regnamespace
), have_trg(tbl, trg, def) as (
  select tgrelid::regclass::text, tgname, pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal
), diff as (
  select '제약이 사라졌다: ' || tbl || '.' || con as d
    from (select * from need_con except select * from have_con) q(tbl, con)
  union all
  select '트리거가 사라졌다: ' || tbl || '.' || trg
    from (select tbl, trg from need_trg except select tbl, trg from have_trg) q(tbl, trg)
  -- ★ G3 의 구조적 축: 'before insert or update' 를 'before insert' 로 좁히면 여기서 걸린다
  --   (A28 이 같은 것을 동작으로 다시 잡는다 — 두 겹이다).
  union all
  select '트리거가 UPDATE 경로를 잃었다: ' || h.tbl || '.' || h.trg
    from need_trg n join have_trg h on h.tbl = n.tbl and h.trg = n.trg
   where h.def !~ 'BEFORE INSERT OR UPDATE'
  -- ★ 교차 변이: 판정 로직을 CHECK 로 되돌리면 pg_dump→restore 가 깨진다
  union all
  select 'assessment_findings CHECK 이 사용자 정의 함수를 부른다(restore 가 깨진다): ' || conname
    from pg_constraint
   where conrelid = 'assessment_findings'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ~ 'fn_[a-z_]+\('
  -- F2: 등급이 자기 임계값의 운용 모드를 선언하는 컬럼
  union all
  select 'robot_classes.default_mode 컬럼이 없다'
   where not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='robot_classes'
                        and column_name='default_mode')
)
select 26, 'A26 ★구조 가드 존재 (제약 20종 · 트리거 7종)',
  '복합FK·범위CHECK·상한CHECK·사유CHECK 20종 + BEFORE INSERT OR UPDATE 트리거 7종 실재 / assessment_findings CHECK 에 함수 호출 없음 / robot_classes.default_mode 있음',
  coalesce(left(string_agg(d, ' ‖ '), 800), '가드 27종 전부 실재 · CHECK 에 함수 호출 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- 존재만 보면 제약을 "항상 참" 으로 다시 써도 통과한다. 여기서는 실제로 위반 행을
-- 밀어 넣어 거부/수용을 값으로 본다. 전부 서브트랜잭션 안에서 하고 되돌린다.
do $$
declare
  v_dwg uuid; v_rs uuid; v_cls uuid; v_liv uuid;
  v_m_step uuid; v_asmt uuid; v_adj1 uuid; v_adj2 uuid; v_adj3 uuid;
  r jsonb := '{}'::jsonb;
  v_err text := '';
begin
  select drawing_id, ruleset_id into v_dwg, v_rs from _scope;
  select id into v_cls from robot_classes where code='commercial-cleaner';
  select id into v_liv from spaces where drawing_id=v_dwg and name='거실/침실';
  select id into v_m_step from robot_metrics where code='step_height_mm';
  select x.id into v_adj1 from space_adjacencies x join spaces s on s.id=x.space_a_id
    where s.drawing_id=v_dwg and x.label='욕실문';
  select x.id into v_adj2 from space_adjacencies x join spaces s on s.id=x.space_a_id
    where s.drawing_id=v_dwg and x.label='주방-현관 마감 전환선';
  select x.id into v_adj3 from space_adjacencies x join spaces s on s.id=x.space_a_id
    where s.drawing_id=v_dwg and x.label='거실-주방 개방 경계';

  begin
    -- (1) G2: 바닥·벽 전용 제품군(tile-porcelain)을 천장 마감으로 → 복합 FK 23503
    begin
      insert into space_finishes(space_id, part_id, role, layer_no, material_id,
                                 confidence, source_text)
      select v_liv, fp.id, 'finish', 9, m.id, 'exact', '회귀 테스트'
        from finish_parts fp, finish_materials m
       where fp.code='ceiling' and m.code='tile-porcelain';
      r := r || '{"천장에 바닥타일":"삽입됨(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('천장에 바닥타일', sqlstate); end;
    -- (1-대조) 같은 제품군을 바닥에 넣는 것은 통과해야 한다(가드가 과잉이 아님)
    begin
      insert into space_finishes(space_id, part_id, role, layer_no, material_id,
                                 confidence, source_text)
      select v_liv, fp.id, 'finish', 9, m.id, 'exact', '회귀 테스트'
        from finish_parts fp, finish_materials m
       where fp.code='floor' and m.code='tile-porcelain';
      r := r || '{"바닥에 바닥타일":"삽입됨"}';
    exception when others then r := r || jsonb_build_object('바닥에 바닥타일', sqlstate); end;

    -- (2) F5: 6쪽 창호일람표의 제작치수를 유효 통과폭 칸에 주입 → 23514
    begin
      update space_adjacencies set clear_width_mm = 1990
       where id = (select x.id from space_adjacencies x join spaces s on s.id=x.space_a_id
                    where s.drawing_id=v_dwg and x.label='거실-발코니 미서기문');
      r := r || '{"제작치수1990 주입":"통과(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('제작치수1990 주입', sqlstate); end;
    -- (2-b) 상한이 정의되지 않은 경계(욕실문)에는 유효폭 자체를 못 넣는다
    begin
      update space_adjacencies set clear_width_mm = 700 where id = v_adj1;
      r := r || '{"상한없는 경계에 유효폭":"통과(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('상한없는 경계에 유효폭', sqlstate); end;
    -- (2-대조) 상한(1000)보다 작은 값은 들어간다
    begin
      update space_adjacencies set clear_width_mm = 900
       where id = (select x.id from space_adjacencies x join spaces s on s.id=x.space_a_id
                    where s.drawing_id=v_dwg and x.label='현관 진입 철재여닫이문');
      r := r || '{"상한 미만 유효폭":"통과"}';
    exception when others then r := r || jsonb_build_object('상한 미만 유효폭', sqlstate); end;

    -- (3) F6: Infinity · 음수 · NaN → 23514
    begin
      update space_adjacencies set gap_width_mm = 'Infinity'::double precision where id = v_adj1;
      r := r || '{"gap=Infinity":"통과(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('gap=Infinity', sqlstate); end;
    begin
      update space_adjacencies set gap_width_mm = -5 where id = v_adj1;
      r := r || '{"gap=음수":"통과(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('gap=음수', sqlstate); end;
    begin
      update space_adjacencies set gap_width_mm = 'NaN'::double precision where id = v_adj1;
      r := r || '{"gap=NaN":"통과(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('gap=NaN', sqlstate); end;
    begin
      update space_adjacencies set step_mm = 'Infinity'::double precision where id = v_adj1;
      r := r || '{"step=Infinity":"통과(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('step=Infinity', sqlstate); end;

    -- (4) F7: 판정과 값의 정합. 보고서에 남는 거짓 pass 를 막는 자리다.
    insert into passability_assessments(drawing_id, ruleset_id, class_id, mode,
                                        applied_ruleset, engine_version)
    values (v_dwg, v_rs, v_cls, 'clean', fn_ruleset_snapshot(v_rs), '회귀 테스트')
    returning id into v_asmt;

    -- 4-a 거짓 pass: 80mm 를 lte 5mm 로 재고 pass 라 우긴다 → 23514
    begin
      insert into assessment_findings(assessment_id, metric_id, subject, adjacency_id,
                                      observed_value, threshold_value, comparator, verdict, reason_text)
      values (v_asmt, v_m_step, 'adjacency', v_adj1, 80, 5, 'lte', 'pass', '회귀 테스트');
      r := r || '{"거짓 pass":"삽입됨(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('거짓 pass', sqlstate); end;
    -- 4-b 거짓 marginal: 엄격 비교가 pass 인데 marginal 이라 우긴다 → 23514
    begin
      insert into assessment_findings(assessment_id, metric_id, subject, adjacency_id,
                                      observed_value, threshold_value, comparator, verdict, reason_text)
      values (v_asmt, v_m_step, 'adjacency', v_adj1, 3, 5, 'lte', 'marginal', '회귀 테스트');
      r := r || '{"거짓 marginal":"삽입됨(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('거짓 marginal', sqlstate); end;
    -- 4-c ★gte 방향 거짓 pass: 600mm 를 gte 800mm 로 재고 pass → 23514 (G1 과 맞물린다)
    begin
      insert into assessment_findings(assessment_id, metric_id, subject, adjacency_id,
                                      observed_value, threshold_value, comparator, verdict, reason_text)
      values (v_asmt, v_m_step, 'adjacency', v_adj1, 600, 800, 'gte', 'pass', '회귀 테스트');
      r := r || '{"gte 거짓 pass":"삽입됨(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('gte 거짓 pass', sqlstate); end;
    -- 4-d 옳은 fail 은 들어간다
    begin
      insert into assessment_findings(assessment_id, metric_id, subject, adjacency_id,
                                      observed_value, threshold_value, comparator, verdict, reason_text)
      values (v_asmt, v_m_step, 'adjacency', v_adj1, 80, 5, 'lte', 'fail', '회귀 테스트');
      r := r || '{"옳은 fail":"삽입됨"}';
    exception when others then r := r || jsonb_build_object('옳은 fail', sqlstate); end;
    -- 4-e 완충 marginal(엄격 비교가 fail 인 구간)은 들어간다
    begin
      insert into assessment_findings(assessment_id, metric_id, subject, adjacency_id,
                                      observed_value, threshold_value, comparator, verdict, reason_text)
      values (v_asmt, v_m_step, 'adjacency', v_adj2, 10, 5, 'lte', 'marginal', '회귀 테스트');
      r := r || '{"완충 marginal":"삽입됨"}';
    exception when others then r := r || jsonb_build_object('완충 marginal', sqlstate); end;
    -- 4-f UPDATE 경로도 막힌다(트리거가 BEFORE INSERT OR UPDATE 여야 한다)
    begin
      update assessment_findings set verdict = 'pass'
       where assessment_id = v_asmt and adjacency_id = v_adj1 and verdict = 'fail';
      r := r || '{"UPDATE 로 거짓 pass":"통과(막히지 않았다)"}';
    exception when others then r := r || jsonb_build_object('UPDATE 로 거짓 pass', sqlstate); end;
    -- 4-g verdict='unknown' 은 값이 비어 있어도 된다
    begin
      insert into assessment_findings(assessment_id, metric_id, subject, adjacency_id,
                                      verdict, reason_text)
      values (v_asmt, v_m_step, 'adjacency', v_adj3, 'unknown', '회귀 테스트');
      r := r || '{"unknown 은 값 없이":"삽입됨"}';
    exception when others then r := r || jsonb_build_object('unknown 은 값 없이', sqlstate); end;

    raise exception '__REG_ROLLBACK__';
  exception when others then
    if sqlerrm <> '__REG_ROLLBACK__' then v_err := sqlstate || ' ' || sqlerrm; end if;
  end;

  insert into _reg values (27, 'A27 ★구조 가드 동작(위반 거부 · 정당 수용)',
    '천장에 바닥타일 23503 / 제작치수·상한없는칸 유효폭 23514 / Infinity·음수·NaN 23514 / 거짓pass·거짓marginal·gte거짓pass 23514(INSERT·UPDATE 양쪽) / 바닥타일·상한미만·옳은fail·완충marginal·unknown 은 수용',
    left(r::text, 900) || case when v_err='' then '' else ' / 설치예외=' || v_err end,
    case when v_err = ''
          and r->>'천장에 바닥타일'   = '23503'
          and r->>'바닥에 바닥타일'   = '삽입됨'
          and r->>'제작치수1990 주입' = '23514'
          and r->>'상한없는 경계에 유효폭' = '23514'
          and r->>'상한 미만 유효폭'  = '통과'
          and r->>'gap=Infinity'      = '23514'
          and r->>'gap=음수'          = '23514'
          and r->>'gap=NaN'           = '23514'
          and r->>'step=Infinity'     = '23514'
          and r->>'거짓 pass'         = '23514'
          and r->>'거짓 marginal'     = '23514'
          and r->>'gte 거짓 pass'     = '23514'
          and r->>'옳은 fail'         = '삽입됨'
          and r->>'완충 marginal'     = '삽입됨'
          and r->>'UPDATE 로 거짓 pass' = '23514'
          and r->>'unknown 은 값 없이' = '삽입됨'
         then 'PASS' else 'FAIL' end);
end $$;


-- =============================================================================
-- =============================================================================
-- G3: 'before insert or update' 를 'before insert' 로 좁혀도 24건이 통과했다.
--   A07 은 INSERT 만 본다. 여기서는 이미 정규화된 행을 **뒤집는 UPDATE** 를 걸어
--   다시 수렴하는지, 그리고 step_mm 을 바꿨을 때 lower_space_id 가 재파생되는지 본다.
do $$
declare
  v_dwg uuid; v_liv uuid; v_ent uuid; v_id uuid;
  s_ins text := '(미실행)'; s_swap text := '(미실행)';
  s_zero text := '(미실행)'; s_neg text := '(미실행)'; s_self text := '(미실행)';
  v_err text := '';
begin
  select drawing_id into v_dwg from _scope;
  select id into v_liv from spaces where drawing_id=v_dwg and name='거실/침실';
  select id into v_ent from spaces where drawing_id=v_dwg and name='현관';

  begin
    insert into space_adjacencies(space_a_id, space_b_id, kind, label, step_mm,
                                  basis, basis_note, source_text)
    values (v_liv, v_ent, 'open_boundary', '_regtest_upd', -30,
            'inferred', '회귀 테스트용 임시 행', '회귀 테스트')
    returning id into v_id;
    select format('%s|%s|%s|%s', sa.name, sb.name, x.step_mm, coalesce(sl.name,'-'))
      into s_ins from space_adjacencies x
      join spaces sa on sa.id=x.space_a_id join spaces sb on sb.id=x.space_b_id
      left join spaces sl on sl.id=x.lower_space_id where x.id=v_id;

    -- (1) 저장된 방향을 강제로 뒤집는 UPDATE → 트리거가 다시 정규화해야 한다
    update space_adjacencies
       set space_a_id = v_ent, space_b_id = v_liv, step_mm = 30 where id = v_id;
    select format('%s|%s|%s|%s', sa.name, sb.name, x.step_mm, coalesce(sl.name,'-'))
      into s_swap from space_adjacencies x
      join spaces sa on sa.id=x.space_a_id join spaces sb on sb.id=x.space_b_id
      left join spaces sl on sl.id=x.lower_space_id where x.id=v_id;

    -- (2) step_mm 만 0 으로 바꾸면 lower_space_id 는 NULL 로 재파생돼야 한다
    update space_adjacencies set step_mm = 0 where id = v_id;
    select coalesce(sl.name, '(NULL)') into s_zero
      from space_adjacencies x left join spaces sl on sl.id=x.lower_space_id where x.id=v_id;

    -- (3) 부호를 바꾸면 낮은 쪽도 반대편으로 재파생돼야 한다
    update space_adjacencies set step_mm = -40 where id = v_id;
    select coalesce(sl.name, '(NULL)') into s_neg
      from space_adjacencies x left join spaces sl on sl.id=x.lower_space_id where x.id=v_id;

    -- (4) UPDATE 로 자기 자신과의 인접을 만드는 것도 막혀야 한다
    begin
      update space_adjacencies set space_b_id = space_a_id where id = v_id;
      s_self := '통과(막히지 않았다)';
    exception when others then s_self := sqlstate; end;

    raise exception '__REG_ROLLBACK__';
  exception when others then
    if sqlerrm <> '__REG_ROLLBACK__' then v_err := sqlstate || ' ' || sqlerrm; end if;
  end;

  insert into _reg values (28, 'A28 쌍 정규화 UPDATE 경로 (G3)',
    '삽입=거실/침실|현관|-30|현관 / 뒤집는 UPDATE 후에도 같은 행으로 재수렴 / step 0 → 낮은쪽 NULL / step -40 → 낮은쪽 현관 / 자기참조 UPDATE 23514',
    format('삽입=%s / 뒤집기후=%s / step0→낮은쪽=%s / step-40→낮은쪽=%s / 자기참조=%s%s',
           s_ins, s_swap, s_zero, s_neg, s_self,
           case when v_err='' then '' else ' / 예외=' || v_err end),
    case when v_err = ''
          and s_ins  = '거실/침실|현관|-30|현관'
          and s_swap = '거실/침실|현관|-30|현관'
          and s_zero = '(NULL)'
          and s_neg  = '현관'
          and s_self = '23514'
         then 'PASS' else 'FAIL' end);
end $$;


-- =============================================================================
-- =============================================================================
-- G4: EXCEPT 는 중복을 제거하므로 "투영이 기존 행과 완전히 같은 새 행" 은 몇 개를
--   넣어도 대칭차가 0 이다. 집합 동등 단언들과 짝을 이루는 행 수 축을 여기서 못박는다.
select 'spaces' t, count(*) from spaces where drawing_id=(select drawing_id from _scope)
union all select 'space_adjacencies', count(*) from space_adjacencies x
  join spaces s on s.id=x.space_a_id where s.drawing_id=(select drawing_id from _scope)
union all select 'space_finishes', count(*) from space_finishes sf
  join spaces s on s.id=sf.space_id where s.drawing_id=(select drawing_id from _scope);

insert into _reg
with expect(t, n) as (values
  ('spaces(도면)',              9),
  ('space_adjacencies(도면)',   8),
  ('v_space_step(도면)',        8),
  ('space_finishes(도면)',     48),
  ('project_codes(체계)',      36),
  ('project_code_layers(체계)',34),
  ('robot_thresholds(기준세트)',29),
  ('material_families',        14),
  ('finish_materials',         52),
  ('material_parts',           71),
  ('material_properties',       8),
  ('v_finish_taxonomy',        71),
  ('finish_parts',              5),
  ('finish_properties',         8),
  ('robot_metrics',            12),
  ('robot_classes',             5)
), actual(t, n) as (
  select 'spaces(도면)', count(*)::int from spaces where drawing_id=(select drawing_id from _scope)
  union all select 'space_adjacencies(도면)', count(*)::int from space_adjacencies x
    join spaces s on s.id=x.space_a_id where s.drawing_id=(select drawing_id from _scope)
  union all select 'v_space_step(도면)', count(*)::int from v_space_step
    where drawing_id=(select drawing_id from _scope)
  union all select 'space_finishes(도면)', count(*)::int from space_finishes sf
    join spaces s on s.id=sf.space_id where s.drawing_id=(select drawing_id from _scope)
  union all select 'project_codes(체계)', count(*)::int from project_codes
    where system_id=(select system_id from _scope)
  union all select 'project_code_layers(체계)', count(*)::int from project_code_layers pcl
    join project_codes pc on pc.id=pcl.project_code_id where pc.system_id=(select system_id from _scope)
  union all select 'robot_thresholds(기준세트)', count(*)::int from robot_thresholds
    where ruleset_id=(select ruleset_id from _scope)
  union all select 'material_families', count(*)::int from material_families
  union all select 'finish_materials', count(*)::int from finish_materials
  union all select 'material_parts', count(*)::int from material_parts
  union all select 'material_properties', count(*)::int from material_properties
  union all select 'v_finish_taxonomy', count(*)::int from v_finish_taxonomy
  union all select 'finish_parts', count(*)::int from finish_parts
  union all select 'finish_properties', count(*)::int from finish_properties
  union all select 'robot_metrics', count(*)::int from robot_metrics
  union all select 'robot_classes', count(*)::int from robot_classes
), diff as (
  select format('%s: 기대 %s ≠ 실제 %s', e.t, e.n, a.n) as d
    from expect e join actual a on a.t = e.t where a.n <> e.n
)
select 29, 'A29 행 수 고정 16종 (집합 동등의 짝)',
  '실9·인접8·파생8·마감48·코드36·층34·임계29·계열14·제품군52·부위배정71·물성8·분류뷰71·부위5·물성등록8·지표12·등급5',
  coalesce(left(string_agg(d, ' ‖ '), 700), '16종 전부 기대 행 수와 일치'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- G5: space_adjacencies.profile 에 대한 단언이 0건이었다. 8행 전부 NULL(문턱 형상 미상)
--   인데 아무것도 그것을 고정하지 않아, 'beveled' 를 임의로 채워 넣으면 완충 12.7 이
--   적용돼 10mm 문턱이 fail 대신 marginal 이 된다.
-- F5: clear_width_max_mm(문틀 내측 상한) 3행이 사라지면 유효폭 칸이 잠기는 대신
--   상한을 임의로 크게 넣어 우회하는 길이 열린다. 상한 값 자체를 값으로 못박는다.
select x.label, x.profile::text, x.clear_width_max_mm, x.clear_width_mm, x.gap_width_mm,
       coalesce(pc.code,'-') as 창호코드
  from space_adjacencies x join spaces sa on sa.id=x.space_a_id
  left join project_codes pc on pc.id=x.project_code_id
 where sa.drawing_id=(select drawing_id from _scope) order by x.label;

insert into _reg
with expect(lb, prof, cwmax, cw, gap, code) as (values
  ('거실-발코니 미서기문',        null::text, 959.0::double precision, null::double precision, null::double precision, 'DPW'),
  ('거실-주방 개방 경계',         null,       null,   null, null, null),
  ('발코니-실외기실 철제여닫이문',null,       600.0,  null, null, 'SD'),
  ('욕실-현관 벽체 경계(단차)',   null,       null,   null, null, null),
  ('욕실문',                      null,       null,   null, null, null),
  ('주방-욕실 벽체 경계(단차)',   null,       null,   null, null, null),
  ('주방-현관 마감 전환선',       null,       null,   null, null, null),
  ('현관 진입 철재여닫이문',      null,       1000.0, null, null, 'D-2')
), actual(lb, prof, cwmax, cw, gap, code) as (
  select x.label, x.profile::text, x.clear_width_max_mm, x.clear_width_mm, x.gap_width_mm, pc.code
    from space_adjacencies x join spaces sa on sa.id=x.space_a_id
    left join project_codes pc on pc.id=x.project_code_id
   where sa.drawing_id=(select drawing_id from _scope)
), diff as (
  select 'DB에만: ' || format('%s|prof=%s|상한=%s|유효폭=%s|틈=%s|코드=%s',
           lb, coalesce(prof,'null'), cwmax, cw, gap, coalesce(code,'-')) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s|prof=%s|상한=%s|유효폭=%s|틈=%s|코드=%s',
           lb, coalesce(prof,'null'), cwmax, cw, gap, coalesce(code,'-'))
    from (select * from expect except select * from actual) q
  -- 불변식: 문틀 내측 상한이 있는 행 ⇔ 창호코드가 붙은 행 (통행 개구부가 있는 3행)
  union all
  select '상한 축과 창호코드 축이 어긋남: ' || x.label
    from space_adjacencies x join spaces sa on sa.id=x.space_a_id
   where sa.drawing_id=(select drawing_id from _scope)
     and (x.clear_width_max_mm is not null) <> (x.project_code_id is not null)
  -- 형상이 채워지면 완충 구간이 열려 판정이 뒤집힌다 → 미상은 미상으로 남아야 한다
  union all
  select '문턱 형상이 임의로 채워졌다: ' || x.label || '=' || x.profile::text
    from space_adjacencies x join spaces sa on sa.id=x.space_a_id
   where sa.drawing_id=(select drawing_id from _scope) and x.profile is not null
)
select 30, 'A30 인접 판정 입력 컬럼 전량 (형상·상한·틈)',
  '8행 profile 전부 NULL / 문틀 내측 상한은 DPW 959·SD 600·D-2 1000 3행만 / 유효폭·틈 전부 NULL / 상한 ⇔ 창호코드',
  coalesce(left(string_agg(d, ' ‖ '), 700), '8행 전부 일치 · 형상 미상 유지 · 상한 3행'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- G9: 두 표식을 상수 false 로 바꿔도 24건이 통과했다. 시드 8행은 step_mm 이 전부
--   저장돼 있어 step_is_derived 가 전부 false 이기 때문이다(상수 false 와 구분 불가).
--   → 롤백 서브트랜잭션에서 (a) 저장 단차 없이 FL 차이로만 파생되는 행,
--     (b) 양쪽 FL 이 없어 아예 파생 불가인 행을 만들어 두 표식을 갈라 본다.
-- F3: 원문 모순을 해소해 spaces.fl_mm 을 정정하면 낡은 step_mm 이 판정 입력으로
--   되살아난다. 욕실을 주기13 분기(FL+20)로 정정하면 FL 차이는 90 인데 저장값은 80 이다.
do $$
declare
  v_dwg uuid; v_liv uuid; v_ent uuid; v_pd uuid; v_wall uuid; v_bath uuid;
  s_seed text := '(미실행)'; s_derived text := '(미실행)'; s_nofl text := '(미실행)';
  s_stale text := '(미실행)'; s_stale_raw text := '(미실행)';
  v_err text := '';
begin
  select drawing_id into v_dwg from _scope;
  select id into v_liv  from spaces where drawing_id=v_dwg and name='거실/침실';
  select id into v_ent  from spaces where drawing_id=v_dwg and name='현관';
  select id into v_pd   from spaces where drawing_id=v_dwg and name='PD';
  select id into v_wall from spaces where drawing_id=v_dwg and name='벽체공용';
  select id into v_bath from spaces where drawing_id=v_dwg and name='욕실';

  -- 시드 8행: 저장 단차가 전부 있으므로 파생 아님 7 / 판정불가 1
  select format('derived=%s unknown=%s',
                count(*) filter (where step_is_derived),
                count(*) filter (where step_unknown))
    into s_seed from v_space_step where drawing_id = v_dwg;

  begin
    -- (a) 저장 단차 없이 FL 차이(80-110=-30)로만 파생되는 행
    insert into space_adjacencies(space_a_id, space_b_id, kind, label, step_mm,
                                  basis, basis_note, source_text)
    values (v_liv, v_ent, 'open_boundary', '_regtest_derived', null,
            'inferred', '회귀 테스트용 임시 행', '회귀 테스트');
    select format('derived=%s unknown=%s abs=%s raw=%s',
                  step_is_derived, step_unknown, step_abs_mm, step_abs_raw_mm)
      into s_derived from v_space_step where label='_regtest_derived';

    -- (b) 양쪽 FL 이 없어 파생조차 불가인 행 (PD·벽체공용은 FL NULL)
    insert into space_adjacencies(space_a_id, space_b_id, kind, label, step_mm,
                                  basis, basis_note, source_text)
    values (v_pd, v_wall, 'level_change', '_regtest_nofl', null,
            'inferred', '회귀 테스트용 임시 행', '회귀 테스트');
    select format('derived=%s unknown=%s abs=%s',
                  step_is_derived, step_unknown, coalesce(step_abs_mm::text,'NULL'))
      into s_nofl from v_space_step where label='_regtest_nofl';

    -- (F3) 주기13 분기로 욕실 FL 을 정정한다 → 저장 단차 80 과 FL 차이 90 이 어긋난다
    update spaces set fl_mm = 20 where id = v_bath;
    select format('abs=%s unknown=%s 사유있음=%s',
                  coalesce(step_abs_mm::text,'NULL'), step_unknown,
                  (step_unevaluable_reason is not null))
      into s_stale from v_space_step where drawing_id=v_dwg and label='욕실문';
    select coalesce(step_abs_raw_mm::text,'NULL')
      into s_stale_raw from v_space_step where drawing_id=v_dwg and label='욕실문';

    raise exception '__REG_ROLLBACK__';
  exception when others then
    if sqlerrm <> '__REG_ROLLBACK__' then v_err := sqlstate || ' ' || sqlerrm; end if;
  end;

  insert into _reg values (31, 'A31 v_space_step 파생 표식 + 낡은 단차 (G9·F3)',
    '시드 8행 derived=0·unknown=1 / 저장단차 없는 행 derived=t·unknown=f·abs=30 / 양쪽 FL 없는 행 derived=t·unknown=t·abs=NULL / 욕실 FL 을 주기13 분기로 정정하면 욕실문 abs=NULL·사유 있음·원값 80 보존',
    format('시드[%s] 파생행[%s] FL없음[%s] FL정정후 욕실문[%s] 원값=%s%s',
           s_seed, s_derived, s_nofl, s_stale, s_stale_raw,
           case when v_err='' then '' else ' / 예외=' || v_err end),
    case when v_err = ''
          and s_seed    = 'derived=0 unknown=1'
          and s_derived = 'derived=t unknown=f abs=30 raw=30'
          and s_nofl    = 'derived=t unknown=t abs=NULL'
          and s_stale   = 'abs=NULL unknown=t 사유있음=t'
          and s_stale_raw = '80'
         then 'PASS' else 'FAIL' end);
end $$;


-- =============================================================================
-- =============================================================================
-- F2: robot_thresholds.mode 는 정확 일치 파티션이라 폴백이 없었다. 기본 모드('')로
--   상업용 청소로봇을 물으면 규칙 0건 → 인접 8건에 판정이 한 건도 생성되지 않는
--   **조용한 통과**였다(fail 도 unknown 도 안 나오고 보고서가 비어 보인다).
--   → 5등급 × 3모드 15조합 전부에 대해 (실제로 쓰인 모드, 행 수) 를 값으로 대조한다.
--     폴백은 조용하지 않아야 한다: 반환 행의 mode 컬럼에 어느 모드가 쓰였는지 드러난다.
select rc.code, m.md::text as 요청모드,
       coalesce(max(t.mode::text),'(0행)') as 실제모드, count(t.*) as 행수
  from robot_classes rc
  cross join (values (''::robot_mode),('drive'),('clean')) m(md)
  left join lateral (select * from fn_resolve_thresholds(
             (select ruleset_id from _scope), rc.id, m.md, null)) t on true
 group by rc.code, rc.sort_order, m.md order by rc.sort_order, m.md;

insert into _reg
with expect(cls, req, eff, n) as (values
  ('serving-delivery',  '',     '',      10),
  ('serving-delivery',  'drive','',      10),
  ('serving-delivery',  'clean','',      10),
  ('industrial-amr',    '',     '',       4),
  ('industrial-amr',    'drive','',       4),
  ('industrial-amr',    'clean','',       4),
  ('commercial-cleaner','',     'clean',  4),   -- ★ 폴백: 선언 모드가 drive/clean 뿐
  ('commercial-cleaner','drive','drive',  5),
  ('commercial-cleaner','clean','clean',  4),
  ('domestic-cleaner',  '',     '',       3),
  ('domestic-cleaner',  'drive','',       3),   -- ★ 폴백: 반대 방향도 닫혔다
  ('domestic-cleaner',  'clean','',       3),
  ('outdoor-delivery',  '',     '',       2),
  ('outdoor-delivery',  'drive','',       2),
  ('outdoor-delivery',  'clean','',       2)
), actual(cls, req, eff, n) as (
  select rc.code, m.md::text, coalesce(max(t.mode::text),'(0행)'), count(t.*)::int
    from robot_classes rc
    cross join (values (''::robot_mode),('drive'),('clean')) m(md)
    left join lateral (select * from fn_resolve_thresholds(
               (select ruleset_id from _scope), rc.id, m.md, null)) t on true
   group by rc.code, m.md
), diff as (
  select 'DB에만: ' || format('%s/요청%s→모드%s %s행', cls, req, eff, n) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s/요청%s→모드%s %s행', cls, req, eff, n)
    from (select * from expect except select * from actual) q
  union all
  select '★규칙 0건 조합(조용한 통과): ' || cls || '/' || req from actual where n = 0
)
select 32, 'A32 ★등급×모드 15조합 규칙 0건 없음 + 폴백 모드',
  '15조합 전부 1행 이상 / 상업용청소는 요청 ''''→clean 폴백(4행)·drive→drive(5행)·clean→clean(4행) / 나머지 4등급은 어느 모드로 물어도 ''''로 폴백',
  coalesce(left(string_agg(d, ' ‖ '), 700), '15조합 전부 일치 · 0건 조합 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- F4: fn_resolve_thresholds 의 정렬이 형상 특정성을 등급 상속 깊이보다 앞세우면,
--   자식 등급이 자기 지표를 더 엄격하게 선언해도 부모의 형상 조건부 행이 이긴다
--   (자식 lte 5·완충 없음 vs 부모 beveled 완충 12.7 → 10mm 문턱이 fail 이 아니라 marginal).
--   시드에는 자식 등급이 0건(전 5등급 parent_id NULL)이라 이 결함은 자식을 만들어야 드러난다.
--   → 롤백 서브트랜잭션에서 자식 등급을 만들어 **어느 등급의 행이 이겼는지** 코드까지 대조한다.
do $$
declare
  v_rs uuid; v_parent uuid; v_child uuid; v_m_step uuid; v_m_cw uuid;
  s_own text := '(미실행)'; s_inherit text := '(미실행)'; s_parent text := '(미실행)';
  v_err text := '';
begin
  select ruleset_id into v_rs from _scope;
  select id into v_parent from robot_classes where code='serving-delivery';
  select id into v_m_step from robot_metrics where code='step_height_mm';
  select id into v_m_cw   from robot_metrics where code='clear_width_mm';

  begin
    insert into robot_classes(parent_id, code, name_ko, default_mode, source_text, sort_order)
    values (v_parent, '_regtest_child', '회귀-자식등급', '', '회귀 테스트', 950)
    returning id into v_child;

    -- 자식이 같은 지표를 더 엄격하게(완충 없이) 선언한다. 형상은 무관('{}').
    insert into robot_thresholds(ruleset_id, class_id, metric_id, mode, applies_profile,
                                 comparator, value_type, unit, value, source_text, evidence)
    values (v_rs, v_child, v_m_step, '', '{}'::threshold_profile[],
            'lte','numeric','mm', 5, '회귀 테스트',
            '[{"url":"regtest","quote":"regtest","grade":"A"}]'::jsonb);

    -- (1) 형상 beveled 로 물어도 **자식** 행이 이겨야 한다 → 10mm 는 fail
    select format('%s|marginal=%s|10mm→%s', rc.code, coalesce(t.marginal_value::text,'null'),
                  fn_eval_threshold(10.0, t.comparator, t.value, t.marginal_value)::text)
      into s_own
      from fn_resolve_thresholds(v_rs, v_child, '', 'beveled') t
      join robot_classes rc on rc.id = t.class_id
     where t.metric_id = v_m_step;

    -- (2) 자식이 선언하지 않은 지표는 여전히 부모에서 상속돼야 한다(상속 자체는 살아 있다)
    select format('%s|value=%s', rc.code, t.value) into s_inherit
      from fn_resolve_thresholds(v_rs, v_child, '', 'beveled') t
      join robot_classes rc on rc.id = t.class_id
     where t.metric_id = v_m_cw;

    -- (3) 부모를 직접 물으면 형상 특정 행이 여전히 이긴다(형상 타이브레이커 보존 · A11 의 축)
    select format('%s|marginal=%s|10mm→%s', rc.code, coalesce(t.marginal_value::text,'null'),
                  fn_eval_threshold(10.0, t.comparator, t.value, t.marginal_value)::text)
      into s_parent
      from fn_resolve_thresholds(v_rs, v_parent, '', 'beveled') t
      join robot_classes rc on rc.id = t.class_id
     where t.metric_id = v_m_step;

    raise exception '__REG_ROLLBACK__';
  exception when others then
    if sqlerrm <> '__REG_ROLLBACK__' then v_err := sqlstate || ' ' || sqlerrm; end if;
  end;

  insert into _reg values (33, 'A33 ★등급 상속 우선순위 (자식 > 부모 형상행)',
    '자식(beveled 질의)=_regtest_child|marginal=null|10mm→fail / 미선언 지표는 부모 상속=serving-delivery|value=800 / 부모 직접 질의는 형상행 유지=serving-delivery|marginal=12.7|10mm→marginal',
    format('자식=%s / 상속=%s / 부모=%s%s', s_own, s_inherit, s_parent,
           case when v_err='' then '' else ' / 예외=' || v_err end),
    case when v_err = ''
          and s_own     = '_regtest_child|marginal=null|10mm→fail'
          and s_inherit = 'serving-delivery|value=800'
          and s_parent  = 'serving-delivery|marginal=12.7|10mm→marginal'
         then 'PASS' else 'FAIL' end);
end $$;


-- =============================================================================
-- =============================================================================
select s.name, s.ceiling_height_mm from spaces s
 where s.drawing_id=(select drawing_id from _scope) order by s.name;

insert into _reg
with expect_ch(nm, ch) as (values
  ('PD', null::double precision), ('거실/침실', 2300.0), ('발코니', null), ('벽체공용', null),
  ('복도', null), ('실외기실', null), ('욕실', 2200.0), ('주방/식당', 2300.0), ('현관', 2340.0)
), actual_ch(nm, ch) as (
  select name, ceiling_height_mm from spaces where drawing_id=(select drawing_id from _scope)
), expect_met(cd, un, sb, ms, pt, so) as (values
  ('step_height_mm',       'mm', 'adjacency','partial', null::text, 10),
  ('gap_width_mm',         'mm', 'adjacency','partial', null,       20),
  ('clear_width_mm',       'mm', 'adjacency','yes',     null,       30),
  ('turn_width_mm',        'mm', 'space',    'yes',     null,       40),
  ('rec_path_width_mm',    'mm', 'space',    'yes',     null,       45),
  ('slope_deg',            'deg','space',    'yes',     null,       50),
  ('carpet_pile_mm',       'mm', 'finish',   'partial', 'numeric',  60),
  ('floor_csr_b',          '',   'finish',   'no',      'numeric',  70),
  ('floor_dcof',           '',   'finish',   'no',      'numeric',  75),
  ('floor_flatness_mm_3m', 'mm', 'space',    'no',      null,       80),
  ('elevator_car_width_mm','mm', 'space',    'partial', null,       90),
  ('elevator_car_depth_mm','mm', 'space',    'partial', null,      100)
), actual_met(cd, un, sb, ms, pt, so) as (
  select code, unit, subject::text, measurability::text, property_type::text, sort_order
    from robot_metrics
), expect_cls(cd, w, l, h, dm, nmodels) as (values
  ('serving-delivery',   565.0::double precision, 537.0::double precision, 1290.0::double precision, '',      8),
  ('industrial-amr',     534.0,  835.0, 1350.0, '',      2),
  ('commercial-cleaner', 962.0, 1370.0, 1417.0, 'clean', 4),
  ('domestic-cleaner',   350.0,  350.0,  100.0, '',      4),
  ('outdoor-delivery',   null,    null,   null, '',      0)
), actual_cls(cd, w, l, h, dm, nmodels) as (
  select code, ref_width_mm, ref_length_mm, ref_height_mm, default_mode::text,
         jsonb_array_length(specs->'models') from robot_classes
), expect_conf(cf, n) as (values ('exact', 40), ('approximate', 6), ('unmapped', 2)
), actual_conf(cf, n) as (
  select sf.confidence::text, count(*)::int from space_finishes sf
    join spaces s on s.id=sf.space_id where s.drawing_id=(select drawing_id from _scope)
   group by 1
), expect_hard(hd, n) as (values ('rigid', 38), ('semi_rigid', 6), ('soft', 8)
), actual_hard(hd, n) as (select hardness, count(*)::int from finish_materials group by 1
-- ★ 두께: 분포만 보면 값을 통째로 배수로 바꿔도 산다(실측: SURVIVED). 행 단위로 못박는다.
), expect_th(sp, pt, rl, ln, th) as (values
  ('거실/침실','baseboard','base',  1, 9.5::double precision),
  ('거실/침실','ceiling',  'base',  2, 9.5),
  ('거실/침실','floor',    'finish',1, 6.0),
  ('거실/침실','wall',     'base',  1, 9.5),
  ('발코니',  'floor',     'base',  1, 10.0),
  ('실외기실','floor',     'base',  1, 10.0),
  ('욕실',    'floor',     'base',  1, 60.0),
  ('주방/식당','baseboard','base',  1, 9.5),
  ('주방/식당','ceiling',  'base',  2, 9.5),
  ('주방/식당','floor',    'finish',1, 6.0),
  ('주방/식당','wall',     'base',  1, 9.5),
  ('현관',    'baseboard', 'base',  1, 9.5),
  ('현관',    'ceiling',   'base',  2, 9.5),
  ('현관',    'wall',      'base',  1, 9.5)
), actual_th(sp, pt, rl, ln, th) as (
  select sp.name, fp.code, sf.role::text, sf.layer_no, sf.thickness_mm
    from space_finishes sf join spaces sp on sp.id=sf.space_id
    join finish_parts fp on fp.id=sf.part_id
   where sp.drawing_id=(select drawing_id from _scope) and sf.thickness_mm is not null
-- ★ 신뢰도: 분포만 보면 approximate 를 exact 로 올려도 개수가 맞으면 산다.
--   "정확 매핑이 아닌 행" 을 행 단위로 못박아야 관대화가 잡힌다(실측: 분포만으로는 SURVIVED).
), expect_nx(t, k, cf) as (values
  ('마감','거실/침실/floor/base#1',   'unmapped'),
  ('마감','거실/침실/floor/finish#1', 'approximate'),
  ('마감','발코니/baseboard/finish#1','approximate'),
  ('마감','실외기실/baseboard/finish#1','approximate'),
  ('마감','욕실/floor/finish#1',      'approximate'),
  ('마감','욕실/wall/base#1',         'approximate'),
  ('마감','주방/식당/floor/base#1',   'unmapped'),
  ('마감','주방/식당/floor/finish#1', 'approximate'),
  ('코드층','B-14/finish#1',          'approximate'),
  ('코드층','B-18/finish#1',          'approximate'),
  ('코드층','F-11/base#1',            'unmapped'),
  ('코드층','F-11/finish#1',          'approximate'),
  ('코드층','F-12/finish#1',          'approximate'),
  ('코드층','W-12/base#1',            'approximate')
), actual_nx(t, k, cf) as (
  select '마감', format('%s/%s/%s#%s', sp.name, fp.code, sf.role, sf.layer_no), sf.confidence::text
    from space_finishes sf join spaces sp on sp.id=sf.space_id
    join finish_parts fp on fp.id=sf.part_id
   where sp.drawing_id=(select drawing_id from _scope) and sf.confidence <> 'exact'
  union all
  select '코드층', format('%s/%s#%s', pc.code, pcl.role, pcl.layer_no), pcl.confidence::text
    from project_code_layers pcl join project_codes pc on pc.id=pcl.project_code_id
   where pc.system_id=(select system_id from _scope) and pcl.confidence <> 'exact'
), diff as (
  select '천장고 DB에만: ' || format('%s=%s', nm, ch) as d
    from (select * from actual_ch except select * from expect_ch) q
  union all select '천장고 기대에만: ' || format('%s=%s', nm, ch)
    from (select * from expect_ch except select * from actual_ch) q
  union all select '지표 DB에만: ' || format('%s %s/%s/%s/%s#%s', cd,un,sb,ms,coalesce(pt,'-'),so)
    from (select * from actual_met except select * from expect_met) q
  union all select '지표 기대에만: ' || format('%s %s/%s/%s/%s#%s', cd,un,sb,ms,coalesce(pt,'-'),so)
    from (select * from expect_met except select * from actual_met) q
  union all select '등급제원 DB에만: ' || format('%s %sx%sx%s mode=%s 모델%s', cd,w,l,h,dm,nmodels)
    from (select * from actual_cls except select * from expect_cls) q
  union all select '등급제원 기대에만: ' || format('%s %sx%sx%s mode=%s 모델%s', cd,w,l,h,dm,nmodels)
    from (select * from expect_cls except select * from actual_cls) q
  union all select '신뢰도 분포 어긋남: ' || format('%s=%s', cf, n)
    from ((select * from actual_conf except select * from expect_conf)
          union all (select * from expect_conf except select * from actual_conf)) q
  union all select '경도 분포 어긋남: ' || format('%s=%s', hd, n)
    from ((select * from actual_hard except select * from expect_hard)
          union all (select * from expect_hard except select * from actual_hard)) q
  union all select '두께 DB에만: ' || format('%s/%s/%s#%s=%s', sp,pt,rl,ln,th)
    from (select * from actual_th except select * from expect_th) q
  union all select '두께 기대에만: ' || format('%s/%s/%s#%s=%s', sp,pt,rl,ln,th)
    from (select * from expect_th except select * from actual_th) q
  union all select '두께 미기재 행 수가 34 가 아니다: ' || count(*)::text
    from space_finishes sf join spaces sp on sp.id=sf.space_id
   where sp.drawing_id=(select drawing_id from _scope) and sf.thickness_mm is null
  having count(*) <> 34
  union all select '비정확매핑 DB에만: ' || format('%s %s=%s', t, k, cf)
    from (select * from actual_nx except select * from expect_nx) q
  union all select '비정확매핑 기대에만: ' || format('%s %s=%s', t, k, cf)
    from (select * from expect_nx except select * from actual_nx) q
  -- 실제로 이 도면에서 쓰이는 바닥 마감의 경도는 개별로 못박는다(분포만으로는 맞바꿔치기가 산다)
  union all select '바닥 마감 경도 어긋남: ' || m.code || '=' || m.hardness
    from finish_materials m
   where m.code in ('sheet-vinyl-cushion','tile-vitreous','tile-porcelain','tile-earthenware','wp-silk')
     and m.hardness is distinct from
         (case m.code when 'sheet-vinyl-cushion' then 'soft'
                      when 'wp-silk' then 'soft' else 'rigid' end)
  -- 미매핑 ⇔ confidence='unmapped' (A21 이 층에 대해 하는 검사의 마감 판)
  union all select '마감 미매핑 축 어긋남: ' || sp.name || '/' || fp.code
    from space_finishes sf join spaces sp on sp.id=sf.space_id
    join finish_parts fp on fp.id=sf.part_id
   where sp.drawing_id=(select drawing_id from _scope)
     and (sf.material_id is null) <> (sf.confidence = 'unmapped')
)
select 34, 'A34 제원·측정가능성·경도·두께·신뢰도 (G7)',
  '천장고 9행 / 지표 12행 / 등급 5행(제원·기본모드·모델수) / 경도 38·6·8 + 바닥마감 개별 / 마감두께 14행 + 미기재 34 / 비정확매핑 14행(마감 8 + 코드층 6) 행 단위 / 미매핑⇔unmapped',
  coalesce(left(string_agg(d, ' ‖ '), 800), '일곱 축 전부 기대와 일치'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- G6: DCOF·CSR 은 습윤/건조가 값의 의미를 결정하는데 조건을 뒤집어도 24건이 통과했다.
--   (건조 DCOF 0.42 와 습윤 DCOF 0.42 는 전혀 다른 주장이다.)
select m.code as material, fp.code as property, mp.test_cond::text,
       jsonb_array_length(mp.evidence) as 근거건수
  from material_properties mp
  join finish_materials m on m.id=mp.material_id
  join finish_properties fp on fp.id=mp.property_id
 order by m.code, fp.code;

insert into _reg
with expect(mat, prop, tc) as (values
  ('block-braille',      'bpn',            'dry'),
  ('carpet-tile',        'carpet_pile_mm', ''),
  ('deck-wpc',           'csr',            'dry'),
  ('sheet-vinyl-cushion','csr_b',          'wet'),
  ('tile-polished',      'dcof',           'wet'),
  ('tile-porcelain',     'dcof',           'wet'),
  ('tile-vitreous',      'csr_b',          'wet'),
  ('tile-vitreous',      'dcof',           'wet')
), actual(mat, prop, tc) as (
  select m.code, fp.code, mp.test_cond::text
    from material_properties mp
    join finish_materials m on m.id=mp.material_id
    join finish_properties fp on fp.id=mp.property_id
), diff as (
  select 'DB에만: ' || format('%s.%s @%s', mat, prop, tc) as d
    from (select * from actual except select * from expect) q
  union all
  select '기대에만: ' || format('%s.%s @%s', mat, prop, tc)
    from (select * from expect except select * from actual) q
  -- 미끄럼 저항 물성은 시험조건이 비어 있으면 값의 의미가 정해지지 않는다
  union all
  select '미끄럼 물성인데 시험조건이 비었다: ' || m.code || '.' || fp.code
    from material_properties mp join finish_materials m on m.id=mp.material_id
    join finish_properties fp on fp.id=mp.property_id
   where fp.code in ('dcof','csr','csr_b','bpn') and mp.test_cond = ''
  -- 기하 물성(파일 높이)에 시험조건이 붙으면 그것대로 이상하다
  union all
  select '기하 물성에 시험조건이 붙었다: ' || m.code || '.' || fp.code || '=' || mp.test_cond::text
    from material_properties mp join finish_materials m on m.id=mp.material_id
    join finish_properties fp on fp.id=mp.property_id
   where fp.code = 'carpet_pile_mm' and mp.test_cond <> ''
  -- ★ 임계값 근거의 내용: A10 은 "빈 문자열이 아닌가" 만 본다. 등급(grade)이 실제 값인지,
  --   url 이 형태를 갖췄는지까지 본다. 근거를 통째로 '{}' 로 갈아 끼우면 여기서 죽는다.
  union all
  select format('근거 등급이 A/B/C 가 아니다: %s', e->>'grade')
    from robot_thresholds rt, jsonb_array_elements(rt.evidence) e
   where rt.ruleset_id = (select ruleset_id from _scope)
     and coalesce(e->>'grade','') not in ('A','B','C')
  union all
  select format('근거 url 이 http 로 시작하지 않는다: %s', left(e->>'url', 40))
    from robot_thresholds rt, jsonb_array_elements(rt.evidence) e
   where rt.ruleset_id = (select ruleset_id from _scope)
     and coalesce(e->>'url','') !~ '^https?://'
  union all
  select format('근거 인용이 너무 짧다(%s자): %s/%s', length(e->>'quote'), rc.code, rm.code)
    from robot_thresholds rt
    join robot_classes rc on rc.id=rt.class_id join robot_metrics rm on rm.id=rt.metric_id,
    jsonb_array_elements(rt.evidence) e
   where rt.ruleset_id = (select ruleset_id from _scope) and length(e->>'quote') < 5
)
select 35, 'A35 시험조건 8행 + 임계값 근거 내용 (G6)',
  '물성 8행 시험조건(dry 2·wet 5·기하'''' 1) ≡ 기대 / 미끄럼 물성은 조건 필수·기하 물성은 조건 없음 / 근거 등급 A|B|C · url http · 인용 5자 이상',
  coalesce(left(string_agg(d, ' ‖ '), 700), '시험조건 8행 일치 · 근거 55건 형태 정상'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- G8: RLS 정책을 50개 전량 삭제해도 24건이 통과했다. 이 스키마는 익명 키로 접근
--   가능한 PostgREST 뒤에 놓인다 — 정책이 사라지면 데이터가 열린다.
select tablename, count(*) as 정책수 from pg_policies where schemaname='public'
 group by 1 having count(*) <> 2 order by 1;

insert into _reg
with expect(tb, pl) as (values
  ('analyses','all_auth'),('app_settings','admin_write'),('app_settings','read_auth'),
  ('assessment_findings','all_auth'),('code_systems','read_auth'),('code_systems','site_write'),
  ('criteria','read_auth'),('criteria','site_write'),('drawings','all_auth'),
  ('finish_materials','admin_write'),('finish_materials','read_auth'),
  ('finish_parts','admin_write'),('finish_parts','read_auth'),
  ('finish_properties','admin_write'),('finish_properties','read_auth'),
  ('locations','all_auth'),('material_families','admin_write'),('material_families','read_auth'),
  ('material_parts','admin_write'),('material_parts','read_auth'),
  ('material_properties','admin_write'),('material_properties','read_auth'),
  ('passability_assessments','all_auth'),('photos','all_auth'),
  ('profiles','read_auth'),('profiles','self_update'),('profiles','self_upsert'),
  ('project_code_layers','read_auth'),('project_code_layers','scoped_write'),
  ('project_codes','read_auth'),('project_codes','scoped_write'),
  ('registrations','all_auth'),('report_analyses','all_auth'),('reports','all_auth'),
  ('robot_classes','admin_write'),('robot_classes','read_auth'),
  ('robot_metrics','admin_write'),('robot_metrics','read_auth'),
  ('robot_rulesets','read_auth'),('robot_rulesets','site_write'),
  ('robot_thresholds','read_auth'),('robot_thresholds','site_write'),
  ('scans','all_auth'),('sites','all_auth'),
  ('space_adjacencies','all_auth'),('space_finishes','all_auth'),
  ('space_observations','all_auth'),('spaces','all_auth'),
  ('threshold_groups','read_auth'),('threshold_groups','site_write')
), actual(tb, pl) as (
  select tablename::text, policyname::text from pg_policies where schemaname='public'
), diff as (
  select '정책이 사라졌다: ' || tb || '.' || pl as d
    from (select * from expect except select * from actual) q
  union all
  select '모르는 정책이 생겼다: ' || tb || '.' || pl
    from (select * from actual except select * from expect) q
  -- 정책이 있어도 테이블에 RLS 가 꺼져 있으면 아무 소용이 없다
  union all
  select 'RLS 가 꺼진 테이블: ' || c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
  -- 013 이 만든 마감재 계열 테이블들이 실제로 보호되는지 이름으로 못박는다
  union all
  select '013 테이블에 RLS 가 없다: ' || t
    from unnest(array['spaces','space_adjacencies','space_finishes','space_observations',
                      'finish_materials','material_families','material_parts','material_properties',
                      'project_codes','project_code_layers','robot_classes','robot_metrics',
                      'robot_thresholds','robot_rulesets','threshold_groups',
                      'passability_assessments','assessment_findings']) t
   where not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=t)
)
select 36, 'A36 RLS 정책 50개 전량 + RLS 활성 (G8)',
  '(테이블,정책명) 50쌍 ≡ pg_policies, public 테이블 전부 relrowsecurity=true, 013 이 만든 17테이블 전부 정책 보유',
  coalesce(left(string_agg(d, ' ‖ '), 800), '정책 50개 일치 · RLS 전량 활성'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- G10: 서술 필드의 내용이 전혀 검증되지 않아, clear_width 미상 사유를
--   "유효 통과폭 1,090mm 로 확정" 이라는 **정반대 문장**으로 바꿔도 24건이 통과했다.
--   미상 사유가 확정을 주장하면 그 행은 스스로 모순이다 — 값(NULL)과 글이 어긋난다.
--   ⚠ 문장을 통째로 고정하지는 않는다(문구 다듬기까지 막으면 회귀가 아니라 족쇄다).
--     "확정 주장 금지 + 부정 어휘 필수 + 최소 분량" 세 축만 건다.
select x.label, length(coalesce(x.raw->>'clear_width_unknown_reason','')) as 사유길이
  from space_adjacencies x join spaces sa on sa.id=x.space_a_id
 where sa.drawing_id=(select drawing_id from _scope) order by x.label;

insert into _reg
with adj as (
  select x.label, coalesce(x.raw->>'clear_width_unknown_reason','') as r, x.clear_width_mm
    from space_adjacencies x join spaces sa on sa.id=x.space_a_id
   where sa.drawing_id=(select drawing_id from _scope)
), sp as (
  select name, basis::text as bs, coalesce(basis_note,'') as bn, coalesce(conflict_note,'') as cn
    from spaces where drawing_id=(select drawing_id from _scope)
), mp as (
  select m.code || '.' || fp.code as k, coalesce(mp.unknown_reason,'') as r
    from material_properties mp join finish_materials m on m.id=mp.material_id
    join finish_properties fp on fp.id=mp.property_id
), diff as (
  -- (1) 유효폭이 NULL 인데 사유가 "…로 확정" 을 주장하면 자기모순이다
  select '유효폭 미상 사유가 확정을 주장한다: ' || label || ' → ' || left(r, 60) as d
    from adj where clear_width_mm is null and r ~ '(로|으로) 확정|확정된 유효|확정할 수 있다'
  union all
  select '유효폭 미상 사유에 부정 어휘가 없다: ' || label || ' → ' || left(r, 60)
    from adj where clear_width_mm is null
      and r !~ '아니다|없다|없어|없고|없는|단정할 수 없|미상|상한만|정의되지'
  union all
  select '유효폭 미상 사유가 너무 짧다(' || length(r) || '자): ' || label
    from adj where clear_width_mm is null and length(r) < 20
  -- (2) 추론분 사유가 "이 실은 도면으로 확정된 실이다" 를 주장하면 basis 와 어긋난다
  --   ⚠ 부정문을 오탐하면 안 된다. 실외기실 사유에는 "도면으로 확정된 실 7개 … 목록에
  --     이 실은 포함되지 않는다" 가 들어 있다 — '확정' 이라는 낱말이 나온다는 이유로
  --     잡으면 옳은 문장을 죽인다. 서술어까지 붙은 **자기 주장 형태**만 금지한다.
  union all
  select '추론 사유가 도면 확정을 주장한다: ' || name || ' → ' || left(bn, 60)
    from sp where bs = 'inferred'
      and bn ~ '(도면(으로|에서)? *확정(된)? *(실)? *(이다|이며|임|됐다|되었다|했다))|추론이 아니다|확정 근거가 (있다|충분)'
  union all
  select '추론 사유에 추론 표식이 없다: ' || name
    from sp where bs = 'inferred' and bn !~ '\[추론\]'
  -- (3) 원문 모순 기록이 "해소" 를 주장하면 A04 가 지키는 보존 원칙과 어긋난다
  union all
  select '모순 기록이 해소를 주장한다: ' || name || ' → ' || left(cn, 60)
    from sp where cn <> '' and cn ~ '해소(됐|되었|함|完)|모순 없음|정본으로 확정(했|함)'
  union all
  select '모순 기록에 미해소 표식이 없다: ' || name
    from sp where name in ('욕실','발코니') and cn !~ '\[모순·미해소\]'
  -- (4) 물성 미상 사유가 실측 공표값의 존재를 주장하면 값 NULL 과 어긋난다
  union all
  select '물성 미상 사유가 공표값 존재를 주장한다: ' || k || ' → ' || left(r, 60)
    from mp where r ~ '공표값이 있다|실측값이 있다|(로|으로) 확정'
  union all
  select '물성 미상 사유가 너무 짧다(' || length(r) || '자): ' || k
    from mp where length(r) < 20
  -- (5) 임계값의 근거 없음 사유도 같은 규칙을 받는다
  union all
  select '임계 미상 사유가 확정을 주장한다: ' || rc.code || '/' || rm.code
    from robot_thresholds rt join robot_classes rc on rc.id=rt.class_id
    join robot_metrics rm on rm.id=rt.metric_id
   where rt.ruleset_id=(select ruleset_id from _scope)
     and rt.unknown_reason is not null
     and (rt.unknown_reason ~ '(로|으로) 확정' or length(rt.unknown_reason) < 20)
)
select 37, 'A37 서술 필드 ↔ 값의 무모순 (G10)',
  '유효폭 미상 8행·추론 실 2행·모순 기록 2행·물성 미상 8행·임계 미상 9행: 확정 주장 금지 / 부정 어휘·[추론]·[모순·미해소] 표식 필수 / 20자 이상',
  coalesce(left(string_agg(d, ' ‖ '), 800), '서술 29건 전부 값과 모순 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
-- outline 은 도면 벡터에서 복원한 기하이고 area_m2 는 도면에 인쇄된 면적표다.
-- 서로 독립된 출처이므로 어긋나면 둘 중 하나가 틀린 것이다. 0.01% 를 넘으면 FAIL.
-- 동시에 '도면 확정분은 outline 을 갖고, 추론분은 갖지 않는다'를 함께 잠근다 —
-- 추론분에 기하가 생기면 그것은 근거 없이 지어낸 좌표다.
insert into _reg
with rings as (
  select sp.name, sp.area_m2, sp.basis,
         r.ord as ring_no,
         (select sum((p1->>0)::numeric * (p2->>1)::numeric - (p2->>0)::numeric * (p1->>1)::numeric)
            from jsonb_array_elements(r.ring) with ordinality a(p1, i)
            join lateral (select jsonb_array_element(r.ring,
                   (a.i % jsonb_array_length(r.ring))::int) as p2) b on true
         ) as cross2
    from spaces sp
    cross join lateral jsonb_array_elements(sp.outline) with ordinality r(ring, ord)
   where sp.drawing_id = (select drawing_id from _scope) and sp.outline is not null
), per_space as (
  select name, area_m2, basis,
         sum(case when ring_no = 1 then abs(cross2)/2 else -abs(cross2)/2 end) / 1e6 as shoelace_m2
    from rings group by name, area_m2, basis
), diff as (
  select format('%s: outline %s m2 vs 면적표 %s m2 (오차 %s%%)',
                name, round(shoelace_m2::numeric,4), round(area_m2::numeric,4),
                round((abs(shoelace_m2 - area_m2) / nullif(area_m2,0) * 100)::numeric, 4)) as d
    from per_space
   where area_m2 is null or abs(shoelace_m2 - area_m2) / nullif(area_m2,0) > 0.0001
  union all
  select '도면확정인데 outline 없음: ' || name
    from spaces
   where drawing_id = (select drawing_id from _scope)
     and basis = 'drawing_confirmed' and outline is null
  union all
  select '추론분인데 outline 있음(근거 없는 좌표): ' || name
    from spaces
   where drawing_id = (select drawing_id from _scope)
     and basis = 'inferred' and outline is not null
  union all
  -- 링이 3점 미만이면 면이 아니다
  select '링 꼭짓점 부족: ' || sp.name || ' ring' || r.ord
    from spaces sp cross join lateral jsonb_array_elements(sp.outline) with ordinality r(ring, ord)
   where sp.drawing_id = (select drawing_id from _scope) and jsonb_array_length(r.ring) < 3
)
select 38, 'A38 outline 폴리곤 ↔ 면적표 대조 (셰이스)',
  '도면확정 7행 전부 outline 보유·셰이스면적이 면적표와 0.01% 이내 / 추론 2행은 outline 없음 / 링 3점 이상',
  coalesce(left(string_agg(d, ' ‖ '), 800), '7행 전부 면적표와 일치 · 추론분 기하 없음'),
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from diff;


-- =============================================================================
-- =============================================================================
select r.seq, r.verdict, r.name, r.actual from _reg r order by r.seq;

select e.seq as 누락_단언번호 from _reg_expected_seq e
 where not exists (select 1 from _reg r where r.seq = e.seq) order by e.seq;

select count(*) filter (where verdict = 'PASS') as passed,
       count(*) filter (where verdict <> 'PASS') as failed,
       (select count(*) from _reg_expected_seq e
         where not exists (select 1 from _reg r where r.seq = e.seq)) as missing,
       coalesce(string_agg(name, ', ') filter (where verdict <> 'PASS'), '(없음)') as failed_list
  from _reg;

-- =============================================================================
-- ★ CI 게이트: FAIL 이거나 누락이 있으면 예외를 던진다 → psql 종료코드 3
-- =============================================================================
do $$
declare v_fail int; v_pass int; v_missing text;
declare v_failed_names text;
begin
  select count(*) filter (where verdict = 'PASS'),
         count(*) filter (where verdict <> 'PASS')
    into v_pass, v_fail from _reg;
  select string_agg(e.seq::text, ',' order by e.seq) into v_missing
    from _reg_expected_seq e where not exists (select 1 from _reg r where r.seq = e.seq);
  -- 실패 단언의 이름까지 메시지에 싣는다. Supabase SQL Editor 는 psql 과 달리 중간
  -- 결과표를 보여주지 않아, 예외 메시지가 실패 원인을 아는 유일한 창구다.
  select left(string_agg(name, ' ‖ ' order by seq), 400) into v_failed_names
    from _reg where verdict <> 'PASS';

  if v_fail > 0 or v_missing is not null then
    raise exception '★회귀 실패: PASS %건 / FAIL %건 / 누락 [%] — 실패 단언: %',
      v_pass, v_fail, coalesce(v_missing, '없음'), coalesce(v_failed_names, '(누락만 있음)')
      using errcode = 'P0001';
  end if;
  raise notice '★회귀 게이트 통과: 단언 %건 전부 PASS', v_pass;
end $$;

-- SQL Editor 는 마지막 문장의 결과만 그리드로 보여준다 — 성공하면 이 행이 보인다.
-- (위 DO 게이트가 실패를 전부 예외로 바꾸므로, 여기 도달했다는 것 자체가 전건 PASS 다.)
select 'PASS ' || count(*) || '/38' as verdict
  from _reg where verdict = 'PASS';

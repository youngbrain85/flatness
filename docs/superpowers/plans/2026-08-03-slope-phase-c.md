# 세부과업 4 단계 C: 마이그레이션 007 + 워커 분기 + 기준 시드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드에서 스캔 하나에 구배 분석을 걸면 워커가 구배 파이프라인으로 돌려 결과를 저장하고, 그 과정에서 기존 평활도 분석이 밀려나거나 화면이 깨지지 않는다.

**Architecture:** `analyses.kind`(enum `flatness`|`slope`)를 새 차원으로 추가한다. 잡 타입은 늘리지 않는다 - 워커가 이미 `analysis_id`로 행을 읽으므로 종류가 그 안에 들어 있다. 같은 스캔에 두 종류가 공존하므로 `analyses_current` 유니크 인덱스와 모든 `is_current` 조회가 kind를 알아야 한다. 구배 결과 **화면**은 단계 D의 몫이라 이 단계에서는 안내 화면으로 막는다.

**Tech Stack:** PostgreSQL(Supabase) · Python 3(워커) · Next.js 16(대시보드) · 이미 머지된 구배 엔진(`flatness.core.pipeline.analyze_slope`)

## Global Constraints

- **사용자 대면 문자열에 U+2014(`—`) 금지.** 주석·개발문서는 허용. 문자를 셀 때는 리터럴 글리프로 검색하고, 검색 패턴이 실제로 매칭되는지 먼저 자기검증할 것
- 주석·문서·사용자 대면 문자열은 **한국어**
- **Next.js 16이다.** 학습 데이터의 Next.js와 다르다. 대시보드 코드를 쓰기 전에 `dashboard/node_modules/next/dist/docs/`의 해당 가이드를 읽을 것 (`dashboard/AGENTS.md` 지시)
- 워커 테스트: `cd worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest -q` (**forward slash 필수** - 백슬래시는 bash에서 깨진다)
- 대시보드 테스트: `cd dashboard && npm test`
- 기준선(단계 C 착수 시점): engine **168** / worker **92** / dashboard **152**. 각 태스크는 이 수를 줄이지 않는다
- 마이그레이션 SQL은 **재실행 안전(멱등)**해야 한다. 003~006이 전부 그렇게 작성돼 있다(`if not exists`, `drop ... if exists`, `on conflict do nothing`)
- **엔진을 수정하지 않는다.** 단계 B가 머지·검증 완료됐다. 엔진 변경이 필요해 보이면 멈추고 보고할 것. 예외는 Task 5의 `ENGINE_VERSION` 문자열 한 줄뿐이다
- 구배 판정 기준 수치는 **`docs/slope-criteria-sources.md`가 정본**이다. 이 계획의 시드 SQL과 그 문서의 표가 어긋나면 문서가 맞다

## 이 계획이 확정한 설계 결정

스펙이 열어 둔 것과 사전 조사가 새로 찾아낸 것을 여기서 못박는다. 태스크 안에서 다시 고민하지 말 것.

| 결정 | 내용 | 이유 |
|---|---|---|
| 구배 분석의 `criteria_id` 출처 | 버튼 클릭 시점에 `fn_resolve_criteria(site_id, 'floor', 'slope')`로 해석해 `is_default` 행을 쓴다 | `scans.selected_criteria_id`는 kind 개념이 없는 단일 컬럼이라 구배 기준을 실어 나를 수 없다. 그대로 쓰면 평활도 기준이 구배 분석에 실려 워커가 `KeyError`로 죽는다. 업로드 화면이 이미 같은 RPC를 쓰는 패턴이다 |
| 보고서에서 구배 배제 | `reports/new` **쿼리 단계**에서 `kind='flatness'` 필터 | 워커 쪽에서 막는 것은 답이 아니다. 보고서 렌더러는 `cells.json` 부재 한 곳만 빼면 전부 `.get()` 방어적이라, 그 한 곳을 "뚫으면" 구배 분석이 `n_cells=0`·적용기준 전부 null인 **형식만 멀쩡한 평활도 섹션**을 만들어 발행본에 박제된다. 잡 실패보다 나쁘다 |
| 구배 결과 화면 | 단계 C에서는 안내 화면. `stats.format === 'slope-stats-v1'` **내용 기반** 가드 | `analyses/[id]`는 `.eq('id', id)`뿐이라 어떤 쿼리 필터로도 URL 직접 접근을 막을 수 없다. 엔진이 이미 `format` 판별자를 넣고 있고 평활도 stats에는 이 키가 없다 |
| `overall_verdict` 매핑 | 적합→`pass`, 경계→`borderline`, 보수→`repair`, 재시공→`rework`. 판정 가능 셀이 0이면 `None` | `analyses.overall_verdict`는 enum 4값이고 판정불가에 대응하는 멤버가 없다. 매핑 없이 한국어를 넣으면 `22P02`로 잡이 죽는다 |
| `registrations` 테이블 | 007에 포함하되 `status`를 enum으로 | 스펙 §3.6이 007 소속으로 규정했다. 사용자가 SQL을 수동 적용하므로 두 번 나누는 것이 더 큰 부담이다. free text status는 저장소 관례(다른 5개 상태가 전부 enum)에서 이탈하므로 enum으로 맞춘다 |
| 구배 stats의 `warnings` | 엔진이 내는 **한국어 문장 그대로** DB에 저장 | 평활도는 ASCII 슬러그 + `WARNING_LABEL` 번역인데 구배는 완성 문장이다. 어휘가 kind별로 갈리는 것은 알면서 남기는 부채다(엔진 수정 = 단계 B 재개봉). 표시는 정상 동작한다(양쪽 라벨 함수가 미지 코드를 원문 폴백) |

## File Structure

**신규**
- `supabase/migrations/007_slope_analysis.sql` - enum·컬럼·인덱스·함수·`registrations`·시드 5종
- `worker/flatworker/slope.py` - 구배 전용 워커 로직(컨텍스트 로드·verdict 매핑·stats 정규화). `jobs.py`가 이미 크므로 분리한다
- `worker/tests/test_slope_job.py`
- `dashboard/components/analysis/slope-placeholder.tsx` - 단계 D 전까지의 안내 화면
- `dashboard/components/__tests__/analyze-buttons.test.tsx`

**수정**
- `worker/flatworker/jobs.py` - `handle_analyze` kind 분기, `_finalize` kind 인지화
- `worker/flatworker/db.py` - `set_current_analysis`에 kind 필터
- `worker/tests/fake_db.py` - `current_analysis` 키를 `(scan_id, kind)`로
- `dashboard/lib/domain/types.ts` - `AnalysisKind`, `SlopeThreshold`, `kind` 필드
- `dashboard/lib/domain/labels.ts` - `ANALYSIS_KIND_LABEL`
- `dashboard/lib/domain/criteria.ts` - `thresholdSummary` 구배 분기
- `dashboard/app/page.tsx` · `app/sites/[id]/page.tsx` · `app/reports/new/page.tsx` - kind 필터
- `dashboard/app/scans/[id]/page.tsx` - 종류별 분석 섹션 2벌
- `dashboard/app/analyses/[id]/page.tsx` - 구배 stats 가드
- `dashboard/components/reanalyze-button.tsx` - `kind` prop
- `dashboard/components/unit-confirm-form.tsx` · `components/upload-form.tsx` - `kind: 'flatness'` 명시
- `engine/flatness/__init__.py` - `ENGINE_VERSION`
- `docs/SUPABASE_SETUP.md` · `docs/DEPLOY.md` - 006·007 반영

---

### Task 1: 마이그레이션 007

**Files:**
- Create: `supabase/migrations/007_slope_analysis.sql`
- Modify: `docs/SUPABASE_SETUP.md`

**Interfaces:**
- Produces: `analysis_kind` enum, `analyses.kind`, `criteria.kind`, `fn_resolve_criteria(uuid, surface_type, analysis_kind)`, `registrations` 테이블, 구배 기준 5행
- Consumes: 없음 (첫 태스크)

**⚠ 실행 순서 제약 (틀리면 마이그레이션이 중단된다):**
`alter table criteria add column kind` → `criteria_global_default`·`criteria_site_default` 인덱스 재정의 → **그 다음** 시드. 순서를 어기면 `002_functions_seed.sql:179`의 `floor-kcs-exposed`가 이미 `(surface='floor')` 키를 점유하고 있어 구배 기본 기준 INSERT가 유니크 위반으로 죽는다.

**⚠ `003_dashboard_support.sql:57-59`의 관례가 여기엔 적용되지 않는다.** 그 파일은 "`create or replace`는 ACL을 보존하므로 grant 재실행 불필요"라고 적어 뒀는데, 007은 `fn_resolve_criteria`의 **인자를 바꾸므로 drop + create**가 필요하고 drop은 ACL을 함께 가져간다. 재발급하지 않으면 커밋 `5181952`가 고친 PUBLIC EXECUTE 결함이 되살아난다.

- [ ] **Step 1: 파일 생성 - 헤더와 enum·컬럼**

```sql
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
```

- [ ] **Step 2: 인덱스 재정의**

```sql
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
```

- [ ] **Step 3: `fn_resolve_criteria` 재작성**

```sql
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
```

- [ ] **Step 4: `registrations` 테이블 (스펙 §3.6)**

```sql
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
```

> RLS는 001의 전 테이블 관례를 따른다. `enable`만 하고 정책을 빠뜨리면 `authenticated` 전면 거부가 되어 대시보드가 아무것도 못 읽는다.

- [ ] **Step 5: 구배 기준 5종 시드**

수치의 근거·검증 등급·인용 주의사항은 **`docs/slope-criteria-sources.md`가 정본**이다. 아래 `source_text`는 그 문서의 요약이다.

```sql
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
```

> `slope-indoor-level`을 기본값으로 둔 이유: 배수구를 지정하지 않아도 의미가 성립하는 유일한 기준이라, 사용자가 아무것도 고르지 않고 돌렸을 때 가장 덜 틀린다.

- [ ] **Step 6: PostgREST 스키마 캐시 갱신**

```sql
-- 6) PostgREST 스키마 캐시 갱신 ----------------------------------------------
-- 이 저장소에서 함수 시그니처를 바꾸는 첫 마이그레이션이다. Supabase가 DDL 이벤트
-- 트리거로 자동 갱신하지만, 반영이 늦으면 대시보드의 RPC 호출이 "함수를 찾을 수
-- 없음"으로 실패하므로 명시적으로 알린다.
notify pgrst, 'reload schema';
```

- [ ] **Step 7: 자기검증 - 순서와 멱등성**

셋 다 확인하고 결과를 보고서에 적는다.

1. 파일 안에서 `alter table criteria add column ... kind`가 `create unique index criteria_global_default`보다 **먼저** 나오고, 그것이 `insert into criteria`보다 **먼저** 나오는가
2. 새로 만드는 모든 객체가 멱등인가: `do $$ ... exception when duplicate_object` 2개, `if not exists` 3개(analyses.kind, criteria.kind, registrations), `drop ... if exists` 5개, `on conflict do nothing` 1개
3. `fn_resolve_criteria` 3인자 시그니처에 대한 `revoke` 1줄 + `grant` 2줄이 있는가

```bash
grep -n "add column if not exists\|drop index if exists\|drop function if exists\|on conflict do nothing\|duplicate_object\|create table if not exists" supabase/migrations/007_slope_analysis.sql
```

- [ ] **Step 8: 셋업 문서 갱신**

`docs/SUPABASE_SETUP.md`가 아직 "파일 5개 / 001~005"로 남아 있다. **006이 이미 누락된 상태**다. 006과 007을 함께 반영한다. 신규 환경에서 이게 빠지면 "보고서 삭제 불가 + 구배 기능 전무"인데 오류 메시지는 나오지 않는다.

같은 파일의 검증 쿼리(`fn_resolve_criteria` 2인자 호출)도 3인자 기본값 호출로 동작하는지 확인하고, 구배 기준이 조회되는 예시를 하나 추가한다.

- [ ] **Step 9: 커밋**

```bash
git add supabase/migrations/007_slope_analysis.sql docs/SUPABASE_SETUP.md
git commit -m "feat(db): 마이그레이션 007 - analysis_kind 차원·기준 조회 확장·정합 이력·구배 기준 5종 시드"
```

---

### Task 2: 워커 구배 분기

**Files:**
- Create: `worker/flatworker/slope.py`, `worker/tests/test_slope_job.py`
- Modify: `worker/flatworker/jobs.py`, `worker/flatworker/db.py`, `worker/tests/fake_db.py`
- Test: `worker/tests/test_slope_job.py`, `worker/tests/test_jobs.py`

**Interfaces:**
- Consumes: Task 1의 `analyses.kind`·`criteria.kind`
- Produces: `slope_overall_verdict(stats)`, `slope_context(db, analysis_id)`, `normalize_slope_stats(stats, analysis_id)`, `run_slope_analysis(...)`

**엔진 계약(실측 확정, 추측 금지):**
- `analyze_slope(path, scale_to_m, threshold, out_dir, subcell_m=0.05, cell_m=2.0, chunk_size=2_000_000, drain_points=None)`
- `threshold`는 **dict**이고 `design_pct`·`pass_pct`·`re_pct`·`dir_pass_deg` 4키를 **대괄호로** 읽는다. 하나라도 없으면 `KeyError`
- `drain_points`는 `(x, y)` 시퀀스의 리스트. 엔진이 `p[0]`/`p[1]` 인덱싱과 `for x, y in ...` 언패킹을 한다. **`{"x":..,"y":..}` dict를 그대로 넘기면 `KeyError: 0`**
- 반환 stats 최상위 키: `format`(="slope-stats-v1")·`cell_m`·`subcell_m`·`threshold`·`summary`·`direction_judged`·`drain_points`·`warnings`·`artifacts`
- `summary` 키: `mean_dev_pct`·`std_dev_pct`·`max_dev_pct`(전 셀 판정불가면 **None**)·`counts`(한국어 5키)·`coverage_pct`
- `stats["artifacts"]`는 **스테이징 절대경로**다. 그대로 DB에 넣으면 안 된다
- `meta`·`engine_version`·`applied_criteria`·`auto_summary`·`n_valid`·`grade_counts` 키는 **없다**

- [ ] **Step 1: 실패하는 테스트 작성 - verdict 매핑**

`worker/tests/test_slope_job.py`:

```python
"""구배 잡 처리 — 판정 매핑·stats 정규화·drain_points 변환."""
import pytest

from flatworker.slope import (normalize_slope_stats, slope_drain_points,
                             slope_overall_verdict)


def _stats(counts, coverage=100.0):
    return {"format": "slope-stats-v1", "cell_m": 2.0, "subcell_m": 0.05,
            "threshold": {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5,
                          "dir_pass_deg": 30},
            "summary": {"mean_dev_pct": 0.1, "std_dev_pct": 0.05,
                        "max_dev_pct": 0.3, "counts": counts,
                        "coverage_pct": coverage},
            "direction_judged": True, "drain_points": [[1.0, 2.0]],
            "warnings": [], "artifacts": {"cells_csv": "/tmp/x/slope_cells.csv",
                                          "map_png": "/tmp/x/slope_map.png"}}


def _counts(**kw):
    base = {"적합": 0, "경계": 0, "보수": 0, "재시공": 0, "판정불가": 0}
    base.update(kw)
    return base


def test_verdict_takes_worst_grade():
    # 평활도 overall_verdict와 같은 우선순위: 재시공 > 보수 > 경계 > 적합
    assert slope_overall_verdict(_stats(_counts(적합=10, 재시공=1))) == "rework"
    assert slope_overall_verdict(_stats(_counts(적합=10, 보수=1))) == "repair"
    assert slope_overall_verdict(_stats(_counts(적합=10, 경계=1))) == "borderline"
    assert slope_overall_verdict(_stats(_counts(적합=10))) == "pass"


def test_verdict_is_none_when_nothing_decidable():
    # 판정불가만 있으면 판정을 만들어내지 않는다. analyses.overall_verdict enum에는
    # 판정불가에 해당하는 값이 없으므로 NULL로 두는 것이 유일하게 정직하다.
    assert slope_overall_verdict(_stats(_counts(판정불가=25), coverage=0.0)) is None


def test_verdict_ignores_na_when_others_exist():
    assert slope_overall_verdict(_stats(_counts(적합=5, 판정불가=20))) == "pass"


def test_normalize_replaces_absolute_artifact_paths():
    # 엔진은 스테이징 절대경로를 넣는데 그 디렉터리는 잡이 끝나면 지워진다.
    # DB에는 스펙 §6.3 규약의 버킷-상대 문자열만 저장해야 한다.
    s = normalize_slope_stats(_stats(_counts(적합=4)), "abc-123")
    assert s["artifacts"] == {"cells_csv": "artifacts/abc-123/slope_cells.csv",
                              "map_png": "artifacts/abc-123/slope_map.png"}


def test_normalize_does_not_mutate_input():
    original = _stats(_counts(적합=4))
    normalize_slope_stats(original, "abc-123")
    assert original["artifacts"]["cells_csv"] == "/tmp/x/slope_cells.csv"


def test_drain_points_converts_params_shape():
    # 스펙 §3.5는 params에 {"x":..,"y":..}를 넣는데 엔진은 (x, y) 언패킹을 한다.
    assert slope_drain_points({"drain_points": [{"x": 3.2, "y": 5.1}]}) == [(3.2, 5.1)]


def test_drain_points_absent_is_none():
    assert slope_drain_points({}) is None
    assert slope_drain_points(None) is None
    assert slope_drain_points({"drain_points": []}) is None
```

- [ ] **Step 2: 실패 확인**

```bash
cd worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest tests/test_slope_job.py -q
```
Expected: FAIL - `ModuleNotFoundError: No module named 'flatworker.slope'`

- [ ] **Step 3: `worker/flatworker/slope.py` 구현**

```python
"""구배 분석(세부과업 4) 워커 로직 — 스펙 §6.4.

평활도와 잡 타입을 공유한다(analyze). 워커가 analysis_id로 행을 읽으므로 종류가
그 안에 들어 있고, 잡 타입을 새로 만들 이유가 없다. 다만 엔진 입력·stats 스키마·
판정 어휘가 전부 달라서 경로를 분리한다.
"""
from flatness.core.pipeline import analyze_slope

# 구배 등급(한국어) -> analyses.overall_verdict enum. '판정불가'는 대응하는 enum
# 멤버가 없어 의도적으로 빠져 있다 - 판정을 만들어내지 않고 NULL로 둔다.
_VERDICT = {"재시공": "rework", "보수": "repair", "경계": "borderline", "적합": "pass"}
_WORST_FIRST = ("재시공", "보수", "경계")


def slope_overall_verdict(stats):
    """구배 stats -> 종합 판정. 평활도 overall_verdict와 같은 우선순위 규칙."""
    counts = (stats.get("summary") or {}).get("counts") or {}
    if not any(counts.get(g, 0) for g in _VERDICT):
        return None
    for grade in _WORST_FIRST:
        if counts.get(grade, 0) > 0:
            return _VERDICT[grade]
    return "pass"


def slope_drain_points(params):
    """analyses.params -> 엔진이 받는 (x, y) 리스트.

    스펙 §3.5는 params에 [{"x":3.2,"y":5.1}] 형태를 규정했는데 엔진은 p[0]/p[1]
    인덱싱과 `for x, y in ...` 언패킹을 한다. 변환 없이 넘기면 KeyError: 0이다.
    """
    pts = (params or {}).get("drain_points") or []
    return [(float(p["x"]), float(p["y"])) for p in pts] or None


def normalize_slope_stats(stats, analysis_id):
    """DB 저장 전 정규화. 원본을 건드리지 않고 사본을 돌려준다.

    엔진은 artifacts에 스테이징 **절대경로**를 넣는데 그 디렉터리는 잡이 끝나면
    지워진다(artifacts.staging_dir). 스펙 §6.3 규약대로 버킷-상대 문자열로 바꾼다.
    호스트 파일시스템 경로가 클라이언트에 노출되는 문제도 함께 사라진다.
    """
    out = dict(stats)
    art = stats.get("artifacts") or {}
    out["artifacts"] = {
        k: f"artifacts/{analysis_id}/{str(v).replace(chr(92), '/').rsplit('/', 1)[-1]}"
        for k, v in art.items()
    }
    return out
```

> `chr(92)`는 백슬래시다. 워커는 리눅스 컨테이너에서 돌지만 로컬 개발은 Windows라 두 구분자를 모두 처리해야 한다.

- [ ] **Step 4: 통과 확인**

```bash
cd worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest tests/test_slope_job.py -q
```
Expected: PASS (7개)

- [ ] **Step 5: 실패하는 테스트 - `set_current_analysis`가 kind를 격리하는가**

`worker/tests/test_slope_job.py`에 추가. **이 테스트가 이 태스크에서 가장 중요하다** - 스펙 §3.2가 막으려던 증상이 DB 인덱스가 아니라 워커 코드 경로로 재현되는 것을 잡는다.

```python
def test_slope_finalize_does_not_unset_flatness_current(fake_db_with_two_kinds):
    """구배 분석을 현재로 세워도 같은 스캔의 평활도 현재 분석이 유지돼야 한다.

    007이 analyses_current를 (scan_id, kind)로 넓혀도 워커의 PATCH가 kind를
    빠뜨리면 같은 증상이 그대로 재현된다. DB는 이제 두 행을 허용하는데 워커가
    스스로 하나를 내려버리므로 오류도 안 난다 - 조용한 회귀다.
    """
    db = fake_db_with_two_kinds
    db.set_current_analysis("scan-1", "slope-analysis", kind="slope")
    assert db.current_analysis[("scan-1", "flatness")] == "flat-analysis"
    assert db.current_analysis[("scan-1", "slope")] == "slope-analysis"
```

`fake_db_with_two_kinds` 픽스처는 기존 `worker/tests/fake_db.py`의 `FakeDB`를 쓰되 `current_analysis` 매핑 키를 `(scan_id, kind)` 튜플로 바꾼 것이다. 기존 `FakeDB.set_current_analysis(scan_id, analysis_id)` 호출부(`test_jobs.py:41,85`)가 깨지지 않도록 `kind='flatness'` 기본값을 준다.

- [ ] **Step 6: 실패 확인 → `db.py`·`fake_db.py` 수정 → 통과 확인**

`worker/flatworker/db.py`의 `set_current_analysis`:

```python
def set_current_analysis(self, scan_id, analysis_id, kind="flatness"):
    """해당 스캔·종류의 현재 분석을 교체한다.

    kind 필터가 없으면 구배 분석이 완료될 때마다 같은 스캔의 평활도 현재 분석이
    함께 내려간다(007이 인덱스를 (scan_id, kind)로 넓혀도 이쪽은 코드 문제라
    그대로 재현된다). deleted_at 필터도 함께 건다 - 삭제된 행까지 다시 쓸 이유가 없다.
    """
```

PATCH 필터에 `kind=eq.{kind}`와 `deleted_at=is.null`을 추가한다. 기존 `is_current` 해제 쿼리와 신규 지정 쿼리 **양쪽** 모두에 건다.

- [ ] **Step 7: `jobs.py` 분기 - 실패하는 통합 테스트 먼저**

`worker/tests/test_slope_job.py`에 추가:

```python
def test_handle_analyze_routes_slope_kind_to_slope_pipeline(monkeypatch, slope_job_env):
    """analyses.kind='slope'면 analyze_floor가 아니라 analyze_slope로 간다."""
    called = {}

    def fake_analyze_slope(path, scale_to_m, threshold, out_dir, **kw):
        called["threshold"] = threshold
        called["drain_points"] = kw.get("drain_points")
        return _stats(_counts(적합=4))

    monkeypatch.setattr("flatworker.slope.analyze_slope", fake_analyze_slope)
    monkeypatch.setattr("flatworker.jobs.analyze_floor",
                        lambda *a, **k: pytest.fail("평활도 경로로 새면 안 된다"))
    handle_analyze(slope_job_env.db, slope_job_env.cfg,
                   {"analysis_id": slope_job_env.slope_analysis_id})
    # 구배 기준 행의 thresholds[0]이 dict 그대로 엔진에 가야 한다.
    # _to_criterion으로 감싸면 KeyError: 'metric'으로 죽는다.
    assert called["threshold"]["design_pct"] == 2.0
    assert called["drain_points"] == [(3.2, 5.1)]


def test_handle_analyze_slope_saves_mapped_verdict_and_relative_paths(slope_job_env):
    row = slope_job_env.db.analyses[slope_job_env.slope_analysis_id]
    assert row["overall_verdict"] in {"pass", "borderline", "repair", "rework", None}
    assert row["coverage_pct"] == 100.0
    assert not str(row["stats"]["artifacts"]["cells_csv"]).startswith("/")
```

- [ ] **Step 8: `jobs.py` 수정**

`_load_context`가 `_to_criterion`을 무조건 호출하는 구조라 **kind 분기가 그 앞에 와야 한다.** 구배 기준 행은 `thresholds[0]`에 `metric`·`pass_mm`·`rework_mm`이 없어 `_to_criterion`에서 `KeyError: 'metric'`으로 죽는다.

```python
def handle_analyze(db, cfg, payload):
    analysis_id = payload["analysis_id"]
    analysis = db.get_analysis(analysis_id)
    kind = analysis.get("kind") or "flatness"
    if kind == "slope":
        return _handle_analyze_slope(db, cfg, analysis)
    # 이하 기존 평활도 경로 그대로
    analysis, scan, crit, u_mm = _load_context(db, analysis_id)
    ...
```

`_finalize`는 `handle_import`도 공유하므로 **시그니처를 넓히되 기본값을 준다**: `_finalize(db, analysis_id, scan_id, stats, kind="flatness")`. 구배용 파생 컬럼 매핑은 `_finalize`를 재사용하지 말고 별도로 쓴다 - 기존 `_finalize`는 전부 `.get()` 기본값이라 구배 stats를 태우면 `coverage_pct`·`overall_verdict`·`engine_version`·`applied_criteria`·`auto_summary`가 **조용히 NULL**이 되고 잡은 '성공'으로 끝난다.

구배 경로가 채워야 할 컬럼:
- `coverage_pct` ← `stats["summary"]["coverage_pct"]`
- `overall_verdict` ← `slope_overall_verdict(stats)`
- `warnings` ← `stats["warnings"]` (한국어 문장 그대로)
- `artifacts_dir` ← `f"artifacts/{analysis_id}"`
- `engine_version` ← `flatness.ENGINE_VERSION` (구배 stats에 `meta`가 없다)
- `applied_criteria` ← `{"name": criteria_row["name"], "source": criteria_row["source_text"], **threshold}`
- `stats` ← `normalize_slope_stats(stats, analysis_id)`

`auto_summary`는 구배용 문안이 없으므로 `None`으로 둔다(단계 D에서 화면과 함께 정한다).

- [ ] **Step 9: 전체 워커 스위트 확인**

```bash
cd worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest -q
```
Expected: 92보다 늘어난 수, 실패 0. 늘어난 수가 실제 추가한 테스트 수와 맞는지 대조할 것

- [ ] **Step 10: 커밋**

```bash
git add worker/
git commit -m "feat(worker): analyze 잡 kind 분기 - 구배 파이프라인·판정 매핑·경로 정규화"
```

---

### Task 3: 대시보드 kind 인지 조회 (회귀 차단)

**Files:**
- Modify: `dashboard/lib/domain/types.ts`, `lib/domain/labels.ts`, `lib/domain/criteria.ts`, `app/page.tsx`, `app/sites/[id]/page.tsx`, `app/reports/new/page.tsx`, `app/analyses/[id]/page.tsx`
- Create: `dashboard/components/analysis/slope-placeholder.tsx`
- Test: 각 도메인 함수의 기존 테스트 파일 + 신규

**Interfaces:**
- Consumes: Task 1의 `analyses.kind`
- Produces: `AnalysisKind`, `SlopeThreshold`, `ANALYSIS_KIND_LABEL`, `isSlopeStats(stats)`

**이 태스크는 새 기능이 아니라 회귀 차단이다.** 007과 워커만 배포하고 여기를 손대지 않으면 다음이 즉시 깨진다.

| 위치 | kind 미필터 시 증상 |
|---|---|
| `app/page.tsx:19` → `summary.ts:31-38` | 홈 카드 판정 집계가 **2배**로 계상 |
| `app/sites/[id]/page.tsx:47,53-58` | `new Map(...)`이 같은 `scan_id`를 덮어써 **조회 순서에 따라 비결정적** |
| `app/reports/new/page.tsx:35` | 구배 분석이 보고서 후보로 섞임 + 평활도와 육안 구별 불가 |
| `app/analyses/[id]/page.tsx:13` | URL 직접 접근 시 `lib/domain/stats.ts:5`의 `stats.meta.source`에서 **TypeError** |

- [ ] **Step 1: 실패하는 테스트 - 구배 stats 판별**

`dashboard/lib/domain/__tests__/stats.test.ts`에 추가:

```ts
describe('isSlopeStats', () => {
  it('구배 stats를 format 키로 판별한다', () => {
    expect(isSlopeStats({ format: 'slope-stats-v1' })).toBe(true);
  });
  it('평활도 stats에는 format 키가 없다', () => {
    expect(isSlopeStats({ meta: { source: undefined }, n_cells: 4 })).toBe(false);
  });
  it('null·undefined를 견딘다', () => {
    expect(isSlopeStats(null)).toBe(false);
    expect(isSlopeStats(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

```ts
// lib/domain/stats.ts
/** 구배 분석 stats인지 내용으로 판별한다.
 *
 * analyses/[id]는 .eq('id', id)뿐이라 URL 직접 접근을 쿼리 필터로 막을 수 없다.
 * 엔진이 이미 최상위에 format 판별자를 넣고(pipeline.py), 평활도 build_stats에는
 * 이 키가 없으므로 kind 컬럼 없이도 안전하게 갈린다. */
export function isSlopeStats(stats: unknown): boolean {
  return !!stats && typeof stats === 'object'
    && (stats as { format?: string }).format === 'slope-stats-v1';
}
```

```bash
cd dashboard && npm test -- stats
```

- [ ] **Step 3: 타입 추가**

```ts
// lib/domain/types.ts
export type AnalysisKind = 'flatness' | 'slope';

/** 구배 기준의 thresholds[0] 형태. 평활도(span_m/metric/pass_mm/rework_mm)와 다르다. */
export interface SlopeThreshold {
  use: string;
  design_pct: number;
  pass_pct: number;
  re_pct: number;
  dir_pass_deg: number;
}
```

`AnalysisRow`와 `CriteriaRow`에 `kind: AnalysisKind`를 추가한다.

- [ ] **Step 4: 라벨**

```ts
// lib/domain/labels.ts
export const ANALYSIS_KIND_LABEL: Record<AnalysisKind, string> = {
  flatness: '평활도',
  slope: '구배',
};
```

- [ ] **Step 5: `thresholdSummary` 구배 분기**

`lib/domain/criteria.ts:5`가 `t.metric === 'plumbness' || t.span_m === null`로 **strict `=== null`** 검사를 한다. 구배 threshold에는 `span_m` 키가 아예 없어 `undefined !== null`이라 **평활도 분기로 떨어져** "undefinedm당 허용 undefinedmm"가 출력된다.

구배 분기를 **맨 앞에** 넣는다:

```ts
if ('design_pct' in t) {
  return `설계 ${t.design_pct}% · 적합 ±${t.pass_pct}%p · 재시공 ${t.re_pct}%p 초과`;
}
```

기존 두 분기의 조건은 건드리지 않는다.

- [ ] **Step 6: `is_current` 조회 3곳에 kind 필터**

- `app/page.tsx:18-19` - `.eq('kind', 'flatness')` 추가. select 목록에도 `kind`를 넣는다
- `app/sites/[id]/page.tsx:45-47` - 같은 필터. Map 키는 그대로 `scan_id`로 둘 수 있다(평활도만 남으므로)
- `app/reports/new/page.tsx:31-35` - `.eq('kind', 'flatness')`

> 홈·현장 트리에 구배 판정을 함께 보이는 것은 **단계 D의 몫**이다. 지금은 평활도만 보여 기존 동작을 그대로 유지하는 것이 옳다. 두 종류를 섞어 집계하는 화면 설계가 아직 없기 때문이다.

- [ ] **Step 7: `analyses/[id]` 가드 + 안내 화면**

`app/analyses/[id]/page.tsx`에서 `isSlopeStats(analysis.stats)`면 `AnalysisResult` 대신 `SlopePlaceholder`를 렌더한다.

`components/analysis/slope-placeholder.tsx`:

```tsx
// 구배 결과 화면은 단계 D에서 만든다. 그때까지 이 화면이 URL 직접 접근을 받는다.
// AnalysisResult로 흘려보내면 lib/domain/stats.ts의 coverageLabel이 stats.meta를
// 옵셔널 체이닝 없이 읽어 TypeError로 페이지가 죽는다.
```

표시할 것(전부 구배 stats에 실제로 있는 값이다):
- 종류 배지 "구배"
- 판정 요약: `summary.counts` 5종 개수, `coverage_pct`
- 편차 통계: `mean_dev_pct`·`std_dev_pct`·`max_dev_pct` (**셋 다 null일 수 있다** - 전 셀 판정불가인 경우. `?? '판정 가능한 셀 없음'`로 받을 것)
- `warnings` 배열을 그대로 나열(이미 한국어 문장이다)
- `artifacts.map_png`를 `/api/data/` 경로로 링크
- "상세 결과 화면은 준비 중입니다" 안내

- [ ] **Step 8: 대시보드 스위트 확인 후 커밋**

```bash
cd dashboard && npm test
```
Expected: 152보다 늘어난 수, 실패 0

```bash
git add dashboard/
git commit -m "feat(dashboard): kind 인지 조회로 구배 분석 회귀 차단 + 구배 결과 안내 화면"
```

---

### Task 4: 대시보드 구배 분석 시작

**Files:**
- Modify: `dashboard/components/reanalyze-button.tsx`, `app/scans/[id]/page.tsx`, `components/unit-confirm-form.tsx`, `components/upload-form.tsx`
- Create: `dashboard/components/__tests__/analyze-buttons.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `fn_resolve_criteria(site, surface, kind)`, Task 3의 `AnalysisKind`·`ANALYSIS_KIND_LABEL`

**⚠ 현재 코드의 회귀 경로 (반드시 함께 고칠 것):**
`app/scans/[id]/page.tsx:33`의 `latest = analyses[0]`은 `created_at desc` 최신 1건이라 kind를 모른다. 구배 분석을 한 번이라도 돌리면 평활도 분석의 진행 표시·완료 링크·재분석 버튼이 화면에서 **사라진다**. 게다가 `reanalyze-button.tsx:57-59`의 insert에 `kind`가 없어 DB 기본값 `flatness`가 들어가므로, 구배가 latest인 상태에서 "다시 분석"을 누르면 **종류가 조용히 바뀐다.**

- [ ] **Step 1: 실패하는 테스트 - insert가 kind를 싣는가**

`dashboard/components/__tests__/analyze-buttons.test.tsx`:

```tsx
// 기존 reanalyze-button.test.tsx:24의 스텁은 insert 인자를 검증하지 않는다.
// 그래서 kind를 빠뜨려도 스위트가 초록으로 통과한다 - 스파이가 필요하다.
it('구배 분석 버튼은 kind=slope로 analyses를 만든다', async () => {
  const insertSpy = vi.fn().mockReturnValue({
    select: () => ({ single: () => ({ data: { id: 'a1' }, error: null }) }),
  });
  // ... createClient 스텁이 insertSpy를 쓰도록 배선
  render(<AnalyzeButton kind="slope" ... />);
  await userEvent.click(screen.getByRole('button', { name: /구배 분석/ }));
  expect(insertSpy).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'slope', criteria_id: 'slope-crit-1' }));
});

it('평활도 분석 버튼은 kind=flatness로 만든다', async () => { /* 대칭 */ });

it('구배 버튼은 구배 기준을 해석해 쓴다', async () => {
  // fn_resolve_criteria가 (site_id, 'floor', 'slope')로 불려야 한다.
  // scans.selected_criteria_id(평활도 기준)를 그대로 쓰면 워커가 KeyError로 죽는다.
  expect(rpcSpy).toHaveBeenCalledWith('fn_resolve_criteria',
    expect.objectContaining({ p_kind: 'slope' }));
});
```

- [ ] **Step 2: 실패 확인 → `ReanalyzeButton`을 kind 인지형으로 일반화 → 통과 확인**

Props에 `kind: AnalysisKind`를 추가하고 insert에 명시한다. 버튼 문구는 종류를 드러낸다(`{ANALYSIS_KIND_LABEL[kind]} 분석`).

`criteriaId`는 kind에 따라 다르게 온다:
- `flatness`: 기존대로 `s.selected_criteria_id ?? latest.criteria_id`
- `slope`: `fn_resolve_criteria(site_id, 'floor', 'slope')`의 `is_default` 행. **`scans.selected_criteria_id`를 쓰면 안 된다** - kind 개념이 없는 컬럼이라 평활도 기준이 실린다

`isImport` 분기는 **평활도에만** 적용한다. 임포트 스캔에 구배 분석을 거는 것은 의미가 없으므로(임포트 원본은 점 단위 편차 목록이지 점군이 아니다) 구배 버튼을 숨긴다.

- [ ] **Step 3: `app/scans/[id]/page.tsx` - 종류별 섹션 2벌**

`analyses` 조회 결과를 kind로 갈라 `latestFlatness`·`latestSlope`를 만들고, 분석 섹션을 두 벌 그린다. 각 섹션의 `inProgress`는 **자기 종류의 latest만** 본다.

```tsx
// 종류별로 가장 최근 1건씩. analyses[0] 하나가 화면 전체를 지배하면 구배 분석을
// 돌린 순간 평활도 진행 상태·결과 링크가 사라진다.
const latestFlatness = analyses.find((a) => (a.kind ?? 'flatness') === 'flatness');
const latestSlope = analyses.find((a) => a.kind === 'slope');
```

- [ ] **Step 4: 기존 insert 3곳에 `kind` 명시**

`unit-confirm-form.tsx:47-52`, `upload-form.tsx:120-123` - `kind: 'flatness'`를 **명시**한다. DB 기본값에 기대지 않는다. 기본값에 기대면 나중에 기본값을 바꿀 때 조용히 의미가 바뀐다.

`upload-form.tsx:45-47`의 `fn_resolve_criteria` 호출은 2인자 그대로 둔다(기본값 `'flatness'`가 정확히 의도한 값이다). 다만 **주석으로 그 의존을 명시**한다.

- [ ] **Step 5: 전체 스위트 + 실제 화면 확인**

```bash
cd dashboard && npm test
```

그리고 **실제로 띄워서 확인한다**(사용자 상시 지시: 검증에 화면 캡처 대조 포함).
1. `preview_start`로 개발 서버 기동
2. 스캔 상세로 이동해 "평활도 분석"·"구배 분석" 두 버튼이 보이는지 스크린샷
3. `read_console_messages`로 오류 0건 확인
4. 두 분석이 공존할 때 양쪽 섹션이 각각 보이는지 확인

- [ ] **Step 6: 커밋**

```bash
git add dashboard/
git commit -m "feat(dashboard): 스캔 상세에 구배 분석 시작 버튼 + 종류별 분석 섹션"
```

---

### Task 5: 락스텝 안전장치와 배포 문서

**Files:**
- Modify: `engine/flatness/__init__.py`, `worker/flatworker/runner.py`, `docs/DEPLOY.md`, `docs/superpowers/plans/2026-07-28-p1b-backlog-notes.md`
- Test: `worker/tests/test_runner.py`

**왜 필요한가:** `runner.py:22 → jobs.py:9`가 import 체인이라 엔진에 `analyze_slope`가 없는 상태로 워커를 올리면 **precheck·analyze·import·report 전부 정지**하고, 진단 단서는 기동 시 `ImportError` 트레이스백뿐이다. 그런데 `ENGINE_VERSION`은 `"p1d-0.4.0"`에 멈춰 있어 구배가 있는 엔진과 없는 엔진을 **런타임에도 패키징에서도 구별할 방법이 없다.**

- [ ] **Step 1: `ENGINE_VERSION` 인상**

```python
# engine/flatness/__init__.py
ENGINE_VERSION = "p4-0.5.0"
```

구배 분석이 들어간 첫 버전이다. `analyses.engine_version`에 기록되므로 나중에 "이 분석이 어느 엔진으로 돌았나"를 답할 수 있다.

- [ ] **Step 2: 실패하는 테스트 - 기동 시 엔진 능력 검증**

```python
def test_runner_reports_missing_slope_support_clearly(monkeypatch, capsys):
    """엔진이 구배를 모르면 기동 시 사람이 읽을 수 있는 메시지를 남긴다.

    ImportError 트레이스백만 뜨면 배포 순서가 틀렸다는 사실이 드러나지 않는다.
    """
```

- [ ] **Step 3: 구현**

`runner.py` 기동 로그에 엔진 버전을 함께 찍고, `analyze_slope` import 실패 시 "엔진을 먼저 배포해야 합니다"를 명시하는 메시지를 남긴다. 기존 기동 로그 형식(`[flatworker] 시작: worker_id=..., storage_backend=..., poll_interval=...`)을 유지하고 `engine_version=`을 덧붙인다.

- [ ] **Step 4: `docs/DEPLOY.md` 갱신**

- 마이그레이션 목록에 **006·007** 추가(현재 001~005에서 멈춰 있다)
- **배포 순서 경고**: 007 적용 → 엔진·워커 동시 배포 → 대시보드. 007을 적용하지 않고 대시보드를 배포하면 `kind` 컬럼이 없어 모든 분석 조회가 실패한다
- 구배 분석 스모크 절차 1건

- [ ] **Step 5: 백로그 기록**

단계 C가 남기는 부채를 티켓으로 남긴다.

- 구배 `warnings` 어휘가 평활도(ASCII 슬러그)와 달리 완성 한국어 문장이라 코드 기반 필터링이 불가능하다. `reports.snapshot`에 그대로 박제되면 영구화된다
- `slope_cells.csv`가 `utf-8-sig`(BOM)인데 평활도 `results.csv`는 `utf-8`이다. 단계 D에서 CSV를 파싱하면 첫 열 이름이 `\ufeffcx`로 읽힌다
- 구배에는 `cells.json`에 해당하는 파일이 없다. 단계 D의 셀 표는 CSV 파싱이 필요하다
- `render_slope_map` 실패가 격리돼 있지 않아(`pipeline.py:210`) 렌더가 죽으면 `slope_stats.json`이 없는 반쪽 산출물이 된다. 평활도가 티켓 I1 이후 확립한 "렌더 실패가 판정을 죽이지 않는다" 원칙이 구배에 적용되지 않았다
- `analyze_slope`는 잘못된 단위나 벽 스캔에도 예외를 던지지 않고 "전 셀 판정불가로 성공"한다. 평활도의 조기 실패(`pipeline.py:38-39,44`)에 대응하는 방어가 없다
- `cell_m`의 출처가 정해지지 않아 엔진 기본값 2.0이 조용히 고정된다. 나중에 바꾸면 과거 분석과 비교가 깨진다

- [ ] **Step 6: 전체 스위트 3종 + 커밋**

```bash
cd engine && python -m pytest -q
```
```bash
cd worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest -q
```
```bash
cd dashboard && npm test
```

```bash
git add engine/ worker/ docs/
git commit -m "chore: 엔진 버전 인상·워커 기동 검증·배포 문서 006/007 반영"
```

---

## 완료 조건

- [ ] 세 스위트 전부 통과, 각각 기준선(168/92/152) 이상
- [ ] `supabase/migrations/007_slope_analysis.sql`이 순서 제약을 지키고 멱등
- [ ] 스캔 상세에서 "평활도 분석"·"구배 분석" 두 버튼이 보이고 서로를 밀어내지 않음 (**스크린샷으로 확인**)
- [ ] 구배 분석 URL 직접 접근 시 안내 화면이 뜨고 콘솔 오류 0건
- [ ] 보고서 후보 목록에 구배 분석이 나타나지 않음
- [ ] 사용자 대면 문자열에 U+2014 0건

## 범위 밖 (단계 D 이후)

- 구배 결과 화면(히트맵·방향 화살표·구간별 표) - 단계 D
- 배수구 클릭 지정과 `slope_judge` 재판정 잡 - 단계 D
- 홈·현장 트리에 구배 판정 함께 표시 - 단계 D
- 구배 분석의 PDF 보고서 포함 - 단계 D 이후
- `registrations`를 쓰는 정합 기능 - 단계 F (007은 스키마만 세운다)

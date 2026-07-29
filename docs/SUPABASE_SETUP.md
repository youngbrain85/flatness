# Supabase 셋업 가이드 (P2)

평활도 분석 시스템의 DB(Supabase Postgres + PostgREST)를 준비하는 절차다. 대상 독자는
로컬 파이썬 워커(`worker/`)를 처음 띄우는 사람. 소요 시간 약 15분, 비용은 Supabase Free
티어 범위 내에서 0원.

## 0. 준비물

- Supabase 계정(없으면 1단계에서 가입)
- 이 저장소 클론본(마이그레이션 SQL 파일 2개: `supabase/migrations/001_schema.sql`,
  `supabase/migrations/002_functions_seed.sql`)
- Python 3.11+ (워커 실행용, 5단계에서 사용)

## 1. Supabase 프로젝트 생성 — 사용자가 직접 수행

**계정 생성·로그인·비밀번호 입력은 이 가이드나 자동화 도구가 대신하지 않는다. 아래
단계를 브라우저에서 직접 진행한다.**

1. https://supabase.com 접속 → 우측 상단 **Sign in**(계정이 없으면 **Start your project**로
   가입) — GitHub 계정으로 로그인하는 것이 가장 빠르다.
2. 대시보드에서 **New project** 클릭.
3. 조직(Organization)을 선택하거나 처음이면 생성한다(개인용이면 기본 조직 그대로 사용).
4. 프로젝트 설정:
   - **Name**: 임의(예: `flatness-demo`)
   - **Database Password**: 강한 비밀번호 생성 후 별도 보관(비밀번호 관리자 등) — 이후
     단계에서 다시 쓰지 않지만 분실 시 DB 직접 접속(psql 등)이 막힌다.
   - **Region**: **Northeast Asia (Seoul)** 권장(지연시간 최소화)
   - **Pricing Plan**: **Free** 선택
5. **Create new project** 클릭 후 프로비저닝 완료까지 1~2분 대기(대시보드에 진행 상태 표시).

## 2. 마이그레이션 실행

좌측 메뉴 **SQL Editor**(연필/코드 아이콘) → **New query**.

1. `supabase/migrations/001_schema.sql` 파일 전체 내용을 복사해 에디터에 붙여넣고
   **Run**(또는 Ctrl+Enter) 클릭. `Success. No rows returned` 확인.
2. 에디터를 비우고(또는 새 쿼리 탭) `supabase/migrations/002_functions_seed.sql` 전체
   내용을 붙여넣고 **Run**. 마찬가지로 성공 메시지 확인.

**반드시 001을 먼저, 002를 그 다음에 실행한다** — 002가 001에서 만든 `jobs`/`criteria`
등 테이블·enum을 전제한다.

실행 중 오류가 나면 대부분 001을 건너뛰었거나 이미 한 번 실행한 마이그레이션을 다시
실행한 경우(테이블/함수 이미 존재)다. 새 프로젝트에서 순서대로 한 번씩만 실행하면 정상.

## 3. 검증 쿼리

SQL Editor에서 새 쿼리로 아래 3개를 순서대로 실행해 스키마·함수·시드 데이터가 제대로
들어갔는지 확인한다.

**(1) 기준 시드 11종 확인** — `criteria` 테이블에 시드 데이터가 정확히 11행 들어왔는지:

```sql
select count(*) from criteria;
```

결과가 **11**이어야 한다.

**(2) 잡 큐 함수 확인** — 잡을 하나 등록하고(`fn_enqueue_job`) 클레임해본다(`fn_job_claim`):

```sql
select fn_enqueue_job('analyze', '{}'::jsonb);
```

반환된 uuid가 새 잡의 id다. 이어서:

```sql
select * from fn_job_claim('test');
```

방금 등록한 잡이 `status = 'processing'`, `locked_by = 'test'`로 반환되면 정상이다.

`fn_job_claim`은 컴포지트(단일 행) 반환 함수이지 `setof`가 아니라서(대기 중인 잡이
없을 때 SQL이 `return null;`을 실행해도) `select *`로 호출하면 SQL Editor 결과창에
**"빈 결과(0행)"가 아니라 id 등 전 컬럼이 null인 1행**이 표시된다 — 두 번째 호출부터
(대기 중인 잡이 이미 소진된 뒤) 이 형태가 나오면 정상이다(SKIP LOCKED 큐가 비어있다는
뜻). 0행짜리 결과를 보고 싶으면 바깥에 필터를 씌운다:

```sql
select * from fn_job_claim('test') where id is not null;
```

검증이 끝나면 방금 클레임한 테스트 잡을 정리한다(방치하면 이 잡이 영영 `processing`에
머물다 `fn_reap_stuck_jobs`가 재큐잉해 `locked_by='test'`인 워커가 없으니 3회 실패
소음만 쌓인다) — 위에서 `fn_enqueue_job`이 돌려준 uuid를 그대로 넣는다:

```sql
select fn_job_complete('<반환된 uuid>');
```

**(3) 기준 조회 함수 확인** — 전역(site 미지정) 바닥 기준 목록:

```sql
select * from fn_resolve_criteria(null, 'floor');
```

`floor-kcs-finish7plus`, `floor-kcs-finish7minus`, `floor-kcs-exposed`(is_default=true),
`floor-molit-cushion`, `floor-lh-exposed`, `floor-lh-thick` 6행이 반환되면 정상이다.

## 4. API 키 확인

좌측 메뉴 **Settings**(톱니바퀴) → **API**.

- **Project URL** — `https://<project-ref>.supabase.co` 형태. 워커 `.env`의
  `SUPABASE_URL`에 그대로 복사.
- **Project API keys** 섹션의 **service_role** 키(`secret` 표시) — 워커 `.env`의
  `SUPABASE_SERVICE_ROLE_KEY`에 복사.

> **경고 — service_role 키는 서버(워커) 전용이다.** 이 키는 RLS(행 단위 보안)를 완전히
> 우회한다. 대시보드/프론트엔드 등 브라우저에서 실행되는 코드에는 **절대** 넣지 않는다.
> `.env` 파일은 `.gitignore`에 이미 등록되어 있어 커밋되지 않는다 — 그래도 실수로
> 커밋하지 않도록 주의한다.

- **anon(public)** 키도 같은 화면에 있다 — 지금 단계(워커)는 사용하지 않는다. P3
  대시보드(로그인 사용자용 클라이언트 SDK)에서 필요하므로 어딘가(비밀번호 관리자 등)에
  **별도로 기록**해 둔다.

## 5. 워커 연결·기동 확인

로컬 저장소의 `worker/` 디렉터리에서 진행한다.

1. `.env` 파일 생성:

   ```
   cd worker
   cp .env.example .env
   ```

   `.env`를 열어 `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`를 4단계에서 복사한 값으로
   채운다(나머지 `DATA_DIR`/`POLL_INTERVAL_S`/`WORKER_ID`는 기본값 그대로 둬도 된다).

2. 의존성 설치(`flatworker`는 로컬 경로의 `flatness` 엔진에 의존하므로 두 줄 모두 필요):

   ```
   pip install -e ../engine
   pip install -e .
   ```

3. 워커 실행:

   ```
   python -m flatworker
   ```

4. 시작 로그 확인:

   ```
   [flatworker] 시작: worker_id=local-1, data_dir=..\data, poll_interval=3.0s
   ```

   이 로그가 찍히고 프로세스가 종료되지 않은 채 대기 중이면 설정·연결이 정상이다(잡
   큐가 비어 있으면 `POLL_INTERVAL_S`마다 조용히 재폴링만 한다 — 별도 로그 없음).
   Ctrl+C로 종료한다.

   `[flatworker] 설정 오류: ...`가 출력되면 `.env`의 필수값(`SUPABASE_URL`/
   `SUPABASE_SERVICE_ROLE_KEY`) 누락을 의미한다. 네트워크/인증 오류(401 등)가 나면
   4단계에서 복사한 키·URL을 다시 확인한다.

## 6. 경로 규약 (raw_file_path·artifacts_dir)

`scans.raw_file_path`·`analyses.artifacts_dir`는 DB에 **버킷-상대 경로 문자열만**
저장한다 — 예: `raw-scans/{site_id}/{scan_id}/raw.ply`, `artifacts/{analysis_id}/`.
`data/` 접두나 OS 절대경로, 워커를 실행한 디렉터리 기준 상대경로는 **저장하지
않는다**(스펙 §6.3).

데모 단계(로컬 워커, Storage 버킷 아직 미사용)에서는 이 값을 소비자가 각자의 저장소
루트에 결합해 실제 위치를 얻는다:

- **워커**는 자신의 `DATA_DIR`(`.env`)에 결합한다 — 예:
  `DATA_DIR=../data` + `raw-scans/site1/scan1/raw.ply` →
  `../data/raw-scans/site1/scan1/raw.ply`. 이 결합은 `worker/flatworker/jobs.py`의
  `_resolve_raw_path`(읽기)와 `artifacts.artifacts_dir()`(쓰기)가 담당한다.
- **P3 대시보드**(정식 구현 시)도 동일 문자열을 자신의 정적 파일 서빙 루트에 결합해
  읽는다.

정식 배포(Storage 버킷 전환) 시에도 이 문자열이 그대로 버킷 키가 되므로, DB에 특정
소비자의 로컬 경로 관례를 섞어 저장하면 두 소비자 중 하나가 항상 깨진다 — 이 규약을
어기지 않는 것이 버킷 전환의 전제 조건이다.

## 참고

- 워커 자체의 실행·테스트·코드 구조는 `worker/README.md` 참고.
- `jobs`/`analyses` 등 산출물 JSON의 필드 계약은 `docs/contracts/stats-schema.md` 참고.
- 이 가이드의 SQL 예시는 `supabase/migrations/002_functions_seed.sql`의 함수 시그니처
  (`fn_job_claim(p_worker text)`, `fn_resolve_criteria(p_site_id uuid, p_surface
  surface_type)` 등)를 정본으로 삼는다 — 마이그레이션이 바뀌면 이 문서도 함께 갱신한다.

# Supabase 셋업 가이드 (P2)

평활도 분석 시스템의 DB(Supabase Postgres + PostgREST)를 준비하는 절차다. 대상 독자는
로컬 파이썬 워커(`worker/`)를 처음 띄우는 사람. 소요 시간 약 15분, 비용은 Supabase Free
티어 범위 내에서 0원.

## 0. 준비물

- Supabase 계정(없으면 1단계에서 가입)
- 이 저장소 클론본(마이그레이션 SQL 파일 12개: `supabase/migrations/001_schema.sql`,
  `supabase/migrations/002_functions_seed.sql`, `supabase/migrations/003_dashboard_support.sql`,
  `supabase/migrations/004_report_support.sql`, `supabase/migrations/005_storage_buckets.sql`,
  `supabase/migrations/006_report_soft_delete.sql`, `supabase/migrations/007_slope_analysis.sql`,
  `supabase/migrations/008_slope_judge_enum.sql`, `supabase/migrations/009_slope_judge_functions.sql`,
  `supabase/migrations/010_scan_height_view.sql`, `supabase/migrations/011_register_enums.sql`,
  `supabase/migrations/012_register_support.sql`)
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

**001 → 002 → 003 → 004 → 005 → 006 → 007까지는 반드시 이 순서로 실행한다** — 뒤
마이그레이션이 앞 마이그레이션이 만든 테이블·enum·함수를 전제하며, 특히 003과 004는
순서를 건너뛰거나 뒤집으면 오류 없이 조용히 기능이 사라질 수 있다(아래 4단계 경고
참고). 005도 순서를 지켜야 하며, 클라우드 배포 전에 누락되면 Storage 버킷이 없어
업로드가 전부 실패한다(아래 5번 참고). 007은 002가 만든 `fn_resolve_criteria(uuid,
surface_type)` 함수를 drop 후 3인자 시그니처로 재생성하므로 001·002 다음에 실행돼
있어야 한다(006과는 직접적인 의존 관계가 없다).

**008·009는 재판정(구배 배수구 재클릭) 기능에만, 011·012는 정합(두 스캔 합치기)
기능에만 필요한 선택 단계다** - 워커·대시보드가 아직 세부과업 4 단계 D·F를
배포하지 않았다면 지금 당장 건너뛰어도 001~007 어떤 기능에도 영향이 없다. 다만
**실행하기로 했다면 반드시 007 다음, 008 다음 009 순서를 지킨다**(008과 009는 한
번에 이어 실행하면 안 되고 반드시 두 번 나눠 Run 한다 - 아래 8·9번 참고).
**011·012도 같은 이유로 반드시 두 번 나눠 Run 한다**(아래 11·12번 참고). 나중에
순서를 다시 챙기는 수고를 덜려면 지금 007과 함께 실행해 두는 것을 권장한다.

> **⚠ 011·012를 쓰려면 008은 건너뛸 수 없다(009는 건너뛸 수 있다).** 012가 잡 큐
> 함수 3종(`fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs`)의 **가장 마지막 확장
> 재정의**라, 009의 본문(= `slope_judge` 분기)을 그대로 포함한 위에 `register`
> 분기만 더한 형태이기 때문이다. 즉 **012를 적용하면 재판정을 쓰든 안 쓰든 함수
> 본문에 `'slope_judge'`라는 job_type 라벨이 들어간다** - 008 미적용 DB에서는 그
> 라벨이 존재하지 않아, 워커가 **아무 잡이나** claim 하는 순간 "invalid input
> value for enum job_type: slope_judge"로 잡 큐 전체가 멎는다. 012 맨 앞의
> 카탈로그 가드가 이 조합을 Run 시점에 한국어로 막아 주지만, 애초에 008을 함께
> 적용하는 것이 정답이다(008은 `add value if not exists` 한 줄이라 재판정을 안
> 써도 비용이 없다). 반대로 **009 자체는 012가 상위집합이므로 건너뛰어도 된다.**
>
> **그리고 012 다음에 003·004·009를 다시 실행하면 안 된다** - `create or replace`가
> 012의 정의를 옛 정의로 덮어써 register 상태 전이가 오류 없이 사라진다(아래
> 9번·12번 경고 참고). 이 프로젝트를 워커만 쓰고 대시보드나 보고서 기능을 쓰지
않을 계획이라도 003·004까지 실행해 두는 것을 권장한다 — 나중에 P3/P4를 켤 때 순서를
다시 챙기지 않아도 된다.

실행 중 오류가 나면 대부분 앞 단계를 건너뛰었거나 이미 한 번 실행한 마이그레이션을 다시
실행한 경우(테이블/함수 이미 존재)다. 새 프로젝트에서 순서대로 한 번씩만 실행하면 정상.

3. `supabase/migrations/003_dashboard_support.sql` 전체 내용을 붙여넣고 **Run**.
   사진용 `photos` 버킷과 Realtime 구독 설정이 만들어진다(P4 보고서의 현장 사진
   자산도 이 버킷을 전제하므로, P4를 쓸 계획이면 003은 선택이 아니라 필수다).
   검증: 좌측 메뉴 **Storage**에 `photos` 버킷이 보이면 정상.
4. `supabase/migrations/004_report_support.sql` 전체 내용을 붙여넣고 **Run**. 적용되는
   내용:
   - `reports.gen_status`(queued|processing|done|failed)·`reports.gen_error` 컬럼 신설
     (PDF 생성 진행 상태 채널. 발행 여부인 `reports.status`와는 별개다)
   - Realtime publication에 `reports` 추가 (보고서 화면의 진행 상태 자동 갱신)
   - `fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs` 확장 재정의 (report 잡 상태 전이 +
     고착 잡 회수의 잡 타입 확장)
   - 발행(finalized) 보고서 수정 차단 트리거
   재실행해도 안전하다(멱등). 검증: `select gen_status from reports limit 1;`이 오류
   없이 실행되면 성공.

   > **경고 — 004 다음에 003을 다시 실행하지 않는다.** 004는 003이 정의한
   > `fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs`를 report 잡 분기를 추가해
   > **확장 재정의(create or replace)**한 것이라, 003의 정의를 포함하는 상위집합이다.
   > 004를 실행한 뒤 003을 다시 실행하면 `create or replace`가 004의 정의를 003의
   > (report 분기가 없는) 이전 정의로 덮어써, **오류 메시지 없이** report 잡의
   > `gen_status` 상태 전이가 사라진다(잡은 계속 처리되는 것처럼 보이지만 대시보드의
   > 진행 상태 화면이 더 이상 갱신되지 않는다). 재실행이 필요한 상황(스키마 확인,
   > 함수 재적용 등)이라면 반드시 003 → 004 순서로 **다시** 실행한다(**009까지
   > 적용해 둔 프로젝트라면 → 009까지, 012까지 적용해 둔 프로젝트라면 → 012까지
   > 이어서 다시 실행한다** - 009는 004가 만든 이 세 함수를 slope_judge 분기까지
   > 포함해 다시 확장한 것이고 012는 거기에 register 분기까지 더한 최종 정본이라,
   > 004에서 멈추면 이번엔 slope_judge·register 상태 전이가 같은 방식으로 조용히
   > 사라진다. 아래 2단계 9번·12번 참고).

5. **클라우드 배포 시에만 필요** — 로컬 워커만 쓰고 Vercel/Railway에 배포하지 않을 계획이면
   생략해도 된다. `supabase/migrations/005_storage_buckets.sql` 전체 내용을 붙여넣고 **Run**.
   `raw-scans`·`artifacts`·`reports` Storage 버킷 3개와 그 RLS 정책을 만든다(파일당 상한
   50MB). 재실행해도 안전하다(멱등, `on conflict (id) do nothing`). 검증은 3단계 참고.
   정책 생성이 `42501`로 실패하면 백로그 티켓 42대로 Storage > Policies UI에서 수동 생성한다.
   클라우드 배포 전체 절차는 [`DEPLOY.md`](DEPLOY.md) 참고.
6. `supabase/migrations/006_report_soft_delete.sql` 전체 내용을 붙여넣고 **Run**. 보고서
   소프트 삭제용 `reports.deleted_at` 컬럼을 추가한다(발행본은 내용 컬럼이 잠겨 있어도
   삭제는 통과하도록 설계됨). 재실행해도 안전하다(멱등, `add column if not exists`).
   검증: `select deleted_at from reports limit 1;`이 오류 없이 실행되면 성공.
7. `supabase/migrations/007_slope_analysis.sql` 전체 내용을 붙여넣고 **Run**. 구배
   분석(세부과업 4) 지원을 추가한다: `analysis_kind` enum과 `analyses.kind`·
   `criteria.kind` 컬럼, 현재 분석·기본 기준 유니크 인덱스 재정의
   (`analyses_current`·`criteria_global_default`·`criteria_site_default`),
   `fn_resolve_criteria`를 `p_kind` 인자가 추가된 3인자 시그니처로 교체,
   `registrations` 테이블(정합 이력, 단계 F에서 사용), 구배 판정 기준 5종 시드.
   재실행해도 안전하다(멱등). **주의 - `fn_resolve_criteria`는 인자 개수가 바뀌어
   drop 후 재생성되므로, 이 파일이 함수 실행 권한(revoke/grant)도 함께 재발급한다.
   반드시 파일 전체를 한 번에 실행한다.** 검증: 아래 3단계 (1)·(3)번 참고.

   > **경고 - 002는 어떤 경우에도 다시 실행하지 않는다.** 007이 필요한 상황이면
   > 007을 다시 실행한다(멱등이라 안전하다).
   >
   > **002를 재실행하면 안 되는 이유 둘:**
   > 1. `criteria` 시드 INSERT(002:176)에는 `on conflict` 절이 없다(app_settings
   >    시드(002:169)는 `on conflict (key) do nothing`, 005·006·007의 시드는 전부
   >    `on conflict`가 있는 것과 다르다). 001이 건 `criteria_global_name` 부분
   >    유니크(전역 `(surface, name)`, 001:93)를 두 번째 실행이 그대로 위반해
   >    **23505로 죽는다.**
   > 2. 002가 정의한 `fn_job_claim`(002:50)·`fn_job_fail`(002:80)·
   >    `fn_reap_stuck_jobs`(002:119)는 이후 003(:63·:83)과 004(:55·:78·:109)가
   >    `create or replace`로 이미 확장한 함수들이다. 002를 다시 실행하면 이 셋이
   >    **P2 시절 정의로 조용히 강등된다**(오류 없음).
   >
   > **이미 002를 재실행해 버렸다면 007만으로는 복구되지 않는다.** 007이 정의하는
   > 함수는 `fn_resolve_criteria` 하나뿐이라 위 2번의 강등은 그대로 남는다. 그 경우
   > 복구 순서는 **003 → 004 → 007 → 009 → 012**이며(각각 그 파일을 실행해 둔
   > 프로젝트에 한한다 - 008·009를 아직 쓰지 않았다면 007에서 멈춰도 되고,
   > 011·012를 쓰지 않았다면 009에서 멈춰도 된다), 이는 4번 항목의 "003 → 004
   > 순서로 다시 실행한다"와 같은 지시에 007·009·012가 뒤에 붙을 뿐이다. 009는
   > 004가 만든 잡 큐 함수 3종을 slope_judge 분기까지 포함해 다시 최신 정의로
   > 되돌리고, 012는 거기에 register 분기까지 더한 최종 정본으로 되돌린다
   > (008·011은 enum 값 추가일 뿐이라 002 재실행의 영향을 받지 않으므로 다시
   > 실행할 필요가 없다).
   >
   > 두 사실을 합치면 복구가 성립하지 않는다. SQL 에디터가 스크립트 전체를 한
   > 트랜잭션으로 실행하면 시드에서 23505가 나 **전체가 롤백**된다(아무것도
   > 복구되지 않았는데 복구했다고 믿기 쉽다). 문(statement)별로 커밋되면 함수
   > 3종이 강등된 채로 남는다 - `fn_job_fail`이 002 버전으로 돌아가면 import 잡
   > 실패가 `analyses.status`를 더 이상 갱신하지 않아 분석이 `queued`에 영구
   > 고착되고, precheck 실패가 `scans.status='failed'`로 전이되지 않아 "사전
   > 검사에 실패했습니다" 박스가 영영 안 뜨고, report의 `gen_status` 전이가
   > 사라져 "생성 중" 표시가 폴링을 영원히 지속한다. **세 회귀 모두 오류 없이
   > 조용하다** - 화면이 "진행 중"에 머물 뿐이다.
   >
   > **007만 재실행하면 충분하다.** `fn_resolve_criteria`의 drop(007:50-51)이
   > `fn_resolve_criteria(uuid, surface_type)`(2인자)와
   > `fn_resolve_criteria(uuid, surface_type, analysis_kind)`(3인자) **양쪽을 모두**
   > 겨냥하므로, 어떤 이유로든 옛 2인자 오버로드가 남아 있어도 007 재실행 한 번으로
   > 제거되고 3인자가 정본으로 재생성된다(권한 revoke/grant도 007:69-71이 함께
   > 재발급한다). 이 저장소의 원칙(위 "실행 중 오류가 나면..." 문단 - "새 프로젝트에서
   > 순서대로 한 번씩만 실행하면 정상")은 007에도 그대로 적용된다.

8. `supabase/migrations/008_slope_judge_enum.sql` 전체 내용을 붙여넣고 **Run**. `job_type`
   enum에 `slope_judge` 값 하나만 추가한다(재판정 잡 타입, 세부과업 4 단계 D). 재실행해도
   안전하다(멱등, `add value if not exists`). 검증: `select enumlabel from pg_enum where
   enumtypid = 'job_type'::regtype order by enumsortorder;` 결과 맨 끝에 `slope_judge`가
   보이면 성공.

   > **⚠ 008 다음에 반드시 009를 별도로 Run 한다 - 같은 쿼리 창에서 이어붙여 한 번에
   > 실행하면 안 된다.** PostgreSQL은 같은 트랜잭션 안에서 방금 추가한 enum 값을
   > 사용하는 것을 "unsafe use of new value" 오류로 막는데, SQL Editor는 붙여넣은
   > 내용 전체를 한 트랜잭션으로 실행하기 때문이다. 008을 **Run**해서 `Success` 확인 →
   > 에디터를 비우거나 새 쿼리 탭을 연다 → 009를 붙여넣고 다시 **Run**한다.

9. `supabase/migrations/009_slope_judge_functions.sql` 전체 내용을 붙여넣고 **Run**.
   파일 맨 앞에 008 적용 여부를 확인하는 카탈로그 가드가 있다 - 008을 건너뛰고
   009만 실행하면 `Success` 대신 "008_slope_judge_enum.sql을 먼저 실행하세요"
   오류가 즉시 뜬다(이 가드가 없다면 파일 자체는 `Success`로 끝나 보이지만, plpgsql
   함수 본문의 SQL은 첫 *실행* 시점에야 계획되므로 나중에 워커가 slope_judge 잡을
   claim/reap 할 때가 돼서야 "invalid input value for enum job_type" 오류로 잡
   큐 전체가 조용히 멎는다 - 이 저장소가 가장 경계하는 실패 양식이라 미리 막았다).
   `fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs`에 `slope_judge` 분기를 추가해
   확장 재정의한다 - 재판정 잡의 진행 상태를 `analyses.params.judge`(jsonb)에 반영한다:
   `{"state":"queued|processing|done|failed","at":"<iso>","error":"<사유>"}`.
   **`analyses.status`는 이 분기에서 절대 바뀌지 않는다** - 재판정은 이미
   `status='done'`인 구배 분석에 배수구 위치만 바꿔 다시 거는 잡이라, status를
   건드리면 재시도 소진 시 멀쩡한 기존 판정이 `failed`로 무너지고 무거운 `analyze`를
   처음부터 다시 돌려야 복구된다. 재실행해도 안전하다(멱등, `create or replace`).
   시그니처(파라미터명·반환형)가 바뀌지 않으므로 권한 재발급(`grant`)과
   `notify pgrst`는 불필요하다(007과 다른 점 - 007은 인자 개수가 바뀌어 `drop` 후
   재생성이 필요했다). 검증: `select proname from pg_proc where prosrc like
   '%slope_judge%';` **3행**(`fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs`)이
   나오면 성공 - 함수 존재 여부가 아니라 함수 **본문**에 `slope_judge` 문자열이
   실제로 들어있는지(즉 004 정의가 아니라 009 정의로 덮였는지)를 확인하는
   쿼리라, 002·003·004까지만 적용된 상태에서는 0행이 나온다. 이 쿼리로도
   온전한 동작(claim/fail/reap이 실제로 옳게 전이하는지)까지는 확인할 수 없다 -
   세부과업 4 단계 D의 워커·대시보드가 실제 배수구 클릭으로 확인하는 절차는
   [`DEPLOY.md`](DEPLOY.md) §4의 "구배 분석 스모크" 8~11번(재판정 진행 배너·완료
   후 화면 갱신·실패 경로·단계 C 분석에서는 시도하면 안 되는 이유)을 참고한다.
   **전제 조건**: 분석을 시작할 때(3번) 배수 목적 기준(옥상·욕실·주차장 등)을
   골라야 이 단계에 도달한다 - 기본 선택인 "실내 평바닥"으로 시작하면 배수구
   클릭 자체가 화면에서 비활성화된다.
   **Vercel/Railway 배포가 없어도 이 스모크를 로컬에서 그대로 재현할 수 있다** -
   대시보드는 로컬 모드가 없어 항상 Storage 서명 URL로 읽지만(7절), 이는
   "클라우드 Supabase 프로젝트가 필요하다"는 뜻이지 "Vercel/Railway에 배포해야
   한다"는 뜻이 아니다. `cd dashboard && npm run dev`(7절)로 띄운 로컬 dev
   서버와 `STORAGE_BACKEND=supabase`로 띄운 로컬 워커(5절)가 같은 클라우드
   Supabase 프로젝트를 보게만 맞추면 DEPLOY.md §4의 절차를 그대로 로컬에서
   수행할 수 있다.

   > **⚠ 004가 잡 큐 함수 3종(`fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs`)의
   > 정본이다(002가 아니다).** 009는 004의 본문을 그대로 복사해 slope_judge 분기만
   > 더한 것이라 004를 상위집합으로 포함한다. **009를 실행한 뒤 003 또는 004를 다시
   > 실행하면** `create or replace`가 009의 정의를 옛 정의로 덮어써 slope_judge 상태
   > 전이가 조용히 사라진다(4단계 경고와 같은 종류의 회귀). 재실행이 필요하면
   > **003 → 004 → 009**(**012까지 적용한 프로젝트라면 → 012까지**) 순서로 다시
   > 실행한다(`fn_resolve_criteria`는 007이 별도로 정본이므로, 007까지 함께 쓰는
   > 프로젝트는 007을 그 사이 어디에 두어도 - 잡 큐 함수 3종과 무관한 별개 함수라 -
   > 최종 상태는 같다).
   >
   > **★ 009에서 멈추면 복구가 끝난 것처럼 보이지만 아니다.** 009는 함수 3종을
   > slope_judge 분기까지만 되돌리고 register 분기는 되살리지 않는데, 재판정이
   > 정상으로 돌아오므로 복구됐다고 믿기 쉽다(실측: 009에서 멈추면 register 0 /
   > slope_judge 3, 012까지 가면 3 / 3). 확인 쿼리와 실측표는
   > [`DEPLOY.md`](DEPLOY.md) §1의 해당 문단 참고.

10. `supabase/migrations/010_scan_height_view.sql` 전체 내용을 붙여넣고 **Run**.
    `scans.height_view_path` 컬럼 하나만 추가한다 - `precheck` 잡(세부과업 4 단계 E)이
    단위 확정 전에 점군을 내려다본 높이 뷰 PNG를 만들어 그 경로를 이 컬럼에 남긴다.
    재실행해도 안전하다(멱등, `add column if not exists`). 검증:
    `select height_view_path from scans limit 1;`이 오류 없이 실행되면 성공(빈
    테이블이면 결과가 0행이어도 오류가 없으면 정상).

    **008·009와 달리 파일 하나로 안전하게 끝난다.** 008·009가 둘로 나뉜 이유는
    `job_type` enum에 새 값(`slope_judge`)을 추가한 뒤 그 값을 **같은 트랜잭션
    안에서** 곧바로 참조해야 했기 때문이다(PostgreSQL이 "unsafe use of new
    value"로 막는다 - 위 8번 참고). 010은 enum 추가가 전혀 없는 단순
    `alter table ... add column`뿐이라 그 제약이 애초에 성립하지 않는다.

    > **[필수] 배포 순서 경고 - 010을 워커 코드보다 먼저 적용한다.** `precheck`
    > 잡 핸들러(`worker/flatworker/jobs.py`의 `handle_precheck`)는 상태
    > 승격(`status`)·점 개수(`point_count`)·높이 뷰 경로(`height_view_path`)를
    > **한 PATCH**로 묶어 보낸다. 010을 적용하지 않은 DB에 이 코드가 담긴 워커를
    > 먼저 배포하면 `height_view_path` 컬럼이 없어 그 PATCH 전체가
    > `42703`(undefined_column)으로 실패하고, `status` 승격까지 함께 막힌다 -
    > **007을 워커보다 늦게 배포했을 때와 같은 종류의 사고**다(위 007 경고 문단
    > 참고). 해법도 동일하다: 새 코드를 배포하기 **전에** 010을 먼저 적용한다.
    >
    > **단, 이 제약은 워커 한쪽에만 걸린다 - 대시보드는 010보다 먼저 배포해도
    > 안전하다.** 007은 대시보드도 함께 깨졌기 때문에 010에도 같은 제약이 있다고
    > 읽기 쉬운데 사실이 아니다. 단위 확정 화면
    > (`dashboard/components/unit-confirm-form.tsx`)은
    > `if (!scan.height_view_path) return form;`이라는 **truthy** 가드를 쓴다 -
    > 010 미적용 DB의 `select('*')`에는 이 컬럼이 없어 값이 `undefined`로 오는데
    > truthy 가드가 그것까지 걸러, 화면은 그림 없이 예전과 똑같이 동작한다.
    >
    > **이미 `failed`로 굳은 스캔은 010을 뒤늦게 적용해도 자동 복구되지 않는다.**
    > precheck가 실패한 스캔에는 재시도 버튼 자체가 없고(재분석 버튼은 `analyses`
    > 행이 있어야 뜨는데, 그 행은 단위 확정 시점에 만들어진다), 화면 안내는
    > "지원하지 않는 파일 포맷이나 손상·불완전한 파일"이라는 **정반대 진단**을
    > 준다. 복구하려면 010을 적용한 뒤 해당 스캔을 **새로 업로드**해야 한다 -
    > 그래서 순서를 지키는 것이 유일하게 값싼 길이다. 자세한 내용은
    > `docs/DEPLOY.md` §1의 010 경고 문단 참고.

11. `supabase/migrations/011_register_enums.sql` 전체 내용을 붙여넣고 **Run**.
    enum 값 두 개만 추가한다(정합 기능, 세부과업 4 단계 F): `job_type`에
    `register`(정합 실행 잡), `data_lineage`에 `registered`(정합으로 합쳐 만든
    병합 스캔의 계보). 재실행해도 안전하다(멱등, `add value if not exists`).
    검증:

    ```sql
    select enumlabel from pg_enum where enumtypid = 'job_type'::regtype order by enumsortorder;
    select enumlabel from pg_enum where enumtypid = 'data_lineage'::regtype order by enumsortorder;
    ```

    첫 결과 맨 끝에 `register`, 둘째 결과 맨 끝에 `registered`가 보이면 성공이다.

    **두 문장이 한 파일에 함께 있는 것은 안전하다** - 서로를 사용하지 않기
    때문이다(`data_lineage`의 새 값을 실제로 쓰는 것은 병합 스캔 행을 만드는
    워커이지 이 파일이 아니다).

    > **011 다음에 012를 별도로 Run 한다**(008·009와 같은 절차 - 위 8번 참고).
    > 011을 **Run**해서 `Success` 확인 → 에디터를 비우거나 새 쿼리 탭을 연다 →
    > 012를 붙여넣고 다시 **Run**한다.
    >
    > **근거를 정확히 적는다.** PostgreSQL이 같은 트랜잭션 안에서 방금 추가한 enum
    > 값의 *사용*을 "unsafe use of new value"로 막는 것은 사실이지만, **지금의
    > 012는 그 제약에 실제로 걸리지 않는다** - 실측하면 011+012를 한 트랜잭션으로
    > 실행해도 성공한다(PostgreSQL 16 확인). 012가 새 값을 top-level SQL에서 쓰지
    > 않기 때문이다(가드는 `enumlabel` 문자열 비교, `jobs_dedup`은 `type` 컬럼만
    > 참조, 새 값의 실제 사용은 전부 plpgsql 함수 본문 안이다). 그래도 나누는 이유는
    > (1) 008·009가 세운 선례이고 (2) 앞으로 012에 본문 밖에서 새 값을 쓰는 문장이
    > 하나라도 늘면 합쳐진 파일이 그 순간 막히기 때문이다. 같은 사실이 008·009에도
    > 적용된다(위 8번의 "반드시 두 번 나눠야 한다"는 절차로는 옳지만 근거 서술이
    > 실제보다 강하다 - 자세한 내용은 [`DEPLOY.md`](DEPLOY.md) §1의 011·012 문단).

12. `supabase/migrations/012_register_support.sql` 전체 내용을 붙여넣고 **Run**.
    파일 맨 앞에 카탈로그 가드 4종이 있어 선행 마이그레이션(007·008·011)을
    건너뛰면 `Success` 대신 한국어 오류가 즉시 뜬다 - 무엇을 먼저 실행해야 하는지
    오류 문구가 그대로 알려준다. 적용되는 내용:
    - `registrations` 테이블(007이 이미 만들어 둔 정합 이력 테이블)에
      `overlap_ratio`(중첩 비율)·`horizontal_sensitivity`(수평 감도)·`updated_at`
      컬럼 추가, `correspondences` 기본값 `'[]'`
    - Realtime publication에 `registrations` 추가(정합 진행 상태 자동 갱신)
    - **`jobs_dedup` 부분 유니크 인덱스 재정의** - 중복 방지 키에
      `payload->>'registration_id'`를 더한다
    - `fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs`에 `register` 분기를 추가해
      확장 재정의 - 정합 잡의 진행 상태를 `registrations.status`(007의
      `registration_status` enum: `awaiting_points|queued|processing|done|failed`)와
      `registrations.error_text`에 반영한다. 재판정(009)과 달리 우회 채널
      (`analyses.params.judge`)을 쓰지 않는다 - 정합에는 자기 테이블이 있다

    재실행해도 안전하다(멱등 - 가드는 존재 확인만 하고, 컬럼 추가는
    `add column if not exists`, 인덱스는 `drop` 후 재생성, 함수는
    `create or replace`다). 시그니처가 바뀌지 않으므로 권한 재발급(`grant`)과
    `notify pgrst`는 원리상 불필요하지만, 컬럼이 늘었으므로 파일 끝에서
    스키마 캐시 갱신을 한 번 알린다(007:144와 같은 관례).

    검증 3종:

    ```sql
    -- (a) 함수 3종이 실제로 012 정의로 덮였는지 - 본문에 registration_id가 있는지 본다
    select proname from pg_proc where prosrc like '%registration_id%';
    -- (b) 중복 방지 인덱스가 재정의됐는지
    select indexdef from pg_indexes where indexname = 'jobs_dedup';
    -- (c) 테이블 컬럼이 실제로 추가됐는지
    select overlap_ratio, horizontal_sensitivity, updated_at from registrations limit 1;
    ```

    (a)는 `fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs` **3행**이 나와야 한다
    (009의 검증 쿼리와 같은 원리 - 함수의 존재가 아니라 함수 **본문**을 확인하는
    쿼리라, 012를 적용하지 않았다면 0행이 나온다). (b)의 결과 문자열 안에
    `registration_id`가 보여야 한다. (c)는 빈 테이블이면 0행이어도 되고,
    **오류가 나지 않는 것**이 확인 대상이다. 정합 잡의 중복 방지가 실제로
    동작하는지까지 확인하는 절차는 [`DEPLOY.md`](DEPLOY.md) §4의 6번 참고.

    > **★ `jobs_dedup` 재정의를 빠뜨리면 조용히 실패한다.** 001이 만든 원래 인덱스는
    > `analysis_id`·`scan_id`·`report_id` 세 키만 본다. 정합 잡 payload에는
    > `registration_id`만 있어 세 키가 전부 없으므로 `coalesce`가 NULL을 내는데,
    > **유니크 인덱스에서 NULL은 서로 구별되므로 중복 엔큐가 전부 통과한다** -
    > 사용자가 "정합 실행"을 두 번 누르면 무거운 잡이 두 개 돈다. 오류도 경고도
    > 뜨지 않는다. 재정의는 기존 잡 타입들(precheck·analyze·import·report·
    > slope_judge)의 동작을 전혀 바꾸지 않는다 - 새 키를 `coalesce`의 **맨 뒤**에
    > 붙였고 `registration_id`를 싣는 다른 잡 타입이 없어서, register가 아닌 모든
    > 행의 인덱스 값이 예전과 문자 그대로 같기 때문이다.

    > **⚠ 012가 잡 큐 함수 3종의 최종 정본이다(004도 009도 아니다).** 012를 실행한
    > 뒤 003·004·009 중 무엇이든 다시 실행하면 `create or replace`가 012의 정의를
    > 옛 정의로 덮어써 **register 상태 전이가 오류 없이 사라진다**(위 4·9번 경고와
    > 같은 종류의 회귀 - 정합 잡은 계속 처리되는 것처럼 보이지만 화면의 진행 상태가
    > 갱신되지 않고, 워커가 죽어 실패해도 실패 사유가 화면에 뜨지 않는다). 재실행이
    > 필요하면 **003 → 004 → 009 → 012** 순서로 다시 실행한다.

    > **[필수] 배포 순서 경고 - 012를 워커보다 먼저 적용한다.** 단계 F 워커의
    > `handle_register`는 `overlap_ratio`·`horizontal_sensitivity`를 포함한 정합
    > 결과를 `registrations`에
    > PATCH한다. 012 미적용 DB에 이 코드가 담긴 워커를 먼저 배포하면 그 컬럼이 없어
    > PATCH가 `42703`(undefined_column)으로 실패한다 - 007·010을 워커보다 늦게
    > 배포했을 때와 같은 실패 양식이다(위 7·10번 경고 참고). **다만 010의
    > `precheck`와 달리 이 경로는 스캔 업로드마다 무조건 도는 경로가 아니다** -
    > 정합을 한 번도 실행하지 않으면 도달하지 않는다. 그래도 순서를 지키는 편이
    > 값싸다. 대시보드와의 순서 관계는 [`DEPLOY.md`](DEPLOY.md) §1의 011·012 문단
    > 참고(010과 달리 "먼저 배포해도 안전"이 성립하지 않는다).

## 3. 검증 쿼리

SQL Editor에서 새 쿼리로 아래 3개를 순서대로 실행해 스키마·함수·시드 데이터가 제대로
들어갔는지 확인한다.

**(1) 기준 시드 16종 확인** — `criteria` 테이블에 시드 데이터가 정확히 16행(평활도 11종 +
007이 넣는 구배 5종) 들어왔는지:

```sql
select count(*) from criteria;
```

결과가 **16**이어야 한다(007을 아직 실행하지 않았다면 11).

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

007을 실행하면 `fn_resolve_criteria`가 `p_kind analysis_kind default 'flatness'` 인자
하나를 더 받는 3인자 시그니처로 바뀐다. 위 쿼리처럼 세 번째 인자를 생략한 2인자 호출은
기본값 `'flatness'`가 채워져 그대로 동작하므로(위 6행 결과가 그대로 나온다) 기존 호출부를
고칠 필요가 없다. 구배 기준을 조회하려면 세 번째 인자에 `'slope'`를 명시한다:

```sql
select * from fn_resolve_criteria(null, 'floor', 'slope');
```

`slope-roof-exposed`, `slope-roof-protected`, `slope-bathroom`, `slope-parking`,
`slope-indoor-level`(is_default=true) 5행이 반환되면 정상이다.

**(4) Storage 버킷 확인**(2단계에서 005를 실행했을 때만 해당) — 버킷이 제대로 만들어졌는지:

```sql
select id, file_size_limit from storage.buckets;
```

**4행**이 반환되면 정상이다: `raw-scans`·`artifacts`·`reports`는 각각
`file_size_limit = 52428800`(50MB, 005가 생성), `photos`는 `file_size_limit = 10485760`
(10MB, 2단계 3번의 003이 만든 별도 버킷 — 스캔 원본이 아니라 사진 첨부 전용이다). 3행만
나오면 005 실행을 건너뛴 것이니 2단계 5번을 다시 확인한다.

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

   P4 보고서(PDF 생성) 잡을 처리하려면 Playwright의 Chromium 브라우저 바이너리를
   한 번 더 내려받아야 한다(`pip install`만으로는 패키지만 설치되고 브라우저 본체는
   따로 받아야 한다) — 생략하면 첫 보고서 생성 시도에서 워커가 영문 오류로 실패한다:

   ```
   python -m playwright install chromium
   ```

   자세한 내용은 `worker/README.md`의 "PDF 보고서 잡 (P4)" 절 참고.

3. 워커 실행:

   ```
   python -m flatworker
   ```

4. 시작 로그 확인:

   ```
   [flatworker] 시작: worker_id=local-1, storage_backend=local, data_dir=..\data, poll_interval=3.0s, engine_version=p4-0.5.0
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

로컬 개발·테스트(워커 `.env`의 `STORAGE_BACKEND=local`, 기본값)에서는 이 값을 소비자가
각자의 저장소 루트에 결합해 실제 위치를 얻는다:

- **워커**는 자신의 `DATA_DIR`(`.env`)에 결합한다 — 예:
  `DATA_DIR=../data` + `raw-scans/site1/scan1/raw.ply` →
  `../data/raw-scans/site1/scan1/raw.ply`. 이 결합은 `worker/flatworker/jobs.py`의
  `_fetch_raw`(읽기)와 `artifacts.artifacts_dir()`(쓰기)가 담당한다.
- **대시보드**는 로컬 모드를 두지 않는다(Vercel 서버리스 파일시스템은 읽기 전용·휘발성이라
  로컬 분기가 영원히 죽은 코드가 된다) — 개발·운영 구분 없이 항상 Storage 서명 URL로
  읽는다. 즉 대시보드와 함께 로컬 개발을 하려면 워커도 `STORAGE_BACKEND=supabase`로
  맞춰야 한다(워커 단독 테스트만 할 때는 `local`로 충분하다).

**클라우드 배포(워커 `STORAGE_BACKEND=supabase`)에서는 이 문자열이 그대로 Storage 버킷의
객체 키가 된다.** 경로 규약 문자열 자체는 로컬/클라우드 어느 쪽이든 **한 글자도 바뀌지
않는다** — 바뀌는 것은 그 문자열이 가리키는 실체뿐이다(로컬 파일 → Storage 객체). DB에
특정 소비자의 로컬 경로 관례를 섞어 저장하면 두 소비자 중 하나가 항상 깨지므로, 이 규약을
어기지 않는 것이 배포 전환의 전제 조건이다. 클라우드 배포 절차 전체는
[`DEPLOY.md`](DEPLOY.md) 참고.

## 7. 대시보드(P3) 연결

`dashboard/.env.example`을 `dashboard/.env.local`로 복사하고 4단계의 **Project URL**과
**anon(public) key**를 채운다(service_role 키는 절대 넣지 않는다). 대시보드는 로컬
파일시스템을 쓰지 않는다 — 원본 스캔·산출물·보고서 PDF는 모두 Storage 서명 URL로
내려받으므로 `DATA_DIR` 설정이 필요 없다(6절 참고). 단, 워커가 Storage에 쓴 파일이어야
대시보드에서 보이므로 워커도 `STORAGE_BACKEND=supabase`로 띄운다.
실행: `cd dashboard && npm install && npm run dev` 후 http://localhost:3000

## 참고

- 워커 자체의 실행·테스트·코드 구조는 `worker/README.md` 참고.
- `jobs`/`analyses` 등 산출물 JSON의 필드 계약은 `docs/contracts/stats-schema.md` 참고.
- 이 가이드의 SQL 예시는 `supabase/migrations/002_functions_seed.sql`의 함수 시그니처
  (`fn_job_claim(p_worker text)` 등 파라미터명)를 정본으로 삼는다(003·004·009·012
  모두 파라미터명·반환형을 바꾸지 않았다). 다만 함수 **본문**(어떤 잡 타입에서 무엇을
  전이시키는지)의 정본은 가장 마지막으로 확장 재정의한 `012_register_support.sql`
  이다(002가 아니다 - 003이 import·precheck 분기를, 004가 report 분기를, 009가
  slope_judge 분기를, 012가 register 분기를 차례로 더했다. 011·012를 적용하지 않은
  프로젝트라면 009가 정본이다). `fn_resolve_criteria`는 007이 `(p_site_id uuid,
  p_surface surface_type, p_kind analysis_kind default 'flatness')` 3인자
  시그니처로 교체했으므로 `007_slope_analysis.sql`이 정본이다 — 마이그레이션이
  바뀌면 이 문서도 함께 갱신한다.
- **클라우드(Vercel + Railway + Supabase Storage) 배포 절차는 [`DEPLOY.md`](DEPLOY.md)
  참고.**

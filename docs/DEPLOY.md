# 클라우드 배포 절차

Vercel(대시보드) + Railway(워커, Docker) + Supabase(DB·Auth·Storage) 구성으로 배포한다.
**코드로 준비된 것**과 **사용자가 직접 해야 하는 것**을 절 단위로 분리했다.

> **배포 전 필수**: 이 저장소는 공개(public)로 전환되고 대시보드는 공개 URL로 배포된다.
> §1의 3번(회원가입 차단)을 하지 않으면 대시보드 주소를 아는 누구든 가입해서 전체
> 현장·스캔·분석·보고서에 접근할 수 있다. 배포 직후 가장 먼저 처리한다.

## 0. 코드로 준비된 것 (추가 작업 없음)

- `supabase/migrations/005_storage_buckets.sql` - 버킷 3종(`raw-scans`·`artifacts`·`reports`) + RLS
- `supabase/migrations/008_slope_judge_enum.sql`·`009_slope_judge_functions.sql` - 재판정
  (구배 배수구 재클릭) 잡 타입. 이 배포 절차의 필수 최소 범위(007까지)에는 포함되지
  않지만, 재판정 기능을 켤 계획이면 §1의 1번에서 함께 적용한다
- `supabase/migrations/010_scan_height_view.sql` - `scans.height_view_path` 컬럼
  (`precheck` 잡이 만드는 높이 뷰 PNG 경로, 세부과업 4 단계 E). 008·009와 달리
  선택 기능이 아니다 - `precheck`는 스캔 업로드마다 무조건 도는 경로라 §1의 1번
  필수 범위에 포함된다
- `supabase/migrations/011_register_enums.sql`·`012_register_support.sql` - 정합
  (두 스캔을 대응점으로 합치기) 잡 타입 + `registrations` 컬럼 보완 +
  `jobs_dedup` 재정의, 세부과업 4 단계 F. 008·009처럼 필수 최소 범위(007까지)에는
  포함되지 않지만, 정합 기능을 켤 계획이면 §1의 1번에서 함께 적용한다
  (**012는 008을 전제한다** - §1의 1번 참고)
- 저장소 루트 `Dockerfile` - 워커 이미지(Chromium·`Noto Sans CJK KR` 포함 - Debian
  `fonts-noto-cjk`가 실제로 등록하는 폰트 패밀리명이며 `Noto Sans KR`이 아니다)
- 워커 `STORAGE_BACKEND=supabase` 기본값(Dockerfile `ENV`)
- 대시보드 Storage 서빙(서명 URL 리다이렉트)·업로드(브라우저 직접 업로드) 경로

## 1. Supabase (사용자 수행)

1. SQL Editor에서 `001_schema.sql`부터 `007_slope_analysis.sql`까지 **순서대로** 실행한
   뒤 `010_scan_height_view.sql`도 이어서 실행한다(008·009·011·012는 건너뛰어도 된다 -
   아래 참고)(001~004를 아직 실행하지 않았다면 `docs/SUPABASE_SETUP.md` 2단계부터 순서대로 먼저
   진행한다). 006(`006_report_soft_delete.sql`)은 보고서 소프트 삭제, 007
   (`007_slope_analysis.sql`)은 구배 분석(`analyses.kind` 컬럼·구배 판정 기준 시드)을,
   010(`010_scan_height_view.sql`)은 `scans.height_view_path` 컬럼 하나를 추가한다 -
   셋 다 재실행 안전(멱등)하다. 010은 008·009처럼 job_type enum을 건드리지 않는
   단순 컬럼 추가라 007 다음 어디에 두어도(008·009·011·012보다 먼저든 나중이든)
   상관없다.

   > **[필수] 010을 워커 배포보다 먼저 적용한다.** `precheck` 잡 핸들러
   > (`worker/flatworker/jobs.py`의 `handle_precheck`)는 상태 승격·`point_count`·
   > `height_view_path`를 한 PATCH로 묶어 보낸다. 010 미적용 DB에 이 코드가 담긴
   > 워커를 먼저 배포하면 `height_view_path` 컬럼이 없어 그 PATCH 전체가
   > `42703`(undefined_column)으로 실패하고 **상태 승격까지 함께 막힌다** - 아래
   > 007 배포 순서 경고와 같은 종류의 사고이며 해법도 같다: 새 워커 이미지를
   > 배포하기 전에 SQL을 먼저 적용한다. `precheck`는 008·009(재판정)와 달리 켜고
   > 끌 수 있는 선택 기능이 아니라 스캔 업로드마다 무조건 도는 경로이므로, 이
   > 워커 이미지를 배포할 계획이면 010은 선택이 아니라 필수다.
   >
   > **다만 007과 달리 이 제약은 워커 한쪽에만 걸린다 - 대시보드는 010보다 먼저
   > 배포해도 안전하다.** 바로 아래 007 문단이 "007 적용 → 엔진·워커 → 대시보드"
   > 순서를 못 박고 있어 010에도 같은 제약이 있다고 읽기 쉬운데, 사실이 아니다.
   > 단위 확정 화면(`dashboard/components/unit-confirm-form.tsx`)은
   > `if (!scan.height_view_path) return form;`이라는 **truthy** 가드로 그림을
   > 감싼다. 010 미적용 DB의 `select('*')`에는 이 컬럼이 아예 없어 값이
   > `undefined`로 오는데 truthy 가드가 그것까지 걸러 주므로, 화면은 그림 없이
   > 예전과 똑같이 동작한다(`=== null`로 좁히면 이 성질이 사라지므로 회귀 테스트로
   > 고정해 두었다 - `components/__tests__/unit-confirm-form.test.tsx`). 즉 010과
   > 대시보드 사이에는 순서 제약이 없다.
   >
   > **이미 `failed`로 굳은 스캔은 010을 뒤늦게 적용해도 자동으로 복구되지 않는다**
   > (007 문단의 같은 경고와 동일하지만, 이쪽이 사용자에게 더 불친절하다).
   > precheck가 실패한 스캔에는 **재시도 버튼이 아예 없다** - `/scans/[id]`의
   > 재분석 버튼은 분석(`analyses`) 행이 있어야 렌더되는데(`app/scans/[id]/page.tsx`의
   > `latestFlatness &&` 분기), 분석 행은 단위 확정 시점에 만들어지므로 precheck에서
   > 죽은 스캔에는 존재하지 않는다. 화면에 남는 것은 이 안내뿐이다:
   > "가장 흔한 원인은 지원하지 않는 파일 포맷이나 손상·불완전한 파일입니다. …
   > 파일을 확인한 뒤 업로드 화면에서 새 스캔으로 다시 시도하세요." **42703으로
   > 죽은 사용자에게 정반대 진단을 준다** - 파일은 멀쩡한데 파일을 의심하게 만든다.
   > 그러므로 이 경우의 실제 복구는 "010 적용 후 **해당 스캔들을 새로 업로드**"이며,
   > 010을 먼저 적용해 애초에 이 상태를 만들지 않는 것이 유일하게 값싼 길이다.

   **재판정(구배 배수구 재클릭) 기능을 쓸 계획이면 007 다음에 008·009도 이어서
   적용한다**: `008_slope_judge_enum.sql`(job_type에 `slope_judge` 값 추가) →
   `009_slope_judge_functions.sql`(잡 큐 함수 3종에 slope_judge 분기 확장). **008과
   009는 두 번 나눠 Run 한다** - 008 Run → `Success` 확인 → 에디터 비우기 → 009 Run
   순서를 지킨다. 둘 다 재실행 안전(멱등)하며, `analyses.status`는 slope_judge
   분기에서 절대 바뀌지 않는다(재판정 진행 상태는 `analyses.params.judge`에만
   반영된다 - 자세한 이유와 상태 스키마는 `docs/SUPABASE_SETUP.md` 2단계 8·9번
   참고). 이 저장소가 아직 세부과업 4 단계 D의 워커·대시보드를 배포하지 않은
   상태라면 008·009를 지금 당장 적용하지 않아도 기존 기능에는 영향이 없다.

   > **근거를 정확히 적는다 - "합치면 실패한다"는 뜻이 아니다.** PostgreSQL이 같은
   > 트랜잭션 안에서 방금 추가한 enum 값의 *사용*을 "unsafe use of new value"로
   > 막는 것은 사실이고 SQL Editor가 붙여넣은 내용 전체를 한 트랜잭션으로 실행하는
   > 것도 사실이다. 다만 **지금의 009는 그 제약에 실제로 걸리지 않는다** - 실측하면
   > 008+009를 한 트랜잭션으로 실행해도 성공한다(PostgreSQL 16 확인). 009가 새 값을
   > top-level SQL에서 쓰지 않기 때문이다(맨 앞 가드는 `enumlabel` 문자열 비교이고,
   > 새 값의 실제 사용은 전부 plpgsql 함수 본문 안이라 `create function` 시점에는
   > 계획이 서지 않는다). 그래도 나눠 Run 하는 이유는 (1) enum을 추가하는
   > 마이그레이션의 절차를 하나로 통일해 두면 파일마다 따져 볼 필요가 없고,
   > (2) 앞으로 009에 본문 밖에서 새 값을 쓰는 문장이 하나라도 늘면(부분 인덱스·
   > 뷰·체크 제약·시드 INSERT 등) 합쳐진 파일이 그 순간 막히기 때문이다. 실제로
   > 막히는 형태의 실측 목록은 `docs/SUPABASE_SETUP.md` 2단계 8번 참고.

   **정합(두 스캔을 대응점으로 합치기, 세부과업 4 단계 F) 기능을 쓸 계획이면 011·012도
   이어서 적용한다**: `011_register_enums.sql`(`job_type`에 `register`,
   `data_lineage`에 `registered` 추가) → `012_register_support.sql`(`registrations`
   테이블 컬럼 보완 + `jobs_dedup` 재정의 + 잡 큐 함수 3종에 register 분기 확장).
   **011과 012도 008·009와 같은 절차로 두 번 나눠 Run 한다.** 011 Run → `Success`
   확인 → 에디터 비우기 → 012 Run. 둘 다 재실행 안전(멱등)하다. 012 맨 앞에는 카탈로그
   가드 4종이 있어 선행(007·008·011)을 건너뛰면 한국어 오류로 즉시 막힌다. 적용 내용과
   검증 쿼리는 `docs/SUPABASE_SETUP.md` 2단계 11·12번 참고.

   > **근거를 정확히 적는다 - 여기서도 "합치면 실패한다"는 뜻이 아니다.** 위
   > 008·009 문단과 정확히 같은 성질이다. PostgreSQL이 같은 트랜잭션 안에서 방금
   > 추가한 enum 값의 *사용*을 "unsafe use of new value"로 막는 것은 사실이고 SQL
   > Editor가 붙여넣은 내용 전체를 한 트랜잭션으로 실행하는 것도 사실이다. 다만
   > **지금의 012는 그 제약에 실제로 걸리지 않는다** - 실측하면 011+012를 한
   > 트랜잭션으로 실행해도 성공한다(PostgreSQL 16 확인). 012가 새 값을 top-level
   > SQL에서 쓰지 않기 때문이다(가드는 `enumlabel` 문자열 비교, `jobs_dedup`은
   > `type` 컬럼만 참조, 새 값의 실제 사용은 전부 plpgsql 함수 본문 안이다).
   > 그래도 나눠 Run 하는 이유는 (1) 008·009가 세운 선례라 절차가 하나로 통일되고,
   > (2) 앞으로 012에 본문 밖에서 새 값을 쓰는 문장이 하나라도 늘면(부분 인덱스·뷰·
   > 체크 제약·시드 INSERT 등) 합쳐진 파일이 그 순간 막히기 때문이다. 실제로 막히는
   > 형태의 실측 목록은 `docs/SUPABASE_SETUP.md` 2단계 8번 참고.

   > **⚠ 012를 쓰려면 008도 함께 적용해야 한다(009는 건너뛸 수 있다).** 012는 잡 큐
   > 함수 3종의 **가장 마지막 확장 재정의**라 009의 본문(= `slope_judge` 분기)을 그대로
   > 포함한 위에 `register` 분기만 더한 형태다. 즉 재판정을 쓰든 안 쓰든 012를 적용하면
   > 함수 본문에 `'slope_judge'`라는 job_type 라벨이 들어가는데, 008 미적용 DB에는 그
   > 라벨이 없어 워커가 **아무 잡이나** claim 하는 순간 "invalid input value for enum
   > job_type: slope_judge"로 **잡 큐 전체가 멎는다**(정합뿐 아니라 precheck·analyze·
   > import·report까지 전부). 012의 카탈로그 가드가 이 조합을 Run 시점에 막지만, 애초에
   > 008을 함께 적용하는 것이 정답이다(008은 `add value if not exists` 한 줄이다).
   > 반대로 009 자체는 012가 상위집합이므로 건너뛰어도 된다.
   >
   > **012를 적용한 뒤에는 003·004·009를 다시 실행하지 않는다.** `create or replace`가
   > 012의 정의를 옛 정의로 덮어써 register 상태 전이가 **오류 없이** 사라진다(위 004
   > 경고와 같은 종류의 회귀). 재실행이 필요하면 **003 → 004 → 009 → 012** 순서로
   > 다시 실행한다.

   > **[필수] 배포 순서 경고 - 011·012 → 워커 → 대시보드.** 세 갈래로 나눠 적는다.
   >
   > **(1) 워커를 012보다 먼저 배포하면 안 된다.** 단계 F 워커의 `handle_register`는
   > 정합 결과(`transform`·`rmse_mm`·`iterations`·`overlap_ratio`·`result_scan_id`)를
   > `registrations`에 PATCH하는데, `overlap_ratio`는 012가 추가하는 컬럼이다. 012
   > 미적용 DB에서는 이 PATCH가 `42703`(undefined_column)으로 실패한다 - 007·010을
   > 워커보다 늦게 배포했을 때와 같은 실패 양식이다(위 010·007 경고 참고). 다만 010의
   > `precheck`와 달리 이 경로는 스캔 업로드마다 무조건 도는 경로가 아니다 - 정합을
   > 한 번도 실행하지 않으면 도달하지 않으므로, 기존 기능이 함께 무너지지는 않는다.
   >
   > **(2) 대시보드는 010과 달리 "먼저 배포해도 안전"이 성립하지 않는다.** 010은
   > `height_view_path`라는 **컬럼 하나**가 없는 상황이었고, 미적용 DB의 `select('*')`
   > 결과에서 그 키가 `undefined`로 빠지면 화면의 truthy 가드가 그대로 걸러 주었다.
   > 정합 화면은 그 방식으로 흡수되지 않는다. **다만 없는 것이 무엇인지 정확히
   > 적는다 - 아래 세 줄은 격리 PostgreSQL 클러스터에서 실제로 재현해 확인했다.**
   >
   > - **`registrations` 테이블 자체는 007이 만든다**(`007_slope_analysis.sql`의
   >   "정합 이력 - 단계 F에서 사용, 스키마만 먼저 세운다"). 011·012가 만드는 것이
   >   아니다 - 012는 `alter table ... add column if not exists`로 **차이만** 메우며,
   >   012의 네 번째 카탈로그 가드가 "007_slope_analysis.sql을 먼저 실행하세요
   >   (registrations 테이블이 없습니다)"로 007을 전제한다. 007은 §1에서 이미 [필수]다.
   > - **011이 없으면 "정합 실행"이 엔큐에서 막힌다.** `fn_enqueue_job('register', ...)`
   >   이 `invalid input value for enum job_type: "register"`로 실패하고, 화면은
   >   `lib/domain/jobs.ts`의 한국어 메시지로 그 실패를 그대로 보여준다(조용히 넘어가지
   >   않는다). 대응점을 찍고 저장하는 단계까지는 007만으로도 동작한다.
   > - **012가 없으면 두 곳이 42703으로 깨진다.** (a) 워커의 결과 PATCH - 위 (1)과
   >   같은 이유(`overlap_ratio`·`horizontal_sensitivity`가 012 컬럼이다). (b) 정합
   >   화면의 **"대응점 다시 찍기"** - 그 버튼이 결과 수치를 지우면서 같은 두 컬럼을
   >   `null`로 쓴다. 여기에 더해 `jobs_dedup`이 register 중복을 못 막고(설계 결정 F5),
   >   잡 큐 함수 3종에 register 분기가 없어 화면이 **'정합 대기 중'에서 갱신되지
   >   않는다**.
   >
   > 즉 012 없이 단계 F 대시보드를 올리면 **정합 기능만 오류를 낸다** - 기존 화면
   > (측정위치·스캔·분석·보고서)은 `registrations`를 건드리지 않으므로 007처럼 전체가
   > 깨지지는 않는다. **다만 "대시보드 코드에 registrations를 읽거나 쓰는 곳이 없다"는
   > 옛 서술은 더 이상 사실이 아니다** - `/registrations/new`(생성),
   > `/registrations/[id]`(조회·갱신), `/scans/[id]`(병합 스캔에서 정합 이력 역조회)가
   > 읽고 쓴다. 그러므로 **011·012 → 대시보드** 순서를 지킨다.
   >
   > **(3) 반대 순서(워커가 먼저, 대시보드가 나중)에도 눈에 안 띄는 흠이 하나 있다.**
   > 정합이 성공하면 워커가 `lineage='registered'`인 병합 스캔 행을 만드는데, 스캔 상세
   > 화면(`dashboard/app/scans/[id]/page.tsx`)은 `LINEAGE_LABEL[s.lineage]`로 라벨을
   > 조회한다. `registered`를 모르는 **옛 대시보드**는 이 조회가 `undefined`가 되어
   > "데이터 계보" 값이 **빈 칸**으로 뜬다(React가 `undefined`를 아무것도 렌더하지
   > 않는다) - 오류도 경고도 없다. 대시보드를 워커와 같은 배포에서 함께 올리면
   > 생기지 않는 문제이므로, 정합을 실제로 실행하기 전에 대시보드 배포를 끝낸다.

   > **[필수] 배포 순서 경고**: **007 적용 -> 엔진·워커 배포(저장소 루트 `Dockerfile`이
   > `engine/`·`worker/`를 한 이미지로 함께 빌드하므로 Railway 재배포 1회로 둘이 자동으로
   > 동시에 올라간다) -> 대시보드 배포** 순서를 지킨다. 007을 적용하지 않은 채 대시보드를
   > 먼저 배포하면 `analyses` 테이블에 `kind` 컬럼이 없어 모든 분석 목록·상세 조회가
   > 실패한다.
   >
   > **워커를 007보다 먼저 배포하면 더 심각한 문제가 생긴다 - 이미 검수를 통과한
   > 평활도·임포트 분석까지 전부 실패한다.** `worker/flatworker/db.py`의
   > `set_current_analysis`(모든 analyze/import 잡의 마지막 단계)는 두 PATCH 모두에
   > `kind` 필터를 무조건 건다. 007 미적용 DB에는 `analyses.kind` 컬럼 자체가 없어
   > PostgREST가 400(`42703 undefined_column`)을 돌려준다. 엔진은 이미 다 돌고
   > stats까지 만들어진 뒤 **마지막 PATCH에서만** 실패하므로, 3회 재시도로 엔진이
   > 세 번 돌아 자원을 태우고 `analyses.status='failed'`인데 `stats`·
   > `overall_verdict`·`coverage_pct`는 정상적으로 채워진 **모순 상태**가 남는다.
   > **증상 - 로그를 믿지 마라**: Railway 로그에는 **아무것도 남지 않고 워커도
   > 죽지 않는다**(실측 확인). `runner.py`의 "복구 불가능한 DB 오류로 종료합니다"
   > 메시지는 `claim_job`을 감싼 `except DBError` 안에만 있는데, `fn_job_claim`은
   > `analyses.kind`를 건드리지 않아 이 경로를 타지 않는다. 핸들러 예외는 print 없이
   > `fail_job`으로 빠진다. **깨끗한 로그를 보고 "워커는 정상"이라고 판단하면 안 된다.**
   > 유일한 흔적은 `jobs.error` 컬럼의 `DB 오류 (status=400): {"code":"42703",...}`이고,
   > 화면에는 분석 상태가 "실패"로 뜬다. 의심되면 SQL Editor에서 확인한다:
   > `select error from jobs where status = 'failed' order by created_at desc limit 5;`
   > **실질적 조치**: Railway가 GitHub push 자동 재배포로 설정돼 있다면, **push하기
   > 전에** Supabase SQL Editor에서 007을 먼저 적용한다(push와 SQL 실행 사이에 워커가
   > 옛 상태로 먼저 뜨는 시간차를 만들지 않는다). 이미 이 창에서 `failed`로 굳은
   > 분석은 007을 뒤늦게 적용해도 **자동으로 복구되지 않는다** - 스캔 상세 화면에서
   > "평활도 분석" 버튼을 다시 눌러 재분석해야 한다.
   >
   > **007 자체는 재실행해도 안전하다**(`007_slope_analysis.sql`이 스스로 "재실행
   > 안전(멱등)"이라 선언하며, `drop function if exists`가 2인자·3인자 시그니처를 모두
   > 겨냥한 뒤 재생성한다). **`002_functions_seed.sql`은 어떤 경우에도 다시 실행하지
   > 않는다** - (1) `criteria` 시드 INSERT(002:176)에 `on conflict` 절이 없어(005·007의 시드에는 있다) 001이 건 `criteria_global_name` 부분 유니크 위반으로
   > 재실행이 그 자리에서 23505로 죽는다. (2) 002가 003·004에서 이미 확장한 잡 큐
   > 함수 3종(`fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs`)을 P2 시절 정의로
   > `create or replace`한다 - 오류 없이 조용히 되돌아가며, import 잡 실패가
   > `analyses.status`를 더 이상 갱신하지 않아 분석이 `queued`에 영구 고착되거나,
   > precheck 실패가 `scans.status`에 반영되지 않아 실패 안내 박스가 영영 안 뜨거나,
   > report의 `gen_status` 전이가 사라져 생성 중 표시가 폴링을 영원히 지속하는 회귀
   > 3종이 되살아난다. **007이 필요한 상황이면 007을 다시 실행한다** -
   > `fn_resolve_criteria`의 drop(007:50-51)이 2인자·3인자 시그니처를 모두 겨냥하므로,
   > 002 재실행으로 되살아난 옛 2인자 오버로드가 있더라도 007 재실행 한 번으로
   > 제거되고 3인자가 정본으로 재생성된다(권한 revoke/grant도 007:69-71이 함께
   > 재발급한다). 이 원칙은 `docs/SUPABASE_SETUP.md`의 "새 프로젝트에서 순서대로
   > 한 번씩만 실행하면 정상"과 일치한다 - 예외는 007 하나뿐이다.
   >
   > **이미 002를 재실행해 버렸다면 007만으로는 복구되지 않는다.** 007이 정의하는
   > 함수는 `fn_resolve_criteria` 하나뿐이라, 위 (2)의 잡 큐 함수 3종 강등은 그대로
   > 남는다. 그 경우의 복구 순서는 **003 → 004 → 007 → 009 → 012**이다(003·004는 전부
   > `create or replace`라 재실행이 안전하고, 004가 003의 상위집합이라 순서가
   > 중요하다. 각각 그 파일을 이미 적용해 둔 프로젝트에 한한다 - 008·009를 아직 쓰지
   > 않는다면 007에서, 011·012를 아직 쓰지 않는다면 009에서 멈춰도 된다. 008·011은
   > enum 값 추가일 뿐이라 002 재실행의 영향을 받지 않으므로 다시 실행할 필요가 없다).
   >
   > **★ 012까지 적용한 프로젝트가 009에서 멈추면 복구가 끝난 것처럼 보이지만 아니다.**
   > 009는 잡 큐 함수 3종을 `slope_judge` 분기까지만 되돌리고 **`register` 분기는
   > 되살리지 않는다**. 그런데 재판정은 정상으로 돌아오므로 "복구됐다"고 믿기 쉽다 -
   > 실제로는 정합 잡의 상태 전이가 오류 없이 사라진 채 남아, 정합 화면이 진행 상태를
   > 갱신하지 못하고 워커가 죽어도 실패 사유가 뜨지 않는다. 아래는 실측값이다
   > (함수 3종의 본문에서 각 분기 보유 개수):
   >
   > | 시점 | `register` 분기 | `slope_judge` 분기 |
   > |---|---|---|
   > | 012 적용 직후 | 3 | 3 |
   > | 002 재실행 사고 후 | 0 | 0 |
   > | 003 → 004 → 007 → 009 에서 멈춤 | **0** | 3 |
   > | 003 → 004 → 007 → 009 → **012** | 3 | 3 |
   >
   > 복구 후 다음 쿼리로 **직접 확인한다**(둘 다 3행이어야 한다):
   >
   > ```sql
   > select proname from pg_proc where prosrc like '%registration_id%';  -- register
   > select proname from pg_proc where prosrc like '%slope_judge%';      -- 재판정
   > ```
2. Storage 화면에서 `raw-scans`·`artifacts`·`reports` 버킷 3개 생성 확인
   (정책 생성이 `42501`로 실패하면 백로그 티켓 42대로 Storage > Policies UI에서 수동 생성)
3. **[필수] 회원가입(Sign Ups) 차단** - **Authentication** > **Providers** > **Email**에서
   **"Enable Sign Ups"를 끈다.**

   왜 필수인가 - `supabase/migrations/001_schema.sql`의 RLS 정책은 로그인 여부만
   검사할 뿐 행의 소유자가 요청자 본인인지는 검사하지 않는다:

   ```sql
   create policy all_auth on sites for all to authenticated using (true) with check (true);
   ```

   이 형태의 정책이 `sites`·`locations`·`scans`·`analyses`·`photos`·`reports`·
   `report_analyses` 7개 테이블 전부에 걸려 있고, `005_storage_buckets.sql`의
   `raw_scans_all_auth` 정책도 `to authenticated`에게 `raw-scans` 버킷 전체의 읽기·쓰기를
   허용한다. **즉 로그인만 하면 어떤 계정이든 모든 현장·스캔·분석·보고서를 읽고 쓰고
   지울 수 있다.** 대시보드 주소가 공개된 상태에서 회원가입이 열려 있으면, 가입 버튼을
   누르는 순간 이 전체 권한을 갖게 된다. "보안상 권장"이 아니라 이 저장소가 공개로
   전환되는 순간 뚫리는 실제 구멍이므로 배포 전 필수 조치다(백로그 티켓 57 참고).

   계정을 추가로 더 만들 때도 회원가입 화면 대신 같은 방법(아래 4번)을 쓴다.
4. **[필수] 로그인 계정 생성** - 회원가입을 껐으므로 계정을 미리 만들어 두지 않으면
   아무도 로그인할 수 없다. Supabase 대시보드 > **Authentication** > **Add user**에서
   이메일·비밀번호를 입력하고 **Auto Confirm User**를 체크한다(이메일 인증 절차를
   건너뛰고 바로 로그인 가능한 계정이 만들어진다). 이 대시보드는 로그인 화면만 제공하고
   자체 회원가입 화면은 없다(`dashboard/app/login/login-form.tsx`). 이 단계를 건너뛰면
   배포 후 스모크(§4)의 "로그인"에서 계정이 0개인 채로 막힌다.
5. 참고 - 원본 스캔 업로드(`raw-scans`)는 브라우저가 서버를 거치지 않고 Storage에 직접
   올린다(`dashboard/lib/scans/upload.ts`). 서버 측 검증이 전혀 없으므로 위
   `raw_scans_all_auth` 정책이 접근 통제의 유일한 방어선이다 - 이 정책을 바꿀 때는
   3번의 회원가입 차단 상태가 여전히 유효한지 함께 재확인한다.

## 2. Railway - 워커 (사용자 수행)

1. New Project > Deploy from GitHub repo > 이 저장소 선택
2. Settings > Build: Dockerfile 감지 확인(Root Directory는 저장소 루트 그대로)
3. Variables에 아래를 입력한다. **service_role 키는 워커에만 넣는다**

   | 키 | 값 |
   |---|---|
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 |
   | `STORAGE_BACKEND` | `supabase` |
   | `WORKER_ID` | `railway-1` |
   | `POLL_INTERVAL_S` | `3` |
4. Deploy 후 Logs에서 `[flatworker] 시작: worker_id=railway-1, storage_backend=supabase,
   poll_interval=3.0s, engine_version=p4-0.5.0` 확인(`storage_backend=supabase`가 찍혀야
   정상이다. 로컬 실행 시 보이는 `data_dir=...`는 `storage_backend=local`에서만
   출력되므로 여기서는 나타나지 않는다)
5. **엔진 능력 가드**: 위 로그 대신 `[flatworker] 엔진 모듈을 불러올 수 없습니다: ...`와
   `[flatworker] 엔진(engine/)을 워커보다 먼저 배포해야 합니다...` 두 줄이 찍히고
   워커가 종료 코드 1로 죽으면, 배포된 엔진에 `analyze_slope`가 없다는 뜻이다
   (`worker/flatworker/__main__.py`가 기동 시점에 이 상태를 붙잡아 트레이스백 대신
   남기는 안내다). §0에서 보듯 Dockerfile이 `engine/`·`worker/`를 한 이미지로 함께
   빌드하므로 정상 배포에서는 발생하지 않는다 - 이 로그가 보이면 대부분 **빌드
   캐시가 낡은 엔진 레이어를 재사용**한 경우다. Railway Deployments에서 캐시 없이
   재배포한다(또는 새 커밋을 하나 만들어 캐시를 무효화한 뒤 재배포한다). 오류
   메시지 안의 `pip install -e engine` 안내는 **로컬 개발 환경**을 위한 것이고
   Railway 컨테이너 안에서 실행할 수 있는 명령이 아니니 혼동하지 않는다

## 3. Vercel - 대시보드 (사용자 수행)

1. Add New Project > 이 저장소 Import
2. **Root Directory를 `dashboard`로 지정**(이걸 빠뜨리면 빌드가 실패한다)
3. Environment Variables

   | 키 | 값 |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon(public) 키 |
   | `NEXT_PUBLIC_MAX_UPLOAD_BYTES` | `52428800` (Pro 승급 시 상향) |
4. Deploy 후 Supabase > Authentication > URL Configuration에 Vercel 도메인 추가

## 4. 배포 후 스모크 (필수)

이 프로젝트를 개발한 PC에는 Docker가 설치돼 있지 않아 워커 컨테이너 이미지 빌드와 리눅스
환경에서의 한글 렌더링을 **로컬에서 한 번도 검증하지 못했다.** 아래 스모크가 이 이미지의
**최초 검증**이다 - Railway에서 처음으로 확인하게 된다는 뜻이며, 실패 가능성을 염두에 두고
진행한다.

1. 로그인 -> 스캔 업로드 -> 사전 검사 -> 단위 확정 -> 분석 완료까지 진행.
   **업로드는 반드시 "스캔 분석" 모드로 한다**(임포트 모드가 아니다) - 임포트는
   `unit_scale=1.0`을 업로드 시점에 박고 `status='ready'`로 바로 넘어가
   `precheck` 잡 자체가 등록되지 않으므로(`components/upload-form.tsx:93,102,122-138`)
   아래 높이 뷰 확인에 도달하지 못한다.

   **[필수] 높이 뷰 확인 - 이 배포가 추가한 유일한 사용자 대면 산출물이고,
   실패가 화면에 아무 신호도 남기지 않는다.** 사전 검사가 끝나면 스캔 상세에
   "단위 확인하고 분석 시작" 버튼이 뜬다(`scans.status='awaiting_unit_confirm'`일
   때만 - `app/scans/[id]/page.tsx`). 눌러서 `/scans/{id}/confirm-unit`으로 가
   아래 셋을 확인한다:
   - **높이 뷰 그림이 뜨는지**(위에서 내려다본 평면도. 그 아래 "원본 크기로 열기
     (새 탭)" 링크가 함께 있다). 넓은 화면에서는 단위 선택 폼 왼쪽에, 좁은
     화면에서는 폼 위에 놓인다(2열 배치가 `lg:` 이상에서만 걸린다). 좁은
     화면에서는 축 눈금 숫자가 뭉개지므로 그 링크로 원본을 열어 읽는다
   - 그림 안의 **한글이 네모 상자가 아닌지** - 제목 "높이 뷰 (평면도)", 축 라벨
     "X (파일 단위)"·"Y (파일 단위)", 컬러바 라벨 "상대 높이 (파일 단위, bbox 최저
     Z 기준)". 유효 서브셀이 하나도 없는 성긴 스캔이면 **컬러바가 아예 없는 대신**
     (거짓 범위를 보여주지 않으려는 의도적 설계다) 회색 바탕 한가운데에 빨간
     "유효 데이터 없음 - 점 밀도 부족"이 찍히고, 그 경우에도 축 눈금은 진짜 bbox
     값이라 단위 판단은 그대로 할 수 있다. **이건 보고서 PDF·히트맵과 별개인 새 matplotlib
     산출물이라 3번의 PDF 확인으로 대신할 수 없다** - 개발 PC(Windows/Malgun
     Gothic)에서만 확인했고 리눅스 컨테이너 렌더는 이 스모크가 최초 검증이다
     (`engine/flatness/outputs/height_view.py`가 `heatmap`을 부수효과 import 해
     폰트 설정을 물려받으므로, 네모 상자가 나오면 원인과 처방은 3번과 같다)
   - **그림이 아예 없으면**(그림 영역 자체가 없고 단위 선택 폼만 덩그러니 뜬다.
     주황색이든 무슨 색이든 경고 박스도 함께 없다) Railway Logs에서
     `[flatworker] 높이 뷰 생성 실패` 를 검색한다. 렌더·업로드 실패는
     `handle_precheck`의 `except`가 삼켜 `height_view_path`가 NULL로 남고, 화면은
     **예전과 완전히 똑같은 모습으로 폴백해 아무 이상 신호도 띄우지 않는다**
     (`components/unit-confirm-form.tsx`의 `if (!scan.height_view_path) return form;`).
     유일한 흔적이 이 로그 한 줄이다(`Dockerfile`에 `PYTHONUNBUFFERED=1`이 있어
     Railway에 즉시 뜬다). 참고로 **주황색 "높이 뷰를 불러오지 못했습니다" 박스는
     다른 경우다** - 경로는 남았는데 이미지 fetch가 실패한 상태(객체 삭제·서명 URL
     401/404)이고, 이때는 렌더 자체는 성공했으므로 위 로그가 없다
2. 결과 화면에서 히트맵 이미지와 결과표(`cells.json` fetch)가 뜨는지 확인
3. 보고서 생성 -> PDF 미리보기에서 **한글이 네모 상자가 아닌지 확인**. 네모 상자로 나오면
   이 순서로 확인한다:
   - Railway의 Build Logs에서 `fonts-noto-cjk` 설치 단계(`apt-get install`)가 성공했는지
   - **가장 유력한 원인은 폰트 패밀리명 불일치다.** 컨테이너에 실제 등록되는 이름은
     `Noto Sans CJK KR`이지 `Noto Sans KR`이 아니다.
     `worker/flatworker/report/templates/report.html.j2`의 `font-family`와
     `engine/flatness/outputs/heatmap.py`의 `matplotlib.rc("font", family=...)` 폴백
     체인 첫 후보가 이 이름과 정확히 일치하는지 확인한다
4. 50MB 초과 파일을 올려 한국어 안내가 뜨는지 확인
5. **구배 분석 스모크** - 007 적용 여부를 실제로 검증하는 유일한 절차다. 업로드
   화면에는 분석 종류 선택기가 없다(구배는 스캔 상세의 별도 버튼에서 시작한다 -
   `dashboard/components/upload-form.tsx:45-47` 주석). 아래 실제 경로를 따라간다:

   1. 로그인 -> 업로드 화면에서 **바닥(floor) 스캔**을 "스캔 분석" 모드로 올린다
      (임포트 모드가 아니다) -> 사전 검사 -> 단위 확정 -> **평활도** 분석이
      `status='done'`이 될 때까지 기다린다
   2. `/scans/[id]` 화면으로 이동한다. 아래 조건을 **모두** 만족해야 "구배 분석"
      섹션이 나타난다(`dashboard/app/scans/[id]/page.tsx`의 `showSlopeSection`):
      방금 완료한 평활도 분석이 있고 `status === 'done'`, 스캔이 바닥(`surface ===
      'floor'`, 벽 스캔에는 뜨지 않는다), 임포트(CSV/JSON) 결과가 아님, 스캔에
      측정위치(location)가 지정돼 있음. **섹션이 안 보이면** 이 네 조건부터 확인한다
   3. 버튼 위에 **"적용 기준" 라디오 목록**이 뜬다(`reanalyze-button.tsx`가
      마운트 시점에 `fn_resolve_criteria(site_id, 'floor', 'slope')`로 007의
      구배 기준 5종을 불러와 `thresholds[0].use` 문구로 보여준다). **여기서
      반드시 배수 목적 기준 중 하나를 고른다** - "옥상 슬래브(노출방수)",
      "옥상 슬래브(비노출·보호층)", "욕실·화장실 바닥", "주차장 바닥" 중
      아무거나. **기본 선택(`(기본)` 표시)은 "실내 평바닥"인데, 이 기준으로
      시작하면 아래 8~10번(배수구 클릭 스모크)이 UI에 아예 도달하지 않는다**
      - "실내 평바닥"(`slope-indoor-level`)은 설계 구배가 0%라 방향이라는
      개념 자체가 없고(`007_slope_analysis.sql`의 해당 시드 행
      `source_text`가 "방향 판정 대상이 아니므로 배수구를 지정하지 말 것"이라
      명시한다 - 설계 구배 0%인 평탄면에서 실측된 미세한 기울기는 사실상
      측정 노이즈라, 배수구를 찍으면 그 노이즈만으로 셀의 절반 가까이가
      역구배로 뒤집힌다), 화면도 이 기준을 `isDirectionAwareCriteria`
      (`dashboard/lib/domain/slope-direction.ts`)로 판별해 "배수구 위치를
      클릭하세요" 대신 "이 기준은 방향(역구배)을 판정하지 않습니다"를 보여주고
      클릭 자체를 막는다(옥상·욕실·주차장 4종은 전부 `dir_pass_deg=30`이라
      이 판별을 통과한다). 목록이 비어 있거나 "구배 판정 기준을 찾을 수
      없습니다" 오류가 뜨면 007 미적용을 의심한다(`reanalyze-button.tsx`의
      `criteriaLoadError`).
   4. 기준을 고른 뒤 **"구배 분석" 버튼**(`ANALYSIS_KIND_LABEL.slope + ' 분석'`
      = "구배 분석" 문구)을 클릭해 분석을 시작하고 완료까지 기다린다.
      **여기가 007 적용 여부가 실제로 갈리는 지점이다** - 007 미적용 시
      위 3번의 기준 목록 자체가 비거나(선택할 게 없어 이 버튼이 계속
      비활성) `fn_resolve_criteria`가 3인자를 못 받는 오류로 실패한다
   5. 완료 후 `/analyses/[id]`를 연다. `a.status !== 'done' || !a.stats`면 아직
      완료되지 않은 것이니 대기한다(`dashboard/app/analyses/[id]/page.tsx:27-36`).
      완료됐다면 `isSlopeStats(a.stats)` 가드(같은 파일 49행, 실제 판별은
      `dashboard/lib/domain/stats.ts:9-12`의 `stats.format === 'slope-stats-v1'`)가
      `SlopeResult`로 보낸다(`dashboard/components/analysis/slope-result.tsx`).
      **세부과업 4 단계 D 배포 이후로는 이 화면이 상세 결과 화면이다** - 위
      3번에서 배수 목적 기준을 골랐다면 "배수구 위치를 클릭하세요" 안내
      문구(`slope-result.tsx`의 `directionAware` 분기 중 `true` 쪽 문단)와
      함께 등급별 색 히트맵(Canvas)·셀별 결과표·판정 요약 패널이 뜬다.
      **"실내 평바닥"(기본값)으로 시작했다면** 대신 "이 기준은 방향(역구배)을
      판정하지 않습니다..." 안내(`directionAware`가 `false`인 쪽 문단)가
      뜨고 지도가 클릭을 받지 않는다 - **이건 결함이 아니라 3번에서 설명한
      정상 동작이다**, 재판정 스모크(8~10번)를 확인하려면 3번으로 돌아가
      배수 목적 기준으로 다시 시작한다. 어느 쪽이든 방금 이 배포에서 새로
      돌린 분석이므로 `slope_cells.json`/`slope_judged.json`이 항상 함께
      생성돼(`analyze_slope`가 먼저 `dump_slope_cells`로 `slope_cells.json`을
      쓰고 - `engine/flatness/core/pipeline.py:306-308` - 곧바로 `judge_slope_cells`를
      호출하는데, 그 안에서 `dump_slope_judged`가 `slope_judged.json`을 쓴다 -
      `pipeline.py:250-251`. 최초 분석 한 번으로 둘 다 만들어진다) 캔버스
      자체는 뜨는 것이 정상이다 - "이 분석은 재판정할 수 없습니다" 안내 박스
      (`slope-result.tsx`의 `!canRejudge` 분기)가 보이면(위의 "방향 판정
      안 함" 안내와는 다른 문구다) 그건 이번 배포(단계 D 엔진) 이전에
      만들어진 **오래된** 구배 분석을 열었다는 뜻이므로, 방금 새로 돌린 분석의
      URL이 맞는지 다시 확인한다(아래 11번 참고 - 오래된 분석으로는 8~10번을
      시도할 수 없다)
   6. **지도 PNG는 이 화면에 뜨지 않는 것이 정상이다.** `slope_map.png`는 계속
      산출되지만(`stats.artifacts.map_png`), 재판정 가능한 분석(방금 만든 분석이
      해당)의 화면 코드에는 이 이미지를 보여주는 경로 자체가 없다
      (`slope-result.tsx`에서 `mapPng`는 컴포넌트 상단에서
      `const mapPng = artifacts?.map_png;`로 읽지만, `<img>`로 실제 렌더하는
      코드는 `!canRejudge` 분기 - 재판정 **불가능**한 옛 분석의 폴백 - 안에만
      있다. 다만 `directionAware`인 분기·`!directionAware`인 분기 둘 다 PNG
      **다운로드 링크**는 보여준다).
      대신 배수 목적 기준으로 시작했다면 **Canvas 히트맵**(등급별 색 사각형 +
      검은 화살표)이 결과표 위에 뜨는지 확인한다 - 이게 뜬다면
      `slope_cells.json`·`slope_judged.json`이 Storage에 정상 업로드되고
      서명 URL로 fetch까지 됐다는 뜻이라, PNG보다 더 넓은 배선을 검증한
      셈이다
   7. Railway Logs에서 기동 로그에 `engine_version=p4-0.5.0`이 찍히는지, 방금 만든
      `analyses` 행의 `engine_version` 컬럼에 같은 값이 저장됐는지 확인한다
   8. **재판정(배수구 클릭) 스모크 - 위 3번에서 배수 목적 기준을 골랐을 때만
      진행할 수 있다.** "실내 평바닥"으로 시작했다면 지도가 클릭을 받지
      않으므로(5번 참고) 이 단계 전체를 건너뛴다. 008·009를 적용했고
      재판정 기능을 켤 계획이면 이어서 확인한다(008·009를 적용하지 않은
      상태에서 클릭하면 "구배 판정 기준을 찾을 수 없습니다"와는 다른 오류가
      뜬다 - `fn_enqueue_job`(`supabase/migrations/002_functions_seed.sql:101`)의
      `p_type` 인자가 `job_type` enum 타입이라, 008 미적용 DB에는
      `'slope_judge'`라는 라벨 자체가 없어 PostgREST가 enum 캐스팅 오류를
      돌려주고 `enqueueJob`(`dashboard/lib/domain/jobs.ts:17-28`)이 이를
      "작업 등록에 실패했습니다: ..."로 그대로 보여준다). 위 5번 화면에서
      히트맵 위 아무 지점이나 클릭한다(`slope-heatmap-view.tsx`가 클릭
      좌표를 미터로 환산해 `onDrainClick`을 부른다). 클릭 즉시:
      - 잡이 성공적으로 등록되면 배수구 마커가 그 자리에 낙관적으로 찍히고
        (`slope-result.tsx`의 `handleDrainClick`이 `params` PATCH 성공 직후
        부르는 `setClickedDrainPoints([pt])`), 판정 요약 패널 맨 위에
        파란색 "재판정 진행 중... / 대기 중..." 배너가 뜬다
        (`slope-verdict-panel.tsx`의 `JudgeBanner` 함수, `processing`/
        `queued` 분기). 이 상태는 `analyses.status`가 아니라
        `analyses.params.judge.state`에서 오므로(설계 결정 D5) 화면 상단의
        분석 상태 표시는 계속 "완료"로 남아 있는 것이 정상이다
      - **재판정이 실행 중(`processing`)일 때만 지도 클릭이 막힌다** -
        `slope-result.tsx`의 `judgeBusy`는 이제 `judge.state === 'processing'`
        **만** 본다(`queued`는 더 이상 포함하지 않는다 - 워커가 잠깐 내려가
        `queued`에 오래 머물러도 사용자가 클릭으로 재시도해 볼 수 있게 하려는
        의도적 변경이다). `judgeBusy`일 때 `SlopeHeatmapView`는
        `clickable=false`로 받아 커서가 금지 표시(`cursor-not-allowed`)로
        바뀌고, 같은 파일 `onClick` 함수 첫 줄
        `if (!clickable || !transform) return;`과 `slope-result.tsx`의
        `handleDrainClick` 함수 첫 줄
        `if (busy || judgeBusy || !directionAware) return;`이 조기
        반환한다.
      - **재판정이 대기 중(`queued`)일 때 다시 클릭하면 이제는 정상적으로
        시도되고, 매번 23505로 거절된다** - 이전 버전 문서는 "대기 중에도
        클릭이 막힌다"고 적었는데 더 이상 사실이 아니다(위 `judgeBusy` 변경
        때문). 잡이 아직 `queued`라 `jobs_dedup` 부분 유니크가 새 엔큐를
        막으므로, "이미 같은 대상의 작업이 대기 중이거나 실행 중입니다..."
        메시지(`dashboard/lib/domain/jobs.ts:9-15`의
        `isDuplicateJobError`/`DUPLICATE_JOB_MESSAGE`, PostgREST 23505 판별)가
        **매 클릭마다** 뜨는 것이 정상이다(예전처럼 "첫 클릭 직후 짧은
        경합 창에서만" 나오는 게 아니다). 이때도 `params`는 갱신되지 않는다
        (브리프 D4 - 엔큐 먼저, 성공해야 params를 쓴다)
   9. 워커 로그에서 `slope_judge` 잡 처리를 확인한다(수 초 안에 끝나야 한다 -
      점군을 다시 읽지 않으므로, `worker/flatworker/jobs.py:171-268`의
      `handle_slope_judge`). 완료되면:
      - 화면이 자동 갱신된다(`use-judge-status.ts`의 Realtime 구독 + 5초 폴링이
        `params.judge.state`를 감지 → `slope-result.tsx`의 judge 상태 변화를
        지켜보는 `useEffect`가 `done`/`failed`에서 `router.refresh()`를 부른다)
      - 배너가 사라지고 히트맵·결과표·판정 요약이 새 배수구 기준으로 다시
        뜬다. "현재 배수구" 아래 "직전 배수구" 좌표도 함께 보이면
        (`slope-verdict-panel.tsx`의 `previous_drain_points` 표시 문단)
        `params.judge.previous_drain_points`가 정상적으로 남은 것이다
   10. **재판정 실패 경로도 한 번은 확인한다** (위 8번과 같은 전제 - 배수
      목적 기준으로 시작한 분석에서만). 008·009가 **둘 다** 적용된
      상태에서만 의미 있는 스모크다 - **008만 적용한 상태로는 이 절차가
      "실패"가 아니라 정상 완료로 끝난다.** 이유:
      `handle_slope_judge`(`worker/flatworker/jobs.py:171-268`)의 성공 경로는
      `build_slope_judge_fields`(`worker/flatworker/slope.py:162-166`)가
      `params.judge.state='done'`을 **워커 파이썬 코드가 직접** 써
      `db.update_analysis`로 PATCH하는 것이라 009의 SQL 함수를 전혀 거치지
      않는다 - 009가 확장하는 건 `queued→processing`(클레임)과
      `*→failed/queued`(실패) 전이뿐이다. 즉 판정 자체를 실패시키지 않는 한
      008만으로도 재판정은 끝까지 정상 진행되고 완료 배너가 뜬다(대시보드가
      클릭 시점에 이미 `params.judge.state='queued'`를 낙관적으로 써 두므로
      진행 배너도 정상적으로 보인다). 실패를 보려면 **실제로 워커가 예외를
      던지게 만들어야 한다.**

      **criteria 행을 지우는 방법은 쓰지 않는다** - `analyses.criteria_id`
      FK가 `on delete restrict`다(`supabase/migrations/001_schema.sql:174`).
      이미 분석이 참조 중인 criteria 행은 DELETE 자체가 외래키 위반으로
      거부되어 아무것도 지워지지 않는다(SQL Editor에 오류만 뜨고 재판정은
      평소처럼 성공한다 - 이 방법으로는 애초에 실패를 재현할 수 없다).

      대신 **이 분석 하나의 `slope_cells.json`만 Storage에서 잠시 치운다**
      (criteria처럼 여러 분석이 공유하는 데이터가 아니라 이 분석 전용 객체라
      다른 분석에 영향이 없다):
      1. 지금 보고 있는 `/analyses/[id]`의 `id`를 적어둔다.
      2. Supabase 대시보드 **Storage > `artifacts` 버킷 > `{id}/`** 폴더에서
         `slope_cells.json`을 찾아 이름을 바꾼다(예: `slope_cells.json.bak`
         - **삭제하지 않는다**, 끝나면 되돌려야 한다).
      3. 화면으로 돌아와 배수구를 다시 클릭한다.
         `stats.artifacts.cells_json`에 적힌 경로 문자열 자체는 그대로라
         워커는 정상적으로 `slope_judge_context`를 통과하지만, 그 경로로
         `storage.download_to`를 시도하면 객체가 없어 404 → `None` →
         `False`를 돌려받고(`worker/flatworker/storage.py:40-51`의
         `_download_to`), 정확히 이 두 줄에서 예외가 난다:
         `worker/flatworker/jobs.py:221-222`의
         `raise ValueError(f"셀 데이터 파일을 저장소에서 찾을 수 없습니다: {cells_json_key}")`.
      4. `worker/flatworker/runner.py:120-121`이 이 예외를 잡아
         `db.fail_job`을 부르고, 009의 `fn_job_fail` `slope_judge` 분기
         (`supabase/migrations/009_slope_judge_functions.sql:129-136`)가
         재시도 소진 시 `params.judge.state='failed'`를 쓴다.
         `jobs.max_attempts` 기본값 3에 재시도 간격이 `10초 * 시도 횟수`로
         늘어나므로(`009_slope_judge_functions.sql:138-140`), **실패가
         확정될 때까지 1~2분 정도 걸릴 수 있다** - 그사이 배너는 "대기
         중..."을 반복해서 보여줄 뿐 빨간 박스는 아직 뜨지 않는 것이
         정상이다(재시도 중 `error`는 저장되지만 `state==='queued'`일 때는
         화면에 노출하지 않는 것이 009의 계약).
      5. 최종적으로 판정 요약 패널에 빨간 박스 "재판정에 실패했습니다. 이전
         판정 결과가 표시되고 있습니다."와 그 아래 "사유: 셀 데이터 파일을
         저장소에서 찾을 수 없습니다: ..."가 뜨는지 확인한다
         (`slope-verdict-panel.tsx`의 `JudgeBanner` 함수 `failed` 분기,
         `state==='failed'`일 때만 `judge.error`를 노출하는 것이 009의
         계약이다). 이때도 위 5~7번에서 확인한 이전 판정 결과(등급·히트맵)는
         그대로 남아 있어야 한다 - `analyses.status`가 재판정 실패로
         `failed`가 되지 않는 것(D5)이 이 스모크의 핵심이다.
      6. **확인이 끝나면 2번에서 바꾼 이름을 반드시 `slope_cells.json`으로
         되돌린다** - 그대로 두면 이 분석은 이후 영구히 재판정할 수 없게
         된다(티켓 75와 같은 상태가 인위적으로 남는다).
   11. **세부과업 4 단계 C 이전(007만 적용한 시점)에 만들어진 구배 분석으로는
       위 8~10번을 시도하지 않는다.** 그런 분석에는 `slope_cells.json`이 없어
       (백로그 티켓 75) 5번 화면 자체가 "이 분석은 재판정할 수 없습니다.
       구배 분석을 다시 실행하면 배수구를 지정할 수 있습니다."로 클릭을 막는다
       (`slope-result.tsx`의 `!canRejudge` 분기 안내문 - 3번의 "실내 평바닥"
       안내와는 다른 문구다) - 히트맵도, 배수구 클릭도 뜨지 않는 것이 정상
       동작이며 결함이 아니다. 재판정을 확인하려면 반드시 이 배포 이후 새로
       배수 목적 기준으로 실행한 구배 분석을 써야 한다

6. **정합(두 스캔 합치기) 스모크 - 011·012를 적용했을 때만 해당.** 011·012를 적용하지
   않았다면 이 항목 전체를 건너뛴다(정합은 선택 기능이다 - §1의 1번 참고).

   **(1) 중복 엔큐 차단을 SQL Editor에서 먼저 확인한다.** 정합은 두 점군을 다시 읽는
   무거운 잡이라, 사용자가 "정합 실행"을 두 번 누르면 같은 잡이 두 개 도는 것이
   012가 막으려는 핵심 결함이다(`jobs_dedup` 재정의). **화면 없이 확인할 수 있고,
   실패해도 오류가 뜨지 않는 종류라 눈으로 볼 유일한 방법이다.** 아래를 그대로
   실행한다:

   ```sql
   select fn_enqueue_job('register', '{"registration_id":"00000000-0000-0000-0000-000000000001"}'::jsonb);
   ```

   uuid 하나가 반환된다. **같은 문장을 한 번 더 실행하면 이번에는 실패해야 한다** -
   `duplicate key value violates unique constraint "jobs_dedup"`(코드 23505).

   > **[필수] 두 번째 문장은 곧바로(수십 초 안에) 실행한다 - 그리고 실행 전에 잡
   > 상태를 확인한다.** `jobs_dedup`은 `where status in ('queued','processing')`인
   > **부분** 인덱스다. 이 스모크는 §4가 "**배포 후**" 절차라 워커가 이미 폴링
   > 중이고, 워커가 이 테스트 잡을 집어가면 대상 `registrations` 행이 없어 실패해
   > 재시도 3회를 소진한다. `fn_job_fail`의 백오프가 `10초 × 시도 횟수`라
   > **약 30~40초 뒤 잡이 `failed`가 되어 부분 인덱스 술어에서 빠지고, 그러면 두
   > 번째 문장이 정상적으로 성공한다**(실측 확인). 012가 멀쩡한데 아래 오진에
   > 빠지기 딱 좋은 창이다. 두 번째 문장을 실행하기 전에 잡이 아직 살아 있는지
   > 먼저 본다:
   >
   > ```sql
   > select status, attempts from jobs
   >  where type = 'register'
   >    and payload->>'registration_id' = '00000000-0000-0000-0000-000000000001';
   > ```
   >
   > (`type = 'register'`는 아래 뒷정리 `delete`와 같은 필터다 - 두 문장이 정확히
   > 같은 행 집합을 가리키게 맞춘다.)
   >
   > **결과가 2행 이상이면 이미 이 사이클을 한 번 겪은 것이다**(`failed` 하나 +
   > 재시도로 새로 들어간 `queued` 하나). 둘 다 `type='register'`라 필터로는 걸러지지
   > 않으니, `queued` 행만 보고 "아직 살아 있네" 하고 넘어가지 말고 **아래 뒷정리
   > `delete`로 전부 지운 뒤 1회차부터 다시 시작한다** - 그래야 1회차/2회차가 같은
   > 조건에서 비교된다.
   >
   > `status`가 `queued` 또는 `processing`이어야 이 검사가 성립한다. 이미
   > `failed`(또는 `done`)면 **012의 문제가 아니라 시간이 지난 것이다** - 아래
   > 뒷정리 SQL로 지우고 처음부터 다시 하거나, 워커를 잠시 멈추고 한다.

   두 번째 문장이 **잡이 `queued`/`processing`인 상태에서** 성공해 새 uuid가 나왔다면
   그때만 012의 `jobs_dedup` 재정의 누락을 의심한다 -
   `select indexdef from pg_indexes where indexname = 'jobs_dedup';`의 결과에
   `registration_id`가 들어 있는지 확인한다(들어 있지 않으면 012를 다시 Run 한다).

   확인이 끝나면 테스트 잡을 지운다:

   ```sql
   delete from jobs where type = 'register'
     and payload->>'registration_id' = '00000000-0000-0000-0000-000000000001';
   ```

   워커가 이미 떠 있으면 지우기 전에 이 잡을 집어갈 수 있는데 **데이터에는 해롭지
   않다** - 그 id의 `registrations` 행이 존재하지 않아 정합 핸들러가 실패로 끝나고,
   012의 `fn_job_fail` register 분기도 없는 행을 갱신하려다 **0행 갱신**으로 조용히
   지나간다(아무 데이터도 바뀌지 않는다. 재시도 3회 로그 소음만 남으며, 위 delete로
   그것도 사라진다). 해로운 것은 데이터가 아니라 **위 상자에서 설명한 시간 창**이다.

   **가장 확실한 방법은 이 (1)번 확인을 워커 배포 전(§2 Railway 배포 전)에 미리 해
   두는 것이다** - 잡을 집어갈 워커가 없으면 시간 창 자체가 생기지 않는다. 011·012는
   §1에서 이미 적용해 두므로 순서상 아무 문제가 없다.

   **(2) 실제 정합을 한 번 돌려 DB 계약을 확인한다.** 같은 바닥면을 겹치게 찍은 스캔
   2개를 올려 각각 분석까지 끝낸 뒤(§4-1과 같은 절차, **"스캔 분석" 모드로** - 임포트
   모드는 높이 뷰가 만들어지지 않아 대응점을 찍을 그림 자체가 없다) 아래 순서로
   진행한다. **화면 문구는 실제 코드에서 읽어 옮긴 것이다**(단계 F 대시보드 기준):

   1. 홈(측정위치 트리)에서 두 스캔이 속한 **측정위치 줄의 "스캔 정합"** 링크를 누른다
      ("스캔 업로드"·"보고서" 링크 옆에 있다). 주소는 `/registrations/new?location=...`
      이다. 후보 스캔이 2개 미만이거나 높이 뷰·단위가 준비되지 않았으면 그 화면이
      이유를 안내한다.
   2. 스캔 두 개를 고르고 **"대응점 찍기 시작"** 을 누른다 - `registrations` 행이
      `status='awaiting_points'`로 만들어지고 `/registrations/{id}`로 이동한다.
   3. 좌우 두 그림(장식 없는 높이 뷰)에서 **같은 지점**을 번갈아 눌러 대응점 3쌍
      이상을 찍는다. 찍은 쌍은 목록에 쌓이고 "지우기"로 뺄 수 있다.
   4. **"정합 실행"** 을 누른다. `registrations.status`가 `queued` → `processing` →
      `done`으로 바뀌며 화면에 **"정합 결과"** 패널(정합 잔차 RMSE · ICP 반복 ·
      겹친 영역(추정))이 뜬다.
   5. **"겹쳐보기 (정합 결과 육안 확인)"** 를 열어 두 점군이 실제로 포개졌는지 눈으로
      본다. **이 단계를 건너뛰지 마라** - RMSE는 수직 방향만 보증하므로 수평으로
      몇 미터가 어긋나도 수치는 정상으로 나온다(아래 `horizontal_sensitivity` 항목).
   6. **"병합 스캔 열기"** 로 `lineage='registered'` 스캔 상세로 넘어간다. 그 화면
      상단에 "두 스캔을 정합해 만든 병합 스캔입니다." 배너와 **"정합 결과·겹쳐보기
      확인"** 버튼이 보여야 한다. 배너 자리에 "이 스캔을 만든 정합 이력을 찾지
      못했습니다"가 뜨면 `result_scan_id`가 비어 있다는 뜻이다(아래 쿼리로 확인).
   7. **같은 화면에서 "평활도 분석"을 눌러 병합 스캔을 실제로 분석한다.** 정합의
      목적이 "합쳐서 분석하는 것"이므로 여기까지 태워야 스모크가 끝난다.
      - 병합 스캔은 `status='ready'`인데 `analyses` 행이 없는 상태로 만들어진다.
        기존 분석 진입점 세 개(단위 확정·재분석·구배)는 전부 다른 조건을 요구하므로
        **이 버튼이 없으면 병합 스캔은 UI에서 분석할 방법이 없다**(막다른 골목).
      - 눌렀을 때 잡 타입이 **`analyze`** 여야 한다. `import`로 걸리면 임포트 판별이
        잘못된 것이고, 그 경우 점 단위 편차 목록을 원시 점군으로 오해해 **전 셀이
        "적합"으로 나오는 조용한 오답**이 된다.
      - **임포트 스캔은 화면으로 구별하려 하지 마라.** 정상 임포트 스캔에도 "평활도
        분석" 버튼이 보인다 - `analyses` 행이 이미 있어 재분석 버튼(`ReanalyzeButton`)이
        렌더되고 그 라벨이 같은 문자열이다. 버튼이 **없는** 것은 업로드가 중간에 끊긴
        고아 임포트 스캔뿐이라 일부러 재현할 수 없다. 구별은 아래 SQL로 한다.

      SQL Editor에서 확인한다:

      ```sql
      -- 방금 만든 병합 스캔에 분석이 실제로 걸렸는지
      select a.kind, a.status, j.type as job_type
        from analyses a
        left join jobs j on j.payload->>'analysis_id' = a.id::text
       where a.scan_id = '<위에서 확인한 result_scan_id>'
       order by a.created_at desc;
      ```
      `kind='flatness'`, `job_type='analyze'`가 나와야 한다.

      **같은 쿼리를 임포트 스캔(Colab CSV/JSON로 올린 것)의 `scan_id`로도 돌려
      대조한다** - 거기서는 `job_type='import'`가 나와야 한다. 임포트 스캔에
      `analyze`가 걸리면 점 단위 편차 목록을 원시 점군으로 오해해 **전 셀이
      "적합"으로 나오는 조용한 오답**이 된다(`reanalyze-button.tsx` 상단 주석에
      실제 사고 기록이 있다).

      > 한 분석에 실패 잡과 재시도 잡이 쌓여 있으면 위 LEFT JOIN이 여러 행을
      > 돌려준다(`jobs_dedup`은 `queued`·`processing`에만 걸린다). `job_type`이
      > 전부 같은 값이면 정상이다.

   완료되면 SQL Editor에서 결과 행을 직접 확인한다 - **화면 문구가 아니라 이 값들이
   정합이 실제로 성립했다는 증거다**:

   ```sql
   select r.status, r.rmse_mm, r.overlap_ratio, r.horizontal_sensitivity,
          r.iterations, r.error_text, r.result_scan_id,
          s.lineage, s.status as scan_status, s.unit_scale
     from registrations r left join scans s on s.id = r.result_scan_id
    order by r.created_at desc limit 1;
   ```

   - `status='done'`, `rmse_mm`이 **밀리미터 자릿수**(0.001 같은 값이면 미터를 그대로
     넣은 것이다 - 워커가 `* 1000` 환산을 빠뜨린 경우이고, 이 값은 화면에서 **항상
     합격으로 읽힌다**)
   - `overlap_ratio`가 채워져 있을 것(012가 추가한 컬럼이다 - `null`이면 워커가
     이 컬럼을 못 쓴 것이다)
   - **`horizontal_sensitivity`가 채워져 있을 것.** 012가 추가한 컬럼이고 `null`이면
     워커가 이 값을 못 쓴 것이다(012 미적용 또는 옛 워커). **이 값이 없으면 화면이
     "수평 방향 검증 불가"를 경고할 근거를 아예 갖지 못한다** - point-to-plane RMSE는
     수평 오정합을 원리적으로 못 보기 때문에(완전 평면에서 3m 어긋나도 RMSE가 게이트
     안에 들어온다), 이 값이 유일한 신호다. 1.1 미만이면 그 장면은 수평으로 검증할 수
     없다는 뜻이므로 위 5번의 겹쳐보기로 반드시 육안 확인한다.
   - `result_scan_id`가 채워져 있을 것(`done`인데 `null`이면 병합 스캔을 못 가리키는
     상태다 - 스캔 상세의 "정합 이력을 찾지 못했습니다"가 그 증상이다)
   - 병합 스캔의 `lineage='registered'`(`fused_mesh`가 아니다 - 업로드 화면이
     `fused_mesh`에 "앱이 스무딩한 데이터" 경고를 붙여 두어 정합 병합에는 거짓
     서술이 된다), `scan_status='ready'`, `unit_scale=1.0`
   - 중첩이 부족해 실패한 경우라면 `status='failed'`이고 `error_text`에 한국어
     사유가 있으며 `result_scan_id`가 **null**이어야 한다(실패한 정합이 병합 스캔을
     남기면 안 된다)

   워커 로그에서 `register` 잡 처리도 함께 확인한다. 정합은 점군을 두 번 읽으므로
   재판정(수 초)과 달리 수십 초가 걸릴 수 있다.

   > **위 화면 문구는 저장소의 실제 코드에서 읽어 옮긴 것이다**(진입점은
   > `dashboard/components/location-tree.tsx`, 생성 화면은
   > `dashboard/components/registration/registration-create-form.tsx`, 작업 화면은
   > `registration-workbench.tsx`, 병합 스캔 배너는 `dashboard/app/scans/[id]/page.tsx`).
   > 문구가 바뀌면 이 절차도 함께 고친다 - 이 문서에서 다섯 번 난 Critical이 전부
   > "존재하지 않는 것을 확인하라고 시키거나, 새로 생긴 것을 아무도 안 본다"였다.

7. **구배 분석의 PDF 보고서 스모크 - 단계 H가 추가한 경로다.** 위 5번(구배 분석
   스모크)을 끝내야 진행할 수 있다. 완료된(`status='done'`) 구배 분석이 있어야
   후보 목록에 뜬다.

   > **[먼저 읽을 것] 이 시점의 PDF 본문에는 구배 내용이 실리지 않는다.**
   > 단계 H는 후보 선택·컨텍스트 적재·자산 복사·스냅샷까지 이행했고, **보고서
   > 템플릿의 구배 전용 장은 아직 없다**(확인: `worker/flatworker/report/
   > templates/report.html.j2`에 구배 장이 없고, §2 분석 개요·§3 구간별 결과·
   > §4 시각자료에는 구배를 건너뛰는 `{% if a.kind != 'slope' %}` 가드만 있다).
   > 그래서 아래 절차는 **PDF 본문에서 구배 결과표를 찾으라고 시키지 않는다** -
   > 지금 찾으면 없는 것이 정상이다. 대신 과업지시서 산출 항목이 발행본에
   > 실제로 박제됐는지는 **`reports.snapshot`과 Storage로 확인한다**(6~7번).
   > **템플릿 구배 장이 들어오면 이 상자를 지우고 아래 5번에 본문 확인 항목을
   > 더한다.**

   1. 홈(현장 상세의 측정위치 트리)에서 구배 분석을 돌린 스캔이 속한 **측정위치
      줄의 "보고서"** 링크를 누른다("스캔 업로드"·"스캔 정합" 옆에 있다).
      주소는 `/reports?location=...`이다. 이어서 오른쪽 위 **"새 보고서"** 버튼으로
      `/reports/new?location=...`으로 간다.
   2. **"포함할 분석" 목록에 구배 분석이 뜨는지 확인한다.** 각 줄은
      `종류 · 표면 · 측정일자 · 판정 등급` 순서이고, 구배 분석은 **`구배 · 바닥 · ...`**
      으로 시작한다(평활도는 `평활도 · 바닥 · ...`). 안내 문구도 함께 확인한다:
      **"같은 측정위치의 완료된 최신 분석만 후보로 표시됩니다(평활도와 구배, 바닥과
      벽면을 함께 묶을 수 있습니다)."**
      - **구배가 안 보이면** 이 배포의 대시보드가 옛 버전이다. 후보 조회는
        `.in('kind', ['flatness','slope'])`여야 한다(`dashboard/app/reports/new/page.tsx`).
        옛 버전은 `.eq('kind','flatness')`라 구배가 통째로 빠진다
      - **종류 문구가 없이 `바닥 · ...`만 뜨면** 같은 바닥 스캔의 평활도와 구배를
        육안으로 구별할 수 없다. 이것도 옛 버전 증상이다
      - 기본 보고서 제목이 후보 종류를 따라간다. 구배만 있는 측정위치라면
        **"{측정위치} 구배 분석 보고서"** 가 채워져 있어야 한다(둘 다 있으면
        "평활도·구배 분석 보고서")
   3. **재판정 중인 구배 분석은 선택할 수 없다 - 한 번은 눈으로 확인한다.**
      §4의 5번(구배 분석 스모크) 8번인 배수구 클릭 직후 **곧바로** 이 화면을 열면(재판정은 수 초 만에
      끝나므로 서둘러야 한다), 그 분석 줄의 체크박스가 회색으로 비활성이고 아래
      노란 박스에 사유가 그대로 뜬다:
      **"재판정 중이라 지금은 보고서에 넣을 수 없습니다. 지금 넣으면 곧 덮어쓰일
      이전 판정이 발행본에 그대로 박제됩니다. 재판정이 끝난 뒤 이 화면을
      새로고침하세요."**(잡이 아직 대기 중이면 앞부분이 "재판정 대기 중이라"로
      바뀐다. 문구는 `reports/new/page.tsx`의 `judgeBlockReason`).
      **놓쳤으면 이 3번은 건너뛰어도 된다** - 워커에도 같은 방어가 있어(아래 5번의
      실패 사유 참고) 발행본이 오염되지는 않는다. 재판정이 끝나면 새로고침으로
      다시 선택할 수 있다.
   4. 구배 분석을 체크하고 **"보고서 생성"** 을 누른다. `/reports/{id}`로 이동한다.
   5. **생성이 끝날 때까지 기다린다.** 진행 중에는 파란 점과 함께
      **"PDF 생성 대기 중..."** 또는 **"PDF 생성 중... (워커가 처리 중입니다. 이
      화면은 자동 갱신됩니다)"** 가 뜨고, 끝나면 사라지면서 **"PDF 미리보기"**
      iframe과 **"PDF 다운로드"**·**"발행"** 버튼이 나타난다.
      - 빨간 **"PDF 생성에 실패했습니다."** 박스가 뜨면 그 아래 **"사유:"** 를 읽는다.
        구배에서 나올 수 있는 사유 둘을 미리 적어 둔다:
        `재판정이 진행 중인 구배 분석이 포함되어 있습니다: {분석 id}. 재판정이 끝난 뒤
        다시 생성하세요.`(위 3번의 워커 쪽 방어 -
        `worker/flatworker/report/context.py`의 `_reject_if_rejudging`)와,
        `분석 {id}의 셀 데이터(cells.json)를 저장소에서 찾을 수 없습니다`(**옛 워커
        증상이다** - 구배 분기가 없는 워커는 평활도용 `cells.json`을 요구해 구배
        보고서가 100% 실패한다. Railway가 이 배포의 이미지를 쓰는지 확인한다)
      - **미리보기에서 한글이 네모 상자가 아닌지 확인한다.** 표지 제목·"1. 기본
        정보"·"측정 개요" 머리글이 대상이다. 네모 상자면 **§4의 3번**(보고서 PDF
        한글 확인)과 원인·처방이 같다(폰트 패밀리명 `Noto Sans CJK KR` 불일치)
      - **"측정 개요" 표의 "구분" 열에 `바닥 구배` 라고 찍히는지 확인한다.** 같은
        바닥 스캔의 평활도 행은 그냥 `바닥`이라, 종류를 문구로 밝히지 않으면 두 행이
        육안으로 구별되지 않는다(`report.html.j2`의 `a.kind == 'slope'` 분기)
   6. **과업지시서 산출 항목 5개가 발행본 스냅샷에 실렸는지 SQL로 확인한다.**
      템플릿 구배 장이 들어오기 전까지 이것이 유일한 확인 수단이다. SQL Editor에서:

      ```sql
      select r.gen_status, r.pdf_path,
             a->>'kind'                  as kind,
             a->'slope'->>'design_pct'   as 설계구배_pct,
             a->'slope'->>'dev_mean_pct' as 평균편차_pct,
             a->'slope'->>'dev_sd_pct'   as 표준편차_pct,
             a->'slope'->>'dev_max_pct'  as 최대편차_pct,
             a->'slope'->>'map_png'      as 지도png,
             a->'slope'->>'n_cells'      as 전체셀수,
             a->'slope'->'counts'        as 등급분포,
             jsonb_array_length(a->'slope'->'cells') as 조치필요셀수
        from reports r
        cross join lateral jsonb_array_elements(r.snapshot->'analyses') a
       where r.id = '<위 4번에서 만든 보고서 id>'
         and a->>'kind' = 'slope';
      ```

      - `gen_status='done'`, `pdf_path`가 채워져 있을 것
      - **`설계구배_pct`·`평균편차_pct`·`표준편차_pct`·`최대편차_pct` 네 값이 전부
        채워져 있을 것.** 과업지시서 11쪽 산출 항목 5개 중 넷이다. 나머지 하나인
        **구배값(%)과 셀별 설계 대비 편차는 `a->'slope'->'cells'` 배열의
        `slope_pct`·`dev_pct`** 에 있다
      - **`조치필요셀수`가 0이어도 결함이 아니다.** `cells` 배열에는 보수·재시공
        (역구배 포함)·판정불가 셀만 싣는다 - 2m 격자 수백 개를 전부 실으면 표가
        보고서를 채우기 때문이다. 전 셀이 적합인 좋은 바닥이면 비는 것이 정상이고,
        그때는 `전체셀수`와 `등급분포`가 빠진 셀을 설명한다
      - `지도png`는 `reports/{보고서 id}/assets/{분석 id}/slope_map.png` 형태여야
        한다. `null`이면 다음 7번이 실패한 것이다
      - **행이 0개면** 스냅샷에 구배 항목이 없다는 뜻이다. 4번에서 구배를 실제로
        체크했는지, 워커가 이 배포의 이미지인지 확인한다
   7. **`slope_map.png`가 발행본 자산으로 복사됐는지 확인한다.** Supabase 대시보드
      **Storage > `reports` 버킷 > `{보고서 id}/assets/{분석 id}/`** 에
      `slope_map.png`가 있어야 한다(6번의 `지도png` 값에서 맨 앞 `reports/`를 뺀
      것이 이 경로다). 발행본 재현성의 핵심이다 - 원본 분석이 삭제돼도 이 사본으로
      같은 PDF를 재현한다. 복사에 실패해도 **보고서 생성은 실패로 끝나지 않는다** -
      `build_assets`가 사유를 `notes`에 적고 계속 진행하며, 그 문구는 PDF 종합의견
      장의 **"생성 참고 사항"** 목록에 나온다. 화면에는 아무 경고도 뜨지 않으므로
      Storage와 그 목록 둘 중 하나는 직접 본다.

   > **위 화면 문구는 저장소의 실제 코드에서 읽어 옮긴 것이다**(후보 목록·차단 사유는
   > `dashboard/app/reports/new/page.tsx`와 `dashboard/components/report/
   > report-create-form.tsx`, 진행·실패 문구는 `components/report/report-progress.tsx`와
   > `lib/domain/labels.ts`의 `REPORT_GEN_STATUS_LABEL`, 측정 개요 표는
   > `worker/flatworker/report/templates/report.html.j2`, 워커 실패 사유는
   > `worker/flatworker/report/context.py`). 문구가 바뀌면 이 절차도 함께 고친다.

## 사용자가 직접 해야 하는 작업 요약 (코드로 대신할 수 없음)

1. Supabase SQL Editor에서 `001_schema.sql` ~ `007_slope_analysis.sql`을 순서대로 실행
   (**[필수] 007까지 반드시**, 007 없이 대시보드를 먼저 올리면 분석 조회 전체가 깨진다),
   버킷 3종 생성 확인(정책 42501 실패 시 UI 수동 생성). 재판정 기능을 쓸 계획이면
   `008_slope_judge_enum.sql`→`009_slope_judge_functions.sql`을 **반드시 두 번 나눠**
   이어서 실행(§1의 1번 참고, 필수 최소 범위는 아니다). 정합 기능을 쓸 계획이면
   `011_register_enums.sql`→`012_register_support.sql`도 **반드시 두 번 나눠** 이어서
   실행한다(같은 이유다. **012는 008을 전제하므로 009를 건너뛰더라도 008은 함께
   적용한다** - §1의 1번 011·012 문단 참고)
2. **[필수]** Supabase Authentication > Providers > Email에서 회원가입(Sign Ups) 차단 -
   이유는 위 §1의 3번 참고
3. **[필수]** Supabase Authentication > **Add user**로 로그인 계정 생성(**Auto Confirm
   User** 체크) - 이 대시보드는 회원가입 화면이 없어 이 단계 없이는 아무도 로그인할 수
   없다. 위 §1의 4번 참고
4. Railway: GitHub 저장소 연결, 환경변수 5개 입력, Deploy
5. Vercel: 저장소 Import, **Root Directory를 `dashboard`로 지정**, 환경변수 3개 입력, Deploy
6. Supabase Authentication > URL Configuration에 Vercel 도메인 추가
7. 배포 후 스모크: 업로드 -> 분석 -> **단위 확정 화면의 높이 뷰 한글 육안 확인**
   (§4-1 참고 - 이 배포가 추가한 새 matplotlib 산출물이고, 실패해도 화면에
   신호가 없어 Railway 로그 확인이 유일한 수단이다), 보고서 PDF 한글 육안 확인,
   50MB 초과 안내 확인,
   구배 분석 스모크(§4-5 참고 - 007 검증을 겸한다), 008·009를 적용했다면 재판정
   (배수구 클릭) 스모크(§4-5의 8~10번 참고 - 3번에서 배수 목적 기준을 골라야
   도달 가능하다), 011·012를 적용했다면 정합 스모크(§4-6 참고 - **중복 엔큐 차단
   확인은 화면 없이 SQL Editor만으로 되고, 이것이 012의 핵심 결함 방지를 눈으로 볼
   유일한 방법이다**),
   구배 분석의 PDF 보고서 스모크(§4-7 참고 - 후보 목록에서 평활도와 구배가 문구로
   구별되는지, 과업지시서 산출 항목 5개와 `slope_map.png`가 발행본 스냅샷·자산에
   실제로 박제됐는지를 SQL·Storage로 확인한다)
8. 저장소 공개 전환 전 `git log -p`로 키 노출 여부 최종 확인

## 참고

- Supabase 프로젝트 자체를 처음부터 준비하는 절차(001~004 마이그레이션, API 키 발급 등)는
  [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) 참고.
- 워커 컨테이너 이미지 빌드·로컬 실행·한글 폰트 검증 스니펫은
  [`../worker/README.md`](../worker/README.md)의 "컨테이너로 실행" 절 참고.
- 운영 비용 구성은 [`service-report.md`](service-report.md) §3.5 참고.

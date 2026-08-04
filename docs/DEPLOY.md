# 클라우드 배포 절차

Vercel(대시보드) + Railway(워커, Docker) + Supabase(DB·Auth·Storage) 구성으로 배포한다.
**코드로 준비된 것**과 **사용자가 직접 해야 하는 것**을 절 단위로 분리했다.

> **배포 전 필수**: 이 저장소는 공개(public)로 전환되고 대시보드는 공개 URL로 배포된다.
> §1의 3번(회원가입 차단)을 하지 않으면 대시보드 주소를 아는 누구든 가입해서 전체
> 현장·스캔·분석·보고서에 접근할 수 있다. 배포 직후 가장 먼저 처리한다.

## 0. 코드로 준비된 것 (추가 작업 없음)

- `supabase/migrations/005_storage_buckets.sql` - 버킷 3종(`raw-scans`·`artifacts`·`reports`) + RLS
- 저장소 루트 `Dockerfile` - 워커 이미지(Chromium·`Noto Sans CJK KR` 포함 - Debian
  `fonts-noto-cjk`가 실제로 등록하는 폰트 패밀리명이며 `Noto Sans KR`이 아니다)
- 워커 `STORAGE_BACKEND=supabase` 기본값(Dockerfile `ENV`)
- 대시보드 Storage 서빙(서명 URL 리다이렉트)·업로드(브라우저 직접 업로드) 경로

## 1. Supabase (사용자 수행)

1. SQL Editor에서 `001_schema.sql`부터 `007_slope_analysis.sql`까지 **순서대로** 실행한다
   (001~004를 아직 실행하지 않았다면 `docs/SUPABASE_SETUP.md` 2단계부터 순서대로 먼저
   진행한다). 006(`006_report_soft_delete.sql`)은 보고서 소프트 삭제, 007
   (`007_slope_analysis.sql`)은 구배 분석(`analyses.kind` 컬럼·구배 판정 기준 시드)을
   추가한다 - 둘 다 재실행 안전(멱등)하다

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
   >
   > **이미 002를 재실행해 버렸다면 007만으로는 복구되지 않는다.** 007이 정의하는
   > 함수는 `fn_resolve_criteria` 하나뿐이라, 위 (2)의 잡 큐 함수 3종 강등은 그대로
   > 남는다. 그 경우의 복구 순서는 **003 → 004 → 007**이다(003·004는 전부
   > `create or replace`라 재실행이 안전하고, 004가 003의 상위집합이라 순서가 중요하다).

   > 재발급한다). 이 원칙은 `docs/SUPABASE_SETUP.md`의 "새 프로젝트에서 순서대로
   > 한 번씩만 실행하면 정상"과 일치한다 - 예외는 007 하나뿐이다
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

1. 로그인 -> 스캔 업로드 -> 사전 검사 -> 단위 확정 -> 분석 완료까지 진행
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
   3. **"구배 분석" 버튼**(`dashboard/components/reanalyze-button.tsx`의
      `ANALYSIS_KIND_LABEL.slope + ' 분석'` = "구배 분석" 문구)을 클릭해 분석을
      시작하고 완료까지 기다린다. **여기가 007 적용 여부가 실제로 갈리는 지점이다**
      - 007 미적용 시 `fn_resolve_criteria`가 3인자를 못 받아 화면에 "구배 판정
      기준을 찾을 수 없습니다. 마이그레이션 007이 적용됐는지 확인하세요."가 뜬다
   4. 완료 후 `/analyses/[id]`를 연다. `isSlopeStats(stats)` 가드
      (`dashboard/app/analyses/[id]/page.tsx`)가 안내 화면으로 보낸다 - 세부과업 4
      단계 C 시점에는 **상세 표가 아니라** 판정 요약(등급별 셀 수)·판정 가능 비율·
      평균/표준편차/최대 편차·경고 목록·**구배 판정 지도 PNG**가 뜨고, 맨 아래에
      "구배 분석 상세 결과 화면은 준비 중입니다" 문구가 붙는 것이 정상이다(상세
      표는 단계 D에서 추가된다. `dashboard/components/analysis/slope-placeholder.tsx`)
   5. **지도 PNG가 실제로 뜨는지 확인한다** - 이 이미지는 Storage 서명 URL로
      서빙되므로, 뜬다면 워커가 산출물 경로를 버킷-상대로 바꿔 올리는 배선까지
      함께(간접) 검증된 것이다
   6. Railway Logs에서 기동 로그에 `engine_version=p4-0.5.0`이 찍히는지, 방금 만든
      `analyses` 행의 `engine_version` 컬럼에 같은 값이 저장됐는지 확인한다

## 사용자가 직접 해야 하는 작업 요약 (코드로 대신할 수 없음)

1. Supabase SQL Editor에서 `001_schema.sql` ~ `007_slope_analysis.sql`을 순서대로 실행
   (**[필수] 007까지 반드시**, 007 없이 대시보드를 먼저 올리면 분석 조회 전체가 깨진다),
   버킷 3종 생성 확인(정책 42501 실패 시 UI 수동 생성)
2. **[필수]** Supabase Authentication > Providers > Email에서 회원가입(Sign Ups) 차단 -
   이유는 위 §1의 3번 참고
3. **[필수]** Supabase Authentication > **Add user**로 로그인 계정 생성(**Auto Confirm
   User** 체크) - 이 대시보드는 회원가입 화면이 없어 이 단계 없이는 아무도 로그인할 수
   없다. 위 §1의 4번 참고
4. Railway: GitHub 저장소 연결, 환경변수 5개 입력, Deploy
5. Vercel: 저장소 Import, **Root Directory를 `dashboard`로 지정**, 환경변수 3개 입력, Deploy
6. Supabase Authentication > URL Configuration에 Vercel 도메인 추가
7. 배포 후 스모크: 업로드 -> 분석 -> 보고서 PDF 한글 육안 확인, 50MB 초과 안내 확인,
   구배 분석 스모크(§4-5 참고 - 007 검증을 겸한다)
8. 저장소 공개 전환 전 `git log -p`로 키 노출 여부 최종 확인

## 참고

- Supabase 프로젝트 자체를 처음부터 준비하는 절차(001~004 마이그레이션, API 키 발급 등)는
  [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) 참고.
- 워커 컨테이너 이미지 빌드·로컬 실행·한글 폰트 검증 스니펫은
  [`../worker/README.md`](../worker/README.md)의 "컨테이너로 실행" 절 참고.
- 운영 비용 구성은 [`service-report.md`](service-report.md) §3.5 참고.

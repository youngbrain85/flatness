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

   **재판정(구배 배수구 재클릭) 기능을 쓸 계획이면 007 다음에 008·009도 이어서
   적용한다**: `008_slope_judge_enum.sql`(job_type에 `slope_judge` 값 추가) →
   `009_slope_judge_functions.sql`(잡 큐 함수 3종에 slope_judge 분기 확장). **008과
   009는 절대 한 번에 이어 붙여 실행하면 안 되고 반드시 두 번 나눠 Run 한다** -
   PostgreSQL이 같은 트랜잭션 안에서 방금 추가한 enum 값의 사용을 "unsafe use of new
   value"로 막고, Supabase SQL Editor는 붙여넣은 내용 전체를 한 트랜잭션으로 실행하기
   때문이다. 008 Run → `Success` 확인 → 에디터 비우기 → 009 Run 순서를 지킨다. 둘 다
   재실행 안전(멱등)하며, `analyses.status`는 slope_judge 분기에서 절대 바뀌지 않는다
   (재판정 진행 상태는 `analyses.params.judge`에만 반영된다 - 자세한 이유와 상태
   스키마는 `docs/SUPABASE_SETUP.md` 2단계 8·9번 참고). 이 저장소가 아직 세부과업 4
   단계 D의 워커·대시보드를 배포하지 않은 상태라면 008·009를 지금 당장 적용하지
   않아도 기존 기능에는 영향이 없다.

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
   > 남는다. 그 경우의 복구 순서는 **003 → 004 → 007 → 009**이다(003·004는 전부
   > `create or replace`라 재실행이 안전하고, 004가 003의 상위집합이라 순서가
   > 중요하다. 009까지 이미 적용해 둔 프로젝트에 한하며, 008·009를 아직 쓰지 않는다면
   > 007에서 멈춰도 된다 - 008은 enum 값 추가일 뿐이라 002 재실행의 영향을 받지 않는다).

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

## 사용자가 직접 해야 하는 작업 요약 (코드로 대신할 수 없음)

1. Supabase SQL Editor에서 `001_schema.sql` ~ `007_slope_analysis.sql`을 순서대로 실행
   (**[필수] 007까지 반드시**, 007 없이 대시보드를 먼저 올리면 분석 조회 전체가 깨진다),
   버킷 3종 생성 확인(정책 42501 실패 시 UI 수동 생성). 재판정 기능을 쓸 계획이면
   `008_slope_judge_enum.sql`→`009_slope_judge_functions.sql`을 **반드시 두 번 나눠**
   이어서 실행(§1의 1번 참고, 필수 최소 범위는 아니다)
2. **[필수]** Supabase Authentication > Providers > Email에서 회원가입(Sign Ups) 차단 -
   이유는 위 §1의 3번 참고
3. **[필수]** Supabase Authentication > **Add user**로 로그인 계정 생성(**Auto Confirm
   User** 체크) - 이 대시보드는 회원가입 화면이 없어 이 단계 없이는 아무도 로그인할 수
   없다. 위 §1의 4번 참고
4. Railway: GitHub 저장소 연결, 환경변수 5개 입력, Deploy
5. Vercel: 저장소 Import, **Root Directory를 `dashboard`로 지정**, 환경변수 3개 입력, Deploy
6. Supabase Authentication > URL Configuration에 Vercel 도메인 추가
7. 배포 후 스모크: 업로드 -> 분석 -> 보고서 PDF 한글 육안 확인, 50MB 초과 안내 확인,
   구배 분석 스모크(§4-5 참고 - 007 검증을 겸한다), 008·009를 적용했다면 재판정
   (배수구 클릭) 스모크(§4-5의 8~10번 참고 - 3번에서 배수 목적 기준을 골라야
   도달 가능하다)
8. 저장소 공개 전환 전 `git log -p`로 키 노출 여부 최종 확인

## 참고

- Supabase 프로젝트 자체를 처음부터 준비하는 절차(001~004 마이그레이션, API 키 발급 등)는
  [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) 참고.
- 워커 컨테이너 이미지 빌드·로컬 실행·한글 폰트 검증 스니펫은
  [`../worker/README.md`](../worker/README.md)의 "컨테이너로 실행" 절 참고.
- 운영 비용 구성은 [`service-report.md`](service-report.md) §3.5 참고.

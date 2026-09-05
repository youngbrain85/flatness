# 대시보드 Cloudscape 리디자인 — 설계

승인: 2026-09-04. 방향 탐색(Carbon / Primer / Cloudscape 3안) 후 사용자가 **C · Cloudscape**를 선택했고,
14개 화면을 그린 캔버스를 검토한 뒤 "이 디자인으로 구현 계획 세워서 진행하자"로 구현을 승인했습니다.

- 캔버스: https://claude.ai/code/artifact/9cc2448c-d38c-47c0-8abb-f33bc4fc52ed (1페이지 = 구현 대상 14장)
- **시각적 정본**: `docs/design/cloudscape/*.dc.html` (캔버스 1페이지의 아트보드 원본 14장). 마크업·수치·문구는
  이 파일들이 기준이며, 이 문서는 그 파일들이 공유하는 규칙을 적는다. 브라우저에서 바로 열어 볼 수 있다.

## 1. 목표

현재 대시보드(zinc 중립 + Noto Sans KR + Geist Mono, 텍스트 위주 사이드바)를 **AWS Cloudscape Design System**
(오픈소스, Apache-2.0)의 어휘로 다시 그린다. 사용자의 표현으로는 "요즘 스타일, 엔지니어링스럽고 전문적인
웹사이트처럼". 기능·흐름·데이터는 바꾸지 않는다 — 2026-08-11 리디자인이 확립한 흐름(작업대 통합, 업로드
셀프서비스, 원클릭 보고서, 막다른 화면 제거)은 그대로 두고 **시각 시스템과 화면 구조만** 교체한다.

## 2. 범위 / 비범위

**범위**: `dashboard/`의 토큰·공통 컴포넌트·셸·전 라우트 화면 구조. 아트보드 14장이 전부다.

**비범위(하지 않는 것)**:
- 서버 스키마·워커·엔진·Supabase 쿼리 로직 무변경. 화면 표시용 조회 추가만 허용.
- `@cloudscape-design/components` 라이브러리를 **도입하지 않는다**. Cloudscape는 어휘(토큰·해부·밀도)로만
  쓰고 Tailwind v4 유틸리티로 직접 구현한다 — RSC·기존 테스트·번들 크기와의 충돌을 피한다.
- 다크 모드 없음(산출물 PNG가 흰 배경, 과거 캐스케이드 사고 이력 — globals.css 주석 유지).
- 차트 라이브러리 추가 없음. 산출물 PNG·캔버스 히트맵은 그대로.
- 모바일 전용 설계 없음(§5 최소 동작만 보장).
- 기능 추가는 §7의 "테이블 도구 줄" 한 가지뿐이며, 그것도 클라이언트 필터에 한정한다.

## 3. 디자인 토큰 (`app/globals.css` `@theme inline`, 접두사 `cs-`)

| 토큰(Tailwind 클래스 접미) | 값 | 용도 |
|---|---|---|
| `cs-text` | `#000716` | 본문·제목 |
| `cs-text-secondary` | `#5f6b7a` | 보조 텍스트·설명·플레이스홀더·대기 상태 |
| `cs-nav-text` | `#414d5c` | 사이드 내비 비활성 항목 |
| `cs-link` | `#0972d3` | 링크·primary 버튼·활성 내비·포커스·info |
| `cs-link-hover` | `#033160` | 링크 hover |
| `cs-divider` | `#e9ebed` | 구분선·테이블 행 경계·진행바 트랙 |
| `cs-input-border` | `#8c8c94` | 입력·셀렉트·텍스트영역 보더(2px) |
| `cs-disabled` | `#9ba7b6` | 비활성 버튼 보더·텍스트, 단계 스트립의 미래 단계 |
| `cs-topnav` | `#0f1b2a` | 상단 바 배경 |
| `cs-topnav-text` | `#d1d5db` | 상단 바 유틸리티 텍스트·아이콘 |
| `cs-success` / `cs-success-bg` | `#037f0c` / `#f2fcf3` | 적합·완료·성공 알림 |
| `cs-warning` / `cs-warning-bg` | `#8d6605` / `#fffce9` | 경계(주의)·경고 알림 |
| `cs-error` / `cs-error-bg` | `#d91515` / `#fff7f7` | 보수·재시공·실패·오류 알림 |
| `cs-info-bg` | `#f2f8fd` | info 알림 배경(글자·보더는 `cs-link`) |
| `cs-na` | `#7d8998` | 판정 불가 |
| `cs-external` / `cs-external-bg` | `#7d2f9e` / `#f5f0fa` | '외부 결과'(임포트 출처 경고) 배지 — 4색과 오독되지 않게 purple 유지 |
| `shadow-cs-container` | `0 1px 1px 1px #e9ebed, 0 1px 8px 2px rgba(0,7,22,.12)` | 컨테이너 |
| `rounded-cs-container` | `16px` | 컨테이너 모서리 |

- **판정 4단계 → 색**: 적합=success, 경계=warning, 보수·재시공=error, 판정 불가=`cs-na`. 이는
  `lib/domain/grade-tone.ts`의 3버킷 규칙(경계→warn, 보수·재시공→fail)과 같다.
- **예외(히트맵·범례)**: 캔버스 히트맵과 PDF가 공유하는 `GRADE_COLOR`(`lib/domain/labels.ts`, 보수 `#e8710a`
  · 재시공 `#c5221f` 등 5색)는 **그대로 둔다**. 화면의 배지·분포 바만 시스템 색을 쓴다. 이유: 화면과 PDF의
  히트맵 색이 어긋나면 안 된다.
- **이 표 밖의 색을 쓰지 않는다.** 기존 `zinc-*`·`amber-*`·`red-*`·`green-*`·`emerald-*`·`purple-*` 클래스는
  전부 제거 대상이다(§9 검증).

**타이포**: 본문 `Open Sans` + `Noto Sans KR`(둘 다 `next/font/google`, `--font-open-sans`·`--font-noto-sans-kr`),
14px/20px. 수치·일시·ID·파일명·단위 배율은 계속 `font-mono tabular-nums` — 모노는 이미 로드된 **Geist Mono를
유지**한다(아트보드는 시스템 모노 스택을 썼지만 폰트 추가 없이 같은 효과이므로 변경하지 않는다).
제목: h1 24px/30px 700, 컨테이너 제목 18px/22px 700, 폼 라벨 14px 700, 설명 12px/16px `cs-text-secondary`.

**형태**: 컨테이너 `rounded-cs-container` + `shadow-cs-container` + 흰 배경, 보더 없음. 버튼 알약(radius 20px).
입력 radius 8px, 보더 2px. 알림 radius 12px, 보더 2px. 여백 스케일 4/8/12/16/20/24/32/40.

## 4. 공통 컴포넌트 (`components/ui/`, `components/shell/`)

| 컴포넌트 | 해부 |
|---|---|
| `Container` | 흰 배경 + 그림자 + 16px 라운드. 헤더(제목 18px 700 + 선택적 카운터 `(n)` 보조색 + 우측 액션 슬롯, padding 12px 20px, 하단 1px `cs-divider`) + 본문(padding 20px; 테이블은 `padded={false}`) |
| `Button` / `LinkButton` / `buttonClass` | 높이 32px, padding 0 20px, radius 20px, 700. `primary`(파랑 채움 흰 글자) / `normal`(2px 파랑 보더, 파랑 글자) / disabled(2px `cs-disabled`). 아이콘은 16px + gap 6px. **뷰당 primary 1개** |
| `FormField` + `inputClass` `selectClass` `textareaClass` | 라벨 14px 700 위, 설명 12px 보조색, 필드 사이 gap 16px. 입력 32px·2px `cs-input-border`·radius 8px. 라디오·체크박스는 네이티브 input + `accent-cs-link`(아트보드의 커스텀 원과 시각적으로 동등, 접근성은 네이티브가 낫다) |
| `StatusIndicator` | 16px 아이콘 + 텍스트. `success`(check-circle) `warning`(triangle) `error`(x-circle) `in-progress`(clock) `pending`(minus-circle) `info`(info-circle). 색은 §3 |
| `Badge` | 기존 `TONE` 표를 §3 토큰으로 재매핑: pass/warn/fail = `-bg` 배경 + 의미색 글자, unknown/neutral = `cs-divider` 배경 + 보조색, `external`(purple) 추가 |
| `Breadcrumbs` | 14px, 링크 `cs-link`, 구분은 chevron-right 아이콘 보조색, 마지막 항목 보조색·비링크 |
| `PageHeader` | `Breadcrumbs`(선택) + h1 24px/30px 700 + 설명(선택) + 우측 액션 |
| `KeyValuePairs` / `StatValue` | 라벨 700 위·값 아래, 열 사이 1px `cs-divider` 세로 구분 + padding-left 20px. `StatValue`는 28px/32px 700 tabular 수치 + 보조색 단위 |
| `tableClass` | 헤더 40px 700(상하 1px 구분선), 행 44px, 셀 padding 0 20px, 행 구분 1px `cs-divider`, 수치 열 우측 정렬 mono, 첫 열 링크 `cs-link` 700 |
| `Alert` | radius 12px, 2px 보더, 좌측 아이콘, padding 12px 16px. `info`/`success`/`warning`/`error` — 색은 §3 |
| `ProgressBar` | 트랙 4px radius 2px `cs-divider`, 채움 `cs-link`, 우측 % 텍스트 |
| `TabBar` | 텍스트 14px 700, 활성 = 하단 4px `cs-link` 보더, 비활성 `cs-nav-text` |
| `ScanStepStrip`(재스킨) | 가로 스텝: 아이콘+라벨, 스텝 사이 1px 연결선. 완료=success, 현재=`cs-link` 700, 이후=`cs-disabled`, 실패=error. 현재 단계 계산 로직은 기존 그대로 |
| `EmptyState`(재스킨) | 컨테이너 안 중앙 정렬 문구 + primary `LinkButton`(막다른 화면 금지 규칙 유지) |
| `Icon` | 인라인 SVG 16px, viewBox 24, stroke 2px round. 이모지 금지 |
| `Spinner`, `VerdictBar` | 유지(색만 토큰으로) |
| `TopNav` | 44px `cs-topnav` 배경, 좌측 로고(아이콘 + FLATNESS 700), 우측 사용자 메뉴(아이콘 + 이메일 + chevron). 검색·알림 없음 |
| `SideNav` | 280px 흰 배경, 우측 1px 구분선. 헤더 "평활도 분석 콘솔" 16px 700. 그룹 1: 현장 / 보고서 / 업로드, 구분선, 그룹 2: 설정 / 로그아웃. 항목 padding 8px 28px, 활성 = `cs-link` 700, 비활성 `cs-nav-text`. 아이콘 없음(시스템 규칙). 클릭 즉시 스피너(`useLinkStatus`) 유지 |

삭제: `StatusDot`(→ `StatusIndicator`), `MetricCard`(→ `KeyValuePairs`+`StatValue`), `components/sidebar.tsx`·
`sidebar-nav.tsx`(→ `components/shell/`).

## 5. 셸·레이아웃

- 데스크톱(≥md): 상단 바(44px) 아래 좌측 사이드 내비(280px) + 본문. 본문 padding `20px 40px 40px`, 섹션 gap 20px,
  내용 최대폭 없음(1440에서 아트보드와 같게).
- **로그인(`/login`)**: 사이드 내비 없이 상단 바(사용자 메뉴 없음) + 중앙 컨테이너 카드. 현재 앱은 로그인
  화면에도 사이드바를 그리므로 이것은 **의도된 변경**이다. 구현은 라우트 그룹 이동 없이 클라이언트 셸이
  `usePathname()==='/login'`으로 사이드 내비를 숨긴다.
- 모바일(<md): 캔버스에 설계가 없다. 기존 최소 동작 유지 — 사이드 내비 숨김, 상단 바 아래 가로 메뉴 스트립
  (같은 메뉴·활성 판정). 375px에서 레이아웃이 깨지지 않으면 된다(2026-08-11 T1 사고 재발 금지: 세로 스택).
- `loading.tsx` 4종은 페이지와 **같은 본문 컨테이너 클래스**를 써서 전환 시 점프가 없어야 한다(공용 상수로 고정).

## 6. 화면별 구조 (아트보드 ↔ 라우트)

| 아트보드 | 라우트 | 구조 요약 |
|---|---|---|
| `Main` | `/` | PageHeader(제목 현장, 액션 normal '스캔 업로드') → Container '개요'(StatValue 4열: 현장·스캔·처리 중·판정 분포+VerdictBar+범례) → Container '현장 (n)'(액션 primary '새 현장', 도구 줄 §7, 테이블: 현장명·측정위치·스캔·최근 측정일·판정 분포·상태). 브레드크럼 없음 |
| `Login` | `/login` | 상단 바 + 중앙 Container 카드(h1 24px, 이메일/비밀번호 FormField, primary '로그인' 전폭, 안내 문구) |
| `Upload` | `/upload` | 브레드크럼 현장 › 스캔 업로드 → Container '업로드 정보' 2열(좌: 측정위치 셀렉트 + 인라인 새 측정위치 미니폼, 표면, 데이터 계보 / 우: 적용 기준 라디오 목록, 측정일자·장비, 담당자, 파일) → 우하단 primary '업로드 후 사전 검사' |
| `SiteNew` | `/sites/new` | 브레드크럼 현장 › 새 현장 등록 → Container 폼(현장명 (필수)/주소/메모) → 우하단 primary '현장 등록' |
| `SiteDetail` | `/sites/[id]` | 브레드크럼 현장 › 현장명, h1 현장명 + 주소 → Container '측정위치 (n)': 동 › 층 소제목 아래 측정위치 카드(1px `cs-divider` radius 8px; 이름, 액션 normal '스캔 업로드'·'보고서', 스캔 목록 행: 일시 mono·표면·판정 StatusIndicator) → Container '새 측정위치'(동/층/공간/측정위치 + primary '위치 추가') → Container '현장 사진 (n)'(업로더 + 갤러리 그리드 128px) |
| `ScanUnitConfirm` | `/scans/[id]` (awaiting_unit_confirm) | 브레드크럼 현장 › 현장명 › 측정위치, h1 '스캔 · 바닥 · <일시 mono>' → ScanStepStrip(단위확정 현재) → Container '스캔 정보'(KeyValuePairs 4열: 측정위치·원본 파일·장비·데이터 계보·점 개수·상태·단위 배율) → Container '단위 확인'(안내문 → 좌 높이 뷰 이미지 3fr / 우 2fr: 파일 info Alert + 라디오 3종 + primary '단위 확정 후 분석 시작') |
| `ScanProcessing` | `/scans/[id]` (processing) | 위와 같은 헤더·스트립(분석 현재)·스캔 정보 → Container '평활도 분석'(액션: disabled '평활도 분석' + 안내, 본문: StatusIndicator in-progress '분석 중… (이 화면은 자동 갱신됩니다)') |
| `ScanDone` | `/scans/[id]` (done) | 헤더 액션 primary '이 위치의 보고서 생성' → 스트립(완료) → 스캔 정보 → Container '평활도 분석'(액션 normal '평활도 분석', 본문: 이전 분석 링크 목록) → Container '구배 분석'(적용 기준 라디오 5종 — `fn_resolve_criteria` 순서, 기본 먼저 — + normal '구배 분석') → Container '평활도 결과'(헤더에 일시·엔진, TabBar 히트맵/정밀 편차맵/3D 프리뷰; 본문 3:2 그리드 — 좌 히트맵+범례(GRADE_COLOR 5색), 우 판정 패널: 판정 헤드라인 + 수치 KeyValuePairs 2열 + 등급 분포 바 + 적용 기준 + 경고 Alert + 자동 종합의견 + 종합의견 textarea + primary '저장') → 구역별 결과표 |
| `Reports` | `/reports` | 브레드크럼 현장 › 보고서 → Container '보고서 (n)'(액션 primary '새 보고서', 도구 줄 §7, 테이블: 제목·측정위치·상태 StatusIndicator·생성일) |
| `ReportNew` | `/reports/new` | 브레드크럼 현장 › 현장명 › 측정위치 → Container '보고서 생성'(제목 입력, 포함할 분석 체크 목록 — 차단 항목은 disabled + warning Alert, 종합의견 textarea) → 우하단 primary '보고서 생성'. `?location=` 없으면 측정위치 선택 드롭다운이 먼저(기존 D7 동작) |
| `ReportDetail` | `/reports/[id]` | 브레드크럼 현장 › 현장명 › 측정위치, h1 제목 + StatusIndicator 상태, 액션(normal 삭제·PDF 다운로드·다시 생성, primary 발행 — 기존 `ReportActions` 동작) → Container '포함 분석 (n)' → Container 'PDF 미리보기'(iframe) |
| `Settings` | `/settings` | 브레드크럼 현장 › 설정 → Container '프로필' → Container '측정 불확도 U'(바닥/벽면 입력 + primary 저장) → Container '판정 기준'(전역 기본 기준 테이블: 기준·출처(전문 표시, 말줄임 금지)·표면·버전·임계값·활성) |
| `RegistrationNew` | `/registrations/new` | 브레드크럼 현장 › 현장명 › 측정위치, h1 + 안내 → Container '스캔 선택'(A/B 셀렉트) → primary '대응점 찍기 시작' |
| `RegistrationDetail` | `/registrations/[id]` | h1 '스캔 정합' + StatusIndicator → Container '정합 결과'(KeyValuePairs 3열 + warning Alert + info Alert) → Container '겹쳐보기'(캔버스 + 우측 설명, 체크박스, 버튼) |

세 스캔 아트보드는 **같은 페이지의 세 상태**다. 기존 `app/scans/[id]/page.tsx`의 가드(`provenNotImport`·
`isImportUnknownOrTrue`·`showFirstFlatness`·`showSlopeButton/Section`)와 주석은 **문장 그대로 보존**하고
UI만 갈아끼운다.

## 7. 결정 사항 (사용자 검토 후 확정)

1. 상단 바의 검색·알림은 앱에 없어 넣지 않는다. 사이드 내비는 두 그룹(현장·보고서·업로드 / 설정·로그아웃).
2. 브레드크럼 루트는 소스대로 **'현장'**('/'). 홈에는 브레드크럼 없음. 마지막 항목은 현재 페이지(비링크).
3. **테이블 도구 줄** — 홈·보고서 목록의 검색 입력과 판정 필터는 **클라이언트 필터**로 구현한다(테이블을
   클라이언트 컴포넌트로 옮기고 이미 조회된 행을 걸러 보여준다; 서버 조회·URL 변경 없음). 아트보드의
   페이지네이션 컨트롤(‹ 1 ›)은 **구현하지 않는다** — 현재 데이터 규모에서 YAGNI. 대신 건수 텍스트만.
4. 히트맵·범례 색은 산출물 팔레트(`GRADE_COLOR`) 유지, 배지·분포 바만 시스템 색.
5. 로그인은 사이드 내비 없이(§5).
6. 라디오·체크박스는 네이티브 + `accent-cs-link`.
7. 모노 폰트는 Geist Mono 유지(§3).
8. 아트보드에 있으나 소스에 없는 문구(컨테이너 제목 '업로드 정보'·'스캔 정보'·'스캔 선택', 페이지 설명문)는
   **시스템 크롬으로 채택**한다 — 컨테이너 헤더는 Cloudscape 해부의 일부다. 단 데이터·통계·기능은 추가하지 않는다.

## 8. 구현 주의

- 이 저장소의 Next.js는 관례가 다르다 — 코드 전 `dashboard/node_modules/next/dist/docs/` 확인(`dashboard/AGENTS.md`).
- 서버 컴포넌트 우선 유지. 클라이언트 섬은 셸(활성 판정·경로 분기), 도구 줄 필터, TabBar, 기존 폼·감시 컴포넌트뿐.
- 기존 테스트(70 파일)의 **동작 단언은 그대로 통과**해야 한다. 클래스 문자열을 단언하던 테스트는 새 토큰
  클래스로 갱신한다(예: `bg-zinc-100` → `bg-cs-divider`). 활성 판정처럼 스타일로 상태를 읽던 테스트는
  `aria-current="page"` 같은 의미 속성으로 바꿔 스타일과 분리한다.
- 코드 주석 한국어, 알고리즘·라이브러리 이름 영어.

## 9. 검증

1. `cd dashboard && npx vitest run` 전부 통과 + 새 프리미티브·셸·필터 테스트.
2. 잔재 스윕: `app components lib`에서 `zinc-|amber-|red-|green-|emerald-|purple-|blue-` 클래스 grep이
   `__tests__` 밖에서 **0건**(GRADE_COLOR hex는 클래스가 아니므로 무관).
3. dev server에서 화면별 스크린샷을 `docs/design/cloudscape/*.dc.html`과 나란히 대조(사용자 상시 지시:
   화면 캡처 대조). 로그인은 사용자가 직접 한다. 콘솔 오류 0.
4. 375px에서 홈·스캔 작업대가 세로 스택으로 깨지지 않음.

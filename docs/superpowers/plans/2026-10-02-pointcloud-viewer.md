# 3D 점군 1:1 뷰어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 바닥 평활도 분석 결과 화면의 기존 `3D 프리뷰` 탭 안에, 엔진이 새로 만드는 점 표본 산출물 `points3d.bin`(최대 50만 점, 점당 8바이트)을 실제 좌표·축 비율 1:1로 그리는 회전·줌 가능한 순수 WebGL2 3D 점군 뷰어를 넣는다(스펙 `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md`).

**Architecture:** 엔진: `analyze_floor`가 grid·zones·residuals를 만든 뒤 파일을 한 번 더 스트리밍하는 3번째 패스에서 칸별 min-hash 층화 추출(`core/pointsample.py`)로 표본을 뽑고, 점마다 5cm 서브셀 잔차를 0.1mm 정수(또는 센티널 2종)로 붙여 단일 컨테이너 `points3d.bin`(`outputs/points3d.py`)으로 쓴다. 이 블록은 기존 렌더 3종과 별개의 독립 try/except이고 stats에 `points3d_paths`·`points3d_threshold_q`·경고 `points3d_render_failed`만 더한다(판정 경로·워커 로직·ENGINE_VERSION 무변경). 대시보드: `lib/domain/points3d.ts`(파서·분류·읽기 창 문자열·색 표·화면 상태 결정 순수 함수) + `lib/viz/points3d/*`(mat4·orbit·scaffold·budget·pick·controls 순수 함수, WebGL 접점은 `gl-renderer.ts` 한 파일) + `components/analysis/points3d-view.tsx`(캔버스·오버레이·컨트롤) + `preview3d-tab.tsx`(§7.11 분기) 를 `analysis-result.tsx`가 3D 탭 첫 진입 때 지연 적재해 그린다. 탭 왕복에도 남아야 하는 점 데이터·WebGL2 탐지 결과·소프트웨어 렌더 선택은 `AnalysisResult` state에 둔다.

파일 구조(T = 태스크 번호):
engine/flatness/core/pointsample.py [T1 신설, T2 추가] 상수·센티널·점별 편차(T1), PointSample·_hash63·sample_points(T2)
engine/flatness/outputs/points3d.py [T3 신설] encode/write/read_points3d, MAGIC·SCHEMA_VERSION·FILE_NAME
engine/flatness/core/pipeline.py [T4 수정] analyze_floor 에 독립 try 블록 삽입(:99 다음, :100 앞)
engine/tests/test_pointsample.py [T1 신설, T2 추가] / engine/tests/test_points3d.py [T3 신설, T6 에서 TS 상수 대조 1건 추가]
engine/tests/fixtures/points3d_golden.py, points3d_golden.bin [T3 신설] pytest·vitest 공용 골든
engine/tests/test_pipeline.py, engine/tests/perf/test_memory_spike.py [T4 수정]
docs/contracts/stats-schema.md, docs/scan-guideline.md, engine/tests/test_summary.py, worker/flatworker/report/labels.py, worker/tests/test_report_labels.py, dashboard/lib/domain/labels.ts, dashboard/lib/domain/types.ts, dashboard/lib/domain/__tests__/labels.test.ts [T5 수정] 계약 동반 수정(§6.3)
dashboard/lib/domain/points3d.ts [T6 신설, T7 추가] + lib/domain/__tests__/points3d.test.ts [T6 신설, T7 추가]
dashboard/lib/viz/points3d/mat4.ts, orbit.ts [T8] / scaffold.ts, budget.ts [T9] / pick.ts, controls.ts [T10] / gl-renderer.ts + __tests__/gl-stub.ts [T11] (각 모듈의 __tests__/*.test.ts 동반)
dashboard/components/analysis/points3d-view.tsx [T12], preview3d-tab.tsx [T13] (+ __tests__)
dashboard/components/analysis/analysis-result.tsx, __tests__/analysis-result.test.tsx, deviation-view.tsx(주석), dashboard/__tests__/points3d-litmus.test.ts [T14]
docs/service-report.md, README.md, dashboard/README.md, docs/superpowers/specs/2026-09-04-dashboard-cloudscape-redesign-design.md, docs/design/cloudscape/ScanDone3D.dc.html(신설) [T15]
(추적 파일 변경 없음) 전체 검증·성능 재측정·로컬 하네스 화면 캡처 [T16]
최종 계획 문서 저장 경로: docs/superpowers/plans/2026-10-02-pointcloud-viewer.md

**Tech Stack:** 엔진: Python(venv 3.14.3, 패키지 요구 >=3.11), numpy 2.4.4, scipy, pytest(+psutil, `-m perf`). 워커: Python(라벨 사본과 테스트만). 대시보드: TypeScript 5, Next.js 16.2.12(App Router, 저장소 전용 관례), React 19.2.4, Tailwind CSS v4, Vitest 4 + Testing Library + jsdom 29, 순수 WebGL2(GLSL ES 3.00). 새 의존성 0. 검증 하네스(저장소 밖): dashboard/node_modules 의 vite 8.1.5 + @vitejs/plugin-react + postcss(Tailwind), 캡처는 브라우저 패널 또는 CDP 스크립트.

**Spec:** docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md

## Global Constraints

- 요구의 유일한 출처는 `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md`다. 스펙을 고치지 않는다. 시제품(`.superpowers/research/3d-pointcloud-viewer/design-inputs/`)은 참고용이고 스펙과 다르면 스펙이 이긴다. 정본 `2026-07-27-flatness-dashboard-design.md`의 판정식·stats 필수 필드·보고서 구성은 한 글자도 바꾸지 않는다.
- 범위는 바닥 평활도 분석(`analyze_floor`)만이다. `analyze_wall`, `analyze_slope`, `judge_slope_cells`, 임포터(`importer/common.py`), 구배 화면(`slope-result.tsx`)을 고치지 않는다. 판정 경로(`subcell.py`, `zones.py`, `cells.py`, `criteria.py`)를 고치지 않는다. `pipeline.py`의 기존 `build_subcell_grid(iter_chunks(...))` 호출(`:40-41`)과 판정 단계(`:42-75`)는 한 줄도 바꾸지 않는다.
- 엔진 상수(글자 그대로): `MAX_POINTS = 500_000`, `OFF_SURFACE_M = 0.05`, `DEV_UNIT_M = 1e-4`, `DEV_NOT_FLOOR = -32768`, `DEV_NO_DEVIATION = -32767`, `DEV_MIN, DEV_MAX = -32766, 32767`. 센티널·단위 상수는 `core/pointsample.py`가 정의하고 `outputs/points3d.py`가 import한다(core가 outputs를 import하지 않는다).
- 표본 추출은 칸별 min-hash 층화 추출이며 난수와 시드를 쓰지 않는다. 표본 칸 변 `s = sqrt(점유 면적 / max_points)`(점유 면적 = `count(grid.counts > 0) * size_m^2`, bbox 면적에서 유도 금지). bbox 전체 크기의 밀집 배열(`NX × NY` 길이)을 만들지 않는다. 같은 파일이면 청크 크기·점 순서와 무관하게 `PointSample` 두 배열의 `tobytes()`와 `points3d.bin`이 바이트 단위로 같다.
- 파일 형식(schema_version = 1): 전부 little-endian. `MAGIC = b"FP3D"` + uint32 `json_len`(공백 0x20 패딩 포함, `8 + json_len`은 4의 배수) + UTF-8 JSON 메타 + `uint16 xyz[3n]`(x,y,z 인터리브) + `int16 dev[n]`. 총 `8 + L + 8n` 바이트. `FILE_NAME = "points3d.bin"`, `SCHEMA_VERSION = 1`. 압축 없음.
- 메타 키는 이 순서로 정확히 10개: `schema_version`, `n_points`, `units`, `origin_m`, `extent_m`, `deviation`, `sample_cell_m`, `fit_bounds`, `sampling`, `order`. 넣지 않는 것: 엔진 버전, 시드, 판정 기준에 종속된 값(임계값, 기준 이름, 불확도), 분류 수, 파일 경로, 생성 시각. 같은 스캔이면 기준을 바꿔 재분석해도 파일이 바이트 동일해야 한다.
- stats 새 키(floor 전용): `points3d_paths`(`["points3d.bin"]` 또는 `[]`), `points3d_threshold_q = int(round(criterion.pass_mm * 10))`(점 파일이 만들어졌을 때만 기록). 둘 다 `write_outputs` 이전에 기록한다. `points3d.bin`은 `preview3d_paths`에 넣지 않는다.
- 경고 코드 `points3d_render_failed`. 표시 라벨(대시보드 정본과 워커 사본이 같은 문자열): `3D 점군 데이터 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.` `engine/flatness/outputs/summary.py`의 `_WARN_TEXT`에는 넣지 않는다. 경고 코드 개수 단언은 12 → 13 두 곳(`engine/tests/test_summary.py:76`, `worker/tests/test_report_labels.py:73`).
- `ENGINE_VERSION`은 올리지 않는다(`p4-0.5.0` 그대로). CLI 옵션을 추가하지 않는다. 워커는 `worker/flatworker/report/labels.py`와 `worker/tests/test_report_labels.py`만 고친다(업로드 재시도·확장자 매핑·삭제 코드 추가 금지). DB 마이그레이션 없음.
- 대시보드 의존성 추가 없음(`dashboard/package.json`의 dependencies 6개 그대로). 순수 WebGL2 직접 구현. three.js·Plotly·deck.gl·regl 도입 금지. `getContext('webgl2')`는 effect 안에서만 부른다. `next/dynamic`·`ssr: false`를 쓰지 않는다. WebGL 접점은 `lib/viz/points3d/gl-renderer.ts` 한 파일이고 나머지 `lib/` 모듈은 DOM·WebGL을 건드리지 않는 순수 함수다. 모듈 분해는 스펙 §7.2 표의 10개 그대로(파일을 더 만들지 않는다. 테스트 헬퍼 `__tests__/gl-stub.ts` 제외).
- 이 저장소의 Next.js(16.2.12)는 관례가 다르다. 대시보드 코드 전에 `dashboard/node_modules/next/dist/docs/`를 확인한다(`dashboard/AGENTS.md`). 새 클라이언트 코드는 이미 `'use client'`인 `analysis-result.tsx` 아래에만 생긴다. 컴포넌트 반환 타입을 적지 않는다(`: JSX.Element`는 `tsc --noEmit`가 TS2503으로 실패).
- 색 표 `dark`(기본): 배경 `#000000`, FLAT `#4cc96f`, DEPRESSION `#f5c33b`, PROTRUSION `#f06464`, 편차 없음 `#4a4f57`, 격자선 `#ffffff` 알파 0.09, 축선 `#ffffff` 알파 0.28, 글자 `#f2f4f7`, 보조 글자 `#9aa3ad`, 읽기 창 배경 `#000000` 알파 0.8, 읽기 창 테두리는 축선과 같은 값.
- 색 표 `light`(밝은 배경 전환): 배경 `#ffffff`, FLAT `#1e9e50`, DEPRESSION `#b88700`, PROTRUSION `#d93636`, 편차 없음 `#b4bac2`, 격자선 `#000716` 알파 0.09, 축선 `#000716` 알파 0.28, 글자 `#000716`, 보조 글자 `#5f6b7a`, 읽기 창 배경 `#ffffff` 알파 0.9.
- 색 사용 규칙(§7.13): 뷰어 색은 `lib/domain/points3d.ts`의 `POINTS3D_THEME`에 hex 문자열로만 둔다. 캔버스는 uniform과 `clearColor`, DOM 오버레이는 인라인 `style`로 쓴다. 뷰어 색을 위한 Tailwind 색 유틸리티(`bg-black`, `text-white`, `bg-[#000000]` 포함)를 쓰지 않는다. `app/globals.css`에 토큰을 추가하지 않는다. 뷰어 바깥 크롬은 기존 `cs-` 토큰 클래스만 쓴다(로딩 틀의 Spinner 칩만 기존 `bg-white`). 새 파일의 주석·문자열·식별자에 `색이름-숫자` 꼴 표기를 쓰지 않는다. DOM에 `red-`·`green-` 부분 문자열이 들어가는 이름(`data-hovered-...`, `rendered-...`)을 쓰지 않는다. `dashboard/__tests__/palette-sweep.test.ts`는 고치지 않고 0건이어야 한다.
- 임계값·과장: `THRESHOLD_Q_MIN = 10`(1mm), `THRESHOLD_Q_MAX = 300`(30mm), `THRESHOLD_Q_STEP = 5`(0.5mm), `EXAGGERATIONS = [1, 10, 50, 100]`. 기본 임계값은 stats의 `points3d_threshold_q`(탑재 기준 6·7·10 → 60·70·100). 슬라이더 초기값은 5의 배수로 맞추지 않는다.
- 분류는 0.1mm 정수 비교이고 `classifyDev`와 셰이더가 같은 표를 쓴다: `d <= -32767` → 편차 없음, `d > T_q` → PROTRUSION, `d < −T_q` → DEPRESSION, 그 외 FLAT. 셰이더 uniform `uThresholdQ`는 정수(`uniform1i`). 표시 높이 `z' = z + dev × (k − 1)`(편차만 과장, 편차 없는 점은 제자리). 편차 있는 점의 깊이는 과장 전 기준면 위치(`z − dev`)로 계산한다. GPU에는 파일-로컬 좌표만 넘기고 절대 좌표는 JS float64로 읽기 창에서만 더한다. `Float32Array` 사본을 만들지 않는다.
- 공학 상수(§2.4, 전부 이름 붙은 상수): `FOVY` 40°. 프리셋 등각 방위 −55°·고도 20° / 평면 방위 −90°·고도 89.9° / 정면 방위 −90°·고도 5°. 고도 제한 ±89.9°. 줌 거리 `[0.02 × R, 20 × R]`. 드로잉 버퍼 배율 `min(devicePixelRatio, 2)`. 뷰어 영역 폭 100%·`aspect-ratio: 4 / 3`. 점 실제 크기 `0.55 × sample_cell_m`, 최소 CSS 1.5px. LOD 시작 `min(n, 150_000)`, 하한 `min(n, 20_000)`, `frameMs` 33ms 초과 ×0.7·20ms 미만 ×1.25. 조작 종료는 pointerup/pointercancel 즉시·휠과 키는 마지막 입력 후 200ms. 읽기 창 반경 12px. 격자 선 수 상한 40. 라벨 최소 간격 28px. 컨텍스트 복구 대기 3,000ms. 회전 1px당 0.005rad. 휠 줌 `distance × exp(deltaY × 0.001)`.
- 판정 이중화 금지(§8): 뷰어 코드(`lib/domain/points3d.ts`, `lib/viz/points3d/*.ts`, `points3d-view.tsx`, `preview3d-tab.tsx`)에 `pass_mm`, `rework_mm`, `u_mm`, `applied_criteria` 문자열이 주석 포함 0건이어야 한다(소스 검사 테스트). 브라우저는 `points3d_paths`와 `points3d_threshold_q`만 읽는다. 등급 단어(적합·경계·보수·재시공)와 분류 비율 숫자를 화면에 만들지 않는다. 두 센티널을 화면에서 구분하지 않는다.
- 화면 문구는 스펙 §7.12 전문을 글자 그대로 쓴다(고지, 병합, M1~M10, 버튼, 묶음 이름, 범례, HUD, 조작 안내, 축 이름, 읽기 창). 사용자 대면 문자열에 U+2014(—)를 쓰지 않는다. 음수 부호는 U+2212(−). 탭 이름·순서는 그대로(`['히트맵', '정밀 편차맵', '3D 프리뷰', '현장 사진']`). 버튼은 전부 `Button`의 `normal`(뷰당 primary 1개 규칙). 공용 `Button`·`Spinner`는 고치지 않는다. 선택 배경은 `className="aria-pressed:bg-cs-info-bg"`.
- 조용한 실패 금지: fetch 실패·형식 불일치·WebGL2 불가·컨텍스트 손실은 전부 화면에 사유를 드러낸다. 빈 캔버스를 내놓지 않는다. 엔진 쪽 실패는 `points3d_paths = []` + 경고로만 남고 판정 수치와 다른 산출물은 실패가 없을 때와 같아야 하며 `out_dir`에 `points3d.bin`이 남지 않는다.
- 휠 리스너는 네이티브 `canvas.addEventListener('wheel', handler, { passive: false })`로 붙인다(JSX `onWheel` 금지). `reduceControl`이 `handled === true`를 돌려준 경우에만 `preventDefault`. 일반 휠(Ctrl·Cmd 없음)은 가로채지 않는다.
- 저장소 규칙: 코드 주석은 한국어. 알고리즘·라이브러리 이름은 영어 그대로(예: cell min-hash stratified, RANSAC, WebGL2). "발주처"라는 말을 쓰지 않는다. 보고서 문서(`docs/service-report.md`)는 합니다체.
- 작업 중 금지: `.env` 값 읽기·출력, Supabase·원격 DB 접속, 로컬 5432 PostgreSQL 접촉, `과업지시서_통합본.pdf` 커밋, `data/` 커밋, 저장소 객체 삭제 코드 추가. Playwright를 쓰지 않는다. 한 작업 트리에 커밋하는 에이전트는 한 번에 하나다.
- 커밋 메시지는 저장소 관례(`feat(engine): ...`, `feat(dashboard): ...`, `docs: ...`, 한국어 본문)를 따르고 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`를 붙인다. 작업 브랜치는 `feat/pointcloud-viewer`. 이번 작업은 구현과 검증까지이고 머지·배포는 사용자가 결정한다.
- 실행 환경: 파이썬은 `D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe`(<py>, 3.14)만 쓴다(기본 `python` 3.9 금지). 엔진 `cd engine && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -q`. 워커 `cd worker && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -q`. 성능 `cd engine && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -m perf -q -s`. 대시보드 `cd dashboard && npx vitest run && npx tsc --noEmit && npx next build`. 셸은 Git Bash, 경로는 forward slash. CLI는 `PYTHONPATH=D:/Projects/Flatness/engine <py> -m flatness.cli analyze ...`로 부른다(venv에 `flatness` 스크립트 없음).
- 기준선(2026-10-02): engine 244 통과(1 deselected), worker 209 통과(2 deselected), dashboard 84파일 769건 통과. 각 태스크는 자기 스위트 전체가 통과한 뒤 커밋한다. 완료를 말하기 전에 명령을 실제로 돌려 출력을 확인하고 실패는 실패로 보고한다.
- 테스트 설계 원칙: 테스트는 실제 동작을 단언하고 변이(부호 뒤집기, 축 바꾸기, 가드 제거)를 넣으면 죽어야 한다. 새 가드를 기존 조건 앞에 세울 때 기존 가드 테스트가 하중을 잃지 않는지 픽스처를 확인한다. 기존 `test_floor_render_failure_does_not_lose_judged_result`(`test_pipeline.py:184-212`)는 고치지 않는다. 리뷰 때 스펙 §10.5 변이 표를 하나씩 넣어 대응 테스트가 죽는지 확인한다.
- 성능 게이트는 기존 그대로: 3천만 점 300초 미만, 피크 RSS 증가 2GiB 미만. 300만 점 변형도 같은 게이트. `points3d.bin` 크기 `<= 8 + 4096 + 8 × 500_000`.
- 고치지 않는 것: `supabase/migrations/001_schema.sql`, `docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md`, `docs/audit/2026-09-05-*.md`, `docs/DEPLOY.md`, `docs/SUPABASE_SETUP.md`, `worker/README.md`, 리디자인 스펙의 숫자 14(`:4`, `:6`), README의 그림 표.
- 화면 캡처 대조(§10.6)는 저장소 밖 로컬 하네스에서 한다(커밋하지 않는다). 실제 로그인·`/api/data` 302·서명 URL 경로는 지나지 않는다. 캡처하지 못한 장면은 못 했다고 보고한다.

---

### Task 1: 엔진: 점별 편차와 센티널 (`core/pointsample.py` 1/2)

**목표:** 상수 블록과, 서브셀 인덱스·ok 구역 표·점별 편차(0.1mm 정수, 센티널 2종)를 내는 순수 함수 3개가 손으로 만든 grid·zmap·residuals 위에서 독립적으로 테스트된다.

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.1 D8·D9, §2.2 E7, §4.1(상수), §4.3, §10.1(부호·센티널 구분·clip 의 함수 수준 단언), §10.5(엔진: 부호 반전, 표면 이탈 가드 제거, 센티널 교환), 부록 B 1.

**Files:**
- Create: `engine/flatness/core/pointsample.py`
- Create: `engine/tests/test_pointsample.py`
- Modify: 없음
- Test: `engine/tests/test_pointsample.py`
- 읽기만 한다(고치지 않는다): `engine/flatness/core/subcell.py:10-17`(`SubcellGrid`), `:33-34`(인덱스 식), `:50-51`(3점 미만 서브셀은 NaN), `engine/flatness/core/zones.py:12-25`(`ZoneInfo`, `ZoneMap`), `:87-103`(status 와 residuals), `engine/flatness/io/reader.py:14-18`(`CloudInfo`)

**Interfaces:**
- Consumes:
  - 기존 `flatness.core.subcell.SubcellGrid(size_m: float, origin: np.ndarray, shape: tuple, median_z: np.ndarray, counts: np.ndarray, bimodal: np.ndarray)` - shape = (ny, nx), median_z 는 float32 (ny, nx) 이고 bbox 최저 z 기준 상대 높이(m), 3점 미만 서브셀은 NaN
  - 기존 `flatness.core.zones.ZoneMap(labels: np.ndarray, zones: list)` - labels 는 int32 (ny, nx), 0 = 구역 없음. `ZoneInfo(zone_id: int, level_m: float, n_subcells: int, area_m2: float, status: str, plane_abc: tuple | None)` - status 는 "ok" | "furniture" | "ghost"
  - 기존 `build_zones(grid, levels) -> (ZoneMap, residuals)` 의 residuals: float32 (ny, nx), m 단위, + 융기 / − 침하, 값 없으면 NaN
  - 기존 `build_subcell_grid(chunks, info, scale_to_m, subcell_m=0.05) -> SubcellGrid` 의 인덱스 식(`subcell.py:33-34`): `ix = np.clip((rel_x / subcell_m).astype(np.int32), 0, nx - 1)`, `iy = np.clip((rel_y / subcell_m).astype(np.int32), 0, ny - 1)`
  - 기존 `flatness.io.reader.CloudInfo(n_points: int, bbox_min: np.ndarray, bbox_max: np.ndarray)` (테스트에서만)
- Produces:
  - `engine/flatness/core/pointsample.py` 모듈 상수(이 태스크에서 전부 정의): `MAX_POINTS = 500_000`, `OFF_SURFACE_M = 0.05`, `DEV_UNIT_M = 1e-4`, `DEV_NOT_FLOOR = -32768`, `DEV_NO_DEVIATION = -32767`, `DEV_MIN, DEV_MAX = -32766, 32767`
  - `def _subcell_index(rel_x: np.ndarray, rel_y: np.ndarray, grid: SubcellGrid) -> tuple[np.ndarray, np.ndarray]` - (ix, iy) int32. `subcell.py:33-34` 와 글자 그대로 같은 식(`grid.size_m`, `ny, nx = grid.shape`)
  - `def _ok_zone_lut(zmap: ZoneMap) -> np.ndarray` - (L,) bool, L = max(labels 최댓값, zone_id 최댓값, 0) + 1. `lut[zone_id] = (status == "ok")`, `lut[0] = False`
  - `def _deviation_q(ix: np.ndarray, iy: np.ndarray, rel_z: np.ndarray, grid: SubcellGrid, zmap: ZoneMap, residuals: np.ndarray, ok_lut: np.ndarray) -> np.ndarray` - (k,) int16. 스펙 §4.3 의사코드 그대로: on_surface = ok_lut[labels[iy, ix]] & (abs(rel_z − float64(median_z[iy, ix])) <= OFF_SURFACE_M) (NaN 비교는 False). not on_surface → DEV_NOT_FLOOR, 잔차 비유한 → DEV_NO_DEVIATION, 그 외 clip(np.rint(float64(r) * 10000.0), DEV_MIN, DEV_MAX)
  - 모듈 머리: 한국어 독스트링 + `import numpy as np` 만(이 태스크). 테스트 파일 머리: `import numpy as np`, `from flatness.core import pointsample as ps`, `from flatness.core.subcell import SubcellGrid, build_subcell_grid`, `from flatness.core.zones import ZoneInfo, ZoneMap`, `from flatness.io.reader import CloudInfo`

**배경(이 태스크만 읽는 사람을 위한 설명):**

- 엔진은 스캔 점을 5cm 격자(서브셀)로 나눠 서브셀마다 높이 중앙값 `median_z` 를 구하고(`subcell.py`), 높이가 비슷한 서브셀을 구역(zone)으로 묶어 구역마다 평면을 맞춘 뒤 서브셀별 잔차 `residuals`(m, + 융기 / − 침하)를 낸다(`zones.py`). 구역의 status 가 `"ok"` 인 것만 판정에 쓰이고, `"furniture"`(가구 상판)와 `"ghost"`(이중층)는 판정에서 빠진다.
- 3D 점군 뷰어는 원본 점마다 "그 점이 속한 서브셀의 잔차"를 색으로 칠한다. 이 태스크는 점 하나하나에 그 값을 0.1mm 단위 int16 으로 붙이는 함수를 만든다. 편차가 없는 점은 센티널 두 종류로 구분한다.

  | 기록 | 조건 | 해당하는 점 |
  |---|---|---|
  | `DEV_NOT_FLOOR`(−32768) | 서브셀이 구역 없음(라벨 0), 또는 furniture/ghost 구역, 또는 점이 서브셀 중앙값에서 5cm 넘게 벗어남 | 벽·기둥·천장·보, 가구 상판 구역, 바닥 구역 위에 떠 있는 물체, 3점 미만 서브셀의 점 |
  | `DEV_NO_DEVIATION`(−32767) | ok 구역 안이고 표면에서 5cm 이내인데 서브셀 잔차가 NaN | bimodal(쌍봉) 서브셀의 점(`zones.py:103`) |
  | 유효 편차 `[-32766, 32767]` | 그 외 | 판정에 쓰인 바닥 표면 점 |

- 이 태스크는 함수 3개와 상수만 만든다. 표본 추출(`sample_points`, `PointSample`, `_hash63`)은 다음 태스크(Task 2)가 **같은 두 파일 뒤에 이어 쓴다**. 여기서 미리 만들지 않는다. `MAX_POINTS` 는 Task 2 가 쓰지만 상수 블록은 이 태스크에서 전부 정의한다.
- 판정 경로(`subcell.py`, `zones.py`, `cells.py`, `criteria.py`)와 `pipeline.py` 는 고치지 않는다.

**함정(코드에 그대로 반영돼 있다. 구현을 바꾸지 않는다):**

1. NaN 과 범위 초과 값을 그대로 int16 으로 캐스트하면 조용히 틀린 값이 된다(50000 은 −15536 으로 감긴다). 마스킹(`np.where` 로 NaN 을 0 으로)과 clip 을 캐스트 **앞**에 두고, 센티널은 캐스트 **뒤**에 덮어쓴다.
2. 반올림은 `numpy.rint`(짝수 반올림)다. 잔차는 float32 → float64 로 올린 뒤 `10000.0` 을 곱한다(`1 / DEV_UNIT_M`).
3. 3점 미만 서브셀은 `median_z` 가 NaN 이라 `abs(rel_z − med) <= OFF_SURFACE_M` 이 False 가 되고 `DEV_NOT_FLOOR` 가 된다. NaN 중앙값을 따로 처리하지 않는다.
4. 덮어쓰는 순서: `DEV_NO_DEVIATION` 을 먼저, `DEV_NOT_FLOOR` 를 나중에 쓴다(바닥 아님이 이긴다. 스펙 §4.3 의사코드의 if 순서).
5. 테스트 픽스처는 비정방 격자(3행 × 5열)이고 서브셀마다 잔차가 다르다. `[iy, ix]` 를 `[ix, iy]` 로 쓰면 IndexError 나 값 불일치로 죽는다.

**실행 환경:**

```
<py>  = D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe   (3.14, numpy 2.4.4. 기본 python 3.9 는 쓰지 않는다)
셸    = Git Bash, 경로는 forward slash
테스트 = cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest tests/test_pointsample.py -q
```

- [ ] **Step 1: 실패하는 테스트 작성(상수 + `_subcell_index`)**

`engine/tests/test_pointsample.py` 를 새로 만든다. 전체 내용:

```python
"""3D 점군 뷰어용 점 표본(core/pointsample.py) 테스트.

손으로 만든 grid·zmap·residuals 위에서 함수를 하나씩 본다. 픽스처 격자는 비정방(3행 x 5열)이고
서브셀마다 값이 달라서 x·y 를 바꿔 쓰는 실수가 IndexError 나 값 불일치로 드러난다.
"""
import numpy as np
from flatness.core import pointsample as ps
from flatness.core.subcell import SubcellGrid, build_subcell_grid
from flatness.core.zones import ZoneInfo, ZoneMap
from flatness.io.reader import CloudInfo

NY, NX = 3, 5      # 비정방 격자(행 = y, 열 = x)
SIZE_M = 0.05      # 서브셀 변(m)


def _hand_fixture():
    """전부 ok 구역(1번)·중앙값 유한·잔차 유한인 기준 픽스처. 각 테스트가 필요한 칸만 바꿔 쓴다.

    잔차[iy, ix]   = (10 * iy + ix + 1) * 0.1mm  -> 기대 dev_q = 10 * iy + ix + 1 (칸마다 다르다)
    중앙값[iy, ix] = 0.20 + 0.01 * iy + 0.001 * ix (m)
    """
    iy, ix = np.mgrid[0:NY, 0:NX]
    residuals = ((10 * iy + ix + 1) * 1e-4).astype(np.float32)
    median_z = (0.20 + 0.01 * iy + 0.001 * ix).astype(np.float32)
    grid = SubcellGrid(size_m=SIZE_M, origin=np.zeros(2), shape=(NY, NX), median_z=median_z,
                       counts=np.full((NY, NX), 5, dtype=np.int32),
                       bimodal=np.zeros((NY, NX), dtype=bool))
    zmap = ZoneMap(labels=np.ones((NY, NX), dtype=np.int32),
                   zones=[ZoneInfo(1, 0.2, NY * NX, NY * NX * SIZE_M * SIZE_M, "ok", (0.0, 0.0, 0.2))])
    return grid, zmap, residuals


# ---- 상수 ----

def test_constants_match_file_format_contract():
    # 죽이는 변이: 두 센티널 값 교환, 유효 범위가 센티널을 침범(DEV_MIN = -32767), 단위·상한 오타
    assert ps.MAX_POINTS == 500_000
    assert ps.OFF_SURFACE_M == 0.05
    assert ps.DEV_UNIT_M == 1e-4
    assert 1.0 / ps.DEV_UNIT_M == 10000.0       # _deviation_q 가 잔차(m)에 곱하는 수
    assert ps.DEV_NOT_FLOOR == -32768
    assert ps.DEV_NO_DEVIATION == -32767
    assert (ps.DEV_MIN, ps.DEV_MAX) == (-32766, 32767)


# ---- _subcell_index ----

def test_subcell_index_truncates_and_clips_on_non_square_grid():
    # 죽이는 변이: (ix, iy) 반환 순서 뒤바꿈, nx·ny 뒤바꿈(ix 3·4 가 2 로 잘린다), clip 제거, 반올림(0.18 -> 4)
    # 값은 서브셀 경계(0.05 의 배수)를 피해 골랐다. 0.15 / 0.05 는 float 로 2.9999999999999996 이다
    grid, _, _ = _hand_fixture()
    # x / 0.05:       0.2   1.4   2.4   3.6   4.8   5.2(clip 4)  18(clip 4)  -1.2(clip 0)
    rel_x = np.array([0.01, 0.07, 0.12, 0.18, 0.24, 0.26, 0.90, -0.06])
    # y / 0.05:       0.2   1.4   2.4   3.2(clip 2)  10(clip 2)  -1.2(clip 0)  0.6   2.8
    rel_y = np.array([0.01, 0.07, 0.12, 0.16, 0.50, -0.06, 0.03, 0.14])
    ix, iy = ps._subcell_index(rel_x, rel_y, grid)
    assert ix.tolist() == [0, 1, 2, 3, 4, 4, 4, 0]
    assert iy.tolist() == [0, 1, 2, 2, 2, 0, 0, 2]
    assert ix.dtype == np.int32 and iy.dtype == np.int32


def test_subcell_index_agrees_with_build_subcell_grid():
    # 인덱스 식이 subcell.py:33-34 와 pointsample.py 두 곳에 있다. 한쪽만 바뀌면 점이 이웃 서브셀의 편차로 칠해진다.
    # 죽이는 변이: x·y 전치(counts[iy, ix] 가 IndexError), clip 제거(가장자리 점이 격자 밖), 내림 방식 변경
    # 점 간격 1/64 m 는 float 로 정확하다. x 폭 0.5m(10칸), y 폭 0.25m(5칸) -> ny != nx
    gx, gy = np.meshgrid(10.0 + np.arange(33) / 64.0, 20.0 + np.arange(17) / 64.0)
    pts = np.column_stack([gx.ravel(), gy.ravel(), np.full(gx.size, 3.0)])
    info = CloudInfo(len(pts), pts.min(axis=0), pts.max(axis=0))
    scale_to_m = 1.0
    grid = build_subcell_grid(iter([pts[:200], pts[200:]]), info, scale_to_m)
    ny, nx = grid.shape
    assert (ny, nx) == (5, 10)

    lo = info.bbox_min * scale_to_m
    p = pts.astype(np.float64) * scale_to_m
    rel_x, rel_y = p[:, 0] - lo[0], p[:, 1] - lo[1]
    # 픽스처 가드: 오른쪽·위 가장자리 점은 clip 이 없으면 격자 밖(nx, ny)으로 나간다
    assert int((rel_x / grid.size_m).max()) == nx and int((rel_y / grid.size_m).max()) == ny

    ix, iy = ps._subcell_index(rel_x, rel_y, grid)
    assert (grid.counts[iy, ix] > 0).all()                  # 점이 떨어진 서브셀은 전부 점이 든 서브셀
    counts = np.zeros(grid.shape, dtype=np.int64)
    np.add.at(counts, (iy, ix), 1)
    assert np.array_equal(counts, grid.counts)              # 서브셀별 점 수까지 같다
```

- [ ] **Step 2: 실패 확인**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: 수집 단계에서 실패한다.

```
E   ImportError: cannot import name 'pointsample' from 'flatness.core' (...\engine\flatness\core\__init__.py)
ERROR tests/test_pointsample.py
1 error in ...s
```

- [ ] **Step 3: 모듈 머리·상수·`_subcell_index` 구현**

`engine/flatness/core/pointsample.py` 를 새로 만든다. 전체 내용:

```python
"""3D 점군 뷰어용 점 표본 - 원본 스캔 점에 서브셀 편차를 붙인다(3D 점군 뷰어 스펙 §4).

편차는 점 자체의 높이가 아니라 그 점이 속한 5cm 서브셀의 잔차다(정밀 편차맵과 같은 값).
0.1mm 단위 int16 으로 기록하고, 편차가 없는 점은 센티널 두 종류로 구분한다.
센티널·단위 상수는 이 모듈이 정의하고 outputs/points3d.py 가 가져다 쓴다(core 가 outputs 를 import 하지 않는다).
판정 경로(subcell.py, zones.py, cells.py)는 이 모듈을 쓰지 않는다.
"""
import numpy as np

MAX_POINTS = 500_000          # 점 수 상한(엔진 상수)
OFF_SURFACE_M = 0.05          # 표면 이탈 판정 거리. zones.py:28 band_m 기본값과 같은 값
DEV_UNIT_M = 1e-4             # 편차 정수 1단위 = 0.1mm
DEV_NOT_FLOOR = -32768        # 센티널: 바닥 아님
DEV_NO_DEVIATION = -32767     # 센티널: 바닥 구역 안이지만 잔차 없음
DEV_MIN, DEV_MAX = -32766, 32767   # 유효 편차 범위


def _subcell_index(rel_x, rel_y, grid):
    """로컬 좌표(m, bbox_min 을 뺀 값) -> 서브셀 인덱스 (ix, iy), 둘 다 int32.

    subcell.py:33-34 와 글자 그대로 같은 식이어야 한다. 한쪽만 바뀌면 점이 이웃 서브셀의 편차로 칠해진다
    (tests/test_pointsample.py 의 test_subcell_index_agrees_with_build_subcell_grid 가 묶는다).
    """
    ny, nx = grid.shape
    ix = np.clip((rel_x / grid.size_m).astype(np.int32), 0, nx - 1)
    iy = np.clip((rel_y / grid.size_m).astype(np.int32), 0, ny - 1)
    return ix, iy
```

- [ ] **Step 4: 통과 확인**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `3 passed`

- [ ] **Step 5: 실패하는 테스트 작성(`_ok_zone_lut`)**

`engine/tests/test_pointsample.py` 끝에 빈 줄 두 개를 두고 아래를 덧붙인다(앞의 내용은 고치지 않는다).

```python
# ---- _ok_zone_lut ----

def test_ok_zone_lut_marks_only_ok_zones():
    # 죽이는 변이: status 검사 제거(구역이면 전부 True), 0번을 True 로
    labels = np.array([[0, 1, 2], [3, 3, 1]], dtype=np.int32)
    zones = [ZoneInfo(1, 0.0, 2, 0.005, "ok", (0.0, 0.0, 0.0)),
             ZoneInfo(2, 0.7, 1, 0.0025, "furniture", None),
             ZoneInfo(3, 0.0, 2, 0.005, "ghost", None)]
    lut = ps._ok_zone_lut(ZoneMap(labels, zones))
    assert lut.dtype == np.bool_
    assert lut.tolist() == [False, True, False, False]


def test_ok_zone_lut_length_covers_labels_and_zone_ids():
    # 라벨에만 있는 번호(5)와 구역 목록에만 있는 번호(7) 둘 다 조회할 수 있어야 한다(IndexError 방지)
    labels = np.array([[0, 5]], dtype=np.int32)
    lut = ps._ok_zone_lut(ZoneMap(labels, [ZoneInfo(2, 0.0, 0, 0.0, "ok", None)]))
    assert lut.tolist() == [False, False, True, False, False, False]    # 길이 6 = 라벨 최댓값 5 + 1
    lut = ps._ok_zone_lut(ZoneMap(labels, [ZoneInfo(7, 0.0, 0, 0.0, "ok", None)]))
    assert lut.tolist() == [False] * 7 + [True]                         # 길이 8 = zone_id 최댓값 7 + 1


def test_ok_zone_lut_without_zones_is_single_false():
    lut = ps._ok_zone_lut(ZoneMap(np.zeros((2, 3), dtype=np.int32), []))
    assert lut.tolist() == [False]


def test_ok_zone_lut_label_zero_is_never_ok():
    # 라벨 0 은 '구역 없음'이다. zone_id 0 인 ok 구역이 목록에 섞여 와도 0번은 False 로 남는다
    zmap = ZoneMap(np.zeros((1, 1), dtype=np.int32), [ZoneInfo(0, 0.0, 1, 0.0025, "ok", None)])
    assert ps._ok_zone_lut(zmap).tolist() == [False]
```

- [ ] **Step 6: 실패 확인**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `4 failed, 3 passed`. 실패 사유는 넷 다 `AttributeError: module 'flatness.core.pointsample' has no attribute '_ok_zone_lut'`.

- [ ] **Step 7: `_ok_zone_lut` 구현**

`engine/flatness/core/pointsample.py` 끝에 빈 줄 두 개를 두고 아래를 덧붙인다.

```python
def _ok_zone_lut(zmap):
    """라벨 번호 -> '판정에 쓰인 바닥 구역(status == "ok")인가' 조회 표, (L,) bool.

    L 은 라벨 최댓값과 zone_id 최댓값을 둘 다 덮는다(어느 라벨로 조회해도 IndexError 가 없다).
    라벨 0 은 구역 없음이라 항상 False 다.
    """
    max_id = max((z.zone_id for z in zmap.zones), default=0)
    lut = np.zeros(max(int(zmap.labels.max()), max_id, 0) + 1, dtype=bool)
    for z in zmap.zones:
        lut[z.zone_id] = z.status == "ok"
    lut[0] = False
    return lut
```

- [ ] **Step 8: 통과 확인**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `7 passed`

- [ ] **Step 9: 실패하는 테스트 작성(`_deviation_q`)**

`engine/tests/test_pointsample.py` 끝에 빈 줄 두 개를 두고 아래를 덧붙인다.

```python
# ---- _deviation_q ----

def _dev_at(grid, zmap, residuals, ix, iy, dz=0.0):
    """서브셀 (iy, ix) 의 중앙값에서 dz(m) 만큼 떨어진 높이에 놓인 점들의 dev_q."""
    ix = np.asarray(ix, dtype=np.int32)
    iy = np.asarray(iy, dtype=np.int32)
    rel_z = grid.median_z[iy, ix].astype(np.float64) + dz
    return ps._deviation_q(ix, iy, rel_z, grid, zmap, residuals, ps._ok_zone_lut(zmap))


def test_deviation_reads_the_subcell_of_each_point():
    # 15칸 전부에 점 하나씩. 칸마다 잔차가 달라서 [iy, ix] 를 [ix, iy] 로 바꾸면 죽는다(IndexError 또는 값 불일치)
    grid, zmap, residuals = _hand_fixture()
    iy, ix = [a.ravel() for a in np.mgrid[0:NY, 0:NX]]
    q = _dev_at(grid, zmap, residuals, ix, iy)
    assert q.tolist() == [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25]


def test_deviation_sign_and_unit():
    # + 융기 / - 침하, 1단위 = 0.1mm. +3.2mm -> 32, -10.5mm -> -105. 죽이는 변이: 부호 반전, 단위(x1000), 버림
    grid, zmap, residuals = _hand_fixture()
    residuals[1, 3] = 0.0032
    residuals[2, 0] = -0.0105
    residuals[0, 4] = 0.0
    q = _dev_at(grid, zmap, residuals, ix=[3, 0, 4], iy=[1, 2, 0])
    assert q.tolist() == [32, -105, 0]


def test_deviation_rounds_half_to_even():
    # 1/32 m = 312.5 단위, 3/32 m = 937.5 단위(둘 다 float32 로 정확하다). numpy.rint 는 짝수 쪽으로 간다.
    # 죽이는 변이: 반올림을 버림으로(937), 0.5 올림으로(313, -313)
    grid, zmap, residuals = _hand_fixture()
    residuals[0, 0], residuals[0, 1], residuals[0, 2] = 0.03125, 0.09375, -0.03125
    q = _dev_at(grid, zmap, residuals, ix=[0, 1, 2], iy=[0, 0, 0])
    assert q.tolist() == [312, 938, -312]


def test_label_zero_is_not_floor():
    # 구역 없음(벽·기둥·저밀도). 옆 칸([1, 3], 잔차 1.4mm)은 그대로 유효하다
    grid, zmap, residuals = _hand_fixture()
    zmap.labels[1, 2] = 0
    q = _dev_at(grid, zmap, residuals, ix=[2, 3], iy=[1, 1])
    assert q.tolist() == [ps.DEV_NOT_FLOOR, 14]


def test_non_ok_zone_is_not_floor():
    # 라벨은 0 이 아닌데 status 가 ok 가 아닌 구역. '라벨 != 0' 만 보는 변이(ok_lut 조회 제거)가 죽는다
    grid, zmap, residuals = _hand_fixture()
    zmap.zones += [ZoneInfo(2, 0.9, 1, 0.0025, "furniture", None),
                   ZoneInfo(3, 0.2, 2, 0.005, "ghost", None)]
    zmap.labels[0, 1] = 2           # furniture, 잔차 유한(0.2mm)
    zmap.labels[2, 3] = 3           # ghost, 잔차 유한(2.4mm)
    zmap.labels[2, 4] = 3           # ghost, 잔차 NaN(build_zones 가 실제로 내는 모양)
    residuals[2, 4] = np.nan
    q = _dev_at(grid, zmap, residuals, ix=[1, 3, 4, 0], iy=[0, 2, 2, 0])
    assert q.tolist() == [ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR, 1]


def test_off_surface_boundary_is_5cm_on_both_sides():
    # 같은 서브셀(잔차 1.3mm)의 점 다섯 개. 중앙값에서 4.9cm 는 표면, 5.1cm 는 이탈, 0.7m 위(가구·천장)도 이탈.
    # 죽이는 변이: 표면 이탈 가드 제거, abs 제거(아래쪽 이탈을 놓친다), 거리 상수 변경
    grid, zmap, residuals = _hand_fixture()
    dz = np.array([0.049, -0.049, 0.051, -0.051, 0.70])
    q = _dev_at(grid, zmap, residuals, ix=[2] * 5, iy=[1] * 5, dz=dz)
    assert q.tolist() == [13, 13, ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR]


def test_nan_median_is_not_floor():
    # 3점 미만 서브셀은 중앙값이 NaN 이다(subcell.py:50-51).
    # [0, 3]: 구역·잔차가 멀쩡해도 표면 판정이 False 라 바닥 아님(build_zones 가 바뀌어도 유지되는 방어)
    # [0, 4]: 현재 코드가 실제로 내는 모양(라벨 0, 중앙값 NaN, 잔차 NaN). DEV_NO_DEVIATION 이 아니다(스펙 부록 B 1)
    grid, zmap, residuals = _hand_fixture()
    grid.median_z[0, 3] = np.nan
    grid.median_z[0, 4] = np.nan
    zmap.labels[0, 4] = 0
    residuals[0, 4] = np.nan
    ix = np.array([3, 4, 2], dtype=np.int32)
    iy = np.array([0, 0, 0], dtype=np.int32)
    rel_z = np.array([0.203, 0.204, 0.202])     # [0, 2] 의 중앙값은 0.202
    with np.errstate(all="raise"):              # NaN 으로 부동소수 경고를 내는 구현이면 FloatingPointError
        q = ps._deviation_q(ix, iy, rel_z, grid, zmap, residuals, ps._ok_zone_lut(zmap))
    assert q.tolist() == [ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR, 3]


def test_non_finite_residual_on_surface_is_no_deviation():
    # bimodal 서브셀: ok 구역·표면 안인데 잔차만 NaN. 죽이는 변이: 두 센티널 뒤바꿈, isfinite -> isnan(inf 가 32767 이 된다),
    # 캐스트 앞 마스킹 제거(NaN 을 int16 으로 캐스트하면 errstate 가 FloatingPointError 를 낸다)
    grid, zmap, residuals = _hand_fixture()
    residuals[1, 0] = np.nan
    residuals[1, 1] = np.inf
    residuals[1, 2] = -np.inf
    with np.errstate(all="raise"):
        q = _dev_at(grid, zmap, residuals, ix=[0, 1, 2, 3], iy=[1, 1, 1, 1])
    assert q.tolist() == [ps.DEV_NO_DEVIATION, ps.DEV_NO_DEVIATION, ps.DEV_NO_DEVIATION, 14]


def test_not_floor_takes_precedence_over_no_deviation():
    # 잔차가 NaN 이어도 표면 이탈·구역 없음이면 DEV_NOT_FLOOR 다(센티널을 덮어쓰는 순서)
    grid, zmap, residuals = _hand_fixture()
    residuals[0, 0] = np.nan
    residuals[0, 1] = np.nan
    zmap.labels[0, 1] = 0
    q = _dev_at(grid, zmap, residuals, ix=[0, 1], iy=[0, 0], dz=np.array([0.70, 0.0]))
    assert q.tolist() == [ps.DEV_NOT_FLOOR, ps.DEV_NOT_FLOOR]


def test_clip_keeps_valid_values_apart_from_sentinels():
    # 잔차 +-5m = +-50000 단위 -> DEV_MAX / DEV_MIN. -3.2767m 와 -3.2768m 는 반올림하면 센티널 값(-32767, -32768)이라
    # clip 하한이 -32766 이어야 한다. 죽이는 변이: clip 제거(50000 이 int16 에서 -15536 으로 감긴다), 하한을 -32768 로
    grid, zmap, residuals = _hand_fixture()
    residuals[0, :] = [5.0, -5.0, -3.2767, -3.2768, 3.2766]
    q = _dev_at(grid, zmap, residuals, ix=[0, 1, 2, 3, 4], iy=[0] * 5)
    assert q.tolist() == [32767, -32766, -32766, -32766, 32766]
    assert ps.DEV_NOT_FLOOR not in q.tolist() and ps.DEV_NO_DEVIATION not in q.tolist()


def test_deviation_dtype_and_shape():
    grid, zmap, residuals = _hand_fixture()
    q = _dev_at(grid, zmap, residuals, ix=[0, 1, 2], iy=[0, 1, 2])
    assert q.dtype == np.int16 and q.shape == (3,)
    empty = _dev_at(grid, zmap, residuals, ix=[], iy=[])
    assert empty.dtype == np.int16 and empty.shape == (0,)
```

- [ ] **Step 10: 실패 확인**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `11 failed, 7 passed`. 실패 사유는 전부 `AttributeError: module 'flatness.core.pointsample' has no attribute '_deviation_q'`.

- [ ] **Step 11: `_deviation_q` 구현**

`engine/flatness/core/pointsample.py` 끝에 빈 줄 두 개를 두고 아래를 덧붙인다.

```python
def _deviation_q(ix, iy, rel_z, grid, zmap, residuals, ok_lut):
    """점별 편차 (k,) int16: 0.1mm 정수 또는 센티널(스펙 §4.3).

    ix, iy 는 _subcell_index 가 낸 서브셀 인덱스, rel_z 는 bbox 최저 z 기준 상대 높이(m, float64),
    ok_lut 는 _ok_zone_lut(zmap) 이다. 부호는 residuals 그대로(+ 융기 / - 침하).

    DEV_NOT_FLOOR    : 구역 없음(라벨 0), furniture·ghost 구역, 서브셀 중앙값에서 OFF_SURFACE_M 넘게 벗어난 점
    DEV_NO_DEVIATION : ok 구역·표면 안인데 서브셀 잔차가 유한하지 않음(bimodal 서브셀)
    """
    label = zmap.labels[iy, ix]
    med = grid.median_z[iy, ix].astype(np.float64)
    # 중앙값이 NaN(3점 미만 서브셀)이면 비교가 False 라 따로 처리하지 않아도 바닥 아님이 된다
    on_surface = ok_lut[label] & (np.abs(rel_z - med) <= OFF_SURFACE_M)
    r = residuals[iy, ix].astype(np.float64)
    finite = np.isfinite(r)
    # NaN·범위 초과 값을 그대로 int16 으로 캐스트하면 조용히 틀린 값이 된다. 마스킹과 clip 을 캐스트 앞에 둔다
    q = np.clip(np.rint(np.where(finite, r, 0.0) * 10000.0), DEV_MIN, DEV_MAX).astype(np.int16)
    q[~finite] = DEV_NO_DEVIATION
    q[~on_surface] = DEV_NOT_FLOOR      # 바닥 아님이 먼저다(잔차가 NaN 이어도)
    return q
```

- [ ] **Step 12: 통과 확인**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `18 passed`

`test_nan_median_is_not_floor` 가 `FloatingPointError: invalid value encountered in less_equal` 로 실패하면(numpy 2.4.4 에서는 나지 않는다. NaN 비교에 경고를 내는 numpy 에서만 생긴다) `on_surface = ...` 한 줄만 아래처럼 감싼다. 그 밖의 줄은 감싸지 않는다(캐스트 경고는 드러나야 한다).

```python
    with np.errstate(invalid="ignore"):
        on_surface = ok_lut[label] & (np.abs(rel_z - med) <= OFF_SURFACE_M)
```

테스트와 기대값의 근거(기대값은 구현 출력을 베낀 것이 아니라 픽스처 정의에서 손으로 계산한 값이다):

| 테스트 | 스펙 근거 | 죽이는 변이 | 기대값 계산 |
|---|---|---|---|
| `test_constants_match_file_format_contract` | §4.1, E7 | 두 센티널 값 교환, `DEV_MIN`·`DEV_MAX`·단위·상한 오타 | §4.1 상수 블록 그대로 |
| `test_subcell_index_truncates_and_clips_on_non_square_grid` | §4.2 절차 (1), §4.3 마지막 불릿 | 반환 순서 뒤바꿈, nx·ny 뒤바꿈, clip 제거, 버림 → 반올림 | 값 ÷ 0.05 를 0 쪽으로 버리고 x 는 [0, 4], y 는 [0, 2] 로 자른다(테스트 주석의 몫) |
| `test_subcell_index_agrees_with_build_subcell_grid` | §4.3 마지막 불릿, §10.1 "서브셀 인덱스 재계산"의 함수 수준 | x·y 전치, clip 제거, 내림 방식 변경, 두 곳의 식이 어긋남 | 기대값은 독립 구현인 `build_subcell_grid` 의 `counts`. 0.5 ÷ 0.05 = 10칸, 0.25 ÷ 0.05 = 5칸 |
| `test_ok_zone_lut_marks_only_ok_zones` | §4.3 `ok_zone` | status 검사 제거 | 1 = ok, 2 = furniture, 3 = ghost, 0 = 구역 없음 |
| `test_ok_zone_lut_length_covers_labels_and_zone_ids` | Interfaces 의 L 정의 | 길이를 라벨에서만 / zone_id 에서만 유도 | max(5, 2) + 1 = 6, max(5, 7) + 1 = 8 |
| `test_ok_zone_lut_without_zones_is_single_false` | L 정의의 `, 0` | 구역 목록이 비었을 때 `max()` 예외 | max(0, 0, 0) + 1 = 1 |
| `test_ok_zone_lut_label_zero_is_never_ok` | `lut[0] = False` | 그 줄 제거 | 0번은 항상 False |
| `test_deviation_reads_the_subcell_of_each_point` | D8 | labels·median·residuals 인덱스 전치, 부호 반전, 단위 | 잔차[iy, ix] = (10·iy + ix + 1) × 0.1mm |
| `test_deviation_sign_and_unit` | §10.1 부호, §10.5 부호 반전 | 부호 반전, 단위, 버림 | 0.0032 ÷ 0.0001 = 32, −0.0105 ÷ 0.0001 = −105 |
| `test_deviation_rounds_half_to_even` | §4.3 `rint` | 버림, 0.5 올림 | 1/32 × 10000 = 312.5 → 312, 3/32 × 10000 = 937.5 → 938, −312.5 → −312 |
| `test_label_zero_is_not_floor` | §4.3 표 1행 | 센티널 대입 교환, labels 전치 | [1, 3] = 10 + 3 + 1 = 14 |
| `test_non_ok_zone_is_not_floor` | §4.3 표 1행, D9 | ok 구역 검사 제거(`label != 0` 만), lut 의 status 검사 제거, 덮어쓰기 순서 뒤바꿈 | [0, 0] = 1 |
| `test_off_surface_boundary_is_5cm_on_both_sides` | §4.3, D9, §10.5 표면 이탈 가드 제거 | 표면 이탈 가드 제거, abs 제거, 거리 상수 변경 | [1, 2] = 10 + 2 + 1 = 13. 0.049 <= 0.05 < 0.051 |
| `test_nan_median_is_not_floor` | §4.3 둘째 불릿, 부록 B 1 | 표면 판정을 ok_lut 만으로 함, NaN 을 그대로 캐스트 | [0, 2] = 3 |
| `test_non_finite_residual_on_surface_is_no_deviation` | §4.3 표 2행, §10.1 센티널 구분, §10.5 센티널 교환 | 센티널 대입 교환, `isfinite` → `~isnan`, 캐스트 앞 마스킹 제거, `DEV_NO_DEVIATION` 대입 제거 | [1, 3] = 14 |
| `test_not_floor_takes_precedence_over_no_deviation` | §4.3 의사코드의 if 순서 | 덮어쓰기 순서 뒤바꿈, 표면 이탈 가드 제거 | 둘 다 `DEV_NOT_FLOOR` |
| `test_clip_keeps_valid_values_apart_from_sentinels` | §10.1 clip | clip 제거, clip 하한을 −32768 / −32767 로 | 50000 → 32767, −50000 → −32766, −32767 → −32766, −32768 → −32766, 32766 → 32766 |
| `test_deviation_dtype_and_shape` | Interfaces 의 반환 dtype | int16 → int32 | (3,), (0,) |

- [ ] **Step 13: 변이 확인(테스트가 실제로 회귀를 잡는지)**

`engine/flatness/core/pointsample.py` 에 아래 변이를 **한 번에 하나씩** 넣고 Step 12 의 명령을 돌려 적힌 테스트가 실패하는지 본 뒤 **즉시 되돌린다**. 하나라도 실패하지 않으면 테스트가 하중을 지지 않는 것이므로 멈추고 보고한다.

| # | 변이(한 줄만 바꾼다) | 실패해야 하는 테스트(최소) |
|---|---|---|
| 1 | `np.where(finite, r, 0.0) * 10000.0` → `* -10000.0` (dev_q 부호 반전) | `test_deviation_sign_and_unit`, `test_deviation_reads_the_subcell_of_each_point` |
| 2 | `_subcell_index` 의 `return ix, iy` → `return iy, ix` (ix·iy 전치) | `test_subcell_index_truncates_and_clips_on_non_square_grid`, `test_subcell_index_agrees_with_build_subcell_grid` |
| 3 | `residuals[iy, ix]` → `residuals[ix, iy]` (편차 조회 전치) | `test_deviation_reads_the_subcell_of_each_point` |
| 4 | `on_surface = ok_lut[label] & (np.abs(rel_z - med) <= OFF_SURFACE_M)` → `on_surface = ok_lut[label]` (표면 이탈 가드 제거) | `test_off_surface_boundary_is_5cm_on_both_sides`, `test_nan_median_is_not_floor`, `test_not_floor_takes_precedence_over_no_deviation` |
| 5 | 상수 두 줄의 값을 맞바꾼다: `DEV_NOT_FLOOR = -32767`, `DEV_NO_DEVIATION = -32768` (센티널 값 교환) | `test_constants_match_file_format_contract` |
| 6 | `q[~finite] = DEV_NOT_FLOOR`, `q[~on_surface] = DEV_NO_DEVIATION` (센티널 대입 교환) | `test_non_finite_residual_on_surface_is_no_deviation`, `test_label_zero_is_not_floor`, `test_off_surface_boundary_is_5cm_on_both_sides` |
| 7 | `np.clip(np.rint(...), DEV_MIN, DEV_MAX)` → `np.rint(...)` (clip 제거) | `test_clip_keeps_valid_values_apart_from_sentinels` |
| 8 | `on_surface = ok_lut[label] & ...` → `on_surface = (label != 0) & ...` (ok 구역 검사 제거) | `test_non_ok_zone_is_not_floor` |
| 9 | `np.where(finite, r, 0.0)` → `r` (캐스트 앞 마스킹 제거) | `test_non_finite_residual_on_surface_is_no_deviation` (FloatingPointError) |
| 10 | `q[~finite] = ...` 줄과 `q[~on_surface] = ...` 줄의 순서를 맞바꾼다 | `test_not_floor_takes_precedence_over_no_deviation`, `test_non_ok_zone_is_not_floor` |

전부 되돌린 뒤 Step 12 의 명령을 다시 돌린다. Expected: `18 passed`. 파일이 Step 3·7·11 의 코드와 같은지 눈으로 한 번 더 확인한다(새 파일이라 `git diff` 로는 보이지 않는다).

- [ ] **Step 14: 엔진 전체 스위트와 금지 문자 검사**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q`

Expected: `262 passed, 1 deselected` (기준선 244 + 신규 18. 2~3분 걸린다)

Run: `cd D:/Projects/Flatness/engine && grep -c $'\xe2\x80\x94' flatness/core/pointsample.py tests/test_pointsample.py; grep -c $'\xeb\xb0\x9c\xec\xa3\xbc\xec\xb2\x98' flatness/core/pointsample.py tests/test_pointsample.py; cd D:/Projects/Flatness && git status --short`

첫 grep 은 U+2014, 둘째 grep 은 저장소 금지어(Global Constraints 의 저장소 규칙)를 UTF-8 바이트로 찾는다. 이 Git Bash 는 UTF-8 로캘이 아니라서 `$'\u2014'` 꼴은 해석되지 않고 항상 0건이 나온다(거짓 통과). 반드시 바이트 꼴로 쓴다.

Expected: 네 줄 모두 `:0`. `git status --short` 는 아래 두 줄뿐이다(다른 추적 파일이 바뀌지 않았다).

```
?? engine/flatness/core/pointsample.py
?? engine/tests/test_pointsample.py
```

- [ ] **Step 15: 커밋**

```bash
cd D:/Projects/Flatness
git branch --show-current        # feat/pointcloud-viewer 여야 한다
git add engine/flatness/core/pointsample.py engine/tests/test_pointsample.py
git commit -m "feat(engine): 3D 점군 표본의 점별 편차와 센티널 (pointsample 1/2)" -m "점 표본 추출(다음 커밋)이 쓸 상수 블록과 순수 함수 3개를 먼저 둔다.

- _subcell_index: subcell.py:33-34 와 같은 식. build_subcell_grid 의 counts 와
  서브셀별 점 수가 같은지 테스트로 묶었다(두 곳의 식이 어긋나면 죽는다)
- _ok_zone_lut: 라벨 번호 -> ok 구역 여부 조회 표
- _deviation_q: 서브셀 잔차를 0.1mm 정수 int16 으로. 구역 없음, furniture/ghost 구역,
  표면에서 5cm 넘게 벗어난 점은 DEV_NOT_FLOOR(-32768), ok 구역 표면 점인데 잔차가
  NaN 이면 DEV_NO_DEVIATION(-32767), 유효값은 [-32766, 32767] 로 clip

판정 경로(subcell.py, zones.py, cells.py)와 pipeline.py 는 고치지 않았다.
엔진 244 -> 262 passed(+18). 변이 10종(부호 반전, x/y 전치, 표면 이탈 가드 제거,
센티널 교환, clip 제거, ok 구역 검사 제거 등) 실패 재현 후 원복 확인." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

커밋 메시지의 수치(262, 변이 10종)는 Step 13·14 에서 실제로 본 값으로 적는다. 다르면 본 대로 고쳐 적는다.

---
### Task 2: 엔진: 표본 추출 `sample_points` (`core/pointsample.py` 2/2)

**목표:** `sample_points`가 칸별 min-hash 층화 추출로 `PointSample`을 내고, 상한·청크 크기 불변·점 순서 불변·동률 처리·해시 순서·잡점 방어가 합성 픽스처로 검증된다(스펙 §10.1 test_pointsample 표 15행 전부).

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.1 D1·D11, §2.2 E1~E6, §4.1(`PointSample`, `sample_points`), §4.2, §10.1(test_pointsample 표 전체), §10.5(엔진 표본 관련 변이 7종), §11(엔진 상주 메모리), 부록 B 2·5.

**Files:**
- Create: 없음
- Modify: `engine/flatness/core/pointsample.py` (Task 1 이 만든 파일, 63줄). `:8` 의 `import numpy as np` 위에 import 2줄과 빈 줄을 더하고(Step 8), 마지막 줄 `:63`(`_deviation_q` 의 `return q`) 뒤에 이어 쓴다(Step 4, Step 8). Task 1 이 쓴 줄은 고치지 않는다.
- Modify: `engine/tests/test_pointsample.py` (Task 1 이 만든 파일, 241줄). import 블록 `:6-10` 의 마지막 줄 아래에 7줄을 더하고(Step 2), 마지막 줄 `:241` 뒤에 이어 쓴다(Step 2, Step 6). Task 1 의 테스트와 헬퍼(`_hand_fixture`, `_dev_at`, `NY`, `NX`, `SIZE_M`)는 고치지 않는다.
- Test: `engine/tests/test_pointsample.py`
- 읽기만 한다(고치지 않는다): `engine/flatness/core/subcell.py:20-36`(`build_subcell_grid` 의 좌표 처리와 인덱스 식), `engine/flatness/core/zones.py:28-104`(`build_zones`), `engine/flatness/core/levels.py`(`detect_levels`), `engine/flatness/io/reader.py:14-37`(`CloudInfo`, `iter_chunks`, `read_info`), `engine/tests/fixtures/synthetic.py:5-14, 76-82`(`flat_floor`, `add_bump`)

줄 번호는 Task 1 을 계획대로 커밋한 직후 기준이다. Step 1 에서 실제 값을 확인하고, 다르면 줄 번호가 아니라 인용한 줄의 글자를 기준으로 삼는다.

**Interfaces:**
- Consumes:
  - T1: 상수 `MAX_POINTS`, `OFF_SURFACE_M`, `DEV_NOT_FLOOR`, `DEV_NO_DEVIATION`, `DEV_MIN`, `DEV_MAX`
  - T1: `_subcell_index(rel_x: np.ndarray, rel_y: np.ndarray, grid: SubcellGrid) -> tuple[np.ndarray, np.ndarray]`
  - T1: `_ok_zone_lut(zmap: ZoneMap) -> np.ndarray`
  - T1: `_deviation_q(ix: np.ndarray, iy: np.ndarray, rel_z: np.ndarray, grid: SubcellGrid, zmap: ZoneMap, residuals: np.ndarray, ok_lut: np.ndarray) -> np.ndarray` (int16)
  - 기존 `flatness.io.reader.CloudInfo(n_points: int, bbox_min: np.ndarray, bbox_max: np.ndarray)` (스케일 전 리더 좌표의 min/max, float64), `iter_chunks(path, chunk_size=2_000_000)` 는 (k, 3) float64 청크를 낸다
  - 기존 `build_subcell_grid(chunks, info, scale_to_m, subcell_m=0.05)`, `flatness.core.levels.detect_levels(median_z)`, `flatness.core.zones.build_zones(grid, levels) -> (ZoneMap, residuals)`
  - 기존 픽스처 `tests.fixtures.synthetic`: `flat_floor(size=(6.0, 6.0), spacing=0.02, noise_sd=0.0, tilt=(0.0, 0.0), seed=0)`, `add_bump(pts, center, radius, height)`, `add_step(pts, x_split, height)`(이 태스크는 `add_step` 을 쓰지 않는다)
- Produces:
  - `@dataclass class PointSample: xyz_local: np.ndarray  # (n, 3) float64, info.bbox_min * scale_to_m 를 뺀 로컬 좌표(m), 해시 순; dev_q: np.ndarray  # (n,) int16; origin_abs: np.ndarray  # (3,) float64 = info.bbox_min * scale_to_m; sample_cell_m: float; source_points: int; cap: int`
  - `def _hash63(chunk: np.ndarray) -> np.ndarray` - 입력 (k, 3) float64(scale_to_m 을 곱하기 전 리더 좌표), 출력 (k,) uint64 의 63비트 값. 스펙 §4.2 의 mix 정의 그대로(상수 0xBF58476D1CE4E5B9, 0x94D049BB133111EB, 0x9E3779B97F4A7C15, 0xC2B2AE3D27D4EB4F, 0x165667B19E3779F9). 모듈 수준 함수이며 `sample_points` 는 호출 시점에 모듈 전역에서 이름을 찾는다(monkeypatch 가능해야 한다)
  - `def sample_points(chunks: Iterable[np.ndarray], info: CloudInfo, scale_to_m: float, grid: SubcellGrid, zmap: ZoneMap, residuals: np.ndarray, max_points: int = MAX_POINTS) -> PointSample`
  - 성질(T3·T4 가 기댄다): `len(xyz_local) <= max_points`, 출력 순서는 (hash63, rel.x, rel.y, rel.z) 오름차순, `cap == max_points`, `source_points` = 읽은 원본 점 수, 점이 든 서브셀이 0개면 ValueError
  - 표기 메모: 이 모듈은 Task 1 과 같이 `CloudInfo`·`SubcellGrid`·`ZoneMap` 을 import 하지 않는다(모듈이 import 하는 것은 `numpy`, `dataclass`, `Iterable` 뿐). 그래서 구현 코드의 `info`, `grid`, `zmap` 인자에는 타입 표기를 달지 않고 독스트링에 적는다. 인자 이름·순서·기본값은 위와 글자 그대로 같다.
  - 모듈 안에서만 쓰는 것(뒤 태스크가 기대지 않는다): `_mix(v)`, `_cell_winners(cell, key, rel)`, 상수 `_MIX_MUL_1`, `_MIX_MUL_2`, `_ADD_X`, `_ADD_Y`, `_ADD_Z`, `_PENALTY_SHIFT`, `_HASH_MASK`

**배경(이 태스크만 읽는 사람을 위한 설명):**

- 엔진의 바닥 분석(`analyze_floor`)은 스캔 파일을 스트리밍으로 두 번 읽는다. 1번째 패스는 점 수와 bbox(`CloudInfo`), 2번째 패스는 5cm 격자(서브셀)별 높이 중앙값(`SubcellGrid`)을 만든다. 그 뒤 서브셀을 구역으로 묶어 서브셀별 잔차(`residuals`)를 낸다. 원본 점은 어디에도 보관되지 않는다.
- 3D 점군 뷰어는 원본 점이 필요하다. 그래서 파일을 한 번 더 읽는 3번째 패스에서 점을 최대 50만 개 뽑는다. 이 태스크는 그 표본기 `sample_points` 를 만든다. 파이프라인에 끼우는 일(Task 4)과 파일로 쓰는 일(Task 3)은 이 태스크가 아니다. `pipeline.py` 를 고치지 않는다.
- Task 1 이 같은 파일에 만든 함수 3개를 그대로 쓴다: `_subcell_index`(점 → 서브셀 인덱스), `_ok_zone_lut`(구역 번호 → 판정에 쓰인 구역인가), `_deviation_q`(점 → 0.1mm 정수 편차 또는 센티널 `DEV_NOT_FLOOR = -32768` / `DEV_NO_DEVIATION = -32767`).
- 방식은 **칸별 min-hash 층화 추출(cell min-hash stratified)** 이다. 난수와 시드를 쓰지 않는다.

  ```
  좌표      p   = chunk.astype(float64) * scale_to_m        # m 단위 절대 좌표
            lo  = info.bbox_min * scale_to_m
            rel = p - lo                                    # 로컬 좌표(m). 이후 계산은 전부 rel 로 한다
  표본 칸   n_occ = count(grid.counts > 0)                  # 점이 하나라도 든 서브셀 수
            s     = sqrt(n_occ * size_m^2 / max_points)     # 표본 칸 변(m). 서브셀(5cm)과 다른 격자다
            NX = floor(dx / s) + 1,  NY = floor(dy / s) + 1 # dx, dy = bbox 의 x·y 범위(m)
            cx = min(int(rel.x / s), NX - 1),  cy = min(int(rel.y / s), NY - 1),  cell = cy * NX + cx
  해시      hash63 = _hash63(chunk)                         # scale_to_m 을 곱하기 전 좌표의 float64 비트로 만든다
  칸별 승자 같은 cell 안에서 (penalty, hash63, rel.x, rel.y, rel.z) 가 사전순으로 가장 작은 점 하나
            penalty = 1 (그 점의 dev_q 가 센티널일 때) / 0 (유효 편차일 때)
  출력      승자 전체를 (hash63, rel.x, rel.y, rel.z) 오름차순으로 놓고 앞 max_points 개만 남긴다
  ```

- 왜 이렇게 하는가.
  - **칸 변을 점유 면적에서 유도**: `CloudInfo` 의 bbox 는 이상치를 거르지 않은 min/max 다. bbox 면적에서 유도하면 멀리 튄 잡점 몇 개로 칸이 수십 배 커져 표본이 붕괴한다.
  - **penalty**: 한 표본 칸에 바닥 점과 그 위의 천장·가구 점이 함께 있으면, 편차를 가진 바닥 점이 항상 남아야 한다.
  - **해시가 같으면 로컬 좌표로 깬다**: 승자의 정의가 청크 경계와 점 순서에 의존하지 않게 된다. 같은 파일이면 청크 크기·점 순서가 달라도 출력 두 배열의 `tobytes()` 가 같다.
  - **출력 순서는 해시 순(penalty 없이)**: 뷰어가 앞 k 개만 그려도 고른 표본이 되고, 상한에서 자를 때 바닥 아닌 점만 잘리지 않는다.
  - **희소 state**: 승자는 "점이 든 표본 칸마다 한 행"인 배열 묶음에 담는다. `NX * NY` 길이의 밀집 배열은 만들지 않는다(잡점으로 bbox 가 커지면 그 길이가 폭증한다). 점이 든 칸 수는 상한의 약 100~160% 라서 마지막 잘라내기가 반드시 있어야 한다.

**함정(코드에 그대로 반영돼 있다. 구현을 바꾸지 않는다):**

1. `np.lexsort` 는 **마지막 키가 1순위**다. `np.lexsort((z, y, x, hash63))` 가 (hash63, x, y, z) 순 정렬이다.
2. 출력 정렬 키에 penalty 를 넣지 않는다. 칸별 승자를 고를 때만 쓴다. 구현은 penalty 와 hash63 을 uint64 하나(`penalty << 63 | hash63`)로 합쳐 들고 다니다가, 출력 직전에 `& _HASH_MASK` 로 penalty 비트를 떼어 낸다.
3. 해시 입력은 `chunk`(scale_to_m 을 곱하기 **전**)이고, 좌표 계산은 `rel`(곱한 **뒤** 원점을 뺀 값)이다. 둘을 바꾸면 mm 단위 파일에서 결과가 달라진다.
4. `_hash63` 을 `sample_points` 의 기본 인자나 지역 별칭으로 묶어 두지 않는다. 테스트가 `monkeypatch.setattr(ps, "_hash63", ...)` 로 바꿔 끼우므로 호출할 때마다 모듈 전역에서 찾아야 한다.
5. uint64 덧셈·곱셈은 **배열 연산**으로 한다(조용히 2^64 에서 감긴다). numpy 스칼라끼리 곱하면 넘침 경고가 난다.
6. 표본 칸 번호는 int64 다(`astype(np.int64)`). 서브셀 인덱스(int32)와 섞지 않는다.
7. `grid.counts > 0` 인 서브셀이 0개면 `s` 가 0 이 되어 0 나눗셈이 된다. `ValueError` 를 던진다(Task 4 의 파이프라인이 이 예외를 경고 코드로 바꿔 격리한다).
8. `_cell_winners` 는 5개 키 전체 정렬을 피한다. 칸 번호로만 정렬해 칸별 최소 키를 구하고(`np.minimum.reduceat`), 최소 키를 가진 행이 한 칸에 둘 이상일 때만 좌표를 비교한다. 결과는 5개 키 `np.lexsort` 와 같다. 계획 작성 중 3천만 점으로 잰 3번째 패스 시간이 전체 정렬 63초, 이 방식 14~21초였다(성능 게이트는 Task 4 에서 다시 잰다). 동률 경로는 `test_sample_tie_break_by_local_coordinates` 가, 빠른 경로는 나머지 테스트가 지난다.
9. 테스트 주석의 손 계산은 float 나눗셈을 그대로 따른다. 예: `1.4 / 0.05` 는 `27.999...` 라서 x = 1.4 인 점은 27번 서브셀에 든다.
10. 테스트의 순열에는 `np.random.default_rng` 를 쓴다. 난수 금지는 표본기 코드(`pointsample.py`)에만 해당한다.

**실행 환경:**

```
<py>  = D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe   (3.14, numpy 2.4.4. 기본 python 3.9 는 쓰지 않는다)
셸    = Git Bash, 경로는 forward slash
테스트 = cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest tests/test_pointsample.py -q
```

- [ ] **Step 1: 시작 상태 확인**

Run: `cd D:/Projects/Flatness && git branch --show-current && git status --short && wc -l engine/flatness/core/pointsample.py engine/tests/test_pointsample.py && grep -n "^import numpy as np" engine/flatness/core/pointsample.py && grep -n "^from flatness.io.reader import CloudInfo" engine/tests/test_pointsample.py`

Expected: 브랜치 `feat/pointcloud-viewer`, `git status --short` 출력 없음(Task 1 이 커밋돼 있다), 그리고

```
   63 engine/flatness/core/pointsample.py
  241 engine/tests/test_pointsample.py
  304 total
8:import numpy as np
10:from flatness.io.reader import CloudInfo
```

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `18 passed`

두 파일이 없거나 18건이 통과하지 않으면 Task 1 이 끝나지 않은 것이다. 멈추고 보고한다.

- [ ] **Step 2: 실패하는 테스트 작성(`_hash63`)**

(a) `engine/tests/test_pointsample.py` 의 import 블록(`:6-10`)에 줄을 더한다. 기존 5줄은 그대로 둔다.

바꾸기 전:

```python
import numpy as np
from flatness.core import pointsample as ps
from flatness.core.subcell import SubcellGrid, build_subcell_grid
from flatness.core.zones import ZoneInfo, ZoneMap
from flatness.io.reader import CloudInfo
```

바꾼 뒤:

```python
import numpy as np
from flatness.core import pointsample as ps
from flatness.core.subcell import SubcellGrid, build_subcell_grid
from flatness.core.zones import ZoneInfo, ZoneMap
from flatness.io.reader import CloudInfo
import math
import struct

import pytest
from flatness.core.levels import detect_levels
from flatness.core.zones import build_zones
from tests.fixtures.synthetic import flat_floor, add_bump
```

(b) 같은 파일 끝에 빈 줄 두 개를 두고 아래를 덧붙인다(앞의 내용은 고치지 않는다).

```python
# ---- Task 2: _hash63 (스펙 §4.2 해시) ----
# Task 2 의 헬퍼와 상수는 전부 _sp_ / _SP_ 로 시작한다(Task 1 의 것과 이름이 겹치지 않게).

_SP_MASK = (1 << 64) - 1


def _sp_mix_ref(v):
    """스펙 §4.2 의 mix 를 Python 정수로 옮긴 참조 구현(uint64 wrap 은 & 로 낸다)."""
    v ^= v >> 30
    v = (v * 0xBF58476D1CE4E5B9) & _SP_MASK
    v ^= v >> 27
    v = (v * 0x94D049BB133111EB) & _SP_MASK
    return v ^ (v >> 31)


def _sp_hash63_ref(x, y, z):
    bx, by, bz = (struct.unpack("<Q", struct.pack("<d", v))[0] for v in (x, y, z))
    h = _sp_mix_ref((bx + 0x9E3779B97F4A7C15) & _SP_MASK)
    h = _sp_mix_ref(((h ^ by) + 0xC2B2AE3D27D4EB4F) & _SP_MASK)
    h = _sp_mix_ref(((h ^ bz) + 0x165667B19E3779F9) & _SP_MASK)
    return h >> 1


def test_hash63_matches_pure_python_reference():
    # 참조 구현 자체의 닻: SplitMix64 를 시드 0 으로 돌린 첫 출력(공개된 값)
    assert _sp_mix_ref(0x9E3779B97F4A7C15) == 0xE220A8397B1DCDAF
    pts = np.array([[0.0, 0.0, 0.0],
                    [1.5, -2.25, 3.125],
                    [254012.3371, 4180044.9126, 31.4802],
                    [-0.0, 1e-300, 1e300],
                    [0.02, 0.04, 0.0]], dtype=np.float64)
    got = ps._hash63(pts)
    assert got.dtype == np.uint64 and got.shape == (5,)
    assert [int(v) for v in got] == [_sp_hash63_ref(*row) for row in pts.tolist()]
    assert int(got.max()) < (1 << 63)            # 63비트. 최상위 비트 자리는 벌점용


def test_hash63_noncontiguous_float32_and_axis_order():
    base = np.array([[1.0, 2.0, 3.0], [9.0, 9.0, 9.0], [2.0, 1.0, 3.0],
                     [9.0, 9.0, 9.0], [1.0, 2.0, 3.0]], dtype=np.float64)
    before = base.copy()
    full = ps._hash63(base)
    assert np.array_equal(base, before)                              # 입력을 바꾸지 않는다
    assert ps._hash63(base[::2]).tolist() == full[::2].tolist()      # 비연속 뷰도 같은 값
    assert ps._hash63(np.asfortranarray(base)).tolist() == full.tolist()
    assert int(full[0]) == int(full[4])                              # 같은 좌표는 위치와 무관하게 같은 해시
    assert int(full[0]) != int(full[2])                              # x 와 y 를 바꾸면 다른 해시
    f32 = np.array([[0.1, 0.2, 0.3]], dtype=np.float32)              # float32 청크는 값 그대로 float64 로 본다
    assert ps._hash63(f32).tolist() == ps._hash63(f32.astype(np.float64)).tolist()
```

- [ ] **Step 3: 실패 확인**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `2 failed, 18 passed`. 실패 사유는 둘 다 `AttributeError: module 'flatness.core.pointsample' has no attribute '_hash63'`.

- [ ] **Step 4: `_hash63` 구현**

`engine/flatness/core/pointsample.py` 끝(`_deviation_q` 의 `return q` 뒤)에 빈 줄 두 개를 두고 아래를 덧붙인다.

```python
# 해시 상수(스펙 §4.2). 전부 uint64 이고 덧셈·곱셈은 2^64 에서 감긴다(wrap)
_MIX_MUL_1 = np.uint64(0xBF58476D1CE4E5B9)
_MIX_MUL_2 = np.uint64(0x94D049BB133111EB)
_ADD_X = np.uint64(0x9E3779B97F4A7C15)
_ADD_Y = np.uint64(0xC2B2AE3D27D4EB4F)
_ADD_Z = np.uint64(0x165667B19E3779F9)


def _mix(v):
    """SplitMix64 finalizer. v 는 uint64 배열이고 새 배열을 돌려준다(입력을 바꾸지 않는다)."""
    v = v ^ (v >> np.uint64(30))
    v = v * _MIX_MUL_1
    v = v ^ (v >> np.uint64(27))
    v = v * _MIX_MUL_2
    return v ^ (v >> np.uint64(31))


def _hash63(chunk: np.ndarray) -> np.ndarray:
    """리더 좌표 (k, 3) 의 float64 비트로 만든 63비트 해시, (k,) uint64.

    입력은 scale_to_m 을 곱하기 전의 청크다. 좌표마다 mix 를 한 번씩 거치므로 float32 유래 좌표
    (하위 29비트가 0)에서도 64비트 상태가 유지된다. 점 순서·청크 경계와 무관하고 난수·시드를 쓰지 않는다.
    sample_points 는 호출할 때마다 이 이름을 모듈 전역에서 찾는다(테스트가 바꿔 끼운다).
    """
    # float64 로 맞춘 뒤 비트 그대로 uint64 로 본다(float32 청크와 비연속 뷰는 여기서 복사된다).
    # 아래 연산은 전부 새 배열을 만들므로 입력 청크는 바뀌지 않는다
    bits = np.ascontiguousarray(chunk, dtype=np.float64).view(np.uint64)
    # 배열 연산이라 넘침은 조용히 감긴다. errstate 는 넘침 경고를 켜 둔 환경에 대한 방어다
    with np.errstate(over="ignore"):
        h = _mix(bits[:, 0] + _ADD_X)
        h = _mix((h ^ bits[:, 1]) + _ADD_Y)
        h = _mix((h ^ bits[:, 2]) + _ADD_Z)
    return h >> np.uint64(1)                  # 최상위 비트 자리는 벌점에 쓴다
```

- [ ] **Step 5: 통과 확인**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `20 passed`

- [ ] **Step 6: 실패하는 테스트 작성(`sample_points`)**

`engine/tests/test_pointsample.py` 끝에 빈 줄 두 개를 두고 아래를 덧붙인다. 스펙 §10.1 표의 15행이 전부 들어 있다(대응 표는 Step 9 아래).

```python
# ---- Task 2: sample_points (스펙 §4.2, §10.1 test_pointsample 표) ----

def _sp_chunks(pts, size):
    """리더(iter_chunks) 대역: (k, 3) float64 청크를 size 점씩 낸다."""
    for i in range(0, len(pts), size):
        yield pts[i:i + size]


def _sp_scene(pts, scale=1.0):
    """합성 점 → (info, grid, zmap, residuals). analyze_floor 의 1·2번째 패스와 같은 순서."""
    info = CloudInfo(len(pts), pts.min(axis=0).astype(np.float64), pts.max(axis=0).astype(np.float64))
    grid = build_subcell_grid(_sp_chunks(pts, 200_000), info, scale_to_m=scale)
    zmap, residuals = build_zones(grid, detect_levels(grid.median_z))
    return info, grid, zmap, residuals


def _sp_run(pts, scene, chunk=200_000, scale=1.0, **kw):
    info, grid, zmap, residuals = scene
    return ps.sample_points(_sp_chunks(pts, chunk), info, scale, grid, zmap, residuals, **kw)


def _sp_same(a, b):
    """두 표본이 바이트 단위로 같은가(스펙 §4.2 결정성의 범위)."""
    return (a.xyz_local.tobytes() == b.xyz_local.tobytes()
            and a.dev_q.tobytes() == b.dev_q.tobytes())


def _sp_subcell_index(xyz_local, grid):
    """subcell.py:33-34 의 식을 테스트가 따로 다시 계산한다(pointsample 의 식을 쓰지 않는다)."""
    ny, nx = grid.shape
    ix = np.clip((xyz_local[:, 0] / 0.05).astype(np.int32), 0, nx - 1)
    iy = np.clip((xyz_local[:, 1] / 0.05).astype(np.int32), 0, ny - 1)
    return ix, iy


def _sp_small_bumpy():
    """2.0 x 1.5 m 바닥(점 간격 2cm, 101 * 76 = 7,676 점) + 깊이 8mm 함몰. 청크 7 로도 빨리 돈다."""
    return add_bump(flat_floor(size=(2.0, 1.5), spacing=0.02), (1.2, 0.5), 0.4, -0.008)


def _sp_two_rooms(offset=(0.0, 0.0, 0.0)):
    """방 A(x 0~4, y 0~3, z=0. 중심 (2.0, 1.5) 에 깊이 10mm·반경 0.4m 함몰)
    + 0.4m 빈 틈 + 방 B(x 4.4~8.4, z=+0.5). 201 * 151 * 2 = 60,702 점."""
    a = add_bump(flat_floor(size=(4.0, 3.0), spacing=0.02), (2.0, 1.5), 0.4, -0.010)
    b = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b[:, 0] += 4.4
    b[:, 2] += 0.5
    return np.vstack([a, b]) + np.asarray(offset, dtype=np.float64)


def _sp_check_two_rooms(pts, s):
    # 기본 상한(50만)에서 칸 변은 sqrt(약 24 m2 / 500000) = 약 7mm 로 점 간격 20mm 보다 작다.
    # 모든 점이 제 칸의 유일한 점이라 전 점이 남는다.
    assert len(s.xyz_local) == len(pts) == 60702
    assert s.source_points == 60702
    x, y, z = s.xyz_local.T
    r = np.hypot(x - 2.0, y - 1.5)
    valid = s.dev_q > ps.DEV_NO_DEVIATION
    flat = r > 0.5                      # 함몰(반경 0.4m) 밖. 방 B 전체가 여기에 든다
    room_b = x > 4.2
    # 편차 없는 점은 방 A 의 x = 4.0 가장자리 한 줄(서브셀당 3점 미만)뿐이다: 151 / 60702 = 0.25%
    assert valid[flat].mean() > 0.99
    assert valid[room_b].mean() > 0.99          # 방 B 가 통째로 '바닥 아님'이 되면 죽는다
    assert int(np.abs(s.dev_q[flat & valid]).max()) <= 1      # 평탄부 ±0.1mm
    # bbox 최저 z 는 함몰 바닥(-10mm)이므로 방 B(+0.5m)의 로컬 z 는 0.51
    assert float(np.abs(z[room_b] - 0.51).max()) < 1e-6
    # 함몰 핵: 중심에서 3cm 안의 점 9개(r = 0, 0.02 x4, 0.0283 x4).
    # 이 점들이 든 5cm 서브셀의 점은 전부 r < 0.03 + 0.0707 = 0.10 안이고, 코사인 범프 깊이는
    # r = 0 에서 10.0mm, r = 0.10 에서 10 * 0.5 * (1 + cos(pi * 0.1 / 0.4)) = 8.54mm 다.
    # 서브셀 중앙값은 그 사이이므로 dev_q 는 [-100, -85], RANSAC 평면 오차 ±1 을 더해 [-101, -84]
    core = r < 0.03
    assert int(core.sum()) == 9 and bool(valid[core].all())
    assert -101 <= int(s.dev_q[core].min()) and int(s.dev_q[core].max()) <= -84
    # origin_abs + xyz_local 이 원본 좌표와 0.001mm(1e-6 m) 이내. 전 점이 남았으므로 정렬해 1:1 대조한다
    back = s.origin_abs + s.xyz_local
    back = back[np.lexsort((back[:, 2], back[:, 1], back[:, 0]))]
    orig = pts[np.lexsort((pts[:, 2], pts[:, 1], pts[:, 0]))]
    assert float(np.abs(back - orig).max()) < 1e-6


def test_sample_fields_and_unit_scale():
    # mm 좌표 파일(scale_to_m = 0.001). 원점에서 떨어진 2.0 x 1.5 m 바닥
    pts_m = flat_floor(size=(2.0, 1.5), spacing=0.02)                # 101 * 76 = 7,676 점
    pts_m += np.array([10.0, 20.0, 3.0])
    pts = pts_m * 1000.0
    scene = _sp_scene(pts, scale=0.001)
    info, grid = scene[0], scene[1]
    s = _sp_run(pts, scene, scale=0.001)
    assert isinstance(s, ps.PointSample)
    # 기본 상한: 칸 변 sqrt(약 3 m2 / 500000) = 약 2.4mm < 점 간격 20mm → 전 점이 남는다
    assert s.xyz_local.dtype == np.float64 and s.xyz_local.shape == (7676, 3)
    assert s.dev_q.dtype == np.int16 and s.dev_q.shape == (7676,)
    assert s.source_points == 7676 and s.cap == ps.MAX_POINTS == 500_000
    assert s.origin_abs.dtype == np.float64
    assert np.array_equal(s.origin_abs, info.bbox_min * 0.001)       # (10, 20, 3) m
    assert np.allclose(s.origin_abs, [10.0, 20.0, 3.0], atol=1e-9)
    assert s.xyz_local.min(axis=0).tolist() == [0.0, 0.0, 0.0]       # 로컬 좌표는 0 에서 시작(m)
    assert np.allclose(s.xyz_local.max(axis=0), [2.0, 1.5, 0.0], atol=1e-9)
    n_occ = int((grid.counts > 0).sum())
    assert isinstance(s.sample_cell_m, float)
    assert s.sample_cell_m == pytest.approx(math.sqrt(n_occ * 0.05 * 0.05 / 500_000), rel=1e-12)
    # 전 점이 남으므로 출력은 원본 점 전체를 (해시, 로컬 x, y, z) 순으로 놓은 것과 바이트 단위로 같다.
    # 해시 입력은 scale_to_m 을 곱하기 전의 리더 좌표(mm)다
    rel = pts * 0.001 - info.bbox_min * 0.001
    order = np.lexsort((rel[:, 2], rel[:, 1], rel[:, 0], ps._hash63(pts)))
    assert s.xyz_local.tobytes() == rel[order].tobytes()


def test_sample_cap_truncates_to_max_points():
    pts = flat_floor(size=(2.0, 3.0), spacing=0.02)                  # 101 * 151 = 15,251 점. 세로로 긴 바닥
    scene = _sp_scene(pts)
    assert int((scene[1].counts > 0).sum()) == 2400                  # 점유 서브셀 40 * 60 → 면적 6.0 m2
    s = _sp_run(pts, scene, max_points=2000)
    # 칸 변 sqrt(6.0 / 2000) = 0.05477 m. 표본 칸 격자는
    # (floor(2 / 0.05477) + 1) * (floor(3 / 0.05477) + 1) = 37 * 55 = 2,035 칸이고 전부 점이 든다(점 간격 2cm).
    # 마지막 잘라내기가 없으면 2,035 점, 있으면 정확히 2,000 점이다
    assert s.sample_cell_m == pytest.approx(math.sqrt(6.0 / 2000), rel=1e-12)
    assert len(s.xyz_local) == 2000 and len(s.dev_q) == 2000
    assert s.cap == 2000 and s.source_points == 15251
    # 원본이 상한보다 적으면 자르지 않는다(기본 상한 50만, 칸 변 약 3.5mm < 점 간격)
    full = _sp_run(pts, scene)
    assert len(full.xyz_local) == 15251 and full.cap == ps.MAX_POINTS


def test_sample_chunk_size_invariance():
    pts = _sp_small_bumpy()
    scene = _sp_scene(pts)
    # 상한 1,500: 칸 변 sqrt(3.0 / 1500) = 0.0447 m → 45 * 34 = 1,530 칸. 칸마다 점 4~9개가 겨루고 잘라내기도 일어난다
    ref = _sp_run(pts, scene, chunk=2_000_000, max_points=1500)
    assert len(ref.xyz_local) == 1500
    assert int((ref.dev_q < -20).sum()) > 0                          # 함몰 점이 표본에 있다(편차 배열이 전부 0 이 아니다)
    for chunk in (7, 1000):
        assert _sp_same(_sp_run(pts, scene, chunk=chunk, max_points=1500), ref), chunk
    # 빈 청크가 섞여 와도 같다(리더가 0점 청크를 내도 죽지 않는다)
    info, grid, zmap, residuals = scene
    parts = iter([pts[:3000], pts[:0], pts[3000:]])
    assert _sp_same(ps.sample_points(parts, info, 1.0, grid, zmap, residuals, max_points=1500), ref)


def test_sample_point_order_invariance():
    pts = _sp_small_bumpy()
    scene = _sp_scene(pts)                                           # 같은 grid·zmap·residuals 를 준다
    ref = _sp_run(pts, scene, chunk=1000, max_points=1500)
    perm = np.random.default_rng(7).permutation(len(pts))
    assert not np.array_equal(perm, np.arange(len(pts)))
    assert _sp_same(_sp_run(pts[perm], scene, chunk=1000, max_points=1500), ref)


def test_sample_tie_break_by_local_coordinates(monkeypatch):
    # 모든 점의 해시를 0 으로 만든다. 칸별 승자와 출력 순서를 정하는 것은 로컬 좌표 사전순뿐이다
    monkeypatch.setattr(ps, "_hash63", lambda chunk: np.zeros(len(chunk), dtype=np.uint64))
    base = flat_floor(size=(2.0, 1.5), spacing=0.02)                 # 101 * 76 = 7,676 점
    base[:, 0] += 0.37 * base[:, 1]      # 전단. 한 칸 안에서 x 가 최소인 점과 y 가 최소인 점이 달라진다
    twin = base[::3].copy()
    twin[:, 2] += 0.001                  # x, y 가 같고 z 만 1mm 높은 쌍둥이 점(2,559개). z 까지 가야 동률이 깨진다
    pts = np.vstack([twin, base])        # 쌍둥이를 앞에 둔다('먼저 본 점이 이김' 구현이면 높은 z 가 남는다)
    assert pts.min(axis=0).tolist() == [0.0, 0.0, 0.0]               # bbox_min 이 0 이라 로컬 좌표 = 원본 좌표
    info = CloudInfo(len(pts), pts.min(axis=0), pts.max(axis=0))
    # grid·zmap·residuals 는 손으로 만든다: 전 서브셀이 ok 구역·중앙값 0·잔차 0 → 모든 점이 유효 편차(벌점 0).
    # 점유 서브셀은 평행사변형 넓이 3.0 m2 에 해당하는 1,200개로 둔다(칸 변을 정하는 데만 쓰인다)
    shape = (30, 52)                     # x 범위 2.0 + 0.37 * 1.5 = 2.555 m → 52열, y 1.5 m → 30행
    counts = np.zeros(shape, dtype=np.int32)
    counts[:, :40] = 6
    grid = SubcellGrid(size_m=0.05, origin=np.zeros(2), shape=shape,
                       median_z=np.zeros(shape, dtype=np.float32), counts=counts,
                       bimodal=np.zeros(shape, dtype=bool))
    zmap = ZoneMap(labels=np.ones(shape, dtype=np.int32),
                   zones=[ZoneInfo(1, 0.0, 1560, 3.9, "ok", (0.0, 0.0, 0.0))])
    scene = (info, grid, zmap, np.zeros(shape, dtype=np.float32))

    ref = _sp_run(pts, scene, chunk=2_000_000, max_points=1500)
    assert bool((ref.dev_q == 0).all())
    for chunk in (7, 1000):
        assert _sp_same(_sp_run(pts, scene, chunk=chunk, max_points=1500), ref), chunk
    perm = np.random.default_rng(11).permutation(len(pts))
    assert _sp_same(_sp_run(pts[perm], scene, chunk=1000, max_points=1500), ref)

    # 정답을 순수 Python 으로 따로 만든다: 칸마다 (x, y, z) 사전순 최소 점, 그것을 (x, y, z) 순으로 놓고 앞 1,500개
    s = ref.sample_cell_m
    assert s == pytest.approx(math.sqrt(3.0 / 1500), rel=1e-12)      # 0.0447 m
    n_x = math.floor(float(pts[:, 0].max()) / s) + 1
    n_y = math.floor(float(pts[:, 1].max()) / s) + 1
    best = {}
    for x, y, z in pts.tolist():
        cell = (min(int(x / s), n_x - 1), min(int(y / s), n_y - 1))
        if cell not in best or (x, y, z) < best[cell]:
            best[cell] = (x, y, z)
    assert len(best) > 1500                                          # 잘라내기도 일어난다
    assert ref.xyz_local.tolist() == [list(t) for t in sorted(best.values())[:1500]]


def test_sample_uneven_density_covers_every_tile():
    sparse = flat_floor(size=(1.975, 2.0), spacing=0.025)            # x 0~1.975: 80 * 81 = 6,480 점 (1,620 점/m2)
    dense = flat_floor(size=(2.0, 2.0), spacing=0.005)               # x 2~4: 401 * 401 = 160,801 점 (40,200 점/m2, 약 25배)
    dense[:, 0] += 2.0
    pts = np.vstack([sparse, dense])
    s = _sp_run(pts, _sp_scene(pts), max_points=3000)

    def tiles(xyz):                                                  # 25cm 타일 16 * 8
        tx = np.minimum((xyz[:, 0] / 0.25).astype(np.int64), 15)
        ty = np.minimum((xyz[:, 1] / 0.25).astype(np.int64), 7)
        return np.unique(ty * 16 + tx)

    assert len(tiles(pts)) == 128                                    # 원본은 타일 128개 전부에 점이 있다
    assert np.array_equal(tiles(s.xyz_local), tiles(pts))            # 표본이 0점인 타일 0개
    # 층화 추출이면 표본은 면적에 비례한다(성긴 절반이 약 50%). 밀도 비례 추출이면 6480 / 167281 = 3.9% 가 된다
    share = float((s.xyz_local[:, 0] < 1.9875).mean())
    assert 0.40 <= share <= 0.60


def test_sample_dev_matches_recomputed_subcell_index():
    # x·y 범위가 다르고(3.0 x 2.0 m, 격자 60 x 40) 대각선에서 벗어난 자리에 10mm 융기가 있어 잔차가 자리마다 다르다
    pts = add_bump(flat_floor(size=(3.0, 2.0), spacing=0.02), (2.2, 0.6), 0.5, 0.010)
    scene = _sp_scene(pts)
    grid, residuals = scene[1], scene[3]
    assert grid.shape == (40, 60)
    s = _sp_run(pts, scene)
    ix, iy = _sp_subcell_index(s.xyz_local, grid)
    valid = s.dev_q > ps.DEV_NO_DEVIATION
    assert bool(valid.all())                                         # 이 바닥에는 편차 없는 점이 없다
    expect = np.rint(residuals[iy, ix].astype(np.float64) * 10000.0).astype(np.int16)
    assert np.array_equal(s.dev_q, expect)
    # 공허하지 않다: 융기 높이 2mm 이상인 반경 0.352m 원(0.39 m2, 전체의 6.5%)의 점이 +20 이상이다. 15251 * 0.065 = 약 990
    assert int((s.dev_q >= 20).sum()) >= 500


def test_sample_points_never_fall_in_empty_subcells():
    # 좁은 방(x 0~1) + 0.4m 빈 틈 + 넓은 방(x 1.4~5.4), y 는 둘 다 0~3
    a = flat_floor(size=(1.0, 3.0), spacing=0.02)
    b = flat_floor(size=(4.0, 3.0), spacing=0.02)
    b[:, 0] += 1.4
    pts = np.vstack([a, b])
    scene = _sp_scene(pts)
    grid = scene[1]
    # 틈의 서브셀 6열(21~26번, x 1.05~1.35) * 60행 = 360개가 비어 있다.
    # x = 1.0 열은 20번, x = 1.4 열은 27번 서브셀에 든다(1.4 / 0.05 는 float 로 27.999…)
    assert int((grid.counts == 0).sum()) == 360
    s = _sp_run(pts, scene)
    assert len(s.xyz_local) == len(pts)                              # 기본 상한에서는 전 점이 남는다
    ix, iy = _sp_subcell_index(s.xyz_local, grid)
    assert bool((grid.counts[iy, ix] > 0).all())
    # x·y 열을 바꿔 저장하면 y 1.05~1.35 의 점이 틈의 빈 서브셀로 떨어진다


def test_sample_two_zones():
    pts = _sp_two_rooms()
    s = _sp_run(pts, _sp_scene(pts))
    _sp_check_two_rooms(pts, s)
    assert np.allclose(s.origin_abs, [0.0, 0.0, -0.010], atol=1e-12)


def test_sample_utm_offset():
    pts = _sp_two_rooms(offset=(254000.0, 4180000.0, 35.0))
    s = _sp_run(pts, _sp_scene(pts))
    _sp_check_two_rooms(pts, s)
    assert np.array_equal(s.origin_abs, pts.min(axis=0))
    assert float(s.origin_abs[1]) == 4180000.0


def test_sample_sign_bump_positive_dip_negative():
    pts = flat_floor(size=(3.0, 3.0), spacing=0.02)
    pts = add_bump(pts, (0.8, 0.8), 0.4, 0.008)                      # 융기 +8mm
    pts = add_bump(pts, (2.2, 2.0), 0.4, -0.008)                     # 침하 -8mm
    s = _sp_run(pts, _sp_scene(pts))
    x, y = s.xyz_local[:, 0], s.xyz_local[:, 1]
    up = np.hypot(x - 0.8, y - 0.8) < 0.03
    down = np.hypot(x - 2.2, y - 2.0) < 0.03
    assert int(up.sum()) >= 5 and int(down.sum()) >= 5
    # 정점 서브셀의 중앙값은 8.0mm 와 8 * 0.5 * (1 + cos(pi * 0.1 / 0.4)) = 6.83mm 사이 → 68~80, 평면 오차 ±1
    assert 67 <= int(s.dev_q[up].min()) and int(s.dev_q[up].max()) <= 81
    assert -81 <= int(s.dev_q[down].min()) and int(s.dev_q[down].max()) <= -67


def test_sample_off_surface_points_lose_to_floor_points():
    floor = flat_floor(size=(3.0, 3.0), spacing=0.02)                # 151 * 151 = 22,801 점, z = 0
    # 바닥 위 0.7m 의 성긴 상판(점 간격 6cm > 서브셀 5cm → 서브셀당 상판 점 최대 1개).
    # x 1.6~3.58, y 0.8~2.18. x <= 2.98 인 24열은 바닥 위에, x >= 3.04 인 10열은 바닥 밖에 있다
    tx, ty = np.meshgrid(1.6 + 0.06 * np.arange(34), 0.8 + 0.06 * np.arange(24))
    top = np.column_stack([tx.ravel(), ty.ravel(), np.full(tx.size, 0.7)])
    over_floor = top[:, 0] < 2.99
    assert int(over_floor.sum()) == 24 * 24 and int((~over_floor).sum()) == 10 * 24
    pts = np.vstack([floor, top])
    # 상한 2,500: 칸 변 약 6cm. 바닥 위의 칸에는 바닥 점 약 9개와 상판 점 약 1개가 함께 든다
    s = _sp_run(pts, _sp_scene(pts), max_points=2500)
    assert 0.055 < s.sample_cell_m < 0.065
    x, z = s.xyz_local[:, 0], s.xyz_local[:, 2]
    high = z > 0.5
    # (1) 표본에 든 상판 점은 전부 '바닥 아님'. 바닥 밖 상판 점(240개, 제 칸에 혼자)이 표본에 실제로 들어 있다
    assert int(high.sum()) >= 100
    assert bool((s.dev_q[high] == ps.DEV_NOT_FLOOR).all())
    # (2) 바닥 위에서는 상판 점이 한 개도 뽑히지 않는다. x <= 2.98 인 상판 점의 칸에는 항상 유효 편차를 가진
    #     바닥 점이 있고(바닥 점 간격 2cm < 칸 변), 벌점 때문에 바닥 점이 이긴다.
    #     벌점이 없으면 576개 칸의 약 1/10 에서 상판 점의 해시가 이긴다
    assert int((high & (x < 2.99)).sum()) == 0
    # (3) 바닥 점은 유효 편차로 남는다(상판 아래 포함)
    low_inside = (~high) & (x < 2.95)
    assert bool((s.dev_q[low_inside] > ps.DEV_NO_DEVIATION).all())
    assert int(np.abs(s.dev_q[low_inside]).max()) <= 1
    # (4) 출력 순서에는 벌점이 끼지 않는다: '바닥 아님' 점이 뒤에 몰리지 않고 해시 순으로 섞여 있다.
    #     bbox_min = (0, 0, 0), scale 1.0 이라 xyz_local 에서 해시를 다시 계산할 수 있다
    h = ps._hash63(s.xyz_local)
    assert bool((h[1:] >= h[:-1]).all())
    assert int(np.flatnonzero(high)[0]) < len(h) // 4


def test_sample_sentinels_are_distinguished():
    base = flat_floor(size=(3.0, 3.0), spacing=0.02)
    ghost = flat_floor(size=(1.0, 1.0), spacing=0.02)                # x, y 1~2 에 15mm 뜬 이중층 → bimodal 서브셀
    ghost[:, 0] += 1.0
    ghost[:, 1] += 1.0
    ghost[:, 2] += 0.015
    speck = flat_floor(size=(0.3, 0.3), spacing=0.02)                # 0.5m 떨어진 0.09 m2 조각(최소 면적 1 m2 미달) → 라벨 0
    speck[:, 0] += 3.5
    speck[:, 1] += 1.0
    speck[:, 2] += 0.3
    pts = np.vstack([base, ghost, speck])
    scene = _sp_scene(pts)
    grid, zmap = scene[1], scene[2]
    s = _sp_run(pts, scene)
    x, y = s.xyz_local[:, 0], s.xyz_local[:, 1]
    ix, iy = _sp_subcell_index(s.xyz_local, grid)
    in_ghost = (x > 1.1) & (x < 1.9) & (y > 1.1) & (y < 1.9)
    in_speck = x > 3.4
    # 픽스처 확인: 이중층 안쪽은 bimodal 이면서 ok 구역(라벨 != 0), 조각은 중앙값이 유한한데 라벨 0
    assert int(in_ghost.sum()) >= 500 and int(in_speck.sum()) >= 100
    assert bool(grid.bimodal[iy[in_ghost], ix[in_ghost]].all())
    assert bool((zmap.labels[iy[in_ghost], ix[in_ghost]] != 0).all())
    assert bool((zmap.labels[iy[in_speck], ix[in_speck]] == 0).all())
    assert bool(np.isfinite(grid.median_z[iy[in_speck], ix[in_speck]]).any())
    # 단언(값을 숫자로 적는다. 상수 두 개를 맞바꾸는 변이가 여기서 죽는다)
    assert set(s.dev_q[in_ghost].tolist()) == {-32767} == {ps.DEV_NO_DEVIATION}
    assert set(s.dev_q[in_speck].tolist()) == {-32768} == {ps.DEV_NOT_FLOOR}
    plain = (x < 0.9) & (y < 2.9)
    assert bool((s.dev_q[plain] > ps.DEV_NO_DEVIATION).all())
    assert int(np.abs(s.dev_q[plain]).max()) <= 1


def test_sample_stray_points_do_not_collapse_sample():
    floor = flat_floor(size=(4.0, 3.0), spacing=0.02)                # 201 * 151 = 30,351 점, 점유 면적 12.0 m2
    i = np.arange(30, dtype=np.float64)
    stray = np.column_stack([54.0 + 0.13 * i, 53.0 + 0.11 * i, np.zeros(30)])   # 바닥에서 50m 밖의 잡점 30개
    both = np.vstack([floor, stray])
    clean = _sp_run(floor, _sp_scene(floor), max_points=5000)
    dirty = _sp_run(both, _sp_scene(both), max_points=5000)
    # 잡점 없음: 칸 변 sqrt(12 / 5000) = 0.04899 m → 82 * 62 = 5,084 칸 → 5,000 으로 잘린다
    assert len(clean.xyz_local) == 5000
    # 잡점 있음: 점유 서브셀은 4,800 → 4,971 (잡점 30 + bbox 가 커져 x = 4.0 열과 y = 3.0 행이 제 서브셀을 얻은 141).
    # 칸 변은 sqrt(4971 / 4800) = 1.018 배일 뿐이다.
    # bbox 면적(약 58 x 56 m)에서 유도하면 칸 변이 0.8m(16배)가 되어 바닥에 30칸 남짓만 남는다
    assert dirty.sample_cell_m / clean.sample_cell_m < 1.05
    assert len(dirty.xyz_local) >= 0.95 * len(clean.xyz_local)
    on_floor = dirty.xyz_local[:, 0] < 5.0
    assert int(on_floor.sum()) >= 0.95 * len(clean.xyz_local)        # 남은 점이 잡점이 아니라 바닥 점이다


def test_sample_output_is_hash_ordered_and_prefix_is_uniform():
    # 30 x 20 m, 점 간격 2cm(1501 * 1001 = 1,502,501 점). scale_to_m = 1.0, bbox_min = (0, 0, 0) 이라
    # rel = chunk * 1.0 - 0.0 이 리더 좌표와 비트 단위로 같고, xyz_local 에서 해시를 그대로 다시 계산할 수 있다
    pts = flat_floor(size=(30.0, 20.0), spacing=0.02)
    info = CloudInfo(len(pts), np.zeros(3), pts.max(axis=0).astype(np.float64))
    # grid·zmap·residuals 는 손으로 만든다(평탄 바닥: 전 서브셀 점유, ok 구역 하나, 잔차 0)
    shape = (400, 600)
    grid = SubcellGrid(size_m=0.05, origin=np.zeros(2), shape=shape,
                       median_z=np.zeros(shape, dtype=np.float32),
                       counts=np.full(shape, 6, dtype=np.int32),
                       bimodal=np.zeros(shape, dtype=bool))
    zmap = ZoneMap(labels=np.ones(shape, dtype=np.int32),
                   zones=[ZoneInfo(1, 0.0, 240_000, 600.0, "ok", (0.0, 0.0, 0.0))])
    residuals = np.zeros(shape, dtype=np.float32)
    s = ps.sample_points(_sp_chunks(pts, 400_000), info, 1.0, grid, zmap, residuals, max_points=240_000)
    # 점유 면적 600 m2 / 240,000 → 칸 변 5cm → 601 * 401 = 241,001 칸 → 240,000 으로 잘린다
    assert len(s.xyz_local) == 240_000
    h = ps._hash63(s.xyz_local)
    assert bool((h[1:] >= h[:-1]).all())                             # 해시 값 비내림차순
    assert int(h[0]) < int(h[-1])

    def tiles(xyz):                                                  # 1m 타일 30 * 20
        tx = np.minimum(xyz[:, 0].astype(np.int64), 29)
        ty = np.minimum(xyz[:, 1].astype(np.int64), 19)
        return np.unique(ty * 30 + tx)

    # 앞 10%(24,000 점, 타일당 평균 40 점)만으로 600개 타일을 전부 덮는다.
    # 칸 번호순 출력이면 앞 10% 는 y 0~2m 의 띠라서 60개 타일만 덮는다
    assert len(tiles(s.xyz_local[:24_000])) == 600


def test_sample_clips_extreme_residuals():
    pts = flat_floor(size=(3.0, 2.0), spacing=0.02)
    info, grid, zmap, residuals = _sp_scene(pts)
    injected = residuals.copy()
    injected[:, :30] = 5.0                                           # x < 1.5: 잔차 +5m
    injected[:, 30:] = -5.0                                          # x >= 1.5: 잔차 -5m
    s = _sp_run(pts, (info, grid, zmap, injected))
    x = s.xyz_local[:, 0]
    left, right = x < 1.45, x > 1.55
    assert int(left.sum()) > 1000 and int(right.sum()) > 1000
    # clip 이 없으면 rint(50000) 이 int16 에서 -15536 으로 감긴다
    assert set(s.dev_q[left].tolist()) == {ps.DEV_MAX} == {32767}
    assert set(s.dev_q[right].tolist()) == {ps.DEV_MIN} == {-32766}
    assert ps.DEV_NOT_FLOOR not in s.dev_q.tolist() and ps.DEV_NO_DEVIATION not in s.dev_q.tolist()


def test_sample_raises_when_no_occupied_subcell():
    pts = flat_floor(size=(1.0, 1.0), spacing=0.02)
    info, grid, zmap, residuals = _sp_scene(pts)
    empty = SubcellGrid(size_m=grid.size_m, origin=grid.origin, shape=grid.shape,
                        median_z=grid.median_z, counts=np.zeros_like(grid.counts), bimodal=grid.bimodal)
    with pytest.raises(ValueError):
        ps.sample_points(_sp_chunks(pts, 1000), info, 1.0, empty, zmap, residuals)
```

- [ ] **Step 7: 실패 확인**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `17 failed, 20 passed`. 실패 사유는 전부 `AttributeError: module 'flatness.core.pointsample' has no attribute 'sample_points'`.

- [ ] **Step 8: `PointSample`·`_cell_winners`·`sample_points` 구현**

(a) `engine/flatness/core/pointsample.py` 의 import 블록(`:8`)에 두 줄을 더한다.

바꾸기 전(`:6-10`. 모듈 독스트링의 마지막 두 줄, import, 빈 줄, 첫 상수):

```python
판정 경로(subcell.py, zones.py, cells.py)는 이 모듈을 쓰지 않는다.
"""
import numpy as np

MAX_POINTS = 500_000          # 점 수 상한(엔진 상수)
```

바꾼 뒤:

```python
판정 경로(subcell.py, zones.py, cells.py)는 이 모듈을 쓰지 않는다.
"""
from dataclasses import dataclass
from typing import Iterable

import numpy as np

MAX_POINTS = 500_000          # 점 수 상한(엔진 상수)
```

(b) 같은 파일 끝(`_hash63` 의 `return h >> np.uint64(1)` 뒤)에 빈 줄 두 개를 두고 아래를 덧붙인다.

```python
@dataclass
class PointSample:
    """sample_points 의 결과. xyz_local 과 dev_q 는 같은 순서(해시 값 오름차순)다."""
    xyz_local: np.ndarray     # (n, 3) float64. info.bbox_min * scale_to_m 를 뺀 로컬 좌표(m). 해시 순
    dev_q: np.ndarray         # (n,) int16. 0.1mm 단위 편차 또는 센티널
    origin_abs: np.ndarray    # (3,) float64. info.bbox_min * scale_to_m
    sample_cell_m: float      # 표본 칸 변 s
    source_points: int        # 3번째 패스가 읽은 원본 점 수
    cap: int                  # 적용한 상한


# 칸별 승자를 고르는 정렬 키(uint64 하나) = 벌점 << 63 | hash63
_PENALTY_SHIFT = np.uint64(63)                # 정렬 키의 최상위 비트 = 벌점
_HASH_MASK = np.uint64(0x7FFFFFFFFFFFFFFF)    # 정렬 키의 아래 63비트 = hash63


def _cell_winners(cell, key, rel):
    """표본 칸마다 (key, rel.x, rel.y, rel.z) 사전순 최소인 행의 인덱스. 칸 번호 오름차순으로 돌려준다.

    key = 벌점 << 63 | hash63 이므로 key 의 대소는 (penalty, hash63) 사전순과 같다.
    5개 키 전체 정렬(np.lexsort)은 200만 점 청크에 4초쯤 든다. 그래서 칸 번호로만 정렬해 칸별 최소 키를
    구하고, 최소 키를 가진 행이 한 칸에 둘 이상일 때(동률)만 그 행들끼리 좌표를 비교한다.
    빈 배열로는 부르지 않는다(sample_points 가 빈 청크를 건너뛴다).
    """
    order = np.argsort(cell, kind="stable")
    sorted_cell = cell[order]
    sorted_key = key[order]
    start = np.flatnonzero(np.r_[True, sorted_cell[1:] != sorted_cell[:-1]])   # 칸이 바뀌는 자리
    counts = np.diff(np.r_[start, len(order)])                                 # 칸별 행 수
    key_min = np.minimum.reduceat(sorted_key, start)                           # 칸별 최소 키
    cand = order[sorted_key == np.repeat(key_min, counts)]                     # 최소 키를 가진 행(칸 번호 오름차순)
    if len(cand) == len(start):
        return cand                                                            # 칸마다 정확히 한 행. 동률 없음
    # 동률: 로컬 좌표 사전순으로 깬다. np.lexsort 는 마지막 키가 1순위다
    sub = np.lexsort((rel[cand, 2], rel[cand, 1], rel[cand, 0], cell[cand]))
    cand = cand[sub]
    cand_cell = cell[cand]
    return cand[np.r_[True, cand_cell[1:] != cand_cell[:-1]]]


def sample_points(chunks: Iterable[np.ndarray], info, scale_to_m: float, grid, zmap,
                  residuals: np.ndarray, max_points: int = MAX_POINTS) -> PointSample:
    """칸별 min-hash 층화 추출(cell min-hash stratified). 스펙 §4.2.

    chunks 는 iter_chunks 가 내는 (k, 3) float64 반복자, info 는 CloudInfo, grid 는 SubcellGrid,
    zmap·residuals 는 build_zones 의 결과다(build_subcell_grid 와 같은 인자 형태).
    xy 표본 칸마다 (penalty, hash63, rel.x, rel.y, rel.z) 사전순 최소인 원본 점 하나를 남긴다.
    같은 점 집합이면 청크 크기·점 순서와 무관하게 출력 두 배열이 바이트 단위로 같다.
    점이 든 서브셀이 하나도 없으면 ValueError.
    """
    lo = info.bbox_min * scale_to_m
    hi = info.bbox_max * scale_to_m
    # 표본 칸 변은 점유 면적에서 유도한다. bbox 면적에서 유도하면 잡점 몇 개로 표본이 붕괴한다
    n_occ = int(np.count_nonzero(grid.counts > 0))
    if n_occ == 0:
        raise ValueError("점이 든 서브셀이 없어 표본 칸 크기를 정할 수 없습니다")
    s = float(np.sqrt(n_occ * grid.size_m * grid.size_m / max_points))
    n_cx = int(np.floor((hi[0] - lo[0]) / s)) + 1
    n_cy = int(np.floor((hi[1] - lo[1]) / s)) + 1
    ok_lut = _ok_zone_lut(zmap)

    # state: 점이 든 표본 칸마다 승자 한 행만 담는 희소 표. n_cx * n_cy 길이의 배열은 만들지 않는다
    # (잡점으로 bbox 가 커지면 그 길이가 bbox 면적 / s^2 으로 폭증한다)
    st_cell = np.empty(0, dtype=np.int64)
    st_key = np.empty(0, dtype=np.uint64)
    st_rel = np.empty((0, 3), dtype=np.float64)
    st_dev = np.empty(0, dtype=np.int16)
    n_seen = 0
    for chunk in chunks:
        if len(chunk) == 0:
            continue
        # 대좌표(UTM급)에서 지터가 생기지 않게 float64 로 원점을 뺀다(subcell.py:26-27 관례)
        p = chunk.astype(np.float64) * scale_to_m
        rel = p - lo
        n_seen += len(chunk)
        # (1) 서브셀 인덱스 (2) 점별 편차·센티널
        ix, iy = _subcell_index(rel[:, 0], rel[:, 1], grid)
        dev = _deviation_q(ix, iy, rel[:, 2], grid, zmap, residuals, ok_lut)
        penalty = (dev <= DEV_NO_DEVIATION).astype(np.uint64)      # 센티널이면 1. 편차를 가진 점이 항상 이긴다
        # (3) 표본 칸 번호
        cx = np.minimum((rel[:, 0] / s).astype(np.int64), n_cx - 1)
        cy = np.minimum((rel[:, 1] / s).astype(np.int64), n_cy - 1)
        cell = cy * n_cx + cx
        # (4) 해시. 입력은 scale_to_m 을 곱하기 전의 청크다
        key = (penalty << _PENALTY_SHIFT) | _hash63(chunk)
        # (5) 청크 안에서 칸별 승자만 남긴 뒤 state 와 합쳐 다시 칸별 승자만 남긴다
        w = _cell_winners(cell, key, rel)
        all_cell = np.concatenate([st_cell, cell[w]])
        all_key = np.concatenate([st_key, key[w]])
        all_rel = np.concatenate([st_rel, rel[w]])
        all_dev = np.concatenate([st_dev, dev[w]])
        w = _cell_winners(all_cell, all_key, all_rel)
        st_cell, st_key, st_rel, st_dev = all_cell[w], all_key[w], all_rel[w], all_dev[w]

    # 출력: 승자를 (hash63, rel.x, rel.y, rel.z) 오름차순으로 놓고 앞 max_points 개만 남긴다.
    # 정렬 키에 벌점을 넣지 않는다. 해시 값만으로 정렬해야 앞쪽 일부만 취해도 바닥 점과 바닥 아닌 점이
    # 고르게 섞인 표본이 되고, 상한에서 자를 때도 한쪽만 잘리지 않는다
    hash63 = st_key & _HASH_MASK
    order = np.lexsort((st_rel[:, 2], st_rel[:, 1], st_rel[:, 0], hash63))[:max_points]
    return PointSample(xyz_local=np.ascontiguousarray(st_rel[order]),
                       dev_q=np.ascontiguousarray(st_dev[order]),
                       origin_abs=np.array(lo, dtype=np.float64),
                       sample_cell_m=s, source_points=int(n_seen), cap=int(max_points))
```

- [ ] **Step 9: 통과 확인**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `37 passed` (Task 1 의 18 + 이 태스크의 19. 4~8초)

테스트와 기대값의 근거(기대값은 구현 출력을 베낀 것이 아니라 픽스처 정의에서 손으로 계산한 값이다. 계산은 각 테스트의 주석에 적혀 있다):

| 스펙 §10.1 행 | 테스트 | 죽이는 변이 | 기대값의 근거 |
|---|---|---|---|
| 상한 | `test_sample_cap_truncates_to_max_points` | 마지막 잘라내기 제거, 칸 번호 식에서 cx·cy 뒤바꿈 | 점유 서브셀 40 × 60 = 2,400 → 6.0 m² → s = sqrt(6 / 2000) = 0.05477 → 37 × 55 = 2,035칸 → 2,000 으로 잘림. 기본 상한에서는 전 점 15,251 |
| 청크 크기 불변 | `test_sample_chunk_size_invariance` | state 병합에서 키를 보지 않음, 청크 경계에 의존하는 승자 선택, 빈 청크 가드 제거 | 청크 7 / 1,000 / 2,000,000 과 빈 청크가 섞인 입력의 두 배열이 바이트 동일. 3.0 m² / 1,500 → 45 × 34 = 1,530칸 → 1,500 |
| 점 순서 불변 | `test_sample_point_order_invariance` | 입력 순서에 의존하는 승자 선택 | 무작위 순열 입력과 바이트 동일(같은 grid·zmap·residuals) |
| 동률 처리 | `test_sample_tie_break_by_local_coordinates` | 동률 처리 제거(먼저 / 마지막에 본 행이 이김), 좌표 비교의 축 순서 바꿈 | 해시를 전부 0 으로 바꾼 상태에서 청크·순서 불변 + 순수 Python 으로 따로 만든 정답(칸마다 (x, y, z) 사전순 최소 점, (x, y, z) 순, 앞 1,500개)과 일치 |
| 불균일 밀도 | `test_sample_uneven_density_covers_every_tile` | 층화를 버린 밀도 비례 추출 | 25cm 타일 128개 전부에 표본 점. 성긴 절반의 표본 비율 40~60%(밀도 비례면 3.9%) |
| 서브셀 인덱스 재계산 | `test_sample_dev_matches_recomputed_subcell_index` | 서브셀 인덱스의 x·y 전치, dev_q 부호 반전 | 테스트가 `subcell.py:33-34` 식으로 다시 계산한 `residuals[iy, ix]` × 10000 의 rint 와 전 점 일치. +20 이상인 점 500개 이상 |
| 빈 서브셀 없음 | `test_sample_points_never_fall_in_empty_subcells` | `xyz_local` 의 x·y 열을 바꿔 저장 | 틈의 빈 서브셀 6열 × 60행 = 360개. 표본 점이 든 서브셀은 전부 `counts > 0` |
| 두 구역 | `test_sample_two_zones` | dev_q 부호 반전, 서브셀 인덱스 x·y 전치 | 평탄부 ±1, 함몰 핵 9점이 [−101, −84](서브셀 중앙값 8.54~10.0mm ± 평면 오차 1), 방 B 의 로컬 z = 0.51 |
| UTM 오프셋 | `test_sample_utm_offset` | float32 로 원점 차감 | 같은 단언 + `origin_abs + xyz_local` 이 원본과 1e-6 m 이내, `origin_abs` = 원본 최솟값 |
| 부호 | `test_sample_sign_bump_positive_dip_negative` | dev_q 부호 반전 | 정점 서브셀 중앙값 6.83~8.0mm → 융기 [67, 81], 침하 [−81, −67] |
| 표면 이탈 | `test_sample_off_surface_points_lose_to_floor_points` | 벌점 비트 제거, 표면 이탈 가드 제거, 출력 정렬 키에 벌점 포함 | 표본의 상판 점(z > 0.5)은 전부 −32768 이고 100개 이상. 바닥 위(x < 2.99)에서는 상판 점 0개(576칸에서 바닥 점이 이긴다). 출력은 해시 순 |
| 센티널 구분 | `test_sample_sentinels_are_distinguished` | 두 센티널 값 교환 | bimodal 서브셀의 표면 점 = −32767, 라벨 0(중앙값은 유한) 서브셀의 점 = −32768 |
| 잡점 bbox | `test_sample_stray_points_do_not_collapse_sample` | 칸 크기를 bbox 면적에서 유도 | 잡점 30개를 더해도 칸 변은 sqrt(4971 / 4800) = 1.018배, 표본 점 수는 95% 이상 |
| 해시 순서 | `test_sample_output_is_hash_ordered_and_prefix_is_uniform` | 출력 순서를 칸 번호순으로 | `_hash63(xyz_local)` 비내림차순. 앞 10%(24,000점)가 1m 타일 600개 전부를 덮음 |
| clip | `test_sample_clips_extreme_residuals` | clip 제거 | 잔차 +5m → 32767, −5m → −32766. 센티널 값 없음 |
| (해시 정의, §4.2) | `test_hash63_matches_pure_python_reference` | 해시 상수 오타, 좌표 순서 바꿈, 63비트로 줄이지 않음 | Python 정수로 옮긴 참조 구현과 일치. 참조 구현의 닻은 SplitMix64 시드 0 의 첫 출력 0xE220A8397B1DCDAF |
| (해시 입력의 형태) | `test_hash63_noncontiguous_float32_and_axis_order` | float64 변환 누락(float32 청크에서 예외), 입력 청크를 제자리에서 바꿈 | 비연속 뷰·Fortran 순서·float32 입력이 같은 값, 입력 불변, x·y 를 바꾸면 다른 값 |
| (필드·단위, §4.1) | `test_sample_fields_and_unit_scale` | `scale_to_m` 누락, 해시 입력을 로컬 좌표로, 필드 dtype·값 | mm 파일에서 `origin_abs` = (10, 20, 3) m, 로컬 범위 (2.0, 1.5, 0). 전 점이 남으므로 출력 = 원본을 (해시, x, y, z) 순으로 놓은 것 |
| (Produces 의 ValueError) | `test_sample_raises_when_no_occupied_subcell` | 점유 서브셀 0개 가드 제거 | `counts` 가 전부 0 이면 `ValueError` |

- [ ] **Step 10: 변이 확인(테스트가 실제로 회귀를 잡는지)**

먼저 두 파일을 스테이징한다(커밋은 Step 12 에서 한다). 그러면 변이를 넣은 뒤 `git checkout --` 한 줄로 스테이징된 내용으로 되돌릴 수 있다.

Run: `cd D:/Projects/Flatness && git add engine/flatness/core/pointsample.py engine/tests/test_pointsample.py`

`engine/flatness/core/pointsample.py` 에 아래 변이를 **한 번에 하나씩** 넣고 Step 9 의 명령을 돌려 적힌 테스트가 실패하는지 본 뒤 **즉시 되돌린다**(`cd D:/Projects/Flatness && git checkout -- engine/flatness/core/pointsample.py`). 적힌 것 말고 다른 테스트가 함께 실패해도 된다. 적힌 테스트가 하나라도 실패하지 않으면 테스트가 하중을 지지 않는 것이므로 멈추고 보고한다. 1~5, 8, 9 번이 스펙 §10.5 의 엔진 표본 관련 변이 7종이고, 23·24 번은 같은 표의 '센티널 구분'·'표면 이탈' 행을 표본 수준에서 다시 본다.

| # | 변이 | 바꾸는 곳 | 실패해야 하는 테스트(최소) |
|---|---|---|---|
| 1 | 벌점 비트 제거(§10.5) | `penalty = (dev <= DEV_NO_DEVIATION).astype(np.uint64)` → `penalty = np.zeros(len(dev), dtype=np.uint64)` | `test_sample_off_surface_points_lose_to_floor_points` |
| 2 | 출력 순서를 칸 번호순으로(§10.5) | `order = np.lexsort((st_rel[:, 2], st_rel[:, 1], st_rel[:, 0], hash63))[:max_points]` → `order = np.argsort(st_cell, kind="stable")[:max_points]` | `test_sample_output_is_hash_ordered_and_prefix_is_uniform` |
| 3 | 마지막 잘라내기 제거(§10.5) | `hash63))[:max_points]` → `hash63))` | `test_sample_cap_truncates_to_max_points` |
| 4 | 칸 크기를 bbox 면적에서 유도(§10.5) | `s = float(np.sqrt(n_occ * grid.size_m * grid.size_m / max_points))` → `s = float(np.sqrt((hi[0] - lo[0]) * (hi[1] - lo[1]) / max_points))` | `test_sample_stray_points_do_not_collapse_sample` |
| 5 | 동률 처리 제거: 마지막에 본 행이 이김(§10.5) | `sub = np.lexsort((rel[cand, 2], rel[cand, 1], rel[cand, 0], cell[cand]))` → `sub = np.lexsort((-np.arange(len(cand)), cell[cand]))` | `test_sample_tie_break_by_local_coordinates` |
| 6 | 동률 처리 제거: 먼저 본 행이 이김 | `sub = np.lexsort((rel[cand, 2], rel[cand, 1], rel[cand, 0], cell[cand]))` → `sub = np.argsort(cell[cand], kind="stable")` | `test_sample_tie_break_by_local_coordinates` |
| 7 | 동률을 (y, x, z) 순으로 깸(축 순서 바꿈) | `sub = np.lexsort((rel[cand, 2], rel[cand, 1], rel[cand, 0], cell[cand]))` → `sub = np.lexsort((rel[cand, 2], rel[cand, 0], rel[cand, 1], cell[cand]))` | `test_sample_tie_break_by_local_coordinates` |
| 8 | 서브셀 인덱스에서 x·y 전치(§10.5) | `ix, iy = _subcell_index(rel[:, 0], rel[:, 1], grid)` → `ix, iy = _subcell_index(rel[:, 1], rel[:, 0], grid)` | `test_sample_dev_matches_recomputed_subcell_index` |
| 9 | dev_q 부호 반전(§10.5) | `dev = _deviation_q(ix, iy, rel[:, 2], grid, zmap, residuals, ok_lut)` → `dev = _deviation_q(ix, iy, rel[:, 2], grid, zmap, -residuals, ok_lut)` | `test_sample_sign_bump_positive_dip_negative`, `test_sample_two_zones` |
| 10 | state 병합에서 키를 보지 않고 먼저 온 행을 남김 | `sample_points` 의 둘째 `_cell_winners` 호출 줄: `w = _cell_winners(all_cell, all_key, all_rel)` → `w = np.unique(all_cell, return_index=True)[1]` | `test_sample_chunk_size_invariance`, `test_sample_point_order_invariance` |
| 11 | 층화를 버리고 밀도 비례 추출로(칸 번호를 해시에서 만듦) | `cell = cy * n_cx + cx` → `cell = (_hash63(chunk) % np.uint64(max_points)).astype(np.int64)` | `test_sample_uneven_density_covers_every_tile` |
| 12 | 칸 번호 식에서 cx·cy 뒤바꿈 | `cell = cy * n_cx + cx` → `cell = cx * n_cx + cy` | `test_sample_cap_truncates_to_max_points` |
| 13 | 출력 정렬 키에 벌점 포함 | `hash63 = st_key & _HASH_MASK` → `hash63 = st_key` | `test_sample_off_surface_points_lose_to_floor_points` |
| 14 | 해시 입력을 scale_to_m 을 곱한 뒤의 로컬 좌표로 | `sample_points` 의 key 줄에서 `_hash63(chunk)` → `_hash63(rel)` | `test_sample_fields_and_unit_scale` |
| 15 | float32 로 원점 차감(대좌표 지터) | `p = chunk.astype(np.float64) * scale_to_m` → `p = (chunk.astype(np.float32) * np.float32(scale_to_m)).astype(np.float64)` | `test_sample_utm_offset` |
| 16 | xyz_local 의 x·y 열을 바꿔 저장 | `xyz_local=np.ascontiguousarray(st_rel[order])` → `xyz_local=np.ascontiguousarray(st_rel[order][:, [1, 0, 2]])` | `test_sample_points_never_fall_in_empty_subcells` |
| 17 | 해시에서 x·y 좌표 순서 바꿈 | `_hash63` 의 첫 두 mix 줄에서 `bits[:, 0]` 과 `bits[:, 1]` 을 맞바꾼다 | `test_hash63_matches_pure_python_reference` |
| 18 | 해시를 63비트로 줄이지 않음 | `return h >> np.uint64(1)` → `return h` | `test_hash63_matches_pure_python_reference` |
| 19 | 점유 서브셀 0개 가드 제거 | `sample_points` 의 `if n_occ == 0:` 줄과 그 아래 `raise ValueError(...)` 줄을 지운다 | `test_sample_raises_when_no_occupied_subcell` |
| 20 | 해시 입력을 float64 로 맞추지 않음 | `bits = np.ascontiguousarray(chunk, dtype=np.float64).view(np.uint64)` → `bits = np.asarray(chunk).view(np.uint64)` | `test_hash63_noncontiguous_float32_and_axis_order` |
| 21 | 해시가 입력 청크를 제자리에서 바꿈 | `h = _mix(bits[:, 0] + _ADD_X)` → `bits[:, 0] += _ADD_X; h = _mix(bits[:, 0])` | `test_hash63_noncontiguous_float32_and_axis_order` |
| 22 | 빈 청크 가드 제거 | `sample_points` 의 `if len(chunk) == 0:` 줄과 그 아래 `continue` 줄을 지운다 | `test_sample_chunk_size_invariance` |
| 23 | 두 센티널 값 교환(§10.5, Task 1 의 상수 두 줄) | Task 1 의 상수 두 줄 값을 맞바꾼다: `DEV_NOT_FLOOR = -32767`, `DEV_NO_DEVIATION = -32768` | `test_sample_sentinels_are_distinguished` |
| 24 | 표면 이탈 가드 제거(§10.5, Task 1 의 _deviation_q) | `on_surface = ok_lut[label] & (np.abs(rel_z - med) <= OFF_SURFACE_M)` → `on_surface = ok_lut[label]` | `test_sample_off_surface_points_lose_to_floor_points` |
| 25 | clip 제거(Task 1 의 _deviation_q) | `q = np.clip(np.rint(np.where(finite, r, 0.0) * 10000.0), DEV_MIN, DEV_MAX).astype(np.int16)` → `q = np.rint(np.where(finite, r, 0.0) * 10000.0).astype(np.int64).astype(np.int16)` | `test_sample_clips_extreme_residuals` |

전부 되돌린 뒤 확인한다.

Run: `cd D:/Projects/Flatness && git diff --stat && cd engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pointsample.py -q`

Expected: `git diff --stat` 출력 없음(작업 트리가 스테이징한 내용과 같다), `37 passed`.

- [ ] **Step 11: 엔진 전체 스위트와 금지 문자 검사**

Run: `cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q`

Expected: `281 passed, 1 deselected` (기준선 244 + Task 1 의 18 + 이 태스크의 19. 2분 안팎)

Run: `cd D:/Projects/Flatness/engine && grep -c $'\xe2\x80\x94' flatness/core/pointsample.py tests/test_pointsample.py; grep -c $'\xeb\xb0\x9c\xec\xa3\xbc\xec\xb2\x98' flatness/core/pointsample.py tests/test_pointsample.py; cd D:/Projects/Flatness && git status --short`

첫 grep 은 U+2014, 둘째 grep 은 저장소 금지어를 UTF-8 바이트로 찾는다(이 Git Bash 는 UTF-8 로캘이 아니라서 `$'\u2014'` 꼴은 항상 0건이 나온다. 반드시 바이트 꼴로 쓴다).

Expected: 네 줄 모두 `:0`. `git status --short` 는 아래 두 줄뿐이다(스테이징된 수정 두 건. 다른 추적 파일이 바뀌지 않았다).

```
M  engine/flatness/core/pointsample.py
M  engine/tests/test_pointsample.py
```

- [ ] **Step 12: 커밋**

```bash
cd D:/Projects/Flatness
git branch --show-current        # feat/pointcloud-viewer 여야 한다
git add engine/flatness/core/pointsample.py engine/tests/test_pointsample.py
git commit -m "feat(engine): 3D 점군 표본 추출 sample_points (pointsample 2/2)" -m "analyze_floor 의 3번째 패스가 쓸 표본기를 더한다. 칸별 min-hash 층화 추출(cell min-hash stratified)로
원본 점을 최대 MAX_POINTS(50만) 개 뽑아 PointSample 로 낸다. 난수와 시드를 쓰지 않는다.

- 표본 칸 변 s = sqrt(점유 면적 / max_points). bbox 면적이 아니라 점유 서브셀 수에서 유도해
  잡점으로 bbox 가 커져도 표본이 줄지 않는다
- 칸별 승자 = (벌점, hash63, 로컬 x, y, z) 사전순 최소. 편차를 가진 점이 항상 이기고
  해시가 같으면 좌표로 깬다. 청크 크기와 점 순서가 달라도 출력이 바이트 단위로 같다
- 출력은 해시 값 오름차순이고 앞 max_points 개만 남긴다(앞쪽 일부만 취해도 고른 표본)
- state 는 점이 든 표본 칸만 담는 희소 표다(bbox 크기의 밀집 배열을 만들지 않는다)

pipeline.py 와 판정 경로(subcell.py, zones.py, cells.py)는 고치지 않았다.
엔진 262 -> 281 passed(+19). 변이 25종(벌점 제거, 칸 번호순 출력, 잘라내기 제거,
bbox 면적 유도, 동률 처리 제거, x/y 전치, 부호 반전 등) 실패 재현 후 원복 확인." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

커밋 메시지의 수치(281, 변이 25종)는 Step 10·11 에서 실제로 본 값으로 적는다. 다르면 본 대로 고쳐 적는다.

**계획 작성 메모(구현자가 따라 할 일은 아니다. 뒤 태스크와 리뷰가 참고한다):**

- 위 코드는 계획 작성 중 저장소 밖 사본(`.superpowers/plan-drafts/pointcloud-viewer/scratch-02/`)에서 Task 1 계획의 두 파일 위에 이 문서의 코드 블록을 그대로 얹어 돌렸다. 단계별 결과: Step 1 `18 passed` → Step 3 `2 failed, 18 passed` → Step 5 `20 passed` → Step 7 `17 failed, 20 passed` → Step 9 `37 passed`. 엔진 전체 `281 passed, 1 deselected`. Step 10 의 변이 25종은 전부 적힌 테스트를 실패시켰다. (2026-10-03 에 이 문서의 코드 블록을 다시 꺼내 같은 절차로 재실행: 단계별 결과와 변이 25종 전부 같은 결과. 스크래치 사본의 엔진은 두 새 파일을 빼면 저장소 `engine/` 과 바이트 동일.)
- 3번째 패스만 떼어 잰 시간과 메모리(개발 PC, 30 × 20 m 균등 난수 바닥, float64 청크 200만 점, grid·zmap 은 손으로 만든 것): 300만 점 1.5~3.0초, 피크 RSS 증가 0.30~0.34GiB, 3천만 점 14~21초, 피크 RSS 증가 0.38~0.43GiB(같은 PC 에서 다른 작업이 함께 돌아 편차가 크다. 2026-10-03 재측정: 300만 점 3.0초·0.321GiB, 3천만 점 18.2초·0.385GiB). `_cell_winners` 를 5개 키 `np.lexsort` 전체 정렬로 짠 첫 구현은 3천만 점에 63초였다. 파이프라인 전체 게이트(300초, 2GiB)는 Task 4 의 `-m perf` 가 잰다.
- 스펙 §4.2 의 `state` 는 penalty(uint8)와 hash63(uint64)을 따로 든 표로 적혀 있다. 구현은 같은 절 끝의 허용("penalty 와 hash63 을 uint64 하나로 합쳐 …")에 따라 `penalty << 63 | hash63` 한 열로 든다. 정렬 결과는 같다.
- 청크가 하나도 오지 않았는데 `grid.counts` 에는 점이 있는 모순된 입력이면 길이 0 인 `PointSample` 이 나온다. 스펙에 없는 경우라 따로 막지 않았다(Task 3 의 작성기가 `n >= 1` 을 검사한다).

---
### Task 3: 엔진: `points3d.bin` 작성기·리더와 형식 골든 (`outputs/points3d.py`)

**Files:**
- Create: `engine/flatness/outputs/points3d.py`
- Create: `engine/tests/test_points3d.py`
- Create: `engine/tests/fixtures/points3d_golden.py`
- Create: `engine/tests/fixtures/points3d_golden.bin` (488바이트 바이너리. Step 14 의 명령이 만든다. 손으로 만들지 않는다)
- Modify: 없음 (`engine/flatness/outputs/__init__.py` 는 빈 파일 그대로, `engine/tests/fixtures/__init__.py` 도 그대로)
- Test: `engine/tests/test_points3d.py`

**Interfaces:**
- Consumes:
  - T2: `flatness.core.pointsample.PointSample` (dataclass). 필드: `xyz_local: np.ndarray`((n, 3) float64, 로컬 좌표 m), `dev_q: np.ndarray`((n,) int16, 0.1mm 정수 편차 또는 센티널), `origin_abs: np.ndarray`((3,) float64, 절대 좌표 원점 m), `sample_cell_m: float`, `source_points: int`, `cap: int`
  - T1: `flatness.core.pointsample` 의 상수 `MAX_POINTS = 500_000`, `DEV_NOT_FLOOR = -32768`, `DEV_NO_DEVIATION = -32767`, `DEV_UNIT_M = 1e-4`. 넷 다 모듈이 import 한다(`unit_mm` 은 `DEV_UNIT_M * 1000` 으로 유도한다. 이 PC 의 `<py>` 에서 `1e-4 * 1000 == 0.1` 이고 `repr` 이 `'0.1'` 이라 JSON 바이트·골든 sha256 은 리터럴 `0.1` 과 같다)
  - 의존 방향: `outputs/points3d.py` 가 `core/pointsample.py` 를 import 한다. 반대 방향 import 를 만들지 않는다. 센티널·단위 상수의 정의는 `core/pointsample.py` 한 곳이다(스펙 §4.1). 이 모듈에 같은 값의 리터럴(`0.1`, `-32768`, `-32767`)을 다시 두지 않는다. T6 의 엔진 대조 테스트(TS `DEV_UNIT_MM` vs `DEV_UNIT_M * 1000`)와 같은 한 출처가 된다
- Produces:
  - `MAGIC = b"FP3D"`, `SCHEMA_VERSION = 1`, `FILE_NAME = "points3d.bin"`
  - `def encode_points3d(sample: PointSample) -> bytes` - 스펙 §5.4 식 그대로. 검증 규칙 §5.6 작성기 1~4 위반 시 `ValueError`
  - `def write_points3d(sample: PointSample, out_path: str | os.PathLike) -> str` - blob 을 한 번에 쓰고 `Path(out_path).name` 을 반환(파이프라인에서는 `"points3d.bin"`). 쓰는 중 예외면 `Path(out_path).unlink(missing_ok=True)` 뒤 다시 던진다
  - `def read_points3d(data: bytes) -> tuple[dict, np.ndarray, np.ndarray]` - `(meta, xyz_q uint16 (n, 3), dev_q int16 (n,))`. §5.6 리더 규칙 1~7, 실패는 `ValueError("<사유>")`. 사유 문자열: `too_short`, `bad_magic`, `bad_header`, `bad_json`, `unsupported_version`, `bad_meta`, `size_mismatch`
  - `engine/tests/fixtures/points3d_golden.py`: `GOLDEN_PATH: Path`(같은 폴더의 `points3d_golden.bin`), `def golden_sample() -> PointSample`, `__main__` 이 골든을 다시 쓴다
  - 골든 표본 정의(T6 이 이 표에서 기대값을 손으로 적는다): `origin_abs = [254012.3371, 4180044.9126, 31.4802]`, 로컬 최솟값 `MN = [0.5, 0.25, 0.125]`, 범위 `EXT = [4.0, 2.5, 0.3125]`, `xyz_local = MN + Q * EXT / 65535.0`, `sample_cell_m = 0.0125`, `source_points = 12345`, `cap = 500000`, `n = 12`
  - 골든 Q(행 = 점, 열 = qx,qy,qz)와 dev: 0:(0,0,0) dev 0 / 1:(65535,65535,4096) dev 32 / 2:(258,772,1286) dev -105 / 3:(32768,16384,8192) dev 70 / 4:(1,65534,2) dev 71 / 5:(40000,20000,10000) dev -70 / 6:(12345,54321,23456) dev -71 / 7:(100,200,65535) dev -32768 / 8:(50000,60000,300) dev -32767 / 9:(65280,255,4660) dev 32767 / 10:(4660,43981,291) dev -32766 / 11:(21845,43690,13107) dev 1
  - 골든의 확인값: 패딩 전 JSON 382바이트, 패딩 2바이트, `json_len = 384`, 파일 488바이트, sha256 `b0c50d8a0f2e77e3077c6b38fb6795cc89bf321601c56fb8a3e855efbc6892d9`. 메타: `origin_m = [254012.8371, 4180045.1626, 31.6052]`, `extent_m = [4.0, 2.5, 0.3125]`, `fit_bounds = {min: [0.0, 0.0, 0.0], max: [4.0, 2.5, 0.11184863050278478]}`(7번 점이 z 최댓값을 가진 센티널이라 fit 이 전체 범위보다 작다. `0.1118...` = `23456 * 0.3125 / 65535`). `T_q = 70` 분류 수: flat 5, depression 3, protrusion 2, none 2

**이 태스크가 구현하는 형식 (스펙 `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §5. 구현 전에 §5.1~§5.6 을 읽는다)**

전부 little-endian. `n` = 점 수, `L` = `json_len`.

| 오프셋 | 길이 | 내용 |
|---|---|---|
| `[0, 4)` | 4 | magic. ASCII `FP3D` |
| `[4, 8)` | 4 | uint32 `json_len`. 공백 패딩을 포함한 JSON 영역의 바이트 수. `8 + json_len` 은 4의 배수 |
| `[8, 8+L)` | L | UTF-8 JSON 메타. 끝을 공백(`0x20`)으로 채운다 |
| `[8+L, 8+L+6n)` | 6n | `uint16 xyz[3n]`. 점마다 x, y, z 순서로 인터리브 |
| `[8+L+6n, 8+L+8n)` | 2n | `int16 dev[n]` |

메타 키는 이 순서로 정확히 10개다: `schema_version`, `n_points`, `units`, `origin_m`, `extent_m`, `deviation`, `sample_cell_m`, `fit_bounds`, `sampling`, `order`. 엔진 버전, 시드, 임계값·기준 이름·불확도, 분류 수, 파일 경로, 생성 시각은 넣지 않는다(같은 스캔이면 기준을 바꿔 재분석해도 파일이 바이트 단위로 같아야 한다).

**구현 규칙과 함정**

1. 이 모듈은 matplotlib 를 쓰지 않는다. 다른 `outputs/*.py` 처럼 `heatmap` 을 import 하지 않는다.
2. 양자화 배율 `inv = where(ext > 0, 65535.0 / ext, 0.0)` 를 그대로 쓰면 범위 0 인 축에서 0 나눗셈 경고가 난다. 안전한 분모 `np.where(ext > 0, ext, 1.0)` 로 나눈 뒤 `where` 를 건다. 퇴화 축 테스트가 경고를 예외로 바꿔 놓고 돌린다.
3. JSON 은 `json.dumps(meta, ensure_ascii=True, allow_nan=False, separators=(",", ":"))` 다. 숫자는 Python `float`·`int` 로만 넣는다(`float(v)`, `int(v)`). numpy 스칼라를 그대로 넣지 않는다. 그래야 `repr` 최단 왕복 표기(`10.0`, `0.0125`)가 플랫폼과 무관하게 같은 바이트로 나온다.
4. 상한 `n <= MAX_POINTS` 는 `sample.cap` 이 아니라 엔진 상수와 비교한다. `sample.cap` 은 메타에 기록만 한다.
5. 리더는 §5.6 표의 1~7 을 위에서부터 차례로 검사하고 처음 어긴 사유로 실패한다. `bad_meta` 의 세부 조건은 표 6행 전부다. 모르는 메타 키는 무시한다.
6. 리더는 `np.frombuffer(..., dtype="<u2")`, `dtype="<i2"` 로 엔디안을 명시한다.
7. 작성기는 `Path(out_path).write_bytes(blob)` 한 번으로 쓴다. 부분 파일 삭제 테스트가 `pathlib.Path.write_bytes` 를 '5바이트 쓰고 OSError' 로 바꿔 끼운다.
8. 골든 `.bin` 은 손으로 만들지 않는다. Step 14 의 명령으로 만든 뒤 크기 488 과 sha256 을 확인한다. 값이 다르면 구현이 §5.4 와 다른 것이므로 **테스트의 해시나 크기를 고치지 말고 구현을 고친다.**
9. 스펙이 글자로 정하지 않아 이 계획에서 정한 리더 세부(대시보드 `parsePoints3d` 가 브라우저에서 보이는 동작과 맞춘 것):
   - `NaN`, `Infinity`, `-Infinity` 토큰은 표준 JSON 이 아니므로 `bad_json` 이다(브라우저의 `JSON.parse` 가 거부한다). Python `json.loads` 는 기본으로 받아들이므로 `parse_constant` 로 막는다.
   - `1e999` 처럼 문법은 맞지만 float 로 무한대가 되는 수는 "유한수" 검사에 걸려 `bad_meta` 다.
   - `true`/`false` 는 수가 아니다(Python 에서 `bool` 이 `int` 의 하위형이라 따로 막는다). `schema_version: true` 는 `unsupported_version`, `n_points: true` 는 `bad_meta`.
   - `n_points` 는 정수값이면 된다(`12.0` 도 통과. JS 의 `Number.isInteger` 와 같다).
10. T6 가 이 테스트 파일 끝에 'TS 상수 대조' 테스트 1건을 덧붙인다. 이 태스크에서는 넣지 않는다(`dashboard/lib/domain/points3d.ts` 가 아직 없다).
11. 센티널·단위 상수(`DEV_NOT_FLOOR`, `DEV_NO_DEVIATION`, `DEV_UNIT_M`)는 `core/pointsample.py` 에서 import 만 한다(스펙 §4.1). 메타의 `unit_mm` 과 리더 `_meta_ok` 의 비교값은 둘 다 모듈 상수 `_DEV_UNIT_MM = DEV_UNIT_M * 1000` 이다. 이 모듈에 `0.1` 리터럴을 쓰지 않는다. `test_module_constants` 가 `p3.DEV_UNIT_M` 으로 import 를 확인한다.

**명령 표기**: 아래에서 `<py>` 는 `D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe` 다(3.14). 기본 `python`(3.9)은 쓰지 않는다. 셸은 Git Bash 다. 엔진 테스트는 항상 `engine` 폴더에서 `PYTHONPATH=D:/Projects/Flatness/engine` 을 붙여 돌린다.

**테스트와 죽이는 변이** (테스트 33개 함수, 수집 83건)

| 테스트 | 죽이는 변이 |
|---|---|
| `test_module_constants` | magic·파일명·버전 리터럴 변경, `DEV_UNIT_M` import 를 지우고 지역 리터럴 `0.1` 로 되돌림 |
| `test_encode_byte_layout_hand_sample` | 작성기 `'<u2'` → `'>u2'`, `'<i2'` → `'>i2'`, 인터리브 → 축별 연속 배치, 최솟값을 빼지 않음, `rint` → 내림 |
| `test_encode_pads_json_with_spaces_to_4_byte_boundary` | 패딩 제거, 공백 아닌 바이트로 채움, 필요 이상으로 채움 |
| `test_encode_meta_keys_order_and_values` | 키 추가·누락·순서 변경, 메타의 두 센티널 값 교환, 구분자에 공백, `origin_m` 에 최솟값을 더하지 않음 |
| `test_encode_meta_has_no_forbidden_keys` | 엔진 버전·시드·임계값·분류 수·경로·시각을 메타에 넣음 |
| `test_sample_cap_is_recorded_but_not_enforced` | 상한을 `sample.cap` 과 비교(작은 cap 쪽) |
| `test_fit_bounds_covers_only_points_with_deviation` | fit 을 전체 점으로 계산, 양자화 전 좌표로 계산 |
| `test_fit_bounds_falls_back_to_full_range_without_deviation` | 편차 있는 점이 없을 때 예외 또는 0 범위 |
| `test_fit_bounds_sentinel_boundary` | `dev > -32767` 을 `>=` 로 또는 `> -32766` 으로 |
| `test_degenerate_axis_encodes_zero_without_warning` | `65535.0 / ext` 를 그대로 나눔(경고), 범위 0 축에 0 이 아닌 값 |
| `test_single_point_has_zero_extent_on_all_axes` | `n = 1` 거부, 전 축 범위 0 에서 예외 |
| `test_cap_is_checked_against_engine_constant_not_sample_cap` | 상한을 `sample.cap` 과 비교(큰 cap 쪽), 상한 검사 제거 |
| `test_exactly_max_points_is_accepted` | `n > MAX_POINTS` 를 `>=` 로 |
| `test_writer_rejects_invalid_sample_and_leaves_no_file` (10건) | 검증 규칙 1·3 을 하나씩 제거, `allow_nan=False` 제거 |
| `test_write_points3d_writes_blob_and_returns_file_name` | 전체 경로 반환, 파일명 리터럴 고정 |
| `test_write_points3d_removes_partial_file_on_failure` | 실패 시 부분 파일을 남김, 예외를 삼킴 |
| `test_reader_parses_hand_built_buffer` | 리더 `'<u2'` → `'>u2'`, `'<i2'` → `'>i2'`, 본문 오프셋에서 `json_len` 누락 |
| `test_reader_accepts_bytearray_and_memoryview` | `bytes` 만 받도록 좁힘 |
| `test_reader_ignores_unknown_meta_keys` | 키 집합을 정확히 일치로 검사 |
| `test_roundtrip_restores_coordinates_within_half_quantum` | 원점을 float32 로 다룸, `rint` → 내림, dev 캐스트 오류 |
| `test_reader_reads_degenerate_axis_as_zero` | 리더가 `extent_m` 0 을 거부 |
| `test_reader_too_short` / `test_reader_bad_magic` / `test_reader_bad_header` | 해당 검사 제거(길이 조건과 4의 배수 조건을 따로 죽인다) |
| `test_reader_bad_json` (6건) | 객체 아님 검사 제거, `parse_constant` 제거 |
| `test_reader_unsupported_version` (5건) | 버전 검사 제거, `bool` 을 1 로 받아들임 |
| `test_reader_bad_meta` (32건), `test_reader_bad_meta_non_finite_number` (2건) | §5.6 표 6행의 세부 조건을 하나씩 제거 |
| `test_reader_size_mismatch` | `read_points3d` 의 `size_mismatch` 검사 제거 |
| `test_reader_reports_first_violated_rule` | 검사 순서 변경 |
| `test_golden_sample_is_deterministic` | 골든 표본에 난수 도입 |
| `test_golden_file_matches_encoder_byte_for_byte` | `'<u2'` → `'>u2'`, 패딩 제거, 인터리브 → 축별 연속 배치, 두 센티널 값 교환, 형식을 바꾸고 골든을 함께 다시 만듦(해시 리터럴이 잡는다) |
| `test_golden_file_content_by_hand` | 골든 정의 변경, 리더의 엔디안·오프셋 |

---

- [ ] **Step 1: 선행 조건 확인 (T1·T2 산출물)**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -c "from flatness.core.pointsample import PointSample, MAX_POINTS, DEV_NOT_FLOOR, DEV_NO_DEVIATION, DEV_UNIT_M; import dataclasses; print([f.name for f in dataclasses.fields(PointSample)], MAX_POINTS, DEV_NOT_FLOOR, DEV_NO_DEVIATION, DEV_UNIT_M)"
```

Expected:

```
['xyz_local', 'dev_q', 'origin_abs', 'sample_cell_m', 'source_points', 'cap'] 500000 -32768 -32767 0.0001
```

다르게 나오면 Task 1·2 가 끝나지 않은 것이다. 멈추고 보고한다.

- [ ] **Step 2: 작성기 테스트 작성 (실패하는 테스트)**

`engine/tests/test_points3d.py` 를 새로 만든다. 내용 전체:

```python
"""points3d.bin 작성기·리더 테스트 (스펙 §5, §10.1 test_points3d 표, §10.2 형식 골든).

기대값은 전부 손으로 계산한 값이다(구현 출력을 베끼지 않는다). 계산 근거는 각 테스트의 주석에 있다.
"""
import dataclasses
import hashlib
import json
import pathlib
import struct
import warnings

import numpy as np
import pytest

from flatness.core.pointsample import DEV_NO_DEVIATION, DEV_NOT_FLOOR, DEV_UNIT_M, MAX_POINTS, PointSample
from flatness.outputs import points3d as p3
from flatness.outputs.points3d import FILE_NAME, MAGIC, SCHEMA_VERSION, encode_points3d, write_points3d

META_KEYS = ["schema_version", "n_points", "units", "origin_m", "extent_m",
             "deviation", "sample_cell_m", "fit_bounds", "sampling", "order"]


def _sample(xyz, dev, origin=(0.0, 0.0, 0.0), cell=0.01, source=4, cap=500000):
    return PointSample(xyz_local=np.array(xyz, dtype=np.float64),
                       dev_q=np.array(dev, dtype=np.int16),
                       origin_abs=np.array(origin, dtype=np.float64),
                       sample_cell_m=cell, source_points=source, cap=cap)


def _hand(**over):
    """손 계산용 4점 표본.

    로컬 최솟값 (1, 2, 3), 범위 (10, 5, 1). 양자화 배율은 축별로 65535/10 = 6553.5, 65535/5 = 13107, 65535.
      P0 (1, 2, 3)      -> q (0, 0, 0)                dev -32768 (DEV_NOT_FLOOR)
      P1 (11, 7, 4)     -> q (65535, 65535, 65535)    dev -32767 (DEV_NO_DEVIATION)
      P2 (3, 3, 3.25)   -> q (2*6553.5, 1*13107, rint(16383.75)) = (13107, 13107, 16384)   dev 5
      P3 (7, 6, 3.75)   -> q (6*6553.5, 4*13107, rint(49151.25)) = (39321, 52428, 49151)   dev -3
    origin_abs (254000, 4180000, 30) -> origin_m = (254001, 4180002, 33)
    """
    kw = dict(origin=(254000.0, 4180000.0, 30.0))
    kw.update(over)
    return _sample([[1.0, 2.0, 3.0], [11.0, 7.0, 4.0], [3.0, 3.0, 3.25], [7.0, 6.0, 3.75]],
                   [-32768, -32767, 5, -3], **kw)


def _split(blob):
    """작성기 테스트용 손 파서(read_points3d 에 기대지 않는다): (json_len, JSON 영역, 본문)."""
    assert blob[:4] == b"FP3D"
    (json_len,) = struct.unpack("<I", blob[4:8])
    return json_len, blob[8:8 + json_len], blob[8 + json_len:]


def _meta_of(blob):
    return json.loads(_split(blob)[1].decode("ascii"))


# ---------------------------------------------------------------- 상수

def test_module_constants():
    # 죽이는 변이: magic·파일명·버전 리터럴 변경, DEV_UNIT_M import 를 지우고 지역 리터럴 0.1 로 되돌림
    assert MAGIC == bytes([0x46, 0x50, 0x33, 0x44])
    assert SCHEMA_VERSION == 1
    assert FILE_NAME == "points3d.bin"
    assert p3.MAX_POINTS == MAX_POINTS == 500_000
    # 단위 상수는 core/pointsample.py 한 곳에서 온다(스펙 §4.1). import 를 지우면 AttributeError 로 죽는다
    assert p3.DEV_UNIT_M == DEV_UNIT_M == 1e-4


# ---------------------------------------------------------------- 작성기: 바이트 배치

def test_encode_byte_layout_hand_sample():
    # 죽이는 변이: '<u2' -> '>u2', '<i2' -> '>i2', 인터리브 -> 축별 연속 배치, dev 블록 오프셋
    blob = encode_points3d(_hand())
    json_len, js, body = _split(blob)
    n = 4
    assert (8 + json_len) % 4 == 0
    assert len(blob) == 8 + json_len + 8 * n
    # xyz 는 점마다 x, y, z 순서. 13107 = 0x3333, 16384 = 0x4000 -> 00 40, 39321 = 0x9999,
    # 52428 = 0xCCCC, 49151 = 0xBFFF -> FF BF
    assert body[:6 * n].hex() == "000000000000" "ffffffffffff" "333333330040" "9999ccccffbf"
    # dev: -32768 = 0x8000 -> 00 80, -32767 = 0x8001 -> 01 80, 5 -> 05 00, -3 = 0xFFFD -> FD FF
    assert body[6 * n:].hex() == "0080" "0180" "0500" "fdff"


def test_encode_pads_json_with_spaces_to_4_byte_boundary():
    # 죽이는 변이: 패딩 제거, 공백이 아닌 바이트로 채움, 필요 이상으로 채움
    # source_points 의 자릿수를 1~4로 바꾸면 JSON 길이가 1바이트씩 늘어 패딩 0~3바이트가 전부 나온다
    pads = set()
    for source in (1, 12, 123, 1234):
        blob = encode_points3d(_hand(source=source))
        json_len, js, body = _split(blob)
        stripped = js.rstrip(b" ")
        pad = json_len - len(stripped)
        assert stripped.endswith(b"}")
        assert js == stripped + b" " * pad
        assert (8 + json_len) % 4 == 0
        assert pad == (-(8 + len(stripped))) % 4
        assert len(body) == 8 * 4
        pads.add(pad)
    assert pads == {0, 1, 2, 3}


# ---------------------------------------------------------------- 작성기: 메타

def test_encode_meta_keys_order_and_values():
    # 죽이는 변이: 키 추가·누락·순서 변경, 두 센티널 값 교환, numpy 스칼라·정수 표기, 구분자 공백
    _, js, _ = _split(encode_points3d(_hand()))
    text = js.decode("ascii").rstrip(" ")
    meta = json.loads(text)
    assert list(meta) == META_KEYS
    assert list(meta["deviation"]) == ["unit_mm", "not_floor", "no_deviation"]
    assert list(meta["fit_bounds"]) == ["min", "max"]
    assert list(meta["sampling"]) == ["method", "source_points", "cap"]
    assert meta["deviation"] == {"unit_mm": 0.1, "not_floor": -32768, "no_deviation": -32767}
    # 메타의 센티널·단위는 core/pointsample.py 상수와 같은 값이다(1e-4 m = 0.1 mm)
    assert meta["deviation"] == {"unit_mm": DEV_UNIT_M * 1000, "not_floor": DEV_NOT_FLOOR,
                                 "no_deviation": DEV_NO_DEVIATION}
    assert meta["sampling"] == {"method": "cell min-hash stratified", "source_points": 4, "cap": 500000}
    # 문자열 자체를 본다: 숫자는 Python float 의 repr(10 이 아니라 10.0), 구분자는 공백 없는 "," 와 ":"
    assert text.startswith(
        '{"schema_version":1,"n_points":4,"units":"m",'
        '"origin_m":[254001.0,4180002.0,33.0],"extent_m":[10.0,5.0,1.0],'
        '"deviation":{"unit_mm":0.1,"not_floor":-32768,"no_deviation":-32767},'
        '"sample_cell_m":0.01,"fit_bounds":{"min":[2.0,1.0,')
    assert text.endswith(
        ']},"sampling":{"method":"cell min-hash stratified","source_points":4,"cap":500000},'
        '"order":"hash"}')


def test_encode_meta_has_no_forbidden_keys():
    # 죽이는 변이: 엔진 버전·시드·임계값·분류 수·경로·시각을 메타에 넣음(기준 무관 바이트 동일이 깨진다)
    text = _split(encode_points3d(_hand()))[1].decode("ascii")
    for banned in ("engine", "seed", "threshold", "pass_mm", "rework_mm", "u_mm",
                   "criteri", "count", "path", "created", "time"):
        assert banned not in text
    assert set(_meta_of(encode_points3d(_hand()))) == set(META_KEYS)


def test_sample_cap_is_recorded_but_not_enforced():
    # 죽이는 변이: 상한을 sample.cap 과 비교(n = 4 > cap = 2 인데도 써져야 한다)
    meta = _meta_of(encode_points3d(_hand(cap=2, source=9)))
    assert meta["n_points"] == 4
    assert meta["sampling"]["cap"] == 2 and meta["sampling"]["source_points"] == 9


# ---------------------------------------------------------------- 작성기: fit_bounds

def test_fit_bounds_covers_only_points_with_deviation():
    # 죽이는 변이: 전체 점으로 fit 계산, 양자화 전 좌표로 fit 계산, 센티널 비교 방향
    # 편차 있는 점은 P2, P3. 복원 좌표 = q * ext / 65535:
    #   P2 (13107*10/65535, 13107*5/65535, 16384*1/65535) = (2, 1, 16384/65535)
    #   P3 (39321*10/65535, 52428*5/65535, 49151*1/65535) = (6, 4, 49151/65535)
    meta = _meta_of(encode_points3d(_hand()))
    assert meta["fit_bounds"] == {"min": [2.0, 1.0, 16384 * 1.0 / 65535.0],
                                  "max": [6.0, 4.0, 49151 * 1.0 / 65535.0]}
    # 양자화 전 값(0.25, 0.75)과는 다르다
    assert meta["fit_bounds"]["min"][2] != 0.25 and meta["fit_bounds"]["max"][2] != 0.75


def test_fit_bounds_falls_back_to_full_range_without_deviation():
    # 죽이는 변이: 편차 있는 점이 없을 때 빈 배열 min() 예외, 대체 범위를 0 으로 둠
    s = dataclasses.replace(_hand(), dev_q=np.array([-32768, -32767, -32768, -32767], dtype=np.int16))
    meta = _meta_of(encode_points3d(s))
    assert meta["fit_bounds"] == {"min": [0.0, 0.0, 0.0], "max": [10.0, 5.0, 1.0]}
    assert meta["fit_bounds"]["max"] == meta["extent_m"]


def test_fit_bounds_sentinel_boundary():
    # 죽이는 변이: dev > -32767 을 >= 로(P1 이 들어와 max 가 전체 범위가 됨) 또는 > -32766 으로(P0 이 빠짐)
    # P0 만 유효(DEV_MIN)
    s = dataclasses.replace(_hand(), dev_q=np.array([-32766, -32767, -32768, -32768], dtype=np.int16))
    meta = _meta_of(encode_points3d(s))
    assert meta["fit_bounds"] == {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}


# ---------------------------------------------------------------- 작성기: 퇴화 축

def test_degenerate_axis_encodes_zero_without_warning():
    # 죽이는 변이: 65535.0 / ext 를 그대로 나눔(0 나눗셈 경고), 범위 0 축에 NaN·65535 기록
    # z 가 전부 5.0. x 범위 2 (배율 32767.5), y 범위 4 (배율 16383.75)
    #   (1.5 - 1) * 32767.5 = 16383.75 -> 16384,  (3 - 2) * 16383.75 = 16383.75 -> 16384
    s = _sample([[1.0, 2.0, 5.0], [3.0, 6.0, 5.0], [1.5, 3.0, 5.0]], [0, 1, 2], origin=(10.0, 20.0, 30.0))
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        blob = encode_points3d(s)
    json_len, _, body = _split(blob)
    meta = _meta_of(blob)
    assert meta["extent_m"] == [2.0, 4.0, 0.0]
    assert meta["origin_m"] == [11.0, 22.0, 35.0]
    q = np.frombuffer(body, dtype="<u2", count=9).reshape(3, 3)
    assert q.tolist() == [[0, 0, 0], [65535, 65535, 0], [16384, 16384, 0]]
    # 복원 z = q * 0 / 65535 = 0
    assert meta["fit_bounds"]["min"][2] == 0.0 and meta["fit_bounds"]["max"][2] == 0.0
    assert len(blob) == 8 + json_len + 8 * 3


def test_single_point_has_zero_extent_on_all_axes():
    # 죽이는 변이: n = 1 을 거부, 범위 0 에서 예외
    s = _sample([[7.0, 8.0, 9.0]], [12], origin=(100.0, 200.0, 300.0), source=1)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        blob = encode_points3d(s)
    _, _, body = _split(blob)
    meta = _meta_of(blob)
    assert meta["n_points"] == 1
    assert meta["origin_m"] == [107.0, 208.0, 309.0]
    assert meta["extent_m"] == [0.0, 0.0, 0.0]
    assert meta["fit_bounds"] == {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
    assert body.hex() == "000000000000" "0c00"


# ---------------------------------------------------------------- 작성기: 검증 규칙

def test_cap_is_checked_against_engine_constant_not_sample_cap(tmp_path):
    # 죽이는 변이: 상한을 sample.cap 과 비교, 상한 검사 제거
    n = MAX_POINTS + 1
    xyz = np.zeros((n, 3), dtype=np.float64)
    xyz[:, 0] = np.arange(n) * 1e-3
    s = PointSample(xyz_local=xyz, dev_q=np.zeros(n, dtype=np.int16), origin_abs=np.zeros(3),
                    sample_cell_m=0.01, source_points=n, cap=10 ** 9)
    with pytest.raises(ValueError):
        encode_points3d(s)
    out = tmp_path / FILE_NAME
    with pytest.raises(ValueError):
        write_points3d(s, out)
    assert not out.exists()


def test_exactly_max_points_is_accepted():
    # 죽이는 변이: n <= MAX_POINTS 를 n < MAX_POINTS 로
    n = MAX_POINTS
    xyz = np.zeros((n, 3), dtype=np.float64)
    xyz[:, 0] = np.arange(n) * 1e-3
    s = PointSample(xyz_local=xyz, dev_q=np.zeros(n, dtype=np.int16), origin_abs=np.zeros(3),
                    sample_cell_m=0.01, source_points=n, cap=MAX_POINTS)
    blob = encode_points3d(s)
    json_len, _, _ = _split(blob)
    assert len(blob) == 8 + json_len + 8 * n
    assert len(blob) <= 8 + 4096 + 8 * 500_000        # 성능 테스트가 쓰는 크기 상한과 같은 식


def _zero_points(s):
    return dataclasses.replace(s, xyz_local=np.zeros((0, 3), dtype=np.float64), dev_q=np.zeros(0, dtype=np.int16))


def _xyz_two_columns(s):
    return dataclasses.replace(s, xyz_local=s.xyz_local[:, :2].copy())


def _xyz_flat(s):
    return dataclasses.replace(s, xyz_local=s.xyz_local.ravel().copy())


def _dev_too_short(s):
    return dataclasses.replace(s, dev_q=s.dev_q[:3].copy())


def _dev_int32(s):
    return dataclasses.replace(s, dev_q=s.dev_q.astype(np.int32))


def _dev_float(s):
    return dataclasses.replace(s, dev_q=s.dev_q.astype(np.float64))


def _xyz_nan(s):
    xyz = s.xyz_local.copy()
    xyz[2, 1] = np.nan
    return dataclasses.replace(s, xyz_local=xyz)


def _xyz_inf(s):
    xyz = s.xyz_local.copy()
    xyz[0, 0] = np.inf
    return dataclasses.replace(s, xyz_local=xyz)


def _origin_nan(s):
    return dataclasses.replace(s, origin_abs=np.array([254000.0, np.nan, 30.0]))


def _cell_nan(s):
    return dataclasses.replace(s, sample_cell_m=float("nan"))


@pytest.mark.parametrize("mutate, message", [
    (_zero_points, "점이 0개"),
    (_xyz_two_columns, "xyz_local 모양"),
    (_xyz_flat, "xyz_local 모양"),
    (_dev_too_short, "dev_q"),
    (_dev_int32, "dev_q"),
    (_dev_float, "dev_q"),
    (_xyz_nan, "유한하지 않은"),
    (_xyz_inf, "유한하지 않은"),
    (_origin_nan, "JSON"),        # json.dumps(allow_nan=False) 가 내는 메시지
    (_cell_nan, "JSON"),
])
def test_writer_rejects_invalid_sample_and_leaves_no_file(tmp_path, mutate, message):
    # 죽이는 변이: 검증 규칙 1·3 을 하나씩 제거(메시지로 어느 가드가 막았는지 확인한다),
    #             allow_nan=False 제거(NaN 이 JSON 에 들어가면 브라우저가 못 읽는다)
    s = mutate(_hand())
    with warnings.catch_warnings():
        warnings.simplefilter("error")          # 가드가 numpy 연산보다 먼저 막아야 한다
        with pytest.raises(ValueError, match=message):
            encode_points3d(s)
        out = tmp_path / FILE_NAME
        with pytest.raises(ValueError, match=message):
            write_points3d(s, out)
    assert not out.exists()


# ---------------------------------------------------------------- write_points3d

def test_write_points3d_writes_blob_and_returns_file_name(tmp_path):
    # 죽이는 변이: 전체 경로를 반환, 파일명을 리터럴로 고정, blob 과 다른 내용을 씀
    out = tmp_path / FILE_NAME
    assert write_points3d(_hand(), out) == "points3d.bin"
    assert out.read_bytes() == encode_points3d(_hand())
    other = tmp_path / "other.bin"
    assert write_points3d(_hand(), str(other)) == "other.bin"      # str 경로도 받는다
    assert other.read_bytes() == encode_points3d(_hand())


def test_write_points3d_removes_partial_file_on_failure(tmp_path, monkeypatch):
    # 죽이는 변이: 실패 시 부분 파일을 남김, 예외를 삼킴
    out = tmp_path / FILE_NAME
    seen = {}

    def partial_then_fail(self, data):
        with open(self, "wb") as f:
            f.write(bytes(data)[:5])
        seen["partial_existed"] = self.exists()
        raise OSError("disk full")

    monkeypatch.setattr(pathlib.Path, "write_bytes", partial_then_fail)
    with pytest.raises(OSError, match="disk full"):
        write_points3d(_hand(), out)
    assert seen == {"partial_existed": True}      # 주입이 실제로 부분 파일을 만들었다(공허한 통과 방지)
    assert not out.exists()
```

손 계산 근거(4점 표본 `_hand()`): 로컬 최솟값 (1, 2, 3), 범위 (10, 5, 1). 배율 `65535/10 = 6553.5`, `65535/5 = 13107`, `65535/1 = 65535`. P2 의 z 는 `0.25 × 65535 = 16383.75` → 16384, P3 의 z 는 `0.75 × 65535 = 49151.25` → 49151. 16진: 13107 = `0x3333`, 16384 = `0x4000`(LE `00 40`), 39321 = `0x9999`, 52428 = `0xCCCC`, 49151 = `0xBFFF`(LE `FF BF`). dev: −32768 = `0x8000`(LE `00 80`), −32767 = `0x8001`(LE `01 80`), 5 = `05 00`, −3 = `0xFFFD`(LE `FD FF`).

- [ ] **Step 3: 실패 확인**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_points3d.py -q
```

Expected: 수집 오류 1건. `ImportError: cannot import name 'points3d' from 'flatness.outputs'`, 마지막 줄 `1 error in ...`.

- [ ] **Step 4: 작성기 구현 (`encode_points3d`, `write_points3d`)**

`engine/flatness/outputs/points3d.py` 를 새로 만든다. 내용 전체(`math` 는 Step 8 의 리더가 쓴다):

```python
"""points3d.bin 작성기·리더 (3D 점군 뷰어가 읽는 점 표본 컨테이너, schema_version = 1).

바이트 배치(전부 little-endian, n = 점 수, L = json_len):
  [0, 4)            magic b"FP3D"
  [4, 8)            uint32 json_len. 공백 패딩을 포함한 JSON 영역의 바이트 수. 8 + json_len 은 4의 배수
  [8, 8+L)          UTF-8 JSON 메타. 끝을 공백(0x20)으로 채운다
  [8+L, 8+L+6n)     uint16 xyz[3n]. 점마다 x, y, z 순서로 인터리브. 축 범위를 0..65535 로 양자화한 값
  [8+L+6n, 8+L+8n)  int16 dev[n]. 0.1mm 정수 편차 또는 센티널
복원: local = q * extent_m / 65535, abs = origin_m + local.

메타에는 엔진 버전·시드·판정 기준에 종속된 값(임계값 등)·분류 수·경로·시각을 넣지 않는다.
같은 스캔이면 기준을 바꿔 재분석해도 파일이 바이트 단위로 같아야 한다.
이 모듈은 matplotlib 를 쓰지 않는다(heatmap 부수효과 import 를 하지 않는다).
"""
import json
import math
import os
import struct
from pathlib import Path

import numpy as np

from flatness.core.pointsample import DEV_NO_DEVIATION, DEV_NOT_FLOOR, DEV_UNIT_M, MAX_POINTS, PointSample

MAGIC = b"FP3D"
SCHEMA_VERSION = 1
FILE_NAME = "points3d.bin"

_Q_MAX = 65535.0                    # uint16 양자화 최댓값
# 편차 정수 1단위(mm). 단위 상수의 정의는 core/pointsample.py 한 곳이다(스펙 §4.1). 1e-4 * 1000 은 float 0.1 과
# 같은 값이라 JSON 에 0.1 로 적힌다. 이 모듈에 0.1 리터럴을 따로 두지 않는다
_DEV_UNIT_MM = DEV_UNIT_M * 1000


def encode_points3d(sample: PointSample) -> bytes:
    """표본을 메모리에서 blob 하나로 완성한다. 검증 규칙을 어기면 ValueError."""
    xyz = np.asarray(sample.xyz_local)
    dev_in = np.asarray(sample.dev_q)
    if xyz.ndim != 2 or xyz.shape[1] != 3:
        raise ValueError(f"points3d: xyz_local 모양이 (n, 3) 이 아니다: {xyz.shape}")
    n = xyz.shape[0]
    if n < 1:
        raise ValueError("points3d: 점이 0개다")
    # 상한은 sample.cap 이 아니라 엔진 상수와 비교한다
    if n > MAX_POINTS:
        raise ValueError(f"points3d: 점 수 {n} 이 상한 {MAX_POINTS} 을 넘는다")
    if dev_in.shape != (n,) or dev_in.dtype != np.int16:
        raise ValueError(f"points3d: dev_q 는 int16 (n,) 이어야 한다: {dev_in.dtype} {dev_in.shape}")
    xyz = xyz.astype(np.float64, copy=False)
    if not np.isfinite(xyz).all():
        raise ValueError("points3d: 좌표에 유한하지 않은 값이 있다")

    mn = xyz.min(axis=0)
    ext = xyz.max(axis=0) - mn
    # 범위가 0인 축은 안전한 분모로 나눈 뒤 0 으로 덮는다(0 나눗셈 경고를 내지 않는다)
    inv = np.where(ext > 0, _Q_MAX / np.where(ext > 0, ext, 1.0), 0.0)
    # (n, 3) 의 C 순서가 곧 x, y, z 인터리브다
    q = np.clip(np.rint((xyz - mn) * inv), 0, 65535).astype("<u2")
    dev = dev_in.astype("<i2")

    # fit_bounds 는 양자화 뒤 복원 좌표로 계산한다(뷰어가 그리는 점을 정확히 감싼다)
    deq = q * ext / _Q_MAX
    has = dev > DEV_NO_DEVIATION
    if has.any():
        fit_min, fit_max = deq[has].min(axis=0), deq[has].max(axis=0)
    else:
        fit_min, fit_max = np.zeros(3), ext

    origin = np.asarray(sample.origin_abs, dtype=np.float64)
    # dict 삽입 순서가 곧 기록 순서다. 숫자는 Python float·int 로만 넣는다(repr 최단 왕복 표기)
    meta = {
        "schema_version": SCHEMA_VERSION,
        "n_points": int(n),
        "units": "m",
        "origin_m": [float(v) for v in origin + mn],
        "extent_m": [float(v) for v in ext],
        "deviation": {"unit_mm": _DEV_UNIT_MM, "not_floor": DEV_NOT_FLOOR, "no_deviation": DEV_NO_DEVIATION},
        "sample_cell_m": float(sample.sample_cell_m),
        "fit_bounds": {"min": [float(v) for v in fit_min], "max": [float(v) for v in fit_max]},
        "sampling": {"method": "cell min-hash stratified",
                     "source_points": int(sample.source_points), "cap": int(sample.cap)},
        "order": "hash",
    }
    # allow_nan=False: NaN·무한대가 섞이면 ValueError(브라우저의 JSON.parse 가 못 읽는 파일을 쓰지 않는다)
    js = json.dumps(meta, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("ascii")
    js += b" " * ((-(8 + len(js))) % 4)
    blob = MAGIC + struct.pack("<I", len(js)) + js + q.tobytes() + dev.tobytes()
    if len(blob) != 8 + len(js) + 8 * n or (8 + len(js)) % 4 != 0:
        raise ValueError("points3d: blob 길이가 형식과 맞지 않는다")
    return blob


def write_points3d(sample: PointSample, out_path: str | os.PathLike) -> str:
    """blob 을 한 번에 쓰고 파일명을 돌려준다. 쓰는 중 예외면 부분 파일을 지우고 다시 던진다."""
    blob = encode_points3d(sample)          # 검증 실패는 파일을 만들기 전에 난다
    path = Path(out_path)
    try:
        path.write_bytes(blob)
    except BaseException:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return path.name
```

- [ ] **Step 5: 통과 확인**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_points3d.py -q
```

Expected: `25 passed`.

- [ ] **Step 6: 리더 테스트 추가 (실패하는 테스트)**

`engine/tests/test_points3d.py` **끝에** 아래를 이어 붙인다(앞 내용은 그대로 두고, 빈 줄 2개 뒤에 붙인다):

```python
# ---------------------------------------------------------------- 리더

def _pad4(js: bytes) -> bytes:
    return js + b" " * ((-(8 + len(js))) % 4)


def _pack(json_area: bytes, body: bytes, json_len=None, magic=b"FP3D") -> bytes:
    """변조 버퍼 조립. json_len 을 주지 않으면 json_area 길이를 그대로 적는다."""
    if json_len is None:
        json_len = len(json_area)
    return magic + struct.pack("<I", json_len) + json_area + body


def _good_meta(n=2):
    return {"schema_version": 1, "n_points": n, "units": "m",
            "origin_m": [254001.0, 4180002.0, 33.0], "extent_m": [10.0, 5.0, 1.0],
            "deviation": {"unit_mm": 0.1, "not_floor": -32768, "no_deviation": -32767},
            "sample_cell_m": 0.01,
            "fit_bounds": {"min": [0.0, 0.0, 0.0], "max": [10.0, 5.0, 1.0]},
            "sampling": {"method": "cell min-hash stratified", "source_points": 2, "cap": 500000},
            "order": "hash"}


# 2점 본문: xyz 02 01 | 04 03 | 06 05 | ff ff | 00 00 | 00 80, dev fd ff | 00 80
_BODY2 = bytes.fromhex("020104030605" "ffff00000080" "fdff" "0080")


def _buf(meta, body=_BODY2):
    return _pack(_pad4(json.dumps(meta, separators=(",", ":")).encode("utf-8")), body)


def _reason(data):
    with pytest.raises(ValueError) as ei:
        p3.read_points3d(data)
    return str(ei.value)


def test_reader_parses_hand_built_buffer():
    # 죽이는 변이(리더 쪽): '<u2' -> '>u2', '<i2' -> '>i2', 본문 오프셋에서 json_len 누락, 축별 연속 배치로 읽음
    meta, xyz_q, dev_q = p3.read_points3d(_buf(_good_meta()))
    assert meta == _good_meta()
    assert xyz_q.dtype == np.uint16 and xyz_q.shape == (2, 3)
    assert dev_q.dtype == np.int16 and dev_q.shape == (2,)
    # 02 01 -> 0x0102 = 258, 04 03 -> 772, 06 05 -> 1286, 00 80 -> 32768
    assert xyz_q.tolist() == [[258, 772, 1286], [65535, 0, 32768]]
    # fd ff -> -3, 00 80 -> -32768
    assert dev_q.tolist() == [-3, -32768]


def test_reader_accepts_bytearray_and_memoryview():
    data = _buf(_good_meta())
    for view in (bytearray(data), memoryview(data)):
        meta, xyz_q, dev_q = p3.read_points3d(view)
        assert meta["n_points"] == 2 and xyz_q[0].tolist() == [258, 772, 1286] and dev_q[1] == -32768


def test_reader_ignores_unknown_meta_keys():
    # 죽이는 변이: 키 집합을 정확히 일치로 검사(추가 키는 호환 변경이어야 한다)
    meta = _good_meta()
    meta["future_key"] = {"a": [1, 2, 3]}
    got, _, _ = p3.read_points3d(_buf(meta))
    assert got["future_key"] == {"a": [1, 2, 3]}


def test_roundtrip_restores_coordinates_within_half_quantum():
    # 죽이는 변이: origin_m·좌표를 float32 로 다룸, rint 대신 내림, mn 을 빼지 않음, dev 캐스트 오류
    rng = np.random.default_rng(7)
    n = 5000
    local = rng.uniform([3.0, 1.0, 0.5], [3.0 + 8.0012, 1.0 + 6.0009, 0.5 + 0.0719], size=(n, 3))
    dev = rng.integers(-32768, 32768, size=n).astype(np.int16)
    s = PointSample(xyz_local=local, dev_q=dev, origin_abs=np.array([254012.3371, 4180044.9126, 31.4802]),
                    sample_cell_m=0.0098, source_points=120701, cap=500000)
    meta, xyz_q, dev_q = p3.read_points3d(encode_points3d(s))
    assert meta["n_points"] == n and xyz_q.shape == (n, 3)
    assert np.array_equal(dev_q, dev)
    ext = np.array(meta["extent_m"])
    assert np.array_equal(ext, local.max(axis=0) - local.min(axis=0))
    half_quantum = ext / 65535 / 2
    restored_local = xyz_q * ext / 65535                          # §5.5 복원 식
    assert (np.abs(restored_local - (local - local.min(axis=0))) <= half_quantum + 1e-12).all()
    restored_abs = np.array(meta["origin_m"]) + restored_local
    # 절대 좌표 비교는 4e6 크기의 float64 반올림(약 1e-9 m)만큼만 여유를 둔다
    assert (np.abs(restored_abs - (s.origin_abs + local)) <= half_quantum + 1e-8).all()


def test_reader_reads_degenerate_axis_as_zero():
    s = _sample([[1.0, 2.0, 5.0], [3.0, 6.0, 5.0], [1.5, 3.0, 5.0]], [0, 1, 2])
    meta, xyz_q, _ = p3.read_points3d(encode_points3d(s))
    assert meta["extent_m"][2] == 0.0
    assert (xyz_q[:, 2] * meta["extent_m"][2] / 65535 == 0.0).all()


# §5.6 리더 규칙 1~7. 각 사유마다 그 규칙만 어긴 버퍼를 준다

def test_reader_too_short():
    assert _reason(b"") == "too_short"
    assert _reason(b"FP3D\x00\x00\x00") == "too_short"            # 7바이트


def test_reader_bad_magic():
    good = _buf(_good_meta())
    assert _reason(b"FP3X" + good[4:]) == "bad_magic"
    assert _reason(b"fp3d" + good[4:]) == "bad_magic"


def test_reader_bad_header():
    good = _buf(_good_meta())
    # (a) json_len 이 버퍼를 넘는다. 0xFFFFFFFC 는 8 을 더해도 4의 배수라 길이 조건만 어긴다
    assert _reason(good[:4] + struct.pack("<I", 0xFFFFFFFC) + good[8:]) == "bad_header"
    # (b) 8 + json_len 이 4의 배수가 아니다(패딩 없는 JSON). 본문이 뒤따라 길이 조건은 만족한다
    js = _pad4(json.dumps(_good_meta(), separators=(",", ":")).encode("utf-8")) + b" "
    assert (8 + len(js)) % 4 == 1
    assert _reason(_pack(js, _BODY2)) == "bad_header"


@pytest.mark.parametrize("area", [
    b"not json",                       # JSON 이 아님
    b"[1,2]",                          # 배열(객체가 아님)
    b"null",                           # null(객체가 아님)
    b"\xff\xfe\xfd\xfc",               # UTF-8 로 풀 수 없음
    b'{"schema_version":NaN}',         # NaN 토큰은 JSON 이 아니다(브라우저의 JSON.parse 와 같게 거부)
    b'{"schema_version":1,"n_points":Infinity}',
])
def test_reader_bad_json(area):
    assert _reason(_pack(_pad4(area), _BODY2)) == "bad_json"


@pytest.mark.parametrize("version", [2, 0, "1", True, None])
def test_reader_unsupported_version(version):
    meta = _good_meta()
    if version is None:
        del meta["schema_version"]
    else:
        meta["schema_version"] = version
    assert _reason(_buf(meta)) == "unsupported_version"


def _set(key, value):
    def apply(meta):
        meta[key] = value
    return apply


def _del(key):
    def apply(meta):
        del meta[key]
    return apply


def _sub(key, sub, value):
    def apply(meta):
        meta[key][sub] = value
    return apply


def _delsub(key, sub):
    def apply(meta):
        del meta[key][sub]
    return apply


_BAD_META = {
    "n_points_zero": _set("n_points", 0),
    "n_points_negative": _set("n_points", -2),
    "n_points_fraction": _set("n_points", 1.5),
    "n_points_string": _set("n_points", "2"),
    "n_points_bool": _set("n_points", True),
    "n_points_missing": _del("n_points"),
    "units_mm": _set("units", "mm"),
    "units_missing": _del("units"),
    "origin_two": _set("origin_m", [1.0, 2.0]),
    "origin_string_item": _set("origin_m", [1.0, 2.0, "3"]),
    "origin_not_list": _set("origin_m", "abc"),
    "origin_missing": _del("origin_m"),
    "extent_negative": _set("extent_m", [10.0, -0.5, 1.0]),
    "extent_two": _set("extent_m", [10.0, 5.0]),
    "extent_missing": _del("extent_m"),
    "deviation_unit": _sub("deviation", "unit_mm", 0.2),
    "deviation_not_floor": _sub("deviation", "not_floor", -32767),
    "deviation_no_deviation": _sub("deviation", "no_deviation", -32768),
    "deviation_unit_missing": _delsub("deviation", "unit_mm"),
    "deviation_not_object": _set("deviation", "x"),
    "deviation_missing": _del("deviation"),
    "cell_zero": _set("sample_cell_m", 0),
    "cell_negative": _set("sample_cell_m", -0.01),
    "cell_string": _set("sample_cell_m", "0.01"),
    "cell_missing": _del("sample_cell_m"),
    "fit_min_gt_max": _sub("fit_bounds", "min", [0.0, 5.5, 0.0]),     # y 축만 min 5.5 > max 5.0
    "fit_min_two": _sub("fit_bounds", "min", [0.0, 0.0]),
    "fit_max_missing": _delsub("fit_bounds", "max"),
    "fit_not_object": _set("fit_bounds", [0, 0, 0]),
    "fit_missing": _del("fit_bounds"),
    "order_other": _set("order", "cell"),
    "order_missing": _del("order"),
}


@pytest.mark.parametrize("case", sorted(_BAD_META))
def test_reader_bad_meta(case):
    # 죽이는 변이: §5.6 표 6행의 세부 조건을 하나라도 빼면 해당 사례가 통과해 버린다
    meta = _good_meta()
    _BAD_META[case](meta)
    assert _reason(_buf(meta)) == "bad_meta"


@pytest.mark.parametrize("token", ["1e999", "-1e999"])
def test_reader_bad_meta_non_finite_number(token):
    # 1e999 는 JSON 문법으로는 유효하지만 float 로는 무한대다(유한수 검사)
    text = json.dumps(_good_meta(), separators=(",", ":")).replace("254001.0", token)
    assert token in text
    assert _reason(_pack(_pad4(text.encode("utf-8")), _BODY2)) == "bad_meta"


def test_reader_size_mismatch():
    # 죽이는 변이: read_points3d 의 size_mismatch 검사 제거
    good = _buf(_good_meta())
    assert _reason(good + b"\x00\x00") == "size_mismatch"                    # 2바이트 남음
    assert _reason(good[:-2]) == "size_mismatch"                             # 2바이트 모자람
    assert _reason(_buf(_good_meta(n=3))) == "size_mismatch"                 # n_points 3 인데 본문은 2점
    assert _reason(_buf(_good_meta(n=1))) == "size_mismatch"                 # n_points 1 인데 본문은 2점


def test_reader_reports_first_violated_rule():
    # 죽이는 변이: 검사 순서 변경
    good = _buf(_good_meta())
    assert _reason(b"XXXX\xff\xff\xff") == "too_short"                                        # 1 이 2 보다 먼저
    assert _reason(b"FP3X" + struct.pack("<I", 0xFFFFFFFC) + good[8:]) == "bad_magic"         # 2 가 3 보다 먼저
    assert _reason(_pack(b"not json", _BODY2, json_len=0xFFFFFFFC)) == "bad_header"           # 3 이 4 보다 먼저
    meta = _good_meta(n=3)
    meta["schema_version"] = 2
    meta["units"] = "mm"
    assert _reason(_buf(meta)) == "unsupported_version"                                       # 5 가 6·7 보다 먼저
    meta["schema_version"] = 1
    assert _reason(_buf(meta)) == "bad_meta"                                                  # 6 이 7 보다 먼저
```

손 계산 근거(2점 본문 `_BODY2`): `02 01` = `0x0102` = 258, `04 03` = `0x0304` = 772, `06 05` = `0x0506` = 1286, `ff ff` = 65535, `00 00` = 0, `00 80` = `0x8000` = 32768(uint16). dev `fd ff` = −3, `00 80` = −32768(int16). 길이는 6 × 2 + 2 × 2 = 16바이트 = 8 × 2.

- [ ] **Step 7: 실패 확인**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_points3d.py -q
```

Expected: `55 failed, 25 passed`. 실패 사유는 전부 `AttributeError: module 'flatness.outputs.points3d' has no attribute 'read_points3d'`.

- [ ] **Step 8: 리더 구현 (`read_points3d`)**

`engine/flatness/outputs/points3d.py` **끝에** 아래를 이어 붙인다(`write_points3d` 다음, 빈 줄 2개 뒤):

```python
def _reject_constant(token):
    # NaN·Infinity 토큰은 표준 JSON 이 아니다(브라우저의 JSON.parse 와 같게 거부한다)
    raise ValueError(token)


def _is_num(v) -> bool:
    """유한한 수인가. bool 은 수로 보지 않는다."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    try:
        return math.isfinite(v)
    except OverflowError:               # float 로 못 바꾸는 큰 정수
        return False


def _is_vec3(v) -> bool:
    return isinstance(v, list) and len(v) == 3 and all(_is_num(x) for x in v)


def _meta_ok(meta: dict) -> bool:
    """리더 규칙 6: 메타 형식. 모르는 키는 무시한다."""
    n = meta.get("n_points")
    if not (_is_num(n) and float(n).is_integer() and n >= 1):
        return False
    if meta.get("units") != "m":
        return False
    origin, extent = meta.get("origin_m"), meta.get("extent_m")
    if not (_is_vec3(origin) and _is_vec3(extent) and all(x >= 0 for x in extent)):
        return False
    d = meta.get("deviation")
    if not isinstance(d, dict):
        return False
    unit, not_floor, no_dev = d.get("unit_mm"), d.get("not_floor"), d.get("no_deviation")
    if not (_is_num(unit) and unit == _DEV_UNIT_MM
            and _is_num(not_floor) and not_floor == DEV_NOT_FLOOR
            and _is_num(no_dev) and no_dev == DEV_NO_DEVIATION):
        return False
    cell = meta.get("sample_cell_m")
    if not (_is_num(cell) and cell > 0):
        return False
    fit = meta.get("fit_bounds")
    if not isinstance(fit, dict):
        return False
    lo, hi = fit.get("min"), fit.get("max")
    if not (_is_vec3(lo) and _is_vec3(hi) and all(a <= b for a, b in zip(lo, hi))):
        return False
    return meta.get("order") == "hash"


def read_points3d(data: bytes) -> tuple[dict, np.ndarray, np.ndarray]:
    """blob 을 (meta, xyz_q uint16 (n, 3), dev_q int16 (n,)) 로 읽는다. 테스트·왕복 검증용.

    위에서부터 차례로 검사하고 처음 어긴 규칙의 사유를 메시지로 하는 ValueError 를 던진다:
    too_short, bad_magic, bad_header, bad_json, unsupported_version, bad_meta, size_mismatch.
    """
    size = len(data)
    if size < 8:
        raise ValueError("too_short")
    if bytes(data[:4]) != MAGIC:
        raise ValueError("bad_magic")
    (json_len,) = struct.unpack_from("<I", data, 4)
    if 8 + json_len > size or (8 + json_len) % 4 != 0:
        raise ValueError("bad_header")
    try:
        meta = json.loads(bytes(data[8:8 + json_len]).decode("utf-8"), parse_constant=_reject_constant)
    except ValueError:                   # UnicodeDecodeError, JSONDecodeError 도 ValueError 다
        raise ValueError("bad_json") from None
    if not isinstance(meta, dict):
        raise ValueError("bad_json")
    version = meta.get("schema_version")
    if isinstance(version, bool) or version != SCHEMA_VERSION:
        raise ValueError("unsupported_version")
    if not _meta_ok(meta):
        raise ValueError("bad_meta")
    n = int(meta["n_points"])
    if size != 8 + json_len + 8 * n:
        raise ValueError("size_mismatch")
    body = 8 + json_len
    # 엔디안을 dtype 에 명시한다(호스트 바이트 순서에 기대지 않는다)
    xyz_q = np.frombuffer(data, dtype="<u2", count=3 * n, offset=body).reshape(n, 3)
    dev_q = np.frombuffer(data, dtype="<i2", count=n, offset=body + 6 * n)
    return meta, xyz_q, dev_q
```

- [ ] **Step 9: 통과 확인**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_points3d.py -q
```

Expected: `80 passed`.

- [ ] **Step 10: 골든 테스트 추가 (실패하는 테스트)**

`engine/tests/test_points3d.py` **끝에** 아래를 이어 붙인다(빈 줄 2개 뒤). import 가 파일 중간에 오는 것은 의도한 것이다(`# noqa: E402`):

```python
# ---------------------------------------------------------------- 형식 골든 (§10.2)

from tests.fixtures.points3d_golden import GOLDEN_PATH, golden_sample  # noqa: E402

GOLDEN_SHA256 = "b0c50d8a0f2e77e3077c6b38fb6795cc89bf321601c56fb8a3e855efbc6892d9"


def test_golden_sample_is_deterministic():
    a, b = golden_sample(), golden_sample()
    assert a.xyz_local.tobytes() == b.xyz_local.tobytes() and a.dev_q.tobytes() == b.dev_q.tobytes()
    assert a.xyz_local.shape == (12, 3) and a.dev_q.dtype == np.int16


def test_golden_file_matches_encoder_byte_for_byte():
    # 죽이는 변이: '<u2' -> '>u2', 패딩 제거, 인터리브 -> 축별 연속 배치, 두 센티널 값 교환, 메타 키 순서
    data = GOLDEN_PATH.read_bytes()
    assert len(data) == 488
    # 형식을 바꾸면서 골든을 같이 다시 만들어도 이 해시가 잡는다(파일과 작성기가 함께 틀리는 경우)
    assert hashlib.sha256(data).hexdigest() == GOLDEN_SHA256
    assert encode_points3d(golden_sample()) == data


def test_golden_file_content_by_hand():
    # 골든 정의(points3d_golden.py)에서 손으로 적은 기대값. 대시보드 vitest 가 같은 파일을 같은 값으로 읽는다
    data = GOLDEN_PATH.read_bytes()
    # json_len 384 = 0x00000180 -> 80 01 00 00. 패딩 전 JSON 382바이트 + 공백 2바이트
    assert data[:8] == b"FP3D" + bytes([0x80, 0x01, 0x00, 0x00])
    assert data[8:392].endswith(b'"order":"hash"}  ') and not data[8:392].endswith(b'}   ')
    assert b'"origin_m":[254012.8371,4180045.1626,31.6052]' in data[8:392]
    meta, xyz_q, dev_q = p3.read_points3d(data)
    assert meta == {
        "schema_version": 1, "n_points": 12, "units": "m",
        # origin_abs + MN = (254012.3371 + 0.5, 4180044.9126 + 0.25, 31.4802 + 0.125)
        "origin_m": [254012.8371, 4180045.1626, 31.6052],
        "extent_m": [4.0, 2.5, 0.3125],
        "deviation": {"unit_mm": 0.1, "not_floor": -32768, "no_deviation": -32767},
        "sample_cell_m": 0.0125,
        # 편차 있는 점의 최대 qz 는 6번 점의 23456(7번 65535 는 DEV_NOT_FLOOR 라 빠진다)
        "fit_bounds": {"min": [0.0, 0.0, 0.0], "max": [4.0, 2.5, 23456 * 0.3125 / 65535]},
        "sampling": {"method": "cell min-hash stratified", "source_points": 12345, "cap": 500000},
        "order": "hash",
    }
    assert xyz_q.tolist() == [
        [0, 0, 0], [65535, 65535, 4096], [258, 772, 1286], [32768, 16384, 8192],
        [1, 65534, 2], [40000, 20000, 10000], [12345, 54321, 23456], [100, 200, 65535],
        [50000, 60000, 300], [65280, 255, 4660], [4660, 43981, 291], [21845, 43690, 13107],
    ]
    assert dev_q.tolist() == [0, 32, -105, 70, 71, -70, -71, -32768, -32767, 32767, -32766, 1]
    # 본문은 392 에서 시작한다. 2번 점 (258, 772, 1286) = 0x0102, 0x0304, 0x0506 -> 02 01 04 03 06 05
    assert data[392 + 12:392 + 18].hex() == "020104030605"
    # dev 블록은 392 + 72 = 464 에서 시작한다. 7번 -32768 -> 00 80, 8번 -32767 -> 01 80
    assert data[464 + 14:464 + 18].hex() == "00800180"
    # T_q = 70 분류 수(대시보드 테스트가 같은 수를 손으로 적는다): flat 5, depression 3, protrusion 2, none 2
    has = dev_q > -32767
    assert int((dev_q > 70).sum()) == 2
    assert int((has & (dev_q < -70)).sum()) == 3
    assert int((~has).sum()) == 2
    assert int((has & (dev_q >= -70) & (dev_q <= 70)).sum()) == 5
```

손 계산 근거: `json_len` 384 = `0x00000180` → LE `80 01 00 00`. 본문 시작 = 8 + 384 = 392. xyz 블록 = 6 × 12 = 72바이트, dev 블록 시작 = 392 + 72 = 464, 파일 끝 = 464 + 24 = 488. `origin_m` = `origin_abs + MN` = (254012.3371 + 0.5, 4180044.9126 + 0.25, 31.4802 + 0.125) = (254012.8371, 4180045.1626, 31.6052). `fit_bounds.max.z`: 편차 있는 점 가운데 qz 최댓값은 6번 점의 23456(7번 점의 65535 는 `DEV_NOT_FLOOR` 라 빠진다) → `23456 × 0.3125 / 65535`. x·y 는 1번 점(dev 32)이 65535 라 전체 범위 4.0, 2.5 다. 분류 수(`T_q = 70`): `d > 70` 은 {71, 32767} 2개, `d < −70` 이고 센티널이 아닌 것은 {−105, −71, −32766} 3개, 센티널 {−32768, −32767} 2개, 나머지 {0, 32, 70, −70, 1} 5개.

- [ ] **Step 11: 실패 확인 (픽스처 모듈 없음)**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_points3d.py -q
```

Expected: 수집 오류 1건. `ModuleNotFoundError: No module named 'tests.fixtures.points3d_golden'`.

- [ ] **Step 12: 골든 픽스처 모듈 작성**

`engine/tests/fixtures/points3d_golden.py` 를 새로 만든다. 내용 전체:

```python
"""points3d.bin 형식 골든의 입력 표본 (pytest 와 vitest 가 같은 .bin 을 읽는다).

골든 파일을 다시 만드는 방법(engine 폴더에서):
    PYTHONPATH=D:/Projects/Flatness/engine <py> -m tests.fixtures.points3d_golden
형식을 바꾸지 않았는데 파일이 달라지면 결함이다. 난수를 쓰지 않는다.

표본은 아래 상수로만 만든다: xyz_local = MN + Q * EXT / 65535.0
- 축 범위가 서로 다르다(4.0 / 2.5 / 0.3125 m): 축 전치 변이가 죽는다
- 원점이 UTM 급 대좌표다: origin_m 을 float32 로 다루는 변이가 죽는다
- 패딩 전 JSON 이 382바이트라 공백 2바이트가 붙는다: 패딩·오프셋 변이가 죽는다
- dev 에 0, 양수, 음수, 두 센티널, DEV_MAX, DEV_MIN, 임계값 경계(70, 71, -70, -71)가 있다
- Q 에 상·하위 바이트가 다른 값(258 = 0x0102, 772 = 0x0304, 1286 = 0x0506)이 있다: 엔디안 변이가 죽는다
- 7번 점은 z 가 최댓값인데 센티널이다: fit_bounds 가 전체 범위보다 작다
"""
from pathlib import Path

import numpy as np

from flatness.core.pointsample import PointSample

GOLDEN_PATH = Path(__file__).with_name("points3d_golden.bin")

ORIGIN_ABS = (254012.3371, 4180044.9126, 31.4802)   # 절대 좌표 원점(m)
MN = (0.5, 0.25, 0.125)                             # 표본 로컬 좌표의 축별 최솟값(m)
EXT = (4.0, 2.5, 0.3125)                            # 축별 범위(m)
SAMPLE_CELL_M = 0.0125
SOURCE_POINTS = 12345
CAP = 500000

# 행 = 점, 열 = (qx, qy, qz). 작성기가 양자화하면 이 값이 그대로 나와야 한다
Q = (
    (0, 0, 0),
    (65535, 65535, 4096),
    (258, 772, 1286),
    (32768, 16384, 8192),
    (1, 65534, 2),
    (40000, 20000, 10000),
    (12345, 54321, 23456),
    (100, 200, 65535),
    (50000, 60000, 300),
    (65280, 255, 4660),
    (4660, 43981, 291),
    (21845, 43690, 13107),
)

# 0.1mm 정수 편차. 7번 = DEV_NOT_FLOOR, 8번 = DEV_NO_DEVIATION, 9번 = DEV_MAX, 10번 = DEV_MIN
DEV = (0, 32, -105, 70, 71, -70, -71, -32768, -32767, 32767, -32766, 1)


def golden_sample() -> PointSample:
    """골든 표본. 부를 때마다 같은 값을 새 배열로 돌려준다."""
    q = np.array(Q, dtype=np.float64)
    xyz_local = np.array(MN, dtype=np.float64) + q * np.array(EXT, dtype=np.float64) / 65535.0
    return PointSample(
        xyz_local=xyz_local,
        dev_q=np.array(DEV, dtype=np.int16),
        origin_abs=np.array(ORIGIN_ABS, dtype=np.float64),
        sample_cell_m=SAMPLE_CELL_M,
        source_points=SOURCE_POINTS,
        cap=CAP,
    )


if __name__ == "__main__":
    import hashlib

    from flatness.outputs.points3d import write_points3d

    write_points3d(golden_sample(), GOLDEN_PATH)
    data = GOLDEN_PATH.read_bytes()
    print(f"{GOLDEN_PATH.name}: {len(data)} bytes, sha256 {hashlib.sha256(data).hexdigest()}")
```

- [ ] **Step 13: 실패 확인 (골든 파일 없음)**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_points3d.py -q
```

Expected: `2 failed, 81 passed`. 실패는 `test_golden_file_matches_encoder_byte_for_byte` 와 `test_golden_file_content_by_hand` 이고 사유는 `FileNotFoundError: ... points3d_golden.bin`.

- [ ] **Step 14: 골든 파일 생성**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m tests.fixtures.points3d_golden
```

Expected (한 줄, 글자 그대로):

```
points3d_golden.bin: 488 bytes, sha256 b0c50d8a0f2e77e3077c6b38fb6795cc89bf321601c56fb8a3e855efbc6892d9
```

크기나 해시가 다르면 `encode_points3d` 가 스펙 §5.4 와 다른 것이다. 테스트의 `GOLDEN_SHA256` 이나 `488` 을 고치지 말고 구현을 Step 4 의 코드와 대조해 고친 뒤 이 명령을 다시 돌린다.

- [ ] **Step 15: 통과 확인**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_points3d.py -q
```

Expected: `83 passed`.

- [ ] **Step 16: 변이 실험 (이 태스크 몫 7종)**

`engine/flatness/outputs/points3d.py` 에 아래 변이를 **하나씩** 넣고 Step 15 의 명령을 돌려 표의 테스트가 실제로 죽는지 확인한 뒤 되돌린다. 하나라도 살아남으면 멈추고 보고한다(테스트가 회귀를 못 잡는다는 뜻이다).

| # | 바꿀 곳(원래 코드) | 변이 | 죽어야 하는 테스트(최소) |
|---|---|---|---|
| 1 | `.astype("<u2")` (`encode_points3d`) | `.astype(">u2")` | `test_encode_byte_layout_hand_sample`, `test_golden_file_matches_encoder_byte_for_byte` |
| 2 | `js += b" " * ((-(8 + len(js))) % 4)` | 이 줄 삭제 | `test_encode_pads_json_with_spaces_to_4_byte_boundary`, `test_golden_file_matches_encoder_byte_for_byte` |
| 3 | `q.tobytes() + dev.tobytes()` | `np.ascontiguousarray(q.T).tobytes() + dev.tobytes()` | `test_encode_byte_layout_hand_sample`, `test_golden_file_matches_encoder_byte_for_byte` |
| 4 | `"not_floor": DEV_NOT_FLOOR, "no_deviation": DEV_NO_DEVIATION` | `"not_floor": DEV_NO_DEVIATION, "no_deviation": DEV_NOT_FLOOR` | `test_encode_meta_keys_order_and_values`, `test_golden_file_matches_encoder_byte_for_byte` |
| 5 | `if size != 8 + json_len + 8 * n:` 와 그 아래 `raise ValueError("size_mismatch")` | 두 줄 삭제 | `test_reader_size_mismatch` |
| 6 | `write_points3d` 의 `try: path.unlink(missing_ok=True)` / `except OSError: pass` 네 줄 | 네 줄 삭제(`raise` 는 남긴다) | `test_write_points3d_removes_partial_file_on_failure` |
| 7 | `if n > MAX_POINTS:` | `if n > sample.cap:` | `test_cap_is_checked_against_engine_constant_not_sample_cap`, `test_sample_cap_is_recorded_but_not_enforced` |

전부 되돌린 뒤 Step 15 의 명령을 한 번 더 돌려 `83 passed` 를 확인한다. 변이를 넣은 채로 Step 14 의 골든 생성 명령을 돌리지 않는다(골든이 틀린 형식으로 덮인다. 덮였다면 `test_golden_file_matches_encoder_byte_for_byte` 의 해시 단언이 실패한다. 구현을 되돌리고 Step 14 를 다시 돌린다).

- [ ] **Step 17: 엔진 전체 스위트**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q
```

Expected: `364 passed, 1 deselected`. 실패 0. 364 = Task 2 Step 11 의 `281 passed`(2026-10-02 기준선 244 + Task 1 의 18 + Task 2 의 19) + 이 태스크의 83. 약 2~3분 걸린다. 수가 다르면 멈추고 실패 출력을 보고한다.

- [ ] **Step 18: 커밋**

골든이 바이너리로 들어가는지 먼저 확인한다(이 저장소는 `core.autocrlf=true` 다. 줄바꿈 변환이 걸리면 골든이 깨진다).

```bash
cd D:/Projects/Flatness && git add engine/flatness/outputs/points3d.py engine/tests/test_points3d.py engine/tests/fixtures/points3d_golden.py engine/tests/fixtures/points3d_golden.bin && git diff --cached --stat && git ls-files -s engine/tests/fixtures/points3d_golden.bin
```

Expected: `engine/tests/fixtures/points3d_golden.bin | Bin 0 -> 488 bytes` 줄이 있고, `git ls-files -s` 의 blob 해시가 `ac91bc3c7af3c8a4e5a39fbdeaa251ec87994796` 이다(488바이트 원본 그대로의 해시). 스테이징된 파일은 이 4개뿐이어야 한다.

```bash
cd D:/Projects/Flatness && git commit -m "$(cat <<'EOF'
feat(engine): points3d.bin 작성기·리더와 형식 골든

3D 점군 뷰어가 읽는 점 표본 컨테이너(schema_version 1)를 구현한다.
- encode_points3d: 축 범위를 uint16 으로 양자화하고 JSON 메타를 4바이트 경계까지 공백으로 채운다.
  메타에는 판정 기준에 종속된 값을 넣지 않는다(기준을 바꿔 재분석해도 바이트 동일).
- write_points3d: blob 을 한 번에 쓰고, 쓰는 중 예외면 부분 파일을 지운다. 상한은 엔진 상수 MAX_POINTS 와 비교한다.
- read_points3d: 리더 규칙 7종을 차례로 검사하고 사유 문자열로 실패한다.
- 골든 points3d_golden.bin(488바이트): pytest 와 대시보드 vitest 가 같은 파일을 읽는다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**계획 작성 시 검증 기록** (2026-10-02, 저장소 밖 스크래치 `.superpowers/plan-drafts/pointcloud-viewer/scratch-03/` 에서 `PointSample`·상수만 가진 최소 대역을 두고 실행)

- Step 3·5·7·9·11·13·15 의 기대 출력은 실제로 그 상태를 만들어 확인한 값이다(1 error → 25 passed → 55 failed, 25 passed → 80 passed → 1 error → 2 failed, 81 passed → 83 passed).
- Step 14 의 크기 488 과 sha256 은 이 계획의 구현으로 실제 생성한 값이고, 뼈대 설계 때 탐침으로 계산한 값과 같다.
- Step 16 의 7종을 포함해 변이 36종을 넣어 전부 죽는 것을 확인했다(살아남은 변이 0).
- Step 18 의 blob 해시는 `core.autocrlf=true` 인 임시 저장소에서 `git add` 한 결과이고 `git hash-object --no-filters` 값과 같다(변환 없음).

**재검증 기록** (2026-10-03, 중단된 작업을 이어받아 위 기록을 다시 돌려 확인한 것. `scratch-03/cycle/` 에서 실행)

- 이 문서의 python 코드 블록만으로 세 파일을 다시 조립해(`scratch-03/extract_from_plan.py`, Step 2+6+10 → 테스트, Step 4+8 → 모듈, Step 12 → 픽스처) 검증에 쓴 스크래치 파일과 글자 단위로 같음을 확인했다. 즉 계획 본문의 코드가 곧 검증된 코드다.
- Step 1·3·5·7·9·11·13·14·15 를 빈 복사본에서 순서대로 다시 밟아 기대 출력과 글자 그대로 일치했다: `1 error`(ImportError) → `25 passed` → `55 failed, 25 passed`(55건 전부 `has no attribute 'read_points3d'`) → `80 passed` → `1 error`(ModuleNotFoundError) → `2 failed, 81 passed`(FileNotFoundError 2건) → `points3d_golden.bin: 488 bytes, sha256 b0c50d8a…892d9` → `83 passed`.
- 변이 36종(`scratch-03/mutate.py`)을 다시 넣어 36 KILLED / 0 SURVIVED. Step 16 표의 7종은 표에 적은 "최소" 테스트가 실제 실패 목록에 들어 있다.
- 엔진 전체 스위트(스크래치 복사본): `326 passed, 1 failed, 1 deselected`. 실패 1건은 `test_summary.py::test_warn_text_is_subset_of_documented_warning_codes` 이고 사유는 스크래치에 `docs/contracts/stats-schema.md` 가 없어서 난 `FileNotFoundError`(그 테스트는 `Path(__file__).parents[2]/docs/...` 를 읽는다). `docs/contracts` 를 복사하면 `7 passed`. Task 3 파일과 무관하다. 이 327(= 244 + 83)은 스크래치 복사본에 Task 1·2 의 `test_pointsample.py`(37건)가 없던 상황의 수치다. 실제 저장소에서는 Task 2 Step 11 의 `281 passed`(244 + Task 1 18 + Task 2 19) + 83 = `364 passed, 1 deselected` 가 기대값이다(Step 17 의 식과 같다).
- 골든 488바이트가 `scratch-03/keep/golden.bin` 과 바이트 동일. `core.autocrlf=true` 임시 저장소에서 `git add` → `git ls-files -s` 해시 `ac91bc3c7af3c8a4e5a39fbdeaa251ec87994796`, `git diff --cached --stat` 에 `Bin 0 -> 488 bytes`.
- 계획 본문 검사: U+2014 0건, '발주처' 0건, 자리표시어(TBD/TODO/적절히/비슷하게) 0건, 태스크 헤더 1개.

**지적 반영 후 재검증** (2026-10-03, 단위 상수를 `DEV_UNIT_M * 1000` 으로 유도하도록 Step 4 를 고치고 `test_module_constants` 에 `p3.DEV_UNIT_M` 단언을 더한 뒤. `scratch-03/revise/` 에서 실행. 이 사본은 저장소 `engine/` + Task 1·2 의 두 파일(`scratch-02/engine`) + 이 문서에서 다시 꺼낸 세 파일이다)

- `<py>` 에서 `1e-4 * 1000 == 0.1` 은 True, `repr` 은 `'0.1'`, `float.hex()` 가 `0x1.999999999999ap-4` 로 리터럴 `0.1` 과 같은 double 이다. 따라서 JSON 바이트와 골든이 바뀌지 않는다.
- Step 3·5·7·9·11·13·14·15 를 다시 밟아 기대 출력과 일치: `1 error` → `25 passed` → `55 failed, 25 passed`(55건 전부 `read_points3d` AttributeError) → `80 passed` → `1 error` → `2 failed, 81 passed` → `points3d_golden.bin: 488 bytes, sha256 b0c50d8a…892d9` → `83 passed`. 생성된 골든은 `scratch-03/keep/golden.bin` 과 바이트 동일(`cmp`).
- 변이 38종(기존 36종 + 수정 전 상태로 되돌리는 변이 "import 에서 `DEV_UNIT_M` 삭제 + `_DEV_UNIT_MM = 0.1`" + "`DEV_UNIT_M * 100`") 38 KILLED / 0 SURVIVED. 되돌리기 변이는 `test_module_constants` 만이 잡는다(값이 같아 다른 테스트는 통과한다). `_DEV_UNIT_MM = 0.1` 리터럴을 import 는 둔 채 넣는 변이는 동작이 같은 등가 변이라 테스트로 잡지 않는다. 구현 규칙 11 과 코드 리뷰가 막는다.
- 엔진 전체 스위트(Task 1·2 테스트 포함): `364 passed, 1 deselected`(70초). Step 17 의 기대값과 같다.

---
### Task 4: 엔진: `analyze_floor` 파이프라인 삽입과 성능 테스트 단언

**목표:** `analyze_floor`가 `points3d.bin`을 만들고 stats에 `points3d_paths`·`points3d_threshold_q`를 기록하며, 점 파일 생성 실패가 판정과 기존 산출물에서 완전히 격리된다(CLI 실행에도 같은 파일이 생긴다).

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.2 E1·S1~S3, §4.4, §4.5, §4.6, §6.1(엔진이 기록하는 부분), §6.2(발생 경로), §10.1(test_pipeline 표, perf), §10.5(엔진: 새 블록을 히트맵 try 에 합침, 임계값을 `rework_mm` 에서 유도, 부분 파일 남김, 표 아래 '기존 격리 테스트 하중' 문단), §11(엔진).

**Files:**
- Create: 없음
- Modify: `engine/flatness/core/pipeline.py:6-19`(import 블록. `:10` 다음과 `:18` 다음에 한 줄씩 추가), `:96-100`(히트맵 렌더 블록 `:96-99` 와 `if render_warns:` `:100` 사이에 새 블록 삽입)
- Modify: `engine/tests/test_pipeline.py:1-4`(import 교체), `:242` 뒤(파일 끝에 테스트 함수 6개 추가. 하나가 매개변수 2개라 pytest 항목은 7건)
- Modify: `engine/tests/perf/test_memory_spike.py:11` 다음(상수 추가), `:14-29`(`_write_big_ply`), `:56-70`(테스트 함수)
- Test: `engine/tests/test_pipeline.py`, `engine/tests/perf/test_memory_spike.py`
- 읽기만 한다(고치지 않는다): `engine/flatness/core/pipeline.py:37-75`(2번째 패스와 판정 단계), `:106-173`(`analyze_wall`), `engine/flatness/outputs/stats.py:62-72`(`write_outputs`), `engine/flatness/outputs/summary.py`(`_WARN_TEXT`), `engine/flatness/cli.py:142-147`, `engine/tests/test_pipeline.py:184-212`(기존 렌더 격리 테스트)

**Interfaces:**
- Consumes:
  - T2: `sample_points(chunks, info, scale_to_m, grid, zmap, residuals, max_points=MAX_POINTS) -> PointSample` (`flatness.core.pointsample`)
  - T3: `write_points3d(sample: PointSample, out_path) -> str`, `FILE_NAME = "points3d.bin"`, (테스트에서) `read_points3d(data: bytes) -> tuple[dict, np.ndarray, np.ndarray]` (`flatness.outputs.points3d`). `read_points3d` 가 돌려주는 것은 (meta dict, xyz_q uint16 (n, 3), dev_q int16 (n,)) 이고 meta 에는 `n_points`, `origin_m`, `extent_m`, `sampling.source_points` 가 있다. 복원 식은 `절대 좌표 = origin_m + q * extent_m / 65535`
  - 기존 `analyze_floor(path, scale_to_m, criterion, u_mm, out_dir, subcell_m=0.05, cell_m=1.0, chunk_size=2_000_000)` 의 지역 변수 `info`, `grid`, `zmap`, `residuals`, `render_warns`, `stats`, `criterion.pass_mm`
  - 기존 `flatness.criteria.load_criteria()["floor-kcs-exposed"]`(pass_mm 7, rework_mm 21), `["floor-lh-exposed"]`(pass_mm 6, rework_mm 18), `["wall-kcs-tilt-other"]`
  - 기존 픽스처 `tests.fixtures.synthetic`: `flat_floor(size=(6.0, 6.0), spacing=0.02, ...)`, `flat_wall(length, height, spacing, y0, axis)`, `add_bump(pts, center, radius, height)`, `write_binary_ply(pts, path)`
- Produces:
  - `pipeline.py` 모듈 전역 이름(테스트가 monkeypatch 한다): `sample_points`, `write_points3d`, `POINTS3D_FILE`(= `FILE_NAME`). import 는 모듈 최상단: `from flatness.core.pointsample import sample_points`, `from flatness.outputs.points3d import FILE_NAME as POINTS3D_FILE, write_points3d`
  - `analyze_floor` 반환 stats 와 저장된 stats.json: 성공 시 `points3d_paths == ["points3d.bin"]`, `points3d_threshold_q == int(round(criterion.pass_mm * 10))`. 실패 시 `points3d_paths == []`, `points3d_threshold_q` 키 없음, `warnings` 에 `points3d_render_failed`, out_dir 에 points3d.bin 없음
  - `out_dir / "points3d.bin"` (T16 의 하네스가 CLI 로 만들어 쓴다)
  - `engine/tests/perf/test_memory_spike.py`: `_write_big_ply(path, n_points=N_POINTS)` 로 매개변수화, `test_30m_points_within_budget`(단언 추가), `test_3m_points_within_budget`(신설, `@pytest.mark.perf`)

**배경(이 태스크만 읽는 사람을 위한 설명):**

- `analyze_floor` 는 스캔 파일을 두 번 읽는다. 1번째 패스 `read_info`(점 수와 bbox), 2번째 패스 `build_subcell_grid`(5cm 서브셀 중앙값). 그 뒤 구역·잔차·셀 판정을 하고 stats 를 만든 다음, 보조 그림 3종(3D 프리뷰 PNG, 정밀 편차맵 PNG, 히트맵 PNG)을 각각 독립 try/except 로 그린다. 그림이 실패해도 판정은 저장돼야 하므로 실패는 `render_warns` 에 경고 코드로만 남는다(`pipeline.py:78-101`).
- 이 태스크는 그 세 블록 뒤에 **네 번째 독립 블록**을 넣는다. 파일을 한 번 더 스트리밍(3번째 패스)해 점 표본을 뽑고(`sample_points`, T2) `points3d.bin` 으로 쓴다(`write_points3d`, T3). 대시보드의 3D 점군 뷰어가 이 파일을 읽는다.
- stats 에 키 두 개를 더한다. `points3d_paths` 는 다른 `*_paths` 키와 같은 규약(파일명만, 실패하면 빈 목록)이고, `points3d_threshold_q` 는 뷰어의 기본 표시 임계값(0.1mm 단위 정수 = 허용치 `pass_mm` × 10)이다. 임계값은 점 파일이 만들어졌을 때만 기록한다. 판정에는 쓰이지 않는다.
- 워커는 분석이 끝나면 `out_dir` 의 **모든 파일**을 저장소에 올린다(`worker/flatworker/storage.py:54-65`). 그래서 쓰다 만 `points3d.bin` 이 `out_dir` 에 남으면 깨진 파일이 올라간다. 실패 경로에서 반드시 지운다.
- `flatness analyze`(CLI)는 `analyze_floor` 를 그대로 부른다(`cli.py:142-147`). CLI 옵션을 추가하지 않아도 CLI 실행에 `points3d.bin` 이 생긴다.
- 이 태스크는 `analyze_floor` 만 고친다. `analyze_wall`, `analyze_slope`, `judge_slope_cells`, 임포터, `outputs/summary.py` 의 `_WARN_TEXT`, 워커 코드, `ENGINE_VERSION` 은 건드리지 않는다. 계약 문서(`docs/contracts/stats-schema.md`)와 경고 라벨 사전은 다음 태스크(Task 5)가 같은 브랜치에서 고친다.

**함정:**

1. 3번째 패스는 `iter_chunks(path, chunk_size=chunk_size)` 를 **새로 연다**. 2번째 패스의 제너레이터는 이미 소진됐다. `chunk_size` 를 빼먹어도 출력 바이트는 같아서(표본기는 청크 크기에 불변이다) 바이트 비교만으로는 잡히지 않는다. 그래서 청크 크기 테스트는 `sample_points` 가 실제로 받은 청크 길이도 단언한다.
2. import 는 모듈 최상단에 둔다. 테스트가 `monkeypatch.setattr(pl, "sample_points", ...)` 로 갈아끼우려면 이름이 `pipeline` 모듈 전역에 있어야 한다(`pipeline.py:20-24` 의 기존 주석과 같은 이유). 함수 안 지역 import 로 쓰면 monkeypatch 가 듣지 않는다.
3. 새 블록을 기존 히트맵 try 안에 넣지 않는다. 히트맵 앞에 넣으면 점 파일 실패가 히트맵을 건너뛰게 하고, 뒤에 넣으면 히트맵 실패가 점 파일을 건너뛰게 한다. 두 방향 모두 테스트가 잡는다.
4. 임계값은 `criterion.pass_mm` 에서만 유도한다. `rework_mm`, 불확도 `u_mm`, 스팬 환산을 섞지 않는다.
5. `stats.pop("points3d_threshold_q", None)` 은 스펙 §4.4 블록에 있는 방어 코드다. try 안에서 임계값 대입이 쓰기 뒤에 있으므로 지금 순서에서는 실패 시 키가 애초에 없다. 이 줄만 지우는 변이는 동작이 같아(동치 변이) 어떤 테스트로도 죽지 않는다. 그래도 지우지 않는다(스펙 블록을 글자 그대로 넣는다). 테스트가 잡는 것은 "임계값 대입을 쓰기 앞으로 옮기고 pop 을 지운" 변이다.
6. 종합의견(`auto_summary`)은 삽입 지점보다 앞(`pipeline.py:75`)에서 만들어진다. `_WARN_TEXT` 에 새 코드를 넣지 않는다.
7. `engine/tests/test_summary.py` 의 경고 코드 개수 단언(12)은 이 태스크에서 고치지 않는다. 그 테스트는 계약 문서를 파싱하고, 문서는 Task 5 가 고친다. 이 태스크만 적용한 상태에서 엔진 스위트는 통과한다.
8. 기존 `test_floor_render_failure_does_not_lose_judged_result`(`test_pipeline.py:184-212`)는 고치지 않는다.
9. 성능 테스트는 기본 스위트에서 빠진다(`pyproject.toml` 의 `addopts = "-m 'not perf'"`). 성능 테스트를 하나 더하므로 기본 실행의 `deselected` 가 1 에서 2 로 바뀐다. 3천만 점 전체 실행은 Task 16 이 한다. 이 태스크에서는 `-k 3m` 만 돌린다.
10. 작업 트리의 파이썬 파일은 CRLF 줄 끝이다(`core.autocrlf=true`, 저장소에는 LF 로 들어간다). 줄 끝을 따로 바꾸지 않는다.

**실행 환경:**

```
<py>  = D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe   (3.14. 기본 python 3.9 는 쓰지 않는다)
셸    = Git Bash, 경로는 forward slash
엔진  = cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -q
워커  = cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -q
```

- [ ] **Step 1: 앞 태스크 산출물과 기준선 확인**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -c "from flatness.core.pointsample import sample_points, MAX_POINTS; from flatness.outputs.points3d import FILE_NAME, write_points3d, read_points3d; print(FILE_NAME, MAX_POINTS)"
```

Expected: `points3d.bin 500000`. ImportError 가 나면 Task 2·3 이 끝나지 않은 것이다. 멈추고 보고한다.

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q
```

Expected: 전부 통과, `1 deselected`. 마지막 줄의 통과 수를 적어 둔다(아래에서 `N` 이라 부른다. Task 1~3 이 테스트를 더했으므로 244 보다 크다).

- [ ] **Step 2: `test_pipeline.py` import 교체**

`engine/tests/test_pipeline.py:1-4` 를 바꾼다.

바꾸기 전:

```python
import numpy as np
from tests.fixtures.synthetic import flat_floor, flat_wall, add_bump, add_step, write_binary_ply
from flatness.core.pipeline import analyze_floor, analyze_wall
from flatness.criteria import load_criteria
```

바꾼 뒤:

```python
import json
from pathlib import Path
import numpy as np
import pytest
from tests.fixtures.synthetic import flat_floor, flat_wall, add_bump, add_step, write_binary_ply
from flatness.core import pipeline as pl
from flatness.core.pipeline import analyze_floor, analyze_wall
from flatness.criteria import load_criteria
from flatness.outputs.points3d import read_points3d
```

그 아래 `CRIT = load_criteria()["floor-kcs-exposed"]`(`:6`)와 기존 테스트 14건은 그대로 둔다(기존 테스트 안의 지역 import 도 그대로 둔다).

- [ ] **Step 3: 실패하는 테스트 작성(`test_pipeline.py` 끝에 테스트 함수 6개, pytest 항목 7건 추가)**

`engine/tests/test_pipeline.py` 의 마지막 줄(`:242`, `test_wall_render_failure_isolated_per_wall` 의 끝) 뒤에 아래를 그대로 붙인다.

```python


# ---- 3D 점군 뷰어용 점 파일 points3d.bin (스펙 2026-10-02 §4.4, §4.5, §6.1) ----

# 점 파일 생성이 실패해도 그대로여야 하는 판정 수치(스펙 §4.5 목록)
POINTS3D_JUDGED_KEYS = ("grade_counts", "worst", "value_max_mm", "value_min_mm",
                        "value_mean_mm", "value_p95_mm", "coverage_pct",
                        "applied_criteria", "zones")


def _dent_scan(dirpath):
    """6x6m 평탄 바닥(2cm 간격, 301 x 301 = 90,601점) + (2, 2)에 반경 0.3m, 깊이 10mm 함몰."""
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010)
    path = dirpath / "scan.ply"
    write_binary_ply(pts, path)
    return path


def test_floor_points3d_generated(tmp_path):
    scan = _dent_scan(tmp_path)
    out = tmp_path / "out"

    stats = pl.analyze_floor(scan, 1.0, CRIT, 5.0, out)

    assert stats["points3d_paths"] == ["points3d.bin"]
    assert (out / "points3d.bin").is_file()
    # 표시 임계값 = pass_mm 7 x 10 = 70 (0.1mm 정수). rework_mm(21)에서 유도하면 210 이 된다
    assert stats["points3d_threshold_q"] == 70
    assert type(stats["points3d_threshold_q"]) is int
    # 보고서가 preview3d_paths 의 파일을 3D 프리뷰 그림으로 복사하므로 점 파일이 섞이면 안 된다
    assert stats["preview3d_paths"] != []
    assert "points3d.bin" not in stats["preview3d_paths"]
    assert "points3d_render_failed" not in stats["warnings"]
    saved = json.loads((out / "stats.json").read_text("utf-8"))
    assert saved["points3d_paths"] == ["points3d.bin"]     # write_outputs 이전에 기록돼야 한다
    assert saved["points3d_threshold_q"] == 70
    # 파일 내용이 이 스캔의 것인지 본다: 3번째 패스가 읽은 점 수, 함몰의 깊이와 위치
    meta, xyz_q, dev_q = read_points3d((out / "points3d.bin").read_bytes())
    assert meta["sampling"]["source_points"] == 301 * 301
    assert 1 <= meta["n_points"] == len(dev_q) <= 500_000
    i = int(np.argmin(np.where(dev_q > -32767, dev_q, 32767)))   # 센티널을 뺀 최솟값의 위치
    assert -110 <= int(dev_q[i]) <= -90      # 10mm 함몰 = -100 (0.1mm 단위). 기존 e2e 와 같은 +-1mm 허용
    x = meta["origin_m"][0] + float(xyz_q[i, 0]) * meta["extent_m"][0] / 65535
    y = meta["origin_m"][1] + float(xyz_q[i, 1]) * meta["extent_m"][1] / 65535
    assert abs(x - 2.0) < 0.1 and abs(y - 2.0) < 0.1


def _points3d_sample_boom(*args, **kwargs):
    raise RuntimeError("주입된 표본 추출 실패")


def _points3d_write_partial_then_boom(sample, out_path):
    # 머리 4바이트만 쓰고 죽는 작성기. out_dir 에 부분 파일이 남는 상황을 만든다
    Path(out_path).write_bytes(b"FP3D")
    raise OSError("주입된 쓰기 실패(디스크 가득 참 모사)")


@pytest.mark.parametrize("target, fake", [
    ("sample_points", _points3d_sample_boom),
    ("write_points3d", _points3d_write_partial_then_boom),
])
def test_floor_points3d_failure_isolated(tmp_path, monkeypatch, target, fake):
    # 점 파일 생성만 실패한 실행을 정상 실행과 비교한다(같은 스캔, 서로 다른 출력 폴더)
    scan = _dent_scan(tmp_path)
    ok_out, bad_out = tmp_path / "ok", tmp_path / "bad"
    ok = pl.analyze_floor(scan, 1.0, CRIT, 5.0, ok_out)
    monkeypatch.setattr(pl, target, fake)

    bad = pl.analyze_floor(scan, 1.0, CRIT, 5.0, bad_out)

    # 대조군: 정상 실행은 실제로 점 파일을 만들었다
    assert ok["points3d_paths"] == ["points3d.bin"] and (ok_out / "points3d.bin").is_file()
    for key in POINTS3D_JUDGED_KEYS:
        assert bad[key] == ok[key], key
    # 점 파일과 무관한 나머지 stats(종합의견, meta, 다른 산출물 목록)도 그대로다
    drop = ("points3d_paths", "points3d_threshold_q", "warnings")
    assert ({k: v for k, v in bad.items() if k not in drop}
            == {k: v for k, v in ok.items() if k not in drop})
    # 늘어난 경고는 정확히 하나다(다른 렌더 블록이 함께 실패하지 않았다)
    assert set(bad["warnings"]) - set(ok["warnings"]) == {"points3d_render_failed"}
    assert set(ok["warnings"]) <= set(bad["warnings"])
    assert bad["points3d_paths"] == []
    assert "points3d_threshold_q" not in bad
    assert not (bad_out / "points3d.bin").exists()       # 워커가 out_dir 의 모든 파일을 올린다
    for name in ("cells.json", "results.csv"):
        assert (bad_out / name).read_bytes() == (ok_out / name).read_bytes(), name
    for name in ("heatmap.png", "preview3d.png", "deviation.png"):
        assert (bad_out / name).stat().st_size > 0, name
    assert bad["preview3d_paths"] == ok["preview3d_paths"] != []
    assert bad["deviation_paths"] == ["deviation.png"]
    saved = json.loads((bad_out / "stats.json").read_text("utf-8"))
    assert saved["points3d_paths"] == []
    assert "points3d_threshold_q" not in saved
    assert "points3d_render_failed" in saved["warnings"]


def test_floor_points3d_block_independent_of_other_renders(tmp_path, monkeypatch):
    # 기존 렌더 3종이 전부 실패해도 점 파일은 만들어진다(새 블록은 독립 try/except)
    def boom(*args, **kwargs):
        raise RuntimeError("주입된 렌더 실패")

    monkeypatch.setattr(pl, "render_heatmap", boom)
    monkeypatch.setattr(pl, "render_preview3d", boom)
    monkeypatch.setattr(pl, "render_deviation_map", boom)
    scan = _dent_scan(tmp_path)
    out = tmp_path / "out"

    stats = pl.analyze_floor(scan, 1.0, CRIT, 5.0, out)

    assert stats["points3d_paths"] == ["points3d.bin"]
    assert (out / "points3d.bin").is_file()
    assert stats["points3d_threshold_q"] == 70
    assert "points3d_render_failed" not in stats["warnings"]
    # 주입이 실제로 걸렸다(세 렌더는 실패했다)
    assert stats["preview3d_paths"] == [] and stats["deviation_paths"] == []
    assert not (out / "heatmap.png").exists()
    for code in ("heatmap_render_failed", "preview3d_render_failed", "deviation_render_failed"):
        assert code in stats["warnings"]


def test_floor_points3d_bytes_do_not_depend_on_criterion(tmp_path):
    scan = _dent_scan(tmp_path)
    lh = load_criteria()["floor-lh-exposed"]       # pass 6 / rework 18

    a = pl.analyze_floor(scan, 1.0, CRIT, 5.0, tmp_path / "kcs")
    b = pl.analyze_floor(scan, 1.0, lh, 5.0, tmp_path / "lh")

    # 대조군: 두 실행의 기준이 실제로 달랐다
    assert a["applied_criteria"]["pass_mm"] == 7 and b["applied_criteria"]["pass_mm"] == 6
    assert a["points3d_threshold_q"] == 70         # 7mm x 10
    assert b["points3d_threshold_q"] == 60         # 6mm x 10
    blob_a = (tmp_path / "kcs" / "points3d.bin").read_bytes()
    blob_b = (tmp_path / "lh" / "points3d.bin").read_bytes()
    assert len(blob_a) > 8 + 8 * 1000              # 빈 파일끼리의 일치가 아니다
    assert blob_a == blob_b


def test_floor_points3d_chunk_size_invariant(tmp_path, monkeypatch):
    scan = _dent_scan(tmp_path)
    pl.analyze_floor(scan, 1.0, CRIT, 5.0, tmp_path / "default")
    seen = []
    real = pl.sample_points

    def spy(chunks, *args, **kwargs):
        # 3번째 패스가 받는 청크 크기를 기록하고 실제 함수로 넘긴다
        def tap():
            for c in chunks:
                seen.append(len(c))
                yield c
        return real(tap(), *args, **kwargs)

    monkeypatch.setattr(pl, "sample_points", spy)

    pl.analyze_floor(scan, 1.0, CRIT, 5.0, tmp_path / "small", chunk_size=50_000)

    # 90,601점이 5만 점 청크 둘로 왔다. chunk_size 를 넘기지 않으면 [90601] 이 된다
    assert seen == [50_000, 40_601]
    assert ((tmp_path / "small" / "points3d.bin").read_bytes()
            == (tmp_path / "default" / "points3d.bin").read_bytes())


def test_wall_has_no_points3d(tmp_path):
    # 범위 가드: 점 파일은 바닥 분석만 만든다(벽면은 키도 파일도 없다)
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0)])
    write_binary_ply(pts, tmp_path / "room.ply")
    crit = load_criteria()["wall-kcs-tilt-other"]

    stats = pl.analyze_wall(tmp_path / "room.ply", 1.0, crit, 8.0, tmp_path / "out")

    saved = json.loads((tmp_path / "out" / "stats.json").read_text("utf-8"))
    for key in ("points3d_paths", "points3d_threshold_q"):
        assert key not in stats
        assert key not in saved
    assert not (tmp_path / "out" / "points3d.bin").exists()
```

기대값의 근거(구현 출력을 베낀 값이 아니다):

| 값 | 근거 |
|---|---|
| `70`, `60` | `floor-kcs-exposed` 의 `pass_mm` 7, `floor-lh-exposed` 의 `pass_mm` 6(`engine/flatness/data/seed_criteria.json`). 0.1mm 단위이므로 × 10. `rework_mm` 는 21·18 이라 그쪽에서 유도하면 210·180 이 된다 |
| `301 * 301` | `flat_floor(size=(6.0, 6.0), spacing=0.02)` 는 축마다 `np.arange(0.0, 6.01, 0.02)` = 0.00, 0.02, ..., 6.00 의 301개 값을 쓴다. 301² = 90,601점 |
| `[50_000, 40_601]` | PLY 리더는 `chunk_size` 행씩 끊어 낸다. 90,601 − 50,000 = 40,601 |
| `-110 <= dev <= -90` | `add_bump(..., height=-0.010)` 의 정점 깊이는 정확히 10mm = 잔차 −0.010m = 0.1mm 단위로 −100. 색의 기준값은 5cm 서브셀 중앙값의 잔차라 정점보다 조금 얕다(중심 서브셀 `[2.00, 2.05)²` 의 9점은 깊이 9.15~10.0mm, 중앙값 9.57mm). 허용 폭은 기존 e2e 단언 `9.0 <= worst <= 11.0`(`test_pipeline.py:15`)과 같은 ±1mm |
| `abs(x - 2.0) < 0.1` | 가장 깊은 서브셀은 함몰 중심 (2, 2)에 닿아 있고 서브셀 변이 0.05m 다. 그 안의 어떤 점도 축마다 중심에서 0.05m 이내다 |
| `8 + 8 * 1000` | 파일은 `8 + json_len + 8n` 바이트다. 36m² 바닥에서 표본은 수만 점이므로 1,000점분보다 훨씬 크다 |

각 테스트가 죽이는 변이(스크래치 사본에서 변이를 하나씩 넣어 실제로 확인한 결과):

| 테스트 | 스펙 §10.1 행 | 죽이는 변이 |
|---|---|---|
| `test_floor_points3d_generated` | 생성 | 임계값을 `rework_mm` 에서 유도(210), 임계값에서 U 를 뺌(20), × 10 누락(7), `points3d.bin` 을 `preview3d_paths` 에 넣음, 새 블록을 `write_outputs` 뒤로 옮김(stats.json 에 키 없음), 파일명 대신 전체 경로를 기록, `scale_to_m` 을 잘못 넘김(함몰 위치·깊이 불일치) |
| `test_floor_points3d_failure_isolated[sample_points-...]` | 격리, 독립 블록(반대 방향) | 새 블록을 히트맵 try 에 합침(히트맵 경고가 함께 붙거나 히트맵이 안 그려짐), 임계값을 먼저 기록하고 pop 을 지움(실패 시 키가 남음), 실패 경고 누락, 실패 시 `points3d_paths` 미기록(KeyError), 새 블록에 try 없음(예외가 분석 전체를 죽임) |
| `test_floor_points3d_failure_isolated[write_points3d-...]` | 격리 | 위와 같고, 추가로 **실패 시 부분 파일을 남김**(안쪽 `unlink` 제거). 이 변이는 이 매개변수만 죽인다 |
| `test_floor_points3d_block_independent_of_other_renders` | 독립 블록 | 새 블록을 히트맵 try 안, `render_heatmap` 뒤에 넣음(히트맵 실패가 점 파일을 건너뜀) |
| `test_floor_points3d_bytes_do_not_depend_on_criterion` | 기준 무관 바이트 동일 | 임계값 70 고정, 임계값을 `rework_mm` 에서 유도(180). 바이트 비교는 점 파일에 기준 종속 값이 섞이는 회귀(Task 3 의 메타)를 파이프라인 수준에서 한 번 더 막는다 |
| `test_floor_points3d_chunk_size_invariant` | 청크 크기 불변 | 3번째 패스에 `chunk_size` 미전달(`seen == [90601]`). 바이트 비교는 표본기가 청크 경계에 의존하는 회귀(Task 2)를 파이프라인 수준에서 한 번 더 막는다 |
| `test_wall_has_no_points3d` | 벽면 | `analyze_wall` 에 키나 파일을 더함. 이 테스트는 구현 전에도 통과한다(범위 가드) |

- [ ] **Step 4: 성능 테스트 수정(`test_memory_spike.py`)**

(a) `engine/tests/perf/test_memory_spike.py:11`(`SIZE = (30.0, 20.0)` 줄) 바로 다음 줄에 아래 두 줄을 넣는다.

```python
# points3d.bin 크기 상한: 머리 8바이트 + JSON 메타 상한 4096바이트 + 점당 8바이트 x 상한 50만 점
POINTS3D_MAX_BYTES = 8 + 4096 + 8 * 500_000
```

(b) `_write_big_ply`(`:14-29`)를 바꾼다. 인자 `n_points` 를 더하고 본문의 `N_POINTS` 세 곳을 `n_points` 로 바꾼다.

바꾸기 전:

```python
def _write_big_ply(path):
    # 메모리 오염 없이 스트리밍 생성: 청크 단위로 생성해 즉시 기록
    header = (f"ply\nformat binary_little_endian 1.0\nelement vertex {N_POINTS}\n"
              "property float x\nproperty float y\nproperty float z\nend_header\n")
    rng = np.random.default_rng(0)
    per_chunk = 2_000_000
    written = 0
    with open(path, "wb") as f:
        f.write(header.encode())
        while written < N_POINTS:
            k = min(per_chunk, N_POINTS - written)
            xs = rng.uniform(0, SIZE[0], k).astype(np.float32)
            ys = rng.uniform(0, SIZE[1], k).astype(np.float32)
            zs = rng.normal(0.0, 0.001, k).astype(np.float32)  # 1mm 노이즈 평탄 바닥
            f.write(np.column_stack([xs, ys, zs]).astype("<f4").tobytes())
            written += k
```

바꾼 뒤:

```python
def _write_big_ply(path, n_points=N_POINTS):
    # 메모리 오염 없이 스트리밍 생성: 청크 단위로 생성해 즉시 기록
    header = (f"ply\nformat binary_little_endian 1.0\nelement vertex {n_points}\n"
              "property float x\nproperty float y\nproperty float z\nend_header\n")
    rng = np.random.default_rng(0)
    per_chunk = 2_000_000
    written = 0
    with open(path, "wb") as f:
        f.write(header.encode())
        while written < n_points:
            k = min(per_chunk, n_points - written)
            xs = rng.uniform(0, SIZE[0], k).astype(np.float32)
            ys = rng.uniform(0, SIZE[1], k).astype(np.float32)
            zs = rng.normal(0.0, 0.001, k).astype(np.float32)  # 1mm 노이즈 평탄 바닥
            f.write(np.column_stack([xs, ys, zs]).astype("<f4").tobytes())
            written += k
```

(c) 파일 끝의 테스트 함수(`:56-70`)를 바꾼다. `_RssPeakMonitor` 클래스(`:32-53`)는 그대로 둔다.

바꾸기 전:

```python
@pytest.mark.perf
def test_30m_points_within_budget(tmp_path):
    big = tmp_path / "big.ply"
    _write_big_ply(big)
    proc = psutil.Process()
    rss0 = proc.memory_info().rss
    t0 = time.monotonic()
    with _RssPeakMonitor(proc) as mon:
        stats = analyze_floor(big, 1.0, load_criteria()["floor-kcs-exposed"], 5.0, tmp_path / "out")
    dt = time.monotonic() - t0
    rss_delta_gib = (mon.peak - rss0) / 2 ** 30
    print(f"\n[perf] 30M점: {dt:.1f}s, 피크 RSS 증가 {rss_delta_gib:.2f} GiB, "
          f"셀 {stats['n_cells']} 유효 {stats['n_valid']} coverage {stats['coverage_pct']}%")
    assert dt < 300.0
    assert (mon.peak - rss0) < 2 * 2 ** 30
```

바꾼 뒤:

```python
def _analyze_within_budget(tmp_path, n_points, label):
    # 점 수만 다른 두 실측이 같은 게이트(300초, 2GiB, 점 파일 크기 상한)를 쓴다
    big = tmp_path / "big.ply"
    _write_big_ply(big, n_points)
    proc = psutil.Process()
    rss0 = proc.memory_info().rss
    t0 = time.monotonic()
    with _RssPeakMonitor(proc) as mon:
        stats = analyze_floor(big, 1.0, load_criteria()["floor-kcs-exposed"], 5.0, tmp_path / "out")
    dt = time.monotonic() - t0
    rss_delta_gib = (mon.peak - rss0) / 2 ** 30
    points3d = tmp_path / "out" / "points3d.bin"
    points3d_bytes = points3d.stat().st_size if points3d.exists() else -1
    print(f"\n[perf] {label}: {dt:.1f}s, 피크 RSS 증가 {rss_delta_gib:.2f} GiB, "
          f"셀 {stats['n_cells']} 유효 {stats['n_valid']} coverage {stats['coverage_pct']}%, "
          f"points3d.bin {points3d_bytes} bytes")
    assert dt < 300.0
    assert (mon.peak - rss0) < 2 * 2 ** 30
    assert stats["points3d_paths"] == ["points3d.bin"]
    assert 8 < points3d_bytes <= POINTS3D_MAX_BYTES


@pytest.mark.perf
def test_30m_points_within_budget(tmp_path):
    _analyze_within_budget(tmp_path, N_POINTS, "30M점")


@pytest.mark.perf
def test_3m_points_within_budget(tmp_path):
    # 점 수가 작으면 정렬 버퍼보다 표본기의 청크당 임시 배열이 커서 피크 양상이 다르다(스펙 §11)
    _analyze_within_budget(tmp_path, 3_000_000, "3M점")
```

기대값의 근거: 크기 상한 `8 + 4096 + 8 * 500_000` = 4,004,104 바이트. 파일은 `8 + json_len + 8n` 바이트이고 `n <= 500_000`, JSON 메타는 수백 바이트다(4096 은 넉넉한 상한). 600m² 에 300만 점이면 5cm 서브셀이 전부 차므로 점유 면적 600m², 표본 칸 변 `sqrt(600 / 500_000)` ≈ 0.035m, 칸당 평균 6점이라 표본은 상한 50만에 가깝다(파일 약 4.0MB).

- [ ] **Step 5: 실패 확인**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pipeline.py -q
```

Expected: `6 failed, 15 passed`(약 50초). 통과 15건은 기존 14건과 `test_wall_has_no_points3d` 다. 실패 사유:

```
test_floor_points3d_generated                              KeyError: 'points3d_paths'
test_floor_points3d_failure_isolated[sample_points-...]    AttributeError: ... has no attribute 'sample_points'
test_floor_points3d_failure_isolated[write_points3d-...]   AttributeError: ... has no attribute 'write_points3d'
test_floor_points3d_block_independent_of_other_renders     KeyError: 'points3d_paths'
test_floor_points3d_bytes_do_not_depend_on_criterion       KeyError: 'points3d_threshold_q'
test_floor_points3d_chunk_size_invariant                   AttributeError: module 'flatness.core.pipeline' has no attribute 'sample_points'
```

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -m perf -q -s -k 3m
```

Expected: `1 failed`(약 45초), `KeyError: 'points3d_paths'`. `-k 3m` 은 `test_3m_points_within_budget` 만 고른다(`test_30m_...` 에는 `3m` 이라는 부분 문자열이 없다).

- [ ] **Step 6: `pipeline.py` import 추가**

`engine/flatness/core/pipeline.py:6-19` 의 import 블록에 두 줄을 더한다. 둘 다 모듈 최상단이다.

바꾸기 전(`:10`, `:18`):

```python
from flatness.core.cells import evaluate_cells
```

```python
from flatness.outputs.preview3d import render_preview3d
```

바꾼 뒤:

```python
from flatness.core.cells import evaluate_cells
from flatness.core.pointsample import sample_points
```

```python
from flatness.outputs.preview3d import render_preview3d
from flatness.outputs.points3d import FILE_NAME as POINTS3D_FILE, write_points3d
```

파일명 리터럴 `"points3d.bin"` 을 `pipeline.py` 에 적지 않는다. `outputs/points3d.py` 의 `FILE_NAME` 한 곳에만 있다.

- [ ] **Step 7: `analyze_floor` 에 독립 블록 삽입**

`engine/flatness/core/pipeline.py:96-102` 를 바꾼다. 히트맵 블록(`:96-99`)과 `if render_warns:`(`:100`) 사이에 넣는다. 그 위(`:37-95`)와 아래(`:100-103`)는 한 글자도 바꾸지 않는다.

바꾸기 전:

```python
    try:
        render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
    except Exception:
        render_warns.add("heatmap_render_failed")
    if render_warns:
        stats["warnings"] = sorted(set(stats["warnings"]) | render_warns)
    write_outputs(out_dir, stats, cells, grades)
    return stats
```

바꾼 뒤:

```python
    try:
        render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
    except Exception:
        render_warns.add("heatmap_render_failed")
    # 3D 점군 뷰어용 점 표본(판정 무관 보조 산출물): 파일을 한 번 더 스트리밍하는 3번째 패스.
    # 위 세 렌더 블록과 별개의 독립 try/except 다. 어느 한쪽의 실패가 다른 쪽을 막지 않는다.
    try:
        sample = sample_points(iter_chunks(path, chunk_size=chunk_size),
                               info, scale_to_m, grid, zmap, residuals)
        stats["points3d_paths"] = [write_points3d(sample, out_dir / POINTS3D_FILE)]
        stats["points3d_threshold_q"] = int(round(criterion.pass_mm * 10))
    except Exception:
        stats["points3d_paths"] = []
        stats.pop("points3d_threshold_q", None)
        render_warns.add("points3d_render_failed")
        try:
            (out_dir / POINTS3D_FILE).unlink(missing_ok=True)   # 부분 파일이 업로드되지 않게 한다
        except OSError:
            pass
    if render_warns:
        stats["warnings"] = sorted(set(stats["warnings"]) | render_warns)
    write_outputs(out_dir, stats, cells, grades)
    return stats
```

try 부터 `pass` 까지 13줄은 스펙 §4.4 의 코드 블록 그대로다. 순서를 바꾸지 않는다(쓰기 → 임계값 대입). `write_outputs` 보다 앞이므로 두 키가 `stats.json` 에도 실린다.

- [ ] **Step 8: 통과 확인(`test_pipeline.py`)**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pipeline.py -q
```

Expected: `21 passed`(약 50초). 기존 14건 + 신규 7건(격리 테스트는 매개변수 2개로 2건).

- [ ] **Step 9: 엔진 전체 스위트**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q
```

Expected: `N + 7 passed, 2 deselected`(`N` 은 Step 1 에서 적은 수). 실패 0. `test_summary.py` 의 경고 코드 개수 단언(12)은 이 시점에 그대로 통과한다(계약 문서는 Task 5 가 고친다).

- [ ] **Step 10: 워커 전체 스위트(엔진 변경이 워커 경로를 깨지 않는지)**

`worker/tests/test_jobs.py` 와 `test_e2e_fake.py` 는 `analyze_floor` 를 실제로 돌리고 `out_dir` 의 모든 파일을 가짜 저장소에 올린다. 워커 코드는 고치지 않는다.

Run:

```bash
cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q
```

Expected: `209 passed, 2 deselected`(약 2분 20초). 수가 다르면 멈추고 실패 출력을 보고한다.

- [ ] **Step 11: 성능 게이트(300만 점)**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -m perf -q -s -k 3m
```

Expected: `1 passed`. `[perf] 3M점: ...s, 피크 RSS 증가 ... GiB, ..., points3d.bin ... bytes` 줄의 시간·RSS·바이트 수를 적어 커밋 메시지와 보고에 싣는다. 게이트는 300초 미만, 피크 RSS 증가 2GiB 미만, 파일 4,004,104 바이트 이하다. 3천만 점 실행(`-k 30m` 또는 `-k` 없이)은 Task 16 에서 한다.

참고(계획 작성 때 스펙 §4.2 를 옮긴 대역 구현으로 개발 PC 에서 잰 값. 실제 구현의 기대값이 아니라 자릿수 가늠용이다): 300만 점 두 번 실측 44~50초, 피크 RSS 증가 0.28~0.29GiB, 3,994,780 바이트(셀 600, 유효 600, coverage 100%). 3천만 점 한 번 실측 90초, 1.36GiB, 4,000,512 바이트.

- [ ] **Step 12: CLI 실행 확인(옵션 추가 없이 같은 파일이 생긴다)**

Run(출력은 저장소 밖 임시 폴더에 쓴다):

```bash
cd D:/Projects/Flatness/engine && OUT=$(cygpath -m "$(mktemp -d)") && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -c "
from tests.fixtures.synthetic import flat_floor, add_bump, write_binary_ply
write_binary_ply(add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010), '$OUT/scan.ply')
" && PYTHONPATH=D:/Projects/Flatness/engine PYTHONIOENCODING=utf-8 D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m flatness.cli analyze "$OUT/scan.ply" --units m --criteria floor-kcs-exposed --out "$OUT/out" && ls "$OUT/out" && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -c "
import json
from pathlib import Path
from flatness.outputs.points3d import read_points3d
out = Path('$OUT/out')
s = json.loads((out / 'stats.json').read_text('utf-8'))
meta, xyz_q, dev_q = read_points3d((out / 'points3d.bin').read_bytes())
print(s['points3d_paths'], s['points3d_threshold_q'], meta['n_points'], (out / 'points3d.bin').stat().st_size)
"
```

Expected: `분석 완료: 셀 36개 (유효 36)` 로 시작하는 요약, `ls` 목록에 `points3d.bin`(`cells.json`, `deviation.png`, `heatmap.png`, `preview3d.png`, `preview3d_zoom.png`, `results.csv`, `stats.json` 과 함께), 마지막 줄 `['points3d.bin'] 70 90601 725228`.

마지막 두 수의 근거: 이 스캔의 점유 면적은 36m²(5cm 서브셀 120 × 120)라 표본 칸 변이 `sqrt(36 / 500_000)` ≈ 8.5mm 로 점 간격 20mm 보다 작다. 한 칸에 점이 둘 이상 들어가지 않으므로 90,601점이 전부 남는다. 파일은 `8 + json_len + 8 × 90,601` 바이트이고 스펙 §5.4 대로 쓰면 이 스캔의 `json_len` 은 412 다(합 725,228). 마지막 수만 몇 바이트 다르면 메타 JSON 길이 차이다. `크기 − 8 − 8 × 90,601`(= `json_len`)이 4의 배수인지 확인하고 넘어간다. 앞의 세 값이 다르면 멈추고 보고한다.

- [ ] **Step 13: 기존 격리 테스트가 하중을 잃지 않았는지 확인(변이 1회)**

새 블록이 들어간 뒤에도 `test_floor_render_failure_does_not_lose_judged_result` 가 기존 세 렌더 블록의 격리를 실제로 검증하는지 본다. 먼저 지금까지의 변경을 스테이징해 되돌릴 기준을 만든다.

```bash
cd D:/Projects/Flatness && git add engine/flatness/core/pipeline.py engine/tests/test_pipeline.py engine/tests/perf/test_memory_spike.py
```

`engine/flatness/core/pipeline.py` 의 히트맵 블록에서 try 를 벗긴다(변이).

변이 전:

```python
    try:
        render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
    except Exception:
        render_warns.add("heatmap_render_failed")
```

변이 후:

```python
    render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)
```

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pipeline.py -q -k "render_failure_does_not_lose or independent_of_other_renders"
```

Expected: `2 failed`(둘 다 `RuntimeError: 주입된 렌더 실패...` 가 `analyze_floor` 밖으로 나온다). 기존 테스트가 통과하면 새 블록이 기존 가드의 하중을 뺀 것이다. 멈추고 보고한다.

변이를 되돌린다(스테이징한 내용으로 작업 트리를 복원).

```bash
cd D:/Projects/Flatness && git checkout -- engine/flatness/core/pipeline.py && git diff --stat && git diff --cached --stat
```

Expected: `git diff --stat` 출력 없음(작업 트리 = 스테이징), `git diff --cached --stat` 에 세 파일만 보인다. 되돌린 뒤 Step 8 의 명령을 다시 돌려 `21 passed` 를 확인한다.

리뷰어를 위한 나머지 변이 표(스펙 §10.5. 스크래치 사본에서 하나씩 넣어 확인한 결과. 리뷰 때 같은 방법으로 다시 넣어 본다):

| 변이(`pipeline.py`) | 죽는 테스트 |
|---|---|
| 새 블록을 히트맵 try 안, `render_heatmap` 뒤로 합침 | `block_independent_of_other_renders`, `failure_isolated` 2건 |
| 새 블록을 히트맵 try 안, `render_heatmap` 앞으로 합침 | `failure_isolated` 2건(히트맵이 안 그려지고 `heatmap_render_failed` 가 붙는다) |
| `criterion.pass_mm * 10` → `criterion.rework_mm * 10` | `generated`, `block_independent_of_other_renders`, `bytes_do_not_depend_on_criterion` |
| 임계값을 `70` 으로 고정 | `bytes_do_not_depend_on_criterion` |
| 안쪽 `try: unlink ... except OSError: pass` 4줄 삭제 | `failure_isolated[write_points3d-...]` |
| 성공 경로에서 `preview3d_paths` 에 `POINTS3D_FILE` 을 더함 | `generated`, `block_independent_of_other_renders`, `failure_isolated` 2건, 기존 `test_floor_render_failure_does_not_lose_judged_result` |
| 임계값 대입을 try 첫 줄로 옮기고 `stats.pop(...)` 삭제 | `failure_isolated` 2건 |
| `stats.pop(...)` 만 삭제 | 없음(동치 변이. 함정 5) |
| 3번째 패스의 `chunk_size=chunk_size` 삭제 | `chunk_size_invariant` |
| 기존 히트맵 try 제거 | 기존 `test_floor_render_failure_does_not_lose_judged_result`, `block_independent_of_other_renders` |

- [ ] **Step 14: 커밋**

```bash
cd D:/Projects/Flatness && git add engine/flatness/core/pipeline.py engine/tests/test_pipeline.py engine/tests/perf/test_memory_spike.py && git status --short && git commit -m "$(cat <<'EOF'
feat(engine): analyze_floor 가 points3d.bin 을 만들고 stats 에 기록

- 히트맵 렌더 블록 뒤, write_outputs 앞에 독립 try/except 블록 추가.
  파일을 한 번 더 스트리밍(3번째 패스)해 점 표본을 뽑고 points3d.bin 으로 쓴다
- stats 새 키(floor 전용): points3d_paths, points3d_threshold_q(= pass_mm x 10, 0.1mm 정수.
  점 파일이 만들어졌을 때만 기록)
- 실패는 points3d_paths = [] 와 경고 points3d_render_failed 로만 남는다.
  판정 수치와 다른 산출물은 실패가 없을 때와 같고 out_dir 에 부분 파일을 남기지 않는다
- points3d.bin 은 preview3d_paths 에 넣지 않는다(보고서가 그 목록을 그림으로 복사한다)
- 성능 테스트: 점 파일 생성과 크기 상한 단언 추가, 300만 점 변형 추가(같은 게이트)
- CLI 옵션과 ENGINE_VERSION 은 그대로다. 계약 문서와 경고 라벨은 다음 커밋에서 고친다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

Expected: `git status --short` 에 위 세 파일만 `M` 으로 보인다(다른 파일이 보이면 커밋하지 않고 확인한다). 커밋 뒤 `git log --oneline -1` 이 `feat(engine): analyze_floor 가 points3d.bin 을 만들고 stats 에 기록` 이다.

---

**계획 작성 시 검증 기록(리뷰어용. 구현자가 따라야 할 단계가 아니다):**

위 코드 블록은 전부 `.superpowers/plan-drafts/pointcloud-viewer/scratch-04/` 의 엔진 사본에서 실제로 돌렸다. Task 1~3 의 실제 구현은 아직 없으므로 사본에는 뼈대 시그니처를 만족하는 **대역**(`core/pointsample.py`, `outputs/points3d.py`. 스펙 §4.2·§4.3·§5.4 를 그대로 옮긴 최소 구현)을 두고 돌렸다. 저장소의 추적 파일은 바꾸지 않았다.

| 확인한 것 | 결과 |
|---|---|
| Step 5(red): 테스트만 넣고 `tests/test_pipeline.py` | `6 failed, 15 passed`. 실패 사유가 Step 5 표와 같다 |
| Step 8(green): 블록 삽입 뒤 `tests/test_pipeline.py` | `21 passed`(두 번 실행 모두) |
| Step 11: `-m perf -k 3m` | `1 passed`. 300만 점 44~50초, 피크 RSS 증가 0.28~0.29GiB, `points3d.bin` 3,994,780 바이트 |
| Step 12: CLI `flatness.cli analyze` | `points3d.bin` 725,228 바이트, `json_len` 412, `n_points` 90,601, `stats.json` 의 두 키 `['points3d.bin']`·`70`, `preview3d_paths` 는 PNG 둘만 |
| Step 10: 워커 스위트(엔진 사본을 PYTHONPATH 로) | `209 passed, 2 deselected`(2분 17초). `test_jobs.py`·`test_e2e_fake.py` 가 새 블록이 든 `analyze_floor` 를 실제로 돌리고 `points3d.bin` 을 가짜 저장소에 올렸다 |
| Step 13 과 변이 표 | `mutate.py` 로 변이 14종을 하나씩 넣어 돌린 기록이 `scratch-04/mutate.log` 다. 표의 '죽는 테스트' 열은 그 기록을 옮긴 것이고, M1(히트맵 try 에 합침)·M6(기존 히트맵 try 제거)은 두 번 돌려 같은 결과를 확인했다 |
| 초안의 코드 블록 ↔ 사본 파일 | `scratch-04/check_draft.py`: python 블록 16개가 전부 원본 또는 사본 파일에 글자 그대로 있다. 초안에 U+2014, 저장소 금칙어, writing-plans 의 No Placeholders 표현 0건 |

대역에 기대는 수치는 둘이다. (1) Step 12 의 파일 크기 725,228(`json_len` 412)은 메타 JSON 의 float repr 에 달려 있어 실제 Task 3 구현이 §5.4 식과 한 글자라도 다르면 몇 바이트 달라질 수 있다(Step 12 본문의 처리 방법대로 넘어간다). (2) Step 11 의 시간·RSS 는 실제 Task 2 구현의 알고리즘 상수에 따라 달라진다(게이트만 본다). 그 밖의 기대값(테스트 통과 수, 임계값 70·60, 점 수 90,601, 청크 길이 `[50_000, 40_601]`, 함몰 깊이·위치)은 대역과 무관하게 스펙과 기존 코드에서 결정된다.

---
### Task 5: 계약 동반 수정: stats-schema·경고 라벨·타입(§6.3)

**목표:** 새 stats 키 2개(`points3d_paths`, `points3d_threshold_q`)·경고 코드 1개(`points3d_render_failed`)·파일 형식 계약(`points3d.bin`)이 계약 정본 문서와 대시보드·워커 라벨 사전·타입에 반영되고, 세 곳의 대조 테스트(엔진 문서 파서, 워커 라벨 대조, 대시보드 라벨)가 13개 코드로 통과한다.

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.1 D12, §2.3(경고 코드 개수 단언), §4.5(`_WARN_TEXT`에 넣지 않는다), §5(계약 문서 §9로 옮김), §6.1, §6.2, §6.3(표 12행 전부), §10.3, §12, 부록 B 7.

**Files:**
- Create: 없음
- Modify: `docs/contracts/stats-schema.md:15-22`(대조 소스 목록, 실제 수정은 `:19`), `:95-105`(§2 조건부 키 표, `:98` 다음에 2행), `:204-218`(§5 경고 사전, `:217` 다음에 1행), `:231`(렌더 실패 경고 문단), `:238-248`(§6 산출물 표, `:248` 다음에 1행), `:507-508` 사이(새 절 §9)
- Modify: `docs/scan-guideline.md:605-606`(§11.3)
- Modify: `engine/tests/test_summary.py:72`, `:76`, `:82`, 파일 끝(`:98` 다음에 테스트 1건 추가)
- Modify: `worker/flatworker/report/labels.py:56-58`(`WARNING_LABEL` 끝)
- Modify: `worker/tests/test_report_labels.py:73`
- Modify: `dashboard/lib/domain/labels.ts:68-70`(`WARNING_LABEL` 끝)
- Modify: `dashboard/lib/domain/types.ts:126-127`(`Stats`)
- Modify: `dashboard/lib/domain/__tests__/labels.test.ts:31`(그 줄 앞에 `it` 1건 추가)
- Test: `engine/tests/test_summary.py`, `worker/tests/test_report_labels.py`, `dashboard/lib/domain/__tests__/labels.test.ts`

줄 번호는 2026-10-02 `feat/pointcloud-viewer` 기준이다. 앞 태스크(T1~T4)는 이 8개 파일을 건드리지 않으므로 시작 시점에는 그대로지만, 이 태스크 안에서 위쪽을 고치면 아래쪽 번호가 밀린다. **줄 번호가 아니라 아래에 적은 '바꾸기 전' 텍스트로 위치를 잡는다.**

**Interfaces:**
- Consumes:
  - T4가 기록하는 stats 키 이름 `points3d_paths`, `points3d_threshold_q`와 경고 코드 `points3d_render_failed`(`engine/flatness/core/pipeline.py`의 `analyze_floor`)
  - T3의 형식 계약(스펙 §5 전체). `engine/flatness/outputs/points3d.py`의 `MAGIC = b"FP3D"`, `SCHEMA_VERSION = 1`, `FILE_NAME = "points3d.bin"`, `encode_points3d`·`write_points3d`·`read_points3d`
  - T1의 상수(`engine/flatness/core/pointsample.py`): `MAX_POINTS = 500_000`, `DEV_NOT_FLOOR = -32768`, `DEV_NO_DEVIATION = -32767`, `DEV_MIN, DEV_MAX = -32766, 32767`
  - 기존 `engine/tests/test_summary.py`의 `_documented_warning_codes()`: `stats-schema.md`에서 `## 5. warnings 코드 사전`부터 다음 `\n## 6.` 앞까지를 잘라, 줄 머리의 정규식 `^\|\s*` + 백틱 + `([a-z0-9_]+)` + 백틱 + `\s*\|` 에 잡히는 첫 열만 코드로 센다
  - 기존 `worker/tests/test_report_labels.py`의 `_extract_object(_ts(), "WARNING_LABEL")`: `labels.ts`의 `const WARNING_LABEL ... = { ... };` 블록에서 `식별자: '작은따옴표 문자열'` 쌍만 뽑아 dict로 만든다(키는 따옴표 없는 식별자, 값은 작은따옴표여야 잡힌다)
- Produces:
  - `dashboard/lib/domain/types.ts`의 `Stats`에 추가: `points3d_paths?: string[]; // floor만(3D 점군 뷰어 파일명)`과 `points3d_threshold_q?: number; // floor만(표시 임계값, 0.1mm 정수)` (T7·T14가 쓴다)
  - `dashboard/lib/domain/labels.ts` `WARNING_LABEL.points3d_render_failed`와 `worker/flatworker/report/labels.py` `WARNING_LABEL["points3d_render_failed"]` = `3D 점군 데이터 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.` (둘 다 `deviation_render_failed` 항목 다음)
  - `docs/contracts/stats-schema.md`: 대조 소스 목록에 두 모듈, §2 조건부 키 표에 두 행(`deviation_paths` 행 다음), §5 경고 사전에 한 행(`deviation_render_failed` 행 다음), 렌더 실패 경고 문단의 코드 나열, §6 산출물 표에 `points3d.bin` 행(`deviation_wall{n}.png` 행 다음), §8 끝과 부록 A 사이에 새 절 `## 9. points3d.bin 형식 계약 (schema_version=1)`
  - `docs/scan-guideline.md` §11.3 렌더 실패 코드 나열에 `points3d_render_failed`
  - `engine/tests/test_summary.py`: 개수 단언 13, 신규 테스트 `test_render_failed_codes_are_documented_and_kept_out_of_summary_text`(엔진 통과 수 +1)

**이 태스크를 읽기 전에 알아야 할 것:**

- 경고 코드 사전은 세 곳에 있고 테스트 세 개가 서로를 묶는다. 한 곳만 고치면 다른 곳의 테스트가 즉시 실패하므로 **이 태스크는 한 커밋**이다.

  | 사전 | 파일 | 묶는 테스트 |
  |---|---|---|
  | 계약 문서(정본) | `docs/contracts/stats-schema.md` §5 표 | `engine/tests/test_summary.py`가 문서를 정규식으로 읽어 리터럴 코드 수를 단언 |
  | 표시 라벨 정본 | `dashboard/lib/domain/labels.ts`의 `WARNING_LABEL` | `dashboard/lib/domain/__tests__/labels.test.ts` |
  | 표시 라벨 사본 | `worker/flatworker/report/labels.py`의 `WARNING_LABEL` | `worker/tests/test_report_labels.py`가 `labels.ts`를 파싱해 사본과 dict 등가 비교 + 개수 단언 |

- 기대 개수 13의 근거(손 계산): 지금 세 사전에 있는 리터럴 코드는 12개다. `ghost_layer_rescan`, `ghost_zone_excluded`, `furniture_excluded`, `low_coverage`, `reduced_span`, `uncertainty_swallows_repair`, `uncertainty_swallows_pass`, `plumbness_relative_to_z`, `heatmap_render_failed`, `preview3d_render_failed`, `deviation_render_failed`, `fused_mesh_smoothed`. 여기에 `points3d_render_failed` 하나를 더해 13이다. `wall_{i}_skipped`는 중괄호가 든 개방 패턴이라 어느 사전에서도 세지 않는다.
- 라벨 문자열의 근거: 스펙 §6.2의 인용문을 글자 그대로 쓴다. 가운뎃점은 U+00B7(`·`)이고 기존 렌더 실패 라벨 3개(`판정 수치·등급에는 영향이 없습니다.`)와 같은 글자다. 기존 줄에서 복사하면 틀리지 않는다.
- 고치지 않는 것: `engine/flatness/outputs/summary.py`의 `_WARN_TEXT`(렌더 실패 코드는 종합의견에 싣지 않는다), `ENGINE_VERSION`과 그 고정 문자열 문서, 워커의 다른 파일(업로드·확장자 매핑), `stats-schema.md`의 기존 행.
- `stats-schema.md` §2 표의 기존 행은 "해당 없음"을 `—`(U+2014)로 적는다. 새 두 행의 wall·import 칸도 같은 표기를 따른다. 그 밖에 **새로 쓰는 문장에는 U+2014를 쓰지 않는다.**
- 작업 트리의 줄바꿈은 CRLF다(`core.autocrlf=true`). 편집 도구가 줄바꿈을 바꾸지 않게 둔다. `git diff --stat`이 파일 전체를 바꾼 것으로 나오면 줄바꿈이 바뀐 것이니 되돌린다.
- 이 태스크의 대시보드 변경은 Next.js API를 쓰지 않는 순수 TS(`lib/domain`)라 `dashboard/node_modules/next/dist/docs/` 확인 대상이 아니다.
- pytest 출력의 한글이 콘솔에서 깨져 보일 수 있다. 실패 확인은 테스트 이름과 `assert 12 == 13`으로 한다.

파이썬은 `D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe`만 쓴다(기본 `python` 3.9 금지). 셸은 Git Bash다.

---

- [ ] **Step 1: 대시보드 라벨 테스트 추가(실패하는 테스트)**

`dashboard/lib/domain/__tests__/labels.test.ts`의 `describe('warningLabel', ...)` 안, `wall_{i}_skipped` 테스트 바로 앞에 `it` 하나를 넣는다.

바꾸기 전(`:30-33`):

```ts
  });
  it('wall_{i}_skipped 개방 패턴을 매칭한다', () => {
    expect(warningLabel('wall_3_skipped')).toContain('3번 벽');
  });
```

바꾼 뒤:

```ts
  });
  it('3D 점군 데이터 생성 실패 코드는 정확히 이 문구다(워커 사본과 글자 단위로 같아야 한다)', () => {
    expect(warningLabel('points3d_render_failed')).toBe(
      '3D 점군 데이터 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.',
    );
  });
  it('wall_{i}_skipped 개방 패턴을 매칭한다', () => {
    expect(warningLabel('wall_3_skipped')).toContain('3번 벽');
  });
```

- 기대값의 근거: 스펙 §6.2의 표시 라벨 인용문 그대로다(구현 출력을 베낀 값이 아니다).
- 죽이는 변이: `labels.ts`의 문구를 한 글자라도 바꿈, 항목 누락, 키 오타. `warningLabel`은 모르는 코드를 원문 그대로 돌려주므로(`labels.ts:76`) 항목이 없거나 키가 틀리면 `'points3d_render_failed'`가 돌아와 `toBe`가 죽는다. `toContain`이 아니라 `toBe`인 이유가 이것이다.

- [ ] **Step 2: 워커 대조 테스트의 개수 단언을 13으로**

`worker/tests/test_report_labels.py`

바꾸기 전(`:71-74`):

```python
def test_warning_dictionary_matches_dashboard():
    warnings = _extract_object(_ts(), "WARNING_LABEL")
    assert len(warnings) == 12, "파싱 실패 의심(warnings 사전은 12개 코드)"
    assert warnings == WARNING_LABEL
```

바꾼 뒤:

```python
def test_warning_dictionary_matches_dashboard():
    warnings = _extract_object(_ts(), "WARNING_LABEL")
    assert len(warnings) == 13, "파싱 실패 의심(warnings 사전은 13개 코드)"
    assert warnings == WARNING_LABEL
```

- 죽이는 변이: `labels.py` 문자열 한 글자 차이, `labels.py` 키 오타·항목 누락, `labels.ts`만 고치고 `labels.py`를 빼먹음(둘째 단언의 dict 등가), `labels.ts` 항목의 값이 작은따옴표가 아니라서 파서가 못 읽음(첫째 단언의 13).

- [ ] **Step 3: 엔진 문서 파서 테스트를 13으로 고치고 렌더 실패 4종 테스트를 추가**

`engine/tests/test_summary.py`. 수정 3곳 + 파일 끝에 테스트 1건.

(3-1) `:72` 주석. 바꾸기 전:

```python
    # 12개 중 `fused_mesh_smoothed` 하나는 엔진이 아니라 워커가 붙이는 코드다
```

바꾼 뒤:

```python
    # 13개 중 `fused_mesh_smoothed` 하나는 엔진이 아니라 워커가 붙이는 코드다
```

(3-2) `:76` 개수 단언. 바꾸기 전:

```python
    assert len(codes) == 12, "파싱 실패 의심(§5 리터럴 코드는 12개여야 함 - wall_{i}_skipped 패턴 행 제외)"
```

바꾼 뒤:

```python
    assert len(codes) == 13, "파싱 실패 의심(§5 리터럴 코드는 13개여야 함 - wall_{i}_skipped 패턴 행 제외)"
```

(3-3) `:82` 독스트링. 바꾸기 전:

```python
    부분집합이어야 한다(렌더 실패 3종 heatmap/preview3d/deviation_render_failed을
```

바꾼 뒤:

```python
    부분집합이어야 한다(렌더 실패 4종 heatmap/preview3d/deviation/points3d_render_failed을
```

(3-4) 파일 끝. 지금 파일의 마지막 두 줄은 아래와 같다.

```python
    documented = _documented_warning_codes()
    assert set(_WARN_TEXT) <= documented
```

그 뒤에 빈 줄 2개를 두고 다음 함수를 붙인다.

```python
def test_render_failed_codes_are_documented_and_kept_out_of_summary_text():
    """렌더 실패 4종은 계약 문서 §5 에 리터럴 코드로 실려 있고, 종합의견 사전(_WARN_TEXT)에는
    하나도 없어야 한다(3D 점군 뷰어 스펙 §4.5, §6.2).

    개수 단언(13)만으로는 새 행의 코드 철자가 틀린 경우를 잡지 못한다. 엔진이 붙이는 이름
    (core/pipeline.py 의 render_warns.add(...) 리터럴과 같은 철자)을 아래 집합에 적어 문서와 대조한다.
    """
    documented = _documented_warning_codes()
    render_failed = {c for c in documented if c.endswith("_render_failed")}
    assert render_failed == {
        "heatmap_render_failed", "preview3d_render_failed",
        "deviation_render_failed", "points3d_render_failed",
    }
    assert render_failed.isdisjoint(_WARN_TEXT)
```

- 기대값의 근거: 4종 = 기존 3종(`stats-schema.md:215-217`의 세 행, `pipeline.py`의 `render_warns.add(...)` 리터럴 3개) + 스펙 §6.2의 새 코드.
- 죽이는 변이(테스트별):
  - 개수 단언 13(`_documented_warning_codes`): §5 표에 새 행을 안 넣음(12), 새 행의 첫 열에 백틱이 없어 정규식에 안 잡힘(12), §9의 표가 `## 6.` 앞에 잘못 들어가 §5 구간에 섞임(14).
  - `test_render_failed_codes_are_documented_and_kept_out_of_summary_text`: §5 새 행의 코드 철자 오타(예: `points3d_render_fail`. 개수는 13 그대로라 위 단언이 못 잡는다), `summary.py`의 `_WARN_TEXT`에 렌더 실패 코드를 넣음(기존 부분집합 단언은 이 변이에서 통과한다).

- [ ] **Step 4: 세 테스트가 실패하는지 확인**

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run lib/domain/__tests__/labels.test.ts
```

Expected: FAIL. `Tests  1 failed | 9 passed (10)`. 실패 메시지에 아래 두 줄이 있다(라벨이 없어 원문 코드가 돌아왔다는 뜻).

```
Expected: "3D 점군 데이터 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다."
Received: "points3d_render_failed"
```

```bash
cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_report_labels.py -q
```

Expected: FAIL. `1 failed, 4 passed`. `FAILED tests/test_report_labels.py::test_warning_dictionary_matches_dashboard`, `assert 12 == 13`.

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_summary.py -q
```

Expected: FAIL. `2 failed, 6 passed`. 실패 2건은 `test_warn_text_is_subset_of_documented_warning_codes`와 `test_render_failed_codes_are_documented_and_kept_out_of_summary_text`이고 둘 다 `tests\test_summary.py:76`의 `assert 12 == 13`에서 죽는다.

실패 사유가 위와 다르면(예: ImportError, SyntaxError) 테스트를 잘못 고친 것이다. 고친 뒤 다시 확인한다.

- [ ] **Step 5: `labels.ts`(정본)에 라벨 추가**

`dashboard/lib/domain/labels.ts`의 `WARNING_LABEL` 끝.

바꾸기 전(`:68-70`):

```ts
  deviation_render_failed:
    '정밀 편차맵 이미지 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.',
};
```

바꾼 뒤:

```ts
  deviation_render_failed:
    '정밀 편차맵 이미지 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.',
  points3d_render_failed:
    '3D 점군 데이터 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.',
};
```

키는 따옴표 없는 식별자, 값은 작은따옴표로 쓴다(워커 파서가 그 형태만 읽는다). 이 단계 직후 워커 대조 테스트는 "`labels.py`에 항목 없음"으로 계속 실패한다. Step 6에서 맞춘다.

- [ ] **Step 6: `labels.py`(사본)에 같은 문자열 추가**

`worker/flatworker/report/labels.py`의 `WARNING_LABEL` 끝.

바꾸기 전(`:56-58`):

```python
    "deviation_render_failed":
        "정밀 편차맵 이미지 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.",
}
```

바꾼 뒤:

```python
    "deviation_render_failed":
        "정밀 편차맵 이미지 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.",
    "points3d_render_failed":
        "3D 점군 데이터 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.",
}
```

문자열은 Step 5의 것과 가운뎃점(U+00B7)·마침표·띄어쓰기까지 같아야 한다. 워커에서 고치는 코드 파일은 이것 하나다.

- [ ] **Step 7: `types.ts`의 `Stats`에 optional 필드 2개 추가**

`dashboard/lib/domain/types.ts`

바꾸기 전(`:126-127`):

```ts
  deviation_paths?: string[]; // floor·벽 공통(정밀 편차맵 파일명, 임포트 결과에는 없음)
  walls?: WallInfo[];         // wall만
```

바꾼 뒤:

```ts
  deviation_paths?: string[]; // floor·벽 공통(정밀 편차맵 파일명, 임포트 결과에는 없음)
  points3d_paths?: string[]; // floor만(3D 점군 뷰어 파일명)
  points3d_threshold_q?: number; // floor만(표시 임계값, 0.1mm 정수)
  walls?: WallInfo[];         // wall만
```

둘 다 `?`(optional)이다. 옛 분석·벽면·임포트의 stats에는 이 키가 없다. 필수로 쓰면 `Stats` 타입으로 선언한 기존 테스트 픽스처 4곳(`components/analysis/__tests__/analysis-result.test.tsx:10`, `result-table.test.tsx:6`, `verdict-panel.test.tsx:10`, `lib/domain/__tests__/stats.test.ts:6`)이 `tsc`에서 TS2739로 실패한다(Step 12의 `npx tsc --noEmit`가 이 변이를 잡는다).

- [ ] **Step 8: `stats-schema.md` 기존 절 5곳 수정**

`docs/contracts/stats-schema.md`. 위에서부터 차례로 고친다.

(8-1) 대조 소스 목록(`:19`). 문서 머리 인용 블록 안의 한 줄을 두 줄로 바꾼다.

바꾸기 전:

```
> `engine/flatness/outputs/preview3d.py`, `engine/flatness/outputs/deviation.py`. §8은 별도로
```

바꾼 뒤:

```
> `engine/flatness/outputs/preview3d.py`, `engine/flatness/outputs/deviation.py`,
> `engine/flatness/core/pointsample.py`, `engine/flatness/outputs/points3d.py`. §8은 별도로
```

(8-2) §2 조건부 키 표. `deviation_paths` 행(`:98`) 바로 다음, `walls` 행(`:99`) 바로 앞에 두 행을 넣는다. 각 행은 한 줄이다(줄바꿈하지 않는다).

위치 기준이 되는 기존 행(고치지 않는다):

```
| `walls` | — | O | — | `analyze_wall`에서만 추가(`core/pipeline.py:111`). §2.1 참고 |
```

그 행 앞에 넣는 두 행:

```
| `points3d_paths` | O | — | — | `analyze_floor`에서만 추가. 3D 점군 뷰어용 점 파일명 목록(`string[]`): `["points3d.bin"]` 또는 `[]`. 다른 `*_paths` 키와 같은 규약이다: 파일 존재는 이 키로 판별하고, 소비자는 키가 없으면 빈 목록으로 다룬다(이 키가 생기기 전에 만든 분석 포함). 생성이 예외로 실패하면 `[]`이고 `points3d_render_failed` 경고가 동반된다(§5). 파일 형식은 §9. 이 파일명은 `preview3d_paths`에 넣지 않는다(보고서가 그 목록의 파일을 3D 프리뷰 그림으로 복사한다). **판정과 무관한 보조 시각화**다 |
| `points3d_threshold_q` | 조건부 | — | — | int. 3D 점군 뷰어의 기본 표시 임계값, 0.1mm 단위 정수 = `int(round(criterion.pass_mm * 10))`(탑재된 바닥 기준의 `pass_mm` 6·7·10에 대응해 60·70·100). **점 파일이 만들어졌을 때만** 기록한다(`points3d_paths`가 `[]`이면 키 자체가 없다). 스팬 환산과 불확도 U를 적용하지 않는다. 판정에 쓰이지 않는 표시용 값이다 |
```

wall·import 칸의 `—`는 이 표의 기존 표기다. 설명 문장에는 `—`를 쓰지 않았다.

(8-3) §5 경고 사전 표. `deviation_render_failed` 행(`:217`) 바로 다음, `fused_mesh_smoothed` 행 바로 앞에 한 행을 넣는다.

위치 기준(고치지 않는다. 뒤 행은 `| `fused_mesh_smoothed` | 업로드 시 데이터 계보를 ...`로 시작한다):

```
| `deviation_render_failed` | 정밀 편차맵(`deviation.png`/`deviation_wall{n}.png`) 렌더가 실패해 해당 파일명이 `deviation_paths`에서 빠짐. 판정 수치는 영향 없음 | floor·wall | `core/pipeline.py`(`render_deviation_map` 호출부) |
```

그 다음 줄에 넣는 행:

```
| `points3d_render_failed` | 3D 점군 뷰어용 점 파일(`points3d.bin`) 생성이 실패해 `points3d_paths`가 `[]`로 저장됨. 판정 수치는 영향 없음 | floor | `core/pipeline.py`(`sample_points`·`write_points3d` 호출부) |
```

**첫 열은 반드시 백틱으로 감싼 리터럴 코드여야 한다.** `test_summary.py`의 정규식이 줄 머리의 `| ` + 백틱 코드 + ` |`만 센다.

(8-4) 렌더 실패 경고 문단(`:231`). 한 줄만 고친다(다음 줄은 그대로 둔다).

바꾸기 전:

```
렌더 실패 경고(`heatmap_render_failed`·`preview3d_render_failed`·`deviation_render_failed`)는 벽 여러 개에서 동시에
```

바꾼 뒤:

```
렌더 실패 경고(`heatmap_render_failed`·`preview3d_render_failed`·`deviation_render_failed`·`points3d_render_failed`)는 벽 여러 개에서 동시에
```

(8-5) §6 산출물 표. `deviation_wall{n}.png` 행(`:248`, 표의 마지막 행) 바로 다음에 한 행을 넣는다.

위치 기준(고치지 않는다):

```
| `deviation_wall{n}.png` | wall | 벽별 정밀 편차맵. `n`은 `wall_id`와 동일 채번 — **스킵된 벽은 파일 자체가 생성되지 않음(결번)** |
```

그 다음 줄에 넣는 행:

```
| `points3d.bin` | floor | 3D 점군 뷰어용 점 표본. 최대 50만 점, 점당 8바이트. 형식은 §9, 생성 여부는 `points3d_paths`로 판별 |
```

- [ ] **Step 9: `stats-schema.md`에 새 절 §9 추가**

§8.7의 마지막 문단(`...모순 상태가 된다(백로그 기록됨).`)과 `## 부록 A. 등급 라벨 매핑 (프론트엔드 참고)` 사이에 아래 블록 전체를 넣는다. 블록 앞뒤로 빈 줄이 하나씩 있어야 한다(앞: §8.7 마지막 문단 다음 빈 줄, 뒤: 블록 마지막 줄 다음 빈 줄, 그 다음이 `## 부록 A.` 제목).

제목은 글자 그대로 `## 9. points3d.bin 형식 계약 (schema_version=1)`이다. 이 절의 표들은 `## 5.`와 `## 6.` 사이가 아니므로 Step 3의 개수 단언에 영향을 주지 않는다. 내용은 스펙 §5 전체를 절 번호만 바꿔(§5.x → §9.x) 옮긴 것이고, 머리에 작성기·리더 위치와 `dev`의 뜻(스펙 §4.3)을 덧붙였다.

````markdown
## 9. points3d.bin 형식 계약 (schema_version=1)

바닥 평활도 분석(`analyze_floor`)이 만드는 3D 점군 뷰어용 점 표본 파일의 계약 정본이다. wall·import·구배 경로는
이 파일을 만들지 않는다. 생성 여부는 §2의 `points3d_paths`로 판별한다(파일 존재를 가정하지 않는다).
**판정과 무관한 보조 시각화**이며 이 파일이 없어도 stats의 판정 결과는 같다.

- 작성기: `engine/flatness/outputs/points3d.py`의 `encode_points3d`·`write_points3d`. 표본 추출과 점별 편차 계산은
  `engine/flatness/core/pointsample.py`의 `sample_points`다.
- 리더: `dashboard/lib/domain/points3d.ts`의 `parsePoints3d`, 엔진의 `read_points3d`(`outputs/points3d.py`).
- 점별 편차 `dev`는 그 점이 속한 5cm 서브셀의 잔차(정밀 편차맵과 같은 값, + 융기 / − 침하)를 0.1mm 단위 정수로
  적은 것이다. 점 자체의 편차가 아니다.
- 뷰어의 기본 표시 임계값은 이 파일이 아니라 stats의 `points3d_threshold_q`(§2)에 있다.

### 9.1 바이트 배치

전부 little-endian. `n` = 점 수, `L` = `json_len`.

| 오프셋 | 길이 | 내용 |
|---|---|---|
| `[0, 4)` | 4 | magic. ASCII `FP3D`(`0x46 0x50 0x33 0x44`) |
| `[4, 8)` | 4 | uint32 `json_len`. 뒤따르는 JSON 영역의 바이트 수이며 **공백 패딩을 포함**한다. `8 + json_len`은 4의 배수다 |
| `[8, 8+L)` | L | UTF-8 JSON 메타. 끝을 공백(`0x20`)으로 채워 길이를 맞춘다 |
| `[8+L, 8+L+6n)` | 6n | `uint16 xyz[3n]`. 점마다 x, y, z 순서로 인터리브 |
| `[8+L+6n, 8+L+8n)` | 2n | `int16 dev[n]` |

- 총 `8 + L + 8n` 바이트. 50만 점이면 약 4.0MB다.
- 본문 시작(`8 + L`)이 4의 배수이고 `6n`이 짝수이므로 두 블록 모두 TypedArray 뷰로 바로 읽을 수 있다.
- 압축하지 않는다. 헤더에 버전 필드를 두지 않는다(버전은 JSON의 `schema_version`).

### 9.2 메타 키

키는 아래 순서로 기록한다. 리더는 순서에 기대지 않는다.

| 키 | 타입 | 내용 |
|---|---|---|
| `schema_version` | int | `1`. 파일 구조가 바뀔 때만 올린다 |
| `n_points` | int | 점 수 `n`. 1 이상. 작성기는 `n <= MAX_POINTS`(500,000)를 보장한다. 리더는 상한을 검사하지 않는다 |
| `units` | string | `"m"` |
| `origin_m` | float[3] | 절대 좌표(float64). 표본 로컬 범위의 최솟값을 절대 좌표로 바꾼 값 = `origin_abs + min(xyz_local)` |
| `extent_m` | float[3] | 표본의 축별 범위(m) = `max(xyz_local) − min(xyz_local)`. 0 이상 |
| `deviation` | object | `{"unit_mm": 0.1, "not_floor": -32768, "no_deviation": -32767}` |
| `sample_cell_m` | float | 표본 칸 변 `s`(m). 뷰어가 점 크기를 유도한다 |
| `fit_bounds` | object | `{"min": float[3], "max": float[3]}`. 편차 있는 점(`dev > -32767`)의 파일-로컬 범위. 편차 있는 점이 하나도 없으면 전체 범위(`min = [0,0,0]`, `max = extent_m`). 뷰어의 카메라 초기 맞춤과 격자 범위에 쓴다 |
| `sampling` | object | `{"method": "cell min-hash stratified", "source_points": int, "cap": int}` |
| `order` | string | `"hash"`. 점이 해시 값 오름차순으로 놓였다는 뜻. 앞에서 몇 개를 취해도 고른 표본이다 |

**넣지 않는 것**: 엔진 버전, 시드, 판정 기준에 종속된 값(임계값, 기준 이름, 불확도), 분류 수, 파일 경로, 생성 시각.
같은 스캔이면 기준을 바꿔 재분석해도 파일이 바이트 동일해야 하고, `ENGINE_VERSION`을 올려도 골든 파일
(`engine/tests/fixtures/points3d_golden.bin`)이 깨지지 않아야 한다.

### 9.3 예시 메타 JSON

```json
{"schema_version":1,"n_points":118342,"units":"m","origin_m":[254012.3371,4180044.9126,31.4802],"extent_m":[8.0012,6.0009,0.0719],"deviation":{"unit_mm":0.1,"not_floor":-32768,"no_deviation":-32767},"sample_cell_m":0.009797958971132712,"fit_bounds":{"min":[0.0,0.0,0.0],"max":[8.0012,6.0009,0.0719]},"sampling":{"method":"cell min-hash stratified","source_points":120701,"cap":500000},"order":"hash"}
```

실제 파일에서는 이 문자열 뒤에 `8 + json_len`이 4의 배수가 될 만큼 공백이 붙는다.

### 9.4 인코딩 규칙 (작성기)

```
mn  = xyz_local.min(axis=0);  mx = xyz_local.max(axis=0);  ext = mx - mn        # float64
inv = where(ext > 0, 65535.0 / ext, 0.0)
q   = clip(rint((xyz_local - mn) * inv), 0, 65535).astype('<u2')                # (n, 3), C 순서 = x,y,z 인터리브
dev = sample.dev_q.astype('<i2')                                                # 이미 센티널·clip 이 끝난 값
deq = q * ext / 65535.0                                                         # 복원 좌표(파일-로컬)
has = dev > -32767
fit_min, fit_max = (deq[has].min(0), deq[has].max(0)) if has.any() else ([0,0,0], ext)

meta = {                                                  # dict 삽입 순서 = 기록 순서(§9.2)
    "schema_version": 1,
    "n_points": n,
    "units": "m",
    "origin_m": (sample.origin_abs + mn).tolist(),
    "extent_m": ext.tolist(),
    "deviation": {"unit_mm": 0.1, "not_floor": -32768, "no_deviation": -32767},
    "sample_cell_m": float(sample.sample_cell_m),
    "fit_bounds": {"min": list(fit_min), "max": list(fit_max)},      # Python float 3개씩
    "sampling": {"method": "cell min-hash stratified",
                 "source_points": int(sample.source_points), "cap": int(sample.cap)},
    "order": "hash",
}
js   = json.dumps(meta, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("ascii")
js  += b" " * ((-(8 + len(js))) % 4)
blob = b"FP3D" + struct.pack("<I", len(js)) + js + q.tobytes() + dev.tobytes()
```

- `xyz_local`은 `info.bbox_min * scale_to_m`(= `origin_abs`)을 뺀 로컬 좌표(m, float64)다.
- 범위가 0인 축은 `q = 0`, `extent_m = 0`으로 기록한다.
- `fit_bounds`는 양자화 뒤 복원 좌표로 계산한다(뷰어가 그리는 점을 정확히 감싼다).
- JSON 숫자는 Python `float`의 `repr`(최단 왕복 표기)로 쓴다. 플랫폼·버전과 무관하게 같은 바이트가 나온다.

### 9.5 복원 식 (리더)

```
local[i]  = q[i] * extent_m / 65535          # 파일-로컬 좌표(m). q[i] = (xyz[3i], xyz[3i+1], xyz[3i+2])
abs[i]    = origin_m + local[i]              # 절대 좌표(m). float64 로만 계산한다
dev_mm[i] = dev[i] * 0.1                     # dev[i] > -32767 일 때만
```

- `dev[i] == -32768`: 바닥 아님(구역 없음, furniture/ghost 구역, 또는 서브셀 중앙값에서 5cm 넘게 벗어난 점).
  `dev[i] == -32767`: 바닥 구역 안이지만 잔차 없음(bimodal 서브셀). 둘 다 편차가 없다.
- 유효 편차 범위는 `[-32766, 32767]`(−3276.6mm ~ +3276.7mm)이고 범위 밖 값은 끝값으로 clip돼 있다.
- 좌표 분해능은 축 범위 / 65535다(8m에서 0.12mm, 30m에서 0.46mm, 100m에서 1.5mm). 편차 분해능은 0.1mm다.

### 9.6 검증 규칙

**작성기**(`encode_points3d`, `write_points3d`). 하나라도 어기면 예외를 던지고 파일을 남기지 않는다.

1. `1 <= n`. 점이 0개면 `ValueError`.
2. `n <= MAX_POINTS`(엔진 상수. `sample.cap`이 아니라 상수와 비교한다).
3. `xyz_local.shape == (n, 3)`, `dev_q.shape == (n,)`, `dev_q.dtype == int16`, 좌표가 전부 유한값.
4. `len(blob) == 8 + json_len + 8 * n` 그리고 `(8 + json_len) % 4 == 0`.
5. `write_points3d`는 `encode_points3d`가 돌려준 blob을 한 번에 쓴다. 쓰는 중 예외가 나면
   `out_path.unlink(missing_ok=True)` 뒤 예외를 다시 던진다.

**리더**(`dashboard/lib/domain/points3d.ts`의 `parsePoints3d`, 엔진의 `read_points3d`). 위에서부터 차례로 검사하고
처음 어긴 항목의 사유로 실패한다.

| 순서 | 검사 | 실패 사유 |
|---|---|---|
| 1 | `byteLength >= 8` | `too_short` |
| 2 | 앞 4바이트가 `FP3D` | `bad_magic` |
| 3 | `8 + json_len <= byteLength` 그리고 `(8 + json_len) % 4 == 0` | `bad_header` |
| 4 | JSON 영역을 UTF-8로 풀어 `JSON.parse` 성공, 결과가 객체 | `bad_json` |
| 5 | `schema_version === 1` | `unsupported_version` |
| 6 | 메타 형식: `n_points`가 1 이상 정수, `units === "m"`, `origin_m`·`extent_m`가 유한수 3개(`extent_m >= 0`), `deviation.unit_mm === 0.1`·`not_floor === -32768`·`no_deviation === -32767`, `sample_cell_m`이 0보다 큰 유한수, `fit_bounds.min`·`max`가 유한수 3개이고 축마다 `min <= max`, `order === "hash"` | `bad_meta` |
| 7 | `byteLength === 8 + json_len + 8 * n_points` | `size_mismatch` |
| 8 | 호스트가 little-endian(TS 전용: `new Uint8Array(new Uint16Array([1]).buffer)[0] === 1`) | `big_endian_host` |

- 실패를 알리는 방법: `parsePoints3d`는 `{ ok: false, reason }`을 돌려주고, `read_points3d`는 사유 문자열을 메시지로 하는
  `ValueError`를 던진다. `read_points3d`는 1~7만 검사한다(numpy가 `'<u2'`·`'<i2'`로 엔디안을 명시해 읽으므로 8이 필요 없다).
- 8번은 버퍼 내용이 아니라 호스트의 성질이다. TS에서는 판정을 `isLittleEndianHost()`로 떼어 두고
  `parsePoints3d(buf, hostIsLittleEndian = isLittleEndianHost())`의 둘째 인자로 받는다. 테스트는 `false`를 넘겨
  `big_endian_host`를 확인한다(변조한 버퍼로는 만들 수 없는 사유다).
- 모르는 메타 키는 무시한다(추가 키는 호환 변경).
- TS 리더는 `instanceof ArrayBuffer`로 입력을 검사하지 않는다. vitest jsdom에서 `readFileSync(...).buffer`와 그
  `slice` 결과가 전역 `ArrayBuffer`의 인스턴스가 아니어서, 그렇게 짜면 브라우저에서는 통과하고 골든 테스트에서만
  거부된다. `byteLength`와 `DataView`·TypedArray 생성만 쓴다.
````

`dashboard/lib/domain/points3d.ts`는 뒤 태스크(Task 6)가 같은 브랜치에서 만든다. 지금 파일이 없어도 문서는 그 경로로 적는다.

- [ ] **Step 10: `scan-guideline.md` §11.3의 코드 나열에 추가**

`docs/scan-guideline.md`

바꾸기 전(`:605-606`):

```
`heatmap_render_failed`, `preview3d_render_failed`, `deviation_render_failed`는 그림 생성이
디스크·폰트 등 인프라 사유로 실패했다는 뜻이다. **판정 수치는 영향받지 않는다**`[스펙 계약 §5]`.
```

바꾼 뒤(두 줄이 세 줄이 된다. `:607`의 `재스캔하지 말고 시스템 담당자에게 알린다.`는 그대로 둔다):

```
`heatmap_render_failed`, `preview3d_render_failed`, `deviation_render_failed`,
`points3d_render_failed`는 그림 또는 3D 점군 데이터 생성이 디스크·폰트 등 인프라 사유로 실패했다는
뜻이다. **판정 수치는 영향받지 않는다**`[스펙 계약 §5]`.
```

- [ ] **Step 11: 세 대조 테스트가 통과하는지 확인**

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run lib/domain/__tests__/labels.test.ts
```

Expected: PASS. `Tests  10 passed (10)`.

```bash
cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_report_labels.py -q
```

Expected: PASS. `5 passed`.

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_summary.py -q
```

Expected: PASS. `8 passed`(기존 7 + 신규 1).

엔진 테스트가 `assert 14 == 13`이면 §9의 표가 `## 6.` 앞에 들어간 것이다(Step 9의 위치를 다시 본다). `assert 12 == 13`이면 Step 8-3의 행이 없거나 첫 열에 백틱이 빠졌다.

- [ ] **Step 12: 전체 스위트·타입 검사·문서 점검**

(12-1) 스위트 전체.

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q
```

Expected: 실패 0. 통과 수는 이 태스크 시작 전보다 정확히 1 많다(신규 테스트 1건. 2026-10-02 기준선만 놓고 보면 244 → 245이고, T1~T4가 더한 테스트만큼 더 많다).

```bash
cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q
```

Expected: `209 passed, 2 deselected`(워커는 테스트 수가 변하지 않는다).

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run && npx tsc --noEmit
```

Expected: `Test Files  84 passed (84)`, `Tests  770 passed (770)`(769 + 신규 1). `tsc`는 출력 없이 종료 코드 0.

(12-2) 문서와 코드의 대조. 이 문서는 "코드와 줄 단위로 대조해 작성"한다는 정본이므로, 새로 적은 이름이 T1·T3·T4가 실제로 만든 코드와 같은지 확인한다.

```bash
cd D:/Projects/Flatness
grep -n "points3d_paths\|points3d_threshold_q\|points3d_render_failed\|POINTS3D_FILE" engine/flatness/core/pipeline.py
grep -n "^MAX_POINTS\|^DEV_" engine/flatness/core/pointsample.py
grep -n "^MAGIC\|^SCHEMA_VERSION\|^FILE_NAME\|^def " engine/flatness/outputs/points3d.py
```

Expected(아래 이름과 값이 글자 그대로 보여야 한다. 같은 grep에 더 잡히는 줄, 즉 `pipeline.py`의 import 줄·`stats.pop("points3d_threshold_q", None)`·`(out_dir / POINTS3D_FILE).unlink(...)`, `pointsample.py`의 `OFF_SURFACE_M`과 줄 끝 주석, `points3d.py`의 비공개 헬퍼 `def _...`는 정상이다):
- `pipeline.py`: `stats["points3d_paths"] = [write_points3d(sample, out_dir / POINTS3D_FILE)]`, `stats["points3d_threshold_q"] = int(round(criterion.pass_mm * 10))`, `stats["points3d_paths"] = []`, `render_warns.add("points3d_render_failed")`
- `pointsample.py`(줄 앞부분): `MAX_POINTS = 500_000`, `DEV_UNIT_M = 1e-4`, `DEV_NOT_FLOOR = -32768`, `DEV_NO_DEVIATION = -32767`, `DEV_MIN, DEV_MAX = -32766, 32767`
- `points3d.py`: `MAGIC = b"FP3D"`, `SCHEMA_VERSION = 1`, `FILE_NAME = "points3d.bin"`, `def encode_points3d`, `def write_points3d`, `def read_points3d`

확인하는 것은 이 문서(§2 두 행, §5 한 행, §6 한 행, §9)가 적은 키 이름·경고 코드·상수 값·함수 이름이 코드와 같은가다. 하나라도 다르면 문서를 코드에 맞춰 고치지 말고 멈춰서 보고한다(요구의 출처는 스펙이고, 어긋난 쪽이 결함이다).

(12-3) 문서 구조와 금지 문자.

```bash
cd D:/Projects/Flatness
grep -n '^## ' docs/contracts/stats-schema.md
```

Expected: 제목 순서가 `## 0.` … `## 5. warnings 코드 사전`(205행) → `## 6. 산출물 파일 규약`(240행) → `## 7.` → `## 8.` → `## 9. points3d.bin 형식 계약 (schema_version=1)`(513행) → `## 부록 A.`(653행).

```bash
cd D:/Projects/Flatness
git diff -U0 -- docs/contracts/stats-schema.md docs/scan-guideline.md | grep '^+' | grep -v '^+++' | grep -c '—'
git diff -U0 -- engine/tests worker dashboard | grep '^+' | grep -v '^+++' | grep -c '—'
git diff -U0 | grep '^+' | grep -v '^+++' | grep -c '발[주]처'
```

Expected: 차례로 `2`, `0`, `0`. 첫 값 2는 Step 8-2의 두 행(wall·import 칸의 기존 표기 `—`)이다. 2보다 크면 새로 쓴 문장에 U+2014가 들어간 것이니 지운다. 셋째 명령의 `[주]`는 저장소가 금지하는 낱말을 이 계획 파일에 그대로 적지 않으려는 대괄호 표기이고, 정규식으로는 그 낱말과 똑같이 매칭된다. (`grep -c`는 0건일 때 종료 코드 1을 내지만 출력 `0`이 정상이다.)

```bash
cd D:/Projects/Flatness && git diff --stat
```

Expected: `8 files changed, 181 insertions(+), 8 deletions(-)`. 파일별로 `stats-schema.md` +147/−2, `scan-guideline.md` +3/−2, `test_summary.py` +19/−3, `labels.py` +2, `test_report_labels.py` +1/−1, `labels.ts` +2, `types.ts` +2, `labels.test.ts` +5. 줄 수가 크게 다르면 줄바꿈(CRLF)이 바뀌었거나 범위 밖을 고친 것이다.

```bash
cd D:/Projects/Flatness && git diff --stat -- engine/flatness worker/flatworker/storage.py worker/flatworker/jobs.py
```

Expected: 출력 없음(`summary.py`의 `_WARN_TEXT`, `ENGINE_VERSION`, 워커의 다른 코드를 건드리지 않았다).

- [ ] **Step 13: 스테이징한 뒤 변이 확인(테스트가 회귀를 실제로 잡는지)**

먼저 스테이징한다. 아래 변이는 작업 트리에만 넣고 `git checkout -- <파일>`로 인덱스(스테이징한 정상본)에서 되돌린다.

```bash
cd D:/Projects/Flatness
git add docs/contracts/stats-schema.md docs/scan-guideline.md engine/tests/test_summary.py worker/flatworker/report/labels.py worker/tests/test_report_labels.py dashboard/lib/domain/labels.ts dashboard/lib/domain/types.ts dashboard/lib/domain/__tests__/labels.test.ts
git status --short
```

Expected: 8줄 전부 `M  <경로>`(첫 열 `M`, 둘째 열 공백).

변이 A: 워커 사본의 문자열 한 글자 차이(`3D` → `3d`).

```bash
cd D:/Projects/Flatness
sed -i '/"points3d_render_failed":/,+1 s/3D/3d/' worker/flatworker/report/labels.py
(cd worker && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_report_labels.py -q)
git checkout -- worker/flatworker/report/labels.py
```

Expected: `1 failed, 4 passed`(`test_warning_dictionary_matches_dashboard`).

변이 B: 계약 문서 §5의 새 행 누락.

```bash
cd D:/Projects/Flatness
sed -i '/^| `points3d_render_failed` |/d' docs/contracts/stats-schema.md
(cd engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_summary.py -q)
git checkout -- docs/contracts/stats-schema.md
```

Expected: `2 failed, 6 passed`(`assert 12 == 13`).

변이 C: 계약 문서 §5의 새 행 코드 철자 오타(개수는 13 그대로).

```bash
cd D:/Projects/Flatness
sed -i 's/^| `points3d_render_failed` |/| `points3d_render_fail` |/' docs/contracts/stats-schema.md
(cd engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_summary.py -q)
git checkout -- docs/contracts/stats-schema.md
```

Expected: `1 failed, 7 passed`. 실패는 `test_render_failed_codes_are_documented_and_kept_out_of_summary_text` 하나다(개수 단언은 통과한다. 이 변이를 잡으려고 Step 3-4의 테스트를 넣었다).

변이 D: 정본 라벨 문구 변경(`3D` → `3d`).

```bash
cd D:/Projects/Flatness
sed -i '/points3d_render_failed:/,+1 s/3D/3d/' dashboard/lib/domain/labels.ts
(cd dashboard && npx vitest run lib/domain/__tests__/labels.test.ts)
(cd worker && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_report_labels.py -q)
git checkout -- dashboard/lib/domain/labels.ts
```

Expected: vitest `Tests  1 failed | 9 passed (10)`, 워커 `1 failed, 4 passed`.

되돌림 확인:

```bash
cd D:/Projects/Flatness && git diff --quiet && echo CLEAN
```

Expected: `CLEAN`(작업 트리가 스테이징한 내용과 같다). 변이가 하나라도 살아남으면(테스트가 통과하면) 커밋하지 말고 테스트를 고친다.

- [ ] **Step 14: 커밋**

```bash
cd D:/Projects/Flatness
git add docs/contracts/stats-schema.md docs/scan-guideline.md engine/tests/test_summary.py worker/flatworker/report/labels.py worker/tests/test_report_labels.py dashboard/lib/domain/labels.ts dashboard/lib/domain/types.ts dashboard/lib/domain/__tests__/labels.test.ts
git commit -F - <<'EOF'
feat(dashboard,worker,docs): 3D 점군 계약 동반 수정 - stats 키·경고 라벨·points3d.bin 형식(§9)

- stats-schema.md: 조건부 키 points3d_paths·points3d_threshold_q, 경고 points3d_render_failed,
  산출물 points3d.bin, 새 절 §9(파일 형식 계약 schema_version=1)
- labels.ts(정본)·labels.py(사본): points3d_render_failed 라벨. 개수 단언 12 -> 13
  (엔진 문서 파서, 워커 대조)
- types.ts: Stats 에 points3d_paths?·points3d_threshold_q?
- scan-guideline.md 11.3: 렌더 실패 코드 나열에 추가
- summary.py 의 _WARN_TEXT 에는 넣지 않는다. 렌더 실패 4종이 계약 문서에 있고 종합의견 사전에
  없음을 테스트로 고정했다

대조: stats-schema.md 의 새 행과 §9 를 core/pipeline.py(analyze_floor 의 points3d 블록),
core/pointsample.py(상수), outputs/points3d.py(MAGIC·SCHEMA_VERSION·FILE_NAME, 작성기·리더)와
이름 단위로 대조했다. 변이 4종(사본 한 글자 차이, 문서 행 누락, 문서 행 코드 오타, 정본 문구 변경)이
대응 테스트를 죽이는 것을 확인했다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git status --short
```

Expected: 커밋 1개가 생기고 `git status --short` 출력이 비어 있다.

> 계획 작성 시 확인(2026-10-02, `.superpowers/plan-drafts/pointcloud-viewer/scratch-05/`): 위 '바꾸기 전' 조각이 실제 파일에 각각 정확히 한 번 나오는 것을 스크립트로 단언하며 적용했고, Step 4·11·12-1·13의 기대 출력(실패·통과 수, 줄 수, 제목 줄 번호)은 그 사본에서 실제로 돌려 얻은 값이다. Step 12-2의 grep 기대값만 T1·T3·T4의 뼈대 시그니처와 그 태스크 초안(`task-01.md`·`task-03.md`·`task-04.md`)이 적은 코드에서 옮긴 것이다(그 코드는 계획 작성 시점에 저장소에 없었다).
>
> 재확인(2026-10-03, 같은 스크래치): 저장소 파일 8개에 테스트 수정만 얹은 사본(`scratch-05/red/`)에서 Step 4의 세 실패 출력(vitest `1 failed | 9 passed (10)` + Expected/Received 두 줄, 워커 `1 failed, 4 passed`·`assert 12 == 13`, 엔진 `2 failed, 6 passed`·둘 다 `:76`)을, 전부 적용한 사본에서 Step 11의 통과(10 / 5 / 8)를 다시 얻었다. 변이 9종(`scratch-05/mutate.py`: 사본 문자열 한 글자·키 오타·항목 누락, 정본 문구 변경·항목 누락, 문서 행 누락·코드 오타·백틱 제거·§9 표를 §5 구간에 넣기)이 기대한 테스트만 죽이고 되돌리면 전부 통과했다. `tsc` 오버레이는 optional 필드로 오류 0, 두 필드를 필수로 바꾼 변이에서 Step 7이 말한 픽스처 4곳의 TS2739였다. Step 12-3의 제목 줄 번호(205·240·513·653), `git diff --stat`(8 files, +181/−8, 파일별 수치 포함), U+2014 개수(2 / 0), Step 13의 `sed` 네 개가 CRLF를 유지한 채 의도한 한 글자 변이만 만드는 것도 사본에서 확인했다. 저장소의 대시보드 전체 스위트는 84파일 769건이었다(Step 12-1의 770 = 769 + 1).

---
### Task 6: 대시보드 도메인 1: `points3d.bin` 파서·분류·복원·읽기 창 문자열·색 표

**목표:** `lib/domain/points3d.ts`가 골든 파일을 엔진과 같은 값으로 읽고(리더 규칙 8종 포함), 분류·좌표 복원·읽기 창 문자열·임계값 표기·색 표가 순수 함수로 검증되며, 엔진 테스트가 TS 상수와 엔진 상수의 일치를 감시한다.

**Files:**
- Create: `dashboard/lib/domain/points3d.ts`
- Create: `dashboard/lib/domain/__tests__/points3d.test.ts`
- Modify: `engine/tests/test_points3d.py` (Task 3이 만든 파일이라 이 계획을 쓰는 시점에는 저장소에 없다. 줄 번호 대신 위치로 지정한다: **파일 맨 끝에 블록 하나를 덧붙인다.** Task 3 계획대로면 이 파일은 테스트 83개이고, 마지막 구획은 `# ---- 형식 골든 (§10.2)` 주석 아래 `from tests.fixtures.points3d_golden import GOLDEN_PATH, golden_sample  # noqa: E402`로 시작해 `test_golden_file_content_by_hand`로 끝난다. 그 함수 다음에 붙인다. Task 3이 쓴 본문은 한 줄도 고치지 않는다)
- Test: `dashboard/lib/domain/__tests__/points3d.test.ts`, `engine/tests/test_points3d.py`
- 읽기만 한다(고치지 않는다): `engine/tests/fixtures/points3d_golden.bin` (Task 3 산출물, 488바이트)

**Interfaces:**
- Consumes:
  - Task 3: 골든 파일 `engine/tests/fixtures/points3d_golden.bin`(488바이트, `json_len` 384, n = 12, sha256 `b0c50d8a0f2e77e3077c6b38fb6795cc89bf321601c56fb8a3e855efbc6892d9`)과 그 정의: `origin_abs = [254012.3371, 4180044.9126, 31.4802]`, 로컬 최솟값 `MN = [0.5, 0.25, 0.125]`, 범위 `EXT = [4.0, 2.5, 0.3125]`, `xyz_local = MN + Q * EXT / 65535.0`, `sample_cell_m = 0.0125`, `source_points = 12345`, `cap = 500000`. 메타의 `origin_m = [254012.8371, 4180045.1626, 31.6052]`, `fit_bounds.max` z = `23456 * 0.3125 / 65535`.
  - Task 3: 골든 Q(행 = 점, 열 = qx,qy,qz)와 dev: 0:(0,0,0) dev 0 / 1:(65535,65535,4096) dev 32 / 2:(258,772,1286) dev -105 / 3:(32768,16384,8192) dev 70 / 4:(1,65534,2) dev 71 / 5:(40000,20000,10000) dev -70 / 6:(12345,54321,23456) dev -71 / 7:(100,200,65535) dev -32768 / 8:(50000,60000,300) dev -32767 / 9:(65280,255,4660) dev 32767 / 10:(4660,43981,291) dev -32766 / 11:(21845,43690,13107) dev 1
  - Task 3: 엔진 상수 `MAGIC = b"FP3D"`, `SCHEMA_VERSION = 1` (`flatness.outputs.points3d`). Task 1: `DEV_NOT_FLOOR = -32768`, `DEV_NO_DEVIATION = -32767`, `DEV_UNIT_M = 1e-4` (`flatness.core.pointsample`)
  - 스펙 §5.5 복원 식: `local[i] = q[i] * extent_m / 65535`, `abs[i] = origin_m + local[i]`
  - 스펙 §5.6 리더 규칙 1~8과 실패 사유 문자열(아래 "배경"의 표)
- Produces (`dashboard/lib/domain/points3d.ts`. Task 7·8~14가 이 이름과 타입을 그대로 쓴다):
  - `export const POINTS3D_MAGIC = 'FP3D';` `export const POINTS3D_SCHEMA_VERSION = 1;` `export const DEV_NOT_FLOOR = -32768;` `export const DEV_NO_DEVIATION = -32767;` `export const DEV_UNIT_MM = 0.1;` `export const THRESHOLD_Q_MIN = 10;` `export const THRESHOLD_Q_MAX = 300;` `export const THRESHOLD_Q_STEP = 5;` `export const EXAGGERATIONS = [1, 10, 50, 100] as const;` (선언 형식을 이대로 둔다. 엔진 테스트가 `export const NAME = 값;` 정규식으로 읽는다)
  - `export type PointClass = 'flat' | 'depression' | 'protrusion' | 'none';` `export const POINT_CLASS_LABEL: Record<PointClass, string>` = `{ flat: 'FLAT', depression: 'DEPRESSION', protrusion: 'PROTRUSION', none: '편차 없음' }`
  - `export interface Points3dMeta { schema_version: number; n_points: number; units: 'm'; origin_m: [number, number, number]; extent_m: [number, number, number]; deviation: { unit_mm: number; not_floor: number; no_deviation: number }; sample_cell_m: number; fit_bounds: { min: [number, number, number]; max: [number, number, number] }; sampling: { method: string; source_points: number; cap: number }; order: 'hash'; }`
  - `export interface Points3dData { meta: Points3dMeta; xyz: Uint16Array; dev: Int16Array; }` (받은 버퍼를 복사 없이 가리키는 뷰. `xyz` 길이 3n, `dev` 길이 n)
  - `export type Points3dError = 'too_short' | 'bad_magic' | 'bad_header' | 'bad_json' | 'unsupported_version' | 'bad_meta' | 'size_mismatch' | 'big_endian_host';` `export type Points3dParse = { ok: true; data: Points3dData } | { ok: false; reason: Points3dError };`
  - `export function isLittleEndianHost(): boolean;` `export function parsePoints3d(buf: ArrayBufferLike, hostIsLittleEndian?: boolean): Points3dParse;` (둘째 인자 기본값 `isLittleEndianHost()`)
  - `export function classifyDev(d: number, thresholdQ: number): PointClass;` `export function localOf(data: Points3dData, i: number): [number, number, number];` `export function absoluteOf(data: Points3dData, i: number): [number, number, number];`
  - `export function readoutLines(data: Points3dData, i: number, thresholdQ: number): string[];` 편차 있는 점 5줄 [`X {x} m`, `Y {y} m`, `Z {z} m`, `편차 {d} mm`, 분류 이름], 편차 없는 점 4줄(마지막 `편차 없음`)
  - `export function fmtThresholdMm(q: number): string;` (70 → `'7'`, 75 → `'7.5'`, 63 → `'6.3'`)
  - `export type ThemeName = 'dark' | 'light';` `export interface Points3dTheme { background: string; flat: string; depression: string; protrusion: string; none: string; line: string; gridAlpha: number; axisAlpha: number; text: string; textSecondary: string; readoutBackground: string; readoutAlpha: number; }` `export const POINTS3D_THEME: Record<ThemeName, Points3dTheme>;` `export function hexToRgb01(hex: string): [number, number, number];`
  - `engine/tests/test_points3d.py`: `test_ts_constants_match_engine` (TS 상수 5개를 엔진 상수와 대조)

**배경 (이 태스크만 읽고 끝낼 수 있도록 스펙에서 옮긴 것)**

`points3d.bin`은 엔진이 바닥 분석 때 쓰는 점 표본 파일이다. 전부 little-endian이다. `n` = 점 수, `L` = `json_len`.

| 오프셋 | 길이 | 내용 |
|---|---|---|
| `[0, 4)` | 4 | magic. ASCII `FP3D` |
| `[4, 8)` | 4 | uint32 `json_len`. JSON 영역의 바이트 수이며 끝의 공백(`0x20`) 패딩을 포함한다. `8 + json_len`은 4의 배수다 |
| `[8, 8+L)` | L | UTF-8 JSON 메타 |
| `[8+L, 8+L+6n)` | 6n | `uint16 xyz[3n]`. 점마다 x, y, z 인터리브 |
| `[8+L+6n, 8+L+8n)` | 2n | `int16 dev[n]`. 0.1mm 정수 편차. `-32768` = 바닥 아님, `-32767` = 바닥 구역 안이지만 잔차 없음(둘 다 "편차 없음") |

리더 규칙(스펙 §5.6). **위에서부터 차례로 검사하고 처음 어긴 항목의 사유로 실패한다.**

| 순서 | 검사 | 실패 사유 |
|---|---|---|
| 1 | `byteLength >= 8` | `too_short` |
| 2 | 앞 4바이트가 `FP3D` | `bad_magic` |
| 3 | `8 + json_len <= byteLength` 그리고 `(8 + json_len) % 4 == 0` | `bad_header` |
| 4 | JSON 영역을 UTF-8로 풀어 `JSON.parse` 성공, 결과가 객체 | `bad_json` |
| 5 | `schema_version === 1` | `unsupported_version` |
| 6 | `n_points`가 1 이상 정수, `units === "m"`, `origin_m`·`extent_m`가 유한수 3개(`extent_m >= 0`), `deviation.unit_mm === 0.1`·`not_floor === -32768`·`no_deviation === -32767`, `sample_cell_m`이 0보다 큰 유한수, `fit_bounds.min`·`max`가 유한수 3개이고 축마다 `min <= max`, `order === "hash"` | `bad_meta` |
| 7 | `byteLength === 8 + json_len + 8 * n_points` | `size_mismatch` |
| 8 | 호스트가 little-endian | `big_endian_host` |

- 모르는 메타 키는 무시한다. 키 순서에 기대지 않는다. `sampling`은 6번 목록에 없으므로 검사하지 않는다.
- 8번은 버퍼가 아니라 호스트의 성질이라 변조한 버퍼로 만들 수 없다. 그래서 `parsePoints3d`의 둘째 인자로 주입한다.

분류(스펙 §7.4). 0.1mm 정수끼리 비교한다. `T_q`는 임계값(0.1mm 정수, 예: 7mm = 70).

| 조건 | 분류 |
|---|---|
| `d <= -32767`(센티널) | 편차 없음 (`'none'`) |
| `d > T_q` | PROTRUSION |
| `d < −T_q` | DEPRESSION |
| 그 외(`−T_q <= d <= T_q`) | FLAT |

읽기 창(스펙 §7.9). X·Y·Z는 절대 좌표(m) 소수 3자리. 편차는 `dev` 정수에서 직접 만든 mm 소수 1자리이고 부호는 양수 `+`, 음수 `−`(U+2212), 0은 부호 없이 `0.0`이다(`32` → `+3.2`, `-105` → `−10.5`, `0` → `0.0`). 편차 없는 점(두 센티널 모두)은 4·5행 대신 `편차 없음` 한 줄이다.

```
X 254016.337 m
Y 4180047.912 m
Z 31.492 m
편차 +3.2 mm
PROTRUSION
```

색 표(스펙 §7.6). `POINTS3D_THEME`의 값이다.

| 항목 | 필드 | `dark`(기본) | `light` |
|---|---|---|---|
| 배경 | `background` | `#000000` | `#ffffff` |
| FLAT | `flat` | `#4cc96f` | `#1e9e50` |
| DEPRESSION | `depression` | `#f5c33b` | `#b88700` |
| PROTRUSION | `protrusion` | `#f06464` | `#d93636` |
| 편차 없음 | `none` | `#4a4f57` | `#b4bac2` |
| 격자선·축선 색 | `line` | `#ffffff` | `#000716` |
| 격자선 알파 | `gridAlpha` | 0.09 | 0.09 |
| 축선 알파 | `axisAlpha` | 0.28 | 0.28 |
| 글자 | `text` | `#f2f4f7` | `#000716` |
| 보조 글자 | `textSecondary` | `#9aa3ad` | `#5f6b7a` |
| 읽기 창 배경 | `readoutBackground` | `#000000` | `#ffffff` |
| 읽기 창 배경 알파 | `readoutAlpha` | 0.8 | 0.9 |

읽기 창 테두리는 별도 필드가 아니다. 축선과 같은 값(`line` + `axisAlpha`)을 쓴다.

**함정 (어기면 뒤 태스크나 다른 테스트가 깨진다)**

1. 입력을 `instanceof ArrayBuffer`로 검사하지 않는다. vitest jsdom에서 `readFileSync(...).buffer`와 그 `slice` 결과는 전역 `ArrayBuffer`의 인스턴스가 아니다. 그렇게 짜면 브라우저에서는 통과하고 골든 테스트에서만 거부된다(계획 작성 중 실측: 그 가드를 넣으면 31건 실패). `byteLength`와 `DataView`·TypedArray 생성만 쓴다.
2. 골든 경로는 `join(__dirname, '../../../../engine/tests/fixtures/points3d_golden.bin')`이다. 작은 Buffer는 풀링된 ArrayBuffer의 임의 오프셋을 가리키므로 반드시 `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)`로 잘라 넘긴다.
3. 검사 순서는 위 표 그대로이고 TypedArray 뷰는 7번(`size_mismatch`)을 통과한 뒤에 만든다(본문 시작 `8 + json_len`, dev 시작 `8 + json_len + 6n`). 먼저 만들면 모자란 파일에서 `RangeError`가 난다.
4. 테스트의 기대값은 위 Interfaces의 표(Q, dev, EXT, origin)에서 손으로 옮긴 상수다. 구현 출력이나 파이썬 출력을 복사하지 않는다.
5. 편차 문자열은 정수 `dev`에서 직접 만든다(`Math.floor(a / 10)`과 `a % 10`). 0.1을 곱한 뒤 `toFixed`를 쓰지 않는다. 음수 부호는 U+2212, 0은 부호 없이 `0.0`.
6. 이 태스크의 두 파일(주석 포함)에 `pass_mm`, `rework_mm`, `u_mm`, `applied_criteria` 문자열을 쓰지 않는다(Task 14의 소스 검사 테스트가 주석까지 센다). `색이름-숫자` 꼴 표기(옛 Tailwind 팔레트 클래스 모양)와 U+2014도 쓰지 않는다. 색은 hex나 한글 이름으로만 적는다.
7. `lib/domain`은 `lib/viz`를 import하지 않는다. 이 파일은 DOM·WebGL을 건드리지 않는다.
8. Task 7이 같은 두 파일에 **추가만** 한다(소스 머리 주석 다음에 import 한 줄, 파일 끝에 새 export. 테스트 머리에 import, 끝에 describe). 그래서 이 태스크는 소스 파일 머리를 `//` 주석 블록 → 빈 줄 → `// ---- 상수 ----` 순서로 두고, 테스트의 vitest import를 `import { describe, expect, it } from 'vitest';` 한 줄로 둔다. 아래 코드를 그대로 쓰면 맞는다.
9. 이 태스크의 두 파일은 Next.js API를 쓰지 않는 순수 TS 모듈과 vitest 테스트다. `dashboard/AGENTS.md`가 요구하는 `node_modules/next/dist/docs/` 확인 대상(라우팅·컴포넌트 관례)이 없다. `'use client'`를 붙이지 않는다.

**스펙이 한 줄로만 적은 것을 이 태스크에서 정한 것**

- 좌표 줄의 음수: 스펙 §7.9는 "소수 3자리(`toFixed(3)`)"만 적고, §7.12는 화면 문구의 음수 부호를 U+2212로 정했다. 스캐너 원점 좌표계에서는 절대 좌표가 음수일 수 있으므로, 좌표 줄도 `toFixed(3)` 결과의 맨 앞 `-`를 U+2212로 바꾼다. 반올림해 0이 되는 음수(`-0.000`)는 부호 없이 `0.000`으로 적는다. 양수와 0의 출력은 `toFixed(3)` 그대로다.
- JSON이 배열·숫자·문자열·`null`이면 "결과가 객체"가 아니므로 `bad_json`이다. JSON 영역이 UTF-8이 아니면(`TextDecoder`의 `fatal: true`) `bad_json`이다.
- `schema_version`이 없거나 문자열 `"1"`이면 `unsupported_version`이다(`=== 1` 비교).

---

- [ ] **Step 1: 선행 산출물 확인**

Task 3의 골든 파일과 테스트 파일, Task 1·3의 엔진 상수가 있어야 한다.

```bash
cd D:/Projects/Flatness
ls -l engine/tests/fixtures/points3d_golden.bin engine/tests/test_points3d.py
sha256sum engine/tests/fixtures/points3d_golden.bin
PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -c "from flatness.outputs.points3d import MAGIC, SCHEMA_VERSION; from flatness.core.pointsample import DEV_NOT_FLOOR, DEV_NO_DEVIATION, DEV_UNIT_M; print(MAGIC, SCHEMA_VERSION, DEV_NOT_FLOOR, DEV_NO_DEVIATION, DEV_UNIT_M)"
ls dashboard/lib/domain/points3d.ts 2>&1
```

Expected:
- `points3d_golden.bin`의 크기가 `488`, sha256이 `b0c50d8a0f2e77e3077c6b38fb6795cc89bf321601c56fb8a3e855efbc6892d9`.
- 파이썬 출력이 `b'FP3D' 1 -32768 -32767 0.0001`.
- 마지막 `ls`는 `No such file or directory`(이 태스크가 만든다).

하나라도 다르면 멈추고 보고한다(Task 1·3이 끝나지 않았거나 골든이 바뀐 것이다. 골든을 이 태스크에서 다시 만들지 않는다).

- [ ] **Step 2: 실패하는 엔진 테스트 추가 (TS 상수 대조)**

`engine/tests/test_points3d.py`의 **맨 끝**에 빈 줄 두 개를 두고 아래 블록을 덧붙인다. 블록이 자기 import를 들고 있으므로 Task 3이 쓴 파일 머리는 고치지 않는다. import가 파일 중간에 오는 것은 의도한 것이고 Task 3의 골든 구획도 같은 방식이다(`# noqa: E402`). Task 3의 파일 머리는 `import pathlib`(모듈)을 쓰고 `re`는 없으므로 아래 네 import 줄이 모두 필요하다(머리에 이미 `import re`나 `from pathlib import Path`가 있으면 이 블록의 같은 줄은 지워도 된다).

```python
# --- TS 상수 대조 (스펙 §10.1) ---------------------------------------------------------------
# dashboard/lib/domain/points3d.ts 가 엔진과 같은 magic·schema version·센티널·편차 단위를 쓰는지 본다.
# 같은 파일 형식을 두 언어가 따로 구현하므로, 한쪽 상수만 바꾸면 이 테스트가 죽어야 한다.
# 저장소 파일을 읽는 선례: test_summary.py 의 _STATS_SCHEMA_MD.
import re  # noqa: E402
from pathlib import Path  # noqa: E402

import flatness.core.pointsample as _engine_sample  # noqa: E402
import flatness.outputs.points3d as _engine_points3d  # noqa: E402

_POINTS3D_TS = Path(__file__).resolve().parents[2] / "dashboard" / "lib" / "domain" / "points3d.ts"


def _ts_const(name: str) -> str:
    """`export const NAME = 값;` 선언에서 값을 문자열 그대로 꺼낸다. 선언은 정확히 1개여야 한다."""
    src = _POINTS3D_TS.read_text(encoding="utf-8")
    found = re.findall(rf"^export const {name} = ([^;]+);", src, flags=re.MULTILINE)
    assert len(found) == 1, (
        f"{_POINTS3D_TS.name} 에 `export const {name} = 값;` 선언이 정확히 1개여야 한다(찾은 수 {len(found)})"
    )
    return found[0].strip()


def test_ts_constants_match_engine():
    assert _ts_const("POINTS3D_MAGIC").strip("'\"") == _engine_points3d.MAGIC.decode("ascii")
    assert int(_ts_const("POINTS3D_SCHEMA_VERSION")) == _engine_points3d.SCHEMA_VERSION
    assert int(_ts_const("DEV_NOT_FLOOR")) == _engine_sample.DEV_NOT_FLOOR
    assert int(_ts_const("DEV_NO_DEVIATION")) == _engine_sample.DEV_NO_DEVIATION
    # 엔진은 m 단위(1e-4), TS 는 mm 단위(0.1)다. 1e-4 * 1000 의 부동소수 오차를 허용해 비교한다
    assert abs(float(_ts_const("DEV_UNIT_MM")) - _engine_sample.DEV_UNIT_M * 1000) < 1e-12
```

이 테스트가 죽이는 변이: TS 쪽 상수 5개 중 하나의 값 변경(`'FP3D'` → 다른 글자, `1` → `2`, 센티널 값 교환, `0.1` → `1`), 엔진 쪽 상수만 변경, TS 선언 형식 변경(예: `export const DEV_NOT_FLOOR: number = -32768;`은 "선언이 정확히 1개여야 한다" 메시지로 죽는다).

- [ ] **Step 3: 엔진 테스트가 실패하는지 확인**

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_points3d.py -q
```

Expected: FAIL. 요약 줄 `1 failed, 83 passed`(83 = Task 3이 남긴 테스트 수. Task 3 계획대로 구현됐으면 83이고, 다르면 그 수가 나온다). 실패는 `test_ts_constants_match_engine` 1건만이고 사유는 `FileNotFoundError: [Errno 2] No such file or directory: 'D:\\Projects\\Flatness\\dashboard\\lib\\domain\\points3d.ts'`다. Task 3의 테스트는 전부 통과한다.

- [ ] **Step 4: 실패하는 vitest 테스트 작성**

`dashboard/lib/domain/__tests__/points3d.test.ts`를 아래 내용으로 만든다.

```ts
// points3d.bin 리더·분류·좌표 복원·읽기 창 문자열·색 표
// (스펙 2026-10-02-pointcloud-viewer-design.md §5.5, §5.6, §7.4, §7.6, §7.9)
//
// 골든 파일(engine/tests/fixtures/points3d_golden.bin)은 엔진이 쓴 것을 그대로 읽는다(pytest 와 공용).
// 아래 기대값은 골든 표본의 정의(engine/tests/fixtures/points3d_golden.py)를 손으로 옮긴 표에서 나온다.
// 구현이나 파이썬 출력을 복사한 값이 아니다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEV_NO_DEVIATION, DEV_NOT_FLOOR, DEV_UNIT_MM, EXAGGERATIONS, POINT_CLASS_LABEL, POINTS3D_MAGIC,
  POINTS3D_SCHEMA_VERSION, POINTS3D_THEME, THRESHOLD_Q_MAX, THRESHOLD_Q_MIN, THRESHOLD_Q_STEP,
  absoluteOf, classifyDev, fmtThresholdMm, hexToRgb01, isLittleEndianHost, localOf, parsePoints3d,
  readoutLines,
} from '../points3d';
import type { PointClass, Points3dData, Points3dError } from '../points3d';

// vitest 는 __dirname 을 준다. __tests__ -> domain -> lib -> dashboard -> 저장소 루트
const GOLDEN_PATH = join(__dirname, '../../../../engine/tests/fixtures/points3d_golden.bin');

// ---- 골든 표본의 정의(손으로 옮긴 표) ----
const ORIGIN_ABS = [254012.3371, 4180044.9126, 31.4802]; // 표본의 origin_abs (UTM 급 대좌표)
const MN = [0.5, 0.25, 0.125];                            // 표본 로컬 좌표의 최솟값
const EXT = [4.0, 2.5, 0.3125];                           // 축별 범위. 셋이 서로 달라 축 전치 변이가 죽는다
// 행 = 점, 열 = qx, qy, qz. 258 = 0x0102, 772 = 0x0304, 1286 = 0x0506 (상·하위 바이트가 다르다)
const Q: [number, number, number][] = [
  [0, 0, 0],
  [65535, 65535, 4096],
  [258, 772, 1286],
  [32768, 16384, 8192],
  [1, 65534, 2],
  [40000, 20000, 10000],
  [12345, 54321, 23456],
  [100, 200, 65535],
  [50000, 60000, 300],
  [65280, 255, 4660],
  [4660, 43981, 291],
  [21845, 43690, 13107],
];
const DEV = [0, 32, -105, 70, 71, -70, -71, -32768, -32767, 32767, -32766, 1];
const JSON_LEN = 384;   // 패딩 전 382바이트 + 공백 2바이트
const FILE_SIZE = 488;  // 8 + 384 + 8 * 12

/** 골든 파일을 새 ArrayBuffer 로 읽는다. 작은 Buffer 는 풀링된 ArrayBuffer 의 임의 오프셋을 가리키므로 반드시 잘라 낸다. */
function golden(): ArrayBufferLike {
  const buf = readFileSync(GOLDEN_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** 골든의 바이트 사본(변조용). */
function goldenBytes(): Uint8Array {
  return new Uint8Array(golden());
}

/** 메타 JSON 문자열과 본문 바이트로 파일을 조립한다(공백 패딩, little-endian json_len). */
function buildFile(json: string, body: Uint8Array): ArrayBufferLike {
  const js = new TextEncoder().encode(json);
  const pad = (4 - ((8 + js.length) % 4)) % 4;
  const out = new Uint8Array(8 + js.length + pad + body.length);
  out.set([0x46, 0x50, 0x33, 0x44], 0); // 'FP3D'
  new DataView(out.buffer).setUint32(4, js.length + pad, true);
  out.set(js, 8);
  out.fill(0x20, 8 + js.length, 8 + js.length + pad);
  out.set(body, 8 + js.length + pad);
  return out.buffer;
}

type Json = Record<string, unknown>;

/** 골든의 메타만 고쳐 다시 조립한다. 본문은 그대로라 크기 검사(7번)에는 걸리지 않는다. */
function withMeta(edit: (m: Json) => void): ArrayBufferLike {
  const src = goldenBytes();
  const meta = JSON.parse(new TextDecoder().decode(src.subarray(8, 8 + JSON_LEN))) as Json;
  edit(meta);
  return buildFile(JSON.stringify(meta), src.subarray(8 + JSON_LEN));
}

/** 골든의 본문(96바이트)에 임의의 메타 문자열을 붙인다. */
function withRawMeta(json: string): ArrayBufferLike {
  return buildFile(json, goldenBytes().subarray(8 + JSON_LEN));
}

function parseOk(buf: ArrayBufferLike): Points3dData {
  const r = parsePoints3d(buf);
  if (!r.ok) throw new Error(`parse 실패: ${r.reason}`);
  return r.data;
}

function reasonOf(buf: ArrayBufferLike, hostIsLittleEndian?: boolean): Points3dError | 'ok' {
  const r = hostIsLittleEndian === undefined ? parsePoints3d(buf) : parsePoints3d(buf, hostIsLittleEndian);
  return r.ok ? 'ok' : r.reason;
}

/** 읽기 창·복원 테스트용 한 점짜리 데이터(파일을 거치지 않는다). */
function onePoint(origin: [number, number, number], dev: number): Points3dData {
  return {
    meta: {
      schema_version: 1, n_points: 1, units: 'm', origin_m: origin, extent_m: [1, 1, 1],
      deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
      sample_cell_m: 0.01, fit_bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      sampling: { method: 'cell min-hash stratified', source_points: 1, cap: 500000 }, order: 'hash',
    },
    xyz: new Uint16Array([0, 0, 0]),
    dev: new Int16Array([dev]),
  };
}

describe('상수 (엔진과 맞춘 값은 engine/tests/test_points3d.py 가 대조한다)', () => {
  it('magic·schema version·센티널·단위', () => {
    expect(POINTS3D_MAGIC).toBe('FP3D');
    expect(POINTS3D_SCHEMA_VERSION).toBe(1);
    expect(DEV_NOT_FLOOR).toBe(-32768);
    expect(DEV_NO_DEVIATION).toBe(-32767);
    expect(DEV_UNIT_MM).toBe(0.1);
  });

  it('슬라이더 범위는 1~30mm, 0.5mm 단계(0.1mm 정수)이고 과장 배율은 1/10/50/100 이다', () => {
    expect([THRESHOLD_Q_MIN, THRESHOLD_Q_MAX, THRESHOLD_Q_STEP]).toEqual([10, 300, 5]);
    expect([...EXAGGERATIONS]).toEqual([1, 10, 50, 100]);
  });

  it('분류 이름은 범례·읽기 창 문구 그대로다', () => {
    expect(POINT_CLASS_LABEL).toEqual({
      flat: 'FLAT', depression: 'DEPRESSION', protrusion: 'PROTRUSION', none: '편차 없음',
    });
  });
});

describe('parsePoints3d: 골든 파일', () => {
  it('골든은 488바이트이고 parse 가 성공한다', () => {
    const buf = golden();
    expect(buf.byteLength).toBe(FILE_SIZE);
    expect(reasonOf(buf)).toBe('ok');
  });

  // 죽이는 변이: 메타 필드 누락·이름 오타, origin 을 float32 로 줄이기(4180045.1626 -> 4180045.25)
  it('메타가 골든 표본의 정의와 같다', () => {
    const { meta } = parseOk(golden());
    expect(meta).toEqual({
      schema_version: 1,
      n_points: 12,
      units: 'm',
      origin_m: [254012.8371, 4180045.1626, 31.6052], // origin_abs + MN
      extent_m: [4.0, 2.5, 0.3125],
      deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
      sample_cell_m: 0.0125,
      // 편차 있는 점의 범위. z 최댓값은 6번 점(qz 23456)이다. qz 65535 인 7번 점은 센티널이라 빠진다
      fit_bounds: { min: [0, 0, 0], max: [4.0, 2.5, (23456 * 0.3125) / 65535] },
      sampling: { method: 'cell min-hash stratified', source_points: 12345, cap: 500000 },
      order: 'hash',
    });
  });

  // 죽이는 변이: 본문 오프셋에서 json_len 누락(8 부터 읽으면 JSON 글자가 좌표로 읽힌다),
  //             dev 시작을 6n 이 아니라 3n 으로, xyz 를 Int16 으로(65535 -> -1), dev 를 Uint16 으로(-105 -> 65431)
  it('xyz 와 dev 가 표의 값 그대로다', () => {
    const data = parseOk(golden());
    expect(Array.from(data.xyz)).toEqual(Q.flat());
    expect(Array.from(data.dev)).toEqual(DEV);
  });

  // 죽이는 변이: 버퍼를 복사해 뷰를 만든다(50만 점에서 4MB 사본), 오프셋 계산 오류
  it('뷰는 받은 버퍼를 복사 없이 가리킨다', () => {
    const buf = golden();
    const data = parseOk(buf);
    expect(data.xyz.buffer).toBe(buf);
    expect(data.dev.buffer).toBe(buf);
    expect(data.xyz.byteOffset).toBe(8 + JSON_LEN);             // 392
    expect(data.xyz.length).toBe(36);
    expect(data.dev.byteOffset).toBe(8 + JSON_LEN + 6 * 12);    // 464
    expect(data.dev.length).toBe(12);
  });

  it('모르는 메타 키는 무시하고, 키 순서에 기대지 않는다', () => {
    expect(reasonOf(withMeta((m) => { m.future_key = { a: 1 }; }))).toBe('ok');
    const reversed = withMeta((m) => {
      const entries = Object.entries(m).reverse();
      for (const k of Object.keys(m)) delete m[k];
      for (const [k, v] of entries) m[k] = v;
    });
    const data = parseOk(reversed);
    expect(data.meta.n_points).toBe(12);
    expect(Array.from(data.dev)).toEqual(DEV);
  });
});

describe('localOf / absoluteOf: 좌표 복원 (§5.5)', () => {
  // 죽이는 변이: y·z 전치(범위가 축마다 달라 값이 달라진다), 65535 대신 65536 으로 나누기
  it('localOf 는 q * extent_m / 65535 다(전 점, 전 축)', () => {
    const data = parseOk(golden());
    for (let i = 0; i < 12; i++) {
      const got = localOf(data, i);
      for (let a = 0; a < 3; a++) {
        expect(Math.abs(got[a] - (Q[i][a] * EXT[a]) / 65535)).toBeLessThan(1e-12);
      }
    }
  });

  // 손 계산: 32768*4/65535 = 2 + 2/65535, 16384*2.5/65535 = 0.625 + 0.625/65535,
  //          8192*0.3125/65535 = 0.0390625 + 0.0390625/65535
  it('3번 점 (32768, 16384, 8192) 의 로컬 좌표', () => {
    const [x, y, z] = localOf(parseOk(golden()), 3);
    expect(x).toBeCloseTo(2.0000305180, 9);
    expect(y).toBeCloseTo(0.6250095369, 9);
    expect(z).toBeCloseTo(0.0390630961, 9);
  });

  it('양 끝값: q = 0 은 0, q = 65535 는 축 범위 그대로', () => {
    const data = parseOk(golden());
    expect(localOf(data, 0)).toEqual([0, 0, 0]);
    const p1 = localOf(data, 1);
    expect(p1[0]).toBe(4.0);
    expect(p1[1]).toBe(2.5);
    expect(localOf(data, 7)[2]).toBe(0.3125);
  });

  // 죽이는 변이: origin 을 float32 로 다루기(y 축 4180045.1626 은 float32 에서 0.25 단위로 뭉개진다),
  //             origin_m 을 더하지 않기, y·z 전치
  it('absoluteOf 는 origin_abs + MN + local 이고 1e-6 m 이내다(전 점, 전 축)', () => {
    const data = parseOk(golden());
    for (let i = 0; i < 12; i++) {
      const got = absoluteOf(data, i);
      for (let a = 0; a < 3; a++) {
        const want = ORIGIN_ABS[a] + MN[a] + (Q[i][a] * EXT[a]) / 65535;
        expect(Math.abs(got[a] - want)).toBeLessThan(1e-6);
      }
    }
  });

  // 손 계산: x = 254012.3371 + 0.5 + 4.0, y = 4180044.9126 + 0.25 + 2.5, z = 31.4802 + 0.125 + 1280/65535
  it('1번 점 (65535, 65535, 4096) 의 절대 좌표', () => {
    const [x, y, z] = absoluteOf(parseOk(golden()), 1);
    expect(Math.abs(x - 254016.8371)).toBeLessThan(1e-6);
    expect(Math.abs(y - 4180047.6626)).toBeLessThan(1e-6);
    expect(Math.abs(z - 31.6247315)).toBeLessThan(1e-6);
  });
});

describe('parsePoints3d: 실패 사유 8종 (§5.6 리더 규칙)', () => {
  it('1. too_short: 8바이트 미만', () => {
    expect(reasonOf(new ArrayBuffer(0))).toBe('too_short');
    expect(reasonOf(golden().slice(0, 7))).toBe('too_short');
  });

  it('2. bad_magic: 앞 4바이트가 FP3D 가 아니다(한 글자만 달라도, 소문자여도)', () => {
    for (const idx of [0, 1, 2, 3]) {
      const b = goldenBytes();
      b[idx] ^= 0x20; // 대소문자 비트를 뒤집는다(F -> f, 3 -> 0x13)
      expect(reasonOf(b.buffer)).toBe('bad_magic');
    }
  });

  it('3. bad_header: 8 + json_len 이 파일보다 크다(RangeError 를 던지지 않는다)', () => {
    const b = goldenBytes();
    new DataView(b.buffer).setUint32(4, 0xfffffff8, true);
    expect(reasonOf(b.buffer)).toBe('bad_header');
    const c = goldenBytes();
    new DataView(c.buffer).setUint32(4, FILE_SIZE - 8 + 4, true); // 파일 끝을 4바이트 넘긴다(4의 배수는 유지)
    expect(reasonOf(c.buffer)).toBe('bad_header');
  });

  it('3. bad_header: 8 + json_len 이 4의 배수가 아니다', () => {
    const b = goldenBytes();
    new DataView(b.buffer).setUint32(4, JSON_LEN - 1, true); // 383: 파일 안이지만 391 은 4의 배수가 아니다
    expect(reasonOf(b.buffer)).toBe('bad_header');
  });

  it('4. bad_json: JSON 이 깨졌다', () => {
    const b = goldenBytes();
    b[8] = 0x78; // 여는 중괄호를 x 로
    expect(reasonOf(b.buffer)).toBe('bad_json');
  });

  it('4. bad_json: UTF-8 이 아니다', () => {
    const b = goldenBytes();
    const at = 8 + JSON_LEN - 2 - 3; // 패딩 2바이트 앞의 `h"}` 에서 h (order 값의 마지막 글자)
    expect(String.fromCharCode(b[at])).toBe('h');
    b[at] = 0xff;
    expect(reasonOf(b.buffer)).toBe('bad_json');
  });

  it.each([['배열', '[1,2,3]'], ['숫자', '12'], ['null', 'null'], ['문자열', '"FP3D"']])(
    '4. bad_json: 결과가 객체가 아니다 (%s)',
    (_name, json) => {
      expect(reasonOf(withRawMeta(json))).toBe('bad_json');
    },
  );

  it.each<[string, (m: Json) => void]>([
    ['2', (m) => { m.schema_version = 2; }],
    ['0', (m) => { m.schema_version = 0; }],
    ['문자열 "1"', (m) => { m.schema_version = '1'; }],
    ['키 없음', (m) => { delete m.schema_version; }],
  ])('5. unsupported_version: schema_version 이 %s', (_name, edit) => {
    expect(reasonOf(withMeta(edit))).toBe('unsupported_version');
  });

  // 한 번에 필드 하나만 망가뜨린다. 가드 하나를 지우면 그 행만 죽는다(가드마다 하중이 있다)
  it.each<[string, (m: Json) => void]>([
    ['n_points 0', (m) => { m.n_points = 0; }],
    ['n_points 음수', (m) => { m.n_points = -12; }],
    ['n_points 소수', (m) => { m.n_points = 12.5; }],
    ['n_points 문자열', (m) => { m.n_points = '12'; }],
    ['n_points 없음', (m) => { delete m.n_points; }],
    ['units mm', (m) => { m.units = 'mm'; }],
    ['origin_m 2개', (m) => { m.origin_m = [1, 2]; }],
    ['origin_m 에 null', (m) => { m.origin_m = [1, null, 3]; }],
    ['origin_m 에 문자열', (m) => { m.origin_m = [1, '2', 3]; }],
    ['origin_m 없음', (m) => { delete m.origin_m; }],
    ['extent_m 4개', (m) => { m.extent_m = [4, 2.5, 0.3125, 1]; }],
    ['extent_m 음수', (m) => { m.extent_m = [4, -2.5, 0.3125]; }],
    ['extent_m 배열 아님', (m) => { m.extent_m = 4; }],
    ['deviation 없음', (m) => { delete m.deviation; }],
    ['deviation.unit_mm 1', (m) => { m.deviation = { unit_mm: 1, not_floor: -32768, no_deviation: -32767 }; }],
    ['deviation.not_floor 다름', (m) => { m.deviation = { unit_mm: 0.1, not_floor: -32767, no_deviation: -32767 }; }],
    ['deviation.no_deviation 다름', (m) => { m.deviation = { unit_mm: 0.1, not_floor: -32768, no_deviation: -32768 }; }],
    ['sample_cell_m 0', (m) => { m.sample_cell_m = 0; }],
    ['sample_cell_m 음수', (m) => { m.sample_cell_m = -0.0125; }],
    ['sample_cell_m 문자열', (m) => { m.sample_cell_m = '0.0125'; }],
    ['fit_bounds 없음', (m) => { delete m.fit_bounds; }],
    ['fit_bounds.min 2개', (m) => { m.fit_bounds = { min: [0, 0], max: [4, 2.5, 0.1] }; }],
    ['fit_bounds.max 없음', (m) => { m.fit_bounds = { min: [0, 0, 0] }; }],
    ['fit_bounds x 축 min > max', (m) => { m.fit_bounds = { min: [5, 0, 0], max: [4, 2.5, 0.1] }; }],
    ['fit_bounds z 축 min > max', (m) => { m.fit_bounds = { min: [0, 0, 0.2], max: [4, 2.5, 0.1] }; }],
    ['order 다름', (m) => { m.order = 'cell'; }],
    ['order 없음', (m) => { delete m.order; }],
  ])('6. bad_meta: %s', (_name, edit) => {
    expect(reasonOf(withMeta(edit))).toBe('bad_meta');
  });

  it('6. 경계: 범위 0 인 축(extent_m 0, fit min == max)은 유효하다', () => {
    const buf = withMeta((m) => {
      m.extent_m = [4, 2.5, 0];
      m.fit_bounds = { min: [0, 0, 0], max: [4, 2.5, 0] };
    });
    expect(reasonOf(buf)).toBe('ok');
  });

  // 죽이는 변이: size_mismatch 검사 제거(남는 바이트는 조용히 통과하고, 모자라면 TypedArray 생성이 예외를 던진다)
  it('7. size_mismatch: 본문이 남거나 모자라다', () => {
    const src = goldenBytes();
    const longer = new Uint8Array(FILE_SIZE + 8);
    longer.set(src);
    expect(reasonOf(longer.buffer)).toBe('size_mismatch');
    expect(reasonOf(golden().slice(0, FILE_SIZE - 2))).toBe('size_mismatch');
    expect(reasonOf(golden().slice(0, 8 + JSON_LEN))).toBe('size_mismatch');
  });

  it('7. size_mismatch: n_points 가 본문 길이와 맞지 않는다', () => {
    expect(reasonOf(withMeta((m) => { m.n_points = 11; }))).toBe('size_mismatch');
    expect(reasonOf(withMeta((m) => { m.n_points = 13; }))).toBe('size_mismatch');
  });

  // 호스트의 성질이라 버퍼 변조로는 만들 수 없다. 둘째 인자로 주입한다
  it('8. big_endian_host: 정상 버퍼라도 호스트가 big-endian 이면 거부한다', () => {
    expect(reasonOf(golden(), false)).toBe('big_endian_host');
    expect(reasonOf(golden(), true)).toBe('ok');
  });

  it('isLittleEndianHost: 테스트 호스트(x86·ARM)는 little-endian 이고 둘째 인자의 기본값이 이 값이다', () => {
    expect(isLittleEndianHost()).toBe(true);
    expect(reasonOf(golden())).toBe('ok');
  });

  // 표의 위에서부터 검사하고 처음 어긴 항목의 사유로 실패한다
  it('검사 순서: 두 항목을 함께 어기면 앞 항목의 사유다', () => {
    // 1 < 2: 7바이트이고 magic 도 틀림
    expect(reasonOf(new Uint8Array(7).buffer)).toBe('too_short');
    // 2 < 3: magic 이 틀리고 json_len 도 파일보다 큼
    const a = goldenBytes();
    a[0] = 0x58;
    new DataView(a.buffer).setUint32(4, 0xfffffff8, true);
    expect(reasonOf(a.buffer)).toBe('bad_magic');
    // 3 < 4: json_len 이 4의 배수가 아니고 JSON 도 깨짐
    const b = goldenBytes();
    b[8] = 0x78;
    new DataView(b.buffer).setUint32(4, JSON_LEN - 1, true);
    expect(reasonOf(b.buffer)).toBe('bad_header');
    // 5 < 6: 버전이 다르고 메타도 틀림
    expect(reasonOf(withMeta((m) => { m.schema_version = 2; m.units = 'mm'; }))).toBe('unsupported_version');
    // 6 < 7: 메타가 틀리고 크기도 안 맞음(n_points 0 이면 본문 96바이트가 남는다)
    expect(reasonOf(withMeta((m) => { m.n_points = 0; }))).toBe('bad_meta');
    // 7 < 8: 크기가 안 맞고 호스트도 big-endian
    expect(reasonOf(golden().slice(0, FILE_SIZE - 2), false)).toBe('size_mismatch');
    // 1 < 8
    expect(reasonOf(new ArrayBuffer(3), false)).toBe('too_short');
  });
});

describe('classifyDev: 0.1mm 정수 비교 (§7.4 분류 표)', () => {
  // 죽이는 변이: > 를 >= 로(70 이 PROTRUSION 이 된다), < 를 <= 로(-70 이 DEPRESSION 이 된다),
  //             센티널 가드 제거(두 센티널이 DEPRESSION 이 된다), 센티널 비교를 < 로(-32767 이 DEPRESSION)
  it.each<[number, number, PointClass]>([
    [70, 70, 'flat'],
    [71, 70, 'protrusion'],
    [-70, 70, 'flat'],
    [-71, 70, 'depression'],
    [0, 70, 'flat'],
    [0, 10, 'flat'],
    [-32768, 70, 'none'],
    [-32767, 70, 'none'],
    [-32768, 300, 'none'],
    [-32767, 10, 'none'],
    [-32766, 70, 'depression'],  // 유효 편차의 최솟값(DEV_MIN)은 센티널이 아니다
    [32767, 300, 'protrusion'],
    [32, 30, 'protrusion'],      // 같은 점이 임계값에 따라 달라진다
    [32, 35, 'flat'],
    [-105, 100, 'depression'],
    [-105, 105, 'flat'],
  ])('classifyDev(%i, %i) = %s', (d, t, want) => {
    expect(classifyDev(d, t)).toBe(want);
  });

  it('골든의 점별 분류(T_q = 70)와 분류 수: flat 5 / depression 3 / protrusion 2 / none 2', () => {
    const data = parseOk(golden());
    const classes = Array.from(data.dev, (d) => classifyDev(d, 70));
    // dev: 0, 32, -105, 70, 71, -70, -71, -32768, -32767, 32767, -32766, 1
    expect(classes).toEqual([
      'flat', 'flat', 'depression', 'flat', 'protrusion', 'flat', 'depression',
      'none', 'none', 'protrusion', 'depression', 'flat',
    ]);
    const count = { flat: 0, depression: 0, protrusion: 0, none: 0 };
    for (const c of classes) count[c] += 1;
    expect(count).toEqual({ flat: 5, depression: 3, protrusion: 2, none: 2 });
  });
});

describe('fmtThresholdMm: 0.1mm 정수 -> mm 표기', () => {
  it.each<[number, string]>([
    [70, '7'], [75, '7.5'], [63, '6.3'], [10, '1'], [15, '1.5'], [100, '10'], [105, '10.5'], [300, '30'],
  ])('%i -> %s', (q, want) => {
    expect(fmtThresholdMm(q)).toBe(want);
  });
});

describe('readoutLines: 읽기 창의 줄 (§7.9)', () => {
  const MINUS = '\u2212'; // 음수 부호. ASCII 하이픈(U+002D)이 아니다

  // 손 계산: 1번 점 q = (65535, 65535, 4096), dev = 32
  //   X = 254012.8371 + 4.0 = 254016.8371, Y = 4180045.1626 + 2.5 = 4180047.6626,
  //   Z = 31.6052 + 1280/65535 = 31.6247...
  // 죽이는 변이: 소수 자릿수, origin 을 float32 로(Y 가 4180047.750 이 된다), y·z 전치
  it('편차 있는 점은 5줄: 절대 좌표 소수 3자리, 편차 부호와 소수 1자리, 분류 이름', () => {
    const data = parseOk(golden());
    expect(readoutLines(data, 1, 70)).toEqual([
      'X 254016.837 m',
      'Y 4180047.663 m',
      'Z 31.625 m',
      '편차 +3.2 mm',
      'FLAT',
    ]);
  });

  it('분류 이름은 넘겨준 임계값을 따른다(같은 점, 임계값 3mm 에서는 PROTRUSION)', () => {
    const data = parseOk(golden());
    expect(readoutLines(data, 1, 30)[4]).toBe('PROTRUSION');
    expect(readoutLines(data, 1, 30).slice(0, 4)).toEqual(readoutLines(data, 1, 70).slice(0, 4));
  });

  // 손 계산: 2번 점 q = (258, 772, 1286), dev = -105
  //   X = 254012.8371 + 1032/65535 = 254012.8528..., Y = 4180045.1626 + 1930/65535 = 4180045.1920...,
  //   Z = 31.6052 + 401.875/65535 = 31.6113...
  // 죽이는 변이: 음수 부호를 ASCII 하이픈으로
  it('음수 편차는 U+2212 로 적는다', () => {
    const lines = readoutLines(parseOk(golden()), 2, 70);
    expect(lines).toEqual([
      'X 254012.853 m',
      'Y 4180045.192 m',
      'Z 31.611 m',
      `편차 ${MINUS}10.5 mm`,
      'DEPRESSION',
    ]);
    expect(lines.join('\n')).not.toContain('-');
  });

  // 죽이는 변이: 0 을 +0.0 으로
  it('편차 0 은 부호 없이 0.0', () => {
    const lines = readoutLines(parseOk(golden()), 0, 70);
    expect(lines).toEqual(['X 254012.837 m', 'Y 4180045.163 m', 'Z 31.605 m', '편차 0.0 mm', 'FLAT']);
  });

  // dev 정수에서 직접 만든 문자열이다. 3번 70, 4번 71, 5번 -70, 6번 -71, 9번 32767, 10번 -32766, 11번 1
  it.each<[number, string, string]>([
    [3, '편차 +7.0 mm', 'FLAT'],
    [4, '편차 +7.1 mm', 'PROTRUSION'],
    [5, `편차 ${MINUS}7.0 mm`, 'FLAT'],
    [6, `편차 ${MINUS}7.1 mm`, 'DEPRESSION'],
    [9, '편차 +3276.7 mm', 'PROTRUSION'],
    [10, `편차 ${MINUS}3276.6 mm`, 'DEPRESSION'],
    [11, '편차 +0.1 mm', 'FLAT'],
  ])('골든 %i번 점: %s / %s', (i, devLine, cls) => {
    const lines = readoutLines(parseOk(golden()), i, 70);
    expect(lines).toHaveLength(5);
    expect(lines[3]).toBe(devLine);
    expect(lines[4]).toBe(cls);
  });

  // 죽이는 변이: 부호를 정수부에서 얻기(절댓값 1mm 미만이면 정수부가 0 이라 부호가 사라진다)
  it.each<[number, string]>([
    [-5, `편차 ${MINUS}0.5 mm`], [5, '편차 +0.5 mm'], [-9, `편차 ${MINUS}0.9 mm`], [-10, `편차 ${MINUS}1.0 mm`],
    [1000, '편차 +100.0 mm'],
  ])('dev %i -> %s', (dev, want) => {
    expect(readoutLines(onePoint([0, 0, 0], dev), 0, 70)[3]).toBe(want);
  });

  // 손 계산: 7번 점 q = (100, 200, 65535): X = 254012.8371 + 400/65535 = 254012.8432...,
  //   Y = 4180045.1626 + 500/65535 = 4180045.1702..., Z = 31.6052 + 0.3125 = 31.9177
  // 8번 점 q = (50000, 60000, 300): X = 254012.8371 + 200000/65535 = 254015.8889...,
  //   Y = 4180045.1626 + 150000/65535 = 4180047.4514..., Z = 31.6052 + 93.75/65535 = 31.6066...
  // 죽이는 변이: 센티널을 DEPRESSION 으로 분류(5줄이 되고 "편차 −3276.8 mm" 가 찍힌다)
  it('두 센티널은 각각 4줄이고 마지막 줄이 "편차 없음" 이다(둘을 구분하지 않는다)', () => {
    const data = parseOk(golden());
    expect(readoutLines(data, 7, 70)).toEqual([
      'X 254012.843 m', 'Y 4180045.170 m', 'Z 31.918 m', '편차 없음',
    ]);
    expect(readoutLines(data, 8, 70)).toEqual([
      'X 254015.889 m', 'Y 4180047.451 m', 'Z 31.607 m', '편차 없음',
    ]);
    expect(readoutLines(data, 7, 300)).toHaveLength(4);
  });

  // 스캐너 원점 좌표계에서는 절대 좌표가 음수다. 화면 문구의 음수 부호는 U+2212 다(§7.12)
  it('음수 좌표도 U+2212 로 적고, 반올림해 0 이 되는 음수는 부호 없이 0.000', () => {
    const lines = readoutLines(onePoint([-2.5, -0.0004, -1234.5678], 5), 0, 70);
    expect(lines.slice(0, 3)).toEqual([`X ${MINUS}2.500 m`, 'Y 0.000 m', `Z ${MINUS}1234.568 m`]);
    expect(lines.join('\n')).not.toContain('-');
  });
});

describe('색 표 (§7.6)', () => {
  it('테마는 dark 와 light 둘뿐이다', () => {
    expect(Object.keys(POINTS3D_THEME).sort()).toEqual(['dark', 'light']);
  });

  it('dark: 검정 배경(기본)', () => {
    expect(POINTS3D_THEME.dark).toEqual({
      background: '#000000',
      flat: '#4cc96f',
      depression: '#f5c33b',
      protrusion: '#f06464',
      none: '#4a4f57',
      line: '#ffffff',
      gridAlpha: 0.09,
      axisAlpha: 0.28,
      text: '#f2f4f7',
      textSecondary: '#9aa3ad',
      readoutBackground: '#000000',
      readoutAlpha: 0.8,
    });
  });

  it('light: 밝은 배경(전환 시)', () => {
    expect(POINTS3D_THEME.light).toEqual({
      background: '#ffffff',
      flat: '#1e9e50',
      depression: '#b88700',
      protrusion: '#d93636',
      none: '#b4bac2',
      line: '#000716',
      gridAlpha: 0.09,
      axisAlpha: 0.28,
      text: '#000716',
      textSecondary: '#5f6b7a',
      readoutBackground: '#ffffff',
      readoutAlpha: 0.9,
    });
  });

  // 죽이는 변이: 채널 순서 바꾸기(r·b 전치), 255 대신 256 으로 나누기
  it('hexToRgb01: #rrggbb -> 0~1 세 값', () => {
    expect(hexToRgb01('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb01('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb01('#4cc96f')).toEqual([76 / 255, 201 / 255, 111 / 255]);
    expect(hexToRgb01('#000716')).toEqual([0, 7 / 255, 22 / 255]);
    expect(hexToRgb01('#F06464')).toEqual([240 / 255, 100 / 255, 100 / 255]);
  });
});
```

기대값의 근거(전부 Interfaces의 표에서 손으로 계산했다):

| 기대값 | 계산 |
|---|---|
| 파일 488바이트, `xyz` 오프셋 392, `dev` 오프셋 464 | `8 + 384 + 8 × 12`, `8 + 384`, `392 + 6 × 12` |
| 메타 `origin_m` | `origin_abs + MN` = `[254012.3371 + 0.5, 4180044.9126 + 0.25, 31.4802 + 0.125]` |
| `fit_bounds.max` | 편차 있는 점(7·8번 제외)의 q 최댓값: x 65535(1번) → 4.0, y 65535(1번) → 2.5, z 23456(6번) → `23456 × 0.3125 / 65535` |
| 3번 점 로컬 좌표 | `32768 × 4 / 65535 = 2 + 2/65535 ≈ 2.0000305180`, `16384 × 2.5 / 65535 = 0.625 + 0.625/65535 ≈ 0.6250095369`, `8192 × 0.3125 / 65535 = 0.0390625 + 0.0390625/65535 ≈ 0.0390630961` |
| 1번 점 절대 좌표 | `254012.8371 + 4.0 = 254016.8371`, `4180045.1626 + 2.5 = 4180047.6626`, `31.6052 + 1280/65535 ≈ 31.6247315` |
| 분류 수(T_q = 70) | dev `0, 32, 70, -70, 1` → FLAT 5 / `-105, -71, -32766` → DEPRESSION 3 / `71, 32767` → PROTRUSION 2 / `-32768, -32767` → 없음 2 |
| 1번 점 읽기 창 | `254016.8371` → `254016.837`, `4180047.6626` → `4180047.663`, `31.6247` → `31.625`, dev 32 → `+3.2`, 32 <= 70 → `FLAT`(임계값 30이면 `PROTRUSION`) |
| 2번 점 읽기 창 | `254012.8371 + 1032/65535 = 254012.8528` → `254012.853`, `4180045.1626 + 1930/65535 = 4180045.1920` → `4180045.192`, `31.6052 + 401.875/65535 = 31.6113` → `31.611`, dev −105 → `−10.5` |
| 0번 점 읽기 창 | `origin_m` 그대로: `254012.837`, `4180045.163`, `31.605` |
| 7번 점 읽기 창 | `254012.8371 + 400/65535 = 254012.8432` → `254012.843`, `4180045.1626 + 500/65535 = 4180045.1702` → `4180045.170`, `31.6052 + 0.3125 = 31.9177` → `31.918` |
| 8번 점 읽기 창 | `254012.8371 + 200000/65535 = 254015.8889` → `254015.889`, `4180045.1626 + 150000/65535 = 4180047.4514` → `4180047.451`, `31.6052 + 93.75/65535 = 31.6066` → `31.607` |
| `hexToRgb01('#4cc96f')` | `0x4c = 76`, `0xc9 = 201`, `0x6f = 111` |

테스트 묶음별로 죽이는 변이(테스트 코드의 `// 죽이는 변이` 주석과 같다. 계획 작성 중 스크래치에서 51개 변이를 하나씩 넣어 전부 죽는 것을 확인했다):

| 테스트 | 죽이는 변이 |
|---|---|
| 상수: magic·schema version·센티널·단위 | 상수 값 변경(엔진 대조 테스트와 이중) |
| 상수: 슬라이더 범위·과장 배율 | 범위·단계·배율 값 변경 |
| 상수: 분류 이름 | 범례·읽기 창 문구 변경 |
| 골든: 488바이트·parse 성공 | `instanceof ArrayBuffer` 가드 추가, `json_len`을 big-endian으로 읽기 |
| 골든: 메타 | 메타 필드 누락, `origin_m`을 float32로 줄이기 |
| 골든: xyz·dev 값 | 본문 오프셋에서 `json_len` 누락, dev 시작 오프셋 오류, xyz를 Int16으로 |
| 골든: 뷰는 복사 없이 | 버퍼를 `slice`로 복사해 뷰 만들기 |
| 골든: 모르는 키·키 순서 | 키 화이트리스트로 거부, 키 순서 의존 |
| `localOf` 전 점·3번 점·양 끝값 | y·z 전치(범위 또는 인덱스), 65535 대신 65536으로 나누기 |
| `absoluteOf` 전 점·1번 점 | origin을 float32로, `origin_m`을 더하지 않기 |
| 1. too_short | 길이 검사 제거(DataView 생성이 예외를 던진다) |
| 2. bad_magic | 첫 글자만 비교, 대소문자 무시 |
| 3. bad_header 2건 | 파일 크기 검사 제거(TypedArray 생성이 RangeError), 4의 배수 검사 제거 |
| 4. bad_json 6건 | JSON 오류를 던지게 두기, `fatal: true` 제거, 배열·원시값 허용 |
| 5. unsupported_version 4건 | 버전 검사 제거, `==` 비교 |
| 6. bad_meta 27건 | 가드를 하나 지우면 해당 행만 죽는다(가드마다 하중) |
| 6. 경계: 범위 0 축 | `min <= max`를 `min < max`로(퇴화 축 거부) |
| 7. size_mismatch 2건 | 크기 검사 제거 |
| 8. big_endian_host·isLittleEndianHost | 엔디안 검사 제거, 둘째 인자 무시 |
| 검사 순서 | 5·6 교환, 7·8 교환 등 순서 변경 |
| `classifyDev` 경계 16행 | `>`를 `>=`로, `<`를 `<=`로, 센티널 가드 제거, 센티널 비교를 `<`로 |
| 골든 점별 분류·분류 수 | 위와 같다(센티널을 DEPRESSION으로 분류하면 5 / 5 / 2 / 0이 된다) |
| `fmtThresholdMm` 8행 | 정수로 반올림, 항상 소수 1자리 |
| `readoutLines` 5줄 | 좌표 자릿수, float32, y·z 전치 |
| `readoutLines` 임계값 | 임계값을 무시하고 고정값으로 분류 |
| `readoutLines` 음수 편차 | 음수 부호를 ASCII 하이픈으로 |
| `readoutLines` 편차 0 | 0을 `+0.0`으로 |
| `readoutLines` 골든 7행·`dev` 5행 | 0.1을 곱해 `toFixed`, 부호를 정수부에서 얻기(절댓값 1mm 미만에서 부호 소실) |
| `readoutLines` 두 센티널 | 센티널에도 편차 줄 표시, 두 센티널을 구분 |
| `readoutLines` 음수 좌표 | 좌표의 음수 부호 처리 제거 |
| 색 표 3건 | 색 값 변경, 테마 추가·삭제, 필드 추가·삭제 |
| `hexToRgb01` | r·b 전치, 256으로 나누기 |

- [ ] **Step 5: vitest 테스트가 실패하는지 확인**

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts
```

Expected: FAIL. `Error: Failed to resolve import "../points3d" from "lib/domain/__tests__/points3d.test.ts". Does the file exist?`, 요약 줄 `Test Files  1 failed (1)` / `Tests  no tests`.

- [ ] **Step 6: 구현 1/4: 상수·타입·`parsePoints3d`**

`dashboard/lib/domain/points3d.ts`를 아래 내용으로 만든다.

```ts
// 3D 점군 뷰어 도메인: points3d.bin 리더, 분류, 좌표 복원, 읽기 창 문자열, 색 표
// (스펙 docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md §5.5, §5.6, §7.2, §7.4, §7.6, §7.9)
//
// 판정 이중화 아님(리트머스): 이 파일은 판정 기준의 허용치·불확도 필드를 읽지 않는다. 임계값은 호출자가
// 0.1mm 정수로 넘겨주는 표시용 값이고, 점을 어느 색으로 칠할지만 정한다. 합격·불합격을 가르지 않는다.
// 이 모듈은 DOM·WebGL 을 건드리지 않고 lib/viz 를 import 하지 않는다.

// ---- 상수 ----
// 아래 다섯 개는 엔진과 같은 값이어야 한다. engine/tests/test_points3d.py 가 이 파일을 정규식으로 읽어
// 대조하므로 `export const 이름 = 값;` 꼴을 바꾸지 않는다.
export const POINTS3D_MAGIC = 'FP3D';
export const POINTS3D_SCHEMA_VERSION = 1;       // 엔진 outputs/points3d.py SCHEMA_VERSION
export const DEV_NOT_FLOOR = -32768;            // 엔진 core/pointsample.py. 바닥이 아닌 점
export const DEV_NO_DEVIATION = -32767;         // 바닥 구역 안이지만 잔차가 없는 점
export const DEV_UNIT_MM = 0.1;                 // dev 정수 1 = 0.1mm
export const THRESHOLD_Q_MIN = 10;              // 1mm
export const THRESHOLD_Q_MAX = 300;             // 30mm
export const THRESHOLD_Q_STEP = 5;              // 0.5mm
export const EXAGGERATIONS = [1, 10, 50, 100] as const;

/** 좌표 양자화의 최댓값(uint16). local = q * extent_m / Q_MAX */
const Q_MAX = 65535;

export type PointClass = 'flat' | 'depression' | 'protrusion' | 'none';

/** 범례와 읽기 창이 쓰는 분류 이름(§7.12). */
export const POINT_CLASS_LABEL: Record<PointClass, string> = {
  flat: 'FLAT', depression: 'DEPRESSION', protrusion: 'PROTRUSION', none: '편차 없음',
};

// ---- 파일 형식 ----
export interface Points3dMeta {
  schema_version: number;
  n_points: number;
  units: 'm';
  origin_m: [number, number, number];   // 절대 좌표(float64). 파일-로컬 원점의 위치
  extent_m: [number, number, number];   // 축별 범위(m). 0 이상
  deviation: { unit_mm: number; not_floor: number; no_deviation: number };
  sample_cell_m: number;                // 표본 칸 변(m). 점 크기의 근거
  fit_bounds: { min: [number, number, number]; max: [number, number, number] };  // 편차 있는 점의 파일-로컬 범위
  sampling: { method: string; source_points: number; cap: number };              // 정보용. 리더가 검사하지 않는다
  order: 'hash';
}

/** xyz(길이 3n, x·y·z 인터리브)와 dev(길이 n)는 받은 버퍼를 복사 없이 가리키는 뷰다. */
export interface Points3dData { meta: Points3dMeta; xyz: Uint16Array; dev: Int16Array; }

export type Points3dError = 'too_short' | 'bad_magic' | 'bad_header' | 'bad_json'
  | 'unsupported_version' | 'bad_meta' | 'size_mismatch' | 'big_endian_host';

export type Points3dParse = { ok: true; data: Points3dData } | { ok: false; reason: Points3dError };

/** TypedArray 는 호스트 바이트 순서로 읽는다. 파일은 little-endian 이라 호스트도 그래야 한다. */
export function isLittleEndianHost(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isTriple(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
}

/** §5.6 리더 규칙 6번. 표에 적힌 항목만 본다(모르는 키는 무시, sampling 은 검사 대상이 아니다). */
function isValidMeta(m: Record<string, unknown>): boolean {
  if (!isFiniteNumber(m.n_points) || !Number.isInteger(m.n_points) || m.n_points < 1) return false;
  if (m.units !== 'm') return false;
  if (!isTriple(m.origin_m)) return false;
  if (!isTriple(m.extent_m) || m.extent_m.some((e) => e < 0)) return false;
  const d = m.deviation;
  if (!isRecord(d) || d.unit_mm !== DEV_UNIT_MM || d.not_floor !== DEV_NOT_FLOOR
    || d.no_deviation !== DEV_NO_DEVIATION) return false;
  if (!isFiniteNumber(m.sample_cell_m) || m.sample_cell_m <= 0) return false;
  const f = m.fit_bounds;
  if (!isRecord(f) || !isTriple(f.min) || !isTriple(f.max)) return false;
  for (let a = 0; a < 3; a++) if (f.min[a] > f.max[a]) return false;
  if (m.order !== 'hash') return false;
  return true;
}

/**
 * points3d.bin 을 읽는다. §5.6 리더 규칙을 표의 순서대로 검사하고 처음 어긴 항목의 사유로 실패한다.
 *
 * 입력을 `instanceof ArrayBuffer` 로 검사하지 않는다. vitest jsdom 에서 readFileSync(...).buffer 는 전역
 * ArrayBuffer 의 인스턴스가 아니어서, 그렇게 짜면 브라우저에서는 통과하고 골든 테스트에서만 거부된다.
 * byteLength 와 DataView·TypedArray 생성만 쓴다.
 */
export function parsePoints3d(
  buf: ArrayBufferLike,
  hostIsLittleEndian: boolean = isLittleEndianHost(),
): Points3dParse {
  const fail = (reason: Points3dError): Points3dParse => ({ ok: false, reason });
  const size = buf.byteLength;

  // 1. 헤더 8바이트
  if (size < 8) return fail('too_short');
  const head = new DataView(buf, 0, 8);

  // 2. magic
  for (let i = 0; i < 4; i++) {
    if (head.getUint8(i) !== POINTS3D_MAGIC.charCodeAt(i)) return fail('bad_magic');
  }

  // 3. json_len (공백 패딩 포함). 본문 시작은 4의 배수다
  const jsonLen = head.getUint32(4, true);
  const bodyStart = 8 + jsonLen;
  if (bodyStart > size || bodyStart % 4 !== 0) return fail('bad_header');

  // 4. JSON 메타. 끝의 공백 패딩은 JSON.parse 가 무시한다
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buf, 8, jsonLen));
    parsed = JSON.parse(text);
  } catch {
    return fail('bad_json');
  }
  if (!isRecord(parsed)) return fail('bad_json');

  // 5. 버전
  if (parsed.schema_version !== POINTS3D_SCHEMA_VERSION) return fail('unsupported_version');

  // 6. 메타 형식
  if (!isValidMeta(parsed)) return fail('bad_meta');
  const meta = parsed as unknown as Points3dMeta;
  const n = meta.n_points;

  // 7. 전체 크기
  if (size !== bodyStart + 8 * n) return fail('size_mismatch');

  // 8. 호스트 바이트 순서(버퍼가 아니라 호스트의 성질)
  if (!hostIsLittleEndian) return fail('big_endian_host');

  // 뷰는 7번을 통과한 뒤에 만든다. 본문 시작이 4의 배수이고 6n 이 짝수라 정렬이 맞는다
  return {
    ok: true,
    data: {
      meta,
      xyz: new Uint16Array(buf, bodyStart, 3 * n),
      dev: new Int16Array(buf, bodyStart + 6 * n, n),
    },
  };
}
```

- [ ] **Step 7: 파서 테스트가 통과하는지 확인**

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts -t "parsePoints3d|상수"
```

Expected: PASS. `Tests  55 passed | 52 skipped (107)`.

`-t`를 빼고 돌리면 `Tests  52 failed | 55 passed (107)`이고, 실패는 전부 `TypeError: ... is not a function`(아직 만들지 않은 함수)이나 `POINTS3D_THEME`이 undefined라서 나는 오류다.

- [ ] **Step 8: 구현 2/4: `classifyDev`·`localOf`·`absoluteOf`**

`dashboard/lib/domain/points3d.ts`의 맨 끝에 빈 줄 하나를 두고 아래를 덧붙인다.

```ts
// ---- 분류와 좌표 복원 ----

/**
 * 점의 분류. 0.1mm 정수끼리 비교한다(§7.4 표). 셰이더가 같은 표를 쓴다.
 * 임계값과 같은 편차는 FLAT 이다(경계 포함). 두 센티널은 구분하지 않고 '편차 없음'이다.
 */
export function classifyDev(d: number, thresholdQ: number): PointClass {
  if (d <= DEV_NO_DEVIATION) return 'none';
  if (d > thresholdQ) return 'protrusion';
  if (d < -thresholdQ) return 'depression';
  return 'flat';
}

/** i번 점의 파일-로컬 좌표(m). local = q * extent_m / 65535 (§5.5) */
export function localOf(data: Points3dData, i: number): [number, number, number] {
  const { xyz, meta } = data;
  const e = meta.extent_m;
  return [
    (xyz[3 * i] * e[0]) / Q_MAX,
    (xyz[3 * i + 1] * e[1]) / Q_MAX,
    (xyz[3 * i + 2] * e[2]) / Q_MAX,
  ];
}

/**
 * i번 점의 절대 좌표(m) = origin_m + local. JS number(float64)로만 계산한다.
 * UTM 급 좌표(수백만 m)는 float32 에 담으면 0.25m 단위로 뭉개지므로 Float32Array·Math.fround 를 거치지 않는다.
 */
export function absoluteOf(data: Points3dData, i: number): [number, number, number] {
  const o = data.meta.origin_m;
  const l = localOf(data, i);
  return [o[0] + l[0], o[1] + l[1], o[2] + l[2]];
}
```

- [ ] **Step 9: 분류·복원 테스트가 통과하는지 확인**

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts -t "classifyDev|localOf"
```

Expected: PASS. `Tests  22 passed | 85 skipped (107)`.

- [ ] **Step 10: 구현 3/4: `readoutLines`·`fmtThresholdMm`**

같은 파일의 맨 끝에 빈 줄 하나를 두고 아래를 덧붙인다.

```ts
// ---- 화면 문자열 ----

/** 화면 문구의 음수 부호(U+2212). ASCII 하이픈을 쓰지 않는다(§7.12). */
const MINUS_SIGN = '\u2212';

/** 좌표(m)를 소수 3자리로. 음수 부호는 U+2212, 반올림해 0 이 되는 음수는 부호 없이 적는다. */
function fmtCoordM(v: number): string {
  const s = v.toFixed(3);
  if (!s.startsWith('-')) return s;
  return Number(s) === 0 ? s.slice(1) : MINUS_SIGN + s.slice(1);
}

/**
 * 편차(0.1mm 정수)를 mm 소수 1자리로. 양수 '+', 음수 U+2212, 0 은 부호 없이 '0.0'.
 * 정수에서 직접 만든다(32 -> '+3.2'). 0.1 을 곱한 뒤 반올림하는 연산이 없다.
 */
function fmtDevMm(d: number): string {
  const a = Math.abs(d);
  const body = `${Math.floor(a / 10)}.${a % 10}`;
  if (d > 0) return `+${body}`;
  if (d < 0) return MINUS_SIGN + body;
  return body;
}

/**
 * 읽기 창의 줄(§7.9). 편차 있는 점은 5줄(X, Y, Z, 편차, 분류 이름), 편차 없는 점은 4줄(X, Y, Z, '편차 없음').
 * X·Y·Z 는 절대 좌표이고 Z 는 과장하지 않은 실제 높이다. 컴포넌트는 이 줄을 그대로 그린다.
 */
export function readoutLines(data: Points3dData, i: number, thresholdQ: number): string[] {
  const [x, y, z] = absoluteOf(data, i);
  const lines = [`X ${fmtCoordM(x)} m`, `Y ${fmtCoordM(y)} m`, `Z ${fmtCoordM(z)} m`];
  const d = data.dev[i];
  const cls = classifyDev(d, thresholdQ);
  if (cls === 'none') return [...lines, POINT_CLASS_LABEL.none];
  return [...lines, `편차 ${fmtDevMm(d)} mm`, POINT_CLASS_LABEL[cls]];
}

/** 임계값(0.1mm 정수)의 mm 표기. 70 -> '7', 75 -> '7.5', 63 -> '6.3'. HUD·고지 문구·슬라이더가 쓴다. */
export function fmtThresholdMm(q: number): string {
  return q % 10 === 0 ? String(q / 10) : `${Math.floor(q / 10)}.${q % 10}`;
}
```

- [ ] **Step 11: 문자열 테스트가 통과하는지 확인**

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts -t "readoutLines|fmtThresholdMm"
```

Expected: PASS. `Tests  26 passed | 81 skipped (107)`.

- [ ] **Step 12: 구현 4/4: `POINTS3D_THEME`·`hexToRgb01`**

같은 파일의 맨 끝에 빈 줄 하나를 두고 아래를 덧붙인다.

```ts
// ---- 색 표 (§7.6) ----
// 뷰어 색의 유일한 출처다. 캔버스는 uniform 과 clearColor 로, DOM 오버레이는 인라인 style 로 이 hex 를 쓴다.
// Tailwind 색 클래스와 globals.css 토큰으로 옮기지 않는다(UI 크롬이 아니라 그림의 색이다).

export type ThemeName = 'dark' | 'light';

/** 색 표의 한 열. 색은 `#rrggbb` hex 문자열, 알파는 0~1. */
export interface Points3dTheme {
  background: string;
  flat: string;
  depression: string;
  protrusion: string;
  none: string;               // 편차 없는 점
  line: string;               // 격자선·축선·읽기 창 테두리의 색. 알파만 다르다
  gridAlpha: number;
  axisAlpha: number;          // 축선. 읽기 창 테두리도 이 값을 쓴다
  text: string;               // 범례 이름, HUD, 읽기 창 본문
  textSecondary: string;      // 축 눈금 숫자, 축 이름, 조작 안내
  readoutBackground: string;
  readoutAlpha: number;
}

export const POINTS3D_THEME: Record<ThemeName, Points3dTheme> = {
  // 검정 배경(기본)
  dark: {
    background: '#000000',
    flat: '#4cc96f',
    depression: '#f5c33b',
    protrusion: '#f06464',
    none: '#4a4f57',
    line: '#ffffff',
    gridAlpha: 0.09,
    axisAlpha: 0.28,
    text: '#f2f4f7',
    textSecondary: '#9aa3ad',
    readoutBackground: '#000000',
    readoutAlpha: 0.8,
  },
  // 밝은 배경(화면 캡처용 전환)
  light: {
    background: '#ffffff',
    flat: '#1e9e50',
    depression: '#b88700',
    protrusion: '#d93636',
    none: '#b4bac2',
    line: '#000716',
    gridAlpha: 0.09,
    axisAlpha: 0.28,
    text: '#000716',
    textSecondary: '#5f6b7a',
    readoutBackground: '#ffffff',
    readoutAlpha: 0.9,
  },
};

/** `#rrggbb` -> [r, g, b] (각 0~1). WebGL uniform 과 clearColor 에 넘길 때 쓴다. */
export function hexToRgb01(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
```

- [ ] **Step 13: 이 태스크의 테스트 전부와 팔레트 스윕·타입 검사 확인**

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts __tests__/palette-sweep.test.ts && npx tsc --noEmit
```

Expected: `Test Files  2 passed (2)`, `Tests  109 passed (109)`(points3d 107 + 팔레트 스윕 2). `tsc`는 출력 없이 끝난다(exit 0).

팔레트 스윕이 실패하면 새 파일 어딘가에 `색이름-숫자` 꼴 문자열이 들어간 것이다. 실패 메시지의 `파일:줄`을 고친다. `palette-sweep.test.ts`는 고치지 않는다.

- [ ] **Step 14: 엔진 대조 테스트가 통과하는지 확인**

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_points3d.py -q
```

Expected: PASS. 요약 줄 `84 passed`(Step 3에서 통과한 수 + 이 태스크의 `test_ts_constants_match_engine` 1건. Task 3 계획대로면 83 + 1). 실패 0건.

- [ ] **Step 15: 변이 확인 (커밋 전, 하나씩 넣고 되돌린다)**

코드가 맞는 것과 테스트가 회귀를 잡는 것은 다른 문제다. `dashboard/lib/domain/points3d.ts`에 아래 변이를 **하나씩** 넣고 `cd D:/Projects/Flatness/dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts`를 돌려 표의 테스트가 죽는지 본 뒤, 변이를 되돌린다. 실패 수는 계획 작성 중 스크래치에서 실측한 값이다.

| # | 변이 | 고칠 곳 | 죽어야 하는 테스트(실측 실패 수) |
|---|---|---|---|
| 1 | `d > thresholdQ`를 `d >= thresholdQ`로 | `classifyDev` | 3건: `classifyDev(70, 70) = flat`, 골든 점별 분류·분류 수, 골든 3번 점 `편차 +7.0 mm / FLAT` |
| 2 | `if (d <= DEV_NO_DEVIATION) return 'none';` 줄 삭제(센티널이 DEPRESSION이 된다) | `classifyDev` | 6건: `classifyDev`의 센티널 4행, 골든 점별 분류·분류 수, `두 센티널은 각각 4줄` |
| 3 | 반환부의 `bodyStart`를 `8`로(두 곳. 본문 오프셋에서 `json_len` 누락) | `parsePoints3d` 끝 | 20건: `xyz 와 dev 가 표의 값 그대로다`, 뷰 오프셋, 키 순서, `localOf`·`absoluteOf` 5건, 골든 분류 수, 읽기 창 11건 |
| 4 | `e[1]`과 `e[2]`를 서로 바꿈(y·z 전치) | `localOf` | 8건: `localOf` 3건, `absoluteOf` 2건, 읽기 창의 좌표 줄 3건 |
| 5 | `MINUS_SIGN`을 `'-'`로 | 화면 문자열 | 8건: `음수 편차는 U+2212 로 적는다`, 골든 5·6·10번 점, `dev -5`·`-9`·`-10`, 음수 좌표 |
| 6 | `fmtDevMm`의 `if (d > 0)`을 `if (d >= 0)`으로(0이 `+0.0`) | `fmtDevMm` | 1건: `편차 0 은 부호 없이 0.0` |
| 7 | `absoluteOf`의 `o[0]`·`o[1]`·`o[2]`를 `Math.fround(...)`로 감쌈(origin을 float32로) | `absoluteOf` | 6건: `absoluteOf` 2건, 읽기 창의 좌표 줄 4건 |
| 8 | `if (size !== bodyStart + 8 * n) return fail('size_mismatch');` 줄 삭제 | `parsePoints3d` | 3건: `7. size_mismatch` 2건, 검사 순서 |

엔진 대조 테스트의 변이도 하나 확인한다: `points3d.ts`의 `DEV_NO_DEVIATION = -32767`을 `-32766`으로 바꾸고 Step 14의 명령을 돌리면 `test_ts_constants_match_engine`이 죽는다. 되돌린다.

전부 되돌린 뒤 `git diff --stat`에 변이가 남지 않았는지 보고, Step 13의 명령을 다시 돌려 109건 통과를 확인한다.

- [ ] **Step 16: 금지 문자열 자가 점검과 전체 스위트**

```bash
cd D:/Projects/Flatness
grep -nE "pass_mm|rework_mm|u_mm|applied_criteria|발주처" dashboard/lib/domain/points3d.ts dashboard/lib/domain/__tests__/points3d.test.ts
node -e "for (const f of process.argv.slice(1)) require('fs').readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (l.includes('\u2014')) console.log(f + ':' + (i + 1) + ': ' + l); });" dashboard/lib/domain/points3d.ts dashboard/lib/domain/__tests__/points3d.test.ts
grep -n "instanceof ArrayBuffer" dashboard/lib/domain/points3d.ts
grep -n "lib/viz" dashboard/lib/domain/points3d.ts
cd D:/Projects/Flatness/dashboard && npx vitest run
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q
```

Expected:
- 첫째 grep과 둘째 명령(node로 U+2014 찾기)은 출력 없음(0건).
- `instanceof ArrayBuffer` grep은 주석 한 줄만 나온다("입력을 `instanceof ArrayBuffer` 로 검사하지 않는다"). 코드 줄이 나오면 안 된다.
- `lib/viz` grep은 주석 한 줄만 나온다("lib/viz 를 import 하지 않는다"). `import` 문이 나오면 안 된다.
- 대시보드 전체: 실패 0건. 테스트 파일 수는 이 태스크 전보다 1개, 테스트 수는 107건 많다.
- 엔진 전체: 실패 0건. 이 태스크 전보다 1건 많다.

- [ ] **Step 17: 커밋**

```bash
cd D:/Projects/Flatness
git add dashboard/lib/domain/points3d.ts dashboard/lib/domain/__tests__/points3d.test.ts engine/tests/test_points3d.py
git commit -m "$(cat <<'EOF'
feat(dashboard): points3d.bin 리더·분류·좌표 복원·읽기 창 문자열·색 표 (lib/domain/points3d.ts)

- parsePoints3d: 스펙 5.6 리더 규칙 8종을 표의 순서대로 검사하고, 받은 버퍼를 복사 없이 가리키는 뷰를 돌려준다
- classifyDev: 0.1mm 정수 비교(임계값과 같은 편차는 FLAT, 두 센티널은 편차 없음)
- localOf·absoluteOf: 파일-로컬 좌표와 float64 절대 좌표
- readoutLines·fmtThresholdMm: 읽기 창의 줄과 임계값 표기(음수 부호 U+2212, 정수에서 직접 만든다)
- POINTS3D_THEME·hexToRgb01: 뷰어 색의 유일한 출처(hex)
- 골든 파일(engine/tests/fixtures/points3d_golden.bin)을 vitest 가 읽어 엔진과 같은 값인지 확인한다
- 엔진 테스트가 TS 상수 5개(magic, schema version, 센티널 2종, 편차 단위)를 엔진 상수와 대조한다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

Expected: 커밋 1건, 파일 3개(`points3d.ts` 신규, `points3d.test.ts` 신규, `test_points3d.py` 수정).

**계획 작성 시 검증 기록** (2026-10-02 초안, 2026-10-03 재검증. 저장소 밖 스크래치 `.superpowers/plan-drafts/pointcloud-viewer/scratch-06/`에서 실행. 저장소의 추적 파일은 건드리지 않았다)

- 실행 방법: Task 1·3 산출물은 아직 저장소에 없으므로 스크래치에 뼈대 시그니처만 맞춘 최소 대역을 두었다. 엔진은 `flatness/core/pointsample.py`(상수 6개)와 `flatness/outputs/points3d.py`(`MAGIC`, `SCHEMA_VERSION`, `FILE_NAME`), 골든 `.bin`은 스펙 §5.4 식을 그대로 옮긴 탐침(`make_golden.py`)으로 만든 488바이트다(sha256 `b0c50d8a...`. Task 3 계획의 스크래치가 실제 `encode_points3d`로 만든 골든과 바이트 동일). 대시보드는 node_modules 를 복사·링크하지 않고 저장소의 vitest·tsc 를 빌려 썼다(`cd dashboard && npx vitest run --root <스크래치>/dashboard ...`, `npx tsc --noEmit -p <스크래치>/dashboard/tsconfig.json`).
- 이 문서의 코드 블록을 그대로 꺼내 조립한 사본(`roundtrip.py`)으로 돌렸다(스크래치 원본과 바이트 동일 확인): vitest `107 passed`(Step 13의 107). Step 5의 `Failed to resolve import "../points3d"` 메시지, Step 7·9·11의 부분 구현 상태 `55 passed | 52 skipped` / `22 passed | 85 skipped` / `26 passed | 81 skipped`, 부분 구현에서 `-t` 없이 돌린 `52 failed | 55 passed`는 전부 실측값이다. `tsc --noEmit` exit 0.
- 엔진 대조 테스트(Step 2 블록, `# noqa: E402` 포함)를 최소 대역 위에서 돌렸다: TS 파일이 있으면 통과, 없으면 `FileNotFoundError`로 1건 실패(Step 3의 사유), TS 의 `DEV_NO_DEVIATION`을 −32766 으로 바꾸면 죽고, `export const DEV_NOT_FLOOR: number = -32768;` 로 선언 형식을 바꾸면 "선언이 정확히 1개" 메시지로 죽는다. Step 3·14의 `83`·`84`는 Task 3 계획의 테스트 수(83)에서 온 값이고 실제 Task 3 산출물 위에서는 확인하지 못했다.
- 변이 51종(`mutate.mjs`)을 하나씩 넣어 전부 죽었다(살아남은 변이 0, 패턴 불일치 0). Step 15 표의 실패 수 8건(3·6·20·8·8·1·6·3)은 이 실측값이다.
- 팔레트 스윕 정규식(`dashboard/__tests__/palette-sweep.test.ts:14`)을 두 새 파일에 돌려 0건. `pass_mm`·`rework_mm`·`u_mm`·`applied_criteria`·`발주처`·U+2014 는 두 파일 모두 0건. `instanceof ArrayBuffer`와 `lib/viz`는 주석 한 줄씩만 있다.
- 확인하지 못한 것: 저장소에 커밋된 실제 Task 1·3 산출물 위에서의 실행(아직 없다). 대시보드 전체 스위트(`npx vitest run`)·`next build`·실제 `palette-sweep.test.ts` 실행은 스크래치에서 하지 않았다(정규식만 옮겨 확인). Step 16의 전체 스위트 수치는 구현 때 확인한다.

---
### Task 7: 대시보드 도메인 2: stats 접근·적재 상태·3D 탭 모드 결정

**목표:** stats에서 점 파일 이름과 기본 임계값을 읽는 함수, 적재 상태 헬퍼 `loadFor`, 스펙 §7.11 분기표를 옮긴 `resolvePreview3dMode`·`shouldProbe`·`shouldRequestLoad`가 표 12행과 우선순위까지 순수 함수로 검증된다.

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.3(분석 전환 시 캐시), §7.2(`lib/domain/points3d.ts` 인터페이스의 뒷부분), §7.3(적재 흐름과 `loadFor` 규칙), §7.11(분기표 12행), §8의 1번(브라우저는 두 키만 읽는다), §10.4(`points3d.test.ts` 행의 뒷부분), §10.5(대시보드 변이 3건), 부록 B의 6·9·10번.

**Files:**
- Modify: `dashboard/lib/domain/points3d.ts` (Task 6이 만든 파일. 줄 번호는 Task 6 구현에 따라 달라지므로 위치로 지정한다: 파일 머리의 첫 `export` 앞에 import 한 줄, 파일 맨 끝에 새 export. Task 6이 쓴 본문은 한 줄도 고치지 않는다. Task 6 계획(`task-06.md`)대로 구현했다면 이 파일은 285줄이고 `:1-6`이 머리 주석, `:7`이 빈 줄, `:8`이 `// ---- 상수 ----`, `:281-285`가 마지막 함수 `hexToRgb01`이다. import는 `:8` 자리에, 새 export는 `:285` 뒤에 들어간다)
- Modify: `dashboard/lib/domain/__tests__/points3d.test.ts` (Task 6이 만든 파일. 파일 머리의 마지막 import 문 바로 아래에 새 import 문, 파일 맨 끝에 새 describe 블록. Task 6의 테스트는 고치지 않는다. Task 6 계획대로면 577줄이고 import 문은 `:7-16`, 마지막 import 문은 `:16`의 `import type { PointClass, Points3dData, Points3dError } from '../points3d';`다)
- Test: `dashboard/lib/domain/__tests__/points3d.test.ts`
- 읽기만(고치지 않는다): `dashboard/lib/domain/types.ts:2`(`Surface = 'floor' | 'wall'`), `dashboard/lib/domain/types.ts:117-130`(`Stats`. Task 5가 `deviation_paths` 줄(`:126`) 다음의 `:127-128`에 `points3d_paths?: string[]`와 `points3d_threshold_q?: number`를 더해 둔 상태. Task 5 이전의 원본은 `:117-128`이다)

**Interfaces:**
- Consumes:
  - Task 5: `Stats.points3d_paths?: string[]`, `Stats.points3d_threshold_q?: number` (`import type { Stats, Surface } from './types'`)
  - Task 6: `Points3dData`(같은 파일의 `export interface Points3dData { meta: Points3dMeta; xyz: Uint16Array; dev: Int16Array; }`), `THRESHOLD_Q_MIN = 10`, `THRESHOLD_Q_MAX = 300`(같은 파일의 상수)
- Produces (전부 `dashboard/lib/domain/points3d.ts`의 export. Task 13·14가 이 이름과 시그니처로 쓴다):
  - `export function points3dFile(stats: Stats): string | null;` = `(stats.points3d_paths ?? [])[0] ?? null`
  - `export function defaultThresholdQ(stats: Stats): number | null;` - `points3d_threshold_q`가 정수(`Number.isInteger`)면 [10, 300]으로 clamp, 아니면 null
  - `export type Webgl2Support = 'hardware' | 'software' | 'unsupported';`
  - `export type Points3dLoad = { status: 'idle' } | { status: 'loading'; dir: string } | { status: 'ready'; dir: string; data: Points3dData } | { status: 'error'; dir: string; reason: 'fetch' | 'format' };`
  - `export function loadFor(load: Points3dLoad, dir: string | null): Points3dLoad;` - `load`가 idle이 아니고 `load.dir !== dir`이면 `{ status: 'idle' }`, 아니면 `load` 그대로(같은 객체)
  - `export type Preview3dMode = 'wall' | 'import' | 'no_data' | 'software_prompt' | 'loading' | 'viewer' | 'error_stats' | 'error_fetch' | 'error_format' | 'error_webgl' | 'error_context';`
  - `export interface Preview3dInput { surface: Surface; isImport: boolean; dir: string | null; file: string | null; thresholdQ: number | null; support: Webgl2Support | null; optedIn: boolean; load: Points3dLoad; rendererFailed: boolean; contextLost: boolean; }`
  - `export function resolvePreview3dMode(input: Preview3dInput): Preview3dMode;` (§7.11 표를 위에서부터 차례로 검사)
  - `export function shouldProbe(input: Preview3dInput): boolean;` (1~4행에 해당하지 않고 `support === null`)
  - `export function shouldRequestLoad(input: Preview3dInput): boolean;` (모드가 `'loading'`이고 `support !== null`이고 `loadFor(load, dir).status === 'idle'`)
  - export하지 않는 내부 함수 하나: `nonViewerMode(input)`(분기표 1~4행). 공개 인터페이스가 아니므로 다른 태스크는 쓰지 않는다

**이 태스크가 옮기는 표 (스펙 §7.11).** `resolvePreview3dMode`는 위에서부터 차례로 검사해 처음 맞는 행을 고른다. `L`은 `loadFor(load, dir)`이다.

| # | 조건 | 모드 |
|---|---|---|
| 1 | `surface === 'wall'` | `wall` |
| 2 | `isImport` | `import` |
| 3 | `dir === null` 또는 `file === null` | `no_data` |
| 4 | `thresholdQ === null` | `error_stats` |
| 5 | `support === null` | `loading` |
| 6 | `support === 'unsupported'` 또는 `rendererFailed` | `error_webgl` |
| 7 | `support === 'software'`이고 `!optedIn` | `software_prompt` |
| 8 | `L.status === 'error'`, `reason === 'fetch'` | `error_fetch` |
| 9 | `L.status === 'error'`, `reason === 'format'` | `error_format` |
| 10 | `contextLost` | `error_context` |
| 11 | `L.status`가 `'idle'` 또는 `'loading'` | `loading` |
| 12 | `L.status === 'ready'` | `viewer` |

**지킬 것 (함정).**
1. `points3dFile`과 `defaultThresholdQ`는 stats에서 `points3d_paths`와 `points3d_threshold_q` 두 키만 읽는다. 판정 기준 객체를 읽지 않는다. `dashboard/lib/domain/points3d.ts`에는 주석을 포함해 판정 기준 필드 이름 네 가지(Step 14의 grep 패턴에 적힌 문자열)가 한 번도 나오면 안 된다. Task 14의 소스 검사 테스트가 이 파일을 검사한다. 테스트 파일의 stats 픽스처에는 `Stats` 타입을 채우느라 그 필드가 들어가지만 테스트 파일은 검사 대상이 아니다.
2. 파일명 상수(`'points3d.bin'` 같은 리터럴)를 `points3d.ts`에 두지 않는다. 받을 이름은 stats가 준 값이다.
3. `Webgl2Support`와 `Points3dLoad`를 이 모듈에 두는 이유는 `lib/domain`이 `lib/viz`를 import하지 않게 하기 위해서다. `lib/viz/points3d/gl-renderer.ts`(Task 11)가 이 타입을 여기서 가져간다. 거꾸로 import하지 않는다.
4. 5행(`support === null` → `loading`)은 `load` 상태와 무관하다. 점 데이터가 `ready`여도 탐지가 끝나기 전에는 `viewer`가 아니다. 10행(`contextLost`)은 8·9행 뒤, 11행 앞이다.
5. `shouldRequestLoad`는 모드가 `loading`이어도 `support === null`(5행)이면 false다. 소프트웨어 렌더에서 "3D로 보기"를 누르기 전(7행)에도 false다.
6. `defaultThresholdQ`는 5의 배수로 맞추지 않는다(63은 63).
7. 새 주석·문자열에 U+2014를 쓰지 않고, `색이름-숫자` 꼴 표기도 쓰지 않는다(`dashboard/__tests__/palette-sweep.test.ts`가 `lib`의 모든 `.ts` 줄을 검사한다).
8. 이 태스크는 Next.js API를 쓰지 않는 순수 함수와 타입만 더한다. `dashboard/node_modules/next/dist/docs/`에서 확인할 가이드가 없다.

**테스트가 죽이는 변이.**

| 테스트(describe > 이름) | 죽이는 변이 |
|---|---|
| `points3dFile` > 키 없음·빈 목록 → null | 키 부재를 빈 문자열이나 기본 파일명으로 채움 |
| `points3dFile` > 목록의 첫 이름(`custom3d.bin`) | 파일명을 리터럴로 고정, 마지막 원소를 돌려줌 |
| `points3dFile` > 다른 `*_paths`를 대신 읽지 않는다 | `preview3d_paths`로 대체 |
| `defaultThresholdQ` > 9·5·0·−70 → 10, 301·999 → 300 | clamp 제거(하한만, 상한만 포함) |
| `defaultThresholdQ` > 63 → 63 | 슬라이더 눈금(5)의 배수로 맞춤 |
| `defaultThresholdQ` > 7.5·70.5·문자열·null·NaN·Infinity → null | 정수 검사를 반올림으로 바꿈, 타입 검사 제거 |
| `defaultThresholdQ` > 키가 없으면 null | 적용 기준의 허용치에서 임계값을 유도(§8 위반) |
| `defaultThresholdQ` > 키 60이면 60 | 키 대신 다른 필드를 읽음 |
| `loadFor` > dir이 다르면 idle, dir이 null이면 idle | `loadFor`의 dir 비교 제거, null일 때 비교를 건너뜀 |
| `loadFor` > dir이 같으면 같은 객체, idle은 그대로 | 항상 idle을 돌려줌, 매번 새 객체를 만듦 |
| `resolvePreview3dMode` > 1~12행(최소 입력) | 각 행의 제거·조건 누락(3행의 `dir`/`file` 한쪽, 6행의 `rendererFailed`), 8·9행의 reason 뒤바꿈, `error_stats`를 `error_format`과 합침 |
| `resolvePreview3dMode` > 5행: 탐지 전(load는 ready) | 분기표의 `support === null` 행 제거(탐지 전에 뷰어 마운트) |
| `resolvePreview3dMode` > 우선순위 23행 | 행 순서 바꾸기(1↔2, 4를 5 뒤로, 6↔7, 10을 8·9 앞으로, 10을 11·12 뒤로 등) |
| `resolvePreview3dMode` > 다른 분석의 ready·오류 상태 → loading | `resolvePreview3dMode` 안에서 `loadFor`를 거치지 않고 `load`를 그대로 읽음 |
| `shouldProbe`·`shouldRequestLoad` > 대조군 + 뷰어 대상이 아니면 false | 1~4행 가드 제거. 픽스처가 `support: null`(probe)과 `hardware` + idle(request)이라 가드가 없으면 true가 되어 죽는다 |
| `shouldRequestLoad` > 탐지 전에는 probe만 true | `support !== null` 조건 제거 |
| `shouldRequestLoad` > 소프트웨어 렌더는 선택 전에 요청하지 않는다 | 소프트웨어 렌더에서 선택 전에 fetch |
| `shouldRequestLoad` > loading·ready·error이면 false | idle 검사 제거(받는 중에 또 요청, 오류 뒤 자동 재요청) |
| `shouldRequestLoad` > 다른 분석의 상태가 남아 있으면 true | `loadFor`의 dir 비교 제거(분석 전환 뒤 새로 받지 않음) |

**기대값의 근거.** 전부 스펙에서 손으로 옮긴 값이다(구현 출력을 베끼지 않았다).
- `defaultThresholdQ`: 범위는 `THRESHOLD_Q_MIN = 10`(1mm), `THRESHOLD_Q_MAX = 300`(30mm). 9·5·0·−70은 하한 10으로, 301·999는 상한 300으로 간다. 70·60·100은 탑재 기준 7·6·10mm의 `int(round(허용치 × 10))`이다. 63은 범위 안의 정수라 그대로다(스펙: 슬라이더 초기값은 5의 배수로 맞추지 않는다). 7.5·70.5는 `Number.isInteger`가 false라 null이다.
- `resolvePreview3dMode`: 위 표의 행을 그대로 적었다. 우선순위 표의 기대값은 "함께 만족하는 행 중 번호가 작은 행의 모드"다.
- `shouldProbe`·`shouldRequestLoad`: Produces에 적은 정의를 입력마다 손으로 계산했다. 예: `support: 'software'`, `optedIn: false`, idle → 모드가 7행 `software_prompt`라 `loading`이 아니므로 false. `support: 'hardware'`, 다른 분석의 `ready` → `L`이 idle → 11행 `loading`, `support !== null`, `L.status === 'idle'` → true.

---

- [ ] **Step 1: 전제 확인 (Task 5·6의 산출물)**

Run:

```bash
cd D:/Projects/Flatness
grep -n "points3d_paths\|points3d_threshold_q" dashboard/lib/domain/types.ts
grep -n "^export const THRESHOLD_Q_MIN\|^export const THRESHOLD_Q_MAX\|^export interface Points3dData" dashboard/lib/domain/points3d.ts
grep -n "from 'vitest'" dashboard/lib/domain/__tests__/points3d.test.ts
cd dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts
```

Expected:
- 첫 grep: `points3d_paths?: string[];` 줄과 `points3d_threshold_q?: number;` 줄, 2줄.
- 둘째 grep: `export const THRESHOLD_Q_MIN = 10;`, `export const THRESHOLD_Q_MAX = 300;`, `export interface Points3dData ...` 3줄.
- 셋째 grep: `import { ... } from 'vitest';` 한 줄. 그 중괄호 안에 `describe`, `expect`, `it` 셋이 다 있어야 한다. 빠진 이름이 있으면 그 줄의 중괄호 안에 더한다(이 태스크의 테스트가 셋을 쓴다).
- vitest: Task 6의 테스트가 전부 통과. 출력의 `Tests  N passed`에서 N을 적어 둔다(Step 13에서 `N + 105`를 확인한다). Task 6 계획대로 구현했다면 N = 107이다.

하나라도 다르면 멈추고 Task 5·6이 끝났는지 확인한다.

- [ ] **Step 2: 실패하는 테스트 작성 (stats 접근과 `loadFor`)**

`dashboard/lib/domain/__tests__/points3d.test.ts`의 파일 머리, 마지막 import 문 바로 아래에 다음 두 줄을 더한다(같은 모듈을 한 번 더 import하는 것이다. 기존 import 줄은 고치지 않는다. Task 6 계획대로면 마지막 import 문은 `:16`의 `import type { PointClass, Points3dData, Points3dError } from '../points3d';`이고, 새 두 줄은 `:17-18`이 된다).

```ts
import { defaultThresholdQ, loadFor, points3dFile } from '../points3d';
import type { Points3dLoad } from '../points3d';
```

같은 파일의 맨 끝에 다음 블록을 붙인다.

```ts
// ---------------------------------------------------------------------------
// Task 7: stats 접근과 적재 상태 (스펙 §7.2, §7.3, §8)
// ---------------------------------------------------------------------------

// Stats 와 Points3dData 타입은 함수·타입 시그니처에서 꺼낸다.
// 이 파일의 기존 import 와 이름이 겹쳐 중복 선언이 되는 일을 피하기 위해서다.
type TabStats = Parameters<typeof points3dFile>[0];
type TabData = Extract<Points3dLoad, { status: 'ready' }>['data'];

const TAB_DIR = 'artifacts/an1';        // 지금 보는 분석의 artifacts_dir
const TAB_OTHER_DIR = 'artifacts/an2';  // 직전에 보던 다른 분석의 artifacts_dir

// 상태 결정 함수는 점 데이터의 내용을 보지 않는다. 타입만 맞춘 빈 데이터면 충분하다.
const TAB_DATA: TabData = {
  meta: {
    schema_version: 1, n_points: 0, units: 'm',
    origin_m: [0, 0, 0], extent_m: [0, 0, 0],
    deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
    sample_cell_m: 0.0125,
    fit_bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    sampling: { method: 'cell min-hash stratified', source_points: 0, cap: 500000 },
    order: 'hash',
  },
  xyz: new Uint16Array(0),
  dev: new Int16Array(0),
};

/** 평활도 stats 의 최소 픽스처. 적용 기준의 허용치는 7mm 로 고정해 둔다.
 *  표시 임계값 키가 없을 때 구현이 이 값에서 70 을 만들어 내면 아래 null 단언이 죽는다. */
function tabStats(extra: Record<string, unknown> = {}): TabStats {
  return {
    n_cells: 0, n_valid: 0,
    grade_counts: { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 },
    grade_pct: { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 },
    value_max_mm: null, value_min_mm: null, value_mean_mm: null, value_p95_mm: null,
    worst: null, coverage_pct: 0, reduced_span_cells: 0,
    applied_criteria: { name: 'x', source: 'y', span_m: 3, pass_mm: 7, rework_mm: 21, u_mm: 5 },
    warnings: [], zones: [], auto_summary: '',
    meta: { file: 'f', n_points: 0 },
    ...extra,
  } as TabStats;
}

describe('points3dFile (stats 가 준 점 파일 이름)', () => {
  it('키가 없으면 null', () => {
    expect(points3dFile(tabStats())).toBeNull();
  });

  it('빈 목록이면 null', () => {
    expect(points3dFile(tabStats({ points3d_paths: [] }))).toBeNull();
  });

  it('목록의 첫 이름을 그대로 돌려준다(파일명을 코드에 박지 않는다)', () => {
    expect(points3dFile(tabStats({ points3d_paths: ['points3d.bin'] }))).toBe('points3d.bin');
    expect(points3dFile(tabStats({ points3d_paths: ['custom3d.bin', 'other.bin'] }))).toBe('custom3d.bin');
  });

  it('다른 *_paths 키를 대신 읽지 않는다', () => {
    const stats = tabStats({ preview3d_paths: ['preview3d.png'], deviation_paths: ['deviation.png'] });
    expect(points3dFile(stats)).toBeNull();
  });
});

describe('defaultThresholdQ (엔진이 준 표시 임계값, 0.1mm 정수)', () => {
  it.each<[number, number]>([
    [70, 70], [60, 60], [100, 100],          // 탑재 기준 7·6·10mm 는 그대로
    [63, 63],                                // 5 의 배수로 맞추지 않는다
    [10, 10], [300, 300],                    // 범위의 양 끝은 그대로
    [9, 10], [5, 10], [0, 10], [-70, 10],    // 하한 10(1mm)
    [301, 300], [999, 300],                  // 상한 300(30mm)
  ])('points3d_threshold_q 가 %d 이면 %d', (q, expected) => {
    expect(defaultThresholdQ(tabStats({ points3d_threshold_q: q }))).toBe(expected);
  });

  it.each<[string, unknown]>([
    ['소수 7.5', 7.5],
    ['소수 70.5', 70.5],
    ['문자열 "70"', '70'],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('정수가 아니면 null: %s', (_label, q) => {
    expect(defaultThresholdQ(tabStats({ points3d_threshold_q: q }))).toBeNull();
  });

  it('키가 없으면 null 이다(적용 기준의 허용치 7mm 에서 70 을 만들어 내지 않는다)', () => {
    expect(defaultThresholdQ(tabStats())).toBeNull();
  });

  it('적용 기준과 값이 달라도 stats 의 표시 임계값을 그대로 쓴다', () => {
    // 픽스처의 허용치는 7mm(70)인데 키에는 60 을 줬다. 70 이 나오면 다른 필드를 읽은 것이다
    expect(defaultThresholdQ(tabStats({ points3d_threshold_q: 60 }))).toBe(60);
  });
});

describe('loadFor (지금 보는 분석의 적재 상태)', () => {
  const NOT_IDLE: [string, Points3dLoad][] = [
    ['loading', { status: 'loading', dir: TAB_DIR }],
    ['ready', { status: 'ready', dir: TAB_DIR, data: TAB_DATA }],
    ['error', { status: 'error', dir: TAB_DIR, reason: 'fetch' }],
  ];

  it.each(NOT_IDLE)('dir 이 같으면 %s 상태를 그대로(같은 객체) 돌려준다', (_status, load) => {
    expect(loadFor(load, TAB_DIR)).toBe(load);
  });

  it.each(NOT_IDLE)('dir 이 다르면 %s 상태를 idle 로 본다', (_status, load) => {
    expect(loadFor(load, TAB_OTHER_DIR)).toEqual({ status: 'idle' });
  });

  it.each(NOT_IDLE)('지금 분석의 dir 이 null 이면 %s 상태를 idle 로 본다', (_status, load) => {
    expect(loadFor(load, null)).toEqual({ status: 'idle' });
  });

  it('idle 은 dir 과 무관하게 그대로다', () => {
    const idle: Points3dLoad = { status: 'idle' };
    expect(loadFor(idle, TAB_DIR)).toBe(idle);
    expect(loadFor(idle, null)).toBe(idle);
  });

  it('입력 객체를 바꾸지 않는다', () => {
    const load: Points3dLoad = { status: 'ready', dir: TAB_DIR, data: TAB_DATA };
    loadFor(load, TAB_OTHER_DIR);
    expect(load).toEqual({ status: 'ready', dir: TAB_DIR, data: TAB_DATA });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts -t "points3dFile|defaultThresholdQ|loadFor"`

Expected: FAIL. 요약 줄이 `Tests  35 failed | N skipped`(N은 Step 1에서 적은 수). 오류는 `TypeError: points3dFile is not a function`, `TypeError: defaultThresholdQ is not a function`, `TypeError: loadFor is not a function` 세 종류뿐이다(아직 export가 없어서 import한 이름이 undefined다).

- [ ] **Step 4: 최소 구현 (stats 접근과 `loadFor`)**

`dashboard/lib/domain/points3d.ts`의 파일 머리에 다음 한 줄을 더한다. 위치는 파일 첫 줄부터 이어지는 머리 주석 블록(`//` 줄)이 끝난 뒤의 빈 줄 다음이고, 모든 `export`와 구획 주석(`// ---- 상수 ----` 같은 줄)보다 앞이다. 넣은 줄 아래에 빈 줄 하나를 둔다. 이미 import 문이 있으면 그 바로 아래에 넣는다(Task 6 계획대로면 이 파일에 import 문이 없다. `:1-6` 머리 주석, `:7` 빈 줄 다음인 `:8` 자리에 넣어, 넣은 뒤에는 `:8`이 import, `:9`가 빈 줄, `:10`이 `// ---- 상수 ----`가 된다).

```ts
import type { Stats } from './types';
```

같은 파일의 맨 끝에 다음을 붙인다. `THRESHOLD_Q_MIN`, `THRESHOLD_Q_MAX`, `Points3dData`는 같은 파일 위쪽에 Task 6이 정의해 둔 것을 그대로 쓴다(다시 선언하지 않는다).

```ts
// ---- stats 접근 (스펙 §7.2, §8) ----
// 브라우저가 stats 에서 읽는 것은 아래 두 키뿐이다. 판정 기준 객체는 읽지 않는다.

/** 받을 점 파일 이름. 키가 없거나 목록이 비면 null 이다.
 *  파일명 상수를 TS 에 두지 않는다. 엔진이 stats 에 적은 이름이 곧 fetch 할 이름이다. */
export function points3dFile(stats: Stats): string | null {
  return (stats.points3d_paths ?? [])[0] ?? null;
}

/** 뷰어의 기본 표시 임계값(0.1mm 정수). 정수가 아니면 null, 정수면 슬라이더 범위로 clamp 한다.
 *  슬라이더 눈금(5)의 배수로 맞추지 않는다. 63 은 63 그대로다. */
export function defaultThresholdQ(stats: Stats): number | null {
  const q: unknown = stats.points3d_threshold_q;
  if (typeof q !== 'number' || !Number.isInteger(q)) return null;
  return Math.min(THRESHOLD_Q_MAX, Math.max(THRESHOLD_Q_MIN, q));
}

// ---- 적재 상태 (스펙 §7.3) ----
// Webgl2Support 와 Points3dLoad 를 이 모듈에 두는 이유: lib/domain 이 lib/viz 를 import 하지 않게 한다.

export type Webgl2Support = 'hardware' | 'software' | 'unsupported';

export type Points3dLoad =
  | { status: 'idle' }
  | { status: 'loading'; dir: string }
  | { status: 'ready'; dir: string; data: Points3dData }
  | { status: 'error'; dir: string; reason: 'fetch' | 'format' };

/** 지금 보는 분석(dir)의 적재 상태. 다른 분석의 상태가 남아 있으면 idle 로 본다.
 *  분석을 바꿔도 상위 state 가 그대로 남으므로, 이 비교가 없으면 이전 분석의 점이 새 분석 화면에 나온다. */
export function loadFor(load: Points3dLoad, dir: string | null): Points3dLoad {
  if (load.status !== 'idle' && load.dir !== dir) return { status: 'idle' };
  return load;
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts -t "points3dFile|defaultThresholdQ|loadFor"`

Expected: PASS. `Tests  35 passed | N skipped`.

- [ ] **Step 6: 실패하는 테스트 작성 (`resolvePreview3dMode`)**

`dashboard/lib/domain/__tests__/points3d.test.ts`의 파일 머리, Step 2에서 더한 import 두 줄 바로 아래에 다음 두 줄을 더한다.

```ts
import { resolvePreview3dMode } from '../points3d';
import type { Preview3dInput, Preview3dMode } from '../points3d';
```

같은 파일의 맨 끝에 다음 블록을 붙인다. Step 2의 `TAB_DIR`, `TAB_OTHER_DIR`, `TAB_DATA`를 그대로 쓴다.

```ts
// ---------------------------------------------------------------------------
// Task 7: 3D 탭 모드 결정 (스펙 §7.11 분기표)
// ---------------------------------------------------------------------------

const TAB_IDLE: Points3dLoad = { status: 'idle' };
const TAB_LOADING: Points3dLoad = { status: 'loading', dir: TAB_DIR };
const TAB_READY: Points3dLoad = { status: 'ready', dir: TAB_DIR, data: TAB_DATA };
const TAB_FETCH_ERROR: Points3dLoad = { status: 'error', dir: TAB_DIR, reason: 'fetch' };
const TAB_FORMAT_ERROR: Points3dLoad = { status: 'error', dir: TAB_DIR, reason: 'format' };

/** 기준 입력: 뷰어 대상인 바닥 분석, 하드웨어 가속, 지금 분석의 점 데이터가 준비됨. 12행(viewer)이다.
 *  각 테스트는 여기에 그 행의 조건만 덮어쓴다. 기준이 viewer 이므로 모드가 달라지면 덮어쓴 조건 때문이다. */
function tabInput(over: Partial<Preview3dInput> = {}): Preview3dInput {
  return {
    surface: 'floor', isImport: false, dir: TAB_DIR, file: 'points3d.bin', thresholdQ: 70,
    support: 'hardware', optedIn: false, load: TAB_READY,
    rendererFailed: false, contextLost: false,
    ...over,
  };
}

type TabRow = [string, Partial<Preview3dInput>, Preview3dMode];

// 각 행의 조건만 만족하는 최소 입력(§7.11 표 12행. 조건이 '또는'인 행은 갈래마다 한 줄)
const TAB_ROWS: TabRow[] = [
  ['1행: 벽면 분석', { surface: 'wall' }, 'wall'],
  ['2행: 임포트 분석', { isImport: true }, 'import'],
  ['3행: dir 없음', { dir: null }, 'no_data'],
  ['3행: 점 파일 없음', { file: null }, 'no_data'],
  ['4행: 표시 임계값 없음', { thresholdQ: null }, 'error_stats'],
  ['5행: 탐지 전(load 는 ready)', { support: null }, 'loading'],
  ['6행: WebGL2 불가', { support: 'unsupported' }, 'error_webgl'],
  ['6행: 렌더러 생성 실패', { rendererFailed: true }, 'error_webgl'],
  ['7행: 소프트웨어 렌더, 선택 전(load 는 ready)', { support: 'software', optedIn: false }, 'software_prompt'],
  ['8행: fetch 오류', { load: TAB_FETCH_ERROR }, 'error_fetch'],
  ['9행: 형식 오류', { load: TAB_FORMAT_ERROR }, 'error_format'],
  ['10행: 컨텍스트 손실', { contextLost: true }, 'error_context'],
  ['11행: 적재 전(idle)', { load: TAB_IDLE }, 'loading'],
  ['11행: 받는 중(loading)', { load: TAB_LOADING }, 'loading'],
  ['12행: 하드웨어 + ready', {}, 'viewer'],
  ['12행: 소프트웨어 렌더 + 선택함 + ready', { support: 'software', optedIn: true }, 'viewer'],
  ['12행: 하드웨어는 optedIn 과 무관', { optedIn: true }, 'viewer'],
];

// 우선순위: 위 행의 조건과 아래 행의 조건을 함께 만족하면 위 행이 이긴다
const TAB_PRIORITY: TabRow[] = [
  ['1 > 2: 벽면이 임포트보다 먼저', { surface: 'wall', isImport: true }, 'wall'],
  ['1 > 3·4', { surface: 'wall', dir: null, file: null, thresholdQ: null }, 'wall'],
  ['2 > 3', { isImport: true, dir: null, file: null }, 'import'],
  ['2 > 4', { isImport: true, thresholdQ: null }, 'import'],
  ['3 > 4', { file: null, thresholdQ: null }, 'no_data'],
  ['3 > 5', { dir: null, support: null }, 'no_data'],
  ['4 > 5', { thresholdQ: null, support: null }, 'error_stats'],
  ['4 > 6', { thresholdQ: null, support: 'unsupported' }, 'error_stats'],
  ['4 > 9: 표시 임계값 없음은 형식 오류와 다른 모드', { thresholdQ: null, load: TAB_FORMAT_ERROR }, 'error_stats'],
  ['5 > 6', { support: null, rendererFailed: true }, 'loading'],
  ['5 > 8', { support: null, load: TAB_FETCH_ERROR }, 'loading'],
  ['5 > 10', { support: null, contextLost: true }, 'loading'],
  ['6 > 7: 렌더러 실패가 선택 안내보다 먼저', { support: 'software', optedIn: false, rendererFailed: true }, 'error_webgl'],
  ['6 > 8', { support: 'unsupported', load: TAB_FETCH_ERROR }, 'error_webgl'],
  ['6 > 10', { rendererFailed: true, contextLost: true }, 'error_webgl'],
  ['7 > 8', { support: 'software', optedIn: false, load: TAB_FETCH_ERROR }, 'software_prompt'],
  ['7 > 9', { support: 'software', optedIn: false, load: TAB_FORMAT_ERROR }, 'software_prompt'],
  ['7 > 10', { support: 'software', optedIn: false, contextLost: true }, 'software_prompt'],
  ['7 > 11', { support: 'software', optedIn: false, load: TAB_IDLE }, 'software_prompt'],
  ['8 > 10: fetch 오류가 컨텍스트 손실보다 먼저', { load: TAB_FETCH_ERROR, contextLost: true }, 'error_fetch'],
  ['9 > 10', { load: TAB_FORMAT_ERROR, contextLost: true }, 'error_format'],
  ['10 > 11(idle)', { contextLost: true, load: TAB_IDLE }, 'error_context'],
  ['10 > 11(loading)', { contextLost: true, load: TAB_LOADING }, 'error_context'],
];

describe('resolvePreview3dMode (§7.11 분기표)', () => {
  it.each(TAB_ROWS)('%s', (_label, over, expected) => {
    expect(resolvePreview3dMode(tabInput(over))).toBe(expected);
  });

  it('표의 입력이 11개 모드를 전부 지난다', () => {
    const seen = new Set(TAB_ROWS.map((row) => resolvePreview3dMode(tabInput(row[1]))));
    expect([...seen].sort()).toEqual([
      'error_context', 'error_fetch', 'error_format', 'error_stats', 'error_webgl',
      'import', 'loading', 'no_data', 'software_prompt', 'viewer', 'wall',
    ]);
  });

  it.each(TAB_PRIORITY)('우선순위 %s', (_label, over, expected) => {
    expect(resolvePreview3dMode(tabInput(over))).toBe(expected);
  });

  it.each<[string, Points3dLoad]>([
    ['ready', { status: 'ready', dir: TAB_OTHER_DIR, data: TAB_DATA }],
    ['fetch 오류', { status: 'error', dir: TAB_OTHER_DIR, reason: 'fetch' }],
    ['형식 오류', { status: 'error', dir: TAB_OTHER_DIR, reason: 'format' }],
  ])('다른 분석의 %s 상태는 idle 로 읽는다: loading', (_label, load) => {
    expect(resolvePreview3dMode(tabInput({ load }))).toBe('loading');
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `cd dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts -t "resolvePreview3dMode"`

Expected: FAIL. `Tests  44 failed | (N + 35) skipped`. 오류는 전부 `TypeError: resolvePreview3dMode is not a function`.

- [ ] **Step 8: 최소 구현 (`resolvePreview3dMode`)**

`dashboard/lib/domain/points3d.ts`의 파일 머리에서 Step 4에 더한 import 줄을 다음으로 바꾼다(`Surface`를 더한다).

바꾸기 전:

```ts
import type { Stats } from './types';
```

바꾼 뒤:

```ts
import type { Stats, Surface } from './types';
```

같은 파일의 맨 끝(Step 4에서 붙인 `loadFor` 아래)에 다음을 붙인다.

```ts
// ---- 3D 탭 모드 결정 (스펙 §7.11 분기표) ----

export type Preview3dMode = 'wall' | 'import' | 'no_data' | 'software_prompt' | 'loading' | 'viewer'
  | 'error_stats' | 'error_fetch' | 'error_format' | 'error_webgl' | 'error_context';

export interface Preview3dInput {
  surface: Surface;                    // analysis.surface
  isImport: boolean;                   // isExternalImport(...)
  dir: string | null;                  // analysis.artifacts_dir (지금 보는 분석)
  file: string | null;                 // points3dFile(stats)
  thresholdQ: number | null;           // defaultThresholdQ(stats)
  support: Webgl2Support | null;       // null = 아직 탐지 전(또는 다시 탐지하는 중)
  optedIn: boolean;                    // 소프트웨어 렌더에서 "3D로 보기"를 눌렀는가
  load: Points3dLoad;                  // 상위 state 그대로. 함수 안에서 loadFor(load, dir) 로 읽는다
  rendererFailed: boolean;             // createRenderer 가 null 을 돌려줬는가
  contextLost: boolean;                // 컨텍스트 손실이 3초 안에 복구되지 않았는가
}

/** 분기표 1~4행: 뷰어 대상이 아닌 분석이면 그 모드, 뷰어 대상이면 null.
 *  이 네 경우에는 WebGL2 탐지도 fetch 도 하지 않는다. */
function nonViewerMode(input: Preview3dInput): 'wall' | 'import' | 'no_data' | 'error_stats' | null {
  if (input.surface === 'wall') return 'wall';                       // 1행
  if (input.isImport) return 'import';                               // 2행
  if (input.dir === null || input.file === null) return 'no_data';   // 3행
  if (input.thresholdQ === null) return 'error_stats';               // 4행. 9행(error_format)과 달리 다시 시도가 없다
  return null;
}

/** 분기표를 위에서부터 차례로 검사해 처음 맞는 행의 모드를 돌려준다. 행의 순서가 곧 우선순위다. */
export function resolvePreview3dMode(input: Preview3dInput): Preview3dMode {
  const early = nonViewerMode(input);
  if (early !== null) return early;                                                     // 1~4행
  if (input.support === null) return 'loading';                                         // 5행. load 상태와 무관하다
  if (input.support === 'unsupported' || input.rendererFailed) return 'error_webgl';    // 6행
  if (input.support === 'software' && !input.optedIn) return 'software_prompt';         // 7행
  const current = loadFor(input.load, input.dir);                                       // 표의 L
  if (current.status === 'error') {
    return current.reason === 'fetch' ? 'error_fetch' : 'error_format';                 // 8·9행
  }
  if (input.contextLost) return 'error_context';                                        // 10행
  if (current.status === 'ready') return 'viewer';                                      // 12행
  return 'loading';                                                                     // 11행(idle 또는 loading)
}
```

구현 순서에 대한 설명: 코드에서는 12행(`ready` → `viewer`)을 11행보다 먼저 검사한다. `L.status`는 한 값이라 11행과 12행의 조건이 동시에 참일 수 없으므로 결과는 표의 순서로 검사한 것과 같고, 마지막 `return 'loading'`이 idle과 loading 둘을 한 번에 받는다.

- [ ] **Step 9: 통과 확인**

Run: `cd dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts -t "resolvePreview3dMode"`

Expected: PASS. `Tests  44 passed | (N + 35) skipped`.

- [ ] **Step 10: 실패하는 테스트 작성 (`shouldProbe`·`shouldRequestLoad`)**

`dashboard/lib/domain/__tests__/points3d.test.ts`의 파일 머리, Step 6에서 더한 import 두 줄 바로 아래에 다음 한 줄을 더한다.

```ts
import { shouldProbe, shouldRequestLoad } from '../points3d';
```

같은 파일의 맨 끝에 다음 블록을 붙인다. Step 2의 `TAB_OTHER_DIR`·`TAB_DATA`와 Step 6의 `tabInput`, `TAB_IDLE`, `TAB_LOADING`, `TAB_READY`, `TAB_FETCH_ERROR`, `TAB_FORMAT_ERROR`를 그대로 쓴다.

```ts
// ---------------------------------------------------------------------------
// Task 7: 탐지·적재 요청 여부 (스펙 §7.2, §7.3 의 2·3번)
// ---------------------------------------------------------------------------

describe('shouldProbe · shouldRequestLoad (탐지와 적재 요청 여부)', () => {
  // 하중 확인용 대조군. 1~4행 조건이 없을 때 아래 두 입력은 각각 true 여야 한다.
  // 이 전제가 깨지면 '뷰어 대상이 아니면 false' 단언이 가드 없이도 통과해 버린다.
  const PROBE_WOULD_FIRE: Partial<Preview3dInput> = { support: null, load: TAB_IDLE };
  const REQUEST_WOULD_FIRE: Partial<Preview3dInput> = { support: 'hardware', load: TAB_IDLE };

  it('대조군: 뷰어 대상이고 탐지 전이면 probe, 하드웨어 + idle 이면 request', () => {
    expect(shouldProbe(tabInput(PROBE_WOULD_FIRE))).toBe(true);
    expect(shouldRequestLoad(tabInput(REQUEST_WOULD_FIRE))).toBe(true);
  });

  it.each<[string, Partial<Preview3dInput>]>([
    ['1행 벽면', { surface: 'wall' }],
    ['2행 임포트', { isImport: true }],
    ['3행 dir 없음', { dir: null }],
    ['3행 점 파일 없음', { file: null }],
    ['4행 표시 임계값 없음', { thresholdQ: null }],
  ])('뷰어 대상이 아니면 탐지도 요청도 하지 않는다: %s', (_label, over) => {
    expect(shouldProbe(tabInput({ ...PROBE_WOULD_FIRE, ...over }))).toBe(false);
    expect(shouldRequestLoad(tabInput({ ...PROBE_WOULD_FIRE, ...over }))).toBe(false);
    expect(shouldProbe(tabInput({ ...REQUEST_WOULD_FIRE, ...over }))).toBe(false);
    expect(shouldRequestLoad(tabInput({ ...REQUEST_WOULD_FIRE, ...over }))).toBe(false);
  });

  it.each<[string, Points3dLoad]>([
    ['idle', TAB_IDLE],
    ['loading', TAB_LOADING],
    ['ready', TAB_READY],
    ['fetch 오류', TAB_FETCH_ERROR],
    ['형식 오류', TAB_FORMAT_ERROR],
  ])('탐지 전(support null)에는 probe 만 true 다: load %s', (_label, load) => {
    expect(shouldProbe(tabInput({ support: null, load }))).toBe(true);
    expect(shouldRequestLoad(tabInput({ support: null, load }))).toBe(false);
  });

  it.each<[Preview3dInput['support']]>([['hardware'], ['software'], ['unsupported']])(
    '탐지가 끝났으면(%s) 다시 탐지하지 않는다',
    (support) => {
      expect(shouldProbe(tabInput({ support, load: TAB_IDLE }))).toBe(false);
      expect(shouldProbe(tabInput({ support, load: TAB_READY }))).toBe(false);
    },
  );

  it('소프트웨어 렌더는 "3D로 보기" 전에는 요청하지 않고 누른 뒤에 요청한다', () => {
    expect(shouldRequestLoad(tabInput({ support: 'software', optedIn: false, load: TAB_IDLE }))).toBe(false);
    expect(shouldRequestLoad(tabInput({ support: 'software', optedIn: true, load: TAB_IDLE }))).toBe(true);
  });

  it.each<[string, Points3dLoad]>([
    ['loading', TAB_LOADING],
    ['ready', TAB_READY],
    ['fetch 오류', TAB_FETCH_ERROR],
    ['형식 오류', TAB_FORMAT_ERROR],
  ])('지금 분석의 적재 상태가 %s 이면 요청하지 않는다', (_label, load) => {
    expect(shouldRequestLoad(tabInput({ support: 'hardware', load }))).toBe(false);
  });

  it.each<[string, Partial<Preview3dInput>]>([
    ['WebGL2 불가', { support: 'unsupported' }],
    ['렌더러 생성 실패', { rendererFailed: true }],
    ['컨텍스트 손실', { contextLost: true }],
  ])('idle 이어도 모드가 loading 이 아니면 요청하지 않는다: %s', (_label, over) => {
    expect(shouldRequestLoad(tabInput({ load: TAB_IDLE, ...over }))).toBe(false);
  });

  it.each<[string, Points3dLoad]>([
    ['ready', { status: 'ready', dir: TAB_OTHER_DIR, data: TAB_DATA }],
    ['loading', { status: 'loading', dir: TAB_OTHER_DIR }],
    ['error', { status: 'error', dir: TAB_OTHER_DIR, reason: 'fetch' }],
  ])('다른 분석의 %s 상태가 남아 있으면 새로 요청한다(분석 전환)', (_label, load) => {
    expect(shouldRequestLoad(tabInput({ support: 'hardware', load }))).toBe(true);
  });

  it('분석을 바꿔도 소프트웨어 렌더의 선택 전에는 요청하지 않는다', () => {
    const load: Points3dLoad = { status: 'ready', dir: TAB_OTHER_DIR, data: TAB_DATA };
    expect(shouldRequestLoad(tabInput({ support: 'software', optedIn: false, load }))).toBe(false);
  });
});
```

- [ ] **Step 11: 실패 확인**

Run: `cd dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts -t "shouldProbe"`

Expected: FAIL. `Tests  26 failed | (N + 79) skipped`. 오류는 `TypeError: shouldProbe is not a function`과 `TypeError: shouldRequestLoad is not a function` 두 종류뿐이다.

- [ ] **Step 12: 최소 구현 (`shouldProbe`·`shouldRequestLoad`)**

`dashboard/lib/domain/points3d.ts`의 맨 끝(Step 8에서 붙인 `resolvePreview3dMode` 아래)에 다음을 붙인다.

```ts
// ---- 탐지·적재 요청 여부 (스펙 §7.3 의 2·3번) ----

/** WebGL2 탐지를 해야 하는가. 뷰어 대상(1~4행이 아님)이고 아직 탐지하지 않았을 때만 true. */
export function shouldProbe(input: Preview3dInput): boolean {
  return nonViewerMode(input) === null && input.support === null;
}

/** 점 파일을 받아 달라고 상위에 요청해야 하는가.
 *  모드가 loading 이어도 탐지 전(5행)이면 요청하지 않는다. 소프트웨어 렌더는 "3D로 보기" 전(7행)에 받지 않는다. */
export function shouldRequestLoad(input: Preview3dInput): boolean {
  return resolvePreview3dMode(input) === 'loading'
    && input.support !== null
    && loadFor(input.load, input.dir).status === 'idle';
}
```

- [ ] **Step 13: 통과 확인 (파일 전체, 전체 스위트, 타입 검사)**

Run:

```bash
cd D:/Projects/Flatness/dashboard
npx vitest run lib/domain/__tests__/points3d.test.ts
npx vitest run
npx tsc --noEmit
```

Expected:
- 첫 명령: `Test Files  1 passed (1)`, `Tests  (N + 105) passed`. 이 태스크가 더한 테스트는 105건이다(stats 접근·`loadFor` 35, `resolvePreview3dMode` 44, `shouldProbe`·`shouldRequestLoad` 26).
- 둘째 명령: 실패 0. 기준선(84파일 769건)에 Task 5·6이 더한 것과 이 태스크의 105건을 더한 수가 전부 통과한다. `__tests__/palette-sweep.test.ts`도 통과한다(이 태스크는 그 파일을 고치지 않는다).
- 셋째 명령: 출력 없음, 종료 코드 0.

실패가 있으면 실패한 그대로 기록하고 원인을 고친 뒤 세 명령을 다시 돌린다.

- [ ] **Step 14: 금지 문자열 확인**

Run:

```bash
cd D:/Projects/Flatness
grep -nE "pass_mm|rework_mm|u_mm|applied_criteria" dashboard/lib/domain/points3d.ts; echo "exit=$?"
LC_ALL=C grep -c $'\xe2\x80\x94' dashboard/lib/domain/points3d.ts dashboard/lib/domain/__tests__/points3d.test.ts
```

Expected:
- 첫 명령: 일치하는 줄 없음, `exit=1`(판정 기준 필드 이름이 주석에도 없다. Task 14의 소스 검사 테스트가 같은 것을 강제한다).
- 둘째 명령: 두 파일 모두 `:0`(U+2014 없음).

그리고 이 태스크가 붙인 코드(Step 4·8·12)에 점 파일의 이름을 문자열 리터럴로 적지 않았는지 눈으로 확인한다(받을 이름은 `points3dFile(stats)`가 돌려준 값이다).

- [ ] **Step 15: 스테이징 후 변이 확인**

먼저 두 파일을 스테이징한다(아래 변이를 되돌릴 때 인덱스가 원본 역할을 한다).

```bash
cd D:/Projects/Flatness
git add dashboard/lib/domain/points3d.ts dashboard/lib/domain/__tests__/points3d.test.ts
```

아래 변이를 **하나씩** `dashboard/lib/domain/points3d.ts`에 넣고, `cd dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts`를 돌려 기대한 테스트가 죽는지 본 뒤, 곧바로 `git restore dashboard/lib/domain/points3d.ts`(저장소 루트에서)로 되돌린다. 테스트 파일은 건드리지 않는다.

| # | 변이 | 죽어야 하는 테스트 |
|---|---|---|
| 1 | `resolvePreview3dMode`에서 `if (input.support === null) return 'loading';` 줄(5행)을 지운다 | 4건: `5행: 탐지 전(load 는 ready)`, `우선순위 5 > 6`, `우선순위 5 > 8`, `우선순위 5 > 10` |
| 2 | `loadFor`에서 `if (load.status !== 'idle' && load.dir !== dir) return { status: 'idle' };` 줄을 지운다 | 12건: `loadFor`의 `dir 이 다르면 ...` 3건과 `지금 분석의 dir 이 null 이면 ...` 3건, `resolvePreview3dMode`의 `다른 분석의 ... 상태는 idle 로 읽는다` 3건, `shouldRequestLoad`의 `다른 분석의 ... 상태가 남아 있으면 새로 요청한다` 3건 |
| 3 | `shouldRequestLoad`의 `resolvePreview3dMode(input) === 'loading'`을 `nonViewerMode(input) === null`로 바꾼다(소프트웨어 렌더에서 선택 전에 fetch) | 5건: `소프트웨어 렌더는 "3D로 보기" 전에는 요청하지 않고 누른 뒤에 요청한다`, `분석을 바꿔도 소프트웨어 렌더의 선택 전에는 요청하지 않는다`, `idle 이어도 모드가 loading 이 아니면 요청하지 않는다` 3건 |
| 4 | `nonViewerMode`의 4행에서 `return 'error_stats';`를 `return 'error_format';`으로 바꾼다(vitest는 타입을 검사하지 않으므로 그대로 실행된다) | 5건: `4행: 표시 임계값 없음`, `우선순위 4 > 5`, `우선순위 4 > 6`, `우선순위 4 > 9: ...`, `표의 입력이 11개 모드를 전부 지난다` |
| 5 | `defaultThresholdQ`의 마지막 줄을 `return q;`로 바꾼다(clamp 제거) | 6건: `points3d_threshold_q 가 9 / 5 / 0 / -70 이면 10`, `301 / 999 이면 300` |

다섯 변이가 전부 위 테스트를 죽였는지 확인한다. 죽지 않는 변이가 있으면 테스트를 Step 2·6·10의 코드와 대조해 빠진 줄을 찾는다(변이를 살려 둔 채 넘어가지 않는다).

마지막으로 되돌려졌는지 확인한다.

```bash
cd D:/Projects/Flatness
git diff --stat -- dashboard/lib/domain/points3d.ts
cd dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts
```

Expected: `git diff --stat` 출력 없음(작업 트리가 스테이징한 내용과 같다). vitest는 `Tests  (N + 105) passed`.

- [ ] **Step 16: 커밋**

```bash
cd D:/Projects/Flatness
git add dashboard/lib/domain/points3d.ts dashboard/lib/domain/__tests__/points3d.test.ts
git status --short
git commit -m "$(cat <<'EOF'
feat(dashboard): 3D 탭 상태 결정 순수 함수(stats 접근, loadFor, resolvePreview3dMode)

lib/domain/points3d.ts 에 추가(스펙 2026-10-02 pointcloud-viewer §7.2, §7.3, §7.11):
- points3dFile, defaultThresholdQ: stats 에서 points3d_paths 와 points3d_threshold_q 두 키만 읽는다.
  임계값은 정수일 때만 [10, 300] 으로 clamp 하고 5 의 배수로 맞추지 않는다. 파일명 상수는 두지 않는다.
- Webgl2Support, Points3dLoad, loadFor: 적재 상태를 artifacts_dir 로 키 잡아 다른 분석의 상태를 idle 로 본다.
- Preview3dMode, Preview3dInput, resolvePreview3dMode: 분기표 12행을 위에서부터 차례로 검사한다.
- shouldProbe, shouldRequestLoad: 뷰어 대상이 아닌 분석(1~4행)에서는 탐지도 요청도 하지 않고,
  탐지 전과 소프트웨어 렌더의 선택 전에는 요청하지 않는다.

테스트 105건 추가(행별 최소 입력 17, 우선순위 23 포함). 변이 5종(5행 제거, loadFor 의 dir 비교 제거,
선택 전 fetch, error_stats 와 error_format 합침, clamp 제거)이 각각 테스트를 죽이는 것을 확인했다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

Expected: `git status --short`에 `M  dashboard/lib/domain/points3d.ts`와 `M  dashboard/lib/domain/__tests__/points3d.test.ts` 두 줄만 스테이징돼 있다(다른 파일이 섞여 있으면 커밋하지 말고 원인을 확인한다). 커밋 뒤 `git log -1 --stat`에 그 두 파일만 나온다.

---

**초안 검증 메모 (계획 작성 중 실제로 돌려 본 것).** 저장소 밖 스크래치(`.superpowers/plan-drafts/pointcloud-viewer/scratch-07/`)에 Task 6의 시그니처만 맞춘 최소 대역(`points3d.ts`의 상수와 `Points3dData`, 테스트 1건)과 Task 5의 두 키를 더한 `types.ts` 사본을 두고, 저장소의 vitest와 tsc를 빌려 돌렸다(`cd dashboard && npx vitest run --root <스크래치>`, `npx tsc --noEmit -p <스크래치>/tsconfig.json`).
- 이 문서의 코드 블록을 Step 순서대로 붙여 가며 Step 3·7·11의 실패 수(35·44·26)와 오류 문구, Step 5·9·13의 통과 수를 확인했다. `tsc`는 `strict`와 `noUnusedLocals`에서 오류 0이었다.
- Step 15의 변이 5종과 그 밖의 변이 21종(행 순서 바꾸기, 조건 누락, 반올림, 파일명 고정, 적용 기준에서 임계값 유도 등. `scratch-07/mutate.py`)을 넣어 전부 테스트가 죽는 것을 확인했다. 위 표의 "죽어야 하는 테스트" 건수는 그 실측값이다.
- Task 6 초안이 완성된 뒤(2026-10-03) 다시 확인했다. `task-06.md`의 코드 블록은 `scratch-06/dashboard/lib/domain/`의 `points3d.ts`(285줄)·`points3d.test.ts`(577줄)에서 그대로 생성된 것이므로 그 두 파일을 Task 6 산출물로 삼고, 그 위에 이 문서의 코드 블록을 Step 순서대로 붙여 jsdom 환경으로 돌렸다(`scratch-07/replay_t6.py`). 결과: Task 6만 `107 passed`, Task 6 + Task 7 `212 passed`(107 + 105), `tsc --noEmit`(`strict` + `noUnusedLocals`) 오류 0. Step 3·7·11의 `-t` 필터도 같은 파일에서 각각 35·44·26건만 고른다(Task 6의 테스트 이름과 겹치지 않는다). Task 6의 테스트 파일 최상위 이름(`GOLDEN_PATH`, `ORIGIN_ABS`, `MN`, `EXT`, `Q`, `DEV`, `JSON_LEN`, `FILE_SIZE`, `golden`, `goldenBytes`, `buildFile`, `Json`, `withMeta`, `withRawMeta`, `parseOk`, `reasonOf`, `onePoint`)은 이 태스크의 `TAB_*`·`tabStats`·`tabInput`·`TabStats`·`TabData`·`TabRow`와 겹치지 않고, Task 6의 `points3d.ts`에는 import 문이 없어 Step 4의 import가 파일의 첫 import가 된다. Step 14의 금지 문자열 검사와 팔레트 스윕 정규식도 그 결과 파일에서 0건이었다.
- 변이 26종(`scratch-07/mutate.py`)도 같은 날 다시 돌려 전부 최소 1건 이상 죽는 것을 확인했다. Step 15의 다섯 건수(4·12·5·5·6)는 그 실측값과 같다.
- 확인하지 못한 것: 저장소에 커밋된 실제 Task 5·6 산출물 위에서의 실행(아직 저장소에 없다. Task 6 구현이 계획과 다르게 이름을 바꾸면 Step 1의 grep에서 드러난다). 대시보드 전체 스위트(`npx vitest run`)와 `next build`는 스크래치에서 돌리지 않았다(이 태스크는 순수 함수와 타입만 더하므로 다른 파일의 테스트에 영향을 줄 경로가 없다).

---
### Task 8: 뷰 순수 모듈: `mat4.ts` + `orbit.ts` (행렬과 궤도 카메라)

**목표:** 4×4 행렬 유틸과 Z-up 궤도 카메라(프리셋, fit, 회전·줌·팬, viewProj)가 기지 값과 화면 투영 성질로 검증된다.

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.4(FOVY, 프리셋, 고도·줌 제한), §7.2(`mat4.ts`·`orbit.ts` 시그니처, 픽셀 단위), §7.7(카메라, 초기 맞춤, 클립 평면, 프리셋, 회전·팬 환산), §10.4(`mat4.test.ts`, `orbit.test.ts`).

**Files:**
- Create: `dashboard/lib/viz/points3d/mat4.ts`
- Create: `dashboard/lib/viz/points3d/orbit.ts`
- Create: `dashboard/lib/viz/points3d/__tests__/mat4.test.ts`
- Create: `dashboard/lib/viz/points3d/__tests__/orbit.test.ts`
- Modify: 없음. `dashboard/lib/viz/` 에는 지금 `heatmap.ts` 와 `__tests__/heatmap.test.ts` 만 있고 `points3d/` 폴더는 이 태스크가 처음 만든다.
- Test: `dashboard/lib/viz/points3d/__tests__/mat4.test.ts`(15건), `dashboard/lib/viz/points3d/__tests__/orbit.test.ts`(41건)

**Interfaces:**
- Consumes (앞 태스크의 코드는 쓰지 않는다. 스펙의 값만 쓴다):
  - 스펙 §2.4 상수: `FOVY` 40°, 프리셋 각도(등각 방위 −55°·고도 20° / 평면 방위 −90°·고도 89.9° / 정면 방위 −90°·고도 5°), 고도 제한 ±89.9°, 줌 거리 `[0.02 × R, 20 × R]`(`R` = fit 반경)
  - 스펙 §7.7: `eye = target + distance × (cos e · cos a, cos e · sin a, sin e)`, `radius = max(fit 대각선 / 2, 0.5m)`, `distance = radius / sin(FOVY / 2) × 1.05`, `far = distance + farRadius`, `near = max(distance − farRadius, distance × 0.001)`(`farRadius` = 현재 `target` 에서 전체 범위 상자의 가장 먼 꼭짓점까지의 거리), 회전 1px당 0.005rad(오른쪽으로 끌면 방위 감소, 아래로 끌면 고도 증가), 팬의 m/px 환산 `2 × distance × tan(fovy / 2) / cssHPx`
- Produces (T9·T10·T11·T12 가 이 이름과 시그니처 그대로 쓴다):
  - mat4.ts: `export type Vec3 = [number, number, number];`
  - mat4.ts: `export function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array;` `export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Float32Array;` `export function multiply(a: Float32Array, b: Float32Array): Float32Array;` (a × b, 열 우선 `Float32Array(16)`, `m[c * 4 + r]`)
  - mat4.ts: `export function transformPoint(m: Float32Array, p: Vec3): [number, number, number, number];` (클립 좌표 x, y, z, w)
  - mat4.ts: `export function project(m: Float32Array, p: Vec3, cssW: number, cssH: number): { x: number; y: number; w: number } | null;` (w <= 0 이면 null. x·y 는 CSS px, 왼쪽 위 원점, y 는 아래로 증가. w 는 클립 w = 카메라 전방 거리)
  - orbit.ts: `export const FOVY: number;`(40° 라디안) `export const ELEVATION_LIMIT: number;`(89.9° 라디안) `export const ROTATE_RAD_PER_PX = 0.005;` `export const ZOOM_MIN_FACTOR = 0.02;` `export const ZOOM_MAX_FACTOR = 20;` `export const MIN_FIT_RADIUS_M = 0.5;` `export const PRESET_ANGLES: Record<ViewPreset, { azimuth: number; elevation: number }>;`
  - orbit.ts: `export interface Bounds { min: [number, number, number]; max: [number, number, number]; }` `export interface OrbitState { target: [number, number, number]; distance: number; azimuth: number; elevation: number; fovy: number; radius: number; }` `export type ViewPreset = 'iso' | 'top' | 'front';`
  - orbit.ts: `export function fitToBounds(fit: Bounds, preset: ViewPreset): OrbitState;` `export function rotate(s: OrbitState, dxPx: number, dyPx: number): OrbitState;` `export function zoom(s: OrbitState, factor: number): OrbitState;` `export function pan(s: OrbitState, dxPx: number, dyPx: number, cssHPx: number): OrbitState;` `export function eyeOf(s: OrbitState): [number, number, number];` `export function viewProj(s: OrbitState, aspect: number, full: Bounds): Float32Array;`
  - 성질(뒤 태스크가 기댄다): 모든 함수는 입력을 바꾸지 않는다. `rotate`·`zoom`·`pan` 은 새 객체를 돌려준다. `rotate`·`zoom`·`pan` 은 `radius` 와 `fovy` 를 바꾸지 않는다. `viewProj` 의 `full` 은 near/far 에만 쓰이고 화면 x·y 에는 영향이 없다.

**이 태스크를 하는 사람이 알아야 할 것:**

- 두 모듈은 DOM·WebGL·React·Next.js API 를 쓰지 않는 순수 TypeScript 다. `dashboard/node_modules/next/dist/docs/` 에서 확인할 가이드가 없다. import 는 `./mat4` 하나뿐이다.
- 좌표계: 월드는 Z-up(바닥이 XY, 높이가 +z), 단위 m. 카메라 좌표계는 오른손(−z 가 전방), 클립 z 는 `[−1, 1]`(WebGL 관례). 행렬은 열 우선 `Float32Array(16)` 이고 원소 위치는 `m[c * 4 + r]` 다.
- 픽셀 단위: 이 태스크의 `dxPx`·`dyPx`·`cssHPx`·`cssW`·`cssH` 는 전부 **CSS 픽셀**이다(포인터 이벤트 좌표, `clientWidth`·`clientHeight` 와 같은 단위). 드로잉 버퍼 픽셀은 이 두 모듈에 나오지 않는다.
- 시제품(`.superpowers/research/3d-pointcloud-viewer/design-inputs/proto/viz/mat4.js`, `orbit.js`)을 그대로 옮기면 안 된다. 스펙과 다른 곳: 프리셋 각도(시제품 −60°·36°), 고도 제한(시제품 89°), near/far(시제품은 `radius × 2` 기준, 스펙은 전체 범위 상자의 가장 먼 꼭짓점 기준), fit 반경 하한 0.5m 없음, `fitToBounds(fit, preset)` 시그니처, `project` 가 `w` 를 함께 돌려줌.
- 평면 프리셋의 고도 89.9° 를 90° 로 바꾸지 않는다. 90° 면 시선이 `up = [0, 0, 1]` 과 나란해져 `lookAt` 의 오른쪽 축(`f × up`)이 0 벡터가 된다.
- 주석·문자열에 `색이름-숫자` 꼴 표기, U+2014, 판정 기준 필드 이름(T14 의 `points3d-litmus.test.ts` 가 금지하는 4개)을 쓰지 않는다. `dashboard/__tests__/palette-sweep.test.ts` 와 T14 의 litmus 테스트가 `lib/viz/points3d/*.ts` 전체를 읽는다. 아래 코드는 이 조건을 지킨다. 붙여 넣은 뒤 주석을 고쳐 쓸 때만 주의하면 된다.
- 컴포넌트가 아니므로 반환 타입을 적는다(반환 타입을 적지 않는 규칙은 React 컴포넌트에만 해당한다).
- 스펙 식에 없는 줄이 하나 있다: `viewProj` 의 `if (farRadius === 0) farRadius = s.radius;`. 전체 범위가 `target` 한 점일 때(표본이 한 점뿐인 파일) 스펙 식 그대로면 `near = far` 가 되어 투영 행렬이 NaN 이 되고 화면이 빈다. 이 가드는 그 경우에만 걸리고 그 밖의 입력에서는 스펙 식과 값이 같다. 대응 테스트가 있다(`전체 범위가 한 점이어도 행렬이 유한하다`).

---

- [ ] **Step 1: `mat4` 의 실패하는 테스트 작성**

`dashboard/lib/viz/points3d/__tests__/mat4.test.ts` 를 새로 만든다(폴더 `dashboard/lib/viz/points3d/__tests__/` 도 새로 만든다). 기대값은 전부 손으로 계산한 값이고 근거가 각 `it` 의 주석에 있다.

```ts
// mat4: 열 우선 4x4 행렬 유틸의 기지 값.
// 기대값은 전부 손으로 계산했다(각 it 의 주석에 근거). 구현 출력을 베낀 값이 없다.
import { describe, expect, it } from 'vitest';
import { lookAt, multiply, perspective, project, transformPoint } from '../mat4';

// Float32Array 라서 정확히 같지 않을 수 있다. 소수 5자리까지 본다.
function expectMat(m: Float32Array, want: number[]) {
  expect(m).toBeInstanceOf(Float32Array);
  expect(m.length).toBe(16);
  want.forEach((v, i) => expect(m[i], `m[${i}]`).toBeCloseTo(v, 5));
}
function expectVec(got: number[], want: number[], digits = 4) {
  expect(got.length).toBe(want.length);
  want.forEach((v, i) => expect(got[i], `v[${i}]`).toBeCloseTo(v, digits));
}

// 열 우선 배치: m[c * 4 + r]
const SCALE_234 = new Float32Array([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]);
const TRANSLATE_123 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);

describe('perspective', () => {
  it('fovy 90도, aspect 2, near 1, far 3 의 기지 값(열 우선)', () => {
    // f = 1 / tan(45도) = 1. m[0] = f / aspect = 0.5, m[5] = f = 1,
    // m[10] = (far + near) / (near - far) = 4 / -2 = -2, m[11] = -1,
    // m[14] = 2 * far * near / (near - far) = 6 / -2 = -3, m[15] = 0
    expectMat(perspective(Math.PI / 2, 2, 1, 3), [0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, -2, -1, 0, 0, -3, 0]);
  });

  it('near 평면의 점은 클립 z / w = -1, far 평면의 점은 +1 이고 w 는 전방 거리다', () => {
    const p = perspective(Math.PI / 2, 2, 1, 3);
    // 카메라는 -z 를 본다. (0, 0, -1): z = -2 * -1 - 3 = -1, w = 1
    expectVec(transformPoint(p, [0, 0, -1]), [0, 0, -1, 1]);
    // (0, 0, -3): z = -2 * -3 - 3 = 3, w = 3 -> z / w = 1
    expectVec(transformPoint(p, [0, 0, -3]), [0, 0, 3, 3]);
  });

  it('fovy 40도, aspect 4/3 이면 m[5] = 1 / tan(20도), m[0] = m[5] / aspect', () => {
    // tan(20도) = 0.3639702343 -> 1 / tan = 2.7474774, / (4 / 3) = 2.0606081
    const p = perspective((40 * Math.PI) / 180, 4 / 3, 1, 10);
    expect(p[5]).toBeCloseTo(2.7474774, 5);
    expect(p[0]).toBeCloseTo(2.0606081, 5);
  });
});

describe('lookAt', () => {
  it('+z 위에서 원점을 보는 카메라(up = +y)는 평행 이동만 한다', () => {
    // 전방 f = (0, 0, -1), 오른쪽 s = (1, 0, 0), 위 u = (0, 1, 0). 이동 = (0, 0, -5)
    expectMat(lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1]);
  });

  it('Z-up: -y 쪽에서 원점을 보면 월드 x 가 카메라 x, 월드 z 가 카메라 y 가 된다', () => {
    // f = (0, 1, 0), s = f x up = (1, 0, 0), u = s x f = (0, 0, 1)
    // 열 0 = (s.x, u.x, -f.x) = (1, 0, 0), 열 1 = (s.y, u.y, -f.y) = (0, 0, -1),
    // 열 2 = (s.z, u.z, -f.z) = (0, 1, 0), 열 3 = (-s.eye, -u.eye, f.eye) = (0, 0, -10)
    const v = lookAt([0, -10, 0], [0, 0, 0], [0, 0, 1]);
    expectMat(v, [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, -10, 1]);
    // 점 (1, 2, 3): 카메라 x = 1, 카메라 y = 월드 z = 3, 카메라 z = -(2 - (-10)) = -12
    expectVec(transformPoint(v, [1, 2, 3]), [1, 3, -12, 1]);
  });

  it('eye 는 카메라 원점으로, center 는 -z 축 위 |eye - center| 거리로 간다', () => {
    // |(3, 4, 12)| = 13
    const v = lookAt([3, 4, 12], [0, 0, 0], [0, 0, 1]);
    expectVec(transformPoint(v, [3, 4, 12]), [0, 0, 0, 1]);
    expectVec(transformPoint(v, [0, 0, 0]), [0, 0, -13, 1]);
  });
});

describe('multiply', () => {
  it('a x b 는 b 를 먼저 적용한다(열 우선)', () => {
    // S x T: 열 3 = S * (1, 2, 3, 1) = (2, 6, 12, 1)
    expectMat(multiply(SCALE_234, TRANSLATE_123), [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 2, 6, 12, 1]);
    // T x S: 열 3 = T * (0, 0, 0, 1) = (1, 2, 3, 1)
    expectMat(multiply(TRANSLATE_123, SCALE_234), [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1]);
  });

  it('S x T 로 점 (1, 1, 1) 을 옮기면 이동 뒤 배율: (4, 9, 16)', () => {
    // (1 + 1) * 2 = 4, (1 + 2) * 3 = 9, (1 + 3) * 4 = 16
    expectVec(transformPoint(multiply(SCALE_234, TRANSLATE_123), [1, 1, 1]), [4, 9, 16, 1]);
  });

  it('새 Float32Array 를 돌려주고 입력을 바꾸지 않는다', () => {
    const a = new Float32Array(SCALE_234);
    const b = new Float32Array(TRANSLATE_123);
    const out = multiply(a, b);
    expect(out).not.toBe(a);
    expect(out).not.toBe(b);
    expect(Array.from(a)).toEqual(Array.from(SCALE_234));
    expect(Array.from(b)).toEqual(Array.from(TRANSLATE_123));
  });
});

describe('transformPoint', () => {
  it('열 우선 행렬과 (x, y, z, 1) 의 곱이다', () => {
    // m[c * 4 + r] = c * 4 + r + 1. 점 (1, 2, 3):
    // r0 = 1 * 1 + 5 * 2 + 9 * 3 + 13 = 51, r1 = 2 + 12 + 30 + 14 = 58,
    // r2 = 3 + 14 + 33 + 15 = 65, r3 = 4 + 16 + 36 + 16 = 72
    const m = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(transformPoint(m, [1, 2, 3])).toEqual([51, 58, 65, 72]);
  });
});

describe('project', () => {
  // 카메라: (0, 0, 5) 에서 원점을 본다. fovy 90도(f = 1), aspect 2. 화면 200 x 100 CSS px
  const m = multiply(perspective(Math.PI / 2, 2, 1, 100), lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]));
  const W = 200;
  const H = 100;

  it('카메라가 보는 중심점은 화면 중앙이고 w 는 카메라 전방 거리다', () => {
    const p = project(m, [0, 0, 0], W, H);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(100, 4);
    expect(p!.y).toBeCloseTo(50, 4);
    expect(p!.w).toBeCloseTo(5, 4);
  });

  it('카메라 오른쪽 점은 x 가 커진다', () => {
    // 클립 x = (f / aspect) * 1 = 0.5, w = 5 -> NDC 0.1 -> (0.1 * 0.5 + 0.5) * 200 = 110
    const p = project(m, [1, 0, 0], W, H);
    expect(p!.x).toBeCloseTo(110, 4);
    expect(p!.y).toBeCloseTo(50, 4);
  });

  it('y 축은 화면 아래로 증가한다: 카메라 위쪽 점의 y 가 작다', () => {
    // 클립 y = f * 1 = 1, w = 5 -> NDC 0.2 -> (1 - (0.2 * 0.5 + 0.5)) * 100 = 40
    const p = project(m, [0, 1, 0], W, H);
    expect(p!.x).toBeCloseTo(100, 4);
    expect(p!.y).toBeCloseTo(40, 4);
  });

  it('가까운 점은 w 가 작다', () => {
    // (0, 0, 4) 는 카메라 앞 1
    expect(project(m, [0, 0, 4], W, H)!.w).toBeCloseTo(1, 4);
  });

  it('w <= 0 이면 null: 카메라 위치(w = 0)와 카메라 뒤(w < 0)', () => {
    expect(project(m, [0, 0, 5], W, H)).toBeNull();
    expect(project(m, [0, 0, 6], W, H)).toBeNull();
  });
});
```

각 테스트가 죽이는 변이:

| 테스트 | 죽이는 변이 |
|---|---|
| `perspective` › fovy 90도, aspect 2, near 1, far 3 의 기지 값(열 우선) | 행 우선 배치(`m[11]` 과 `m[14]` 교환), `near − far` 를 `far − near` 로 |
| `perspective` › near 평면의 점은 클립 z / w = -1, far 평면의 점은 +1 | `2 × far × near` 의 2 누락, z 부호 반전, w 행의 `−1` 을 `+1` 로 |
| `perspective` › fovy 40도, aspect 4/3 | `fovy / 2` 의 `/ 2` 누락, aspect 를 나누지 않고 곱함 |
| `lookAt` › +z 위에서 원점을 보는 카메라는 평행 이동만 한다 | 이동 열의 부호(`−dot` 을 `+dot` 으로), 전방 축 부호 |
| `lookAt` › Z-up: -y 쪽에서 원점을 보면 | `cross(f, up)` 을 `cross(up, f)` 로(손잡이 반전), 오른쪽 축과 위 축 교환 |
| `lookAt` › eye 는 카메라 원점으로, center 는 -z 축 위로 | `center − eye` 를 `eye − center` 로, 전방 벡터 정규화 누락 |
| `multiply` › a x b 는 b 를 먼저 적용한다 | 인자 순서 뒤집기(b × a), 행과 열 전치 |
| `multiply` › S x T 로 점 (1, 1, 1) 을 옮기면 | 같은 순서 변이를 점 변환 결과로 한 번 더 잡는다 |
| `multiply` › 새 Float32Array 를 돌려주고 입력을 바꾸지 않는다 | 결과를 `a` 에 덮어쓰는 제자리 곱 |
| `transformPoint` › 열 우선 행렬과 (x, y, z, 1) 의 곱이다 | 행 우선 인덱싱(`m[0], m[1], m[2], m[3]` 을 한 행으로 읽음) |
| `project` › 중심점은 화면 중앙이고 w 는 카메라 전방 거리다 | x 에 `cssH` 를 곱함, `w` 를 돌려주지 않음 |
| `project` › 카메라 오른쪽 점은 x 가 커진다 | x 부호 반전, `0.5` 배율 누락 |
| `project` › y 축은 화면 아래로 증가한다 | y 뒤집기(`1 − …`) 제거 |
| `project` › 가까운 점은 w 가 작다 | `w` 자리에 클립 z 를 돌려줌 |
| `project` › w <= 0 이면 null | `w <= 0` 을 `w < 0` 으로 완화, 가드 제거 |

- [ ] **Step 2: 실패 확인**

Run: `cd dashboard && npx vitest run lib/viz/points3d/__tests__/mat4.test.ts`

Expected: FAIL. `Error: Failed to resolve import "../mat4" from "lib/viz/points3d/__tests__/mat4.test.ts". Does the file exist?` 와 `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 3: `mat4.ts` 구현**

`dashboard/lib/viz/points3d/mat4.ts` 를 새로 만든다.

```ts
// 4x4 행렬 유틸(열 우선 Float32Array(16), m[c * 4 + r]). 순수 함수이고 DOM 과 WebGL 을 건드리지 않는다.
// 카메라 좌표계는 오른손(-z 가 전방), 클립 z 는 [-1, 1] (WebGL 관례).

export type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Vec3): Vec3 => {
  const len = Math.hypot(a[0], a[1], a[2]) || 1; // 길이 0 이면 그대로 둔다(0 으로 나누지 않는다)
  return [a[0] / len, a[1] / len, a[2] / len];
};

// 원근 투영. fovy 는 세로 시야각(rad), aspect 는 가로 / 세로
export function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

// 뷰 행렬. eye 에서 center 를 보고 up 이 화면 위쪽이 된다
export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Float32Array {
  const f = normalize(sub(center, eye)); // 전방
  const s = normalize(cross(f, up)); // 오른쪽
  const u = cross(s, f); // 위
  return new Float32Array([
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  ]);
}

// a x b (b 를 먼저 적용한다)
export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

// 점 (x, y, z, 1) 을 옮긴 클립 좌표 [x, y, z, w]
export function transformPoint(m: Float32Array, p: Vec3): [number, number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  ];
}

// 점을 화면(CSS px, 왼쪽 위 원점, y 는 아래로 증가)으로 옮긴다. 카메라 뒤(w <= 0)면 null.
// w 는 클립 w 로, 원근 투영에서는 카메라 전방 거리다(pick 의 동률 처리에 쓴다).
export function project(
  m: Float32Array, p: Vec3, cssW: number, cssH: number,
): { x: number; y: number; w: number } | null {
  const [cx, cy, , w] = transformPoint(m, p);
  if (w <= 0) return null;
  return { x: (cx / w * 0.5 + 0.5) * cssW, y: (1 - (cy / w * 0.5 + 0.5)) * cssH, w };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd dashboard && npx vitest run lib/viz/points3d/__tests__/mat4.test.ts`

Expected: PASS. `Test Files  1 passed (1)`, `Tests  15 passed (15)`.

- [ ] **Step 5: `orbit` 의 실패하는 테스트 작성**

`dashboard/lib/viz/points3d/__tests__/orbit.test.ts` 를 새로 만든다. 상수와 기지 값은 손으로 계산한 리터럴이고(구현의 `도 × π / 180` 식을 테스트에서 다시 쓰지 않는다), 나머지는 `project` 로 본 화면 성질이다. 화면 안 판정은 `project` 결과가 `0 <= x <= W`, `0 <= y <= H` 인지로 한다(`W = 640`, `H = 480`, 뷰어 영역 비율 4:3).

기대값의 근거:

- 라디안: 40° = 0.698131700798, 89.9° = 90° − 0.1° = 1.570796326795 − 0.001745329252 = 1.569050997543, 55° = 0.959931088597, 20° = 0.349065850399, 5° = 0.0872664626.
- `sin(20°)` = 0.3420201433, `tan(20°)` = 0.3639702343.
- `FLOOR`(`[0,0,0] ~ [6,8,0]`): 대각선 10, 반경 5, `distance` = 5 / 0.3420201433 × 1.05 = 15.3499731.
- `ROOM`(`[10,20,1] ~ [13,24,13]`): 대각선 √(9 + 16 + 144) = 13, 반경 6.5, `distance` = 6.5 / 0.3420201433 × 1.05 = 19.9549650.
- 반경 하한: 대각선 √(0.04 + 0.01) = 0.2236 의 절반 0.1118 < 0.5 이므로 반경 0.5, `distance` = 0.5 / 0.3420201433 × 1.05 = 1.5349973.
- 팬 환산: 2 × 15.3499731 × 0.3639702343 / 480 = 0.0232788888 m/px. 100px 이면 2.32788888m, 높이 240px 캔버스에서는 그 두 배 4.65577776m.
- 클립 평면(직접 만든 상태: `target [3,4,0]`, `distance 10`, 방위 0, 고도 0 이므로 eye = `[13,4,0]`, 시선은 −x): 전체 범위 `FLOOR` 의 네 꼭짓점이 `target` 에서 전부 5 이므로 near 5, far 15. 전방 거리 `d` 인 점의 클립 z/w 는 `(far + near) / (far − near) − 2 × far × near / ((far − near) × d)`. `d = 10` 이면 2 − 1.5 = 0.5. 전체 범위 `[0,0,0] ~ [60,80,0]` 이면 가장 먼 꼭짓점까지 √(57² + 76²) = 95 이므로 far 105, near = max(10 − 95, 0.01) = 0.01, `d = 10` 에서 105.01 / 104.99 − 2.1 / 1049.9 = 1.000190 − 0.002000 = 0.998190.
- "팬과 회전 뒤" 테스트가 회전을 함께 하는 이유: 팬은 화면 평면 안에서만 움직이므로(`target` 과 eye 가 시선에 수직으로 함께 옮겨 간다) 팬만으로는 어느 점의 깊이도 변하지 않는다. 팬으로 `target` 이 상자 밖으로 나간 뒤 회전해야 상자가 깊이 방향으로 놓이고, 그때 near/far 를 fit 반경 기준으로 잡는 변이가 꼭짓점을 자른다. 이 장면의 수치: `full = [0,0,0] ~ [6,6,0.02]`, 반경 4.2427, `distance` 13.0249, 300px 팬으로 `target` 이 약 5.9m 이동, `farRadius` 약 10.1(`2 × 반경` = 8.49 보다 크고 `distance` 보다 작다).

```ts
// orbit: Z-up 궤도 카메라. 상수와 기지 값은 손으로 계산했고(주석에 근거),
// 나머지는 화면 투영 성질(project 결과)로 확인한다.
import { describe, expect, it } from 'vitest';
import { project, transformPoint } from '../mat4';
import type { Vec3 } from '../mat4';
import {
  ELEVATION_LIMIT, FOVY, MIN_FIT_RADIUS_M, PRESET_ANGLES, ROTATE_RAD_PER_PX, ZOOM_MAX_FACTOR, ZOOM_MIN_FACTOR,
  eyeOf, fitToBounds, pan, rotate, viewProj, zoom,
} from '../orbit';
import type { Bounds, OrbitState, ViewPreset } from '../orbit';

// 뷰어 영역 비율 4 : 3 (CSS px)
const W = 640;
const H = 480;
const ASPECT = W / H;
const PRESETS: ViewPreset[] = ['iso', 'top', 'front'];

// 손으로 계산한 라디안 값
const RAD_40 = 0.698131700798;
const RAD_89_9 = 1.569050997543; // 90도(1.570796326795) - 0.1도(0.001745329252)
const RAD_55 = 0.959931088597;
const RAD_20 = 0.349065850399;
const RAD_90 = 1.570796326795;
const RAD_5 = 0.0872664626;

const FLOOR: Bounds = { min: [0, 0, 0], max: [6, 8, 0] }; // 대각선 10 -> 반경 5
const ROOM: Bounds = { min: [10, 20, 1], max: [13, 24, 13] }; // 대각선 sqrt(9 + 16 + 144) = 13 -> 반경 6.5

function corners(b: Bounds): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
  }
  return out;
}
function frozen(s: OrbitState): OrbitState {
  Object.freeze(s.target);
  return Object.freeze(s);
}
function at(m: Float32Array, p: Vec3) {
  const r = project(m, p, W, H);
  if (r === null) throw new Error(`카메라 뒤: ${p.join(', ')}`);
  return r;
}

describe('상수 (스펙 2.4)', () => {
  it('FOVY 40도, 고도 제한 89.9도, 회전 1px 당 0.005rad, 줌 제한 0.02R ~ 20R, 반경 하한 0.5m', () => {
    expect(FOVY).toBeCloseTo(RAD_40, 9);
    expect(ELEVATION_LIMIT).toBeCloseTo(RAD_89_9, 9);
    expect(ROTATE_RAD_PER_PX).toBe(0.005);
    expect(ZOOM_MIN_FACTOR).toBe(0.02);
    expect(ZOOM_MAX_FACTOR).toBe(20);
    expect(MIN_FIT_RADIUS_M).toBe(0.5);
  });

  it('프리셋 각도: 등각 -55도 / 20도, 평면 -90도 / 89.9도, 정면 -90도 / 5도', () => {
    expect(PRESET_ANGLES.iso.azimuth).toBeCloseTo(-RAD_55, 9);
    expect(PRESET_ANGLES.iso.elevation).toBeCloseTo(RAD_20, 9);
    expect(PRESET_ANGLES.top.azimuth).toBeCloseTo(-RAD_90, 9);
    expect(PRESET_ANGLES.top.elevation).toBeCloseTo(RAD_89_9, 9); // 90도가 아니다(up 과 퇴화 방지)
    expect(PRESET_ANGLES.front.azimuth).toBeCloseTo(-RAD_90, 9);
    expect(PRESET_ANGLES.front.elevation).toBeCloseTo(RAD_5, 9);
  });
});

describe('eyeOf: eye = target + distance * (cos e cos a, cos e sin a, sin e)', () => {
  const base = { target: [1, 2, 3] as Vec3, distance: 2, fovy: FOVY, radius: 1 };
  const eye = (azimuth: number, elevation: number) => eyeOf({ ...base, azimuth, elevation });
  const expectEye = (got: Vec3, want: Vec3) => want.forEach((v, i) => expect(got[i], `eye[${i}]`).toBeCloseTo(v, 9));

  it('방위 0, 고도 0 이면 +x 쪽', () => expectEye(eye(0, 0), [3, 2, 3]));
  it('방위 90도면 +y 쪽', () => expectEye(eye(Math.PI / 2, 0), [1, 4, 3]));
  it('방위 -90도면 -y 쪽', () => expectEye(eye(-Math.PI / 2, 0), [1, 0, 3]));
  it('고도 90도면 +z 쪽(Z-up)', () => expectEye(eye(0, Math.PI / 2), [1, 2, 5]));
  it('방위 60도, 고도 30도', () => {
    // cos 30 = 0.8660254, sin 30 = 0.5, cos 60 = 0.5, sin 60 = 0.8660254
    // 2 * (0.8660254 * 0.5, 0.8660254 * 0.8660254, 0.5) = (0.8660254, 1.5, 1)
    expectEye(eye(Math.PI / 3, Math.PI / 6), [1.8660254038, 3.5, 4]);
  });
});

describe('fitToBounds', () => {
  it('target = 중심, radius = 대각선 / 2, distance = radius / sin(FOVY / 2) * 1.05', () => {
    // sin(20도) = 0.3420201433. 5 / 0.3420201433 = 14.6190220, * 1.05 = 15.3499731
    const s = fitToBounds(FLOOR, 'iso');
    expect(s.target).toEqual([3, 4, 0]);
    expect(s.radius).toBeCloseTo(5, 9);
    expect(s.distance).toBeCloseTo(15.3499731, 6);
    expect(s.fovy).toBe(FOVY);
    // 6.5 / 0.3420201433 * 1.05 = 19.9549650
    const r = fitToBounds(ROOM, 'top');
    expect(r.target).toEqual([11.5, 22, 7]);
    expect(r.radius).toBeCloseTo(6.5, 9);
    expect(r.distance).toBeCloseTo(19.954965, 6);
  });

  it.each(PRESETS)('프리셋 %s 의 각도를 쓴다', (preset) => {
    const s = fitToBounds(FLOOR, preset);
    expect(s.azimuth).toBe(PRESET_ANGLES[preset].azimuth);
    expect(s.elevation).toBe(PRESET_ANGLES[preset].elevation);
  });

  it('반경 하한 0.5m: 작은 범위와 한 점 범위', () => {
    // 대각선 sqrt(0.04 + 0.01) = 0.2236 -> 반 0.1118 < 0.5. distance = 0.5 / 0.3420201433 * 1.05 = 1.5349973
    const s = fitToBounds({ min: [1, 1, 1], max: [1.2, 1.1, 1] }, 'iso');
    expect(s.radius).toBe(0.5);
    expect(s.distance).toBeCloseTo(1.5349973, 6);
    expect(s.target[0]).toBeCloseTo(1.1, 9);
    expect(s.target[1]).toBeCloseTo(1.05, 9);
    expect(s.target[2]).toBeCloseTo(1, 9);
    const p = fitToBounds({ min: [2, 3, 4], max: [2, 3, 4] }, 'top');
    expect(p.radius).toBe(0.5);
    expect(p.distance).toBeCloseTo(1.5349973, 6);
  });

});

describe('fit 뒤 화면 투영', () => {
  it.each(PRESETS)('%s: fit 범위 8꼭짓점이 전부 화면 안이고 target 은 화면 중앙이다', (preset) => {
    for (const fit of [FLOOR, ROOM, { min: [0, 0, 0], max: [30, 20, 0.05] } as Bounds]) {
      const s = fitToBounds(fit, preset);
      const m = viewProj(s, ASPECT, fit);
      for (const c of corners(fit)) {
        const p = project(m, c, W, H);
        expect(p, `꼭짓점 ${c.join(', ')}`).not.toBeNull();
        expect(p!.x).toBeGreaterThanOrEqual(0);
        expect(p!.x).toBeLessThanOrEqual(W);
        expect(p!.y).toBeGreaterThanOrEqual(0);
        expect(p!.y).toBeLessThanOrEqual(H);
      }
      const t = at(m, s.target);
      expect(t.x).toBeCloseTo(W / 2, 1);
      expect(t.y).toBeCloseTo(H / 2, 1);
      expect(t.w / s.distance).toBeCloseTo(1, 4); // w = 카메라 전방 거리
    }
  });

  it('평면 시점: +x 가 화면 오른쪽, +y 가 화면 위', () => {
    const s = fitToBounds(FLOOR, 'top');
    const m = viewProj(s, ASPECT, FLOOR);
    const c = at(m, [3, 4, 0]);
    const px = at(m, [4, 4, 0]);
    const py = at(m, [3, 5, 0]);
    expect(px.x - c.x).toBeGreaterThan(10);
    expect(Math.abs(px.y - c.y)).toBeLessThan(1);
    expect(c.y - py.y).toBeGreaterThan(10); // 화면 위 = y 감소
    expect(Math.abs(py.x - c.x)).toBeLessThan(1);
  });

  it('정면 시점: +x 가 화면 오른쪽, +z 가 화면 위', () => {
    const s = fitToBounds(FLOOR, 'front');
    const m = viewProj(s, ASPECT, FLOOR);
    const c = at(m, [3, 4, 0]);
    const px = at(m, [4, 4, 0]);
    const pz = at(m, [3, 4, 1]);
    expect(px.x - c.x).toBeGreaterThan(10);
    expect(Math.abs(px.y - c.y)).toBeLessThan(1);
    expect(c.y - pz.y).toBeGreaterThan(10);
    expect(Math.abs(pz.x - c.x)).toBeLessThan(1);
  });

  it('등각 시점: 카메라는 남동쪽 위에 있다. +x 와 +y 가 화면 오른쪽, +z 가 화면 위', () => {
    const s = fitToBounds(FLOOR, 'iso');
    const m = viewProj(s, ASPECT, FLOOR);
    const c = at(m, [3, 4, 0]);
    expect(at(m, [4, 4, 0]).x - c.x).toBeGreaterThan(10);
    expect(at(m, [3, 5, 0]).x - c.x).toBeGreaterThan(10);
    expect(c.y - at(m, [3, 4, 1]).y).toBeGreaterThan(10);
    const eye = eyeOf(s);
    expect(eye[0]).toBeGreaterThan(3); // 동쪽
    expect(eye[1]).toBeLessThan(4); // 남쪽
    expect(eye[2]).toBeGreaterThan(0); // 위
  });
});

describe('rotate', () => {
  const s0 = fitToBounds(FLOOR, 'iso');

  it('오른쪽으로 끌면 방위가 줄고 아래로 끌면 고도가 는다(1px 당 0.005rad)', () => {
    const r = rotate(s0, 10, 0);
    expect(r.azimuth).toBeCloseTo(s0.azimuth - 0.05, 12);
    expect(r.elevation).toBe(s0.elevation);
    const d = rotate(s0, 0, 10);
    expect(d.elevation).toBeCloseTo(s0.elevation + 0.05, 12);
    expect(d.azimuth).toBe(s0.azimuth);
    const both = rotate(s0, -4, -6);
    expect(both.azimuth).toBeCloseTo(s0.azimuth + 0.02, 12);
    expect(both.elevation).toBeCloseTo(s0.elevation - 0.03, 12);
  });

  it('target, distance, radius, fovy 는 그대로다', () => {
    const r = rotate(s0, 33, -12);
    expect(r.target).toEqual(s0.target);
    expect(r.distance).toBe(s0.distance);
    expect(r.radius).toBe(s0.radius);
    expect(r.fovy).toBe(s0.fovy);
  });

  it('화면에서: 카메라 쪽(앞쪽) 점이 끈 방향으로 따라온다', () => {
    // 정면 시점의 카메라는 -y 쪽에 있다. target 보다 카메라에 가까운 점 (3, 2, 0)
    const s = fitToBounds(FLOOR, 'front');
    const near: Vec3 = [3, 2, 0];
    const before = at(viewProj(s, ASPECT, FLOOR), near);
    const right = at(viewProj(rotate(s, 40, 0), ASPECT, FLOOR), near);
    expect(right.x - before.x).toBeGreaterThan(5);
    const down = at(viewProj(rotate(s, 0, 40), ASPECT, FLOOR), near);
    expect(down.y - before.y).toBeGreaterThan(5);
  });

  it('고도는 +-89.9도로 제한된다', () => {
    const flat = { ...s0, elevation: 0 };
    expect(rotate(flat, 0, 300).elevation).toBeCloseTo(1.5, 12); // 300 * 0.005 = 1.5 < 1.56905, 제한 안쪽
    expect(rotate(flat, 0, 314).elevation).toBeCloseTo(RAD_89_9, 9); // 1.57 > 1.56905
    expect(rotate(flat, 0, 1e6).elevation).toBeCloseTo(RAD_89_9, 9);
    expect(rotate(flat, 0, -300).elevation).toBeCloseTo(-1.5, 12);
    expect(rotate(flat, 0, -1e6).elevation).toBeCloseTo(-RAD_89_9, 9);
  });

  it('제한에 걸린 뒤에도 화면이 퇴화하지 않는다(행렬이 유한하고 target 이 중앙)', () => {
    const m = viewProj(rotate(s0, 0, 1e6), ASPECT, FLOOR);
    expect(Array.from(m).every(Number.isFinite)).toBe(true);
    const t = at(m, s0.target);
    expect(t.x).toBeCloseTo(W / 2, 1);
    expect(t.y).toBeCloseTo(H / 2, 1);
    // 꼭대기에서도 오른쪽 축이 살아 있다: 방위 -55도에서 +x 는 화면 오른쪽
    expect(at(m, [4, 4, 0]).x - t.x).toBeGreaterThan(10);
  });
});

describe('zoom', () => {
  const s0 = fitToBounds(FLOOR, 'iso'); // radius 5, distance 15.3499731

  it('distance 에 factor 를 곱한다', () => {
    expect(zoom(s0, 0.5).distance).toBeCloseTo(7.67498655, 6);
    expect(zoom(s0, 2).distance).toBeCloseTo(30.6999462, 6);
  });

  it('[0.02R, 20R] 로 제한된다', () => {
    // R = 5 -> [0.1, 100]
    expect(zoom(s0, 1e-6).distance).toBeCloseTo(0.1, 12);
    expect(zoom(zoom(s0, 1e-6), 0.5).distance).toBeCloseTo(0.1, 12);
    expect(zoom(s0, 1e6).distance).toBeCloseTo(100, 12);
    expect(zoom(zoom(s0, 1e6), 2).distance).toBeCloseTo(100, 12);
  });

  it('radius, target, 각도는 그대로다(줌 제한의 기준이 변하지 않는다)', () => {
    const z = zoom(s0, 0.25);
    expect(z.radius).toBe(5);
    expect(z.target).toEqual(s0.target);
    expect(z.azimuth).toBe(s0.azimuth);
    expect(z.elevation).toBe(s0.elevation);
  });
});

describe('pan', () => {
  it.each(PRESETS)('%s: 잡은 지점이 포인터를 따라온다(옛 target 이 화면에서 (dx, dy) 만큼 움직인다)', (preset) => {
    const s = fitToBounds(FLOOR, preset);
    const p = pan(s, 30, -20, H);
    const moved = at(viewProj(p, ASPECT, FLOOR), s.target);
    expect(moved.x).toBeCloseTo(W / 2 + 30, 1);
    expect(moved.y).toBeCloseTo(H / 2 - 20, 1);
    expect(p.azimuth).toBe(s.azimuth);
    expect(p.elevation).toBe(s.elevation);
    expect(p.distance).toBe(s.distance);
    expect(p.radius).toBe(s.radius);
  });

  it('m / px 환산은 2 * distance * tan(fovy / 2) / cssHPx 다', () => {
    // 평면 시점의 화면 오른쪽은 +x. 2 * 15.3499731 * 0.3639702343 / 480 = 0.0232788888 m/px
    // 오른쪽으로 100px 끌면 target 은 -x 로 2.32788888 m
    const s = fitToBounds(FLOOR, 'top');
    const p = pan(s, 100, 0, H);
    expect(p.target[0]).toBeCloseTo(3 - 2.32788888, 6);
    expect(p.target[1]).toBeCloseTo(4, 9);
    expect(p.target[2]).toBeCloseTo(0, 9);
    // 높이가 절반인 캔버스에서는 같은 px 이 두 배 거리다
    expect(pan(s, 100, 0, H / 2).target[0]).toBeCloseTo(3 - 4.65577776, 6);
  });
});

describe('viewProj 의 클립 평면', () => {
  // eye = (13, 4, 0) 에서 -x 를 본다. target 까지 10
  const s: OrbitState = { target: [3, 4, 0], distance: 10, azimuth: 0, elevation: 0, fovy: FOVY, radius: 5 };
  const zOverW = (m: Float32Array, p: Vec3) => {
    const c = transformPoint(m, p);
    return c[2] / c[3];
  };

  it('near = distance - farRadius, far = distance + farRadius (farRadius = target 에서 가장 먼 전체 범위 꼭짓점)', () => {
    // 전체 범위 [0, 0, 0] ~ [6, 8, 0]: target 에서 네 꼭짓점까지 전부 5 -> near 5, far 15
    const m = viewProj(s, ASPECT, FLOOR);
    expect(zOverW(m, [8, 4, 0])).toBeCloseTo(-1, 4); // 전방 5 = near
    expect(zOverW(m, [-2, 4, 0])).toBeCloseTo(1, 4); // 전방 15 = far
    // 전방 10: (far + near) / (far - near) - 2 * far * near / ((far - near) * 10) = 2 - 1.5 = 0.5
    const t = transformPoint(m, [3, 4, 0]);
    expect(t[3]).toBeCloseTo(10, 4);
    expect(t[2] / t[3]).toBeCloseTo(0.5, 4);
  });

  it('호출할 때마다 full 로 다시 계산한다. near 의 하한은 distance * 0.001', () => {
    // 전체 범위 [0, 0, 0] ~ [60, 80, 0]: 가장 먼 꼭짓점 (60, 80, 0) 까지 sqrt(57^2 + 76^2) = 95
    // far = 105, near = max(10 - 95, 0.01) = 0.01
    const m = viewProj(s, ASPECT, { min: [0, 0, 0], max: [60, 80, 0] });
    expect(Array.from(m).every(Number.isFinite)).toBe(true);
    expect(zOverW(m, [12.99, 4, 0])).toBeCloseTo(-1, 2); // 전방 0.01
    expect(zOverW(m, [-92, 4, 0])).toBeCloseTo(1, 4); // 전방 105
    const t = transformPoint(m, [3, 4, 0]);
    expect(t[3]).toBeCloseTo(10, 4);
    // 전방 10: 105.01 / 104.99 - 2 * 105 * 0.01 / (104.99 * 10) = 1.000190 - 0.002000 = 0.998190
    expect(t[2] / t[3]).toBeCloseTo(0.99819, 4);
  });

  it('팬과 회전 뒤에도 전체 범위 상자 8꼭짓점의 클립 z 가 [-1, 1] 안이다', () => {
    // 팬은 화면 평면 안에서 움직여 깊이를 바꾸지 않는다. 팬으로 target 이 상자 밖으로 나간 뒤
    // 회전하면 상자가 깊이 방향으로 놓인다. 그때도 잘리지 않아야 한다.
    const full: Bounds = { min: [0, 0, 0], max: [6, 6, 0.02] };
    const s1 = pan(fitToBounds(full, 'iso'), 300, 0, H); // target 이 약 5.9m 옮겨 간다
    expect(Math.hypot(s1.target[0] - 3, s1.target[1] - 3)).toBeGreaterThan(5.5);
    for (let k = 0; k < 12; k++) {
      for (const dy of [-200, 0, 200]) {
        const m = viewProj(rotate(s1, (k * Math.PI) / 6 / ROTATE_RAD_PER_PX, dy), ASPECT, full);
        for (const c of corners(full)) {
          const clip = transformPoint(m, c);
          expect(clip[3], `k=${k} dy=${dy} w`).toBeGreaterThan(0);
          const z = clip[2] / clip[3];
          expect(z, `k=${k} dy=${dy} z`).toBeGreaterThanOrEqual(-1.0001);
          expect(z, `k=${k} dy=${dy} z`).toBeLessThanOrEqual(1.0001);
        }
      }
    }
  });

  it('전체 범위가 한 점이어도 행렬이 유한하다(near = far 로 나누지 않는다)', () => {
    const one: Bounds = { min: [3, 4, 0], max: [3, 4, 0] };
    const m = viewProj(s, ASPECT, one);
    expect(Array.from(m).every(Number.isFinite)).toBe(true);
    const t = at(m, [3, 4, 0]);
    expect(t.x).toBeCloseTo(W / 2, 1);
    expect(t.y).toBeCloseTo(H / 2, 1);
  });
});

describe('fit 은 fit_bounds 기준이다(전체 범위가 수십 m 여도)', () => {
  const fit: Bounds = { min: [20, 15, 0], max: [26, 21, 0.02] };
  const full: Bounds = { min: [0, 0, 0], max: [60, 45, 3] };

  it('radius 와 distance 는 fit 에서만 나온다', () => {
    // 대각선 sqrt(36 + 36 + 0.0004) = 8.4853049 -> 반경 4.2426525, distance = 4.2426525 / 0.3420201433 * 1.05 = 13.0249203
    const s = fitToBounds(fit, 'iso');
    expect(s.target[0]).toBeCloseTo(23, 9);
    expect(s.target[1]).toBeCloseTo(18, 9);
    expect(s.target[2]).toBeCloseTo(0.01, 9);
    expect(s.radius).toBeCloseTo(4.2426525, 6);
    expect(s.distance).toBeCloseTo(13.0249203, 6);
  });

  it.each(PRESETS)('%s: full 은 화면 위치를 바꾸지 않는다(near / far 에만 쓰인다)', (preset) => {
    const s = fitToBounds(fit, preset);
    const withFull = viewProj(s, ASPECT, full);
    const withFit = viewProj(s, ASPECT, fit);
    for (const c of corners(fit)) {
      const a = at(withFull, c);
      const b = at(withFit, c);
      expect(a.x).toBeCloseTo(b.x, 2);
      expect(a.y).toBeCloseTo(b.y, 2);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThanOrEqual(W);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeLessThanOrEqual(H);
    }
  });

  it('평면 시점에서 fit 범위(6m)가 화면 폭의 40% 이상을 차지한다(바닥이 점이 되지 않는다)', () => {
    // 보이는 폭 = 2 * 13.0249 * tan(20도) * (4 / 3) = 12.64m -> 6m 는 47%
    const s = fitToBounds(fit, 'top');
    const m = viewProj(s, ASPECT, full);
    const left = at(m, [20, 18, 0]);
    const right = at(m, [26, 18, 0]);
    expect(right.x - left.x).toBeGreaterThan(0.4 * W);
  });
});

describe('상태 불변', () => {
  it('rotate, zoom, pan, eyeOf, viewProj 는 입력 상태를 바꾸지 않고 새 객체를 돌려준다', () => {
    const s = frozen(fitToBounds(FLOOR, 'iso'));
    const snapshot = JSON.parse(JSON.stringify(s));
    const r = rotate(s, 15, -7);
    const z = zoom(s, 1.3);
    const p = pan(s, 12, 34, H);
    eyeOf(s);
    viewProj(s, ASPECT, FLOOR);
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshot);
    expect(r).not.toBe(s);
    expect(z).not.toBe(s);
    expect(p).not.toBe(s);
    expect(p.target).not.toBe(s.target);
  });

  it('fitToBounds, viewProj 는 Bounds 를 바꾸지 않고 target 이 Bounds 배열을 가리키지 않는다', () => {
    const b: Bounds = { min: [0, 0, 0], max: [6, 8, 0] };
    Object.freeze(b.min);
    Object.freeze(b.max);
    Object.freeze(b);
    const s = fitToBounds(b, 'front');
    viewProj(s, ASPECT, b);
    expect(b).toEqual({ min: [0, 0, 0], max: [6, 8, 0] });
    expect(s.target).not.toBe(b.min);
    expect(s.target).not.toBe(b.max);
  });
});
```

각 테스트가 죽이는 변이:

| 테스트 | 죽이는 변이 |
|---|---|
| `상수` › FOVY 40도, 고도 제한 89.9도, … | 시제품 값으로 되돌림(고도 제한 89°), FOVY·감도·줌 계수·반경 하한 값 변경 |
| `상수` › 프리셋 각도 | 시제품 각도(−60°·36°), 평면 고도 90°, 방위 부호 |
| `eyeOf` 5건 | 방위의 sin 과 cos 교환, 고도 축을 y 로(Y-up), `target` 을 더하지 않음 |
| `fitToBounds` › target = 중심, radius = 대각선 / 2, distance = … | `sin` 을 `tan` 으로, `× 1.05` 누락, 반지름 대신 대각선 전체 |
| `fitToBounds` › 프리셋 %s 의 각도를 쓴다(3건) | 프리셋 인자를 무시하고 항상 등각 |
| `fitToBounds` › 반경 하한 0.5m | `max(…, 0.5)` 제거(작은 범위에서 카메라가 점 속으로 들어감) |
| `fit 뒤 화면 투영` › %s: 8꼭짓점이 전부 화면 안(3건) | `distance` 에서 `/ sin` 누락, `target` 을 fit 최솟값 모서리로 |
| `fit 뒤 화면 투영` › 평면 시점: +x 오른쪽, +y 위 | **평면 프리셋의 방위 변경**(0°, +90°), `lookAt` 의 up 을 Y-up 으로 |
| `fit 뒤 화면 투영` › 정면 시점: +x 오른쪽, +z 위 | 정면 프리셋의 방위 변경(+90° 면 +x 가 왼쪽) |
| `fit 뒤 화면 투영` › 등각 시점 | 등각 방위의 부호(+55°), up 벡터를 `[0, 1, 0]` 으로 |
| `rotate` › 오른쪽으로 끌면 방위가 줄고 아래로 끌면 고도가 는다 | **회전 부호 반전**(방위, 고도 각각), 감도 변경, dx 와 dy 교환 |
| `rotate` › target, distance, radius, fovy 는 그대로다 | 회전이 `target` 이나 `distance` 를 건드림 |
| `rotate` › 화면에서: 앞쪽 점이 끈 방향으로 따라온다 | 회전 부호 반전을 상태값이 아니라 화면 결과로 잡는다 |
| `rotate` › 고도는 +-89.9도로 제한된다 | **고도 clamp 제거**, 제한을 한쪽만 적용, 제한 값을 더 좁게(300px = 1.5rad 가 잘리면 실패) |
| `rotate` › 제한에 걸린 뒤에도 화면이 퇴화하지 않는다 | 제한에 걸린 상태에서 오른쪽 축이 사라지거나 방위가 뒤집힘 |
| `zoom` › distance 에 factor 를 곱한다 | factor 를 나눔, 더함 |
| `zoom` › [0.02R, 20R] 로 제한된다 | **줌 clamp 제거**, 제한 기준을 `radius` 대신 현재 `distance` 로 |
| `zoom` › radius, target, 각도는 그대로다 | 줌이 `radius` 를 함께 줄임(제한 기준이 흘러감) |
| `pan` › %s: 잡은 지점이 포인터를 따라온다(3건) | 팬 dx·dy 부호 반전, 화면 위 벡터를 월드 z 로 고정, 환산에서 `2 ×` 누락 |
| `pan` › m / px 환산은 2 * distance * tan(fovy / 2) / cssHPx 다 | 환산에 폭을 씀, `cssHPx` 를 무시하고 상수로 나눔 |
| `viewProj 의 클립 평면` › near = distance - farRadius, far = distance + farRadius | **near/far 를 radius 기준으로**(시제품식 `distance ± 2 × radius`) |
| `viewProj 의 클립 평면` › 호출할 때마다 full 로 다시 계산한다. near 의 하한 | near 하한 제거(near 가 음수), `farRadius` 를 `target` 이 아니라 상자 중심에서 잼 |
| `viewProj 의 클립 평면` › 팬과 회전 뒤에도 8꼭짓점의 클립 z 가 [-1, 1] 안 | **near/far 를 radius 기준으로(팬 뒤 잘림)**, `farRadius` 가 팬을 따라가지 않음 |
| `viewProj 의 클립 평면` › 전체 범위가 한 점이어도 행렬이 유한하다 | `farRadius === 0` 가드 제거 |
| `fit 은 fit_bounds 기준이다` › radius 와 distance 는 fit 에서만 나온다 | fit 식의 값 변경 |
| `fit 은 fit_bounds 기준이다` › %s: full 은 화면 위치를 바꾸지 않는다(3건) | **fit 을 전체 범위로 맞춤**(`viewProj` 가 `full` 로 거리나 `target` 을 다시 잡음) |
| `fit 은 fit_bounds 기준이다` › 평면 시점에서 fit 범위가 화면 폭의 40% 이상 | 같은 변이를 "바닥이 점이 된다"는 화면 결과로 잡는다 |
| `상태 불변` › rotate, zoom, pan, eyeOf, viewProj 는 입력 상태를 바꾸지 않는다 | 입력 객체나 `target` 배열을 제자리에서 고침(frozen 객체라 TypeError) |
| `상태 불변` › fitToBounds, viewProj 는 Bounds 를 바꾸지 않는다 | `target` 이 `fit.min` 배열을 그대로 가리킴 |

`fitToBounds(fit, preset)` 는 fit 범위만 받으므로 "fit 대신 전체 범위를 넘긴다"는 변이는 호출하는 쪽(T12 `points3d-view.tsx`)에서만 생길 수 있다. 이 태스크의 테스트는 orbit 쪽 절반(`viewProj` 의 `full` 이 화면 위치를 바꾸지 않는다)을 잡는다.

- [ ] **Step 6: 실패 확인**

Run: `cd dashboard && npx vitest run lib/viz/points3d/__tests__/orbit.test.ts`

Expected: FAIL. `Error: Failed to resolve import "../orbit" from "lib/viz/points3d/__tests__/orbit.test.ts". Does the file exist?` 와 `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 7: `orbit.ts` 구현**

`dashboard/lib/viz/points3d/orbit.ts` 를 새로 만든다.

```ts
// 궤도 카메라(Z-up, 원근 투영). 순수 함수이고 상태는 불변이다(항상 새 객체를 돌려준다).
// eye = target + distance * (cos e * cos a, cos e * sin a, sin e)  (a = 방위, e = 고도)
import { lookAt, multiply, perspective } from './mat4';
import type { Vec3 } from './mat4';

export interface Bounds { min: [number, number, number]; max: [number, number, number]; }
// radius = fit 반경(줌 제한의 기준). 줌과 팬으로는 변하지 않는다
export interface OrbitState {
  target: [number, number, number]; distance: number; azimuth: number; elevation: number;
  fovy: number; radius: number;
}
export type ViewPreset = 'iso' | 'top' | 'front';

const DEG = Math.PI / 180;

export const FOVY = 40 * DEG; // 세로 시야각
export const ELEVATION_LIMIT = 89.9 * DEG; // 고도 제한(+-). 90도면 시선이 up 과 나란해져 퇴화한다
export const ROTATE_RAD_PER_PX = 0.005; // 드래그 1 CSS px 당 회전량
export const ZOOM_MIN_FACTOR = 0.02; // 줌 거리 하한 = 0.02 x radius
export const ZOOM_MAX_FACTOR = 20; // 줌 거리 상한 = 20 x radius
export const MIN_FIT_RADIUS_M = 0.5; // fit 반경 하한(m)
// 평면 시점의 고도가 90도가 아니라 89.9도인 이유: up = [0, 0, 1] 과 시선이 나란하면 lookAt 이 퇴화한다
export const PRESET_ANGLES: Record<ViewPreset, { azimuth: number; elevation: number }> = {
  iso: { azimuth: -55 * DEG, elevation: 20 * DEG },
  top: { azimuth: -90 * DEG, elevation: 89.9 * DEG },
  front: { azimuth: -90 * DEG, elevation: 5 * DEG },
};

const FIT_MARGIN = 1.05; // fit 구가 화면 가장자리에 닿지 않게 두는 여유
const NEAR_MIN_FRACTION = 0.001; // near 하한 = distance x 0.001
const UP: Vec3 = [0, 0, 1];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// fit 범위에 맞춘 초기 상태. 시점 버튼도 이 함수를 다시 부른다(팬과 줌 초기화)
export function fitToBounds(fit: Bounds, preset: ViewPreset): OrbitState {
  const target: [number, number, number] = [
    (fit.min[0] + fit.max[0]) / 2,
    (fit.min[1] + fit.max[1]) / 2,
    (fit.min[2] + fit.max[2]) / 2,
  ];
  const diagonal = Math.hypot(fit.max[0] - fit.min[0], fit.max[1] - fit.min[1], fit.max[2] - fit.min[2]);
  const radius = Math.max(diagonal / 2, MIN_FIT_RADIUS_M);
  const { azimuth, elevation } = PRESET_ANGLES[preset];
  return { target, distance: (radius / Math.sin(FOVY / 2)) * FIT_MARGIN, azimuth, elevation, fovy: FOVY, radius };
}

// dxPx, dyPx 는 CSS px. 오른쪽으로 끌면 방위가 줄고 아래로 끌면 고도가 는다
export function rotate(s: OrbitState, dxPx: number, dyPx: number): OrbitState {
  return {
    ...s,
    azimuth: s.azimuth - dxPx * ROTATE_RAD_PER_PX,
    elevation: clamp(s.elevation + dyPx * ROTATE_RAD_PER_PX, -ELEVATION_LIMIT, ELEVATION_LIMIT),
  };
}

// distance 에 factor 를 곱한다(1 보다 작으면 다가간다)
export function zoom(s: OrbitState, factor: number): OrbitState {
  return {
    ...s,
    distance: clamp(s.distance * factor, s.radius * ZOOM_MIN_FACTOR, s.radius * ZOOM_MAX_FACTOR),
  };
}

// 화면 평면 팬. 잡은 지점이 포인터를 따라오도록 target 거리 기준 m / px 로 환산한다.
// 전부 CSS px. cssHPx = canvas.clientHeight
export function pan(s: OrbitState, dxPx: number, dyPx: number, cssHPx: number): OrbitState {
  const metersPerPx = (2 * s.distance * Math.tan(s.fovy / 2)) / cssHPx;
  const sinA = Math.sin(s.azimuth);
  const cosA = Math.cos(s.azimuth);
  const sinE = Math.sin(s.elevation);
  const cosE = Math.cos(s.elevation);
  const right: Vec3 = [-sinA, cosA, 0]; // 화면 오른쪽
  const up: Vec3 = [-sinE * cosA, -sinE * sinA, cosE]; // 화면 위
  return {
    ...s,
    target: [
      s.target[0] + (-dxPx * right[0] + dyPx * up[0]) * metersPerPx,
      s.target[1] + (-dxPx * right[1] + dyPx * up[1]) * metersPerPx,
      s.target[2] + (-dxPx * right[2] + dyPx * up[2]) * metersPerPx,
    ],
  };
}

export function eyeOf(s: OrbitState): [number, number, number] {
  const cosE = Math.cos(s.elevation);
  return [
    s.target[0] + s.distance * cosE * Math.cos(s.azimuth),
    s.target[1] + s.distance * cosE * Math.sin(s.azimuth),
    s.target[2] + s.distance * Math.sin(s.elevation),
  ];
}

// 파일-로컬 좌표 -> 클립 좌표. full = [0, 0, 0] ~ extent_m (표본 전체 범위).
// near / far 는 호출할 때마다 full 에서 다시 계산한다: 팬으로 target 이 움직여도 표본 전체가 잘리지 않는다
export function viewProj(s: OrbitState, aspect: number, full: Bounds): Float32Array {
  let farRadius = 0; // target 에서 전체 범위 상자의 가장 먼 꼭짓점까지
  for (let i = 0; i < 8; i++) {
    const dx = (i & 1 ? full.max[0] : full.min[0]) - s.target[0];
    const dy = (i & 2 ? full.max[1] : full.min[1]) - s.target[1];
    const dz = (i & 4 ? full.max[2] : full.min[2]) - s.target[2];
    farRadius = Math.max(farRadius, Math.hypot(dx, dy, dz));
  }
  // 전체 범위가 target 한 점이면 near = far 가 돼 투영 행렬이 NaN 이 된다. 그때만 fit 반경을 쓴다
  if (farRadius === 0) farRadius = s.radius;
  const far = s.distance + farRadius;
  const near = Math.max(s.distance - farRadius, s.distance * NEAR_MIN_FRACTION);
  return multiply(perspective(s.fovy, aspect, near, far), lookAt(eyeOf(s), s.target, UP));
}
```

- [ ] **Step 8: 통과 확인**

Run: `cd dashboard && npx vitest run lib/viz/points3d`

Expected: PASS. `Test Files  2 passed (2)`, `Tests  56 passed (56)`(mat4 15건 + orbit 41건).

- [ ] **Step 9: 변이 확인(넣고, 죽는 것을 보고, 되돌린다)**

`dashboard/lib/viz/points3d/orbit.ts` 에 아래 변이를 **하나씩** 넣고 `cd dashboard && npx vitest run lib/viz/points3d` 를 돌려 표의 테스트가 실패하는지 본다. 확인한 뒤 변이를 되돌리고 다음으로 넘어간다. 하나라도 살아남으면(전부 통과하면) 테스트를 잘못 옮긴 것이므로 Step 5 의 코드와 대조한다.

| # | 변이(바꾸기 전 → 바꾼 뒤) | 실패해야 하는 테스트 |
|---|---|---|
| 1 | `azimuth: s.azimuth - dxPx * ROTATE_RAD_PER_PX,` → `azimuth: s.azimuth + dxPx * ROTATE_RAD_PER_PX,` (회전 부호 반전) | `rotate` › 오른쪽으로 끌면 방위가 줄고…, `rotate` › 화면에서: 앞쪽 점이 끈 방향으로 따라온다 (2건) |
| 2 | `elevation: clamp(s.elevation + dyPx * ROTATE_RAD_PER_PX, -ELEVATION_LIMIT, ELEVATION_LIMIT),` → `elevation: s.elevation + dyPx * ROTATE_RAD_PER_PX,` (고도 clamp 제거) | `rotate` › 고도는 +-89.9도로 제한된다 (1건) |
| 3 | `distance: clamp(s.distance * factor, s.radius * ZOOM_MIN_FACTOR, s.radius * ZOOM_MAX_FACTOR),` → `distance: s.distance * factor,` (줌 clamp 제거) | `zoom` › [0.02R, 20R] 로 제한된다 (1건) |
| 4 | `viewProj` 마지막 줄의 `lookAt(eyeOf(s), s.target, UP)` → `lookAt(eyeOf({ ...s, distance: Math.max(s.distance, (farRadius / Math.sin(s.fovy / 2)) * FIT_MARGIN) }), s.target, UP)` (fit 을 전체 범위로 맞춤) | `fit 은 fit_bounds 기준이다` 의 `full 은 화면 위치를 바꾸지 않는다` 3건과 `화면 폭의 40% 이상`, `pan` 의 `잡은 지점이 포인터를 따라온다` 3건, `viewProj 의 클립 평면` 앞 3건 (10건) |
| 5 | `const far = s.distance + farRadius;` → `const far = s.distance + s.radius * 2;` 그리고 `Math.max(s.distance - farRadius, s.distance * NEAR_MIN_FRACTION)` → `Math.max(s.distance - s.radius * 2, s.distance * NEAR_MIN_FRACTION)` (near/far 를 radius 기준으로) | `viewProj 의 클립 평면` › near = distance - farRadius…, 호출할 때마다 full 로 다시 계산한다…, 팬과 회전 뒤에도… (3건) |
| 6 | `top: { azimuth: -90 * DEG, elevation: 89.9 * DEG },` → `top: { azimuth: 0 * DEG, elevation: 89.9 * DEG },` (평면 프리셋의 방위 변경) | `상수` › 프리셋 각도, `fit 뒤 화면 투영` › 평면 시점: +x 가 화면 오른쪽…, `pan` › m / px 환산…, `fit 은 fit_bounds 기준이다` › 화면 폭의 40% 이상 (4건) |

변이를 전부 되돌린 뒤 `git diff --stat` 에 변이 흔적이 없는지 확인하고(새 파일 4개는 아직 추적 전이라 `git status --short` 에 `??` 로만 보인다) Step 8 의 명령을 한 번 더 돌려 56건 통과를 다시 본다.

- [ ] **Step 10: 타입 검사와 전체 스위트**

Run: `cd dashboard && npx tsc --noEmit`

Expected: 출력 없음, 종료 코드 0.

Run: `cd dashboard && npx vitest run`

Expected: 실패 0건. 이 태스크로 테스트 파일 2개와 테스트 56건이 늘어난다(2026-10-02 기준선 84파일 769건에 앞 태스크가 더한 수 + 2파일 56건). `__tests__/palette-sweep.test.ts` 가 고치지 않은 채 통과해야 한다(새 파일 4개가 `lib/` 아래라 검사 대상에 들어간다).

- [ ] **Step 11: 커밋**

```bash
cd D:/Projects/Flatness
git add dashboard/lib/viz/points3d/mat4.ts dashboard/lib/viz/points3d/orbit.ts dashboard/lib/viz/points3d/__tests__/mat4.test.ts dashboard/lib/viz/points3d/__tests__/orbit.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): 3D 점군 뷰어의 행렬 유틸과 궤도 카메라(mat4, orbit)

- mat4: 열 우선 4x4 행렬(perspective, lookAt, multiply, transformPoint, project). project 는 클립 w 를 함께 돌려준다
- orbit: Z-up 궤도 카메라. 프리셋(등각, 평면, 정면), fit_bounds 맞춤(반경 하한 0.5m), 회전, 줌, 팬
- viewProj 는 호출할 때마다 전체 범위 상자의 가장 먼 꼭짓점으로 near/far 를 다시 잡는다
- 순수 함수이고 상태는 불변이다. DOM 과 WebGL 을 건드리지 않는다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

커밋 뒤 `git status --short` 가 비어 있는지 확인한다(변이 흔적 없음).

**초안 검증 기록(계획 작성 시, 2026-10-02):** 위 네 파일을 `.superpowers/plan-drafts/pointcloud-viewer/scratch-08/lib/viz/points3d/` 에 그대로 두고 저장소의 vitest 4.1.10 을 빌려(`cd dashboard && npx vitest run --root <스크래치>`, jsdom 환경) 돌렸다. 구현 전 실패(import 해석 실패) → 구현 후 56건 통과, 저장소의 `tsc --noEmit`(스크래치 tsconfig) 종료 코드 0, eslint(stdin) 경고 0. 변이 39종(Step 9 의 6종 포함: 행렬 배치·손잡이, 회전·팬 부호, clamp 제거, 프리셋 각도, near/far, 반경 하한, 상수 값, 제자리 수정)을 하나씩 넣어 전부 죽는 것을 확인했다(`scratch-08/mutate.mjs`). 저장소 안 `dashboard/` 에서 직접 돌린 것은 아니므로 Step 2·6 의 오류 문구에 찍히는 경로는 스크래치 실행에서 본 문구를 저장소 경로로 옮겨 적은 것이다.

**재검증 기록(2026-10-03, 중단된 작업을 이어서 확인):** 스크래치의 네 파일이 위 코드 블록 넷과 바이트 단위로 같은지 먼저 대조했고(전부 같음), 그 상태에서 다시 돌렸다. (1) `cd dashboard && npx vitest run --root <scratch-08>`: `Test Files 2 passed (2)`, `Tests 56 passed (56)`. (2) `npx tsc --noEmit -p <scratch-08>/tsconfig.json`: 종료 코드 0. (3) red 단계 재현: `orbit.ts` 를 잠시 치우고 `orbit.test.ts` 만 돌려 `Error: Failed to resolve import "../orbit" from ".../__tests__/orbit.test.ts". Does the file exist?`, `Test Files 1 failed (1)`, `Tests no tests` 를 확인한 뒤 되돌렸다(Step 6 의 기대 문구와 같다). (4) 변이 39종(`scratch-08/mutate.mjs`, 기록 `scratch-08/mutate-rerun.log`): `생존 0 / 39`. Step 9 의 6종은 각각 표에 적은 테스트가 실패했다(예: 평면 프리셋 방위 변경 → `상수 › 프리셋 각도`, `평면 시점: +x 가 화면 오른쪽`, `pan › m / px 환산`, `화면 폭의 40% 이상` 4건). (5) 손으로 적은 기대값을 파이썬(`math`)으로 독립 재계산해 전부 일치: 라디안 5개, `sin 20°`·`tan 20°`, FLOOR·ROOM·반경 하한의 `distance`(15.3499731 / 19.9549650 / 1.5349973), 줌 두 값, 팬 환산 0.0232788888 m/px 과 100px·H/2 값, 클립 z/w 두 경우(0.5, 0.998190), fit 대각선·반경·`distance`(8.4853049 / 4.2426525 / 13.0249203), 보이는 폭 12.64m(6m 는 47%), 팬+회전 장면의 `farRadius` 10.13 > 2R 8.49, `eyeOf(60°, 30°)`, 314px × 0.005 = 1.57 > 89.9° 라디안. (6) 새 파일 4개에 `palette-sweep.test.ts` 의 정규식 `\b(zinc|amber|red|green|emerald|purple|blue)-[0-9]{2,3}\b` 0건, T14 litmus 가 금지하는 판정 기준 필드 이름 4개 0건, U+2014 0건. 저장소의 추적 파일은 건드리지 않았다(`git status --short` 비어 있음).

---
### Task 9: 뷰 순수 모듈: `scaffold.ts` + `budget.ts` (격자·축·라벨, 점 크기·LOD)

**Files:**
- Create: `dashboard/lib/viz/points3d/scaffold.ts`
- Create: `dashboard/lib/viz/points3d/budget.ts`
- Modify: 없음
- Test: `dashboard/lib/viz/points3d/__tests__/scaffold.test.ts` (신설, 40건)
- Test: `dashboard/lib/viz/points3d/__tests__/budget.test.ts` (신설, 16건)

**Interfaces:**
- Consumes (Task 8 이 만든 것. 이 태스크는 고치지 않는다):
  - `dashboard/lib/viz/points3d/orbit.ts`: `export interface Bounds { min: [number, number, number]; max: [number, number, number]; }`
  - `dashboard/lib/viz/points3d/mat4.ts`: `export type Vec3 = [number, number, number];`, `export function project(m: Float32Array, p: Vec3, cssW: number, cssH: number): { x: number; y: number; w: number } | null;` (클립 w <= 0 이면 null. x·y 는 CSS px, 왼쪽 위 원점, y 는 아래로 증가. `m` 은 열 우선 `Float32Array(16)`)
  - 테스트에서만: `orbit.ts` 의 `fitToBounds(fit: Bounds, preset: ViewPreset): OrbitState` (`ViewPreset = 'iso' | 'top' | 'front'`, `OrbitState` 에 `target: [number, number, number]` 와 `distance: number` 가 있다), `viewProj(s: OrbitState, aspect: number, full: Bounds): Float32Array`
- Produces (Task 11·12 가 이 이름과 타입 그대로 쓴다):
  - scaffold.ts: `export const MAX_GRID_LINES = 40;` `export const LABEL_MIN_GAP_PX = 28;` `export const MIN_AXIS_RANGE_M = 0.1;` `export const AXIS_NAME_OFFSET_FRAC = 0.08;`
  - scaffold.ts: `export function niceStep(rangeX: number, rangeY: number, maxLines?: number): number;` (기본 40)
  - scaffold.ts: `export interface AxisTick { axis: 'x' | 'y'; pos: [number, number, number]; text: string; kind: 'tick' | 'name'; }` `export interface PlacedLabel { axis: 'x' | 'y'; kind: 'tick' | 'name'; text: string; x: number; y: number; }`
  - scaffold.ts: `export function buildScaffold(fit: Bounds): { verts: Float32Array; gridVertCount: number; axisVertCount: number; ticks: AxisTick[]; step: number };` - verts 는 xyz 3개씩(파일-로컬 m). 앞 `gridVertCount` 정점이 격자 LINES, 이어지는 `axisVertCount`(= 4) 정점이 축선 LINES. `ticks` 는 x 눈금(i 오름차순), y 눈금(j 오름차순), x 이름, y 이름 순
  - scaffold.ts: `export function layoutLabels(ticks: AxisTick[], viewProj: Float32Array, cssW: number, cssH: number): PlacedLabel[];` (x·y 는 CSS px. 숨긴 라벨은 결과에 없다. 입력 순서를 유지한다)
  - budget.ts: `export const POINT_SIZE_FACTOR = 0.55;` `export const MIN_POINT_CSS_PX = 1.5;` `export const LOD_START = 150_000;` `export const LOD_FLOOR = 20_000;` `export const LOD_SLOW_MS = 33;` `export const LOD_FAST_MS = 20;`
  - budget.ts: `export function pointWorldSizeM(sampleCellM: number): number;` `export function pxPerUnit(bufferHPx: number, fovy: number): number;` `export function pointSizeRange(aliasedRange: [number, number], bufferScale: number): [number, number];` `export function initialDragCount(n: number): number;` `export function nextDragCount(prev: number, n: number, frameMs: number): number;`

**이 태스크가 지켜야 할 규칙(스펙 `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.4, §7.2, §7.4, §7.8):**

- 두 모듈은 DOM·WebGL·React·Next.js API 를 쓰지 않는 순수 함수다. 그래서 `dashboard/node_modules/next/dist/docs/` 에서 확인할 관례가 없다. `'use client'` 도 붙이지 않는다.
- 좌표는 전부 **파일-로컬 m**(점 파일의 로컬 좌표)다. `fit` 은 편차 있는 점의 범위(`fit_bounds`)다.
- 격자 범위는 `fit` 의 XY 범위다. 범위가 0.1m 보다 작은 축은 `fit.min` 을 고정하고 max 쪽을 `fit.min + 0.1` 로 늘려 0.1m 로 본다. 간격 계산, 격자선, 축선, 눈금, 축 이름이 **전부 이 보정 범위**를 쓴다.
- 간격(step)은 `{1, 2, 5} × 10^p` m 수열(최소 0.01m)에서 `floor(rangeX / step) + floor(rangeY / step) + 2 <= 40` 을 만족하는 가장 작은 값이다.
- 격자선은 `x = fit.min.x + i × step`(`i = 0 .. floor(rangeX / step)`), `y = fit.min.y + j × step`(`j = 0 .. floor(rangeY / step)`). 선은 `fit.min` 에서 `fit.max` 까지 뻗는다. 범위가 step 의 배수가 아니면 **먼 쪽 가장자리에는 선이 없다**(`fit.max` 에 선을 추가하지 않는다). 높이는 `z = fit.min.z`.
- 축선은 두 변이다: x축 변(`y = fit.min.y`), y축 변(`x = fit.min.x`). 같은 높이.
- 눈금 숫자는 **fit 최솟값 모서리를 0 으로 한 값** `i × step` 이다(절대 좌표가 아니다). 자릿수는 `step >= 1` 이면 정수, 아니면 step 의 유효 소수 자릿수(0.5 → 1자리 `0.0`, `0.5`, ... / 0.05 → 2자리). z축 눈금은 만들지 않는다.
- 축 이름은 `x (m)`, `y (m)`. 변의 중점에서 바깥쪽으로 `AXIS_NAME_OFFSET_FRAC × max(rangeX, rangeY)` 만큼 띄운다(x 이름은 `y = fit.min.y − off`, y 이름은 `x = fit.min.x − off`, `z = fit.min.z`). 스펙이 거리 값을 정하지 않아 이 상수로 두었다. Task 16 의 화면 캡처 대조에서 겹치면 이 상수만 조정한다.
- 라벨 배치: 월드 위치를 `project` 로 화면에 옮긴다. 카메라 뒤(`project` 가 null)이거나 영역 밖(`x < 0`, `x > cssW`, `y < 0`, `y > cssH`)이면 숨긴다. 같은 축에서 **직전에 남긴** 눈금과 화면 거리 28px 미만이면 건너뛴다. 축 이름은 솎지 않고 솎기 기준에도 넣지 않는다.
- 픽셀 단위: `cssW`·`cssH`·라벨 좌표는 CSS px. `pxPerUnit` 의 `bufferHPx` 와 `pointSizeRange` 의 결과는 **드로잉 버퍼 px**(`canvas.height`, `gl_PointSize` 와 같은 단위)다. 둘은 드로잉 버퍼 배율(`min(devicePixelRatio, 2)`)만큼 다르다.
- 부동소수 함정: `0.3 / 0.1` 은 `2.9999999999999996` 이라 그대로 floor 하면 선이 하나 모자란다. `Math.floor(range / step + 1e-9)` 를 간격 계산과 격자 생성이 **같은 함수**로 쓴다.
- 코드 주석은 한국어. 주석·문자열에 U+2014, `색이름-숫자` 꼴 표기, 판정 기준 필드 이름을 쓰지 않는다(저장소의 소스 검사 테스트가 잡는다).

- [ ] **Step 1: 선행 조건 확인(Task 8 산출물)**

Run:

```bash
cd D:/Projects/Flatness/dashboard && ls lib/viz/points3d && grep -nE "export (function (project|fitToBounds|viewProj)|interface (Bounds|OrbitState))" lib/viz/points3d/mat4.ts lib/viz/points3d/orbit.ts
```

Expected: `mat4.ts`, `orbit.ts`, `__tests__` 가 보이고 grep 이 `project`(mat4.ts), `Bounds`·`OrbitState`·`fitToBounds`·`viewProj`(orbit.ts) 다섯 줄을 낸다. 하나라도 없으면 Task 8 이 끝나지 않은 것이므로 멈추고 보고한다.

- [ ] **Step 2: budget 의 실패하는 테스트 작성**

`dashboard/lib/viz/points3d/__tests__/budget.test.ts` 를 아래 내용으로 만든다. 각 테스트 위 주석이 그 테스트가 죽이는 변이와 기대값의 계산 근거다.

```ts
// 점 크기 식과 드래그 중 점 수(LOD) 조정(스펙 §2.4, §7.2, §7.4). 기대값은 손으로 계산했다.
import { describe, expect, it } from 'vitest';
import {
  LOD_FAST_MS, LOD_FLOOR, LOD_SLOW_MS, LOD_START, MIN_POINT_CSS_PX, POINT_SIZE_FACTOR,
  initialDragCount, nextDragCount, pointSizeRange, pointWorldSizeM, pxPerUnit,
} from '../budget';

describe('상수', () => {
  // 변이: 상수 값 변경(Task 11·12 가 이 이름으로 읽는다. 아래 테스트는 리터럴로 단언하므로 그쪽도 함께 죽는다)
  it('스펙 §2.4 의 값', () => {
    expect(POINT_SIZE_FACTOR).toBe(0.55);
    expect(MIN_POINT_CSS_PX).toBe(1.5);
    expect(LOD_START).toBe(150_000);
    expect(LOD_FLOOR).toBe(20_000);
    expect(LOD_SLOW_MS).toBe(33);
    expect(LOD_FAST_MS).toBe(20);
  });
});

describe('점 크기', () => {
  // 0.55 x 0.0125 = 0.006875, 0.55 x 0.02 = 0.011. 변이: 계수를 0.5 로, sample_cell_m 을 곱하지 않음
  it('pointWorldSizeM 은 0.55 x sample_cell_m', () => {
    expect(pointWorldSizeM(0.0125)).toBeCloseTo(0.006875, 12);
    expect(pointWorldSizeM(0.02)).toBeCloseTo(0.011, 12);
  });
  // fovy 90도: tan(45도) = 1 이라 960 / 2 = 480
  // 변이: tan(fovy / 2) 를 tan(fovy) 로(90도에서 발산), 분모의 2 누락(960)
  it('pxPerUnit(960, 90도) = 480', () => {
    expect(pxPerUnit(960, Math.PI / 2)).toBeCloseTo(480, 9);
  });
  // fovy 40도: tan(20도) = 0.3639702343 -> 960 / (2 x 0.3639702343) = 1318.789
  // 변이: tan 을 sin 으로(960 / (2 x sin 20도) = 1403.5), 분모의 2 누락(2637.6)
  it('pxPerUnit(960, 40도) = 1318.789', () => {
    expect(pxPerUnit(960, (40 * Math.PI) / 180)).toBeCloseTo(1318.789, 3);
  });
  // 버퍼 높이에 비례한다: 480px 은 960px 의 절반. 변이: bufferHPx 를 쓰지 않고 고정 높이를 씀
  it('버퍼 높이에 비례한다', () => {
    expect(pxPerUnit(480, Math.PI / 2)).toBeCloseTo(240, 9);
  });
  // 변이: minPx 에 배율 미적용(배율 2 에서 1.5 가 나온다)
  it('pointSizeRange 의 최소는 1.5 x 배율, 최대는 ALIASED_POINT_SIZE_RANGE 의 상한', () => {
    expect(pointSizeRange([1, 1024], 1)).toEqual([1.5, 1024]);
    expect(pointSizeRange([1, 1024], 2)).toEqual([3, 1024]);
    expect(pointSizeRange([1, 1024], 1.25)).toEqual([1.875, 1024]);
  });
  // 변이: min(…, maxPx) 제거(최소가 최대보다 커진다)
  it('최소가 최대보다 크면 최대에 맞춘다', () => {
    expect(pointSizeRange([1, 2], 2)).toEqual([2, 2]);
    expect(pointSizeRange([1, 1], 1)).toEqual([1, 1]);
  });
});

describe('LOD', () => {
  // 변이: min(n, 150_000) 을 n 으로(상한 없음), 또는 150_000 고정(n = 12 에서 150_000)
  it('initialDragCount 는 min(n, 150_000)', () => {
    expect(initialDragCount(200_000)).toBe(150_000);
    expect(initialDragCount(150_000)).toBe(150_000);
    expect(initialDragCount(12)).toBe(12);
  });
  // 변이: 증감 계수 교환(34ms 에서 125_000, 19ms 에서 70_000 이 나온다)
  it('34ms 면 x0.7, 19ms 면 x1.25, 25ms 면 그대로', () => {
    expect(nextDragCount(100_000, 200_000, 34)).toBe(70_000);
    expect(nextDragCount(100_000, 200_000, 19)).toBe(125_000);
    expect(nextDragCount(100_000, 200_000, 25)).toBe(100_000);
  });
  // 변이: > 33 을 >= 33 으로, < 20 을 <= 20 으로
  it('경계값 33ms 와 20ms 에서는 그대로', () => {
    expect(nextDragCount(100_000, 200_000, 33)).toBe(100_000);
    expect(nextDragCount(100_000, 200_000, 20)).toBe(100_000);
  });
  // 30_001 x 0.7 = 21_000.7 -> 21_001. 변이: 반올림 대신 버림(21_000)
  it('반올림한다', () => {
    expect(nextDragCount(30_001, 200_000, 34)).toBe(21_001);
  });
  // 25_000 x 0.7 = 17_500 -> 하한 20_000. 변이: 하한 clamp 제거
  it('하한은 min(n, 20_000)', () => {
    expect(nextDragCount(25_000, 200_000, 34)).toBe(20_000);
    expect(nextDragCount(20_000, 200_000, 100)).toBe(20_000);
  });
  // 180_000 x 1.25 = 225_000 -> 상한 n = 200_000. 변이: 상한 clamp 제거
  it('상한은 n', () => {
    expect(nextDragCount(180_000, 200_000, 19)).toBe(200_000);
    expect(nextDragCount(200_000, 200_000, 5)).toBe(200_000);
  });
  // n = 12_000 < 20_000: 하한도 상한도 12_000 이라 항상 n.
  // 변이: clamp 순서를 바꿔 하한 20_000 을 나중에 적용(12_000 x 0.7 = 8_400 -> 20_000 이 나와 n 을 넘는다)
  it('n < 20_000 이면 항상 n', () => {
    expect(nextDragCount(12_000, 12_000, 34)).toBe(12_000);
    expect(nextDragCount(12_000, 12_000, 19)).toBe(12_000);
    expect(nextDragCount(12_000, 12_000, 25)).toBe(12_000);
  });
  // 100_000 -> 70_000 -> 49_000 -> 34_300 -> 24_010 -> 16_807 은 하한 20_000 -> 그 뒤로 20_000
  // 변이: 하한 clamp 제거(5번째가 16_807), prev 가 아니라 n 에서 매번 다시 계산(2번째도 70_000)
  it('느린 프레임이 이어지면 하한까지 내려가 멈춘다', () => {
    const seen: number[] = [];
    let c = initialDragCount(100_000);
    for (let i = 0; i < 7; i++) {
      c = nextDragCount(c, 100_000, 40);
      seen.push(c);
    }
    expect(seen).toEqual([70_000, 49_000, 34_300, 24_010, 20_000, 20_000, 20_000]);
  });
  // 20_000 -> 25_000 -> 31_250 -> 39_063(39_062.5 반올림) -> 48_829(48_828.75) -> 61_036(61_036.25)
  // -> 76_295 -> 95_369(95_368.75) -> 119_211 은 상한 100_000
  // 변이: 반올림 대신 버림(3번째가 39_062), 상한 clamp 제거(8번째가 119_211)
  it('빠른 프레임이 이어지면 n 까지 올라가 멈춘다', () => {
    const seen: number[] = [];
    let c = 20_000;
    for (let i = 0; i < 9; i++) {
      c = nextDragCount(c, 100_000, 10);
      seen.push(c);
    }
    expect(seen).toEqual([25_000, 31_250, 39_063, 48_829, 61_036, 76_295, 95_369, 100_000, 100_000]);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd D:/Projects/Flatness/dashboard && npx vitest run lib/viz/points3d/__tests__/budget.test.ts`

Expected: FAIL. 모듈이 없어 `Cannot find module '../budget'`(또는 `Failed to resolve import "../budget"`) 로 스위트 1개가 실패하고 테스트는 0건 실행된다.

- [ ] **Step 4: `budget.ts` 구현**

`dashboard/lib/viz/points3d/budget.ts` 를 아래 내용으로 만든다.

```ts
// 3D 점군 뷰어의 점 크기 식과 조작 중 그릴 점 수(LOD) 조정(스펙 §2.4, §7.4). 순수 함수만 둔다.
// 이름에 buffer 가 붙은 값과 [minPx, maxPx] 는 드로잉 버퍼 px(canvas.height, gl_PointSize 와 같은 단위)다.

export const POINT_SIZE_FACTOR = 0.55;  // 점의 실제 크기 = 이 값 x sample_cell_m
export const MIN_POINT_CSS_PX = 1.5;    // 점의 최소 크기(CSS px). 드로잉 버퍼로는 x 배율
export const LOD_START = 150_000;       // 조작 중 그릴 점 수의 시작값
export const LOD_FLOOR = 20_000;        // 조작 중 그릴 점 수의 하한
export const LOD_SLOW_MS = 33;          // frameMs 가 이보다 크면 줄인다
export const LOD_FAST_MS = 20;          // frameMs 가 이보다 작으면 늘린다

const LOD_SHRINK = 0.7;
const LOD_GROW = 1.25;

// 점의 실제 크기(m).
export function pointWorldSizeM(sampleCellM: number): number {
  return POINT_SIZE_FACTOR * sampleCellM;
}

// 카메라 앞 1m 거리에서 1m 가 차지하는 드로잉 버퍼 px. bufferHPx 는 canvas.height 다(CSS 높이가 아니다).
export function pxPerUnit(bufferHPx: number, fovy: number): number {
  return bufferHPx / (2 * Math.tan(fovy / 2));
}

// gl_PointSize 를 clamp 할 [minPx, maxPx](드로잉 버퍼 px). aliasedRange 는 ALIASED_POINT_SIZE_RANGE,
// bufferScale 은 드로잉 버퍼 배율(min(devicePixelRatio, 2))이다.
export function pointSizeRange(aliasedRange: [number, number], bufferScale: number): [number, number] {
  const maxPx = aliasedRange[1];
  return [Math.min(MIN_POINT_CSS_PX * bufferScale, maxPx), maxPx];
}

// 조작 중 그릴 점 수의 초기값.
export function initialDragCount(n: number): number {
  return Math.min(n, LOD_START);
}

// 직전 프레임 간격(frameMs)에 따라 조작 중 그릴 점 수를 조정한다.
// 반올림한 뒤 [min(n, LOD_FLOOR), n] 으로 clamp 한다.
export function nextDragCount(prev: number, n: number, frameMs: number): number {
  const scaled = frameMs > LOD_SLOW_MS ? prev * LOD_SHRINK : frameMs < LOD_FAST_MS ? prev * LOD_GROW : prev;
  return Math.min(n, Math.max(Math.min(n, LOD_FLOOR), Math.round(scaled)));
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd D:/Projects/Flatness/dashboard && npx vitest run lib/viz/points3d/__tests__/budget.test.ts`

Expected: PASS. `Test Files  1 passed (1)`, `Tests  16 passed (16)`.

- [ ] **Step 6: scaffold 의 실패하는 테스트 작성**

`dashboard/lib/viz/points3d/__tests__/scaffold.test.ts` 를 아래 내용으로 만든다. `flatMatrix()` 는 손으로 계산할 수 있게 만든 변환(1m = 100px)이고, 마지막 describe 는 Task 8 의 실제 카메라(`fitToBounds`·`viewProj`)를 쓴다.

```ts
// 격자·축·라벨(스펙 §7.8). 기대값은 전부 손으로 계산해 주석에 근거를 적었다.
import { describe, expect, it } from 'vitest';
import {
  AXIS_NAME_OFFSET_FRAC, LABEL_MIN_GAP_PX, MAX_GRID_LINES, MIN_AXIS_RANGE_M,
  buildScaffold, layoutLabels, niceStep,
} from '../scaffold';
import type { AxisTick } from '../scaffold';
import { fitToBounds, viewProj } from '../orbit';
import type { Bounds } from '../orbit';

// {1, 2, 5} x 10^p 수열(p = -2 .. 2). 리터럴로 적는다.
const SEQ = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

// 스펙의 선 수 식. 0.3 / 0.1 = 2.9999999999999996 같은 나눗셈 오차를 1e-9 로 흡수한다.
const lineCount = (rx: number, ry: number, step: number) =>
  Math.floor(rx / step + 1e-9) + Math.floor(ry / step + 1e-9) + 2;

// verts 의 k번째 선분(정점 2개 = 숫자 6개)
const seg = (verts: Float32Array, k: number) => Array.from(verts.subarray(k * 6, k * 6 + 6));
// 기대값을 float32 로 맞춘다(verts 가 Float32Array 라서)
const f32 = (a: number[]) => Array.from(new Float32Array(a));

const texts = (ticks: { axis: string; kind: string; text: string }[], axis: 'x' | 'y', kind: 'tick' | 'name' = 'tick') =>
  ticks.filter((t) => t.axis === axis && t.kind === kind).map((t) => t.text);

// 손 계산용 변환(열 우선). 월드 (x, y) = (0..8, 0..8) 을 800 x 800 CSS px 화면에 1m = 100px 로 놓는다.
// clipX = 0.25x - 1, clipY = 0.25y - 1, w = 1  ->  화면 x = 100x, 화면 y = 800 - 100y
function flatMatrix(): Float32Array {
  const m = new Float32Array(16);
  m[0] = 0.25; m[5] = 0.25; m[12] = -1; m[13] = -1; m[15] = 1;
  return m;
}
const xTick = (x: number, text: string): AxisTick => ({ axis: 'x', pos: [x, 4, 0], text, kind: 'tick' });

describe('상수', () => {
  // 변이: 상수 값 변경(Task 11·12 가 이 이름으로 읽는다)
  it('스펙 §2.4 의 값', () => {
    expect(MAX_GRID_LINES).toBe(40);
    expect(LABEL_MIN_GAP_PX).toBe(28);
    expect(MIN_AXIS_RANGE_M).toBe(0.1);
    expect(AXIS_NAME_OFFSET_FRAC).toBe(0.08);
  });
});

describe('niceStep', () => {
  // 변이: 선 수 상한 무시(검사 제거 -> 항상 0.01), 다음 값으로 넘어가지 않음
  it('6 x 6 m 는 0.5 (0.2 면 30+30+2 = 62 > 40, 0.5 면 12+12+2 = 26)', () => {
    expect(niceStep(6, 6)).toBe(0.5);
  });
  it('30 x 20 m 는 2 (1 이면 30+20+2 = 52 > 40, 2 면 15+10+2 = 27)', () => {
    expect(niceStep(30, 20)).toBe(2);
  });
  it('0.1 x 0.1 m 는 0.01 (10+10+2 = 22)', () => {
    expect(niceStep(0.1, 0.1)).toBe(0.01);
  });
  // 변이: 수열을 0.01 아래(0.001, 0.002, 0.005)에서 시작. 0.01 x 0.01 m 는 0.001 에서도 10+10+2 = 22 라
  // 하한이 없으면 0.001 이 나온다. 상한 100 의 0.1 x 0.1 m 도 0.005 (20+20+2 = 42) 가 나온다.
  it('0.01 아래로 내려가지 않는다', () => {
    expect(niceStep(0.01, 0.01)).toBe(0.01);
    expect(niceStep(0, 0)).toBe(0.01);
    expect(niceStep(0.1, 0.1, 100)).toBe(0.01);
  });
  // 변이: 상한이 정확히 40 일 때 거절(<= 를 < 로)
  it('선 수가 정확히 40 이면 받아들인다 (19 x 19 m, step 1: 19+19+2 = 40)', () => {
    expect(niceStep(19, 19)).toBe(1);
  });
  it('선 수가 41 이면 다음 값으로 넘어간다 (20 x 19 m, step 1: 41 -> step 2: 10+9+2 = 21)', () => {
    expect(niceStep(20, 19)).toBe(2);
  });
  // 변이: maxLines 인자 무시(상수 40 고정)
  it('maxLines 를 주면 그 상한을 쓴다 (6 x 6 m, 100: 0.1 은 122, 0.2 는 62)', () => {
    expect(niceStep(6, 6, 100)).toBe(0.2);
  });
  // 변이: floor 의 1e-9 보정 제거. 0.3 / 0.1 = 2.9999999999999996 을 그대로 floor 하면 2 가 되어
  // 0.1 에서 2+1+2 = 5 <= 5 로 받아들인다. 보정하면 3+1+2 = 6 > 5 라 0.2 (1+0+2 = 3) 로 넘어간다.
  it('나눗셈 오차를 흡수한다 (0.3 x 0.1 m, 상한 5 -> 0.2)', () => {
    expect(niceStep(0.3, 0.1, 5)).toBe(0.2);
  });
  // 성질: 수열 값이고, 선 수 40 이하이며, 그보다 작은 수열 값은 40 을 넘는다(가장 작은 값)
  // 변이: 상한을 넘는 값을 돌려줌, 조건을 만족하는 더 큰 수열 값을 돌려줌(가장 작은 값이 아님), 수열 밖의 값(예: 3 x 10^p)
  it('여러 범위에서 수열 값 · 선 수 40 이하 · 조건을 만족하는 가장 작은 값', () => {
    const ranges = [0.1, 0.37, 1, 2.5, 6, 12.3, 30, 47, 120, 999];
    for (const rx of ranges) {
      for (const ry of ranges) {
        const step = niceStep(rx, ry);
        const at = SEQ.indexOf(step);
        expect(at, `${rx} x ${ry} -> ${step}`).toBeGreaterThanOrEqual(0);
        expect(lineCount(rx, ry, step), `${rx} x ${ry} -> ${step}`).toBeLessThanOrEqual(40);
        if (at > 0) expect(lineCount(rx, ry, SEQ[at - 1]), `${rx} x ${ry} -> ${step}`).toBeGreaterThan(40);
      }
    }
  });
  // 변이: 탐색 상한(NICE_MAX_EXP) 제거 -> 조건을 만족하는 값이 없어 루프가 끝나지 않고 타임아웃으로 실패
  it('비유한 범위에서도 끝난다', () => {
    expect(Number.isFinite(niceStep(Infinity, 1))).toBe(true);
    expect(Number.isFinite(niceStep(NaN, 1))).toBe(true);
  });
});

describe('buildScaffold: 6 x 4 m (fit.min 이 원점이 아님)', () => {
  // rangeX = 6, rangeY = 4. step: 0.2 면 30+20+2 = 52 > 40, 0.5 면 12+8+2 = 22 -> 0.5
  // x 가 일정한 선 13개(i = 0..12), y 가 일정한 선 9개(j = 0..8)
  const fit: Bounds = { min: [1, 2, 0.5], max: [7, 6, 0.6] };
  const sc = buildScaffold(fit);

  // 변이: 선 수 상한 무시(step 0.01 로 정점 수 폭증), 축선을 네 변으로(axisVertCount 8), 선당 정점 1개
  it('step 과 정점 수', () => {
    expect(sc.step).toBe(0.5);
    expect(sc.gridVertCount).toBe(2 * (13 + 9));
    expect(sc.axisVertCount).toBe(4);
    expect(sc.verts).toBeInstanceOf(Float32Array);
    expect(sc.verts.length).toBe((44 + 4) * 3);
  });
  // 변이: x·y 축 바꾸기(x 선이 x 방향으로 뻗음), 선 범위를 0..range 로(fit.min 누락)
  it('x 가 일정한 선은 y = fit.min.y 에서 fit.max.y 까지', () => {
    expect(seg(sc.verts, 0)).toEqual([1, 2, 0.5, 1, 6, 0.5]);
    expect(seg(sc.verts, 1)).toEqual([1.5, 2, 0.5, 1.5, 6, 0.5]);
    expect(seg(sc.verts, 12)).toEqual([7, 2, 0.5, 7, 6, 0.5]);
  });
  // 변이: y 선을 y 방향으로 뻗게 함(축 바꾸기), 선 시작을 0 으로(fit.min.x 누락), y 선 구간을 x 선 앞에 둠
  it('y 가 일정한 선은 x = fit.min.x 에서 fit.max.x 까지', () => {
    expect(seg(sc.verts, 13)).toEqual([1, 2, 0.5, 7, 2, 0.5]);
    expect(seg(sc.verts, 14)).toEqual([1, 2.5, 0.5, 7, 2.5, 0.5]);
    expect(seg(sc.verts, 21)).toEqual([1, 6, 0.5, 7, 6, 0.5]);
  });
  // 변이: 높이를 fit.max.z·중간·0 으로
  it('모든 정점의 높이가 fit.min.z', () => {
    for (let v = 0; v < sc.verts.length / 3; v++) expect(sc.verts[v * 3 + 2]).toBe(0.5);
  });
  // 변이: 축 구간을 격자 앞에 둠, 축선을 먼 쪽 변에 그림
  it('격자 구간 뒤에 축선 두 변(x축 변, y축 변)이 온다', () => {
    const first = sc.gridVertCount / 2;
    expect(seg(sc.verts, first)).toEqual([1, 2, 0.5, 7, 2, 0.5]);
    expect(seg(sc.verts, first + 1)).toEqual([1, 2, 0.5, 1, 6, 0.5]);
  });
  // 변이: 눈금을 절대(파일-로컬) 좌표로 표기 -> 첫 눈금이 '1.0' / '2.0' 이 된다
  it('눈금 숫자는 fit 최솟값 모서리에서 0 이고 step 0.5 는 소수 1자리', () => {
    expect(texts(sc.ticks, 'x')).toEqual(
      ['0.0', '0.5', '1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0']);
    expect(texts(sc.ticks, 'y')).toEqual(['0.0', '0.5', '1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0']);
  });
  // 변이: 눈금 위치를 먼 쪽 변에, x·y 눈금 위치 바꾸기
  it('눈금 위치는 x축 변(y = fit.min.y)과 y축 변(x = fit.min.x) 위', () => {
    const xs = sc.ticks.filter((t) => t.axis === 'x' && t.kind === 'tick');
    const ys = sc.ticks.filter((t) => t.axis === 'y' && t.kind === 'tick');
    expect(xs[0].pos).toEqual([1, 2, 0.5]);
    expect(xs[3].pos).toEqual([2.5, 2, 0.5]);
    expect(xs[12].pos).toEqual([7, 2, 0.5]);
    expect(ys[0].pos).toEqual([1, 2, 0.5]);
    expect(ys[8].pos).toEqual([1, 6, 0.5]);
  });
  // 축 이름: 변의 중점에서 바깥쪽으로 0.08 x max(6, 4) = 0.48 m
  // 변이: 바깥이 아니라 안쪽으로(부호 뒤집기), 중점이 아닌 곳
  it('축 이름은 변의 중점 바깥쪽', () => {
    const names = sc.ticks.filter((t) => t.kind === 'name');
    expect(names.map((t) => `${t.axis}:${t.text}`)).toEqual(['x:x (m)', 'y:y (m)']);
    expect(names[0].pos[0]).toBeCloseTo(4, 9);
    expect(names[0].pos[1]).toBeCloseTo(2 - 0.48, 9);
    expect(names[0].pos[2]).toBe(0.5);
    expect(names[1].pos[0]).toBeCloseTo(1 - 0.48, 9);
    expect(names[1].pos[1]).toBeCloseTo(4, 9);
    expect(names[1].pos[2]).toBe(0.5);
  });
  // 변이: z축 눈금 추가(ticks 가 는다), 축 이름 누락(ticks 가 준다)
  it('z축 눈금은 만들지 않는다 (눈금 13 + 9, 이름 2)', () => {
    expect(sc.ticks.length).toBe(13 + 9 + 2);
  });
});

describe('buildScaffold: 범위가 step 의 배수가 아닐 때', () => {
  // rangeX = 6.3, rangeY = 4.2. step: 0.2 면 31+21+2 = 54 > 40, 0.5 면 12+8+2 = 22 -> 0.5
  // floor(6.3 / 0.5) = 12, floor(4.2 / 0.5) = 8. 마지막 선은 x = 6.0, y = 4.0 (fit.max 보다 안쪽)
  const sc = buildScaffold({ min: [0, 0, 0], max: [6.3, 4.2, 0] });
  // 변이: 마지막 선을 fit.max 에 강제 추가(선이 14 / 10 개가 되고 x = 6.3 선이 생긴다)
  it('먼 쪽 가장자리에는 선이 없다', () => {
    expect(sc.step).toBe(0.5);
    expect(sc.gridVertCount).toBe(2 * (13 + 9));
    expect(seg(sc.verts, 12)).toEqual(f32([6, 0, 0, 6, 4.2, 0]));
    expect(seg(sc.verts, 21)).toEqual(f32([0, 4, 0, 6.3, 4, 0]));
    expect(texts(sc.ticks, 'x').at(-1)).toBe('6.0');
    expect(texts(sc.ticks, 'y').at(-1)).toBe('4.0');
  });
  // 변이: 선 끝을 마지막 눈금(6.0 / 4.0)에서 자름
  it('선은 fit.max 까지 뻗는다', () => {
    expect(seg(sc.verts, 0)).toEqual(f32([0, 0, 0, 0, 4.2, 0]));
    expect(seg(sc.verts, 13)).toEqual(f32([0, 0, 0, 6.3, 0, 0]));
    const first = sc.gridVertCount / 2;
    expect(seg(sc.verts, first)).toEqual(f32([0, 0, 0, 6.3, 0, 0]));
    expect(seg(sc.verts, first + 1)).toEqual(f32([0, 0, 0, 0, 4.2, 0]));
  });
});

describe('buildScaffold: 나눗셈 오차', () => {
  // rangeX = 0.3, rangeY = 2. step: 0.05 면 6+40+2 = 48 > 40, 0.1 이면 3+20+2 = 25 -> 0.1
  // 0.3 / 0.1 = 2.9999999999999996. 그대로 floor 하면 x 선이 3개뿐이고 눈금 '0.3' 이 빠진다.
  // 변이: 격자 생성 쪽 floor 의 1e-9 보정 제거
  it('range 0.3, step 0.1 에서 선이 4개다', () => {
    const sc = buildScaffold({ min: [0, 0, 0], max: [0.3, 2, 0] });
    expect(sc.step).toBe(0.1);
    expect(texts(sc.ticks, 'x')).toEqual(['0.0', '0.1', '0.2', '0.3']);
    expect(sc.gridVertCount).toBe(2 * (4 + 21));
    expect(sc.verts[3 * 6]).toBeCloseTo(0.3, 6);
  });
});

describe('buildScaffold: 눈금 자릿수', () => {
  // 30 x 20 m -> step 2 (niceStep 테스트 참고). step >= 1 은 정수
  // 변이: 자릿수를 1 로 고정('0.0', '2.0', ...), step 2 대신 1 을 고름(선 수 상한 무시)
  it('step >= 1 이면 정수', () => {
    const sc = buildScaffold({ min: [0, 0, 0], max: [30, 20, 0] });
    expect(sc.step).toBe(2);
    expect(texts(sc.ticks, 'x')).toEqual(
      ['0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24', '26', '28', '30']);
    expect(texts(sc.ticks, 'y').at(-1)).toBe('20');
  });
  // 1 x 0.6 m. step: 0.02 면 50+30+2 = 82 > 40, 0.05 면 20+12+2 = 34 -> 0.05. 소수 2자리
  // 0.6 / 0.05 = 11.999999999999998 이라 y 쪽은 floor 보정도 함께 본다(보정이 없으면 '0.60' 이 빠진다)
  // 변이: 자릿수를 1로 고정('0.1' 이 두 번 나온다), 격자 생성 쪽 floor 의 1e-9 보정 제거
  it('step 0.05 는 소수 2자리', () => {
    const sc = buildScaffold({ min: [0, 0, 0], max: [1, 0.6, 0] });
    expect(sc.step).toBe(0.05);
    expect(texts(sc.ticks, 'x').slice(0, 4)).toEqual(['0.00', '0.05', '0.10', '0.15']);
    expect(texts(sc.ticks, 'x').at(-1)).toBe('1.00');
    expect(texts(sc.ticks, 'x').length).toBe(21);
    expect(texts(sc.ticks, 'y').at(-1)).toBe('0.60');
    expect(texts(sc.ticks, 'y').length).toBe(13);
  });
});

describe('buildScaffold: 0.1m 미만 축', () => {
  // x 범위 0.04 < 0.1 -> fit.min.x = 2 를 고정하고 max 를 2.1 로 본다. rangeY = 2.
  // step: 0.05 면 2+40+2 = 44 > 40, 0.1 이면 1+20+2 = 23 -> 0.1
  const sc = buildScaffold({ min: [2, 3, 1], max: [2.04, 5, 1] });
  // 변이: 보정 제거(x 선 1개, 선 끝 2.04), 가운데를 기준으로 늘림(min 이 1.97 로 움직임)
  it('fit.min 을 고정한 채 0.1m 로 본다', () => {
    expect(sc.step).toBe(0.1);
    expect(texts(sc.ticks, 'x')).toEqual(['0.0', '0.1']);
    expect(sc.gridVertCount).toBe(2 * (2 + 21));
    expect(seg(sc.verts, 0)).toEqual(f32([2, 3, 1, 2, 5, 1]));
    expect(seg(sc.verts, 1)).toEqual(f32([2.1, 3, 1, 2.1, 5, 1]));
    // y 가 일정한 첫 선과 x축 변도 보정한 max(2.1)까지
    expect(seg(sc.verts, 2)).toEqual(f32([2, 3, 1, 2.1, 3, 1]));
    expect(seg(sc.verts, sc.gridVertCount / 2)).toEqual(f32([2, 3, 1, 2.1, 3, 1]));
  });
  // 변이: 축 이름 중점에 보정 전 max 를 씀(x 중점 2.02), 안쪽으로 띄움(부호 뒤집기)
  it('축 이름 위치도 보정한 범위를 쓴다 (중점 2.05, 바깥 0.08 x 2 = 0.16)', () => {
    const [xName, yName] = sc.ticks.filter((t) => t.kind === 'name');
    expect(xName.pos[0]).toBeCloseTo(2.05, 9);
    expect(xName.pos[1]).toBeCloseTo(3 - 0.16, 9);
    expect(yName.pos[0]).toBeCloseTo(2 - 0.16, 9);
    expect(yName.pos[1]).toBeCloseTo(4, 9);
  });
  // 두 축 다 0 이어도 0.1 x 0.1 m 로 보고 step 0.01, 선 11 + 11
  // 변이: y 쪽 0.1m 보정 제거(y 선이 1개뿐이라 정점 수가 2 x (11 + 1)), 범위 0 을 그대로 나눔
  it('한 점뿐인 fit 에서도 유한한 격자를 낸다', () => {
    const one = buildScaffold({ min: [5, 5, 2], max: [5, 5, 2] });
    expect(one.step).toBe(0.01);
    expect(one.gridVertCount).toBe(2 * (11 + 11));
    expect(Array.from(one.verts).every(Number.isFinite)).toBe(true);
    expect(seg(one.verts, 10)).toEqual(f32([5.1, 5, 2, 5.1, 5.1, 2]));
  });
});

describe('layoutLabels: 손 계산 변환 (1m = 100px, 800 x 800)', () => {
  const m = flatMatrix();

  // 변이: y 를 뒤집지 않음(y = 300 이 나온다), x·y 를 바꿔 씀(x = 500)
  it('월드 위치를 CSS px 로 옮긴다 (y 는 아래로 증가)', () => {
    const out = layoutLabels([{ axis: 'x', pos: [2, 3, 0], text: 'a', kind: 'tick' }], m, 800, 800);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ axis: 'x', kind: 'tick', text: 'a' });
    expect(out[0].x).toBeCloseTo(200, 6);
    expect(out[0].y).toBeCloseTo(500, 6);
  });
  // 변이: 솎기 제거(4개 다 남음), 직전에 '남긴' 라벨이 아니라 직전 눈금과 비교(첫 것만 남음)
  it('같은 축에서 직전에 남긴 라벨과 28px 미만이면 건너뛴다 (20px 간격 -> 0, 40 만 남는다)', () => {
    const ticks = [xTick(1, 'a'), xTick(1.2, 'b'), xTick(1.4, 'c'), xTick(1.6, 'd')];
    expect(layoutLabels(ticks, m, 800, 800).map((l) => l.text)).toEqual(['a', 'c']);
  });
  // 변이: 최소 간격 상수 바꾸기
  it('27px 는 건너뛰고 29px 는 남긴다', () => {
    expect(layoutLabels([xTick(1, 'a'), xTick(1.27, 'b')], m, 800, 800).map((l) => l.text)).toEqual(['a']);
    expect(layoutLabels([xTick(1, 'a'), xTick(1.29, 'b')], m, 800, 800).map((l) => l.text)).toEqual(['a', 'b']);
  });
  // 변이: 축 구분 없이 솎기(같은 모서리의 y축 0 이 사라진다)
  it('다른 축의 라벨과는 겹쳐도 솎지 않는다', () => {
    const ticks: AxisTick[] = [
      { axis: 'x', pos: [1, 1, 0], text: 'x0', kind: 'tick' },
      { axis: 'y', pos: [1, 1, 0], text: 'y0', kind: 'tick' },
    ];
    expect(layoutLabels(ticks, m, 800, 800).map((l) => l.text)).toEqual(['x0', 'y0']);
  });
  // 변이: 축 이름도 솎음, 축 이름이 '직전에 남긴 라벨'을 갱신함(뒤따르는 눈금 c 가 사라진다)
  it('축 이름은 솎지 않고, 솎기 기준에도 들어가지 않는다', () => {
    const ticks: AxisTick[] = [
      xTick(1, 'a'),
      { axis: 'x', pos: [1.05, 4, 0], text: 'x (m)', kind: 'name' },
      { axis: 'x', pos: [1.3, 4, 0], text: 'x (m) 2', kind: 'name' },
      xTick(1.4, 'c'),
    ];
    expect(layoutLabels(ticks, m, 800, 800).map((l) => l.text)).toEqual(['a', 'x (m)', 'x (m) 2', 'c']);
  });
  // 변이: 영역 검사 제거. 화면 x = -50, 850 / 화면 y = -50(월드 y 8.5), 850(월드 y -0.5)
  it('영역 밖 라벨은 숨긴다', () => {
    const ticks: AxisTick[] = [
      xTick(-0.5, 'left'), xTick(8.5, 'right'),
      { axis: 'y', pos: [4, 8.5, 0], text: 'above', kind: 'tick' },
      { axis: 'y', pos: [4, -0.5, 0], text: 'below', kind: 'tick' },
      { axis: 'x', pos: [-0.5, 4, 0], text: 'x (m)', kind: 'name' },
      xTick(4, 'in'),
    ];
    expect(layoutLabels(ticks, m, 800, 800).map((l) => l.text)).toEqual(['in']);
  });
  // 변이: 숨긴 라벨이 솎기 기준이 됨(영역 밖 -0.1 에서 10px 떨어진 0.0 이 사라진다)
  it('숨긴 라벨은 솎기 기준이 되지 않는다', () => {
    const ticks = [xTick(-0.1, 'out'), xTick(0, 'edge'), xTick(0.5, 'next')];
    expect(layoutLabels(ticks, m, 800, 800).map((l) => l.text)).toEqual(['edge', 'next']);
  });
  // w = x 인 변환: x <= 0 인 점은 카메라 뒤(w <= 0), x > 0 인 점은 화면 한가운데
  // 변이: 카메라 뒤 라벨 표시(null 검사 제거)
  it('카메라 뒤(w <= 0) 라벨은 숨긴다', () => {
    const behind = new Float32Array(16);
    behind[3] = 1;
    const ticks = [xTick(-1, 'behind'), xTick(0, 'on-plane'), xTick(2, 'front')];
    const out = layoutLabels(ticks, behind, 800, 600);
    expect(out.map((l) => l.text)).toEqual(['front']);
    expect(out[0].x).toBeCloseTo(400, 6);
    expect(out[0].y).toBeCloseTo(300, 6);
  });
});

describe('layoutLabels: 실제 카메라(평면 시점)', () => {
  // 6 x 4 m, step 0.5. 평면 시점에서 화면의 m 당 px = cssH / (2 x distance x tan(FOVY / 2)).
  // radius = sqrt(36 + 16 + 0.01) / 2 = 3.606, distance = 3.606 / sin(20도) x 1.05 = 11.07,
  // 화면 세로가 담는 높이 = 2 x 11.07 x tan(20도) = 8.06 m.
  const fit: Bounds = { min: [1, 2, 0.5], max: [7, 6, 0.6] };
  const sc = buildScaffold(fit);
  const cam = fitToBounds(fit, 'top');
  const vp = viewProj(cam, 4 / 3, fit);

  // 600px / 8.06m = 74 px/m -> 눈금 간격 37px >= 28px 라 전부 남는다
  // 변이: 최소 간격을 37px 보다 크게(눈금이 솎인다), 영역 검사의 부등호 뒤집기(전부 숨김), 축 이름 누락
  it('800 x 600 에서는 눈금이 전부 보인다', () => {
    const out = layoutLabels(sc.ticks, vp, 800, 600);
    expect(texts(out, 'x').length).toBe(13);
    expect(texts(out, 'y').length).toBe(9);
    expect(texts(out, 'x', 'name')).toEqual(['x (m)']);
    expect(texts(out, 'y', 'name')).toEqual(['y (m)']);
  });
  // 300px / 8.06m = 37 px/m -> 눈금 간격 18.6px < 28px, 두 칸 37px >= 28px 라 하나 걸러 남는다
  it('400 x 300 에서는 하나 걸러 남는다', () => {
    const out = layoutLabels(sc.ticks, vp, 400, 300);
    expect(texts(out, 'x')).toEqual(['0.0', '1.0', '2.0', '3.0', '4.0', '5.0', '6.0']);
    expect(texts(out, 'y')).toEqual(['0.0', '1.0', '2.0', '3.0', '4.0']);
    expect(out.filter((l) => l.kind === 'name').length).toBe(2);
  });
  // 평면 시점은 화면 오른쪽이 +x, 위가 +y. 축 이름은 변의 바깥(x 이름은 x축 변 아래, y 이름은 y축 변 왼쪽)
  // 변이: 축 이름을 안쪽에 둠, x·y 눈금 위치 바꾸기
  it('x 눈금은 오른쪽으로, y 눈금은 위로 가고 축 이름은 바깥에 있다', () => {
    const out = layoutLabels(sc.ticks, vp, 800, 600);
    const xs = out.filter((l) => l.axis === 'x' && l.kind === 'tick');
    const ys = out.filter((l) => l.axis === 'y' && l.kind === 'tick');
    for (let i = 1; i < xs.length; i++) expect(xs[i].x).toBeGreaterThan(xs[i - 1].x);
    for (let j = 1; j < ys.length; j++) expect(ys[j].y).toBeLessThan(ys[j - 1].y);
    const xName = out.find((l) => l.axis === 'x' && l.kind === 'name')!;
    const yName = out.find((l) => l.axis === 'y' && l.kind === 'name')!;
    expect(xName.y).toBeGreaterThan(xs[0].y);
    expect(yName.x).toBeLessThan(ys[0].x);
  });
  // 평면 시점의 카메라는 target 위 distance 높이에 있다. 그보다 더 위의 점은 카메라 뒤다.
  // 변이: project 의 null 검사 제거(w 가 음수인 점을 w 로 나누면 화면 안 좌표가 나올 수 있다)
  it('카메라보다 위에 있는 라벨은 숨긴다', () => {
    const above: AxisTick = {
      axis: 'x', pos: [cam.target[0], cam.target[1], cam.target[2] + 2 * cam.distance], text: 'behind', kind: 'tick',
    };
    expect(layoutLabels([above], vp, 800, 600)).toEqual([]);
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `cd D:/Projects/Flatness/dashboard && npx vitest run lib/viz/points3d/__tests__/scaffold.test.ts`

Expected: FAIL. 모듈이 없어 `Cannot find module '../scaffold'`(또는 `Failed to resolve import "../scaffold"`) 로 스위트 1개가 실패하고 테스트는 0건 실행된다.

- [ ] **Step 8: `scaffold.ts` 구현**

`dashboard/lib/viz/points3d/scaffold.ts` 를 아래 내용으로 만든다.

```ts
// 3D 점군 뷰어의 격자·축선 정점과 눈금 라벨(스펙 §7.8). DOM·WebGL 을 건드리지 않는 순수 함수만 둔다.
// 좌표는 전부 파일-로컬 m 다. 눈금 숫자는 fit 범위 최솟값 모서리를 0 으로 한 값이다.
import { project } from './mat4';
import type { Bounds } from './orbit';

export const MAX_GRID_LINES = 40;          // x선 수 + y선 수의 상한
export const LABEL_MIN_GAP_PX = 28;        // 같은 축 눈금 라벨 사이의 최소 화면 거리(CSS px)
export const MIN_AXIS_RANGE_M = 0.1;       // 이보다 좁은 축은 fit.min 을 고정한 채 이 길이로 본다
export const AXIS_NAME_OFFSET_FRAC = 0.08; // 축 이름을 변에서 바깥으로 띄우는 거리 = 이 값 x max(rangeX, rangeY)

export interface AxisTick { axis: 'x' | 'y'; pos: [number, number, number]; text: string; kind: 'tick' | 'name'; }
export interface PlacedLabel { axis: 'x' | 'y'; kind: 'tick' | 'name'; text: string; x: number; y: number; }

const NICE_MANTISSAS = [1, 2, 5];
const NICE_MIN_EXP = -2;   // 최소 간격 0.01m
const NICE_MAX_EXP = 9;    // 탐색 상한. 비유한 범위가 들어와도 루프가 끝난다
const FLOOR_EPS = 1e-9;    // 0.3 / 0.1 = 2.9999999999999996 같은 나눗셈 오차를 흡수한다

// range 안에 step 이 몇 번 들어가는가. niceStep 과 격자 생성이 같은 식을 써야 선 수가 어긋나지 않는다.
function stepsIn(range: number, step: number): number {
  return Math.floor(range / step + FLOOR_EPS);
}

// {1, 2, 5} x 10^p 수열에서 x선 수 + y선 수가 maxLines 이하가 되는 가장 작은 간격(m).
export function niceStep(rangeX: number, rangeY: number, maxLines: number = MAX_GRID_LINES): number {
  let step = 0;
  for (let p = NICE_MIN_EXP; p <= NICE_MAX_EXP; p++) {
    for (const m of NICE_MANTISSAS) {
      // 정수끼리 나누거나 곱해야 0.05 같은 값이 리터럴과 같은 배정도 값이 된다
      step = p < 0 ? m / 10 ** -p : m * 10 ** p;
      if (stepsIn(rangeX, step) + stepsIn(rangeY, step) + 2 <= maxLines) return step;
    }
  }
  return step;
}

// 눈금 숫자의 소수 자릿수. step >= 1 이면 정수, 아니면 step 의 유효 소수 자릿수(0.5 -> 1, 0.05 -> 2).
function stepDecimals(step: number): number {
  return step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step) + FLOOR_EPS));
}

// 격자선·축선 정점과 눈금 목록. verts 는 xyz 3개씩이며 앞 gridVertCount 정점이 격자 LINES,
// 이어지는 axisVertCount 정점이 축선 LINES 다. ticks 는 x 눈금, y 눈금, x 이름, y 이름 순이다.
export function buildScaffold(fit: Bounds): {
  verts: Float32Array; gridVertCount: number; axisVertCount: number; ticks: AxisTick[]; step: number;
} {
  const x0 = fit.min[0];
  const y0 = fit.min[1];
  const z = fit.min[2]; // 바닥 높이. 편차 과장과 무관하게 움직이지 않는다
  // 0.1m 미만 축은 fit.min 을 고정하고 max 쪽을 늘린다. 간격·격자·축선·눈금이 전부 이 보정 범위를 쓴다
  const rawX = fit.max[0] - x0;
  const rawY = fit.max[1] - y0;
  const shortX = rawX < MIN_AXIS_RANGE_M;
  const shortY = rawY < MIN_AXIS_RANGE_M;
  const rangeX = shortX ? MIN_AXIS_RANGE_M : rawX;
  const rangeY = shortY ? MIN_AXIS_RANGE_M : rawY;
  const x1 = shortX ? x0 + MIN_AXIS_RANGE_M : fit.max[0];
  const y1 = shortY ? y0 + MIN_AXIS_RANGE_M : fit.max[1];

  const step = niceStep(rangeX, rangeY);
  const nx = stepsIn(rangeX, step);
  const ny = stepsIn(rangeY, step);
  const decimals = stepDecimals(step);

  const v: number[] = [];
  const ticks: AxisTick[] = [];
  // x 가 일정한 선. 범위가 step 의 배수가 아니면 먼 쪽 가장자리(x1)에는 선이 없다
  for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step;
    v.push(x, y0, z, x, y1, z);
    // 눈금 숫자는 누적 덧셈이 아니라 i x step 에서 바로 만든다
    ticks.push({ axis: 'x', pos: [x, y0, z], text: (i * step).toFixed(decimals), kind: 'tick' });
  }
  // y 가 일정한 선
  for (let j = 0; j <= ny; j++) {
    const y = y0 + j * step;
    v.push(x0, y, z, x1, y, z);
    ticks.push({ axis: 'y', pos: [x0, y, z], text: (j * step).toFixed(decimals), kind: 'tick' });
  }
  const gridVertCount = v.length / 3;
  // 축선 두 변: x축 변(y = y0), y축 변(x = x0)
  v.push(x0, y0, z, x1, y0, z);
  v.push(x0, y0, z, x0, y1, z);
  const axisVertCount = v.length / 3 - gridVertCount;

  // 축 이름은 변의 중점에서 바깥쪽으로 띄운다
  const off = AXIS_NAME_OFFSET_FRAC * Math.max(rangeX, rangeY);
  ticks.push({ axis: 'x', pos: [(x0 + x1) / 2, y0 - off, z], text: 'x (m)', kind: 'name' });
  ticks.push({ axis: 'y', pos: [x0 - off, (y0 + y1) / 2, z], text: 'y (m)', kind: 'name' });

  return { verts: new Float32Array(v), gridVertCount, axisVertCount, ticks, step };
}

// 눈금·축 이름의 월드 위치를 화면(CSS px)으로 옮긴다. 카메라 뒤이거나 영역 밖이면 숨기고,
// 같은 축에서 직전에 남긴 눈금과 LABEL_MIN_GAP_PX 미만으로 붙은 눈금은 건너뛴다. 축 이름은 솎지 않는다.
export function layoutLabels(ticks: AxisTick[], viewProj: Float32Array, cssW: number, cssH: number): PlacedLabel[] {
  const out: PlacedLabel[] = [];
  const lastKept: { x?: { x: number; y: number }; y?: { x: number; y: number } } = {};
  for (const t of ticks) {
    const p = project(viewProj, t.pos, cssW, cssH);
    if (p === null) continue; // 카메라 뒤(w <= 0)
    if (p.x < 0 || p.x > cssW || p.y < 0 || p.y > cssH) continue; // 영역 밖
    if (t.kind === 'tick') {
      const last = lastKept[t.axis];
      if (last !== undefined && Math.hypot(p.x - last.x, p.y - last.y) < LABEL_MIN_GAP_PX) continue;
      lastKept[t.axis] = { x: p.x, y: p.y };
    }
    out.push({ axis: t.axis, kind: t.kind, text: t.text, x: p.x, y: p.y });
  }
  return out;
}
```

- [ ] **Step 9: 통과 확인**

Run: `cd D:/Projects/Flatness/dashboard && npx vitest run lib/viz/points3d/__tests__/scaffold.test.ts`

Expected: PASS. `Test Files  1 passed (1)`, `Tests  40 passed (40)`.

실패하면 구현을 테스트에 맞춰 고치지 말고 원인을 먼저 본다. `layoutLabels: 실제 카메라(평면 시점)` 묶음만 실패하면 Task 8 의 `fitToBounds`·`viewProj`·`project` 가 스펙 §7.7(평면 시점: 방위 −90°, 고도 89.9°, 화면 오른쪽이 +x, 위가 +y, `distance = radius / sin(FOVY / 2) × 1.05`)과 다른지 확인하고, 다르면 이 태스크에서 고치지 말고 보고한다.

- [ ] **Step 10: 변이 확인(테스트가 회귀를 잡는지)**

아래 변이를 **하나씩** 넣고 `npx vitest run lib/viz/points3d` 를 돌려 표의 테스트가 실패하는지 본 뒤 되돌린다. 전부 확인한 다음 `git diff --stat` 에 두 구현 파일의 변경이 남지 않았는지 확인한다(계획 작성 때 스크래치에서 아래 변이가 전부 죽는 것을 확인했다).

| 파일 | 변이 | 죽어야 하는 테스트 |
|---|---|---|
| scaffold.ts | `+ 2 <= maxLines` 를 `+ 2 <= Infinity` 로(선 수 상한 무시) | `6 x 6 m 는 0.5`, `30 x 20 m 는 2` 외 다수 |
| scaffold.ts | `niceStep` 안의 `stepsIn(...)` 두 개를 `Math.floor(range / step)` 로(보정 제거) | `나눗셈 오차를 흡수한다` |
| scaffold.ts | `nx`·`ny` 를 `Math.floor(rangeX / step)`·`Math.floor(rangeY / step)` 로 | `range 0.3, step 0.1 에서 선이 4개다`, `step 0.05 는 소수 2자리` |
| scaffold.ts | 눈금 문자열을 `x.toFixed(decimals)` 로(절대 좌표 표기) | `눈금 숫자는 fit 최솟값 모서리에서 0 ...`, `fit.min 을 고정한 채 0.1m 로 본다` |
| scaffold.ts | x 루프를 `i <= nx + 1`, `x = Math.min(x0 + i * step, x1)` 로(마지막 선 강제 추가) | `먼 쪽 가장자리에는 선이 없다`, `step 과 정점 수` |
| scaffold.ts | `< LABEL_MIN_GAP_PX) continue;` 를 `< 0) continue;` 로(솎기 제거) | `같은 축에서 직전에 남긴 라벨과 28px 미만이면 건너뛴다`, `27px 는 건너뛰고 29px 는 남긴다`, `400 x 300 에서는 하나 걸러 남는다` |
| scaffold.ts | `lastKept[t.axis] = ...` 줄을 거리 검사 앞으로 옮김(솎은 눈금도 기준이 됨) | `같은 축에서 직전에 남긴 라벨과 28px 미만이면 건너뛴다` |
| scaffold.ts | `if (p === null) continue;` 를 지우고 w 부호를 보지 않는 투영으로 바꿈(카메라 뒤 라벨 표시) | `카메라 뒤(w <= 0) 라벨은 숨긴다`, `카메라보다 위에 있는 라벨은 숨긴다` |
| scaffold.ts | 영역 검사 줄 삭제 | `영역 밖 라벨은 숨긴다` |
| scaffold.ts | `const shortX = false;`(0.1m 보정 제거) | `fit.min 을 고정한 채 0.1m 로 본다` |
| scaffold.ts | `const z = fit.max[2];` | `모든 정점의 높이가 fit.min.z` |
| scaffold.ts | `const NICE_MIN_EXP = -3;` | `0.01 아래로 내려가지 않는다` |
| budget.ts | `LOD_SHRINK` 와 `LOD_GROW` 값 교환 | `34ms 면 x0.7, 19ms 면 x1.25, 25ms 면 그대로` |
| budget.ts | `Math.max(Math.min(n, LOD_FLOOR), Math.round(scaled))` 를 `Math.round(scaled)` 로(하한 제거) | `하한은 min(n, 20_000)`, `느린 프레임이 이어지면 하한까지 내려가 멈춘다` |
| budget.ts | 바깥 `Math.min(n, ...)` 제거(상한 제거) | `상한은 n`, `n < 20_000 이면 항상 n` |
| budget.ts | `MIN_POINT_CSS_PX * bufferScale` 를 `MIN_POINT_CSS_PX` 로 | `pointSizeRange 의 최소는 1.5 x 배율 ...` |
| budget.ts | `Math.tan(fovy / 2)` 를 `Math.tan(fovy)` 로 | `pxPerUnit(960, 90도) = 480`, `pxPerUnit(960, 40도) = 1318.789` |

- [ ] **Step 11: 폴더 전체·팔레트 스윕·타입 검사**

Run:

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run lib/viz/points3d __tests__/palette-sweep.test.ts && npx tsc --noEmit
```

Expected: 전부 PASS. `scaffold.test.ts` 40건과 `budget.test.ts` 16건이 통과하고, Task 8 의 `mat4.test.ts`·`orbit.test.ts` 와 `palette-sweep.test.ts` 도 그대로 통과한다. `tsc` 는 출력 없이 끝난다(exit 0).

- [ ] **Step 12: 대시보드 스위트 전체**

Run: `cd D:/Projects/Flatness/dashboard && npx vitest run`

Expected: 실패 0. 통과 수는 이 태스크 직전보다 파일 2개, 테스트 56건이 늘어난다(2026-10-02 기준선은 84파일 769건이고, 앞 태스크가 더한 만큼 더 많다).

- [ ] **Step 13: 커밋**

```bash
cd D:/Projects/Flatness
git add dashboard/lib/viz/points3d/scaffold.ts dashboard/lib/viz/points3d/budget.ts dashboard/lib/viz/points3d/__tests__/scaffold.test.ts dashboard/lib/viz/points3d/__tests__/budget.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): 3D 점군 뷰어 격자·축 라벨(scaffold)과 점 크기·LOD(budget) 순수 모듈

- scaffold.ts: nice step(x선 + y선 40 이하), 격자·축선 정점, 눈금 라벨 배치와 겹침 솎기
- budget.ts: 점 크기 식(0.55 x sample_cell_m, 최소 CSS 1.5px), 조작 중 그릴 점 수 조정
- 테스트 56건(scaffold 40, budget 16). DOM·WebGL 을 건드리지 않는다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
git status --short
```

Expected: 커밋 1개가 생기고 `git status --short` 출력이 비어 있다.

**초안 메모(계획을 합칠 때 읽고 지운다):**

- 실제로 돌린 것: 위 테스트 2개와 구현 2개를 `.superpowers/plan-drafts/pointcloud-viewer/scratch-09/lib/viz/points3d/` 에 두고 `cd dashboard && npx vitest run --root <scratch-09>` 로 실패(모듈 없음) → 통과(56건)를 확인했다. `--environment jsdom --globals` 를 붙인 실행(대시보드 설정과 같은 환경)도 56건 통과. `npx tsc --noEmit -p <scratch-09>/tsconfig.json`(strict, 대시보드와 같은 옵션) exit 0. Step 10 의 변이를 포함해 변이 41개를 스크립트(`scratch-09/mutate.py`)로 하나씩 넣어 40개가 죽는 것을 확인했다. 살아남은 1개는 아래의 누적 덧셈 변이다.
- 대역: 처음 작성 때는 Task 8 의 `mat4.ts`·`orbit.ts` 를 뼈대의 시그니처와 스펙 §7.7 식을 만족하는 최소 구현(대역)으로 스크래치에만 만들어 썼다. `layoutLabels: 실제 카메라(평면 시점)` 4건이 Task 8 의 `fitToBounds('top')`·`viewProj`·`project`·`OrbitState.target`/`distance` 에 기댄다.
- 2026-10-03 재검증(이어서 한 것): Task 8 초안 `task-08.md` 의 실제 `mat4.ts`·`orbit.ts` 코드 블록과 이 태스크의 4개 파일, Task 8 의 테스트 2개를 `scratch-09/with-task08/` 에 모아 `npx vitest run --root` 로 돌려 **4개 파일 112건 전부 통과**(mat4·orbit 56 + scaffold 40 + budget 16). `tsc --noEmit`(strict) exit 0. 변이 스크립트도 다시 돌려 41개 중 40개 죽음·생존 1개(아래 누적 덧셈)로 같았다. 저장소의 `palette-sweep.test.ts` 정규식(`OLD_PALETTE`)을 node 로 4개 파일에 직접 적용해 0건. 그러니 Step 9 의 "Task 8 과 다르면 보고" 분기는 Task 8 이 초안대로 구현되면 닿지 않는다.
  - 주의(Task 8 담당자에게): `scratch-08/lib/viz/points3d/orbit.ts` 는 Task 8 변이 실험의 잔재가 복구되지 않은 상태다(`PRESET_ANGLES.iso` 가 −60°·36° 로 남아 있어 Task 8 의 `rotate` 테스트 2건이 그 파일로는 실패한다). `task-08.md` 의 코드 블록은 −55°·20° 로 올바르다. 스크래치 파일이므로 추적 파일에는 영향이 없다.
- 못 돌린 것: 대시보드 저장소 안(실제 `vitest.config.ts`, plugin-react)에서의 실행, 대시보드 전체 스위트, `palette-sweep.test.ts` 자체의 실행(정규식만 직접 적용), `next build`.
- 죽지 않는 변이 1건: 함정 (2)의 "눈금 값을 누적 덧셈으로" 는 문자열 테스트로 구분되지 않는다(선 수가 40 이하라 누적 오차가 `toFixed` 경계에 닿지 않는다). 구현은 `(i * step).toFixed(decimals)` 로 두었고 이 변이를 죽이는 테스트는 넣지 않았다.
- 스펙 그대로 두 축 모두 0 눈금을 낸다(`i = 0`, `j = 0`). 두 라벨이 같은 모서리 위치에 같은 글자로 겹친다(step 0.5 면 `0.0` 두 개). 솎기는 축별이라 둘 다 남는다. Task 12 가 축별로 라벨을 다른 방향으로 띄우지 않으면 한 글자처럼 보인다. Task 16 의 장면 1 에서 확인할 것.
- "눈금이 0" 의 문자열은 자릿수 규칙을 따른다: step >= 1 이면 `0`, step 0.5 면 `0.0`, step 0.05 면 `0.00`.
- 스펙이 정하지 않아 여기서 정한 것: (a) 영역 경계 위(`x === 0`, `x === cssW` 등)는 보이는 것으로 본다, (b) 축 이름 거리 `AXIS_NAME_OFFSET_FRAC = 0.08`, (c) `niceStep` 의 탐색 상한 `5 × 10^9`(비유한 범위가 들어와도 루프가 끝나게 하는 방어. 파서가 유한한 메타만 통과시키므로 정상 경로에서는 닿지 않는다), (d) `ticks` 순서(x 눈금, y 눈금, x 이름, y 이름).
- `nextDragCount` 의 하한 `min(n, 20_000)` 은 스펙 문구 그대로 두었다. 바깥의 `min(n, …)` 이 있어 `min(n, LOD_FLOOR)` 를 `LOD_FLOOR` 로 바꿔도 결과가 같다(동치 변이). clamp 순서를 바꾸는 변이는 `n < 20_000 이면 항상 n` 이 죽인다.

---
### Task 10: 뷰 순수 모듈: `pick.ts` + `controls.ts` (읽기 창 탐색, 입력 reducer)

**목표:** 커서 아래 최근접 점 찾기(`pickNearest`)와, 정규화된 입력 이벤트를 카메라·제스처 상태로 바꾸는 순수 reducer(`reduceControl`, 기본 동작을 막을지 알리는 `handled` 포함)가 스펙 §7.7 조작 표와 §7.9 탐색 규칙대로 검증된다.

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.1 D7·D10, §2.4(읽기 창 반경 12px), §7.2(`pick.ts`·`controls.ts` 시그니처), §7.4(표시 높이), §7.7(조작 표와 `handled` 열), §7.9(탐색 규칙), §10.4(`pick.test.ts`·`controls.test.ts` 행), §10.5(변이: 과장을 z 전체에 적용, Ctrl 없이도 휠 줌).

**Files:**
- Create: `dashboard/lib/viz/points3d/pick.ts`
- Create: `dashboard/lib/viz/points3d/controls.ts`
- Test(Create): `dashboard/lib/viz/points3d/__tests__/pick.test.ts`
- Test(Create): `dashboard/lib/viz/points3d/__tests__/controls.test.ts`
- Modify: 없음. 기존 파일을 한 줄도 고치지 않는다(`lib/domain/points3d.ts`, `mat4.ts`, `orbit.ts` 포함).

**Interfaces:**
- Consumes (앞 태스크가 이미 만들어 둔 것. 이름·시그니처를 그대로 쓴다):
  - T6 `dashboard/lib/domain/points3d.ts`: `export interface Points3dData { meta: Points3dMeta; xyz: Uint16Array; dev: Int16Array; }`(xyz 길이 3n, x,y,z 인터리브. dev 길이 n), `export const DEV_NO_DEVIATION = -32767;`(`d > -32767` 이면 편차 있는 점), `export const DEV_NOT_FLOOR = -32768;`(테스트에서만 쓴다), `Points3dMeta.extent_m: [number, number, number]`. 복원 식 `local = q × extent_m / 65535`(파일-로컬 m).
  - T8 `dashboard/lib/viz/points3d/orbit.ts`: `export interface OrbitState { target: [number, number, number]; distance: number; azimuth: number; elevation: number; fovy: number; radius: number; }`, `export function rotate(s: OrbitState, dxPx: number, dyPx: number): OrbitState;`(방위 `− dxPx × 0.005`, 고도 `+ dyPx × 0.005`, 고도는 ±89.9°로 clamp), `export function zoom(s: OrbitState, factor: number): OrbitState;`(거리 `× factor`, `[0.02 × radius, 20 × radius]`로 clamp), `export function pan(s: OrbitState, dxPx: number, dyPx: number, cssHPx: number): OrbitState;`(target만 옮긴다). 셋 다 입력을 바꾸지 않고 새 객체를 돌려준다.
  - 테스트에서만 T8: `fitToBounds(fit: Bounds, preset: ViewPreset): OrbitState`, `viewProj(s: OrbitState, aspect: number, full: Bounds): Float32Array`, `export interface Bounds { min: [number, number, number]; max: [number, number, number]; }`, `export const ELEVATION_LIMIT: number;`(89.9° 라디안)(이상 `orbit.ts`), `project(m: Float32Array, p: Vec3, cssW: number, cssH: number): { x: number; y: number; w: number } | null`(`mat4.ts`. x·y는 CSS px, 왼쪽 위 원점, y는 아래로 증가).
  - `pick.ts`는 `mat4.ts`의 `transformPoint`를 부르지 않는다. 점마다 길이 4 배열이 생기기 때문이다. 같은 식을 루프 안에 풀어 쓴다(열 우선 행렬 `m`에서 `clip.x = m[0]x + m[4]y + m[8]z + m[12]`, `clip.y = m[1]x + m[5]y + m[9]z + m[13]`, `clip.w = m[3]x + m[7]y + m[11]z + m[15]`).
- Produces (T12 `points3d-view.tsx`가 쓴다):
  - `pick.ts`: `export const PICK_RADIUS_PX = 12;`
  - `pick.ts`: `export function pickNearest(data: Points3dData, viewProj: Float32Array, exaggeration: number, cssW: number, cssH: number, cursorX: number, cursorY: number, radiusPx?: number): number | null;` 점 인덱스 또는 null. 전부 CSS px, 커서는 캔버스 왼쪽 위 기준, `radiusPx` 기본 12.
  - `controls.ts`: `export type ControlEvent = { type: 'down' | 'move' | 'up' | 'cancel'; pointerId: number; x: number; y: number; button: number; shiftKey: boolean } | { type: 'wheel'; deltaY: number; ctrlKey: boolean; metaKey: boolean } | { type: 'key'; key: string };`
  - `controls.ts`: `export interface ControlState { camera: OrbitState; pointers: Record<number, { x: number; y: number; button: number; shift: boolean }>; pinchDist: number; }`
  - `controls.ts`: `export function reduceControl(s: ControlState, e: ControlEvent, cssHPx: number): { state: ControlState; handled: boolean };`
  - `controls.ts`: `export function initialControlState(camera: OrbitState): ControlState;`(pointers = {}, pinchDist = 0) `export function isGesturing(s: ControlState): boolean;`(눌린 포인터가 하나라도 있는가)
  - `controls.ts`: `export const WHEEL_ZOOM_RATE = 0.001;` `export const KEY_ROTATE_PX = 20;` `export const KEY_ZOOM_IN = 0.9;` `export const KEY_ZOOM_OUT = 1.1;`
  - 동작 성질(테스트가 고정한다. T12가 기대도 된다):
    - `handled === true`는 Ctrl+휠, Cmd+휠, 화살표 키 4개뿐이다. 포인터 이벤트, 일반 휠, `+`·`=`·`-`, 그 밖의 키는 전부 `false`.
    - 카메라가 변하지 않는 입력(일반 휠, 그 밖의 키, 누르지 않은 포인터의 move, down, up, cancel, 세 포인터 이상일 때의 move)에서는 `state.camera === s.camera`(참조 동일)다. 일반 휠·그 밖의 키·누르지 않은 포인터의 move는 `state === s`다.
    - `reduceControl`은 `s`와 그 안의 객체를 바꾸지 않는다.
    - Ctrl·Cmd·Alt가 눌린 키 입력을 걸러 내는 것은 T12(뷰)의 책임이다. reducer는 `key` 문자열만 본다.

**구현자가 알아야 할 스펙 규칙(발췌)**

읽기 창 탐색(§7.9, §7.4):
- 화면 거리 12px 이내에서 **화면상 가장 가까운 점** 하나. 거리가 같으면 카메라에 가까운 점(클립 `w`가 작은 점).
- 점의 화면 위치는 표시 위치다: `z' = z + dev_m × (k − 1)`. `k`는 과장 배율(1, 10, 50, 100), `dev_m = dev × 1e-4`(dev는 0.1mm 정수). **편차만** 과장한다. 편차 없는 점(`dev <= -32767`, 센티널 두 종 `-32768`·`-32767`)은 어느 배율에서도 제자리다.
- 카메라 뒤(`w <= 0`)의 점은 찾지 않는다.

조작 표(§7.7). `handled`는 "호출자가 `preventDefault`를 불러야 하는가"다:

| 입력 | 동작 | `handled` |
|---|---|---|
| 왼쪽 버튼 드래그, 한 손가락 드래그 | 회전(1px당 0.005rad). 오른쪽으로 끌면 방위가 줄고, 아래로 끌면 고도가 는다 = `rotate(camera, dx, dy)` | false |
| Shift+드래그, 오른쪽 버튼 드래그 | 팬 = `pan(camera, dx, dy, cssHPx)`. 판정은 down 때 저장한 `button === 2 \|\| shift` | false |
| Ctrl+휠, Cmd+휠 | 줌 = `zoom(camera, exp(deltaY × 0.001))` | **true** |
| 두 손가락 핀치 | `pan(camera, dx / 2, dy / 2, cssHPx)` 뒤, 직전 간격이 있으면(`pinchDist > 0 && d > 0`) `zoom(·, pinchDist / d)`. 그리고 `pinchDist = d` | false |
| `ArrowLeft` / `ArrowRight` | 방위 +0.1rad / −0.1rad = `rotate(camera, −20, 0)` / `rotate(camera, +20, 0)` | **true** |
| `ArrowUp` / `ArrowDown` | 고도 +0.1rad / −0.1rad = `rotate(camera, 0, +20)` / `rotate(camera, 0, −20)`(고도 제한은 `rotate`가 건다) | **true** |
| `+`, `=` / `-` | 줌 ×0.9 / ×1.1 | false |
| 일반 휠(Ctrl·Cmd 없음) | 가로채지 않는다. 카메라 불변 | false |
| 그 밖의 키 | 없음 | false |

down·up·cancel에서 `pinchDist = 0`.

**시제품과 다른 점(스펙이 이긴다):** `.superpowers/research/3d-pointcloud-viewer/design-inputs/proto/viz/controls.js`는 DOM 리스너를 직접 붙이고 휠을 무조건 가로챈다(`e.preventDefault()` + 줌). 이 태스크의 `controls.ts`는 DOM 이벤트 객체를 받지 않는 순수 reducer이고, 일반 휠은 카메라를 바꾸지 않으며 `handled: false`를 돌려준다. 화살표 키 부호는 시제품이 아니라 위 표로 단언한다.

**테스트 기대값의 근거(손 계산)**

`pick.test.ts`는 실제 카메라 대신 손으로 만든 행렬을 쓴다. 화면 위치를 암산할 수 있고, 2진 소수로 정확히 떨어져 "정확히 12px"와 "화면 거리 동률"을 오차 없이 만들 수 있다.

- 축 범위 `65535 / 1024` m: 복원 식 `q × extent / 65535`가 정확히 `q / 1024` m가 된다. 좌표를 1/1024의 배수로만 적으면 오차가 없다.
- 행렬: `clip.x = x − 5`, `clip.y = z − 1`, `clip.w = y − 2`(로컬 (5, 2, 1)에서 +y를 보는 카메라). 캔버스 400×300이면 화면 x = `((x − 5) / (y − 2) + 1) × 200`, 화면 y = `(1 − (z − 1) / (y − 2)) × 150`.
- 점 (5, 3, 1): w = 1, clip = (0, 0) → 화면 (200, 150).
- 점 (5.03125, 3, 1): clip.x = 32/1024 = 0.03125 → 화면 x = 1.03125 × 200 = 206.25.
- 점 (5, 3, 1.03125): clip.y = 0.03125 → 화면 y = 0.96875 × 150 = 145.3125.
- 같은 시선 위의 두 점 (5.5, 3, 1.25)[w = 1]와 (6, 4, 1.5)[w = 2]: 둘 다 clip/w = (0.5, 0.25) → 화면 (300, 112.5). 커서 (303, 116.5)에서 제곱 거리가 정확히 9 + 16 = 25.
- 편차 +1000(= +100.0mm = 0.1m), k = 10: z' = 1 + 0.1 × 9 = 1.9 → clip.y = 0.9 → 화면 y = 0.1 × 150 = 15. k = 50: z' = 5.9 → 화면 y = (1 − 4.9) × 150 = −585. 편차 −1000, k = 10: z' = 0.1 → clip.y = −0.9 → 화면 y = 1.9 × 150 = 285.
- 변이가 `k − 1` 대신 `k`를 쓰면 k = 1에서 z' = 1.1 → 화면 y = 135(15px 이동)라 실제 위치에서 못 찾는다. 편차를 100mm로 크게 잡은 이유다(10mm면 1.5px밖에 안 움직여 변이가 살아남는다).

`controls.test.ts`의 카메라는 손으로 적은 값이다: `distance 10, azimuth −1, elevation 0.3, radius 4`(줌 제한 `[0.08, 80]`).

- 드래그 (100,100) → (130,90): dx = +30, dy = −10 → 방위 −1 − 30 × 0.005 = −1.15, 고도 0.3 − 10 × 0.005 = 0.25. 이어서 → (110,150): dx = −20, dy = +60 → 방위 −1.05, 고도 0.55.
- Ctrl+휠 deltaY = +100: 10 × e^0.1 = 11.051709180756477. deltaY = −100: 10 × e^−0.1 = 9.048374180359595. deltaY = +5000: 10 × e^5 ≈ 1484 → 제한 20 × 4 = 80.
- 화살표: 20px × 0.005 = 0.1rad. ArrowLeft 방위 −0.9, ArrowRight −1.1, ArrowUp 고도 0.4, ArrowDown 0.2.
- `+`·`=`: 10 × 0.9 = 9. `-`: 10 × 1.1 = 11.
- 핀치: 손가락 1 (100,100), 손가락 2 (200,100). 손가락 2 → (220,100): 간격 120, 중점 이동 10px, 기준 간격이 없어 줌 없음. 손가락 2 → (196,228): dx = −24, dy = 128, 간격 hypot(96, 128) = 160, 줌 120/160 = 0.75 → 거리 7.5. 손가락 1 → (148,164): dx = 48, dy = 64, 간격 hypot(48, 64) = 80, 줌 160/80 = 2 → 거리 15.
- 팬의 target 이동량은 T8 `pan`의 책임이다. 이 태스크의 테스트는 "`pan(카메라, dx, dy, cssHPx)`를 그 인자로 불렀는가"를 `pan`을 직접 부른 결과와 비교해 확인하고, 각도·거리가 그대로이고 target이 달라졌는지를 따로 단언한다.

---

- [ ] **Step 1: 앞 태스크 산출물 확인**

이 태스크는 T6·T8이 만든 파일을 import한다. 없으면 여기서 멈추고 보고한다(대체물을 만들지 않는다).

Run:
```bash
cd dashboard
grep -cE "^export (const (DEV_NO_DEVIATION|DEV_NOT_FLOOR)|interface Points3dData)\b" lib/domain/points3d.ts
grep -cE "^export (function (rotate|zoom|pan|fitToBounds|viewProj)|const ELEVATION_LIMIT|interface (OrbitState|Bounds))\b" lib/viz/points3d/orbit.ts
grep -cE "^export function project\b" lib/viz/points3d/mat4.ts
ls lib/viz/points3d/pick.ts lib/viz/points3d/controls.ts 2>&1
```
Expected: 차례로 `3`, `8`, `1`. 마지막 `ls`는 두 파일 모두 `No such file or directory`(아직 없다).

이 두 모듈은 Next.js API를 쓰지 않는 순수 TypeScript다(React·DOM·WebGL import 없음). `dashboard/AGENTS.md`가 요구하는 `node_modules/next/dist/docs/` 확인 대상이 아니다. `'use client'`를 붙이지 않는다.

- [ ] **Step 2: `pickNearest`의 실패하는 테스트 작성**

Create `dashboard/lib/viz/points3d/__tests__/pick.test.ts`:

```ts
// pickNearest: 읽기 창이 띄울 점 하나를 찾는다(스펙 §7.9).
// 대부분의 테스트는 손으로 만든 행렬을 써서 화면 위치를 암산으로 적는다.
// 마지막 한 건만 실제 궤도 카메라(orbit.ts)로 행렬 원소 배치를 확인한다.
import { describe, expect, it } from 'vitest';
import { DEV_NOT_FLOOR, DEV_NO_DEVIATION, type Points3dData } from '@/lib/domain/points3d';
import { project } from '../mat4';
import { fitToBounds, viewProj, type Bounds } from '../orbit';
import { PICK_RADIUS_PX, pickNearest } from '../pick';

// 축 범위를 65535 / 1024 m 로 두면 로컬 좌표가 정확히 q / 1024 m 가 된다(2진 소수라 오차가 없다).
// 아래 좌표는 전부 1/1024 의 배수로 적는다.
const EXTENT = 65535 / 1024;
type Pt = [x: number, y: number, z: number, dev: number]; // m, m, m, 0.1mm 정수(또는 센티널)

function makeData(points: Pt[], extent: [number, number, number] = [EXTENT, EXTENT, EXTENT]): Points3dData {
  const n = points.length;
  const xyz = new Uint16Array(3 * n);
  const dev = new Int16Array(n);
  points.forEach(([x, y, z, d], i) => {
    xyz[3 * i] = Math.round((x / extent[0]) * 65535);
    xyz[3 * i + 1] = Math.round((y / extent[1]) * 65535);
    xyz[3 * i + 2] = Math.round((z / extent[2]) * 65535);
    dev[i] = d;
  });
  return {
    meta: {
      schema_version: 1, n_points: n, units: 'm',
      origin_m: [254012.3371, 4180044.9126, 31.4802], extent_m: extent,
      deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
      sample_cell_m: 0.0125,
      fit_bounds: { min: [0, 0, 0], max: extent },
      sampling: { method: 'cell min-hash stratified', source_points: n, cap: 500000 },
      order: 'hash',
    },
    xyz, dev,
  };
}

// 손으로 만든 카메라: 로컬 (5, 2, 1) 에서 +y 방향을 본다(열 우선 배치).
//   clip.x = x - 5,  clip.y = z - 1,  clip.w = y - 2
//   화면 x = ((x - 5) / (y - 2) + 1) * W / 2
//   화면 y = (1 - (z - 1) / (y - 2)) * H / 2      (z 가 클수록 화면 위쪽)
const CAM = new Float32Array([
  1, 0, 0, 0, //   열 0: x 의 계수 (clip.x, clip.y, clip.z, clip.w)
  0, 0, 1, 1, //   열 1: y 의 계수
  0, 1, 0, 0, //   열 2: z 의 계수
  -5, -1, 0, -2, // 열 3: 상수항
]);
const W = 400;
const H = 300; // 화면 중심은 (200, 150)

const pick = (data: Points3dData, k: number, cx: number, cy: number, r?: number) =>
  pickNearest(data, CAM, k, W, H, cx, cy, r);

describe('pickNearest: 반경', () => {
  // (5, 3, 1): w = 1, clip = (0, 0) -> 화면 (200, 150)
  const one = makeData([[5, 3, 1, 0]]);

  it('기본 반경은 12px 이다', () => {
    expect(PICK_RADIUS_PX).toBe(12);
  });

  it('12px 이내의 점을 찾는다', () => {
    expect(pick(one, 1, 210, 150)).toBe(0); // 가로 10px
    expect(pick(one, 1, 200, 141)).toBe(0); // 세로 9px
    expect(pick(one, 1, 208, 158)).toBe(0); // 대각선 sqrt(64 + 64) = 11.3px
    expect(pick(one, 1, 212, 150)).toBe(0); // 정확히 12px 은 "이내"다(좌표가 정확해 제곱 거리가 딱 144)
  });

  it('12px 밖이면 null 이다', () => {
    expect(pick(one, 1, 213, 150)).toBeNull(); // 가로 13px
    expect(pick(one, 1, 200, 163)).toBeNull(); // 세로 13px
    // 대각선 sqrt(81 + 81) = 12.7px. 축별로 따로 비교하면(9 <= 12) 잘못 찾는다
    expect(pick(one, 1, 209, 159)).toBeNull();
  });

  it('radiusPx 인자가 기본 반경을 바꾼다', () => {
    expect(pick(one, 1, 213, 150, 20)).toBe(0); // 13px, 반경 20
    expect(pick(one, 1, 210, 150, 5)).toBeNull(); // 10px, 반경 5
  });

  it('점이 없으면 null 이다', () => {
    expect(pick(makeData([]), 1, 200, 150)).toBeNull();
  });
});

describe('pickNearest: 화면상 최근접', () => {
  // 0: (5, 3, 1)             -> (200, 150)
  // 1: (5 + 32/1024, 3, 1)   -> clip.x = 0.03125 -> 화면 x = 1.03125 * 200 = 206.25 -> (206.25, 150)
  // 2: (5, 3, 1 + 32/1024)   -> clip.y = 0.03125 -> 화면 y = 0.96875 * 150 = 145.3125 -> (200, 145.3125)
  const three = makeData([[5, 3, 1, 0], [5.03125, 3, 1, 0], [5, 3, 1.03125, 0]]);

  it('반경 안의 여러 점 중 화면 거리가 가장 짧은 점을 고른다(먼저 나온 점이 아니다)', () => {
    expect(pick(three, 1, 204, 150)).toBe(1); // 거리 4 / 2.25 / 6.2
    expect(pick(three, 1, 201, 147)).toBe(2); // 제곱 거리 10 / 36.6 / 3.8
    expect(pick(three, 1, 199, 152)).toBe(0); // 제곱 거리 5 / 56.6 / 45.7
  });

  it('z 가 큰 점이 화면 위쪽(y 가 작은 쪽)에 있다', () => {
    expect(pick(three, 1, 200, 140)).toBe(2); // 점 2 까지 5.3px, 점 0 까지 10px
    expect(pick(three, 1, 200, 160)).toBe(0); // 점 0 까지 10px, 점 2 는 14.7px 로 반경 밖
  });

  it('화면 거리가 같으면 카메라에 가까운 점(클립 w 가 작은 점)을 고른다', () => {
    // 같은 시선 위의 두 점: near (5.5, 3, 1.25) 는 w = 1, clip = (0.5, 0.25)
    //                      far  (6, 4, 1.5)    는 w = 2, clip = (1, 0.5) -> 나누면 같은 (0.5, 0.25)
    // 둘 다 화면 (300, 112.5). 커서 (303, 116.5) 에서 제곱 거리가 정확히 25 로 같다
    const near: Pt = [5.5, 3, 1.25, 0];
    const far: Pt = [6, 4, 1.5, 0];
    expect(pick(makeData([far, near]), 1, 303, 116.5)).toBe(1); // 먼저 나온 점이 이기면 0 이 된다
    expect(pick(makeData([near, far]), 1, 303, 116.5)).toBe(0); // 나중 점이 이기면 1 이 된다
  });

  it('카메라 뒤(w <= 0)의 점은 찾지 않는다', () => {
    // (5, 1, 1): w = -1, clip = (0, 0) -> 나누면 화면 중심에 겹쳐 보이지만 카메라 뒤다
    expect(pick(makeData([[5, 1, 1, 0]]), 1, 200, 150)).toBeNull();
    // (5, 2, 1): w = 0
    expect(pick(makeData([[5, 2, 1, 0]]), 1, 200, 150)).toBeNull();
    // 뒤의 점은 건너뛰고 앞의 점을 찾는다
    expect(pick(makeData([[5, 1, 1, 0], [5, 3, 1, 0]]), 1, 200, 150)).toBe(1);
  });
});

describe('pickNearest: 편차 과장(표시 높이 z + dev * (k - 1))', () => {
  // dev = +1000 은 +100.0mm = 0.1m. 실제 위치 (5, 3, 1) -> 화면 (200, 150)
  const up = makeData([[5, 3, 1, 1000]]);
  const down = makeData([[5, 3, 1, -1000]]);

  it('k = 1 이면 실제 위치에서 찾는다', () => {
    // dev * k 로 잘못 올리면 z = 1.1 -> 화면 y = 135 가 되어 15px 밖으로 나간다
    expect(pick(up, 1, 200, 150)).toBe(0);
    expect(pick(down, 1, 200, 150)).toBe(0);
  });

  it('양의 편차는 k 가 커지면 화면 위로 옮겨 간 자리에서 찾는다', () => {
    // k = 10: z' = 1 + 0.1 * 9 = 1.9 -> clip.y = 0.9 -> 화면 y = 0.1 * 150 = 15
    expect(pick(up, 10, 200, 15)).toBe(0);
    expect(pick(up, 10, 200, 150)).toBeNull(); // 실제 위치에는 이제 없다
    // k = 50: z' = 1 + 0.1 * 49 = 5.9 -> clip.y = 4.9 -> 화면 y = -3.9 * 150 = -585 (영역 밖)
    expect(pick(up, 50, 200, 15)).toBeNull();
    expect(pick(up, 50, 200, -585)).toBe(0);
  });

  it('음의 편차는 화면 아래로 옮겨 간다', () => {
    // k = 10: z' = 1 - 0.9 = 0.1 -> clip.y = -0.9 -> 화면 y = 1.9 * 150 = 285
    expect(pick(down, 10, 200, 285)).toBe(0);
    expect(pick(down, 10, 200, 15)).toBeNull(); // 부호를 뒤집으면 여기서 찾힌다
  });

  it('편차 없는 점(두 센티널)은 과장에도 제자리다', () => {
    // 센티널을 편차로 읽으면 -32768 * 1e-4 * 99 = -324m 만큼 내려가 반경 밖으로 사라진다
    for (const sentinel of [DEV_NOT_FLOOR, DEV_NO_DEVIATION]) {
      const d = makeData([[5, 3, 1, sentinel]]);
      for (const k of [1, 10, 50, 100]) expect(pick(d, k, 200, 150)).toBe(0);
    }
  });

  it('같은 자리의 편차 있는 점과 편차 없는 점이 과장에서 갈라진다', () => {
    const mixed = makeData([[5, 3, 1, DEV_NOT_FLOOR], [5, 3, 1, 1000], [5, 3, 1, DEV_NO_DEVIATION]]);
    expect(pick(mixed, 10, 200, 15)).toBe(1); // 편차 있는 점만 올라갔다
    expect(pick(mixed, 10, 200, 150)).toBe(0); // 제자리에 남은 것은 센티널 점(동률이면 앞 인덱스)
  });
});

describe('pickNearest: 실제 궤도 카메라', () => {
  it('project 가 준 표시 위치에서 그 점 자신을 찾는다(세 프리셋, k = 1 과 50)', () => {
    const extent: [number, number, number] = [8, 6, 0.5];
    const pts: Pt[] = [
      [1, 1, 0.1, 30], [7, 1, 0.2, -80], [1, 5, 0.3, 0],
      [7, 5, 0.4, DEV_NOT_FLOOR], [4, 3, 0.25, 120], [2.5, 4, 0.05, DEV_NO_DEVIATION],
    ];
    const data = makeData(pts, extent);
    const full: Bounds = { min: [0, 0, 0], max: extent };
    for (const preset of ['iso', 'top', 'front'] as const) {
      const vp = viewProj(fitToBounds(full, preset), 640 / 480, full);
      for (const k of [1, 50]) {
        pts.forEach(([, , , d], i) => {
          // 양자화된 좌표에서 표시 위치를 따로 계산해 project 로 화면에 옮긴다
          const x = (data.xyz[3 * i] * extent[0]) / 65535;
          const y = (data.xyz[3 * i + 1] * extent[1]) / 65535;
          const z = (data.xyz[3 * i + 2] * extent[2]) / 65535;
          const shownZ = d > DEV_NO_DEVIATION ? z + d * 1e-4 * (k - 1) : z;
          const s = project(vp, [x, y, shownZ], 640, 480);
          expect(s).not.toBeNull();
          expect(pickNearest(data, vp, k, 640, 480, s!.x, s!.y)).toBe(i);
        });
      }
    }
  });
});
```

각 테스트가 죽이는 변이:

| 테스트 | 죽이는 변이 |
|---|---|
| 기본 반경은 12px 이다 | `PICK_RADIUS_PX` 값을 바꿈 |
| 12px 이내의 점을 찾는다 | 반경 경계를 제외(`>=`), `cssW`·`cssH`를 바꿔 씀, xyz의 x·y 전치, 행렬을 행 우선으로 읽음 |
| 12px 밖이면 null 이다 | 반경 무시(`bestD2 = Infinity`), 축별로 따로 비교(`max(dx², dy²)`) |
| radiusPx 인자가 기본 반경을 바꾼다 | `radiusPx` 인자를 무시하고 항상 12 |
| 점이 없으면 null 이다 | 빈 데이터에서 `-1`이나 `0`을 돌려줌 |
| 반경 안의 여러 점 중 화면 거리가 가장 짧은 점을 고른다(먼저 나온 점이 아니다) | 반경 안의 첫 점을 곧바로 반환 |
| z 가 큰 점이 화면 위쪽(y 가 작은 쪽)에 있다 | 화면 y를 뒤집지 않음(`(clip.y / w + 1) × H / 2`) |
| 화면 거리가 같으면 카메라에 가까운 점(클립 w 가 작은 점)을 고른다 | 동률 처리 제거(먼저 나온 점이 이김), 나중 점이 이김, 먼 점이 이김 |
| 카메라 뒤(w <= 0)의 점은 찾지 않는다 | `w <= 0` 가드 제거, `w < 0`으로 완화(w = 0에서 NaN 거리로 잘못 선택) |
| k = 1 이면 실제 위치에서 찾는다 | `(k − 1)` 대신 `k`를 곱함 |
| 양의 편차는 k 가 커지면 화면 위로 옮겨 간 자리에서 찾는다 | 과장을 무시하고 실제 위치로 찾음, **과장을 z 전체에 적용(`z × k`)**, 편차 부호 반전 |
| 음의 편차는 화면 아래로 옮겨 간다 | 편차 부호 반전, 절댓값으로 올림 |
| 편차 없는 점(두 센티널)은 과장에도 제자리다 | **과장을 z 전체에 적용**, 센티널 가드 제거, 가드 경계를 `>=`로(−32767을 편차로 읽음) |
| 같은 자리의 편차 있는 점과 편차 없는 점이 과장에서 갈라진다 | 위 세 가지 + 동률이면 나중 점 |
| project 가 준 표시 위치에서 그 점 자신을 찾는다(세 프리셋, k = 1 과 50) | `extent_m` 축을 섞음, 행렬 원소 배치 착오(손으로 만든 행렬은 0이 많아 못 잡는 것), 센티널 가드 |

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `cd dashboard && npx vitest run lib/viz/points3d/__tests__/pick.test.ts`
Expected: FAIL. `Error: Failed to resolve import "../pick" from "lib/viz/points3d/__tests__/pick.test.ts". Does the file exist?`, `Test Files  1 failed (1)`, `Tests  no tests`. (저장소의 vitest 설정(`@vitejs/plugin-react`)이 내는 문구다. 플러그인 없는 설정에서는 같은 상황이 `Error: Cannot find module '../pick' imported from ...`로 찍힌다. 어느 쪽이든 모듈 해석 실패 1건이고 테스트는 0건 실행된다.)

- [ ] **Step 4: `pick.ts` 구현**

Create `dashboard/lib/viz/points3d/pick.ts`:

```ts
// 읽기 창용 최근접 점 탐색(순수 함수). 커서 아래에서 화면상 가장 가까운 점 하나를 찾는다.
// 점 50만 개를 프레임당 한 번 도는 함수라 점마다 배열·객체를 만들지 않고 행렬 원소를 꺼내 직접 계산한다.
import { DEV_NO_DEVIATION, type Points3dData } from '@/lib/domain/points3d';

export const PICK_RADIUS_PX = 12; // 읽기 창 반경(CSS px)

const DEV_Q_TO_M = 1e-4; // 편차 정수(0.1mm) -> m

// 점 인덱스 또는 null. cssW·cssH·cursorX·cursorY·radiusPx 는 전부 CSS px 이고 커서는 캔버스 왼쪽 위 기준이다.
// 점의 화면 위치는 표시 위치(z + dev * (k - 1))다. 편차 없는 점(두 센티널)은 과장하지 않는다.
// 화면 거리가 같으면 카메라에 가까운 점(클립 w 가 작은 점)을 고른다. 카메라 뒤(w <= 0)의 점은 건너뛴다.
export function pickNearest(
  data: Points3dData, viewProj: Float32Array, exaggeration: number,
  cssW: number, cssH: number, cursorX: number, cursorY: number,
  radiusPx: number = PICK_RADIUS_PX,
): number | null {
  const { xyz, dev } = data;
  const n = dev.length;
  // 복원 식 local = q * extent_m / 65535 의 축별 계수
  const sx = data.meta.extent_m[0] / 65535;
  const sy = data.meta.extent_m[1] / 65535;
  const sz = data.meta.extent_m[2] / 65535;
  const lift = (exaggeration - 1) * DEV_Q_TO_M; // dev 정수 1 당 올릴 높이(m)
  const noDev = DEV_NO_DEVIATION; // 루프 안에서 모듈 바인딩을 매번 읽지 않도록 지역 변수로 꺼낸다
  // 열 우선 행렬에서 clip.x, clip.y, clip.w 행만 쓴다(깊이 행은 필요 없다)
  const m0 = viewProj[0], m4 = viewProj[4], m8 = viewProj[8], m12 = viewProj[12];
  const m1 = viewProj[1], m5 = viewProj[5], m9 = viewProj[9], m13 = viewProj[13];
  const m3 = viewProj[3], m7 = viewProj[7], m11 = viewProj[11], m15 = viewProj[15];
  const halfW = cssW / 2;
  const halfH = cssH / 2;

  let best = -1;
  let bestD2 = radiusPx * radiusPx; // 제곱 거리로 비교한다. 반경 경계는 포함
  let bestW = Infinity;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const x = xyz[j] * sx;
    const y = xyz[j + 1] * sy;
    let z = xyz[j + 2] * sz;
    const d = dev[i];
    if (d > noDev) z += d * lift; // 편차만 과장한다
    const w = m3 * x + m7 * y + m11 * z + m15;
    if (w <= 0) continue; // 카메라 뒤
    const dx = ((m0 * x + m4 * y + m8 * z + m12) / w + 1) * halfW - cursorX;
    const dy = (1 - (m1 * x + m5 * y + m9 * z + m13) / w) * halfH - cursorY; // 화면 y 는 아래로 증가
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2) continue;
    if (d2 < bestD2 || w < bestW) {
      best = i;
      bestD2 = d2;
      bestW = w;
    }
  }
  return best < 0 ? null : best;
}
```

주의:
- 루프 안에서 배열·객체를 만들지 않는다(`transformPoint`, `localOf`, 구조 분해 금지). 점 50만 개를 프레임당 한 번 돈다.
- 거리 비교는 제곱 거리로 한다(`Math.hypot`·`Math.sqrt` 없음). `bestD2`의 초기값이 반경의 제곱이라 반경 밖의 점은 첫 비교에서 걸러진다.
- `d2 > bestD2`면 건너뛰고, 남은 경우(`d2 <= bestD2`)에서 `d2 < bestD2`이거나 `w < bestW`일 때만 갱신한다. 그래서 동률에서는 `w`가 작은 점이, `w`까지 같으면 앞 인덱스가 남는다.
- `Float32Array` 사본을 만들지 않는다. `data.xyz`(Uint16Array)를 그대로 읽는다.

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `cd dashboard && npx vitest run lib/viz/points3d/__tests__/pick.test.ts`
Expected: PASS. `Test Files  1 passed (1)`, `Tests  15 passed (15)`.

- [ ] **Step 6: `reduceControl`의 실패하는 테스트 작성**

Create `dashboard/lib/viz/points3d/__tests__/controls.test.ts`:

```ts
// reduceControl: 정규화된 입력 이벤트 -> 카메라·제스처 상태(스펙 §7.7 조작 표).
// handled 는 "호출자가 preventDefault 해야 하는가"다. 표의 "기본 동작 막음" 열과 한 줄씩 맞춘다.
import { describe, expect, it } from 'vitest';
import { ELEVATION_LIMIT, pan, zoom, type OrbitState } from '../orbit';
import {
  KEY_ROTATE_PX, KEY_ZOOM_IN, KEY_ZOOM_OUT, WHEEL_ZOOM_RATE,
  initialControlState, isGesturing, reduceControl,
  type ControlEvent, type ControlState,
} from '../controls';

const H = 480; // canvas.clientHeight (CSS px)

// 손으로 적은 카메라. 줌 제한은 [0.02 * 4, 20 * 4] = [0.08, 80] 이다
const CAM: OrbitState = {
  target: [5, 4, 0], distance: 10, azimuth: -1, elevation: 0.3,
  fovy: (40 * Math.PI) / 180, radius: 4,
};

type PointerType = 'down' | 'move' | 'up' | 'cancel';
const ptr = (
  type: PointerType, pointerId: number, x: number, y: number,
  over: { button?: number; shiftKey?: boolean } = {},
): ControlEvent => ({ type, pointerId, x, y, button: 0, shiftKey: false, ...over });
const wheel = (deltaY: number, over: { ctrlKey?: boolean; metaKey?: boolean } = {}): ControlEvent =>
  ({ type: 'wheel', deltaY, ctrlKey: false, metaKey: false, ...over });
const key = (k: string): ControlEvent => ({ type: 'key', key: k });

// 이벤트를 차례로 넣고 마지막 상태를 돌려준다
function run(events: ControlEvent[], start: ControlState = initialControlState(CAM), cssH = H): ControlState {
  return events.reduce((s, e) => reduceControl(s, e, cssH).state, start);
}

function expectCameraClose(actual: OrbitState, expected: OrbitState) {
  expect(actual.distance).toBeCloseTo(expected.distance, 10);
  expect(actual.azimuth).toBeCloseTo(expected.azimuth, 10);
  expect(actual.elevation).toBeCloseTo(expected.elevation, 10);
  expect(actual.fovy).toBe(expected.fovy);
  expect(actual.radius).toBe(expected.radius);
  for (let i = 0; i < 3; i++) expect(actual.target[i]).toBeCloseTo(expected.target[i], 10);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

describe('상수와 초기 상태', () => {
  it('스펙 §7.7 의 값이다', () => {
    expect(WHEEL_ZOOM_RATE).toBe(0.001);
    expect(KEY_ROTATE_PX).toBe(20);
    expect(KEY_ZOOM_IN).toBe(0.9);
    expect(KEY_ZOOM_OUT).toBe(1.1);
  });

  it('initialControlState 는 눌린 포인터가 없는 상태다', () => {
    const s = initialControlState(CAM);
    expect(s.camera).toBe(CAM);
    expect(s.pointers).toEqual({});
    expect(s.pinchDist).toBe(0);
    expect(isGesturing(s)).toBe(false);
  });
});

describe('휠', () => {
  it('Ctrl·Cmd 없는 휠은 가로채지 않는다: handled false, 카메라 불변', () => {
    const s = initialControlState(CAM);
    for (const deltaY of [100, -100, 5000]) {
      const r = reduceControl(s, wheel(deltaY), H);
      expect(r.handled).toBe(false);
      expect(r.state.camera).toBe(CAM); // 참조까지 같다(다시 그릴 이유가 없다)
      expect(r.state.camera.distance).toBe(10);
    }
  });

  it('Ctrl+휠은 distance * exp(deltaY * 0.001) 로 줌하고 handled true', () => {
    const s = initialControlState(CAM);
    const out = reduceControl(s, wheel(100, { ctrlKey: true }), H);
    expect(out.handled).toBe(true);
    expect(out.state.camera.distance).toBeCloseTo(11.051709180756477, 10); // 10 * e^0.1 (멀어진다)
    const inn = reduceControl(s, wheel(-100, { ctrlKey: true }), H);
    expect(inn.handled).toBe(true);
    expect(inn.state.camera.distance).toBeCloseTo(9.048374180359595, 10); // 10 * e^-0.1 (가까워진다)
    // 줌은 거리만 바꾼다
    expectCameraClose(out.state.camera, { ...CAM, distance: 11.051709180756477 });
  });

  it('Cmd+휠(metaKey)도 같은 줌이고 handled true', () => {
    const r = reduceControl(initialControlState(CAM), wheel(100, { metaKey: true }), H);
    expect(r.handled).toBe(true);
    expect(r.state.camera.distance).toBeCloseTo(11.051709180756477, 10);
  });

  it('줌 제한(20 * radius)을 넘지 않는다', () => {
    // 10 * e^5 = 1484 -> 20 * 4 = 80 으로 잘린다
    const r = reduceControl(initialControlState(CAM), wheel(5000, { ctrlKey: true }), H);
    expect(r.state.camera.distance).toBe(80);
    expect(r.handled).toBe(true);
  });
});

describe('한 포인터 드래그', () => {
  it('왼쪽 버튼 드래그는 회전: 오른쪽으로 끌면 방위가 줄고 아래로 끌면 고도가 는다(1px 당 0.005rad)', () => {
    // (100,100) -> (130,90): dx = +30, dy = -10 -> 방위 -1 - 0.15, 고도 0.3 - 0.05
    const a = run([ptr('down', 1, 100, 100), ptr('move', 1, 130, 90)]);
    expectCameraClose(a.camera, { ...CAM, azimuth: -1.15, elevation: 0.25 });
    // 이어서 (130,90) -> (110,150): dx = -20, dy = +60 -> 방위 -1.15 + 0.1, 고도 0.25 + 0.3
    // (직전 위치를 저장하지 않으면 down 지점 기준 dx = +10, dy = +50 이 되어 값이 달라진다)
    const b = run([ptr('move', 1, 110, 150)], a);
    expectCameraClose(b.camera, { ...CAM, azimuth: -1.05, elevation: 0.55 });
  });

  it('Shift+드래그는 팬: target 만 움직이고 각도·거리는 그대로', () => {
    const s = run([ptr('down', 1, 100, 100, { shiftKey: true }), ptr('move', 1, 148, 124, { shiftKey: true })]);
    expectCameraClose(s.camera, pan(CAM, 48, 24, H));
    expect(s.camera.azimuth).toBe(CAM.azimuth);
    expect(s.camera.elevation).toBe(CAM.elevation);
    expect(s.camera.distance).toBe(CAM.distance);
    expect(s.camera.target).not.toEqual(CAM.target);
  });

  it('오른쪽 버튼 드래그도 팬', () => {
    const s = run([ptr('down', 1, 100, 100, { button: 2 }), ptr('move', 1, 148, 124, { button: 2 })]);
    expectCameraClose(s.camera, pan(CAM, 48, 24, H));
    expect(s.camera.azimuth).toBe(CAM.azimuth);
  });

  it('팬·회전 판정은 down 때의 button·shift 로 한다(move 의 값은 보지 않는다)', () => {
    // Shift 를 누른 채 시작했다가 떼어도 팬이 이어진다
    const p = run([ptr('down', 1, 100, 100, { shiftKey: true }), ptr('move', 1, 148, 124)]);
    expectCameraClose(p.camera, pan(CAM, 48, 24, H));
    // 그냥 시작한 드래그는 도중에 Shift 를 눌러도 회전이다
    const r = run([ptr('down', 1, 100, 100), ptr('move', 1, 130, 90, { shiftKey: true, button: 2 })]);
    expectCameraClose(r.camera, { ...CAM, azimuth: -1.15, elevation: 0.25 });
  });

  it('팬은 cssHPx 를 pan 에 그대로 넘긴다(높이가 절반이면 이동량이 달라진다)', () => {
    const events = [ptr('down', 1, 100, 100, { button: 2 }), ptr('move', 1, 148, 124, { button: 2 })];
    const tall = run(events, initialControlState(CAM), 480);
    const short = run(events, initialControlState(CAM), 240);
    expectCameraClose(short.camera, pan(CAM, 48, 24, 240));
    expect(short.camera.target).not.toEqual(tall.camera.target);
  });

  it('가운데 버튼 드래그는 회전이다(팬은 오른쪽 버튼과 Shift 뿐)', () => {
    const s = run([ptr('down', 1, 100, 100, { button: 1 }), ptr('move', 1, 130, 90, { button: 1 })]);
    expectCameraClose(s.camera, { ...CAM, azimuth: -1.15, elevation: 0.25 });
  });
});

describe('두 포인터 핀치', () => {
  // 손가락 1 은 (100,100), 손가락 2 는 (200,100) 에서 시작한다
  const start = run([ptr('down', 1, 100, 100), ptr('down', 2, 200, 100)]);

  it('down 직후에는 pinchDist 가 0 이고 첫 move 는 팬만 한다', () => {
    expect(start.pinchDist).toBe(0);
    // 손가락 2: (200,100) -> (220,100). dx = 20 -> 중점은 10px 이동. 간격 120 을 기억한다
    const s = run([ptr('move', 2, 220, 100)], start);
    expectCameraClose(s.camera, pan(CAM, 10, 0, H));
    expect(s.camera.distance).toBe(10); // 기준 간격이 없어 줌하지 않는다
    expect(s.pinchDist).toBeCloseTo(120, 10);
  });

  it('간격 비로 줌하고 중점 이동(포인터 이동의 절반)으로 팬한다', () => {
    const c1 = pan(CAM, 10, 0, H);
    // 손가락 2: (220,100) -> (196,228). dx = -24, dy = 128. 간격 hypot(96,128) = 160 -> 줌 120 / 160 = 0.75
    const s2 = run([ptr('move', 2, 220, 100), ptr('move', 2, 196, 228)], start);
    const c2 = zoom(pan(c1, -12, 64, H), 0.75);
    expectCameraClose(s2.camera, c2);
    expect(s2.camera.distance).toBeCloseTo(7.5, 10); // 손가락을 벌리면 가까워진다
    expect(s2.pinchDist).toBeCloseTo(160, 10);
    // 손가락 1: (100,100) -> (148,164). dx = 48, dy = 64. 간격 hypot(48,64) = 80 -> 줌 160 / 80 = 2
    // (pinchDist 를 갱신하지 않으면 120 / 80 = 1.5 가 되어 11.25 가 나온다)
    const s3 = run([ptr('move', 1, 148, 164)], s2);
    expectCameraClose(s3.camera, zoom(pan(c2, 24, 32, H), 2));
    expect(s3.camera.distance).toBeCloseTo(15, 10); // 손가락을 모으면 멀어진다
    // 핀치는 각도를 바꾸지 않는다
    expect(s3.camera.azimuth).toBe(CAM.azimuth);
    expect(s3.camera.elevation).toBe(CAM.elevation);
  });

  it('한 손가락을 떼면 pinchDist 가 0 으로 돌아가고 남은 손가락은 회전한다', () => {
    const pinched = run([ptr('move', 2, 220, 100)], start);
    const lifted = run([ptr('up', 2, 220, 100)], pinched);
    expect(lifted.pinchDist).toBe(0);
    expect(Object.keys(lifted.pointers)).toEqual(['1']);
    const rotated = run([ptr('move', 1, 120, 100)], lifted); // dx = +20 -> 방위 -0.1
    expect(rotated.camera.azimuth).toBeCloseTo(pinched.camera.azimuth - 0.1, 10);
    expect(rotated.camera.target).toEqual(pinched.camera.target);
  });

  it('두 번째 손가락을 다시 대면 첫 move 는 줌하지 않는다', () => {
    const again = run(
      [ptr('move', 2, 220, 100), ptr('up', 2, 220, 100), ptr('down', 3, 300, 100), ptr('move', 3, 400, 100)],
      start,
    );
    expect(again.camera.distance).toBe(10);
    expect(again.pinchDist).toBeCloseTo(300, 10); // (100,100) 과 (400,100)
  });

  it('세 번째 손가락이 닿으면(down) 기억한 간격을 버린다', () => {
    const pinched = run([ptr('move', 2, 220, 100)], start);
    expect(pinched.pinchDist).toBeCloseTo(120, 10);
    expect(run([ptr('down', 3, 300, 300)], pinched).pinchDist).toBe(0);
  });

  it('세 포인터가 눌린 동안의 move 는 카메라를 바꾸지 않고 위치만 기억한다', () => {
    const three = run([ptr('down', 3, 300, 300)], start);
    const moved = run([ptr('move', 3, 350, 380)], three);
    expect(moved.camera).toBe(three.camera);
    expect(moved.pointers[3]).toEqual({ x: 350, y: 380, button: 0, shift: false });
  });
});

describe('포인터 추적', () => {
  it('down 이 위치·버튼·shift 를 기억하고 isGesturing 이 true 가 된다', () => {
    const s = run([ptr('down', 4, 12, 34, { button: 2, shiftKey: true })]);
    expect(s.pointers).toEqual({ 4: { x: 12, y: 34, button: 2, shift: true } });
    expect(isGesturing(s)).toBe(true);
    expect(s.camera).toBe(CAM);
  });

  it('추적하지 않는 pointerId 의 move 는 무시한다(버튼 없이 지나가는 마우스)', () => {
    const idle = initialControlState(CAM);
    const r = reduceControl(idle, ptr('move', 7, 50, 50), H);
    expect(r.state.camera).toBe(CAM);
    expect(r.state.pointers).toEqual({});
    expect(isGesturing(r.state)).toBe(false);
    // 다른 포인터가 눌려 있어도 모르는 id 는 끼워 넣지 않는다
    const one = run([ptr('down', 1, 100, 100)]);
    const r2 = reduceControl(one, ptr('move', 7, 50, 50), H);
    expect(r2.state.camera).toBe(CAM);
    expect(Object.keys(r2.state.pointers)).toEqual(['1']);
  });

  it('up 과 cancel 이 포인터를 지운다. 그 뒤의 move 는 회전하지 않는다', () => {
    for (const end of ['up', 'cancel'] as const) {
      const s = run([ptr('down', 1, 100, 100), ptr(end, 1, 100, 100)]);
      expect(s.pointers).toEqual({});
      expect(isGesturing(s)).toBe(false);
      const after = run([ptr('move', 1, 160, 160)], s);
      expect(after.camera).toBe(CAM);
    }
  });

  it('모르는 pointerId 의 up 은 다른 포인터를 건드리지 않는다', () => {
    const s = run([ptr('down', 1, 100, 100), ptr('up', 9, 0, 0)]);
    expect(Object.keys(s.pointers)).toEqual(['1']);
    expect(isGesturing(s)).toBe(true);
  });

  it('포인터 이벤트는 전부 handled false 다(터치 스크롤은 touch-action 이 막는다)', () => {
    let s = initialControlState(CAM);
    const events = [
      ptr('down', 1, 100, 100), ptr('move', 1, 130, 90), ptr('down', 2, 200, 100),
      ptr('move', 2, 220, 100), ptr('cancel', 2, 220, 100), ptr('up', 1, 130, 90),
      ptr('move', 1, 0, 0), ptr('down', 5, 10, 10, { button: 2 }), ptr('move', 5, 20, 20, { button: 2 }),
    ];
    for (const e of events) {
      const r = reduceControl(s, e, H);
      expect(r.handled).toBe(false);
      s = r.state;
    }
  });
});

describe('키', () => {
  const s = initialControlState(CAM);

  it('ArrowLeft / ArrowRight 는 방위 +0.1 / -0.1 이고 handled true', () => {
    const l = reduceControl(s, key('ArrowLeft'), H);
    expect(l.handled).toBe(true);
    expectCameraClose(l.state.camera, { ...CAM, azimuth: -0.9 });
    const r = reduceControl(s, key('ArrowRight'), H);
    expect(r.handled).toBe(true);
    expectCameraClose(r.state.camera, { ...CAM, azimuth: -1.1 });
  });

  it('ArrowUp / ArrowDown 은 고도 +0.1 / -0.1 이고 handled true', () => {
    const u = reduceControl(s, key('ArrowUp'), H);
    expect(u.handled).toBe(true);
    expectCameraClose(u.state.camera, { ...CAM, elevation: 0.4 });
    const d = reduceControl(s, key('ArrowDown'), H);
    expect(d.handled).toBe(true);
    expectCameraClose(d.state.camera, { ...CAM, elevation: 0.2 });
  });

  it('화살표 키의 고도는 제한(±89.9°)에서 멈춘다', () => {
    const high = initialControlState({ ...CAM, elevation: ELEVATION_LIMIT - 0.05 });
    expect(reduceControl(high, key('ArrowUp'), H).state.camera.elevation).toBeCloseTo(ELEVATION_LIMIT, 12);
    const low = initialControlState({ ...CAM, elevation: -ELEVATION_LIMIT + 0.05 });
    expect(reduceControl(low, key('ArrowDown'), H).state.camera.elevation).toBeCloseTo(-ELEVATION_LIMIT, 12);
  });

  it('+ 와 = 는 줌 x0.9, - 는 줌 x1.1 이고 handled false', () => {
    for (const k of ['+', '=']) {
      const r = reduceControl(s, key(k), H);
      expect(r.handled).toBe(false);
      expectCameraClose(r.state.camera, { ...CAM, distance: 9 });
    }
    const out = reduceControl(s, key('-'), H);
    expect(out.handled).toBe(false);
    expectCameraClose(out.state.camera, { ...CAM, distance: 11 });
  });

  it('그 밖의 키는 상태를 바꾸지 않고 handled false', () => {
    for (const k of ['a', 'Enter', ' ', 'Tab', 'Escape', 'PageDown', 'Home', '_', 'Shift']) {
      const r = reduceControl(s, key(k), H);
      expect(r.handled).toBe(false);
      expect(r.state).toBe(s);
    }
  });
});

describe('불변성', () => {
  it('입력 상태 객체를 바꾸지 않는다(얼린 상태로 모든 종류의 이벤트를 넣어도 던지지 않는다)', () => {
    const events: ControlEvent[] = [
      ptr('down', 1, 100, 100), ptr('move', 1, 130, 90), ptr('down', 2, 200, 100, { shiftKey: true }),
      ptr('move', 2, 220, 100), ptr('move', 1, 140, 120), ptr('up', 2, 220, 100), ptr('cancel', 1, 140, 120),
      wheel(100), wheel(100, { ctrlKey: true }), key('ArrowLeft'), key('ArrowUp'), key('+'), key('-'), key('a'),
    ];
    let s = deepFreeze(initialControlState(deepFreeze({ ...CAM, target: [5, 4, 0] as [number, number, number] })));
    for (const e of events) {
      const before = JSON.stringify(s);
      const next = reduceControl(s, e, H).state;
      expect(JSON.stringify(s)).toBe(before);
      s = deepFreeze(next);
    }
  });
});
```

각 테스트가 죽이는 변이:

| 테스트 | 죽이는 변이 |
|---|---|
| 스펙 §7.7 의 값이다 | 상수 값을 바꿈 |
| initialControlState 는 눌린 포인터가 없는 상태다 | 초기 상태에 포인터나 간격을 남김, 카메라를 복사해 참조가 달라짐 |
| Ctrl·Cmd 없는 휠은 가로채지 않는다: handled false, 카메라 불변 | **Ctrl 없이도 휠 줌**(시제품 동작), 일반 휠에 `handled: true`, 일반 휠에서 카메라 객체를 새로 만듦 |
| Ctrl+휠은 distance * exp(deltaY * 0.001) 로 줌하고 handled true | Ctrl+휠 `handled`를 false로, 휠 부호 반전, 줌 계수 변경 |
| Cmd+휠(metaKey)도 같은 줌이고 handled true | `metaKey`를 보지 않음 |
| 줌 제한(20 * radius)을 넘지 않는다 | `zoom`을 거치지 않고 `distance`를 직접 곱함 |
| 왼쪽 버튼 드래그는 회전: 오른쪽으로 끌면 방위가 줄고 아래로 끌면 고도가 는다(1px 당 0.005rad) | **회전 부호 반전**, dx·dy 바꿈, move에서 직전 위치를 갱신하지 않음 |
| Shift+드래그는 팬: target 만 움직이고 각도·거리는 그대로 | Shift 드래그를 회전으로 처리 |
| 오른쪽 버튼 드래그도 팬 | `button === 2` 판정 누락 |
| 팬·회전 판정은 down 때의 button·shift 로 한다(move 의 값은 보지 않는다) | 판정에 move 이벤트의 `button`·`shiftKey`를 씀 |
| 팬은 cssHPx 를 pan 에 그대로 넘긴다(높이가 절반이면 이동량이 달라진다) | `cssHPx` 대신 상수를 넘김 |
| 가운데 버튼 드래그는 회전이다(팬은 오른쪽 버튼과 Shift 뿐) | `button !== 0`을 팬으로 처리 |
| down 직후에는 pinchDist 가 0 이고 첫 move 는 팬만 한다 | 핀치 팬에서 절반(`/ 2`) 누락, 첫 move에서 줌 |
| 간격 비로 줌하고 중점 이동(포인터 이동의 절반)으로 팬한다 | 줌 비를 뒤집음(`d / pinchDist`), `pinchDist` 미갱신, 줌을 팬보다 먼저 함, 절반 누락 |
| 한 손가락을 떼면 pinchDist 가 0 으로 돌아가고 남은 손가락은 회전한다 | up에서 `pinchDist`를 남김, up이 포인터를 지우지 않음 |
| 두 번째 손가락을 다시 대면 첫 move 는 줌하지 않는다 | up이 포인터를 지우지 않음, 직전 위치 미갱신 |
| 세 번째 손가락이 닿으면(down) 기억한 간격을 버린다 | down에서 `pinchDist`를 남김 |
| 세 포인터가 눌린 동안의 move 는 카메라를 바꾸지 않고 위치만 기억한다 | 포인터 수를 `!== 2`로만 갈라 세 포인터에서도 회전 |
| down 이 위치·버튼·shift 를 기억하고 isGesturing 이 true 가 된다 | down이 `button`·`shiftKey`를 저장하지 않음 |
| 추적하지 않는 pointerId 의 move 는 무시한다(버튼 없이 지나가는 마우스) | 누르지 않은 포인터의 move를 추적해 떠 있는 마우스가 카메라를 돌림 |
| up 과 cancel 이 포인터를 지운다. 그 뒤의 move 는 회전하지 않는다 | up·cancel에서 포인터를 남김 |
| 모르는 pointerId 의 up 은 다른 포인터를 건드리지 않는다 | up에서 포인터 전체를 비움 |
| 포인터 이벤트는 전부 handled false 다(터치 스크롤은 touch-action 이 막는다) | 포인터 move·down에 `handled: true` |
| ArrowLeft / ArrowRight 는 방위 +0.1 / -0.1 이고 handled true | **화살표 키 `handled`를 false로**, 좌우 부호 반전 |
| ArrowUp / ArrowDown 은 고도 +0.1 / -0.1 이고 handled true | **화살표 키 `handled`를 false로**, 상하 부호 반전 |
| 화살표 키의 고도는 제한(±89.9°)에서 멈춘다 | `rotate`를 거치지 않고 고도를 직접 더함, 상하 부호 반전 |
| + 와 = 는 줌 x0.9, - 는 줌 x1.1 이고 handled false | **`+`/`−` 키 `handled`를 true로**, `+`와 `-`의 계수를 바꿈, `=` 누락 |
| 그 밖의 키는 상태를 바꾸지 않고 handled false | 모르는 키에서 상태를 새로 만들거나 `handled: true` |
| 입력 상태 객체를 바꾸지 않는다(얼린 상태로 모든 종류의 이벤트를 넣어도 던지지 않는다) | `s.pointers`를 제자리에서 고침(`delete s.pointers[id]`, `s.pointers[id] = ...`) |

- [ ] **Step 7: 테스트가 실패하는지 확인**

Run: `cd dashboard && npx vitest run lib/viz/points3d/__tests__/controls.test.ts`
Expected: FAIL. `Error: Failed to resolve import "../controls" from "lib/viz/points3d/__tests__/controls.test.ts". Does the file exist?`, `Test Files  1 failed (1)`, `Tests  no tests`. (Step 3과 같은 종류의 모듈 해석 실패다. 플러그인 없는 설정에서는 `Cannot find module '../controls'`로 찍힌다.)

- [ ] **Step 8: `controls.ts` 구현**

Create `dashboard/lib/viz/points3d/controls.ts`:

```ts
// 입력 reducer(순수 함수). 정규화된 입력 이벤트를 받아 카메라·제스처 상태를 새로 만든다.
// DOM 이벤트 객체를 받지 않는다. 리스너 연결과 preventDefault 호출은 뷰(points3d-view.tsx)가 한다.
// handled 가 true 인 입력만 호출자가 기본 동작을 막는다: Ctrl/Cmd+휠(브라우저 페이지 확대)과 화살표 키(페이지 스크롤).
import { pan, rotate, zoom, type OrbitState } from './orbit';

export const WHEEL_ZOOM_RATE = 0.001; // 휠 줌: distance * exp(deltaY * 0.001)
export const KEY_ROTATE_PX = 20; //     화살표 키 한 번 = 20px 드래그(0.1rad)
export const KEY_ZOOM_IN = 0.9; //      + 와 = 키
export const KEY_ZOOM_OUT = 1.1; //     - 키

// x·y 는 CSS px. button 은 PointerEvent.button(0 왼쪽, 1 가운데, 2 오른쪽)
export type ControlEvent =
  | { type: 'down' | 'move' | 'up' | 'cancel'; pointerId: number; x: number; y: number; button: number; shiftKey: boolean }
  | { type: 'wheel'; deltaY: number; ctrlKey: boolean; metaKey: boolean }
  | { type: 'key'; key: string };

// pointers: 눌린 포인터의 직전 위치와, down 때의 버튼·Shift. pinchDist: 두 포인터의 직전 간격(0 = 기준 없음)
export interface ControlState {
  camera: OrbitState;
  pointers: Record<number, { x: number; y: number; button: number; shift: boolean }>;
  pinchDist: number;
}

export function initialControlState(camera: OrbitState): ControlState {
  return { camera, pointers: {}, pinchDist: 0 };
}

// 눌린 포인터가 하나라도 있는가(드래그·핀치 중)
export function isGesturing(s: ControlState): boolean {
  return Object.keys(s.pointers).length > 0;
}

// 입력 상태는 바꾸지 않는다. 카메라가 변하지 않는 입력에서는 camera 참조를 그대로 돌려준다.
export function reduceControl(
  s: ControlState, e: ControlEvent, cssHPx: number,
): { state: ControlState; handled: boolean } {
  switch (e.type) {
    case 'down': {
      const pointers = { ...s.pointers, [e.pointerId]: { x: e.x, y: e.y, button: e.button, shift: e.shiftKey } };
      return { state: { camera: s.camera, pointers, pinchDist: 0 }, handled: false };
    }
    case 'move': {
      const prev = s.pointers[e.pointerId];
      if (!prev) return { state: s, handled: false }; // 누르지 않은 포인터(지나가는 마우스)
      const dx = e.x - prev.x;
      const dy = e.y - prev.y;
      const pointers = { ...s.pointers, [e.pointerId]: { ...prev, x: e.x, y: e.y } };
      const held = Object.values(pointers);
      if (held.length === 1) {
        // 팬·회전 판정은 down 때 저장한 버튼·Shift 로 한다
        const camera = prev.button === 2 || prev.shift ? pan(s.camera, dx, dy, cssHPx) : rotate(s.camera, dx, dy);
        return { state: { camera, pointers, pinchDist: s.pinchDist }, handled: false };
      }
      if (held.length === 2) {
        // 두 포인터: 중점 이동(포인터 이동의 절반)만큼 팬, 간격 비만큼 줌
        const d = Math.hypot(held[0].x - held[1].x, held[0].y - held[1].y);
        let camera = pan(s.camera, dx / 2, dy / 2, cssHPx);
        if (s.pinchDist > 0 && d > 0) camera = zoom(camera, s.pinchDist / d);
        return { state: { camera, pointers, pinchDist: d }, handled: false };
      }
      return { state: { camera: s.camera, pointers, pinchDist: s.pinchDist }, handled: false }; // 세 포인터 이상
    }
    case 'up':
    case 'cancel': {
      const pointers = { ...s.pointers };
      delete pointers[e.pointerId];
      return { state: { camera: s.camera, pointers, pinchDist: 0 }, handled: false };
    }
    case 'wheel': {
      if (!e.ctrlKey && !e.metaKey) return { state: s, handled: false }; // 일반 휠은 페이지 스크롤에 맡긴다
      const camera = zoom(s.camera, Math.exp(e.deltaY * WHEEL_ZOOM_RATE));
      return { state: { ...s, camera }, handled: true };
    }
    case 'key': {
      switch (e.key) {
        case 'ArrowLeft': //  방위 +0.1rad (왼쪽으로 20px 끈 것과 같다)
          return { state: { ...s, camera: rotate(s.camera, -KEY_ROTATE_PX, 0) }, handled: true };
        case 'ArrowRight': // 방위 -0.1rad
          return { state: { ...s, camera: rotate(s.camera, KEY_ROTATE_PX, 0) }, handled: true };
        case 'ArrowUp': //    고도 +0.1rad (아래로 20px 끈 것과 같다)
          return { state: { ...s, camera: rotate(s.camera, 0, KEY_ROTATE_PX) }, handled: true };
        case 'ArrowDown': //  고도 -0.1rad
          return { state: { ...s, camera: rotate(s.camera, 0, -KEY_ROTATE_PX) }, handled: true };
        case '+':
        case '=':
          return { state: { ...s, camera: zoom(s.camera, KEY_ZOOM_IN) }, handled: false };
        case '-':
          return { state: { ...s, camera: zoom(s.camera, KEY_ZOOM_OUT) }, handled: false };
        default:
          return { state: s, handled: false };
      }
    }
  }
}
```

주의:
- `pointers`는 `Record<number, ...>`다. 눌린 포인터 목록은 `Object.values(pointers)`로 얻는다(`Object.keys`의 문자열 키로 다시 색인하면 `tsc`가 TS7015로 실패한다).
- up·cancel은 사본을 만든 뒤 `delete`한다. 입력 `s.pointers`에 직접 `delete`하지 않는다.
- `switch (e.type)`은 6개 값을 전부 다루고 안쪽 `switch (e.key)`에 `default`가 있어, 함수 끝에 `return`을 따로 두지 않아도 `tsc`가 통과한다. 반환 타입 표기는 위 그대로 둔다.
- DOM 타입(`PointerEvent`, `WheelEvent`, `KeyboardEvent`)을 import하거나 인자로 받지 않는다. `preventDefault`를 부르지 않는다.

- [ ] **Step 9: 테스트가 통과하는지 확인**

Run: `cd dashboard && npx vitest run lib/viz/points3d/__tests__/controls.test.ts`
Expected: PASS. `Test Files  1 passed (1)`, `Tests  29 passed (29)`.

- [ ] **Step 10: 변이 6개를 손으로 넣어 테스트가 죽는지 확인**

테스트가 회귀를 실제로 잡는지 본다. 아래를 **하나씩** 넣고, 명령을 돌려 실패를 확인하고, **곧바로 원래대로 되돌린다**. 하나라도 통과(살아남음)하면 멈추고 보고한다.

Run(변이마다): `cd dashboard && npx vitest run lib/viz/points3d/__tests__/pick.test.ts lib/viz/points3d/__tests__/controls.test.ts`

1. `pick.ts`, **과장을 z 전체에 적용**
   - 원래: `    if (d > noDev) z += d * lift; // 편차만 과장한다`
   - 변이: `    z = z * exaggeration;`
   - 기대: 5건 실패. `편차 과장` describe 의 4건(`편차 없는 점(두 센티널)은 과장에도 제자리다` 포함. `k = 1 이면 실제 위치에서 찾는다`만 통과)과 `실제 궤도 카메라` 1건.
2. `pick.ts`, **반경 무시**
   - 원래: `  let bestD2 = radiusPx * radiusPx; // 제곱 거리로 비교한다. 반경 경계는 포함`
   - 변이: `  let bestD2 = Infinity;`
   - 기대: 4건 실패. `12px 밖이면 null 이다`, `radiusPx 인자가 기본 반경을 바꾼다`, 편차 과장의 양·음 2건.
3. `controls.ts`, **Ctrl 없이도 휠 줌**
   - 원래: `      if (!e.ctrlKey && !e.metaKey) return { state: s, handled: false }; // 일반 휠은 페이지 스크롤에 맡긴다`
   - 변이: 이 줄을 지운다.
   - 기대: 1건 실패. `Ctrl·Cmd 없는 휠은 가로채지 않는다: handled false, 카메라 불변`.
4. `controls.ts`, **화살표 키 `handled`를 false로**
   - 원래: `          return { state: { ...s, camera: rotate(s.camera, -KEY_ROTATE_PX, 0) }, handled: true };`
   - 변이: `          return { state: { ...s, camera: rotate(s.camera, -KEY_ROTATE_PX, 0) }, handled: false };`
   - 기대: 1건 실패. `ArrowLeft / ArrowRight 는 방위 +0.1 / -0.1 이고 handled true`.
5. `controls.ts`, **`-` 키 `handled`를 true로**
   - 원래: `          return { state: { ...s, camera: zoom(s.camera, KEY_ZOOM_OUT) }, handled: false };`
   - 변이: `          return { state: { ...s, camera: zoom(s.camera, KEY_ZOOM_OUT) }, handled: true };`
   - 기대: 1건 실패. `+ 와 = 는 줌 x0.9, - 는 줌 x1.1 이고 handled false`.
6. `controls.ts`, **회전 부호 반전**
   - 원래: `        const camera = prev.button === 2 || prev.shift ? pan(s.camera, dx, dy, cssHPx) : rotate(s.camera, dx, dy);`
   - 변이: `        const camera = prev.button === 2 || prev.shift ? pan(s.camera, dx, dy, cssHPx) : rotate(s.camera, -dx, -dy);`
   - 기대: 4건 실패. `왼쪽 버튼 드래그는 회전: 오른쪽으로 끌면 방위가 줄고 아래로 끌면 고도가 는다(1px 당 0.005rad)` 포함.

여섯 개를 전부 되돌린 뒤 같은 명령을 한 번 더 돌린다.
Expected: `Test Files  2 passed (2)`, `Tests  44 passed (44)`.

- [ ] **Step 11: 뷰 모듈 전체·팔레트 스윕·타입 검사·대시보드 전체 스위트**

Run:
```bash
cd dashboard
npx vitest run lib/viz/points3d
npx vitest run __tests__/palette-sweep.test.ts
npx tsc --noEmit
npx vitest run
```
Expected:
- `lib/viz/points3d`: 실패 0. T8·T9의 테스트 파일(`mat4`, `orbit`, `scaffold`, `budget`)과 이 태스크의 2개 파일이 전부 PASS.
- `palette-sweep`: 2건 PASS(새 파일에 `색이름-숫자` 꼴 표기가 없다).
- `tsc --noEmit`: 출력 없음(0 에러).
- 전체 스위트: 실패 0. 이 태스크로 테스트 파일 2개, 테스트 44건이 늘어난다(기준선 84파일 769건 + 앞 태스크의 신규 + 44).

실패가 있으면 고치고 다시 돌린다. 통과하지 않은 채 커밋하지 않는다.

- [ ] **Step 12: 커밋**

```bash
cd D:/Projects/Flatness
git add dashboard/lib/viz/points3d/pick.ts dashboard/lib/viz/points3d/controls.ts dashboard/lib/viz/points3d/__tests__/pick.test.ts dashboard/lib/viz/points3d/__tests__/controls.test.ts
git status --short
git commit -m "$(cat <<'EOF'
feat(dashboard): 3D 점군 뷰어 읽기 창 탐색과 입력 reducer (pick.ts, controls.ts)

- pick.ts: pickNearest. 커서에서 12px 이내, 화면상 가장 가까운 점 하나를 찾는다.
  화면 위치는 표시 위치(z + dev * (k - 1))이고 편차 없는 점(두 센티널)은 과장하지 않는다.
  화면 거리가 같으면 카메라에 가까운 점. 카메라 뒤의 점은 제외.
- controls.ts: reduceControl. 정규화된 포인터·휠·키 입력을 카메라·제스처 상태로 바꾸는
  순수 reducer. handled 는 Ctrl/Cmd+휠과 화살표 키에서만 true(일반 휠은 가로채지 않는다).
  팬·회전 판정은 down 때의 버튼·Shift, 두 포인터는 중점 팬 + 간격 비 줌.
- 테스트 44건(pick 15, controls 29). 변이(과장을 z 전체에 적용, 반경 무시, Ctrl 없이 휠 줌,
  화살표 handled false, +/- handled true, 회전 부호 반전)가 죽는 것을 확인했다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```
Expected: `git status --short`에 위 4개 파일만 `A`로 보인다. 커밋 뒤 `git status --short`는 비어 있다.

---

**계획 작성 중 확인한 것(초안 메모)**

- 위 코드 4개 파일은 `.superpowers/plan-drafts/pointcloud-viewer/scratch-10/`에서 저장소의 vitest(4.1.10)·tsc를 빌려 실제로 돌렸다: 구현 전 2개 파일 모두 `Cannot find module`로 실패 → 구현 뒤 `Tests  44 passed (44)`, `tsc --noEmit` 0 에러, 대시보드 ESLint 설정으로 4개 파일 0건.
- 스크래치의 `lib/domain/points3d.ts`, `mat4.ts`, `orbit.ts`는 뼈대 시그니처와 스펙 §7.7 식을 만족하는 대체물이다(T6·T8의 실제 구현이 아니다). 추가로 다른 초안의 스크래치에 있던 T6·T8 구현(`scratch-06/dashboard/lib/domain/points3d.ts`, `scratch-08/lib/viz/points3d/mat4.ts`·`orbit.ts`, 2026-10-02 시점 사본)을 `scratch-10/xcheck/`에 복사해 같은 테스트를 돌렸고 44건 통과, `tsc` 0 에러였다. 그 초안들이 뒤에 바뀌면 이 확인은 무효다. 저장소의 실제 파일과 맞물린 실행은 Step 5·9·11이 처음이다.
- 변이 52개(pick 20, controls 32)를 스크래치에서 하나씩 넣어 전부 죽는 것을 확인했다(`scratch-10/mutate.mjs`). 처음에는 "down에서 `pinchDist`를 남김" 하나가 살아남아 `세 번째 손가락이 닿으면(down) 기억한 간격을 버린다` 테스트를 추가했다.
- `pickNearest` 50만 점 1회 실행 시간은 이 장비(다른 작업 병행 중)에서 약 13ms였다(`scratch-10/bench.mjs`. 배열 읽기만 하는 빈 루프가 약 1.8ms). 처음에 루프 안에서 `DEV_NO_DEVIATION`을 직접 읽었을 때는 vitest 아래에서 약 30ms였고, 지역 변수 `noDev`로 꺼내 13ms가 됐다. 이른 x축 기각과 나눗셈 없는 사전 기각은 측정상 이득이 없어 넣지 않았다.
- 스크래치 vitest 설정에서 `vitest/config`를 import하면 `dashboard` 밖이라 해석에 실패한다. import 없는 `vitest.config.mjs`(객체 export)로 돌렸다. 테스트 파일의 `import ... from 'vitest'`는 그대로 해석됐다.

**재검증 기록(2026-10-03, 중단된 작업을 이어서 확인)**

- 이 문서의 코드 블록 4개를 다시 꺼내 스크래치 파일과 글자 단위로 대조했다(`scratch-10/roundtrip.mjs`): 4개 전부 SAME.
- `cd dashboard && npx vitest run --root <scratch-10>`: `Tests  88 passed (88)`(대체물 44 + xcheck 44). `npx tsc -p <scratch-10>/tsconfig.json`과 `<scratch-10>/xcheck/tsconfig.json`: 둘 다 종료 코드 0.
- **xcheck의 출처를 바꿨다.** 이웃 태스크의 스크래치 폴더(`scratch-06/`, `scratch-08/`)는 그 태스크의 에이전트가 변이 실험으로 수시로 고치는 중이라(실제로 `scratch-08/orbit.ts`에서 `zoom`의 clamp가 빠진 변이 상태를 복사해 `줌 제한(20 * radius)을 넘지 않는다`가 1건 실패했다. 변이 실험이 되돌린 뒤에는 통과한다) 그 폴더를 베끼지 않고, **초안 문서 `task-06.md`·`task-08.md`의 코드 블록을 그대로 꺼내** `scratch-10/xcheck/`를 다시 만들었다(`scratch-10/xcheck-from-drafts.mjs`). 그 상태에서 `npx vitest run --root <scratch-10>/xcheck`: `Tests  44 passed (44)`, `tsc` 0. 부수 효과로, 이 태스크의 `줌 제한` 테스트가 T8 `zoom`의 clamp 제거까지 잡는다는 것이 확인됐다.
- Step 1의 grep 3개를 초안 문서에서 꺼낸 T6·T8 코드에 돌려 `3`, `8`, `1`을 확인했다.
- red 단계 재현: `pick.ts`·`controls.ts`를 잠시 치우고 돌려 `Test Files  2 failed (2)`, `Tests  no tests`를 확인한 뒤 되돌렸다. 저장소와 같은 설정(`@vitejs/plugin-react` + jsdom, `scratch-10/vitest.repo.config.mjs`)에서는 문구가 `Error: Failed to resolve import "../pick" from ".../__tests__/pick.test.ts". Does the file exist?`이고, 플러그인 없는 스크래치 설정에서는 `Error: Cannot find module '../pick' imported from ...`이다. Step 3·7의 기대 문구를 저장소 설정의 문구로 고쳤다(T6·T8 초안과 같은 문구). 같은 저장소형 설정(jsdom)에서 구현 뒤 `Tests  44 passed (44)`.
- 변이 52개를 다시 돌렸다(`scratch-10/mutate.mjs`, 기록 `scratch-10/mutate-rerun.log`): 생존 0 / 52. Step 10의 6개는 적어 둔 실패 수와 같다(P1 과장을 z 전체에 5건, P6 반경 무시 4건, C1 Ctrl 없이 휠 줌 1건, C5a ArrowLeft handled false 1건, C6b `-` handled true 1건, C18 회전 부호 반전 4건).
- ESLint: 저장소 설정은 기준 경로 밖 파일을 무시하므로(`File ignored because outside of base path`) `cd dashboard && cat <스크래치 파일> | npx eslint --stdin --stdin-filename lib/viz/points3d/<파일>`로 4개 파일을 돌렸다. 전부 종료 코드 0, 출력 없음.
- 팔레트 스윕의 정규식(`\b(zinc|amber|red|green|emerald|purple|blue)-[0-9]{2,3}\b`)을 4개 파일에 직접 돌려 0건, U+2014 0건(이 문서 포함), `pass_mm`·`rework_mm`·`u_mm`·`applied_criteria` 0건, 저장소 규칙의 금지어(사용자 메모리 `no-client-yet-honorific-docs`의 그 말) 0건.
- `scratch-10/bench.mjs` 재실행: 50만 점 1회 약 8ms(빈 루프 약 1.4ms). 위 메모의 13ms는 다른 작업 병행 중 측정값이고 자릿수는 같다.

---
### Task 11: `gl-renderer.ts`: 유일한 WebGL2 접점과 gl 호출 기록 스텁

**Files:**
- Create: `dashboard/lib/viz/points3d/gl-renderer.ts`
- Create: `dashboard/lib/viz/points3d/__tests__/gl-stub.ts` (테스트 헬퍼. 이름이 `*.test.ts` 가 아니라 테스트로 수집되지 않는다. Task 12~14 의 컴포넌트 테스트가 같이 쓴다)
- Modify: 없음
- Test: `dashboard/lib/viz/points3d/__tests__/gl-renderer.test.ts` (신설, 48건)

**Interfaces:**
- Consumes (앞 태스크가 만든 것. 이 태스크는 고치지 않는다):
  - Task 6, `dashboard/lib/domain/points3d.ts`: `export interface Points3dData { meta: Points3dMeta; xyz: Uint16Array; dev: Int16Array; }` (xyz 길이 3n 의 x,y,z 인터리브, dev 길이 n. 이 태스크가 메타에서 읽는 것은 `meta.extent_m: [number, number, number]` 하나다)
  - Task 6, 같은 파일: `export interface Points3dTheme { background: string; flat: string; depression: string; protrusion: string; none: string; line: string; gridAlpha: number; axisAlpha: number; text: string; textSecondary: string; readoutBackground: string; readoutAlpha: number; }` (색은 `#rrggbb`, 알파는 0~1)
  - Task 6, 같은 파일: `export function hexToRgb01(hex: string): [number, number, number];` `export const DEV_NO_DEVIATION = -32767;`
  - Task 7, 같은 파일: `export type Webgl2Support = 'hardware' | 'software' | 'unsupported';`
  - Task 9, `dashboard/lib/viz/points3d/scaffold.ts` 의 `buildScaffold(fit)` 가 주는 `{ verts: Float32Array; gridVertCount: number; axisVertCount: number }` 의 배치: verts 는 xyz 3개씩(파일-로컬 m), 앞 `gridVertCount` 정점이 격자 LINES, 이어지는 `axisVertCount` 정점이 축선 LINES. 이 태스크는 `scaffold.ts` 를 import 하지 않고 이 모양의 객체만 받는다
  - 스펙 `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §7.5(셰이더 입력표·의사코드), §7.4(좌표계, 그리기 순서), §7.2(`probeWebgl2` 절차, `createRenderer`·`dispose` 설명)
- Produces (Task 12~14 가 이 이름과 타입 그대로 쓴다):
  - gl-renderer.ts: `export const CONTEXT_RESTORE_TIMEOUT_MS = 3000;`
  - gl-renderer.ts: `export function probeWebgl2(): Webgl2Support;`
  - gl-renderer.ts: `export interface FrameParams { viewProj: Float32Array; exaggeration: number; thresholdQ: number; pointWorldM: number; pxPerUnit: number; minPx: number; maxPx: number; drawCount: number; theme: Points3dTheme; }` (`pxPerUnit`·`minPx`·`maxPx` 는 드로잉 버퍼 px)
  - gl-renderer.ts: `export interface Renderer { setData(data: Points3dData, scaffold: { verts: Float32Array; gridVertCount: number; axisVertCount: number }): void; resize(bufferW: number, bufferH: number): void; draw(frame: FrameParams): void; pointSizeLimit(): [number, number]; dispose(): void; }`
  - gl-renderer.ts: `export function createRenderer(canvas: HTMLCanvasElement, on: { lost(): void; restored(): void; unrecoverable(): void }): Renderer | null;` - `canvas.getContext('webgl2', { antialias: false, alpha: false })` 가 null 이거나 셰이더 컴파일·링크가 실패하면 null
  - 셰이더 이름(스텁과 테스트가 이 이름으로 찾는다): 점 프로그램 uniform `uExtent`, `uViewProj`, `uExag`, `uThresholdQ`(int), `uPointWorldM`, `uPxPerUnit`, `uMinPx`, `uMaxPx`, `uColFlat`, `uColDep`, `uColPro`, `uColNone`, attribute `aPos`, `aDev`. 선 프로그램 uniform `uViewProj`, `uColor`(vec4), attribute `aPos`. 위치는 `gl.getUniformLocation`·`gl.getAttribLocation` 으로 얻는다
  - __tests__/gl-stub.ts: `export interface GlCall { name: string; args: unknown[] }` `export interface RecordingGl { gl: WebGL2RenderingContext; calls: GlCall[]; callsOf(name: string): GlCall[]; uniformCalls(uniformName: string): GlCall[]; attribLocation(name: string): number; pointDraws(): number[]; loseContextCalls(): number; }` `export function recordingGl(opts?: { pointSizeRange?: [number, number] }): RecordingGl;`
  - gl-stub 규약: gl 메서드 호출을 calls 에 기록. `getUniformLocation(program, name)` 은 `{ uniformName: name, program }` 을 돌려주고 `uniformCalls(name)` 은 args[0].uniformName === name 인 uniform* 호출 목록. `getAttribLocation` 은 이름별 고정 번호(aPos 0, aDev 1, 그 밖은 -1). `pointDraws()` 는 `drawArrays(POINTS, 0, c)` 의 c 목록(호출 순). `getParameter(ALIASED_POINT_SIZE_RANGE)` 는 `Float32Array(opts.pointSizeRange ?? [1, 1024])`. `getShaderParameter`·`getProgramParameter` 는 true. `getExtension('WEBGL_lose_context')` 는 loseContext 호출을 세는 객체. WebGL 상수(POINTS = 0, LINES = 1, SHORT = 5122, UNSIGNED_SHORT = 5123, FLOAT = 5126 등)는 실제 값. 컴포넌트 테스트는 `vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl)` 로 끼운다
  - 뒤 태스크가 기대도 되는 동작(이 태스크의 테스트가 고정한다):
    - `createRenderer` 는 호출마다 `canvas.getContext` 를 정확히 한 번 부른다. null 을 돌려줄 때는 canvas 에 리스너를 남기지 않는다
    - `draw` 는 프레임마다 `clearColor(테마 배경, 1)` → `clear` → `drawArrays(LINES, 0, gridVertCount)` → `drawArrays(LINES, gridVertCount, axisVertCount)` → `drawArrays(POINTS, 0, c)` 순으로 부른다. `c = min(n, drawCount)` 이다(n 은 점 수). `uViewProj` 는 두 프로그램에 한 번씩 가므로 `uniformCalls('uViewProj')` 는 프레임당 2건이다. 그 밖의 uniform 은 프레임당 1건(`uColor` 만 2건)
    - `setData` 전의 `draw`, 컨텍스트 손실 중의 `draw`, `dispose` 뒤의 `draw` 는 gl 을 전혀 부르지 않는다
    - `resize(w, h)` 는 `canvas.width = w`, `canvas.height = h`, `viewport(0, 0, w, h)`
    - `pointSizeLimit()` 은 생성 때 읽어 둔 `ALIASED_POINT_SIZE_RANGE` 를 돌려준다(스텁 기본 `[1, 1024]`)
    - `webglcontextlost` → `on.lost()` 1회. 3,000ms 안에 `webglcontextrestored` → 다시 만들고 다시 올린 뒤 `on.restored()`. 안 오면 `on.unrecoverable()` 1회. 복구 때 셰이더를 다시 만들지 못해도 `on.unrecoverable()`
    - `dispose` 는 `deleteBuffer` 3·`deleteVertexArray` 2·`deleteProgram` 2 를 부르고 `loseContextCalls()` 는 0 그대로다
    - 스텁의 `gl` 은 메서드 목록이 정해진 보통 객체다. 실패 경로는 `vi.spyOn(rec.gl, 'getShaderParameter').mockReturnValue(false)` 처럼 만든다. `WEBGL_lose_context` 확장의 `loseContext`·`restoreContext` 호출도 `calls` 에 그 이름으로 쌓인다

**이 태스크가 지켜야 할 규칙(스펙 §2.2 V1·V2·V3·V4·V7, §2.4, §7.1, §7.2, §7.4, §7.5, §7.13, §8):**

- `gl-renderer.ts` 는 저장소에서 WebGL 을 건드리는 **유일한** 파일이다. `lib/viz/points3d/` 의 다른 모듈에 gl 호출을 두지 않는다. 의존성을 추가하지 않는다(three.js·regl 등 금지, `dashboard/package.json` 을 고치지 않는다).
- 이 파일은 Next.js API 를 쓰지 않는 평범한 TypeScript 모듈이다(`dashboard/node_modules/next/dist/docs/` 에서 확인할 관례가 없다). `'use client'` 를 붙이지 않는다. 다만 클라이언트 컴포넌트도 서버에서 한 번 렌더되므로 **모듈 최상위에서 `document`·`getContext` 를 건드리지 않는다.** `probeWebgl2` 와 `createRenderer` 는 뒤 태스크의 effect 안에서만 불린다.
- **셰이더 문자열은 Step 9 의 것을 글자 그대로 쓴다.** 계획 작성 때 이 문자열을 실제 브라우저(Chromium)의 WebGL2 에서 컴파일·링크하고 픽셀을 읽어 확인했다(초안 메모). jsdom 은 GLSL 을 실행하지 못하므로, 고친 셰이더가 컴파일되는지는 이 태스크의 테스트로 알 수 없다. GLSL 안에는 ASCII 만 쓰고(한국어 설명은 TypeScript 주석으로 둔다) `#version 300 es` 는 백틱 바로 뒤 첫 줄이어야 한다.
- 시제품(`.superpowers/research/3d-pointcloud-viewer/design-inputs/proto/viz/gl-points.js`)을 베끼지 않는다. 스펙과 다른 곳: 시제품은 Float32 좌표, float 편차, GLSL 상수 색, z 전체 과장, 네모 점, dispose 에서 loseContext 다. 스펙은 아래와 같다.
  - 좌표: `xyz`(Uint16Array)를 **사본 없이** 그대로 올리고 정규화 `UNSIGNED_SHORT` 속성(`vertexAttribPointer(loc, 3, UNSIGNED_SHORT, true, 0, 0)`)으로 읽는다. 셰이더가 `uExtent`(= `extent_m`)를 곱해 파일-로컬 m 로 만든다. `origin_m`(절대 좌표)은 GPU 에 넘기지 않는다.
  - 편차: `dev`(Int16Array)를 정수 속성(`vertexAttribIPointer(loc, 1, SHORT, 0, 0)`)으로 읽는다. 셰이더 선언은 `in int aDev`. float 포인터로 잡으면 셰이더의 int 속성과 어긋나 값이 정의되지 않는다.
  - 분류: 정수 비교. `uThresholdQ` 는 `uniform int` 이고 `uniform1i` 로 넘긴다. `aDev > -32767` 이 아니면(센티널 2종) 편차 없음, `aDev > uThresholdQ` 융기, `aDev < -uThresholdQ` 침하, 그 외 평탄.
  - 과장: 표시 높이 `z + dev × (k − 1)`. 편차만 과장하고 편차 없는 점은 제자리다.
  - 깊이: 편차 있는 점은 과장 전 기준면 위치(`z − dev`)의 깊이를 쓴다(`clipR.z / clipR.w * clipS.w`). 편차 없는 점은 실제 깊이.
  - 색: GLSL 에 색 상수를 적지 않는다. 전부 프레임마다 `frame.theme` 의 hex 를 `hexToRgb01` 로 바꿔 uniform 과 `clearColor` 로 넘긴다(밝은 배경 전환이 다음 프레임에 반영된다).
  - 점 모양: 둥근 점(`length(gl_PointCoord - 0.5) > 0.5` 면 `discard`).
- 그리기 순서와 상태(§7.4): (1) 배경색으로 `clear(COLOR | DEPTH)`, (2) 격자·축선: `BLEND` 켬 + `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`, `depthMask(false)`, (3) 점: `BLEND` 끔, `DEPTH_TEST` 켬 + `depthFunc(LESS)`, `depthMask(true)`. 점 단계가 깊이 쓰기를 다시 켜 두어야 다음 프레임의 `clear` 가 깊이 버퍼를 지운다.
- 컨텍스트 손실: `webglcontextlost` 에서 `preventDefault()` 를 불러야 브라우저가 `webglcontextrestored` 를 보낸다. `setData` 로 받은 배열은 참조를 보관했다가 복구 때 다시 올린다. 대기 타이머는 복구와 `dispose` 에서 지운다. 복구 불가를 알린 뒤 늦게 온 복구 이벤트는 무시한다(화면은 이미 오류 안내로 넘어갔다).
- `dispose` 에서 `WEBGL_lose_context.loseContext()` 를 부르지 않는다. React 개발 모드의 effect 이중 실행이 같은 canvas 노드를 다시 쓰는데, 한 번 끊은 canvas 는 다시 `getContext` 해도 끊긴 컨텍스트를 돌려준다. 탐지(`probeWebgl2`)에 쓴 컨텍스트만 반납한다(탐지용 canvas 는 버리는 것이다).
- 스펙이 정하지 않아 이 태스크에서 정한 것 4가지(전부 "조용한 실패 금지"를 따른 것이다):
  1. 셰이더 컴파일·링크가 실패하면 `createRenderer` 는 만든 자원을 지우고 `console.error` 로 info log 를 남긴 뒤 **null** 을 돌려준다(effect 안에서 예외를 던져 React 트리를 깨지 않는다. 뒤 태스크가 null 을 WebGL2 불가 화면으로 드러낸다).
  2. 복구 이벤트가 왔는데 프로그램을 다시 만들지 못하면 `on.restored()` 대신 `on.unrecoverable()` 을 부른다.
  3. `draw` 는 `drawCount` 를 `[0, n]` 으로 막는다(버퍼보다 많이 그리면 실제 GL 은 오류를 내고 아무것도 그리지 않는다).
  4. `pointSizeLimit()` 은 생성 때 한 번 읽은 값을 돌려준다(컨텍스트가 끊긴 동안 `getParameter` 는 null 을 준다).
- 픽셀 단위: `resize` 의 인자와 `FrameParams` 의 `pxPerUnit`·`minPx`·`maxPx` 는 **드로잉 버퍼 px**(`canvas.width`·`canvas.height`, `gl_PointSize` 와 같은 단위)다. 이 파일은 CSS px 을 다루지 않는다.
- 새 파일 3개의 주석·문자열·식별자에 U+2014, `색이름-숫자` 꼴 표기, 판정 기준 필드 이름을 쓰지 않는다(`dashboard/__tests__/palette-sweep.test.ts` 가 `lib/` 아래의 `__tests__` 까지 검사하고, Task 14 의 소스 검사 테스트가 `lib/viz/points3d/*.ts` 를 검사한다). 코드 주석은 한국어, 라이브러리·API 이름은 영어 그대로.

- [ ] **Step 1: 선행 조건 확인(Task 6·7·9 산출물)**

Run:

```bash
cd D:/Projects/Flatness/dashboard && ls lib/viz/points3d && grep -nE "export (const DEV_NO_DEVIATION|function hexToRgb01|interface Points3dData|interface Points3dTheme|type Webgl2Support)" lib/domain/points3d.ts
```

Expected: `ls` 에 `mat4.ts`, `orbit.ts`, `scaffold.ts`, `budget.ts`, `pick.ts`, `controls.ts`, `__tests__` 가 보이고(`gl-renderer.ts` 는 아직 없다), grep 이 다섯 줄(`DEV_NO_DEVIATION`, `Points3dData`, `Points3dTheme`, `hexToRgb01`, `Webgl2Support`)을 낸다. 하나라도 없으면 앞 태스크가 끝나지 않은 것이므로 멈추고 보고한다.

- [ ] **Step 2: 실패하는 테스트 작성(1차: 스텁 규약과 `probeWebgl2`)**

`dashboard/lib/viz/points3d/__tests__/gl-renderer.test.ts` 를 아래 내용으로 만든다. 각 테스트 위 주석이 그 테스트가 죽이는 변이다.

```ts
// gl-renderer.ts 를 gl 호출 기록 스텁으로 검증한다. jsdom 에는 WebGL2 가 없어 픽셀은 볼 수 없으므로
// "어떤 gl 호출을 어떤 순서와 값으로 했는가"만 단언한다. 기대값은 손으로 계산했고 근거를 주석에 적었다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeWebgl2 } from '../gl-renderer';
import { recordingGl } from './gl-stub';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('gl-stub 규약', () => {
  // 죽이는 변이: 상수를 임의 값으로 둠(실제 브라우저의 값과 달라 컴포넌트 테스트의 단언이 헛돈다)
  it('WebGL 상수는 실제 값이다', () => {
    const { gl } = recordingGl();
    // WebGL 명세의 값. POINTS 0x0000, LINES 0x0001, SHORT 0x1402, UNSIGNED_SHORT 0x1403, FLOAT 0x1406
    expect([gl.POINTS, gl.LINES, gl.SHORT, gl.UNSIGNED_SHORT, gl.FLOAT]).toEqual([0, 1, 5122, 5123, 5126]);
    // ARRAY_BUFFER 0x8892, STATIC_DRAW 0x88E4, COLOR_BUFFER_BIT 0x4000, DEPTH_BUFFER_BIT 0x0100
    expect([gl.ARRAY_BUFFER, gl.STATIC_DRAW, gl.COLOR_BUFFER_BIT, gl.DEPTH_BUFFER_BIT]).toEqual([34962, 35044, 16384, 256]);
    // DEPTH_TEST 0x0B71, BLEND 0x0BE2, LESS 0x0201, SRC_ALPHA 0x0302, ONE_MINUS_SRC_ALPHA 0x0303
    expect([gl.DEPTH_TEST, gl.BLEND, gl.LESS, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA]).toEqual([2929, 3042, 513, 770, 771]);
    // VERTEX_SHADER 0x8B31, FRAGMENT_SHADER 0x8B30, COMPILE_STATUS 0x8B81, LINK_STATUS 0x8B82, ALIASED_POINT_SIZE_RANGE 0x846D
    expect([gl.VERTEX_SHADER, gl.FRAGMENT_SHADER, gl.COMPILE_STATUS, gl.LINK_STATUS, gl.ALIASED_POINT_SIZE_RANGE])
      .toEqual([35633, 35632, 35713, 35714, 33901]);
  });

  // 죽이는 변이: 기록 누락, 인자 누락, 순서 뒤섞임
  it('호출을 순서대로 기록하고 callsOf 가 이름으로 고른다', () => {
    const rec = recordingGl();
    rec.gl.viewport(0, 0, 4, 3);
    rec.gl.clear(rec.gl.COLOR_BUFFER_BIT);
    rec.gl.viewport(0, 0, 8, 6);
    expect(rec.calls.map((c) => c.name)).toEqual(['viewport', 'clear', 'viewport']);
    expect(rec.callsOf('viewport').map((c) => c.args)).toEqual([[0, 0, 4, 3], [0, 0, 8, 6]]);
  });

  // 죽이는 변이: uniformCalls 가 이름을 보지 않음, uniform 이 아닌 호출을 섞음
  it('getUniformLocation 은 이름을 실은 객체를 주고 uniformCalls 는 그 위치로 간 uniform 호출만 준다', () => {
    const rec = recordingGl();
    const program = rec.gl.createProgram();
    const a = rec.gl.getUniformLocation(program, 'uExag');
    const b = rec.gl.getUniformLocation(program, 'uThresholdQ');
    expect(a).toEqual({ uniformName: 'uExag', program });
    rec.gl.uniform1f(a, 50);
    rec.gl.uniform1i(b, 70);
    rec.gl.uniform1f(a, 10);
    expect(rec.uniformCalls('uExag').map((c) => [c.name, c.args[1]])).toEqual([['uniform1f', 50], ['uniform1f', 10]]);
    expect(rec.uniformCalls('uThresholdQ').map((c) => [c.name, c.args[1]])).toEqual([['uniform1i', 70]]);
    expect(rec.uniformCalls('uColFlat')).toEqual([]);
  });

  // 죽이는 변이: 속성 번호가 호출마다 달라짐
  it('getAttribLocation 은 aPos 0, aDev 1, 모르는 이름 -1 이고 attribLocation 이 같은 표를 준다', () => {
    const rec = recordingGl();
    const program = rec.gl.createProgram();
    expect(rec.gl.getAttribLocation(program, 'aPos')).toBe(0);
    expect(rec.gl.getAttribLocation(program, 'aDev')).toBe(1);
    expect(rec.gl.getAttribLocation(program, 'aNope')).toBe(-1);
    expect([rec.attribLocation('aPos'), rec.attribLocation('aDev'), rec.attribLocation('aNope')]).toEqual([0, 1, -1]);
  });

  // 죽이는 변이: LINES 그리기나 first 가 0 이 아닌 호출을 점 그리기로 셈
  it('pointDraws 는 drawArrays(POINTS, 0, c) 의 c 만 호출 순으로 준다', () => {
    const rec = recordingGl();
    rec.gl.drawArrays(rec.gl.LINES, 0, 6);
    rec.gl.drawArrays(rec.gl.POINTS, 0, 150000);
    rec.gl.drawArrays(rec.gl.POINTS, 0, 200000);
    expect(rec.pointDraws()).toEqual([150000, 200000]);
  });

  it('getParameter(ALIASED_POINT_SIZE_RANGE) 는 기본 [1, 1024] 이고 opts 로 바꾼다', () => {
    const a = recordingGl();
    expect(Array.from(a.gl.getParameter(a.gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)).toEqual([1, 1024]);
    const b = recordingGl({ pointSizeRange: [1, 64] });
    expect(Array.from(b.gl.getParameter(b.gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)).toEqual([1, 64]);
  });

  it('컴파일·링크 상태는 true 이고 핸들은 서로 다른 객체다', () => {
    const { gl } = recordingGl();
    const shader = gl.createShader(gl.VERTEX_SHADER);
    const program = gl.createProgram();
    expect(gl.getShaderParameter(shader as WebGLShader, gl.COMPILE_STATUS)).toBe(true);
    expect(gl.getProgramParameter(program, gl.LINK_STATUS)).toBe(true);
    expect(gl.createBuffer()).not.toBe(gl.createBuffer());
  });

  it('WEBGL_lose_context 의 loseContext 호출을 세고 다른 확장은 null 이다', () => {
    const rec = recordingGl();
    expect(rec.gl.getExtension('OES_texture_float_linear')).toBeNull();
    expect(rec.loseContextCalls()).toBe(0);
    rec.gl.getExtension('WEBGL_lose_context')?.loseContext();
    expect(rec.loseContextCalls()).toBe(1);
  });
});

describe('probeWebgl2', () => {
  // getContext 가 answers 를 차례로 돌려준다. 다 쓰면 null
  function stubGetContext(answers: Array<WebGL2RenderingContext | null>) {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    for (const answer of answers) spy.mockReturnValueOnce(answer);
    return spy;
  }

  // 죽이는 변이: 첫 시도에서 failIfMajorPerformanceCaveat 누락(소프트웨어 렌더를 hardware 로 판정), 탐지 컨텍스트 미반납
  it('성능 저하 없이 만들어지면 hardware 이고 탐지 컨텍스트를 반납한다', () => {
    const rec = recordingGl();
    const spy = stubGetContext([rec.gl]);
    expect(probeWebgl2()).toBe('hardware');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual(['webgl2', { failIfMajorPerformanceCaveat: true }]);
    expect(rec.loseContextCalls()).toBe(1);
  });

  // 죽이는 변이: 둘째 시도에도 옵션을 넘김(software 가 unsupported 로 떨어진다), 같은 canvas 재사용, 반납 누락
  it('첫 시도가 실패하고 옵션 없는 둘째 시도가 되면 software 다(새 canvas, 반납)', () => {
    const rec = recordingGl();
    const spy = stubGetContext([null, rec.gl]);
    expect(probeWebgl2()).toBe('software');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]).toEqual(['webgl2', { failIfMajorPerformanceCaveat: true }]);
    expect(spy.mock.calls[1]).toEqual(['webgl2']);   // 옵션 인자 자체가 없다
    expect(spy.mock.contexts[0]).not.toBe(spy.mock.contexts[1]);
    expect(rec.loseContextCalls()).toBe(1);
  });

  // 죽이는 변이: 둘째 시도 생략, 실패를 software 로 뭉갬
  it('둘 다 실패하면 unsupported 다', () => {
    const spy = stubGetContext([null, null]);
    expect(probeWebgl2()).toBe('unsupported');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // 죽이는 변이: 탐지용 canvas 를 문서에 붙임
  it('탐지용 canvas 는 문서에 붙이지 않는다', () => {
    const rec = recordingGl();
    const spy = stubGetContext([null, rec.gl]);
    probeWebgl2();
    expect(spy.mock.contexts.map((c) => (c as HTMLCanvasElement).isConnected)).toEqual([false, false]);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });

  // 죽이는 변이: 모듈 최상위에서 탐지(서버 렌더에서 import 하는 순간 document 가 없어 죽는다)
  it('모듈을 import 하는 것만으로는 컨텍스트를 만들지 않는다', async () => {
    const spy = stubGetContext([]);
    vi.resetModules();
    await import('../gl-renderer');
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd D:/Projects/Flatness/dashboard && npx vitest run lib/viz/points3d/__tests__/gl-renderer.test.ts`

Expected: FAIL. `Error: Failed to resolve import "../gl-renderer" from "lib/viz/points3d/__tests__/gl-renderer.test.ts". Does the file exist?` 가 나오고 `Test Files  1 failed (1)`, `Tests  no tests` 다(`./gl-stub` 도 아직 없지만 먼저 걸리는 쪽만 보고된다).

- [ ] **Step 4: gl 호출 기록 스텁 작성**

`dashboard/lib/viz/points3d/__tests__/gl-stub.ts` 를 아래 내용으로 만든다. 상수 값은 WebGL 명세의 실제 값이다(계획 작성 때 브라우저의 `WebGL2RenderingContext` 상수와 대조했다).

```ts
// gl 호출 기록 스텁 (테스트 헬퍼. vitest include 가 `**/__tests__/**/*.test.{ts,tsx}` 라
// 이 파일 자체는 테스트로 수집되지 않는다). components/registration/__tests__/canvas-stub.ts 와 같은 방식이다.
//
// jsdom 에는 WebGL2 컨텍스트가 없다. 이 스텁은 gl 메서드 호출을 순서대로 기록해
// "무엇을 · 어떤 순서로 · 어떤 값으로" 불렀는지를 실제 렌더 경로에서 관찰하게 한다.
// 픽셀은 검증하지 못한다. 실제 그림은 화면 캡처 대조가 맡는다.
//
// 끼우는 법(컴포넌트 테스트도 같다):
//   const rec = recordingGl();
//   vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
//
// 규약:
// - 아래 목록의 gl 메서드 호출은 전부 calls 에 { name, args } 로 쌓인다. 목록에 없는 메서드를 부르면
//   "is not a function" 으로 시끄럽게 실패한다(그때는 VOID_METHODS 에 이름을 더한다).
// - getUniformLocation(program, name) 은 { uniformName: name, program } 을 돌려준다.
// - getAttribLocation 은 이름별 고정 번호(aPos 0, aDev 1), 모르는 이름은 -1.
// - getShaderParameter·getProgramParameter 는 true. 실패 경로는 테스트가
//   vi.spyOn(rec.gl, 'getShaderParameter').mockReturnValue(false) 로 만든다.
// - WebGL 상수는 실제 값이다.

export interface GlCall { name: string; args: unknown[] }

export interface RecordingGl {
  gl: WebGL2RenderingContext;
  calls: GlCall[];
  callsOf(name: string): GlCall[];               // 그 이름의 호출만(호출 순)
  uniformCalls(uniformName: string): GlCall[];   // 그 uniform 위치로 간 uniform* 호출(호출 순, 두 프로그램 모두)
  attribLocation(name: string): number;          // getAttribLocation 이 돌려주는 번호
  pointDraws(): number[];                        // drawArrays(POINTS, 0, c) 의 c 목록(호출 순)
  loseContextCalls(): number;                    // WEBGL_lose_context.loseContext() 호출 수
}

// 실제 WebGL2 상수 값
const GL_CONSTANTS = {
  POINTS: 0x0000, LINES: 0x0001, TRIANGLES: 0x0004,
  ZERO: 0, ONE: 1,
  DEPTH_BUFFER_BIT: 0x0100, COLOR_BUFFER_BIT: 0x4000,
  LESS: 0x0201, LEQUAL: 0x0203,
  SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303,
  DEPTH_TEST: 0x0b71, BLEND: 0x0be2,
  UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, FLOAT: 0x1406,
  ALIASED_POINT_SIZE_RANGE: 0x846d,
  ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4,
  FRAGMENT_SHADER: 0x8b30, VERTEX_SHADER: 0x8b31,
  COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
};

const ATTRIB_LOCATION: Record<string, number> = { aPos: 0, aDev: 1 };

// 반환값이 없는 메서드. 호출만 기록한다
const VOID_METHODS = [
  'shaderSource', 'compileShader', 'attachShader', 'detachShader', 'linkProgram', 'useProgram',
  'deleteShader', 'deleteProgram', 'deleteBuffer', 'deleteVertexArray',
  'bindBuffer', 'bufferData', 'bufferSubData', 'bindVertexArray',
  'enableVertexAttribArray', 'disableVertexAttribArray',
  'vertexAttribPointer', 'vertexAttribIPointer', 'vertexAttribDivisor',
  'uniform1i', 'uniform1f', 'uniform2f', 'uniform3f', 'uniform4f',
  'uniform1iv', 'uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv', 'uniformMatrix4fv',
  'viewport', 'clearColor', 'clearDepth', 'clear', 'enable', 'disable',
  'depthFunc', 'depthMask', 'blendFunc', 'blendFuncSeparate', 'colorMask',
  'drawArrays', 'flush', 'finish',
];

export function recordingGl(opts?: { pointSizeRange?: [number, number] }): RecordingGl {
  const calls: GlCall[] = [];
  const pointSizeRange = opts?.pointSizeRange ?? [1, 1024];
  let nextId = 1;
  let loseCount = 0;

  // 이름과 인자를 기록한 뒤 impl 의 반환값을 돌려주는 함수를 만든다
  const recorded = (name: string, impl: (...args: unknown[]) => unknown = () => undefined) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      return impl(...args);
    };

  const loseContextExt = {
    loseContext: recorded('loseContext', () => { loseCount += 1; }),
    restoreContext: recorded('restoreContext'),
  };

  const gl: Record<string, unknown> = { ...GL_CONSTANTS };
  for (const name of VOID_METHODS) gl[name] = recorded(name);
  // 핸들은 서로 다른 객체다. 테스트가 toBe 로 "같은 버퍼인가"를 본다
  gl.createShader = recorded('createShader', (type) => ({ kind: 'shader', id: nextId++, type }));
  gl.createProgram = recorded('createProgram', () => ({ kind: 'program', id: nextId++ }));
  gl.createBuffer = recorded('createBuffer', () => ({ kind: 'buffer', id: nextId++ }));
  gl.createVertexArray = recorded('createVertexArray', () => ({ kind: 'vao', id: nextId++ }));
  gl.getShaderParameter = recorded('getShaderParameter', () => true);
  gl.getProgramParameter = recorded('getProgramParameter', () => true);
  gl.getShaderInfoLog = recorded('getShaderInfoLog', () => '');
  gl.getProgramInfoLog = recorded('getProgramInfoLog', () => '');
  gl.getUniformLocation = recorded('getUniformLocation', (program, name) => ({ uniformName: name, program }));
  gl.getAttribLocation = recorded('getAttribLocation', (_program, name) => ATTRIB_LOCATION[name as string] ?? -1);
  gl.getParameter = recorded('getParameter', (pname) =>
    (pname === GL_CONSTANTS.ALIASED_POINT_SIZE_RANGE ? new Float32Array(pointSizeRange) : null));
  gl.getExtension = recorded('getExtension', (name) => (name === 'WEBGL_lose_context' ? loseContextExt : null));
  gl.isContextLost = recorded('isContextLost', () => false);
  gl.getError = recorded('getError', () => 0);

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    calls,
    callsOf: (name) => calls.filter((c) => c.name === name),
    uniformCalls: (uniformName) => calls.filter((c) => c.name.startsWith('uniform')
      && (c.args[0] as { uniformName?: string } | null)?.uniformName === uniformName),
    attribLocation: (name) => ATTRIB_LOCATION[name] ?? -1,
    pointDraws: () => calls
      .filter((c) => c.name === 'drawArrays' && c.args[0] === GL_CONSTANTS.POINTS && c.args[1] === 0)
      .map((c) => c.args[2] as number),
    loseContextCalls: () => loseCount,
  };
}
```

- [ ] **Step 5: `gl-renderer.ts` 1차 구현(`probeWebgl2`)**

`dashboard/lib/viz/points3d/gl-renderer.ts` 를 아래 내용으로 만든다. 절차는 스펙 §7.2 그대로다: 문서에 붙이지 않은 canvas 에서 `failIfMajorPerformanceCaveat: true` 로 되면 `'hardware'`, 안 되면 **새** canvas 에서 **옵션 없이** 해 보고 되면 `'software'`, 둘 다 안 되면 `'unsupported'`. 탐지에 쓴 컨텍스트는 곧바로 반납한다.

```ts
// 3D 점군 뷰어의 유일한 WebGL2 접점. 환경 탐지, 셰이더·버퍼·draw·dispose, 컨텍스트 손실/복구를 맡는다.
// lib 의 다른 모듈은 WebGL 과 DOM 을 건드리지 않는다. probeWebgl2 와 createRenderer 는 effect 안에서만 부른다
// (모듈 최상위에서 컨텍스트를 만들지 않는다. 서버 렌더에서 이 모듈을 import 해도 아무 일도 일어나지 않는다).
import type { Webgl2Support } from '@/lib/domain/points3d';

// 탐지용 컨텍스트를 하나 만들어 보고 곧바로 반납한다. canvas 는 문서에 붙이지 않고 버린다
function canCreateContext(attributes?: WebGLContextAttributes): boolean {
  const canvas = document.createElement('canvas');
  const gl = attributes ? canvas.getContext('webgl2', attributes) : canvas.getContext('webgl2');
  if (!gl) return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

// WebGL2 환경 탐지. 성능 저하 없이 만들 수 있으면 'hardware', 옵션 없이만 만들어지면 'software'(소프트웨어 렌더)
export function probeWebgl2(): Webgl2Support {
  if (canCreateContext({ failIfMajorPerformanceCaveat: true })) return 'hardware';
  if (canCreateContext()) return 'software';
  return 'unsupported';
}
```

- [ ] **Step 6: 통과 확인**

Run: `cd D:/Projects/Flatness/dashboard && npx vitest run lib/viz/points3d/__tests__/gl-renderer.test.ts`

Expected: PASS. `Test Files  1 passed (1)`, `Tests  13 passed (13)`(스텁 규약 8건, `probeWebgl2` 5건).

- [ ] **Step 7: 실패하는 테스트 작성(2차: `createRenderer`)**

같은 테스트 파일을 두 군데 고친다.

(a) 맨 위의 import 세 줄

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeWebgl2 } from '../gl-renderer';
import { recordingGl } from './gl-stub';
```

을 아래 여섯 줄로 바꾼다.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Points3dData, Points3dTheme } from '@/lib/domain/points3d';
import { CONTEXT_RESTORE_TIMEOUT_MS, createRenderer, probeWebgl2 } from '../gl-renderer';
import type { FrameParams } from '../gl-renderer';
import { recordingGl } from './gl-stub';
import type { GlCall, RecordingGl } from './gl-stub';
```

(b) 파일 끝(`probeWebgl2` describe 를 닫는 `});` 다음)에 빈 줄 하나를 두고 아래를 그대로 붙인다. 기대값의 근거: 색은 hex 두 자리씩을 255 로 나눈 값이다(`#4cc96f` → 76, 201, 111). `0x4100` 은 `COLOR_BUFFER_BIT(0x4000) | DEPTH_BUFFER_BIT(0x0100)` 이다. 테마 색에 검정·흰색이 아닌 값(`#102030`, `#336699`)을 쓰는 이유는 채널을 바꿔 넣는 변이를 잡기 위해서다.

```ts
// ---- 여기부터 createRenderer ----

// 점 5개. 좌표·편차 값은 렌더러가 해석하지 않고 그대로 GPU 에 올린다
function makeData(): Points3dData {
  return {
    meta: {
      schema_version: 1, n_points: 5, units: 'm',
      origin_m: [254012.8371, 4180045.1626, 31.6052],
      extent_m: [4.0, 2.5, 0.3125],
      deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
      sample_cell_m: 0.0125,
      fit_bounds: { min: [0, 0, 0], max: [4.0, 2.5, 0.3125] },
      sampling: { method: 'cell min-hash stratified', source_points: 12345, cap: 500000 },
      order: 'hash',
    },
    xyz: new Uint16Array([0, 0, 0, 65535, 65535, 4096, 258, 772, 1286, 32768, 16384, 8192, 100, 200, 65535]),
    dev: new Int16Array([0, 32, -105, 71, -32768]),
  };
}

// 격자 정점 6개(선 3개) 뒤에 축 정점 4개(선 2개). buildScaffold 가 주는 배치와 같다
function makeScaffold() {
  return { verts: new Float32Array(30).map((_, i) => i * 0.25), gridVertCount: 6, axisVertCount: 4 };
}

// 채널마다 값이 다른 색을 쓴다(검정·흰색은 채널을 바꿔 넣어도 같아서 변이를 못 잡는다)
const THEME_A: Points3dTheme = {
  background: '#102030', flat: '#4cc96f', depression: '#f5c33b', protrusion: '#f06464', none: '#4a4f57',
  line: '#336699', gridAlpha: 0.09, axisAlpha: 0.28,
  text: '#f2f4f7', textSecondary: '#9aa3ad', readoutBackground: '#000000', readoutAlpha: 0.8,
};
const THEME_B: Points3dTheme = {
  ...THEME_A,
  background: '#ffffff', flat: '#1e9e50', depression: '#b88700', protrusion: '#d93636', none: '#b4bac2',
  line: '#000716',
};

function makeFrame(over: Partial<FrameParams> = {}): FrameParams {
  return {
    viewProj: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    exaggeration: 50,
    thresholdQ: 70,
    pointWorldM: 0.006875,   // 0.55 x 0.0125
    pxPerUnit: 1318.5,
    minPx: 3,
    maxPx: 64,
    drawCount: 3,
    theme: THEME_A,
    ...over,
  };
}

function mount(opts?: { pointSizeRange?: [number, number] }) {
  const rec = recordingGl(opts);
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
  const canvas = document.createElement('canvas');
  const on = { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() };
  const renderer = createRenderer(canvas, on);
  if (!renderer) throw new Error('createRenderer 가 null 을 돌려줬다');
  return { rec, getContext, canvas, on, renderer };
}

// uniform 호출의 값(위치 인자 뒤의 숫자들). uniform3f 로 부르든 uniform3fv 로 부르든 같은 배열이 된다
function valuesOf(call: GlCall): number[] {
  return call.args.slice(1).flatMap((a) => {
    if (typeof a === 'number') return [a];
    if (ArrayBuffer.isView(a) || Array.isArray(a)) return Array.from(a as ArrayLike<number>);
    return [];
  });
}

// calls[index] 보다 앞에서 조건에 맞는 마지막 호출
function lastBefore(rec: RecordingGl, index: number, match: (c: GlCall) => boolean): GlCall | undefined {
  for (let i = index - 1; i >= 0; i--) if (match(rec.calls[i])) return rec.calls[i];
  return undefined;
}

// calls[index] 시점에 cap 이 켜져 있는가(마지막 enable/disable 기준. WebGL 기본값은 꺼짐)
function enabledAt(rec: RecordingGl, index: number, cap: number): boolean {
  return lastBefore(rec, index, (c) => (c.name === 'enable' || c.name === 'disable') && c.args[0] === cap)?.name === 'enable';
}

// calls[index] 시점에 묶여 있는 것(bindBuffer·bindVertexArray·useProgram 의 마지막 인자)
function boundAt(rec: RecordingGl, index: number, binder: 'bindBuffer' | 'bindVertexArray' | 'useProgram'): unknown {
  const call = lastBefore(rec, index, (c) => c.name === binder);
  return call?.args[call.args.length - 1];
}

// calls[index] 시점의 uColor 값
function lineColorAt(rec: RecordingGl, index: number): number[] {
  const call = lastBefore(rec, index, (c) => c.name.startsWith('uniform')
    && (c.args[0] as { uniformName?: string } | null)?.uniformName === 'uColor');
  return call ? valuesOf(call) : [];
}

const indexOf = (rec: RecordingGl, call: GlCall) => rec.calls.indexOf(call);
const lineDraws = (rec: RecordingGl) => rec.callsOf('drawArrays').filter((c) => c.args[0] === rec.gl.LINES);
const pointDrawCalls = (rec: RecordingGl) => rec.callsOf('drawArrays').filter((c) => c.args[0] === rec.gl.POINTS);
const fire = (canvas: HTMLCanvasElement, type: string) => {
  const event = new Event(type, { cancelable: true });
  canvas.dispatchEvent(event);
  return event;
};

describe('createRenderer: 생성', () => {
  // 죽이는 변이: 컨텍스트 옵션 변경(antialias 를 켜면 점 가장자리와 성능이 달라진다), null 검사 누락
  it("canvas.getContext('webgl2', { antialias: false, alpha: false }) 를 한 번 부른다", () => {
    const { getContext } = mount();
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext.mock.calls[0]).toEqual(['webgl2', { antialias: false, alpha: false }]);
  });

  it('getContext 가 null 이면 null 을 돌려준다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const on = { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() };
    expect(createRenderer(document.createElement('canvas'), on)).toBeNull();
  });

  // 죽이는 변이: `#version` 앞에 줄바꿈(실제 브라우저에서 컴파일 실패), GLSL 에 비 ASCII 문자
  it('셰이더 4개는 전부 첫 줄이 #version 300 es 이고 ASCII 만 쓴다', () => {
    const { rec } = mount();
    const sources = rec.callsOf('shaderSource').map((c) => c.args[1] as string);
    expect(sources).toHaveLength(4);
    for (const source of sources) {
      expect(source.startsWith('#version 300 es\n')).toBe(true);
      expect([...source].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    }
  });

  // jsdom 은 GLSL 을 실행하지 못하므로 gl 호출과 맞물리는 선언만 소스로 확인한다.
  // 죽이는 변이: aDev 를 float 로 선언(vertexAttribIPointer 와 어긋나 값이 정의되지 않는다),
  // uThresholdQ 를 float 로 선언(uniform1i 와 어긋나 값이 들어가지 않는다), 센티널 경계 변경,
  // 과장을 z 전체에 적용, 깊이를 표시 위치로 계산, 네모 점
  it('점 셰이더의 선언과 식이 스펙 §7.5 와 맞는다', () => {
    const { rec } = mount();
    const sources = rec.callsOf('shaderSource').map((c) => c.args[1] as string);
    const pointVs = sources.find((s) => s.includes('aDev'));
    const pointFs = sources.find((s) => s.includes('gl_PointCoord'));
    expect(pointVs).toBeDefined();
    expect(pointFs).toBeDefined();
    expect(pointVs).toMatch(/\bin\s+int\s+aDev\s*;/);
    expect(pointVs).toMatch(/\bin\s+vec3\s+aPos\s*;/);
    expect(pointVs).toMatch(/\buniform\s+int\s+uThresholdQ\s*;/);
    expect(pointVs).toMatch(/aDev\s*>\s*-32767\b/);                        // 센티널 2종(-32768, -32767)은 편차 없음
    expect(pointVs).toMatch(/devM\s*\*\s*\(\s*uExag\s*-\s*1\.0\s*\)/);       // 편차만 과장: dev x (k - 1)
    expect(pointVs).toMatch(/clipR\.z\s*\/\s*clipR\.w\s*\*\s*clipS\.w/);     // 깊이는 기준면 위치
    expect(pointVs).toMatch(/aDev\s*>\s*uThresholdQ/);
    expect(pointVs).toMatch(/aDev\s*<\s*-\s*uThresholdQ/);
    expect(pointFs).toMatch(/length\(\s*gl_PointCoord\s*-\s*0\.5\s*\)\s*>\s*0\.5\s*\)\s*discard/);   // 둥근 점
  });

  // 죽이는 변이: 링크 뒤 셰이더 객체를 지우지 않음(누수)
  it('링크가 끝난 셰이더 객체 4개를 지운다', () => {
    const rec = recordingGl();
    const made = vi.spyOn(rec.gl, 'createShader');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
    createRenderer(document.createElement('canvas'), { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() });
    const created = made.mock.results.map((r) => r.value);
    const deleted = rec.callsOf('deleteShader').map((c) => c.args[0]);
    expect(created).toHaveLength(4);
    for (const shader of created) expect(deleted).toContain(shader);
  });

  // 죽이는 변이: 컴파일 실패를 무시하고 렌더러를 돌려줌(빈 캔버스), 리스너를 먼저 달고 떼지 않음
  it('셰이더 컴파일이 실패하면 null 이고 리스너를 남기지 않는다', () => {
    const rec = recordingGl();
    vi.spyOn(rec.gl, 'getShaderParameter').mockReturnValue(false);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
    const canvas = document.createElement('canvas');
    const on = { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() };
    expect(createRenderer(canvas, on)).toBeNull();
    expect(logged).toHaveBeenCalled();
    expect(fire(canvas, 'webglcontextlost').defaultPrevented).toBe(false);
    expect(on.lost).not.toHaveBeenCalled();
  });

  // 죽이는 변이: 링크 실패를 무시, 실패 경로에서 만든 프로그램·버퍼·VAO 를 지우지 않음
  it('프로그램 링크가 실패하면 null 이고 만든 프로그램·버퍼·VAO 를 전부 지운다', () => {
    const rec = recordingGl();
    vi.spyOn(rec.gl, 'getProgramParameter').mockReturnValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const programs = vi.spyOn(rec.gl, 'createProgram');
    const buffers = vi.spyOn(rec.gl, 'createBuffer');
    const vaos = vi.spyOn(rec.gl, 'createVertexArray');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
    const on = { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() };
    expect(createRenderer(document.createElement('canvas'), on)).toBeNull();
    const deleted = (name: string) => rec.callsOf(name).map((c) => c.args[0]);
    expect(programs.mock.results.length).toBeGreaterThan(0);
    for (const r of programs.mock.results) expect(deleted('deleteProgram')).toContain(r.value);
    for (const r of buffers.mock.results) expect(deleted('deleteBuffer')).toContain(r.value);
    for (const r of vaos.mock.results) expect(deleted('deleteVertexArray')).toContain(r.value);
  });
});

describe('createRenderer: setData', () => {
  // 죽이는 변이: xyz 를 Float32Array 로 바꿔 올림(사본), 배열을 잘라 올림
  it('받은 배열 세 개를 사본 없이 그대로 올린다', () => {
    const { rec, renderer } = mount();
    const data = makeData();
    const scaffold = makeScaffold();
    renderer.setData(data, scaffold);
    const uploads = rec.callsOf('bufferData');
    expect(uploads).toHaveLength(3);
    for (const call of uploads) {
      expect(call.args[0]).toBe(rec.gl.ARRAY_BUFFER);
      expect(call.args[2]).toBe(rec.gl.STATIC_DRAW);
    }
    const uploaded = uploads.map((c) => c.args[1]);
    expect(uploaded).toContain(data.xyz);       // toContain 은 === 비교다. 같은 객체여야 한다
    expect(uploaded).toContain(data.dev);
    expect(uploaded).toContain(scaffold.verts);
  });

  // 죽이는 변이: aPos 정규화 플래그 false(좌표가 0~65535 로 들어가 화면 밖으로 나간다), FLOAT 로 선언,
  // 크기 3 이 아님, 다른 버퍼가 묶인 채 포인터를 잡음
  it('aPos 는 xyz 버퍼를 정규화 UNSIGNED_SHORT 3개로 읽는다', () => {
    const { rec, renderer } = mount();
    const data = makeData();
    renderer.setData(data, makeScaffold());
    const xyzUpload = rec.callsOf('bufferData').find((c) => c.args[1] === data.xyz) as GlCall;
    const xyzBuffer = boundAt(rec, indexOf(rec, xyzUpload), 'bindBuffer');
    const pointer = rec.callsOf('vertexAttribPointer').find((c) => c.args[2] === rec.gl.UNSIGNED_SHORT) as GlCall;
    expect(pointer).toBeDefined();
    expect(pointer.args).toEqual([rec.attribLocation('aPos'), 3, rec.gl.UNSIGNED_SHORT, true, 0, 0]);
    expect(boundAt(rec, indexOf(rec, pointer), 'bindBuffer')).toBe(xyzBuffer);
  });

  // 죽이는 변이: aDev 를 vertexAttribPointer(float)로(셰이더의 int 속성과 어긋난다), 크기·타입 변경,
  // dev 버퍼가 아닌 버퍼가 묶인 채 포인터를 잡음
  it('aDev 는 dev 버퍼를 vertexAttribIPointer(SHORT 1개)로 읽는다', () => {
    const { rec, renderer } = mount();
    const data = makeData();
    renderer.setData(data, makeScaffold());
    const devUpload = rec.callsOf('bufferData').find((c) => c.args[1] === data.dev) as GlCall;
    const devBuffer = boundAt(rec, indexOf(rec, devUpload), 'bindBuffer');
    const integerPointers = rec.callsOf('vertexAttribIPointer');
    expect(integerPointers).toHaveLength(1);
    expect(integerPointers[0].args).toEqual([rec.attribLocation('aDev'), 1, rec.gl.SHORT, 0, 0]);
    expect(boundAt(rec, indexOf(rec, integerPointers[0]), 'bindBuffer')).toBe(devBuffer);
    const xyzUpload = rec.callsOf('bufferData').find((c) => c.args[1] === data.xyz) as GlCall;
    expect(devBuffer).not.toBe(boundAt(rec, indexOf(rec, xyzUpload), 'bindBuffer'));   // xyz 와 다른 버퍼다
    // float 포인터로는 aDev 를 잡지 않는다. float 포인터 2개는 점 aPos(UNSIGNED_SHORT)와 선 aPos(FLOAT)뿐이다
    expect(rec.callsOf('vertexAttribPointer').map((c) => c.args[2]).sort()).toEqual([rec.gl.UNSIGNED_SHORT, rec.gl.FLOAT].sort());
  });

  // 죽이는 변이: enableVertexAttribArray 누락(속성이 꺼진 채라 모든 점이 같은 값으로 읽힌다),
  // 점 aPos 포인터를 선 VAO 에 잡음
  it('점 VAO 에서 aPos·aDev 를, 선 VAO 에서 aPos 를 켠다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    const vaoAt = (call: GlCall) => boundAt(rec, indexOf(rec, call), 'bindVertexArray');
    const pointVao = vaoAt(rec.callsOf('vertexAttribIPointer')[0]);
    const lineVao = vaoAt(rec.callsOf('vertexAttribPointer').find((c) => c.args[2] === rec.gl.FLOAT) as GlCall);
    const enabledIn = (vao: unknown) => rec.callsOf('enableVertexAttribArray')
      .filter((c) => vaoAt(c) === vao).map((c) => c.args[0]).sort();
    expect(enabledIn(pointVao)).toEqual([0, 1]);   // aPos 0, aDev 1
    expect(enabledIn(lineVao)).toEqual([0]);       // 선 프로그램의 aPos
    expect(vaoAt(rec.callsOf('vertexAttribPointer').find((c) => c.args[2] === rec.gl.UNSIGNED_SHORT) as GlCall)).toBe(pointVao);
  });

  // 죽이는 변이: 선 정점을 정규화 속성으로 올림, 점 VAO 에 선 포인터를 섞음
  it('선 aPos 는 scaffold.verts 버퍼를 FLOAT 3개로 읽고 점과 다른 VAO 에 둔다', () => {
    const { rec, renderer } = mount();
    const scaffold = makeScaffold();
    renderer.setData(makeData(), scaffold);
    const lineUpload = rec.callsOf('bufferData').find((c) => c.args[1] === scaffold.verts) as GlCall;
    const linePointer = rec.callsOf('vertexAttribPointer').find((c) => c.args[2] === rec.gl.FLOAT) as GlCall;
    expect(linePointer.args).toEqual([0, 3, rec.gl.FLOAT, false, 0, 0]);
    expect(boundAt(rec, indexOf(rec, linePointer), 'bindBuffer')).toBe(boundAt(rec, indexOf(rec, lineUpload), 'bindBuffer'));
    const lineVao = boundAt(rec, indexOf(rec, linePointer), 'bindVertexArray');
    const pointVao = boundAt(rec, indexOf(rec, rec.callsOf('vertexAttribIPointer')[0]), 'bindVertexArray');
    expect(lineVao).toBeTruthy();
    expect(pointVao).toBeTruthy();
    expect(lineVao).not.toBe(pointVao);
  });
});

describe('createRenderer: draw', () => {
  // 죽이는 변이: uThresholdQ 를 float uniform 으로(uniform1f), 임계값을 mm 로 나눠 넘김
  it('uThresholdQ 는 정수 uniform(uniform1i)으로 프레임 값 그대로 넘어간다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame({ thresholdQ: 70 }));
    renderer.draw(makeFrame({ thresholdQ: 15 }));
    expect(rec.uniformCalls('uThresholdQ').map((c) => [c.name, c.args[1]])).toEqual([['uniform1i', 70], ['uniform1i', 15]]);
  });

  // 죽이는 변이: uExag 에 (k - 1)을 넘김, uPxPerUnit·uMinPx·uMaxPx·uPointWorldM 를 서로 바꿔 넘김, 값 가공
  it('uExag·uPointWorldM·uPxPerUnit·uMinPx·uMaxPx 는 FrameParams 값 그대로다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame());
    const last = (name: string) => valuesOf(rec.uniformCalls(name).slice(-1)[0]);
    expect(last('uExag')).toEqual([50]);
    expect(last('uPointWorldM')).toEqual([0.006875]);
    expect(last('uPxPerUnit')).toEqual([1318.5]);
    expect(last('uMinPx')).toEqual([3]);
    expect(last('uMaxPx')).toEqual([64]);
  });

  // 죽이는 변이: uExtent 에 fit 범위나 origin 을 넘김, 축 순서 바꿈
  it('uExtent 는 메타의 extent_m 이다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame());
    expect(valuesOf(rec.uniformCalls('uExtent').slice(-1)[0])).toEqual([4.0, 2.5, 0.3125]);
  });

  // 죽이는 변이: 분류 색을 서로 바꿔 넘김, 색을 생성 시점에 고정(배경 전환이 반영되지 않는다)
  it('색 uniform 4개는 프레임 테마의 hex 를 0~1 로 바꾼 값이다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    const last = (name: string) => valuesOf(rec.uniformCalls(name).slice(-1)[0]);
    renderer.draw(makeFrame({ theme: THEME_A }));
    expect(last('uColFlat')).toEqual([76 / 255, 201 / 255, 111 / 255]);    // #4cc96f
    expect(last('uColDep')).toEqual([245 / 255, 195 / 255, 59 / 255]);     // #f5c33b
    expect(last('uColPro')).toEqual([240 / 255, 100 / 255, 100 / 255]);    // #f06464
    expect(last('uColNone')).toEqual([74 / 255, 79 / 255, 87 / 255]);      // #4a4f57
    renderer.draw(makeFrame({ theme: THEME_B }));
    expect(last('uColFlat')).toEqual([30 / 255, 158 / 255, 80 / 255]);     // #1e9e50
    expect(last('uColDep')).toEqual([184 / 255, 135 / 255, 0]);            // #b88700
    expect(last('uColPro')).toEqual([217 / 255, 54 / 255, 54 / 255]);      // #d93636
    expect(last('uColNone')).toEqual([180 / 255, 186 / 255, 194 / 255]);   // #b4bac2
  });

  // 죽이는 변이: 한쪽 프로그램에 행렬을 넘기지 않음(선이나 점이 제자리에 안 그려진다), 전치 플래그 true
  it('uViewProj 는 선 프로그램과 점 프로그램 양쪽에 전치 없이 넘어간다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame());
    const calls = rec.uniformCalls('uViewProj');
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.name).toBe('uniformMatrix4fv');
      expect(call.args[1]).toBe(false);
      expect(valuesOf(call)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    }
    const programs = calls.map((c) => (c.args[0] as { program: unknown }).program);
    expect(programs[0]).not.toBe(programs[1]);
  });

  // 죽이는 변이: drawCount 무시(항상 n), 버퍼보다 많이 그림(실제 GL 에서는 아무것도 안 그려진다)
  it('점은 drawArrays(POINTS, 0, drawCount) 로 앞 drawCount 개만 그리고 n 을 넘지 않는다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());   // n = 5
    renderer.draw(makeFrame({ drawCount: 3 }));
    renderer.draw(makeFrame({ drawCount: 5 }));
    renderer.draw(makeFrame({ drawCount: 9 }));
    expect(rec.pointDraws()).toEqual([3, 5, 5]);
    expect(pointDrawCalls(rec)).toHaveLength(3);   // first 가 0 이 아닌 점 그리기는 없다
  });

  // 죽이는 변이: 격자와 축을 한 번에 그림(축선 알파가 격자와 같아진다), 구간 시작·개수 틀림, 알파 바꿔 넘김
  it('선은 격자 구간과 축 구간을 두 번에 나눠 그리고 uColor 알파가 gridAlpha, axisAlpha 다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());   // 격자 6, 축 4
    renderer.draw(makeFrame({ theme: THEME_A }));
    const draws = lineDraws(rec);
    expect(draws.map((c) => c.args)).toEqual([[rec.gl.LINES, 0, 6], [rec.gl.LINES, 6, 4]]);
    // #336699 = (51, 102, 153) / 255 = (0.2, 0.4, 0.6)
    expect(lineColorAt(rec, indexOf(rec, draws[0]))).toEqual([51 / 255, 102 / 255, 153 / 255, 0.09]);
    expect(lineColorAt(rec, indexOf(rec, draws[1]))).toEqual([51 / 255, 102 / 255, 153 / 255, 0.28]);
  });

  // 죽이는 변이: 배경색 고정, 깊이 버퍼를 지우지 않음, 채널 순서 바꿈
  it('테마 배경색으로 색과 깊이를 지운다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame({ theme: THEME_A }));
    renderer.draw(makeFrame({ theme: THEME_B }));
    const clears = rec.callsOf('clear');
    expect(clears.map((c) => c.args)).toEqual([[0x4100], [0x4100]]);   // COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT
    const colorAt = (call: GlCall) => lastBefore(rec, indexOf(rec, call), (c) => c.name === 'clearColor')?.args;
    expect(colorAt(clears[0])).toEqual([16 / 255, 32 / 255, 48 / 255, 1]);   // #102030
    expect(colorAt(clears[1])).toEqual([1, 1, 1, 1]);                        // #ffffff
  });

  // 죽이는 변이: 점을 먼저 그림, 선에서 깊이를 씀(점이 선에 가려진다), 선 블렌딩 누락(알파가 무시된다),
  // 점에서 블렌딩을 끄지 않음, 깊이 테스트 누락, 점 단계가 깊이 쓰기를 되돌리지 않음(다음 프레임에 깊이가 안 지워진다)
  it('그리기 순서와 상태: clear -> 선(블렌딩 켬, 깊이 쓰기 끔) -> 점(블렌딩 끔, 깊이 테스트 LESS, 깊이 쓰기 켬)', () => {
    const { rec, renderer } = mount();
    const { gl } = rec;
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame());
    renderer.draw(makeFrame());
    const steps = rec.calls.filter((c) => c.name === 'clear' || c.name === 'drawArrays');
    expect(steps.map((c) => (c.name === 'clear' ? 'clear' : c.args[0] === gl.LINES ? 'LINES' : 'POINTS')))
      .toEqual(['clear', 'LINES', 'LINES', 'POINTS', 'clear', 'LINES', 'LINES', 'POINTS']);

    const depthMaskAt = (index: number) => lastBefore(rec, index, (c) => c.name === 'depthMask')?.args[0] ?? true;
    for (const line of lineDraws(rec)) {
      const at = indexOf(rec, line);
      expect(enabledAt(rec, at, gl.BLEND)).toBe(true);
      expect(lastBefore(rec, at, (c) => c.name === 'blendFunc')?.args).toEqual([gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA]);
      expect(depthMaskAt(at)).toBe(false);
    }
    for (const point of pointDrawCalls(rec)) {
      const at = indexOf(rec, point);
      expect(enabledAt(rec, at, gl.BLEND)).toBe(false);
      expect(enabledAt(rec, at, gl.DEPTH_TEST)).toBe(true);
      expect(lastBefore(rec, at, (c) => c.name === 'depthFunc')?.args[0] ?? gl.LESS).toBe(gl.LESS);
      expect(depthMaskAt(at)).toBe(true);
    }
    // 둘째 프레임의 clear 시점에 깊이 쓰기가 켜져 있어야 깊이 버퍼가 지워진다
    expect(depthMaskAt(indexOf(rec, rec.callsOf('clear')[1]))).toBe(true);
  });

  // 죽이는 변이: draw 에서 useProgram·bindVertexArray 누락(다른 프로그램·VAO 로 그린다)
  it('선과 점을 각자의 프로그램과 VAO 로 그린다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame());
    const programOf = (uniformName: string) => (rec.uniformCalls(uniformName)[0].args[0] as { program: unknown }).program;
    const pointVao = boundAt(rec, indexOf(rec, rec.callsOf('vertexAttribIPointer')[0]), 'bindVertexArray');
    const linePointer = rec.callsOf('vertexAttribPointer').find((c) => c.args[2] === rec.gl.FLOAT) as GlCall;
    const lineVao = boundAt(rec, indexOf(rec, linePointer), 'bindVertexArray');
    for (const line of lineDraws(rec)) {
      expect(boundAt(rec, indexOf(rec, line), 'useProgram')).toBe(programOf('uColor'));
      expect(boundAt(rec, indexOf(rec, line), 'bindVertexArray')).toBe(lineVao);
    }
    const point = pointDrawCalls(rec)[0];
    expect(boundAt(rec, indexOf(rec, point), 'useProgram')).toBe(programOf('uThresholdQ'));
    expect(boundAt(rec, indexOf(rec, point), 'bindVertexArray')).toBe(pointVao);
  });

  it('setData 전에는 아무것도 그리지 않는다', () => {
    const { rec, renderer } = mount();
    renderer.draw(makeFrame());
    expect(rec.callsOf('drawArrays')).toEqual([]);
    expect(rec.callsOf('clear')).toEqual([]);
  });
});

describe('createRenderer: resize·pointSizeLimit·dispose', () => {
  // 죽이는 변이: viewport 누락(캔버스 크기가 바뀌어도 그림이 옛 크기로 나온다), 폭·높이 바꿔 넣음
  it('resize 는 canvas.width·height 와 viewport 를 맞춘다', () => {
    const { rec, canvas, renderer } = mount();
    renderer.resize(1280, 960);
    expect([canvas.width, canvas.height]).toEqual([1280, 960]);
    expect(rec.callsOf('viewport').slice(-1)[0].args).toEqual([0, 0, 1280, 960]);
  });

  // 죽이는 변이: 고정값 반환, 다른 파라미터를 읽음
  it('pointSizeLimit 은 ALIASED_POINT_SIZE_RANGE 다', () => {
    const { rec, renderer } = mount({ pointSizeRange: [1, 64] });
    expect(renderer.pointSizeLimit()).toEqual([1, 64]);
    expect(rec.callsOf('getParameter').map((c) => c.args[0])).toContain(rec.gl.ALIASED_POINT_SIZE_RANGE);
  });

  // 죽이는 변이: dispose 에서 loseContext 호출, 버퍼·VAO·프로그램 삭제 누락, 리스너를 떼지 않음
  it('dispose 는 버퍼 3·VAO 2·프로그램 2를 지우고 리스너를 떼며 loseContext 를 부르지 않는다', () => {
    const rec = recordingGl();
    const programs = vi.spyOn(rec.gl, 'createProgram');
    const buffers = vi.spyOn(rec.gl, 'createBuffer');
    const vaos = vi.spyOn(rec.gl, 'createVertexArray');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
    const canvas = document.createElement('canvas');
    const on = { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() };
    const renderer = createRenderer(canvas, on);
    renderer?.setData(makeData(), makeScaffold());
    renderer?.dispose();

    const made = (spy: { mock: { results: Array<{ value: unknown }> } }) => spy.mock.results.map((r) => r.value);
    const deleted = (name: string) => rec.callsOf(name).map((c) => c.args[0]);
    expect(made(buffers)).toHaveLength(3);
    expect(made(vaos)).toHaveLength(2);
    expect(made(programs)).toHaveLength(2);
    for (const buffer of made(buffers)) expect(deleted('deleteBuffer')).toContain(buffer);
    for (const vao of made(vaos)) expect(deleted('deleteVertexArray')).toContain(vao);
    for (const program of made(programs)) expect(deleted('deleteProgram')).toContain(program);
    expect(rec.loseContextCalls()).toBe(0);

    // 리스너가 떨어졌다: 손실 이벤트의 기본 동작을 막지 않고 콜백도 부르지 않는다
    expect(fire(canvas, 'webglcontextlost').defaultPrevented).toBe(false);
    expect(on.lost).not.toHaveBeenCalled();
    // dispose 뒤의 draw 는 아무것도 하지 않는다
    const before = rec.calls.length;
    renderer?.draw(makeFrame());
    expect(rec.calls.length).toBe(before);
  });
});

describe('createRenderer: 컨텍스트 손실과 복구', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('복구 대기 시간은 3,000ms 다', () => {
    expect(CONTEXT_RESTORE_TIMEOUT_MS).toBe(3000);
  });

  // 죽이는 변이: preventDefault 누락(브라우저가 복구 이벤트를 보내지 않는다), on.lost 누락, 손실 중에 그림
  it('손실: 기본 동작을 막고 on.lost 를 한 번 부르며 손실 중 draw 는 아무것도 하지 않는다', () => {
    const { rec, canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    const event = fire(canvas, 'webglcontextlost');
    expect(event.defaultPrevented).toBe(true);
    expect(on.lost).toHaveBeenCalledTimes(1);
    const before = rec.calls.length;
    renderer.draw(makeFrame());
    expect(rec.calls.length).toBe(before);
  });

  // 죽이는 변이: 복구 때 재업로드 누락(빈 캔버스), 프로그램을 다시 만들지 않음(끊긴 핸들로 그린다),
  // 복구돼도 타이머를 지우지 않음(3초 뒤 복구 불가를 잘못 알린다), on.restored 누락
  it('3,000ms 안에 복구되면 프로그램을 다시 만들고 보관한 배열을 다시 올린 뒤 on.restored 를 부른다', () => {
    const { rec, canvas, on, renderer } = mount();
    const data = makeData();
    const scaffold = makeScaffold();
    renderer.setData(data, scaffold);
    renderer.resize(1280, 960);
    renderer.draw(makeFrame());
    const oldProgram = (rec.uniformCalls('uThresholdQ')[0].args[0] as { program: unknown }).program;
    const oldXyzBuffer = boundAt(rec, indexOf(rec, rec.callsOf('bufferData')[0]), 'bindBuffer');

    fire(canvas, 'webglcontextlost');
    vi.advanceTimersByTime(2999);
    const seen = { programs: rec.callsOf('createProgram').length, uploads: rec.callsOf('bufferData').length, viewports: rec.callsOf('viewport').length };
    fire(canvas, 'webglcontextrestored');

    expect(rec.callsOf('createProgram')).toHaveLength(seen.programs + 2);
    const uploads = rec.callsOf('bufferData').slice(seen.uploads);
    expect(uploads).toHaveLength(3);
    const uploaded = uploads.map((c) => c.args[1]);
    expect(uploaded).toContain(data.xyz);
    expect(uploaded).toContain(data.dev);
    expect(uploaded).toContain(scaffold.verts);
    // 새로 만든 버퍼에 올린다(끊긴 컨텍스트의 버퍼 핸들을 다시 쓰지 않는다)
    const xyzUpload = uploads.find((c) => c.args[1] === data.xyz) as GlCall;
    expect(boundAt(rec, indexOf(rec, xyzUpload), 'bindBuffer')).not.toBe(oldXyzBuffer);
    expect(rec.callsOf('vertexAttribIPointer')).toHaveLength(2);
    // viewport 도 다시 맞춘다
    expect(rec.callsOf('viewport').slice(seen.viewports).map((c) => c.args)).toEqual([[0, 0, 1280, 960]]);
    expect(on.restored).toHaveBeenCalledTimes(1);

    // 복구 뒤에는 다시 그리고, 새 프로그램을 쓴다
    renderer.draw(makeFrame({ drawCount: 5 }));
    expect(rec.pointDraws()).toEqual([3, 5]);
    const newProgram = (rec.uniformCalls('uThresholdQ').slice(-1)[0].args[0] as { program: unknown }).program;
    expect(newProgram).not.toBe(oldProgram);

    // 복구됐으므로 3초가 지나도 복구 불가를 알리지 않는다
    vi.advanceTimersByTime(10_000);
    expect(on.unrecoverable).not.toHaveBeenCalled();
  });

  // 죽이는 변이: 3초 미복구 타이머 제거, 대기 시간을 다른 값으로, 두 번 알림
  it('3,000ms 가 지나도 복구되지 않으면 on.unrecoverable 을 한 번 부른다', () => {
    const { canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    fire(canvas, 'webglcontextlost');
    vi.advanceTimersByTime(2999);
    expect(on.unrecoverable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);
    expect(on.restored).not.toHaveBeenCalled();
  });

  // 죽이는 변이: 복구 불가를 알린 뒤 늦게 온 복구를 받아들임(화면은 이미 오류 안내로 넘어갔다)
  it('복구 불가를 알린 뒤 늦게 온 복구 이벤트는 무시한다', () => {
    const { rec, canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    fire(canvas, 'webglcontextlost');
    vi.advanceTimersByTime(3000);
    const before = rec.calls.length;
    fire(canvas, 'webglcontextrestored');
    renderer.draw(makeFrame());
    expect(rec.calls.length).toBe(before);
    expect(on.restored).not.toHaveBeenCalled();
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);
  });

  // 죽이는 변이: 손실 이벤트가 겹쳐 올 때 타이머를 여러 개 걺(복구 뒤에도 남은 타이머가 복구 불가를 알린다)
  it('손실 이벤트가 겹쳐 와도 on.lost 는 한 번이고, 복구 뒤 다시 끊기면 그때부터 3,000ms 를 다시 센다', () => {
    const { canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    fire(canvas, 'webglcontextlost');
    expect(fire(canvas, 'webglcontextlost').defaultPrevented).toBe(true);
    expect(on.lost).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    fire(canvas, 'webglcontextrestored');
    vi.advanceTimersByTime(500);
    fire(canvas, 'webglcontextlost');            // t = 1500ms 에 다시 끊김
    expect(on.lost).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2999);                // t = 4499ms
    expect(on.unrecoverable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);                   // t = 4500ms = 1500 + 3000
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);
  });

  // 죽이는 변이: 손실 중 setData 를 끊긴 컨텍스트에 올리고 잊음(복구 뒤 옛 데이터나 빈 버퍼로 그린다)
  it('손실 중에 받은 setData 는 복구 때 올린다', () => {
    const { rec, canvas, renderer } = mount();
    fire(canvas, 'webglcontextlost');
    const data = makeData();
    const scaffold = makeScaffold();
    renderer.setData(data, scaffold);
    expect(rec.callsOf('bufferData')).toEqual([]);
    fire(canvas, 'webglcontextrestored');
    const uploaded = rec.callsOf('bufferData').map((c) => c.args[1]);
    expect(uploaded).toHaveLength(3);
    expect(uploaded).toContain(data.xyz);
    renderer.draw(makeFrame({ drawCount: 4 }));
    expect(rec.pointDraws()).toEqual([4]);
  });

  // 죽이는 변이: 복구 때 다시 만들기가 실패해도 on.restored 를 부름(빈 캔버스를 정상으로 알린다)
  it('복구 때 셰이더를 다시 만들지 못하면 on.unrecoverable 을 부르고 on.restored 는 부르지 않는다', () => {
    const { rec, canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    fire(canvas, 'webglcontextlost');
    vi.spyOn(rec.gl, 'getShaderParameter').mockReturnValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fire(canvas, 'webglcontextrestored');
    expect(on.restored).not.toHaveBeenCalled();
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);   // 타이머가 한 번 더 알리지 않는다
  });

  // 죽이는 변이: dispose 가 타이머를 지우지 않음(언마운트된 컴포넌트에 복구 불가를 알린다)
  it('손실 대기 중에 dispose 하면 타이머가 지워져 on.unrecoverable 이 불리지 않는다', () => {
    const { canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    fire(canvas, 'webglcontextlost');
    renderer.dispose();
    vi.advanceTimersByTime(10_000);
    expect(on.unrecoverable).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: 실패 확인**

Run: `cd D:/Projects/Flatness/dashboard && npx vitest run lib/viz/points3d/__tests__/gl-renderer.test.ts`

Expected: FAIL. `Tests  35 failed | 13 passed (48)`. 새로 붙인 35건 중 34건은 `TypeError: createRenderer is not a function`, 1건(`복구 대기 시간은 3,000ms 다`)은 `expected undefined to be 3000` 으로 실패한다. Step 6 의 13건은 그대로 통과한다.

- [ ] **Step 9: `gl-renderer.ts` 2차 구현(`createRenderer`)**

`dashboard/lib/viz/points3d/gl-renderer.ts` **전체를** 아래 내용으로 바꾼다(Step 5 의 탐지 두 함수는 그대로 들어 있다).

```ts
// 3D 점군 뷰어의 유일한 WebGL2 접점. 환경 탐지, 셰이더·버퍼·draw·dispose, 컨텍스트 손실/복구를 맡는다.
// lib 의 다른 모듈은 WebGL 과 DOM 을 건드리지 않는다. probeWebgl2 와 createRenderer 는 effect 안에서만 부른다
// (모듈 최상위에서 컨텍스트를 만들지 않는다. 서버 렌더에서 이 모듈을 import 해도 아무 일도 일어나지 않는다).
import { DEV_NO_DEVIATION, hexToRgb01 } from '@/lib/domain/points3d';
import type { Points3dData, Points3dTheme, Webgl2Support } from '@/lib/domain/points3d';

export const CONTEXT_RESTORE_TIMEOUT_MS = 3000; // 컨텍스트 복구 대기(ms). 이 안에 복구되지 않으면 복구 불가로 알린다

export interface FrameParams {
  viewProj: Float32Array;   // 파일-로컬 좌표 -> 클립 좌표(열 우선 16개)
  exaggeration: number;     // 편차 과장 배율 k
  thresholdQ: number;       // 표시 임계값(0.1mm 정수)
  pointWorldM: number;      // 점의 실제 크기(m)
  pxPerUnit: number;        // 드로잉 버퍼 px
  minPx: number;            // 드로잉 버퍼 px
  maxPx: number;            // 드로잉 버퍼 px
  drawCount: number;        // 앞에서부터 그릴 점 수(LOD)
  theme: Points3dTheme;
}

export interface Renderer {
  setData(data: Points3dData, scaffold: { verts: Float32Array; gridVertCount: number; axisVertCount: number }): void;
  resize(bufferW: number, bufferH: number): void;   // 드로잉 버퍼 px. canvas.width·height 와 viewport 를 맞춘다
  draw(frame: FrameParams): void;
  pointSizeLimit(): [number, number];               // ALIASED_POINT_SIZE_RANGE
  dispose(): void;                                  // 버퍼·VAO·프로그램 삭제, 리스너 해제. loseContext 는 부르지 않는다
}

// ---- 셰이더 ----
// GLSL 문자열은 ASCII 만 쓴다. `#version` 은 반드시 첫 줄이어야 한다(백틱 바로 뒤에 붙인다).
// 색은 GLSL 에 상수로 적지 않는다. 전부 테마의 hex 를 uniform 으로 넘긴다.
//
// 점 정점 셰이더가 하는 일:
// - aPos(정규화 UNSIGNED_SHORT, 0~1)에 uExtent 를 곱해 파일-로컬 m 좌표를 만든다.
// - aDev(0.1mm 정수)가 센티널(DEV_NO_DEVIATION 이하)이면 편차 없는 점이다.
// - 표시 높이는 z + dev * (k - 1). 편차만 과장하고 편차 없는 점은 제자리다.
// - 편차 있는 점의 깊이는 과장 전 기준면 위치(z - dev)로 계산한다. 화면 위치는 표시 위치 그대로다.
//   바닥 점들이 같은 면에 놓여, 융기 점이 카메라에 가깝다는 이유로 침하 점을 가리지 않는다.
// - 분류는 정수 비교: dev > T 융기, dev < -T 침하, 그 외 평탄.
const POINT_VS = `#version 300 es
in vec3 aPos;
in int aDev;
uniform vec3 uExtent;
uniform mat4 uViewProj;
uniform float uExag;
uniform int uThresholdQ;
uniform float uPointWorldM;
uniform float uPxPerUnit;
uniform float uMinPx;
uniform float uMaxPx;
uniform vec3 uColFlat;
uniform vec3 uColDep;
uniform vec3 uColPro;
uniform vec3 uColNone;
out vec3 vColor;
void main() {
  vec3 local = aPos * uExtent;
  bool hasDev = aDev > ${DEV_NO_DEVIATION};
  float devM = hasDev ? float(aDev) * 1e-4 : 0.0;
  vec3 shown = local + vec3(0.0, 0.0, devM * (uExag - 1.0));
  vec4 clipS = uViewProj * vec4(shown, 1.0);
  if (hasDev) {
    vec4 clipR = uViewProj * vec4(local - vec3(0.0, 0.0, devM), 1.0);
    gl_Position = vec4(clipS.xy, clipR.z / clipR.w * clipS.w, clipS.w);
  } else {
    gl_Position = clipS;
  }
  gl_PointSize = clamp(uPointWorldM * uPxPerUnit / clipS.w, uMinPx, uMaxPx);
  vColor = !hasDev ? uColNone : aDev > uThresholdQ ? uColPro : aDev < -uThresholdQ ? uColDep : uColFlat;
}`;

// 둥근 점: 점 사각형의 중심에서 반지름 0.5 밖은 버린다
const POINT_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() {
  if (length(gl_PointCoord - 0.5) > 0.5) discard;
  outColor = vec4(vColor, 1.0);
}`;

// 격자·축선: 파일-로컬 float 좌표를 그대로 변환한다. 색은 알파를 포함한 uniform 하나다
const LINE_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uViewProj;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

const POINT_UNIFORMS = [
  'uExtent', 'uViewProj', 'uExag', 'uThresholdQ', 'uPointWorldM', 'uPxPerUnit', 'uMinPx', 'uMaxPx',
  'uColFlat', 'uColDep', 'uColPro', 'uColNone',
] as const;
const LINE_UNIFORMS = ['uViewProj', 'uColor'] as const;

type Locations<K extends string> = Record<K, WebGLUniformLocation | null>;
type Scaffold = { verts: Float32Array; gridVertCount: number; axisVertCount: number };

// GPU 쪽 자원 한 벌. 컨텍스트가 끊기면 전부 무효가 되므로 복구 때 통째로 다시 만든다
interface Gpu {
  pointProg: WebGLProgram;
  lineProg: WebGLProgram;
  pointU: Locations<(typeof POINT_UNIFORMS)[number]>;
  lineU: Locations<(typeof LINE_UNIFORMS)[number]>;
  aPos: number;
  aDev: number;
  lineAPos: number;
  pointVao: WebGLVertexArrayObject;
  lineVao: WebGLVertexArrayObject;
  xyzBuf: WebGLBuffer;
  devBuf: WebGLBuffer;
  lineBuf: WebGLBuffer;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(`[points3d] shader compile failed: ${gl.getShaderInfoLog(shader) ?? ''}`);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = vs && fs ? gl.createProgram() : null;
  if (program && vs && fs) {
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
  }
  // 링크가 끝나면 셰이더 객체는 필요 없다(프로그램이 결과를 들고 있다). delete* 는 null 을 받아도 된다
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (program && !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(`[points3d] program link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function locate<K extends string>(gl: WebGL2RenderingContext, program: WebGLProgram, names: readonly K[]): Locations<K> {
  const out = {} as Locations<K>;
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}

function destroy(gl: WebGL2RenderingContext, gpu: Gpu): void {
  gl.deleteBuffer(gpu.xyzBuf);
  gl.deleteBuffer(gpu.devBuf);
  gl.deleteBuffer(gpu.lineBuf);
  gl.deleteVertexArray(gpu.pointVao);
  gl.deleteVertexArray(gpu.lineVao);
  gl.deleteProgram(gpu.pointProg);
  gl.deleteProgram(gpu.lineProg);
}

// 프로그램 2개, VAO 2개, 버퍼 3개를 만든다. 하나라도 실패하면 만든 것을 지우고 null 을 돌려준다
function build(gl: WebGL2RenderingContext): Gpu | null {
  const pointProg = link(gl, POINT_VS, POINT_FS);
  const lineProg = link(gl, LINE_VS, LINE_FS);
  const pointVao = gl.createVertexArray();
  const lineVao = gl.createVertexArray();
  const xyzBuf = gl.createBuffer();
  const devBuf = gl.createBuffer();
  const lineBuf = gl.createBuffer();
  if (!pointProg || !lineProg || !pointVao || !lineVao || !xyzBuf || !devBuf || !lineBuf) {
    gl.deleteProgram(pointProg);
    gl.deleteProgram(lineProg);
    gl.deleteVertexArray(pointVao);
    gl.deleteVertexArray(lineVao);
    gl.deleteBuffer(xyzBuf);
    gl.deleteBuffer(devBuf);
    gl.deleteBuffer(lineBuf);
    return null;
  }
  return {
    pointProg,
    lineProg,
    pointU: locate(gl, pointProg, POINT_UNIFORMS),
    lineU: locate(gl, lineProg, LINE_UNIFORMS),
    aPos: gl.getAttribLocation(pointProg, 'aPos'),
    aDev: gl.getAttribLocation(pointProg, 'aDev'),
    lineAPos: gl.getAttribLocation(lineProg, 'aPos'),
    pointVao,
    lineVao,
    xyzBuf,
    devBuf,
    lineBuf,
  };
}

// 받은 배열을 그대로 올린다. xyz 는 Uint16Array 를 정규화 속성으로 넘긴다(Float32Array 사본을 만들지 않는다)
function upload(gl: WebGL2RenderingContext, gpu: Gpu, data: Points3dData, scaffold: Scaffold): void {
  gl.bindVertexArray(gpu.pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.xyzBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data.xyz, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(gpu.aPos);
  gl.vertexAttribPointer(gpu.aPos, 3, gl.UNSIGNED_SHORT, true, 0, 0);   // 정규화: 0~65535 -> 0~1
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.devBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data.dev, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(gpu.aDev);
  gl.vertexAttribIPointer(gpu.aDev, 1, gl.SHORT, 0, 0);                 // 정수 속성: 셰이더가 int 로 받는다
  gl.bindVertexArray(gpu.lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.lineBuf);
  gl.bufferData(gl.ARRAY_BUFFER, scaffold.verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(gpu.lineAPos);
  gl.vertexAttribPointer(gpu.lineAPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
}

// 탐지용 컨텍스트를 하나 만들어 보고 곧바로 반납한다. canvas 는 문서에 붙이지 않고 버린다
function canCreateContext(attributes?: WebGLContextAttributes): boolean {
  const canvas = document.createElement('canvas');
  const gl = attributes ? canvas.getContext('webgl2', attributes) : canvas.getContext('webgl2');
  if (!gl) return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

// WebGL2 환경 탐지. 성능 저하 없이 만들 수 있으면 'hardware', 옵션 없이만 만들어지면 'software'(소프트웨어 렌더)
export function probeWebgl2(): Webgl2Support {
  if (canCreateContext({ failIfMajorPerformanceCaveat: true })) return 'hardware';
  if (canCreateContext()) return 'software';
  return 'unsupported';
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  on: { lost(): void; restored(): void; unrecoverable(): void },
): Renderer | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return null;
  let gpu = build(gl);
  if (!gpu) return null;   // 셰이더 컴파일·링크 실패. 호출자가 WebGL2 불가 화면으로 사유를 드러낸다

  // 기기의 성질이라 한 번만 읽는다(컨텍스트가 끊긴 동안에는 getParameter 가 null 을 준다)
  const sizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
  const sizeLimit: [number, number] = sizeRange ? [sizeRange[0], sizeRange[1]] : [1, 1];

  let held: { data: Points3dData; scaffold: Scaffold } | null = null;   // 복구 때 다시 올릴 배열 참조
  let lost = false;
  let unrecoverable = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onLost = (event: Event) => {
    event.preventDefault();   // 기본 동작을 막아야 webglcontextrestored 가 온다
    if (lost) return;
    lost = true;
    gpu = null;               // 끊긴 컨텍스트의 자원은 이미 무효다
    timer = setTimeout(() => {
      timer = null;
      unrecoverable = true;
      on.unrecoverable();
    }, CONTEXT_RESTORE_TIMEOUT_MS);
    on.lost();
  };

  const onRestored = () => {
    if (!lost || unrecoverable) return;   // 복구 불가를 알린 뒤 늦게 온 복구는 무시한다
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    gpu = build(gl);
    if (!gpu) {               // 다시 만들지 못하면 조용히 빈 캔버스로 두지 않고 복구 불가로 알린다
      unrecoverable = true;
      on.unrecoverable();
      return;
    }
    lost = false;
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (held) upload(gl, gpu, held.data, held.scaffold);
    on.restored();
  };

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    setData(data, scaffold) {
      held = { data, scaffold };
      if (gpu) upload(gl, gpu, data, scaffold);   // 손실 중이면 복구 때 올린다
    },

    resize(bufferW, bufferH) {
      if (canvas.width !== bufferW) canvas.width = bufferW;
      if (canvas.height !== bufferH) canvas.height = bufferH;
      gl.viewport(0, 0, bufferW, bufferH);
    },

    draw(frame) {
      if (!gpu || !held) return;   // 손실 중이거나 데이터가 아직 없다
      const theme = frame.theme;
      const scaffold = held.scaffold;

      // (1) 배경색으로 지운다. 깊이 쓰기는 직전 프레임의 점 단계가 켜 둔 채다(끄면 깊이 버퍼가 지워지지 않는다)
      const [bgR, bgG, bgB] = hexToRgb01(theme.background);
      gl.clearColor(bgR, bgG, bgB, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // (2) 격자·축선: 블렌딩 켬, 깊이 쓰기 끔. 같은 정점 버퍼의 두 구간을 색만 바꿔 그린다
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(gpu.lineProg);
      gl.bindVertexArray(gpu.lineVao);
      gl.uniformMatrix4fv(gpu.lineU.uViewProj, false, frame.viewProj);
      const [lineR, lineG, lineB] = hexToRgb01(theme.line);
      gl.uniform4f(gpu.lineU.uColor, lineR, lineG, lineB, theme.gridAlpha);
      gl.drawArrays(gl.LINES, 0, scaffold.gridVertCount);
      gl.uniform4f(gpu.lineU.uColor, lineR, lineG, lineB, theme.axisAlpha);
      gl.drawArrays(gl.LINES, scaffold.gridVertCount, scaffold.axisVertCount);

      // (3) 점: 블렌딩 끔, 깊이 테스트 LESS, 깊이 쓰기 켬
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.useProgram(gpu.pointProg);
      gl.bindVertexArray(gpu.pointVao);
      const u = gpu.pointU;
      const extent = held.data.meta.extent_m;
      gl.uniformMatrix4fv(u.uViewProj, false, frame.viewProj);
      gl.uniform3f(u.uExtent, extent[0], extent[1], extent[2]);
      gl.uniform1f(u.uExag, frame.exaggeration);
      gl.uniform1i(u.uThresholdQ, frame.thresholdQ);   // 정수 uniform. 셰이더의 비교가 정수 비교다
      gl.uniform1f(u.uPointWorldM, frame.pointWorldM);
      gl.uniform1f(u.uPxPerUnit, frame.pxPerUnit);
      gl.uniform1f(u.uMinPx, frame.minPx);
      gl.uniform1f(u.uMaxPx, frame.maxPx);
      gl.uniform3f(u.uColFlat, ...hexToRgb01(theme.flat));
      gl.uniform3f(u.uColDep, ...hexToRgb01(theme.depression));
      gl.uniform3f(u.uColPro, ...hexToRgb01(theme.protrusion));
      gl.uniform3f(u.uColNone, ...hexToRgb01(theme.none));
      // 파일이 해시 순이라 앞 drawCount 개가 고른 표본이다. 버퍼 밖을 그리면 아무것도 나오지 않으므로 n 으로 막는다
      const n = held.data.dev.length;
      gl.drawArrays(gl.POINTS, 0, Math.max(0, Math.min(n, Math.floor(frame.drawCount))));
      gl.bindVertexArray(null);
    },

    pointSizeLimit() {
      return [sizeLimit[0], sizeLimit[1]];
    },

    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (gpu) destroy(gl, gpu);
      gpu = null;
      held = null;
      // WEBGL_lose_context.loseContext() 를 부르지 않는다. React 개발 모드의 effect 이중 실행이 같은 canvas 를
      // 다시 쓰는데, 한 번 끊은 canvas 는 다시 getContext 해도 끊긴 컨텍스트를 돌려준다.
    },
  };
}
```

- [ ] **Step 10: 통과 확인**

Run: `cd D:/Projects/Flatness/dashboard && npx vitest run lib/viz/points3d/__tests__/gl-renderer.test.ts`

Expected: PASS. `Test Files  1 passed (1)`, `Tests  48 passed (48)`(스텁 규약 8, `probeWebgl2` 5, 생성 7, setData 5, draw 11, resize·pointSizeLimit·dispose 3, 컨텍스트 손실과 복구 9). 컴파일·링크 실패를 만드는 테스트 3건은 `console.error` 를 가짜로 바꿔 두므로 출력에 오류 로그가 섞이지 않는다.

- [ ] **Step 11: 폴더 전체·팔레트 스윕·타입 검사·금지 문자열**

Run:

```bash
cd D:/Projects/Flatness/dashboard
npx vitest run lib/viz/points3d __tests__/palette-sweep.test.ts
npx tsc --noEmit
grep -nE "pass_mm|rework_mm|u_mm|applied_criteria" lib/viz/points3d/gl-renderer.ts lib/viz/points3d/__tests__/gl-stub.ts lib/viz/points3d/__tests__/gl-renderer.test.ts; echo "exit=$?"
LC_ALL=C grep -c $'\xe2\x80\x94' lib/viz/points3d/gl-renderer.ts lib/viz/points3d/__tests__/gl-stub.ts lib/viz/points3d/__tests__/gl-renderer.test.ts
```

Expected:
- 첫 명령: 실패 0. 이 태스크의 48건과 Task 8~10 의 테스트(`mat4`·`orbit`·`scaffold`·`budget`·`pick`·`controls`), 팔레트 스윕 2건이 전부 통과한다. `gl-stub.ts` 는 테스트 파일로 세어지지 않는다.
- 둘째 명령: 출력 없음, 종료 코드 0.
- 셋째 명령: 일치하는 줄 없음, `exit=1`.
- 넷째 명령: 세 파일 모두 `:0`.

- [ ] **Step 12: 스테이징 후 변이 확인(테스트가 회귀를 잡는지)**

먼저 구현 파일을 스테이징한다(아래 변이를 되돌릴 때 인덱스가 원본 역할을 한다).

```bash
cd D:/Projects/Flatness
git add dashboard/lib/viz/points3d/gl-renderer.ts
```

아래 변이를 **하나씩** `dashboard/lib/viz/points3d/gl-renderer.ts` 에 넣고 `cd dashboard && npx vitest run lib/viz/points3d/__tests__/gl-renderer.test.ts` 를 돌려 표의 테스트가 실패하는지 본 뒤, 곧바로 저장소 루트에서 `git restore dashboard/lib/viz/points3d/gl-renderer.ts` 로 되돌린다. 테스트 파일과 스텁은 건드리지 않는다(계획 작성 때 스크래치에서 아래 12개를 포함한 변이 71개가 전부 죽는 것을 확인했다).

| # | 변이 | 죽어야 하는 테스트 |
|---|---|---|
| 1 | `onLost` 의 `timer = setTimeout(() => { ... }, CONTEXT_RESTORE_TIMEOUT_MS);` 다섯 줄을 지운다(3초 미복구 타이머 제거) | `3,000ms 가 지나도 복구되지 않으면 on.unrecoverable 을 한 번 부른다` 외 2건 |
| 2 | `gl.uniform1i(u.uThresholdQ, frame.thresholdQ);` 의 `uniform1i` 를 `uniform1f` 로 | `uThresholdQ 는 정수 uniform(uniform1i)으로 프레임 값 그대로 넘어간다` |
| 3 | `gl.vertexAttribIPointer(gpu.aDev, 1, gl.SHORT, 0, 0);` 를 `gl.vertexAttribPointer(gpu.aDev, 1, gl.SHORT, false, 0, 0);` 로 | `aDev 는 dev 버퍼를 vertexAttribIPointer(SHORT 1개)로 읽는다` 외 4건 |
| 4 | `gl.vertexAttribPointer(gpu.aPos, 3, gl.UNSIGNED_SHORT, true, 0, 0);` 의 `true` 를 `false` 로 | `aPos 는 xyz 버퍼를 정규화 UNSIGNED_SHORT 3개로 읽는다` |
| 5 | `dispose` 의 `held = null;` 다음 줄에 `gl.getExtension('WEBGL_lose_context')?.loseContext();` 를 넣는다 | `dispose 는 버퍼 3·VAO 2·프로그램 2를 지우고 리스너를 떼며 loseContext 를 부르지 않는다` |
| 6 | `draw` 의 `Math.max(0, Math.min(n, Math.floor(frame.drawCount)))` 를 `n` 으로(drawCount 무시) | `점은 drawArrays(POINTS, 0, drawCount) 로 앞 drawCount 개만 그리고 n 을 넘지 않는다` 외 2건 |
| 7 | `onRestored` 의 `if (held) upload(gl, gpu, held.data, held.scaffold);` 줄을 지운다(재업로드 누락) | `3,000ms 안에 복구되면 프로그램을 다시 만들고 보관한 배열을 다시 올린 뒤 on.restored 를 부른다`, `손실 중에 받은 setData 는 복구 때 올린다` |
| 8 | `onLost` 의 `event.preventDefault();` 줄을 지운다 | `손실: 기본 동작을 막고 on.lost 를 한 번 부르며 손실 중 draw 는 아무것도 하지 않는다` 외 1건 |
| 9 | `onRestored` 의 `if (!lost \|\| unrecoverable) return;` 를 `if (!lost) return;` 로 | `복구 불가를 알린 뒤 늦게 온 복구 이벤트는 무시한다` |
| 10 | 점 정점 셰이더의 `in int aDev;` 를 `in float aDev;` 로 | `점 셰이더의 선언과 식이 스펙 §7.5 와 맞는다` |
| 11 | `draw` 의 점 단계에서 `gl.depthMask(true);` 줄을 지운다 | `그리기 순서와 상태: clear -> 선(블렌딩 켬, 깊이 쓰기 끔) -> 점(블렌딩 끔, 깊이 테스트 LESS, 깊이 쓰기 켬)` |
| 12 | `probeWebgl2` 의 `if (canCreateContext()) return 'software';` 를 `if (canCreateContext({ failIfMajorPerformanceCaveat: true })) return 'software';` 로 | `첫 시도가 실패하고 옵션 없는 둘째 시도가 되면 software 다(새 canvas, 반납)` |

죽지 않는 변이가 있으면 테스트 파일을 Step 2·7 의 코드와 대조해 빠진 줄을 찾는다(변이를 살려 둔 채 넘어가지 않는다).

마지막으로 되돌려졌는지 확인한다.

```bash
cd D:/Projects/Flatness
git diff --stat -- dashboard/lib/viz/points3d/gl-renderer.ts
cd dashboard && npx vitest run lib/viz/points3d/__tests__/gl-renderer.test.ts
```

Expected: `git diff --stat` 출력 없음(작업 트리가 스테이징한 내용과 같다). vitest 는 `Tests  48 passed (48)`.

- [ ] **Step 13: 대시보드 스위트 전체**

Run: `cd D:/Projects/Flatness/dashboard && npx vitest run && npx tsc --noEmit`

Expected: 실패 0. 통과 수는 이 태스크 직전보다 파일 1개, 테스트 48건이 늘어난다(2026-10-02 기준선은 84파일 769건이고, 앞 태스크가 더한 만큼 더 많다). `tsc` 는 출력 없이 끝난다. 실패가 있으면 실패한 그대로 기록하고 원인을 고친 뒤 다시 돌린다.

- [ ] **Step 14: 커밋**

```bash
cd D:/Projects/Flatness
git add dashboard/lib/viz/points3d/gl-renderer.ts dashboard/lib/viz/points3d/__tests__/gl-stub.ts dashboard/lib/viz/points3d/__tests__/gl-renderer.test.ts
git status --short
git commit -m "$(cat <<'EOF'
feat(dashboard): 3D 점군 뷰어 WebGL2 렌더러(gl-renderer)와 gl 호출 기록 스텁

lib/viz/points3d/gl-renderer.ts (스펙 2026-10-02 pointcloud-viewer §7.2, §7.4, §7.5). 저장소의 유일한 WebGL 접점이다.
- probeWebgl2: 떼어 낸 canvas 로 hardware / software / unsupported 를 가리고 탐지 컨텍스트를 반납한다.
- createRenderer: 좌표는 Uint16Array 를 사본 없이 정규화 속성으로, 편차는 Int16Array 를 정수 속성으로 올린다.
  분류는 정수 uniform(uThresholdQ) 비교, 편차만 과장, 깊이는 과장 전 기준면, 둥근 점. 색은 전부 테마 uniform 이다.
- 그리기 순서: clear -> 격자·축선(블렌딩, 깊이 쓰기 끔) -> 점(깊이 테스트 LESS).
- 컨텍스트 손실: 기본 동작을 막고 3,000ms 안에 복구되면 다시 만들어 다시 올리고, 아니면 복구 불가를 알린다.
  dispose 는 버퍼·VAO·프로그램을 지우고 loseContext 를 부르지 않는다(개발 모드의 effect 이중 실행이 같은 canvas 를 쓴다).
- 셰이더 컴파일·링크 실패는 예외 대신 null 로 돌려준다(화면이 WebGL2 불가 안내로 드러낸다).

lib/viz/points3d/__tests__/gl-stub.ts: gl 호출을 기록하는 테스트 헬퍼. 뒤 컴포넌트 테스트가 같이 쓴다.
테스트 48건. jsdom 에 WebGL 이 없어 호출 순서와 값만 검증한다(픽셀은 화면 캡처 대조가 맡는다).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
git log -1 --stat
```

Expected: `git status --short` 에 `A  dashboard/lib/viz/points3d/gl-renderer.ts`, `A  dashboard/lib/viz/points3d/__tests__/gl-stub.ts`, `A  dashboard/lib/viz/points3d/__tests__/gl-renderer.test.ts` 세 줄만 스테이징돼 있다(다른 파일이 섞여 있으면 커밋하지 말고 원인을 확인한다). 커밋 뒤 `git log -1 --stat` 에 그 세 파일만 나온다.

---

**초안 메모(계획을 합칠 때 읽고 지운다):**

- 실제로 돌린 것(스크래치 `.superpowers/plan-drafts/pointcloud-viewer/scratch-11/`, 저장소의 vitest·tsc·eslint 를 빌려 씀):
  - 이 문서의 코드 블록을 Step 순서대로 조립해 Step 3 의 실패(import 해석 실패), Step 6 의 13건 통과, Step 8 의 `35 failed | 13 passed (48)`, Step 10 의 48건 통과를 확인했다(`cd dashboard && npx vitest run --root <scratch-11>/cycle`, jsdom·globals). Step 7 의 (a)(b)대로 조립한 테스트 파일이 검증한 최종 파일과 바이트 단위로 같은 것도 확인했다.
  - `npx tsc --noEmit -p <scratch-11>/tsconfig.json`(strict, 대시보드와 같은 옵션) 종료 코드 0. 세 파일을 대시보드의 eslint 설정에 stdin 으로 넣어(`npx eslint --stdin --stdin-filename lib/viz/points3d/...`) 경고·오류 0.
  - 변이 71개(`scratch-11/mutate.mjs`, 결과 `mutate.out.txt`)를 하나씩 넣어 **전부 죽는 것**을 확인했다. Step 12 의 표와 "외 N건"은 그 실측이다. 태스크가 지정한 7개(3초 타이머 제거, uThresholdQ float, aDev float 포인터, aPos 정규화 false, dispose 의 loseContext, drawCount 무시, 재업로드 누락)가 표의 1~7 이다.
  - 대시보드의 실제 설정(`root = dashboard`, plugin-react, `vitest.setup.ts`)으로도 돌렸다: Task 12 초안의 스크래치(`scratch-12`)를 `scratch-11/integ12` 에 복사하고 대역이던 `gl-renderer.ts`·`gl-stub.ts` 를 이 문서의 것으로 바꿔 그 overlay 설정으로 실행 → 이 태스크 48건 + Task 12 초안의 컴포넌트 테스트 60건 = 108건 통과. Task 13 초안의 스크래치(`scratch-13` → `integ13`)도 같은 식으로 49건 통과. 두 초안은 작성 중인 사본이었으므로 최종본과의 대조는 아니다.
  - **2026-10-03 재검증(이어서 한 세션).** 이 문서의 코드 블록을 다시 조립해 돌린 `replay.py` 가 Step 3·6·8·10 의 결과를 그대로 재현했고(Step 8 의 실패 사유도 `createRenderer is not a function` 34건 + `expected undefined to be 3000` 1건으로 같다), 조립한 세 파일이 검증한 파일과 바이트 단위로 같았다. `tsc --noEmit` 종료 코드 0, eslint 경고·오류 0, `mutate.out.txt` 는 71/71 죽음. Task 12 초안의 **현재** 스크래치(`scratch-12/dashboard`, 10-02 18:36 판)에 이 문서의 `gl-renderer.ts`·`gl-stub.ts`·`gl-renderer.test.ts` 를 얹어 저장소 vitest 설정(overlay, `scratch-11/integ12b`)으로 돌리면 이 태스크 48건 + Task 12 컴포넌트 테스트 69건 = **117건 통과**다(Task 12·13 초안의 스크래치가 들고 있는 `gl-renderer.ts`·`gl-stub.ts` 는 이 문서의 것과 바이트 단위로 같다). Task 12 초안 메모가 확인을 요청한 "`aPos`·`aDev` 둘 다 `enableVertexAttribArray`" 단언은 `점 VAO 에서 aPos·aDev 를, 선 VAO 에서 aPos 를 켠다` 테스트에 있고 변이 R62·R63(각 enable 누락)이 그 테스트로 죽는다. 이 태스크가 기대는 상류 초안(Task 6 의 `hexToRgb01`·`DEV_NO_DEVIATION`·`Points3dTheme`·`Points3dData`, Task 7 의 `Webgl2Support`, Task 9 의 `buildScaffold` 반환 모양)은 10-03 재작성판에서도 이 문서의 Consumes 와 같다(`hexToRgb01` 은 `parseInt(hex.slice(1), 16)` 의 채널을 255 로 나눈 값이라 색 uniform 기대값 `76 / 255` 꼴이 그대로 성립한다).
  - **실제 브라우저(WebGL2) 확인.** `gl-renderer.ts` 를 TypeScript 로 JS 로만 바꿔(`make-browser-probe.mjs` → `browser-probe.html`) 브라우저 패널(Chromium 152, ANGLE Direct3D11, NVIDIA 외장 GPU)에서 돌렸다. 셰이더 4개가 컴파일·링크됐고(`createRenderer` 가 null 이 아니고 `console.error` 0, `gl.getError()` 0), `probeWebgl2()` 는 `'hardware'`, 64×64 버퍼에 그려 `readPixels` 로 읽은 값이 아래와 같았다.
    - 분류 색: dev 0 → (76, 201, 111), dev +71 → (240, 100, 100), dev −71 → (245, 195, 59), 센티널 → (74, 79, 87). 임계값을 75 로 올리면 ±71 이 둘 다 평탄 색(정수 uniform 이 실제로 먹는다).
    - 둥근 점: 12px 점의 중심에서 (5, 5) 떨어진 모서리 픽셀은 배경, (5, 0) 은 점 색.
    - 선 알파: 검정 배경에서 격자 (23, 23, 23) = 255 × 0.09, 축 (71, 71, 71) = 255 × 0.28. 밝은 배경(`#ffffff`, 선 `#000716`)에서 격자 (232, 233, 234), 축 (184, 186, 190).
    - LOD: `drawCount = 1` 이면 첫 점만 그려진다.
    - 편차만 과장: k = 11, dev +200(0.02m)인 점이 z 0.5 → 0.7 위치로 옮겨지고 센티널 점은 제자리.
    - 깊이: 같은 화면 위치의 융기 점(z 0.52, dev +200)과 침하 점(z 0.48, dev −200)을 어느 순서로 올려도 융기 색이 나온다(실제 깊이를 썼다면 z 가 작은 침하 점이 이긴다. 기준면 깊이는 0.499997 대 0.500003). z 0.3 의 센티널 점은 실제 깊이라 앞에 온다.
    - 컨텍스트: `WEBGL_lose_context.loseContext()` → `lost`, `restoreContext()` → `restored` 뒤 다시 그린 픽셀이 손실 전과 같다. 복구하지 않고 3.3초 기다리면 `unrecoverable`, 그 뒤의 `restoreContext()` 는 무시된다.
    - `createRenderer` → `dispose` → 같은 canvas 에 `createRenderer` 를 다시 불러도(React 개발 모드의 순서) 컨텍스트가 살아 있고 정상으로 그려진다.
    - 스텁의 상수 25개가 `WebGL2RenderingContext` 의 실제 값과 같다.
- 못 돌린 것: 저장소 안에 파일을 둔 상태의 `npx vitest run`(대시보드 전체 스위트), `palette-sweep.test.ts` 자체(같은 정규식을 스크래치 파일에 돌려 0건인 것만 확인), `next build`. 소프트웨어 렌더(`--disable-gpu`)에서의 `probeWebgl2() === 'software'` 는 실제 브라우저로 확인하지 못했다(스텁 테스트만 있다. Task 16 의 장면 9). 내장 GPU·모바일 GPU 에서의 셰이더 컴파일도 미확인이다.
- 뼈대에서 달라진 것(전부 덧붙임이고 시그니처는 그대로다):
  - Consumes 에 Task 6 의 `DEV_NO_DEVIATION` 을 더했다. 셰이더의 센티널 경계(`aDev > -32767`)를 리터럴로 적지 않고 이 상수에서 만든다.
  - 스텁의 `getUniformLocation` 반환값에 `program` 필드를 더했다(`{ uniformName, program }`). `uViewProj` 처럼 두 프로그램에 다 있는 이름을 테스트가 가릴 수 있다. `uniformCalls(name)` 의 뜻은 뼈대 그대로다. 뒤 태스크의 테스트가 위치 객체를 `toEqual({ uniformName: ... })` 로 통째 비교하면 깨진다(그런 단언을 쓰지 말 것).
  - 스텁은 Proxy 가 아니라 메서드 목록이 정해진 보통 객체다("모든 gl 메서드"가 아니라 목록의 메서드를 기록한다). 목록에 없는 메서드를 부르면 `is not a function` 으로 실패한다. 렌더러가 쓰는 메서드와 흔히 쓰는 변형(`uniform3fv`, `blendFuncSeparate` 등)은 넣어 두었다. `vi.spyOn(rec.gl, ...)` 이 그대로 먹는다는 것이 이렇게 둔 이유다.
- 스펙에 없어 여기서 정한 것: 규칙 절의 4가지(컴파일·링크 실패 → null + `console.error`, 복구 때 재생성 실패 → `on.unrecoverable()`, `drawCount` 를 `[0, n]` 으로 막음, `pointSizeLimit()` 을 생성 때 읽어 둠)와, 복구 때 `viewport(0, 0, canvas.width, canvas.height)` 를 다시 맞추는 것, 겹쳐 온 `webglcontextlost` 를 한 번으로 세는 것, `setData` 전의 `draw` 는 `clear` 도 하지 않는 것. 첫째 것 때문에 셰이더 버그가 화면에서는 M7("WebGL2를 사용할 수 없어")로 보인다. 원인은 콘솔의 `[points3d] shader compile failed: ...` 로 남는다.
- Task 12 가 알아야 할 것: 컨텍스트가 끊긴 동안 `pointSizeLimit()` 은 생성 때의 값을 그대로 준다. `resize` 는 값이 같으면 `canvas.width`·`height` 를 다시 대입하지 않는다(대입하면 드로잉 버퍼가 지워진다). `draw` 는 손실 중·`setData` 전·`dispose` 뒤에 아무것도 하지 않으므로 호출 쪽에서 가드할 필요가 없다. `on.unrecoverable()` 은 3초 타이머와 "복구 때 재생성 실패" 두 경로에서 오며 어느 쪽이든 한 번만 온다.
- 테스트의 한계: 셰이더는 jsdom 에서 실행되지 않으므로 `점 셰이더의 선언과 식이 스펙 §7.5 와 맞는다` 는 소스 문자열을 정규식으로 본다(공백은 허용). 셰이더를 같은 뜻의 다른 식으로 고쳐 쓰면 이 테스트를 함께 고쳐야 한다. 실제 그림은 Task 16 의 화면 캡처 대조가 맡는다(스펙 §14 의 10).

---
### Task 12: `Points3dView`: 캔버스·오버레이·컨트롤·LOD·읽기 창·컨텍스트 처리

**목표:** 점 데이터와 기본 임계값을 받아 뷰어 영역(캔버스 + 범례·HUD·조작 안내·축 라벨·읽기 창 오버레이), 컨트롤 줄, 고지 문구를 그리고 조작·LOD·컨텍스트 손실을 처리하는 컴포넌트 `Points3dView` 와 로딩 틀 `Points3dLoadingFrame` 이 gl 호출 기록 스텁으로 단독 테스트된다.

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.1 D3~D7·D10·D14, §2.2 V1·V7, §2.4(드로잉 버퍼 배율, 뷰어 영역 비율, 조작 종료 판정), §7.2(`points3d-view.tsx`), §7.4(LOD, `frameMs` 정의, 그리기 시점), §7.7(휠 네이티브 리스너, JSX 핸들러, 키 수식키 제외, 캔버스 속성, `setPointerCapture`, 드로잉 버퍼 크기·`ResizeObserver`), §7.8(표시 방식), §7.9, §7.10, §7.11(로딩 틀, 컨텍스트 손실 직후 3초), §7.12, §7.13, §8(3·5), §10.4(`points3d-view.test.tsx` 행), §10.5(대시보드 변이 7건).

**Files:**
- Create: `dashboard/components/analysis/points3d-view.tsx` (최종 426줄)
- Modify: 없음. 공용 `Button`·`Spinner`, `app/globals.css`, `lib/` 의 모듈을 한 줄도 고치지 않는다
- Test: `dashboard/components/analysis/__tests__/points3d-view.test.tsx` (신설, 69건)
- 읽기만(고치지 않는다):
  - `dashboard/components/ui/button.tsx:9-25` `Button`. `variant` 기본값 `'normal'`. normal 은 `border-cs-link bg-transparent text-cs-link hover:bg-cs-info-bg`(`:11`), `className` 은 뒤에 덧붙고 나머지 props 는 `<button>` 에 그대로 넘어간다(`aria-pressed` 포함). `type` 기본값 `'button'`
  - `dashboard/components/ui/spinner.tsx:11-20` `Spinner`. `role="status"`, 회전 호가 `cs-text`(`#000716`)라 검정 위에서 보이지 않는다
  - `dashboard/components/analysis/heatmap-view.tsx:21,33-41,71-72` `canvasRef` + effect 관례(캔버스는 JSX `<canvas ref>`, 컨텍스트는 effect 안에서 얻는다)
  - `dashboard/components/registration/__tests__/overlay-view.test.tsx:47-63` `vi.spyOn(HTMLCanvasElement.prototype, 'getContext')` 로 스텁을 끼우는 선례
  - `dashboard/__tests__/palette-sweep.test.ts:14` 옛 팔레트 정규식(새 파일 두 개도 검사 대상이다)
  - `dashboard/node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` (`dashboard/AGENTS.md` 의 지시: 대시보드 코드 전에 이 저장소의 Next.js 문서를 확인한다)

**Interfaces:**
- Consumes (앞 태스크가 만든 것. 이름과 시그니처를 그대로 쓴다. 이 태스크는 고치지 않는다):
  - T6 `@/lib/domain/points3d`: `Points3dData { meta: Points3dMeta; xyz: Uint16Array; dev: Int16Array }`(이 태스크가 메타에서 읽는 것: `n_points`, `extent_m`, `fit_bounds`, `sample_cell_m`), `PointClass = 'flat' | 'depression' | 'protrusion' | 'none'`, `ThemeName = 'dark' | 'light'`, `EXAGGERATIONS = [1, 10, 50, 100] as const`, `THRESHOLD_Q_MIN = 10`, `THRESHOLD_Q_MAX = 300`, `THRESHOLD_Q_STEP = 5`, `POINT_CLASS_LABEL: Record<PointClass, string>`, `POINTS3D_THEME: Record<ThemeName, Points3dTheme>`(`Points3dTheme` 의 키: `background`, `flat`, `depression`, `protrusion`, `none`, `line`, `gridAlpha`, `axisAlpha`, `text`, `textSecondary`, `readoutBackground`, `readoutAlpha`), `fmtThresholdMm(q: number): string`(70 → `7`, 63 → `6.3`), `readoutLines(data: Points3dData, i: number, thresholdQ: number): string[]`, `hexToRgb01(hex: string): [number, number, number]`
  - T8 `@/lib/viz/points3d/orbit`: `FOVY`(40° 라디안), `Bounds`, `OrbitState { target; distance; azimuth; elevation; fovy; radius }`, `ViewPreset = 'iso' | 'top' | 'front'`, `fitToBounds(fit: Bounds, preset: ViewPreset): OrbitState`, `viewProj(s: OrbitState, aspect: number, full: Bounds): Float32Array`. 테스트에서만: `rotate(s, dxPx, dyPx)`, `pan(s, dxPx, dyPx, cssHPx)`, `@/lib/viz/points3d/mat4` 의 `project(m, p, cssW, cssH): { x; y; w } | null`
  - T9 `@/lib/viz/points3d/scaffold`: `buildScaffold(fit: Bounds): { verts: Float32Array; gridVertCount: number; axisVertCount: number; ticks: AxisTick[]; step: number }`, `layoutLabels(ticks: AxisTick[], viewProj: Float32Array, cssW: number, cssH: number): PlacedLabel[]`, `PlacedLabel { axis: 'x' | 'y'; kind: 'tick' | 'name'; text: string; x: number; y: number }`
  - T9 `@/lib/viz/points3d/budget`: `pointWorldSizeM(sampleCellM: number): number`, `pxPerUnit(bufferHPx: number, fovy: number): number`, `pointSizeRange(aliasedRange: [number, number], bufferScale: number): [number, number]`, `initialDragCount(n: number): number`, `nextDragCount(prev: number, n: number, frameMs: number): number`
  - T10 `@/lib/viz/points3d/pick`: `pickNearest(data: Points3dData, viewProj: Float32Array, exaggeration: number, cssW: number, cssH: number, cursorX: number, cursorY: number, radiusPx?: number): number | null`
  - T10 `@/lib/viz/points3d/controls`: `ControlEvent`, `reduceControl(s: ControlState, e: ControlEvent, cssHPx: number): { state: ControlState; handled: boolean }`, `initialControlState(camera: OrbitState): ControlState`, `isGesturing(s: ControlState): boolean`
  - T11 `@/lib/viz/points3d/gl-renderer`: `createRenderer(canvas: HTMLCanvasElement, on: { lost(): void; restored(): void; unrecoverable(): void }): Renderer | null`, `Renderer { setData(data, scaffold); resize(bufferW, bufferH); draw(frame: FrameParams); pointSizeLimit(): [number, number]; dispose() }`. 이 태스크가 기대는 동작: `resize(w, h)` 가 `canvas.width`·`canvas.height` 를 맞추고 `viewport(0, 0, w, h)` 를 부른다. 손실 중의 `draw` 는 아무것도 그리지 않는다. `webglcontextlost` → `on.lost()`, 3,000ms 안에 `webglcontextrestored` → `on.restored()`, 안 오면 `on.unrecoverable()` 1회. `dispose` 는 리스너와 타이머를 지우고 `loseContext` 를 부르지 않는다
  - T11 테스트 헬퍼 `@/lib/viz/points3d/__tests__/gl-stub`: `recordingGl(): RecordingGl`. 이 태스크의 테스트가 쓰는 것은 `.gl`, `.callsOf(name)`, `.uniformCalls(uniformName)`(args[0] 이 위치, 그 뒤가 값), `.pointDraws()`, `.loseContextCalls()` 다
  - 기존: `Button`(`@/components/ui/button`), `Spinner`(`@/components/ui/spinner`)
- Produces (T13·T14 가 이 이름과 DOM 계약을 그대로 쓴다):
  - `export function Points3dView(props: { data: Points3dData; defaultThresholdQ: number; isRegistered: boolean; onError(kind: 'webgl' | 'context'): void; })` (반환 타입 표기 없음)
  - `export function Points3dLoadingFrame(props: { theme: ThemeName })` - 폭 100%·`aspect-[4/3]`·`rounded-lg border border-cs-divider`, 배경과 글자색은 인라인 style 의 테마 hex, 가운데 흰 칩(`inline-flex rounded-full bg-white p-2`) 안 `Spinner`, 그 아래 `3D 점군 데이터를 불러오는 중입니다.`. 루트에 `data-testid="points3d-loading"`
  - DOM 계약: 캔버스 `role="img"` `aria-label="3D 점군 뷰어"` `tabIndex={0}`. 뷰어 영역 `data-testid="points3d-viewport"`(인라인 `background-color` = 테마 배경). 범례 `data-testid="points3d-legend"`(`<ul>`, 항목 `<li>` 4개, 표식에 `data-class="flat|depression|protrusion|none"`), HUD `data-testid="points3d-hud"`, 조작 안내 `data-testid="points3d-hint"`, 축 라벨 층 `data-testid="points3d-labels"`, 읽기 창 `data-testid="points3d-readout"`(점을 찾았을 때만, 줄마다 `<div>`), 고지 문구 `data-testid="points3d-notice"`, 병합 안내 `data-testid="points3d-merged-note"`(`isRegistered` 일 때만). 슬라이더 `<input type="range" min={10} max={300} step={5} aria-label="표시 임계값(mm)">`(초기값 = `defaultThresholdQ`). 버튼 이름 `등각`·`평면`·`정면`·`×1`·`×10`·`×50`·`×100`·`밝은 배경`
  - 동작 계약: `createRenderer` 가 null 이면 effect 에서 `onError('webgl')` 1회(그 뒤 그리기를 예약하지 않는다). 컨텍스트 손실 후 3,000ms 미복구면 `onError('context')` 1회. `onError` 는 마운트 수명에 한 번만 불린다. 마운트마다 `canvas.getContext('webgl2', ...)` 를 한 번 부른다(React `StrictMode` 의 effect 이중 실행에서는 두 번이다. T13·T14 의 테스트는 `StrictMode` 없이 마운트 수를 센다). 시점·과장 배율·임계값·배경은 로컬 state 이고 마운트 때 기본값(등각, ×1, `defaultThresholdQ`, dark)이다. 상위가 `onError` 를 새 함수로 바꿔 다시 그려도 렌더러를 다시 만들지 않는다
  - 뒤 태스크의 테스트가 알아야 할 것: 이 컴포넌트는 마운트 때 `requestAnimationFrame` 을 한 번 예약하고 그 콜백에서 state 를 갱신한다(축 라벨, `flushSync`). 뷰어를 마운트한 채 실제 시간을 16ms 이상 기다리는 테스트(`waitFor`·`findBy*`·`setTimeout` 대기)는 jsdom 의 실제 rAF 콜백이 `act` 밖에서 돌아 `An update to Points3dView inside a test was not wrapped in act(...)` 경고 1회가 찍힌다(테스트는 실패하지 않는다). 그런 테스트는 `requestAnimationFrame` 을 스텁하거나(이 태스크의 수동 큐) `vi.useFakeTimers()` 로 묶는다. 마운트 뒤 동기 단언만 하고 끝나는 테스트는 cleanup 의 `cancelAnimationFrame` 이 먼저 돌아 경고가 없다(T14 초안의 테스트 24건을 이 컴포넌트로 돌려 경고 0 확인). jsdom 의 `clientWidth`·`clientHeight` 는 0 이지만 이 뷰는 1 이상으로 묶어 계산하므로 크기를 스텁하지 않아도 던지지 않는다

**이 태스크가 지켜야 할 규칙(스펙 발췌)**

- **파일은 하나다.** 스펙 §7.2 가 뷰 컴포넌트를 `points3d-view.tsx` 한 파일로 정했다. 보조 파일을 만들지 않는다. 이 파일은 `'use client'` 로 시작한다. `next/dynamic`·`ssr: false` 를 쓰지 않는다. 컴포넌트 반환 타입을 적지 않는다(`: JSX.Element` 는 이 저장소의 `tsc --noEmit` 에서 TS2503 으로 실패한다).
- **WebGL 은 `gl-renderer.ts` 만 만진다.** 이 파일은 `createRenderer` 를 effect 안에서 부르고 cleanup 에서 `renderer.dispose()` 를 부른다. 캔버스는 JSX `<canvas ref>` 다. effect 안에서 canvas 를 만들어 붙이지 않는다. `getContext` 를 이 파일에서 직접 부르지 않는다.
- **휠은 네이티브 리스너다.** effect 안에서 `canvas.addEventListener('wheel', handler, { passive: false })`, cleanup 에서 `removeEventListener`. JSX `onWheel` 을 쓰지 않는다(React 19 가 `wheel` 을 루트에 passive 로 등록해 JSX 핸들러의 `preventDefault` 가 무시된다. Ctrl+휠에서 뷰어 줌과 브라우저 페이지 확대가 함께 일어난다). handler 는 `reduceControl` 이 `handled === true` 를 돌려준 경우에만 `preventDefault` 를 부른다. 일반 휠은 가로채지 않는다.
- **나머지 입력은 JSX 핸들러다:** `onPointerDown`·`onPointerMove`·`onPointerUp`·`onPointerCancel`·`onPointerLeave`, `onKeyDown`, `onContextMenu`(항상 막는다). Ctrl·Cmd·Alt 가 눌린 키 입력은 reducer 에 넘기지 않는다. `setPointerCapture` 는 `?.` 로 방어한다(jsdom 에 없다).
- **픽셀 단위.** 드로잉 버퍼 배율 = `min(devicePixelRatio, 2)`. 버퍼 크기 = `round(clientWidth × 배율)`, `round(clientHeight × 배율)`. `clientWidth`·`clientHeight` 는 1 이상으로 묶는다. `pxPerUnit` 에는 **버퍼 높이**를 넘긴다(CSS 높이를 넘기면 배율 2 화면에서 점 지름이 절반이 된다). 종횡비와 `reduceControl` 의 `cssHPx`, `layoutLabels`·`pickNearest` 의 크기는 **CSS px** 이다. 그 뒤의 크기 변화는 `ResizeObserver` 로 따르고, `typeof ResizeObserver === 'undefined'` 이면 관찰만 건너뛴다.
- **그리기 시점.** 연속 루프를 돌리지 않는다. 카메라·uniform·크기가 바뀌었을 때만 `requestAnimationFrame` 으로 한 번 그린다.
- **LOD.** 조작 중(포인터가 눌려 있거나, 휠·키의 마지막 입력 뒤 200ms 이내)에는 앞 `drawCount` 개만 그린다. `drawCount` 는 ref 로 들고 초기값은 `initialDragCount(n)` 이며 조작이 새로 시작돼도 되돌리지 않는다. **`frameMs` 는 조작 중에 그린 rAF 콜백의 타임스탬프와 바로 다음 rAF 콜백의 타임스탬프의 차다.** 이를 재려고 조작 중에 그린 콜백은 rAF 를 하나 더 예약한다(측정용 콜백). 측정용 콜백은 `nextDragCount` 를 적용한 뒤, 그 사이 그리기 요청이 있었으면 그리고(그러면 다시 측정용 콜백을 예약한다) 없었으면 그리지 않고 끝난다. 입력 이벤트 사이의 간격은 재지 않는다. 조작이 끝나면(pointerup·pointercancel 즉시, 휠·키는 200ms 뒤) `n` 개 전부를 한 번 그리고 측정용 콜백을 예약하지 않는다. HUD 의 점 수는 항상 `n` 이다.
- **읽기 창.** 마우스·펜만(`pointerType !== 'touch'`). 조작 중(드래그·핀치)에는 찾지 않는다. 한 animation frame 에 한 번만 찾는다. 커서가 영역을 벗어나면 숨긴다. 커서 오른쪽 아래 12px 에 띄우고 영역을 넘으면 그 축만 반대쪽으로 뒤집는다. 줄은 `readoutLines` 가 준 문자열을 그대로 그린다. 숫자는 `font-mono tabular-nums`. 커서 좌표는 `clientX − getBoundingClientRect().left`(캔버스 왼쪽 위 기준 CSS px).
- **컨텍스트 손실.** 복구를 기다리는 동안 현재 테마의 `Points3dLoadingFrame` 을 뷰어 영역 위에 절대 배치로 겹친다. 캔버스는 마운트된 채로 둔다(복구 이벤트를 받아야 한다). 복구되면 걷고 다시 그린다. 3,000ms 미복구는 `onError('context')`.
- **색(§7.13).** 뷰어 색은 전부 `POINTS3D_THEME` 의 hex 를 인라인 `style` 로 쓴다. 뷰어 색을 위한 Tailwind 색 유틸리티(`bg-black`, `text-white`, 임의 값 클래스 포함)를 쓰지 않는다. 바깥 크롬(컨트롤 줄, 고지 문구)은 `cs-` 토큰 클래스만 쓴다. 로딩 틀의 Spinner 칩만 기존 `bg-white` 다. 선택 배경은 `className="aria-pressed:bg-cs-info-bg"`(그냥 `bg-cs-info-bg` 를 덧붙이면 normal 의 `bg-transparent` 에 가려진다). 시점 버튼에는 선택 상태를 두지 않는다. 주석·문자열·식별자에 `색이름-숫자` 꼴 표기를 쓰지 않고, DOM 에 `red-`·`green-` 부분 문자열이 드는 이름을 쓰지 않는다.
- **문구(§7.12)는 글자 그대로.** 고지 문구는 `{T}` = `fmtThresholdMm(현재 임계값)` 하나만 동적이다. 음수 부호는 U+2212(`−`). U+2014 를 쓰지 않는다. 직선자 스팬 숫자·분류 비율·등급을 점에 붙이는 문구를 만들지 않는다. 슬라이더 초기값은 `defaultThresholdQ` 그대로다(63 이면 HUD·고지·`aria-valuetext` 가 `6.3`).
- **판정 이중화 금지(§8).** 이 파일과 테스트에 판정 기준 필드 이름(T14 의 소스 검사 테스트가 금지어로 잡는 네 문자열)을 주석으로도 적지 않는다. 뷰어가 보일 때 `preview3d.png` 를 함께 그리지 않는다.
- 버튼은 전부 `Button` 의 `normal`(뷰당 primary 1개 규칙). 코드 주석은 한국어.

**이 태스크에서 스펙이 값을 정하지 않아 여기서 정한 것**(T16 의 화면 캡처 대조에서 어색하면 이 상수만 조정한다. 스펙의 동작은 바뀌지 않는다):

| 항목 | 값 | 이유 |
|---|---|---|
| 읽기 창 뒤집기 판정용 어림 크기 `READOUT_BOX_W_PX`·`READOUT_BOX_H_PX` | 160 × 100 CSS px | 스펙은 "영역을 넘으면 반대쪽으로 뒤집는다"만 정했다. 실제 크기를 재면 jsdom 에서 0 이라 테스트할 수 없어, 5줄 × 16px + 여백과 가장 긴 줄(`Y 4180047.912 m`) 기준의 어림 크기로 판정한다. 뒤집을 때는 `right`·`bottom` 으로 붙이므로 실제 크기와 무관하게 커서에서 12px 떨어진다 |
| 축 라벨을 띄우는 방향 `LABEL_TRANSFORM` | x 눈금은 아래로 4px, y 눈금은 왼쪽으로 6px, 축 이름은 한 줄 더 바깥 | T9 의 `buildScaffold` 는 두 축 모두 0 눈금을 같은 모서리에 낸다. 축마다 방향을 달리해야 겹치지 않는다 |
| HUD 와 조작 안내의 배치 | 뷰어 아래쪽 한 줄(`flex flex-wrap justify-between`) | 375px 폭에서 두 문구의 합이 폭을 넘는다. 좁으면 두 줄로 접힌다 |
| 크기가 바뀌었을 때의 다시 그리기 | `ResizeObserver` 콜백 안에서 곧바로 | 버퍼 크기를 바꾸면 캔버스가 지워진다. 다음 프레임까지 미루면 밝은 배경에서 검정이 한 프레임 번쩍인다. 크기가 그대로면 아무것도 하지 않는다 |
| 축 라벨 state 반영 | `flushSync` | 라벨은 DOM 이다. rAF 콜백 안의 일반 `setState` 는 페인트 뒤에 반영돼 회전 중에 라벨이 격자보다 한 프레임 늦는다 |
| 휠·키 줌 때의 읽기 창 | 카메라가 바뀌면 숨기고, 조작이 끝난 뒤의 그리기에서 같은 커서로 다시 찾는다 | 커서는 그대로인데 그 아래의 점이 바뀐다. 옛 점의 값을 남기지 않는다 |

**구조 한눈에.** 컴포넌트는 React state(임계값, 과장 배율, 배경, 축 라벨, 읽기 창, 복구 대기)와, effect 하나가 만드는 "조작·그리기 루프"로 나뉜다. 루프의 변수(카메라·크기·예약 상태)는 effect 의 지역 변수이고, JSX 핸들러는 `engineRef` 에 담긴 네 함수(`input`, `hover`, `setPreset`, `requestDraw`)로만 루프에 닿는다. 임계값·과장·배경은 `viewRef` 로 루프에 전해진다(렌더 중에 ref 를 읽고 쓰지 않는다. 동기화는 effect 에서 한다).

```
JSX 핸들러 / 네이티브 wheel ──> input(ev) ──> reduceControl ──> 카메라가 변했으면 requestDraw()
                                                             └─> 휠·키면 200ms 타이머(조작 종료 판정)
pointermove(마우스·펜) ──> hover(cursor) ──> pickWanted, ensureFrame()
state(임계값·과장·배경) ──> viewRef 동기화 effect ──> requestDraw()

frame(ts):  [직전 콜백이 조작 중에 그렸으면] drawCount = nextDragCount(drawCount, n, ts − 그때의 ts)
            [그리기 요청이 있으면] draw(조작 중 ? drawCount : n), 조작 중이면 측정용 콜백 예약
            [조작 중이 아니고 커서가 있으면] pick()
```

**테스트 방법(이 파일의 테스트가 쓰는 장치).**

- `vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(rec.gl)` 로 T11 의 기록 스텁을 끼운다. 실제 `createRenderer` 가 그 위에서 돈다(렌더러를 mock 하지 않는다).
- `requestAnimationFrame`·`cancelAnimationFrame` 은 `vi.stubGlobal` 로 **수동 큐**로 바꾼다. 테스트의 `frame(ts)` 가 "지금 예약된 콜백만" 타임스탬프 `ts` 로 실행한다. LOD 의 40ms·500ms 사례가 결정적이 된다.
- `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`. rAF 는 가짜 타이머에 맡기지 않는다(수동 큐를 덮어쓴다). 200ms(조작 종료)와 3,000ms(컨텍스트 복구 대기)를 `vi.advanceTimersByTime` 으로 넘긴다.
- 크기는 `vi.spyOn(Element.prototype, 'clientWidth', 'get')`·`clientHeight` 와 `vi.stubGlobal('devicePixelRatio', …)` 로 준다. 스텁하지 않은 테스트에서는 0 이다.
- 카메라 배선은 uniform `uViewProj` 의 마지막 값을 T8 의 순수 함수(`fitToBounds`, `rotate`, `pan`, `viewProj`)로 만든 행렬과 비교한다. 행렬 수학 자체는 T8 의 테스트가 고정했고, 여기서는 "어느 입력이 어느 함수로 이어지는가"만 본다.
- 읽기 창의 화면 위치는 `project(viewProj(fitToBounds(...)), 점, 640, 480)` 로 구해 그 좌표에 `pointermove` 를 보낸다. 읽기 창의 **문자열**은 손으로 계산한 값이다.

**기대값의 근거(손 계산)**

- `uPxPerUnit`: `bufferH / (2 × tan(FOVY / 2))`. `tan(20°) = 0.3639702343`. 버퍼 높이 960 → `960 / 0.7279404685 = 1318.789`, 480 → `659.394`.
- `uMinPx`: `1.5 × 배율`. 배율 2 → 3, 배율 1 → 1.5, 배율 3 은 2 로 묶여 3.
- `uPointWorldM`: `0.55 × sample_cell_m = 0.55 × 0.0125 = 0.006875`.
- 색: `#4cc96f` = (76, 201, 111) / 255, `#1e9e50` = (30, 158, 80) / 255. 배경 `#000000` → `clearColor(0, 0, 0, 1)`, `#ffffff` → `clearColor(1, 1, 1, 1)`.
- LOD: `n = 200,000` 이면 시작 `min(n, 150,000) = 150,000`. 40ms(> 33) → `150,000 × 0.7 = 105,000`, 다시 40ms → `73,500`. 10ms(< 20) → `150,000 × 1.25 = 187,500`. 25ms 는 그대로.
- HUD 점 수: `(1234).toLocaleString('ko-KR') = "1,234"`, `(200000) → "200,000"`.
- 읽기 창(픽스처 `READOUT_DATA`, `origin_m = [254012.5, 4180045.25, 31.5]`, `extent_m = [4, 3, 0.5]`, `local = q × extent / 65535`):
  - P0 `q = (13107, 21845, 0)` → local `(0.8, 1.0, 0)` → 절대 `(254013.300, 4180046.250, 31.500)`. `dev = 32` → `+3.2` mm. 임계값 70 에서 FLAT, 30 에서 PROTRUSION(32 > 30).
  - P1 `q = (52428, 43690, 0)` → local `(3.2, 2.0, 0)` → 절대 `(254015.700, 4180047.250, 31.500)`. `dev = -32768`(센티널) → 4줄, 마지막 줄 `편차 없음`.
  - P2 `q = (32768, 13107, 0)` → local `(2.00003, 0.6, 0)`. `dev = -105` → `−10.5` mm(U+2212).
- 읽기 창 뒤집기(평면 시점, 640 × 480, fit `[1, 1, 0]`~`[3, 2, 0.25]`): fit 반경 `hypot(2, 1, 0.25) / 2 = 1.125`, 거리 `1.125 / sin(20°) × 1.05 = 3.454`, 화면 배율 `240 / (3.454 × tan(20°)) = 190.9 px/m`(카메라가 0.125m 더 먼 z = 0 평면에서는 약 184 px/m). 화면 중앙 (320, 240) 이 fit 중심 (2, 1.5) 다. P1 은 `x ≈ 320 + 1.2 × 184 = 541 > 468`(= 640 − 12 − 160), `y ≈ 240 − 0.5 × 184 = 148 < 368` → 가로만 뒤집는다. P2 는 `x ≈ 320 < 468`, `y ≈ 240 + 0.9 × 184 = 406 > 368`(= 480 − 12 − 100) → 세로만 뒤집는다. 테스트는 이 전제(`p1.x > 468` 등)를 먼저 단언한 뒤 style 을 본다.

---

- [ ] **Step 1: 선행 조건 확인(앞 태스크 산출물과 Next.js 문서)**

Run:

```bash
cd D:/Projects/Flatness/dashboard && ls lib/viz/points3d lib/viz/points3d/__tests__ && grep -nE "export (function (readoutLines|fmtThresholdMm|hexToRgb01)|const (POINTS3D_THEME|POINT_CLASS_LABEL|EXAGGERATIONS))" lib/domain/points3d.ts && grep -nE "export function (createRenderer|pickNearest|reduceControl|initialControlState|isGesturing|buildScaffold|layoutLabels|nextDragCount|initialDragCount|pxPerUnit|pointSizeRange|pointWorldSizeM|fitToBounds|viewProj|recordingGl)" lib/viz/points3d/*.ts lib/viz/points3d/__tests__/gl-stub.ts
```

Expected: `lib/viz/points3d` 에 `mat4.ts`, `orbit.ts`, `scaffold.ts`, `budget.ts`, `pick.ts`, `controls.ts`, `gl-renderer.ts`, `__tests__` 가 있고 `__tests__` 에 `gl-stub.ts` 가 있다. 첫 grep 이 6줄(`readoutLines`, `fmtThresholdMm`, `hexToRgb01`, `POINTS3D_THEME`, `POINT_CLASS_LABEL`, `EXAGGERATIONS`), 둘째 grep 이 15줄을 낸다. 하나라도 없으면 Task 6·8·9·10·11 이 끝나지 않은 것이므로 멈추고 보고한다.

그다음 `dashboard/node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` 를 읽는다. 확인할 것: `'use client'` 는 파일 맨 위, import 보다 앞에 둔다(문서 `:14`. 주석은 문장이 아니라 그 앞에 있어도 된다. 저장소 선례 `heatmap-view.tsx:1-3`). 이 파일은 이미 클라이언트 컴포넌트인 `analysis-result.tsx` 아래에서만 import 되지만(Task 13·14), 훅과 이벤트 핸들러를 쓰는 파일이므로 지시어를 직접 붙인다. 문서가 이와 다르게 말하면 문서를 따르고 커밋 메시지에 적는다.

- [ ] **Step 2: (a) 로딩 틀 - 테스트 파일의 머리와 첫 테스트 작성**

`dashboard/components/analysis/__tests__/points3d-view.test.tsx` 를 아래 내용으로 만든다. 머리(데이터, 수동 rAF 큐, 헬퍼)는 뒤 단계의 테스트가 전부 함께 쓴다. 지금은 쓰이지 않는 import 와 헬퍼가 있어도 그대로 둔다.

```tsx
// Points3dView 컴포넌트 테스트(스펙 2026-10-02-pointcloud-viewer-design §10.4).
//
// jsdom 에는 WebGL 이 없다. HTMLCanvasElement.prototype.getContext 에 gl 호출 기록 스텁을 끼워
// "어떤 uniform 을 · 몇 개의 점으로 · 어떤 크기의 버퍼에" 그리는지를 실제 렌더 경로에서 관찰한다.
// requestAnimationFrame 은 수동 큐로 바꿔 테스트가 타임스탬프를 준다(LOD 의 frameMs 를 결정적으로 만든다).
// setTimeout 만 가짜 타이머다(휠·키의 조작 종료 200ms, 컨텍스트 복구 대기 3,000ms).
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Points3dLoadingFrame, Points3dView } from '../points3d-view';
import type { Points3dData } from '@/lib/domain/points3d';
import { fitToBounds, pan, rotate, viewProj } from '@/lib/viz/points3d/orbit';
import type { Bounds } from '@/lib/viz/points3d/orbit';
import { project } from '@/lib/viz/points3d/mat4';
import { recordingGl } from '@/lib/viz/points3d/__tests__/gl-stub';
import type { RecordingGl } from '@/lib/viz/points3d/__tests__/gl-stub';

// ---- 데이터 ----
const ORIGIN: [number, number, number] = [254012.5, 4180045.25, 31.5];
const EXTENT: [number, number, number] = [4, 3, 0.5];
const FIT: Bounds = { min: [0, 0, 0], max: [4, 3, 0.25] };
const FULL: Bounds = { min: [0, 0, 0], max: EXTENT };

type Row = [qx: number, qy: number, qz: number, dev: number];

function dataOf(rows: Row[], fit: Bounds = FIT): Points3dData {
  const n = rows.length;
  const xyz = new Uint16Array(3 * n);
  const dev = new Int16Array(n);
  rows.forEach(([qx, qy, qz, d], i) => { xyz.set([qx, qy, qz], 3 * i); dev[i] = d; });
  return {
    meta: {
      schema_version: 1, n_points: n, units: 'm', origin_m: ORIGIN, extent_m: EXTENT,
      deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
      sample_cell_m: 0.0125, fit_bounds: fit,
      sampling: { method: 'cell-minhash-stratified', source_points: n, cap: 500000 }, order: 'hash',
    },
    xyz, dev,
  };
}

// 난수 없이 고르게 흩은 n 점(화면 테스트와 LOD 테스트용). 내용은 단언하지 않는다
function scatter(n: number): Points3dData {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) rows.push([(i * 7919) % 65536, (i * 104729) % 65536, 0, (i % 201) - 100]);
  return dataOf(rows);
}
const SMALL = scatter(1234);

// 읽기 창용 3점. local = q * extent / 65535
//   P0 q(13107, 21845, 0) -> local (0.8, 1.0, 0), dev 32 (+3.2mm)
//   P1 q(52428, 43690, 0) -> local (3.2, 2.0, 0), dev -32768 (바닥이 아닌 점)
//   P2 q(32768, 13107, 0) -> local (2.0, 0.6, 0), dev -105 (-10.5mm)
// fit 을 가운데 2m x 1m 로 좁혀 카메라가 다가가게 한다. 그러면 P1·P2 가 화면 가장자리 쪽에 놓인다(뒤집기 테스트)
const READOUT_FIT: Bounds = { min: [1, 1, 0], max: [3, 2, 0.25] };
const READOUT_DATA = dataOf([[13107, 21845, 0, 32], [52428, 43690, 0, -32768], [32768, 13107, 0, -105]], READOUT_FIT);
const P0: [number, number, number] = [0.8, 1.0, 0];
const P1: [number, number, number] = [3.2, 2.0, 0];
const P2: [number, number, number] = [(32768 * 4) / 65535, 0.6, 0];

// ---- 수동 rAF 큐 ----
let rafQueue: { id: number; cb: FrameRequestCallback }[] = [];
let rafSeq = 0;

/** 지금 예약된 rAF 콜백만 타임스탬프 ts 로 실행한다. 실행 중에 새로 예약된 콜백은 다음 호출 몫이다. */
function frame(ts: number) {
  const batch = rafQueue;
  rafQueue = [];
  act(() => { for (const r of batch) r.cb(ts); });
}

/** 캔버스의 CSS 크기와 화면 배율을 스텁한다. jsdom 의 clientWidth·clientHeight 는 항상 0 이다. */
function stubSize(cssW: number, cssH: number, dpr: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(cssW);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(cssH);
  vi.stubGlobal('devicePixelRatio', dpr);
}

type Props = Parameters<typeof Points3dView>[0];

function mount(over: Partial<Props> = {}) {
  const rec = recordingGl();
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(rec.gl as unknown as RenderingContext);
  const onError = vi.fn();
  const utils = render(
    <Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={onError} {...over} />,
  );
  const canvas = screen.getByRole('img', { name: '3D 점군 뷰어' }) as HTMLCanvasElement;
  return { rec, getContext, onError, canvas, ...utils };
}

/** 마지막 uniform 호출의 값(위치 인자 뒤)을 숫자 목록으로 편다. uniform1f / 3f / 3fv / Matrix4fv 를 가리지 않는다. */
function lastUniform(rec: RecordingGl, name: string): number[] {
  const calls = rec.uniformCalls(name);
  expect(calls.length, `${name} uniform 호출`).toBeGreaterThan(0);
  return calls[calls.length - 1].args.slice(1).flatMap((a) => (
    typeof a === 'number' ? [a] : typeof a === 'boolean' ? [] : Array.from(a as ArrayLike<number>)
  ));
}

function lastPointDraw(rec: RecordingGl): number {
  const draws = rec.pointDraws();
  expect(draws.length).toBeGreaterThan(0);
  return draws[draws.length - 1];
}

function expectMatrix(actual: number[], expected: Float32Array) {
  expect(actual).toHaveLength(16);
  for (let i = 0; i < 16; i++) expect(actual[i]).toBeCloseTo(expected[i], 5);
}

function ctrlWheel(canvas: HTMLCanvasElement, init: WheelEventInit = {}) {
  const e = new WheelEvent('wheel', { ctrlKey: true, cancelable: true, bubbles: true, deltaY: -120, ...init });
  act(() => { canvas.dispatchEvent(e); });
  return e;
}

const mouse = (x: number, y: number, more: object = {}) => (
  { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...more }
);

beforeEach(() => {
  rafQueue = [];
  rafSeq = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafSeq += 1;
    rafQueue.push({ id: rafSeq, cb });
    return rafSeq;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafQueue = rafQueue.filter((r) => r.id !== id); });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Points3dLoadingFrame', () => {
  // 변이: 배경을 색 유틸리티 클래스로 / 테마 인자 무시 / Spinner 칩 제거(검정 위에서 회전 호가 보이지 않는다)
  it('뷰어 영역과 같은 틀에 테마 배경색, 흰 칩 안의 Spinner, 로딩 문구를 그린다', () => {
    const { rerender } = render(<Points3dLoadingFrame theme="dark" />);
    const box = screen.getByTestId('points3d-loading');
    expect(box).toHaveStyle({ backgroundColor: '#000000', color: '#f2f4f7' });
    for (const cls of ['aspect-[4/3]', 'w-full', 'rounded-lg', 'border', 'border-cs-divider']) {
      expect(box.className.split(/\s+/)).toContain(cls);
    }
    const spinner = within(box).getByRole('status');
    expect(spinner.parentElement!.className).toBe('inline-flex rounded-full bg-white p-2');
    expect(within(box).getByText('3D 점군 데이터를 불러오는 중입니다.')).toBeInTheDocument();

    rerender(<Points3dLoadingFrame theme="light" />);
    expect(screen.getByTestId('points3d-loading')).toHaveStyle({ backgroundColor: '#ffffff', color: '#000716' });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: FAIL. `Error: Failed to resolve import "../points3d-view" from "components/analysis/__tests__/points3d-view.test.tsx". Does the file exist?` 테스트는 0건 실행된다.

- [ ] **Step 4: (a) 구현 - 파일 머리와 `Points3dLoadingFrame`**

`dashboard/components/analysis/points3d-view.tsx` 를 아래 내용으로 만든다.

```tsx
// 3D 점군 1:1 뷰어(스펙 2026-10-02-pointcloud-viewer-design §7). 캔버스 + 오버레이(범례·HUD·조작 안내·축 라벨·읽기 창),
// 컨트롤 줄, 고지 문구를 그리고 DOM 입력을 순수 모듈(lib/viz/points3d)에 연결한다.
// - WebGL 은 gl-renderer.ts 만 만진다. 이 파일은 createRenderer 를 effect 안에서 부르고 cleanup 에서 dispose 한다.
// - 뷰어 색은 POINTS3D_THEME 의 hex 를 인라인 style 로만 쓴다(색 유틸리티 클래스 금지). 바깥 크롬은 cs 토큰 클래스.
// - 임계값은 점을 어느 색으로 칠할지만 정하는 표시용 값이다. 판정 등급을 만들지 않는다.
'use client';
import { POINTS3D_THEME } from '@/lib/domain/points3d';
import type { ThemeName } from '@/lib/domain/points3d';
import { Spinner } from '@/components/ui/spinner';

// 로딩 틀. 뷰어 영역과 같은 크기·같은 배경이라 탭에 들어올 때 틀 색이 바뀌는 번쩍임이 없다.
// 공용 Spinner 의 회전 호가 검정 위에서 보이지 않아 흰 칩 안에 넣는다(칩의 흰색은 그림의 색이 아니라 Spinner 의 바탕).
export function Points3dLoadingFrame({ theme }: { theme: ThemeName }) {
  const t = POINTS3D_THEME[theme];
  return (
    <div data-testid="points3d-loading"
      className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-lg border border-cs-divider"
      style={{ backgroundColor: t.background, color: t.text }}>
      <span className="inline-flex rounded-full bg-white p-2"><Spinner /></span>
      <p className="text-sm">3D 점군 데이터를 불러오는 중입니다.</p>
    </div>
  );
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  1 passed (1)`.

- [ ] **Step 6: (b) 정적 화면 - 실패하는 테스트 추가**

테스트 파일 **끝에** 아래를 이어 붙인다(앞에 빈 줄 하나). 범례·HUD·조작 안내·컨트롤 줄·고지 문구·병합 안내·배경 전환을 본다. 이 단계의 테스트는 그리기(`frame`)를 부르지 않는다.

```tsx
// 고지 문구 전문(스펙 §7.12). 임계값 7mm 일 때. 음수 부호는 U+2212 다
const NOTICE_7 = '점 색은 참고용 표시입니다. FLAT(평탄)은 점이 속한 5cm 칸이 구역 기준 평면에서 ±7mm 이내, '
  + 'DEPRESSION(침하)은 −7mm 미만, PROTRUSION(융기)은 +7mm 초과임을 뜻합니다. '
  + '판정 등급은 히트맵 탭의 직선자 틈새 기준이며 측정 방식이 다릅니다. '
  + '초록 점이 대부분인 칸이 경계·보수일 수 있고, 노랑·빨강 점이 많은 칸이 적합일 수 있습니다. '
  + '임계값을 바꿔도 판정과 보고서는 달라지지 않습니다.';

describe('Points3dView 화면', () => {
  // 변이: 범례 항목 누락·순서 변경, 표식 색을 클래스로
  it('범례 4항목을 테마 색 둥근 표식과 함께 그린다', () => {
    mount();
    const legend = screen.getByTestId('points3d-legend');
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['FLAT', 'DEPRESSION', 'PROTRUSION', '편차 없음']);
    expect(legend).toHaveStyle({ color: '#f2f4f7' });
    const swatch = (cls: string) => legend.querySelector(`[data-class="${cls}"]`) as HTMLElement;
    expect(swatch('flat')).toHaveStyle({ backgroundColor: '#4cc96f' });
    expect(swatch('depression')).toHaveStyle({ backgroundColor: '#f5c33b' });
    expect(swatch('protrusion')).toHaveStyle({ backgroundColor: '#f06464' });
    expect(swatch('none')).toHaveStyle({ backgroundColor: '#4a4f57' });
    expect(swatch('flat').className).toContain('rounded-full');
  });

  // 1,234 -> toLocaleString('ko-KR') = "1,234". 변이: 점 수를 그대로 찍음(1234점), 가운뎃점 대신 다른 구분자
  it('HUD: k = 1 이면 축 비율 1:1, 임계값, 점 수(천 단위 구분). 조작 안내는 보조 글자색', () => {
    mount();
    const hud = screen.getByTestId('points3d-hud');
    const hint = screen.getByTestId('points3d-hint');
    expect(hud.textContent).toBe('축 비율 1:1 · 임계값 ±7 mm · 1,234점');
    expect(hud).toHaveStyle({ color: '#f2f4f7' });
    expect(hint.textContent).toBe('드래그 회전 · Ctrl+휠 확대');
    expect(hint).toHaveStyle({ color: '#9aa3ad' });
    // 둘은 뷰어 아래쪽 한 줄에 있고 폭이 좁으면 접힌다
    expect(hint.parentElement).toBe(hud.parentElement);
    expect(hud.parentElement!.className.split(/\s+/)).toEqual(expect.arrayContaining(['absolute', 'bottom-3', 'flex-wrap']));
  });

  // 변이: k > 1 에서도 "축 비율 1:1" 을 남김
  it('과장 버튼을 누르면 HUD 가 "편차 ×{k} 과장" 이 된다', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '×50' }));
    expect(screen.getByTestId('points3d-hud').textContent).toBe('편차 ×50 과장 · 임계값 ±7 mm · 1,234점');
    fireEvent.click(screen.getByRole('button', { name: '×1' }));
    expect(screen.getByTestId('points3d-hud').textContent).toBe('축 비율 1:1 · 임계값 ±7 mm · 1,234점');
  });

  // 변이: 선택 배경을 bg-cs-info-bg 덧붙이기로(normal 의 bg-transparent 에 가려 보이지 않는다)
  it('과장 버튼 4개는 aria-pressed 를 갖고 선택 배경은 aria-pressed variant 로 준다', () => {
    mount();
    const names = ['×1', '×10', '×50', '×100'];
    const pressed = () => names.map((n) => screen.getByRole('button', { name: n }).getAttribute('aria-pressed'));
    expect(pressed()).toEqual(['true', 'false', 'false', 'false']);
    fireEvent.click(screen.getByRole('button', { name: '×10' }));
    expect(pressed()).toEqual(['false', 'true', 'false', 'false']);
    for (const n of [...names, '밝은 배경']) {
      const tokens = screen.getByRole('button', { name: n }).className.split(/\s+/);
      expect(tokens).toContain('aria-pressed:bg-cs-info-bg');
      expect(tokens).not.toContain('bg-cs-info-bg');
    }
  });

  // 변이: 시점 버튼에 선택 상태를 둠(회전하면 어느 프리셋도 아니다)
  it('시점 버튼에는 선택 상태가 없다', () => {
    mount();
    for (const n of ['등각', '평면', '정면']) {
      expect(screen.getByRole('button', { name: n })).not.toHaveAttribute('aria-pressed');
    }
  });

  // 변이: primary 버튼을 둠(뷰당 primary 1개 규칙 위반)
  it('버튼 8개가 전부 normal 변형이고 묶음 이름 3개가 있다', () => {
    mount();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['등각', '평면', '정면', '×1', '×10', '×50', '×100', '밝은 배경']);
    for (const b of buttons) {
      const tokens = b.className.split(/\s+/);
      expect(tokens).toContain('bg-transparent');
      expect(tokens).not.toContain('bg-cs-link');
      expect(b).toHaveAttribute('type', 'button');
    }
    for (const name of ['시점', '편차 과장', '임계값']) {
      expect(screen.getByText(name).className).toBe('text-sm font-bold');
    }
  });

  // 변이: 슬라이더 범위·단계 오타, aria-valuetext 누락(보조 기술이 7mm 를 "70" 으로 읽는다)
  it('임계값 슬라이더: 10~300, 5 단계, aria-valuetext 는 mm 표기', () => {
    mount();
    const slider = screen.getByRole('slider', { name: '표시 임계값(mm)' }) as HTMLInputElement;
    expect(slider).toHaveAttribute('min', '10');
    expect(slider).toHaveAttribute('max', '300');
    expect(slider).toHaveAttribute('step', '5');
    expect(slider.value).toBe('70');
    expect(slider).toHaveAttribute('aria-valuetext', '±7 mm');
    expect(slider.className).toContain('accent-cs-link');
  });

  // 20 -> "2", 75 -> "7.5". 변이: HUD·고지 문구가 기본값에 고정됨
  it('슬라이더를 움직이면 HUD·고지 문구·aria-valuetext 의 숫자가 함께 바뀐다', () => {
    mount();
    const slider = screen.getByRole('slider', { name: '표시 임계값(mm)' });
    fireEvent.change(slider, { target: { value: '20' } });
    expect(screen.getByTestId('points3d-hud').textContent).toBe('축 비율 1:1 · 임계값 ±2 mm · 1,234점');
    const notice = screen.getByTestId('points3d-notice').textContent!;
    expect(notice).toContain('±2mm 이내');
    expect(notice).toContain('−2mm 미만');
    expect(notice).toContain('+2mm 초과');
    expect(notice).not.toContain('7mm');
    expect(slider).toHaveAttribute('aria-valuetext', '±2 mm');

    fireEvent.change(slider, { target: { value: '75' } });
    expect(screen.getByTestId('points3d-hud').textContent).toContain('임계값 ±7.5 mm');
    expect(slider).toHaveAttribute('aria-valuetext', '±7.5 mm');
  });

  // 63 은 5 의 배수가 아니다. 변이: 기본 임계값을 5 의 배수로 반올림(65 -> "6.5")
  it('격자 밖 기본값 63 은 그대로 쓴다: HUD·고지 문구·aria-valuetext 가 6.3', () => {
    mount({ defaultThresholdQ: 63 });
    expect(screen.getByTestId('points3d-hud').textContent).toBe('축 비율 1:1 · 임계값 ±6.3 mm · 1,234점');
    expect(screen.getByTestId('points3d-notice').textContent).toContain('±6.3mm 이내');
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '±6.3 mm');
  });

  // 변이: 문구 변경, U+2212 대신 ASCII 하이픈, 스팬 숫자·분류 비율 삽입
  it('고지 문구 전문(임계값만 동적)', () => {
    mount();
    const notice = screen.getByTestId('points3d-notice');
    expect(notice.textContent).toBe(NOTICE_7);
    expect(notice.className).toBe('text-xs leading-4 text-cs-text-secondary');
    expect(NOTICE_7).toContain(String.fromCharCode(0x2212) + '7mm');   // 음수 부호는 U+2212
    expect(NOTICE_7).not.toContain(String.fromCharCode(0x2014));      // U+2014 금지
  });

  // 변이: 병합 안내를 항상 그림 / 그리지 않음
  it('정합 병합 스캔일 때만 병합 안내 한 줄을 고지 문구 아래에 둔다', () => {
    const { rerender, onError } = mount();
    expect(screen.queryByTestId('points3d-merged-note')).toBeNull();
    rerender(<Points3dView data={SMALL} defaultThresholdQ={70} isRegistered onError={onError} />);
    const note = screen.getByTestId('points3d-merged-note');
    expect(note.textContent).toBe('정합 병합 스캔의 점은 원본 점이 아니라 5cm 격자 대표점입니다.');
    expect(screen.getByTestId('points3d-notice').compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  // 변이: 배경을 클래스로 줌, 밝은 배경 전환이 오버레이 색에 닿지 않음
  it('밝은 배경 버튼: 뷰어 영역 인라인 배경과 오버레이 색이 light 표로 바뀌고 다시 누르면 돌아온다', () => {
    mount();
    const viewport = screen.getByTestId('points3d-viewport');
    const button = screen.getByRole('button', { name: '밝은 배경' });
    expect(viewport).toHaveStyle({ backgroundColor: '#000000' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);
    expect(viewport).toHaveStyle({ backgroundColor: '#ffffff' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('points3d-legend')).toHaveStyle({ color: '#000716' });
    expect(screen.getByTestId('points3d-hud')).toHaveStyle({ color: '#000716' });
    expect(screen.getByTestId('points3d-hint')).toHaveStyle({ color: '#5f6b7a' });
    expect(screen.getByTestId('points3d-labels')).toHaveStyle({ color: '#5f6b7a' });
    expect(screen.getByTestId('points3d-legend').querySelector('[data-class="flat"]'))
      .toHaveStyle({ backgroundColor: '#1e9e50' });

    fireEvent.click(button);
    expect(viewport).toHaveStyle({ backgroundColor: '#000000' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  // 변이: 뷰어 영역 비율·틀 클래스 누락, 오버레이가 포인터를 가로챔(캔버스 드래그가 끊긴다)
  it('뷰어 영역은 4:3 틀이고 오버레이는 pointer-events-none 이다', () => {
    mount();
    const tokens = screen.getByTestId('points3d-viewport').className.split(/\s+/);
    for (const cls of ['relative', 'aspect-[4/3]', 'w-full', 'overflow-hidden', 'rounded-lg', 'border', 'border-cs-divider']) {
      expect(tokens).toContain(cls);
    }
    const overlays = [
      screen.getByTestId('points3d-legend'),
      screen.getByTestId('points3d-labels'),
      screen.getByTestId('points3d-hud').parentElement!,
    ];
    for (const el of overlays) expect(el.className.split(/\s+/)).toContain('pointer-events-none');
  });

  // 변이: tabIndex 누락(키 조작 불가), touch-action 누락(터치 드래그가 페이지를 스크롤)
  it('캔버스: role img, 이름, tabIndex 0, touch-action none, cs-link 포커스 외곽선', () => {
    const { canvas } = mount();
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas).toHaveAttribute('tabindex', '0');
    const tokens = canvas.className.split(/\s+/);
    expect(tokens).toContain('touch-none');
    expect(tokens).toContain('focus-visible:outline-2');
    expect(tokens).toContain('focus-visible:outline-cs-link');
  });

  // 변이: 뷰어 옆에 preview3d.png 를 함께 그림, 옛 팔레트 클래스·색 이름이 든 속성 사용
  it('PNG 를 함께 그리지 않고, DOM 에 옛 팔레트 부분 문자열이 없다', () => {
    const { container } = mount({ isRegistered: true });
    fireEvent.click(screen.getByRole('button', { name: '밝은 배경' }));
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-|green-|purple-/);
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  15 failed | 1 passed (16)`. 실패 15건은 전부 `Points3dView 화면` 이고 사유는 `Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined.`(아직 `Points3dView` 를 export 하지 않았다).

- [ ] **Step 8: (b) 구현 - 상태와 정적 JSX**

`points3d-view.tsx` 전체를 아래 내용으로 바꾼다(Step 4 의 로딩 틀은 그대로 들어 있다). 이 단계의 캔버스에는 아직 ref 와 핸들러가 없고, 축 라벨 층은 비어 있으며, 시점 버튼은 눌러도 아무 일도 하지 않는다. `onError` 는 타입에만 있고 아직 쓰지 않는다.

```tsx
// 3D 점군 1:1 뷰어(스펙 2026-10-02-pointcloud-viewer-design §7). 캔버스 + 오버레이(범례·HUD·조작 안내·축 라벨·읽기 창),
// 컨트롤 줄, 고지 문구를 그리고 DOM 입력을 순수 모듈(lib/viz/points3d)에 연결한다.
// - WebGL 은 gl-renderer.ts 만 만진다. 이 파일은 createRenderer 를 effect 안에서 부르고 cleanup 에서 dispose 한다.
// - 뷰어 색은 POINTS3D_THEME 의 hex 를 인라인 style 로만 쓴다(색 유틸리티 클래스 금지). 바깥 크롬은 cs 토큰 클래스.
// - 임계값은 점을 어느 색으로 칠할지만 정하는 표시용 값이다. 판정 등급을 만들지 않는다.
'use client';
import { useState } from 'react';
import {
  EXAGGERATIONS, POINTS3D_THEME, POINT_CLASS_LABEL, THRESHOLD_Q_MAX, THRESHOLD_Q_MIN, THRESHOLD_Q_STEP,
  fmtThresholdMm,
} from '@/lib/domain/points3d';
import type { PointClass, Points3dData, ThemeName } from '@/lib/domain/points3d';
import type { ViewPreset } from '@/lib/viz/points3d/orbit';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

const LEGEND: PointClass[] = ['flat', 'depression', 'protrusion', 'none'];
const VIEW_PRESETS: { id: ViewPreset; label: string }[] = [
  { id: 'iso', label: '등각' },
  { id: 'top', label: '평면' },
  { id: 'front', label: '정면' },
];
// 선택 배경. Button 의 normal 변형이 가진 투명 배경 클래스와 특이도가 같은 클래스를 덧붙이면 가려진다.
// aria-pressed variant 는 속성 선택자가 붙어 특이도가 높다. 공용 Button 은 고치지 않는다.
const PRESSED = 'aria-pressed:bg-cs-info-bg';
const GROUP = 'flex flex-wrap items-center gap-2';
const GROUP_NAME = 'text-sm font-bold';
const NOTE = 'text-xs leading-4 text-cs-text-secondary';

// 로딩 틀. 뷰어 영역과 같은 크기·같은 배경이라 탭에 들어올 때 틀 색이 바뀌는 번쩍임이 없다.
// 공용 Spinner 의 회전 호가 검정 위에서 보이지 않아 흰 칩 안에 넣는다(칩의 흰색은 그림의 색이 아니라 Spinner 의 바탕).
export function Points3dLoadingFrame({ theme }: { theme: ThemeName }) {
  const t = POINTS3D_THEME[theme];
  return (
    <div data-testid="points3d-loading"
      className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-lg border border-cs-divider"
      style={{ backgroundColor: t.background, color: t.text }}>
      <span className="inline-flex rounded-full bg-white p-2"><Spinner /></span>
      <p className="text-sm">3D 점군 데이터를 불러오는 중입니다.</p>
    </div>
  );
}

export function Points3dView({ data, defaultThresholdQ, isRegistered }: {
  data: Points3dData;
  defaultThresholdQ: number;          // 엔진이 준 표시 임계값(0.1mm 정수, 10~300). 5의 배수로 맞추지 않는다
  isRegistered: boolean;              // 정합 병합 스캔인가
  onError(kind: 'webgl' | 'context'): void;
}) {
  const [thresholdQ, setThresholdQ] = useState(defaultThresholdQ);
  const [exaggeration, setExaggeration] = useState<number>(EXAGGERATIONS[0]);
  const [themeName, setThemeName] = useState<ThemeName>('dark');

  const theme = POINTS3D_THEME[themeName];
  const thresholdText = fmtThresholdMm(thresholdQ);
  const hud = [
    exaggeration === 1 ? '축 비율 1:1' : `편차 ×${exaggeration} 과장`,
    `임계값 ±${thresholdText} mm`,
    `${data.meta.n_points.toLocaleString('ko-KR')}점`,
  ].join(' · ');

  return (
    <div className="flex flex-col gap-3">
      <div data-testid="points3d-viewport"
        className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-cs-divider"
        style={{ backgroundColor: theme.background }}>
        <canvas role="img" aria-label="3D 점군 뷰어" tabIndex={0}
          className="absolute inset-0 h-full w-full touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cs-link" />
        <div data-testid="points3d-labels" className="pointer-events-none absolute inset-0 text-xs leading-4"
          style={{ color: theme.textSecondary }} />
        <ul data-testid="points3d-legend"
          className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1 text-xs leading-4"
          style={{ color: theme.text }}>
          {LEGEND.map((cls) => (
            <li key={cls} className="flex items-center gap-2">
              <span aria-hidden data-class={cls} className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: theme[cls] }} />
              {POINT_CLASS_LABEL[cls]}
            </li>
          ))}
        </ul>
        {/* 아래 줄: 왼쪽 HUD, 오른쪽 조작 안내. 폭이 좁으면 두 줄로 접힌다 */}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 text-xs leading-4">
          <p data-testid="points3d-hud" style={{ color: theme.text }}>{hud}</p>
          <p data-testid="points3d-hint" style={{ color: theme.textSecondary }}>드래그 회전 · Ctrl+휠 확대</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className={GROUP}>
          <span className={GROUP_NAME}>시점</span>
          {VIEW_PRESETS.map((p) => (
            <Button key={p.id}>{p.label}</Button>
          ))}
        </div>
        <div className={GROUP}>
          <span className={GROUP_NAME}>편차 과장</span>
          {EXAGGERATIONS.map((k) => (
            <Button key={k} aria-pressed={exaggeration === k} className={PRESSED} onClick={() => setExaggeration(k)}>
              {`×${k}`}
            </Button>
          ))}
        </div>
        <div className={GROUP}>
          <span className={GROUP_NAME}>임계값</span>
          <input type="range" min={THRESHOLD_Q_MIN} max={THRESHOLD_Q_MAX} step={THRESHOLD_Q_STEP}
            value={thresholdQ} onChange={(e) => setThresholdQ(Number(e.target.value))}
            aria-label="표시 임계값(mm)" aria-valuetext={`±${thresholdText} mm`}
            className="w-40 accent-cs-link" />
          <span className="font-mono text-sm tabular-nums">{`±${thresholdText} mm`}</span>
        </div>
        <Button aria-pressed={themeName === 'light'} className={PRESSED}
          onClick={() => setThemeName((t) => (t === 'dark' ? 'light' : 'dark'))}>
          밝은 배경
        </Button>
      </div>

      <p data-testid="points3d-notice" className={NOTE}>
        {`점 색은 참고용 표시입니다. FLAT(평탄)은 점이 속한 5cm 칸이 구역 기준 평면에서 ±${thresholdText}mm 이내, DEPRESSION(침하)은 −${thresholdText}mm 미만, PROTRUSION(융기)은 +${thresholdText}mm 초과임을 뜻합니다. 판정 등급은 히트맵 탭의 직선자 틈새 기준이며 측정 방식이 다릅니다. 초록 점이 대부분인 칸이 경계·보수일 수 있고, 노랑·빨강 점이 많은 칸이 적합일 수 있습니다. 임계값을 바꿔도 판정과 보고서는 달라지지 않습니다.`}
      </p>
      {isRegistered && (
        <p data-testid="points3d-merged-note" className={NOTE}>
          정합 병합 스캔의 점은 원본 점이 아니라 5cm 격자 대표점입니다.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 9: 통과 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  16 passed (16)`.

- [ ] **Step 10: (c) 렌더러 생성·크기·그리기 - 실패하는 테스트 추가**

테스트 파일 끝에 아래를 이어 붙인다(앞에 빈 줄 하나). `frame(ts)` 는 머리에 있는 수동 rAF 큐 실행 함수다.

```tsx
describe('Points3dView 렌더러 연결', () => {
  // 변이: getContext 를 렌더 중에 부름(SSR 에서 터진다) / 마운트마다 여러 번 부름 / 연속 루프
  it('마운트에 getContext("webgl2") 를 한 번 부르고 첫 프레임에 n 개 전부를 그린다', () => {
    const { rec, getContext } = mount();
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext.mock.calls[0][0]).toBe('webgl2');
    expect(rec.pointDraws()).toEqual([]);   // 그리기는 rAF 에서
    expect(rafQueue).toHaveLength(1);
    frame(0);
    expect(rec.pointDraws()).toEqual([1234]);
    expect(rafQueue).toHaveLength(0);       // 연속 루프가 아니다
  });

  // 0.55 x 0.0125 = 0.006875. ALIASED_POINT_SIZE_RANGE 스텁 [1, 1024]
  it('점 크기 uniform: uPointWorldM = 0.55 x sample_cell_m, uMaxPx = 상한', () => {
    const { rec } = mount();
    frame(0);
    expect(lastUniform(rec, 'uPointWorldM')[0]).toBeCloseTo(0.006875, 9);
    expect(lastUniform(rec, 'uMaxPx')).toEqual([1024]);
  });

  // 변이: 초기 시점이 등각이 아님, 종횡비를 CSS 크기에서 구하지 않음
  it('초기 카메라는 fit_bounds 에 맞춘 등각 시점이다', () => {
    stubSize(640, 480, 1);
    const { rec } = mount();
    frame(0);
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(fitToBounds(FIT, 'iso'), 640 / 480, FULL));
  });

  // 변이: 과장 배율을 넘기지 않음, 상태가 바뀌어도 다시 그리지 않음
  it('과장 버튼을 누르면 uExag 만 바꿔 n 개 전부로 한 번 다시 그린다', () => {
    const { rec } = mount();
    frame(0);
    expect(lastUniform(rec, 'uExag')).toEqual([1]);
    fireEvent.click(screen.getByRole('button', { name: '×50' }));
    expect(rafQueue).toHaveLength(1);
    frame(16);
    expect(lastUniform(rec, 'uExag')).toEqual([50]);
    expect(rec.pointDraws()).toEqual([1234, 1234]);
    expect(rafQueue).toHaveLength(0);
  });

  // 변이: 임계값을 mm 로 바꿔 넘김(7), 기본값을 5 의 배수로 반올림(65)
  it('uThresholdQ 는 0.1mm 정수 그대로다: 기본값 63, 슬라이더 20', () => {
    const { rec } = mount({ defaultThresholdQ: 63 });
    frame(0);
    expect(lastUniform(rec, 'uThresholdQ')).toEqual([63]);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '20' } });
    frame(16);
    expect(lastUniform(rec, 'uThresholdQ')).toEqual([20]);
  });

  // #4cc96f = (76, 201, 111) / 255, #1e9e50 = (30, 158, 80) / 255
  // 변이: 밝은 배경 전환이 캔버스 색(clearColor·uniform)에 닿지 않음
  it('밝은 배경 버튼을 누르면 clearColor 와 점 색 uniform 이 light 표로 바뀐다', () => {
    const { rec } = mount();
    frame(0);
    expect(rec.callsOf('clearColor').at(-1)!.args).toEqual([0, 0, 0, 1]);
    const dark = lastUniform(rec, 'uColFlat');
    expect(dark[0]).toBeCloseTo(76 / 255, 6);
    expect(dark[1]).toBeCloseTo(201 / 255, 6);
    expect(dark[2]).toBeCloseTo(111 / 255, 6);

    fireEvent.click(screen.getByRole('button', { name: '밝은 배경' }));
    frame(16);
    expect(rec.callsOf('clearColor').at(-1)!.args).toEqual([1, 1, 1, 1]);
    const light = lastUniform(rec, 'uColFlat');
    expect(light[0]).toBeCloseTo(30 / 255, 6);
    expect(light[1]).toBeCloseTo(158 / 255, 6);
    expect(light[2]).toBeCloseTo(80 / 255, 6);
  });

  // fit 4m x 3m -> 눈금 간격 0.2m (20 + 15 + 2 = 37 <= 40). 눈금 "0.0" 이 두 축에 하나씩 있다
  // 변이: 축 라벨 층을 그리지 않음, 라벨 색을 글자색으로
  it('첫 프레임 뒤 축 라벨 층에 눈금 숫자와 축 이름을 보조 글자색으로 그린다', () => {
    stubSize(640, 480, 1);
    mount();
    expect(screen.getByTestId('points3d-labels').textContent).toBe('');
    frame(0);
    const layer = screen.getByTestId('points3d-labels');
    expect(layer).toHaveStyle({ color: '#9aa3ad' });
    expect(within(layer).getByText('x (m)')).toBeInTheDocument();
    expect(within(layer).getByText('y (m)')).toBeInTheDocument();
    expect(within(layer).getAllByText('0.0')).toHaveLength(2);
  });

  // 변이: cleanup 누락(버퍼·프로그램 누수), dispose 가 loseContext 를 부름, 예약된 rAF 를 남김
  it('언마운트하면 렌더러를 dispose 하고 예약된 rAF 를 취소한다', () => {
    const { rec, unmount } = mount();
    expect(rafQueue).toHaveLength(1);
    unmount();
    expect(rec.callsOf('deleteProgram').length).toBeGreaterThan(0);
    expect(rec.callsOf('deleteBuffer').length).toBeGreaterThan(0);
    expect(rec.loseContextCalls()).toBe(0);
    expect(rafQueue).toHaveLength(0);
  });

  // React 개발 모드의 StrictMode 는 effect 를 실행 -> cleanup -> 다시 실행한다(같은 canvas 노드를 재사용).
  // 변이: cleanup 에서 rAF 를 취소하지 않음(두 번 그린다)
  it('StrictMode 의 effect 이중 실행에서도 한 번만 그린다', () => {
    const rec = recordingGl();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(rec.gl as unknown as RenderingContext);
    render(
      <StrictMode>
        <Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={vi.fn()} />
      </StrictMode>,
    );
    expect(getContext).toHaveBeenCalledTimes(2);
    expect(rafQueue).toHaveLength(1);
    frame(0);
    expect(rec.pointDraws()).toEqual([1234]);
    expect(rec.loseContextCalls()).toBe(0);
  });

  // 변이: onError 를 effect 의존성에 넣음(상위가 다시 그릴 때마다 렌더러를 다시 만든다)
  it('상위가 새 onError 함수로 다시 그려도 렌더러를 다시 만들지 않는다', () => {
    const { getContext, rerender } = mount();
    rerender(<Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={vi.fn()} />);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  // 변이: createRenderer 가 null 일 때 조용히 빈 캔버스를 둠, onError 중복 호출
  it('WebGL2 컨텍스트를 얻지 못하면 onError("webgl") 를 한 번 부르고 그리기를 예약하지 않는다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onError = vi.fn();
    const { rerender } = render(
      <Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={onError} />,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('webgl');
    expect(rafQueue).toHaveLength(0);
    rerender(<Points3dView data={SMALL} defaultThresholdQ={70} isRegistered onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: '×10' }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(rafQueue).toHaveLength(0);
  });

  // 변이: 마운트 수명에 한 번만 알리는 가드 제거(effect 이중 실행에서 두 번 알린다)
  it('StrictMode 의 effect 이중 실행에서도 onError("webgl") 는 한 번이다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onError = vi.fn();
    render(
      <StrictMode>
        <Points3dView data={SMALL} defaultThresholdQ={70} isRegistered={false} onError={onError} />
      </StrictMode>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('webgl');
  });
});

describe('Points3dView 픽셀 단위', () => {
  // 960 / (2 x tan(20도)) = 960 / 0.7279404685 = 1318.789. 최소 점 크기 1.5 x 2 = 3
  // 변이: pxPerUnit 에 CSS 높이(480 -> 659.394), 최소 크기에 배율 미적용(1.5)
  it('배율 2: 드로잉 버퍼 1280x960, uPxPerUnit 은 버퍼 높이 기준, uMinPx = 3', () => {
    stubSize(640, 480, 2);
    const { rec, canvas } = mount();
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(960);
    expect(rec.callsOf('viewport').at(-1)!.args).toEqual([0, 0, 1280, 960]);
    frame(0);
    expect(lastUniform(rec, 'uPxPerUnit')[0]).toBeCloseTo(1318.789, 2);
    expect(lastUniform(rec, 'uMinPx')).toEqual([3]);
    // 종횡비는 CSS 크기 기준 4:3 그대로다
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(fitToBounds(FIT, 'iso'), 640 / 480, FULL));
  });

  // 480 / 0.7279404685 = 659.394
  it('배율 1: 드로잉 버퍼 640x480, uPxPerUnit = 659.394, uMinPx = 1.5', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    expect([canvas.width, canvas.height]).toEqual([640, 480]);
    frame(0);
    expect(lastUniform(rec, 'uPxPerUnit')[0]).toBeCloseTo(659.394, 2);
    expect(lastUniform(rec, 'uMinPx')).toEqual([1.5]);
  });

  // 변이: min(devicePixelRatio, 2) 의 상한 제거(1920x1440)
  it('배율 3 은 2 로 묶는다', () => {
    stubSize(640, 480, 3);
    const { rec, canvas } = mount();
    expect([canvas.width, canvas.height]).toEqual([1280, 960]);
    frame(0);
    expect(lastUniform(rec, 'uMinPx')).toEqual([3]);
  });

  // jsdom 의 clientWidth·clientHeight 는 0 이다. 변이: 1 이상으로 묶지 않음(종횡비가 NaN)
  it('크기가 0 인 환경에서도 버퍼 1x1 로 그리고 행렬에 NaN 이 없다', () => {
    const { rec, canvas } = mount();
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
    frame(0);
    expect(lastUniform(rec, 'uViewProj').every(Number.isFinite)).toBe(true);
    expect(rec.pointDraws()).toEqual([1234]);
  });

  // 버퍼 크기를 바꾸면 캔버스가 지워진다. 변이: 다시 그리기를 다음 프레임으로 미룸(밝은 배경에서 검정이 번쩍인다),
  //       크기가 그대로인데도 버퍼를 다시 맞춤, ResizeObserver 를 방어 없이 씀(jsdom 에 없어 다른 테스트가 전부 던진다)
  it('ResizeObserver 가 있으면 크기 변화를 따라 버퍼를 다시 맞추고 그 자리에서 다시 그린다', () => {
    let notify: () => void = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify = cb; }
      observe = observe;
      disconnect = disconnect;
    });
    stubSize(640, 480, 1);
    const { rec, canvas, unmount } = mount();
    frame(0);
    expect(observe).toHaveBeenCalledWith(canvas);
    const viewports = rec.callsOf('viewport').length;
    act(() => { notify(); });                 // 관찰을 시작하면 브라우저가 한 번 알린다. 크기는 그대로다
    expect(rec.callsOf('viewport')).toHaveLength(viewports);
    expect(rec.pointDraws()).toEqual([1234]);

    stubSize(800, 600, 1);
    act(() => { notify(); });
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
    expect(rec.pointDraws()).toEqual([1234, 1234]);   // rAF 를 기다리지 않는다
    expect(rafQueue).toHaveLength(0);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 11: 실패 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  17 failed | 16 passed (33)`. 새 17건이 전부 실패한다(`expected "getContext" to be called 1 times, but got 0 times`, `uViewProj uniform 호출: expected 0 to be greater than 0`, `Unable to find an element with the text: x (m)` 등). 앞 단계의 16건은 통과한 채다.

- [ ] **Step 12: (c) 구현 - 렌더러 effect, 크기, draw, 축 라벨**

`points3d-view.tsx` 에 아래 diff 를 적용한다. `-` 줄을 지우고 `+` 줄을 넣는다(앞뒤의 문맥 줄은 그대로다). diff 를 `.superpowers/tmp/t12-c.diff` 로 저장해 저장소 루트에서 `git apply .superpowers/tmp/t12-c.diff` 로 적용해도 된다(`.superpowers/` 는 추적되지 않는 폴더다). 적용 뒤 파일은 268줄이다.

이 단계가 더하는 것: `measure`(크기와 배율), 렌더러를 만들고 지우는 effect, `draw`(uniform 값 조립과 축 라벨 배치), 그리기 예약(`requestDraw` → `frame`), `ResizeObserver`, 임계값·과장·배경을 `viewRef` 로 넘기는 effect, `onError` 를 한 번만 알리는 `report`. 카메라는 아직 고정된 등각 시점이다.

```diff
--- a/dashboard/components/analysis/points3d-view.tsx
+++ b/dashboard/components/analysis/points3d-view.tsx
@@ -4,15 +4,24 @@
 // - 뷰어 색은 POINTS3D_THEME 의 hex 를 인라인 style 로만 쓴다(색 유틸리티 클래스 금지). 바깥 크롬은 cs 토큰 클래스.
 // - 임계값은 점을 어느 색으로 칠할지만 정하는 표시용 값이다. 판정 등급을 만들지 않는다.
 'use client';
-import { useState } from 'react';
+import { useEffect, useMemo, useRef, useState } from 'react';
+import { flushSync } from 'react-dom';
 import {
   EXAGGERATIONS, POINTS3D_THEME, POINT_CLASS_LABEL, THRESHOLD_Q_MAX, THRESHOLD_Q_MIN, THRESHOLD_Q_STEP,
   fmtThresholdMm,
 } from '@/lib/domain/points3d';
 import type { PointClass, Points3dData, ThemeName } from '@/lib/domain/points3d';
-import type { ViewPreset } from '@/lib/viz/points3d/orbit';
+import { FOVY, fitToBounds, viewProj } from '@/lib/viz/points3d/orbit';
+import type { Bounds, ViewPreset } from '@/lib/viz/points3d/orbit';
+import { buildScaffold, layoutLabels } from '@/lib/viz/points3d/scaffold';
+import type { PlacedLabel } from '@/lib/viz/points3d/scaffold';
+import { pointSizeRange, pointWorldSizeM, pxPerUnit } from '@/lib/viz/points3d/budget';
+import { createRenderer } from '@/lib/viz/points3d/gl-renderer';
+import type { Renderer } from '@/lib/viz/points3d/gl-renderer';
 import { Button } from '@/components/ui/button';
 import { Spinner } from '@/components/ui/spinner';
+
+const BUFFER_SCALE_MAX = 2;      // 드로잉 버퍼 배율 = min(devicePixelRatio, 2)

 const LEGEND: PointClass[] = ['flat', 'depression', 'protrusion', 'none'];
 const VIEW_PRESETS: { id: ViewPreset; label: string }[] = [
@@ -27,6 +36,33 @@
 const GROUP_NAME = 'text-sm font-bold';
 const NOTE = 'text-xs leading-4 text-cs-text-secondary';

+// 축 라벨을 눈금 위치에서 축 바깥쪽으로 띄운다. 두 축의 0 눈금이 같은 모서리에 있어 축마다 방향을 달리한다.
+// x 눈금은 아래로, y 눈금은 왼쪽으로. 축 이름은 눈금 숫자 한 줄만큼 더 바깥에 둔다.
+const LABEL_TRANSFORM: Record<'x' | 'y', Record<'tick' | 'name', string>> = {
+  x: { tick: 'translate(-50%, 4px)', name: 'translate(-50%, 22px)' },
+  y: { tick: 'translate(calc(-100% - 6px), -50%)', name: 'translate(calc(-100% - 34px), -50%)' },
+};
+
+interface ViewSize { cssW: number; cssH: number; scale: number; bufW: number; bufH: number }
+interface ViewParams { thresholdQ: number; exaggeration: number; themeName: ThemeName }
+
+// effect 안에서 만든 그리기 루프를 effect 밖에서 부르는 창구
+interface Engine {
+  requestDraw(): void;
+}
+
+// 캔버스의 CSS 크기와 드로잉 버퍼 크기. jsdom 처럼 크기가 0 인 환경에서도 0 나눗셈이 없도록 1 이상으로 둔다.
+function measure(canvas: HTMLCanvasElement): ViewSize {
+  const scale = Math.min(window.devicePixelRatio || 1, BUFFER_SCALE_MAX);
+  const cssW = Math.max(1, canvas.clientWidth);
+  const cssH = Math.max(1, canvas.clientHeight);
+  return {
+    cssW, cssH, scale,
+    bufW: Math.max(1, Math.round(cssW * scale)),
+    bufH: Math.max(1, Math.round(cssH * scale)),
+  };
+}
+
 // 로딩 틀. 뷰어 영역과 같은 크기·같은 배경이라 탭에 들어올 때 틀 색이 바뀌는 번쩍임이 없다.
 // 공용 Spinner 의 회전 호가 검정 위에서 보이지 않아 흰 칩 안에 넣는다(칩의 흰색은 그림의 색이 아니라 Spinner 의 바탕).
 export function Points3dLoadingFrame({ theme }: { theme: ThemeName }) {
@@ -41,15 +77,112 @@
   );
 }

-export function Points3dView({ data, defaultThresholdQ, isRegistered }: {
+export function Points3dView({ data, defaultThresholdQ, isRegistered, onError }: {
   data: Points3dData;
   defaultThresholdQ: number;          // 엔진이 준 표시 임계값(0.1mm 정수, 10~300). 5의 배수로 맞추지 않는다
   isRegistered: boolean;              // 정합 병합 스캔인가
   onError(kind: 'webgl' | 'context'): void;
 }) {
+  const canvasRef = useRef<HTMLCanvasElement>(null);
+  const engineRef = useRef<Engine | null>(null);
+  const onErrorRef = useRef(onError);
+  const reportedRef = useRef(false);   // onError 는 마운트 수명에 한 번만 알린다
   const [thresholdQ, setThresholdQ] = useState(defaultThresholdQ);
   const [exaggeration, setExaggeration] = useState<number>(EXAGGERATIONS[0]);
   const [themeName, setThemeName] = useState<ThemeName>('dark');
+  const [labels, setLabels] = useState<PlacedLabel[]>([]);
+  const viewRef = useRef<ViewParams>({ thresholdQ: defaultThresholdQ, exaggeration: EXAGGERATIONS[0], themeName: 'dark' });
+
+  const scaffold = useMemo(() => buildScaffold(data.meta.fit_bounds), [data]);
+
+  useEffect(() => { onErrorRef.current = onError; }, [onError]);
+
+  // 렌더러와 조작·그리기 루프. getContext 는 이 effect 안(createRenderer)에서만 불린다.
+  useEffect(() => {
+    const canvas = canvasRef.current;
+    if (!canvas) return;
+    const report = (kind: 'webgl' | 'context') => {
+      if (reportedRef.current) return;
+      reportedRef.current = true;
+      onErrorRef.current(kind);
+    };
+    const created = createRenderer(canvas, {
+      lost: () => {},
+      restored: () => requestDraw(),
+      unrecoverable: () => {},
+    });
+    if (!created) { report('webgl'); return; }
+    const renderer: Renderer = created;
+
+    const n = data.meta.n_points;
+    const fit = data.meta.fit_bounds;
+    const full: Bounds = { min: [0, 0, 0], max: data.meta.extent_m };
+    const pointWorldM = pointWorldSizeM(data.meta.sample_cell_m);
+    const camera = fitToBounds(fit, 'iso');
+    let size = measure(canvas);
+    renderer.resize(size.bufW, size.bufH);
+    let rafId: number | null = null;
+    let drawWanted = false;
+
+    function ensureFrame() {
+      if (rafId === null) rafId = requestAnimationFrame(frame);
+    }
+    function requestDraw() {
+      drawWanted = true;
+      ensureFrame();
+    }
+    function draw(count: number) {
+      const v = viewRef.current;
+      const vp = viewProj(camera, size.cssW / size.cssH, full);
+      // gl_PointSize 는 드로잉 버퍼 px 이다. 환산 계수에 CSS 높이가 아니라 버퍼 높이를 넘긴다
+      const [minPx, maxPx] = pointSizeRange(renderer.pointSizeLimit(), size.scale);
+      renderer.draw({
+        viewProj: vp, exaggeration: v.exaggeration, thresholdQ: v.thresholdQ,
+        pointWorldM, pxPerUnit: pxPerUnit(size.bufH, FOVY), minPx, maxPx,
+        drawCount: count, theme: POINTS3D_THEME[v.themeName],
+      });
+      // 라벨은 DOM 이다. 같은 프레임에 캔버스와 함께 바뀌도록 곧바로 반영한다(미루면 회전 중에 격자보다 한 프레임 늦는다)
+      flushSync(() => setLabels(layoutLabels(scaffold.ticks, vp, size.cssW, size.cssH)));
+    }
+    // 연속 루프가 아니다. 그리기 요청이 있을 때만 한 번 그린다.
+    function frame() {
+      rafId = null;
+      if (drawWanted) {
+        drawWanted = false;
+        draw(n);
+      }
+    }
+
+    renderer.setData(data, scaffold);
+    requestDraw();
+    // 크기 변화는 ResizeObserver 로 따른다(jsdom 에는 없다). 버퍼 크기를 바꾸면 캔버스가 지워지므로
+    // 다음 프레임을 기다리지 않고 그 자리에서 다시 그린다. 크기가 그대로면 아무것도 하지 않는다
+    let observer: ResizeObserver | null = null;
+    if (typeof ResizeObserver !== 'undefined') {
+      observer = new ResizeObserver(() => {
+        const next = measure(canvas);
+        if (next.bufW === size.bufW && next.bufH === size.bufH && next.cssW === size.cssW && next.cssH === size.cssH) return;
+        size = next;
+        renderer.resize(size.bufW, size.bufH);
+        draw(n);
+      });
+      observer.observe(canvas);
+    }
+    engineRef.current = { requestDraw };
+
+    return () => {
+      engineRef.current = null;
+      observer?.disconnect();
+      if (rafId !== null) cancelAnimationFrame(rafId);
+      renderer.dispose();
+    };
+  }, [data, scaffold]);
+
+  // 임계값·과장 배율·배경은 uniform 만 바꾸고 한 번 다시 그린다
+  useEffect(() => {
+    viewRef.current = { thresholdQ, exaggeration, themeName };
+    engineRef.current?.requestDraw();
+  }, [thresholdQ, exaggeration, themeName]);

   const theme = POINTS3D_THEME[themeName];
   const thresholdText = fmtThresholdMm(thresholdQ);
@@ -64,10 +197,17 @@
       <div data-testid="points3d-viewport"
         className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-cs-divider"
         style={{ backgroundColor: theme.background }}>
-        <canvas role="img" aria-label="3D 점군 뷰어" tabIndex={0}
+        <canvas ref={canvasRef} role="img" aria-label="3D 점군 뷰어" tabIndex={0}
           className="absolute inset-0 h-full w-full touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cs-link" />
         <div data-testid="points3d-labels" className="pointer-events-none absolute inset-0 text-xs leading-4"
-          style={{ color: theme.textSecondary }} />
+          style={{ color: theme.textSecondary }}>
+          {labels.map((l) => (
+            <span key={`${l.axis}:${l.kind}:${l.text}`} className="absolute whitespace-nowrap font-mono tabular-nums"
+              style={{ left: l.x, top: l.y, transform: LABEL_TRANSFORM[l.axis][l.kind] }}>
+              {l.text}
+            </span>
+          ))}
+        </div>
         <ul data-testid="points3d-legend"
           className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1 text-xs leading-4"
           style={{ color: theme.text }}>
```

- [ ] **Step 13: 통과 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  33 passed (33)`.

- [ ] **Step 14: (d) 휠·포인터·키 - 실패하는 테스트 추가**

테스트 파일 끝에 아래를 이어 붙인다(앞에 빈 줄 하나).

```tsx
describe('Points3dView 휠·포인터·키', () => {
  // 변이: 휠을 JSX onWheel 로 옮김(React 는 wheel 을 passive 로 등록해 preventDefault 가 무시된다)
  it('wheel 리스너를 캔버스에 { passive: false } 로 직접 붙이고 언마운트 때 뗀다', () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const { canvas, unmount } = mount();
    const wheelAdds = add.mock.calls.filter((c, i) => c[0] === 'wheel' && add.mock.contexts[i] === canvas);
    expect(wheelAdds).toHaveLength(1);
    expect(wheelAdds[0][2]).toEqual({ passive: false });
    const handler = wheelAdds[0][1];

    unmount();
    const wheelRemoves = remove.mock.calls.filter((c, i) => c[0] === 'wheel' && remove.mock.contexts[i] === canvas);
    expect(wheelRemoves).toHaveLength(1);
    expect(wheelRemoves[0][1]).toBe(handler);
  });

  // 변이: handler 가 handled 를 보지 않고 항상 preventDefault(일반 휠로 페이지가 스크롤되지 않는다)
  it('Ctrl+휠·Cmd+휠은 기본 동작을 막고, 일반 휠은 막지 않으며 다시 그리지도 않는다', () => {
    const { canvas } = mount();
    frame(0);
    expect(ctrlWheel(canvas).defaultPrevented).toBe(true);
    expect(ctrlWheel(canvas, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
    frame(16);
    frame(32);
    expect(rafQueue).toHaveLength(0);
    expect(ctrlWheel(canvas, { ctrlKey: false }).defaultPrevented).toBe(false);
    expect(rafQueue).toHaveLength(0);
  });

  // exp(-120 x 0.001) 배로 다가간다(controls 의 휠 줌 식). 변이: 휠 이벤트를 reducer 에 넘기지 않음
  it('Ctrl+휠이 카메라 줌으로 이어진다', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    frame(0);
    ctrlWheel(canvas, { deltaY: -120 });
    frame(16);
    const base = fitToBounds(FIT, 'iso');
    expectMatrix(lastUniform(rec, 'uViewProj'),
      viewProj({ ...base, distance: base.distance * Math.exp(-0.12) }, 640 / 480, FULL));
  });

  // 오른쪽으로 40px 끌면 방위가 0.2rad 줄어든다(orbit.rotate)
  // 변이: 포인터 좌표의 x·y 전치, down 을 reducer 에 넘기지 않음
  it('드래그가 카메라 회전으로 이어진다', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    frame(0);
    fireEvent.pointerDown(canvas, mouse(100, 100));
    fireEvent.pointerMove(canvas, mouse(140, 100));
    frame(16);
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(rotate(fitToBounds(FIT, 'iso'), 40, 0), 640 / 480, FULL));
  });

  // 팬의 m / px 환산은 CSS 높이(480) 기준이다. 변이: 버퍼 높이(960)를 넘김(절반만 움직인다), shiftKey 를 넘기지 않음(회전한다)
  it('Shift+드래그가 팬으로 이어지고 환산은 CSS 높이 기준이다', () => {
    stubSize(640, 480, 2);
    const { rec, canvas } = mount();
    frame(0);
    fireEvent.pointerDown(canvas, mouse(100, 100, { shiftKey: true }));
    fireEvent.pointerMove(canvas, mouse(140, 130, { shiftKey: true }));
    frame(16);
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(pan(fitToBounds(FIT, 'iso'), 40, 30, 480), 640 / 480, FULL));
  });

  // 변이: 시점 버튼이 각도만 바꾸고 맞춤을 다시 하지 않음(팬·줌이 남는다), 버튼과 프리셋 짝이 어긋남
  it('시점 버튼은 그 프리셋으로 맞춤을 다시 한다(회전·줌 초기화)', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    frame(0);
    fireEvent.pointerDown(canvas, mouse(100, 100));
    fireEvent.pointerMove(canvas, mouse(160, 130));
    fireEvent.pointerUp(canvas, mouse(160, 130));
    ctrlWheel(canvas, { deltaY: 300 });
    frame(16);
    for (const [name, preset] of [['평면', 'top'], ['정면', 'front'], ['등각', 'iso']] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      frame(32);
      expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(fitToBounds(FIT, preset), 640 / 480, FULL));
    }
  });

  // 변이: 화살표 키에서 preventDefault 누락(페이지가 스크롤된다), 수식키가 눌린 키도 가로챔(브라우저 단축키가 죽는다)
  it('화살표 키는 기본 동작을 막고, Ctrl·Cmd·Alt 가 눌린 키와 그 밖의 키는 건드리지 않는다', () => {
    const { canvas } = mount();
    frame(0);
    // fireEvent 는 preventDefault 가 불리면 false 를 돌려준다
    expect(fireEvent.keyDown(canvas, { key: 'ArrowLeft' })).toBe(false);
    expect(rafQueue).toHaveLength(1);
    frame(16);
    frame(32);
    act(() => { vi.advanceTimersByTime(200); });
    frame(48);
    expect(rafQueue).toHaveLength(0);

    expect(fireEvent.keyDown(canvas, { key: 'ArrowLeft', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: '+', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: 'ArrowUp', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: 'ArrowDown', altKey: true })).toBe(true);
    expect(fireEvent.keyDown(canvas, { key: 'a' })).toBe(true);
    expect(rafQueue).toHaveLength(0);        // 카메라가 변하지 않았다
    expect(vi.getTimerCount()).toBe(0);

    expect(fireEvent.keyDown(canvas, { key: '+' })).toBe(true);   // 줌은 하지만 기본 동작은 막지 않는다
    expect(rafQueue).toHaveLength(1);
  });

  // 왼쪽 화살표 = 왼쪽으로 20px 끈 것(방위 +0.1rad). 변이: 키 이벤트를 reducer 에 넘기지 않음
  it('화살표 키가 카메라 회전으로 이어진다', () => {
    stubSize(640, 480, 1);
    const { rec, canvas } = mount();
    frame(0);
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    frame(16);
    expectMatrix(lastUniform(rec, 'uViewProj'), viewProj(rotate(fitToBounds(FIT, 'iso'), -20, 0), 640 / 480, FULL));
  });

  // 변이: contextmenu 를 막지 않음(오른쪽 버튼 드래그 팬에서 메뉴가 뜬다)
  it('contextmenu 를 막는다', () => {
    const { canvas } = mount();
    expect(fireEvent.contextMenu(canvas)).toBe(false);
  });

  // 변이: setPointerCapture 를 방어 없이 부름(jsdom 에 없어 던진다) / 부르지 않음(캔버스 밖에서 놓으면 드래그가 끝나지 않는다)
  it('pointerdown 에서 setPointerCapture 가 있으면 부른다', () => {
    const { canvas } = mount();
    expect(() => fireEvent.pointerDown(canvas, mouse(10, 10))).not.toThrow();
    fireEvent.pointerUp(canvas, mouse(10, 10));
    const capture = vi.fn();
    (canvas as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = capture;
    fireEvent.pointerDown(canvas, mouse(10, 10, { pointerId: 7 }));
    expect(capture).toHaveBeenCalledWith(7);
  });
});
```

- [ ] **Step 15: 실패 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  10 failed | 33 passed (43)`. 새 10건이 전부 실패한다(wheel 리스너 0건, `defaultPrevented` 가 `false`, 행렬이 초기 등각 그대로 등).

- [ ] **Step 16: (d) 구현 - 입력을 reducer 에 연결**

아래 diff 를 적용한다(적용 뒤 328줄). 이 단계가 더하는 것: 카메라를 `ControlState` 로 들고 `input(ev)` 가 `reduceControl` 을 부른다. 카메라가 실제로 변했을 때만 다시 그린다(`sameCamera`. reducer 가 같은 참조를 돌려준다고 가정하지 않고 값으로 비교한다). 네이티브 wheel 리스너, JSX 포인터·키·contextmenu 핸들러, 시점 버튼(`setPreset` 이 `fitToBounds` 를 다시 부른다).

```diff
--- a/dashboard/components/analysis/points3d-view.tsx
+++ b/dashboard/components/analysis/points3d-view.tsx
@@ -5,6 +5,7 @@
 // - 임계값은 점을 어느 색으로 칠할지만 정하는 표시용 값이다. 판정 등급을 만들지 않는다.
 'use client';
 import { useEffect, useMemo, useRef, useState } from 'react';
+import type { KeyboardEvent, PointerEvent } from 'react';
 import { flushSync } from 'react-dom';
 import {
   EXAGGERATIONS, POINTS3D_THEME, POINT_CLASS_LABEL, THRESHOLD_Q_MAX, THRESHOLD_Q_MIN, THRESHOLD_Q_STEP,
@@ -12,10 +13,12 @@
 } from '@/lib/domain/points3d';
 import type { PointClass, Points3dData, ThemeName } from '@/lib/domain/points3d';
 import { FOVY, fitToBounds, viewProj } from '@/lib/viz/points3d/orbit';
-import type { Bounds, ViewPreset } from '@/lib/viz/points3d/orbit';
+import type { Bounds, OrbitState, ViewPreset } from '@/lib/viz/points3d/orbit';
 import { buildScaffold, layoutLabels } from '@/lib/viz/points3d/scaffold';
 import type { PlacedLabel } from '@/lib/viz/points3d/scaffold';
 import { pointSizeRange, pointWorldSizeM, pxPerUnit } from '@/lib/viz/points3d/budget';
+import { initialControlState, reduceControl } from '@/lib/viz/points3d/controls';
+import type { ControlEvent } from '@/lib/viz/points3d/controls';
 import { createRenderer } from '@/lib/viz/points3d/gl-renderer';
 import type { Renderer } from '@/lib/viz/points3d/gl-renderer';
 import { Button } from '@/components/ui/button';
@@ -44,10 +47,13 @@
 };

 interface ViewSize { cssW: number; cssH: number; scale: number; bufW: number; bufH: number }
+interface Cursor { x: number; y: number }
 interface ViewParams { thresholdQ: number; exaggeration: number; themeName: ThemeName }

-// effect 안에서 만든 그리기 루프를 effect 밖에서 부르는 창구
+// effect 안에서 만든 조작·그리기 루프를 JSX 핸들러가 부르는 창구
 interface Engine {
+  input(ev: ControlEvent): boolean;       // reducer 에 넘기고, 기본 동작을 막아야 하면 true
+  setPreset(preset: ViewPreset): void;    // 시점 버튼: 각도를 바꾸고 맞춤을 다시 한다
   requestDraw(): void;
 }

@@ -61,6 +67,16 @@
     bufW: Math.max(1, Math.round(cssW * scale)),
     bufH: Math.max(1, Math.round(cssH * scale)),
   };
+}
+
+function sameCamera(a: OrbitState, b: OrbitState): boolean {
+  return a === b || (a.distance === b.distance && a.azimuth === b.azimuth && a.elevation === b.elevation
+    && a.target[0] === b.target[0] && a.target[1] === b.target[1] && a.target[2] === b.target[2]);
+}
+
+function pointerXY(e: PointerEvent<HTMLCanvasElement>): Cursor {
+  const rect = e.currentTarget.getBoundingClientRect();
+  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
 }

 // 로딩 틀. 뷰어 영역과 같은 크기·같은 배경이라 탭에 들어올 때 틀 색이 바뀌는 번쩍임이 없다.
@@ -118,7 +134,7 @@
     const fit = data.meta.fit_bounds;
     const full: Bounds = { min: [0, 0, 0], max: data.meta.extent_m };
     const pointWorldM = pointWorldSizeM(data.meta.sample_cell_m);
-    const camera = fitToBounds(fit, 'iso');
+    let control = initialControlState(fitToBounds(fit, 'iso'));
     let size = measure(canvas);
     renderer.resize(size.bufW, size.bufH);
     let rafId: number | null = null;
@@ -133,7 +149,7 @@
     }
     function draw(count: number) {
       const v = viewRef.current;
-      const vp = viewProj(camera, size.cssW / size.cssH, full);
+      const vp = viewProj(control.camera, size.cssW / size.cssH, full);
       // gl_PointSize 는 드로잉 버퍼 px 이다. 환산 계수에 CSS 높이가 아니라 버퍼 높이를 넘긴다
       const [minPx, maxPx] = pointSizeRange(renderer.pointSizeLimit(), size.scale);
       renderer.draw({
@@ -152,6 +168,24 @@
         draw(n);
       }
     }
+    function input(ev: ControlEvent): boolean {
+      const before = control.camera;
+      const { state, handled } = reduceControl(control, ev, size.cssH);
+      control = state;
+      if (!sameCamera(before, state.camera)) requestDraw();
+      return handled;
+    }
+    function setPreset(preset: ViewPreset) {
+      control = { ...control, camera: fitToBounds(fit, preset) };
+      requestDraw();
+    }
+
+    // 휠은 네이티브 리스너로 붙인다. React 는 wheel 을 루트에 passive 로 등록해서 JSX 핸들러의 preventDefault 가 무시된다.
+    // reducer 가 handled 를 돌려준 경우(Ctrl/Cmd+휠)에만 기본 동작을 막는다. 일반 휠은 페이지 스크롤에 맡긴다.
+    const onWheel = (e: WheelEvent) => {
+      if (input({ type: 'wheel', deltaY: e.deltaY, ctrlKey: e.ctrlKey, metaKey: e.metaKey })) e.preventDefault();
+    };
+    canvas.addEventListener('wheel', onWheel, { passive: false });

     renderer.setData(data, scaffold);
     requestDraw();
@@ -168,11 +202,12 @@
       });
       observer.observe(canvas);
     }
-    engineRef.current = { requestDraw };
+    engineRef.current = { input, setPreset, requestDraw };

     return () => {
       engineRef.current = null;
       observer?.disconnect();
+      canvas.removeEventListener('wheel', onWheel);
       if (rafId !== null) cancelAnimationFrame(rafId);
       renderer.dispose();
     };
@@ -183,6 +218,25 @@
     viewRef.current = { thresholdQ, exaggeration, themeName };
     engineRef.current?.requestDraw();
   }, [thresholdQ, exaggeration, themeName]);
+
+  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
+    e.currentTarget.setPointerCapture?.(e.pointerId);   // jsdom 에는 없다
+    const p = pointerXY(e);
+    engineRef.current?.input({ type: 'down', pointerId: e.pointerId, x: p.x, y: p.y, button: e.button, shiftKey: e.shiftKey });
+  }
+  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
+    const p = pointerXY(e);
+    engineRef.current?.input({ type: 'move', pointerId: e.pointerId, x: p.x, y: p.y, button: e.button, shiftKey: e.shiftKey });
+  }
+  function onPointerEnd(e: PointerEvent<HTMLCanvasElement>, type: 'up' | 'cancel') {
+    const p = pointerXY(e);
+    engineRef.current?.input({ type, pointerId: e.pointerId, x: p.x, y: p.y, button: e.button, shiftKey: e.shiftKey });
+  }
+  function onKeyDown(e: KeyboardEvent<HTMLCanvasElement>) {
+    // 브라우저 단축키(예: Ctrl 과 + 의 페이지 확대)를 가로채지 않는다
+    if (e.ctrlKey || e.metaKey || e.altKey) return;
+    if (engineRef.current?.input({ type: 'key', key: e.key })) e.preventDefault();
+  }

   const theme = POINTS3D_THEME[themeName];
   const thresholdText = fmtThresholdMm(thresholdQ);
@@ -198,7 +252,13 @@
         className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-cs-divider"
         style={{ backgroundColor: theme.background }}>
         <canvas ref={canvasRef} role="img" aria-label="3D 점군 뷰어" tabIndex={0}
-          className="absolute inset-0 h-full w-full touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cs-link" />
+          className="absolute inset-0 h-full w-full touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cs-link"
+          onPointerDown={onPointerDown}
+          onPointerMove={onPointerMove}
+          onPointerUp={(e) => onPointerEnd(e, 'up')}
+          onPointerCancel={(e) => onPointerEnd(e, 'cancel')}
+          onKeyDown={onKeyDown}
+          onContextMenu={(e) => e.preventDefault()} />
         <div data-testid="points3d-labels" className="pointer-events-none absolute inset-0 text-xs leading-4"
           style={{ color: theme.textSecondary }}>
           {labels.map((l) => (
@@ -230,7 +290,7 @@
         <div className={GROUP}>
           <span className={GROUP_NAME}>시점</span>
           {VIEW_PRESETS.map((p) => (
-            <Button key={p.id}>{p.label}</Button>
+            <Button key={p.id} onClick={() => engineRef.current?.setPreset(p.id)}>{p.label}</Button>
           ))}
         </div>
         <div className={GROUP}>
```

- [ ] **Step 17: 통과 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  43 passed (43)`.

- [ ] **Step 18: (e) LOD - 실패하는 테스트 추가**

테스트 파일 끝에 아래를 이어 붙인다(앞에 빈 줄 하나). 점 20만 개 합성 데이터를 쓴다(`scatter(200_000)`).

```tsx
describe('Points3dView LOD', () => {
  const BIG = scatter(200_000);   // 조작 중 시작 점 수 = min(200,000, 150,000) = 150,000

  function mountBig() {
    stubSize(640, 480, 1);
    const m = mount({ data: BIG });
    frame(0);                     // 첫 그리기: 조작 중이 아니므로 n 개 전부
    expect(m.rec.pointDraws()).toEqual([200_000]);
    return m;
  }
  let moveX = 100;
  const drag = (canvas: HTMLCanvasElement) => { moveX += 10; fireEvent.pointerMove(canvas, mouse(moveX, 100)); };
  beforeEach(() => { moveX = 100; });

  // 변이: 조작 중에도 n 개 전부 그림, HUD 의 점 수를 그리는 점 수로 바꿈
  it('드래그 중에는 앞 150,000 점만 그리고 HUD 의 점 수는 n 그대로다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    expect(lastPointDraw(rec)).toBe(150_000);
    expect(screen.getByTestId('points3d-hud').textContent).toBe('축 비율 1:1 · 임계값 ±7 mm · 200,000점');
  });

  // 변이: 조작 종료 뒤의 전체 그리기 제거(LOD 표본만 화면에 남는다)
  it('pointerup 뒤 마지막 그리기는 n 개 전부이고 그 뒤 rAF 가 끊긴다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    fireEvent.pointerUp(canvas, mouse(110, 100));
    frame(1016);
    expect(rec.pointDraws()).toEqual([200_000, 150_000, 200_000]);
    expect(rafQueue).toHaveLength(0);         // 전체 그리기 뒤에는 측정용 콜백을 예약하지 않는다
  });

  // 변이: pointercancel 을 조작 종료로 보지 않음
  it('pointercancel 도 조작 종료다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    fireEvent.pointerCancel(canvas, mouse(110, 100));
    frame(1016);
    expect(lastPointDraw(rec)).toBe(200_000);
  });

  // 변이: 휠 뒤 전체 그리기를 하지 않음, 200ms 를 기다리지 않음, 입력이 이어져도 타이머를 다시 세지 않음
  it('Ctrl+휠: 조작 중 LOD 로 그리고, 마지막 입력 뒤 200ms 가 지나면 n 개 전부를 그린다', () => {
    const { rec, canvas } = mountBig();
    ctrlWheel(canvas);
    frame(1000);
    expect(lastPointDraw(rec)).toBe(150_000);
    frame(1025);                              // 측정용 콜백(25ms: 그대로). 그릴 것이 없어 그리지 않는다
    expect(rec.pointDraws()).toEqual([200_000, 150_000]);
    expect(rafQueue).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(150); });
    ctrlWheel(canvas);                        // 입력이 이어지면 200ms 를 다시 센다
    frame(1200);
    frame(1225);
    act(() => { vi.advanceTimersByTime(199); });
    expect(rafQueue).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(rafQueue).toHaveLength(1);
    frame(1500);
    expect(rec.pointDraws()).toEqual([200_000, 150_000, 150_000, 200_000]);
    expect(rafQueue).toHaveLength(0);
  });

  it('키 조작(+)도 200ms 뒤 n 개 전부를 그린다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.keyDown(canvas, { key: '+' });
    frame(1000);
    expect(lastPointDraw(rec)).toBe(150_000);
    frame(1025);
    act(() => { vi.advanceTimersByTime(200); });
    frame(1300);
    expect(lastPointDraw(rec)).toBe(200_000);
  });

  // 150,000 x 0.7 = 105,000. 변이: 측정 결과를 적용하지 않음, 측정용 콜백이 요청 없이도 다시 그림(연속 루프)
  it('그린 콜백과 다음 rAF 사이가 40ms 면 다음 조작 그리기의 점 수가 x0.7 로 준다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);                              // 150,000 점을 그리고 측정용 콜백을 예약한다
    expect(rafQueue).toHaveLength(1);
    frame(1040);                              // frameMs = 40 > 33
    expect(rec.pointDraws()).toEqual([200_000, 150_000]);   // 측정용 콜백은 그리지 않는다
    expect(rafQueue).toHaveLength(0);         // 조작이 멈추면 한 프레임 뒤에 rAF 가 끊긴다
    drag(canvas);
    frame(1100);
    expect(lastPointDraw(rec)).toBe(105_000);
  });

  // 150,000 x 1.25 = 187,500
  it('사이가 10ms 면 x1.25 로 는다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    frame(1010);
    drag(canvas);
    frame(1100);
    expect(lastPointDraw(rec)).toBe(187_500);
  });

  // 변이: frameMs 를 입력 이벤트(또는 그리기) 사이의 간격으로 잼. 천천히 끌기만 해도 점 수가 준다
  it('입력 사이를 500ms 띄우는 것만으로는 점 수가 줄지 않는다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    let t = 1000;
    for (let i = 0; i < 3; i++) {
      drag(canvas);
      frame(t);                               // 그린다
      frame(t + 25);                          // 측정용 콜백: 25ms 는 20~33 사이라 그대로
      t += 500;                               // 다음 입력까지 500ms
    }
    expect(rec.pointDraws()).toEqual([200_000, 150_000, 150_000, 150_000]);
  });

  // 변이: 조작이 새로 시작될 때 점 수를 시작 값으로 되돌림(느린 기기에서 조작마다 처음 몇 프레임이 다시 버벅인다)
  it('새 조작은 직전 조작의 마지막 점 수를 잇는다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    frame(1040);                              // 105,000 으로 준다
    fireEvent.pointerUp(canvas, mouse(110, 100));
    frame(1100);
    expect(lastPointDraw(rec)).toBe(200_000);

    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(2000);
    expect(lastPointDraw(rec)).toBe(105_000);
  });

  // 측정용 콜백 때 그리기 요청이 있으면 그 콜백이 그리고 다시 측정용 콜백을 예약한다
  // 150,000 -> x0.7 = 105,000 -> x0.7 = 73,500
  it('연속 드래그: 측정용 콜백이 조정한 점 수로 곧바로 그린다', () => {
    const { rec, canvas } = mountBig();
    fireEvent.pointerDown(canvas, mouse(100, 100));
    drag(canvas);
    frame(1000);
    drag(canvas);
    frame(1040);
    drag(canvas);
    frame(1080);
    expect(rec.pointDraws()).toEqual([200_000, 150_000, 105_000, 73_500]);
    expect(rafQueue).toHaveLength(1);
  });

  // 변이: 임계값·과장 변경을 조작으로 취급해 LOD 로 그림
  it('슬라이더·과장 변경은 n 개 전부로 한 번 그린다', () => {
    const { rec } = mountBig();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '20' } });
    frame(1000);
    fireEvent.click(screen.getByRole('button', { name: '×100' }));
    frame(1016);
    expect(rec.pointDraws()).toEqual([200_000, 200_000, 200_000]);
    expect(rafQueue).toHaveLength(0);
  });

  // 변이: cleanup 에서 조작 종료 타이머를 지우지 않음(언마운트 뒤에 그리기를 예약한다)
  it('언마운트하면 조작 종료 타이머와 예약된 rAF 를 지운다', () => {
    const { canvas, unmount } = mountBig();
    ctrlWheel(canvas);
    expect(rafQueue).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(rafQueue).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 19: 실패 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  10 failed | 45 passed (55)`. 새 12건 가운데 10건이 실패한다(`expected 200000 to be 150000` 등. 아직 조작 중에도 n 개 전부를 그린다). `pointercancel 도 조작 종료다` 와 `슬라이더·과장 변경은 n 개 전부로 한 번 그린다` 는 지금도 통과한다(항상 전부 그리므로). 이 둘은 다음 단계의 구현이 이 동작을 깨지 않는지 지킨다.

- [ ] **Step 20: (e) 구현 - 조작 중 점 수 조정과 조작 종료 판정**

아래 diff 를 적용한다(적용 뒤 356줄). 이 단계가 더하는 것: `dragCountRef`, 조작 중 판정 `interacting()`(포인터가 눌려 있거나 200ms 타이머가 살아 있다), `frame(ts)` 의 측정용 콜백, 휠·키의 200ms 타이머 `armIdle`, pointerup·pointercancel 뒤의 전체 그리기, cleanup 의 타이머 해제.

```diff
--- a/dashboard/components/analysis/points3d-view.tsx
+++ b/dashboard/components/analysis/points3d-view.tsx
@@ -16,8 +16,10 @@
 import type { Bounds, OrbitState, ViewPreset } from '@/lib/viz/points3d/orbit';
 import { buildScaffold, layoutLabels } from '@/lib/viz/points3d/scaffold';
 import type { PlacedLabel } from '@/lib/viz/points3d/scaffold';
-import { pointSizeRange, pointWorldSizeM, pxPerUnit } from '@/lib/viz/points3d/budget';
-import { initialControlState, reduceControl } from '@/lib/viz/points3d/controls';
+import {
+  initialDragCount, nextDragCount, pointSizeRange, pointWorldSizeM, pxPerUnit,
+} from '@/lib/viz/points3d/budget';
+import { initialControlState, isGesturing, reduceControl } from '@/lib/viz/points3d/controls';
 import type { ControlEvent } from '@/lib/viz/points3d/controls';
 import { createRenderer } from '@/lib/viz/points3d/gl-renderer';
 import type { Renderer } from '@/lib/viz/points3d/gl-renderer';
@@ -25,6 +27,7 @@
 import { Spinner } from '@/components/ui/spinner';

 const BUFFER_SCALE_MAX = 2;      // 드로잉 버퍼 배율 = min(devicePixelRatio, 2)
+const INPUT_IDLE_MS = 200;       // 휠·키는 마지막 입력 뒤 이 시간이 지나면 조작이 끝난 것으로 본다

 const LEGEND: PointClass[] = ['flat', 'depression', 'protrusion', 'none'];
 const VIEW_PRESETS: { id: ViewPreset; label: string }[] = [
@@ -103,6 +106,7 @@
   const engineRef = useRef<Engine | null>(null);
   const onErrorRef = useRef(onError);
   const reportedRef = useRef(false);   // onError 는 마운트 수명에 한 번만 알린다
+  const dragCountRef = useRef(0);      // 조작 중 그릴 점 수(LOD). 조작이 새로 시작돼도 되돌리지 않는다
   const [thresholdQ, setThresholdQ] = useState(defaultThresholdQ);
   const [exaggeration, setExaggeration] = useState<number>(EXAGGERATIONS[0]);
   const [themeName, setThemeName] = useState<ThemeName>('dark');
@@ -139,7 +143,13 @@
     renderer.resize(size.bufW, size.bufH);
     let rafId: number | null = null;
     let drawWanted = false;
-
+    let measureFrom: number | null = null;   // 조작 중에 그린 콜백의 타임스탬프. 바로 다음 콜백이 frameMs 를 잰다
+    let idleTimer: ReturnType<typeof setTimeout> | null = null;
+    dragCountRef.current = initialDragCount(n);
+
+    function interacting(): boolean {
+      return isGesturing(control) || idleTimer !== null;
+    }
     function ensureFrame() {
       if (rafId === null) rafId = requestAnimationFrame(frame);
     }
@@ -160,19 +170,36 @@
       // 라벨은 DOM 이다. 같은 프레임에 캔버스와 함께 바뀌도록 곧바로 반영한다(미루면 회전 중에 격자보다 한 프레임 늦는다)
       flushSync(() => setLabels(layoutLabels(scaffold.ticks, vp, size.cssW, size.cssH)));
     }
-    // 연속 루프가 아니다. 그리기 요청이 있을 때만 한 번 그린다.
-    function frame() {
+    // 연속 루프가 아니다. 그리기 요청이 있을 때만 한 번 돌고,
+    // 조작 중에 그렸을 때만 다음 프레임 간격을 재려고 콜백을 하나 더 예약한다(측정용 콜백).
+    function frame(ts: number) {
       rafId = null;
+      if (measureFrom !== null) {
+        // frameMs = 조작 중에 그린 콜백과 바로 다음 콜백의 타임스탬프 차. 입력 이벤트 사이의 간격이 아니다
+        dragCountRef.current = nextDragCount(dragCountRef.current, n, ts - measureFrom);
+        measureFrom = null;
+      }
+      const busy = interacting();
       if (drawWanted) {
         drawWanted = false;
-        draw(n);
+        draw(busy ? dragCountRef.current : n);   // 조작이 끝났으면 n 개 전부
+        if (busy) { measureFrom = ts; ensureFrame(); }
       }
+    }
+    function armIdle() {
+      if (idleTimer !== null) clearTimeout(idleTimer);
+      idleTimer = setTimeout(() => { idleTimer = null; requestDraw(); }, INPUT_IDLE_MS);
     }
     function input(ev: ControlEvent): boolean {
       const before = control.camera;
       const { state, handled } = reduceControl(control, ev, size.cssH);
       control = state;
-      if (!sameCamera(before, state.camera)) requestDraw();
+      if (!sameCamera(before, state.camera)) {
+        if (ev.type === 'wheel' || ev.type === 'key') armIdle();
+        requestDraw();
+      }
+      // pointerup / pointercancel: 조작이 끝났으면 다음 프레임이 전체 점을 그린다
+      if (ev.type === 'up' || ev.type === 'cancel') requestDraw();
       return handled;
     }
     function setPreset(preset: ViewPreset) {
@@ -198,7 +225,7 @@
         if (next.bufW === size.bufW && next.bufH === size.bufH && next.cssW === size.cssW && next.cssH === size.cssH) return;
         size = next;
         renderer.resize(size.bufW, size.bufH);
-        draw(n);
+        draw(interacting() ? dragCountRef.current : n);
       });
       observer.observe(canvas);
     }
@@ -209,6 +236,7 @@
       observer?.disconnect();
       canvas.removeEventListener('wheel', onWheel);
       if (rafId !== null) cancelAnimationFrame(rafId);
+      if (idleTimer !== null) clearTimeout(idleTimer);
       renderer.dispose();
     };
   }, [data, scaffold]);
```

- [ ] **Step 21: 통과 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  55 passed (55)`.

- [ ] **Step 22: (f) 읽기 창 - 실패하는 테스트 추가**

테스트 파일 끝에 아래를 이어 붙인다(앞에 빈 줄 하나).

```tsx
describe('Points3dView 읽기 창', () => {
  // 캔버스가 뷰포트의 (100, 50) 에 있다고 스텁한다. 커서 좌표에서 이 원점을 빼야 캔버스 안 좌표가 된다
  const RECT = { left: 100, top: 50, width: 640, height: 480, right: 740, bottom: 530, x: 100, y: 50, toJSON: () => ({}) };

  function mountReadout(over: Partial<Props> = {}) {
    stubSize(640, 480, 1);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(RECT as DOMRect);
    const m = mount({ data: READOUT_DATA, ...over });
    frame(0);
    return m;
  }
  /** 등각 시점에서 월드 점의 화면 위치(캔버스 왼쪽 위 기준 CSS px) */
  const isoAt = (p: [number, number, number]) => project(
    viewProj(fitToBounds(READOUT_FIT, 'iso'), 640 / 480, FULL), p, 640, 480)!;
  /** 캔버스 안 좌표 -> 포인터 이벤트 좌표(clientX·clientY 는 뷰포트 기준이라 캔버스 원점을 더한다) */
  const at = (p: { x: number; y: number }, more: object = {}) => mouse(RECT.left + p.x, RECT.top + p.y, more);
  const lines = () => Array.from(screen.getByTestId('points3d-readout').children).map((c) => c.textContent);

  // P0: 절대 좌표 = origin + local = (254012.5 + 0.8, 4180045.25 + 1.0, 31.5 + 0), dev 32 -> +3.2mm, |32| <= 70 -> FLAT
  // 변이: 커서 좌표에서 캔버스 원점을 빼지 않음(100px·50px 어긋나 점을 못 찾는다), 프레임을 기다리지 않고 곧바로 찾음
  it('마우스가 점 위에 오면 다음 프레임에 readoutLines 의 줄을 그린다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at(p));
    expect(screen.queryByTestId('points3d-readout')).toBeNull();   // 한 프레임에 한 번: rAF 에서 찾는다
    frame(16);
    expect(lines()).toEqual(['X 254013.300 m', 'Y 4180046.250 m', 'Z 31.500 m', '편차 +3.2 mm', 'FLAT']);
    const box = screen.getByTestId('points3d-readout');
    for (const cls of ['font-mono', 'tabular-nums', 'pointer-events-none']) expect(box.className).toContain(cls);
    // 커서 오른쪽 아래 12px
    expect(parseFloat(box.style.left)).toBeCloseTo(p.x + 12, 3);
    expect(parseFloat(box.style.top)).toBeCloseTo(p.y + 12, 3);
    // 배경 #000000 알파 0.8, 테두리는 축선과 같은 #ffffff 알파 0.28, 글자 #f2f4f7
    expect(box).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.8)', borderColor: 'rgba(255, 255, 255, 0.28)', color: '#f2f4f7',
    });
    expect(rafQueue).toHaveLength(0);
  });

  // P1: (254012.5 + 3.2, 4180045.25 + 2.0, 31.5), 센티널 -> 4줄
  it('편차 없는 점은 4줄이고 마지막 줄이 "편차 없음" 이다', () => {
    const { canvas } = mountReadout();
    fireEvent.pointerMove(canvas, at(isoAt(P1)));
    frame(16);
    expect(lines()).toEqual(['X 254015.700 m', 'Y 4180047.250 m', 'Z 31.500 m', '편차 없음']);
  });

  // 변이: 읽기 창 반경 밖에서도 가장 가까운 점을 띄움
  it('12px 보다 먼 곳에서는 띄우지 않는다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at({ x: p.x + 20, y: p.y }));
    frame(16);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
  });

  // 변이: 터치 입력에서도 읽기 창 표시
  it('터치 입력에서는 띄우지 않고, 펜 입력에서는 띄운다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at(p, { pointerType: 'touch' }));
    frame(16);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
    fireEvent.pointerMove(canvas, at(p, { pointerType: 'pen' }));
    frame(32);
    expect(screen.getByTestId('points3d-readout')).toBeInTheDocument();
  });

  // 변이: 드래그 중에도 점을 찾음, pointerdown 에서 숨기지 않음
  it('드래그 중에는 띄우지 않고, 보이던 읽기 창은 pointerdown 에서 숨긴다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at(p));
    frame(16);
    expect(screen.getByTestId('points3d-readout')).toBeInTheDocument();
    fireEvent.pointerDown(canvas, at(p));
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
    fireEvent.pointerMove(canvas, at(p));     // 이동량 0: 카메라는 그대로, 커서는 점 위
    frame(32);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
  });

  // 변이: 커서가 영역을 벗어나도 읽기 창이 남음
  it('pointerleave 에서 숨기고, 예약된 탐색도 취소한다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at(p));
    frame(16);
    fireEvent.pointerLeave(canvas);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
    fireEvent.pointerMove(canvas, at(p));
    fireEvent.pointerLeave(canvas);
    frame(32);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
  });

  // dev 32: 임계값 70 에서는 FLAT, 30 에서는 32 > 30 이라 PROTRUSION
  // 변이: 읽기 창 분류를 기본 임계값으로 고정
  it('분류 이름은 현재 임계값 기준이다', () => {
    const { canvas } = mountReadout();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } });
    frame(8);
    fireEvent.pointerMove(canvas, at(isoAt(P0)));
    frame(16);
    expect(lines()).toEqual(['X 254013.300 m', 'Y 4180046.250 m', 'Z 31.500 m', '편차 +3.2 mm', 'PROTRUSION']);
  });

  // 평면 시점: 화면 오른쪽이 +x, 위가 +y. fit 중심 (2, 1.5) 가 화면 중앙 (320, 240) 이다.
  //   P1 (3.2, 2.0): 중앙에서 오른쪽 위 -> x 가 640 - 12 - 160 = 468 을 넘는다 -> 가로만 뒤집는다
  //   P2 (2.0, 0.6): 중앙 아래 -> y 가 480 - 12 - 100 = 368 을 넘는다 -> 세로만 뒤집는다
  // 변이: 뒤집기 제거(읽기 창이 영역 밖으로 잘린다), 가로·세로 판정 전치
  it('영역을 넘으면 넘는 축만 반대쪽으로 뒤집는다', () => {
    const { canvas } = mountReadout();
    fireEvent.click(screen.getByRole('button', { name: '평면' }));
    frame(8);
    const vp = viewProj(fitToBounds(READOUT_FIT, 'top'), 640 / 480, FULL);

    const p1 = project(vp, P1, 640, 480)!;
    expect(p1.x).toBeGreaterThan(468);
    expect(p1.y).toBeLessThan(368);
    fireEvent.pointerMove(canvas, at(p1));
    frame(16);
    let box = screen.getByTestId('points3d-readout');
    expect(box.style.left).toBe('');
    expect(parseFloat(box.style.right)).toBeCloseTo(640 - p1.x + 12, 3);
    expect(parseFloat(box.style.top)).toBeCloseTo(p1.y + 12, 3);
    expect(box.style.bottom).toBe('');

    const p2 = project(vp, P2, 640, 480)!;
    expect(p2.x).toBeLessThan(468);
    expect(p2.y).toBeGreaterThan(368);
    fireEvent.pointerMove(canvas, at(p2));
    frame(32);
    box = screen.getByTestId('points3d-readout');
    expect(lines()[3]).toBe('편차 −10.5 mm');
    expect(parseFloat(box.style.left)).toBeCloseTo(p2.x + 12, 3);
    expect(box.style.right).toBe('');
    expect(box.style.top).toBe('');
    expect(parseFloat(box.style.bottom)).toBeCloseTo(480 - p2.y + 12, 3);
  });

  // 변이: 휠 줌 뒤 옛 점의 읽기 창이 남음(커서 아래의 점이 바뀌었는데 내용이 그대로다)
  it('휠 줌이 시작되면 숨기고, 조작이 끝난 뒤의 그리기에서 같은 커서로 다시 찾는다', () => {
    const { canvas } = mountReadout();
    const p = isoAt(P0);
    fireEvent.pointerMove(canvas, at(p));
    frame(16);
    expect(screen.getByTestId('points3d-readout')).toBeInTheDocument();
    ctrlWheel(canvas, { deltaY: -400 });      // 다가간다: P0 이 커서에서 멀어진다
    expect(screen.queryByTestId('points3d-readout')).toBeNull();
    frame(32);
    frame(57);
    act(() => { vi.advanceTimersByTime(200); });
    frame(300);
    expect(screen.queryByTestId('points3d-readout')).toBeNull();   // 커서 아래에 이제 점이 없다

    // 시점을 되돌리면(등각 버튼) 같은 커서 위치에 P0 이 다시 온다
    fireEvent.click(screen.getByRole('button', { name: '등각' }));
    frame(316);
    expect(lines()[3]).toBe('편차 +3.2 mm');
  });

  // 밝은 배경: 읽기 창 배경 #ffffff 알파 0.9, 테두리 #000716 알파 0.28, 글자 #000716
  it('밝은 배경에서는 읽기 창 색도 light 표를 쓴다', () => {
    const { canvas } = mountReadout();
    fireEvent.click(screen.getByRole('button', { name: '밝은 배경' }));
    frame(8);
    fireEvent.pointerMove(canvas, at(isoAt(P0)));
    frame(16);
    expect(screen.getByTestId('points3d-readout')).toHaveStyle({
      backgroundColor: 'rgba(255, 255, 255, 0.9)', borderColor: 'rgba(0, 7, 22, 0.28)', color: '#000716',
    });
  });
});
```

- [ ] **Step 23: 실패 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  8 failed | 57 passed (65)`. 새 10건 가운데 8건이 `Unable to find an element by: [data-testid="points3d-readout"]` 로 실패한다. `12px 보다 먼 곳에서는 띄우지 않는다` 와 `pointerleave 에서 숨기고, 예약된 탐색도 취소한다` 는 읽기 창이 없다는 단언뿐이라 지금도 통과한다.

- [ ] **Step 24: (f) 구현 - 커서 아래의 점 찾기와 읽기 창**

아래 diff 를 적용한다(적용 뒤 421줄). 이 단계가 더하는 것: `hover(cursor)`(마우스·펜의 커서 위치를 받고 다음 프레임의 탐색을 예약한다), `pick()`(`pickNearest` 를 마지막으로 그린 행렬로 부른다), `frame` 끝의 탐색(조작 중이 아닐 때만, 한 프레임에 한 번), 카메라가 바뀌거나 포인터가 눌리면 숨기기, 읽기 창 JSX 와 위치 계산 `readoutPosition`, 색 문자열 `rgba`.

```diff
--- a/dashboard/components/analysis/points3d-view.tsx
+++ b/dashboard/components/analysis/points3d-view.tsx
@@ -9,7 +9,7 @@
 import { flushSync } from 'react-dom';
 import {
   EXAGGERATIONS, POINTS3D_THEME, POINT_CLASS_LABEL, THRESHOLD_Q_MAX, THRESHOLD_Q_MIN, THRESHOLD_Q_STEP,
-  fmtThresholdMm,
+  fmtThresholdMm, hexToRgb01, readoutLines,
 } from '@/lib/domain/points3d';
 import type { PointClass, Points3dData, ThemeName } from '@/lib/domain/points3d';
 import { FOVY, fitToBounds, viewProj } from '@/lib/viz/points3d/orbit';
@@ -19,6 +19,7 @@
 import {
   initialDragCount, nextDragCount, pointSizeRange, pointWorldSizeM, pxPerUnit,
 } from '@/lib/viz/points3d/budget';
+import { pickNearest } from '@/lib/viz/points3d/pick';
 import { initialControlState, isGesturing, reduceControl } from '@/lib/viz/points3d/controls';
 import type { ControlEvent } from '@/lib/viz/points3d/controls';
 import { createRenderer } from '@/lib/viz/points3d/gl-renderer';
@@ -28,6 +29,9 @@

 const BUFFER_SCALE_MAX = 2;      // 드로잉 버퍼 배율 = min(devicePixelRatio, 2)
 const INPUT_IDLE_MS = 200;       // 휠·키는 마지막 입력 뒤 이 시간이 지나면 조작이 끝난 것으로 본다
+const READOUT_OFFSET_PX = 12;    // 읽기 창을 커서에서 띄우는 거리(CSS px)
+const READOUT_BOX_W_PX = 160;    // 읽기 창의 어림 크기. 영역을 넘는지 판정해 반대쪽으로 뒤집는 데만 쓴다
+const READOUT_BOX_H_PX = 100;

 const LEGEND: PointClass[] = ['flat', 'depression', 'protrusion', 'none'];
 const VIEW_PRESETS: { id: ViewPreset; label: string }[] = [
@@ -51,11 +55,13 @@

 interface ViewSize { cssW: number; cssH: number; scale: number; bufW: number; bufH: number }
 interface Cursor { x: number; y: number }
+interface Readout { index: number; x: number; y: number; cssW: number; cssH: number }
 interface ViewParams { thresholdQ: number; exaggeration: number; themeName: ThemeName }

 // effect 안에서 만든 조작·그리기 루프를 JSX 핸들러가 부르는 창구
 interface Engine {
   input(ev: ControlEvent): boolean;       // reducer 에 넘기고, 기본 동작을 막아야 하면 true
+  hover(cursor: Cursor | null): void;     // 읽기 창용 커서 위치(null = 숨김)
   setPreset(preset: ViewPreset): void;    // 시점 버튼: 각도를 바꾸고 맞춤을 다시 한다
   requestDraw(): void;
 }
@@ -75,6 +81,21 @@
 function sameCamera(a: OrbitState, b: OrbitState): boolean {
   return a === b || (a.distance === b.distance && a.azimuth === b.azimuth && a.elevation === b.elevation
     && a.target[0] === b.target[0] && a.target[1] === b.target[1] && a.target[2] === b.target[2]);
+}
+
+function rgba(hex: string, alpha: number): string {
+  const [r, g, b] = hexToRgb01(hex);
+  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
+}
+
+// 읽기 창 위치: 커서 오른쪽 아래. 영역을 넘으면 그 축만 반대쪽에 붙인다.
+function readoutPosition(r: Readout): { left?: number; right?: number; top?: number; bottom?: number } {
+  const flipX = r.x + READOUT_OFFSET_PX + READOUT_BOX_W_PX > r.cssW;
+  const flipY = r.y + READOUT_OFFSET_PX + READOUT_BOX_H_PX > r.cssH;
+  return {
+    ...(flipX ? { right: r.cssW - r.x + READOUT_OFFSET_PX } : { left: r.x + READOUT_OFFSET_PX }),
+    ...(flipY ? { bottom: r.cssH - r.y + READOUT_OFFSET_PX } : { top: r.y + READOUT_OFFSET_PX }),
+  };
 }

 function pointerXY(e: PointerEvent<HTMLCanvasElement>): Cursor {
@@ -111,6 +132,7 @@
   const [exaggeration, setExaggeration] = useState<number>(EXAGGERATIONS[0]);
   const [themeName, setThemeName] = useState<ThemeName>('dark');
   const [labels, setLabels] = useState<PlacedLabel[]>([]);
+  const [readout, setReadout] = useState<Readout | null>(null);
   const viewRef = useRef<ViewParams>({ thresholdQ: defaultThresholdQ, exaggeration: EXAGGERATIONS[0], themeName: 'dark' });

   const scaffold = useMemo(() => buildScaffold(data.meta.fit_bounds), [data]);
@@ -141,8 +163,11 @@
     let control = initialControlState(fitToBounds(fit, 'iso'));
     let size = measure(canvas);
     renderer.resize(size.bufW, size.bufH);
+    let lastViewProj: Float32Array | null = null;
+    let cursor: Cursor | null = null;
     let rafId: number | null = null;
     let drawWanted = false;
+    let pickWanted = false;
     let measureFrom: number | null = null;   // 조작 중에 그린 콜백의 타임스탬프. 바로 다음 콜백이 frameMs 를 잰다
     let idleTimer: ReturnType<typeof setTimeout> | null = null;
     dragCountRef.current = initialDragCount(n);
@@ -167,10 +192,17 @@
         pointWorldM, pxPerUnit: pxPerUnit(size.bufH, FOVY), minPx, maxPx,
         drawCount: count, theme: POINTS3D_THEME[v.themeName],
       });
+      lastViewProj = vp;
       // 라벨은 DOM 이다. 같은 프레임에 캔버스와 함께 바뀌도록 곧바로 반영한다(미루면 회전 중에 격자보다 한 프레임 늦는다)
       flushSync(() => setLabels(layoutLabels(scaffold.ticks, vp, size.cssW, size.cssH)));
     }
-    // 연속 루프가 아니다. 그리기 요청이 있을 때만 한 번 돌고,
+    function pick() {
+      if (cursor === null || lastViewProj === null) return;
+      const i = pickNearest(data, lastViewProj, viewRef.current.exaggeration,
+        size.cssW, size.cssH, cursor.x, cursor.y);
+      setReadout(i === null ? null : { index: i, x: cursor.x, y: cursor.y, cssW: size.cssW, cssH: size.cssH });
+    }
+    // 연속 루프가 아니다. 그리기·읽기 창 요청이 있을 때만 한 번 돌고,
     // 조작 중에 그렸을 때만 다음 프레임 간격을 재려고 콜백을 하나 더 예약한다(측정용 콜백).
     function frame(ts: number) {
       rafId = null;
@@ -180,11 +212,16 @@
         measureFrom = null;
       }
       const busy = interacting();
+      let drew = false;
       if (drawWanted) {
         drawWanted = false;
         draw(busy ? dragCountRef.current : n);   // 조작이 끝났으면 n 개 전부
+        drew = true;
         if (busy) { measureFrom = ts; ensureFrame(); }
       }
+      // 읽기 창: 한 프레임에 한 번, 조작 중에는 찾지 않는다. 카메라가 바뀐 뒤의 그리기에서는 같은 커서로 다시 찾는다
+      if (!busy && cursor !== null && (pickWanted || drew)) pick();
+      pickWanted = false;
     }
     function armIdle() {
       if (idleTimer !== null) clearTimeout(idleTimer);
@@ -196,14 +233,27 @@
       control = state;
       if (!sameCamera(before, state.camera)) {
         if (ev.type === 'wheel' || ev.type === 'key') armIdle();
+        setReadout(null);
         requestDraw();
       }
+      if (ev.type === 'down') setReadout(null);
       // pointerup / pointercancel: 조작이 끝났으면 다음 프레임이 전체 점을 그린다
       if (ev.type === 'up' || ev.type === 'cancel') requestDraw();
       return handled;
     }
+    function hover(c: Cursor | null) {
+      cursor = c;
+      if (c === null || isGesturing(control)) {
+        pickWanted = false;
+        setReadout(null);
+        return;
+      }
+      pickWanted = true;
+      ensureFrame();
+    }
     function setPreset(preset: ViewPreset) {
       control = { ...control, camera: fitToBounds(fit, preset) };
+      setReadout(null);
       requestDraw();
     }

@@ -229,7 +279,7 @@
       });
       observer.observe(canvas);
     }
-    engineRef.current = { input, setPreset, requestDraw };
+    engineRef.current = { input, hover, setPreset, requestDraw };

     return () => {
       engineRef.current = null;
@@ -255,6 +305,8 @@
   function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
     const p = pointerXY(e);
     engineRef.current?.input({ type: 'move', pointerId: e.pointerId, x: p.x, y: p.y, button: e.button, shiftKey: e.shiftKey });
+    // 터치 입력에서는 읽기 창을 띄우지 않는다
+    engineRef.current?.hover(e.pointerType === 'touch' ? null : p);
   }
   function onPointerEnd(e: PointerEvent<HTMLCanvasElement>, type: 'up' | 'cancel') {
     const p = pointerXY(e);
@@ -285,6 +337,7 @@
           onPointerMove={onPointerMove}
           onPointerUp={(e) => onPointerEnd(e, 'up')}
           onPointerCancel={(e) => onPointerEnd(e, 'cancel')}
+          onPointerLeave={() => engineRef.current?.hover(null)}
           onKeyDown={onKeyDown}
           onContextMenu={(e) => e.preventDefault()} />
         <div data-testid="points3d-labels" className="pointer-events-none absolute inset-0 text-xs leading-4"
@@ -312,6 +365,18 @@
           <p data-testid="points3d-hud" style={{ color: theme.text }}>{hud}</p>
           <p data-testid="points3d-hint" style={{ color: theme.textSecondary }}>드래그 회전 · Ctrl+휠 확대</p>
         </div>
+        {readout && (
+          <div data-testid="points3d-readout"
+            className="pointer-events-none absolute rounded border px-2 py-1.5 font-mono text-xs leading-4 tabular-nums"
+            style={{
+              ...readoutPosition(readout),
+              color: theme.text,
+              backgroundColor: rgba(theme.readoutBackground, theme.readoutAlpha),
+              borderColor: rgba(theme.line, theme.axisAlpha),
+            }}>
+            {readoutLines(data, readout.index, thresholdQ).map((line, i) => <div key={i}>{line}</div>)}
+          </div>
+        )}
       </div>

       <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
```

- [ ] **Step 25: 통과 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  65 passed (65)`.

- [ ] **Step 26: (g) 컨텍스트 처리 - 실패하는 테스트 추가**

테스트 파일 끝에 아래를 이어 붙인다(앞에 빈 줄 하나).

```tsx
describe('Points3dView 컨텍스트 처리', () => {
  const lose = (canvas: HTMLCanvasElement) => act(() => {
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });

  // 변이: 손실 때 캔버스를 언마운트함(복구 이벤트를 못 받는다), 복구 뒤 로딩 틀이 남음, 복구 뒤 다시 그리지 않음
  it('손실 뒤 로딩 틀이 캔버스 위에 겹치고(캔버스 유지), 복구되면 걷히고 다시 그린다', () => {
    const { rec, canvas, onError } = mount();
    frame(0);
    expect(screen.queryByTestId('points3d-loading')).toBeNull();

    lose(canvas);
    const viewport = screen.getByTestId('points3d-viewport');
    const loading = within(viewport).getByTestId('points3d-loading');
    expect(loading).toHaveStyle({ backgroundColor: '#000000' });
    expect(loading.parentElement!.className).toBe('absolute inset-0');
    expect(screen.getByRole('img', { name: '3D 점군 뷰어' })).toBe(canvas);   // 같은 노드가 마운트된 채다
    expect(canvas.compareDocumentPosition(loading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { canvas.dispatchEvent(new Event('webglcontextrestored')); });
    expect(screen.queryByTestId('points3d-loading')).toBeNull();
    frame(16);
    expect(rec.pointDraws()).toEqual([1234, 1234]);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onError).not.toHaveBeenCalled();
  });

  // 변이: 손실 중 로딩 틀이 항상 검정
  it('밝은 배경에서 손실되면 로딩 틀도 밝은 배경이다', () => {
    const { canvas } = mount();
    fireEvent.click(screen.getByRole('button', { name: '밝은 배경' }));
    lose(canvas);
    expect(screen.getByTestId('points3d-loading')).toHaveStyle({ backgroundColor: '#ffffff' });
  });

  // 변이: 3,000ms 미복구를 알리지 않음(로딩 틀이 영원히 남는다), 'webgl' 로 알림, onError 중복 호출
  it('3,000ms 안에 복구되지 않으면 onError("context") 를 한 번 부른다', () => {
    const { canvas, onError } = mount();
    frame(0);
    lose(canvas);
    act(() => { vi.advanceTimersByTime(2999); });
    expect(onError).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('context');
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  // 읽기 창과 로딩 틀까지 뜬 상태의 DOM 전체를 본다(스펙 §7.13 의 6번)
  // 변이: 색 이름이 든 클래스·속성 이름 사용
  it('읽기 창과 로딩 틀이 떠 있어도 DOM 에 옛 팔레트 부분 문자열이 없다', () => {
    stubSize(640, 480, 1);
    const { container, canvas } = mount({ data: READOUT_DATA, isRegistered: true });
    frame(0);
    const p0 = project(viewProj(fitToBounds(READOUT_FIT, 'iso'), 640 / 480, FULL), P0, 640, 480)!;
    fireEvent.pointerMove(canvas, mouse(p0.x, p0.y));
    frame(16);
    expect(screen.getByTestId('points3d-readout')).toBeInTheDocument();
    lose(canvas);
    expect(screen.getByTestId('points3d-loading')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-|green-|purple-/);
  });
});
```

- [ ] **Step 27: 실패 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  4 failed | 65 passed (69)`. 3건은 `Unable to find an element by: [data-testid="points3d-loading"]`, 1건은 `expected "vi.fn()" to be called 1 times, but got 0 times`(`onError('context')` 를 아직 알리지 않는다).

- [ ] **Step 28: (g) 구현 - 복구 대기 로딩 틀과 `onError('context')`**

아래 diff 를 적용한다(적용 뒤 426줄).

```diff
--- a/dashboard/components/analysis/points3d-view.tsx
+++ b/dashboard/components/analysis/points3d-view.tsx
@@ -133,6 +133,7 @@
   const [themeName, setThemeName] = useState<ThemeName>('dark');
   const [labels, setLabels] = useState<PlacedLabel[]>([]);
   const [readout, setReadout] = useState<Readout | null>(null);
+  const [restoring, setRestoring] = useState(false);   // 컨텍스트 손실 뒤 복구를 기다리는 중
   const viewRef = useRef<ViewParams>({ thresholdQ: defaultThresholdQ, exaggeration: EXAGGERATIONS[0], themeName: 'dark' });

   const scaffold = useMemo(() => buildScaffold(data.meta.fit_bounds), [data]);
@@ -149,9 +150,9 @@
       onErrorRef.current(kind);
     };
     const created = createRenderer(canvas, {
-      lost: () => {},
-      restored: () => requestDraw(),
-      unrecoverable: () => {},
+      lost: () => setRestoring(true),
+      restored: () => { setRestoring(false); requestDraw(); },
+      unrecoverable: () => report('context'),
     });
     if (!created) { report('webgl'); return; }
     const renderer: Renderer = created;
@@ -377,6 +378,10 @@
             {readoutLines(data, readout.index, thresholdQ).map((line, i) => <div key={i}>{line}</div>)}
           </div>
         )}
+        {restoring && (
+          // 컨텍스트 복구를 기다리는 동안 뷰어 영역을 덮는다. 캔버스는 복구 이벤트를 받아야 하므로 그대로 둔다
+          <div className="absolute inset-0"><Points3dLoadingFrame theme={themeName} /></div>
+        )}
       </div>

       <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
```

- [ ] **Step 29: 통과 확인과 최종 파일 대조**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx`

Expected: `Tests  69 passed (69)`. 출력에 `not wrapped in act(...)` 경고가 없어야 한다.

Run(저장소 루트에서. 작업 트리의 줄바꿈이 CRLF 여도 같은 값이 나오도록 CR 을 지우고 잰다):

```bash
cd D:/Projects/Flatness && tr -d '\r' < dashboard/components/analysis/points3d-view.tsx | sha256sum && tr -d '\r' < dashboard/components/analysis/__tests__/points3d-view.test.tsx | sha256sum && tr -d '\r' < dashboard/components/analysis/points3d-view.tsx | wc -l
```

Expected:

```
19c65697c4af1d6d0d594d918f1fb76b909e4001d61f7e7ca17d4084711afcc1  -
b643e5079e2f467e2a93288ced365518ae6942bc4e2fd594b7f122d77748d747  -
426
```

첫 줄(구현 파일)의 해시가 다르면 Step 12·16·20·24·28 중 어느 diff 를 잘못 옮긴 것이다(가장 흔한 원인: 주석 줄 누락, 줄 끝 공백). 둘째 줄(테스트 파일)의 해시가 다르면 먼저 블록 사이 빈 줄 수와 파일 끝 개행을 본다: Step 2 의 블록 뒤에 Step 6·10·14·18·22·26 의 블록 여섯 개가 각각 **빈 줄 정확히 하나**를 앞에 두고 이어지고, 파일은 개행 하나로 끝난다(빈 줄이 없으면 `6e9f55da…`, 둘이면 `c06e7f04…`, 끝 개행이 없으면 `19a81726…` 으로 시작하는 다른 값이 나온다). 그다음에 코드 블록을 그대로 옮겼는지 본다. 테스트가 전부 통과하고 Step 31 의 검사가 깨끗하면 동작은 같으므로 진행해도 되지만, 다른 곳을 찾아 고치는 편이 안전하다.

- [ ] **Step 30: 변이를 손으로 넣어 테스트가 죽는지 확인**

코드가 맞는 것과 테스트가 회귀를 잡는 것은 다른 문제다. 먼저 구현 파일을 백업해 둔다(`mkdir -p .superpowers/tmp && cp dashboard/components/analysis/points3d-view.tsx .superpowers/tmp/points3d-view.tsx.bak`. `.superpowers/` 는 추적되지 않는다). 아래 변이를 **하나씩** 넣고 `cd dashboard && npx vitest run components/analysis/__tests__/points3d-view.test.tsx` 를 돌려 적힌 테스트가 실패하는지 본 뒤, 백업으로 되돌리고 다음 변이로 간다.

| # | 변이(스펙 §10.5·이 태스크의 함정) | 바꿀 곳(`points3d-view.tsx`) | 죽어야 하는 테스트 |
|---|---|---|---|
| 1 | 휠을 JSX `onWheel` 로 옮김 | effect 의 `canvas.addEventListener('wheel', onWheel, { passive: false });` 줄과 cleanup 의 `canvas.removeEventListener('wheel', onWheel);` 줄을 지우고, `<canvas>` 에 `onWheel={(e) => { if (engineRef.current?.input({ type: 'wheel', deltaY: e.deltaY, ctrlKey: e.ctrlKey, metaKey: e.metaKey })) e.preventDefault(); }}` 를 단다 | `wheel 리스너를 캔버스에 { passive: false } 로 직접 붙이고 언마운트 때 뗀다`, `Ctrl+휠·Cmd+휠은 기본 동작을 막고, 일반 휠은 막지 않으며 다시 그리지도 않는다` |
| 2 | 휠 handler 가 `handled` 를 보지 않고 항상 `preventDefault` | `if (input({ type: 'wheel', … })) e.preventDefault();` → `input({ type: 'wheel', … }); e.preventDefault();` | `Ctrl+휠·Cmd+휠은 기본 동작을 막고, 일반 휠은 막지 않으며 다시 그리지도 않는다` |
| 3 | `pxPerUnit` 에 CSS 높이 | `pxPerUnit(size.bufH, FOVY)` → `pxPerUnit(size.cssH, FOVY)` | `배율 2: 드로잉 버퍼 1280x960, uPxPerUnit 은 버퍼 높이 기준, uMinPx = 3` |
| 4 | `frameMs` 를 입력(그리기) 사이의 간격으로 잼 | `frame` 안의 `measureFrom = null;` 줄을 지우고, `if (busy) { measureFrom = ts; ensureFrame(); }` → `if (busy) { measureFrom = ts; }` | `Ctrl+휠: 조작 중 LOD 로 그리고, …`, `그린 콜백과 다음 rAF 사이가 40ms 면 …`, `사이가 10ms 면 x1.25 로 는다`, `입력 사이를 500ms 띄우는 것만으로는 점 수가 줄지 않는다`, `새 조작은 직전 조작의 마지막 점 수를 잇는다`, `연속 드래그: …` |
| 5 | 포인터 조작 종료 뒤의 전체 그리기 제거 | `if (ev.type === 'up' \|\| ev.type === 'cancel') requestDraw();` 줄 삭제 | `pointerup 뒤 마지막 그리기는 n 개 전부이고 그 뒤 rAF 가 끊긴다`, `pointercancel 도 조작 종료다`, `새 조작은 직전 조작의 마지막 점 수를 잇는다` |
| 6 | 휠·키 조작 종료 뒤의 전체 그리기 제거 | `armIdle` 의 `setTimeout(() => { idleTimer = null; requestDraw(); }, INPUT_IDLE_MS)` → `setTimeout(() => { idleTimer = null; }, INPUT_IDLE_MS)` | `Ctrl+휠: 조작 중 LOD 로 그리고, 마지막 입력 뒤 200ms 가 지나면 n 개 전부를 그린다`, `키 조작(+)도 200ms 뒤 n 개 전부를 그린다` |
| 7 | 터치 입력에서도 읽기 창 | `engineRef.current?.hover(e.pointerType === 'touch' ? null : p);` → `engineRef.current?.hover(p);` | `터치 입력에서는 띄우지 않고, 펜 입력에서는 띄운다` |
| 8 | 선택 배경을 `bg-cs-info-bg` 덧붙이기로 | `const PRESSED = 'aria-pressed:bg-cs-info-bg';` → `const PRESSED = 'bg-cs-info-bg';` | `과장 버튼 4개는 aria-pressed 를 갖고 선택 배경은 aria-pressed variant 로 준다` |
| 9 | 기본 임계값을 5 의 배수로 반올림 | `useState(defaultThresholdQ)` → `useState(Math.round(defaultThresholdQ / 5) * 5)` | `격자 밖 기본값 63 은 그대로 쓴다: HUD·고지 문구·aria-valuetext 가 6.3`, `uThresholdQ 는 0.1mm 정수 그대로다: 기본값 63, 슬라이더 20` |
| 10 | `onError` 를 마운트마다 거듭 알림(가드 제거) | `report` 의 `if (reportedRef.current) return;` 줄 삭제 | `StrictMode 의 effect 이중 실행에서도 onError("webgl") 는 한 번이다` |

하나라도 살아남으면(테스트가 전부 통과하면) 멈추고 보고한다. 전부 확인한 뒤 백업으로 되돌리고 Step 29 의 해시가 다시 맞는지 본다.

- [ ] **Step 31: 타입 검사, 린트, 소스 검사, 대시보드 전체 스위트**

Run:

```bash
cd D:/Projects/Flatness/dashboard && npx tsc --noEmit && npx eslint components/analysis/points3d-view.tsx components/analysis/__tests__/points3d-view.test.tsx
```

Expected: 둘 다 출력 없음, 종료 코드 0.

Run(금지어와 금지 표기. T14 의 소스 검사 테스트가 같은 것을 본다):

```bash
cd D:/Projects/Flatness/dashboard && grep -nE "pass_mm|rework_mm|u_mm|applied_criteria|JSX\.Element|onWheel=|bg-black|text-white|bg-\[#|next/dynamic" components/analysis/points3d-view.tsx; LC_ALL=C grep -c $'\xe2\x80\x94' components/analysis/points3d-view.tsx components/analysis/__tests__/points3d-view.test.tsx; grep -nE "\b(zinc|amber|red|green|emerald|purple|blue)-[0-9]{2,3}\b" components/analysis/points3d-view.tsx components/analysis/__tests__/points3d-view.test.tsx
```

Expected: 첫 grep 은 출력 없음(`onWheel=` 는 JSX 의 휠 핸들러 prop 을 찾는다. 네이티브 리스너 함수의 이름 `onWheel` 은 걸리지 않는다). 둘째(U+2014 를 UTF-8 바이트로 찾는다)는 두 파일 모두 `:0`. 이 Git Bash 는 UTF-8 로캘이 아니라서 `$'\u2014'` 꼴은 리터럴 여섯 글자를 찾아 파일에 U+2014 가 있어도 항상 0 이 나온다(거짓 통과). 반드시 바이트 꼴로 쓴다(Task 7·11·13 의 검사와 같은 꼴. Task 1 Step 14 가 이 함정을 설명한다). 셋째(옛 팔레트 표기)는 출력 없음.

Run: `cd dashboard && npx vitest run`

Expected: 실패 0건. 이 태스크로 테스트 파일 1개와 테스트 69건이 늘어난다. `__tests__/palette-sweep.test.ts` 가 고치지 않은 채 통과해야 한다(새 파일 두 개가 `components/` 아래라 검사 대상이다).

- [ ] **Step 32: 커밋**

```bash
cd D:/Projects/Flatness
git add dashboard/components/analysis/points3d-view.tsx dashboard/components/analysis/__tests__/points3d-view.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): 3D 점군 뷰어 컴포넌트 Points3dView 와 로딩 틀

- 뷰어 영역(캔버스 + 범례, HUD, 조작 안내, 축 라벨, 읽기 창), 컨트롤 줄(시점, 편차 과장, 임계값, 밝은 배경), 고지 문구
- 휠은 네이티브 { passive: false } 리스너로 붙이고 reducer 가 handled 를 돌려준 경우에만 기본 동작을 막는다
- 조작 중에는 앞 일부 점만 그리고(LOD), 그린 직후의 한 프레임 간격으로 점 수를 조정한다. 조작이 끝나면 전체를 한 번 그린다
- 읽기 창은 마우스와 펜에서만, 한 프레임에 한 번 찾는다
- 컨텍스트 손실 중에는 로딩 틀을 겹치고 3초 안에 복구되지 않으면 상위에 알린다
- 뷰어 색은 POINTS3D_THEME 의 hex 를 인라인 style 로만 쓴다. 테스트 69건(gl 호출 기록 스텁, 수동 rAF 큐)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
git status --short
```

Expected: 커밋 1개가 생기고 `git status --short` 출력이 비어 있다(변이 흔적과 `.superpowers/tmp` 의 임시 파일은 추적되지 않는다).

**초안 메모(계획을 합칠 때 읽고 지운다):**

- **실제로 돌린 것(2026-10-02, 스크래치 `.superpowers/plan-drafts/pointcloud-viewer/scratch-12/`):**
  - 위 구현·테스트를 `scratch-12/dashboard/` 아래에 두고 저장소 `dashboard/` 의 vitest 4.1.10(jsdom 29, `@vitejs/plugin-react`, 저장소의 `vitest.setup.ts`)을 `root = dashboard` 로 빌려 돌렸다(`scratch-12/vitest.overlay.config.mjs`: `@/` import 와 스크래치 파일의 bare import 를 dashboard 기준으로 해석하는 플러그인). 최종 69건 통과, `act(...)` 경고 0.
  - 단계별 TDD 를 실제로 재현했다(`scratch-12/run_stages.mjs`, `stages/a~g.tsx`, `parts/test-*.tsx`): 구현 없음 + a → import 실패 / a → 1 통과 / a + b 테스트 → 15 실패 / b → 16 / b + c → 17 실패 / c → 33 / c + d → 10 실패 / d → 43 / d + e → 10 실패 / e → 55 / e + f → 8 실패 / f → 65 / f + g → 4 실패 / g → 69. Step 7·11·15·19·23·27 의 숫자와 문구는 이 실행에서 본 것이다.
  - Step 12~28 의 diff 는 `stages/` 사이를 `difflib` 로 만든 것이고(`make_diffs.py`), `stages/b.tsx` 에 다섯 diff 를 `git apply` 로 차례로 적용한 결과가 `stages/g.tsx` 와 같음을 확인했다(작업 트리가 CRLF 라 CR 을 지우고 비교). Step 29 의 해시는 `stages/g.tsx` 와 parts 를 이은 테스트 파일에서 계산했다.
  - 타입 검사: 저장소 `dashboard/tsconfig.json` 그대로 컴파일러 API 로 스크래치 파일을 얹어(`tsc-overlay.cjs`) 218 파일 errors=0. 린트: 저장소 eslint 설정으로 두 파일을 stdin 검사, 경고 0.
  - 변이 실험(`scratch-12/mutate.mjs`): 88종(Step 30 의 10종 포함. 휠 리스너 옵션·해제, 측정 결과 미적용, 연속 루프, 200ms 100/300 변경, 타이머 미갱신, 포인터 좌표 원점, 읽기 창 뒤집기 제거·전치, 테마 미전달, cleanup 누락 3종, 배율 상한·무시, 크기 하한, 수식키, contextmenu, setPointerCapture 2종, 시점 버튼 각도만, 초기 시점, uniform 미갱신, 범례 누락, HUD 문자열 4종, aria-valuetext, step, 음수 부호, 병합 안내, tabIndex, touch-action, 라벨 층, ResizeObserver 3종, 로딩 틀 2종, 팬 환산 높이, shiftKey, 키 이벤트, HUD 접힘, 읽기 창 pointer-events, 묶음 이름 굵기, HUD 점 수 등)을 하나씩 넣어 전부 죽는 것을 확인했다(`mutate-0-45.log`, `mutate-45-200.log`).
  - 문구 대조(`check_copy.py`): 고지 문구(구현의 템플릿과 테스트의 `NOTICE_7`)가 스펙 §7.12 전문과 같다. 병합·M9·조작 안내 문구 동일. 구현·테스트에 U+2014, 판정 기준 필드 이름, 옛 팔레트 표기 0건.
  - **실제 브라우저 확인(저장소 밖 하네스, `scratch-12/harness/`, Chromium 기반 브라우저 패널):** 합성 6×6m 바닥(9만 점, 10mm 함몰, 9mm 융기, 상자 점 4,000)을 `Points3dView` 에 넣어 띄웠다. 확인한 것: 검정 배경 위 초록 바닥·노랑 함몰·빨강 융기·회색 상자, 범례 4항목, HUD, 조작 안내, 격자와 축 숫자(x 눈금 아래, y 눈금 왼쪽, 축 이름 바깥), 마우스 올림에 읽기 창(좌표 3자리, `편차 −5.0 mm`, FLAT), 드래그 회전, 합성 Ctrl+휠(`defaultPrevented` true, 줌)과 일반 휠(`false`), 조작 종료 뒤 같은 커서로 읽기 창 재탐색, 밝은 배경 전환(흰 배경·진한 색·버튼 선택 배경 `rgb(242, 248, 253)`), 평면 시점(오른쪽 +x, 위 +y), 375px 폭(HUD·조작 안내 두 줄로 접힘, 컨트롤 줄 접힘), 병합 안내 한 줄, 로딩 틀(검정, 흰 칩 Spinner). 콘솔에 컴포넌트 쪽 경고·오류 없음. 실제 휠 입력의 페이지 배율 불변, 배율 2 화면의 점 지름, 터치는 확인하지 않았다(T16 의 장면 8·11·터치).
  - 그 과정에서 발견한 것: T11 초안 스크래치의 17:51 판 `gl-renderer.ts` 는 점 VAO 의 `aPos` 를 `enableVertexAttribArray` 하지 않아 점이 전부 원점에 찍혔다. 18:09 판에는 고쳐져 있다(`gl.enableVertexAttribArray(gpu.aPos)` 가 있다). 이 태스크의 테스트는 그 결함을 잡지 못한다(속성 활성화는 T11 의 테스트 몫이다). T11 계획에 "`aPos` 와 `aDev` 둘 다 `enableVertexAttribArray`" 단언이 있는지 확인할 것.
- **이어서 확인한 것(2026-10-03, 중단된 세션을 이어서):**
  - 이웃 초안이 10-03 아침에 개정됐으므로(task-06·08·09 가 이 초안보다 뒤에 고쳐졌다) 각 초안 문서의 **최종 코드 블록**을 직접 꺼내(`scratch-12/xcheck/extract.py`) 이 태스크의 대역 사본과 대조했다: `mat4.ts`·`orbit.ts`(T8), `scaffold.ts`·`budget.ts`(T9), `pick.ts`·`controls.ts`(T10), `gl-renderer.ts`·`gl-stub.ts`(T11) 8개 전부 바이트 단위로 같다(개행만 정규화). `points3d.ts` 의 T6 부분도 task-06.md 의 최종 코드와 같다. T7 이 덧붙이는 함수는 이 태스크가 쓰지 않는다. 그래서 아래 "대역" 은 지금 최종 계획의 코드다.
  - 저장소 vitest 로 다시 실행(`scratch-12/rerun-2026-10-03.log`): `Tests  69 passed (69)`, `act(...)` 경고 0, 콘솔 경고·오류 0. `tsc-overlay.cjs`: 218 파일 errors=0. 저장소 eslint 설정으로 두 파일 stdin 검사 종료 코드 0. Step 31 의 금지어·`JSX.Element`·`onWheel=`·색 유틸리티 grep 0건, U+2014 0건, 옛 팔레트 정규식 0건. Step 1 의 grep 개수(6·15)는 최신 대역에서도 그대로다.
  - `verify_plan.py`: 이 문서의 코드 블록만으로 재구성한 두 파일의 sha256 이 Step 29 의 값과 같고, diff 5개가 `git apply` 로 차례로 적용된다(`impl sha ok: True`, `test sha ok: True`, 426줄).
  - 변이 실험 로그 재확인: `mutate-0-45.log` 45건 + `mutate-45-200.log` 43건 = 88건 전부 DEAD, 생존 0.
  - T14 초안의 `analysis-result.test.tsx`(24건)를 T14 스크래치에서 **이 컴포넌트의 최종 파일**(같은 해시)로 돌렸다: 24건 통과, `act(...)` 경고 0. 따로 탐침(뷰어를 마운트한 채 실제 60ms 대기)을 돌리면 `flushSync(setLabels)` 에서 경고가 정확히 1회 난다. 아래 "다른 태스크에 알릴 것" 의 rAF 항목을 그 결과대로 고쳤다.
  - T11 초안을 열어 확인: "`aPos`·`aDev` 둘 다 `enableVertexAttribArray`" 단언이 `점 VAO 에서 aPos·aDev 를, 선 VAO 에서 aPos 를 켠다` 테스트에 있고(변이 R62·R63 이 그 테스트로 죽는다), T11 의 10-03 재검증 메모가 이 태스크의 컴포넌트 테스트 69건과 T11 48건을 함께 돌려 117건 통과를 적어 두었다. 아래 T11 항목은 해결됐다.
- **대역:** T6(`scratch-06` 의 `points3d.ts`) + T7(`scratch-07/verify` 의 stats·모드 부분) + T5(`scratch-05` 의 `types.ts`), T8(`scratch-08`), T9(`scratch-09`), T10(`scratch-10`), T11(`scratch-11` 의 18:09 판 `gl-renderer.ts`·`gl-stub.ts` 그대로). 10-03 에 각 초안 문서의 최종 코드 블록과 대조해 전부 같음을 확인했다(위 "이어서 확인한 것"). 이 태스크의 테스트가 T11 에 기대는 것은 Interfaces 의 "이 태스크가 기대는 동작" 항목뿐이고 전부 T11 초안의 Produces 에 적혀 있다.
- **못 돌린 것:** 저장소 `dashboard/` 안에서의 실행(`npx vitest run` 전체, `palette-sweep.test.ts` 자체. 같은 정규식을 스크립트로 돌려 0건만 확인), `npx next build`, 실제 휠 입력(브라우저 패널의 합성 `WheelEvent` 로만 확인), 배율 2 화면, 터치.
- **스펙이 정하지 않아 여기서 정한 것(본문 표):** 읽기 창 어림 크기 160×100, 축 라벨 방향 상수, HUD·조작 안내 한 줄 배치, `ResizeObserver` 콜백 안의 즉시 다시 그리기(크기가 그대로면 생략), 축 라벨의 `flushSync`, 휠·키 줌 때 읽기 창 숨김과 재탐색, `onError` 마운트당 1회 가드(StrictMode 이중 실행 대비). 스펙의 동작과 어긋나는 것은 없다.
- **뼈대와 다른 점:** Consumes 에 T6 의 `hexToRgb01`·`PointClass`, 테스트에서 T8 의 `rotate`·`pan`·`project` 를 더 쓴다(모두 각 태스크의 Produces 에 있다). `ControlState` 타입은 직접 쓰지 않는다. 테스트 파일의 describe 이름 `Points3dView 휠·포인터·키` 는 뼈대의 "휠" 행에 드래그·키·contextmenu·setPointerCapture 를 함께 둔 것이다.
- **다른 태스크에 알릴 것:**
  - T13·T14: 이 뷰를 마운트한 채 **실제 시간을 16ms 이상 기다리는** 테스트(`waitFor`·`findBy*`·`setTimeout` 대기)는 jsdom 의 실제 rAF 콜백이 `act` 밖에서 돌아 `setLabels`(`flushSync`) 가 `An update to Points3dView inside a test was not wrapped in act(...)` 경고를 1회 찍는다(10-03 탐침: 60ms 대기에서 경고 1회. 테스트는 실패하지 않는다). 그런 테스트만 `requestAnimationFrame` 을 스텁(수동 큐)하거나 `vi.useFakeTimers()` 로 묶으면 된다. 마운트 뒤 동기 단언으로 끝나는 테스트는 cleanup 의 `cancelAnimationFrame` 이 먼저 돌아 경고가 없다(T14 초안의 24건을 이 컴포넌트로 돌려 경고 0 확인). 마운트당 `getContext` 1회는 `StrictMode` 밖에서만 성립한다.
  - T11: `aPos`·`aDev` 활성화 단언은 T11 초안에 있다(10-03 확인, 해결). `uniformCalls` 의 값은 위치 인자 뒤의 인자들이다(이 태스크의 `lastUniform` 헬퍼가 `uniform1f`·`uniform3f`·`uniformMatrix4fv` 를 가리지 않고 숫자 목록으로 편다).
  - T16: 장면 1 의 축 라벨 겹침(두 축의 `0.0` 이 같은 모서리)과 축 이름 거리는 `LABEL_TRANSFORM` 과 T9 의 `AXIS_NAME_OFFSET_FRAC` 로 조정한다. 하네스 캡처에서는 겹치지 않았다.

---
### Task 13: `Preview3dTab`: 뷰어 / 기존 PNG / 경우별 안내 분기와 탐지·적재 요청 effect

**목표:** 스펙 §7.11 분기표의 11개 모드 화면(문구 M1~M10, Alert 종류, 버튼 유무)과 탐지 effect·요청 effect·다시 시도 전이가, 상위 state(`load`, `support`, `optedIn`)를 props로 주입한 상태에서 단독 테스트된다.

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.1 D2, §2.3(탭 구조, 정합 병합·임포트·벽면 판별), §7.2(`preview3d-tab.tsx`), §7.3(탐지 effect, 요청 effect, 흐름 2·3), §7.11(분기표의 화면 열, 다시 시도 전이 표, 구배 제외), §7.12(M1~M10, 버튼), §7.13(색 사용 규칙), §10.4(`preview3d-tab.test.tsx` 행), §10.5(대시보드 변이 2건), 부록 B의 4·8·10·11번.

**Files:**
- Create: `dashboard/components/analysis/preview3d-tab.tsx`
- Create: `dashboard/components/analysis/__tests__/preview3d-tab.test.tsx`
- Modify: 없음. `analysis-result.tsx`의 3D 탭 본문(`:76-94`)을 이 컴포넌트 호출로 바꾸는 일은 Task 14가 한다. 이 태스크가 끝난 시점에 `preview3d-tab.tsx`는 테스트에서만 import된다(빌드에는 영향이 없다).
- Test: `dashboard/components/analysis/__tests__/preview3d-tab.test.tsx`
- 읽기만(고치지 않는다):
  - `dashboard/components/analysis/analysis-result.tsx:79-84` 기존 정적 PNG 마크업. `<img>`의 `src`는 `artifactUrl(dir, name)`, `alt`는 `3D 프리뷰 {name}`, `className`은 `max-w-full rounded-lg border border-cs-divider bg-white`다. 이 마크업을 그대로 옮긴다. `:85-87`의 옛 캡션과 `:90-92`의 옛 빈 상태 문구는 옮기지 않는다
  - `dashboard/components/ui/alert.tsx:14-28` `Alert({ type, title?, children, className? })`. 루트에 `data-alert={type}`(`:19`)
  - `dashboard/components/ui/button.tsx:19-25` `Button`. `variant` 기본값이 `'normal'`이고 normal은 `bg-transparent`(`:11`), primary는 `text-white`(`:10`)를 갖는다
  - `dashboard/lib/domain/paths.ts:8-10` `artifactUrl(artifactsDir: string, filename: string): string`
  - `dashboard/lib/domain/types.ts:12`(`Lineage`), `:46-65`(`ScanRow`), `:67-75`(`AnalysisRow`), `:117-`(`Stats`. Task 5가 `points3d_paths?: string[]`와 `points3d_threshold_q?: number`를 더해 둔 상태)
  - `dashboard/components/analysis/deviation-view.tsx:5,22-37` 안내 문구 `<p>`의 클래스(`text-sm text-cs-text-secondary`)와 임포트 분기 선례
  - `dashboard/node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` (`dashboard/AGENTS.md`의 지시: 대시보드 코드 전에 이 저장소의 Next.js 문서를 확인한다)

**Interfaces:**
- Consumes:
  - Task 7 (`@/lib/domain/points3d`): `Points3dLoad`, `Webgl2Support`, `Preview3dInput`, `Preview3dMode`, `resolvePreview3dMode(input: Preview3dInput): Preview3dMode`, `shouldProbe(input: Preview3dInput): boolean`, `shouldRequestLoad(input: Preview3dInput): boolean`, `loadFor(load: Points3dLoad, dir: string | null): Points3dLoad`, `points3dFile(stats: Stats): string | null`, `defaultThresholdQ(stats: Stats): number | null`
  - Task 11 (`@/lib/viz/points3d/gl-renderer`): `probeWebgl2(): Webgl2Support`. 테스트 헬퍼 `recordingGl()`(`@/lib/viz/points3d/__tests__/gl-stub`, 반환값의 `.gl`을 `getContext` 스텁으로 끼운다)
  - Task 12 (`./points3d-view`): `Points3dView({ data, defaultThresholdQ, isRegistered, onError })`, `Points3dLoadingFrame({ theme })`. DOM 계약: 캔버스 `role="img"` + `aria-label="3D 점군 뷰어"`, 로딩 틀 루트 `data-testid="points3d-loading"`(배경은 인라인 style의 테마 hex, 안에 M9), 슬라이더 `aria-label="표시 임계값(mm)"`(초기값 = `defaultThresholdQ`), 병합 안내 `data-testid="points3d-merged-note"`(`isRegistered`일 때만). 동작 계약: 마운트마다 `canvas.getContext('webgl2', ...)`를 한 번 부른다. `createRenderer`가 null이면 `onError('webgl')` 1회. 캔버스의 `webglcontextlost` 뒤 3,000ms 안에 복구되지 않으면 `onError('context')` 1회
  - 기존: `Alert({ type: 'info' | 'success' | 'warning' | 'error', title?, children })`(루트에 `data-alert={type}`), `Button`(기본 `normal`), `artifactUrl(artifactsDir: string, filename: string): string`, 타입 `AnalysisRow`·`ScanRow`·`Stats`(`@/lib/domain/types`)
- Produces:
  - `export function Preview3dTab(props: { analysis: AnalysisRow; stats: Stats; scan: ScanRow; isImport: boolean; load: Points3dLoad; support: Webgl2Support | null; optedIn: boolean; onSupport(s: Webgl2Support | null): void; onOptIn(): void; onRequestLoad(): void; onRetryLoad(): void; })` (반환 타입 표기 없음)
  - 로컬 state는 `rendererFailed`, `contextLost` 둘뿐이다. 탐지 effect(의존성: `shouldProbe(input)` 값) → `onSupport(probeWebgl2())`. 요청 effect(의존성: `shouldRequestLoad(input)` 값과 `analysis.artifacts_dir`) → `onRequestLoad()`
  - DOM 계약(Task 14 테스트가 쓴다): 안내 M1~M3은 `<p>`, 오류·안내 Alert는 `data-alert`, 버튼 이름 `다시 시도`·`3D로 보기`, PNG는 alt `3D 프리뷰 {name}` + 캡션 M10, 뷰어 모드에서는 `Points3dView`에 `defaultThresholdQ = defaultThresholdQ(stats)`, `isRegistered = scan.lineage === 'registered'`

**이 태스크가 그리는 화면 (스펙 §7.11 분기표의 화면 열).** 모드는 `resolvePreview3dMode`(Task 7)가 정한다. 이 컴포넌트는 표의 조건을 다시 계산하지 않고 모드를 그리기만 한다. "PNG"는 `(stats.preview3d_paths ?? []).filter(Boolean)`을 기존 `<img>` 마크업으로 그린 것 + 캡션 M10이며, `analysis.artifacts_dir`가 null이거나 목록이 비면 이미지도 캡션도 그리지 않는다.

| 행 | 모드 | 화면(위에서 아래 순서) | `다시 시도`가 하는 일 |
|---|---|---|---|
| 1 | `wall` | 안내 M1(`<p>`) | 버튼 없음 |
| 2 | `import` | PNG, 안내 M2(`<p>`) | 버튼 없음 |
| 3 | `no_data` | PNG, 안내 M3(`<p>`) | 버튼 없음 |
| 4 | `error_stats` | Alert(error) M6, PNG | 버튼 없음 |
| 5·11 | `loading` | `<Points3dLoadingFrame theme="dark" />` | 버튼 없음 |
| 6 | `error_webgl` | Alert(warning) M7, `다시 시도`, PNG | `setRendererFailed(false)` + `onSupport(null)` |
| 7 | `software_prompt` | PNG, Alert(info) M4, `3D로 보기`(→ `onOptIn()`) | 버튼 없음 |
| 8 | `error_fetch` | Alert(error) M5, `다시 시도`, PNG | `onRetryLoad()` |
| 9 | `error_format` | Alert(error) M6, `다시 시도`, PNG | `onRetryLoad()` |
| 10 | `error_context` | Alert(error) M8, `다시 시도`, PNG | `setContextLost(false)` |
| 12 | `viewer` | `<Points3dView>`만(PNG 없음) | 버튼 없음 |

**화면 문구 (스펙 §7.12 전문. 가운뎃점과 마침표까지 글자 그대로).**

| ID | 문구 |
|---|---|
| M1 | 벽면 분석은 3D 프리뷰 이미지와 3D 점군 뷰를 제공하지 않습니다. |
| M2 | 외부 결과(임포트)에는 3D 점군 데이터를 생성하지 않습니다. |
| M3 | 이 분석에는 3D 점군 데이터가 없습니다. 재분석하면 생성됩니다. |
| M4 | 이 기기는 그래픽 가속을 사용할 수 없어 3D 점군 뷰가 느릴 수 있습니다. 기본으로 정적 이미지를 표시합니다. |
| M5 | 3D 점군 데이터를 저장소에서 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요. |
| M6 | 3D 점군 데이터 형식을 읽을 수 없습니다. 지원하지 않는 버전이거나 손상된 파일입니다. |
| M7 | 이 브라우저 또는 기기에서는 WebGL2를 사용할 수 없어 3D 점군 뷰를 표시할 수 없습니다. |
| M8 | 그래픽 컨텍스트가 끊겨 3D 점군 뷰를 표시할 수 없습니다. 다시 시도하세요. |
| M9 | 3D 점군 데이터를 불러오는 중입니다. (`Points3dLoadingFrame`이 갖는다. 이 태스크는 문구를 다시 적지 않는다) |
| M10 | 엔진이 생성한 정적 3D 프리뷰 이미지입니다. 높이 축은 편차(mm)이며 실제 축 비율이 아닙니다. |
| 버튼 | `다시 시도`, `3D로 보기` |

**지킬 것 (함정).**
1. `support`와 `optedIn`은 props다(상위 `AnalysisResult`의 state). 이 컴포넌트의 로컬 state로 두지 않는다. 탭 본문은 조건부 렌더라 탭을 벗어나면 언마운트되므로, 로컬에 두면 탭에 돌아올 때마다 다시 탐지하고 `3D로 보기`를 다시 눌러야 한다(Task 14의 "탭 왕복 뒤 탐지 1회·선택 유지" 테스트가 그 변이를 죽인다). 로컬 state는 `rendererFailed`와 `contextLost` 둘뿐이다.
2. `probeWebgl2()`는 effect 안에서만 부른다. 이 파일에서 `getContext`를 직접 부르지 않는다(WebGL 접점은 `gl-renderer.ts` 한 파일이다). `next/dynamic`·`ssr: false`를 쓰지 않는다.
3. 두 effect의 의존성은 스펙이 정한 값뿐이다(탐지: `shouldProbe(input)`의 값. 요청: `shouldRequestLoad(input)`의 값과 `analysis.artifacts_dir`). 콜백(`onSupport`, `onRequestLoad`)을 의존성에 넣지 않는다. 상위가 렌더마다 콜백을 새로 만들 수 있어, 넣으면 렌더마다 다시 탐지·다시 요청한다. ESLint의 `react-hooks/exhaustive-deps` 경고는 그 줄에만 `eslint-disable-next-line`으로 끈다.
4. 1~3행(`wall`, `import`, `no_data`)은 오류가 아니다. Alert와 버튼이 없다. 4행(`error_stats`)은 Alert(error) M6이지만 `다시 시도`가 없다(stats가 그대로인 한 다시 시도로 고칠 수 없다). `import` 모드에는 재분석을 권하는 문구(M3)를 넣지 않는다.
5. Alert 종류: M7은 `warning`, M4는 `info`, M5·M6·M8은 `error`. 버튼은 전부 `Button`의 기본 변형(`normal`)이다. `variant="primary"`를 주지 않는다(뷰당 primary 1개 규칙).
6. 다시 시도 전이는 모드마다 다르다(위 표). `error_webgl`에서 `rendererFailed`를 되돌리지 않으면 다시 탐지가 끝나도 6행에 머문다. `error_context`에서는 플래그만 되돌린다. `Points3dView`가 조건부 렌더라 새 canvas로 새로 마운트되고, 점 데이터는 상위 state에 남아 있으므로 `onRetryLoad()`를 부르지 않는다.
7. 뷰어 모드에서 넘기는 점 데이터는 `loadFor(load, dir)`로 읽은 `ready`의 `data`다. 뷰어가 보일 때는 PNG를 함께 그리지 않는다.
8. 로딩 모드는 `<Points3dLoadingFrame theme="dark" />`다(뷰어 영역과 같은 검정. 탭에 들어올 때 밝은 틀이 번쩍이지 않는다).
9. 옛 문구 두 개("워커가 생성한 정적 3D 프리뷰입니다...", "3D 프리뷰가 없습니다...")를 쓰지 않는다. 구배 화면(`slope-result.tsx`)은 고치지 않는다.
10. 이 파일은 Task 14의 소스 검사 대상이다. 주석을 포함해 판정 기준 필드 이름 네 가지(Step 10의 grep 패턴)와 U+2014가 0건이어야 한다. stats에서 읽는 것은 `preview3d_paths`와, `points3dFile`·`defaultThresholdQ`를 거친 두 키뿐이다.
11. 색: 새 Tailwind 색 유틸리티를 만들지 않는다. 쓰는 클래스는 기존 `cs-` 토큰과, 기존 PNG 마크업의 `bg-white`뿐이다. 주석·문자열·식별자에 `색이름-숫자` 꼴 표기를 쓰지 않는다(`dashboard/__tests__/palette-sweep.test.ts`가 `components`의 모든 `.ts`·`.tsx` 줄을 테스트 파일까지 검사한다).
12. 컴포넌트 반환 타입을 적지 않는다(`: JSX.Element`는 `tsc --noEmit`가 TS2503으로 실패한다).
13. `'use client'`는 파일 머리 주석 다음, 첫 import 앞에 둔다(`heatmap-view.tsx:3`과 같은 자리). 이 컴포넌트는 이미 `'use client'`인 `analysis-result.tsx` 아래에서만 렌더된다.
14. 탐지 effect에 "한 번만 탐지" ref 가드를 두지 않는다. `error_webgl`의 다시 시도는 `onSupport(null)` 뒤 **같은 마운트에서** 다시 탐지해야 하고(전이 표), 이 흐름은 뷰어가 거듭 실패하면 거듭 일어난다. 개발 모드(`StrictMode`)가 마운트 effect를 두 번 돌려 `probeWebgl2()`와 `onRequestLoad()`가 두 번 불리는 것은 무해하다: 탐지 결과는 같은 값이고, 요청의 멱등 검사는 상위(`AnalysisResult`, Task 14)가 한다. 이 태스크의 테스트는 `StrictMode` 없이 호출 수를 센다.
15. 테스트는 `requestAnimationFrame`을 스텁하지 않는다. `Points3dView`(Task 12)는 마운트 때 rAF를 한 번 예약하고 cleanup에서 `cancelAnimationFrame`을 부르는데, 이 파일의 테스트는 전부 동기라 테스트가 끝나고 testing-library가 언마운트할 때까지 jsdom의 rAF(약 16ms)가 돌 틈이 없다. 그래서 `act(...)` 경고가 나지 않는다. `error_context` 테스트는 `vi.useFakeTimers()`를 쓰는데, vitest 4의 가짜 타이머는 `nextTick`·`queueMicrotask`를 뺀 전부(rAF 포함)를 가짜로 바꾸므로 `advanceTimersByTime` 안에서 rAF 콜백이 `act` 안에서 돈다. 뷰어를 마운트하는 테스트에 `await`·`waitFor`를 새로 넣게 되면 Task 12의 테스트처럼 rAF를 수동 큐로 스텁한다.

**테스트가 죽이는 변이.** 테스트 이름은 `describe > it` 순서다. `×N`은 `it.each`가 만드는 건수다.

| 테스트 | 죽이는 변이 |
|---|---|
| 모드별 화면 > `wall: 안내 M1 한 줄뿐이다` | 벽면에 정적 PNG·Alert·버튼을 그림, M1을 `<p>`가 아닌 것으로, 옛 빈 상태 문구 사용 |
| 모드별 화면 > `import: 정적 PNG + 캡션 M10 + 안내 M2. 재분석을 권하지 않는다` | import 모드에 M3(재분석 권유) 표시, PNG 생략, 캡션을 옛 문구로, `<img>`의 `src`·`className` 변경, 안내를 이미지 위로 |
| 모드별 화면 > `import: 정적 PNG 가 없으면 이미지와 캡션 없이 M2 만 낸다` | 목록이 없어도 캡션 M10을 그림 |
| 모드별 화면 > `no_data: 정적 PNG(빈 이름은 거른다) + 캡션 M10 + 안내 M3` | `filter(Boolean)` 제거, 캡션을 이미지마다 반복, no_data를 Alert로 그림, alt 문자열 변경 |
| 모드별 화면 > `no_data: 정적 PNG 목록이 비면 ...` | 빈 목록에도 캡션을 그림 |
| 모드별 화면 > `no_data: artifacts_dir 가 없으면 ...` | `artifacts_dir`가 null인데 이미지를 그림(`dir !== null` 검사 제거) |
| 모드별 화면 > `error_stats: Alert(error) M6 + 정적 PNG. 다시 시도 버튼이 없다` | error_stats에 다시 시도 버튼, M6 대신 M5, Alert를 `<p>`로 강등, PNG 생략 |
| 모드별 화면 > `loading: 검정 로딩 틀과 M9 를 낸다` ×3 | 로딩 틀을 `theme="light"`로, 로딩 중에 PNG·Alert를 그림, 탐지 전인데 `ready`라고 뷰어를 마운트 |
| 모드별 화면 > `%s: Alert + 다시 시도 + 정적 PNG 순서로 낸다` ×3 | M7 Alert를 `error`로, M5와 M6 뒤바꿈, 버튼을 primary로, 버튼 누락, PNG를 Alert 위로 |
| 모드별 화면 > `software_prompt: 정적 PNG + Alert(info) M4 + "3D로 보기" 순서로 낸다` | M4 Alert를 `warning`으로, 순서 뒤바꿈, 버튼을 primary로, 다시 시도 버튼 추가 |
| 모드별 화면 > `viewer: Points3dView 를 그리고 정적 PNG 는 그리지 않는다` | 뷰어와 PNG를 함께 그림, 표시 임계값을 상수(70)로 넘김 |
| 모드별 화면 > `viewer: 정합 병합 스캔(lineage registered)이면 병합 안내가 나온다` | `isRegistered`를 상수로, `lineage` 비교 값 오타 |
| 뷰어 대상이 아닌 분석 > `대조군` | (아래 두 묶음의 하중 확인. 가드가 없을 때 탐지·요청이 실제로 일어나는 입력임을 보인다) |
| 뷰어 대상이 아닌 분석 > `%s: 탐지 전이어도 probeWebgl2 를 부르지 않는다` ×5 | 뷰어 대상이 아닌 분석에서 탐지(`shouldProbe` 대신 `support === null`) |
| 뷰어 대상이 아닌 분석 > `%s: 하드웨어 + idle 이어도 적재를 요청하지 않는다` ×5 | 1~4행 가드 없이 요청, 조건 없는 탐지 |
| 탐지 effect > `support 가 null 이면 마운트 때 한 번 탐지해 결과를 onSupport 로 올린다` | 탐지 effect 누락, 탐지 결과 대신 상수(`'hardware'`)를 올림 |
| 탐지 effect > `support 가 이미 있으면(%s) 다시 탐지하지 않는다` ×3 | 탐지 effect가 support가 있는데도 다시 탐지 |
| 탐지 effect > `상위가 아직 support 를 올려 주지 않은 채 다시 렌더해도 탐지를 반복하지 않는다` | 탐지 effect의 의존성 배열 제거, 콜백을 의존성에 넣음 |
| 요청 effect > `하드웨어 + idle 이면 마운트 때 onRequestLoad 를 한 번 부른다` | 요청 effect 누락, `onRetryLoad`를 대신 부름 |
| 요청 effect > `요청하지 않는다: %s` ×5 | 요청 조건을 `shouldRequestLoad` 대신 직접 계산(`support !== null`만 봄): 받는 중·ready·오류 뒤·WebGL2 불가에서도 요청 |
| 요청 effect > `상위가 아직 load 를 바꾸지 않은 채 다시 렌더해도 요청을 반복하지 않는다` | 요청 effect의 의존성 배열 제거, 콜백을 의존성에 넣음 |
| 요청 effect > `같은 인스턴스에서 artifacts_dir 가 바뀌면 ... 다시 요청한다` | 요청 effect 의존성에서 `artifacts_dir` 제거 |
| 소프트웨어 렌더 > `"3D로 보기"를 누르기 전에는 요청하지 않고, 누르면 onOptIn, optedIn 이 참이 되면 요청한다` | 소프트웨어 렌더에서 선택 전에 요청, 버튼이 `onOptIn`을 부르지 않음, `optedIn`을 로컬 state로(누르자마자 요청), 버튼이 곧바로 `onRequestLoad`를 부름 |
| 소프트웨어 렌더 > `재진입: 선택을 마친 소프트웨어 렌더 기기는 ... 곧바로 뷰어다` | 마운트마다 다시 탐지, `support`·`optedIn` props를 무시하고 로컬 state로 둠(재진입 때 다시 탐지하거나 software_prompt) |
| 소프트웨어 렌더 > `재진입: 선택하지 않았으면 ... 뷰어를 마운트하지 않는다` | 모드를 보지 않고 점 데이터가 `ready`면 뷰어를 마운트(선택 전에 `getContext` 호출) |
| 다시 시도 > `%s: onRetryLoad 를 한 번 부른다` ×2 | 다시 시도가 `onRequestLoad`를 부름(상위의 멱등 검사에 막혀 다시 받지 못한다) |
| 다시 시도 > `error_webgl(WebGL2 불가): onSupport(null) 로 다시 탐지하겠다고 알린다` | `onSupport(null)` 누락, 점 파일까지 다시 받음 |
| 다시 시도 > `error_webgl(렌더러 생성 실패): 다시 시도가 실패 플래그를 되돌리고 다시 탐지해 뷰어로 돌아온다` | **error_webgl 다시 시도에서 `rendererFailed`를 되돌리지 않음**(스펙 §10.5), `onError` 종류 뒤바꿈, `onSupport(null)` 누락, 다시 받음 |
| 다시 시도 > `error_context: 손실 후 3,000ms 가 지나면 Alert(error) M8, 다시 시도는 뷰어를 새로 마운트하고 다시 받지 않는다` | `contextLost`를 되돌리지 않음, 다시 시도가 `onRetryLoad`를 부름, `onError('context')`를 `rendererFailed`로 받음, M8 화면에서 PNG 누락 |
| 분석 전환 > `key 와 analysis 가 바뀌면 오류 플래그가 남지 않고 ...` | 오류 플래그를 컴포넌트 state가 아닌 모듈 변수에 보관(key로 사라지지 않는다), 새 분석에서 요청 누락, 표시 임계값을 상수로 |

살아남는 변이 한 가지(동치): 뷰어에 넘기는 데이터를 `loadFor(load, dir)` 대신 `load`에서 바로 꺼내도 테스트가 통과한다. 모드가 `viewer`라는 것이 이미 `loadFor(load, dir).status === 'ready'`(곧 `load.dir === dir`)를 뜻하기 때문이다. 다른 분석의 `ready`가 뷰어로 가지 않는 것은 Task 7의 `resolvePreview3dMode` 테스트와 이 태스크의 분석 전환 테스트가 잡는다.

**기대값의 근거.** 전부 스펙과 기존 코드에서 손으로 옮긴 값이다(구현 출력을 베끼지 않았다).
- 문구 M1~M10: 스펙 §7.12 표에서 옮겼다. 테스트 파일은 구현의 상수를 import하지 않고 자기 사본을 갖는다.
- Alert 종류와 버튼 유무, 화면 순서: 스펙 §7.11 분기표의 화면 열(위 표).
- 이미지 `src` `/api/data/artifacts/an1/preview3d.png`: `artifactUrl('artifacts/an1', 'preview3d.png')` = `'/api/data/' + 경로 조각별 encodeURIComponent`(`paths.ts:3-10`). 기존 테스트 `analysis-result.test.tsx:56`의 `/api/data/artifacts/an1/deviation.png`와 같은 규칙이다.
- 슬라이더 값 `'60'`: 픽스처의 `points3d_threshold_q: 60`은 [10, 300] 안의 정수라 `defaultThresholdQ`가 그대로 60을 돌려주고, `Points3dView`의 슬라이더 초기값이 그 값이다. 픽스처 기본값(70)과 달라서 상수를 넘기는 구현이 죽는다.
- 로딩 틀 배경 `#000000`: 스펙 §7.6 색 표의 `dark` 배경.
- `viewerMounts()`(= `getContext('webgl2', ...)` 호출 수): Task 12의 계약 "마운트마다 한 번". 뷰어가 처음 뜨면 1, 다시 시도로 새로 마운트되면 2, 뷰어를 마운트하지 않는 모드에서는 0.
- `log.mock.calls`가 `[[null], ['hardware']]`: 다시 시도가 `onSupport(null)`을 부르고(전이 표), 상위가 `support`를 null로 두면 탐지 effect가 다시 돌아 `onSupport(probeWebgl2())`를 부른다. `probeWebgl2` mock의 반환값이 `'hardware'`다.
- 2,999ms에는 Alert가 없고 1ms 뒤에 생긴다: 컨텍스트 복구 대기가 3,000ms다(스펙 §2.4).
- Step 7의 "13건 실패": 새로 더하는 33건 가운데 "부른다 / 올린다 / 돌아온다"를 단언하는 13건만 화면만 그리는 구현에서 실패한다. 나머지 20건은 "부르지 않는다"는 단언이라 effect가 없으면 당연히 통과한다. 이 20건의 하중은 대조군 테스트와 Step 11의 변이 확인이 보인다.

---

- [ ] **Step 1: 전제 확인 (Task 5·7·11·12의 산출물, Next.js 문서)**

Run:

```bash
cd D:/Projects/Flatness
grep -n "points3d_paths\|points3d_threshold_q" dashboard/lib/domain/types.ts
grep -nE "^export (function|type|interface) (points3dFile|defaultThresholdQ|loadFor|resolvePreview3dMode|shouldProbe|shouldRequestLoad|Points3dLoad|Webgl2Support|Preview3dInput|Preview3dMode)\b" dashboard/lib/domain/points3d.ts
grep -nE "^export function (probeWebgl2|createRenderer)\b" dashboard/lib/viz/points3d/gl-renderer.ts
grep -n "^export function recordingGl" dashboard/lib/viz/points3d/__tests__/gl-stub.ts
grep -nE "^export function (Points3dView|Points3dLoadingFrame)\b" dashboard/components/analysis/points3d-view.tsx
grep -n "points3d-loading\|points3d-merged-note\|3D 점군 뷰어\|표시 임계값(mm)" dashboard/components/analysis/points3d-view.tsx
ls dashboard/components/analysis/preview3d-tab.tsx dashboard/components/analysis/__tests__/preview3d-tab.test.tsx
cd dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts lib/viz/points3d components/analysis/__tests__/points3d-view.test.tsx
```

Expected:
- 첫 grep: `points3d_paths?: string[];` 줄과 `points3d_threshold_q?: number;` 줄, 2줄.
- 둘째 grep: 10줄(`points3dFile`, `defaultThresholdQ`, `Webgl2Support`, `Points3dLoad`, `loadFor`, `Preview3dMode`, `Preview3dInput`, `resolvePreview3dMode`, `shouldProbe`, `shouldRequestLoad`).
- 셋째 grep: 2줄. 넷째 grep: 1줄. 다섯째 grep: 2줄.
- 여섯째 grep: 네 문자열(`points3d-loading`, `points3d-merged-note`, `3D 점군 뷰어`, `표시 임계값(mm)`)이 각각 한 줄 이상 나온다.
- `ls`: 두 파일 모두 `No such file or directory`(이 태스크가 새로 만든다).
- vitest: 전부 통과.

하나라도 다르면 멈추고 Task 5·7·11·12가 끝났는지 확인한다.

이어서 `dashboard/node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`를 읽는다. 확인할 것은 두 가지다. (1) `'use client'`는 파일 맨 위, import보다 앞에 둔다(주석은 그 앞에 와도 된다). (2) 지시문이 꼭 필요한 곳은 서버 컴포넌트가 직접 렌더하는 파일이다. `Preview3dTab`은 이미 `'use client'`인 `analysis-result.tsx`가 렌더하므로 함수 props를 받아도 된다. 훅을 쓰는 파일에 지시문을 적는 이 저장소의 관례(`heatmap-view.tsx:3`, `tab-bar.tsx:1`)를 따라 이 파일에도 적는다.

- [ ] **Step 2: 실패하는 테스트 작성 (파일 머리, 픽스처, 모드별 화면)**

`dashboard/components/analysis/__tests__/preview3d-tab.test.tsx`를 새로 만들고 다음 내용을 넣는다. 파일 머리(import, 문구, 픽스처, 헬퍼)는 이 단계에서 한 번에 쓴다. `act`, `fireEvent`, `M8`, `DIR_B`, `SupportOwner`는 Step 6에서 붙이는 테스트가 쓴다(그때까지는 쓰이지 않는 채로 둔다. vitest와 `tsc --noEmit`에는 영향이 없다).

테스트의 구조:
- `vi.mock('@/lib/viz/points3d/gl-renderer', ...)`는 `probeWebgl2`만 `vi.fn()`으로 바꾸고 `createRenderer`는 실제 구현을 남긴다. 그래야 `Points3dView`가 실제 경로로 돌고, 뷰어가 마운트된 횟수를 `getContext('webgl2', ...)` 호출 수로 셀 수 있다.
- jsdom의 `getContext`는 null이다. `beforeEach`가 `HTMLCanvasElement.prototype.getContext`를 `recordingGl().gl`을 돌려주는 스텁으로 바꾼다("WebGL2가 되는 기기"). 렌더러 생성 실패를 만들 테스트만 `getContext.mockImplementation(() => null)`로 바꾼다.
- jsdom에는 `ResizeObserver`도 없다. `Points3dView`가 쓰더라도 죽지 않게 `beforeEach`가 빈 구현을 둔다.
- `tabProps(over)`가 기준 props(뷰어 대상인 바닥 분석, 하드웨어 가속, 적재 전)를 만들고, 각 테스트는 그 테스트가 보려는 조건만 덮어쓴다.

```tsx
// 3D 프리뷰 탭 본문(Preview3dTab): 스펙 2026-10-02 pointcloud-viewer §7.11 분기표의 화면,
// 탐지 effect·요청 effect, 다시 시도 전이. 상위(AnalysisResult)가 가진 state(load, support, optedIn)는
// props 로 주입한다. Points3dView 와 createRenderer 는 실제 구현을 쓰고 getContext 만 스텁으로 끼운다.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

// probeWebgl2 만 가짜로 바꾼다. createRenderer 는 실제 것을 남겨야 뷰어 마운트를 getContext 호출 수로 셀 수 있다
vi.mock('@/lib/viz/points3d/gl-renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/viz/points3d/gl-renderer')>()),
  probeWebgl2: vi.fn(),
}));

import { Preview3dTab } from '../preview3d-tab';
import { probeWebgl2 } from '@/lib/viz/points3d/gl-renderer';
import { recordingGl } from '@/lib/viz/points3d/__tests__/gl-stub';
import type { Points3dData, Points3dLoad, Webgl2Support } from '@/lib/domain/points3d';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';

// ---- 화면 문구: 스펙 §7.12 에서 손으로 옮긴 전문(구현의 상수를 가져다 쓰지 않는다) ----
const M1 = '벽면 분석은 3D 프리뷰 이미지와 3D 점군 뷰를 제공하지 않습니다.';
const M2 = '외부 결과(임포트)에는 3D 점군 데이터를 생성하지 않습니다.';
const M3 = '이 분석에는 3D 점군 데이터가 없습니다. 재분석하면 생성됩니다.';
const M4 = '이 기기는 그래픽 가속을 사용할 수 없어 3D 점군 뷰가 느릴 수 있습니다. 기본으로 정적 이미지를 표시합니다.';
const M5 = '3D 점군 데이터를 저장소에서 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.';
const M6 = '3D 점군 데이터 형식을 읽을 수 없습니다. 지원하지 않는 버전이거나 손상된 파일입니다.';
const M7 = '이 브라우저 또는 기기에서는 WebGL2를 사용할 수 없어 3D 점군 뷰를 표시할 수 없습니다.';
const M8 = '그래픽 컨텍스트가 끊겨 3D 점군 뷰를 표시할 수 없습니다. 다시 시도하세요.';
const M9 = '3D 점군 데이터를 불러오는 중입니다.';
const M10 = '엔진이 생성한 정적 3D 프리뷰 이미지입니다. 높이 축은 편차(mm)이며 실제 축 비율이 아닙니다.';
// 없애기로 한 옛 문구(analysis-result.tsx 의 옛 3D 탭 본문)
const OLD_CAPTION = '워커가 생성한 정적 3D 프리뷰입니다';
const OLD_EMPTY = '3D 프리뷰가 없습니다';

const DIR_A = 'artifacts/an1';
const DIR_B = 'artifacts/an2';

// ---- 픽스처 ----
/** 뷰어 대상인 바닥 분석의 stats: 정적 PNG 1장, 점 파일, 표시 임계값 70(7mm)이 다 있다. */
function statsOf(extra: Partial<Stats> = {}): Stats {
  return {
    n_cells: 1, n_valid: 1,
    grade_counts: { pass: 1, borderline: 0, repair: 0, rework: 0, na: 0 },
    grade_pct: { pass: 100, borderline: 0, repair: 0, rework: 0, na: 0 },
    value_max_mm: 3.2, value_min_mm: 3.2, value_mean_mm: 3.2, value_p95_mm: 3.2,
    worst: null, coverage_pct: 98.0, reduced_span_cells: 0,
    applied_criteria: { name: 'floor-kcs-exposed', source: 'KCS 14 20 10', span_m: 3,
                        pass_mm: 7, rework_mm: 21, u_mm: 5 },
    warnings: [], zones: [],
    meta: { file: 'raw.ply', n_points: 100, surface: 'floor', engine_version: 'p4-0.5.0' },
    auto_summary: '자동 의견',
    preview3d_paths: ['preview3d.png'],
    points3d_paths: ['points3d.bin'],
    points3d_threshold_q: 70,
    ...extra,
  };
}

function analysisOf(stats: Stats, over: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    id: 'an1', scan_id: 'scan1', surface: 'floor', criteria_id: 'c1', applied_criteria: null,
    params: {}, engine_version: 'p4-0.5.0', status: 'done', stats, coverage_pct: 98.0,
    overall_verdict: 'pass', warnings: [], artifacts_dir: DIR_A,
    auto_summary: '자동 의견', user_summary: null, is_current: true, deleted_at: null,
    created_at: '2026-10-02', created_by: null, kind: 'flatness',
    ...over,
  };
}

const SCAN: ScanRow = {
  id: 'scan1', location_id: 'loc1', surface: 'floor', scanned_at: '2026-10-01', device: null,
  operator_id: null, operator_name_manual: null, selected_criteria_id: null,
  raw_file_path: null, original_filename: null, file_format: null, point_count: null,
  unit_scale: null, lineage: 'raw', status: 'ready', height_view_path: null, deleted_at: null,
  created_at: '2026-10-01', updated_at: '2026-10-01',
};

/** 손으로 만든 점 3개짜리 데이터. 범위 4.0 x 2.5 x 0.3125 m, 편차 0 / +3.2mm / -10.5mm. */
const DATA: Points3dData = {
  meta: {
    schema_version: 1, n_points: 3, units: 'm',
    origin_m: [254012.8371, 4180045.1626, 31.6052], extent_m: [4.0, 2.5, 0.3125],
    deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
    sample_cell_m: 0.0125,
    fit_bounds: { min: [0, 0, 0], max: [4.0, 2.5, 0.1] },
    sampling: { method: 'cell min-hash stratified', source_points: 12345, cap: 500000 },
    order: 'hash',
  },
  xyz: new Uint16Array([0, 0, 0, 65535, 65535, 4096, 32768, 16384, 8192]),
  dev: new Int16Array([0, 32, -105]),
};

const IDLE: Points3dLoad = { status: 'idle' };
const LOADING_A: Points3dLoad = { status: 'loading', dir: DIR_A };
const READY_A: Points3dLoad = { status: 'ready', dir: DIR_A, data: DATA };
const FETCH_ERROR_A: Points3dLoad = { status: 'error', dir: DIR_A, reason: 'fetch' };
const FORMAT_ERROR_A: Points3dLoad = { status: 'error', dir: DIR_A, reason: 'format' };

type TabProps = Parameters<typeof Preview3dTab>[0];

function spies() {
  return { onSupport: vi.fn(), onOptIn: vi.fn(), onRequestLoad: vi.fn(), onRetryLoad: vi.fn() };
}

/** 기준 props: 뷰어 대상인 바닥 분석, 하드웨어 가속, 적재 전(idle), 소프트웨어 렌더 선택 안 함.
 *  stats 를 덮어쓰면 analysis.stats 도 같은 객체가 된다(analysis 를 따로 주면 그 값이 이긴다). */
function tabProps(over: Partial<TabProps> = {}): TabProps {
  const stats = over.stats ?? statsOf();
  return {
    analysis: analysisOf(stats), stats, scan: SCAN, isImport: false,
    load: IDLE, support: 'hardware', optedIn: false,
    ...spies(),
    ...over,
  };
}

/** 상위(AnalysisResult)처럼 support 를 state 로 들고 onSupport 로 갱신하는 최소 부모.
 *  "다시 탐지" 흐름을 끝까지 돌려야 하는 테스트에서만 쓴다. */
function SupportOwner({ initial, log, tab }: {
  initial: Webgl2Support | null;
  log: (s: Webgl2Support | null) => void;
  tab: TabProps;
}) {
  const [support, setSupport] = useState<Webgl2Support | null>(initial);
  return <Preview3dTab {...tab} support={support} onSupport={(s) => { log(s); setSupport(s); }} />;
}

// ---- DOM 헬퍼 ----
const probe = vi.mocked(probeWebgl2);
let getContext: MockInstance<HTMLCanvasElement['getContext']>;

/** Points3dView 가 마운트된 횟수 = canvas.getContext('webgl2', ...) 호출 수(마운트마다 한 번). */
function viewerMounts(): number {
  return getContext.mock.calls.filter((call) => call[0] === 'webgl2').length;
}
function viewerCanvas(): HTMLElement | null {
  return screen.queryByRole('img', { name: '3D 점군 뷰어' });
}
function pngImage(): HTMLElement | null {
  return screen.queryByAltText('3D 프리뷰 preview3d.png');
}
function retryButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: '다시 시도' });
}
function onlyAlert(container: HTMLElement): HTMLElement {
  const found = container.querySelectorAll<HTMLElement>('[data-alert]');
  expect(found).toHaveLength(1);
  return found[0];
}
/** 문서 순서로 a 다음에 b 가 오는가. */
function isBefore(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}
/** 대체 화면 공통: 옛 문구와 옛 팔레트 부분 문자열이 없다. */
function expectNoLegacy(container: HTMLElement) {
  expect(container.textContent).not.toContain(OLD_CAPTION);
  expect(container.textContent).not.toContain(OLD_EMPTY);
  expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-|green-|purple-/);
}

beforeEach(() => {
  probe.mockReset();
  probe.mockReturnValue('hardware');
  // jsdom 의 getContext 는 null 이다. 기본은 "WebGL2 가 되는 기기"로 두고 필요한 테스트만 null 로 바꾼다
  getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => recordingGl().gl);
  // jsdom 에는 ResizeObserver 도 없다. Points3dView 가 쓰더라도 죽지 않게 빈 구현을 둔다
  if (!('ResizeObserver' in globalThis)) {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 모드별 화면 (§7.11 분기표의 화면 열)', () => {
  it('wall: 안내 M1 한 줄뿐이다(Alert·버튼·이미지·캡션 없음)', () => {
    const stats = statsOf();   // 정적 PNG 와 점 파일 키가 있어도 벽면이면 M1 만 낸다
    const { container } = render(
      <Preview3dTab {...tabProps({ stats, analysis: analysisOf(stats, { surface: 'wall' }) })} />,
    );

    expect(screen.getByText(M1).tagName).toBe('P');
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(M10)).toBeNull();
    expect(viewerCanvas()).toBeNull();
    expectNoLegacy(container);
  });

  it('import: 정적 PNG + 캡션 M10 + 안내 M2. 재분석을 권하지 않는다', () => {
    const { container } = render(<Preview3dTab {...tabProps({ isImport: true })} />);

    const img = pngImage() as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/data/artifacts/an1/preview3d.png');
    expect(img.className).toBe('max-w-full rounded-lg border border-cs-divider bg-white');
    expect(screen.getByText(M10)).toBeInTheDocument();
    const note = screen.getByText(M2);
    expect(note.tagName).toBe('P');
    expect(isBefore(img, note)).toBe(true);
    expect(container.textContent).not.toContain('재분석');
    expect(screen.queryByText(M3)).toBeNull();
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expectNoLegacy(container);
  });

  it('import: 정적 PNG 가 없으면 이미지와 캡션 없이 M2 만 낸다', () => {
    const { container } = render(
      <Preview3dTab {...tabProps({ isImport: true, stats: statsOf({ preview3d_paths: undefined }) })} />,
    );

    expect(screen.getByText(M2)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(M10)).toBeNull();
  });

  it('no_data: 정적 PNG(빈 이름은 거른다) + 캡션 M10 + 안내 M3. Alert 와 버튼이 없다', () => {
    const stats = statsOf({
      preview3d_paths: ['', 'preview3d.png', 'preview3d_zone2.png'],
      points3d_paths: undefined, points3d_threshold_q: undefined,   // 옛 분석: 점 파일 키가 없다
    });
    const { container } = render(<Preview3dTab {...tabProps({ stats })} />);

    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.map((el) => el.getAttribute('src'))).toEqual([
      '/api/data/artifacts/an1/preview3d.png',
      '/api/data/artifacts/an1/preview3d_zone2.png',
    ]);
    expect(imgs.map((el) => el.getAttribute('alt'))).toEqual([
      '3D 프리뷰 preview3d.png',
      '3D 프리뷰 preview3d_zone2.png',
    ]);
    expect(screen.getAllByText(M10)).toHaveLength(1);
    const note = screen.getByText(M3);
    expect(note.tagName).toBe('P');
    expect(isBefore(imgs[1], note)).toBe(true);
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expectNoLegacy(container);
  });

  it('no_data: 정적 PNG 목록이 비면 이미지와 캡션 없이 M3 만 낸다', () => {
    const stats = statsOf({ preview3d_paths: [], points3d_paths: [], points3d_threshold_q: undefined });
    const { container } = render(<Preview3dTab {...tabProps({ stats })} />);

    expect(screen.getByText(M3)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(M10)).toBeNull();
  });

  it('no_data: artifacts_dir 가 없으면 정적 PNG 이름이 있어도 이미지를 그리지 않는다', () => {
    const stats = statsOf();
    const { container } = render(
      <Preview3dTab {...tabProps({ stats, analysis: analysisOf(stats, { artifacts_dir: null }) })} />,
    );

    expect(screen.getByText(M3)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(M10)).toBeNull();
  });

  it('error_stats: Alert(error) M6 + 정적 PNG. 다시 시도 버튼이 없다', () => {
    const stats = statsOf({ points3d_threshold_q: undefined });   // 점 파일은 있는데 표시 임계값이 없다
    const { container } = render(<Preview3dTab {...tabProps({ stats })} />);

    const alert = onlyAlert(container);
    expect(alert.getAttribute('data-alert')).toBe('error');
    expect(within(alert).getByText(M6)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    const img = pngImage() as HTMLElement;
    expect(img).toBeInTheDocument();
    expect(isBefore(alert, img)).toBe(true);
    expect(screen.getByText(M10)).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();
    expectNoLegacy(container);
  });

  it.each<[string, Partial<TabProps>]>([
    ['탐지 전(support null). 점 데이터가 이미 ready 여도 로딩 틀이다', { support: null, load: READY_A }],
    ['적재 전(idle)', { support: 'hardware', load: IDLE }],
    ['받는 중(loading)', { support: 'hardware', load: LOADING_A }],
  ])('loading: 검정 로딩 틀과 M9 를 낸다: %s', (_label, over) => {
    const { container } = render(<Preview3dTab {...tabProps(over)} />);

    const frame = screen.getByTestId('points3d-loading');
    expect(frame).toHaveStyle({ backgroundColor: '#000000' });   // dark 테마. 밝은 틀이 번쩍이지 않는다
    expect(within(frame).getByText(M9)).toBeInTheDocument();
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(viewerCanvas()).toBeNull();
    expect(viewerMounts()).toBe(0);
    expectNoLegacy(container);
  });

  it.each<[string, Partial<TabProps>, string, string]>([
    ['error_webgl(WebGL2 불가)', { support: 'unsupported' }, 'warning', M7],
    ['error_fetch', { load: FETCH_ERROR_A }, 'error', M5],
    ['error_format', { load: FORMAT_ERROR_A }, 'error', M6],
  ])('%s: Alert + 다시 시도 + 정적 PNG 순서로 낸다', (_label, over, alertType, message) => {
    const { container } = render(<Preview3dTab {...tabProps(over)} />);

    const alert = onlyAlert(container);
    expect(alert.getAttribute('data-alert')).toBe(alertType);
    expect(within(alert).getByText(message)).toBeInTheDocument();
    const retry = retryButton() as HTMLElement;
    expect(retry.className).toContain('bg-transparent');   // Button 의 normal 변형
    expect(retry.className).not.toContain('text-white');   // primary 가 아니다
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const img = pngImage() as HTMLElement;
    expect(isBefore(alert, retry)).toBe(true);
    expect(isBefore(retry, img)).toBe(true);
    expect(screen.getByText(M10)).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();
    expectNoLegacy(container);
  });

  it('software_prompt: 정적 PNG + Alert(info) M4 + "3D로 보기" 순서로 낸다. 다시 시도는 없다', () => {
    const { container } = render(<Preview3dTab {...tabProps({ support: 'software', optedIn: false })} />);

    const img = pngImage() as HTMLElement;
    const alert = onlyAlert(container);
    expect(alert.getAttribute('data-alert')).toBe('info');
    expect(within(alert).getByText(M4)).toBeInTheDocument();
    const optIn = screen.getByRole('button', { name: '3D로 보기' });
    expect(optIn.className).toContain('bg-transparent');
    expect(optIn.className).not.toContain('text-white');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(retryButton()).toBeNull();
    expect(isBefore(img, alert)).toBe(true);
    expect(isBefore(alert, optIn)).toBe(true);
    expect(screen.getByText(M10)).toBeInTheDocument();
    expectNoLegacy(container);
  });

  it('viewer: Points3dView 를 그리고 정적 PNG 는 그리지 않는다. stats 의 표시 임계값을 넘긴다', () => {
    const cb = spies();
    const stats = statsOf({ points3d_threshold_q: 60 });   // 픽스처 기본값(70)과 다른 값
    const { container } = render(<Preview3dTab {...tabProps({ ...cb, stats, load: READY_A })} />);

    expect(viewerCanvas()).toBeInTheDocument();
    expect(viewerMounts()).toBe(1);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(M10)).toBeNull();
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect((screen.getByLabelText('표시 임계값(mm)') as HTMLInputElement).value).toBe('60');
    expect(screen.queryByTestId('points3d-merged-note')).toBeNull();   // lineage 'raw'
    expect(probe).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
  });

  it('viewer: 정합 병합 스캔(lineage registered)이면 병합 안내가 나온다', () => {
    render(<Preview3dTab {...tabProps({ load: READY_A, scan: { ...SCAN, lineage: 'registered' } })} />);

    expect(viewerCanvas()).toBeInTheDocument();
    expect(screen.getByTestId('points3d-merged-note')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/preview3d-tab.test.tsx`

Expected: FAIL. `Test Files  1 failed (1)`, `Tests  no tests`. 오류는 `Error: Failed to resolve import "../preview3d-tab" from "components/analysis/__tests__/preview3d-tab.test.tsx". Does the file exist?` 한 가지다(컴포넌트 파일이 아직 없다).

- [ ] **Step 4: 최소 구현 (화면 분기만)**

`dashboard/components/analysis/preview3d-tab.tsx`를 새로 만들고 다음 내용을 넣는다. 이 단계의 구현은 모드별 화면만 그린다. effect와 버튼 동작, 오류 플래그는 Step 8에서 넣는다(그래서 `rendererFailed`·`contextLost`가 여기서는 상수 `false`이고 버튼에 `onClick`이 없다).

```tsx
// 3D 프리뷰 탭 본문 - 뷰어 / 기존 정적 PNG / 경우별 안내 분기(스펙 2026-10-02 pointcloud-viewer §7.11).
// 어느 화면을 낼지는 lib/domain/points3d.ts 의 resolvePreview3dMode(분기표를 옮긴 순수 함수)가 정한다.
'use client';
import { artifactUrl } from '@/lib/domain/paths';
import { defaultThresholdQ, loadFor, points3dFile, resolvePreview3dMode } from '@/lib/domain/points3d';
import type { Points3dLoad, Preview3dInput, Webgl2Support } from '@/lib/domain/points3d';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Points3dLoadingFrame, Points3dView } from './points3d-view';

// 화면 문구(스펙 §7.12 전문 그대로). M9(로딩)는 Points3dLoadingFrame 이 갖는다.
const M1 = '벽면 분석은 3D 프리뷰 이미지와 3D 점군 뷰를 제공하지 않습니다.';
const M2 = '외부 결과(임포트)에는 3D 점군 데이터를 생성하지 않습니다.';
const M3 = '이 분석에는 3D 점군 데이터가 없습니다. 재분석하면 생성됩니다.';
const M4 = '이 기기는 그래픽 가속을 사용할 수 없어 3D 점군 뷰가 느릴 수 있습니다. 기본으로 정적 이미지를 표시합니다.';
const M5 = '3D 점군 데이터를 저장소에서 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.';
const M6 = '3D 점군 데이터 형식을 읽을 수 없습니다. 지원하지 않는 버전이거나 손상된 파일입니다.';
const M7 = '이 브라우저 또는 기기에서는 WebGL2를 사용할 수 없어 3D 점군 뷰를 표시할 수 없습니다.';
const M8 = '그래픽 컨텍스트가 끊겨 3D 점군 뷰를 표시할 수 없습니다. 다시 시도하세요.';
const M10 = '엔진이 생성한 정적 3D 프리뷰 이미지입니다. 높이 축은 편차(mm)이며 실제 축 비율이 아닙니다.';

const STACK = 'flex flex-col gap-3';
const MUTED = 'text-sm text-cs-text-secondary';

export function Preview3dTab({ analysis, stats, scan, isImport, load, support, optedIn }: {
  analysis: AnalysisRow; stats: Stats; scan: ScanRow; isImport: boolean;
  load: Points3dLoad;                         // 상위가 가진 적재 상태. 그대로 받는다
  support: Webgl2Support | null;              // 상위가 가진 탐지 결과. null = 아직 탐지 전
  optedIn: boolean;                           // 상위가 가진 소프트웨어 렌더 선택
  onSupport(s: Webgl2Support | null): void;   // 탐지 결과를 상위에 올린다. null = 다시 탐지하겠다
  onOptIn(): void;                            // "3D로 보기"를 눌렀다
  onRequestLoad(): void;                      // 점 파일을 받아 달라(상위에서 멱등)
  onRetryLoad(): void;                        // 적재 상태를 버리고 곧바로 다시 받는다
}) {
  const dir = analysis.artifacts_dir;
  const thresholdQ = defaultThresholdQ(stats);
  const input: Preview3dInput = {
    surface: analysis.surface, isImport, dir, file: points3dFile(stats), thresholdQ,
    support, optedIn, load, rendererFailed: false, contextLost: false,
  };
  const mode = resolvePreview3dMode(input);

  // viewer: 뷰어가 보일 때는 정적 PNG 를 함께 그리지 않는다.
  // 넘기는 점 데이터는 지금 분석의 것(loadFor)이다. 다른 분석의 ready 는 idle 로 읽힌다
  const current = loadFor(load, dir);
  if (mode === 'viewer' && current.status === 'ready' && thresholdQ !== null) {
    return (
      <Points3dView data={current.data} defaultThresholdQ={thresholdQ}
        isRegistered={scan.lineage === 'registered'} onError={() => {}} />
    );
  }

  // 기존 정적 PNG. 대체 화면에서만 그린다. artifacts_dir 가 없거나 목록이 비면 이미지도 캡션도 없다
  const images = (stats.preview3d_paths ?? []).filter(Boolean);
  const png = dir !== null && images.length > 0 && (
    <div className={STACK}>
      {images.map((name) => (
        // 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
        // eslint-disable-next-line @next/next/no-img-element
        <img key={name} src={artifactUrl(dir, name)} alt={`3D 프리뷰 ${name}`}
          className="max-w-full rounded-lg border border-cs-divider bg-white" />
      ))}
      <p className="text-xs leading-4 text-cs-text-secondary">{M10}</p>
    </div>
  );

  switch (mode) {
    case 'wall':        // 1행. 벽면은 정적 PNG 도 점군 뷰도 없다
      return <p className={MUTED}>{M1}</p>;
    case 'import':      // 2행. 임포트는 점 파일을 만들지 않는다. 재분석을 권하지 않는다
      return <div className={STACK}>{png}<p className={MUTED}>{M2}</p></div>;
    case 'no_data':     // 3행. 점 파일이 없는 옛 분석이거나 점 파일 생성에 실패한 분석
      return <div className={STACK}>{png}<p className={MUTED}>{M3}</p></div>;
    case 'error_stats': // 4행. 계약 위반이라 Alert 로 드러내지만 다시 시도로 고칠 수 없어 버튼이 없다
      return <div className={STACK}><Alert type="error">{M6}</Alert>{png}</div>;
    case 'error_webgl': // 6행
      return (
        <div className={STACK}>
          <Alert type="warning">{M7}</Alert>
          <div><Button>다시 시도</Button></div>
          {png}
        </div>
      );
    case 'software_prompt': // 7행. 기본은 정적 이미지, 사용자가 고르면 3D
      return (
        <div className={STACK}>
          {png}
          <Alert type="info">{M4}</Alert>
          <div><Button>3D로 보기</Button></div>
        </div>
      );
    case 'error_fetch':  // 8행
    case 'error_format': // 9행
      return (
        <div className={STACK}>
          <Alert type="error">{mode === 'error_fetch' ? M5 : M6}</Alert>
          <div><Button>다시 시도</Button></div>
          {png}
        </div>
      );
    case 'error_context': // 10행
      return (
        <div className={STACK}>
          <Alert type="error">{M8}</Alert>
          <div><Button>다시 시도</Button></div>
          {png}
        </div>
      );
    case 'loading':     // 5·11행. 로딩 틀은 뷰어 영역과 같은 검정이다
    case 'viewer':      // 위의 if 가 이미 그렸다. 여기는 타입을 좁히기 위한 자리이며 도달하지 않는다
      return <Points3dLoadingFrame theme="dark" />;
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/preview3d-tab.test.tsx`

Expected: PASS. `Test Files  1 passed (1)`, `Tests  16 passed (16)`.

- [ ] **Step 6: 실패하는 테스트 추가 (뷰어 대상 아님, 탐지 effect, 요청 effect, 소프트웨어 렌더, 다시 시도, 분석 전환)**

`dashboard/components/analysis/__tests__/preview3d-tab.test.tsx`의 맨 끝에 빈 줄 하나를 두고 다음 블록을 붙인다. Step 2에서 쓴 머리의 픽스처와 헬퍼(`tabProps`, `spies`, `SupportOwner`, `viewerMounts`, `viewerCanvas`, `pngImage`, `retryButton`, `onlyAlert`, `isBefore`, `probe`, `getContext`)를 그대로 쓴다.

테스트의 구조:
- 대부분은 props를 직접 준다. 상위가 state를 바꾼 뒤의 모습은 `rerender`로 새 props를 줘서 만든다.
- `error_webgl(렌더러 생성 실패)` 테스트만 `SupportOwner`(상위처럼 `support`를 state로 들고 `onSupport`로 갱신하는 최소 부모)를 쓴다. 다시 시도 → `onSupport(null)` → 다시 탐지 → 뷰어로 이어지는 흐름은 상위가 `support`를 실제로 바꿔 줘야 끝까지 돈다. `vi.fn()`만 주면 `support`가 그대로라 뷰어가 곧바로 다시 마운트되어 흐름을 확인할 수 없다.
- `error_context` 테스트는 가짜 타이머를 쓴다. 캔버스에 `webglcontextlost`를 보내고 3,000ms를 넘기면 실제 `createRenderer`가 `on.unrecoverable()`을 부르고 `Points3dView`가 `onError('context')`를 알린다.
- 분석 전환 테스트는 상위(Task 14)가 하듯 `key`를 바꿔 다시 렌더한다.

```tsx
// ---------------------------------------------------------------------------
describe('Preview3dTab 뷰어 대상이 아닌 분석 (§7.11 의 1~4행)', () => {
  it('대조군: 뷰어 대상이면 탐지 전에는 탐지하고, 하드웨어 + idle 이면 적재를 요청한다', () => {
    const a = spies();
    render(<Preview3dTab {...tabProps({ ...a, support: null })} />);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(a.onSupport).toHaveBeenCalledTimes(1);

    const b = spies();
    render(<Preview3dTab {...tabProps({ ...b, support: 'hardware', load: IDLE })} />);
    expect(b.onRequestLoad).toHaveBeenCalledTimes(1);
  });

  const NON_VIEWER: [string, () => Partial<TabProps>][] = [
    ['벽면', () => { const s = statsOf(); return { stats: s, analysis: analysisOf(s, { surface: 'wall' }) }; }],
    ['임포트', () => ({ isImport: true })],
    ['artifacts_dir 없음', () => { const s = statsOf(); return { stats: s, analysis: analysisOf(s, { artifacts_dir: null }) }; }],
    ['점 파일 없음', () => ({ stats: statsOf({ points3d_paths: undefined, points3d_threshold_q: undefined }) })],
    ['표시 임계값 없음(error_stats)', () => ({ stats: statsOf({ points3d_threshold_q: undefined }) })],
  ];

  it.each(NON_VIEWER)('%s: 탐지 전이어도 probeWebgl2 를 부르지 않는다', (_label, over) => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, ...over(), support: null, load: IDLE })} />);

    expect(probe).not.toHaveBeenCalled();
    expect(cb.onSupport).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
    expect(screen.queryByTestId('points3d-loading')).toBeNull();   // 5행(로딩 틀)으로 가지 않는다
  });

  it.each(NON_VIEWER)('%s: 하드웨어 + idle 이어도 적재를 요청하지 않는다', (_label, over) => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, ...over(), support: 'hardware', load: IDLE })} />);

    expect(cb.onRequestLoad).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(viewerMounts()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 탐지 effect (§7.3 의 2번)', () => {
  it('support 가 null 이면 마운트 때 한 번 탐지해 결과를 onSupport 로 올린다. 탐지 전에는 적재를 요청하지 않는다', () => {
    probe.mockReturnValue('software');   // 기본값(hardware)과 다른 값: 결과를 그대로 올리는지 본다
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, support: null })} />);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(cb.onSupport.mock.calls).toEqual([['software']]);
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
  });

  it.each<[Webgl2Support]>([['hardware'], ['software'], ['unsupported']])(
    'support 가 이미 있으면(%s) 다시 탐지하지 않는다',
    (support) => {
      const cb = spies();
      render(<Preview3dTab {...tabProps({ ...cb, support })} />);

      expect(probe).not.toHaveBeenCalled();
      expect(cb.onSupport).not.toHaveBeenCalled();
    },
  );

  it('상위가 아직 support 를 올려 주지 않은 채 다시 렌더해도 탐지를 반복하지 않는다', () => {
    const first = spies();
    const { rerender } = render(<Preview3dTab {...tabProps({ ...first, support: null })} />);
    const second = spies();   // 상위가 다시 렌더하면 콜백의 정체가 바뀐다
    rerender(<Preview3dTab {...tabProps({ ...second, support: null })} />);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(first.onSupport).toHaveBeenCalledTimes(1);
    expect(second.onSupport).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 요청 effect (§7.3 의 3번)', () => {
  it('하드웨어 + idle 이면 마운트 때 onRequestLoad 를 한 번 부른다', () => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, support: 'hardware', load: IDLE })} />);

    expect(cb.onRequestLoad).toHaveBeenCalledTimes(1);
    expect(cb.onRetryLoad).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<TabProps>]>([
    ['받는 중', { load: LOADING_A }],
    ['ready', { load: READY_A }],
    ['fetch 오류', { load: FETCH_ERROR_A }],
    ['형식 오류', { load: FORMAT_ERROR_A }],
    ['WebGL2 불가 + idle', { support: 'unsupported', load: IDLE }],
  ])('요청하지 않는다: %s', (_label, over) => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, ...over })} />);

    expect(cb.onRequestLoad).not.toHaveBeenCalled();
    expect(cb.onRetryLoad).not.toHaveBeenCalled();
  });

  it('상위가 아직 load 를 바꾸지 않은 채 다시 렌더해도 요청을 반복하지 않는다', () => {
    const first = spies();
    const { rerender } = render(<Preview3dTab {...tabProps({ ...first, load: IDLE })} />);
    const second = spies();
    rerender(<Preview3dTab {...tabProps({ ...second, load: IDLE })} />);

    expect(first.onRequestLoad).toHaveBeenCalledTimes(1);
    expect(second.onRequestLoad).not.toHaveBeenCalled();
  });

  it('같은 인스턴스에서 artifacts_dir 가 바뀌면 요청 여부가 그대로 참이어도 다시 요청한다', () => {
    const cb = spies();
    const stats = statsOf();
    const { rerender } = render(<Preview3dTab {...tabProps({ ...cb, stats, load: IDLE })} />);
    expect(cb.onRequestLoad).toHaveBeenCalledTimes(1);

    rerender(
      <Preview3dTab {...tabProps({ ...cb, stats, load: IDLE,
        analysis: analysisOf(stats, { id: 'an2', artifacts_dir: DIR_B }) })} />,
    );
    expect(cb.onRequestLoad).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 소프트웨어 렌더 (§7.11 의 7행)', () => {
  it('"3D로 보기"를 누르기 전에는 요청하지 않고, 누르면 onOptIn, optedIn 이 참이 되면 요청한다', () => {
    const cb = spies();
    const { rerender } = render(
      <Preview3dTab {...tabProps({ ...cb, support: 'software', optedIn: false, load: IDLE })} />,
    );
    expect(cb.onRequestLoad).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '3D로 보기' }));
    expect(cb.onOptIn).toHaveBeenCalledTimes(1);
    expect(cb.onRequestLoad).not.toHaveBeenCalled();   // 선택은 상위 state 다. 상위가 optedIn 을 줄 때까지 기다린다

    rerender(<Preview3dTab {...tabProps({ ...cb, support: 'software', optedIn: true, load: IDLE })} />);
    expect(cb.onRequestLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('points3d-loading')).toBeInTheDocument();
    expect(probe).not.toHaveBeenCalled();
  });

  it('재진입: 선택을 마친 소프트웨어 렌더 기기는 점 데이터가 ready 면 곧바로 뷰어다', () => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, support: 'software', optedIn: true, load: READY_A })} />);

    expect(viewerCanvas()).toBeInTheDocument();
    expect(viewerMounts()).toBe(1);
    expect(screen.queryByRole('button', { name: '3D로 보기' })).toBeNull();
    expect(probe).not.toHaveBeenCalled();
    expect(cb.onSupport).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
  });

  it('재진입: 선택하지 않았으면 점 데이터가 ready 여도 software_prompt 이고 뷰어를 마운트하지 않는다', () => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, support: 'software', optedIn: false, load: READY_A })} />);

    expect(screen.getByRole('button', { name: '3D로 보기' })).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();
    expect(viewerMounts()).toBe(0);
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 다시 시도 (§7.11 의 상태 전이 표)', () => {
  it.each<[string, Points3dLoad]>([
    ['error_fetch', FETCH_ERROR_A],
    ['error_format', FORMAT_ERROR_A],
  ])('%s: onRetryLoad 를 한 번 부른다(다시 탐지하지 않는다)', (_label, load) => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, load })} />);

    fireEvent.click(retryButton() as HTMLElement);

    expect(cb.onRetryLoad).toHaveBeenCalledTimes(1);
    expect(cb.onSupport).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it('error_webgl(WebGL2 불가): onSupport(null) 로 다시 탐지하겠다고 알린다', () => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, support: 'unsupported', load: IDLE })} />);

    fireEvent.click(retryButton() as HTMLElement);

    expect(cb.onSupport.mock.calls).toEqual([[null]]);
    expect(cb.onRetryLoad).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
  });

  it('error_webgl(렌더러 생성 실패): 다시 시도가 실패 플래그를 되돌리고 다시 탐지해 뷰어로 돌아온다', () => {
    getContext.mockImplementation(() => null);   // createRenderer 가 null 을 돌려준다 -> onError('webgl')
    const log = vi.fn();
    const cb = spies();
    const { container } = render(
      <SupportOwner initial="hardware" log={log} tab={tabProps({ ...cb, load: READY_A })} />,
    );

    // 뷰어가 한 번 마운트됐다가 실패를 알려 error_webgl 이 됐다
    expect(viewerMounts()).toBe(1);
    const alert = onlyAlert(container);
    expect(alert.getAttribute('data-alert')).toBe('warning');
    expect(within(alert).getByText(M7)).toBeInTheDocument();
    expect(pngImage()).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();
    expect(log).not.toHaveBeenCalled();

    // 그래픽 장치가 돌아온 뒤 다시 시도한다
    getContext.mockImplementation(() => recordingGl().gl);
    fireEvent.click(retryButton() as HTMLElement);

    expect(log.mock.calls).toEqual([[null], ['hardware']]);   // 다시 탐지하겠다 -> 탐지 결과
    expect(probe).toHaveBeenCalledTimes(1);
    expect(viewerCanvas()).toBeInTheDocument();                // error_webgl 을 벗어났다
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(viewerMounts()).toBe(2);
    expect(cb.onRetryLoad).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();           // 점 데이터가 ready 로 남아 있어 다시 받지 않는다
  });

  it('error_context: 손실 후 3,000ms 가 지나면 Alert(error) M8, 다시 시도는 뷰어를 새로 마운트하고 다시 받지 않는다', () => {
    vi.useFakeTimers();
    const cb = spies();
    const { container } = render(<Preview3dTab {...tabProps({ ...cb, load: READY_A })} />);
    const canvas = viewerCanvas() as HTMLElement;
    expect(viewerMounts()).toBe(1);

    fireEvent(canvas, new Event('webglcontextlost', { cancelable: true }));
    act(() => { vi.advanceTimersByTime(2999); });
    expect(container.querySelector('[data-alert]')).toBeNull();   // 복구를 기다리는 동안은 viewer 모드 그대로
    expect(viewerCanvas()).toBe(canvas);
    act(() => { vi.advanceTimersByTime(1); });

    const alert = onlyAlert(container);
    expect(alert.getAttribute('data-alert')).toBe('error');
    expect(within(alert).getByText(M8)).toBeInTheDocument();
    const retry = retryButton() as HTMLElement;
    const img = pngImage() as HTMLElement;
    expect(isBefore(alert, retry)).toBe(true);
    expect(isBefore(retry, img)).toBe(true);
    expect(screen.getByText(M10)).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();

    fireEvent.click(retry);

    const again = viewerCanvas();
    expect(again).not.toBeNull();
    expect(again).not.toBe(canvas);            // 끊긴 canvas 를 재사용하지 않는다
    expect(viewerMounts()).toBe(2);
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(cb.onRetryLoad).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
    expect(cb.onSupport).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 분석 전환 (§7.3: 상위가 key={analysis.id} 로 그린다)', () => {
  it('key 와 analysis 가 바뀌면 오류 플래그가 남지 않고, 이전 분석의 ready 는 로딩 틀이며 새로 요청한다', () => {
    getContext.mockImplementation(() => null);   // 분석 A 에서 렌더러 생성 실패 -> rendererFailed
    const a = spies();
    const statsA = statsOf();
    const { container, rerender } = render(
      <Preview3dTab key="an1" {...tabProps({ ...a, stats: statsA, load: READY_A })} />,
    );
    expect(onlyAlert(container).getAttribute('data-alert')).toBe('warning');
    expect(viewerMounts()).toBe(1);

    // 분석 B 로 전환. 상위의 load 에는 아직 분석 A 의 ready 가 남아 있다
    getContext.mockImplementation(() => recordingGl().gl);
    const b = spies();
    const statsB = statsOf({ points3d_threshold_q: 60 });
    const analysisB = analysisOf(statsB, { id: 'an2', artifacts_dir: DIR_B });
    rerender(
      <Preview3dTab key="an2" {...tabProps({ ...b, stats: statsB, analysis: analysisB, load: READY_A })} />,
    );

    expect(container.querySelector('[data-alert]')).toBeNull();     // rendererFailed 가 남았다면 error_webgl 이다
    expect(screen.getByTestId('points3d-loading')).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();                              // 분석 A 의 점으로 뷰어를 그리지 않는다
    expect(viewerMounts()).toBe(1);
    expect(b.onRequestLoad).toHaveBeenCalledTimes(1);
    expect(a.onRequestLoad).not.toHaveBeenCalled();

    // 분석 B 의 점이 도착하면 B 의 표시 임계값으로 뷰어가 뜬다
    rerender(
      <Preview3dTab key="an2" {...tabProps({ ...b, stats: statsB, analysis: analysisB,
        load: { status: 'ready', dir: DIR_B, data: DATA } })} />,
    );
    expect(viewerCanvas()).toBeInTheDocument();
    expect((screen.getByLabelText('표시 임계값(mm)') as HTMLInputElement).value).toBe('60');
    expect(b.onRequestLoad).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/preview3d-tab.test.tsx`

Expected: FAIL. `Tests  13 failed | 36 passed (49)`. 실패하는 13건:
- `뷰어 대상이 아닌 분석 > 대조군: ...`
- `탐지 effect > support 가 null 이면 마운트 때 한 번 탐지해 ...`, `탐지 effect > 상위가 아직 support 를 올려 주지 않은 채 ...`
- `요청 effect > 하드웨어 + idle 이면 ...`, `요청 effect > 상위가 아직 load 를 바꾸지 않은 채 ...`, `요청 effect > 같은 인스턴스에서 artifacts_dir 가 바뀌면 ...`
- `소프트웨어 렌더 > "3D로 보기"를 누르기 전에는 ...`
- `다시 시도` 5건 전부(`error_fetch`, `error_format`, `error_webgl(WebGL2 불가)`, `error_webgl(렌더러 생성 실패)`, `error_context`)
- `분석 전환 > key 와 analysis 가 바뀌면 ...`

실패 사유는 전부 `AssertionError`이고 세 종류다: `expected "vi.fn()" to be called 1 times, but got 0 times`(9건. 콜백이나 `probeWebgl2`가 불리지 않음), `expected [] to deeply equal [ [ null ] ]`(1건. `error_webgl(WebGL2 불가)`), `expected  to have a length of 1 but got +0`(3건. `error_webgl(렌더러 생성 실패)`·`error_context`·`분석 전환`에서 Alert를 찾지 못함). import 오류나 `TypeError`로 실패하면 Step 2·6의 코드를 다시 대조한다. 이미 통과하는 20건은 "부르지 않는다"는 단언이다(effect가 아직 없어서 통과한다).

- [ ] **Step 8: 구현 완성 (effect, 오류 플래그, 다시 시도)**

`dashboard/components/analysis/preview3d-tab.tsx`의 내용 전체를 다음으로 바꾼다. Step 4의 구현에서 달라지는 곳:
- 머리 주석에 상위 state와 로컬 state의 구분을 적는다.
- import: `react`에서 `useCallback`, `useEffect`, `useState`. `@/lib/domain/points3d`에서 `shouldProbe`, `shouldRequestLoad`. `@/lib/viz/points3d/gl-renderer`에서 `probeWebgl2`.
- props 구조 분해에 콜백 네 개(`onSupport`, `onOptIn`, `onRequestLoad`, `onRetryLoad`)를 더한다.
- 로컬 state `rendererFailed`·`contextLost`를 두고 `Preview3dInput`에 상수 `false` 대신 넣는다.
- 탐지 effect와 요청 effect를 더한다.
- `Points3dView`의 `onError`를 `onViewerError`(`'webgl'` → `rendererFailed`, `'context'` → `contextLost`)로 바꾼다.
- 버튼 네 개에 `onClick`을 단다(전이 표).

```tsx
// 3D 프리뷰 탭 본문 - 뷰어 / 기존 정적 PNG / 경우별 안내 분기(스펙 2026-10-02 pointcloud-viewer §7.11).
// 어느 화면을 낼지는 lib/domain/points3d.ts 의 resolvePreview3dMode(분기표를 옮긴 순수 함수)가 정한다.
// 이 컴포넌트는 그 모드를 그리고, WebGL2 탐지 결과와 점 파일 적재 요청을 상위(AnalysisResult)에 올린다.
//
// 상위가 가진 것(props): 적재 상태 load, 탐지 결과 support, 소프트웨어 렌더 선택 optedIn.
//   탭 본문은 조건부 렌더라 탭을 벗어나면 언마운트된다. 이 셋을 여기 로컬 state 로 두면
//   탭에 돌아올 때마다 다시 탐지하고 다시 받고 "3D로 보기"를 다시 눌러야 한다.
// 여기 로컬 state 는 rendererFailed 와 contextLost 둘뿐이다. 탭을 벗어나거나 분석이 바뀌면(key) 사라진다.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { artifactUrl } from '@/lib/domain/paths';
import {
  defaultThresholdQ, loadFor, points3dFile, resolvePreview3dMode, shouldProbe, shouldRequestLoad,
} from '@/lib/domain/points3d';
import type { Points3dLoad, Preview3dInput, Webgl2Support } from '@/lib/domain/points3d';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';
import { probeWebgl2 } from '@/lib/viz/points3d/gl-renderer';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Points3dLoadingFrame, Points3dView } from './points3d-view';

// 화면 문구(스펙 §7.12 전문 그대로). M9(로딩)는 Points3dLoadingFrame 이 갖는다.
const M1 = '벽면 분석은 3D 프리뷰 이미지와 3D 점군 뷰를 제공하지 않습니다.';
const M2 = '외부 결과(임포트)에는 3D 점군 데이터를 생성하지 않습니다.';
const M3 = '이 분석에는 3D 점군 데이터가 없습니다. 재분석하면 생성됩니다.';
const M4 = '이 기기는 그래픽 가속을 사용할 수 없어 3D 점군 뷰가 느릴 수 있습니다. 기본으로 정적 이미지를 표시합니다.';
const M5 = '3D 점군 데이터를 저장소에서 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.';
const M6 = '3D 점군 데이터 형식을 읽을 수 없습니다. 지원하지 않는 버전이거나 손상된 파일입니다.';
const M7 = '이 브라우저 또는 기기에서는 WebGL2를 사용할 수 없어 3D 점군 뷰를 표시할 수 없습니다.';
const M8 = '그래픽 컨텍스트가 끊겨 3D 점군 뷰를 표시할 수 없습니다. 다시 시도하세요.';
const M10 = '엔진이 생성한 정적 3D 프리뷰 이미지입니다. 높이 축은 편차(mm)이며 실제 축 비율이 아닙니다.';

const STACK = 'flex flex-col gap-3';
const MUTED = 'text-sm text-cs-text-secondary';

export function Preview3dTab({
  analysis, stats, scan, isImport, load, support, optedIn,
  onSupport, onOptIn, onRequestLoad, onRetryLoad,
}: {
  analysis: AnalysisRow; stats: Stats; scan: ScanRow; isImport: boolean;
  load: Points3dLoad;                         // 상위가 가진 적재 상태. 그대로 받는다
  support: Webgl2Support | null;              // 상위가 가진 탐지 결과. null = 아직 탐지 전
  optedIn: boolean;                           // 상위가 가진 소프트웨어 렌더 선택
  onSupport(s: Webgl2Support | null): void;   // 탐지 결과를 상위에 올린다. null = 다시 탐지하겠다
  onOptIn(): void;                            // "3D로 보기"를 눌렀다
  onRequestLoad(): void;                      // 점 파일을 받아 달라(상위에서 멱등)
  onRetryLoad(): void;                        // 적재 상태를 버리고 곧바로 다시 받는다
}) {
  // Points3dView 가 onError 로 알린 실패. 탭 본문이 다시 마운트되면 사라진다(다시 시도와 같은 효과)
  const [rendererFailed, setRendererFailed] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const dir = analysis.artifacts_dir;
  const thresholdQ = defaultThresholdQ(stats);
  const input: Preview3dInput = {
    surface: analysis.surface, isImport, dir, file: points3dFile(stats), thresholdQ,
    support, optedIn, load, rendererFailed, contextLost,
  };
  const mode = resolvePreview3dMode(input);
  const probe = shouldProbe(input);
  const request = shouldRequestLoad(input);

  // 탐지 effect: 뷰어 대상이고 아직 탐지 전일 때만 WebGL2 를 탐지해 상위에 올린다.
  // 의존성은 탐지 여부 값 하나다. 콜백은 상위가 렌더마다 새로 만들 수 있어 넣지 않는다(넣으면 렌더마다 다시 탐지한다)
  useEffect(() => {
    if (probe) onSupport(probeWebgl2());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe]);

  // 요청 effect: 받을 차례일 때만 상위에 적재를 요청한다. 실제 fetch 와 멱등 검사는 상위가 한다.
  // 의존성은 요청 여부 값과 지금 분석의 artifacts_dir 다(분석이 바뀌면 값이 그대로 참이어도 다시 요청한다)
  useEffect(() => {
    if (request) onRequestLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, dir]);

  const onViewerError = useCallback((kind: 'webgl' | 'context') => {
    if (kind === 'webgl') setRendererFailed(true);
    else setContextLost(true);
  }, []);

  // viewer: 뷰어가 보일 때는 정적 PNG 를 함께 그리지 않는다.
  // 넘기는 점 데이터는 지금 분석의 것(loadFor)이다. 다른 분석의 ready 는 idle 로 읽힌다
  const current = loadFor(load, dir);
  if (mode === 'viewer' && current.status === 'ready' && thresholdQ !== null) {
    return (
      <Points3dView data={current.data} defaultThresholdQ={thresholdQ}
        isRegistered={scan.lineage === 'registered'} onError={onViewerError} />
    );
  }

  // 기존 정적 PNG. 대체 화면에서만 그린다. artifacts_dir 가 없거나 목록이 비면 이미지도 캡션도 없다
  const images = (stats.preview3d_paths ?? []).filter(Boolean);
  const png = dir !== null && images.length > 0 && (
    <div className={STACK}>
      {images.map((name) => (
        // 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
        // eslint-disable-next-line @next/next/no-img-element
        <img key={name} src={artifactUrl(dir, name)} alt={`3D 프리뷰 ${name}`}
          className="max-w-full rounded-lg border border-cs-divider bg-white" />
      ))}
      <p className="text-xs leading-4 text-cs-text-secondary">{M10}</p>
    </div>
  );

  switch (mode) {
    case 'wall':        // 1행. 벽면은 정적 PNG 도 점군 뷰도 없다
      return <p className={MUTED}>{M1}</p>;
    case 'import':      // 2행. 임포트는 점 파일을 만들지 않는다. 재분석을 권하지 않는다
      return <div className={STACK}>{png}<p className={MUTED}>{M2}</p></div>;
    case 'no_data':     // 3행. 점 파일이 없는 옛 분석이거나 점 파일 생성에 실패한 분석
      return <div className={STACK}>{png}<p className={MUTED}>{M3}</p></div>;
    case 'error_stats': // 4행. 계약 위반이라 Alert 로 드러내지만 다시 시도로 고칠 수 없어 버튼이 없다
      return <div className={STACK}><Alert type="error">{M6}</Alert>{png}</div>;
    case 'error_webgl': // 6행. 실패 플래그를 되돌리고 상위에 다시 탐지하겠다고 알린다
      return (
        <div className={STACK}>
          <Alert type="warning">{M7}</Alert>
          <div><Button onClick={() => { setRendererFailed(false); onSupport(null); }}>다시 시도</Button></div>
          {png}
        </div>
      );
    case 'software_prompt': // 7행. 기본은 정적 이미지, 사용자가 고르면 3D
      return (
        <div className={STACK}>
          {png}
          <Alert type="info">{M4}</Alert>
          <div><Button onClick={onOptIn}>3D로 보기</Button></div>
        </div>
      );
    case 'error_fetch':  // 8행
    case 'error_format': // 9행
      return (
        <div className={STACK}>
          <Alert type="error">{mode === 'error_fetch' ? M5 : M6}</Alert>
          <div><Button onClick={onRetryLoad}>다시 시도</Button></div>
          {png}
        </div>
      );
    case 'error_context': // 10행. 플래그만 되돌리면 Points3dView 가 새 canvas 로 다시 마운트된다. 점 데이터는 다시 받지 않는다
      return (
        <div className={STACK}>
          <Alert type="error">{M8}</Alert>
          <div><Button onClick={() => setContextLost(false)}>다시 시도</Button></div>
          {png}
        </div>
      );
    case 'loading':     // 5·11행. 로딩 틀은 뷰어 영역과 같은 검정이다
    case 'viewer':      // 위의 if 가 이미 그렸다. 여기는 타입을 좁히기 위한 자리이며 도달하지 않는다
      return <Points3dLoadingFrame theme="dark" />;
  }
}
```

`switch`의 마지막 두 `case`에 대한 설명: 모드가 `viewer`이면 분기표 4행과 12행에 따라 `thresholdQ`는 숫자이고 `loadFor(load, dir)`는 `ready`다. 위의 `if`가 그 경우를 이미 그렸다. `case 'viewer'`는 TypeScript가 `current.data`와 `thresholdQ`의 타입을 좁히도록 `if`에 조건을 함께 적은 탓에 남은 자리이며 실행되지 않는다.

- [ ] **Step 9: 통과 확인 (이 파일, 팔레트 스윕, 전체 스위트, 타입 검사)**

Run:

```bash
cd D:/Projects/Flatness/dashboard
npx vitest run components/analysis/__tests__/preview3d-tab.test.tsx __tests__/palette-sweep.test.ts
npx vitest run
npx tsc --noEmit
```

Expected:
- 첫 명령: `Test Files  2 passed (2)`. `preview3d-tab.test.tsx`는 49건 통과. 출력에 React의 `act(...)` 경고나 `Not implemented: HTMLCanvasElement.prototype.getContext`가 없다.
- 둘째 명령: 실패 0. 기준선(84파일 769건)에 앞 태스크들이 더한 것과 이 태스크의 1파일 49건을 더한 수가 전부 통과한다.
- 셋째 명령: 출력 없음, 종료 코드 0.

실패가 있으면 실패한 그대로 기록하고 원인을 고친 뒤 세 명령을 다시 돌린다.

- [ ] **Step 10: 금지 문자열과 lint 확인**

Run:

```bash
cd D:/Projects/Flatness
grep -nE "pass_mm|rework_mm|u_mm|applied_criteria" dashboard/components/analysis/preview3d-tab.tsx; echo "exit=$?"
LC_ALL=C grep -c $'\xe2\x80\x94' dashboard/components/analysis/preview3d-tab.tsx dashboard/components/analysis/__tests__/preview3d-tab.test.tsx
grep -n "getContext\|next/dynamic\|variant=\"primary\"\|워커가 생성한\|3D 프리뷰가 없습니다" dashboard/components/analysis/preview3d-tab.tsx; echo "exit=$?"
cd dashboard && npx eslint --report-unused-disable-directives components/analysis/preview3d-tab.tsx components/analysis/__tests__/preview3d-tab.test.tsx
```

Expected:
- 첫 명령: 일치하는 줄 없음, `exit=1`(판정 기준 필드 이름이 주석에도 없다. Task 14의 소스 검사 테스트가 같은 것을 강제한다). 테스트 파일의 stats 픽스처에는 `Stats` 타입을 채우느라 그 필드가 들어가지만 테스트 파일은 검사 대상이 아니다.
- 둘째 명령: 두 파일 모두 `:0`(U+2014 없음).
- 셋째 명령: 일치하는 줄 없음, `exit=1`.
- 넷째 명령: 오류·경고 0건(출력 없음). `react-hooks/exhaustive-deps`를 끈 두 줄과 `@next/next/no-img-element`를 끈 한 줄은 실제로 필요한 지시문이라 "unused directive"로 보고되지 않는다.

- [ ] **Step 11: 스테이징 후 변이 확인**

먼저 두 파일을 스테이징한다(아래 변이를 되돌릴 때 인덱스가 원본 역할을 한다).

```bash
cd D:/Projects/Flatness
git add dashboard/components/analysis/preview3d-tab.tsx dashboard/components/analysis/__tests__/preview3d-tab.test.tsx
```

아래 변이를 **하나씩** `dashboard/components/analysis/preview3d-tab.tsx`에 넣고, `cd dashboard && npx vitest run components/analysis/__tests__/preview3d-tab.test.tsx`를 돌려 기대한 테스트가 죽는지 본 뒤, 곧바로 저장소 루트에서 `git restore dashboard/components/analysis/preview3d-tab.tsx`로 되돌린다. 테스트 파일은 건드리지 않는다.

| # | 변이 | 죽어야 하는 테스트 |
|---|---|---|
| 1 | `error_webgl`의 버튼에서 `setRendererFailed(false); `를 지운다(`onClick={() => { onSupport(null); }}`) | 1건: `다시 시도 > error_webgl(렌더러 생성 실패): ...` |
| 2 | `const request = shouldRequestLoad(input);`를 `const request = shouldRequestLoad({ ...input, optedIn: true });`로 바꾼다(소프트웨어 렌더에서 선택 전에 요청) | 1건: `소프트웨어 렌더 > "3D로 보기"를 누르기 전에는 ...` |
| 3 | `const probe = shouldProbe(input);`를 `const probe = support === null;`로 바꾼다(뷰어 대상이 아닌 분석에서 탐지) | 5건: `뷰어 대상이 아닌 분석 > {벽면, 임포트, artifacts_dir 없음, 점 파일 없음, 표시 임계값 없음(error_stats)}: 탐지 전이어도 probeWebgl2 를 부르지 않는다` |
| 4 | `case 'error_stats'`의 반환을 `<div className={STACK}><Alert type="error">{M6}</Alert><div><Button onClick={onRetryLoad}>다시 시도</Button></div>{png}</div>`로 바꾼다 | 1건: `모드별 화면 > error_stats: ... 다시 시도 버튼이 없다` |
| 5 | `case 'import'`의 `{M2}`를 `{M3}`으로 바꾼다 | 2건: `모드별 화면 > import: ...` 두 건 |
| 6 | 탐지 effect의 `if (probe) onSupport(probeWebgl2());`를 `onSupport(probeWebgl2());`로 바꾼다(support가 있는데도 다시 탐지) | 21건: `탐지 effect > support 가 이미 있으면(...) 다시 탐지하지 않는다` 3건, `뷰어 대상이 아닌 분석`의 10건, `모드별 화면 > viewer: Points3dView 를 그리고 ...` 1건, `소프트웨어 렌더`의 2건(`"3D로 보기"...`, `재진입: 선택을 마친 ...`), `다시 시도`의 5건 |
| 7 | 요청 effect의 `}, [request, dir]);`를 `}, [request]);`로 바꾼다 | 1건: `요청 effect > 같은 인스턴스에서 artifacts_dir 가 바뀌면 ...` |
| 8 | 파일 끝의 `<Points3dLoadingFrame theme="dark" />`를 `theme="light"`로 바꾼다 | 3건: `모드별 화면 > loading: 검정 로딩 틀과 M9 를 낸다` 3건 |
| 9 | `error_context`의 버튼을 `onClick={() => { setContextLost(false); onRetryLoad(); }}`로 바꾼다 | 1건: `다시 시도 > error_context: ...` |

아홉 변이가 전부 위 테스트를 죽였는지 확인한다. 죽지 않는 변이가 있으면 테스트를 Step 2·6의 코드와 대조해 빠진 줄을 찾는다(변이를 살려 둔 채 넘어가지 않는다).

마지막으로 되돌려졌는지 확인한다.

```bash
cd D:/Projects/Flatness
git diff --stat -- dashboard/components/analysis/preview3d-tab.tsx
cd dashboard && npx vitest run components/analysis/__tests__/preview3d-tab.test.tsx
```

Expected: `git diff --stat` 출력 없음(작업 트리가 스테이징한 내용과 같다). vitest는 `Tests  49 passed (49)`.

- [ ] **Step 12: 커밋**

```bash
cd D:/Projects/Flatness
git add dashboard/components/analysis/preview3d-tab.tsx dashboard/components/analysis/__tests__/preview3d-tab.test.tsx
git status --short
git commit -m "$(cat <<'EOF'
feat(dashboard): 3D 프리뷰 탭 본문 Preview3dTab(뷰어 / 정적 PNG / 경우별 안내 분기)

components/analysis/preview3d-tab.tsx 신설(스펙 2026-10-02 pointcloud-viewer §7.2, §7.3, §7.11, §7.12):
- resolvePreview3dMode 가 정한 11개 모드를 그린다. 벽면·임포트·점 파일 없음은 안내 문구,
  표시 임계값 없음·fetch 실패·형식 불일치·컨텍스트 손실은 Alert(error), WebGL2 불가는 Alert(warning),
  소프트웨어 렌더는 Alert(info) + "3D로 보기". 대체 화면에는 기존 정적 PNG 와 새 캡션을 함께 낸다.
- 탐지 effect 는 shouldProbe 가 참일 때만 probeWebgl2 결과를 상위에 올리고,
  요청 effect 는 shouldRequestLoad 가 참일 때만 onRequestLoad 를 부른다.
  뷰어 대상이 아닌 분석과 소프트웨어 렌더의 선택 전에는 탐지도 요청도 하지 않는다.
- 다시 시도: fetch·형식 오류는 onRetryLoad, WebGL2 불가는 실패 플래그를 되돌리고 onSupport(null),
  컨텍스트 손실은 플래그만 되돌려 뷰어를 새 canvas 로 다시 마운트한다.
- 적재 상태·탐지 결과·소프트웨어 렌더 선택은 상위 state 를 props 로 받는다.
  로컬 state 는 rendererFailed 와 contextLost 둘뿐이다.

테스트 49건 추가. 변이 9종(rendererFailed 미복원, 선택 전 요청, 뷰어 대상 아닌 분석에서 탐지,
error_stats 에 다시 시도, import 에 재분석 권유, 조건 없는 탐지 등)이 테스트를 죽이는 것을 확인했다.
analysis-result.tsx 연결은 다음 커밋에서 한다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

Expected: `git status --short`에 `A  dashboard/components/analysis/preview3d-tab.tsx`와 `A  dashboard/components/analysis/__tests__/preview3d-tab.test.tsx` 두 줄만 스테이징돼 있다(다른 파일이 섞여 있으면 커밋하지 말고 원인을 확인한다). 커밋 뒤 `git log -1 --stat`에 그 두 파일만 나온다.

---

**초안 검증 메모 (계획 작성 중 실제로 돌려 본 것).** 저장소 밖 스크래치(`.superpowers/plan-drafts/pointcloud-viewer/scratch-13/`)에서 저장소의 vitest·tsc·eslint를 빌려 돌렸다(`cd dashboard && npx vitest run --root <스크래치>`, `npx tsc --noEmit -p <스크래치>/tsconfig.json`, 저장소 루트에서 `dashboard/node_modules/.bin/eslint -c dashboard/eslint.config.mjs <스크래치 파일>`). 스크래치의 vitest 설정은 `@/`를 스크래치로, `react`·`@testing-library/*`·`next`·`vitest`를 `dashboard/node_modules`로 alias한다. `components/ui`의 `alert.tsx`·`button.tsx`·`spinner.tsx`·`icons.tsx`와 `lib/domain/paths.ts`는 저장소 파일의 사본이다.
- **대역으로 돌린 것**(`scratch-13/`): Task 5·6·7·11·12의 산출물을 뼈대의 시그니처와 계약만 맞춘 최소 대역으로 두고, 이 문서의 코드 블록 순서대로 Step 3(import 해석 오류), Step 5(16건 통과), Step 7(13건 실패 | 36건 통과, 실패 목록은 본문과 같음), Step 9(49건 통과)를 확인했다. `tsc`는 `strict` + `noUnusedLocals`에서 오류 0, eslint는 최종 두 파일에서 0건이었다(지시문 세 줄을 지우면 `react-hooks/exhaustive-deps` 2건과 `@next/next/no-img-element` 1건이 나오는 것도 확인했다).
- **이웃 태스크의 초안 구현으로 돌린 것**(`scratch-13/integ/`): Task 11 초안의 `gl-renderer.ts`·`gl-stub.ts`(`scratch-11/`), Task 12 초안의 `points3d-view.tsx`와 순수 모듈 6개(`scratch-12/dashboard/`), Task 7 초안의 코드를 붙인 `points3d.ts`를 모아 같은 테스트를 돌렸다. Step 5·7·9의 수치가 대역과 같았고(16 / 13 실패·36 통과 / 49) `tsc` 오류 0, 콘솔 경고 0이었다.
- **변이**(`scratch-13/mutate.mjs`, `mutate_integ.mjs`): 45종을 넣었다. Step 11의 9종을 포함한 44종이 테스트를 죽였고, Step 11 표의 건수는 그 실측값이다. 앞의 31종은 이웃 초안 쪽에서도 돌렸고 죽는 건수가 대역과 같았다. `support`나 `optedIn`을 로컬 state로 두는 변이(스펙 §10.5가 Task 14의 테스트로 잡는다고 한 것)도 이 태스크의 테스트에서 죽었다. 살아남은 1종은 본문에 적은 동치 변이(`loadFor` 생략)다.
- **재확인(2026-10-03, 이어서 작업한 세션)**: 이웃 초안이 그 뒤 고쳐졌으므로 `scratch-13/integ/`의 사본을 최종 초안과 대조했다. `points3d-view.tsx`와 순수 모듈 6개는 `scratch-12/dashboard/`의 최종본과, `gl-renderer.ts`·`gl-stub.ts`는 `scratch-11/cycle/`의 최종본과, `points3d.ts`의 Task 7 구간(`// ---- stats 접근` 이하 4,531자)은 `scratch-07/verify/`의 2026-10-03자 최종본과 바이트 단위로 같다. 그 위에서 `replay.py stub`·`replay.py integ`를 다시 돌려 Step 3(import 해석 오류 1종) / Step 5(16 통과) / Step 7(13 실패 · 36 통과, 실패 13건의 이름과 `AssertionError` 세 종류가 본문과 같음) / Step 9(49 통과, vitest 4.1.10 출력 9줄에 `act(...)`·`Not implemented` 경고 없음) / `tsc` 종료 코드 0을 다시 확인했다. 45종 변이도 다시 돌려 44종이 죽고 `loadFor` 생략 1종만 살았으며, 변이 6(조건 없는 탐지)이 죽인 21건의 묶음별 수(탐지 effect 3 · 뷰어 대상 아님 10 · 모드별 화면 1 · 소프트웨어 렌더 2 · 다시 시도 5)가 Step 11 표와 같았다. eslint는 최종 두 파일에서 0건, 지시문 세 줄을 지운 사본에서 `react-hooks/exhaustive-deps` 2건(`:67`, `:73`)과 `@next/next/no-img-element` 1건(`:96`)이었다. Step 1의 grep 기대값(10 / 2 / 1 / 2줄, DOM 문자열 4종, `types.ts` 2줄)은 Task 5·7·11·12 최종 초안의 코드 위에서 확인했다. 저장소의 `dashboard/vitest.config.ts`(jsdom, `globals: true`, `@` alias, jest-dom setup)는 스크래치 설정과 같은 조건이다. 스크래치 파일을 `cd dashboard`에서 eslint로 돌리면 "File ignored because outside of base path"로 건너뛰니 저장소 루트에서 돌려야 한다(Step 10의 실제 파일은 `dashboard/` 안이라 해당 없음).
- **확인하지 못한 것**: 저장소에 커밋된 실제 Task 5·6·7·11·12 산출물 위에서의 실행(아직 저장소에 없다), 대시보드 전체 스위트(`npx vitest run`)와 `next build`, 실제 브라우저에서의 화면. `Points3dView`가 뷰어 모드에서 `<img>` 요소나 `data-alert` 요소를 그리면 `viewer` 테스트의 "PNG 없음"·"Alert 없음" 단언이 그 요소에 걸린다(Task 12 초안은 그리지 않는다). 그 경우에는 단언을 `screen.queryByAltText(/^3D 프리뷰 /)`와 문구 M10 부재로 좁힌다.

---
### Task 14: `AnalysisResult` 통합: 지연 적재 state, 3D 탭 교체, litmus 소스 검사

**목표:** 3D 탭 본문이 `<Preview3dTab key={analysis.id}>`로 교체되고, 점 파일을 탭 첫 진입에 한 번만 받아 state에 보관하며(분석 전환·늦은 응답·다시 시도 처리 포함), 뷰어 코드가 판정 기준 필드를 읽지 않음을 소스 검사 테스트가 강제한다.

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §2.2(V5·V6), §2.3(탭 컴포넌트의 실제 구조, 분석 전환 시 캐시), §7.2(`analysis-result.tsx` 수정 행), §7.3(state 3개, 흐름 1~10), §7.10(탭 이름·순서와 3:2 그리드는 그대로), §7.12(옛 문구 2개 삭제), §7.13의 6번, §8의 1번, §10.4(`analysis-result.test.tsx` 추가, `points3d-litmus.test.ts`, `palette-sweep.test.ts`), §10.5(대시보드 변이 7건), §12(`analysis-result.tsx`·`deviation-view.tsx` 행), 부록 B의 6·9·13번.

**Files:**
- Create: `dashboard/__tests__/points3d-litmus.test.ts`
- Modify: `dashboard/components/analysis/analysis-result.tsx` (네 곳: `:4-11` import, `:36-39` state, `:57-61` 3D 프리뷰 PNG 목록 자리, `:76-94` 3D 탭 본문)
- Modify: `dashboard/components/analysis/__tests__/analysis-result.test.tsx` (`:1-8` 파일 머리 교체, 파일 끝 `:111` 다음에 describe 블록 2개 추가. 기존 테스트 4건과 픽스처 `:10-44`는 고치지 않는다)
- Modify: `dashboard/components/analysis/deviation-view.tsx:18-19` (주석만. 스펙은 이 주석 블록을 `:17-20`으로 가리킨다. 코드 변경 없음)
- Test: `dashboard/components/analysis/__tests__/analysis-result.test.tsx`, `dashboard/__tests__/points3d-litmus.test.ts`, `dashboard/__tests__/palette-sweep.test.ts`(고치지 않는다. 0건 통과만 확인)
- 읽기만(고치지 않는다): `dashboard/app/scans/[id]/page.tsx:472`(`<AnalysisResult analysis={resultAnalysis} scan={s} photos={photos} />`에 `key`가 없다), `dashboard/lib/domain/paths.ts:8-10`(`artifactUrl`), `dashboard/components/analysis/slope-result.tsx:129-154`(fetch try/catch 양식)

**Interfaces:**
- Consumes:
  - Task 13: `Preview3dTab(props: { analysis: AnalysisRow; stats: Stats; scan: ScanRow; isImport: boolean; load: Points3dLoad; support: Webgl2Support | null; optedIn: boolean; onSupport(s: Webgl2Support | null): void; onOptIn(): void; onRequestLoad(): void; onRetryLoad(): void; })` (`dashboard/components/analysis/preview3d-tab.tsx`). 탐지 effect가 `onSupport(probeWebgl2())`를, 요청 effect가 `onRequestLoad()`를 부른다. 버튼 이름 `다시 시도`·`3D로 보기`, 안내 M1~M3은 `<p>`, 오류·안내는 `Alert`(루트에 `data-alert`), PNG는 alt `3D 프리뷰 {name}`
  - Task 7: `Points3dLoad`, `Webgl2Support`, `loadFor(load: Points3dLoad, dir: string | null): Points3dLoad`, `points3dFile(stats: Stats): string | null` (`dashboard/lib/domain/points3d.ts`)
  - Task 6: `parsePoints3d(buf: ArrayBufferLike, hostIsLittleEndian?: boolean): Points3dParse` (`{ ok: true; data: Points3dData } | { ok: false; reason: Points3dError }`)
  - Task 11: `probeWebgl2(): Webgl2Support`(`@/lib/viz/points3d/gl-renderer`. 테스트에서 모듈 mock으로 바꾼다), 테스트 헬퍼 `recordingGl()`(`@/lib/viz/points3d/__tests__/gl-stub`. `recordingGl().gl`이 가짜 `WebGL2RenderingContext`)
  - Task 3: 골든 파일 `engine/tests/fixtures/points3d_golden.bin`(488바이트, `json_len` 384, n = 12. 테스트의 `arrayBuffer` 응답으로 쓴다)
  - Task 12의 DOM 계약: 캔버스 `role="img"` + `aria-label="3D 점군 뷰어"`, 슬라이더 `<input type="range" aria-label="표시 임계값(mm)">`(값은 0.1mm 정수), HUD `data-testid="points3d-hud"`(문자열에 `{n}점` 포함), 로딩 틀 `data-testid="points3d-loading"`. `Points3dView`는 마운트마다 `canvas.getContext('webgl2', ...)`를 한 번 부르고, 그것이 null이면 `onError('webgl')`을 알린다
  - Task 5: `Stats.points3d_paths?: string[]`, `Stats.points3d_threshold_q?: number`
  - 기존: `artifactUrl(artifactsDir: string, filename: string): string`(`'artifacts/an1'`, `'custom3d.bin'` → `'/api/data/artifacts/an1/custom3d.bin'`), `isExternalImport(engineVersion, meta)`, `AnalysisResult({ analysis, scan, photos })`
- Produces:
  - `analysis-result.tsx`의 state: `load: Points3dLoad`(초기 `{ status: 'idle' }`), `support: Webgl2Support | null`(초기 null), `optedIn: boolean`(초기 false), 진행 중 요청의 dir을 드는 ref `pendingDir`
  - 내부 함수 3개(export하지 않는다): `startPoints3dLoad(dir: string, file: string)`, `requestPoints3dLoad()`(`onRequestLoad`. 멱등: dir·file이 null이면 무시, `loadFor(load, dir).status !== 'idle'` 또는 ref가 같은 dir이면 무시), `retryPoints3dLoad()`(`onRetryLoad`. 멱등 검사 없이 다시 받는다). 응답 반영은 함수형 갱신으로 현재 상태가 `{ status: 'loading', dir: 요청한 dir }`일 때만
  - 3D 탭 본문 = `<Preview3dTab key={analysis.id} analysis={analysis} stats={stats} scan={scan} isImport={isImport} load={load} support={support} optedIn={optedIn} onSupport={setSupport} onOptIn={() => setOptedIn(true)} onRequestLoad={requestPoints3dLoad} onRetryLoad={retryPoints3dLoad} />`. 옛 캡션(`:85-87`)과 옛 빈 상태 문구(`:90-92`) 삭제
  - `deviation-view.tsx`의 주석이 `preview3d-tab.tsx`의 임포트 분기를 가리킨다(코드 변경 없음)
  - `dashboard/__tests__/points3d-litmus.test.ts`: 뷰어 코드 10개 파일에 판정 기준 필드 이름 4종과 U+2014가 0건임을 강제한다. Task 16이 전체 스위트로 함께 돌린다

**이 태스크가 구현하는 흐름 (스펙 §7.3).**

| # | 흐름 | 이 태스크의 코드 |
|---|---|---|
| 1 | 마운트 때는 아무것도 받지 않고 탐지도 하지 않는다 | `AnalysisResult`에 점 파일 fetch를 시작하는 effect를 두지 않는다 |
| 2·3 | 3D 탭을 열면 `Preview3dTab`이 탐지하고(`onSupport`) 요청한다(`onRequestLoad`) | `support`·`optedIn` state와 두 setter를 props로 넘긴다 |
| 4 | `onRequestLoad()`는 멱등이다 | `requestPoints3dLoad`의 가드 3개(null, `loadFor`, ref) |
| 5 | `fetch(artifactUrl(dir, file))` 뒤 `res.arrayBuffer()`. 이름은 stats가 준 값 | `startPoints3dLoad`. `file`은 `points3dFile(stats)` |
| 6 | `!res.ok` 또는 예외 → `{ status: 'error', dir, reason: 'fetch' }` | `try`/`catch` |
| 7 | `parsePoints3d` 실패 → `reason: 'format'`, 성공 → `ready` | 같은 함수 |
| 8 | 결과는 현재 상태가 `{ loading, 요청한 dir }`일 때만 반영 | `setLoad((cur) => ...)` |
| 9 | `ready`는 탭을 벗어나도 유지. 분석이 바뀌면 `loadFor`가 옛 데이터를 idle로 본다 | `load`를 되돌리는 effect를 두지 않는다 |
| 10 | `onRetryLoad()`는 검사 없이 `loading`으로 두고 다시 받는다 | `retryPoints3dLoad` |

**지킬 것 (함정).**
1. fetch는 마운트 때가 아니라 `Preview3dTab`의 요청 effect가 `onRequestLoad()`를 부를 때 시작한다. `AnalysisResult`에 `load`를 되돌리는 effect도 두지 않는다. 다른 분석의 옛 데이터는 `loadFor`가 idle로 취급하고, 새 요청이 시작될 때 교체된다.
2. `fetch`와 `arrayBuffer()`를 한 `try`/`catch`로 감싼다. `!res.ok`를 본문을 읽기 **전에** 검사한다(404에도 본문이 있다. 순서를 바꾸면 받기 실패가 형식 오류 문구로 나온다). 서명 URL을 보관하지 않는다. 다시 받을 때도 `artifactUrl(dir, file)`로 `/api/data`를 다시 거친다.
3. 받을 파일 이름은 `points3dFile(stats)`다. 리터럴 `'points3d.bin'`을 대시보드 코드(테스트 제외)에 쓰지 않는다. 테스트는 A 분석의 이름을 일부러 `custom3d.bin`으로 준다.
4. 개발 모드(StrictMode)는 마운트 effect를 두 번 돌린다. 두 호출은 같은 렌더의 `load`(아직 idle)를 보므로 state만으로는 fetch가 두 번 나간다. 진행 중 요청의 dir을 ref(`pendingDir`)로 들고 멱등 검사에 함께 쓴다. ref 검사와 `loadFor` 검사는 `||`로 묶인 두 가드다. 한쪽만 테스트되면 다른 쪽을 지워도 통과하므로 Step 7의 탐침 테스트가 두 가드를 따로 누른다.
5. `page.tsx:472`는 `AnalysisResult`에 `key`를 주지 않는다. `?analysis=`로 분석을 바꿔도 같은 인스턴스가 재사용되고 `tab`·`load`·`support`·`optedIn`이 남는다. 그래서 분석 전환 테스트는 새로 `render`하지 않고 `rerender(<AnalysisResult analysis={b} .../>)`로 같은 인스턴스를 쓴다.
6. `key={analysis.id}`가 하는 일은 `Preview3dTab`의 로컬 state(`rendererFailed`, `contextLost`)를 버리는 것이다. 분석을 바꾸면 `loadFor`가 idle을 돌려줘 로딩 틀이 뜨는 동안 `Points3dView`가 어차피 언마운트되므로, **임계값 슬라이더는 `key`가 없어도 새 분석의 값으로 돌아온다.** `key`를 지우는 변이는 "분석을 바꾸면 이전 분석의 뷰어 오류가 남지 않는다" 테스트가 죽인다(Step 13의 5번).
7. 늦은 응답 테스트는 fetch 스텁이 돌려준 promise를 테스트가 직접 resolve한다(`deferred`). A를 보류한 채 B로 `rerender`하고 응답 순서를 두 가지로 만든다(A 먼저, B 먼저). 두 테스트가 서로 다른 변이를 죽인다.
8. 기존 전역 fetch 스텁 `stubCellsFetch`(`:42-44`)에는 `arrayBuffer`가 없다. 기존 4건은 3D 탭을 열지 않으므로 그대로 둔다. 새 테스트는 URL로 갈라 응답하는 별도 스텁 `stubFetch`를 쓴다. 기존 픽스처 `stats`·`analysis`·`scan`은 고치지 않고 새 테스트에서 펼쳐 쓴다.
9. `getContext` 스파이는 `'webgl2'` 요청에만 기록 스텁을 주고 나머지에는 null을 준다. 히트맵 탭의 `getContext('2d')`(`heatmap-view.tsx:38`)는 null이면 그리지 않고 끝나므로 기존 동작과 같다.
10. litmus는 주석도 센다. 앞 태스크의 파일에 금지 문자열이 남아 있으면 여기서 드러난다. 그때는 그 파일의 **주석을 한글 표현으로 고친다**(예: "판정 기준의 허용치·재시공 한계·불확도 필드"). litmus 목록에서 파일을 빼지 않는다. 식별자 `unit_mm`에는 `u_mm` 부분 문자열이 없다(`t_mm`으로 끝난다). litmus 테스트 파일 자신은 금지 문자열을 갖고 있으므로 `dashboard/__tests__/`는 검사 대상이 아니다.
11. 탭 이름·순서(`TABS`), `RESULT_GRID`, `VerdictPanel`, 결과표, 기존 `cells.json` effect(`:41-55`)는 한 줄도 바꾸지 않는다.
12. 컴포넌트 반환 타입을 적지 않는다. 새 주석·문자열에 U+2014와 `색이름-숫자` 꼴 표기를 쓰지 않는다. DOM에 `red-`·`green-` 부분 문자열이 들어가는 이름(예: `rendered-...`)을 만들지 않는다. `analysis-result.test.tsx:109`의 느슨한 팔레트 단언을 3D 탭을 연 상태에도 건다.
13. 테스트의 기다림은 전부 `act`(아래 `flush` 헬퍼)·`waitFor`·`findBy*` 안에서만 한다. `await new Promise((r) => setTimeout(r, N))`을 `act` 밖에 그대로 쓰지 않는다. 이유: 실제 `Points3dView`(Task 12)는 마운트 직후 `requestAnimationFrame`으로 한 프레임을 그리고 그 안에서 축 라벨 state를 갱신한다. vitest의 jsdom에서 rAF는 실제로 수십 ms 뒤에 발화한다(이 초안 작성 중 확인). `waitFor` 안에서는 testing-library가 act 환경 플래그를 끄고, `act` 안에서는 갱신이 act 범위에 들어가므로 경고가 없지만, 맨 `await`로 시간을 흘리면 그 사이 발화한 프레임이 `An update to Points3dView inside a test was not wrapped in act(...)` 경고를 찍는다. rAF를 스텁할 필요는 없다(이 태스크는 그린 결과를 단언하지 않는다).

**테스트가 죽이는 변이.**

| 테스트 | 죽이는 변이 |
|---|---|
| 마운트만으로는 점 파일을 받지 않고 WebGL2 탐지도 하지 않는다 | 마운트 때 fetch, 마운트 때 탐지 |
| 3D 탭 첫 진입에 stats 가 준 이름으로 한 번 받아 뷰어를 그린다 | fetch 파일명을 리터럴로 고정, 옛 캡션·옛 빈 상태 문구를 남김, 뷰어와 PNG를 함께 그림, 탭 이름·순서 변경 |
| 다른 탭에 갔다 돌아와도 다시 받지 않고 다시 탐지하지 않는다 | `load`·`support`를 탭 본문의 로컬 state로 되돌림(왕복마다 다시 받고 다시 탐지) |
| 소프트웨어 렌더: 선택 전에는 받지 않고, "3D로 보기" 뒤에는 탭을 왕복해도 다시 누르지 않는다 | `optedIn`을 로컬 state로 되돌림, 선택 전에 fetch, `optedIn`을 넘기지 않음 |
| 3D 탭을 연 채 다른 분석으로 바꾸면 새로 받고, 받는 동안 이전 분석의 점을 그리지 않는다 | `loadFor`의 dir 비교 제거(이전 분석의 12점이 그대로 보인다), `support`를 분석마다 다시 탐지 |
| 늦은 응답: B 를 받는 중에 A 의 응답이 먼저 도착해도 ... | 응답 반영에서 dir 비교 제거(`cur.status === 'loading'`만 봄. A가 반영되고 B의 응답이 버려져 로딩에 멈춘다) |
| 늦은 응답: B 를 그린 뒤에 A 의 응답이 도착해도 ... | 늦게 온 응답을 무조건 반영(`setLoad(next)`. B를 다시 받는다) |
| 받기 실패(404 응답 / fetch 예외 / arrayBuffer() 예외) | `res.ok` 검사 제거(404), `try`/`catch` 제거(예외 2건), 다시 시도가 멱등 검사에 막힘 |
| 형식 불일치 | 형식 오류를 fetch 오류로 기록, `parsePoints3d` 결과를 보지 않고 ready로 둠 |
| 분석을 바꾸면 이전 분석의 뷰어 오류가 남지 않는다 | `key={analysis.id}` 제거 |
| 개발 모드의 effect 이중 실행(StrictMode)에서도 점 파일 요청은 한 번만 나간다 | 진행 중 dir ref 검사 제거 |
| 벽면 분석 / 임포트 결과 | `analysis`·`isImport`를 탭에 넘기지 않음(임포트에 "재분석하면 생성됩니다"가 나온다), 옛 벽면 문구를 남김 |
| (탐침) onRequestLoad 는 멱등이다 | ref 검사 제거(같은 렌더의 두 호출), `loadFor` 검사 제거(받는 중·받은 뒤의 호출) |
| (탐침) 받기에 실패한 뒤의 onRequestLoad 는 다시 받지 않고, onRetryLoad 는 검사 없이 다시 받는다 | `loadFor` 검사 제거(오류 뒤 자동 재요청), 다시 시도가 멱등 검사를 거침, 다시 시도가 `loading`으로 두지 않음 |
| (탐침) 점 파일 이름이 없는 / 산출물 경로가 없는 분석 | dir·file null 가드 제거(`artifacts/an1/undefined` 같은 URL로 요청이 나간다) |
| (탐침) 탐지 결과와 소프트웨어 렌더 선택은 탭을 벗어나도, 분석을 바꿔도 남는다 | `support`·`optedIn`을 분석이 바뀔 때 초기화, setter를 넘기지 않음 |
| litmus: 검사 대상 파일이 전부 있다 | 뷰어 파일 이름 변경·추가(검사에서 조용히 빠짐) |
| litmus: 판정 기준 필드 이름 0건 | `stats.applied_criteria.pass_mm`을 읽음, 주석에 필드 이름을 적음 |
| litmus: U+2014 0건 | 뷰어 문구·주석에 U+2014 |

**기대값의 근거.** 전부 입력에서 손으로 계산한 값이다(구현 출력을 베끼지 않았다).
- `URL_A = '/api/data/artifacts/an1/custom3d.bin'`: `artifactUrl('artifacts/an1', 'custom3d.bin')` = `dataUrl('artifacts/an1/custom3d.bin')` = `'/api/data/'` + 경로 조각을 `encodeURIComponent`해 `/`로 이은 것(`lib/domain/paths.ts:3-10`). 조각에 인코딩할 문자가 없다. `URL_B`도 같은 식(`artifacts/an2`, `points3d.bin`).
- 슬라이더 값 `'70'`·`'60'`: 픽스처의 `points3d_threshold_q` 70·60. `defaultThresholdQ`는 정수를 [10, 300]으로 clamp할 뿐이라 그대로다. `<input type="range">`의 `value`는 문자열이다.
- HUD `12점`·`11점`: 골든은 n = 12. `goldenFirst(11)`은 메타의 `"n_points":12`를 `"n_points":11`로 바꾸고(자릿수가 같아 `json_len` 384 그대로) 본문을 앞 11점만 남긴 파일이다. 크기 `8 + 384 + 8 × 11 = 480`바이트. xyz는 골든의 오프셋 392부터 66바이트(`6 × 11`), dev는 골든의 오프셋 `392 + 6 × 12 = 464`부터 22바이트(`2 × 11`)다.
- `webgl2Calls() === 3`: 첫 진입 1번 + 왕복 2번. `Points3dView`는 탭에 들어올 때마다 새로 마운트되고 마운트마다 `getContext('webgl2', ...)`를 한 번 부른다(Task 12 계약). `probeWebgl2`는 mock이라 `getContext`를 부르지 않는다.
- `brokenGolden()`: 첫 바이트 `0x46`(`F`)을 `0x58`로 바꾼다. 리더 규칙 2번(`bad_magic`) → `reason: 'format'` → `error_format` → 문구 M6.
- 404 응답의 본문은 HTML 22바이트다. `!res.ok`를 먼저 보면 `reason: 'fetch'`(M5)다. 본문을 먼저 읽으면 `bad_magic`으로 M6이 나온다.
- 문구 M1·M2·M4·M5·M6·M7은 스펙 §7.12 표의 전문이다.

---

- [ ] **Step 1: 전제 확인 (Task 3·5·6·7·11·12·13의 산출물과 기준선)**

Run:

```bash
cd D:/Projects/Flatness
grep -n "points3d_paths\|points3d_threshold_q" dashboard/lib/domain/types.ts
grep -n "^export function parsePoints3d\|^export function points3dFile\|^export function loadFor" dashboard/lib/domain/points3d.ts
grep -n "^export function probeWebgl2\|^export function createRenderer" dashboard/lib/viz/points3d/gl-renderer.ts
grep -n "^export function recordingGl" dashboard/lib/viz/points3d/__tests__/gl-stub.ts
grep -n "^export function Preview3dTab" dashboard/components/analysis/preview3d-tab.tsx
grep -n "^export function Points3dView\|^export function Points3dLoadingFrame" dashboard/components/analysis/points3d-view.tsx
grep -n "points3d-hud\|points3d-loading\|표시 임계값(mm)\|3D 점군 뷰어" dashboard/components/analysis/points3d-view.tsx
ls dashboard/lib/viz/points3d/
wc -c engine/tests/fixtures/points3d_golden.bin
cd dashboard && npx vitest run
```

Expected:
- 첫 grep 2줄(`points3d_paths?: string[];`, `points3d_threshold_q?: number;`). 둘째 3줄. 셋째 2줄. 넷째·다섯째 1줄씩. 여섯째 2줄.
- 일곱째 grep: `data-testid="points3d-hud"`, `data-testid="points3d-loading"`, `aria-label="표시 임계값(mm)"`, `aria-label="3D 점군 뷰어"`가 각각 한 번 이상 나온다(이 태스크의 테스트가 이 네 가지로 화면을 읽는다).
- `ls`: `__tests__  budget.ts  controls.ts  gl-renderer.ts  mat4.ts  orbit.ts  pick.ts  scaffold.ts` (소스 7개와 테스트 폴더).
- `wc -c`: `488`.
- vitest: 전부 통과. 출력의 `Test Files  F passed`와 `Tests  N passed`에서 **F와 N을 적어 둔다**(Step 12에서 `F + 1`, `N + 23`을 확인한다).

하나라도 다르면 멈추고 앞 태스크가 끝났는지 확인한다.

- [ ] **Step 2: Next.js 문서 확인**

이 저장소의 Next.js(16.2.12)는 관례가 다르다(`dashboard/AGENTS.md`). 다음 두 문서에서 클라이언트 컴포넌트 경계 부분을 읽는다.

- `dashboard/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `dashboard/node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`

확인할 것: 이 태스크는 이미 `'use client'`인 `analysis-result.tsx`에 state·ref와 정적 import 한 줄(`./preview3d-tab`)을 더할 뿐이다. `next/dynamic`·`ssr: false`를 쓰지 않는다. 문서가 이 방식과 다른 것을 요구하면 문서를 따르고 커밋 메시지에 적는다.

- [ ] **Step 3: litmus 소스 검사 테스트 작성**

`dashboard/__tests__/points3d-litmus.test.ts`를 새로 만든다.

```ts
// 판정 이중화 금지 리트머스(스펙 2026-10-02-pointcloud-viewer-design.md §8의 1번, §10.4).
// 3D 점군 뷰어 코드는 판정 기준 필드를 읽지 않는다. 엔진이 따로 써 준 표시용 points3d_threshold_q 만 읽는다.
// 아래 파일에 판정 기준 필드 이름이 주석으로라도 나오면 실패한다(리뷰가 아니라 테스트가 막는다).
// 같은 파일들에 U+2014 가 없는지도 함께 본다(사용자 대면 문자열 규칙).
//
// 이 파일 자신은 금지 문자열을 갖고 있으므로 검사 대상에 넣지 않는다(dashboard/__tests__ 는 아래 목록에 없다).
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// vitest 는 __dirname 을 준다(palette-sweep.test.ts 와 같은 방식)
const ROOT = join(__dirname, '..'); // dashboard/

// WebGL 접점과 순수 모듈. 스펙 §7.2 의 모듈 분해 그대로다(테스트 폴더 __tests__ 는 제외).
const VIZ_DIR = 'lib/viz/points3d';
const VIZ_FILES = ['budget.ts', 'controls.ts', 'gl-renderer.ts', 'mat4.ts', 'orbit.ts', 'pick.ts', 'scaffold.ts'];
const OTHER_FILES = [
  'lib/domain/points3d.ts',
  'components/analysis/points3d-view.tsx',
  'components/analysis/preview3d-tab.tsx',
];

const FORBIDDEN = ['pass_mm', 'rework_mm', 'u_mm', 'applied_criteria'];
// 문자 자체를 이 파일에 적지 않으려고 코드 값으로 만든다
const EM_DASH = String.fromCharCode(0x2014);

/** lib/viz/points3d 바로 아래의 소스 파일 이름(하위 폴더 제외, 이름순). */
function vizSources(): string[] {
  const dir = join(ROOT, VIZ_DIR);
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile() && /\.(ts|tsx)$/.test(name))
    .sort();
}

/** 검사 대상 전체(dashboard 기준 상대 경로). viz 폴더는 실제로 있는 파일을 읽어 목록을 만든다. */
function targets(): string[] {
  return [...OTHER_FILES, ...vizSources().map((name) => `${VIZ_DIR}/${name}`)];
}

/** needle 이 나온 곳을 `파일:줄: 내용` 으로 모은다. */
function hits(needles: string[]): string[] {
  const found: string[] = [];
  for (const rel of targets()) {
    readFileSync(join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      for (const needle of needles) {
        if (line.includes(needle)) found.push(`${rel}:${i + 1}: ${needle}`);
      }
    });
  }
  return found;
}

describe('3D 점군 뷰어 리트머스 (판정 이중화 금지)', () => {
  it('검사 대상 파일이 전부 있다: viz 폴더는 정확히 7개, 나머지 3개', () => {
    // 파일 이름이 바뀌거나 모듈이 늘면 여기서 드러난다. 목록을 고치지 않고는 검사에서 빠질 수 없다.
    expect(vizSources()).toEqual(VIZ_FILES);
    expect(OTHER_FILES.filter((rel) => !existsSync(join(ROOT, rel)))).toEqual([]);
    expect(targets()).toHaveLength(10);
  });

  it('뷰어 코드에 판정 기준 필드 이름이 0건이다(주석 포함)', () => {
    expect(hits(FORBIDDEN)).toEqual([]);
  });

  it('뷰어 코드에 U+2014 가 0건이다', () => {
    expect(hits([EM_DASH])).toEqual([]);
  });
});
```

- [ ] **Step 4: litmus 실행과 물림 확인**

Run: `cd dashboard && npx vitest run __tests__/points3d-litmus.test.ts`

Expected: `Tests  3 passed (3)`. 이 테스트는 앞 태스크의 파일을 지키는 가드라서 처음부터 통과하는 것이 정상이다.

실패하면 메시지에 `파일:줄: 문자열`이 찍힌다. 그 줄을 열어 고친다.
- 판정 기준 필드 이름이 주석에 있으면 한글 표현으로 바꾼다(예: "판정 기준의 허용치·재시공 한계·불확도 필드를 읽지 않는다"). 코드가 실제로 그 필드를 읽고 있으면 스펙 §8 위반이다. 멈추고 보고한다.
- U+2014가 있으면 쉼표나 마침표, 가운뎃점으로 바꾼다.
- 첫 테스트(파일 목록)가 실패하면 `lib/viz/points3d`의 파일 이름이 스펙 §7.2의 7개와 다른 것이다. 멈추고 보고한다(목록을 고쳐 맞추지 않는다).
- 이렇게 고친 앞 태스크 파일은 Step 14의 커밋에 함께 넣는다.

가드가 실제로 무는지 확인한다(통과만 보고 넘어가지 않는다). `dashboard/lib/viz/points3d/budget.ts`의 맨 끝에 다음 한 줄을 임시로 붙인다.

```ts
// 변이 확인용 임시 줄: pass_mm
```

Run: `cd dashboard && npx vitest run __tests__/points3d-litmus.test.ts`

Expected: FAIL. `뷰어 코드에 판정 기준 필드 이름이 0건이다(주석 포함)`가 죽고, 메시지에 `lib/viz/points3d/budget.ts:<줄>: pass_mm`이 있다.

임시 줄을 지우고 되돌려졌는지 확인한다.

```bash
cd D:/Projects/Flatness
git restore dashboard/lib/viz/points3d/budget.ts
git status --short dashboard/lib/viz/points3d/
cd dashboard && npx vitest run __tests__/points3d-litmus.test.ts
```

Expected: `git status --short` 출력 없음. vitest `Tests  3 passed (3)`.

- [ ] **Step 5: 실패하는 테스트 작성 1/3 (테스트 파일 머리 교체)**

`dashboard/components/analysis/__tests__/analysis-result.test.tsx`의 `:1-8`을 바꾼다.

바꾸기 전(`:1-8`):

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AnalysisResult } from '../analysis-result';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';
```

바꾼 뒤:

```tsx
import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// WebGL2 탐지(probeWebgl2)만 가짜로 바꾼다. 같은 모듈의 createRenderer 는 실제 구현이고,
// 그것이 부르는 canvas.getContext 는 아래 3D 탭 describe 가 gl 호출 기록 스텁으로 끼운다.
vi.mock('@/lib/viz/points3d/gl-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/viz/points3d/gl-renderer')>();
  return { ...actual, probeWebgl2: vi.fn() };
});
// Preview3dTab 을 얇게 감싼다. 평소에는 실제 구현을 그대로 그리고(통합 테스트),
// tabProbe.render 가 있으면 그것을 대신 그려 AnalysisResult 가 넘긴 props 와 콜백을 직접 부른다(계약 테스트).
type TabProps = Parameters<typeof import('../preview3d-tab').Preview3dTab>[0];
const tabProbe = vi.hoisted(() => ({ render: null as null | ((props: TabProps) => ReactNode) }));
vi.mock('../preview3d-tab', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../preview3d-tab')>();
  return {
    ...actual,
    Preview3dTab: (props: TabProps) => (tabProbe.render ? tabProbe.render(props) : <actual.Preview3dTab {...props} />),
  };
});

import { AnalysisResult } from '../analysis-result';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';
import { probeWebgl2 } from '@/lib/viz/points3d/gl-renderer';
import { recordingGl } from '@/lib/viz/points3d/__tests__/gl-stub';
```

`:10` 이하(픽스처 `stats`·`analysis`·`scan`, `stubCellsFetch`, 기존 describe 2개)는 그대로 둔다.

- `vi.mock('@/lib/viz/points3d/gl-renderer', ...)`는 `probeWebgl2`만 `vi.fn()`으로 바꾸고 나머지 export는 실제 구현을 쓴다.
- `vi.mock('../preview3d-tab', ...)`는 `Preview3dTab`을 얇게 감싼다. `tabProbe.render`가 null이면 실제 컴포넌트를 그대로 그리므로 통합 테스트에는 영향이 없다. `key`는 감싼 컴포넌트에 걸리고 실제 컴포넌트는 그 아래에 있으므로 `key`가 바뀌면 함께 새로 마운트된다.

- [ ] **Step 6: 실패하는 테스트 작성 2/3 (통합 테스트 15건)**

같은 파일의 맨 끝(기존 마지막 describe의 `});` 다음)에 다음 블록을 붙인다.

```tsx
// ---------------------------------------------------------------------------
// 3D 프리뷰 탭 통합 (스펙 2026-10-02-pointcloud-viewer-design.md §7.3, §10.4)
// 점 파일은 탭 첫 진입에 한 번만 받아 AnalysisResult state 에 둔다. 탐지 결과와 소프트웨어 렌더 선택도 같다.
// ---------------------------------------------------------------------------

// __tests__ -> analysis -> components -> dashboard -> 저장소 루트. 엔진 pytest 와 같은 골든 파일을 읽는다(n = 12)
const GOLDEN_PATH = join(__dirname, '../../../../engine/tests/fixtures/points3d_golden.bin');
const GOLDEN_N = 12;

/** 골든 파일을 새 ArrayBuffer 로 읽는다. 작은 Buffer 는 풀링된 ArrayBuffer 의 임의 오프셋을 가리키므로 잘라 낸다. */
function golden(): ArrayBuffer {
  const buf = readFileSync(GOLDEN_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * 골든의 앞 n 점만 남긴 올바른 파일(n 은 10 또는 11). 분석 B 의 점 데이터로 쓴다.
 * 화면의 점 수(HUD)가 A(12점)와 달라야 "지금 그린 점이 어느 분석의 것인가"를 단언할 수 있다.
 * 형식: magic 4 + json_len 4 + JSON(json_len) + uint16 xyz[3n] + int16 dev[n].
 * n_points 의 자릿수가 12 와 같아 json_len 과 공백 패딩은 그대로다.
 */
function goldenFirst(n: number): ArrayBuffer {
  const src = new Uint8Array(golden());
  const jsonLen = new DataView(src.buffer).getUint32(4, true);
  const body = 8 + jsonLen;
  const json = new TextDecoder().decode(src.subarray(8, body));
  const edited = new TextEncoder().encode(json.replace(`"n_points":${GOLDEN_N}`, `"n_points":${n}`));
  if (edited.length !== jsonLen || n < 10 || n >= GOLDEN_N) throw new Error('goldenFirst: n 은 10 또는 11 이어야 한다');
  const out = new Uint8Array(body + 8 * n);
  out.set(src.subarray(0, 8), 0);
  out.set(edited, 8);
  out.set(src.subarray(body, body + 6 * n), body);                                       // xyz 앞 3n 개
  out.set(src.subarray(body + 6 * GOLDEN_N, body + 6 * GOLDEN_N + 2 * n), body + 6 * n); // dev 앞 n 개
  return out.buffer;
}

/** magic 첫 바이트를 깨뜨린 버퍼. parsePoints3d 가 bad_magic 으로 거부한다. */
function brokenGolden(): ArrayBuffer {
  const bytes = new Uint8Array(golden());
  bytes[0] = 0x58;
  return bytes.buffer;
}

// 분석 A: 파일 이름을 엔진의 실제 이름과 다르게 준다. 대시보드가 이름을 리터럴로 고정하면 URL 단언이 죽는다.
const stats3d: Stats = {
  ...stats, preview3d_paths: ['preview3d.png'],
  points3d_paths: ['custom3d.bin'], points3d_threshold_q: 70,
};
const analysisA: AnalysisRow = { ...analysis, stats: stats3d };
// 분석 B: id, artifacts_dir, 파일 이름, 기본 임계값이 전부 A 와 다르다
const analysisB: AnalysisRow = {
  ...analysis, id: 'an2', artifacts_dir: 'artifacts/an2',
  stats: { ...stats3d, points3d_paths: ['points3d.bin'], points3d_threshold_q: 60 },
};
const URL_A = '/api/data/artifacts/an1/custom3d.bin';
const URL_B = '/api/data/artifacts/an2/points3d.bin';

// 화면 문구(스펙 §7.12 전문 그대로)
const M1 = '벽면 분석은 3D 프리뷰 이미지와 3D 점군 뷰를 제공하지 않습니다.';
const M2 = '외부 결과(임포트)에는 3D 점군 데이터를 생성하지 않습니다.';
const M4 = '이 기기는 그래픽 가속을 사용할 수 없어 3D 점군 뷰가 느릴 수 있습니다. 기본으로 정적 이미지를 표시합니다.';
const M5 = '3D 점군 데이터를 저장소에서 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.';
const M6 = '3D 점군 데이터 형식을 읽을 수 없습니다. 지원하지 않는 버전이거나 손상된 파일입니다.';
const M7 = '이 브라우저 또는 기기에서는 WebGL2를 사용할 수 없어 3D 점군 뷰를 표시할 수 없습니다.';

function okBin(buf: ArrayBuffer): Response {
  return { ok: true, status: 200, arrayBuffer: async () => buf } as unknown as Response;
}
// 404 응답에도 본문이 있다(오류 페이지). ok 를 보지 않고 본문을 읽으면 받기 실패가 형식 오류로 둔갑한다
const NOT_FOUND = {
  ok: false, status: 404,
  arrayBuffer: async () => new TextEncoder().encode('<html>Not Found</html>').buffer,
} as unknown as Response;

/** 테스트가 직접 resolve 하는 응답(늦은 응답 순서를 만들 때 쓴다). */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/**
 * URL 로 갈라 응답하는 fetch 스텁. cells.json 은 빈 배열(json), *.bin 은 binReply 가 정한다(arrayBuffer).
 * binUrls() 는 지금까지 나간 *.bin 요청의 URL 목록(호출 순)이다. cells.json 요청은 세지 않는다.
 * binReply 의 둘째 인자는 그 요청이 몇 번째 *.bin 요청인가(1부터)다.
 */
function stubFetch(binReply: (url: string, nth: number) => Promise<Response>) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.endsWith('.bin')) return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    urls.push(url);
    return binReply(url, urls.length);
  }));
  return { binUrls: () => [...urls] };
}

const probeMock = vi.mocked(probeWebgl2);
let webgl2Available = true;
let getContextSpy: ReturnType<typeof stubGetContext>;

// jsdom 의 getContext 는 null 이다. 'webgl2' 요청에만 gl 호출 기록 스텁을 주고 나머지(히트맵의 '2d')는 null 로 둔다.
function stubGetContext() {
  const rec = recordingGl();
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((id: string) => (id === 'webgl2' && webgl2Available ? rec.gl : null)) as unknown as HTMLCanvasElement['getContext'],
  );
}
/** Points3dView 마운트 횟수(마운트마다 getContext('webgl2', ...) 를 한 번 부른다). */
const webgl2Calls = () => getContextSpy.mock.calls.filter((c) => c[0] === 'webgl2').length;

const open3d = () => fireEvent.click(screen.getByRole('tab', { name: '3D 프리뷰' }));
const openHeatmap = () => fireEvent.click(screen.getByRole('tab', { name: '히트맵' }));
const viewerCanvas = () => screen.queryByRole('img', { name: '3D 점군 뷰어' });
const findViewer = () => screen.findByRole('img', { name: '3D 점군 뷰어' });
const thresholdSlider = () => screen.getByLabelText('표시 임계값(mm)') as HTMLInputElement;
const hudText = () => screen.getByTestId('points3d-hud').textContent ?? '';
/** 보류 중인 promise 연쇄(fetch -> arrayBuffer -> setState)와 그 뒤의 effect 를 끝까지 흘려보낸다. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('AnalysisResult 3D 프리뷰 탭 (점 파일 지연 적재)', () => {
  beforeEach(() => {
    webgl2Available = true;
    getContextSpy = stubGetContext();
    probeMock.mockReset();
    probeMock.mockReturnValue('hardware');
  });
  afterEach(() => {
    tabProbe.render = null;
    getContextSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('마운트만으로는 점 파일을 받지 않고 WebGL2 탐지도 하지 않는다(다른 탭을 열어도 같다)', async () => {
    const { binUrls } = stubFetch(async () => okBin(golden()));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    await waitFor(() => expect(screen.getByText('표시할 셀 데이터가 없습니다.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: '정밀 편차맵' }));
    await flush();

    expect(binUrls()).toEqual([]);
    expect(probeMock).not.toHaveBeenCalled();
    expect(webgl2Calls()).toBe(0);
  });

  it('3D 탭 첫 진입에 stats 가 준 이름으로 한 번 받아 뷰어를 그린다(PNG·옛 문구 없음, 탭 줄 그대로)', async () => {
    const { binUrls } = stubFetch(async () => okBin(golden()));
    const { container } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    await findViewer();

    // 파일명은 리터럴이 아니라 stats.points3d_paths[0] 이다
    expect(binUrls()).toEqual([URL_A]);
    expect(probeMock).toHaveBeenCalledTimes(1);
    // 기본 임계값은 stats.points3d_threshold_q (70 = 7mm). 골든은 12점
    expect(thresholdSlider().value).toBe('70');
    expect(hudText()).toContain('12점');
    // 뷰어가 보일 때는 기존 PNG 를 함께 그리지 않는다. 옛 캡션과 옛 빈 상태 문구는 없앴다
    expect(screen.queryByAltText(/^3D 프리뷰 /)).toBeNull();
    expect(container.textContent).not.toContain('정식 단계 백로그');
    expect(container.textContent).not.toContain('3D 프리뷰가 없습니다');
    // 탭 이름·순서와 활성 탭, 느슨한 팔레트 단언을 3D 탭을 연 상태에도 똑같이 건다
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['히트맵', '정밀 편차맵', '3D 프리뷰', '현장 사진']);
    expect(screen.getByRole('tab', { name: '3D 프리뷰' })).toHaveAttribute('aria-selected', 'true');
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-|green-|purple-/);
  });

  it('다른 탭에 갔다 돌아와도 다시 받지 않고 다시 탐지하지 않는다(로딩 틀 없이 곧바로 뷰어)', async () => {
    const { binUrls } = stubFetch(async () => okBin(golden()));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    await findViewer();

    for (let i = 0; i < 2; i++) {
      openHeatmap();
      expect(viewerCanvas()).toBeNull();   // 탭 본문은 조건부 렌더라 언마운트된다
      open3d();
      // 데이터와 탐지 결과가 상위 state 에 남아 있으므로 첫 렌더가 뷰어다
      expect(viewerCanvas()).not.toBeNull();
      expect(screen.queryByTestId('points3d-loading')).toBeNull();
    }
    await flush();
    expect(binUrls()).toEqual([URL_A]);
    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(webgl2Calls()).toBe(3);   // 뷰어는 탭에 들어올 때마다 새로 마운트된다(첫 진입 1 + 왕복 2)
  });

  it('소프트웨어 렌더: 선택 전에는 받지 않고, "3D로 보기" 뒤에는 탭을 왕복해도 다시 누르지 않는다', async () => {
    probeMock.mockReturnValue('software');
    const { binUrls } = stubFetch(async () => okBin(golden()));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();

    const optIn = await screen.findByRole('button', { name: '3D로 보기' });
    expect(screen.getByText(M4)).toBeInTheDocument();
    expect((screen.getByAltText('3D 프리뷰 preview3d.png') as HTMLImageElement).getAttribute('src'))
      .toBe('/api/data/artifacts/an1/preview3d.png');
    await flush();
    expect(binUrls()).toEqual([]);          // 선택 전에는 점 파일을 받지 않는다
    expect(webgl2Calls()).toBe(0);

    fireEvent.click(optIn);
    await findViewer();
    expect(binUrls()).toEqual([URL_A]);

    openHeatmap();
    open3d();
    expect(viewerCanvas()).not.toBeNull();  // 곧바로 뷰어
    expect(screen.queryByRole('button', { name: '3D로 보기' })).toBeNull();
    await flush();
    expect(binUrls()).toEqual([URL_A]);
    expect(probeMock).toHaveBeenCalledTimes(1);
  });

  it('3D 탭을 연 채 다른 분석으로 바꾸면 새로 받고, 받는 동안 이전 분석의 점을 그리지 않는다', async () => {
    const b = deferred<Response>();
    const { binUrls } = stubFetch((url) => (url === URL_B ? b.promise : Promise.resolve(okBin(golden()))));
    const { rerender } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    await findViewer();
    expect(hudText()).toContain('12점');

    // page.tsx 는 AnalysisResult 에 key 를 주지 않는다. 같은 인스턴스가 재사용되고 tab·load state 가 남는다
    rerender(<AnalysisResult analysis={analysisB} scan={scan} photos={[]} />);
    // 바꾼 직후의 첫 렌더부터 A 의 점으로 뷰어를 그리지 않는다
    expect(viewerCanvas()).toBeNull();
    expect(screen.getByTestId('points3d-loading')).toBeInTheDocument();
    await waitFor(() => expect(binUrls()).toEqual([URL_A, URL_B]));
    expect(viewerCanvas()).toBeNull();

    b.resolve(okBin(goldenFirst(11)));
    await findViewer();
    expect(hudText()).toContain('11점');             // B 의 점
    expect(thresholdSlider().value).toBe('60');      // B 의 points3d_threshold_q
    expect(probeMock).toHaveBeenCalledTimes(1);      // 탐지 결과는 분석을 바꿔도 유지한다
    expect(binUrls()).toEqual([URL_A, URL_B]);
  });

  it('늦은 응답: B 를 받는 중에 A 의 응답이 먼저 도착해도 A 를 그리지 않고, B 가 도착하면 B 를 그린다', async () => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    const { binUrls } = stubFetch((url) => (url === URL_A ? a.promise : b.promise));
    const { rerender } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    await waitFor(() => expect(binUrls()).toEqual([URL_A]));
    rerender(<AnalysisResult analysis={analysisB} scan={scan} photos={[]} />);
    await waitFor(() => expect(binUrls()).toEqual([URL_A, URL_B]));

    a.resolve(okBin(golden()));
    await flush();
    expect(viewerCanvas()).toBeNull();
    expect(screen.getByTestId('points3d-loading')).toBeInTheDocument();

    b.resolve(okBin(goldenFirst(11)));
    await findViewer();
    expect(hudText()).toContain('11점');
    expect(thresholdSlider().value).toBe('60');
    expect(binUrls()).toEqual([URL_A, URL_B]);
  });

  it('늦은 응답: B 를 그린 뒤에 A 의 응답이 도착해도 B 의 상태가 유지되고 다시 받지 않는다', async () => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    const { binUrls } = stubFetch((url) => (url === URL_A ? a.promise : b.promise));
    const { rerender } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    await waitFor(() => expect(binUrls()).toEqual([URL_A]));
    rerender(<AnalysisResult analysis={analysisB} scan={scan} photos={[]} />);
    await waitFor(() => expect(binUrls()).toEqual([URL_A, URL_B]));

    b.resolve(okBin(goldenFirst(11)));
    await findViewer();
    const mounts = webgl2Calls();

    a.resolve(okBin(golden()));
    await flush();
    expect(viewerCanvas()).not.toBeNull();
    expect(screen.queryByTestId('points3d-loading')).toBeNull();
    expect(hudText()).toContain('11점');
    expect(thresholdSlider().value).toBe('60');
    expect(binUrls()).toEqual([URL_A, URL_B]);   // A 의 응답 때문에 B 를 다시 받지 않는다
    expect(webgl2Calls()).toBe(mounts);          // 뷰어가 다시 마운트되지도 않는다
  });

  it.each<[string, () => Promise<Response>]>([
    ['404 응답', () => Promise.resolve(NOT_FOUND)],
    ['fetch 예외', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['arrayBuffer() 예외', () => Promise.resolve({
      ok: true, status: 200, arrayBuffer: () => Promise.reject(new TypeError('network error')),
    } as unknown as Response)],
  ])('받기 실패(%s): 사유를 드러내고, 다시 시도를 누르면 한 번 더 받아 뷰어를 그린다', async (_name, fail) => {
    const { binUrls } = stubFetch((_url, nth) => (nth === 1 ? fail() : Promise.resolve(okBin(golden()))));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();

    expect(await screen.findByText(M5)).toBeInTheDocument();
    expect(screen.getByText(M5).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(viewerCanvas()).toBeNull();
    await flush();
    expect(binUrls()).toEqual([URL_A]);   // 실패 뒤에 스스로 다시 받지 않는다

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await findViewer();
    expect(binUrls()).toEqual([URL_A, URL_A]);
    expect(screen.queryByText(M5)).toBeNull();
  });

  it('형식 불일치: 읽을 수 없는 버퍼면 형식 오류를 드러내고, 다시 시도로 다시 받는다', async () => {
    const { binUrls } = stubFetch((_url, nth) => Promise.resolve(okBin(nth === 1 ? brokenGolden() : golden())));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();

    expect(await screen.findByText(M6)).toBeInTheDocument();
    expect(screen.getByText(M6).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.queryByText(M5)).toBeNull();   // 받기 실패와 구분된다
    expect(viewerCanvas()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await findViewer();
    expect(binUrls()).toEqual([URL_A, URL_A]);
  });

  it('분석을 바꾸면 이전 분석의 뷰어 오류가 남지 않는다(탭 본문이 새로 마운트된다)', async () => {
    const { binUrls } = stubFetch((url) => Promise.resolve(okBin(url === URL_B ? goldenFirst(11) : golden())));
    webgl2Available = false;   // A 에서는 렌더러를 만들지 못한다
    const { rerender } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    expect(await screen.findByText(M7)).toBeInTheDocument();

    webgl2Available = true;
    rerender(<AnalysisResult analysis={analysisB} scan={scan} photos={[]} />);
    await findViewer();
    expect(screen.queryByText(M7)).toBeNull();
    expect(binUrls()).toEqual([URL_A, URL_B]);
    expect(thresholdSlider().value).toBe('60');
  });

  it('개발 모드의 effect 이중 실행(StrictMode)에서도 점 파일 요청은 한 번만 나간다', async () => {
    const { binUrls } = stubFetch((url) => Promise.resolve(okBin(url === URL_B ? goldenFirst(11) : golden())));
    const { rerender } = render(
      <StrictMode><AnalysisResult analysis={analysisA} scan={scan} photos={[]} /></StrictMode>,
    );
    open3d();
    await findViewer();
    expect(binUrls()).toEqual([URL_A]);

    // 탐지 결과가 이미 있는 상태에서 3D 탭에 들어오면 요청 effect 가 마운트 시점에 참이다.
    // StrictMode 는 마운트 effect 를 두 번 돌리고, 두 번 모두 같은 렌더의 load(idle)를 본다.
    openHeatmap();
    rerender(<StrictMode><AnalysisResult analysis={analysisB} scan={scan} photos={[]} /></StrictMode>);
    open3d();
    await findViewer();
    await flush();
    expect(binUrls()).toEqual([URL_A, URL_B]);
    expect(hudText()).toContain('11점');
  });

  it('벽면 분석: 안내 문구만 보이고 탐지도 받기도 하지 않는다', async () => {
    const { binUrls } = stubFetch(async () => okBin(golden()));
    const wall: AnalysisRow = { ...analysis, surface: 'wall' };
    const { container } = render(<AnalysisResult analysis={wall} scan={scan} photos={[]} />);
    open3d();
    await flush();

    expect(screen.getByText(M1)).toBeInTheDocument();
    expect(container.textContent).not.toContain('3D 프리뷰가 없습니다');
    expect(binUrls()).toEqual([]);
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('임포트 결과: 재분석을 권하지 않는 안내가 보이고 탐지도 받기도 하지 않는다', async () => {
    const { binUrls } = stubFetch(async () => okBin(golden()));
    const imported: AnalysisRow = {
      ...analysis, engine_version: 'external-colab-v1',
      stats: { ...stats, meta: { ...stats.meta, engine_version: 'external-colab-v1', source: 'colab-import' } },
    };
    const { container } = render(<AnalysisResult analysis={imported} scan={scan} photos={[]} />);
    open3d();
    await flush();

    expect(screen.getByText(M2)).toBeInTheDocument();
    expect(container.textContent).not.toContain('재분석하면 생성됩니다');
    expect(binUrls()).toEqual([]);
    expect(probeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: 실패하는 테스트 작성 3/3 (콜백 계약 테스트 5건)**

같은 파일의 맨 끝에 이어서 붙인다. 실제 `Preview3dTab`은 요청 effect가 스스로 걸러 부르므로(`shouldRequestLoad`) 통합 테스트만으로는 `requestPoints3dLoad`의 가드가 하중을 받지 않는다. 이 블록은 탭 자리에 탐침을 끼워 콜백을 직접 부른다.

```tsx
// AnalysisResult 가 Preview3dTab 에 넘기는 콜백의 계약(스펙 §7.3 의 4·8·10번)을 직접 부른다.
// 실제 Preview3dTab 은 요청 effect 가 스스로 걸러 부르므로, 통합 테스트만으로는 멱등 가드가 하중을 받지 않는다.
describe('AnalysisResult 가 3D 탭에 넘기는 적재 콜백 (탐침으로 직접 호출)', () => {
  /** 탐침: 적재 상태를 글자로 보이고, 콜백을 부르는 버튼을 둔다. */
  function useProbe() {
    tabProbe.render = (p) => (
      <div>
        <output data-testid="probe-load">{'dir' in p.load ? `${p.load.status}:${p.load.dir}` : p.load.status}</output>
        <output data-testid="probe-support">{String(p.support)}</output>
        <output data-testid="probe-opted">{String(p.optedIn)}</output>
        <button onClick={() => { p.onRequestLoad(); p.onRequestLoad(); }}>요청 두 번</button>
        <button onClick={() => p.onRequestLoad()}>요청</button>
        <button onClick={() => p.onRetryLoad()}>다시 받기</button>
        <button onClick={() => p.onSupport('software')}>탐지 결과</button>
        <button onClick={() => p.onOptIn()}>선택</button>
      </div>
    );
  }
  const loadText = () => screen.getByTestId('probe-load').textContent;
  const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

  afterEach(() => {
    tabProbe.render = null;
    vi.unstubAllGlobals();
  });

  it('onRequestLoad 는 멱등이다: 같은 렌더에서 두 번, 받는 중, 받은 뒤 어느 때 불러도 요청은 한 번이다', async () => {
    useProbe();
    const first = deferred<Response>();
    const { binUrls } = stubFetch(() => first.promise);
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    expect(loadText()).toBe('idle');
    await flush();
    expect(binUrls()).toEqual([]);          // 탭 본문이 요청하지 않으면 받지 않는다

    press('요청 두 번');                     // 두 호출 모두 같은 렌더의 load(idle)를 본다
    expect(binUrls()).toEqual([URL_A]);
    expect(loadText()).toBe('loading:artifacts/an1');

    press('요청');                           // 받는 중
    expect(binUrls()).toEqual([URL_A]);

    first.resolve(okBin(golden()));
    await waitFor(() => expect(loadText()).toBe('ready:artifacts/an1'));
    press('요청');                           // 받은 뒤
    await flush();
    expect(binUrls()).toEqual([URL_A]);
    expect(loadText()).toBe('ready:artifacts/an1');
  });

  it('받기에 실패한 뒤의 onRequestLoad 는 다시 받지 않고, onRetryLoad 는 검사 없이 다시 받는다', async () => {
    useProbe();
    const { binUrls } = stubFetch((_url, nth) => Promise.resolve(nth === 1 ? NOT_FOUND : okBin(golden())));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    press('요청');
    await waitFor(() => expect(loadText()).toBe('error:artifacts/an1'));

    press('요청');                           // 오류 상태는 idle 이 아니다. 스스로 다시 받지 않는다
    await flush();
    expect(binUrls()).toEqual([URL_A]);
    expect(loadText()).toBe('error:artifacts/an1');

    press('다시 받기');
    expect(loadText()).toBe('loading:artifacts/an1');   // 곧바로 loading 으로 둔다
    await waitFor(() => expect(loadText()).toBe('ready:artifacts/an1'));
    expect(binUrls()).toEqual([URL_A, URL_A]);
  });

  it.each<[string, AnalysisRow]>([
    ['점 파일 이름이 없는 분석', analysis],
    ['산출물 경로가 없는 분석', { ...analysisA, artifacts_dir: null }],
  ])('%s 에서는 onRequestLoad 와 onRetryLoad 가 아무것도 하지 않는다', async (_name, row) => {
    useProbe();
    const { binUrls } = stubFetch(async () => okBin(golden()));
    render(<AnalysisResult analysis={row} scan={scan} photos={[]} />);
    open3d();
    press('요청');
    press('다시 받기');
    await flush();

    expect(binUrls()).toEqual([]);
    expect(loadText()).toBe('idle');
  });

  it('탐지 결과와 소프트웨어 렌더 선택은 탭을 벗어나도, 분석을 바꿔도 남는다', async () => {
    useProbe();
    stubFetch(async () => okBin(golden()));
    const { rerender } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    expect(screen.getByTestId('probe-support').textContent).toBe('null');
    expect(screen.getByTestId('probe-opted').textContent).toBe('false');

    press('탐지 결과');
    press('선택');
    openHeatmap();
    rerender(<AnalysisResult analysis={analysisB} scan={scan} photos={[]} />);
    open3d();
    expect(screen.getByTestId('probe-support').textContent).toBe('software');
    expect(screen.getByTestId('probe-opted').textContent).toBe('true');
    await flush();
  });
});
```

- [ ] **Step 8: 실패 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/analysis-result.test.tsx`

Expected: `Tests  19 failed | 5 passed (24)`.
- 통과 5건: 기존 4건과 `마운트만으로는 점 파일을 받지 않고 WebGL2 탐지도 하지 않는다(다른 탭을 열어도 같다)`. 마지막 것은 "하지 않는다"를 지키는 가드라 구현 전에도 통과한다(Step 13의 1번 변이가 이 테스트를 죽이는 것으로 하중을 확인한다).
- 실패 19건의 메시지: 뷰어를 기다리는 테스트는 `Unable to find role="img" and name "3D 점군 뷰어"`, 문구를 찾는 테스트는 `Unable to find an element with the text: ...`, 늦은 응답 2건은 `expected [] to deeply equal [ Array(1) ]`(점 파일 요청이 나가지 않는다), 탐침 5건은 `Unable to find an element by: [data-testid="probe-load"]` 또는 버튼을 찾지 못한다는 오류다. 옛 3D 탭 본문이 아직 그대로이기 때문이다.

모듈을 찾지 못한다는 오류(`Failed to resolve import`)가 나오면 Step 1의 전제가 깨진 것이다.

- [ ] **Step 9: 구현 (`analysis-result.tsx` 네 곳)**

`dashboard/components/analysis/analysis-result.tsx`를 고친다. 아래 네 곳 외에는 건드리지 않는다.

(1) import (`:4-11`). 바꾸기 전:

```tsx
import { useEffect, useState } from 'react';
import { artifactUrl } from '@/lib/domain/paths';
import { isExternalImport } from '@/lib/domain/stats';
import type { AnalysisRow, CellRow, PhotoRow, ScanRow, Stats } from '@/lib/domain/types';
import { TabBar } from '@/components/ui/tab-bar';
import { HeatmapView } from './heatmap-view';
import { DeviationView } from './deviation-view';
import { VerdictPanel } from './verdict-panel';
```

바꾼 뒤:

```tsx
import { useEffect, useRef, useState } from 'react';
import { artifactUrl } from '@/lib/domain/paths';
import { loadFor, parsePoints3d, points3dFile } from '@/lib/domain/points3d';
import type { Points3dLoad, Webgl2Support } from '@/lib/domain/points3d';
import { isExternalImport } from '@/lib/domain/stats';
import type { AnalysisRow, CellRow, PhotoRow, ScanRow, Stats } from '@/lib/domain/types';
import { TabBar } from '@/components/ui/tab-bar';
import { HeatmapView } from './heatmap-view';
import { DeviationView } from './deviation-view';
import { Preview3dTab } from './preview3d-tab';
import { VerdictPanel } from './verdict-panel';
```

(2) state (`:36-39`). 바꾸기 전:

```tsx
  const stats = analysis.stats as Stats; // status done 전제(페이지에서 보장)
  const [tab, setTab] = useState<Tab>('heatmap');
  const [cells, setCells] = useState<CellRow[] | null>(null);
  const [cellsError, setCellsError] = useState<string | null>(null);
```

바꾼 뒤:

```tsx
  const stats = analysis.stats as Stats; // status done 전제(페이지에서 보장)
  const [tab, setTab] = useState<Tab>('heatmap');
  const [cells, setCells] = useState<CellRow[] | null>(null);
  const [cellsError, setCellsError] = useState<string | null>(null);
  // 3D 점군 뷰어(2026-10-02 스펙 §7.3). 탭 본문은 조건부 렌더라 탭을 벗어나면 언마운트된다.
  // 탭 왕복 뒤에도 남아야 하는 세 가지(점 데이터, WebGL2 탐지 결과, 소프트웨어 렌더 선택)를 여기에 둔다.
  const [load, setLoad] = useState<Points3dLoad>({ status: 'idle' });
  const [support, setSupport] = useState<Webgl2Support | null>(null);
  const [optedIn, setOptedIn] = useState(false);
  // 진행 중인 점 파일 요청의 dir. 개발 모드의 effect 이중 실행은 같은 렌더의 load(아직 idle)를 두 번 보므로,
  // state 만으로는 fetch 가 두 번 나간다. ref 는 첫 호출이 남긴 값을 둘째 호출이 곧바로 본다.
  const pendingDir = useRef<string | null>(null);
```

(3) 3D 프리뷰 PNG 목록 자리 (`:57-61`). PNG 목록(`preview3d`)은 이제 `Preview3dTab`이 stats에서 직접 만든다. 그 줄을 지우고 적재 함수 3개를 둔다. 바꾸기 전:

```tsx
  const preview3d = (stats.preview3d_paths ?? []).filter(Boolean);
  const deviation = (stats.deviation_paths ?? []).filter(Boolean);
  const isImport = isExternalImport(analysis.engine_version, stats.meta);

  return (
```

바꾼 뒤:

```tsx
  const deviation = (stats.deviation_paths ?? []).filter(Boolean);
  const isImport = isExternalImport(analysis.engine_version, stats.meta);
  const points3dDir = analysis.artifacts_dir;
  // 받을 파일 이름은 엔진이 stats 에 적은 값이다. 대시보드에 파일명 상수를 두지 않는다(다른 *_paths 와 같은 규약).
  const points3dName = points3dFile(stats);

  // 점 파일을 받는다. 마운트 때가 아니라 Preview3dTab 의 요청 effect(또는 다시 시도 버튼)가 부를 때만 시작한다.
  // 서명 URL 을 보관하지 않는다. 다시 받을 때도 /api/data 를 다시 거친다.
  function startPoints3dLoad(dir: string, file: string) {
    pendingDir.current = dir;
    setLoad({ status: 'loading', dir });
    void (async () => {
      let next: Points3dLoad;
      // fetch 와 arrayBuffer() 는 둘 다 reject 할 수 있다(slope-result.tsx 와 같은 양식).
      // 잡지 않으면 화면이 로딩 틀에 영구히 멈춘다(조용한 실패 금지).
      try {
        const res = await fetch(artifactUrl(dir, file));
        if (!res.ok) {
          next = { status: 'error', dir, reason: 'fetch' };
        } else {
          const parsed = parsePoints3d(await res.arrayBuffer());
          next = parsed.ok
            ? { status: 'ready', dir, data: parsed.data }
            : { status: 'error', dir, reason: 'format' };
        }
      } catch {
        next = { status: 'error', dir, reason: 'fetch' };
      }
      if (pendingDir.current === dir) pendingDir.current = null;
      // 늦게 온 응답을 버린다: 지금도 이 dir 의 응답을 기다리는 중일 때만 반영한다.
      // 그 사이 다른 분석의 요청이 시작됐으면(?analysis= 전환) 상태를 건드리지 않는다.
      setLoad((cur) => (cur.status === 'loading' && cur.dir === dir ? next : cur));
    })();
  }

  // 멱등: 이 분석의 요청이 이미 시작됐거나 끝났으면 아무것도 하지 않는다.
  // 다른 분석의 옛 상태는 loadFor 가 idle 로 보므로 새 요청이 그것을 교체한다(load 를 되돌리는 effect 는 두지 않는다).
  function requestPoints3dLoad() {
    if (points3dDir === null || points3dName === null) return;
    if (loadFor(load, points3dDir).status !== 'idle' || pendingDir.current === points3dDir) return;
    startPoints3dLoad(points3dDir, points3dName);
  }

  // 다시 시도: 멱등 검사 없이 상태를 버리고 곧바로 다시 받는다.
  function retryPoints3dLoad() {
    if (points3dDir === null || points3dName === null) return;
    startPoints3dLoad(points3dDir, points3dName);
  }

  return (
```

(4) 3D 탭 본문 (`:76-94`). 옛 캡션과 옛 빈 상태 문구가 함께 사라진다. 바꾸기 전:

```tsx
          {tab === 'preview3d' && (
            preview3d.length > 0 ? (
              <div className="flex flex-col gap-3">
                {preview3d.map((name) => (
                  // 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={name} src={artifactUrl(analysis.artifacts_dir!, name)} alt={`3D 프리뷰 ${name}`}
                    className="max-w-full rounded-lg border border-cs-divider bg-white" />
                ))}
                <p className="text-xs leading-4 text-cs-text-secondary">
                  워커가 생성한 정적 3D 프리뷰입니다(회전·줌 가능한 뷰어는 정식 단계 백로그).
                </p>
              </div>
            ) : (
              <p className={MUTED}>
                3D 프리뷰가 없습니다{analysis.surface === 'wall' ? ' (벽면 분석은 3D 프리뷰를 생성하지 않습니다)' : ''}.
              </p>
            )
          )}
```

바꾼 뒤:

```tsx
          {tab === 'preview3d' && (
            // key: 이 컴포넌트는 ?analysis= 로 분석을 바꿔도 같은 인스턴스가 재사용된다(page.tsx 에 key 가 없다).
            // 분석이 바뀌면 탭 본문을 새로 마운트해 오류 플래그와 뷰어의 시점·과장·임계값·배경을 초기값으로 되돌린다.
            <Preview3dTab key={analysis.id} analysis={analysis} stats={stats} scan={scan} isImport={isImport}
              load={load} support={support} optedIn={optedIn}
              onSupport={setSupport} onOptIn={() => setOptedIn(true)}
              onRequestLoad={requestPoints3dLoad} onRetryLoad={retryPoints3dLoad} />
          )}
```

붙여 넣은 결과를 확인한다.

Run:

```bash
cd D:/Projects/Flatness
git diff --numstat -- dashboard/components/analysis/analysis-result.tsx
grep -n "preview3d_paths\|백로그\|3D 프리뷰가 없습니다" dashboard/components/analysis/analysis-result.tsx; echo "exit=$?"
```

Expected: 첫 명령 `64	19	dashboard/components/analysis/analysis-result.tsx`(추가 줄 수, 삭제 줄 수). 둘째 명령은 일치하는 줄 없이 `exit=1`.

- [ ] **Step 10: 통과 확인**

Run: `cd dashboard && npx vitest run components/analysis/__tests__/analysis-result.test.tsx`

Expected: `Tests  24 passed (24)`. 출력에 `act(...)` 경고와 `Unhandled` 오류가 없어야 한다(jsdom의 `Not implemented: HTMLCanvasElement's getContext()` 줄은 이 파일에서는 나오지 않는다. 스파이가 가로챈다). `act(...)` 경고가 나오면 테스트 코드에 `act`·`waitFor` 밖의 맨 `await`가 섞인 것이다(함정 13번). 구현이 아니라 그 기다림을 `flush()`나 `waitFor`로 바꾼다.

실패하면 메시지를 보고 다음을 먼저 확인한다.
- `points3d-hud`를 찾지 못한다, 슬라이더를 찾지 못한다: Task 12의 DOM 계약이 Step 1의 일곱째 grep과 다르다. 테스트의 헬퍼(`hudText`, `thresholdSlider`, `viewerCanvas`) 한 곳만 실제 이름에 맞춘다. 단언의 뜻(어느 분석의 점인가, 기본 임계값이 무엇인가)은 바꾸지 않는다.
- `webgl2Calls()`가 기대와 다르다: `Points3dView`가 마운트마다 `getContext('webgl2', ...)`를 한 번 부르는지 확인한다(Task 12 계약).

- [ ] **Step 11: `deviation-view.tsx` 주석 수정**

`dashboard/components/analysis/deviation-view.tsx:18-19`의 주석을 고친다. 지금까지 3D 탭에는 임포트 분기가 없어서 "3D 프리뷰 탭과 동일한 분기 선례"는 사실이 아니었다. 이번에 생긴 분기를 가리키게 한다. `:17`(주석의 첫 줄)과 `:20`(`isImport: boolean;`)은 그대로 둔다.

바꾸기 전(`:18-19`):

```tsx
  // 않으므로 재분석을 권해선 안 된다(무한 재시도 유도 방지). 판별은 호출부가
  // lib/domain/stats.ts의 isExternalImport로 넘긴다(3D 프리뷰 탭과 동일한 분기 선례)
```

바꾼 뒤(3줄):

```tsx
  // 않으므로 재분석을 권해선 안 된다(무한 재시도 유도 방지). 판별은 호출부(analysis-result.tsx)가
  // lib/domain/stats.ts의 isExternalImport로 넘긴다. 3D 프리뷰 탭도 같은 값을 받아 임포트를
  // 가른다(preview3d-tab.tsx의 import 모드: 임포트 결과에는 재분석을 권하지 않는다)
```

Run: `cd dashboard && npx vitest run components/analysis/__tests__/deviation-view.test.tsx`

Expected: 전부 통과(주석만 바뀌었다).

- [ ] **Step 12: 전체 스위트, 타입 검사, 린트, 리터럴 확인**

Run:

```bash
cd D:/Projects/Flatness/dashboard
npx vitest run
npx tsc --noEmit
npx eslint components/analysis/analysis-result.tsx components/analysis/deviation-view.tsx components/analysis/__tests__/analysis-result.test.tsx __tests__/points3d-litmus.test.ts
npx vitest run __tests__/palette-sweep.test.ts __tests__/points3d-litmus.test.ts
cd D:/Projects/Flatness
grep -rnE "['\"\`]points3d\.bin['\"\`]" dashboard/app dashboard/components dashboard/lib --include=*.ts --include=*.tsx | grep -v "__tests__"; echo "exit=$?"
```

Expected:
- vitest 전체: `Test Files  (F + 1) passed`, `Tests  (N + 23) passed`(F·N은 Step 1에서 적은 값. 이 태스크가 더한 것은 파일 1개, `analysis-result.test.tsx` 20건, litmus 3건이다). 2026-10-02 기준선(84파일 769건)에서 앞 태스크가 더한 만큼 F·N이 커져 있다.
- `tsc`: 출력 없음(오류 0).
- `eslint`: 오류·경고 없음.
- palette-sweep 2건과 litmus 3건 통과(`palette-sweep.test.ts`는 고치지 않았다).
- 마지막 grep: 일치하는 줄 없음, `exit=1`(대시보드 코드에 점 파일 이름 리터럴이 없다. 테스트 파일의 B 분석 픽스처만 그 이름을 갖는다).

- [ ] **Step 13: 스테이징 후 변이 확인**

먼저 스테이징한다(변이를 되돌릴 때 인덱스가 원본 역할을 한다).

```bash
cd D:/Projects/Flatness
git add dashboard/__tests__/points3d-litmus.test.ts dashboard/components/analysis/analysis-result.tsx dashboard/components/analysis/__tests__/analysis-result.test.tsx dashboard/components/analysis/deviation-view.tsx
```

아래 변이를 **하나씩** 넣고 `cd dashboard && npx vitest run components/analysis/__tests__/analysis-result.test.tsx __tests__/points3d-litmus.test.ts`를 돌려 적힌 테스트가 죽는지 본 뒤, 곧바로 저장소 루트에서 `git restore <고친 파일>`로 되돌린다. 테스트 파일은 건드리지 않는다. 1~11번은 `dashboard/components/analysis/analysis-result.tsx`를 고친다.

1. **마운트 때 fetch.** `// 다시 시도: 멱등 검사 없이` 줄 바로 위에 `useEffect(() => { requestPoints3dLoad(); });` 한 줄을 넣는다.
   죽어야 하는 테스트: `마운트만으로는 점 파일을 받지 않고 ...`, `소프트웨어 렌더: 선택 전에는 받지 않고 ...`, `(탐침) onRequestLoad 는 멱등이다 ...`.
2. **fetch 파일명을 리터럴로 고정.** `fetch(artifactUrl(dir, file))`를 `fetch(artifactUrl(dir, 'points3d.bin'))`로.
   죽어야 하는 테스트: `3D 탭 첫 진입에 stats 가 준 이름으로 ...`을 비롯해 `URL_A`를 단언하는 테스트 전부(초안 실측 14건).
3. **늦게 온 응답을 무조건 반영.** `setLoad((cur) => (cur.status === 'loading' && cur.dir === dir ? next : cur));`를 `setLoad(next);`로.
   죽어야 하는 테스트: `늦은 응답: B 를 그린 뒤에 A 의 응답이 도착해도 ...`.
4. **응답 반영에서 dir 비교만 제거.** 같은 줄을 `setLoad((cur) => (cur.status === 'loading' ? next : cur));`로.
   죽어야 하는 테스트: `늦은 응답: B 를 받는 중에 A 의 응답이 먼저 도착해도 ...`.
5. **`key={analysis.id}` 제거.** `<Preview3dTab key={analysis.id} analysis={analysis}`를 `<Preview3dTab analysis={analysis}`로.
   죽어야 하는 테스트: `분석을 바꾸면 이전 분석의 뷰어 오류가 남지 않는다 ...`. (임계값 단언은 이 변이에서 죽지 않는다. 함정 6번)
6. **진행 중 dir ref 검사 제거.** `if (loadFor(load, points3dDir).status !== 'idle' || pendingDir.current === points3dDir) return;`를 `if (loadFor(load, points3dDir).status !== 'idle') return;`로.
   죽어야 하는 테스트: `개발 모드의 effect 이중 실행(StrictMode)에서도 ...`, `(탐침) onRequestLoad 는 멱등이다 ...`.
7. **멱등 검사에서 `loadFor` 제거.** 같은 줄을 `if (pendingDir.current === points3dDir) return;`로.
   죽어야 하는 테스트: `(탐침) onRequestLoad 는 멱등이다 ...`, `(탐침) 받기에 실패한 뒤의 onRequestLoad 는 다시 받지 않고 ...`.
8. **`try`/`catch` 제거.** `} catch {` 부터 그 블록의 닫는 `}`까지 세 줄을 `} finally { /* 변이 */ }` 한 줄로.
   죽어야 하는 테스트: `받기 실패(fetch 예외) ...`, `받기 실패(arrayBuffer() 예외) ...`.
9. **`res.ok` 검사 제거.** `startPoints3dLoad` 안의 `if (!res.ok) {`를 `if (false) {`로(`cells.json` effect의 같은 줄이 아니다).
   죽어야 하는 테스트: `받기 실패(404 응답) ...`.
10. **다시 시도가 멱등 검사를 거침.** `onRetryLoad={retryPoints3dLoad}`를 `onRetryLoad={requestPoints3dLoad}`로.
    죽어야 하는 테스트: `받기 실패` 3건, `형식 불일치 ...`, `(탐침) 받기에 실패한 뒤의 onRequestLoad 는 ...`.
11. **`optedIn`을 상위에 두지 않음.** `optedIn={optedIn}`을 `optedIn={false}`로.
    죽어야 하는 테스트: `소프트웨어 렌더: 선택 전에는 받지 않고 ...`, `(탐침) 탐지 결과와 소프트웨어 렌더 선택은 ...`.
12. **`loadFor`의 dir 비교 제거.** `dashboard/lib/domain/points3d.ts`의 `loadFor`에서 `if (load.status !== 'idle' && load.dir !== dir) return { status: 'idle' };` 줄을 지운다.
    죽어야 하는 테스트: `3D 탭을 연 채 다른 분석으로 바꾸면 새로 받고 ...`를 비롯한 분석 전환 테스트(초안 실측 5건).
13. **`support`·`optedIn`을 `Preview3dTab` 로컬 state로 되돌림.** `dashboard/components/analysis/preview3d-tab.tsx`에서 매개변수 자리의 props 구조 분해에서 `support`·`optedIn`·`onSupport`·`onOptIn` 네 이름을 빼고(props 타입 표기는 그대로 둔다), 기존 `const [contextLost, setContextLost] = useState(false);` 줄 바로 다음에 다음 세 줄을 넣어 같은 이름을 로컬 state로 만든다(`useState`·`Webgl2Support`는 그 파일이 이미 import한다).

    ```tsx
    const [support, onSupport] = useState<Webgl2Support | null>(null);
    const [optedIn, setOptedInLocal] = useState(false);
    const onOptIn = () => setOptedInLocal(true);
    ```

    죽어야 하는 테스트: `다른 탭에 갔다 돌아와도 다시 받지 않고 다시 탐지하지 않는다 ...`(탐지 횟수), `소프트웨어 렌더: ... 탭을 왕복해도 다시 누르지 않는다`, `3D 탭을 연 채 다른 분석으로 바꾸면 ...`(탐지 횟수).
14. **뷰어 코드가 적용 기준 허용치를 읽음.** `dashboard/lib/domain/points3d.ts`의 `defaultThresholdQ`에서 `stats.points3d_threshold_q`를 `stats.applied_criteria.pass_mm * 10`으로.
    죽어야 하는 테스트: litmus의 `뷰어 코드에 판정 기준 필드 이름이 0건이다(주석 포함)`.

열네 변이가 전부 적힌 테스트를 죽였는지 확인한다. 죽지 않는 변이가 있으면 테스트를 Step 5~7의 코드와 대조해 빠진 줄을 찾는다(변이를 살려 둔 채 넘어가지 않는다).

마지막으로 되돌려졌는지 확인한다.

```bash
cd D:/Projects/Flatness
git diff --stat
cd dashboard && npx vitest run components/analysis/__tests__/analysis-result.test.tsx __tests__/points3d-litmus.test.ts
```

Expected: `git diff --stat` 출력 없음(작업 트리가 스테이징한 내용과 같다). vitest `Tests  27 passed (27)`.

- [ ] **Step 14: 커밋**

```bash
cd D:/Projects/Flatness
git add dashboard/__tests__/points3d-litmus.test.ts dashboard/components/analysis/analysis-result.tsx dashboard/components/analysis/__tests__/analysis-result.test.tsx dashboard/components/analysis/deviation-view.tsx
git status --short
git commit -m "$(cat <<'EOF'
feat(dashboard): 3D 프리뷰 탭을 점군 뷰어로 교체(지연 적재 state, litmus 소스 검사)

AnalysisResult(스펙 2026-10-02 pointcloud-viewer §7.3):
- 3D 탭 본문을 <Preview3dTab key={analysis.id}> 로 교체했다. 옛 캡션과 옛 빈 상태 문구를 없앴다.
- 점 파일은 탭 첫 진입에 한 번만 받는다. 점 데이터, WebGL2 탐지 결과, 소프트웨어 렌더 선택을
  AnalysisResult state 에 두어 탭 왕복 뒤에도 다시 받지 않고 다시 탐지하지 않는다.
- 받을 이름은 stats.points3d_paths 가 준 값이다. 대시보드에 파일명 상수를 두지 않는다.
- 요청은 멱등이다(loadFor 와 진행 중 dir ref). 늦게 온 응답은 현재 상태가 그 dir 의 loading 일 때만 반영한다.
- fetch 와 arrayBuffer 를 try/catch 로 감싸 받기 실패와 형식 불일치를 화면에 드러낸다.

테스트:
- analysis-result.test.tsx 에 20건 추가(통합 15, 콜백 계약 5). 분석 전환, 늦은 응답 두 순서,
  StrictMode 이중 실행, 다시 시도를 포함한다.
- __tests__/points3d-litmus.test.ts 신설: 뷰어 코드 10개 파일에 판정 기준 필드 이름과 U+2014 가 0건.
- 변이 14종이 각각 테스트를 죽이는 것을 확인했다.

deviation-view.tsx 의 주석이 preview3d-tab.tsx 의 임포트 분기를 가리키도록 고쳤다(코드 변경 없음).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
git log -1 --stat
```

Expected: `git status --short`에 위 네 파일만 스테이징돼 있다(`A  dashboard/__tests__/points3d-litmus.test.ts`와 `M` 3줄). Step 4에서 앞 태스크 파일의 주석을 고쳤다면 그 파일도 `git add`해 함께 넣고 커밋 본문에 한 줄 적는다. 다른 파일이 섞여 있으면 커밋하지 말고 원인을 확인한다. `git log -1 --stat`에 그 파일들만 나온다.

---

**초안 검증 메모 (계획 작성 중 실제로 돌려 본 것).** 저장소 밖 스크래치(`.superpowers/plan-drafts/pointcloud-viewer/scratch-14/`)에 `dashboard`의 `app`·`components`·`lib`·`__tests__`를 복사하고, 저장소의 vitest·tsc·eslint를 빌려 돌렸다(`cd dashboard && npx vitest run --root <스크래치>/dashboard --config <스크래치>/dashboard/vitest.config.mjs`. bare import는 alias로 `dashboard/node_modules`를 가리키게 했다). 두 차례 돌렸다.

- **1차(2026-10-02).** Task 5의 타입 두 줄, Task 6·7의 `points3d.ts`, Task 8·9·10의 순수 모듈, 골든 파일은 각 초안의 스크래치 사본을 썼고, Task 11·12·13은 초안이 아직 없어 뼈대의 시그니처와 DOM 계약만 만족하는 최소 대역을 직접 만들어 돌렸다(`scratch-14/standins-old/`에 남겨 두었다).
- **2차(2026-10-03, 이 판).** 대역을 전부 이웃 태스크 초안이 실제로 돌린 파일로 바꿔 같은 것을 다시 확인했다: Task 6 `scratch-06/dashboard/lib/domain/points3d.ts` + Task 7 `scratch-07/verify`의 stats·적재·모드 부분(`scratch-14/merge_points3d.py`로 이어 붙임), Task 8 `scratch-08`의 `mat4.ts`·`orbit.ts`, Task 9 `scratch-09`의 `budget.ts`·`scaffold.ts`, Task 10 `scratch-10`의 `pick.ts`·`controls.ts`, Task 11 `scratch-11/lib`의 `gl-renderer.ts`·`__tests__/gl-stub.ts`, Task 12 `scratch-12/dashboard`의 `points3d-view.tsx`(최종 단계 `stages/g.tsx`와 동일), Task 13 `scratch-13/components`의 `preview3d-tab.tsx`, Task 3 `scratch-03/cycle`의 골든 파일(488바이트, sha256 `b0c50d8a...92d9`). 다른 태스크의 초안이 동시에 다시 작성되는 중이어서 그 시점의 사본이다. 뼈대의 시그니처와 DOM 계약이 그대로면 결과는 같다.
- 이 문서의 코드 블록은 그 스크래치에서 돌린 파일에서 기계적으로 옮겼다(`scratch-14/build_plan.py`. Step 9의 네 군데 바꾸기를 원본에 적용한 결과가 돌린 파일과 같은지도 그 스크립트가 단언한다).
- **2차에서 확인한 것**: Step 8의 실패 수(`19 failed | 5 passed (24)`)와 메시지 종류, Step 10의 `24 passed`(stderr 출력 0줄, `act` 경고 0), litmus `3 passed`, 스크래치 전체 스위트 `85 files, 792 passed`(기준선 84파일 769건 + 이 태스크 23건. 이웃 태스크의 테스트 파일은 넣지 않았고, `palette-sweep.test.ts`가 이웃 초안의 실제 파일까지 훑어 0건이었다), `tsc --noEmit`(스크래치 tsconfig, strict) 오류 0, 저장소 eslint 설정으로 네 파일 오류·경고 0.
- **변이(2차, `scratch-14/mutate2.py`, 기록 `mutate2-out.utf8.txt`)**: Step 13의 14종과 그 밖의 8종(형식 오류를 fetch 오류로 기록, `isImport`를 넘기지 않음, `onSupport`를 넘기지 않음, dir·file null 가드 제거 2종, 다시 시도가 `loading`으로 두지 않음, 뷰어 파일 주석에 U+2014, viz 파일 이름 변경) 22종 전부가 테스트를 죽였다. Step 13에 적은 "죽어야 하는 테스트"와 건수(2번 14건, 12번 5건)는 2차 실측값이며 1차와 같았다. 13번 변이는 이웃 초안의 실제 `preview3d-tab.tsx`(매개변수 자리 구조 분해)에 맞춰 적용했다.
- **rAF 확인**: 스크래치의 jsdom에서 `requestAnimationFrame`은 실제로 발화하고(`ResizeObserver`는 없다) 실제 `Points3dView`는 마운트 뒤 한 프레임을 그린다. 그래도 `act` 경고가 없는 이유와 지켜야 할 것을 함정 13번에 적었다.
- **확인하지 못한 것**: 저장소에 커밋된 실제 Task 5~13 산출물 위에서의 실행(아직 저장소에 없다. DOM 계약이 뼈대와 다르면 Step 10의 안내대로 헬퍼만 맞춘다), `npx next build`(스크래치에서는 돌릴 수 없다. Task 16이 돌린다), 실제 브라우저에서의 탭 왕복·분석 전환(Task 16의 장면 7).

---
### Task 15: 문서·아트보드: service-report, README 2종, 리디자인 스펙 예외, `ScanDone3D.dc.html`

**목표:** 스펙 §12의 나머지 문서 갱신과 §9의 디자인 스펙 예외 5건 기록, 3D 프리뷰 탭이 활성인 아트보드 1장이 같은 브랜치에 들어간다.

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §9(예외 5건, 숫자 14를 바꾸지 않는 규칙, 지키는 조항), §12(service-report 4곳, README 2종, 리디자인 스펙, 아트보드, 고치지 않는 것), §2.1 D3·D4, §7.6(색 표), §7.10(화면 구성), §7.12(문구 전문). service-report 머리말 수정(Step 4의 SR-0)은 §12 표에는 없지만, §12의 네 곳을 고치면 거짓이 되는 머리말 문장("1~8장은 세부과업 1 제출 시점의 내용을 그대로 유지했습니다")을 사실로 맞추는 동반 수정이다.

**이 태스크가 하지 않는 것:** `docs/contracts/stats-schema.md`, `docs/scan-guideline.md`, 라벨·타입은 Task 5에서, `analysis-result.tsx`·`deviation-view.tsx`는 Task 14에서 이미 고쳤다. 코드는 한 줄도 바꾸지 않는다. 다음 문서도 고치지 않는다(스펙 §12): `supabase/migrations/001_schema.sql`, `docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md`(viewer.bin·Three.js 서술은 당시 설계의 기록), `docs/audit/2026-09-05-*.md`, `docs/DEPLOY.md`, `docs/SUPABASE_SETUP.md`, `worker/README.md`.

**Files:**
- Create: `docs/design/cloudscape/ScanDone3D.dc.html`
- Modify: `docs/service-report.md:10-12`(머리말), `:123`(2.1절 화면 연계 행), `:482`(이 줄 앞에 새 소절 삽입), `:706`(6.5절 표), `:748`(6.7절 표)
- Modify: `dashboard/README.md:75-76`(5절 7번), `:105`(7절, 줄 삭제)
- Modify: `README.md:66`(Tasks 1 and 4 절 첫 문단 끝)
- Modify: `docs/superpowers/specs/2026-09-04-dashboard-cloudscape-redesign-design.md:8`(다음 줄에 삽입), `:19`(범위 줄), `:159`(문서 끝에 새 절)
- Test: 자동 테스트 없음(문서). 검증은 커밋하지 않는 일회용 스크립트 2개(`.superpowers/tmp/task15/check_task15.py`, `gen_scandone3d.py`. `.superpowers/`는 `.gitignore:1`로 추적되지 않는다)와 화면 캡처 대조, 스위트 재실행으로 한다.

줄 번호는 2026-10-02 `feat/pointcloud-viewer`(HEAD a9e51f5 기준, Task 1~14는 이 파일들을 건드리지 않는다) 값이다. `service-report.md`는 위에서부터 고치면 아래 번호가 밀리므로 **내용으로 위치를 잡는다**(아래 각 수정의 "기존" 글은 파일에 정확히 한 번 나온다).

**Interfaces:**
- Consumes:
  - T12의 화면 구성과 문구(스펙 §7.10, §7.12): 뷰어 영역(검정 `#000000`, 범례 4항목 `FLAT`/`DEPRESSION`/`PROTRUSION`/`편차 없음`, HUD `축 비율 1:1 · 임계값 ±7 mm · 118,342점`, 조작 안내 `드래그 회전 · Ctrl+휠 확대`), 컨트롤 줄(`시점` 등각·평면·정면 / `편차 과장` ×1·×10·×50·×100 / `임계값` 슬라이더 / `밝은 배경`), 고지 문구 전문
  - 기존 아트보드 `docs/design/cloudscape/ScanDone.dc.html`(409줄. 좌측 칸의 탭 줄 `:225-230`, 히트맵과 범례 `:231-284`, 3:2 그리드 `:222`, 판정 패널 시작 `:287`). 같은 화면 틀을 그대로 쓰고 좌측 칸만 바꾼다
  - 스펙 §9 표 5건, §12 표의 service-report·README·리디자인 스펙·아트보드 행, §7.6 색 표(dark), §2.4·§7.7의 카메라 상수(FOVY 40°, 등각 방위 −55°·고도 20°, `distance = radius / sin(FOVY / 2) × 1.05`)
  - T1~T14가 만든 것(문서가 사실로 적는 대상): `engine/flatness/core/pointsample.py`(`MAX_POINTS = 500_000`), `engine/flatness/outputs/points3d.py`(`FILE_NAME = "points3d.bin"`, 메타 `"method": "cell min-hash stratified"`), `pipeline.py`의 경고 `points3d_render_failed`·stats 키 `points3d_threshold_q`, `dashboard/lib/domain/points3d.ts`(`THRESHOLD_Q_MIN = 10`, `THRESHOLD_Q_MAX = 300`, `EXAGGERATIONS = [1, 10, 50, 100]`, `POINTS3D_THEME`), `dashboard/lib/viz/points3d/*.ts`, `dashboard/components/analysis/points3d-view.tsx`, `docs/contracts/stats-schema.md`의 `## 9. points3d.bin 형식 계약 (schema_version=1)`
- Produces:
  - `docs/design/cloudscape/ScanDone3D.dc.html`: `ScanDone`과 같은 화면에서 `3D 프리뷰` 탭 활성, 뷰어 영역(검정, 범례, HUD, 조작 안내, 점군·격자·축 숫자 그림), 컨트롤 줄, 고지 문구. 좌측 칸 밖은 `ScanDone.dc.html`과 글자 그대로 같다. T16의 화면 캡처 대조 기준이 된다
  - `docs/service-report.md`: 6.5절 표의 3D 점군 뷰어 행을 구현으로 고침(단면 도구는 범위 밖), 6.7절 6순위에서 '3D 뷰어' 제거, 4.5절과 4.6절 사이에 새 소절 `#### 4.5.1 3D 점군 1:1 뷰어 (2026-10-02 추가)`(합니다체), 2.1절 화면 연계 행에 3D 점군 뷰어 추가, 머리말에 갱신 기록
  - `dashboard/README.md`: 7절의 `Interactive 3D viewer (the engine does not yet output viewer.bin)` 줄 삭제, 5절 7번에 1:1 point cloud viewer 한 문장(영어)
  - `README.md`: Tasks 1 and 4 절에 interactive 1:1 point cloud viewer(pure WebGL2) 한 문장(영어). 그림 표는 그대로
  - 리디자인 스펙: 문서 끝에 새 절 `## 10. 예외 기록 (2026-10-02, 3D 점군 뷰어)`(§9의 5건 + 포인트클라우드 스펙을 가리킴), 머리말의 시각적 정본 설명에 '2026-10-02 추가 1장: `ScanDone3D.dc.html`(캔버스 밖에서 저장소에 추가, 3D 점군 뷰어)', 범위 줄에 새 절을 가리키는 주석. 숫자 14는 세 곳 모두 그대로

**문서 표현 규칙(이 태스크에서 쓰는 모든 글에 적용):** `docs/service-report.md`는 합니다체. "발주처"라는 말을 쓰지 않는다(저장소 규칙. 요청한 쪽을 가리켜야 하면 주어 없이 "요청에 따랐습니다"처럼 쓴다). 알고리즘·라이브러리 이름은 영어 그대로(cell min-hash stratified, WebGL2, Three.js). 새로 쓰는 줄에 U+2014(—)를 쓰지 않는다(README의 기존 줄에 있는 U+2014는 건드리지 않는다). 음수 부호는 U+2212(−). 아래 "변경 후" 글은 이 규칙을 지켜 쓴 것이니 **글자 그대로** 옮긴다.

**줄 끝 주의:** `README.md`와 `dashboard/README.md`는 작업 트리에서 CRLF다(`git ls-files --eol README.md dashboard/README.md` → `i/lf w/crlf`). Git Bash의 `grep`은 CR을 감춰서 LF처럼 보인다. Edit 도구로 고치면 줄 끝이 유지된다. sed·파이썬으로 직접 고쳤다면 Step 13의 `git diff --stat` 줄 수로 줄 끝이 통째로 바뀌지 않았는지 확인한다.

---

- [ ] **Step 1: 사전 확인(브랜치, 앞 태스크 산출물, 문서에 적을 사실)**

문서는 구현을 사실로 적는다. 적을 내용이 실제 코드와 맞는지 먼저 본다. 저장소 루트에서 실행한다.

```bash
cd D:/Projects/Flatness
git branch --show-current          # feat/pointcloud-viewer
git status --short                 # 출력 없음(깨끗한 작업 트리)
grep -n "MAX_POINTS = 500_000" engine/flatness/core/pointsample.py
grep -n 'FILE_NAME = "points3d.bin"' engine/flatness/outputs/points3d.py
grep -n "cell min-hash stratified" engine/flatness/outputs/points3d.py
grep -n "points3d_render_failed\|points3d_threshold_q" engine/flatness/core/pipeline.py
grep -n "THRESHOLD_Q_MIN = 10\|THRESHOLD_Q_MAX = 300\|EXAGGERATIONS = \[1, 10, 50, 100\]" dashboard/lib/domain/points3d.ts
grep -n "^## 9. points3d.bin 형식 계약" docs/contracts/stats-schema.md
ls dashboard/lib/viz/points3d/*.ts dashboard/components/analysis/points3d-view.tsx dashboard/components/analysis/preview3d-tab.tsx
grep -n -i '"three"\|plotly\|deck\.gl\|"regl"' dashboard/package.json   # 출력 없음(3D·차트 라이브러리 미도입)
git ls-files --eol README.md dashboard/README.md docs/service-report.md
```

Expected: 각 `grep`이 한 줄 이상을 낸다(`pipeline.py`는 두 이름 모두, `points3d.ts`는 세 상수 모두). `ls`가 `lib/viz/points3d` 아래 `.ts` 7개(`mat4`, `orbit`, `scaffold`, `budget`, `pick`, `controls`, `gl-renderer`)와 컴포넌트 2개를 낸다. `package.json` grep은 출력이 없다. 하나라도 어긋나면 문서를 쓰지 말고 멈춘다: 어긋난 사실(예: 상한이 50만이 아님)을 그대로 보고한다. 아래 "변경 후" 글은 스펙의 값을 적은 것이므로, 코드가 스펙과 다르면 문서가 아니라 코드가 틀린 것이다.

- [ ] **Step 2: 검증 스크립트 작성(커밋하지 않는 일회용 도구)**

`.superpowers/tmp/task15/check_task15.py`를 만든다(폴더가 없으면 만든다. UTF-8, LF). 문서 태스크의 "실패하는 테스트" 역할이다. 고친 문서와 아트보드를 **스펙 파일과 HEAD의 원본에서 읽은 값**에 대조한다(고지 문구와 색은 이 스크립트에 손으로 옮겨 적지 않고 스펙 §7.12·§7.6 표에서 읽는다).

```python
"""Task 15 문서·아트보드 검증 (일회용 도구. 커밋하지 않는다).

저장소 루트에서 실행한다. 고친 문서 4종과 새 아트보드를 설계 스펙과 HEAD 의 원본에 대조한다.
- 넣어야 할 내용이 들어갔는가
- 고치면 안 되는 줄(리디자인 스펙 머리말의 숫자 14, README 그림 표, 그 밖의 모든 기존 줄)이 그대로인가
- 새로 쓴 줄에 U+2014 와 금지 표현이 없는가
- 아트보드의 문구·색이 설계 스펙 7.12 / 7.6 과 글자 그대로 같은가

사용: <py> check_task15.py [--root 고친 파일이 있는 루트(기본 .)] [--base 비교 기준 커밋(기본 HEAD)]
"""
import argparse
import difflib
import re
import subprocess
import sys
from pathlib import Path

SR = "docs/service-report.md"
DR = "dashboard/README.md"
RM = "README.md"
RD = "docs/superpowers/specs/2026-09-04-dashboard-cloudscape-redesign-design.md"
SPEC = "docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md"
AB_SRC = "docs/design/cloudscape/ScanDone.dc.html"
AB = "docs/design/cloudscape/ScanDone3D.dc.html"

EM_DASH = chr(0x2014)    # 이 파일에 그 글자를 직접 적지 않는다
BANNED = "발주" + "처"   # 금지 표현. 이 파일 자체가 검색에 걸리지 않게 나눠 적는다

ROOT = Path(".")
BASE = "HEAD"
RESULTS = []


def cur(path):
    p = ROOT / path
    return p.read_bytes().decode("utf-8").replace("\r\n", "\n") if p.exists() else None


def base(path):
    out = subprocess.run(["git", "show", "%s:%s" % (BASE, path)], capture_output=True, check=True)
    return out.stdout.decode("utf-8").replace("\r\n", "\n")


def diff_lines(old, new):
    """(지워지거나 바뀐 기존 줄 목록, 새로 생긴 줄 목록)"""
    a, b = old.split("\n"), new.split("\n")
    removed, added = [], []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag != "equal":
            removed += a[i1:i2]
            added += b[j1:j2]
    return removed, added


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))


def only_allowed_removed(name, path, allowed_prefixes):
    """기존 줄 가운데 allowed_prefixes 로 시작하는 줄만 바뀌었는가."""
    text = cur(path)
    if text is None:
        check(name, False, "파일 없음")
        return [], []
    removed, added = diff_lines(base(path), text)
    bad = [ln for ln in removed if not any(ln.startswith(p) for p in allowed_prefixes)]
    check(name, not bad, "고치면 안 되는 줄이 바뀜: %r" % bad[:3])
    return removed, added


def no_banned(name, lines):
    hits = [ln for ln in lines if EM_DASH in ln or BANNED in ln]
    check(name, not hits, "U+2014 또는 금지 표현: %r" % [h[:60] for h in hits[:3]])


def section(text, start_pat, end_pat):
    """start_pat 줄부터 end_pat 줄 앞까지. 못 찾으면 빈 문자열."""
    m = re.search(start_pat, text, re.M)
    if not m:
        return ""
    e = re.search(end_pat, text[m.end():], re.M)
    return text[m.start(): m.end() + e.start()] if e else text[m.start():]


def row(text, prefix):
    for ln in text.split("\n"):
        if ln.startswith(prefix):
            return ln
    return ""


# ---------------------------------------------------------------- service-report.md
def check_service_report():
    text = cur(SR) or ""
    removed, added = only_allowed_removed("SR-preserve 기존 줄 보존(고친 5곳 외)", SR, (
        "  내용을 그대로 유지했습니다** (예외: 7.2절",
        "  2026-08-09 (10장 세부과업 2 편입)",
        "| 〃 (화면 연계) |",
        "| 인터랙티브 3D 점군 뷰어 |",
        "| 6 | E2E 자동화",
    ))
    no_banned("SR-banned 새 줄에 U+2014·금지 표현 없음", added)

    head = "\n".join(text.split("\n")[:18])
    check("SR-header 머리말에 2026-10-02 갱신 기록", "2026-10-02 (3D 점군 1:1 뷰어 반영)" in head
          and "4.5.1절(신설)" in head)

    r = row(text, "| 〃 (화면 연계) |")
    check("SR-2.1 화면 연계 행에 3D 점군 뷰어", "3D 점군 뷰어" in r and "히트맵 셀 클릭" in r and r.endswith("| **완료** |"))

    heads = re.findall(r"^#### 4\.5\.1 3D 점군 1:1 뷰어.*$", text, re.M)
    sub = section(text, r"^#### 4\.5\.1 3D 점군 1:1 뷰어", r"^### 4\.6 대시보드 사용성 개선")
    before = section(text, r"^### 4\.5 정밀 편차맵", r"^#### 4\.5\.1 3D 점군 1:1 뷰어")
    check("SR-4.5.1 새 소절이 4.5 와 4.6 사이에 한 번", len(heads) == 1 and sub != "" and before != ""
          and "### 4.6" not in before)
    need = ["cell min-hash stratified", "5cm 서브셀", "points3d.bin", "판정 무관성", "points3d_render_failed",
            "points3d_threshold_q", "#000000", "슬라이더", "Three.js", "WebGL2", "밝은 배경", "확인하지 못한 것",
            "합니다"]
    missing = [k for k in need if k not in sub]
    check("SR-4.5.1-content 표본 방식·색 기준·판정 무관성·방침 예외 4건", not missing, "빠진 내용: %r" % missing)
    table_rows = [ln for ln in sub.split("\n") if ln.startswith("| ") and not ln.startswith("|---")]
    check("SR-4.5.1-table 방침 예외 표 = 머리 1줄 + 4행", len(table_rows) == 5, "행 수 %d" % len(table_rows))

    r = row(text, "| 인터랙티브 3D 점군 뷰어 |")
    check("SR-6.5 3D 뷰어 행이 구현으로", r != "" and "**미구현.**" not in r and "points3d.bin" in r and "WebGL2" in r
          and "단면" in r and "범위 밖" in r and "4.5.1절" in r)

    r = row(text, "| 6 | E2E 자동화")
    check("SR-6.7 6순위에서 3D 뷰어 제거", r != "" and "3D 뷰어" not in r and "수평도 지표" in r and "전처리" in r)


# ---------------------------------------------------------------- dashboard/README.md
def check_dashboard_readme():
    text = cur(DR) or ""
    removed, added = only_allowed_removed("DR-preserve 기존 줄 보존(고친 2곳 외)", DR, (
        "   assessment panel · results table), and click a heatmap cell",
        "- Interactive 3D viewer (the engine does not yet output",
    ))
    no_banned("DR-banned 새 줄에 U+2014 없음", added)
    check("DR-viewer.bin 줄 삭제", "viewer.bin" not in text)
    step7 = section(text, r"^7\. \*\*Results screen\*\*", r"^8\. ")
    check("DR-step7 결과 화면 설명에 1:1 point cloud viewer", "1:1 point cloud viewer" in step7 and "3D preview" in step7)


# ---------------------------------------------------------------- README.md
def check_readme():
    text = cur(RM) or ""
    removed, added = only_allowed_removed("RM-preserve 기존 줄 보존(고친 1곳 외)", RM, (
        "[report](docs/service-report.md)).",
    ))
    no_banned("RM-banned 새 줄에 U+2014 없음", added)
    sec = section(text, r"^### Tasks 1 and 4 ", r"^---$")
    check("RM-viewer Tasks 1 and 4 절에 뷰어 문장", "interactive 1:1 point cloud viewer" in sec and "pure WebGL2" in sec)
    table = "| ![Heatmap](docs/images/task1_heatmap.png) | ![3D](docs/images/task1_preview3d.png) | ![Deviation map](docs/images/task1_deviation.png) |"
    check("RM-table 그림 표 그대로", table in sec and "| Assessment heatmap (2m cells) | 3D preview | 10cm high-resolution deviation map |" in sec)


# ---------------------------------------------------------------- 리디자인 스펙
def check_redesign_spec():
    text = cur(RD) or ""
    b = base(RD)
    removed, added = only_allowed_removed("RD-preserve 기존 줄 보존(범위 줄 외)", RD, (
        "**범위**: `dashboard/`의 토큰",
    ))
    no_banned("RD-banned 새 줄에 U+2014·금지 표현 없음", added)
    tl, bl = text.split("\n"), b.split("\n")
    check("RD-14 머리말 1~8줄(숫자 14 포함) 그대로", tl[:8] == bl[:8] and "14개 화면" in tl[3] and "14장" in tl[5])
    check("RD-artboard-note 시각적 정본 설명에 추가 1장", len(tl) > 8 and
          "2026-10-02 추가 1장: `ScanDone3D.dc.html`(캔버스 밖에서 저장소에 추가, 3D 점군 뷰어)" in tl[8])
    r = row(text, "**범위**: `dashboard/`의 토큰")
    check("RD-scope 범위 줄: 원문 유지 + 주석", "아트보드 14장이 전부다." in r and "§10" in r and "2026-10-02" in r)
    heads = re.findall(r"^## 10\. 예외 기록 \(2026-10-02, 3D 점군 뷰어\)$", text, re.M)
    sec = section(text, r"^## 10\. 예외 기록 \(2026-10-02, 3D 점군 뷰어\)$", r"^## 11\. ")
    check("RD-section 새 절이 문서 끝에 한 번", len(heads) == 1 and text.index("## 10. 예외 기록") > text.index("## 9. 검증"))
    rows = [ln for ln in sec.split("\n") if re.match(r"^\| [1-5] \|", ln)]
    need = ["2026-10-02-pointcloud-viewer-design.md", "#000000", "POINTS3D_THEME", "임계값 슬라이더", "stats 키 2개",
            "ScanDone3D.dc.html", "차트 라이브러리 추가 없음"]
    missing = [k for k in need if k not in sec]
    check("RD-section-content 예외 5건 + 지키는 조항", len(rows) == 5 and not missing,
          "행 수 %d, 빠진 내용 %r" % (len(rows), missing))


# ---------------------------------------------------------------- 아트보드
def spec_notice(spec):
    r = row(spec, "| 고지 | 뷰어 아래 | ")
    return r.split(" | ")[2].rstrip(" |").replace("{T}", "7") if r else ""


def spec_dark_hex(spec, name):
    r = row(section(spec, r"^### 7\.6 색 표", r"^### 7\.7 "), "| %s | " % name)
    m = re.search(r"`(#[0-9a-f]{6})`", r)
    return m.group(1) if m else "(스펙에서 못 찾음: %s)" % name


def check_artboard():
    art = cur(AB)
    if art is None:
        check("AB-exists ScanDone3D.dc.html 존재", False, "파일 없음")
        return
    check("AB-exists ScanDone3D.dc.html 존재", True)
    src = cur(AB_SRC)
    spec = cur(SPEC) or ""
    tab_open = '              <div style="display: flex; gap: 24px; border-bottom: 1px solid #e9ebed;">\n'
    panel_open = '            <div style="display: flex; flex-direction: column; gap: 16px; padding: 20px; border: 1px solid #e9ebed;'
    i, j = src.index(tab_open), src.index(panel_open)
    ai = art.find(tab_open)
    aj = art.find(panel_open)
    check("AB-frame 좌측 칸 밖은 ScanDone.dc.html 과 글자 그대로", ai == i and art[:ai] == src[:i] and art[aj:] == src[j:])
    block = art[ai:aj]
    no_banned("AB-banned 아트보드에 U+2014·금지 표현 없음", art.split("\n"))

    tabs = re.findall(r'<span style="padding: 0 0 8px; border-bottom: 4px solid ([^;]+); color: [^;]+; font-weight: 700;">([^<]+)</span>', block)
    check("AB-tabs 탭 순서 그대로 + 3D 프리뷰만 활성", tabs == [("transparent", "히트맵"), ("transparent", "정밀 편차맵"),
                                                    ("#0972d3", "3D 프리뷰"), ("transparent", "현장 사진")], repr(tabs))

    notice = spec_notice(spec)
    check("AB-notice 고지 문구 = 스펙 7.12 (T = 7)", notice != "" and (">%s</p>" % notice) in block,
          "스펙 문구 %r" % notice[:40])
    texts = ["축 비율 1:1 · 임계값 ±7 mm · 118,342점", "드래그 회전 · Ctrl+휠 확대",
             ">시점</span>", ">편차 과장</span>", ">임계값</span>",
             ">등각</button>", ">평면</button>", ">정면</button>",
             ">×1</button>", ">×10</button>", ">×50</button>", ">×100</button>", ">밝은 배경</button>",
             ">x (m)</text>", ">y (m)</text>", ">±7 mm</span>"]
    missing = [t for t in texts if t not in block]
    check("AB-texts HUD·조작 안내·묶음 이름·버튼·축 이름", not missing, "빠진 문구: %r" % missing)
    legend = re.findall(r'border-radius: 50%; background: (#[0-9a-f]{6});"></span>([^<]+)</span>', block)
    want = [(spec_dark_hex(spec, "FLAT"), "FLAT"), (spec_dark_hex(spec, "DEPRESSION"), "DEPRESSION"),
            (spec_dark_hex(spec, "PROTRUSION"), "PROTRUSION"), (spec_dark_hex(spec, "편차 없음"), "편차 없음")]
    check("AB-legend 범례 4항목(순서·색 = 스펙 7.6)", legend == want, "%r != %r" % (legend, want))

    bg = spec_dark_hex(spec, "배경")
    check("AB-viewport 뷰어 영역: 4:3, 배경 = 스펙 배경색", ("aspect-ratio: 4 / 3; overflow: hidden; border: 1px solid #e9ebed; "
          "border-radius: 8px; background: %s;" % bg) in block and bg == "#000000")
    strokes = re.findall(r'stroke="(#[0-9a-f]{6})" stroke-width="1\.5" stroke-linecap="round"', block)
    allowed = {spec_dark_hex(spec, n) for n in ("FLAT", "DEPRESSION", "PROTRUSION", "편차 없음")}
    check("AB-points 점 색이 스펙 색 표 안 + 초록·노랑 포함", set(strokes) <= allowed and
          {spec_dark_hex(spec, "FLAT"), spec_dark_hex(spec, "DEPRESSION")} <= set(strokes), repr(strokes))
    n_dots = block.count("h0")
    check("AB-dots 점 3,000개 이상", n_dots >= 3000, "점 %d개" % n_dots)
    check("AB-lines 격자 0.09 / 축선 0.28 (흰색)", 'stroke="#ffffff" stroke-opacity="0.09"' in block
          and 'stroke="#ffffff" stroke-opacity="0.28"' in block)
    check("AB-text-colors 글자·보조 글자 색", ("color: %s;" % spec_dark_hex(spec, "글자")) in block
          and ('fill="%s"' % spec_dark_hex(spec, "보조 글자")) in block
          and ("color: %s;" % spec_dark_hex(spec, "보조 글자")) in block)
    check("AB-slider 슬라이더 10~300, 5 단계, 값 70", 'type="range" min="10" max="300" step="5" value="70" aria-label="표시 임계값(mm)"' in block)
    pressed = re.findall(r'aria-pressed="(true|false)" style="[^"]*background: ([^;]+);[^"]*">([^<]+)</button>', block)
    check("AB-pressed ×1 만 선택 배경(#f2f8fd)", pressed == [("true", "#f2f8fd", "×1"), ("false", "transparent", "×10"),
          ("false", "transparent", "×50"), ("false", "transparent", "×100"), ("false", "transparent", "밝은 배경")], repr(pressed))
    check("AB-no-primary 좌측 칸에 채움 버튼 없음", "background: #0972d3; color: #ffffff" not in block)
    # 고지 문구를 뺀 나머지에 등급 단어와 비율 숫자가 없어야 한다(스펙 8: 등급 단어·분류 비율을 화면에 만들지 않는다)
    rest = re.sub(r'style="[^"]*"', "", block.replace(notice, ""))
    words = [w for w in ("적합", "경계", "보수", "재시공", "%") if w in rest]
    check("AB-no-grade-words 좌측 칸에 등급 단어·비율 숫자 없음", not words, repr(words))


def main():
    global ROOT, BASE
    sys.stdout.reconfigure(encoding="utf-8")   # Windows 콘솔 기본 인코딩(cp949)으로 한글이 깨지지 않게 한다
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--base", default="HEAD")
    args = ap.parse_args()
    ROOT, BASE = Path(args.root), args.base
    check_service_report()
    check_dashboard_readme()
    check_readme()
    check_redesign_spec()
    check_artboard()
    failed = 0
    for name, ok, detail in RESULTS:
        if ok:
            print("PASS  " + name)
        else:
            failed += 1
            print("FAIL  " + name + ("  <- " + detail if detail else ""))
    print("%d passed, %d failed" % (len(RESULTS) - failed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
```

검사와 그 검사가 죽이는 변이(계획 작성 때 변이를 하나씩 넣어 전부 죽는 것을 확인했다):

| 검사 | 죽이는 변이 |
|---|---|
| `SR-preserve`, `DR-preserve`, `RM-preserve`, `RD-preserve` | 고치기로 한 줄 밖의 기존 줄을 건드림(무관한 표 행 수정, README 그림 표 변경, 리디자인 스펙 머리말 수정) |
| `SR-banned`, `DR-banned`, `RM-banned`, `RD-banned`, `AB-banned` | 새로 쓴 줄에 U+2014 또는 금지 표현 |
| `SR-header` | 머리말의 "1~8장은 그대로 유지" 문장에 이번 갱신 기록을 빠뜨림 |
| `SR-2.1` | 2.1절 화면 연계 행에 3D 점군 뷰어를 빠뜨림 |
| `SR-4.5.1`, `SR-4.5.1-content`, `SR-4.5.1-table` | 새 소절을 4.6절 뒤에 넣음, 표본 방식·색 기준·판정 무관성·Three.js 사유 가운데 하나를 빠뜨림, 방침 예외 표가 4행이 아님 |
| `SR-6.5` | 6.5절 행이 여전히 "미구현", 단면 도구가 범위 밖이라는 말을 빠뜨림 |
| `SR-6.7` | 6순위에 '3D 뷰어'가 남음 |
| `DR-viewer.bin`, `DR-step7` | `viewer.bin` 줄이 남음, 결과 화면 설명에 뷰어 문장이 없음 |
| `RM-viewer`, `RM-table` | README에 뷰어 문장이 없음, 그림 표를 건드림 |
| `RD-14` | 머리말 4번째 줄 "14개 화면"이나 6번째 줄 "14장"을 15로 바꿈 |
| `RD-artboard-note`, `RD-scope` | 추가 1장 문구가 스펙과 다름, 범위 줄의 "아트보드 14장이 전부다."를 고쳐 씀 |
| `RD-section`, `RD-section-content` | 새 절이 없음, 예외가 5건이 아님, 지키는 조항(차트 라이브러리 추가 없음)을 빠뜨림 |
| `AB-frame` | 좌측 칸 밖(판정 패널의 숫자 등)을 건드림 |
| `AB-tabs` | 활성 탭이 `3D 프리뷰`가 아님, 탭 순서를 바꿈 |
| `AB-notice` | 고지 문구가 스펙 §7.12와 한 글자라도 다름(음수 부호를 ASCII `-`로 쓴 경우 포함) |
| `AB-texts` | HUD의 가운뎃점을 쉼표로 바꿈, 버튼·묶음 이름·축 이름 누락 |
| `AB-legend`, `AB-points`, `AB-viewport`, `AB-lines`, `AB-text-colors` | 범례 색·순서, 점 색, 배경색(`#000000`이 아님), 격자·축선 알파, 글자색이 스펙 §7.6과 다름 |
| `AB-slider`, `AB-pressed`, `AB-no-primary` | 슬라이더 범위가 10~300·5단계가 아님, ×1 이외의 버튼이 선택 배경, 채움(primary) 버튼 사용 |
| `AB-no-grade-words` | 뷰어 쪽에 등급 단어나 분류 비율 숫자(예: `FLAT 96.3%`)를 넣음(스펙 §8) |

- [ ] **Step 3: 실패 확인**

```bash
cd D:/Projects/Flatness
D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe .superpowers/tmp/task15/check_task15.py
```

Expected: 종료 코드 1, 마지막 줄 `10 passed, 15 failed`. 통과하는 10건은 "보존" 계열(`*-preserve` 4건, `*-banned` 4건, `RM-table`, `RD-14`)이다. 아직 아무것도 고치지 않았으니 당연히 통과한다. 실패하는 15건은 `SR-header`, `SR-2.1`, `SR-4.5.1`, `SR-4.5.1-content`, `SR-4.5.1-table`, `SR-6.5`, `SR-6.7`, `DR-viewer.bin`, `DR-step7`, `RM-viewer`, `RD-artboard-note`, `RD-scope`, `RD-section`, `RD-section-content`, `AB-exists`다. 숫자가 다르면 문서가 이미 고쳐졌거나 스펙이 바뀐 것이니 `git status`와 `git log -3 -- docs/service-report.md README.md dashboard/README.md`로 확인한다.

- [ ] **Step 4: `docs/service-report.md` 수정 5곳**

Edit 도구로 "기존"을 "변경 후"로 바꾼다. 위에서부터 차례로 한다.

**(SR-0) 머리말: 문서 구성·작성일에 갱신 기록** (현재 `:10-12`). 스펙 §12 표에는 없는 줄이지만 고친다: 머리말이 "1~8장은 세부과업 1 제출 시점의 내용을 그대로 유지했습니다"라고 적고 있어, 아래 네 곳을 고치면 이 문장이 사실이 아니게 된다. 이 문서는 예외를 괄호로 적는 방식을 이미 쓰고 있다(7.2절 첫 문단).

기존:
```text
  내용을 그대로 유지했습니다** (예외: 7.2절 첫 문단은 10장 신설에 맞춰 연결을 고쳤습니다)
- 작성일: 2026-08-04 (1~8장 수치 갱신) / 2026-08-08 (9장 세부과업 4 편입) /
  2026-08-09 (10장 세부과업 2 편입) / **2026-08-10 (11장 세부과업 3 편입)**
```
변경 후:
```text
  내용을 그대로 유지했습니다** (예외: 7.2절 첫 문단은 10장 신설에 맞춰 연결을 고쳤습니다.
  2026-10-02에는 3D 점군 1:1 뷰어 구현을 반영해 2.1절의 화면 연계 행, 4.5.1절(신설),
  6.5절 표의 3D 점군 뷰어 행, 6.7절 표의 6순위를 고쳤습니다)
- 작성일: 2026-08-04 (1~8장 수치 갱신) / 2026-08-08 (9장 세부과업 4 편입) /
  2026-08-09 (10장 세부과업 2 편입) / **2026-08-10 (11장 세부과업 3 편입)** /
  2026-10-02 (3D 점군 1:1 뷰어 반영)
```

**(SR-1) 2.1절 표의 화면 연계 행** (현재 `:123`). 시각자료 행(`:122`)은 그대로 둔다.

기존:
```text
| 〃 (화면 연계) | 결과 화면에서 히트맵 셀 클릭 시 해당 셀 상세(편차·등급·좌표) 표시, 히트맵·3D 프리뷰·편차맵·현장 사진 탭 | `dashboard/components/analysis/*.tsx` | **완료** |
```
변경 후:
```text
| 〃 (화면 연계) | 결과 화면에서 히트맵 셀 클릭 시 해당 셀 상세(편차·등급·좌표) 표시, 히트맵·3D 프리뷰·편차맵·현장 사진 탭. 바닥 분석의 3D 프리뷰 탭은 실제 스캔 점 표본을 축 비율 1:1로 보여 주는 3D 점군 뷰어입니다(회전·줌, 4.5.1절) | `dashboard/components/analysis/*.tsx`, `dashboard/lib/viz/points3d/*.ts`, `engine/flatness/outputs/points3d.py` | **완료** |
```

**(SR-2) 새 소절 `4.5.1`** (현재 `:482`의 `### 4.6` 제목 바로 앞, 4.5절 본문 다음). 새 절을 `### 4.6`으로 넣고 기존 4.6을 4.7로 미는 대신 `#### 4.5.1`(4.5절의 소절)로 두는 이유: 1~8장은 제출 시점 내용을 유지하는 장이라 기존 절 번호와 제목을 바꾸지 않는다. 뷰어의 색 기준이 4.5절 정밀 편차맵과 같은 잔차이므로 4.5절 아래 소절로 두는 것이 내용상으로도 맞다. 아래 "변경 후"는 새 소절 전체 + 원래의 `### 4.6` 제목 줄이다(소절 끝의 빈 줄 포함).

기존:
```text
### 4.6 대시보드 사용성 개선 (최종 갱신분)
```
변경 후:
```text
#### 4.5.1 3D 점군 1:1 뷰어 (2026-10-02 추가)

바닥 평활도 분석 결과 화면의 `3D 프리뷰` 탭에, **실제 스캔 점 표본을 실제 좌표·축 비율 1:1로**
보여 주는 3D 뷰어를 넣었습니다. 드래그로 회전하고 Ctrl+휠로 확대합니다. 기존 3D 프리뷰 PNG는
높이 축이 편차(mm)라 실제 축 비율이 아니고, 점도 원본 점이 아니라 5cm 서브셀 중심입니다.
1:1에서는 수 m 바닥 위의 수 mm 편차가 형상으로 보이지 않으므로 정보는 **점 색**이 전달하고,
편차 과장 배율(×1·×10·×50·×100)은 보조 수단입니다. 과장은 실제 높이가 아니라 편차만 키웁니다.
설계 문서는 `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md`, 파일 형식 계약은
[`contracts/stats-schema.md`](contracts/stats-schema.md) §9입니다.

**표본 방식 (cell min-hash stratified)** - 엔진이 판정을 끝낸 뒤 파일을 한 번 더 스트리밍하며 점
표본을 뽑아 `points3d.bin`으로 냅니다`[구현: engine/flatness/core/pointsample.py,
engine/flatness/outputs/points3d.py]`. 바닥을 작은 표본 칸으로 나누고 칸마다 좌표 해시가 가장 작은
점 하나를 남깁니다. 난수와 시드를 쓰지 않으므로 같은 파일이면 청크 크기와 점 순서에 관계없이
출력이 바이트 단위로 같습니다. 표본 칸의 크기는 bbox가 아니라 **점이 든 서브셀의 면적**에서
정하므로 잡점 몇 개로 bbox가 커져도 표본이 무너지지 않습니다. 같은 칸에서는 편차를 가진 바닥 점이
벽·가구 점보다 항상 먼저 뽑힙니다. 점 수 상한은 50만 점입니다(점당 8바이트, 약 4MB).

**색 기준 (5cm 서브셀 잔차)** - 점의 색은 점 자체의 높이가 아니라 **그 점이 속한 5cm 서브셀의
잔차**로 정합니다. 4.5절의 정밀 편차맵과 같은 값입니다. 표시 임계값을 T라 할 때 ±T 이내는
FLAT(초록), −T 미만은 DEPRESSION(노랑), +T 초과는 PROTRUSION(빨강)입니다. 바닥에서 5cm 넘게
떨어진 점(벽·가구)과 판정 제외 구역의 점은 편차 없음(어두운 회색)으로 함께 그립니다. 점 위에
커서를 올리면 절대 좌표와 편차(mm)를 읽을 수 있습니다.

**판정 무관성** - 4.5절의 편차맵과 같은 제약입니다. 점 표본과 뷰어는 판정 파이프라인에 어떤
입력도 주지 않고 어떤 출력도 바꾸지 않습니다. 점 파일 생성이 실패해도 등급·수치와 다른 산출물은
실패가 없을 때와 같고 경고 `points3d_render_failed`만 남습니다. 표시 임계값의 기본값은 엔진이
stats에 따로 적어 준 표시용 값(`points3d_threshold_q`, 적용 기준의 허용치)이며 브라우저는 판정
기준 필드를 읽지 않습니다. 점 색(구역 기준 평면 대비 부호 있는 편차)과 판정 등급(직선자 최대
틈새)은 측정량이 달라 서로 어긋날 수 있습니다. 초록 점이 대부분인 칸이 경계·보수일 수 있고,
노랑·빨강 점이 많은 칸이 적합일 수 있습니다. 뷰어 아래에 이 사실과 "임계값을 바꿔도 판정과
보고서는 달라지지 않습니다"라는 문구를 항상 표시합니다. 보고서 PDF는 기존 3D 프리뷰 PNG를
그대로 씁니다.

**적용 범위** - 바닥 평활도 분석에만 해당합니다. 벽면·구배·임포트 분석에는 점 파일을 만들지
않으며, 3D 프리뷰 탭이 있는 벽면·임포트 결과 화면에는 그 사실을 안내 문구로 적습니다. WebGL2를
쓸 수 없거나 점 파일을 받지 못하면 사유를 화면에 밝히고 기존 3D 프리뷰 PNG를 보여 줍니다.

**기존 방침에서 벗어난 점과 그 사유**

| 기존 방침 | 이번 구현 | 사유 |
|---|---|---|
| 대시보드는 밝은 테마만 씁니다(다크 모드 없음) | **뷰어 영역에 한해** 배경이 순수 검정(`#000000`)입니다. 대시보드의 나머지는 밝은 테마 그대로이고, 화면 캡처용 밝은 배경 전환 버튼을 함께 둡니다 | 참고 화면(어두운 배경의 3D 산점도)과 같은 모습으로 보이게 해 달라는 요청에 따랐습니다 |
| 화면의 색은 디자인 토큰 표 안에서만 씁니다 | 점 3색, 편차 없음 색, 뷰어 안의 글자·격자 색을 **그림의 색**으로 따로 둡니다. 판정 히트맵 5색과 같은 종류의 예외입니다 | 참고 화면의 색 표현(FLAT 초록 / DEPRESSION 노랑 / PROTRUSION 빨강)을 따랐습니다. 뷰어의 초록은 "FLAT"이고 히트맵의 초록은 "적합"이라 뜻이 다르므로 범례와 고지 문구로 구분합니다 |
| 임의 임계값 슬라이더를 두지 않습니다(1.1절이 기존 노트북의 9mm 슬라이더를 문제로 들었습니다) | 표시 임계값 슬라이더(1~30mm)를 둡니다 | 기존 노트북의 슬라이더와 네 가지가 다릅니다. 기본값이 임의 숫자가 아니라 적용 기준의 허용치에서 옵니다. 등급을 만들지 않고 점 색만 바꿉니다. 현재 값을 화면에 항상 표시합니다. 값을 바꿔도 판정과 보고서가 달라지지 않는다는 사실을 화면에 밝힙니다 |
| 설계 정본 §7의 3D 뷰어는 Three.js 점군 렌더였고 엔진 산출물 이름은 `viewer.bin`이었습니다 | 라이브러리 없이 **순수 WebGL2로 직접 구현**했고 산출물은 `points3d.bin`입니다`[구현: dashboard/lib/viz/points3d/, dashboard/components/analysis/points3d-view.tsx]` | 그리는 대상이 점과 격자선 두 종류뿐이라 라이브러리가 덜어 주는 것이 행렬·궤도 카메라·입력 처리 정도입니다. 조사 단계에서 잰 값으로 Three.js(0.186.1, 필요한 모듈만 묶은 경우)는 gzip 약 140kB, 직접 구현한 시제품은 약 3.5kB였고, 150만 점 프레임 비용은 두 방식이 같은 수준이었습니다(외장 GPU 기준). 대시보드에 3D·차트 라이브러리를 추가하지 않는 기존 방침도 그대로 지킵니다. 행렬·카메라·입력 처리는 순수 함수로 나눠 단위 테스트를 걸었습니다 |

**확인하지 못한 것** - 내장 그래픽 노트북에서의 성능은 측정하지 못했습니다(측정 장비에 내장 GPU가
없었습니다). 운영 저장소의 서명 URL을 거친 `points3d.bin` 내려받기는 배포 뒤에만 확인할 수
있습니다. 색 분포와 임계값 관련 수치는 전부 합성 점군 기준입니다. 설계 정본이 3D 뷰어에 함께
적었던 단면 도구와 실색상(RGB) 표시는 이번 범위 밖입니다(6.5절).

### 4.6 대시보드 사용성 개선 (최종 갱신분)
```

이 소절에 적은 수치의 출처(리뷰어 확인용): 50만 점·점당 8바이트·약 4MB는 스펙 §2.1 D11·§5.1, 1~30mm는 §2.1 D5, 5cm는 §4.3(`OFF_SURFACE_M = 0.05`), 미실측 항목은 §14의 1·2·5번. Three.js gzip 약 140kB(139,498B, three 0.186.1에서 `WebGLRenderer`·`Points`·`OrbitControls` 등 필요한 모듈만 묶은 값)와 시제품 약 3.5kB(3,471B), 150만 점 프레임 비용 동등(순수 2.8~5.3ms, three 2.5~5.8ms, RTX 2060 SUPER)은 조사 기록 `.superpowers/research/3d-pointcloud-viewer/design-inputs-summary.txt:85-86, 109, 116, 156`의 실측값이다(추적되지 않는 로컬 파일. 다른 체크아웃에는 없다).

**(SR-3) 6.5절 표의 3D 점군 뷰어 행** (현재 `:706`). 표 머리 문장("설계 정본에 있으나 현재 구현되지 않은 항목")은 그대로 둔다: 단면 도구와 실색상은 여전히 구현되지 않았고, 같은 표의 "법선 기반 면 분할" 행도 "대체 구현"으로 남아 있는 선례다.

기존:
```text
| 인터랙티브 3D 점군 뷰어 | §7: Three.js 점군 렌더(회전·줌·단면) | **미구현.** 엔진이 `viewer.bin`을 산출하지 않습니다. 정적 3D 프리뷰 PNG로 대체 |
```
변경 후:
```text
| 인터랙티브 3D 점군 뷰어 | §7: Three.js 점군 렌더(회전·줌·단면) | **구현(2026-10-02, 단면 도구 제외).** 엔진이 점 표본 산출물 `points3d.bin`을 만들고 대시보드가 순수 WebGL2로 직접 그립니다(회전·줌, 축 비율 1:1, 3분류 색). 바닥 평활도 분석에만 해당합니다. 설계 정본의 `viewer.bin`·Three.js와 방식이 다른 이유는 4.5.1절에 적었습니다. **단면 도구와 실색상(RGB) 표시는 범위 밖**으로 남습니다 |
```

**(SR-4) 6.7절 표의 6순위** (현재 `:748`).

기존:
```text
| 6 | E2E 자동화 + 3D 뷰어·수평도 지표·전처리 구현 | 6.5절. 기능 완결성 |
```
변경 후:
```text
| 6 | E2E 자동화 + 수평도 지표·전처리 구현 | 6.5절. 기능 완결성 |
```

- [ ] **Step 5: `dashboard/README.md` 수정 2곳(영어, CRLF 파일)**

**(DR-1) 5절 7번에 한 문장** (현재 `:75-76`). 이 README는 화면 문구를 영어로 옮겨 적는다(`"New site"`, `"Reports"`). 탭 이름 `3D 프리뷰`도 `"3D preview"`로 적는다.

기존:
```text
7. **Results screen** - after the analysis completes, check the results screen (split into 3 panes: heatmap canvas ·
   assessment panel · results table), and click a heatmap cell to check that its details appear.
```
변경 후:
```text
7. **Results screen** - after the analysis completes, check the results screen (split into 3 panes: heatmap canvas ·
   assessment panel · results table), and click a heatmap cell to check that its details appear. For a floor
   analysis, the "3D preview" tab shows an interactive 1:1 point cloud viewer: a sample of the actual scan points
   at true scale, colored by deviation (drag to rotate, Ctrl+wheel to zoom).
```

**(DR-2) 7절에서 3D 뷰어 줄 삭제** (현재 `:105`). 앞뒤 줄은 위치를 잡기 위한 문맥이다. 가운데 한 줄만 없앤다.

기존:
```text
- Reports include only the photos attached to the scans of the included analyses (a photo uploader at the measurement-location level is in the backlog)
- Interactive 3D viewer (the engine does not yet output `viewer.bin`)
- Levelness (level) section (the `stats.json` contract does not yet have a related metric)
```
변경 후:
```text
- Reports include only the photos attached to the scans of the included analyses (a photo uploader at the measurement-location level is in the backlog)
- Levelness (level) section (the `stats.json` contract does not yet have a related metric)
```

- [ ] **Step 6: `README.md` 수정 1곳(영어, CRLF 파일)**

**(RM-1) Tasks 1 and 4 절 첫 문단 끝에 한 문장** (현재 `:66`). 바로 아래 그림 표 3줄(`:68-70`)은 건드리지 않는다. 앞 줄(`:65`)의 U+2014는 기존 글이라 그대로 둔다. 새 문장에는 U+2014 대신 쌍점을 썼다.

기존:
```text
[report](docs/service-report.md)).

| Assessment heatmap (2m cells) | 3D preview | 10cm high-resolution deviation map |
```
변경 후:
```text
[report](docs/service-report.md)). The floor results screen also includes an interactive 1:1 point cloud viewer
(pure WebGL2, no 3D library): a sample of the actual scan points at true scale, colored by deviation.

| Assessment heatmap (2m cells) | 3D preview | 10cm high-resolution deviation map |
```

- [ ] **Step 7: 리디자인 스펙 수정 3곳**

파일: `docs/superpowers/specs/2026-09-04-dashboard-cloudscape-redesign-design.md`. 4번째 줄("14개 화면을 그린 캔버스")과 6번째 줄("1페이지 = 구현 대상 14장")은 claude.ai 캔버스에 대한 사실이라 **건드리지 않는다**(스펙 §9). 7번째 줄의 "아트보드 원본 14장"도 그대로 둔다.

**(RD-1) 시각적 정본 설명에 추가 1장** (현재 `:8` 다음 줄에 삽입).

기존:
```text
  이 파일들이 기준이며, 이 문서는 그 파일들이 공유하는 규칙을 적는다. 브라우저에서 바로 열어 볼 수 있다.
```
변경 후:
```text
  이 파일들이 기준이며, 이 문서는 그 파일들이 공유하는 규칙을 적는다. 브라우저에서 바로 열어 볼 수 있다.
  2026-10-02 추가 1장: `ScanDone3D.dc.html`(캔버스 밖에서 저장소에 추가, 3D 점군 뷰어). §10 예외 기록 참고.
```

**(RD-2) 2절 범위 줄에 주석** (현재 `:19`). 원문 "아트보드 14장이 전부다."는 그대로 두고 뒤에 주석만 붙인다.

기존:
```text
**범위**: `dashboard/`의 토큰·공통 컴포넌트·셸·전 라우트 화면 구조. 아트보드 14장이 전부다.
```
변경 후:
```text
**범위**: `dashboard/`의 토큰·공통 컴포넌트·셸·전 라우트 화면 구조. 아트보드 14장이 전부다. (주: 2026-10-02에 3D 점군 뷰어 아트보드 1장을 저장소에 추가했다. §10 예외 기록)
```

**(RD-3) 문서 끝에 새 절** (현재 마지막 줄 `:159` 다음). 조항은 줄 번호가 아니라 절 번호와 인용구로 가리킨다(RD-1이 한 줄을 넣어 스펙 §9 표의 줄 번호가 하나씩 밀린다). 이 문서의 본문은 한다체이므로 새 절도 한다체다.

기존:
```text
4. 375px에서 홈·스캔 작업대가 세로 스택으로 깨지지 않음.
```
변경 후:
```text
4. 375px에서 홈·스캔 작업대가 세로 스택으로 깨지지 않음.

## 10. 예외 기록 (2026-10-02, 3D 점군 뷰어)

3D 점군 1:1 뷰어(`docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md`)는 이 문서의 조항 다섯 곳에서
벗어난다. 근거와 세부는 그 문서 §9에 있고, 여기에는 벗어나는 조항과 예외의 범위를 적는다.

| # | 벗어나는 조항 | 예외 | 사유 |
|---|---|---|---|
| 1 | §2 "다크 모드 없음" | 3D 뷰어 영역에 한해 배경이 순수 검정 `#000000`이다. 전체 다크 모드가 아니며 대시보드의 나머지는 밝은 테마 그대로다. `globals.css`에 다크 모드 규칙을 넣지 않는다 | 사용자 지시(참고 캡처와 같은 모습, 순수 검정). 화면 캡처용 밝은 배경 전환을 함께 둔다 |
| 2 | §3 "이 표 밖의 색을 쓰지 않는다", §3 예외(히트맵·범례) | 점 3색 + 편차 없음 색 + 뷰어 글자·격자 색을 hex 상수(`lib/domain/points3d.ts`의 `POINTS3D_THEME`)로 쓴다. `GRADE_COLOR`와 같은 종류의 그림 색 예외다. `cs-` 토큰 표에는 추가하지 않는다 | 참고 캡처의 색 언어. 팔레트 스윕(§9 검증 2)은 그대로 통과한다 |
| 3 | §2 "기능 추가는 §7의 테이블 도구 줄 한 가지뿐" | 3D 뷰어와 그 컨트롤(시점, 편차 과장, 임계값 슬라이더, 밝은 배경)을 추가한다 | 요청된 기능이다 |
| 4 | §2 "서버 스키마·워커·엔진·Supabase 쿼리 로직 무변경" | 엔진에 모듈 2개와 stats 키 2개·경고 코드 1개를 추가하고, 워커의 라벨 사본을 고친다. 서버 스키마와 쿼리는 그대로다 | 브라우저가 받을 점 단위 산출물이 없었다 |
| 5 | §2 "아트보드 14장이 전부다", 머리말의 시각적 정본 설명 | 아트보드 `docs/design/cloudscape/ScanDone3D.dc.html`을 추가한다. `ScanDone`과 같은 화면에서 `3D 프리뷰` 탭이 활성인 상태를 그린다. 이 파일은 claude.ai 캔버스에 없고 저장소에만 추가한 1장이다 | 기존 `ScanDone.dc.html`에는 탭 이름만 있고 3D 탭 본문이 없다 |

- 머리말의 숫자 14(승인 기록의 "14개 화면", 캔버스 링크의 "14장")는 claude.ai 캔버스에 대한 사실이므로 그대로 둔다.
  새 아트보드는 그 캔버스에 없다.
- **지키는 조항**: §2 "차트 라이브러리 추가 없음"과 `dashboard/lib/viz/heatmap.ts`의 "외부 라이브러리 금지".
  순수 WebGL2 직접 구현이라 벗어나지 않는다. 뷰어의 버튼은 전부 `normal`이다(뷰당 primary 1개 규칙 유지).
```

- [ ] **Step 8: 중간 확인(문서 4종 통과, 아트보드만 남음)**

```bash
cd D:/Projects/Flatness
D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe .superpowers/tmp/task15/check_task15.py
```

Expected: 마지막 줄 `24 passed, 1 failed`. 실패는 `AB-exists ScanDone3D.dc.html 존재  <- 파일 없음` 한 줄뿐이다. `*-preserve`가 실패하면 고치기로 한 줄 밖을 건드린 것이고(실패 줄 끝에 바뀐 줄이 찍힌다), `*-banned`가 실패하면 U+2014나 금지 표현이 들어간 것이다. "변경 후" 글을 다시 대조해 고친다.

- [ ] **Step 9: 아트보드 생성기 작성(커밋하지 않는 일회용 도구)**

아트보드는 기존 14장과 같은 방식의 정적 HTML(인라인 `style`, `<x-dc>` 틀)이다. 점군 그림은 SVG 점 약 3,900개라 손으로 적지 않고 생성기로 만든다. 생성기는 `ScanDone.dc.html`을 읽어 **좌측 칸(탭 줄 + 히트맵 + 범례)만** 바꿔 쓰므로 나머지는 글자 그대로 같다. 난수를 쓰지 않아 몇 번을 돌려도 같은 파일이 나온다.

`.superpowers/tmp/task15/gen_scandone3d.py` (UTF-8, LF):

```python
"""ScanDone3D.dc.html 생성기 (일회용 도구. 커밋하지 않는다).

ScanDone.dc.html 의 좌측 칸(탭 줄 + 히트맵 + 범례)만 '3D 프리뷰' 탭이 활성인 화면으로 바꿔
ScanDone3D.dc.html 을 쓴다. 나머지 마크업은 ScanDone.dc.html 과 글자 그대로 같다.

점군 그림은 설계 스펙(2026-10-02-pointcloud-viewer-design.md)의 기본 시점을 그대로 계산해 그린다:
FOVY 40도, 등각 프리셋(방위 -55도, 고도 20도), fit 반경 = 대각선 / 2, 거리 = 반경 / sin(FOVY / 2) x 1.05.
난수를 쓰지 않는다(정수 해시로 점 위치를 흩뜨린다). 같은 입력이면 같은 파일이 나온다.

사용: <py> gen_scandone3d.py [저장소 루트(기본 .)]
"""
import hashlib
import math
import sys
from pathlib import Path

SRC = "docs/design/cloudscape/ScanDone.dc.html"
DST = "docs/design/cloudscape/ScanDone3D.dc.html"

# ScanDone.dc.html 안에서 바꿀 구간의 시작(탭 줄)과 끝(판정 패널 직전). 둘 다 파일에 한 번만 나온다.
TAB_ROW_OPEN = '              <div style="display: flex; gap: 24px; border-bottom: 1px solid #e9ebed;">\n'
PANEL_OPEN = ('            <div style="display: flex; flex-direction: column; gap: 16px; padding: 20px; '
              'border: 1px solid #e9ebed; border-radius: 16px; background: #ffffff;">\n')

# 스펙 7.6 색 표(dark)
BG = "#000000"
COL_FLAT = "#4cc96f"
COL_DEP = "#f5c33b"
COL_PRO = "#f06464"
COL_NONE = "#4a4f57"
COL_LINE = "#ffffff"
GRID_ALPHA = "0.09"
AXIS_ALPHA = "0.28"
COL_TEXT = "#f2f4f7"
COL_TEXT2 = "#9aa3ad"

# 스펙 7.12 문구(임계값 7mm = floor-kcs-exposed 의 허용치)
T = "7"
NOTICE = (
    "점 색은 참고용 표시입니다. FLAT(평탄)은 점이 속한 5cm 칸이 구역 기준 평면에서 ±" + T + "mm 이내, "
    "DEPRESSION(침하)은 −" + T + "mm 미만, PROTRUSION(융기)은 +" + T + "mm 초과임을 뜻합니다. "
    "판정 등급은 히트맵 탭의 직선자 틈새 기준이며 측정 방식이 다릅니다. "
    "초록 점이 대부분인 칸이 경계·보수일 수 있고, 노랑·빨강 점이 많은 칸이 적합일 수 있습니다. "
    "임계값을 바꿔도 판정과 보고서는 달라지지 않습니다."
)
HUD = "축 비율 1:1 · 임계값 ±" + T + " mm · 118,342점"
HINT = "드래그 회전 · Ctrl+휠 확대"

# 뷰어 영역(CSS px). 아트보드 좌측 칸 폭 612px, 4:3
W, H = 612, 459
FOVY = math.radians(40.0)
AZIMUTH = math.radians(-55.0)
ELEVATION = math.radians(20.0)
FIT_MARGIN = 1.05
MIN_FIT_RADIUS_M = 0.5

# 그림 속 바닥: ScanDone 히트맵과 같은 8 x 5 m (1m 셀 40개)
FLOOR_X, FLOOR_Y = 8.0, 5.0
SPACING = 0.1          # 그림용 점 간격(m). 실제 표본은 더 촘촘하다
JITTER = 0.035         # 점 위치 흩뜨림(m)
THRESHOLD_MM = 7.0
GRID_STEP = 0.5        # niceStep(8, 5) = 0.5 (선 수 16 + 10 + 2 = 28 <= 40, 0.2 는 67 로 초과)
LABEL_MIN_GAP_PX = 28.0
NAME_OFFSET_PX = 40.0  # 축 이름을 변에서 띄우는 화면 거리(그림용)
DOT_PX = 1.5           # 점 최소 크기(CSS px)
LABEL_PX = 11


def _camera():
    target = (FLOOR_X / 2, FLOOR_Y / 2, 0.0)
    radius = max(math.hypot(FLOOR_X, FLOOR_Y, 0.0) / 2, MIN_FIT_RADIUS_M)
    dist = radius / math.sin(FOVY / 2) * FIT_MARGIN
    ce = math.cos(ELEVATION)
    eye = (target[0] + dist * ce * math.cos(AZIMUTH),
           target[1] + dist * ce * math.sin(AZIMUTH),
           target[2] + dist * math.sin(ELEVATION))
    f = tuple(t - e for t, e in zip(target, eye))
    fl = math.sqrt(sum(c * c for c in f))
    f = tuple(c / fl for c in f)
    # s = f x up(0, 0, 1), u = s x f
    s = (f[1], -f[0], 0.0)
    sl = math.hypot(s[0], s[1])
    s = (s[0] / sl, s[1] / sl, 0.0)
    u = (s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0])
    return eye, s, u, f


_EYE, _S, _U, _F = _camera()
_FOCAL = 1.0 / math.tan(FOVY / 2)


def project(x, y, z=0.0):
    """월드 좌표(m) -> 뷰어 영역 화면 좌표(CSS px, 왼쪽 위 원점)."""
    d = (x - _EYE[0], y - _EYE[1], z - _EYE[2])
    xc = sum(a * b for a, b in zip(_S, d))
    yc = sum(a * b for a, b in zip(_U, d))
    w = sum(a * b for a, b in zip(_F, d))
    ndc_x = xc * _FOCAL / (W / H) / w
    ndc_y = yc * _FOCAL / w
    return (ndc_x * 0.5 + 0.5) * W, (1.0 - (ndc_y * 0.5 + 0.5)) * H


def _unit_hash(i, j, salt):
    """정수 해시 -> [0, 1). 난수 대신 쓴다."""
    h = (i * 73856093) ^ (j * 19349663) ^ (salt * 83492791)
    h = (h * 2654435761) & 0xFFFFFFFF
    h ^= h >> 15
    h = (h * 2246822519) & 0xFFFFFFFF
    h ^= h >> 13
    return h / 4294967296.0


def _seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)
    t = min(1.0, max(0.0, t))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def deviation_mm(x, y):
    """그림용 편차장(mm, - 침하). ScanDone 히트맵의 경계 셀 자리에 함몰을 둔다."""
    d_main = _seg_dist(x, y, 2.6, 3.4, 3.4, 1.8)
    dev = -10.5 * math.exp(-((d_main / 0.42) ** 2))
    for cx, cy in ((1.5, 0.5), (5.5, 0.6)):
        dev += -9.0 * math.exp(-((math.hypot(x - cx, y - cy) / 0.30) ** 2))
    return dev


def has_deviation(x, y):
    """ScanDone 히트맵의 판정 불가 셀(x 7~8m, y 2~3m 제외)은 성긴 회색 점으로 그린다."""
    return not (x >= 7.0 and not (2.0 <= y < 3.0))


def build_points():
    paths = {"flat": [], "dep": [], "pro": [], "none": []}
    nx = int(round(FLOOR_X / SPACING))
    ny = int(round(FLOOR_Y / SPACING))
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = min(FLOOR_X, max(0.0, i * SPACING + (_unit_hash(i, j, 1) - 0.5) * 2 * JITTER))
            y = min(FLOOR_Y, max(0.0, j * SPACING + (_unit_hash(i, j, 2) - 0.5) * 2 * JITTER))
            if not has_deviation(x, y):
                if _unit_hash(i, j, 3) < 0.4:      # 저밀도 구역: 점의 40%만 남긴다
                    paths["none"].append((x, y))
                continue
            dev = deviation_mm(x, y)
            key = "pro" if dev > THRESHOLD_MM else "dep" if dev < -THRESHOLD_MM else "flat"
            paths[key].append((x, y))
    return paths


def _dots(points, color):
    d = "".join("M%.1f %.1fh0" % project(x, y) for x, y in points)
    return ('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"></path>'
            % (d, color, DOT_PX))


def _lines(segments, alpha):
    d = "".join("M%.1f %.1fL%.1f %.1f" % (project(*a) + project(*b)) for a, b in segments)
    return ('<path d="%s" fill="none" stroke="%s" stroke-opacity="%s" stroke-width="1"></path>'
            % (d, COL_LINE, alpha))


def build_scaffold():
    nx = int(math.floor(FLOOR_X / GRID_STEP + 1e-9))
    ny = int(math.floor(FLOOR_Y / GRID_STEP + 1e-9))
    grid = [((i * GRID_STEP, 0.0), (i * GRID_STEP, FLOOR_Y)) for i in range(nx + 1)]
    grid += [((0.0, j * GRID_STEP), (FLOOR_X, j * GRID_STEP)) for j in range(ny + 1)]
    axis = [((0.0, 0.0), (FLOOR_X, 0.0)), ((0.0, 0.0), (0.0, FLOOR_Y))]
    labels = []
    last = None
    for i in range(nx + 1):                       # x축 변(y = 0): 숫자는 변 아래쪽
        px, py = project(i * GRID_STEP, 0.0)
        if last is not None and math.hypot(px - last[0], py - last[1]) < LABEL_MIN_GAP_PX:
            continue
        last = (px, py)
        labels.append((px, py + 14.0, "middle", "%.1f" % (i * GRID_STEP)))
    last = None
    for j in range(ny + 1):                       # y축 변(x = 0): 숫자는 변 왼쪽
        px, py = project(0.0, j * GRID_STEP)
        if last is not None and math.hypot(px - last[0], py - last[1]) < LABEL_MIN_GAP_PX:
            continue
        last = (px, py)
        if j == 0:
            continue                              # 원점의 0.0 은 x축 눈금과 같은 자리라 한 번만 적는다
        labels.append((px - 8.0, py + 4.0, "end", "%.1f" % (j * GRID_STEP)))
    # 축 이름: 변의 중점에서 변에 수직인 화면 방향(바닥 중심 반대쪽)으로 NAME_OFFSET_PX 만큼 띄운다
    cx, cy = project(FLOOR_X / 2, FLOOR_Y / 2)
    for (a, b), text in zip(axis, ("x (m)", "y (m)")):
        ax, ay = project(*a)
        bx, by = project(*b)
        mx, my = (ax + bx) / 2, (ay + by) / 2
        nx_, ny_ = -(by - ay), bx - ax
        nl = math.hypot(nx_, ny_)
        nx_, ny_ = nx_ / nl, ny_ / nl
        if nx_ * (mx - cx) + ny_ * (my - cy) < 0:
            nx_, ny_ = -nx_, -ny_
        labels.append((mx + nx_ * NAME_OFFSET_PX, my + ny_ * NAME_OFFSET_PX + 4.0, "middle", text))
    return grid, axis, labels


def build_svg(ind):
    pts = build_points()
    grid, axis, labels = build_scaffold()
    out = [
        '<svg viewBox="0 0 %d %d" style="position: absolute; top: 0; left: 0; display: block; width: 100%%; '
        'height: 100%%;" aria-hidden="true">' % (W, H),
        "  " + _lines(grid, GRID_ALPHA),
        "  " + _lines(axis, AXIS_ALPHA),
        "  " + _dots(pts["none"], COL_NONE),
        "  " + _dots(pts["flat"], COL_FLAT),
        "  " + _dots(pts["dep"], COL_DEP),
    ]
    if pts["pro"]:
        out.append("  " + _dots(pts["pro"], COL_PRO))
    for x, y, anchor, text in labels:
        out.append('  <text x="%.1f" y="%.1f" text-anchor="%s" fill="%s" font-size="%d">%s</text>'
                   % (x, y, anchor, COL_TEXT2, LABEL_PX, text))
    out.append("</svg>")
    return "\n".join(ind + line for line in out) + "\n", {k: len(v) for k, v in pts.items()}


TAB_ON = "padding: 0 0 8px; border-bottom: 4px solid #0972d3; color: #0972d3; font-weight: 700;"
TAB_OFF = "padding: 0 0 8px; border-bottom: 4px solid transparent; color: #414d5c; font-weight: 700;"
BTN = ("display: inline-flex; align-items: center; height: 32px; padding: 0 20px; border: 2px solid #0972d3; "
       "border-radius: 20px; background: %s; color: #0972d3; font-family: inherit; font-size: 14px; "
       "font-weight: 700; cursor: pointer;")
BTN_OFF = BTN % "transparent"
BTN_ON = BTN % "#f2f8fd"
GROUP = "display: flex; align-items: center; gap: 8px;"
MONO = ("font-family: Monaco, Menlo, Consolas, 'Courier New', monospace; font-size: 13px; "
        "font-variant-numeric: tabular-nums;")
OVERLAY = "position: absolute; font-size: 12px; line-height: 16px; pointer-events: none;"


def _legend_item(color, name):
    return ('<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 10px; height: 10px; '
            'border-radius: 50%%; background: %s;"></span>%s</span>' % (color, name))


def build_block():
    svg, counts = build_svg(" " * 18)
    b = []
    a = b.append
    a('              <div style="display: flex; gap: 24px; border-bottom: 1px solid #e9ebed;">')
    a('                <span style="%s">히트맵</span>' % TAB_OFF)
    a('                <span style="%s">정밀 편차맵</span>' % TAB_OFF)
    a('                <span style="%s">3D 프리뷰</span>' % TAB_ON)
    a('                <span style="%s">현장 사진</span>' % TAB_OFF)
    a('              </div>')
    a('              <div style="display: flex; flex-direction: column; gap: 12px;">')
    a('                <div role="img" aria-label="3D 점군 뷰어" style="position: relative; width: 100%%; '
      'aspect-ratio: 4 / 3; overflow: hidden; border: 1px solid #e9ebed; border-radius: 8px; background: %s;">' % BG)
    block_head = "\n".join(b) + "\n"
    b = []
    a = b.append
    a('                  <div style="%s top: 12px; right: 14px; display: flex; flex-direction: column; gap: 4px; '
      'color: %s;">' % (OVERLAY, COL_TEXT))
    a('                    ' + _legend_item(COL_FLAT, "FLAT"))
    a('                    ' + _legend_item(COL_DEP, "DEPRESSION"))
    a('                    ' + _legend_item(COL_PRO, "PROTRUSION"))
    a('                    ' + _legend_item(COL_NONE, "편차 없음"))
    a('                  </div>')
    a('                  <div style="%s left: 12px; bottom: 10px; color: %s; font-variant-numeric: tabular-nums;">%s</div>'
      % (OVERLAY, COL_TEXT, HUD))
    a('                  <div style="%s right: 12px; bottom: 10px; color: %s;">%s</div>' % (OVERLAY, COL_TEXT2, HINT))
    a('                </div>')
    a('                <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px;">')
    a('                  <div style="%s">' % GROUP)
    a('                    <span style="font-weight: 700;">시점</span>')
    for name in ("등각", "평면", "정면"):
        a('                    <button type="button" style="%s">%s</button>' % (BTN_OFF, name))
    a('                  </div>')
    a('                  <div style="%s">' % GROUP)
    a('                    <span style="font-weight: 700;">편차 과장</span>')
    for k in ("1", "10", "50", "100"):
        on = k == "1"
        a('                    <button type="button" aria-pressed="%s" style="%s">×%s</button>'
          % ("true" if on else "false", BTN_ON if on else BTN_OFF, k))
    a('                  </div>')
    a('                  <div style="%s">' % GROUP)
    a('                    <span style="font-weight: 700;">임계값</span>')
    a('                    <input type="range" min="10" max="300" step="5" value="70" aria-label="표시 임계값(mm)" '
      'aria-valuetext="±%s mm" style="width: 160px; margin: 0; accent-color: #0972d3;">' % T)
    a('                    <span style="%s">±%s mm</span>' % (MONO, T))
    a('                  </div>')
    a('                  <button type="button" aria-pressed="false" style="%s">밝은 배경</button>' % BTN_OFF)
    a('                </div>')
    a('                <p style="margin: 0; font-size: 12px; line-height: 16px; color: #5f6b7a;">%s</p>' % NOTICE)
    a('              </div>')
    a('            </div>')
    a('')
    return block_head + svg + "\n".join(b) + "\n", counts


def main():
    sys.stdout.reconfigure(encoding="utf-8")   # Windows 콘솔 기본 인코딩(cp949)으로 한글이 깨지지 않게 한다
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    src = (root / SRC).read_bytes().decode("utf-8").replace("\r\n", "\n")
    for anchor in (TAB_ROW_OPEN, PANEL_OPEN):
        if src.count(anchor) != 1:
            raise SystemExit("ScanDone.dc.html 의 기준 줄을 찾지 못했다(또는 여러 번 나온다): " + anchor.strip()[:60])
    i = src.index(TAB_ROW_OPEN)
    j = src.index(PANEL_OPEN)
    if not i < j:
        raise SystemExit("기준 줄 순서가 예상과 다르다")
    block, counts = build_block()
    out = src[:i] + block + src[j:]
    data = out.encode("utf-8")
    (root / DST).write_bytes(data)
    print("wrote %s (%d bytes, sha256 %s)" % (DST, len(data), hashlib.sha256(data).hexdigest()))
    print("points: flat %(flat)d, depression %(dep)d, protrusion %(pro)d, none %(none)d" % counts)


if __name__ == "__main__":
    main()
```

그림에 대한 결정(스펙이 값을 정하지 않은 것은 여기서 정했다):

- **시점은 스펙의 기본 시점 그대로다.** FOVY 40°, 등각 프리셋(방위 −55°, 고도 20°), `radius = 대각선 / 2`, `distance = radius / sin(FOVY / 2) × 1.05`를 계산해 투영한다(Task 8 `fitToBounds`·`viewProj`와 같은 식). 그래서 바닥이 뷰어 영역의 가운데 2/3쯤만 차지한다. 참고 캡처보다 작아 보이는 것은 fit 구에 여유 5%를 두는 스펙 식의 결과이지 그림의 실수가 아니다.
- **바닥은 8 × 5 m**: `ScanDone.dc.html`의 히트맵(1m 셀 8열 × 5행)과 같은 스캔이라는 설정이다. 노랑 함몰부는 그 히트맵의 경계 셀 자리, 회색(편차 없음) 성긴 점은 판정 불가 셀 자리(x 7~8m)에 둔다. 빨강 점은 그리지 않는다(Task 16의 장면 1도 초록 바탕에 노랑 함몰부다). 범례는 4항목 전부 그린다.
- **점 간격 0.1m는 그림용이다.** 실제 표본(HUD의 118,342점)은 훨씬 촘촘하다. 점 지름은 스펙의 최소 크기 CSS 1.5px.
- **격자 간격 0.5m**: Task 9 `niceStep(8, 5)`의 값이다(선 수 16 + 10 + 2 = 28 ≤ 40. 한 단계 아래 0.2m는 40 + 25 + 2 = 67로 넘는다). 눈금 숫자는 같은 축에서 28px 미만이면 건너뛰는 규칙(`layoutLabels`)을 그대로 적용해, x축은 1.0 간격, y축은 `1.0, 2.0, 3.0, 4.5`가 남는다(3.0 다음 28px를 처음 넘는 눈금이 4.5다).
- **축 숫자의 글자 크기(11px)와 변에서 띄운 거리, 축 이름 위치(변에서 40px)**는 스펙에 값이 없어 그림에서 정했다. Task 12 구현의 값과 다를 수 있고, 다르면 구현을 고치지 않는다(스펙이 정한 것은 색과 문구, 28px 솎기뿐이다).
- 컨트롤 줄은 좌측 칸 폭 612px에서 `flex-wrap`으로 세 줄이 된다(시점 / 편차 과장 / 임계값 + 밝은 배경). 스펙 §7.10 구성도의 두 줄 배치는 더 넓은 폭에서의 모습이다.

- [ ] **Step 10: 아트보드 생성**

```bash
cd D:/Projects/Flatness
D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe .superpowers/tmp/task15/gen_scandone3d.py
```

Expected(이 PC, <py> 3.14.3에서 계획 작성 때 실제로 나온 출력):

```
wrote docs/design/cloudscape/ScanDone3D.dc.html (91965 bytes, sha256 355d124ffb0dfcc42d057378b9fcc89a7afbe7cc59bb5da518d7c58c38b2812d)
points: flat 3563, depression 136, protrusion 0, none 187
```

점 수 4개는 정수 해시와 비교로만 정해지므로 같아야 한다. 수의 근거: 격자점은 `(8.0 / 0.1 + 1) × (5.0 / 0.1 + 1) = 81 × 51 = 4131`개다. 저밀도 구역(`x >= 7.0`이고 `y`가 `[2.0, 3.0)` 밖)에 드는 격자점은 열 10.5개(i = 71~80은 항상, i = 70은 흩뜨림 부호에 따라 절반) × 행 41개(j = 0~19와 31~50은 항상, j = 20·30은 절반)로 약 430개이고 실제 해시로 432개다. 그 40%만 남기므로 회색 점은 약 173개, 실제 187개(해시 값이 정확히 균등하지 않다). 노랑 점은 편차장이 `−7mm`보다 낮은 영역의 격자점이다: 띠 `−10.5·exp(−(d/0.42)²) < −7`은 `d < 0.267m`이고 길이 1.789m의 선분 둘레 면적 `2 × 0.267 × 1.789 + π × 0.267² ≈ 1.18m²`에 100점/m²로 약 118점, 함몰 핵 2개는 `−9·exp(−(r/0.3)²) < −7`에서 `r < 0.150m`, 각 `0.071m²`로 약 7점씩이라 합쳐 약 132점(실제 136). 빨강은 편차장이 어디서도 양수가 아니므로 0이다. 초록은 나머지 `4131 − 432 − 136 = 3563`이다(정확히 일치). sha256은 소수 첫째 자리 반올림 경계에 걸린 좌표가 수학 라이브러리 차이로 달라지면 바뀔 수 있다. sha256만 다르고 점 수와 Step 11이 맞으면 통과로 본다. `기준 줄을 찾지 못했다`로 끝나면 `ScanDone.dc.html`이 바뀐 것이니 `git diff HEAD -- docs/design/cloudscape/ScanDone.dc.html`로 확인한다(이 태스크는 그 파일을 고치지 않는다).

- [ ] **Step 11: 검증 통과 확인**

```bash
cd D:/Projects/Flatness
D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe .superpowers/tmp/task15/check_task15.py
```

Expected: 종료 코드 0, 마지막 줄 `40 passed, 0 failed`.

- [ ] **Step 12: 아트보드 화면 캡처 대조(사용자 상시 지시)**

설치된 Chrome의 headless 모드로 새 아트보드와 원본 `ScanDone`을 같은 크기(1440 × 2240, 아트보드 프레임)로 찍고, 두 그림이 다른 영역을 구한다. Playwright는 쓰지 않는다. 캡처는 `.superpowers/tmp/task15/shots/`에 남긴다(커밋하지 않는다).

```bash
cd D:/Projects/Flatness
T=D:/Projects/Flatness/.superpowers/tmp/task15
mkdir -p $T/shots
for name in ScanDone3D ScanDone; do
  "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --hide-scrollbars \
    --no-first-run --user-data-dir="$T/chrome-profile" --window-size=1440,2240 \
    --screenshot="$T/shots/$name.png" \
    "file:///D:/Projects/Flatness/docs/design/cloudscape/$name.dc.html" 2>&1 | grep -i "written"
done
rm -rf "$T/chrome-profile"
D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -c "
from PIL import Image, ImageChops
a = Image.open(r'$T/shots/ScanDone3D.png').convert('RGB')
b = Image.open(r'$T/shots/ScanDone.png').convert('RGB')
print(a.size, b.size)
print('diff bbox', ImageChops.difference(a, b).getbbox())
a.crop((320, 940, 980, 1720)).save(r'$T/shots/ScanDone3D_left.png')
"
```

Expected: `... bytes written to file ...` 두 줄, `(1440, 2240) (1440, 2240)`, `diff bbox (340, 982, 952, 1684)`. bbox의 x 범위 340~952는 좌측 칸(폭 612px)이다. 두 캡처의 차이가 이 상자 안에만 있다는 것이 "나머지 화면은 `ScanDone`과 같다"의 화면상 증거다. 글꼴(Open Sans·Noto Sans KR)을 네트워크에서 받지 못하면 대체 글꼴로 그려져 y 값이 달라질 수 있다. 그때도 x 범위가 340~952 안이면 된다.

이어서 Read 도구로 `.superpowers/tmp/task15/shots/ScanDone3D_left.png`를 열어 눈으로 본다. 참고 캡처 `.superpowers/research/3d-pointcloud-viewer/reference-capture.webp`(추적되지 않는 로컬 파일. 있으면 함께 연다)와 스펙 §7.10 구성도·§7.6 색 표에 대조해 아래를 하나씩 확인하고, 확인한 결과를 태스크 보고에 적는다.

| # | 확인할 것 | 근거 |
|---|---|---|
| 1 | 탭 줄에서 `3D 프리뷰`만 파란 글자와 4px 밑줄이다. 탭 순서는 히트맵 / 정밀 편차맵 / 3D 프리뷰 / 현장 사진 | §7.10, V5 |
| 2 | 뷰어 영역이 순수 검정이고 4:3, 모서리가 둥글다. 대시보드의 나머지는 밝은 테마 그대로다 | D3, §7.10의 1 |
| 3 | 오른쪽 위 범례 4줄: 초록 `FLAT`, 노랑 `DEPRESSION`, 빨강 `PROTRUSION`, 어두운 회색 `편차 없음`. 표식이 둥글다 | D3, D4, §7.6 |
| 4 | 점이 작은 둥근 점이다(네모가 아니다). 초록이 대부분이고 가운데 왼쪽에 노랑 함몰부가 띠 모양으로 보인다. 오른쪽 가장자리에 회색 점이 성기게 있다 | D3, D9 |
| 5 | 옅은 격자선과 두 변의 축선, 변을 따라 적힌 숫자(m), 축 이름 `x (m)`·`y (m)`가 보인다 | D3, §7.8 |
| 6 | 낮게 비스듬히 내려다보는 시점이다(바닥이 납작한 평행사변형으로 보인다) | D3, §7.7 |
| 7 | 왼쪽 아래 `축 비율 1:1 · 임계값 ±7 mm · 118,342점`, 오른쪽 아래 `드래그 회전 · Ctrl+휠 확대`(보조 글자색) | D4, §7.10 |
| 8 | 컨트롤 줄: `시점` 등각·평면·정면 / `편차 과장` ×1(옅은 파랑 배경)·×10·×50·×100 / `임계값` 슬라이더와 `±7 mm` / `밝은 배경`. 버튼은 전부 테두리형이고 채움 버튼이 없다 | §7.10의 2 |
| 9 | 고지 문구가 회색 작은 글자로 뷰어 아래에 있고 `±7mm`, `−7mm`, `+7mm`가 보인다 | §7.12 |
| 10 | 우측 판정 패널, 구간별 결과표, 위쪽의 스캔 정보·분석 컨테이너가 `ScanDone`과 같다(위 diff bbox) | §12 |

어긋난 항목이 있으면 생성기의 해당 상수나 마크업을 고쳐 Step 10부터 다시 한다. 문구나 색이 스펙과 다르면 스펙이 기준이다.

브라우저 패널로도 열어 볼 수 있지만(`navigate` → `file:///D:/Projects/Flatness/docs/design/cloudscape/ScanDone3D.dc.html`) 대조의 주 수단으로 쓰지 않는다. 계획 작성 때 스크래치 사본으로 확인한 결과, 패널 창이 800 × 350이라 1440px 아트보드의 뷰어 영역(612 × 459)이 한 화면에 들어오지 않고, `resize_window`로 1440 × 1500을 주면 창에 맞춰 축소돼 글자를 읽을 수 없으며, `zoom`의 영역 자르기는 지원되지 않았다. 패널을 썼다면 끝난 뒤 `resize_window preset="desktop"`으로 되돌리고, 다른 작업이 쓰는 탭은 건드리지 않는다(`file://`을 열면 새 탭이 생긴다. 그 탭만 닫는다).

- [ ] **Step 13: 남은 서술과 변경 범위 확인**

```bash
cd D:/Projects/Flatness
git status --short
git diff --stat
git diff -U0 -- docs/superpowers/specs/2026-09-04-dashboard-cloudscape-redesign-design.md | grep -n "^[-+].*14"
grep -n "미구현.*viewer\|does not yet output\|회전·줌 가능한 뷰어는 정식 단계 백로그" docs/service-report.md README.md dashboard/README.md
grep -rln "viewer\.bin\|3D 뷰어" docs README.md dashboard/README.md worker/README.md | sort
```

Expected:

- `git status --short`: 정확히 다섯 줄. ` M README.md`, ` M dashboard/README.md`, ` M docs/service-report.md`, ` M docs/superpowers/specs/2026-09-04-dashboard-cloudscape-redesign-design.md`, `?? docs/design/cloudscape/ScanDone3D.dc.html`.
- `git diff --stat`: `README.md | 3 ++-`(추가 2, 삭제 1), `dashboard/README.md | 5 +++--`(추가 3, 삭제 2), `docs/service-report.md | 65 ...`(추가 60, 삭제 5), 리디자인 스펙 `| 21 ...`(추가 20, 삭제 1). README 두 파일의 줄 수가 파일 전체만큼 크게 나오면 줄 끝(CRLF)이 바뀐 것이다. `git checkout -- <파일>`로 되돌리고 Edit 도구로 다시 고친다.
- 숫자 14 확인(세 번째 명령): 출력은 네 줄이다. `-`로 시작하는 줄은 범위 줄 하나뿐이고(`-**범위**: ... 아트보드 14장이 전부다.`), `+` 줄은 셋이다: 고친 범위 줄(`+**범위**: ... 아트보드 14장이 전부다. (주: ...`), 새 절 표의 5번 행(`+| 5 | §2 "아트보드 14장이 전부다", ...`), 새 절의 `+- 머리말의 숫자 14(승인 기록의 "14개 화면", ...`. 머리말의 "14개 화면을 그린 캔버스"(4번째 줄)나 "구현 대상 14장"(6번째 줄)이 `-` 줄로 나오면 안 된다.
- 네 번째 명령: 출력 없음(종료 코드 1). "미구현"이라는 서술이 세 문서에 남지 않았다.
- 다섯 번째 명령: `docs/service-report.md`(새 소절과 6.5절 행이 `viewer.bin`·"3D 뷰어"를 구현 설명 안에서 언급), `docs/audit/2026-09-05-이행감사-task1.md`, `docs/superpowers/plans/2026-07-28-p3-dashboard.md`, `docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md`, `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md`와 이 기능의 계획 문서(`docs/superpowers/plans/` 아래)만 나온다. 감사 기록·옛 계획·정본 스펙은 스펙 §12의 "고치지 않는 것"이라 그대로 둔다. `README.md`, `dashboard/README.md`, `worker/README.md`는 목록에 없어야 한다. 그 밖의 파일이 나오면 그 줄을 읽고, 뷰어가 미구현이라는 서술이면 보고한다(이 태스크의 범위를 넓혀 고치지 않는다).

- [ ] **Step 14: 스위트가 문서 변경에 영향받지 않는지 확인**

문서를 읽는 테스트가 있다(엔진 `test_summary.py`는 `docs/contracts/stats-schema.md`를, 워커 라벨 테스트는 `labels.ts`를 읽는다). 이번에 고친 다섯 파일을 읽는 테스트는 없지만 실제로 돌려 확인한다.

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_summary.py -q
cd D:/Projects/Flatness/dashboard && npx vitest run
```

Expected: 엔진 `8 passed`(기존 7 + Task 5가 이 파일에 더한 테스트 1건 `test_render_failed_codes_are_documented_and_kept_out_of_summary_text`). 대시보드는 실패 0이고 `Test Files`·`Tests` 수가 Task 14를 마쳤을 때와 같다(기준선 84파일 769건 + Task 5(labels.test.ts 1건) + Task 6~14가 더한 것. 이 태스크는 테스트를 더하지 않는다). `palette-sweep`와 `points3d-litmus`가 통과 목록에 있다. 실패가 있으면 출력을 그대로 보고한다. 문서만 바꿨으므로 실패는 이 태스크가 아니라 앞 태스크의 상태에서 온 것이다(그래도 통과하기 전에는 커밋하지 않는다).

- [ ] **Step 15: 커밋**

```bash
cd D:/Projects/Flatness
git add docs/service-report.md dashboard/README.md README.md \
  docs/superpowers/specs/2026-09-04-dashboard-cloudscape-redesign-design.md \
  docs/design/cloudscape/ScanDone3D.dc.html
git status --short     # 다섯 줄 전부 첫 칸(스테이징)에 표시. 그 밖의 줄 없음
git commit -F - <<'EOF'
docs: 3D 점군 1:1 뷰어 문서 갱신 + 아트보드 ScanDone3D

- service-report: 6.5절 3D 점군 뷰어 행을 구현으로 고치고 6.7절 6순위에서 뺐다.
  4.5.1절(3D 점군 1:1 뷰어)을 새로 넣었다: 표본 방식(cell min-hash stratified),
  색 기준(5cm 서브셀 잔차), 판정 무관성, 기존 방침에서 벗어난 4건의 사유.
  2.1절 화면 연계 행과 머리말의 갱신 기록도 맞췄다
- README 2종(영어): 결과 화면의 interactive 1:1 point cloud viewer 한 문장.
  dashboard/README의 viewer.bin 한계 항목 삭제
- Cloudscape 리디자인 스펙: 10절 예외 기록 5건. 머리말의 숫자 14는 그대로 두고
  추가 1장(ScanDone3D.dc.html)을 덧붙였다
- docs/design/cloudscape/ScanDone3D.dc.html: ScanDone과 같은 화면에서
  3D 프리뷰 탭 활성 상태(뷰어 영역, 컨트롤 줄, 고지 문구)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git log -1 --stat
```

Expected: `5 files changed`. `git add` 때 `LF will be replaced by CRLF` 경고가 나올 수 있다(`core.autocrlf=true`). 저장소에는 LF로 들어가므로 무시한다. `.superpowers/tmp/task15/`의 스크립트와 캡처는 추적되지 않으므로 커밋에 들어가지 않는다(Task 16이 캡처 대조에 아트보드를 다시 쓴다. 폴더는 지우지 않아도 된다).

> **초안 메모(계획 본문이 아니다. 계획을 합칠 때 판단할 것)**
>
> 1. **SR-0(머리말 갱신 기록)은 스펙 §12 표에 없는 줄이지만 넣는 것으로 확정했다.** service-report 머리말(`:9-10`)이 "1~8장은 세부과업 1 제출 시점의 내용을 그대로 유지했습니다"라고 적고 있어 §12의 네 곳(2.1·4장·6.5·6.7절)을 고치면 그 문장이 거짓이 된다. 예외를 괄호로 덧붙이는 기존 방식(7.2절 첫 문단)을 따랐다. 근거는 '대응 스펙 절'과 Step 4의 SR-0 설명에 있고, 검사 `SR-header`·`SR-preserve`와 Step 3·8·11의 기대 수(10/15, 24/1, 40/0), Step 13의 줄 수(추가 60·삭제 5)는 SR-0을 포함한 값이다.
> 2. **새 소절 번호를 `4.5.1`로 했다.** 스펙은 "`:482` 앞(§4.5 다음)에 새 소절"이라고만 적었다. `### 4.6`으로 넣고 기존 4.6을 4.7로 미는 방법도 있으나 기존 절 제목을 바꾸게 돼 택하지 않았다(`4.6절`을 가리키는 다른 문서는 없다).
> 3. **스크래치에서 실제로 돌린 것**(`.superpowers/plan-drafts/pointcloud-viewer/scratch-15/`): 다섯 문서의 사본에 이 계획의 "기존 → 변경 후"를 그대로 적용(각 "기존" 글이 정확히 한 번 나오는 것 확인), 검증 스크립트 실패(10/15) → 중간(24/1) → 통과(40/0), 변이 36건(수정 11건을 하나씩 생략 + 문구·색·숫자 14·금지 표현 변이 25건) 전부 사망, 생성기 2회 실행 결과 바이트 동일, headless Chrome 캡처와 `ScanDone` 대비 diff bbox, `git diff --stat` 수치, 엔진 `test_summary` 7건·대시보드 84파일 769건 통과(둘 다 Task 5 적용 전 기준선. Task 5가 각각 1건을 더하므로 Step 14의 기대값은 엔진 8건, 대시보드 770건 + Task 6~14가 더한 것이다).
> 4. **돌리지 못한 것**: Step 1의 grep(Task 1~14의 산출물이 아직 없다), Step 14의 "Task 14 이후" 건수, Step 15의 커밋.
> 5. **뼈대의 Test (2) "브라우저 패널로 열어 캡처"**는 패널 크기 제약으로 판독이 안 돼 headless Chrome 캡처를 주 수단으로 바꿨다(Step 12 끝 문단).
> 6. **2026-10-03 재확인(이어서 한 세션)**: HEAD a9e51f5·깨끗한 작업 트리에서 `scratch-15/tools/replay.py`(초안의 코드 블록과 "기존/변경 후"만 읽어 재현)가 `10 passed, 15 failed` → `24 passed, 1 failed` → 생성기 출력(91965바이트, sha256 `355d124f…`, 점 수 3563/136/0/187) → `40 passed, 0 failed`를 그대로 냈고 결과가 `scratch-15/work/`와 바이트 동일했다. `mutate.py` 36건 전부 사망(살아남은 변이 0). Step 12의 headless Chrome 캡처를 다시 떠서 `diff bbox (340, 982, 952, 1684)`가 같았고, 캡처를 눈으로 보아 Step 12 표의 10항목(활성 탭, 검정 4:3 영역, 범례 4줄, 둥근 점·노랑 띠·회색 성긴 점, 격자·축 숫자·축 이름, 낮은 비스듬한 시점, HUD·조작 안내, 컨트롤 줄, 고지 문구, 우측 패널 불변)을 확인했다. 인용 줄 번호(service-report `:10-12`·`:123`·`:482`·`:706`·`:748`, dashboard/README `:75-76`·`:105`, README `:66`, 리디자인 스펙 `:8`·`:19`·`:159`)와 Step 13의 `git diff --stat` 수치(85 insertions, 9 deletions)도 현재 파일로 다시 맞췄다. 이 세션에서 바꾼 것은 SR-2 설명의 문장 하나(절 번호를 4.6으로 주지 않는 이유의 표현)와 Step 10 점 수의 근거 문단 추가뿐이다.

---
### Task 16: 검증: 전체 스위트, tsc, next build, 성능 게이트, 로컬 하네스 화면 캡처 대조

**목표:** 추적 파일을 바꾸지 않고, 전 스위트·타입 검사·빌드·성능 게이트(3천만 점, 300만 점)를 실제로 돌린 출력과 스펙 §10.6 의 11개 장면 캡처·확인 기록을 남긴다. 결함을 찾으면 고치지 않고 해당 태스크로 돌아간다.

**대응 스펙 절:** `docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md` §10.5(표 아래 문단: 기존 격리 테스트 하중 재확인), §10.6(산출물, 하네스, 캡처, 대체 화면, 하네스가 검증하지 않는 것, 장면 표 11행), §10.7(실행 명령과 기준선), §11(엔진 재측정: 3천만 점과 300만 점), §13(배포 순서는 기록만. 머지·배포는 사용자 결정. 작업 중 금지), §14(미실측·위험 1·2·10 을 보고에 그대로 적는다), §2.1 D3·D4·D7(참고 캡처와 같은 모습).

**Files:**
- Create(저장소 안): 없음
- Modify(저장소 안): 없음. 커밋도 만들지 않는다. Step 7 의 변이 실험만 `engine/flatness/core/pipeline.py` 를 잠깐 바꿨다가 `git checkout --` 으로 되돌린다
- Create(저장소 밖, 세션 스크래치패드 아래 `points3d-harness/`. 아래에서 `<H>` 라 부른다. 커밋하지 않는다):
  - `<H>/make_scan.py`(합성 스캔 2개 생성), `<H>/mutate_try.py`(Step 7 의 변이 스크립트)
  - `<H>/vite.config.mjs`, `<H>/index.html`, `<H>/main.tsx`, `<H>/stubs/supabase-client.ts`, `<H>/stubs/next-link.tsx`, `<H>/stubs/next-navigation.ts`(하네스)
  - `<H>/capture.mjs`(CDP 캡처 드라이버)
  - 실행 중에 생기는 것: `<H>/floor.ply`, `<H>/wall.ply`, `<H>/out-floor/`, `<H>/out-wall/`, `<H>/shots/`, `<H>/.vite-cache/`, `<H>/.chrome-profile-*/`, 로그(`<H>/vitest-new11.log`, `<H>/vite.log`, `<H>/capture-main.log`, `<H>/capture-software.log`)
- Test: 저장소의 전 스위트(엔진·워커·대시보드)와 성능 테스트, 그리고 `<H>/capture.mjs` 가 남기는 캡처·JSON
- 읽기만 한다: `engine/tests/fixtures/synthetic.py`(`flat_floor`, `flat_wall`, `add_bump`, `write_binary_ply`), `engine/flatness/cli.py:142-147`(`analyze` 가 `analyze_floor`/`analyze_wall` 을 부른다), `dashboard/components/analysis/analysis-result.tsx`(T14 가 고친 실제 소스), `dashboard/components/ui/{container,page,alert,button}.tsx`, `dashboard/app/globals.css`, `dashboard/postcss.config.mjs`, `docs/design/cloudscape/ScanDone3D.dc.html`(T15), `.superpowers/research/3d-pointcloud-viewer/reference-capture.webp`(참고 캡처, 추적되지 않는 로컬 파일)

**Interfaces:**
- Consumes:
  - T4: CLI 가 만드는 산출물. `PYTHONPATH=D:/Projects/Flatness/engine <py> -m flatness.cli analyze <ply> --units m --criteria floor-kcs-exposed --out <출력 폴더>` → `points3d.bin`, `stats.json`(`points3d_paths == ["points3d.bin"]`, `points3d_threshold_q == 70`, `preview3d_paths == ["preview3d.png", "preview3d_zoom.png"]`), `preview3d.png`, `preview3d_zoom.png`, `cells.json`, `deviation.png`, `heatmap.png`, `results.csv`. 벽면은 `--criteria wall-kcs-tilt-other` → `points3d_paths` 키 없음
  - T4: `engine/tests/perf/test_memory_spike.py` 의 `test_30m_points_within_budget`, `test_3m_points_within_budget`(둘 다 `@pytest.mark.perf`, 출력 `[perf] <라벨>: <초>s, 피크 RSS 증가 <GiB> GiB, ..., points3d.bin <바이트> bytes`)
  - 기존 픽스처 `tests.fixtures.synthetic`: `flat_floor(size=(6.0, 6.0), spacing=0.02)`, `add_bump(pts, center, radius, height)`(10mm 함몰 = height −0.010), `flat_wall(length, height, spacing, y0, axis)`, `write_binary_ply(pts, path)`
  - T14: `AnalysisResult({ analysis: AnalysisRow, scan: ScanRow, photos: PhotoRow[] })` 실제 소스(`dashboard/components/analysis/analysis-result.tsx`). `artifactUrl(dir, file)` → `/api/data/<dir>/<file>`
  - T12·T13 DOM 계약(캡처 스크립트가 이 이름으로 찾는다): 캔버스 `canvas[aria-label="3D 점군 뷰어"]`, `data-testid` = `points3d-viewport`·`points3d-legend`·`points3d-hud`·`points3d-hint`·`points3d-labels`·`points3d-readout`·`points3d-notice`·`points3d-loading`, 슬라이더 `input[type=range][aria-label="표시 임계값(mm)"]`(`aria-valuetext`), 버튼 이름 `등각`·`평면`·`정면`·`×1`·`×10`·`×50`·`×100`·`밝은 배경`·`다시 시도`·`3D로 보기`, 과장·밝은 배경 버튼의 `aria-pressed`, Alert 루트의 `data-alert`, PNG `img[alt^="3D 프리뷰"]`, 탭 `[role=tab]`(이름 `히트맵`·`3D 프리뷰`)
  - T15: 아트보드 `docs/design/cloudscape/ScanDone3D.dc.html`(1440px 고정 폭, `<x-dc>` 안 `<div>`), 참고 캡처 `.superpowers/research/3d-pointcloud-viewer/reference-capture.webp`
  - `dashboard/node_modules` 의 `vite`(8.1.5, vitest 의 의존성이라 `node_modules/.bin/vite` 가 있다)·`@vitejs/plugin-react`(6.0.4, ESM 전용)·`@tailwindcss/postcss`(4.3.3), `dashboard/postcss.config.mjs`, `dashboard/app/globals.css`
- Produces:
  - 검증 기록(커밋하지 않음, 최종 보고에 싣는다): 각 명령의 실제 출력 요약(통과 수, 실패 시 실패 그대로), perf 수치(초, GiB, 바이트), 장면별 캡처 이미지 경로와 확인 결과, 캡처하지 못한 장면과 사유, 변이 재확인 결과. Step 14 의 양식을 쓴다
  - 저장소 밖 하네스 `<H>/`(위 Files). 이 태스크 뒤에도 남겨 두면 다른 사람이 같은 대조를 다시 할 수 있다

**배경(이 태스크만 읽는 사람을 위한 설명):**

- 이 저장소는 바닥 평활도 스캔을 분석하는 파이썬 엔진(`engine/`), 분석 잡을 돌리는 워커(`worker/`), Next.js 대시보드(`dashboard/`)로 이루어진다. Task 1~15 가 엔진에 점 표본 산출물 `points3d.bin` 을, 대시보드의 `3D 프리뷰` 탭에 순수 WebGL2 뷰어를 넣었다. 이 태스크는 그 전체를 한 번에 돌려 보고 기록만 남긴다.
- 자동 테스트가 못 보는 것이 있다. jsdom 에는 WebGL 이 없어 실제 픽셀·휠·배율은 vitest 로 검증되지 않는다(스펙 §10.4 끝 문단). 그래서 스펙 §10.6 이 "로컬 하네스에서 실제 브라우저로 11개 장면을 캡처해 참고 캡처·아트보드와 대조"하라고 정했다.
- 실제 대시보드 경로(로그인 → `/api/data` 가 Supabase 서명 URL 로 302)는 쓸 수 없다. 작업 중 Supabase·원격 DB 접속이 금지이고, `/api/data` 라우트에 로컬 대체 경로가 없다. 그래서 하네스는 `dashboard/node_modules` 의 vite 로 `AnalysisResult` 를 **실제 소스 그대로** 번들해 띄우고, `/api/data/artifacts/<이름>/<파일>` 요청을 CLI 출력 폴더에서 직접 응답한다. Supabase 클라이언트와 Next 전용 모듈만 접속 없는 대체물로 바꾼다. 뷰어 코드는 하나도 대체하지 않는다.
- 캡처는 의존성 없는 CDP 스크립트(`capture.mjs`)로 한다. 헤드리스 Chrome 을 띄워 탭을 누르고, 버튼·슬라이더를 조작하고, 커서를 점 위에 올리고, 휠을 보내고, 배율 2 와 375px 폭을 에뮬레이션한 뒤 PNG 를 남긴다. 장면마다 화면에서 읽은 값(HUD 문자열, 범례, 픽셀 색 수, 요청 수, 콘솔 메시지)을 JSON 으로 적고 자동 확인(checks)을 단다. **자동 확인은 보조다.** 판정은 캡처 이미지를 직접 보고(Read 도구로 PNG 를 연다) 참고 캡처·아트보드와 대조해서 한다.
- 이 계획을 쓰면서 하네스·캡처 스크립트를 형제 태스크의 스크래치 구현(T6~T14 의 초안 코드)과 합쳐 실제로 돌려 봤다. 21개 장면 기록·자동 확인 전부 통과, 소프트웨어 렌더 2개 장면 통과, 아트보드 캡처 성공. 그러니 스크립트가 실패하면 먼저 뷰어 쪽(DOM 계약 불일치나 결함)을 의심한다.

**함정:**

1. 하네스 폴더에는 `node_modules` 가 없다. `vite.config.mjs` 는 `createRequire('D:/Projects/Flatness/dashboard/package.json')` 로 `@tailwindcss/postcss` 를, 파일 URL `import()` 로 `@vitejs/plugin-react`(ESM 전용) 를 가져온다. `main.tsx` 의 `react`·`react-dom/client` 는 정규식 alias 로 `dashboard/node_modules` 의 파일을 가리킨다. 실행은 반드시 `cd D:/Projects/Flatness/dashboard && npx vite --config <H>/vite.config.mjs` 다(vite 실행 파일이 dashboard 쪽에 있다). 포트 5199 가 쓰이고 있으면 `strictPort` 때문에 바로 죽는다. 그때는 설정의 `port` 를 바꾸고 `HARNESS_URL` 환경 변수로 캡처 스크립트에 알린다.
2. Tailwind v4 는 `@tailwindcss/postcss` 플러그인에 `base: 'D:/Projects/Flatness/dashboard'` 를 줘서 클래스 탐지 범위를 실행 위치와 무관하게 dashboard 소스로 고정한다. 그래서 T12 가 `points3d-view.tsx` 에 쓴 `aria-pressed:bg-cs-info-bg` 가 실제 CSS 로 나온다. 장면 2 의 자동 확인 `선택 배경(cs-info-bg)` 이 그 사실을 계산된 배경색(`rgb(242, 248, 253)`)으로 확인한다. 계획 작성 중 모의 뷰어에 `bg-cs-info-bg` 를 그냥 덧붙이는 변이를 넣었을 때 이 확인이 실제로 죽었다(`.bg-transparent` 가 이긴다는 스펙 §7.10 의 설명 그대로).
3. alias 는 구체적인 것(`@/lib/supabase/client`, `next/link`, `next/navigation`)을 일반(`@`)보다 먼저 둔다. `VerdictPanel`·`PhotoGallery` 가 supabase 클라이언트를, `RefreshOnUpload`·`Button(LinkButton)` 이 `next/navigation`·`next/link` 를 import 한다. 대체물은 아무 데도 접속하지 않는다(`createClient` 는 부르면 바로 예외. 하네스에서는 `저장`·`현장 사진` 탭을 쓰지 않는다).
4. 대체 화면은 `?scene=` 쿼리로 만든다: `nodata`(stats 에서 `points3d_paths`·`points3d_threshold_q` 제거), `wall`(`flat_wall` 합성 스캔을 벽 기준으로 분석한 출력), `import`(`engine_version` 을 `external-json-v1` 로), `fetchfail`(`artifacts_dir` 를 `artifacts/nobin` 으로. 하네스 서버가 그 폴더의 `.bin` 요청에만 404 를 주고 PNG 는 그대로 준다). 소프트웨어 렌더는 `--disable-gpu` 로 띄운 Chrome 에서만 생긴다(`node capture.mjs software`). 개발 PC(RTX 2060 SUPER, Chrome 헤드리스)에서는 기본 실행이 하드웨어(`failIfMajorPerformanceCaveat` 성공), `--disable-gpu` 가 SwiftShader(실패)였다. 하드웨어 WebGL2 가 없는 기기에서는 `main` 모드가 시작 직후 멈추고 그렇게 말한다. 그러면 장면 1~8·10·11 은 캡처하지 못했다고 보고한다.
5. 하네스 `main.tsx` 는 기본으로 `StrictMode` 를 켠다(Next 개발 모드와 같이 effect 가 두 번 돈다). 장면 7 의 `points3d.bin` 요청 1회 확인은 그 상태에서 통과해야 한다(스펙 §7.3 의 4번, 진행 중 요청의 `dir` 을 ref 로 드는 멱등 검사). 분리해 보고 싶으면 `?scene=floor&strict=0`.
6. 장면 8 의 "브라우저 페이지 배율 불변"은 헤드리스 Chrome 에서는 애초에 페이지 확대가 일어나지 않아 그 자체로는 증거가 약하다. 그래서 캡처 스크립트는 `window` 에 `wheel` 리스너를 달아 **실제 브라우저에서 `preventDefault` 가 먹었는지**(`e.defaultPrevented`)를 함께 기록한다. 휠을 JSX `onWheel`(React 가 passive 로 등록) 로 옮긴 변이를 모의 뷰어에 넣었을 때 이 확인이 죽는 것을 계획 작성 중 확인했다. `devicePixelRatio`·`visualViewport.scale` 불변은 보조 근거다.
7. 장면 11 의 "점 지름이 배율 1 과 같은 CSS 크기"는 눈으로는 가늠하기 어렵다. 스크립트는 평면 시점에서 뷰어 영역의 캡처 픽셀 중 배경이 아닌 비율을 배율 1 과 2 에서 재서 비율이 0.75~1.33 이면 통과로 본다(점 최소 크기를 배율에 맞추지 않는 변이는 약 1/4~0.6 으로 떨어진다. 모의 뷰어 변이로 확인: 0.633). 캡처의 범례 영역(같은 색의 둥근 표식)은 세지 않는다.
8. 버튼에는 `transition-colors`(150ms)와 `hover:bg-cs-info-bg` 가 있다. 스크립트는 클릭 뒤 커서를 (2, 2) 로 빼고 250ms 를 기다린 다음 읽고 찍는다. 커서를 버튼 위에 두고 찍으면 hover 배경이 선택 배경처럼 보여 장면 2·5 의 판단이 틀린다.
9. 캡처 픽셀 색 세기는 스펙 §7.6 색 표(hex)를 스크립트 상수로 둔 것이다(구현에서 베끼지 않았다). 캔버스는 antialias 를 끄고 둥근 점을 `discard` 로 그리므로 점 픽셀은 팔레트 색 그대로다. 격자선·글자는 다른 색이라 분류에 안 들어가고 `litFraction` 에만 들어간다.
10. 아트보드(`*.dc.html`)는 `support.js` 가 404 여도 마크업·인라인 스타일로 그려진다(리디자인 계획의 선례). 본문 안의 Google Fonts `<link>` 가 늦으면 그 뒤 마크업이 파싱되지 않아 빈 캡처가 나온다. 스크립트는 글꼴 요청을 막고(`Network.setBlockedURLs`) 대체 글꼴로 찍는다. 하네스도 `next/font` 가 없어 대체 글꼴이다. 둘 다 대체 글꼴이니 글꼴 차이는 대조 항목이 아니다.
11. Step 7 의 변이는 **추적 파일을 잠깐 바꾼다.** 반드시 `git status --short` 가 비어 있는 상태에서 시작하고, 끝나면 `git checkout -- engine/flatness/core/pipeline.py` 와 `git status --short`(빈 출력)로 되돌아왔는지 본다. 바꾼 채로 다른 명령을 돌리지 않는다.
12. `npx next build` 는 `dashboard/.next/`, `tsconfig.tsbuildinfo`, `next-env.d.ts` 를 쓴다. 셋 다 `dashboard/.gitignore` 에 있어 `git status` 에 안 나온다(계획 작성 중 확인). 그래도 빌드 뒤 `git status --short` 를 본다. Next 가 `.env.local` 을 읽는 것은 Next 의 동작이고, 우리가 값을 읽거나 출력하지 않는다.
13. 성능 테스트 출력에 한글이 있다. Git Bash 파이프에서 cp949 로 깨지지 않게 `PYTHONIOENCODING=utf-8` 을 앞에 둔다. 3천만 점 PLY(약 360MB)는 pytest 의 `tmp_path`(`%TEMP%/pytest-of-<사용자>`) 에 생겼다 지워진다. 기준선(점 파일 없는 현재 코드, 개발 PC)은 `30M점: 44.3s, 피크 RSS 증가 1.33 GiB` 였다.
14. 참고 캡처 `reference-capture.webp` 는 Read 도구로 바로 열린다(계획 작성 중 확인). 아트보드는 HTML 이라 `node capture.mjs artboard` 로 PNG 를 만든 뒤 연다.
15. 하네스의 왼쪽 칸 폭은 1400px 창에서 약 754px(3:2 그리드)이고 캔버스는 754×565 다. 실제 앱은 사이드 내비가 있어 조금 다르다. 비교 항목은 구성(범례·HUD·조작 안내 위치, 색, 시점)이지 픽셀 치수가 아니다.

**실행 환경:**

```
<py>  = D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe   (3.14. 기본 python 3.9 는 쓰지 않는다)
<H>   = <세션 스크래치패드>/points3d-harness   (절대 경로, forward slash. 명령마다 그대로 치환한다)
셸    = Git Bash, 경로는 forward slash
엔진  = cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -q
워커  = cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -q
성능  = cd D:/Projects/Flatness/engine && PYTHONIOENCODING=utf-8 PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -m perf -q -s
대시보드 = cd D:/Projects/Flatness/dashboard && npx vitest run && npx tsc --noEmit && npx next build
Chrome = C:/Program Files/Google/Chrome/Application/chrome.exe (다른 경로면 CHROME 환경 변수)
Node  = v22 (전역 WebSocket·fetch 를 쓴다)
```

기준선(2026-10-02, 이 계획을 쓰며 현재 코드로 실제 측정): engine `244 passed, 1 deselected`(약 94초), worker `209 passed, 2 deselected`(약 100초), dashboard `84 passed (84)` / `769 passed (769)`(약 78초), `tsc --noEmit` 0 오류, `next build` 성공(라우트 16개), 빌드 뒤 `git status --short` 빈 출력.

- [ ] **Step 1: 사전 확인(브랜치, 깨끗한 트리, 앞 태스크 산출물)**

Run:

```bash
cd D:/Projects/Flatness && git branch --show-current && git status --short && git log --oneline -16 | cat
```

Expected: `feat/pointcloud-viewer`, `git status --short` 는 빈 출력, 로그 맨 앞에 Task 1~15 의 커밋(`feat(engine)`, `feat(dashboard)`, `docs` …)이 보이고 그 아래 `a9e51f5 docs: 3D 점군 1:1 뷰어 설계 스펙`. 트리가 깨끗하지 않으면 멈추고 보고한다(Step 7 이 `git checkout --` 을 쓴다).

Run:

```bash
cd D:/Projects/Flatness && ls engine/flatness/core/pointsample.py engine/flatness/outputs/points3d.py engine/tests/fixtures/points3d_golden.bin dashboard/lib/domain/points3d.ts dashboard/lib/viz/points3d/mat4.ts dashboard/lib/viz/points3d/orbit.ts dashboard/lib/viz/points3d/scaffold.ts dashboard/lib/viz/points3d/budget.ts dashboard/lib/viz/points3d/pick.ts dashboard/lib/viz/points3d/controls.ts dashboard/lib/viz/points3d/gl-renderer.ts dashboard/components/analysis/points3d-view.tsx dashboard/components/analysis/preview3d-tab.tsx dashboard/__tests__/points3d-litmus.test.ts docs/design/cloudscape/ScanDone3D.dc.html && grep -c "Preview3dTab" dashboard/components/analysis/analysis-result.tsx && grep -n "points3d_render_failed" dashboard/lib/domain/labels.ts worker/flatworker/report/labels.py docs/contracts/stats-schema.md | head -3
```

Expected: 15개 파일이 전부 나열되고(없으면 `ls: cannot access`), `Preview3dTab` 개수 2 이상, 라벨 사전 두 곳과 계약 문서에 `points3d_render_failed` 가 있다. 하나라도 없으면 그 태스크가 끝나지 않은 것이다. 멈추고 보고한다.

- [ ] **Step 2: 하네스 파일 만들기(저장소 밖)**

세션 스크래치패드 아래 `points3d-harness/` 와 `points3d-harness/stubs/` 를 만들고 아래 9개 파일을 그대로 쓴다. 경로 상수 `D:/Projects/Flatness/dashboard` 는 저장소 위치가 다르면 바꾼다.

`<H>/make_scan.py`:

```python
"""화면 캡처 대조용 합성 스캔 두 개를 만든다(스펙 §10.6 의 1번). 저장소 밖 하네스 전용, 커밋하지 않는다.

사용: PYTHONPATH=D:/Projects/Flatness/engine <py> make_scan.py <출력 폴더>
  floor.ply  6x6m 평탄 바닥 + 10mm 함몰 + 12mm 융기 + 0.7m 위 성긴 상판(편차 없는 점)
  wall.ply   4x3m 바닥 + 벽 두 장(벽면 분석 대체 화면용)
"""
import sys
from pathlib import Path

import numpy as np

from tests.fixtures.synthetic import add_bump, flat_floor, flat_wall, write_binary_ply


def floor_scan():
    # 스펙 §10.6: flat_floor(6x6m) + add_bump(10mm 함몰). 함몰 핵은 기본 임계값 7mm 를 넘어 DEPRESSION(노랑)
    pts = flat_floor(size=(6.0, 6.0), spacing=0.02)
    pts = add_bump(pts, (2.0, 2.0), 0.3, -0.010)
    # 융기 12mm: 장면 5(밝은 배경의 진한 3색)와 장면 3(임계값 20mm 에서 전부 초록)을 확인하려고 더한다
    pts = add_bump(pts, (4.2, 3.8), 0.3, 0.012)
    # 바닥 위 0.7m 의 성긴 상판(10cm 간격). 서브셀 중앙값은 바닥이 차지하므로 이 점들은
    # 표면 이탈(DEV_NOT_FLOOR)이 되어 회색으로 나온다. 장면 6 의 '편차 없음' 읽기 창 확인용.
    # 바닥 격자(2cm)와 1cm 어긋나게 둔다. 같은 XY 에 두면 표본 칸(약 8.5mm)을 바닥 점과
    # 나눠 쓰게 되고, 편차 있는 점이 항상 이기므로 상판 점이 표본에서 전부 빠진다
    xs = np.arange(4.61, 5.41 + 1e-9, 0.1)
    ys = np.arange(1.01, 1.81 + 1e-9, 0.1)
    gx, gy = np.meshgrid(xs, ys)
    top = np.column_stack([gx.ravel(), gy.ravel(), np.full(gx.size, 0.7)])
    return np.vstack([pts, top])


def wall_scan():
    # engine/tests/test_pipeline.py 의 벽면 테스트와 같은 방(바닥 4x3m + 벽 두 장)
    return np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                      flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0),
                      flat_wall(length=3.0, height=2.4, spacing=0.02, axis='y', y0=0.0)])


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    floor = floor_scan()
    wall = wall_scan()
    write_binary_ply(floor, out / "floor.ply")
    write_binary_ply(wall, out / "wall.ply")
    print(f"floor.ply {len(floor)} points, wall.ply {len(wall)} points")


if __name__ == "__main__":
    main()
```

손으로 구한 기대값(캡처 스크립트의 상수이기도 하다): 바닥 점 301 × 301 = 90,601, 상판 점 9 × 9 = 81, 합 90,682(50만 상한 아래이고 표본 칸 약 8.5mm 에 두 점이 들어가지 않으므로 전부 표본이 된다 → HUD `90,682점`). 함몰 중심 (2.0, 2.0), 반경 0.3m, 깊이 10mm → 7mm 를 넘는 핵은 반경 약 0.11m(코사인 범프 `0.5(1 + cos(πr/R)) × 10 > 7`). 융기 (4.2, 3.8) 12mm. 상판 X 4.61~5.41, Y 1.01~1.81, Z 0.700(절대 좌표는 `origin_m + 로컬` 이고 이 스캔의 bbox 최솟값은 (0, 0, −0.01) 이라 바닥의 Z 가 0.000 으로 읽힌다). 임계값 20mm 에서는 노랑·빨강이 하나도 없다(10 < 20, 12 < 20).

`<H>/mutate_try.py`:

```python
"""기존 히트맵 렌더 블록의 try/except 를 벗기는 변이(스펙 §10.5 표 아래 문단). 인자: pipeline.py 경로"""
import sys
from pathlib import Path

p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")
old = ('    try:\n'
       '        render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)\n'
       '    except Exception:\n'
       '        render_warns.add("heatmap_render_failed")\n')
new = '    render_heatmap(cells, grades, out_dir / "heatmap.png", cell_m=cell_m)\n'
assert s.count(old) == 1, f"바꿀 블록을 찾지 못했습니다(개수 {s.count(old)})"
p.write_text(s.replace(old, new), encoding="utf-8")
print("mutated", p)
```

`<H>/vite.config.mjs`:

```js
// 화면 캡처 대조용 로컬 하네스(스펙 §10.6). 저장소 밖에 두고 커밋하지 않는다.
// 실행: cd D:/Projects/Flatness/dashboard && npx vite --config <이 폴더>/vite.config.mjs
// 이 폴더에는 node_modules 가 없다. 플러그인과 react 는 전부 dashboard/node_modules 에서 가져온다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = 'D:/Projects/Flatness/dashboard';
const require = createRequire(`${DASH}/package.json`);
const NM = `${DASH}/node_modules`;

// @vitejs/plugin-react 는 ESM 전용이라 파일 URL 로 import 한다
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default;
// dashboard/postcss.config.mjs 와 같은 플러그인. base 를 dashboard 로 고정해 클래스 탐지 범위를
// 실행 위치와 무관하게 dashboard 소스로 둔다
const tailwind = require('@tailwindcss/postcss');

// /api/data/artifacts/<이름>/<파일> 을 CLI 출력 폴더에서 직접 응답한다(로그인·302·서명 URL 없음)
const ARTIFACT_DIRS = {
  floor: path.join(HERE, 'out-floor'),
  wall: path.join(HERE, 'out-wall'),
  nobin: path.join(HERE, 'out-floor'), // points3d.bin 만 404 로 응답하는 폴더(fetch 실패 장면)
};
const TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.bin': 'application/octet-stream',
  '.csv': 'text/csv; charset=utf-8',
};

// 로딩 틀 캡처용: /__harness/delay?ms=1500 을 부르면 그 뒤의 .bin 응답을 그만큼 늦춘다(0 이면 해제)
let binDelayMs = 0;

function apiData() {
  return {
    name: 'harness-api-data',
    configureServer(server) {
      server.middlewares.use('/__harness/delay', (req, res) => {
        const ms = Number(new URL(req.url ?? '', 'http://x').searchParams.get('ms'));
        binDelayMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ binDelayMs }));
      });
      server.middlewares.use('/api/data', (req, res) => {
        const parts = decodeURIComponent((req.url ?? '').split('?')[0]).split('/').filter(Boolean);
        const [bucket, name, file] = parts;
        const dir = bucket === 'artifacts' && parts.length === 3 ? ARTIFACT_DIRS[name] : undefined;
        const full = dir ? path.join(dir, path.basename(file)) : null;
        const blocked = name === 'nobin' && !!file && file.endsWith('.bin');
        if (!full || blocked || !fs.existsSync(full)) {
          console.log(`[api/data] 404 ${parts.join('/')}`);
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '파일을 찾을 수 없습니다' }));
          return;
        }
        console.log(`[api/data] 200 ${parts.join('/')}`);
        res.statusCode = 200;
        res.setHeader('content-type', TYPES[path.extname(full)] ?? 'application/octet-stream');
        res.setHeader('cache-control', 'private, no-store');
        const body = fs.readFileSync(full);
        if (full.endsWith('.bin') && binDelayMs > 0) setTimeout(() => res.end(body), binDelayMs);
        else res.end(body);
      });
    },
  };
}

export default {
  root: HERE,
  cacheDir: path.join(HERE, '.vite-cache'),
  plugins: [react(), apiData()],
  css: { postcss: { plugins: [tailwind({ base: DASH })] } },
  resolve: {
    // 구체적인 것을 일반(@)보다 먼저 둔다
    alias: [
      { find: '@/lib/supabase/client', replacement: path.join(HERE, 'stubs/supabase-client.ts') },
      { find: 'next/link', replacement: path.join(HERE, 'stubs/next-link.tsx') },
      { find: 'next/navigation', replacement: path.join(HERE, 'stubs/next-navigation.ts') },
      { find: /^react$/, replacement: `${NM}/react/index.js` },
      { find: /^react\/(jsx-runtime|jsx-dev-runtime)$/, replacement: `${NM}/react/$1.js` },
      { find: /^react-dom$/, replacement: `${NM}/react-dom/index.js` },
      { find: /^react-dom\/client$/, replacement: `${NM}/react-dom/client.js` },
      { find: '@', replacement: DASH },
    ],
  },
  optimizeDeps: {
    // 진입점이 node_modules 밖(이 폴더)에 있어도 react 계열을 한 벌로 미리 묶는다
    entries: [path.join(HERE, 'index.html')],
  },
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
    fs: { allow: [DASH, HERE] },
  },
};
```

`<H>/index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>points3d 하네스</title>
    <!-- favicon 요청 404 가 콘솔 오류로 잡히지 않게 빈 아이콘을 준다 -->
    <link rel="icon" href="data:," />
  </head>
  <!-- body 클래스는 dashboard/app/layout.tsx 의 것과 같다(폰트 변수 3개만 없다. 글꼴은 대체 글꼴로 나온다) -->
  <body class="min-h-screen bg-white font-sans text-sm leading-5 text-cs-text antialiased">
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

`<H>/main.tsx`:

```tsx
// 화면 캡처 대조용 하네스 진입점(스펙 §10.6). AnalysisResult 를 실제 소스 그대로 렌더한다.
// 쿼리: ?scene=floor(기본) | nodata | wall | import | fetchfail,  &strict=0 이면 StrictMode 를 끈다
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/app/globals.css';
import { AnalysisResult } from '@/components/analysis/analysis-result';
import { Container } from '@/components/ui/container';
import { PAGE_MAIN } from '@/components/ui/page';
import type { AnalysisRow, ScanRow, Stats, Surface } from '@/lib/domain/types';

type Scene = 'floor' | 'nodata' | 'wall' | 'import' | 'fetchfail';
const SCENES: Scene[] = ['floor', 'nodata', 'wall', 'import', 'fetchfail'];

declare global {
  interface Window { __ready?: boolean; __error?: string; __scene?: Scene }
}

async function loadStats(dirName: 'floor' | 'wall'): Promise<Stats> {
  const res = await fetch(`/api/data/artifacts/${dirName}/stats.json`);
  if (!res.ok) throw new Error(`stats.json ${dirName}: HTTP ${res.status}`);
  return (await res.json()) as Stats;
}

function makeScan(surface: Surface): ScanRow {
  return {
    id: 'harness-scan', location_id: 'harness-loc', surface, scanned_at: '2026-10-02T09:00:00',
    device: null, operator_id: null, operator_name_manual: null, selected_criteria_id: null,
    raw_file_path: null, original_filename: null, file_format: 'ply', point_count: null,
    unit_scale: 1, lineage: 'raw', status: 'ready', height_view_path: null, deleted_at: null,
    created_at: '2026-10-02T09:00:00', updated_at: '2026-10-02T09:00:00',
  };
}

function makeAnalysis(id: string, surface: Surface, stats: Stats, artifactsDir: string,
                      engineVersion: string): AnalysisRow {
  return {
    id, scan_id: 'harness-scan', surface, criteria_id: 'harness-criteria',
    applied_criteria: stats.applied_criteria, params: {}, engine_version: engineVersion,
    status: 'done', stats, coverage_pct: stats.coverage_pct, overall_verdict: 'borderline',
    warnings: stats.warnings, artifacts_dir: artifactsDir, auto_summary: stats.auto_summary,
    user_summary: null, is_current: true, deleted_at: null, created_at: '2026-10-02T09:00:00',
    created_by: null, kind: 'flatness',
  };
}

async function build(scene: Scene): Promise<{ analysis: AnalysisRow; scan: ScanRow }> {
  if (scene === 'wall') {
    const stats = await loadStats('wall');
    return { analysis: makeAnalysis('an-wall', 'wall', stats, 'artifacts/wall', 'p4-0.5.0'), scan: makeScan('wall') };
  }
  const stats = await loadStats('floor');
  if (scene === 'nodata') {
    // 점 파일이 없는 옛 분석: 두 키를 지운다(계약: 키 부재)
    const rest: Record<string, unknown> = { ...stats };
    delete rest.points3d_paths;
    delete rest.points3d_threshold_q;
    return { analysis: makeAnalysis('an-nodata', 'floor', rest as unknown as Stats, 'artifacts/floor', 'p4-0.5.0'), scan: makeScan('floor') };
  }
  if (scene === 'import') {
    return { analysis: makeAnalysis('an-import', 'floor', stats, 'artifacts/floor', 'external-json-v1'), scan: makeScan('floor') };
  }
  if (scene === 'fetchfail') {
    // artifacts/nobin 은 하네스 서버가 points3d.bin 에만 404 를 준다(다른 파일은 out-floor 그대로)
    return { analysis: makeAnalysis('an-fetchfail', 'floor', stats, 'artifacts/nobin', 'p4-0.5.0'), scan: makeScan('floor') };
  }
  return { analysis: makeAnalysis('an-floor', 'floor', stats, 'artifacts/floor', 'p4-0.5.0'), scan: makeScan('floor') };
}

function App({ analysis, scan }: { analysis: AnalysisRow; scan: ScanRow }) {
  // app/scans/[id]/page.tsx 의 결과 컨테이너와 같은 틀(본문 여백 PAGE_MAIN + Container)
  return (
    <main className={PAGE_MAIN}>
      <Container title={
        <>
          평활도 결과
          <span className="ml-3 font-mono text-xs font-normal text-cs-text-secondary">
            {analysis.created_at.slice(0, 16).replace('T', ' ')}{' · '}엔진 {analysis.engine_version ?? '-'}
          </span>
        </>
      }>
        <AnalysisResult analysis={analysis} scan={scan} photos={[]} />
      </Container>
      {/* 장면 8(휠): 창 높이와 무관하게 페이지가 세로로 스크롤되도록 여백을 둔다 */}
      <div style={{ height: 800 }} />
    </main>
  );
}

const params = new URLSearchParams(window.location.search);
const raw = params.get('scene') ?? 'floor';
const scene: Scene = (SCENES as string[]).includes(raw) ? (raw as Scene) : 'floor';
const strict = params.get('strict') !== '0';
window.__scene = scene;

build(scene).then(({ analysis, scan }) => {
  const app = <App analysis={analysis} scan={scan} />;
  createRoot(document.getElementById('root')!).render(strict ? <StrictMode>{app}</StrictMode> : app);
  // 첫 렌더와 effect 가 지난 뒤 준비 표시(캡처 스크립트가 기다린다)
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));
}).catch((e: unknown) => {
  window.__error = String(e);
  document.getElementById('root')!.textContent = `하네스 오류: ${String(e)}`;
});
```

`<H>/stubs/supabase-client.ts`:

```ts
// 하네스 대체물: Supabase 에 접속하지 않는다. 어떤 메서드를 불러도 바로 예외를 던진다.
// VerdictPanel 의 '저장' 과 PhotoGallery('현장 사진' 탭)만 이 함수를 부른다. 하네스에서는 둘 다 쓰지 않는다.
export function createClient(): never {
  throw new Error('하네스에서는 Supabase 클라이언트를 만들지 않습니다');
}
```

`<H>/stubs/next-link.tsx`:

```tsx
// 하네스 대체물: next/link 대신 평범한 <a>
import type { ComponentProps } from 'react';

export default function Link({ href, ...rest }: Omit<ComponentProps<'a'>, 'href'> & { href: string | { pathname?: string } }) {
  return <a href={typeof href === 'string' ? href : href.pathname ?? '#'} {...rest} />;
}
```

`<H>/stubs/next-navigation.ts`:

```ts
// 하네스 대체물: next/navigation. 라우터 동작은 전부 아무것도 하지 않는다
export function useRouter() {
  return { refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} };
}

export function usePathname(): string {
  return window.location.pathname;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}
```

`<H>/capture.mjs`(의존성 0. 장면마다 JSON 한 줄과 PNG 를 남긴다):

```js
// 의존성 0 CDP 드라이버(선례: .superpowers/research/3d-pointcloud-viewer/design-inputs/cdp-bench.mjs).
// 헤드리스 Chrome 을 띄워 하네스 화면을 장면별로 조작·캡처하고, 장면마다 읽은 값을 JSON 한 줄로 출력한다.
// 사용: node capture.mjs main      장면 1~8, 9(점 파일 없음·벽면·임포트·fetch 실패), 10, 11
//       node capture.mjs software  장면 9 의 소프트웨어 렌더(--disable-gpu)
//       node capture.mjs artboard [파일명]  docs/design/cloudscape 의 아트보드를 PNG 로 남긴다(기본 ScanDone3D.dc.html)
// 환경 변수: HARNESS_URL(기본 http://127.0.0.1:5199), CHROME(Chrome 실행 파일 경로)
// 캡처는 이 파일 옆 shots/ 에 쓴다. 자동 확인(checks)은 보조이고, 판정은 캡처 이미지를 직접 보고 한다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODE = process.argv[2] ?? 'main';
const BASE = process.env.HARNESS_URL ?? 'http://127.0.0.1:5199';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(HERE, 'shots');
const ARTBOARD_DIR = 'D:/Projects/Flatness/docs/design/cloudscape';
// 이 기기가 WebGL2 를 어떻게 주는지(뷰어의 probeWebgl2 와 같은 두 번의 getContext)
const PROBE = `(() => { const a = document.createElement('canvas').getContext('webgl2'); const b = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true }); const e = a && a.getExtension('WEBGL_debug_renderer_info'); return { webgl2: !!a, withCaveatFlag: !!b, renderer: e ? a.getParameter(e.UNMASKED_RENDERER_WEBGL) : null }; })()`;
const W = 1400, H = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 스펙 §7.6 색 표(구현이 아니라 스펙에서 옮긴 값). 캡처 픽셀을 이 색으로 센다
const PALETTE = {
  dark: { bg: '#000000', flat: '#4cc96f', dep: '#f5c33b', pro: '#f06464', none: '#4a4f57' },
  light: { bg: '#ffffff', flat: '#1e9e50', dep: '#b88700', pro: '#d93636', none: '#b4bac2' },
};
// make_scan.py 의 입력에서 손으로 구한 값
const N_POINTS_TEXT = '90,682점';          // 301 * 301 + 9 * 9
const DEP_CENTER = [2.0, 2.0];             // 10mm 함몰 중심(m), 반경 0.3
const TOP_X = [4.6, 5.42], TOP_Y = [1.0, 1.82], TOP_Z = 0.7; // 0.7m 위 상판(편차 없는 점)

const results = [];
const failed = [];
function record(scene, shot, facts, checks) {
  for (const [name, ok] of Object.entries(checks)) if (!ok) failed.push(`${scene}: ${name}`);
  results.push({ scene, shot, facts, checks });
  console.log(JSON.stringify({ scene, shot, facts, checks }));
}

// 페이지 안에서 실행되는 함수. 바깥 변수를 쓰지 않는다(소스 문자열로 보내기 때문이다)
function pageFacts() {
  const t = (id) => document.querySelector('[data-testid="' + id + '"]');
  const one = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : null);
  const c = document.querySelector('canvas[aria-label="3D 점군 뷰어"]');
  const vp = t('points3d-viewport');
  const s = document.querySelector('input[type=range][aria-label="표시 임계값(mm)"]');
  const legend = t('points3d-legend');
  // 탭 본문(왼쪽 칸)만 본다. 오른쪽 판정 패널에도 경고 Alert 와 버튼이 있다
  const scope = document.querySelector('[role=tablist]')?.parentElement ?? document;
  return {
    canvas: c ? { width: c.width, height: c.height, clientWidth: c.clientWidth, clientHeight: c.clientHeight } : null,
    viewportBg: vp ? getComputedStyle(vp).backgroundColor : null,
    legend: legend ? legend.innerText.split('\n').map((x) => x.trim()).filter(Boolean) : null,
    hud: one(t('points3d-hud')),
    hint: one(t('points3d-hint')),
    notice: one(t('points3d-notice'))?.slice(0, 90) ?? null,
    labels: t('points3d-labels')?.innerHTML.length ?? null,
    slider: s ? { value: s.value, valueText: s.getAttribute('aria-valuetext') } : null,
    pressed: [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent.trim() + ' ' + getComputedStyle(b).backgroundColor),
    loading: !!t('points3d-loading'),
    alerts: [...scope.querySelectorAll('[data-alert]')].map((a) => a.getAttribute('data-alert') + ': ' + one(a).slice(0, 60)),
    images: [...scope.querySelectorAll('img[alt^="3D 프리뷰"]')].map((i) => i.getAttribute('alt') + (i.naturalWidth > 0 ? '' : ' (깨짐)')),
    buttons: ['다시 시도', '3D로 보기'].filter((n) => [...scope.querySelectorAll('button')].some((b) => b.textContent.trim() === n)),
    dpr: window.devicePixelRatio, vvScale: window.visualViewport.scale, scrollY: Math.round(window.scrollY),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}

async function launch(extraFlags) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = path.join(HERE, `.chrome-profile-${MODE}`);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-extensions', '--force-color-profile=srgb', '--hide-scrollbars',
    `--window-size=${W},${H}`, ...extraFlags, 'about:blank',
  ], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* 아직 안 뜸 */ }
  }
  if (!target) { chrome.kill(); throw new Error('Chrome 이 뜨지 않았습니다'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiters = new Map();
  const log = { requests: [], console: [] };
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiters.has(d.id)) { waiters.get(d.id)(d); waiters.delete(d.id); return; }
    if (d.method === 'Network.requestWillBeSent') log.requests.push(d.params.request.url);
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) {
      log.console.push(`${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
    }
    if (d.method === 'Runtime.exceptionThrown') log.console.push(`exception: ${d.params.exceptionDetails.text} ${d.params.exceptionDetails.exception?.description ?? ''}`.slice(0, 300));
    if (d.method === 'Log.entryAdded' && (d.params.entry.level === 'error' || d.params.entry.level === 'warning')) {
      log.console.push(`log.${d.params.entry.level}: ${d.params.entry.text} ${d.params.entry.url ?? ''}`.slice(0, 300));
    }
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiters.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
  return { send, log, close() { ws.close(); chrome.kill(); } };
}

function driver({ send, log }) {
  async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`evaluate 실패: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}\n${expression.slice(0, 200)}`);
    return r.result?.result?.value;
  }
  async function waitFor(expression, label, ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await evalJs(`!!(${expression})`)) return;
      await sleep(100);
    }
    throw new Error(`기다리다 시간 초과: ${label}`);
  }
  const frames = () => evalJs('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  async function metrics(width, height, deviceScaleFactor) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
  }
  async function open(query) {
    await send('Page.navigate', { url: `${BASE}/${query}` });
    await waitFor('window.__ready === true || window.__error', `하네스 준비 ${query}`);
    const err = await evalJs('window.__error ?? null');
    if (err) throw new Error(`하네스 오류: ${err}`);
  }
  // 요소 찾기 식(페이지 안에서 평가되는 JS 문자열)
  const BTN = (name) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})`;
  const TAB = (name) => `[...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})`;
  const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
  // 탭 본문이 든 왼쪽 칸(탭 줄의 부모)
  const SECTION = `document.querySelector('[role=tablist]').parentElement`;
  const CANVAS = `document.querySelector('canvas[aria-label="3D 점군 뷰어"]')`;
  const SLIDER = `document.querySelector('input[type=range][aria-label="표시 임계값(mm)"]')`;
  async function rect(el) {
    const r = await evalJs(`(() => { const e = ${el}; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    if (!r) throw new Error(`요소 없음: ${el}`);
    return r;
  }
  async function mouse(type, x, y, extra = {}) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'none', pointerType: 'mouse', ...extra });
  }
  async function click(el) {
    const r = await rect(el);
    const x = r.x + r.w / 2, y = r.y + r.h / 2;
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
    // 커서를 버튼 밖으로 뺀다. 그대로 두면 hover 배경(hover:bg-cs-info-bg)이 선택 배경처럼 보인다
    await mouse('mouseMoved', 2, 2);
    // Button 에 transition-colors(150ms)가 있다. 배경색이 자리 잡은 뒤에 읽고 찍는다
    await sleep(250);
    await frames();
  }
  // React 가 제어하는 range input 의 값을 바꾼다(네이티브 setter + input 이벤트)
  async function setSlider(value) {
    await evalJs(`(() => { const e = ${SLIDER}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, '${value}'); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await frames();
  }
  // el 을 주면 그 요소 영역만 자른다. 범례가 그 안에 있으면 범례의 상대 위치(mask, 0~1)를 함께 돌려준다.
  // beyond = true 면 창 높이를 넘는 요소도 끝까지 찍는다(캔버스가 없는 대체 화면용)
  async function shot(name, el, beyond = false) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const params = { format: 'png', captureBeyondViewport: beyond };
    let mask = null;
    if (el) {
      await evalJs('window.scrollTo(0, 0)');
      const r = await rect(el);
      const sy = await evalJs('window.scrollY');
      params.clip = { x: r.x, y: r.y + sy, width: r.w, height: r.h, scale: 1 };
      const lg = await evalJs(`(() => { const e = ${TID('points3d-legend')}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      if (lg) mask = { x0: (lg.x - r.x) / r.w, y0: (lg.y - r.y) / r.h, x1: (lg.x + lg.w - r.x) / r.w, y1: (lg.y + lg.h - r.y) / r.h };
    }
    await frames();
    const s = await send('Page.captureScreenshot', params);
    const file = path.join(SHOTS, name);
    fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
    return { file, b64: s.result.data, mask };
  }
  // 캡처 PNG 의 픽셀을 팔레트 색별로 센다(오차 ±3). 캔버스는 antialias 를 끄고 둥근 점을 discard 로
  // 그리므로 점 픽셀은 팔레트 색 그대로다. 범례의 둥근 표식도 같은 색이라 범례 영역(mask)은 세지 않는다
  async function pixelStats({ b64, mask }, themeName) {
    return evalJs(`(async () => {
      const pal = ${JSON.stringify(PALETTE[themeName])};
      const mask = ${JSON.stringify(mask)};
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const cols = Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, hex(v)]));
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,${b64}')).blob());
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      const out = { total: 0, bg: 0, flat: 0, dep: 0, pro: 0, none: 0 };
      const mx0 = mask ? Math.floor(mask.x0 * bmp.width) : -1, mx1 = mask ? Math.ceil(mask.x1 * bmp.width) : -1;
      const my0 = mask ? Math.floor(mask.y0 * bmp.height) : -1, my1 = mask ? Math.ceil(mask.y1 * bmp.height) : -1;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % bmp.width, py = Math.floor(i / 4 / bmp.width);
        if (px >= mx0 && px < mx1 && py >= my0 && py < my1) continue;
        out.total++;
        for (const k in cols) {
          const c = cols[k];
          if (Math.abs(d[i] - c[0]) <= 3 && Math.abs(d[i + 1] - c[1]) <= 3 && Math.abs(d[i + 2] - c[2]) <= 3) { out[k]++; break; }
        }
      }
      out.litFraction = +(1 - out.bg / out.total).toFixed(4);
      return out;
    })()`);
  }
  // 화면에서 읽을 수 있는 값. pageFacts 는 페이지 안에서 실행된다(함수 소스를 그대로 보낸다)
  const facts = () => evalJs(`(${pageFacts.toString()})()`);
  const bodyText = () => evalJs('document.body.innerText');
  // 이미지가 다 뜬 뒤에 높이를 재고 찍는다(PNG 가 늦게 뜨면 잘린 캡처가 된다)
  const waitImages = () => waitFor('[...document.images].every((i) => i.complete)', '이미지 로딩');
  const binRequests = () => log.requests.filter((u) => u.split('?')[0].endsWith('.bin')).length;
  // 캔버스 위 (cx, cy)(캔버스 왼쪽 위 기준 CSS px)에 커서를 두고 읽기 창의 글을 읽는다
  async function hover(cx, cy) {
    const r = await rect(CANVAS);
    await mouse('mouseMoved', r.x + cx, r.y + cy);
    // 읽기 창은 한 animation frame 에 한 번 찾고 React 가 그 뒤에 그린다. 세 프레임을 기다린다
    return evalJs(`new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => res(${TID('points3d-readout')}?.innerText ?? null)))))`);
  }
  // 캔버스의 일부(비율 구역)를 step px 격자로 훑어 pred 를 만족하는 읽기 창을 찾는다
  async function sweep(region, pred, step = 10) {
    const r = await rect(CANVAS);
    for (let cy = r.h * region.y0; cy < r.h * region.y1; cy += step) {
      for (let cx = r.w * region.x0; cx < r.w * region.x1; cx += step) {
        const text = await hover(cx, cy);
        if (text && pred(text)) return { cx: Math.round(cx), cy: Math.round(cy), text };
      }
    }
    return null;
  }
  async function openViewer(query) {
    await open(query);
    await click(TAB('3D 프리뷰'));
    await waitFor(CANVAS, '뷰어 캔버스');
    await frames();
  }
  return { evalJs, waitFor, waitImages, frames, metrics, open, openViewer, click, setSlider, shot, pixelStats, facts, bodyText,
    binRequests, hover, sweep, mouse, rect, send, log, BTN, TAB, TID, CANVAS, SECTION };
}

// 선택된 버튼의 배경이 cs-info-bg(#f2f8fd = 242, 248, 253)인가. pressed 항목은 '이름 rgb(...)' 꼴이다
function hasInfoBg(pressed, name) {
  const item = pressed.find((x) => x.startsWith(`${name} rgb`));
  const m = item?.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/);
  return !!m && m[1] === '242' && m[2] === '248' && m[3] === '253' && (m[4] === undefined || Number(m[4]) === 1);
}

// 읽기 창의 'X 2.012 m' 줄에서 숫자를 뽑는다
function coord(text, axis) {
  const m = text.match(new RegExp(`${axis} (-?[0-9.]+) m`));
  return m ? Number(m[1]) : NaN;
}

async function runMain() {
  const chrome = await launch([]);
  const d = driver(chrome);
  try {
    await d.metrics(W, H, 1);
    const probe = await d.evalJs(PROBE);
    console.log(JSON.stringify({ probe }));
    if (!probe.withCaveatFlag) {
      console.log('이 Chrome 은 하드웨어 WebGL2 를 주지 않습니다(withCaveatFlag = false). 뷰어가 바로 뜨지 않으므로 장면 1~8·10·11 을 캡처하지 못했습니다.');
      process.exitCode = 2;
      return;
    }

    // ---- 장면 1: 기본(등각, x1, 검정). 로딩 틀도 검정인지 보려고 .bin 응답을 1.5초 늦춘다
    await fetch(`${BASE}/__harness/delay?ms=1500`);
    await d.open('?scene=floor');
    const before = d.binRequests();
    await d.click(d.TAB('3D 프리뷰'));
    await d.waitFor(d.TID('points3d-loading'), '로딩 틀');
    const loadingShot = await d.shot('01a-loading.png', d.TID('points3d-loading'));
    const loadingBg = await d.evalJs(`getComputedStyle(${d.TID('points3d-loading')}).backgroundColor`);
    const loadingText = await d.evalJs(`${d.TID('points3d-loading')}.innerText`);
    record('1a 로딩 틀', loadingShot.file, { loadingBg, loadingText: loadingText.trim() }, {
      '로딩 틀 배경이 검정': loadingBg === 'rgb(0, 0, 0)',
      '문구 M9': loadingText.includes('3D 점군 데이터를 불러오는 중입니다.'),
    });
    await d.waitFor(d.CANVAS, '뷰어 캔버스');
    await fetch(`${BASE}/__harness/delay?ms=0`);
    await d.frames();
    await d.shot('01-default-page.png');
    const s1 = await d.shot('01-default.png', d.TID('points3d-viewport'));
    const f1 = await d.facts();
    const p1 = await d.pixelStats(s1, 'dark');
    record('1 기본', s1.file, { ...f1, pixels: p1, binRequests: d.binRequests() - before }, {
      '뷰어 영역 배경이 검정': f1.viewportBg === 'rgb(0, 0, 0)',
      '범례 4항목': JSON.stringify(f1.legend) === JSON.stringify(['FLAT', 'DEPRESSION', 'PROTRUSION', '편차 없음']),
      'HUD': f1.hud === `축 비율 1:1 · 임계값 ±7 mm · ${N_POINTS_TEXT}`,
      '조작 안내': f1.hint === '드래그 회전 · Ctrl+휠 확대',
      '초록이 가장 많다': p1.flat > 10 * (p1.dep + p1.pro) && p1.flat > 0,
      '노랑(함몰)이 보인다': p1.dep > 0,
      '빨강(융기)이 보인다': p1.pro > 0,
      '회색(편차 없음)이 보인다': p1.none > 0,
      '4:3': Math.abs(f1.canvas.clientWidth / f1.canvas.clientHeight - 4 / 3) < 0.01,
      '축 숫자 라벨이 있다': f1.labels > 0,
    });

    // ---- 장면 2: 편차 과장 x50, x100
    for (const k of [50, 100]) {
      await d.click(d.BTN(`×${k}`));
      const s = await d.shot(`02-exag-x${k}.png`, d.TID('points3d-viewport'));
      const f = await d.facts();
      record(`2 과장 ×${k}`, s.file, { hud: f.hud, pressed: f.pressed }, {
        'HUD': f.hud === `편차 ×${k} 과장 · 임계값 ±7 mm · ${N_POINTS_TEXT}`,
        // cs-info-bg = #f2f8fd. aria-pressed: variant 가 실제 CSS 로 생성돼 bg-transparent 를 이겼는지
        '선택 배경(cs-info-bg)': hasInfoBg(f.pressed, `×${k}`),
      });
    }
    // 정면에서 보면 과장이 높이로 드러난다. x1 과 x100 을 나란히 남긴다
    await d.click(d.BTN('×1'));
    await d.click(d.BTN('정면'));
    const s2f1 = await d.shot('02-front-x1.png', d.TID('points3d-viewport'));
    const p2f1 = await d.pixelStats(s2f1, 'dark');
    await d.click(d.BTN('×100'));
    const s2f100 = await d.shot('02-front-x100.png', d.TID('points3d-viewport'));
    const p2f100 = await d.pixelStats(s2f100, 'dark');
    record('2 과장 정면 ×1 대 ×100', s2f100.file, { x1: p2f1, x100: p2f100 }, {
      // 함몰 10mm 는 x100 에서 1m 아래로 내려가 세로로 펼쳐진다. 편차 없는 상판(회색)은 제자리다
      '노랑이 세로로 펼쳐진다(픽셀 2배 이상)': p2f100.dep >= 2 * p2f1.dep && p2f1.dep > 0,
      '회색(편차 없는 점)은 그대로': Math.abs(p2f100.none - p2f1.none) <= Math.max(4, 0.1 * p2f1.none),
    });
    await d.click(d.BTN('×1'));
    await d.click(d.BTN('등각'));

    // ---- 장면 3: 임계값 2mm, 20mm
    await d.setSlider(20);
    const s3a = await d.shot('03-threshold-2mm.png', d.TID('points3d-viewport'));
    const f3a = await d.facts();
    const p3a = await d.pixelStats(s3a, 'dark');
    record('3 임계값 2mm', s3a.file, { hud: f3a.hud, notice: f3a.notice, slider: f3a.slider, pixels: p3a }, {
      'HUD': f3a.hud === `축 비율 1:1 · 임계값 ±2 mm · ${N_POINTS_TEXT}`,
      '고지 문구 숫자': f3a.notice.includes('±2mm 이내'),
      'aria-valuetext': f3a.slider.valueText === '±2 mm',
      '노랑·빨강이 7mm 때보다 넓다': p3a.dep > p1.dep && p3a.pro > p1.pro,
    });
    await d.setSlider(200);
    const s3b = await d.shot('03-threshold-20mm.png', d.TID('points3d-viewport'));
    const f3b = await d.facts();
    const p3b = await d.pixelStats(s3b, 'dark');
    record('3 임계값 20mm', s3b.file, { hud: f3b.hud, notice: f3b.notice, pixels: p3b }, {
      'HUD': f3b.hud === `축 비율 1:1 · 임계값 ±20 mm · ${N_POINTS_TEXT}`,
      '고지 문구 숫자': f3b.notice.includes('±20mm 이내'),
      // 함몰 10mm, 융기 12mm 는 둘 다 20mm 보다 작다
      '노랑·빨강이 없다': p3b.dep === 0 && p3b.pro === 0,
    });
    await d.setSlider(70);

    // ---- 장면 4: 평면, 정면
    await d.click(d.BTN('평면'));
    const s4a = await d.shot('04-top.png', d.TID('points3d-viewport'));
    const p4a = await d.pixelStats(s4a, 'dark');
    // 평면 시점의 방향: 화면 중앙에서 오른쪽 100px 은 +x, 위 100px 은 +y 여야 한다(축 전치·뒤집힘 확인)
    const r4 = await d.rect(d.CANVAS);
    const right = await d.hover(r4.w / 2 + 100, r4.h / 2);
    const above = await d.hover(r4.w / 2, r4.h / 2 - 100);
    await d.mouse('mouseMoved', 5, 5);
    record('4 평면', s4a.file, { pixels: p4a, right, above }, {
      '점이 보인다': p4a.flat > 0,
      '오른쪽이 +x': !!right && coord(right, 'X') - 3 > 0.5 && Math.abs(coord(right, 'Y') - 3) < 0.3,
      '위가 +y': !!above && coord(above, 'Y') - 3 > 0.5 && Math.abs(coord(above, 'X') - 3) < 0.3,
    });
    await d.click(d.BTN('정면'));
    const s4b = await d.shot('04-front.png', d.TID('points3d-viewport'));
    const p4b = await d.pixelStats(s4b, 'dark');
    record('4 정면', s4b.file, { pixels: p4b }, { '바닥이 평면 시점보다 얇다': p4b.flat > 0 && p4b.flat < p4a.flat / 3 });

    // ---- 장면 6: 읽기 창(평면에서 평탄 점과 함몰 점, 정면에서 상판의 편차 없는 점)
    await d.click(d.BTN('평면'));
    const rc = await d.rect(d.CANVAS);
    const flatText = await d.hover(rc.w / 2, rc.h / 2);
    const s6a = await d.shot('06-readout-flat.png', d.TID('points3d-viewport'));
    record('6 읽기 창(평탄)', s6a.file, { text: flatText }, {
      '5줄': !!flatText && flatText.trim().split('\n').length === 5,
      '소수 3자리 좌표': !!flatText && /^X -?\d+\.\d{3} m\nY -?\d+\.\d{3} m\nZ -?\d+\.\d{3} m\n/.test(flatText.trim()),
      '분류 FLAT': !!flatText && flatText.trim().endsWith('FLAT'),
      // 평면 시점의 화면 중앙은 바닥 중앙 (3, 3) 부근이다
      '좌표가 바닥 중앙': !!flatText && Math.abs(coord(flatText, 'X') - 3) < 0.3 && Math.abs(coord(flatText, 'Y') - 3) < 0.3,
    });
    // 평면 시점: 오른쪽이 +x, 위가 +y 이므로 함몰 (2, 2) 은 화면 중앙의 왼쪽 아래에 있다
    const dep = await d.sweep({ x0: 0, x1: 0.5, y0: 0.5, y1: 1 }, (t) => t.includes('DEPRESSION'));
    const s6b = await d.shot('06-readout-depression.png', d.TID('points3d-viewport'));
    record('6 읽기 창(함몰)', s6b.file, dep ?? { text: null }, {
      '왼쪽 아래에서 DEPRESSION 을 찾았다(평면: 오른쪽 +x, 위 +y)': !!dep,
      '음수 부호가 U+2212': !!dep && /편차 \u2212\d+\.\d mm/.test(dep.text),
      '좌표가 함몰 중심에서 0.3m 이내': !!dep && Math.hypot(coord(dep.text, 'X') - DEP_CENTER[0], coord(dep.text, 'Y') - DEP_CENTER[1]) <= 0.3,
    });
    await d.click(d.BTN('정면'));
    const top = await d.sweep({ x0: 0.4, x1: 1, y0: 0, y1: 1 }, (t) => t.includes('편차 없음'));
    const s6c = await d.shot('06-readout-none.png', d.TID('points3d-viewport'));
    record('6 읽기 창(편차 없음)', s6c.file, top ?? { text: null }, {
      '편차 없는 점을 찾았다': !!top,
      '4줄이고 마지막 줄이 편차 없음': !!top && top.text.trim().split('\n').length === 4 && top.text.trim().endsWith('편차 없음'),
      '상판 좌표': !!top && coord(top.text, 'X') >= TOP_X[0] && coord(top.text, 'X') <= TOP_X[1]
        && coord(top.text, 'Y') >= TOP_Y[0] && coord(top.text, 'Y') <= TOP_Y[1] && Math.abs(coord(top.text, 'Z') - TOP_Z) < 0.002,
    });
    await d.click(d.BTN('등각'));

    // ---- 장면 5: 밝은 배경
    await d.click(d.BTN('밝은 배경'));
    const s5 = await d.shot('05-light.png', d.TID('points3d-viewport'));
    const f5 = await d.facts();
    const p5 = await d.pixelStats(s5, 'light');
    record('5 밝은 배경', s5.file, { viewportBg: f5.viewportBg, pressed: f5.pressed, pixels: p5 }, {
      '뷰어 영역 배경이 흰색': f5.viewportBg === 'rgb(255, 255, 255)',
      '진한 3색과 회색': p5.flat > 0 && p5.dep > 0 && p5.pro > 0 && p5.none > 0,
      '선택 배경(cs-info-bg)': hasInfoBg(f5.pressed, '밝은 배경'),
    });
    await d.shot('05-light-page.png');
    await d.click(d.BTN('밝은 배경'));

    // ---- 장면 7: 탭 왕복 10회
    for (let i = 0; i < 10; i++) {
      await d.click(d.TAB('히트맵'));
      await d.click(d.TAB('3D 프리뷰'));
      await d.waitFor(d.CANVAS, `탭 왕복 ${i + 1}회째 캔버스`);
    }
    await d.frames();
    const s7 = await d.shot('07-after-10-roundtrips.png', d.TID('points3d-viewport'));
    const p7 = await d.pixelStats(s7, 'dark');
    record('7 탭 왕복 10회', s7.file, { binRequests: d.binRequests() - before, console: d.log.console, pixels: p7 }, {
      'points3d.bin 요청 1회': d.binRequests() - before === 1,
      '콘솔 경고·오류 0': d.log.console.length === 0,
      '왕복 뒤에도 점이 그려진다': p7.flat > 0,
    });

    // ---- 장면 8: 휠
    await d.evalJs(`window.__wheel = []; window.addEventListener('wheel', (e) => window.__wheel.push({ ctrl: e.ctrlKey, prevented: e.defaultPrevented }))`);
    const r8 = await d.rect(d.CANVAS);
    const wx = r8.x + r8.w / 2, wy = r8.y + r8.h / 2;
    const labelsOf = () => d.evalJs(`${d.TID('points3d-labels')}.innerHTML`);
    const f8a = await d.facts(); const l8a = await labelsOf();
    await d.mouse('mouseMoved', wx, wy);
    await d.mouse('mouseWheel', wx, wy, { deltaX: 0, deltaY: 240 });
    await sleep(500); await d.frames();
    const f8b = await d.facts(); const l8b = await labelsOf();
    await d.shot('08-after-plain-wheel.png');
    await d.evalJs('window.scrollTo(0, 0)'); await sleep(200);
    const r8c = await d.rect(d.CANVAS);
    await d.mouse('mouseMoved', r8c.x + r8c.w / 2, r8c.y + r8c.h / 2);
    await d.mouse('mouseWheel', r8c.x + r8c.w / 2, r8c.y + r8c.h / 2, { deltaX: 0, deltaY: -240, modifiers: 2 }); // 2 = Ctrl
    await sleep(500); await d.frames();
    const f8c = await d.facts(); const l8c = await labelsOf();
    const wheel = await d.evalJs('window.__wheel');
    const s8 = await d.shot('08-after-ctrl-wheel.png', d.TID('points3d-viewport'));
    record('8 휠', s8.file, { wheel, scrollY: [f8a.scrollY, f8b.scrollY, f8c.scrollY], dpr: [f8a.dpr, f8c.dpr], vvScale: [f8a.vvScale, f8c.vvScale] }, {
      '일반 휠: 페이지가 스크롤된다': f8b.scrollY > f8a.scrollY,
      '일반 휠: preventDefault 안 함': wheel.length === 2 && wheel[0].ctrl === false && wheel[0].prevented === false,
      '일반 휠: 카메라 불변(축 라벨 위치 같음)': l8a === l8b,
      'Ctrl+휠: preventDefault 가 실제로 먹음': wheel.length === 2 && wheel[1].ctrl === true && wheel[1].prevented === true,
      'Ctrl+휠: 페이지 스크롤 없음': f8c.scrollY === 0,
      'Ctrl+휠: 뷰어가 줌(축 라벨 위치 바뀜)': l8c !== l8a,
      'Ctrl+휠: 페이지 배율 불변': f8c.dpr === f8a.dpr && f8c.vvScale === f8a.vvScale,
    });

    // ---- 장면 9: 대체 화면(점 파일 없음, 벽면, 임포트, fetch 실패)
    const alt = [
      ['nodata', '9 점 파일 없음', '이 분석에는 3D 점군 데이터가 없습니다. 재분석하면 생성됩니다.'],
      ['wall', '9 벽면', '벽면 분석은 3D 프리뷰 이미지와 3D 점군 뷰를 제공하지 않습니다.'],
      ['import', '9 임포트', '외부 결과(임포트)에는 3D 점군 데이터를 생성하지 않습니다.'],
    ];
    for (const [scene, title, msg] of alt) {
      await d.open(`?scene=${scene}`);
      const b0 = d.binRequests();
      await d.click(d.TAB('3D 프리뷰'));
      await sleep(800); await d.waitImages(); await d.frames();
      const s = await d.shot(`09-${scene}.png`, d.SECTION, true);
      const f = await d.facts(); const text = await d.bodyText();
      record(title, s.file, { images: f.images, alerts: f.alerts, buttons: f.buttons, binRequests: d.binRequests() - b0 }, {
        '안내 문구': text.includes(msg),
        '캔버스 없음': f.canvas === null,
        'Alert·버튼 없음': f.alerts.length === 0 && f.buttons.length === 0,
        '점 파일을 받지 않는다': d.binRequests() - b0 === 0,
        ...(scene === 'wall' ? { '이미지 없음': f.images.length === 0 }
          : { 'PNG 2장과 캡션 M10': f.images.length === 2 && !f.images.some((i) => i.includes('깨짐')) && text.includes('엔진이 생성한 정적 3D 프리뷰 이미지입니다. 높이 축은 편차(mm)이며 실제 축 비율이 아닙니다.') }),
        ...(scene === 'import' ? { '재분석을 권하지 않는다': !text.includes('재분석하면 생성됩니다') } : {}),
      });
    }
    await d.open('?scene=fetchfail');
    const b9 = d.binRequests();
    await d.click(d.TAB('3D 프리뷰'));
    await d.waitFor(`${d.SECTION}.querySelector('[data-alert="error"]')`, 'fetch 실패 Alert');
    await d.waitImages();
    const s9 = await d.shot('09-fetchfail.png', d.SECTION, true);
    const f9 = await d.facts();
    const n9 = d.binRequests() - b9;
    await d.click(d.BTN('다시 시도'));
    await sleep(800);
    record('9 fetch 실패', s9.file, { images: f9.images, alerts: f9.alerts, buttons: f9.buttons, binRequests: [n9, d.binRequests() - b9] }, {
      'Alert(error) M5': f9.alerts.some((a) => a.startsWith('error: 3D 점군 데이터를 저장소에서 불러오지 못했습니다.')),
      '다시 시도 버튼': f9.buttons.includes('다시 시도'),
      'PNG 2장': f9.images.length === 2 && !f9.images.some((i) => i.includes('깨짐')),
      '캔버스 없음': f9.canvas === null,
      '다시 시도로 요청이 한 번 더 나간다': n9 === 1 && d.binRequests() - b9 === 2,
    });

    // ---- 장면 11: 배율 2. 평면 시점에서 점이 덮는 비율을 배율 1 과 비교한다
    await d.metrics(W, H, 1);
    await d.openViewer('?scene=floor');
    await d.click(d.BTN('평면'));
    const s11a = await d.shot('11-dpr1-top.png', d.TID('points3d-viewport'));
    const p11a = await d.pixelStats(s11a, 'dark');
    const f11a = await d.facts();
    await d.metrics(W, H, 2);
    await d.openViewer('?scene=floor');
    await d.click(d.BTN('평면'));
    const s11b = await d.shot('11-dpr2-top.png', d.TID('points3d-viewport'));
    const p11b = await d.pixelStats(s11b, 'dark');
    const f11b = await d.facts();
    await d.click(d.BTN('등각'));
    await d.shot('11-dpr2-iso.png', d.TID('points3d-viewport'));
    const ratio = +(p11b.litFraction / p11a.litFraction).toFixed(3);
    record('11 배율 2', s11b.file, { dpr1: { canvas: f11a.canvas, lit: p11a.litFraction }, dpr2: { canvas: f11b.canvas, lit: p11b.litFraction, dpr: f11b.dpr }, ratio }, {
      '드로잉 버퍼가 2배': f11b.dpr === 2 && f11b.canvas.width === Math.round(f11b.canvas.clientWidth * 2) && f11b.canvas.height === Math.round(f11b.canvas.clientHeight * 2),
      // 점 지름이 CSS 크기로 같으면 덮는 비율이 같다. 최소 크기를 배율에 맞추지 않으면 약 1/4 로 준다
      '점이 덮는 비율이 배율 1 과 같다(0.75~1.33)': ratio >= 0.75 && ratio <= 1.33,
    });

    // ---- 장면 10: 375px 폭
    await d.metrics(375, 1000, 1);
    await d.openViewer('?scene=floor');
    const f10 = await d.facts();
    const vp10 = await d.rect(d.TID('points3d-viewport'));
    const ctl10 = await d.evalJs(`(() => { const b = (n) => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === n).getBoundingClientRect(); const a = b('등각'), z = b('밝은 배경'); return { firstTop: a.top, lastBottom: z.bottom, lastRight: z.right }; })()`);
    // 좁은 폭에서 왼쪽 아래 HUD 와 오른쪽 아래 조작 안내의 글자가 서로 겹치는지
    const overlap10 = await d.evalJs(`(() => { const a = ${d.TID('points3d-hud')}.getBoundingClientRect(), b = ${d.TID('points3d-hint')}.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; })()`);
    // 탭 본문(탭 줄 + 뷰어 + 컨트롤 줄 + 고지 문구)만 자른다
    const s10 = await d.shot('10-width-375.png', d.SECTION);
    record('10 375px 폭', s10.file, { canvas: f10.canvas, viewport: vp10, controls: ctl10, overflowX: f10.overflowX, hudHintOverlap: overlap10 }, {
      'HUD 와 조작 안내가 겹치지 않는다': overlap10 === false,
      '가로 넘침 없음': f10.overflowX <= 0,
      '뷰어가 화면 폭 안': vp10.w <= 375 && vp10.w > 200,
      '4:3 유지': Math.abs(vp10.w / vp10.h - 4 / 3) < 0.02,
      '컨트롤 줄이 여러 줄로 접힌다': ctl10.lastBottom - ctl10.firstTop > 40 && ctl10.lastRight <= 375,
    });
  } finally {
    chrome.close();
  }
}

async function runSoftware() {
  const chrome = await launch(['--disable-gpu']);
  const d = driver(chrome);
  try {
    await d.metrics(W, H, 1);
    const probe = await d.evalJs(PROBE);
    console.log(JSON.stringify({ probe }));
    if (!probe.webgl2 || probe.withCaveatFlag) {
      console.log('이 Chrome 은 --disable-gpu 에서 소프트웨어 렌더 상태(webgl2 = true, withCaveatFlag = false)가 되지 않습니다. 장면을 캡처하지 못했습니다.');
      process.exitCode = 2;
      return;
    }
    await d.open('?scene=floor');
    const b0 = d.binRequests();
    await d.click(d.TAB('3D 프리뷰'));
    await d.waitFor(d.BTN('3D로 보기'), '3D로 보기 버튼');
    await d.waitImages();
    const s = await d.shot('09-software-prompt.png', d.SECTION, true);
    const f = await d.facts();
    record('9 소프트웨어 렌더(선택 전)', s.file, { images: f.images, alerts: f.alerts, buttons: f.buttons, binRequests: d.binRequests() - b0 }, {
      'Alert(info) M4': f.alerts.some((a) => a.startsWith('info: 이 기기는 그래픽 가속을 사용할 수 없어 3D 점군 뷰가 느릴 수 있습니다.')),
      '3D로 보기 버튼': f.buttons.includes('3D로 보기'),
      'PNG 2장': f.images.length === 2,
      '캔버스 없음': f.canvas === null,
      '선택 전에는 점 파일을 받지 않는다': d.binRequests() - b0 === 0,
    });
    await d.click(d.BTN('3D로 보기'));
    await d.waitFor(d.CANVAS, '뷰어 캔버스', 30000);
    await sleep(1500); await d.frames();
    const s2 = await d.shot('09-software-viewer.png', d.TID('points3d-viewport'));
    const p2 = await d.pixelStats(s2, 'dark');
    // 탭을 왕복해도 다시 누르지 않고 뷰어가 뜬다
    await d.click(d.TAB('히트맵'));
    await d.click(d.TAB('3D 프리뷰'));
    await d.waitFor(d.CANVAS, '탭 왕복 뒤 캔버스', 30000);
    const f3 = await d.facts();
    record('9 소프트웨어 렌더(3D로 보기)', s2.file, { pixels: p2, binRequests: d.binRequests() - b0, buttons: f3.buttons }, {
      '소프트웨어 렌더로도 점이 그려진다': p2.flat > 0,
      '점 파일 요청 1회': d.binRequests() - b0 === 1,
      '탭 왕복 뒤 버튼을 다시 누르지 않아도 뷰어': f3.canvas !== null && !f3.buttons.includes('3D로 보기'),
    });
  } finally {
    chrome.close();
  }
}

async function runArtboard() {
  const arg = process.argv[3] ?? 'ScanDone3D.dc.html';
  const file = (path.isAbsolute(arg) ? arg : path.join(ARTBOARD_DIR, arg)).split(path.sep).join('/');
  const chrome = await launch([]);
  const d = driver(chrome);
  try {
    // 아트보드 프레임은 1440px 고정 폭이다. support.js 404 는 정상이다(저장소에 없다).
    // 본문 안의 Google Fonts 스타일시트가 늦으면 그 뒤 마크업이 그려지지 않으므로 글꼴 요청을 막는다(대체 글꼴로 그려진다)
    await d.metrics(1440, 900, 1);
    await d.send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
    await d.send('Page.navigate', { url: `file:///${file}` });
    await d.waitFor(`document.querySelector('x-dc > div')`, '아트보드 마크업');
    await d.frames();
    fs.mkdirSync(SHOTS, { recursive: true });
    const s = await d.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const out = path.join(SHOTS, `artboard-${path.basename(file).replace('.dc.html', '')}.png`);
    fs.writeFileSync(out, Buffer.from(s.result.data, 'base64'));
    console.log(JSON.stringify({ artboard: out }));
  } finally {
    chrome.close();
  }
}

try {
  if (MODE === 'main') await runMain();
  else if (MODE === 'software') await runSoftware();
  else if (MODE === 'artboard') await runArtboard();
  else throw new Error(`알 수 없는 모드: ${MODE}`);
} catch (e) {
  console.log(JSON.stringify({ error: String(e?.stack ?? e) }));
  process.exitCode = 1;
}
// 장면별 기록을 파일로도 남긴다(보고에 옮겨 적을 때 쓴다)
if (results.length > 0) {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, `capture-${MODE}.json`), JSON.stringify(results, null, 2));
}
console.log(`\n장면 ${results.length}개 기록, 자동 확인 실패 ${failed.length}건`);
for (const f of failed) console.log(`  실패: ${f}`);
if (failed.length > 0 && !process.exitCode) process.exitCode = 3;
```

자동 확인이 죽이는 변이(계획 작성 중 모의 뷰어에 변이를 넣어 실제로 죽는 것을 본 것은 ★):

| 확인 | 죽이는 변이 |
|---|---|
| 1 `HUD`, 3 `HUD`·`고지 문구 숫자`·`aria-valuetext` | HUD 형식 변경, 슬라이더 값이 HUD·고지 문구에 안 흐름, `aria-valuetext` 누락 |
| 1 `노랑·빨강·회색이 보인다`, 3 `노랑·빨강이 없다` | 분류 경계 뒤집힘(`>` 대 `>=` 는 경계값 점이 거의 없어 못 잡는다. 그건 vitest 골든이 잡는다), 센티널을 DEPRESSION 으로 그림, 임계값 uniform 미갱신 |
| 2 `선택 배경(cs-info-bg)` ★ | 선택 배경을 `bg-cs-info-bg` 덧붙이기로 바꿈(`.bg-transparent` 가 이긴다) |
| 2 `회색은 그대로` | 과장을 편차가 아니라 z 전체에 적용 |
| 4 `오른쪽이 +x`·`위가 +y`, 6 `좌표가 함몰 중심` | 축 전치·뒤집힘, `absoluteOf` 가 `origin_m` 을 안 더함 |
| 6 `음수 부호가 U+2212`, `4줄` | 읽기 창 음수를 ASCII `-` 로, 센티널에 편차 줄 표시 |
| 7 `points3d.bin 요청 1회` | 마운트 때 fetch, 탭 왕복마다 fetch, StrictMode 이중 effect 에서 두 번 fetch |
| 8 `Ctrl+휠: preventDefault 가 실제로 먹음` ★ | 휠을 JSX `onWheel` 로 옮김(passive 라 `preventDefault` 가 무시된다) |
| 8 `일반 휠: 페이지가 스크롤된다`·`카메라 불변` | Ctrl 없이도 휠 줌, 항상 `preventDefault` |
| 9 `점 파일을 받지 않는다`, 소프트웨어 `선택 전에는 받지 않는다` | 뷰어 대상 아닌 분석에서 fetch, 소프트웨어 렌더에서 선택 전 fetch |
| 11 `점이 덮는 비율` ★ | 점 최소 크기를 배율에 맞추지 않음(0.633 으로 떨어져 죽었다) |
| 11 `드로잉 버퍼가 2배` | 드로잉 버퍼를 CSS 크기로 둠 |

- [ ] **Step 3: 엔진 전체 스위트**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONIOENCODING=utf-8 PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q 2>&1 | tail -5
```

Expected: `<N> passed, 2 deselected in ...`(실패 0). `N` 은 기준선 244 에 Task 1~6 이 더한 테스트 수를 합한 값이다: test_pointsample(T1 18 + T2 19), test_points3d(T3 83 + T6 1), test_pipeline(T4 7), test_summary(T5 1). 계획대로면 244 + 129 = 373. `deselected` 는 perf 테스트 2건(T4 가 300만 점 perf 1건을 더해 기준선 1 → 2). `N` 과 소요 시간을 적는다. 실패가 있으면 실패 출력 전체를 기록하고 **고치지 않는다.** 해당 태스크(테스트 파일 이름으로 안다)로 돌아가 거기서 고친 뒤 이 태스크를 처음부터 다시 한다.

- [ ] **Step 4: 워커 전체 스위트**

Run:

```bash
cd D:/Projects/Flatness/worker && PYTHONIOENCODING=utf-8 PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -q 2>&1 | tail -5
```

Expected: `209 passed, 2 deselected in ...`(워커 테스트 수는 유지. Task 5 가 `test_report_labels.py` 의 개수 단언만 12 → 13 으로 바꿨다). `test_jobs.py`·`test_e2e_fake.py` 가 `analyze_floor` 를 실제로 돌리므로 `points3d.bin` 업로드 경로를 함께 지난다.

- [ ] **Step 5: 대시보드 vitest, tsc, next build, 추적 파일 확인**

Run:

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run 2>&1 | tail -8
```

Expected: `Test Files  <F> passed (<F>)`, `Tests  <T> passed (<T>)`, 실패 0. 기준선 84파일 769건에 Task 5 의 labels.test.ts 1건, Task 14 가 기존 analysis-result.test.tsx 에 더한 20건, Task 6~14 가 더한 파일 11개의 건수를 합한 값이다. 11개 파일과 건수: points3d.test.ts(T6 107 + T7 105), mat4·orbit.test.ts(T8 15 + 41), scaffold·budget.test.ts(T9 40 + 16), pick·controls.test.ts(T10 44), gl-renderer.test.ts(T11 48), points3d-view.test.tsx(T12 69), preview3d-tab.test.tsx(T13 49), points3d-litmus.test.ts(T14 3). 계획대로면 `F` = 95, `T` = 769 + 1 + 20 + 537 = 1327. stderr 에 여러 번(기준선에서도 60회 안팎) 찍히는 `Not implemented: HTMLCanvasElement's getContext()` 줄은 jsdom 의 기존 메시지(heatmap-view 등 기존 2D 캔버스 뷰의 테스트가 낸다)라 실패가 아니며, 새로 더한 11개 파일을 단독으로 돌리면 이 줄이 0회여야 한다(아래 명령. 전부 `getContext` 를 스파이로 가로챈다). `F`·`T` 를 적는다.

Run(새 파일 11개만. 위 명령과 같은 jsdom 메시지가 새 테스트에서 나오지 않는지):

```bash
cd D:/Projects/Flatness/dashboard && npx vitest run lib/domain/__tests__/points3d.test.ts lib/viz/points3d components/analysis/__tests__/points3d-view.test.tsx components/analysis/__tests__/preview3d-tab.test.tsx __tests__/points3d-litmus.test.ts > <H>/vitest-new11.log 2>&1; tail -5 <H>/vitest-new11.log; echo "getContext 메시지 $(grep -c "Not implemented: HTMLCanvasElement" <H>/vitest-new11.log)회"
```

Expected: `Test Files  11 passed (11)`, `Tests  537 passed (537)`(계획대로일 때. 다르면 그 수를 적는다), `getContext 메시지 0회`. 0 이 아니면 어느 새 테스트가 `getContext` 스파이 없이 캔버스를 마운트한 것이다. 해당 파일을 단독으로 돌려 찾아 기록하고 그 태스크로 돌아간다(이 줄 자체는 실패가 아니지만 T13·T14 초안이 "이 파일에서는 나오지 않는다"를 기대값으로 적었고, T11·T12 의 테스트도 전부 `getContext` 를 스텁으로 끼운다).

Run:

```bash
cd D:/Projects/Flatness/dashboard && npx tsc --noEmit; echo "tsc exit=$?"
```

Expected: 아무 오류 출력 없이 `tsc exit=0`.

Run:

```bash
cd D:/Projects/Flatness/dashboard && npx next build 2>&1 | tail -30; echo "build exit=${PIPESTATUS[0]}"
```

Expected: `✓ Compiled successfully`, `Finished TypeScript`, `✓ Generating static pages`, 라우트 표에 `/scans/[id]` 등 16개, `build exit=0`. ESLint·타입 오류가 있으면 그대로 기록하고 해당 태스크로 돌아간다.

Run:

```bash
cd D:/Projects/Flatness && git status --short
```

Expected: 빈 출력(`.next/`, `tsconfig.tsbuildinfo`, `next-env.d.ts` 는 `dashboard/.gitignore` 에 있다). 무언가 나오면 `git diff --stat` 로 보고, 빌드가 만든 것이면 `git checkout -- <파일>` 로 되돌린 뒤 보고에 적는다.

- [ ] **Step 6: 성능 게이트(3천만 점, 300만 점)**

Run(2~4분. 백그라운드로 돌려도 된다):

```bash
cd D:/Projects/Flatness/engine && PYTHONIOENCODING=utf-8 PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest -m perf -q -s 2>&1 | tail -8
```

Expected: 두 줄의 `[perf] 30M점: <초>s, 피크 RSS 증가 <GiB> GiB, 셀 600 유효 600 coverage 100.0%, points3d.bin <바이트> bytes` 와 `[perf] 3M점: ...`(라벨 문자열은 Task 4 의 출력 양식을 따른다), 마지막 `2 passed, <N> deselected`. 게이트: 두 건 다 300초 미만, 피크 RSS 증가 2GiB 미만, `points3d.bin` 바이트 `<= 8 + 4096 + 8 × 500_000 = 4,004,104`. 참고값(계획 작성 중, 개발 PC): 점 파일이 없는 현재 코드의 기준선은 `30M점: 44.3s, 1.33 GiB`. Task 4 초안의 스크래치 엔진으로는 `30M점: 76.0s, 피크 RSS 증가 1.33 GiB, points3d.bin 4000512 bytes` 와 `3M점: 29.9s, 피크 RSS 증가 0.28 GiB, points3d.bin 3994780 bytes`(다른 작업과 동시에 돌려 시간은 부풀었을 수 있다. 조사 시제품은 3번째 패스에 +3.5초였다, 스펙 §11). 시간이 기준선의 두 배를 넘으면 게이트 안이라도 보고에 적는다. 세 수치(초, GiB, 바이트)를 그대로 기록한다.

- [ ] **Step 7: 변이 재확인(기존 격리 테스트가 하중을 잃지 않았는지)**

스펙 §10.5 표 아래 문단: 새 블록을 넣은 뒤에도 기존 세 렌더 블록 중 하나의 try 를 지우는 변이가 `test_floor_render_failure_does_not_lose_judged_result` 를 죽여야 한다.

Run(트리가 깨끗한지 먼저 본다):

```bash
cd D:/Projects/Flatness && git status --short && D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe <H>/mutate_try.py engine/flatness/core/pipeline.py && git diff --stat
```

Expected: 첫 `git status --short` 는 빈 출력, `mutated engine\flatness\core\pipeline.py`, `git diff --stat` 의 마지막 줄 `1 file changed, 1 insertion(+), 4 deletions(-)`(try/except 4줄이 호출 1줄로). `AssertionError: 바꿀 블록을 찾지 못했습니다` 가 나오면 Task 4 가 히트맵 블록을 건드린 것이다. 멈추고 보고한다.

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONIOENCODING=utf-8 PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest "tests/test_pipeline.py::test_floor_render_failure_does_not_lose_judged_result" -q 2>&1 | tail -6
```

Expected: `1 failed`, 본문에 `RuntimeError: 주입된 렌더 실패(디스크/폰트 등 인프라 사유 모사)`(히트맵 try 가 없어져 예외가 `analyze_floor` 밖으로 나온다). 계획 작성 중 현재 코드의 복사본에서 같은 변이로 같은 실패를 확인했다. **통과하면 결함이다**(새 블록이 히트맵 try 를 감싸거나 삼켰다는 뜻). 그대로 기록하고 Task 4 로 돌아간다.

Run(되돌리기):

```bash
cd D:/Projects/Flatness && git checkout -- engine/flatness/core/pipeline.py && git status --short && cd D:/Projects/Flatness/engine && PYTHONIOENCODING=utf-8 PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m pytest tests/test_pipeline.py -q 2>&1 | tail -2
```

Expected: `git status --short` 빈 출력, `test_pipeline.py` 전부 `passed`(되돌린 뒤의 재확인).

- [ ] **Step 8: 합성 스캔 생성과 CLI 분석(산출물)**

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe <H>/make_scan.py <H>
```

Expected: `floor.ply 90682 points, wall.ply 72943 points`.

Run:

```bash
cd D:/Projects/Flatness/engine && PYTHONIOENCODING=utf-8 PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m flatness.cli analyze <H>/floor.ply --units m --criteria floor-kcs-exposed --out <H>/out-floor && PYTHONIOENCODING=utf-8 PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -m flatness.cli analyze <H>/wall.ply --units m --criteria wall-kcs-tilt-other --out <H>/out-wall && ls <H>/out-floor <H>/out-wall
```

Expected: 바닥은 `분석 완료: 셀 36개 (유효 36)`, `  구역 1개 (제외: 유령 0, 가구 0)  바닥 인식률 100.0%`, `  최대 <값>mm @ (<x>, <y>)  기준 ...` 줄의 값이 약 10mm(`cli.py:166-169` 의 출력 양식. 계획 작성 중 형제 초안의 엔진으로 `최대 10.32mm`). 벽면은 `벽 1: ...`·`벽 2: ...` 두 줄에 수직도가 나온다. `out-floor` 에 `cells.json deviation.png heatmap.png points3d.bin preview3d.png preview3d_zoom.png results.csv stats.json`(8개). `out-wall` 에 `cells.json deviation_wall1.png deviation_wall2.png heatmap_wall1.png heatmap_wall2.png results.csv stats.json`(점 파일 없음).

Run(stats 와 점 파일 확인):

```bash
cd D:/Projects/Flatness/engine && PYTHONPATH=D:/Projects/Flatness/engine D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe -c "
import json, pathlib
from flatness.outputs.points3d import read_points3d
h = pathlib.Path(r'<H>')
s = json.loads((h / 'out-floor' / 'stats.json').read_text('utf-8'))
print({k: s.get(k) for k in ['points3d_paths', 'points3d_threshold_q', 'preview3d_paths', 'deviation_paths', 'warnings']})
meta, xyz, dev = read_points3d((h / 'out-floor' / 'points3d.bin').read_bytes())
print(meta['n_points'], meta['extent_m'], meta['fit_bounds'], meta['sampling'])
print('not_floor', int((dev == -32768).sum()), 'no_dev', int((dev == -32767).sum()), 'dep<-70', int(((dev < -70) & (dev > -32767)).sum()), 'pro>70', int((dev > 70).sum()))
w = json.loads((h / 'out-wall' / 'stats.json').read_text('utf-8'))
print('wall keys', 'points3d_paths' in w, 'points3d_threshold_q' in w)
"
```

Expected: `points3d_paths: ['points3d.bin']`, `points3d_threshold_q: 70`, `preview3d_paths: ['preview3d.png', 'preview3d_zoom.png']`, `deviation_paths: ['deviation.png']`. `n_points` 90682, `extent_m` `[6.0, 6.0, 약 0.71]`(상판까지), `fit_bounds` 의 max z 는 약 0.022(편차 있는 점만), `sampling.source_points` 90682, `cap` 500000. `not_floor 81`(상판 9 × 9), `no_dev 0`, `dep<-70` 와 `pro>70` 둘 다 0 보다 크다(계획 작성 중 91 과 135). 벽면은 `wall keys False False`. 다르면 기록하고 Task 2·4 로 돌아간다.

- [ ] **Step 9: 하네스 서버 띄우기와 연기 확인**

백그라운드로 띄운다(Bash 도구의 `run_in_background`, 또는 `( ... > <H>/vite.log 2>&1 & )`):

```bash
cd D:/Projects/Flatness/dashboard && npx vite --config <H>/vite.config.mjs > <H>/vite.log 2>&1
```

Run(몇 초 뒤):

```bash
cat <H>/vite.log; curl -s -o /dev/null -w "%{http_code} index\n" http://127.0.0.1:5199/; curl -s -o /dev/null -w "%{http_code} %{content_type} stats\n" http://127.0.0.1:5199/api/data/artifacts/floor/stats.json; curl -s -o /dev/null -w "%{http_code} %{size_download} bin\n" http://127.0.0.1:5199/api/data/artifacts/floor/points3d.bin; curl -s -o /dev/null -w "%{http_code} nobin\n" http://127.0.0.1:5199/api/data/artifacts/nobin/points3d.bin; curl -s -o /dev/null -w "%{http_code} nobin-png\n" http://127.0.0.1:5199/api/data/artifacts/nobin/preview3d.png; curl -s -o /dev/null -w "%{http_code} traversal\n" "http://127.0.0.1:5199/api/data/artifacts/floor/..%2F..%2Fmain.tsx"
```

Expected: 로그에 `VITE v8.1.5 ready` 와 `Local: http://127.0.0.1:5199/`. `200 index`, `200 application/json; charset=utf-8 stats`, `200 <725000 부근> bin`(8 + json_len + 8 × 90682 = 약 725.5kB), `404 nobin`, `200 nobin-png`, `404 traversal`. 포트가 막혀 있으면 설정의 `port` 를 바꾸고 아래 명령에 `HARNESS_URL=http://127.0.0.1:<포트>` 를 붙인다.

Run(페이지가 실제로 뜨는지. 첫 요청은 의존성 사전 번들 때문에 몇 초 걸린다):

```bash
curl -s http://127.0.0.1:5199/main.tsx | head -12 | cut -c1-160
```

Expected: `import ... from "/@fs/D:/Projects/Flatness/dashboard/components/analysis/analysis-result.tsx"` 처럼 dashboard 소스를 직접 가리키는 import 가 보인다(뷰어 코드는 대체되지 않는다).

- [ ] **Step 10: 캡처 1차: `node capture.mjs main`(장면 1~8, 9 의 4개, 10, 11)**

Run(2~4분. 읽기 창 탐색 2회가 캔버스를 10px 격자로 훑는다):

```bash
cd <H> && node capture.mjs main 2>&1 | tee <H>/capture-main.log | grep -v '^{"scene"'; echo "exit=${PIPESTATUS[0]}"
```

Expected: 첫 줄 `{"probe":{"webgl2":true,"withCaveatFlag":true,"renderer":"ANGLE (NVIDIA, ...)"}}`(기기마다 다르다. `withCaveatFlag` 가 `true` 여야 장면 1~8 이 뷰어로 간다), 마지막 `장면 21개 기록, 자동 확인 실패 0건`, `exit=0`. 장면별 JSON 한 줄씩은 `<H>/capture-main.log` 와 `<H>/shots/capture-main.json` 에 남는다. `exit=1` 이면 `{"error": ...}` 줄에 사유가 있다(`기다리다 시간 초과: 로딩 틀` 은 3D 탭이 뷰어로 바뀌지 않았다는 뜻. `요소 없음` 은 DOM 계약 불일치). `exit=3` 이면 실패 목록이 끝에 있다. 실패한 확인은 해당 장면의 PNG 를 열어 사실인지 본 뒤 기록한다. 캡처 스크립트 자체의 문제로 판단되면 스크립트를 고쳐 다시 돌리고 무엇을 고쳤는지 보고에 적는다(뷰어 코드는 고치지 않는다).

캡처 파일(전부 `<H>/shots/`): `01a-loading.png`, `01-default-page.png`, `01-default.png`, `02-exag-x50.png`, `02-exag-x100.png`, `02-front-x1.png`, `02-front-x100.png`, `03-threshold-2mm.png`, `03-threshold-20mm.png`, `04-top.png`, `04-front.png`, `06-readout-flat.png`, `06-readout-depression.png`, `06-readout-none.png`, `05-light.png`, `05-light-page.png`, `07-after-10-roundtrips.png`, `08-after-plain-wheel.png`, `08-after-ctrl-wheel.png`, `09-nodata.png`, `09-wall.png`, `09-import.png`, `09-fetchfail.png`, `11-dpr1-top.png`, `11-dpr2-top.png`, `11-dpr2-iso.png`, `10-width-375.png`.

- [ ] **Step 11: 캡처 2차: `node capture.mjs software`(장면 9 의 소프트웨어 렌더)**

Run:

```bash
cd <H> && node capture.mjs software 2>&1 | tee <H>/capture-software.log | grep -v '^{"scene"'; echo "exit=${PIPESTATUS[0]}"
```

Expected: `{"probe":{"webgl2":true,"withCaveatFlag":false,"renderer":"ANGLE (Google, Vulkan ... SwiftShader ...)"}}`, `장면 2개 기록, 자동 확인 실패 0건`, `exit=0`. 캡처 `09-software-prompt.png`(PNG 2장 + Alert(info) M4 + `3D로 보기`), `09-software-viewer.png`(선택 뒤 뷰어). `exit=2` 면 이 Chrome 이 `--disable-gpu` 에서도 하드웨어 컨텍스트를 주거나 WebGL2 를 아예 안 주는 것이다. 그러면 이 장면은 **캡처하지 못했다**고 보고하고 근거로 `dashboard/components/analysis/__tests__/preview3d-tab.test.tsx` 의 software_prompt 단언(Step 5 에서 통과)을 적는다.

- [ ] **Step 12: 아트보드·참고 캡처와 나란히 대조하고 장면별 확인 기록을 쓴다**

Run:

```bash
cd <H> && node capture.mjs artboard ScanDone3D.dc.html
```

Expected: `{"artboard":"<H>/shots/artboard-ScanDone3D.png"}`(1440 × 2240 부근, 대체 글꼴).

이제 Read 도구로 세 가지를 연다: (1) `.superpowers/research/3d-pointcloud-viewer/reference-capture.webp`(참고 캡처. Read 가 webp 를 바로 보여 준다), (2) `<H>/shots/artboard-ScanDone3D.png`, (3) `<H>/shots/` 의 캡처들. 아래 표의 "눈으로 볼 것"을 하나씩 확인해 ○/× 와 한 줄 소견을 적는다. 자동 확인(`capture-main.json` 의 `checks`)은 그 옆에 적는다.

| # | 장면 | 캡처 | 눈으로 볼 것(스펙 §10.6 표 + §2.1 D3·D4) | 자동 확인 |
|---|---|---|---|---|
| 1 | 기본 | `01-default.png`, `01-default-page.png`, `01a-loading.png` | 순수 검정 배경. 작은 둥근 점(네모 아님). 초록 바탕에 (2, 2) 부근 함몰부 노랑, (4.2, 3.8) 부근 융기 빨강, 오른쪽 아래쯤 상판의 회색 점. 오른쪽 위 범례 4항목(둥근 표식 + `FLAT`/`DEPRESSION`/`PROTRUSION`/`편차 없음`, 흰 글자). 옅은 격자선과 축 숫자(`x (m)`, `y (m)`). 왼쪽 아래 HUD `축 비율 1:1 · 임계값 ±7 mm · 90,682점`, 오른쪽 아래 `드래그 회전 · Ctrl+휠 확대`. 참고 캡처처럼 낮게 비스듬히 내려다보는 시점(등각 방위 −55°, 고도 20°). 로딩 틀(`01a`)이 검정이고 가운데 흰 칩 안 스피너 + M9. 아트보드(`artboard-ScanDone3D.png`)의 3D 탭 구성(뷰어 영역, 컨트롤 줄 2줄, 고지 문구)과 같은 배치 | 배경, 범례, HUD, 조작 안내, 색 4종, 4:3, 라벨 |
| 2 | 과장 ×50·×100 | `02-exag-x50.png`, `02-exag-x100.png`, `02-front-x1.png`, `02-front-x100.png` | 등각에서 함몰부가 아래로, 융기부가 위로 커지고 바닥의 나머지는 제자리. 정면 ×100 에서 함몰이 바닥 띠 아래로 약 1m, 융기가 위로 약 1.2m 뻗고 상판(회색)은 제자리. HUD `편차 ×50 과장`. 선택된 배율 버튼의 연한 파랑 배경(`cs-info-bg`) | HUD, 선택 배경, 정면 노랑 2배, 회색 불변 |
| 3 | 임계값 2mm·20mm | `03-threshold-2mm.png`, `03-threshold-20mm.png` | 2mm: 노랑·빨강 영역이 7mm 때보다 넓다. 20mm: 전부 초록(상판 회색만). HUD 와 고지 문구의 숫자가 `2`/`20` 으로 바뀜 | HUD, 고지 숫자, aria-valuetext, 픽셀 증감 |
| 4 | 평면·정면 | `04-top.png`, `04-front.png` | 평면: 바닥이 정사각형, 오른쪽이 +x(눈금 0→6 이 왼→오), 위가 +y(0 이 아래). 정면: 바닥이 얇은 띠, 상판이 띠 위에 떠 있음 | 오른쪽 +x, 위 +y(읽기 창 좌표로), 정면 띠 |
| 5 | 밝은 배경 | `05-light.png`, `05-light-page.png` | 흰 배경, 진한 초록·노랑·빨강과 밝은 회색, 격자·글자가 진한 색으로 전환. `밝은 배경` 버튼의 선택 배경 | 배경, 3색+회색, 선택 배경 |
| 6 | 읽기 창 | `06-readout-flat.png`, `06-readout-depression.png`, `06-readout-none.png` | 커서 오른쪽 아래 12px 에 반투명 검정 상자, `X … m / Y … m / Z … m / 편차 … mm / 분류` 5줄(flat: `편차 0.0 mm`, `FLAT`. 함몰: `편차 −9.x mm`(U+2212), `DEPRESSION`). 상판 점은 4줄이고 마지막이 `편차 없음`, Z 0.700 | 줄 수, 소수 3자리, 부호, 좌표 범위 |
| 7 | 탭 왕복 10회 | `07-after-10-roundtrips.png` | 왕복 뒤에도 같은 그림 | `points3d.bin` 요청 1회, 콘솔 경고·오류 0 |
| 8 | 휠 | `08-after-plain-wheel.png`, `08-after-ctrl-wheel.png` | 일반 휠 뒤 페이지가 240px 스크롤돼 뷰어가 위로 올라감(카메라 그대로). Ctrl+휠 뒤 뷰어만 확대(격자 간격이 넓어짐), 페이지는 그대로 | 스크롤, `defaultPrevented` 두 값, 라벨 변화, DPR·visualViewport 불변 |
| 9 | 대체 화면 | `09-nodata.png`, `09-wall.png`, `09-import.png`, `09-fetchfail.png`, `09-software-prompt.png`, `09-software-viewer.png` | nodata: PNG 2장 + 캡션 M10 + `이 분석에는 3D 점군 데이터가 없습니다. 재분석하면 생성됩니다.`(Alert·버튼 없음). wall: M1 한 줄만. import: PNG + M10 + M2, `재분석` 문구 없음. fetchfail: 빨간 Alert M5 + `다시 시도` + PNG. software: PNG + 파란 Alert M4 + `3D로 보기`, 누르면 뷰어 | 문구, 캔버스 없음, 요청 0, 다시 시도 1회 추가, 선택 전 요청 0 |
| 10 | 375px 폭 | `10-width-375.png` | 뷰어(약 255px 폭)와 컨트롤 줄이 세로로 접히고 가로로 넘치지 않음. HUD 가 두 줄로 접히고 조작 안내와 겹치지 않음 | 가로 넘침, 폭, 4:3, 컨트롤 접힘, HUD·안내 겹침 없음 |
| 11 | 배율 2 | `11-dpr1-top.png`(754px), `11-dpr2-top.png`(1508px), `11-dpr2-iso.png` | 배율 2 캡처를 절반으로 줄여 보면 배율 1 과 점 지름·간격이 같다(절반으로 줄지 않는다). 글자·선이 더 선명할 뿐 | 드로잉 버퍼 2배, 덮는 비율 0.75~1.33 |

참고 캡처와 다르게 두기로 한 것(D4)은 "다름"이 맞다: 점 간격이 더 촘촘(실제 스케일), 범례에 `편차 없음` 항목, 왼쪽 아래 HUD. 참고 캡처의 "직선자 검증 상세" 표는 범위 밖(D15).

- [ ] **Step 13: 정리(서버 종료, 추적 파일 무변경 확인, 커밋 없음)**

하네스 서버를 끝낸다(백그라운드 작업이면 그 작업을 멈춘다. 아니면 창을 닫는다). 그 다음:

```bash
cd D:/Projects/Flatness && git status --short && git log --oneline -1 | cat && ls <H>/shots | wc -l
```

Expected: `git status --short` 빈 출력(이 태스크는 추적 파일을 바꾸지 않았다), HEAD 는 Step 1 과 같은 커밋(이 태스크는 커밋을 만들지 않는다), `shots` 에 PNG 30개 부근 + `capture-main.json` + `capture-software.json`.

- [ ] **Step 14: 검증 기록을 최종 보고로 쓴다(커밋하지 않는다)**

아래 양식을 채워 보고에 싣는다. 숫자는 전부 실제 출력에서 옮긴다. 못 한 것은 못 했다고 적는다.

```
## Task 16 검증 기록 (<날짜>, 브랜치 feat/pointcloud-viewer, HEAD <해시>)

### 1. 스위트
- engine:    <N> passed, 2 deselected (<초>s)   [기준선 244 passed, 1 deselected. N 에는 T1 18 · T2 19 · T3 83 · T4 7 · T5 1(test_summary) · T6 1 이 든다. 계획대로면 373]
- worker:    209 passed, 2 deselected (<초>s)   [기준선 209]
- dashboard: <F> files / <T> tests passed (<초>s) [기준선 84 / 769. T 에는 T5 의 labels.test.ts 1건, T14 의 analysis-result.test.tsx 20건, 새 파일 11개 537건이 든다. 계획대로면 95 / 1327]
- 새 파일 11개 단독: 11 files / <T11> tests, jsdom getContext 메시지 <n>회  [계획대로면 537 / 0회]
- tsc --noEmit: exit 0
- next build: exit 0 (라우트 16개). 빌드 뒤 git status --short: (빈 출력)

### 2. 성능 게이트 (-m perf, 개발 PC <CPU/GPU>)
- 30M점: <초>s, 피크 RSS 증가 <GiB> GiB, points3d.bin <바이트> bytes  (게이트 300s / 2GiB / 4,004,104)
- 3M점:  <초>s, 피크 RSS 증가 <GiB> GiB, points3d.bin <바이트> bytes
- 점 파일 없는 기준선(현재 main): 30M점 44.3s, 1.33 GiB

### 3. 변이 재확인(§10.5 표 아래)
- 히트맵 try 제거 → test_floor_render_failure_does_not_lose_judged_result: FAILED (RuntimeError 주입된 렌더 실패) → git checkout 뒤 git status 빈 출력

### 4. 하네스 산출물
- <H>/out-floor: points3d.bin <바이트> bytes, n_points 90682, threshold_q 70, not_floor 81, dep<-70 <n>, pro>70 <n>
- <H>/out-wall: points3d_paths 키 없음

### 5. 화면 캡처 대조(§10.6 표 11장면)
| # | 장면 | 캡처 | 확인 | 소견 |
| 1 | 기본 | 01-default.png … | ○/× | … |
| … |
- Chrome: <버전>, probe main: <renderer>, probe software: <renderer>
- 자동 확인: main <통과/전체>, software <통과/전체>  (실패 목록: …)
- 캡처하지 못한 장면: <없음 / 장면과 사유>

### 6. 하네스가 검증하지 않는 것(§10.6 의 5번)
- 로그인, /api/data 의 인증과 302, 서명 URL 에 대한 교차 출처 바이너리 fetch → 배포 직후 확인(§13 의 4번, §14 의 2번)
- 내장 그래픽 노트북 성능(§14 의 1번), 실기기 터치(§14 의 12번)
- 소프트웨어 렌더 장면은 --disable-gpu 헤드리스 Chrome 으로 만든 것이다(§14 의 10번)

### 7. 배포 순서(§13, 기록만. 머지·배포는 사용자 결정)
1. DB 마이그레이션 없음  2. 워커(엔진) 먼저  3. 대시보드 다음  4. 배포 직후 새 분석 하나에서 3D 프리뷰 탭과 points3d.bin fetch(서명 URL) 확인  5. 옛 분석은 재분석해야 점 파일이 생긴다

### 8. 미실측·위험(§14 의 1·2·10 그대로)
1. 내장 그래픽 노트북 성능 미실측(실측 범위는 외장 GPU 수 ms 와 소프트웨어 렌더 약 96ms 사이. LOD 상수는 budget.ts 의 이름 붙은 값)
2. 운영 Supabase 에서의 points3d.bin fetch 미실측(실패하면 화면은 error_fetch 로 PNG 와 사유를 보인다)
10. gl-renderer 는 CI 가 픽셀을 검증하지 못한다(gl 호출 기록 스텁 + 이 캡처 대조가 대신한다)

### 9. 발견한 결함과 돌아간 태스크
- <없음 / 결함 → Task N 으로 돌아가 고치고 Step 3 부터 다시 돌림>
```

커밋은 없다. 이 태스크의 산출물은 위 기록과 `<H>/` 뿐이다.

---

**초안 메모(계획 작성 중 실제로 돌려 확인한 것):**

- 하네스 부팅: 현재 코드(`AnalysisResult` 의 3D 탭이 아직 PNG)로 `cd dashboard && npx vite --config <scratch-16>/points3d-harness/vite.config.mjs` 가 뜨고, Tailwind 클래스(Container·TabBar·StatusIndicator)가 실제 CSS 로 나오며, `/api/data/artifacts/floor/*` 응답·`nobin` 404·경로 탈출 404·`/__harness/delay` 가 동작했다. 콘솔 오류 0(favicon 은 빈 아이콘으로 막았다).
- 산출물: `make_scan.py` → `floor.ply 90682 points, wall.ply 72943 points`. Task 4 초안의 스크래치 엔진(`scratch-04/engine`)으로 CLI 분석 → `points3d.bin` 725,5xx 바이트, `n_points 90682`, `not_floor 81`, `dep<-70 91`, `pro>70 135`, `points3d_threshold_q 70`. 상판 점을 바닥 격자와 같은 XY 에 두면 표본에서 전부 빠지는 것을 확인하고 1cm 어긋나게 바꿨다.
- 캡처 스크립트: (1) DOM 계약만 흉내 낸 2D 캔버스 모의 뷰어, (2) 형제 초안의 스크래치 구현(`scratch-13/integ` 의 lib/domain·lib/viz·points3d-view·preview3d-tab + `scratch-14/impl` 의 analysis-result)을 overlay 플러그인으로 덮어 씌운 **실제 뷰어 코드**, 두 가지에서 `main`(21개 장면 기록, 자동 확인 실패 0) 과 `software`(2개 장면, 실패 0)가 끝까지 돌았다. StrictMode 에서 `points3d.bin` 요청 1회, 콘솔 0, 읽기 창 좌표가 손으로 적은 기대값과 일치(`X 2.040 m / Y 2.000 m / Z −0.010 m / 편차 −9.5 mm / DEPRESSION`, 상판 `X 4.610 m / Y 1.810 m / Z 0.700 m / 편차 없음`), 배율 2 비율 0.992.
- 변이로 확인한 자동 확인의 하중(모의 뷰어): JSX `onWheel` → 장면 8 실패, 점 최소 크기 미배율 → 장면 11 실패(0.633), `bg-cs-info-bg` 덧붙이기 → 장면 2 실패. 커서를 버튼 위에 둔 채 읽으면 hover 배경 때문에 세 번째 변이가 통과해 버리는 것을 보고 클릭 뒤 커서를 빼도록 고쳤다. 버튼 `transition-colors` 때문에 `rgba(…, 1)` 로 읽히는 순간이 있어 색 비교를 정규식으로 바꿨다.
- 아트보드: `file:///` 로 열면 Google Fonts `<link>` 가 늦어 빈 캡처가 나왔다. 글꼴 요청을 막으니 1440 × 2240 으로 찍혔다(`ScanDone.dc.html` 과 Task 15 초안의 `ScanDone3D.dc.html` 둘 다).
- 기준선·빌드: engine 244/1 deselected(94s), worker 209/2(100s), dashboard 84 파일 769건(78s), tsc 0, next build 성공, 빌드 뒤 `git status` 빈 출력. perf 30M점 44.3s / 1.33GiB(현재 코드). Task 4 초안의 스크래치 엔진(`scratch-04/engine`, 3번째 패스 포함)으로 `-m perf` 를 돌리면 30M점 76.0s / 1.33GiB / 4,000,512 bytes, 3M점 29.9s / 0.28GiB / 3,994,780 bytes 로 둘 다 게이트 안이었다. 히트맵 try 제거 변이는 엔진 복사본에서 `RuntimeError: 주입된 렌더 실패` 로 죽었다.
- 못 한 것: 저장소에 아직 뷰어가 없으므로 "최종 상태"의 실행은 당연히 못 했다(형제 초안 코드로 대신했고, 형제 초안이 바뀌면 결과가 달라질 수 있다). 실제 모니터 배율 2·실기기 터치·헤드풀 Chrome 의 Ctrl+휠 페이지 확대는 헤드리스에서 재현되지 않는다(스크립트는 `defaultPrevented` 로 대신한다). 브라우저 패널(mcp Browser) 로는 스크린샷이 시간 초과로 실패하는 때가 있어 CDP 스크립트를 1차 수단으로 두었다.
- 2026-10-03 재점검(이전 실행이 반환 직전에 끊겨 이어서 확인한 것): (1) 이 문서에 실린 하네스 파일 9개(`make_scan.py`, `mutate_try.py`, `vite.config.mjs`, `index.html`, `main.tsx`, `stubs/*` 3개, `capture.mjs`)가 실제로 돌린 `scratch-16/points3d-harness/` 의 파일과 바이트 단위로 같다(코드 블록을 추출해 대조). (2) `scratch-16/overlay-run.jsonl`(장면 21개, 자동 확인 실패 0), `overlay-sw.jsonl`(소프트웨어 렌더 2개, SwiftShader 확인), `baseline.log`(engine 244/1, worker 209/2, dashboard 84/769, tsc 0, next build 라우트 16개, 빌드 뒤 git status 빈 출력), `shots/` 의 PNG 31장이 남아 있다. (3) 저장소 사실 재확인: `pipeline.py:96-99` 의 히트맵 try 블록이 `mutate_try.py` 의 `old` 와 글자 그대로 같고 벽면 쪽(`:135-138`)은 들여쓰기·변수명이 달라 `count == 1` 이 성립한다. `test_pipeline.py:184` 의 테스트 이름과 `:191` 의 `RuntimeError("주입된 렌더 실패(디스크/폰트 등 인프라 사유 모사)")`, `synthetic.py` 의 `flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0, axis='x', ...)`, `cli.py:142-147` 의 분기, `pyproject.toml:25` 의 `addopts = "-m 'not perf'"`, `dashboard/.gitignore` 의 `/.next/`·`*.tsbuildinfo`·`next-env.d.ts`, `layout.tsx:21` 의 body 클래스, `Container`·`PAGE_MAIN`·`ScanRow`·`AnalysisRow` 필드, vite 8.1.5 / @vitejs/plugin-react 6.0.4 / @tailwindcss/postcss 4.3.3 / react 19.2.4, Chrome 실행 파일 경로, Node v22.16.0, 참고 캡처·`cdp-bench.mjs`·`ScanDone.dc.html` 존재. (4) 고친 곳은 Step 8 의 CLI 기대 출력 한 줄(`최대 <값>mm @ (...)` 양식으로 정확히) 뿐이다. 문서에 U+2014 와 '발주처' 0건.
- 2026-10-03 지적 반영(Step 3·5·14 의 테스트 수 근거 문장과 jsdom 메시지 줄 수): 형제 초안에서 수를 다시 읽었다(T1 18, T2 19, T3 83, T4 7 + perf 1, T5 test_summary 1 · labels.test.ts 1, T6 test_points3d 1 · points3d.test.ts 107, T7 105, T8 15 + 41, T9 40 + 16, T10 44, T11 48, T12 69, T13 49, T14 analysis-result 20 · litmus 3). 리뷰 사본(`scratch-review/`, 초안 코드 블록을 조립한 것)의 실측과 맞춰 봤다: 엔진 `371 passed, 2 deselected`(T5·T6 의 엔진 몫 2건이 들어가기 전의 사본이라 244 + 127. 넣은 뒤 네 파일만 돌리면 `150 passed` = test_summary 8 + test_points3d 84 + test_pointsample 37 + test_pipeline 21 이고 이 네 파일의 기준선 21 과의 차가 129 라 전체는 373), 대시보드 `95 files / 1327 tests`(= 769 + 1 + 20 + 537), 새 파일 11개만 돌리면 `11 files / 537 tests` 에 `Not implemented: HTMLCanvasElement's getContext()` 0회, 전체 스위트에서는 그 줄이 기준선 60회·사본 61회(저장소의 heatmap-view.test.tsx 단독 5회, 새 파일과 T14 가 고친 analysis-result.test.tsx 는 0회). 그래서 "두 줄" 을 "60회 안팎" 으로 고치고 11개 파일 단독 실행을 Step 5 에 더했다.

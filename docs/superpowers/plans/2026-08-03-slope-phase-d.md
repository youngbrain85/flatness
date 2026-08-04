# 세부과업 4 단계 D: 구배 결과 화면 + 배수구 클릭 + 재판정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구배 분석 결과를 화면에서 읽고, 배수구를 클릭해 방향까지 판정하고, 보정 높이차를 시공자가 쓸 수 있는 형태로 받는다.

**Architecture:** 판정은 파이썬 엔진에만 둔다. 브라우저는 그리기와 좌표 수집만 한다. 배수구 클릭은 `analyses.params`에 저장되고 `slope_judge` 잡이 이미 산출된 셀 벡터만 읽어 판정을 다시 한다(점군 미열람).

**Tech Stack:** Python 3(엔진·워커) · PostgreSQL(Supabase) · Next.js 16(대시보드)

## Global Constraints

- **사용자 대면 문자열에 U+2014(`—`) 금지.** 주석·개발문서는 허용. 문자를 셀 때는 리터럴 글리프로 검색하고, **검색 패턴이 실제로 매칭되는지 먼저 자기검증할 것**
- 주석·문서·사용자 대면 문자열은 **한국어**
- **Next.js 16이다.** 학습 데이터의 Next.js와 다르다. 대시보드 코드를 쓰기 전에 `dashboard/node_modules/next/dist/docs/`의 해당 가이드를 읽을 것 (`dashboard/AGENTS.md` 지시). **Vitest는 async 서버 컴포넌트 `render()`를 지원하지 않는다** - 단계 C가 세운 패턴(`@/lib/supabase/server` 모킹 + 페이지 함수 직접 `await` + 부수효과 관찰)을 따를 것
- 워커 테스트: `cd worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest -q` (**forward slash 필수**)
- 대시보드 테스트: `cd dashboard && npm test`
- 기준선(단계 D 착수 시점, 컨트롤러 실측): engine **168** / worker **110** / dashboard **190**
- 마이그레이션 SQL은 **재실행 안전(멱등)**이어야 한다. 003~007이 전부 그렇게 작성돼 있다
- 구배 판정 기준 수치는 **`docs/slope-criteria-sources.md`가 정본**이다

## 이 단계가 절대 어겨서는 안 되는 것

단계 A~C의 리뷰가 실제로 잡아낸 결함들이다. 같은 자리를 다시 밟지 마라.

| 원칙 | 왜 |
|---|---|
| **판정 로직을 브라우저에 두지 마라** | 스펙 §7.3이 명시적으로 금지한다. 판정이 파이썬과 브라우저 두 곳에 생기면 어긋난다. 세부과업 1에서 실제로 그랬다. **그리는 것과 판정하는 것은 다르다** - 브라우저는 엔진이 낸 등급을 색으로 칠할 뿐 등급을 계산하지 않는다 |
| **발행된 보고서가 가리키는 산출물을 덮어쓰지 마라** | 단계 A~C에서 이 계열 결함이 나왔다(발행본 PDF 덮어쓰기, 티켓 I1). 재판정이 `slope_map.png`를 덮으면 발행본이 가리키는 그림이 바뀐다 |
| **조용한 실패를 만들지 마라** | 필드가 조용히 NULL이 되거나, PATCH가 0행에 매칭돼 no-op이 되거나, 잘못된 값이 '성공'으로 저장되는 것. 이 프로젝트에서 가장 위험한 실패 양식이다 |
| **테스트가 실제로 회귀를 잡는지 변이로 증명하라** | "프로덕션 코드는 맞는데 테스트가 정작 막으려던 회귀를 못 잡는다"가 단계 C에서만 세 번 나왔다. 스텁이 인자를 기록하는지, 단언이 값까지 확인하는지 보라 |
| **`kind` 인지 조회를 되돌리지 마라** | 단계 C가 `is_current` 조회 3곳과 `analyses/[id]` 가드에 붙인 것들이다. 지우면 홈 집계가 2배가 되고 화면이 죽는다 |
| **`002_functions_seed.sql`을 재실행하지 마라** | criteria 시드에 `on conflict`가 없어 23505로 죽고, 003·004가 확장한 잡 큐 함수 3종을 P2 정의로 강등시킨다 |

## 스펙 요구 (원문 대조용)

이 단계가 충족해야 할 스펙 절이다. 구현 후 하나씩 대조하라.

**§7.2 구배 결과 화면**
- 구배 크기 히트맵(4등급 색) + 방향 화살표 오버레이
- 상단에 "배수구 위치를 클릭하세요" 안내. 클릭하면 재판정 잡이 돌고 갱신된다
- 결과표: 셀별 구배 %, 설계 대비 편차, 보정 높이차(mm), 등급
- 구역별 통계
- **역구배 셀은 색만으로 드러나지 않는다.** 크기가 정상이면 초록인데 물은 반대로 흐른다. 화살표를 굵게 하고 결과표에 별도 표시한다

**§7.3 재판정** - 분석은 배수구 없이 한 번만 돌려 셀별 구배 벡터를 산출물로 남긴다. 배수구를 클릭하면 **그 산출물만 읽어** 판정을 다시 한다(점군을 읽지 않으므로 수 초).

**§5.3 보정 방향** - 실측 벡터에서 설계 벡터를 빼면 보정 벡터가 나온다. %로만 보여주면 시공자가 쓸 수 없으므로 **높이차로 환산한다.** 결과표에는 "북동쪽 끝을 10mm 낮춤" 형태로 적고, 지도에는 화살표로 그린다.

**§5.4 통계** - 구간별 평균편차·표준편차·최대편차. "구간"은 기존 구역화(`core/zones.py`) 결과를 쓴다.

**§6.4 잡 타입** - `slope_judge`: 산출된 셀 벡터 + 배수구 위치 → 판정·산출물 갱신. 가벼움(점군 미열람).

**§3.5** - 배수구 위치는 `analyses.params` jsonb: `{"drain_points":[{"x":3.2,"y":5.1}]}`

## 착수 시점의 알려진 제약

사전 조사 전에 이미 확인된 것들이다.

- 구배에는 평활도의 `cells.json`에 해당하는 파일이 **없다.** `slope_cells.csv`뿐이고 `utf-8-sig`(BOM)로 쓰인다(평활도 `results.csv`는 `utf-8`). CSV를 파싱하면 첫 열 이름이 `\ufeffcx`로 읽히는 함정이 있다
- `analyze_slope`는 점군부터 끝까지 한 번에 도는 함수뿐이다. **재판정용 진입점이 없다**
- `slope_summary`는 전역 통계만 낸다. **구역별이 없다**
- `job_type` enum에 **`slope_judge`가 없다** - 마이그레이션이 필요하다
- 단계 C에서 만들어진 구배 분석들은 `drain_points`가 없어 **방향 판정이 꺼진 채** 크기만 판정됐다. `stats.direction_judged=false`이고 `warnings`에 그 사실이 있다
- 구배 결과 화면은 현재 `components/analysis/slope-placeholder.tsx` 안내 화면이다. 이 단계가 실물로 바꾼다
- `render_slope_map` 실패가 격리돼 있지 않다(`pipeline.py:210`). 렌더가 죽으면 `slope_stats.json`이 없는 반쪽 산출물이 된다 (백로그 티켓)

## 설계 결정

사전 조사(워크플로 `wf_0f744309-fb8`, 에이전트 5)가 실측으로 답한 것들이다. 태스크 안에서 다시 고민하지 마라.

### D1. 재판정 입력은 신규 `slope_cells.json`이다

**`slope_cells.csv` 복원은 배제한다.** 정성적 우려가 아니라 실측 결과다.

- CSV에 **`width_m`·`height_m` 열이 없다**(`pipeline.py:199-201`). 명목 `cell_m`으로 대체하면 `correction_mm = d * min(width_m, height_m) * 10`이 가장자리 셀에서 **정확히 2배**로 나온다(실측 0.87 → 1.74mm). 스펙 §5.3의 "10mm 낮춤"이 20mm로 나간다
- 조각 셀의 판정불가 **사유가 뒤바뀐다**: 8.5m 바닥 25셀 중 9셀이 "격자 가장자리 조각 셀" → "유효 서브셀 부족"으로 완전히 다른 원인을 사용자에게 알린다(`slope.py:141-144`)
- 반올림(`_r(v,3)`·`_deg` 1자리)이 **등급을 바꾼다**: 판정 경계에 걸터앉은 바닥 20개 중 **11개**에서 최소 1셀의 등급이 뒤집혔다. 경계에서 먼 바닥(tilt 1.6%)은 0/20이다. **경계에 걸터앉은 바닥이야말로 판정 시스템이 존재하는 이유다**

`slope_cells.json`에 담을 것: `SlopeCell` 12필드 **전부 반올림 없이** + `zone_id` + `schema_version` + `engine_version`.

**판정 결과(`grade`·`dev_pct`·`correction_mm`·`dir_err_deg`·`reason`)는 담지 않는다.** 재판정 때 다시 계산되는 파생값이고, 담으면 CSV와 이중 진실이 된다.

선례: 평활도가 `cells.json`을 별도로 내고(`outputs/stats.py:66-68`) 대시보드가 fetch한다(`analysis-result.tsx:31`). **같은 파일을 재판정 잡과 화면이 함께 소비하면 히트맵 재구성과 재판정 입력이 한 파일로 해결된다.**

`slope_cells.csv`는 사람이 엑셀로 여는 산출물로 유지하되 `width_m`·`height_m`를 **열 끝에만** 추가한다(BOM·기존 열 순서 유지).

### D2. 구역별 통계(§5.4)는 이번 단계에서 뺀다

**기존 구역화가 경사 바닥에서 작동하지 않는다.** 16m×16m **단차 없는 단일 평면**에 `detect_levels`+`build_zones`를 돌린 실측:

| 경사 | 검출 레벨 | 생성 구역 |
|---|---|---|
| 0.5% | 1 | 1 |
| 1.0% | 2 | **2** |
| 1.5% | 3 | **3** |
| 2.0% | 2 | **2** |
| 3.0% | 0 | **0** |

원인은 `detect_levels`(`core/levels.py:5`)가 높이 히스토그램의 봉우리를 찾는데 **경사면은 높이가 균일 분포라 봉우리가 없다**는 것이다. 노이즈로 생긴 우연한 봉우리를 레벨로 잡고, 3%에서는 어떤 빈도도 `min_frac`(3%)을 넘지 못해 레벨이 0개다.

**구배 분석의 대상이 바로 설계상 기울어진 배수 바닥이므로 이 실패가 정상 케이스다.** 붙이면 화면이 존재하지 않는 "구역 1/2/3"의 통계를 내거나 전 셀 `zone_id=None`이 된다.

덧붙여 스펙 §5.4의 "레벨이 다른 구역은 설계 구배도 다를 수 있으므로"는 **현재 엔진에서 성립하지 않는다** - `grade_slope_cells`는 `design_pct` 하나만 받는다(`slope.py:132`). 구역별 설계 구배는 `criteria.thresholds` 스키마 변경까지 필요하다.

**이번 단계가 할 것:** `SlopeCell`에 `zone_id: int | None = None`을 **기본값 있는 마지막 필드**로 뚫어두고 `slope_cells.json` 스키마에도 넣되 **항상 `None`으로 채운다.** 후속 단계가 산출 로직만 채우면 산출물 스키마와 화면은 손대지 않아도 된다. 화면에는 전역 통계만 내고 "구역별 통계는 후속 단계"를 명시한다. 백로그에 티켓으로 남긴다.

> 기본값이 필수인 이유: `SlopeCell`을 **위치 인자로** 생성하는 곳이 6곳이다(`slope.py:72,83,90,106`, `test_slope.py:105,172`, `test_slope_map.py:15,30,42`).

### D3. 히트맵은 브라우저에서 다시 그린다. 엔진 PNG는 화면에서 내린다

§7.3의 금지는 **판정 이중화**이지 렌더 이중화가 아니다. 브라우저는 `grade` 문자열을 **읽어서 색을 칠할 뿐** 임계값 비교를 하지 않는다.

> **리트머스: 브라우저 코드에 `threshold.pass_pct`·`re_pct`·`dir_pass_deg` 같은 임계값이 등장하는가.** 등장하면 이중화이므로 반려다. 등장하지 않으면 렌더링이다. 리뷰가 이걸 확인한다.

브라우저 렌더가 필수인 이유: PNG에는 좌표계 정보가 없고 `tight_layout`·`dpi=120`으로 여백이 가변이라(`slope_map.py:61-62`) **클릭 좌표를 미터로 환산할 수 없다.** 화살표 굵기·역구배 강조도 상호작용적으로 못 바꾼다.

**PNG를 화면에 함께 두지 않는 이유**가 오히려 §7.3 정신에 맞다: 같은 그림을 matplotlib과 Canvas가 **서로 다른 색표**로 그리게 된다(`slope_map.py:17-23`의 `#3d8b3d` vs `labels.ts:14-16`의 `#2e7d32`). 산출물로는 계속 만들되 화면에서는 다운로드 링크로만 둔다.

**⚠ Canvas y축 함정**: 엔진은 `ax.arrow(cx, cy, L*cos(θ), L*sin(θ))`로 그리는데 matplotlib 데이터 좌표는 y가 위로 증가한다. **Canvas는 y가 아래로 증가한다.** `heatmap.ts:24-31`의 `cellRect`가 행만 뒤집는 선례를 그대로 따라 `sin`의 부호를 뒤집지 않으면 **모든 화살표가 상하 반전된다.** 색은 정상이라 화면상 아무 경고가 없다 - 스펙이 "역구배는 색으로 안 드러난다"고 경계한 바로 그 실패 양식이 렌더러 버그로 재현된다. **회귀 테스트 필수.**

### D4. 배수구 좌표는 잡 payload에 싣는다

**엔큐를 먼저 하고, 성공하면 `params`를 쓴다.** 순서가 중요하다.

현행 워커는 잡 처리 시점에 `analyses.params`를 읽는다(`slope.py:78`). payload에 좌표가 없으면 이런 경합이 생긴다:

1. 1차 클릭: `params=A`, 잡 J1 queued
2. 워커가 J1 claim (아직 params 미조회)
3. 2차 클릭: `params=B` PATCH **성공**(RLS `all_auth`), `enqueueJob`은 23505로 **거부**
4. J1이 params를 읽음 → **B 좌표로 판정**

사용자는 "이미 작업이 진행 중입니다"를 봤는데 결과는 2차 좌표로 나온다. 반대 순서면 A로 나온다. **어느 쪽인지 코드로 정해져 있지 않다.**

**payload에 좌표를 실으면 잡이 자기가 받은 좌표로만 판정하므로 경합이 사라진다.** `params.drain_points`는 "현재 배수구가 무엇인가"의 표시용으로 남긴다. 이건 판정 이중화가 아니다 - 판정하는 곳은 여전히 파이썬 한 곳이고 좌표라는 **입력값**이 두 곳에 기록될 뿐이다.

### D5. 재판정은 `analyses.status`를 건드리지 않는다

세 선택지 중 둘이 나쁘다.

- `analyze`처럼 `processing`/`failed`로 전이 → **재판정 3회 실패 시 이미 성공해 있던 구배 분석이 `failed`로 바뀐다.** `analyses/[id]/page.tsx:27-36`이 결과 화면 전체를 감춘다. 무거운 `analyze`를 처음부터 다시 돌려야 복구된다
- 아무것도 안 건드림 → **재판정 실패가 화면에 전혀 안 뜬다.** 003이 고쳤던 결함과 같은 종류다

**`jobs` 테이블은 RLS가 켜져 있는데 정책이 0개라 대시보드가 잡 상태를 읽을 수 없다**(`001_schema.sql:265,295`). `analyses`에는 `updated_at` 컬럼도 없다. 따라서 진행 상태를 대시보드가 읽을 수 있는 곳에 둬야 한다.

**결정: `analyses.params.judge`에 재판정 상태를 둔다.** `analyses`는 RLS `all_auth`라 대시보드가 읽는다.

```json
{ "drain_points": [{"x": 3.2, "y": 5.1}],
  "judge": { "state": "queued|processing|done|failed", "at": "<iso>", "error": "<사유>" } }
```

전이는 **잡 큐 함수가** 한다(003·004가 자기 잡 타입에 대해 한 것과 같은 관례):
- `fn_job_claim`: `slope_judge`면 `params.judge.state = 'processing'`. **`analyses.status`는 건드리지 않는다**
- `fn_job_fail`: 재시도 소진 시 `params.judge.state = 'failed'` + `error`. 재큐 시 `'queued'`로 되돌린다
- `fn_reap_stuck_jobs`: 회수 시 `'queued'`로 되돌린다
- 워커 핸들러: 성공 시 `'done'`

`analyses.status`는 **시종 `done`을 유지**하므로 이전 판정 결과가 화면에서 사라지지 않는다.

### D6. 마이그레이션은 008·009 **두 개로 나눈다**

`alter type job_type add value`와 그 값의 사용을 **같은 트랜잭션에 넣으면 실패한다.** Supabase SQL Editor는 파일 전체를 한 트랜잭션으로 실행하고, PostgreSQL은 같은 트랜잭션 안에서 새 enum 값의 사용을 `unsafe use of new value` 오류로 막는다.

- **008**: `alter type job_type add value if not exists 'slope_judge';` **이것만**
- **009**: 잡 큐 함수 3종 확장(`fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs`)

**사용자가 두 번 나눠 실행한다.** 문서에 그렇게 안내한다.

> **⚠ 004가 잡 큐 함수 3종의 정본이다**(002가 아니다). 009는 `004_report_support.sql:55-128`의 본문을 복사해 확장한다. 002를 기준으로 재정의하면 003·004가 넓힌 import·report 분기가 되돌아간다. 파라미터명(`p_worker`/`p_job_id`/`p_error`)·반환형·`security definer`·`search_path`를 그대로 유지할 것.

### D7. 단계 C까지 만들어진 구배 분석은 재판정할 수 없다

`slope_cells.json`이 없기 때문이다. 이건 D1의 대가이고 받아들인다.

**화면이 이 상태를 명시적으로 다뤄야 한다.** `stats.artifacts`에 `cells_json` 키가 **없으면**:
- 히트맵을 그릴 수 없다 → 엔진이 만든 `slope_map.png`를 대신 보여준다(이 경우에 한해)
- 배수구 클릭을 비활성화하고 **"이 분석은 재판정할 수 없습니다. 구배 분석을 다시 실행하면 배수구를 지정할 수 있습니다."**를 안내한다
- 클릭이 무거운 재분석으로 이어진다는 점을 화면이 밝힌다

**CSV 근사 복원으로 때우지 마라.** D1의 실측이 그 경로를 배제했다.

### D8. 재판정은 산출물을 제자리에서 덮어쓴다 (보고서는 안전하다)

조사자 2명이 "발행본 보고서가 깨진다"를 위험으로 올렸으나 **과대평가였다.** 발행본은 산출물을 경로로 참조하지 않고 **생성 시점에 복사한다**(`report/assets.py:81-135`의 `_copy_analysis_assets`가 `storage.download` → `dst_dir`, snapshot에는 `reports/{id}/assets/...`만). 게다가 구배는 보고서에 **들어갈 수조차 없다**(후보 쿼리 `.eq('kind','flatness')` + `context.py:34`가 `cells.json` 필수).

**남는 진짜 문제는 이력이다.** `SupabaseStorage.upload`가 `x-upsert: true`(`storage.py:122-129`)로 무조건 덮으므로 **이전 판정을 복원할 수단이 없다.** 배수구를 잘못 찍으면 되돌리려면 무거운 `analyze` 재실행뿐이다.

**이번 단계는 덮어쓰기를 그대로 둔다**(스펙 §7.2의 "클릭하면 갱신"이 그 형태다). 다만 **직전 배수구 좌표를 `params.judge.previous_drain_points`에 남겨** 사용자가 되돌릴 수 있게 한다. 이력 비교 기능은 백로그 티켓으로 남긴다.

## File Structure

**신규**
- `engine/flatness/outputs/slope_cells.py` - `slope_cells.json` 직렬화·역직렬화. `pipeline.py`가 이미 크므로 분리
- `supabase/migrations/008_slope_judge_enum.sql` - enum 값만
- `supabase/migrations/009_slope_judge_functions.sql` - 잡 큐 함수 3종 확장
- `worker/tests/test_slope_judge.py`
- `dashboard/lib/domain/slope-cells.ts` - `slope_cells.json` 로더·타입
- `dashboard/lib/domain/slope-heatmap.ts` - Canvas 렌더(색·화살표·픽셀↔미터 변환)
- `dashboard/components/analysis/slope-result.tsx` - 구배 결과 화면 본체
- `dashboard/components/analysis/slope-heatmap-view.tsx` - 히트맵 + 배수구 클릭
- `dashboard/components/analysis/slope-result-table.tsx` - 셀별 결과표
- `dashboard/components/analysis/slope-verdict-panel.tsx` - 판정 요약

**수정**
- `engine/flatness/core/slope.py` - `SlopeCell`에 `zone_id` 추가
- `engine/flatness/core/pipeline.py` - `judge_slope_cells` 분리, `analyze_slope`가 호출, CSV에 폭·높이 열 추가
- `worker/flatworker/slope.py` · `jobs.py` · `runner.py` - `slope_judge` 핸들러
- `worker/tests/fake_db.py` - 009의 새 분기 반영
- `dashboard/lib/domain/types.ts` - `SlopeStats.artifacts`에 `cells_json`, `params.judge` 타입
- `dashboard/lib/domain/jobs.ts` - `JobType`에 `'slope_judge'`
- `dashboard/app/analyses/[id]/page.tsx` - `SlopePlaceholder` → `SlopeResult`
- `docs/DEPLOY.md` · `docs/SUPABASE_SETUP.md` - 008·009 반영

**삭제**
- `dashboard/components/analysis/slope-placeholder.tsx`와 그 테스트 - `SlopeResult`가 대체한다. **다만 그 파일의 jsonb 방어(옵셔널 체이닝·폴백)와 테스트 7건은 새 컴포넌트가 계승해야 한다.** 계승하지 않으면 회귀다

---

### Task 1: 엔진 - 셀 산출물과 재판정 진입점

**Files:**
- Create: `engine/flatness/outputs/slope_cells.py`, `engine/tests/test_slope_cells.py`
- Modify: `engine/flatness/core/slope.py`, `engine/flatness/core/pipeline.py`
- Test: `engine/tests/test_slope.py`, `test_cli.py`

**Interfaces:**
- Produces: `dump_slope_cells(cells, path, engine_version)`, `load_slope_cells(path) -> list[SlopeCell]`, `judge_slope_cells(cells, threshold, out_dir, drain_points=None, cell_m=2.0, subcell_m=0.05) -> stats`
- Consumes: 기존 `compute_slope_cells`·`grade_slope_cells`·`slope_summary`·`render_slope_map`

- [ ] **Step 1: `SlopeCell`에 `zone_id` 추가**

```python
zone_id: int | None = None   # 구역별 통계는 후속 단계. 스키마만 미리 뚫어 둔다
```

**반드시 마지막 필드이고 기본값이 있어야 한다.** 위치 인자 생성부가 6곳이다(`slope.py:72,83,90,106`, `test_slope.py:105,172`, `test_slope_map.py:15,30,42`). 기본값이 없으면 그 전부가 깨진다.

- [ ] **Step 2: 실패하는 테스트 - 직렬화 왕복이 무손실인가**

```python
def test_slope_cells_json_roundtrip_is_lossless():
    """재판정이 원본과 같은 판정을 내려면 왕복이 무손실이어야 한다.

    CSV 경로는 이것 때문에 배제됐다 - 반올림이 판정 경계에서 등급을 바꾸고,
    width_m/height_m 열이 아예 없어 보정 높이차가 2배로 나온다.
    """
    grid = build_subcell_grid(...)          # 9.1m 바닥(2m 비배수 - 조각 셀이 생긴다)
    cells = compute_slope_cells(grid, cell_m=2.0)
    dump_slope_cells(cells, path, engine_version=ENGINE_VERSION)
    restored = load_slope_cells(path)
    assert len(restored) == len(cells)
    for a, b in zip(cells, restored):
        assert a == b          # dataclass 동등성 - 12필드 + zone_id 전부
```

```python
def test_restored_cells_produce_identical_grades():
    """같은 배수구로 두 번 판정하면 등급이 한 셀도 달라지지 않는다."""
    # 판정 경계에 걸터앉은 바닥(편차가 정확히 pass_pct)으로 잡아야 의미가 있다
```

- [ ] **Step 3: 실패 확인 → `outputs/slope_cells.py` 구현 → 통과 확인**

`nan`을 어떻게 담을지 정해야 한다. `not ok`인 셀은 `slope_pct`·`downhill_rad`·`rmse_m`·`se_pct`가 `nan`이다. **`json.dump(allow_nan=False)`가 이 저장소 관례**(`pipeline.py:238`)이므로 `null`로 쓰고 로드 시 `float('nan')`으로 되돌린다. 왕복 테스트가 이걸 지킨다(`nan != nan`이므로 `math.isnan` 비교가 필요하다 - `assert a == b`가 통과하지 않으면 그 이유다).

파일에 `schema_version`과 `engine_version`을 함께 담는다. 재판정이 **엔진 버전이 다른 셀 파일을 만났을 때** 무엇을 할지 정하고 그 판단을 주석에 남겨라.

- [ ] **Step 4: `judge_slope_cells` 분리**

`pipeline.py:192-239`(grade → summary → CSV → PNG → warnings → stats.json)를 잘라내 새 함수로 만들고, `analyze_slope`가 그것을 호출하게 한다.

**`analyze_slope`의 공개 시그니처는 그대로 둔다.** 그러면 CLI·워커·테스트 4곳이 무영향이다.

`judge_slope_cells`는 **점군을 열지 않는다.** 입력은 `cells`(복원된 `SlopeCell` 리스트) + `threshold` + `drain_points`뿐이다.

- [ ] **Step 5: CSV에 폭·높이 열 추가**

`width_m`·`height_m`를 **열 끝에만** 추가한다. BOM(`utf-8-sig`)과 기존 열 순서를 유지한다 - 기존 CSV를 여는 사용자의 열 위치가 바뀌면 안 된다.

- [ ] **Step 6: `analyze_slope`가 `slope_cells.json`도 내게 한다**

`stats["artifacts"]`에 `cells_json` 키를 추가한다. 워커의 `normalize_slope_stats`가 artifacts dict를 키 무관하게 순회하므로(`worker/flatworker/slope.py:37`) 워커는 무변경으로 동작한다 - **확인하고 보고하라.**

- [ ] **Step 7: 전체 엔진 스위트 + 커밋**

```bash
cd engine && python -m pytest -q
```
기준선 **168**. 늘어난 수가 추가한 테스트 수와 맞는지 대조하라.

---

### Task 2: 마이그레이션 008·009

**Files:**
- Create: `supabase/migrations/008_slope_judge_enum.sql`, `supabase/migrations/009_slope_judge_functions.sql`
- Modify: `docs/SUPABASE_SETUP.md`, `docs/DEPLOY.md`

**⚠ 반드시 두 파일로 나눈다.** `alter type job_type add value`와 그 값의 사용을 같은 트랜잭션에 넣으면 PostgreSQL이 `unsafe use of new value`로 막는다. Supabase SQL Editor는 파일 전체를 한 트랜잭션으로 실행한다.

**⚠ 004가 잡 큐 함수 3종의 정본이다.** `004_report_support.sql:55-128`을 복사해 확장하라. 002를 기준으로 하면 003·004가 넓힌 분기가 되돌아간다.

- [ ] **Step 1: 008 - enum 값만**

```sql
-- 008: slope_judge 잡 타입 추가 (세부과업 4 단계 D)
--
-- ⚠ 이 파일에는 이 문장 하나만 둔다. PostgreSQL은 같은 트랜잭션 안에서 새 enum
--    값을 사용하는 것을 막는다(unsafe use of new value). Supabase SQL Editor가
--    파일 전체를 한 트랜잭션으로 실행하므로, 이 값을 쓰는 함수 확장은 009에 있다.
--    **008을 Run 한 뒤 009를 별도로 Run 해야 한다.**
alter type job_type add value if not exists 'slope_judge';
```

- [ ] **Step 2: 009 - 잡 큐 함수 3종 확장**

세 함수 각각에 `slope_judge` 분기를 더한다. **`analyze`/`import`와 같은 분기에 합치지 마라** - 재판정은 이미 `done`인 분석에 걸리므로 시맨틱이 다르다.

| 함수 | `slope_judge`일 때 | 하면 안 되는 것 |
|---|---|---|
| `fn_job_claim` | `params.judge.state = 'processing'` | **`analyses.status`를 `processing`으로 바꾸면 안 된다** - 이미 `done`인 결과가 화면에서 사라진다 |
| `fn_job_fail` | 재시도 소진 시 `params.judge = {state:'failed', error, at}`, 재큐 시 `'queued'` | **`analyses.status='failed'`로 바꾸면 안 된다** - 멀쩡한 기존 판정이 파괴되고 무거운 `analyze`로만 복구된다 |
| `fn_reap_stuck_jobs` | 회수 시 `params.judge.state = 'queued'` | 위와 동일 |

`jsonb_set`으로 `params`의 `judge` 키만 갱신한다. `drain_points`를 건드리면 안 된다.

`create or replace`이므로 ACL 재발급과 `notify pgrst`는 불필요하다(시그니처 무변경).

- [ ] **Step 3: 자기검증**

- 008에 `alter type` 외의 문장이 없는가
- 009가 004의 파라미터명·반환형·`security definer`·`search_path`를 그대로 유지하는가
- 세 함수 어디에도 `analyses.status`를 `slope_judge` 때문에 바꾸는 곳이 없는가
- 둘 다 재실행 안전한가

- [ ] **Step 4: 문서 갱신 + 커밋**

`docs/SUPABASE_SETUP.md`와 `docs/DEPLOY.md`에 008·009를 추가하고 **두 번 나눠 실행해야 한다**는 것을 명시하라. 007 절이 세운 "002는 어떤 경우에도 재실행 금지" 경고와 모순되지 않게 하라.

---

### Task 3: 워커 - `slope_judge` 핸들러

**Files:**
- Create: `worker/tests/test_slope_judge.py`
- Modify: `worker/flatworker/slope.py`, `jobs.py`, `runner.py`, `worker/tests/fake_db.py`

**Interfaces:**
- Consumes: Task 1의 `load_slope_cells`·`judge_slope_cells`, Task 2의 enum·함수
- Produces: `handle_slope_judge(db, cfg, payload)`

- [ ] **Step 1: 실패하는 테스트 - 좌표를 payload에서 읽는가**

```python
def test_slope_judge_reads_coordinates_from_payload_not_params():
    """경합 방지의 핵심이다. params를 읽으면 진행 중인 잡이 나중 클릭의 좌표로 판정한다."""
    # params에는 좌표 A, payload에는 좌표 B를 넣고 B로 판정되는지 확인
```

- [ ] **Step 2~4: 핸들러 구현**

흐름: `payload["analysis_id"]`·`payload["drain_points"]` → `slope_context`로 threshold 획득 → Storage에서 `slope_cells.json` 내려받기 → `load_slope_cells` → `judge_slope_cells` → 산출물 재업로드 → `db.update_analysis`.

**`_finalize`를 쓰면 안 된다.** `set_current_analysis`를 부르는데, 과거 구배 분석(`is_current=false`)을 재판정하면 현재 분석이 바뀐다. 갱신할 필드는 `stats`·`coverage_pct`·`overall_verdict`·`warnings`·`params.judge.state='done'`뿐이다.

`slope_cells.json`이 **없으면**(단계 C 분석) 명확한 한국어 예외를 던져라 - "이 분석에는 셀 데이터 파일이 없습니다. 구배 분석을 다시 실행하세요." 화면이 이 경우를 미리 막지만(D7) 워커도 방어한다.

`params.judge.previous_drain_points`에 직전 좌표를 남긴다(D8).

- [ ] **Step 5: 러너 등록 + `fake_db` 동기화**

`_DEFAULT_HANDLERS`에 추가하고, `fake_db.py`가 009의 새 분기를 흉내내게 한다. **`FakeDB`가 실제보다 관대하면 안 된다** - 단계 C에서 이것 때문에 회귀가 안 잡혔다.

- [ ] **Step 6: 변이 실험 + 커밋**

기준선 **110**. 다음을 각각 넣고 어느 테스트가 실패하는지 적어라.
1. payload 대신 params에서 좌표를 읽게 → 잡히는가
2. `_finalize`를 쓰게(=`set_current_analysis` 호출) → 잡히는가
3. `slope_cells.json` 부재 방어 제거 → 잡히는가

---

### Task 4: 대시보드 - 셀 로더와 Canvas 히트맵

**Files:**
- Create: `dashboard/lib/domain/slope-cells.ts`, `lib/domain/slope-heatmap.ts`, 각 테스트
- Modify: `dashboard/lib/domain/types.ts`

**⚠ 리트머스: 이 태스크의 어떤 파일에도 `pass_pct`·`re_pct`·`dir_pass_deg`가 등장하면 안 된다.** 등급은 엔진이 준 `grade` 문자열을 읽을 뿐이다.

- [ ] **Step 1: 실패하는 테스트 - 화살표 방향이 상하 반전되지 않는가** ★

```ts
it('내리막 화살표가 Canvas 좌표계에서 상하 반전되지 않는다', () => {
  // 엔진의 downhill_rad는 matplotlib 좌표계(y 위로 증가) 기준이다.
  // Canvas는 y가 아래로 증가하므로 sin의 부호를 뒤집어야 한다.
  // 뒤집지 않으면 모든 화살표가 위아래로 뒤집히는데 색은 정상이라
  // 화면상 아무 경고가 없다 - 스펙이 경계한 "역구배는 색으로 안 드러난다"가
  // 렌더러 버그로 재현된다.
  // downhill_rad = -pi/2 (남쪽, y 감소 방향) -> Canvas에서는 dy > 0 이어야 한다
});
```

- [ ] **Step 2~4: 로더·색 매핑·렌더러**

- **BOM 함정 없음**: `slope_cells.json`은 `utf-8`이다(CSV만 `utf-8-sig`). CSV를 파싱하지 마라
- **경로 함정**: 구배 `stats.artifacts` 값은 **이미 버킷-상대 전체 경로**다(`worker/flatworker/slope.py:49-52`). 평활도처럼 `artifactUrl(analysis.artifacts_dir, name)`을 쓰면 `artifacts/{id}/artifacts/{id}/...`로 중복돼 404가 난다. `dataUrl()`에 그대로 넘겨라
- **등급 매핑**: 엔진 등급은 한국어 문자열이다(`적합`·`경계`·`보수`·`재시공`·`판정불가`). `GRADE_COLOR`(`labels.ts:14`)는 영문 verdict 키라 직접 못 쓴다. 매핑 상수를 만들되 **색은 엔진 `slope_map.py:17-23`과 맞춰라** - 같은 데이터를 두 색으로 그리면 안 된다
- **픽셀 ↔ 미터**: `gridGeometry`(`heatmap.ts:7-17`)에는 월드 정보가 없다. `stats.cell_m`과 셀별 `center_x`/`center_y` 범위로 유도한다

- [ ] **Step 5: 변이 실험 + 커밋**

화살표 부호를 뒤집고 테스트가 실패하는지 확인하라.

---

### Task 5: 대시보드 - 구배 결과 화면과 배수구 클릭

**Files:**
- Create: `dashboard/components/analysis/slope-result.tsx`, `slope-heatmap-view.tsx`, `slope-result-table.tsx`, `slope-verdict-panel.tsx`, 각 테스트
- Modify: `dashboard/app/analyses/[id]/page.tsx`, `lib/domain/jobs.ts`
- Delete: `slope-placeholder.tsx`와 그 테스트

- [ ] **Step 1: `SlopePlaceholder`의 jsonb 방어를 계승하는 테스트 먼저**

`slope-placeholder.test.tsx`의 7건(`artifacts`·`warnings`·`summary.counts` 키 부재, 편차 `null`·키 부재, `coverage_pct` 0, `stats`가 `{}`)을 **새 컴포넌트에 그대로 옮긴다.** 계승하지 않으면 회귀다.

- [ ] **Step 2~5: 화면 구현**

- **배수구 클릭 순서**: `enqueueJob('slope_judge', {analysis_id, drain_points})` **먼저**, 성공하면 `params` PATCH. 23505면 params를 건드리지 않고 "이미 재판정이 진행 중입니다"
- **역구배 별도 표시**(§7.2): 화살표를 굵게 + 결과표에 별도 열/배지. **색만으로는 안 드러난다**
- **보정 높이차**(§5.3): "북동쪽 끝을 10mm 낮춤" 형태. 방향은 `downhill_rad`에서 8방위로 환산
- **결과표**: 셀별 구배 %, 설계 대비 편차, 보정 높이차(mm), 등급, 역구배 표시
- **`direction_judged === false`인 기존 분석**: 화살표는 그릴 수 있으나(방향은 실측값이다) **역구배 표시는 근거가 없으므로 그리면 안 된다**
- **`artifacts.cells_json`이 없는 분석**(D7): 히트맵 대신 `slope_map.png`를 보여주고 클릭을 비활성화, 재분석 안내
- **재판정 진행 표시**: `params.judge.state`를 폴링한다. `analyses.status`는 시종 `done`이다
- **`isSlopeStats` 가드를 유지하라**(`app/analyses/[id]/page.tsx:49`). 걷어내면 `coverageLabel`이 `stats.meta`를 옵셔널 체이닝 없이 읽어 페이지가 죽는다. `page.test.tsx:92-110`이 이 배선을 지키므로 함께 갱신하라

- [ ] **Step 6: 변이 실험 + 실제 화면 확인 + 커밋**

기준선 **190**.

변이: 배수구 클릭 순서를 뒤집기(params 먼저) / 역구배 강조 제거 / `cells_json` 부재 분기 제거 / `isSlopeStats` 가드 제거.

**실제로 띄워서 확인하라.** `preview_start` → 구배 분석 결과 화면 → 스크린샷 → `read_console_messages` 오류 0건. `.env.local`이 없어 못 하면 그렇다고 보고하라.

---

### Task 6: 기존 분석 호환·문서·백로그

**Files:**
- Modify: `docs/DEPLOY.md`, `docs/SUPABASE_SETUP.md`, `docs/superpowers/plans/2026-07-28-p1b-backlog-notes.md`, `docs/contracts/stats-schema.md`

- [ ] **Step 1: 백로그 기록**

- **구역별 통계(§5.4) 미구현** - 경사 바닥에서 `detect_levels`가 실패하는 실측(표 포함)과, 평면 계수 불연속으로 구역을 가르는 대안, 그리고 구역별 설계 구배는 `criteria.thresholds` 스키마 변경이 필요하다는 것
- **재판정 이력 비교 불가** - `x-upsert: true`로 산출물이 덮이므로 이전 판정을 복원할 수 없다. `params.judge.previous_drain_points`로 좌표만 되돌릴 수 있다
- **단계 C 분석은 재판정 불가** - `slope_cells.json`이 없다. 백필 스크립트가 대안이나 점군 재분석과 비용이 같다
- **`compute_slope_cells`가 `grid.bimodal`(유령층)을 무시한다** - 평활도는 `build_zones`에서 이중층 서브셀 잔차를 `nan`으로 지우는데 구배는 그대로 평면을 피팅한다
- **`render_slope_map` 실패가 격리되지 않았다** - 렌더가 죽으면 `slope_stats.json`이 없는 반쪽 산출물이 된다

- [ ] **Step 2: `docs/contracts/stats-schema.md`에 구배 계약 추가**

`slope-stats-v1`과 `slope_cells.json` 스키마를 문서화하라. 현재 이 문서는 "엔진은 세 개의 진입점에서 stats를 만든다"고 하는데 `analyze_slope`가 네 번째다.

- [ ] **Step 3: 세 스위트 + 커밋**

## 완료 조건

- [ ] 세 스위트 전부 통과, 기준선(168/110/190) 이상
- [ ] 배수구를 클릭하면 재판정이 돌고 화면이 갱신된다 (**스크린샷**)
- [ ] 역구배 셀이 색이 아니라 화살표 굵기와 결과표로 드러난다
- [ ] 보정 높이차가 "북동쪽 끝을 10mm 낮춤" 형태로 나온다
- [ ] 단계 C 분석을 열어도 죽지 않고 재분석 안내가 뜬다
- [ ] **브라우저 코드에 판정 임계값이 0건** (리트머스)
- [ ] 사용자 대면 문자열에 U+2014 0건

## 범위 밖

- 구역별 통계(§5.4) - D2에서 뺐다. 별도 단계
- 정합(§6·§7.4) - 단계 F
- precheck 높이 뷰(§6.1·§7.5) - 단계 E
- 구배 분석의 PDF 보고서 포함 - 후속

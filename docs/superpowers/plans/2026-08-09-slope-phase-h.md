# 세부과업 4 단계 H: 구배 분석 PDF 보고서

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구배 분석 결과를 자동 PDF 보고서로 낸다. 과업지시서 11·12쪽이 명시한 산출 형식 CSV·PNG·**PDF** 중 유일하게 빠져 있던 것을 채운다.

**Architecture:** 기존 보고서 파이프라인(`load_report_context` → `build_assets` → `build_snapshot` → HTML → Playwright PDF)에 구배 분기를 더한다. **새 파이프라인을 만들지 않는다** — `reports` 테이블·잡 타입·발행본 보호 트리거를 그대로 쓴다. 대시보드는 후보 쿼리의 `kind` 필터를 넓히고 화면에서 종류를 구분한다.

**Tech Stack:** Python(워커) · Jinja2 템플릿 · Playwright · Next.js 16(대시보드)

## Global Constraints

- **사용자 대면 문자열에 U+2014(—) 0건.** Git Bash에서 `$'\u2014'`가 확장되지 않으므로 **리터럴 글리프**로 검색한다
- 화면·보고서 문구는 **한국어**
- **워커 테스트는 반드시 해당 워크트리의 engine을 PYTHONPATH로 준다**:
  `cd <워크트리>/worker && PYTHONPATH=<워크트리>/engine python -m pytest -q`
  `flatness`가 editable 설치로 항상 `D:\Projects\Flatness\engine`(main)를 가리킨다
- **기준선: engine 244 / worker 191 / dashboard 455.** 각 Task는 이 값 이상이어야 한다
- **`worker/flatworker/report/labels.py`는 `dashboard/lib/domain/labels.ts`의 사본이다.** `worker/tests/test_report_labels.py`가 실제로 파싱해 대조하므로 **한쪽만 바꾸면 즉시 실패한다**
- **발행(finalized)된 보고서는 어떤 경우에도 수정하지 않는다.** `handle_report`의 2중 방어(컨텍스트 로드 시 1회 + 스테이징 직전 재확인)와 004의 `fn_reports_finalized_guard` 트리거를 우회하지 마라
- `git add`·`git commit`에는 **항상 경로를 명시**한다

---

## 확정 사실

### 과업지시서 원문 (11·12쪽, 직접 대조 완료)

> 결과 파일 형식 : **CSV(데이터), PNG(시각자료), PDF(보고서)**

> 분석 결과 Script 자동화 프로세스 및 결과 파일 형식 (CSV, PNG, **PDF**)

> 산출 항목 : 구배값(%), 설계기준 대비 편차, 평균편차, 표준편차, 최대편차 자동 계산
> 분석 단위 : 2m × 2m 격자 기준

### 지금 왜 빠져 있나

`dashboard/app/reports/new/page.tsx:38`이 `.eq('kind', 'flatness')`로 거른다. 단계 C가 **의도적으로** 넣은 필터이고 주석이 이유를 적어 놨다:

> 단계 C 회귀 차단: kind 필터 없이는 구배 분석이 보고서 후보로 섞이고 평활도와 육안 구별도 안 된다. 보고서에서 구배를 제외하는 것은 이 쿼리 단계가 맡는다(워커 쪽에서 막는 것은 형식만 멀쩡한 빈 평활도 섹션을 발행본에 박제시켜 더 나쁘다).

**그 우려는 정당했다.** 이 단계는 필터를 그냥 지우는 것이 아니라 **구배를 제대로 렌더하는 경로를 만든 뒤** 넓힌다.

### 구배가 평활도와 공유하는 것 / 다른 것

| | 공유 | 구배 전용 |
|---|---|---|
| 등급 어휘 | `GRADE_PASS/BORDER/REPAIR/REDO/NA` 그대로 | 역구배는 `REDO` + 사유 `"역구배(물이 배수구 반대로 흐름)"` |
| 산출물 | - | `slope_map.png`, `slope_cells.json`, `slope_judged.json`, `slope_cells.csv`, `slope_stats.json` |
| 요약 통계 | - | 설계 구배(%), 편차 평균·표준편차·최대 |
| 방향 | - | 배수구 좌표, 셀별 내리막 방향, 보정 높이차 |

### ★ 역구배 셀의 보정 문구

`dashboard/lib/domain/slope-direction.ts:62`가 정본이다:

```
if (reverse) return '역구배 - 방향 전면 재시공 필요(크기 보정으로 해결 안 됨)';
```

**역구배 셀에 크기 기준 문구를 내면 안 된다.** 스펙 §7.2가 요구한 것이고, 안 지키면 `"서쪽 끝을 0.0mm 높임"` 같은 **"고칠 것 없음"으로 읽히는 문구**가 나온다. 단계 D에서 실제로 났던 결함이다.

---

## 파일 구조

| 파일 | 변경 |
|---|---|
| `worker/flatworker/report/assets.py` | 구배 산출물(`slope_map.png` 등) 복사 분기 |
| `worker/flatworker/report/snapshot.py` | 구배 스냅샷 섹션 빌더 |
| `worker/flatworker/report/templates/report.html.j2` | 구배 장 |
| `worker/flatworker/report/labels.py` | 구배 전용 라벨(필요 시). **`labels.ts`와 동시에** |
| `dashboard/lib/domain/labels.ts` | 위와 쌍 |
| `dashboard/app/reports/new/page.tsx` | 후보 쿼리 `kind` 필터 확장 + 종류 표시 |
| `dashboard/components/report/report-create-form.tsx` | 후보 목록에 종류 구분 |

---

## Task 1: 워커 - 구배 산출물 자산 복사 + 스냅샷

**Files:**
- Modify: `worker/flatworker/report/assets.py`, `worker/flatworker/report/snapshot.py`
- Test: `worker/tests/test_report_snapshot.py`, `worker/tests/test_report_assets.py`(있으면)

**Interfaces:**
- Consumes: `analyses.kind`(`'flatness'|'slope'`), `analyses.stats`(구배는 `slope_stats.json` 형태), `artifacts_dir`의 `slope_map.png`
- Produces: 스냅샷의 구배 항목. **키 이름을 Task 2 템플릿이 그대로 쓴다** — 아래 형태를 지켜라:
  ```python
  {
    "kind": "slope",                    # 기존 analyses 항목에 추가
    "slope": {
      "design_pct": float,              # 설계 구배
      "dev_mean_pct": float,            # 평균 편차
      "dev_sd_pct": float,              # 표준편차
      "dev_max_pct": float,             # 최대 편차
      "drain_points": [{"x": float, "y": float}, ...],
      "map_png": str | None,            # assets 상대 경로
      "cells": [                        # 보정이 필요한 셀만(적합 제외)
        {"cx": int, "cy": int, "grade": str, "reason": str,
         "slope_pct": float, "dev_pct": float,
         "correction_text": str}        # 역구배는 방향 문구, 그 외는 크기 문구
      ]
    }
  }
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

기존 `test_report_snapshot.py`의 픽스처 관례를 따라라. 최소 이 다섯:

```python
def test_slope_analysis_carries_design_and_deviation_stats():
    """과업지시서 산출 항목: 구배값·설계기준 대비 편차·평균·표준편차·최대편차."""

def test_slope_snapshot_lists_only_cells_needing_action():
    """적합 셀까지 표에 넣으면 2m 격자 수백 개가 PDF를 채운다.
    보수·재시공·역구배·판정불가만 싣는다."""

def test_reverse_slope_cell_gets_direction_text_not_size_text():
    """★ 역구배 셀에 크기 문구를 내면 '0.0mm 높임' 같은 '고칠 것 없음'이 나온다.
    dashboard/lib/domain/slope-direction.ts:62가 정본이다."""

def test_slope_map_png_is_copied_into_report_assets():
    """과업지시서가 PNG(시각자료)를 요구한다. 발행본에 박제돼야 한다."""

def test_flatness_snapshot_is_unchanged_by_slope_support():
    """★ 회귀 방지. 기존 평활도 스냅샷이 한 바이트도 안 바뀌어야 한다."""
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd worker && PYTHONPATH=<워크트리>/engine python -m pytest tests/test_report_snapshot.py -v`
Expected: FAIL

- [ ] **Step 3: 구현한다**

`assets.py`는 지금 `surface`(floor/wall)로 분기한다. **`kind`로도 분기**해야 한다. 구배 분석의 `artifacts_dir`에는 `slope_map.png`가 있다.

`snapshot.py`의 `_analysis_entry`에 `kind`를 싣고, `kind == 'slope'`면 위 형태의 `slope` 항목을 만든다. **보정 문구는 `slope-direction.ts`의 규칙을 그대로 옮겨라** — 그 파일을 읽고 역구배 분기를 먼저 확인해라.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd worker && PYTHONPATH=<워크트리>/engine python -m pytest -q`
Expected: 191 + 5 = **196 이상**

- [ ] **Step 5: 변이 실험**

무변이(no-op) 기준선 먼저. 그다음:
1. 역구배 셀에 크기 문구를 낸다 → 잡히는가 ★
2. 적합 셀까지 표에 싣는다 → 잡히는가
3. `slope_map.png` 복사를 뺀다 → 잡히는가
4. 편차 통계 중 표준편차를 뺀다 → 잡히는가
5. **평활도 스냅샷의 필드 하나를 바꾼다** → 회귀 테스트가 잡는가

**각 변이가 "왜" 잡혔는지까지 확인해라.** 이 저장소는 "잡히긴 했는데 엉뚱한 이유"를 두 번 겪었다.

- [ ] **Step 6: 커밋**

```bash
git add worker/
git commit -m "feat(worker): 보고서 스냅샷·자산에 구배 분석 분기"
```

---

## Task 2: 워커 - 보고서 템플릿에 구배 장

**Files:**
- Modify: `worker/flatworker/report/templates/report.html.j2`
- Test: `worker/tests/test_report_html.py`(있으면) 또는 `test_report_e2e.py`

**Interfaces:**
- Consumes: Task 1이 만든 스냅샷의 `slope` 항목(위 형태 그대로)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```python
def test_slope_chapter_renders_design_and_deviation_table():
    """과업지시서 산출 항목 5개가 표에 있다."""

def test_slope_chapter_shows_map_png_and_drain_points():
    """PNG 시각자료와 배수구 위치가 보고서에 있다."""

def test_reverse_cells_are_visually_distinct_in_the_table():
    """역구배는 색만으로 구별하면 안 된다(스펙 §7.2) - 문구로도 구별된다."""

def test_report_without_slope_analysis_has_no_empty_slope_chapter():
    """★ 평활도만 있는 보고서에 빈 구배 장이 박제되면 안 된다.
    단계 C 주석이 경고한 바로 그 실패다."""
```

- [ ] **Step 2~4: 구현 후 통과 확인**

기존 템플릿의 장 번호 구조를 따라라(1. 기본 정보 / 2. 분석 개요 / 3. 구간별 결과 …). **구배 장을 어디에 넣을지 판단하고 근거를 보고해라.** 장 번호를 밀었다면 **템플릿 안의 모든 상호참조를 전수로 고쳐라.**

- [ ] **Step 5: 실제 PDF를 렌더해 눈으로 확인해라 ★**

```bash
cd worker && PYTHONPATH=<워크트리>/engine python -m pytest -q -m browser
```
`browser` 마커 테스트가 실제 Chromium을 띄운다. **한글이 네모 상자가 아닌지, 표가 페이지를 넘어가며 깨지지 않는지 눈으로 확인해라.** 못 하면 "못 했다"고 그대로 보고해라.

- [ ] **Step 6: 변이 + 커밋**

변이: 구배 장 조건을 항상 참으로 / 역구배 문구 구별 제거 / PNG 삽입 제거.

```bash
git add worker/
git commit -m "feat(worker): 보고서 템플릿에 구배 장"
```

---

## Task 3: 대시보드 - 보고서 후보에 구배 편입

**Files:**
- Modify: `dashboard/app/reports/new/page.tsx`, `dashboard/components/report/report-create-form.tsx`
- Test: 각 `__tests__/`

**Interfaces:**
- Consumes: `analyses.kind`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```tsx
it('구배 분석이 보고서 후보에 나타난다', ...)
it('후보 목록에서 평활도와 구배를 문구로 구별한다', ...)  // 색만으로 구별하지 않는다
it('완료되지 않은 구배 분석은 후보에 없다', ...)
it('재판정 중(judge.state=processing)인 구배 분석도 후보에 나타난다', ...)
```

**마지막 것을 판단해라** — 재판정 중인 분석을 보고서에 넣으면 옛 판정이 박제된다. 스펙과 코드를 확인하고 **근거와 함께 결정**해라.

- [ ] **Step 2~4: 구현 후 통과 확인**

`.eq('kind', 'flatness')`를 **지우지 말고 넓혀라** — `.in('kind', ['flatness', 'slope'])`. 그리고 **단계 C 주석이 경고한 "육안 구별 불가"를 실제로 해소해라**: 후보 목록에 종류를 문구로 표시한다(`ANALYSIS_KIND_LABEL`이 이미 `flatness: '평활도', slope: '구배'`로 있다).

**주석도 갱신해라.** 지금 주석은 "보고서에서 구배를 제외한다"고 단언한다 — 사실이 아니게 된다.

- [ ] **Step 5: 변이 + 실화면 확인**

무변이 기준선 먼저(`--reporter=basic` 금지 — vitest 4에 없어 **조용히 크래시**한다).

변이: `kind` 필터를 다시 `flatness`만으로 / 종류 표시 제거 / `status='done'` 조건 제거.

**실제로 띄워 확인해라.** 못 하면 못 했다고 보고해라.

- [ ] **Step 6: 커밋**

```bash
git add dashboard/
git commit -m "feat(dashboard): 보고서 후보에 구배 분석 편입"
```

---

## Task 4: 문서 갱신

**Files:**
- Modify: `docs/service-report.md`(한계 14 → 이행으로), `docs/DEPLOY.md`(스모크), `docs/superpowers/specs/2026-08-02-slope-analysis-design.md`

**Interfaces:**
- Consumes: Task 1~3의 결과

- [ ] **Step 1: 용역 결과 보고서의 한계 14를 갱신한다**

단계 G Task 2가 **"PDF 미이행"을 한계 14로 적었다.** 이제 이행됐으므로 그 항목을 **이행으로 바꾸고**, 과업지시서 산출 형식 3종(CSV·PNG·PDF)이 전부 채워졌다고 적어라. **이행 현황 요약표도 함께 고쳐라** — 한 곳만 고치면 문서가 자기와 모순된다.

- [ ] **Step 2: `docs/DEPLOY.md` 스모크에 구배 PDF 항목 추가**

**이 문서는 여섯 번 Critical을 냈고 전부 "존재하지 않는 것을 안내하거나, 새로 생긴 것을 아무도 안 본다"였다.** 새 기능이 들어왔으니 스모크에 넣어라. **네가 쓴 절차를 직접 따라가 실제 화면·코드와 대조해라.**

- [ ] **Step 3: 스펙 갱신**

§10 구현 순서에 단계 H를 더하고, 산출 형식 관련 서술이 있으면 맞춘다.

- [ ] **Step 4: U+2014 0건 확인 + 커밋**

```bash
git add docs/
git commit -m "docs: 구배 PDF 이행 반영 (한계 14 해소)"
```

---

## 완료 조건

- [ ] 네 스위트: engine **244** / worker **196+** / dashboard **458+** / `npm run build`
- [ ] 구배 분석으로 PDF가 실제로 생성된다 (**browser 마커 테스트로 증명**)
- [ ] 과업지시서 산출 항목 5개(구배값·설계 대비 편차·평균편차·표준편차·최대편차)가 보고서에 있다
- [ ] **역구배 셀에 크기 문구가 나오지 않는다** (**변이로 증명**)
- [ ] **평활도만 있는 보고서에 빈 구배 장이 없다** (**변이로 증명**)
- [ ] **기존 평활도 보고서가 회귀하지 않았다** (**변이로 증명**)
- [ ] 후보 목록에서 평활도와 구배가 **문구로** 구별된다
- [ ] 한글이 PDF에서 네모 상자가 아니다 (**실제 렌더로 확인**)
- [ ] 용역 결과 보고서의 한계 14가 이행으로 갱신됐고 요약표와 일치한다
- [ ] 사용자 대면 문자열에 U+2014 0건

## 범위 밖

- 정합·병합 스캔의 PDF 보고서 — 병합 스캔의 분석 결과는 평활도/구배 어느 쪽이든 기존 경로를 탄다
- 보고서 템플릿 전면 재설계
- 구배 전용 히스토그램 — 평활도의 편차 히스토그램과 의미가 달라 별도 판단이 필요하다. 필요하면 후속

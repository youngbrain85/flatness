# 세부과업 4 단계 F: 정합 엔진 + 정합 화면 + 병합 스캔

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 두 스캔을 사용자가 찍은 대응점으로 러프 정합한 뒤 ICP로 정밀화하고, 겹친 결과를 서브셀 중앙값 점군 하나로 병합해 새 스캔으로 만든다.

**Architecture:** 엔진에 `core/registration.py`(Umeyama 닫힌 해 + trimmed point-to-point ICP)와 `io/ply_writer.py`를 추가한다. `register` 잡이 두 원본을 **순차로** 읽어 서브셀 중앙값 점군을 만들고, 그 위에서 ICP를 돌린 뒤 변환을 적용해 하나로 합쳐 새 `scans` 행을 만든다. 대시보드는 단계 E가 만든 **무장식 PNG** 위에서 클릭을 받아 사이드카 좌표 계약으로 월드 좌표를 역산한다.

**Tech Stack:** numpy(SVD) · `scipy.spatial.cKDTree` · PostgreSQL enum 마이그레이션 011/012 · Next.js 16 + React canvas

## Global Constraints

- **사용자 대면 문자열에 U+2014(—) 0건.** 주석·개발문서는 관례상 허용. Git Bash에서 `$'\u2014'`가 확장되지 않으므로 **리터럴 글리프**로 검색한다
- 사용자와의 대화·주석·화면 문구는 **한국어**
- **Open3D·PCL을 쓰지 않는다.** 사용자 승인 하의 의도적 이탈이며 `docs/service-report.md` §3.2에 기록돼 있다. `scipy>=1.11`은 이미 엔진 의존성이다(`engine/pyproject.toml:9`)
- **워커 테스트는 반드시 해당 워크트리의 engine을 PYTHONPATH로 준다**:
  `cd <워크트리>/worker && PYTHONPATH=<워크트리>/engine python -m pytest -q`
  `flatness`가 editable 설치(`__editable__.flatness_engine-0.1.0.pth`)로 항상 `D:\Projects\Flatness\engine`(main)를 가리키기 때문이다. 빼면 브랜치의 새 모듈이 안 보여 수집 단계에서 죽거나, 더 나쁘게는 **옛 코드로 조용히 통과**한다
- **이 계획은 실행 완료됐다**(단계 F main 머지 880b283, 계보 경고 후속 머지 58b08bc).
  아래 기준선·Task별 기대치는 **작성 시점의 역사적 기록**이며 현재 값이 아니다.
  **머지 후 실측 현재값: engine 244 / worker 191 / dashboard 455**(2026-08-05).
  - 계획 작성 시점 기준선은 `engine 203 / worker 151 / dashboard 326`이었다. 그 뒤 F9를
    정하다 발견한 **계보 경고 미구현**(업로드 화면이 융합 메시에 "경고가 표시됩니다"라고
    안내하는데 그 경고를 만드는 코드가 어디에도 없었다)을 별도 브랜치에서 고치면서
    워커 +17 / 대시보드 +2가 늘었고(`worker/flatworker/lineage.py`), 단계 F 본 구현이
    나머지를 늘렸다. 두 갈래가 각자의 기준선 위에서 자랐기 때문에 이 문서의 Task별
    덧셈("168 + 7" 등)은 서로 더할 수 있는 수가 아니다 — 현재값은 위 실측을 쓴다
- **`002_functions_seed.sql`은 어떤 경우에도 재실행 금지**(criteria 시드에 `on conflict`가 없어 23505로 죽고, 003·004가 확장한 잡 큐 함수 3종을 P2 정의로 강등시킨다)
- 변이 테스트에는 **무변이(no-op) 기준선을 먼저** 넣어 하네스 생존을 확인한다. `vitest --reporter=basic`은 vitest 4에 없어 **조용히 크래시**(종료코드 0)한다
- `git add`·`git commit`에는 **항상 경로를 명시**한다. 경로 없는 `git add`·`git checkout --`·`git stash`는 같은 워크트리의 다른 작업을 파괴한다(실제 사고 2회)

---

## 설계 결정

### F1. §9.3 복원 게이트를 교체한다 ★ (스펙 수정)

스펙 §9.3은 "노이즈 1mm, 중첩 50%에서 회전 오차 ≤0.1°, **평행이동 오차 ≤1mm**"를 요구한다. 사전조사에서 Umeyama + trimmed ICP를 구현해 **스펙 자신의 조건으로 실측한 결과 달성 불가능**이다:

| 픽스처 | 초기 면내 오차 | ICP 후 면내 | ICP 후 z |
|---|---|---|---|
| 무작위 순수 평면 | 169mm | **160.0mm** | −0.000mm |
| 범프+단차 | 170mm | 149.4mm | 0.756mm |
| 바닥+벽 2면 | 108mm | 135.5mm | −1.783mm |
| **대조: 지터 0** | 0mm | **0.002mm** | −0.001mm |
| 중첩 10% | 129mm | **2713mm** | −2.164mm |

**원인은 버그가 아니라 구조적 퇴화다.** 수평 평면은 면내 평행이동 2자유도와 yaw에 대해 **정보를 전혀 주지 않는다** — 평면을 자기 위에서 밀어도 점군이 그대로다. 지터 0 대조군이 0.002mm를 내는 것이 ICP가 멀쩡함을 증명한다.

**그런데 이 실패는 목적상 거의 무해하다.** 면내 오차 `d`가 병합 서브셀 중앙값 z에 주는 영향은 `국소 경사 × d`다. 구배 2%에서 150mm면 **3.00mm**이고, 요구 정밀도 ±5mm 안이다.

**교체 게이트:**

| 게이트 | 값 | 이유 |
|---|---|---|
| z 평행이동 | ≤ 1mm | 원 스펙 유지. 수평면은 z에 대해 퇴화하지 않는다 |
| 면내·회전 | 지터 0에서 ≤ 1mm / ≤ 0.1° | 비퇴화 경로에서 알고리즘 정확성 증명 |
| **목적 적합성** | 중첩 영역 서브셀 중앙값 z 불일치 ≤ 노이즈 + 1mm | 실제로 쓰이는 양을 직접 잰다 |
| 중첩 10% 미만 | **실패로 끝난다** | 원 스펙 유지 |

**대응점 ±5cm 오차에서 ICP가 회복하는지**도 원 스펙대로 검증한다. 단, 회복 대상은 z와 목적 적합성 게이트다.

**스펙 §4.4의 성공 임계 `최종 RMSE ≤ 2mm`는 그대로 유지한다.** 이것은 복원 게이트와 다른 양이다 — 복원 게이트는 "알려진 변환을 얼마나 되찾았나"이고, RMSE는 "정합 후 두 점군이 얼마나 붙었나"다. 면내 퇴화는 후자를 해치지 않는다(평면을 자기 위에서 밀어도 점 대 점 거리는 그대로다). `RegistrationResult.converged`는 **수렴 + 중첩 ≥10% + RMSE ≤ 2mm** 셋을 모두 만족할 때만 참이다. RMSE 초과 시 `failure_reason`은 `"정합 오차가 큽니다(RMSE {n}mm > 2mm). 대응점을 다시 찍어 주세요."`

**이 교체 사실과 실측 표를 `docs/superpowers/specs/2026-08-02-slope-analysis-design.md` §9.3에 기록한다**(단계 G가 용역 결과 보고서에 옮긴다). 숨기지 않는다.

### F2. 정합 엔진은 직접 구현한다

numpy SVD 약 15줄 + `scipy.spatial.cKDTree` 약 30줄이면 끝난다. Open3D는 약 70줄을 위해 리눅스 휠 400MB+ 와 libGL/libgomp를 끌어온다.

### F3. ICP는 서브셀 중앙값 점군에서 돈다, 원본이 아니다

사전조사 실측: 1.5~2초 대 9~10초. 그리고 **두 소스를 순차로 처리한다** — `build_subcell_grid`의 정렬 버퍼가 점당 12B라, 두 개를 동시에 들면 실측 피크 1.31GiB 위에 겹쳐 쌓여 2GiB 게이트를 넘긴다.

### F4. `register` 잡 타입은 마이그레이션 011/012로 나눈다

008/009 선례를 **그대로** 따른다. 011은 enum 추가만, 012는 그 값을 쓰는 것 전부 + `pg_enum` 카탈로그 가드. 같은 트랜잭션에서 새 enum 값을 쓰면 PostgreSQL이 `unsafe use of new value`로 막고, Supabase SQL Editor는 파일 전체를 한 트랜잭션으로 실행한다.

### F5. `jobs_dedup`을 재정의해야 한다 ★ 조용한 실패

현재 정의(`001_schema.sql:247`):

```sql
create unique index jobs_dedup on jobs(type, (coalesce(payload->>'analysis_id', payload->>'scan_id', payload->>'report_id')))
  where status in ('queued', 'processing');
```

`register` 잡 payload에는 `registration_id`만 있어 **세 키가 전부 없다** → `coalesce`가 NULL → **유니크 인덱스에서 NULL은 서로 구별되므로 중복이 전부 통과한다.** 사용자가 "정합 실행"을 두 번 누르면 무거운 잡이 두 개 돈다. `payload->>'registration_id'`를 coalesce에 넣는다.

### F6. 대응점 Z는 사이드카에서 읽는다

클릭은 XY만 준다. Z는 그 셀의 `median_z`다. **NaN 셀이면 거부하고 한국어로 이유를 말한다** — 0으로 대체하거나 이웃에서 끌어오면 대응점이 조용히 틀린다.

### F7. 좌표 계약 (단계 E 확정, 실측 검증됨)

```
사이드카 shape = [ny, nx]        ← 세로 먼저
이미지 크기    = (가로 nx, 세로 ny)
픽셀 (px,py) 좌상단 원점 0-index -> 격자:  ix = px,  iy = ny - 1 - py
격자 -> 월드(파일 단위):
    world_x = bbox_min[0] + (ix + 0.5) * subcell_m_file
    world_y = bbox_min[1] + (iy + 0.5) * subcell_m_file
```

**정본은 `engine/flatness/outputs/height_view.py`의 `render_height_view_plain` 독스트링이다.** 단계 E 최종 리뷰가 오프센터 범프로 전수 검증했다(예측 픽셀 12개 == 실측 12개, 월드 환산 오차 0.00, 전체 이미지 대조 최대 오차 0.70/255).

**클릭 대상은 무장식 PNG(`height_view_plain.png`)다.** 화면에 크게 보이는 장식 PNG는 matplotlib 여백 때문에 역산이 불가능하다. 산출물 3종은 **전부-있음 아니면 전부-없음**이다(`height_view_path`는 업로드 성공 이후에만 설정된다).

### F8. 병합 산출물은 서브셀 중앙값 점군

중첩 서브셀에 두 소스의 점이 함께 들어가 중앙값이 뽑히므로 가중치 없이 이상치에 강하다. 동시에 50MB 상한도 푼다(5cm 서브셀이면 600 m²가 약 24만 점, 3MB). 분석은 어차피 서브셀 중앙값만 쓰므로 **결과가 동일하다.**

### F9. 병합 스캔의 lineage는 새 값 `registered`다

기존 `data_lineage`는 `('raw', 'fused_mesh', 'unknown')`이다. `fused_mesh`를 재사용하면 안 된다 — 업로드 화면이 그 값에 **"앱이 스무딩한 데이터라 실제보다 양호하게 나올 수 있습니다"** 라는 경고를 붙이고 있고, 보고서 라벨도 "융합 메시"다. 정합 병합은 스캐너 앱의 스무딩이 아니라 **원시 점군 두 개의 서브셀 중앙값**이라 그 서술이 거짓이 된다.

> 이 근거는 계획 작성 이후 **더 강해졌다**: 그때는 안내 문구뿐이었지만, 이제 워커가
> `scans.lineage='fused_mesh'`인 스캔의 분석에 실제로 `fused_mesh_smoothed` 경고를 붙인다
> (`worker/flatworker/lineage.py`). `fused_mesh`를 재사용하면 병합 스캔의 모든 분석 결과와
> 보고서에 "스캐너 앱이 다듬은 데이터"라는 **거짓 경고가 인쇄된다**.

`alter type data_lineage add value 'registered'`를 011에 **함께** 넣는다(enum 추가 두 개는 서로 사용하지 않으므로 같은 트랜잭션에서 안전하다). 라벨은 **"정합 병합"**.

`worker/tests/test_report_labels.py:54`가 `len(lineage) == 3`을 단언하므로 **그 테스트가 강제로 세 곳(엔진 없음 / 워커 `report/labels.py` / 대시보드 `lib/domain/labels.ts`·`types.ts`)의 일관성을 잡는다.** 4로 고쳐라.

**업로드 화면의 lineage 선택지에는 넣지 마라** — 시스템이 만드는 값이지 사용자가 고르는 값이 아니다.

### F10. `registrations`는 `analyses.params.judge` 관례를 따르지 않는다

재판정(단계 D)은 `analyses.status`를 건드리면 안 돼서 `params.judge`로 상태를 우회 전달했다. 정합은 **자기 테이블**이 있으므로 `registrations.status`를 그대로 쓴다. `jobs` 테이블은 RLS 정책이 0개라 대시보드가 못 읽으므로, 진행 상태는 반드시 `registrations`에 있어야 한다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `engine/flatness/core/registration.py` | Umeyama 닫힌 해, trimmed ICP, 결과 dataclass. **I/O 없음** |
| `engine/flatness/io/ply_writer.py` | float32 binary PLY 쓰기. 프로덕션용(지금은 테스트 픽스처에만 있다) |
| `engine/tests/test_registration.py` | 교체 게이트 검증 |
| `engine/tests/test_ply_writer.py` | 왕복(write → 기존 리더로 read) |
| `supabase/migrations/011_register_enums.sql` | **enum 추가 두 개만** |
| `supabase/migrations/012_register_support.sql` | `registrations` 테이블·RLS·`jobs_dedup` 재정의·잡 큐 함수 확장·카탈로그 가드 |
| `worker/flatworker/registration.py` | 스캔 두 개 → 서브셀 격자 → ICP → 병합 점군 → 새 스캔 행. `jobs.py` 비대화 방지 |
| `worker/flatworker/jobs.py` | `handle_register` 추가 |
| `worker/flatworker/runner.py` | 핸들러 표에 `register` 등록 |
| `dashboard/app/registrations/[id]/page.tsx` | 정합 화면 |
| `dashboard/components/registration/point-picker.tsx` | 무장식 PNG 위 클릭 → 월드 좌표 |
| `dashboard/lib/domain/height-view.ts` | 좌표 환산 + 파일명 유도 헬퍼(**단일 정본**) |

---

## Task 1: 구배 지도에 배수구 마커 (백로그 티켓 81)

단계 F 본체와 독립이지만 **단계 G보다 먼저** 해야 한다. G가 이 PNG를 용역 결과 보고서 자산으로 박제하고 나면(설계 결정 D8: 발행본은 산출물을 생성 시점에 복사해 스냅샷으로 굳힌다) 나중에 고쳐도 **이미 발행된 보고서 안의 그림은 그대로 남아** 새 분석과 옛 발행본이 서로 다른 정보를 담게 된다.

**Files:**
- Modify: `engine/flatness/outputs/slope_map.py` (`render_slope_map` 시그니처)
- Modify: `engine/flatness/core/pipeline.py` (`judge_slope_cells`의 `render_slope_map` 호출)
- Test: `engine/tests/test_slope_map.py`

**Interfaces:**
- Produces: `render_slope_map(graded, out_path, cell_m=2.0, drain_points=None)` — `drain_points`는 `[{"x": float, "y": float}, ...]` 또는 `None`

**문제**: 대시보드 Canvas 화면(`dashboard/components/analysis/slope-heatmap-view.tsx`의 `DRAIN_COLOR` 블록)은 배수구에 파란 원을 찍는데 엔진 PNG에는 없다. 판정표에서 "이 셀이 왜 역구배(재시공)인가"의 답은 "배수구가 어디 있고 물이 그 반대로 흐르기 때문"인데, **종이 PDF를 받는 발주처는 `stats.drain_points` jsonb를 볼 방법이 없다.**

**싼 이유**: `judge_slope_cells`(`core/pipeline.py:171`)는 `render_slope_map`을 부르는 시점(`core/pipeline.py:239`)에 이미 지역 변수로 `drain_points`를 갖고 있다(자기 인자이고 `grade_slope_cells`에도 이미 넘긴다). 호출에 인자 하나만 더하면 된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```python
def test_render_slope_map_draws_drain_markers(tmp_path):
    """배수구 마커가 실제 픽셀로 찍히는지 PNG를 디코드해 확인한다.

    스파이(plot 호출 인자 단언)가 아니라 실제 픽셀을 읽는다 - 이 저장소는
    "인자는 맞는데 결과가 다르다"로 반복해서 데였다.
    """
    graded = _graded_fixture(nx=4, ny=3, cell_m=2.0)   # 아래 Step 3에서 정의
    a = tmp_path / "no_drain.png"
    b = tmp_path / "with_drain.png"
    render_slope_map(graded, a, cell_m=2.0)
    render_slope_map(graded, b, cell_m=2.0, drain_points=[{"x": 1.0, "y": 1.0}])

    import matplotlib.image as mpimg
    ia, ib = mpimg.imread(str(a)), mpimg.imread(str(b))
    assert ia.shape == ib.shape, "마커 유무가 이미지 크기를 바꾸면 안 된다"
    # 마커가 실제로 픽셀을 바꿨는가
    assert not np.allclose(ia, ib), "drain_points를 넘겼는데 그림이 동일하다"


def test_render_slope_map_without_drain_points_is_unchanged(tmp_path):
    """기존 호출부(인자 미전달)가 그대로 동작한다 - 평활도 경로 회귀 방지."""
    graded = _graded_fixture(nx=4, ny=3, cell_m=2.0)
    out = tmp_path / "m.png"
    assert render_slope_map(graded, out, cell_m=2.0) == out.name
    assert out.stat().st_size > 0


def test_judge_slope_cells_passes_drain_points_to_map(tmp_path, monkeypatch):
    """파이프라인이 배수구를 지도 렌더러까지 실제로 전달한다.

    이 단언이 없으면 render_slope_map만 고치고 호출부를 안 고쳐도 통과한다
    (이 저장소가 반복해 겪은 "테스트가 회귀를 못 잡는" 양식).
    """
    seen = {}
    import flatness.core.pipeline as pipeline

    def _spy(graded, out_path, cell_m=2.0, drain_points=None):
        seen["drain_points"] = drain_points
        out_path.write_bytes(b"\x89PNG\r\n\x1a\n")
        return out_path.name

    monkeypatch.setattr(pipeline, "render_slope_map", _spy)
    _run_judge_slope_cells(tmp_path, drain_points=[{"x": 3.0, "y": 5.0}])
    assert seen["drain_points"] == [{"x": 3.0, "y": 5.0}]
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd engine && python -m pytest tests/test_slope_map.py -v`
Expected: FAIL — `render_slope_map() got an unexpected keyword argument 'drain_points'`

- [ ] **Step 3: 구현한다**

`_graded_fixture`와 `_run_judge_slope_cells`는 기존 `tests/test_slope_map.py`·`tests/test_slope_judged.py`의 픽스처 관례를 그대로 따라 만든다(같은 파일 안에 이미 유사한 헬퍼가 있으면 재사용한다).

`render_slope_map`에 `drain_points=None` 키워드를 더하고, 축 좌표계(미터)에 마커를 찍는다. **대시보드와 같은 파란 계열**을 쓴다(`slope-heatmap-view.tsx`의 `DRAIN_COLOR` 값을 읽어 맞춘다). 마커는 셀 격자 위에 그려야 하므로 `zorder`를 셀 패치보다 높게 준다.

`core/pipeline.py`의 호출을 `render_slope_map(graded, out_dir / "slope_map.png", cell_m=cell_m, drain_points=drain_points)`로 바꾼다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd engine && python -m pytest -q`
Expected: 203 + 3 = **206 passed**

- [ ] **Step 5: 변이 실험**

무변이 기준선을 먼저 돌린 뒤:
1. `core/pipeline.py`에서 `drain_points=` 인자를 다시 뺀다 → `test_judge_slope_cells_passes_drain_points_to_map`이 빨간불이어야 한다
2. `render_slope_map` 안에서 마커 그리기를 `if False:`로 막는다 → `test_render_slope_map_draws_drain_markers`가 빨간불이어야 한다

각각 실패한 테스트 이름을 보고한다.

- [ ] **Step 6: 백로그 티켓 81을 닫는다**

`docs/superpowers/plans/2026-07-28-p1b-backlog-notes.md`의 81번에 `[해결: 커밋 <해시>]`를 단다.

- [ ] **Step 7: 커밋**

```bash
git add engine/ docs/
git commit -m "feat(engine): 구배 지도 PNG에 배수구 마커 (백로그 81)"
```

---

## Task 2: 정합 엔진 (Umeyama + trimmed ICP) + PLY 쓰기

**Files:**
- Create: `engine/flatness/core/registration.py`
- Create: `engine/flatness/io/ply_writer.py`
- Test: `engine/tests/test_registration.py`, `engine/tests/test_ply_writer.py`

**Interfaces:**
- Consumes: `flatness.core.subcell.SubcellGrid`(필드 `size_m, origin, shape, median_z, counts, bimodal`), `flatness.io.reader.CloudInfo`(`n_points, bbox_min, bbox_max`)
- Produces:
  ```python
  @dataclass
  class RegistrationResult:
      transform: np.ndarray      # 4x4 float64, 동차 좌표. B를 A에 맞춘다
      rmse_m: float              # 최종 RMSE (미터). DB는 mm로 저장한다 - 워커가 *1000
      iterations: int
      converged: bool
      overlap_ratio: float       # trimmed ICP가 실제로 쓴 대응 비율
      failure_reason: str | None # 실패 시 한국어 사유, 성공이면 None

  def umeyama_rigid(src, dst) -> np.ndarray
      """src(N,3) -> dst(N,3) 강체 변환 4x4. 축척 고정(=1). N>=3."""

  def icp_refine(src_pts, dst_pts, init_transform, *,
                 max_iterations=50, rmse_rel_tol=1e-4,
                 trim_ratio=0.8, max_pair_dist_m=0.5) -> RegistrationResult
      """point-to-point trimmed ICP. cKDTree로 대응 탐색."""

  def register_clouds(src_pts, dst_pts, correspondences_src, correspondences_dst,
                      **icp_kwargs) -> RegistrationResult
      """대응점으로 Umeyama -> ICP. 대응점 3쌍 미만이면 ValueError."""

  def grid_to_points(grid) -> np.ndarray
      """SubcellGrid -> (M,3) 점군. NaN 서브셀은 뺀다. 좌표는 셀 중심."""
  ```
  `ply_writer`: `write_ply(points, path)` — float32 binary little-endian, `x y z` 3속성

- [ ] **Step 1: 실패하는 테스트를 쓴다 (교체 게이트, 설계 결정 F1)**

```python
_NOISE_SD_M = 0.001          # 노이즈 1mm (스펙 §9.3)
_KNOWN_YAW_DEG = 7.0
_KNOWN_SHIFT_M = np.array([0.35, -0.22, 0.011])


def _apply(pts, yaw_deg, shift):
    c, s = np.cos(np.radians(yaw_deg)), np.sin(np.radians(yaw_deg))
    R = np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])
    return pts @ R.T + shift


def test_umeyama_recovers_known_transform_exactly():
    """대응점에 오차가 없으면 닫힌 해가 변환을 정확히 복원한다."""
    src = np.array([[0.0, 0.0, 0.0], [4.0, 0.0, 0.02], [0.0, 3.0, -0.01], [4.0, 3.0, 0.03]])
    dst = _apply(src, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    T = umeyama_rigid(src, dst)
    got = (np.c_[src, np.ones(len(src))] @ T.T)[:, :3]
    assert np.abs(got - dst).max() < 1e-9
    # 축척이 고정인가: 회전 블록이 정규직교여야 한다
    R = T[:3, :3]
    assert np.abs(R @ R.T - np.eye(3)).max() < 1e-9
    assert abs(np.linalg.det(R) - 1.0) < 1e-9


def test_zero_jitter_recovers_gate_rotation_and_translation():
    """비퇴화 경로: 지터가 없으면 회전 <=0.1도, 평행이동 <=1mm (설계 결정 F1).

    수평 평면은 면내 2자유도와 yaw에 대해 구조적으로 퇴화하지만, 대응점에
    오차가 없으면 그 퇴화가 발동하지 않는다. 이 테스트가 알고리즘 자체의
    정확성을 증명한다 - 아래 z 게이트가 통과해도 이것이 깨지면 구현이 틀렸다.
    """
    a = bumpy_floor(size=(8.0, 6.0), seed=1)          # 아래 Step 3에서 정의
    b = _apply(a, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    corr_idx = [0, len(a) // 3, 2 * len(a) // 3, len(a) - 1]
    res = register_clouds(b, a, b[corr_idx], a[corr_idx])
    assert res.converged, res.failure_reason
    yaw_err = abs(np.degrees(np.arctan2(res.transform[1, 0], res.transform[0, 0])) + _KNOWN_YAW_DEG)
    assert yaw_err <= 0.1, f"회전 오차 {yaw_err:.4f}도"
    shift_err = np.abs(res.transform[:3, 3] + _KNOWN_SHIFT_M)
    assert shift_err.max() <= 0.001, f"평행이동 오차 {shift_err.max()*1000:.3f}mm"


def test_z_translation_gate_survives_noise_and_click_error():
    """노이즈 1mm + 대응점 ±5cm 오차에서도 z 평행이동 오차 <=1mm.

    면내는 퇴화라 게이트를 걸지 않는다(설계 결정 F1의 실측 표 참고).
    z는 수평면에서도 퇴화하지 않으므로 원 스펙 값을 그대로 유지한다.
    """
    rng = np.random.default_rng(7)
    a = bumpy_floor(size=(8.0, 6.0), seed=2)
    b = _apply(a, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M) + rng.normal(0, _NOISE_SD_M, (len(a), 3))
    corr_idx = [0, len(a) // 3, 2 * len(a) // 3, len(a) - 1]
    jitter = rng.normal(0, 0.05, (4, 3))              # 화면 클릭 정확도 ±5cm
    res = register_clouds(b, a, b[corr_idx] + jitter, a[corr_idx])
    assert res.converged, res.failure_reason
    z_err = abs(res.transform[2, 3] + _KNOWN_SHIFT_M[2])
    assert z_err <= 0.001, f"z 오차 {z_err*1000:.3f}mm"


def test_purpose_fitness_overlap_median_z_discrepancy():
    """목적 적합성 게이트: 중첩 영역의 서브셀 중앙값 z 불일치 <= 노이즈 + 1mm.

    면내 오차가 실제로 해치는 것은 "병합된 서브셀 중앙값 z"뿐이다. 그 양을
    직접 잰다 - 면내 mm를 재는 대리 지표보다 이것이 진짜 계약이다.
    """
    a = bumpy_floor(size=(8.0, 6.0), seed=3)
    b_true = _apply(a, _KNOWN_YAW_DEG, _KNOWN_SHIFT_M)
    rng = np.random.default_rng(11)
    b = b_true + rng.normal(0, _NOISE_SD_M, (len(a), 3))
    corr_idx = [0, len(a) // 3, 2 * len(a) // 3, len(a) - 1]
    res = register_clouds(b, a, b[corr_idx], a[corr_idx])
    aligned = (np.c_[b, np.ones(len(b))] @ res.transform.T)[:, :3]
    disc = _overlap_median_z_discrepancy(a, aligned, subcell_m=0.05)   # Step 3에서 정의
    assert disc <= _NOISE_SD_M + 0.001, f"중첩 z 불일치 {disc*1000:.3f}mm"


def test_low_overlap_fails_instead_of_pretending_success():
    """중첩 10% 미만이면 성공을 가장하지 않고 실패로 끝난다 (스펙 §9.3 유지)."""
    a = bumpy_floor(size=(8.0, 6.0), seed=4)
    b = _apply(a, _KNOWN_YAW_DEG, np.array([7.5, 0.0, 0.0]))   # 거의 겹치지 않게 밀어낸다
    corr_idx = [0, len(a) // 3, 2 * len(a) // 3, len(a) - 1]
    res = register_clouds(b, a, b[corr_idx], a[corr_idx])
    assert not res.converged
    assert res.failure_reason is not None
    assert "중첩" in res.failure_reason


def test_fewer_than_three_correspondences_is_rejected():
    a = bumpy_floor(size=(4.0, 3.0), seed=5)
    with pytest.raises(ValueError, match="대응점"):
        register_clouds(a, a, a[:2], a[:2])


def test_grid_to_points_drops_nan_subcells_and_uses_cell_centers():
    grid = _grid_with_one_nan()          # Step 3에서 정의
    pts = grid_to_points(grid)
    assert np.isfinite(pts).all()
    assert len(pts) == int(np.isfinite(grid.median_z).sum())
    # 셀 중심인가: origin + (i+0.5)*size_m
    assert np.isclose(pts[:, 0].min(), grid.origin[0] + 0.5 * grid.size_m)
```

`test_ply_writer.py`:

```python
def test_write_ply_roundtrips_through_the_production_reader(tmp_path):
    """쓴 것을 기존 리더가 그대로 읽는가. 별도 파서를 만들지 않는다."""
    from flatness.io.reader import read_info, iter_chunks
    pts = np.array([[1.5, -2.25, 0.125], [1000.0, 2000.0, 3.5]], dtype=np.float64)
    p = tmp_path / "m.ply"
    write_ply(pts, p)
    info = read_info(p)
    assert info.n_points == 2
    got = np.concatenate(list(iter_chunks(p)))
    assert np.abs(got - pts.astype(np.float32)).max() == 0.0


def test_write_ply_rejects_empty(tmp_path):
    with pytest.raises(ValueError, match="점이 없"):
        write_ply(np.zeros((0, 3)), tmp_path / "e.ply")
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd engine && python -m pytest tests/test_registration.py tests/test_ply_writer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'flatness.core.registration'`

- [ ] **Step 3: 구현한다**

`bumpy_floor`는 `engine/tests/fixtures/synthetic.py`에 추가한다. **완전 평면을 쓰면 안 된다** — 면내 퇴화가 극단이 되고, 단계 B에서 실제로 겪은 "픽스처가 퇴화해서 변이를 못 잡는" 함정에 빠진다. 무작위 범프를 얹어 **면내 특징이 있는** 바닥을 만든다.

`_overlap_median_z_discrepancy(a, b, subcell_m)`는 테스트 헬퍼로 같은 파일에 둔다: 두 점군을 같은 격자에 넣고 **양쪽 모두 유효한 서브셀**에서 중앙값 차의 절댓값 중앙값을 낸다.

`umeyama_rigid`: 중심 이동 → `H = src_c.T @ dst_c` → `U, S, Vt = svd(H)` → `d = sign(det(Vt.T @ U.T))` → `R = Vt.T @ diag([1,1,d]) @ U.T` → `t = dst_mean - R @ src_mean`. **축척은 곱하지 않는다**(스펙 §4.4: 축척 고정).

`icp_refine`: `cKDTree(dst_pts)`를 한 번만 만들고 반복마다 `query`. `max_pair_dist_m`를 넘는 쌍은 버리고, 남은 것 중 거리 하위 `trim_ratio`만 쓴다(trimmed). 수렴 판정은 **직전 대비 RMSE 상대 변화율 `< rmse_rel_tol`**. `overlap_ratio`는 `쓴 쌍 수 / len(src_pts)`.

**`overlap_ratio < 0.1`이면 `converged=False`, `failure_reason="중첩이 부족합니다(약 {pct}%). 두 스캔이 실제로 겹치는지 확인하세요."`** 로 끝낸다.

`write_ply`: 헤더는 `ply\nformat binary_little_endian 1.0\nelement vertex N\nproperty float x\nproperty float y\nproperty float z\nend_header\n` 후 float32 배열. 기존 `ply_reader.py`가 읽을 수 있는 형태여야 한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd engine && python -m pytest -q`
Expected: 206 + 9 = **215 passed**

- [ ] **Step 5: 변이 실험**

무변이 기준선 먼저. 그다음:
1. `umeyama_rigid`에서 `d = sign(det(...))` 반사 보정을 제거(항상 `d=1`) → 거울 변환이 통과하는가
2. 축척을 곱한다(`s = S.sum() / var_src` 적용) → 축척 고정 단언이 잡는가
3. `overlap_ratio < 0.1` 가드를 제거 → 저중첩 테스트가 잡는가
4. `trim_ratio`를 1.0으로(트리밍 없음) → 어느 게이트가 잡는가
5. `grid_to_points`에서 `+0.5` 셀 중심 보정을 뺀다 → 잡히는가
6. `write_ply`를 `binary_big_endian`으로 → 왕복 테스트가 잡는가

각각 실패한 테스트 이름을 적는다. **잡히지 않는 것이 있으면 테스트가 잘못된 것이니 테스트를 고친다.**

- [ ] **Step 6: 스펙 §9.3을 갱신한다**

`docs/superpowers/specs/2026-08-02-slope-analysis-design.md` §9.3에 **F1의 실측 표와 교체 게이트**를 기록한다. 원 게이트를 지우지 말고 "달성 불가능함이 실측으로 확인되어 교체했다"는 형태로 남긴다.

- [ ] **Step 7: 커밋**

```bash
git add engine/ docs/
git commit -m "feat(engine): Umeyama+trimmed ICP 정합 + PLY 쓰기 (스펙 9.3 게이트 교체)"
```

---

## Task 3: 마이그레이션 011/012

**Files:**
- Create: `supabase/migrations/011_register_enums.sql`
- Create: `supabase/migrations/012_register_support.sql`
- Modify: `docs/DEPLOY.md`, `docs/SUPABASE_SETUP.md`

**Interfaces:**
- Produces: `registrations` 테이블(스펙 §3.6), `job_type`에 `register`, `data_lineage`에 `registered`, `jobs_dedup` 재정의

- [ ] **Step 1: 011을 쓴다 — enum 추가만**

```sql
-- 011: register 잡 타입 + registered lineage (세부과업 4 단계 F)
--
-- ⚠ 이 파일에는 enum 추가 두 문장만 둔다. PostgreSQL은 같은 트랜잭션 안에서
--    새 enum 값을 *사용*하는 것을 막는다(unsafe use of new value). Supabase SQL
--    Editor가 파일 전체를 한 트랜잭션으로 실행하므로, 이 값들을 쓰는 테이블·함수는
--    012에 있다. **011을 Run 한 뒤 012를 별도로 Run 해야 한다.**
--    (두 문장이 함께 있는 것은 안전하다 - 서로를 사용하지 않는다.)
alter type job_type add value if not exists 'register';
alter type data_lineage add value if not exists 'registered';
```

- [ ] **Step 2: 012를 쓴다 — 카탈로그 가드 + 테이블 + dedup + 함수**

> **구현 중 발견 (커밋 `d965563`)**: **012는 008도 전제한다.** 012의 잡 큐 함수 3종은
> 009 본문을 물려받아 `slope_judge` 분기를 계속 포함하는데, 배포 문서는 **008·009를
> 선택 단계로 안내한다.** 008을 건너뛴 채 011·012만 적용하면 파일은 Success로 끝나고,
> 워커가 **아무 잡이나**(register뿐 아니라 precheck·analyze·import·report까지)
> claim 하는 순간 잡 큐 전체가 멎는다. **네 번째 가드**로 `slope_judge` enum 값 존재를
> 확인한다.

009의 가드를 그대로 본떠 **011 없이 012만 Run 하면 즉시 한국어로 거부**하게 한다. 009 주석이 설명한 함정이 여기에도 그대로 적용된다: plpgsql 본문의 SQL은 CREATE 시점에 파싱만 되므로 파일 실행은 성공하고, 나중에 워커가 `register` 잡을 claim하는 순간 잡 큐 전체가 조용히 멎는다.

```sql
do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'job_type' and e.enumlabel = 'register') then
    raise exception '011_register_enums.sql을 먼저 실행하세요 (job_type에 register 값이 없습니다).';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'data_lineage' and e.enumlabel = 'registered') then
    raise exception '011_register_enums.sql을 먼저 실행하세요 (data_lineage에 registered 값이 없습니다).';
  end if;
end $$;

-- ⚠ 정정 (구현 중 발견, 커밋 d965563): 아래 create table은 **쓰면 안 된다.**
-- registrations는 마이그레이션 007이 이미 만들어 두었다(007_slope_analysis.sql:73-100,
-- "단계 F에서 사용, 스키마만 먼저 세운다")이고 007은 사용자 DB에 이미 적용돼 있다.
-- `create table if not exists`는 테이블이 있으면 **본문을 통째로 무시하고 Success로
-- 끝난다** - overlap_ratio·updated_at이 빠진 채 성공 표시가 뜨고 나중에 워커 PATCH가
-- 42703으로 죽는다. 실제 012는 alter로 차이만 메웠다:
--     alter table registrations add column if not exists overlap_ratio double precision;
--     alter table registrations add column if not exists updated_at timestamptz not null default now();
-- status는 007의 registration_status enum을 유지한다(값 집합이 정확히 일치하며,
-- text로 내리면 오타 상태값을 DB가 더는 막지 않는다). RLS도 007의 all_auth를 쓴다.
-- 아래 블록은 스펙 §3.6의 목표 스키마를 참고용으로 남긴 것이다.
create table if not exists registrations (   -- 참고용. 실제 012는 alter를 쓴다
  id uuid primary key default gen_random_uuid(),
  source_scan_ids uuid[] not null,
  correspondences jsonb not null default '[]'::jsonb,
  transform jsonb,
  rmse_mm double precision,
  iterations int,
  overlap_ratio double precision,
  status text not null default 'awaiting_points',
  error_text text,
  result_scan_id uuid references scans(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table registrations enable row level security;
create policy registrations_all_auth on registrations for all to authenticated using (true) with check (true);
```

**`jobs_dedup` 재정의** (설계 결정 F5). 인덱스를 지우고 다시 만든다:

```sql
-- register 잡 payload에는 registration_id만 있어 기존 coalesce가 NULL을 낸다.
-- 유니크 인덱스에서 NULL은 서로 구별되므로 중복 엔큐가 전부 통과한다(조용한 실패).
drop index if exists jobs_dedup;
create unique index jobs_dedup on jobs(type, (coalesce(
  payload->>'analysis_id', payload->>'scan_id', payload->>'report_id', payload->>'registration_id')))
  where status in ('queued', 'processing');
```

잡 큐 함수(`fn_job_claim`·`fn_job_fail`·`fn_reap_stuck_jobs`)가 잡 타입을 열거하고 있으면 `register`를 더한다. **009가 그랬듯 함수를 전면 교체하지 말고 필요한 부분만 확장한다** — 009는 `judge` 전면 교체가 `previous_drain_points`를 지우는 사고를 냈다. 현재 정의를 먼저 읽고 필요한 최소만 바꾼다.

- [ ] **Step 3: 011 없이 012만 실행하면 거부되는지 확인한다**

로컬 PostgreSQL이 없으면 이 단계는 **수동 검증 대상**으로 문서에 남기고 그렇다고 보고한다. 추측으로 "될 것이다"라고 쓰지 않는다.

- [ ] **Step 4: 배포 문서를 갱신한다**

`docs/DEPLOY.md`·`docs/SUPABASE_SETUP.md`에 011/012를 더한다. **다음을 반드시 명시한다**:
- **011과 012는 반드시 두 번 나눠 Run 한다**(008/009와 같은 이유)
- 워커는 012보다 먼저 배포하면 안 된다
- 대시보드는 순서 무관인가? **직접 확인해서 쓴다.** 단계 E의 `height_view_path`는 truthy 가드 덕에 안전했지만, 정합 화면은 `registrations` 테이블 자체가 없으면 다르게 동작한다
- §4 스모크에 정합 경로 확인 항목을 넣는다(단계 E에서 이 항목이 통째로 빠져 Important가 됐다)

- [ ] **Step 5: 커밋**

```bash
git add supabase/ docs/
git commit -m "feat(db): 011/012 register 잡 타입 + registrations 테이블 + jobs_dedup 재정의"
```

---

## Task 4: 워커 `handle_register` + 병합 스캔

**Files:**
- Create: `worker/flatworker/registration.py`
- Modify: `worker/flatworker/jobs.py`, `worker/flatworker/runner.py`
- Test: `worker/tests/test_register_job.py`

**Interfaces:**
- Consumes: Task 2의 `register_clouds`·`grid_to_points`·`write_ply`, `flatness.core.subcell.build_subcell_grid`
- Produces: `handle_register(db, cfg, payload)` — payload는 `{"registration_id": "<uuid>"}`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

핵심 계약만 나열한다(구체 코드는 `worker/tests/test_precheck.py`의 페이크 DB·스토리지 관례를 그대로 따른다):

```python
def test_register_reads_two_sources_sequentially_not_at_once():
    """설계 결정 F3: 두 소스를 동시에 들면 정렬 버퍼가 겹쳐 쌓여 2GiB를 넘는다.

    build_subcell_grid 호출이 겹치지 않는지(하나가 끝난 뒤 다음이 시작)를
    호출 순서 기록으로 단언한다.
    """


def test_register_runs_icp_on_subcell_medians_not_raw_points():
    """설계 결정 F3: 원본 점군을 ICP에 넘기면 5배 느리다.

    register_clouds에 들어간 점 수가 원본이 아니라 유효 서브셀 수와 같은지 본다.
    """


def test_register_writes_merged_scan_with_registered_lineage():
    """병합 스캔 행의 lineage가 'registered'다 (설계 결정 F9).

    'fused_mesh'를 쓰면 업로드 화면이 붙인 "앱이 스무딩한 데이터" 경고 의미가
    거짓이 된다.
    """


def test_register_merged_cloud_is_subcell_median_of_both_sources():
    """중첩 서브셀에 두 소스의 점이 함께 들어가 중앙값이 뽑히는가 (설계 결정 F8).

    한쪽만 쓰거나 단순 이어붙이기면 잡힌다.
    """


def test_register_failure_writes_reason_to_registrations_not_just_jobs():
    """jobs 테이블은 RLS 정책이 0개라 대시보드가 못 읽는다 (설계 결정 F10).

    실패 사유가 registrations.error_text에 남아야 화면이 보여줄 수 있다.
    """


def test_register_low_overlap_marks_failed_and_creates_no_scan():
    """중첩 부족이면 병합 스캔을 만들지 않는다 - 쓰레기 스캔이 목록에 남으면 안 된다."""


def test_register_does_not_touch_source_scans():
    """원본 두 개는 그대로 남는다 (스펙 6.3)."""
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd worker && PYTHONPATH=<워크트리>/engine python -m pytest tests/test_register_job.py -v`
Expected: FAIL — `ImportError: cannot import name 'handle_register'`

- [ ] **Step 3: 구현한다**

흐름:
1. `registrations` 행을 읽어 `source_scan_ids`(2개)와 `correspondences`를 얻는다
2. `status='processing'`으로 갱신
3. **소스 A**: 원본 내려받기 → `read_info` → `build_subcell_grid(scale_to_m=<A의 unit_scale>, subcell_m=0.05)` → `grid_to_points` → **원본 배열을 즉시 버린다**
4. **소스 B**: 같은 절차. **3번이 끝난 뒤에 시작한다**
5. `register_clouds(B점, A점, 대응점B, 대응점A)`
6. 실패면 `status='failed'`, `error_text=<한국어 사유>`로 끝낸다. **병합 스캔을 만들지 않는다**
7. 성공이면 변환 적용 → 두 점군을 이어 붙여 **같은 격자에 다시 넣고 중앙값**을 뽑는다(설계 결정 F8) → `write_ply`
8. Storage 업로드 → 새 `scans` 행(`lineage='registered'`, `status='ready'`, `unit_scale=1.0` — 이미 미터로 환산됐다)
9. `registrations`에 `transform`·`rmse_mm`·`iterations`·`overlap_ratio`·`result_scan_id`·`status='done'`

**단위 주의**: 엔진은 `rmse_m`(미터)를 내고 DB 컬럼은 `rmse_mm`이다. 워커가 `* 1000`한다. 이 환산을 빠뜨리면 화면이 0.0018mm 같은 값을 보여주며 **항상 합격으로 읽힌다** — 조용히 틀리는 종류라 테스트로 고정한다.

**대응점의 좌표계**: 화면이 저장한 값은 **파일 단위 월드 좌표**다(설계 결정 F7). 각 소스의 `unit_scale`을 곱해 미터로 맞춘 뒤 ICP에 넘긴다. 이 환산을 빠뜨리면 mm 파일에서 1000배 틀린다.

`runner.py`의 `_DEFAULT_HANDLERS`에 `"register": handle_register`를 더한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd worker && PYTHONPATH=<워크트리>/engine python -m pytest -q`
Expected: 168 + 7 = **175 passed**  <!-- 기준선 갱신: 계보 경고 구현으로 151 -> 168 -->

- [ ] **Step 5: 변이 실험**

무변이 기준선 먼저. 그다음:
1. 두 소스를 동시에 격자화 → 순차 테스트가 잡는가
2. ICP에 원본 점군을 넘긴다 → 서브셀 테스트가 잡는가
3. `lineage`를 `'fused_mesh'`로 → 잡는가
4. 병합에서 소스 B를 뺀다 → 잡는가
5. 대응점 `unit_scale` 환산을 뺀다 → **어느 테스트가 잡는가. 안 잡히면 mm 픽스처 테스트를 추가한다**
6. 실패를 `registrations`가 아니라 예외로만 알린다 → 잡는가
7. 저중첩에서도 병합 스캔을 만든다 → 잡는가

- [ ] **Step 6: 커밋**

```bash
git add worker/
git commit -m "feat(worker): register 잡 - 정합 실행 + 서브셀 중앙값 병합 스캔"
```

---

## Task 5: 대시보드 정합 화면

**Files:**
- Create: `dashboard/lib/domain/height-view.ts`, `dashboard/components/registration/point-picker.tsx`, `dashboard/app/registrations/[id]/page.tsx`, `dashboard/app/registrations/new/page.tsx`
- Modify: `dashboard/lib/domain/types.ts`, `dashboard/lib/domain/labels.ts`
- Test: 각 신규 파일의 `__tests__/`

**Interfaces:**
- Consumes: `scans.height_view_path`(nullable, 버킷-상대 전체 경로), 사이드카 JSON
- Produces:
  ```ts
  // lib/domain/height-view.ts — 파일명 유도와 좌표 환산의 단일 정본
  export function plainPngPath(heightViewPath: string): string   // …/height_view.png -> …/height_view_plain.png
  export function sidecarPath(heightViewPath: string): string    // -> …/height_view.json
  export type HeightViewMeta = {
    schema_version: number; bbox_min: [number, number, number]; bbox_max: [number, number, number];
    subcell_m_file: number; shape: [number, number]; median_z: (number | null)[][];
  };
  export function pixelToWorld(meta: HeightViewMeta, px: number, py: number):
    { x: number; y: number; z: number | null };
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('픽셀을 월드 좌표로 되돌린다(단계 E 좌표 계약)', () => {
  // shape은 [ny, nx] — 세로 먼저. 정본은 height_view.py의 render_height_view_plain 독스트링
  const meta = { schema_version: 1, bbox_min: [1234.5, -678.25, 0], bbox_max: [1242.5, -672.25, 1],
                 subcell_m_file: 31.25, shape: [192, 256] as [number, number], median_z: /* … */ };
  // ix = px, iy = ny - 1 - py; world = bbox_min + (i + 0.5) * subcell
  expect(pixelToWorld(meta, 0, 191)).toMatchObject({ x: 1234.5 + 15.625, y: -678.25 + 15.625 });
});

it('shape을 [nx, ny]로 뒤집어 읽으면 좌우·상하가 어긋난다(비정사각 메타로 고정)', () => {
  // shape[0]과 shape[1]이 다른 값이어야 이 회귀가 잡힌다 - 정사각 픽스처는 항등식이다
});

it('NaN 서브셀을 찍으면 z가 null이고 대응점으로 받아들이지 않는다', () => {
  // 0으로 대체하거나 이웃에서 끌어오면 대응점이 조용히 틀린다 (설계 결정 F6)
});

it('height_view_path에서 무장식 PNG와 사이드카 경로를 유도한다', () => {
  const p = 'artifacts/scans/OTHER-DIR/hv-2026.png';   // 워커 생성 규칙에서 벗어난 값
  expect(plainPngPath(p)).toBe('artifacts/scans/OTHER-DIR/hv-2026_plain.png');
});

it('대응점이 3쌍 미만이면 정합 실행 버튼이 비활성이다', () => {});
it('3쌍이 되면 활성화된다', () => {});
it('한쪽 스캔에 높이 뷰가 없으면 정합을 시작할 수 없다고 안내한다', () => {});
it('RMSE 결과를 보여주고 병합 스캔 만들기를 제공한다', () => {});
it('정합 실패 시 registrations.error_text를 그대로 보여준다', () => {});
```

**주의**: `plainPngPath`의 파일명 규약은 **Task 4의 워커 구현과 정확히 일치**해야 한다. 워커가 `height_view_plain.png`로 올린다면 여기도 그래야 한다. 위 예시의 `_plain` 접미는 **워커 구현을 읽고 맞춰라** — 추측하지 마라.

**픽스처 항등식 금지**: 경로 픽스처는 워커 생성 규칙(`artifacts/scans/{scan_id}/height_view.png`)에서 **벗어난 값**을 써라. 규칙과 같은 값을 쓰면 `scan.id`로 재조립하는 구현도 통과한다(단계 E Task 3에서 실제로 일어났다). `shape`도 **비정사각**을 써라.

- [ ] **Step 2: 실패를 확인한다**

Run: `cd dashboard && npm test`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

**클릭 대상은 무장식 PNG다**(설계 결정 F7). 장식 PNG는 matplotlib 여백 때문에 역산이 불가능하다. 화면에는 무장식 PNG를 canvas에 그리고 축은 직접 그린다.

`dataUrl()`을 쓴다. `artifactUrl`을 쓰면 접두사가 두 번 붙는다(`lib/domain/slope-cells.ts`가 문서화한 함정).

두 뷰를 나란히 놓고 번갈아 클릭한다. 찍은 쌍이 목록으로 쌓이고 3쌍 이상이면 "정합 실행"이 활성화된다. 결과 RMSE를 보여주고 납득되면 "병합 스캔 만들기"로 확정한다.

`types.ts`의 `Lineage`에 `'registered'`를 더하고 `labels.ts`에 `registered: '정합 병합'`을 더한다. **업로드 화면의 선택지에는 넣지 마라**(설계 결정 F9).

- [ ] **Step 4: 통과를 확인한다**

Run: `cd dashboard && npm test` → 328 + 9 이상(기준선 갱신: 326 -> 328). `npm run build`도 통과해야 한다.

- [ ] **Step 5: 변이 실험 + 실화면 확인**

무변이 기준선 먼저(`--reporter=basic`을 쓰지 마라 — vitest 4에 없어 조용히 크래시한다).

1. `shape`을 `[nx, ny]`로 읽는다
2. `iy = ny - 1 - py` → `iy = py`
3. `+0.5` 셀 중심 보정 제거
4. `dataUrl` → `artifactUrl`
5. NaN 셀을 0으로 대체
6. 3쌍 미만 가드 제거
7. 장식 PNG를 클릭 대상으로

**실제로 띄워 확인해라.** 단계 E Task 3에서 `render()` 테스트로는 구조적으로 재현 불가능한 결함(SSR `<img>`가 React의 `onError` 부착 전에 실패)이 실화면에서만 드러났다. 못 띄우면 "못 했다"고 그대로 보고해라.

- [ ] **Step 6: 커밋**

```bash
git add dashboard/
git commit -m "feat(dashboard): 정합 화면 - 대응점 클릭 + RMSE + 병합 스캔"
```

---

## 완료 조건

- [ ] 네 스위트 통과: engine **215+** / worker **158+** / dashboard **335+** / `npm run build`
- [ ] 지터 0에서 회전 ≤0.1° · 평행이동 ≤1mm (**변이로 증명**)
- [ ] 노이즈 1mm + 클릭 ±5cm에서 z ≤1mm (**변이로 증명**)
- [ ] 중첩 영역 서브셀 중앙값 z 불일치 ≤ 노이즈+1mm
- [ ] 중첩 10% 미만이 **실패로 끝난다**
- [ ] 좌표 계약이 `shape=[ny,nx]`로 맞다 (**비정사각 픽스처로 증명**)
- [ ] 병합 스캔 lineage가 `registered`이고 라벨이 "정합 병합"
- [ ] `jobs_dedup`이 `register` 중복을 실제로 막는다
- [ ] 스펙 §9.3에 게이트 교체 사실과 실측 표가 기록됐다
- [ ] 사용자 대면 문자열에 U+2014 0건

## 범위 밖

- 스캔 가이드라인 갱신·용역 결과 보고서 편입 — **단계 G**
  (특히 "대응점을 8쌍 이상 넓게 분산" 권고: 면내 오차가 `√n`로 줄어 5cm → 1.8cm)
- 3개 이상 스캔의 다중 정합 — 2개만
- 벽 스캔 정합 — 높이 뷰가 256×1 픽셀 띠라 클릭이 성립하지 않는다
- 배수구를 분석 **전에** 지정하는 것
- 폴백 문구의 401/404 구분
- 업로드 화면의 "결과에 경고가 표시됩니다" 거짓 안내 (별도 티켓)

# 세부과업 4 단계 E: precheck 높이 뷰 + 단위 확정 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 업로드한 점군을 위에서 내려다본 높이 뷰로 보여줘, 사용자가 "이 방이 8m인가 80cm인가"를 눈으로 판단해 단위를 확정할 수 있게 한다. 그 그림과 좌표 사이드카가 단계 F 정합 화면의 전제가 된다.

**Architecture:** `precheck`가 점군을 읽어 높이 뷰 PNG와 좌표 사이드카 JSON을 만들어 Storage에 올린 뒤 상태를 승격한다. 렌더 실패는 격리해 상태 승격을 막지 않는다. 단위 확정 전이라 축척을 모르므로 **파일 단위 상대 좌표**로 그린다.

**Tech Stack:** Python 3(엔진·워커) · PostgreSQL(Supabase) · Next.js 16(대시보드)

## Global Constraints

- **사용자 대면 문자열에 U+2014(`—`) 금지.** 주석·개발문서는 허용. 리터럴 글리프로 검색하고 **패턴이 실제로 매칭되는지 먼저 자기검증할 것**
- 주석·문서·사용자 대면 문자열은 **한국어**
- **Next.js 16이다.** `dashboard/node_modules/next/dist/docs/`를 읽을 것. **Vitest는 async 서버 컴포넌트 `render()`를 지원하지 않는다** - 단계 C가 세운 패턴(`@/lib/supabase/server` 모킹 + 페이지 함수 직접 `await`)을 따를 것
- 워커 테스트: `cd worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest -q` (**forward slash 필수**)
- 기준선: engine **181** / worker **137** / dashboard **309**
- 마이그레이션은 **재실행 안전(멱등)**. `006:18`·`007:6` 관례
- **`002_functions_seed.sql`을 재실행 대상으로 안내하지 마라**

## 이 단계가 어겨서는 안 되는 것

단계 A~D 리뷰가 실제로 잡은 것들이다.

| 원칙 | 왜 |
|---|---|
| **렌더 실패가 상태 승격을 막으면 안 된다** | `precheck`가 실패하면 스캔이 `failed`로 굳어 사용자가 아무것도 못 한다. `core/pipeline.py:76-96`이 확립한 패턴(try/except + warnings)을 따른다 |
| **조용한 실패를 만들지 마라** | 필드가 조용히 NULL, PATCH 0행 매칭, 잘못된 값이 '성공'으로 저장. 이 프로젝트가 가장 위험하게 보는 양식이다 |
| **테스트가 회귀를 잡는지 변이로 증명하라** | "코드는 맞는데 테스트가 못 잡는다"가 단계 A~D에서 계속 나왔다 |
| **기존 스캔은 그림이 없다** | 화면이 그것을 견뎌야 한다. 단계 D의 `cells_json` 부재 처리(`slope-cells.ts` → `slope-result.tsx`)가 선례 |
| **문서 인용은 앵커로** | 행번호는 다음 커밋에 밀린다. 단계 D에서 세 번 밀렸다 |

## 설계 결정 (사전 조사가 확정, 재고하지 말 것)

### E1. 높이 뷰는 `precheck`가 만든다 (새 잡 타입을 만들지 않는다)

`job_type` enum 추가는 **008 단독 파일 → 009 카탈로그 가드**라는 2파일 의식을 치러야 하는데, **단계 F가 `register`를 반드시 추가하므로 그 예산을 여기 쓰지 않는다.**

`precheck` 확장의 최대 위험(렌더 실패로 스캔이 `failed`로 굳음)은 **렌더를 try/except로 감싸 `warnings`에만 남기고 상태 승격을 무조건 실행**하면 완전히 막힌다.

`scan_status` enum에 "처리 중" 값을 **더하지 않는다.** `SCAN_STATUS_LABEL`(`dashboard/lib/domain/labels.ts`) 같은 `Record<T,string>` 전수 확장을 부르는데 얻는 것은 문구 하나다. 대신 `app/scans/[id]/page.tsx`의 "워커가 실행 중인지 확인하세요"를 "파일 크기에 따라 수십 초 걸릴 수 있습니다"로 고친다.

### E2. 산출물은 `artifacts/scans/{scan_id}/` (사이드카 JSON 포함)

`raw-scans/`는 `authenticated`가 **전면 쓰기 가능**이라(`005_storage_buckets.sql`) 워커 산출물이 브라우저에 덮일 수 있다. `artifacts/`는 authenticated 읽기 전용·service_role 쓰기라 "워커가 쓰고 대시보드가 읽는다"와 정확히 맞고, `site_id` 조회(`get_location` → `get_site`)도 불필요하다.

`split_key`(`worker/flatworker/storage.py`)와 `resolveStorageObject`(`dashboard/lib/server/storage-objects.ts`)는 **첫 세그먼트만 검증**하므로 깊이는 자유이고, `artifacts/{analysis_id}/`와 충돌하지 않는다(uuid vs 리터럴 `scans`).

**사이드카를 단계 F로 미루면 안 된다.** F의 정합 화면이 클릭 좌표를 미터로 되돌릴 수단도, §6.2가 요구한 "Z는 클릭한 XY의 서브셀 중앙값에서 읽는다"의 격자도 없어진다.

`height_view.json`에 담을 것: `schema_version`, `bbox_min[3]`, `bbox_max[3]`, `subcell_m_file`(파일 단위), `shape[ny,nx]`, `median_z`(NaN → `null`).

**PNG용 해상도와 Z 조회용 격자를 같은 해상도로 통일한다** - 24만 서브셀 `median_z`를 JSON으로 쓰면 수 MB다. 긴 변 **512**로 맞춘다.

`dump_slope_cells`(`engine/flatness/outputs/slope_cells.py`)의 계약 패턴을 복제한다: `SCHEMA_VERSION` 상수, `ensure_ascii=False`, `allow_nan=False`, 필수 키 결측 시 **한국어 `ValueError`**.

### E3. 격자 폭발을 막아야 한다 ★

**단위 확정 전이라 파일 단위를 모른다.** mm 단위 파일(폭 8000)에 `subcell_m=0.05`를 주면 `nx=160,000`이 되어 배열이 테라바이트급이다.

**서브셀 크기를 bbox 범위에서 유도한다**: `subcell_m_file = max(dx, dy) / 512`. 그러면 파일 단위와 무관하게 격자가 항상 512×N 이하다.

유리한 점: `build_subcell_grid`의 `median_z`는 이미 **bbox 최저 z 기준 상대 높이**이고 `origin`은 `lo[:2]`다. 별도 센터링이 필요 없다.

### E4. 새 렌더러가 필요하다 (기존 3종 재사용 불가)

- `render_heatmap` - 등급 문자열 → 5색. 높이 뷰는 연속값이다
- `render_slope_map` - `graded` dict 필요
- `render_deviation_map` - **구조는 가장 가깝지만** 미터 전제(`target_m/grid.size_m`), mm 환산(`*1000`), **0 중심 대칭 정규화**(`vmin=-vmax`)가 걸린다. 값이 전부 0 이상인 높이장에서는 컬러맵 절반이 낭비되고 바닥 전체가 한 색이 된다
- `render_preview3d` - 평면 피팅 후 잔차의 3D 산점도. 단위 확정 이후 단계다

새 모듈 `engine/flatness/outputs/height_view.py`를 만들되 `deviation.py`의 구조를 본뜨고 **순차형 컬러맵**을 쓴다. `pool_nanmean`·`_figsize`는 그대로 재사용한다.

**`from flatness.outputs import heatmap as _engine_heatmap  # noqa: F401`을 반드시 넣어라.** Agg 백엔드 + 한글 폰트 설정의 정본이고, `slope_map.py`·`deviation.py`·`preview3d.py`가 전부 이걸 import한다. 없으면 리눅스에서 한글이 네모 상자가 된다.

### E5. 마이그레이션 010

```sql
alter table scans add column if not exists height_view_path text;
```

**`scans.point_count`도 함께 채운다.** `001_schema.sql`에 선언만 되고 아무도 안 쓰는데(`report/snapshot.py`가 유일 독자) `read_info`가 이미 `n_points`를 준다. 공짜다.

### E6. 임포트 스캔에는 높이 뷰가 없다

임포트 모드는 `precheck`를 **아예 타지 않는다**(`upload-form.tsx`가 `unit_scale=1.0`을 선세팅하고 `import` 잡으로 직행). 그리고 임포트 원본은 점군이 아니라 점 단위 편차 목록이라 높이 뷰가 의미가 없다. **이건 정상이고 화면이 견디면 된다.**

## File Structure

**신규**
- `engine/flatness/outputs/height_view.py` - PNG 렌더 + 사이드카 JSON 직렬화·역직렬화
- `engine/tests/test_height_view.py`
- `supabase/migrations/010_scan_height_view.sql`
- `worker/tests/test_precheck.py` - **현재 `handle_precheck` 단위 테스트가 하나도 없다**

**수정**
- `worker/flatworker/jobs.py` - `handle_precheck` 확장
- `worker/tests/fake_db.py` - 필요 시
- `dashboard/lib/domain/types.ts` - `ScanRow.height_view_path`
- `dashboard/app/scans/[id]/confirm-unit/page.tsx` · `components/unit-confirm-form.tsx` - 그림 표시
- `dashboard/app/scans/[id]/page.tsx` - 대기 안내 문구
- `docs/SUPABASE_SETUP.md` · `docs/DEPLOY.md` - 010 반영

---

### Task 1: 엔진 - 높이 뷰 렌더러와 사이드카

**Files:** Create `engine/flatness/outputs/height_view.py`, `engine/tests/test_height_view.py`

**Produces:**
- `render_height_view(grid, out_path, title=...) -> str` - 위에서 내려다본 높이 PNG
- `dump_height_view_meta(grid, info, path) -> str` / `load_height_view_meta(path) -> dict`
- `subcell_m_for_bbox(info, target_long_side=512) -> float` - 격자 폭발 방지

- [ ] **Step 1: 실패하는 테스트 - 격자 폭발 방지**

```python
def test_subcell_size_caps_grid_regardless_of_file_unit():
    """단위 확정 전이라 파일 단위를 모른다. mm 파일에 0.05를 주면 nx=160,000이다."""
    for scale in (1.0, 100.0, 1000.0):   # m, cm, mm 단위 파일
        info = _info(bbox_min=(0,0,0), bbox_max=(8*scale, 6*scale, 0.1*scale))
        s = subcell_m_for_bbox(info, target_long_side=512)
        nx = int(np.ceil(8*scale / s))
        assert nx <= 512
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 3: 사이드카 왕복 테스트**

`nan`은 `null`로 쓰고 로드 시 되돌린다. `allow_nan=False`가 관례다(`core/pipeline.py`). 필수 키 결측은 **한국어 `ValueError`**로 거부하라 - 단계 D에서 `load_slope_cells`가 `KeyError`로 죽어 운영자에게 아무것도 못 알려준 전례가 있다.

- [ ] **Step 4: 렌더가 실제로 그림을 만드는가**

PNG 파일이 생기고 0바이트가 아닌지, **한글 제목이 네모 상자가 아닌지** 확인하라. 단계 B에서 폰트 side-effect import를 빠뜨려 이 문제가 났다.

- [ ] **Step 5: 변이 + 커밋**

변이: `subcell_m_for_bbox`가 상수를 반환하게 / 사이드카에서 `bbox_min` 제거 / nan→null 치환 제거 / 폰트 side-effect import 제거. 각각 잡히는지 확인하고 실패한 테스트 이름을 적어라.

```bash
cd engine && python -m pytest -q
```
기준선 **181**.

---

### Task 2: 마이그레이션 010 + 워커 precheck 확장

**Files:** Create `supabase/migrations/010_scan_height_view.sql`, `worker/tests/test_precheck.py`; Modify `worker/flatworker/jobs.py`, `docs/SUPABASE_SETUP.md`, `docs/DEPLOY.md`

**⚠ `handle_precheck` 단위 테스트가 현재 하나도 없다.** 이 태스크가 처음 만든다.

- [ ] **Step 1: 010 작성**

```sql
-- 010: 스캔 높이 뷰 (세부과업 4 단계 E)
alter table scans add column if not exists height_view_path text;
```

`006:18`·`007:6`의 멱등 관례를 따른다. enum 추가가 없으므로 **008/009 같은 2파일 분리가 불필요하다.**

- [ ] **Step 2: 실패하는 테스트 - 렌더 실패가 상태 승격을 막지 않는다** ★

```python
def test_precheck_promotes_status_even_when_render_fails(monkeypatch, ...):
    """렌더가 죽어도 스캔은 진행 가능해야 한다.

    precheck가 실패로 끝나면 fn_job_fail이 scans.status='failed'로 만들고
    사용자는 아무것도 못 한다(003_dashboard_support.sql). 렌더는 편의 기능이지
    필수 경로가 아니다.
    """
    monkeypatch.setattr("flatworker.jobs.render_height_view",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("렌더 실패")))
    handle_precheck(db, cfg, {"scan_id": scan_id})
    assert db.scans[scan_id]["status"] in ("ready", "awaiting_unit_confirm")
    assert db.scans[scan_id]["height_view_path"] is None
```

- [ ] **Step 3: 실패 확인 → `handle_precheck` 확장 → 통과 확인**

흐름: `get_scan` → `_fetch_raw`로 원본 내려받기 → `read_info` → `subcell_m_for_bbox` → `build_subcell_grid(scale_to_m=1.0)` → PNG + 사이드카 → `storage.upload_dir("artifacts/scans/{scan_id}", out_dir)` → `update_scan({height_view_path, point_count, status})`.

**렌더·업로드 전체를 try/except로 감싸라.** 실패 시 `height_view_path`를 건드리지 않고 상태만 승격한다. `core/pipeline.py`의 렌더 격리 패턴이 선례다.

**`point_count`를 `read_info`의 `n_points`로 채워라.**

- [ ] **Step 4: 변이 + 문서 + 커밋**

변이: try/except 제거 / `point_count` 갱신 제거 / 업로드 경로를 `raw-scans/`로 / `scale_to_m`을 1.0이 아닌 값으로.

`SUPABASE_SETUP.md`·`DEPLOY.md`에 010을 추가하라. **008/009와 달리 단독 실행이 안전**하다는 것과 그 이유(enum 추가가 없다)를 적어라.

```bash
cd worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest -q
```
기준선 **137**.

---

### Task 3: 대시보드 - 단위 확정 화면에 높이 뷰

**Files:** Modify `dashboard/lib/domain/types.ts`, `app/scans/[id]/confirm-unit/page.tsx`, `components/unit-confirm-form.tsx`, `app/scans/[id]/page.tsx`

- [ ] **Step 1: 실패하는 테스트 - 그림이 없어도 화면이 산다**

```tsx
it('height_view_path가 없으면 기존 파일명 전용 화면을 그대로 보여준다', ...)
it('height_view_path가 있으면 높이 뷰를 표시한다', ...)
```

- [ ] **Step 2~4: 구현**

- **경로**: `dataUrl(scan.height_view_path)`. **`artifactUrl`을 쓰면 안 된다** - 저장값이 이미 버킷-상대 전체 경로라 이중으로 붙는다(`lib/domain/slope-cells.ts`가 문서화한 함정)
- **`img onError` 폴백 필수.** 서명 URL 302를 거치므로 객체가 나중에 지워지면 404다. null 검사만으로 부족하다
- 폼이 `max-w-md`로 묶여 있어 그림을 넣으려면 레이아웃을 바꿔야 한다. 페이지 컨테이너는 이미 `max-w-6xl`이다
- **`detect_units`가 이미 있는데 워커·대시보드가 안 쓴다**(`engine/flatness/io/units.py`). 이번 단계에서 근거 문구로 쓸지는 판단하되, 쓰려면 워커가 `scans`에 후보를 남길 곳이 필요하다 - **없으면 쓰지 마라**
- `app/scans/[id]/page.tsx`의 "워커가 실행 중인지 확인하세요"를 **"파일 크기에 따라 수십 초 걸릴 수 있습니다"**로 고쳐라(E1)

- [ ] **Step 5: 변이 + 화면 확인 + 커밋**

변이: `height_view_path` 분기 제거 / `dataUrl` 대신 `artifactUrl` / `onError` 폴백 제거.

**실제로 띄워 확인하라.** `.env.local`이 없어 못 하면 그렇다고 보고하라.

```bash
cd dashboard && npm test
```
기준선 **309**.

## 완료 조건

- [ ] 세 스위트 통과, 기준선(181/137/309) 이상
- [ ] 렌더가 죽어도 스캔 상태가 승격된다 (**변이로 증명**)
- [ ] mm/cm/m 단위 파일 전부에서 격자가 512 이하 (**변이로 증명**)
- [ ] 높이 뷰가 없는 기존 스캔에서 단위 확정 화면이 죽지 않는다
- [ ] 한글 제목이 네모 상자가 아니다
- [ ] 사용자 대면 문자열에 U+2014 0건

## 범위 밖

- 정합 화면·`register` 잡 - 단계 F
- 배수구를 분석 **전에** 지정하는 것(§6.1이 언급) - 단계 F 이후
- `scan_status` enum에 "처리 중" 추가 - E1에서 뺐다
- 스캔 가이드라인·용역 보고서 갱신 - G-2

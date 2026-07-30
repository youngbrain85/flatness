# 정밀 편차맵(10cm 보조 시각화) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판정 히트맵과 별개로, 5cm 서브셀 잔차를 10cm로 접어 연속 색상으로 그린 정밀 편차맵 PNG를 엔진이 산출하고 워커 보고서와 대시보드 결과 화면이 함께 표시한다.

**Architecture:** 엔진은 판정 과정에서 이미 만든 잔차 배열(`build_zones()`의 `residuals`, 벽은 `residual_grid()` 결과)을 2x2 평균 풀링(NaN 무시)해 10cm 격자로 접고 matplotlib으로 PNG 한 장을 더 쓴다. 생성한 파일명은 `stats["deviation_paths"]`(`string[]`)에 담겨 stats.json으로 나가고, 워커·대시보드는 그 목록만 보고 파일을 소비한다. 판정 로직(`evaluate_cells`·`grade_cells`·직선자 스팬)에는 입력도 출력도 없다.

**Tech Stack:** Python 3.11 + numpy + matplotlib(Agg, 엔진 기존 의존성) / Jinja2 템플릿(워커 보고서) / Next.js 16 App Router + TypeScript(대시보드). 테스트는 engine·worker pytest, dashboard vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-29-precision-deviation-heatmap-design.md`. 정본 스펙 `docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md` §5.1.9 산출물 목록에 파일을 추가하는 기능이며 판정 관련 절은 건드리지 않는다. 데이터 계약 정본: `docs/contracts/stats-schema.md`.

## Global Constraints

- **판정(등급) 산출 로직 절대 변경 금지.** `core/cells.py`·`criteria.py`·`core/zones.py`·`core/walls.py`의 판정 경로는 한 줄도 고치지 않는다. 이 기능은 부가 시각화이며, 편차맵을 아예 만들지 않아도 stats.json의 등급·수치는 동일해야 한다
- **문서·주석·UI 문자열 전부 한국어.** 사용자 대면 문자열(PNG 제목·컬러바 라벨·보고서 캡션·대시보드 문구)에 **U+2014 금지**. 검사는 반드시 **리터럴 글리프**로 한다 — Git Bash에서 `$'\u2014'`는 확장되지 않아 "검출 0건"이라는 허위 클린 보고가 나온 전례가 있다. 워커 쪽은 기존 테스트 `test_render_html_has_no_em_dash_and_escapes_title`이 이미 이 규칙을 강제한다
- **기존 스위트 불변 유지**: 착수 시점 기준선은 **engine 114 / worker 53(+`browser` 마커 1건 deselect) / dashboard 105**다(2026-07-30 `--collect-only`로 실측). 새 테스트는 그 위에 더해진다. 기존 테스트를 고쳐야 하는 곳은 **Task 3의 `worker/tests/test_report_snapshot.py:159` 단 한 줄뿐**이며(자산 계약에 키가 추가되므로), 그 외 기존 단언을 바꾸면 회귀로 간주한다
- **테스트 실행 명령**
  - 엔진: `cd D:\Projects\Flatness\engine` → `python -m pytest -q`
  - 워커: `cd D:\Projects\Flatness\worker` → Git Bash `PYTHONPATH=D:/Projects/Flatness/engine python -m pytest -q` / PowerShell `$env:PYTHONPATH="D:\Projects\Flatness\engine"; python -m pytest -q`
  - 대시보드: `cd D:\Projects\Flatness\dashboard` → `npm run test`
- **경로 계약 유지**: 워커가 만드는 자산 경로는 버킷-상대 문자열(`reports/{report_id}/assets/{analysis_id}/deviation.png`)이다. OS 절대경로·`data/` 접두 금지
- **stats.json 파일명 규약**: `deviation_paths`에는 **디렉터리 없는 파일명만** 담는다(기존 `preview3d_paths`와 동일). 소비자가 `artifacts_dir`에 결합한다
- **대시보드 규칙**: `dashboard/AGENTS.md`가 명시하듯 이 저장소의 Next.js는 학습 데이터와 다를 수 있다. 라우팅·서버 컴포넌트·API를 건드릴 일이 생기면 `dashboard/node_modules/next/dist/docs/`의 해당 가이드를 먼저 읽는다. 본 계획 Task 4는 클라이언트 컴포넌트 내부만 수정하므로 Next API 표면을 건드리지 않는다
- 태스크마다 **실패 테스트 → 구현 → 통과 → 커밋**. 커밋 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **YAGNI**: 해상도 사용자 설정 UI 없음(10cm 고정), 임계선·등고선 없음(순수 연속 색상), 인터랙티브 확대 없음(정적 PNG), 임포트(Colab CSV) 경로에는 생성하지 않음, 히스토그램과 무관(보고서 전용 자산으로 이미 별도 존재)

## 조정자 설계 결정 (구현자는 근거까지 읽고 따를 것)

1. **stats 키는 `deviation_paths`(`string[]`) 하나로 바닥·벽 공통** — 표면별로 `deviation_path`(문자열)와 `deviation_wall_paths`(리스트)를 나누면 소비자가 `meta.surface`로 분기하고 두 타입을 다뤄야 한다. 목록 하나면 워커·대시보드 모두 `for name in (stats.get("deviation_paths") or [])` 한 줄로 끝나고, **결번(스킵된 벽)은 엔진이 실제 생성한 파일만 담는 것으로 자연 해소**된다. 기존 `preview3d_paths`가 같은 형태(파일명 배열, 0~2개)라 계약 문서의 서술 방식도 그대로 재사용된다
2. **colormap은 `RdYlGn_r` + 0mm 중심 대칭** — 판정 히트맵에서 초록이 "적합"인데 편차맵에서는 "깊은 침하"라 색 의미가 충돌한다. 그럼에도 이 팔레트를 쓰는 이유는 (a) 3D 프리뷰(`outputs/preview3d.py:11`)가 이미 편차를 `RdYlGn_r`로 칠하고 있어 **편차를 말하는 그림끼리 색 언어가 일치**하고, (b) 발산 데이터에 순차 colormap을 쓰면 부호가 사라지며, (c) 데모 점군 시험 렌더에서 결함 3개가 정확히 잡히는 것이 확인됐기 때문이다. 충돌은 팔레트가 아니라 **문맥 표기**로 해소한다: 편차맵에는 항상 컬러바와 "판정에 사용되지 않는 보조 시각화" 캡션이 붙고, 판정 히트맵에는 컬러바 없이 등급 범례가 붙는다
3. **벽 잔차는 `walls.py`를 고치지 않고 파이프라인에서 재계산** — `evaluate_wall()`은 잔차를 내부에서만 쓰고 반환하지 않는다. 반환 튜플을 늘리면 판정 모듈의 시그니처가 바뀌고 기존 테스트가 깨진다. 대신 파이프라인이 이미 받는 `wm["plane_abc"]`(소수 6자리 반올림)로 `residual_grid(grid, abc)`를 한 번 더 돌린다. 계수 반올림 오차는 4m 벽에서 0.01mm 미만이라 시각화 정확도에 영향이 없고(실측 확인), 판정 모듈은 손대지 않는다
4. **snapshot 스키마는 `report-snapshot-v1` 유지** — `assets`에 `deviation` 키를 **추가만** 한다. 렌더러가 모르는 키를 무시해도 동작이 같은 순수 가산 변경이고, 버전을 올리면 이미 발행된 보고서의 snapshot을 재해석해야 한다. 대신 (a) 템플릿은 `| default([], true)`로 **키가 없는 과거 snapshot도 렌더**되어야 하며 이를 회귀 테스트로 고정하고, (b) 계약 정본인 `docs/superpowers/plans/2026-07-29-p4-report.md`의 `assets` 행에 키 추가를 기록한다
5. **캡션 문구는 각 레이어에 두고 `labels.ts`/`labels.py` 표는 건드리지 않는다** — 등급·표면·경고 사전은 정본 대조 테스트(`worker/tests/test_report_labels.py`)가 개수까지 단언하는 민감한 표다. 편차맵 캡션은 열거형 라벨이 아니라 파일명에서 파생되는 표시 문자열이므로 그 표에 넣을 성질이 아니다. 대신 워커와 대시보드가 **동일한 한국어 문구**(`정밀 편차맵(10cm)` / `벽 {n} 정밀 편차맵(10cm)`)를 쓰도록 양쪽 테스트에서 문자열을 단언한다

## 파일 구조 개요

```
engine/flatness/outputs/deviation.py          # (Create) 풀링 + 편차맵 렌더러 (Task 1)
engine/tests/test_deviation.py                # (Create) 렌더러 단위 테스트 (Task 1)
engine/flatness/core/pipeline.py              # (Modify) analyze_floor·analyze_wall 배선 (Task 2)
engine/tests/test_pipeline.py                 # (Modify) 산출물·결번 통합 테스트 (Task 2)
docs/contracts/stats-schema.md                # (Modify) §2 조건부 키 + §6 파일 규약 추가 (Task 2)
worker/flatworker/report/assets.py            # (Modify) 편차맵 복사 + 캡션 (Task 3)
worker/flatworker/report/snapshot.py          # (Modify) 빈 자산 기본값에 deviation 추가 (Task 3)
worker/flatworker/report/templates/report.html.j2  # (Modify) §4 시각자료에 편차맵 figure (Task 3)
worker/tests/test_report_assets.py            # (Modify) 복사·결번·캡션 테스트 (Task 3)
worker/tests/test_report_html.py              # (Modify) 템플릿·과거 snapshot 회귀 (Task 3)
worker/tests/test_report_snapshot.py          # (Modify) 빈 자산 단언 1줄 갱신 (Task 3)
docs/superpowers/plans/2026-07-29-p4-report.md# (Modify) snapshot assets 계약 행 1줄 (Task 3)
dashboard/lib/domain/types.ts                 # (Modify) Stats.deviation_paths (Task 4)
dashboard/components/analysis/deviation-view.tsx        # (Create) 편차맵 탭 본문 (Task 4)
dashboard/components/analysis/analysis-result.tsx       # (Modify) 탭 추가 (Task 4)
dashboard/components/analysis/__tests__/deviation-view.test.tsx    # (Create) (Task 4)
dashboard/components/analysis/__tests__/analysis-result.test.tsx   # (Create) 탭 전환 (Task 4)
```

---

### Task 1: 엔진 편차맵 렌더러 모듈

판정 파이프라인과 무관한 순수 함수 2개(풀링·렌더)를 새 모듈에 만든다. 이 태스크만으로는 산출물이 늘지 않는다(배선은 Task 2).

**Files:**
- Create: `engine/flatness/outputs/deviation.py`
- Test: `engine/tests/test_deviation.py`

**Interfaces:**
- Consumes: `flatness.core.subcell.SubcellGrid`(필드 `size_m: float`, `origin: np.ndarray[2]`, `shape: tuple`, `median_z`, `counts`, `bimodal`), 잔차 2D 배열(`np.float32`, 단위 m, NaN = 판정 제외/데이터 없음). matplotlib Agg·한글 폰트 설정은 `flatness.outputs.heatmap` 임포트의 부수효과로 얻는다(`outputs/preview3d.py:6`과 동일 관례)
- Produces:
  - `pool_nanmean(a: np.ndarray, factor: int) -> np.ndarray[np.float64]` — 2D 배열을 `factor x factor` 블록 평균으로 접는다. 블록 내 유효값만 평균, 전부 NaN이면 NaN. 변 길이가 배수가 아니면 NaN 패딩 후 접는다
  - `render_deviation_map(residuals, grid, out_path, target_m=DEVIATION_RES_M, title="정밀 편차맵 (10cm 해상도)", xlabel="X (m)", ylabel="Y (m)", cbar_label="편차 (mm), + 융기 / - 침하") -> str | None` — PNG를 쓰고 파일명(`out_path.name`)을 반환. 풀링 결과에 유효값이 하나도 없으면 **파일을 쓰지 않고 `None`** 반환
  - 상수 `DEVIATION_RES_M = 0.10`, `DEVIATION_CMAP = "RdYlGn_r"`

- [ ] **Step 1: 실패 테스트 작성**

`engine/tests/test_deviation.py` 를 새로 만든다.

```python
"""정밀 편차맵 렌더러 — 풀링 정확성과 PNG 산출 검증 (판정 무관 보조 시각화).

계획: docs/superpowers/plans/2026-07-29-precision-deviation-heatmap.md
"""
import numpy as np

from flatness.outputs.deviation import (DEVIATION_RES_M, pool_nanmean,
                                        render_deviation_map)
from tests.fixtures.synthetic import add_bump, flat_floor
from tests.test_subcell import _grid


def _residuals(pts):
    """평면 제거 잔차의 축소판 — 기울기 없는 합성 바닥은 중앙값 차감이 곧 잔차다."""
    g = _grid(pts)
    return (g.median_z - np.nanmedian(g.median_z)).astype(np.float32), g


def test_pool_nanmean_averages_valid_cells_only():
    a = np.array([[1.0, np.nan, 2.0, 2.0],
                  [3.0, np.nan, 2.0, 2.0],
                  [np.nan, np.nan, 4.0, np.nan],
                  [np.nan, np.nan, np.nan, np.nan]], dtype=np.float32)
    p = pool_nanmean(a, 2)
    assert p.shape == (2, 2)
    assert p[0, 0] == 2.0            # (1+3)/2 — NaN 2칸은 분모에서 빠진다
    assert p[0, 1] == 2.0
    assert np.isnan(p[1, 0])         # 블록 전체 NaN -> NaN 유지(0으로 채우지 않는다)
    assert p[1, 1] == 4.0            # 유효 1칸이면 그 값 그대로


def test_pool_nanmean_pads_odd_shape_with_nan():
    a = np.arange(15, dtype=np.float64).reshape(3, 5)
    p = pool_nanmean(a, 2)
    assert p.shape == (2, 3)         # 3x5 -> 패딩 후 4x6 -> 2x3
    assert p[0, 0] == 3.0            # (0+1+5+6)/4
    assert p[1, 2] == 14.0           # 마지막 블록은 유효 1칸(14)뿐


def test_pool_nanmean_factor_one_is_identity():
    a = np.array([[1.0, np.nan]], dtype=np.float32)
    p = pool_nanmean(a, 1)
    assert p.shape == (1, 2) and p[0, 0] == 1.0 and np.isnan(p[0, 1])


def test_render_marks_defect_positions(tmp_path):
    # 8x6m 바닥에 12mm 함몰(2,2)·9mm 융기(6,4) — 편차맵이 두 결함을 잡아야 한다
    pts = add_bump(add_bump(flat_floor(size=(8.0, 6.0), spacing=0.02, noise_sd=0.0005),
                            (2.0, 2.0), 0.35, -0.012),
                   (6.0, 4.0), 0.4, 0.009)
    res, g = _residuals(pts)

    name = render_deviation_map(res, g, tmp_path / "deviation.png")

    assert name == "deviation.png"
    assert (tmp_path / "deviation.png").stat().st_size > 5000
    factor = int(round(DEVIATION_RES_M / g.size_m))
    assert factor == 2
    pooled_mm = pool_nanmean(res, factor) * 1000.0
    cell = g.size_m * factor
    iy, ix = np.unravel_index(np.nanargmin(pooled_mm), pooled_mm.shape)
    assert abs(g.origin[0] + (ix + 0.5) * cell - 2.0) < 0.2   # 함몰 위치
    assert abs(g.origin[1] + (iy + 0.5) * cell - 2.0) < 0.2
    iy2, ix2 = np.unravel_index(np.nanargmax(pooled_mm), pooled_mm.shape)
    assert abs(g.origin[0] + (ix2 + 0.5) * cell - 6.0) < 0.2  # 융기 위치
    assert abs(g.origin[1] + (iy2 + 0.5) * cell - 4.0) < 0.2
    assert np.isfinite(pooled_mm).mean() > 0.95               # 10cm는 거의 전부 채워진다


def test_render_returns_none_when_all_nan(tmp_path):
    _, g = _residuals(flat_floor(size=(2.0, 2.0), spacing=0.02))
    empty = np.full(g.shape, np.nan, dtype=np.float32)

    assert render_deviation_map(empty, g, tmp_path / "deviation.png") is None
    assert not (tmp_path / "deviation.png").exists()


def test_render_survives_perfectly_flat_surface(tmp_path):
    # 편차가 정확히 0이면 vmin==vmax로 정규화가 퇴화한다 — 하한을 두어 방어
    res, g = _residuals(flat_floor(size=(2.0, 2.0), spacing=0.02))

    assert render_deviation_map(res, g, tmp_path / "flat.png") == "flat.png"
    assert (tmp_path / "flat.png").stat().st_size > 1000


def test_render_accepts_wall_frame_labels(tmp_path):
    # 벽은 (u, v) 프레임이라 축 라벨·부호 문구가 다르다 — 인자로 갈아끼울 수 있어야 한다
    res, g = _residuals(add_bump(flat_floor(size=(4.0, 2.4), spacing=0.02),
                                 (2.0, 1.2), 0.3, -0.010))

    name = render_deviation_map(res, g, tmp_path / "deviation_wall1.png",
                                title="벽 1 정밀 편차맵 (10cm 해상도)",
                                xlabel="벽 길이 u (m)", ylabel="높이 v (m)",
                                cbar_label="편차 (mm), + 돌출 / - 함몰")

    assert name == "deviation_wall1.png"
    assert (tmp_path / "deviation_wall1.png").stat().st_size > 5000
```

- [ ] **Step 2: 실패 확인**

Run: `cd D:\Projects\Flatness\engine && python -m pytest tests/test_deviation.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'flatness.outputs.deviation'`

- [ ] **Step 3: 렌더러 모듈 구현**

`engine/flatness/outputs/deviation.py` 를 새로 만든다.

```python
"""정밀 편차맵 PNG — 10cm 해상도 연속 색상 보조 시각화 (스펙 §5.1.9 추가 산출물).

판정 히트맵(1m 셀·5색 이산)과 목적이 다르다: 이 그림은 등급을 말하지 않고 원시 편차의
분포를 그대로 보여준다. 판정 경로(evaluate_cells·grade_cells)와 완전히 분리돼 있어,
이 모듈이 무엇을 하든 stats.json의 등급·수치는 달라지지 않는다.

해상도는 5cm 서브셀 잔차를 2x2 평균 풀링해 얻는다 — 점군 재읽기도 평면 재피팅도 없다.
색 언어는 3D 프리뷰(outputs/preview3d.py)와 같은 RdYlGn_r를 쓰되 0mm를 중앙에 두고
±최대 절대편차로 대칭 정규화한다(부호가 살아 있어야 융기와 침하가 구분된다).
"""
import numpy as np
import matplotlib
from flatness.outputs import heatmap as _hm  # noqa: F401  Agg·한글 폰트 설정 재사용(부수효과 import)
import matplotlib.pyplot as plt

DEVIATION_RES_M = 0.10   # 고정 해상도(사용자 설정 없음 — 계획 YAGNI)
DEVIATION_CMAP = "RdYlGn_r"
_NA_COLOR = "#e8e8e8"    # 데이터 없는 셀(NaN)
_MIN_VMAX_MM = 0.5       # 완전 평탄면에서 vmin==vmax 퇴화 방지
_LONG_SIDE_IN = 9.0      # 긴 변 고정 — 넓은 바닥에서도 PNG 크기가 폭주하지 않는다


def pool_nanmean(a, factor):
    """2D 배열을 factor x factor 블록 평균으로 접는다(NaN 무시).

    블록 안의 유효값만 평균하고 전부 NaN인 블록은 NaN으로 남긴다 — 데이터가 없는 곳을
    0mm로 칠하면 "평탄하다"는 거짓 정보가 된다. 변 길이가 배수가 아니면 NaN으로 패딩한다.
    numpy.nanmean은 전부 NaN인 슬라이스에서 RuntimeWarning을 내므로 합/개수로 직접 계산한다.
    """
    a = np.asarray(a, dtype=np.float64)
    if factor <= 1:
        return a.copy()
    ny, nx = a.shape
    pad_y, pad_x = (-ny) % factor, (-nx) % factor
    if pad_y or pad_x:
        a = np.pad(a, ((0, pad_y), (0, pad_x)), constant_values=np.nan)
    ny, nx = a.shape
    finite = np.isfinite(a)
    blocks = (ny // factor, factor, nx // factor, factor)
    total = np.where(finite, a, 0.0).reshape(blocks).sum(axis=(1, 3))
    count = finite.reshape(blocks).sum(axis=(1, 3))
    out = np.full(count.shape, np.nan, dtype=np.float64)
    np.divide(total, count, out=out, where=count > 0)
    return out


def _figsize(span_x_m, span_y_m):
    """긴 변을 _LONG_SIDE_IN으로 고정한 종횡비 보존 크기 + 컬러바·축 여백."""
    if span_x_m <= 0 or span_y_m <= 0:
        return (6.0, 5.0)
    if span_x_m >= span_y_m:
        w, h = _LONG_SIDE_IN, max(2.5, _LONG_SIDE_IN * span_y_m / span_x_m)
    else:
        h, w = _LONG_SIDE_IN, max(2.5, _LONG_SIDE_IN * span_x_m / span_y_m)
    return (w + 1.8, h + 0.8)


def render_deviation_map(residuals, grid, out_path, target_m=DEVIATION_RES_M,
                         title="정밀 편차맵 (10cm 해상도)",
                         xlabel="X (m)", ylabel="Y (m)",
                         cbar_label="편차 (mm), + 융기 / - 침하"):
    """잔차 배열(m)을 target_m 해상도 편차맵 PNG로 저장하고 파일명을 반환한다.

    유효값이 하나도 없으면 파일을 만들지 않고 None을 반환한다(호출자가 목록에서 뺀다).
    풀링 배율은 grid.size_m에서 계산하므로 subcell_m이 기본값 0.05가 아니어도 목표
    해상도가 유지된다.
    """
    factor = max(1, int(round(target_m / grid.size_m)))
    pooled_mm = pool_nanmean(residuals, factor) * 1000.0
    if not np.isfinite(pooled_mm).any():
        return None
    vmax = float(np.nanmax(np.abs(pooled_mm)))
    if not np.isfinite(vmax) or vmax < _MIN_VMAX_MM:
        vmax = _MIN_VMAX_MM
    cell_m = grid.size_m * factor
    ny, nx = pooled_mm.shape
    ox, oy = float(grid.origin[0]), float(grid.origin[1])
    cmap = matplotlib.colormaps[DEVIATION_CMAP].with_extremes(bad=_NA_COLOR)
    fig, ax = plt.subplots(figsize=_figsize(nx * cell_m, ny * cell_m))
    im = ax.imshow(np.ma.masked_invalid(pooled_mm), cmap=cmap, vmin=-vmax, vmax=vmax,
                   origin="lower", interpolation="nearest",
                   extent=[ox, ox + nx * cell_m, oy, oy + ny * cell_m])
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.set_aspect("equal")
    fig.colorbar(im, ax=ax, shrink=0.85, label=cbar_label)
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
    return out_path.name
```

- [ ] **Step 4: 통과 확인**

Run: `cd D:\Projects\Flatness\engine && python -m pytest tests/test_deviation.py -q`
Expected: PASS (7 passed)

- [ ] **Step 5: 전체 엔진 스위트 회귀 확인**

Run: `cd D:\Projects\Flatness\engine && python -m pytest -q`
Expected: `121 passed, 1 deselected` (기준선 114 + 신규 7)

- [ ] **Step 6: 커밋**

```bash
git add engine/flatness/outputs/deviation.py engine/tests/test_deviation.py
git commit -m "$(cat <<'EOF'
feat(engine): 10cm 정밀 편차맵 렌더러 추가

5cm 서브셀 잔차를 2x2 평균 풀링(NaN 무시)해 RdYlGn_r 대칭 색상으로 그린다.
판정 경로와 분리된 보조 시각화 모듈이며, 배선은 후속 태스크에서 한다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 파이프라인 배선과 stats 계약

바닥·벽 파이프라인이 편차맵을 실제로 산출하고 `stats["deviation_paths"]`로 알린다. 계약 정본 문서도 같은 커밋에서 갱신한다(계약 문서의 규칙: stats 키를 바꾸는 변경은 문서 갱신을 동반해야 한다).

**Files:**
- Modify: `engine/flatness/core/pipeline.py:1-16`(임포트), `:58-63`(analyze_floor 산출부), `:78`(벽 누적 리스트), `:92-93`(벽 루프 렌더), `:110-112`(벽 stats)
- Modify: `engine/tests/test_pipeline.py` (테스트 3건 추가)
- Modify: `docs/contracts/stats-schema.md` (머리말 소스 목록, §2 표, §6 표)

**Interfaces:**
- Consumes: Task 1의 `render_deviation_map(residuals, grid, out_path, target_m=..., title=..., xlabel=..., ylabel=..., cbar_label=...) -> str | None`. 벽 잔차는 `flatness.core.plane.residual_grid(grid, abc) -> np.ndarray[np.float32]`로 다시 만든다(`abc`는 `evaluate_wall`이 돌려준 `metrics["plane_abc"]`, 소수 6자리 반올림)
- Produces: `stats["deviation_paths"]: list[str]` — 바닥은 `[]` 또는 `["deviation.png"]`, 벽은 `wall_id` 오름차순의 `["deviation_wall1.png", ...]`(스킵된 벽은 결번). 이 키를 Task 3(워커)·Task 4(대시보드)가 소비한다

- [ ] **Step 1: 실패 테스트 작성**

`engine/tests/test_pipeline.py` 끝에 아래 3건을 덧붙인다(파일 상단의 기존 임포트·`CRIT` 상수를 그대로 쓴다).

```python
def test_floor_deviation_map_generated(tmp_path):
    # 정밀 편차맵은 판정과 무관한 추가 산출물이다 — 파일과 stats 목록이 함께 나와야 한다
    pts = add_bump(flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010)
    write_binary_ply(pts, tmp_path / "scan.ply")

    stats = analyze_floor(tmp_path / "scan.ply", 1.0, CRIT, 5.0, tmp_path / "out")

    assert stats["deviation_paths"] == ["deviation.png"]
    assert (tmp_path / "out" / "deviation.png").stat().st_size > 5000
    # 판정 결과는 편차맵과 무관하게 종전 그대로다
    assert 9.0 <= stats["worst"]["value_mm"] <= 11.0
    import json
    saved = json.loads((tmp_path / "out" / "stats.json").read_text("utf-8"))
    assert saved["deviation_paths"] == ["deviation.png"]   # write_outputs 이전에 기록돼야 함


def test_wall_deviation_maps_generated_per_wall(tmp_path):
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0),
                     flat_wall(length=3.0, height=2.4, spacing=0.02, axis='y', y0=0.0)])
    write_binary_ply(pts, tmp_path / "room.ply")
    crit = load_criteria()["wall-kcs-tilt-other"]

    stats = analyze_wall(tmp_path / "room.ply", 1.0, crit, 8.0, tmp_path / "out")

    assert stats["deviation_paths"] == ["deviation_wall1.png", "deviation_wall2.png"]
    for name in stats["deviation_paths"]:
        assert (tmp_path / "out" / name).stat().st_size > 5000


def test_wall_deviation_keeps_gap_numbering(tmp_path, monkeypatch):
    # 스킵된 벽은 히트맵과 마찬가지로 편차맵도 결번이다(파일 존재를 가정하면 안 된다)
    from flatness.core import pipeline as pl
    calls = {"n": 0}
    real = pl.evaluate_wall

    def flaky(grid, criterion, u_mm, cell_m=1.0):
        calls["n"] += 1
        if calls["n"] == 2:
            raise ValueError("주입된 벽 평가 실패")
        return real(grid, criterion, u_mm, cell_m=cell_m)

    monkeypatch.setattr(pl, "evaluate_wall", flaky)
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0),
                     flat_wall(length=3.0, height=2.4, spacing=0.02, axis='y', y0=0.0)])
    write_binary_ply(pts, tmp_path / "room.ply")
    crit = load_criteria()["wall-kcs-tilt-other"]

    stats = pl.analyze_wall(tmp_path / "room.ply", 1.0, crit, 8.0, tmp_path / "out")

    assert stats["deviation_paths"] == ["deviation_wall1.png"]
    assert not (tmp_path / "out" / "deviation_wall2.png").exists()
```

- [ ] **Step 2: 실패 확인**

Run: `cd D:\Projects\Flatness\engine && python -m pytest tests/test_pipeline.py -q -k deviation`
Expected: FAIL — 3건 모두 `KeyError: 'deviation_paths'`

- [ ] **Step 3: analyze_floor 배선**

`engine/flatness/core/pipeline.py` 상단 임포트에 2줄을 더한다.

```python
from flatness.outputs.heatmap import render_heatmap
from flatness.outputs.deviation import render_deviation_map
from flatness.outputs.preview3d import render_preview3d
```

그리고 `core/plane`의 잔차 재계산 함수를 벽에서 쓰므로 함께 임포트한다(파일 상단 `from flatness.core.walls import (...)` 아래 줄에 추가).

```python
from flatness.core.plane import residual_grid
```

`analyze_floor` 안, `stats["preview3d_paths"] = render_preview3d(...)` 다음이자 `write_outputs(...)` **앞**에 삽입한다(stats.json은 `write_outputs`에서 직렬화되므로 순서가 중요하다).

```python
    # 정밀 편차맵(판정 무관 보조 시각화): 판정에 쓴 잔차를 10cm로 접어 다시 그린다
    dev = render_deviation_map(residuals, grid, out_dir / "deviation.png")
    stats["deviation_paths"] = [dev] if dev else []
    write_outputs(out_dir, stats, cells, grades)
```

- [ ] **Step 4: analyze_wall 배선**

누적 리스트 선언을 한 칸 늘린다.

```python
    all_cells, all_grades, walls_out, deviation_names = [], [], [], []
```

벽 루프에서 `render_heatmap(cells, grades, out_dir / f"heatmap_wall{i}.png", cell_m=cell_m)` 바로 아래에 삽입한다.

```python
        # 판정에 쓴 벽 평면 계수(stats에 실리는 6자리 반올림값)로 잔차를 다시 만들어 그린다.
        # evaluate_wall의 반환 시그니처를 바꾸지 않기 위한 선택 — 반올림 오차는 0.01mm 미만이다.
        dev = render_deviation_map(
            residual_grid(grid, tuple(wm["plane_abc"])), grid,
            out_dir / f"deviation_wall{i}.png",
            title=f"벽 {i} 정밀 편차맵 (10cm 해상도)",
            xlabel="벽 길이 u (m)", ylabel="높이 v (m)",
            cbar_label="편차 (mm), + 돌출 / - 함몰")
        if dev:
            deviation_names.append(dev)
```

`stats["walls"] = walls_out` 다음 줄에 추가한다.

```python
    stats["deviation_paths"] = deviation_names
```

- [ ] **Step 5: 통과 확인**

Run: `cd D:\Projects\Flatness\engine && python -m pytest tests/test_pipeline.py -q`
Expected: PASS (기존 10건 + 신규 3건 = 13 passed)

- [ ] **Step 6: 계약 문서 갱신 (§2 조건부 키)**

`docs/contracts/stats-schema.md` §2 표의 `preview3d_paths` 행 **바로 아래**에 행을 추가한다(기존 행은 그대로 둔다).

```markdown
| `deviation_paths` | O | O | — | 정밀 편차맵 파일명 목록(`string[]`). floor는 `[]` 또는 `["deviation.png"]`, wall은 `wall_id` 오름차순 `["deviation_wall1.png", ...]`이며 **스킵된 벽은 목록에 없다(결번)**. 잔차 유효값이 하나도 없으면 파일을 만들지 않아 목록에서 빠진다(`core/pipeline.py`·`outputs/deviation.py`). import 경로는 이 키 자체가 없으므로 소비자는 항상 "없으면 빈 목록"으로 다룬다. **판정과 무관한 보조 시각화**이며 등급·수치 필드에 영향을 주지 않는다 |
```

- [ ] **Step 7: 계약 문서 갱신 (§6 산출물 파일 규약)**

같은 문서 §6 표의 `preview3d_zoom.png` 행 아래에 2행을 추가한다.

```markdown
| `deviation.png` | floor | 정밀 편차맵(10cm 해상도, 0mm 중심 대칭 연속 색상). 판정 히트맵과 별개의 보조 시각화 |
| `deviation_wall{n}.png` | wall | 벽별 정밀 편차맵. `n`은 `wall_id`와 동일 채번 — **스킵된 벽은 파일 자체가 생성되지 않음(결번)** |
```

이어서 §6 표 아래(“`cells.json` / `results.csv` 행 스키마” 문단 **앞**)에 설명 문단 하나를 추가한다.

```markdown
> **정밀 편차맵 읽는 법**: 1m 판정 셀·5등급 이산색인 히트맵과 달리 10cm 격자의 원시 편차(mm)를 연속 색상으로 칠한다.
> 0mm가 중앙(연노랑), 붉을수록 융기(벽은 돌출), 초록일수록 침하(벽은 함몰)이며 스케일은 ±최대 절대편차로 대칭이다.
> 데이터가 없는 셀은 회색(`#e8e8e8`)이다. **등급 산출에는 관여하지 않는다** — 이 파일이 없어도 stats의 판정 결과는 동일하다.
> 생성 여부는 §2의 `deviation_paths`로 판별한다(파일 존재를 가정하지 않는다).
```

- [ ] **Step 8: 계약 문서 머리말 소스 목록 갱신**

머리말의 대조 소스 나열 마지막 줄 `engine/flatness/outputs/preview3d.py`. 를 아래로 바꾼다.

```markdown
> `engine/flatness/outputs/preview3d.py`, `engine/flatness/outputs/deviation.py`.
```

- [ ] **Step 9: 전체 엔진 스위트 회귀 확인**

Run: `cd D:\Projects\Flatness\engine && python -m pytest -q`
Expected: `124 passed, 1 deselected` (Task 1 이후 121 + 신규 3)

- [ ] **Step 10: 커밋**

```bash
git add engine/flatness/core/pipeline.py engine/tests/test_pipeline.py docs/contracts/stats-schema.md
git commit -m "$(cat <<'EOF'
feat(engine,docs): 편차맵 파이프라인 배선 + stats.deviation_paths 계약

analyze_floor는 deviation.png, analyze_wall은 벽별 deviation_wall{n}.png를 만들고
생성한 파일명만 stats.deviation_paths에 담는다(스킵된 벽은 결번).
벽 잔차는 walls.py 시그니처를 건드리지 않도록 반환된 plane_abc로 재계산한다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 워커 보고서 자산 복사와 표시

발행 보고서가 원본 분석과 무관하게 재현되려면 편차맵도 `reports/{id}/assets/`로 복사돼야 한다. 복사 후 §4 시각자료에 표시한다.

**Files:**
- Modify: `worker/flatworker/report/assets.py:10-17`(임포트), `:57-108`(`_copy_analysis_assets`)
- Modify: `worker/flatworker/report/snapshot.py:190`(`_EMPTY_ANALYSIS_ASSETS`)
- Modify: `worker/flatworker/report/templates/report.html.j2` (§4 시각자료, 히트맵 루프 다음)
- Modify: `worker/tests/test_report_assets.py`, `worker/tests/test_report_html.py`
- Modify: `worker/tests/test_report_snapshot.py:159` (자산 계약 단언 1줄)
- Modify: `docs/superpowers/plans/2026-07-29-p4-report.md` (snapshot 계약 `assets` 행 1줄)

**Interfaces:**
- Consumes: Task 2의 `stats["deviation_paths"]: list[str]`(파일명만). 원본 파일은 `cfg.data_dir / bundle.analysis["artifacts_dir"] / name`에 있다
- Produces:
  - `deviation_label(name: str) -> str` — `deviation_wall{n}.png`이면 `"벽 {n} 정밀 편차맵(10cm)"`, 그 외에는 `"정밀 편차맵(10cm)"`
  - `_copy_analysis_assets(...)` 반환 dict에 키 `"deviation": list[{"label": str, "path": str}]` 추가 → `snapshot["analyses"][i]["assets"]["deviation"]`로 그대로 흘러간다

- [ ] **Step 1: 실패 테스트 작성 (자산 복사)**

`worker/tests/test_report_assets.py` 상단 임포트를 아래로 바꾼다.

```python
from flatworker.report.assets import build_assets, deviation_label, render_histogram
```

그리고 파일 끝에 3건을 덧붙인다.

```python
def test_deviation_label_distinguishes_floor_and_wall():
    assert deviation_label("deviation.png") == "정밀 편차맵(10cm)"
    assert deviation_label("deviation_wall3.png") == "벽 3 정밀 편차맵(10cm)"


def test_build_assets_copies_deviation_maps(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    db.analyses["an1"]["stats"]["deviation_paths"] = ["deviation.png"]
    _write_artifacts(cfg, ["heatmap.png", "preview3d.png", "deviation.png"])
    ctx = load_report_context(db, cfg, "r1")

    assets = build_assets(db, cfg, "r1", ctx)

    assert assets["analyses"]["an1"]["deviation"] == [
        {"label": "정밀 편차맵(10cm)", "path": "reports/r1/assets/an1/deviation.png"}]
    assert (cfg.data_dir / "reports/r1/assets/an1/deviation.png").exists()
    assert assets["notes"] == []


def test_build_assets_skips_missing_deviation_with_note(tmp_path):
    """벽 편차맵은 히트맵과 같은 결번 규약이다 — 파일 존재를 가정하지 않는다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    stats = db.analyses["an1"]["stats"]
    stats["meta"]["surface"] = "wall"
    stats["zones"] = []
    stats["preview3d_paths"] = []
    stats["walls"] = [{"wall_id": 1, "n_cells": 2, "height_m": 2.4, "length_m": 5.0,
                       "plumbness_mm": 12.0, "plumb_grade": "pass",
                       "plane_abc": [0, 0, 0], "frame": {}}]
    stats["deviation_paths"] = ["deviation_wall1.png", "deviation_wall3.png"]
    db.scans["scan1"]["surface"] = "wall"
    _write_artifacts(cfg, ["heatmap_wall1.png", "deviation_wall1.png"])  # wall3 편차맵 없음
    ctx = load_report_context(db, cfg, "r1")

    assets = build_assets(db, cfg, "r1", ctx)

    labels = [d["label"] for d in assets["analyses"]["an1"]["deviation"]]
    assert labels == ["벽 1 정밀 편차맵(10cm)"]
    assert any("deviation_wall3.png" in n for n in assets["notes"])
```

- [ ] **Step 2: 실패 확인**

Run (Git Bash): `cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest tests/test_report_assets.py -q`
Expected: FAIL — `ImportError: cannot import name 'deviation_label'`

- [ ] **Step 3: assets.py 구현**

`worker/flatworker/report/assets.py` 임포트에 `re`를 더한다.

```python
import re
import shutil
from pathlib import Path
```

`_copy_if_exists` 정의 **위**에 캡션 함수를 추가한다.

```python
_DEVIATION_WALL = re.compile(r"^deviation_wall(\d+)\.png$")


def deviation_label(name):
    """편차맵 파일명 -> 캡션. 벽은 결번이 있으므로 파일명의 번호를 그대로 쓴다.

    같은 문구를 대시보드 deviation-view.tsx도 쓴다(화면과 PDF의 캡션이 갈리면 안 된다).
    """
    m = _DEVIATION_WALL.match(name)
    return f"벽 {m.group(1)} 정밀 편차맵(10cm)" if m else "정밀 편차맵(10cm)"
```

`_copy_analysis_assets`의 히트맵 블록과 `preview3d` 블록 사이에 편차맵 블록을 넣는다.

```python
    deviation = []
    for name in (stats.get("deviation_paths") or []):
        if _copy_if_exists(src_dir / name, dst_dir / name):
            deviation.append({"label": deviation_label(name),
                              "path": assets_rel(report_id, analysis_id, name)})
        else:
            notes.append(f"분석 {analysis_id}: 정밀 편차맵 {name} 파일이 없어 "
                         "보고서에서 제외했습니다.")
```

같은 함수의 반환문을 아래로 바꾼다.

```python
    return {"heatmaps": heatmaps, "deviation": deviation, "preview3d": preview3d,
            "histogram": histogram}
```

- [ ] **Step 4: 통과 확인 (자산)**

Run: `cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest tests/test_report_assets.py -q`
Expected: PASS (기존 6건 + 신규 3건 = 9 passed)

- [ ] **Step 5: snapshot 기본값과 기존 단언 갱신**

`worker/flatworker/report/snapshot.py`의 빈 자산 기본값에 키를 더한다.

```python
_EMPTY_ANALYSIS_ASSETS = {"heatmaps": [], "deviation": [], "preview3d": [], "histogram": None}
```

`worker/tests/test_report_snapshot.py:159`의 단언을 같은 모양으로 맞춘다(**이 계획에서 기존 테스트를 고치는 유일한 지점**).

```python
    assert a["assets"] == {"heatmaps": [], "deviation": [], "preview3d": [], "histogram": None}
```

- [ ] **Step 6: 템플릿 실패 테스트 작성**

`worker/tests/test_report_html.py` 끝에 2건을 덧붙인다.

```python
def _snapshot_with_deviation(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed(db, cfg)
    db.analyses["an1"]["stats"]["deviation_paths"] = ["deviation.png"]
    artifacts = cfg.data_dir / "artifacts" / "an1"
    for name in ("heatmap.png", "preview3d.png", "deviation.png"):
        (artifacts / name).write_bytes(b"\x89PNG-fake")
    ctx = load_report_context(db, cfg, "r1")
    return build_snapshot(ctx, build_assets(db, cfg, "r1", ctx))


def test_render_html_includes_deviation_figure(tmp_path):
    html = render_html(_snapshot_with_deviation(tmp_path))
    assert "src=\"assets/an1/deviation.png\"" in html
    assert "정밀 편차맵(10cm)" in html
    assert "판정 등급 산출에는 사용되지 않습니다" in html   # 판정 무관 고지
    assert "—" not in html                                  # 사용자 대면 문자열 U+2014 금지


def test_render_html_tolerates_snapshot_without_deviation_key(tmp_path):
    """이미 발행된 보고서의 snapshot에는 assets.deviation 키가 없다 — 템플릿이 견뎌야 한다."""
    snap = _snapshot(tmp_path)
    for a in snap["analyses"]:
        a["assets"].pop("deviation", None)

    html = render_html(snap)

    assert "4. 시각자료" in html
    assert "src=\"assets/an1/heatmap.png\"" in html
```

- [ ] **Step 7: 실패 확인 (템플릿)**

Run: `cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest tests/test_report_html.py -q`
Expected: FAIL — `test_render_html_includes_deviation_figure`에서 `assert 'src="assets/an1/deviation.png"' in html` 실패

- [ ] **Step 8: 템플릿 구현**

`worker/flatworker/report/templates/report.html.j2`의 §4 시각자료에서 히트맵 루프(`{% endfor %}`) 다음, `a.assets.preview3d` 루프 앞에 삽입한다. **`| default([], true)`가 필수다** — 과거 발행 snapshot에는 이 키가 없고, Jinja의 기본 Undefined는 순회 시 예외를 던진다.

```jinja
  {% for d in a.assets.deviation | default([], true) %}
  <figure>
    <img src="{{ d.path | asset(report_id) }}" alt="{{ d.label }}" />
    <figcaption>{{ d.label }}: 10cm 해상도 원시 편차 분포입니다. 붉을수록 융기(벽은 돌출),
      초록일수록 침하(벽은 함몰)이며 판정 등급 산출에는 사용되지 않습니다.</figcaption>
  </figure>
  {% endfor %}
```

- [ ] **Step 9: 통과 확인 (템플릿)**

Run: `cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest tests/test_report_html.py tests/test_report_snapshot.py -q`
Expected: PASS

- [ ] **Step 10: snapshot 계약 문서 1줄 갱신**

`docs/superpowers/plans/2026-07-29-p4-report.md`의 "reports.snapshot 계약" 표에서 `assets` 행을 아래로 바꾼다(스키마 문자열 `report-snapshot-v1`은 그대로 둔다 — 순수 가산 변경이며 과거 snapshot도 그대로 렌더된다).

```markdown
| `assets` | object | `{heatmaps: [{label, path}], deviation: [{label, path}], preview3d: [{label, path}], histogram: path\|null}` (`deviation`은 2026-07-29 정밀 편차맵 기능에서 추가된 가산 키 — 과거 발행 snapshot에는 없을 수 있어 소비자는 기본값 `[]`로 다룬다) |
```

- [ ] **Step 11: 전체 워커 스위트 회귀 확인**

Run: `cd D:/Projects/Flatness/worker && PYTHONPATH=D:/Projects/Flatness/engine python -m pytest -q`
Expected: `58 passed, 1 deselected` (기준선 53 + 신규 5)

- [ ] **Step 12: 커밋**

```bash
git add worker/flatworker/report/assets.py worker/flatworker/report/snapshot.py \
        worker/flatworker/report/templates/report.html.j2 \
        worker/tests/test_report_assets.py worker/tests/test_report_html.py \
        worker/tests/test_report_snapshot.py docs/superpowers/plans/2026-07-29-p4-report.md
git commit -m "$(cat <<'EOF'
feat(worker): 보고서 자산에 정밀 편차맵 포함

deviation_paths 목록대로 편차맵을 reports/{id}/assets/로 복사하고 시각자료 절에
캡션과 함께 싣는다. 벽 결번은 기존 히트맵과 동일하게 파일 존재를 가정하지 않는다.
snapshot 스키마는 가산 변경이라 v1을 유지하고, 키 없는 과거 snapshot 렌더를
회귀 테스트로 고정했다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 대시보드 정밀 편차맵 탭

결과 화면에 히트맵·3D 프리뷰·현장 사진과 나란히 탭을 추가한다.

**Files:**
- Modify: `dashboard/lib/domain/types.ts:88-98`(`Stats` 인터페이스)
- Create: `dashboard/components/analysis/deviation-view.tsx`
- Modify: `dashboard/components/analysis/analysis-result.tsx:12`(Tab 타입), `:40`(파생값), `:47`(탭 버튼), `:62`(본문 분기)
- Create: `dashboard/components/analysis/__tests__/deviation-view.test.tsx`
- Create: `dashboard/components/analysis/__tests__/analysis-result.test.tsx`

**Interfaces:**
- Consumes: Task 2의 `stats.deviation_paths?: string[]`(파일명만), 기존 `artifactUrl(artifactsDir: string, filename: string): string`(`dashboard/lib/domain/paths.ts:8`)
- Produces:
  - `deviationLabel(name: string): string` — 워커 `deviation_label()`과 **동일 문구**를 만든다
  - `DeviationView({ artifactsDir, paths }: { artifactsDir: string | null; paths: string[] })` — 이미지 목록 또는 빈 상태 안내

- [ ] **Step 1: 실패 테스트 작성 (뷰)**

`dashboard/components/analysis/__tests__/deviation-view.test.tsx` 를 새로 만든다.

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeviationView, deviationLabel } from '../deviation-view';

describe('DeviationView (정밀 편차맵 탭)', () => {
  it('파일명에서 바닥·벽 캡션을 만든다 (워커 deviation_label과 동일 문구)', () => {
    expect(deviationLabel('deviation.png')).toBe('정밀 편차맵(10cm)');
    expect(deviationLabel('deviation_wall3.png')).toBe('벽 3 정밀 편차맵(10cm)');
  });

  it('바닥 편차맵을 artifacts 경로로 표시한다', () => {
    render(<DeviationView artifactsDir="artifacts/an1" paths={['deviation.png']} />);

    const img = screen.getByAltText('정밀 편차맵(10cm)') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/data/artifacts/an1/deviation.png');
    expect(screen.getByText(/판정 등급 산출에는 사용되지 않으며/)).toBeInTheDocument();
  });

  it('벽 결번을 그대로 유지해 표시한다', () => {
    render(<DeviationView artifactsDir="artifacts/an1"
      paths={['deviation_wall1.png', 'deviation_wall3.png']} />);

    expect(screen.getByAltText('벽 1 정밀 편차맵(10cm)')).toBeInTheDocument();
    expect(screen.getByAltText('벽 3 정밀 편차맵(10cm)')).toBeInTheDocument();
    expect(screen.queryByAltText('벽 2 정밀 편차맵(10cm)')).not.toBeInTheDocument();
  });

  it('목록이 비었거나 산출물 경로가 없으면 안내 문구를 보여준다', () => {
    const { unmount } = render(<DeviationView artifactsDir="artifacts/an1" paths={[]} />);
    expect(screen.getByText(/정밀 편차맵이 없습니다/)).toBeInTheDocument();
    unmount();

    render(<DeviationView artifactsDir={null} paths={['deviation.png']} />);
    expect(screen.getByText(/정밀 편차맵이 없습니다/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd D:\Projects\Flatness\dashboard && npx vitest run components/analysis/__tests__/deviation-view.test.tsx`
Expected: FAIL — `Failed to resolve import "../deviation-view"`

- [ ] **Step 3: 컴포넌트 구현**

`dashboard/components/analysis/deviation-view.tsx` 를 새로 만든다(순수 표시 컴포넌트라 `result-table.tsx`와 같이 `'use client'` 지시어를 두지 않는다 — 클라이언트 컴포넌트에서 임포트된다).

```tsx
// 정밀 편차맵 탭 - 10cm 해상도 원시 편차(판정과 무관한 보조 시각화)
import { artifactUrl } from '@/lib/domain/paths';

const WALL_FILE = /^deviation_wall(\d+)\.png$/;

// 워커 flatworker/report/labels 대신 assets.deviation_label과 같은 문구를 만든다
// (화면 캡션과 PDF 캡션이 갈리면 같은 그림이 다른 이름으로 불린다)
export function deviationLabel(name: string): string {
  const m = WALL_FILE.exec(name);
  return m ? `벽 ${m[1]} 정밀 편차맵(10cm)` : '정밀 편차맵(10cm)';
}

export function DeviationView({ artifactsDir, paths }: {
  artifactsDir: string | null;
  paths: string[];
}) {
  if (!artifactsDir || paths.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        정밀 편차맵이 없습니다. 이 기능이 추가되기 전 엔진으로 분석한 결과이거나,
        유효 편차 데이터가 없는 경우입니다. 재분석하면 생성됩니다.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {paths.map((name) => (
        <figure key={name} className="space-y-1">
          {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifactUrl(artifactsDir, name)} alt={deviationLabel(name)}
            className="max-w-full rounded border bg-white" />
          <figcaption className="text-xs text-slate-600">{deviationLabel(name)}</figcaption>
        </figure>
      ))}
      <p className="text-xs text-slate-500">
        10cm 격자의 원시 편차 분포입니다. 0mm가 중앙(연노랑)이고 붉을수록 융기(벽은 돌출),
        초록일수록 침하(벽은 함몰)이며 회색은 데이터가 없는 구간입니다.
        판정 등급 산출에는 사용되지 않으며, 등급은 히트맵 탭의 1m 판정 셀 기준입니다.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인 (뷰)**

Run: `cd D:\Projects\Flatness\dashboard && npx vitest run components/analysis/__tests__/deviation-view.test.tsx`
Expected: PASS (4 passed)

- [ ] **Step 5: 탭 통합 실패 테스트 작성**

`dashboard/components/analysis/__tests__/analysis-result.test.tsx` 를 새로 만든다.

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AnalysisResult } from '../analysis-result';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';

const stats: Stats = {
  n_cells: 1, n_valid: 1,
  grade_counts: { pass: 1, borderline: 0, repair: 0, rework: 0, na: 0 },
  grade_pct: { pass: 100, borderline: 0, repair: 0, rework: 0, na: 0 },
  value_max_mm: 3.2, value_min_mm: 3.2, value_mean_mm: 3.2, value_p95_mm: 3.2,
  worst: { value_mm: 3.2, cell_ix: 0, cell_iy: 0, point_x: 0.5, point_y: 0.5, zone_id: 1 },
  coverage_pct: 98.0, reduced_span_cells: 0,
  applied_criteria: { name: 'floor-kcs-exposed', source: 'KCS 14 20 10', span_m: 3,
                      pass_mm: 7, rework_mm: 21, u_mm: 5 },
  warnings: [], zones: [],
  meta: { file: 'raw.ply', n_points: 100, surface: 'floor', engine_version: 'p1d-0.4.0' },
  auto_summary: '자동 의견',
  deviation_paths: ['deviation.png'],
};

const analysis: AnalysisRow = {
  id: 'an1', scan_id: 'scan1', surface: 'floor', criteria_id: 'c1', applied_criteria: null,
  params: {}, engine_version: 'p1d-0.4.0', status: 'done', stats, coverage_pct: 98.0,
  overall_verdict: 'pass', warnings: [], artifacts_dir: 'artifacts/an1',
  auto_summary: '자동 의견', user_summary: null, is_current: true, deleted_at: null,
  created_at: '2026-07-29', created_by: null,
};

const scan: ScanRow = {
  id: 'scan1', location_id: 'loc1', surface: 'floor', scanned_at: '2026-07-20', device: null,
  operator_id: null, operator_name_manual: null, selected_criteria_id: null,
  raw_file_path: null, original_filename: null, file_format: null, point_count: null,
  unit_scale: null, lineage: 'raw', status: 'ready', deleted_at: null,
  created_at: '2026-07-20', updated_at: '2026-07-20',
};

describe('AnalysisResult 정밀 편차맵 탭', () => {
  it('탭을 누르면 stats.deviation_paths의 이미지를 보여준다', async () => {
    // cells.json fetch는 히트맵 탭 전용이라 빈 배열로 스텁한다
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] } as unknown as Response)));

    render(<AnalysisResult analysis={analysis} scan={scan} photos={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '정밀 편차맵' }));

    await waitFor(() => {
      const img = screen.getByAltText('정밀 편차맵(10cm)') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/api/data/artifacts/an1/deviation.png');
    });
  });

  it('편차맵이 없는 분석에서는 안내 문구를 보여준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] } as unknown as Response)));
    const without = { ...analysis, stats: { ...stats, deviation_paths: undefined } };

    render(<AnalysisResult analysis={without} scan={scan} photos={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '정밀 편차맵' }));

    await waitFor(() => {
      expect(screen.getByText(/정밀 편차맵이 없습니다/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `cd D:\Projects\Flatness\dashboard && npx vitest run components/analysis/__tests__/analysis-result.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "정밀 편차맵"`

- [ ] **Step 7: 타입 계약 갱신**

`dashboard/lib/domain/types.ts`의 `Stats` 인터페이스에서 조건부 키 2줄을 3줄로 바꾼다.

```ts
  preview3d_paths?: string[]; // floor만
  deviation_paths?: string[]; // floor·벽 공통(정밀 편차맵 파일명, 임포트 결과에는 없음)
  walls?: WallInfo[];         // wall만
```

- [ ] **Step 8: 탭 배선**

`dashboard/components/analysis/analysis-result.tsx`를 4곳 고친다.

임포트 추가:

```tsx
import { HeatmapView } from './heatmap-view';
import { DeviationView } from './deviation-view';
```

탭 타입:

```tsx
type Tab = 'heatmap' | 'deviation' | 'preview3d' | 'photos';
```

파생값(`const preview3d = ...` 아래):

```tsx
  const deviation = (stats.deviation_paths ?? []).filter(Boolean);
```

탭 버튼 목록:

```tsx
            {([['heatmap', '히트맵'], ['deviation', '정밀 편차맵'],
               ['preview3d', '3D 프리뷰'], ['photos', '현장 사진']] as const)
```

본문 분기(히트맵 블록과 `{tab === 'preview3d' && ...}` 사이):

```tsx
          {tab === 'deviation' && (
            <DeviationView artifactsDir={analysis.artifacts_dir} paths={deviation} />
          )}
```

- [ ] **Step 9: 통과 확인**

Run: `cd D:\Projects\Flatness\dashboard && npx vitest run components/analysis`
Expected: PASS (기존 3파일 + 신규 2파일, 신규 6건 포함 전부 통과)

- [ ] **Step 10: 전체 대시보드 스위트·린트 회귀 확인**

Run: `cd D:\Projects\Flatness\dashboard && npm run test`
Expected: `111 passed` (기준선 105 + 신규 6)

Run: `cd D:\Projects\Flatness\dashboard && npm run lint`
Expected: 경고·오류 없음(`no-img-element`는 주석으로 비활성화됨)

- [ ] **Step 11: 커밋**

```bash
git add dashboard/lib/domain/types.ts dashboard/components/analysis/deviation-view.tsx \
        dashboard/components/analysis/analysis-result.tsx \
        dashboard/components/analysis/__tests__/deviation-view.test.tsx \
        dashboard/components/analysis/__tests__/analysis-result.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): 결과 화면에 정밀 편차맵 탭 추가

stats.deviation_paths를 그대로 순회해 표시하므로 벽 결번을 별도 처리하지 않는다.
캡션 문구는 워커 보고서와 동일하게 맞췄고, 판정과 무관하다는 고지를 함께 표시한다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## 완료 검증 (마지막 태스크 후 1회)

- [ ] 세 스위트 전부 실행하고 **출력을 눈으로 확인**한다: engine `124 passed, 1 deselected` / worker `58 passed, 1 deselected` / dashboard `111 passed`
- [ ] U+2014 스캔을 **리터럴 글리프**로 수행한다(`$'\u2014'` 확장 금지). 신규·수정 파일 대상:
  `git diff --name-only main | xargs grep -n "—"` → 사용자 대면 문자열(PNG 제목·컬러바 라벨·figcaption·대시보드 문구)에 검출 0건이어야 한다. 문서 산문에서의 사용은 허용
- [ ] 실제 산출물 육안 확인: 합성 점군으로 `analyze_floor`를 1회 돌려 `deviation.png`를 열고 (a) 결함 위치가 판정 히트맵의 문제 셀과 일치하는지, (b) 배경이 노이즈 수준으로만 보이는지, (c) 한글 제목·컬러바 라벨이 깨지지 않는지 확인한다
- [ ] `docs/contracts/stats-schema.md`에서 **기존 행이 삭제·수정되지 않았는지** diff로 확인한다(추가만 허용)

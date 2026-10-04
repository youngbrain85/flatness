# 3D 점군 1:1 뷰어 설계

승인: 2026-10-02. 사용자가 설계 구획 1(화면)·2(엔진과 파일)·3(실패 처리·테스트·문서·배포)을 전부 승인했고,
"이대로 진행, 검토 없이 구현까지 마무리"로 구현을 승인했습니다.

- **확정 결정의 출처**: `.superpowers/research/3d-pointcloud-viewer/decisions.md`. 이 문서는 그 결정을 코드에 맞춰
  구체화한 것이며 결정을 바꾸거나 범위를 넓히지 않는다. 두 문서가 어긋나면 `decisions.md`가 이긴다.
- **참고 캡처**: `.superpowers/research/3d-pointcloud-viewer/reference-capture.webp`(졸업논문 대시보드의 Plotly 3D 산점도).
  어두운 배경, 오른쪽 위 범례(둥근 표식 + `FLAT`/`DEPRESSION`/`PROTRUSION`), 작은 둥근 점, 옅은 격자와 축 숫자,
  낮게 비스듬히 내려다보는 시점이 이 설계가 맞추는 모습이다.
- **`.superpowers/`는 추적되지 않는 로컬 작업 폴더다**(`.gitignore:1`). `decisions.md`, 참고 캡처, 조사 시제품
  (`design-inputs/`)은 다른 체크아웃에 없다. 확정 결정은 §2와 본문에 전부 옮겨 적었으므로 이 문서만으로 읽을 수 있다.
  "어긋나면 `decisions.md`가 이긴다"는 그 파일이 있는 작업 환경에서의 규칙이다.
- **기존 스펙과의 관계**: `2026-07-27-flatness-dashboard-design.md`(정본)의 판정식·stats 필수 필드·보고서 구성은
  한 글자도 바꾸지 않는다. `2026-09-04-dashboard-cloudscape-redesign-design.md`(리디자인 스펙)에는 §9의 예외 5건을 추가한다.
  데이터 계약 정본은 `docs/contracts/stats-schema.md`이며 이 기능이 더하는 키·경고·파일 형식을 그 문서에 반영한다.
- 이 문서의 파일 경로·줄 번호·시그니처·필드 이름은 2026-10-02 `feat/pointcloud-viewer`(d40a278) 코드를 직접 열어 확인한 값이다.

## 1. 배경과 목표

요청 원문:

> 학부생 졸업 논문을 위해 만들었던 대시보드에서 넣었으면 하는 부분이 있어서 예시로 캡처본 하나 보내드립니다. 해당 부분은
> 기존에 개발했던 대시보드 안에서는 한눈에 알아보기 쉽게 포인트 클라우드의 간격을 넓게 했지만 보내드린 캡쳐본처럼 실제
> 현장 스케일(1:1)에서 어떻게 보이는지 표현이 되었으면 좋을 것 같습니다.

추가 지시: "최대한 샘플 사진 올려준것처럼 보이도록 해줘", "어두운 배경으로 진행. 대신 순수 검정으로."

현재 `3D 프리뷰` 탭은 matplotlib 정적 PNG 1~2장이다(`dashboard/components/analysis/analysis-result.tsx:76-94`).
그 그림은 실제 스케일이 아니다. x·y는 m, z는 잔차에 1000을 곱한 mm 수치이고 축 비율을 지정하지 않는다
(`engine/flatness/outputs/preview3d.py:11`). 점도 원본 점이 아니라 5cm 서브셀 중심을 최대 5만 개로 솎은 격자점이다
(`preview3d.py:19-28`). 원본 점은 분석 중 스트리밍으로만 읽히고 보관되지 않으며(`engine/flatness/core/subcell.py:29-36`),
브라우저가 받을 수 있는 점 단위 산출물이 없다.

**목표**: 바닥 평활도 분석 결과 화면의 기존 `3D 프리뷰` 탭 안에, 실제 스캔 점 표본을 실제 좌표·축 비율 1:1로 보여 주는
회전·줌 가능한 3D 뷰어를 넣는다. 엔진이 새 산출물 `points3d.bin`을 만들고, 대시보드는 라이브러리 없이 직접 구현한
WebGL2로 그린다.

1:1에서는 수 m 바닥 위의 수 mm 편차가 형상으로는 보이지 않는다. 따라서 정보는 점 색(3분류)이 전달하고,
편차 과장 배율은 보조 수단이다.

## 2. 확정 결정

### 2.1 사용자 확정 사항 (바꾸지 않는다)

| # | 결정 | 이 문서의 절 |
|---|---|---|
| D1 | **점**: 원본 스캔에서 뽑은 실제 점 표본. 실제 좌표(m), 기본 축 비율 1:1 | §4.2, §7.4 |
| D2 | **범위**: 바닥 평활도 분석(`analyze_floor`)만. 벽면·구배·임포트 분석은 점 파일을 만들지 않고 화면에 안내 문구를 둔다 | §3, §7.11(안내 문구는 3D 탭이 있는 벽면·임포트에 둔다. 구배는 §7.11 끝의 설명) |
| D3 | **모습은 참고 캡처와 최대한 같게**: 뷰어 영역 배경 순수 검정 `#000000`(대시보드의 나머지는 밝은 테마 그대로). 점 색 FLAT 초록 / DEPRESSION 노랑 / PROTRUSION 빨강. 범례는 뷰어 오른쪽 위, 둥근 표식 + 영어 이름 `FLAT`/`DEPRESSION`/`PROTRUSION`, 흰 글자. 점은 작은 둥근 점(네모 아님). 옅은 격자선과 축을 따라 적힌 숫자(m). 기본 시점은 낮게 비스듬히 내려다보는 각도 | §7.6, §7.7, §7.8, §7.10 |
| D4 | **캡처와 다르게 두는 것**: 점 간격은 캡처보다 촘촘(실제 스케일). 범례에 편차 없는 점(어두운 회색) 항목 하나 추가. 왼쪽 아래에 축 비율·현재 임계값·점 수 상시 표시 | §7.10 |
| D5 | **임계값**: 기본값은 적용 기준의 허용치(`pass_mm`). 화면 슬라이더(1~30mm)로 조정하면 색이 즉시 바뀐다 | §6.1, §7.4, §7.10 |
| D6 | **편차 과장**: ×1(기본) / ×10 / ×50 / ×100. 실제 높이가 아니라 **편차만** 키운다 | §7.4 |
| D7 | **조작**: 드래그 회전, Ctrl+휠 확대(일반 휠은 페이지 스크롤), 시점 버튼 등각·평면·정면, 밝은 배경 전환 버튼(화면 캡처용) | §7.7, §7.10 |
| D8 | **색의 기준값**: 점 자체의 편차가 아니라 그 점이 속한 5cm 서브셀의 잔차(기존 정밀 편차맵이 쓰는 것과 같은 5cm 서브셀 잔차 배열에서 나온 값. 편차맵은 2x2 평균해 10cm로 그린다) | §4.3 |
| D9 | **편차 없는 점**(가구·벽 등 바닥에서 5cm 넘게 떨어진 점, 판정 제외 구역의 점): 어두운 회색으로 함께 그린다 | §4.3, §7.4 |
| D10 | **점 위에 커서를 올리면** 좌표와 편차(mm)를 보여 주는 읽기 창 | §7.9 |
| D11 | **점 수 상한 50만**, 파일 약 4MB | §4.2, §5.1 |
| D12 | **워커는 고치지 않는다**(업로드 실패 자동 재시도 없음). 단 경고 코드 라벨 사본(`worker/flatworker/report/labels.py`)과 그 개수 단언 테스트는 계약 동반 수정이라 고친다 | §6.3 |
| D13 | **보고서 PDF는 기존 `preview3d.png`를 그대로 쓴다.** 뷰어는 대시보드 화면 전용 | §3, §6.1 |
| D14 | **고지 문구**: 점 색은 참고용이며 판정 등급과 다를 수 있음을 뷰어 아래에 적는다(양방향 불일치 모두) | §7.12 |
| D15 | **범위 밖**: 캡처 아래쪽 "직선자 검증 상세" 표, 벽면·구배·임포트의 3D 뷰, 옛 점 파일 삭제, 업로드 재시도, 브라우저 영구 캐시, 과거 분석 소급(백필), 히트맵 셀 연동, 단면·측정 도구, 실색상(RGB) | §3 |

### 2.2 설계 결정 (승인된 구획 1~3)

| # | 결정 | 절 |
|---|---|---|
| E1 | 표본은 `analyze_floor`에서 grid·zones·residuals가 나온 뒤 파일을 한 번 더 스트리밍하는 3번째 패스에서 뽑는다. 기존 `build_subcell_grid(iter_chunks(...))` 호출은 건드리지 않는다 | §4.2, §4.4 |
| E2 | 방식은 칸별 min-hash 층화 추출. 난수·시드 없음. 표본 칸 변 `s = sqrt(점유 면적 / MAX_POINTS)` | §4.2 |
| E3 | 편차를 가진 점이 그렇지 않은 점보다 항상 이기도록 해시 키에 벌점 비트를 둔다 | §4.2 |
| E4 | 청크 크기·점 순서가 달라도 출력이 바이트 단위로 같다. 해시는 좌표별로 따로 섞고 동률은 좌표 사전순으로 깬다 | §4.2 |
| E5 | 출력 순서는 승자의 해시 값 오름차순. 마지막에 앞 `MAX_POINTS`개로 자른다 | §4.2 |
| E6 | `MAX_POINTS = 500_000`(엔진 상수) | §4.1 |
| E7 | 센티널 두 종류: `NOT_FLOOR = -32768`, `NO_DEVIATION = -32767` | §4.3 |
| F1 | 파일은 little-endian 단일 컨테이너 `points3d.bin`: magic `FP3D` + `json_len` + JSON 메타 + `uint16 xyz[3n]` + `int16 dev[n]`, 점당 8바이트 | §5 |
| F2 | 메타에 엔진 버전, 시드, 판정 기준에 종속된 값(임계값 포함)을 넣지 않는다. 같은 스캔이면 기준을 바꿔 재분석해도 파일이 바이트 동일하다 | §5.2 |
| F3 | 작성기는 메모리에서 blob을 완성해 한 번에 쓰고, 쓰기 전에 `n <= MAX_POINTS`와 바이트 수를 단언하며, 예외 시 부분 파일을 지운다 | §5.6 |
| S1 | stats 새 키 `points3d_paths`, `points3d_threshold_q`. 경고 코드 `points3d_render_failed` | §6 |
| S2 | `points3d.bin`은 `preview3d_paths`에 넣지 않는다 | §6.1 |
| S3 | CLI 옵션을 추가하지 않는다 | §4.6 |
| V1 | 의존성 추가 없음. 순수 WebGL2. `getContext('webgl2')`는 effect 안에서만 호출 | §7.1 |
| V2 | GPU에는 로컬 좌표만 넘긴다. 절대 좌표는 JS float64로 읽기 창에서만 더한다 | §7.4 |
| V3 | 분류는 0.1mm 정수 비교. 슬라이더와 셰이더 uniform도 같은 정수 단위 | §7.4 |
| V4 | 편차 있는 점의 깊이는 과장 전 기준면 위치(`z − dev`)로 계산한다 | §7.5 |
| V5 | 탭 이름·순서는 그대로 | §7.10 |
| V6 | 받은 ArrayBuffer를 `AnalysisResult` state에 보관해 탭 왕복 시 다시 받지 않는다 | §7.3 |
| V7 | 캔버스는 JSX `<canvas ref>` + effect에서 렌더러 생성, cleanup에서 버퍼·프로그램 삭제 | §7.2 |
| P1 | 배포 순서는 워커(엔진) → 대시보드. DB 마이그레이션 없음. 이번 작업은 구현·검증까지이고 머지·배포는 사용자 결정 | §13 |

### 2.3 코드를 확인해 이 문서에서 확정한 항목

`decisions.md`가 "계획에서 확정"·"저장소 관례를 확인해 따른다"로 남긴 것을 코드로 확인해 정했다.

| 항목 | 확정 | 근거 |
|---|---|---|
| `ENGINE_VERSION` | **올리지 않는다.** `p4-0.5.0` 그대로. 고정 문자열 문서(`docs/DEPLOY.md:329·482`, `docs/SUPABASE_SETUP.md:541`, `docs/contracts/stats-schema.md:8·105`)도 건드리지 않는다 | `engine/flatness/__init__.py:1`의 이력은 3커밋뿐이다. 정밀 편차맵 산출물 추가(b00feda, 2026-07-30)와 높이 뷰 산출물 추가(ebd0bce, 2026-08-04) 때 값이 바뀌지 않았고, 유일한 인상(6089c03, 2026-08-03 `p1d-0.4.0` → `p4-0.5.0`)은 구배 분석이라는 새 분석 종류가 들어갈 때였다. 산출물 추가는 인상 사유가 아니다 |
| 모듈 분해 | `decisions.md` 4.1의 초안을 그대로 확정한다. 엔진 2개(`core/pointsample.py`, `outputs/points3d.py`), 대시보드 10개(§7.2 표) | 순수 함수는 `lib/viz`에, WebGL 접점은 한 파일에 두는 구조가 `dashboard/lib/viz/heatmap.ts` + `components/analysis/heatmap-view.tsx`의 기존 관례와 같다 |
| stats 키 이름 | `points3d_paths`, `points3d_threshold_q` 그대로 확정 | 기존 조건부 키가 `preview3d_paths`·`deviation_paths`(`string[]`, 파일명만, 없으면 빈 목록)다(`docs/contracts/stats-schema.md:97-98`, `dashboard/lib/domain/types.ts:125-126`). `_q`는 "0.1mm 단위 정수"를 뜻하며 §6.1에 정의를 적는다 |
| 탭 컴포넌트의 실제 구조 | `TabBar`는 버튼 목록만 그리는 표시 전용이고, 탭 본문은 `AnalysisResult`가 `{tab === 'preview3d' && ...}`로 조건부 렌더한다. 탭을 벗어나면 3D 본문이 언마운트된다. 따라서 탭 왕복 뒤에도 남아야 하는 것(점 데이터, WebGL2 탐지 결과 `support`, 소프트웨어 렌더 선택 `optedIn`)은 `AnalysisResult` state에 둔다(§7.3) | `dashboard/components/ui/tab-bar.tsx:3-18`, `dashboard/components/analysis/analysis-result.tsx:37,65,76` |
| 정합 병합 스캔 판별 | `scan.lineage === 'registered'` | `dashboard/lib/domain/types.ts:12`, `worker/flatworker/jobs.py:537`. `AnalysisResult`가 이미 `scan: ScanRow`를 받는다(`analysis-result.tsx:31-35`) |
| 임포트 분석 판별 | `isExternalImport(analysis.engine_version, stats.meta)` | `dashboard/lib/domain/stats.ts:30-33`. `AnalysisResult`가 이미 `isImport`로 계산해 `DeviationView`에 넘긴다(`analysis-result.tsx:59,74`) |
| 벽면 분석 판별 | `analysis.surface === 'wall'` | `analysis-result.tsx:91`의 기존 분기와 같은 조건 |
| 분석 전환 시 캐시 | `AnalysisResult`에는 `key`가 없어 `?analysis=`로 다른 분석을 고르면 같은 인스턴스가 재사용되고 `tab` state도 남는다. 점 데이터 캐시는 `artifacts_dir`로 키를 잡아 다른 분석의 데이터를 쓰지 않고(`loadFor`), 탭 본문은 `<Preview3dTab key={analysis.id}>`로 분석이 바뀌면 새로 마운트한다(§7.3) | `dashboard/app/scans/[id]/page.tsx:472`, `analysis-result.tsx:41-55`(cells도 `artifacts_dir` 의존) |
| 경고 코드 개수 단언 | 12 → 13 두 곳: `engine/tests/test_summary.py:76`, `worker/tests/test_report_labels.py:73` | 직접 확인. 주변 주석(`test_summary.py:72`의 "12개 중", `:82`의 "렌더 실패 3종")도 함께 고친다 |

### 2.4 이 문서에서 값을 정한 공학 상수

`decisions.md`가 방식만 정하고 값을 남긴 것이다. 전부 코드의 이름 붙은 상수로 둔다.

| 상수 | 값 | 위치 |
|---|---|---|
| 시야각 `FOVY` | 40° | `orbit.ts` |
| 프리셋 각도 | 등각: 방위 −55°, 고도 20° / 평면: 방위 −90°, 고도 89.9° / 정면: 방위 −90°, 고도 5° | `orbit.ts` |
| 고도 제한 | ±89.9° | `orbit.ts` |
| 줌 제한 | 거리 `[0.02 × R, 20 × R]` (`R` = fit 반경) | `orbit.ts` |
| 드로잉 버퍼 배율 | `min(devicePixelRatio, 2)` | `points3d-view.tsx` |
| 뷰어 영역 비율 | 폭 100%, `aspect-ratio: 4 / 3` | `points3d-view.tsx` |
| 점 실제 크기 | `0.55 × sample_cell_m` | `budget.ts` |
| 점 최소 크기 | CSS 1.5px(드로잉 버퍼로는 `1.5 × 배율`) | `budget.ts` |
| LOD 시작 점 수 | `min(n, 150_000)` | `budget.ts` |
| LOD 하한 | `min(n, 20_000)` | `budget.ts` |
| LOD 조정 | `frameMs`(§7.4의 정의)가 33ms 초과면 ×0.7, 20ms 미만이면 ×1.25, 그 사이면 그대로. 결과는 `[min(n, 20_000), n]`으로 clamp | `budget.ts` |
| 조작 종료 판정 | pointerup/pointercancel 즉시, 휠·키는 마지막 입력 후 200ms | `points3d-view.tsx` |
| 읽기 창 반경 | 화면 거리 12px | `pick.ts` |
| 격자 선 수 상한 | x선 + y선 합 40 | `scaffold.ts` |
| 라벨 최소 간격 | 화면 28px | `scaffold.ts` |
| 컨텍스트 복구 대기 | 3,000ms | `gl-renderer.ts` |

## 3. 비범위

- 캡처 아래쪽 "직선자 검증 상세" 표(direction·gap_mm·passed·point_count). 엔진이 라인별 프로파일을 산출하지 않는다.
- 벽면·구배·임포트 분석의 3D 뷰. 벽면은 (u, v, w) 프레임이고 w 부호와 원점이 밖으로 나오지 않는다. 구배는 구역·평면·잔차를
  만들지 않는다(`pipeline.py:316-319`). 임포트는 원본 점과 높이가 없다. 벽면·임포트는 3D 탭에 안내 문구를 두고,
  구배 결과 화면은 3D 탭이 없어 고치지 않는다(§7.11).
- 옛 점 파일 삭제. 재분석마다 새 `artifacts/{analysis_id}/points3d.bin`이 쌓인다. 저장소 객체 삭제 코드를 추가하지 않는다.
- 업로드 재시도·선택 산출물 업로드 실패 강등. 워커는 고치지 않는다.
- 브라우저 영구 캐시(Cache API, IndexedDB). 페이지를 새로 열면 다시 받는다.
- 과거 분석 소급(백필 잡). 새 `job_type`을 만들지 않는다. 옛 분석은 재분석으로 새 분석 행을 만들어야 점 파일이 생긴다.
- 히트맵 셀과 뷰어의 연동, 최악 지점 표시, 단면·측정 도구, 실색상(RGB) 점.
- 보고서 PDF의 1:1 그림. 보고서는 기존 `preview3d.png`를 그대로 쓴다(`worker/flatworker/report/assets.py:145-153`).
- 전체 다크 모드. 어두운 배경은 뷰어 영역에만 있다.
- 3D·차트 라이브러리 도입(three.js, Plotly, deck.gl, regl).
- CLI 옵션(끄기, 상한 인자).
- 모바일 전용 설계. 터치 드래그·핀치는 동작하지만 손가락이 캔버스 위에 있으면 페이지가 스크롤되지 않는다(§14).
- 점 분류 비율 숫자(예: FLAT 99.5%)와 등급 단어 표시. 화면에 만들지 않는다(§8).
- 두 센티널(`NOT_FLOOR`, `NO_DEVIATION`)의 화면 구분. 파일은 구분해 기록하지만 뷰어는 둘 다 "편차 없음" 한 색으로 그린다.
- 노이즈 추정치(σ) 메타와 임계값 얼룩 안내.

## 4. 엔진

### 4.1 모듈과 공개 인터페이스

**`engine/flatness/core/pointsample.py`** (신설)

```python
MAX_POINTS = 500_000          # 점 수 상한(엔진 상수)
OFF_SURFACE_M = 0.05          # 표면 이탈 판정 거리. zones.py:28 band_m 기본값과 같은 값
DEV_UNIT_M = 1e-4             # 편차 정수 1단위 = 0.1mm
DEV_NOT_FLOOR = -32768        # 센티널: 바닥 아님
DEV_NO_DEVIATION = -32767     # 센티널: 바닥 구역 안이지만 잔차 없음
DEV_MIN, DEV_MAX = -32766, 32767   # 유효 편차 범위

@dataclass
class PointSample:
    xyz_local: np.ndarray     # (n, 3) float64. info.bbox_min * scale_to_m 를 뺀 로컬 좌표(m). 해시 순
    dev_q: np.ndarray         # (n,) int16. 0.1mm 단위 편차 또는 센티널
    origin_abs: np.ndarray    # (3,) float64. info.bbox_min * scale_to_m
    sample_cell_m: float      # 표본 칸 변 s
    source_points: int        # 3번째 패스가 읽은 원본 점 수
    cap: int                  # 적용한 상한

def sample_points(chunks, info, scale_to_m, grid, zmap, residuals,
                  max_points=MAX_POINTS) -> PointSample
```

`chunks`는 `iter_chunks(path, chunk_size=...)`가 내는 `(k, 3) float64` 반복자다. 인자 형태는
`build_subcell_grid(chunks, info, scale_to_m, subcell_m)`(`subcell.py:20`)와 맞춘다.

**`engine/flatness/outputs/points3d.py`** (신설)

```python
MAGIC = b"FP3D"
SCHEMA_VERSION = 1
FILE_NAME = "points3d.bin"

def encode_points3d(sample: PointSample) -> bytes      # 메모리에서 blob 완성
def write_points3d(sample: PointSample, out_path) -> str   # 한 번에 쓰고 파일명("points3d.bin")을 반환
def read_points3d(data: bytes) -> tuple[dict, np.ndarray, np.ndarray]
    # (meta, xyz_q uint16 (n,3), dev_q int16 (n,)). §5.6 리더 규칙 1~7로 검증한다. 테스트·왕복 검증용.
    # 검증 실패는 ValueError 이고 메시지는 §5.6 의 실패 사유 문자열 그대로다(예: ValueError("bad_magic"))
```

이 모듈은 matplotlib를 쓰지 않으므로 `heatmap` 부수효과 import를 하지 않는다. 센티널·단위 상수는
`core/pointsample.py`가 정의하고 `outputs/points3d.py`가 import한다(core가 outputs를 import하지 않게 한다).

### 4.2 표본 추출 알고리즘

**좌표.** 리더가 낸 청크를 `p = chunk.astype(np.float64) * scale_to_m`, `rel = p - lo`로 바꾼다.
`lo = info.bbox_min * scale_to_m`(float64)이다. 이후 모든 계산은 `rel`(로컬 좌표, m)로 한다. 대좌표(UTM급)에서
float32로 바로 내리면 지터가 생기므로 float64로 원점을 뺀다(`subcell.py:26-27` 관례).

**표본 칸 크기.**

```
n_occ = count(grid.counts > 0)                 # 점이 하나라도 든 서브셀 수
area  = n_occ * grid.size_m * grid.size_m      # 점유 면적(m2)
s     = sqrt(area / max_points)                # 표본 칸 변(m)
```

`s`가 서브셀 변보다 작아져도 그대로 둔다(원본이 상한보다 적으면 사실상 전 점이 남는다). `read_info`의 bbox는
이상치 제거 없는 min/max라(`engine/flatness/io/reader.py:28-37`) bbox 면적에서 유도하면 잡점 몇 개로 표본이 붕괴한다.
점유 면적에서 유도하는 것이 그 방어다.

표본 칸 격자: `dx, dy` = bbox의 x·y 범위(m). `NX = floor(dx / s) + 1`, `NY = floor(dy / s) + 1`.

**해시.** 리더가 낸 좌표(`scale_to_m`을 곱하기 전 float64)의 비트를 좌표별로 따로 섞는다. 모든 연산은 uint64 wrap이다.

```
mix(v):  v ^= v >> 30;  v *= 0xBF58476D1CE4E5B9;  v ^= v >> 27;  v *= 0x94D049BB133111EB;  v ^= v >> 31
bx, by, bz = chunk의 x, y, z 를 float64 비트 그대로 uint64 로 본 값
h = mix(bx + 0x9E3779B97F4A7C15)
h = mix((h ^ by) + 0xC2B2AE3D27D4EB4F)
h = mix((h ^ bz) + 0x165667B19E3779F9)
hash63 = h >> 1                                # 63비트. 최상위 비트 자리는 벌점에 쓴다
```

좌표마다 mix 한 번을 거치므로 float32 유래 좌표(하위 29비트가 0)에서도 64비트 상태가 유지된다.

**칸별 승자.** 점마다 다음 튜플을 만들고, 같은 표본 칸 안에서 **사전순으로 가장 작은 점 하나**가 승자다.

```
order_key = (penalty, hash63, rel.x, rel.y, rel.z)
penalty   = 0  (그 점의 dev_q 가 유효 편차일 때, §4.3)
          = 1  (dev_q 가 DEV_NOT_FLOOR 또는 DEV_NO_DEVIATION 일 때)
```

`penalty`가 앞에 있으므로 편차를 가진 점이 그렇지 않은 점을 항상 이긴다(천장·보·가구 점이 그 아래 바닥 점을
밀어내지 않는다). `hash63`이 같으면 로컬 좌표 사전순으로 깬다. 튜플 전체가 같은 두 점은 좌표가 완전히 같은
중복 점이므로 어느 쪽이 남아도 출력이 같다. 이 정의는 청크 경계와 점 순서에 의존하지 않는다.

**절차(의사코드).**

```
state = 빈 표(cell int64, penalty uint8, hash63 uint64, rel float64 x3, dev_q int16)
n_seen = 0
for chunk in chunks:
    p   = chunk.astype(float64) * scale_to_m
    rel = p - lo
    n_seen += len(chunk)

    # (1) 서브셀 인덱스. subcell.py:33-34 와 글자 그대로 같은 식
    ny, nx = grid.shape
    ix = clip((rel.x / grid.size_m).astype(int32), 0, nx - 1)
    iy = clip((rel.y / grid.size_m).astype(int32), 0, ny - 1)

    # (2) 점별 편차·센티널 (§4.3)
    dev_q = deviation_q(ix, iy, rel.z)
    penalty = (dev_q <= DEV_NO_DEVIATION)          # 센티널이면 1

    # (3) 표본 칸 번호
    cx = minimum((rel.x / s).astype(int64), NX - 1)
    cy = minimum((rel.y / s).astype(int64), NY - 1)
    cell = cy * NX + cx

    # (4) 해시
    hash63 = 위 정의

    # (5) 청크 안에서 칸별 승자만 남긴 뒤 state 와 합쳐 다시 칸별 승자만 남긴다
    cand  = 칸별_최소(chunk 행들, key = (cell, penalty, hash63, rel.x, rel.y, rel.z))
    state = 칸별_최소(state ∪ cand, 같은 key)

# 출력: 승자를 해시 값 오름차순으로 정렬하고 앞 max_points 개만 남긴다
out = sort(state, key = (hash63, rel.x, rel.y, rel.z))[:max_points]
return PointSample(xyz_local = out.rel, dev_q = out.dev_q, origin_abs = lo,
                   sample_cell_m = s, source_points = n_seen, cap = max_points)
```

`칸별_최소`는 key로 정렬한 뒤 `cell`이 바뀌는 첫 행만 고르는 연산이다(`np.lexsort`).

**구현 제약.**

- bbox 전체 크기의 밀집 배열(`NX × NY` 길이)을 만들지 않는다. 잡점으로 bbox가 커지면 `NX × NY`가
  `bbox 면적 / s²`으로 폭증한다. state는 점이 든 표본 칸만 담는 희소 표다.
- state 크기는 점이 든 표본 칸 수와 같다. 조밀한 바닥에서 상한의 약 100~101%, 얇은 줄 스캔에서 158.5%가
  실측됐다(조사 자료). 그래서 마지막 잘라내기가 반드시 있어야 한다.
- 출력 정렬 키에는 `penalty`를 넣지 않는다. 해시 값만으로 정렬해야 앞쪽 일부만 취해도 바닥 점과 바닥 아닌 점을
  고르게 섞은 표본이 되고, 상한에서 자를 때도 한쪽만 잘리지 않는다.
- 난수와 시드를 쓰지 않는다. numpy 난수열 버전 차이의 영향을 받지 않는다.
- 판정 경로(`subcell.py`, `zones.py`, `cells.py`, `criteria.py`)를 고치지 않는다.
- 해시 계산은 모듈 수준 함수 `_hash63(chunk) -> uint64 배열`로 둔다. 테스트가 이 함수를 상수 함수로 monkeypatch해
  동률 처리 규칙을 검증한다(§10.1).
- 정렬 방법은 구현이 고른다. 결과가 위 `order_key` 정의와 같으면 된다. 예: `penalty`와 `hash63`을 uint64 하나
  (`penalty << 63 | hash63`)로 합쳐 2키 정렬로 줄이고, 같은 칸에서 합친 키가 같은 행에 대해서만 좌표를 비교한다.

**결정성의 범위.** 같은 파일이면 청크 크기·점 순서와 무관하게 `PointSample`의 두 배열이 `tobytes()` 기준으로 같다.
같은 스캔을 다른 포맷·정밀도로 다시 내보낸 파일은 좌표 비트가 달라 다른 점이 뽑힌다(분포는 같다).

### 4.3 점별 편차와 센티널

편차는 그 점이 속한 5cm 서브셀의 잔차 `residuals[iy, ix]`다(구역별 RANSAC 평면 대비, 부호: + 융기 / − 침하,
`engine/flatness/core/zones.py:102`). 기존 정밀 편차맵·3D 프리뷰가 쓰는 것과 같은 배열이다(`pipeline.py:83-91`).

```
label   = zmap.labels[iy, ix]                              # int32, 0 = 구역 없음
ok_zone = (label != 0) and (그 zone 의 status == "ok")
med     = grid.median_z[iy, ix]                            # float32. bbox 최저 z 기준 상대 높이
on_surface = ok_zone and (abs(rel.z - float64(med)) <= OFF_SURFACE_M)     # NaN 비교는 False
r       = residuals[iy, ix]                                # float32, m

if not on_surface:        dev_q = DEV_NOT_FLOOR            # -32768
elif not isfinite(r):     dev_q = DEV_NO_DEVIATION         # -32767
else:                     dev_q = clip(rint(float64(r) * 10000.0), DEV_MIN, DEV_MAX)   # 0.1mm 정수
```

| 기록 | 조건 | 해당하는 점 |
|---|---|---|
| `DEV_NOT_FLOOR` | 서브셀이 구역 없음(라벨 0), 또는 furniture/ghost 구역, 또는 점이 서브셀 중앙값에서 5cm 넘게 벗어남 | 벽·기둥·천장·보, 가구 상판 구역, 바닥 구역 위에 떠 있는 물체, 3점 미만 서브셀의 점 |
| `DEV_NO_DEVIATION` | ok 구역 안이고 표면에서 5cm 이내인데 서브셀 잔차가 NaN | bimodal(쌍봉) 서브셀의 점(`zones.py:103`) |
| 유효 편차 | 그 외 | 판정에 쓰인 바닥 표면 점 |

- `rint`는 `numpy.rint`(짝수 반올림)다. NaN과 범위 초과 값을 그대로 정수로 캐스트하면 조용히 틀린 값이 되므로
  마스킹과 clip을 캐스트 앞에 둔다.
- 3점 미만 서브셀은 `median_z`가 NaN이라 레벨 밴드 마스크(`zones.py:37`)와 영역 성장(`zones.py:53,70`) 어느 쪽에도
  들어가지 못해 **현재 코드에서 항상 라벨 0**이다. 따라서 `DEV_NOT_FLOOR`로 기록된다. `build_zones`가 바뀌어 중앙값이
  NaN인 서브셀이 구역에 들어가더라도 위 의사코드의 표면 판정(`abs(rel.z - med) <= OFF_SURFACE_M`)이 False라 여전히
  `DEV_NOT_FLOOR`다. NaN 중앙값을 따로 처리하지 않는다. `DEV_NO_DEVIATION`은 중앙값이 유한하고(표면 판정 통과)
  잔차만 NaN인 경우이며, 현재 코드에서는 bimodal 서브셀뿐이다.
- 서브셀 인덱스 식이 `subcell.py:33-34`와 `pointsample.py` 두 곳에 있게 된다. 한쪽만 바뀌면 점이 이웃 서브셀의 편차로
  칠해지므로 §10.1의 재계산 일치 테스트로 묶는다.

### 4.4 파이프라인 삽입 지점

`engine/flatness/core/pipeline.py`의 `analyze_floor`(`:37-103`)만 고친다.

- import는 모듈 최상단에 둔다(`pipeline.py:15-24`의 monkeypatch 관례):
  `from flatness.core.pointsample import sample_points`,
  `from flatness.outputs.points3d import FILE_NAME as POINTS3D_FILE, write_points3d`. 파일명은 `outputs/points3d.py`의
  `FILE_NAME` 한 곳에만 리터럴로 둔다.
- 삽입 위치는 히트맵 렌더 블록(`:96-99`) 다음, `if render_warns:`(`:100`) 앞이다. `write_outputs`(`:102`) 이전이므로
  stats.json에 키가 기록된다.
- 기존 세 렌더 블록과 **별개의 독립 try/except**다.

```python
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
```

- 기존 2번째 패스 `build_subcell_grid(iter_chunks(...))`(`:40-41`)와 그 뒤 판정 단계(`:42-75`)는 한 줄도 바꾸지 않는다.
- `analyze_wall`, `analyze_slope`, `judge_slope_cells`, 임포터(`importer/common.py`)는 고치지 않는다.

### 4.5 실패 격리

- 표본 추출·파일 쓰기가 어떤 예외로 실패해도 판정 수치(`grade_counts`, `worst`, `value_*`, `coverage_pct`,
  `applied_criteria`, `zones`)와 `cells.json`·`results.csv`·`heatmap.png`·`preview3d*.png`·`deviation.png`는 실패가 없을 때와 같다.
- 실패 시 stats에는 `points3d_paths = []`와 경고 `points3d_render_failed`만 남는다. `points3d_threshold_q`는 없다.
- `out_dir`에 `points3d.bin`이 남지 않는다. 워커가 `out_dir`의 모든 파일을 올리기 때문이다
  (`worker/flatworker/storage.py:54-65`, 호출부 `worker/flatworker/jobs.py:278`).
- 종합의견(`auto_summary`)은 삽입 지점보다 앞(`pipeline.py:75`)에서 만들어지고, `outputs/summary.py`의 `_WARN_TEXT`는
  렌더 실패 코드를 의도적으로 싣지 않는다(`engine/tests/test_summary.py:80-98`). 새 코드도 `_WARN_TEXT`에 넣지 않는다.
- 격리 밖에 남는 것: 워커의 업로드. 업로드가 실패하면 분석 잡 전체가 총 3회 시도 뒤 실패한다(§14).

### 4.6 ENGINE_VERSION과 CLI

- `ENGINE_VERSION`은 올리지 않는다(§2.3). 새 산출물의 유무는 버전이 아니라 `points3d_paths` 키로 판별한다.
- CLI 옵션을 추가하지 않는다. `flatness analyze`는 `analyze_floor`를 공유하므로(`engine/flatness/cli.py:142-147`)
  CLI 실행에도 `points3d.bin`이 생긴다.

## 5. 파일 형식 계약 (`points3d.bin`, `schema_version = 1`)

이 절의 내용을 `docs/contracts/stats-schema.md`의 새 절(§9)로 옮겨 계약 정본으로 삼는다(§12).

### 5.1 바이트 배치

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

### 5.2 메타 키

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
같은 스캔이면 기준을 바꿔 재분석해도 파일이 바이트 동일해야 하고, `ENGINE_VERSION`을 올려도 골든 파일이 깨지지 않아야 한다.

### 5.3 예시 메타 JSON

```json
{"schema_version":1,"n_points":118342,"units":"m","origin_m":[254012.3371,4180044.9126,31.4802],"extent_m":[8.0012,6.0009,0.0719],"deviation":{"unit_mm":0.1,"not_floor":-32768,"no_deviation":-32767},"sample_cell_m":0.009797958971132712,"fit_bounds":{"min":[0.0,0.0,0.0],"max":[8.0012,6.0009,0.0719]},"sampling":{"method":"cell min-hash stratified","source_points":120701,"cap":500000},"order":"hash"}
```

실제 파일에서는 이 문자열 뒤에 `8 + json_len`이 4의 배수가 될 만큼 공백이 붙는다.

### 5.4 인코딩 규칙 (작성기)

```
mn  = xyz_local.min(axis=0);  mx = xyz_local.max(axis=0);  ext = mx - mn        # float64
inv = where(ext > 0, 65535.0 / ext, 0.0)
q   = clip(rint((xyz_local - mn) * inv), 0, 65535).astype('<u2')                # (n, 3), C 순서 = x,y,z 인터리브
dev = sample.dev_q.astype('<i2')                                                # 이미 센티널·clip 이 끝난 값
deq = q * ext / 65535.0                                                         # 복원 좌표(파일-로컬)
has = dev > -32767
fit_min, fit_max = (deq[has].min(0), deq[has].max(0)) if has.any() else ([0,0,0], ext)

meta = {                                                  # dict 삽입 순서 = 기록 순서(§5.2)
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

- 범위가 0인 축은 `q = 0`, `extent_m = 0`으로 기록한다.
- `fit_bounds`는 양자화 뒤 복원 좌표로 계산한다(뷰어가 그리는 점을 정확히 감싼다).
- JSON 숫자는 Python `float`의 `repr`(최단 왕복 표기)로 쓴다. 플랫폼·버전과 무관하게 같은 바이트가 나온다.

### 5.5 복원 식 (리더)

```
local[i]  = q[i] * extent_m / 65535          # 파일-로컬 좌표(m). q[i] = (xyz[3i], xyz[3i+1], xyz[3i+2])
abs[i]    = origin_m + local[i]              # 절대 좌표(m). float64 로만 계산한다
dev_mm[i] = dev[i] * 0.1                     # dev[i] > -32767 일 때만
```

- `dev[i] == -32768`: 바닥 아님. `dev[i] == -32767`: 바닥 구역 안이지만 잔차 없음. 둘 다 편차가 없다.
- 유효 편차 범위는 `[-32766, 32767]`(−3276.6mm ~ +3276.7mm)이고 범위 밖 값은 끝값으로 clip돼 있다.
- 좌표 분해능은 축 범위 / 65535다(8m에서 0.12mm, 30m에서 0.46mm, 100m에서 1.5mm). 편차 분해능은 0.1mm다.

### 5.6 검증 규칙

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

## 6. stats 계약 변경

### 6.1 새 키 (floor 전용 조건부 키)

| 키 | floor | wall | import | 내용 |
|---|---|---|---|---|
| `points3d_paths` | O | 없음 | 없음 | `string[]`. `["points3d.bin"]` 또는 `[]`. 다른 `*_paths` 키와 같은 규약이다: 파일 존재는 이 키로 판별하고, 소비자는 키가 없으면 빈 목록으로 다룬다. 생성이 예외로 실패하면 `[]`이고 `points3d_render_failed` 경고가 동반된다 |
| `points3d_threshold_q` | 조건부 | 없음 | 없음 | int. 뷰어의 기본 표시 임계값, 0.1mm 단위 정수 = `int(round(criterion.pass_mm * 10))`. **점 파일이 만들어졌을 때만** 기록한다. 스팬 환산과 불확도 U를 적용하지 않는다. 판정에 쓰이지 않는 표시용 값이다 |

- 두 키 모두 `write_outputs` 이전에 stats에 기록한다. 따라서 저장소의 `stats.json`과 DB의 `analyses.stats`
  (`worker/flatworker/jobs.py:207-231`의 `_finalize`가 stats 전체를 저장) 양쪽에 실린다. 워커 코드는 바꾸지 않는다.
- `points3d.bin`은 `preview3d_paths`에 넣지 않는다. 보고서가 그 목록의 파일을 3D 프리뷰 그림으로 복사한다
  (`worker/flatworker/report/assets.py:145-153`).
- 탑재된 바닥 기준의 `pass_mm`은 6·7·10 세 값이다(`engine/flatness/data/seed_criteria.json`). 대응하는
  `points3d_threshold_q`는 60·70·100이다.
- 워커의 확장자 표에 `.bin`이 없으므로 `application/octet-stream`으로 올라간다(`worker/flatworker/storage.py:14-22`).
  매핑을 추가하지 않는다.

### 6.2 경고 코드

| 코드 | 의미 | 발생 경로 | 소스 |
|---|---|---|---|
| `points3d_render_failed` | 3D 점군 뷰어용 점 파일(`points3d.bin`) 생성이 실패해 `points3d_paths`가 `[]`로 저장됨. 판정 수치는 영향 없음 | floor | `core/pipeline.py`(`sample_points`·`write_points3d` 호출부) |

표시 라벨(대시보드 정본과 워커 사본이 같은 문자열):

> 3D 점군 데이터 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.

### 6.3 동반 수정 파일

| 파일 | 현재 위치 | 수정 |
|---|---|---|
| `docs/contracts/stats-schema.md` | `:15-22`(대조 소스 목록) | `engine/flatness/core/pointsample.py`, `engine/flatness/outputs/points3d.py` 추가 |
| 〃 | `:95-105`(§2 조건부 키 표) | `deviation_paths` 행(`:98`) 다음에 §6.1의 두 행 추가 |
| 〃 | `:204-218`(§5 경고 사전 표) | `deviation_render_failed` 행(`:217`) 다음에 §6.2 행 추가 |
| 〃 | `:231-234`(렌더 실패 경고 문단) | 코드 나열에 `points3d_render_failed` 추가 |
| 〃 | `:238-248`(§6 산출물 표) | `deviation_wall{n}.png` 행(`:248`) 다음에 `points3d.bin` 행 추가(경로 floor, "3D 점군 뷰어용 점 표본. 최대 50만 점, 점당 8바이트. 형식은 §9, 생성 여부는 `points3d_paths`로 판별") |
| 〃 | `:507`(§8 끝)과 `:508`(부록 A) 사이 | 새 절 `## 9. points3d.bin 형식 계약 (schema_version=1)`. 이 문서 §5 전체 |
| `dashboard/lib/domain/labels.ts` | `:49-70`(`WARNING_LABEL`) | `deviation_render_failed` 항목(`:68-69`) 다음에 `points3d_render_failed` 추가 |
| `worker/flatworker/report/labels.py` | `:36-58`(`WARNING_LABEL`) | `deviation_render_failed` 항목(`:56-57`) 다음에 같은 문자열로 추가 |
| `engine/tests/test_summary.py` | `:76` | `len(codes) == 12` → `13`, 메시지의 "12개" → "13개". `:72` 주석 "12개 중" → "13개 중", `:82` 독스트링 "렌더 실패 3종 heatmap/preview3d/deviation_render_failed" → 4종(`points3d_render_failed` 포함) |
| `worker/tests/test_report_labels.py` | `:73` | `len(warnings) == 12` → `13`, 메시지의 "12개 코드" → "13개 코드" |
| `dashboard/lib/domain/types.ts` | `:125-127`(`Stats`) | `points3d_paths?: string[]; // floor만(3D 점군 뷰어 파일명)`과 `points3d_threshold_q?: number; // floor만(표시 임계값, 0.1mm 정수)` 추가 |
| `docs/scan-guideline.md` | `:605-607`(§11.3) | 렌더 실패 코드 나열에 `points3d_render_failed` 추가 |

`engine/flatness/outputs/summary.py`의 `_WARN_TEXT`는 고치지 않는다(§4.5).

## 7. 대시보드

### 7.1 기술 원칙

- 의존성 추가 없음. `dashboard/package.json`의 dependencies 6개를 그대로 둔다. 순수 WebGL2로 직접 구현한다.
- `getContext('webgl2')`는 effect 안에서만 부른다. 정적 import로 충분하며 `next/dynamic`·`ssr: false`를 쓰지 않는다.
- 이 저장소의 Next.js(16.2.12)는 관례가 다르다. 코드 전에 `dashboard/node_modules/next/dist/docs/`를 확인한다(`dashboard/AGENTS.md`).
- 서버 컴포넌트 우선은 그대로다. 새 클라이언트 코드는 이미 `'use client'`인 `analysis-result.tsx` 아래에만 생긴다.
- 조용한 실패 금지. fetch 실패·형식 불일치·WebGL2 불가·컨텍스트 손실은 전부 화면에 사유를 드러낸다. 빈 캔버스를 내놓지 않는다.
- 코드 주석은 한국어, 알고리즘·라이브러리 이름은 영어 그대로.

### 7.2 모듈별 책임과 공개 인터페이스

| 모듈 | 책임 | 테스트 |
|---|---|---|
| `lib/domain/points3d.ts` | 파일 파서·형식 가드, 상수(magic, schema version, 센티널, 슬라이더 범위, 과장 배율), 분류 함수, 좌표 복원, 읽기 창 문자열, 색 표, 화면 상태 결정 함수(모드, 탐지·요청 여부, 적재 상태 헬퍼) | vitest |
| `lib/viz/points3d/mat4.ts` | 4×4 행렬(열 우선 `Float32Array(16)`): `perspective`, `lookAt`, `multiply`, `transformPoint`, `project` | vitest |
| `lib/viz/points3d/orbit.ts` | 궤도 카메라 상태(Z-up, 불변), 시점 프리셋, fit, 회전·줌·팬, `viewProj` | vitest |
| `lib/viz/points3d/scaffold.ts` | nice step, 격자·축선 정점, 눈금 값과 라벨 문자열, 라벨 화면 위치와 겹침 솎기 | vitest |
| `lib/viz/points3d/budget.ts` | 점 크기 식, 드래그 중 그릴 점 수(LOD) | vitest |
| `lib/viz/points3d/pick.ts` | 커서 아래 가장 가까운 점 찾기 | vitest |
| `lib/viz/points3d/controls.ts` | 정규화된 입력 이벤트 → 카메라·제스처 상태(순수 reducer) | vitest |
| `lib/viz/points3d/gl-renderer.ts` | **유일한 WebGL 접점.** 환경 탐지, 셰이더·버퍼·draw·dispose, 컨텍스트 손실/복구 | gl 호출 기록 스텁 |
| `components/analysis/points3d-view.tsx` | 캔버스, 범례·HUD·조작 안내·읽기 창·축 라벨 오버레이, 컨트롤 줄, 고지 문구, 로딩 틀, DOM 이벤트 연결(wheel은 네이티브 리스너, §7.7) | 컴포넌트 테스트 |
| `components/analysis/preview3d-tab.tsx` | 뷰어 / 기존 PNG / 경우별 안내 분기(§7.11), WebGL2 탐지와 적재 요청 effect, 다시 시도 | 컴포넌트 테스트 |
| `components/analysis/analysis-result.tsx`(수정) | 3D 탭 첫 진입 때 fetch. 점 데이터·탐지 결과·소프트웨어 렌더 선택을 state에 보관. `:76-94`의 3D 탭 본문을 `<Preview3dTab key={analysis.id}>` 호출로 교체 | 기존 테스트 + 추가 |

`gl-renderer.ts`를 뺀 `lib/` 모듈은 전부 DOM·WebGL을 건드리지 않는 순수 함수다.

**`lib/domain/points3d.ts`**

```ts
export const POINTS3D_MAGIC = 'FP3D';
export const POINTS3D_SCHEMA_VERSION = 1;       // 엔진 outputs/points3d.py SCHEMA_VERSION과 같아야 한다
export const DEV_NOT_FLOOR = -32768;            // 엔진 core/pointsample.py와 같아야 한다
export const DEV_NO_DEVIATION = -32767;
export const DEV_UNIT_MM = 0.1;
export const THRESHOLD_Q_MIN = 10;              // 1mm
export const THRESHOLD_Q_MAX = 300;             // 30mm
export const THRESHOLD_Q_STEP = 5;              // 0.5mm
export const EXAGGERATIONS = [1, 10, 50, 100] as const;

export type PointClass = 'flat' | 'depression' | 'protrusion' | 'none';
export const POINT_CLASS_LABEL: Record<PointClass, string>;   // FLAT / DEPRESSION / PROTRUSION / 편차 없음

export interface Points3dMeta {
  schema_version: number; n_points: number; units: 'm';
  origin_m: [number, number, number]; extent_m: [number, number, number];
  deviation: { unit_mm: number; not_floor: number; no_deviation: number };
  sample_cell_m: number;
  fit_bounds: { min: [number, number, number]; max: [number, number, number] };
  sampling: { method: string; source_points: number; cap: number };
  order: 'hash';
}
export interface Points3dData { meta: Points3dMeta; xyz: Uint16Array; dev: Int16Array; }   // 뷰는 받은 버퍼를 복사 없이 가리킨다
export type Points3dError = 'too_short' | 'bad_magic' | 'bad_header' | 'bad_json'
  | 'unsupported_version' | 'bad_meta' | 'size_mismatch' | 'big_endian_host';
export type Points3dParse = { ok: true; data: Points3dData } | { ok: false; reason: Points3dError };

export function isLittleEndianHost(): boolean;
export function parsePoints3d(buf: ArrayBufferLike, hostIsLittleEndian?: boolean): Points3dParse;
                                                                  // §5.6 리더 규칙. 둘째 인자의 기본값은 isLittleEndianHost()
export function classifyDev(d: number, thresholdQ: number): PointClass;              // 정수 비교(§7.4)
export function localOf(data: Points3dData, i: number): [number, number, number];    // 파일-로컬 m
export function absoluteOf(data: Points3dData, i: number): [number, number, number]; // origin_m + local, float64
export function readoutLines(data: Points3dData, i: number, thresholdQ: number): string[];
                                                                  // §7.9 읽기 창의 줄. 편차 있는 점 5줄, 편차 없는 점 4줄
export function points3dFile(stats: Stats): string | null;        // (stats.points3d_paths ?? [])[0] ?? null. fetch 할 파일명도 이 값이다
export function defaultThresholdQ(stats: Stats): number | null;   // points3d_threshold_q 가 정수면 [10, 300] 으로 clamp, 아니면 null
export function fmtThresholdMm(q: number): string;                // 70 -> "7", 75 -> "7.5", 63 -> "6.3"

export type ThemeName = 'dark' | 'light';
export interface Points3dTheme {                                  // §7.6 색 표의 한 열. 색은 hex 문자열, 알파는 0~1
  background: string; flat: string; depression: string; protrusion: string; none: string;
  line: string; gridAlpha: number; axisAlpha: number;
  text: string; textSecondary: string; readoutBackground: string; readoutAlpha: number;
}
export const POINTS3D_THEME: Record<ThemeName, Points3dTheme>;
export function hexToRgb01(hex: string): [number, number, number];

export type Webgl2Support = 'hardware' | 'software' | 'unsupported';
export type Points3dLoad =                                         // 적재 상태(§7.3)
  | { status: 'idle' }
  | { status: 'loading'; dir: string }
  | { status: 'ready'; dir: string; data: Points3dData }
  | { status: 'error'; dir: string; reason: 'fetch' | 'format' };
export function loadFor(load: Points3dLoad, dir: string | null): Points3dLoad;
    // 지금 보는 분석의 적재 상태. load 가 idle 이 아니고 load.dir !== dir 이면 { status: 'idle' }, 아니면 load 그대로

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
export function resolvePreview3dMode(input: Preview3dInput): Preview3dMode;   // §7.11 표를 그대로 옮긴 순수 함수
export function shouldProbe(input: Preview3dInput): boolean;
    // §7.11 의 1~4행에 해당하지 않고 support === null 일 때 true
export function shouldRequestLoad(input: Preview3dInput): boolean;
    // 모드가 'loading' 이고 support !== null 이고 loadFor(load, dir).status === 'idle' 일 때 true
```

`defaultThresholdQ`와 `points3dFile`은 stats에서 **이 두 키만** 읽는다. `applied_criteria`를 읽지 않는다(§8).
파일명 상수를 TS에 두지 않는다. fetch할 이름은 `points3dFile(stats)`가 돌려준 값이다(다른 `*_paths` 소비자와 같은
규약: `analysis-result.tsx:57,79-82`, `deviation-view.tsx:40-44`). 엔진의 `FILE_NAME`과 맞춰야 할 TS 상수가 생기지 않는다.
`Webgl2Support`와 `Points3dLoad`를 이 모듈에 두는 이유: `lib/domain`이 `lib/viz`를 import하지 않게 한다.

**픽셀 단위.** 아래 시그니처에서 이름이 `css`로 시작하거나 포인터 좌표인 값은 **CSS 픽셀**(포인터 이벤트 좌표,
`clientWidth`·`clientHeight`와 같은 단위)이고, `buffer`로 시작하는 값과 `FrameParams`의 `pxPerUnit`·`minPx`·`maxPx`는
**드로잉 버퍼 픽셀**(`canvas.width`·`canvas.height`, `gl_PointSize`와 같은 단위)이다. 둘은 드로잉 버퍼 배율
(`min(devicePixelRatio, 2)`)만큼 다르다.

**`lib/viz/points3d/orbit.ts`**

```ts
export interface Bounds { min: [number, number, number]; max: [number, number, number]; }
export interface OrbitState { target: [number, number, number]; distance: number; azimuth: number; elevation: number;
                              fovy: number; radius: number; }     // radius = fit 반경(줌 제한의 기준)
export type ViewPreset = 'iso' | 'top' | 'front';
export function fitToBounds(fit: Bounds, preset: ViewPreset): OrbitState;      // 시점 버튼도 이 함수를 다시 부른다
export function rotate(s: OrbitState, dxPx: number, dyPx: number): OrbitState;            // dxPx·dyPx 는 CSS px
export function zoom(s: OrbitState, factor: number): OrbitState;
export function pan(s: OrbitState, dxPx: number, dyPx: number, cssHPx: number): OrbitState;   // 전부 CSS px. cssHPx = canvas.clientHeight
export function eyeOf(s: OrbitState): [number, number, number];
export function viewProj(s: OrbitState, aspect: number, full: Bounds): Float32Array;   // full = [0,0,0] ~ extent_m. near/far 계산에 쓴다
```

**`lib/viz/points3d/scaffold.ts`**

```ts
export function niceStep(rangeX: number, rangeY: number, maxLines?: number): number;
export function buildScaffold(fit: Bounds): { verts: Float32Array; gridVertCount: number; axisVertCount: number;
                                              ticks: AxisTick[]; step: number };
export interface AxisTick { axis: 'x' | 'y'; pos: [number, number, number]; text: string; kind: 'tick' | 'name'; }
export interface PlacedLabel { axis: 'x' | 'y'; kind: 'tick' | 'name'; text: string; x: number; y: number; }   // CSS px
export function layoutLabels(ticks: AxisTick[], viewProj: Float32Array, cssW: number, cssH: number): PlacedLabel[];
```

**`lib/viz/points3d/budget.ts`**

```ts
export function pointWorldSizeM(sampleCellM: number): number;                       // 0.55 * sampleCellM
export function pxPerUnit(bufferHPx: number, fovy: number): number;                 // bufferHPx / (2 * tan(fovy / 2)). bufferHPx = canvas.height
export function pointSizeRange(aliasedRange: [number, number], bufferScale: number): [number, number];
    // [minPx, maxPx], 드로잉 버퍼 px. maxPx = aliasedRange[1], minPx = min(1.5 * bufferScale, maxPx)
export function initialDragCount(n: number): number;                                // min(n, 150_000)
export function nextDragCount(prev: number, n: number, frameMs: number): number;
    // frameMs > 33 이면 prev * 0.7, frameMs < 20 이면 prev * 1.25, 그 사이면 prev.
    // 반올림한 뒤 [min(n, 20_000), n] 으로 clamp 한다. frameMs 의 정의는 §7.4
```

`pxPerUnit`에 CSS 높이를 넘기면 배율 2 화면에서 점 지름이 절반이 된다. 반드시 드로잉 버퍼 높이(`canvas.height`)를 넘긴다
(시제품도 `canvas.height`를 썼다).

**`lib/viz/points3d/pick.ts`**

```ts
export function pickNearest(data: Points3dData, viewProj: Float32Array, exaggeration: number,
                            cssW: number, cssH: number, cursorX: number, cursorY: number,
                            radiusPx?: number): number | null;        // 점 인덱스 또는 null
    // cssW·cssH·cursorX·cursorY·radiusPx 는 전부 CSS px. 커서 좌표는 캔버스 왼쪽 위 기준
```

**`lib/viz/points3d/controls.ts`**

```ts
export type ControlEvent =
  | { type: 'down' | 'move' | 'up' | 'cancel'; pointerId: number; x: number; y: number; button: number; shiftKey: boolean }
  | { type: 'wheel'; deltaY: number; ctrlKey: boolean; metaKey: boolean }
  | { type: 'key'; key: string };
export interface ControlState { camera: OrbitState; pointers: Record<number, { x: number; y: number; button: number; shift: boolean }>;
                                pinchDist: number; }
export function reduceControl(s: ControlState, e: ControlEvent, cssHPx: number):
  { state: ControlState; handled: boolean };
    // x·y·cssHPx 는 CSS px. handled 가 true 일 때만 호출자가 preventDefault 한다.
    // 어느 입력이 handled 인지는 §7.7 조작 표의 "기본 동작 막음" 열이 정한다
```

**`lib/viz/points3d/gl-renderer.ts`**

```ts
export function probeWebgl2(): Webgl2Support;     // 떼어 낸 canvas 로 탐지한 뒤 탐지용 컨텍스트를 반납한다

export interface FrameParams { viewProj: Float32Array; exaggeration: number; thresholdQ: number;
                               pointWorldM: number; pxPerUnit: number; minPx: number; maxPx: number;   // px 3개는 드로잉 버퍼 px
                               drawCount: number; theme: Points3dTheme; }
export interface Renderer {
  setData(data: Points3dData, scaffold: { verts: Float32Array; gridVertCount: number; axisVertCount: number }): void;
  resize(bufferW: number, bufferH: number): void;   // 드로잉 버퍼 px. canvas.width·height 와 viewport 를 맞춘다
  draw(frame: FrameParams): void;
  pointSizeLimit(): [number, number];             // ALIASED_POINT_SIZE_RANGE
  dispose(): void;                                // 버퍼·VAO·프로그램 삭제, 리스너 해제. loseContext 는 부르지 않는다
}
export function createRenderer(canvas: HTMLCanvasElement,
                               on: { lost(): void; restored(): void; unrecoverable(): void }): Renderer | null;
```

`probeWebgl2`의 절차: 문서에 붙이지 않은 canvas에서 `getContext('webgl2', { failIfMajorPerformanceCaveat: true })`가
성공하면 `'hardware'`. 실패하면 새 canvas에서 옵션 없이 `getContext('webgl2')`를 불러 성공하면 `'software'`, 실패하면
`'unsupported'`. 탐지에 쓴 컨텍스트는 `WEBGL_lose_context.loseContext()`로 곧바로 반납한다(탐지용 canvas는 버리는 것이라
재사용 문제가 없다).

`createRenderer`는 `canvas.getContext('webgl2', { antialias: false, alpha: false })`가 null이면 null을 돌려준다.
컨텍스트가 끊기면(`webglcontextlost`) 기본 동작을 막고 `on.lost()`를 부른다. 3,000ms 안에 `webglcontextrestored`가 오면
프로그램을 다시 만들고 `setData`로 받아 둔 배열을 다시 올린 뒤 `on.restored()`를, 오지 않으면 `on.unrecoverable()`을 부른다.
`dispose`에서 `WEBGL_lose_context.loseContext()`를 부르지 않는 이유: React 개발 모드의 effect 이중 실행이 같은
canvas 노드를 재사용하는데, 한 번 끊은 canvas는 다시 `getContext`해도 끊긴 컨텍스트를 돌려준다.

**`components/analysis/points3d-view.tsx`**

```ts
export function Points3dView(props: {
  data: Points3dData;
  defaultThresholdQ: number;          // 엔진이 준 표시 임계값(10~300)
  isRegistered: boolean;              // scan.lineage === 'registered'
  onError(kind: 'webgl' | 'context'): void;   // 'webgl' = createRenderer 가 null, 'context' = 손실 후 3초 안에 복구되지 않음
});
export function Points3dLoadingFrame(props: { theme: ThemeName }); // §7.11 의 로딩 틀. Preview3dTab 의 loading 모드도 이것을 쓴다
```

반환 타입은 적지 않는다(기존 컴포넌트 관례: `analysis-result.tsx:31`, `heatmap-view.tsx:15`). 이 저장소의
`@types/react` 19에는 전역 `JSX` 네임스페이스가 없어 `: JSX.Element`라고 쓰면 `tsc --noEmit`가 TS2503으로 실패한다.

캔버스는 JSX `<canvas ref>`로 두고, effect에서 `createRenderer`를 부르고 cleanup에서 `dispose`를 부른다
(`heatmap-view.tsx:21,33-41,71-72`의 `canvasRef` + effect 관례). effect 안에서 canvas를 만들어 붙이지 않는다.

시점·과장 배율·임계값·배경은 이 컴포넌트의 로컬 state다. 탭을 벗어났다 돌아오거나 다른 분석으로 바꾸면 기본값(등각, ×1,
엔진 기본 임계값, 검정 배경)으로 돌아간다. 상위(`AnalysisResult`)에 보관하는 것은 점 데이터, WebGL2 탐지 결과,
소프트웨어 렌더 선택 세 가지뿐이다(§7.3).

**`components/analysis/preview3d-tab.tsx`**

```ts
export function Preview3dTab(props: {
  analysis: AnalysisRow; stats: Stats; scan: ScanRow; isImport: boolean;
  load: Points3dLoad;                         // 상위가 가진 적재 상태(§7.3). 그대로 넘긴다
  support: Webgl2Support | null;              // 상위가 가진 탐지 결과. null = 아직 탐지 전
  optedIn: boolean;                           // 상위가 가진 소프트웨어 렌더 선택
  onSupport(s: Webgl2Support | null): void;   // 탐지 결과를 상위에 올린다. null = 다시 탐지하겠다(error_webgl 의 다시 시도)
  onOptIn(): void;                            // "3D로 보기"를 눌렀다
  onRequestLoad(): void;                      // 점 파일을 받아 달라(멱등, §7.3 의 4번)
  onRetryLoad(): void;                        // 적재 상태를 버리고 곧바로 다시 받는다(§7.3 의 10번)
});
```

`Preview3dTab`의 로컬 state는 `rendererFailed`와 `contextLost` 둘뿐이다. 탭을 벗어나거나 분석이 바뀌면(`key`) 사라진다.

### 7.3 데이터 적재 흐름

`analysis-result.tsx`에 state 세 개를 `useState`로 둔다. 셋 다 탭 본문이 언마운트돼도 남아야 하는 값이다.

| state | 초기값 | 수명 |
|---|---|---|
| `load: Points3dLoad` | `{ status: 'idle' }` | `dir`로 키를 잡는다. 다른 분석의 데이터는 `loadFor`가 `idle`로 취급한다 |
| `support: Webgl2Support \| null` | `null` | 기기의 성질이다. `AnalysisResult` 수명에 한 번 탐지하고 탭 왕복·분석 전환에도 유지한다 |
| `optedIn: boolean` | `false` | 사용자의 선택이다. 탭 왕복·분석 전환에도 유지한다 |

`Preview3dTab`은 `<Preview3dTab key={analysis.id} ...>`로 그린다. 3D 탭을 연 채 `?analysis=`로 다른 분석을 고르면
(`page.tsx:395,472`. `AnalysisResult` 인스턴스와 `tab` state가 그대로 남는다) 탭 본문이 새로 마운트되어 `rendererFailed`·
`contextLost`와 `Points3dView`의 시점·과장 배율·임계값·배경이 전부 초기값으로 돌아가고 아래 effect가 다시 돈다.

`Preview3dTab`은 props로 `Preview3dInput`(§7.2)을 만들고 effect 두 개를 둔다.

- **탐지 effect**: `shouldProbe(input)`이 참이면 `onSupport(probeWebgl2())`를 부른다. 의존성은 `shouldProbe(input)`의 값이다.
- **요청 effect**: `shouldRequestLoad(input)`이 참이면 `onRequestLoad()`를 부른다. 의존성은 `shouldRequestLoad(input)`의 값과
  `analysis.artifacts_dir`다.

흐름:

1. `AnalysisResult` 마운트 시에는 아무것도 받지 않고 탐지도 하지 않는다. 기존 `cells.json` fetch(`analysis-result.tsx:41-55`)만 돈다.
2. 사용자가 `3D 프리뷰` 탭을 열면 `Preview3dTab`이 마운트된다. `support === null`이면 탐지 effect가 `probeWebgl2()`를 부른다.
   탭을 벗어났다 돌아오면 `support`가 이미 있으므로 다시 탐지하지 않는다.
3. `support`가 `'hardware'`이면 곧바로, `'software'`이면 사용자가 "3D로 보기"를 눌러 `onOptIn()`으로 `optedIn`이 참이 된 뒤에
   요청 effect가 `onRequestLoad()`를 부른다. `'unsupported'`이면 부르지 않는다. 뷰어 대상이 아닌 분석(§7.11의 1~4행:
   벽면, 임포트, 점 파일 없음, 표시 임계값 없음)에서는 탐지도 fetch도 하지 않는다.
4. `onRequestLoad()`(`AnalysisResult`가 정의): `dir = analysis.artifacts_dir`, `file = points3dFile(stats)`. 둘 중 하나가 null이면
   아무것도 하지 않는다. `loadFor(load, dir).status !== 'idle'`이면 아무것도 하지 않는다(멱등). 그 밖에는 상태를
   `{ status: 'loading', dir }`로 두고 fetch를 시작한다. 진행 중인 요청의 `dir`을 ref로도 들어 멱등 검사에 함께 쓴다
   (개발 모드의 effect 이중 실행에서 같은 렌더의 `load`를 두 번 보고 fetch가 두 번 나가지 않게 한다).
5. fetch는 `fetch(artifactUrl(dir, file))` 뒤 `res.arrayBuffer()`다. 파일명은 TS 상수가 아니라 stats가 준 이름이다(§7.2).
   `/api/data` 라우트는 인증 확인 후 300초 서명 URL로 302한다(`dashboard/app/api/data/[...path]/route.ts:8,22-31`).
   서명 URL을 보관하지 않는다. 다시 받을 때는 항상 `/api/data`를 다시 거친다.
6. fetch와 `arrayBuffer()`를 try/catch로 감싼다(`slope-result.tsx:129-154`의 양식). `!res.ok` 또는 예외면
   `{ status: 'error', dir, reason: 'fetch' }`.
7. `parsePoints3d(buf)`가 실패하면 `{ status: 'error', dir, reason: 'format' }`. 성공하면 `{ status: 'ready', dir, data }`.
8. 6·7번의 결과는 함수형 갱신으로 반영하며, **현재 상태가 `{ status: 'loading', dir: 요청한 dir }`일 때만** 반영한다.
   그 사이 다른 `dir`의 요청이 시작됐으면 늦게 온 응답을 버린다.
9. `ready` 상태는 탭을 벗어나도 유지된다. 탭 왕복 시 다시 받지 않는다. 분석이 바뀌면(`artifacts_dir`가 달라지면)
   `loadFor`가 옛 데이터를 `idle`로 취급하므로 이전 분석의 점이 새 분석 화면에 나오지 않고, 새로 마운트된 `Preview3dTab`의
   요청 effect가 새 `dir`로 `onRequestLoad()`를 부른다. `load`를 되돌리는 별도 effect는 두지 않는다. 옛 데이터는 새 요청이
   시작될 때 교체된다.
10. `onRetryLoad()`: 4번의 멱등 검사를 건너뛰고 상태를 `{ status: 'loading', dir }`로 둔 뒤 5번부터 다시 한다.

기존 테스트의 전역 fetch 스텁(`analysis-result.test.tsx:42-44`)은 `arrayBuffer`가 없지만, 기존 테스트 4건은 3D 탭을
열지 않으므로 영향이 없다.

### 7.4 렌더 규칙

- **좌표계**: GPU에는 파일-로컬 좌표만 넘긴다. `xyz`를 정규화 `UNSIGNED_SHORT` 속성(0~1)으로 올리고 셰이더가
  `extent_m`을 곱한다. `Float32Array` 사본을 만들지 않는다. `origin_m`(절대 대좌표)은 GPU 변환에 더하지 않는다.
  절대 좌표는 JS float64로 읽기 창에서만 더한다.
- **표시 높이**: `z' = z + dev × (k − 1)`. `k`는 과장 배율(1, 10, 50, 100), `dev`는 m 단위 편차다. 편차 없는 점은
  움직이지 않는다. `k = 1`이면 실제 위치 그대로다(축 비율 1:1). 다층·경사 바닥의 레벨 차는 어느 배율에서도 1배로 남는다.
- **분류**(정수 비교, 엔진의 0.1mm 정수를 그대로 쓴다):

  | 조건 | 분류 |
  |---|---|
  | `d <= -32767`(센티널) | 편차 없음 |
  | `d > T_q` | PROTRUSION |
  | `d < −T_q` | DEPRESSION |
  | 그 외(`−T_q <= d <= T_q`) | FLAT |

  `T_q`는 0.1mm 정수다. 슬라이더는 이 정수를 직접 움직이고(0.5mm 단계 = 5씩) 셰이더 uniform도 정수다. 브라우저에서
  mm를 정수로 반올림하는 연산이 없다. `classifyDev`(읽기 창)와 셰이더가 같은 표를 쓴다.
- **점 모양과 크기**: 둥근 점. 크기는 실제 크기 `0.55 × sample_cell_m`을 화면 픽셀로 환산한 값이다. `gl_PointSize`는
  드로잉 버퍼 픽셀이므로 환산 계수는 `pxPerUnit(canvas.height, FOVY)`(버퍼 높이 기준)이고, 범위는
  `pointSizeRange(renderer.pointSizeLimit(), 배율)`이 주는 `[minPx, maxPx]`(버퍼 px. 최소는 CSS 1.5px = 버퍼 `1.5 × 배율`,
  최대는 `ALIASED_POINT_SIZE_RANGE[1]`)로 clamp한다.
- **LOD**: 조작 중(드래그·핀치·휠·키)에는 앞 `drawCount`개만 그린다. 파일이 해시 순이라 앞쪽 일부가 고른 표본이다.
  - `drawCount`의 초기값은 `initialDragCount(n)`이다. `Points3dView`가 ref로 들고, 조작이 새로 시작돼도 되돌리지 않고
    직전 조작의 마지막 값을 잇는다(느린 기기에서 조작마다 처음 몇 프레임이 다시 버벅이지 않게 한다).
  - **`frameMs`의 정의**: 조작 중에 점을 그린 rAF 콜백의 타임스탬프와 **바로 다음 rAF 콜백**의 타임스탬프의 차다.
    이를 재기 위해, 조작 중에 그린 콜백은 다음 rAF를 하나 더 예약한다(측정용 콜백). 측정용 콜백은
    `drawCount = nextDragCount(drawCount, n, frameMs)`를 적용한 뒤, 그 사이 그리기 요청이 있었으면 그리고(그러면 다시
    측정용 콜백을 하나 예약한다) 없었으면 그리지 않고 끝난다.
  - 입력 이벤트 사이의 간격은 재지 않는다. 천천히 끌거나 잠깐 멈춰도 `frameMs`는 그린 직후의 한 프레임 간격이라
    렌더 비용만 반영한다. 조정은 측정용 콜백에서만 일어나므로 조작의 첫 그리기는 조정 없이 직전 `drawCount`로 그린다.
  - 조작이 끝나면(§2.4의 조작 종료 판정) `n`개 전부를 한 번 그린다. 이 그리기 뒤에는 측정용 콜백을 예약하지 않는다.
  - HUD의 점 수는 LOD와 무관하게 항상 `n`이다.
- **그리기 시점**: 연속 루프를 돌리지 않는다. 카메라·uniform·크기가 바뀌었을 때만 `requestAnimationFrame`으로 한 번 그린다.
  예외는 위 LOD의 측정용 콜백 하나뿐이며, 그 콜백은 그릴 것이 없으면 그리지 않으므로 조작이 멈추면 한 프레임 뒤에 rAF가 끊긴다.
- **그리기 순서**: (1) 배경색으로 clear, (2) 격자·축선(블렌딩 켬, 깊이 쓰기 끔), (3) 점(블렌딩 끔, 깊이 테스트 `LESS`, 깊이 쓰기 켬).

### 7.5 셰이더가 하는 일

**점 정점 셰이더**

| 입력 | 내용 |
|---|---|
| `aPos` | `vec3`. 정규화 `UNSIGNED_SHORT` x3(`vertexAttribPointer(..., normalized = true)`). 0~1 |
| `aDev` | `int`. `SHORT` x1(`vertexAttribIPointer`). 0.1mm 정수 또는 센티널 |
| `uExtent` | `vec3`. `extent_m` |
| `uViewProj` | `mat4`. 파일-로컬 좌표 → 클립 좌표 |
| `uExag` | `float`. 과장 배율 `k` |
| `uThresholdQ` | `int`. `T_q` |
| `uPointWorldM`, `uPxPerUnit`, `uMinPx`, `uMaxPx` | `float`. 점 크기 계산용. `uPointWorldM`은 m, 나머지 셋은 드로잉 버퍼 px(§7.2) |
| `uColFlat`, `uColDep`, `uColPro`, `uColNone` | `vec3`. §7.6 색 표에서 온 값 |

```
local   = aPos * uExtent
hasDev  = aDev > -32767
devM    = hasDev ? float(aDev) * 1e-4 : 0.0
shown   = local + vec3(0, 0, devM * (uExag - 1.0))            // 표시 위치
clipS   = uViewProj * vec4(shown, 1)
if hasDev:
    ref   = local - vec3(0, 0, devM)                          // 과장 전 기준면 위치
    clipR = uViewProj * vec4(ref, 1)
    gl_Position = vec4(clipS.xy, clipR.z / clipR.w * clipS.w, clipS.w)   // 화면 위치는 shown, 깊이는 ref
else:
    gl_Position = clipS                                       // 편차 없는 점은 실제 깊이
gl_PointSize = clamp(uPointWorldM * uPxPerUnit / clipS.w, uMinPx, uMaxPx)
vColor = !hasDev ? uColNone : aDev > uThresholdQ ? uColPro : aDev < -uThresholdQ ? uColDep : uColFlat
```

편차 있는 점의 깊이를 기준면 위치로 계산하면 바닥 점들이 같은 면에 놓여, 융기 점이 카메라에 가깝다는 이유로
침하 점을 가리는 편향이 없어진다. 같은 깊이에서는 먼저 그린 점이 이기고(`LESS`), 그리기 순서가 해시 순이라 분류와 무관하다.
편차 없는 점(벽·가구)은 실제 깊이를 써서 바닥과의 앞뒤 관계가 유지된다.

**점 프래그먼트 셰이더**: `length(gl_PointCoord - 0.5) > 0.5`이면 `discard`(둥근 점). 아니면 `vec4(vColor, 1)`.

**선 셰이더**: `aPos`(`vec3` float, 파일-로컬 좌표)에 `uViewProj`를 곱한다. 색은 `uColor`(`vec4`, 알파 포함) uniform.
격자 구간과 축선 구간을 `drawArrays(LINES, ...)` 두 번으로 그리며 uniform 색만 바꾼다.

색은 GLSL에 상수로 적지 않는다. 전부 `POINTS3D_THEME`의 hex에서 `hexToRgb01`로 바꿔 uniform으로 넘긴다(색의 출처를 한 곳으로 둔다).

### 7.6 색 표

`POINTS3D_THEME`의 값이다. 캔버스(WebGL)와 DOM 오버레이(범례·HUD·라벨·읽기 창)가 같은 표를 읽는다.

| 항목 | 검정 배경(기본, `dark`) | 밝은 배경(전환 시, `light`) |
|---|---|---|
| 배경 | `#000000` | `#ffffff` |
| FLAT | `#4cc96f` | `#1e9e50` |
| DEPRESSION | `#f5c33b` | `#b88700` |
| PROTRUSION | `#f06464` | `#d93636` |
| 편차 없음 | `#4a4f57` | `#b4bac2` |
| 격자선 | `#ffffff` 알파 0.09 | `#000716` 알파 0.09 |
| 축선 | `#ffffff` 알파 0.28 | `#000716` 알파 0.28 |
| 글자 | `#f2f4f7` | `#000716` |
| 보조 글자 | `#9aa3ad` | `#5f6b7a` |
| 읽기 창 배경 | `#000000` 알파 0.8 | `#ffffff` 알파 0.9 |
| 읽기 창 테두리 | 축선과 같은 값 | 축선과 같은 값 |

- 글자: 범례 이름, HUD, 읽기 창 본문. 보조 글자: 축 눈금 숫자, 축 이름, 조작 안내.
- 뷰어의 초록은 "FLAT"이고 판정 히트맵의 초록(`GRADE_COLOR.pass = #2e7d32`)은 "적합"이다. 같은 계열 색이 다른 뜻을
  가지므로 고지 문구(§7.12)로 구분한다. 색 값 자체는 `GRADE_COLOR` 5색과 다르다.

### 7.7 카메라와 조작

- **카메라**: 원근 투영 궤도 카메라, Z-up. `eye = target + distance × (cos e · cos a, cos e · sin a, sin e)`
  (`a` = 방위, `e` = 고도).
- **초기 맞춤**: `target` = `fit_bounds`의 중심. `radius` = `max(fit_bounds 대각선 / 2, 0.5m)`.
  `distance = radius / sin(FOVY / 2) × 1.05`. 표본 전체 범위가 아니라 `fit_bounds`에 맞추는 이유: 잡점 몇 개로
  전체 범위가 수십 m가 되면 바닥이 화면에서 점이 된다.
- **클립 평면**: `viewProj`가 호출될 때마다 계산한다. `farRadius` = 현재 `target`에서 전체 범위 상자
  (`[0,0,0]` ~ `extent_m`)의 가장 먼 꼭짓점까지의 거리. `far = distance + farRadius`,
  `near = max(distance − farRadius, distance × 0.001)`. 팬으로 `target`이 움직여도 표본 전체가 잘리지 않는다.
- **프리셋**: 등각(기본, 방위 −55°, 고도 20°), 평면(방위 −90°, 고도 89.9°. 화면 오른쪽이 +x, 위가 +y),
  정면(방위 −90°, 고도 5°). 시점 버튼을 누르면 각도를 바꾸고 맞춤을 다시 한다(팬·줌 초기화).
- **조작**:

  | 입력 | 동작 | 기본 동작 막음(`handled`) |
  |---|---|---|
  | 왼쪽 버튼 드래그, 한 손가락 드래그 | 회전(1px당 0.005rad). 오른쪽으로 끌면 방위가 줄고, 아래로 끌면 고도가 는다 | 아니오(포인터 이벤트는 항상 `false`. 터치 스크롤은 `touch-action: none`이 막는다) |
  | Shift+드래그, 오른쪽 버튼 드래그 | 팬(잡은 지점이 따라오도록 타깃 거리 기준 m/px 환산) | 아니오 |
  | Ctrl+휠, Cmd+휠, 트랙패드 핀치(브라우저가 Ctrl+휠로 전달) | 줌(`distance × exp(deltaY × 0.001)`) | **예.** 브라우저의 페이지 확대를 막는다 |
  | 두 손가락 핀치 | 줌(간격 비) + 팬(중점 이동) | 아니오 |
  | `ArrowLeft` / `ArrowRight` (캔버스 포커스 시) | 방위 +0.1rad / −0.1rad. 왼쪽 / 오른쪽으로 20px 끈 것과 같다 | **예.** 페이지 스크롤을 막는다 |
  | `ArrowUp` / `ArrowDown` (캔버스 포커스 시) | 고도 +0.1rad / −0.1rad. 아래 / 위로 20px 끈 것과 같다(고도 제한 적용) | **예.** 페이지 스크롤을 막는다 |
  | `+`, `=` / `-` (캔버스 포커스 시) | 줌 ×0.9 / ×1.1 | 아니오 |
  | 일반 휠(Ctrl·Cmd 없음) | **가로채지 않는다.** 카메라가 변하지 않는다 | 아니오. `preventDefault`를 부르지 않아 페이지가 스크롤된다 |
  | 그 밖의 키 | 없음 | 아니오 |

- **휠 리스너는 네이티브로 붙인다.** JSX `onWheel`을 쓰지 않는다. effect 안에서
  `canvas.addEventListener('wheel', handler, { passive: false })`로 붙이고 cleanup에서 `removeEventListener`로 뗀다.
  handler는 `reduceControl`이 `handled === true`를 돌려준 경우(Ctrl/Cmd+휠)에만 `preventDefault`를 부른다.
  이유: 이 저장소의 React 19.2.4는 `wheel`·`touchstart`·`touchmove`를 루트에 passive 리스너로 등록한다
  (`dashboard/node_modules/react-dom/cjs/react-dom-client.development.js:19251-19266`). JSX 핸들러 안의 `preventDefault`는
  무시되므로, 그렇게 짜면 Ctrl+휠에서 뷰어 줌과 브라우저 페이지 확대가 함께 일어난다(D7 위반). 저장소에 휠 리스너 선례가
  없어 여기에 못 박는다. 조사 시제품도 같은 방식이었다.
- 나머지 입력(`pointerdown`·`pointermove`·`pointerup`·`pointercancel`, `keydown`, `contextmenu`)은 JSX 핸들러로 붙인다.
  이 이벤트들은 passive가 아니어서 `preventDefault`가 먹는다.
- Ctrl·Cmd·Alt가 눌린 키 입력은 `reduceControl`에 넘기지 않는다(브라우저 단축키, 예: Ctrl+`+` 페이지 확대를 가로채지 않는다).
- 캔버스에 `tabIndex={0}`, `role="img"`, `aria-label="3D 점군 뷰어"`, CSS `touch-action: none`을 준다.
  포커스 표시는 `cs-link` 2px 외곽선이다. 오른쪽 버튼 드래그를 위해 `contextmenu`를 막는다.
- `setPointerCapture`는 `canvas.setPointerCapture?.(id)`로 방어한다(jsdom에 없다).
- 드로잉 버퍼 크기는 마운트 때 한 번 `clientWidth × 배율`, `clientHeight × 배율`(반올림)로 맞추고 `renderer.resize`를 부른다.
  그 뒤의 크기 변화는 `ResizeObserver`로 따른다. `typeof ResizeObserver === 'undefined'`이면 관찰만 건너뛴다(jsdom).

### 7.8 격자·축·라벨

- **범위**: `fit_bounds`의 XY 범위. 범위가 0.1m보다 작은 축은 `fit.min`을 고정하고 max 쪽을 `fit.min + 0.1m`로 늘려
  0.1m로 본다. 아래의 `fit.max`·`rangeX`·`rangeY`는 이렇게 보정한 값이다.
- **간격**: `{1, 2, 5} × 10^p` m 수열(`p`는 정수, 최소 0.01m)에서, x선 수와 y선 수의 합
  (`floor(rangeX / step) + floor(rangeY / step) + 2`)이 40 이하가 되는 가장 작은 값.
- **격자선**: `x = fit.min.x + i × step`(`i = 0 .. floor(rangeX / step)`), `y = fit.min.y + j × step`
  (`j = 0 .. floor(rangeY / step)`). x가 일정한 선은 `y = fit.min.y`에서 `fit.max.y`까지, y가 일정한 선은 `x = fit.min.x`에서
  `fit.max.x`까지 긋는다. 범위가 step의 배수가 아니면 마지막 칸은 step보다 짧고, 먼 쪽 가장자리에는 선이 없다.
  높이는 `z = fit.min.z`(바닥 높이). 편차 과장과 무관하게 움직이지 않는다.
- **축선**: 두 변. x축 변은 `y = fit.min.y`(`x = fit.min.x .. fit.max.x`), y축 변은 `x = fit.min.x`(`y = fit.min.y .. fit.max.y`). 같은 높이.
- **눈금 숫자**: x축 변을 따라 `i × step`, y축 변을 따라 `j × step`. 값은 **fit 범위 최솟값 모서리를 0으로 한 로컬 값**(m)이다.
  자릿수는 `step >= 1`이면 정수, 아니면 step의 유효 소수 자릿수(0.5 → 1자리, 0.05 → 2자리).
- **축 이름**: `x (m)`은 x축 변의 중점 바깥쪽, `y (m)`은 y축 변의 중점 바깥쪽.
- **표시 방식**: 라벨은 캔버스 위 DOM 오버레이(`pointer-events: none`)다. 월드 위치를 `project`로 화면에 옮긴다.
  카메라 뒤(`w <= 0`)이거나 영역 밖이면 숨긴다. 같은 축에서 직전에 남긴 라벨과 화면 거리 28px 미만이면 건너뛴다(겹침 솎기).
  축 이름은 솎지 않는다.
- z축 눈금은 그리지 않는다. 높이는 읽기 창이 알려 준다.

### 7.9 읽기 창

- 마우스·펜 커서가 캔버스 위에서 움직이면, 화면 거리 12px 이내에서 **화면상 가장 가까운 점** 하나를 찾는다
  (`pickNearest`). 거리가 같으면 카메라에 가까운 점. 점의 화면 위치는 표시 위치(과장 반영)다.
- 조작 중(드래그·핀치)에는 찾지 않는다. 한 animation frame에 한 번만 찾는다. 커서가 영역을 벗어나면 숨긴다.
  터치 입력에서는 읽기 창을 띄우지 않는다.
- 내용(커서 오른쪽 아래 12px에 띄우고, 영역을 넘으면 반대쪽으로 뒤집는다):

  ```
  X 254016.337 m
  Y 4180047.912 m
  Z 31.492 m
  편차 +3.2 mm
  PROTRUSION
  ```

  - X·Y·Z는 절대 좌표(`absoluteOf`), 소수 3자리(`toFixed(3)`). Z는 과장하지 않은 실제 높이다.
  - 편차는 `dev × 0.1` mm, 소수 1자리, 부호 표기: 양수 `+`, 음수 `−`(U+2212), 0은 부호 없이 `0.0`.
    정수 `dev`에서 직접 만든다(예: `32` → `+3.2`, `-105` → `−10.5`, `0` → `0.0`).
  - 분류 이름은 현재 임계값 기준 `FLAT` / `DEPRESSION` / `PROTRUSION`(`classifyDev`).
  - 편차 없는 점(두 센티널 모두)은 4·5행 대신 `편차 없음` 한 줄(총 4줄).
- 위 줄들은 `readoutLines(data, i, thresholdQ)`(§7.2, 순수 함수)가 문자열 배열로 만든다. 컴포넌트는 줄을 그대로 그릴 뿐
  형식을 다시 만들지 않는다.
- 숫자는 `font-mono tabular-nums`.

### 7.10 화면 구성 (`3D 프리뷰` 탭 안)

탭 이름과 순서는 그대로다(`['히트맵', '정밀 편차맵', '3D 프리뷰', '현장 사진']`, `analysis-result.test.tsx:97`이 고정).
결과 Container와 3:2 그리드(`analysis-result.tsx:28`)도 그대로이며, 뷰어는 왼쪽 칸(`min-w-0`)에 들어간다.

```
┌──────────────────────────────────────────────────────────────┐
│                                              ● FLAT          │
│                                              ● DEPRESSION    │
│                                              ● PROTRUSION    │
│                                              ● 편차 없음      │
│                    (점군, 격자, 축 숫자)                       │
│                                                              │
│ 축 비율 1:1 · 임계값 ±7 mm · 118,342점     드래그 회전 · Ctrl+휠 확대 │
└──────────────────────────────────────────────────────────────┘
 시점 [등각] [평면] [정면]   편차 과장 [×1] [×10] [×50] [×100]
 임계값 ──●──────── ±7 mm   [밝은 배경]

 점 색은 참고용 표시입니다. ... (고지 문구)
```

1. **뷰어 영역**: 폭 100%, `aspect-ratio: 4 / 3`, `rounded-lg border border-cs-divider`, 배경은 테마 배경색
   (기본 `#000000`). 안에 캔버스와 오버레이.
   - 오른쪽 위 **범례**: 지름 10px 둥근 표식 + 이름 4줄(`FLAT`, `DEPRESSION`, `PROTRUSION`, `편차 없음`). 글자 12px/16px, 글자색.
   - 왼쪽 아래 **HUD**: `축 비율 1:1`(k = 1) 또는 `편차 ×{k} 과장`(k > 1) · `임계값 ±{T} mm` · `{n}점`.
     `{T}`는 `fmtThresholdMm`, `{n}`은 `toLocaleString('ko-KR')`. 글자 12px, 글자색.
   - 오른쪽 아래 **조작 안내**: `드래그 회전 · Ctrl+휠 확대`. 글자 12px, 보조 글자색.
   - 오버레이는 전부 `pointer-events: none`이다.
2. **컨트롤 줄**(뷰어 아래, `flex flex-wrap items-center gap-x-4 gap-y-2`):
   - `시점` + 버튼 `등각` / `평면` / `정면`. 누르면 그 시점으로 맞춘다(선택 상태를 두지 않는다. 회전하면 어느 프리셋도 아니다).
   - `편차 과장` + 버튼 `×1` / `×10` / `×50` / `×100`. 네 버튼 모두 `aria-pressed`를 갖고(선택된 것만 `"true"`),
     선택 배경은 `className="aria-pressed:bg-cs-info-bg"`로 준다. `bg-cs-info-bg`를 그냥 덧붙이면 안 된다:
     `Button`의 normal 변형이 `bg-transparent`를 갖고(`components/ui/button.tsx:11`), 생성된 CSS에서 두 클래스의 특이도가
     같고 `.bg-transparent`가 뒤에 있어 배경이 보이지 않는다. `aria-pressed:` variant는 속성 선택자가 붙어 특이도가 높다.
     공용 `Button`은 고치지 않는다.
   - `임계값` + `<input type="range" min={10} max={300} step={5}>`(`w-40 accent-cs-link`, `aria-label="표시 임계값(mm)"`,
     `aria-valuetext={`±${fmtThresholdMm(T_q)} mm`}`) + 현재 값 `±{T} mm`(`font-mono tabular-nums`).
     input의 값은 0.1mm 정수(10~300)이므로 `aria-valuetext`가 없으면 보조 기술이 7mm를 "70"으로 읽는다.
     초기값은 `defaultThresholdQ`를 그대로 쓴다(5의 배수로 맞추지 않는다). 기본값이 5의 배수가 아니면(예: `pass_mm` 6.3 → 63.
     탑재 기준 6·7·10에서는 생기지 않지만 기준은 DB 행이라 다른 값이 올 수 있다) state·HUD·고지 문구·`aria-valuetext`는
     그 값 그대로(`±6.3 mm`)이고, 손잡이는 브라우저가 가장 가까운 단계에 놓는다. 슬라이더를 움직이면 그때부터 5의 배수가 된다.
   - 버튼 `밝은 배경`. `aria-pressed`로 상태를 표시하고 선택 배경은 과장 버튼과 같은 `aria-pressed:bg-cs-info-bg`다.
     누르면 배경·점·격자·글자 색이 §7.6의 밝은 배경 값으로 바뀐다.
   - 버튼은 전부 `Button`의 `normal`이다. 이 화면의 primary는 페이지 헤더의 "이 위치의 보고서 생성" 하나다(뷰당 primary 1개 규칙).
   - 묶음 이름(`시점`, `편차 과장`, `임계값`)은 `text-sm font-bold`.
3. **고지 문구**(§7.12): `text-xs leading-4 text-cs-text-secondary`. 임계값을 바꾸면 문구의 숫자도 즉시 바뀐다.
4. **정합 병합 안내**: `scan.lineage === 'registered'`일 때만 고지 문구 아래 한 줄.

뷰어가 보일 때는 기존 `preview3d.png`를 함께 그리지 않는다. PNG는 §7.11의 대체 상황에서만 나온다.

### 7.11 상태 분기표

`resolvePreview3dMode`가 위에서부터 차례로 검사해 처음 맞는 행을 고른다. 표의 `L`은 `loadFor(load, dir)`이다
(지금 보는 분석의 적재 상태. `load.dir`이 지금 분석의 `dir`과 다르면 `idle`로 본다).

| # | 조건 | 모드 | 화면 |
|---|---|---|---|
| 1 | `surface === 'wall'` | `wall` | 안내 M1 |
| 2 | `isImport` | `import` | (preview3d 이미지가 있으면 이미지 + 캡션 M10) + 안내 M2. 재분석을 권하지 않는다 |
| 3 | `dir === null` 또는 `file === null` | `no_data` | (preview3d 이미지가 있으면 이미지 + 캡션 M10) + 안내 M3 |
| 4 | `thresholdQ === null`(점 파일은 있는데 `points3d_threshold_q`가 없거나 정수가 아님) | `error_stats` | Alert(error) M6 + (이미지 + 캡션 M10). `다시 시도` 버튼 없음 |
| 5 | `support === null` | `loading` | 로딩 틀 |
| 6 | `support === 'unsupported'` 또는 `rendererFailed` | `error_webgl` | Alert(warning) M7 + `다시 시도` + (이미지 + 캡션 M10) |
| 7 | `support === 'software'`이고 `!optedIn` | `software_prompt` | (이미지 + 캡션 M10) + Alert(info) M4 + 버튼 `3D로 보기` |
| 8 | `L.status === 'error'`, `reason === 'fetch'` | `error_fetch` | Alert(error) M5 + `다시 시도` + (이미지 + 캡션 M10) |
| 9 | `L.status === 'error'`, `reason === 'format'` | `error_format` | Alert(error) M6 + `다시 시도` + (이미지 + 캡션 M10) |
| 10 | `contextLost` | `error_context` | Alert(error) M8 + `다시 시도` + (이미지 + 캡션 M10) |
| 11 | `L.status`가 `'idle'` 또는 `'loading'` | `loading` | 로딩 틀 |
| 12 | `L.status === 'ready'` | `viewer` | `Points3dView` |

- **1~4행은 뷰어 대상이 아닌 분석이다.** WebGL2 탐지도 fetch도 하지 않는다(`shouldProbe`·`shouldRequestLoad`가 거짓).
  1~3행(키 부재)은 오류가 아니므로 Alert와 `다시 시도` 버튼이 없다. 4행은 계약 위반(엔진은 두 키를 함께 쓴다, §4.4)이라
  Alert로 드러내지만, stats가 그대로인 한 다시 시도로 고칠 수 없으므로 버튼을 두지 않는다. 그래서 9행(`error_format`,
  다시 시도 있음)과 모드를 나눴다.
- **5행**은 탐지 전이거나 `error_webgl`의 다시 시도 뒤 다시 탐지하는 동안이다. `load` 상태와 무관하게 `loading`이다.
  탐지가 끝나기 전에는 뷰어를 마운트하지 않는다. `support`와 `optedIn`은 `AnalysisResult` state라(§7.3) 탭을 벗어났다
  돌아와도 5행을 다시 거치지 않는다: 점 데이터가 `ready`이면 하드웨어 기기와 "3D로 보기"를 이미 누른 소프트웨어 렌더
  기기는 곧바로 12행이고, 누르지 않은 소프트웨어 렌더 기기는 7행이다. 탭 왕복마다 "3D로 보기"를 다시 누르게 하지 않는다.
- "preview3d 이미지"는 `(stats.preview3d_paths ?? []).filter(Boolean)`을 기존과 같은 `<img>`로 그린 것이다
  (`analysis-result.tsx:79-84`의 마크업 그대로). 목록이 비면 이미지와 캡션을 그리지 않는다.
- `다시 시도`와 `3D로 보기`는 `Button`의 `normal`이다. `3D로 보기`는 `onOptIn()`을 부른다.
- **로딩 틀**(`Points3dLoadingFrame`. 5·11행과 아래의 컨텍스트 복구 대기): 뷰어 영역과 같은 크기(폭 100%,
  `aspect-ratio: 4 / 3`, `rounded-lg border border-cs-divider`)이고 배경은 테마 배경색이다(인라인 `style`,
  `POINTS3D_THEME[theme].background`. 5·11행은 `dark`, 곧 `#000000`). 가운데에 흰 원형 칩(`rounded-full bg-white p-2`)
  안의 `Spinner`를 두고, 그 아래에 M9를 테마 글자색(인라인 `style`, `dark`에서 `#f2f4f7`)으로 적는다.
  - 뷰어 영역 배경을 순수 검정으로 정한 결정(D3)에 따라 로딩 중에도 틀이 검정이다. 탭에 들어올 때 흰 틀에서 검정 뷰어로
    바뀌는 번쩍임이 없다.
  - 칩을 두는 이유: 공용 `Spinner`(`components/ui/spinner.tsx:15`)의 트랙(`cs-divider`, `#e9ebed`)은 검정 위에서 보이지만
    회전 호(`cs-text`, `#000716`)가 검정 위에서 보이지 않아 회전이 읽히지 않는다. 공용 `Spinner`는 고치지 않는다.
  - 칩의 흰색은 그림의 색이 아니라 `Spinner`의 바탕이므로 기존 `bg-white` 클래스를 쓴다(`heatmap-view.tsx:72`의 선례).
- **`다시 시도`의 상태 전이.**

  | 모드 | `다시 시도`가 하는 일 | 그 뒤 |
  |---|---|---|
  | `error_fetch`, `error_format` | `onRetryLoad()`. 상위가 `load`를 `loading`으로 두고 다시 받는다(§7.3의 10번) | 11행. 결과에 따라 12행 또는 8·9행 |
  | `error_webgl` | `rendererFailed`를 `false`로 되돌리고 `onSupport(null)`을 부른다 | 5행. 탐지 effect가 다시 돌고 결과에 따라 6·7·11·12행. 점 데이터가 `ready`로 남아 있으면 다시 받지 않는다 |
  | `error_context` | `contextLost`를 `false`로 되돌린다 | 12행. `Points3dView`가 새로 마운트되어 새 canvas에서 렌더러를 다시 만든다(끊긴 canvas는 재사용할 수 없다). 점 데이터는 state에 남아 있으므로 다시 받지 않는다 |
  | `error_stats` | 버튼 없음 | |

- 컨텍스트 손실 직후 복구를 기다리는 3초 동안은 모드가 `viewer` 그대로다. `Points3dView`가 뷰어 영역 전체를 덮는
  로딩 틀(현재 테마의 `Points3dLoadingFrame`)을 캔버스 위에 겹친다. 캔버스는 마운트된 채로 둔다(복구 이벤트를 받아야 한다).
  복구되면 보관 중인 점 데이터로 버퍼를 다시 올리고 로딩 틀을 걷는다. 3초 안에 복구되지 않으면 `onError('context')`로
  10행이 된다.
- `rendererFailed`와 `contextLost`는 `Points3dView`가 `onError('webgl' | 'context')`로 알리고 `Preview3dTab`이 로컬 state로 든다.
  탭을 벗어나거나 분석이 바뀌면 사라지므로, 탭에 다시 들어오는 것은 `다시 시도`와 같은 효과다(새 canvas로 다시 만든다).
  `support`와 `optedIn`은 `AnalysisResult` state다(§7.3).
- **구배 분석에는 안내 문구를 두지 않는다.** 구배 결과는 `page.tsx:464-472`가 `isSlopeStats`로 갈라 `SlopeResult`로 그리고
  (`AnalysisResult`를 거치지 않는다), `slope-result.tsx`에는 `TabBar`와 `3D 프리뷰` 탭이 없어 문구를 둘 자리가 없다.
  구배 화면은 고치지 않는다. D2의 안내 문구는 3D 탭이 있는 벽면(M1)·임포트(M2) 분석에 해당한다(확정 결정의 상태 분기
  표에도 구배 행이 없다. 부록 B의 8번).

### 7.12 화면 문구 전문

`{T}`는 `fmtThresholdMm(현재 T_q)`다. 문자열에 U+2014를 쓰지 않는다. 음수 부호는 U+2212(`−`)다.

| ID | 위치 | 문구 |
|---|---|---|
| 고지 | 뷰어 아래 | 점 색은 참고용 표시입니다. FLAT(평탄)은 점이 속한 5cm 칸이 구역 기준 평면에서 ±{T}mm 이내, DEPRESSION(침하)은 −{T}mm 미만, PROTRUSION(융기)은 +{T}mm 초과임을 뜻합니다. 판정 등급은 히트맵 탭의 직선자 틈새 기준이며 측정 방식이 다릅니다. 초록 점이 대부분인 칸이 경계·보수일 수 있고, 노랑·빨강 점이 많은 칸이 적합일 수 있습니다. 임계값을 바꿔도 판정과 보고서는 달라지지 않습니다. |
| 병합 | 고지 아래(정합 병합 스캔만) | 정합 병합 스캔의 점은 원본 점이 아니라 5cm 격자 대표점입니다. |
| M1 | 벽면 분석 | 벽면 분석은 3D 프리뷰 이미지와 3D 점군 뷰를 제공하지 않습니다. |
| M2 | 임포트 | 외부 결과(임포트)에는 3D 점군 데이터를 생성하지 않습니다. |
| M3 | 점 파일 없음 | 이 분석에는 3D 점군 데이터가 없습니다. 재분석하면 생성됩니다. |
| M4 | 소프트웨어 렌더 | 이 기기는 그래픽 가속을 사용할 수 없어 3D 점군 뷰가 느릴 수 있습니다. 기본으로 정적 이미지를 표시합니다. |
| M5 | fetch 실패 | 3D 점군 데이터를 저장소에서 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요. |
| M6 | 형식 불일치(`error_format`), 표시 임계값 없음(`error_stats`) | 3D 점군 데이터 형식을 읽을 수 없습니다. 지원하지 않는 버전이거나 손상된 파일입니다. |
| M7 | WebGL2 불가 | 이 브라우저 또는 기기에서는 WebGL2를 사용할 수 없어 3D 점군 뷰를 표시할 수 없습니다. |
| M8 | 컨텍스트 손실 | 그래픽 컨텍스트가 끊겨 3D 점군 뷰를 표시할 수 없습니다. 다시 시도하세요. |
| M9 | 로딩 | 3D 점군 데이터를 불러오는 중입니다. |
| M10 | PNG 캡션 | 엔진이 생성한 정적 3D 프리뷰 이미지입니다. 높이 축은 편차(mm)이며 실제 축 비율이 아닙니다. |
| 버튼 | | `다시 시도`, `3D로 보기`, `등각`, `평면`, `정면`, `×1`, `×10`, `×50`, `×100`, `밝은 배경` |
| 묶음 이름 | | `시점`, `편차 과장`, `임계값` |
| 범례 | | `FLAT`, `DEPRESSION`, `PROTRUSION`, `편차 없음` |
| HUD | | `축 비율 1:1` / `편차 ×{k} 과장`, `임계값 ±{T} mm`, `{n}점` (가운뎃점 ` · `으로 잇는다) |
| 조작 안내 | | 드래그 회전 · Ctrl+휠 확대 |
| 축 이름 | | `x (m)`, `y (m)` |
| 읽기 창 | | `X {x} m`, `Y {y} m`, `Z {z} m`, `편차 {d} mm`, 분류 이름, `편차 없음` |
| 경고 라벨 | 판정 패널 경고 목록 | 3D 점군 데이터 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다. |

기존 캡션 "워커가 생성한 정적 3D 프리뷰입니다(회전·줌 가능한 뷰어는 정식 단계 백로그)."(`analysis-result.tsx:85-87`)와
"3D 프리뷰가 없습니다 (벽면 분석은 3D 프리뷰를 생성하지 않습니다)."(`:90-92`)는 없앤다.

고지 문구에는 직선자 스팬 숫자를 넣지 않는다. 확정 문구가 "직선자 틈새 기준"으로만 적어 기준마다 다른 스팬
(1m 기준이 있다)을 고정 문자열로 박는 문제를 피했다. 동적으로 채우는 값은 `{T}` 하나다.

### 7.13 색 사용 규칙과 팔레트 스윕

`dashboard/__tests__/palette-sweep.test.ts:14`의 정규식은
`/[\w:/-]*\b(zinc|amber|red|green|emerald|purple|blue)-[0-9]{2,3}\b[\w/]*/`이고, `app`·`components`·`lib`의 모든
`.ts`·`.tsx` 줄(주석과 `__tests__` 포함, `:11,28-37`)을 검사한다. 새 색이 이 스윕에 걸리지 않게 다음을 지킨다.

1. 뷰어 색은 `lib/domain/points3d.ts`의 `POINTS3D_THEME`에 **hex 문자열**로만 둔다(`GRADE_COLOR`와 같은 방식).
   hex는 정규식에 걸리지 않는다.
2. 캔버스는 uniform과 `clearColor`로, DOM 오버레이는 인라인 `style`로 그 hex를 쓴다. 뷰어 색을 위한 Tailwind 색
   유틸리티 클래스를 쓰지 않는다(`bg-black`, `text-white`, 임의 값 클래스 `bg-[#000000]` 포함).
3. `app/globals.css`의 `cs-` 토큰 표에 뷰어 색을 추가하지 않는다. 이 색은 UI 크롬이 아니라 그림의 색이다.
4. 뷰어 바깥 크롬(컨트롤 줄, 고지 문구, 안내, Alert)은 기존 `cs-` 토큰 클래스만 쓴다. 로딩 틀은 뷰어 영역과 같은 자리의
   그림이므로 배경과 글자색을 2번처럼 인라인 `style`의 테마 hex로 주고, `Spinner`를 담는 칩만 기존 `bg-white`를 쓴다(§7.11).
5. 새 파일의 주석·문자열·식별자에 `색이름-숫자` 꼴(`red-500`, `green-600` 같은 표기)을 쓰지 않는다. 색을 말할 때는
   hex나 한글 이름으로 적는다.
6. DOM에 `red-`·`green-` 부분 문자열이 들어가는 이름을 쓰지 않는다(`data-hovered-...`, `rendered-...`는 `red-`를 포함한다).
   `analysis-result.test.tsx:109`의 느슨한 단언(`/zinc-|amber-|red-|green-|purple-/`)을 3D 탭에도 똑같이 건다.

## 8. 판정 이중화 금지와의 관계

이 저장소는 판정 로직을 브라우저에서 다시 계산하지 않는다. 원칙의 출처는 구배 스펙
`2026-08-02-slope-analysis-design.md` §7.3(`:356-363`, 판정 로직을 브라우저에서 미리 계산하는 방식을 의도적으로 피한다)이고,
리뷰 리트머스(브라우저 코드에 판정 임계값 필드가 등장하면 반려)는 구현 계획 `docs/superpowers/plans/2026-08-03-slope-phase-d.md:114`에
적혀 있다. 뷰어의 임계값 슬라이더가 이 규칙과 충돌하지 않도록 다음을 지킨다.

1. **브라우저는 판정 기준 필드를 비교 연산에 쓰지 않는다.** `applied_criteria.pass_mm`·`rework_mm`·`u_mm`을 뷰어 코드가
   읽지 않는다. 엔진이 따로 써 준 표시용 `points3d_threshold_q`만 읽는다. 이 규칙은 소스 검사 테스트로 강제한다(§10.4).
2. **표시 임계값은 합격·불합격을 가르지 않는다.** 판정은 엔진이 직선자 틈새로 이미 끝냈고(`criteria.py:25-55`),
   뷰어의 임계값은 점을 어느 색으로 칠할지만 정한다. 표시 조건용 값을 브라우저에 둔 선례가 있고 그 이유가 코드에 적혀 있다
   (`dashboard/lib/domain/registration.ts:15-22`: "이 값은 합격·불합격을 가르지 않는다 ... 표시 조건만 정한다").
3. **등급 단어와 점 기반 합격률을 화면에 만들지 않는다.** 적합·경계·보수·재시공이라는 말을 점에 붙이지 않고,
   분류 비율 숫자(예: FLAT 99.5%)도 표시하지 않는다. 보고서에 없는 수치가 화면에만 생기지 않게 한다.
4. **측정량이 다르다는 사실을 화면에 적는다.** 점 색은 구역 기준 평면 대비 부호 있는 편차이고, 판정 등급은 부호 없는
   직선자 최대 틈새다. 설계 정본은 평면 편차를 판정에 쓰지 않는 값으로 분류했다(`2026-07-27-flatness-dashboard-design.md` §5.1
항목 7: "판정 미사용, 판정 히트맵과 나란히 배치하지 않음"). 뷰어는 히트맵과 다른 탭에 있다.
   조사 실측에서 두 방향의 불일치가 모두 확인됐다: 허용치와 같은 임계값에서 경계·보수 칸의 점 대부분이 FLAT 색이었고,
   넓은 바닥의 완만한 처짐에서는 적합 칸의 점이 침하 색이었다. 그래서 고지 문구가 두 방향을 모두 말한다.
5. **옛 노트북의 슬라이더와 다른 점.** 설계 정본 §1.2는 옛 노트북의 "임의 임계값(9mm) 슬라이더, 시방서와 무관한 등급"을
   비판했다. 이 뷰어의 슬라이더는 (a) 기본값이 임의 숫자가 아니라 적용 기준의 허용치에서 오고, (b) 등급을 만들지 않으며,
   (c) 현재 값이 HUD와 고지 문구에 항상 표시되고, (d) 값을 바꿔도 판정과 보고서가 달라지지 않는다는 사실을 화면에 밝힌다.

엔진 쪽에서도 표시 임계값은 판정과 분리돼 있다. `points3d_threshold_q`는 stats의 별도 키이고 점 파일 메타에는 없다.
점 파일의 편차값은 `build_zones`의 결과로만 정해지며 `criterion`·`u_mm`과 무관하다(`pipeline.py:45-46`에 기준 인자가 없다).

## 9. 디자인 스펙 예외 (Cloudscape 리디자인 스펙에 추가 기록)

`2026-09-04-dashboard-cloudscape-redesign-design.md`의 끝에 새 절을 추가해 아래 5건을 적고, 이 문서를 가리킨다.

| # | 벗어나는 조항(현재 줄) | 예외 | 사유 |
|---|---|---|---|
| 1 | "다크 모드 없음"(`:25`) | 3D 뷰어 영역에 한해 배경이 순수 검정 `#000000`이다. 전체 다크 모드가 아니며 대시보드의 나머지는 밝은 테마 그대로다. `globals.css`에 다크 모드 규칙을 넣지 않는다 | 사용자 지시(참고 캡처와 같은 모습, 순수 검정). 화면 캡처용 밝은 배경 전환을 함께 둔다 |
| 2 | "이 표 밖의 색을 쓰지 않는다"(`:58`), 색 예외(`:55-57`) | 점 3색 + 편차 없음 색 + 뷰어 글자·격자 색(§7.6)을 hex 상수로 쓴다. `GRADE_COLOR`와 같은 종류의 그림 색 예외다 | 참고 캡처의 색 언어. 팔레트 스윕은 그대로 통과한다(§7.13) |
| 3 | "기능 추가는 §7의 테이블 도구 줄 한 가지뿐"(`:28`) | 3D 뷰어와 그 컨트롤(시점, 편차 과장, 임계값 슬라이더, 밝은 배경)을 추가한다 | 요청된 기능이다 |
| 4 | "서버 스키마·워커·엔진·Supabase 쿼리 로직 무변경"(`:22`) | 엔진에 모듈 2개와 stats 키 2개·경고 코드 1개를 추가하고, 워커의 라벨 사본을 고친다. 서버 스키마와 쿼리는 그대로다 | 브라우저가 받을 점 단위 산출물이 없었다 |
| 5 | "아트보드 14장이 전부다"(`:19`), 시각적 정본 설명(`:7-8`) | 아트보드 `docs/design/cloudscape/ScanDone3D.dc.html`을 추가한다. `ScanDone`과 같은 화면에서 `3D 프리뷰` 탭이 활성인 상태를 그린다. 이 파일은 claude.ai 캔버스에 없고 저장소에만 추가한 1장이다 | 기존 `ScanDone.dc.html:225-229`에는 탭 이름만 있고 3D 탭 본문이 없다 |

리디자인 스펙의 숫자 "14"는 바꾸지 않는다. `:4`(승인 기록 "14개 화면을 그린 캔버스")와 `:6`(캔버스 링크 "1페이지 = 구현 대상
14장")은 claude.ai 캔버스에 대한 사실이고 새 아트보드는 그 캔버스에 없다. `:7-8`의 시각적 정본 설명에는 숫자를 고치는 대신
"2026-10-02 추가 1장: `ScanDone3D.dc.html`(캔버스 밖에서 저장소에 추가, 3D 점군 뷰어)"을 덧붙이고, `:19`("아트보드 14장이
전부다")에는 새 예외 절을 가리키는 주석만 단다.

"차트 라이브러리 추가 없음"(`:26`)과 `dashboard/lib/viz/heatmap.ts:1`의 "외부 라이브러리 금지"는 **지킨다.**
순수 WebGL2 직접 구현이라 벗어나지 않는다.

## 10. 테스트와 검증

### 10.1 엔진

**`engine/tests/test_pointsample.py`**(신설). 합성 픽스처(`engine/tests/fixtures/synthetic.py`)로 정답을 주입한다.

| 테스트 | 단언 |
|---|---|
| 상한 | `max_points`보다 점이 많은 입력에서 `len(xyz_local) <= max_points`. `max_points`를 작게(예: 2,000) 줘서 잘라내기가 실제로 일어나는 경우를 포함한다 |
| 청크 크기 불변 | 같은 점을 청크 크기 7, 1,000, 2,000,000으로 넘겨도 `xyz_local.tobytes()`와 `dev_q.tobytes()`가 같다 |
| 점 순서 불변 | 점을 무작위로 섞어 넘겨도 두 배열의 `tobytes()`가 같다(같은 grid·zmap·residuals를 준다) |
| 동률 처리 | `pointsample._hash63`을 모든 점에 0을 내는 함수로 monkeypatch한 상태에서도 청크 크기 불변과 점 순서 불변이 성립한다(동률을 로컬 좌표 사전순으로 깨는 규칙의 검증) |
| 불균일 밀도 | 한쪽이 수십 배 조밀한 바닥에서, 원본 점이 있는 25cm 타일 가운데 표본이 0점인 타일이 0개 |
| 서브셀 인덱스 재계산 | 표본 점마다 `subcell.py:33-34` 식으로 다시 계산한 인덱스의 `residuals` 값이 `dev_q`와 일치(유효 편차 점) |
| 빈 서브셀 없음 | 표본 점이 있는데 `grid.counts == 0`인 서브셀이 0개 |
| 두 구역 | 높이가 0.5m 다른 두 방에서 평탄부 `dev_q`가 ±1(0.1mm) 이내, 10mm 함몰 핵의 `dev_q`가 음수이고 −100 부근 |
| UTM 오프셋 | 원점 (254000, 4180000, 35) 부근 좌표에서 위와 같은 결과, `origin_abs + xyz_local`이 원본 좌표와 0.001mm 이내 |
| 부호 | 융기(`add_bump` 양수)는 양수 `dev_q`, 침하는 음수 `dev_q` |
| 표면 이탈 | 바닥 위 0.7m의 성긴 상판 점은 전부 `DEV_NOT_FLOOR`. 그 아래 바닥 점이 같은 표본 칸에 있으면 바닥 점이 승자 |
| 센티널 구분 | bimodal 서브셀의 표면 점은 `DEV_NO_DEVIATION`, 라벨 0 서브셀의 점은 `DEV_NOT_FLOOR` |
| 잡점 bbox | 바닥에서 50m 떨어진 잡점 30개를 더해도 표본 점 수가 잡점이 없을 때의 95% 이상 |
| 해시 순서 | `pointsample._hash63(sample.xyz_local)`이 비내림차순. 앞 10%만 취해도 1m 타일을 전부 덮는다(30×20m, 표본 24만 점 기준). `PointSample`에는 해시가 없고 해시 입력은 `scale_to_m`을 곱하기 전 리더 좌표의 비트이므로, **이 테스트의 픽스처는 `scale_to_m = 1.0`과 `bbox_min = (0, 0, 0)`인 `CloudInfo`를 직접 만들어 넘긴다**(점 좌표는 전부 0 이상, `bbox_max`는 실제 최댓값). 그러면 `rel = chunk × 1.0 − 0.0`이 리더 좌표와 비트 단위로 같아 `xyz_local`에서 해시를 그대로 다시 계산할 수 있다. `PointSample`에 해시 필드를 더하지 않는다 |
| clip | 잔차 ±5m를 주입하면 `dev_q`가 `DEV_MAX` / `DEV_MIN`으로 clip되고 센티널과 겹치지 않는다 |

**`engine/tests/test_points3d.py`**(신설)

| 테스트 | 단언 |
|---|---|
| 형식 왕복 | `read_points3d(encode_points3d(sample))`의 복원 좌표가 축 범위 / 65535 / 2 이내, `dev`는 완전 일치 |
| 바이트 배치 | magic, `json_len`, `(8 + json_len) % 4 == 0`, 총 길이 `8 + json_len + 8n` |
| 메타 키 | 키 집합이 §5.2와 정확히 같다. 금지 키(`engine_version`, `seed`, 임계값 계열)가 없다 |
| 상한 단언 | `n > MAX_POINTS`인 표본을 주면 예외, 파일이 생기지 않는다 |
| 부분 파일 삭제 | 쓰기 도중 예외를 주입하면 `out_path`가 남지 않는다 |
| 퇴화 축 | 한 축 범위가 0인 표본에서 예외 없이 `extent_m`의 그 축이 0, 복원 좌표가 0 |
| fit_bounds | 편차 있는 점의 범위와 일치. 편차 있는 점이 없으면 전체 범위 |
| 리더 검증 | §5.6 리더 규칙 1~7을 각각 어긴 변조 버퍼에서 `read_points3d`가 `ValueError`를 던지고 메시지가 그 사유 문자열(`too_short`, `bad_magic`, `bad_header`, `bad_json`, `unsupported_version`, `bad_meta`, `size_mismatch`)이다 |
| 골든 바이트 일치 | §10.2 |
| TS 상수 대조 | `dashboard/lib/domain/points3d.ts`를 정규식으로 읽어 `POINTS3D_MAGIC`, `POINTS3D_SCHEMA_VERSION`, `DEV_NOT_FLOOR`, `DEV_NO_DEVIATION`, `DEV_UNIT_MM`이 엔진 상수와 같다(저장소 파일을 읽는 선례: `test_summary.py:6`) |

**`engine/tests/test_pipeline.py`**(추가)

| 테스트 | 단언 |
|---|---|
| 생성 | `stats["points3d_paths"] == ["points3d.bin"]`, 파일 존재, `stats["points3d_threshold_q"] == 70`(`floor-kcs-exposed`), 저장된 `stats.json`에도 두 키가 있다(`write_outputs` 이전 기록). `"points3d.bin" not in stats["preview3d_paths"]` |
| 격리(점 파일만 실패) | `pl.sample_points`를 예외로 바꾼 실행과 정상 실행을 비교: 판정 수치(§4.5 목록)가 같고, `cells.json`·`results.csv`가 바이트 동일, `heatmap.png`·`preview3d.png`·`deviation.png`가 존재, `points3d_paths == []`, `points3d_threshold_q` 키 없음, 경고에 `points3d_render_failed`, `out/points3d.bin` 없음. `pl.write_points3d`를 예외로 바꾼 경우도 같다 |
| 독립 블록 | 기존 렌더 3종(`render_heatmap`, `render_preview3d`, `render_deviation_map`)을 예외로 바꿔도 `points3d_paths == ["points3d.bin"]`. 반대로 점 파일만 실패해도 `preview3d_paths`·`deviation_paths`가 채워진다 |
| 기준 무관 바이트 동일 | 같은 스캔을 `floor-kcs-exposed`와 `floor-lh-exposed`로 분석하면 `points3d.bin`이 바이트 동일, `points3d_threshold_q`는 70과 60 |
| 청크 크기 불변 | `analyze_floor(..., chunk_size=50_000)`과 기본값의 `points3d.bin`이 바이트 동일 |
| 벽면 | `analyze_wall` 결과에 `points3d_paths`·`points3d_threshold_q` 키가 없고 파일도 없다 |

기존 `test_floor_render_failure_does_not_lose_judged_result`(`test_pipeline.py:184-212`)는 고치지 않는다. 새 블록이 독립이므로
그 테스트는 계속 기존 세 블록의 격리를 검증한다. 새 블록을 기존 try에 합치면 "독립 블록" 테스트가 죽는다.

**`engine/tests/perf/test_memory_spike.py`**(추가): 3천만 점 테스트에 `points3d_paths == ["points3d.bin"]`과 파일 크기
`<= 8 + 4096 + 8 × 500_000` 단언을 더한다. 300만 점 변형을 하나 추가한다(같은 게이트).

### 10.2 형식 골든

- `engine/tests/fixtures/points3d_golden.bin` 하나를 pytest와 vitest가 함께 읽는다. 입력 표본은
  `engine/tests/fixtures/points3d_golden.py`의 `golden_sample()`이 만든다(고정 좌표·고정 편차, 난수 없음).
- 골든의 성질(변이가 죽도록 고른다):
  - 축별 범위가 서로 다르다(예: 4.0 / 2.5 / 0.3m). 축 전치 변이가 죽는다.
  - 원점이 UTM급 대좌표다. `origin_m`을 float32로 다루는 변이가 죽는다.
  - 공백 패딩이 1바이트 이상 필요한 JSON 길이다. 패딩·오프셋 변이가 죽는다.
  - `dev`에 양수, 음수, 0, 두 센티널, `DEV_MAX`, `DEV_MIN`, 임계값 경계값(`70`, `71`, `-70`, `-71`)이 있다.
    부호·엔디안·센티널·경계 비교(`>` 대 `>=`) 변이가 죽는다.
  - 좌표 `q`에 `0x0102`처럼 상·하위 바이트가 다른 값이 있다. 엔디안 변이가 죽는다.
- pytest: `encode_points3d(golden_sample())`이 골든 파일과 **바이트 일치**.
- vitest(`lib/domain/__tests__/points3d.test.ts`): 골든을 `readFileSync`로 읽어
  `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)`로 잘라 넘긴다(작은 Buffer는 풀링된 ArrayBuffer의
  임의 오프셋을 가리킨다). `parsePoints3d`가 성공하고, 점별 복원 좌표·절대 좌표·`dev`가 기대값과 같고,
  `T_q = 70`에서 분류 수(flat / depression / protrusion / none)가 기대값과 같다. 기대값은 `golden_sample()`의 입력에서
  손으로 적은 상수다(파이썬 출력을 복사하지 않는다).
- 골든을 다시 만드는 방법은 `points3d_golden.py`의 `__main__`이다. 형식을 바꾸지 않았는데 골든이 달라지면 결함이다.

### 10.3 워커

- `worker/tests/test_report_labels.py:73`의 개수 단언 12 → 13. 대조 테스트가 `labels.ts`와 `labels.py`의 새 항목이
  같은 문자열인지 확인한다.
- 그 밖의 워커 테스트는 고치지 않는다. 산출물 파일 집합을 고정하는 단언이 없다(`worker/tests`에서 확인).
  `test_jobs.py`·`test_e2e_fake.py`는 `analyze_floor`를 실제로 돌리므로 `points3d.bin` 업로드 경로를 함께 지난다.

### 10.4 대시보드

| 파일 | 내용 |
|---|---|
| `lib/domain/__tests__/points3d.test.ts` | 골든(§10.2). §5.6 리더 규칙의 실패 사유 8종: 1~7은 각각 변조한 버퍼로, `big_endian_host`는 정상 버퍼에 `parsePoints3d(buf, false)`로 확인한다(호스트 성질이라 버퍼 변조로는 만들 수 없다). `classifyDev` 경계(`70`/`71`/`-70`/`-71`, 두 센티널). `defaultThresholdQ` clamp와 null. `fmtThresholdMm`(70 → `7`, 75 → `7.5`, 63 → `6.3`). `readoutLines`: 좌표 소수 3자리, 편차 양수 `+3.2`, 음수 `−10.5`(U+2212), 0은 `0.0`, 임계값에 따른 분류 이름, 두 센티널은 각각 4줄이고 마지막 줄이 `편차 없음`. `loadFor`: `dir`이 같으면 그대로, 다르면 `idle`. `resolvePreview3dMode`의 §7.11 12행 전부와 행 우선순위(`support: null` + `load: ready` → `loading`. `support: 'software'` + `optedIn: false` + `load: ready` → `software_prompt`. `support: 'software'` + `optedIn: true` + `load: ready` → `viewer`. `load`가 `ready`인데 `load.dir !== dir` → `loading`. `thresholdQ: null` → `error_stats`). `shouldProbe`·`shouldRequestLoad`: 1~4행 입력에서 둘 다 false, `support: null`에서 probe만 true, `hardware` + `idle`에서 request true, `software` + `!optedIn`에서 request false, `loading`·`ready`·`error`에서 request false |
| `lib/viz/points3d/__tests__/mat4.test.ts` | `perspective`·`lookAt`·`multiply`·`project`의 기지 값 |
| `lib/viz/points3d/__tests__/orbit.test.ts` | fit 뒤 `fit_bounds` 8꼭짓점이 전부 화면 안. 프리셋 각도. 고도 제한. 줌 제한. 전체 범위가 수십 m여도 fit은 `fit_bounds` 기준 |
| `lib/viz/points3d/__tests__/scaffold.test.ts` | nice step(선 수 40 이하, 수열 값). 눈금이 fit 최솟값 모서리에서 0. 격자선이 `fit.min`에서 `fit.max`까지이고, 범위가 step의 배수가 아니면 마지막 선이 `fit.max`보다 안쪽이다. 0.1m 미만 축은 `fit.min`을 고정한 채 0.1m로 본다. 라벨 겹침 솎기. 카메라 뒤 라벨 숨김 |
| `lib/viz/points3d/__tests__/budget.test.ts` | 점 크기 식. `pxPerUnit(960, fovy)`의 기지 값. `pointSizeRange`의 최소가 `1.5 × 배율`. `nextDragCount` 증감(34ms → ×0.7, 19ms → ×1.25, 25ms → 그대로)과 상·하한(`[min(n, 20_000), n]`. `n < 20_000`이면 항상 `n`) |
| `lib/viz/points3d/__tests__/pick.test.ts` | 12px 이내 최근접, 밖이면 null, 과장 배율에 따라 표시 위치로 찾는다, 편차 없는 점은 과장에도 제자리 |
| `lib/viz/points3d/__tests__/controls.test.ts` | Ctrl 없는 휠은 `handled === false`이고 카메라 불변. Ctrl+휠·Cmd+휠은 줌이고 `handled === true`. 드래그 회전(오른쪽으로 끌면 방위 감소, 아래로 끌면 고도 증가). Shift+드래그·오른쪽 버튼 팬. 두 포인터 핀치. `ArrowLeft`/`ArrowRight`가 방위 +0.1/−0.1, `ArrowUp`/`ArrowDown`이 고도 +0.1/−0.1이고 넷 다 `handled === true`. `+`·`=`·`-`는 줌이고 `handled === false`. 포인터 이벤트는 `handled === false` |
| `lib/viz/points3d/__tests__/gl-renderer.test.ts` | gl 호출 기록 스텁(`__tests__/gl-stub.ts`, `components/registration/__tests__/canvas-stub.ts`와 같은 방식)으로: `uThresholdQ`가 정수 uniform(`uniform1i`)으로 넘어간다, `uExag`·`uExtent`·색 uniform 값, `uPxPerUnit`·`uMinPx`·`uMaxPx`가 `FrameParams` 값 그대로, `drawArrays(POINTS, 0, drawCount)`, `aDev`가 `vertexAttribIPointer`, `aPos`가 정규화 `UNSIGNED_SHORT`, `dispose`가 버퍼·프로그램을 지우고 `loseContext`를 부르지 않는다. 가짜 타이머로: `webglcontextlost` 뒤 3,000ms 안에 `webglcontextrestored`가 오면 재업로드와 `on.restored()`가 있고 `on.unrecoverable()`은 불리지 않는다. 3,000ms가 지나도 오지 않으면 `on.unrecoverable()`이 한 번 불린다 |
| `components/analysis/__tests__/points3d-view.test.tsx` | **화면**: 범례 4항목, HUD 문자열(k = 1과 k > 1), 슬라이더를 움직이면 HUD·고지 문구의 숫자가 바뀐다, `aria-valuetext`가 `±7 mm`, 격자 밖 기본값 63에서 HUD·고지 문구가 `6.3`, 과장 버튼의 `aria-pressed`와 클래스의 `aria-pressed:bg-cs-info-bg`, 밝은 배경 전환 시 배경 인라인 색, 고지 문구 전문, 병합 스캔 한 줄, 버튼이 전부 normal(primary 클래스 없음), DOM에 옛 팔레트 부분 문자열 없음. **휠**: `addEventListener` spy로 캔버스의 `wheel`이 `{ passive: false }`로 등록되고 언마운트 때 해제된다. 캔버스에 `new WheelEvent('wheel', { ctrlKey: true, cancelable: true, bubbles: true })`를 dispatch하면 `defaultPrevented === true`, Ctrl 없는 같은 이벤트는 `false`. **픽셀 단위**: `devicePixelRatio = 2`, `clientWidth`·`clientHeight`를 640·480으로 스텁하면 캔버스 `width`·`height`가 1280·960이고 `uPxPerUnit`이 `960 / (2 tan(FOVY / 2))`다. **LOD**(점 20만 개 합성 데이터, 가짜 타이머로 rAF·setTimeout 진행): 드래그 중 `drawArrays(POINTS, 0, c)`의 `c`가 `initialDragCount(n)`. `pointerup` 뒤 마지막 그리기의 `c === n`. Ctrl+휠 뒤 200ms가 지나면 `c === n`. 그린 콜백과 다음 rAF 사이를 40ms로 주면 다음 `c`가 줄고, 입력 사이를 500ms 띄우는 것만으로는 줄지 않는다. **읽기 창**: 마우스 `pointermove`에서 `readoutLines`의 줄이 보이고, `pointerType: 'touch'`에서는 보이지 않으며, 드래그 중에도 보이지 않는다. **컨텍스트**: 손실 뒤 로딩 틀이 캔버스 위에 겹치고 복구 뒤 걷힌다. 복구 불가면 `onError('context')`, `createRenderer`가 null이면 `onError('webgl')` |
| `components/analysis/__tests__/preview3d-tab.test.tsx` | `probeWebgl2`는 모듈 mock으로 바꾼다. **모드별 화면**(§7.11): 문구 M1~M10, Alert 종류, `다시 시도`·`3D로 보기` 버튼 유무(`error_stats`에는 `다시 시도`가 없다), 임포트에서 "재분석" 문구가 없다. **뷰어 대상 아님**: 벽면·임포트·점 파일 없음·`error_stats`에서 `probeWebgl2`와 `onRequestLoad`가 불리지 않는다. **탐지**: `support: null`로 마운트하면 `onSupport`가 탐지 결과로 불린다. `support`가 이미 있으면 `probeWebgl2`를 부르지 않는다. **소프트웨어 렌더**: `support: 'software'`, `optedIn: false`에서 `onRequestLoad` 0회. `3D로 보기`를 누르면 `onOptIn` 1회. `optedIn: true`로 다시 렌더하면 `onRequestLoad` 1회. **재진입**: `support: 'software'`, `optedIn: true`, `load: ready`로 마운트하면 곧바로 뷰어이고 `probeWebgl2`·`onRequestLoad`가 불리지 않는다. `optedIn: false`면 `software_prompt`이고 `Points3dView`가 마운트되지 않는다(`getContext` 호출 0). **다시 시도**: `error_fetch`·`error_format`에서 누르면 `onRetryLoad` 1회. 뷰어가 `onError('webgl')`을 알린 뒤 `error_webgl`에서 누르면 `onSupport(null)`이 불리고, `support`를 다시 주면 `error_webgl`을 벗어난다. `error_context`에서 누르면 `Points3dView`가 다시 마운트되고(`getContext` 호출 수 증가) `onRetryLoad`·`onRequestLoad`는 불리지 않는다. **분석 전환**: `key`와 `analysis`를 바꿔 다시 렌더하면 오류 플래그가 남지 않고, `load`가 이전 분석의 `ready`여도 뷰어가 아니라 로딩 틀이며 `onRequestLoad`가 불린다 |
| `components/analysis/__tests__/analysis-result.test.tsx`(추가) | 3D 탭을 여는 새 테스트는 `arrayBuffer`를 주는 fetch 스텁과 `probeWebgl2` 모듈 mock을 쓴다. 마운트만으로는 점 파일을 받지 않고 `probeWebgl2`도 부르지 않는다. 3D 탭 첫 진입에 한 번 받고, URL의 파일명은 stats가 준 이름이다(픽스처의 `points3d_paths`를 `['custom3d.bin']`으로 줘서 확인). 다른 탭에 갔다 돌아와도 fetch 횟수와 `probeWebgl2` 호출 수가 1 그대로. 소프트웨어 렌더에서 `3D로 보기`를 누른 뒤 탭을 왕복하면 버튼을 다시 누르지 않아도 뷰어다. 3D 탭을 연 채 `artifacts_dir`와 `id`가 다른 분석으로 다시 렌더하면 새로 받고, 받는 동안 이전 분석의 점으로 뷰어를 그리지 않으며, 받은 뒤 슬라이더 값이 새 분석의 `points3d_threshold_q`다. 분석 A의 응답이 분석 B로 바꾼 뒤에 도착하면 무시되고 B의 상태가 유지된다. `error_fetch`의 `다시 시도`로 fetch가 한 번 더 나간다. 기존 4건은 그대로 통과 |
| `__tests__/points3d-litmus.test.ts` | 소스 검사: `lib/domain/points3d.ts`, `lib/viz/points3d/*.ts`, `components/analysis/points3d-view.tsx`, `components/analysis/preview3d-tab.tsx`에 `pass_mm`, `rework_mm`, `u_mm`, `applied_criteria` 문자열이 0건. 같은 파일들에 U+2014가 0건 |
| `__tests__/palette-sweep.test.ts` | 고치지 않는다. 새 파일을 포함해 0건이어야 한다 |

jsdom에서는 `getContext`가 null이고 `ResizeObserver`·`setPointerCapture`가 없다. 컴포넌트 테스트는
`vi.spyOn(HTMLCanvasElement.prototype, 'getContext')`로 기록 스텁을 끼운다(`overlay-view.test.tsx`의 선례).
실제 픽셀은 vitest로 검증하지 못하므로 §10.6의 화면 캡처 대조가 맡는다. 브라우저가 passive 리스너의 `preventDefault`를
실제로 무시하는지도 jsdom에 기대지 않는다. 휠 회귀는 `{ passive: false }` 등록 단언이 잡고, 실제 동작은 §10.6의 장면 8이 확인한다.

### 10.5 변이 실험 (리뷰 때)

코드가 맞는 것과 테스트가 회귀를 잡는 것은 다른 문제다. 리뷰에서 아래 변이를 하나씩 넣고 대응 테스트가 실제로 죽는지 확인한다.

| 영역 | 변이 | 죽어야 하는 테스트 |
|---|---|---|
| 엔진 | `dev_q` 부호 반전 | 부호, 두 구역 |
| 엔진 | 서브셀 인덱스에서 x·y 전치 | 서브셀 인덱스 재계산 |
| 엔진 | 벌점 비트 제거 | 표면 이탈 |
| 엔진 | 출력 순서를 칸 번호순으로 | 해시 순서 |
| 엔진 | 마지막 잘라내기 제거 | 상한 |
| 엔진 | 칸 크기를 bbox 면적에서 유도 | 잡점 bbox |
| 엔진 | 동률 처리 제거(마지막 쓰기가 이김) | 동률 처리 |
| 엔진 | 표면 이탈 가드 제거 | 표면 이탈 |
| 엔진 | `'<u2'` → `'>u2'`, 패딩 제거, 인터리브 → 축별 연속 배치 | 골든 바이트 일치 |
| 엔진 | 두 센티널 값 교환 | 센티널 구분, 골든 |
| 엔진 | 새 블록을 히트맵 try에 합침 | 독립 블록 |
| 엔진 | 임계값을 `rework_mm`에서 유도 | 생성(`== 70`) |
| 엔진 | 실패 시 부분 파일을 남김 | 격리, 부분 파일 삭제 |
| 엔진 | `read_points3d`의 `size_mismatch` 검사 제거 | 리더 검증 |
| 대시보드 | `d > T_q`를 `>=`로 | 골든 분류 수, `classifyDev` 경계 |
| 대시보드 | 센티널을 DEPRESSION으로 분류 | 골든 분류 수 |
| 대시보드 | 본문 오프셋에서 `json_len` 누락 | 골든 복원값 |
| 대시보드 | 복원에서 y·z 전치 | 골든 복원값 |
| 대시보드 | 과장을 편차가 아니라 z 전체에 적용 | pick(편차 없는 점 제자리) |
| 대시보드 | Ctrl 없이도 휠 줌 | controls |
| 대시보드 | 휠을 JSX `onWheel`로 옮김 | points3d-view(휠: `{ passive: false }` 등록) |
| 대시보드 | 휠 handler가 `handled`를 보지 않고 항상 `preventDefault` | points3d-view(휠: Ctrl 없는 휠의 `defaultPrevented === false`) |
| 대시보드 | `pxPerUnit`에 CSS 높이를 넘김 | points3d-view(픽셀 단위) |
| 대시보드 | `frameMs`를 입력 이벤트 간격으로 잼 | points3d-view(LOD: 입력 공백만으로는 줄지 않는다) |
| 대시보드 | 조작 종료 뒤의 전체 그리기 제거 | points3d-view(LOD: `c === n`) |
| 대시보드 | 읽기 창의 음수 부호를 ASCII `-`로, 0을 `+0.0`으로 | points3d(`readoutLines`) |
| 대시보드 | 터치 입력에서도 읽기 창 표시 | points3d-view(읽기 창) |
| 대시보드 | 3초 미복구 타이머 제거 | gl-renderer(`on.unrecoverable`) |
| 대시보드 | 분기표의 `support === null` 행 제거(탐지 전에 뷰어 마운트) | points3d(`support: null` + `ready` → `loading`) |
| 대시보드 | `support`·`optedIn`을 `Preview3dTab` 로컬 state로 되돌림 | analysis-result(탭 왕복 뒤 탐지 1회, 선택 유지) |
| 대시보드 | `loadFor`의 `dir` 비교 제거 | points3d(`loadFor`), analysis-result(분석 전환) |
| 대시보드 | 늦게 온 응답을 무조건 반영 | analysis-result(늦은 응답 무시) |
| 대시보드 | `error_webgl` 다시 시도에서 `rendererFailed`를 되돌리지 않음 | preview3d-tab(다시 시도) |
| 대시보드 | 소프트웨어 렌더에서 선택 전에 fetch | preview3d-tab(소프트웨어 렌더), points3d(`shouldRequestLoad`) |
| 대시보드 | fetch 파일명을 리터럴로 고정 | analysis-result(stats가 준 이름) |
| 대시보드 | 선택 배경을 `bg-cs-info-bg` 덧붙이기로 | points3d-view(클래스 단언), §10.6 장면 2 |
| 대시보드 | 마운트 때 fetch | analysis-result(마운트만으로는 받지 않는다) |
| 대시보드 | `stats.applied_criteria.pass_mm`을 읽음 | litmus |
| 대시보드 | `uThresholdQ`를 float uniform으로 | gl-renderer |

새 가드가 기존 격리 테스트의 하중을 빼지 않는지도 확인한다: 새 블록을 넣은 뒤 기존 세 렌더 블록 중 하나의 try를
지우는 변이가 여전히 `test_floor_render_failure_does_not_lose_judged_result`를 죽이는지 본다.

### 10.6 화면 캡처 대조

실제 대시보드 경로(로그인, `/api/data`의 302, 서명 URL)로는 이 대조를 할 수 없다. `points3d.bin`이 있는 분석 행은 새 엔진을
올린 워커가 DB와 저장소에 써야 생기는데, 배포는 사용자 결정이고(§13) 작업 중에는 Supabase·원격 DB에 접속하지 않는다.
`/api/data` 라우트에는 로컬 대체 경로가 없다(`dashboard/app/api/data/[...path]/route.ts:14-27`). 그래서 대조는 **로컬 하네스**에서 한다.

1. **산출물**: `engine/tests/fixtures/synthetic.py`의 `flat_floor`(6×6m) + `add_bump`(10mm 함몰) + `write_binary_ply`로 합성
   스캔을 만들고 `flatness analyze <ply> --units m --criteria floor-kcs-exposed --out <출력 폴더>`로 분석한다. CLI는
   `analyze_floor`를 공유하므로(§4.6) `points3d.bin`·`stats.json`·`preview3d.png`가 로컬에 생긴다. 출력 폴더는 저장소 밖
   (스크래치패드)이다.
2. **하네스**: 저장소 밖(스크래치패드)에 두고 커밋하지 않는다. `dashboard/node_modules`에 이미 있는 vite와
   `@vitejs/plugin-react`, `dashboard/postcss.config.mjs`(Tailwind)로 `AnalysisResult`를 **실제 소스 그대로** 번들해 띄운다.
   props는 1번의 `stats.json`으로 만든 `AnalysisRow`·`ScanRow`와 빈 `photos`다. `/api/data/...` 요청은 하네스 서버가
   1번의 출력 폴더에서 직접 응답한다. Supabase 클라이언트 모듈(`@/lib/supabase/client`)과 Next 전용 모듈(`next/link`,
   `next/navigation`)은 하네스의 alias로 접속 없는 대체물로 바꾼다. `현장 사진` 탭은 열지 않는다. 뷰어 코드
   (`lib/domain/points3d.ts`, `lib/viz/points3d/*`, `points3d-view.tsx`, `preview3d-tab.tsx`, `analysis-result.tsx`)는 대체하지 않는다.
3. **캡처**: 브라우저 패널 또는 CDP 스크립트로 하네스 화면을 캡처해 참고 캡처·아트보드와 나란히 대조한다(Playwright를
   쓰지 않는다. 브라우저 패널과 CDP 스크립트가 이 저장소의 선례다). 참고 캡처(`reference-capture.webp`)는 추적되지 않는
   로컬 파일이므로, 대조 결과로 남기는 것은 캡처 이미지와 장면별 확인 기록이다.
4. **대체 화면**(장면 9)은 하네스의 쿼리 파라미터로 props와 응답을 바꿔 만든다: 점 파일 없음(stats에서 `points3d_paths`·
   `points3d_threshold_q` 제거), 벽면(`flat_wall` 합성 스캔을 벽 기준으로 분석한 출력), 임포트(`engine_version`을
   `external-json-v1`로), fetch 실패(`points3d.bin` 요청에 404). 소프트웨어 렌더는 `--disable-gpu`로 띄운 Chrome(CDP)에서만
   만들 수 있다. 그렇게 띄우지 못하면 그 장면은 캡처하지 못했다고 보고하고 `preview3d-tab.test.tsx`의 `software_prompt` 단언을
   근거로 남긴다.
5. **하네스가 검증하지 않는 것**: 로그인, `/api/data`의 인증과 302, 서명 URL에 대한 교차 출처 바이너리 fetch.
   §13의 4번(배포 직후 확인)과 §14의 2번으로 넘긴다.

| # | 장면 | 확인할 것 |
|---|---|---|
| 1 | 기본(등각, ×1, 검정 배경) | 순수 검정 배경, 둥근 점, 초록 바탕에 함몰부 노랑, 오른쪽 위 범례 4항목, 옅은 격자와 축 숫자, 왼쪽 아래 HUD `축 비율 1:1`, 참고 캡처와 같은 낮은 시점. 로딩 틀도 검정이다(탭 진입 때 흰 틀이 번쩍이지 않는다) |
| 2 | 편차 과장 ×50, ×100 | 함몰부만 아래로 커지고 바닥의 나머지는 제자리. HUD `편차 ×50 과장`. 선택된 배율 버튼의 배경(`cs-info-bg`)이 보인다 |
| 3 | 임계값 2mm, 20mm | 색이 즉시 바뀐다. HUD와 고지 문구의 숫자가 따라 바뀐다 |
| 4 | 평면, 정면 시점 | 평면에서 오른쪽이 +x, 위가 +y. 정면에서 바닥이 얇은 띠 |
| 5 | 밝은 배경 | 흰 배경, 진한 3색, 글자·격자 색 전환. `밝은 배경` 버튼의 선택 배경이 보인다 |
| 6 | 읽기 창 | 점 위에서 좌표·편차·분류, 편차 없는 점에서 `편차 없음` |
| 7 | 탭 왕복 10회 | 네트워크 패널에서 `points3d.bin` 요청이 1회. 콘솔 경고·오류 0 |
| 8 | 휠 | 커서가 캔버스 위에 있어도 일반 휠은 페이지를 스크롤한다. Ctrl+휠은 뷰어만 줌하고 **브라우저 페이지 배율이 변하지 않는다** |
| 9 | 대체 화면 | 점 파일 없음, 벽면 분석, 임포트 분석, fetch 실패, 소프트웨어 렌더(`--disable-gpu`) |
| 10 | 375px 폭 | 뷰어와 컨트롤 줄이 세로로 깨지지 않는다 |
| 11 | 배율 2 화면(`devicePixelRatio = 2` 에뮬레이션) | 점 지름이 배율 1과 같은 CSS 크기다(절반으로 줄지 않는다) |

### 10.7 실행 명령과 기준선

```
파이썬: D:/Projects/Flatness/.superpowers/venv/Scripts/python.exe  (3.14, pytest·lazrs 포함)
엔진:   cd engine && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -q
워커:   cd worker && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -q
성능:   cd engine && PYTHONPATH=D:/Projects/Flatness/engine <py> -m pytest -m perf -q -s
대시보드: cd dashboard && npx vitest run && npx tsc --noEmit && npx next build
```

기준선(2026-10-02, main d40a278): engine 244 통과(1 deselected), worker 209 통과(2 deselected), dashboard 84파일 769건 통과.
완료를 말하기 전에 위 명령을 실제로 돌려 출력을 확인하고, 실패는 실패로 보고한다.

## 11. 성능

**엔진.**

- 게이트는 기존 그대로다: 3천만 점 300초 미만, 피크 RSS 증가 2GiB 미만(`engine/tests/perf/test_memory_spike.py:56-70`).
- 조사 실측(개발 PC, 3천만 점 binary PLY): 3번째 패스 +3.5초, 피크 메모리 +0.002GiB. 기준선 30~45초, 1.31~1.36GiB.
  이 수치는 조사 시제품(밀집 배열 + `np.minimum.at`)으로 잰 값이다. 확정 구현은 희소 state와 정렬을 쓰므로(§4.2)
  시간이 다를 수 있다. 판단 기준은 시제품 수치가 아니라 게이트(300초, 2GiB)다.
- 3번째 패스는 2번째 패스의 정렬 버퍼가 해제된 뒤에 돈다. 상주 메모리는 state(점이 든 표본 칸 수 × 약 50바이트)와
  청크 하나(200만 점 × 48바이트)다.
- 구현 후 `-m perf`로 3천만 점과 300만 점을 다시 잰다. 300만 점을 따로 재는 이유: 점 수가 작으면 정렬 버퍼보다 표본기의
  청크당 임시 배열이 커서 피크 양상이 다르다(조사에서 tap 방식이 300만 점에 +0.117GiB였다).
- 서비스 경로의 입력은 업로드 상한 50MB로 묶인다(`dashboard/lib/upload/validate.ts:35-37`). binary PLY 약 437만 점,
  텍스트 약 220만 점이다. 텍스트 포맷은 패스당 100만 점에 1.9~3.1초가 든다.

**파일.** 50만 점에서 약 4.0MB. artifacts 버킷의 파일당 상한 50MB(`supabase/migrations/005_storage_buckets.sql`)의 1/13이다.
기존 분석 산출물 합(약 0.5MB)의 8배다.

**브라우저.**

- 조사 실측(RTX 2060 SUPER, 150만 점): 프레임 비용 2.8~5.3ms. 50만 점은 그보다 작다.
- 소프트웨어 렌더(SwiftShader): 50만 점 약 96ms/프레임. 그래서 소프트웨어 렌더에서는 PNG를 기본으로 보인다.
- GPU 메모리: 점당 8바이트 그대로 올린다(4MB). `Float32Array` 사본을 만들지 않는다.
- 읽기 창의 CPU 탐색은 프레임당 1회, 점 50만 개 투영이다.
- 번들 증가는 새 의존성 0, 자체 코드 gzip 5~8kB 수준이다(시제품 실측 3.5~5.0kB).

## 12. 문서 갱신 대상

구현과 같은 브랜치에서 함께 고친다. 줄 번호는 2026-10-02 현재 값이다.

| 파일 | 현재 위치 | 갱신 |
|---|---|---|
| `docs/contracts/stats-schema.md` | `:15-22`, `:95-105`, `:204-218`, `:231-234`, `:238-248`, `:507-508` 사이 | §6.3 표대로. 새 절 §9(형식 계약) |
| `docs/scan-guideline.md` | `:605-607` | 렌더 실패 코드 나열에 `points3d_render_failed` |
| `docs/service-report.md` | `:706`(§6.5 표의 "인터랙티브 3D 점군 뷰어" 행) | "미구현"을 구현으로 고친다: 점 표본 산출물 `points3d.bin` + 순수 WebGL2 뷰어(회전·줌, 1:1, 3분류 색). 단면 도구는 범위 밖임을 남긴다 |
| 〃 | `:748`(§6.7 우선순위 표 6행) | "3D 뷰어"를 목록에서 뺀다 |
| 〃 | `:482` 앞(§4.5 다음) | 새 소절 "3D 점군 1:1 뷰어": 표본 방식(cell min-hash stratified), 색 기준(5cm 서브셀 잔차), 판정 무관성, 방침 예외 사유(뷰어 영역 한정 어두운 배경, 그림 색, 임계값 슬라이더와 옛 노트북 슬라이더의 차이, 원 설계의 Three.js 대신 순수 WebGL2로 직접 구현한 이유). 합니다체로 쓰고, 프로젝트 문서 표현 규칙(금지 표현 불사용, 알고리즘·라이브러리 이름은 영어 그대로)을 지킨다 |
| 〃 | `:122-123`(§2.1 시각자료 행) | 화면 연계 행에 3D 점군 뷰어를 추가 |
| `dashboard/README.md`(영어) | `:105` | "Interactive 3D viewer (the engine does not yet output `viewer.bin`)" 줄을 지운다. `:75-76`의 결과 화면 설명에 3D 탭의 1:1 point cloud viewer를 한 문장 추가 |
| `README.md`(영어) | `:62-70`(Tasks 1 and 4 절) | 결과 화면에 interactive 1:1 point cloud viewer(pure WebGL2)가 있다는 한 문장 추가. 그림 표는 그대로 |
| `docs/superpowers/specs/2026-09-04-dashboard-cloudscape-redesign-design.md` | 문서 끝(`:159` 다음), `:7-8`, `:19` | 새 절 "예외 기록(2026-10-02, 3D 점군 뷰어)"에 §9의 5건. `:7-8`에 "2026-10-02 추가 1장: `ScanDone3D.dc.html`(캔버스 밖에서 저장소에 추가)"을 덧붙이고, `:19`에는 새 절을 가리키는 주석을 단다. `:4`와 `:6`의 숫자 14(claude.ai 캔버스에 대한 사실)는 그대로 둔다 |
| `docs/design/cloudscape/ScanDone3D.dc.html` | 신설 | `ScanDone.dc.html`과 같은 화면에서 `3D 프리뷰` 탭 활성. 뷰어 영역(검정, 범례, HUD, 조작 안내), 컨트롤 줄, 고지 문구 |
| `dashboard/components/analysis/analysis-result.tsx` | `:76-94` | 3D 탭 본문 교체. 옛 캡션(`:85-87`)과 빈 상태 문구(`:90-92`) 삭제 |
| `dashboard/components/analysis/deviation-view.tsx` | `:17-20` 주석 | "3D 프리뷰 탭과 동일한 분기 선례"는 지금까지 사실이 아니었다(3D 탭에 임포트 분기가 없었다). 이번에 3D 탭에도 임포트 분기가 생기므로 주석을 `preview3d-tab.tsx`를 가리키도록 고친다 |
| `dashboard/lib/domain/labels.ts`, `types.ts`, `worker/flatworker/report/labels.py`, 테스트 2곳 | §6.3 | §6.3 표대로 |

**고치지 않는 것**(이력 문서이거나 적용된 마이그레이션):

- `supabase/migrations/001_schema.sql:139-148`의 고정 파일명 주석. 적용된 마이그레이션은 건드리지 않는다.
- `docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md`의 `viewer.bin`·Three.js 서술. 당시 설계의 기록이며 이 문서가 대체한다.
- `docs/audit/2026-09-05-*.md`. 감사 시점의 기록이다. 벽면 3D 프리뷰 쟁점은 이번 범위에서 바뀌지 않는다.
- `docs/DEPLOY.md:329·482`, `docs/SUPABASE_SETUP.md:541`의 `engine_version=p4-0.5.0`. 버전을 올리지 않으므로 그대로다.
- `docs/DEPLOY.md`의 배포 후 스모크 목록(`:398` 부근). 확정된 문서 갱신 목록(계약, service-report, README 2종,
  scan-guideline, 리디자인 스펙·아트보드)에 없으므로 범위를 넓히지 않는다. 배포 직후의 `points3d.bin` fetch 확인은
  이 문서 §13의 4번에 적혀 있다.
- `worker/README.md`. 보고서 자산 설명에 변화가 없다.

## 13. 배포 순서

1. DB 마이그레이션 없음. 새 컬럼·잡 타입·버킷이 없다.
2. 엔진과 워커는 한 이미지다(`Dockerfile:12-15`). **워커(엔진)를 먼저** 내보낸다.
   - 옛 대시보드는 새 stats 키를 무시한다. 새 경고 코드는 라벨이 없어 원문으로 보일 뿐이다(`labels.ts:76`).
3. **대시보드를 그 다음** 내보낸다.
   - 대시보드를 먼저 내면 "재분석하면 생성됩니다" 안내(M3)가 아직 사실이 아니게 된다.
4. 배포 직후 확인: 새 분석 하나에서 3D 프리뷰 탭이 뜨는지, `points3d.bin` fetch가 운영 Supabase의 서명 URL로 성공하는지
   (교차 출처 바이너리 fetch는 로컬에서 실측할 수 없다).
5. 옛 분석은 점 파일이 없다. 재분석하면 새 분석 행에 생긴다. 소급 작업은 하지 않는다.

이번 작업은 구현과 검증까지다. 머지와 배포는 사용자가 결정한다. 작업 브랜치는 `feat/pointcloud-viewer`이고 저장소 본
체크아웃에서 작업한다.

**작업 중 금지**: `.env` 값 읽기·출력, Supabase·원격 DB 접속, 로컬 5432 PostgreSQL 접촉, `과업지시서_통합본.pdf` 커밋,
`data/` 커밋, 저장소 객체 삭제 코드 추가.

**작업 규칙**: 사용자 대면 문자열에 U+2014를 쓰지 않는다. 코드 주석은 한국어로 쓴다. 한 작업 트리에 커밋하는 에이전트는
한 번에 하나다.

## 14. 미실측·위험

| # | 내용 | 대응 |
|---|---|---|
| 1 | **내장 그래픽 노트북 성능 미실측.** 측정 장비에 내장 GPU가 없었다. 실측 범위는 외장 GPU 수 ms와 소프트웨어 렌더 약 96ms 사이다 | 드래그 중 LOD, 소프트웨어 렌더 시 PNG 기본. LOD 상수는 `budget.ts`의 이름 붙은 값이라 실기 측정 뒤 바꿀 수 있다 |
| 2 | **운영 Supabase에서의 `points3d.bin` fetch 미실측.** 302 서명 URL 뒤 교차 출처 ArrayBuffer fetch는 기존 JSON fetch와 같은 CORS 요구지만 실제 응답으로 확인하지 못했다 | 배포 직후 확인(§13의 4). 실패하면 화면은 `error_fetch`로 PNG와 사유를 보인다. 화면 캡처 대조(§10.6)는 로컬 하네스에서 하므로 로그인·`/api/data` 302·서명 URL 경로를 지나지 않는다 |
| 3 | **업로드는 격리 밖이다.** `points3d.bin`(약 4MB)은 기존 산출물 합의 8배이고 업로드에 전송 재시도가 없다. 전송 오류 한 번이면 무거운 분석이 총 3회 다시 돈 뒤 실패한다 | 워커를 고치지 않는다는 결정에 따라 이번 범위 밖. 엔진이 크기를 상수 상한으로 묶고 부분 파일을 지우는 것이 방어선이다 |
| 4 | **저장·전송 누적.** 삭제 코드가 없어 재분석마다 4MB가 쌓인다(Free 총량 1GB). 서명 URL이 매번 달라 HTTP 캐시가 맞지 않으므로 페이지를 새로 열 때마다 4MB가 나간다(Free 월 전송 5GB면 약 1,250회 열람) | 탭 첫 진입 지연 로드와 state 보관으로 한 페이지 안의 반복 전송을 막는다. 삭제와 영구 캐시는 범위 밖 |
| 5 | **합성 데이터로만 잰 수치.** 얼룩·분류 비율·임계값 관련 수치는 전부 합성 점군 기준이다. 실제 스캔의 노이즈는 공간 상관이 있다 | 기본 임계값은 적용 기준 허용치로 고정돼 있고 슬라이더로 조정할 수 있다. 고지 문구가 참고용임을 밝힌다 |
| 6 | **정합 병합 스캔.** 입력이 5cm 격자 대표점(칸당 1점)이라 분석 격자에서 3점 미만 서브셀이 대부분이 되고, 조사 재현에서는 `analyze_floor` 자체가 실패했다 | 분석이 성공하면 점 파일이 생기고 화면에 병합 안내 한 줄이 붙는다. 분석이 실패하면 결과 화면 자체가 없다. 병합 스캔 분석 실패는 이 기능과 별개의 기존 결함 후보다 |
| 7 | **저밀도 스캔.** 3점 미만 서브셀의 점은 편차가 없어 회색으로 나온다. 점은 보이는데 색이 없는 영역이 넓을 수 있다 | 범례의 `편차 없음` 항목 |
| 8 | **LAZ와 텍스트 입력의 3번째 패스 비용.** LAZ는 미측정, 텍스트는 100만 점당 1.9~3.1초다 | 서비스 입력은 50MB로 묶인다. CLI 대용량 텍스트는 그만큼 느려진다 |
| 9 | **배포 이미지(python:3.11-slim)와 목표 사양에서의 미측정.** 성능 수치는 개발용 Windows PC 값이다 | `-m perf` 재측정은 개발 PC에서 한다. 운영 환경 실측은 배포 뒤에만 가능하다 |
| 10 | **gl-renderer는 CI가 픽셀을 검증하지 못한다.** jsdom에 WebGL이 없다. 소프트웨어 렌더 장면은 `--disable-gpu`로 띄운 Chrome이 있어야 캡처할 수 있다 | gl 호출 기록 스텁 + 화면 캡처 대조(§10.6). 캡처하지 못한 장면은 못 했다고 보고한다 |
| 11 | **z 범위가 큰 스캔의 z 분해능.** 천장·반사 이상점으로 z 범위가 100m면 z 스텝이 1.5mm다 | 1:1 표시에는 영향이 없다. 과장은 z 좌표가 아니라 0.1mm 편차 채널로 하므로 계단이 생기지 않는다 |
| 12 | **터치 기기.** `touch-action: none`이라 손가락이 캔버스 위에 있으면 페이지가 스크롤되지 않는다. 터치 제스처는 실기기로 확인하지 못했다 | 모바일 전용 설계는 범위 밖(리디자인 스펙과 같다) |
| 13 | **색 의미의 공존.** 뷰어의 초록은 FLAT, 히트맵의 초록은 적합, 편차맵의 초록은 침하다 | 사용자가 참고 캡처의 색을 지정했다. 범례가 뷰어 안에 항상 있고 고지 문구가 판정과 다름을 밝힌다 |
| 14 | **자체 코드 유지 부담.** 행렬·카메라·GLSL·제스처 약 500~600줄 이상을 저장소가 소유한다 | 순수 함수로 나눠 단위 테스트를 건다. WebGL 접점은 한 파일이다 |

## 부록 A. `decisions.md` 대조표

| `decisions.md` | 이 문서 |
|---|---|
| §1 무엇을 만드는가 | §1 |
| §2 사용자 확정 1~15 | §2.1(D1~D15) |
| §3.1 표본 추출 | §4.1, §4.2 |
| §3.2 점별 편차 | §4.3, §10.1 |
| §3.3 산출물 | §5 |
| §3.4 파이프라인 삽입과 계약 | §4.4, §4.5, §4.6, §6 |
| §3.5 성능 | §11 |
| §4.1 기술 | §7.1, §7.2, §7.3 |
| §4.2 렌더 규칙 | §7.4~§7.9 |
| §4.3 화면 구성 | §7.10, §7.12 |
| §4.4 상태 분기 | §7.11 |
| §4.5 판정 이중화 금지와의 관계 | §8 |
| §4.6 디자인 스펙 예외 | §9 |
| §5 테스트·검증 | §10, §14 |
| §6 문서 | §12 |
| §7 배포 | §13 |
| §8 작업 환경 | §10.7, §13 |

## 부록 B. `decisions.md`와 코드를 대조하며 정리한 지점

결정을 바꾼 것은 없다. 코드와 맞추면서 한 가지로 읽히게 정리한 곳이다.

1. **`NO_DEVIATION`의 "3점 미만".** `decisions.md` §3.2는 `NO_DEVIATION`의 예로 "bimodal, 3점 미만"을 든다. 현재 코드에서
   3점 미만 서브셀은 `median_z`가 NaN이라 어떤 구역에도 들어가지 못하고 항상 라벨 0이다(`subcell.py:50-51`,
   `zones.py:37,53,70`). 같은 절의 `NOT_FLOOR` 정의("구역 없음(라벨 0)")가 먼저 맞으므로 `NOT_FLOOR`로 기록된다.
   규칙은 §4.3의 순서로 고정했다.
2. **출력 순서의 "해시 값".** §3.1의 "승자의 해시 값 오름차순"을 벌점 비트를 뺀 `hash63` 기준으로 정했다. 벌점 비트까지
   넣어 정렬하면 앞쪽 일부가 바닥 점만 되고 상한에서 바닥 아닌 점만 잘려, 같은 절이 말하는 "잘라도 균일 표본"이 성립하지 않는다.
3. **고지 문구의 "스팬은 동적".** §4.3은 "스팬·임계값은 동적"이라고 적었지만 확정 문구에는 스팬 숫자가 들어갈 자리가 없다.
   문구를 그대로 쓰고 동적 값은 임계값 하나로 정했다(§7.12).
4. **벽면 문구.** §4.4의 "기존 문구 유지 취지"에 따라, 벽면 분석에는 PNG 프리뷰와 점군 뷰가 둘 다 없다는 사실을 한 문장(M1)으로 적었다.
   기존 문구는 "(벽면 분석은 3D 프리뷰를 생성하지 않습니다)"였다(`analysis-result.tsx:91`).
5. **밀집 배열 금지.** 조사 시제품(`design-inputs/issue1/sampler_proto.py`)은 `NX × NY` 길이의 밀집 배열을 썼다. 그 구조는
   칸 크기를 bbox 면적에서 유도할 때만 상한이 보장된다. 점유 면적에서 유도하는 확정 방식에서는 잡점으로 배열이 폭증하므로
   희소 state로 정했다(§4.2).
6. **분석 전환.** `AnalysisResult`에 `key`가 없어 다른 분석으로 바꿔도 state가 남는다(`page.tsx:472`). 점 데이터 캐시를
   `artifacts_dir`로 키 잡는 규칙(`loadFor`)과 `<Preview3dTab key={analysis.id}>`를 더했다(§7.3).
7. **개수 단언 주변 문구.** 12 → 13 두 곳 외에 `test_summary.py:72`의 주석과 `:82`의 독스트링, `stats-schema.md:231-234`의
   코드 나열도 함께 고쳐야 문서가 사실과 맞는다(§6.3).
8. **구배의 안내 문구.** `decisions.md` 2절 2항은 "벽면·구배·임포트 분석은 ... 화면에 안내 문구를 둔다"고 적었지만 같은 문서 4.4의 상태 분기 표에는
   구배 행이 없다. 구배 결과는 `SlopeResult`로 따로 그려지고(`page.tsx:464-472`) 그 화면에는 `TabBar`와 `3D 프리뷰` 탭이 없어
   문구를 둘 자리가 없다. 안내 문구 대상에서 구배를 빼고 구배 화면을 고치지 않는 것으로 정했다(이 문서 §7.11).
9. **탭 왕복 뒤에 남는 상태.** `decisions.md` 4.1은 "받은 ArrayBuffer를 상위 state에 보관"만 적었다. 탭 본문이 조건부 렌더라 탭을 벗어나면
   언마운트되므로(`analysis-result.tsx:76`), 소프트웨어 렌더의 "3D로 보기" 선택(`decisions.md` 4.4)과 WebGL2 탐지 결과도 같은 곳에 두지
   않으면 탭에 돌아올 때마다 다시 탐지하고 다시 눌러야 한다. 두 값도 `AnalysisResult` state에 두는 것으로 정했다(이 문서 §7.3).
10. **표시 임계값이 없는 경우.** `decisions.md` 4.4의 표에 없는 상황이다(점 파일은 있는데 `points3d_threshold_q`가 없음. 엔진은 두 키를 함께
    쓰므로 정상 경로에서는 생기지 않는다). 조용히 넘기지 않고 Alert로 드러내되, 다시 시도로 고칠 수 없으므로 `다시 시도`
    버튼을 두지 않는 별도 모드 `error_stats`로 정했다(이 문서 §7.11의 4행). 파일 형식 불일치(`error_format`)는 `decisions.md` 4.4대로 다시 시도가 있다.
11. **로딩 틀과 Spinner.** `decisions.md` 4.4의 "뷰어 틀 안에 Spinner"와 2절 3항(뷰어 영역 배경 순수 검정)을 함께 지키도록, 로딩 틀을 검정으로
    두고 공용 `Spinner`는 고치지 않은 채 작은 흰 칩 안에 넣었다. `Spinner`의 회전 호(`cs-text`, `#000716`)가 검정 위에서
    보이지 않기 때문이다(이 문서 §7.11).
12. **휠 리스너.** `decisions.md` 2절 7항(Ctrl+휠 확대, 일반 휠은 페이지 스크롤)은 Ctrl+휠에서 `preventDefault`가 실제로 먹어야 성립한다.
    React 19가 `wheel`을 passive로 등록하므로 네이티브 `{ passive: false }` 리스너로 붙이는 제약을 이 문서 §7.7에 적었다.
13. **파일명의 출처.** `decisions.md` 3.4의 "다른 `*_paths` 키와 같은 규약"에 따라 브라우저는 stats가 준 이름으로 받는다. TS에 파일명 상수를
    두지 않고, 엔진도 `outputs/points3d.py`의 `FILE_NAME` 한 곳만 리터럴을 갖는다(이 문서 §4.4, §7.3).

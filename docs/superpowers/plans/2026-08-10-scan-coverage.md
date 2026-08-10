# 세부과업 3 스캔 커버리지 계획·시뮬레이션 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도면 기하에서 모바일·TLS 두 모드의 스캔 커버리지 계획을 세우고, 시간 스텝 시뮬레이션으로 커버리지가 차오르는 과정을 시각화하며, Gazebo로 운동학을 대조검증한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-08-10-robot-scan-coverage-design.md` §2. 공통 점유격자 위에 두 플래너, 그 위에 시뮬레이터·렌더러·보고서. 입력은 세부과업 2 덤프(`bim/tests/fixtures/lh26_dump.json`).

**Tech Stack:** Python (numpy·matplotlib·Pillow), pytest, 기존 `PlaywrightRenderer`(PDF), micromamba + conda-forge(Gazebo, 루트 불필요)

## Global Constraints

- 산출물 형식 CSV·JSON·PNG·PDF는 구속력이 있다 (스펙 §1.1)
- 격자 셀 50mm · 좌표는 도면 로컬 mm 정수 · 시간 스텝 0.2s (스펙 §2·§6)
- 밀도 목표 기본값: 모바일 ≤20mm, TLS ≤5mm — **설정 데이터로, 코드 상수 금지** (스펙 §3)
- 장비 파라미터 기본값은 "모델 파라미터(가정)"로 표기한다. 장비 공표치처럼 쓰지 마라 (스펙 §9-1)
- 커버 누적은 셀별 **최소 점 간격**을 취한다 (스펙 §3)
- 미상/미커버를 통과로 접지 않는다 — 세부과업 2와 같은 원칙
- 모든 모듈 파일은 `scansim/` 아래, 테스트는 `scansim/tests/` (스펙 §10)
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## 파일 구조

```
scansim/
  __init__.py
  config.py          # ScanConfig 데이터클래스 + 기본값(가정 표기) + JSON 로드
  grid.py            # OccupancyGrid: 링 래스터화·팽창·레이캐스트·A*
  furniture.py       # 도면 8쪽 가구 장애물 추출
  coverage.py        # CoverageGrid: 가시성 스윕 + 점 간격 모델 + 등급 집계
  planner_mobile.py  # boustrophedon + 보완 경유점
  planner_tls.py     # 탐욕 set cover + NN/2-opt 순회
  simulate.py        # 시간 스텝 주행 + 상태 스트림 + CSV/JSON
  render.py          # 프레임 PNG·GIF·커버리지 곡선·최종 지도
  report/build.py    # 평가 PDF (bim/report 패턴 재사용)
  gazebo/export_sdf.py, gazebo/validate.py
  tests/             # 해석 대조·불변식·전체 파이프라인 + fixtures/
```

---

### Task 1: 점유격자 + A*

**Files:** Create `scansim/__init__.py`, `scansim/config.py`, `scansim/grid.py`, Test `scansim/tests/test_grid.py`

**Interfaces (Produces):**
```python
@dataclass
class ScanConfig:            # config.py — 전 필드 kwargs 로 덮어쓰기 가능, from_json(path) 제공
    cell_mm: float = 50.0
    robot_radius_mm: float = 250.0        # 가정값
    mobile_fov_deg: float = 90.0
    mobile_range_mm: float = 4000.0       # 가정값
    mobile_speed_mms: float = 300.0       # 가정값
    mobile_scan_hz: float = 10.0          # 가정값
    mobile_angres_deg: float = 0.5        # 가정값
    tls_range_mm: float = 10000.0         # 가정값
    tls_angres_deg: float = 0.035         # 가정값
    tls_dwell_s: float = 120.0            # 가정값
    step_s: float = 0.2
    density_targets_mm: dict = field(default_factory=lambda: {"mobile": 20.0, "tls": 5.0})

class OccupancyGrid:         # grid.py
    @classmethod
    def from_rings(cls, free_rings, obstacle_rings, cell_mm) -> "OccupancyGrid"
        # free_rings: 실 outline 들(구멍 포함 링 배열). obstacle_rings: 가구.
        # 셀 중심이 free 폴리곤 안 & obstacle 밖이면 free.
    def inflate(self, radius_mm) -> "OccupancyGrid"     # 장애물·벽을 반경만큼 팽창
    def raycast(self, x0, y0, x1, y1) -> bool            # 시선이 막히면 False (Bresenham)
    def astar(self, start_xy, goal_xy) -> list[tuple[float,float]] | None   # mm 좌표 경유점, 8방향+대각보정
    free_ratio: float; shape: (ny, nx); cell_mm; origin_xy
    def world_to_cell(self, x, y) -> (ix, iy); cell_to_world(...)
```

- [ ] **Step 1 실패 테스트**: (a) 10m×7m 빈 방 free_ratio≈1, 중앙 2×1m 장애물이면 그만큼 감소(±2셀 오차) (b) `raycast` 장애물 관통 False, 옆으로 True (c) `astar` 빈 방 대각 최단거리 = 유클리드±5% / 장애물 우회 시 그 이상 / 목표가 장애물 안이면 None (d) `inflate(250)` 후 장애물 인접 250mm 내 셀이 점유 (e) 좌표 왕복 `cell_to_world(world_to_cell(p))` 오차 ≤ cell/2
- [ ] **Step 2** 실행해 실패 확인 (`pytest scansim/tests/test_grid.py -q`)
- [ ] **Step 3** 구현 — numpy bool 배열, 팽창은 `scipy.ndimage.binary_dilation`(scipy 이미 의존) 또는 순수 numpy
- [ ] **Step 4** 통과 확인 → **Step 5** 커밋 `feat(scansim): 점유격자 + A*`

### Task 2: 가구 장애물 추출 (도면 8쪽)

**Files:** Create `scansim/furniture.py`, Test `scansim/tests/test_furniture.py`, Fixture `scansim/tests/fixtures/furniture_lh26.json` (추출 결과 스냅샷)

**Interfaces:** `extract_furniture(pdf_path, page_index=7, sheet: PlanSheet) -> list[dict]` — 각 dict `{name, rings, source}`. `bim.extract_plan.PlanSheet` 재사용(같은 원점·축척 확정 방법). 방법: 실 폴리곤 내부의 ドローイング 선분을 폭·색으로 걸러 연결 성분 클러스터 → 볼록 껍질/바운딩 폴리곤. 텍스트 라벨(침대·TV·소파 등)이 가까우면 name 부여.

**정답 부재를 정직하게**: 도면에 가구 면적표가 없다(스펙 §9-2). 검증은 (a) 개수·위치의 시각 대조 PNG 생성 (b) **모든 가구가 실 폴리곤 내부에 있다** (c) 가구끼리 실 경계를 넘지 않는다 (d) 스냅샷 고정(추출이 조용히 바뀌면 FAIL). 추출 실패 가구는 지어내지 말고 누락 목록으로 보고.

- [ ] Step 1 실패 테스트 (내부성·스냅샷·최소 3개 이상 추출) → Step 2 실패 확인 → Step 3 구현 + 시각 대조 PNG → Step 4 통과 → Step 5 커밋

### Task 3: 커버리지 격자 + 점 밀도 모델

**Files:** Create `scansim/coverage.py`, Test `scansim/tests/test_coverage.py`

**Interfaces:**
```python
class CoverageGrid:
    def __init__(self, occ: OccupancyGrid, cfg: ScanConfig)
    def observe_fan(self, x, y, heading_deg, cfg)   # 모바일: 부채꼴, 레이캐스트 차폐, spacing=max(r·Δθ, v/f)
    def observe_station(self, x, y, cfg)             # TLS: 전방위, spacing=r·Δθ/cos(입사각), 입사각=atan(r/센서높이)…
                                                     #   → 바닥 스캔이므로 입사각은 거리↑=얕아짐. cos 하한 0.05 클램프
    spacing_mm: np.ndarray (inf=미관측)
    def coverage_pct(self, target_mm) -> float       # 자유 셀 중 spacing<=target 비율
    def uncovered_cells(self, target_mm) -> list[(ix,iy)]
```

**해석 대조(스펙 §7-1)**: 빈 방 TLS 1거치점 — 사거리 원∩방 면적과 관측 면적 오차 ≤2% / spacing 은 거리에 단조 증가 / 같은 셀 재관측 시 최소값 유지 / 장애물 추가 시 관측 면적이 절대 늘지 않는다.

- [ ] Step 1 실패 테스트 → Step 2 → Step 3 구현 → Step 4 통과 → Step 5 커밋

### Task 4: 모바일 플래너

**Files:** Create `scansim/planner_mobile.py`, Test `scansim/tests/test_planner_mobile.py`

**Interfaces:** `plan_mobile(occ, cfg) -> MobilePlan{waypoints_mm, path_len_mm, est_time_s, notes}` — 팽창 자유공간에서 스윕 간격 = 유효 스윕폭(부채꼴 근거리 폭 기반, 식과 근거 주석 필수)의 왕복 경로 + A* 연결 + 시뮬레이션 후 잔여 미커버에 보완 경유점(탐욕, 최대 N회 반복, 수렴 못 하면 잔여를 정직하게 보고).

**테스트**: 빈 방 직선 1패스 스윕 면적 해석 대조 / 경로가 팽창 점유 셀을 지나지 않음 / path_len ≥ 직선거리 / 26형 픽스처에서 모바일 목표(20mm) 커버리지 ≥90% 또는 잔여 사유 보고(단언은 "≥90% 또는 notes 에 잔여 목록" — 실패를 숨기는 쪽이 아니라 드러내는 쪽으로).

- [ ] Step 1~5 (동일 사이클)

### Task 5: TLS 플래너

**Files:** Create `scansim/planner_tls.py`, Test `scansim/tests/test_planner_tls.py`

**Interfaces:** `plan_tls(occ, cfg, max_stations=12) -> TlsPlan{stations_mm, tour_order, tour_paths, travel_len_mm, est_time_s, tradeoff: list[(n_stations, coverage_pct)], notes}` — 후보=자유 셀 서브샘플(간격 0.5m), 탐욕 set cover(목표 5mm 미달 셀 최다 커버 후보 반복 선택), NN+2-opt 순회, 구간 A*.

**테스트**: 빈 정사각형 방(사거리≥대각) 1거치점으로 100% → 탐욕이 1개 선택 / 거치점 추가 시 커버리지 단조 증가(tradeoff 곡선 비감소) / 순회 경로 장애물 회피 / 2-opt 후 길이 ≤ NN 길이 / L자 방(가려짐)에서 2개 이상 선택.

- [ ] Step 1~5

### Task 6: 시뮬레이터 + 상태 스트림

**Files:** Create `scansim/simulate.py`, Test `scansim/tests/test_simulate.py`

**Interfaces:** `simulate(occ, plan, cfg, mode) -> SimResult{frames: list[SimState], curve: list[(t_s, {tier: pct})], total_dist_mm, total_time_s}` — SimState{t_s, x, y, heading_deg, dist_mm, moving: bool, coverage: dict}. 경유점 사이 등속 전진(속도 cfg), TLS 거치점 도착 시 dwell 동안 정지+observe_station. `to_csv(path)`, `to_json(path)` (상태 스트림 = 지시서 "로봇 위치·이동 상태·작업 수행 정보").

**불변식 테스트(변이 대상)**: 커버리지 곡선 단조 증가 / total_dist = 경유점 폴리라인 길이 ±1% / 시간 = 거리/속도 + 거치 dwell 합 ±1% / CSV 행수 = 프레임 수.

- [ ] Step 1~5

### Task 7: 렌더러 (프레임·GIF·곡선·지도)

**Files:** Create `scansim/render.py`, Test `scansim/tests/test_render.py`

**Interfaces:** `render_frames(occ, sim, out_dir, every_n=5) -> list[Path]` · `render_gif(frames, out_path, fps=10)` (Pillow) · `render_curve(sim, out_path)` · `render_final_map(occ, cov, out_path)` — 축 한계는 데이터에서 잡는다(bim/report/assets.py 의 MemoryError 교훈 주석 인용). 색: 미커버=빨강 계열, 등급별 커버=초록 농도, 장애물=회색, 로봇=진회색 + 시야 부채꼴.

**테스트**: 프레임 수 = ceil(len/every_n) / GIF 파일 생성·프레임 수 일치(Pillow 로 재열기) / PNG 크기 상한(각 ≤2MB) / 곡선 마지막 값 = sim 최종 커버리지.

- [ ] Step 1~5

### Task 8: CLI + 평가 PDF

**Files:** Create `scansim/report/build.py`, `scansim/report/templates/scan_report.html.j2`, `scansim/cli.py`, Test `scansim/tests/test_report.py`

**Interfaces:** `python -m scansim.cli --dump bim/tests/fixtures/lh26_dump.json --mode both --out <dir>` → 산출물 전 형식(CSV·JSON·PNG·GIF·PDF). PDF 는 bim/report 패턴(FakeRenderer 주입 테스트) 재사용. 구성: ①표지·조건 ②모드별 계획(경로/거치점 지도) ③커버리지 곡선·트레이드오프 ④운행 거리·시간 표 ⑤한계(스펙 §9 — 특히 파라미터 가정, 가구 유/무 2시나리오 결과 병기).

**테스트**: FakeRenderer 로 build 전체 / HTML 에 두 모드·트레이드오프·한계 존재 / 산출 파일 전 형식 존재 / 가구 유/무 2시나리오 수치가 서로 다르고 둘 다 실림.

- [ ] Step 1~5

### Task 9: Gazebo 대조검증

**Files:** Create `scansim/gazebo/export_sdf.py`, `scansim/gazebo/validate.py`, `scansim/gazebo/README.md`, Test `scansim/tests/test_export_sdf.py`

**설치 (sudo 불필요 경로)**: WSL 에 micromamba 사용자 설치 → `micromamba create -n gz -c conda-forge gz-sim` (Gazebo Harmonic 계열). 실패 시 2안: 사용자에게 `sudo apt install ...` 요청을 **명시적으로 보고하고 중단** (임의로 다른 우회를 하지 않는다).

**Interfaces:** `export_sdf(dump, furniture, out_path)` — 실 경계·가구를 벽/박스 모델로, 차동구동 로봇(원통, 반경 cfg) 포함. `validate.py` — gz sim 헤드리스 실행, gz transport 로 cmd_vel 발행/odom 구독하며 경유점 추종, 완주 후 `{gz_dist_mm, gz_time_s, own_dist_mm, own_time_s, dist_err_pct, time_err_pct}` JSON. **±5% 초과면 실패로 보고하고 허용치를 늘리지 않는다** (스펙 §7-3).

**테스트(설치 무관 부분)**: SDF 가 유효 XML / 모델 수 = 실+가구 수 / 좌표가 mm→m 변환됨. 실행 검증은 설치 성공 시에만 (skipif).

- [ ] Step 1~5

### Task 10: 변이 실험 + 문서

**Files:** Create `scansim/tests/mutation_check.py`(스크립트), Modify `docs/service-report.md`(11장), `docs/scan-guideline.md`(부록)

- [ ] 변이 최소 10종 설계·실행 — 불변식 각각 + "미커버를 커버로 접기" + "레이캐스트 무시" + "최소 대신 최대 spacing". **무변이 대조군 필수.** SURVIVED 0 이 될 때까지 테스트 보강
- [ ] `service-report.md` 11장: 이행 매핑·검증 결과(해석 대조·변이·Gazebo 오차)·한계. 표지·작성원칙 갱신 (10장 때 관례)
- [ ] 전체 스위트(엔진·워커·bim·scansim) 통과 확인 후 커밋

## Self-Review

- 스펙 §2~§7 전 항목이 Task 1~10 에 매핑됨 확인 (§4→T4, §5→T5, §6→T6·7, §7-1→T3·4·5, §7-2→T6·10, §7-3→T9)
- 타입 일관성: OccupancyGrid/ScanConfig 시그니처가 T3~T9 에서 동일 사용
- 플레이스홀더 없음. 단, T2 가구 추출은 탐색적 성격이라 "방법" 서술이 구현 재량을 남긴다 — 검증 조건(내부성·스냅샷·시각 대조)으로 묶었다

# Gazebo 대조검증 (세부과업 3 · Task 9, 스펙 §7-3)

세대 기하를 SDF world 로 변환해 차동구동 로봇이 자체 시뮬레이터와 같은
경유점을 주행하게 하고, **운행 거리·소요시간을 ±5% 허용 오차로 대조**한다.
대조가 실패하면 실패로 보고한다 — 허용 오차를 늘리지 않는다.

## 설치 경위 (sudo 불가 → micromamba)

WSL Ubuntu 24.04 에 루트 권한이 없어 `sudo apt install` 경로 대신
micromamba 사용자 설치를 썼다 (계획 Task 9 의 1안):

```bash
# micromamba 는 ~/.local/bin/micromamba, 프리픽스는 ~/micromamba
export MAMBA_ROOT_PREFIX=~/micromamba
micromamba create -n gz -c conda-forge gz-sim
```

**실제 설치 버전: Gazebo Sim 10.5.0 (Ionic 계열), gz-transport 15,
gz-physics 9.** 스펙 §7 에는 "Gazebo Harmonic" 이라 적혀 있으나
conda-forge 가 주는 최신은 10.5 다 — 대조 대상은 운동학(거리·시간)이라
버전 차이가 판정에 영향을 주지 않는다. 문서·결과에는 실제 버전을 적는다.

주의 두 가지:

- **gz-transport 15 에는 Python 바인딩이 없다** (`import gz.transport15`
  불가). 통신은 전부 `gz topic` CLI 다. 발행(`gz topic -p`)은 프로세스
  1회당 **약 1s** 걸린다(노드 생성 + 디스커버리) — validate 의 제어 주기가
  ~1s 인 이유이고, 아래 "지연 보상" 설계의 근거다.
- **물리 엔진은 dartsim(DART)이다.** gz-physics 에 ODE 백엔드가 없어
  (클래식 Gazebo 의 ODE 는 이식되지 않았다) SDF `<physics type>` 속성은
  무시되고 기본 dartsim 이 로드된다. 스텝 1ms.

## 구성

| 파일 | 역할 |
|---|---|
| `export_sdf.py` | 덤프 spaces + 가구 → SDF world (벽 체인·차동구동 로봇) |
| `validate.py` | gz sim 헤드리스 기동 → odom 폴링 + cmd_vel P 제어 → 결과 JSON |
| `../tests/test_export_sdf.py` | XML 유효성·모델 수·mm→m·플러그인 (+ WSL 있으면 로드 실행) |
| `../tests/fixtures/gazebo_validation_result.json` | 실제 실행 결과 (아래) |

### export_sdf

- 실 outline·가구 ring 의 각 변 → 정적 얇은 box 벽(두께 50mm·높이 0.5m).
  모델 수 = outline 있는 실 수 + 가구 수 + 로봇 1 + 바닥 평면 1.
- 좌표 mm→m. 로봇: 섀시 원통 반경 = `ScanConfig.robot_radius_mm`(기본
  250mm), 구동륜 2 + 캐스터 구 2, `gz-sim-diff-drive-system`
  (`/model/scanbot/cmd_vel`) + `gz-sim-odometry-publisher-system`
  (`/model/scanbot/odom`, 50Hz, 실제 포즈 기반 — 바퀴 적분 오돔은
  `wheel_odom` 으로 치워 둔다).
- **한계: 실 간 개구부(문)가 벽으로 닫힌다.** 벽을 outline 변 그대로
  세우기 때문이다. 따라서 대조 주행 경로는 한 실 안에 있어야 한다.

### validate

```bash
# WSL 안에서 (micromamba env 활성화 상태로)
micromamba run -n gz python3 -m scansim.gazebo.validate \
    --waypoints wp.json --world world.sdf --out result.json
```

- world 는 로봇이 `waypoints[0]` 에 스폰되도록 `export_sdf(...,
  robot_xy_mm=wp0, robot_yaw_deg=…)` 로 만들어야 한다.
- 경유점 도달 판정(도달 반경 100mm)과 거리 적분은 50Hz odom 스트림
  스레드에서 하므로 ~1s 제어 주기와 무관하게 정확하다.
- **지연 보상**: 명령이 적용될 시점(~1.1s 뒤)의 포즈를 odom twist 로
  외삽한 뒤 P 오차(방향 회전 후 전진)를 계산한다. 보상 없이 "지금" 포즈로
  계산하면 1~2s 묵은 명령이 근접 목표 주위 궤도 발산을 일으킨다 —
  1차 실행에서 실측했다(거리 2배, 경유점 9 정체, pass=false).
- `--emit-loop x0,y0,x1,y1` 헬퍼: 모서리를 호로 라운딩한 직사각 루프
  경유점 생성. 급코너를 피하는 이유: 도달 반경 100mm 로 경유점을 갈아탈 때
  경로가 꼭짓점당 약 `100mm×(1-cos 선회각)` 만큼 짧아진다 — 90° 급코너
  4개면 -400mm 계열의 체계적 거리 결손이 생겨 ±5% 판정을 오염시킨다.

주의: Windows 에서 `wsl.exe -- bash -lc '<복합 명령>'` 으로 부르면
세미콜론·변수가 바깥 셸에서 다시 해석돼 깨진다. 복합 실행은 스크립트
파일을 만들어 `wsl.exe -d Ubuntu-24.04 -- bash <script>` 로 부른다.

## 실제 실행 결과 (2026-08-10, 커밋된 픽스처)

- 경로: 거실/침실(빈 실 시나리오, 가구 미배치 world) 안 라운딩 직사각
  루프 — 18 경유점, 폴리라인 11,366.9mm. 생성:
  `--emit-loop 600,2170,3900,5090 --fillet-mm 600 --arc-step-deg 30`
- 비교 속도 150mm/s (own·gz 동일 적용 — 판정 중립)

| 항목 | 자체 시뮬레이터 | Gazebo 10.5.0 | 오차 |
|---|---|---|---|
| 운행 거리 | 11,366.9 mm | 11,374.6 mm | **+0.07 %** |
| 소요 시간(시뮬) | 75.78 s | 76.80 s | **+1.35 %** |

**pass = true (둘 다 ±5% 이내), 17/17 경유점 완주.**

해석·전제:

- own 모델은 등속 하한(회전·가감속 미모형, Task 6 simulate 와 동일 가정).
  gz_time 은 "이동 시작(적분>2mm)"~"마지막 경유점 도달"의 시뮬 시간 —
  명령 전달 지연을 빼고 운동학만 비교한다.
- 시간 오차 +1.35% 는 조향 미세 사행(+)과 도달 반경에 의한 모서리 절단(-)
  이 상쇄된 결과다. 급코너 경로였다면 전제 차이(제자리 회전 시간)로
  time_err 가 훨씬 커진다 — 그 경우에도 숨기지 않고 notes 에 남긴 채
  보고한다. **1차 판정 기준은 거리다.**
- 전체 모바일 플랜(약 185s)이 아닌 부분 경로 검증이다 — 사유는 결과
  JSON 의 notes 에 있다(개구부 벽 한계 + 실행 시간).

## 재현 절차 (Windows 쪽에서)

```bash
# 1) 경유점 + world 생성 (Windows Python)
python -m scansim.gazebo.validate --emit-loop 600,2170,3900,5090 \
    --fillet-mm 600 --arc-step-deg 30 --out <dir>/loop_wp.json
python -c "import json; from scansim.gazebo.export_sdf import export_sdf; \
  export_sdf(json.load(open('bim/tests/fixtures/lh26_dump.json', encoding='utf-8')), \
  [], '<dir>/valid_world.sdf', robot_xy_mm=(2250.0, 2170.0))"
# 2) WSL 에서 validate 실행 (스크립트 파일로 — 위 인용 함정 참조)
micromamba run -n gz python3 -m scansim.gazebo.validate \
    --waypoints <dir>/loop_wp.json --world <dir>/valid_world.sdf \
    --out scansim/tests/fixtures/gazebo_validation_result.json --speed-mms 150
```

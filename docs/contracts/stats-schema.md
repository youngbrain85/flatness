# stats 스키마 계약 (P3 대시보드 · P4 보고서 · 워커 소비 정본)

> **정본 선언**: 본 문서는 엔진(`engine/flatness`)이 산출하는 `stats.json`(및 동반 산출물)의 계약 정본이다.
> **stats 키를 추가·변경·제거하는 모든 엔진 코드 변경은 본 문서 갱신을 동반해야 한다.** 문서와 코드가 어긋나면
> 코드가 사실(fact)이지만, 그 상태 자체가 결함이며 해당 PR/커밋에서 문서를 함께 고쳐야 한다.
>
> **대상 독자**: 엔진 내부 구현을 모르는 프론트엔드(P3 대시보드)·보고서(P4)·워커 개발자.
> **ENGINE_VERSION**: `engine/flatness/__init__.py`의 `ENGINE_VERSION` 상수(현재 `p1d-0.4.0`). `stats.meta.engine_version`이
> 이 값을 그대로 담는다(단, §3의 "임포트 경로" 예외 참고).
>
> 이 문서의 모든 표는 아래 소스를 라인 단위로 대조해 작성했다(대조 방법·결과는 커밋 메시지 본문 참고):
> `engine/flatness/outputs/stats.py`, `engine/flatness/core/pipeline.py`, `engine/flatness/core/cells.py`,
> `engine/flatness/core/walls.py`, `engine/flatness/core/zones.py`, `engine/flatness/criteria.py`,
> `engine/flatness/importer/colab_csv.py`, `engine/flatness/outputs/summary.py`, `engine/flatness/outputs/heatmap.py`,
> `engine/flatness/outputs/preview3d.py`.

## 0. 산출 경로 3가지

엔진은 세 개의 진입점에서 `stats` 객체를 만든다. 세 경로 모두 `build_stats()`(`engine/flatness/outputs/stats.py:9`)로 공통
키를 만든 뒤, 호출자가 경로별 키를 덧붙인다.

| 경로 | 함수 | 소스 | `meta.surface` |
|---|---|---|---|
| 바닥(LiDAR 원본) | `analyze_floor` | `core/pipeline.py:19` | `"floor"` |
| 벽면(LiDAR 원본) | `analyze_wall` | `core/pipeline.py:68` | `"wall"` |
| 외부 결과 임포트(Colab CSV) | `import_colab_csv` | `importer/colab_csv.py:38` | `"floor"`(임포트는 바닥 결과 전용) |

이하 표에서 "경로" 컬럼은 이 세 값(`floor`/`wall`/`import`)으로 표기한다.

## 1. 공통 키 (모든 경로, `build_stats()` 반환값)

`build_stats(cells, grades, crit, u_mm, warnings, meta, zones=None, coverage_pct=None)` (`outputs/stats.py:9-48`)가
직접 채우는 키다. `n = len(cells)`, `valid = [c for c in cells if c.value_mm is not None]` 기준.

| 키 | 타입 | 설명 | 반올림/None 조건 |
|---|---|---|---|
| `n_cells` | int | 판정 셀 총수(등급 무관, `na` 포함) | — |
| `n_valid` | int | `value_mm is not None`인 셀 수 | — |
| `grade_counts` | `{pass,borderline,repair,rework,na}` → int | 등급별 셀 개수. 5키 항상 존재(0 포함) | — |
| `grade_pct` | 위 5키 → float | 등급별 비율(%) | 소수 1자리. `n_cells==0`이면 전부 `0.0` |
| `value_max_mm` \| `null` | float \| null | 유효 셀 중 최댓값(mm) | 소수 2자리. `n_valid==0`이면 `null` |
| `value_min_mm` \| `null` | float \| null | 유효 셀 중 최솟값(mm) | 위와 동일 |
| `value_mean_mm` \| `null` | float \| null | 유효 셀 평균(mm) | 위와 동일 |
| `value_p95_mm` \| `null` | float \| null | 유효 셀 95백분위수(mm, `numpy.percentile` 선형보간) | 위와 동일 |
| `worst` \| `null` | object \| null | 최댓값 셀 상세(아래 표). `n_valid==0`이면 `null` | — |
| `coverage_pct` | float | §4 참고 — 경로별로 분모·분자 의미가 다름 | 소수 1자리 |
| `reduced_span_cells` | int | `span_used_m < (crit.span_m or 0)`인 유효 셀 수. `crit.span_m`이 `null`인 기준(예: 수직도)에서는 항상 0 | — |
| `applied_criteria` | object | 적용 기준 스냅샷(아래 표) | — |
| `warnings` | `string[]` | §6 코드 사전 참고. 정렬됨(`sorted`) | — |
| `zones` | object[] | §2 참고 — floor만 채워지고 wall/import는 항상 `[]` | — |
| `meta` | object | 호출자가 채운 그대로 저장(§3) | — |
| `auto_summary` | string | **`build_stats()`가 만들지 않음** — 세 파이프라인 함수가 반환 직후 `generate_summary(stats)`로 사후 추가(`outputs/summary.py:21`, 호출부 `core/pipeline.py:57,112`·`importer/colab_csv.py:51`). 그래도 세 경로 모두 최종 `stats.json`에는 항상 존재 | — |

`worst` 하위 키(`outputs/stats.py:37-39`, `core/cells.py:16-26`):

| 키 | 타입 | 설명 | 반올림 |
|---|---|---|---|
| `value_mm` | float | 최대 편차(mm) | 소수 2자리 |
| `cell_ix` / `cell_iy` | int | 셀 그리드 인덱스(좌표 아님) | — |
| `point_x` / `point_y` | float | 최댓값이 관측된 지점 좌표. **반올림되지 않음**(cells.json/results.csv의 `worst_x`/`worst_y`는 소수 3자리로 반올림되지만, 이 최상위 `worst.point_x/y`는 원본 float 그대로) | 없음 — 소비자가 필요시 직접 반올림 |
| `zone_id` | int \| null | floor: 소속 구역 id. wall: 소속 wall_id. import: 항상 `null` | — |

`applied_criteria` 하위 키(`outputs/stats.py:43-44`, `criteria.py` `Criterion`):

| 키 | 타입 | 설명 |
|---|---|---|
| `name` | string | 기준 이름(예: `floor-kcs-exposed`, 전체 목록은 `engine/flatness/data/seed_criteria.json`) |
| `source` | string | 기준 근거 문구(예: `"KCS 14 20 10 표 3.7-1 ..."`) |
| `span_m` | float \| null | 기준 스팬 길이(m). 수직도 기준처럼 스팬 개념이 없으면 `null` |
| `pass_mm` / `rework_mm` | float | 기준 허용치(mm) |
| `u_mm` | float | 호출 시 전달된 측정 불확도(mm). CLI 기본값: 바닥 5.0, 벽 8.0(`cli.py:61`) |

## 2. 조건부 키 표 (경로별)

| 키 | floor | wall | import | 비고 |
|---|---|---|---|---|
| `preview3d_paths` | O | — | — | `analyze_floor`에서만 추가(`core/pipeline.py:60-62`). `string[]`, 0~2개: 잔차가 전부 NaN이면 `[]`, 아니면 `["preview3d.png"]`, 최댓값 지점 1.5m 반경 내 점이 있으면 `["preview3d.png","preview3d_zoom.png"]`(`outputs/preview3d.py:19-49`) |
| `walls` | — | O | — | `analyze_wall`에서만 추가(`core/pipeline.py:111`). §2.1 참고 |
| `zones` (내용) | 구역 목록 채움 | 항상 `[]` | 항상 `[]` | 키 자체는 §1의 공통 키. wall/import는 `build_stats(..., zones=None)` 호출이라 `zones or []` → `[]`(`outputs/stats.py:47`) |
| `meta.scale_to_m` | O | O | — | 사용자가 `--units`로 지정한 배율(예: mm=0.001). import는 CSV 값을 이미 m로 변환해 읽으므로 키 자체가 없음(`importer/colab_csv.py:35,48-49`) |
| `meta.bbox_min` | O(3원소) | O(3원소) | — | `info.bbox_min * scale_to_m` 반올림 4자리(`core/pipeline.py:54,109`). import는 `CloudInfo`를 직접 만들지만 meta에 넣지 않음 |
| `meta.source` | — | — | O(`"colab-import"`) | floor/wall meta에는 키 자체가 없음(→ 소비자는 `"source" in meta`로 판별, 없으면 LiDAR 원본) |
| `meta.subcell_m` / `meta.cell_m` | O | O | O | 세 경로 모두 존재(분석 파라미터, 기본값 0.05/1.0) |
| `meta.engine_version` | `ENGINE_VERSION`(`p1d-0.4.0`) | `ENGINE_VERSION` | 고정 문자열 `"external-colab-v1"` | import는 실제 엔진 버전과 무관하게 별도 태그 사용(`importer/colab_csv.py:48`) — 소비자가 LiDAR 분석과 임포트 결과를 구분하는 또 다른 근거 |

### 2.1 `walls[]` 원소 (wall 전용, `core/pipeline.py:97-103` + `core/walls.py:175-177`)

| 키 | 타입 | 설명 | 반올림 |
|---|---|---|---|
| `wall_id` | int | 1부터 시작하는 벽 후보 순번(검출 순서). §6의 `wall_{i}_skipped`와 같은 채번 체계지만, 스킵된 번호는 `walls[]`에 나타나지 않음(결번) | — |
| `n_cells` | int | 이 벽만의 셀 수(전체 `stats.n_cells`는 모든 벽 합산) | — |
| `height_m` / `length_m` | float | 벽 투영 그리드의 v(높이)·u(길이) 범위 | 소수 2자리 |
| `plumbness_mm` | float | 전역 기울기 기반 수직도(`abs(b) * height_m * 1000`) | 소수 2자리 |
| `plumb_grade` | `pass\|borderline\|repair\|rework` | `wall-kcs-plumb` 기준으로 판정. 입력값이 항상 존재하므로 `na`는 나오지 않음 | — |
| `plane_abc` | `[a,b,c]` (3 float) | 벽 평면 재피팅 계수. **wall 프레임 좌표(u,v)로 직접 대입 가능**(§5 참고) | 소수 6자리 |
| `frame` | object | 아래 표 | — |

`frame` 하위 키(`WallLine` 정의는 `core/walls.py:9-17`, JSON 직렬화는 `core/pipeline.py:98-102`):

| 키 | 타입 | 설명 |
|---|---|---|
| `p0` | `[x,y]` | 벽 라인 기준점, **bbox 상대 좌표**(m) |
| `direction` | `[x,y]` | 벽을 따라가는 단위벡터(u축) |
| `normal` | `[x,y]` | 벽 법선 단위벡터(w축, +w = 실내 방향) |
| `u_min` / `u_max` | float | 벽 라인 상의 u 범위(m) |
| `z_min` / `z_max` | float | 벽의 z 범위, **bbox 상대**(`meta.bbox_min[2]` 기준) |

모든 `frame` 필드는 소수 4자리로 반올림(`core/pipeline.py:98-102`).

## 3. `coverage_pct`의 3중 의미

같은 키가 경로에 따라 분모·분자가 다르다. 소비자는 **`meta.surface`와 `meta.source`로 반드시 분기**해야 한다(값만 보고는 구분 불가).

| 경로 | 의미 | 계산 | 소스 |
|---|---|---|---|
| floor | **바닥 인식률**: 판정 가능(`status=="ok"`) 구역에 속한 서브셀 수 / 전체 유효 서브셀 수 | `100 * ok_sub / n_valid_sub` | `core/pipeline.py:43-44` — `build_stats(..., coverage_pct=coverage)`로 명시 전달 |
| wall | **셀 유효율**: 판정 가능한 셀 수 / 전체 셀 수 | `100 * len(valid) / n` (기본 계산) | `analyze_wall`은 `coverage_pct` 인자를 넘기지 않음 → `outputs/stats.py:40-41`의 기본 분기 사용 |
| import | **셀 유효율**(wall과 동일 공식) | `100 * len(valid) / n` | `import_colab_csv`도 `coverage_pct` 인자 없이 호출 |

70% 미만이면 floor 경로에서만 `low_coverage` 경고가 붙는다(§6).

## 4. 좌표 프레임

### 4.1 floor — 절대 스케일 좌표

`cells.json`의 `center_x/center_y`, `stats.worst.point_x/point_y`는 **파일 원본 좌표계에 `scale_to_m`만 곱한 절대 좌표**다.
근거: `SubcellGrid.origin = info.bbox_min[:2] * scale_to_m`이고(`core/subcell.py:60`), 셀 중심은
`grid.origin[0] + (ix+0.5)*subcell_m`로 복원되므로(`core/cells.py:101-102`) 결과적으로 `bbox_min + (점 - bbox_min)` = 원본 절대
좌표가 된다. **역매핑이 필요 없다** — 그대로 X/Y로 사용하면 된다. `meta.bbox_min`은 스캔의 표시 범위(바운딩 박스) 참고용으로만
쓰면 된다.

> **주의(대조 중 발견)**: `zones[].plane_abc`는 이 절대 좌표가 아니라 **구역-로컬(=bbox 상대) 좌표**로 피팅되어 있다
> (`core/zones.py:96-101`, 주석 "구역 로컬 좌표로 피팅(대좌표 조건수 문제 회피 — origin 무관)"). 특정 셀에서 평면값을
> 재계산하려면:
> ```
> local_x = center_x - meta.bbox_min[0]
> local_y = center_y - meta.bbox_min[1]
> z_fit   = a * local_x + b * local_y + c   # a,b,c = zones[i].plane_abc
> ```
> `center_x/center_y`를 그대로 대입하면 틀린 값이 나온다.

### 4.2 wall — bbox 상대 좌표 (u, v)

`cells.json`의 `center_x`는 벽을 따라가는 거리 **u**, `center_y`는 `meta.bbox_min[2]` 기준 높이 **v**다(둘 다 bbox 상대,
`core/walls.py:105-138` 투영 + `wall_grid`). 절대 3D 좌표로 역매핑:

```
world_z    = meta.bbox_min[2] + center_y                                          # v → 절대 높이
world_xy   = meta.bbox_min[:2] + walls[i].frame.p0 + center_x * walls[i].frame.direction
             # (w=0 근사: 실제 요철은 mm 단위라 평면상 위치에 영향 없음. 필요하면 walls[i].frame.normal 방향으로 미세 보정)
```

`i`는 셀의 `zone_id`(=wall_id)로 `walls[]`에서 찾는다. `walls[i].plane_abc`는 **이 (u,v) 프레임에 그대로 대입 가능**하다
(`core/walls.py:163-166`이 `cu,cv`로 바로 피팅 — floor의 zones와 달리 오프셋 보정이 필요 없음):
```
w_fit = a * center_x + b * center_y + c   # a,b,c = walls[i].plane_abc
```

### 4.3 import — floor와 동일

`import_colab_csv`는 CSV의 X/Y를 그대로 절대 좌표로 사용한다(`scale_to_m=1.0` 고정, `importer/colab_csv.py:41`). §4.1과 동일하게
역매핑이 필요 없다. 다만 `meta.bbox_min`이 아예 없으므로(§2) 구역 관련 로컬 좌표 이슈도 발생하지 않는다(`zones`가 항상 `[]`).

## 5. warnings 코드 사전

| 코드 | 의미 | 발생 경로 | 소스 |
|---|---|---|---|
| `ghost_layer_rescan` | 서브셀 일부가 쌍봉(이중 표면) 판정되어 판정에서 제외됨. 재스캔 권장 | floor | `core/pipeline.py:37-38` (`grid.bimodal`) |
| `ghost_zone_excluded` | 이중 표면 비율이 높은 구역 전체가 통째로 제외됨 | floor | `core/pipeline.py:41-42`, `core/zones.py:93-95`(`status="ghost"`) |
| `furniture_excluded` | 가구 상판으로 추정되는 구역이 판정에서 제외됨 | floor | `core/pipeline.py:39-40`, `core/zones.py:87-91`(`status="furniture"`) |
| `low_coverage` | 바닥 인식률(`coverage_pct`) < 70% | floor | `core/pipeline.py:45-46` |
| `reduced_span` | 공간 제약으로 셀의 유효 스팬이 기준 스팬보다 짧아 허용치·불확도를 선형 환산해 적용함 | floor·wall·import(셀 단위 공통) | `criteria.py:33-35` |
| `uncertainty_swallows_repair` | 기준의 `pass_mm + u_mm >= rework_mm`이라 경계 판정 구간이 사실상 보수 구간을 흡수함(기준/불확도 조합 자체의 경고, 특정 셀과 무관) | floor·wall·import 공통 | `criteria.py:39-40` |
| `plumbness_relative_to_z` | 수직도는 스캔 좌표계 z축 기준 상대 지표(중력 보정 아님) | wall(항상 포함) | `core/pipeline.py:79` |
| `wall_{i}_skipped` | i번째(1부터) 벽 후보가 유효 서브셀 부족 또는 처리 오류로 판정에서 제외됨 — **개방 패턴**(문자열 접두 매칭 필요, 고정 목록 아님) | wall | `core/pipeline.py:86,90` |

소비자 구현 참고: `wall_{i}_skipped`는 정규식 `^wall_\d+_skipped$`(또는 `startswith("wall_") and endswith("_skipped")`)로 매칭해야 한다
— CLI/요약 생성기도 이 방식을 쓴다(`outputs/summary.py:51-52`).

## 6. 산출물 파일 규약

| 파일 | 경로 | 내용 |
|---|---|---|
| `stats.json` | floor·wall·import | 본 문서의 스키마(`json.dumps(..., indent=2)`) |
| `cells.json` | floor·wall·import | 셀별 행 배열(zone_id 포함, 아래 표) |
| `results.csv` | floor·wall·import | `cells.json`과 동일한 행을 CSV로(헤더 순서 아래 표와 동일) |
| `heatmap.png` | floor·import | 단일 등급 히트맵 |
| `heatmap_wall{n}.png` | wall | 벽별 히트맵. `n`은 `wall_id`와 동일 채번 — **스킵된 벽은 파일 자체가 생성되지 않음(결번)** |
| `preview3d.png` | floor | 3D 편차 프리뷰(전체) |
| `preview3d_zoom.png` | floor(조건부) | 최댓값 지점 반경 1.5m 확대. 반경 내 점이 없으면 생성 안 됨 |

`cells.json` / `results.csv` 행 스키마(`outputs/stats.py:6,51-59`):

| 필드 | 타입 | 설명 | 반올림 |
|---|---|---|---|
| `ix` / `iy` | int | 셀 그리드 인덱스 | — |
| `center_x` / `center_y` | float | 셀 중심 좌표(§4 프레임 참고) | 소수 3자리 |
| `value_mm` | float \| null | 이 셀의 판정값(mm). `null`이면 `span_used_m`도 항상 `0.0` | 소수 2자리 |
| `span_used_m` | float | 실제 사용된 직선자 스팬 길이(m) | 소수 2자리 |
| `occupancy` | float | 셀 내 유효 서브셀 비율(0~1). `value_mm`이 `null`이어도 실측값 유지(원인 진단용) | 소수 2자리 |
| `grade` | `pass\|borderline\|repair\|rework\|na` | 등급. `value_mm is null`이면 항상 `"na"` | — |
| `worst_x` / `worst_y` | float \| null | 셀 내 최대 결함 지점 좌표(§4 프레임과 동일 체계). `value_mm`이 `null`이면 `null` | 소수 3자리 |
| `zone_id` | int \| null | floor: 소속 구역 id. wall: 소속 wall_id. import: 항상 `null`(구역/벽 개념 없음) | — |

## 7. §5.4 JSON 연계 입력 스키마 (임포트 계약, 티켓 25 해소)

**구현 상태: 미구현.** 현재 엔진에 있는 임포트 경로는 `import_colab_csv`(CSV 전용, §7.1) 뿐이다. 아래는 "범용 프로그램
결과 JSON 임포트"의 **계약 정의**이며, 실제 파서 구현은 P4/P5 백로그다. 구현 시점에도 **이 문서가 계약 정본**이며, 스키마를
바꾸려면 먼저 이 문서를 갱신해야 한다.

```json
{
  "format": "flatness-import-v1",
  "surface": "floor",
  "points": [
    {"x": 0.0, "y": 0.0, "deviation_mm": -3.2}
  ],
  "meta": {
    "source_program": "...",
    "measured_at": "YYYY-MM-DD"
  }
}
```

| 필드 | 타입 | 단위 | 필수 | 의미 |
|---|---|---|---|---|
| `format` | string | — | 필수 | 고정값 `"flatness-import-v1"`(향후 스키마 개정 시 버전 문자열로 분기) |
| `surface` | `"floor"` | — | 필수 | 현재 계획된 구현은 CSV 임포트와 동일하게 **바닥 전용**(`importer/colab_csv.py`의 `import_colab_csv`가 바닥 기준만 허용하는 것과 동일 제약, `cli.py:37-39`). `"wall"`은 스키마상 예약만 해두고, 실제 지원 여부는 구현 시점에 재확인 |
| `points` | array | — | 필수 | 최소 1개 이상 |
| `points[].x` | number | m(미터) | 필수 | 평면 X 좌표 |
| `points[].y` | number | m(미터) | 필수 | 평면 Y 좌표 |
| `points[].deviation_mm` | number | mm(밀리미터) | 필수 | 이미 평면 제거가 끝난 최종 편차값(부호 규약은 소스 프로그램 정의를 따르며, 엔진은 이 값을 그대로 서브셀 중앙값 입력으로 사용 — CSV 경로의 `Signed_Distance_mm`과 동일 역할) |
| `meta.source_program` | string | — | 권장 | 원 분석 프로그램 식별자(자유 문자열) |
| `meta.measured_at` | string | `YYYY-MM-DD` | 권장 | 측정일자 |

**CSV(colab) vs JSON(범용) 두 임포트 경로**: CSV 경로(`importer/colab_csv.py`)는 기존 Colab 노트북이 뱉는 고정 컬럼
(`X,Y,Z,Distance_mm,Signed_Distance_mm,R,G,B,Is_Uneven` 중 `X,Y,Signed_Distance_mm`만 사용)을 그대로 소비하는 레거시 호환
경로다. JSON 경로는 CSV 컬럼 규약에 매이지 않는 외부 프로그램 전반을 위한 범용 계약으로 신설한다. 두 경로 모두 최종적으로
동일한 `import_colab_csv` 내부 파이프라인(서브셀 중앙값 → `evaluate_cells` → `grade_cells`)에 합류할 것으로 예상되며,
`stats.meta`에는 §2의 import 경로 규약(`scale_to_m`/`bbox_min` 없음, `source` 키 존재, `engine_version="external-colab-v1"`
또는 JSON 전용 태그)을 그대로 따라야 한다.

### 7.1 참고: 현재 구현된 CSV(colab) 임포트 계약

- 필수 컬럼(대소문자 구분): `X`, `Y`, `Signed_Distance_mm`. 그 외 컬럼은 무시(`importer/colab_csv.py:21-23`)
- 인코딩 `utf-8-sig`, 헤더 필수. 파싱 불가 행은 건너뜀(`importer/colab_csv.py:26-31`)
- `Signed_Distance_mm`는 이미 평면 제거된 편차(mm) → 내부적으로 `/1000`해 m로 변환 후 서브셀 z값으로 사용(`importer/colab_csv.py:35`)
- 유효 행 0개 또는 유효 서브셀 10개 미만이면 `ValueError`(`importer/colab_csv.py:33-34,42-43`)

## 부록 A. 등급 라벨 매핑 (프론트엔드 참고)

`grade_counts`/`grade_pct`의 5개 키와 `cells.json`의 `grade` 값은 다음 한국어 라벨·색상과 1:1 대응한다
(`outputs/heatmap.py:16-20`):

| 키 | 한국어 라벨 | 히트맵 색상(hex) |
|---|---|---|
| `pass` | 적합 | `#2e7d32` |
| `borderline` | 경계 | `#f9ab00` |
| `repair` | 보수 | `#e8710a` |
| `rework` | 재시공 | `#c5221f` |
| `na` | 판정 불가 | `#9e9e9e` |

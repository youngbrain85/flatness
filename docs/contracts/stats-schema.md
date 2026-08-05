# stats 스키마 계약 (P3 대시보드 · P4 보고서 · 워커 소비 정본)

> **정본 선언**: 본 문서는 엔진(`engine/flatness`)이 산출하는 `stats.json`(및 동반 산출물)의 계약 정본이다.
> **stats 키를 추가·변경·제거하는 모든 엔진 코드 변경은 본 문서 갱신을 동반해야 한다.** 문서와 코드가 어긋나면
> 코드가 사실(fact)이지만, 그 상태 자체가 결함이며 해당 PR/커밋에서 문서를 함께 고쳐야 한다.
>
> **대상 독자**: 엔진 내부 구현을 모르는 프론트엔드(P3 대시보드)·보고서(P4)·워커 개발자.
> **ENGINE_VERSION**: `engine/flatness/__init__.py`의 `ENGINE_VERSION` 상수(현재 `p4-0.5.0`). `stats.meta.engine_version`이
> 이 값을 그대로 담는다(단, §2의 "임포트 경로" 예외 참고). **§1~§7은 floor/wall/import 세 경로만 다룬다** -
> 구배(slope) stats는 완전히 다른 스키마(`slope-stats-v1`)를 쓰고 `meta` 키 자체가 없어 `stats.meta.engine_version`
> 경로가 존재하지 않는다. 구배 계약은 **§8**에서 별도로 다룬다. 구배 분석의 엔진 버전은 오직
> `analyses.engine_version` 컬럼으로만 흐르며(§8.7 참고), 그마저도 재판정(§7.3)에서는 갱신되지 않는다는 한계가
> 있다(백로그 참고).
>
> 이 문서의 모든 표는 아래 소스를 라인 단위로 대조해 작성했다(대조 방법·결과는 커밋 메시지 본문 참고):
> `engine/flatness/outputs/stats.py`, `engine/flatness/core/pipeline.py`, `engine/flatness/core/cells.py`,
> `engine/flatness/core/walls.py`, `engine/flatness/core/zones.py`, `engine/flatness/criteria.py`,
> `engine/flatness/importer/colab_csv.py`, `engine/flatness/outputs/summary.py`, `engine/flatness/outputs/heatmap.py`,
> `engine/flatness/outputs/preview3d.py`, `engine/flatness/outputs/deviation.py`. §8은 별도로
> `engine/flatness/core/slope.py`, `engine/flatness/outputs/slope_cells.py`, `engine/flatness/outputs/slope_judged.py`,
> `engine/flatness/outputs/slope_map.py`, `engine/flatness/core/pipeline.py`의 `judge_slope_cells`/`analyze_slope`를
> 대조했다.

## 0. 산출 경로 4가지

엔진은 네 경로에서 stats류 객체를 만든다. floor/wall/import 세 경로는 `build_stats()`
(`engine/flatness/outputs/stats.py:9`)로 공통 키를 만든 뒤 호출자가 경로별 키를 덧붙이는 방식을 공유한다.
**구배(slope)는 이 공통 함수를 전혀 타지 않는다** - 완전히 다른 스키마(`slope-stats-v1`)를 쓰는
`judge_slope_cells`(`core/pipeline.py:171`)가 유일한 작성자다. `analyze_slope`(`core/pipeline.py:280`)는
점군을 읽어 셀을 산출한 뒤 이 `judge_slope_cells`를 그대로 호출하는 것일 뿐, 별도의 stats 스키마를
만들지 않는다 - 그래서 "진입점"은 넷이지만 slope stats의 실제 **작성자 함수는 하나**다. 자세한 내용은 §8.

| 경로 | 함수 | 소스 | `meta.surface` |
|---|---|---|---|
| 바닥(LiDAR 원본) | `analyze_floor` | `core/pipeline.py:19` | `"floor"` |
| 벽면(LiDAR 원본) | `analyze_wall` | `core/pipeline.py:68` | `"wall"` |
| 외부 결과 임포트(Colab CSV) | `import_colab_csv` | `importer/colab_csv.py:38` | `"floor"`(임포트는 바닥 결과 전용) |
| 구배(LiDAR 원본, §7.3 재판정 포함) | `analyze_slope`(최초) / `judge_slope_cells`(재판정) | `core/pipeline.py:280` / `core/pipeline.py:171` | 키 자체 없음(§8 참고) |

§1~§7에서 "경로" 컬럼은 앞 세 값(`floor`/`wall`/`import`)으로만 표기한다 - 그 표들은 `build_stats()` 공통 스키마
얘기이고 구배는 그 스키마를 아예 쓰지 않기 때문이다.

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
| `coverage_pct` | float | §3 참고 — 경로별로 분모·분자 의미가 다름 | 소수 1자리 |
| `reduced_span_cells` | int | `span_used_m < (crit.span_m or 0)`인 유효 셀 수. `crit.span_m`이 `null`인 기준에서는 항상 0 | — |
| `applied_criteria` | object | 적용 기준 스냅샷(아래 표) | — |
| `warnings` | `string[]` | §5 코드 사전 참고. 정렬됨(`sorted`) | — |
| `zones` | object[] | §2 참고 — floor만 채워지고 wall/import는 항상 `[]` | — |
| `meta` | object | 호출자가 채운 그대로 저장. 공통 하위 키는 바로 아래 표, 경로별 조건부 키는 §2 참고 | — |
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

`meta` 공통 하위 키(세 경로 모두 무조건 존재, `core/pipeline.py:51,106`·`importer/colab_csv.py:48`) — 경로별 조건부 키(`scale_to_m`·`bbox_min`·`source`·`subcell_m`·`cell_m`·`engine_version`)는 §2 표 참고:

| 키 | 타입 | 설명 |
|---|---|---|
| `file` | string | 입력 파일 경로 문자열(`str(path)`). 호출 시 전달된 경로를 그대로 담을 뿐 절대경로로 정규화하지 않음 — 상대 경로로 호출되면 그대로 상대 경로가 저장됨 |
| `n_points` | int | 원시 점 수. floor/wall은 `info.n_points`(파일 전체 점 개수), import는 `len(pts)`(CSV에서 파싱에 성공한 유효 행 수) |

## 2. 조건부 키 표 (경로별)

| 키 | floor | wall | import | 비고 |
|---|---|---|---|---|
| `preview3d_paths` | O | — | — | `analyze_floor`에서만 추가(`core/pipeline.py:60-62`). `string[]`, 0~2개: 잔차가 전부 NaN이면 `[]`, 아니면 `["preview3d.png"]`, 최댓값 지점 1.5m 반경 내 점이 있으면 `["preview3d.png","preview3d_zoom.png"]`(`outputs/preview3d.py:19-49`). 렌더 자체가 예외로 실패해도 `[]`이며, 이때는 `preview3d_render_failed` 경고가 동반된다(§5) |
| `deviation_paths` | O | O | — | 정밀 편차맵 파일명 목록(`string[]`). floor는 `[]` 또는 `["deviation.png"]`, wall은 `wall_id` 오름차순 `["deviation_wall1.png", ...]`이며 **스킵된 벽은 목록에 없다(결번)**. 잔차 유효값이 하나도 없으면 파일을 만들지 않아 목록에서 빠진다(`core/pipeline.py`·`outputs/deviation.py`). 렌더가 예외로 실패한 경우도 마찬가지로 해당 파일명이 목록에서 빠지며 `deviation_render_failed` 경고가 동반된다(§5). import 경로는 이 키 자체가 없으므로 소비자는 항상 "없으면 빈 목록"으로 다룬다. **판정과 무관한 보조 시각화**이며 등급·수치 필드에 영향을 주지 않는다 |
| `walls` | — | O | — | `analyze_wall`에서만 추가(`core/pipeline.py:111`). §2.1 참고 |
| `zones` (내용) | 구역 목록 채움 | 항상 `[]` | 항상 `[]` | 키 자체는 §1의 공통 키. wall/import는 `build_stats(..., zones=None)` 호출이라 `zones or []` → `[]`(`outputs/stats.py:47`) |
| `meta.scale_to_m` | O | O | — | 사용자가 `--units`로 지정한 배율(예: mm=0.001). import는 CSV 값을 이미 m로 변환해 읽으므로 키 자체가 없음(`importer/colab_csv.py:35,48-49`) |
| `meta.bbox_min` | O(3원소) | O(3원소) | — | `info.bbox_min * scale_to_m` 반올림 4자리(`core/pipeline.py:54,109`). import는 `CloudInfo`를 직접 만들지만 meta에 넣지 않음 |
| `meta.source` | — | — | O(`"colab-import"`) | floor/wall meta에는 키 자체가 없음(→ 소비자는 `"source" in meta`로 판별, 없으면 LiDAR 원본) |
| `meta.subcell_m` / `meta.cell_m` | O | O | O | 세 경로 모두 존재(분석 파라미터, 기본값 0.05/1.0) |
| `meta.engine_version` | `ENGINE_VERSION`(`p4-0.5.0`) | `ENGINE_VERSION` | 고정 문자열 `"external-colab-v1"` | import는 실제 엔진 버전과 무관하게 별도 태그 사용(`importer/colab_csv.py:48`) — 소비자가 LiDAR 분석과 임포트 결과를 구분하는 또 다른 근거 |

### 2.1 `walls[]` 원소 (wall 전용, `core/pipeline.py:97-103` + `core/walls.py:175-177`)

| 키 | 타입 | 설명 | 반올림 |
|---|---|---|---|
| `wall_id` | int | 1부터 시작하는 벽 후보 순번(검출 순서). §5의 `wall_{i}_skipped`와 같은 채번 체계지만, 스킵된 번호는 `walls[]`에 나타나지 않음(결번) | — |
| `n_cells` | int | 이 벽만의 셀 수(전체 `stats.n_cells`는 모든 벽 합산) | — |
| `height_m` / `length_m` | float | 벽 투영 그리드의 v(높이)·u(길이) 범위 | 소수 2자리 |
| `plumbness_mm` | float | 전역 기울기 기반 수직도(`abs(b) * height_m * 1000`) | 소수 2자리 |
| `plumb_grade` | `pass\|borderline\|repair\|rework` | `wall-kcs-plumb` 기준으로 판정. 입력값이 항상 존재하므로 `na`는 나오지 않음 | — |
| `plane_abc` | `[a,b,c]` (3 float) | 벽 평면 재피팅 계수. **wall 프레임 좌표(u,v)로 직접 대입 가능**(§4.2 참고) | 소수 6자리 |
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

### 2.2 `zones[]` 원소 (floor 전용, `core/pipeline.py:47-50`)

wall/import 경로에서 `zones`는 항상 `[]`이므로(§2 표) 아래 필드는 floor에서만 나타난다.

| 키 | 타입 | 설명 | 반올림 |
|---|---|---|---|
| `zone_id` | int | 구역 식별자(1부터, 검출 순서) | — |
| `level_m` | float | 구역이 속한 레벨 밴드의 높이. **`meta.bbox_min[2]` 기준 상대 높이**(절대 좌표 아님 — `core/subcell.py:36` 주석 "상대 높이 저장" 참고) | 소수 3자리 |
| `area_m2` | float | 구역 면적(서브셀 합) | 소수 2자리 |
| `status` | `"ok"\|"ghost"\|"furniture"` | 아래 참고 | — |
| `plane_abc` | `[a,b,c]` \| `null` | 구역 평면 재피팅 계수. **구역-로컬(=bbox 상대) 좌표로 피팅됨**(§4.1 "주의" 참고 — `center_x/center_y`를 그대로 대입하면 안 됨). `status`가 `ok`가 아니면 피팅 자체를 건너뛰므로 `null` | 소수 6자리 |

`status` 값별 의미(`core/zones.py:87-95`):
- `ok`: 판정 대상 정상 구역(평면 재피팅·셀 판정 모두 수행)
- `ghost`: 구역 대부분이 이중 표면(유령층)으로 판정되어 재스캔이 필요 — **판정에서 제외**(`ghost_zone_excluded` 경고 동반, §5)
- `furniture`: 가구 상판으로 추정되는 구역 — **판정에서 제외**(`furniture_excluded` 경고 동반, §5)

## 3. `coverage_pct`의 3중 의미

같은 키가 경로에 따라 분모·분자가 다르다. 소비자는 **`meta.surface`와 `meta.source`로 반드시 분기**해야 한다(값만 보고는 구분 불가).

| 경로 | 의미 | 계산 | 소스 |
|---|---|---|---|
| floor | **바닥 인식률**: 판정 가능(`status=="ok"`) 구역에 속한 서브셀 수 / 전체 유효 서브셀 수 | `100 * ok_sub / n_valid_sub` | `core/pipeline.py:43-44` — `build_stats(..., coverage_pct=coverage)`로 명시 전달 |
| wall | **셀 유효율**: 판정 가능한 셀 수 / 전체 셀 수 | `100 * len(valid) / n` (기본 계산) | `analyze_wall`은 `coverage_pct` 인자를 넘기지 않음 → `outputs/stats.py:40-41`의 기본 분기 사용 |
| import | **셀 유효율**(wall과 동일 공식) | `100 * len(valid) / n` | `import_colab_csv`도 `coverage_pct` 인자 없이 호출 |

70% 미만이면 floor 경로에서만 `low_coverage` 경고가 붙는다(§5).

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
| `uncertainty_swallows_pass` | `b1(=pe-U_eff) <= 0`이라 편차 0.0mm인 완벽한 표면조차 "적합"이 원리적으로 나올 수 없음(기준/불확도 조합 자체의 경고, 특정 셀과 무관 — `uncertainty_swallows_repair`와 별개 현상이며 동시에 뜰 수 있음) | floor·wall·import 공통 | `criteria.py:41-42` |
| `plumbness_relative_to_z` | 수직도는 스캔 좌표계 z축 기준 상대 지표(중력 보정 아님) | wall(항상 포함) | `core/pipeline.py:79` |
| `wall_{i}_skipped` | i번째(1부터) 벽 후보가 유효 서브셀 부족 또는 처리 오류로 판정에서 제외됨 — **개방 패턴**(문자열 접두 매칭 필요, 고정 목록 아님) | wall | `core/pipeline.py:86,90` |
| `heatmap_render_failed` | 판정 히트맵(`heatmap.png`/`heatmap_wall{n}.png`) 렌더가 예외(디스크·폰트 등 인프라 사유)로 실패함. 판정 수치는 영향 없음 | floor·wall | `core/pipeline.py`(`render_heatmap` 호출부) |
| `preview3d_render_failed` | 3D 프리뷰(`preview3d.png`) 렌더가 실패해 `preview3d_paths`가 `[]`로 저장됨. 판정 수치는 영향 없음 | floor | `core/pipeline.py`(`render_preview3d` 호출부) |
| `deviation_render_failed` | 정밀 편차맵(`deviation.png`/`deviation_wall{n}.png`) 렌더가 실패해 해당 파일명이 `deviation_paths`에서 빠짐. 판정 수치는 영향 없음 | floor·wall | `core/pipeline.py`(`render_deviation_map` 호출부) |
| `fused_mesh_smoothed` | 업로드 시 데이터 계보를 "융합 메시"로 선택한 스캔임 — 스캐너 앱이 표면을 다듬은 데이터라 실제 요철보다 양호한 결과가 나올 수 있음(스펙 §5.1.1) | floor·wall·import·slope 공통 — **엔진이 아니라 워커가 붙인다**(아래 참고) | `worker/flatworker/lineage.py` |

> **`fused_mesh_smoothed`만 출처가 엔진이 아니다.** 계보는 점군에서 도출되는 값이 아니라 업로드할 때
> 사람이 고른 DB 메타데이터이고(`scans.lineage`, 자동 감지는 미구현 — `docs/service-report.md` 6.5절),
> 엔진은 DB를 모른다(`grep -rn lineage engine/`가 0건인 것이 이 경계의 증거다). 그래서 이 코드만
> `stats.json` **산출물에는 없고** DB의 `analyses.stats.warnings`·`analyses.warnings`에만 실린다 —
> 저장소의 `stats.json`은 "엔진이 낸 것"이라는 계약이라야 재현·대조가 성립하기 때문이다.
> 화면(`verdict-panel.tsx` 등)과 보고서(`report/context.py`: "analyses.stats(DB 저장본이 정본)")는
> 둘 다 DB를 읽으므로 표시에는 차이가 없다. 엔진 산출물만 대조하는 소비자는 이 코드를 보지 못한다.

소비자 구현 참고: `wall_{i}_skipped`는 정규식 `^wall_\d+_skipped$`(또는 `startswith("wall_") and endswith("_skipped")`)로 매칭해야 한다
— CLI/요약 생성기도 이 방식을 쓴다(`outputs/summary.py:51-52`).

렌더 실패 경고(`heatmap_render_failed`·`preview3d_render_failed`·`deviation_render_failed`)는 벽 여러 개에서 동시에
발생해도 코드 하나로만 남는다(어느 벽인지는 구분하지 않음) — `warnings`는 `set`이므로 중복 없이 한 번만 기록된다.
파일이 없거나 `*_paths`에서 빠진 이유가 렌더링 인프라 문제인지는 **대응하는 `*_render_failed` 경고의 유무로만** 판별한다
- 경고가 없다면 스킵된 벽·유효 잔차 없음·확대 반경 내 점 없음 같은 정상적인 미생성 사유다.

## 6. 산출물 파일 규약

| 파일 | 경로 | 내용 |
|---|---|---|
| `stats.json` | floor·wall·import | 본 문서의 스키마(`json.dumps(..., indent=2)`) |
| `cells.json` | floor·wall·import | 셀별 행 배열(zone_id 포함, 아래 표) |
| `results.csv` | floor·wall·import | `cells.json`과 동일한 행을 CSV로(헤더 순서 아래 표와 동일) |
| `heatmap.png` | floor·import | 단일 등급 히트맵 |
| `heatmap_wall{n}.png` | wall | 벽별 히트맵. `n`은 `wall_id`와 동일 채번 — **결번 원인 2가지**: (a) 스킵된 벽(`wall_{n}_skipped` 경고 동반, `walls[]`에도 없음), (b) 판정은 성공했으나 렌더만 실패(`heatmap_render_failed` 경고 동반, `walls[]`에는 있음). 파일 존재로 스킵 여부를 추론하지 말고 `walls[]`와 `warnings`로 판별한다 |
| `preview3d.png` | floor | 3D 편차 프리뷰(전체) |
| `preview3d_zoom.png` | floor(조건부) | 최댓값 지점 반경 1.5m 확대. 반경 내 점이 없으면 생성 안 됨 |
| `deviation.png` | floor | 정밀 편차맵(10cm 해상도, 0mm 중심 대칭 연속 색상). 판정 히트맵과 별개의 보조 시각화 |
| `deviation_wall{n}.png` | wall | 벽별 정밀 편차맵. `n`은 `wall_id`와 동일 채번 — **스킵된 벽은 파일 자체가 생성되지 않음(결번)** |

> **정밀 편차맵 읽는 법**: 1m 판정 셀·5등급 이산색인 히트맵과 달리 10cm 격자의 원시 편차(mm)를 연속 색상으로 칠한다.
> 0mm가 중앙(연노랑), 붉을수록 융기(벽은 돌출), 초록일수록 침하(벽은 함몰)이며 스케일은 ±최대 절대편차로 대칭이다.
> 데이터가 없는 셀은 회색(`#e8e8e8`)이다. **등급 산출에는 관여하지 않는다** — 이 파일이 없어도 stats의 판정 결과는 동일하다.
> 생성 여부는 §2의 `deviation_paths`로 판별한다(파일 존재를 가정하지 않는다).

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

> **구현 상태 갱신(코드리뷰 Important I3, 이전 버전은 "미구현·P4/P5 백로그"라고 적었으나 실제로는 구현 완료됨)**:
> "범용 프로그램 결과 JSON 임포트"는 **구현이 끝났다** — `engine/flatness/importer/json_import.py`의 `import_json()`이
> 아래 계약을 그대로 소비한다(워커 배선은 `worker/flatworker/jobs.py`의 `_IMPORT_HANDLERS = {".csv": import_colab_csv,
> ".json": import_json}`, `handle_import`가 확장자로 분기). 실제 산출 `stats.meta`는 `engine_version="external-json-v1"`,
> `source="json-import"`를 쓴다(§7.2에 상세). 아래는 여전히 이 임포트의 **계약 정본**이며, 스키마를 바꾸려면 먼저 이
> 문서를 갱신해야 한다.

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
| `surface` | `"floor"` | — | 필수 | CSV 임포트와 동일하게 **바닥 전용**으로 구현됨(`importer/json_import.py`의 `_SUPPORTED_SURFACE = "floor"` — 다른 값이면 스키마 오류로 거부). `"wall"`은 스키마상 예약만 해둔 값이며 실제로는 아직 지원하지 않는다 |
| `points` | array | — | 필수 | 최소 1개 이상 |
| `points[].x` | number | m(미터) | 필수 | 평면 X 좌표 |
| `points[].y` | number | m(미터) | 필수 | 평면 Y 좌표 |
| `points[].deviation_mm` | number | mm(밀리미터) | 필수 | 이미 평면 제거가 끝난 최종 편차값(부호 규약은 소스 프로그램 정의를 따르며, 엔진은 이 값을 그대로 서브셀 중앙값 입력으로 사용 — CSV 경로의 `Signed_Distance_mm`과 동일 역할) |
| `meta.source_program` | string | — | 권장 | 원 분석 프로그램 식별자(자유 문자열) |
| `meta.measured_at` | string | `YYYY-MM-DD` | 권장 | 측정일자 |

**CSV(colab) vs JSON(범용) 두 임포트 경로**: CSV 경로(`importer/colab_csv.py`)는 기존 Colab 노트북이 뱉는 고정 컬럼
(`X,Y,Z,Distance_mm,Signed_Distance_mm,R,G,B,Is_Uneven` 중 `X,Y,Signed_Distance_mm`만 사용)을 그대로 소비하는 레거시 호환
경로다. JSON 경로(`importer/json_import.py`)는 CSV 컬럼 규약에 매이지 않는 외부 프로그램 전반을 위한 범용 계약이다.
**(구현 완료, I3 갱신)** 두 경로 모두 포맷별 파서(`colab_csv._load`/`json_import._load`)만 다르고, 판정 로직은
`importer/common.py`의 공용 함수 `run_import_pipeline`(서브셀 중앙값 → `evaluate_cells` → `grade_cells`)으로 완전히
합류한다 — 같은 편차 데이터를 CSV/JSON 두 경로로 각각 임포트하면 메타(포맷별 `engine_version`/`source` 표기 차이)를
제외하고 동등한 `stats`가 나온다는 계약이 코드 구조로 보장된다. `stats.meta`는 §2의 import 경로 규약
(`scale_to_m`/`bbox_min` 없음, `source` 키 존재)을 그대로 따르되, `engine_version`/`source` 값 자체는 경로별로 다르다
(CSV: `"external-colab-v1"`/`"colab-import"`, JSON: `"external-json-v1"`/`"json-import"` — §7.1·§7.2 참고).

### 7.1 참고: 현재 구현된 CSV(colab) 임포트 계약

- 필수 컬럼(대소문자 구분): `X`, `Y`, `Signed_Distance_mm`. 그 외 컬럼은 무시(`importer/colab_csv.py:21-23`)
- 인코딩 `utf-8-sig`, 헤더 필수. 파싱 불가 행은 건너뜀(`importer/colab_csv.py:26-31`)
- `Signed_Distance_mm`는 이미 평면 제거된 편차(mm) → 내부적으로 `/1000`해 m로 변환 후 서브셀 z값으로 사용(`importer/colab_csv.py:35`)
- 유효 행 0개 또는 유효 서브셀 10개 미만이면 `ValueError`(`importer/colab_csv.py:33-34,42-43`, 후자는 공용
  `run_import_pipeline`의 검사)
- `stats.meta.engine_version = "external-colab-v1"`, `stats.meta.source = "colab-import"`(`importer/colab_csv.py:34`)

### 7.2 참고: 현재 구현된 JSON(범용) 임포트 계약 (I3 신설 — 구현 파일: `engine/flatness/importer/json_import.py`)

- 최상위 필수 키: `format`(정확히 `"flatness-import-v1"`이어야 함) · `surface`(정확히 `"floor"`) · `points`(배열, 최소
  1개) — 하나라도 어긋나면 스키마 불일치 `ValueError`로 즉시 거부(`json_import.py:32-46`, `_validate_top_level`)
- 인코딩 `utf-8-sig`. JSON 파싱 자체가 실패해도 같은 스키마 불일치 오류로 감싸 보고(`json_import.py:49-54`)
- `points[]` 원소별 필수 키: `x`/`y`/`deviation_mm`. 키 누락, 숫자로 변환 불가, 또는 `NaN`/`Inf`인 원소는 조용히
  건너뛴다(예외를 던지지 않음 — CSV 경로의 "파싱 불가 행 skip"과 동일 관용, `json_import.py:58-70`)
- 위 필터를 통과한 유효 포인트가 0개, 또는 유효 서브셀이 10개 미만이면 `ValueError`(전자는
  `json_import.py:71-72`, 후자는 CSV와 공유하는 `importer/common.py`의 `run_import_pipeline` 검사)
- `deviation_mm`은 CSV의 `Signed_Distance_mm`과 동일 역할(이미 평면 제거된 편차) → 내부적으로 `/1000`해 m로 변환 후
  서브셀 z값으로 사용(`json_import.py:73`)
- `meta.source_program`/`meta.measured_at`은 입력 JSON에 있으면 그대로 통과시키고, 없으면 `null`(`json_import.py:83-84`)
  — 판정 로직에는 관여하지 않는 참고용 메타데이터
- `stats.meta.engine_version = "external-json-v1"`, `stats.meta.source = "json-import"`(`json_import.py:81-82`) —
  대시보드는 이 두 값(또는 CSV 쪽 동급 값)으로 "외부 결과" 배지를 판별한다(`dashboard/lib/domain/stats.ts`의
  `isExternalImport`)

## 8. 구배(slope) stats 계약 (`slope-stats-v1`, 세부과업 4)

구배는 §0~§7의 `build_stats()` 공통 계약과 완전히 별개다 - 분석 단위(2m 격자 vs 1m 판정셀)·판정 철학("설계
구배대로인가" vs "평면에서 얼마나 벗어났나")·산출 파일 구성이 전부 다르다. 이 절은 `judge_slope_cells`
(`core/pipeline.py:171-277`)가 쓰는 4개 산출물(`slope_stats.json`·`slope_cells.json`·`slope_judged.json`·
`slope_cells.csv`)과 `slope_map.png`의 계약을 다룬다.

### 8.0 두 진입점, 한 작성자

| 호출 경로 | 함수 | 언제 | 점군을 다시 읽는가 |
|---|---|---|---|
| 최초 분석 | `analyze_slope` | 워커의 `_handle_analyze_slope`(`worker/flatworker/jobs.py:121`, 잡 타입 `analyze`) | 읽는다 |
| 재판정(§7.3) | `judge_slope_cells` | 워커의 `handle_slope_judge`(`worker/flatworker/jobs.py:171`, 잡 타입 `slope_judge`) | 안 읽는다 - `slope_cells.json`만 읽는다 |

`analyze_slope`는 점군 → `compute_slope_cells`(`core/slope.py:36`)로 셀을 산출한 뒤 `judge_slope_cells`를
그대로 호출해 판정~산출물 단계를 위임한다(`core/pipeline.py:310-312`). 따라서 아래 스키마는 최초 분석이든
재판정이든 **동일한 함수가 동일한 형태로** 쓴다 - 최초 분석 전용 필드나 재판정 전용 필드가 따로 없다.

### 8.1 `slope_stats.json` 최상위 키

`judge_slope_cells`가 매 호출(최초 분석·재판정 둘 다)마다 통째로 새로 쓴다(`core/pipeline.py:262-276`).

| 키 | 타입 | 설명 |
|---|---|---|
| `format` | string | 고정값 `"slope-stats-v1"`. 대시보드의 `isSlopeStats`(`dashboard/lib/domain/stats.ts:9-12`)가 이 값 하나로 구배/평활도를 가른다 |
| `cell_m` | number | 판정 격자 한 변(m). 기본 2.0. 재판정은 `slope_cells.json`의 `cell_m`을 그대로 이어 쓴다(§8.2) |
| `subcell_m` | number | 서브셀 한 변(m). 기본 0.05 |
| `threshold` | object | 적용 기준 원본(`{use, design_pct, pass_pct, re_pct, dir_pass_deg}`, `criteria.thresholds[0]` 그대로). floor/wall/import의 `applied_criteria`(§1)와 달리 `name`/`source`가 없다 - 그 둘은 `analyses.applied_criteria` DB 컬럼(워커가 별도로 채움, 8.7 참고)에만 있다 |
| `summary` | object | §8.1.1 |
| `direction_judged` | boolean | 배수구 좌표가 있어 방향(역구배) 판정까지 했는지. `false`면 크기만 판정된 것 - 화면은 이 값으로 역구배 강조를 켤지 정한다 |
| `drain_points` | `[number, number][] \| null` | 판정에 쓰인 배수구 좌표(호출자가 넘긴 순서 그대로, 소수 3자리 반올림만 됨 - `core/pipeline.py:265-266`에 `sorted(`는 쓰이지 않는다). §3.5의 `{"x":..,"y":..}` 형태가 아니라 좌표쌍 배열이다 - 워커의 `drain_points_from_stats`(`worker/flatworker/slope.py:43-59`)가 §3.5 형태로 역변환한다 |
| `warnings` | string[] | **완성된 한국어 문장**이다(floor/wall/import의 ASCII 슬러그 + `WARNING_LABEL` 번역 관례와 다르다 - 코드 기반 필터링 불가, 백로그 기록됨) |
| `artifacts` | object | §8.1.2 |

#### 8.1.1 `summary` (`core/slope.py`의 `slope_summary` 반환값, §5.4 요건)

| 키 | 타입 | 설명 |
|---|---|---|
| `mean_dev_pct` / `std_dev_pct` / `max_dev_pct` | number \| null | 판정 가능(등급 ≠ 판정불가) 셀의 설계 구배 대비 편차(%p) 평균·표준편차(모집단, ddof=0)·최댓값. 전 셀 판정불가면 `null` |
| `counts` | `{적합, 경계, 보수, 재시공, 판정불가}` → int | 등급별 셀 개수(5키 항상 존재) |
| `coverage_pct` | number | `100 * (전체 - 판정불가) / 전체`(전체 0이면 `0.0`) |

**전역 통계뿐이다.** §5.4가 요구하는 구간(구역)별 평균·표준편차·최대편차는 이번 단계(세부과업 4 단계 D)에서
구현하지 않았다 - 백로그 참고(`docs/superpowers/plans/2026-07-28-p1b-backlog-notes.md`).

#### 8.1.2 `artifacts`

| 키 | 필수 | 설명 |
|---|---|---|
| `cells_json` | 조건부 | `slope_cells.json` 경로(§8.2). **현재 엔진은 이 키를 항상 채운다** - `judge_slope_cells`는 `cells_json_path` 인자가 없으면 `out_dir/slope_cells.json` 관례로 채워 넣는다(`core/pipeline.py:215-216`). **세부과업 4 단계 C까지 만들어진 분석에는 이 키 자체가 없는데**, 그건 이 값이 조건부로 비는 코드 분기가 있어서가 아니라 **그 시점 엔진 자체가 이 산출물을 아예 만들지 않았기 때문**이다(`slope_cells.json`은 D1에서 신설된 산출물). 대시보드는 이 키의 부재로 "재판정 불가"를 판별한다(`dashboard/lib/domain/slope-cells.ts:41-44`의 `slopeCellsJsonUrl`이 `null` 반환) |
| `judged_json` | 조건부 | `slope_judged.json` 경로(§8.3). `cells_json`과 항상 함께 있거나 함께 없다(같은 판정 호출에서 나온다) |
| `cells_csv` | 항상 | `slope_cells.csv` 경로(§8.5). **기계 판독 금지** - 아래 참고 |
| `map_png` | 항상 | `slope_map.png` 경로. matplotlib이 그린 정적 이미지(§8.6). 대시보드는 재판정 가능한 분석(`cells_json`/`judged_json`이 있는 분석)에서는 이 이미지를 화면에 전혀 노출하지 않는다 - Canvas로 다시 그린 히트맵만 보여준다(`components/analysis/slope-result.tsx`, D3 설계 결정). `cells_json`이 없는(재판정 불가) 분석의 안내 화면에서만 이 PNG를 폴백으로 보여준다(`slope-result.tsx:168-176`) |

### 8.2 `slope_cells.json` (재판정 입력, 무손실 왕복, `schema_version=2`)

`analyze_slope`가 판정 이전에 쓰고(`core/pipeline.py:306-308`), 이후로는 아무도 다시 쓰지 않는다(§7.3 재판정은
이 파일을 **읽기만** 한다). `engine/flatness/outputs/slope_cells.py`의 `dump_slope_cells`/`load_slope_cells`가
왕복을 담당한다.

| 키 | 타입 | 설명 |
|---|---|---|
| `schema_version` | int | 현재 2(1에서 `cell_m`/`subcell_m` 최상위 키가 추가됨) |
| `engine_version` | string | 이 셀 벡터를 산출한 엔진 빌드(`ENGINE_VERSION`). **재판정은 이 값을 검사하지 않는다** - `grade_slope_cells` 판정 로직이 엔진 버전 사이에 안정적이라는 전제다(한계는 `slope_cells.py:83-88` 참고) |
| `cell_m` / `subcell_m` | number | 원 분석의 격자 파라미터. 재판정이 이 값을 그대로 이어 써야 조각 셀 판정불가 분기(`width_m < cell_m/2`)와 화살표 길이가 원 분석과 일치한다(Task 1 리뷰 I1) |
| `cells` | array | `SlopeCell` 13필드(`core/slope.py:20-33`) 그대로, **반올림 없음**. 아래 표 |

`cells[]` 원소(= `SlopeCell` 데이터클래스 필드, `core/slope.py:20-33`):

| 필드 | 타입 | 설명 |
|---|---|---|
| `cx` / `cy` | int | 셀 격자 인덱스 |
| `center_x` / `center_y` | number | 셀 중심 절대 좌표(m). floor와 같은 좌표 프레임(§4.1) - `grid.origin`(=`bbox_min`의 xy) 기준으로 복원되므로 역매핑 없이 그대로 X/Y로 쓴다 |
| `n_subcells` | int | 셀 내 유효 서브셀 개수 |
| `slope_pct` \| `null` | number \| null | 구배 크기(%). `ok=false`면 `null`(엔진 내부에서는 NaN, JSON 직렬화 시 null로 치환) |
| `downhill_rad` \| `null` | number \| null | 내리막 방향(라디안, matplotlib 데이터 좌표계 - y 위로 증가). `ok=false`면 `null` |
| `rmse_m` \| `null` | number \| null | 평면 피팅 잔차 RMSE(m). `ok=false`면 `null` |
| `se_pct` \| `null` | number \| null | 기울기 표준오차(%p). `ok=false`면 `null` |
| `width_m` / `height_m` | number | 셀의 **실제** 폭·높이(m). 바닥 크기가 `cell_m`의 배수가 아니면 가장자리 조각 셀에서 명목 `cell_m`보다 작다. **`correction_mm` 환산과 화살표 렌더가 명목 `cell_m`이 아니라 이 값을 쓴다** - CSV 근사 복원이 이 값을 잃어 판정을 왜곡시켰다(D1) |
| `ok` | boolean | 이 셀에 평면을 피팅할 수 있었는지(`false`면 위 4개 수치 필드가 전부 `null`) |
| `zone_id` | int \| null | **항상 `null`**(이번 단계 스코프 아님, §8.1.1의 구역별 통계 미구현과 같은 사유). 위치 인자로 `SlopeCell`을 생성하는 6곳(`core/slope.py:73,84,91,107` 및 테스트 2곳)이 깨지지 않도록 **기본값 있는 마지막 필드**로 미리 뚫어 두었다 |

`slope_pct`/`downhill_rad`/`rmse_m`/`se_pct` 네 필드만 `ok=false`일 때 `null`이 될 수 있다(`outputs/slope_cells.py`의
`_NAN_FIELDS`) - `zone_id`의 `null`은 "판정불가"가 아니라 "구역 기능 미구현"이라는 별개의 의미다.

### 8.3 `slope_judged.json` (판정 결과 전용, `schema_version=1`)

`slope_cells.json`이 담지 않는 판정 결과(`grade`/`dev_pct`/`correction_mm`/`dir_err_deg`/`reason`)만 담는
별도 파일이다. **매 판정(최초 분석·재판정 둘 다)마다 통째로 다시 쓰인다** - 그래서 `slope_stats.json`·
`slope_cells.json`과 시점이 어긋나는 이중 진실이 될 수 없다(같은 `judge_slope_cells` 호출 안에서 함께 나온다).

| 키 | 타입 | 설명 |
|---|---|---|
| `schema_version` | int | 현재 1 |
| `direction_judged` | boolean | `slope_stats.json`의 동명 키와 항상 같은 값(같은 호출에서 나옴). 화면이 `slope_stats.json`을 따로 fetch하지 않고 이 파일 하나로 역구배 강조 여부를 결정할 수 있게 중복 저장 |
| `cells` | array | 아래 표. **셀 식별자는 배열 순서가 아니라 `(cx, cy)` 키다** - 대시보드는 `slope_cells.json`과 이 파일을 `(cx, cy)`로 조인한다(`dashboard/lib/domain/slope-judged.ts`의 `joinSlopeCells`), 배열 길이·순서 일치를 가정하지 않는다 |

`cells[]` 원소(`grade_slope_cells` 반환, `core/slope.py:126-186` → `outputs/slope_judged.py:59-70`):

| 필드 | 타입 | 설명 |
|---|---|---|
| `cx` / `cy` | int | `slope_cells.json`의 같은 셀과 짝짓는 키 |
| `grade` | `적합\|경계\|보수\|재시공\|판정불가` | 한국어 등급 문자열(§8.1의 `counts` 키와 동일 어휘) |
| `reason` | string | 판정 사유 한국어 문장(예: `"역구배(물이 배수구 반대로 흐름)"`, `"격자 가장자리 조각 셀(폭 또는 높이가 부족해 baseline 짧음)"`). 대시보드는 `reason.startsWith('역구배')`로 역구배 셀을 판별한다(`slope-judged.ts:73`) - 판정 로직이 아니라 이미 계산된 문자열 매칭일 뿐이므로 §7.3 금지(판정 이중화)에 해당하지 않는다 |
| `dev_pct` \| `null` | number \| null | 설계 구배 대비 편차(%p 절댓값). 판정불가 셀은 `null` |
| `dir_err_deg` \| `null` | number \| null | 기대 방향과의 각도 오차(도). 배수구가 없거나(방향 미판정) 판정불가면 `null` |
| `correction_mm` \| `null` | number \| null | 보정 높이차(mm, §5.3). `d * min(width_m, height_m) * 10.0` - 알려진 한계(정사각 셀 밖에서 과소 보고 가능)는 백로그 티켓 60 참고. 판정불가 셀은 `null` |

### 8.4 `slope_cells.json`/`slope_judged.json` 역할 분리 이유

**입력(무손실)과 출력(파생값)을 분리했다.** `slope_cells.json`은 재판정이 점군을 다시 읽지 않고 같은 답을
내기 위한 **원본**이다 - 반올림이나 파생 계산이 조금이라도 섞이면 재판정이 최초 분석과 다른 결과를 낼 수
있다(D1이 CSV 근사 복원을 배제한 이유이기도 하다: 판정 경계에 걸터앉은 바닥 20개 중 11개에서 등급이
뒤집혔다). 반대로 `slope_judged.json`은 판정할 때마다(배수구를 다시 클릭할 때마다) 통째로 다시 계산되는
**파생 결과**다 - 이 값들을 입력 파일에 같이 담으면 "이전 판정의 결과가 남아있는 입력 파일"이라는 이중
진실이 생긴다. 그래서 입력은 절대 다시 쓰지 않고(재판정이 값을 읽기만 함), 출력은 매번 통째로 새로 쓴다
(부분 갱신이 없으므로 새·옛 값이 섞이는 경합도 없다).

### 8.5 `slope_cells.csv` - 사람용 export, 기계 판독 금지

`judge_slope_cells`가 매 판정마다 함께 쓰는 사람이 엑셀로 여는 산출물이다(`core/pipeline.py:221-237`).
**`slope_cells.json`과 다음 세 가지가 다르다:**

1. **인코딩이 `utf-8-sig`(BOM)다** - 평활도의 `results.csv`는 `utf-8`이다. BOM을 모르고 파싱하면 첫 열 이름이
   `﻿cx`로 읽히는 함정이 있다.
2. **반올림된 값이다** - `slope_pct`·`dev_pct`·`correction_mm`은 소수 3자리(`_r`), `downhill_deg`·`dir_err_deg`는
   소수 1자리(`_deg`)로 반올림된다. **실측: 판정 경계에 걸터앉은 바닥 20개 중 11개에서 이 반올림이 최소
   1셀의 등급을 뒤집었다**(D1 실측, `docs/superpowers/sdd/2026-08-03-slope-phase-d/task-6-brief.md` D1 참고).
3. **`width_m`/`height_m`이 열 끝에만 추가돼 있다**(기존 엑셀 사용자의 열 위치를 보존하기 위해) - 앞쪽 열
   순서(`cx, cy, center_x_m, center_y_m, n_subcells, slope_pct, downhill_deg, dev_pct, dir_err_deg,
   correction_mm, rmse_mm, se_pct, grade, reason`)는 그대로다.

**결론: `slope_cells.csv`는 사람이 눈으로 확인하는 용도로만 쓴다. 재판정·화면 렌더·후속 배치 처리 등 어떤
기계 판독 소비자도 이 CSV 대신 `slope_cells.json`(§8.2)·`slope_judged.json`(§8.3)을 읽어야 한다.**

### 8.6 `slope_map.png`

`render_slope_map`(`engine/flatness/outputs/slope_map.py:26-64`)이 그리는 정적 이미지 - 등급 색 배경 사각형 +
내리막 방향 화살표(역구배 셀은 굵은 화살표). 색표는 대시보드 Canvas 렌더러(`dashboard/lib/domain/slope-heatmap.ts`의
`SLOPE_GRADE_COLOR`)와 **독립적으로 유지되지만 우연이 아니라 의도적으로 같은 hex 값**을 쓴다
(`적합 #3d8b3d`·`경계 #d6c11e`·`보수 #e07b1a`·`재시공 #c0392b`·`판정불가 #9e9e9e`) - 같은 판정 결과가 두 렌더러
사이에서 다른 색으로 보이면 안 되기 때문이다. **다만 판정 로직 자체는 완전히 파이썬 한 곳(`grade_slope_cells`)
에만 있다** - PNG는 이미 계산된 `grade` 문자열을 색으로 옮기기만 한다(§7.3 리트머스: 이 파일에도, Canvas
렌더러에도 `pass_pct`/`re_pct`/`dir_pass_deg` 같은 임계값 비교가 등장하지 않는다).

이미지에는 좌표계 정보가 없고(`tight_layout`·`dpi=120`이라 여백이 가변) 클릭 좌표를 미터로 환산할 수
없어, 배수구 클릭이 필요한 화면에서는 이 PNG 대신 Canvas가 `slope_cells.json`으로 히트맵을 다시 그린다
(§8.1.2 참고). **알려진 한계**: `render_slope_map` 호출(`core/pipeline.py:239`)이 try/except로 격리돼 있지
않다 - 렌더가 실패하면 `judge_slope_cells` 전체가 예외로 끝나 `slope_stats.json`/`slope_judged.json`도
쓰이지 않는다(백로그 참고).

### 8.7 구배의 `engine_version` 경로 - `slope_stats.json`에는 없다

floor/wall/import와 달리 `slope_stats.json`에는 `meta` 키 자체가 없어 `stats.meta.engine_version` 경로가
존재하지 않는다. 구배의 엔진 버전은 두 곳에 따로 있고 **서로 갱신 시점이 다르다**:

- **`analyses.engine_version`(DB 컬럼)** - 워커가 최초 분석(`analyze` 잡) 성공 시 `ENGINE_VERSION`을 직접
  써 넣는다(`worker/flatworker/slope.py:201`, `run_slope_analysis`의 `fields["engine_version"]`). **재판정
  (`slope_judge` 잡)은 이 필드를 갱신하지 않는다** - `build_slope_judge_fields`(`worker/flatworker/slope.py:166-172`)가
  반환하는 필드 dict에 `engine_version` 키가 없고, `update_analysis`의 PATCH는 넘긴 필드만 갱신하므로
  DB에는 최초 분석 시점의 값이 그대로 남는다.
- **`slope_cells.json`의 `engine_version`(§8.2)** - 셀 기하를 산출한 엔진 빌드. 재판정은 이 값을 검사하지
  않지만 참고용으로 노출된다.

같은 이유로 `analyses.applied_criteria`(DB 컬럼, `{name, source, ...threshold}` 형태)도 재판정 후
`slope_stats.json.threshold`(§8.1의 원본 기준 값)와 어긋날 수 있다 - 재판정은 기준을 다시 읽어
`stats.threshold`는 최신이지만 `applied_criteria`는 최초 분석 시점 그대로다. 기준 자체를 바꾸지 않는 한
값이 같아 보통은 드러나지 않지만, 기준 개정 이후 재판정하면 두 필드가 서로 다른 시점의 기준을 가리키는
모순 상태가 된다(백로그 기록됨).

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

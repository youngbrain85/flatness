# 판정 셀 0.5/1/2m · 정밀 편차맵 화면 렌더 · 시험판 지원 구현 계획

> 스펙: `docs/superpowers/specs/2026-10-19-precision-cells-and-sample-design.md`. 사용자 선호(간단하게, 끝까지)에 따라
> 짧은 계획으로 쓰고 컨트롤러가 TDD로 직접 실행한다. 각 태스크: 실패 테스트 → 구현 → 통과 → 변이 확인 → 커밋.

**Goal:** 공식 판정 셀 0.5m + 1·2m 비교, 5cm 잔차 격자의 화면 편차맵(5/10/20cm), 어두운 높이 그림, SiteScape 시험판 분석.

## Global Constraints
- 브라우저는 등급을 계산하지 않는다(셀 등급은 엔진 값). DB 스키마·워커 잡 흐름·PDF 양식·구배 무변경.
- 산출물 계약: `cells_alt.json = {"by_size": {"1.0": [cell rows], "2.0": [cell rows]}}`,
  `residual_grid.json = {"subcell_m", "cols", "rows", "values"(0.1mm 정수|null, 행 우선, 행0=y최소)}`,
  stats 에 `cells_alt_path`·`residual_grid_path`(파일명)를 적는다. 없으면 화면은 옛 표시로 대체.
- 색은 토큰·팔레트 상수만(대시보드), em dash 금지, 한국어 주석.

## Tasks
1. **엔진 리더 축(SiteScape y-up):** `engine/flatness/io/ply_reader.py` 헤더 주석에 `SiteScape` → `(x,−z,y)`.
   테스트 `engine/tests/test_ply_reader.py`: SiteScape 주석 PLY는 z가 원래 y, 아닌 PLY는 그대로.
2. **엔진 작은 시편:** `engine/flatness/core/pipeline.py` — 1㎡ 구역이 없고 최대 덩어리가 유효 서브셀 80%↑면
   `build_zones(min_area_m2=0)` 결과 채택 + 경고 `small_specimen`. 테스트: 40cm 합성 판 분석 성공·경고, 흩어진
   파편(최대 덩어리 80% 미만)은 지금처럼 실패.
3. **엔진 판정 셀 3크기 + 잔차 격자:** `analyze_floor` 기본 `cell_m=0.5`, 1·2m 를 `cells_alt.json`, 5cm 잔차를
   `residual_grid.json`(stats 에 경로). 테스트: 파일 모양·값(0.1mm 정수·null)·행 방향, 0.5 공식값.
4. **엔진 높이 그림 투명·점 크기:** `render_height_view` 투명 바탕·밝은 글자, NaN 투명. `sample_points` 의
   표본 칸 변을 `sqrt(점유면적 / min(상한, 점 수))`. 테스트: 알파 채널, 점이 적은 입력의 표본 칸 변.
5. **워커:** 바닥 분석 호출 그대로(엔진 기본 0.5)·산출물 업로드는 폴더 통째라 무변경 — 워커 테스트로 cell_m 0.5 확인.
6. **대시보드 셀 전환:** `analysis-result.tsx`가 `cells_alt_path` 있으면 불러와 0.5/1/2m 전환(히트맵·HUD),
   "판정은 0.5m 기준" 안내. 테스트: 전환·없을 때 숨김·KPI 불변.
7. **대시보드 편차맵 캔버스:** `lib/viz/deviation-grid.ts`(평균 축소·색 범위·색) + `deviation-view.tsx` 캔버스,
   5/10/20cm 전환, 범례, 없으면 PNG 대체. 테스트: 순수 함수 값, 전환, 대체.
8. **검증·배포·운영 데이터:** 전체 테스트·빌드, 로컬 엔진으로 시험판 분석 확인, 리뷰 1회, 머지·푸시, 운영 기존
   분석·보고서 soft delete, 샘플 현장·스캔 올려 분석 완료 확인.

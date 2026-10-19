# 바닥 기준면 개선 구현 계획

> 스펙: `docs/superpowers/specs/2026-10-20-floor-reference-surfaces-design.md`. 사용자 선호(간단하게, 끝까지)에 따라 짧은 계획으로
> 쓰고 컨트롤러가 TDD 로 직접 실행한다. 각 태스크: 실패 테스트 → 구현 → 통과 → 변이 확인 → 커밋.

**Goal:** 연속성 구역 나누기 + 국부(3m)/전체 기준면 + 편차맵·3D 기준 전환과 3D 기준면 표시. 판정 방식 무변경.

## Global Constraints
- 이웃 서브셀 높이차 1.5cm 이하 = 같은 면. 국부 창 3m(한 변 61칸), 2회 맞춤 문턱 max(3mm, 3σ), 창 유효 칸 30 미만 → 구역 평면 값.
  σ = 국부 1회차 잔차 MAD x 1.4826. 전체 기준 RANSAC 문턱 max(5mm, 3σ).
- 판정(evaluate_cells)은 구역 평면 잔차 그대로. cells·cells_alt·stats 수치 형식 그대로.
- residual_grid.json v2 = `values`(국부) + `values_global` + `schema_version: 2`. reference_surfaces.json = `step_m 0.25, cols, rows,
  local, global`(0.1mm 정수|null, 파일-로컬 좌표틀). stats `reference_surfaces_path`.
- 화면 색은 토큰·팔레트 상수만, 국부 기준면 흰색·전체 파랑, 초록 금지. em dash 금지, 한국어 주석.

## Tasks
1. **엔진 구역 나누기:** `core/zones.py` `build_zones(grid, min_area_m2=1.0, step_m=0.015, ...)`(levels 인자 삭제, 연결 요소 =
   4방향 이웃 높이차 ≤ step_m, 평면 추종 성장 삭제), `core/levels.py`·`tests/test_levels.py` 삭제, pipeline·pointsample 테스트
   호출부 갱신. 테스트: 16m 2.5%·3% 한 구역, 15cm 단차 두 구역, 1cm 턱 한 구역 + 기존 구역 테스트 유지.
2. **엔진 기준면:** 새 `core/reference.py` `local_reference(median_z, labels, zone_ids, zone_planes, size_m, win_m=3.0)`·
   `noise_sigma(res)`·`global_plane(median_z, mask, size_m, sigma)`. 테스트: 처짐 10mm 국부 편차 ±2mm·함몰 보존, 창 부족 대체,
   전체 기준이 단차를 드러냄.
3. **엔진 산출물:** pipeline 에서 국부/전체 편차 계산, deviation PNG·preview3d·points3d 를 국부 기준으로, residual_grid v2,
   reference_surfaces.json, stats 경로, 계약 문서. 워커 보고서 편차맵 캡션 문구. 테스트: 파일 모양·좌표틀·국부 기준 사용.
4. **대시보드 편차맵 기준 전환:** `deviation-grid.ts` v2 파싱(`values_global`), `deviation-view.tsx` `기준면 [국부][전체]`, 옛 형식.
5. **대시보드 3D 기준면:** reference_surfaces 파싱·쌍선형 보간·점 편차 재계산(순수 함수), 렌더러에 반투명 면 프로그램,
   뷰어 도구 줄 `기준면 [국부][전체]` + `국부 기준면 보기`·`전체 기준면 보기`, 범례, 없으면 숨김.
6. **검증·배포:** 전체 테스트·빌드, 로컬 캡처(1440·390), 리뷰 1회, 머지·푸시, 운영 샘플 재분석.

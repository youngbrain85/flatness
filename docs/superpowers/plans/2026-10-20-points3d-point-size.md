# 3D 프리뷰 점 크기 메뉴 구현 계획

> 스펙: `docs/superpowers/specs/2026-10-20-points3d-point-size-design.md`. 사용자 선호(간단하게, 끝까지)에 따라 짧은 계획으로
> 쓰고 컨트롤러가 TDD 로 직접 실행한다. 각 태스크: 실패 테스트 → 구현 → 통과 → 변이 확인 → 커밋.

**Goal:** 3D 프리뷰 맵 왼쪽 위 `점 크기 − ×1 +`, 지금 크기를 ×1 기본으로 ×0.25~×4 8단계.

## Global Constraints
- 배율 단계 `[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]`, 기본 1. 끝 단계에서 그쪽 버튼 disabled.
- 점 실제 크기(m) = 0.55 x sample_cell_m x 배율. 최소 px = max(1, 1.5 CSS px x 버퍼 배율 x 배율), 최소·최대 모두 장치 상한 이하.
- 뷰어 색은 POINTS3D_THEME 인라인 style, 크롬은 토큰 클래스. 버튼 44px 이상. em dash 금지, 한국어 주석.

## Tasks
1. **budget.ts 순수 함수:** `POINT_SCALES`, `stepPointScale(scale, dir: -1 | 1): number`(끝에서 그대로),
   `pointSizeRange(aliasedRange, bufferScale, pointScale = 1)` 가 최소 px 에 배율을 곱하고 1 버퍼 px 아래로 내려가지 않게.
   테스트 `lib/viz/points3d/__tests__/budget.test.ts`.
2. **points3d-view.tsx 메뉴:** 상태 `pointScale`(viewRef 에 실어 uniform 만 바꾸고 다시 그림), 맵 왼쪽 위
   `role=group aria-label="점 크기"` 안에 이름·−·`×k`·+ (HUD 와 같은 반투명 바탕). draw 가 `pointWorldM x 배율`과
   `pointSizeRange(..., 배율)` 를 넘긴다. 테스트 `components/analysis/__tests__/points3d-view.test.tsx`: 기본 ×1,
   +/− 로 uPointWorldM·uMinPx 변화, 끝 단계 disabled, 버튼 수 단언 갱신.
3. **검증·배포:** 전체 vitest·tsc·lint·build, 로컬 캡처(1440·390), 리뷰 1회, 머지·푸시, 운영 배포 확인.

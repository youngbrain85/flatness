# 넓은 처짐 안내 문구 구현 계획

> 스펙: `docs/superpowers/specs/2026-10-20-floor-reference-surfaces-design.md` §9. 문구는 사용자 승인됨.

**Goal:** 국부 기준일 때만 "1m보다 넓은 처짐·함몰은 '전체' 기준에서 확인" 안내를 편차맵·3D 고지·보고서 캡션에 붙이고 용역 보고서를 고친다.

1. **워커(TDD):** `test_report_html.py` 에 새 분석 캡션은 안내 문장을 담고 옛 분석은 담지 않는다는 단언을 먼저 실패시킨 뒤
   `report.html.j2` 캡션의 `local_reference` 분기에 문장을 넣는다.
2. **대시보드(TDD):** `deviation-view.test.tsx`(국부 = 안내 있음, 전체 누르면 없음, 옛 격자 없음), `points3d-view.test.tsx`
   (국부 = 고지에 안내, 전체 = 없음, 기준면 줄 숨김 = 없음), `preview3d-tab.test.tsx`(새 분석 경로에 안내)를 먼저 실패시키고
   `deviation-view.tsx` 의 `BASES` 와 `points3d-view.tsx` 고지 문구에 넣는다. 변이 확인: 조건을 지우면 '없음' 단언이 깨지는지.
3. **문서:** `service-report.md` §4.5·§4.5.1(합니다체, 알고리즘 이름 영어).
4. **검증:** 엔진·워커·대시보드 테스트, tsc, lint, build, 로컬 화면 캡처(편차맵·3D 국부/전체). 푸시(배포)는 사용자 승인 뒤.

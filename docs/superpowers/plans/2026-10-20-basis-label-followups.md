# 기준 표기 누락 정리 계획

> 스펙: `docs/superpowers/specs/2026-10-20-floor-reference-surfaces-design.md` §10. 문구는 사용자 승인됨.

1. **워커(TDD):** `test_report_html.py` 에 새 분석의 3D 프리뷰 캡션이 "높이 축은 1m 국부 기준면 대비 편차(mm)입니다"를 담고 옛 분석은
   담지 않는다는 단언을 먼저 실패시킨 뒤 `report.html.j2` 의 preview3d figcaption 에 `local_reference` 분기를 넣는다.
2. **대시보드(TDD):** `deviation-view.test.tsx`(PNG 대체 + hasReference = 기준 표기, 없으면 그대로), `preview3d-tab.test.tsx`
   (새 분석 대체 화면 = 국부 M10, 옛 분석·임포트 = 기존 M10)를 먼저 실패시키고 구현. `analysis-result.tsx` 가 `hasReference` 를 넘긴다
   (넘기지 않으면 깨지는 테스트를 둔다). 변이 확인.
3. **문서:** `stats-schema.md`, `service-report.md` §7.1·§4.5.1(머리말 예외 목록 포함).
4. **검증:** 워커·대시보드 테스트, tsc, lint, build, 로컬 캡처(PNG 대체 화면 2종·보고서 캡션). 푸시는 사용자 승인 뒤.

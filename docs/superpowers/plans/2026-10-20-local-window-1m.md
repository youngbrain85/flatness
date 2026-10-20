# 국부 기준면 창 1m 구현 계획

> 스펙: `docs/superpowers/specs/2026-10-20-floor-reference-surfaces-design.md` §8. 사용자 선호: 짧게, 보고 없이 끝까지.

**Goal:** 국부 기준면 창을 3m → 1m 로 줄이고 문구·버전을 맞춘다.

1. **엔진(TDD):** `test_reference.py` 에 파장 2.4m·진폭 3mm 물결 바닥 테스트(안쪽 칸 국부 편차 < 1.2mm, 3m 창이면 약 3.5mm)를
   먼저 실패시키고 `local_reference(win_m=1.0)` 로 통과. 3m 전제 테스트(반경 0.9m 함몰 끌림)는 1m 창 안에 드는 크기로 다시 실측해
   고치고, 2회차를 끄면 실패하는지 변이 확인. `ENGINE_VERSION = "p4-0.7.1"`, docstring·주석의 3m.
2. **워커:** 보고서 편차맵 캡션 "1m 국부 기준면 대비"(테스트 먼저).
3. **대시보드:** `deviation-view` 설명, `points3d-view` 고지 문구, 주석(테스트 먼저).
4. **문서:** `stats-schema.md`(3m 문구·버전), `scan-guideline.md`.
5. **검증:** 엔진·워커·대시보드 전체 테스트, tsc, lint, build. 합성 방 편차 PNG 3m/1m 캡처 대조. 머지·푸시(배포)·운영 샘플 재분석·운영 화면 문구 확인.

# 평활도 분석 온라인 대시보드 — 설계 문서

- 작성일: 2026-07-27
- 상태: 사용자 승인 대기
- 근거: 과업지시서 세부과업 1 (수직·수평면 평활도 분석 결과 자동 보고서 생성 기능 개발), 기존 Colab 노트북(floor_flatness_analysis.ipynb) 재구축
- 승인 이력: 아키텍처(A안 하이브리드 클라우드), 결과 화면 레이아웃(C안), 판정 기준(국내 시방서), 전체 범위 단일 설계 — 사용자 승인 완료

## 1. 개요

### 1.1 목적

모바일 LiDAR(iPhone/iPad LiDAR 앱)로 스캔한 현장 바닥면·벽면 포인트클라우드를 업로드하면, 국내 시방서 기준으로 평활도를 분석·판정하고, 히트맵·3D 뷰어·현장 사진과 연계된 결과를 온라인 대시보드로 제공하며, 수직·수평면 통합 PDF 보고서를 자동 생성하는 시스템.

### 1.2 기존 노트북의 문제점 (재설계 동기)

1. Colab 종속 수동 워크플로 — 결과가 세션과 함께 소멸, 이력·공유·비교 불가
2. 단일 전역 RANSAC 평면 — 다중 방·단차·설계 구배에서 오판, 벽면 미지원
3. 판정 기준 근거 부재 — 임의 임계값(9mm) 슬라이더, 시방서와 무관한 등급
4. 성능 — 포인트별 Python 루프, 무작위 샘플링 시각화로 결함 누락 가능
5. 메타데이터·연계 부재 — 현장 정보/사진/DB/보고서 없음, 실제 LiDAR 포맷(E57/LAS) 미지원

### 1.3 시스템 포지셔닝 (중요)

학술 벤치마크 조사 결과, iPhone LiDAR 점군의 상대 거리 오차는 방 규모에서 약 3cm(수직 방향은 ±7mm 수준), SLAM 드리프트는 이동거리의 1~2%다. 시방서 허용오차(3m당 3~10mm)와 같은 자릿수이거나 이를 초과하므로, **본 시스템은 합격/불합격 확정 판정 도구가 아니라 "스크리닝 도구"로 포지셔닝한다**:

- 판정 등급 4단계: **적합 / 경계(현장 재확인 필요) / 보수 / 재시공** — 임계값 ± 측정 불확도 구간은 '경계'
- 모든 보고서에 측정 불확도 수치와 "본 결과는 스크리닝이며 공식 검측(실물 직선자·레벨 측량)을 대체하지 않음" 문구 자동 포함
- 드리프트 완화 스캔 가이드라인 문서 제공 (폐루프 궤적, 측정 거리 0.3~1.5m, 구역 분할 스캔, 바닥-벽-천장 교차 경로)
- E57/LAS 포맷 지원으로 향후 TLS(지상 레이저 스캐너) 데이터도 동일 파이프라인 처리 가능

## 2. 범위

### 2.1 포함

- 바닥면(수평)·벽면(수직) 평활도 분석 및 판정
- 온라인 대시보드 (업로드, 현장/측정위치 관리, 결과 조회, 사진 연계)
- 온라인 DB (Supabase) 및 파일 저장소
- 수직·수평 통합 PDF 보고서 자동 생성 (자동 종합의견 + 사용자 수정)
- 판정 기준 관리 (전역 기본값 + 현장별 재정의)

### 2.2 제외 (YAGNI / 후속 과업)

- 과업지시서 세부과업 2~4 (마감재 DB, BIM-API 연계, 구배 알고리즘) — 단, 데이터 포맷·산출물 형식은 향후 연계 가능하게 유지
- 모바일 전용 앱, 실시간 스캔 스트리밍
- 다중 조직/역할 권한 체계 (연구실 내부용: 로그인한 사용자 전원 동일 권한, criteria 전역 기본값 수정만 admin 클레임 제한)
- 계단 분석 (명시적 범위 제외 — 트레드 단위 분할은 후속 연구)

## 3. 아키텍처

### 3.1 구성요소

| 구성요소 | 기술 | 배포 | 역할 |
|---|---|---|---|
| 웹 대시보드 | Next.js(App Router, TypeScript), Three.js(점군 뷰어), Canvas 히트맵 | Vercel | UI 전체, Storage 직접 업로드 |
| DB/저장소/인증 | Supabase (Postgres + Storage + Auth + Realtime) | Supabase Cloud | 데이터·파일·인증·실시간 상태 |
| 분석 워커 | Python 3.11+ (NumPy/SciPy/Open3D/laspy/pye57), Playwright(PDF) | Railway 또는 Fly.io (Docker) | 분석 잡·보고서 잡 처리 |

### 3.2 데이터 흐름

```
[iPhone LiDAR 앱] → PLY/XYZ/PTS/CSV/E57/LAS 파일
  ① 대시보드: 현장·측정위치 지정, 메타데이터 입력 → 브라우저 → Supabase Storage 직접 업로드(TUS 재개 가능)
  ② 단위 확인 단계: 워커가 경량 사전 검사(파싱·단위 추정·데이터 계보 감지) → 사용자 확정
  ③ 분석 잡 등록(jobs) → 워커 폴링(FOR UPDATE SKIP LOCKED) → 분석 실행
  ④ 결과 수치·판정 → DB(analyses), 산출물(히트맵 PNG·셀 JSON·뷰어 점군·CSV) → Storage
  ⑤ 대시보드: Supabase Realtime으로 진행 상태 반영 → C안 레이아웃으로 결과 표시
  ⑥ 보고서: 분석 복수 선택(바닥+벽면) → HTML 미리보기 → 종합의견 수정 → 보고서 잡 → PDF 생성 → 다운로드
```

- 대용량 파일이 Vercel 서버리스를 거치지 않음 (직접 업로드)
- 잡 큐는 별도 인프라 없이 Postgres 테이블 기반 (연구실 규모에 충분)

## 4. 판정 기준 체계

### 4.1 기본 탑재 기준 (웹 조사 검증 완료)

| ID | 대상 | 기준 출처 | 수치 | 검증 상태 |
|---|---|---|---|---|
| floor-kcs-1 | 바닥, 마감두께 7mm 이상 | KCS 14 20 10 표 3.7-1 | 1m당 10mm | 2차 출처 교차검증 |
| floor-kcs-2 | 바닥, 마감두께 7mm 미만 | 〃 | 3m당 10mm | 〃 |
| floor-kcs-3 | 바닥, 제물치장·얇은 마감 | 〃 | 3m당 7mm | 〃 |
| floor-molit | 바닥, 완충재 바탕(공동주택) | 국토부 바닥충격음 고시 | 3m당 7mm | 조항 번호 재확인 필요 |
| floor-lh | 바닥, LH 주택(제물치장·도장·벽지 바탕) | LHCS 14 20 10 05 표 3.11-7 | 3m당 6mm (13mm 초과 마감 10mm) | 원문 표 재확인 권장 |
| wall-kcs-tilt | 벽면 기울기 | KCS 21 50 05 §3.2.6 | 3m당 6mm(노출부)/9mm(기타) | 검증됨 |
| wall-kcs-plumb | 벽면 수직도 | KCS 21 50 05 §3.2.2 | H≤30m: 25mm(노출 모서리 13mm) | 검증됨 |
| wall-plaster | 미장 바름면 | 주택건설 전문시방서 31310 | 3m당 3mm (바탕면 6mm) | 원문 검증(현행 LHCS 승계 미확인) |
| ref-din | 참고: DIN 18202 표2·표3 | 독일 기준 | 다단계(마감바닥 1m/4mm·4m/10mm 등) | 원문 PDF 검증 |
| ref-aci | 참고: ACI 117 FF/FL | 미국 기준 | F-Number(직선자 방식과 환산 불가) | 참고용 |

**주의**: KCS 원문 뷰어(kcsc.re.kr) 직접 열람은 실패했고 복수 2차 출처로 교차 검증했다. 논문·공식 보고서 인용 전 원문 대조를 권장하며, 이 확인 작업을 구현 계획에 태스크로 포함한다.

### 4.2 기준 데이터 규약

- `criteria.thresholds`는 배열 규약: `[{span_m, metric('flatness'|'plumbness'|'step'), pass_mm, repair_mm, rework_mm}]`
  - `pass_mm` = 시방서 허용치. `repair_mm`/`rework_mm`는 시방서에 없는 운영값이므로 연구실이 설정(기본값: pass의 1.5배/3배로 초기화하되 UI에서 조정)
- 전역 기본값(site_id NULL) + 현장별 재정의. 해석 규칙은 DB 함수 `fn_resolve_criteria(site_id, surface_type)`로 고정: 현장 기준이 있으면 현장 기준, 없으면 전역
- **분석 실행 시점에 적용 기준 전체(이름·조항·thresholds)를 `analyses.applied_criteria`(jsonb)로 스냅샷** — 기준 개정이 과거 분석·발행 보고서를 소급 오염시키지 않음
- 판정 4등급: 셀 지표 ≤ pass − U → 적합, pass − U < 지표 ≤ pass + U → 경계, pass + U < 지표 ≤ rework → 보수, > rework → 재시공 (U = 측정 불확도, 반복 스캔 재현성 시험으로 산정)

## 5. 분석 파이프라인

### 5.1 단계 (바닥면)

1. **로드·검증**
   - 파서: PLY(binary/ascii), XYZ/TXT/CSV, PTS, E57(pye57), LAS/LAZ(laspy). 스트리밍/메모리맵 우선, float32 사용
   - 단위 감지: 바운딩박스 크기·점 간격·추정 층고 휴리스틱으로 m/mm/cm 후보 제시 → **자동 확정하지 않고 근거와 함께 사용자 확인**. 휴리스틱과 불일치 시 처리 중단·명시적 입력 요구. 확정 단위·스케일 계수를 모든 산출물에 기록
   - 데이터 계보 감지: 메시 정점 규칙성·정점 간격으로 raw 점군 vs 융합 메시 추정 → 융합 메시면 "앱이 스무딩한 데이터로 실제보다 양호하게 나올 수 있음" 경고를 결과에 표기. 메시 입력은 면적가중 균일 재샘플링
2. **전처리**
   - 복셀 다운샘플 → 완화된 아웃라이어 제거(flying pixel 제거 수준, 실제 결함점 보존) → 제거된 점 수·공간 분포를 결과에 기록(결함 은폐 사후 검증 가능)
3. **면 분할 (구역화)**
   - 법선(복셀 다운샘플 후 추정, 중력 +z 정렬)+높이 히스토그램 기반 다중 수평면 반복 추출 → 연결요소 분석으로 방/구역 분리(단차·다중 방 대응)
   - RANSAC은 시드로만 사용, 시드 평면 ±5cm 수직 밴드에서 영역 성장으로 바닥 연속면 회수(결함 구역이 인라이어에서 빠지는 선택 편향 제거)
   - 법선 허용각 수직축 ±8°(설계 구배 수용), 최소 면적·높이 분포·연결성으로 가구 상판 배제
   - **바닥 인식 비율(coverage %) 필수 산출·표시** — 무증상 누락 가시화
4. **품질 검사**
   - 서브셀 높이 분포의 쌍봉성 검사로 SLAM 유령층(이중 표면) 감지 → 해당 구역 판정 제외 + '재스캔 필요' 플래그
   - 셀별 점 밀도·법선 일관성 신뢰도 마스크 → 저신뢰·개구부 셀은 '판정 불가'
5. **대표 높이면 구성**
   - 5~10cm 서브셀별 로버스트 대표높이(중앙값) — 점 단위 노이즈 극값이 판정을 지배하지 않도록 함. 95퍼센타일 병기
6. **핵심 지표: 직선자 시뮬레이션 (판정 근거)**
   - 판정 셀(기본 1m)마다 4방향(0/45/90/135°) 1D 프로파일 추출 → **상부 볼록 포락선(실물 직선자가 고점에 얹히는 지지선) 계산 → 포락선 아래 최대 틈새** 산출. 스팬은 적용 기준의 span_m(1m/3m)
   - LSQ 로컬 평면 최대편차 방식은 파형 결함을 ~1/2로 축소하므로 판정에 사용하지 않음
   - 윈도우는 동일 구역 점만 사용(벽 너머 다른 방 유입 차단), 윈도우 점유율·공분산 조건수 미달 셀은 '판정 불가'
   - 3m 미만 소실(화장실 등)은 축소 스팬(1.5m) 환산 규칙을 별도 정의하고 결과에 명시
7. **판정·통계**
   - 셀별 직선자 값 vs 적용 기준 → 4등급. 부호 규약: **+ = 융기, − = 침하** (코드 상수·범례·테스트로 고정)
   - 판정용 지표(윈도우 값)와 면적 산정용 지표 분리: 최대 틈새 발생 실제 위치(결함 기여 지점)를 기록해 보수 면적 통계는 그 위치 기반으로 집계(불합격 면적 과대 산정 방지)
   - 전역 최적 평면 편차는 '수평도(레벨)' 별도 지표로 분리 — 로버스트 피팅, 'SLAM 드리프트 포함 가능' 경고 표기, 판정에 미사용, 판정 히트맵과 나란히 배치하지 않음
8. **벽면**
   - 동일 체계(다중 수직 평면 추출→구역화→직선자 시뮬레이션)
   - 수직도: 중력 기준이 보장되지 않는 앱 데이터에서는 절대 수직도를 비활성화하고 벽면 간 상대 기울기만 제공. 앱별 중력 보존 검증 후 화이트리스트 관리. 수직도 결과에 각도 불확도의 mm 환산 병기
9. **산출물**
   - stats JSON(전역·구역별 통계, coverage, 경고), 셀 격자 JSON, 히트맵 PNG(판정 4색), 웹 뷰어용 다운샘플 점군(≤150만 점, 편차 색상 포함 바이너리), 편차 히스토그램 PNG, CSV(셀별 상세), 자동 종합의견 초안(규칙 템플릿)

### 5.2 성능 설계

- 서브셀 비닝 1회 + 충분통계량(n, Σx, Σxxᵀ) 누적 → 윈도우 연산을 O(셀)로 (셀별 원시점 재수집 O(N×셀) 금지)
- 직선자 시뮬레이션도 서브셀 대표높이 위에서 수행
- 목표: 3천만 점 스캔을 워커 1 vCPU/2GB에서 5분 이내

### 5.3 자동 종합의견 (규칙 템플릿)

- 입력: 판정 분포, 최대 편차 셀 위치, 경고(유령층·낮은 coverage·융합 메시), 적용 기준
- 출력: 결과 해석 문구 + 주요 이상 구간 요약 + 보수/재시공 검토 대상 + 스크리닝 한계 고지 (과업지시서 '결과 해석 및 종합의견 작성 기능' 충족). LLM 미사용(재현성·비용)

## 6. DB 스키마 (Supabase Postgres)

적대적 검토(critical 4건 포함 15건)를 반영한 설계.

### 6.1 테이블

- **profiles**: id(uuid, FK auth.users), display_name — 담당자 표기 일관성
- **sites**: id, name, address, memo, created_at, updated_at
- **locations**: id, site_id FK, building(동), floor(층 표기), floor_order(int, 정렬), room(공간), name(측정위치), memo, UNIQUE(site_id, building, floor, room, name), 입력값 trim 정규화
- **scans**: id, location_id FK, surface_type enum(floor|wall), scanned_at(측정일자), device, operator_id FK profiles(+ operator_name_manual nullable), raw_file_path, original_filename, file_format, point_count, unit_scale(확정 단위 계수), data_lineage enum(raw|fused_mesh|unknown), status enum(uploaded|awaiting_unit_confirm|ready|archived|failed), deleted_at(soft delete), created_at, updated_at, UNIQUE(id, surface_type) — 복합 FK용
- **analyses**: id, scan_id FK, surface_type(복합 FK: (scan_id, surface_type)→scans(id, surface_type), (criteria_id, surface_type)→criteria(id, surface_type) — 바닥 스캔에 벽 기준 적용을 선언적으로 차단), criteria_id FK(ON DELETE RESTRICT), applied_criteria jsonb(스냅샷), params jsonb, engine_version, status enum(queued|processing|done|failed), stats jsonb, coverage_pct, uncertainty_mm, overall_verdict enum(pass|borderline|repair|rework), warnings jsonb, cell_data_path, heatmap_path, viewer_data_path, histogram_path, csv_path, auto_summary, user_summary, is_current bool + `CREATE UNIQUE INDEX ON analyses(scan_id) WHERE is_current` (스캔당 대표 분석 1개, 새 분석 done 시 트랜잭션 교체), created_at, created_by FK
- **criteria**: id, site_id nullable FK, surface_type, name, source_text(기준명·조항), thresholds jsonb(§4.2 배열 규약, CHECK jsonb_typeof='array'), is_active, version, supersedes_id, created_at. 부분 유니크 인덱스 2개: `(surface_type, name) WHERE site_id IS NULL`, `(site_id, surface_type, name) WHERE site_id IS NOT NULL`
- **photos**: id, scan_id nullable FK, location_id nullable FK, site_id nullable FK, CHECK(정확히 하나만 NOT NULL), file_path, caption, taken_at, created_at — 스캔 귀속/측정위치 귀속/현장 전경 사진 모두 지원
- **reports**: id, location_id FK(보고서 스코프), title, status enum(draft|finalized), snapshot jsonb(발행 시점의 측정일자·담당자·위치 계층·적용 기준·각 분석 판정·핵심 통계 전체), opinion_text, pdf_path, created_by FK, created_at. finalized 후 snapshot·pdf_path 수정을 트리거로 차단. PDF 재생성은 항상 snapshot에서만 렌더
- **report_analyses**: report_id FK, analysis_id FK, sort_order, PK(report_id, analysis_id) — **수직·수평 복수 분석의 통합 보고서** (과업지시서 요구)
- **jobs**: id, type enum(precheck|analyze|report), payload jsonb, status enum(queued|processing|done|failed), attempts, max_attempts(기본 3), run_after, locked_at, locked_by, error, created_at, started_at, finished_at
  - 클레임: `UPDATE ... WHERE id=(SELECT id FROM jobs WHERE status='queued' AND run_after<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)` — 이중 실행 방지
  - 중복 방지: `CREATE UNIQUE INDEX ON jobs(type, (payload->>'analysis_id')) WHERE status IN ('queued','processing')`
  - 고착 회수: pg_cron으로 locked_at 초과 processing 잡을 queued로 복귀
  - **상태 단일화**: 잡 상태 전이와 analyses.status 갱신은 반드시 같은 트랜잭션(DB 함수 `fn_job_transition`으로 캡슐화, 회수 시 analyses 상태 동반 복귀 포함)

### 6.2 삭제 정책

- criteria: 참조 중 삭제 금지(RESTRICT), 비활성화로 대체
- scans/analyses: soft delete(deleted_at) + Storage 파일 정리 잡을 jobs에 enqueue
- reports(발행본): 상위 삭제 시 RESTRICT

### 6.3 보안 (RLS·Storage)

- 전 테이블 RLS 활성화. 기본 정책: authenticated 전체 허용(내부용), criteria의 site_id IS NULL 행 수정은 admin 클레임 필요
- jobs: 클라이언트 정책 없음(service_role 워커 전용), enqueue는 SECURITY DEFINER 함수로만
- Storage 버킷 4개 전부 private + 만료 있는 signed URL: `raw-scans/{site_id}/{scan_id}/raw.{ext}`, `artifacts/{analysis_id}/{cells.json|heatmap.png|viewer.bin|histogram.png|stats.csv}`, `photos/{photo_id}.{ext}`, `reports/{report_id}/report.pdf` — 경로는 불변 ID만 사용, DB 함수 하나로 생성

## 7. 화면 설계

1. **로그인** — Supabase Auth 이메일
2. **홈(현장 목록)** — 현장 카드: 최근 측정일, 측정위치 수, 판정 분포 요약
3. **현장 상세** — 동/층/공간/측정위치 트리 + 측정 이력 + 현장 사진 관리
4. **스캔 업로드** — 위치 선택 → 파일 드래그 → 메타데이터(표면 유형·측정일자·담당자·적용 기준; 기준은 fn_resolve_criteria 결과를 기본 선택) → 업로드(TUS) → **단위 확인 화면**(사전 검사 잡 결과: 추정 단위·근거·데이터 계보 경고 → 사용자 확정) → 분석 진행 상태(Realtime)
5. **분석 결과 (C안 확정)** — 좌측 큰 시각화 영역(히트맵/3D 토글, 히트맵 셀 클릭→해당 셀 편차·프로파일 상세), 우측 고정 판정 패널(종합 판정 배지, 통계, 적용 기준, 경고 배지, 현장 사진, 종합의견 편집), 하단 구간별 결과표. 수평도(레벨) 지표는 별도 접힘 섹션(드리프트 경고 포함)
6. **보고서 생성** — 같은 측정위치(또는 공간)의 분석 복수 선택(바닥+벽면) → HTML 미리보기 → 종합의견 수정 → PDF 생성·다운로드, 발행(finalized) 처리
7. **설정** — 판정 기준 관리(전역/현장별, 버전 이력), 프로필

3D 뷰어: Three.js 점군 렌더(다운샘플 바이너리 로드, 편차 색상/실색상 토글, 회전·줌·단면). 히트맵: Canvas 렌더 + 셀 인터랙션(판정 4색: 초록/노랑/주황/빨강, 판정 불가=회색, 색상은 색각 이상 대비 검증).

## 8. PDF 보고서

- 구성(과업지시서 요구 그대로): ①표지·기본정보(현장/동/층/공간/측정위치, 측정일자, 담당자, 장비, **적용 기준 명시**) ②분석 개요(데이터 정보, 파라미터, coverage %, 측정 불확도 고지) ③구간별 결과표(수직·수평 섹션 분리) ④시각자료(히트맵, 3D 캡처, 히스토그램, 현장 사진) ⑤종합의견(자동 초안+사용자 수정, 스크리닝 한계 문구 필수 포함)
- 생성: 워커에서 HTML 템플릿(Jinja2) → Playwright Chromium → PDF. 한글 폰트(Noto Sans KR) 컨테이너 내장
- 데이터 소스: reports.snapshot만 사용(발행 후 원본 변경과 무관하게 재현 가능)

## 9. 에러 처리

| 상황 | 처리 |
|---|---|
| 업로드 중단 | TUS 재개 가능 업로드 |
| 파싱 실패 | 잡 failed + 유형별 안내(지원 포맷·인코딩·예시) |
| 단위 불일치 | 처리 중단, 명시적 단위 입력 요구 |
| 바닥/벽 미검출 | failed + 원인 후보(가림·범위·기울기) 안내 |
| 유령층·낮은 coverage·융합 메시 | **실패가 아닌 경고 배지 딸린 결과** + 재스캔 가이드 링크 |
| 일시 오류(Storage 타임아웃 등) | 자동 재시도 3회(run_after 백오프) |
| 워커 크래시 | pg_cron 회수로 잡 복귀, analyses 상태 동반 복귀 |
| 판정 불가 셀 | 수치 강제 산출 금지, '판정 불가'로 명시 출력 |

## 10. 테스트 전략

1. **분석 엔진 (핵심)**
   - 합성 점군 픽스처: 평탄 바닥 + 정답과 함께 주입한 결함(단차, 국부 융기/침하, 물결, 설계 구배) + 가우시안/거리 의존 노이즈 + 시뮬레이션 드리프트 → 직선자 값·판정·결함 위치를 정답 대비 정량 검증(허용 오차 명시)
   - 직선자 포락선 시뮬레이션: 해석적으로 답이 알려진 프로파일(V홈, 돌기, 사인파)로 단위 테스트
   - 파서: 포맷·앱별 실제 샘플 파일, 단위 감지 휴리스틱 경계 사례
   - 회귀: 실측 스캔 골든 파일
2. **DB/잡 큐**: 동시 클레임 경쟁 테스트(이중 실행 0건), 고착 회수, RLS 정책 테스트(비인증 접근 차단)
3. **E2E**: Playwright — 업로드→단위 확인→분석→결과 조회→보고서 PDF 다운로드 전체 흐름
4. **실측 대조 (릴리스 게이트)**: 실제 현장 1곳 이상에서 3m 직선자 수동 측정과 비교, 상관·오차 보고. 반복 스캔(같은 바닥 2회 이상)으로 재현성(U 산정) 시험 — 경계 등급 폭의 근거
5. **검증 원칙**: 모든 완료 주장 전 실제 실행·화면 캡처 대조(사용자 상시 지시)

## 11. 구현 단계 (writing-plans에서 상세화)

1. **P1 분석 엔진 코어** — 파서+파이프라인+합성 픽스처 테스트, CLI 실행 가능 (다른 것과 독립 검증)
2. **P2 인프라** — Supabase 스키마+RLS+잡 큐+워커 골격+Docker 배포
3. **P3 대시보드** — 로그인→현장 관리→업로드→단위 확인→결과 화면(C안)
4. **P4 보고서** — 통합 선택→미리보기→PDF 생성·발행
5. **P5 검증·문서** — 실측 대조, 스캔 가이드라인 문서, 기준 원문 대조

## 12. 성공 기준

- 합성 픽스처: 주입 결함의 위치 검출률·직선자 값 오차가 명시된 허용치 이내
- 3천만 점 스캔 분석 5분 이내(워커 1 vCPU/2GB)
- E2E 흐름(업로드→보고서 PDF) 무인 통과
- 실측 대조: 3m 직선자 수동 측정과의 상관 보고 + 반복 스캔 재현성으로 경계 등급 폭 산정
- 과업지시서 세부과업 1의 최종 성과물 목록(분류 체계·연계 기능·자동 정리·보고서 생성·미리보기/수정·PDF 저장) 전부 충족

## 13. 참고 자료

- KCS 14 20 10 표 3.7-1 (kcsc.re.kr, 2차 출처 교차검증), KCS 21 50 05 §3.2.2/§3.2.6, LHCS 14 20 10 05 표 3.11-7, 국토부 바닥충격음 고시, 주택건설 전문시방서 31310, DIN 18202 표2·3, ACI 117
- iPhone LiDAR 정밀도: Tondo et al. 2023 (Sensors), Luetzenburg et al. 2021 (Scientific Reports), Chase et al. 2022 (UNB TCRC), MDPI Virtual Worlds 앱 비교
- 기존 코드: floor_flatness_analysis.ipynb (Colab)

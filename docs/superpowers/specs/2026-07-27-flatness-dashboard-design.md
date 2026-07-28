# 평활도 분석 온라인 대시보드 — 설계 문서

- 작성일: 2026-07-27 (셀프 리뷰 3관점 반영 개정판)
- 상태: 사용자 승인 대기
- 근거: 과업지시서 세부과업 1 (수직·수평면 평활도 분석 결과 자동 보고서 생성 기능 개발), 기존 Colab 노트북(floor_flatness_analysis.ipynb) 재구축
- 승인 이력: 아키텍처(A안 하이브리드 클라우드), 결과 화면 레이아웃(C안), 판정 기준(국내 시방서), 전체 범위 단일 설계 — 사용자 승인 완료
- 확정된 결정: §3.3 데모 단계 비용 0원(Supabase Free+로컬 워커, 2026-07-28 지시), §5.4 기존 결과 임포트 포함, §2.2 E57 후속 이관

## 1. 개요

### 1.1 목적

모바일 LiDAR(iPhone/iPad LiDAR 앱)로 스캔한 현장 바닥면·벽면 포인트클라우드를 업로드하면, 국내 시방서 기준으로 평활도를 분석·판정하고, 히트맵·3D 뷰어·현장 사진과 연계된 결과를 온라인 대시보드로 제공하며, 수직·수평면 통합 PDF 보고서를 자동 생성하는 시스템.

### 1.2 기존 노트북의 문제점 (재설계 동기)

1. Colab 종속 수동 워크플로 — 결과가 세션과 함께 소멸, 이력·공유·비교 불가
2. 단일 전역 RANSAC 평면 — 다중 방·단차·설계 구배에서 오판, 벽면 미지원
3. 판정 기준 근거 부재 — 임의 임계값(9mm) 슬라이더, 시방서와 무관한 등급
4. 성능 — 포인트별 Python 루프, 무작위 샘플링 시각화로 결함 누락 가능
5. 메타데이터·연계 부재 — 현장 정보/사진/DB/보고서 없음, 실제 LiDAR 포맷 미지원

### 1.3 시스템 포지셔닝 (중요)

학술 벤치마크 조사 결과, iPhone LiDAR 점군의 상대 거리 오차는 방 규모에서 약 3cm(수직 방향은 ±7mm 수준), SLAM 드리프트는 이동거리의 1~2%다. 시방서 허용오차(3m당 3~10mm)와 같은 자릿수이거나 이를 초과하므로, **본 시스템은 합격/불합격 확정 판정 도구가 아니라 "스크리닝 도구"로 포지셔닝한다**:

- 판정 등급 4단계: **적합 / 경계(현장 재확인 필요) / 보수 / 재시공** — 정확한 판정식은 §4.2
- 모든 보고서에 측정 불확도 수치와 "본 결과는 스크리닝이며 공식 검측(실물 직선자·레벨 측량)을 대체하지 않음" 문구 자동 포함
- 드리프트 완화 스캔 가이드라인 문서 제공 (폐루프 궤적, 측정 거리 0.3~1.5m, 구역 분할 스캔, 바닥-벽-천장 교차 경로)
- LAS/LAZ 지원으로 향후 TLS(지상 레이저 스캐너) 데이터도 동일 파이프라인 처리 가능

## 2. 범위

### 2.1 포함

- 바닥면(수평)·벽면(수직) 평활도 분석 및 판정
- 온라인 대시보드 (업로드, 현장/측정위치 관리, 결과 조회, 사진 연계)
- 온라인 DB (Supabase) 및 파일 저장소
- 수직·수평 통합 PDF 보고서 자동 생성 (자동 종합의견 + 사용자 수정)
- 판정 기준 관리 (전역 기본값 + 현장별 재정의)
- 기존 분석 프로그램(Colab 노트북) 결과 데이터 임포트 (§5.4 — 과업지시서 명시 요구)

### 2.2 제외 (YAGNI / 후속 과업)

- 과업지시서 세부과업 2~4 (마감재 DB, BIM-API 연계, 구배 알고리즘) — 단, 데이터 포맷·산출물 형식은 향후 연계 가능하게 유지
- 모바일 전용 앱, 실시간 스캔 스트리밍
- 다중 조직/역할 권한 체계 (연구실 내부용: 로그인 사용자 전원 동일 권한, criteria 전역 기본값 수정만 admin 클레임 제한)
- 계단 분석 (트레드 단위 분할은 후속 연구)
- **E57 파서** — 현재 사용 장비(iPhone 앱)가 내보내지 않는 TLS 중심 포맷 + 네이티브 의존성으로 빌드 리스크. 파서 인터페이스만 추상화해 두고 TLS 도입 시 후속 태스크로 (과업지시서 포맷 요건은 PTS/XYZ/TXT/CSV/JSON으로 충족)
- **융합 메시 통계적 자동 감지** — 사용자 선택(원시/융합 메시/모름) + 확실한 신호(PLY face 요소 존재)만 자동. 통계 휴리스틱은 후속
- **벽면 단차(step) 지표** — KCS 단차 등급(A/B/C급)은 후속 (런치 metric은 flatness/plumbness 2종)
- 용역 결과 보고서(문서 성과물)는 소프트웨어 범위 밖 — P5에서 별도 작성 태스크로 수행 (§11)

## 3. 아키텍처

### 3.1 구성요소

| 구성요소 | 기술 | 배포 | 역할 |
|---|---|---|---|
| 웹 대시보드 | Next.js(App Router, TypeScript), Three.js(점군 뷰어), Canvas 히트맵 | **데모: 로컬 실행(localhost)** | UI 전체, 로컬 파일 수신·서빙 |
| DB/인증 | Supabase (Postgres + Auth + Realtime + 사진 Storage) | Supabase Cloud **Free** | 메타데이터·판정 결과·인증·실시간·사진 |
| 분석 워커 | Python 3.11+ (NumPy/SciPy/Open3D/laspy), Playwright(PDF) | **데모: 로컬 실행(동일 PC 폴링)** | precheck/분석/임포트/보고서 잡 처리 |
| 파일 저장 | 로컬 디스크 `data/` (raw 원본·대형 산출물) | 워커 PC | 대용량 파일은 Supabase 미경유 → Free 티어 50MB/1GB 제한 비영향 |

- 워커 ↔ DB 연결: Supavisor 세션 모드(또는 IPv6 직접 연결). 잡 클레임 쿼리는 단일 트랜잭션
- 워커는 잡 type별 직렬 실행(분석 잡과 보고서 잡 동시 실행 금지 — 메모리 경합 방지)

### 3.2 데이터 흐름

```
[iPhone LiDAR 앱] → PLY/LAS/LAZ/XYZ/TXT/CSV/PTS 파일
  ① 대시보드: 현장·측정위치 지정, 메타데이터 입력(표면 유형·측정일자·담당자·적용 기준·데이터 계보)
     → 브라우저 → 로컬 대시보드 서버가 `data/raw-scans/`에 저장(데모: TUS 불필요) → scans 생성(selected_criteria_id 저장)
  ② precheck 잡: 경량 사전 검사(파싱·단위 추정·확실한 계보 신호) → 사용자가 단위 확정
  ③ 단위 확정 시 분석 잡 자동 등록(jobs) → 워커 폴링(FOR UPDATE SKIP LOCKED) → 분석 실행
  ④ 결과 수치·판정 → DB(analyses), 산출물(히트맵·셀 JSON·뷰어 점군·3D 프리뷰 PNG·CSV) → Storage
  ⑤ 대시보드: Supabase Realtime으로 진행 상태 반영 → C안 레이아웃으로 결과 표시
  ⑥ 보고서: 같은 측정위치의 분석 복수 선택(바닥+벽면) → HTML 미리보기 → 종합의견 수정
     → 보고서 잡 → PDF 생성 + 이미지 자산 복사 → 발행(finalized)
  (별도) 기존 결과 임포트: Colab CSV/JSON 업로드 → import 잡 → analyses(external) 등록 (§5.4)
```

### 3.3 운영 비용 — 데모 단계 0원 확정 (2026-07-28 사용자 지시)

**데모 단계(현재)**: 총 비용 **0원**. 대용량 파일(raw 원본·대형 산출물)은 Supabase를 거치지 않고 로컬 디스크에 저장하므로 Free 티어의 파일당 50MB·총 1GB 제한이 문제되지 않는다.

| 항목 | 데모 구성 | 비용 |
|---|---|---|
| Supabase | Free (DB 500MB·Auth·Realtime·사진 Storage) | $0 |
| 대시보드 | Next.js 로컬 실행 (localhost) | $0 |
| 워커 | Python 로컬 실행 (동일 PC 폴링) | $0 |
| 파일 | 로컬 `data/` 디렉터리 | $0 |

- Supabase Free의 7일 미사용 일시정지는 데모 특성상 수용 — 대시보드에 일시정지 감지 시 재개 안내 표시
- **정식 배포 시 확장 경로** (해당 시점에 사용자 승인 후 전환): Vercel(Hobby, 비상업 약관 확인) + Supabase Pro($25) + Fly.io 워커($10~15) ≈ 월 $35~40. 원본 저장이 커지면 Cloudflare R2 분리 검토. 코드 구조는 처음부터 파일 저장 경로·잡 실행 환경을 어댑터로 추상화해 전환 비용 최소화
- 원본 보존 정책: raw 파일 기본 보존, 디스크 사용량은 관리 화면에 표시

## 4. 판정 기준 체계

### 4.1 기본 탑재 기준 (웹 조사 검증 완료)

조건 분기가 있는 시방서 기준은 **조건별 별도 criteria 행으로 분리**해 시드한다:

| criteria name | 대상 | 출처 | metric | span_m | pass_mm | 검증 상태 |
|---|---|---|---|---|---|---|
| floor-kcs-finish7plus | 바닥, 마감두께 7mm 이상 | KCS 14 20 10 표 3.7-1 | flatness | 1 | 10 | 2차 출처 교차검증 |
| floor-kcs-finish7minus | 바닥, 마감두께 7mm 미만 | 〃 | flatness | 3 | 10 | 〃 |
| floor-kcs-exposed | 바닥, 제물치장·얇은 마감 | 〃 | flatness | 3 | 7 | 〃 |
| floor-molit-cushion | 바닥, 완충재 바탕(공동주택) | 국토부 바닥충격음 고시 | flatness | 3 | 7 | 조항 번호 재확인 필요 |
| floor-lh-exposed | 바닥, LH(제물치장·도장·벽지 바탕) | LHCS 14 20 10 05 표 3.11-7 | flatness | 3 | 6 | 원문 표 재확인 권장 |
| floor-lh-thick | 바닥, LH(마감두께 13mm 초과) | 〃 | flatness | 3 | 10 | 〃 |
| wall-kcs-tilt-exposed | 벽면 기울기(노출 모서리·줄눈) | KCS 21 50 05 §3.2.6 | flatness | 3 | 6 | 검증됨 |
| wall-kcs-tilt-other | 벽면 기울기(기타) | 〃 | flatness | 3 | 9 | 검증됨 |
| wall-kcs-plumb | 벽면 수직도(H≤30m) | KCS 21 50 05 §3.2.2 | plumbness | — | 25 (노출 모서리 13) | 검증됨 |
| wall-plaster-surface | 미장 바름면 | 주택건설 전문시방서 31310 | flatness | 3 | 3 | 원문 검증(현행 LHCS 승계 미확인) |
| wall-plaster-base | 미장 바탕면 | 〃 | flatness | 3 | 6 | 〃 |

- DIN 18202·ACI FF/FL은 **DB에 탑재하지 않고** 문서 참고 전용(직선자 방식과 환산 불가 또는 다단계 체계)
- 시드 thresholds JSON 예시: `floor-kcs-exposed → [{"span_m": 3, "metric": "flatness", "pass_mm": 7, "rework_mm": 21}]`, `wall-kcs-plumb → [{"span_m": null, "metric": "plumbness", "pass_mm": 25, "rework_mm": 75, "note": "H≤30m, 노출 모서리는 별도 행"}]`
- **주의**: KCS 원문 뷰어 직접 열람은 실패했고 복수 2차 출처로 교차 검증했다. 논문·공식 보고서 인용 전 원문 대조를 P5 태스크로 수행

### 4.2 기준 데이터 규약과 판정식

- `criteria.thresholds` 배열 규약: `[{span_m: number|null, metric: 'flatness'|'plumbness', pass_mm: number, rework_mm: number, note?: string}]` + `CHECK (jsonb_typeof(thresholds)='array')` + 앱 레벨 zod/pydantic 검증
  - `pass_mm` = 시방서 허용치. `rework_mm`는 시방서에 없는 운영값(기본 pass×3, UI에서 조정)
- **측정 불확도 U**: `app_settings` 테이블에 표면 유형별 저장. 잠정 초기값 **바닥 U=5mm, 벽면 U=8mm** (§1.3 문헌값 + 서브셀 중앙값·국소 스팬 평가로 무작위 노이즈가 억제되는 점을 반영한 잠정치). P5 반복 스캔 재현성 시험 후 갱신. 분석 시점 값이 `applied_criteria` 스냅샷에 U 포함으로 박제됨
- **판정식 (2026-07-28 2차 개정 — 축소 스팬에서 U도 동일 비율 환산)**: s=span_used/span(≤1), pe=pass×s, re=rework×s, **U_eff=U×s**, b1=pe−U_eff, b2=min(pe+U_eff, re)
  - 적합: 지표 ≤ b1
  - 경계(현장 재확인 필요): b1 < 지표 ≤ b2
  - 보수: b2 < 지표 ≤ re
  - 재시공: 지표 > re
  - 개정 근거: U를 고정하면 pe < U인 축소 스팬 셀(예: 3m 기준 7mm, U=5mm에서 span_used<2.14m)은 b1<0이 되어 완전 평탄면조차 '적합' 불가 — 구현 검증에서 가장자리 셀 전부가 경계로 오염됨을 확인. 드리프트 지배 측정 불확도는 기저선 길이에 대략 비례하므로 허용치·불확도를 같은 비율로 축소하면 4구간 구조가 모든 스팬에서 보존됨
  - 퇴화 케이스: pass+U ≥ rework이면(s와 무관) 보수 구간이 소멸(b2=re) — 결과에 "측정 불확도가 보수 구간을 잠식함" 경고 표기
- 전역 기본값(site_id NULL) + 현장별 재정의. `fn_resolve_criteria(site_id, surface_type)`는 **후보 목록 반환**(현장 기준이 있으면 현장 우선). criteria에 `is_default` 플래그((site_id, surface_type)당 1개, 부분 유니크 인덱스로 강제) — 업로드 화면의 기본 선택값
- 분석 실행 시점에 적용 기준 전체(이름·조항·thresholds·U)를 `analyses.applied_criteria`(jsonb) 스냅샷 — 기준 개정이 과거 분석·발행 보고서를 소급 오염시키지 않음
- **축소 스팬 환산**(3m 미만 소실): 가용 최대 직선 길이 L(1m ≤ L < span_m)로 측정하고 허용치를 `pass_mm × L / span_m`로 선형 환산(DIN 18202의 측점 간격별 다단계가 근사 선형인 점을 근거로 채택). L < 1m이면 판정 불가. 환산 적용 여부·L값을 stats와 보고서에 기록

## 5. 분석 파이프라인

### 5.1 단계 (바닥면)

1. **로드·검증**
   - 런치 파서: PLY(binary/ascii), LAS/LAZ(laspy), XYZ/TXT/CSV, PTS(ASCII). 청크 스트리밍/메모리맵. **좌표는 float64 원좌표로 읽고 센터링(bbox_min 차감) 후 float32 저장** (P1b 개정 — 즉시 float32는 UTM급 대좌표에서 cm급 지터). E57은 인터페이스만(§2.2)
   - 단위 감지: 바운딩박스·점 간격·추정 층고 휴리스틱으로 m/mm/cm 후보 제시 → **자동 확정하지 않고 근거와 함께 사용자 확인**. 불일치 시 처리 중단·명시적 입력 요구. 확정 단위·스케일 계수를 모든 산출물에 기록
   - 데이터 계보: 업로드 시 사용자 선택(원시 점군/융합 메시/모름) + 확실한 신호(PLY face 요소)만 자동 감지. 융합 메시면 "앱이 스무딩한 데이터로 실제보다 양호하게 나올 수 있음" 경고를 결과·보고서에 표기. 메시 입력은 면적가중 균일 재샘플링
2. **전처리**: 복셀 다운샘플 → 완화된 아웃라이어 제거(flying pixel 수준, 실제 결함점 보존) → 제거된 점 수·공간 분포 기록
3. **면 분할 (구역화)**: 법선(복셀 다운샘플 후 추정, 중력 +z 정렬)+높이 히스토그램 기반 다중 수평면 반복 추출 → 연결요소로 방/구역 분리 → RANSAC은 시드로만, 시드 평면 ±5cm 밴드 영역 성장으로 바닥 연속면 회수 → 법선 허용각 ±8°, 최소 면적·연결성으로 가구 상판 배제 → **coverage % 필수 산출**
4. **품질 검사**: 서브셀 높이 분포 쌍봉성으로 SLAM 유령층 감지 → 구역 판정 제외 + '재스캔 필요' 플래그. 셀별 점 밀도·법선 일관성 신뢰도 마스크 → 저신뢰·개구부 셀 '판정 불가'
5. **대표 높이면**: 5~10cm 서브셀 로버스트 대표높이(중앙값), 95퍼센타일 병기
6. **직선자 시뮬레이션 (판정 근거)**
   - **윈도우 기하 (2026-07-28 개정)**: 판정 셀(기본 1m)마다 4방향(0/45/90/135°)의 **셀 블록을 지나는 모든 서브셀 라인을 스윕** — 직선자를 셀 안 임의 위치에 대는 실물 검사와 동등. 셀 중심 라인만 검사하면 라인 밖 결함이 감쇠 측정되어 ±1mm 정확도 요구(§10.1)를 위반함이 구현 검증에서 확인되어 개정. 각 라인의 윈도우는 셀 중심 최근접점 기준 span_m 길이, 동일 구역 점만 사용, 프로파일별 상부 볼록 포락선 → 최대 틈새, 셀 값은 환산 허용치 대비 최악 라인. 윈도우 점유율 70% 미만 셀은 '판정 불가'. 그리드 경계 셀은 서브셀 1칸 손실(3m→2.95m)이 구조적으로 발생하며 축소 스팬 환산으로 흡수
   - LSQ 로컬 평면 방식은 파형 결함을 ~1/2 축소하므로 판정에 사용하지 않음
   - 3m 미만 공간은 §4.2 축소 스팬 환산
7. **판정·통계**
   - 셀별 직선자 값 → §4.2 판정식으로 4등급. 부호 규약: 바닥 **+ = 융기, − = 침하** / 벽면 **+ = 돌출, − = 함몰** (코드 상수·범례·테스트 고정)
   - **stats JSON 필수 필드**: 구역(벽체)별 max/min/mean 편차, 95퍼센타일, 기준 초과 셀 수·면적·비율, 구역 판정, coverage %, 경고 목록, 축소 스팬 적용 여부 — §7.5 결과표·§8 보고서 결과표 컬럼과 동일 항목 (과업지시서 '측정 구간별 최대·최소·평균 편차 및 기준 초과 결과' 충족)
   - 판정용 지표와 면적 산정 분리: 최대 틈새 발생 실제 위치(결함 기여 지점) 기록, 보수 면적 통계는 그 위치 기반 집계
   - 전역 최적 평면 편차는 '수평도(레벨)' 별도 지표 — 로버스트 피팅, 드리프트 경고 표기, 판정 미사용, 판정 히트맵과 나란히 배치하지 않음
8. **벽면**: 동일 체계(다중 수직 평면→구역화→직선자). 수직도(plumbness)는 중력 기준 보장 데이터에서만 절대값 산출, 미보장 앱은 벽면 간 상대 기울기만(앱별 검증 화이트리스트). 각도 불확도의 mm 환산 병기
9. **산출물** (Storage `artifacts/{analysis_id}/`)
   - stats.json, cells.json(셀 격자), heatmap.png(**판정 4색 + 판정 불가 회색 = 5색**, 색각 이상 대비 검증), viewer.bin(≤150만 점 다운샘플 점군+편차 색상), histogram.png, preview3d.png·preview3d_zoom.png(**워커가 matplotlib 등각 뷰로 서버측 렌더** — 전체 뷰 + 최대 결함 구역 확대. 헤드리스 WebGL 배제), results.csv(셀별 상세), 자동 종합의견 초안

### 5.2 성능 설계 (강제 제약)

- 원시 점군은 청크 스트리밍으로 읽어 **float64 센터링 후 float32 서브셀 비닝**(P1b 개정) — 원시 전체를 Open3D 객체로 만들지 않는다(Open3D는 다운샘플 이후에만 사용)
- 서브셀 충분통계량(n, Σx, Σxxᵀ) 누적 → 윈도우 연산 O(셀) (셀별 원시점 재수집 O(N×셀) 금지)
- 잡 type별 직렬 실행(§3.1). 목표: 3천만 점을 워커 1 vCPU/2GB에서 5분 이내 — **P1 초기에 3천만 점 합성 파일 메모리 스파이크 테스트 필수 태스크**, 미달 시 4GB 인스턴스(월 +$5~10)로 fallback 결정

### 5.3 자동 종합의견 (규칙 템플릿)

- 입력: 판정 분포, 최대 편차 셀 위치, 경고(유령층·낮은 coverage·융합 메시·불확도 잠식), 적용 기준
- 출력: 결과 해석 문구 + 주요 이상 구간 요약 + 보수/재시공 검토 대상 + 스크리닝 한계 고지. LLM 미사용(재현성·비용)

### 5.4 기존 분석 결과 임포트 (과업지시서 '분석 결과 자동 불러오기' 요구)

- 대상: 기존 Colab 노트북 산출 CSV(`X,Y,Z,Distance_mm,Signed_Distance_mm,R,G,B,Is_Uneven`) 및 결과 JSON(연계정보)
- 흐름: 업로드 화면에서 '기존 결과 가져오기' 선택 → import 잡 → 파싱·검증 → analyses 등록(`engine_version='external-colab-v1'`) → 히트맵·통계 등 산출물을 임포트 데이터로 재생성 → 대시보드·보고서에서 신규 분석과 동일하게 취급(단, '외부 결과' 배지 표기)
- JSON 연계 입력 스키마를 P1에서 정의 (과업지시서 기술 요구사항의 JSON 포맷 충족)

## 6. DB 스키마 (Supabase Postgres)

### 6.1 테이블

- **profiles**: id(uuid, FK auth.users), display_name
- **app_settings**: key, value jsonb — 측정 불확도 U(표면 유형별), 기타 전역 설정
- **sites**: id, name, address, memo, created_at, updated_at
- **locations**: id, site_id FK, building(동), floor(층 표기), floor_order(int), room(공간), name(측정위치), memo, UNIQUE(site_id, building, floor, room, name), 입력 trim 정규화, created_at, updated_at
- **scans**: id, location_id FK, surface_type enum(floor|wall), scanned_at, device, operator_id FK profiles(+ operator_name_manual nullable), **selected_criteria_id FK**(업로드 시 선택, 분석 잡 payload로 전달), raw_file_path, original_filename, file_format, point_count, unit_scale, data_lineage enum(raw|fused_mesh|unknown), status enum(uploaded|awaiting_unit_confirm|ready|archived|failed), deleted_at, created_at, updated_at, UNIQUE(id, surface_type)
- **analyses**: id, scan_id FK, surface_type(복합 FK 2개: (scan_id, surface_type)→scans, (criteria_id, surface_type)→criteria — 바닥 스캔에 벽 기준 적용 선언적 차단), criteria_id FK(ON DELETE RESTRICT), applied_criteria jsonb(U 포함 스냅샷), params jsonb, engine_version, status enum(queued|processing|done|failed), stats jsonb(§5.1.7 필수 필드), coverage_pct, overall_verdict enum(pass|borderline|repair|rework), warnings jsonb, cell_data_path, heatmap_path, viewer_data_path, histogram_path, preview3d_paths jsonb, csv_path, auto_summary, user_summary, is_current bool, **deleted_at**, created_at, created_by FK
  - `CREATE UNIQUE INDEX ON analyses(scan_id) WHERE is_current AND deleted_at IS NULL` — 삭제 시 is_current 동반 해제
- **criteria**: id, site_id nullable FK, surface_type, name, source_text, thresholds jsonb(§4.2 규약), **is_default bool**, is_active, version, supersedes_id, created_at
  - 부분 유니크: `(surface_type, name) WHERE site_id IS NULL AND is_active`, `(site_id, surface_type, name) WHERE site_id IS NOT NULL AND is_active` — **is_active 조건으로 버전 개정 가능**
  - is_default 강제: `(site_id, surface_type) WHERE is_default` 부분 유니크 (전역은 site_id NULL 별도 인덱스)
- **photos**: id, scan_id/location_id/site_id 중 정확히 하나(CHECK), file_path, caption, taken_at, created_at
- **reports**: id, **location_id FK(스코프 — 측정위치 단위로 확정, '공간 단위'는 채택하지 않음)**, title, status enum(draft|finalized), snapshot jsonb, opinion_text, pdf_path, created_by FK, created_at
  - **발행 시 참조 이미지 자산(히트맵·히스토그램·3D 프리뷰·사진)을 `reports/{report_id}/assets/`로 복사**하고 snapshot은 그 경로만 참조 — 원본 분석 삭제와 무관하게 PDF 재현 가능. finalized 후 snapshot·pdf_path 수정 트리거 차단
- **report_analyses**: report_id FK, analysis_id FK, sort_order, PK(report_id, analysis_id)
- **jobs**: id, type enum(precheck|analyze|import|report), payload jsonb, status enum(queued|processing|done|failed), attempts, max_attempts(3), run_after, locked_at, locked_by, error, created_at, started_at, finished_at
  - 클레임: FOR UPDATE SKIP LOCKED 단일 트랜잭션
  - 중복 방지: `COALESCE(payload->>'analysis_id', payload->>'scan_id', payload->>'report_id')` 기준 부분 유니크(WHERE status IN ('queued','processing')) — 전 타입 커버
  - 고착 회수: pg_cron, locked_at 초과 processing → queued 복귀 (analyses.status 동반 복귀를 `fn_job_transition` 함수로 캡슐화)

### 6.2 삭제 정책

- criteria: RESTRICT(비활성화로 대체)
- scans/analyses: soft delete(deleted_at) + Storage 정리 잡 enqueue — **단, finalized 보고서의 `reports/{id}/assets/`는 정리 대상에서 제외**
- reports(발행본): 상위 삭제 시 RESTRICT

### 6.3 보안 (RLS·Storage)

- 전 테이블 RLS 활성화. authenticated 전체 허용(내부용), criteria 전역 행·app_settings 수정은 admin 클레임
- jobs: 클라이언트 정책 없음(service_role 전용), enqueue는 SECURITY DEFINER 함수
- 경로 규약(불변 ID만, 생성 함수로 일원화): `raw-scans/{site_id}/{scan_id}/raw.{ext}`, `artifacts/{analysis_id}/…`, `photos/{photo_id}.{ext}`, `reports/{report_id}/…`
- **데모 단계**: raw-scans/artifacts/reports는 로컬 `data/` 디렉터리에 동일 경로 규약으로 저장(로컬 대시보드가 서빙), photos만 Supabase Storage(private 버킷+signed URL). 정식 배포 시 전 경로를 버킷으로 이전

## 7. 화면 설계

1. **로그인** — Supabase Auth 이메일
2. **홈(현장 목록)** — 현장 카드: 최근 측정일, 측정위치 수, 판정 분포 요약, 저장 용량 표시
3. **현장 상세** — 동/층/공간/측정위치 트리 + 측정 이력 + 현장 사진 관리
4. **스캔 업로드** — 위치 선택 → 파일 드래그 → 메타데이터(표면 유형·측정일자·담당자·데이터 계보·적용 기준: **fn_resolve_criteria 후보 목록 중 is_default 기본 선택**) → TUS 업로드 → **단위 확인 화면**(precheck 결과: 추정 단위·근거·계보 경고 → 확정 시 분석 잡 자동 등록) → 진행 상태(Realtime). '기존 결과 가져오기' 모드(§5.4) 포함
5. **분석 결과 (C안 확정)** — 좌측 시각화(히트맵/3D 토글, 셀 클릭→편차·프로파일 상세), 우측 고정 판정 패널(종합 판정 배지, §5.1.7 통계, 적용 기준, 경고 배지, 사진, 종합의견 편집), 하단 구간별 결과표(stats 필드와 동일 컬럼). 수평도(레벨)는 별도 접힘 섹션
6. **보고서 생성** — **같은 측정위치**의 분석 복수 선택(바닥+벽면) → HTML 미리보기 → 종합의견 수정 → PDF 생성·발행
7. **설정** — 판정 기준 관리(전역/현장별, 버전 이력, is_default 지정), 측정 불확도 U, 프로필

3D 뷰어: Three.js 점군 렌더(편차 색상/실색상 토글, 회전·줌·단면). 히트맵: Canvas 렌더 + 셀 인터랙션(판정 4색+판정 불가 회색)

## 8. PDF 보고서

- 구성: ①표지·기본정보(현장/동/층/공간/측정위치, 측정일자, 담당자, 장비, 적용 기준 명시) ②분석 개요(데이터 정보, 파라미터, coverage %, 측정 불확도 고지) ③구간별 결과표(수직·수평 섹션, §5.1.7 필드) ④시각자료(히트맵, **3D 프리뷰 PNG(§5.1.9 워커 생성분)**, 히스토그램, 현장 사진) ⑤종합의견(자동 초안+사용자 수정, 스크리닝 한계 문구 필수)
- 생성: 워커 Jinja2 HTML → Playwright Chromium → PDF. 한글 폰트(Noto Sans KR) 컨테이너 내장
- 데이터 소스: reports.snapshot + `reports/{id}/assets/` 복사본만 사용 (발행 후 원본 변경·삭제와 무관하게 재현)

## 9. 에러 처리

| 상황 | 처리 |
|---|---|
| 업로드 중단 | TUS 재개 가능 업로드 |
| 파싱 실패 | 잡 failed + 유형별 안내(지원 포맷·인코딩·예시) |
| 단위 불일치 | 처리 중단, 명시적 단위 입력 요구 |
| 바닥/벽 미검출 | failed + 원인 후보(가림·범위·기울기) 안내 |
| 유령층·낮은 coverage·융합 메시·불확도 잠식 | **실패가 아닌 경고 배지 딸린 결과** + 재스캔 가이드 링크 |
| 일시 오류 | 자동 재시도 3회(run_after 백오프) |
| 워커 크래시 | pg_cron 회수로 잡·analyses 상태 동반 복귀 |
| 판정 불가 셀 | 수치 강제 산출 금지, '판정 불가' 명시 출력 |
| 임포트 데이터 스키마 불일치 | 실패 + 기대 스키마 안내 |

## 10. 테스트 전략

1. **분석 엔진 (핵심)**
   - 합성 점군 픽스처: 평탄 바닥 + 정답 주입 결함(단차·국부 융기/침하·물결·설계 구배) + 노이즈 + 시뮬레이션 드리프트 → 정량 검증. **허용 오차: 직선자 값 ±1mm 이내, 결함 위치 셀 1칸 이내** (U는 픽스처의 파라미터)
   - 정답 산정 주의(2026-07-28 정정): "직선자 값"의 정답은 결함 높이가 아니라 **지지선 기하를 반영한 포락선 해석값**이다. 함몰·단차는 해석값 = 깊이/단차량(지지점이 주변 바닥)이지만, 볼록 결함(범프 h, 반경 r)은 직선자가 정점에 얹혀 해석값 ≈ h×(1−r/S)로 h보다 작다(실물 직선자도 동일). ±1mm 정밀 게이트는 함몰·단차 픽스처로 검증하고, 볼록 픽스처는 포락선 해석값 기준으로 단언한다
   - 직선자 포락선: 해석적 정답 프로파일(V홈·돌기·사인파) 단위 테스트
   - 파서: 포맷·앱별 샘플, 단위 휴리스틱 경계 사례. 임포트: Colab CSV 골든 파일
2. **DB/잡 큐**: 동시 클레임 경쟁(이중 실행 0건), 고착 회수, RLS 차단 테스트
3. **E2E**: Playwright — 업로드→단위 확인→분석→결과→보고서 PDF 전체 흐름
4. **실측 대조 (릴리스 게이트)**: 실제 현장 1곳 이상 3m 직선자 수동 측정 대조 + 반복 스캔 재현성으로 U 갱신(§4.2)
5. **검증 원칙**: 완료 주장 전 실제 실행·화면 캡처 대조 (사용자 상시 지시)

## 11. 구현 단계

**P1~P5는 각각 독립된 writing-plans 계획으로 작성한다** (P1 완료·검증 후 P2 계획 착수). P1은 수직 슬라이스로 분해:

1. **P1 분석 엔진 코어** (CLI로 독립 검증)
   - 1a: PLY+LAS 파서·단위 확인·단일 구역 바닥·직선자 판정·stats/히트맵 출력 — 끝까지 도달하는 최소 파이프라인
   - 1b: 다중 구역 분할·품질 검사(유령층·coverage)·XYZ/CSV/PTS 파서
   - 1c: 벽면 파이프라인(기울기·수직도)
   - 1d: 임포트(§5.4)·3D 프리뷰 PNG·메모리 스파이크 테스트(3천만 점)
2. **P2 인프라** — Supabase Free 스키마+RLS+잡 큐+로컬 워커 실행 구성 (파일 저장·잡 실행은 어댑터로 추상화해 정식 배포 시 Fly.io/Pro 전환 대비)
3. **P3 대시보드** — 로그인→현장 관리→업로드→단위 확인→결과 화면(C안)
4. **P4 보고서** — 통합 선택→미리보기→PDF 생성·발행(자산 복사)
5. **P5 검증·문서** — 실측 대조·U 갱신, 스캔 가이드라인 문서, 기준 원문 대조, **용역 결과 보고서 작성**(성과물 목록 매핑 포함)

## 12. 성공 기준

- 합성 픽스처: 직선자 값 오차 ±1mm·결함 위치 셀 1칸 이내
- 3천만 점 분석 5분 이내(2GB 제약 준수, 미달 시 4GB fallback 결정 기록)
- E2E 흐름(업로드→보고서 PDF) 무인 통과
- 실측 대조 상관 보고 + 반복 스캔 재현성 기반 U 갱신
- 과업지시서 세부과업 1 최종 성과물 전부 충족: 데이터 분류 체계·연계 기능·**기존 결과 불러오기**·수직/수평/통합 자동 정리·결과표/시각자료 자동 배치·해석/종합의견·표준 양식·미리보기/수정·PDF 저장

## 13. 참고 자료

- KCS 14 20 10 표 3.7-1, KCS 21 50 05 §3.2.2/§3.2.6, LHCS 14 20 10 05 표 3.11-7, 국토부 바닥충격음 고시, 주택건설 전문시방서 31310, DIN 18202 표2·3, ACI 117
- iPhone LiDAR 정밀도: Tondo et al. 2023 (Sensors), Luetzenburg et al. 2021 (Scientific Reports), Chase et al. 2022 (UNB TCRC), MDPI Virtual Worlds 앱 비교
- 기존 코드: floor_flatness_analysis.ipynb (Colab)

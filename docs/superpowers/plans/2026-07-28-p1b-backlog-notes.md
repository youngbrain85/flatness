# P1b~ 백로그 노트 (P1a 최종 브랜치 리뷰 이연 항목)

- 출처: P1a 최종 전체 브랜치 리뷰(2026-07-28, 49/51 테스트·성능 실측 포함) + 태스크 리뷰 이연 minor
- 용도: P1b/P1d/P2 계획 작성 시 필수 반영 티켓 목록. 항목별 근거는 git 히스토리의 리뷰 커밋 메시지와 스펙 개정 이력 참조

## P1b (다중 구역·벽면·파서 확장) 필수 티켓

1. [해결: P1b] **대좌표(georeferenced) 입력 float64 센터링** — las_reader/ply_reader가 실좌표를 즉시 float32 캐스트: UTM급 좌표(x~2e5, y~4e6)에서 ulp 3~50cm로 서브셀 비닝 지터·판정 붕괴. 수정: 청크를 float64로 받아 bbox_min(또는 LAS 헤더 오프셋) 차감 후 float32 캐스트 (조용한 품질 저하 클래스 — P2 실데이터 투입 전 필수)
2. [해결: P1b] **span_m=1.0 기준의 대각 방향 이산화 보정** — half=round(0.5/0.0707)=7 → 대각 풀 라인 L=0.99m < min_span 1.0로 전멸(floor-kcs-finish7plus 선택 시 4방향이 조용히 2방향). 보정: 대각 half=ceil 후 L_eff 캡 또는 `L ≥ min_span_m − step` 허용
3. **fit_plane_ransac n<3 가드** — 현재 pipeline의 `len(xs)<10` 가드에 의존. 다중 구역에서 구역별 호출 시 가드 유지 필수
4. [해결: P1b] .laz 픽스처 테스트 완료, PLY face-skip 전용 테스트 + 오류 경로 네거티브 테스트
5. 단위 모호 구간 경계(정확히 200/1000)의 포함 여부를 스펙 §5.1.1에 한 줄 명시

## P1b 최종 리뷰 이연 티켓 (2026-07-28)

[해결: P1c] 13. **경사 추종 구역화** — 고정 높이 밴드(±5cm)라 경사 슬래브에서 커버리지 붕괴(실측: 경사 1.0%→100%, 1.7%→68.3%, 2.5%→45.8%). 스펙 §5.1.3 원설계(시드 평면 ±5cm 밴드 영역 성장)로 교체 필요 (P1c/P2)
[해결: P1c] 14. **low_coverage 경고** — 스펙 §5.3이 정의한 "낮은 coverage" 경고를 엔진이 미발행. 임계(예: <70%) 미달 시 warnings에 추가 (수 줄)
[해결: P1d] 15. **텍스트 리더 방어** — nan/inf 토큰이 유효 점으로 수용되어 무의미한 오류 메시지 유발(isfinite 필터 1줄), 소수점 쉼표 로케일은 조용한 오파싱 위험
[해결: P1c] 16. **coverage_pct 계산의 build_stats 편입** — 현재 파이프라인 덮어쓰기 방식이라 P1c가 build_stats 직접 재사용 시 다른 의미의 값이 조용히 출력됨 (P1c 착수 시 필수)

## P1d (성능·마무리) 티켓

6. **전 라인 스윕 벡터화** — 실측 ~22ms/셀(셀 수 선형): 10×10m 2.0s / 40×40m 37.6s. 100×100m(10k셀) ≈ 4분으로 5분 게이트 압박 → `_profile`/헐 루프 벡터화(라인당 fancy-index)로 10배+ 여지
7. 노이즈·드리프트 주입 픽스처 게이트 — 스펙 §10.1 요건, ±1mm 게이트의 노이즈 강건성 미검증 상태
8. 서브셀 정렬 기반 중앙값의 메모리(~12바이트/점) 실측 — 3천만 점 스파이크 테스트(계획 1d 기존 항목)

## P2 (인프라 통합) 티켓

[해결: P2] 9. **stats.json/cells.json 스키마 계약 문서화** — 반올림 정책(stats worst.point 비반올림 vs cells 3자리) 통일 포함. 대시보드·보고서가 소비하는 첫 외부 계약
10. CLI 예외 UX — FileNotFoundError 등 ValueError 외 예외가 트레이스백 노출(검증 스모크에서 실제 재현, exit 1 계약은 유지됨). 워커 래핑 전 정리
11. 히트맵 축이 그리드 원점(bbox_min) 무시 — 절대좌표 스캔에서 stats와 축 라벨 불일치
12. stats worst 선정 기준(raw mm 최대 vs 심각도 정규화) 정의 확정 — P3 대시보드 문구 설계와 연동

## P1c 최종 리뷰 이연 티켓 (2026-07-28) — P2 실데이터 투입 전 필수 3건 포함

[해결: P1d] 17. **[P2 전 필수] 벽별 오류 격리** — 한 벽의 투영/피팅 실패(ValueError)가 전체 분석 중단 + 부분 히트맵 잔존. 벽 루프 try/except → skip+경고
[해결: P1d] 18. **[P2 전 필수] 천장 접합부 마진** — edge margin이 하단만 적용, 천장 포함 실스캔에서 벽 상단 행 오염. `v <= z_max - edge_margin_m` 1줄
[해결: P1d] 19. **[P2 전 필수] walls_out 월드 프레임 직렬화** — p0/direction/normal·u,v 오프셋 부재로 stats만으로 3D 역매핑 불가 (P2 스키마 계약 전에)
20. 성장-분류 순서 결정 — 성장이 furniture/ghost 분류 전 실행되어 임계 회피 경로 존재(발생 확률 낮음). 순서 결정 + 가구 3m² 경계 테스트
[해결: P1d] 21. engine_version·meta.surface 정리 — floor 경로 스탬프 갱신 누락("p1b-0.2.0"), floor meta에 surface 부재
[해결: P2] 22. coverage_pct 표면 간 이중 의미(floor=서브셀 인식률, wall=셀 유효율) — P2 스키마 문서에 명시
23. T-접합 교차벽 밴드 오염, 파일 K+2회 패스(성능), 벽 히트맵 축 라벨(u/v), bin_m 매직 상수 공유, 스펙 §5.1.7 대칭 파티션 부호 캐비앗
[해결: P1d] 24. **천장 포함 스캔 팬텀 벽** — cnt_mid(중간 대역 점유) 조건으로 근본 해소 (P1d Task 1에서 발견·수정)

## P1d 최종 리뷰 이연 티켓 (2026-07-28)

[해결: P2] 25. **[P2 필수] §5.4 JSON 연계 입력 스키마 정의** — 과업지시서 명시 항목인데 P1에서 CSV 임포트만 구현됨. P2 스키마 계약 문서(티켓 9·22)와 함께 정의할 것
26. cnt_mid 중간 대역 앵커를 전역 min/max 대신 강건 백분위(z p1/p99)로 — 고고도 이상점 1개가 팬텀 벽 후보를 부활시킬 수 있음
[해결: P2] 27. P2 스키마 계약 문서에 조건부 키 열거 필수 — preview3d_paths(floor만)·walls(wall만)·import meta scale_to_m 부재·warnings의 wall_{i}_skipped 개방 패턴·히트맵 파일명 관례, coverage_pct 3중 의미(floor=서브셀 인식률, wall/import=셀 유효율)
28. 벽 루프 render_heatmap이 try 밖(비-ValueError 렌더 실패 시 전체 중단 가능), import-colab의 벽 기준 거부 문구가 "알 수 없는 기준"으로 부정확
29. **P2 이연**: SupabaseRest.set_current_analysis 2단계 PATCH 비원자성(데모 단일 워커라 수용, 정식 배포 시 단일 RPC로 원자화)

## P3 최종 리뷰 이연 티켓 (2026-07-28)

[해결: P4] 30. **fn_reap_stuck_jobs 잡 타입 확장**: 003이 fn_job_claim·fn_job_fail을 `in ('analyze','import')`로 확장했으나 fn_reap_stuck_jobs(002)의 2단계는 여전히 `j.type = 'analyze'`만 검사. import 잡이 워커 크래시로 리핑되면 연결 analyses.status가 'processing'에 일시 고착(재클레임·완료 시 자가치유되므로 비차단). worker/tests/fake_db.py의 대응 로직도 함께 확장할 것
31. 대시보드 테스트 스텁이 Supabase 체인 형태에 결합(공유 스텁 헬퍼로 추출 권고), login-form onSubmit 커버리지 0
32. 사진 Storage 업로드 후 photos insert 실패 시 고아 객체 정리 없음(정식 단계에서 정리 잡과 함께)
33. 업로드가 파일 전체를 메모리에 적재(현재는 50MB 상한·content-length 선검사로 방어) - 정식 단계에서 스트리밍 저장으로 전환
34. app/error.tsx·loading.tsx·not-found.tsx 부재(서버 컴포넌트 예외 시 Next 기본 화면), 로그인 화면에도 전역 Nav 렌더, verdict-panel이 stats.worst 좌표 미표시

## 데모 실행에서 확인된 사안 (2026-07-29)

35. **스캔 노이즈가 판정을 지배함 (P5 실측 대조와 함께 검토)** — 8x6m 합성 바닥 데모로 정량 확인: 노이즈 0에서는 12mm 함몰을 11.71mm로 정확히 측정하고 적합 36/경계 12로 판정되지만, 노이즈 sd 2mm(실제 모바일 LiDAR 수준)를 넣으면 평탄부가 4.7~6.5mm로 읽혀 **전 셀이 경계 이상**(적합 0/경계 44/보수 4)이 되고 최대값도 14.86mm로 부풀었다. 직선자 포락선이 최악값을 취하므로 랜덤 노이즈가 그대로 편차로 계상되는 구조적 특성이다. 대응 후보: (a) 서브셀 집계 강화(중앙값 창 확대), (b) 포락선에 강건 백분위 적용(티켓 26과 같은 방향), (c) U를 실측 재현성으로 재설정(스펙 §4.2가 예정한 P5 작업). 재현: `data/demo/`의 생성 스크립트 참조(엔진 tests/fixtures/synthetic.py의 flat_floor+add_bump)

## 기록용 이연 minor (비차단)

- test_ply_roundtrip 이름 과장(파일 생성 확인 수준), severity 동률 타이브레이크 주석 부재, load_criteria 커스텀 경로 with 미사용, test_criteria 일부 주석 기호 위주, iter_chunks 지연 검증 특성, _ORDER 밖 등급 일반 ValueError, CLI 스크리닝 문구가 스펙 리터럴과 괄호만큼 상이(의미 동일)

## P4 이연 티켓 (2026-07-29)

36. **측정위치 단위 사진 업로더** — 스펙 §8 ④의 "현장 사진"은 측정위치 스코프지만 현재 UI는
    site·scan 사진만 등록할 수 있어, 보고서는 포함 분석의 스캔 사진 합집합을 사용한다.
    location 타깃 업로더를 추가하면 스펙 문구와 완전히 일치한다
37. **컨테이너 한글 폰트 내장** — 보고서 템플릿의 폰트 폴백은 Windows 개발 PC에 설치된
    Noto Sans KR·맑은 고딕에 의존한다. 리눅스 컨테이너 배포 시 이미지에 Noto Sans KR을
    설치하지 않으면 한글이 네모 상자로 출력된다(스펙 §8 "한글 폰트 컨테이너 내장")
38. **보고서 자산 정리 잡** — 스펙 §6.2는 scans/analyses soft delete 시 Storage 정리 잡을
    예정했고 finalized 보고서 자산은 정리 대상에서 제외해야 한다. draft 보고서를 삭제하는 UI와
    `reports/{id}/` 정리 잡은 미구현
39. **E2E(Playwright) 자동화** — 업로드부터 보고서 PDF까지의 무인 통과 검증(스펙 §10.3·§12)은
    여전히 수동 체크리스트다
40. **보고서 HTML 미리보기** — 스펙 §3.2.⑥의 "HTML 미리보기"는 PDF 미리보기(iframe)로 대체했다.
    PDF 생성 전 단계에서 HTML을 먼저 보여주려면 워커가 HTML만 만드는 중간 상태가 필요하다

## P4 최종 픽스웨이브 이연 티켓 (2026-07-29)

41. **reap 30분 창** — 워커가 크래시한 뒤 30분 이내에 재기동하면 fn_reap_stuck_jobs가
    아직 고착 잡을 회수하지 않아 report 잡이 processing에 머무른다. analyze/import는
    재클레임·완료 시 자가치유되지만, report는 이 상태가 대시보드에 "생성 중"으로 영구
    표시되는 UI 데드엔드로 가시화된다(재기동 후 30분을 기다리거나 수동 개입 필요)
42. **003 storage 정책이 프로젝트별로 42501 실패 가능** — supabase/migrations/
    003_dashboard_support.sql의 photos 버킷 정책 생성문이 프로젝트 설정(Storage RLS
    강제 등)에 따라 SQL Editor에서 42501로 실패할 수 있다. 실패 시 Storage > Policies
    UI로 동일 정책을 만드는 대체 절차를 docs/SUPABASE_SETUP.md에 추가해야 한다
43. **히스토그램 한글 폰트가 엔진 heatmap import 부수효과에 의존** —
    worker/flatworker/report/assets.py의 render_histogram은 matplotlib 한글 폰트
    설정을 직접 하지 않고 `from flatness.outputs import heatmap as _engine_heatmap`
    import의 부수효과에 얹혀 간다. 엔진 쪽 import 순서나 폰트 설정 구현이 바뀌면
    보고서 히스토그램만 조용히 한글이 네모 상자로 깨질 수 있어, 보고서 모듈이 폰트
    설정을 직접 소유하도록 정리 필요
44. **히트맵 범례 문구가 snapshot palette 대신 하드코딩** — reports.snapshot의
    palette(grade_order/grade_labels/grade_colors, worker/flatworker/report/labels.py)는
    발행 시점 등급 라벨·색상을 박제해 HTML/PDF 표의 재현성을 보장하지만, 히트맵
    이미지 자체(engine/flatness/outputs/heatmap.py의 GRADE_COLORS/_LABELS, 엔진 산출물을
    자산으로 그대로 복사)의 범례 문구는 렌더 시점 값이 이미지에 박혀 있다. 향후 등급
    라벨이 바뀌면 이미 발행된 보고서의 PDF 안에서 히트맵 이미지 범례와 표 문구가
    서로 어긋날 수 있다
45. **보고서 생성 실패 사유가 페이지 이동으로 가려짐** — report-create-form이 링크 insert나
    엔큐 실패 시 setError 직후 router.push로 상세 화면에 이동해, 최초 실패 사유 문구가
    사용자에게 보이지 않는다(복구 경로 자체는 열려 있다: 상세에서 "PDF 다시 생성" 노출,
    재시도 실패는 즉시 표시). 토스트 또는 쿼리 파라미터로 사유를 상세 화면까지 전달하면
    완결된다. P3에서 같은 패턴(업로드 폼)을 한 번 수정한 이력이 있다

## 판정식 경고 사각지대 대응 중 발견한 이연 티켓 (2026-07-31)

46. **수직도 "노출 모서리" 기준 변형 미구현** — 정본 스펙
    (docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md §4.1 표, 114행·119행)이
    wall-kcs-plumb에 대해 "25mm (노출 모서리 13)"과 "노출 모서리는 별도 행으로 분리해
    시드한다"를 명시하는데, engine/flatness/data/seed_criteria.json·
    supabase/migrations/002_functions_seed.sql 어디에도 13mm 행이 없어 노출 모서리 부위가
    완화된 25mm로 판정된다. 단순히 시드 행만 추가하면 되는 문제가 아니다:
    engine/flatness/core/walls.py의 evaluate_wall이 load_criteria()["wall-kcs-plumb"]로
    수직도 기준을 코드에 고정해 조회하므로, 변형을 쓰려면 (a) 스캔 업로드 시 평활도 기준과
    별도로 수직도 기준도 선택하게 하거나 (b) 벽별로 노출 모서리 여부를 지정하는 UI가
    필요하다. 설계 변경 규모라 별도 티켓으로 분리한다
47. **벽면 기준과 잠정 U(8mm)의 부정합** — uncertainty_swallows_pass/
    uncertainty_swallows_repair 경고(criteria.py의 grade_value)로 가시화는 되지만 근본
    해소는 아니다. 벽면 평활도 기준 4종 중 3종이 U=8mm에서 적합 판정 불가
    (wall-kcs-tilt-exposed 6-8=-2, wall-plaster-base 6-8=-2, wall-plaster-surface 3-8=-5),
    정상인 1종(wall-kcs-tilt-other)도 여유가 1mm뿐이다. U는 실측 재현성으로 갱신되어야 하는
    잠정치(스펙 §4.2)이므로, 실측 대조 수행 시 벽면 U를 우선 재설정해야 벽면 판정이 실질적
    의미를 갖는다. 그 전까지 벽면 결과는 "경계 이상" 위주로 나오는 것이 정상 동작임을
    문서·화면에서 안내할 필요

## task1-finish 코드 리뷰(C1/I1-3/M1-3) 이연 티켓 (2026-07-31)

- 출처: task1-finish 브랜치 코드 리뷰(재분석 잡 타입 오분기 C1 등) 대응 중 발견, 수정 대신
  기록만 남기기로 한 항목들

48. **[M5] 업로드 API 확장자 검증이 스캔/임포트 모드를 구분하지 못함** —
    `app/api/upload/route.ts`의 `_ALLOWED_EXTS`가 스캔용·임포트용 확장자의 합집합이라
    서버가 두 목적을 구분해 검증하지 못한다(`upload-form.tsx`의 폼이 `mode`를 서버로
    전달하지 않음). `.json`을 스캔 모드로 올려도 서버는 통과시키고, 이후 precheck
    단계에서 실패로만 드러난다 — mode를 폼데이터에 실어 보내 서버에서도 모드별로
    분리 검증해야 한다
49. **[M6] 영구 설정 오류가 무한 재시도로 오인될 수 있음(I2 도입에 따른 새 이연)** —
    `httpx.UnsupportedProtocol`/`ConnectError`도 `TransportError` 계열이라,
    `SUPABASE_URL` 오타 같은 영구 설정 오류가 워커 기동 후 60초 간격(runner.py의
    `_MAX_BACKOFF_S`) 무한 재시도로 이어질 수 있다(이전에는 즉시 크래시로 원인이 바로
    드러났음). 연속 실패 N회 이후 경고 수준을 격상(예: 로그 강조·알림)하는 방안 검토 필요
50. **[M4] 업로드 화면 "측정위치 추가하러 가기" 링크가 site 컨텍스트를 무시** —
    `app/upload/page.tsx`의 해당 링크가 항상 `sites[0]`으로 이동한다.
    `searchParams.site`가 있으면 그 현장을 우선해야 사용자가 방금 선택한 현장 맥락이
    유지된다
51. **[M8] 재분석의 409(중복 엔큐) 처리 경로는 실제로는 도달 불가** —
    `jobs_dedup`은 `payload->>'analysis_id'` 기준 부분 유니크인데, 재분석
    (`reanalyze-button.tsx`)은 매번 새 UUID로 analyses 행을 만들므로 동일
    analysis_id가 중복 enqueue될 상황 자체가 생기지 않는다. 방어 코드 자체는 무해하나,
    관련 회귀 테스트("중복 엔큐(409)면...")가 실제로는 도달하지 않는 경로를 검증하고
    있다는 점을 기록해 둔다(코드/테스트 정리는 우선순위 낮음)
52. **tsc 오류 2건(BASE부터 존재, 비차단)** —
    `dashboard/lib/hooks/__tests__/use-row-status.test.ts`에 BASE 커밋 시점부터 있던
    타입 오류 2건이 남아 있다. `npm run lint`·`npm run build`·`npm run test`는 모두
    통과하므로(타입 체크가 별도 단계로 빠져 있어 이 오류들을 가리지 않음) 지금까지
    가시화되지 않았을 뿐이다 — 별도 정리 대상으로 남긴다
53. **`_list_recursive` 페이지네이션 부재(I-2)** — `worker/flatworker/storage.py`의
    `SupabaseStorage._list_recursive`가 `limit:1000, offset:0`으로 고정돼 있어 한
    폴더의 객체 수가 1000개를 넘으면 그 뒤가 나열되지 않아 `delete_prefix`의 삭제
    누락으로 이어진다. 현재 산출물 규모로는 도달하기 어려우나, 실사용 데이터가
    쌓인 뒤 재확인 필요
54. **`build_assets`의 부분 실패 창(I-4)** — `delete_prefix` 후 `upload_dir` 도중
    실패하면 DB는 옛 snapshot을 유지한 채 원격 자산은 옛 것은 지워지고 새 것은
    일부만 존재하는 상태가 되어, 그 시점에 대시보드가 깨진 이미지를 보여줄 수
    있다. 잡 재시도로 자가 치유되지만 네트워크 업로드는 로컬 복사보다 중간 실패
    확률이 높다. analyze/import는 `_finalize`가 `upload_dir` 완료 후에만 실행돼
    해당 없음 — report 경로만의 문제
55. **`raw_scans_all_auth` RLS가 경로 소유권을 검사하지 않음(I-3)** — 로그인한
    사용자가 다른 현장의 원본 스캔을 덮어쓰거나 삭제할 수 있다(001 `all_auth`·003
    `photos_all_auth`와 같은 트러스트 모델의 연장이며 신규 구멍은 아니다). 원본
    스캔은 증거 자료이므로, 다중 기관 사용으로 확장할 때 경로 스코프 정책
    (`storage.foldername(name)[1] = site_id` 등)으로 좁힐 것
56. **`report_dir()` 데드 코드** — Task 5의 `upload_local_data.py`를 위해 남겨
    두었으나 현재 호출부도 테스트도 없다

## 클라우드 배포(Task 5) 문서화 중 발견한 사안 (2026-08-01)

57. **RLS가 사용자/조직 단위 격리를 하지 않는다(전 테이블 공통)** —
    `supabase/migrations/001_schema.sql`의 `all_auth` 정책
    (`create policy all_auth on sites for all to authenticated using (true) with check (true);`)이
    `sites`·`locations`·`scans`·`analyses`·`photos`·`reports`·`report_analyses` 7개
    테이블 전부에 동일하게 걸려 있어, 로그인한 사용자라면 누구나(다른 사용자·다른
    조직 소유분을 포함해) 전체 행을 읽고 쓰고 지울 수 있다. 티켓 55
    (`raw_scans_all_auth`, Storage RLS)와 같은 트러스트 모델을 DB 테이블 레벨까지
    확장한 것일 뿐 신규 구멍은 아니며, 스펙 §6.3 "연구실 로그인 사용자 전원 동일
    권한"이 원래 의도한 설계다. 문제는 저장소가 곧 공개(public)로 전환되고 대시보드도
    공개 URL로 배포된다는 점 — 종전에는 "저장소 비공개 + 알음알음 로그인"이 암묵적
    방어선이었지만 그 전제가 사라진다. **현재는 배포 절차(`docs/DEPLOY.md` §1)에서
    Supabase Authentication > Providers > Email의 "Enable Sign Ups"를 꺼서 계정 생성
    자체를 막는 것으로 방어한다** — 신뢰 경계를 "로그인 여부"에서 "계정 존재 여부"로
    옮긴 것뿐이라, 여러 조직이 같은 배포를 나눠 써야 하는 시점에는 통하지 않는다.
    다중 조직 지원이 필요해지면 각 테이블에 소유권 컬럼(예: `org_id`)을 추가하고
    정책을 `using (org_id = ...)` 류로 재설계해야 한다

58. **잡 등록 실패로 되돌린 스캔의 Storage 객체가 남는다** — `upload-form.tsx`는
    엔큐 실패 시 `scans`·`analyses` 행을 soft delete로 되돌리지만, 그 직전에
    `uploadRawScan`이 이미 `raw-scans` 버킷에 올려둔 원본 파일은 지우지 않는다.
    DB에서 참조가 사라졌으므로 화면·판정에는 영향이 없으나 Free 티어 총 1GB
    한도를 야금야금 갉아먹는다. 여기서 Storage 삭제까지 시도하면 그 삭제가
    실패했을 때 사용자에게 보여줄 상태가 하나 더 늘어 복잡해지므로 이번에는
    의도적으로 남겼다. 해소하려면 참조 없는 `raw-scans` 객체를 주기적으로 쓸어
    담는 정리 잡(워커 측)이 적절하다 — 삭제를 업로드 실패 경로에 인라인하지 말 것

59. **Vercel 함수 리전이 Supabase와 다른 대륙에 있다(페이지 이동 지연)** —
    Supabase는 서울(`ap-northeast-2`)인데 Vercel 함수는 워싱턴(`iad1`)에서 돈다
    (인증된 동적 요청의 `x-vercel-id` 헤더로 확인). 페이지 이동 한 번에 Supabase
    왕복이 최소 2회 순차로 걸리고(proxy.ts의 세션 확인 1회 + 페이지 조회 1회),
    모든 페이지가 `force-dynamic`이라 이동마다 반복된다. 예열 후 홈 RSC 요청
    실측 중앙값 **576ms**(8회, 최소 554ms).
    **미해결**: Vercel 대시보드의 Function Region을 서울로 바꿔 저장했으나 두 번
    모두 `iad1`로 되돌아갔다(Redeploy가 빌드 캐시를 재사용했을 가능성). 코드로
    거는 것도 불가 - Next 16 문서상 Vercel에서 `preferredRegion`은 edge 런타임의
    `auto/global/home`만 받고 리전 코드를 못 쓴다.
    **시도 3회 전부 실패(2026-08-02~03).** 3회차는 실제 git push로 새 빌드가 돈
    직후에 걸었는데도 저장 후 페이지를 다시 열면 `iad1`로 복귀했다. 즉 원인은
    배포 타이밍이 아니라 **설정 저장 자체가 반영되지 않는 것**이다. 가장 그럴듯한
    설명은 Hobby 플랜에서 이 선택이 실효가 없다는 것(UI는 고르게 해주지만 서버가
    기본 리전을 유지). Fluid Compute가 켜져 있어 Vercel이 리전을 자체 관리하는
    것일 가능성도 있으나 검증하지 않았다 - 끄면 동시성 모델이 바뀌는 별개의
    설정 변경이라 이 티켓 범위를 넘는다.
    **더 시도하지 말 것.** 같은 조작을 반복하는 것은 비용만 든다. 실효가 있는
    길은 둘이다: (a) Pro 승급 시 리전 지정이 되는지 확인, (b) 왕복 횟수 자체를
    줄인다 - proxy.ts의 세션 확인이 페이지마다 1왕복을 더하므로 그쪽이 크다.
    **하지 말 것**: Supabase를 미국 리전으로 옮기기. 생성 후 리전 변경이 불가해
    프로젝트를 새로 만들어야 하고, 브라우저가 Storage에 직접 업로드하는 구조라
    업로드가 대신 느려진다

60. **구배 보정량(`correction_mm`)이 경사 방향을 보지 않는다** — `slope.py`의
    `grade_slope_cells`가 `d * min(width_m, height_m) * 10.0`으로 환산한다. 정사각
    셀(2.0×2.0m)에서는 정확하지만, 가로세로가 다른 가장자리 셀에서는 경사가 긴
    축을 따라 흐를 때 양단 높이차를 과소 보고한다. 실측: 1.0(폭)×2.0(높이) 셀에서
    +y 방향 경사일 때 실제 양단차 19.92mm를 9.96mm로 절반만 보고했다. **과소 =
    보정이 덜 안전한 방향**이다. 영향 범위는 폭 또는 높이가 [1.0, 2.0)인 가장자리
    셀에 한정되고(그 밑은 판정불가로 배제된다) 등급을 좌우하지 않는 참고값이라
    단계 B 머지를 막지 않았다. 정답은 `downhill_rad`를 셀 축에 투영해 그 방향의
    실제 스팬으로 환산하는 것 - 즉 `abs(cos)*width + abs(sin)*height`

61. **2m 비배수 방에서 벽 접합부 띠가 미판정으로 남는다** — 단계 B가 격자
    가장자리 조각 셀(폭 또는 높이 < 1.0m)을 판정에서 뺐다. 짧은 baseline에서
    구배 편향이 등급을 양방향으로 뒤집었기 때문이고(재시공을 보수로 완화하는
    방향 포함), 잔차에 안 잡히는 편향이라 불확도가 막지 못했다. 대신 방 크기에
    따라 커버리지가 정직하게 떨어진다 - 실측 10.3×8.5m는 66.7%, 6.4×4.8m는
    50.0%, 12.5×7.5m는 85.7%(9.1×7.3, 15.0×11.0 등 조각이 1.0m 이상인 방은 100%
    유지). 현재는 `warnings`에 개수와 사유를 남기는 것으로 가시화했다. 근본
    해소는 조각 셀을 이웃 셀에 병합해 baseline을 확보하는 것인데, 병합 셀의
    대표 위치·면적 가중을 새로 정의해야 해서 별도 작업이다

## 세부과업 4 단계 C 최종 이연 티켓 (2026-08-03)

- 출처: 단계 C(마이그레이션 007 + 워커 kind 분기 + 구배 기준 시드) 완료 후 태스크 5
  (락스텝 안전장치·배포 문서) 작성 중 브리프 Step 5 및 재리뷰에서 발견·기록

62. **구배 `warnings` 어휘가 평활도(ASCII 슬러그)와 달리 완성 한국어 문장이라 코드
    기반 필터링이 불가능하다** — 평활도는 슬러그를 `WARNING_LABEL`로 번역해 표시하는데
    구배는 엔진이 만든 완성 문장을 그대로 저장한다. `reports.snapshot`에 그대로
    박제되면 영구화된다. 어휘를 통일하려면 엔진 수정(단계 B 재개봉)이 필요해 알면서
    남기는 부채다

63. **`slope_cells.csv`가 `utf-8-sig`(BOM)인데 평활도 `results.csv`는 `utf-8`이다** —
    단계 D에서 CSV를 파싱하면 첫 열 이름이 `\ufeffcx`로 읽힌다

64. **구배에는 `cells.json`에 해당하는 파일이 없다** — 단계 D의 셀 표는
    `slope_cells.csv` 파싱이 필요하다

65. **`render_slope_map` 실패가 격리돼 있지 않다**(`pipeline.py:210`) — 렌더가 죽으면
    `slope_stats.json`이 없는 반쪽 산출물이 된다. 평활도가 티켓 I1 이후 확립한 "렌더
    실패가 판정을 죽이지 않는다" 원칙이 구배에는 적용되지 않았다

66. **`analyze_slope`는 잘못된 단위나 벽 스캔에도 예외를 던지지 않고 "전 셀
    판정불가로 성공"한다** — 평활도의 조기 실패(`pipeline.py:38-39,44`)에 대응하는
    방어가 없다

67. **`cell_m`의 출처가 정해지지 않아 엔진 기본값 2.0이 조용히 고정된다** — 나중에
    바꾸면 과거 분석과 비교가 깨진다

68. **`test_db.py`의 `set_current_analysis` 테스트가 PATCH body를 단언하지 않는다** —
    재리뷰어가 변이(mutation)로 확인: 두 PATCH의 `json={"is_current": ...}` 값을 서로
    맞바꿔도 106개가 전부 통과한다. 프로덕션에서 이 변이는 같은 (scan, kind)의 다른
    분석들을 전부 `is_current=True`로 올려 유니크 위반(23505)을 내거나 엉뚱한 분석을
    현재로 만든다. `request.method`와 `json.loads(request.content)` 단언을 추가하면
    닫힌다. 현재 코드는 정상 동작이라 배포를 막는 사유는 아니다

69. **`FakeDB`가 PATCH①(is_current 해제)을 모델링하지 않는다** — dict 덮어쓰기로
    근사할 뿐이라 어느 PATCH가 True를 쓰고 어느 쪽이 False를 쓰는지가 페이크에게
    보이지 않는다. 티켓 68과 근본 원인이 같다

70. **`SlopePlaceholder`가 값의 타입이 틀린 경우엔 여전히 던진다** — 키 부재는
    막았지만 `mean_dev_pct`가 문자열이면 `v.toFixed is not a function`. 방어하려면
    `isSlopeStats`를 형태 검증기로 승격하는 별개 설계 판단이 필요하다

71. **`worker/flatworker/db.py:11`의 docstring이 `fn_resolve_criteria` 2인자
    시그니처를 정본이라 적고 있다** — 007이 `p_kind` 인자를 추가해 3인자 시그니처로
    교체했다(`007_slope_analysis.sql` 참고). 워커가 이 RPC를 실제로 호출하지 않아
    무해하지만 007 이후로는 틀린 기록이다

72. **단계 C에서는 아무도 `analyses.params`에 `drain_points`를 넣지 않는다** —
    배수구 클릭이 단계 D의 몫이라, 지금 돌리는 모든 구배 분석은 방향 판정이 꺼진 채
    크기만 판정한다. stats의 `warnings`에 그 사실이 남는다(정상 동작이지만 단계 D
    전까지의 한계로 기록)

## 세부과업 4 단계 D 최종 이연 티켓 (2026-08-04)

- 출처: 단계 D(구배 결과 화면·배수구 클릭·재판정, 태스크 1~5) 완료 후 태스크 6
  (문서·백로그 마감) 작성 중 사전 결정 기록 및 각 태스크 리뷰가 실제로 찾아낸 것들

73. **[사용자 결정] 구역별 통계(§5.4) 미구현** — 기존 구역화(`core/zones.py`의
    `detect_levels`+`build_zones`)가 경사 바닥에서 작동하지 않는다는 실측 근거로
    이번 단계 스코프에서 뺐다. 16m×16m **단차 없는 단일 평면**에 돌린 결과:

    | 경사 | 검출 레벨 | 생성 구역 |
    |---|---|---|
    | 0.5% | 1 | 1 |
    | 1.0% | 2 | 2 |
    | 1.5% | 3 | 3 |
    | 2.0% | 2 | 2 |
    | 3.0% | 0 | **0** |

    원인은 `detect_levels`(`core/levels.py:5`)가 높이 히스토그램의 봉우리를 찾는데
    **경사면은 높이가 균일 분포라 봉우리가 없다는 것**이다 — 노이즈로 생긴 우연한
    봉우리를 레벨로 잡거나(0.5~2.0%), 어떤 빈도도 `min_frac`을 못 넘어 레벨이
    0개가 된다(3.0%). **구배 분석의 대상이 바로 설계상 기울어진 배수 바닥이므로
    이 실패가 정상 케이스다** — 붙이면 화면이 존재하지 않는 "구역 1/2/3"의
    통계를 내거나 전 셀 `zone_id=null`이 된다.

    대안은 평면 계수 `(a,b,c)`의 불연속으로 구역을 가르는 판별식(레벨 히스토그램이
    아니라 `compute_slope_cells`가 이미 셀마다 산출하는 평면 기울기 자체를 군집화
    기준으로 쓰는 방향). 덧붙여 스펙 §5.4의 "레벨이 다른 구역은 설계 구배도 다를
    수 있으므로"는 현재 엔진에서 성립하지 않는다 — `grade_slope_cells`
    (`core/slope.py:132-133`)는 `design_pct` 스칼라 하나만 받으므로, 구역별 설계
    구배를 지원하려면 `criteria.thresholds` 스키마 자체를 배열/맵 구조로 바꿔야
    한다. `SlopeCell.zone_id`(`core/slope.py:33`)는 필드만 뚫려 있고
    `compute_slope_cells`(`core/slope.py:36-110`) 어디에서도 값을 채우지 않아
    항상 `None`이다(`slope_cells.json`에는 `null`로 직렬화됨, §8.2 참고)

74. **재판정 이력 비교가 불가능하다** — `SupabaseStorage.upload`가
    `x-upsert: true`(`worker/flatworker/storage.py:122-129`)로 무조건 덮어써
    이전 판정의 `slope_stats.json`/`slope_judged.json`/`slope_map.png`/
    `slope_cells.csv`가 전부 사라진다. 배수구를 잘못 찍은 뒤 되돌릴 수 있는 유일한
    단서는 `params.judge.previous_drain_points`(좌표만, `worker/flatworker/slope.py`의
    `build_slope_judge_fields` 함수가 씀) — 좌표는 남지만 그 좌표로 냈던
    **판정 결과**(등급·편차·보정량)는 복원할
    방법이 없다. 되돌리려면 좌표를 다시 클릭해 재판정을 한 번 더 돌리는 수밖에 없고,
    그마저도 원래의 판정과 완전히 같다는 보장은 없다(기준이 그 사이 바뀌었다면
    티켓 76과 같은 사유로 달라진다)

75. **세부과업 4 단계 C까지 만들어진 구배 분석은 재판정할 수 없다** —
    `slope_cells.json`이 없기 때문이다(그 분석들은 이 파일이 생기기 전에 만들어졌다,
    티켓 64와 연결). 화면은 이 상태를 `stats.artifacts.cells_json` 부재로 판별해
    명시적으로 막는다(`dashboard/lib/domain/slope-cells.ts:70-73`의
    `slopeCellsJsonUrl`이 `null` 반환 → `slope-result.tsx`의 `canRejudge=false`
    → "이 분석은 재판정할 수 없습니다" 안내, `slope-result.tsx`의 `!canRejudge`
    분기). 워커도 같은 상태를 독립적으로 방어한다(`worker/flatworker/jobs.py:207-209`,
    "이 분석에는 셀 데이터 파일이 없습니다"). 백필 스크립트(과거 `slope_cells.csv`나
    원본 점군에서 `slope_cells.json`을 사후 생성)가 대안으로 보이지만, CSV는
    D1이 실측으로 배제한 반올림·열 손실 경로이고 점군에서 다시 만들려면 결국
    무거운 `analyze_slope` 전체를 다시 돌리는 것과 비용이 같다 — 즉 "백필"이
    사실상 "재분석"이라 별도 기능으로서의 가치가 없다

76. **재판정이 `analyses.applied_criteria`·`analyses.engine_version` 두 컬럼을
    갱신하지 않는다** — `worker/flatworker/slope.py`의 `build_slope_judge_fields`
    함수가 반환하는 필드 dict에는 `stats`·`coverage_pct`·`overall_verdict`·
    `warnings`·`params`만 있고 `applied_criteria`/`engine_version`이 없다.
    `update_analysis`의 PATCH(`worker/flatworker/db.py:296-297`)는 넘긴 필드만
    갱신하는 부분 PATCH라, 두 컬럼은 최초 분석(`analyze` 잡, 같은 파일의
    `run_slope_analysis` 함수가 채움) 시점 값이 재판정 이후에도 그대로 남는다.
    재판정은 기준을 다시 읽으므로 `slope_stats.json.threshold`(§8.1)는 최신인데
    `analyses.applied_criteria`는 옛 값 — **두 진실이 갈린다.** 실측 사례:
    `applied_criteria.design_pct=99.0`인데 `stats.threshold.design_pct=1.0`(리뷰어
    확인). 기준이 재판정 사이에 개정되지 않는 한 두 값이 우연히 같아 드러나지
    않지만, 기준 개정 후 재판정하면 화면·보고서가 "적용 기준"으로 어느 쪽을
    보여주느냐에 따라 서로 다른 숫자를 사용자에게 노출하게 된다

77. **재판정이 `params`를 형제 키까지 통째로 교체(PATCH)한다** —
    `worker/flatworker/slope.py`의 `build_slope_judge_fields` 함수는 `old_params`를
    복사해 `drain_points`·`judge` 두 키만 갱신한 **새 dict 전체**를 반환하고,
    `update_analysis`는 이걸 `params` 컬럼 하나로 그대로 PATCH한다(jsonb 컬럼은
    부분 병합이 아니라 값 전체 교체). 재판정 잡이 처리되는 동안 대시보드나 다른
    경로가 `params`의 **다른** 형제 키를 썼다면 그 변경이 재판정 완료 시 조용히
    사라진다. **현재 스키마에서는 `params`에 `drain_points`·`judge` 외의 키가 없어
    무해하다** — 다만 향후 `params`에 세 번째 형제 키(예: 메모, 다른 설정)가
    추가되면 이 경합이 그 즉시 활성화된다. 안전한 형태는 서버 측에서
    `jsonb_set(params, '{drain_points}', ...) || jsonb_set(..., '{judge}', ...)`처럼
    두 키만 부분 갱신하는 것(009의 잡 큐 함수들이 `judge` 키 자체에는 이미 이
    관례를 쓰고 있다 — `supabase/migrations/009_slope_judge_functions.sql`의
    `fn_job_claim` 함수, `judge` jsonb 병합 블록 참고) — 워커의 `update_analysis`
    PATCH 경로를 부분 병합으로 바꾸는 별도 작업

78. **`compute_slope_cells`가 `grid.bimodal`(유령층 서브셀)을 무시한다** —
    평활도는 `build_zones`(`core/zones.py:103`)에서 `residuals[grid.bimodal] = nan`으로
    쌍봉(이중 표면) 서브셀의 잔차를 지워 판정에서 제외하는데, `compute_slope_cells`
    (`core/slope.py:36-110`)는 `grid.median_z`를 그대로 읽을 뿐 `grid.bimodal`을
    한 번도 참조하지 않는다(파일 전체에 `bimodal` 문자열이 등장하지 않음, 확인
    완료). 유령층(가구 위 반사 등으로 생기는 이중 표면) 서브셀의 중앙값이 구배
    평면 피팅에 그대로 섞여, 평활도라면 배제됐을 노이즈가 구배 판정에는 살아
    들어간다. 영향 범위는 유령층이 존재하는 스캔(평활도 쪽 `ghost_layer_rescan`
    경고가 뜨는 스캔)으로 한정되고, 등급을 어느 방향으로 얼마나 왜곡하는지는
    별도 실측이 필요하다

79. **`render_slope_map` 실패가 여전히 격리되지 않았다(티켓 65 재확인, 위치는
    `judge_slope_cells`로 바뀜)** — 단계 C 시점 티켓 65가 지적한 결함이 D1의
    `analyze_slope`/`judge_slope_cells` 분리 이후에도 그대로 남아 있다(현재 호출부:
    `core/pipeline.py:239`, try/except로 감싸지 않음). 다만 정확한 결과 경로는
    65의 서술과 다르다 — `storage.upload_dir`은 `judge_slope_cells`가 **반환한
    뒤에만** 호출된다(`worker/flatworker/jobs.py`의 `_handle_analyze_slope`
    함수 - 최초 분석 -, `handle_slope_judge` 함수 - 재판정 - 둘 다 같은 구조로
    `storage.upload_dir(...)` 호출이 `judge_slope_cells`/`run_slope_analysis`
    반환 다음 줄에 있다). 즉 렌더가 실패하면
    로컬 스테이징 디렉터리에는 `slope_cells.csv`까지만 쓰인 반쪽 상태가 남지만,
    이건 **업로드되지 않고** 잡 전체가 예외로 실패한다(`worker/flatworker/runner.py:120-121`의
    `db.fail_job`). 결과: 최초 분석에서는 무거운 점군 처리 전체가 헛수고로
    끝나고 사용자는 처음부터 다시 분석을 돌려야 한다(평활도는 `render_heatmap`을
    try/except로 감싸 렌더 실패에도 판정 결과를 살린다 — 그 원칙이 구배에는
    여전히 적용되지 않는다는 점에서 65의 지적은 유효하다). 재판정에서는 업로드가
    아예 일어나지 않으므로 이전 산출물이 보존된 채(x-upsert 자체가 발동하지
    않는다) `params.judge.state='failed'`로만 남는다 — 이 경로는 65가 우려한
    "반쪽 산출물이 스토리지에 남는" 시나리오가 실제로는 발생하지 않음을 뜻한다

80. [해결: 커밋 `8fca7bb`] **재판정 가능한 분석 화면에는 `slope_map.png` 다운로드
    링크가 없었다** — 처음 이 백로그를 쓴 시점(커밋 `a34a9c4`)에는 설계 결정 D3가
    "산출물로는 계속 만들되 화면에서는 다운로드 링크로만 둔다"고 적어 놓고도
    `slope-result.tsx`의 `canRejudge===true` 정상 경로에는 `mapPng`를 쓰는 곳이
    `!canRejudge` 폴백 분기(`<img>`) 하나뿐이라 다운로드 링크가 실제로는 없었다.
    이후 `8fca7bb`("코드리뷰 M5")가 `canRejudge===true` 분기의 "배수구 위치를
    클릭하세요" 문단에 `<a href={dataUrl(mapPng)} download>구배 판정 지도(PNG)
    다운로드</a>`를 추가해 D3 설계와 실제 구현이 일치하게 됐다(`slope-result.tsx`
    - 정확한 줄 번호는 대시보드 픽스가 계속 진행 중이라 여기 박제하지 않는다,
    화면에서 "구배 판정 지도(PNG) 다운로드" 링크 문구로 확인). 재검증(2026-08-04
    완결성 비평): `canRejudge=true` 픽스처로 `SlopeResult`를 렌더해 다운로드 링크
    문구가 실제로 나오고 `<img>`는 0개임을 확인

## 세부과업 4 단계 D 완결성 비평이 새로 찾은 것 (2026-08-04)

- 출처: 단계 G(용역 결과 보고서) 착수 전 백로그 정본성 완결성 비평. 단계 G가
  이 파일에서 미이행 항목을 뽑아 발주처 제출 문서에 반영하므로, 실제로
  아직 남아 있는 결함만 여기 남긴다

81. [해결: 커밋 `3bf3b8f`] **엔진이 만드는 `slope_map.png`에는 배수구 마커가 없다** —
    `render_slope_map(graded, out_path, cell_m=2.0)`
    (`engine/flatness/outputs/slope_map.py`의 함수 시그니처)에 `drain_points`
    인자 자체가 없어 배수구 위치를 그릴 방법이 없다. 대시보드 Canvas 화면
    (`dashboard/components/analysis/slope-heatmap-view.tsx`)에는 배수구 위치에
    파란 원 마커가 찍히는데(`DRAIN_COLOR`로 그리는 블록), 엔진이 만드는 정적
    PNG에는 이 마커가 없다 - 같은 판정 결과를 그리는 두 렌더러가 배수구
    표시 여부에서 갈린다.

    **왜 지금 넣는 게 싼가**: `judge_slope_cells`(`engine/flatness/core/pipeline.py:171`)는
    `render_slope_map`을 호출하는 시점(`core/pipeline.py:239`)에 이미 지역
    변수로 `drain_points`를 갖고 있다(함수 자신의 인자, `grade_slope_cells`
    호출에도 이미 같은 값을 넘긴다) - `render_slope_map` 호출에 인자 하나만
    추가하면 되는 규모다. 반면 **단계 G가 이 PNG를 용역 결과 보고서 자산으로
    박제하고 나면** 비용이 완전히 달라진다: 발행된 보고서는 산출물을 생성
    시점에 복사해 스냅샷으로 굳히므로(설계 결정 D8), 나중에 PNG를 고쳐도 이미
    발행된 보고서 안의 그림은 그대로 남아 새 분석과 옛 발행본의 그림이
    서로 다른 정보를 담게 된다.

    **왜 문제인가**: 판정표에서 "이 셀이 왜 역구배(재시공)인가"의 답은
    "배수구가 어디 있고 물이 그 반대로 흐르기 때문"인데, 그림 자체에는
    배수구 위치가 없어 이 그림 하나만 보고는 원인을 알 수 없다.
    `stats.drain_points`(§8.1)를 별도로 읽어야 하는데, 종이(PDF) 보고서를
    받는 발주처는 그 jsonb 값을 볼 방법이 없다 - 그림이 스스로 완결된
    설명이 되지 못한다.

82. [해결: 커밋 `90e0949`] **Canvas 히트맵 범례에 "화살표 = 내리막 방향" 설명이
    없었다** — 엔진 PNG는 제목 자체에 이 설명을 박아 두는데
    (`engine/flatness/outputs/slope_map.py`의
    `ax.set_title("구배 판정 지도 (화살표는 내리막 방향)")`) 처음 이 티켓을 쓴
    시점에는 Canvas 범례에 "굵은 화살표 = 역구배"만 있고 화살표 자체의
    의미(내리막 방향)를 설명하는 문구가 없었다. 이후 `90e0949`("Task 5 리뷰(3차)
    Critical/Important 반영")가
    `dashboard/components/analysis/slope-heatmap-view.tsx`의 범례에 "얇은
    화살표 = 내리막(물이 흐르는) 방향"을 추가해 해소됐다(직접 파일을 열어
    확인, 2026-08-04). 티켓을 쓸 때 "코드를 먼저 확인하고 이미 있으면 닫는다"고
    남겨 둔 조건 그대로 닫는다

## 커밋 `90e0949`·`5fcb599`(구배 기준 선택 UI 등) 반영 후 이연 티켓 (2026-08-04)

- 출처: 위 두 커밋이 재판정 스모크를 실행 가능하게 만들면서(구배 기준 선택
  UI 신설, `judgeBusy`가 `queued`를 더 이상 막지 않음) 같은 변경이 남긴
  새 관찰. 코드를 직접 열어 확인한 것만 기록한다

83. **워커가 실제로 정지해 있고 잡이 `queued` 상태로 살아 있으면, 배수구를
    다시 클릭해도 매번 23505(중복 엔큐)로 되돌아온다** — `judgeBusy`가
    `processing`만 보도록 바뀐 것(커밋 `90e0949`)은 "잡이 없는데
    `params.judge.state='queued'`만 남은 고아 상태"(예: 과거 버그로 PATCH는
    성공했는데 엔큐가 실패로 되돌려진 경우 등)에서는 사용자가 다시 클릭해
    진짜로 새 판정을 시도할 수 있게 해 준다. 하지만 **잡이 실제로
    `jobs` 테이블에 `queued`로 존재하는 정상적인 경우**(워커가 잠깐
    내려가 아직 아무도 claim하지 않은 것뿐인 경우)는 다르다 - `jobs_dedup`
    부분 유니크(`payload->>'analysis_id'` 기준)가 같은 analysis_id의 새
    엔큐를 계속 막으므로, 사용자가 몇 번을 다시 클릭해도 23505만 반복해서
    받는다. `fn_reap_stuck_jobs`(`supabase/migrations/009_slope_judge_functions.sql`의
    해당 함수)는 `status = 'processing' and locked_at < now() - timeout`
    조건만 검사한다(같은 파일에서 직접 확인) - `status='queued'`인 채로
    아무도 claim하지 않은 잡에는 타임아웃·회수 장치가 아예 없다. 즉 이번
    수정은 **가시성 개선**(막연히 막히는 대신 명확한 오류 메시지를 준다)이지
    **진짜 탈출 경로**는 아니다 - 워커가 실제로 다시 떠서 그 잡을 처리(성공
    또는 3회 실패로 `failed`)할 때까지는 사용자 쪽에서 할 수 있는 게
    없다. 운영 절차에 "재판정이 몇 분째 대기 중이면 워커 프로세스 상태부터
    확인하라"를 넣거나, 관리자가 SQL로 오래된 `queued` `slope_judge` 잡을
    직접 취소하는 절차를 마련하는 것이 다음 단계 후보다

84. **[정보용, 조치 불요] `useJudgeStatus`가 5초마다 새 객체로 `setJudge`해
    `slope-result.tsx`의 refresh `useEffect`가 매 틱 재평가된다** —
    `dashboard/lib/hooks/use-judge-status.ts`의 폴링 타이머가 서버에서 받은
    `params.judge`를 값 비교 없이 그대로 `setJudge`하므로, 내용이 안 바뀌어도
    5초마다 새 객체 참조가 나와 `judge`를 의존성으로 둔 `useEffect`(같은
    파일의 `router.refresh()` 호출부)가 매번 재실행된다. 실제로 문제가
    되려면 그 effect가 매번 `router.refresh()`를 부르는 무한 루프가 나와야
    하는데, 조건이 `judge.at !== initialJudgeAt`이라 `refresh()` 이후에는
    prop이 갱신되어 조건이 거짓으로 수렴한다(직접 코드 대조로 확인) - 5초
    폴링 주기 자체가 자연스러운 속도 제한이기도 하다. 정상 경로에서는
    무해하므로 지금 고칠 필요는 없지만, 폴링 주기를 더 촘촘히 당기거나
    다른 화면이 같은 훅을 재사용할 때는 재확인할 가치가 있다

85. **[정보용, 조치 불요] `isDirectionAwareCriteria`의 `design_pct !== 0`
    조건이 007 시드 5행 전부에 대해 잉여 방어다** —
    `dashboard/lib/domain/slope-direction.ts`의
    `dir_pass_deg < 180 && design_pct !== 0` 중 뒤 조건은, 007이 시드하는
    구배 기준 5종(`007_slope_analysis.sql`) 어느 행에서도 앞 조건과
    다른 답을 내지 않는다 - 배수 목적 4종(옥상 노출·비노출, 욕실, 주차장)은
    전부 `dir_pass_deg=30`(<180)이면서 `design_pct`도 0이 아니고,
    "실내 평바닥" 1종만 `dir_pass_deg=180`이면서 `design_pct=0`이라 앞
    조건 하나만으로도 이미 걸러진다. 즉 현재 시드에서는 죽은 분기다. 다만
    이건 결함이 아니라 **미래를 위한 방어**다 - 예컨대 "설계 구배는 0%지만
    방향은 여전히 확인하고 싶다"는 새 현장 기준(design_pct=0,
    dir_pass_deg<180)이 추가되면 이 조건이 그 즉시 의미를 갖는다. 조치
    불요, 기록만 남긴다

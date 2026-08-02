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
33. 업로드가 파일 전체를 메모리에 적재(현재는 1 GiB 상한·content-length 선검사로 방어) - 정식 단계에서 스트리밍 저장으로 전환
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

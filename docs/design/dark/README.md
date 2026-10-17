# 다크 테마 C안 아트보드 (시각 정본)

설계 스펙: `docs/superpowers/specs/2026-10-17-dark-site-workspace-design.md`
캔버스(그려 보는 곳): https://claude.ai/artifact/DbWtivnzxpBb9QnWi2HV2D 의 "C안 전체 화면" 페이지

이 폴더의 `.dc.html`은 Design 캔버스 아트보드 원본이다. 캔버스 런타임(`support.js`)이 있어야 그려지므로 브라우저로 바로 열면 모양이 다 나오지 않는다. 화면은 캔버스에서 보고, 이 파일은 정확한 색·크기·문구·배치를 읽는 데 쓴다. 스펙과 계획 브리프의 코드가 아트보드와 어긋나면 아트보드가 이긴다(스펙 §2의 예외 제외).

| # | 데스크톱 | 휴대폰 | 화면 | 경로 |
|---|---|---|---|---|
| 01 | `Login.dc.html` | `LoginPhone.dc.html` | 로그인 | `/login` |
| 02 | `EntrySearch.dc.html` | `EntrySearchPhone.dc.html` | 진입(현장 찾기·새 현장) | `/` |
| 03 | `DashStatus.dc.html` | `DashStatusPhone.dc.html` | 현장 대시보드 | `/sites/[id]` |
| 04 | `SiteDetail.dc.html` | `SiteDetailPhone.dc.html` | 측정위치 | `/sites/[id]/locations` |
| 05 | `Upload.dc.html` | `UploadPhone.dc.html` | 스캔 업로드 | `/sites/[id]/upload` |
| 06 | `ScanUnitConfirm.dc.html` | `ScanUnitConfirmPhone.dc.html` | 스캔 · 단위 확인 | `/scans/[id]` |
| 07 | `ScanProcessing.dc.html` | `ScanProcessingPhone.dc.html` | 스캔 · 분석 중 | `/scans/[id]` |
| 08 | `ScanDone.dc.html` | `ScanDonePhone.dc.html` | 결과 · 히트맵 | `/scans/[id]` |
| 09 | `ScanDeviation.dc.html` | `ScanDeviationPhone.dc.html` | 결과 · 정밀 편차맵 | `/scans/[id]` |
| 10 | `ScanDone3D.dc.html`(→ `Stage.dc.html`) | `ScanDone3DPhone.dc.html` | 결과 · 3D 프리뷰 | `/scans/[id]` |
| 11 | `ScanSlope.dc.html` | `ScanSlopePhone.dc.html` | 결과 · 구배 분석 | `/scans/[id]` |
| 12 | `RegistrationNew.dc.html` | `RegistrationNewPhone.dc.html` | 스캔 정합 시작 | `/registrations/new` |
| 13 | `RegistrationDetail.dc.html` | `RegistrationDetailPhone.dc.html` | 스캔 정합 | `/registrations/[id]` |
| 14 | `Reports.dc.html` | `ReportsPhone.dc.html` | 보고서 목록 | `/sites/[id]/reports` |
| 15 | `ReportNew.dc.html` | `ReportNewPhone.dc.html` | 보고서 생성 | `/reports/new` |
| 16 | `ReportDetail.dc.html` | `ReportDetailPhone.dc.html` | 보고서 상세 | `/reports/[id]` |
| 17 | `Settings.dc.html` | `SettingsPhone.dc.html` | 설정 | `/settings` |

휴대폰 아트보드는 데스크톱 아트보드를 390px 폭으로 불러오는 껍데기다.

## 자산 (`assets/`)

엔진 그림 시제품과 시안용 자료다. 전부 데모 바닥(`data/demo/demo_floor.ply`)을 실제 엔진 함수로 돌린 결과다.

- `height_view_dark.png`, `height_view_plain_dark_a.png`, `height_view_plain_dark_b.png`, `slope_map_dark.png`: 화면용 어두운 엔진 그림 시제품(2번 스펙 몫). matplotlib rcParams 와 모듈 색 상수만 바꿔 그렸다.
- `residual-5cm.json`: 5cm 서브셀 잔차 격자(0.1mm 정수). 편차맵을 화면이 직접 그리는 시안이 쓴다(2번 스펙 몫).
- `heatmap-multires.json`: 판정 셀 0.5·1·2m 실제 판정 결과(3번 스펙 몫). 1m 는 운영 분석과 같다.
- 3D 탭 시안이 불러오는 점 파일(`assets/board-points.json`, 사용자 샘플 판 스캔)은 공개 저장소에 넣지 않았다. 캔버스에서만 보인다.

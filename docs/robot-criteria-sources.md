# 로봇 주행 임계값 근거 대조표

- 대상: 세부과업 2에 탑재된 로봇 주행 임계값 29행 (로봇 등급 5 × 지표 12)
- 정본 데이터: `014_finish_material_seed.sql` 9절 (`robot_thresholds`) · 판정 코드는 [`../bim/judge.py`](../bim/judge.py)
- 관련 문서: 설계 정본 [`superpowers/specs/2026-08-09-robot-finish-db-design.md`](superpowers/specs/2026-08-09-robot-finish-db-design.md)
  · 형식은 [`criteria-sources.md`](criteria-sources.md)를 따른다

## 0. 정직성 선언 (먼저 읽을 것)

**이 문서의 수치는 제조사가 공개한 제품 사양 페이지와 법정 기준에서 왔다. 다만 그 페이지를
직접 연 것은 조사 단계이고, 작성자가 한 건씩 다시 열어 대조하지는 않았다.**

[`criteria-sources.md`](criteria-sources.md)의 KCS 기준과 상황이 다르다. 그쪽은 원문 뷰어
접근 자체가 막혀 2차 출처로만 교차검증했다. 이쪽은 **1차 출처(제조사 공표 페이지)의 URL이
기록되어 있고 접근도 가능**하다. 그래서 검증 등급을 다르게 매긴다.

| 등급 | 의미 | 건수 |
|---|---|---|
| **A. 1차 출처 URL 기록됨** | 제조사 공표 페이지 또는 법령의 URL이 기록되어 있고 인용 문장이 남아 있다 | **19행** |
| **N. 근거 없음 (미상)** | 조사에서 공표치를 찾지 못했다. **값을 넣지 않고 `unknown_reason`으로 남겼다** | **10행** |

**A 등급이라도 작성자의 재확인은 없었다.** 대외 제출물이나 논문에 인용하기 전에 §4의 URL로
재확인해야 한다.

### 미상 10행을 그대로 두는 이유

값을 못 찾았을 때 업계 통설이나 유사 기종 값으로 채우면 **판정이 근거 없이 통과를 낸다.**
이 시스템은 미상을 통과로 접지 않는다 — 미상 경계는 도달 경로를 열지 않으며 보고서에
`미상` 배지로 표시된다. 실외 배송로봇은 단차·경사 공표치를 찾지 못해 **8개 경계 전부 미상**이고
"판정 불가"로 보고된다. 이것이 옳은 결과다.

## 1. 대표값 선정 규칙

한 등급 안에 여러 기종이 있으면 **가장 보수적인 공표치**를 등급 대표값으로 삼는다.

| 지표 방향 | 대표값 | 완충값(marginal) |
|---|---|---|
| 상한 규정 (단차·틈·경사) | 등급 내 **최소** 공표치 | 등급 내 최대 공표치 |
| 하한 규정 (통과폭·회전폭) | 등급 내 **최대** 요구값 | 등급 내 최소 요구값 |

최보수로 잡는 이유: 등급 안에 사양이 다른 기종이 섞여 있을 때 관대한 값을 쓰면 **그 등급의
일부 기종이 실제로 못 지나가는 공간을 통과로 판정한다.** 안전한 쪽으로 틀리는 것과 위험한
쪽으로 틀리는 것은 대칭이 아니다.

완충값은 "이 등급 안에서 더 관대한 기종이라면 지날 수 있다"는 뜻이며 판정에서 `조건부`로
나온다. 통과가 아니다.

**이 규칙은 검증에서 실제로 위반이 발견되어 정정됐다.** 상업용 청소로봇의 3개 지표가 등급 내
최보수가 아닌 값을 쓰고 있었고, 결과가 안전한 쪽이 아니라 위험한 쪽이었다. 근거 열의 ★ 표시가
그 정정 기록이다.

## 2. 임계값 29행 전문

아래 표는 **시드 데이터에서 생성**했다. 손으로 옮기지 않는다 — 문서와 데이터가 갈라지지
않게 하기 위해서다.

| # | 등급 | 지표 | 모드 | 비교 | 값 | 완충 | 단위 | 저장소가 기록한 근거 |
|---|---|---|---|---|---|---|---|---|
| 1 | 상업용 청소로봇 | `clear_width_mm` | clean | ≥ | 1400 | 650 | mm | Gausium Scrubber 75 "Min. Pass Width 1400mm"(지하주차장 1800mm는 별도 조건이라 취하지 않았다). marginal 650 = Phantas. ★drive와 같은 값인 것이 맞다 - 제조사는 통과폭을 모드별로 공표하지 않는다 |
| 2 | 상업용 청소로봇 | `clear_width_mm` | drive | ≥ | 1400 | 650 | mm | Gausium Scrubber 75 "Min. Pass Width 1400mm" = 등급 내 최대 요구값(최보수). ★이전 판의 800(Scrubber 50)은 선언한 최보수 규칙 위반이었고 Scrubber 75가 못 들어가는 900mm 통로를 pass로 만들었다… |
| 3 | 상업용 청소로봇 | `gap_width_mm` | drive | ≤ | — | — | mm | 조사 결과 공표 근거 없음 - unknown_reason 참조 |
| 4 | 상업용 청소로봇 | `slope_deg` | clean | ≤ | 3 | — | 도 | Pudu CC1 청소 중 3도 초과 금지 / Gausium Scrubber 75 Auto Cleaning 3도. 두 기종이 같은 값이고 더 관대한 청소모드 공표치가 없어 marginal이 없다. ★BF 최우수 램프(1/18, 3.18도)와 거의 같아 법정 최대 1… |
| 5 | 상업용 청소로봇 | `slope_deg` | drive | ≤ | 4.6 | 8 | 도 | Gausium Scrubber 50 "Max Slope 4.6도" = 등급 내 최소 공표치(최보수). ★이전 판의 8.0은 선언한 규칙 위반이었고 Scrubber 50이 못 오르는 6도 램프를 pass로 만들었다. marginal 8 = Pudu CC1 비청소 주… |
| 6 | 상업용 청소로봇 | `step_height_mm` | clean | ≤ | 8 | 10 | mm | Pudu CC1 청소모드 8mm = 등급 내 최소 공표치. marginal 10 = Gausium Scrubber 75의 통과 장애물 높이(모드 구분 없이 공표되어 청소 중에도 유효한 값으로 읽는다) |
| 7 | 상업용 청소로봇 | `step_height_mm` | drive | ≤ | 10 | 20 | mm | Gausium Scrubber 75 "Min. Passable Obstacle Height: 10 mm" = 등급 내 최소 공표치. marginal 20 = Pudu CC1 주행모드(등급 내 최대) |
| 8 | 상업용 청소로봇 | `turn_width_mm` | clean | ≥ | 2000 | 1100 | mm | Gausium Scrubber 75 "Min. U-Turn Width 2,000mm". marginal 1,100 = Scrubber 50 |
| 9 | 상업용 청소로봇 | `turn_width_mm` | drive | ≥ | 2000 | 1100 | mm | Gausium Scrubber 75 "Min. U-Turn Width 2,000mm" = 등급 내 최대 요구값(최보수). ★이전 판의 1,100(Scrubber 50)은 최보수 규칙 위반. marginal 1,100 = Scrubber 50(등급 내 최소). ★U… |
| 10 | 가정용 로봇청소기 | `carpet_pile_mm` | — | ≤ | 10 | — | mm | 삼성 파워봇 "모 길이가 1cm 이하이고 두께가 1.5cm 이하인 밝은색 카펫일 경우 청소를 잘 할 수 있어요". 다른 가정용 제조사의 파일 높이 공표치를 찾지 못해 marginal이 없다 |
| 11 | 가정용 로봇청소기 | `slope_deg` | — | ≤ | — | — | 도 | 조사 결과 공표 근거 없음 - unknown_reason 참조 |
| 12 | 가정용 로봇청소기 | `step_height_mm` | — | ≤ | 15 | 45 | mm | Roborock S4 15mm = 등급 내 최소 공표치(최보수). ★이전 판의 20mm는 "대부분 모델" 값이라 선언한 최보수 규칙 위반이었다 - S4를 쓰는 세대에서 18mm 문턱이 pass로 찍힌다. marginal 45 = 삼성 비스포크 이지패스 휠(등급 내… |
| 13 | 산업용 실내 배송 AMR | `clear_width_mm` | — | ≥ | 600 | — | mm | Pudu T300·FlashBot Max "Path Clearance >= 60 cm". 두 기종이 같은 값이라 marginal이 없다 |
| 14 | 산업용 실내 배송 AMR | `gap_width_mm` | — | ≤ | 35 | — | mm | Pudu T300 "Groove Crossing Width: 35 mm" |
| 15 | 산업용 실내 배송 AMR | `slope_deg` | — | ≤ | — | — | 도 | 조사 결과 공표 근거 없음 - unknown_reason 참조 |
| 16 | 산업용 실내 배송 AMR | `step_height_mm` | — | ≤ | 20 | — | mm | Pudu T300 "Threshold Overcoming Height: 20 mm". 이 등급은 공표 기종이 2종뿐이고 FlashBot Max는 단차를 공표하지 않아 marginal을 둘 근거가 없다 |
| 17 | 실외이동로봇 | `slope_deg` | — | ≤ | — | — | 도 | 조사 결과 공표 근거 없음 - unknown_reason 참조 |
| 18 | 실외이동로봇 | `step_height_mm` | — | ≤ | — | — | mm | 조사 결과 공표 근거 없음 - unknown_reason 참조 |
| 19 | 서빙·배송로봇(실내) | `carpet_pile_mm` | — | ≤ | — | — | mm | 조사 결과 공표 근거 없음 - unknown_reason 참조 |
| 20 | 서빙·배송로봇(실내) | `clear_width_mm` | — | ≥ | 800 | 450 | mm | Pudu PuduBot 2 "1대 통과 >= 0.8m" = 등급 내 최대 요구값(최보수). marginal 450 = 등급 내 최소 요구값(Bear Servi Q "최소 통로폭 18 in"). 450~800 구간은 Servi Q·KettyBot Pro(550)만 … |
| 21 | 서빙·배송로봇(실내) | `elevator_car_width_mm` | — | ≥ | — | — | mm | 조사 결과 공표 근거 없음 - unknown_reason 참조 |
| 22 | 서빙·배송로봇(실내) | `floor_csr_b` | — | ≥ | — | — |  | 조사 결과 공표 근거 없음 - unknown_reason 참조 |
| 23 | 서빙·배송로봇(실내) | `floor_flatness_mm_3m` | — | ≤ | — | — | mm | 조사 결과 공표 근거 없음 - unknown_reason 참조 |
| 24 | 서빙·배송로봇(실내) | `gap_width_mm` | — | ≤ | 15 | 35 | mm | Pudu PuduBot 2 "maximum surmountable gap no more than 15 mm" = 등급 내 최소 공표치. marginal 35 = KettyBot 극복 장애물 폭(등급 내 최대) |
| 25 | 서빙·배송로봇(실내) | `rec_path_width_mm` | — | ≥ | 1200 | 800 | mm | Pudu PuduBot 2 "권장 경로폭 1.2m". ★U턴 폭이 아니라 권장 경로폭이다 - 같은 문서가 1대 통과 0.8m·2대 교행 2m를 따로 적는다. marginal 800 = 같은 문서의 "1대 통과" 하한(권장은 못 맞춰도 통과는 된다) |
| 26 | 서빙·배송로봇(실내) | `slope_deg` | — | ≤ | 5 | 7 | 도 | Pudu BellaBot·KettyBot·KettyBot Pro·PuduBot 2 "Max Climbing Angle <= 5도" = 등급 내 최소 공표치. marginal 7 = Bear Servi Plus(로커보기 서스펜션, 등급 내 최대). ★법정 최대 램프… |
| 27 | 서빙·배송로봇(실내) | `step_height_mm` | — | ≤ | 5 | 12.7 | mm | 동상. ★베벨·램프·라운드 문턱에 한해 marginal 12.7을 둔다 = 등급 내 최대 공표치(Bear Servi Plus "thresholds up to 1/2 in")이자 ADA §303의 베벨 상한과 같은 값이다. 형상이 미상이거나 수직이면 이 행은 적용되… |
| 28 | 서빙·배송로봇(실내) | `step_height_mm` | — | ≤ | 5 | — | mm | Pudu KettyBot Pro "Max. surmountable height: 5 mm". 등급 내 최소 공표치(KettyBot 7 / PuduBot 2 10 / Servi Plus 12.7). ★형상 무관 행이라 marginal을 두지 않는다 - Servi P… |
| 29 | 서빙·배송로봇(실내) | `turn_width_mm` | — | ≥ | — | — | mm | 조사 결과 공표 근거 없음 - unknown_reason 참조 |

합계 29행 — 값 있음 **19행**, 근거 없어 미상 **10행**.

## 3. 법정 기준

임계값 자체로 쓰지는 않지만 판정 해석에 필요한 근거다.

| 기준 | 내용 |
|---|---|
| ADA §303 | 6.4mm(1/4in) 이하 수직 무처리 허용 / 6.4~12.7mm 1:2 이하 베벨 / 12.7mm 초과 램프 필수 |
| 장애인등편의법 시행규칙 별표1 | 출입구 "문턱이나 바닥면의 높이차이가 없을 것" |
| 장애인등편의법 시행규칙 별표1 | 승강기 내부 유효바닥면적 폭 1.1m 이상 × 깊이 1.35m 이상 |
| KODDI 미끄럼저항 | 신발·습윤 C.S.R 0.4 이상 |

ADA를 함께 인용하는 이유는 국내 기준이 로봇을 다루지 않기 때문이다. 장애인등편의법은
"높이차이가 없을 것"만 규정해 **정량 임계값을 주지 않는다.** 반면 제조사 공표 사양과 ADA의
12.7mm 베벨 한계는 대체로 겹친다(상용 서빙·배송·청소로봇의 실질 한계대 5~20mm).

## 4. 조사가 기록한 출처 URL

작성자가 한 건씩 재확인하지 않았다. 인용 전 재확인 대상이다.

### 제조사 제품 사양
- Pudu KettyBot Pro — `academy.pudutech.com/en/docs/chan-pin-jian-jie-hu-lu-pro`
- Pudu CC1 운용 가이드 — `academy.pudutech.com/en/docs/PUDU-CC1-Operation-Guide-V6`
- Pudu FAQ (PuduBot 2 통과폭·틈) — `academy.pudutech.com/en/docs/FAQ-acuP`
- Pudu BellaBot / T300 / FlashBot Max — `pudurobotics.com/en/products/{bellabot,pudut300,flashbot-new}`
- Bear Robotics Servi Plus / Servi Q — `bearrobotics.ai/servi-plus`, `/servi-q`, `kr.bearrobotics.ai/servi-plus`
- Gausium Scrubber 50 / 75 / Phantas — `gausium.com/specs/{scrubber50,scrubber-75,phantas}/`
- Roborock 단차 극복 — `support.roborock.com/hc/en-us/articles/900002080603`
- 삼성 비스포크 AI 스팀 · 파워봇 카펫 조건 — `samsungsvc.co.kr/solution/{4603281,147389}`
- LG 클로이 서브봇 — `lge.co.kr/kr/business/product/it/lg-LDLIM10`

### 법령·표준
- US Access Board ADA Chapter 3 — `access-board.gov/ada/guides/chapter-3-floor-and-ground-surfaces/`
- 국가법령정보센터 — `law.go.kr`
- 한국장애인개발원 BF 인증 — `koddi.or.kr/bf/info/bf.do`
- KS L 1001 (도자기질 타일) — `standard.go.kr`

## 5. 확인이 필요한 항목

1. **A 등급 19행의 URL 재확인.** 작성자가 직접 열어 인용 문장을 대조하지 않았다.
2. **LG 클로이 서브봇의 등판각·단차 공표치.** 제품 페이지에서 확인되지 않아 등급 대표값
   산정에 반영되지 않았다.
3. **순찰로봇·실외이동로봇의 정량 사양.** 지능형로봇법상 운행안전인증 제도는 존재하나
   (질량 500kg 이하, 최고속도 15km/h 이하) 단차·통과폭 사양은 제조사가 공개하지 않는다.
4. **카펫 파일 높이.** 제품군 수준에서 미상이며 로봇 판정의 최대 공백이다. 제품
   데이터시트 연결이 필요하다.
5. **미끄럼저항 규격값.** 조사한 마감재 제품군 39개 중 10개에만 공표값이 있다.

## 6. 이 문서의 갱신

임계값을 바꾸면 §2의 표를 **다시 생성**한다. 시드가 정본이며 표를 손으로 고치면 데이터와
갈라진다. 회귀 스위트의 A35가 임계값의 근거 문자열 존재를 검사하므로, 근거 없는 값을 넣으면
게이트가 막는다.

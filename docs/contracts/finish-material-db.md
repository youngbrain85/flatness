# 로봇친화형 마감재 DB — 트리와 확장 규약

> 이 문서의 트리는 **손으로 적은 것이 아니라 살아 있는 DB 카탈로그에서 생성**된다.
> 생성기: `tree.sql`(pg_catalog + `v_finish_taxonomy`) → `mktree.py`.
> 스키마를 바꾸면 다시 생성해 이 문서를 갱신한다 — 문서와 스키마가 갈라지지 않게 하기 위해서다.
>
> 생성 시점 상태: 마이그레이션 001~012 + 013 + 014 적재 성공(exit 0),
> 회귀 게이트 `015` 단언 37건 전부 PASS.

## 읽는 법

- **(A) 테이블 관계 트리** — FK 화살표는 자식 → 부모다. `★`는 복합 FK이며 단일 컬럼 FK로는
  막을 수 없는 조합(예: 바닥 마감재를 천장 부위에 붙이는 것)을 선언적으로 차단한다.
- **(B) 마감재 분류 트리** — `v_finish_taxonomy`가 재귀 CTE로 조립하는 형태 그대로다.
  `▣`는 LH 26형 도면에 실제로 나오는 제품군, `★`는 국가기준이 아닌 자체 정의 계열이다.
  두께 칸이 비어 있으면 조사에서 확인하지 못해 DB에 NULL로 둔 것이다 — 0이나 업계 통설로
  채우지 않는다.

## 확장 규약

| 확장 | 방법 | 마이그레이션 |
|---|---|---|
| 새 마감재 제품군 | `finish_materials` + `material_parts` INSERT | 불필요 |
| 새 물성 항목 | `finish_properties` INSERT (numeric/boolean) | 불필요 |
| 새 로봇 등급 | `robot_classes` INSERT (`parent_id`로 상속) | 불필요 |
| 새 판정 규칙 | `robot_thresholds` INSERT / 조합은 `threshold_groups` | 불필요 |
| 새 발주처 코드체계 | `code_systems` + `project_codes` INSERT | 불필요 |
| 새 형상 유형 | `threshold_profile` enum 확장 | **필요** (배포 후에는 별도 `_enum` 파일) |

## 판정 입력 규약 (틀리면 거짓 pass가 난다)

1. **단차 판정 입력은 `v_space_step.step_abs_mm` 하나뿐이다.** 기저 테이블의
   `step_abs_raw_mm`은 원값 보존용이며 걸러냄이 없다. 뷰 쪽은 원문 모순·추론분·FL 불일치에서
   NULL이 되어 `unknown`을 낸다.
2. **부호 있는 `step_mm`을 `lte`에 직접 넣지 마라.** 내려가는 단차가 전부 pass가 된다.
3. **유효 통과폭(`clear_width_mm`)은 상한(`clear_width_max_mm`)을 먼저 적어야 쓸 수 있고,
   반드시 상한보다 작아야 한다.** 창호일람표의 제작치수를 유효폭 칸에 넣는 경로가 구조적으로
   닫혀 있다.
4. **값이 없는 것은 통과가 아니라 `unknown`이다.** `passability_verdict`에서 `unknown`은
   1급 값이다.

## 트리

```
══════════════════════════════════════════════════════════════════════════════
(A) 테이블 관계 트리 — 013 이 추가하는 21 개
    ⇊ cascade   ⊘ restrict   ⇢ set null   ★ 복합 FK(선언적 무결성)
    [행수] · c=CHECK · t=트리거 · u=유니크 · r=RLS정책
══════════════════════════════════════════════════════════════════════════════

[기존 001~012 에 붙는 지점]
  locations                ◄── spaces.location_id  ⇢
  profiles                 ◄── passability_assessments.created_by  ·
  sites                    ◄── code_systems.site_id  ⇊
  sites                    ◄── drawings.site_id  ⇊
  sites                    ◄── robot_rulesets.site_id  ⇊

【분류 골격】
  finish_parts               [   5행] c1 u1 r2
  material_families          [  14행] c2 u1 r2
        parent_id                      → material_families(id) ⊘
  finish_materials           [  52행] c6 t1 u1 r2
        family_id                      → material_families(id) ⊘
        variant_of                     → finish_materials(id) ⊘
  material_parts             [  71행] r2
        material_id                    → finish_materials(id) ⇊
        part_id                        → finish_parts(id) ⊘

【물성】
  finish_properties          [   8행] c3 u2 r2
  material_properties        [   8행] c3 t1 u1 r2
        material_id                    → finish_materials(id) ⇊
      ★ property_id,value_type         → finish_properties(id,value_type) ⊘

【로봇 기준】
  robot_classes              [   5행] c2 u1 r2
        parent_id                      → robot_classes(id) ⊘
  robot_metrics              [  12행] c4 t1 u2 r2
      ★ property_id,property_type      → finish_properties(id,value_type) ⊘
  robot_rulesets             [   1행] c1 r2
        site_id                        → sites(id) ⇊
        supersedes_id                  → robot_rulesets(id) ·
  robot_thresholds           [  29행] c5 t1 u1 r2
        class_id                       → robot_classes(id) ⊘
      ★ group_id,ruleset_id,class_id,mode → threshold_groups(id,ruleset_id,class_id,mode) ⇊
        metric_id                      → robot_metrics(id) ⊘
        ruleset_id                     → robot_rulesets(id) ⇊
  threshold_groups           [   0행] c1 u2 r2
        class_id                       → robot_classes(id) ⊘
        ruleset_id                     → robot_rulesets(id) ⇊

【발주처 코드】
  code_systems               [   1행] c1 r2
        site_id                        → sites(id) ⇊
  drawings                   [   1행] c1 r1
        site_id                        → sites(id) ⇊
        system_id                      → code_systems(id) ⊘
  project_codes              [  36행] c2 u1 r2
        drawing_id                     → drawings(id) ⇢
        part_id                        → finish_parts(id) ⊘
        system_id                      → code_systems(id) ⇊
  project_code_layers        [  34행] c1 u1 r2
        material_id                    → finish_materials(id) ⊘
        project_code_id                → project_codes(id) ⇊

【공간】
  spaces                     [   9행] c4 u1 r1
        drawing_id                     → drawings(id) ⇊
        location_id                    → locations(id) ⇢
  space_finishes             [  48행] c2 u1 r1
      ★ material_id,part_id            → material_parts(material_id,part_id) ⊘
        part_id                        → finish_parts(id) ⊘
        project_code_id                → project_codes(id) ⊘
        space_id                       → spaces(id) ⇊
  space_adjacencies          [   8행] c10 t1 u1 r1
        lower_space_id                 → spaces(id) ⇊
        project_code_id                → project_codes(id) ⊘
        space_a_id                     → spaces(id) ⇊
        space_b_id                     → spaces(id) ⇊
  space_observations         [   0행] c5 t1 u1 r1
      ★ metric_id,subject              → robot_metrics(id,subject) ⊘
        space_id                       → spaces(id) ⇊

【평가】
  passability_assessments    [   0행] c2 r1
        class_id                       → robot_classes(id) ⊘
        created_by                     → profiles(id) ·
        drawing_id                     → drawings(id) ⇊
        ruleset_id                     → robot_rulesets(id) ⊘
  assessment_findings        [   0행] c3 t1 r1
        adjacency_id                   → space_adjacencies(id) ⇊
        assessment_id                  → passability_assessments(id) ⇊
      ★ metric_id,subject              → robot_metrics(id,subject) ⊘
        space_finish_id                → space_finishes(id) ⇊
        space_id                       → spaces(id) ⇊
        threshold_id                   → robot_thresholds(id) ⊘

【뷰】  v_finish_taxonomy · v_finish_taxonomy_all · v_space_step

【enum 타입】
  adjacency_kind         door,opening,open_boundary,level_change
  analysis_kind          flatness,slope
  analysis_status        queued,processing,done,failed
  comparator_op          lte,lt,gte,gt,eq,neq
  data_lineage           raw,fused_mesh,unknown,registered
  drawing_measurability  yes,partial,no
  evidence_basis         drawing_confirmed,inferred
  job_status             queued,processing,done,failed
  job_type               precheck,analyze,import,report,slope_judge,register
  layer_role             base,finish
  mapping_confidence     exact,approximate,unmapped
  metric_subject         space,adjacency,finish
  passability_verdict    pass,marginal,fail,unknown
  project_code_kind      finish_set,opening,insulation,waterproof,other
  property_value_type    numeric,text,boolean
  registration_status    awaiting_points,queued,processing,done,failed
  report_gen_status      queued,processing,done,failed
  report_status          draft,finalized
  robot_mode             ,drive,clean
  rule_logic             all,any
  scan_status            uploaded,awaiting_unit_confirm,ready,archived,failed
  standard_basis         national_standard,industry_common,self_defined
  surface_type           floor,wall
  test_condition         ,wet,dry,barefoot
  threshold_profile      none,vertical,beveled,ramped,rounded,stair
  verdict                pass,borderline,repair,rework

══════════════════════════════════════════════════════════════════════════════
(B) 마감재 분류 트리 — v_finish_taxonomy 가 조립하는 형태
    ▣ = LH 26형 도면에 실재   ★ = 자체 정의 계열(국가기준 아님)
    (두께 mm. 빈칸 = 조사에서 확인 실패 → DB 에 NULL)
══════════════════════════════════════════════════════════════════════════════

├─ 걸레받이
│  ├─ 도장계★
│  │  ▣ 내부 수성페인트                                  [KS M 6010]
│  ├─ 무기질계 보드
│  │  ▣ 석고보드 THK9.5/12.5                   9.5    [KS F 3504]
│  ├─ 미장·현장타설계★
│  │  ▣ 시멘트 모르타르 바름                        30     [KS L 5220]
│  ├─ 석재계
│  │    인조대리석 타일                           12     
│  └─ 성형 판넬계★
│     ▣ 기성품 걸레받이재                                 
│     ▣ 인조대리석(BMC) 걸레받이                           

├─ 바닥
│  ├─ 도자기질계(타일)★
│  │    시각장애인용 점자블록                               [KS F 4561,KS F 2375]
│  │  ▣ 자기질 타일(바닥용)                               [KS L 1001]
│  │  ▣ 포세린 타일(무유 자기질·무광)                  10     [KS L 1001]
│  │    폴리싱 타일(연마 자기질·유광)                  10     [KS L 1001]
│  ├─ 도장계★
│  │    에폭시 라이닝                            2      
│  │    에폭시 레진몰탈                                  
│  │    우레탄 바닥재                            3      
│  │    콘크리트 하드너·폴리싱                              
│  ├─ 목질계
│  │    WPC 바닥판·데크                                [KS F 3230]
│  │    강화마루                                      [KS F 3126]
│  │    섬유판 강마루                            7      [KS F 3126]
│  │    원목마루                                      [KS F 3111]
│  │    합판 강마루                                    [KS F 3126]
│  │    합판마루(온돌마루)                                [KS F 3111]
│  ├─ 미장·현장타설계★
│  │  ▣ 방수 모르타르 바름                         10     
│  │  ▣ 수평조절(셀프레벨링) 모르타르                          [KS F 4716]
│  │  ▣ 시멘트 모르타르 바름                        30     [KS L 5220]
│  │    제물마감(콘크리트 직접 마감)                          
│  ├─ 방수계
│  │    시멘트 액체방수                           4      
│  │    폴리머 모르타르 방수                        10     
│  ├─ 석재계
│  │    인조대리석 타일                           12     
│  │    천연석 타일(편마암 등)                             
│  │    테라조 타일(인조석 물갈기)                    25     [KS F 4035]
│  │    화강석(물갈기/버너구이)                             
│  ├─ 카펫·이중바닥
│  │    롤카펫                                       
│  │    이중바닥재(액세스 플로어)                            [KS F 4760]
│  │    카펫타일                                      [KS K ISO 10874]
│  ├─ 합성고분자계 > 합성고분자 시트류
│  │    PVC 시트 바닥재(일반 장판)                  2      [KS M 3802]
│  │    교육용 쿠션 시트                          6      
│  │  ▣ 기능성 륨(쿠션형 층간소음 저감 시트)              5      [KS M 3802]
│  │    호모지니어스 시트                          2      
│  └─ 합성고분자계 > 합성고분자 타일류
│       SPC 마루                                    
│       VCT(비닐 컴포지션 타일)                           [KS M 3802]
│       데코타일(PVC 타일)                       3      [KS M 3802]
│       디럭스타일(대리석칩 PVC)                           [KS M 3802]
│       러버(고무) 타일                                 
│       상업용 LVT                            3      [KS M 3802]
│       전도성/OA 정전기방지 타일                           

├─ 벽
│  ├─ 금속판·바탕틀계
│  │  ▣ 경량철골 천장틀                                  [KS D 3609]
│  ├─ 도배계
│  │  ▣ 실크벽지                                      [KS M 7305]
│  │    합지벽지                                      [KS M 7305]
│  ├─ 도자기질계(타일)★
│  │  ▣ 도기질 타일(유색 시유·벽용)                          [KS L 1001]
│  │    석기질 타일(외장용)                               [KS L 1001]
│  │  ▣ 포세린 타일(무유 자기질·무광)                  10     [KS L 1001]
│  ├─ 도장계★
│  │  ▣ 내부 수성페인트                                  [KS M 6010]
│  │    탄성코트                                      
│  ├─ 무기질계 보드
│  │    CRC 보드 THK4.5                      4.5    
│  │  ▣ 방수 석고보드 THK9.5                     9.5    [KS F 3504]
│  │  ▣ 석고보드 THK9.5/12.5                   9.5    [KS F 3504]
│  │    섬유강화 시멘트판                                 [KS L 5509]
│  ├─ 미장·현장타설계★
│  │  ▣ 방수 모르타르 바름                         10     
│  │  ▣ 시멘트 모르타르 바름                        30     [KS L 5220]
│  │    제물마감(콘크리트 직접 마감)                          
│  ├─ 방수계
│  │    시멘트 액체방수                           4      
│  ├─ 석재계
│  │    화강석(물갈기/버너구이)                             
│  └─ 성형 판넬계★
│     ▣ 시스템욕실 ABS 판넬                              

└─ 천장
   ├─ 금속판·바탕틀계
   │  ▣ 경량철골 천장틀                                  [KS D 3609]
   ├─ 도배계
   │  ▣ 실크벽지                                      [KS M 7305]
   │    합지벽지                                      [KS M 7305]
   ├─ 도장계★
   │  ▣ 내부 수성페인트                                  [KS M 6010]
   │    탄성코트                                      
   ├─ 무기질계 보드
   │  ▣ 석고보드 THK9.5/12.5                   9.5    [KS F 3504]
   ├─ 미장·현장타설계★
   │  ▣ 시멘트 모르타르 바름                        30     [KS L 5220]
   │    제물마감(콘크리트 직접 마감)                          
   └─ 성형 판넬계★
      ▣ 시스템욕실 ABS 판넬                              

══════════════════════════════════════════════════════════════════════════════
(C) 적재 현황
══════════════════════════════════════════════════════════════════════════════
  부위 4 · 재료계열 13 · 제품군 52 (그중 LH 26형 도면 실재 15)
  발주처 코드 매핑 54행 (미매핑 21)
  공간 9 (도면확정 7 · 추론 2 · 원문모순 보유 3)
  총 테이블 33 (신규 21) · 뷰 3 · 함수 56 · RLS 정책 50

```

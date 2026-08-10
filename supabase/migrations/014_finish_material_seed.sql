-- =============================================================================
-- 014_finish_material_seed.sql — 통용 제품군 + LH 26형 도면
-- 선행: 013. ★전 INSERT에 on conflict do nothing / where not exists (C8).
-- ★ 013과 나눈 이유: 013=구조, 014=근거 있는 수치. 수치 개정 시 014만 새 번호로.
-- ★ 근거 문서 의무: 원문 대조표를 docs/finish-material-sources.md 와
--   docs/robot-metric-sources.md 에 criteria-sources.md 양식(정직성 선언 + A/B/C
--   검증 등급표)으로 따로 쓴다. 대조표 없이 머지하면 저장소 관례 위반이다.
-- ★ 확인하지 못한 값은 NULL이다. 0이나 업계 문헌 수치로 채우지 않았다.
-- ★ "규격이 요구하는 하한값"은 물성이 아니다. material_properties에는 실측·공표 물성만
--   들어간다. 요구 하한(KS L 1001 DCOF 0.40, SH C.S.R·B 0.6, KS F 4561 40 BPN,
--   KS F 3230 C.S.R 0.40)은 finish_properties.source_text(=물성 등록부)에만 산다.
--   요구값을 관측값 자리에 넣으면 판정이 "요구값 vs 요구값"이 되어 미측정 제품이 pass가 된다.
-- ★ evidence jsonb 등급: A=원문 직접 확인 / B=2차 인용·요약 확인 / C=미확인.
--   criteria-sources.md 의 A/B/C 검증 등급표 양식을 그대로 쓴다.
-- 검증: 격리 PostgreSQL 16.14 클러스터에서 001~012 + 013 + 014 전량 실행 확인(reload.sh).
-- =============================================================================

-- 1) 부위 --------------------------------------------------------------------
insert into finish_parts (code, name_ko, sort_order, source_text, note) values
 ('floor','바닥',10,'설계도서 작성기준 별표2 "천정·벽·걸레받이·바닥 부위의 바탕 및 마감" + AA-004 FLOOR 열',null),
 ('wall','벽',20,'동상 + AA-004 WALL 열',null),
 ('ceiling','천장',30,'동상 + AA-004 CEILING 열',null),
 ('baseboard','걸레받이',40,'동상 + AA-004 BASEBOARD 열',
  '법정 기준·도면이 바닥·벽과 동급 부위로 둔다. 벽 하위로 접는 것은 도면이 한 건이라도 적재된 뒤에는 데이터 이관이다(DDL 변경 없음이 아니다): (1) 걸레받이 전용 제품군에 (material, wall) 행을 material_parts에 추가 (2) 해당 space_finishes의 layer_no를 벽 층과 겹치지 않게 재배치 (3) material_parts.part_id를 wall로 update - 복합 FK의 on update cascade가 space_finishes를 따라 고친다 (4) 이 행을 is_active=false로 내리고, 이미 적재된 도면 조회는 v_finish_taxonomy_all로 한다'),
 ('other','기타',90,'창호·단열·방수 등 4부위에 속하지 않는 도면 코드의 수용처','부위 축이 도면의 모든 코드를 덮지 못한다는 사실을 숨기지 않기 위한 명시적 행')
on conflict (code) do nothing;

-- 2) 재료계열 1단 -------------------------------------------------------------
insert into material_families (code, name_ko, kcs_code, pumsem_code, pumsem_year, g2b_class, basis, source_text, sort_order) values
 ('wood-based','목질계','KCS 41 51 03','18-1',2014,'30161702','national_standard','KCS 41 51 03 자재 "목질계(플로어링·합판·쪽매널)" / 41 51 04 "목질계(합판·섬유판)"',10),
 ('polymer-sheet','합성고분자계','KCS 41 51 03','18-1',2014,'30161700','national_standard','KCS 41 51 03 자재 "합성고분자계(아스팔트타일·고무타일·비닐타일·리놀륨·고무시트)"',20),
 ('carpet-raised','카펫·이중바닥','KCS 41 51 03','18-1',2014,'30161700','national_standard','KCS 41 51 03 자재 "이중바닥, 카펫"',30),
 ('ceramic-tile','도자기질계(타일)','KCS 41 48 01','10-2',2014,null,'self_defined','★자체 정의. KCS 41 51 03/04에 타일 재료계열 절이 없어 타일공사에서 차용했다',40),
 ('wet-plaster','미장·현장타설계','KCS 41 46 00','15-1',2014,null,'self_defined','★자체 정의. 미장공사에 41 51 03/04와 같은 급의 재료계열 절이 없다',50),
 ('coating','도장계','KCS 41 47 00','17-6',2014,null,'self_defined','★자체 정의. 도장공사에 재료계열 절이 없다',60),
 ('mineral-board','무기질계 보드','KCS 41 51 04','18-2',2014,'30161500','national_standard','KCS 41 51 04 자재 "무기질계(패널류·목모보드·섬유강화 시멘트판·석고보드)"',70),
 ('wallpaper','도배계','KCS 41 51 05','18-3',2014,'30161502','national_standard','KCS 41 51 05 도배공사',80),
 ('stone','석재계','KCS 41 35 03',null,null,null,'industry_common','KCS 41 35 03 대리석 공사',90),
 ('metal-frame','금속판·바탕틀계','KCS 41 49 00',null,null,null,'national_standard','KCS 41 49 00 / KS D 3609 건축용 강제 받침재(벽·천장)',100),
 ('molded-panel','성형 판넬계',null,null,null,null,'self_defined','★자체 정의. 대응 KCS·KS를 확인하지 못한 성형 마감재의 수용처',110),
 ('waterproof','방수계','KCS 41 40 01',null,null,null,'industry_common','도면 9쪽 방수 및 코킹 일람표',120)
on conflict (code) do nothing;

-- 2-b) 재료계열 2단 — 자기참조 트리가 DDL 없이 깊어짐을 시드에서 실제로 보인다
insert into material_families (parent_id, code, name_ko, kcs_code, basis, source_text, sort_order)
select p.id, v.code, v.name_ko, v.kcs, v.basis::standard_basis, v.src, v.ord
 from (values
  ('polymer-sheet','polymer-sheet-tile','합성고분자 타일류','KCS 41 51 03','national_standard','KCS 41 51 03 자재 열거 중 타일 형태만 모은 하위 계열',10),
  ('polymer-sheet','polymer-sheet-roll','합성고분자 시트류','KCS 41 51 03','national_standard','동상. 시트 형태(리놀륨·고무시트·PVC 시트)',20)
 ) as v(parent, code, name_ko, kcs, basis, src, ord)
 join material_families p on p.code = v.parent
on conflict (code) do nothing;

-- 3) 제품군 ------------------------------------------------------------------
insert into finish_materials (family_id, code, name_ko, aliases, role, hardness, install_method,
                              is_wet_process, thickness_min_mm, thickness_max_mm, typical_thickness_mm,
                              ks_codes, common_use, source_text)
select f.id, v.code, v.name_ko, v.aliases::text[], v.role::layer_role, v.hard, v.method,
       v.wet, v.tmin, v.tmax, v.ttyp, v.ks::text[], v.use_ko, v.src
 from (values
  ('wood-based','mar-ply-gangmaru','합판 강마루','{"합판강마루"}','finish','rigid','adhesive',false,6.0,8.0,null,'{"KS F 3126"}','아파트 거실·침실 국내 주력','합판코어+멜라민필름 접착식. 2025년 520만평. 전면 접착이라 바탕 요철이 표면에 드러난다. ★근거자료는 "6~8 (제품 다수 7~7.5)" 대역만 준다 - 대표값 공표가 없어 typical은 NULL'),
  ('wood-based','mar-fiber-gangmaru','섬유판 강마루','{"섬유판강마루"}','finish','rigid','adhesive',false,6.0,8.0,7.0,'{"KS F 3126"}','시판 유통 비중 상승','NAF보드·특수섬유판 코어. 2025년 270만평. typical 7.0의 근거는 근거자료가 명시한 실제 제품 규격 "동화 나투스진 네이처 143×1205×7"'),
  ('wood-based','mar-laminate','강화마루','{"강화합판마루"}','finish','rigid','click',false,6.0,8.0,null,'{"KS F 3126"}','임대·사무실. LH 바닥재 선택 옵션','HDF+멜라민필름 클릭 현가. 띄움시공이라 공극·삐걱임. ★근거자료는 "6~8" 대역뿐 - typical NULL'),
  ('wood-based','mar-solid','원목마루','{}','finish','soft','adhesive',false,10.0,null,null,'{"KS F 3111"}','고급 주거','합판+원목 단판(표층 2mm 이상). 표면 강도 낮음'),
  ('wood-based','mar-plywood','합판마루(온돌마루)','{"온돌마루"}','finish','semi_rigid','adhesive',false,6.0,8.0,null,'{"KS F 3111"}','2000년대 특판 주력, 현재 축소','합판+천연무늬목 0.5mm 이하. ★근거자료는 "6~8" 대역뿐 - typical NULL'),
  ('wood-based','deck-wpc','WPC 바닥판·데크','{}','finish','rigid','mechanical',false,null,null,null,'{"KS F 3230"}','옥외 데크·조경 보행로','두께 대역 확인 실패. KS F 3230이 C.S.R 0.40 이상(건조)을 규정'),
  ('polymer-sheet-roll','sheet-vinyl-standard','PVC 시트 바닥재(일반 장판)','{"모노륨","륨시트","장판"}','finish','soft','adhesive',false,1.8,2.2,2.0,'{"KS M 3802"}','원룸·소형빌라·임대','폭 1,830mm 롤. 시장 연 1,600만평(2025)'),
  ('polymer-sheet-roll','sheet-vinyl-cushion','기능성 륨(쿠션형 층간소음 저감 시트)','{"기능성륨카펫","소리지움","아티움"}','finish','soft','adhesive',false,2.7,6.0,5.0,'{"KS M 3802"}','LH 공공분양·임대 선택 옵션','★도면 F-11 "기능성륨카펫(6.0T이상)"의 대응 제품군. 카펫이 아니라 쿠션층 내장 PVC 시트. LH 전문시방서 46540이 C.S.R·B/C.S.R·S 시험을 요구'),
  ('polymer-sheet-roll','sheet-homogeneous','호모지니어스 시트','{}','finish','rigid','sheet_weld',false,2.0,2.0,2.0,'{}','병원·수술실·클린룸','단층 균일 비닐, 용접 무이음. 대응 KS 확인 실패'),
  ('polymer-sheet-roll','sheet-edu-cushion','교육용 쿠션 시트','{}','finish','soft','adhesive',false,6.0,6.0,6.0,'{}','어린이집·유치원','경량충격음 저감 다층 PVC. 대응 KS 확인 실패'),
  ('polymer-sheet-tile','tile-deco','데코타일(PVC 타일)','{}','finish','rigid','adhesive',false,2.0,5.0,3.0,'{"KS M 3802"}','상가·학원·병원·사무실','305x305/450x450. 접착 후 15분 이상 가압'),
  ('polymer-sheet-tile','tile-deluxe','디럭스타일(대리석칩 PVC)','{}','finish','rigid','adhesive',false,2.0,3.0,null,'{"KS M 3802"}','사무실·상업·교육','대리석 칩 구조'),
  ('polymer-sheet-tile','tile-lvt','상업용 LVT','{}','finish','rigid','adhesive',false,3.0,5.0,3.0,'{"KS M 3802"}','사무실·상업·교육','인쇄층+웨어레이어. 사용등급 33'),
  ('polymer-sheet-tile','tile-vct','VCT(비닐 컴포지션 타일)','{}','finish','rigid','adhesive',false,null,null,null,'{"KS M 3802"}','관공서·학교·공장','왁스 관리 전제. 두께 확인 실패 - NULL'),
  ('polymer-sheet-tile','tile-conductive','전도성/OA 정전기방지 타일','{}','finish','rigid','adhesive',false,null,null,null,'{}','실험실·병원·전산실','두께·대응 KS 모두 확인 실패'),
  ('polymer-sheet-tile','tile-rubber','러버(고무) 타일','{}','finish','semi_rigid','adhesive',false,3.0,5.0,null,'{}','사무실·교육·스포츠','제조사가 non-slip으로 표기하나 수치 없음. KS 확인 실패'),
  ('polymer-sheet-tile','mar-spc','SPC 마루','{}','finish','rigid','click',false,4.0,6.0,null,'{}','병원·상업·주거','석분 60~70% + PVC 코어. 대응 KS 확인 실패'),
  ('carpet-raised','carpet-tile','카펫타일','{"타일카페트"}','finish','soft','dry_lay',false,5.5,8.0,null,'{"KS K ISO 10874"}','오픈오피스·호텔·금융','통상 500x500, 방염. ★파일 높이는 제품 데이터시트에만 있어 제품군 수준 미상. ★근거자료는 "5.5~8.0(제조사) / 6~8(시공 실무)" 두 대역만 준다 - 어느 쪽 중앙값도 아닌 6.5는 출처가 없어 typical을 NULL로 내렸다'),
  ('carpet-raised','carpet-roll','롤카펫','{"롤카페트"}','finish','soft','dry_lay',false,null,null,null,'{}','강당·상가·호텔','두께·대응 KS 확인 실패'),
  ('carpet-raised','raised-floor','이중바닥재(액세스 플로어)','{"OA플로어"}','base','rigid','mechanical',false,null,null,null,'{"KS F 4760"}','사무실·전산실·데이터센터','KS F 4760 치수 허용차가 시공 후 평활도와 직결. 두께 대역 확인 실패'),
  ('ceramic-tile','tile-porcelain','포세린 타일(무유 자기질·무광)','{"포셀린타일","포세린 타일"}','finish','rigid','wet',true,9.0,10.0,10.0,'{"KS L 1001"}','거실·주방·현관·상업','★도면 F-10B "포셀린타일(600X600)". 흡수율 0.5% 이하. 별도 KS 분류가 아니라 자기질 중 무유·무광 계열의 시장 통칭'),
  ('ceramic-tile','tile-vitreous','자기질 타일(바닥용)','{"자기질타일"}','finish','rigid','wet',true,7.0,10.0,null,'{"KS L 1001"}','욕실·현관·발코니·세탁실','★도면 F-12(300X300) / F-14. 시방 두께 7mm 이상(=하한), 유통 600X600은 8~10, 현관바닥 300X300 이상, 줄눈 5mm. ★7.0은 요구 하한이지 대표 두께가 아니므로 typical에 옮기지 않았다'),
  ('ceramic-tile','tile-polished','폴리싱 타일(연마 자기질·유광)','{"폴리싱타일"}','finish','rigid','wet',true,10.0,10.0,10.0,'{"KS L 1001"}','거실·로비·매장','표면 조도가 낮아 습윤 시 미끄럼 위험. 폴리싱 전용 미끄럼 규격값 확인 실패'),
  ('ceramic-tile','tile-earthenware','도기질 타일(유색 시유·벽용)','{"도기질타일"}','finish','rigid','wet',true,6.0,null,null,'{"KS L 1001"}','욕실 벽·주방 벽','★도면 W-12(600X300) / W-14. 흡수율 10% 이상이라 바닥 부적합. 근거자료는 "6 이상"(=하한)뿐이라 상한·대표값 없음'),
  ('ceramic-tile','tile-stoneware','석기질 타일(외장용)','{}','finish','rigid','wet',true,11.0,null,null,'{"KS L 1001"}','건물 외벽','3층·600m2 이상 시 접착력 시험(4kgf/cm2 이상) 의무. ★근거자료는 "15 이상(외벽 석기질), 일반 외벽타일 11 이상"이다 - 15는 상한이 아니라 하한이므로 max에 두지 않았다. min은 더 넓은 쪽인 11(일반 외벽타일)을 취했고 상한은 공표된 적이 없어 NULL'),
  ('ceramic-tile','block-braille','시각장애인용 점자블록','{}','finish','rigid','wet',true,null,null,null,'{"KS F 4561","KS F 2375"}','승강장·출입구·계단','★돌출 블록이라 로봇 단차 지표의 직접 대상. 40 BPN 이상. 블록 두께 확인 실패'),
  ('stone','tile-artificial-marble','인조대리석 타일','{"BMC"}','finish','rigid','wet',true,12.0,12.0,12.0,'{}','현관 바닥 선택사양','흡수율 0.03% 이하. 모르타르 30mm 레벨링 후 설치. 대응 KS 확인 실패'),
  ('stone','tile-natural-stone','천연석 타일(편마암 등)','{}','finish','rigid','wet',true,8.0,9.0,null,'{}','현관·홀 바닥','흡수율 5% 미만. 붙임 후 7일간 진동·보행 금지. 대응 KS 확인 실패'),
  ('stone','tile-terrazzo','테라조 타일(인조석 물갈기)','{}','finish','rigid','wet',true,17.0,25.0,25.0,'{"KS F 4035"}','학교·지하상가·공용부','표준 25mm, 레벨 부족 현장은 17~18mm 박형'),
  ('stone','stone-granite','화강석(물갈기/버너구이)','{}','finish','rigid','wet',true,20.0,30.0,null,'{}','로비·외부 바닥·계단·외벽','바닥 30(또는 24)·벽 20. ★옥외 바닥·계단·경사면에는 물갈기 금지가 원칙 - 표면 처리에 따라 미끄럼 성질이 정반대'),
  ('wet-plaster','mortar-cement','시멘트 모르타르 바름','{"시멘트모르타르"}','base','rigid','wet',true,15.0,65.0,30.0,'{"KS L 5220"}','모든 바닥·벽·천장의 바탕','★도면 F-10B·F-14·W-12 바탕. 바닥 30±15~40±25, 벽 40±25, 천장 30±15. 타일 압착 시 바탕 평활도 요구 벽 2.4m당 3mm·바닥 3m당 3mm'),
  ('wet-plaster','mortar-waterproof','방수 모르타르 바름','{"방수모르타르"}','base','rigid','wet',true,null,10.0,10.0,'{}','욕실·발코니·복도','★도면 F-14 THK10. 대응 KS 확인 실패. ★min 4.0은 9쪽 "시멘트 액체방수 THK4"에서 옮겨온 값이었으나 그것은 별개 제품군(wp-cement-liquid)이라 근거가 되지 않는다 - NULL로 내렸다'),
  ('wet-plaster','mortar-self-leveling','수평조절(셀프레벨링) 모르타르','{"수평조절 모르타르","셀프레벨링"}','base','rigid','wet',true,null,null,null,'{"KS F 4716"}','바닥 평탄도 확보용 바탕','★도면 F-12 THK60. ★이 용역의 평탄도 시공 대상 층. 제품군 두께는 도면 지정값에 종속되어 범위를 두지 않는다(NULL)'),
  ('wet-plaster','concrete-exposed','제물마감(콘크리트 직접 마감)','{}','finish','rigid','wet',true,null,null,null,'{}','지하주차장·창고','★별도 마감층이 없어 타설 평활도가 곧 최종 평활도'),
  ('waterproof','wp-polymer-mortar','폴리머 모르타르 방수','{"폴리머모르타르"}','base','rigid','wet',true,10.0,10.0,10.0,'{}','발코니','★도면 9쪽 THK10. 부기 "방수모르타르와 병행 적용가능" - 마감표와 일람표가 다른 재료를 가리킬 수 있다'),
  ('waterproof','wp-cement-liquid','시멘트 액체방수','{}','base','rigid','wet',true,4.0,4.0,4.0,'{}','복도(바닥용)·욕실(벽체용)','★도면 9쪽 THK4'),
  ('coating','paint-water-based','내부 수성페인트','{"내부수성페인트"}','finish','rigid','coating',false,null,null,null,'{"KS M 6010"}','발코니·실외기실 벽·천장','★도면 W-15 / C-10 / 7쪽 G·R. 도막 두께 확인 실패'),
  ('coating','coat-elastic','탄성코트','{}','finish','semi_rigid','coating',false,null,null,null,'{}','발코니·세탁실 벽·천장','고무+아크릴 탄성 도막, 결로·곰팡이 억제. 대응 KS 확인 실패'),
  ('coating','coat-epoxy-lining','에폭시 라이닝','{}','finish','rigid','coating',false,1.0,3.0,2.0,'{}','공장·반도체·실험실','★바탕 요철·크랙이 그대로 도막에 전사된다'),
  ('coating','coat-epoxy-mortar','에폭시 레진몰탈','{}','finish','rigid','coating',false,null,null,null,'{}','공장·중하중 주차장','규사 혼합, 표면이 거칠어 미끄럼 저항 높음(수치 없음). 두께 확인 실패'),
  ('coating','coat-urethane','우레탄 바닥재','{}','finish','semi_rigid','coating',false,3.0,3.0,3.0,'{}','옥외 주차장·공장·학교','2액형. 하도50um+실러500um+중도2,000~2,500um+상도50um = 총 3mm'),
  ('coating','coat-concrete-hardener','콘크리트 하드너·폴리싱','{}','finish','rigid','coating',false,null,null,null,'{}','지하주차장·창고','★별도 마감층이 없어 타설 평활도가 곧 최종 평활도'),
  ('mineral-board','board-gypsum','석고보드 THK9.5/12.5','{"석고보드"}','base','rigid','mechanical',false,9.5,12.5,9.5,'{"KS F 3504"}','벽·천장 바탕','★도면 W-7,8,9 / C-6A / C-6B / 7쪽 A·D. 4쪽 주기9: 9.5=준불연, 12.5=불연'),
  ('mineral-board','board-gypsum-wr','방수 석고보드 THK9.5','{"방수석고보드"}','base','rigid','mechanical',false,9.5,9.5,9.5,'{"KS F 3504"}','주방·욕실 인접 벽 바탕','★도면 W-14 / 7쪽 F'),
  ('mineral-board','board-crc','CRC 보드 THK4.5','{"CRC보드"}','base','rigid','mechanical',false,4.5,4.5,4.5,'{}','발코니 벽 바탕','★도면 7쪽 R / 9쪽 발코니 벽. 대응 KS 확인 실패'),
  ('mineral-board','board-fiber-cement','섬유강화 시멘트판','{}','base','rigid','mechanical',false,6.0,null,null,'{"KS L 5509"}','경량칸막이','★도면 1쪽 비상탈출구 경량칸막이 THK6'),
  ('wallpaper','wp-silk','실크벽지','{"실크도배지","실크벽지"}','finish','soft','adhesive',false,null,null,null,'{"KS M 7305"}','아파트 실내 벽·천장 주력','★도면 W-7,8,9 / W-14 / C-6A / C-6B / 7쪽 A·B·C·D. 250g/m2 이상(고급 300). 수명 7~10년. 두께 확인 실패'),
  ('wallpaper','wp-paper','합지벽지','{"합지"}','finish','soft','adhesive',false,null,null,null,'{"KS M 7305"}','임대·저가 현장','180g/m2 이상, 폭 900mm 이상. 수명 2~4년. 두께 확인 실패'),
  ('metal-frame','frame-light-steel','경량철골 천장틀','{}','base','rigid','mechanical',false,null,null,null,'{"KS D 3609"}','천장 바탕틀','★도면 C-6A/C-6B/C-8 / 10쪽 천장틀도. M-BAR 36x14x0.4t@300, 캐링찬넬 15x12x1.0t@900'),
  ('molded-panel','panel-abs-bath','시스템욕실 ABS 판넬','{"ABS 판넬","ABS판넬"}','finish','semi_rigid','mechanical',false,null,null,null,'{}','시스템욕실 천장','★도면 C-8(H2200). 대응 KS 확인 실패'),
  ('molded-panel','base-bmc','인조대리석(BMC) 걸레받이','{"인조대리석(BMC)"}','finish','rigid','adhesive',false,null,null,null,'{}','현관 걸레받이','★도면 B-7B(H40). 대응 KS 확인 실패'),
  ('molded-panel','base-readymade','기성품 걸레받이재','{"기성품걸레받이재"}','finish','semi_rigid','adhesive',false,null,null,null,'{}','거실/침실·주방/식당 걸레받이','★도면 B-9,10(H80). 대응 KS 확인 실패')
 ) as v(fam, code, name_ko, aliases, role, hard, method, wet, tmin, tmax, ttyp, ks, use_ko, src)
 join material_families f on f.code = v.fam
on conflict (code) do nothing;

-- 4) 부위 × 제품군 ------------------------------------------------------------
insert into material_parts (material_id, part_id, is_typical)
select m.id, p.id, v.typ
 from (values
  ('mar-ply-gangmaru','floor',true),('mar-fiber-gangmaru','floor',true),('mar-laminate','floor',true),
  ('mar-solid','floor',true),('mar-plywood','floor',true),('deck-wpc','floor',true),('mar-spc','floor',true),
  ('sheet-vinyl-standard','floor',true),('sheet-vinyl-cushion','floor',true),
  ('sheet-homogeneous','floor',true),('sheet-edu-cushion','floor',true),
  ('tile-deco','floor',true),('tile-deluxe','floor',true),('tile-lvt','floor',true),
  ('tile-vct','floor',true),('tile-conductive','floor',true),('tile-rubber','floor',true),
  ('carpet-tile','floor',true),('carpet-roll','floor',true),('raised-floor','floor',true),
  ('tile-porcelain','floor',true),('tile-porcelain','wall',false),
  ('tile-vitreous','floor',true),('tile-polished','floor',true),('block-braille','floor',true),
  ('tile-earthenware','wall',true),('tile-stoneware','wall',true),
  ('tile-artificial-marble','floor',true),('tile-artificial-marble','baseboard',true),
  ('tile-natural-stone','floor',true),('tile-terrazzo','floor',true),
  ('stone-granite','floor',true),('stone-granite','wall',true),
  ('mortar-cement','floor',true),('mortar-cement','wall',true),('mortar-cement','ceiling',true),('mortar-cement','baseboard',true),
  ('mortar-waterproof','floor',true),('mortar-waterproof','wall',true),
  ('mortar-self-leveling','floor',true),
  ('concrete-exposed','floor',true),('concrete-exposed','wall',true),('concrete-exposed','ceiling',true),
  ('wp-polymer-mortar','floor',true),('wp-cement-liquid','floor',true),('wp-cement-liquid','wall',true),
  ('paint-water-based','wall',true),('paint-water-based','ceiling',true),('paint-water-based','baseboard',true),
  ('coat-elastic','wall',true),('coat-elastic','ceiling',true),
  ('coat-epoxy-lining','floor',true),('coat-epoxy-mortar','floor',true),
  ('coat-urethane','floor',true),('coat-concrete-hardener','floor',true),
  ('board-gypsum','wall',true),('board-gypsum','ceiling',true),('board-gypsum','baseboard',true),
  ('board-gypsum-wr','wall',true),('board-crc','wall',true),('board-fiber-cement','wall',true),
  ('wp-silk','wall',true),('wp-silk','ceiling',true),('wp-paper','wall',true),('wp-paper','ceiling',true),
  ('frame-light-steel','ceiling',true),('frame-light-steel','wall',false),
  ('panel-abs-bath','ceiling',true),('panel-abs-bath','wall',false),
  ('base-bmc','baseboard',true),('base-readymade','baseboard',true)
 ) as v(mcode, pcode, typ)
 join finish_materials m on m.code = v.mcode
 join finish_parts p     on p.code = v.pcode
on conflict (material_id, part_id) do nothing;

-- 5) 물성 항목 ---------------------------------------------------------------
insert into finish_properties (code, name_ko, value_type, unit, min_value, max_value, source_text) values
 ('carpet_pile_mm','카펫 파일 높이','numeric','mm',0,100,'ADA §302.2 1/2in(12.7mm) 이하(backing·쿠션·패드 포함 측정). 삼성 파워봇은 모 길이 1cm 이하를 청소 가능 조건으로 공표'),
 ('csr','미끄럼저항계수 C.S.R','numeric',null,0,2,'KODDI BF 평가 신발·습윤 0.4 이상. 시험법 KS M 3802 부속서 A(경사인장형)'),
 ('csr_b','미끄럼저항계수 C.S.R·B','numeric',null,0,2,'맨발·습윤. KODDI BF 0.6 이상 / SH 시방서 SHCS 41 48 01:2020 욕실·샤워실 및 세탁기 전면 발코니 0.6 이상. 시험법 KS M 3510'),
 ('dcof','동적마찰계수 DCOF','numeric',null,0,2,'KS L 1001:2020 욕실용 바닥타일 0.40 이상(습윤, SLS 0.1%, BOT-3000E). ★C.S.R과 시험법이 다른 별개 값이며 혼동이 문헌에 보고돼 있다 - 섞지 말 것'),
 ('bpn','미끄럼저항 BPN','numeric',null,0,150,'KS F 4561 점자블록 40 BPN 이상. 시험법 KS F 2375(영국식 미끄럼저항 시험기 BPT)'),
 ('joint_width_mm','줄눈 폭','numeric','mm',0,50,'타일공사 시방서 2.1.1 부위별 적용규격(욕실벽·주방벽 2mm, 현관바닥 5mm)'),
 ('module_size','모듈 규격 표기','text',null,null,null,'"600X600" 등 도면·카탈로그 표기 문자열. 판정에 쓰지 않고 대조용'),
 ('is_low_reflect','저반사(어두운) 표면','boolean',null,null,null,'삼성: 검정색 카펫은 추락방지 센서가 빛을 흡수해 오작동한다')
on conflict (code) do nothing;

-- 5-b) 물성 값 — ★확인된 값만. "조사했으나 근거 없음"은 unknown_reason으로 남긴다
-- ★★ 이 절에는 num_value가 한 건도 없다. 이것이 사실이다.
--   이전 판은 규격의 **요구 하한**(KS L 1001 DCOF 0.40 / SH C.S.R·B 0.60 /
--   KS F 4561 40 BPN / KS F 3230 C.S.R 0.40)을 제품군의 **실측 물성** 자리에 넣었다.
--   그러면 판정이 "요구값 vs 요구값"이 되어 항상 pass가 난다 — 실제 시공된 타일의
--   DCOF가 0.30이어도 DB는 pass를 냈다. 관측값 자리에 요구값이 들어앉았기 때문이다.
--   같은 파일이 tile-polished는 이미 NULL+unknown_reason으로 처리하고 있어 자기모순이었다.
--   → 요구 하한은 **물성이 아니다**. 그 값들은 finish_properties(물성 등록부)의
--     source_text에 이미 규격 원문과 함께 살아 있고, 거기서는 판정 입력이 되지 않는다.
--     여기서는 "조사했으나 제품군 수준 실측 공표값 없음"으로만 남긴다.
--   ⚠ 요구 하한을 다시 이 표에 넣고 싶으면 material_properties에 value_kind
--     ('measured'|'required_min'|'manufacturer_declared')를 먼저 만들고 subject='finish'
--     지표가 'measured'만 읽도록 강제해야 한다. 그건 INSERT가 아니라 DDL이다.
-- ⚠ 컬럼명은 mode가 아니라 test_cond다(013이 로봇 운용 모드와 시험 조건 두 축을 갈랐다).
--   VALUES의 text 리터럴은 enum으로 암시 대입되지 않으므로 명시 캐스트가 필요하다.
-- ★ unit은 물성 등록부에서 그대로 내려받는다(coalesce '' — finish_properties.unit은 nullable).
--   임의 문자열을 쓰면 fn_material_property_guard가 23514로 거부한다. 이것이 C5의 요지다:
--   inch로 기록한 0.4가 mm 임계값 10과 비교돼 pass가 나던 경로를 닫는다.
insert into material_properties (material_id, property_id, value_type, test_cond, unit, num_value, unknown_reason, source_text)
select m.id, p.id, p.value_type, v.mode::test_condition, coalesce(p.unit, ''), v.num, v.unk, v.src
 from (values
  ('tile-vitreous','dcof','wet',null::double precision,'제품군 수준의 실측 공표값이 없다. KS L 1001:2020의 DCOF 0.40은 욕실용 바닥타일이 **충족해야 하는 하한**이지 이 제품군이 실제로 내는 값이 아니다','규격 요구 하한만 확인 - 실측 공표값 없음(요구값은 finish_properties.dcof.source_text에 있다)'),
  ('tile-porcelain','dcof','wet',null,'동상. 포세린은 별도 KS 분류가 아니라 자기질 중 무유·무광 계열의 시장 통칭이라 전용 공표값이 더욱 없다','규격 요구 하한만 확인 - 실측 공표값 없음'),
  ('tile-vitreous','csr_b','wet',null,'SH 시방서 SHCS 41 48 01:2020의 C.S.R·B 0.6 이상(맨발·물기)은 욕실·샤워실·세탁기 전면 발코니 바닥타일에 **요구되는 하한**이다. 제품군 실측값이 아니다','규격 요구 하한만 확인 - 실측 공표값 없음(요구값은 finish_properties.csr_b.source_text에 있다)'),
  ('block-braille','bpn','dry',null,'KS F 4561의 40 BPN은 점자블록이 **충족해야 하는 품질기준 하한**이다. 시험법은 KS F 2375. 제품군 실측 공표값은 확인하지 못했다','규격 요구 하한만 확인 - 실측 공표값 없음'),
  ('deck-wpc','csr','dry',null,'KS F 3230의 C.S.R 0.40 이상(건조)은 **규격 요구 하한**이다. ★연구자들은 습윤Ⅰ(물+규사+먼지) 조건 시험이 타당하다고 지적하므로 건조 하한을 실측 대용으로 쓰면 위험 방향으로 틀린다','규격 요구 하한만 확인 - 실측 공표값 없음'),
  ('sheet-vinyl-cushion','csr_b','wet',null,'제품군 수준의 공표값이 없다. LH 전문시방서 46540은 주거약자용 주택에 한해 시험을 요구하므로 값은 개별 제품 성적서에만 존재한다','조사 결과 시험 요구 규정만 확인되고 수치는 미확인'),
  ('carpet-tile','carpet_pile_mm','',null,'제품군 수준에 파일 높이 공표값이 없다. ★로봇 판정의 실제 입력이 이 값이라는 점이 이 DB의 최대 공백이다','조사 결과 KS K ISO 10874 사용등급만 확인'),
  ('tile-polished','dcof','wet',null,'폴리싱 타일 전용으로 공표된 미끄럼 규격값을 확인하지 못했다. KS L 1001 욕실용 하한을 그대로 옮기면 근거 없는 전용이 된다','조사 결과 공표 근거 없음')
 ) as v(mcode, pcode, mode, num, unk, src)
 join finish_materials m  on m.code = v.mcode
 join finish_properties p on p.code = v.pcode
on conflict (material_id, property_id, test_cond) do nothing;

-- 6) 로봇 등급 — ★운용 모드는 등급을 쪼개지 않고 robot_thresholds.mode로 표현한다
-- ★★ F2 — default_mode: 이 등급의 임계값이 어느 운용 모드로 선언돼 있는지를 등급이 선언한다.
--   commercial-cleaner 만 'clean' 이다. 이 등급은 drive/clean 두 벌로만 임계값을 갖는데
--   robot_thresholds.mode 가 정확 일치 파티션이라 기본 모드('')로 물으면 규칙 0건이었고,
--   인접 8건에 판정이 한 건도 생성되지 않았다(fail 도 안 나는 조용한 통과).
--   두 모드 중 'clean' 을 고른 근거: 단차 8mm / 경사 3도로 drive(10mm / 4.6도)보다 엄격해
--   폴백이 거짓 pass 를 만들지 않는다. drive 에만 있는 지표는 gap_width_mm 하나인데 그 행은
--   value NULL(공표 근거 없음)이라 애초에 'unknown' 밖에 내지 못한다 — 잃는 판정이 없다.
--   나머지 4등급은 모드 구분 없이 '' 한 벌이므로 default_mode 도 ''(컬럼 기본값)이다.
insert into robot_classes (code, name_ko, description, ref_width_mm, ref_length_mm, ref_height_mm, specs, default_mode, source_text, sort_order) values
 ('serving-delivery','서빙·배송로봇(실내)','가장 흔하고 가장 제약이 심한 부류',565,537,1290,
  '{"models":[{"name":"Pudu KettyBot Pro","w":435,"d":450,"h":1120,"step_mm":5,"slope_deg":5,"min_width_mm":550},{"name":"Pudu KettyBot","step_mm":7,"gap_mm":35,"slope_deg":5},{"name":"Pudu PuduBot 2","step_mm":10,"gap_mm":15,"slope_deg":5,"min_width_mm":800},{"name":"Pudu BellaBot","w":565,"d":537,"h":1290,"slope_deg":5},{"name":"Bear Servi","w":445,"d":430,"h":1046},{"name":"Bear Servi Plus","w":535,"d":590,"h":1230,"step_mm":12.7,"slope_deg":7},{"name":"Bear Servi Q","w":350,"d":466,"h":1060,"min_width_mm":450},{"name":"LG 클로이 서브봇","w":500,"d":500,"h":1300}]}',
  '', '제조사 공표 사양(academy.pudutech.com / pudurobotics.com / bearrobotics.ai / lge.co.kr). 등급 대푯값은 부류 내 가장 보수적인 공표치',10),
 ('industrial-amr','산업용 실내 배송 AMR','중하중 실내 AMR',534,835,1350,
  '{"models":[{"name":"Pudu T300","w":500,"d":835,"h":1350,"payload_kg":300,"step_mm":20,"gap_mm":35,"min_width_mm":600},{"name":"Pudu FlashBot Max","w":534,"d":538,"h":1052,"min_width_mm":600}]}',
  '', 'pudurobotics.com. 등판각은 공표되지 않았다',20),
 ('commercial-cleaner','상업용 청소로봇','★주행모드와 청소모드의 사양이 따로 공표된다 - mode 컬럼으로 가른다',962,1370,1417,
  '{"models":[{"name":"Pudu CC1","step_drive_mm":20,"step_clean_mm":8,"slope_drive_deg":8,"slope_clean_deg":3,"min_width_mm":700},{"name":"Gausium Scrubber 50","w":700,"d":810,"h":1070,"slope_deg":4.6,"min_width_mm":800,"uturn_mm":1100},{"name":"Gausium Scrubber 75","w":962,"d":1370,"h":1417,"step_mm":10,"slope_drive_deg":8,"slope_clean_deg":3,"min_width_mm":1400,"uturn_mm":2000},{"name":"Gausium Phantas","w":445,"d":585,"h":619,"slope_deg":5,"min_width_mm":650}]}',
  'clean', 'gausium.com/specs / academy.pudutech.com',30),
 ('domestic-cleaner','가정용 로봇청소기','★전용 리프팅 섀시로 예외적으로 높은 단차를 넘는다. 상업용에 일반화 금지',350,350,100,
  '{"models":[{"name":"Roborock 일반","step_mm":20},{"name":"Roborock S4","step_mm":15},{"name":"Roborock Saros 20","step_mm":88,"note":"이중턱 45+43"},{"name":"삼성 비스포크 AI 스팀","step_mm":45,"step_stair":"45+15(폭 90)"}]}',
  '', 'support.roborock.com / us.roborock.com / samsungsvc.co.kr',40),
 ('outdoor-delivery','실외이동로봇','지능형로봇법 운행안전인증 대상(질량 500kg 이하, 15km/h 이하)',null,null,null,
  '{"regulation":{"mass_kg_max":500,"speed_kmh_max":15,"scheme":"운행안전인증 심사 16개 항목"},"models":[]}',
  '', '★제품 정량 사양 미공개. 딜리가 인증을 취득했으나 등판각·단차 극복 수치는 확인 실패',50)
on conflict (code) do nothing;

-- 7) 지표 --------------------------------------------------------------------
insert into robot_metrics (code, name_ko, unit, subject, property_id, property_type, measurability, source_text, sort_order)
select v.code, v.name_ko, v.unit, v.subject::metric_subject, fp.id, fp.value_type,
       v.meas::drawing_measurability, v.src, v.ord
 from (values
  ('step_height_mm','단차 높이','mm','adjacency',null,'partial','마감 두께 차이와 문턱 상세로 설계 단차는 계산되나 시공 오차·문지방 실제 돌출은 도면으로 확정 불가. ADA §303: 6.4mm 이하 수직 허용, 6.4~12.7mm는 1:2 베벨, 12.7mm 초과는 램프',10),
  ('gap_width_mm','바닥 틈·그레이팅 개구','mm','adjacency',null,'partial','트렌치·그레이팅·익스팬션조인트는 상세도에 개구 규격이 있으면 확인 가능. ★엘리베이터 카-승강장 sill 틈(검사기준 40mm 이하)은 승강기 제작사 사양이라 건축 도면에 없다. ADA §302.3은 지름 12.7mm 구가 통과하지 못할 것을 요구',20),
  ('clear_width_mm','유효 통과폭','mm','adjacency',null,'yes','평면 개구부 치수로 직접 측정. 단 벽심이 아니라 마감면 간 유효폭이어야 하고 문틀·문선·도어클로저 암·걸레받이를 빼야 한다. 장애인등편의법 출입구 0.8m(신축 0.9m) 이상',30),
  ('turn_width_mm','U턴 가능 폭','mm','space',null,'yes','평면 형상으로 기하 판정 가능. 장애인등편의법 복도 유효폭 1.2m 이상. ★제조사가 "Min. U-Turn Width"로 공표한 값만 이 지표에 온다 - 권장 경로폭은 다른 물리량이므로 rec_path_width_mm로 분리했다',40),
  ('rec_path_width_mm','권장 경로폭','mm','space',null,'yes','제조사가 "recommended path width"로 공표하는 값. ★U턴 폭이 아니다 - 로봇이 실제로 회전할 수 있는 최소 폭(turn_width_mm)과 물리량이 다르고, 이 값을 U턴 칸에 넣으면 U턴 근거가 없는 등급에 U턴 판정이 생긴다. PuduBot 2는 1대 통과 0.8m / 권장 경로폭 1.2m / 2대 교행 2m 세 값을 따로 공표한다',45),
  ('slope_deg','경사로 기울기','deg','space',null,'yes','램프 시종점 레벨과 수평 투영 길이로 계산. 횡단구배는 평면도에 거의 표기되지 않고 전이부 급구배는 단면 상세가 필요. 장애인등편의법 1/12(약 4.76도), BF 최우수 1/18(약 3.18도)',50),
  ('carpet_pile_mm','카펫 파일 높이','mm','finish','carpet_pile_mm','partial','마감표로 카펫 구간의 위치는 확정되나 파일 높이·유형·색상은 자재 사양서를 연결해야 확정된다. 위치는 yes, 값은 no',60),
  ('floor_csr_b','바닥 미끄럼저항 C.S.R·B','','finish','csr_b','no','시공된 표면의 물리 속성이라 도면에서 측정 불가. 마감재 코드 → 시험성적서 참조로만 확보된다',70),
  ('floor_dcof','바닥 동적마찰계수 DCOF','','finish','dcof','no','동상. ★C.S.R과 시험법이 다르므로 별도 지표다',75),
  ('floor_flatness_mm_3m','바닥 평탄도(3m 기준)','mm','space',null,'no','시공 결과 속성이라 도면으로 측정 불가. ★이 프로젝트의 점군 스캔 분석이 담당하는 영역이며 도면 평가에서는 시공 후 검증 지표로 분리한다',80),
  ('elevator_car_width_mm','승강기 카 내부 폭','mm','space',null,'partial','건축 평면·코어 상세·EL 계획도로 측정 가능. sill 틈과 레벨 편차는 승강기 제조사 사양이라 확정 불가. 장애인등편의법 1.1m × 1.35m 이상. KS B 7317(2021)은 유료 표준이라 수치 미확인',90),
  ('elevator_car_depth_mm','승강기 카 내부 깊이','mm','space',null,'partial','동상',100)
 ) as v(code, name_ko, unit, subject, prop, meas, src, ord)
 left join finish_properties fp on fp.code = v.prop
on conflict (code) do nothing;

-- 8) 전역 기본 기준세트 --------------------------------------------------------
-- ⚠ 컬럼 5개에는 표현식 5개다. is_default 자리를 비운 채 4개만 주면
--   "INSERT has more target columns than expressions"로 하드 실패하고, 이 저장소는
--   psql 문장별 autocommit이라 8절 이후(기준세트·임계값·도면 전체)가 통째로 누락된 채
--   마스터만 적재된 "겉보기 성공" 상태가 남는다. is_default는 컬럼 목록에서 빼도 문법은
--   통과하지만 기본값 false가 되어 이름과 어긋나고 robot_rulesets_global_default 부분
--   유니크가 무의미해지므로 true를 명시한다.
-- ★ 대표값 선정 규칙(선언): "등급별 최보수 공표치". 이 문구와 9절 실제 값이 어긋나면
--   그것은 주석 오류가 아니라 **판정 오류**다 - 위험한 쪽으로 틀린다.
--   선정 규칙 준수 검사 쿼리는 11절 (g)에 있다.
insert into robot_rulesets (site_id, code, name_ko, source_text, is_default)
select null, 'robot-baseline-2026', '로봇 주행성 기본 기준세트 (2026 조사분)',
 '상용 로봇 제조사 공표 사양의 등급별 최보수 교집합(lte 지표는 등급 내 최소 공표치, gte 지표는 등급 내 최대 요구치). marginal_value에는 같은 등급에서 가장 관대한 기종의 공표치를 근거와 함께 둔다 - "일부 기종만 통과"를 뜻한다. 원문 대조표는 docs/robot-metric-sources.md. ★법규(장애인등편의법·ADA·BF)는 건축 하한이지 로봇 사양이 아니므로 임계값으로 쓰지 않고 source_text에만 병기한다', true
 where not exists (select 1 from robot_rulesets where site_id is null and code = 'robot-baseline-2026');

-- 9) 임계값 = 판정 규칙 --------------------------------------------------------
-- ★ value NULL = "조사했으나 공표 근거 없음". 지어낸 수치는 없다.
-- ★ 기준세트는 스칼라 서브쿼리로 가져온다. `cross join (select ...) rs` 뒤에
--   `on conflict`가 오면 파서가 `rs ON <조인조건>`으로 읽으려 해 혼동이 생긴다
--   (sqlglot 실측 실패. PostgreSQL은 CROSS JOIN에 ON을 허용하지 않아 통과하지만
--    도구·사람 모두에게 읽기 함정이라 형태를 바꿨다).
-- ★ unit은 조인된 robot_metrics의 unit을 그대로 쓴다. 013의 trg_robot_threshold_guard가
--   임계값 단위 ≠ 지표 단위를 23514로 거부하므로 리터럴로 적으면 오타가 곧 적재 실패다.
-- ★ mode는 robot_mode enum, applies_profile은 threshold_profile[] 이다.
--   VALUES의 text 리터럴은 암시 대입되지 않으므로 명시 캐스트한다.
-- ★ evidence는 전 행 필수다. [{"url","quote","grade"}] 형태이며 grade는
--   A=원문 직접 확인 / B=2차 인용·검색 요약 확인 / C=미확인.
--   "근거 없음" 행도 evidence를 비우지 않는다 - 무엇을 찾아봤는지가 근거다.
-- ★★ 대표값은 기준세트가 선언한 "등급별 최보수 공표치"를 따른다.
--   이전 판은 상업용 청소로봇 drive 모드에서 3개 지표 모두 선언을 어기고 관대한 값을
--   골랐다(등판 8° / 통과폭 800 / U턴 1,100). 결과는 안전한 쪽이 아니라 위험한 쪽이다 -
--   Scrubber 50(등판 4.6°)이 못 오르는 6° 램프가 pass로, Scrubber 75(통과폭 1,400)가
--   못 들어가는 900mm 통로가 pass로 찍혔다. 같은 파일이 clean 모드에서는 Scrubber 75의
--   1,400·2,000을 채택해 한 컬럼에 두 선정 규칙이 섞여 있었다.
--   가정용 등급의 단차 20mm도 같은 위반이었다(등급 내 최소 공표치는 S4의 15mm).
--   → 전부 최보수로 되돌리고, 관대한 기종의 값은 marginal_value로 내려 근거와 함께 둔다.
-- ★ 통과폭·U턴폭은 제조사가 모드별로 공표하지 않는다(기종별 단일 값이다).
--   그래서 drive와 clean이 같은 값을 갖는다 - 모드별로 다르게 적은 이전 판이 근거 없는 분화였다.
insert into robot_thresholds (ruleset_id, class_id, metric_id, mode, applies_profile,
                              unit, comparator, value, marginal_value, unknown_reason,
                              source_text, evidence)
select (select id from robot_rulesets where site_id is null and code = 'robot-baseline-2026'),
       rc.id, rm.id, v.mode::robot_mode, v.prof::threshold_profile[],
       rm.unit, v.cmp::comparator_op, v.val, v.marg, v.unk, v.src, v.ev::jsonb
 from (values
  -- ── 서빙·배송로봇 ────────────────────────────────────────────────────────────
  -- ★ 단차는 형상별로 두 행이다. ADA §303의 원 규정은 "6.4mm 초과~12.7mm 이하는
  --   1:2 이하 **베벨일 때만** 허용"인데, 이전 판은 근거를 잃은 12.7을 형상 무관
  --   marginal로 두어 **베벨 없는 수직턱 10mm에도 marginal**(=일부 기종 통과)이라는
  --   거짓 완충 판정을 냈다. 형상 미상(profile NULL)이면 형상 특정 행이 적용되지 않아
  --   fail로 떨어진다 - fn_resolve_thresholds가 그 선택을 한다.
  ('serving-delivery','step_height_mm','','{}','lte',5.0,null,null,
   'Pudu KettyBot Pro "Max. surmountable height: 5 mm". 등급 내 최소 공표치(KettyBot 7 / PuduBot 2 10 / Servi Plus 12.7). ★형상 무관 행이라 marginal을 두지 않는다 - Servi Plus의 12.7은 ADA 문턱 규정을 전제한 값이라 베벨 없는 수직턱에는 근거가 되지 않는다',
   '[{"url":"https://academy.pudutech.com/en/docs/chan-pin-jian-jie-hu-lu-pro","quote":"Max. surmountable height: 5 mm (0.20 in)","grade":"A"},{"url":"https://academy.pudutech.com/en/docs/FAQ-acuP","quote":"PuduBot 2 maximum surmountable height 10 mm","grade":"A"}]'),
  ('serving-delivery','step_height_mm','','{beveled,ramped,rounded}','lte',5.0,12.7,null,
   '동상. ★베벨·램프·라운드 문턱에 한해 marginal 12.7을 둔다 = 등급 내 최대 공표치(Bear Servi Plus "thresholds up to 1/2 in")이자 ADA §303의 베벨 상한과 같은 값이다. 형상이 미상이거나 수직이면 이 행은 적용되지 않는다',
   '[{"url":"https://www.bearrobotics.ai/servi-plus","quote":"thresholds up to 1/2\"","grade":"A"},{"url":"https://www.access-board.gov/ada/guides/chapter-3-floor-and-ground-surfaces/","quote":"ADA 303: 1/4 in vertical, 1/4-1/2 in beveled 1:2, over 1/2 in ramp","grade":"A"}]'),
  ('serving-delivery','gap_width_mm','','{}','lte',15.0,35.0,null,
   'Pudu PuduBot 2 "maximum surmountable gap no more than 15 mm" = 등급 내 최소 공표치. marginal 35 = KettyBot 극복 장애물 폭(등급 내 최대)',
   '[{"url":"https://academy.pudutech.com/en/docs/FAQ-acuP","quote":"maximum surmountable gap no more than 15 mm","grade":"A"},{"url":"https://robotplace.io/product/kettybot/","quote":"KettyBot 극복 장애물 폭 35mm","grade":"B"}]'),
  ('serving-delivery','clear_width_mm','','{}','gte',800.0,450.0,null,
   'Pudu PuduBot 2 "1대 통과 >= 0.8m" = 등급 내 최대 요구값(최보수). marginal 450 = 등급 내 최소 요구값(Bear Servi Q "최소 통로폭 18 in"). 450~800 구간은 Servi Q·KettyBot Pro(550)만 통과한다',
   '[{"url":"https://academy.pudutech.com/en/docs/FAQ-acuP","quote":"1대 통과 >= 0.8m, 2대 교행 >= 2m","grade":"A"},{"url":"https://www.bearrobotics.ai/servi-q","quote":"minimum aisle 18 in","grade":"A"},{"url":"https://academy.pudutech.com/en/docs/chan-pin-jian-jie-hu-lu-pro","quote":"Min. travel width: 55 cm","grade":"A"}]'),
  -- ★ U턴 폭은 NULL이다. 이전 판은 PuduBot 2의 "권장 경로폭 1.2m"를 U턴 칸에 넣었다.
  --   그것은 다른 물리량이고(같은 제조사가 통과 0.8m·권장 1.2m·교행 2m를 따로 공표한다),
  --   그 결과 폭 1,150mm 복도가 "서빙로봇 U턴 불가"로 보고서에 찍히지만 그 판정을
  --   뒷받침하는 제조사 공표치는 존재하지 않았다. 같은 등급의 다른 4지표는 근거가 없을 때
  --   전부 NULL+unknown_reason이었으므로 이것만 예외였다.
  --   1,200은 아래 rec_path_width_mm 행으로 옮겼다 - 값을 버리지 않고 제자리를 준다.
  ('serving-delivery','turn_width_mm','','{}','gte',null,null,
   '서빙·배송 등급 전 기종(KettyBot Pro/KettyBot/BellaBot/PuduBot 2/Servi/Servi Plus/Servi Q/클로이)에 U턴 폭 공표치가 한 건도 없다. U턴 공표치는 Gausium Scrubber 50(1,100)·75(2,000)뿐이다. PuduBot 2의 1.2m는 권장 경로폭이며 다른 지표다',
   '조사 결과 공표 근거 없음 - unknown_reason 참조',
   '[{"url":"https://academy.pudutech.com/en/docs/FAQ-acuP","quote":"1대 통과 0.8m / 권장 경로폭 1.2m / 2대 교행 2m (U-turn 항목 없음)","grade":"A"},{"url":"https://gausium.com/specs/scrubber50/","quote":"Min. U-Turn Width 1,100mm (청소로봇에만 존재)","grade":"A"}]'),
  ('serving-delivery','rec_path_width_mm','','{}','gte',1200.0,800.0,null,
   'Pudu PuduBot 2 "권장 경로폭 1.2m". ★U턴 폭이 아니라 권장 경로폭이다 - 같은 문서가 1대 통과 0.8m·2대 교행 2m를 따로 적는다. marginal 800 = 같은 문서의 "1대 통과" 하한(권장은 못 맞춰도 통과는 된다)',
   '[{"url":"https://academy.pudutech.com/en/docs/FAQ-acuP","quote":"1대 통과 >= 0.8m, 2대 교행 >= 2m, 권장 경로폭 >= 1.2m","grade":"A"}]'),
  ('serving-delivery','slope_deg','','{}','lte',5.0,7.0,null,
   'Pudu BellaBot·KettyBot·KettyBot Pro·PuduBot 2 "Max Climbing Angle <= 5도" = 등급 내 최소 공표치. marginal 7 = Bear Servi Plus(로커보기 서스펜션, 등급 내 최대). ★법정 최대 램프 1/12(4.76도)와 여유가 0.24도뿐이라 법규 최대치 램프는 실패 위험 구간이다',
   '[{"url":"https://www.pudurobotics.com/en/products/bellabot","quote":"Max Climbing Angle <= 5deg","grade":"A"},{"url":"https://kr.bearrobotics.ai/servi-plus","quote":"최대 7도 주행","grade":"A"}]'),
  ('serving-delivery','carpet_pile_mm','','{}','lte',null,null,
   '서빙·배송로봇 제조사가 카펫 파일 높이 한계를 공표하지 않았다. Pudu는 "short-pile hard carpet"이라는 정성 표현뿐이다. ADA §302.2의 12.7mm는 접근성 규격이지 로봇 사양이 아니므로 대입하지 않는다',
   '조사 결과 공표 근거 없음 - unknown_reason 참조',
   '[{"url":"https://academy.pudutech.com/en/docs/PUDU-CC1-Operation-Guide-V6","quote":"short-pile hard carpets (수치 없음)","grade":"A"},{"url":"https://www.access-board.gov/ada/guides/chapter-3-floor-and-ground-surfaces/","quote":"ADA 302.2 pile height 1/2 in max (접근성 규격)","grade":"A"}]'),
  ('serving-delivery','floor_csr_b','','{}','gte',null,null,
   '로봇 측에 규격화된 최소 마찰계수 요구값이 확인되지 않았다. 업계 문헌의 COF 0.6 권장은 제조사 규격이 아니다. ADA §302.1도 최소 마찰계수를 규정하지 않는다',
   '조사 결과 공표 근거 없음 - unknown_reason 참조',
   '[{"url":"https://www.robotics247.com/article/flooring_is_critical_for_successful_amr_and_agv_mobile_robot_performance/news","quote":"COF 0.6 권장 (업계 문헌, 규격 아님)","grade":"C"},{"url":"https://www.access-board.gov/ada/guides/chapter-3-floor-and-ground-surfaces/","quote":"slip resistant (최소 COF 미규정)","grade":"A"}]'),
  ('serving-delivery','floor_flatness_mm_3m','','{}','lte',null,null,
   '이동로봇용 실내 바닥 평탄도의 국내 법정 기준·제조사 공표 수치가 확인되지 않았다. 업계 자료의 FF/FL·±1.5mm·조인트 1.0mm는 시공사·자재사 마케팅 자료이며 표준이 아니다. 제조사 요구는 "flat and smooth ground"라는 정성 표현뿐이다',
   '조사 결과 공표 근거 없음 - unknown_reason 참조',
   '[{"url":"https://academy.pudutech.com/en/docs/chan-pin-jian-jie-hu-lu-pro","quote":"Indoor environment, flat and smooth ground","grade":"A"},{"url":"https://www.aceavant.com/robotics-ready-floors/","quote":"FF70/FL50, 3m 직선자 +-1.5mm (업계 자료, 규격 아님)","grade":"C"}]'),
  ('serving-delivery','elevator_car_width_mm','','{}','gte',null,null,
   '로봇 폭에 더할 여유(clearance)의 공표 근거가 없다. 장애인등편의법 1.1m는 건축 하한이지 로봇 요구가 아니다. KS B 7317(2021)이 단차·틈새 극복을 평가항목에 두지만 유료 표준이라 수치 미확인',
   '조사 결과 공표 근거 없음 - unknown_reason 참조',
   '[{"url":"https://www.ydp.go.kr/www/contents.do?key=3851","quote":"승강기 내부 폭 1.1m 이상 x 깊이 1.35m 이상 (건축 하한)","grade":"B"},{"url":"https://www.kssn.net/search/stddetail.do?itemNo=K001010135682","quote":"KS B 7317 표제만 확인 (유료 표준)","grade":"C"}]'),
  -- ── 산업용 실내 배송 AMR ─────────────────────────────────────────────────────
  ('industrial-amr','step_height_mm','','{}','lte',20.0,null,null,
   'Pudu T300 "Threshold Overcoming Height: 20 mm". 이 등급은 공표 기종이 2종뿐이고 FlashBot Max는 단차를 공표하지 않아 marginal을 둘 근거가 없다',
   '[{"url":"https://www.pudurobotics.com/en/products/pudut300","quote":"Threshold Overcoming Height: 20 mm","grade":"A"}]'),
  ('industrial-amr','gap_width_mm','','{}','lte',35.0,null,null,
   'Pudu T300 "Groove Crossing Width: 35 mm"',
   '[{"url":"https://www.pudurobotics.com/en/products/pudut300","quote":"Groove Crossing Width: 35 mm","grade":"A"}]'),
  ('industrial-amr','clear_width_mm','','{}','gte',600.0,null,null,
   'Pudu T300·FlashBot Max "Path Clearance >= 60 cm". 두 기종이 같은 값이라 marginal이 없다',
   '[{"url":"https://www.pudurobotics.com/en/products/pudut300","quote":"Path Clearance >= 60 cm","grade":"A"},{"url":"https://www.pudurobotics.com/en/products/flashbot-new","quote":"Path Clearance 60 cm","grade":"A"}]'),
  ('industrial-amr','slope_deg','','{}','lte',null,null,
   'Pudu T300·FlashBot Max의 최대 등판각 공표치를 확인하지 못했다. 서빙 등급의 5도를 옮기면 근거 없는 전용이 된다',
   '조사 결과 공표 근거 없음 - unknown_reason 참조',
   '[{"url":"https://www.pudurobotics.com/en/products/pudut300","quote":"제원표에 등판각 항목 없음","grade":"A"}]'),
  -- ── 상업용 청소로봇 ─────────────────────────────────────────────────────────
  ('commercial-cleaner','step_height_mm','drive','{}','lte',10.0,20.0,null,
   'Gausium Scrubber 75 "Min. Passable Obstacle Height: 10 mm" = 등급 내 최소 공표치. marginal 20 = Pudu CC1 주행모드(등급 내 최대)',
   '[{"url":"https://gausium.com/specs/scrubber-75/","quote":"Min. Passable Obstacle Height: 10 mm 0.4 in","grade":"A"},{"url":"https://academy.pudutech.com/en/docs/PUDU-CC1-Operation-Guide-V6","quote":"CC1 주행 20mm / 청소 8mm","grade":"A"}]'),
  ('commercial-cleaner','clear_width_mm','drive','{}','gte',1400.0,650.0,null,
   'Gausium Scrubber 75 "Min. Pass Width 1400mm" = 등급 내 최대 요구값(최보수). ★이전 판의 800(Scrubber 50)은 선언한 최보수 규칙 위반이었고 Scrubber 75가 못 들어가는 900mm 통로를 pass로 만들었다. marginal 650 = Gausium Phantas(등급 내 최소). 지하주차장 1,800mm는 별도 조건이라 취하지 않았다. ★통과폭은 모드별로 공표되지 않아 clean과 같은 값이다',
   '[{"url":"https://gausium.com/specs/scrubber-75/","quote":"Min. Pass Width 1,400mm (지하주차장 1,800mm)","grade":"A"},{"url":"https://gausium.com/specs/phantas/","quote":"Min. Pass Width: 650 mm","grade":"A"},{"url":"https://gausium.com/specs/scrubber50/","quote":"Min. Pass Width 800mm","grade":"A"}]'),
  ('commercial-cleaner','turn_width_mm','drive','{}','gte',2000.0,1100.0,null,
   'Gausium Scrubber 75 "Min. U-Turn Width 2,000mm" = 등급 내 최대 요구값(최보수). ★이전 판의 1,100(Scrubber 50)은 최보수 규칙 위반. marginal 1,100 = Scrubber 50(등급 내 최소). ★U턴 폭도 모드별 공표가 없어 clean과 같은 값이다',
   '[{"url":"https://gausium.com/specs/scrubber-75/","quote":"Min. U-Turn Width 2,000mm","grade":"A"},{"url":"https://gausium.com/specs/scrubber50/","quote":"Min. U-Turn Width 1,100mm","grade":"A"}]'),
  ('commercial-cleaner','slope_deg','drive','{}','lte',4.6,8.0,null,
   'Gausium Scrubber 50 "Max Slope 4.6도" = 등급 내 최소 공표치(최보수). ★이전 판의 8.0은 선언한 규칙 위반이었고 Scrubber 50이 못 오르는 6도 램프를 pass로 만들었다. marginal 8 = Pudu CC1 비청소 주행·Scrubber 75 Auto Driving(등급 내 최대). Phantas는 5도',
   '[{"url":"https://gausium.com/specs/scrubber50/","quote":"Max Slope 4.6deg","grade":"A"},{"url":"https://gausium.com/specs/scrubber-75/","quote":"Gradeability Auto Driving 8deg / Auto Cleaning 3deg","grade":"A"},{"url":"https://academy.pudutech.com/en/docs/PUDU-CC1-Operation-Guide-V6","quote":"주행 8deg / 청소 3deg 초과 금지","grade":"A"},{"url":"https://gausium.com/specs/phantas/","quote":"Gradeability: 5deg","grade":"A"}]'),
  ('commercial-cleaner','gap_width_mm','drive','{}','lte',null,null,
   '상업용 청소로봇의 틈 극복 폭 공표치를 확인하지 못했다',
   '조사 결과 공표 근거 없음 - unknown_reason 참조',
   '[{"url":"https://gausium.com/specs/scrubber-75/","quote":"제원표에 groove/gap 항목 없음","grade":"A"},{"url":"https://academy.pudutech.com/en/docs/PUDU-CC1-Operation-Guide-V6","quote":"틈 극복 폭 서술 없음","grade":"A"}]'),
  ('commercial-cleaner','step_height_mm','clean','{}','lte',8.0,10.0,null,
   'Pudu CC1 청소모드 8mm = 등급 내 최소 공표치. marginal 10 = Gausium Scrubber 75의 통과 장애물 높이(모드 구분 없이 공표되어 청소 중에도 유효한 값으로 읽는다)',
   '[{"url":"https://academy.pudutech.com/en/docs/PUDU-CC1-Operation-Guide-V6","quote":"CC1 청소모드 8mm","grade":"A"},{"url":"https://gausium.com/specs/scrubber-75/","quote":"Min. Passable Obstacle Height: 10 mm","grade":"A"}]'),
  ('commercial-cleaner','clear_width_mm','clean','{}','gte',1400.0,650.0,null,
   'Gausium Scrubber 75 "Min. Pass Width 1400mm"(지하주차장 1800mm는 별도 조건이라 취하지 않았다). marginal 650 = Phantas. ★drive와 같은 값인 것이 맞다 - 제조사는 통과폭을 모드별로 공표하지 않는다',
   '[{"url":"https://gausium.com/specs/scrubber-75/","quote":"Min. Pass Width 1,400mm","grade":"A"},{"url":"https://gausium.com/specs/phantas/","quote":"Min. Pass Width: 650 mm","grade":"A"}]'),
  ('commercial-cleaner','turn_width_mm','clean','{}','gte',2000.0,1100.0,null,
   'Gausium Scrubber 75 "Min. U-Turn Width 2,000mm". marginal 1,100 = Scrubber 50',
   '[{"url":"https://gausium.com/specs/scrubber-75/","quote":"Min. U-Turn Width 2,000mm","grade":"A"},{"url":"https://gausium.com/specs/scrubber50/","quote":"Min. U-Turn Width 1,100mm","grade":"A"}]'),
  ('commercial-cleaner','slope_deg','clean','{}','lte',3.0,null,null,
   'Pudu CC1 청소 중 3도 초과 금지 / Gausium Scrubber 75 Auto Cleaning 3도. 두 기종이 같은 값이고 더 관대한 청소모드 공표치가 없어 marginal이 없다. ★BF 최우수 램프(1/18, 3.18도)와 거의 같아 법정 최대 1/12 램프에서는 청소 불가',
   '[{"url":"https://academy.pudutech.com/en/docs/PUDU-CC1-Operation-Guide-V6","quote":"청소 중 3deg 초과 금지","grade":"A"},{"url":"https://gausium.com/specs/scrubber-75/","quote":"Gradeability Auto Cleaning 3deg","grade":"A"}]'),
  -- ── 가정용 로봇청소기 ────────────────────────────────────────────────────────
  ('domestic-cleaner','step_height_mm','','{}','lte',15.0,45.0,null,
   'Roborock S4 15mm = 등급 내 최소 공표치(최보수). ★이전 판의 20mm는 "대부분 모델" 값이라 선언한 최보수 규칙 위반이었다 - S4를 쓰는 세대에서 18mm 문턱이 pass로 찍힌다. marginal 45 = 삼성 비스포크 이지패스 휠(등급 내 최대). ★Saros 20의 88mm는 "앞턱이 더 낮은 이중턱"이라는 조건부 값이라 등급 대표에 쓰지 않았다',
   '[{"url":"https://support.roborock.com/hc/en-us/articles/900002080603","quote":"대부분 2cm, S4 1.5cm (403으로 원문 열람 실패, 검색 요약 확인)","grade":"B"},{"url":"https://www.samsungsvc.co.kr/solution/4603281","quote":"단일 문턱·매트 최대 45mm","grade":"A"},{"url":"https://us.roborock.com/products/roborock-saros-20","quote":"AdaptiLift Chassis 3.0 with 3.46 in Double-Layer Lift","grade":"A"}]'),
  ('domestic-cleaner','carpet_pile_mm','','{}','lte',10.0,null,null,
   '삼성 파워봇 "모 길이가 1cm 이하이고 두께가 1.5cm 이하인 밝은색 카펫일 경우 청소를 잘 할 수 있어요". 다른 가정용 제조사의 파일 높이 공표치를 찾지 못해 marginal이 없다',
   '[{"url":"https://www.samsungsvc.co.kr/solution/147389","quote":"모 길이가 1cm 이하이고, 두께가 1.5cm 이하인 밝은색 카펫","grade":"A"}]'),
  ('domestic-cleaner','slope_deg','','{}','lte',null,null,
   '가정용 로봇청소기의 최대 등판각 공표치를 확인하지 못했다',
   '조사 결과 공표 근거 없음 - unknown_reason 참조',
   '[{"url":"https://support.roborock.com/hc/en-us/articles/900002080603","quote":"등판각 항목 없음(단차만 공표)","grade":"B"}]'),
  -- ── 실외이동로봇 ────────────────────────────────────────────────────────────
  ('outdoor-delivery','slope_deg','','{}','lte',null,null,
   '실외이동로봇은 운행안전인증 제도(질량 500kg·15km/h, 심사 16개 항목)만 확인됐고 제품 정량 사양이 비공개다',
   '조사 결과 공표 근거 없음 - unknown_reason 참조',
   '[{"url":"https://www.kiria.org/","quote":"실외이동로봇 운행안전인증 심사 16개 항목(등판각 수치 없음)","grade":"B"}]'),
  ('outdoor-delivery','step_height_mm','','{}','lte',null,null,
   '동상. 딜리 X3-R 1.4의 "바퀴 대형화로 낮은 연석 극복"은 보도자료 서술이며 수치가 없다',
   '조사 결과 공표 근거 없음 - unknown_reason 참조',
   '[{"url":"https://www.kiria.org/","quote":"제품 정량 사양 미공개","grade":"C"}]')
 ) as v(ccode, mcode, mode, prof, cmp, val, marg, unk, src, ev)
 join robot_classes rc on rc.code = v.ccode
 join robot_metrics rm on rm.code = v.mcode
on conflict (ruleset_id, class_id, metric_id, mode, applies_profile) do nothing;

-- =============================================================================
-- 10) LH 26형 도면 적재
--   원본: (도면)_01_LH공동주택주력평면_26형.pdf (2025.10.22)
--   전량 pymupdf 텍스트 레이어 직접 추출. OCR 미사용, 추론으로 채운 값 없음.
-- =============================================================================
-- 10-1) 발주처 코드체계 (site_id NULL = 전역 표준 코드집. 가짜 sites 행을 만들지 않는다)
insert into code_systems (site_id, code, issuer, name_ko, revision, source_text)
select null, 'lh-apt-unit-2025', 'LH', 'LH 단위세대 주력평면 마감코드', '2025.10.22',
 '★F-/W-/B-/C- 접두 일련번호. 전국 표준 코드집으로 공표된 근거를 찾지 못했다. "B" 접미의 의미와 F-13 부재 이유 모두 확인 실패. 재료를 뜻하지 않고 "마감 사양 세트 ID"이며 F-14 하나가 발코니·실외기실 두 실에 공유된다 - 조회 키로 쓰면 다른 발주처 도면에서 즉시 깨진다'
 where not exists (select 1 from code_systems where site_id is null and code = 'lh-apt-unit-2025');

-- ⚠ drawings의 유니크는 테이블 제약이 아니라 "전역/현장 부분 유니크 2종"이다
--   (013: drawings_global_doc / drawings_site_doc, 둘 다 system_id를 coalesce로 접어
--    키에 넣는다). 부분 인덱스는 ON CONFLICT 추론 대상이 되지 못해 42P10으로 죽는다.
--   → 바로 위 code_systems와 같은 where not exists 형태로 맞춘다(이 파일의 기존 관례).
insert into drawings (site_id, system_id, doc_key, doc_no, title, revision, drawn_on, source_text)
select null, cs.id, 'lh-26형-2025.10.22', 'AA-004', '실내재료마감표', '', date '2025-10-22',
 '4쪽 주기4 "실내외 재료마감표가 타 도면보다 우선". NOTE 열 전 행 공란, 욕실 BASEBOARD NO. 칸은 "(none)" 인쇄, 발코니·실외기실 CEILING HEIGHT 공란'
 from code_systems cs
 where cs.site_id is null and cs.code = 'lh-apt-unit-2025'
   and not exists (select 1 from drawings d2
                    where d2.site_id is null and d2.system_id = cs.id
                      and d2.doc_key = 'lh-26형-2025.10.22' and d2.doc_no = 'AA-004'
                      and d2.revision = '');

-- 10-2) 4쪽 마감표 (code_set='finish-schedule')
insert into project_codes (system_id, drawing_id, code_set, code, kind, part_id, description, thickness_mm, height_mm, source_page, raw, source_text)
select cs.id, d.id, 'finish-schedule', v.code, 'finish_set'::project_code_kind, p.id,
       v.descr, v.thk, v.hgt, 4,
       jsonb_build_object('description', v.descr, 'thickness_mm', coalesce(v.thk::text, '')),
       'AA-004 실내재료마감표 원문 문자열 그대로'
 from (values
  ('F-10B','floor','BASE: 시멘트 모르타르 / FINISH: 포셀린타일(600X600)',80.0,null),
  ('F-11','floor','BASE: 패널히팅 / FINISH: 기능성륨카펫(6.0T이상)',110.0,null),
  ('F-12','floor','BASE: THK60 수평조절 모르타르 / FINISH: 시스템욕실/자기질타일(300X300)',180.0,null),
  ('F-14','floor','BASE: THK10 방수모르타르/시멘트 모르타르 / FINISH: 자기질타일',35.0,null),
  ('W-7,8,9','wall','BASE: 콘크리트/THK9.5 석고보드 / FINISH: 실크도배지',null,null),
  ('W-12','wall','BASE: 시스템욕실/시멘트모르타르/콘크리트 / FINISH: 시스템욕실/도기질타일(600X300)',null,null),
  ('W-14','wall','BASE: 콘크리트/THK9.5 방수석고보드 / FINISH: 실크도배지, 도기질타일',null,null),
  ('W-15','wall','BASE: 콘크리트 / FINISH: 내부수성페인트',null,null),
  ('B-7B','baseboard','BASE: 콘크리트/THK9.5 석고보드 / FINISH: 인조대리석(BMC)',null,40.0),
  ('B-9,10','baseboard','BASE: 콘크리트/THK9.5 석고보드 / FINISH: 기성품걸레받이재',null,80.0),
  ('B-14','baseboard','BASE: 시멘트모르타르 / FINISH: 굽도리모르타르면 페인트',null,80.0),
  ('B-18','baseboard','BASE: 시멘트모르타르 / FINISH: 굽도리모르타르면 페인트',null,80.0),
  ('C-6A','ceiling','BASE: 경량철골 천장틀/THK9.5 석고보드 / FINISH: 실크도배지',null,2340.0),
  ('C-6B','ceiling','BASE: 경량철골 천장틀/THK9.5 석고보드 / FINISH: 실크도배지',null,2300.0),
  ('C-8','ceiling','BASE: 경량철골 천장틀 / FINISH: 시스템욕실/ABS 판넬',null,2200.0),
  ('C-10','ceiling','BASE: 콘크리트 / FINISH: 내부 수성페인트',null,null)
 ) as v(code, part, descr, thk, hgt)
 join code_systems cs on cs.site_id is null and cs.code = 'lh-apt-unit-2025'
 join drawings d      on d.system_id = cs.id and d.doc_key = 'lh-26형-2025.10.22' and d.doc_no = 'AA-004'
 join finish_parts p  on p.code = v.part
on conflict (system_id, code_set, code) do nothing;

-- 10-3) 7쪽 시공한계도 기호 (code_set='wall-limit') — ★한 도면 안의 다른 네임스페이스
insert into project_codes (system_id, drawing_id, code_set, code, kind, part_id, description, thickness_mm, source_page, source_text)
select cs.id, d.id, 'wall-limit', v.code, 'finish_set'::project_code_kind, p.id, v.descr, v.thk, 7,
 '7쪽 내부벽 마감시공한계도 기호. ★4쪽 W- 코드와 다른 체계다 - code_set이 없으면 한 글자 코드 A·B·C가 다른 발주처 코드와 충돌한다'
 from (values ('A','THK9.5 석고보드/실크도배지마감',9.5),('B','콘크리트/실크도배지',null),
              ('C','THK15 시멘트모르타르/실크도배지',15.0),('D','THK9.5 석고보드2겹/실크도배지마감',9.5),
              ('F','THK9.5 방수석고보드/도기질타일',9.5),('G','콘크리트/내부수성페인트',null),
              ('R','THK4.5 CRC보드/내부수성페인트',4.5)
 ) as v(code, descr, thk)
 join code_systems cs on cs.site_id is null and cs.code = 'lh-apt-unit-2025'
 join drawings d      on d.system_id = cs.id and d.doc_key = 'lh-26형-2025.10.22' and d.doc_no = 'AA-004'
 join finish_parts p  on p.code = 'wall'
on conflict (system_id, code_set, code) do nothing;

-- 10-4) 6쪽 창호일람표 (code_set='window-schedule') — 인접 경계가 참조한다
-- ★ part_id = finish_parts('other'). 1절이 'other'를 "창호·단열·방수 등 4부위에 속하지
--   않는 도면 코드의 수용처"라 선언해 놓고 이전 판은 part_id를 아예 지정하지 않아 NULL을
--   넣었다 - 선언한 탈출구가 0건이라 "부위 축이 도면의 모든 코드를 덮지 못한다"는 사실을
--   드러내기는커녕 감췄다. 이제 "부위로 분류할 수 없음"이 NULL(미상)이 아니라 명시 행이다.
insert into project_codes (system_id, drawing_id, code_set, code, kind, part_id, description, source_page, source_text)
select cs.id, d.id, 'window-schedule', v.code, 'opening'::project_code_kind, po.id, v.descr, 6,
 '★유효 통과폭(clear width)은 도면 어디에도 없다 - 개구부 치수 > 창호제작치수 관계만 존재한다. 정면도의 950(D-2)·900(SD)은 지시 대상이 표기되지 않아 통과폭으로 단정할 수 없다'
 from (values
  ('AG','알루미늄 그릴창 / 실외기실 / 모듈 900 X 2,400 / 개구부 910 X 2,410 / 제작 890 X 2,390'),
  ('BP','합성수지 발코니창 / 발코니 / 모듈 2,000 X 2,200 / 개구부 2,010 X 2,210 / 제작 1,990 X 2,190'),
  ('DPW','합성수지 미서기문(이중문) / 거실 / 모듈 2,000 X 2,300 / 개구부 2,010 X 2,335 / 제작 1,990 X 2,325'),
  ('D-2','철재 여닫이문(결로방지용,방범용) / 현관 / 모듈 1,100 X 2,200 / 개구부 1,120 X 2240 / 제작 1,090 X 2,225'),
  ('SD','철제여닫이문 / 발코니 / 모듈 700 X 2,100 / 개구부 710 X 2,110 / 제작 690 X 2,090')
 ) as v(code, descr)
 join code_systems cs on cs.site_id is null and cs.code = 'lh-apt-unit-2025'
 join drawings d      on d.system_id = cs.id and d.doc_key = 'lh-26형-2025.10.22' and d.doc_no = 'AA-004'
 join finish_parts po on po.code = 'other'
on conflict (system_id, code_set, code) do nothing;

-- 10-5) 9쪽 방수 일람표 (code_set='waterproof-schedule') — part_id는 'other'
insert into project_codes (system_id, drawing_id, code_set, code, kind, part_id, description, thickness_mm, source_page, source_text)
select cs.id, d.id, 'waterproof-schedule', v.code, 'waterproof'::project_code_kind, po.id, v.descr, v.thk, 9,
 '9쪽 방수 및 코킹 일람표. 표기 열은 전 행 공란. ★방수는 바닥용·벽체용이 한 표에 섞여 있어 4부위 축으로 나뉘지 않는다 - 부위는 other다'
 from (values
  ('폴리머모르타르','구분: 폴리머모르타르 / 적용: 발코니 / 규격: THK10 (부기 "방수모르타르와 병행 적용가능")',10.0),
  ('시멘트 액체방수(복도)','구분: 시멘트 액체방수 / 적용: 복도 / 규격: THK4 / 부기 "*바닥용"',4.0),
  ('시멘트 액체방수(욕실)','구분: 시멘트 액체방수 / 적용: 욕실 / 규격: THK4 / 부기 "*벽체용"',4.0)
 ) as v(code, descr, thk)
 join code_systems cs on cs.site_id is null and cs.code = 'lh-apt-unit-2025'
 join drawings d      on d.system_id = cs.id and d.doc_key = 'lh-26형-2025.10.22' and d.doc_no = 'AA-004'
 join finish_parts po on po.code = 'other'
on conflict (system_id, code_set, code) do nothing;

-- 10-5b) 9쪽 단열 및 결로저감재 일람표 (code_set='insulation-schedule', kind='insulation')
-- ★ project_code_kind에 'insulation'을 만들어 놓고 이전 판은 대응 행을 한 건도 넣지
--   않았다. 근거자료(research_drawing)에 원문이 이미 있어 새 조사 없이 적재된다.
--   단열재는 마감 부위 축(바닥·벽·천장·걸레받이) 어디에도 속하지 않으므로 part는 other다.
insert into project_codes (system_id, drawing_id, code_set, code, kind, part_id, description, thickness_mm, source_page, source_text)
select cs.id, d.id, 'insulation-schedule', v.code, 'insulation'::project_code_kind, po.id, v.descr, v.thk, 9,
 '9쪽 단열 및 결로저감재 일람표. 부기 "* 단열재 시공기준 : 중부2", "* 외벽과 조적벽이 만나는 부위 : 주변 단열재 연장 시공", "■ 하부 시공한계 : 판넬히팅". ★코드가 한 글자 숫자라 code_set 없이는 다른 발주처 코드와 즉시 충돌한다'
 from (values
  ('2','구분: 외벽 간면 / 재료명: THK100 경질우레탄(1종3호)',100.0),
  ('6','구분: 발코니 벽 / 재료명: 비드법(30T)+CRC보드(4.5T)+수성페인트',null::double precision)
 ) as v(code, descr, thk)
 join code_systems cs on cs.site_id is null and cs.code = 'lh-apt-unit-2025'
 join drawings d      on d.system_id = cs.id and d.doc_key = 'lh-26형-2025.10.22' and d.doc_no = 'AA-004'
 join finish_parts po on po.code = 'other'
on conflict (system_id, code_set, code) do nothing;

-- 10-5c) 9쪽 코킹 일람표 (code_set='caulking-schedule', kind='other')
-- ★ project_code_kind의 'other'도 이전 판에서 0건이었다. 코킹은 마감재도 개구부도
--   단열도 방수도 아니다 - 같은 표(9쪽 "방수 및 코킹 일람표")에 실려 있지만 방수로
--   묶으면 거짓 분류가 된다. 이것이 'other'가 존재하는 이유이고, 비어 있으면 그 이유가
--   증명되지 않는다.
insert into project_codes (system_id, drawing_id, code_set, code, kind, part_id, description, thickness_mm, source_page, source_text)
select cs.id, d.id, 'caulking-schedule', v.code, 'other'::project_code_kind, po.id, v.descr, v.thk, 9,
 '9쪽 방수 및 코킹 일람표의 코킹 절. 규격 "10 + 10"은 코킹 단면 치수(mm)이며 마감 두께가 아니다'
 from (values
  ('코킹-골조조적','구분: 골조+조적 접하는 부분 / 규격: 10 + 10 / 부기 "*조적벽 전체높이까지"',10.0),
  ('코킹-문틀','구분: 골조, 조적 + 문틀부분 / 규격: 10 + 10 / 부기 "*도어 전둘레", "*욕실내부에 접하는 부분"',10.0),
  ('코킹-외부창호','구분: 골조+외부창호 접하는 부분 / 규격: 10 + 10 / 부기 "*창문 전둘레", "*외부에 접하는 부분"',10.0)
 ) as v(code, descr, thk)
 join code_systems cs on cs.site_id is null and cs.code = 'lh-apt-unit-2025'
 join drawings d      on d.system_id = cs.id and d.doc_key = 'lh-26형-2025.10.22' and d.doc_no = 'AA-004'
 join finish_parts po on po.code = 'other'
on conflict (system_id, code_set, code) do nothing;

-- 10-6) 코드 → 표준 제품군 매핑 (★도면 원문 raw_text + 매핑 신뢰도를 함께 남긴다)
insert into project_code_layers (project_code_id, role, layer_no, material_id, confidence, raw_text, thickness_mm, note)
select pc.id, v.role::layer_role, v.lno, m.id, v.conf::mapping_confidence, v.raw, v.thk, v.note
 from (values
  ('F-10B','base',1,'mortar-cement','exact','시멘트 모르타르',null::double precision,null),
  ('F-10B','finish',1,'tile-porcelain','exact','포셀린타일(600X600)',null,'600x600 대형판이라 바탕 평탄도 요구가 상대적으로 엄격하다. "포셀린"은 별도 제품군이 아니라 자기질 중 무유·무광 계열의 시장 통칭'),
  ('F-11','base',1,null,'unmapped','패널히팅',null,'★마감재가 아니라 바닥난방 설비다. 경량기포콘크리트·온돌배관 층 두께는 도면 10쪽 어디에도 없어 THK 110의 내역을 복원할 수 없다'),
  ('F-11','finish',1,'sheet-vinyl-cushion','approximate','기능성륨카펫(6.0T이상)',6.0,'도면 명칭 "륨카펫"은 카펫이 아니라 쿠션형 PVC 시트다. 매핑 근거는 LH 보도자료의 "두께가 두꺼워 소음 방지 기능이 좋은 바닥재" 서술 - 제조사 모델까지 특정되지 않아 approximate'),
  ('F-12','base',1,'mortar-self-leveling','exact','THK60 수평조절 모르타르',60.0,'★이 용역의 평탄도 시공 대상 층. THK 180 중 60만 설명되고 나머지 120의 내역은 도면에 없다 - 계산으로 메우지 않는다'),
  ('F-12','finish',1,'tile-vitreous','approximate','시스템욕실/자기질타일(300X300)',null,'"시스템욕실" 조합 시공이라 단일 제품군 매핑이 정확하지 않다'),
  ('F-14','base',1,'mortar-waterproof','exact','THK10 방수모르타르',10.0,'9쪽 방수일람표는 발코니에 폴리머모르타르 THK10을 적고 "병행 적용가능" 부기를 단다 - 마감표와 일람표가 다른 재료를 가리킬 수 있다'),
  ('F-14','base',2,'mortar-cement','exact','시멘트 모르타르',null,'★도면 BASE 열의 "/" 표기 순서가 층의 상하 순서를 보장하지 않는다. layer_no는 파서 추정값이다'),
  ('F-14','finish',1,'tile-vitreous','exact','자기질타일',null,'도면에 치수 표기 없음. 논슬립 사양 여부는 도면에서 확정 불가'),
  ('W-7,8,9','base',1,'board-gypsum','exact','콘크리트/THK9.5 석고보드',9.5,'"콘크리트"는 구조체라 마감재 층으로 세지 않는다'),
  ('W-7,8,9','finish',1,'wp-silk','exact','실크도배지',null,null),
  ('W-12','base',1,'mortar-cement','approximate','시스템욕실/시멘트모르타르/콘크리트',null,'"시스템욕실" 조합 시공이라 단일 제품군 매핑이 정확하지 않다'),
  ('W-12','finish',1,'tile-earthenware','exact','시스템욕실/도기질타일(600X300)',null,null),
  ('W-14','base',1,'board-gypsum-wr','exact','콘크리트/THK9.5 방수석고보드',9.5,null),
  ('W-14','finish',1,'wp-silk','exact','실크도배지',null,'★도면 FINISH 칸에 "실크도배지, 도기질타일" 둘이 병기된다 - 실 안에서 부위가 나뉜다는 뜻이라 층으로 겹쳐 넣지 않고 layer_no 1·2로 둘 다 남긴다'),
  ('W-14','finish',2,'tile-earthenware','exact','도기질타일',null,'동상'),
  ('W-15','finish',1,'paint-water-based','exact','내부수성페인트',null,'BASE "콘크리트"는 구조체'),
  ('B-7B','base',1,'board-gypsum','exact','콘크리트/THK9.5 석고보드',9.5,null),
  ('B-7B','finish',1,'base-bmc','exact','인조대리석(BMC)',null,null),
  ('B-9,10','base',1,'board-gypsum','exact','콘크리트/THK9.5 석고보드',9.5,null),
  ('B-9,10','finish',1,'base-readymade','exact','기성품걸레받이재',null,null),
  ('B-14','base',1,'mortar-cement','exact','시멘트모르타르',null,null),
  ('B-14','finish',1,'paint-water-based','approximate','굽도리모르타르면 페인트',null,'도면이 도료 종류를 특정하지 않는다. 내부수성페인트로 추정 매핑'),
  ('B-18','base',1,'mortar-cement','exact','시멘트모르타르',null,null),
  ('B-18','finish',1,'paint-water-based','approximate','굽도리모르타르면 페인트',null,'동상'),
  ('C-6A','base',1,'frame-light-steel','exact','경량철골 천장틀',null,null),
  ('C-6A','base',2,'board-gypsum','exact','THK9.5 석고보드',9.5,null),
  ('C-6A','finish',1,'wp-silk','exact','실크도배지',null,null),
  ('C-6B','base',1,'frame-light-steel','exact','경량철골 천장틀',null,null),
  ('C-6B','base',2,'board-gypsum','exact','THK9.5 석고보드',9.5,null),
  ('C-6B','finish',1,'wp-silk','exact','실크도배지',null,null),
  ('C-8','base',1,'frame-light-steel','exact','경량철골 천장틀',null,null),
  ('C-8','finish',1,'panel-abs-bath','exact','시스템욕실/ABS 판넬',null,null),
  ('C-10','finish',1,'paint-water-based','exact','내부 수성페인트',null,'BASE "콘크리트"는 구조체')
 ) as v(pcode, role, lno, mcode, conf, raw, thk, note)
 join code_systems cs         on cs.site_id is null and cs.code = 'lh-apt-unit-2025'
 join project_codes pc        on pc.system_id = cs.id and pc.code_set = 'finish-schedule' and pc.code = v.pcode
 left join finish_materials m on m.code = v.mcode
on conflict (project_code_id, role, layer_no) do nothing;

-- 10-7) 실 — ★도면 원문 모순은 해소하지 않고 conflict_note + raw에 둘 다 남긴다
-- ★★ C6: basis가 '이 실이 도면으로 확정된 것인가'를 가른다.
--   drawing_confirmed 7개 = 3쪽 면적산출표에 면적 항목이 있고 면(face)이 있는 실
--     (거실/침실·주방/식당·욕실·현관·PD·발코니·벽체공용).
--   inferred 2개 = 실외기실·복도. 1쪽 평면에 FL 라벨은 있으나 3쪽 면적도에 면이 없어
--     면적도 접촉길이도 계산할 수 없었다. basis_note에 그 사실을 행마다 남긴다.
--   질의: select name, basis, basis_note from spaces where basis='inferred';
insert into spaces (drawing_id, name, area_m2, fl_mm, sl_mm, ceiling_height_mm, conflict_note,
                    basis, basis_note, raw, source_text)
select d.id, v.name, v.area, v.fl, v.sl, v.ch, v.conflict,
       v.basis::evidence_basis, v.basis_note, v.raw::jsonb,
 '1쪽 평면 실별 레벨 라벨 + 3쪽 면적표 + 4쪽 CEILING HEIGHT. outline(폴리곤)은 0단계 도면 기하 복원 산출물이 들어올 자리이며 지금은 NULL이다 - 텍스트 레이어에는 실 경계 좌표가 없다'
 from (values
  ('현관',1.9988,80.0,0.0,2340.0,null,'{"fl_label":"FL.+80 / SL.±0","thk":"FLOOR THK 80"}','drawing_confirmed',null),
  ('거실/침실',16.2528,110.0,0.0,2300.0,null,'{"fl_label":"FL.+110 / SL.±0"}','drawing_confirmed',null),
  ('주방/식당',5.3426,110.0,0.0,2300.0,null,'{"fl_label":"FL.+110 / SL.±0","note":"4쪽 주기3 - 개수대하부·신발장 하부 패널히팅 제외, 씽크대 하부 적용"}','drawing_confirmed',null),
  ('욕실',3.3597,30.0,-150.0,2200.0,
   '[모순·미해소] 1쪽 평면 라벨 "FL.+30 / SL.-150" vs 1쪽 주기13 "욕실:SL-60(FL+20/+10)". 둘 다 도면 원문이며 도면만으로 판정 불가 - 평면 라벨 값을 실었다. 판정에 쓰려면 어느 쪽을 정본으로 할지 사용자 결정이 필요하다',
   '{"fl_label":"FL.+30 / SL.-150 (1쪽 평면)","note13":"욕실:SL-60(FL+20/+10)","baseboard":"BASEBOARD NO. 칸에 (none) 인쇄","slope":"1쪽 주기22 욕실 구배시공 1/100"}','drawing_confirmed',null),
  ('발코니',6.7500,35.0,0.0,null,
   '[모순·미해소] 1쪽 평면 라벨 "FL.+35" vs 1쪽 주기13 "발코니:FL+80(높은턱),+35(낮은턱)". 평면 라벨 값을 실었다',
   '{"fl_label":"FL.+35 / SL.±0","note13":"발코니:FL+80(높은턱),+35(낮은턱)","ceiling_height":"4쪽 공란","hazard":"1쪽 콘크리트턱(H=110)·(H=310) 표기"}','drawing_confirmed',null),
  ('실외기실',null,35.0,0.0,null,null,'{"fl_label":"FL.+35 / SL.±0","area":"3쪽 면적표 미표기","ceiling_height":"4쪽 공란"}',
   'inferred','[추론] 1쪽 평면의 FL 라벨 "FL.+35 / SL.±0" 하나만이 근거다. 3쪽 면적산출표에 항목이 없고 면적도에 면(face)도 없어 면적도 인접 접촉길이도 계산할 수 없었다. 도면으로 확정된 실 7개(거실/침실·주방/식당·욕실·현관·PD·발코니·벽체공용) 목록에 이 실은 포함되지 않는다'),
  ('복도',null,55.0,0.0,null,null,'{"fl_label":"복도 FL.+55/SL.±0","note":"4쪽 마감표에 행이 없어 마감 코드 미상"}',
   'inferred','[추론] 1쪽 평면에 FL 라벨 "복도 FL.+55/SL.±0"은 있으나 3쪽 면적산출표·면적도에 면(face)이 없어 면적도 인접 접촉길이도 계산할 수 없었다. 4쪽 마감표에도 행이 없어 마감 코드가 미상이다. 세대 외부(공용부)라 면적산출 대상이 아닌 것으로 보이나 도면이 그 사실을 명시하지 않는다'),
  -- ★ 3쪽 면적표의 나머지 두 항목. 마감표에 행이 없고 레벨 라벨도 없어 fl/sl는 NULL이다.
  --   면적표 값을 버리지 않는 이유: 거실/침실-발코니가 벽체공용을 사이에 두고 간접
  --   인접이라는 사실이 이 행 없이는 DB에 표현되지 않는다.
  ('PD',1.2096,null,null,null,null,'{"area":"3쪽 면적표 PD 1.2096","note":"4쪽 주기2 - PD,AD 내부 미장마감 없음. 레벨 라벨 없음","kind":"파이프덕트(설비 샤프트)"}','drawing_confirmed',null),
  ('벽체공용',3.3236,null,null,null,
   '[성격 주의] 3쪽 면적표 항목이지만 통행 가능한 실이 아니라 벽체가 차지하는 공용 면적이다. spaces에 둔 이유는 면적표 원문을 손실 없이 보존하고 거실/침실-발코니의 간접 인접을 표현하기 위함이며, 로봇 주행 판정 대상으로 삼으면 안 된다',
   '{"area":"3쪽 면적표 벽체공용 3.3236","note":"실이 아니라 벽체 점유 면적. 전용 26.9538 = 현관+거실/침실+주방/식당+욕실+벽체공용의 합계 항목이 3쪽에 따로 있다","level":"레벨 라벨 없음"}','drawing_confirmed',null)
 ) as v(name, area, fl, sl, ch, conflict, raw, basis, basis_note)
 join code_systems cs on cs.site_id is null and cs.code = 'lh-apt-unit-2025'
 join drawings d      on d.system_id = cs.id and d.doc_key = 'lh-26형-2025.10.22' and d.doc_no = 'AA-004'
on conflict (drawing_id, name) do nothing;

-- 10-7b) 실 폴리곤(outline) — 0단계 도면 기하 복원 산출물
--   출처: 3쪽 면적산출근거도(AA-003)의 **선 굵기 1.42pt 선분 25개**만 추출 → 축 정렬 스냅(3mm)
--         → mm 정수 반올림 → shapely.polygonize. 축척 1:40은 도면 내 치수(4500·8970mm)로 역산.
--   좌표계: 도면 로컬 mm, 원점은 4500x8970 외곽의 좌하단. 링 배열 [외곽, 구멍...], 닫는 점 없음.
--   ★ 이 값들은 정수 반올림된 뒤에도 3쪽 면적산출표와 0.0025 퍼센트 이내로 일치한다(015 A25가 대조).
--     그래서 area_m2(발주처 정본)를 덮어쓰지 않고, 둘이 어긋나면 회귀가 잡게 두었다.
--   ⚠ 실외기실·복도는 면적도에 면(face)이 없어 outline이 없다 — basis='inferred'와 같은 이유다.
update spaces sp set outline = v.rings::jsonb
  from (values
  ('거실/침실','[[[1860,5590],[1860,5355],[4400,5355],[4400,1670],[100,1670],[100,5520],[190,5520],[190,5590]]]'),
  ('주방/식당','[[[1860,7070],[1860,7825],[2910,7825],[2910,7200],[4400,7200],[4400,5355],[1860,5355],[1860,5590]]]'),
  ('욕실','[[[1260,7070],[1860,7070],[1860,5590],[190,5590],[190,7900],[1260,7900]]]'),
  ('현관','[[[1860,7070],[1260,7070],[1260,7900],[1330,7900],[1330,8800],[2910,8800],[2910,7825],[1860,7825]]]'),
  ('PD','[[[0,8970],[1260,8970],[1260,8010],[0,8010]]]'),
  ('발코니','[[[4500,1500],[4500,0],[0,0],[0,1500]]]'),
  ('벽체공용','[[[1260,8970],[3170,8970],[3170,7370],[4500,7370],[4500,1500],[0,1500],[0,8010],[1260,8010]],[[2910,8800],[1330,8800],[1330,7900],[1260,7900],[190,7900],[190,5590],[190,5520],[100,5520],[100,1670],[4400,1670],[4400,5355],[4400,7200],[2910,7200],[2910,7825]]]')
  ) as v(name, rings)
 where sp.name = v.name
   and sp.drawing_id = (select d.id from drawings d
                          join code_systems cs on cs.id = d.system_id
                         where cs.site_id is null and cs.code = 'lh-apt-unit-2025'
                           and d.doc_key = 'lh-26형-2025.10.22' and d.doc_no = 'AA-004');

-- 10-8) 실 × 부위 × 층 (코드 매핑 결과를 그대로 전개 — 중복 입력 없음)
insert into space_finishes (space_id, part_id, role, layer_no, material_id, project_code_id, thickness_mm, raw_text, confidence, source_text)
select sp.id, pc.part_id, l.role, l.layer_no, l.material_id, pc.id, l.thickness_mm, l.raw_text, l.confidence,
       'AA-004 실내재료마감표 - 실 × 부위 코드 매핑(project_code_layers 전개)'
 from (values
  ('현관','F-10B'),('현관','W-7,8,9'),('현관','B-7B'),('현관','C-6A'),
  ('거실/침실','F-11'),('거실/침실','W-7,8,9'),('거실/침실','B-9,10'),('거실/침실','C-6B'),
  ('주방/식당','F-11'),('주방/식당','W-14'),('주방/식당','B-9,10'),('주방/식당','C-6B'),
  ('욕실','F-12'),('욕실','W-12'),('욕실','C-8'),
  ('발코니','F-14'),('발코니','W-15'),('발코니','B-18'),('발코니','C-10'),
  ('실외기실','F-14'),('실외기실','W-15'),('실외기실','B-14'),('실외기실','C-10')
 ) as v(sname, pcode)
 join code_systems cs       on cs.site_id is null and cs.code = 'lh-apt-unit-2025'
 join project_codes pc      on pc.system_id = cs.id and pc.code_set = 'finish-schedule' and pc.code = v.pcode
 join project_code_layers l on l.project_code_id = pc.id
 join drawings d            on d.id = pc.drawing_id
 join spaces sp             on sp.drawing_id = d.id and sp.name = v.sname
on conflict (space_id, part_id, role, layer_no) do nothing;
-- ★ 이 INSERT는 복합 FK (material_id, part_id) → material_parts 를 통과해야 한다.
--   4)에서 mortar-cement/floor·wall·ceiling·baseboard, board-gypsum/wall·ceiling·baseboard,
--   wp-silk/wall·ceiling, paint-water-based/wall·ceiling·baseboard, panel-abs-bath/ceiling,
--   base-bmc·base-readymade/baseboard, frame-light-steel/ceiling 를 전부 넣었으므로 통과한다.
--   하나라도 빠지면 23503으로 **적재가 막힌다** — 이것이 이 설계가 원하는 동작이다.
-- ★ F-11의 base(패널히팅)는 material_id NULL이라 복합 FK 검사가 건너뛰어지고,
--   CHECK ((confidence='unmapped') = (material_id is null))가 unmapped를 강제한다.

-- 10-9) 인접 + 단차
-- ★★ C1: least/greatest(a.id, b.id) 를 걷어냈다. id가 gen_random_uuid()라 a/b 배치가
--   적재마다 뒤집혔고 step_mm(=b.FL−a.FL)의 부호가 따라 뒤집혔다. 실제 재현:
--     1회차  −75 거실/침실→발코니 | +25 복도→현관 | −30 주방/식당→현관
--     2회차  +75 발코니→거실/침실 | −25 현관→복도 | +30 현관→주방/식당
--   음수 단차는 lte 비교를 무조건 통과하므로 같은 파일이 적재 운에 따라 pass/fail을 오갔다.
--   → 이제 여기서는 VALUES에 적힌 순서 그대로 (a, b)와 step = b.FL − a.FL 을 넣고,
--     013의 fn_space_adjacency_normalize 트리거가 **실 이름** 순서로 정규화하면서
--     뒤집을 때 부호도 같이 뒤집는다. 이름은 적재마다 같으므로 결과가 결정적이다.
--     판정 입력은 생성 컬럼 step_abs_mm이고, "어느 쪽이 낮은가"는 lower_space_id에 남는다.
-- ★★ C6: basis가 '이 인접이 도면으로 확정된 것인가'를 가른다.
--   drawing_confirmed 6쌍 = 3쪽 면적도 폴리곤 접촉(100mm 이상)으로 컨트롤러가 직접 계산한 것.
--   inferred 2쌍 = 발코니-실외기실 / 현관-복도. 두 쌍 모두 상대 실의 면이 3쪽 면적도에 없어
--     접촉 자체를 계산할 수 없었다. basis_note에 무엇에 얹혀 있는지 행마다 남긴다.
--   질의: select label, basis, basis_note from space_adjacencies where basis='inferred';
--         select label, step_abs_mm, fl_disputed, touches_inferred_space from v_space_step;
--   ★ clear_width_mm는 전부 NULL: 유효 통과폭이 도면 어디에도 없다.
--     개구부 치수를 통과폭으로 대입하면 문틀·창짝 두께만큼 과대평가된다.
--     "왜 NULL인가"는 raw.clear_width_unknown_reason에 행마다 남긴다
--     (space_adjacencies에는 unknown_reason 컬럼이 없다).
--   ★★ 조인을 도면·코드체계로 못박는다. 이전 판은
--         join spaces a on a.name = v.an                      -- drawing_id 조건 없음
--         left join project_codes pc on pc.code_set=... and pc.code=v.wcode  -- system_id 없음
--       였다. spaces의 유니크는 (drawing_id, name)이라 SH 도면에도 '현관'·'거실/침실'이
--       존재할 수 있고, 그 상태에서 이 시드를 재실행하면 (a,b,kind,label) 조합이 새로우므로
--       on conflict를 타지 않고 SH 도면에 LH 원문 label·source_text를 가진 인접행이
--       생겼다. 동시에 SH 코드집에도 window-schedule 'SD'가 있으면 left join이 2행으로
--       늘어 어느 발주처 창호코드가 남는지가 비결정적이 된다. 이 저장소는 멱등 재실행이
--       전제이므로 이것은 곧바로 터지는 결함이다. 같은 파일의 10-8은 pc.drawing_id를 타고
--       내려가 이 문제가 없었다 — 10-9만 빠져 있었다.
--   ★ 인접 쌍과 접촉길이는 컨트롤러가 도면에서 직접 확인한 값이다(접촉길이 100mm 이상).
--     여기서 다시 계산하지 않는다. step_mm은 적재된 FL 라벨의 차이로 그대로 재현된다.
--   ★★ F5: clear_width_max_mm = 유효 통과폭의 **상한**. 도면에서 읽히는 수치(개구부 치수·
--     제작치수·문틀 내측)는 전부 이 칸에만 들어간다. 013 의 CHECK 가 "상한 없이 유효폭을
--     적을 수 없고, 적더라도 상한보다 작아야 한다"를 강제하므로 6쪽 창호일람표의
--     제작치수(DPW 1,990 / D-2 1,090 / SD 690)를 유효폭 칸에 그대로 넣는 경로가 닫힌다.
--     여기 싣는 3개 값은 문틀 내측 상한이다:
--       현관 D-2 ≤ 1,000 / 발코니-실외기실 SD ≤ 600 / 거실-발코니 미서기 짝당 ≤ 959.
--     통행 개구부가 없는 5행은 상한 자체가 정의되지 않아 NULL 이고, 그 결과 그 행들의
--     유효폭 칸은 구조적으로 영구히 잠긴다(그것이 옳다 - 통과폭이 정의되지 않는 경계다).
insert into space_adjacencies (space_a_id, space_b_id, kind, label, project_code_id,
                               clear_width_mm, clear_width_max_mm, step_mm, gap_width_mm, profile,
                               basis, basis_note, raw, source_text)
select a.id, b.id, v.kind::adjacency_kind, v.label, pc.id,
       null::double precision,
       v.cwmax,
       (b.fl_mm - a.fl_mm),
       null::double precision, null::threshold_profile,
       v.basis::evidence_basis, v.basis_note,
       jsonb_build_object('from', v.an, 'to', v.bn,
                          'opening_code', coalesce(v.wcode,''),
                          'contact_len_mm', v.contact,
                          'clear_width_unknown_reason', v.cwunk),
       v.src
 from (values
  ('거실/침실','주방/식당','open_boundary','거실-주방 개방 경계',null,2775.0,
   '개구부 없는 개방 경계라 창호코드가 없다. 유효 통과폭은 벽심이 아니라 마감면 간 거리여야 하는데 평면 치수체인에 그 값이 없다',
   'FL.+110 vs FL.+110 → 단차 0. 접촉길이 2,775mm로 이 세대에서 가장 긴 경계다. 문턱·전환선 상세가 없어 profile은 NULL',
   'drawing_confirmed',null::text,null::double precision),
  ('주방/식당','현관','open_boundary','주방-현관 마감 전환선',null,1805.0,
   '개구부 없는 마감 전환선이라 창호코드가 없다',
   'FL.+110 vs FL.+80 → 단차 30. 1쪽 상세 "C"에 마루귀틀(BMC)·시멘트모르타르·수평조절용 합판(THK9)이 있고 말풍선 좌표가 현관~주방 구간이나 실 귀속을 추정하지 않았다. 문턱 형상 미상이라 profile은 NULL',
   'drawing_confirmed',null,null),
  ('거실/침실','욕실','door','욕실문',null,1670.0,
   '★욕실 출입구는 6쪽 창호일람표에도 5쪽 평면 치수체인에도 없다(시스템욕실 제품에 문이 포함되어 별도 창호로 잡히지 않는다). 폭 자체가 미상이므로 개구부 치수를 대입할 수도 없다',
   'FL.+110 vs FL.+30 → 단차 80. 1쪽 상세 "E"(욕실/거실)에 PVC공틀·코킹 10x5·방수판·문틀하부 고정이 있으나 실 귀속 미확정. ★욕실 FL이 원문 모순이라 주기13 기준(FL+20/+10)이면 이 단차는 90~100mm가 된다. ★주기22 "욕실 구배시공(1/100)"이라 욕실 바닥은 평면이 아니며 문턱 부근 실측 단차는 구배분만큼 달라진다',
   'drawing_confirmed',null,null),
  ('주방/식당','욕실','level_change','주방-욕실 벽체 경계(단차)',null,1480.0,
   '통행 개구부가 없는 벽체 경계라 통과폭이 정의되지 않는다',
   'FL.+110 vs FL.+30 → 단차 80. 벽을 사이에 둔 인접이라 로봇 통행 경로는 아니지만, 바닥 구조·방수 경계가 만나는 지점이라 시공 단차 위험 지점으로 남긴다',
   'drawing_confirmed',null,null),
  ('욕실','현관','level_change','욕실-현관 벽체 경계(단차)',null,1430.0,
   '통행 개구부가 없는 벽체 경계라 통과폭이 정의되지 않는다',
   'FL.+30 vs FL.+80 → 단차 50. 동상',
   'drawing_confirmed',null,null),
  ('거실/침실','발코니','door','거실-발코니 미서기문','DPW',null::double precision,
   '★DPW 개구부 2,010 X 2,335는 개구부 치수이지 유효 통과폭이 아니다. 제작치수 1,990은 상한만 준다 - 미서기 이중문이라 실제 통과폭은 문짝 1매 폭에서 프레임을 뺀 값이며 도면에 없다',
   'FL.+110 vs FL.+35 → 단차 75. ★거실/침실과 발코니는 벽체공용을 사이에 두고 간접 인접이며 이 행은 DPW 개구부를 통한 통행 경로다. 1쪽 콘크리트턱(H=110) 표기가 있어 실제 문턱 단차는 이보다 클 수 있다. 문턱 형상 미상이라 profile은 NULL',
   'drawing_confirmed',null,959.0),
  ('발코니','실외기실','door','발코니-실외기실 철제여닫이문','SD',null,
   '★SD 개구부 710 X 2,110은 개구부 치수다. 정면도의 900은 지시 대상이 표기되지 않아 통과폭으로 단정할 수 없고, 제작치수 690은 상한이다',
   'FL.+35 vs FL.+35 → 단차 0. ★★ 이 0은 도면이 확정한 값이 아니다. (1) 실외기실 FL 라벨은 1쪽 평면 라벨 하나가 전부이고 3쪽 면적도에 면이 없어 접촉을 계산할 수 없었다. (2) 발코니 FL은 1쪽 주기13이 "발코니:FL+80(높은턱),+35(낮은턱)"으로 두 값을 주는데 여기서는 평면 라벨과 같은 낮은턱 +35를 골랐다. 높은턱 분기(FL+80)를 쓰면 단차는 45mm가 되고, 상업청소 drive(임계 10 / marginal 20)와 서빙(임계 5)에서 pass가 fail로 뒤집힌다',
   'inferred','[추론] 이 세대에서 통행 개구부를 가진 경계 중 유일하게 전 등급 pass가 나오는 행인데, 그 pass가 두 겹의 미확정 위에 서 있다: (a) 실외기실은 3쪽 면적산출표·면적도에 없어 컨트롤러가 검증한 실 7개·인접 6쌍 목록 어디에도 없다(시드가 추가한 쌍이다). (b) 단차 0은 발코니 FL 원문 모순(주기13 높은턱 80 / 낮은턱 35) 중 낮은턱을 임의로 고른 결과다. 높은턱을 고르면 45mm다. 판정에 쓸 때는 v_space_step.fl_disputed(=true)와 touches_inferred_space(=true)를 함께 읽어야 한다',600.0),
  ('현관','복도',    'door','현관 진입 철재여닫이문','D-2',null,
   '★D-2 개구부 1,120 X 2,240은 개구부 치수다. 정면도의 950은 지시 대상 미표기라 통과폭으로 단정할 수 없다. 제작치수 1,090은 상한이며 여닫이문이 90도 미만으로 열리면 실유효폭은 더 줄어든다',
   '현관 FL.+80 vs 복도 FL.+55 → 단차 25. 복도는 4쪽 마감표에 행이 없어 마감 코드가 미상이다. 세대 진입 개구부라 6쪽 창호일람표 D-2가 대응한다',
   'inferred','[추론] 복도는 1쪽 평면에 FL.+55 라벨만 있고 3쪽 면적도에 면이 없어 현관과의 접촉을 계산할 수 없었다. 컨트롤러가 도면에서 확정한 인접 6쌍 목록에 이 쌍은 없다. 단차 25는 두 FL 라벨의 산술차이지 실측·상세도 확인값이 아니다',1000.0)
 ) as v(an, bn, kind, label, wcode, contact, cwunk, src, basis, basis_note, cwmax)
 join code_systems cs on cs.site_id is null and cs.code = 'lh-apt-unit-2025'
 join drawings d      on d.system_id = cs.id and d.doc_key = 'lh-26형-2025.10.22' and d.doc_no = 'AA-004'
 join spaces a        on a.drawing_id = d.id and a.name = v.an
 join spaces b        on b.drawing_id = d.id and b.name = v.bn
 left join project_codes pc on pc.system_id = cs.id and pc.drawing_id = d.id
                           and pc.code_set = 'window-schedule' and pc.code = v.wcode
on conflict (space_a_id, space_b_id, kind, label) do nothing;

-- =============================================================================
-- 11) 검증 쿼리 (객체 존재가 아니라 본문/내용 확인형 — SUPABASE_SETUP.md:362-375 관례)
-- =============================================================================
-- (a) DB 트리 — 재료계열 2단이 실제로 조립되는지
--   select part_code, family_path, material_code, role from v_finish_taxonomy
--    order by part_order, family_path, material_code;
--
-- (b) 미매핑 목록 — 정확히 1건(패널히팅)
--   select pc.code, l.role, l.raw_text, l.note from project_code_layers l
--     join project_codes pc on pc.id = l.project_code_id where l.confidence = 'unmapped';
--
-- (c) 단차·통과폭 — clear_width_mm는 8행 모두 NULL이어야 하고, "왜 NULL인가"가
--     raw.clear_width_unknown_reason에 행마다 있어야 한다
--   select st.space_a_name, st.space_b_name, st.kind, st.step_mm, st.step_abs_mm,
--          st.clear_width_mm, a.raw ->> 'contact_len_mm' as contact_mm,
--          a.raw ->> 'opening_code' as opening,
--          a.raw ->> 'clear_width_unknown_reason' as why_null
--     from v_space_step st join space_adjacencies a on a.id = st.adjacency_id
--    order by st.step_abs_mm desc nulls last;
--   기대 8행(단차 절대값): 욕실-거실 80 / 욕실-주방 80 / 발코니-거실 75 / 욕실-현관 50 /
--         현관-주방 30 / 현관-복도 25 / 발코니-실외기실 0 / 주방-거실 0
--         clear_width_mm는 8행 전부 NULL, why_null은 8행 전부 NOT NULL
--
-- (d) ★"26형 세대에서 청소로봇(청소 모드)이 못 넘는 경계 전부" — 4테이블 + 임계값
--   select st.space_a_name, st.space_b_name, st.step_abs_mm, rt.value as limit_mm, rt.mode,
--          fn_eval_threshold(st.step_abs_mm, rt.comparator, rt.value, rt.marginal_value) as verdict,
--          rt.source_text
--     from v_space_step st
--     join robot_thresholds rt on true
--     join robot_classes rc on rc.id = rt.class_id  and rc.code = 'commercial-cleaner'
--     join robot_metrics rm on rm.id = rt.metric_id and rm.code = 'step_height_mm'
--    where rt.mode = 'clean'
--      and fn_eval_threshold(st.step_abs_mm, rt.comparator, rt.value, rt.marginal_value) <> 'pass';
--   기대 6행 전부 fail(임계 8mm, marginal 10mm):
--         욕실-주방 80 / 욕실-거실 80 / 발코니-거실 75 / 욕실-현관 50 / 현관-주방 30 / 현관-복도 25
--         단차 0인 2행(주방-거실, 발코니-실외기실)은 pass라 결과에서 빠진다
--   ※ mode='drive'로 바꾸면 임계 10mm(marginal 20)이며 같은 6건이 나온다
--     (25·30은 marginal 20도 넘어 fail).
--
-- (e) ★"자기질타일이 쓰인 실 전부" — 3테이블
--   select sp.name, sf.raw_text from space_finishes sf
--     join finish_materials m on m.id = sf.material_id and m.code = 'tile-vitreous'
--     join spaces sp on sp.id = sf.space_id;
--   기대: 욕실(F-12) / 발코니(F-14) / 실외기실(F-14) 3행
--
-- (f) 근거 없는 임계값 — 이 DB의 판정력 한계를 정직하게 드러낸다
--   select rc.code, rm.code, rt.mode, rt.unknown_reason from robot_thresholds rt
--     join robot_classes rc on rc.id = rt.class_id
--     join robot_metrics rm on rm.id = rt.metric_id
--    where rt.value is null order by rc.sort_order, rm.sort_order;
--   기대: 10행. 서빙로봇 기준 10지표 중 5지표(U턴·카펫·마찰·평탄도·승강기)가 판정 불가다.
--   ※ 이전 판은 9행이었다. turn_width_mm가 늘어난 이유는 U턴 칸에 들어 있던
--     "권장 경로폭 1,200"을 걷어내고 rec_path_width_mm로 옮겼기 때문이다.
--
-- (g) ★★ 기준세트 선정 규칙 준수 검사 — robot_rulesets.source_text가 선언한
--     "등급별 최보수 공표치"와 실제 값이 어긋나는지 본다. 주석은 판정에 관여하지 않으므로
--     이 검사가 없으면 선언과 값이 갈라져도 아무도 모른다.
--     robot_classes.specs(제조사 공표 사양 원본)에서 최보수를 뽑아 임계값과 대조한다.
--   with pub as (
--     select rc.code as class_code, m ->> 'name' as model,
--            (m ->> 'slope_deg')::float        as slope_any,
--            (m ->> 'slope_drive_deg')::float  as slope_drive,
--            (m ->> 'min_width_mm')::float     as min_width,
--            (m ->> 'uturn_mm')::float         as uturn
--       from robot_classes rc, jsonb_array_elements(rc.specs -> 'models') m)
--   select class_code,
--          min(coalesce(slope_drive, slope_any)) as 최보수_등판_drive,
--          max(min_width)                        as 최보수_통과폭,
--          max(uturn)                            as 최보수_U턴
--     from pub group by class_code;
--   기대(commercial-cleaner): 4.6 / 1400 / 2000 — 9절 drive 행의 value와 정확히 같아야 한다.
--   ※ 이전 판은 8.0 / 800 / 1100이었다. 셋 다 선언 위반이자 "위험한 쪽" 오류였다:
--     Scrubber 50(등판 4.6)이 못 오르는 6도 램프가 pass, Scrubber 75(통과폭 1,400)가
--     못 들어가는 900mm 통로가 pass로 찍혔다.
--
-- (h) evidence 채움 검사 — 값이 있는데 근거가 비어 있는 임계값은 머지하지 않는다
--   select count(*) as total,
--          count(*) filter (where evidence = '[]'::jsonb) as empty_evidence
--     from robot_thresholds;
--   기대: total 29 / empty_evidence 0. 등급 분포는
--     select rt.evidence -> 0 ->> 'grade', count(*) from robot_thresholds rt group by 1;
--     → A 23 / B 4 / C 2 (A=원문 직접 확인, B=2차 인용, C=미확인)
--
-- (i) ★ 물성에 요구 하한이 섞이지 않았는지 — 판정 입력의 정직성 검사
--   select count(*) filter (where num_value is not null) as measured_values,
--          count(*) filter (where unknown_reason is not null) as gaps
--     from material_properties;
--   기대: measured_values 0 / gaps 8. 이 DB에는 제품군 수준 실측 물성이 한 건도 없다는
--   것이 사실이며, 규격 요구 하한을 그 자리에 넣어 사실을 덮지 않는다.
--   판정이 실제로 unknown이 되는지도 같이 본다:
--     select fn_eval_threshold(mp.num_value,'gte',0.40,null) from material_properties mp
--       join finish_materials m on m.id=mp.material_id
--       join finish_properties p on p.id=mp.property_id
--      where m.code='tile-vitreous' and p.code='dcof';   → unknown (이전 판은 pass였다)
--
-- (j) ★ 부위 축·코드 종류의 탈출구가 실제로 쓰이는지 — "덮지 못한다는 사실을 숨기지 않는다"
--   select p.code as part, count(pc.id) from finish_parts p
--     left join project_codes pc on pc.part_id = p.id group by p.code, p.sort_order
--    order by p.sort_order;
--   기대: floor 4 / wall 11 / ceiling 4 / baseboard 4 / other 13
--   select kind, count(*) from project_codes group by kind order by kind;
--   기대: finish_set 23 / opening 5 / insulation 2 / waterproof 3 / other 3
--   ※ 이전 판은 other 0 / insulation 0 이었다 - 만들어 둔 탈출구가 비어 있어
--     도면 커버리지의 한계를 드러내는 게 아니라 오히려 감췄다.
--
-- (k) 멱등 재실행 — 이 파일을 두 번 돌려도 건수가 변하지 않아야 한다.
--   두 번째 발주처(SH) 도면을 같은 실 이름·같은 창호코드로 적재한 뒤 재실행해도
--   space_adjacencies는 8행 그대로이고 SH 도면에는 0행이어야 한다(10-9 조인 한정).

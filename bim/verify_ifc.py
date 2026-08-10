# verify_ifc.py — 생성한 IFC 를 **다시 읽어** 검증한다.
#   생성 스크립트의 변수를 믿지 않고 파일에서만 읽는다.
#   1) 스키마·엔티티 수  2) 기하를 실제로 삼각분할해 바닥 면적을 재계산 → 도면 면적표와 대조
#   3) Pset 이 원문 모순·미상 사유를 들고 있는가  4) 문 폭이 상한이지 제작치수가 아닌가
import os, sys, json, collections
import ifcopenshell, ifcopenshell.geom, ifcopenshell.util.element

HERE = os.path.dirname(os.path.abspath(__file__))
IFC = os.path.join(HERE, 'LH_26형_로봇친화도.ifc')
DRAWN = {'거실/침실': 16.2528, '주방/식당': 5.3426, '욕실': 3.3597, '현관': 1.9988,
         'PD': 1.2096, '발코니': 6.7500, '벽체공용': 3.3236}
# 6쪽 창호일람표 제작치수 — 이 값이 문 폭에 실려 있으면 결함이다(유효폭이 아니다)
MADE_WIDTH_MM = {1090.0, 1990.0, 690.0, 890.0}

fails = []
f = ifcopenshell.open(IFC)
print('스키마       :', f.schema)
cnt = collections.Counter(e.is_a() for e in f)
for k in ('IfcProject', 'IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace', 'IfcDoor',
          'IfcMaterial', 'IfcMaterialLayerSet', 'IfcExtrudedAreaSolid', 'IfcArbitraryProfileDefWithVoids'):
    print('  %-32s %d' % (k, cnt.get(k, 0)))

# 단위 확인
units = f.by_type('IfcUnitAssignment')[0].Units
lu = [u for u in units if getattr(u, 'UnitType', '') == 'LENGTHUNIT']
print('길이 단위    :', lu[0].Name if lu else '(없음)', getattr(lu[0], 'Prefix', None) if lu else '')
if not lu or lu[0].Name != 'METRE' or getattr(lu[0], 'Prefix', None):
    fails.append('길이 단위가 metre 가 아니다')

# ── 기하 재계산: 삼각분할 → 바닥면(z=min) 투영 면적 ────────────────────────────
settings = ifcopenshell.geom.settings()
print('\n실별 기하 검증 (IFC 삼각분할 → 바닥 투영 면적 vs 도면 면적표)')
print('  %-10s %12s %12s %10s  %s' % ('실', 'IFC기하', '도면표기', '오차', 'Qto NetFloorArea'))
for sp in sorted(f.by_type('IfcSpace'), key=lambda x: x.Name):
    name = sp.Name
    qto = None
    for rel in sp.IsDefinedBy or []:
        if rel.is_a('IfcRelDefinesByProperties'):
            pd = rel.RelatingPropertyDefinition
            if pd.is_a('IfcElementQuantity') and pd.Name == 'Qto_SpaceBaseQuantities':
                for q in pd.Quantities:
                    if q.Name == 'NetFloorArea':
                        qto = q.AreaValue
    if not sp.Representation:
        print('  %-10s %12s %12s %10s  %s' % (name, '(기하 없음)', '-', '-', qto if qto else '-'))
        continue
    shp = ifcopenshell.geom.create_shape(settings, sp)
    v = shp.geometry.verts
    fc = shp.geometry.faces
    zmin = min(v[2::3])
    area = 0.0
    for i in range(0, len(fc), 3):
        p = [(v[3 * fc[i + k]], v[3 * fc[i + k] + 1], v[3 * fc[i + k] + 2]) for k in range(3)]
        if max(abs(q[2] - zmin) for q in p) > 1e-6:
            continue     # 바닥면 삼각형만
        area += abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2
    drawn = DRAWN.get(name)
    err = (area - drawn) / drawn * 100 if drawn else None
    print('  %-10s %12.4f %12s %9s  %s'
          % (name, area, ('%.4f' % drawn) if drawn else '-',
             ('%+.4f%%' % err) if err is not None else '-', qto if qto else '-'))
    if drawn and abs(err) > 0.01:
        fails.append('%s 기하 면적이 도면 표기와 %.4f%% 어긋난다' % (name, err))
    if qto is not None and drawn and abs(qto - drawn) > 1e-6:
        fails.append('%s Qto NetFloorArea 가 도면 표기와 다르다' % name)

# ── Pset: 원문 모순·근거 표식 ────────────────────────────────────────────────
print('\n실별 Pset 표식')
need_conflict = {'욕실', '발코니'}
for sp in sorted(f.by_type('IfcSpace'), key=lambda x: x.Name):
    ps = ifcopenshell.util.element.get_psets(sp)
    lv = ps.get('Pset_LH_FinishLevel', {})
    rb = ps.get('Pset_RobotPassability_Space', {})
    print('  %-10s FL=%-6s SL=%-6s THK=%-6s 모순=%-5s 근거=%-18s 기하=%s 통행=%s'
          % (sp.Name, lv.get('FL_mm', ''), lv.get('SL_mm', ''), lv.get('Buildup_THK_mm', ''),
             lv.get('HasSourceConflict'), rb.get('EvidenceBasis', ''),
             rb.get('GeometryFromDrawing'), rb.get('IsTraversable')))
    if sp.Name in need_conflict and not lv.get('HasSourceConflict'):
        fails.append('%s 의 원문 모순 표식이 IFC 에 없다' % sp.Name)
    if sp.Name in ('복도', '실외기실') and rb.get('EvidenceBasis') != 'inferred':
        fails.append('%s 가 추론분으로 표시되지 않았다' % sp.Name)
    if lv.get('FL_mm') and lv.get('SL_mm'):
        thk = float(lv['FL_mm']) - float(lv['SL_mm'])
        if abs(thk - float(lv['Buildup_THK_mm'])) > 1e-6:
            fails.append('%s THK != FL-SL' % sp.Name)

# ── 문: 폭이 상한인가, 제작치수가 실렸는가 ─────────────────────────────────────
print('\n개구부')
for d in sorted(f.by_type('IfcDoor'), key=lambda x: x.Name):
    ps = ifcopenshell.util.element.get_psets(d).get('Pset_RobotPassability_Opening', {})
    w = d.OverallWidth
    print('  %-28s OverallWidth=%-8s 상한=%-7s 유효폭기지=%-5s 단차=%-6s 평가가능=%s'
          % (d.Name, ('%.3f' % w) if w else '(없음)', ps.get('ClearWidthUpperBound_mm', ''),
             ps.get('ClearWidthKnown'), ps.get('StepHeight_mm', ''), ps.get('StepEvaluable')))
    if w and round(w * 1000) in MADE_WIDTH_MM:
        fails.append('%s 의 OverallWidth 에 창호 제작치수가 실렸다 (유효폭이 아니다)' % d.Name)
    if ps.get('ClearWidthKnown'):
        fails.append('%s 가 유효 통과폭을 확정값으로 들고 있다 — 도면으로 확정 불가한 값이다' % d.Name)

# ── 재료 ─────────────────────────────────────────────────────────────────────
ls = f.by_type('IfcMaterialLayerSet')
cs = f.by_type('IfcMaterialConstituentSet')
# ★ LayerSet 은 층별 두께를 주장하는 구조다. 주장했다면 그 합이 구성 총두께와 같아야 한다.
#   같지 않은데 LayerSet 으로 냈다면 소비 측이 바닥 두께를 과소평가한다.
import ifcopenshell.util.element as _ue
for rel in f.by_type('IfcRelAssociatesMaterial'):
    if not rel.RelatingMaterial.is_a('IfcMaterialLayerSet'):
        continue
    tot = sum(l.LayerThickness for l in rel.RelatingMaterial.MaterialLayers) * 1000
    for o in rel.RelatedObjects:
        thk = _ue.get_psets(o).get('Pset_LH_FinishLevel', {}).get('Buildup_THK_mm', '')
        if thk and abs(float(thk) - tot) > 0.5:
            fails.append('%s: LayerSet 합 %.1fmm != 구성 총두께 %smm (두께를 주장하면 안 되는 자리)'
                         % (o.Name, tot, thk))
for x in cs:
    print('  [구성·두께 미주장] %-16s %s' % (x.Name, ' → '.join(c.Material.Name for c in x.MaterialConstituents)))
print('\n바닥 구성 (IfcMaterialLayerSet %d)' % len(ls))
for x in ls:
    tot = sum(l.LayerThickness for l in x.MaterialLayers) * 1000
    print('  %-22s %s  = %.1fmm' % (x.LayerSetName,
          ' + '.join('%s %.0f' % (l.Material.Name, l.LayerThickness * 1000) for l in x.MaterialLayers), tot))

print('\n' + ('실패 %d건:\n  - ' % len(fails)) + '\n  - '.join(fails) if fails else '\n검증 통과 — 실패 0건')
sys.exit(1 if fails else 0)

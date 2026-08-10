# to_ifc.py — 마감재 DB(dump.json) → IFC4.
#
# 원칙: 도면에 없는 값을 지어내지 않는다.
#   - 면적은 발주처 면적표 값(area_m2)을 Qto 에 싣는다. 폴리곤에서 재계산하지 않는다.
#   - 천장고가 도면에 없으면 명목 높이로 돌출하되 Pset 에 '명목'이라고 적는다.
#   - 유효 통과폭은 확정 불가다. IfcDoor.OverallWidth 에는 **문틀 내측 상한**을 싣고
#     Pset 에 ClearWidthKnown=false 와 상한의 출처를 적는다.
#   - 원문 모순(욕실·발코니 레벨)은 해소하지 않고 Pset 에 양쪽을 남긴다.
import json, os, sys, uuid
import ifcopenshell
import ifcopenshell.api.root, ifcopenshell.api.unit, ifcopenshell.api.context
import ifcopenshell.api.aggregate, ifcopenshell.api.spatial, ifcopenshell.api.geometry
import ifcopenshell.api.material, ifcopenshell.api.pset

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, 'dump.json'), encoding='utf-8'))
OUT = os.path.join(HERE, 'LH_26형_로봇친화도.ifc')

NOMINAL_H_MM = 2400.0   # 천장고 미기재 실의 돌출 높이. 명목값이며 Pset 에 그렇게 적는다.

f = ifcopenshell.file(schema='IFC4')
ifcopenshell.api.root.create_entity(f, ifc_class='IfcProject', name='LH 공동주택 주력평면 26형 - 로봇친화도 평가')
ifcopenshell.api.unit.assign_unit(f)
# ★ assign_unit 의 기본값은 길이 MILLI-METRE 인데 면적은 SQUARE_METRE 다 — 서로 어긋난다.
#   이 파일의 좌표는 metre 로 쓰므로 길이 단위의 MILLI 접두를 떼어 셋을 일치시킨다.
#   (검증기가 이것을 잡았다: 접두가 남으면 면적이 10^6 배 어긋나 -99.9999% 로 나온다)
for _u in f.by_type('IfcUnitAssignment')[0].Units:
    if _u.is_a('IfcSIUnit') and _u.UnitType == 'LENGTHUNIT' and _u.Prefix:
        _u.Prefix = None
ctx = ifcopenshell.api.context.add_context(f, context_type='Model')
body = ifcopenshell.api.context.add_context(
    f, context_type='Model', context_identifier='Body', target_view='MODEL_VIEW', parent=ctx)

project = f.by_type('IfcProject')[0]
site = ifcopenshell.api.root.create_entity(f, ifc_class='IfcSite', name='대지')
bldg = ifcopenshell.api.root.create_entity(f, ifc_class='IfcBuilding', name='LH 공동주택')
storey = ifcopenshell.api.root.create_entity(f, ifc_class='IfcBuildingStorey', name='기준층 (SL±0)')
ifcopenshell.api.aggregate.assign_object(f, products=[site], relating_object=project)
ifcopenshell.api.aggregate.assign_object(f, products=[bldg], relating_object=site)
ifcopenshell.api.aggregate.assign_object(f, products=[storey], relating_object=bldg)


def pt(x_mm, y_mm):
    return f.create_entity('IfcCartesianPoint', Coordinates=(float(x_mm) / 1000.0, float(y_mm) / 1000.0))


def polyline(ring):
    pts = [pt(x, y) for x, y in ring]
    return f.create_entity('IfcPolyline', Points=pts + [pts[0]])


def profile(rings):
    outer = polyline(rings[0])
    if len(rings) == 1:
        return f.create_entity('IfcArbitraryClosedProfileDef', ProfileType='AREA', OuterCurve=outer)
    return f.create_entity('IfcArbitraryProfileDefWithVoids', ProfileType='AREA', OuterCurve=outer,
                           InnerCurves=[polyline(r) for r in rings[1:]])


def placement(z_mm=0.0):
    loc = f.create_entity('IfcCartesianPoint', Coordinates=(0.0, 0.0, float(z_mm) / 1000.0))
    a3 = f.create_entity('IfcAxis2Placement3D', Location=loc)
    return f.create_entity('IfcLocalPlacement', RelativePlacement=a3)


def extrude(rings, height_mm):
    origin = f.create_entity('IfcCartesianPoint', Coordinates=(0.0, 0.0, 0.0))
    pos = f.create_entity('IfcAxis2Placement3D', Location=origin)
    solid = f.create_entity('IfcExtrudedAreaSolid', SweptArea=profile(rings), Position=pos,
                            ExtrudedDirection=f.create_entity('IfcDirection', DirectionRatios=(0.0, 0.0, 1.0)),
                            Depth=float(height_mm) / 1000.0)
    shape = f.create_entity('IfcShapeRepresentation', ContextOfItems=body, RepresentationIdentifier='Body',
                            RepresentationType='SweptSolid', Items=[solid])
    return f.create_entity('IfcProductDefinitionShape', Representations=[shape])


def s(v):
    return '' if v is None else str(v)


# ─── 마감재 → IfcMaterial (중복 없이) ─────────────────────────────────────────
mats = {}
def material(name, family, ks):
    if name not in mats:
        m = ifcopenshell.api.material.add_material(f, name=name, category=family or None)
        if ks:
            ifcopenshell.api.pset.add_pset(f, product=m, name='Pset_MaterialCommon')
        mats[name] = m
    return mats[name]


# ─── 실 ───────────────────────────────────────────────────────────────────────
space_by_name, made, skipped = {}, [], []
NON_TRAVERSABLE = {'벽체공용', 'PD'}

for sp in sorted(D['spaces'], key=lambda x: x['name']):
    name = sp['name']
    rings = sp['outline']
    fl = sp['fl_mm']
    ch = sp['ceiling_height_mm']
    h = ch if ch else NOMINAL_H_MM

    space = ifcopenshell.api.root.create_entity(f, ifc_class='IfcSpace', name=name)
    space.LongName = name
    space.CompositionType = 'ELEMENT'
    space.PredefinedType = 'INTERNAL' if name not in ('발코니', '실외기실') else 'EXTERNAL'
    # IfcSpace 는 IFC4 에서 공간구조 요소다 — 층에 '담기는' 것이 아니라 '집계'된다.
    ifcopenshell.api.aggregate.assign_object(f, products=[space], relating_object=storey)
    space.ObjectPlacement = placement(fl or 0.0)
    if rings:
        space.Representation = extrude(rings, h)
        made.append(name)
    else:
        skipped.append(name)
    space_by_name[name] = space

    # 발주처 정본 수량 — 폴리곤에서 재계산하지 않는다
    if sp['area_m2'] is not None:
        ifcopenshell.api.pset.add_qto(f, product=space, name='Qto_SpaceBaseQuantities')
        q = [x for x in space.IsDefinedBy if x.is_a('IfcRelDefinesByProperties')
             and x.RelatingPropertyDefinition.is_a('IfcElementQuantity')
             and x.RelatingPropertyDefinition.Name == 'Qto_SpaceBaseQuantities'][-1].RelatingPropertyDefinition
        q.Quantities = [
            f.create_entity('IfcQuantityArea', Name='NetFloorArea', AreaValue=float(sp['area_m2']),
                            Description='3쪽 면적산출표 인쇄값(발주처 정본). outline 에서 계산한 값이 아니다'),
            f.create_entity('IfcQuantityLength', Name='Height', LengthValue=float(h) / 1000.0,
                            Description=('4쪽 CEILING HEIGHT' if ch else '도면 미기재 - 명목값 %.0fmm' % NOMINAL_H_MM)),
        ]

    ifcopenshell.api.pset.add_pset(f, product=space, name='Pset_LH_FinishLevel')
    ifcopenshell.api.pset.edit_pset(f, pset=space.IsDefinedBy[-1].RelatingPropertyDefinition, properties={
        'FL_mm': s(fl), 'SL_mm': s(sp['sl_mm']),
        'Buildup_THK_mm': s(None if fl is None or sp['sl_mm'] is None else fl - sp['sl_mm']),
        'CeilingHeight_mm': s(ch) if ch else '도면 미기재',
        'HeightIsNominal': ch is None,
        'LevelSource': '1쪽 부분상세도 FL/SL 라벨 (4쪽 마감표 THK 와 FL-SL=THK 로 교차검증)',
        'ConflictNote': s(sp['conflict_note']),
        'HasSourceConflict': bool(sp['conflict_note']),
    })

    ifcopenshell.api.pset.add_pset(f, product=space, name='Pset_RobotPassability_Space')
    ifcopenshell.api.pset.edit_pset(f, pset=space.IsDefinedBy[-1].RelatingPropertyDefinition, properties={
        'EvidenceBasis': sp['basis'],
        'BasisNote': s(sp['basis_note']),
        'GeometryFromDrawing': bool(rings),
        'IsTraversable': name not in NON_TRAVERSABLE,
        'NonTraversableReason': ('통행 가능한 실이 아니다 - 벽체 점유 면적 / 설비 샤프트'
                                if name in NON_TRAVERSABLE else ''),
    })

    # 바닥 마감 구성 → IfcMaterialLayerSet (base → finish 순서)
    floor = sorted([x for x in (sp['finishes'] or []) if x['part'] == '바닥'],
                   key=lambda x: (0 if x['role'] == 'base' else 1, x['layer_no']))
    if floor:
        # ★ IfcMaterialLayerSet 은 층별 두께를 **주장**하는 구조다. 마감표는 구성 총두께(THK)만
        #   주고 층별 두께는 일부만 준다(예: 욕실 "THK60 수평조절 모르타르"). 모르는 두께를
        #   자리표시 값으로 채우면 소비 측이 바닥 구성을 2mm 로 읽는다 — 실제로 그렇게 나왔다.
        #   → 층별 두께가 전부 있을 때만 LayerSet 을 쓰고, 아니면 두께를 주장하지 않는
        #     IfcMaterialConstituentSet 으로 낸다(순서 정보는 Name 에 보존). 총두께는
        #     Pset_LH_FinishLevel.Buildup_THK_mm 이 이미 들고 있다.
        #   ★ 불변식: 층별 두께가 전부 있고 **그 합이 구성 총두께(FL-SL)와 같을 때만** LayerSet.
        #     거실/침실이 실례다 — 매핑된 바닥층은 기능성륨 6mm 하나뿐인데 구성 총두께는 110mm 다
        #     (BASE ' 패널히팅'은 마감재가 아니라 미매핑이라 층으로 들어오지 않는다).
        #     합이 총두께에 못 미치는데 LayerSet 을 내면 소비 측이 바닥을 6mm 로 읽는다.
        thk_total = None if (fl is None or sp['sl_mm'] is None) else (fl - sp['sl_mm'])
        complete = (all(x['thickness_mm'] for x in floor)
                    and (thk_total is None
                         or abs(sum(x['thickness_mm'] for x in floor) - thk_total) < 0.5))
        if complete:
            layers = [f.create_entity(
                'IfcMaterialLayer', Material=material(x['material'], x['family'], x['ks']),
                LayerThickness=float(x['thickness_mm']) / 1000.0, Name=x['material'],
                Description='%s / %s / 매핑 %s' % (x['role'], s(x['code']), x['confidence']))
                for x in floor]
            rel_mat = f.create_entity('IfcMaterialLayerSet', MaterialLayers=layers,
                                      LayerSetName='%s 바닥 구성 (층별 두께 확정)' % name)
        else:
            cons = [f.create_entity(
                'IfcMaterialConstituent', Name='%d.%s' % (i + 1, x['role']),
                Material=material(x['material'], x['family'], x['ks']), Category=x['part'],
                Description='%s / 매핑 %s / 두께 %s' % (
                    s(x['code']), x['confidence'],
                    ('%.0fmm' % x['thickness_mm']) if x['thickness_mm'] else '도면 미기재'))
                for i, x in enumerate(floor)]
            rel_mat = f.create_entity(
                'IfcMaterialConstituentSet', MaterialConstituents=cons,
                Name='%s 바닥 구성' % name,
                Description='층별 두께가 도면에 전부 있지는 않아 LayerSet 으로 내지 않는다. '
                            '구성 총두께는 Pset_LH_FinishLevel.Buildup_THK_mm 참조. 이름의 숫자가 base→finish 순서다')
        f.create_entity('IfcRelAssociatesMaterial',
                        GlobalId=ifcopenshell.guid.new(), Name='바닥 마감',
                        RelatedObjects=[space], RelatingMaterial=rel_mat)
    # 벽·천장·걸레받이는 단일 연결
    for part in ('벽', '천장', '걸레받이'):
        items = [x for x in (sp['finishes'] or []) if x['part'] == part and x['role'] == 'finish']
        if not items:
            continue
        ms = [material(x['material'], x['family'], x['ks']) for x in items]
        rel = f.create_entity('IfcMaterialList', Materials=ms) if len(ms) > 1 else ms[0]
        f.create_entity('IfcRelAssociatesMaterial', GlobalId=ifcopenshell.guid.new(), Name='%s 마감' % part,
                        RelatedObjects=[space], RelatingMaterial=rel)


# ─── 개구부 → IfcDoor ─────────────────────────────────────────────────────────
stepv = {x['label']: x for x in D['step_view']}
doors = 0
for adj in D['adjacencies']:
    if adj['kind'] not in ('door', 'opening'):
        continue
    sv = stepv.get(adj['label'], {})
    a = space_by_name.get(adj['a'])
    z = 0.0
    for cand in (adj['a'], adj['b']):
        for sp in D['spaces']:
            if sp['name'] == cand and sp['fl_mm'] is not None:
                z = min(z, sp['fl_mm']) if z else sp['fl_mm']
    door = ifcopenshell.api.root.create_entity(f, ifc_class='IfcDoor', name=adj['label'])
    door.PredefinedType = 'DOOR'
    door.ObjectPlacement = placement(z)
    # ★ OverallWidth 는 문틀 내측 상한이다. 유효 통과폭이 아니다.
    if adj['clear_width_max_mm']:
        door.OverallWidth = float(adj['clear_width_max_mm']) / 1000.0
    ifcopenshell.api.spatial.assign_container(f, products=[door], relating_structure=storey)

    ifcopenshell.api.pset.add_pset(f, product=door, name='Pset_RobotPassability_Opening')
    ifcopenshell.api.pset.edit_pset(f, pset=door.IsDefinedBy[-1].RelatingPropertyDefinition, properties={
        'SpaceA': adj['a'], 'SpaceB': adj['b'],
        'StepHeight_mm': s(sv.get('step_abs_mm')),
        'StepHeightRaw_mm': s(sv.get('step_abs_raw_mm')),
        'StepEvaluable': sv.get('step_abs_mm') is not None,
        'StepUnevaluableReason': s(sv.get('unevaluable')),
        'LowerSpace': s(sv.get('lower')),
        'LevelDisputed': bool(sv.get('fl_disputed')),
        'ClearWidthKnown': adj['clear_width_mm'] is not None,
        'ClearWidth_mm': s(adj['clear_width_mm']),
        'ClearWidthUpperBound_mm': s(adj['clear_width_max_mm']),
        'ClearWidthNote': ('OverallWidth 는 문틀 내측 상한이다(제작치수 - 틀 노출폭×2). '
                           '실제 유효 통과폭은 문짝 두께·개방각이 없어 도면으로 확정되지 않는다'),
        'ThresholdProfile': s(adj['profile']) or '도면 미기재',
        'WindowScheduleCode': s(adj['code']),
        'EvidenceBasis': adj['basis'],
        'BasisNote': s(adj['basis_note']),
    })
    doors += 1

f.write(OUT)
size = os.path.getsize(OUT)
print('작성: %s  (%.1f KB)' % (os.path.basename(OUT), size / 1024))
print('  IfcSpace %d (기하 있음 %d: %s / 기하 없음 %d: %s)'
      % (len(space_by_name), len(made), ', '.join(made), len(skipped), ', '.join(skipped)))
print('  IfcDoor %d · IfcMaterial %d' % (doors, len(mats)))

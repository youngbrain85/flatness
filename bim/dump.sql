-- dump.sql — IFC 내보내기에 필요한 것만 DB 에서 JSON 한 덩어리로 뽑는다.
\pset format unaligned
\pset tuples_only on
select jsonb_pretty(jsonb_build_object(
  'drawing', (select jsonb_build_object('doc_no', d.doc_no, 'doc_key', d.doc_key,
                                        'title', d.title, 'issuer', cs.issuer, 'system', cs.code)
                from drawings d join code_systems cs on cs.id = d.system_id limit 1),
  'spaces', (select jsonb_agg(jsonb_build_object(
                'name', sp.name, 'outline', sp.outline, 'area_m2', sp.area_m2,
                'fl_mm', sp.fl_mm, 'sl_mm', sp.sl_mm, 'ceiling_height_mm', sp.ceiling_height_mm,
                'basis', sp.basis, 'basis_note', sp.basis_note, 'conflict_note', sp.conflict_note,
                'raw', sp.raw,
                'finishes', (select jsonb_agg(jsonb_build_object(
                      'part', fp.name_ko, 'role', sf.role, 'layer_no', sf.layer_no,
                      'material', fm.name_ko, 'family', mf.name_ko,
                      'thickness_mm', sf.thickness_mm, 'confidence', sf.confidence,
                      'code', pc.code, 'ks', fm.ks_codes)
                    order by fp.name_ko, sf.role, sf.layer_no)
                   from space_finishes sf
                   join finish_parts fp on fp.id = sf.part_id
                   join finish_materials fm on fm.id = sf.material_id
                   join material_families mf on mf.id = fm.family_id
                   left join project_codes pc on pc.id = sf.project_code_id
                  where sf.space_id = sp.id))
              order by sp.name)
              from spaces sp),
  'adjacencies', (select jsonb_agg(jsonb_build_object(
                'a', sa.name, 'b', sb.name, 'kind', x.kind, 'label', x.label,
                'step_mm', x.step_mm, 'lower', lo.name,
                'clear_width_mm', x.clear_width_mm, 'clear_width_max_mm', x.clear_width_max_mm,
                'gap_width_mm', x.gap_width_mm, 'profile', x.profile,
                'basis', x.basis, 'basis_note', x.basis_note,
                'code', pc.code, 'raw', x.raw)
              order by sa.name, sb.name)
              from space_adjacencies x
              join spaces sa on sa.id = x.space_a_id
              join spaces sb on sb.id = x.space_b_id
              left join spaces lo on lo.id = x.lower_space_id
              left join project_codes pc on pc.id = x.project_code_id),
  'step_view', (select jsonb_agg(jsonb_build_object(
                'label', v.label, 'step_abs_mm', v.step_abs_mm,
                'step_abs_raw_mm', v.step_abs_raw_mm, 'lower', v.lower_space_name,
                'unevaluable', v.step_unevaluable_reason, 'fl_disputed', v.fl_disputed)
              order by v.label) from v_space_step v),
  'robot_classes', (select jsonb_agg(jsonb_build_object(
                'code', rc.code, 'name', rc.name_ko, 'default_mode', rc.default_mode,
                'width', rc.ref_width_mm, 'length', rc.ref_length_mm, 'height', rc.ref_height_mm,
                'specs', rc.specs) order by rc.code) from robot_classes rc),
  'thresholds', (select jsonb_agg(jsonb_build_object(
                'class', rc.code, 'metric', rm.code, 'unit', rt.unit, 'mode', rt.mode,
                'comparator', rt.comparator, 'value', rt.value, 'marginal', rt.marginal_value,
                'profile', rt.applies_profile, 'source', rt.source_text,
                'unknown_reason', rt.unknown_reason)
              order by rc.code, rm.code, rt.mode)
              from robot_thresholds rt
              join robot_classes rc on rc.id = rt.class_id
              join robot_metrics rm on rm.id = rt.metric_id),
  'ruleset', (select jsonb_build_object('code', rr.code, 'name', rr.name_ko,
                'source', rr.source_text, 'version', rr.version)
                from robot_rulesets rr where rr.is_default limit 1)
));

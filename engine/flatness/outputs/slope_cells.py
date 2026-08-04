"""slope_cells.json 왕복 직렬화 — 재판정(§7.3)과 화면 히트맵 재구성이 함께 소비하는
무손실 셀 산출물.

CSV(slope_cells.csv)가 아니라 이 파일을 재판정 입력으로 쓰는 이유는 브리프 D1의
실측 때문이다:
  - CSV에는 width_m/height_m 열이 없어 명목 cell_m으로 복원하면 correction_mm이
    가장자리 셀에서 정확히 2배로 나온다(실측 0.87 -> 1.74mm)
  - 조각 셀의 판정불가 사유가 뒤바뀐다("격자 가장자리 조각 셀" -> "유효 서브셀 부족")
  - CSV의 반올림(소수 3자리·각도 1자리)이 판정 경계에 걸터앉은 바닥의 등급을
    뒤집는다(20개 중 11개, 실측)

그래서 SlopeCell 12필드(+zone_id) 전부를 반올림 없이 그대로 담는다. 판정 결과
(grade·dev_pct·correction_mm·dir_err_deg·reason)는 담지 않는다 - 재판정 때
grade_slope_cells가 다시 계산하는 파생값이고, 같이 담으면 CSV와 이중 진실이 된다.

선례: 평활도가 cells.json을 별도로 내고(outputs/stats.py) 대시보드가 fetch한다.
같은 파일을 재판정 잡과 화면이 함께 소비하면 히트맵 재구성과 재판정 입력이
한 파일로 해결된다.
"""
import json
import math
from dataclasses import fields

from flatness.core.slope import SlopeCell

# 파일 구조(필드 구성)가 바뀔 때만 올린다. 지금은 SlopeCell 12필드 + zone_id 하나뿐이다.
SCHEMA_VERSION = 1

# not ok인 셀에서 nan이 나오는 필드. compute_slope_cells가 판정 불가 셀에
# float("nan")을 채우는 바로 그 네 필드다(slope.py 참고).
_NAN_FIELDS = ("slope_pct", "downhill_rad", "rmse_m", "se_pct")

_FIELD_NAMES = tuple(f.name for f in fields(SlopeCell))


def _cell_to_row(c):
    """SlopeCell -> JSON에 쓸 dict. nan은 null로 바꾼다.

    이 저장소 관례가 json.dump(allow_nan=False)다(pipeline.py) - RFC 8259
    표준 JSON에는 NaN 토큰이 없어 브라우저 JSON.parse·Postgres jsonb가 조용히
    거부하기 때문이다. 여기서도 같은 관례를 따른다.
    """
    row = {}
    for name in _FIELD_NAMES:
        v = getattr(c, name)
        if name in _NAN_FIELDS and isinstance(v, float) and math.isnan(v):
            row[name] = None
        else:
            row[name] = v
    return row


def _row_to_cell(row):
    """JSON dict -> SlopeCell. null이던 nan 필드를 float('nan')으로 되돌린다."""
    kwargs = dict(row)
    for name in _NAN_FIELDS:
        if kwargs.get(name) is None:
            kwargs[name] = float("nan")
    return SlopeCell(**kwargs)


def dump_slope_cells(cells, path, engine_version):
    """SlopeCell 리스트를 무손실 JSON으로 쓴다.

    engine_version은 compute_slope_cells를 낸 엔진 빌드를 기록한다. 재판정
    (judge_slope_cells)이 이 값을 검사하지는 않는다 - 판정 로직(grade_slope_cells)만
    다시 돌리는 것이므로 SlopeCell 12필드의 의미가 그대로인 한 엔진 버전이 달라도
    무방하다. 다만 schema_version이 바뀌면(필드 구성 변경) 로더가 거부해야 한다 -
    지금은 1 하나뿐이라 그 분기는 아직 없다.
    """
    payload = {
        "schema_version": SCHEMA_VERSION,
        "engine_version": engine_version,
        "cells": [_cell_to_row(c) for c in cells],
    }
    with open(path, "w", encoding="utf-8") as f:
        # allow_nan=False: _cell_to_row에서 이미 nan을 null로 치환했다. 그런데도
        # nan이 남아 있다면(치환 누락 등 버그) 조용히 NaN 토큰을 내보내느니 여기서
        # 바로 예외로 터뜨리는 편이 낫다(pipeline.py와 동일한 관례).
        json.dump(payload, f, ensure_ascii=False, indent=2, allow_nan=False)
    return path


def load_slope_cells(path):
    """slope_cells.json -> SlopeCell 리스트. dump_slope_cells의 역함수다."""
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    return [_row_to_cell(row) for row in payload["cells"]]

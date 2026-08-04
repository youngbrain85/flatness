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

**cell_m/subcell_m도 함께 담는다(Task 1 리뷰 I1).** grade_slope_cells의 조각 셀
분기(`width_m < cell_m/2`)가 cell_m에 의존하는데, 재판정 호출부가 원 분석과 다른
cell_m을 쓰면 CSV 근사 복원과 똑같은 결함(D1이 배제하려던 바로 그것)이 JSON
경로에서 재현된다. cell_m을 파일에 함께 실어 두면 재판정이 이 값을 그대로
읽어 쓸 수 있다 - "기본값을 조용히 쓰다 잊는" 경로를 근본적으로 없앤다.

선례: 평활도가 cells.json을 별도로 내고(outputs/stats.py) 대시보드가 fetch한다.
같은 파일을 재판정 잡과 화면이 함께 소비하면 히트맵 재구성과 재판정 입력이
한 파일로 해결된다.
"""
import json
import math
from dataclasses import fields

from flatness.core.slope import SlopeCell

# 파일 구조(필드 구성)가 바뀔 때만 올린다. 2 -> cell_m/subcell_m 최상위 키 추가
# (Task 1 리뷰 I1). 이 워크트리 안에서만 존재하던 산출물이라 과거 버전과의
# 하위 호환은 고려하지 않는다(실제 배포 전이므로 기존 파일이 없다).
SCHEMA_VERSION = 2

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


def dump_slope_cells(cells, path, engine_version, cell_m, subcell_m):
    """SlopeCell 리스트 + 원 분석의 격자 파라미터를 무손실 JSON으로 쓴다.

    cell_m/subcell_m은 기본값을 두지 않고 필수 인자로 받는다 - analyze_slope가
    이미 알고 있는 값을 그대로 넘기게 강제해, 나중에 이 호출부를 고치다 값을
    빠뜨리는 실수를 호출 시점에 바로 TypeError로 드러내기 위해서다(Task 1
    리뷰 I1: 기본값이 있으면 재판정이 조용히 다른 cell_m으로 돈다).

    engine_version은 compute_slope_cells를 낸 엔진 빌드를 기록한다. 재판정
    (judge_slope_cells)이 이 값을 검사하지는 않는다 - 판정 로직(grade_slope_cells)
    자체가 버전 사이에 안정적이라는 전제 위에서, SlopeCell 12필드의 의미가
    그대로인 한 엔진 버전이 달라도 무방하다고 본다.

    한계(Task 1 리뷰 I3): 이 전제가 깨지면(즉 grade_slope_cells의 판정 로직
    자체가 엔진 버전 사이에 바뀌면) 재판정이 원 분석 발행 시점과 다른 결과를
    조용히 낼 수 있다. 지금은 그 로직 변경을 감지·차단하는 장치가 없다 - 버전
    간 판정 로직 마이그레이션 정책은 이 태스크 범위 밖의 후속 과제다. 이 한계는
    load_slope_cells가 돌려주는 meta에도 engine_version이 실려 있어(호출부가
    필요하면) 확인할 수 있게만 해 둔다.
    """
    payload = {
        "schema_version": SCHEMA_VERSION,
        "engine_version": engine_version,
        "cell_m": cell_m,
        "subcell_m": subcell_m,
        "cells": [_cell_to_row(c) for c in cells],
    }
    with open(path, "w", encoding="utf-8") as f:
        # allow_nan=False: _cell_to_row에서 이미 nan을 null로 치환했다. 그런데도
        # nan이 남아 있다면(치환 누락 등 버그) 조용히 NaN 토큰을 내보내느니 여기서
        # 바로 예외로 터뜨리는 편이 낫다(pipeline.py와 동일한 관례).
        json.dump(payload, f, ensure_ascii=False, indent=2, allow_nan=False)
    return path


def load_slope_cells(path):
    """slope_cells.json -> (cells, meta). dump_slope_cells의 역함수다.

    meta = {"schema_version", "engine_version", "cell_m", "subcell_m"}.
    cells만 필요해서 meta를 버리면(list[SlopeCell]만 받던 이전 인터페이스)
    호출부가 cell_m을 다시 기본값으로 채워 넣기 쉽다 - 그게 바로 Task 1 리뷰
    I1이 지적한 결함이다. 그래서 항상 튜플로 묶어 반환해, 재판정 호출부가
    `cells, meta = load_slope_cells(path)` 다음 `judge_slope_cells(cells, ...,
    meta["cell_m"], subcell_m=meta["subcell_m"])`처럼 원 분석의 격자 파라미터를
    그대로 이어 쓰도록 유도한다.

    engine_version의 한계(버전 간 grade_slope_cells 변경은 감지하지 못함)는
    dump_slope_cells 독스트링 참고 - 여기서 meta로 노출하는 것으로 그 판단을
    호출부(judge_slope_cells 포함)에서도 볼 수 있게 한다.
    """
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    cells = [_row_to_cell(row) for row in payload["cells"]]
    meta = {
        "schema_version": payload["schema_version"],
        "engine_version": payload["engine_version"],
        "cell_m": payload["cell_m"],
        "subcell_m": payload["subcell_m"],
    }
    return cells, meta

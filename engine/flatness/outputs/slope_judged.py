"""slope_judged.json — 셀별 판정 결과(grade_slope_cells 반환) 전용 산출물.

D1이 slope_cells.json에서 판정 결과(grade/dev_pct/correction_mm/dir_err_deg/
reason)를 뺀 이유는 그 값들이 재판정 때마다 다시 계산되는 파생값이고, 입력
파일에 같이 담으면 재판정 후 입력과 판정 결과가 서로 다른 시점 것이 섞여
이중 진실이 되기 때문이었다. 그 판단은 여전히 맞다 - 다만 화면(스펙 §7.2)이
그 판정 결과 자체를 필요로 하는데, 지금까지 그걸 담은 기계 판독 산출물이
BOM·반올림이 있는 slope_cells.csv뿐이었다(대시보드에 CSV 파서가 없다).

그래서 판정 결과 "만" 담는 별도 파일을 낸다. slope_cells.json(입력, 무손실
셀 벡터)과 역할이 정반대다 - 이 파일은 grade_slope_cells 반환값만 담고 셀
벡터(slope_pct 등)는 담지 않는다. judge_slope_cells가 판정할 때마다 통째로
다시 쓰이므로 slope_stats.json·slope_cells.json과 절대 어긋나지 않는다(D1이
경계한 이중 진실은 "서로 다른 시점에 따로 계산되는 값"에서 생기는 것이지,
같은 호출이 같은 계산 결과를 여러 파일에 나눠 적는 것과는 다르다).

CSV(slope_cells.csv)와의 관계: CSV는 사람이 엑셀로 여는 export로 계속 남긴다.
이 JSON은 화면이 fetch하는 기계 판독 산출물이다 - CSV는 BOM(utf-8-sig)과
반올림(_r/_deg)이 있어 화면이 그대로 파싱해 쓰기 어렵다.

셀 식별자: 각 행에 (cx, cy)를 명시적으로 싣는다. slope_cells.json의 cells
배열과 이 파일의 cells 배열이 같은 compute_slope_cells 중첩 루프(cy 바깥,
cx 안쪽)에서 나와 순서가 사실상 같겠지만, "배열 순서가 같을 것이다"에 기대는
암묵적 조인과 "(cx, cy) 키로 짝짓는다"는 명시적 조인은 신뢰성이 다르다.
화면은 slope_cells.json의 셀을 (cx, cy) 키로 Map을 만들고, 이 파일의 각
행에서 같은 키로 판정 결과를 찾아 합치면 된다 - 두 파일의 배열 길이나
순서가 어떤 이유로 어긋나도(예: 후속 스키마 변경) 조인이 깨지지 않는다.
"""
import json
import math

# 파일 구조가 바뀔 때만 올린다.
SCHEMA_VERSION = 1


def _null_if_nan(v):
    """nan만 null로 바꾼다. None은 이미 grade_slope_cells가 "판정 안 함"의
    의미로 쓰는 값이라(예: 배수구 없을 때 dir_err_deg) 그대로 둔다 - 두 경우
    모두 JSON에서는 null로 나가므로 화면 입장에서는 구분할 필요가 없다."""
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def dump_slope_judged(graded, path, direction_judged):
    """grade_slope_cells의 반환(graded) -> slope_judged.json.

    direction_judged를 함께 싣는 이유: slope_stats.json에도 있지만(같은
    judge_slope_cells 호출 안에서 함께 계산되므로 값이 어긋날 수 없다), 화면이
    이 파일 하나만 봐도 "이 판정에 방향까지 반영됐는가"를 알아야 결과표의
    역구배 표시를 켤지 바로 정할 수 있다 - slope_stats.json을 별도로 다시
    fetch·파싱하게 만들 이유가 없다.

    threshold는 담지 않는다 - slope_stats.json에 이미 있고, 결과표를 그리는
    데 필요한 것은 threshold가 이미 적용된 결과(grade·dev_pct 등)이지 threshold
    원본 자체가 아니다. 전역 요약 화면은 어차피 slope_stats.json을 fetch하므로
    여기서 중복해 싣지 않는다(요청받으면 언제든 늘릴 수 있는 필드다).
    """
    rows = []
    for g in graded:
        c = g["cell"]
        rows.append({
            "cx": c.cx,
            "cy": c.cy,
            "grade": g["grade"],
            "reason": g["reason"],
            "dev_pct": _null_if_nan(g["dev_pct"]),
            "dir_err_deg": _null_if_nan(g["dir_err_deg"]),
            "correction_mm": _null_if_nan(g["correction_mm"]),
        })
    payload = {
        "schema_version": SCHEMA_VERSION,
        "direction_judged": direction_judged,
        "cells": rows,
    }
    with open(path, "w", encoding="utf-8") as f:
        # allow_nan=False: _null_if_nan에서 이미 nan을 null로 치환했다.
        # slope_cells.json/slope_stats.json과 같은 관례(pipeline.py 참고).
        json.dump(payload, f, ensure_ascii=False, indent=2, allow_nan=False)
    return path

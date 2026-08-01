"""범용 프로그램 결과 JSON 임포트 (스펙 §5.4, 계약 정본: docs/contracts/stats-schema.md §7
"flatness-import-v1"). 과업지시서 세부과업 1 기술 요구사항의 연계 형식(PTS/XYZ/TXT/CSV/JSON)
중 JSON을 충족한다.

계약이 정의한 `points[].deviation_mm`는 CSV 경로의 `Signed_Distance_mm`과 동일하게
이미 평면 제거가 끝난 편차값이므로, 재분석 없이 서브셀 중앙값 → 직선자 셀 판정
기계에 그대로 태운다(colab_csv.py와 동일 파이프라인 — flatness.importer.common).
"""
import json as _json

import numpy as np

from flatness.importer.common import run_import_pipeline

_EXPECTED_FORMAT = "flatness-import-v1"
_SUPPORTED_SURFACE = "floor"
_REQUIRED_TOP_KEYS = ("format", "surface", "points")
_REQUIRED_POINT_KEYS = ("x", "y", "deviation_mm")

_EXPECTED_SCHEMA_HINT = (
    '{"format":"flatness-import-v1","surface":"floor",'
    '"points":[{"x":<m>,"y":<m>,"deviation_mm":<mm>}, ...],'
    '"meta":{"source_program":"...","measured_at":"YYYY-MM-DD"}}'
    " (docs/contracts/stats-schema.md §7 참고)"
)


def _schema_error(detail):
    return ValueError(f"임포트 데이터 스키마 불일치: {detail}. 기대 스키마: {_EXPECTED_SCHEMA_HINT}")


def _validate_top_level(doc):
    if not isinstance(doc, dict):
        raise _schema_error("JSON 최상위는 객체(object)여야 합니다")
    missing = [k for k in _REQUIRED_TOP_KEYS if k not in doc]
    if missing:
        raise _schema_error(f"필수 키 누락: {', '.join(missing)}")
    if doc["format"] != _EXPECTED_FORMAT:
        raise _schema_error(f"format 값이 '{_EXPECTED_FORMAT}'이 아닙니다 (실제: {doc['format']!r})")
    if doc["surface"] != _SUPPORTED_SURFACE:
        raise _schema_error(
            f"surface='{doc['surface']}'는 지원하지 않습니다(현재 '{_SUPPORTED_SURFACE}'만 지원)")
    points = doc["points"]
    if not isinstance(points, list) or not points:
        raise _schema_error("points 배열이 비어 있거나 배열이 아닙니다(최소 1개 필요)")
    return points


def _load(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        try:
            doc = _json.load(f)
        except _json.JSONDecodeError as e:
            raise _schema_error(f"JSON 파싱 실패: {e}") from e
    points_raw = _validate_top_level(doc)

    xs, ys, ds = [], [], []
    for p in points_raw:
        if not isinstance(p, dict):
            continue
        missing = [k for k in _REQUIRED_POINT_KEYS if k not in p]
        if missing:
            continue
        try:
            x, y, d = float(p["x"]), float(p["y"]), float(p["deviation_mm"])
        except (TypeError, ValueError):
            continue
        if not (np.isfinite(x) and np.isfinite(y) and np.isfinite(d)):
            continue
        xs.append(x); ys.append(y); ds.append(d)
    if not xs:
        raise ValueError("JSON 임포트에 유효한 points 없음(x/y/deviation_mm 모두 숫자여야 함)")
    pts = np.column_stack([xs, ys, np.asarray(ds) / 1000.0])  # 편차를 m로
    return pts, doc.get("meta") or {}


def import_json(path, criterion, u_mm, out_dir, subcell_m=0.05, cell_m=1.0):
    pts, src_meta = _load(path)
    meta = {
        "file": str(path),
        "engine_version": "external-json-v1",
        "source": "json-import",
        "source_program": src_meta.get("source_program"),
        "measured_at": src_meta.get("measured_at"),
    }
    return run_import_pipeline(pts, criterion, u_mm, out_dir, meta,
                                subcell_m=subcell_m, cell_m=cell_m)

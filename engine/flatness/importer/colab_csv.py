"""기존 Colab 노트북 결과 CSV 임포트 (스펙 §5.4 — 과업지시서 '분석 결과 자동 불러오기').

Signed_Distance_mm는 기존 프로그램이 이미 평면 제거한 편차이므로 재분석 없이
서브셀 중앙값 → 직선자 셀 판정 기계에 직접 태운다.
"""
import csv as _csv
import numpy as np
from flatness.importer.common import run_import_pipeline


def _load(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = _csv.DictReader(f)
        cols = reader.fieldnames or []
        need = {"X", "Y", "Signed_Distance_mm"}
        if not need.issubset(set(cols)):
            raise ValueError("Colab CSV 형식 아님: X,Y,Signed_Distance_mm 컬럼 필요")
        xs, ys, ss = [], [], []
        for row in reader:
            try:
                x, y, s = float(row["X"]), float(row["Y"]), float(row["Signed_Distance_mm"])
            except (ValueError, TypeError):
                continue
            if not (np.isfinite(x) and np.isfinite(y) and np.isfinite(s)):
                continue
            xs.append(x); ys.append(y); ss.append(s)
    if not xs:
        raise ValueError("Colab CSV에 유효 행 없음")
    return np.column_stack([xs, ys, np.asarray(ss) / 1000.0])  # 편차를 m로


def import_colab_csv(path, criterion, u_mm, out_dir, subcell_m=0.05, cell_m=1.0):
    pts = _load(path)
    meta = {"file": str(path), "engine_version": "external-colab-v1", "source": "colab-import"}
    return run_import_pipeline(pts, criterion, u_mm, out_dir, meta,
                                subcell_m=subcell_m, cell_m=cell_m)

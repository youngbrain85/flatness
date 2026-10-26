"""slope_planes.json·slope_planes.png — 다면 기준평면(core/multiplane.py) 산출물.

slope_cells.json 과 같은 원칙(D1)을 따른다: 이 파일은 재판정 입력(평면 기하)만 담고 판정 결과(grade 등)는 담지 않는다.
판정 결과는 judge_slope_cells 가 slope_stats.json 의 planes 항목에 매번 다시 쓴다.

labels 는 서브셀 격자의 칸별 평면 번호(0 = 평면 밖·제외)다. residual_grid.json 과 같은 배치(행 우선, 행 0 이 y 가
가장 작은 쪽, cols x rows)이고 원점은 origin_m(서브셀 격자 원점의 절대 좌표 m)이다.
"""
from dataclasses import asdict, fields
import json
import math

import numpy as np

from flatness.core.multiplane import FloorPlane
from flatness.outputs import heatmap as _engine_heatmap  # noqa: F401  (Agg 백엔드·한글 폰트)
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch

SCHEMA_VERSION = 1
FILE_NAME = "slope_planes.json"
PNG_NAME = "slope_planes.png"

_FIELD_NAMES = tuple(f.name for f in fields(FloorPlane))


def _num(v):
    return None if isinstance(v, float) and math.isnan(v) else v


def dump_slope_planes(fit, path, subcell_m, origin_m):
    """MultiPlaneFit -> slope_planes.json (무손실 평면 기하 + 칸별 평면 번호)."""
    planes = []
    for p in fit.planes:
        row = {k: _num(v) for k, v in asdict(p).items()}
        row["abc"] = [float(v) for v in p.abc]
        planes.append(row)
    lab = fit.labels
    payload = {
        "schema_version": SCHEMA_VERSION,
        "requested": fit.requested,
        "thr_m": fit.thr_m,
        "sigma_m": fit.sigma_m,
        "subcell_m": subcell_m,
        "origin_m": [float(v) for v in origin_m],
        "cols": int(lab.shape[1]),
        "rows": int(lab.shape[0]),
        "planes": planes,
        "labels": [int(v) for v in lab.ravel().tolist()],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return path


def load_slope_planes(path):
    """slope_planes.json -> ([FloorPlane], meta). 재판정이 점군을 다시 읽지 않고 평면을 판정할 때 쓴다.

    meta = {requested, thr_m, sigma_m, subcell_m, origin_m, labels(rows x cols 정수 배열)}."""
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"지원하지 않는 평면 데이터 파일 버전입니다({path}): "
                         f"schema_version={payload.get('schema_version')!r}")
    planes = []
    for row in payload["planes"]:
        kw = {k: row[k] for k in _FIELD_NAMES}
        kw["abc"] = tuple(kw["abc"])
        if kw["se_pct"] is None:
            kw["se_pct"] = float("nan")
        planes.append(FloorPlane(**kw))
    meta = {k: payload[k] for k in ("requested", "thr_m", "sigma_m", "subcell_m", "origin_m")}
    meta["labels"] = np.asarray(payload["labels"], dtype=np.int32).reshape(payload["rows"], payload["cols"])
    return planes, meta


# 판정 색은 구배 지도(slope_map.py)와 같은 언어를 쓴다. 평면 구분 색은 판정색과 겹치지 않는 옅은 톤
_PLANE_COLORS = ["#8ecae6", "#ffb703", "#b5838d", "#90be6d", "#cdb4db", "#f4a261", "#a8dadc", "#e9c46a",
                 "#bde0fe", "#ffafcc"]


def render_slope_planes(fit_labels, graded_planes, out_path, subcell_m, origin_m, drain_points=None):
    """칸별 평면 지도 + 평면마다 무게중심 내리막 화살표·구배·등급 표시."""
    lab = np.asarray(fit_labels)
    ny, nx = lab.shape
    n = max(1, int(lab.max()))
    colors = ["#ffffff"] + [_PLANE_COLORS[(i - 1) % len(_PLANE_COLORS)] for i in range(1, n + 1)]
    ox, oy = float(origin_m[0]), float(origin_m[1])
    extent = (ox, ox + nx * subcell_m, oy, oy + ny * subcell_m)
    fig, ax = plt.subplots(figsize=(8, 7))
    ax.imshow(lab, origin="lower", extent=extent, cmap=ListedColormap(colors),
              vmin=-0.5, vmax=n + 0.5, interpolation="nearest")
    span = max(extent[1] - extent[0], extent[3] - extent[2])
    handles = []
    for g in graded_planes:
        p = g["plane"]
        L = span * 0.08
        ax.arrow(p.centroid_x, p.centroid_y, L * math.cos(p.downhill_rad), L * math.sin(p.downhill_rad),
                 head_width=span * 0.02, length_includes_head=True, color="black", linewidth=1.2, zorder=4)
        # 글상자는 화살표 반대(오르막) 쪽에 둬서 화살표를 가리지 않는다
        ax.text(p.centroid_x - 0.6 * L * math.cos(p.downhill_rad), p.centroid_y - 0.6 * L * math.sin(p.downhill_rad),
                f"P{p.plane_id}\n{p.slope_pct:.2f}%\n{g['grade']}",
                ha="center", va="center", fontsize=8, zorder=5,
                bbox={"boxstyle": "round,pad=0.2", "facecolor": "white", "alpha": 0.8, "linewidth": 0})
        handles.append(Patch(facecolor=colors[p.plane_id], edgecolor="#555555",
                             label=f"P{p.plane_id} {p.area_m2:.1f}m² {p.slope_pct:.2f}% {g['grade']}"))
    if drain_points:
        ax.scatter([q[0] for q in drain_points], [q[1] for q in drain_points], s=90, c="#1a73e8",
                   edgecolors="white", linewidths=1.0, zorder=6)
    ax.set_aspect("equal")
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_title("다면 기준평면 (화살표는 내리막 방향)")
    ax.legend(handles=handles, loc="upper left", bbox_to_anchor=(1.01, 1.0), fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    return out_path

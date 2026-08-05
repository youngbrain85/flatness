"""구배 지도 — 등급 색 배경 + 내리막 방향 화살표.

heatmap을 import하는 것은 부수효과 목적이다: matplotlib Agg 백엔드와 플랫폼별
한글 폰트 설정이 그 모듈 상단에 있다(worker/flatworker/report/assets.py와 동일한
방식). 이 import를 지우면 한글이 네모 상자로 렌더된다.
"""
from flatness.outputs import heatmap as _engine_heatmap  # noqa: F401
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

from flatness.core.slope import (GRADE_BORDER, GRADE_NA, GRADE_PASS,
                                 GRADE_REDO, GRADE_REPAIR)

# 평활도 히트맵과 같은 색 언어를 쓴다 - 같은 스캔의 두 결과가 나란히 뜨므로
# 색이 다르면 혼란스럽다.
_COLOR = {
    GRADE_PASS: "#3d8b3d",
    GRADE_BORDER: "#d6c11e",
    GRADE_REPAIR: "#e07b1a",
    GRADE_REDO: "#c0392b",
    GRADE_NA: "#9e9e9e",
}

# 대시보드 Canvas 히트맵(dashboard/components/analysis/slope-heatmap-view.tsx의
# DRAIN_COLOR)과 정확히 같은 값. 같은 판정 결과를 그리는 두 렌더러(엔진 PNG·
# 대시보드 Canvas)가 배수구를 다른 색으로 찍으면 나란히 봤을 때 혼란스럽다
# (백로그 81).
_DRAIN_COLOR = "#1a73e8"


def render_slope_map(graded, out_path, cell_m=2.0, drain_points=None):
    fig, ax = plt.subplots(figsize=(8, 7))
    for g in graded:
        c = g["cell"]
        # 명목 cell_m이 아니라 셀의 실제 폭·높이로 그린다. 바닥 폭이 cell_m의 배수가
        # 아니면 가장자리 조각 셀이 생기는데, 명목 크기로 그리면 이웃과 겹치고
        # 바닥 밖으로 삐져나온다.
        w_m = getattr(c, "width_m", cell_m)
        h_m = getattr(c, "height_m", cell_m)
        x0 = c.center_x - w_m / 2
        y0 = c.center_y - h_m / 2
        ax.add_patch(plt.Rectangle((x0, y0), w_m, h_m,
                                   facecolor=_COLOR.get(g["grade"], "#9e9e9e"),
                                   edgecolor="white", linewidth=0.5))
        if not c.ok:
            continue
        # 내리막 방향 화살표. 역구배 셀은 굵게 그린다 - 크기가 정상이면 색만으로는
        # 드러나지 않아서, 물이 반대로 흐르는 것을 놓치기 쉽다.
        reverse = g["dir_err_deg"] is not None and g["dir_err_deg"] > 90.0
        L = cell_m * 0.35
        ax.arrow(c.center_x, c.center_y,
                 L * np.cos(c.downhill_rad), L * np.sin(c.downhill_rad),
                 head_width=cell_m * 0.12, length_includes_head=True,
                 color="black", linewidth=2.2 if reverse else 0.9)
    if graded:
        xs = [g["cell"].center_x for g in graded]
        ys = [g["cell"].center_y for g in graded]
        ax.set_xlim(min(xs) - cell_m, max(xs) + cell_m)
        ax.set_ylim(min(ys) - cell_m, max(ys) + cell_m)
    legend_handles = [Patch(facecolor=v, label=k) for k, v in _COLOR.items()]
    if drain_points:
        # 판정표의 "왜 역구배인가"는 "배수구가 어디 있고 물이 그 반대로
        # 흐르기 때문"인데, 종이 PDF만 받는 발주처는 stats.drain_points jsonb를
        # 볼 방법이 없다(백로그 81) - 그림 자체에 배수구를 찍어야 자기완결적
        # 설명이 된다. 셀 패치·화살표(둘 다 zorder 기본값)보다 위에 그려야
        # 마커가 가려지지 않으므로 zorder를 높게 준다.
        ax.scatter([p["x"] for p in drain_points], [p["y"] for p in drain_points],
                   s=90, c=_DRAIN_COLOR, edgecolors="white", linewidths=1.0,
                   zorder=5)
        legend_handles.append(Line2D([0], [0], marker="o", color="none",
                                     markerfacecolor=_DRAIN_COLOR,
                                     markeredgecolor="white", markersize=8,
                                     label="배수구"))
    ax.set_aspect("equal")
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_title("구배 판정 지도 (화살표는 내리막 방향)")
    ax.legend(handles=legend_handles,
              loc="upper left", bbox_to_anchor=(1.01, 1.0), fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    # out_path가 pathlib.Path면 basename만 돌려준다 - judge_slope_cells가 이
    # 값을 그대로 stats.artifacts.map_png에 싣지 않고 자신이 만든 전체 경로
    # 문자열을 쓰므로(형식은 호출부 책임), 여기서는 호출부가 Path를 넘겼다는
    # 사실 자체를 돌려주는 쪽이 (예: 파일명만 다시 확인하고 싶은 호출부에)
    # 더 쓸모 있다. 문자열 경로를 넘긴 기존 호출부(CLI 등)는 그 문자열을
    # 그대로 돌려받는 기존 계약을 유지한다.
    return out_path.name if hasattr(out_path, "name") else out_path

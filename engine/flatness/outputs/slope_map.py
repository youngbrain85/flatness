"""구배 지도 — 등급 색 배경 + 내리막 방향 화살표.

heatmap을 import하는 것은 부수효과 목적이다: matplotlib Agg 백엔드와 플랫폼별
한글 폰트 설정이 그 모듈 상단에 있다(worker/flatworker/report/assets.py와 동일한
방식). 이 import를 지우면 한글이 네모 상자로 렌더된다.
"""
from flatness.outputs import heatmap as _engine_heatmap  # noqa: F401
import matplotlib.pyplot as plt
import numpy as np
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


def render_slope_map(graded, out_path, cell_m=2.0):
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
    ax.set_aspect("equal")
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_title("구배 판정 지도 (화살표는 내리막 방향)")
    ax.legend(handles=[Patch(facecolor=v, label=k) for k, v in _COLOR.items()],
              loc="upper left", bbox_to_anchor=(1.01, 1.0), fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    return out_path

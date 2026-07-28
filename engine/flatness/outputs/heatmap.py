"""판정 히트맵 PNG — 4등급 색 + 판정 불가 회색 (스펙 §5.1.9, 색각 대비 고려 팔레트)."""
import matplotlib
matplotlib.use("Agg")  # 헤드리스 렌더
matplotlib.rc("font", family="Malgun Gothic")  # Windows 한글 폰트
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch

GRADE_COLORS = {"pass": "#2e7d32", "borderline": "#f9ab00",
                "repair": "#e8710a", "rework": "#c5221f", "na": "#9e9e9e"}
_ORDER = ["pass", "borderline", "repair", "rework", "na"]
_LABELS = {"pass": "적합", "borderline": "경계", "repair": "보수",
           "rework": "재시공", "na": "판정 불가"}


def render_heatmap(cells, grades, out_path, cell_m=1.0):
    ncx = max(c.ix for c in cells) + 1
    ncy = max(c.iy for c in cells) + 1
    img = np.full((ncy, ncx), _ORDER.index("na"), dtype=int)
    for c, g in zip(cells, grades):
        img[c.iy, c.ix] = _ORDER.index(g if g is not None else "na")
    fig, ax = plt.subplots(figsize=(max(4, ncx * 0.6), max(3, ncy * 0.6)))
    ax.imshow(img, cmap=ListedColormap([GRADE_COLORS[k] for k in _ORDER]),
              vmin=0, vmax=len(_ORDER) - 1, origin="lower",
              extent=[0, ncx * cell_m, 0, ncy * cell_m])
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_title("평활도 판정 히트맵")
    ax.legend(handles=[Patch(color=GRADE_COLORS[k], label=_LABELS[k]) for k in _ORDER],
              loc="upper left", bbox_to_anchor=(1.01, 1.0), fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)

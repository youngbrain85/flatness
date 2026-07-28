"""3D 프리뷰 PNG — matplotlib 등각 산점도 2장(전체 + 최대 결함 확대), 서버측 정적 렌더.

헤드리스 WebGL은 사용하지 않는다(스펙 §8 결정). 폰트·Agg 설정은 heatmap 모듈이 담당.
"""
import numpy as np
from flatness.outputs import heatmap as _hm  # Agg·한글 폰트 설정 재사용(부수효과 import)
import matplotlib.pyplot as plt


def _scatter(ax, xs, ys, zs, title):
    p = ax.scatter(xs, ys, zs * 1000.0, c=zs * 1000.0, cmap="RdYlGn_r", s=2)
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_zlabel("편차 (mm)")
    ax.set_title(title)
    return p


def render_preview3d(residuals, grid, out_dir, worst_xy=None, max_points=50000):
    ys, xs = np.nonzero(np.isfinite(residuals))
    if len(xs) == 0:
        return []
    cx = grid.origin[0] + (xs + 0.5) * grid.size_m
    cy = grid.origin[1] + (ys + 0.5) * grid.size_m
    zz = residuals[ys, xs].astype(float)
    if len(cx) > max_points:
        idx = np.random.default_rng(0).choice(len(cx), max_points, replace=False)
        cx, cy, zz = cx[idx], cy[idx], zz[idx]
    names = []
    fig = plt.figure(figsize=(8, 6))
    ax = fig.add_subplot(111, projection="3d")
    p = _scatter(ax, cx, cy, zz, "평활도 편차 3D 프리뷰")
    fig.colorbar(p, ax=ax, shrink=0.6, label="편차 (mm)")
    fig.tight_layout()
    fig.savefig(out_dir / "preview3d.png", dpi=110)
    plt.close(fig)
    names.append("preview3d.png")
    if worst_xy is not None:
        m = (np.abs(cx - worst_xy[0]) <= 1.5) & (np.abs(cy - worst_xy[1]) <= 1.5)
        if m.any():
            fig = plt.figure(figsize=(8, 6))
            ax = fig.add_subplot(111, projection="3d")
            p = _scatter(ax, cx[m], cy[m], zz[m], "최대 결함 구역 확대")
            fig.colorbar(p, ax=ax, shrink=0.6, label="편차 (mm)")
            fig.tight_layout()
            fig.savefig(out_dir / "preview3d_zoom.png", dpi=110)
            plt.close(fig)
            names.append("preview3d_zoom.png")
    return names

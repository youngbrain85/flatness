"""보고서 자산 — 도면 평면과 등급별 도달 범위 지도.

지도는 판정 결과(`judge.ClassResult`)에서만 그린다. 그림과 표가 다른 계산을 하면
둘 중 하나가 틀린 것이므로, 같은 입력에서 나오게 묶는다.
"""
from __future__ import annotations

import os
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.path import Path as MplPath  # noqa: E402
from matplotlib.patches import PathPatch  # noqa: E402

# 리눅스 컨테이너에서는 fonts-noto-cjk가 'Noto Sans CJK KR'을 등록한다.
# Windows 개발 PC에는 맑은 고딕이 있어 두 후보를 모두 둔다(보고서 템플릿과 같은 방침).
matplotlib.rcParams["font.family"] = ["Noto Sans CJK KR", "Noto Sans KR", "Malgun Gothic", "sans-serif"]
matplotlib.rcParams["axes.unicode_minus"] = False

REACHABLE_FC = "#bbf7d0"
UNREACHABLE_FC = "#fecaca"
NO_GEOMETRY_FC = "#e5e7eb"
NON_TRAVERSABLE_FC = "#cbd5e1"

# 통행 대상이 아닌 실 — 벽체가 차지하는 면적과 설비 샤프트다
NON_TRAVERSABLE = {"벽체공용", "PD"}


def _patch(rings, **kw):
    verts, codes = [], []
    for ring in rings:
        pts = [(x, y) for x, y in ring]
        verts += pts + [pts[0]]
        codes += [MplPath.MOVETO] + [MplPath.LINETO] * (len(pts) - 1) + [MplPath.CLOSEPOLY]
    return PathPatch(MplPath(verts, codes), **kw)


def _draw_spaces(ax, spaces, color_of, label_of, fontsize=7.6):
    """벽체를 먼저 깔고 실을 그 위에 얹는다 — 순서를 뒤집으면 벽체가 실을 덮는다."""
    ordered = sorted(spaces, key=lambda s: s["name"] not in NON_TRAVERSABLE)
    bounds: list[tuple[float, float, float, float]] = []
    for sp in ordered:
        rings = sp.get("outline")
        if not rings:
            continue
        ax.add_patch(_patch(rings, facecolor=color_of(sp), edgecolor="#374151", lw=1.1,
                            zorder=2 if sp["name"] in NON_TRAVERSABLE else 3))
        xs = [p[0] for p in rings[0]]
        ys = [p[1] for p in rings[0]]
        bounds.append((min(xs), min(ys), max(xs), max(ys)))
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        if sp["name"] == "벽체공용":          # 중심이 다른 실 안에 떨어진다
            cx, cy = max(xs) - 200, (min(ys) + max(ys)) / 2
        text = label_of(sp)
        if text:
            ax.text(cx, cy, text, ha="center", va="center", fontsize=fontsize, zorder=6)
    # ★ 축 한계를 데이터에서 직접 잡는다. add_patch 는 autoscale 을 갱신하지 않으므로
    #   한계가 기본값(0..1)에 머무는데, 거기에 bbox_inches='tight' 를 걸면 저장 시
    #   그림 크기가 데이터 범위만큼 폭발해 MemoryError 가 난다(실제로 났다).
    if bounds:
        pad = 150.0
        ax.set_xlim(min(b[0] for b in bounds) - pad, max(b[2] for b in bounds) + pad)
        ax.set_ylim(min(b[1] for b in bounds) - pad, max(b[3] for b in bounds) + pad)
    ax.set_aspect("equal")
    ax.axis("off")


def plan_figure(spaces, out_path: str | Path) -> Path:
    """실별 면적·FL 을 얹은 평면."""
    fig, ax = plt.subplots(figsize=(4.4, 8.0))

    def color(sp):
        if sp["name"] in NON_TRAVERSABLE:
            return NON_TRAVERSABLE_FC
        return "#fef3c7"

    def label(sp):
        fl = sp.get("fl_mm")
        parts = [sp["name"]]
        if sp.get("area_m2") is not None:
            parts.append(f"{sp['area_m2']:.4f} m²")
        parts.append(f"FL {fl:+.0f}" if fl is not None else "FL 미표기")
        return "\n".join(parts)

    _draw_spaces(ax, spaces, color, label)
    fig.tight_layout(pad=0.2)
    fig.savefig(out_path, dpi=190, bbox_inches="tight")
    plt.close(fig)
    return Path(out_path)


def reach_figure(spaces, result, out_path: str | Path) -> Path:
    """한 등급의 도달 범위. 초록=도달, 빨강=도달 불가, 회색=통행 대상 아님.

    ★ 그림 크기가 작은 이유: 보고서에서 46mm 폭으로 축소되어 들어간다. 큰 그림을 줄이면
      글자가 같이 줄어 읽을 수 없다(실제로 그렇게 나왔다). 그림을 작게 만들어야 같은
      포인트의 글자가 상대적으로 커진다.
    """
    fig, ax = plt.subplots(figsize=(1.9, 3.5))

    def color(sp):
        if sp["name"] in NON_TRAVERSABLE:
            return NON_TRAVERSABLE_FC
        if not sp.get("outline"):
            return NO_GEOMETRY_FC
        return REACHABLE_FC if sp["name"] in result.reachable else UNREACHABLE_FC

    def label(sp):
        if sp["name"] in NON_TRAVERSABLE:
            return sp["name"]
        mark = "도달" if sp["name"] in result.reachable else "불가"
        return f"{sp['name']}\n{mark}"

    _draw_spaces(ax, spaces, color, label, fontsize=5.2)
    fig.tight_layout(pad=0.15)
    fig.savefig(out_path, dpi=320, bbox_inches="tight")
    plt.close(fig)
    return Path(out_path)


def build_all(dump, results, assets_dir: str | Path) -> dict[str, str]:
    """자산을 전부 만들고 {키: 파일명} 을 돌려준다. 파일명은 HTML 이 상대경로로 참조한다."""
    assets_dir = Path(assets_dir)
    assets_dir.mkdir(parents=True, exist_ok=True)
    spaces = dump["spaces"]
    out = {"plan": "plan.png"}
    plan_figure(spaces, assets_dir / "plan.png")
    for r in results:
        name = f"reach_{r.robot_class}.png"
        reach_figure(spaces, r, assets_dir / name)
        out[r.robot_class] = name
    return out

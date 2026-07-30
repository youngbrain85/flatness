"""정밀 편차맵 PNG — 10cm 해상도 연속 색상 보조 시각화 (스펙 §5.1.9 추가 산출물).

판정 히트맵(1m 셀·5색 이산)과 목적이 다르다: 이 그림은 등급을 말하지 않고 원시 편차의
분포를 그대로 보여준다. 판정 경로(evaluate_cells·grade_cells)와 완전히 분리돼 있어,
이 모듈이 무엇을 하든 stats.json의 등급·수치는 달라지지 않는다.

해상도는 5cm 서브셀 잔차를 2x2 평균 풀링해 얻는다 — 점군 재읽기도 평면 재피팅도 없다.
색 언어는 3D 프리뷰(outputs/preview3d.py)와 같은 RdYlGn_r를 쓰되 0mm를 중앙에 두고
±최대 절대편차로 대칭 정규화한다(부호가 살아 있어야 융기와 침하가 구분된다).
"""
import numpy as np
import matplotlib
from flatness.outputs import heatmap as _hm  # noqa: F401  Agg·한글 폰트 설정 재사용(부수효과 import)
import matplotlib.pyplot as plt

DEVIATION_RES_M = 0.10   # 고정 해상도(사용자 설정 없음 — 계획 YAGNI)
DEVIATION_CMAP = "RdYlGn_r"
_NA_COLOR = "#e8e8e8"    # 데이터 없는 셀(NaN)
_MIN_VMAX_MM = 0.5       # 완전 평탄면에서 vmin==vmax 퇴화 방지
_LONG_SIDE_IN = 9.0      # 긴 변 고정 — 넓은 바닥에서도 PNG 크기가 폭주하지 않는다


def pool_nanmean(a, factor):
    """2D 배열을 factor x factor 블록 평균으로 접는다(NaN 무시).

    블록 안의 유효값만 평균하고 전부 NaN인 블록은 NaN으로 남긴다 — 데이터가 없는 곳을
    0mm로 칠하면 "평탄하다"는 거짓 정보가 된다. 변 길이가 배수가 아니면 NaN으로 패딩한다.
    numpy.nanmean은 전부 NaN인 슬라이스에서 RuntimeWarning을 내므로 합/개수로 직접 계산한다.
    """
    a = np.asarray(a, dtype=np.float64)
    if factor <= 1:
        return a.copy()
    ny, nx = a.shape
    pad_y, pad_x = (-ny) % factor, (-nx) % factor
    if pad_y or pad_x:
        a = np.pad(a, ((0, pad_y), (0, pad_x)), constant_values=np.nan)
    ny, nx = a.shape
    finite = np.isfinite(a)
    blocks = (ny // factor, factor, nx // factor, factor)
    total = np.where(finite, a, 0.0).reshape(blocks).sum(axis=(1, 3))
    count = finite.reshape(blocks).sum(axis=(1, 3))
    out = np.full(count.shape, np.nan, dtype=np.float64)
    np.divide(total, count, out=out, where=count > 0)
    return out


def _figsize(span_x_m, span_y_m):
    """긴 변을 _LONG_SIDE_IN으로 고정한 종횡비 보존 크기 + 컬러바·축 여백."""
    if span_x_m <= 0 or span_y_m <= 0:
        return (6.0, 5.0)
    if span_x_m >= span_y_m:
        w, h = _LONG_SIDE_IN, max(2.5, _LONG_SIDE_IN * span_y_m / span_x_m)
    else:
        h, w = _LONG_SIDE_IN, max(2.5, _LONG_SIDE_IN * span_x_m / span_y_m)
    return (w + 1.8, h + 0.8)


def render_deviation_map(residuals, grid, out_path, target_m=DEVIATION_RES_M,
                         title="정밀 편차맵 (10cm 해상도)",
                         xlabel="X (m)", ylabel="Y (m)",
                         cbar_label="편차 (mm), + 융기 / - 침하"):
    """잔차 배열(m)을 target_m 해상도 편차맵 PNG로 저장하고 파일명을 반환한다.

    유효값이 하나도 없으면 파일을 만들지 않고 None을 반환한다(호출자가 목록에서 뺀다).
    풀링 배율은 grid.size_m에서 계산하므로 subcell_m이 기본값 0.05가 아니어도 목표
    해상도가 유지된다.
    """
    factor = max(1, int(round(target_m / grid.size_m)))
    pooled_mm = pool_nanmean(residuals, factor) * 1000.0
    if not np.isfinite(pooled_mm).any():
        return None
    vmax = float(np.nanmax(np.abs(pooled_mm)))
    if not np.isfinite(vmax) or vmax < _MIN_VMAX_MM:
        vmax = _MIN_VMAX_MM
    cell_m = grid.size_m * factor
    ny, nx = pooled_mm.shape
    ox, oy = float(grid.origin[0]), float(grid.origin[1])
    cmap = matplotlib.colormaps[DEVIATION_CMAP].with_extremes(bad=_NA_COLOR)
    fig, ax = plt.subplots(figsize=_figsize(nx * cell_m, ny * cell_m))
    im = ax.imshow(np.ma.masked_invalid(pooled_mm), cmap=cmap, vmin=-vmax, vmax=vmax,
                   origin="lower", interpolation="nearest",
                   extent=[ox, ox + nx * cell_m, oy, oy + ny * cell_m])
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.set_aspect("equal")
    fig.colorbar(im, ax=ax, shrink=0.85, label=cbar_label)
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
    return out_path.name

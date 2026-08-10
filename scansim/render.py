# -*- coding: utf-8 -*-
"""렌더러: 프레임 PNG · GIF 애니메이션 · 커버리지 곡선 · 최종 지도 (스펙 §6, 계획 Task 7).

프레임은 시뮬레이션 상태 스트림(SimResult.frames)을 재현(replay)하며 그린다 —
프레임 시점의 누적 커버리지는 simulate 와 같은 순서로 observe 를 다시 호출해
얻는다(모바일: 매 프레임 observe_fan, TLS: 정지 블록 끝 = 스캔 완료 프레임에
observe_station). 재현 최종 상태가 SimResult.cov 와 비트 단위로 일치함을
테스트가 고정한다 — 그림이 보여주는 상태가 곧 시뮬레이션 상태다.

색 계약 (계획 Task 7): 미커버=빨강 계열, 등급별 커버=초록 농도(목표가 촘촘한
등급일수록 진하게), 장애물=회색, 로봇=진회색 + 시야 부채꼴(모바일).
"""
from __future__ import annotations

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import Circle, Patch, Wedge  # noqa: E402
from PIL import Image  # noqa: E402

from scansim.coverage import CoverageGrid  # noqa: E402
from scansim.grid import OccupancyGrid  # noqa: E402

# 리눅스 컨테이너는 fonts-noto-cjk, Windows 개발 PC는 맑은 고딕 (bim/report/assets.py 방침).
# 미설치 후보를 그대로 넘기면 findfont 경고가 텍스트마다 쏟아지므로 설치분만 고른다.
_KR_CANDIDATES = ["Noto Sans CJK KR", "Noto Sans KR", "Malgun Gothic"]
_installed = {f.name for f in matplotlib.font_manager.fontManager.ttflist}
matplotlib.rcParams["font.family"] = (
    [f for f in _KR_CANDIDATES if f in _installed] + ["sans-serif"])
matplotlib.rcParams["axes.unicode_minus"] = False

# ── 색 계약 (RGB 0~1) ───────────────────────────────────────
COL_UNCOVERED = (254 / 255, 202 / 255, 202 / 255)  # 빨강 계열 — bim UNREACHABLE_FC 와 동일
COL_OBSTACLE = (156 / 255, 163 / 255, 175 / 255)   # 회색 (벽·가구·격자 밖)
COL_GREEN_DARK = (21 / 255, 128 / 255, 61 / 255)   # 가장 촘촘한 등급
COL_GREEN_LIGHT = (187 / 255, 247 / 255, 208 / 255)  # 가장 느슨한 등급
COL_ROBOT = "#374151"                              # 로봇 = 진회색
COL_TRAJ = "#1f2937"                               # 지나온 궤적
COL_FAN = "#3b82f6"                                # 시야 부채꼴 (반투명으로 사용)

_FIG_W_IN = 5.6       # 프레임 그림 폭(인치) — 높이는 격자 종횡비로 계산
_FRAME_DPI = 110      # PNG ≤ 2MB 상한(계획 Task 7)에 여유가 큰 해상도


def tier_greens(density_targets_mm: dict) -> dict:
    """등급별 초록 농도 — 목표(mm)가 촘촘할수록 진하게.

    목표 오름차순으로 진초록→연초록을 선형 보간한다. 등급 1개면 진초록.
    """
    tiers = sorted(density_targets_mm, key=lambda t: density_targets_mm[t])
    n = len(tiers)
    out = {}
    for i, tier in enumerate(tiers):
        f = i / (n - 1) if n > 1 else 0.0
        out[tier] = tuple(d + (l - d) * f
                          for d, l in zip(COL_GREEN_DARK, COL_GREEN_LIGHT))
    return out


def coverage_image(occ: OccupancyGrid, cov: CoverageGrid) -> np.ndarray:
    """셀 분류 RGB 이미지 (ny, nx, 3).

    장애물=회색, 미달(미관측 포함)=빨강 계열, 등급 달성=초록 농도 —
    느슨한 등급부터 칠하고 촘촘한 등급이 위에 덮어 최고 달성 등급이 보인다.
    """
    img = np.empty((*occ.shape, 3), dtype=float)
    img[:] = COL_UNCOVERED
    img[~occ.free] = COL_OBSTACLE
    greens = tier_greens(cov.cfg.density_targets_mm)
    for tier, target in sorted(cov.cfg.density_targets_mm.items(),
                               key=lambda kv: -kv[1]):  # 느슨한 목표 먼저
        mask = occ.free & (cov.spacing_mm <= target)
        img[mask] = greens[tier]
    return img


# ── 커버리지 재현 (simulate 와 같은 관측 순서) ──────────────


def _tls_scan_indices(frames):
    """TLS 스캔 완료 프레임 = 정지 블록의 마지막 프레임 인덱스 집합.

    simulate._dwell 은 dwell 의 마지막 스텝 직전에 observe_station 을 호출해
    "스캔 완료" 프레임에 관측을 싣는다. 상태 스트림에서 그 프레임은 정지
    (moving=False) 구간이 끝나는 지점이다.
    """
    idx = set()
    for i, f in enumerate(frames):
        if not f.moving and (i + 1 == len(frames) or frames[i + 1].moving):
            idx.add(i)
    return idx


def _replay_steps(occ: OccupancyGrid, sim):
    """프레임마다 (인덱스, 프레임, 누적 CoverageGrid)를 낸다.

    관측 호출 순서가 simulate 와 동일하므로 마지막 상태는 sim.cov 와
    비트 단위로 같다 (테스트가 고정).
    """
    if sim.cov is None:
        raise ValueError("SimResult.cov 가 없어 커버리지를 재현할 수 없다")
    cfg = sim.cov.cfg
    cov = CoverageGrid(occ, cfg)
    scan_idx = _tls_scan_indices(sim.frames) if sim.mode == "tls" else ()
    for i, f in enumerate(sim.frames):
        if sim.mode == "mobile":
            # t=0 시작점 포함 매 프레임 관측 (simulate._simulate_mobile 과 동일)
            cov.observe_fan(f.x, f.y, f.heading_deg, cfg)
        elif i in scan_idx:
            cov.observe_station(f.x, f.y, cfg)
        yield i, f, cov


def replay_coverage(occ: OccupancyGrid, sim) -> CoverageGrid:
    """상태 스트림 전체를 재현한 최종 CoverageGrid (= sim.cov 와 동일해야 한다)."""
    cov = CoverageGrid(occ, sim.cov.cfg) if sim.cov is not None else None
    for _i, _f, cov in _replay_steps(occ, sim):
        pass
    if cov is None:
        raise ValueError("SimResult.cov 가 없어 커버리지를 재현할 수 없다")
    return cov


# ── 프레임 PNG ──────────────────────────────────────────────


def render_frames(occ: OccupancyGrid, sim, out_dir, every_n: int = 5) -> list:
    """시뮬 프레임을 every_n 개마다 1장씩 PNG 로 그린다. 반환 = 경로 목록.

    프레임 수 = ceil(len(sim.frames) / every_n). 전 프레임 픽셀 크기 동일
    (GIF 조립 전제) — bbox_inches='tight' 를 쓰지 않는 이유이기도 하다.
    """
    if every_n < 1:
        raise ValueError(f"every_n 은 1 이상이어야 한다: {every_n}")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    traj_x: list[float] = []
    traj_y: list[float] = []
    for i, f, cov in _replay_steps(occ, sim):
        traj_x.append(f.x)
        traj_y.append(f.y)
        if i % every_n == 0:
            p = out_dir / f"frame_{len(paths):04d}.png"
            _draw_frame(occ, cov, sim.mode, f, traj_x, traj_y, p)
            paths.append(p)
    return paths


def _grid_extent(occ: OccupancyGrid):
    """격자 전체의 mm 범위 (x0, x1, y0, y1)."""
    ny, nx = occ.shape
    ox, oy = occ.origin_xy
    return ox, ox + nx * occ.cell_mm, oy, oy + ny * occ.cell_mm


def _setup_map_axes(ax, occ):
    """지도 축 공통 설정 — 축 한계를 데이터에서 직접 잡는다.

    ★ add_patch(부채꼴·로봇 원)는 autoscale 을 갱신하지 않으므로 한계가
      기본값에 머물 수 있고, 거기서 저장하면 그림 크기가 데이터 범위만큼
      폭발해 MemoryError 가 난다 (bim/report/assets.py 에서 실제로 났던
      교훈 — 같은 방침으로 set_xlim/set_ylim 을 명시한다).
    """
    x0, x1, y0, y1 = _grid_extent(occ)
    ax.set_xlim(x0, x1)
    ax.set_ylim(y0, y1)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])


def _map_figsize(occ):
    """격자 종횡비에 맞춘 그림 크기 — occ 가 같으면 프레임 간 크기 불변."""
    ny, nx = occ.shape
    h = _FIG_W_IN * ny / nx
    return (_FIG_W_IN, min(max(h, 2.0), 9.0) + 0.5)  # 제목 여백 0.5in


def _draw_frame(occ, cov, mode, frame, traj_x, traj_y, out_path):
    """프레임 1장: 커버리지 배경 + 궤적 + 로봇(진회색) + 시야 부채꼴(모바일)."""
    cfg = cov.cfg
    fig, ax = plt.subplots(figsize=_map_figsize(occ))
    x0, x1, y0, y1 = _grid_extent(occ)
    ax.imshow(coverage_image(occ, cov), origin="lower",
              extent=(x0, x1, y0, y1), interpolation="nearest", zorder=1)
    if mode == "mobile":
        half = cfg.mobile_fov_deg / 2.0
        ax.add_patch(Wedge((frame.x, frame.y), cfg.mobile_range_mm,
                           frame.heading_deg - half, frame.heading_deg + half,
                           facecolor=COL_FAN, alpha=0.20, edgecolor="none",
                           zorder=2))
    ax.plot(traj_x, traj_y, color=COL_TRAJ, lw=1.0, zorder=3)
    ax.add_patch(Circle((frame.x, frame.y), cfg.robot_radius_mm,
                        facecolor=COL_ROBOT, edgecolor="none", zorder=4))
    _setup_map_axes(ax, occ)
    pct = "  ".join(f"{tier} {frame.coverage[tier]:.1f}%"
                    for tier in sorted(frame.coverage))
    ax.set_title(f"{mode}  t={frame.t_s:.1f}s  {pct}", fontsize=9)
    fig.savefig(out_path, dpi=_FRAME_DPI)  # tight 금지 — 프레임 크기 일정 유지
    plt.close(fig)
    return Path(out_path)


# ── GIF ─────────────────────────────────────────────────────


def render_gif(frame_paths, out_path, fps: float = 10) -> Path:
    """프레임 PNG 목록을 GIF 애니메이션으로 조립 (Pillow)."""
    if not frame_paths:
        raise ValueError("GIF 를 만들 프레임이 없다")
    out_path = Path(out_path)
    ims = [Image.open(p).convert("P", palette=Image.Palette.ADAPTIVE)
           for p in frame_paths]
    ims[0].save(out_path, save_all=True, append_images=ims[1:],
                duration=int(round(1000.0 / fps)), loop=0)
    for im in ims:
        im.close()
    return out_path


# ── 커버리지-시간 곡선 ──────────────────────────────────────


def curve_series(sim) -> dict:
    """곡선 데이터 {tier: (t 목록, pct 목록)} — 그림과 검증이 같은 값을 쓴다."""
    if not sim.curve:
        return {}
    tiers = list(sim.curve[0][1])
    ts = [t for t, _ in sim.curve]
    return {tier: (ts, [pct[tier] for _, pct in sim.curve]) for tier in tiers}


def render_curve(sim, out_path) -> Path:
    """등급별 커버리지-시간 곡선 PNG."""
    out_path = Path(out_path)
    targets = sim.cov.cfg.density_targets_mm if sim.cov is not None else {}
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    t_max = 1.0
    for tier, (ts, pcts) in sorted(curve_series(sim).items()):
        label = (f"{tier} (≤{targets[tier]:g}mm)" if tier in targets else tier)
        ax.plot(ts, pcts, lw=1.6, label=label)
        t_max = max(t_max, ts[-1])
    # 축 한계는 데이터에서 명시 — _setup_map_axes 와 같은 방침
    ax.set_xlim(0.0, t_max)
    ax.set_ylim(0.0, 100.0)
    ax.set_xlabel("시간 (s)")
    ax.set_ylabel("커버리지 (%)")
    ax.grid(alpha=0.3)
    if sim.curve:
        ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout(pad=0.4)
    fig.savefig(out_path, dpi=130)
    plt.close(fig)
    return out_path


# ── 최종 지도 ───────────────────────────────────────────────


def render_final_map(occ: OccupancyGrid, cov: CoverageGrid, out_path) -> Path:
    """최종 누적 커버리지 지도 PNG — 등급별 달성/미달/장애물 + 범례."""
    out_path = Path(out_path)
    cfg = cov.cfg
    fig, ax = plt.subplots(figsize=_map_figsize(occ))
    x0, x1, y0, y1 = _grid_extent(occ)
    ax.imshow(coverage_image(occ, cov), origin="lower",
              extent=(x0, x1, y0, y1), interpolation="nearest", zorder=1)
    _setup_map_axes(ax, occ)
    greens = tier_greens(cfg.density_targets_mm)
    handles = [
        Patch(facecolor=greens[tier],
              label=f"{tier} ≤{target:g}mm ({cov.coverage_pct(target):.1f}%)")
        for tier, target in sorted(cfg.density_targets_mm.items(),
                                   key=lambda kv: kv[1])
    ]
    handles.append(Patch(facecolor=COL_UNCOVERED, label="미달·미관측"))
    handles.append(Patch(facecolor=COL_OBSTACLE, label="장애물"))
    ax.legend(handles=handles, loc="upper right", fontsize=7, framealpha=0.9)
    ax.set_title("최종 커버리지 지도", fontsize=10)
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path

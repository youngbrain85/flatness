# -*- coding: utf-8 -*-
"""스캔 커버리지 평가 보고서 — 덤프 → 계획·시뮬 → 전 형식 산출물 + PDF (계획 Task 8).

bim/report/build.py 패턴 재사용: 컨텍스트 → jinja2 HTML → 워커 PlaywrightRenderer
PDF (렌더러 주입 — 테스트는 FakeRenderer). 숫자는 전부 플래너·시뮬레이터 결과에서
오며 템플릿은 계산하지 않는다 — 그림·표·본문이 서로 다른 계산을 하면 셋 중
하나가 틀린 것이기 때문이다.

시나리오 2개를 항상 병기한다 (스펙 §9-5): 도면의 가구 배치는 "점선표기 시설물은
미설치 대상"(1쪽 주기 19)일 수 있어 실제 입주 시 가구 유무가 도면으로 확정되지
않는다. 가구 배치(주 시나리오 — 프레임·GIF 포함) / 가구 미배치(수치 병기).

산출물 형식은 구속력이 있다 (스펙 §1.1): CSV(커버리지 시계열) · JSON(계획 +
상태 스트림) · PNG(계획 지도·최종 지도·곡선·프레임) · GIF(애니메이션) · PDF(보고서).
"""
from __future__ import annotations

import json
import math
from dataclasses import fields
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from scansim import render as render_mod  # 먼저 임포트 — Agg 백엔드·한글 폰트 설정
import matplotlib.pyplot as plt  # noqa: E402

from scansim.config import ScanConfig  # noqa: E402
from scansim.grid import OccupancyGrid  # noqa: E402
from scansim.planner_mobile import plan_mobile  # noqa: E402
from scansim.planner_tls import plan_tls  # noqa: E402
from scansim.simulate import simulate  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
TEMPLATES = Path(__file__).parent / "templates"
# 가구 스냅샷 기본값 — 도면 8쪽 추출 결과 (`python -m scansim.furniture` 재생성)
DEFAULT_FURNITURE = REPO / "scansim" / "tests" / "fixtures" / "furniture_lh26.json"

# 통행 대상이 아닌 실 — 벽체 점유 면적·설비 샤프트 (bim/report/assets.py 와 동일 기준)
NON_TRAVERSABLE = {"벽체공용", "PD"}

# ── 렌더 자원 모델 상수 (장비 파라미터 아님) ─────────────────
# GIF 로 조립할 프레임 수 상한 — 시뮬 프레임 수가 이보다 많으면 every_n 을
# 키워 솎는다. 프레임 1장 = matplotlib 그림 1장이라 렌더 시간의 지배 항이다.
MAX_GIF_FRAMES = 40
GIF_FPS = 10.0  # render.render_gif 기본값과 동일

# ScanConfig 필드 설명·근거 — "가정값" 표기는 config.py 주석과 일치 (스펙 §9-1)
CFG_DOC = {
    "cell_mm": ("격자 셀 한 변 (mm)", "스펙 §2"),
    "robot_radius_mm": ("로봇 반경 (mm)", "가정값"),
    "mobile_fov_deg": ("모바일 시야각 (°)", "가정값"),
    "mobile_range_mm": ("모바일 유효 사거리 (mm)", "가정값"),
    "mobile_speed_mms": ("주행 속도 (mm/s)", "가정값"),
    "mobile_scan_hz": ("모바일 스캔율 (Hz)", "가정값"),
    "mobile_angres_deg": ("모바일 각해상도 (°)", "가정값"),
    "tls_range_mm": ("TLS 유효 사거리 (mm)", "가정값"),
    "tls_angres_deg": ("TLS 각해상도 (°)", "가정값"),
    "tls_height_mm": ("TLS 센서(삼각대) 높이 (mm)", "가정값"),
    "tls_dwell_s": ("거치점당 체류 시간 (s)", "가정값"),
    "step_s": ("시뮬레이션 시간 스텝 (s)", "스펙 §6"),
}

TIER_DOC = {
    "mobile": "스크리닝급 — 주행 스캔 목표",
    "tls": "세부과업 1 해상도 요구 — 정밀 분석 입력",
}

MODE_LABEL = {"mobile": "② 모바일 (주행 스캔)", "tls": "③ TLS (거치 스캔)"}
SCENARIO_LABEL = {"furn": "가구 배치", "nofurn": "가구 미배치"}


def load_furniture(path) -> tuple[list, list]:
    """가구 스냅샷 JSON → (furniture, missing).

    스냅샷 형식 {"page_index", "furniture", "missing"} (Task 2 계약) 또는
    가구 dict 목록 그대로를 받는다.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return list(data.get("furniture") or []), list(data.get("missing") or [])
    return list(data), []


def make_grid(dump: dict, cfg: ScanConfig, furniture: list) -> OccupancyGrid:
    """덤프 spaces + 가구 장애물 → 점유격자. 통행 대상이 아닌 실은 뺀다."""
    free_rings = [sp["outline"] for sp in dump["spaces"]
                  if sp.get("outline") and sp["name"] not in NON_TRAVERSABLE]
    return OccupancyGrid.from_rings(
        free_rings, [f["rings"] for f in furniture], cfg.cell_mm)


# ── 보고서 전용 그림 (지도류 축 한계는 격자 범위에서 명시 —
#    add_patch/plot 은 autoscale 을 갱신하지 않아 한계가 기본값에 머문 채
#    저장하면 그림이 데이터 범위만큼 폭발해 MemoryError 가 난다.
#    bim/report/assets.py 에서 실제로 났던 교훈, render.py 와 같은 방침) ──

_FIG_W_IN = 5.6  # render.py 프레임 그림과 같은 폭 — 보고서에서 크기가 나란하다


def _map_figsize(occ: OccupancyGrid):
    ny, nx = occ.shape
    h = _FIG_W_IN * ny / nx
    return (_FIG_W_IN, min(max(h, 2.0), 9.0) + 0.5)


def _grid_extent(occ: OccupancyGrid):
    ny, nx = occ.shape
    ox, oy = occ.origin_xy
    return ox, ox + nx * occ.cell_mm, oy, oy + ny * occ.cell_mm


def _plan_map_axes(occ: OccupancyGrid):
    """자유=흰색 / 장애물·벽=회색 배경의 계획 지도 축."""
    import numpy as np
    fig, ax = plt.subplots(figsize=_map_figsize(occ))
    img = np.ones((*occ.shape, 3), dtype=float)
    img[~occ.free] = render_mod.COL_OBSTACLE
    x0, x1, y0, y1 = _grid_extent(occ)
    ax.imshow(img, origin="lower", extent=(x0, x1, y0, y1),
              interpolation="nearest", zorder=1)
    ax.set_xlim(x0, x1)
    ax.set_ylim(y0, y1)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    return fig, ax


def render_plan_map(occ: OccupancyGrid, plan, mode: str, out_path) -> Path:
    """계획 지도 PNG — 모바일: 경로 폴리라인 / TLS: 순회 경로 + 번호 거치점."""
    out_path = Path(out_path)
    fig, ax = _plan_map_axes(occ)
    if mode == "mobile":
        pts = plan.waypoints_mm
        if pts:
            ax.plot([p[0] for p in pts], [p[1] for p in pts],
                    color=render_mod.COL_TRAJ, lw=0.9, zorder=3)
            ax.plot(pts[0][0], pts[0][1], marker="o", ms=5,
                    color=render_mod.COL_ROBOT, zorder=4)
        ax.set_title("모바일 계획 경로", fontsize=10)
    else:
        for seg in plan.tour_paths:
            ax.plot([p[0] for p in seg], [p[1] for p in seg],
                    color=render_mod.COL_TRAJ, lw=0.9, zorder=3)
        for visit, idx in enumerate(plan.tour_order, start=1):
            x, y = plan.stations_mm[idx]
            ax.plot(x, y, marker="o", ms=7, color=render_mod.COL_FAN, zorder=4)
            ax.annotate(str(visit), (x, y), ha="center", va="center",
                        fontsize=6, color="white", zorder=5)
        ax.set_title("TLS 거치점 배치·순회 (번호 = 방문 순서)", fontsize=10)
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def render_tradeoff(tradeoff, out_path) -> Path:
    """거치점 수 vs 계획 커버리지 트레이드오프 곡선 PNG (스펙 §5)."""
    out_path = Path(out_path)
    ns = [n for n, _ in tradeoff]
    ps = [p for _, p in tradeoff]
    fig, ax = plt.subplots(figsize=(4.8, 3.0))
    ax.plot(ns, ps, marker="o", lw=1.6, color=render_mod.COL_FAN)
    # 축 한계 명시 — 지도류와 같은 방침
    ax.set_xlim(0, max(ns) + 1)
    ax.set_ylim(0.0, 100.0)
    ax.set_xticks(ns)
    ax.set_xlabel("거치점 수")
    ax.set_ylabel("계획 커버리지 (%)")
    ax.grid(alpha=0.3)
    fig.tight_layout(pad=0.4)
    fig.savefig(out_path, dpi=130)
    plt.close(fig)
    return out_path


# ── 시나리오 실행 ───────────────────────────────────────────


def _fmt_time(sec: float) -> str:
    return f"{sec:.1f} s ({sec / 60.0:.1f}분)"


def _run_mode(occ: OccupancyGrid, cfg: ScanConfig, mode: str, key: str,
              out_dir: Path, assets: Path, with_gif: bool) -> dict:
    """한 모드 파이프라인: 계획 → 시뮬 → CSV·JSON·PNG(·GIF). 반환 = 템플릿 컨텍스트."""
    if mode == "mobile":
        plan = plan_mobile(occ, cfg)
        length_mm = plan.path_len_mm
        n_stations = None
        tradeoff = []
        plan_data = {
            "mode": mode,
            "waypoints_mm": [[float(x), float(y)] for x, y in plan.waypoints_mm],
            "path_len_mm": float(plan.path_len_mm),
            "est_time_s": float(plan.est_time_s),
            "notes": list(plan.notes),
        }
    elif mode == "tls":
        plan = plan_tls(occ, cfg)
        length_mm = plan.travel_len_mm
        n_stations = len(plan.stations_mm)
        tradeoff = [(int(n), float(p)) for n, p in plan.tradeoff]
        plan_data = {
            "mode": mode,
            "stations_mm": [[float(x), float(y)] for x, y in plan.stations_mm],
            "tour_order": [int(i) for i in plan.tour_order],
            "travel_len_mm": float(plan.travel_len_mm),
            "est_time_s": float(plan.est_time_s),
            "tradeoff": tradeoff,
            "notes": list(plan.notes),
        }
    else:
        raise ValueError(f"알 수 없는 모드: {mode!r}")

    sim = simulate(occ, plan, cfg, mode)

    # 데이터 산출물 — CSV(시계열)·JSON(상태 스트림·계획)
    sim.to_csv(out_dir / f"{key}_coverage.csv")
    sim.to_json(out_dir / f"{key}_state.json")
    (out_dir / f"{key}_plan.json").write_text(
        json.dumps(plan_data, ensure_ascii=False, indent=1), encoding="utf-8")

    # 그림 산출물 — 계획 지도·최종 지도·곡선(·트레이드오프)
    plan_png = render_plan_map(occ, plan, mode, assets / f"{key}_plan.png")
    final_png = render_mod.render_final_map(occ, sim.cov, assets / f"{key}_final.png")
    curve_png = render_mod.render_curve(sim, assets / f"{key}_curve.png")
    trade_png = (render_tradeoff(tradeoff, assets / f"{key}_tradeoff.png")
                 if tradeoff else None)

    # 프레임 PNG + GIF (주 시나리오만 — 렌더 시간의 지배 항이라 병기 시나리오는
    # 수치·지도만 낸다. 형식 요구(스펙 §1.1)는 주 시나리오 산출물이 채운다)
    gif_name = None
    if with_gif and sim.frames:
        every_n = max(1, math.ceil(len(sim.frames) / MAX_GIF_FRAMES))
        frame_paths = render_mod.render_frames(
            occ, sim, assets / f"{key}_frames", every_n=every_n)
        gif_name = render_mod.render_gif(
            frame_paths, assets / f"{key}.gif", fps=GIF_FPS).name

    coverage = [
        {"tier": tier, "target": f"{target:g}",
         "pct": f"{sim.cov.coverage_pct(target):.1f}"}
        for tier, target in sorted(cfg.density_targets_mm.items(),
                                   key=lambda kv: kv[1])
    ]
    files = [f"{key}_coverage.csv", f"{key}_state.json", f"{key}_plan.json"]
    if gif_name:
        files.append(f"assets/{gif_name}")
    return {
        "mode": mode,
        "key": key,
        "label": MODE_LABEL[mode],
        "length_m": f"{length_mm / 1000.0:.2f}",
        "sim_dist_m": f"{sim.total_dist_mm / 1000.0:.2f}",
        "est_time": _fmt_time(plan.est_time_s),
        "sim_time": _fmt_time(sim.total_time_s),
        "n_stations": n_stations,
        "coverage": coverage,
        "coverage_text": " · ".join(
            f"{c['tier']} ≤{c['target']}mm {c['pct']}%" for c in coverage),
        "tradeoff": [{"n": n, "pct": f"{p:.1f}"} for n, p in tradeoff],
        "notes": list(plan.notes),
        "files": files,
        "assets": {"plan": plan_png.name, "final": final_png.name,
                   "curve": curve_png.name, "gif": gif_name,
                   "tradeoff": trade_png.name if trade_png else None},
    }


def run_scenario(dump: dict, cfg: ScanConfig, furniture: list, key: str,
                 out_dir: Path, assets: Path, modes, with_gif: bool) -> dict:
    occ = make_grid(dump, cfg, furniture)
    cell_m2 = (cfg.cell_mm / 1000.0) ** 2
    n_free = int(occ.free.sum())
    return {
        "key": key,
        "label": SCENARIO_LABEL[key],
        "n_furniture": len(furniture),
        "free_cells": n_free,
        "free_m2": f"{n_free * cell_m2:.2f}",
        "modes": [_run_mode(occ, cfg, mode, f"{mode}_{key}", out_dir, assets,
                            with_gif) for mode in modes],
    }


# ── 컨텍스트 → HTML → PDF ──────────────────────────────────


def build_context(dump: dict, cfg: ScanConfig, scenarios: list,
                  missing: list) -> dict:
    drawing = dump.get("drawing") or {}
    cfg_rows = []
    for f in fields(ScanConfig):
        if f.name == "density_targets_mm":
            continue  # 밀도 목표는 별도 표
        desc, basis = CFG_DOC.get(f.name, (f.name, "미기재"))
        cfg_rows.append({"name": f.name, "value": f"{getattr(cfg, f.name):g}",
                         "desc": desc, "assumed": basis == "가정값",
                         "basis": basis})
    targets = [
        {"tier": tier, "target": f"{target:g}", "desc": TIER_DOC.get(tier, "—")}
        for tier, target in sorted(cfg.density_targets_mm.items(),
                                   key=lambda kv: kv[1])
    ]
    dist_rows = [
        {"scenario": scen["label"], **m}
        for scen in scenarios for m in scen["modes"]
    ]
    limits = [
        "장비 파라미터(시야각·사거리·각해상도·스캔율·체류시간·로봇 반경 등)의 "
        "기본값은 모델 파라미터(가정값)이며 특정 장비의 공표 사양이 아니다. "
        "실제 장비 확정 시 설정 데이터(ScanConfig)만 교체한다.",
        "가구 장애물은 도면 8쪽에서 추출했고, 실 경계(0.003%)처럼 수치로 검증할 "
        "정답(가구 면적표)이 도면에 없다 — 육안 대조 PNG·스냅샷 고정으로 갈음한다.",
        "TLS 거치점 배치의 greedy set cover 는 최적해를 보장하지 않는다 — "
        "set cover 는 NP-hard 이며 greedy 근사비는 ln n 이다.",
        "도면의 가구 배치는 \"점선표기 시설물은 미설치 대상\"(1쪽 주기 19)일 수 "
        "있어 실제 입주 시 가구 유무가 도면으로 확정되지 않는다 — 이 보고서는 "
        "가구 배치/미배치 두 시나리오 수치를 병기한다.",
        "주행은 등속 모델이다 — 회전·가감속을 모형하지 않으므로 운행 거리·소요"
        "시간은 하한 추정이다.",
        "문 개폐·단차 통과 여부는 이 모듈이 모델하지 않는다 — 로봇 반경 팽창 "
        "자유공간이 분리되면 최대 성분만 계획하고 잔여는 산출 기록으로 보고한다.",
        "미상·미커버는 커버로 접지 않는다 — 커버리지는 목표 점간격 이하로 실제 "
        "관측된 셀만 센다 (세부과업 2와 같은 원칙).",
    ]
    return {
        "title": "스캔 커버리지 계획·시뮬레이션 평가 보고서 — "
                 + (drawing.get("doc_key") or "무제 덤프"),
        "drawing": drawing,
        "cfg_rows": cfg_rows,
        "targets": targets,
        "scenarios": scenarios,
        "primary": scenarios[0],
        "dist_rows": dist_rows,
        "missing": missing,
        "limits": limits,
    }


def render_html(ctx: dict) -> str:
    env = Environment(loader=FileSystemLoader(str(TEMPLATES)),
                      autoescape=select_autoescape(["html"]),
                      trim_blocks=True, lstrip_blocks=True)
    return env.get_template("scan_report.html.j2").render(ctx=ctx)


def build(dump_path, out_dir, cfg: ScanConfig | None = None,
          furniture_path=None, renderer=None,
          modes=("mobile", "tls")) -> Path:
    """전체 파이프라인: 덤프 → 시나리오 2개 × 모드 → 산출물 + 평가 PDF."""
    cfg = cfg or ScanConfig()
    dump = json.loads(Path(dump_path).read_text(encoding="utf-8"))
    furniture, missing = load_furniture(furniture_path or DEFAULT_FURNITURE)

    out_dir = Path(out_dir)
    assets = out_dir / "assets"
    assets.mkdir(parents=True, exist_ok=True)

    scenarios = [
        # 주 시나리오(가구 배치) — 프레임·GIF 포함. 병기 시나리오는 수치·지도만.
        run_scenario(dump, cfg, furniture, "furn", out_dir, assets, modes,
                     with_gif=True),
        run_scenario(dump, cfg, [], "nofurn", out_dir, assets, modes,
                     with_gif=False),
    ]

    html = render_html(build_context(dump, cfg, scenarios, missing))
    pdf = out_dir / "scan_report.pdf"
    if renderer is None:
        from flatworker.report.renderer import PlaywrightRenderer
        renderer = PlaywrightRenderer(html_filename="scan_report.html")
    renderer.render_pdf(html, out_dir, pdf)
    return pdf

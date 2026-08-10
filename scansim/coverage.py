# -*- coding: utf-8 -*-
"""커버리지 격자(CoverageGrid): 가시성 + 점 간격(밀도) 모델.

셀마다 추정 점 간격(mm)을 누적한다 — 작을수록 촘촘, inf = 미관측.
"커버"의 기준은 면적이 아니라 점 밀도다 (스펙 §3). 같은 셀을 여러 번 보면
최소 점 간격(가장 촘촘한 관측)을 취한다.

점 간격 모델 (스펙 §3 — 파라미터는 전부 ScanConfig, 코드 매직넘버 금지):
- 모바일(부채꼴):  max(거리 × 각해상도, 주행속도 ÷ 스캔율)
- TLS(전방위):    거리 × 각해상도 ÷ cos(입사각), 입사각 = atan(거리/센서높이)
  바닥 스캔이라 멀수록 입사각이 얕아져(스침각) 간격이 벌어진다.

가려짐(occlusion): 거치/로봇 위치에서 셀 중심까지 시선을 반셀 간격으로
표본화해 전 표본이 자유 셀일 때만 관측으로 친다 (점유격자 레이캐스트와
같은 원리 — 벡터화를 위해 표본화 방식 사용).
"""
from __future__ import annotations

import math

import numpy as np

from scansim.config import ScanConfig
from scansim.grid import OccupancyGrid

# 계획 문서 Task 3: cos(입사각) 하한 — 스침각에서 간격 발산을 막는 수치
# 가드다 (장비 파라미터가 아니므로 ScanConfig 가 아니라 모델 상수).
COS_INCIDENCE_FLOOR = 0.05

# 가시성 검사 시 한 번에 처리할 대상 셀 수 — 메모리 상한용 (동작 불변)
_RAY_CHUNK = 4096


class CoverageGrid:
    """점유격자 위 커버리지 누적. spacing_mm[iy, ix] = 추정 점 간격(mm)."""

    def __init__(self, occ: OccupancyGrid, cfg: ScanConfig):
        self.occ = occ
        self.cfg = cfg
        self.spacing_mm = np.full(occ.shape, np.inf, dtype=float)

    # ── 관측 ────────────────────────────────────────────────

    def observe_fan(self, x, y, heading_deg, cfg: ScanConfig | None = None):
        """모바일 부채꼴 관측 (heading 중심 ±FOV/2, 레이캐스트 차폐).

        spacing = max(거리 × 각해상도, 주행속도 ÷ 스캔율).
        반환: 이번 관측의 spacing 장 (ny, nx), inf = 이번에 안 보임.
        """
        cfg = self.cfg if cfg is None else cfg
        angres_rad = math.radians(cfg.mobile_angres_deg)
        floor = cfg.mobile_speed_mms / cfg.mobile_scan_hz

        def spacing_fn(dist):
            return np.maximum(dist * angres_rad, floor)

        return self._observe(
            x, y, cfg.mobile_range_mm, spacing_fn,
            heading_deg=heading_deg, fov_deg=cfg.mobile_fov_deg,
        )

    def observe_station(self, x, y, cfg: ScanConfig | None = None):
        """TLS 거치점 관측 (전방위, 레이캐스트 차폐).

        spacing = 거리 × 각해상도 ÷ max(cos(입사각), 하한),
        입사각 = atan(거리/센서높이) — 바닥 스캔이라 멀수록 얕아진다.
        반환: 이번 관측의 spacing 장 (ny, nx), inf = 이번에 안 보임.
        """
        cfg = self.cfg if cfg is None else cfg
        angres_rad = math.radians(cfg.tls_angres_deg)
        height = cfg.tls_height_mm

        def spacing_fn(dist):
            cos_inc = np.cos(np.arctan2(dist, height))
            return dist * angres_rad / np.maximum(cos_inc, COS_INCIDENCE_FLOOR)

        return self._observe(x, y, cfg.tls_range_mm, spacing_fn)

    # ── 집계 ────────────────────────────────────────────────

    def coverage_pct(self, target_mm) -> float:
        """자유 셀 중 spacing ≤ target 인 비율 (퍼센트, 0~100)."""
        free = self.occ.free
        n_free = int(free.sum())
        if n_free == 0:
            return 0.0
        covered = int((self.spacing_mm[free] <= target_mm).sum())
        return 100.0 * covered / n_free

    def uncovered_cells(self, target_mm):
        """목표 미달(spacing > target, 미관측 포함)인 자유 셀 (ix, iy) 목록."""
        miss = self.occ.free & ~(self.spacing_mm <= target_mm)
        iy, ix = np.nonzero(miss)
        return list(zip(ix.tolist(), iy.tolist()))

    # ── 내부 ────────────────────────────────────────────────

    def _observe(self, x, y, range_mm, spacing_fn, heading_deg=None, fov_deg=None):
        """사거리 원(및 부채꼴) 안 자유 셀에 가시성 검사 후 spacing 을 적는다."""
        occ = self.occ
        ny, nx = occ.shape
        cell = occ.cell_mm
        ox, oy = occ.origin_xy
        obs = np.full((ny, nx), np.inf, dtype=float)

        # 후보 bbox — 사거리 원을 덮는 셀 범위 (클램프 없이 계산 후 잘라낸다)
        sx = int(math.floor((x - ox) / cell))
        sy = int(math.floor((y - oy) / cell))
        r_cells = int(math.ceil(range_mm / cell)) + 1
        xlo, xhi = max(0, sx - r_cells), min(nx, sx + r_cells + 1)
        ylo, yhi = max(0, sy - r_cells), min(ny, sy + r_cells + 1)
        if xlo >= xhi or ylo >= yhi:
            return obs

        iyy, ixx = np.mgrid[ylo:yhi, xlo:xhi]
        cx = ox + (ixx + 0.5) * cell
        cy = oy + (iyy + 0.5) * cell
        dx = cx - x
        dy = cy - y
        dist = np.hypot(dx, dy)
        mask = (dist <= range_mm) & occ.free[ylo:yhi, xlo:xhi]
        if fov_deg is not None:
            ang = np.degrees(np.arctan2(dy, dx))
            diff = (ang - heading_deg + 180.0) % 360.0 - 180.0
            mask &= np.abs(diff) <= fov_deg / 2.0 + 1e-9

        t_ix = ixx[mask]
        if t_ix.size == 0:
            return obs
        t_iy = iyy[mask]
        t_x = cx[mask]
        t_y = cy[mask]
        t_d = dist[mask]

        vis = self._visible(x, y, t_x, t_y)
        obs[t_iy[vis], t_ix[vis]] = spacing_fn(t_d[vis])
        np.minimum(self.spacing_mm, obs, out=self.spacing_mm)  # 최소 간격 누적
        return obs

    def _visible(self, x, y, tx, ty):
        """(x,y)→각 대상점 시선을 반셀 간격 표본으로 검사. True=시선 트임."""
        occ = self.occ
        cell = occ.cell_mm
        ox, oy = occ.origin_xy
        ny, nx = occ.shape
        n = tx.size
        out = np.zeros(n, dtype=bool)
        for s in range(0, n, _RAY_CHUNK):
            e = min(n, s + _RAY_CHUNK)
            cx = tx[s:e]
            cy = ty[s:e]
            d_max = float(np.hypot(cx - x, cy - y).max())
            steps = max(2, int(math.ceil(d_max / (cell * 0.5))) + 1)
            t = np.linspace(0.0, 1.0, steps)  # 양 끝 포함
            px = x + (cx[:, None] - x) * t[None, :]
            py = y + (cy[:, None] - y) * t[None, :]
            ix = np.clip(np.floor((px - ox) / cell).astype(np.int64), 0, nx - 1)
            iy = np.clip(np.floor((py - oy) / cell).astype(np.int64), 0, ny - 1)
            out[s:e] = occ.free[iy, ix].all(axis=1)
        return out

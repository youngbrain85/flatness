"""구역화 — 레벨 밴드 → 연결요소 → 구역별 로버스트 평면 잔차 (스펙 §5.1.3~4).

구역(연결요소)이 바닥의 실체다: 결함 구역이 RANSAC 인라이어에서 빠져
측정에서 제외되는 선택 편향을 구역 단위 처리로 회피한다.
"""
from dataclasses import dataclass
import numpy as np
from scipy import ndimage
from flatness.core.plane import fit_plane_ransac


@dataclass
class ZoneInfo:
    zone_id: int
    level_m: float
    n_subcells: int
    area_m2: float
    status: str
    plane_abc: tuple | None


@dataclass
class ZoneMap:
    labels: np.ndarray
    zones: list


def build_zones(grid, levels, band_m=0.05, min_area_m2=1.0,
                furniture_gap_m=0.3, furniture_max_m2=3.0, ghost_frac=0.2):
    mz = grid.median_z
    labels = np.zeros(mz.shape, dtype=np.int32)
    zones = []
    next_id = 1
    sub_area = grid.size_m * grid.size_m
    for level in levels:
        mask = (np.abs(mz - level) <= band_m) & (labels == 0)
        lab, n = ndimage.label(mask)
        for comp in range(1, n + 1):
            m = lab == comp
            n_sub = int(m.sum())
            if n_sub * sub_area < min_area_m2:
                continue  # 최소 면적 미달 파편 배제
            labels[m] = next_id
            zones.append(ZoneInfo(next_id, float(level), n_sub, n_sub * sub_area, "ok", None))
            next_id += 1
    residuals = np.full(mz.shape, np.nan, dtype=np.float32)
    if not zones:
        return ZoneMap(labels, zones), residuals
    main = max(zones, key=lambda z: z.area_m2)  # 주 레벨 = 최대 면적 구역
    for z in zones:
        m = labels == z.zone_id
        if z.zone_id != main.zone_id and z.level_m > main.level_m + furniture_gap_m \
                and z.area_m2 <= furniture_max_m2:
            z.status = "furniture"  # 가구 상판 의심: 판정 제외 (스펙 §5.1.3)
            continue
        if float(grid.bimodal[m].mean()) > ghost_frac:
            z.status = "ghost"      # 구역 대부분이 이중층: 재스캔 필요
            continue
        ys, xs = np.nonzero(m)
        # 구역 로컬 좌표로 피팅(대좌표 조건수 문제 회피 — origin 무관)
        cx = (xs + 0.5) * grid.size_m
        cy = (ys + 0.5) * grid.size_m
        a, b, c = fit_plane_ransac(cx, cy, mz[ys, xs].astype(float))
        z.plane_abc = (a, b, c)
        residuals[ys, xs] = (mz[ys, xs] - (a * cx + b * cy + c)).astype(np.float32)
    residuals[grid.bimodal] = np.nan  # 쌍봉 서브셀은 어느 구역이든 판정 제외
    return ZoneMap(labels, zones), residuals

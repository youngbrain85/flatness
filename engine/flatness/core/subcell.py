"""서브셀 비닝 — 점 단위 노이즈 극값이 판정을 지배하지 않도록 셀 중앙값 사용(스펙 §5.1.5).

1a 구현 메모: 청크별 (셀번호, z)를 모아 정렬 후 그룹 중앙값을 구한다.
점당 int64 인덱스+float32 z ≈ 12바이트로 3천만 점 ≈ 360MB — 1d 메모리 검증에서 재평가.
"""
from dataclasses import dataclass
import numpy as np


@dataclass
class SubcellGrid:
    size_m: float
    origin: np.ndarray
    shape: tuple
    median_z: np.ndarray
    counts: np.ndarray


def build_subcell_grid(chunks, info, scale_to_m, subcell_m=0.05):
    lo = info.bbox_min * scale_to_m
    hi = info.bbox_max * scale_to_m
    nx = max(1, int(np.ceil((hi[0] - lo[0]) / subcell_m)))
    ny = max(1, int(np.ceil((hi[1] - lo[1]) / subcell_m)))
    # 대좌표 정밀도: float64로 센터링(bbox_min 차감)한 뒤 float32 저장.
    # P1a의 즉시 float32 캐스트는 UTM급 좌표에서 ulp 3~50cm 지터를 유발해 개정됨.
    idx_parts, z_parts = [], []
    for c in chunks:
        p = c.astype(np.float64) * scale_to_m
        rel_x = p[:, 0] - lo[0]
        rel_y = p[:, 1] - lo[1]
        ix = np.clip((rel_x / subcell_m).astype(np.int32), 0, nx - 1)
        iy = np.clip((rel_y / subcell_m).astype(np.int32), 0, ny - 1)
        idx_parts.append(iy.astype(np.int64) * nx + ix)
        z_parts.append((p[:, 2] - lo[2]).astype(np.float32))  # 상대 높이 저장
    idx = np.concatenate(idx_parts)
    z = np.concatenate(z_parts)
    order = np.argsort(idx, kind="stable")
    idx, z = idx[order], z[order]
    starts = np.flatnonzero(np.r_[True, np.diff(idx) > 0])
    ends = np.r_[starts[1:], len(idx)]
    median_z = np.full(ny * nx, np.nan, dtype=np.float32)
    counts = np.zeros(ny * nx, dtype=np.int32)
    for s, e in zip(starts, ends):
        seg = np.sort(z[s:e])
        k = len(seg)
        median_z[idx[s]] = seg[(k - 1) // 2] if k % 2 else 0.5 * (seg[k // 2 - 1] + seg[k // 2])
        counts[idx[s]] = k
    return SubcellGrid(size_m=subcell_m, origin=lo[:2].copy(), shape=(ny, nx),
                       median_z=median_z.reshape(ny, nx), counts=counts.reshape(ny, nx))

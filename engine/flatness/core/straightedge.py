"""직선자 시뮬레이션 — 상부 볼록 포락선(모노톤 체인) 아래 최대 틈새.

실물 3m 직선자는 표면 고점에 '얹혀' 지지되므로 기준선은 상부 볼록 껍질이다.
LSQ 평면은 데이터 중앙을 관통해 파형 결함을 절반으로 축소한다(스펙 §5.1.6 금지).
"""
import numpy as np


def _upper_hull_indices(x, z):
    # 모노톤 체인 상부 껍질 — x 오름차순 전제
    hull = []
    for i in range(len(x)):
        while len(hull) >= 2:
            (x1, z1), (x2, z2) = (x[hull[-2]], z[hull[-2]]), (x[hull[-1]], z[hull[-1]])
            # (x2,z2)가 (x1,z1)-(x[i],z[i]) 선분 아래(외적 ≥ 0)면 제거
            if (x2 - x1) * (z[i] - z1) - (z2 - z1) * (x[i] - x1) >= 0:
                hull.pop()
            else:
                break
        hull.append(i)
    return hull


def max_gap_under_straightedge(x, z):
    x = np.asarray(x, dtype=np.float64)
    z = np.asarray(z, dtype=np.float64)
    if len(x) < 2:
        return 0.0, 0
    hi = _upper_hull_indices(x, z)
    envelope = np.interp(x, x[hi], z[hi])
    gaps = envelope - z
    i = int(np.argmax(gaps))
    return float(gaps[i]), i

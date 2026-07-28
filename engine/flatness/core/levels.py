"""높이 히스토그램 기반 바닥 레벨 검출 — 다중 레벨(단차·중층) 바닥 대응 (스펙 §5.1.3)."""
import numpy as np


def detect_levels(median_z, bin_m=0.01, min_frac=0.03, merge_m=0.05):
    vals = median_z[~np.isnan(median_z)].astype(np.float64)
    if vals.size == 0:
        return []
    lo = float(vals.min())
    nbins = max(1, int(np.ceil((float(vals.max()) - lo) / bin_m)) + 1)
    hist, edges = np.histogram(vals, bins=nbins, range=(lo, lo + nbins * bin_m))
    thresh = max(3, int(min_frac * vals.size))
    peaks = []
    for i in range(len(hist)):
        left = hist[i - 1] if i > 0 else 0
        right = hist[i + 1] if i < len(hist) - 1 else 0
        if hist[i] >= thresh and hist[i] >= left and hist[i] >= right:
            peaks.append(0.5 * (edges[i] + edges[i + 1]))
    merged = []  # merge_m 이내로 붙은 피크는 하나의 레벨로 병합
    for p in peaks:
        if merged and p - merged[-1] < merge_m:
            merged[-1] = 0.5 * (merged[-1] + p)
        else:
            merged.append(p)
    return merged

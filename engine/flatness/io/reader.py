"""포맷 디스패치 + 1차 패스(개수·bbox) 스캔."""
from dataclasses import dataclass
from pathlib import Path
import numpy as np
from flatness.io.ply_reader import read_ply_chunks
from flatness.io.las_reader import read_las_chunks

_READERS = {".ply": read_ply_chunks, ".las": read_las_chunks, ".laz": read_las_chunks}


@dataclass
class CloudInfo:
    n_points: int
    bbox_min: np.ndarray
    bbox_max: np.ndarray


def iter_chunks(path, chunk_size=2_000_000):
    ext = Path(path).suffix.lower()
    if ext not in _READERS:
        raise ValueError(f"지원하지 않는 확장자: {ext} (지원: {sorted(_READERS)})")
    yield from _READERS[ext](path, chunk_size=chunk_size)


def read_info(path, chunk_size=2_000_000):
    n, lo, hi = 0, None, None
    for c in iter_chunks(path, chunk_size=chunk_size):
        n += len(c)
        cmin, cmax = c.min(axis=0).astype(np.float64), c.max(axis=0).astype(np.float64)
        lo = cmin if lo is None else np.minimum(lo, cmin)
        hi = cmax if hi is None else np.maximum(hi, cmax)
    if n == 0:
        raise ValueError("점이 없는 파일")
    return CloudInfo(n_points=n, bbox_min=lo, bbox_max=hi)

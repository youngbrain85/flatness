"""PLY 쓰기 — 병합 산출물 저장(스펙 §6.3). float32 binary little-endian, x y z만.

포맷은 flatness.io.ply_reader가 그대로 읽을 수 있는 최소 형태로 고정한다.
big-endian은 리더가 거부하므로 쓰지 않는다.
"""
import numpy as np

_HEADER = ("ply\n"
           "format binary_little_endian 1.0\n"
           "element vertex {n}\n"
           "property float x\n"
           "property float y\n"
           "property float z\n"
           "end_header\n")


def write_ply(points, path):
    pts = np.asarray(points, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError("(N,3) 배열이어야 합니다")
    if len(pts) == 0:
        raise ValueError("점이 없어 PLY를 쓸 수 없습니다")
    with open(path, "wb") as f:
        f.write(_HEADER.format(n=len(pts)).encode("ascii"))
        f.write(np.ascontiguousarray(pts, dtype="<f4").tobytes())

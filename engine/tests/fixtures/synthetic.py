"""합성 점군 생성기 — 정답을 아는 결함을 주입해 엔진을 정량 검증한다."""
import numpy as np


def flat_floor(size=(6.0, 6.0), spacing=0.02, noise_sd=0.0, tilt=(0.0, 0.0), seed=0):
    """평탄 바닥 점군 (n,3) float64[m]. tilt=(sx,sy)는 기울기(무차원)."""
    rng = np.random.default_rng(seed)
    xs = np.arange(0.0, size[0] + spacing / 2, spacing)
    ys = np.arange(0.0, size[1] + spacing / 2, spacing)
    gx, gy = np.meshgrid(xs, ys)
    z = tilt[0] * gx + tilt[1] * gy
    if noise_sd > 0:
        z = z + rng.normal(0.0, noise_sd, z.shape)
    return np.column_stack([gx.ravel(), gy.ravel(), z.ravel()])


def flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0, axis='x', noise_sd=0.0, seed=0):
    """수직 벽 점군. axis='x': x가 벽 방향·y=y0(법선 y), axis='y': y가 벽 방향·x=y0."""
    rng = np.random.default_rng(seed)
    us = np.arange(0.0, length + spacing / 2, spacing)
    vs = np.arange(0.0, height + spacing / 2, spacing)
    gu, gv = np.meshgrid(us, vs)
    off = rng.normal(0.0, noise_sd, gu.shape) if noise_sd > 0 else np.zeros_like(gu)
    if axis == 'x':
        return np.column_stack([gu.ravel(), (y0 + off).ravel(), gv.ravel()])
    return np.column_stack([(y0 + off).ravel(), gu.ravel(), gv.ravel()])


def add_bump(pts, center, radius, height):
    """코사인 범프 — 정점 높이가 정확히 height. + = 융기."""
    out = pts.copy()
    r = np.hypot(out[:, 0] - center[0], out[:, 1] - center[1])
    m = r < radius
    out[m, 2] += height * 0.5 * (1.0 + np.cos(np.pi * r[m] / radius))
    return out


def add_step(pts, x_split, height):
    """x >= x_split 영역을 height만큼 올린 단차."""
    out = pts.copy()
    out[out[:, 0] >= x_split, 2] += height
    return out


def _ply_header(n, fmt):
    return (f"ply\nformat {fmt} 1.0\nelement vertex {n}\n"
            "property float x\nproperty float y\nproperty float z\nend_header\n")


def write_ascii_ply(pts, path):
    with open(path, "w", newline="\n") as f:
        f.write(_ply_header(len(pts), "ascii"))
        for x, y, z in pts:
            f.write(f"{x} {y} {z}\n")


def write_binary_ply(pts, path):
    with open(path, "wb") as f:
        f.write(_ply_header(len(pts), "binary_little_endian").encode())
        f.write(pts.astype("<f4").tobytes())


def write_las(pts, path):
    import laspy
    header = laspy.LasHeader(point_format=0, version="1.2")
    header.scales = np.array([0.0001, 0.0001, 0.0001])
    header.offsets = pts.min(axis=0)
    las = laspy.LasData(header)
    las.x, las.y, las.z = pts[:, 0], pts[:, 1], pts[:, 2]
    las.write(str(path))

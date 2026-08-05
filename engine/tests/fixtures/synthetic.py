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


def bumpy_surface_z(xy_x, xy_y, size=(8.0, 6.0), n_bumps=None, seed=0):
    """무작위 범프 높이장 z(x,y). 임의 좌표에서 평가할 수 있어야 두 스캔이
    **같은 표면을 서로 다른 점으로** 샘플링할 수 있다(현실 조건)."""
    rng = np.random.default_rng(seed)
    if n_bumps is None:
        n_bumps = max(8, int(0.3 * size[0] * size[1]))
    z = np.zeros(np.shape(xy_x), dtype=np.float64)
    for _ in range(n_bumps):
        cx = rng.uniform(0.12, 0.88) * size[0]
        cy = rng.uniform(0.12, 0.88) * size[1]
        sx = rng.uniform(0.18, 0.55)
        sy = rng.uniform(0.18, 0.55)
        amp = rng.uniform(0.012, 0.035) * (1.0 if rng.random() < 0.5 else -1.0)
        z += amp * np.exp(-(((xy_x - cx) / sx) ** 2 + ((xy_y - cy) / sy) ** 2))
    return z


def bumpy_floor(size=(8.0, 6.0), spacing=0.05, n_bumps=None, seed=0,
                sample_jitter=0.0, sample_seed=None):
    """무작위 범프를 얹은 바닥 (n,3) float64[m] — 정합 테스트 전용 픽스처.

    완전 평면을 쓰면 안 된다. 수평 평면은 면내 2자유도와 yaw에 대해 구조적으로
    퇴화해서(설계 결정 F1) 픽스처 자체가 변이를 못 잡는 상태가 된다. 이 단계에서만
    그 함정을 네 번 겪었다. 그래서 폭·높이·부호·위치가 전부 무작위인 이방성
    가우시안 범프를 얹어 **면내 특징**을 준다.

    의도적으로 피한 것: 대칭 배치, 정사각 격자(기본 size가 8x6), bbox 기하 중심
    (범프 중심을 12~88% 구간에서 뽑고 sx!=sy로 회전 대칭도 깬다).
    범프 밀도는 면적에 비례시켜 크기를 바꿔도 특징 밀도가 유지되게 한다.

    `sample_jitter`>0이면 표본 위치를 흩뿌린다. 표면(`seed`)은 그대로 두고
    `sample_seed`만 바꾸면 **같은 바닥을 다른 점으로 스캔한** 두 점군이 나온다.
    정합 테스트에서 두 점군의 점이 1:1로 동일하면 최근접점 탐색이 '같은 점'을
    찾아버려 정합이 실제보다 훨씬 쉬워진다 — 그 교락을 없애는 용도다.
    """
    xs = np.arange(0.0, size[0] + spacing / 2, spacing)
    ys = np.arange(0.0, size[1] + spacing / 2, spacing)
    gx, gy = np.meshgrid(xs, ys)
    if sample_jitter > 0:
        srng = np.random.default_rng(seed if sample_seed is None else sample_seed)
        gx = gx + srng.uniform(-sample_jitter, sample_jitter, gx.shape)
        gy = gy + srng.uniform(-sample_jitter, sample_jitter, gy.shape)
    z = bumpy_surface_z(gx, gy, size=size, n_bumps=n_bumps, seed=seed)
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

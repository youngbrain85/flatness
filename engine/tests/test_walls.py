import numpy as np
from tests.fixtures.synthetic import flat_floor, flat_wall
from flatness.io.reader import CloudInfo
from flatness.core.walls import build_column_grid, detect_wall_lines

def _cols(pts, bin_m=0.05):
    info = CloudInfo(len(pts), pts.min(axis=0).astype(float), pts.max(axis=0).astype(float))
    return build_column_grid(iter([pts]), info, 1.0, bin_m=bin_m) , info

def test_flat_wall_fixture_geometry():
    w = flat_wall(length=4.0, height=2.4, spacing=0.05)
    assert abs(w[:, 0].max() - 4.0) < 0.06 and abs(w[:, 2].max() - 2.4) < 0.06
    assert np.allclose(w[:, 1], 0.0)
    wy = flat_wall(length=3.0, height=2.4, spacing=0.05, axis='y', y0=1.5)
    assert np.allclose(wy[:, 0], 1.5) and abs(wy[:, 1].max() - 3.0) < 0.06

def test_floor_only_no_walls():
    (grids), info = _cols(flat_floor(size=(4.0, 4.0), spacing=0.02))
    zmin2d, zmax2d, cnt2d, origin, shape = grids
    walls = detect_wall_lines(zmin2d, zmax2d, cnt2d, origin, 0.05)
    assert walls == []

def test_one_wall_detected():
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0)])
    (zmin2d, zmax2d, cnt2d, origin, shape), info = _cols(pts)
    walls = detect_wall_lines(zmin2d, zmax2d, cnt2d, origin, 0.05)
    assert len(walls) == 1
    w = walls[0]
    assert abs(abs(w.direction[0]) - 1.0) < 0.05      # x축 방향 벽
    assert (w.u_max - w.u_min) > 3.5                   # 길이 ≈ 4m
    assert (w.z_max - w.z_min) > 2.0                   # 높이 ≈ 2.4m

def test_two_perpendicular_walls():
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0),
                     flat_wall(length=3.0, height=2.4, spacing=0.02, axis='y', y0=0.0)])
    (zmin2d, zmax2d, cnt2d, origin, shape), info = _cols(pts)
    walls = detect_wall_lines(zmin2d, zmax2d, cnt2d, origin, 0.05)
    assert len(walls) == 2

from flatness.core.walls import project_wall_points, wall_grid

def _detect_one(pts):
    (zmin2d, zmax2d, cnt2d, origin, shape), info = _cols(pts)
    walls = detect_wall_lines(zmin2d, zmax2d, cnt2d, origin, 0.05)
    assert len(walls) == 1
    return walls[0], info

def test_projection_flat_wall_w_near_zero():
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0)])
    wall, info = _detect_one(pts)
    uvw = project_wall_points(iter([pts]), info, 1.0, wall)
    allp = np.vstack(uvw)
    assert abs(float(np.abs(allp[:, 2]).max())) < 0.06  # 밴드 내, 벽면 w ≈ 0(바닥점은 제외됨)
    g = wall_grid(uvw)
    assert np.isfinite(g.median_z).sum() > 1000          # 벽 영역 유효 서브셀 다수

def test_projection_excludes_floor_points():
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0)])
    wall, info = _detect_one(pts)
    uvw = np.vstack(project_wall_points(iter([pts]), info, 1.0, wall))
    # 바닥은 벽 평면에서 y로 멀어지는 점 대부분 제외 — 남는 점은 벽 근처 좁은 띠뿐
    n_wall = len(flat_wall(length=4.0, height=2.4, spacing=0.02))
    assert len(uvw) < n_wall * 1.5

def test_wall_bump_visible_in_grid():
    w = flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0)
    r = np.hypot(w[:, 0] - 2.0, w[:, 2] - 1.2)
    m = r < 0.3
    w[m, 1] += 0.01 * 0.5 * (1.0 + np.cos(np.pi * r[m] / 0.3))  # 법선(y) 방향 10mm 돌출
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02), w])
    wall, info = _detect_one(pts)
    g = wall_grid(project_wall_points(iter([pts]), info, 1.0, wall))
    base = float(np.nanmedian(g.median_z))
    assert 0.008 < float(np.nanmax(g.median_z)) - base < 0.012  # 돌출이 w 중앙값에 보존

def test_partition_wall_center_of_bbox_sign_correct():
    # 병리 케이스: 벽이 bbox 중심 부근을 지나는 실내 파티션 — bbox 중심 휴리스틱은
    # 이 부호 판별에서 결정적으로 실패했다(리뷰 재현, 15시드 전부 delta=0).
    # 원 리뷰 픽스처(바닥 y∈[0,3], 벽 y0=1.5)는 벽 기준 양쪽 바닥 질량이 완전히
    # 대칭이라 점 질량 판별로도 무승부(n_pos==n_neg)가 나 실행 확인 후 바닥을
    # y∈[0,2.0]로 좁혀 비대칭화했다: 벽(y0=1.5) 기준 아래쪽 폭 1.5 vs 위쪽 폭 0.5로
    # interior_window(±1.0m) 안에서 아래쪽(n_pos) 질량이 뚜렷이 크다(8865 vs 3743, 실측).
    # 범프는 그 다수질량 쪽(-y)으로 주입해 "+w=다수질량 쪽 돌출" 계약이 보존되는지 검증한다.
    w = flat_wall(length=4.0, height=2.4, spacing=0.02, y0=1.5)
    r = np.hypot(w[:, 0] - 2.0, w[:, 2] - 1.2)
    m = r < 0.3
    w[m, 1] -= 0.01 * 0.5 * (1.0 + np.cos(np.pi * r[m] / 0.3))  # 다수질량(-y) 쪽 10mm 돌출
    pts = np.vstack([flat_floor(size=(4.0, 2.0), spacing=0.02), w])
    wall, info = _detect_one(pts)
    g = wall_grid(project_wall_points(iter([pts]), info, 1.0, wall))
    base = float(np.nanmedian(g.median_z))
    delta = float(np.nanmax(g.median_z)) - base
    assert 0.008 < delta < 0.012  # 돌출이 +w로 보존 (은폐되지 않음)

def test_partition_wall_center_of_bbox_sign_correct_flipped():
    # 위 테스트의 반전 배치: 바닥을 벽 반대쪽(y>1.5)으로 옮겨 다수질량 쪽을 뒤집고
    # 범프도 그쪽(+y)으로 주입 — 점 질량 판별이 특정 방향에 치우치지 않고 실제
    # 다수질량 쪽을 정확히 따라감을 확인한다.
    floor = flat_floor(size=(4.0, 2.0), spacing=0.02)
    floor[:, 1] += 1.5  # 바닥을 y∈[1.5, 3.5]로 이동 (다수질량이 벽 위쪽)
    w = flat_wall(length=4.0, height=2.4, spacing=0.02, y0=1.5)
    r = np.hypot(w[:, 0] - 2.0, w[:, 2] - 1.2)
    m = r < 0.3
    w[m, 1] += 0.01 * 0.5 * (1.0 + np.cos(np.pi * r[m] / 0.3))  # 다수질량(+y) 쪽 10mm 돌출
    pts = np.vstack([floor, w])
    wall, info = _detect_one(pts)
    g = wall_grid(project_wall_points(iter([pts]), info, 1.0, wall))
    base = float(np.nanmedian(g.median_z))
    delta = float(np.nanmax(g.median_z)) - base
    assert 0.008 < delta < 0.012  # 돌출이 +w로 보존 (은폐되지 않음)

"""정합 — Umeyama 닫힌 해 + trimmed ICP (스펙 §4.4 / §9.3).

Open3D·PCL을 쓰지 않는다. 사용자 승인 하의 의도적 이탈이며 docs/service-report.md
§3.2에 기록돼 있다. 대응 탐색은 이미 엔진 의존성인 scipy.spatial.cKDTree를 쓴다.

**잔차를 두 가지로 나눠 쓴다(스펙 §9.3.1).**
`대응·최소화·수렴 판정 = point-to-point`, `보고값 rmse_m·성공 임계 = point-to-plane`.
스펙 §4.4의 `RMSE <= 2mm`는 point-to-plane 잔차를 전제로 쓰인 값이다. point-to-point
잔차에는 표본 간격의 절반 수준 하한이 있어(표본 간격 5cm에서 실측 19.5mm) 정합이
정확해도 게이트를 넘지 못한다 — 정합 품질이 아니라 격자 해상도의 그림자다.

정확도 한계 메모(설계 결정 F1): 수평 바닥은 면내 평행이동 2자유도와 yaw에 대해
구조적으로 퇴화한다 — 평면을 자기 위에서 밀어도 점군이 그대로라 ICP가 그 방향의
정보를 얻지 못한다. 그래서 스펙 §9.3 원문의 "평행이동 <=1mm"는 노이즈가 있는
바닥에서 달성 불가능하다. 다만 그 오차가 목적(병합 서브셀 중앙값 z)에 주는 영향은
`국소 경사 x 면내오차`뿐이라 실용상 무해하다. 실측 표와 교체 게이트는 스펙 §9.3 참조.
"""
from dataclasses import dataclass
import numpy as np
from scipy.spatial import cKDTree

MIN_OVERLAP_RATIO = 0.1     # 스펙 §9.3: 중첩 10% 미만은 실패로 끝낸다
MAX_RMSE_M = 0.002          # 스펙 §4.4: 최종 RMSE <= 2mm (point-to-plane 잔차 기준)
NORMAL_K = 16               # 법선 추정 k-근방


@dataclass
class RegistrationResult:
    transform: np.ndarray      # 4x4 float64, 동차 좌표. B를 A에 맞춘다
    rmse_m: float              # 최종 **point-to-plane** RMSE (미터). 워커가 *1000해 mm로 저장
    iterations: int
    converged: bool
    overlap_ratio: float       # trimmed ICP가 실제로 쓴 대응 비율
    failure_reason: str | None  # 실패 시 한국어 사유, 성공이면 None


def _as_points(arr, what):
    a = np.asarray(arr, dtype=np.float64)
    if a.ndim != 2 or a.shape[1] != 3:
        raise ValueError(f"{what}은 (N,3) 배열이어야 합니다")
    return a


def umeyama_rigid(src, dst):
    """src(N,3) -> dst(N,3) 강체 변환 4x4. 축척 고정(=1). N>=3."""
    s = _as_points(src, "src")
    d = _as_points(dst, "dst")
    if s.shape != d.shape:
        raise ValueError("src와 dst의 점 개수가 다릅니다")
    if len(s) < 3:
        raise ValueError("대응점이 3쌍 이상 필요합니다")
    s_mean, d_mean = s.mean(axis=0), d.mean(axis=0)
    h = (s - s_mean).T @ (d - d_mean)
    u, _sv, vt = np.linalg.svd(h)
    # 반사 보정: 보정을 빼면 거울상 입력에서 det=-1인 '변환'이 나온다.
    # 특이값(_sv)은 쓰지 않는다 — 곱하면 축척이 흡수되어 스펙 §4.4를 어긴다.
    sign = 1.0 if np.linalg.det(vt.T @ u.T) >= 0 else -1.0
    r = vt.T @ np.diag([1.0, 1.0, sign]) @ u.T
    t = np.eye(4)
    t[:3, :3] = r
    t[:3, 3] = d_mean - r @ s_mean
    return t


def _pairs(cur, tree, dst, trim_ratio, max_pair_dist_m):
    """대응 탐색 -> 거리 필터 -> 하위 trim_ratio만 남긴다. (keep, idx, rmse) 반환."""
    dist, idx = tree.query(cur, workers=-1)
    keep = np.flatnonzero(dist <= max_pair_dist_m)
    if len(keep) >= 3 and trim_ratio < 1.0:
        k = max(3, int(round(len(keep) * trim_ratio)))
        keep = keep[np.argsort(dist[keep], kind="stable")[:k]]
    if len(keep) == 0:
        return keep, idx, float("nan")
    return keep, idx, float(np.sqrt(np.mean(dist[keep] ** 2)))


def estimate_normals(dst, tree=None, k=NORMAL_K):
    """dst(N,3)의 국소 법선 (N,3). k-근방 공분산의 최소 고유벡터.

    부호는 정하지 않는다 — point-to-plane 잔차는 |변위·법선|이라 부호와 무관하다.
    """
    dst = _as_points(dst, "dst")
    k = int(min(max(k, 3), len(dst)))
    tree = cKDTree(dst) if tree is None else tree
    _d, idx = tree.query(dst, k=k, workers=-1)
    nb = dst[idx]                                   # (N,k,3)
    c = nb - nb.mean(axis=1, keepdims=True)
    cov = np.einsum("nki,nkj->nij", c, c)
    _w, v = np.linalg.eigh(cov)                     # 고유값 오름차순
    return v[:, :, 0]


def _plane_rmse(cur, dst, idx, keep, normals):
    """point-to-plane 잔차 RMSE — 대응쌍 변위의 **법선 방향 성분**만 센다.

    point-to-point 잔차와 달리 하한이 없다. 두 스캔이 같은 표면을 서로 다른 점으로
    표본해도 접선 방향 어긋남(표본 이산화)이 잔차에 섞이지 않기 때문이다.
    """
    if len(keep) < 3:
        return float("nan")
    diff = cur[keep] - dst[idx[keep]]
    along = np.einsum("ij,ij->i", diff, normals[idx[keep]])
    return float(np.sqrt(np.mean(along ** 2)))


def icp_refine(src_pts, dst_pts, init_transform, *,
               max_iterations=50, rmse_rel_tol=1e-4,
               trim_ratio=0.8, max_pair_dist_m=0.5, normal_k=NORMAL_K):
    """trimmed ICP. cKDTree로 대응 탐색.

    **대응·최소화·수렴 판정은 point-to-point, 보고값(`rmse_m`)과 성공 임계는
    point-to-plane이다.** 일부러 분리했다(스펙 §9.3.1):

    - 최소화가 point-to-point인 것은 브리프 지시이고, 변환 정확도는 이미 검증됐다.
      수렴 판정도 최소화하는 그 양을 봐야 일관적이므로 point-to-point RMSE의 상대
      변화율을 쓴다. 최소화하지 않는 양으로 수렴을 판정하면 단조 감소가 보장되지
      않아 판정이 흔들린다.
    - 반면 게이트(스펙 §4.4 `RMSE <= 2mm`)는 point-to-plane 잔차를 전제로 쓰인
      값이다. point-to-point 잔차에는 표본 간격의 절반 수준 하한이 있어서(표본
      간격 5cm에서 실측 19.5mm) 정합이 정확해도 게이트를 넘지 못한다. 그것은
      정합 품질이 아니라 격자 해상도의 그림자다.
    """
    src = _as_points(src_pts, "src_pts")
    dst = _as_points(dst_pts, "dst_pts")
    if len(src) == 0 or len(dst) == 0:
        raise ValueError("빈 점군은 정합할 수 없습니다")
    transform = np.asarray(init_transform, dtype=np.float64).copy()
    if transform.shape != (4, 4):
        raise ValueError("init_transform은 4x4 행렬이어야 합니다")

    tree = cKDTree(dst)
    normals = estimate_normals(dst, tree=tree, k=normal_k)
    prev_rmse, point_rmse, iters, stalled = None, float("nan"), 0, False
    cur = src @ transform[:3, :3].T + transform[:3, 3]
    keep, idx = np.empty(0, dtype=np.int64), np.zeros(len(src), dtype=np.int64)
    for iters in range(1, max_iterations + 1):
        cur = src @ transform[:3, :3].T + transform[:3, 3]
        keep, idx, point_rmse = _pairs(cur, tree, dst, trim_ratio, max_pair_dist_m)
        if len(keep) < 3:
            break
        if prev_rmse is not None and abs(prev_rmse - point_rmse) <= rmse_rel_tol * max(prev_rmse, 1e-12):
            stalled = True
            break
        prev_rmse = point_rmse
        transform = umeyama_rigid(cur[keep], dst[idx[keep]]) @ transform
    else:
        # 반복을 다 쓴 경우 마지막 갱신 이후의 값으로 다시 잰다(보고값과 변환의 일치).
        cur = src @ transform[:3, :3].T + transform[:3, 3]
        keep, idx, point_rmse = _pairs(cur, tree, dst, trim_ratio, max_pair_dist_m)

    used = len(keep)
    rmse = _plane_rmse(cur, dst, idx, keep, normals)
    overlap_ratio = used / len(src)
    reasons = []
    if not stalled:
        reasons.append(f"최대 반복 {max_iterations}회 안에 수렴하지 못했습니다.")
    if overlap_ratio < MIN_OVERLAP_RATIO:
        reasons.append(f"중첩이 부족합니다(약 {overlap_ratio * 100:.0f}%). "
                       "두 스캔이 실제로 겹치는지 확인하세요.")
    if not np.isfinite(rmse) or rmse > MAX_RMSE_M:
        reasons.append(f"최종 RMSE {rmse * 1000:.2f}mm가 허용치 {MAX_RMSE_M * 1000:.2f}mm를 넘습니다.")
    return RegistrationResult(transform=transform, rmse_m=rmse, iterations=iters,
                              converged=not reasons, overlap_ratio=overlap_ratio,
                              failure_reason=" ".join(reasons) if reasons else None)


def register_clouds(src_pts, dst_pts, correspondences_src, correspondences_dst, **icp_kwargs):
    """대응점으로 Umeyama -> ICP. 대응점 3쌍 미만이면 ValueError."""
    cs = _as_points(correspondences_src, "대응점(src)")
    cd = _as_points(correspondences_dst, "대응점(dst)")
    if cs.shape != cd.shape:
        raise ValueError("대응점 쌍의 개수가 서로 다릅니다")
    if len(cs) < 3:
        raise ValueError(f"대응점이 3쌍 이상 필요합니다(현재 {len(cs)}쌍)")
    return icp_refine(src_pts, dst_pts, umeyama_rigid(cs, cd), **icp_kwargs)


def grid_to_points(grid):
    """SubcellGrid -> (M,3) 점군. NaN 서브셀은 뺀다. 좌표는 셀 중심.

    ★ 계약 — z는 **절대 높이가 아니다.** `build_subcell_grid`가 `median_z`를
    `bbox_min[2]` 상대 높이로 저장하고 `grid.origin`도 x,y만 갖는다. 따라서 두 스캔의
    bbox가 다르면 **z 오프셋이 서로 다르다**. 이 함수의 출력을 그대로 정합에 넣으면
    그 오프셋 차이가 z 평행이동에 통째로 섞인다.

    호출자가 정합 전에 각 격자의 `bbox_min[2]`를 더해 공통 기준으로 되돌려야 한다.
    병합을 담당하는 Task 4에서 이 계약을 반드시 확인할 것(원장 기록됨).
    """
    iy, ix = np.nonzero(np.isfinite(grid.median_z))
    x = grid.origin[0] + (ix + 0.5) * grid.size_m
    y = grid.origin[1] + (iy + 0.5) * grid.size_m
    return np.column_stack([x, y, grid.median_z[iy, ix].astype(np.float64)])

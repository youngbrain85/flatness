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
# 발산 가드 — point-to-point 잔차가 표본 간격의 몇 배를 넘으면 실패로 본다.
# 근거(실측): 같은 표면을 독립 표본한 두 점군을 **정확히** 정합하면 이 비가 0.61이고,
# 수평으로 3m 어긋뜨려도 0.70을 넘지 않는다. src가 dst 가장자리 **밖**에 놓인
# 자세에서는 1.5를 넘는다(회귀 픽스처 실측 1.60. 자세만 평가하면 5.6~8.5배까지
# 나오지만 ICP를 한 번만 돌려도 1.5~1.7로 내려온다).
# ★ 탐지 측 여유가 얇다 — 회귀 픽스처가 1.60으로 임계 바로 위(6%)다. 임계를
#   올리면 그 픽스처가 먼저 빠져나간다. 정상 측 여유(0.70 대비 2.1배)와 비대칭이다.
DIVERGENCE_SPACING_RATIO = 1.5
# 스펙 §8: 대응점 공선·퇴화 거부. **절대량으로 판별한다.**
# 무차원 비(sv1/sv0)는 현장이 길수록 같은 물리적 폭에서 작아져 스케일 의존적이다 —
# 실측으로 150m x 2.5m 복도(sv1/sv0=0.0163)가 거부되는데, 정작 그 복도를 가드 없이
# 정합하면 면내 오차가 정상 4점 배치(44.7mm)보다 **더 좋다**. 물리적으로 옳은 질문은
# "측방 퍼짐이 클릭 오차 대비 충분한가"다.
CORR_CLICK_SD_M = 0.05          # 화면 클릭 정확도 ±5cm (스펙 §9.3)
# 측방 RMS 퍼짐 = sv1/sqrt(N). 이것이 클릭 오차보다 작으면 회전을 전혀 정할 수 없다.
# 실측: 정상 4점 1.925m / 복도 150x2.5 1.001m / 좁은 띠 중첩 0.108m / 작은 방
# 0.8x0.6 0.236m / 근접 3점 0.008m / 완전 공선 0.000m.
MIN_CORR_LATERAL_SPREAD_M = CORR_CLICK_SD_M
_COLLINEAR_SV_RATIO = 0.05      # 사유 문구를 "공선"으로 쓸지 고르는 용도(게이트 아님)
# 감도 프로브 — 정합을 수평으로 밀었을 때 point-to-plane 잔차가 오르는 비.
# 1.0이면 이 정합은 수평 오정합을 **원리적으로 검출할 수 없다**(스펙 §9.3.2).
# 실측(min over ±x,±y): 완전 평면 1.000 / 바닥+벽 1.248 / 범프 바닥 1.710 /
# 구배 램프 1.86~1.87. 1.1은 유일한 사각(완전 평면)만 걸러낸다.
HORIZONTAL_SENSITIVITY_MIN = 1.1
PROBE_STEP_M = 0.10


@dataclass
class RegistrationResult:
    transform: np.ndarray      # 4x4 float64, 동차 좌표. B를 A에 맞춘다
    rmse_m: float              # 최종 **point-to-plane** RMSE (미터). 워커가 *1000해 mm로 저장
    iterations: int
    converged: bool
    overlap_ratio: float       # trimmed ICP가 실제로 쓴 대응 비율. ★ trim_ratio가 상한이다
                               # — 100% 겹쳐도 기본값 0.8이 최대다. 따라서 `<0.1` 가드는
                               # 실제로는 "참 중첩 12.5% 미만"을 거른다. 사용자 대면 수치
                               # (마이그레이션 012 `registrations.overlap_ratio`)이므로
                               # 화면에 그대로 쓰려면 trim_ratio로 나눠야 참 중첩이 된다.
    failure_reason: str | None  # 실패 시 한국어 사유, 성공이면 None
    # --- 아래는 추가 필드다(기존 필드명·타입은 그대로 둔다) ---
    point_rmse_m: float = float("nan")     # point-to-point 잔차 RMSE. 발산 가드의 근거값
    sample_spacing_m: float = float("nan")  # dst 표본 간격 추정(최근접 이웃 거리 중앙값)
    horizontal_sensitivity: float = float("nan")
    """수평 오정합을 **검출할 수 있는 정도**. 정합을 ±10cm 수평으로 밀었을 때
    point-to-plane 잔차가 오르는 비의 최솟값(±x·±y 4방향 중 최악).

    1.0에 가까우면 이 장면은 수평 방향으로 **검증 불가**다 — 몇 미터가 어긋나도
    잔차가 그대로라 `rmse_m`이 안전을 보장하지 못한다(스펙 §9.3.2). 실패로
    처리하지는 않는다(±5mm 평탄 바닥이 이 용역의 정상 대상이라 전부 막히면
    기능이 성립하지 않는다). 대신 화면(§7.4)이 `HORIZONTAL_SENSITIVITY_MIN`
    미만일 때 "수평 방향 검증 불가"를 경고하고 겹친 그림을 함께 보여야 한다."""


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


def estimate_normals(dst, tree=None, k=NORMAL_K, chunk=50_000):
    """dst(N,3)의 국소 법선 (N,3). k-근방 공분산의 최소 고유벡터.

    부호는 정하지 않는다 — point-to-plane 잔차는 |변위·법선|이라 부호와 무관하다.

    **청크 처리한다.** (N,k,3) 중간 배열을 한 번에 만들면 점당 약 1.2KB가 들어
    24만 점(스펙 §6.3 예시 600m²)에서 288MB, 약 170만 점에서 성능 게이트 2GiB를
    소진한다 — 스펙 §11의 옥외 대면적과 충돌한다. 청크로 나누면 N과 무관하게
    상수 메모리(기본 5만 점 ≈ 60MB)로 내려간다.
    """
    dst = _as_points(dst, "dst")
    k = int(min(max(k, 3), len(dst)))
    tree = cKDTree(dst) if tree is None else tree
    out = np.empty((len(dst), 3), dtype=np.float64)
    for s in range(0, len(dst), chunk):
        e = min(s + chunk, len(dst))
        _d, idx = tree.query(dst[s:e], k=k, workers=-1)
        nb = dst[idx]                               # (chunk,k,3)
        c = nb - nb.mean(axis=1, keepdims=True)
        _w, v = np.linalg.eigh(np.einsum("nki,nkj->nij", c, c))   # 고유값 오름차순
        out[s:e] = v[:, :, 0]
    return out


def estimate_sample_spacing(pts, tree=None, max_probe=20_000):
    """표본 간격 추정 — 자기 자신을 뺀 최근접 이웃 거리의 중앙값. 큰 점군은 부분표본."""
    pts = _as_points(pts, "pts")
    if len(pts) < 2:
        return float("nan")
    tree = cKDTree(pts) if tree is None else tree
    probe = pts if len(pts) <= max_probe else pts[np.linspace(0, len(pts) - 1, max_probe).astype(np.int64)]
    d, _ = tree.query(probe, k=2, workers=-1)
    return float(np.median(d[:, 1]))


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


def _horizontal_sensitivity(cur, dst, tree, normals, trim_ratio, max_pair_dist_m, step):
    """정합을 수평으로 ±step 밀어 보고 point-to-plane 잔차가 오르는 비의 최솟값.

    "수평 정보가 데이터에 있는가"를 직접 잰다. 사각을 막지는 못하지만 **사각임을
    보고**할 수는 있다 — 지금은 3m 어긋난 정합도 아무 신호 없이 성공으로 나간다.
    KD트리·법선이 이미 있으므로 추가 비용은 질의 4회뿐이다.
    """
    def plane_rmse_at(pts):
        keep, idx, _pp = _pairs(pts, tree, dst, trim_ratio, max_pair_dist_m)
        return _plane_rmse(pts, dst, idx, keep, normals)

    base = plane_rmse_at(cur)
    if not np.isfinite(base):
        return float("nan")
    ratios = []
    for v in ([step, 0.0, 0.0], [-step, 0.0, 0.0], [0.0, step, 0.0], [0.0, -step, 0.0]):
        moved = plane_rmse_at(cur + np.asarray(v))
        if not np.isfinite(moved):
            return float("nan")
        ratios.append(moved / max(base, 1e-5))
    return float(min(ratios))


def icp_refine(src_pts, dst_pts, init_transform, *,
               max_iterations=50, rmse_rel_tol=1e-4,
               trim_ratio=0.8, max_pair_dist_m=0.5, normal_k=NORMAL_K,
               probe_step_m=PROBE_STEP_M):
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
    spacing = estimate_sample_spacing(dst, tree=tree)
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
    # 발산 가드 — point-to-plane 잔차가 못 보는 어긋남을 잡는다. 수평 평면 위에서
    # 접선 방향으로 밀린 점군은 법선 방향 성분이 0이라 rmse_m이 완벽해 보인다.
    # 실제로 src가 dst 가장자리 밖에 떠 있어도 rmse_m=0.000mm·중첩 0.8이 나온다.
    if np.isfinite(spacing) and spacing > 0 and np.isfinite(point_rmse) \
            and point_rmse > DIVERGENCE_SPACING_RATIO * spacing:
        reasons.append(f"정합이 발산했습니다(점간 잔차 {point_rmse * 1000:.1f}mm가 표본 간격 "
                       f"{spacing * 1000:.1f}mm의 {point_rmse / spacing:.1f}배). "
                       "대응점을 다시 찍어 주세요.")
    if not np.isfinite(rmse) or rmse > MAX_RMSE_M:
        reasons.append(f"최종 RMSE {rmse * 1000:.2f}mm가 허용치 {MAX_RMSE_M * 1000:.2f}mm를 넘습니다.")
    sensitivity = _horizontal_sensitivity(cur, dst, tree, normals, trim_ratio,
                                          max_pair_dist_m, probe_step_m)
    return RegistrationResult(transform=transform, rmse_m=rmse, iterations=iters,
                              converged=not reasons, overlap_ratio=overlap_ratio,
                              failure_reason=" ".join(reasons) if reasons else None,
                              point_rmse_m=point_rmse, sample_spacing_m=spacing,
                              horizontal_sensitivity=sensitivity)


def correspondence_lateral_spread(pts):
    """대응점의 **측방 RMS 퍼짐**(미터) = 2번째 특이값 / sqrt(N).

    회전을 정하는 것은 주축이 아니라 **주축에 수직인 퍼짐**이다. 절대량이라
    현장 크기에 휘둘리지 않는다 — 150m 복도든 0.8m 방이든 같은 잣대로 잰다.
    """
    sv = np.linalg.svd(pts - pts.mean(axis=0), compute_uv=False)
    sv = np.concatenate([sv, np.zeros(3)])[:3]
    return float(sv[1] / np.sqrt(len(pts))), sv


def check_correspondence_geometry(pts, what="대응점"):
    """스펙 §8: 대응점이 공선이거나 한곳에 몰려 있으면 거부한다.

    개수만 세면 안 된다. 근접 3점(2cm 안)을 찍으면 초기 Umeyama가 이미 yaw 89도·
    면내 5.3m로 틀어지고 ICP가 못 고친다 — 가드는 대응점 단계에 있어야 한다.

    **판별은 절대량(측방 RMS 퍼짐)으로 한다.** 무차원 비 sv1/sv0을 쓰면 스케일에
    끌려가 150m 복도를 거부하면서 6m에 12cm 편차인 배치는 통과시킨다(전자가
    물리적으로 더 좋은데도). 측방 퍼짐이 클릭 오차(±5cm)보다 작으면 회전을
    정할 수 없다 — 그것이 유일한 게이트다. 특이값 비는 사유 문구를 고르는 데만 쓴다.
    """
    lateral, sv = correspondence_lateral_spread(pts)
    if lateral >= MIN_CORR_LATERAL_SPREAD_M:
        return
    if sv[0] > 0 and sv[1] / sv[0] < _COLLINEAR_SV_RATIO:
        raise ValueError(f"{what}이 한 직선 위에 있습니다(공선, 측방 퍼짐 "
                         f"{lateral * 100:.1f}cm). 일직선을 벗어난 지점을 하나 이상 포함하세요.")
    raise ValueError(f"{what}이 한곳에 몰려 있습니다(측방 퍼짐 {lateral * 100:.1f}cm가 "
                     f"클릭 오차 {CORR_CLICK_SD_M * 100:.0f}cm보다 작습니다). "
                     "서로 멀리 떨어진 지점들을 고르세요.")


def register_clouds(src_pts, dst_pts, correspondences_src, correspondences_dst, **icp_kwargs):
    """대응점으로 Umeyama -> ICP. 대응점이 3쌍 미만·공선·근접이면 ValueError(스펙 §8)."""
    cs = _as_points(correspondences_src, "대응점(src)")
    cd = _as_points(correspondences_dst, "대응점(dst)")
    if cs.shape != cd.shape:
        raise ValueError("대응점 쌍의 개수가 서로 다릅니다")
    if len(cs) < 3:
        raise ValueError(f"대응점이 3쌍 이상 필요합니다(현재 {len(cs)}쌍)")
    check_correspondence_geometry(cd, "대응점")
    check_correspondence_geometry(cs, "대응점")
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

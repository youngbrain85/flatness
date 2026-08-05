"""handle_register 단위 테스트 (세부과업 4 단계 F, Task 4).

핵심 계약(태스크 브리프 + 설계 결정 F3·F8·F9·F10):
1. 두 소스를 **순차로** 격자화한다 - 동시에 들면 정렬 버퍼(점당 12B)가 겹쳐 쌓여
   2GiB 게이트를 넘긴다(F3). 격자 객체가 살아 있는 채로 다음 격자화를 시작하지
   않는지를 weakref로 직접 본다.
2. ICP는 **서브셀 중앙값 점군**에서 돈다, 원본이 아니다(F3, 실측 1.5~2초 대 9~10초).
3. 병합 스캔의 lineage는 `registered`다(F9) - `fused_mesh`를 재사용하면 업로드
   화면이 붙인 "앱이 스무딩한 데이터" 경고의 의미가 거짓이 된다.
4. 병합은 **두 소스를 같은 격자에 다시 넣은 서브셀 중앙값**이다(F8) - 한쪽만
   쓰거나 단순 이어붙이기면 안 된다.
5. 실패 사유는 `registrations.error_text`에 남는다(F10) - `jobs` 테이블은 RLS
   정책이 0개라 대시보드가 못 읽는다.

픽스처 원칙(이 저장소가 여섯 번 데인 함정) - 두 소스는 **같은 표면을 서로 다른
점으로** 표본하고, **서로 다른 영역**을 덮고, B는 **자기 좌표계**(yaw 7도 + 평행이동)
를 갖는다. 두 점군이 1:1로 같은 점을 담으면 최근접점이 늘 '같은 점'을 찾아
정합이 실제보다 쉬워지고, 병합 검증도 "한쪽만 써도 통과하는" 항등식이 된다.
"""
import dataclasses
import gc
import json
import weakref

import numpy as np
import pytest

from flatness.core.registration import HORIZONTAL_SENSITIVITY_MIN
from flatness.core.subcell import build_subcell_grid
from flatness.io.reader import iter_chunks, read_info

from flatworker import registration as reg_mod
from flatworker.artifacts import raw_scan_dir
from flatworker.config import Config
from flatworker.jobs import handle_register
from flatworker.runner import _DEFAULT_HANDLERS, run_loop
from flatworker.storage import get_storage
from tests.fake_db import FakeDB
from tests.synthetic_helpers import synthetic

write_binary_ply = synthetic.write_binary_ply
bumpy_surface_z = synthetic.bumpy_surface_z

_REG_ID = "reg1"
_SUBCELL_M = 0.05
_SPACING = 0.02                 # 5cm 서브셀당 축 2~3점 -> min_points(3) 충족
_SURFACE_SIZE = (6.0, 3.0)      # 범프 배치 기준 영역(월드)
_SURFACE_SEED = 21
_Y_RANGE = (0.0, 3.0)
# B 스캔의 파일 좌표계 = 월드에 yaw 7도 회전 + 평행이동을 건 것. 항등 변환을 쓰면
# "변환을 아예 적용하지 않는" 구현도 통과한다.
_YAW_DEG = 7.0
_SHIFT_M = np.array([0.35, -0.22, 0.011])


# -- 픽스처 -----------------------------------------------------------------

def _surface_z(x, y):
    return bumpy_surface_z(x, y, size=_SURFACE_SIZE, seed=_SURFACE_SEED)


def _world_points(x_range, sample_seed, spacing=_SPACING, base_z=0.0, holes=None):
    """월드 좌표계에서 같은 표면을 표본한 점군 (N,3).

    `sample_seed`가 다르면 **다른 점**을 찍는다(표본 독립). `holes`는 제외할
    x 구간 목록으로, 두 소스 사이에 빈 띠를 둬 진짜 저중첩을 만드는 데 쓴다.
    """
    xs = np.arange(x_range[0], x_range[1] + spacing / 2, spacing)
    ys = np.arange(_Y_RANGE[0], _Y_RANGE[1] + spacing / 2, spacing)
    gx, gy = np.meshgrid(xs, ys)
    rng = np.random.default_rng(sample_seed)
    gx = gx + rng.uniform(-spacing / 2, spacing / 2, gx.shape)
    gy = gy + rng.uniform(-spacing / 2, spacing / 2, gy.shape)
    z = _surface_z(gx, gy) + base_z
    pts = np.column_stack([gx.ravel(), gy.ravel(), z.ravel()])
    for lo, hi in (holes or []):
        pts = pts[(pts[:, 0] < lo) | (pts[:, 0] > hi)]
    return pts


def _add_blob(pts, center, radius, height):
    """한쪽 스캔에만 있는 국소 융기(다른 스캔 때는 없던 물건). 중첩 서브셀에서
    두 소스가 **서로 다른 값**을 갖게 만드는 장치다 - 값이 같으면 "두 소스의
    중앙값"과 "한쪽 값"을 구별할 수 없다."""
    out = pts.copy()
    m = np.hypot(out[:, 0] - center[0], out[:, 1] - center[1]) < radius
    out[m, 2] += height
    return out


def _to_b_frame(world_pts):
    """월드 좌표 -> B 스캔의 파일 좌표(B는 자기 원점·자기 방위를 갖는다)."""
    c, s = np.cos(np.radians(_YAW_DEG)), np.sin(np.radians(_YAW_DEG))
    r = np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])
    return np.asarray(world_pts, dtype=np.float64) @ r.T + _SHIFT_M


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                  data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _scan_row(scan_id, unit_scale, n_points):
    return {
        "id": scan_id, "location_id": "loc1", "surface": "floor",
        "scanned_at": "2026-08-04", "device": "iPad Pro",
        "operator_id": None, "operator_name_manual": "김측정",
        "selected_criteria_id": "crit1",
        "raw_file_path": f"raw-scans/site1/{scan_id}/raw.ply",
        "original_filename": f"{scan_id}.ply", "file_format": "ply",
        "point_count": n_points, "unit_scale": unit_scale,
        "lineage": "raw", "status": "ready",
    }


def _seed_scan(db, cfg, scan_id, file_pts, unit_scale=1.0):
    """스캔 행 + 원본 PLY를 시드한다. `file_pts`는 **파일 단위** 좌표다."""
    sd = raw_scan_dir(cfg.data_dir, "site1", scan_id)
    write_binary_ply(np.asarray(file_pts, dtype=np.float64), sd / "raw.ply")
    db.scans[scan_id] = _scan_row(scan_id, unit_scale, len(file_pts))
    return db.scans[scan_id]


def _corr_rows(world_xy, unit_scale_a=1.0, unit_scale_b=1.0):
    """월드 XY 목록 -> registrations.correspondences 행.

    화면이 저장하는 값은 **각 스캔 파일의 단위 그대로인 월드 좌표**다(설계 결정
    F7) - 그래서 여기서 1/unit_scale을 곱해 파일 단위로 되돌린다.
    """
    world = np.column_stack([np.asarray(world_xy, dtype=np.float64),
                             _surface_z(np.asarray(world_xy)[:, 0], np.asarray(world_xy)[:, 1])])
    a_file = world / unit_scale_a
    b_file = _to_b_frame(world) / unit_scale_b
    return [{"a": {"x": pa[0], "y": pa[1], "z": pa[2]},
             "b": {"x": pb[0], "y": pb[1], "z": pb[2]}}
            for pa, pb in zip(a_file, b_file)]


# 대응점 월드 XY - 비대칭·비공선. 두 스캔의 중첩 구간 안에 든다.
_CORR_XY = np.array([[1.7, 0.4], [3.1, 0.9], [1.9, 2.6], [3.3, 2.2]])


def _seed_pair(db, cfg, *, unit_scale_a=1.0, unit_scale_b=1.0,
               a_x=(0.0, 3.5), b_x=(1.5, 6.0), b_holes=None,
               b_blob=None, a_base_z=0.0, b_base_z=0.0, corr_xy=_CORR_XY):
    """겹치는 두 스캔(A: 왼쪽, B: 오른쪽)과 registrations 행을 시드한다."""
    a_world = _world_points(a_x, sample_seed=101, base_z=a_base_z)
    b_world = _world_points(b_x, sample_seed=202, base_z=b_base_z, holes=b_holes)
    if b_blob is not None:
        b_world = _add_blob(b_world, *b_blob)
    _seed_scan(db, cfg, "scanA", a_world / unit_scale_a, unit_scale=unit_scale_a)
    _seed_scan(db, cfg, "scanB", _to_b_frame(b_world) / unit_scale_b, unit_scale=unit_scale_b)
    db.registrations[_REG_ID] = {
        "id": _REG_ID, "source_scan_ids": ["scanA", "scanB"],
        "correspondences": _corr_rows(corr_xy, unit_scale_a, unit_scale_b),
        "transform": None, "rmse_mm": None, "iterations": None,
        "overlap_ratio": None, "horizontal_sensitivity": None,
        "status": "queued", "error_text": None, "result_scan_id": None,
    }
    return a_world, b_world


# 3cm 안에 몰린 대응점 - 측방 RMS 퍼짐 0.87cm로 클릭 오차 5cm보다 작다(실측).
# 회전을 전혀 정할 수 없는 배치라 엔진이 거부한다(스펙 §8).
_CLUSTERED_CORR_XY = np.array([[2.00, 1.50], [2.02, 1.51], [2.01, 1.53], [2.03, 1.52]])


def _count_downloads(monkeypatch):
    """원본 파일을 실제로 내려받았는지 세는 카운터.

    "파일을 읽기 전에 거부했는가"를 구현 세부(어느 내부 함수를 먼저 부르는지)에
    기대지 않고 확인하기 위해 **저장소 경계**에서 센다.
    """
    from flatworker import storage as storage_mod
    seen = {"n": 0}
    real = storage_mod.LocalStorage.download_to

    def _spy(self, key, dst):
        seen["n"] += 1
        return real(self, key, dst)

    monkeypatch.setattr(storage_mod.LocalStorage, "download_to", _spy)
    return seen


def _run(db, cfg):
    handle_register(db, cfg, {"registration_id": _REG_ID})


def _merged_points(storage, tmp_path, registration_id=_REG_ID):
    blob = storage.download(f"artifacts/registrations/{registration_id}/merged.ply")
    assert blob is not None, "병합 PLY가 저장소에 없다"
    p = tmp_path / "merged_downloaded.ply"
    p.write_bytes(blob)
    return np.concatenate(list(iter_chunks(p)))


def _merged_scan(db):
    """원본 두 개를 제외한 새 스캔 행. 없으면 None."""
    rows = [s for sid, s in db.scans.items() if sid not in ("scanA", "scanB")]
    assert len(rows) <= 1, f"병합 스캔이 {len(rows)}개 만들어졌다"
    return rows[0] if rows else None


def _subcell_count(cfg, scan_id, unit_scale):
    """테스트가 독립적으로 센 유효 서브셀 수 - 프로덕션 경로를 타지 않는다."""
    path = raw_scan_dir(cfg.data_dir, "site1", scan_id) / "raw.ply"
    info = read_info(path)
    grid = build_subcell_grid(iter_chunks(path), info, unit_scale, _SUBCELL_M)
    return int(np.isfinite(grid.median_z).sum())


# -- 설계 결정 F3: 순차 처리 --------------------------------------------------

def test_register_reads_two_sources_sequentially_not_at_once(tmp_path, monkeypatch):
    """설계 결정 F3: 두 소스를 동시에 들면 정렬 버퍼가 겹쳐 쌓여 2GiB를 넘는다.

    "호출 순서"만 보면 부족하다 - `grid_a = build(...); grid_b = build(...)`는
    호출이 시간적으로 겹치지 않으면서도 두 격자를 동시에 들고 있다. 그래서
    **다음 격자화가 시작되는 시점에 앞선 격자가 아직 살아 있는지**를 weakref로
    직접 본다. 살아 있으면 그 메모리 위에 다음 정렬 버퍼가 겹쳐 쌓인다는 뜻이다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg)

    refs, alive_at_entry = [], []
    real = reg_mod.build_subcell_grid

    def _spy(*a, **k):
        gc.collect()
        alive_at_entry.append(sum(1 for r in refs if r() is not None))
        grid = real(*a, **k)
        refs.append(weakref.ref(grid))
        return grid

    monkeypatch.setattr(reg_mod, "build_subcell_grid", _spy)

    _run(db, cfg)

    assert len(refs) >= 2, f"격자화가 {len(refs)}번만 불렸다 - 두 소스를 다 읽지 않았다"
    assert alive_at_entry == [0] * len(refs), (
        f"앞선 서브셀 격자가 살아 있는 채로 다음 격자화를 시작했다: {alive_at_entry}")


def test_register_runs_icp_on_subcell_medians_not_raw_points(tmp_path, monkeypatch):
    """설계 결정 F3: 원본 점군을 ICP에 넘기면 5배 느리다(실측 1.5~2초 대 9~10초).

    register_clouds에 들어간 점 수가 원본이 아니라 **유효 서브셀 수**와 같은지
    본다. 기대값은 테스트가 엔진을 직접 불러 독립적으로 센다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg)
    raw_a, raw_b = db.scans["scanA"]["point_count"], db.scans["scanB"]["point_count"]

    seen = {}
    real = reg_mod.register_clouds

    def _spy(src_pts, dst_pts, cs, cd, **k):
        seen["src"], seen["dst"] = len(src_pts), len(dst_pts)
        return real(src_pts, dst_pts, cs, cd, **k)

    monkeypatch.setattr(reg_mod, "register_clouds", _spy)

    _run(db, cfg)

    assert seen["dst"] == _subcell_count(cfg, "scanA", 1.0), "dst가 A의 유효 서브셀 수가 아니다"
    assert seen["src"] == _subcell_count(cfg, "scanB", 1.0), "src가 B의 유효 서브셀 수가 아니다"
    # 픽스처가 실제로 "원본 != 서브셀"인지 함께 고정한다 - 둘이 같아지면 이 테스트는
    # 아무것도 증명하지 못한다.
    assert seen["dst"] * 4 < raw_a and seen["src"] * 4 < raw_b, (
        f"픽스처가 성겨서 서브셀 수({seen})가 원본({raw_a},{raw_b})과 구별되지 않는다")


# -- 설계 결정 F9: 병합 스캔 행 ----------------------------------------------

def test_register_writes_merged_scan_with_registered_lineage(tmp_path):
    """병합 스캔 행의 lineage가 'registered'다 (설계 결정 F9).

    'fused_mesh'를 쓰면 업로드 화면이 붙인 "앱이 스무딩한 데이터" 경고 의미가
    거짓이 된다 - 정합 병합은 스캐너 앱의 스무딩이 아니라 원시 점군 두 개의
    서브셀 중앙값이다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg)

    _run(db, cfg)

    merged = _merged_scan(db)
    assert merged is not None, "병합 스캔이 만들어지지 않았다"
    assert merged["lineage"] == "registered"
    assert merged["status"] == "ready"
    # 이미 미터로 환산된 점군이므로 배율은 1.0이다.
    assert merged["unit_scale"] == 1.0
    assert merged["raw_file_path"] == f"artifacts/registrations/{_REG_ID}/merged.ply"
    reg = db.registrations[_REG_ID]
    assert reg["status"] == "done"
    assert reg["result_scan_id"] == merged["id"]


def test_register_stores_rmse_in_millimetres_not_metres(tmp_path, monkeypatch):
    """엔진은 rmse_m(미터)를 내고 DB 컬럼은 rmse_mm이다 - 워커가 *1000한다.

    이 환산을 빠뜨리면 화면이 0.0018mm 같은 값을 보여주며 **항상 합격으로
    읽힌다**(조용히 틀리는 종류). 엔진 결과를 가로채 실제 비율을 고정한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg)

    captured = {}
    real = reg_mod.register_clouds

    def _spy(*a, **k):
        res = real(*a, **k)
        captured["res"] = res
        return res

    monkeypatch.setattr(reg_mod, "register_clouds", _spy)

    _run(db, cfg)

    res = captured["res"]
    reg = db.registrations[_REG_ID]
    assert reg["rmse_mm"] == pytest.approx(res.rmse_m * 1000.0, rel=1e-9)
    assert reg["rmse_mm"] > 1e-4, "mm 환산을 빠뜨리면 미터 값이 그대로 들어와 항상 합격으로 읽힌다"
    assert reg["iterations"] == res.iterations
    assert reg["overlap_ratio"] == pytest.approx(res.overlap_ratio, rel=1e-9)
    assert np.allclose(np.array(reg["transform"], dtype=np.float64), res.transform)
    # jsonb 컬럼에는 **순수 파이썬 값**만 넣는다. FakeDB는 파이썬 객체를 그대로
    # 담아 두므로 SupabaseRest의 httpx `json=` 직렬화 실패를 구조적으로 못 잡는다.
    # 다만 "json.dumps가 통과하는가"로는 부족하다 - numpy.float64는 float의 하위
    # 타입이라 그대로도 직렬화된다(변이로 실측: `[list(row) for row in transform]`
    # 이 그 단언을 통과했다). 그래서 타입 자체를 못 박는다. float32·int64가 섞이면
    # 그때는 정합을 다 끝낸 뒤 PostgREST 요청을 만들다 TypeError로 죽는다.
    json.dumps(reg["transform"])
    assert all(type(v) is float for row in reg["transform"] for v in row), (
        "transform에 numpy 스칼라가 남아 있다 - ndarray.tolist()로 변환해야 한다")


# -- 수평 감도 (스펙 9.3.2) ---------------------------------------------------

def test_register_stores_horizontal_sensitivity_on_success(tmp_path, monkeypatch):
    """`horizontal_sensitivity`를 저장한다 - 화면이 "수평 방향 검증 불가"를 경고할
    유일한 근거다(스펙 §9.3.2).

    point-to-plane RMSE는 수평 오정합을 **원리적으로 못 본다**: 완전 평면에서
    대응점을 통째로 3m 틀리게 찍어도 rmse 1.008mm·converged=True·사유 없음으로
    나가고, 기하 검사도 발산 가드도 침묵한다(엔진 실측). 그때 신호를 내는 값은
    감도 프로브 하나뿐이다(0.994 대 임계 1.1). 저장하지 않으면 화면이 아무것도
    할 수 없다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg)

    captured = {}
    real = reg_mod.register_clouds

    def _spy(*a, **k):
        res = real(*a, **k)
        captured["res"] = res
        return res

    monkeypatch.setattr(reg_mod, "register_clouds", _spy)

    _run(db, cfg)

    reg = db.registrations[_REG_ID]
    assert reg["status"] == "done"
    assert reg["horizontal_sensitivity"] == pytest.approx(
        captured["res"].horizontal_sensitivity, rel=1e-9)
    # 픽스처가 실제로 "검증 가능한" 장면인지 함께 고정한다 - 이 값이 1.0 근처로
    # 내려가면 픽스처가 완전 평면으로 퇴화했다는 뜻이고, 그러면 정합 테스트 전체가
    # 수평 방향으로 아무것도 증명하지 못한다.
    assert reg["horizontal_sensitivity"] > HORIZONTAL_SENSITIVITY_MIN, (
        f"픽스처 감도 {reg['horizontal_sensitivity']:.3f} - 수평 특징이 사라졌다")
    json.dumps(reg["horizontal_sensitivity"])


def test_register_stores_horizontal_sensitivity_on_failure_too(tmp_path):
    """실패해도 감도를 남긴다 - "왜 못 믿는지"의 근거는 실패했을 때 더 필요하다.

    실패 경로에서 관측치를 통째로 비우면, 화면은 "실패했다"만 말할 수 있고
    사용자는 대응점을 다시 찍을지 스캔을 다시 뜰지 판단할 근거가 없다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg, a_x=(0.0, 3.5), b_x=(3.2, 8.0), b_holes=[(3.5, 4.7)],
               corr_xy=np.array([[3.25, 0.4], [3.45, 1.1], [3.28, 2.7], [3.42, 2.0]]))

    _run(db, cfg)

    reg = db.registrations[_REG_ID]
    assert reg["status"] == "failed"
    assert reg["horizontal_sensitivity"] is not None, "실패 경로에서 감도가 버려졌다"
    assert reg["rmse_mm"] is not None and reg["overlap_ratio"] is not None


def test_register_writes_null_not_nan_for_non_finite_metrics(tmp_path, monkeypatch):
    """NaN 관측치는 **NULL**로 보낸다 - PostgREST는 JSON에 NaN을 실을 수 없다.

    엔진은 대응이 3쌍 미만이거나 프로브가 성립하지 않으면 `nan`을 낸다(기본값도
    `nan`이다). 그대로 PATCH하면 표준 JSON에 없는 `NaN` 토큰이 나가 PostgREST가
    400으로 거절하고, **정합을 다 끝낸 뒤에** 잡이 실패한다. FakeDB는 파이썬
    객체를 그대로 담아 두므로 이 회귀를 구조적으로 못 잡는다 - 그래서 값 자체를
    단언한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg)
    real = reg_mod.register_clouds

    def _spy(*a, **k):
        return dataclasses.replace(real(*a, **k), horizontal_sensitivity=float("nan"))

    monkeypatch.setattr(reg_mod, "register_clouds", _spy)

    _run(db, cfg)

    reg = db.registrations[_REG_ID]
    assert reg["status"] == "done"
    assert reg["horizontal_sensitivity"] is None, (
        f"NaN이 그대로 저장됐다: {reg['horizontal_sensitivity']!r}")
    assert "NaN" not in json.dumps(reg["horizontal_sensitivity"])


# -- 대응점 기하 검사는 파일 읽기 전에 (스펙 8) --------------------------------

def test_register_rejects_clustered_correspondences_before_reading_any_file(
        tmp_path, monkeypatch):
    """한곳에 몰린 대응점은 **원본을 내려받기 전에** 거부한다.

    "대응점이 몰렸다"는 사용자가 화면에서 즉시 고칠 수 있는 종류다. 검사를 정합
    직전에 두면 A·B 두 원본을 내려받아 격자화까지 끝낸 **뒤에야** 사유가 나오고,
    게다가 예외로 올리면 대응점이 그대로인 채 무거운 잡이 3회 돈다(같은 결과).
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg, corr_xy=_CLUSTERED_CORR_XY)
    downloads = _count_downloads(monkeypatch)

    _run(db, cfg)   # 예외를 올리지 않는다

    assert downloads["n"] == 0, (
        f"원본을 {downloads['n']}번 내려받은 뒤에야 대응점을 거부했다")
    reg = db.registrations[_REG_ID]
    assert reg["status"] == "failed"
    assert "몰려" in reg["error_text"], reg["error_text"]
    assert _merged_scan(db) is None


def test_register_geometry_check_is_done_in_metres_not_file_units(tmp_path, monkeypatch):
    """기하 검사는 **미터**를 전제한다 - 임계가 클릭 오차(5cm)라는 물리량이다.

    ★ 환산을 빠뜨리면 게이트가 **mm 파일에서만 조용히 사라진다**. 실측: 3cm 안에
    몰린 4점의 측방 퍼짐이 미터로 0.87cm(거부)인데 같은 점을 mm 파일 좌표로 재면
    866cm가 되어 임계를 가볍게 통과한다. 미터 픽스처만으로는 이 회귀를 절대
    잡을 수 없다(환산이 항등식이라서) - 변이 5에서 겪은 그 함정과 같은 구조다.

    ★ **두 스캔을 모두 mm로 둔다.** 한쪽만 mm로 두면 미터 쪽 스캔의 검사가 먼저
    걸려서 통과해 버린다 - 실측으로 확인했다(A=미터·B=mm 픽스처에서는 "환산 전에
    검사한다"는 변이가 **생존했다**). 검사 순서에 기대지 않으려면 두 쪽 다 환산이
    필요한 상태여야 한다. 배율이 서로 다른 경우는
    `test_register_scales_correspondences_by_each_sources_unit_scale`이 맡는다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg, unit_scale_a=0.001, unit_scale_b=0.001,
               corr_xy=_CLUSTERED_CORR_XY)
    downloads = _count_downloads(monkeypatch)

    _run(db, cfg)

    assert downloads["n"] == 0, "mm 파일에서 몰린 대응점이 게이트를 빠져나갔다"
    reg = db.registrations[_REG_ID]
    assert reg["status"] == "failed"
    assert "몰려" in reg["error_text"], reg["error_text"]


def test_register_does_not_retry_correspondence_errors_raised_after_loading(
        tmp_path, monkeypatch):
    """점군을 받은 **뒤에** 나오는 대응점 거부도 재시도로 태우지 않는다.

    엔진의 대응점 게이트 중 "정합 영역 대비 퍼짐"은 점군의 xy 범위를 알아야 해서
    파일을 읽기 전에는 원리적으로 판정할 수 없다 - `register_clouds` 안에서야
    ValueError로 나온다. 그래도 사용자가 즉시 고칠 수 있는 종류(넓게 다시 찍으면
    된다)이고 재시도해도 같은 결과이므로, 예외를 올리지 않고 `registrations`에
    사유를 남기고 끝낸다. 파일 읽기는 이미 끝났지만 **재시도 2회는 아낀다.**

    ★ 어떤 배치가 그 게이트에 걸리는지는 **엔진 테스트의 몫**이라 여기서 픽스처로
    재현하지 않는다. 실제로 그렇게 썼다가 임계가 조정되는 동안 이 테스트가
    초록·빨강을 오갔다(실측). 여기서 고정할 계약은 "엔진이 결정론적 ValueError를
    내면 워커가 어떻게 처리하는가" 하나뿐이므로, 그 예외를 직접 주입한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg)
    downloads = _count_downloads(monkeypatch)
    storage = get_storage(cfg, db)
    reason = "대응점이 정합 영역의 좁은 구역에만 몰려 있습니다(퍼짐 0.42m가 영역 4.6m의 9%)."

    def _boom(*a, **k):
        raise ValueError(reason)

    monkeypatch.setattr(reg_mod, "register_clouds", _boom)

    _run(db, cfg)   # 예외를 올리지 않는다

    reg = db.registrations[_REG_ID]
    assert reg["status"] == "failed"
    assert reg["error_text"] == reason, "엔진이 준 한국어 사유가 그대로 남아야 한다"
    assert _merged_scan(db) is None
    assert storage.download(f"artifacts/registrations/{_REG_ID}/merged.ply") is None
    # 이 경로는 정의상 파일을 읽은 **뒤**다 - 조기 게이트에서 걸렸다면 이 테스트가
    # 검증하려던 구간을 아예 안 탄 것이므로 함께 고정한다.
    assert downloads["n"] > 0, "원본을 읽기 전에 끝났다 - 사후 경로를 시험하지 못했다"


# -- 설계 결정 F8: 병합은 두 소스의 서브셀 중앙값 -----------------------------

def test_register_merged_cloud_is_subcell_median_of_both_sources(tmp_path):
    """중첩 서브셀에 두 소스의 점이 함께 들어가 중앙값이 뽑히는가 (설계 결정 F8).

    한쪽만 쓰거나 단순 이어붙이기면 잡힌다:
    - A만 쓰면 B 단독 구간(x > 3.5)의 점이 통째로 없다.
    - B만 쓰면 A 단독 구간(x < 1.5)의 점이 없다.
    - 이어붙이기면 점 수가 두 소스 서브셀 수의 합에 가깝다(중앙값이면 합집합 셀 수).
    - **중첩 구간에서 두 소스의 값이 서로 다를 때** 병합 값이 그 사이에 있어야
      한다. B에만 있는 국소 융기(8mm)를 넣어 그 차이를 만든다 - 두 소스가 같은
      값을 담으면 "중앙값"과 "한쪽 값"을 구별할 수 없다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    blob_c, blob_r, blob_h = (2.4, 1.55), 0.30, 0.008
    _seed_pair(db, cfg, b_blob=(blob_c, blob_r, blob_h))
    storage = get_storage(cfg, db)

    _run(db, cfg)

    merged = _merged_points(storage, tmp_path)
    assert (merged[:, 0] < 1.4).sum() > 100, "A 단독 구간이 병합 결과에 없다 - A를 쓰지 않았다"
    assert (merged[:, 0] > 3.6).sum() > 100, "B 단독 구간이 병합 결과에 없다 - B를 쓰지 않았다"

    n_a, n_b = _subcell_count(cfg, "scanA", 1.0), _subcell_count(cfg, "scanB", 1.0)
    assert len(merged) < 0.9 * (n_a + n_b), (
        f"병합 점 수 {len(merged)}가 두 소스 합({n_a + n_b})에 가깝다 - 중앙값이 아니라 이어붙였다")

    # 중첩 구간의 융기 안쪽: A는 표면 그대로(+0), B는 +8mm. 두 소스의 중앙값이면
    # 그 사이 값이 나와야 한다.
    r = np.hypot(merged[:, 0] - blob_c[0], merged[:, 1] - blob_c[1])
    inside = merged[r < blob_r - 0.10]
    assert len(inside) > 30, f"융기 안쪽 병합 점이 {len(inside)}개뿐이다"
    delta = float(np.mean(inside[:, 2] - _surface_z(inside[:, 0], inside[:, 1])))
    assert 0.25 * blob_h < delta < 0.75 * blob_h, (
        f"융기 안쪽 병합 z 편차가 {delta * 1000:.2f}mm - A만({0:.2f}mm) 또는 "
        f"B만({blob_h * 1000:.2f}mm) 쓴 값에 붙어 있다")


def test_register_merges_in_absolute_height_not_bbox_relative_offsets(tmp_path):
    """grid_to_points의 z는 **절대 높이가 아니라 bbox_min[2] 상대값**이다.

    두 스캔의 bbox가 다르면 오프셋도 서로 다르다 - 그대로 정합에 넣으면 그 차이가
    z 평행이동에 통째로 섞인다. 여기서는 B에만 깊은 구덩이(-0.8m)를 둬 B의
    bbox_min[2]를 A보다 0.8m 낮춘다. 오프셋을 되돌리지 않으면 초기 정렬이 0.8m
    어긋나 max_pair_dist(0.5m) 밖으로 나가고 중첩 부족으로 실패한다.

    바닥 자체는 절대 z=100m에 둔다 - 상대 z를 그대로 쓰면 병합 결과가 0 근처로
    나오므로, 성공하더라도 높이가 통째로 어긋난 것을 이 단언이 잡는다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    base = 100.0
    _seed_pair(db, cfg, a_base_z=base, b_base_z=base,
               b_blob=((5.4, 1.5), 0.5, -0.8))   # B에만 있는 깊은 구덩이
    storage = get_storage(cfg, db)

    _run(db, cfg)

    reg = db.registrations[_REG_ID]
    assert reg["status"] == "done", f"정합이 실패했다: {reg['error_text']}"
    merged = _merged_points(storage, tmp_path)
    floor = merged[merged[:, 0] < 4.5]          # 구덩이 밖(바닥) 구간
    assert float(np.median(floor[:, 2])) == pytest.approx(base, abs=0.05), (
        f"병합 바닥 높이 중앙값이 {np.median(floor[:, 2]):.3f}m - 절대 높이(100m)가 아니다")


def test_register_scales_correspondences_by_each_sources_unit_scale(tmp_path):
    """대응점은 **파일 단위 월드 좌표**다(설계 결정 F7) - 각 소스의 unit_scale을
    곱해 미터로 맞춰야 한다.

    ★ 이 테스트는 변이 실험이 요구해서 추가했다. 다른 테스트는 전부 미터 픽스처
    (unit_scale=1.0)라 환산이 항등식이 되고, 그래서 "환산을 통째로 빼는" 변이가
    **9건 전부 통과하며 생존했다**(실측). mm 파일이 정상 입력인 이상(스캐너 앱이
    mm로 내보내는 경우가 흔하다) 그 회귀는 운영에서 1000배 틀린 정합으로 나타난다.

    A는 미터, B는 mm로 **서로 다르게** 둔다 - 한쪽 배율을 두 대응점 모두에 쓰는
    변이(흔한 실수)도 함께 잡기 위해서다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg, unit_scale_a=1.0, unit_scale_b=0.001)
    storage = get_storage(cfg, db)

    _run(db, cfg)

    reg = db.registrations[_REG_ID]
    # 반대 방향 회귀도 함께 막는다: 넓게 퍼진 **정상** 배치가 mm 파일이라는 이유로
    # 기하 검사에 거부되면 안 된다(환산을 두 번 하거나 나눗셈으로 하면 그렇게 된다).
    assert reg["status"] == "done", f"mm 파일 정합이 실패했다: {reg['error_text']}"
    merged = _merged_points(storage, tmp_path)
    # 병합 점군은 미터다. 환산을 빠뜨리면 애초에 정합이 실패하지만, 혹시 성공하더라도
    # 좌표가 1000배로 남는 것을 여기서 잡는다.
    assert merged[:, 0].max() < 7.0, f"병합 좌표가 미터가 아니다(x_max={merged[:, 0].max():.1f})"
    assert (merged[:, 0] < 1.4).sum() > 100 and (merged[:, 0] > 3.6).sum() > 100


# -- 설계 결정 F10: 실패 사유는 registrations에 --------------------------------

def test_register_failure_writes_reason_to_registrations_not_just_jobs(tmp_path):
    """jobs 테이블은 RLS 정책이 0개라 대시보드가 못 읽는다 (설계 결정 F10).

    실패 사유가 registrations.error_text에 남아야 화면이 보여줄 수 있다. 그리고
    예외로 올리지 않는다 - 중첩 부족은 재시도해도 결과가 같은데, 예외로 올리면
    fn_job_fail이 3회까지 무거운 잡을 다시 돌린다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    # 중첩 0.3m + 그 뒤 빈 띠 1.2m: 남는 대응이 깨끗한 중첩분뿐이라 RMSE 게이트가
    # 아니라 **중첩 가드**가 실패시킨다.
    _seed_pair(db, cfg, a_x=(0.0, 3.5), b_x=(3.2, 8.0), b_holes=[(3.5, 4.7)],
               corr_xy=np.array([[3.25, 0.4], [3.45, 1.1], [3.28, 2.7], [3.42, 2.0]]))

    _run(db, cfg)   # 예외를 올리지 않는다

    reg = db.registrations[_REG_ID]
    assert reg["status"] == "failed"
    assert reg["error_text"], "실패 사유가 registrations에 남지 않았다 - 화면이 보여줄 곳이 없다"
    assert "중첩" in reg["error_text"], reg["error_text"]


def test_register_low_overlap_marks_failed_and_creates_no_scan(tmp_path):
    """중첩 부족이면 병합 스캔을 만들지 않는다 - 쓰레기 스캔이 목록에 남으면 안 된다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg, a_x=(0.0, 3.5), b_x=(3.2, 8.0), b_holes=[(3.5, 4.7)],
               corr_xy=np.array([[3.25, 0.4], [3.45, 1.1], [3.28, 2.7], [3.42, 2.0]]))
    storage = get_storage(cfg, db)

    _run(db, cfg)

    # 이름이 약속한 계약을 먼저 단언한다 - status를 먼저 보면 "저중첩에서도 병합
    # 스캔을 만드는" 변이가 상태 단언에서 먼저 걸려, 정작 이 테스트가 막으려던
    # "쓰레기 스캔"이 실제로 확인됐는지가 드러나지 않는다.
    assert _merged_scan(db) is None, "실패했는데 병합 스캔이 목록에 남았다"
    assert storage.download(f"artifacts/registrations/{_REG_ID}/merged.ply") is None, (
        "실패했는데 병합 점군 파일이 저장소에 올라갔다")
    assert db.registrations[_REG_ID]["status"] == "failed"
    assert db.registrations[_REG_ID]["result_scan_id"] is None


# -- 원본 보존 (스펙 6.3) -----------------------------------------------------

def test_register_does_not_touch_source_scans(tmp_path):
    """원본 두 개는 그대로 남는다 (스펙 6.3)."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg)
    storage = get_storage(cfg, db)
    before = {sid: dict(db.scans[sid]) for sid in ("scanA", "scanB")}
    raw_before = {sid: storage.download(f"raw-scans/site1/{sid}/raw.ply")
                  for sid in ("scanA", "scanB")}

    _run(db, cfg)

    for sid in ("scanA", "scanB"):
        assert db.scans[sid] == before[sid], f"{sid} 행이 바뀌었다"
        assert storage.download(f"raw-scans/site1/{sid}/raw.ply") == raw_before[sid], (
            f"{sid} 원본 파일이 바뀌었다")


# -- 러너 배선 ----------------------------------------------------------------

def test_register_is_wired_into_the_default_handler_table():
    """러너 기본 배선 - 이 단언이 없으면 핸들러를 만들어 놓고 등록을 빠뜨려도
    아무도 모른다(잡은 "핸들러 없음"으로 3회 재시도 후 실패한다)."""
    assert _DEFAULT_HANDLERS["register"] is handle_register


def test_register_job_runs_end_to_end_through_the_runner(tmp_path):
    """enqueue -> claim -> 기본 배선 핸들러 -> complete까지 실제로 흐르는가.

    잡 큐 부수효과(FakeDB의 register 분기 = 012_register_support.sql 미러)도 이
    경로에서만 함께 돈다: 클레임이 registrations를 'processing'으로 바꿔 놓은 뒤
    핸들러가 'done'으로 확정한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_pair(db, cfg)
    db.registrations[_REG_ID]["status"] = "queued"
    jid = db.enqueue_job("register", {"registration_id": _REG_ID})

    run_loop(db, cfg, max_iterations=1)   # handlers= 생략 -> _DEFAULT_HANDLERS 사용

    assert db.jobs[jid]["status"] == "done", db.jobs[jid]["error"]
    assert db.registrations[_REG_ID]["status"] == "done"
    assert _merged_scan(db) is not None

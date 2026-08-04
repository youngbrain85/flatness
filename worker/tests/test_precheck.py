"""handle_precheck 단위 테스트 (세부과업 4 단계 E) — 지금까지 하나도 없었다.

핵심 계약(태스크 브리프 + 1차 리뷰 반영):
1. 렌더/업로드 실패가 scans.status 승격을 막으면 안 된다(설계 결정 E1) - precheck가
   실패로 끝나면 fn_job_fail이 scans.status='failed'로 만들고 사용자는 아무것도
   못 한다(003_dashboard_support.sql). 높이 뷰는 편의 기능이지 필수 경로가 아니다.
   **이 계약은 RuntimeError 하나가 아니라 실제 throw 지점 전부에 대해 성립해야
   한다** - _fetch_raw(ValueError, 운영에서 가장 흔하다)·upload_dir(OSError)까지
   각각 고정한다. 하나만 고정하면 `except Exception`을 `except RuntimeError`로
   좁히는 회귀가 조용히 살아남는다(1차 리뷰 실측: 그 변이가 생존했다).
2. 실패는 로그에 남긴다 - DB 영속화(scans에 warnings 컬럼이 없다)와 관측
   가능성은 다른 문제다. 로그가 없으면 높이 뷰가 전량 실패해도 잡은 done,
   스캔은 ready, 로그는 깨끗해서 운영자가 알아낼 방법이 없다.
3. 산출물은 artifacts/scans/{scan_id}/ 에 올라간다(raw-scans/가 아니다 - 그 버킷은
   authenticated가 전면 쓰기 가능이라 워커 산출물이 브라우저에 덮일 수 있다).
   장식 PNG·장식 없는 PNG·사이드카 JSON 3종이 함께 올라간다.
4. 격자는 scale_to_m=1.0으로 만들고, 서브셀 크기는 **반드시 bbox에서 유도**한다
   (고정 상수 금지 - mm 단위 파일에서 격자가 폭발한다, 설계 결정 E3).
5. scans.point_count를 read_info의 n_points로 채운다.
6. 유효 서브셀이 하나도 없어도 렌더·업로드한다(결정 번복 - 아래 해당 테스트의
   독스트링 참고).
"""
import json
import math

import numpy as np

from flatness.outputs.height_view import subcell_m_for_bbox

from flatworker.artifacts import raw_scan_dir
from flatworker.config import Config
from flatworker.jobs import handle_precheck
from flatworker.storage import get_storage
from tests.fake_db import FakeDB
from tests.synthetic_helpers import synthetic

flat_floor, add_bump, write_binary_ply = (
    synthetic.flat_floor, synthetic.add_bump, synthetic.write_binary_ply)

# mm 단위 픽스처 크기(파일 좌표 그대로 - m가 아니다). 8m x 6m 방을 mm로 담은 파일.
_MM_W, _MM_H = 8000.0, 6000.0


def _cfg(tmp_path):
    return Config(supabase_url="http://fake", service_role_key="k",
                 data_dir=tmp_path / "data", poll_interval_s=0.01, worker_id="w1")


def _scan_row(unit_scale=None):
    return {
        "id": "scan1", "site_id": "site1", "surface": "floor",
        "raw_file_path": "raw-scans/site1/scan1/raw.ply",
        "unit_scale": unit_scale, "status": "uploaded",
    }


def _seed_scan(db, cfg, unit_scale=None, n_pts_side=(6.0, 6.0), spacing=0.02):
    """precheck용 스캔 행 + 원본 PLY를 시드한다. 충분히 조밀한 평탄 바닥 + 범프."""
    pts = add_bump(flat_floor(size=n_pts_side, spacing=spacing), (2.0, 2.0), 0.3, 0.05)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_binary_ply(pts, sd / "raw.ply")
    db.scans["scan1"] = _scan_row(unit_scale)
    return len(pts)


def _seed_mm_scan(db, cfg, unit_scale=1.0):
    """mm 단위 파일을 흉내낸 픽스처: 좌표가 0~8000 x 0~6000이다.

    precheck는 정의상 단위 미확정 상태에서 도는 잡이라 이런 파일이 **정상
    입력**이다(설계 결정 E3의 전제). spacing=12.5는 subcell_m_for_bbox가 주는
    서브셀(8000/256 = 31.25)당 2~3점/축 = 4~9점이라 min_points(3)를 넘겨,
    유도된 서브셀로도 유효 셀이 실제로 생긴다는 것까지 함께 확인한다.
    """
    pts = flat_floor(size=(_MM_W, _MM_H), spacing=12.5)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_binary_ply(pts, sd / "raw.ply")
    db.scans["scan1"] = _scan_row(unit_scale)
    return len(pts)


def _fail_render(monkeypatch, exc=None):
    """render_height_view를 '불렸는지 세는' 가짜로 바꾸고 그 카운터를 돌려준다.

    호출 카운터가 이 헬퍼의 존재 이유다(1차 리뷰 실측). 예전 렌더 실패 테스트
    2종은 렌더 가드를 `if False:`로 바꿔 render_height_view 호출을 **완전히
    차단해도 그대로 통과**했다 - 주입한 가짜가 한 번도 불리지 않아도 "렌더가
    실패해도 상태는 승격된다"는 단언 자체는 참이기 때문이다. 그러면 픽스처·
    가드·엔진 상수(_TARGET_LONG_SIDE 등)가 어떻게 바뀌든 "렌더에 도달조차 못
    함"이 조용히 재발해도 초록불이라 아무도 모른다. 그래서 호출부는 반드시
    `assert called["n"] == 1`로 도달 자체를 함께 고정한다.
    """
    called = {"n": 0}

    def _boom(*a, **k):
        called["n"] += 1
        raise (exc if exc is not None else RuntimeError("렌더 실패"))

    monkeypatch.setattr("flatworker.jobs.render_height_view", _boom)
    return called


def _png_size(blob):
    """PNG 바이트에서 (가로, 세로) 픽셀 크기를 읽는다.

    PNG 서명 8바이트 다음이 IHDR 청크(길이 4 + 타입 4 + width 4 + height 4)라
    width는 오프셋 16, height는 20에 있다. Pillow를 끌어들이지 않고 픽셀 크기만
    확인하기 위한 최소 파서다.
    """
    assert blob[:8] == b"\x89PNG\r\n\x1a\n"
    return int.from_bytes(blob[16:20], "big"), int.from_bytes(blob[20:24], "big")


# -- 상태 승격 ------------------------------------------------------------

def test_precheck_sets_ready_when_unit_scale_present(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_scan(db, cfg, unit_scale=1.0)
    handle_precheck(db, cfg, {"scan_id": "scan1"})
    assert db.scans["scan1"]["status"] == "ready"


def test_precheck_sets_awaiting_unit_confirm_when_unit_scale_absent(tmp_path):
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_scan(db, cfg, unit_scale=None)
    handle_precheck(db, cfg, {"scan_id": "scan1"})
    assert db.scans["scan1"]["status"] == "awaiting_unit_confirm"


# -- 정상 경로 산출물 ------------------------------------------------------

def test_precheck_renders_height_view_and_uploads_sidecar(tmp_path):
    """정상 경로: PNG 2종 + JSON 사이드카가 artifacts/scans/{scan_id}/ 아래
    올라가고 height_view_path가 장식 PNG 키를 가리켜야 한다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    storage = get_storage(cfg, db)
    n = _seed_scan(db, cfg, unit_scale=None)  # 단위 확정 전에도 렌더는 돌아야 한다(E1)

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    scan = db.scans["scan1"]
    assert scan["height_view_path"] == "artifacts/scans/scan1/height_view.png"
    assert storage.download("artifacts/scans/scan1/height_view.png") is not None
    assert storage.download("artifacts/scans/scan1/height_view_plain.png") is not None
    assert storage.download("artifacts/scans/scan1/height_view.json") is not None
    assert scan["point_count"] == n


def test_precheck_uploads_plain_png_sized_exactly_like_the_grid(tmp_path):
    """장식 없는 PNG도 함께 올라가고, 그 픽셀 크기가 사이드카 shape과 정확히
    같아야 한다(격자 1칸 = 이미지 1픽셀).

    장식 PNG(제목·여백·컬러바)로는 브라우저 클릭 픽셀을 월드 좌표로 되돌릴 수
    없어 단계 F(정합)가 막힌다 - render_height_view_plain의 좌표 계약이 바로
    "이미지 크기 == 사이드카 shape"이라 별도 image_size_px 필드가 필요 없다는
    것이다. 그래서 픽셀 크기까지 함께 고정한다: 실수로 장식 PNG를
    height_view_plain.png 이름으로 복사하는 회귀는 '파일 존재' 확인만으로는
    못 잡지만 이 단언은 잡는다(장식 PNG는 dpi 140 figure라 크기가 전혀 다르다).

    DB 컬럼은 새로 만들지 않는다 - 사이드카 JSON과 같은 관례로 다음 단계가
    height_view_path에서 파일명만 바꿔 유도한다. 그래서 '같은 디렉터리 + 약속된
    파일명'이 계약 자체이며, 여기서도 그 유도 방식 그대로 키를 만들어 확인한다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    storage = get_storage(cfg, db)
    _seed_scan(db, cfg, unit_scale=1.0)

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    plain_key = db.scans["scan1"]["height_view_path"].replace(
        "height_view.png", "height_view_plain.png")
    plain = storage.download(plain_key)
    assert plain is not None, "장식 없는 PNG가 없으면 단계 F가 좌표 역산을 못 한다"

    meta = json.loads(storage.download("artifacts/scans/scan1/height_view.json"))
    ny, nx = meta["shape"]
    assert _png_size(plain) == (nx, ny)
    # 장식 PNG는 같은 격자에서 나왔어도 크기가 다르다 - 두 파일이 실제로 서로
    # 다른 렌더러의 결과임을 확인한다(같은 함수를 두 번 부르는 회귀 차단).
    decorated = storage.download("artifacts/scans/scan1/height_view.png")
    assert _png_size(decorated) != (nx, ny)


def test_precheck_upload_prefix_is_artifacts_scans_not_raw_scans(tmp_path):
    """산출물은 artifacts/scans/{scan_id}/ 여야 한다 - raw-scans/는 authenticated가
    전면 쓰기 가능이라 워커 산출물이 브라우저에 덮일 수 있다(설계 결정 E2)."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    storage = get_storage(cfg, db)
    _seed_scan(db, cfg, unit_scale=1.0)

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    path = db.scans["scan1"]["height_view_path"]
    assert path.startswith("artifacts/scans/scan1/")
    assert not path.startswith("raw-scans/")
    # DB 문자열만이 아니라 실제 업로드 목적지도 확인한다 - DB 필드 문자열은
    # 그대로 두고 storage.upload_dir에 넘기는 prefix만 raw-scans/로 바뀌는
    # 회귀(원본 스캔 버킷에 산출물이 쓰이는 경우)는 문자열 비교만으로는 못
    # 잡는다.
    assert storage.download("artifacts/scans/scan1/height_view.png") is not None
    assert storage.download("raw-scans/scan1/height_view.png") is None


def test_precheck_height_view_path_is_bucket_relative_not_absolute(tmp_path):
    """DB에는 버킷-상대 문자열만 저장한다(slope.py의 normalize_slope_stats와 같은
    관례) - OS 절대경로나 워커 CWD 상대경로가 아니다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_scan(db, cfg, unit_scale=1.0)

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    path = db.scans["scan1"]["height_view_path"]
    assert path == "artifacts/scans/scan1/height_view.png"
    import os
    assert not os.path.isabs(path)


# -- 격자 구성 (설계 결정 E3) ----------------------------------------------

def test_precheck_builds_grid_with_unscaled_coordinates(tmp_path, monkeypatch):
    """격자는 scale_to_m=1.0으로 만들어야 한다 - 단위 확정 전이라 scans.unit_scale을
    아직 모른다(설계 결정 E3). unit_scale=2.0으로 시드해도 grid는 그 값을 쓰면 안
    된다 - 실제로 build_subcell_grid에 넘어간 scale_to_m 인자를 가로채 검증한다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_scan(db, cfg, unit_scale=2.0)

    captured = {}
    import flatworker.jobs as jobs_mod
    real = jobs_mod.build_subcell_grid

    def _spy(chunks, info, scale_to_m, *a, **k):
        captured["scale_to_m"] = scale_to_m
        return real(chunks, info, scale_to_m, *a, **k)

    monkeypatch.setattr(jobs_mod, "build_subcell_grid", _spy)

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    assert captured["scale_to_m"] == 1.0


def test_precheck_derives_subcell_from_bbox_for_mm_unit_file(tmp_path, monkeypatch):
    """서브셀 크기는 subcell_m_for_bbox로 bbox에서 유도해야 한다 - 고정 상수 금지
    (설계 결정 E3).

    precheck는 정의상 단위 미확정 상태에서 도는 잡이라 mm 단위 파일(좌표
    8000 x 6000)이 정상 입력이다. 여기서 0.05 같은 고정 상수를 쓰면
    nx=160,000 x ny=120,000 격자가 되어 median_z 배열 하나만 71.5GB다.
    컨테이너에서는 OOM Kill(SIGKILL)이라 handle_precheck의 except로도 못 잡고
    워커 프로세스가 통째로 죽는다 - 잡은 processing에 고착됐다가 30분 뒤
    reap -> 재시도 -> 재사망을 반복한다. 설계 결정 E3이 막으려던 사고가 바로
    이것이다.

    1차 리뷰 실측: 이 사용처가 전혀 고정되지 않아 `subcell_m = 0.05` 하드코딩·
    `subcell_m_for_bbox(info) * 4.0` 두 변이가 146개 전부 통과하며 생존했다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_mm_scan(db, cfg, unit_scale=1.0)

    seen = {}
    import flatworker.jobs as jobs_mod
    real = jobs_mod.build_subcell_grid

    def _spy(chunks, info, scale_to_m, subcell_m, *a, **k):
        seen["passed"] = subcell_m
        seen["expected"] = subcell_m_for_bbox(info)   # 엔진 원본을 직접 부른 기준값
        seen["cells"] = (math.ceil(_MM_W / subcell_m) * math.ceil(_MM_H / subcell_m))
        if subcell_m < seen["expected"]:
            # 폭발하는 값을 실제로 태우면 numpy가 수십 GB를 할당하려 든다 -
            # 운영에서는 OOM Kill이고 여기서는 테스트 프로세스 사망이라 "빨간불"
            # 조차 볼 수 없다. 값만 기록하고 진짜 할당은 막는다. 단언은 반드시
            # handle_precheck **밖**에서 한다(AssertionError도 Exception이라
            # 안에서 던지면 렌더 격리 except가 삼켜 초록불이 된다).
            raise RuntimeError("격자 폭발 방어(테스트 하네스)")
        return real(chunks, info, scale_to_m, subcell_m, *a, **k)

    monkeypatch.setattr(jobs_mod, "build_subcell_grid", _spy)

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    assert seen["passed"] == seen["expected"], (
        f"서브셀을 bbox에서 유도하지 않았다: 넘어간 값={seen['passed']}, "
        f"subcell_m_for_bbox={seen['expected']} (격자 {seen['cells']:,}칸)")
    assert seen["cells"] <= 256 * 256, f"격자 폭발: {seen['cells']:,}칸"
    # mm 파일이어도 정상 경로는 끝까지 간다(유효 셀이 실제로 생긴다).
    assert db.scans["scan1"]["height_view_path"] == "artifacts/scans/scan1/height_view.png"


# -- 유효 서브셀 0개 (결정 번복) --------------------------------------------

def test_precheck_uploads_even_when_no_valid_subcells(tmp_path):
    """유효 서브셀이 하나도 없어도(전부 NaN) 렌더·업로드하고 height_view_path를
    채워야 한다. **이전 구현의 스킵 분기를 뒤집은 것이다(결정 번복).**

    이전 구현은 "아무 형체도 없는 회색 한 장을 근거로 사용자가 단위를 잘못
    확정할 위험이 그림이 아예 없음보다 크다"며 건너뛰었다. 그 전제가 Task 1의
    1차 리뷰 반영(엔진 커밋 032980a)으로 더 이상 사실이 아니다:

      - 전부 NaN이면 render_height_view는 **거짓 컬러바를 아예 만들지 않고**
        "유효 데이터 없음 - 점 밀도 부족"이라고 한국어로 못 박는다.
      - 그러고도 X·Y 축 눈금은 **진짜 bbox 값**을 "파일 단위" 라벨과 함께
        찍는다. 파일이 mm였다면 그 축이 8000 x 6000으로 읽혔을 것이다.

    **축 눈금이 곧 단위의 답이다** - 높이 색깔은 단위 판단에 필요조차 없다.
    건너뛰면 그 유일한 단서를 지우고 그 자리에 아무 표시도 남기지 않는다
    (게다가 예외가 아니라 의도적 분기라 로그조차 남지 않았다).
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    storage = get_storage(cfg, db)
    # 동일 좌표 점 2개 뿐 -> 유일한 서브셀의 점 수(2) < min_points(3) -> median_z 전부 NaN
    pts = np.array([[1.0, 1.0, 0.0], [1.0, 1.0, 0.0]], dtype=np.float64)
    sd = raw_scan_dir(cfg.data_dir, "site1", "scan1")
    write_binary_ply(pts, sd / "raw.ply")
    db.scans["scan1"] = _scan_row(unit_scale=1.0)

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    assert db.scans["scan1"]["status"] == "ready"
    assert db.scans["scan1"]["height_view_path"] == "artifacts/scans/scan1/height_view.png"
    assert storage.download("artifacts/scans/scan1/height_view.png") is not None
    assert storage.download("artifacts/scans/scan1/height_view_plain.png") is not None
    assert db.scans["scan1"]["point_count"] == 2
    # 이 픽스처가 정말 "유효 셀 0개"를 만드는지 사이드카로 확인한다 - 픽스처가
    # 조용히 유효해지면 이 테스트는 아무것도 검증하지 않는 셈이 된다.
    meta = json.loads(storage.download("artifacts/scans/scan1/height_view.json"))
    assert all(v is None for row in meta["median_z"] for v in row)


# -- 실패 격리 (설계 결정 E1) — throw 지점별로 각각 고정한다 ----------------

def test_precheck_promotes_status_even_when_render_fails(tmp_path, monkeypatch):
    """렌더가 죽어도 스캔은 진행 가능해야 한다(태스크 브리프 핵심 시나리오).

    precheck가 실패로 끝나면 fn_job_fail이 scans.status='failed'로 만들고
    사용자는 아무것도 못 한다(003_dashboard_support.sql). 렌더는 편의 기능이지
    필수 경로가 아니다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_scan(db, cfg, unit_scale=1.0)
    called = _fail_render(monkeypatch)

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    assert called["n"] == 1, "모의 실패가 한 번도 불리지 않았다 - 렌더에 도달조차 못 했다"
    assert db.scans["scan1"]["status"] in ("ready", "awaiting_unit_confirm")
    assert db.scans["scan1"].get("height_view_path") is None


def test_precheck_render_failure_does_not_lose_point_count(tmp_path, monkeypatch):
    """point_count는 read_info 직후에 채워지므로 그 뒤(렌더) 단계가 죽어도
    이미 얻은 값은 보존돼야 한다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    n = _seed_scan(db, cfg, unit_scale=1.0)
    called = _fail_render(monkeypatch)

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    assert called["n"] == 1, "모의 실패가 한 번도 불리지 않았다 - 렌더에 도달조차 못 했다"
    assert db.scans["scan1"]["point_count"] == n


def test_precheck_promotes_status_when_raw_file_is_missing(tmp_path):
    """원본 파일이 저장소에 없어도 상태는 승격돼야 한다 - **운영에서 가장 흔한
    실패 경로**인데 1차 리뷰 시점엔 테스트가 0건이었다.

    _fetch_raw는 RuntimeError가 아니라 **ValueError**를 던진다. 렌더 격리의
    `except Exception`이 `except RuntimeError`로 좁아지면 이 예외가
    handle_precheck 밖으로 튀어나가 잡이 실패하고, fn_job_fail이
    scans.status='failed'로 만들어 사용자가 완전히 막힌다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    db.scans["scan1"] = _scan_row(unit_scale=1.0)   # 원본 PLY를 일부러 만들지 않는다

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    assert db.scans["scan1"]["status"] == "ready"
    assert db.scans["scan1"].get("height_view_path") is None
    # read_info에 도달조차 못 했으므로 point_count도 남지 않는다(이 경로의 사실).
    assert db.scans["scan1"].get("point_count") is None


def test_precheck_promotes_status_when_upload_fails(tmp_path, monkeypatch):
    """업로드(upload_dir)가 죽어도 상태는 승격돼야 한다.

    upload_dir 실패는 렌더 실패와 또 다른 예외 타입(OSError - 디스크·네트워크)
    으로 온다. RuntimeError 하나만 고정하면 `except`의 폭이 좁아지는 회귀를
    못 잡는다(1차 리뷰 실측: `except RuntimeError:` 변이가 생존했다).

    부분 업로드로 인한 댕글링 포인터도 없다: upload_dir이 마지막에 한 번만
    돌고 height_view_path는 그 **뒤에** 설정되므로, 업로드가 실패하면 DB에
    가리킬 경로 자체가 남지 않는다.
    """
    from flatworker import storage as storage_mod
    called = {"n": 0}

    def _boom(self, prefix, src_dir):
        called["n"] += 1
        raise OSError("업로드 실패(디스크/네트워크)")

    monkeypatch.setattr(storage_mod.LocalStorage, "upload_dir", _boom)

    db, cfg = FakeDB(), _cfg(tmp_path)
    n = _seed_scan(db, cfg, unit_scale=None)

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    assert called["n"] == 1, "업로드에 도달조차 못 했다"
    assert db.scans["scan1"]["status"] == "awaiting_unit_confirm"
    assert db.scans["scan1"].get("height_view_path") is None
    assert db.scans["scan1"]["point_count"] == n   # 렌더 전에 확보한 값은 살아남는다


def test_precheck_logs_height_view_failure(tmp_path, monkeypatch, capsys):
    """실패 사유를 로그에 남긴다 - 조용히 삼키면 운영자가 알아낼 방법이 없다.

    scans에 warnings 컬럼이 없어 **DB에 영속화**할 수 없는 것과, 아무데도
    남기지 않는 것은 다른 문제다. 지금 구조상 높이 뷰가 전량 실패해도 잡은
    done, 스캔은 ready라 겉으로는 완전히 정상이다 - 로그마저 없으면 Railway
    로그가 깨끗해서 아무 신호가 없다(docs/DEPLOY.md "증상 - 로그를 믿지 마라
    ... Railway 로그에는 아무것도 남지 않고 워커도 죽지 않는다(실측 확인)"가
    이 저장소가 이미 한 번 데인 함정이다). runner.py의 `[flatworker]` 접두
    관례를 그대로 따른다.
    """
    db, cfg = FakeDB(), _cfg(tmp_path)
    _seed_scan(db, cfg, unit_scale=1.0)
    _fail_render(monkeypatch, RuntimeError("폰트 캐시 손상"))

    handle_precheck(db, cfg, {"scan_id": "scan1"})

    out = capsys.readouterr().out
    assert "[flatworker]" in out          # 러너와 같은 접두 - 로그 필터가 함께 걸린다
    assert "scan1" in out                 # 어느 스캔인지
    assert "폰트 캐시 손상" in out          # 원인(원래 예외 메시지 보존)

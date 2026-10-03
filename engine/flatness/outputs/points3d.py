"""points3d.bin 작성기·리더 (3D 점군 뷰어가 읽는 점 표본 컨테이너, schema_version = 1).

바이트 배치(전부 little-endian, n = 점 수, L = json_len):
  [0, 4)            magic b"FP3D"
  [4, 8)            uint32 json_len. 공백 패딩을 포함한 JSON 영역의 바이트 수. 8 + json_len 은 4의 배수
  [8, 8+L)          UTF-8 JSON 메타. 끝을 공백(0x20)으로 채운다
  [8+L, 8+L+6n)     uint16 xyz[3n]. 점마다 x, y, z 순서로 인터리브. 축 범위를 0..65535 로 양자화한 값
  [8+L+6n, 8+L+8n)  int16 dev[n]. 0.1mm 정수 편차 또는 센티널
복원: local = q * extent_m / 65535, abs = origin_m + local.

메타에는 엔진 버전·시드·판정 기준에 종속된 값(임계값 등)·분류 수·경로·시각을 넣지 않는다.
같은 스캔이면 기준을 바꿔 재분석해도 파일이 바이트 단위로 같아야 한다.
이 모듈은 matplotlib 를 쓰지 않는다(heatmap 부수효과 import 를 하지 않는다).
"""
import json
import math
import os
import struct
from pathlib import Path

import numpy as np

from flatness.core.pointsample import DEV_NO_DEVIATION, DEV_NOT_FLOOR, DEV_UNIT_M, MAX_POINTS, PointSample

MAGIC = b"FP3D"
SCHEMA_VERSION = 1
FILE_NAME = "points3d.bin"

_Q_MAX = 65535.0                    # uint16 양자화 최댓값
# 편차 정수 1단위(mm). 단위 상수의 정의는 core/pointsample.py 한 곳이다(스펙 §4.1). 1e-4 * 1000 은 float 0.1 과
# 같은 값이라 JSON 에 0.1 로 적힌다. 이 모듈에 0.1 리터럴을 따로 두지 않는다
_DEV_UNIT_MM = DEV_UNIT_M * 1000


def encode_points3d(sample: PointSample) -> bytes:
    """표본을 메모리에서 blob 하나로 완성한다. 검증 규칙을 어기면 ValueError."""
    xyz = np.asarray(sample.xyz_local)
    dev_in = np.asarray(sample.dev_q)
    if xyz.ndim != 2 or xyz.shape[1] != 3:
        raise ValueError(f"points3d: xyz_local 모양이 (n, 3) 이 아니다: {xyz.shape}")
    n = xyz.shape[0]
    if n < 1:
        raise ValueError("points3d: 점이 0개다")
    # 상한은 sample.cap 이 아니라 엔진 상수와 비교한다
    if n > MAX_POINTS:
        raise ValueError(f"points3d: 점 수 {n} 이 상한 {MAX_POINTS} 을 넘는다")
    if dev_in.shape != (n,) or dev_in.dtype != np.int16:
        raise ValueError(f"points3d: dev_q 는 int16 (n,) 이어야 한다: {dev_in.dtype} {dev_in.shape}")
    xyz = xyz.astype(np.float64, copy=False)
    if not np.isfinite(xyz).all():
        raise ValueError("points3d: 좌표에 유한하지 않은 값이 있다")

    mn = xyz.min(axis=0)
    ext = xyz.max(axis=0) - mn
    # 범위가 0인 축은 안전한 분모로 나눈 뒤 0 으로 덮는다(0 나눗셈 경고를 내지 않는다)
    inv = np.where(ext > 0, _Q_MAX / np.where(ext > 0, ext, 1.0), 0.0)
    # (n, 3) 의 C 순서가 곧 x, y, z 인터리브다
    q = np.clip(np.rint((xyz - mn) * inv), 0, 65535).astype("<u2")
    dev = dev_in.astype("<i2")

    # fit_bounds 는 양자화 뒤 복원 좌표로 계산한다(뷰어가 그리는 점을 정확히 감싼다)
    deq = q * ext / _Q_MAX
    has = dev > DEV_NO_DEVIATION
    if has.any():
        fit_min, fit_max = deq[has].min(axis=0), deq[has].max(axis=0)
    else:
        fit_min, fit_max = np.zeros(3), ext

    origin = np.asarray(sample.origin_abs, dtype=np.float64)
    # dict 삽입 순서가 곧 기록 순서다. 숫자는 Python float·int 로만 넣는다(repr 최단 왕복 표기)
    meta = {
        "schema_version": SCHEMA_VERSION,
        "n_points": int(n),
        "units": "m",
        "origin_m": [float(v) for v in origin + mn],
        "extent_m": [float(v) for v in ext],
        "deviation": {"unit_mm": _DEV_UNIT_MM, "not_floor": DEV_NOT_FLOOR, "no_deviation": DEV_NO_DEVIATION},
        "sample_cell_m": float(sample.sample_cell_m),
        "fit_bounds": {"min": [float(v) for v in fit_min], "max": [float(v) for v in fit_max]},
        "sampling": {"method": "cell min-hash stratified",
                     "source_points": int(sample.source_points), "cap": int(sample.cap)},
        "order": "hash",
    }
    # allow_nan=False: NaN·무한대가 섞이면 ValueError(브라우저의 JSON.parse 가 못 읽는 파일을 쓰지 않는다)
    js = json.dumps(meta, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("ascii")
    js += b" " * ((-(8 + len(js))) % 4)
    blob = MAGIC + struct.pack("<I", len(js)) + js + q.tobytes() + dev.tobytes()
    if len(blob) != 8 + len(js) + 8 * n or (8 + len(js)) % 4 != 0:
        raise ValueError("points3d: blob 길이가 형식과 맞지 않는다")
    return blob


def write_points3d(sample: PointSample, out_path: str | os.PathLike) -> str:
    """blob 을 한 번에 쓰고 파일명을 돌려준다. 쓰는 중 예외면 부분 파일을 지우고 다시 던진다."""
    blob = encode_points3d(sample)          # 검증 실패는 파일을 만들기 전에 난다
    path = Path(out_path)
    try:
        path.write_bytes(blob)
    except BaseException:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return path.name


def _reject_constant(token):
    # NaN·Infinity 토큰은 표준 JSON 이 아니다(브라우저의 JSON.parse 와 같게 거부한다)
    raise ValueError(token)


def _is_num(v) -> bool:
    """유한한 수인가. bool 은 수로 보지 않는다."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    try:
        return math.isfinite(v)
    except OverflowError:               # float 로 못 바꾸는 큰 정수
        return False


def _is_vec3(v) -> bool:
    return isinstance(v, list) and len(v) == 3 and all(_is_num(x) for x in v)


def _meta_ok(meta: dict) -> bool:
    """리더 규칙 6: 메타 형식. 모르는 키는 무시한다."""
    n = meta.get("n_points")
    if not (_is_num(n) and float(n).is_integer() and n >= 1):
        return False
    if meta.get("units") != "m":
        return False
    origin, extent = meta.get("origin_m"), meta.get("extent_m")
    if not (_is_vec3(origin) and _is_vec3(extent) and all(x >= 0 for x in extent)):
        return False
    d = meta.get("deviation")
    if not isinstance(d, dict):
        return False
    unit, not_floor, no_dev = d.get("unit_mm"), d.get("not_floor"), d.get("no_deviation")
    if not (_is_num(unit) and unit == _DEV_UNIT_MM
            and _is_num(not_floor) and not_floor == DEV_NOT_FLOOR
            and _is_num(no_dev) and no_dev == DEV_NO_DEVIATION):
        return False
    cell = meta.get("sample_cell_m")
    if not (_is_num(cell) and cell > 0):
        return False
    fit = meta.get("fit_bounds")
    if not isinstance(fit, dict):
        return False
    lo, hi = fit.get("min"), fit.get("max")
    if not (_is_vec3(lo) and _is_vec3(hi) and all(a <= b for a, b in zip(lo, hi))):
        return False
    return meta.get("order") == "hash"


def read_points3d(data: bytes) -> tuple[dict, np.ndarray, np.ndarray]:
    """blob 을 (meta, xyz_q uint16 (n, 3), dev_q int16 (n,)) 로 읽는다. 테스트·왕복 검증용.

    위에서부터 차례로 검사하고 처음 어긴 규칙의 사유를 메시지로 하는 ValueError 를 던진다:
    too_short, bad_magic, bad_header, bad_json, unsupported_version, bad_meta, size_mismatch.
    """
    size = len(data)
    if size < 8:
        raise ValueError("too_short")
    if bytes(data[:4]) != MAGIC:
        raise ValueError("bad_magic")
    (json_len,) = struct.unpack_from("<I", data, 4)
    if 8 + json_len > size or (8 + json_len) % 4 != 0:
        raise ValueError("bad_header")
    try:
        meta = json.loads(bytes(data[8:8 + json_len]).decode("utf-8"), parse_constant=_reject_constant)
    except ValueError:                   # UnicodeDecodeError, JSONDecodeError 도 ValueError 다
        raise ValueError("bad_json") from None
    if not isinstance(meta, dict):
        raise ValueError("bad_json")
    version = meta.get("schema_version")
    if isinstance(version, bool) or version != SCHEMA_VERSION:
        raise ValueError("unsupported_version")
    if not _meta_ok(meta):
        raise ValueError("bad_meta")
    n = int(meta["n_points"])
    if size != 8 + json_len + 8 * n:
        raise ValueError("size_mismatch")
    body = 8 + json_len
    # 엔디안을 dtype 에 명시한다(호스트 바이트 순서에 기대지 않는다)
    xyz_q = np.frombuffer(data, dtype="<u2", count=3 * n, offset=body).reshape(n, 3)
    dev_q = np.frombuffer(data, dtype="<i2", count=n, offset=body + 6 * n)
    return meta, xyz_q, dev_q

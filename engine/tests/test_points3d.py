"""points3d.bin 작성기·리더 테스트 (스펙 §5, §10.1 test_points3d 표, §10.2 형식 골든).

기대값은 전부 손으로 계산한 값이다(구현 출력을 베끼지 않는다). 계산 근거는 각 테스트의 주석에 있다.
"""
import dataclasses
import hashlib
import json
import pathlib
import struct
import warnings

import numpy as np
import pytest

from flatness.core.pointsample import DEV_NO_DEVIATION, DEV_NOT_FLOOR, DEV_UNIT_M, MAX_POINTS, PointSample
from flatness.outputs import points3d as p3
from flatness.outputs.points3d import FILE_NAME, MAGIC, SCHEMA_VERSION, encode_points3d, write_points3d

META_KEYS = ["schema_version", "n_points", "units", "origin_m", "extent_m",
             "deviation", "sample_cell_m", "fit_bounds", "sampling", "order"]


def _sample(xyz, dev, origin=(0.0, 0.0, 0.0), cell=0.01, source=4, cap=500000):
    return PointSample(xyz_local=np.array(xyz, dtype=np.float64),
                       dev_q=np.array(dev, dtype=np.int16),
                       origin_abs=np.array(origin, dtype=np.float64),
                       sample_cell_m=cell, source_points=source, cap=cap)


def _hand(**over):
    """손 계산용 4점 표본.

    로컬 최솟값 (1, 2, 3), 범위 (10, 5, 1). 양자화 배율은 축별로 65535/10 = 6553.5, 65535/5 = 13107, 65535.
      P0 (1, 2, 3)      -> q (0, 0, 0)                dev -32768 (DEV_NOT_FLOOR)
      P1 (11, 7, 4)     -> q (65535, 65535, 65535)    dev -32767 (DEV_NO_DEVIATION)
      P2 (3, 3, 3.25)   -> q (2*6553.5, 1*13107, rint(16383.75)) = (13107, 13107, 16384)   dev 5
      P3 (7, 6, 3.75)   -> q (6*6553.5, 4*13107, rint(49151.25)) = (39321, 52428, 49151)   dev -3
    origin_abs (254000, 4180000, 30) -> origin_m = (254001, 4180002, 33)
    """
    kw = dict(origin=(254000.0, 4180000.0, 30.0))
    kw.update(over)
    return _sample([[1.0, 2.0, 3.0], [11.0, 7.0, 4.0], [3.0, 3.0, 3.25], [7.0, 6.0, 3.75]],
                   [-32768, -32767, 5, -3], **kw)


def _split(blob):
    """작성기 테스트용 손 파서(read_points3d 에 기대지 않는다): (json_len, JSON 영역, 본문)."""
    assert blob[:4] == b"FP3D"
    (json_len,) = struct.unpack("<I", blob[4:8])
    return json_len, blob[8:8 + json_len], blob[8 + json_len:]


def _meta_of(blob):
    return json.loads(_split(blob)[1].decode("ascii"))


# ---------------------------------------------------------------- 상수

def test_module_constants():
    # 죽이는 변이: magic·파일명·버전 리터럴 변경, DEV_UNIT_M import 를 지우고 지역 리터럴 0.1 로 되돌림
    assert MAGIC == bytes([0x46, 0x50, 0x33, 0x44])
    assert SCHEMA_VERSION == 1
    assert FILE_NAME == "points3d.bin"
    assert p3.MAX_POINTS == MAX_POINTS == 500_000
    # 단위 상수는 core/pointsample.py 한 곳에서 온다(스펙 §4.1). import 를 지우면 AttributeError 로 죽는다
    assert p3.DEV_UNIT_M == DEV_UNIT_M == 1e-4


# ---------------------------------------------------------------- 작성기: 바이트 배치

def test_encode_byte_layout_hand_sample():
    # 죽이는 변이: '<u2' -> '>u2', '<i2' -> '>i2', 인터리브 -> 축별 연속 배치, dev 블록 오프셋
    blob = encode_points3d(_hand())
    json_len, js, body = _split(blob)
    n = 4
    assert (8 + json_len) % 4 == 0
    assert len(blob) == 8 + json_len + 8 * n
    # xyz 는 점마다 x, y, z 순서. 13107 = 0x3333, 16384 = 0x4000 -> 00 40, 39321 = 0x9999,
    # 52428 = 0xCCCC, 49151 = 0xBFFF -> FF BF
    assert body[:6 * n].hex() == "000000000000" "ffffffffffff" "333333330040" "9999ccccffbf"
    # dev: -32768 = 0x8000 -> 00 80, -32767 = 0x8001 -> 01 80, 5 -> 05 00, -3 = 0xFFFD -> FD FF
    assert body[6 * n:].hex() == "0080" "0180" "0500" "fdff"


def test_encode_pads_json_with_spaces_to_4_byte_boundary():
    # 죽이는 변이: 패딩 제거, 공백이 아닌 바이트로 채움, 필요 이상으로 채움
    # source_points 의 자릿수를 1~4로 바꾸면 JSON 길이가 1바이트씩 늘어 패딩 0~3바이트가 전부 나온다
    pads = set()
    for source in (1, 12, 123, 1234):
        blob = encode_points3d(_hand(source=source))
        json_len, js, body = _split(blob)
        stripped = js.rstrip(b" ")
        pad = json_len - len(stripped)
        assert stripped.endswith(b"}")
        assert js == stripped + b" " * pad
        assert (8 + json_len) % 4 == 0
        assert pad == (-(8 + len(stripped))) % 4
        assert len(body) == 8 * 4
        pads.add(pad)
    assert pads == {0, 1, 2, 3}


# ---------------------------------------------------------------- 작성기: 메타

def test_encode_meta_keys_order_and_values():
    # 죽이는 변이: 키 추가·누락·순서 변경, 두 센티널 값 교환, numpy 스칼라·정수 표기, 구분자 공백
    _, js, _ = _split(encode_points3d(_hand()))
    text = js.decode("ascii").rstrip(" ")
    meta = json.loads(text)
    assert list(meta) == META_KEYS
    assert list(meta["deviation"]) == ["unit_mm", "not_floor", "no_deviation"]
    assert list(meta["fit_bounds"]) == ["min", "max"]
    assert list(meta["sampling"]) == ["method", "source_points", "cap"]
    assert meta["deviation"] == {"unit_mm": 0.1, "not_floor": -32768, "no_deviation": -32767}
    # 메타의 센티널·단위는 core/pointsample.py 상수와 같은 값이다(1e-4 m = 0.1 mm)
    assert meta["deviation"] == {"unit_mm": DEV_UNIT_M * 1000, "not_floor": DEV_NOT_FLOOR,
                                 "no_deviation": DEV_NO_DEVIATION}
    assert meta["sampling"] == {"method": "cell min-hash stratified", "source_points": 4, "cap": 500000}
    # 문자열 자체를 본다: 숫자는 Python float 의 repr(10 이 아니라 10.0), 구분자는 공백 없는 "," 와 ":"
    assert text.startswith(
        '{"schema_version":1,"n_points":4,"units":"m",'
        '"origin_m":[254001.0,4180002.0,33.0],"extent_m":[10.0,5.0,1.0],'
        '"deviation":{"unit_mm":0.1,"not_floor":-32768,"no_deviation":-32767},'
        '"sample_cell_m":0.01,"fit_bounds":{"min":[2.0,1.0,')
    assert text.endswith(
        ']},"sampling":{"method":"cell min-hash stratified","source_points":4,"cap":500000},'
        '"order":"hash"}')


def test_encode_meta_has_no_forbidden_keys():
    # 죽이는 변이: 엔진 버전·시드·임계값·분류 수·경로·시각을 메타에 넣음(기준 무관 바이트 동일이 깨진다)
    text = _split(encode_points3d(_hand()))[1].decode("ascii")
    for banned in ("engine", "seed", "threshold", "pass_mm", "rework_mm", "u_mm",
                   "criteri", "count", "path", "created", "time"):
        assert banned not in text
    assert set(_meta_of(encode_points3d(_hand()))) == set(META_KEYS)


def test_sample_cap_is_recorded_but_not_enforced():
    # 죽이는 변이: 상한을 sample.cap 과 비교(n = 4 > cap = 2 인데도 써져야 한다)
    meta = _meta_of(encode_points3d(_hand(cap=2, source=9)))
    assert meta["n_points"] == 4
    assert meta["sampling"]["cap"] == 2 and meta["sampling"]["source_points"] == 9


# ---------------------------------------------------------------- 작성기: fit_bounds

def test_fit_bounds_covers_only_points_with_deviation():
    # 죽이는 변이: 전체 점으로 fit 계산, 양자화 전 좌표로 fit 계산, 센티널 비교 방향
    # 편차 있는 점은 P2, P3. 복원 좌표 = q * ext / 65535:
    #   P2 (13107*10/65535, 13107*5/65535, 16384*1/65535) = (2, 1, 16384/65535)
    #   P3 (39321*10/65535, 52428*5/65535, 49151*1/65535) = (6, 4, 49151/65535)
    meta = _meta_of(encode_points3d(_hand()))
    assert meta["fit_bounds"] == {"min": [2.0, 1.0, 16384 * 1.0 / 65535.0],
                                  "max": [6.0, 4.0, 49151 * 1.0 / 65535.0]}
    # 양자화 전 값(0.25, 0.75)과는 다르다
    assert meta["fit_bounds"]["min"][2] != 0.25 and meta["fit_bounds"]["max"][2] != 0.75


def test_fit_bounds_falls_back_to_full_range_without_deviation():
    # 죽이는 변이: 편차 있는 점이 없을 때 빈 배열 min() 예외, 대체 범위를 0 으로 둠
    s = dataclasses.replace(_hand(), dev_q=np.array([-32768, -32767, -32768, -32767], dtype=np.int16))
    meta = _meta_of(encode_points3d(s))
    assert meta["fit_bounds"] == {"min": [0.0, 0.0, 0.0], "max": [10.0, 5.0, 1.0]}
    assert meta["fit_bounds"]["max"] == meta["extent_m"]


def test_fit_bounds_sentinel_boundary():
    # 죽이는 변이: dev > -32767 을 >= 로(P1 이 들어와 max 가 전체 범위가 됨) 또는 > -32766 으로(P0 이 빠짐)
    # P0 만 유효(DEV_MIN)
    s = dataclasses.replace(_hand(), dev_q=np.array([-32766, -32767, -32768, -32768], dtype=np.int16))
    meta = _meta_of(encode_points3d(s))
    assert meta["fit_bounds"] == {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}


# ---------------------------------------------------------------- 작성기: 퇴화 축

def test_degenerate_axis_encodes_zero_without_warning():
    # 죽이는 변이: 65535.0 / ext 를 그대로 나눔(0 나눗셈 경고), 범위 0 축에 NaN·65535 기록
    # z 가 전부 5.0. x 범위 2 (배율 32767.5), y 범위 4 (배율 16383.75)
    #   (1.5 - 1) * 32767.5 = 16383.75 -> 16384,  (3 - 2) * 16383.75 = 16383.75 -> 16384
    s = _sample([[1.0, 2.0, 5.0], [3.0, 6.0, 5.0], [1.5, 3.0, 5.0]], [0, 1, 2], origin=(10.0, 20.0, 30.0))
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        blob = encode_points3d(s)
    json_len, _, body = _split(blob)
    meta = _meta_of(blob)
    assert meta["extent_m"] == [2.0, 4.0, 0.0]
    assert meta["origin_m"] == [11.0, 22.0, 35.0]
    q = np.frombuffer(body, dtype="<u2", count=9).reshape(3, 3)
    assert q.tolist() == [[0, 0, 0], [65535, 65535, 0], [16384, 16384, 0]]
    # 복원 z = q * 0 / 65535 = 0
    assert meta["fit_bounds"]["min"][2] == 0.0 and meta["fit_bounds"]["max"][2] == 0.0
    assert len(blob) == 8 + json_len + 8 * 3


def test_single_point_has_zero_extent_on_all_axes():
    # 죽이는 변이: n = 1 을 거부, 범위 0 에서 예외
    s = _sample([[7.0, 8.0, 9.0]], [12], origin=(100.0, 200.0, 300.0), source=1)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        blob = encode_points3d(s)
    _, _, body = _split(blob)
    meta = _meta_of(blob)
    assert meta["n_points"] == 1
    assert meta["origin_m"] == [107.0, 208.0, 309.0]
    assert meta["extent_m"] == [0.0, 0.0, 0.0]
    assert meta["fit_bounds"] == {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
    assert body.hex() == "000000000000" "0c00"


# ---------------------------------------------------------------- 작성기: 검증 규칙

def test_cap_is_checked_against_engine_constant_not_sample_cap(tmp_path):
    # 죽이는 변이: 상한을 sample.cap 과 비교, 상한 검사 제거
    n = MAX_POINTS + 1
    xyz = np.zeros((n, 3), dtype=np.float64)
    xyz[:, 0] = np.arange(n) * 1e-3
    s = PointSample(xyz_local=xyz, dev_q=np.zeros(n, dtype=np.int16), origin_abs=np.zeros(3),
                    sample_cell_m=0.01, source_points=n, cap=10 ** 9)
    with pytest.raises(ValueError):
        encode_points3d(s)
    out = tmp_path / FILE_NAME
    with pytest.raises(ValueError):
        write_points3d(s, out)
    assert not out.exists()


def test_exactly_max_points_is_accepted():
    # 죽이는 변이: n <= MAX_POINTS 를 n < MAX_POINTS 로
    n = MAX_POINTS
    xyz = np.zeros((n, 3), dtype=np.float64)
    xyz[:, 0] = np.arange(n) * 1e-3
    s = PointSample(xyz_local=xyz, dev_q=np.zeros(n, dtype=np.int16), origin_abs=np.zeros(3),
                    sample_cell_m=0.01, source_points=n, cap=MAX_POINTS)
    blob = encode_points3d(s)
    json_len, _, _ = _split(blob)
    assert len(blob) == 8 + json_len + 8 * n
    assert len(blob) <= 8 + 4096 + 8 * 500_000        # 성능 테스트가 쓰는 크기 상한과 같은 식


def _zero_points(s):
    return dataclasses.replace(s, xyz_local=np.zeros((0, 3), dtype=np.float64), dev_q=np.zeros(0, dtype=np.int16))


def _xyz_two_columns(s):
    return dataclasses.replace(s, xyz_local=s.xyz_local[:, :2].copy())


def _xyz_flat(s):
    return dataclasses.replace(s, xyz_local=s.xyz_local.ravel().copy())


def _dev_too_short(s):
    return dataclasses.replace(s, dev_q=s.dev_q[:3].copy())


def _dev_int32(s):
    return dataclasses.replace(s, dev_q=s.dev_q.astype(np.int32))


def _dev_float(s):
    return dataclasses.replace(s, dev_q=s.dev_q.astype(np.float64))


def _xyz_nan(s):
    xyz = s.xyz_local.copy()
    xyz[2, 1] = np.nan
    return dataclasses.replace(s, xyz_local=xyz)


def _xyz_inf(s):
    xyz = s.xyz_local.copy()
    xyz[0, 0] = np.inf
    return dataclasses.replace(s, xyz_local=xyz)


def _origin_nan(s):
    return dataclasses.replace(s, origin_abs=np.array([254000.0, np.nan, 30.0]))


def _cell_nan(s):
    return dataclasses.replace(s, sample_cell_m=float("nan"))


@pytest.mark.parametrize("mutate, message", [
    (_zero_points, "점이 0개"),
    (_xyz_two_columns, "xyz_local 모양"),
    (_xyz_flat, "xyz_local 모양"),
    (_dev_too_short, "dev_q"),
    (_dev_int32, "dev_q"),
    (_dev_float, "dev_q"),
    (_xyz_nan, "유한하지 않은"),
    (_xyz_inf, "유한하지 않은"),
    (_origin_nan, "JSON"),        # json.dumps(allow_nan=False) 가 내는 메시지
    (_cell_nan, "JSON"),
])
def test_writer_rejects_invalid_sample_and_leaves_no_file(tmp_path, mutate, message):
    # 죽이는 변이: 검증 규칙 1·3 을 하나씩 제거(메시지로 어느 가드가 막았는지 확인한다),
    #             allow_nan=False 제거(NaN 이 JSON 에 들어가면 브라우저가 못 읽는다)
    s = mutate(_hand())
    with warnings.catch_warnings():
        warnings.simplefilter("error")          # 가드가 numpy 연산보다 먼저 막아야 한다
        with pytest.raises(ValueError, match=message):
            encode_points3d(s)
        out = tmp_path / FILE_NAME
        with pytest.raises(ValueError, match=message):
            write_points3d(s, out)
    assert not out.exists()


# ---------------------------------------------------------------- write_points3d

def test_write_points3d_writes_blob_and_returns_file_name(tmp_path):
    # 죽이는 변이: 전체 경로를 반환, 파일명을 리터럴로 고정, blob 과 다른 내용을 씀
    out = tmp_path / FILE_NAME
    assert write_points3d(_hand(), out) == "points3d.bin"
    assert out.read_bytes() == encode_points3d(_hand())
    other = tmp_path / "other.bin"
    assert write_points3d(_hand(), str(other)) == "other.bin"      # str 경로도 받는다
    assert other.read_bytes() == encode_points3d(_hand())


def test_write_points3d_removes_partial_file_on_failure(tmp_path, monkeypatch):
    # 죽이는 변이: 실패 시 부분 파일을 남김, 예외를 삼킴
    out = tmp_path / FILE_NAME
    seen = {}

    def partial_then_fail(self, data):
        with open(self, "wb") as f:
            f.write(bytes(data)[:5])
        seen["partial_existed"] = self.exists()
        raise OSError("disk full")

    monkeypatch.setattr(pathlib.Path, "write_bytes", partial_then_fail)
    with pytest.raises(OSError, match="disk full"):
        write_points3d(_hand(), out)
    assert seen == {"partial_existed": True}      # 주입이 실제로 부분 파일을 만들었다(공허한 통과 방지)
    assert not out.exists()


# ---------------------------------------------------------------- 리더

def _pad4(js: bytes) -> bytes:
    return js + b" " * ((-(8 + len(js))) % 4)


def _pack(json_area: bytes, body: bytes, json_len=None, magic=b"FP3D") -> bytes:
    """변조 버퍼 조립. json_len 을 주지 않으면 json_area 길이를 그대로 적는다."""
    if json_len is None:
        json_len = len(json_area)
    return magic + struct.pack("<I", json_len) + json_area + body


def _good_meta(n=2):
    return {"schema_version": 1, "n_points": n, "units": "m",
            "origin_m": [254001.0, 4180002.0, 33.0], "extent_m": [10.0, 5.0, 1.0],
            "deviation": {"unit_mm": 0.1, "not_floor": -32768, "no_deviation": -32767},
            "sample_cell_m": 0.01,
            "fit_bounds": {"min": [0.0, 0.0, 0.0], "max": [10.0, 5.0, 1.0]},
            "sampling": {"method": "cell min-hash stratified", "source_points": 2, "cap": 500000},
            "order": "hash"}


# 2점 본문: xyz 02 01 | 04 03 | 06 05 | ff ff | 00 00 | 00 80, dev fd ff | 00 80
_BODY2 = bytes.fromhex("020104030605" "ffff00000080" "fdff" "0080")


def _buf(meta, body=_BODY2):
    return _pack(_pad4(json.dumps(meta, separators=(",", ":")).encode("utf-8")), body)


def _reason(data):
    with pytest.raises(ValueError) as ei:
        p3.read_points3d(data)
    return str(ei.value)


def test_reader_parses_hand_built_buffer():
    # 죽이는 변이(리더 쪽): '<u2' -> '>u2', '<i2' -> '>i2', 본문 오프셋에서 json_len 누락, 축별 연속 배치로 읽음
    meta, xyz_q, dev_q = p3.read_points3d(_buf(_good_meta()))
    assert meta == _good_meta()
    assert xyz_q.dtype == np.uint16 and xyz_q.shape == (2, 3)
    assert dev_q.dtype == np.int16 and dev_q.shape == (2,)
    # 02 01 -> 0x0102 = 258, 04 03 -> 772, 06 05 -> 1286, 00 80 -> 32768
    assert xyz_q.tolist() == [[258, 772, 1286], [65535, 0, 32768]]
    # fd ff -> -3, 00 80 -> -32768
    assert dev_q.tolist() == [-3, -32768]


def test_reader_accepts_bytearray_and_memoryview():
    data = _buf(_good_meta())
    for view in (bytearray(data), memoryview(data)):
        meta, xyz_q, dev_q = p3.read_points3d(view)
        assert meta["n_points"] == 2 and xyz_q[0].tolist() == [258, 772, 1286] and dev_q[1] == -32768


def test_reader_ignores_unknown_meta_keys():
    # 죽이는 변이: 키 집합을 정확히 일치로 검사(추가 키는 호환 변경이어야 한다)
    meta = _good_meta()
    meta["future_key"] = {"a": [1, 2, 3]}
    got, _, _ = p3.read_points3d(_buf(meta))
    assert got["future_key"] == {"a": [1, 2, 3]}


def test_roundtrip_restores_coordinates_within_half_quantum():
    # 죽이는 변이: origin_m·좌표를 float32 로 다룸, rint 대신 내림, mn 을 빼지 않음, dev 캐스트 오류
    rng = np.random.default_rng(7)
    n = 5000
    local = rng.uniform([3.0, 1.0, 0.5], [3.0 + 8.0012, 1.0 + 6.0009, 0.5 + 0.0719], size=(n, 3))
    dev = rng.integers(-32768, 32768, size=n).astype(np.int16)
    s = PointSample(xyz_local=local, dev_q=dev, origin_abs=np.array([254012.3371, 4180044.9126, 31.4802]),
                    sample_cell_m=0.0098, source_points=120701, cap=500000)
    meta, xyz_q, dev_q = p3.read_points3d(encode_points3d(s))
    assert meta["n_points"] == n and xyz_q.shape == (n, 3)
    assert np.array_equal(dev_q, dev)
    ext = np.array(meta["extent_m"])
    assert np.array_equal(ext, local.max(axis=0) - local.min(axis=0))
    half_quantum = ext / 65535 / 2
    restored_local = xyz_q * ext / 65535                          # §5.5 복원 식
    assert (np.abs(restored_local - (local - local.min(axis=0))) <= half_quantum + 1e-12).all()
    restored_abs = np.array(meta["origin_m"]) + restored_local
    # 절대 좌표 비교는 4e6 크기의 float64 반올림(약 1e-9 m)만큼만 여유를 둔다
    assert (np.abs(restored_abs - (s.origin_abs + local)) <= half_quantum + 1e-8).all()


def test_reader_reads_degenerate_axis_as_zero():
    s = _sample([[1.0, 2.0, 5.0], [3.0, 6.0, 5.0], [1.5, 3.0, 5.0]], [0, 1, 2])
    meta, xyz_q, _ = p3.read_points3d(encode_points3d(s))
    assert meta["extent_m"][2] == 0.0
    assert (xyz_q[:, 2] * meta["extent_m"][2] / 65535 == 0.0).all()


# §5.6 리더 규칙 1~7. 각 사유마다 그 규칙만 어긴 버퍼를 준다

def test_reader_too_short():
    assert _reason(b"") == "too_short"
    assert _reason(b"FP3D\x00\x00\x00") == "too_short"            # 7바이트


def test_reader_bad_magic():
    good = _buf(_good_meta())
    assert _reason(b"FP3X" + good[4:]) == "bad_magic"
    assert _reason(b"fp3d" + good[4:]) == "bad_magic"


def test_reader_bad_header():
    good = _buf(_good_meta())
    # (a) json_len 이 버퍼를 넘는다. 0xFFFFFFFC 는 8 을 더해도 4의 배수라 길이 조건만 어긴다
    assert _reason(good[:4] + struct.pack("<I", 0xFFFFFFFC) + good[8:]) == "bad_header"
    # (b) 8 + json_len 이 4의 배수가 아니다(패딩 없는 JSON). 본문이 뒤따라 길이 조건은 만족한다
    js = _pad4(json.dumps(_good_meta(), separators=(",", ":")).encode("utf-8")) + b" "
    assert (8 + len(js)) % 4 == 1
    assert _reason(_pack(js, _BODY2)) == "bad_header"


@pytest.mark.parametrize("area", [
    b"not json",                       # JSON 이 아님
    b"[1,2]",                          # 배열(객체가 아님)
    b"null",                           # null(객체가 아님)
    b"\xff\xfe\xfd\xfc",               # UTF-8 로 풀 수 없음
    b'{"schema_version":NaN}',         # NaN 토큰은 JSON 이 아니다(브라우저의 JSON.parse 와 같게 거부)
    b'{"schema_version":1,"n_points":Infinity}',
])
def test_reader_bad_json(area):
    assert _reason(_pack(_pad4(area), _BODY2)) == "bad_json"


@pytest.mark.parametrize("version", [2, 0, "1", True, None])
def test_reader_unsupported_version(version):
    meta = _good_meta()
    if version is None:
        del meta["schema_version"]
    else:
        meta["schema_version"] = version
    assert _reason(_buf(meta)) == "unsupported_version"


def _set(key, value):
    def apply(meta):
        meta[key] = value
    return apply


def _del(key):
    def apply(meta):
        del meta[key]
    return apply


def _sub(key, sub, value):
    def apply(meta):
        meta[key][sub] = value
    return apply


def _delsub(key, sub):
    def apply(meta):
        del meta[key][sub]
    return apply


_BAD_META = {
    "n_points_zero": _set("n_points", 0),
    "n_points_negative": _set("n_points", -2),
    "n_points_fraction": _set("n_points", 1.5),
    "n_points_string": _set("n_points", "2"),
    "n_points_bool": _set("n_points", True),
    "n_points_missing": _del("n_points"),
    "units_mm": _set("units", "mm"),
    "units_missing": _del("units"),
    "origin_two": _set("origin_m", [1.0, 2.0]),
    "origin_string_item": _set("origin_m", [1.0, 2.0, "3"]),
    "origin_not_list": _set("origin_m", "abc"),
    "origin_missing": _del("origin_m"),
    "extent_negative": _set("extent_m", [10.0, -0.5, 1.0]),
    "extent_two": _set("extent_m", [10.0, 5.0]),
    "extent_missing": _del("extent_m"),
    "deviation_unit": _sub("deviation", "unit_mm", 0.2),
    "deviation_not_floor": _sub("deviation", "not_floor", -32767),
    "deviation_no_deviation": _sub("deviation", "no_deviation", -32768),
    "deviation_unit_missing": _delsub("deviation", "unit_mm"),
    "deviation_not_object": _set("deviation", "x"),
    "deviation_missing": _del("deviation"),
    "cell_zero": _set("sample_cell_m", 0),
    "cell_negative": _set("sample_cell_m", -0.01),
    "cell_string": _set("sample_cell_m", "0.01"),
    "cell_missing": _del("sample_cell_m"),
    "fit_min_gt_max": _sub("fit_bounds", "min", [0.0, 5.5, 0.0]),     # y 축만 min 5.5 > max 5.0
    "fit_min_two": _sub("fit_bounds", "min", [0.0, 0.0]),
    "fit_max_missing": _delsub("fit_bounds", "max"),
    "fit_not_object": _set("fit_bounds", [0, 0, 0]),
    "fit_missing": _del("fit_bounds"),
    "order_other": _set("order", "cell"),
    "order_missing": _del("order"),
}


@pytest.mark.parametrize("case", sorted(_BAD_META))
def test_reader_bad_meta(case):
    # 죽이는 변이: §5.6 표 6행의 세부 조건을 하나라도 빼면 해당 사례가 통과해 버린다
    meta = _good_meta()
    _BAD_META[case](meta)
    assert _reason(_buf(meta)) == "bad_meta"


@pytest.mark.parametrize("token", ["1e999", "-1e999"])
def test_reader_bad_meta_non_finite_number(token):
    # 1e999 는 JSON 문법으로는 유효하지만 float 로는 무한대다(유한수 검사)
    text = json.dumps(_good_meta(), separators=(",", ":")).replace("254001.0", token)
    assert token in text
    assert _reason(_pack(_pad4(text.encode("utf-8")), _BODY2)) == "bad_meta"


def test_reader_size_mismatch():
    # 죽이는 변이: read_points3d 의 size_mismatch 검사 제거
    good = _buf(_good_meta())
    assert _reason(good + b"\x00\x00") == "size_mismatch"                    # 2바이트 남음
    assert _reason(good[:-2]) == "size_mismatch"                             # 2바이트 모자람
    assert _reason(_buf(_good_meta(n=3))) == "size_mismatch"                 # n_points 3 인데 본문은 2점
    assert _reason(_buf(_good_meta(n=1))) == "size_mismatch"                 # n_points 1 인데 본문은 2점


def test_reader_reports_first_violated_rule():
    # 죽이는 변이: 검사 순서 변경
    good = _buf(_good_meta())
    assert _reason(b"XXXX\xff\xff\xff") == "too_short"                                        # 1 이 2 보다 먼저
    assert _reason(b"FP3X" + struct.pack("<I", 0xFFFFFFFC) + good[8:]) == "bad_magic"         # 2 가 3 보다 먼저
    assert _reason(_pack(b"not json", _BODY2, json_len=0xFFFFFFFC)) == "bad_header"           # 3 이 4 보다 먼저
    meta = _good_meta(n=3)
    meta["schema_version"] = 2
    meta["units"] = "mm"
    assert _reason(_buf(meta)) == "unsupported_version"                                       # 5 가 6·7 보다 먼저
    meta["schema_version"] = 1
    assert _reason(_buf(meta)) == "bad_meta"                                                  # 6 이 7 보다 먼저


# ---------------------------------------------------------------- 형식 골든 (§10.2)

from tests.fixtures.points3d_golden import GOLDEN_PATH, golden_sample  # noqa: E402

GOLDEN_SHA256 = "b0c50d8a0f2e77e3077c6b38fb6795cc89bf321601c56fb8a3e855efbc6892d9"


def test_golden_sample_is_deterministic():
    a, b = golden_sample(), golden_sample()
    assert a.xyz_local.tobytes() == b.xyz_local.tobytes() and a.dev_q.tobytes() == b.dev_q.tobytes()
    assert a.xyz_local.shape == (12, 3) and a.dev_q.dtype == np.int16


def test_golden_file_matches_encoder_byte_for_byte():
    # 죽이는 변이: '<u2' -> '>u2', 패딩 제거, 인터리브 -> 축별 연속 배치, 두 센티널 값 교환, 메타 키 순서
    data = GOLDEN_PATH.read_bytes()
    assert len(data) == 488
    # 형식을 바꾸면서 골든을 같이 다시 만들어도 이 해시가 잡는다(파일과 작성기가 함께 틀리는 경우)
    assert hashlib.sha256(data).hexdigest() == GOLDEN_SHA256
    assert encode_points3d(golden_sample()) == data


def test_golden_file_content_by_hand():
    # 골든 정의(points3d_golden.py)에서 손으로 적은 기대값. 대시보드 vitest 가 같은 파일을 같은 값으로 읽는다
    data = GOLDEN_PATH.read_bytes()
    # json_len 384 = 0x00000180 -> 80 01 00 00. 패딩 전 JSON 382바이트 + 공백 2바이트
    assert data[:8] == b"FP3D" + bytes([0x80, 0x01, 0x00, 0x00])
    assert data[8:392].endswith(b'"order":"hash"}  ') and not data[8:392].endswith(b'}   ')
    assert b'"origin_m":[254012.8371,4180045.1626,31.6052]' in data[8:392]
    meta, xyz_q, dev_q = p3.read_points3d(data)
    assert meta == {
        "schema_version": 1, "n_points": 12, "units": "m",
        # origin_abs + MN = (254012.3371 + 0.5, 4180044.9126 + 0.25, 31.4802 + 0.125)
        "origin_m": [254012.8371, 4180045.1626, 31.6052],
        "extent_m": [4.0, 2.5, 0.3125],
        "deviation": {"unit_mm": 0.1, "not_floor": -32768, "no_deviation": -32767},
        "sample_cell_m": 0.0125,
        # 편차 있는 점의 최대 qz 는 6번 점의 23456(7번 65535 는 DEV_NOT_FLOOR 라 빠진다)
        "fit_bounds": {"min": [0.0, 0.0, 0.0], "max": [4.0, 2.5, 23456 * 0.3125 / 65535]},
        "sampling": {"method": "cell min-hash stratified", "source_points": 12345, "cap": 500000},
        "order": "hash",
    }
    assert xyz_q.tolist() == [
        [0, 0, 0], [65535, 65535, 4096], [258, 772, 1286], [32768, 16384, 8192],
        [1, 65534, 2], [40000, 20000, 10000], [12345, 54321, 23456], [100, 200, 65535],
        [50000, 60000, 300], [65280, 255, 4660], [4660, 43981, 291], [21845, 43690, 13107],
    ]
    assert dev_q.tolist() == [0, 32, -105, 70, 71, -70, -71, -32768, -32767, 32767, -32766, 1]
    # 본문은 392 에서 시작한다. 2번 점 (258, 772, 1286) = 0x0102, 0x0304, 0x0506 -> 02 01 04 03 06 05
    assert data[392 + 12:392 + 18].hex() == "020104030605"
    # dev 블록은 392 + 72 = 464 에서 시작한다. 7번 -32768 -> 00 80, 8번 -32767 -> 01 80
    assert data[464 + 14:464 + 18].hex() == "00800180"
    # T_q = 70 분류 수(대시보드 테스트가 같은 수를 손으로 적는다): flat 5, depression 3, protrusion 2, none 2
    has = dev_q > -32767
    assert int((dev_q > 70).sum()) == 2
    assert int((has & (dev_q < -70)).sum()) == 3
    assert int((~has).sum()) == 2
    assert int((has & (dev_q >= -70) & (dev_q <= 70)).sum()) == 5

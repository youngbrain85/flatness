import numpy as np
import pytest
from tests.fixtures.synthetic import flat_floor, write_ascii_ply, write_binary_ply
from flatness.io.ply_reader import read_ply_chunks

def _collect(path, chunk_size=1000):
    return np.vstack(list(read_ply_chunks(path, chunk_size=chunk_size)))

def test_ascii_ply_roundtrip(tmp_path):
    pts = flat_floor(size=(1.0, 1.0), spacing=0.1)
    write_ascii_ply(pts, tmp_path / "a.ply")
    got = _collect(tmp_path / "a.ply", chunk_size=7)  # 청크 경계 검증용 소수
    assert got.shape == (len(pts), 3)
    assert np.allclose(got, pts, atol=1e-4)

def test_binary_ply_roundtrip(tmp_path):
    pts = flat_floor(size=(1.0, 1.0), spacing=0.1)
    write_binary_ply(pts, tmp_path / "b.ply")
    got = _collect(tmp_path / "b.ply")
    assert np.allclose(got, pts, atol=1e-4)

def test_extra_properties_skipped(tmp_path):
    # x/y/z 외 property(색상)가 있어도 좌표만 추출
    header = ("ply\nformat binary_little_endian 1.0\nelement vertex 2\n"
              "property float x\nproperty float y\nproperty float z\n"
              "property uchar red\nproperty uchar green\nproperty uchar blue\n"
              "end_header\n")
    import struct
    body = b"".join(struct.pack("<fffBBB", i, i, i, 255, 0, 0) for i in range(2))
    (tmp_path / "c.ply").write_bytes(header.encode() + body)
    got = _collect(tmp_path / "c.ply")
    assert np.allclose(got, [[0, 0, 0], [1, 1, 1]])

def test_vertex_not_first_element_rejected(tmp_path):
    # vertex 앞에 다른 element가 오는 비전형 PLY는 조용한 오독 대신 명시적 거부
    header = ("ply\nformat binary_little_endian 1.0\nelement face 1\n"
              "property uchar dummy\nelement vertex 1\n"
              "property float x\nproperty float y\nproperty float z\nend_header\n")
    (tmp_path / "a.ply").write_bytes(header.encode() + b"\x00" * 13)
    with pytest.raises(ValueError, match="첫 element"):
        list(read_ply_chunks(tmp_path / "a.ply"))

def test_unknown_property_type_rejected(tmp_path):
    # 미지원 property 타입은 KeyError가 아닌 ValueError
    header = ("ply\nformat binary_little_endian 1.0\nelement vertex 1\n"
              "property weird x\nproperty float y\nproperty float z\nend_header\n")
    (tmp_path / "b.ply").write_bytes(header.encode())
    with pytest.raises(ValueError, match="property 타입"):
        list(read_ply_chunks(tmp_path / "b.ply"))

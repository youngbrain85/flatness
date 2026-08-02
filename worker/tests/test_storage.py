"""Storage 어댑터 - 키 검증(split_key)과 LocalStorage 왕복(download/upload/delete_prefix).

SupabaseStorage는 실 프로젝트 없이는 검증할 수 없으므로 단위 테스트를 만들지 않는다
(flatworker/storage.py의 클래스 주석 참고) - get_storage의 배선만 네트워크 없이
확인한다.
"""
from types import SimpleNamespace

import pytest

from flatworker.storage import (LocalStorage, SupabaseStorage, content_type_for,
                                get_storage, split_key)


def test_split_key_normal():
    assert split_key("artifacts/a1/stats.json") == ("artifacts", "a1/stats.json")


@pytest.mark.parametrize("bad", [
    "secrets/x.txt", "artifacts", "artifacts/../etc/passwd",
    "artifacts//x.png", "artifacts/a\\b.png", "artifacts/a\0b.png",
])
def test_split_key_rejects(bad):
    with pytest.raises(ValueError):
        split_key(bad)


def test_local_upload_dir_and_download(tmp_path):
    st = LocalStorage(tmp_path / "data")
    src = tmp_path / "out"; src.mkdir()
    (src / "stats.json").write_text('{"a":1}', encoding="utf-8")
    (src / "sub").mkdir(); (src / "sub" / "h.png").write_bytes(b"\x89PNG")
    keys = st.upload_dir("artifacts/a1", src)
    assert keys == ["artifacts/a1/stats.json", "artifacts/a1/sub/h.png"]
    assert st.download("artifacts/a1/stats.json") == b'{"a":1}'
    assert st.download("artifacts/a1/none.json") is None
    st.delete_prefix("artifacts/a1")
    assert st.download("artifacts/a1/stats.json") is None


def test_local_download_to_writes_file_and_reports_existence(tmp_path):
    st = LocalStorage(tmp_path / "data")
    st.upload("artifacts/a1/stats.json", b'{"a":1}')
    dst = tmp_path / "staging" / "stats.json"
    assert st.download_to("artifacts/a1/stats.json", dst) is True
    assert dst.read_bytes() == b'{"a":1}'
    assert st.download_to("artifacts/a1/missing.json", tmp_path / "x.json") is False
    assert not (tmp_path / "x.json").exists()


def test_content_type_for_known_and_unknown_extensions():
    assert content_type_for("stats.json") == "application/json"
    assert content_type_for("heatmap.PNG") == "image/png"
    assert content_type_for("scan.ply") == "application/octet-stream"


def test_get_storage_local_backend_defaults_to_data_dir(tmp_path):
    cfg = SimpleNamespace(storage_backend="local", data_dir=tmp_path / "data")
    storage = get_storage(cfg, db=None)
    assert isinstance(storage, LocalStorage)
    assert storage._root == tmp_path / "data"


def test_get_storage_supabase_backend_reuses_db_client(tmp_path):
    cfg = SimpleNamespace(storage_backend="supabase", data_dir=tmp_path / "data")
    fake_client = object()
    db = SimpleNamespace(_client=fake_client)
    storage = get_storage(cfg, db)
    assert isinstance(storage, SupabaseStorage)
    assert storage._client is fake_client

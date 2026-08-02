"""Storage 어댑터 - 키 검증(split_key)과 LocalStorage 왕복(download/upload/delete_prefix).

SupabaseStorage는 실 프로젝트 없이는 검증할 수 없으므로 단위 테스트를 만들지 않는다는
것이 기존 방침이었다(flatworker/storage.py의 클래스 주석 참고) - get_storage의 배선만
네트워크 없이 확인해 왔다. 다만 delete_prefix의 상태코드 검사(코드리뷰 Important I-1)는
test_db.py와 동일하게 httpx.MockTransport로 실제 HTTP 스택(상태코드 처리 포함)까지
태워 결정론적으로 검증한다 - 네트워크 호출이 없으므로 기존 방침을 어기지 않는다.
"""
from types import SimpleNamespace

import httpx
import pytest

from flatworker.db import DBError
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


# ---- SupabaseStorage.delete_prefix 상태코드 검사 (코드리뷰 Important I-1) ----
# 실 네트워크 없이 httpx.MockTransport로 진짜 HTTP 스택(상태코드 처리 포함)을
# 태운다 - test_db.py의 SupabaseRest 배선 테스트와 동일한 이유·패턴이다.

def _mock_storage_client(handler):
    return httpx.Client(base_url="http://fake", transport=httpx.MockTransport(handler))


def test_supabase_delete_prefix_raises_dberror_on_failed_delete_response():
    """DELETE가 4xx/5xx를 반환해도 상태코드 검사가 없으면 조용히 통과한다 - 그러면
    build_assets의 upload_dir이 지워지지 않은 옛 파일 위에 새 파일을 얹는다(재생성 시
    이전 자산 잔재). download/upload/_list_recursive와 동일하게 DBError를 내야 한다."""
    def handler(request):
        if request.method == "POST":   # _list_recursive
            return httpx.Response(200, json=[{"name": "stats.json", "id": "obj1"}])
        assert request.method == "DELETE"
        return httpx.Response(500, json={"message": "internal error"})

    db = SimpleNamespace(_client=_mock_storage_client(handler))
    storage = SupabaseStorage(db)
    with pytest.raises(DBError):
        storage.delete_prefix("artifacts/a1")


def test_supabase_delete_prefix_succeeds_when_delete_response_ok():
    def handler(request):
        if request.method == "POST":
            return httpx.Response(200, json=[{"name": "stats.json", "id": "obj1"}])
        assert request.method == "DELETE"
        return httpx.Response(200, json=[{"name": "a1/stats.json"}])

    db = SimpleNamespace(_client=_mock_storage_client(handler))
    storage = SupabaseStorage(db)
    storage.delete_prefix("artifacts/a1")  # 예외 없이 완료해야 함


def test_supabase_delete_prefix_skips_delete_call_when_prefix_empty():
    """목록이 비어 있으면 DELETE 자체를 호출하지 않는다(기존 동작 유지 확인)."""
    def handler(request):
        assert request.method == "POST"
        return httpx.Response(200, json=[])

    db = SimpleNamespace(_client=_mock_storage_client(handler))
    storage = SupabaseStorage(db)
    storage.delete_prefix("artifacts/a1")  # DELETE 미호출, 예외 없음

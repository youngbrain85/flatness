"""파일 저장 어댑터 - 로컬 디렉터리(개발·테스트)와 Supabase Storage(운영).

키 규약: 스펙 §6.3 버킷-상대 문자열 전체를 그대로 키로 쓴다. 첫 세그먼트가 버킷명이며
DB에 저장된 문자열(scans.raw_file_path·analyses.artifacts_dir·reports.pdf_path)을
가공 없이 넘길 수 있다.
"""
import shutil
from pathlib import Path

from flatworker.db import DBError

ALLOWED_BUCKETS = ("raw-scans", "artifacts", "reports")

_CONTENT_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".json": "application/json", ".csv": "text/csv; charset=utf-8",
    ".pdf": "application/pdf", ".html": "text/html; charset=utf-8",
}


def content_type_for(name) -> str:
    return _CONTENT_TYPES.get(Path(name).suffix.lower(), "application/octet-stream")


def split_key(key):
    """'artifacts/a1/stats.json' -> ('artifacts', 'a1/stats.json').

    대시보드 lib/server/storage-objects.ts와 **동일한 규칙**이다(경로 탈출 차단):
    허용 버킷 밖·빈 세그먼트·'.'·'..' 포함·역슬래시·NUL은 거부한다.
    """
    parts = str(key).split("/")
    if len(parts) < 2 or parts[0] not in ALLOWED_BUCKETS:
        raise ValueError(f"허용되지 않은 저장소 경로입니다: {key!r}")
    for seg in parts:
        if not seg or seg == "." or ".." in seg or "\\" in seg or "\0" in seg:
            raise ValueError(f"허용되지 않은 저장소 경로입니다: {key!r}")
    return parts[0], "/".join(parts[1:])


def _download_to(storage, key, dst) -> bool:
    """download()의 bytes를 dst 경로에 쓰고 성공 여부를 반환한다.

    LocalStorage·SupabaseStorage 양쪽이 동일 로직이라 여기 한 번만 쓰고 위임한다.
    """
    blob = storage.download(key)
    if blob is None:
        return False
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(blob)
    return True


def _upload_dir(storage, prefix, src_dir):
    """src_dir를 재귀 순회해 `{prefix}/{상대경로}` 키로 올리고 키 목록을 반환한다.

    LocalStorage·SupabaseStorage 양쪽이 동일 순회 로직이라 여기 한 번만 쓰고 위임한다.
    """
    uploaded = []
    for f in sorted(Path(src_dir).rglob("*")):
        if f.is_file():
            rel = f.relative_to(src_dir).as_posix()
            storage.upload(f"{prefix}/{rel}", f.read_bytes(), content_type_for(f.name))
            uploaded.append(f"{prefix}/{rel}")
    return uploaded


class LocalStorage:
    """`data_dir` 아래 규약 경로를 그대로 쓰는 구현(개발·테스트 기본값)."""

    def __init__(self, data_dir):
        self._root = Path(data_dir)

    def _path(self, key) -> Path:
        bucket, obj = split_key(key)
        return self._root / bucket / obj

    def download(self, key):
        p = self._path(key)
        return p.read_bytes() if p.exists() else None

    def download_to(self, key, dst) -> bool:
        return _download_to(self, key, dst)

    def upload(self, key, data, content_type=None):
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def upload_dir(self, prefix, src_dir):
        return _upload_dir(self, prefix, src_dir)

    def delete_prefix(self, prefix):
        split_key(f"{prefix}/x")  # 검증만
        shutil.rmtree(self._root / prefix, ignore_errors=True)


class SupabaseStorage:
    """Supabase Storage REST(`/storage/v1/...`). SupabaseRest의 httpx 클라이언트를
    재사용한다 - service_role 키라 RLS를 우회하고 버킷 3종 모두 읽기·쓰기가 된다.

    실 프로젝트 없이는 검증할 수 없으므로 단위 테스트를 만들지 않는다(`SupabaseRest`와
    동일한 결정, worker/flatworker/db.py의 SupabaseRest 클래스 주석 참고). 검증은
    배포 스모크로 한다.
    """

    def __init__(self, db):
        self._client = db._client

    def download(self, key):
        bucket, obj = split_key(key)
        resp = self._client.get(f"/storage/v1/object/{bucket}/{obj}")
        if resp.status_code == 404:
            return None
        if resp.status_code >= 400:
            raise DBError(resp.status_code, resp.text)
        return resp.content

    def download_to(self, key, dst) -> bool:
        return _download_to(self, key, dst)

    def upload(self, key, data, content_type=None):
        bucket, obj = split_key(key)
        resp = self._client.post(
            f"/storage/v1/object/{bucket}/{obj}", content=data,
            headers={"content-type": content_type or content_type_for(obj),
                     "x-upsert": "true"})
        if resp.status_code >= 400:
            raise DBError(resp.status_code, resp.text)

    def upload_dir(self, prefix, src_dir):
        return _upload_dir(self, prefix, src_dir)

    def _list_recursive(self, bucket, prefix):
        """POST /storage/v1/object/list/{bucket}은 비재귀다 - 폴더 항목(id=null)을
        만나면 그 하위를 다시 조회해 파일 객체키만 모은다."""
        found = []
        resp = self._client.post(f"/storage/v1/object/list/{bucket}",
                                 json={"prefix": prefix, "limit": 1000, "offset": 0})
        if resp.status_code >= 400:
            raise DBError(resp.status_code, resp.text)
        for row in resp.json():
            child = f"{prefix}/{row['name']}" if prefix else row["name"]
            if row.get("id") is None:      # 폴더
                found.extend(self._list_recursive(bucket, child))
            else:
                found.append(child)
        return found

    def delete_prefix(self, prefix):
        bucket, obj = split_key(f"{prefix}/x")
        keys = self._list_recursive(bucket, obj[: -len("/x")])
        if keys:
            self._client.request("DELETE", f"/storage/v1/object/{bucket}",
                                 json={"prefixes": keys})


def get_storage(cfg, db):
    """cfg.storage_backend에 따라 LocalStorage 또는 SupabaseStorage를 만든다."""
    if cfg.storage_backend == "supabase":
        return SupabaseStorage(db)
    return LocalStorage(cfg.data_dir)

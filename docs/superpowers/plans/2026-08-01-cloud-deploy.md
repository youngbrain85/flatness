# 클라우드 배포 (Vercel + Railway + Supabase Storage) 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 `data/` 디렉터리에 묶여 있는 파일 입출력을 Supabase Storage로 옮겨, 대시보드는 Vercel에, 워커는 Railway 컨테이너에 배포한다.

**Architecture:** 엔진은 `Path` 하나로 파일을 쓰는 구조라 Storage에 직접 쓸 수 없다. 따라서 워커는 **임시 스테이징 디렉터리**를 쓴다: 원본을 Storage에서 내려받아 임시 디렉터리에 두고, 엔진을 그대로 실행한 뒤, 산출물 디렉터리를 통째로 Storage에 올린다. 이 동기화 경계를 `flatworker/storage.py`의 `Storage` 프로토콜로 추상화해 `local`(개발·테스트)과 `supabase`(운영) 두 구현을 환경변수로 전환한다. 대시보드는 로컬 모드를 두지 않고 Storage 전용으로 전환하며, 파일은 프록시하지 않고 **서명 URL 리다이렉트**로 내려준다. DB에 저장하는 경로 문자열 규약(`raw-scans/...`·`artifacts/...`·`reports/...`)은 버킷-상대이므로 **한 글자도 바뀌지 않는다**.

**Tech Stack:** Supabase Storage(REST), Next.js 16(Vercel), Python 3.11 + Playwright Chromium(Railway Docker), httpx.

## Global Constraints

- 문서·주석·UI 문자열은 한국어. **사용자 대면 문자열에 U+2014(em dash) 사용 금지.**
- 기존 스위트 전량 통과 유지: engine 139 / worker 73(+browser 1) / dashboard 127. 테스트 삭제 금지(시그니처 변경에 따른 호출부 수정만 허용).
- **판정 로직 불변**: `engine/flatness/` 아래 파일은 이 계획에서 단 한 줄도 수정하지 않는다.
- DB에 저장하는 경로 문자열은 스펙 §6.3 버킷-상대 규약 그대로(`docs/contracts/stats-schema.md` §6 산출물 이름 규약 포함) 유지한다.
- 저장소는 공개(public)로 전환된다. 키·토큰을 커밋하지 않는다(`.env`·`.env.*`는 이미 `.gitignore` 대상).
- 커밋은 태스크 단위. 계획 문서 자체는 조정자가 커밋한다.

## 설계 판단 (구현 전 확정 사항)

**1. 로컬 모드 유지 여부 → 환경변수 전환 어댑터로 유지한다.**
엔진 진입점이 `analyze_floor(path, scale, crit, u_mm, out_dir: Path)`라 **어떤 배포 형태에서도 로컬 파일시스템 스테이징이 반드시 존재한다**. 즉 어댑터는 인위적 추상화가 아니라 이미 존재해야 하는 동기화 경계다. 전면 전환하면 worker 73개 테스트 대부분(`tmp_path` 기반 FakeDB·E2E)을 HTTP 목으로 다시 써야 하는데, 이득은 없고 판정 경로에 회귀 위험만 얹는다. `STORAGE_BACKEND` 기본값을 `local`로 두면 기존 테스트는 **호출 시그니처 한 곳만 바꿔** 그대로 통과한다.
단, **대시보드에는 로컬 모드를 두지 않는다.** Vercel 파일시스템은 읽기 전용·휘발성이라 로컬 분기는 영원히 죽은 코드이고, `fs.readFile` 경로가 배포본에 남아 있는 것 자체가 리뷰 부담이다.

**2. Supabase Free 한도 → 상한을 버킷 설정과 한 값으로 묶고, 초과를 한국어로 안내한다.**
현재 대시보드 상한은 1GiB(`MAX_UPLOAD_BYTES`)인데 Free 티어 실제 한도는 **파일당 50MB·총 1GB**라 불일치다. 005에서 세 버킷의 `file_size_limit`을 50MB로 설정하고, 대시보드 상한은 `NEXT_PUBLIC_MAX_UPLOAD_BYTES`(기본 52428800)로 뽑아 **Pro 승급 시 SQL 한 줄 + 환경변수 한 줄로 올린다**. 업로드 전 클라이언트 검사에서 걸러 주고, Storage가 413/507로 거부하는 경우도 한국어 메시지로 번역해 노출한다.

**3. 서명 URL vs 프록시 → 서명 URL 302 리다이렉트.**
Vercel 서버리스 함수는 응답 본문이 약 4.5MB로 제한된다. 보고서 PDF(사진·히트맵 포함)는 이 선을 넘나들고 원본 점군은 확실히 넘으므로 **프록시는 구조적으로 불가능**하다. 리다이렉트는 대역폭도 Supabase에서 브라우저로 직접 흘러 Vercel Hobby 대역폭을 소모하지 않는다. 인증은 라우트가 `supabase.auth.getUser()`로 먼저 확인한 뒤에만 서명 URL을 발급하므로 유지되고, TTL 300초로 URL 유출 창을 좁힌다. 리다이렉트 응답에는 `cache-control: private, no-store`를 붙여 만료된 URL이 캐시에서 재사용되지 않게 한다.

**4. 기존 로컬 데이터(17MB) → 재분석이 아니라 일회성 업로드 스크립트.**
재분석은 새 `analysis_id`를 채번하므로 `analyses.artifacts_dir`가 바뀌고, **발행본(finalized) 보고서의 `pdf_path`·`snapshot`은 004 트리거가 잠가 두어 되돌릴 수 없다**. 즉 재분석하면 기존 발행본이 영구히 고아가 된다. 17MB는 업로드 몇 분이므로 `worker/scripts/upload_local_data.py`(멱등·`--dry-run`)로 그대로 옮긴다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/migrations/005_storage_buckets.sql` (신규) | 버킷 3종 생성 + storage.objects RLS |
| `worker/flatworker/storage.py` (신규) | `Storage` 프로토콜 + `LocalStorage`/`SupabaseStorage` + 키 검증 |
| `worker/flatworker/config.py` | `STORAGE_BACKEND` 키 추가 |
| `worker/flatworker/jobs.py` | analyze/import/report를 스테이징 + Storage 왕복으로 전환 |
| `worker/flatworker/report/{context,assets}.py` | `cfg.data_dir` 직접 읽기 → `storage` 주입 |
| `worker/scripts/upload_local_data.py` (신규) | 기존 `data/` 일회성 이관 |
| `Dockerfile`·`.dockerignore` (신규, 저장소 루트) | 워커 컨테이너(엔진+워커+Chromium+한글 폰트) |
| `dashboard/lib/server/storage-objects.ts` (신규, `data-files.ts` 대체) | 세그먼트 검증 → `{bucket, key}`. `contentTypeFor`는 이 파일로 그대로 옮긴다 |
| `dashboard/app/api/data/[...path]/route.ts` | 서명 URL 302 리다이렉트 |
| `dashboard/lib/scans/upload.ts` (신규) | 브라우저 → Storage 직접 업로드(`lib/photos/upload.ts` 패턴) |
| `dashboard/app/api/upload/route.ts` | **삭제** |
| `docs/DEPLOY.md` (신규) | Railway·Vercel 배포 절차(사용자 수행 단계 분리) |

---

## Task 1: 마이그레이션 005 + 워커 Storage 어댑터

**Files:**
- Create: `supabase/migrations/005_storage_buckets.sql`
- Create: `worker/flatworker/storage.py`
- Modify: `worker/flatworker/config.py`, `worker/.env.example`
- Test: `worker/tests/test_storage.py` (신규)

**Interfaces:**
- Produces: `Storage` 프로토콜 - `download(key) -> bytes | None`, `download_to(key, dst: Path) -> bool`, `upload(key, data: bytes, content_type: str | None = None) -> None`, `upload_dir(prefix: str, src_dir: Path) -> list[str]`, `delete_prefix(prefix: str) -> None`. `key`/`prefix`는 **버킷-상대 규약 문자열 전체**(첫 세그먼트가 버킷명, 예 `artifacts/{analysis_id}/stats.json`).
- Produces: `split_key(key) -> tuple[str, str]` (버킷, 객체키). 허용 버킷 밖이거나 `..`·빈 세그먼트·역슬래시·NUL이 있으면 `ValueError` (대시보드 `resolveStorageObject`와 동일 규칙).
- Produces: `get_storage(cfg, db) -> Storage` - `cfg.storage_backend`에 따라 `LocalStorage(cfg.data_dir)` 또는 `SupabaseStorage(db)`.
- Produces: `Config.storage_backend: str` (기본 `"local"`).

- [ ] **Step 1: 키 검증 실패 테스트를 쓴다**

```python
# worker/tests/test_storage.py
import pytest
from flatworker.storage import LocalStorage, split_key

def test_split_key_normal():
    assert split_key("artifacts/a1/stats.json") == ("artifacts", "a1/stats.json")

@pytest.mark.parametrize("bad", [
    "secrets/x.txt", "artifacts", "artifacts/../etc/passwd",
    "artifacts//x.png", "artifacts/a\\b.png", "artifacts/a\0b.png",
])
def test_split_key_rejects(bad):
    with pytest.raises(ValueError):
        split_key(bad)
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd worker && python -m pytest tests/test_storage.py -v`
Expected: FAIL (`ModuleNotFoundError: flatworker.storage`)

- [ ] **Step 3: `storage.py`의 키 검증과 `LocalStorage`를 구현한다**

```python
"""파일 저장 어댑터 - 로컬 디렉터리(개발·테스트)와 Supabase Storage(운영).

키 규약: 스펙 §6.3 버킷-상대 문자열 전체를 그대로 키로 쓴다. 첫 세그먼트가 버킷명이며
DB에 저장된 문자열(scans.raw_file_path·analyses.artifacts_dir·reports.pdf_path)을
가공 없이 넘길 수 있다.
"""
import shutil
from pathlib import Path

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

    def upload(self, key, data, content_type=None):
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def upload_dir(self, prefix, src_dir):
        """src_dir를 재귀 순회해 `{prefix}/{상대경로}` 키로 올리고 키 목록을 반환한다."""
        uploaded = []
        for f in sorted(Path(src_dir).rglob("*")):
            if f.is_file():
                rel = f.relative_to(src_dir).as_posix()
                self.upload(f"{prefix}/{rel}", f.read_bytes(), content_type_for(f.name))
                uploaded.append(f"{prefix}/{rel}")
        return uploaded

    def delete_prefix(self, prefix):
        split_key(f"{prefix}/x")  # 검증만
        shutil.rmtree(self._root / prefix, ignore_errors=True)
```

`download_to(key, dst)`는 `download` 결과를 `dst`에 쓰고 성공 여부(bool)를 반환한다. 두 구현이 동일하므로 모듈 함수 `_download_to(storage, key, dst)`로 한 번만 쓰고 양쪽에서 위임한다.

- [ ] **Step 4: `LocalStorage` 왕복 테스트를 추가하고 통과를 확인한다**

```python
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
```

Run: `cd worker && python -m pytest tests/test_storage.py -v`
Expected: PASS

- [ ] **Step 5: `SupabaseStorage`를 구현한다**

`SupabaseRest`가 이미 들고 있는 httpx 클라이언트(`db._client`, base_url·apikey 헤더 설정 완료)를 재사용해 새 연결·재인증을 만들지 않는다.

```python
class SupabaseStorage:
    """Supabase Storage REST(`/storage/v1/...`). SupabaseRest의 httpx 클라이언트를
    재사용한다 - service_role 키라 RLS를 우회하고 버킷 3종 모두 읽기·쓰기가 된다.
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

    def upload(self, key, data, content_type=None):
        bucket, obj = split_key(key)
        resp = self._client.post(
            f"/storage/v1/object/{bucket}/{obj}", content=data,
            headers={"content-type": content_type or content_type_for(obj),
                     "x-upsert": "true"})
        if resp.status_code >= 400:
            raise DBError(resp.status_code, resp.text)

    # upload_dir는 LocalStorage와 완전히 같은 순회 로직이므로 모듈 함수
    # `_upload_dir(storage, prefix, src_dir)`로 뽑아 두 구현이 함께 쓴다.

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
```

`SupabaseStorage`는 실 프로젝트 없이는 검증할 수 없으므로 단위 테스트를 만들지 않는다(`SupabaseRest`와 동일한 결정, `worker/flatworker/db.py` 클래스 주석 참고). 검증은 Task 5의 배포 스모크로 한다.

- [ ] **Step 6: `config.py`에 `STORAGE_BACKEND`를 추가한다**

```python
_KEY_STORAGE_BACKEND = "STORAGE_BACKEND"
_DEFAULT_STORAGE_BACKEND = "local"   # 배포(Railway)에서만 supabase로 올린다
_VALID_BACKENDS = ("local", "supabase")
```

`Config`에 `storage_backend: str` 필드를 추가하고, `load_config`에서 값을 소문자로 정규화한 뒤 `_VALID_BACKENDS` 밖이면 `ConfigError("STORAGE_BACKEND는 local 또는 supabase여야 합니다: ...")`를 던진다. `.env.example`에도 같은 주석으로 추가한다.

- [ ] **Step 7: config 테스트를 추가하고 worker 전량을 돌린다**

```python
def test_storage_backend_default_is_local(tmp_path):
    (tmp_path / ".env").write_text(
        "SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n", encoding="utf-8")
    assert load_config(tmp_path / ".env").storage_backend == "local"

def test_invalid_storage_backend_raises(tmp_path):
    (tmp_path / ".env").write_text(
        "SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n"
        "STORAGE_BACKEND=s3\n", encoding="utf-8")
    with pytest.raises(ConfigError):
        load_config(tmp_path / ".env")
```

Run: `cd worker && python -m pytest -q`
Expected: 기존 73개 + 신규 테스트 전부 PASS

- [ ] **Step 8: 마이그레이션 005를 작성한다**

```sql
-- =============================================================================
-- 마이그레이션 005 - 클라우드 배포용 Storage 버킷
-- 선행: 001~004. 003의 photos 버킷과 동일한 방식(private + storage.objects RLS).
-- 파일당 상한 50MB는 Supabase Free 티어 한도에 맞춘 값이다. Pro 승급 시 이 값과
-- 대시보드 NEXT_PUBLIC_MAX_UPLOAD_BYTES를 함께 올린다.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('raw-scans', 'raw-scans', false, 52428800),
       ('artifacts', 'artifacts', false, 52428800),
       ('reports',   'reports',   false, 52428800)
on conflict (id) do nothing;

-- 원본 점군: 로그인 사용자가 업로드·조회(대시보드가 브라우저에서 직접 올린다)
drop policy if exists raw_scans_all_auth on storage.objects;
create policy raw_scans_all_auth on storage.objects for all to authenticated
  using (bucket_id = 'raw-scans') with check (bucket_id = 'raw-scans');

-- 산출물·보고서: 쓰기는 워커(service_role, RLS 우회)만. 로그인 사용자는 읽기 전용.
drop policy if exists artifacts_reports_read_auth on storage.objects;
create policy artifacts_reports_read_auth on storage.objects for select to authenticated
  using (bucket_id in ('artifacts', 'reports'));
```

- [ ] **Step 9: 커밋**

```bash
git add supabase/migrations/005_storage_buckets.sql worker/flatworker/storage.py \
        worker/flatworker/config.py worker/.env.example worker/tests/test_storage.py \
        worker/tests/test_config.py
git commit -m "feat(worker,db): Storage 버킷 3종 마이그레이션 005 + 파일 저장 어댑터"
```

---

## Task 2: 워커 잡 파이프라인 Storage 전환

**Files:**
- Modify: `worker/flatworker/jobs.py`, `worker/flatworker/artifacts.py`
- Modify: `worker/flatworker/report/context.py:31-41,56`, `worker/flatworker/report/assets.py:77-172`
- Test: `worker/tests/{test_jobs,test_report_assets,test_report_e2e,test_e2e_fake}.py` (호출부 수정 + 신규 케이스)

**Interfaces:**
- Consumes: Task 1의 `get_storage(cfg, db)`, `Storage` 프로토콜.
- Produces: `load_report_context(db, storage, report_id) -> ReportContext` (`cfg` 파라미터 제거).
- Produces: `build_assets(db, storage, report_id, ctx, work_dir=None) -> dict` (`work_dir`가 None이면 임시 디렉터리를 만들어 업로드 후 폐기).
- Produces: `artifacts.staging_dir()` - `tempfile.TemporaryDirectory`를 감싼 컨텍스트 매니저(`Path` 반환).
- 불변: `_finalize`가 쓰는 `artifacts_dir = f"artifacts/{analysis_id}"`, `pdf_path = f"reports/{report_id}/report.pdf"` 문자열은 그대로다.

- [ ] **Step 1: analyze가 Storage에서 원본을 읽고 산출물을 올리는지 검증하는 테스트를 쓴다**

```python
# worker/tests/test_jobs.py 에 추가
def test_handle_analyze_reads_and_writes_through_storage(tmp_path):
    """원본이 data_dir에 파일로 없고 Storage에만 있어도 분석이 되고,
    산출물이 Storage 키(artifacts/{id}/...)로 올라간다."""
    db, cfg = FakeDB(), _cfg(tmp_path)
    storage = get_storage(cfg, db)
    _seed_scan_via_storage(db, storage)          # storage.upload("raw-scans/site1/scan1/raw.ply", blob)
    aid = _seed_analysis(db)
    handle_analyze(db, cfg, {"analysis_id": aid})
    assert storage.download(f"artifacts/{aid}/stats.json") is not None
    assert storage.download(f"artifacts/{aid}/heatmap.png") is not None
    assert db.analyses[aid]["artifacts_dir"] == f"artifacts/{aid}"
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd worker && python -m pytest tests/test_jobs.py -k storage -v`
Expected: FAIL (현재 `_resolve_raw_path`가 `cfg.data_dir`에 직접 결합해 열려다 실패)

- [ ] **Step 3: `artifacts.py`에 스테이징 헬퍼를 추가한다**

```python
"""산출물 경로 규약(스펙 §6.3)과 스테이징 디렉터리.

경로 규약 문자열(`raw-scans/{site_id}/{scan_id}/`, `artifacts/{analysis_id}/`)은 DB
저장값 그대로이고, 실제 파일은 Storage에 있다. 엔진은 로컬 `Path`에만 쓸 수 있으므로
잡 처리 동안만 임시 디렉터리를 쓰고 끝나면 지운다.
"""
import tempfile
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def staging_dir():
    with tempfile.TemporaryDirectory(prefix="flatworker-") as d:
        yield Path(d)
```

기존 `raw_scan_dir`/`artifacts_dir`는 **테스트와 이관 스크립트가 쓰므로 지우지 않는다**(로컬 레이아웃 계산 함수로 남는다).

- [ ] **Step 4: `jobs.py`의 analyze/import를 스테이징으로 바꾼다**

```python
def _fetch_raw(storage, scan, work):
    """scans.raw_file_path(버킷-상대 규약 문자열)를 스테이징에 내려받아 경로를 준다."""
    key = scan["raw_file_path"]
    p = Path(key)
    if p.is_absolute():           # 과거 데이터 호환: 절대경로가 저장돼 있으면 그대로 연다
        return p
    dst = work / p.name
    if not storage.download_to(key, dst):
        raise ValueError(
            f"원본 파일을 저장소에서 찾을 수 없습니다: {key}. 파일을 다시 업로드하세요.")
    return dst


def handle_analyze(db, cfg, payload):
    analysis_id = payload["analysis_id"]
    analysis, scan, crit, u_mm = _load_context(db, analysis_id)
    storage = get_storage(cfg, db)
    with staging_dir() as work:
        path = _fetch_raw(storage, scan, work)
        out_dir = work / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        scale_to_m = scan["unit_scale"]
        if scan["surface"] == "wall":
            stats = analyze_wall(path, scale_to_m, crit, u_mm, out_dir)
        else:
            stats = analyze_floor(path, scale_to_m, crit, u_mm, out_dir)
        storage.upload_dir(f"artifacts/{analysis_id}", out_dir)
    _finalize(db, analysis_id, analysis["scan_id"], stats)
```

`handle_import`도 동일 구조(확장자 분기·바닥 전용 가드는 그대로). `_finalize`는 더 이상 `out_dir`를 쓰지 않으므로 파라미터에서 뺀다. `_resolve_raw_path`는 `_fetch_raw`로 대체돼 삭제한다.

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `cd worker && python -m pytest tests/test_jobs.py tests/test_e2e_fake.py -q`
Expected: PASS (기존 단언 `(artifacts_dir(cfg.data_dir, aid) / "heatmap.png").exists()`는 `LocalStorage`가 같은 경로에 쓰므로 그대로 성립한다)

- [ ] **Step 6: 보고서 컨텍스트·자산을 Storage로 바꾼다**

`context.py`: `_load_cells(cfg, analysis)` → `_load_cells(storage, analysis)`.

```python
def _load_cells(storage, analysis):
    artifacts_dir = analysis.get("artifacts_dir")
    if not artifacts_dir:
        raise ValueError(f"분석 {analysis['id']}의 산출물 경로가 없습니다. 분석을 다시 실행하세요.")
    blob = storage.download(f"{artifacts_dir}/cells.json")
    if blob is None:
        raise ValueError(
            f"분석 {analysis['id']}의 셀 데이터(cells.json)를 저장소에서 찾을 수 없습니다: "
            f"{artifacts_dir}. 분석을 다시 실행하세요.")
    return json.loads(blob.decode("utf-8"))
```

`load_report_context(db, cfg, report_id)` → `load_report_context(db, storage, report_id)`.

`assets.py`: `_copy_if_exists(src, dst)` → `_fetch_if_exists(storage, key, dst)`가 `storage.download(key)`로 받아 `dst.write_bytes`한다. `_copy_analysis_assets`의 `src_dir = Path(cfg.data_dir) / bundle.analysis["artifacts_dir"]`는 `src_prefix = bundle.analysis["artifacts_dir"]` 문자열로 바뀌고, `src_dir / name` → `f"{src_prefix}/{name}"`. **경고 문구(notes)·`assets_rel` 반환 문자열·히스토그램 생성 로직은 한 글자도 바꾸지 않는다.** 사진은 기존 `db.download_photo` 경로를 그대로 쓴다(photos 버킷은 이미 Storage라 바꿀 것이 없다).

```python
def build_assets(db, storage, report_id, ctx, work_dir=None):
    """work_dir가 주어지면 그 아래 assets/에 쓰고 업로드까지 한다(호출자가 PDF 렌더에
    같은 디렉터리를 쓴다). None이면 임시 디렉터리를 만들어 업로드 후 폐기한다."""
    with ExitStack() as stack:
        if work_dir is None:
            work_dir = stack.enter_context(staging_dir())
        assets_root = Path(work_dir) / "assets"
        assets_root.mkdir(parents=True, exist_ok=True)
        notes = []
        per_analysis = {}
        for bundle in ctx.bundles:
            per_analysis[str(bundle.analysis["id"])] = _copy_analysis_assets(
                storage, report_id, bundle, assets_root, notes)
        photos = _copy_photos(db, report_id, ctx.photos, assets_root, notes)
        # 스테이징이 항상 새 디렉터리라 로컬 rmtree는 필요 없다. 재생성 시 이전 자산
        # 잔재가 저장소에 남지 않도록 원격 접두만 지우고 새로 올린다.
        storage.delete_prefix(f"reports/{report_id}/assets")
        storage.upload_dir(f"reports/{report_id}/assets", assets_root)
        return {"analyses": per_analysis, "photos": photos, "notes": notes}
```

`report_dir(data_dir, report_id)`는 이관 스크립트가 쓰므로 남긴다.

- [ ] **Step 7: `handle_report`를 스테이징으로 바꾼다**

```python
def handle_report(db, cfg, payload, renderer=None):
    """... (기존 독스트링 유지, 발행본 보호 설명만 갱신)

    발행본 보호: 원격 객체는 `db.update_report`가 성공한 **뒤에만** 건드린다. 렌더링
    도중 발행이 확정되면 004의 `fn_reports_finalized_guard`가 update_report를 42501로
    거부하고, 이 함수는 스테이징만 버린 채 예외를 올린다 - 저장소의 발행본
    report.pdf·assets는 한 바이트도 바뀌지 않는다(로컬 os.replace 방어보다 강하다).
    남는 창: update_report 성공 직후 업로드가 실패하면 DB는 done인데 저장소 파일이
    이전 버전으로 남는다. 파일시스템과 DB를 한 트랜잭션으로 묶을 수 없어 생기는
    구조적 한계이며 은폐하지 않고 여기 명시한다.
    """
    report_id = payload["report_id"]
    storage = get_storage(cfg, db)
    ctx = load_report_context(db, storage, report_id)
    report_now = db.get_report(report_id)
    if report_now.get("status") == "finalized":
        raise ValueError("발행된 보고서는 다시 생성할 수 없습니다. 새 보고서를 만드세요.")
    with staging_dir() as work:
        assets = build_assets(db, storage, report_id, ctx, work_dir=work)
        snapshot = build_snapshot(ctx, assets)
        html = render_html(snapshot)
        if renderer is None:
            from flatworker.report.renderer import PlaywrightRenderer
            renderer = PlaywrightRenderer()
        pdf_path = work / "report.pdf"
        renderer.render_pdf(html, work, pdf_path)
        db.update_report(report_id, {
            "snapshot": snapshot,
            "pdf_path": f"reports/{report_id}/report.pdf",
            "gen_status": "done",
            "gen_error": None,
        })
        storage.upload(f"reports/{report_id}/report.pdf", pdf_path.read_bytes(),
                       "application/pdf")
```

- [ ] **Step 8: 보고서 테스트 호출부를 고치고 전량을 돌린다**

`tests/test_report_assets.py`·`test_report_e2e.py`의 `load_report_context(db, cfg, "r1")` → `load_report_context(db, _storage(tmp_path), "r1")`, `build_assets(db, cfg, ...)` → `build_assets(db, storage, ...)`로 바꾼다(`_storage(tmp_path) = LocalStorage(tmp_path / "data")` 헬퍼 추가). 파일이 떨어지는 실제 경로는 `LocalStorage` 루트가 같아 **단언은 그대로 둔다**.

`test_report_e2e.py`의 발행 경합 회귀 테스트 2건은 **기존 준비 코드(`_seed_analyzed_floor`·`_seed_report`·`_FinalizeDuringRenderRenderer`·`_FinalizeOnSecondGetReportDB`)를 그대로 두고 마지막 단언만** 바꾼다.

- 렌더링 도중 발행 확정: `pdf_path.read_bytes() == published_bytes` → `storage.download(f"reports/r1/report.pdf") == published_bytes`. `report.pdf.tmp` 잔재 단언은 스테이징이 컨텍스트 종료 시 통째로 지워지므로 삭제한다(원자적 교체를 tmp 파일이 아니라 "원격 미변경"이 담보한다).
- 자산 보존(`sentinel.txt`): 로컬 `assets_dir`에 쓰던 sentinel을 `storage.upload("reports/r1/assets/sentinel.txt", b"...")`로 올려 두고, 마지막에 `assert storage.download("reports/r1/assets/sentinel.txt") is not None`으로 바꾼다.

Run: `cd worker && python -m pytest -q`
Expected: 73개 + 신규 케이스 전부 PASS

- [ ] **Step 9: 커밋**

```bash
git add worker/flatworker worker/tests
git commit -m "feat(worker): 분석·보고서 산출물을 스테이징 경유 Storage 입출력으로 전환"
```

---

## Task 3: 대시보드 Storage 전환 (서명 URL·직접 업로드·용량 상한)

**Files:**
- Create: `dashboard/lib/server/storage-objects.ts`, `dashboard/lib/scans/upload.ts`
- Delete: `dashboard/lib/server/data-files.ts`, `dashboard/app/api/upload/route.ts`
- Modify: `dashboard/app/api/data/[...path]/route.ts`, `dashboard/lib/upload/validate.ts`, `dashboard/components/upload-form.tsx`, `dashboard/.env.example`
- Test: `dashboard/lib/server/__tests__/storage-objects.test.ts`(`data-files.test.ts` 이관), `dashboard/lib/upload/__tests__/validate.test.ts`

**Interfaces:**
- Produces: `resolveStorageObject(segments: string[]): { bucket: string; key: string } | null` - 허용 버킷(`raw-scans`·`artifacts`·`reports`) 밖, 세그먼트 2개 미만, 빈 세그먼트·`.`·`..` 포함·슬래시·역슬래시·NUL이면 `null`.
- Produces: `uploadRawScan(supabase, file, siteId, scanId, ext): Promise<string>` - 규약 경로에 업로드하고 `rel_path`를 반환. `lib/photos/upload.ts` 패턴 확장.
- Produces: `storageErrorMessage(err: unknown): string` - Storage 오류를 한국어로 번역(용량 초과·중복 등).
- 불변: `dataUrl`/`artifactUrl`/`rawScanRelPath`(`lib/domain/paths.ts`)와 `/api/data/...` URL 형태는 그대로다. 소비 컴포넌트(analysis-result·deviation-view·reports 페이지)는 **수정하지 않는다**.

- [ ] **Step 1: 경로 검증 테스트를 이관해 쓴다**

`lib/server/__tests__/data-files.test.ts`의 `resolveDataPath` 4개 `it` 블록을 **입력은 한 글자도 바꾸지 말고** 그대로 옮긴다(테스트 개수·거부 케이스 유지). 기대값만 절대경로에서 `{bucket, key}`로, `toBeNull()`은 그대로 둔다.

```typescript
// dashboard/lib/server/__tests__/storage-objects.test.ts (통과 케이스 2건만 발췌 - 나머지
// 거부 케이스 입력값은 data-files.test.ts에서 그대로 복사한다)
expect(resolveStorageObject(['artifacts', 'a1', 'stats.json']))
  .toEqual({ bucket: 'artifacts', key: 'a1/stats.json' });
expect(resolveStorageObject(['artifacts', 'abc', 'stats.json']))
  .toEqual({ bucket: 'artifacts', key: 'abc/stats.json' });
```

기존 `contentTypeFor` describe 블록은 그대로 남긴다(업로드 시 content-type 지정에 계속 쓴다).

- [ ] **Step 2: 실패를 확인한다**

Run: `cd dashboard && npx vitest run lib/server`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: `storage-objects.ts`를 구현한다**

```typescript
// 서버 전용: /api/data 세그먼트를 Storage 버킷·객체키로 해석한다.
// 로컬 파일시스템이 없어도 경로 탈출 방어는 그대로 유지해야 한다 - 슬래시를 임베드한
// 단일 세그먼트로 다른 버킷·상위 경로를 가리키는 우회를 과거 리뷰가 실 HTTP로 재현한
// 이력이 있다(worker/flatworker/storage.py의 split_key와 동일 규칙).
const ALLOWED_BUCKETS = ['raw-scans', 'artifacts', 'reports'];

export function resolveStorageObject(segments: string[]): { bucket: string; key: string } | null {
  if (segments.length < 2) return null;
  if (!ALLOWED_BUCKETS.includes(segments[0])) return null;
  if (segments.some((s) =>
    s.length === 0 || s === '.' || s.includes('..') || s.includes('/') ||
    s.includes('\\') || s.includes('\0')
  )) return null;
  return { bucket: segments[0], key: segments.slice(1).join('/') };
}
```

Run: `cd dashboard && npx vitest run lib/server` → PASS

- [ ] **Step 4: `/api/data` 라우트를 서명 URL 리다이렉트로 바꾼다**

```typescript
// Supabase Storage 서빙 - 인증 확인 후 단기 서명 URL로 302 리다이렉트한다.
// 프록시하지 않는 이유: Vercel 서버리스 응답 본문 상한(약 4.5MB)에 보고서 PDF·원본
// 점군이 걸린다. 리다이렉트는 대역폭도 Supabase에서 브라우저로 직접 흐른다.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveStorageObject } from '@/lib/server/storage-objects';

const SIGNED_URL_TTL_S = 300;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const { path: segments } = await params;
  const target = resolveStorageObject(segments);
  if (!target) return NextResponse.json({ error: '잘못된 경로입니다' }, { status: 400 });

  const { data, error } = await supabase.storage
    .from(target.bucket)
    .createSignedUrl(target.key, SIGNED_URL_TTL_S);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: '파일을 찾을 수 없습니다' }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: { 'cache-control': 'private, no-store' },
  });
}
```

- [ ] **Step 5: 업로드를 브라우저 직접 업로드로 바꾼다**

`/api/upload` 라우트를 **삭제한다**. 서버 경유는 Vercel 요청 본문 상한(약 4.5MB)에 걸려 원본 점군을 아예 못 올리고, 클라이언트가 anon 키로 Storage를 직접 호출할 수 있는 이상 보안상 얻는 것도 없다(사진 업로드가 이미 같은 구조다).

```typescript
// dashboard/lib/scans/upload.ts
// lib/photos/upload.ts 패턴 확장: 브라우저에서 Storage로 직접 올린다.
import type { SupabaseClient } from '@supabase/supabase-js';
import { rawScanRelPath } from '@/lib/domain/paths';

export function storageErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(msg)) {
    return '파일이 저장소 한도를 초과했습니다. 관리자에게 저장소 요금제 상향을 요청하거나 더 작은 범위로 나눠 스캔하세요.';
  }
  if (/exceeded.*quota|storage limit/i.test(msg)) {
    return '저장소 용량이 가득 찼습니다. 오래된 스캔을 정리하거나 요금제를 올려야 합니다.';
  }
  return `파일 업로드에 실패했습니다: ${msg}`;
}

export async function uploadRawScan(
  supabase: SupabaseClient, file: File, siteId: string, scanId: string, ext: string,
): Promise<string> {
  const rel = rawScanRelPath(siteId, scanId, ext);          // raw-scans/{site}/{scan}/raw.{ext}
  const key = rel.replace(/^raw-scans\//, '');
  const { error } = await supabase.storage.from('raw-scans').upload(key, file, { upsert: true });
  if (error) throw new Error(storageErrorMessage(error));
  return rel;
}
```

`upload-form.tsx`의 2)단계(`fetch('/api/upload', ...)`)를 `const relPath = await uploadRawScan(supabase, file, siteId, scan.id, v.ext);`로 교체하고, 3)단계의 `body.rel_path`를 `relPath`로 바꾼다. 파일 입력 아래 안내 문구도 갱신한다.

```tsx
<p className="mt-1 text-xs text-slate-500">
  파일은 Supabase Storage에 저장됩니다. 파일당 최대 {MAX_UPLOAD_MB}MB입니다.
</p>
```

- [ ] **Step 6: 업로드 상한을 Free 한도에 맞춘다**

```typescript
// dashboard/lib/upload/validate.ts
// 업로드 크기 상한: Supabase Free 티어는 파일당 50MB·총 1GB다. 005 마이그레이션의
// 버킷 file_size_limit과 반드시 같은 값을 써야 한다(불일치하면 브라우저는 통과시켰는데
// Storage가 413으로 거부하는 혼란이 생긴다). Pro 승급 시 이 환경변수와 버킷 설정을
// 함께 올린다.
export const MAX_UPLOAD_BYTES = Number(
  process.env.NEXT_PUBLIC_MAX_UPLOAD_BYTES ?? 52428800,
);
export const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

export function isUploadSizeAllowed(size: number): boolean {
  return size <= MAX_UPLOAD_BYTES;
}
```

`upload-form.tsx`의 초과 메시지를 GiB에서 MB 기준으로 바꾼다.

```tsx
setError(`파일이 너무 큽니다(최대 ${MAX_UPLOAD_MB}MB). 스캔 범위를 나눠 다시 시도하세요.`);
```

- [ ] **Step 7: 상한·오류 번역 테스트를 추가하고 전량을 돌린다**

```typescript
it('50MB 초과는 거부한다', () => {
  expect(isUploadSizeAllowed(52428800)).toBe(true);
  expect(isUploadSizeAllowed(52428801)).toBe(false);
});
it('Storage 용량 초과 오류를 한국어로 번역한다', () => {
  expect(storageErrorMessage(new Error('The object exceeded the maximum allowed size')))
    .toContain('저장소 한도를 초과');
});
```

Run: `cd dashboard && npm test && npx tsc --noEmit && npm run lint`
Expected: 127개 + 신규 케이스 PASS, 타입·린트 오류 0

- [ ] **Step 8: 커밋**

```bash
git add dashboard
git rm dashboard/lib/server/data-files.ts dashboard/lib/server/__tests__/data-files.test.ts \
       dashboard/app/api/upload/route.ts
git commit -m "feat(dashboard): 파일 서빙·업로드를 Supabase Storage 서명 URL 방식으로 전환"
```

---

## Task 4: 워커 컨테이너화 (Chromium + 한글 폰트)

**Files:**
- Create: `Dockerfile`, `.dockerignore` (저장소 루트)
- Modify: `worker/README.md`

**Interfaces:**
- Consumes: `engine/pyproject.toml`(numpy·laspy[lazrs]·matplotlib·scipy), `worker/pyproject.toml`(httpx·python-dotenv·numpy·matplotlib·jinja2·playwright).
- Produces: 컨테이너 이미지. 엔트리포인트 `python -m flatworker`, 작업 디렉터리 `/app/worker`.

> 백로그 티켓 37: 보고서 템플릿 폰트 폴백은 `'Noto Sans KR', 'Malgun Gothic', sans-serif`다. 리눅스 이미지에 한글 폰트가 없으면 **PDF의 한글이 전부 네모 상자로 출력된다**. 티켓 43(히스토그램 matplotlib 폰트)도 같은 폰트 패키지로 함께 해소된다.

- [ ] **Step 1: `.dockerignore`를 만든다**

```
data/
docs/
dashboard/
.git/
**/__pycache__/
**/*.pyc
**/.pytest_cache/
**/*.egg-info/
**/.env
**/.env.*
!**/.env.example
```

- [ ] **Step 2: `Dockerfile`을 만든다**

```dockerfile
# 워커 컨테이너 (Railway 배포용) - 빌드 컨텍스트는 저장소 루트다(engine/·worker/ 둘 다 필요).
FROM python:3.11-slim

# fonts-noto-cjk: 백로그 티켓 37 - 이 패키지가 없으면 보고서 PDF와 matplotlib 히스토그램의
# 한글이 네모 상자로 렌더된다. 템플릿 폴백 체인의 첫 후보('Noto Sans KR')가 여기서 걸린다.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-noto-cjk fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY engine/ ./engine/
COPY worker/ ./worker/

RUN pip install --no-cache-dir -e ./engine && pip install --no-cache-dir -e ./worker

# Chromium 본체 + 실행에 필요한 시스템 라이브러리. pip로 설치된 playwright 버전과
# 정확히 짝이 맞는 빌드를 내려받으므로 버전 불일치 실패가 없다.
RUN playwright install --with-deps chromium

WORKDIR /app/worker
ENV PYTHONUNBUFFERED=1 STORAGE_BACKEND=supabase
CMD ["python", "-m", "flatworker"]
```

- [ ] **Step 3: 이미지를 빌드한다**

Run: `docker build -t flatworker:local .` (저장소 루트에서)
Expected: 성공. 실패하면 로그의 누락 패키지를 apt 목록에 추가한다(`--with-deps`가 대부분 처리한다).

- [ ] **Step 4: 컨테이너 안에서 한글 PDF 스모크를 돌린다**

기존 `worker/tests/test_report_playwright_smoke.py`(`-m browser` 마커)를 그대로 쓴다.

Run:
```bash
docker run --rm -e SUPABASE_URL=https://x.supabase.co -e SUPABASE_SERVICE_ROLE_KEY=x \
  flatworker:local python -m pytest -m browser -q
```
Expected: 1 passed

- [ ] **Step 5: 렌더된 PDF를 눈으로 대조한다**

Run:
```bash
docker run --rm -v "$PWD/tmp-pdf:/out" flatworker:local python -c "
from flatworker.report.renderer import PlaywrightRenderer
PlaywrightRenderer().render_pdf(
    \"<html><head><meta charset='utf-8'><style>body{font-family:'Noto Sans KR',sans-serif}</style></head>\"
    \"<body><h1>평활도 분석 보고서</h1><p>한글 폰트 확인: 재시공·보수·경계·적합</p></body></html>\",
    '/out', '/out/font-check.pdf')"
```
Expected: `tmp-pdf/font-check.pdf`를 열었을 때 한글이 네모 상자가 아니라 정상 글자로 보인다. **이 육안 확인 없이 통과를 주장하지 않는다.**

- [ ] **Step 6: 커밋**

```bash
git add Dockerfile .dockerignore worker/README.md
git commit -m "feat(worker): Chromium·Noto Sans KR 포함 워커 컨테이너 이미지(티켓 37 해소)"
```

---

## Task 5: 배포 설정 · 기존 데이터 이관 · 문서 갱신

**Files:**
- Create: `worker/scripts/upload_local_data.py`, `docs/DEPLOY.md`
- Modify: `docs/SUPABASE_SETUP.md`, `docs/service-report.md`(§3.3·§3.5·§6.6), `dashboard/README.md`, `worker/README.md`, `dashboard/.env.example`
- Test: `worker/tests/test_upload_local_data.py`

**Interfaces:**
- Consumes: Task 1의 `get_storage`/`Storage`, `LocalStorage`.
- Produces: `collect_uploads(data_dir) -> list[tuple[str, Path]]` - `data/` 아래 허용 버킷 3종의 파일을 (키, 경로) 목록으로 모은다. `upload_all(storage, items, dry_run=False, skip_existing=True) -> dict` - 업로드하고 `{"uploaded": n, "skipped": n}` 반환.

- [ ] **Step 1: 이관 스크립트 테스트를 쓴다**

```python
# worker/tests/test_upload_local_data.py
def test_collect_and_upload_is_idempotent(tmp_path):
    src = tmp_path / "data"
    (src / "artifacts" / "a1").mkdir(parents=True)
    (src / "artifacts" / "a1" / "stats.json").write_text("{}", encoding="utf-8")
    (src / "logs").mkdir()                       # 허용 버킷 밖은 무시한다
    (src / "logs" / "x.txt").write_text("x", encoding="utf-8")
    items = collect_uploads(src)
    assert [k for k, _ in items] == ["artifacts/a1/stats.json"]
    dst = LocalStorage(tmp_path / "remote")
    assert upload_all(dst, items) == {"uploaded": 1, "skipped": 0}
    assert upload_all(dst, items) == {"uploaded": 0, "skipped": 1}   # 재실행 안전
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd worker && python -m pytest tests/test_upload_local_data.py -v`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 스크립트를 구현한다**

```python
"""기존 로컬 data/를 Supabase Storage로 일회성 이관한다.

재분석이 아니라 이관을 택한 이유: 재분석은 새 analysis_id를 채번해
analyses.artifacts_dir가 바뀌는데, 발행본(finalized) 보고서의 pdf_path·snapshot은
004의 트리거가 잠가 두어 갱신할 수 없다 - 재분석하면 기존 발행본이 영구히 고아가 된다.

사용법(worker/ 에서):
    python scripts/upload_local_data.py --dry-run
    python scripts/upload_local_data.py
"""
```

`collect_uploads`는 `ALLOWED_BUCKETS` 3종 디렉터리만 `rglob`하고, 키는 `f"{bucket}/{rel.as_posix()}"`로 만든다. `upload_all`은 `skip_existing`이면 `storage.download(key) is not None`으로 건너뛴다. `main()`은 `load_config(Path(".env"))` → `SupabaseRest` → `SupabaseStorage`로 실 저장소에 올리고 한국어 요약을 출력한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd worker && python -m pytest -q`
Expected: 전량 PASS

- [ ] **Step 5: `docs/DEPLOY.md`를 쓴다**

**코드로 준비된 것**(이 계획이 만든 산출물)과 **사용자가 직접 해야 하는 것**을 절 단위로 분리한다.

```markdown
# 클라우드 배포 절차

## 0. 코드로 준비된 것 (추가 작업 없음)
- `supabase/migrations/005_storage_buckets.sql` - 버킷 3종 + RLS
- 저장소 루트 `Dockerfile` - 워커 이미지(Chromium·Noto Sans KR 포함)
- 워커 `STORAGE_BACKEND=supabase` 기본값(Dockerfile ENV)
- 대시보드 Storage 서빙·업로드 경로

## 1. Supabase (사용자 수행)
1. SQL Editor에서 `005_storage_buckets.sql` 실행
2. Storage 화면에서 raw-scans·artifacts·reports 버킷 3개 생성 확인
   (정책 생성이 42501로 실패하면 백로그 티켓 42대로 Storage > Policies UI에서 수동 생성)

## 2. Railway - 워커 (사용자 수행)
1. New Project > Deploy from GitHub repo > 이 저장소 선택
2. Settings > Build: Dockerfile 감지 확인(Root Directory는 저장소 루트 그대로)
3. Variables에 아래를 입력한다. **service_role 키는 워커에만 넣는다**
   | 키 | 값 |
   |---|---|
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 |
   | `STORAGE_BACKEND` | `supabase` |
   | `WORKER_ID` | `railway-1` |
   | `POLL_INTERVAL_S` | `3` |
4. Deploy 후 Logs에서 `[flatworker] 시작: worker_id=railway-1` 확인

## 3. Vercel - 대시보드 (사용자 수행)
1. Add New Project > 이 저장소 Import
2. **Root Directory를 `dashboard`로 지정**(이걸 빠뜨리면 빌드가 실패한다)
3. Environment Variables
   | 키 | 값 |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon(public) 키 |
   | `NEXT_PUBLIC_MAX_UPLOAD_BYTES` | `52428800` (Pro 승급 시 상향) |
   4. Deploy 후 Supabase > Authentication > URL Configuration에 Vercel 도메인 추가

## 4. 기존 데이터 이관 (사용자 수행, 선택)
`worker/`에서 `.env`에 `STORAGE_BACKEND=supabase`를 넣고:
    python scripts/upload_local_data.py --dry-run
    python scripts/upload_local_data.py

## 5. 배포 후 스모크 (필수)
1. 로그인 → 스캔 업로드 → 사전 검사 → 단위 확정 → 분석 완료까지 진행
2. 결과 화면에서 히트맵 이미지와 결과표(cells.json fetch)가 뜨는지 확인
3. 보고서 생성 → PDF 미리보기에서 **한글이 네모 상자가 아닌지 확인**
4. 50MB 초과 파일을 올려 한국어 안내가 뜨는지 확인
```

- [ ] **Step 6: 기존 문서를 갱신한다**

- `docs/SUPABASE_SETUP.md`: §2 마이그레이션 목록에 005 추가, §3 검증에 버킷 3종 확인 쿼리(`select id, file_size_limit from storage.buckets;`) 추가, §6 경로 규약 절에 "규약 문자열은 그대로이고 실체가 Storage 객체로 바뀌었다"는 한 문단 추가, 말미에 `docs/DEPLOY.md` 링크.
- `docs/service-report.md` §3.3 데이터 흐름: "로컬 data/raw-scans/ 저장" → "Supabase Storage raw-scans 버킷 저장", ④의 "로컬 data/artifacts/" → "artifacts 버킷".
- `docs/service-report.md` §3.5 운영 비용: 표를 배포 구성으로 교체한다.

| 항목 | 배포 구성 | 비용 |
|---|---|---|
| Supabase | Free (DB·Auth·Realtime·Storage 1GB) | $0 |
| 대시보드 | Vercel Hobby (Next.js) | $0 |
| 워커 | Railway Hobby (Docker 상주 프로세스) | 월 $5 |
| 파일 저장 | Supabase Storage (파일당 50MB·총 1GB) | $0 |

  본문도 "데모 단계 총 0원" → "월 $5"로 고치고, 용량이 부족해지면 Supabase Pro($25) 승급으로 파일당 50GB·총 100GB가 된다는 확장 경로를 남긴다.
- `docs/service-report.md` §6.6: 티켓 37(컨테이너 한글 폰트)을 **해소됨**으로 표시하고 근거로 `Dockerfile`의 `fonts-noto-cjk`를 적는다. 티켓 43도 같은 근거로 해소 표시한다.
- `dashboard/README.md`·`worker/README.md`: `DATA_DIR` 설명에 "`STORAGE_BACKEND=local`일 때만 쓰인다"는 단서 추가, 배포는 `docs/DEPLOY.md`로 안내. 대시보드 README에서 `DATA_DIR` 환경변수 항목을 삭제하고 `NEXT_PUBLIC_MAX_UPLOAD_BYTES`를 추가한다.
- `dashboard/.env.example`: `DATA_DIR` 줄 삭제, `NEXT_PUBLIC_MAX_UPLOAD_BYTES=52428800` 추가.

- [ ] **Step 7: 전체 스위트를 돌려 회귀가 없는지 확인한다**

Run:
```bash
cd engine && python -m pytest -q
cd ../worker && python -m pytest -q
cd ../dashboard && npm test
```
Expected: engine 139 / worker 73+신규 / dashboard 127+신규 전부 PASS. **출력을 눈으로 확인한 뒤에만 완료를 보고한다.**

- [ ] **Step 8: 커밋**

```bash
git add worker/scripts docs dashboard/README.md dashboard/.env.example worker/README.md worker/tests
git commit -m "docs,ops: 클라우드 배포 절차·기존 데이터 이관 스크립트·운영 비용 갱신"
```

---

## 사용자가 직접 해야 하는 작업 (코드로 대신할 수 없음)

1. Supabase SQL Editor에서 `005_storage_buckets.sql` 실행, 버킷 3종 생성 확인(정책 42501 실패 시 UI 수동 생성)
2. Railway: GitHub 저장소 연결, 환경변수 5개 입력, Deploy
3. Vercel: 저장소 Import, **Root Directory를 `dashboard`로 지정**, 환경변수 3개 입력, Deploy
4. Supabase Authentication > URL Configuration에 Vercel 도메인 추가
5. `python scripts/upload_local_data.py`로 기존 17MB 이관(선택)
6. 배포 후 스모크: 업로드 → 분석 → 보고서 PDF 한글 육안 확인, 50MB 초과 안내 확인
7. 저장소 공개 전환 전 `git log -p`로 키 노출 여부 최종 확인

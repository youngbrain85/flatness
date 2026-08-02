"""산출물 경로 규약(스펙 §6.3)과 스테이징 디렉터리.

경로 규약 문자열(`raw-scans/{site_id}/{scan_id}/`, `artifacts/{analysis_id}/`)은 DB
저장값 그대로이고, 실제 파일은 Storage에 있다. 엔진은 로컬 `Path`에만 쓸 수 있으므로
잡 처리 동안만 임시 디렉터리를 쓰고 끝나면 지운다.
"""
import tempfile
from contextlib import contextmanager
from pathlib import Path


def raw_scan_dir(data_dir, site_id, scan_id) -> Path:
    """`data_dir` 아래 로컬 스캔 디렉터리 경로를 계산한다.

    잡 핸들러(jobs.py)는 더 이상 이 함수를 쓰지 않는다(스테이징+Storage 왕복으로
    전환됨) — 테스트가 LocalStorage와 동일한 물리 경로에 원본을 시드하는 데,
    그리고 이관 스크립트(worker/scripts/upload_local_data.py)가 로컬 레이아웃을
    계산하는 데 쓴다.
    """
    d = Path(data_dir) / "raw-scans" / str(site_id) / str(scan_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def artifacts_dir(data_dir, analysis_id) -> Path:
    """`data_dir` 아래 로컬 산출물 디렉터리 경로를 계산한다.

    잡 핸들러는 더 이상 이 함수를 쓰지 않는다 — 테스트(LocalStorage 루트가 같은
    `data_dir`이라 단언 경로가 그대로 성립)와 이관 스크립트가 쓴다.
    """
    d = Path(data_dir) / "artifacts" / str(analysis_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


@contextmanager
def staging_dir():
    """잡 처리 동안만 쓰는 임시 디렉터리(Path)를 만들고 끝나면 통째로 지운다."""
    with tempfile.TemporaryDirectory(prefix="flatworker-") as d:
        yield Path(d)

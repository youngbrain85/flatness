"""로컬 산출물 경로 규약 (스펙 §6.3) — 데모 단계는 Storage 대신 로컬 data/ 디렉터리.

경로 규약(불변 ID만 사용): `raw-scans/{site_id}/{scan_id}/`, `artifacts/{analysis_id}/`.
정식 배포 시 동일 경로 규약으로 버킷으로 이전 예정(spec §6.3).
"""
from pathlib import Path


def raw_scan_dir(data_dir, site_id, scan_id) -> Path:
    d = Path(data_dir) / "raw-scans" / str(site_id) / str(scan_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def artifacts_dir(data_dir, analysis_id) -> Path:
    d = Path(data_dir) / "artifacts" / str(analysis_id)
    d.mkdir(parents=True, exist_ok=True)
    return d

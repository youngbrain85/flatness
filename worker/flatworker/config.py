"""워커 설정 로드 — .env → 환경변수 순으로 읽고 필수값을 검증한다."""
from dataclasses import dataclass
from pathlib import Path
import os

from dotenv import dotenv_values

# .env.example과 동일한 키 이름 (Task 7 산출물과 합을 맞춘다)
_KEY_URL = "SUPABASE_URL"
_KEY_SERVICE_ROLE_KEY = "SUPABASE_SERVICE_ROLE_KEY"
_KEY_DATA_DIR = "DATA_DIR"
_KEY_POLL_INTERVAL_S = "POLL_INTERVAL_S"
_KEY_WORKER_ID = "WORKER_ID"
_KEY_STORAGE_BACKEND = "STORAGE_BACKEND"

_REQUIRED = (_KEY_URL, _KEY_SERVICE_ROLE_KEY)

_DEFAULT_DATA_DIR = "../data"
_DEFAULT_POLL_INTERVAL_S = 3.0
_DEFAULT_WORKER_ID = "local-1"
_DEFAULT_STORAGE_BACKEND = "local"   # 배포(Railway)에서만 supabase로 올린다
_VALID_BACKENDS = ("local", "supabase")


class ConfigError(Exception):
    """필수 설정값 부재 등 설정 로드 실패."""


@dataclass
class Config:
    supabase_url: str
    service_role_key: str
    data_dir: Path
    poll_interval_s: float
    worker_id: str
    # 기본값 "local"을 둔 이유: 이미 곳곳에 흩어진 기존 테스트가 Config(...)를 이
    # 필드 없이 직접 구성한다 - 필수 필드로 만들면 그 생성부를 전부 고쳐야 하는데,
    # 클라우드 배포와 무관한 회귀 위험만 늘어난다.
    storage_backend: str = _DEFAULT_STORAGE_BACKEND


def load_config(env_path=None) -> Config:
    """`.env` 파일(있으면) → 프로세스 환경변수 순으로 값을 병합해 Config를 만든다.

    같은 키가 둘 다에 있으면 `.env` 파일 값이 우선한다(명시적으로 지정한 파일이
    프로세스 환경변수보다 구체적인 설정이라는 원칙).
    """
    file_values = {}
    if env_path is not None:
        env_path = Path(env_path)
        if env_path.exists():
            file_values = {k: v for k, v in dotenv_values(env_path).items() if v is not None}

    def _get(key, default=None):
        if key in file_values:
            return file_values[key]
        return os.environ.get(key, default)

    missing = [k for k in _REQUIRED if not _get(k)]
    if missing:
        raise ConfigError(f"필수 설정값 누락: {', '.join(missing)}")

    poll_raw = _get(_KEY_POLL_INTERVAL_S, str(_DEFAULT_POLL_INTERVAL_S))
    try:
        poll_interval_s = float(poll_raw)
    except (TypeError, ValueError) as e:
        raise ConfigError(f"{_KEY_POLL_INTERVAL_S} 값이 숫자가 아닙니다: {poll_raw!r}") from e

    storage_backend_raw = _get(_KEY_STORAGE_BACKEND, _DEFAULT_STORAGE_BACKEND)
    storage_backend = storage_backend_raw.strip().lower()
    if storage_backend not in _VALID_BACKENDS:
        raise ConfigError(
            f"{_KEY_STORAGE_BACKEND}는 local 또는 supabase여야 합니다: {storage_backend_raw!r}")

    return Config(
        supabase_url=_get(_KEY_URL),
        service_role_key=_get(_KEY_SERVICE_ROLE_KEY),
        data_dir=Path(_get(_KEY_DATA_DIR, _DEFAULT_DATA_DIR)),
        poll_interval_s=poll_interval_s,
        worker_id=_get(_KEY_WORKER_ID, _DEFAULT_WORKER_ID),
        storage_backend=storage_backend,
    )

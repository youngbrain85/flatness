import pytest
from flatworker.config import load_config, ConfigError


def test_load_from_env_file(tmp_path):
    (tmp_path / ".env").write_text(
        "SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n"
        f"DATA_DIR={tmp_path / 'data'}\n", encoding="utf-8")
    cfg = load_config(tmp_path / ".env")
    assert cfg.supabase_url == "https://x.supabase.co"
    assert cfg.poll_interval_s == 3.0
    assert cfg.data_dir.name == "data"


def test_missing_key_raises(tmp_path):
    (tmp_path / ".env").write_text("SUPABASE_URL=https://x.supabase.co\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="SUPABASE_SERVICE_ROLE_KEY"):
        load_config(tmp_path / ".env")


def test_storage_backend_default_is_local(tmp_path):
    (tmp_path / ".env").write_text(
        "SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n", encoding="utf-8")
    assert load_config(tmp_path / ".env").storage_backend == "local"


def test_storage_backend_normalizes_case(tmp_path):
    (tmp_path / ".env").write_text(
        "SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n"
        "STORAGE_BACKEND=SUPABASE\n", encoding="utf-8")
    assert load_config(tmp_path / ".env").storage_backend == "supabase"


def test_invalid_storage_backend_raises(tmp_path):
    (tmp_path / ".env").write_text(
        "SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n"
        "STORAGE_BACKEND=s3\n", encoding="utf-8")
    with pytest.raises(ConfigError):
        load_config(tmp_path / ".env")

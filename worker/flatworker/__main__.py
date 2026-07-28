"""워커 진입점: `python -m flatworker` — 설정 로드 -> SupabaseRest 연결 -> 폴링 루프."""
import sys
from pathlib import Path

from flatworker.config import ConfigError, load_config
from flatworker.db import SupabaseRest
from flatworker.runner import run_loop


def main():
    try:
        cfg = load_config(Path(".env"))
    except ConfigError as e:
        print(f"[flatworker] 설정 오류: {e}", file=sys.stderr)
        return 1

    print(f"[flatworker] 시작: worker_id={cfg.worker_id}, data_dir={cfg.data_dir}, "
          f"poll_interval={cfg.poll_interval_s}s")
    db = SupabaseRest(cfg)
    try:
        run_loop(db, cfg)
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

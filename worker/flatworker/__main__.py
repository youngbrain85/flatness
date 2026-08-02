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

    # data_dir은 storage_backend=local에서만 실제로 쓰인다(supabase 백엔드는 산출물을
    # Storage에 바로 올리므로 이 경로가 무의미하고, 컨테이너에는 애초에 존재하지도 않는다)
    # - 배포 로그를 보는 운영자가 엉뚱한 경로를 원인으로 의심하지 않도록 백엔드에 따라
    # 의미 있는 값만 출력한다.
    if cfg.storage_backend == "local":
        print(f"[flatworker] 시작: worker_id={cfg.worker_id}, storage_backend=local, "
              f"data_dir={cfg.data_dir}, poll_interval={cfg.poll_interval_s}s")
    else:
        print(f"[flatworker] 시작: worker_id={cfg.worker_id}, storage_backend={cfg.storage_backend}, "
              f"poll_interval={cfg.poll_interval_s}s")
    db = SupabaseRest(cfg)
    try:
        run_loop(db, cfg)
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

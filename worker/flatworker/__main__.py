"""워커 진입점: `python -m flatworker` — 설정 로드 -> SupabaseRest 연결 -> 폴링 루프.

`flatworker.runner`는 모듈 최상단에서 `flatworker.jobs`를 임포트하고, `jobs.py`는
`flatness.core.pipeline.analyze_floor/analyze_wall`을, `flatworker.slope`는
`flatness.core.pipeline.analyze_slope`를 각각 최상단에서 임포트한다(임포트 체인:
`__main__.py -> runner.py -> jobs.py -> flatness`). 배포 순서가 어긋나 엔진에
`analyze_slope`가 없는 채로 워커 코드만 새로 올라가면, 이 체인이 `main()` 함수 본문에
들어가기도 전에 `ImportError` 트레이스백만 남기고 죽는다 — 그래서는 운영자가 "배포
순서가 틀렸다"는 사실을 알 수 없다. 아래 `main()`은 `flatworker.runner`의 임포트를
함수 안으로 미뤄 이 경우를 붙잡는다(Task 5, 태스크 브리프 "컨트롤러 정정 2" 참고).
"""
import sys
from pathlib import Path

from flatworker.config import ConfigError, load_config
from flatworker.db import SupabaseRest


def main(_import_run_loop=None):
    try:
        cfg = load_config(Path(".env"))
    except ConfigError as e:
        print(f"[flatworker] 설정 오류: {e}", file=sys.stderr)
        return 1

    # 지연 임포트: `_import_run_loop`는 테스트 이음매다(기본값은 실제
    # flatworker.runner.run_loop를 불러오는 클로저). 엔진에 analyze_slope가 없으면
    # 아래 호출에서 ImportError가 발생하는데, 이 임포트를 모듈 최상단에 두면 main()에
    # 들어오기도 전에 트레이스백만 남기고 죽어 버린다(위 모듈 docstring 참고).
    if _import_run_loop is None:
        def _import_run_loop():
            from flatworker.runner import run_loop
            return run_loop

    try:
        run_loop = _import_run_loop()
    except ImportError as e:
        print(f"[flatworker] 엔진 모듈을 불러올 수 없습니다: {e}", file=sys.stderr)
        print("[flatworker] 엔진(engine/)을 워커보다 먼저 배포해야 합니다. "
              "`pip install -e engine`으로 최신 엔진이 설치됐는지 확인하세요.",
              file=sys.stderr)
        return 1

    # ENGINE_VERSION은 flatness 패키지 __init__.py 한 줄이 전부라 analyze_slope
    # 유무와 무관하게 항상 안전하게 임포트된다(위에서 run_loop 임포트가 이미
    # 성공했으므로 이 시점에는 어차피 엔진 전체가 온전한 상태이기도 하다).
    from flatness import ENGINE_VERSION

    # data_dir은 storage_backend=local에서만 실제로 쓰인다(supabase 백엔드는 산출물을
    # Storage에 바로 올리므로 이 경로가 무의미하고, 컨테이너에는 애초에 존재하지도 않는다)
    # - 배포 로그를 보는 운영자가 엉뚱한 경로를 원인으로 의심하지 않도록 백엔드에 따라
    # 의미 있는 값만 출력한다. 기존 로그 형식은 그대로 유지하고 engine_version=만 덧붙인다
    # (Railway 배포 검증이 이 문자열로 기동을 확인한 이력이 있다).
    if cfg.storage_backend == "local":
        print(f"[flatworker] 시작: worker_id={cfg.worker_id}, storage_backend=local, "
              f"data_dir={cfg.data_dir}, poll_interval={cfg.poll_interval_s}s, "
              f"engine_version={ENGINE_VERSION}")
    else:
        print(f"[flatworker] 시작: worker_id={cfg.worker_id}, storage_backend={cfg.storage_backend}, "
              f"poll_interval={cfg.poll_interval_s}s, engine_version={ENGINE_VERSION}")
    db = SupabaseRest(cfg)
    try:
        run_loop(db, cfg)
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

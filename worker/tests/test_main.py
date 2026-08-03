"""워커 진입점(`flatworker.__main__.main`) 검증 - 기동 로그·엔진 능력 가드.

컨트롤러 정정(태스크 5 브리프 "컨트롤러 정정" 절): 기동 로그는 `runner.py`가 아니라
`__main__.py`에 있고, `storage_backend`에 따라 local/supabase 두 갈래로 갈린다. 또한
import 체인이 `__main__.py -> flatworker.runner -> flatworker.jobs -> flatness 엔진
(analyze_floor/analyze_wall) 및 flatworker.slope -> flatness.core.pipeline.analyze_slope`로
이어지므로, 엔진에 `analyze_slope`가 없으면 `main()` 함수 본문에 들어가기도 전에
모듈 최상단 import가 실패해 트레이스백만 남긴다. `main()`은 이 import를 함수 안으로
지연시켜 ImportError를 잡고, `_import_run_loop` 테스트 이음매로 성공/실패 양쪽을 모두
흉내낼 수 있게 한다 - 진짜 ImportError를 재현하려면 sys.modules 조작이 필요해
취약하므로, 주입 가능한 콜러블로 대체해 결정론적으로 검증한다(브리프 "테스트 방향" 절).
"""
from flatworker.__main__ import main


def _write_env(tmp_path, extra=""):
    (tmp_path / ".env").write_text(
        "SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n" + extra,
        encoding="utf-8")


def _noop_run_loop(db, cfg):
    """run_loop 스텁 - 폴링 루프를 실제로 돌리지 않고 즉시 반환한다(기동 로그만 검증)."""


def test_main_prints_engine_version_local_backend(monkeypatch, tmp_path, capsys):
    monkeypatch.chdir(tmp_path)
    _write_env(tmp_path)
    code = main(_import_run_loop=lambda: _noop_run_loop)
    out = capsys.readouterr().out
    assert code == 0
    assert "[flatworker] 시작:" in out
    assert "storage_backend=local" in out
    assert "data_dir=" in out
    assert "engine_version=" in out


def test_main_prints_engine_version_supabase_backend(monkeypatch, tmp_path, capsys):
    monkeypatch.chdir(tmp_path)
    _write_env(tmp_path, extra="STORAGE_BACKEND=supabase\n")
    code = main(_import_run_loop=lambda: _noop_run_loop)
    out = capsys.readouterr().out
    assert code == 0
    assert "storage_backend=supabase" in out
    assert "engine_version=" in out
    # 기존 동작 유지: supabase 백엔드는 data_dir를 출력하지 않는다
    assert "data_dir=" not in out


def test_main_reports_missing_slope_support_clearly(monkeypatch, tmp_path, capsys):
    """엔진이 구배를 모르면(analyze_slope 부재) 기동 시 사람이 읽을 수 있는 한국어
    메시지를 남기고 종료 코드 1을 반환한다. ImportError 트레이스백만 뜨면 배포
    순서가 틀렸다는 사실이 운영자에게 드러나지 않는다."""
    monkeypatch.chdir(tmp_path)
    _write_env(tmp_path)

    def _boom():
        raise ImportError("cannot import name 'analyze_slope' from 'flatness.core.pipeline'")

    code = main(_import_run_loop=_boom)
    err = capsys.readouterr().err
    assert code == 1
    assert "엔진" in err
    assert "먼저 배포" in err
    assert "—" not in err  # U+2014(—) 금지 - 운영자가 읽는 사용자 대면 문자열


def test_main_preserves_config_error_handling(monkeypatch, tmp_path, capsys):
    """기존 ConfigError 처리(코드 1, stderr 안내) 동작이 그대로 유지되는지 확인.
    엔진 import 가드를 추가하기 전 경로(설정 검증)의 회귀를 막는다."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    (tmp_path / ".env").write_text("SUPABASE_URL=https://x.supabase.co\n", encoding="utf-8")
    code = main()
    err = capsys.readouterr().err
    assert code == 1
    assert "설정 오류" in err

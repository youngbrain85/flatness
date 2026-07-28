import subprocess, sys, json, os
from tests.fixtures.synthetic import flat_floor, write_binary_ply

def _run(*args):
    # 자식 파이썬의 stdout을 UTF-8로 고정하고 부모도 UTF-8로 디코드 —
    # PYTHONIOENCODING이 어떤 값이어도 결과가 동일하도록(환경 의존 제거)
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    return subprocess.run([sys.executable, "-m", "flatness.cli", *args],
                          capture_output=True, text=True, encoding="utf-8", env=env)

def test_units_required_exit_2(tmp_path):
    write_binary_ply(flat_floor(size=(6.0, 6.0), spacing=0.02), tmp_path / "s.ply")
    r = _run("analyze", str(tmp_path / "s.ply"), "--out", str(tmp_path / "out"))
    assert r.returncode == 2
    assert "단위" in r.stdout  # 감지 결과·근거 출력 후 확정 요구

def test_analyze_success_exit_0(tmp_path):
    # spacing=0.05는 기본 subcell_m(0.05)과 일치해 서브셀당 점 1개뿐인 저밀도가 되고
    # min_points=3(서브셀)·min_area_m2=1.0(구역) 문턱을 만족하는 구역이 형성되지 않는다.
    # 실제 스캔 밀도를 대표하는 0.02로 조정(P1b 다중 구역 파이프라인과 호환).
    write_binary_ply(flat_floor(size=(6.0, 6.0), spacing=0.02), tmp_path / "s.ply")
    r = _run("analyze", str(tmp_path / "s.ply"), "--out", str(tmp_path / "out"),
             "--units", "m")
    assert r.returncode == 0, r.stderr
    stats = json.loads((tmp_path / "out" / "stats.json").read_text("utf-8"))
    assert stats["applied_criteria"]["name"] == "floor-kcs-exposed"  # 기본 기준

def test_list_criteria(tmp_path):
    r = _run("list-criteria")
    assert r.returncode == 0 and "floor-kcs-exposed" in r.stdout

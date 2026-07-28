import subprocess, sys, json
from tests.fixtures.synthetic import flat_floor, write_binary_ply

def _run(*args):
    return subprocess.run([sys.executable, "-m", "flatness.cli", *args],
                          capture_output=True, text=True)

def test_units_required_exit_2(tmp_path):
    write_binary_ply(flat_floor(size=(6.0, 6.0), spacing=0.05), tmp_path / "s.ply")
    r = _run("analyze", str(tmp_path / "s.ply"), "--out", str(tmp_path / "out"))
    assert r.returncode == 2
    assert "단위" in r.stdout  # 감지 결과·근거 출력 후 확정 요구

def test_analyze_success_exit_0(tmp_path):
    write_binary_ply(flat_floor(size=(6.0, 6.0), spacing=0.05), tmp_path / "s.ply")
    r = _run("analyze", str(tmp_path / "s.ply"), "--out", str(tmp_path / "out"),
             "--units", "m")
    assert r.returncode == 0, r.stderr
    stats = json.loads((tmp_path / "out" / "stats.json").read_text("utf-8"))
    assert stats["applied_criteria"]["name"] == "floor-kcs-exposed"  # 기본 기준

def test_list_criteria(tmp_path):
    r = _run("list-criteria")
    assert r.returncode == 0 and "floor-kcs-exposed" in r.stdout

import subprocess, sys, json, os
import numpy as np
from tests.fixtures.synthetic import flat_floor, flat_wall, write_binary_ply

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

def test_wall_criteria_cli(tmp_path):
    from tests.fixtures.synthetic import flat_wall
    pts = np.vstack([flat_floor(size=(4.0, 3.0), spacing=0.02),
                     flat_wall(length=4.0, height=2.4, spacing=0.02, y0=0.0)])
    write_binary_ply(pts, tmp_path / "room.ply")
    r = _run("analyze", str(tmp_path / "room.ply"), "--out", str(tmp_path / "out"),
             "--units", "m", "--criteria", "wall-kcs-tilt-other")
    assert r.returncode == 0, r.stderr
    assert "벽" in r.stdout

def test_plumbness_criteria_rejected(tmp_path):
    write_binary_ply(flat_floor(size=(2.0, 2.0), spacing=0.02), tmp_path / "s.ply")
    r = _run("analyze", str(tmp_path / "s.ply"), "--out", str(tmp_path / "out"),
             "--units", "m", "--criteria", "wall-kcs-plumb")
    assert r.returncode == 1
    assert "자동 병행" in r.stdout

def test_analyze_slope_cli_end_to_end(tmp_path):
    """합성 2% 경사면을 CLI로 돌려 산출물과 요약이 나오는지 본다."""
    import json
    from tests.fixtures.synthetic import flat_floor, write_binary_ply
    from flatness.cli import main

    ply = tmp_path / "slope.ply"
    write_binary_ply(flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.0)), str(ply))
    crit = tmp_path / "crit.json"
    crit.write_text(json.dumps(
        {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}),
        encoding="utf-8")
    out = tmp_path / "out"

    rc = main(["analyze-slope", str(ply), "--units", "m",
               "--criteria", str(crit), "--out", str(out)])
    assert rc == 0

    stats = json.loads((out / "slope_stats.json").read_text(encoding="utf-8"))
    assert abs(stats["summary"]["max_dev_pct"]) < 0.1
    assert stats["summary"]["counts"]["적합"] > 0
    assert (out / "slope_map.png").exists()
    assert (out / "slope_cells.csv").exists()
    # --drain을 안 줬으므로 방향은 판정하지 않았다는 사실이 stats에 명시돼야 한다
    # (티켓: coverage_pct 100%만 보고 "방향까지 다 봤다"고 오해하면 안 된다).
    assert stats["direction_judged"] is False
    assert stats["drain_points"] is None
    assert any("배수구" in w for w in stats["warnings"])


def test_analyze_slope_wiring_produces_cells_json_and_intact_csv(tmp_path):
    """analyze_slope의 실제 배선을 끝까지 확인한다(Task 1 리뷰 I2).

    outputs/slope_cells.py 단위 테스트는 dump_slope_cells/load_slope_cells를
    직접 불러 격리 검증할 뿐 analyze_slope를 한 번도 부르지 않는다 - 그래서
    다음 배선 결함을 하나도 못 잡는다(리뷰 실측: 전부 172 passed로 통과):
      - analyze_slope에서 dump_slope_cells 호출을 통째로 삭제
      - stats["artifacts"]에서 cells_json 키 제거
      - slope_cells.csv의 width_m/height_m을 열 끝이 아니라 맨 앞에 추가
      - slope_cells.csv를 utf-8-sig가 아니라 utf-8로 저장(BOM 소실)
    이 테스트는 CLI(main)를 통해 analyze_slope를 실제로 실행해 산출물 4종의
    존재·형태를 직접 확인한다.
    """
    import json
    from tests.fixtures.synthetic import flat_floor, write_binary_ply
    from flatness.cli import main

    ply = tmp_path / "slope.ply"
    write_binary_ply(flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.0)), str(ply))
    crit = tmp_path / "crit.json"
    crit.write_text(json.dumps(
        {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}),
        encoding="utf-8")
    out = tmp_path / "out"

    rc = main(["analyze-slope", str(ply), "--units", "m",
               "--criteria", str(crit), "--out", str(out)])
    assert rc == 0

    # 1) 재판정 입력 파일이 실제로 만들어졌는가(dump_slope_cells 호출이 살아있는가)
    cells_json_path = out / "slope_cells.json"
    assert cells_json_path.exists()
    cells_payload = json.loads(cells_json_path.read_text(encoding="utf-8"))
    assert cells_payload["cell_m"] == 2.0          # CLI 기본 --cell과 일치(I1)
    assert cells_payload["subcell_m"] == 0.05
    assert len(cells_payload["cells"]) > 0

    # 2) stats.artifacts가 그 파일을 가리키는가
    stats = json.loads((out / "slope_stats.json").read_text(encoding="utf-8"))
    assert "cells_json" in stats["artifacts"]

    # 2-1) 판정 결과 전용 산출물(slope_judged.json)도 함께 나왔는가(2차 리뷰 대응)
    assert "judged_json" in stats["artifacts"]
    judged_json_path = out / "slope_judged.json"
    assert judged_json_path.exists()
    judged_payload = json.loads(judged_json_path.read_text(encoding="utf-8"))
    assert len(judged_payload["cells"]) == len(cells_payload["cells"])
    judged_ids = {(row["cx"], row["cy"]) for row in judged_payload["cells"]}
    cells_ids = {(row["cx"], row["cy"]) for row in cells_payload["cells"]}
    assert judged_ids == cells_ids   # 두 산출물이 (cx, cy) 키로 정확히 짝지어진다
    assert stats["artifacts"]["cells_json"] == str(cells_json_path)

    # 3) CSV 헤더가 16열 정확한 순서로 살아있는가(BOM·기존 열 순서 보존, D1/Step5)
    csv_bytes = (out / "slope_cells.csv").read_bytes()
    assert csv_bytes.startswith(b"\xef\xbb\xbf"), "BOM(utf-8-sig)이 없다"
    header = csv_bytes.decode("utf-8-sig").splitlines()[0].split(",")
    assert header == ["cx", "cy", "center_x_m", "center_y_m", "n_subcells",
                      "slope_pct", "downhill_deg", "dev_pct", "dir_err_deg",
                      "correction_mm", "rmse_mm", "se_pct", "grade", "reason",
                      "width_m", "height_m"]


def test_analyze_slope_with_drain_records_direction_judged(tmp_path):
    """--drain을 주면 stats에 direction_judged=True와 좌표가 남아야 한다."""
    import json
    from tests.fixtures.synthetic import flat_floor, write_binary_ply
    from flatness.cli import main

    ply = tmp_path / "slope.ply"
    write_binary_ply(flat_floor(size=(8.0, 8.0), spacing=0.02, tilt=(0.02, 0.0)), str(ply))
    crit = tmp_path / "crit.json"
    crit.write_text(json.dumps(
        {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}),
        encoding="utf-8")
    out = tmp_path / "out"

    rc = main(["analyze-slope", str(ply), "--units", "m",
               "--criteria", str(crit), "--out", str(out), "--drain=-10,4"])
    assert rc == 0

    stats = json.loads((out / "slope_stats.json").read_text(encoding="utf-8"))
    assert stats["direction_judged"] is True
    assert stats["drain_points"] == [[-10.0, 4.0]]
    assert not any("배수구" in w for w in stats["warnings"])


def test_analyze_slope_all_na_produces_valid_json_and_cli_does_not_crash(tmp_path):
    """전 셀 판정불가(바닥이 cell_m보다 작아 조각 셀 하나뿐)여도 slope_stats.json이
    표준 JSON을 벗어나거나 CLI가 죽으면 안 된다(중요 2: nan 대신 None, CLI는 N/A로 출력)."""
    import json
    from tests.fixtures.synthetic import flat_floor, write_binary_ply
    from flatness.cli import main

    ply = tmp_path / "tiny.ply"
    write_binary_ply(flat_floor(size=(0.5, 0.5), spacing=0.02, tilt=(0.02, 0.0)), str(ply))
    crit = tmp_path / "crit.json"
    crit.write_text(json.dumps(
        {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}),
        encoding="utf-8")
    out = tmp_path / "out"

    rc = main(["analyze-slope", str(ply), "--units", "m",
               "--criteria", str(crit), "--out", str(out)])
    assert rc == 0  # None 포맷팅이 안 됐으면 여기서 TypeError로 죽는다

    raw = (out / "slope_stats.json").read_text(encoding="utf-8")
    assert "NaN" not in raw               # RFC 8259 위반 토큰이 없어야 한다
    stats = json.loads(raw)               # 표준 json 파서로 파싱 가능해야 한다
    assert stats["summary"]["mean_dev_pct"] is None
    assert stats["summary"]["max_dev_pct"] is None
    assert stats["summary"]["coverage_pct"] == 0.0


def test_analyze_slope_refuses_to_guess_units(tmp_path, capsys):
    """단위 자동 확정 금지(스펙 5.1.1). --units 없으면 후보만 보여주고 exit 2."""
    import json
    from tests.fixtures.synthetic import flat_floor, write_binary_ply
    from flatness.cli import main

    ply = tmp_path / "s.ply"
    write_binary_ply(flat_floor(size=(8.0, 8.0), spacing=0.05, tilt=(0.02, 0.0)), str(ply))
    crit = tmp_path / "c.json"
    crit.write_text(json.dumps(
        {"design_pct": 2.0, "pass_pct": 0.5, "re_pct": 1.5, "dir_pass_deg": 30.0}),
        encoding="utf-8")

    rc = main(["analyze-slope", str(ply), "--criteria", str(crit),
               "--out", str(tmp_path / "o")])
    assert rc == 2
    assert "--units" in capsys.readouterr().out

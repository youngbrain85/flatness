# -*- coding: utf-8 -*-
"""Task 9: 세대 기하 → Gazebo SDF world 변환 테스트 (설치 무관 부분).

계획 Task 9 의 검증 조건:
  (a) 산출 SDF 가 유효 XML 이다 (ElementTree 파싱)
  (b) 모델 수 = 실(outline 있는 space) 수 + 가구 수 + 로봇 1 (+ 바닥 평면 1)
  (c) 좌표가 mm→m 로 변환된다 — 표본(PD 실 첫 벽 세그먼트)으로 확인
  (d) 로봇에 diff_drive + odometry publisher 플러그인이 있고
      섀시 반경 = ScanConfig.robot_radius_mm (mm→m)
Gazebo 실행 검증(-s 헤드리스 200스텝)은 WSL 의 micromamba gz 환경이 있을
때만 돈다 (skipif) — 스펙 §7-3 의 실행 대조는 validate.py 가 담당한다.
"""
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scansim.config import ScanConfig  # noqa: E402
from scansim.gazebo.export_sdf import export_sdf  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
DUMP = REPO / "bim" / "tests" / "fixtures" / "lh26_dump.json"
FURN = Path(__file__).parent / "fixtures" / "furniture_lh26.json"

# WSL 호출 공통 접두 — micromamba env gz (README: 설치 경위)
_WSL = ["wsl.exe", "-d", "Ubuntu-24.04", "--", "bash", "-lc"]
_MAMBA = "export MAMBA_ROOT_PREFIX=~/micromamba; ~/.local/bin/micromamba run -n gz "


def _wsl_gz_available() -> bool:
    """WSL 의 gz sim 이 실행 가능한가 — 아니면 실행 테스트는 skip."""
    if sys.platform != "win32":
        return False
    try:
        r = subprocess.run(
            _WSL + [_MAMBA + "gz sim --version"],
            capture_output=True, timeout=60)
        return r.returncode == 0 and b"10." in r.stdout
    except Exception:
        return False


_GZ_OK = _wsl_gz_available()


@pytest.fixture(scope="module")
def dump():
    return json.loads(DUMP.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def furniture():
    return json.loads(FURN.read_text(encoding="utf-8"))["furniture"]


@pytest.fixture()
def world(dump, furniture, tmp_path):
    out = export_sdf(dump, furniture, tmp_path / "lh26_world.sdf")
    return out


def test_exports_valid_xml(world):
    """(a) 산출물이 유효 XML 이고 루트가 <sdf><world> 다."""
    tree = ET.parse(world)
    root = tree.getroot()
    assert root.tag == "sdf"
    assert root.find("world") is not None


def test_model_count(world, dump, furniture):
    """(b) 모델 수 = 실 수 + 가구 수 + 로봇 1 + 바닥 1. 접두사별로도 센다."""
    n_space = sum(1 for sp in dump["spaces"] if sp.get("outline"))
    n_furn = len(furniture)
    models = ET.parse(world).getroot().find("world").findall("model")
    names = [m.get("name") for m in models]
    assert sum(1 for n in names if n.startswith("space_")) == n_space
    assert sum(1 for n in names if n.startswith("furn_")) == n_furn
    assert names.count("scanbot") == 1
    assert names.count("ground") == 1
    assert len(models) == n_space + n_furn + 2


def test_mm_to_m_sample(world, dump):
    """(c) mm→m 표본: PD 실 첫 변 (0,8970)→(1260,8970) 의 벽 박스.

    중점 (630, 8970)mm → pose (0.63, 8.97)m, 길이 1260mm → box x 1.26m.
    """
    w = ET.parse(world).getroot().find("world")
    pd = next(m for m in w.findall("model") if m.get("name").startswith("space_")
              and m.get("name").endswith("PD"))
    assert pd.find("static").text == "true"
    wall0 = next(l for l in pd.findall("link") if l.get("name") == "wall_0")
    pose = [float(v) for v in wall0.find("pose").text.split()]
    assert pose[0] == pytest.approx(0.63, abs=1e-9)
    assert pose[1] == pytest.approx(8.97, abs=1e-9)
    assert pose[5] == pytest.approx(0.0, abs=1e-9)  # yaw — +x 방향 변
    size = [float(v) for v in
            wall0.find("collision").find("geometry").find("box")
            .find("size").text.split()]
    assert size[0] == pytest.approx(1.26, abs=1e-9)


def test_robot_diff_drive_and_radius(dump, furniture, tmp_path):
    """(d) 로봇: diff_drive·odometry 플러그인 + 섀시 반경 = cfg.robot_radius_mm."""
    out = export_sdf(dump, furniture, tmp_path / "w.sdf",
                     robot_xy_mm=(2250.0, 3630.0))
    w = ET.parse(out).getroot().find("world")
    bot = next(m for m in w.findall("model") if m.get("name") == "scanbot")
    plugins = [p.get("filename") for p in bot.findall("plugin")]
    assert "gz-sim-diff-drive-system" in plugins
    assert "gz-sim-odometry-publisher-system" in plugins
    chassis = next(l for l in bot.findall("link") if l.get("name") == "chassis")
    radius = float(chassis.find("collision").find("geometry")
                   .find("cylinder").find("radius").text)
    assert radius == pytest.approx(ScanConfig().robot_radius_mm / 1000.0)
    pose = [float(v) for v in bot.find("pose").text.split()]
    assert pose[0] == pytest.approx(2.25)
    assert pose[1] == pytest.approx(3.63)


@pytest.mark.skipif(not _GZ_OK, reason="WSL micromamba gz 환경이 없다")
def test_gz_headless_loads(dump, furniture, tmp_path):
    """(실행) gz sim 헤드리스로 200 스텝 — world 가 물리 엔진에 로드된다."""
    out = export_sdf(dump, furniture, tmp_path / "run.sdf")
    drive, rest = str(out)[0].lower(), str(out)[2:].replace("\\", "/")
    wsl_path = f"/mnt/{drive}{rest}"
    r = subprocess.run(
        _WSL + [_MAMBA + f"gz sim -s -r --iterations 200 '{wsl_path}'"],
        capture_output=True, timeout=300)
    assert r.returncode == 0, r.stderr.decode(errors="replace")[-2000:]

# -*- coding: utf-8 -*-
"""세대 기하 → Gazebo SDF world 변환 (스펙 §7-3, 계획 Task 9).

입력 계약:
- dump: 세부과업 2 DB 덤프 (bim/tests/fixtures/lh26_dump.json) —
  spaces[].outline = 링 배열(첫 링 외곽, 이후 구멍), 좌표 도면 로컬 mm 정수.
- furniture: 가구 dict 목록 (scansim/tests/fixtures/furniture_lh26.json 의
  "furniture" 배열) — 각 {name, rings, ...}.

변환 규칙:
- 실 outline·가구 ring 의 각 변 → 얇은 box 벽 세그먼트(정적) 체인.
  박스 길이 = 변 길이 그대로 — 모서리 이음에 최대 두께/2(25mm) 쐐기 틈이
  남지만 로봇 반경(250mm)보다 훨씬 작아 통과 불가라 주행 검증에 무해하다.
- 인접한 실 outline 이 개구부(문)에서 변을 공유하면 그 변에도 벽이 생긴다 —
  즉 이 world 는 실 간 통행이 막혀 있다. 대조검증(운동학)은 한 실 안의
  경로로 수행한다 (scansim/gazebo/README.md 의 한계 절).
- 좌표 mm → m (÷1000). z: 벽 높이 0.5m, 바닥 평면 z=0.
- 로봇: 차동구동 — 섀시 원통(반경 = cfg.robot_radius_mm), 구동륜 2 + 캐스터
  구(전·후) + gz-sim-diff-drive-system / gz-sim-odometry-publisher-system.
- 물리: gz sim 기본 스텝 1ms. gz-sim 10 의 기본 물리 엔진은 DART(dartsim)다 —
  gz-physics 에 ODE 백엔드가 없어 SDF <physics type> 은 무시된다 (README).
"""
from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from pathlib import Path

from scansim.config import ScanConfig

MM = 1e-3            # mm → m
WALL_THICK_M = 0.05  # 벽 박스 두께
WALL_H_M = 0.5       # 벽 박스 높이 — 운동학 검증용이라 로봇을 막는 높이면 충분
MIN_SEG_MM = 1.0     # 이보다 짧은 변은 벽을 만들지 않는다 (퇴화 변)

# 로봇 기하(가정값 아님 — 검증용 모델 상수. 반경만 ScanConfig 를 따른다)
WHEEL_RADIUS_M = 0.1
WHEEL_SEP_M = 0.42
CHASSIS_H_M = 0.2
ODOM_HZ = 50.0
MODEL_NAME = "scanbot"


def _fmt(*vals) -> str:
    return " ".join(f"{v:.9g}" for v in vals)


def _sanitize(name: str) -> str:
    """SDF 모델명 안전 문자만 남긴다 — 한글 등은 떨어져 나간다(인덱스가 식별자)."""
    return "".join(ch for ch in name if ch.isascii() and (ch.isalnum() or ch == "_"))


def _ring_area_mm2(ring) -> float:
    """신발끈 공식 절대 면적 — 기본 로봇 위치(최대 실) 선정용."""
    s = 0.0
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return abs(s) * 0.5


def _wall_links(parent: ET.Element, rings, start_idx: int = 0) -> int:
    """닫힌 링들의 변마다 정적 벽 박스 링크를 붙인다. 반환 = 다음 링크 번호."""
    k = start_idx
    for ring in rings:
        n = len(ring)
        for i in range(n):
            x0, y0 = ring[i]
            x1, y1 = ring[(i + 1) % n]  # 닫는 변 포함 (링에 닫는 점 없음)
            seg = math.hypot(x1 - x0, y1 - y0)
            if seg < MIN_SEG_MM:
                continue
            link = ET.SubElement(parent, "link", name=f"wall_{k}")
            ET.SubElement(link, "pose").text = _fmt(
                (x0 + x1) * 0.5 * MM, (y0 + y1) * 0.5 * MM, WALL_H_M * 0.5,
                0.0, 0.0, math.atan2(y1 - y0, x1 - x0))
            size = _fmt(seg * MM, WALL_THICK_M, WALL_H_M)
            for tag in ("collision", "visual"):
                el = ET.SubElement(link, tag, name=tag)
                box = ET.SubElement(ET.SubElement(el, "geometry"), "box")
                ET.SubElement(box, "size").text = size
            k += 1
    return k


def _static_ring_model(world: ET.Element, name: str, rings) -> None:
    model = ET.SubElement(world, "model", name=name)
    ET.SubElement(model, "static").text = "true"
    _wall_links(model, rings)


def _ground(world: ET.Element) -> None:
    model = ET.SubElement(world, "model", name="ground")
    ET.SubElement(model, "static").text = "true"
    link = ET.SubElement(model, "link", name="link")
    for tag in ("collision", "visual"):
        el = ET.SubElement(link, tag, name=tag)
        plane = ET.SubElement(ET.SubElement(el, "geometry"), "plane")
        ET.SubElement(plane, "normal").text = "0 0 1"
        ET.SubElement(plane, "size").text = "100 100"


def _inertial(link: ET.Element, mass, ixx, iyy, izz) -> None:
    inertial = ET.SubElement(link, "inertial")
    ET.SubElement(inertial, "mass").text = _fmt(mass)
    inertia = ET.SubElement(inertial, "inertia")
    for tag, v in (("ixx", ixx), ("iyy", iyy), ("izz", izz)):
        ET.SubElement(inertia, tag).text = _fmt(v)
    for tag in ("ixy", "ixz", "iyz"):
        ET.SubElement(inertia, tag).text = "0"


def _cylinder_link(model, name, pose, radius, length, mass) -> ET.Element:
    link = ET.SubElement(model, "link", name=name)
    ET.SubElement(link, "pose").text = pose
    # 원통 관성 (축 = 로컬 z): ixx=iyy=m(3r²+h²)/12, izz=mr²/2
    ixx = mass * (3 * radius**2 + length**2) / 12.0
    _inertial(link, mass, ixx, ixx, mass * radius**2 / 2.0)
    for tag in ("collision", "visual"):
        el = ET.SubElement(link, tag, name=tag)
        cyl = ET.SubElement(ET.SubElement(el, "geometry"), "cylinder")
        ET.SubElement(cyl, "radius").text = _fmt(radius)
        ET.SubElement(cyl, "length").text = _fmt(length)
    return link


def _sphere_link(model, name, pose, radius, mass) -> ET.Element:
    link = ET.SubElement(model, "link", name=name)
    ET.SubElement(link, "pose").text = pose
    i = 0.4 * mass * radius**2
    _inertial(link, mass, i, i, i)
    for tag in ("collision", "visual"):
        el = ET.SubElement(link, tag, name=tag)
        sph = ET.SubElement(ET.SubElement(el, "geometry"), "sphere")
        ET.SubElement(sph, "radius").text = _fmt(radius)
    return link


def _joint(model, name, jtype, parent, child, axis_xyz=None) -> None:
    joint = ET.SubElement(model, "joint", name=name, type=jtype)
    ET.SubElement(joint, "parent").text = parent
    ET.SubElement(joint, "child").text = child
    if axis_xyz is not None:
        axis = ET.SubElement(joint, "axis")
        xyz = ET.SubElement(axis, "xyz")
        xyz.set("expressed_in", "__model__")
        xyz.text = axis_xyz


def _robot(world: ET.Element, cfg: ScanConfig, x_m, y_m, yaw_rad) -> None:
    r = cfg.robot_radius_mm * MM
    model = ET.SubElement(world, "model", name=MODEL_NAME)
    ET.SubElement(model, "pose").text = _fmt(x_m, y_m, 0.0, 0.0, 0.0, yaw_rad)

    # 섀시 바닥이 지면에서 50mm 뜨도록 — 바퀴 반경 100mm 축 위에 얹는다
    chassis_z = WHEEL_RADIUS_M + CHASSIS_H_M * 0.5 - 0.05
    _cylinder_link(model, "chassis", _fmt(0, 0, chassis_z, 0, 0, 0),
                   r, CHASSIS_H_M, 5.0)
    half_sep = WHEEL_SEP_M * 0.5
    for side, sy in (("left", half_sep), ("right", -half_sep)):
        _cylinder_link(model, f"{side}_wheel",
                       _fmt(0, sy, WHEEL_RADIUS_M, -math.pi / 2.0, 0, 0),
                       WHEEL_RADIUS_M, 0.04, 0.6)
        _joint(model, f"{side}_wheel_joint", "revolute",
               "chassis", f"{side}_wheel", "0 1 0")
    # 캐스터 구 전·후 — 볼 조인트라 자유 회전 (gz diff_drive 예제 패턴)
    for tag, cx in (("front", 0.18), ("back", -0.18)):
        _sphere_link(model, f"caster_{tag}", _fmt(cx, 0, 0.05, 0, 0, 0),
                     0.05, 0.25)
        _joint(model, f"caster_{tag}_joint", "ball", "chassis", f"caster_{tag}")

    dd = ET.SubElement(model, "plugin",
                       filename="gz-sim-diff-drive-system",
                       name="gz::sim::systems::DiffDrive")
    ET.SubElement(dd, "left_joint").text = "left_wheel_joint"
    ET.SubElement(dd, "right_joint").text = "right_wheel_joint"
    ET.SubElement(dd, "wheel_separation").text = _fmt(WHEEL_SEP_M)
    ET.SubElement(dd, "wheel_radius").text = _fmt(WHEEL_RADIUS_M)
    ET.SubElement(dd, "topic").text = f"/model/{MODEL_NAME}/cmd_vel"
    # 바퀴 적분 오돔은 별도 토픽으로 치운다 — 대조는 실제 포즈 오돔(/odom)으로
    ET.SubElement(dd, "odom_topic").text = f"/model/{MODEL_NAME}/wheel_odom"

    op = ET.SubElement(model, "plugin",
                       filename="gz-sim-odometry-publisher-system",
                       name="gz::sim::systems::OdometryPublisher")
    ET.SubElement(op, "odom_topic").text = f"/model/{MODEL_NAME}/odom"
    ET.SubElement(op, "odom_publish_frequency").text = _fmt(ODOM_HZ)
    ET.SubElement(op, "dimensions").text = "2"


def _default_robot_xy_mm(spaces) -> tuple:
    """기본 로봇 위치 = 최대 면적 실의 bbox 중심 (편의 기본값 — 가구와 겹칠 수
    있으므로 실제 검증 실행은 robot_xy_mm 을 명시해서 쓴다)."""
    best = max(spaces, key=lambda sp: _ring_area_mm2(sp["outline"][0]))
    xs = [p[0] for p in best["outline"][0]]
    ys = [p[1] for p in best["outline"][0]]
    return ((min(xs) + max(xs)) * 0.5, (min(ys) + max(ys)) * 0.5)


def export_sdf(dump: dict, furniture: list, out_path,
               cfg: ScanConfig | None = None,
               robot_xy_mm=None, robot_yaw_deg: float = 0.0) -> Path:
    """덤프 spaces + 가구 → SDF world 파일. 반환 = 출력 경로.

    robot_xy_mm: 로봇 초기 위치 (mm) — 생략 시 최대 실 bbox 중심.
    robot_yaw_deg: 초기 헤딩 (도, +x=0, 반시계).
    """
    cfg = cfg or ScanConfig()
    spaces = [sp for sp in dump["spaces"] if sp.get("outline")]

    root = ET.Element("sdf", version="1.8")
    world = ET.SubElement(root, "world", name="scan_world")
    physics = ET.SubElement(world, "physics", name="1ms", type="ignored")
    ET.SubElement(physics, "max_step_size").text = "0.001"
    ET.SubElement(physics, "real_time_factor").text = "1.0"
    for fname, pname in (
            ("gz-sim-physics-system", "gz::sim::systems::Physics"),
            ("gz-sim-user-commands-system", "gz::sim::systems::UserCommands"),
            ("gz-sim-scene-broadcaster-system",
             "gz::sim::systems::SceneBroadcaster")):
        ET.SubElement(world, "plugin", filename=fname, name=pname)

    _ground(world)
    for i, sp in enumerate(spaces):
        suffix = _sanitize(sp.get("name") or "")
        name = f"space_{i}" + (f"_{suffix}" if suffix else "")
        _static_ring_model(world, name, sp["outline"])
    for i, f in enumerate(furniture):
        suffix = _sanitize(f.get("name") or "")
        name = f"furn_{i}" + (f"_{suffix}" if suffix else "")
        _static_ring_model(world, name, f["rings"])

    x_mm, y_mm = robot_xy_mm if robot_xy_mm is not None \
        else _default_robot_xy_mm(spaces)
    _robot(world, cfg, x_mm * MM, y_mm * MM, math.radians(robot_yaw_deg))

    out_path = Path(out_path)
    ET.indent(root)
    ET.ElementTree(root).write(out_path, encoding="utf-8",
                               xml_declaration=True)
    return out_path

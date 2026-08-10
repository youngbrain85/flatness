# -*- coding: utf-8 -*-
"""Gazebo 대조검증 러너 (스펙 §7-3, 계획 Task 9).

WSL 의 micromamba gz env 안에서 실행한다 (README 참조):
  micromamba run -n gz python3 -m scansim.gazebo.validate \
      --waypoints wp.json --world world.sdf --out result.json

동작:
1. `gz sim -s -r <world>` 헤드리스 기동 (world 는 export_sdf 산출물 —
   로봇이 waypoints[0] 에 스폰돼 있어야 한다).
2. `gz topic -e --json-output` 스트림으로 odom(실제 포즈, ~50Hz)을 구독 —
   거리 적분·경유점 도달 판정(도달 반경 --arrive-mm, 기본 100mm)은 이
   스레드에서 한다. gz-transport 15 에 Python 바인딩이 없어 통신은 전부
   gz CLI 다 — 발행(`gz topic -p`)은 프로세스 1회당 ~1s 걸리므로 조향
   명령 주기도 ~1s 다 (판정 정밀도는 스트림이 보장한다).
3. P 제어: 목표 방향과의 헤딩 오차가 크면 제자리 회전, 작으면 전진+조향.
4. 완주 후 결과 JSON:
   {gz_dist_mm, gz_time_s(시뮬시간), own_dist_mm, own_time_s,
    dist_err_pct, time_err_pct, pass, notes, meta}
   - own 모델: 등속 하한 (거리 = 폴리라인 길이, 시간 = 거리/속도) —
     Task 6 simulate 와 같은 가정.
   - gz_time 은 "이동 시작(적분 거리 > 2mm)"부터 "마지막 경유점 도달"까지의
     시뮬 시간 — 명령 전달 지연은 빼고 운동학만 비교한다.
   - 판정: 거리·시간 모두 ±5% 이내면 pass. 초과하면 pass=false 로 보고하고
     허용치를 늘리지 않는다 (스펙 §7-3). 시간은 전제 차이(자체 모델은
     회전·가감속 미모형)로 어긋날 수 있다 — 그대로 보고하고 notes 에 남긴다.
     1차 판정 기준은 거리다.

--emit-loop 헬퍼: 빈 실 안의 라운딩 직사각 루프 경유점을 만든다 —
모서리를 호로 샘플링해 90° 급선회를 피한다 (도달 반경 100mm 로 경유점을
갈아탈 때 급코너일수록 경로가 접혀 거리 결손이 커지기 때문. 결손은
꼭짓점당 약 r·(1-cosθ), θ = 선회각).
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import threading
import time
from pathlib import Path

from scansim.config import ScanConfig

ARRIVE_MM_DEFAULT = 100.0   # 도달 반경 (계획 Task 9 지정값)
TOL_PCT = 5.0               # 허용 오차 — 늘리지 않는다 (스펙 §7-3)
ROTATE_THRESH_RAD = 0.79    # 이보다 크면 제자리 회전 (~45°)
KP_ANG = 0.8                # 헤딩 P 이득
MAX_W = 0.4                 # 각속도 상한 rad/s
STUCK_S = 45.0              # 이 시뮬 시간 동안 경유점 진전이 없으면 중단
# 제어 지연 보상: gz topic CLI 발행은 호출당 ~1s 걸리고 명령은 다음 발행까지
# 유지된다 — 오차를 "지금" 포즈로 계산하면 약 1~2s 묵은 명령이 되어
# 근접 목표 주위를 도는 궤도 발산이 난다 (1차 실행에서 실측: 거리 2배,
# 경유점 9 에서 45s 정체). odom 의 twist 로 지연만큼 포즈를 외삽한 뒤
# P 오차를 계산한다 — P 제어 구조(방향 회전 후 전진)는 그대로다.
PRED_S = 1.1                # 외삽 지평 ≈ 발행 지연 실측값


# ── 기하 ────────────────────────────────────────────────────


def polyline_len_mm(pts) -> float:
    return sum(math.hypot(x1 - x0, y1 - y0)
               for (x0, y0), (x1, y1) in zip(pts, pts[1:]))


def _norm_ang(a: float) -> float:
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


def rounded_rect_loop(x0, y0, x1, y1, fillet_mm=600.0, arc_step_deg=30.0):
    """모서리를 호로 라운딩한 직사각 루프 (mm, 반시계).

    (x0,y0)-(x1,y1) = 접선 직사각형. 시작·끝 = 남변 중점 (닫힌 루프).
    """
    r = float(fillet_mm)
    if (x1 - x0) < 2 * r or (y1 - y0) < 2 * r:
        raise ValueError("직사각형이 필렛 반경보다 작다")
    corners = [  # (호 중심, 시작각, 끝각) — 반시계
        ((x1 - r, y0 + r), -90.0, 0.0),    # SE
        ((x1 - r, y1 - r), 0.0, 90.0),     # NE
        ((x0 + r, y1 - r), 90.0, 180.0),   # NW
        ((x0 + r, y0 + r), 180.0, 270.0),  # SW
    ]
    pts = [((x0 + x1) * 0.5, y0)]  # 남변 중점에서 +x 방향으로 출발
    for (cx, cy), a0, a1 in corners:
        n = max(1, round((a1 - a0) / arc_step_deg))
        for k in range(n + 1):  # 접점 포함
            a = math.radians(a0 + (a1 - a0) * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    pts.append(pts[0])  # 루프 닫기
    # 연속 중복점 제거 (접점이 겹칠 수 있다)
    out = [pts[0]]
    for p in pts[1:]:
        if math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 1e-6:
            out.append(p)
    return out


# ── odom 스트림 구독 + 도달 판정 스레드 ─────────────────────


class OdomTracker(threading.Thread):
    """`gz topic -e --json-output` 스트림을 읽어 상태를 유지한다.

    - 프로토버프 JSON 은 0 값 필드를 생략한다 — 전 필드 .get(…, 0) 필수.
    - header.stamp.sec 은 문자열로 온다 (실측: {"sec":"7","nsec":…}).
    - 거리 적분·도달 판정을 이 스레드(~50Hz)에서 해야 ~1s 주기 제어
      루프의 성김과 무관하게 도달 반경 100mm 판정이 정확하다.
    """

    def __init__(self, topic: str, targets_mm, arrive_mm: float):
        super().__init__(daemon=True)
        self.topic = topic
        self.targets = list(targets_mm)   # odom 좌표계 mm (보정 후 설정)
        self.arrive = float(arrive_mm)
        self.lock = threading.Lock()
        self.pose = None                  # (x_mm, y_mm, yaw_rad)
        self.twist = (0.0, 0.0)           # (전진 mm/s, 각속도 rad/s) — 외삽용
        self.t_sim = None                 # 최신 시뮬 시간 s
        self.dist_mm = 0.0                # 적분 거리
        self.t_move = None                # 이동 시작(적분 > 2mm) 시뮬 시간
        self.idx = 0                      # 다음 목표 인덱스
        self.crossings = []               # [(t_sim, dist_mm)] 경유점 도달 기록
        self.calibrated = threading.Event()
        self.proc = None
        self.error = None

    def run(self):
        try:
            self.proc = subprocess.Popen(
                ["gz", "topic", "-e", "-t", self.topic, "--json-output"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            prev = None
            for line in self.proc.stdout:
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                stamp = msg.get("header", {}).get("stamp", {})
                t = float(stamp.get("sec", 0)) + float(stamp.get("nsec", 0)) * 1e-9
                pos = msg.get("pose", {}).get("position", {})
                q = msg.get("pose", {}).get("orientation", {})
                x = pos.get("x", 0.0) * 1000.0
                y = pos.get("y", 0.0) * 1000.0
                qx, qy = q.get("x", 0.0), q.get("y", 0.0)
                qz, qw = q.get("z", 0.0), q.get("w", 0.0) or 1.0
                yaw = math.atan2(2.0 * (qw * qz + qx * qy),
                                 1.0 - 2.0 * (qy * qy + qz * qz))
                tw = msg.get("twist", {})
                v_mm = tw.get("linear", {}).get("x", 0.0) * 1000.0
                w_rad = tw.get("angular", {}).get("z", 0.0)
                with self.lock:
                    self.t_sim = t
                    self.pose = (x, y, yaw)
                    self.twist = (v_mm, w_rad)
                    if prev is not None:
                        self.dist_mm += math.hypot(x - prev[0], y - prev[1])
                        if self.t_move is None and self.dist_mm > 2.0:
                            self.t_move = t
                    prev = (x, y)
                    self.calibrated.set()
                    if self.idx < len(self.targets):
                        tx, ty = self.targets[self.idx]
                        if math.hypot(tx - x, ty - y) <= self.arrive:
                            self.crossings.append((t, self.dist_mm))
                            self.idx += 1
        except Exception as e:  # 스트림 죽음 — 메인 루프가 감지한다
            self.error = e

    def snapshot(self):
        with self.lock:
            return (self.pose, self.t_sim, self.dist_mm, self.idx,
                    list(self.crossings), self.t_move, self.twist)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()


# ── 발행 (gz CLI — 호출당 ~1s) ──────────────────────────────


def _predict(pose, twist, horizon_s: float):
    """현재 twist 로 horizon 만큼 단륜(unicycle) 전방 외삽 — 지연 보상용."""
    x, y, yaw = pose
    v, w = twist
    n = 5
    dt = horizon_s / n
    for _ in range(n):
        x += v * dt * math.cos(yaw)
        y += v * dt * math.sin(yaw)
        yaw = _norm_ang(yaw + w * dt)
    return x, y, yaw


def pub_twist(topic: str, v_ms: float, w_rads: float) -> None:
    subprocess.run(
        ["gz", "topic", "-t", topic, "-m", "gz.msgs.Twist",
         "-p", f"linear: {{x: {v_ms:.4f}}}, angular: {{z: {w_rads:.4f}}}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def gz_version() -> str:
    try:
        r = subprocess.run(["gz", "sim", "--version"], capture_output=True,
                           text=True, timeout=30)
        return (r.stdout or "").strip().splitlines()[-1]
    except Exception:
        return "unknown"


# ── 메인 러너 ───────────────────────────────────────────────


def run_validation(waypoints_mm, world_path, out_path, model="scanbot",
                   speed_mms=None, arrive_mm=ARRIVE_MM_DEFAULT,
                   wall_timeout_s=420.0, extra_notes=()) -> dict:
    cfg = ScanConfig()
    speed = float(speed_mms if speed_mms is not None else cfg.mobile_speed_mms)
    own_dist = polyline_len_mm(waypoints_mm)
    own_time = own_dist / speed
    cmd_topic = f"/model/{model}/cmd_vel"
    odom_topic = f"/model/{model}/odom"
    notes = list(extra_notes)
    ok_run = False

    sim = subprocess.Popen(["gz", "sim", "-s", "-r", str(world_path)],
                           stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    tracker = OdomTracker(odom_topic, [], arrive_mm)
    try:
        tracker.start()
        if not tracker.calibrated.wait(timeout=90.0):
            raise RuntimeError("odom 스트림이 90s 안에 열리지 않았다 "
                               f"(topic={odom_topic})")
        pose0, _, _, _, _, _, _ = tracker.snapshot()
        # 보정: odom 좌표계 원점 기준 — 로봇은 waypoints[0] 에 스폰돼 있다.
        # (실측: odom 이 스폰 월드좌표를 그대로 보고하지만, 초기 포즈 기준
        #  구현으로 바뀌어도 이 보정으로 흡수된다)
        dx = pose0[0] - waypoints_mm[0][0]
        dy = pose0[1] - waypoints_mm[0][1]
        with tracker.lock:
            tracker.targets = [(x + dx, y + dy) for x, y in waypoints_mm[1:]]
        n_targets = len(waypoints_mm) - 1

        t_wall0 = time.monotonic()
        last_idx, last_progress_t = 0, None
        while True:
            pose, t_sim, dist, idx, crossings, t_move, twist = \
                tracker.snapshot()
            if idx >= n_targets:
                ok_run = True
                break
            if tracker.error is not None or tracker.proc.poll() is not None:
                notes.append(f"odom 스트림 중단: {tracker.error!r}")
                break
            if time.monotonic() - t_wall0 > wall_timeout_s:
                notes.append(f"벽시계 타임아웃 {wall_timeout_s:.0f}s — "
                             f"경유점 {idx}/{n_targets} 에서 중단")
                break
            if t_sim is not None:
                if idx != last_idx or last_progress_t is None:
                    last_idx, last_progress_t = idx, t_sim
                elif t_sim - last_progress_t > STUCK_S:
                    notes.append(f"경유점 {idx} 에서 {STUCK_S:.0f}s(시뮬) 동안 "
                                 "진전 없음 — 중단")
                    break
            # 지연 보상: 이 명령이 실제로 적용될 시점의 포즈로 오차를 계산
            x, y, yaw = _predict(pose, twist, PRED_S)
            with tracker.lock:
                j = tracker.idx
                targets = tracker.targets
            if j >= n_targets:
                ok_run = True
                break
            # 외삽 시점엔 다음 목표로 넘어가 있을 수 있다 — 외삽 포즈가
            # 현 목표의 도달 반경 안이면 다음 목표를 겨냥한다
            tx, ty = targets[j]
            if (math.hypot(tx - x, ty - y) <= arrive_mm
                    and j + 1 < n_targets):
                tx, ty = targets[j + 1]
            err = _norm_ang(math.atan2(ty - y, tx - x) - yaw)
            if abs(err) > ROTATE_THRESH_RAD:
                pub_twist(cmd_topic, 0.0, max(-MAX_W, min(MAX_W, KP_ANG * err)))
            else:
                pub_twist(cmd_topic, speed / 1000.0,
                          max(-MAX_W, min(MAX_W, KP_ANG * err)))
            # pub 자체가 ~1s 를 소모한다 — 별도 sleep 은 최소만
            time.sleep(0.02)
        pub_twist(cmd_topic, 0.0, 0.0)
    finally:
        tracker.stop()
        if sim.poll() is None:
            sim.terminate()
            try:
                sim.wait(timeout=15)
            except subprocess.TimeoutExpired:
                sim.kill()

    _, _, _, _, crossings, t_move, _ = tracker.snapshot()
    if ok_run and crossings and t_move is not None:
        t_end, dist_end = crossings[-1]
        gz_dist = dist_end
        gz_time = t_end - t_move
    else:
        gz_dist = tracker.dist_mm
        gz_time = ((tracker.t_sim or 0.0) - t_move) if t_move else 0.0
        ok_run = False
        notes.append("완주 실패 — 수치는 중단 시점까지의 값")

    dist_err = (gz_dist - own_dist) / own_dist * 100.0 if own_dist else 0.0
    time_err = (gz_time - own_time) / own_time * 100.0 if own_time else 0.0
    passed = ok_run and abs(dist_err) <= TOL_PCT and abs(time_err) <= TOL_PCT
    if abs(time_err) > TOL_PCT:
        notes.append(
            "time_err 이 ±5% 를 벗어났다: 자체 시뮬레이터는 등속 하한 모델"
            "(회전·가감속·명령 지연 미모형)이고 Gazebo 는 제자리 회전과 "
            "조향 감속을 물리로 겪는다 — 전제 차이로 시간이 늘어난 것이며 "
            "숨기지 않고 그대로 보고한다. 1차 판정 기준은 거리다.")
    if abs(dist_err) > TOL_PCT:
        notes.append("dist_err 이 ±5% 를 벗어났다 — 실패로 보고한다. "
                     "허용치는 늘리지 않는다 (스펙 §7-3).")

    result = {
        "gz_dist_mm": round(gz_dist, 1),
        "gz_time_s": round(gz_time, 3),
        "own_dist_mm": round(own_dist, 1),
        "own_time_s": round(own_time, 3),
        "dist_err_pct": round(dist_err, 2),
        "time_err_pct": round(time_err, 2),
        "pass": bool(passed),
        "notes": notes,
        "meta": {
            "gz_version": gz_version(),
            "world": str(world_path),
            "model": model,
            "speed_mms": speed,
            "arrive_mm": arrive_mm,
            "tolerance_pct": TOL_PCT,
            "n_waypoints": len(waypoints_mm),
            "waypoints_reached": tracker.idx,
            "waypoints_mm": [[round(x, 1), round(y, 1)]
                             for x, y in waypoints_mm],
            "gz_time_basis": "이동 시작(적분>2mm)~마지막 경유점 도달, 시뮬 시간",
        },
    }
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    return result


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m scansim.gazebo.validate",
        description="Gazebo 대조검증 — 같은 경유점 주행, 거리·시간 ±5% 판정")
    ap.add_argument("--waypoints", help="경유점 JSON "
                    "({'waypoints_mm': [[x,y],...]} 또는 배열 그대로)")
    ap.add_argument("--world", help="export_sdf 산출 SDF "
                    "(로봇이 waypoints[0] 에 스폰돼 있어야 한다)")
    ap.add_argument("--out", required=True, help="결과 JSON 경로")
    ap.add_argument("--model", default="scanbot")
    ap.add_argument("--speed-mms", type=float, default=None,
                    help="비교 속도 (기본 ScanConfig.mobile_speed_mms)")
    ap.add_argument("--arrive-mm", type=float, default=ARRIVE_MM_DEFAULT)
    ap.add_argument("--timeout-s", type=float, default=420.0)
    ap.add_argument("--note", action="append", default=[],
                    help="결과 notes 에 덧붙일 문구 (반복 가능)")
    ap.add_argument("--emit-loop", default=None, metavar="X0,Y0,X1,Y1",
                    help="라운딩 직사각 루프 경유점을 --out 에 쓰고 종료")
    ap.add_argument("--fillet-mm", type=float, default=600.0)
    ap.add_argument("--arc-step-deg", type=float, default=30.0)
    args = ap.parse_args(argv)

    if args.emit_loop:
        x0, y0, x1, y1 = (float(v) for v in args.emit_loop.split(","))
        pts = rounded_rect_loop(x0, y0, x1, y1, args.fillet_mm,
                                args.arc_step_deg)
        Path(args.out).write_text(
            json.dumps({"waypoints_mm": [[round(x, 1), round(y, 1)]
                                         for x, y in pts]}, indent=1),
            encoding="utf-8")
        print(f"경유점 {len(pts)}개 → {args.out} "
              f"(폴리라인 {polyline_len_mm(pts):.0f}mm)")
        return 0

    if not args.waypoints or not args.world:
        ap.error("--waypoints 와 --world 가 필요하다 (--emit-loop 제외)")
    data = json.loads(Path(args.waypoints).read_text(encoding="utf-8"))
    pts = data["waypoints_mm"] if isinstance(data, dict) else data
    pts = [(float(p[0]), float(p[1])) for p in pts]
    if len(pts) < 2:
        ap.error("경유점이 2개 이상 필요하다")

    result = run_validation(pts, args.world, args.out, model=args.model,
                            speed_mms=args.speed_mms,
                            arrive_mm=args.arrive_mm,
                            wall_timeout_s=args.timeout_s,
                            extra_notes=args.note)
    print(json.dumps({k: v for k, v in result.items() if k != "meta"},
                     ensure_ascii=False, indent=1))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

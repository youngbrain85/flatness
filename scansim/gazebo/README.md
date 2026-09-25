# Gazebo Cross-Validation (Task 3 · plan Task 9, design spec §7-3)

We convert the apartment unit's geometry into an SDF world and have a differential-drive robot drive the
same waypoints as the in-house simulator, **comparing travel distance and duration against a ±5% tolerance**.
If the comparison fails, we report it as a failure — we do not widen the tolerance.

## Installation Background (No sudo → micromamba)

We had no root privileges on WSL Ubuntu 24.04, so instead of the `sudo apt install` route we used a
user-level micromamba installation (option 1 in plan Task 9):

```bash
# micromamba is at ~/.local/bin/micromamba; the prefix is ~/micromamba
export MAMBA_ROOT_PREFIX=~/micromamba
micromamba create -n gz -c conda-forge gz-sim
```

**Versions actually installed: Gazebo Sim 10.5.0 (Ionic line), gz-transport 15, gz-physics 9.** Design
spec §7 says "Gazebo Harmonic", but the latest that conda-forge provides is 10.5 — because what is being
compared is kinematics (distance and time), the version difference does not affect the assessment. We
record the actual version in documents and results.

Two caveats:

- **gz-transport 15 has no Python bindings** (`import gz.transport15` does not work). All communication
  goes through the `gz topic` CLI. Publishing (`gz topic -p`) takes **about 1s** per process invocation
  (node creation + discovery) — this is why validate's control period is ~1s, and it is the basis for the
  "latency compensation" design below.
- **The physics engine is dartsim (DART).** gz-physics has no ODE backend (classic Gazebo's ODE was not
  ported), so the SDF `<physics type>` attribute is ignored and the default dartsim is loaded.
  Step size: 1ms.

## Components

| File | Role |
|---|---|
| `export_sdf.py` | Dump spaces + furniture → SDF world (wall chains, differential-drive robot) |
| `validate.py` | Headless gz sim launch → odom polling + cmd_vel P control → result JSON |
| `../tests/test_export_sdf.py` | XML validity, model count, mm→m, plugins (+ a load run when WSL is available) |
| `../tests/fixtures/gazebo_validation_result.json` | Actual run results (below) |

### export_sdf

- Each edge of a room outline or furniture ring → a static thin box wall (thickness 50mm, height 0.5m).
  Model count = number of rooms with an outline + number of furniture items + 1 robot + 1 ground plane.
- Coordinates mm→m. Robot: chassis cylinder radius = `ScanConfig.robot_radius_mm` (default 250mm),
  2 drive wheels + 2 caster spheres, `gz-sim-diff-drive-system` (`/model/scanbot/cmd_vel`) +
  `gz-sim-odometry-publisher-system` (`/model/scanbot/odom`, 50Hz, based on the actual pose — the
  wheel-integrated odometry is moved out of the way to `wheel_odom`).
- **Limitation: openings (doors) between rooms are closed off by walls.** This is because the walls are
  erected exactly along the outline edges. The comparison drive path must therefore stay within a
  single room.

### validate

```bash
# Inside WSL (with the micromamba env activated)
micromamba run -n gz python3 -m scansim.gazebo.validate \
    --waypoints wp.json --world world.sdf --out result.json
```

- The world must be built with `export_sdf(..., robot_xy_mm=wp0, robot_yaw_deg=…)` so that the robot
  spawns at `waypoints[0]`.
- The waypoint-arrival check (arrival radius 100mm) and the distance integration run in the 50Hz odom
  stream thread, so they are accurate regardless of the ~1s control period.
- **Latency compensation**: the pose at the moment the command will take effect (~1.1s later) is
  extrapolated from the odom twist, and the P error (turn toward the target direction, then drive forward)
  is computed from that pose. If it is computed from the "current" pose without compensation, the
  commands are 1–2s stale and make the trajectory diverge into orbits around a nearby target — this was
  measured in the first run (twice the distance, stalled at waypoint 9, pass=false).
- `--emit-loop x0,y0,x1,y1` helper: generates waypoints for a rectangular loop whose corners are rounded
  into arcs. Why sharp corners are avoided: when the robot switches to the next waypoint at the 100mm
  arrival radius, the path gets shorter by about `100mm×(1-cos turn angle)` per vertex — 4 sharp 90°
  corners produce a systematic distance deficit on the order of -400mm, which contaminates the ±5%
  assessment.

Caution: calling `wsl.exe -- bash -lc '<compound command>'` from Windows breaks, because the semicolons
and variables get re-interpreted by the outer shell. For compound runs, write a script file and call it
with `wsl.exe -d Ubuntu-24.04 -- bash <script>`.

## Actual Run Results (2026-08-10, Committed Fixture)

- Path: a rounded rectangular loop inside the living room/bedroom (empty-room scenario, world with no
  furniture placed) — 18 waypoints, a polyline of 11,366.9mm. Generated with:
  `--emit-loop 600,2170,3900,5090 --fillet-mm 600 --arc-step-deg 30`
- Comparison speed 150mm/s (applied identically to own and gz — neutral for the assessment)

| Item | In-house simulator | Gazebo 10.5.0 | Error |
|---|---|---|---|
| Travel distance | 11,366.9 mm | 11,374.6 mm | **+0.07 %** |
| Duration (simulated) | 75.78 s | 76.80 s | **+1.35 %** |

**pass = true (both within ±5%), 17/17 waypoints completed.**

Interpretation and assumptions:

- The own model is a constant-speed lower limit (turning and acceleration/deceleration are not modeled;
  the same assumption as plan Task 6 simulate). gz_time is the simulated time from "movement start
  (integrated distance >2mm)" to "last waypoint reached" — command-delivery latency is excluded, so only
  kinematics is compared.
- The time error of +1.35% is the result of slight meandering from steering (+) and corner cutting due to
  the arrival radius (-) canceling each other out. Had this been a path with sharp corners, time_err would
  be much larger because of the difference in assumptions (in-place rotation time) — even in that case, we
  do not hide it: it is reported and left recorded in notes. **Distance is the primary assessment
  criterion.**
- This is a partial-path verification, not a verification of the full mobile plan (about 185s) — the
  reasons are in the notes of the result JSON (the walled-off openings limitation + run time).

## Reproduction Steps (from the Windows Side)

```bash
# 1) Generate waypoints + world (Windows Python)
python -m scansim.gazebo.validate --emit-loop 600,2170,3900,5090 \
    --fillet-mm 600 --arc-step-deg 30 --out <dir>/loop_wp.json
python -c "import json; from scansim.gazebo.export_sdf import export_sdf; \
  export_sdf(json.load(open('bim/tests/fixtures/lh26_dump.json', encoding='utf-8')), \
  [], '<dir>/valid_world.sdf', robot_xy_mm=(2250.0, 2170.0))"
# 2) Run validate in WSL (via a script file — see the quoting trap above)
micromamba run -n gz python3 -m scansim.gazebo.validate \
    --waypoints <dir>/loop_wp.json --world <dir>/valid_world.sdf \
    --out scansim/tests/fixtures/gazebo_validation_result.json --speed-mms 150
```

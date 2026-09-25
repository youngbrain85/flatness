# Flatness — Robot-Friendly Environment Analysis System for Construction Sites

A sponsored research project for Hanbat National University. Starting from LiDAR point clouds and
architectural drawings, one repository carries out four tasks — **field measurement and analysis of
floor flatness and slope**, a **robot-friendly finish-material database linked to BIM**, and
**robot scan-coverage simulation**.

| Task | Scope | Status |
|---|---|---|
| **1** | Flatness analysis of vertical and horizontal surfaces + automatic PDF reports | Complete · deployed (Vercel + Railway + Supabase) |
| **2** | Robot-friendly finish-material database + BIM linkage (drawings → IFC) | Complete · merged into the database migrations |
| **3** | Robot work monitoring and simulation (scan coverage) | Complete · cross-validated in Gazebo |
| **4** | Automatic slope measurement and analysis from point clouds | Complete · deployed |

**652 tests** (engine 244 · worker 209 · bim 50 · scansim 149) + 209 worker integration tests ·
**all mutants killed across three mutation-testing families** (database 41 · drawing reconstruction 10 · assessment 11 · simulation 10) ·
cross-validation against Gazebo, an independent physics engine: **travel-distance error +0.07%**.

---

## Output Preview

### Task 2 — From Drawings to BIM

The available source material was not a BIM model but **sample drawings (PDFs issued by LH, the Korea Land and
Housing Corporation)**, so the model was built by reconstructing geometry from the drawings. Room boundaries are
isolated by line weight (1.42pt) and converted to polygons — the reconstructed areas match the area schedule
printed on the drawings to **within 0.003%**.

| Reconstructed plan + floor level by room | Step-height assessment by robot class |
|---|---|
| ![Reconstructed plan](docs/images/task2_plan_levels.png) | ![Robot assessment](docs/images/task2_robot_matrix.png) |

In the bathrooms the slab is dropped by 150mm, so **reading the thickness (THK) as a level inverts the direction
of the height difference** — the two drawings (partial detail drawing FL/SL ↔ finish schedule THK) cross-check each
other through `FL − SL = THK`. The assessment shows that **all four robot classes — commercial serving, delivery,
cleaning, and industrial AMR — are stopped by the 30mm step at the entrance** (every threshold is a
manufacturer-published specification; see the [source crosswalk](docs/robot-criteria-sources.md)).

![IFC round-trip verification](docs/images/task2_ifc.png)

A round-trip check exports the model to IFC4, then **reads the file back and triangulates it** — the floor area
matches the drawing's area schedule to within 0.0025%. Values absent from the drawings (effective clear width,
unlabeled ceiling heights) are not invented; they are left flagged as `unknown` or as nominal values.

### Task 3 — Scan-Coverage Simulation

The robot's job is LiDAR scanning — the planned path determines the point density of the point cloud, and that
point cloud becomes the analysis input for Tasks 1 and 4. The coverage criterion is **point density**, not area
(mobile ≤20mm / TLS ≤5mm).

| Mobile (captured while driving, 90° field of view) | TLS (optimized scan stations + tour) |
|---|---|
| ![Mobile coverage](docs/images/task3_mobile_coverage.gif) | ![TLS coverage](docs/images/task3_tls_coverage.gif) |

![Scan-station trade-off](docs/images/task3_tradeoff.png)

TLS scan stations are placed by greedy set cover, and the tour uses nearest neighbor + 2-opt. The same geometry
was converted to an SDF world and **the same waypoints were driven in Gazebo (an independent physics engine)** —
travel-distance error +0.07%.

### Tasks 1 and 4 — Field Analysis of Flatness and Slope (Deployed Pipeline)

Upload → analysis → assessment heatmap → PDF report runs in the web dashboard. The outputs below come from a
synthetic demo point cloud (no comparison against a physical straightedge was performed — see Chapter 6 of the
[report](docs/service-report.md)).

| Assessment heatmap (2m cells) | 3D preview | 10cm high-resolution deviation map |
|---|---|---|
| ![Heatmap](docs/images/task1_heatmap.png) | ![3D](docs/images/task1_preview3d.png) | ![Deviation map](docs/images/task1_deviation.png) |

---

## Repository Layout

```
engine/     Flatness and slope analysis engine (Python) — PLY/LAS/LAZ readers, RANSAC, straightedge envelope, slope
worker/     Job-processing worker — polls the Supabase job queue; Jinja2 → Chromium PDF reports
dashboard/  Web dashboard (Next.js) — upload, results, registration, reports
bim/        Drawing PDF → room-geometry reconstruction → IFC4 export + robot traversal assessment
scansim/    Scan-coverage planning (mobile and TLS), simulation, and Gazebo cross-validation
supabase/   14 migrations + verification gates (verification/)
docs/       Final project report (11 chapters), three assessment-criteria source crosswalks, data contracts, deployment procedure
```

Deployment: Vercel (dashboard) + Railway (worker, Docker) + Supabase (database, auth, storage).
For the procedure and caveats, see [docs/DEPLOY.md](docs/DEPLOY.md).

## Running

```bash
# Analysis engine (flatness) — after pip install -e engine/, it can also be run as `flatness`
python -m flatness.cli analyze data/demo/demo_floor.ply --out out/

# Drawings → IFC
python bim/to_ifc.py && python bim/verify_ifc.py

# Scan-coverage simulation (CSV, JSON, PNG, GIF and PDF in one run)
python -m scansim.cli --dump bim/tests/fixtures/lh26_dump.json --mode both --out out/

# Tests
cd engine && python -m pytest -q          # 244
cd worker && python -m pytest -q          # 209
python -m pytest bim/tests/ scansim/tests/ -q   # 199
```

## Verification Approach

This project's regression standard is not the number of assertions but **how many planted mutants were
killed** — after repeated incidents in which "the production code was correct, but the tests failed to catch the
very regression they were meant to prevent," an **unmutated control** was made mandatory for every mutation
experiment (without one, "all killed" is indistinguishable from a tool that has silently stopped working).

Verification that was not performed is not reported as performed: comparison against a physical straightedge,
comparison against physical drone and terrestrial scans, and physical robot traversal were **not performed**, and
the report states this explicitly. The one exception is drawing-reconstruction accuracy, which is checked not
against synthetic data but **against the area schedule printed on the drawings**.

## Documents

| Document | Contents |
|---|---|
| [service-report.md](docs/service-report.md) | Full final project report — Chapters 1–8 Task 1 / Chapter 9 Task 4 / Chapter 10 Task 2 / Chapter 11 Task 3 |
| [criteria-sources.md](docs/criteria-sources.md) | Source crosswalk of the 11 flatness assessment criteria against their original texts + integrity statement |
| [slope-criteria-sources.md](docs/slope-criteria-sources.md) | Source crosswalk of the slope assessment criteria |
| [robot-criteria-sources.md](docs/robot-criteria-sources.md) | 29-row source crosswalk of robot traversal thresholds |
| [contracts/finish-material-db.md](docs/contracts/finish-material-db.md) | Finish-material database tree (generated from the catalog) |
| [contracts/stats-schema.md](docs/contracts/stats-schema.md) | Data contract for analysis outputs |
| [scan-guideline.md](docs/scan-guideline.md) | Field scanning guideline |
| [DEPLOY.md](docs/DEPLOY.md) | Deployment procedure (including migration order and pitfalls) |

> The original statement of work and the sample drawing PDFs are not included in the repository (`data/` is gitignored).
> All drawing-related data in the repository is **derived geometry** (room polygons, levels, furniture coordinates).

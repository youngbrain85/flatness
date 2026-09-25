# P3 Dashboard (Flatness Analysis System)

## 1. Overview

This is a Next.js dashboard for uploading flatness scans of site floors and wall surfaces (mobile LiDAR point clouds)
and for viewing and reviewing the analysis results (heatmaps, assessments, statistics) processed by the local Python
worker (`worker/`). A logged-in user can register sites and measurement locations, upload scan files, watch the
progress status, check the grade distribution, worst points, and warnings on the results screen, and view the
assessment criteria (criteria) and measurement uncertainty (U) settings.

**Positioning**: this system is not an official inspection tool that makes final pass/fail determinations but a
"screening tool." Because the measurement error of mobile LiDAR can be of the same order of magnitude as the
specification tolerances or can exceed them, every analysis result includes the measurement uncertainty (U) and the
statement "These results are a screening and do not replace official inspection (physical straightedge and level
survey)." Any assessment of actual construction work must always be accompanied by official inspection.

## 2. Prerequisites

1. **Create a Supabase project + run migrations in the order 001 → 002 → 003 → 004 → 005 → 006 → 007** - for the
   procedure, follow [`../docs/SUPABASE_SETUP.md`](../docs/SUPABASE_SETUP.md) exactly (about 15 minutes from sign-up
   to issuing the API keys; 0 won within the Free tier). **Keeping this order and running 004 and 005 are mandatory** -
   if 004 is missing, the progress-status transitions of report jobs silently disappear without any error message, and
   if 005 is missing, there are no Storage buckets, so every upload fails (this dashboard does not use the local file
   system, so 005 is required even when running locally).
2. **Create a test account** - in the Supabase dashboard > **Authentication** > **Add user**, enter an email and
   password and check **Auto Confirm User** (this skips the email verification procedure and creates an account that
   can log in right away). This dashboard has no sign-up screen of its own - it provides only a login screen, so
   create accounts in advance on the Supabase side.
3. **Run the worker** - to actually analyze scans, the local Python worker must be running. For installation and run
   instructions, see [`../worker/README.md`](../worker/README.md). Without the worker, you can still get as far as
   logging in, registering sites, and uploading, but analysis stops at `Queued`.

## 3. Environment variables

Copy `.env.example` to create `.env.local` (`.env.local` is listed in `.gitignore`, so it is not
committed).

```
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (`https://<project-ref>.supabase.co`). Find it under Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon (public) key. Find it on the same screen. **Never put the service_role key here** (it bypasses RLS) |
| `NEXT_PUBLIC_MAX_UPLOAD_BYTES` | Upper limit on upload size (bytes). Default `52428800` (50MB) — the Supabase Free tier's per-file limit. It must be kept at the same value as the `file_size_limit` of the buckets in `005_storage_buckets.sql`. When upgrading to Pro, raise both together |

The dashboard does not use the local file system — original scans, outputs, and report PDFs are all downloaded through
Supabase Storage signed URLs (no `DATA_DIR` setting needed). For the cloud (Vercel) deployment procedure, see
[`../docs/DEPLOY.md`](../docs/DEPLOY.md).

## 4. Running

```
npm install
npm run dev     # http://localhost:3000
npm run test    # vitest
npm run build   # production build
```

## 5. Demo scenario (manual verification procedure)

1. **Log in** - at `/login`, log in with the test account created in Section 2. On first login, a
   `profiles` row is created automatically.
2. **New site** - on the home screen, create a site with "New site" (name, address, notes).
3. **Add a measurement location** - on the site detail screen, add a measurement location using building/floor/room information.
4. **Upload a scan** - create a synthetic PLY file with the command in Section 6 below, then upload it to that
   measurement location on the upload screen. Check that the upload form shows a list of candidate criteria and that
   the `is_default=true` criterion is selected by default.
5. **Confirm units** - if the status right after upload is `Awaiting unit confirmation`, select the unit (m/cm/mm) on
   the scan detail screen and confirm it. You must select m for the synthetic file from Section 6 (coordinates in
   meters) to be analyzed correctly.
6. **Analysis progress display** - if the worker is running, watch whether the status updates automatically as
   `Queued for analysis` -> `Analyzing` -> `Completed` (Realtime subscription).
7. **Results screen** - after the analysis completes, check the results screen (split into 3 panes: heatmap canvas ·
   assessment panel · results table), and click a heatmap cell to check that its details appear.
8. **Upload photos** - upload a photo to a site or a measurement location and check that it appears in the gallery.
9. **Check settings** - at `/settings`, check saving the profile name, the assessment criteria list and its active
   toggles, and the measurement uncertainty U value.
10. **Generate and publish a report**: site detail > the measurement location's "Reports" > "New report" > select the
    analyses to include (floor and wall surface can be combined) > check the title and overall comments >
    "Generate report" > when the progress status changes automatically from "Generating PDF" to "Generation complete",
    check the preview > "Download PDF" > "Publish"
    - After publishing, the title, comments, and PDF can no longer be modified (a DB trigger blocks this). If changes are needed, create a new report
    - If "Generation failed" appears, the reason is shown along with it (e.g., an incomplete analysis is included, or there is no cells.json).
      Fix the cause, then press "Regenerate PDF"

### 6. Generating a synthetic test file

Reuse the engine test fixture (`engine/tests/fixtures/synthetic.py`) to create a synthetic PLY of a 6x6m floor with a 10mm
depression. Run it from the **repository root**.

```bash
python -c "import importlib.util, pathlib; p = pathlib.Path('engine/tests/fixtures/synthetic.py'); spec = importlib.util.spec_from_file_location('syn', p); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); pts = m.add_bump(m.flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010); m.write_binary_ply(pts, pathlib.Path('demo_floor.ply')); print('demo_floor.ply created (6x6m, 10mm depression)')"
```

Use the generated `demo_floor.ply` in the upload step of Section 5 above.

## 7. Known demo limitations

The following were intentionally excluded from the scope of this demo (to be handled in P4/P5 or at the production stage).

- There is no report template customization, multilingual support, email delivery, or version management (replaced by making published versions immutable)
- Reports include only the photos attached to the scans of the included analyses (a photo uploader at the measurement-location level is in the backlog)
- Interactive 3D viewer (the engine does not yet output `viewer.bin`)
- Levelness (level) section (the `stats.json` contract does not yet have a related metric)
- Cross-section profile details when a heatmap cell is clicked (the engine does not output profiles)
- UI for creating new assessment criteria, revising criteria versions, and creating per-site overrides; user management; E2E (Playwright) automation
- When an analysis fails, the detailed reason is not shown on screen - check the worker logs.

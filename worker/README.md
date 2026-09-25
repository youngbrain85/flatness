# flatworker

This is the job-processing process of P2 (the local Python worker) in the flatness analysis system. It polls the
`jobs` queue in Supabase (Postgres + PostgREST), processes 4 job types (`precheck`/`analyze`/`import`/`report`), and
calls the `flatness` engine (`../engine`) to write the outputs. Where they are written depends on `STORAGE_BACKEND` —
with `local` (the default, for development and testing), to the local `DATA_DIR` (default `../data`), and with
`supabase` (production), to the 3 Supabase Storage buckets.
For the cloud (Railway) deployment procedure, see [`../docs/DEPLOY.md`](../docs/DEPLOY.md).

For the procedure for preparing the Supabase project itself (running the SQL migrations, issuing API keys, etc.),
see `../docs/SUPABASE_SETUP.md`. This document covers only how to run and test the worker and how it is structured.

## Installation

```
pip install -e ../engine
pip install -e .
```

`flatworker` depends on the `flatness` engine package at a local path (not published on PyPI) — both lines are
required. To run the tests, also install the dev dependencies (pytest).

```
pip install -e ".[dev]"
```

## Configuration

Copy `.env.example` to create `.env`, and fill in the values.

```
cp .env.example .env
```

For the list of keys and their default values, the comments in `.env.example` and `flatworker/config.py` are the
authoritative source. Only two values are required, `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; if the rest
(`DATA_DIR`/`POLL_INTERVAL_S`/`WORKER_ID`) are left blank, their default values apply.

## Running

Run it from the `worker/` directory (it reads `.env` as a path relative to the current directory).

```
cd worker
python -m flatworker
```

On a normal startup, the log line
`[flatworker] started: worker_id=..., storage_backend=..., poll_interval=...s, engine_version=...` is printed, and
the worker then polls the job queue. `data_dir=...` is printed along with it only when `STORAGE_BACKEND=local` (the
supabase backend does not use this path).
To stop it, press Ctrl+C (SIGINT) — it finishes the job currently being processed and stops right before the next
claim (it does not die with a job half-processed).

If the worker is started while the engine lacks `analyze_slope` (when the worker was deployed before the engine),
then instead of the log above, `[flatworker] Cannot load the engine module: ...` is printed and it dies with exit
code 1 - check that the latest engine has been installed with `pip install -e ../engine` into the same virtual
environment as this worker.

## Testing

```
cd worker
python -m pytest
```

All tests use only `FakeDB` (an in-memory `DBClient` implementation, `tests/fake_db.py`) — there are no network
calls to a real Supabase at all. `SupabaseRest` (`flatworker/db.py`) has no unit tests of its own and is verified
only by the setup smoke test in `docs/SUPABASE_SETUP.md`.

## Structure

```
flatworker/
  config.py    Loads settings (.env -> environment variables, in that order; validates required values)
  db.py        DBClient abstract interface + SupabaseRest(PostgREST/RPC) implementation
  jobs.py      4 job handlers: handle_precheck/handle_analyze/handle_import/handle_report
  runner.py    Polling loop: claim -> dispatch -> complete/fail
  artifacts.py Local output path conventions (raw-scans/, artifacts/)
  __main__.py  Entry point (python -m flatworker)

tests/
  fake_db.py           FakeDB — mimics the SQL identically, down to the side effects on jobs/analyses
  synthetic_helpers.py Helpers that reuse the engine test fixtures (engine/tests/fixtures/synthetic.py)
  test_config.py       Loading settings
  test_fake_db.py      FakeDB job-queue semantics (claim/complete/fail/retry)
  test_jobs.py         Job handlers (engine integration)
  test_runner.py       Polling loop (dispatch/exception handling)
  test_e2e_fake.py     Integration smoke test running from enqueue -> runner -> completion all the way to outputs
```

## PDF report jobs (P4)

Jobs of type `report` are registered by the dashboard with `fn_enqueue_job('report', {"report_id": "..."})`, and
the worker processes them in the following order:

1. Load `reports` + `report_analyses` + `analyses` + `scans` + `locations` + `sites` + `photos`
2. Copy the heatmaps, 3D previews and site photos to `data/reports/{report_id}/assets/` and generate the histograms
3. Assemble `reports.snapshot` (jsonb, `report-snapshot-v1`) - even if the original data changes or is deleted after
   publication, the same PDF is reproduced from this snapshot and the copied assets alone
4. Jinja2 HTML -> Playwright Chromium -> `data/reports/{report_id}/report.pdf`
5. Update `reports` with `pdf_path`, `snapshot` and `gen_status='done'`

### Additional installation

```bash
pip install -e ../engine && pip install -e .   # includes jinja2, matplotlib and playwright
python -m playwright install chromium           # only if the browser binary is missing
```

Windows development PCs often already have a Chromium cache (`~/AppData/Local/ms-playwright/`).
Run the `playwright install` above only if, after `pip install playwright`, rendering fails because of a version
mismatch.

### Korean fonts

The report template uses the fallback chain `'Noto Sans CJK KR', 'Noto Sans KR', 'Malgun Gothic', sans-serif`.
The actual font family name registered by the `fonts-noto-cjk` package in the Linux container is `Noto Sans CJK KR`,
so it was placed as the first candidate. Windows development PCs also have `Noto Sans KR` and Malgun Gothic
installed, so compatibility with them is maintained. If the container image lacks `fonts-noto-cjk`, Korean text
renders as square boxes, so verifying the build is mandatory.

### Testing

```bash
PYTHONPATH=../engine python -m pytest            # default (excludes launching a real browser)
PYTHONPATH=../engine python -m pytest -m browser # 1 smoke test rendering with real Chromium
```

## Running in a container

### Building the image

Build the image from the repository root. Both the `engine/` and `worker/` directories are required, so it must be
run from the root.

```bash
docker build -t flatworker:local .
```

Running `docker build . -f ../Dockerfile` inside the worker directory fails because the `engine/` directory cannot be
found.

### Running the container

When running the image, the following two environment variables are required:

```bash
docker run --rm \
  -e SUPABASE_URL="https://yourproject.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="your-key-here" \
  flatworker:local
```

The working directory is `/app/worker`, and the entrypoint is `python -m flatworker`. `STORAGE_BACKEND=supabase` is
already baked into the image, so there is no need to set it again.

Outputs are processed in a temporary directory inside the container and uploaded directly to Supabase Storage. No
outputs are left on the local disk. Check the results in the dashboard or in the Supabase Storage console.

### Verifying Korean fonts

After deployment, check that the Korean text in the PDF reports renders correctly. The `render_pdf` method takes
three arguments, `html`, `base_dir` and `out_path`:

```bash
docker run --rm -v "$PWD/tmp-pdf:/out" flatworker:local python -c "
from flatworker.report.renderer import PlaywrightRenderer
PlaywrightRenderer().render_pdf(
    \"<html><head><meta charset='utf-8'><style>body{font-family:'Noto Sans CJK KR','Noto Sans KR','Malgun Gothic',sans-serif}</style></head>\"
    \"<body><h1>Flatness Analysis Report</h1><p>Korean font check: &#xC7AC;&#xC2DC;&#xACF5;·&#xBCF4;&#xC218;·&#xACBD;&#xACC4;·&#xC801;&#xD569;</p></body></html>\",
    '/out', '/out/font-check.pdf')"
```

Open `tmp-pdf/font-check.pdf` and check the Korean grade labels (produced by the HTML character references in the
snippet): they must appear as real characters, not empty boxes. If they come out as square boxes, the installation
of the `fonts-noto-cjk` system package failed. Rebuild the image, or check the deployment environment.

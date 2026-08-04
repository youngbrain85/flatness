# flatworker

평활도 분석 시스템 P2(로컬 파이썬 워커)의 잡 처리 프로세스다. Supabase(Postgres + PostgREST)의
`jobs` 큐를 폴링하며 `precheck`/`analyze`/`import`/`report` 4종 잡을 처리하고, `flatness` 엔진(`../engine`)을
호출해 산출물을 쓴다. 쓰는 위치는 `STORAGE_BACKEND`에 따라 갈린다 — `local`(기본값, 개발·테스트)
이면 로컬 `DATA_DIR`(기본 `../data`)에, `supabase`(운영)이면 Supabase Storage 버킷 3종에 쓴다.
클라우드(Railway) 배포 절차는 [`../docs/DEPLOY.md`](../docs/DEPLOY.md) 참고.

Supabase 프로젝트 자체를 준비하는 절차(SQL 마이그레이션 실행, API 키 발급 등)는
`../docs/SUPABASE_SETUP.md`를 참고한다. 이 문서는 워커 실행·테스트·구조만 다룬다.

## 설치

```
pip install -e ../engine
pip install -e .
```

`flatworker`는 로컬 경로의 `flatness` 엔진 패키지에 의존한다(PyPI 미배포) — 두 줄 모두 필요하다.
테스트를 돌리려면 dev 의존성(pytest)도 설치한다.

```
pip install -e ".[dev]"
```

## 설정

`.env.example`을 복사해 `.env`를 만들고 값을 채운다.

```
cp .env.example .env
```

키 목록·기본값은 `.env.example` 주석과 `flatworker/config.py`가 정본이다. 필수값은
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` 두 개뿐이고, 나머지(`DATA_DIR`/`POLL_INTERVAL_S`/
`WORKER_ID`)는 비워두면 기본값이 적용된다.

## 실행

`worker/` 디렉터리에서 실행한다(`.env`를 현재 디렉터리 기준 상대경로로 읽는다).

```
cd worker
python -m flatworker
```

정상 기동 시 `[flatworker] 시작: worker_id=..., storage_backend=..., poll_interval=...s,
engine_version=...` 로그가 찍히고, 이후 잡 큐를 폴링한다. `data_dir=...`는
`STORAGE_BACKEND=local`일 때만 함께 찍힌다(supabase 백엔드는 이 경로를 쓰지 않는다).
종료는 Ctrl+C(SIGINT) — 처리 중인 잡을 끝까지 마친 뒤 다음 클레임 직전에 멈춘다(잡을
반쯤 처리한 상태로 죽지 않는다).

엔진에 `analyze_slope`가 없는 상태(엔진보다 워커를 먼저 배포한 경우)로 기동하면 위 로그
대신 `[flatworker] 엔진 모듈을 불러올 수 없습니다: ...`가 찍히고 종료 코드 1로 죽는다 -
`pip install -e ../engine`으로 최신 엔진이 이 워커와 같은 가상환경에 설치됐는지 확인한다.

## 테스트

```
cd worker
python -m pytest
```

전 테스트가 `FakeDB`(인메모리 `DBClient` 구현, `tests/fake_db.py`)만 사용한다 — 실 Supabase
네트워크 호출이 전혀 없다. `SupabaseRest`(`flatworker/db.py`)는 자체 단위 테스트가 없고,
`docs/SUPABASE_SETUP.md`의 셋업 스모크로만 검증한다.

## 구조

```
flatworker/
  config.py    설정 로드(.env -> 환경변수 순, 필수값 검증)
  db.py        DBClient 추상 인터페이스 + SupabaseRest(PostgREST/RPC) 구현
  jobs.py      잡 핸들러 4종: handle_precheck/handle_analyze/handle_import/handle_report
  runner.py    폴링 루프: claim -> dispatch -> complete/fail
  artifacts.py 로컬 산출물 경로 규약(raw-scans/, artifacts/)
  __main__.py  진입점(python -m flatworker)

tests/
  fake_db.py           FakeDB — jobs/analyses 부수효과까지 SQL과 동일하게 모사
  synthetic_helpers.py 엔진 테스트 픽스처(engine/tests/fixtures/synthetic.py) 재사용 헬퍼
  test_config.py       설정 로드
  test_fake_db.py       FakeDB 잡 큐 시맨틱(클레임/완료/실패/재시도)
  test_jobs.py          잡 핸들러(엔진 연동)
  test_runner.py        폴링 루프(디스패치/예외 처리)
  test_e2e_fake.py       엔큐 -> 러너 -> 완료 -> 산출물까지 이어지는 통합 스모크
```

## PDF 보고서 잡 (P4)

`report` 타입 잡은 대시보드가 `fn_enqueue_job('report', {"report_id": "..."})`로 등록하며,
워커가 다음 순서로 처리한다:

1. `reports` + `report_analyses` + `analyses` + `scans` + `locations` + `sites` + `photos` 로드
2. 히트맵·3D 프리뷰·현장 사진을 `data/reports/{report_id}/assets/`로 복사하고 히스토그램 생성
3. `reports.snapshot`(jsonb, `report-snapshot-v1`) 구성 - 발행 후 원본이 바뀌거나 삭제돼도
   이 스냅샷과 복사된 자산만으로 동일 PDF가 재현된다
4. Jinja2 HTML -> Playwright Chromium -> `data/reports/{report_id}/report.pdf`
5. `reports`를 `pdf_path`·`snapshot`·`gen_status='done'`으로 갱신

### 추가 설치

```bash
pip install -e ../engine && pip install -e .   # jinja2·matplotlib·playwright 포함
python -m playwright install chromium           # 브라우저 바이너리가 없을 때만
```

Windows 개발 PC에는 Chromium 캐시(`~/AppData/Local/ms-playwright/`)가 이미 있는 경우가 많다.
`pip install playwright` 후 렌더가 버전 불일치로 실패할 때만 위 `playwright install`을 실행한다.

### 한글 폰트

보고서 템플릿은 `'Noto Sans CJK KR', 'Noto Sans KR', 'Malgun Gothic', sans-serif` 폴백 체인을 쓴다.
리눅스 컨테이너의 `fonts-noto-cjk` 패키지가 등록하는 실제 폰트 패밀리명은 `Noto Sans CJK KR`이므로
첫 번째 후보로 배치했다. Windows 개발 PC에는 `Noto Sans KR`과 맑은 고딕도 설치돼 있어 호환성을 유지한다.
컨테이너 이미지에 `fonts-noto-cjk`가 없으면 한글이 네모 상자로 출력되므로 빌드 검증이 필수다.

### 테스트

```bash
PYTHONPATH=../engine python -m pytest            # 기본(실제 브라우저 실행 제외)
PYTHONPATH=../engine python -m pytest -m browser # 실제 Chromium 렌더 스모크 1건
```

## 컨테이너로 실행

### 이미지 빌드

저장소 루트에서 이미지를 빌드한다. `engine/` 및 `worker/` 디렉터리가 모두 필요하므로 반드시 루트에서 실행해야 한다.

```bash
docker build -t flatworker:local .
```

워커 디렉터리 내에서 `docker build . -f ../Dockerfile`을 실행하면 `engine/` 디렉터리를 찾을 수 없어 실패한다.

### 컨테이너 실행

이미지 실행 시 필수 환경변수는 다음 두 개다:

```bash
docker run --rm \
  -e SUPABASE_URL="https://yourproject.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="your-key-here" \
  flatworker:local
```

작업 디렉터리는 `/app/worker`이며, 엔트리포인트는 `python -m flatworker`다. `STORAGE_BACKEND=supabase`는
이미 이미지에 베이크돼 있으므로 재지정할 필요 없다.

산출물은 컨테이너 내부 임시 디렉터리에서 처리되며 Supabase Storage로 직접 업로드된다. 로컬 디스크에는
산출물이 남지 않는다. 결과물은 대시보드 또는 Supabase Storage 콘솔에서 확인한다.

### 한글 폰트 검증

배포 후 PDF 보고서의 한글이 정상인지 확인한다. `render_pdf` 메서드는 `html`, `base_dir`, `out_path` 세 인수를 받는다:

```bash
docker run --rm -v "$PWD/tmp-pdf:/out" flatworker:local python -c "
from flatworker.report.renderer import PlaywrightRenderer
PlaywrightRenderer().render_pdf(
    \"<html><head><meta charset='utf-8'><style>body{font-family:'Noto Sans CJK KR','Noto Sans KR','Malgun Gothic',sans-serif}</style></head>\"
    \"<body><h1>평활도 분석 보고서</h1><p>한글 폰트 확인: 재시공·보수·경계·적합</p></body></html>\",
    '/out', '/out/font-check.pdf')"
```

`tmp-pdf/font-check.pdf`를 열어서 한글이 정상 글자로 보이는지 확인한다. 한글이 네모 상자로 나오면 `fonts-noto-cjk` 시스템 패키지 설치가 실패한 것이다. 다시 빌드하거나 배포 환경을 점검한다.

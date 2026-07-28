# flatworker

평활도 분석 시스템 P2(로컬 파이썬 워커)의 잡 처리 프로세스다. Supabase(Postgres + PostgREST)의
`jobs` 큐를 폴링하며 `precheck`/`analyze`/`import` 3종 잡을 처리하고, `flatness` 엔진(`../engine`)을
호출해 산출물을 로컬 `DATA_DIR`(기본 `../data`)에 쓴다.

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

정상 기동 시 `[flatworker] 시작: worker_id=..., data_dir=..., poll_interval=...s` 로그가 찍히고,
이후 잡 큐를 폴링한다. 종료는 Ctrl+C(SIGINT) — 처리 중인 잡을 끝까지 마친 뒤 다음 클레임 직전에
멈춘다(잡을 반쯤 처리한 상태로 죽지 않는다).

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
  jobs.py      잡 핸들러 3종: handle_precheck/handle_analyze/handle_import
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

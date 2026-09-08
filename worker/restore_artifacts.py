"""로컬 data/ 에 남아 있는 산출물을 Supabase Storage로 되올린다(일회성 복구 도구).

배경: 2026-08-01 저장소를 로컬 디스크 -> Supabase Storage로 옮겼는데, 그 이전(7월 30일)
분석·보고서의 산출물 파일이 버킷에 올라가지 않아 대시보드가 404를 받는다. DB의 판정
수치는 멀쩡하고 히트맵 셀 데이터(cells.json)·구간별 결과표·보고서 PDF만 비어 보인다.

이 스크립트는 **덮어쓰기(x-upsert)** 로 올리기만 하고 무엇도 지우지 않는다. 이미 올라가
있는 키는 같은 내용으로 다시 써진다.

사용법(worker/ 에서):
    SUPABASE_URL=https://<프로젝트>.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=<service_role 키> \
    python restore_artifacts.py            # 먼저 --dry-run 없이 목록만 보고 싶으면 아래
    ... python restore_artifacts.py --dry-run

service_role 키는 Supabase 대시보드 > Project Settings > API 에 있다. 이 키는 RLS를
우회하므로 셸 기록·저장소에 남기지 않는다(환경변수로만 넘긴다).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from flatworker.config import load_config
from flatworker.db import DBError, SupabaseRest
from flatworker.storage import SupabaseStorage, content_type_for

# data/<버킷 이름>/... 구조 그대로 올린다(로컬 저장소 백엔드가 쓰던 배치와 동일).
BUCKETS = ("artifacts", "reports", "raw-scans")


def iter_files(data_dir: Path):
    """(스토리지 키, 로컬 경로) 쌍을 낸다. 키는 '<버킷>/<객체 경로>' 형식이다."""
    for bucket in BUCKETS:
        root = data_dir / bucket
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file():
                rel = path.relative_to(root).as_posix()
                yield f"{bucket}/{rel}", path


def _exists(storage, key: str) -> bool:
    """버킷에 객체가 있는지 본다.

    Storage REST는 없는 객체에 404가 아니라 **400 + 본문 NoSuchKey**를 돌려주는 경우가
    있어(실측), SupabaseStorage.download가 DBError를 던진다. 그 경우를 '없음'으로 읽는다.
    """
    try:
        return storage.download(key) is not None
    except DBError as e:
        if "NoSuchKey" in str(e) or "not_found" in str(e):
            return False
        raise


def main() -> int:
    ap = argparse.ArgumentParser(description="로컬 산출물을 Supabase Storage로 복구 업로드")
    ap.add_argument("--dry-run", action="store_true", help="올리지 않고 대상만 출력")
    ap.add_argument("--only", default="", help="키 부분 문자열 필터(예: 5942e42f)")
    ap.add_argument("--force", action="store_true",
                    help="이미 버킷에 있는 객체도 덮어쓴다(기본은 없는 것만 채운다)")
    ap.add_argument("--env", default=".env", help="설정 파일 경로(기본 worker/.env)")
    args = ap.parse_args()

    # 워커와 같은 규칙: .env 파일이 있으면 그 값이 프로세스 환경변수보다 우선한다.
    config = load_config(args.env)
    data_dir = Path(config.data_dir).resolve()
    if not data_dir.is_dir():
        print(f"데이터 디렉터리가 없습니다: {data_dir}", file=sys.stderr)
        return 2

    targets = [(k, p) for k, p in iter_files(data_dir) if args.only in k]
    if not targets:
        print(f"올릴 파일이 없습니다: {data_dir}")
        return 1

    total_mb = sum(p.stat().st_size for _, p in targets) / (1024 * 1024)
    print(f"대상 {len(targets)}개 · {total_mb:.1f}MB · 원본 {data_dir}")
    if args.dry_run:
        for key, path in targets:
            print(f"  [dry-run] {key}  ({path.stat().st_size:,}B)")
        return 0

    db = SupabaseRest(config)
    storage = SupabaseStorage(db)
    ok = 0
    skipped = 0
    try:
        for key, path in targets:
            # 기본 동작은 "빈 자리 채우기"다 - 버킷에 이미 있는 객체는 건드리지 않는다.
            # 로컬 사본이 더 오래된 경우(재분석·재생성 이후)를 덮어쓰지 않기 위해서다.
            if not args.force and _exists(storage, key):
                skipped += 1
                print(f"  건너뜀(이미 있음) {key}")
                continue
            data = path.read_bytes()
            storage.upload(key, data, content_type_for(key))
            ok += 1
            print(f"  올림 {key}  ({len(data):,}B)")
    finally:
        db.close()
    print(f"완료: 업로드 {ok}개 · 건너뜀 {skipped}개 · 대상 {len(targets)}개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

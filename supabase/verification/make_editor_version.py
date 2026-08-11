"""015 검증 게이트의 Supabase SQL Editor 판 생성기.

원본(015_finish_material_regression.sql)은 psql 전용이다 — `\\set`·`\\echo`·`\\pset`
메타명령 84줄을 쓰는데, SQL Editor 는 psql 이 아니라 서버에 SQL 을 그대로 보내므로
첫 `\\` 에서 42601 문법 오류가 난다 (2026-08-10 실제 적용에서 확인).

이 스크립트는 메타명령 줄을 걷어내고, 편집기가 마지막 문장의 결과만 그리드로 보여주는
특성에 맞춰 성공 요약 SELECT 를 끝에 붙인다. 단언 내용은 원본과 동일하다.

원본을 고치면 반드시 재생성한다:
    python supabase/verification/make_editor_version.py
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "015_finish_material_regression.sql"
DST = HERE / "015_supabase_editor.sql"

HEADER = """\
-- 015_supabase_editor.sql — 검증 게이트의 Supabase SQL Editor 판. (생성물 — 직접 고치지
-- 말 것. 원본 015_finish_material_regression.sql 을 고친 뒤 make_editor_version.py 로 재생성.)
--
-- 원본은 psql 전용 메타명령(\\set·\\echo·\\pset)을 쓰는데 SQL Editor 는 psql 이 아니라
-- 서버에 SQL 을 그대로 보내므로 42601 이 난다. 이 파일은 그 줄들을 걷어낸 순수 SQL 이며
-- 단언 내용은 원본과 동일하다.
--
-- 사용법: 전체를 붙여넣고 Run.
--   성공 → 마지막 결과 그리드에 verdict='PASS 38/38' 한 행
--   실패 → '★회귀 실패: ...' 예외로 중단 (어느 단언인지 메시지에 나온다)
-- 임시 테이블만 만들며 데이터를 바꾸지 않는다. 재실행 안전.
"""

FOOTER = """\

-- SQL Editor 는 마지막 문장의 결과만 그리드로 보여준다 — 성공하면 이 행이 보인다.
-- (위 DO 게이트가 실패를 전부 예외로 바꾸므로, 여기 도달했다는 것 자체가 전건 PASS 다.)
select 'PASS ' || count(*) || '/38' as verdict
  from _reg where verdict = 'PASS';
"""


def main() -> int:
    lines = SRC.read_text(encoding="utf-8").splitlines()
    body = [l for l in lines if not l.startswith("\\")]
    stripped = len(lines) - len(body)
    DST.write_text(HEADER + "\n" + "\n".join(body) + "\n" + FOOTER, encoding="utf-8")
    print(f"생성: {DST.name} (메타명령 {stripped}줄 제거, 본문 {len(body)}줄)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

-- 008: slope_judge 잡 타입 추가 (세부과업 4 단계 D)
--
-- ⚠ 이 파일에는 이 문장 하나만 둔다. PostgreSQL은 같은 트랜잭션 안에서 새 enum
--    값을 사용하는 것을 막는다(unsafe use of new value). Supabase SQL Editor가
--    파일 전체를 한 트랜잭션으로 실행하므로, 이 값을 쓰는 함수 확장은 009에 있다.
--    **008을 Run 한 뒤 009를 별도로 Run 해야 한다.**
alter type job_type add value if not exists 'slope_judge';

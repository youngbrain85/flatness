-- 011: register 잡 타입 + registered lineage (세부과업 4 단계 F)
--
-- ⚠ 이 파일에는 enum 추가 두 문장만 둔다. PostgreSQL은 같은 트랜잭션 안에서
--    새 enum 값을 *사용*하는 것을 막는다(unsafe use of new value). Supabase SQL
--    Editor가 파일 전체를 한 트랜잭션으로 실행하므로, 이 값들을 쓰는 테이블·함수는
--    012에 있다. **011을 Run 한 뒤 012를 별도로 Run 해야 한다.**
--    (두 문장이 함께 있는 것은 안전하다 - 서로를 사용하지 않는다.)
--
-- 재실행 안전(멱등) - add value if not exists.
alter type job_type add value if not exists 'register';
alter type data_lineage add value if not exists 'registered';

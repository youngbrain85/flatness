-- =============================================================================
-- 마이그레이션 003 - P3 대시보드 지원
-- 선행: 001_schema.sql, 002_functions_seed.sql
-- 내용: (1) photos 전용 private Storage 버킷 + RLS (스펙 §6.3: 데모에서 사진만
--        Supabase Storage, signed URL로 접근)
--       (2) Realtime publication에 scans·analyses 추가 (스펙 §3.2.⑤: 진행 상태를
--        Realtime으로 반영 - P2 확정: jobs는 클라이언트 완전 불가시이므로
--        analyses.status·scans.status 변화를 구독한다)
-- =============================================================================

-- (1) photos 버킷(private) - 파일당 10MB 제한(사진 용도, Free 한도 보호)
insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', false, 10485760)
on conflict (id) do nothing;

-- storage.objects RLS: 로그인 사용자는 photos 버킷만 읽기/쓰기 가능
create policy photos_all_auth on storage.objects for all to authenticated
  using (bucket_id = 'photos') with check (bucket_id = 'photos');

-- (2) Realtime publication (이미 추가된 경우 무시)
do $$ begin
  alter publication supabase_realtime add table public.scans;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.analyses;
exception when duplicate_object then null; end $$;

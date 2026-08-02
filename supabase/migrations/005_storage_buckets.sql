-- =============================================================================
-- 마이그레이션 005 - 클라우드 배포용 Storage 버킷
-- 선행: 001~004. 003의 photos 버킷과 동일한 방식(private + storage.objects RLS).
-- 파일당 상한 50MB는 Supabase Free 티어 한도에 맞춘 값이다. Pro 승급 시 이 값과
-- 대시보드 NEXT_PUBLIC_MAX_UPLOAD_BYTES를 함께 올린다.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('raw-scans', 'raw-scans', false, 52428800),
       ('artifacts', 'artifacts', false, 52428800),
       ('reports',   'reports',   false, 52428800)
on conflict (id) do nothing;

-- 원본 점군: 로그인 사용자가 업로드·조회(대시보드가 브라우저에서 직접 올린다)
drop policy if exists raw_scans_all_auth on storage.objects;
create policy raw_scans_all_auth on storage.objects for all to authenticated
  using (bucket_id = 'raw-scans') with check (bucket_id = 'raw-scans');

-- 산출물·보고서: 쓰기는 워커(service_role, RLS 우회)만. 로그인 사용자는 읽기 전용.
drop policy if exists artifacts_reports_read_auth on storage.objects;
create policy artifacts_reports_read_auth on storage.objects for select to authenticated
  using (bucket_id in ('artifacts', 'reports'));
